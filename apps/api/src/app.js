import crypto from 'node:crypto';

import cors from 'cors';
import express from 'express';
import { nanoid } from 'nanoid';

import {
  DEMO_DOMAIN,
  MAX_PASSWORD,
  MIN_PASSWORD,
  SESSION_DAYS,
  bearerToken,
  createJobSlots,
  createRateLimiter,
  hashPassword,
  hashToken,
  isValidEmail,
  newToken,
  normalizeEmail,
  verifyAgainstDummy,
  verifyPassword,
} from './auth.js';
import { mergeAttendance, mountAttendance, olderOnly, withAttendance } from './attendance.js';
import { DuplicateEmailError } from './db.js';
import { mountDeviceApi, mountDevices } from './devices.js';
import { interpretCommand } from './intent.js';
import { mountEvents } from './events.js';
import { mountJoin, mountMembers } from './members.js';
import { mountNotices, mountWhatsAppWebhook } from './notices.js';
import { mountPlatform } from './platform.js';
import { aiStatus } from './llm.js';
import { parseRequirements } from './parser.js';
import { SolverRejectedError, solveWithSolver } from './solverClient.js';
import { LIMITS, cleanContext, cleanText, timetableRequestProblem } from './validate.js';

const STATUSES = ['draft', 'generated', 'partial', 'edited', 'approved'];
const TYPES = ['school', 'college', 'university'];

const MAX_INSTITUTIONS = 5;
const MAX_VERSIONS = 100;
const MINUTE = 60 * 1000;

const publicAccount = (account) => ({ id: account.id, name: account.name, email: account.email, createdAt: account.createdAt, platformAdmin: account.platformAdmin === true });
const publicInstitution = ({ ownerId, ...institution }) => institution;

/**
 * Every route except health, sign-up and login needs a session. An account owns its
 * institution, and every institution or timetable route checks that ownership.
 */
