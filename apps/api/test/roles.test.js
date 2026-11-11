// Integration: teacher accounts, student marks, and who may do what. Runs against the file store,
// and against PostgreSQL too when TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createApp } from '../src/app.js';
import { createFileStore, createPgStore } from '../src/db.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'timesflex-roles-'));
const store = process.env.TEST_DATABASE_URL ? await createPgStore(process.env.TEST_DATABASE_URL) : await createFileStore(path.join(dir, 'data.json'));
const server = createApp({ store, solve: async (r) => ({ status: 'ok', scheduled_sessions: r.sessions, unscheduled_sessions: [], diagnostics: [] }) }).listen(0);
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

const unique = (() => {
  let n = Date.now();
  return () => (n += 1);
})();
const PASSWORD = 'password-1234';
const today = () => new Date().toISOString().slice(0, 10);

const PROFILE = {
  institution: { name: 'Goa College', workingDays: ['Monday'] },
  teachers: [
    { id: 't1', name: 'Prof. Mehta', phone: '9876543210', email: 'mehta@private.test' },
    { id: 't2', name: 'Dr. Rao', phone: '9876543211' },
  ],
  subjects: [{ id: 'sub', name: 'DBMS' }],
  rooms: [{ id: 'r', name: 'Room 1' }],
  divisions: [
    { id: 'd1', name: 'SY A', batches: [], students: [{ id: 's1', rollNo: 'A01', name: 'Aarav Patil' }, { id: 's2', rollNo: 'A02', name: 'Diya Rao' }] },
  ],
  operations: { absences: [{ id: 'x', date: '2026-01-01', teacherId: 't1' }], substitutions: [], attendance: [] },
  learning: { secret: 'coordinator-only' },
};

/** A college with its admin, and a teacher who has joined by invite. */
const college = async () => {
  const email = `admin${unique()}@example.test`;
  const { body } = await call('POST', '/api/auth/signup', { body: { name: 'Admin', email, password: PASSWORD, institutionName: 'Goa College' } });
  const id = body.institution.id;
  await call('PUT', `/api/institutions/${id}`, { token: body.token, body: { name: 'Goa College', type: 'college', profile: PROFILE } });
  const invite = await call('POST', `/api/institutions/${id}/invites`, { token: body.token, body: { teacherId: 't1' } });
  const teacherEmail = `teacher${unique()}@example.test`;
  const joined = await call('POST', '/api/auth/join', { body: { code: invite.body.code, name: 'Anita Mehta', email: teacherEmail, password: PASSWORD } });
  return { id, admin: body.token, adminEmail: email, teacher: joined.body?.token, teacherEmail, invite: invite.body, joined };
};
const mark = (id, token, extra = {}) => call('POST', `/api/institutions/${id}/events`, { token, body: { studentId: 's1', kind: 'late', date: today(), minutesLate: 10, ...extra } });

/* ---------- Invites ---------- */

test('a teacher joins with an invite and becomes that teacher', async () => {
  const c = await college();
  assert.equal(c.invite.code.length > 20, true);
  assert.equal(c.joined.status, 201);
  assert.equal(c.joined.body.role, 'teacher');
  assert.equal(c.joined.body.teacherId, 't1');
  assert.equal(c.joined.body.institution.name, 'Goa College');
});

test('an invite shows who it is for before joining, without revealing anything else', async () => {
  const email = `a${unique()}@example.test`;
  const { body } = await call('POST', '/api/auth/signup', { body: { name: 'A', email, password: PASSWORD, institutionName: 'Goa College' } });
  await call('PUT', `/api/institutions/${body.institution.id}`, { token: body.token, body: { name: 'Goa College', type: 'college', profile: PROFILE } });
  const { body: invite } = await call('POST', `/api/institutions/${body.institution.id}/invites`, { token: body.token, body: { teacherId: 't1' } });
  const peek = await call('GET', `/api/auth/invite/${invite.code}`);
  assert.deepEqual(peek.body, { college: 'Goa College', teacher: 'Prof. Mehta', role: 'teacher' });
});

test('an invite works once only', async () => {
  const c = await college();
  const again = await call('POST', '/api/auth/join', { body: { code: c.invite.code, name: 'X', email: `x${unique()}@example.test`, password: PASSWORD } });
  assert.equal(again.status, 410);
});

