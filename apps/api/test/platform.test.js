// Integration: the central admin panel, across all colleges.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createApp } from '../src/app.js';
import { createFileStore, createPgStore } from '../src/db.js';
import { collegeStage } from '../src/platform.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'timesflex-platform-'));
const store = process.env.TEST_DATABASE_URL ? await createPgStore(process.env.TEST_DATABASE_URL) : await createFileStore(path.join(dir, 'data.json'));
const server = createApp({ store, solve: async () => ({}) }).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const saved = { ...process.env };

test.after(async () => {
  server.close();
  process.env = saved;
  await store.close?.();
  rmSync(dir, { recursive: true, force: true });
});

const call = async (method, url, { body, token } = {}) => {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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
let n = Date.now();
const PASSWORD = 'password-1234';
const signup = async (institutionName = 'Self Serve College') => {
  const email = `u${(n += 1)}@example.test`;
  const { body } = await call('POST', '/api/auth/signup', { body: { name: 'U', email, password: PASSWORD, institutionName } });
  return { token: body.token, id: body.institution?.id, accountId: body.account.id, email };
};
const operator = async () => {
  const me = await signup('Operator College');
  await store.setPlatformAdmin(me.accountId, true);
  return me;
};

test('being a central admin is not something a request can claim', async () => {
  const email = `u${(n += 1)}@example.test`;
  const r = await call('POST', '/api/auth/signup', { body: { name: 'U', email, password: PASSWORD, institutionName: 'X', platformAdmin: true, role: 'admin' } });
  assert.equal(r.body.account.platformAdmin, false);
  assert.equal((await call('GET', '/api/platform/colleges', { token: r.body.token })).status, 404);
});

test('the panel doesn’t exist for anyone else, signed in or not', async () => {
  const user = await signup();
  const urls = [['GET', '/api/platform/colleges'], ['POST', '/api/platform/colleges'], ['PUT', `/api/platform/colleges/${user.id}`], ['POST', `/api/platform/colleges/${user.id}/invite`]];
  for (const [method, url] of urls) {
    const body = method === 'GET' ? undefined : {};
    assert.equal((await call(method, url, { token: user.token, body })).status, 404, url);
    assert.equal((await call(method, url, { body })).status, 401, url);
  }
});

test('a central admin is told so, and sees every college with counts', async () => {
  const op = await operator();
  const user = await signup('Listed College');
  await call('PUT', `/api/institutions/${user.id}`, {
    token: user.token,
    body: { name: 'Listed College', type: 'college', profile: { teachers: [{ id: 't' }], subjects: [{ id: 's' }, { id: 's2' }], divisions: [{ id: 'd', students: [{ id: 'a' }, { id: 'b' }] }, { id: 'e', size: 40 }], rooms: [{ id: 'r' }] } },
  });
  assert.equal((await call('GET', '/api/auth/me', { token: op.token })).body.account.platformAdmin, true);
  const list = await call('GET', '/api/platform/colleges', { token: op.token });
  assert.equal(list.status, 200);
  const row = list.body.find((c) => c.id === user.id);
  assert.equal(row.name, 'Listed College');
  assert.equal(row.adminEmail, user.email);
  assert.equal(row.status, 'active');
  assert.deepEqual(row.counts, { classes: 2, teachers: 1, subjects: 2, students: 42, rooms: 1, members: 1 });
  assert.equal(row.stage, 'ready');
});

test('the panel shows counts and progress, never student or teacher details', async () => {
  const op = await operator();
  const user = await signup('Private College');
  await call('PUT', `/api/institutions/${user.id}`, {
    token: user.token,
    body: { name: 'Private College', type: 'college', profile: { teachers: [{ id: 't', name: 'Secret Teacher', phone: '9000000000' }], divisions: [{ id: 'd', students: [{ id: 'a', name: 'Secret Student' }] }] } },
  });
  const list = await call('GET', '/api/platform/colleges', { token: op.token });
  assert.doesNotMatch(list.text, /Secret|9000000000|passwordHash|password_hash/);
  // And a central admin isn't a member of anyone's college.
  assert.equal((await call('GET', `/api/institutions/${user.id}`, { token: op.token })).status, 404);
});

test('throwaway demo colleges stay out of the panel', async () => {
  const op = await operator();
  const demo = await call('POST', '/api/auth/demo', { body: {} });
  const list = await call('GET', '/api/platform/colleges', { token: op.token });
  assert.ok(!list.body.some((c) => c.id === demo.body.institution.id));
});

test('onboarding: create a college, its admin joins by invite, and it’s theirs', async () => {
  const op = await operator();
  const made = await call('POST', '/api/platform/colleges', { token: op.token, body: { name: 'Agnel Institute', type: 'college', contact: 'Principal, 98xxxx' } });
  assert.equal(made.status, 201);
  assert.ok(made.body.code.length > 20);
  const row = (await call('GET', '/api/platform/colleges', { token: op.token })).body.find((c) => c.id === made.body.id);
  assert.equal(row.stage, 'invited');
  assert.equal(row.adminEmail, null);
  assert.equal(row.contact, 'Principal, 98xxxx');

  const peek = await call('GET', `/api/auth/invite/${made.body.code}`);
  assert.deepEqual(peek.body, { college: 'Agnel Institute', teacher: null, role: 'admin' });
  const joined = await call('POST', '/api/auth/join', { body: { code: made.body.code, name: 'Principal', email: `p${(n += 1)}@example.test`, password: PASSWORD } });
  assert.equal(joined.status, 201);
  assert.equal(joined.body.role, 'admin');
  assert.equal(joined.body.institution.id, made.body.id);

  // They now control it fully.
  const saved2 = await call('PUT', `/api/institutions/${made.body.id}`, { token: joined.body.token, body: { name: 'Agnel Institute', type: 'college', profile: { divisions: [] } } });
  assert.equal(saved2.status, 200);
  assert.equal((await call('GET', '/api/platform/colleges', { token: op.token })).body.find((c) => c.id === made.body.id).stage, 'setting_up');
});

test('creating a college checks its input', async () => {
  const op = await operator();
  for (const body of [{}, { name: '' }, { name: 'x'.repeat(500), type: 'college' }, { name: 'X', type: 'spaceship' }, { name: { a: 1 }, type: 'college' }, { name: 'X', type: 'college', contact: 'y'.repeat(500) }]) {
    assert.equal((await call('POST', '/api/platform/colleges', { token: op.token, body })).status, 400, JSON.stringify(body).slice(0, 40));
  }
});

test('a lost admin invite can be replaced; the old one stops working', async () => {
  const op = await operator();
  const { body: made } = await call('POST', '/api/platform/colleges', { token: op.token, body: { name: 'C', type: 'college' } });
  const again = await call('POST', `/api/platform/colleges/${made.id}/invite`, { token: op.token, body: {} });
  assert.equal(again.status, 201);
  assert.equal((await call('GET', `/api/auth/invite/${made.code}`)).status, 410);
  assert.equal((await call('GET', `/api/auth/invite/${again.body.code}`)).status, 200);
  assert.equal((await call('POST', '/api/platform/colleges/nope/invite', { token: op.token, body: {} })).status, 404);
});

test('pausing a college stops everyone in it, and their data is kept', async () => {
  const op = await operator();
  const user = await signup('Paused College');
  await call('PUT', `/api/institutions/${user.id}`, { token: user.token, body: { name: 'Paused College', type: 'college', profile: { teachers: [{ id: 't1', name: 'T' }], divisions: [{ id: 'd', name: 'D', students: [{ id: 's', name: 'S', rollNo: '1' }] }] } } });
  const invite = await call('POST', `/api/institutions/${user.id}/invites`, { token: user.token, body: { teacherId: 't1' } });
  const teacher = await call('POST', '/api/auth/join', { body: { code: invite.body.code, name: 'T', email: `t${(n += 1)}@example.test`, password: PASSWORD } });

  assert.equal((await call('PUT', `/api/platform/colleges/${user.id}`, { token: op.token, body: { status: 'paused' } })).status, 200);
  assert.equal((await call('GET', `/api/institutions/${user.id}`, { token: user.token })).status, 404);
  assert.equal((await call('GET', `/api/institutions/${user.id}/classroom`, { token: teacher.body.token })).status, 404);
  const me = await call('GET', '/api/auth/me', { token: user.token });
  assert.equal(me.body.institution.status, 'paused');
  assert.equal(me.body.institution.data, undefined);

  assert.equal((await call('PUT', `/api/platform/colleges/${user.id}`, { token: op.token, body: { status: 'active' } })).status, 200);
  assert.equal((await call('GET', `/api/institutions/${user.id}`, { token: user.token })).body.name, 'Paused College');
});

test('pausing refuses nonsense and unknown colleges', async () => {
  const op = await operator();
  const user = await signup();
  assert.equal((await call('PUT', `/api/platform/colleges/${user.id}`, { token: op.token, body: { status: 'deleted' } })).status, 400);
  assert.equal((await call('PUT', '/api/platform/colleges/nope', { token: op.token, body: { status: 'paused' } })).status, 404);
});

test('public sign-up can be turned off, leaving invites as the way in', async () => {
  process.env.ALLOW_SIGNUP = 'false';
  try {
    const r = await call('POST', '/api/auth/signup', { body: { name: 'U', email: `u${(n += 1)}@example.test`, password: PASSWORD, institutionName: 'X' } });
    assert.equal(r.status, 403);
    assert.equal((await call('GET', '/health')).body.signup, false);
  } finally {
    delete process.env.ALLOW_SIGNUP;
  }
  assert.equal((await call('GET', '/health')).body.signup, true);
});

/* ---------- White box: every stage of the pipeline ---------- */

const data = (extra) => ({ divisions: [{}], subjects: [{}], teachers: [{}], ...extra });
test('stage: no admin yet', () => assert.equal(collegeStage({ ownerId: null, data: {} }, [], 0), 'invited'));
test('stage: admin in, nothing set up', () => assert.equal(collegeStage({ ownerId: 'a', data: {} }, [], 0), 'setting_up'));
test('stage: partly set up still counts as setting up', () => {
  assert.equal(collegeStage({ ownerId: 'a', data: { divisions: [{}] } }, [], 0), 'setting_up');
  assert.equal(collegeStage({ ownerId: 'a', data: data({ teachers: [] }) }, [], 0), 'setting_up');
  assert.equal(collegeStage({ ownerId: 'a', data: data({ subjects: [] }) }, [], 0), 'setting_up');
});
test('stage: set up, no timetable', () => assert.equal(collegeStage({ ownerId: 'a', data: data() }, [], 0), 'ready'));
test('stage: timetable built, not approved', () => assert.equal(collegeStage({ ownerId: 'a', data: data() }, ['generated', 'edited'], 0), 'built'));
test('stage: approved, teachers not told', () => assert.equal(collegeStage({ ownerId: 'a', data: data() }, ['approved'], 0), 'approved'));
test('stage: approved and shared is live', () => assert.equal(collegeStage({ ownerId: 'a', data: data() }, ['approved'], 2), 'live'));
test('stage: reads a profile saved in either shape', () => assert.equal(collegeStage({ ownerId: 'a', data: { profile: data() } }, [], 0), 'ready'));
test('stage: survives empty data', () => assert.equal(collegeStage({ ownerId: 'a', data: null }, [], 0), 'setting_up'));
