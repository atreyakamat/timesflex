// White box: written by reading the code and the coverage report, to reach every branch that
// ordinary use doesn't: failures from outside services, limits, and the operator's scripts.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import { createJobSlots, createRateLimiter, hashPassword, verifyPassword } from '../src/auth.js';
import { createFileStore } from '../src/db.js';
import { eventProblem } from '../src/events.js';
import { aiConfig, aiStatus, completeJson, extractJson } from '../src/llm.js';
import { SolverRejectedError, solveWithSolver } from '../src/solverClient.js';
import { LIMITS, cleanContext, cleanText, timetableRequestProblem } from '../src/validate.js';
import { sendWhatsAppTemplate, statusesIn, toWhatsAppNumber, validSignature, whatsappEnabled } from '../src/whatsapp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(path.join(os.tmpdir(), 'timesflex-white-'));
const savedEnv = { ...process.env };
const realFetch = globalThis.fetch;
test.after(() => {
  process.env = savedEnv;
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
});

/** Answers outside services from a script; anything local goes to the real test server. */
const stubFetch = (handler) => {
  globalThis.fetch = async (url, options) => {
    const text = String(url);
    if (text.startsWith('http://127.0.0.1:') && !text.includes(':8000') && !text.includes(':11434') && !text.includes(':1234')) return realFetch(url, options);
    return handler(text, options);
  };
};
const reply = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

/* ---------- Validation ---------- */

test('cleanText: wrong types, blanks and overlong text are refused', () => {
  assert.equal(cleanText(5, 10), null);
  assert.equal(cleanText('   ', 10), null);
  assert.equal(cleanText('x'.repeat(11), 10), null);
  assert.equal(cleanText('  ok ', 10), 'ok');
});

test('cleanContext keeps only short strings from real lists', () => {
  assert.deepEqual(cleanContext(undefined), { teachers: [], subjects: [], classes: [], rooms: [] });
  const c = cleanContext({ teachers: ['a', 5, null, 'x'.repeat(300)], subjects: 'nope' });
  assert.deepEqual(c.teachers, ['a', 'x'.repeat(160)]);
  assert.deepEqual(c.subjects, []);
  assert.equal(cleanContext({ rooms: Array(500).fill('r') }).rooms.length, 200);
});

test('timetableRequestProblem names each limit', () => {
  const ok = { days: [], slots: [], sessions: [] };
  assert.equal(timetableRequestProblem(ok), null);
  assert.match(timetableRequestProblem(null), /required/);
  assert.match(timetableRequestProblem([]), /required/);
  assert.match(timetableRequestProblem({ days: 'x', slots: [], sessions: [] }), /required/);
  assert.match(timetableRequestProblem({ ...ok, days: Array(8).fill('d') }), /days/);
  assert.match(timetableRequestProblem({ ...ok, slots: Array(LIMITS.slots + 1).fill('s') }), /periods/);
  assert.match(timetableRequestProblem({ ...ok, sessions: Array(LIMITS.sessions + 1).fill({}) }), /classes/);
  assert.match(timetableRequestProblem({ ...ok, rooms: Array(LIMITS.listItems + 1).fill({}) }), /rooms/);
  assert.match(timetableRequestProblem({ ...ok, teacher_constraints: Array(LIMITS.listItems + 1).fill({}) }), /teachers/);
  for (const seconds of [0, -1, 31, 'ten', Number.NaN]) assert.match(timetableRequestProblem({ ...ok, time_limit_seconds: seconds }), /seconds/);
  assert.equal(timetableRequestProblem({ ...ok, time_limit_seconds: 30 }), null);
});

