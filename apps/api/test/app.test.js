import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createApp } from '../src/app.js';
import { createFileStore } from '../src/db.js';
import { HttpError } from '../src/errors.js';

const SESSION = { id: 's1', subject_id: 'math', teacher_id: 't1', room_id: 'r1', division_id: 'A', kind: 'lecture', day: 'Monday', slot: '09:00-10:00', duration_slots: 1 };
const REQUEST = { days: ['Monday'], slots: ['09:00-10:00'], sessions: [{ ...SESSION, day: undefined, slot: undefined }] };

const okSolve = async () => ({ status: 'ok', scheduled_sessions: [SESSION], unscheduled_sessions: [], diagnostics: [] });
const emptySolve = async () => ({
  status: 'partial',
  scheduled_sessions: [],
  unscheduled_sessions: REQUEST.sessions,
  diagnostics: ['The solver found no placement within the 10s time limit.'],
});

const start = async (t, { solve = okSolve, signIn = true } = {}) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'timesflex-'));
  const store = await createFileStore(path.join(dir, 'data.json'));
  let currentSolve = solve;
  const app = createApp({
    store,
    solve: (payload) => currentSolve(payload),
    parse: async () => ({}),
    aiConfig: () => ({ provider: 'off' }),
    aiStatus: async () => ({}),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  // A tiny cookie jar per client, so tests can act as different users.
  const client = () => {
    let cookie = '';
    return async (method, url, body) => {
      const response = await fetch(base + url, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined || method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return { status: response.status, body: await response.json(), setCookie };
    };
  };
  const anonymous = client();
  const call = client();
  if (signIn) await call('POST', '/api/auth/setup', { username: 'owner', password: 'owner-pass-1' });
  return { call, client, anonymous, store, setSolve: (next) => { currentSolve = next; } };
};

const createGenerated = async (call) => {
  const institution = (await call('POST', '/api/institutions', { name: 'X', type: 'college', profile: { teachers: [1] } })).body;
  const timetable = (await call('POST', `/api/institutions/${institution.id}/timetables`, { request: REQUEST })).body;
  await call('POST', `/api/timetables/${timetable.id}/solve`);
  return { institution, timetable };
};

test('PUT institution without a profile keeps the existing profile', async (t) => {
  const { call } = await start(t);
  const created = (await call('POST', '/api/institutions', { name: 'X', type: 'college', profile: { teachers: ['a'] } })).body;
  const fetched = (await call('GET', `/api/institutions/${created.id}`)).body;

  // Round-tripping the GET shape (profile under `data`) must not wipe it.
  const roundTrip = await call('PUT', `/api/institutions/${created.id}`, fetched);
  assert.deepEqual(roundTrip.body.data, { teachers: ['a'] });

  const renameOnly = await call('PUT', `/api/institutions/${created.id}`, { name: 'Y', type: 'college' });
  assert.equal(renameOnly.body.name, 'Y');
  assert.deepEqual(renameOnly.body.data, { teachers: ['a'] });
});

test('a solve that places nothing keeps the saved sessions', async (t) => {
  const { call, setSolve } = await start(t);
  const { timetable } = await createGenerated(call);
  setSolve(emptySolve);

  const result = await call('POST', `/api/timetables/${timetable.id}/solve`);
  assert.equal(result.status, 200);
  assert.equal(result.body.applied, false);
  assert.equal(result.body.timetable.generatedSessions.length, 1);
  assert.equal(result.body.timetable.status, 'generated');
  assert.equal(result.body.timetable.report.diagnostics.length, 1);
});

test('approved versions are read-only until unapproved', async (t) => {
  const { call } = await start(t);
  const { timetable } = await createGenerated(call);
  const url = `/api/timetables/${timetable.id}`;

  assert.equal((await call('PUT', url, { status: 'approved' })).body.status, 'approved');
  assert.equal((await call('PUT', url, { generatedSessions: [SESSION] })).status, 409);
  assert.equal((await call('POST', `${url}/solve`)).status, 409);
  assert.equal((await call('GET', url)).body.status, 'approved');

  assert.equal((await call('PUT', url, { status: 'edited' })).body.status, 'edited');
  assert.equal((await call('PUT', url, { generatedSessions: [SESSION] })).status, 200);
});

test('drafts and empty timetables cannot be approved; empty PUT is rejected', async (t) => {
  const { call } = await start(t);
  const institution = (await call('POST', '/api/institutions', { name: 'X', type: 'college' })).body;
  const draft = (await call('POST', `/api/institutions/${institution.id}/timetables`, { request: REQUEST })).body;
  const url = `/api/timetables/${draft.id}`;

  assert.equal((await call('PUT', url, { status: 'approved' })).status, 409);
  assert.equal((await call('PUT', url, {})).status, 400);
  assert.equal((await call('PUT', url, { generatedSessions: [] })).body.status, 'edited');
  assert.equal((await call('PUT', url, { status: 'approved' })).status, 409);
});

test('solver failures map to clear HTTP errors without leaking internals', async (t) => {
  const { call, setSolve } = await start(t);
  const { timetable } = await createGenerated(call);
  setSolve(async () => { throw new HttpError(502, 'The scheduling engine is not running.'); });
  const unreachable = await call('POST', `/api/timetables/${timetable.id}/solve`);
  assert.equal(unreachable.status, 502);
  assert.match(unreachable.body.error, /not running/);

  setSolve(async () => { throw new Error('secret stack detail'); });
  const crashed = await call('POST', `/api/timetables/${timetable.id}/solve`);
  assert.equal(crashed.status, 500);
  assert.doesNotMatch(crashed.body.error, /secret/);
});

test('malformed JSON gets a JSON 400', async (t) => {
  const { call } = await start(t);
  const result = await call('POST', '/api/institutions', '{not json');
  assert.equal(result.status, 400);
  assert.match(result.body.error, /not valid JSON/);
});

test('a failed disk write rolls back memory and does not block later writes', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'timesflex-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'data.json');
  const store = await createFileStore(file);
  await store.createInstitution({ name: 'Kept', type: 'college', data: {} });

  // Make the next write fail by putting a directory where the temp file goes.
  await fs.mkdir(`${file}.tmp`);
  await assert.rejects(store.createInstitution({ name: 'Lost', type: 'college', data: {} }));
  assert.deepEqual((await store.listInstitutions()).map((item) => item.name), ['Kept']);

  await fs.rm(`${file}.tmp`, { recursive: true });
  await store.createInstitution({ name: 'Later', type: 'college', data: {} });
  const onDisk = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(onDisk.institutions.map((item) => item.name).sort(), ['Kept', 'Later']);
});


test('fresh install: setup creates the first admin once, then is refused', async (t) => {
  const { anonymous, client } = await start(t, { signIn: false });
  const before = await anonymous('GET', '/api/auth/me');
  assert.equal(before.status, 401);
  assert.equal(before.body.needsSetup, true);

  const setup = await anonymous('POST', '/api/auth/setup', { username: 'Owner', password: 'owner-pass-1' });
  assert.equal(setup.status, 201);
  assert.equal(setup.body.user.role, 'admin');
  assert.match(setup.setCookie, /tf_session=.+HttpOnly/i);
  assert.equal((await anonymous('GET', '/api/auth/me')).body.user.username, 'owner');

  const again = await client()('POST', '/api/auth/setup', { username: 'intruder', password: 'whatever-123' });
  assert.equal(again.status, 409);
  assert.equal((await client()('GET', '/api/auth/me')).body.needsSetup, false);
});

test('every data route needs a signed-in user', async (t) => {
  const { anonymous } = await start(t);
  for (const [method, url] of [
    ['GET', '/api/institutions'],
    ['POST', '/api/institutions'],
    ['GET', '/api/timetables/x'],
    ['POST', '/api/parse'],
    ['GET', '/api/users'],
    ['GET', '/api/ai/status'],
  ]) {
    assert.equal((await anonymous(method, url, {})).status, 401, `${method} ${url}`);
  }
  assert.equal((await anonymous('GET', '/health')).status, 200);
});

test('viewers can read and export but not change anything', async (t) => {
  const { call, client } = await start(t);
  const { institution, timetable } = await createGenerated(call);
  assert.equal((await call('POST', '/api/users', { username: 'staff', password: 'staff-pass-1', role: 'viewer' })).status, 201);

  const viewer = client();
  assert.equal((await viewer('POST', '/api/auth/login', { username: 'staff', password: 'staff-pass-1' })).status, 200);
  assert.equal((await viewer('GET', '/api/institutions')).status, 200);
  assert.equal((await viewer('GET', `/api/timetables/${timetable.id}`)).status, 200);

  for (const [method, url] of [
    ['POST', '/api/institutions'],
    ['PUT', `/api/institutions/${institution.id}`],
    ['DELETE', `/api/institutions/${institution.id}`],
    ['POST', `/api/institutions/${institution.id}/timetables`],
    ['POST', `/api/timetables/${timetable.id}/solve`],
    ['PUT', `/api/timetables/${timetable.id}`],
    ['POST', '/api/parse'],
    ['GET', '/api/users'],
  ]) {
    assert.equal((await viewer(method, url, { status: 'approved', name: 'x', type: 'y' })).status, 403, `${method} ${url}`);
  }
});

test('login: wrong password, disabled users and logout', async (t) => {
  const { call, client } = await start(t);
  const staff = (await call('POST', '/api/users', { username: 'staff', password: 'staff-pass-1' })).body;
  assert.equal(staff.role, 'viewer');

  const viewer = client();
  assert.equal((await viewer('POST', '/api/auth/login', { username: 'staff', password: 'nope-nope' })).status, 401);
  assert.equal((await viewer('POST', '/api/auth/login', { username: 'STAFF', password: 'staff-pass-1' })).status, 200);

  // Disabling a user ends their sessions immediately.
  await call('PATCH', `/api/users/${staff.id}`, { disabled: true });
  assert.equal((await viewer('GET', '/api/institutions')).status, 401);
  assert.equal((await client()('POST', '/api/auth/login', { username: 'staff', password: 'staff-pass-1' })).status, 401);

  assert.equal((await call('POST', '/api/auth/logout')).status, 200);
  assert.equal((await call('GET', '/api/institutions')).status, 401);
});

test('repeated failed logins are throttled', async (t) => {
  const { anonymous } = await start(t);
  for (let i = 0; i < 10; i += 1) {
    await anonymous('POST', '/api/auth/login', { username: 'owner', password: 'wrong-pass' });
  }
  const blocked = await anonymous('POST', '/api/auth/login', { username: 'owner', password: 'owner-pass-1' });
  assert.equal(blocked.status, 429);
});

test('the last active admin cannot be demoted, disabled or deleted', async (t) => {
  const { call } = await start(t);
  const me = (await call('GET', '/api/auth/me')).body.user;
  assert.equal((await call('PATCH', `/api/users/${me.id}`, { role: 'viewer' })).status, 409);
  assert.equal((await call('PATCH', `/api/users/${me.id}`, { disabled: true })).status, 409);
  assert.equal((await call('DELETE', `/api/users/${me.id}`)).status, 409);

  const second = (await call('POST', '/api/users', { username: 'second', password: 'second-pass', role: 'admin' })).body;
  assert.equal((await call('PATCH', `/api/users/${me.id}`, { role: 'viewer' })).status, 200);
  assert.equal((await call('POST', '/api/users', { username: 'second', password: 'again-pass' })).status, 403);
  assert.ok(second.id);
});

test('changing your password signs out other devices', async (t) => {
  const { call, client } = await start(t);
  const laptop = client();
  await laptop('POST', '/api/auth/login', { username: 'owner', password: 'owner-pass-1' });
  assert.equal((await call('POST', '/api/auth/password', { currentPassword: 'bad', newPassword: 'new-pass-123' })).status, 400);
  assert.equal(
    (await call('POST', '/api/auth/password', { currentPassword: 'owner-pass-1', newPassword: 'new-pass-123' })).status,
    200,
  );
  assert.equal((await laptop('GET', '/api/institutions')).status, 401);
  assert.equal((await call('GET', '/api/institutions')).status, 200);
});

test('saving edits can update the unplaced-session report', async (t) => {
  const { call } = await start(t);
  const { timetable } = await createGenerated(call);
  const url = `/api/timetables/${timetable.id}`;
  const report = { unscheduledSessions: [], diagnostics: ['placed by hand'] };
  const saved = await call('PUT', url, { generatedSessions: [SESSION], report });
  assert.deepEqual(saved.body.report, report);
  assert.equal((await call('PUT', url, { generatedSessions: [SESSION], report: { nope: 1 } })).status, 400);
});

test('the audit log records who did what, and only admins can read it', async (t) => {
  const { call, client } = await start(t);
  await createGenerated(call);
  await call('POST', '/api/users', { username: 'staff', password: 'staff-pass-1' });
  await client()('POST', '/api/auth/login', { username: 'staff', password: 'wrong-one' });

  const entries = (await call('GET', '/api/audit')).body;
  const actions = entries.map((entry) => entry.action);
  for (const action of ['auth.setup', 'institution.created', 'timetable.created', 'timetable.solved', 'user.created', 'auth.login_failed']) {
    assert.ok(actions.includes(action), `missing ${action} in ${actions}`);
  }
  assert.equal(entries.find((entry) => entry.action === 'institution.created').username, 'owner');
  assert.equal(entries[0].action, 'auth.login_failed');

  const viewer = client();
  await viewer('POST', '/api/auth/login', { username: 'staff', password: 'staff-pass-1' });
  assert.equal((await viewer('GET', '/api/audit')).status, 403);
});

test('only one AI parse runs at a time', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'timesflex-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let release;
  const app = createApp({
    store: await createFileStore(path.join(dir, 'data.json')),
    solve: okSolve,
    parse: () => new Promise((resolve) => { release = () => resolve({ draft: {} }); }),
    aiConfig: () => ({ provider: 'off' }),
    aiStatus: async () => ({}),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const setup = await fetch(`${base}/api/auth/setup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'owner-pass-1' }),
  });
  const headers = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
  const body = JSON.stringify({ text: 'hello' });
  const first = fetch(`${base}/api/parse`, { method: 'POST', headers, body });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const second = await fetch(`${base}/api/parse`, { method: 'POST', headers, body });
  assert.equal(second.status, 429);
  release();
  assert.equal((await first).status, 200);
});

test('bad institution and timetable data is rejected with a clear message', async (t) => {
  const { call } = await start(t);
  assert.equal((await call('POST', '/api/institutions', { name: 'X', type: 'spaceship' })).status, 400);
  assert.equal((await call('POST', '/api/institutions', { name: 'X', type: 'college', profile: { teachers: 'nope' } })).status, 400);
  const institution = (await call('POST', '/api/institutions', { name: 'X', type: 'college' })).body;
  const url = `/api/institutions/${institution.id}/timetables`;
  const duplicate = await call('POST', url, { request: { ...REQUEST, sessions: [REQUEST.sessions[0], REQUEST.sessions[0]] } });
  assert.equal(duplicate.status, 400);
  assert.match(duplicate.body.error, /duplicate/);
  const missing = await call('POST', url, { request: { ...REQUEST, sessions: [{ id: 'x' }] } });
  assert.match(missing.body.error, /subject_id is required/);
  assert.equal((await call('POST', url, { request: { ...REQUEST, days: ['Monday', 'Monday'] } })).status, 400);
});