test('made-up, expired and withdrawn invites are refused', async () => {
  const fake = await call('POST', '/api/auth/join', { body: { code: 'not-a-real-code', name: 'X', email: `x${unique()}@example.test`, password: PASSWORD } });
  assert.equal(fake.status, 410);
  assert.equal((await call('GET', '/api/auth/invite/not-a-real-code')).status, 410);

  const c = await college();
  const second = await call('POST', `/api/institutions/${c.id}/invites`, { token: c.admin, body: { teacherId: 't2' } });
  await store.expireInviteForTest?.(second.body.id);
  if (store.expireInviteForTest) assert.equal((await call('GET', `/api/auth/invite/${second.body.code}`)).status, 410);
  const third = await call('POST', `/api/institutions/${c.id}/invites`, { token: c.admin, body: { teacherId: 't2' } });
  assert.equal((await call('DELETE', `/api/institutions/${c.id}/invites/${third.body.id}`, { token: c.admin })).status, 200);
  assert.equal((await call('GET', `/api/auth/invite/${third.body.code}`)).status, 410);
});

test('a new invite for a teacher replaces the old one', async () => {
  const c = await college();
  const a = await call('POST', `/api/institutions/${c.id}/invites`, { token: c.admin, body: { teacherId: 't2' } });
  const b = await call('POST', `/api/institutions/${c.id}/invites`, { token: c.admin, body: { teacherId: 't2' } });
  assert.equal((await call('GET', `/api/auth/invite/${a.body.code}`)).status, 410);
  assert.equal((await call('GET', `/api/auth/invite/${b.body.code}`)).status, 200);
});

test('only an admin can invite, and only one of their own teachers', async () => {
  const c = await college();
  const other = await college();
  assert.equal((await call('POST', `/api/institutions/${c.id}/invites`, { token: c.teacher, body: { teacherId: 't2' } })).status, 404);
  assert.equal((await call('POST', `/api/institutions/${c.id}/invites`, { token: other.admin, body: { teacherId: 't2' } })).status, 404);
  assert.equal((await call('POST', `/api/institutions/${c.id}/invites`, { token: c.admin, body: { teacherId: 'stranger' } })).status, 400);
});

test('the invite list never contains codes', async () => {
  const c = await college();
  await call('POST', `/api/institutions/${c.id}/invites`, { token: c.admin, body: { teacherId: 't2' } });
  const list = await call('GET', `/api/institutions/${c.id}/invites`, { token: c.admin });
  assert.equal(list.status, 200);
  assert.ok(list.body.length >= 1);
  assert.doesNotMatch(list.text, /code|tokenHash|token_hash/);
  assert.equal(list.body.find((i) => i.teacherId === 't2').status, 'waiting');
  assert.equal(list.body.find((i) => i.teacherId === 't1').status, 'joined');
});

test('someone with an account joins with their password, and a wrong one is refused', async () => {
  const c = await college();
  const invite = await call('POST', `/api/institutions/${c.id}/invites`, { token: c.admin, body: { teacherId: 't2' } });
  const other = await college();
  const wrong = await call('POST', '/api/auth/join', { body: { code: invite.body.code, name: 'X', email: other.teacherEmail, password: 'wrong-password' } });
  assert.equal(wrong.status, 401);
  assert.equal((await call('GET', `/api/auth/invite/${invite.body.code}`)).status, 200, 'a failed attempt must not use up the invite');
  const right = await call('POST', '/api/auth/join', { body: { code: invite.body.code, name: 'X', email: other.teacherEmail, password: PASSWORD } });
  assert.equal(right.status, 200);
});

test('joining checks its input', async () => {
  const c = await college();
  const invite = await call('POST', `/api/institutions/${c.id}/invites`, { token: c.admin, body: { teacherId: 't2' } });
  const bad = [
    { name: '', email: `a${unique()}@example.test`, password: PASSWORD },
    { name: 'X', email: 'not-an-email', password: PASSWORD },
    { name: 'X', email: `a${unique()}@example.test`, password: 'short' },
    { name: 'X', email: `a${unique()}@example.test`, password: 'p'.repeat(500) },
  ];
  for (const fields of bad) assert.equal((await call('POST', '/api/auth/join', { body: { code: invite.body.code, ...fields } })).status, 400, JSON.stringify(fields).slice(0, 60));
});

/* ---------- What a teacher can and can't see or do ---------- */

test('a teacher signing in lands on their college, as a teacher', async () => {
  const c = await college();
  const login = await call('POST', '/api/auth/login', { body: { email: c.teacherEmail, password: PASSWORD } });
  assert.equal(login.body.role, 'teacher');
  const me = await call('GET', '/api/auth/me', { token: c.teacher });
  assert.equal(me.body.role, 'teacher');
  assert.equal(me.body.teacherId, 't1');
});

test('an admin is told they are an admin', async () => {
  const c = await college();
  assert.equal((await call('GET', '/api/auth/me', { token: c.admin })).body.role, 'admin');
});

