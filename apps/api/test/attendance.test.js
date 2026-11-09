// Integration: teachers taking attendance, QR cards, scanning devices, and the API for other software.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createApp } from '../src/app.js';
import { createFileStore, createPgStore } from '../src/db.js';
import { localParts } from '../src/devices.js';
import { deviceLineToScan, parseAttlog, handleIclock, createBridge } from '../../../plugins/biometric-bridge/bridge.mjs';

const dir = mkdtempSync(path.join(os.tmpdir(), 'timesflex-att-'));
const store = process.env.TEST_DATABASE_URL ? await createPgStore(process.env.TEST_DATABASE_URL) : await createFileStore(path.join(dir, 'data.json'));
const server = createApp({ store, solve: async () => ({}) }).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(async () => {
  server.close();
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

// A recent Monday, always in the past, so its Tuesday is too. Devices refuse scans in the future or
// from long ago, so a fixed date here would start failing in a couple of weeks.
const mondayMs = (() => {
  const ms = Date.now() - 2 * 86400000;
  const day = new Date(ms).getUTCDay();
  return Math.floor((ms - ((day + 6) % 7) * 86400000) / 86400000) * 86400000;
})();
const MONDAY = new Date(mondayMs).toISOString().slice(0, 10);
const TUESDAY = new Date(mondayMs + 86400000).toISOString().slice(0, 10);
// Classes are 09:00-10:00 and 10:00-11:00 in India, which is 5:30 ahead of UTC.
const atIST = (hhmm, date = MONDAY) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();
const SLOT1 = '09:00-10:00';
const SLOT2 = '10:00-11:00';
const session = (id, teacher, slot = SLOT1, extra = {}) => ({ id, subject_id: 'sub', teacher_id: teacher, division_id: 'd1', room_id: 'r', day: 'Monday', slot, batch: null, duration_slots: 1, kind: 'lecture', ...extra });
const PROFILE = {
  institution: { name: 'Goa College', workingDays: ['Monday'], startTime: '09:00', endTime: '11:00', slotDurationMinutes: 60 },
  teachers: [{ id: 't1', name: 'Mehta' }, { id: 't2', name: 'Rao' }],
  subjects: [{ id: 'sub', name: 'DBMS' }],
  rooms: [{ id: 'r', name: 'Room 1' }],
  divisions: [
    { id: 'd1', name: 'SY A', batches: [], students: [{ id: 's1', rollNo: 'A01', name: 'Aarav' }, { id: 's2', rollNo: 'A02', name: 'Diya' }] },
    { id: 'd2', name: 'SY B', batches: [], students: [{ id: 's3', rollNo: 'B01', name: 'Other' }] },
  ],
  operations: { absences: [], substitutions: [], attendance: [] },
};
const college = async (profile = PROFILE) => {
  const { body } = await call('POST', '/api/auth/signup', { body: { name: 'Admin', email: `a${(n += 1)}@example.test`, password: PASSWORD, institutionName: 'Goa College' } });
  const id = body.institution.id;
  await call('PUT', `/api/institutions/${id}`, { token: body.token, body: { name: 'Goa College', type: 'college', profile } });
  const tt = await call('POST', `/api/institutions/${id}/timetables`, { token: body.token, body: { label: 'V', request: { days: [], slots: [], sessions: [] } } });
  await call('PUT', `/api/timetables/${tt.body.id}`, { token: body.token, body: { status: 'approved', generatedSessions: [session('mine', 't1'), session('later', 't1', SLOT2), session('theirs', 't2', SLOT2, { division_id: 'd2' })] } });
  const invite = await call('POST', `/api/institutions/${id}/invites`, { token: body.token, body: { teacherId: 't1' } });
  const joined = await call('POST', '/api/auth/join', { body: { code: invite.body.code, name: 'Mehta', email: `t${(n += 1)}@example.test`, password: PASSWORD } });
  return { id, admin: body.token, teacher: joined.body.token, timetable: tt.body.id };
};
const take = (c, token, extra = {}) => call('POST', `/api/institutions/${c.id}/attendance`, { token, body: { date: new Date().toISOString().slice(0, 10), sessionId: 'mine', absentStudentIds: ['s2'], ...extra } });

/* ---------- Teachers take attendance ---------- */

test('a teacher takes attendance for their own class, and it is complete', async () => {
  const c = await college();
  const r = await take(c, c.teacher);
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.absentStudentIds, ['s2']);
  assert.equal(r.body.divisionId, 'd1');
  assert.equal(r.body.subjectId, 'sub');
  assert.equal(r.body.slot, SLOT1);
  assert.equal(r.body.takenByName, 'Mehta');
});

test('a teacher can’t take attendance for another teacher’s class', async () => {
  const c = await college();
  assert.equal((await take(c, c.teacher, { sessionId: 'theirs', absentStudentIds: [] })).status, 403);
});

test('a substitute can take attendance for the class they’re covering, that day only', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const c = await college({ ...PROFILE, operations: { absences: [], attendance: [], substitutions: [{ id: 'x', date: today, sessionId: 'theirs', absentTeacherId: 't2', substituteTeacherId: 't1' }] } });
  const ok = await take(c, c.teacher, { sessionId: 'theirs', absentStudentIds: ['s3'] });
  assert.equal(ok.status, 201);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  assert.equal((await take(c, c.teacher, { sessionId: 'theirs', absentStudentIds: [], date: yesterday })).status, 403);
});

