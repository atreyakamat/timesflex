// Students tapping in from their own phone, only on the department's Wi-Fi.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createApp } from '../src/app.js';
import { networkFor, parseNetwork } from '../src/checkin.js';
import { createFileStore, createPgStore } from '../src/db.js';

/* ---------- Networks: pure ---------- */

test('addresses and ranges are checked and tidied', () => {
  assert.equal(parseNetwork('203.0.113.7').cidr, '203.0.113.7/32');
  assert.equal(parseNetwork(' 10.20.0.0/16 ').cidr, '10.20.0.0/16');
  assert.equal(parseNetwork('2001:db8::1').cidr, '2001:db8::1/128');
  assert.equal(parseNetwork('2001:db8:1::/48').cidr, '2001:db8:1::/48');
});

test('nonsense, and ranges so wide they prove nothing, are refused', () => {
  for (const bad of ['', 'wifi', '999.1.1.1', '10.0.0.0/33', '10.0.0.0/x', '10.0.0.0/', '0.0.0.0/0', '10.0.0.0/8', '::/0', '2001::/16', null, 5]) {
    assert.equal(parseNetwork(bad), null, String(bad));
  }
});

test('an address is inside a network or it isn’t', () => {
  const networks = [{ id: 'a', label: 'CS lab', cidr: '10.20.0.0/16' }, { id: 'b', label: 'Office', cidr: '203.0.113.7/32' }, { id: 'c', label: 'Six', cidr: '2001:db8:1::/48' }];
  assert.equal(networkFor(networks, '10.20.5.9').label, 'CS lab');
  assert.equal(networkFor(networks, '::ffff:10.20.5.9').label, 'CS lab', 'IPv4 as Node often reports it');
  assert.equal(networkFor(networks, '203.0.113.7').label, 'Office');
  assert.equal(networkFor(networks, '2001:db8:1:2::9').label, 'Six');
  for (const out of ['10.21.0.1', '203.0.113.8', '2001:db8:2::1', 'junk', '', undefined]) assert.equal(networkFor(networks, out), null, String(out));
});

/* ---------- Through the API ---------- */

// Behind nginx, as in production. Tests say where a request comes from the way nginx would.
process.env.TRUST_PROXY = '1';
const MONDAY = '2026-11-09';
const atIST = (hhmm, date = MONDAY) => Date.parse(`${date}T${hhmm}:00+05:30`);
let clock = atIST('09:20');
const dir = mkdtempSync(path.join(os.tmpdir(), 'timesflex-checkin-'));
const store = process.env.TEST_DATABASE_URL ? await createPgStore(process.env.TEST_DATABASE_URL) : await createFileStore(path.join(dir, 'data.json'));
const server = createApp({ store, solve: async () => ({}), now: () => clock }).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(async () => {
  server.close();
  await store.close?.();
  rmSync(dir, { recursive: true, force: true });
});
test.beforeEach(() => {
  clock = atIST('09:20');
});

const WIFI = '203.0.113.7';
const AWAY = '198.51.100.9';
const call = async (method, url, { body, token, ip = WIFI, headers = {} } = {}) => {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(token && { Authorization: `Bearer ${token}` }), ...headers },
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
const session = (id, slot, division = 'd1', extra = {}) => ({ id, subject_id: 'sub', teacher_id: 't1', division_id: division, room_id: 'r', day: 'Monday', slot, batch: null, duration_slots: 1, kind: 'lecture', ...extra });
const college = async ({ networks = [{ label: 'Dept', cidr: WIFI }], enabled = true } = {}) => {
  const { body } = await call('POST', '/api/auth/signup', { body: { name: 'Admin', email: `c${(n += 1)}@example.test`, password: PASSWORD, institutionName: 'WiFi College' } });
  const id = body.institution.id;
  const profile = {
    institution: { name: 'WiFi College', workingDays: ['Monday'], startTime: '09:00', endTime: '11:00', slotDurationMinutes: 60 },
    teachers: [{ id: 't1', name: 'Mehta' }],
    subjects: [{ id: 'sub', name: 'DBMS' }],
    divisions: [{ id: 'd1', name: 'SY A', batches: [], students: [{ id: 's1', rollNo: 'A01', name: 'Aarav' }, { id: 's2', rollNo: 'A02', name: 'Diya' }] }],
  };
  await call('PUT', `/api/institutions/${id}`, { token: body.token, body: { name: 'WiFi College', type: 'college', profile } });
  const tt = await call('POST', `/api/institutions/${id}/timetables`, { token: body.token, body: { label: 'V', request: { days: [], slots: [], sessions: [] } } });
  await call('PUT', `/api/timetables/${tt.body.id}`, { token: body.token, body: { status: 'approved', generatedSessions: [session('first', '09:00-10:00'), session('second', '10:00-11:00')] } });
  await call('PUT', `/api/institutions/${id}/checkin`, { token: body.token, body: { enabled, networks } });
  const invite = await call('POST', `/api/institutions/${id}/invites`, { token: body.token, body: { teacherId: 't1' } });
  const joined = await call('POST', '/api/auth/join', { body: { code: invite.body.code, name: 'Mehta', email: `ct${(n += 1)}@example.test`, password: PASSWORD } });
  return { id, admin: body.token, teacher: joined.body.token };
};
const linkFor = async (c, studentId = 's1') => (await call('POST', `/api/institutions/${c.id}/checkin/links`, { token: c.admin, body: { studentId } })).body[0].code;
const phone = async (c, studentId = 's1') => (await call('POST', '/api/student/v1/claim', { body: { code: await linkFor(c, studentId) } })).body.token;
const tap = (token, ip = WIFI) => call('POST', '/api/student/v1/checkin', { token, ip, body: {} });

