import cors from 'cors';
import express from 'express';

import {
  MIN_PASSWORD,
  SESSION_DAYS,
  bearerToken,
  createRateLimiter,
  hashPassword,
  hashToken,
  isValidEmail,
  newToken,
  normalizeEmail,
  verifyAgainstDummy,
  verifyPassword,
} from './auth.js';
import { DuplicateEmailError } from './db.js';
import { aiConfig, aiStatus } from './llm.js';
import { parseRequirements } from './parser.js';
import { solveWithSolver } from './solverClient.js';

const STATUSES = ['draft', 'generated', 'partial', 'edited', 'approved'];
const TYPES = ['school', 'college', 'university'];

const publicAccount = (account) => ({ id: account.id, name: account.name, email: account.email, createdAt: account.createdAt });
const publicInstitution = ({ ownerId, ...institution }) => institution;

/**
 * Every route except health, sign-up and login needs a session. An account owns its
 * institution, and every institution or timetable route checks that ownership.
 */
export const createApp = ({ store, solve = solveWithSolver, loginLimiter = createRateLimiter() }) => {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Wrap async handlers so every failure becomes a JSON 500 instead of a hung request.
  const route = (handler) => async (request, response, next) => {
    try {
      await handler(request, response, next);
    } catch (error) {
      response.status(500).json({ error: error.message ?? 'Unexpected error' });
    }
  };
  const fail = (response, status, error) => response.status(status).json({ error });
  const notFound = (response, what) => fail(response, 404, `${what} not found`);

  const startSession = async (account) => {
    const token = newToken();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await store.createSession({ tokenHash: hashToken(token), accountId: account.id, expiresAt });
    return token;
  };

  const sessionPayload = async (account, token) => {
    const [institution] = await store.listInstitutions(account.id);
    return {
      ...(token && { token }),
      account: publicAccount(account),
      institution: institution ? publicInstitution(institution) : null,
    };
  };

  const requireAuth = route(async (request, response, next) => {
    const token = bearerToken(request);
    const session = token ? await store.getSession(hashToken(token)) : null;
    const account = session ? await store.getAccount(session.accountId) : null;
    if (!account) return fail(response, 401, 'Please sign in');
    request.account = account;
    request.tokenHash = hashToken(token);
    next();
  });

  /** The institution, if it exists and belongs to the signed-in account. */
  const ownedInstitution = async (request, id) => {
    const institution = await store.getInstitution(id);
    return institution && institution.ownerId === request.account.id ? institution : null;
  };
  const ownedTimetable = async (request, id) => {
    const timetable = await store.getTimetable(id);
    return timetable && (await ownedInstitution(request, timetable.institutionId)) ? timetable : null;
  };

  app.get('/health', (request, response) => {
    response.json({ service: 'timesflex-api', status: 'ok', storage: store.kind, ai: aiConfig().provider });
  });

  /* ---------- Accounts ---------- */

  app.post('/api/auth/signup', route(async (request, response) => {
    const { name, email, password, institutionName, institutionType = 'college' } = request.body ?? {};
    const cleanEmail = normalizeEmail(email);
    if (!String(name ?? '').trim()) return fail(response, 400, 'Your name is required');
    if (!String(institutionName ?? '').trim()) return fail(response, 400, 'Institution name is required');
    if (!isValidEmail(cleanEmail)) return fail(response, 400, 'Enter a valid e-mail address');
    if (String(password ?? '').length < MIN_PASSWORD) {
      return fail(response, 400, `Password must be at least ${MIN_PASSWORD} characters`);
    }
    if (!TYPES.includes(institutionType)) return fail(response, 400, `Type must be one of ${TYPES.join(', ')}`);

    let account;
    try {
      account = await store.createAccount({
        name: String(name).trim(),
        email: cleanEmail,
        passwordHash: await hashPassword(password),
      });
    } catch (error) {
      if (error instanceof DuplicateEmailError) return fail(response, 409, 'An account with this e-mail already exists. Sign in instead.');
      throw error;
    }
    await store.createInstitution({
      ownerId: account.id,
      name: String(institutionName).trim(),
      type: institutionType,
      data: { profile: { institution: { name: String(institutionName).trim(), type: institutionType } } },
    });
    const token = await startSession(account);
    response.status(201).json(await sessionPayload(account, token));
  }));

  app.post('/api/auth/login', route(async (request, response) => {
    const { email, password } = request.body ?? {};
    const cleanEmail = normalizeEmail(email);
    const key = `${cleanEmail}|${request.ip}`;
    if (loginLimiter.blocked(key)) return fail(response, 429, 'Too many attempts. Try again in a few minutes.');

    const account = cleanEmail ? await store.getAccountByEmail(cleanEmail) : null;
    const ok = account ? await verifyPassword(password ?? '', account.passwordHash) : await verifyAgainstDummy(password ?? '');
    if (!account || !ok) {
      loginLimiter.fail(key);
      return fail(response, 401, 'E-mail or password is incorrect');
    }
    loginLimiter.reset(key);
    const token = await startSession(account);
    response.json(await sessionPayload(account, token));
  }));

  app.get('/api/auth/me', requireAuth, route(async (request, response) => {
    response.json(await sessionPayload(request.account));
  }));

  app.post('/api/auth/logout', requireAuth, route(async (request, response) => {
    await store.deleteSession(request.tokenHash);
    response.json({ success: true });
  }));

  /* ---------- Everything below needs a session ---------- */

  app.use('/api', requireAuth);

  app.get('/api/ai/status', route(async (request, response) => {
    response.json(await aiStatus());
  }));

  app.get('/api/institutions', route(async (request, response) => {
    response.json((await store.listInstitutions(request.account.id)).map(publicInstitution));
  }));

  app.post('/api/institutions', route(async (request, response) => {
    const { name, type, profile } = request.body ?? {};
    if (!name || !type) return fail(response, 400, 'name and type are required');
    const created = await store.createInstitution({ ownerId: request.account.id, name, type, data: profile ?? {} });
    response.status(201).json(publicInstitution(created));
  }));

  app.get('/api/institutions/:id', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return notFound(response, 'Institution');
    response.json(publicInstitution(institution));
  }));

  app.put('/api/institutions/:id', route(async (request, response) => {
    const { name, type, profile } = request.body ?? {};
    if (!name || !type) return fail(response, 400, 'name and type are required');
    if (!(await ownedInstitution(request, request.params.id))) return notFound(response, 'Institution');
    const updated = await store.updateInstitution(request.params.id, { name, type, data: profile ?? {} });
    response.json(publicInstitution(updated));
  }));

  app.delete('/api/institutions/:id', route(async (request, response) => {
    if (!(await ownedInstitution(request, request.params.id))) return notFound(response, 'Institution');
    await store.deleteInstitution(request.params.id);
    response.json({ success: true });
  }));

  app.post('/api/institutions/:id/timetables', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return notFound(response, 'Institution');

    const { label, request: timetableRequest } = request.body ?? {};
    if (!timetableRequest?.days || !timetableRequest?.slots || !timetableRequest?.sessions) {
      return fail(response, 400, 'request.days, request.slots, and request.sessions are required');
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
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return notFound(response, 'Institution');
    response.json(await store.listTimetables(institution.id));
  }));

  app.get('/api/timetables/:id', route(async (request, response) => {
    const timetable = await ownedTimetable(request, request.params.id);
    if (!timetable) return notFound(response, 'Timetable');
    response.json(timetable);
  }));

  app.post('/api/parse', route(async (request, response) => {
    const { text, context } = request.body ?? {};
    if (!text || !String(text).trim()) return fail(response, 400, 'text is required');
    response.json(await parseRequirements(String(text), context ?? {}));
  }));

  app.post('/api/timetables/:id/solve', route(async (request, response) => {
    const timetable = await ownedTimetable(request, request.params.id);
    if (!timetable) return notFound(response, 'Timetable');

    const solverResult = await solve(timetable.request);
    const updated = await store.updateTimetableSessions(
      timetable.id,
      solverResult.scheduled_sessions,
      solverResult.status === 'ok' ? 'generated' : 'partial',
    );
    response.json({ timetable: updated, solver: solverResult });
  }));

  // Save hand edits and/or change status. Sending only { status: 'approved' } approves as-is.
  app.put('/api/timetables/:id', route(async (request, response) => {
    const { generatedSessions, status } = request.body ?? {};
    if (generatedSessions !== undefined && !Array.isArray(generatedSessions)) {
      return fail(response, 400, 'generatedSessions must be an array');
    }
    if (status !== undefined && !STATUSES.includes(status)) {
      return fail(response, 400, `status must be one of ${STATUSES.join(', ')}`);
    }
    const existing = await ownedTimetable(request, request.params.id);
    if (!existing) return notFound(response, 'Timetable');
    const updated = await store.updateTimetableSessions(
      existing.id,
      generatedSessions ?? existing.generatedSessions,
      status ?? 'edited',
    );
    response.json(updated);
  }));

  return app;
};
