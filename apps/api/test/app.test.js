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

const start = async (t, { solve = okSolve } = {}) => {
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
  const call = async (method, url, body) => {
    const response = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { call, setSolve: (next) => { currentSolve = next; } };
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