test('the admin adds department networks, and sees the address they’re on now', async () => {
  const c = await college({ networks: [] });
  const saved = await call('PUT', `/api/institutions/${c.id}/checkin`, { token: c.admin, body: { enabled: true, networks: [{ label: 'CS lab', cidr: '203.0.113.0/24' }] } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.networks[0].cidr, '203.0.113.0/24');
  const read = await call('GET', `/api/institutions/${c.id}/checkin`, { token: c.admin });
  assert.equal(read.body.yourIp, WIFI);
  assert.equal(read.body.onNetwork, 'CS lab');
  assert.equal((await call('GET', `/api/institutions/${c.id}/checkin`, { token: c.admin, ip: AWAY })).body.onNetwork, null);
});

test('bad network settings are refused, and say which one', async () => {
  const c = await college();
  const put = (body) => call('PUT', `/api/institutions/${c.id}/checkin`, { token: c.admin, body });
  const wide = await put({ enabled: true, networks: [{ label: 'All', cidr: '0.0.0.0/0' }] });
  assert.equal(wide.status, 400);
  assert.match(wide.body.error, /0\.0\.0\.0\/0/);
  for (const body of [{}, { enabled: 'yes', networks: [] }, { enabled: true, networks: 'x' }, { enabled: true, networks: [{ label: '', cidr: WIFI }] }, { enabled: true, networks: [{ label: 'x'.repeat(61), cidr: WIFI }] }, { enabled: true, networks: Array(51).fill({ label: 'a', cidr: WIFI }) }]) {
    assert.equal((await put(body)).status, 400, JSON.stringify(body).slice(0, 50));
  }
  assert.equal((await put({ enabled: true, networks: [] })).status, 400, 'turning it on needs at least one network');
});

test('settings survive the admin app saving its copy of the college', async () => {
  const c = await college();
  await call('PUT', `/api/institutions/${c.id}`, { token: c.admin, body: { name: 'WiFi College', type: 'college', profile: { institution: {} } } });
  assert.equal((await call('GET', `/api/institutions/${c.id}/checkin`, { token: c.admin })).body.networks.length, 1);
  const me = await call('GET', '/api/auth/me', { token: c.admin });
  assert.doesNotMatch(me.text, /checkin|203\.0\.113/);
});

test('only the college’s admin manages check-in', async () => {
  const c = await college();
  const other = await college();
  for (const token of [c.teacher, other.admin]) {
    assert.equal((await call('GET', `/api/institutions/${c.id}/checkin`, { token })).status, 404);
    assert.equal((await call('PUT', `/api/institutions/${c.id}/checkin`, { token, body: { enabled: false, networks: [] } })).status, 404);
    assert.equal((await call('POST', `/api/institutions/${c.id}/checkin/links`, { token, body: { studentId: 's1' } })).status, 404);
    assert.equal((await call('GET', `/api/institutions/${c.id}/checkin/students`, { token })).status, 404);
    assert.equal((await call('DELETE', `/api/institutions/${c.id}/checkin/students/s1`, { token })).status, 404);
  }
  assert.equal((await call('GET', `/api/institutions/${c.id}/checkin`)).status, 401);
});

test('links are made for one student or a class, and must name real ones', async () => {
  const c = await college();
  const post = (body) => call('POST', `/api/institutions/${c.id}/checkin/links`, { token: c.admin, body });
  const whole = await post({ divisionId: 'd1' });
  assert.equal(whole.status, 201);
  assert.deepEqual(whole.body.map((row) => row.name), ['Aarav', 'Diya']);
  assert.match(whole.body[0].code, /^[\w-]{40,}$/);
  for (const body of [{}, { studentId: 'ghost' }, { divisionId: 'ghost' }, { studentId: 5 }]) assert.equal((await post(body)).status, 400, JSON.stringify(body));
});

test('a link works once and only its hash is kept', async () => {
  const c = await college();
  const code = await linkFor(c);
  const peek = await call('GET', `/api/student/v1/link/${code}`);
  assert.equal(peek.body.name, 'Aarav');
  assert.equal(peek.body.college, 'WiFi College');
  const claimed = await call('POST', '/api/student/v1/claim', { body: { code } });
  assert.equal(claimed.status, 201);
  assert.match(claimed.body.token, /^tfs_/);
  assert.equal((await call('POST', '/api/student/v1/claim', { body: { code } })).status, 410, 'a friend can’t reuse it');
  assert.equal((await call('GET', `/api/student/v1/link/${code}`)).status, 410);
  for (const body of [{}, { code: 5 }, { code: 'made-up' }, { code: 'x'.repeat(500) }]) assert.equal((await call('POST', '/api/student/v1/claim', { body })).status, 410);
});

test('a newer link replaces the unused one, and moving phones signs out the old one', async () => {
  const c = await college();
  const stale = await linkFor(c);
  const fresh = await linkFor(c);
  assert.equal((await call('POST', '/api/student/v1/claim', { body: { code: stale } })).status, 410);
  const first = (await call('POST', '/api/student/v1/claim', { body: { code: fresh } })).body.token;
  const second = await phone(c);
  assert.equal((await tap(first)).status, 401);
  assert.equal((await tap(second)).status, 201);
});

test('on the department Wi-Fi during class, a tap is recorded against that class', async () => {
  const c = await college();
  const r = await tap(await phone(c));
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'recorded');
  assert.equal(r.body.subject, 'DBMS');
  const scans = (await call('GET', `/api/institutions/${c.id}/scans?date=${MONDAY}`, { token: c.teacher })).body;
  assert.equal(scans.length, 1);
  assert.equal(scans[0].studentName, 'Aarav');
  assert.equal(scans[0].sessionId, 'first');
  assert.equal(scans[0].time, '09:20');
  assert.equal(scans[0].source, 'Phone on Dept');
});