export const createApp = ({ store, solve = solveWithSolver, send, loginLimiter = createRateLimiter(), limits = {} }) => {
  // Per address, and many people can share one: a whole college, or everyone on a Docker host that
  // hides real addresses. These only stop floods. Guessing one account has its own tight limit.
  const signupLimiter = limits.signup ?? createRateLimiter({ limit: 100, windowMs: 60 * MINUTE });
  const loginIpLimiter = limits.loginIp ?? createRateLimiter({ limit: 200, windowMs: 15 * MINUTE });
  const aiLimiter = limits.ai ?? createRateLimiter({ limit: 30, windowMs: MINUTE });
  const solveLimiter = limits.solve ?? createRateLimiter({ limit: 40, windowMs: 5 * MINUTE });
  const solverSlots = createJobSlots({ active: Number(process.env.SOLVER_CONCURRENCY ?? 3), waiting: 30 });

  const app = express();
  app.disable('x-powered-by');
  // Behind nginx every request would otherwise look like one visitor, and the login limit
  // would be shared. TRUST_PROXY is the number of proxies in front of the API.
  const proxies = Number(process.env.TRUST_PROXY ?? 0);
  if (proxies > 0) app.set('trust proxy', proxies);
  // Unset (development): any origin. In Docker it is empty: the app and API share one address.
  const origins = process.env.CORS_ORIGINS;
  app.use(origins === undefined ? cors() : cors({ origin: origins.split(',').map((item) => item.trim()).filter(Boolean) }));
  // Meta calls this one, signed, with no session. It reads its own raw body to check the signature.
  mountWhatsAppWebhook(app, { store });
  // Without a login, only tiny bodies are read. Bigger ones are parsed after the session check.
  app.use('/api/auth', express.json({ limit: '32kb' }));

  // Every failure becomes a JSON 500 instead of a hung request. Details stay in the server log.
  const route = (handler) => async (request, response, next) => {
    try {
      await handler(request, response, next);
    } catch (error) {
      console.error(`${request.method} ${request.path}:`, error.stack ?? error.message);
      response.status(500).json({ error: 'Something went wrong. Please try again.' });
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
    const [owned] = await store.listInstitutions(account.id);
    const [membership] = owned ? [] : await store.listMemberships(account.id);
    const institution = owned ?? (membership ? await store.getInstitution(membership.institutionId) : null);
    const role = owned ? 'admin' : (membership?.role ?? null);
    const brief = institution && { id: institution.id, name: institution.name, type: institution.type, status: institution.status ?? 'active' };
    // Only someone running the college gets its data here. Teachers load what they need separately.
    const usable = institution && role === 'admin' && (institution.status ?? 'active') === 'active';
    return {
      ...(token && { token }),
      account: publicAccount(account),
      role,
      ...(membership?.teacherId ? { teacherId: membership.teacherId } : {}),
      institution: usable ? publicInstitution(await withAttendance(store, institution)) : brief,
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

  /** The institution and this account's part in it. A paused college is closed to everyone in it. */
  const memberAccess = async (request, id) => {
    const institution = await store.getInstitution(id);
    if (!institution || (institution.status ?? 'active') !== 'active') return null;
    if (institution.ownerId === request.account.id) return { institution, role: 'admin', teacherId: null };
    const membership = await store.getMembership(request.account.id, institution.id);
    return membership ? { institution, role: membership.role, teacherId: membership.teacherId ?? null } : null;
  };
  /** The institution, if the signed-in account runs it. Teachers don't reach these routes. */
  const ownedInstitution = async (request, id) => {
    const access = await memberAccess(request, id);
    return access?.role === 'admin' ? access.institution : null;
  };
  const ownedTimetable = async (request, id) => {
    const timetable = await store.getTimetable(id);
    return timetable && (await ownedInstitution(request, timetable.institutionId)) ? timetable : null;
  };

  app.get('/health', (request, response) => {
    response.json({ service: 'timesflex-api', status: 'ok', signup: process.env.ALLOW_SIGNUP !== 'false' });
  });

  /* ---------- Accounts ---------- */

  /** An account with its first institution, signed in. */
  const openAccount = async (response, { name, email, password, institutionName, institutionType }) => {
    const account = await store.createAccount({ name, email, passwordHash: await hashPassword(password) });
    await store.createInstitution({
      ownerId: account.id,
      name: institutionName,
      type: institutionType,
      data: { profile: { institution: { name: institutionName, type: institutionType } } },
    });
    const token = await startSession(account);
    response.status(201).json(await sessionPayload(account, token));
  };
  const tooMany = (response) => fail(response, 429, 'Too many attempts. Try again in a little while.');

  app.post('/api/auth/signup', route(async (request, response) => {
    if (process.env.ALLOW_SIGNUP === 'false') return fail(response, 403, 'New colleges are set up by invitation. Contact whoever runs this service.');
    const { name, email, password, institutionName, institutionType = 'college' } = request.body ?? {};
    const cleanName = cleanText(name, LIMITS.name);
    const cleanInstitution = cleanText(institutionName, LIMITS.institutionName);
    const cleanEmail = typeof email === 'string' ? normalizeEmail(email) : '';
    if (!cleanName) return fail(response, 400, `Your name is required (at most ${LIMITS.name} characters)`);
    if (!cleanInstitution) return fail(response, 400, `Institution name is required (at most ${LIMITS.institutionName} characters)`);
    if (!isValidEmail(cleanEmail) || cleanEmail.endsWith(DEMO_DOMAIN)) return fail(response, 400, 'Enter a valid e-mail address');
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
      return fail(response, 400, `Password must be at least ${MIN_PASSWORD} characters`);
    }
    if (password.length > MAX_PASSWORD) return fail(response, 400, `Password must be at most ${MAX_PASSWORD} characters`);
    if (!TYPES.includes(institutionType)) return fail(response, 400, `Type must be one of ${TYPES.join(', ')}`);
    if (!signupLimiter.take(request.ip)) return tooMany(response);

    try {
      await openAccount(response, { name: cleanName, email: cleanEmail, password, institutionName: cleanInstitution, institutionType });
    } catch (error) {
      if (error instanceof DuplicateEmailError) return fail(response, 409, 'An account with this e-mail already exists. Sign in instead.');
      throw error;
    }
  }));

  // One tap for a pitch. The server picks the credentials and never reveals them; demo accounts
  // go away after a day. Set ALLOW_DEMO=false to turn this off.
  app.post('/api/auth/demo', route(async (request, response) => {
    if (process.env.ALLOW_DEMO === 'false') return notFound(response, 'Demo');
    if (!signupLimiter.take(request.ip)) return tooMany(response);
    await openAccount(response, {
      name: 'Prof. Demo',
      email: `demo-${nanoid(12).toLowerCase().replace(/[^a-z0-9]/g, 'x')}${DEMO_DOMAIN}`,
      password: crypto.randomBytes(32).toString('base64url'),
      institutionName: 'Demo College of Engineering',
      institutionType: 'college',
    });
  }));

  app.post('/api/auth/login', route(async (request, response) => {
    const { email, password } = request.body ?? {};
    const cleanEmail = typeof email === 'string' ? normalizeEmail(email) : '';
    const guess = typeof password === 'string' && password.length <= MAX_PASSWORD ? password : '';
    const key = `${cleanEmail}|${request.ip}`;
    if (loginLimiter.blocked(key) || loginIpLimiter.blocked(request.ip)) return fail(response, 429, 'Too many attempts. Try again in a few minutes.');

    const account = cleanEmail ? await store.getAccountByEmail(cleanEmail) : null;
    const ok = account ? await verifyPassword(guess, account.passwordHash) : await verifyAgainstDummy(guess);
    if (!account || !ok) {
      loginLimiter.fail(key);
      loginIpLimiter.fail(request.ip);
      return fail(response, 401, 'E-mail or password is incorrect');
    }
    loginLimiter.reset(key);
    const token = await startSession(account);
    response.json(await sessionPayload(account, token));
  }));

  mountJoin(app, { store, route, fail, sessionPayload, startSession, signupLimiter, loginLimiter });

  app.get('/api/auth/me', requireAuth, route(async (request, response) => {
    response.json(await sessionPayload(request.account));
  }));

  app.post('/api/auth/logout', requireAuth, route(async (request, response) => {
    await store.deleteSession(request.tokenHash);
    response.json({ success: true });
  }));

  // Changing the password signs out every other device.
  app.post('/api/auth/password', requireAuth, route(async (request, response) => {
    const { current, next } = request.body ?? {};
    const key = `password|${request.account.id}`;
    if (loginLimiter.blocked(key)) return fail(response, 429, 'Too many attempts. Try again in a few minutes.');
    if (typeof current !== 'string' || current.length > MAX_PASSWORD || !(await verifyPassword(current, request.account.passwordHash))) {
      loginLimiter.fail(key);
      return fail(response, 403, 'Your current password is incorrect');
    }
    if (typeof next !== 'string' || next.length < MIN_PASSWORD || next.length > MAX_PASSWORD) {
      return fail(response, 400, `The new password must be ${MIN_PASSWORD} to ${MAX_PASSWORD} characters`);
    }
    await store.updateAccountPassword(request.account.id, await hashPassword(next));
    await store.deleteAccountSessions(request.account.id, request.tokenHash);
    response.json({ success: true });
  }));

  // Deleting an account removes its institution and everything in it, so it asks for the password again.
  app.delete('/api/auth/account', requireAuth, route(async (request, response) => {
    const { password } = request.body ?? {};
    const key = `delete|${request.account.id}`;
    if (loginLimiter.blocked(key)) return fail(response, 429, 'Too many attempts. Try again in a few minutes.');
    if (typeof password !== 'string' || password.length > MAX_PASSWORD || !(await verifyPassword(password, request.account.passwordHash))) {
      loginLimiter.fail(key);
      return fail(response, 403, 'Password is incorrect');
    }
    await store.deleteAccount(request.account.id);
    response.json({ success: true });
  }));

  const institutionProblem = (name, type) => {
    if (!cleanText(name, LIMITS.institutionName)) return `name is required (at most ${LIMITS.institutionName} characters)`;
    if (!TYPES.includes(type)) return `type must be one of ${TYPES.join(', ')}`;
    return null;
  };

  mountDeviceApi(app, { store, route, fail, limits });

  /* ---------- Everything below needs a session ---------- */

  app.use('/api', requireAuth);
  app.use('/api', express.json({ limit: '5mb' }));

  // What the app needs to show, without internal addresses or installed model lists.
  app.get('/api/ai/status', route(async (request, response) => {
    const status = await aiStatus();
    if (status.error) console.warn('AI status:', status.error);
    const ready = status.reachable && status.modelAvailable;
    response.json({
      provider: status.provider,
      model: status.model,
      reachable: status.reachable,
      modelAvailable: status.modelAvailable,
      error: ready ? null : status.provider === 'off' ? 'AI is turned off' : status.reachable ? 'The AI model is still downloading' : 'AI is not available right now',
    });
  }));

  app.get('/api/institutions', route(async (request, response) => {
    response.json((await store.listInstitutions(request.account.id)).map(publicInstitution));
  }));

  app.post('/api/institutions', route(async (request, response) => {
    const { name, type, profile } = request.body ?? {};
    const problem = institutionProblem(name, type);
    if (problem) return fail(response, 400, problem);
    if ((await store.listInstitutions(request.account.id)).length >= MAX_INSTITUTIONS) {
      return fail(response, 409, `One account can have at most ${MAX_INSTITUTIONS} institutions`);
    }
    const created = await store.createInstitution({ ownerId: request.account.id, name: name.trim(), type, data: profile ?? {} });
    response.status(201).json(publicInstitution(created));
  }));

  app.get('/api/institutions/:id', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return notFound(response, 'Institution');
    response.json(publicInstitution(await withAttendance(store, institution)));
  }));

  app.put('/api/institutions/:id', route(async (request, response) => {
    const { name, type, profile } = request.body ?? {};
    const problem = institutionProblem(name, type);
    if (problem) return fail(response, 400, problem);
    const existing = await ownedInstitution(request, request.params.id);
    if (!existing) return notFound(response, 'Institution');
    // Day-to-day records have their own endpoint (below), so a profile save from one device
    // never rolls back absences or attendance recorded on another.
    const operations = existing.data?.operations ?? profile?.operations;
    const data = { ...(profile ?? {}), ...(operations && { operations }) };
    const updated = await store.updateInstitution(request.params.id, { name: name.trim(), type, data });
    response.json(publicInstitution(updated));
  }));

  app.put('/api/institutions/:id/operations', route(async (request, response) => {
    const existing = await ownedInstitution(request, request.params.id);
    if (!existing) return notFound(response, 'Institution');
    const { absences, substitutions, attendance } = request.body ?? {};
    if (![absences, substitutions, attendance].every(Array.isArray)) {
      return fail(response, 400, 'absences, substitutions and attendance must be arrays');
    }
    // Attendance has its own table now. A screen saving its older copy can't undo a teacher's register.
    const { older, stored } = await olderOnly(store, existing.id, attendance);
    await store.updateInstitution(existing.id, {
      name: existing.name,
      type: existing.type,
      data: { ...(existing.data ?? {}), operations: { absences, substitutions, attendance: older } },
    });
    response.json({ absences, substitutions, attendance: mergeAttendance(older, stored) });
  }));

  app.delete('/api/institutions/:id', route(async (request, response) => {
    if (!(await ownedInstitution(request, request.params.id))) return notFound(response, 'Institution');
    await store.deleteInstitution(request.params.id);
    response.json({ success: true });
  }));

  // Starting over: removes every timetable version and update, keeping the account.
  app.delete('/api/institutions/:id/history', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return notFound(response, 'Institution');
    await store.pruneNotices(institution.id, 0);
    await store.deleteTimetables(institution.id);
    await store.clearAttendance(institution.id);
    // Saved separately from the setup, so clearing the setup alone would leave them behind.
    const data = institution.data ?? {};
    await store.updateInstitution(institution.id, { name: institution.name, type: institution.type, data: { ...data, operations: { absences: [], substitutions: [], attendance: [] } } });
    response.json({ success: true });
  }));

  app.post('/api/institutions/:id/timetables', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return notFound(response, 'Institution');

    const { label, request: timetableRequest } = request.body ?? {};
    const problem = timetableRequestProblem(timetableRequest);
    if (problem) return fail(response, 400, problem);
    const timetable = await store.createTimetable({
      institutionId: institution.id,
      label: typeof label === 'string' ? label.slice(0, LIMITS.label) : 'Initial version',
      status: 'draft',
      request: timetableRequest,
    });
    // Old unapproved versions make way, so saved data cannot grow forever.
    await store.pruneTimetables(institution.id, MAX_VERSIONS);
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

  const assistantText = (request, response) => {
    const text = cleanText(request.body?.text, LIMITS.assistantText);
    if (!text) {
      fail(response, 400, `text is required (at most ${LIMITS.assistantText} characters)`);
      return null;
    }
    if (!aiLimiter.take(request.account.id)) {
      fail(response, 429, 'That is a lot of requests. Give it a minute.');
      return null;
    }
    return text;
  };

  app.post('/api/agent/interpret', route(async (request, response) => {
    const text = assistantText(request, response);
    if (!text) return;
    const { error, ...reply } = await interpretCommand(text, cleanContext(request.body.context));
    if (error) console.warn('AI interpret failed:', error);
    response.json(reply);
  }));

  app.post('/api/parse', route(async (request, response) => {
    const text = assistantText(request, response);
    if (!text) return;
    response.json(await parseRequirements(text, cleanContext(request.body.context)));
  }));

  app.post('/api/timetables/:id/solve', route(async (request, response) => {
    const timetable = await ownedTimetable(request, request.params.id);
    if (!timetable) return notFound(response, 'Timetable');

    if (!solveLimiter.take(request.account.id)) return fail(response, 429, 'That is a lot of timetables in a short time. Give it a few minutes.');
    let solverResult;
    try {
      solverResult = await solverSlots.run(() => solve(timetable.request));
    } catch (error) {
      if (error.busy) return fail(response, 503, 'The server is busy building other timetables. Try again in a minute.');
      console.error('Solver:', error.message);
      if (error instanceof SolverRejectedError) return fail(response, 400, 'This timetable could not be built from that information.');
      return fail(response, 503, 'The timetable engine is not available right now. Try again in a minute.');
    }
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
    if ((generatedSessions?.length ?? 0) > LIMITS.savedSessions) return fail(response, 400, 'Too many classes in one timetable');
    if (status !== undefined && !STATUSES.includes(status)) {
      return fail(response, 400, `status must be one of ${STATUSES.join(', ')}`);
    }
    const existing = await ownedTimetable(request, request.params.id);
    if (!existing) return notFound(response, 'Timetable');
    const updated = await store.updateTimetableSessions(
      existing.id,
      generatedSessions ?? existing.generatedSessions,
      // A live timetable stays live while it's being adjusted; the Updates screen tracks the changes.
      status ?? (existing.status === 'approved' ? 'approved' : 'edited'),
    );
    response.json(updated);
  }));

  mountNotices(app, { store, route, fail, ownedInstitution, limits, ...(send && { send }) });
  mountMembers(app, { store, route, fail, ownedInstitution });
  mountEvents(app, { store, route, fail, memberAccess, ownedInstitution, limits });
  mountAttendance(app, { store, route, fail, memberAccess });
  mountDevices(app, { store, route, fail, memberAccess, ownedInstitution, limits });
  mountPlatform(app, { store, route, fail });

  app.use('/api', (request, response) => notFound(response, 'Page'));

  // Bad JSON, oversized bodies and malformed URLs arrive here. Never send a stack trace.
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = error.status >= 400 && error.status < 500 ? error.status : 500;
    if (status === 500) console.error(`${request.method} ${request.path}:`, error.stack ?? error.message);
    const message = status === 413 ? 'That is too much data to send at once.' : status === 500 ? 'Something went wrong. Please try again.' : 'That request could not be understood.';
    response.status(status).json({ error: message });
  });

  return app;
};