test('the admin can take attendance for any class', async () => {
  const c = await college();
  assert.equal((await take(c, c.admin, { sessionId: 'theirs', absentStudentIds: ['s3'] })).status, 201);
});

test('attendance refuses bad input', async () => {
  const c = await college();
  const bad = [{ sessionId: 'nope' }, { absentStudentIds: 'x' }, { absentStudentIds: ['s3'] }, { absentStudentIds: [5] }, { date: 'today' }, { date: '2000-01-01' }];
  for (const extra of bad) {
    const r = await take(c, c.teacher, extra);
    assert.ok([400, 404].includes(r.status), `${JSON.stringify(extra)} gave ${r.status}`);
  }
});

test('retaking replaces the record rather than adding another', async () => {
  const c = await college();
  await take(c, c.teacher);
  await take(c, c.teacher, { absentStudentIds: [] });
  const list = await call('GET', `/api/institutions/${c.id}/attendance`, { token: c.admin });
  assert.equal(list.body.length, 1);
  assert.deepEqual(list.body[0].absentStudentIds, []);
});

test('teachers see attendance for their own classes; the admin sees all', async () => {
  const c = await college();
  await take(c, c.teacher);
  await take(c, c.admin, { sessionId: 'theirs', absentStudentIds: [] });
  const today = new Date().toISOString().slice(0, 10);
  const mine = await call('GET', `/api/institutions/${c.id}/attendance?date=${today}`, { token: c.teacher });
  assert.deepEqual(mine.body.map((r) => r.sessionId), ['mine']);
  assert.equal((await call('GET', `/api/institutions/${c.id}/attendance`, { token: c.admin })).body.length, 2);
  assert.equal((await call('GET', `/api/institutions/${c.id}/attendance?date=2000-01-01`, { token: c.admin })).body.length, 0);
});

test('a teacher sees the classes they cover, and nothing else from the office’s records', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const c = await college({ ...PROFILE, operations: { absences: [{ id: 'private', date: today, teacherId: 't2' }], attendance: [], substitutions: [{ id: 'x', date: today, sessionId: 'theirs', absentTeacherId: 't2', substituteTeacherId: 't1' }, { id: 'y', date: today, sessionId: 'other', absentTeacherId: 't1', substituteTeacherId: 't2' }] } });
  const room = await call('GET', `/api/institutions/${c.id}/classroom`, { token: c.teacher });
  assert.deepEqual(room.body.covering.map((item) => item.id), ['x']);
  assert.doesNotMatch(room.text, /private/);
});

test('a teacher’s attendance survives the admin app saving at the same moment', async () => {
  const c = await college();
  await take(c, c.teacher);
  // The admin's screen, loaded earlier, saves its now out-of-date copy.
  await call('PUT', `/api/institutions/${c.id}/operations`, { token: c.admin, body: { absences: [], substitutions: [], attendance: [] } });
  await call('PUT', `/api/institutions/${c.id}`, { token: c.admin, body: { name: 'Goa College', type: 'college', profile: { ...PROFILE, operations: { absences: [], substitutions: [], attendance: [] } } } });
  const me = await call('GET', '/api/auth/me', { token: c.admin });
  const data = me.body.institution.data.profile ?? me.body.institution.data;
  assert.equal(data.operations.attendance.length, 1, 'the admin’s app sees it when it loads');
  assert.equal((await call('GET', `/api/institutions/${c.id}/attendance`, { token: c.admin })).body.length, 1);
});