test('off the Wi-Fi nothing is recorded, whatever the phone claims', async () => {
  const c = await college();
  const token = await phone(c);
  const away = await tap(token, AWAY);
  assert.equal(away.status, 403);
  assert.match(away.body.error, /Wi-?Fi/i);
  // Someone adding their own header: nginx appends the real address, and that's the one believed.
  assert.equal((await tap(token, `${WIFI}, ${AWAY}`)).status, 403);
  // Trying to choose the time or the student in the body changes nothing.
  assert.equal((await call('POST', '/api/student/v1/checkin', { token, ip: AWAY, body: { ip: WIFI, onCampus: true } })).status, 403);
  assert.equal((await call('GET', `/api/institutions/${c.id}/scans?date=${MONDAY}`, { token: c.admin })).body.length, 0);
});

test('a second tap in the same class is harmless; the next class is a new one', async () => {
  const c = await college();
  const token = await phone(c);
  await tap(token);
  const again = await tap(token);
  assert.equal(again.status, 200);
  assert.equal(again.body.status, 'already');
  clock = atIST('10:05');
  assert.equal((await tap(token)).body.subject, 'DBMS');
  const scans = (await call('GET', `/api/institutions/${c.id}/scans?date=${MONDAY}`, { token: c.admin })).body;
  assert.deepEqual(scans.map((s) => s.sessionId), ['first', 'second']);
});

test('tapping in just after a gate scan still counts for the class', async () => {
  const c = await college();
  const token = await phone(c);
  const device = (await call('POST', `/api/institutions/${c.id}/devices`, { token: c.admin, body: { name: 'Gate', kind: 'classroom' } })).body;
  await call('POST', '/api/device/v1/scans', { token: device.key, body: { scans: [{ identifier: 'A01', at: new Date(clock - 5000).toISOString() }] } }).catch(() => {});
  await store.addScan(c.id, { id: 'gate-1', studentId: 's1', studentName: 'Aarav', rollNo: 'A01', divisionId: 'd1', divisionName: 'SY A', at: new Date(clock - 5000).toISOString(), date: MONDAY, time: '09:19', source: 'Gate', gate: true, createdAt: 'x' });
  assert.equal((await tap(token)).status, 201);
});

