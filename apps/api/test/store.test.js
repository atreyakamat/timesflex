import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createFileStore, createPgStore } from '../src/db.js';

// The Postgres suite runs only when TEST_DATABASE_URL points at a throwaway database.
const factories = {
  file: async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'timesflex-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    return createFileStore(path.join(dir, 'data.json'));
  },
  postgres: async (t) => {
    const store = await createPgStore(process.env.TEST_DATABASE_URL);
    await store.pool.query('TRUNCATE timetables, institutions, audit_log, sessions, users');
    t.after(() => store.pool.end());
    return store;
  },
};

for (const [kind, make] of Object.entries(factories)) {
  const skip = kind === 'postgres' && !process.env.TEST_DATABASE_URL;

  test(`${kind} store: partial timetable updates only change the fields passed`, { skip }, async (t) => {
    const store = await make(t);
    const institution = await store.createInstitution({ name: 'X', type: 'college', data: { a: 1 } });
    const timetable = await store.createTimetable({ institutionId: institution.id, label: 'V1', request: { days: [] } });
    assert.deepEqual(timetable.generatedSessions, []);
    assert.equal(timetable.report, null);

    const sessions = [{ id: 's1' }];
    await store.updateTimetable(timetable.id, { generatedSessions: sessions, status: 'generated' });
    const report = { unscheduledSessions: [], diagnostics: ['note'] };
    const withReport = await store.updateTimetable(timetable.id, { report });
    assert.deepEqual(withReport.generatedSessions, sessions);
    assert.equal(withReport.status, 'generated');
    assert.deepEqual(withReport.report, report);

    const emptied = await store.updateTimetable(timetable.id, { generatedSessions: [] });
    assert.deepEqual(emptied.generatedSessions, []);
    assert.equal(await store.updateTimetable('missing', { status: 'edited' }), null);
  });

  test(`${kind} store: audit entries come back newest first`, { skip }, async (t) => {
    const store = await make(t);
    await store.addAudit({ username: 'owner', action: 'a.first', target: 'x' });
    await store.addAudit({ username: 'owner', action: 'a.second', target: 'y', detail: { n: 1 } });
    const entries = await store.listAudit({ limit: 10 });
    assert.deepEqual(entries.map((entry) => entry.action), ['a.second', 'a.first']);
    assert.deepEqual(entries[0].detail, { n: 1 });
  });

  test(`${kind} store: users and sessions`, { skip }, async (t) => {
    const store = await make(t);
    const user = await store.createUser({ username: 'owner', passwordHash: 'h', role: 'admin' });
    assert.equal(await store.countUsers(), 1);
    await assert.rejects(store.createUser({ username: 'owner', passwordHash: 'h', role: 'admin' }), (error) => error.code === '23505');
    await store.createSession({ id: 's1', userId: user.id, expiresAt: new Date(Date.now() + 60000).toISOString() });
    await store.createSession({ id: 's2', userId: user.id, expiresAt: new Date(Date.now() + 60000).toISOString() });
    await store.deleteUserSessions(user.id, { except: 's2' });
    assert.equal(await store.getSession('s1'), null);
    assert.equal((await store.getSession('s2')).userId, user.id);
    assert.equal((await store.updateUser(user.id, { disabled: true })).disabled, true);
    assert.equal(await store.deleteUser(user.id), true);
    assert.equal(await store.getSession('s2'), null);
  });

  test(`${kind} store: deleting an institution removes its timetables`, { skip }, async (t) => {
    const store = await make(t);
    const institution = await store.createInstitution({ name: 'X', type: 'college', data: {} });
    await store.createTimetable({ institutionId: institution.id, request: {} });
    assert.equal(await store.deleteInstitution(institution.id), true);
    assert.deepEqual(await store.listTimetables(institution.id), []);
    assert.equal(await store.deleteInstitution(institution.id), false);
  });
}

test('demo seed adds one department with slots and can run twice', async (t) => {
  const { seedDemo, DEMO_NAME } = await import('../src/demo/demoDepartment.js');
  const store = await factories.file(t);
  const first = await seedDemo(store);
  assert.equal(first.created, true);
  assert.deepEqual(first.institution.data.slots, [
    '09:00-10:00',
    '10:00-11:00',
    '11:15-12:15',
    '12:15-13:15',
    '14:00-15:00',
    '15:00-16:00',
    '16:00-17:00',
  ]);
  const second = await seedDemo(store);
  assert.equal(second.created, false);
  assert.deepEqual((await store.listInstitutions()).map((item) => item.name), [DEMO_NAME]);
});