test('eventProblem: time zone slack at both ends of the allowed dates', () => {
  const now = Date.UTC(2026, 10, 9, 12);
  const mark = (date) => eventProblem({ kind: 'late', date }, now);
  assert.equal(mark('2026-11-10'), null, 'tomorrow is allowed: the college may be ahead of the server');
  assert.match(mark('2026-11-11'), /future/);
  assert.equal(mark('2026-09-10'), null);
  assert.match(mark('2026-09-09'), /60 days/);
  assert.match(mark('2026-13-45'), /valid date/);
  assert.match(mark(20261109), /valid date/);
  assert.match(eventProblem({ kind: 'late', date: '2026-11-09', slot: 'x'.repeat(41) }, now), /period/);
  assert.match(eventProblem({ kind: 'late', date: '2026-11-09', slot: 5 }, now), /period/);
  assert.equal(eventProblem({ kind: 'outside', date: '2026-11-09', minutesLate: 9999 }, now), null, 'minutes only matter for late');
});

/* ---------- Limiters ---------- */

test('rate limiter: windows expire, take stops at the limit, and fake keys can’t fill memory', async () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 40 });
  assert.equal(limiter.take('a'), true);
  assert.equal(limiter.take('a'), true);
  assert.equal(limiter.take('a'), false);
  assert.equal(limiter.blocked('a'), true);
  limiter.reset('a');
  assert.equal(limiter.blocked('a'), false);
  limiter.fail('b');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(limiter.blocked('b'), false);

  const flood = createRateLimiter({ limit: 1, windowMs: 60000 });
  for (let i = 0; i < 10050; i += 1) flood.fail(`key${i}`);
  // Live keys over the cap get cleared, which is a brief reset, not an unbounded map.
  assert.equal(flood.blocked('key0'), false);
  assert.equal(flood.blocked('key10049'), true);
});

