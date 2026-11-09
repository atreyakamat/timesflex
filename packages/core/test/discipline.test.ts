import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EVENT_KINDS,
  allStudents,
  classNow,
  describeEvent,
  eventsAsCsv,
  eventStats,
  findStudent,
  needsAttention,
  sampleInstitute,
  searchStudents,
  studentHistory,
  type StudentEvent,
} from '../src/index';

const profile = sampleInstitute();
const first = allStudents(profile)[0];
let n = 0;
const event = (extra: Partial<StudentEvent> = {}): StudentEvent => ({
  id: `e${(n += 1)}`,
  studentId: first.id,
  studentName: first.name,
  rollNo: first.rollNo,
  divisionId: first.divisionId,
  divisionName: first.divisionName,
  kind: 'late',
  date: '2026-11-09',
  time: '09:12',
  note: '',
  status: 'open',
  recordedBy: 'a1',
  recordedByName: 'Prof. Mehta',
  createdAt: '2026-11-09T03:42:00.000Z',
  ...extra,
});

test('every student is listed once, with their class', () => {
  const students = allStudents(profile);
  assert.equal(students.length, 405);
  assert.equal(new Set(students.map((s) => s.id)).size, 405);
  assert.equal(first.divisionName, 'FY A');
});

test('classes without a class list add nobody, and nothing breaks', () => {
  assert.deepEqual(allStudents({ divisions: [{ id: 'd', name: 'X', batches: [] }] }), []);
});

test('search finds by name, part of a name, or roll number, in any case', () => {
  assert.equal(searchStudents(profile, first.name)[0].id, first.id);
  assert.ok(searchStudents(profile, first.name.split(' ')[0].toLowerCase()).some((s) => s.id === first.id));
  assert.equal(searchStudents(profile, first.rollNo.toLowerCase())[0].id, first.id);
});

test('search needs a real query, and caps its results', () => {
  assert.deepEqual(searchStudents(profile, '  '), []);
  assert.deepEqual(searchStudents(profile, 'zzzznobody'), []);
  assert.ok(searchStudents(profile, 'a', 10).length <= 10);
});

test('a student can be looked up by id, and an unknown id gives nothing', () => {
  assert.equal(findStudent(profile, first.id)?.name, first.name);
  assert.equal(findStudent(profile, 'nope'), null);
});

test('each kind of mark reads clearly', () => {
  assert.deepEqual(EVENT_KINDS.map((k) => k.id), ['late', 'outside', 'bunked', 'other']);
  assert.equal(describeEvent(event({ minutesLate: 12 })), 'Late by 12 minutes');
  assert.equal(describeEvent(event({ minutesLate: 1 })), 'Late by 1 minute');
  assert.equal(describeEvent(event()), 'Late');
  assert.equal(describeEvent(event({ kind: 'outside' })), 'Seen outside during class');
  assert.equal(describeEvent(event({ kind: 'bunked' })), 'Bunked a class');
  assert.equal(describeEvent(event({ kind: 'other', note: 'Left the lab early' })), 'Left the lab early');
  assert.equal(describeEvent(event({ kind: 'other' })), 'Remark');
});

test('today’s numbers count today only, and voided marks never count', () => {
  const stats = eventStats(
    [
      event(),
      event({ studentId: 'b' }),
      event({ kind: 'bunked', status: 'open' }),
      event({ kind: 'outside', status: 'reviewed' }),
      event({ date: '2026-11-08', kind: 'bunked' }),
      event({ status: 'void' }),
    ],
    '2026-11-09',
  );
  assert.deepEqual(stats, { lateToday: 2, flagsToday: 2, openFlags: 2 });
});

test('a late mark never counts as a flag to review', () => {
  assert.equal(eventStats([event({ status: 'open' })], '2026-11-09').openFlags, 0);
});

