import assert from 'node:assert/strict';
import test from 'node:test';

import {
  autoAssignSubstitutes,
  emptyOperations,
  recentCoverCounts,
  setAbsent,
  setLeave,
  substituteCandidates,
  uncoveredPeriods,
  workingDatesBetween,
} from '../src/ops';
import type { ScheduledSession, SubjectForm, TeacherForm } from '../src/types';
import { buildSlots } from '../src/utils';
import { bestBy, styleLabel, timetableMetrics, VARIANT_STYLES } from '../src/variants';

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const slots = buildSlots('09:00', '13:00', 60, null, null); // four periods
const MONDAY = '2026-10-19';

const teachers: TeacherForm[] = [
  { id: 'absent', name: 'Away', maxLecturesPerDay: 4, maxLecturesPerWeek: 20 },
  { id: 'a', name: 'Asha', maxLecturesPerDay: 4, maxLecturesPerWeek: 20 },
  { id: 'b', name: 'Bala', maxLecturesPerDay: 4, maxLecturesPerWeek: 20 },
];
const subjects: SubjectForm[] = [
  { id: 'maths', name: 'Maths', isLab: false, durationSlots: 1, sessionsPerWeek: 3, teacherId: 'absent', roomId: '' },
];
const at = (id: string, teacher: string, slot: number, extra: Partial<ScheduledSession> = {}): ScheduledSession => ({
  id,
  subject_id: 'maths',
  teacher_id: teacher,
  room_id: 'r',
  division_id: 'A',
  kind: 'lecture',
  duration_slots: 1,
  day: 'Monday',
  slot: slots[slot],
  ...extra,
});

test('leave covers every working day in the range, once', () => {
  assert.deepEqual(workingDatesBetween('2026-10-16', '2026-10-20', days), ['2026-10-16', '2026-10-19', '2026-10-20']);
  let ops = setLeave(emptyOperations(), { teacherId: 'absent', from: '2026-10-16', to: '2026-10-20', days, reason: 'Conference' });
  assert.equal(ops.absences.length, 3);
  assert.ok(ops.absences.every((item) => item.reason === 'Conference'));
  // Overlapping leave does not duplicate days; a reversed range is a single day.
  ops = setLeave(ops, { teacherId: 'absent', from: '2026-10-19', to: '2026-10-21', days });
  assert.equal(ops.absences.length, 4);
  assert.equal(setLeave(emptyOperations(), { teacherId: 'a', from: MONDAY, to: '2026-10-01', days }).absences.length, 1);
});

test('auto-assign covers every period without double-booking anyone', () => {
  // The absent teacher has three periods; Asha teaches period 2 herself.
  const sessions = [at('p1', 'absent', 0), at('p2', 'absent', 1), at('p3', 'absent', 2, { division_id: 'B' }), at('own', 'a', 1, { division_id: 'C' })];
  const ops = setAbsent(emptyOperations(), MONDAY, 'absent', true);
  assert.equal(uncoveredPeriods(ops, MONDAY, sessions, slots).length, 3);
  const { operations, assigned, unfilled } = autoAssignSubstitutes(ops, { date: MONDAY, slots, sessions, teachers, subjects });
  assert.equal(assigned, 3);
  assert.equal(unfilled.length, 0);
  const cover = Object.fromEntries(operations.substitutions.map((item) => [item.sessionId, item.substituteTeacherId]));
  // Period 2 cannot go to Asha, who is teaching then.
  assert.equal(cover.p2, 'b');
  assert.equal(uncoveredPeriods(operations, MONDAY, sessions, slots).length, 0);
  // Running it again changes nothing.
  assert.equal(autoAssignSubstitutes(operations, { date: MONDAY, slots, sessions, teachers, subjects }).assigned, 0);
});

test('auto-assign leaves a period open when nobody is free', () => {
  const tight = teachers.map((teacher) => ({ ...teacher, maxLecturesPerDay: 1 }));
  const sessions = [at('p1', 'absent', 0), at('x', 'a', 1, { division_id: 'C' }), at('y', 'b', 2, { division_id: 'D' })];
  const ops = setAbsent(emptyOperations(), MONDAY, 'absent', true);
  const { assigned, unfilled } = autoAssignSubstitutes(ops, { date: MONDAY, slots, sessions, teachers: tight, subjects });
  assert.equal(assigned, 0);
  assert.deepEqual(unfilled.map((item) => item.id), ['p1']);
});

test('teachers who covered a lot recently drop down the list', () => {
  const ops = {
    ...setAbsent(emptyOperations(), MONDAY, 'absent', true),
    substitutions: [1, 2, 3].map((n) => ({
      id: `old${n}`,
      date: `2026-10-0${n}`,
      sessionId: `old${n}`,
      absentTeacherId: 'x',
      substituteTeacherId: 'a',
    })),
  };
  assert.equal(recentCoverCounts(ops, MONDAY).get('a'), 3);
  const ranked = substituteCandidates({ session: at('p1', 'absent', 0), date: MONDAY, slots, sessions: [at('p1', 'absent', 0)], teachers, subjects, ops });
  assert.deepEqual(ranked.map((item) => item.teacher.id), ['b', 'a']);
  assert.ok(ranked[1].reasons.includes('covered 3 recently'));
});

test('metrics compare variants: days, gaps, first and last periods', () => {
  const twoDays = [at('1', 'a', 0), at('2', 'a', 3), at('3', 'a', 0, { day: 'Tuesday' })];
  const oneDay = [at('1', 'a', 0), at('2', 'a', 1), at('3', 'a', 2)];
  const spread = timetableMetrics(twoDays, { days, slots });
  const packed = timetableMetrics(oneDay, { days, slots });
  assert.deepEqual(
    [spread.periods, spread.teacherDays, spread.teacherGaps, spread.firstPeriod, spread.lastPeriod],
    [3, 2, 2, 2, 1],
  );
  assert.deepEqual([packed.teacherDays, packed.teacherGaps, packed.lastPeriod, packed.averageFinish], [1, 0, 0, 3]);
  const best = bestBy([
    { id: 'spread', metrics: spread },
    { id: 'packed', metrics: packed },
  ]);
  assert.equal(best.teacherDays, 'packed');
  assert.equal(best.teacherGaps, 'packed');
  // A lab covering two periods counts both.
  assert.equal(timetableMetrics([at('lab', 'a', 2, { duration_slots: 2 })], { days, slots }).lastPeriod, 1);
});

test('every style has a label', () => {
  assert.equal(VARIANT_STYLES.length, 5);
  assert.equal(styleLabel('teacher_days'), 'Fewer teacher days');
  assert.equal(styleLabel(undefined), 'Balanced');
});

test('guided setup suggests the next class and room names', async () => {
  const { batchNames, nextName } = await import('../src/naming');
  assert.equal(nextName('SE-A'), 'SE-B');
  assert.equal(nextName('Room 101'), 'Room 102');
  assert.equal(nextName('Lab 09'), 'Lab 10');
  assert.equal(nextName('Seminar Hall'), null);
  assert.deepEqual(batchNames('SE-A', 2), ['A1', 'A2']);
  assert.deepEqual(batchNames('FY', 3), ['FY1', 'FY2', 'FY3']);
  assert.deepEqual(batchNames('Computer Science', 2), ['B1', 'B2']);
});