test('tapping only works around a class', async () => {
  const c = await college();
  const token = await phone(c);
  clock = atIST('08:30');
  assert.equal((await tap(token)).status, 409);
  clock = atIST('08:55');
  assert.equal((await tap(token)).status, 201, 'ten minutes early is fine');
  clock = atIST('11:01');
  assert.equal((await tap(token)).status, 409, 'after the last class');
  clock = atIST('09:30', '2026-11-10');
  assert.equal((await tap(token)).status, 409, 'no classes that day');
});

test('a long lab counts for its whole length', async () => {
  const c = await college();
  const tt = (await call('GET', `/api/institutions/${c.id}/timetables`, { token: c.admin })).body[0];
  await call('PUT', `/api/timetables/${tt.id}`, { token: c.admin, body: { generatedSessions: [session('lab', '09:00-10:00', 'd1', { duration_slots: 2 })] } });
  clock = atIST('10:45');
  assert.equal((await tap(await phone(c))).status, 201);
});

test('a batch’s class is only for that batch', async () => {
  const c = await college();
  const inst = await store.getInstitution(c.id);
  inst.data.divisions[0].students[0].batch = 'B1';
  await store.updateInstitution(c.id, inst);
  const tt = (await call('GET', `/api/institutions/${c.id}/timetables`, { token: c.admin })).body[0];
  await call('PUT', `/api/timetables/${tt.id}`, { token: c.admin, body: { generatedSessions: [session('b2lab', '09:00-10:00', 'd1', { batch: 'B2' })] } });
  assert.equal((await tap(await phone(c))).status, 409);
});

test('the student’s page says what they can do, and shows only their own', async () => {
  const c = await college();
  const token = await phone(c);
  const here = await call('GET', '/api/student/v1/me', { token });
  assert.equal(here.body.name, 'Aarav');
  assert.equal(here.body.className, 'SY A');
  assert.equal(here.body.onNetwork, true);
  assert.equal(here.body.session.subject, 'DBMS');
  assert.equal(here.body.session.checkedIn, false);
  await tap(token);
  assert.equal((await call('GET', '/api/student/v1/me', { token })).body.session.checkedIn, true);
  assert.equal((await call('GET', '/api/student/v1/me', { token, ip: AWAY })).body.onNetwork, false);
  assert.doesNotMatch(here.text, /Diya|203\.0\.113/);
});

test('a phone’s token only opens the student’s own page', async () => {
  const c = await college();
  const token = await phone(c);
  assert.equal((await call('GET', '/api/auth/me', { token })).status, 401);
  assert.equal((await call('GET', `/api/institutions/${c.id}/scans`, { token })).status, 401);
  assert.equal((await call('POST', '/api/device/v1/scans', { token, body: { scans: [{ identifier: 'A02' }] } })).status, 401);
  assert.equal((await tap(c.admin)).status, 401, 'and a login isn’t a phone');
  assert.equal((await tap(undefined)).status, 401);
  assert.equal((await tap('tfs_madeup')).status, 401);
});

test('turning it off, pausing the college, unlinking or removing the student all stop taps', async () => {
  const c = await college();
  const token = await phone(c);
  await call('PUT', `/api/institutions/${c.id}/checkin`, { token: c.admin, body: { enabled: false, networks: [] } });
  assert.equal((await tap(token)).status, 403);
  await call('PUT', `/api/institutions/${c.id}/checkin`, { token: c.admin, body: { enabled: true, networks: [{ label: 'Dept', cidr: WIFI }] } });

  const list = (await call('GET', `/api/institutions/${c.id}/checkin/students`, { token: c.admin })).body;
  assert.deepEqual(list.map((row) => [row.name, row.phone]), [['Aarav', true], ['Diya', false]]);
  assert.equal((await call('DELETE', `/api/institutions/${c.id}/checkin/students/s1`, { token: c.admin })).status, 200);
  assert.equal((await tap(token)).status, 401);

  const again = await phone(c, 's2');
  await store.setInstitutionFields(c.id, { status: 'paused' });
  assert.equal((await tap(again)).status, 401);
  await store.setInstitutionFields(c.id, { status: 'active' });
  const inst = await store.getInstitution(c.id);
  inst.data.divisions[0].students = inst.data.divisions[0].students.filter((s) => s.id !== 's2');
  await store.updateInstitution(c.id, inst);
  assert.equal((await tap(again)).status, 401);
});