test('older attendance saved the old way still counts, and a new record replaces it', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const legacy = { id: 'old', date: today, sessionId: 'mine', subjectId: 'sub', divisionId: 'd1', slot: SLOT1, absentStudentIds: ['s1'], takenAt: 'x' };
  const c = await college({ ...PROFILE, operations: { absences: [], substitutions: [], attendance: [legacy] } });
  assert.deepEqual((await call('GET', `/api/institutions/${c.id}/attendance`, { token: c.admin })).body[0].absentStudentIds, ['s1']);
  await take(c, c.teacher);
  const list = (await call('GET', `/api/institutions/${c.id}/attendance`, { token: c.admin })).body;
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].absentStudentIds, ['s2']);
});

test('nobody outside the college reaches its attendance', async () => {
  const c = await college();
  const other = await college();
  assert.equal((await take(c, other.admin)).status, 404);
  assert.equal((await call('GET', `/api/institutions/${c.id}/attendance`, { token: other.teacher })).status, 404);
  assert.equal((await call('GET', `/api/institutions/${c.id}/attendance`)).status, 401);
});

/* ---------- QR cards ---------- */

const cardsFor = async (c, q = '') => (await call('GET', `/api/institutions/${c.id}/cards${q}`, { token: c.admin })).body;

test('every student gets a card code, by class if asked, for the admin only', async () => {
  const c = await college();
  const all = await cardsFor(c);
  assert.equal(all.length, 3);
  assert.match(all[0].code, /^TF1\./);
  assert.equal(all[0].name, 'Aarav');
  assert.equal((await cardsFor(c, '?divisionId=d2')).length, 1);
  assert.equal((await call('GET', `/api/institutions/${c.id}/cards`, { token: c.teacher })).status, 404);
});

test('a card code holds no personal details, and stays the same until replaced', async () => {
  const c = await college();
  const [a] = await cardsFor(c);
  assert.doesNotMatch(a.code, /Aarav|A01/);
  assert.equal((await cardsFor(c))[0].code, a.code);
});

test('the signing secret never leaves the server', async () => {
  const c = await college();
  await cardsFor(c);
  const me = await call('GET', '/api/auth/me', { token: c.admin });
  const inst = await call('GET', `/api/institutions/${c.id}`, { token: c.admin });
  for (const r of [me, inst]) assert.doesNotMatch(r.text, /cardSecret|card_secret/);
});

const scan = (c, identifier, token = c.teacher, extra = {}) => call('POST', `/api/institutions/${c.id}/scans`, { token, body: { identifier, ...extra } });

test('scanning a card identifies the student', async () => {
  const c = await college();
  const [a] = await cardsFor(c);
  const r = await scan(c, a.code);
  assert.equal(r.status, 201);
  assert.equal(r.body.matched, true);
  assert.equal(r.body.student.name, 'Aarav');
  assert.equal(r.body.student.divisionName, 'SY A');
});

test('a forged or altered card is refused, and so is another college’s', async () => {
  const c = await college();
  const other = await college();
  const [a] = await cardsFor(c);
  const [theirs] = await cardsFor(other);
  for (const code of [`TF1.s1.${'A'.repeat(22)}`, `${a.code}x`, 'TF1.s1', 'TF1..', theirs.code.replace('s1', 's2')]) {
    assert.equal((await scan(c, code)).body.matched, false, code);
  }
  // Same student id in another college: signed with their secret, so it doesn't work here.
  assert.equal((await scan(c, theirs.code)).body.matched, false);
});

test('replacing the codes retires lost cards', async () => {
  const c = await college();
  const [before] = await cardsFor(c);
  assert.equal((await call('POST', `/api/institutions/${c.id}/cards/rotate`, { token: c.teacher, body: {} })).status, 404);
  assert.equal((await call('POST', `/api/institutions/${c.id}/cards/rotate`, { token: c.admin, body: {} })).status, 200);
  const [after] = await cardsFor(c);
  assert.notEqual(after.code, before.code);
  assert.equal((await scan(c, before.code)).body.matched, false);
  assert.equal((await scan(c, after.code)).body.matched, true);
});

