// Connecting any fingerprint machine: reading their files, linking machine IDs to students, importing.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createApp } from '../src/app.js';
import { createFileStore, createPgStore } from '../src/db.js';
import { zonedToUtc } from '../src/devices.js';
import { parseDate, parseDateTime, parsePunches, parseTime } from '../src/punchfile.js';

/* ---------- Reading machine files: pure ---------- */

test('times, in the ways machines write them', () => {
  assert.deepEqual(parseTime('09:25'), [9, 25, 0]);
  assert.deepEqual(parseTime('9:25:03'), [9, 25, 3]);
  assert.deepEqual(parseTime('9:25 PM'), [21, 25, 0]);
  assert.deepEqual(parseTime('12:05 am'), [0, 5, 0]);
  assert.deepEqual(parseTime('12:05 p.m.'), [12, 5, 0]);
  assert.equal(parseTime('13:00 PM'), null);
  assert.equal(parseTime('noon'), null);
});

test('dates: year first, Indian day first, month names, and American only when it must be', () => {
  assert.deepEqual(parseDate('2026-11-09'), [2026, 11, 9]);
  assert.deepEqual(parseDate('2026/11/09'), [2026, 11, 9]);
  assert.deepEqual(parseDate('09/11/2026'), [2026, 11, 9], 'day first, as in India');
  assert.deepEqual(parseDate('9-11-26'), [2026, 11, 9]);
  assert.deepEqual(parseDate('11/25/2026'), [2026, 11, 25], '25 can’t be a month');
  assert.deepEqual(parseDate('09-Nov-2026'), [2026, 11, 9]);
  assert.deepEqual(parseDate('9 November 2026'), [2026, 11, 9]);
  assert.equal(parseDate('09-Foo-2026'), null);
  assert.equal(parseDate('hello'), null);
});

test('date and time together, and impossible ones refused', () => {
  assert.equal(parseDateTime('2026-11-09 09:25:03'), '2026-11-09 09:25:03');
  assert.equal(parseDateTime('2026-11-09T09:25:03'), '2026-11-09 09:25:03');
  assert.equal(parseDateTime('09/11/2026 9:25 AM'), '2026-11-09 09:25:00');
  assert.equal(parseDateTime('09-Nov-2026 18:05'), '2026-11-09 18:05:00');
  assert.equal(parseDateTime('2026-13-09 09:25'), null);
  assert.equal(parseDateTime('2026-11-09 25:00'), null);
  assert.equal(parseDateTime('1999-11-09 09:00'), null);
  assert.equal(parseDateTime('2026-11-09'), null);
});

const ids = (text) => parsePunches(text).punches.map((p) => `${p.id}@${p.time}`);

test('a ZKTeco-style attlog.dat, tab separated with status columns', () => {
  assert.deepEqual(ids('   1023\t2026-11-09 09:25:03\t1\t0\t1\t0\n1024\t2026-11-09 09:26:00\t1\t0\t1\t0\n'), ['1023@2026-11-09 09:25:03', '1024@2026-11-09 09:26:00']);
});

test('a CSV from attendance software, with a header and columns in its own order', () => {
  const file = 'Sr No,Employee Name,Emp Code,Punch Time,Device\n1,Aarav,A01,09/11/2026 08:50 AM,Gate\n2,"Diya, K",A02,09/11/2026 09:31 AM,Gate\n';
  const result = parsePunches(file);
  assert.equal(result.header, true);
  assert.deepEqual(result.punches, [{ id: 'A01', time: '2026-11-09 08:50:00' }, { id: 'A02', time: '2026-11-09 09:31:00' }]);
});

test('separate date and time columns, semicolons, and a byte-order mark', () => {
  assert.deepEqual(ids('﻿User ID;Date;Time\nA01;09.11.2026;08:50\n'), ['A01@2026-11-09 08:50:00']);
});

test('no header, separated by spaces', () => {
  assert.deepEqual(ids('A01 2026-11-09 08:50:00 1 0\nA02 09/11/2026 9:05 PM\n'), ['A01@2026-11-09 08:50:00', 'A02@2026-11-09 21:05:00']);
});

test('lines it can’t read are counted and shown, not guessed', () => {
  const result = parsePunches('Attendance report for November\nA01,2026-11-09 08:50\nA02,sometime\n\n');
  assert.deepEqual(result.punches.map((p) => p.id), ['A01']);
  assert.equal(result.skipped, 2);
  assert.ok(result.unreadable.includes('A02,sometime'));
  assert.deepEqual(parsePunches('').punches, []);
  assert.deepEqual(parsePunches(null).punches, []);
});

test('at most five unreadable lines are kept to show', () => {
  assert.equal(parsePunches(Array(50).fill('rubbish').join('\n')).unreadable.length, 5);
});