test('a teacher’s session carries none of the college’s private data', async () => {
  const c = await college();
  const me = await call('GET', '/api/auth/me', { token: c.teacher });
  assert.doesNotMatch(me.text, /9876543210|mehta@private|coordinator-only|absences/);
});

test('the classroom view has names and class lists, without colleagues’ numbers or admin data', async () => {
  const c = await college();
  const room = await call('GET', `/api/institutions/${c.id}/classroom`, { token: c.teacher });
  assert.equal(room.status, 200);
  assert.deepEqual(room.body.teachers, [{ id: 't1', name: 'Prof. Mehta' }, { id: 't2', name: 'Dr. Rao' }]);
  assert.equal(room.body.divisions[0].students[0].name, 'Aarav Patil');
  assert.doesNotMatch(room.text, /9876543210|mehta@private|coordinator-only|absences|learning|operations/);
});

test('the classroom view shows the approved timetable, not drafts', async () => {
  const c = await college();
  const request = { days: ['Monday'], slots: ['a'], sessions: [{ id: 'x', subject_id: 'sub', teacher_id: 't1', division_id: 'd1' }] };
  const draft = await call('POST', `/api/institutions/${c.id}/timetables`, { token: c.admin, body: { label: 'V', request } });
  await call('PUT', `/api/timetables/${draft.body.id}`, { token: c.admin, body: { generatedSessions: [{ id: 'draft' }] } });
  assert.deepEqual((await call('GET', `/api/institutions/${c.id}/classroom`, { token: c.teacher })).body.sessions, []);
  await call('PUT', `/api/timetables/${draft.body.id}`, { token: c.admin, body: { generatedSessions: [{ id: 'live' }], status: 'approved' } });
  assert.deepEqual((await call('GET', `/api/institutions/${c.id}/classroom`, { token: c.teacher })).body.sessions, [{ id: 'live' }]);
});

test('teachers can’t reach anything an admin controls', async () => {
  const c = await college();
  const t = await call('POST', `/api/institutions/${c.id}/timetables`, { token: c.admin, body: { label: 'V', request: { days: [], slots: [], sessions: [] } } });
  const attempts = [
    ['GET', `/api/institutions/${c.id}`],
    ['PUT', `/api/institutions/${c.id}`, { name: 'Hacked', type: 'college', profile: {} }],
    ['DELETE', `/api/institutions/${c.id}`],
    ['DELETE', `/api/institutions/${c.id}/history`],
    ['PUT', `/api/institutions/${c.id}/operations`, { absences: [], substitutions: [], attendance: [] }],
    ['GET', `/api/institutions/${c.id}/timetables`],
    ['POST', `/api/institutions/${c.id}/timetables`, { request: { days: [], slots: [], sessions: [] } }],
    ['GET', `/api/timetables/${t.body.id}`],
    ['PUT', `/api/timetables/${t.body.id}`, { status: 'approved' }],
    ['POST', `/api/timetables/${t.body.id}/solve`],
    ['GET', `/api/institutions/${c.id}/notices`],
    ['GET', `/api/institutions/${c.id}/invites`],
    ['GET', `/api/institutions/${c.id}/members`],
  ];
  for (const [method, url, body] of attempts) {
    const r = await call(method, url, { token: c.teacher, body });
    assert.equal(r.status, 404, `${method} ${url} gave ${r.status}`);
  }
});

test('nobody outside a college can reach its classroom or marks', async () => {
  const c = await college();
  const other = await college();
  for (const token of [other.admin, other.teacher]) {
    assert.equal((await call('GET', `/api/institutions/${c.id}/classroom`, { token })).status, 404);
    assert.equal((await call('GET', `/api/institutions/${c.id}/events`, { token })).status, 404);
    assert.equal((await mark(c.id, token)).status, 404);
  }
  assert.equal((await call('GET', `/api/institutions/${c.id}/classroom`)).status, 401);
});

/* ---------- Marking students ---------- */

test('a teacher marks a student late, with a remark, and the record is complete', async () => {
  const c = await college();
  const r = await mark(c.id, c.teacher, { note: 'Bus was late', time: '09:12', slot: 'a' });
  assert.equal(r.status, 201);
  const e = r.body;
  assert.equal(e.studentName, 'Aarav Patil');
  assert.equal(e.rollNo, 'A01');
  assert.equal(e.divisionName, 'SY A');
  assert.equal(e.kind, 'late');
  assert.equal(e.minutesLate, 10);
  assert.equal(e.note, 'Bus was late');
  assert.equal(e.recordedByName, 'Anita Mehta');
  assert.equal(e.status, 'reviewed', 'late marks need no review');
});