test('a roll number works too, for typing or a simple scanner', async () => {
  const c = await college();
  assert.equal((await scan(c, 'a01')).body.student.name, 'Aarav');
  assert.equal((await scan(c, 'NOBODY')).body.matched, false);
  assert.equal((await scan(c, '')).status, 400);
  assert.equal((await scan(c, 'x'.repeat(300))).status, 400);
  assert.equal((await scan(c, 5)).status, 400);
});

test('nobody outside the college can scan into it', async () => {
  const c = await college();
  const other = await college();
  assert.equal((await scan(c, 'A01', other.teacher)).status, 404);
  assert.equal((await call('POST', `/api/institutions/${c.id}/scans`, { body: { identifier: 'A01' } })).status, 401);
});

/* ---------- Devices ---------- */

const device = async (c, kind = 'gate', name = 'Main gate') => (await call('POST', `/api/institutions/${c.id}/devices`, { token: c.admin, body: { name, kind } })).body;
const post = (key, body) => call('POST', '/api/device/v1/scans', { token: key, body });

test('only an admin adds a device, the key shows once, and only its hash is stored', async () => {
  const c = await college();
  assert.equal((await call('POST', `/api/institutions/${c.id}/devices`, { token: c.teacher, body: { name: 'X', kind: 'gate' } })).status, 404);
  for (const body of [{ name: '', kind: 'gate' }, { name: 'X', kind: 'toaster' }, { name: 'x'.repeat(200), kind: 'gate' }]) assert.equal((await call('POST', `/api/institutions/${c.id}/devices`, { token: c.admin, body })).status, 400);
  const d = await device(c);
  assert.match(d.key, /^tfd_/);
  const list = await call('GET', `/api/institutions/${c.id}/devices`, { token: c.admin });
  assert.equal(list.body[0].name, 'Main gate');
  assert.doesNotMatch(list.text, /tfd_|keyHash|key_hash/);
});

test('a scan needs a real key, and a user’s login isn’t one', async () => {
  const c = await college();
  assert.equal((await post('tfd_fake', { scans: [{ identifier: 'A01' }] })).status, 401);
  assert.equal((await post(undefined, { scans: [{ identifier: 'A01' }] })).status, 401);
  assert.equal((await post(c.admin, { scans: [{ identifier: 'A01' }] })).status, 401);
});

test('a device records scans, reports what it couldn’t match, and notes when it was seen', async () => {
  const c = await college();
  const d = await device(c);
  const r = await post(d.key, { scans: [{ identifier: 'A01', at: atIST('08:50'), scanId: 'x1' }, { identifier: 'GHOST', at: atIST('08:51'), scanId: 'x2' }] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { accepted: 1, duplicates: 0, unmatched: ['GHOST'] });
  const scans = await call('GET', `/api/institutions/${c.id}/scans?date=${MONDAY}`, { token: c.admin });
  assert.equal(scans.body.length, 1);
  assert.equal(scans.body[0].studentName, 'Aarav');
  assert.equal(scans.body[0].time, '08:50');
  assert.equal(scans.body[0].source, 'Main gate');
  assert.ok((await call('GET', `/api/institutions/${c.id}/devices`, { token: c.admin })).body[0].lastSeenAt);
});

test('devices resend after losing connection, and repeats are ignored', async () => {
  const c = await college();
  const d = await device(c);
  const batch = { scans: [{ identifier: 'A01', at: atIST('08:50'), scanId: 'same' }] };
  assert.equal((await post(d.key, batch)).body.accepted, 1);
  assert.deepEqual((await post(d.key, batch)).body, { accepted: 0, duplicates: 1, unmatched: [] });
  // A double-tap on the reader, moments apart, with no scan id.
  assert.equal((await post(d.key, { scans: [{ identifier: 'A01', at: atIST('08:50') }] })).body.duplicates, 1);
  assert.equal((await call('GET', `/api/institutions/${c.id}/scans?date=${MONDAY}`, { token: c.admin })).body.length, 1);
});

test('device input is checked', async () => {
  const c = await college();
  const d = await device(c);
  const future = new Date(Date.now() + 3600000).toISOString();
  const ancient = new Date(Date.now() - 30 * 86400000).toISOString();
  for (const body of [{}, { scans: 'x' }, { scans: [] }, { scans: Array(501).fill({ identifier: 'A01' }) }, { scans: [{}] }, { scans: [{ identifier: 5 }] }, { scans: [{ identifier: 'A01', at: 'noon' }] }, { scans: [{ identifier: 'A01', at: future }] }, { scans: [{ identifier: 'A01', at: ancient }] }]) {
    assert.equal((await post(d.key, body)).status, 400, JSON.stringify(body).slice(0, 60));
  }
});

test('arriving after the first class has started is marked late automatically, once', async () => {
  const c = await college();
  const d = await device(c);
  await post(d.key, { scans: [{ identifier: 'A01', at: atIST('09:25'), scanId: 'late' }] });
  await post(d.key, { scans: [{ identifier: 'A01', at: atIST('10:05'), scanId: 'again' }] });
  const events = (await call('GET', `/api/institutions/${c.id}/events?date=${MONDAY}`, { token: c.admin })).body;
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'late');
  assert.equal(events[0].minutesLate, 25);
  assert.equal(events[0].studentName, 'Aarav');
  assert.equal(events[0].recordedByName, 'Main gate');
  assert.equal(events[0].slot, SLOT1);
});