test('the plugin’s copy of the reader is the same file', () => {
  const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(read('../../../plugins/biometric-bridge/punchfile.mjs'), read('../src/punchfile.js'));
});

test('local college time to UTC, whatever zone the server is in', () => {
  assert.equal(zonedToUtc('2026-11-09 09:25:03', 'Asia/Kolkata'), '2026-11-09T03:55:03.000Z');
  assert.equal(zonedToUtc('2026-11-09 01:00:00', 'Asia/Kolkata'), '2026-11-08T19:30:00.000Z');
  assert.equal(zonedToUtc('2026-07-01 12:00:00', 'Europe/London'), '2026-07-01T11:00:00.000Z', 'summer time');
  assert.equal(zonedToUtc('2026-11-09 09:00:00', 'Not/AZone'), '2026-11-09T03:30:00.000Z', 'a bad zone falls back to India');
});

/* ---------- Through the API ---------- */

const dir = mkdtempSync(path.join(os.tmpdir(), 'timesflex-bio-'));
const store = process.env.TEST_DATABASE_URL ? await createPgStore(process.env.TEST_DATABASE_URL) : await createFileStore(path.join(dir, 'data.json'));
const server = createApp({ store, solve: async () => ({}) }).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(async () => {
  server.close();
  await store.close?.();
  rmSync(dir, { recursive: true, force: true });
});
const call = async (method, url, { body, token } = {}) => {
  const response = await fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
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
const day = (back) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
const YESTERDAY = day(1);
const college = async () => {
  const { body } = await call('POST', '/api/auth/signup', { body: { name: 'Admin', email: `b${(n += 1)}@example.test`, password: PASSWORD, institutionName: 'Bio College' } });
  const id = body.institution.id;
  const profile = {
    institution: { name: 'Bio College', workingDays: ['Monday'], startTime: '09:00', endTime: '10:00', slotDurationMinutes: 60 },
    teachers: [{ id: 't1', name: 'Mehta' }],
    divisions: [
      { id: 'd1', name: 'SY A', batches: [], students: [{ id: 's1', rollNo: 'A01', name: 'Aarav' }, { id: 's2', rollNo: '1', name: 'Diya' }] },
      { id: 'd2', name: 'SY B', batches: [], students: [{ id: 's3', rollNo: '1', name: 'Kabir' }] },
    ],
  };
  await call('PUT', `/api/institutions/${id}`, { token: body.token, body: { name: 'Bio College', type: 'college', profile } });
  const invite = await call('POST', `/api/institutions/${id}/invites`, { token: body.token, body: { teacherId: 't1' } });
  const joined = await call('POST', '/api/auth/join', { body: { code: invite.body.code, name: 'Mehta', email: `bt${(n += 1)}@example.test`, password: PASSWORD } });
  return { id, admin: body.token, teacher: joined.body.token };
};
const link = (c, body, token = c.admin) => call('POST', `/api/institutions/${c.id}/reader-ids`, { token, body });
const importFile = (c, body, token = c.admin) => call('POST', `/api/institutions/${c.id}/scans/import`, { token, body });

test('the admin links machine IDs to students, by picking or by a pasted list', async () => {
  const c = await college();
  assert.equal((await link(c, { links: [{ readerId: '1023', studentId: 's2' }] })).body.saved, 1);
  const pasted = await link(c, { text: '1024, A01\n1025\tNOPE\n1026, 1\njunk' });
  assert.equal(pasted.body.saved, 1);
  assert.deepEqual(pasted.body.problems.map((p) => p.line), ['1025\tNOPE', '1026, 1', 'junk']);
  assert.match(pasted.body.problems[1].reason, /more than one/);
  const list = (await call('GET', `/api/institutions/${c.id}/reader-ids`, { token: c.admin })).body;
  assert.deepEqual(list.map((row) => `${row.readerId}=${row.name}`).sort(), ['1023=Diya', '1024=Aarav']);
  assert.equal(list.find((row) => row.readerId === '1023').className, 'SY A');
});

test('linking again moves the ID, and an ID can be unlinked', async () => {
  const c = await college();
  await link(c, { links: [{ readerId: '7', studentId: 's1' }] });
  await link(c, { links: [{ readerId: '7', studentId: 's3' }] });
  const list = (await call('GET', `/api/institutions/${c.id}/reader-ids`, { token: c.admin })).body;
  assert.deepEqual(list.map((row) => row.studentId), ['s3']);
  assert.equal((await call('DELETE', `/api/institutions/${c.id}/reader-ids/7`, { token: c.admin })).status, 200);
  assert.equal((await call('GET', `/api/institutions/${c.id}/reader-ids`, { token: c.admin })).body.length, 0);
});

test('linking checks its input', async () => {
  const c = await college();
  for (const body of [{}, { links: 'x' }, { links: [{ readerId: '', studentId: 's1' }] }, { links: [{ readerId: 'x'.repeat(101), studentId: 's1' }] }, { links: [{ readerId: '9', studentId: 'ghost' }] }, { text: 5 }, { links: Array(5001).fill({ readerId: '1', studentId: 's1' }) }]) {
    assert.equal((await link(c, body)).status, 400, JSON.stringify(body).slice(0, 60));
  }
});

test('only the college’s admin manages machine IDs and imports', async () => {
  const c = await college();
  const other = await college();
  for (const token of [c.teacher, other.admin]) {
    assert.equal((await link(c, { links: [{ readerId: '1', studentId: 's1' }] }, token)).status, 404);
    assert.equal((await call('GET', `/api/institutions/${c.id}/reader-ids`, { token })).status, 404);
    assert.equal((await call('DELETE', `/api/institutions/${c.id}/reader-ids/1`, { token })).status, 404);
    assert.equal((await importFile(c, { text: 'A01,2026-11-09 08:50' }, token)).status, 404);
  }
});

test('a linked machine ID beats a shared roll number, for devices too', async () => {
  const c = await college();
  await link(c, { links: [{ readerId: '1', studentId: 's3' }] });
  const device = (await call('POST', `/api/institutions/${c.id}/devices`, { token: c.admin, body: { name: 'Gate', kind: 'classroom' } })).body;
  const sent = await call('POST', '/api/device/v1/scans', { token: device.key, body: { scans: [{ identifier: '1' }] } });
  assert.deepEqual(sent.body, { accepted: 1, duplicates: 0, unmatched: [] });
  const scans = (await call('GET', `/api/institutions/${c.id}/scans`, { token: c.admin })).body;
  assert.equal(scans[0].studentName, 'Kabir');
});

test('once an ID is linked, the device stops listing it as unmatched', async () => {
  const c = await college();
  const device = (await call('POST', `/api/institutions/${c.id}/devices`, { token: c.admin, body: { name: 'Gate', kind: 'classroom' } })).body;
  await call('POST', '/api/device/v1/scans', { token: device.key, body: { scans: [{ identifier: '555' }] } });
  assert.deepEqual((await call('GET', `/api/institutions/${c.id}/devices`, { token: c.admin })).body[0].unmatched, ['555']);
  await link(c, { links: [{ readerId: '555', studentId: 's1' }] });
  assert.deepEqual((await call('GET', `/api/institutions/${c.id}/devices`, { token: c.admin })).body[0].unmatched, []);
});

test('a preview reads the file and saves nothing', async () => {
  const c = await college();
  const text = `Emp Code,Punch Time\nA01,${YESTERDAY} 08:50\nGHOST,${YESTERDAY} 08:51\nnot a line\n`;
  const preview = await importFile(c, { text, dryRun: true });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.readable, 2);
  assert.equal(preview.body.matched, 1);
  assert.deepEqual(preview.body.unmatched, ['GHOST']);
  assert.equal(preview.body.skipped, 1);
  assert.equal(preview.body.rows[0].name, 'Aarav');
  assert.equal(preview.body.rows[1].name, null);
  assert.equal((await call('GET', `/api/institutions/${c.id}/scans?date=${YESTERDAY}`, { token: c.admin })).body.length, 0);
});

