import fs from 'node:fs';
import path from 'node:path';

import cors from 'cors';
import express from 'express';

import {
  SESSION_COOKIE,
  cookieOptions,
  createLoginLimiter,
  hashPassword,
  hashToken,
  loadUser,
  newSessionToken,
  publicUser,
  requireRole,
  requireUser,
  sessionExpiry,
  validatePassword,
  validateRole,
  validateUsername,
  verifyPassword,
} from './auth.js';
import { HttpError } from './errors.js';

const STATUSES = ['draft', 'generated', 'partial', 'edited', 'approved'];
const APPROVABLE = ['generated', 'partial', 'edited'];

/**
 * Builds the Express app around injected dependencies so tests can run it
 * against an in-memory store and a fake solver.
 */
export const createApp = ({ store, solve, parse, aiConfig, aiStatus, webDist, allowedOrigins = [] }) => {
  const app = express();
  app.disable('x-powered-by');
  // Same-origin by default (the API serves the web app, or Vite proxies to it).
  // Extra origins must be listed explicitly because requests carry a session cookie.
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(loadUser(store));
  const limiter = createLoginLimiter();
  const admin = requireRole('admin');

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

  const startSession = async (response, user) => {
    const token = newSessionToken();
    await store.createSession({ id: hashToken(token), userId: user.id, expiresAt: sessionExpiry() });
    response.cookie(SESSION_COOKIE, token, cookieOptions());
  };

  // Who am I? Also tells a fresh install that it still needs its first admin.
  app.get('/api/auth/me', route(async (request, response) => {
    if (request.user) {
      response.json({ user: publicUser(request.user) });
      return;
    }
    response.status(401).json({ error: 'Please sign in.', needsSetup: (await store.countUsers()) === 0 });
  }));

  // First run only: create the owner account. Refused once any user exists.
  app.post('/api/auth/setup', route(async (request, response) => {
    const username = validateUsername(request.body?.username);
    const password = validatePassword(request.body?.password);
    if ((await store.countUsers()) > 0) throw new HttpError(409, 'Setup is already done. Sign in instead.');
    const user = await store.createUser({ username, passwordHash: await hashPassword(password), role: 'admin' });
    await startSession(response, user);
    response.status(201).json({ user: publicUser(user) });
  }));

  app.post('/api/auth/login', route(async (request, response) => {
    const username = String(request.body?.username ?? '').trim().toLowerCase();
    const password = String(request.body?.password ?? '');
    limiter.check(username, request.ip);
    const user = username ? await store.getUserByUsername(username) : null;
    const valid = user && !user.disabled && (await verifyPassword(password, user.passwordHash));
    if (!valid) {
      limiter.fail(username, request.ip);
      throw new HttpError(401, 'Wrong username or password.');
    }
    limiter.succeed(username);
    await startSession(response, user);
    response.json({ user: publicUser(user) });
  }));

  app.post('/api/auth/logout', route(async (request, response) => {
    if (request.sessionHash) await store.deleteSession(request.sessionHash);
    response.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
    response.json({ success: true });
  }));

  app.post('/api/auth/password', requireUser, route(async (request, response) => {
    const { currentPassword, newPassword } = request.body ?? {};
    if (!(await verifyPassword(String(currentPassword ?? ''), request.user.passwordHash))) {
      throw new HttpError(400, 'Current password is wrong.');
    }
    await store.updateUser(request.user.id, { passwordHash: await hashPassword(validatePassword(newPassword)) });
    // Sign out every other device.
    await store.deleteUserSessions(request.user.id, { except: request.sessionHash });
    response.json({ success: true });
  }));

  // Everything below needs a signed-in user.
  app.use('/api', requireUser);

  // Users: admin only.
  app.get('/api/users', admin, route(async (request, response) => {
    response.json((await store.listUsers()).map(publicUser));
  }));

  app.post('/api/users', admin, route(async (request, response) => {
    const username = validateUsername(request.body?.username);
    const password = validatePassword(request.body?.password);
    const role = validateRole(request.body?.role ?? 'viewer');
    if (await store.getUserByUsername(username)) throw new HttpError(409, 'That username is taken.');
    const user = await store.createUser({ username, passwordHash: await hashPassword(password), role });
    response.status(201).json(publicUser(user));
  }));

  const activeAdmins = async () => (await store.listUsers()).filter((user) => user.role === 'admin' && !user.disabled);

  app.patch('/api/users/:id', admin, route(async (request, response) => {
    const target = await store.getUser(request.params.id);
    if (!target) throw notFound('User');
    const { role, disabled, password } = request.body ?? {};
    const changes = {};
    if (role !== undefined) changes.role = validateRole(role);
    if (disabled !== undefined) changes.disabled = Boolean(disabled);
    if (password !== undefined) changes.passwordHash = await hashPassword(validatePassword(password));
    const losesAdmin = target.role === 'admin' && !target.disabled && (changes.role === 'viewer' || changes.disabled);
    if (losesAdmin && (await activeAdmins()).length <= 1) {
      throw new HttpError(409, 'There must always be at least one active admin.');
    }
    const updated = await store.updateUser(target.id, changes);
    if (changes.disabled || changes.passwordHash) await store.deleteUserSessions(target.id);
    response.json(publicUser(updated));
  }));

  app.delete('/api/users/:id', admin, route(async (request, response) => {
    if (request.params.id === request.user.id) throw new HttpError(409, 'You cannot delete your own account.');
    const target = await store.getUser(request.params.id);
    if (!target) throw notFound('User');
    if (target.role === 'admin' && !target.disabled && (await activeAdmins()).length <= 1) {
      throw new HttpError(409, 'There must always be at least one active admin.');
    }
    await store.deleteUser(target.id);
    response.json({ success: true });
  }));

  app.get('/api/ai/status', route(async (request, response) => {
    response.json(await aiStatus());
  }));

  app.get('/api/institutions', route(async (request, response) => {
    response.json(await store.listInstitutions());
  }));

  app.post('/api/institutions', admin, route(async (request, response) => {
    const { name, type, profile, data } = request.body ?? {};
    if (!name || !type) throw new HttpError(400, 'name and type are required');
    response.status(201).json(await store.createInstitution({ name, type, data: profile ?? data ?? {} }));
  }));

  app.get('/api/institutions/:id', route(async (request, response) => {
    const institution = await store.getInstitution(request.params.id);
    if (!institution) throw notFound('Institution');
    response.json(institution);
  }));

  app.put('/api/institutions/:id', admin, route(async (request, response) => {
    const { name, type, profile, data } = request.body ?? {};
    if (!name || !type) throw new HttpError(400, 'name and type are required');
    const existing = await store.getInstitution(request.params.id);
    if (!existing) throw notFound('Institution');
    // GET returns the profile as `data`; accept either name, and never wipe it when omitted.
    const nextData = profile ?? data ?? existing.data;
    response.json(await store.updateInstitution(existing.id, { name, type, data: nextData }));
  }));

  app.delete('/api/institutions/:id', admin, route(async (request, response) => {
    const success = await store.deleteInstitution(request.params.id);
    if (!success) throw notFound('Institution');
    response.json({ success: true });
  }));

  app.post('/api/institutions/:id/timetables', admin, route(async (request, response) => {
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

  app.post('/api/parse', admin, route(async (request, response) => {
    const { text, context } = request.body ?? {};
    if (!text || !String(text).trim()) throw new HttpError(400, 'text is required');
    response.json(await parse(String(text), context ?? {}));
  }));

  app.post('/api/timetables/:id/solve', admin, route(async (request, response) => {
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
  app.put('/api/timetables/:id', admin, route(async (request, response) => {
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

  app.use('/api', (request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  // Serve the built web app from the same origin when it exists (pilot / production mode).
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false }));
    app.get('*', (request, response) => response.sendFile(path.join(webDist, 'index.html')));
  }

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
    if (error?.code === '23505') {
      response.status(409).json({ error: 'That record already exists.' });
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
