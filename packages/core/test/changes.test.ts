import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCoverUpdate,
  buildTimetableUpdate,
  describeChange,
  diffTimetable,
  freeRoomsFor,
  noticeProgress,
  repairRooms,
  sampleProfile,
  sessionsWithoutRoom,
  type ProfileData,
  type ScheduledSession,
} from '../src/index';

const slots = ['09:00-10:00', '10:00-11:00', '11:00-12:00'];
const base = sampleProfile();
const profile: ProfileData = {
  ...base,
  institution: { ...base.institution, name: 'Goa College', workingDays: ['Monday', 'Tuesday'] },
  teachers: [
    { ...base.teachers[0], id: 'mehta', name: 'Prof. Mehta' },
    { ...base.teachers[0], id: 'rao', name: 'Dr. Rao' },
    { ...base.teachers[0], id: 'iyer', name: 'Prof. Iyer' },
  ],
  subjects: [{ ...base.subjects[0], id: 'dbms', name: 'DBMS' }, { ...base.subjects[0], id: 'maths', name: 'Maths' }],
  divisions: [{ id: 'se', name: 'SE-A', batches: [] }],
  rooms: [
    { id: 'r1', name: 'Room 1', type: 'classroom', capacity: 60 },
    { id: 'r2', name: 'Room 2', type: 'classroom', capacity: 60 },
    { id: 'small', name: 'Small', type: 'classroom', capacity: 10 },
    { id: 'lab', name: 'Lab', type: 'lab', capacity: 60 },
  ],
};
let n = 0;
const at = (subject_id: string, teacher_id: string, day: string, slot: string, room_id = 'r1', extra: Partial<ScheduledSession> = {}): ScheduledSession =>
  ({ id: `s${(n += 1)}`, subject_id, teacher_id, division_id: 'se', room_id, day, slot, kind: 'lecture', duration_slots: 1, size: 40, ...extra }) as ScheduledSession;
const names = { dbms: 'DBMS', maths: 'Maths', se: 'SE-A', r1: 'Room 1', r2: 'Room 2', mehta: 'Prof. Mehta', rao: 'Dr. Rao', iyer: 'Prof. Iyer' };
const publishedOf = (sessions: ScheduledSession[], extra: Record<string, string> = {}) => ({ versionId: 'v1', at: 'then', sessions, names: { ...names, ...extra } });

test('identical timetables have no changes, even with different session ids', () => {
  const before = [at('dbms', 'mehta', 'Monday', slots[0])];
  const after = [at('dbms', 'mehta', 'Monday', slots[0])];
  assert.notEqual(before[0].id, after[0].id);
  assert.deepEqual(diffTimetable(before, after), []);
});

test('each kind of change is recognised', () => {
  const kinds = (b: ScheduledSession[], a: ScheduledSession[]) => diffTimetable(b, a).map((c) => c.kind);
  assert.deepEqual(kinds([at('dbms', 'mehta', 'Monday', slots[0])], [at('dbms', 'mehta', 'Tuesday', slots[1])]), ['moved']);
  assert.deepEqual(kinds([at('dbms', 'mehta', 'Monday', slots[0])], [at('dbms', 'mehta', 'Monday', slots[0], 'r2')]), ['room']);
  assert.deepEqual(kinds([at('dbms', 'mehta', 'Monday', slots[0])], [at('dbms', 'rao', 'Monday', slots[0])]), ['teacher']);
  assert.deepEqual(kinds([], [at('dbms', 'mehta', 'Monday', slots[0])]), ['added']);
  assert.deepEqual(kinds([at('dbms', 'mehta', 'Monday', slots[0])], []), ['removed']);
});

test('only what moved counts, when a subject meets several times a week', () => {
  const before = [at('dbms', 'mehta', 'Monday', slots[0]), at('dbms', 'mehta', 'Monday', slots[1]), at('dbms', 'mehta', 'Tuesday', slots[0])];
  const after = [at('dbms', 'mehta', 'Monday', slots[0]), at('dbms', 'mehta', 'Tuesday', slots[2]), at('dbms', 'mehta', 'Tuesday', slots[0])];
  const changes = diffTimetable(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].before?.slot, slots[1]);
  assert.equal(changes[0].after?.slot, slots[2]);
});

test('changes read naturally', () => {
  const [moved] = diffTimetable([at('dbms', 'mehta', 'Monday', slots[0])], [at('dbms', 'mehta', 'Tuesday', slots[1], 'r2')]);
  assert.equal(describeChange(moved, names), 'DBMS · SE-A: moved from Mon 09:00 to Tue 10:00, in Room 2');
  const [room] = diffTimetable([at('dbms', 'mehta', 'Monday', slots[0])], [at('dbms', 'mehta', 'Monday', slots[0], 'r2')]);
  assert.equal(describeChange(room, names), 'DBMS · SE-A, Mon 09:00: now in Room 2 (was Room 1)');
  const [swap] = diffTimetable([at('dbms', 'mehta', 'Monday', slots[0])], [at('dbms', 'rao', 'Monday', slots[0])]);
  assert.match(describeChange(swap, names, names, 'rao'), /you now take this class/);
  assert.match(describeChange(swap, names, names, 'mehta'), /Dr\. Rao now takes this class/);
});

test('the first update gives every teacher their whole week; idle teachers hear nothing', () => {
  const sessions = [at('dbms', 'mehta', 'Monday', slots[0]), at('maths', 'rao', 'Tuesday', slots[1])];
  const update = buildTimetableUpdate({ published: null, sessions, profile, slots });
  assert.deepEqual(update.recipients.map((r) => r.teacherId), ['mehta', 'rao']);
  assert.match(update.recipients[0].text, /Hello Mehta, here is your timetable from Goa College/);
  assert.match(update.recipients[0].text, /DBMS/);
  assert.doesNotMatch(update.recipients[0].text, /Maths/);
  // Automatic sending must carry the real schedule, not just "your timetable is ready".
  assert.doesNotMatch(update.recipients[0].summary, /\n/);
  assert.match(update.recipients[0].summary, /Mon 09:00 DBMS \(SE-A, Room 1\)/);
  assert.equal(update.recipients[0].headline, 'Their full week: 1 class');
});

