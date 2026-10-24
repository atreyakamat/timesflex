import assert from 'node:assert/strict';
import test from 'node:test';

import {
  absentTeacherIds,
  assignSubstitute,
  attendanceSummary,
  currentSlotIndex,
  emptyOperations,
  freeRooms,
  parseRoster,
  profileItems,
  profileStrength,
  roomUtilization,
  saveAttendance,
  setAbsent,
  splitIntoBatches,
  substituteCandidates,
  weekAsText,
  weekdayOf,
  whatsappLink,
} from '../src/ops';
import { sampleProfile } from '../src/samples';
import type { DivisionForm, RoomForm, ScheduledSession, SubjectForm, TeacherForm } from '../src/types';
import { buildSlots, buildSolverRequest, groupSize, setupProblems } from '../src/utils';

const slots = buildSlots('09:00', '12:00', 60, null, null); // 09-10, 10-11, 11-12
const MONDAY = '2026-10-19';

const teachers: TeacherForm[] = [
  { id: 'mehta', name: 'Prof. Mehta', maxLecturesPerDay: 4, maxLecturesPerWeek: 20 },
  { id: 'rao', name: 'Dr. Rao', maxLecturesPerDay: 4, maxLecturesPerWeek: 20 },
  { id: 'iyer', name: 'Dr. Iyer', maxLecturesPerDay: 1, maxLecturesPerWeek: 20 },
  { id: 'off', name: 'Ms. Off', maxLecturesPerDay: 4, maxLecturesPerWeek: 20, unavailableDays: ['Monday'] },
];
const subjects: SubjectForm[] = [
  { id: 'dbms', name: 'DBMS', isLab: false, durationSlots: 1, sessionsPerWeek: 2, teacherId: 'mehta', roomId: '', teacherOverrides: { B: 'rao' } },
  { id: 'os', name: 'OS', isLab: false, durationSlots: 1, sessionsPerWeek: 1, teacherId: 'iyer', roomId: '' },
];
const session = (id: string, teacher: string, slot: string, extra: Partial<ScheduledSession> = {}): ScheduledSession => ({
  id,
  subject_id: 'dbms',
  teacher_id: teacher,
  room_id: 'r1',
  division_id: 'A',
  kind: 'lecture',
  duration_slots: 1,
  day: 'Monday',
  slot,
  ...extra,
});
const sessions = [
  session('s1', 'mehta', '09:00-10:00'),
  session('s2', 'rao', '10:00-11:00', { division_id: 'B' }),
  session('s3', 'iyer', '11:00-12:00', { subject_id: 'os', room_id: 'r2' }),
];

test('dates map to weekdays and the running slot', () => {
  assert.equal(weekdayOf(MONDAY), 'Monday');
  assert.equal(currentSlotIndex(slots, new Date(2026, 9, 19, 10, 30)), 1);
  assert.equal(currentSlotIndex(slots, new Date(2026, 9, 19, 13, 0)), -1);
});

test('substitutes are free, present, available and under their daily limit; best match first', () => {
  const ops = setAbsent(emptyOperations(), MONDAY, 'mehta', true);
  assert.deepEqual([...absentTeacherIds(ops, MONDAY)], ['mehta']);
  const ranked = substituteCandidates({ session: sessions[0], date: MONDAY, slots, sessions, teachers, subjects, ops });
  // Rao teaches DBMS (to B) and is free at 9; Iyer is at his limit of 1; Ms. Off is unavailable on Monday.
  assert.deepEqual(
    ranked.map((item) => item.teacher.id),
    ['rao'],
  );
  assert.ok(ranked[0].reasons.includes('teaches DBMS'));

  // Once Rao covers 9:00, he is no longer free for a 9:00 clash elsewhere.
  const covered = assignSubstitute(ops, { date: MONDAY, session: sessions[0], substituteTeacherId: 'rao' });
  const clash = session('s4', 'mehta', '09:00-10:00', { division_id: 'C' });
  const again = substituteCandidates({ session: clash, date: MONDAY, slots, sessions: [...sessions, clash], teachers, subjects, ops: covered });
  assert.equal(again.length, 0);

  // Marking the teacher present again drops their substitutions.
  assert.equal(setAbsent(covered, MONDAY, 'mehta', false).substitutions.length, 0);
});

test('free rooms skip rooms in use or closed', () => {
  const rooms: RoomForm[] = [
    { id: 'r1', name: 'Room 101', type: 'classroom', capacity: 60 },
    { id: 'r2', name: 'Room 102', type: 'classroom', capacity: 60, unavailableSlots: ['Monday|10:00-11:00'] },
    { id: 'lab', name: 'Lab 1', type: 'lab', capacity: 30 },
  ];
  assert.deepEqual(
    freeRooms(rooms, sessions, 'Monday', '10:00-11:00', slots).map((room) => room.id),
    ['lab'],
  );
  assert.equal(Math.round(roomUtilization(rooms[0], sessions, ['Monday'], slots) * 100), 67);
});