test('any teacher can flag a student seen outside or bunking, and it waits for review', async () => {
  const c = await college();
  for (const kind of ['outside', 'bunked']) {
    const r = await mark(c.id, c.teacher, { kind, minutesLate: undefined, note: 'Near the canteen' });
    assert.equal(r.status, 201);
    assert.equal(r.body.status, 'open');
    assert.equal(r.body.minutesLate, undefined);
  }
});

test('the admin can mark students too', async () => {
  const c = await college();
  assert.equal((await mark(c.id, c.admin)).status, 201);
});

test('marks refuse bad input', async () => {
  const c = await college();
  const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const old = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const bad = [
    { studentId: 'not-in-this-college' },
    { kind: 'expelled' },
    { date: 'yesterday' },
    { date: future },
    { date: old },
    { minutesLate: 0 },
    { minutesLate: 9999 },
    { minutesLate: 'ten' },
    { note: 'x'.repeat(1001) },
    { note: { a: 1 } },
    { kind: 'other', minutesLate: undefined, note: '' },
    { time: 'noon' },
  ];
  for (const extra of bad) assert.equal((await mark(c.id, c.teacher, extra)).status, 400, JSON.stringify(extra).slice(0, 50));
});

test('tapping late twice for the same class doesn’t make two records', async () => {
  const c = await college();
  const a = await mark(c.id, c.teacher, { slot: 'a' });
  const b = await mark(c.id, c.teacher, { slot: 'a' });
  assert.equal(b.status, 200);
  assert.equal(b.body.id, a.body.id);
  const c2 = await mark(c.id, c.teacher, { slot: 'b' });
  assert.equal(c2.status, 201);
});

test('a teacher sees their own marks; the admin sees everyone’s', async () => {
  const c = await college();
  await mark(c.id, c.teacher, { kind: 'bunked', minutesLate: undefined });
  await mark(c.id, c.admin, { studentId: 's2', kind: 'outside', minutesLate: undefined });
  const mine = await call('GET', `/api/institutions/${c.id}/events`, { token: c.teacher });
  assert.equal(mine.body.length, 1);
  assert.equal(mine.body[0].recordedByName, 'Anita Mehta');
  // A teacher can't widen this by asking.
  const widened = await call('GET', `/api/institutions/${c.id}/events?recordedBy=everyone&all=1`, { token: c.teacher });
  assert.equal(widened.body.length, 1);
  assert.equal((await call('GET', `/api/institutions/${c.id}/events`, { token: c.admin })).body.length, 2);
});

test('the admin can filter by student, kind and status', async () => {
  const c = await college();
  await mark(c.id, c.teacher);
  await mark(c.id, c.teacher, { kind: 'bunked', minutesLate: undefined });
  await mark(c.id, c.teacher, { studentId: 's2', kind: 'outside', minutesLate: undefined });
  const q = async (s) => (await call('GET', `/api/institutions/${c.id}/events?${s}`, { token: c.admin })).body.length;
  assert.equal(await q('studentId=s2'), 1);
  assert.equal(await q('kind=late'), 1);
  assert.equal(await q('status=open'), 2);
  assert.equal(await q(`date=${today()}`), 3);
  assert.equal(await q('date=2000-01-01'), 0);
});

test('the admin reviews a flag with an outcome; a teacher can’t', async () => {
  const c = await college();
  const { body: flag } = await mark(c.id, c.teacher, { kind: 'bunked', minutesLate: undefined });
  assert.equal((await call('PUT', `/api/events/${flag.id}`, { token: c.teacher, body: { status: 'reviewed' } })).status, 404);
  const done = await call('PUT', `/api/events/${flag.id}`, { token: c.admin, body: { status: 'reviewed', outcome: 'Spoke to parents' } });
  assert.equal(done.status, 200);
  assert.equal(done.body.status, 'reviewed');
  assert.equal(done.body.outcome, 'Spoke to parents');
  assert.equal(done.body.reviewedByName, 'Admin');
  assert.equal((await call('PUT', `/api/events/${flag.id}`, { token: c.admin, body: { status: 'nonsense' } })).status, 400);
  assert.equal((await call('PUT', `/api/events/${flag.id}`, { token: c.admin, body: { status: 'reviewed', outcome: 'x'.repeat(2000) } })).status, 400);
  assert.equal((await call('PUT', '/api/events/nope', { token: c.admin, body: { status: 'reviewed' } })).status, 404);
});

