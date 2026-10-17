import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from 'cors';
import express from 'express';

import { createStore } from './db.js';
import { aiConfig, aiStatus } from './llm.js';
import { parseRequirements } from './parser.js';
import { solveWithSolver } from './solverClient.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const store = await createStore({
  databaseUrl: process.env.DATABASE_URL,
  dataFile: process.env.DATA_FILE ?? path.resolve(here, '../data/timesflex.json'),
});

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Wrap async handlers so every failure becomes a JSON 500 instead of a hung request.
const route = (handler) => async (request, response) => {
  try {
    await handler(request, response);
  } catch (error) {
    response.status(500).json({ error: error.message ?? 'Unexpected error' });
  }
};

const notFound = (response, what) => response.status(404).json({ error: `${what} not found` });

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
  const { name, type, profile } = request.body ?? {};
  if (!name || !type) {
    response.status(400).json({ error: 'name and type are required' });
    return;
  }
  response.status(201).json(await store.createInstitution({ name, type, data: profile ?? {} }));
}));

app.get('/api/institutions/:id', route(async (request, response) => {
  const institution = await store.getInstitution(request.params.id);
  if (!institution) return notFound(response, 'Institution');
  response.json(institution);
}));

app.put('/api/institutions/:id', route(async (request, response) => {
  const { name, type, profile } = request.body ?? {};
  if (!name || !type) {
    response.status(400).json({ error: 'name and type are required' });
    return;
  }
  const updated = await store.updateInstitution(request.params.id, { name, type, data: profile ?? {} });
  if (!updated) return notFound(response, 'Institution');
  response.json(updated);
}));

app.delete('/api/institutions/:id', route(async (request, response) => {
  const success = await store.deleteInstitution(request.params.id);
  if (!success) return notFound(response, 'Institution');
  response.json({ success: true });
}));

app.post('/api/institutions/:id/timetables', route(async (request, response) => {
  const institution = await store.getInstitution(request.params.id);
  if (!institution) return notFound(response, 'Institution');

  const { label, request: timetableRequest } = request.body ?? {};
  if (!timetableRequest?.days || !timetableRequest?.slots || !timetableRequest?.sessions) {
    response.status(400).json({ error: 'request.days, request.slots, and request.sessions are required' });
    return;
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
  if (!institution) return notFound(response, 'Institution');
  response.json(await store.listTimetables(institution.id));
}));

app.get('/api/timetables/:id', route(async (request, response) => {
  const timetable = await store.getTimetable(request.params.id);
  if (!timetable) return notFound(response, 'Timetable');
  response.json(timetable);
}));

app.post('/api/parse', route(async (request, response) => {
  const { text, context } = request.body ?? {};
  if (!text || !String(text).trim()) {
    response.status(400).json({ error: 'text is required' });
    return;
  }
  response.json(await parseRequirements(String(text), context ?? {}));
}));

app.post('/api/timetables/:id/solve', route(async (request, response) => {
  const timetable = await store.getTimetable(request.params.id);
  if (!timetable) return notFound(response, 'Timetable');

  const solverResult = await solveWithSolver(timetable.request);
  const updated = await store.updateTimetableSessions(
    timetable.id,
    solverResult.scheduled_sessions,
    solverResult.status === 'ok' ? 'generated' : 'partial',
  );
  response.json({ timetable: updated, solver: solverResult });
}));

const STATUSES = ['draft', 'generated', 'partial', 'edited', 'approved'];

// Save hand edits and/or change status. Sending only { status: 'approved' } approves as-is.
app.put('/api/timetables/:id', route(async (request, response) => {
  const { generatedSessions, status } = request.body ?? {};
  if (generatedSessions !== undefined && !Array.isArray(generatedSessions)) {
    response.status(400).json({ error: 'generatedSessions must be an array' });
    return;
  }
  if (status !== undefined && !STATUSES.includes(status)) {
    response.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
    return;
  }
  const existing = await store.getTimetable(request.params.id);
  if (!existing) return notFound(response, 'Timetable');
  const updated = await store.updateTimetableSessions(
    existing.id,
    generatedSessions ?? existing.generatedSessions,
    status ?? 'edited',
  );
  response.json(updated);
}));

const port = process.env.PORT ?? 3001;

app.listen(port, () => {
  const ai = aiConfig();
  console.log(`TimeFlex API listening on http://localhost:${port}`);
  console.log(`  storage: ${store.kind}${store.kind === 'file' ? ' (set DATABASE_URL to use PostgreSQL)' : ''}`);
  console.log(`  ai:      ${ai.provider} ${ai.provider === 'off' ? '' : `${ai.model} @ ${ai.baseUrl}`}`);
});