test('on time, or inside the grace period, is not late', async () => {
  const c = await college();
  const d = await device(c);
  await post(d.key, { scans: [{ identifier: 'A01', at: atIST('08:59'), scanId: 'a' }, { identifier: 'A02', at: atIST('09:10'), scanId: 'b' }] });
  assert.equal((await call('GET', `/api/institutions/${c.id}/events?date=${MONDAY}`, { token: c.admin })).body.length, 0);
});

test('someone with no class that day is never marked late', async () => {
  const c = await college();
  const d = await device(c);
  // SY B's only class is at 10:00; they're early. Then a Tuesday, with no classes at all.
  await post(d.key, { scans: [{ identifier: 'B01', at: atIST('09:30'), scanId: 'a' }] });
  const accepted = await post(d.key, { scans: [{ identifier: 'A01', at: atIST('11:30', TUESDAY), scanId: 'b' }] });
  assert.equal(accepted.body.accepted, 1, 'the scan itself was taken');
  assert.equal((await call('GET', `/api/institutions/${c.id}/events`, { token: c.admin })).body.length, 0);
});

test('a roll number two students share is refused, not guessed', async () => {
  const c = await college({ ...PROFILE, divisions: [{ id: 'd1', name: 'A', batches: [], students: [{ id: 's1', rollNo: '1', name: 'First' }] }, { id: 'd2', name: 'B', batches: [], students: [{ id: 's2', rollNo: '1', name: 'Second' }] }] });
  assert.equal((await scan(c, '1')).body.matched, false);
  const d = await device(c);
  assert.deepEqual((await post(d.key, { scans: [{ identifier: '1', at: atIST('08:50') }] })).body.unmatched, ['1']);
  const list = await call('GET', `/api/institutions/${c.id}/devices`, { token: c.admin });
  assert.deepEqual(list.body[0].unmatched, ['1'], 'the admin can see what it couldn’t place');
  // A signed card still works, because it names the student rather than a roll number.
  const [card] = await cardsFor(c);
  assert.equal((await scan(c, card.code)).body.student.name, 'First');
});

test('a classroom reader records presence but never marks anyone late', async () => {
  const c = await college();
  const d = await device(c, 'classroom', 'Room 1 reader');
  assert.equal((await post(d.key, { scans: [{ identifier: 'A01', at: atIST('09:40') }] })).body.accepted, 1);
  assert.equal((await call('GET', `/api/institutions/${c.id}/events?date=${MONDAY}`, { token: c.admin })).body.length, 0);
});

test('starting over clears attendance and scans too', async () => {
  const c = await college();
  await take(c, c.teacher);
  const d = await device(c);
  await post(d.key, { scans: [{ identifier: 'A01', at: atIST('08:50') }] });
  assert.equal((await call('DELETE', `/api/institutions/${c.id}/history`, { token: c.admin })).status, 200);
  assert.equal((await call('GET', `/api/institutions/${c.id}/attendance`, { token: c.admin })).body.length, 0);
  assert.equal((await call('GET', `/api/institutions/${c.id}/scans?date=${MONDAY}`, { token: c.admin })).body.length, 0);
});

