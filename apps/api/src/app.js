import cors from 'cors';
import express from 'express';

import { HttpError } from './errors.js';

const STATUSES = ['draft', 'generated', 'partial', 'edited', 'approved'];
const APPROVABLE = ['generated', 'partial', 'edited'];

/**
 * Builds the Express app around injected dependencies so tests can run it
 * against an in-memory store and a fake solver.
 */
export const createApp = ({ store, solve, parse, aiConfig, aiStatus }) => {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  // Wrap async handlers so every failure becomes a JSON error instead of a hung request.
  const route = (handler) => async (request, response, next) => {
    try {
      await handler(request, response);
    } catch (error) {
      next(error);
    }
  };

  const notFound = (what) => new HttpError(404, `${what} not found`);

  app.get('/health', (request, response) => {
    response.json({ service: 'timesflex-api', status: 'ok', storage: store.kind, ai: aiConfig().provider });
  });

  app.get('/api/ai/status', route(async (request, response) => {
    response.json(await aiStatus());
  }));

  app.get('/api/institutions', route(async (request, response) => {
    response.json(await store.listInstitutions());
  }));

  app.post('/api/institutions', route(async (request, response) => {
    const { name, type, profile, data } = request.body ?? {};
    if (!name || !type) throw new HttpError(400, 'name and type are required');
    response.status(201).json(await store.createInstitution({ name, type, data: profile ?? data ?? {} }));
  }));

  app.get('/api/institutions/:id', route(async (request, response) => {
    const institution = await store.getInstitution(request.params.id);
    if (!institution) throw notFound('Institution');
    response.json(institution);
  }));

  app.put('/api/institutions/:id', route(async (request, response) => {
    const { name, type, profile, data } = request.body ?? {};
    if (!name || !type) throw new HttpError(400, 'name and type are required');
    const existing = await store.getInstitution(request.params.id);
    if (!existing) throw notFound('Institution');
    // GET returns the profile as `data`; accept either name, and never wipe it when omitted.
    const nextData = profile ?? data ?? existing.data;
    response.json(await store.updateInstitution(existing.id, { name, type, data: nextData }));
  }));

  app.delete('/api/institutions/:id', route(async (request, response) => {
    const success = await store.deleteInstitution(request.params.id);
    if (!success) throw notFound('Institution');
    response.json({ success: true });
  }));

  app.post('/api/institutions/:id/timetables', route(async (request, response) => {
    const institution = await store.getInstitution(request.params.id);
    if (!institution) throw notFound('Institution');

    const { label, request: timetableRequest } = request.body ?? {};
    if (!timetableRequest?.days || !timetableRequest?.slots || !timetableRequest?.sessions) {
      throw new HttpError(400, 'request.days, request.slots, and request.sessions are required');
    }
    const timetable = await store.createTimetable({
      institutionId: institution.id,
      label: label ?? 'Initial version',
      status: 'draft',
      request: timetableRequest,
    });
    response.status(201).json(timetable);
  }));

  app.get('/api/institutions/:id/timetables', route(async (request, response) => {
    const institution = await store.getInstitution(request.params.id);
    if (!institution) throw notFound('Institution');
    response.json(await store.listTimetables(institution.id));
  }));

  app.get('/api/timetables/:id', route(async (request, response) => {
    const timetable = await store.getTimetable(request.params.id);
    if (!timetable) throw notFound('Timetable');
    response.json(timetable);
  }));

  app.post('/api/parse', route(async (request, response) => {
    const { text, context } = request.body ?? {};
    if (!text || !String(text).trim()) throw new HttpError(400, 'text is required');
    response.json(await parse(String(text), context ?? {}));
  }));

  app.post('/api/timetables/:id/solve', route(async (request, response) => {
    const timetable = await store.getTimetable(request.params.id);
    if (!timetable) throw notFound('Timetable');
    if (timetable.status === 'approved') {
      throw new HttpError(409, 'This version is approved. Generate a new version instead.');
    }

    const solverResult = await solve(timetable.request);
    const scheduled = solverResult.scheduled_sessions ?? [];
    const report = {
      unscheduledSessions: solverResult.unscheduled_sessions ?? [],
      diagnostics: solverResult.diagnostics ?? [],
    };
    // A solve that placed nothing must never replace sessions that already exist.
    if (scheduled.length === 0 && (timetable.generatedSessions ?? []).length > 0) {
      const kept = await store.updateTimetable(timetable.id, { report });
      response.json({ timetable: kept, solver: solverResult, applied: false });
      return;
    }
    const updated = await store.updateTimetable(timetable.id, {
      generatedSessions: scheduled,
      status: solverResult.status === 'ok' ? 'generated' : 'partial',
      report,
    });
    response.json({ timetable: updated, solver: solverResult, applied: true });
  }));

  // Save hand edits and/or change status.
  //   { generatedSessions }            save edits (status becomes "edited")
  //   { status: 'approved' }           approve as-is
  //   { status: 'edited' }             unapprove an approved version
  // Approved versions are read-only until they are unapproved.
  app.put('/api/timetables/:id', route(async (request, response) => {
    const { generatedSessions, status } = request.body ?? {};
    if (generatedSessions !== undefined && !Array.isArray(generatedSessions)) {
      throw new HttpError(400, 'generatedSessions must be an array');
    }
    if (status !== undefined && !STATUSES.includes(status)) {
      throw new HttpError(400, `status must be one of ${STATUSES.join(', ')}`);
    }
    if (generatedSessions === undefined && status === undefined) {
      throw new HttpError(400, 'Send generatedSessions, status, or both');
    }
    const existing = await store.getTimetable(request.params.id);
    if (!existing) throw notFound('Timetable');

    if (existing.status === 'approved' && generatedSessions !== undefined && status !== 'approved') {
      throw new HttpError(409, 'This version is approved. Unapprove it before editing.');
    }
    const sessions = generatedSessions ?? existing.generatedSessions ?? [];
    if (status === 'approved') {
      if (![...APPROVABLE, 'approved'].includes(existing.status)) {
        throw new HttpError(409, `A ${existing.status} version cannot be approved. Generate it first.`);
      }
      if (sessions.length === 0) throw new HttpError(409, 'An empty timetable cannot be approved.');
    }
    response.json(
      await store.updateTimetable(existing.id, { generatedSessions: sessions, status: status ?? 'edited' }),
    );
  }));

  app.use((request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  // Errors always come back as JSON. Unknown errors are 500s with a generic message;
  // the detail goes to the server log instead of the client.
  // eslint-disable-next-line no-unused-vars
  app.use((error, request, response, next) => {
    if (error?.type === 'entity.parse.failed') {
      response.status(400).json({ error: 'Request body is not valid JSON' });
      return;
    }
    if (error instanceof HttpError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    console.error(error);
    response.status(500).json({ error: 'Unexpected server error' });
  });

  return app;
};