test('job slots: runs a few at once, queues some, refuses the rest, and survives failures', async () => {
  const slots = createJobSlots({ active: 1, waiting: 1 });
  let release;
  const first = slots.run(() => new Promise((r) => { release = r; }));
  const second = slots.run(async () => 'second');
  await assert.rejects(slots.run(async () => 'third'), (e) => e.busy === true);
  release('first');
  assert.equal(await first, 'first');
  assert.equal(await second, 'second');
  await assert.rejects(slots.run(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await slots.run(async () => 'still works'), 'still works');
});

test('a tampered password record never verifies', async () => {
  assert.equal(await verifyPassword('x', 'plain-text'), false);
  assert.equal(await verifyPassword('x', null), false);
  assert.equal(await verifyPassword('x', 'scrypt$abc'), false);
  assert.equal(await verifyPassword('x', 'md5$abc$def'), false);
  assert.equal(await verifyPassword('right', await hashPassword('right')), true);
});

/* ---------- Outside services failing ---------- */

test('solver client: accepted, refused and broken replies', async () => {
  stubFetch(async () => reply(200, { status: 'ok' }));
  assert.deepEqual(await solveWithSolver({}), { status: 'ok' });
  stubFetch(async () => reply(422, { detail: 'bad' }));
  await assert.rejects(solveWithSolver({}), SolverRejectedError);
  stubFetch(async () => reply(500, 'oops'));
  await assert.rejects(solveWithSolver({}), /500/);
});

test('AI settings: provider follows the key, and can be forced', () => {
  delete process.env.AI_PROVIDER;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_MODEL;
  assert.equal(aiConfig().provider, 'ollama');
  assert.equal(aiConfig().model, 'qwen2.5:0.5b');
  process.env.ANTHROPIC_API_KEY = 'k';
  assert.equal(aiConfig().provider, 'anthropic');
  process.env.AI_PROVIDER = 'OFF';
  assert.equal(aiConfig().provider, 'off');
  delete process.env.ANTHROPIC_API_KEY;
});

test('AI status: off, ollama up, model missing, unreachable, and OpenAI-style servers', async () => {
  process.env.AI_PROVIDER = 'off';
  assert.equal((await aiStatus()).reachable, false);
  await assert.rejects(completeJson({ system: '', user: '', schema: {} }), /disabled/);

  process.env.AI_PROVIDER = 'ollama';
  process.env.AI_BASE_URL = 'http://127.0.0.1:11434';
  process.env.AI_MODEL = 'm';
  stubFetch(async () => reply(200, { models: [{ name: 'm:latest' }] }));
  assert.equal((await aiStatus()).modelAvailable, true);
  stubFetch(async () => reply(200, { models: [{ name: 'other' }] }));
  const missing = await aiStatus();
  assert.equal(missing.modelAvailable, false);
  assert.match(missing.error, /not installed/);
  stubFetch(async () => { throw new Error('refused'); });
  assert.match((await aiStatus()).error, /Cannot reach/);

  process.env.AI_PROVIDER = 'openai';
  process.env.AI_BASE_URL = 'http://127.0.0.1:1234/v1';
  stubFetch(async () => reply(200, { data: [{ id: 'x' }] }));
  assert.equal((await aiStatus()).modelAvailable, true, 'these servers serve whatever is loaded');
  delete process.env.AI_BASE_URL;
  delete process.env.AI_MODEL;
  delete process.env.AI_PROVIDER;
});

test('asking a model: ollama, a retry without thinking, other errors, and OpenAI-style', async () => {
  process.env.AI_PROVIDER = 'ollama';
  process.env.AI_BASE_URL = 'http://127.0.0.1:11434';
  stubFetch(async () => reply(200, { message: { content: '{"a":1}' } }));
  assert.deepEqual(await completeJson({ system: 's', user: 'u', schema: {} }), { a: 1 });

  let calls = 0;
  stubFetch(async (url, options) => {
    calls += 1;
    const body = JSON.parse(options.body);
    if (body.think !== undefined) return reply(400, 'model does not support think');
    return reply(200, { message: { content: '{"b":2}' } });
  });
  assert.deepEqual(await completeJson({ system: 's', user: 'u', schema: {} }), { b: 2 });
  assert.equal(calls, 2);

  stubFetch(async () => reply(500, 'crashed'));
  await assert.rejects(completeJson({ system: 's', user: 'u', schema: {} }), /500/);

  process.env.AI_PROVIDER = 'openai';
  process.env.AI_BASE_URL = 'http://127.0.0.1:1234/v1';
  stubFetch(async () => reply(200, { choices: [{ message: { content: '<think>hm</think>```json\n{"c":3}\n```' } }] }));
  assert.deepEqual(await completeJson({ system: 's', user: 'u', schema: {} }), { c: 3 });
  delete process.env.AI_BASE_URL;
  delete process.env.AI_PROVIDER;
});

test('reading model replies: JSON inside chatter, and no JSON at all', () => {
  assert.deepEqual(extractJson('Sure! {"x":1} done'), { x: 1 });
  assert.throws(() => extractJson('no json here'), /no JSON/);
  assert.throws(() => extractJson(undefined), /no JSON/);
});

test('WhatsApp sending: success, throttling, other refusals, and flattened template values', async () => {
  process.env.WHATSAPP_TOKEN = 'secret-token';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
  assert.equal(whatsappEnabled(), true);
  let sent;
  stubFetch(async (url, options) => {
    sent = { url, options };
    return reply(200, { messages: [{ id: 'wamid.1' }] });
  });
  assert.equal(await sendWhatsAppTemplate({ to: '+919876543210', name: 'A', institution: 'B', summary: 'line one\n\nline   two' }), 'wamid.1');
  const body = JSON.parse(sent.options.body);
  assert.match(sent.url, /123\/messages$/);
  assert.equal(sent.options.headers.Authorization, 'Bearer secret-token');
  assert.equal(body.template.components[0].parameters[2].text, 'line one line two');
  assert.equal(body.to, '+919876543210');

  stubFetch(async () => reply(400, { error: { code: 131056, message: 'pair rate' } }));
  await assert.rejects(sendWhatsAppTemplate({ to: 'x', name: '', institution: '', summary: '' }), /Too many messages/);
  stubFetch(async () => reply(401, { error: { code: 190, message: 'token secret-token expired' } }));
  await assert.rejects(sendWhatsAppTemplate({ to: 'x', name: '', institution: '', summary: '' }), (e) => /did not accept/.test(e.message) && !e.message.includes('secret-token'));
  stubFetch(async () => reply(200, {}));
  await assert.rejects(sendWhatsAppTemplate({ to: 'x', name: '', institution: '', summary: '' }), /did not accept/);
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  assert.equal(whatsappEnabled(), false);
});

test('webhook checks: no secret, wrong format, wrong length, and right signature', () => {
  delete process.env.WHATSAPP_APP_SECRET;
  assert.equal(validSignature(Buffer.from('x'), 'sha256=abc'), false, 'no secret configured means nothing is trusted');
  process.env.WHATSAPP_APP_SECRET = 's';
  const good = crypto.createHmac('sha256', 's').update('x').digest('hex');
  assert.equal(validSignature(Buffer.from('x'), `sha256=${good}`), true);
  assert.equal(validSignature(Buffer.from('y'), `sha256=${good}`), false);
  assert.equal(validSignature(Buffer.from('x'), good), false);
  assert.equal(validSignature(Buffer.from('x'), 'sha256=short'), false);
  assert.equal(validSignature(Buffer.from('x'), undefined), false);
  delete process.env.WHATSAPP_APP_SECRET;
});

test('webhook payloads: odd shapes are ignored, not fatal', () => {
  for (const junk of [null, {}, { entry: 'x' }, { entry: [{}] }, { entry: [{ changes: 'y' }] }, { entry: [{ changes: [{ value: {} }] }] }, { entry: [{ changes: [{ value: { statuses: [{ id: 5 }, {}] } }] }] }]) assert.deepEqual(statusesIn(junk), []);
  assert.equal(toWhatsAppNumber('1234567890123456'), null);
});

/* ---------- The API when things go wrong ---------- */

const appWith = async (options = {}) => {
  const store = await createFileStore(path.join(mkdtempSync(path.join(dir, 'a-')), 'data.json'));
  const server = createApp({ store, solve: async () => ({ status: 'ok', scheduled_sessions: [], unscheduled_sessions: [] }), ...options }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { body, token, raw } = {}) => {
    const response = await realFetch(`${base}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Not JSON.
    }
    return { status: response.status, body: json, text };
  };
  const signup = async () => (await call('POST', '/api/auth/signup', { body: { name: 'N', email: `n${crypto.randomUUID()}@example.test`, password: 'password-1234', institutionName: 'C' } })).body;
  return { store, server, call, signup };
};
const REQUEST = { days: ['Monday'], slots: ['a'], sessions: [] };
const timetableFor = async (t, me) => (await t.call('POST', `/api/institutions/${me.institution.id}/timetables`, { token: me.token, body: { label: 'V', request: REQUEST } })).body;

test('a solver that refuses the job, breaks, or is too busy gives a plain answer, with no internals', async (context) => {
  for (const [error, status, words] of [
    [new SolverRejectedError('Solver refused: pydantic detail'), 400, /could not be built/],
    [new Error('connect ECONNREFUSED 127.0.0.1:8000'), 503, /not available/],
    [Object.assign(new Error('busy'), { busy: true }), 503, /busy/],
  ]) {
    const t = await appWith({ solve: async () => { throw error; } });
    context.after(() => t.server.close());
    const me = await t.signup();
    const tt = await timetableFor(t, me);
    const r = await t.call('POST', `/api/timetables/${tt.id}/solve`, { token: me.token });
    assert.equal(r.status, status);
    assert.match(r.body.error, words);
    assert.doesNotMatch(r.text, /ECONNREFUSED|pydantic|127\.0\.0\.1/);
  }
});

test('an unexpected crash in a route says nothing about why', async (context) => {
  const t = await appWith();
  context.after(() => t.server.close());
  const me = await t.signup();
  t.store.listTimetables = async () => { throw new Error('SELECT secret FROM users failed'); };
  const original = console.error;
  console.error = () => {};
  const r = await t.call('GET', `/api/institutions/${me.institution.id}/timetables`, { token: me.token });
  console.error = original;
  assert.equal(r.status, 500);
  assert.doesNotMatch(r.text, /secret|SELECT/);
});

test('solve and assistant limits per account', async (context) => {
  const t = await appWith({ limits: { solve: createRateLimiter({ limit: 1 }), ai: createRateLimiter({ limit: 1 }) } });
  context.after(() => t.server.close());
  process.env.AI_PROVIDER = 'off';
  const me = await t.signup();
  const tt = await timetableFor(t, me);
  assert.equal((await t.call('POST', `/api/timetables/${tt.id}/solve`, { token: me.token })).status, 200);
  assert.equal((await t.call('POST', `/api/timetables/${tt.id}/solve`, { token: me.token })).status, 429);
  assert.equal((await t.call('POST', '/api/agent/interpret', { token: me.token, body: { text: 'hi' } })).status, 200);
  assert.equal((await t.call('POST', '/api/parse', { token: me.token, body: { text: 'hi' } })).status, 429);
  assert.equal((await t.call('POST', '/api/parse', { token: me.token, body: { text: '' } })).status, 400);
  delete process.env.AI_PROVIDER;
});

test('marks, invites and sign-ups each have limits', async (context) => {
  const t = await appWith({ limits: { events: createRateLimiter({ limit: 1 }), signup: createRateLimiter({ limit: 2 }) } });
  context.after(() => t.server.close());
  const me = await t.signup();
  await t.call('PUT', `/api/institutions/${me.institution.id}`, { token: me.token, body: { name: 'C', type: 'college', profile: { divisions: [{ id: 'd', name: 'D', students: [{ id: 's', name: 'S', rollNo: '1' }] }] } } });
  const today = new Date().toISOString().slice(0, 10);
  const mark = () => t.call('POST', `/api/institutions/${me.institution.id}/events`, { token: me.token, body: { studentId: 's', kind: 'bunked', date: today } });
  assert.equal((await mark()).status, 201);
  assert.equal((await mark()).status, 429);
  await t.signup();
  const third = await t.call('POST', '/api/auth/signup', { body: { name: 'N', email: `n${crypto.randomUUID()}@example.test`, password: 'password-1234', institutionName: 'C' } });
  assert.equal(third.status, 429);
  assert.equal((await t.call('POST', '/api/auth/demo', { body: {} })).status, 429);
});

test('the demo can be switched off, and the demo domain can’t be claimed by joining', async (context) => {
  const t = await appWith();
  context.after(() => t.server.close());
  process.env.ALLOW_DEMO = 'false';
  assert.equal((await t.call('POST', '/api/auth/demo', { body: {} })).status, 404);
  delete process.env.ALLOW_DEMO;
  const me = await t.signup();
  await t.call('PUT', `/api/institutions/${me.institution.id}`, { token: me.token, body: { name: 'C', type: 'college', profile: { teachers: [{ id: 't', name: 'T' }] } } });
  const { body: invite } = await t.call('POST', `/api/institutions/${me.institution.id}/invites`, { token: me.token, body: { teacherId: 't' } });
  const r = await t.call('POST', '/api/auth/join', { body: { code: invite.code, name: 'X', email: 'x@demo.timeflex.app', password: 'password-1234' } });
  assert.equal(r.status, 400);
});

test('an expired invite is refused, and shows as expired to the admin', async (context) => {
  const t = await appWith();
  context.after(() => t.server.close());
  const me = await t.signup();
  await t.call('PUT', `/api/institutions/${me.institution.id}`, { token: me.token, body: { name: 'C', type: 'college', profile: { teachers: [{ id: 't', name: 'T' }] } } });
  const { body: invite } = await t.call('POST', `/api/institutions/${me.institution.id}/invites`, { token: me.token, body: { teacherId: 't' } });
  const stored = (await t.store.listInvites(me.institution.id))[0];
  stored.expiresAt = new Date(Date.now() - 1000).toISOString();
  // The file store hands out copies, so write it back through its own state by re-adding.
  await t.store.deleteInvite(stored.id, me.institution.id);
  await t.store.createInvite(stored);
  assert.equal((await t.call('GET', `/api/auth/invite/${invite.code}`)).status, 410);
  assert.equal((await t.call('POST', '/api/auth/join', { body: { code: invite.code, name: 'X', email: `x${crypto.randomUUID()}@example.test`, password: 'password-1234' } })).status, 410);
  assert.equal((await t.call('GET', `/api/institutions/${me.institution.id}/invites`, { token: me.token })).body[0].status, 'expired');
});

test('two people racing for one invite: the loser’s new account is cleaned up', async (context) => {
  const t = await appWith();
  context.after(() => t.server.close());
  const me = await t.signup();
  await t.call('PUT', `/api/institutions/${me.institution.id}`, { token: me.token, body: { name: 'C', type: 'college', profile: { teachers: [{ id: 't', name: 'T' }] } } });
  const { body: invite } = await t.call('POST', `/api/institutions/${me.institution.id}/invites`, { token: me.token, body: { teacherId: 't' } });
  const emails = [`a${crypto.randomUUID()}@example.test`, `b${crypto.randomUUID()}@example.test`];
  const results = await Promise.all(emails.map((email) => t.call('POST', '/api/auth/join', { body: { code: invite.code, name: 'X', email, password: 'password-1234' } })));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 410]);
  const members = await t.call('GET', `/api/institutions/${me.institution.id}/members`, { token: me.token });
  assert.equal(members.body.filter((m) => m.role === 'teacher').length, 1);
  const loser = emails[results.findIndex((r) => r.status === 410)];
  assert.ok(!(await t.store.getAccountByEmail(loser)), 'no orphan account left behind');
});

test('joining with an e-mail that appears mid-way is reported, not a crash', async (context) => {
  const t = await appWith();
  context.after(() => t.server.close());
  const me = await t.signup();
  await t.call('PUT', `/api/institutions/${me.institution.id}`, { token: me.token, body: { name: 'C', type: 'college', profile: { teachers: [{ id: 't', name: 'T' }] } } });
  const { body: invite } = await t.call('POST', `/api/institutions/${me.institution.id}/invites`, { token: me.token, body: { teacherId: 't' } });
  const email = `dup${crypto.randomUUID()}@example.test`;
  const realGet = t.store.getAccountByEmail;
  t.store.getAccountByEmail = async () => null;
  await t.store.createAccount({ name: 'First', email, passwordHash: 'x' });
  const r = await t.call('POST', '/api/auth/join', { body: { code: invite.code, name: 'X', email, password: 'password-1234' } });
  t.store.getAccountByEmail = realGet;
  assert.equal(r.status, 409);
});

test('too many wrong passwords on an invite or password change get limited', async (context) => {
  const t = await appWith({ loginLimiter: createRateLimiter({ limit: 1 }) });
  context.after(() => t.server.close());
  const me = await t.signup();
  assert.equal((await t.call('POST', '/api/auth/password', { token: me.token, body: { current: 'wrong', next: 'password-5678' } })).status, 403);
  assert.equal((await t.call('POST', '/api/auth/password', { token: me.token, body: { current: 'password-1234', next: 'password-5678' } })).status, 429);
  assert.equal((await t.call('DELETE', '/api/auth/account', { token: me.token, body: { password: 'wrong' } })).status, 403);
  assert.equal((await t.call('DELETE', '/api/auth/account', { token: me.token, body: { password: 'password-1234' } })).status, 429);
});

test('changing a password checks the new one', async (context) => {
  const t = await appWith();
  context.after(() => t.server.close());
  const me = await t.signup();
  for (const next of ['short', 'p'.repeat(500), 5]) assert.equal((await t.call('POST', '/api/auth/password', { token: me.token, body: { current: 'password-1234', next } })).status, 400);
  assert.equal((await t.call('POST', '/api/auth/password', { token: me.token, body: { current: 5, next: 'password-5678' } })).status, 403);
});

test('saving hand edits: wrong types, too many, and bad status', async (context) => {
  const t = await appWith();
  context.after(() => t.server.close());
  const me = await t.signup();
  const tt = await timetableFor(t, me);
  const put = (body) => t.call('PUT', `/api/timetables/${tt.id}`, { token: me.token, body });
  assert.equal((await put({ generatedSessions: 'x' })).status, 400);
  assert.equal((await put({ generatedSessions: Array(LIMITS.savedSessions + 1).fill({}) })).status, 400);
  assert.equal((await put({ status: 'done' })).status, 400);
  assert.equal((await t.call('PUT', '/api/timetables/none', { token: me.token, body: {} })).status, 404);
  assert.equal((await t.call('POST', '/api/timetables/none/solve', { token: me.token })).status, 404);
  assert.equal((await t.call('GET', '/api/timetables/none', { token: me.token })).status, 404);
  assert.equal((await t.call('POST', `/api/institutions/${me.institution.id}/timetables`, { token: me.token, body: { request: { days: 'x' } } })).status, 400);
  assert.equal((await t.call('POST', '/api/institutions/none/timetables', { token: me.token, body: { request: REQUEST } })).status, 404);
  assert.equal((await t.call('GET', '/api/institutions/none/timetables', { token: me.token })).status, 404);
});

test('old unapproved versions make way, and approved ones are always kept', async (context) => {
  const t = await appWith();
  context.after(() => t.server.close());
  const me = await t.signup();
  const first = await timetableFor(t, me);
  await t.call('PUT', `/api/timetables/${first.id}`, { token: me.token, body: { status: 'approved' } });
  const second = await timetableFor(t, me);
  await t.store.pruneTimetables(me.institution.id, 0);
  const left = await t.store.listTimetables(me.institution.id);
  assert.ok(left.some((x) => x.id === first.id));
  assert.ok(!left.some((x) => x.id === second.id));
});

test('institution routes check input and ownership', async (context) => {
  const t = await appWith();
  context.after(() => t.server.close());
  const me = await t.signup();
  const id = me.institution.id;
  assert.equal((await t.call('GET', '/api/institutions', { token: me.token })).body.length, 1);
  assert.equal((await t.call('PUT', '/api/institutions/none', { token: me.token, body: { name: 'C', type: 'college' } })).status, 404);
  assert.equal((await t.call('PUT', `/api/institutions/${id}`, { token: me.token, body: { name: '', type: 'college' } })).status, 400);
  assert.equal((await t.call('PUT', `/api/institutions/${id}`, { token: me.token, body: { name: 'C', type: 'x' } })).status, 400);
  assert.equal((await t.call('PUT', '/api/institutions/none/operations', { token: me.token, body: {} })).status, 404);
  assert.equal((await t.call('PUT', `/api/institutions/${id}/operations`, { token: me.token, body: { absences: 'x' } })).status, 400);
  assert.equal((await t.call('DELETE', '/api/institutions/none', { token: me.token })).status, 404);
  assert.equal((await t.call('DELETE', '/api/institutions/none/history', { token: me.token })).status, 404);
  assert.equal((await t.call('DELETE', `/api/institutions/${id}/history`, { token: me.token })).status, 200);
  for (let i = 0; i < 4; i += 1) assert.equal((await t.call('POST', '/api/institutions', { token: me.token, body: { name: 'C', type: 'college' } })).status, 201);
  assert.equal((await t.call('POST', '/api/institutions', { token: me.token, body: { name: 'C', type: 'college' } })).status, 409);
  assert.equal((await t.call('DELETE', `/api/institutions/${id}`, { token: me.token })).status, 200);
});

test('malformed JSON and a malformed address get clean refusals, and unknown routes a 404', async (context) => {
  const t = await appWith();
  context.after(() => t.server.close());
  const me = await t.signup();
  assert.equal((await t.call('POST', '/api/auth/login', { raw: '{' })).status, 400);
  assert.equal((await t.call('POST', '/api/parse', { token: me.token, raw: '{' })).status, 400);
  assert.equal((await t.call('GET', '/api/institutions/%E0%A4%A', { token: me.token })).status, 400);
  assert.equal((await t.call('GET', '/api/nothing-here', { token: me.token })).status, 404);
  assert.equal((await t.call('POST', '/api/auth/login', { raw: JSON.stringify({ email: 'a'.repeat(40000) }) })).status, 413);
});

test('CORS: open in development, closed to other sites once configured', async (context) => {
  const t = await appWith();
  context.after(() => t.server.close());
  const base = `http://127.0.0.1:${t.server.address().port}/health`;
  const allow = async () => (await realFetch(base, { headers: { Origin: 'https://evil.example' } })).headers.get('access-control-allow-origin');
  assert.equal(await allow(), '*');
  process.env.CORS_ORIGINS = 'https://good.example';
  const closed = await appWith();
  context.after(() => closed.server.close());
  delete process.env.CORS_ORIGINS;
  const res = await realFetch(`http://127.0.0.1:${closed.server.address().port}/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

/* ---------- Operator scripts ---------- */

test('the operator’s scripts work, and fail clearly', async () => {
  const dataFile = path.join(dir, 'scripts.json');
  const store = await createFileStore(dataFile);
  await store.createAccount({ name: 'Op', email: 'op@example.test', passwordHash: await hashPassword('old-password-1') });
  const run = (script, ...args) => {
    try {
      return { ok: true, out: execFileSync(process.execPath, [path.join(here, '../src', script), ...args], { env: { ...process.env, DATABASE_URL: '', DATA_FILE: dataFile }, encoding: 'utf8', stdio: 'pipe' }) };
    } catch (error) {
      return { ok: false, out: `${error.stdout}${error.stderr}` };
    }
  };
  assert.match(run('make-central-admin.js', 'op@example.test').out, /now a central admin/);
  assert.equal((await (await createFileStore(dataFile)).getAccountByEmail('op@example.test')).platformAdmin, true);
  assert.match(run('make-central-admin.js', 'op@example.test', '--remove').out, /no longer/);
  assert.equal(run('make-central-admin.js').ok, false);
  assert.match(run('make-central-admin.js', 'nobody@example.test').out, /No account/);

  const reset = run('reset-password.js', 'op@example.test');
  const temporary = /: (\S+)\n/.exec(reset.out)[1];
  const account = await (await createFileStore(dataFile)).getAccountByEmail('op@example.test');
  assert.equal(await verifyPassword(temporary, account.passwordHash), true);
  assert.equal(await verifyPassword('old-password-1', account.passwordHash), false);
  assert.equal(run('reset-password.js').ok, false);
  assert.match(run('reset-password.js', 'nobody@example.test').out, /No account/);
});

test('the file store’s tidying: expired sessions, and only old demo accounts', async () => {
  const store = await createFileStore(path.join(dir, 'tidy.json'));
  const a = await store.createAccount({ name: 'A', email: 'a@demo.timeflex.app', passwordHash: 'x' });
  await store.createAccount({ name: 'B', email: 'b@example.test', passwordHash: 'x' });
  await store.createSession({ tokenHash: 'old', accountId: a.id, expiresAt: new Date(Date.now() - 1000) });
  await store.deleteExpiredSessions();
  assert.equal(await store.getSession('old'), null);
  assert.deepEqual(await store.listDemoAccountIds('@demo.timeflex.app', new Date(Date.now() + 1000).toISOString()), [a.id]);
  assert.deepEqual(await store.listDemoAccountIds('@demo.timeflex.app', new Date(0).toISOString()), []);
});