test('afterwards only the teachers a change touches are told', () => {
  const before = [at('dbms', 'mehta', 'Monday', slots[0]), at('maths', 'rao', 'Tuesday', slots[1])];
  const after = [at('dbms', 'mehta', 'Monday', slots[0], 'r2'), at('maths', 'rao', 'Tuesday', slots[1])];
  const update = buildTimetableUpdate({ published: publishedOf(before), sessions: after, profile, slots });
  assert.deepEqual(update.recipients.map((r) => r.teacherId), ['mehta']);
  assert.match(update.recipients[0].text, /now in Room 2 \(was Room 1\)/);
  assert.match(update.groupText, /Timetable changes at Goa College/);
  assert.equal(update.title, '1 timetable change');
});

test('when a class changes teacher, both of them are told', () => {
  const update = buildTimetableUpdate({ published: publishedOf([at('dbms', 'mehta', 'Monday', slots[0])]), sessions: [at('dbms', 'rao', 'Monday', slots[0])], profile, slots });
  assert.deepEqual(update.recipients.map((r) => r.teacherId).sort(), ['mehta', 'rao']);
});

test('a renamed room reaches everyone teaching in it, though nothing moved', () => {
  const sessions = [at('dbms', 'mehta', 'Monday', slots[0])];
  const update = buildTimetableUpdate({ published: publishedOf(sessions, { r1: 'Old Room' }), sessions, profile, slots });
  assert.deepEqual(update.recipients.map((r) => r.teacherId), ['mehta']);
  assert.match(update.recipients[0].text, /Old Room is now called Room 1/);
});

test('nothing changed means nobody is bothered', () => {
  const sessions = [at('dbms', 'mehta', 'Monday', slots[0])];
  const update = buildTimetableUpdate({ published: publishedOf(sessions), sessions, profile, slots });
  assert.equal(update.recipients.length, 0);
  assert.equal(update.changeCount, 0);
});

test('cover tells the substitute and the absent teacher, and flags what is not covered', () => {
  const covered = at('dbms', 'mehta', 'Monday', slots[0]);
  const open = at('maths', 'mehta', 'Monday', slots[1]);
  const date = '2026-11-09';
  const update = buildCoverUpdate({
    date,
    ops: { absences: [{ date, teacherId: 'mehta' }], substitutions: [{ date, sessionId: covered.id, substituteTeacherId: 'rao' }], attendance: [] } as never,
    sessions: [covered, open],
    profile,
    slots,
  });
  assert.deepEqual(update.recipients.map((r) => r.teacherId).sort(), ['mehta', 'rao']);
  assert.match(update.recipients.find((r) => r.teacherId === 'rao')!.text, /please cover for Prof\. Mehta/);
  assert.match(update.groupText, /not covered yet/);
});

test('a class can only change to a free room of the right kind and size', () => {
  const mine = at('dbms', 'mehta', 'Monday', slots[0], 'r1', { size: 40 });
  const elsewhere = at('maths', 'rao', 'Monday', slots[0], 'r2');
  assert.deepEqual(freeRoomsFor(mine, [mine, elsewhere], profile.rooms, slots).map((r) => r.id), []);
  assert.deepEqual(freeRoomsFor(mine, [mine], profile.rooms, slots).map((r) => r.id), ['r2']);
  const lab = at('dbms', 'mehta', 'Monday', slots[0], 'r1', { kind: 'lab', size: 20 });
  assert.deepEqual(freeRoomsFor(lab, [lab], profile.rooms, slots).map((r) => r.id), ['lab']);
});

test('a two-period class needs the room for both periods', () => {
  const long = at('dbms', 'mehta', 'Monday', slots[0], 'r1', { duration_slots: 2 });
  const later = at('maths', 'rao', 'Monday', slots[1], 'r2');
  assert.deepEqual(freeRoomsFor(long, [long, later], profile.rooms, slots).map((r) => r.id), []);
});

test('classes that lost their room get a free one, and never a double booking', () => {
  const a = at('dbms', 'mehta', 'Monday', slots[0], 'gone');
  const b = at('maths', 'rao', 'Monday', slots[0], 'gone');
  const rooms = profile.rooms.filter((r) => r.id === 'r1');
  assert.equal(sessionsWithoutRoom([a, b], rooms).length, 2);
  const result = repairRooms([a, b], rooms, slots);
  assert.equal(result.sessions[0].room_id, 'r1');
  assert.equal(result.sessions[1].room_id, 'gone');
  assert.equal(result.unfixed, 1);
});

test('a very long week still fits a WhatsApp template, and says there is more', () => {
  const week = Array.from({ length: 60 }, () => at('dbms', 'mehta', 'Monday', slots[0]));
  const { summary } = buildTimetableUpdate({ published: null, sessions: week, profile, slots }).recipients[0];
  assert.ok(summary.length <= 830, `${summary.length} characters`);
  assert.match(summary, /ask your coordinator for the rest$/);
});

test('progress counts who has been told', () => {
  const notice = { id: 'n', title: '', kind: 'timetable', groupText: '', createdAt: '', recipients: ['sent', 'pending', 'read', 'failed', 'skipped', 'opened'].map((status) => ({ status })) } as never;
  assert.deepEqual(noticeProgress(notice), { told: 3, total: 6 });
});