test('a revoked device stops working at once', async () => {
  const c = await college();
  const d = await device(c);
  assert.equal((await call('DELETE', `/api/institutions/${c.id}/devices/${d.id}`, { token: c.teacher })).status, 404);
  assert.equal((await call('DELETE', `/api/institutions/${c.id}/devices/${d.id}`, { token: c.admin })).status, 200);
  assert.equal((await post(d.key, { scans: [{ identifier: 'A01' }] })).status, 401);
});

test('a paused college’s devices stop too', async () => {
  const c = await college();
  const d = await device(c);
  await store.setInstitutionFields(c.id, { status: 'paused' });
  assert.equal((await post(d.key, { scans: [{ identifier: 'A01' }] })).status, 401);
});

/* ---------- Other software ---------- */

test('an integration key reads students, attendance and the timetable, and writes nothing', async () => {
  const c = await college();
  await take(c, c.teacher);
  const key = (await device(c, 'integration', 'College ERP')).key;
  const get = (url) => call('GET', `/api/integration/v1/${url}`, { token: key });
  const students = await get('students');
  assert.equal(students.status, 200);
  assert.deepEqual(students.body[0], { id: 's1', rollNo: 'A01', name: 'Aarav', class: 'SY A', batch: null });
  assert.equal((await get('attendance')).body.length, 1);
  assert.equal((await get('timetable')).body.length, 3);
  assert.equal((await get('events')).status, 200);
  assert.equal((await post(key, { scans: [{ identifier: 'A01' }] })).status, 403);
});

test('a scanning device can’t read anything, and nobody reads without a key', async () => {
  const c = await college();
  const gate = (await device(c)).key;
  for (const url of ['students', 'attendance', 'timetable', 'events']) {
    assert.equal((await call('GET', `/api/integration/v1/${url}`, { token: gate })).status, 403, url);
    assert.equal((await call('GET', `/api/integration/v1/${url}`)).status, 401, url);
    assert.equal((await call('GET', `/api/integration/v1/${url}`, { token: c.admin })).status, 401, url);
  }
});

test('one college’s key only ever sees that college', async () => {
  const c = await college();
  const other = await college({ ...PROFILE, divisions: [{ id: 'dx', name: 'Elsewhere', batches: [], students: [{ id: 'z', rollNo: 'Z', name: 'Zed' }] }] });
  const key = (await device(c, 'integration')).key;
  const r = await call('GET', '/api/integration/v1/students', { token: key });
  assert.doesNotMatch(r.text, /Zed|Elsewhere/);
  assert.ok(other);
});

/* ---------- Time zones ---------- */

test('times are the college’s local time, whichever zone the server is in', () => {
  assert.deepEqual(localParts('2026-11-09T03:30:00.000Z', 'Asia/Kolkata'), { date: '2026-11-09', time: '09:00', day: 'Monday' });
  assert.deepEqual(localParts('2026-11-08T20:00:00.000Z', 'Asia/Kolkata'), { date: '2026-11-09', time: '01:30', day: 'Monday' });
});

/* ---------- The biometric plugin ---------- */

test('reading a biometric machine’s log, as machines actually vary', () => {
  const body = '1023\t2026-11-09 09:25:03\t0\t1\t0\t0\n\n  \nA01\t2026/11/09 08:50\t0\t15\nnot a record\n';
  assert.deepEqual(parseAttlog(body), [
    { pin: '1023', time: '2026-11-09 09:25:03' },
    { pin: 'A01', time: '2026-11-09 08:50:00' },
  ]);
});

test('a machine’s log line becomes a scan, in the college’s time zone, with a stable id', () => {
  const line = { pin: '1023', time: '2026-11-09 09:25:03' };
  const scan1 = deviceLineToScan(line, 'SN1', '+05:30');
  assert.equal(scan1.identifier, '1023');
  assert.equal(scan1.at, '2026-11-09T03:55:03.000Z');
  assert.equal(scan1.scanId, deviceLineToScan(line, 'SN1', '+05:30').scanId, 'resending gives the same id');
  assert.notEqual(scan1.scanId, deviceLineToScan(line, 'SN2', '+05:30').scanId);
});