test('a student’s history is theirs alone, newest first, with voided marks left out', () => {
  const history = studentHistory(
    [event({ id: 'old', date: '2026-11-01' }), event({ id: 'new', date: '2026-11-09' }), event({ id: 'other', studentId: 'b' }), event({ id: 'gone', status: 'void' })],
    first.id,
  );
  assert.deepEqual(history.events.map((e) => e.id), ['new', 'old']);
  assert.deepEqual(history.counts, { late: 2, outside: 0, bunked: 0, other: 0 });
});

test('history sorts same-day marks by time', () => {
  const history = studentHistory([event({ id: 'am', createdAt: '2026-11-09T03:00:00Z' }), event({ id: 'pm', createdAt: '2026-11-09T09:00:00Z' })], first.id);
  assert.deepEqual(history.events.map((e) => e.id), ['pm', 'am']);
});

test('repeat patterns surface: 3 lates or 2 flags in 30 days', () => {
  const today = '2026-11-09';
  const late = (id: string, date: string) => event({ id, date, studentId: 'late-one', studentName: 'Late One' });
  const bunk = (id: string, date: string) => event({ id, date, studentId: 'bunk-one', studentName: 'Bunk One', kind: 'bunked' });
  const list = needsAttention(
    [
      late('1', '2026-11-09'), late('2', '2026-11-05'), late('3', '2026-10-20'),
      bunk('4', '2026-11-08'), bunk('5', '2026-11-01'),
      event({ id: '6', studentId: 'fine', date: '2026-11-09' }),
      // Too long ago to count.
      event({ id: '7', studentId: 'old', date: '2026-09-01' }), event({ id: '8', studentId: 'old', date: '2026-09-02' }), event({ id: '9', studentId: 'old', date: '2026-09-03' }),
      // Voided marks don't count against anyone.
      event({ id: '10', studentId: 'cleared', kind: 'bunked', status: 'void' }), event({ id: '11', studentId: 'cleared', kind: 'bunked', status: 'void' }),
    ],
    today,
  );
  assert.deepEqual(list.map((x) => x.studentId), ['bunk-one', 'late-one']);
  assert.equal(list[0].reason, '2 flags in 30 days');
  assert.equal(list[1].reason, '3 lates in 30 days');
});

test('the class a student should be in right now is found from the timetable', () => {
  const slots = ['09:00-10:00', '10:00-11:00'];
  const sessions = [
    { id: 's', subject_id: 'm', teacher_id: 't', division_id: first.divisionId, room_id: 'r', day: 'Monday', slot: slots[1], batch: null, kind: 'lecture', duration_slots: 1 },
    { id: 'lab', subject_id: 'l', teacher_id: 't', division_id: first.divisionId, room_id: 'r', day: 'Monday', slot: slots[0], batch: 'Z9', kind: 'lab', duration_slots: 1 },
  ] as never;
  const monday = (h: number, m = 0) => new Date(2026, 10, 9, h, m);
  assert.equal(classNow(first, sessions, slots, monday(10, 30))?.id, 's');
  // A lab for another batch isn't this student's class.
  assert.equal(classNow(first, sessions, slots, monday(9, 30)), null);
  assert.equal(classNow(first, sessions, slots, monday(20)), null);
  assert.equal(classNow(first, sessions, slots, new Date(2026, 10, 10, 10, 30)), null);
});

test('reports open safely in a spreadsheet, whatever a remark says', () => {
  const csv = eventsAsCsv([event({ note: '=HYPERLINK("http://evil","x")', studentName: 'Rao, "Ravi"', minutesLate: 5 }), event({ note: '+1', kind: 'other' }), event({ note: '@cmd' }), event({ note: '-2' })]);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'Date,Time,Roll no,Student,Class,Mark,Remark,Recorded by,Status');
  assert.ok(lines[1].includes(`"Rao, ""Ravi"""`));
  assert.ok(lines[1].includes(`"'=HYPERLINK(""http://evil"",""x"")"`), lines[1]);
  assert.ok(lines[2].includes(`'+1`));
  assert.ok(lines[3].includes(`'@cmd`));
  assert.ok(lines[4].includes(`'-2`));
});

test('an empty report still has its headings', () => {
  assert.equal(eventsAsCsv([]).split('\n').length, 1);
});