test('importing records the scans, and importing the same file again adds nothing', async () => {
  const c = await college();
  const text = `A01\t${YESTERDAY} 08:50:00\nA01\t${YESTERDAY} 08:50:20\n`;
  const first = await importFile(c, { text, name: 'attlog.dat' });
  assert.equal(first.body.accepted, 1, 'two reads seconds apart are one scan');
  assert.equal(first.body.duplicates, 1);
  const again = await importFile(c, { text, name: 'attlog.dat' });
  assert.equal(again.body.accepted, 0);
  const scans = (await call('GET', `/api/institutions/${c.id}/scans?date=${YESTERDAY}`, { token: c.admin })).body;
  assert.equal(scans.length, 1);
  assert.equal(scans[0].time, '08:50');
  assert.equal(scans[0].source, 'File: attlog.dat');
});

test('an import leaves out times in the future or long ago, and says so', async () => {
  const c = await college();
  const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const r = await importFile(c, { text: `A01,${future} 08:50\nA01,2020-01-01 08:50\nA01,${YESTERDAY} 08:50` });
  assert.equal(r.body.accepted, 1);
  assert.equal(r.body.outOfRange, 2);
});

test('an import checks its input', async () => {
  const c = await college();
  for (const body of [{}, { text: 5 }, { text: '' }, { text: 'x', kind: 'toaster' }, { text: 'x', name: 'n'.repeat(200) }]) {
    assert.equal((await importFile(c, body)).status, 400, JSON.stringify(body).slice(0, 60));
  }
  const nothing = await importFile(c, { text: 'nothing useful here' });
  assert.equal(nothing.status, 400);
  assert.match(nothing.body.error, /couldn’t find/i);
});
