import assert from 'node:assert/strict';
import test from 'node:test';

import { strFromU8, unzipSync } from 'fflate';

import { buildPdf, buildTables, buildWorkbook, type ExportInput } from '../src/export';
import type { DivisionForm, RoomForm, ScheduledSession, SubjectForm, TeacherForm } from '../src/types';
import {
  buildSlots,
  buildSolverRequest,
  findConflicts,
  matchesView,
  setupProblems,
  setupWarnings,
} from '../src/utils';

const days = ['Monday', 'Tuesday', 'Wednesday'];
const slots = buildSlots('09:00', '13:00', 60, [{ afterSlot: 2, minutes: 30, label: 'Break' }]); // 09-10, 10-11, break, 11:30-12:30

const divisions: DivisionForm[] = [
  { id: 'A', name: 'SE-A', batches: ['A1', 'A2'], size: 60 },
  { id: 'B', name: 'SE-B', batches: [], size: 40 },
];
const teachers: TeacherForm[] = [
  {
    id: 't1',
    name: 'Prof. Mehta',
    maxLecturesPerDay: 4,
    maxLecturesPerWeek: 20,
    unavailableDays: ['Wednesday'],
    unavailableSlots: ['Monday|09:00-10:00', 'Friday|09:00-10:00'],
    preferredSlots: ['Tuesday|10:00-11:00'],
  },
  { id: 't2', name: 'Dr. Rao', maxLecturesPerDay: 4, maxLecturesPerWeek: 20, canTeachLabs: false },
];
const rooms: RoomForm[] = [
  { id: 'r1', name: 'Room 101', type: 'classroom', capacity: 50, unavailableSlots: ['Tuesday|09:00-10:00'] },
  { id: 'lab1', name: 'Lab 1', type: 'lab', capacity: 30 },
];
const subjects: SubjectForm[] = [
  { id: 'dbms', name: 'DBMS', isLab: false, durationSlots: 1, sessionsPerWeek: 2, teacherId: 't1', roomId: '' },
  {
    id: 'os',
    name: 'OS',
    isLab: false,
    durationSlots: 1,
    sessionsPerWeek: 1,
    teacherId: 't2',
    roomId: 'r1',
    divisionIds: ['A'],
    difficult: true,
  },
  {
    id: 'lab',
    name: 'DBMS Lab',
    isLab: true,
    durationSlots: 2,
    sessionsPerWeek: 1,
    teacherId: 't1',
    roomId: '',
    teacherOverrides: { B: 't2' },
  },
];
const names = Object.fromEntries([...divisions, ...teachers, ...rooms, ...subjects].map((item) => [item.id, item.name]));
const profile = { days, slots, divisions, subjects, teachers, rooms };

test('builds slots around the break', () => {
  assert.deepEqual(slots, ['09:00-10:00', '10:00-11:00', '11:30-12:30']);
});

test('solver request: divisions per subject, overrides, batch sizes, availability', () => {
  const request = buildSolverRequest({ ...profile, locked: [] });
  const count = (subject: string, division: string) =>
    request.sessions.filter((s) => s.subject_id === subject && s.division_id === division).length;

  assert.equal(count('dbms', 'A'), 2);
  assert.equal(count('dbms', 'B'), 2);
  assert.equal(count('os', 'A'), 1);
  assert.equal(count('os', 'B'), 0, 'OS is only taught to SE-A');

  const labs = request.sessions.filter((s) => s.subject_id === 'lab');
  assert.deepEqual(
    labs.map((s) => [s.division_id, s.batch, s.size, s.teacher_id, s.room_id]),
    [
      ['A', 'A1', 30, 't1', ''],
      ['A', 'A2', 30, 't1', ''],
      ['B', null, 40, 't2', ''],
    ],
  );
  assert.equal(request.sessions.find((s) => s.subject_id === 'os')?.difficult, true);

  const mehta = request.teacher_constraints.find((c) => c.teacher_id === 't1')!;
  // Friday is not a working day, so that blocked cell is dropped.
  assert.deepEqual(mehta.unavailable, [{ day: 'Wednesday' }, { day: 'Monday', slot: '09:00-10:00' }]);
  assert.deepEqual(mehta.preferred, [{ day: 'Tuesday', slot: '10:00-11:00' }]);
  assert.deepEqual(request.rooms.find((r) => r.id === 'r1')?.unavailable, [{ day: 'Tuesday', slot: '09:00-10:00' }]);
});

test('setup checks: lab-capable teachers, rooms that exist and fit', () => {
  assert.deepEqual(setupProblems(profile), [
    'Dr. Rao is marked as not handling labs but is assigned DBMS Lab (Teachers).',
  ]);
  assert.deepEqual(setupProblems({ ...profile, rooms: rooms.filter((r) => r.type !== 'lab') }).slice(-1), [
    'DBMS Lab needs a lab, but none exists (Rooms & Labs).',
  ]);
  const warnings = setupWarnings(profile);
  assert.ok(warnings.includes('Room 101 seats 50 but OS for SE-A has 60 students.'), warnings.join('\n'));
  assert.ok(warnings.some((w) => w.startsWith('No lab seats 40 for DBMS Lab (SE-B)')), warnings.join('\n'));
});

const session = (id: string, extra: Partial<ScheduledSession>): ScheduledSession => ({
  id,
  subject_id: 'dbms',
  teacher_id: 't1',
  room_id: 'r1',
  division_id: 'B',
  kind: 'lecture',
  duration_slots: 1,
  day: 'Tuesday',
  slot: '10:00-11:00',
  ...extra,
});

