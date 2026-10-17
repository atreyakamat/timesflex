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
    await store.pool.query('TRUNCATE timetables, institutions');
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

  test(`${kind} store: deleting an institution removes its timetables`, { skip }, async (t) => {
    const store = await make(t);
    const institution = await store.createInstitution({ name: 'X', type: 'college', data: {} });
    await store.createTimetable({ institutionId: institution.id, request: {} });
    assert.equal(await store.deleteInstitution(institution.id), true);
    assert.deepEqual(await store.listTimetables(institution.id), []);
    assert.equal(await store.deleteInstitution(institution.id), false);
  });
}