test('class lists parse from pasted text and split into lab batches', () => {
  const parsed = parseRoster('Roll No, Name\n1, Aarav Patil\n2, Diya Naik, diya@x.in\n3\tRiya Shah\n4. Om Rao\nKaran Joshi');
  assert.deepEqual(
    parsed.map((item) => [item.rollNo, item.name]),
    [
      ['1', 'Aarav Patil'],
      ['2', 'Diya Naik'],
      ['3', 'Riya Shah'],
      ['4', 'Om Rao'],
      ['5', 'Karan Joshi'],
    ],
  );
  assert.equal(parsed[1].email, 'diya@x.in');

  const students = splitIntoBatches(
    parsed.map((item, index) => ({ id: `st${index}`, ...item })),
    ['A1', 'A2'],
  );
  assert.deepEqual(
    students.map((item) => item.batch),
    ['A1', 'A1', 'A1', 'A2', 'A2'],
  );
  const division: DivisionForm = { id: 'A', name: 'SE-A', batches: ['A1', 'A2'], size: 99, students };
  // The class list overrides the typed size, and each batch counts its own students.
  assert.equal(groupSize(division, null), 5);
  assert.equal(groupSize(division, 'A2'), 2);
});

test('attendance stores absentees and summarises per student', () => {
  const students = [
    { id: 'a', rollNo: '1', name: 'A', batch: 'A1' },
    { id: 'b', rollNo: '2', name: 'B', batch: 'A2' },
  ];
  const division: DivisionForm = { id: 'A', name: 'SE-A', batches: ['A1', 'A2'], students };
  let ops = saveAttendance(emptyOperations(), { date: MONDAY, session: sessions[0], absentStudentIds: ['a'] });
  ops = saveAttendance(ops, { date: '2026-10-20', session: sessions[0], absentStudentIds: [] });
  // A lab for batch A2 only counts for B.
  ops = saveAttendance(ops, { date: MONDAY, session: session('lab', 'rao', '10:00-11:00', { batch: 'A2' }), absentStudentIds: ['b'] });
  // Re-taking the same period replaces it.
  ops = saveAttendance(ops, { date: '2026-10-20', session: sessions[0], absentStudentIds: [] });
  assert.equal(ops.attendance.length, 3);
  const summary = attendanceSummary(division, ops.attendance);
  assert.deepEqual(
    summary.map((row) => [row.student.id, row.attended, row.total, row.percent]),
    [
      ['a', 1, 2, 50],
      ['b', 2, 3, 67],
    ],
  );
});

test('sharing helpers', () => {
  const names = { dbms: 'DBMS', os: 'OS', A: 'SE-A', B: 'SE-B', mehta: 'Prof. Mehta', rao: 'Dr. Rao', iyer: 'Dr. Iyer', r1: 'Room 101', r2: 'Room 102' };
  const text = weekAsText({ title: 'Prof. Mehta', sessions: [sessions[0]], days: ['Monday'], slots, names, perspective: 'teacher' });
  assert.match(text, /Monday\n {2}09:00-10:00 {2}DBMS · SE-A · Room 101/);
  assert.equal(whatsappLink('98200 12345', 'hi'), 'https://wa.me/919820012345?text=hi');
});

test('the sample college is complete, solvable input with a strong profile', () => {
  const sample = sampleProfile();
  const sampleSlots = buildSlots('09:00', '16:00', 60, 3, 30);
  const profile = { days: sample.institution.workingDays, slots: sampleSlots, ...sample };
  assert.deepEqual(setupProblems(profile), []);
  const request = buildSolverRequest({ ...profile, locked: [] });
  // 2 divisions × 20 lecture sessions + 2 labs × 2 batches × 2 divisions.
  assert.equal(request.sessions.length, 48);
  assert.ok(request.sessions.every((item) => item.size && item.size <= 60));
  assert.ok(profileStrength(profileItems(sample)) >= 50);
});

test('expertise matches related subjects but not generic words', async () => {
  const { hasExpertise } = await import('../src/utils');
  const teacher = (expertise: string[]) => ({ id: 't', name: 'T', maxLecturesPerDay: 4, maxLecturesPerWeek: 20, expertise });
  assert.ok(hasExpertise(teacher(['Databases']), 'Database Management Systems'));
  assert.ok(hasExpertise(teacher(['Data Structures']), 'Data Structures Lab'));
  assert.ok(hasExpertise(teacher(['Networking']), 'Computer Networks'));
  // "Systems" and "Data" alone say nothing about the subject.
  assert.ok(!hasExpertise(teacher(['Operating Systems']), 'Database Management Systems'));
  assert.ok(!hasExpertise(teacher(['Data Mining']), 'Data Structures'));
  assert.ok(!hasExpertise(teacher([]), 'Maths'));
});

test('sample teachers have expertise matching what they teach', async () => {
  const { hasExpertise } = await import('../src/utils');
  const sample = sampleProfile();
  const matched = sample.subjects.filter((subject) =>
    hasExpertise(sample.teachers.find((teacher) => teacher.id === subject.teacherId)!, subject.name),
  );
  assert.equal(matched.length, sample.subjects.length);
});