test('a wrong mark is voided, never erased, and the trail says who did it', async () => {
  const c = await college();
  const { body: e } = await mark(c.id, c.teacher, { kind: 'bunked', minutesLate: undefined });
  const voided = await call('POST', `/api/events/${e.id}/void`, { token: c.teacher, body: { reason: 'Wrong student' } });
  assert.equal(voided.status, 200);
  assert.equal(voided.body.status, 'void');
  assert.equal(voided.body.voidedByName, 'Anita Mehta');
  assert.equal(voided.body.voidReason, 'Wrong student');
  const list = (await call('GET', `/api/institutions/${c.id}/events`, { token: c.admin })).body;
  assert.equal(list.find((x) => x.id === e.id).status, 'void');
  // It can't then be reviewed back to life.
  assert.equal((await call('PUT', `/api/events/${e.id}`, { token: c.admin, body: { status: 'reviewed' } })).status, 409);
});

test('a teacher can only void their own marks, and an admin any', async () => {
  const c = await college();
  const invite = await call('POST', `/api/institutions/${c.id}/invites`, { token: c.admin, body: { teacherId: 't2' } });
  const rao = await call('POST', '/api/auth/join', { body: { code: invite.body.code, name: 'Rao', email: `rao${unique()}@example.test`, password: PASSWORD } });
  const { body: e } = await mark(c.id, c.teacher);
  assert.equal((await call('POST', `/api/events/${e.id}/void`, { token: rao.body.token, body: {} })).status, 404);
  assert.equal((await call('POST', `/api/events/${e.id}/void`, { token: c.admin, body: {} })).status, 200);
});

test('a teacher can’t void their mark once it has been reviewed', async () => {
  const c = await college();
  const { body: e } = await mark(c.id, c.teacher, { kind: 'bunked', minutesLate: undefined });
  await call('PUT', `/api/events/${e.id}`, { token: c.admin, body: { status: 'reviewed' } });
  assert.equal((await call('POST', `/api/events/${e.id}/void`, { token: c.teacher, body: {} })).status, 409);
});

test('a teacher removed from the college loses access immediately, and their marks stay', async () => {
  const c = await college();
  const { body: e } = await mark(c.id, c.teacher);
  const members = await call('GET', `/api/institutions/${c.id}/members`, { token: c.admin });
  const member = members.body.find((m) => m.role === 'teacher');
  assert.doesNotMatch(members.text, /password/i);
  assert.equal((await call('DELETE', `/api/institutions/${c.id}/members/${member.accountId}`, { token: c.admin })).status, 200);
  assert.equal((await call('GET', `/api/institutions/${c.id}/classroom`, { token: c.teacher })).status, 404);
  assert.equal((await call('GET', '/api/auth/me', { token: c.teacher })).body.institution, null);
  const list = (await call('GET', `/api/institutions/${c.id}/events`, { token: c.admin })).body;
  assert.ok(list.some((x) => x.id === e.id));
});

test('the owner can’t be removed', async () => {
  const c = await college();
  const members = await call('GET', `/api/institutions/${c.id}/members`, { token: c.admin });
  const owner = members.body.find((m) => m.role === 'admin');
  assert.equal((await call('DELETE', `/api/institutions/${c.id}/members/${owner.accountId}`, { token: c.admin })).status, 409);
});

test('deleting a college removes its marks, invites and members', async () => {
  const c = await college();
  const { body: e } = await mark(c.id, c.teacher);
  await call('DELETE', '/api/auth/account', { token: c.admin, body: { password: PASSWORD } });
  assert.equal(await store.getEvent(e.id), null);
  assert.equal((await call('GET', '/api/auth/me', { token: c.teacher })).body.institution, null);
});

test('a mark for a student added after the invite works, using the saved class list', async () => {
  const c = await college();
  const withNew = { ...PROFILE, divisions: [{ ...PROFILE.divisions[0], students: [...PROFILE.divisions[0].students, { id: 's9', rollNo: 'A09', name: 'New Student' }] }] };
  await call('PUT', `/api/institutions/${c.id}`, { token: c.admin, body: { name: 'Goa College', type: 'college', profile: withNew } });
  const r = await mark(c.id, c.teacher, { studentId: 's9' });
  assert.equal(r.body.studentName, 'New Student');
});

test('a remark typed as code comes back as plain data', async () => {
  const c = await college();
  const r = await mark(c.id, c.teacher, { note: '<script>alert(1)</script>' });
  assert.equal(r.body.note, '<script>alert(1)</script>');
  const list = await fetch(`${base}/api/institutions/${c.id}/events`, { headers: { Authorization: `Bearer ${c.admin}` } });
  assert.match(list.headers.get('content-type'), /json/);
});
