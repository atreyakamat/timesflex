import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createApp } from '../src/app.js';
import { createRateLimiter, hashPassword, verifyPassword } from '../src/auth.js';
import { createFileStore } from '../src/db.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'timesflex-auth-'));
const dataFile = path.join(dir, 'data.json');
const store = await createFileStore(dataFile);
const solve = async (request) => ({ status: 'ok', scheduled_sessions: request.sessions, unscheduled_sessions: [], diagnostics: [] });
const app = createApp({ store, solve, loginLimiter: createRateLimiter({ limit: 3 }) });
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = async (method, url, { body, token } = {}) => {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const signup = (email, institutionName = 'Goa College') =>
  call('POST', '/api/auth/signup', {
    body: { name: 'Asha Admin', email, password: 'correct horse', institutionName, institutionType: 'college' },
  });

test('passwords are salted scrypt hashes', async () => {
  const one = await hashPassword('secret-123');
  const two = await hashPassword('secret-123');
  assert.notEqual(one, two);
  assert.ok(await verifyPassword('secret-123', one));
  assert.ok(!(await verifyPassword('secret-124', one)));
  assert.ok(!(await verifyPassword('secret-123', 'garbage')));
});

test('sign-up creates the account with its institution and a session', async () => {
  const { status, body } = await signup('Admin@Goa.edu ');
  assert.equal(status, 201);
  assert.equal(body.account.email, 'admin@goa.edu');
  assert.equal(body.institution.name, 'Goa College');
  assert.equal(body.account.passwordHash, undefined);
  assert.ok(body.token.length > 30);

  const me = await call('GET', '/api/auth/me', { token: body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.institution.id, body.institution.id);

  // Neither the password nor the raw token is written to disk.
  const disk = readFileSync(dataFile, 'utf8');
  assert.ok(!disk.includes('correct horse'));
  assert.ok(!disk.includes(body.token));
});

test('sign-up validates input and rejects duplicate e-mails', async () => {
  assert.equal((await signup('admin@goa.edu')).status, 409);
  const short = await call('POST', '/api/auth/signup', {
    body: { name: 'A', email: 'a@b.co', password: 'short', institutionName: 'X' },
  });
  assert.equal(short.status, 400);
  const badEmail = await call('POST', '/api/auth/signup', {
    body: { name: 'A', email: 'nope', password: 'long enough', institutionName: 'X' },
  });
  assert.equal(badEmail.status, 400);
});

test('login, logout, and rate limiting', async () => {
  const ok = await call('POST', '/api/auth/login', { body: { email: 'admin@goa.edu', password: 'correct horse' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.institution);

  assert.equal((await call('POST', '/api/auth/logout', { token: ok.body.token })).status, 200);
  assert.equal((await call('GET', '/api/auth/me', { token: ok.body.token })).status, 401);

  const wrong = { body: { email: 'admin@goa.edu', password: 'wrong password' } };
  assert.equal((await call('POST', '/api/auth/login', wrong)).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'ghost@goa.edu', password: 'x' } })).status, 401);
  await call('POST', '/api/auth/login', wrong);
  await call('POST', '/api/auth/login', wrong);
  assert.equal((await call('POST', '/api/auth/login', wrong)).status, 429);
});

test('data routes need a session and only reach your own institution', async () => {
  assert.equal((await call('GET', '/api/institutions')).status, 401);
  assert.equal((await call('GET', '/api/institutions', { token: 'made-up' })).status, 401);

  const a = (await signup('a@one.edu', 'One')).body;
  const b = (await signup('b@two.edu', 'Two')).body;

  const mine = await call('GET', '/api/institutions', { token: a.token });
  assert.deepEqual(
    mine.body.map((item) => item.name),
    ['One'],
  );

  // B cannot read, change or schedule A's institution.
  assert.equal((await call('GET', `/api/institutions/${a.institution.id}`, { token: b.token })).status, 404);
  const put = await call('PUT', `/api/institutions/${a.institution.id}`, {
    token: b.token,
    body: { name: 'Hacked', type: 'college', profile: {} },
  });
  assert.equal(put.status, 404);

  const request = { days: ['Monday'], slots: ['09:00-10:00'], sessions: [], teacher_constraints: [], rooms: [], names: {} };
  const timetable = await call('POST', `/api/institutions/${a.institution.id}/timetables`, {
    token: a.token,
    body: { label: 'V1', request },
  });
  assert.equal(timetable.status, 201);
  assert.equal((await call('GET', `/api/timetables/${timetable.body.id}`, { token: b.token })).status, 404);
  assert.equal((await call('POST', `/api/timetables/${timetable.body.id}/solve`, { token: b.token })).status, 404);
  const solved = await call('POST', `/api/timetables/${timetable.body.id}/solve`, { token: a.token });
  assert.equal(solved.status, 200);
  assert.equal(solved.body.timetable.status, 'generated');
});

test('operations have their own endpoint and profile saves never roll them back', async () => {
  const { token, institution } = (await signup('ops@three.edu', 'Three')).body;
  const ops = {
    absences: [{ id: 'a1', date: '2026-10-19', teacherId: 't1' }],
    substitutions: [{ id: 's1', date: '2026-10-19', sessionId: 'x', absentTeacherId: 't1', substituteTeacherId: 't2' }],
    attendance: [],
  };
  const saved = await call('PUT', `/api/institutions/${institution.id}/operations`, { token, body: ops });
  assert.equal(saved.status, 200);

  // A stale profile save (older operations) from another device keeps the newer operations.
  const stale = { institution: { name: 'Three' }, operations: { absences: [], substitutions: [], attendance: [] } };
  await call('PUT', `/api/institutions/${institution.id}`, { token, body: { name: 'Three', type: 'college', profile: stale } });
  const after = await call('GET', `/api/institutions/${institution.id}`, { token });
  assert.equal(after.body.data.operations.absences.length, 1);
  assert.equal(after.body.data.operations.substitutions[0].substituteTeacherId, 't2');

  const bad = await call('PUT', `/api/institutions/${institution.id}/operations`, { token, body: { absences: 'nope' } });
  assert.equal(bad.status, 400);
  const other = (await signup('ops@four.edu', 'Four')).body;
  const foreign = await call('PUT', `/api/institutions/${institution.id}/operations`, { token: other.token, body: ops });
  assert.equal(foreign.status, 404);
});

test('deleting an account needs the password and removes everything it owns', async () => {
  const { token, institution } = (await signup('leaving@five.edu', 'Five')).body;
  const wrong = await call('DELETE', '/api/auth/account', { token, body: { password: 'not it' } });
  assert.equal(wrong.status, 403);
  const gone = await call('DELETE', '/api/auth/account', { token, body: { password: 'correct horse' } });
  assert.equal(gone.status, 200);
  assert.equal((await call('GET', '/api/auth/me', { token })).status, 401);
  assert.equal(await store.getInstitution(institution.id), null);
  const again = await call('POST', '/api/auth/login', { body: { email: 'leaving@five.edu', password: 'correct horse' } });
  assert.equal(again.status, 401);
});