test('conflicts: teacher and room unavailability, capacity, breaks', () => {
  const messages = findConflicts(
    [
      session('a', { day: 'Monday', slot: '09:00-10:00' }),
      session('b', { day: 'Tuesday', slot: '09:00-10:00', teacher_id: 't2' }),
      session('c', { division_id: 'A', size: 60, teacher_id: 't2', day: 'Monday', slot: '11:30-12:30' }),
      session('d', { subject_id: 'lab', kind: 'lab', duration_slots: 2, room_id: 'lab1', slot: '10:00-11:00' }),
    ],
    { days, slots, teachers, rooms, names },
  ).map((c) => c.message);
  assert.deepEqual(messages, [
    'Prof. Mehta is unavailable on Monday at 09:00-10:00 (DBMS)',
    'Room Room 101 is closed on Tuesday at 09:00-10:00 (DBMS)',
    'Room Room 101 seats 50 but DBMS has 60 students',
    'DBMS Lab on Tuesday is split by a break',
  ]);
});

test('conflicts: lab room type and teachers who do not take labs', () => {
  const messages = findConflicts(
    [
      session('lab-in-class', { subject_id: 'lab', kind: 'lab', room_id: 'r1', teacher_id: 't2', day: 'Monday', slot: '11:30-12:30' }),
      session('lecture-in-lab', { room_id: 'lab1', day: 'Tuesday', slot: '11:30-12:30', size: 0 }),
    ],
    { days, slots, teachers, rooms, names },
  ).map((c) => c.message);
  assert.deepEqual(messages, [
    'DBMS Lab is a lab but Room Room 101 is not a lab',
    'Dr. Rao does not take labs (DBMS Lab)',
    'DBMS is in lab Lab 1, which is kept for lab sessions',
  ]);
});

test('teacher limits can count a multi-slot lab as one lecture', () => {
  const tight = [{ ...teachers[0], unavailableDays: [], unavailableSlots: [], maxLecturesPerDay: 1 }];
  const lab = session('l', { subject_id: 'lab', kind: 'lab', room_id: 'lab1', duration_slots: 2, slot: '11:30-12:30' });
  const count = (labCountsAsOne: boolean) =>
    findConflicts([lab], { days, slots: [...slots, '12:30-13:30'], teachers: tight, rooms, names, labCountsAsOne }).length;
  assert.equal(count(false), 1);
  assert.equal(count(true), 0);
});

test('locked sessions pick up subject changes and stale locks are dropped', () => {
  const changed = subjects.map((s) => (s.id === 'dbms' ? { ...s, teacherId: 't2', sessionsPerWeek: 1 } : s));
  const lockedA = session('k1', { division_id: 'B', day: 'Monday', slot: '10:00-11:00', locked: true });
  const lockedB = session('k2', { division_id: 'B', day: 'Tuesday', slot: '10:00-11:00', locked: true });
  const request = buildSolverRequest({ days, slots, divisions, teachers, rooms, subjects: changed, locked: [lockedA, lockedB] });
  const pinned = request.sessions.filter((s) => s.locked);
  assert.deepEqual(pinned.map((s) => [s.id, s.teacher_id]), [['k1', 't2']]);
});

test('batch view shows the batch and whole-division sessions only', () => {
  const whole = session('w', { division_id: 'A' });
  const a1 = session('x', { division_id: 'A', batch: 'A1' });
  const a2 = session('y', { division_id: 'A', batch: 'A2' });
  assert.deepEqual(
    [whole, a1, a2].filter((s) => matchesView(s, 'batch:A:A1')).map((s) => s.id),
    ['w', 'x'],
  );
});

const exportInput: ExportInput = {
  institutionName: 'Test College',
  subtitle: 'Computer Engineering',
  days,
  slots,
  sessions: [
    session('a', { day: 'Monday', slot: '10:00-11:00', division_id: 'A' }),
    session('l', { subject_id: 'lab', kind: 'lab', division_id: 'A', batch: 'A1', room_id: 'lab1', duration_slots: 2, day: 'Tuesday', slot: '09:00-10:00' }),
  ],
  names,
  views: ['division:A', 'teacher:t1', 'room:lab1'],
};

test('export tables include break rows and view-specific text', () => {
  const [division, teacher] = buildTables(exportInput);
  assert.equal(division.title, 'SE-A');
  assert.deepEqual(division.rows.map((row) => row.label), ['09:00 – 10:00', '10:00 – 11:00', '11:00 – 11:30', '11:30 – 12:30']);
  assert.ok(division.rows[2].isBreak);
  // Class view leaves out the class name; teacher view leaves out the teacher.
  assert.equal(division.rows[1].cells[0].text, 'DBMS\nProf. Mehta · Room 101');
  assert.equal(teacher.rows[1].cells[0].text, 'DBMS\nSE-A · Room 101');
  assert.equal(division.rows[0].cells[1].text, 'DBMS Lab (A1)\nProf. Mehta · Lab 1');
  assert.ok(division.rows[1].cells[1].lab, 'a 2-slot lab fills both rows');
});

test('excel export is a valid workbook with one sheet per view', async () => {
  const files = unzipSync(await buildWorkbook(exportInput));
  const workbook = strFromU8(files['xl/workbook.xml']);
  assert.match(workbook, /<sheet name="SE-A" sheetId="1"/);
  assert.match(workbook, /<sheet name="Prof. Mehta" sheetId="2"/);
  assert.match(workbook, /<sheet name="Lab 1" sheetId="3"/);
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /DBMS Lab \(A1\)/);
  assert.match(sheet, />Break</);
  assert.ok(files['[Content_Types].xml'] && files['xl/styles.xml']);
});

test('pdf export renders one page per view', async () => {
  const doc = await buildPdf(exportInput);
  assert.equal(doc.getNumberOfPages(), 3);
  const bytes = new Uint8Array(doc.output('arraybuffer'));
  assert.equal(String.fromCharCode(...bytes.slice(0, 5)), '%PDF-');
});