test('speaking the machine’s protocol: handshake, upload, polling, and other tables', () => {
  const queued = [];
  const opts = { enqueue: (scans) => queued.push(...scans), offset: '+05:30' };
  const hello = handleIclock({ method: 'GET', path: '/iclock/cdata', query: { SN: 'SN1', options: 'all' } }, opts);
  assert.equal(hello.status, 200);
  assert.match(hello.body, /GET OPTION FROM: SN1/);
  assert.match(hello.body, /Realtime=1/);
  const up = handleIclock({ method: 'POST', path: '/iclock/cdata', query: { SN: 'SN1', table: 'ATTLOG' }, body: '1023\t2026-11-09 09:25:03\t0\t1\n1024\t2026-11-09 09:26:03\t0\t1\n' }, opts);
  assert.equal(up.body, 'OK: 2');
  assert.equal(queued.length, 2);
  assert.equal(handleIclock({ method: 'POST', path: '/iclock/cdata', query: { SN: 'SN1', table: 'OPERLOG' }, body: 'USER PIN=1\n' }, opts).body, 'OK');
  assert.equal(queued.length, 2, 'other tables are acknowledged, not treated as scans');
  assert.equal(handleIclock({ method: 'GET', path: '/iclock/getrequest', query: { SN: 'SN1' } }, opts).body, 'OK');
  assert.equal(handleIclock({ method: 'GET', path: '/somewhere', query: {} }, opts).status, 404);
  assert.equal(handleIclock({ method: 'POST', path: '/iclock/cdata', query: { table: 'ATTLOG' }, body: 'x' }, opts).status, 400, 'no serial number');
});

test('end to end: a machine’s punch through the plugin marks a real student late', async () => {
  const c = await college();
  const key = (await device(c, 'gate', 'Biometric gate')).key;
  const bridge = createBridge({ url: base, key, offset: '+05:30', queueFile: path.join(dir, `q${(n += 1)}.json`) });
  handleIclock({ method: 'POST', path: '/iclock/cdata', query: { SN: 'SN1', table: 'ATTLOG' }, body: `A01\t${MONDAY} 09:25:00\t0\t1\nWHO\t${MONDAY} 09:26:00\t0\t1\n` }, { enqueue: bridge.enqueue, offset: '+05:30' });
  const result = await bridge.flush();
  assert.equal(result.sent, 2);
  assert.deepEqual(result.unmatched, ['WHO']);
  assert.equal(bridge.pending(), 0);
  const events = (await call('GET', `/api/institutions/${c.id}/events?date=${MONDAY}`, { token: c.admin })).body;
  assert.equal(events[0].minutesLate, 25);
  assert.equal(events[0].recordedByName, 'Biometric gate');
});

test('the plugin keeps scans safe while the server is down, across restarts', async () => {
  const c = await college();
  const key = (await device(c)).key;
  const queueFile = path.join(dir, `q${(n += 1)}.json`);
  const down = createBridge({ url: 'http://127.0.0.1:9', key, offset: '+05:30', queueFile });
  down.enqueue([deviceLineToScan({ pin: 'A01', time: `${MONDAY} 08:50:00` }, 'SN1', '+05:30')]);
  const failed = await down.flush();
  assert.equal(failed.sent, 0);
  assert.ok(failed.error);
  assert.equal(down.pending(), 1);
  const restarted = createBridge({ url: base, key, offset: '+05:30', queueFile });
  assert.equal(restarted.pending(), 1, 'still there after a restart');
  assert.equal((await restarted.flush()).sent, 1);
  assert.equal(restarted.pending(), 0);
});

test('a wrong key is reported and keeps the scans, rather than losing them', async () => {
  const bridge = createBridge({ url: base, key: 'tfd_wrong', offset: '+05:30', queueFile: path.join(dir, `q${(n += 1)}.json`) });
  bridge.enqueue([deviceLineToScan({ pin: 'A01', time: '2026-11-09 08:50:00' }, 'SN1', '+05:30')]);
  const r = await bridge.flush();
  assert.match(r.error, /401/);
  assert.equal(bridge.pending(), 1);
});
