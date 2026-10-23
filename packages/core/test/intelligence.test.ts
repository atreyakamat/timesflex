import assert from 'node:assert/strict';
import test from 'node:test';

import { applyActions, describeAction, isRunAction } from '../src/agent';
import { dateIn, findTeacher, parseCommand } from '../src/command';
import { canPlace, explainSession } from '../src/explain';
import { setupInsights, suggestTeachers, teacherLoad, timetableInsights } from '../src/insights';
import {
  describePreferences,
  emptyModel,
  featuresOf,
  hasLearned,
  learnFromChoice,
  learnFromMove,
  solverWeights,
} from '../src/learning';
import { absentTeacherIds } from '../src/ops';
import { sampleProfile } from '../src/samples';
import type { ScheduledSession } from '../src/types';
import { buildSlots } from '../src/utils';

const MONDAY = new Date(2026, 9, 19, 10, 0); // Monday 19 Oct 2026
const profile = () => sampleProfile();
const teacherNamed = (p: ReturnType<typeof profile>, part: string) => p.teachers.find((t) => t.name.includes(part))!;

test('the sample department is ready to generate, with no blockers', () => {
  const insights = setupInsights(profile());
  assert.deepEqual(insights.filter((i) => i.level === 'blocker').map((i) => i.title), []);
  const ready = insights.find((i) => i.id === 'ready');
  assert.ok(ready?.fix?.actions.every(isRunAction));
});

test('an overloaded teacher is a blocker with a fix that resolves it', () => {
  const p = profile();
  const mehta = teacherNamed(p, 'Mehta');
  p.teachers = p.teachers.map((t) => (t.id === mehta.id ? { ...t, maxLecturesPerWeek: 6 } : t));
  const overload = setupInsights(p).find((i) => i.id === `overload-${mehta.id}`);
  assert.equal(overload?.level, 'blocker');
  const fixed = applyActions(p, overload!.fix!.actions);
  assert.ok(!setupInsights(fixed).some((i) => i.id === `overload-${mehta.id}`));
  assert.ok(teacherLoad(mehta, p) <= fixed.teachers.find((t) => t.id === mehta.id)!.maxLecturesPerWeek);
});

test('a subject without a teacher suggests the expert and the fix assigns them', () => {
  const p = profile();
  const os = p.subjects.find((s) => s.name === 'Operating Systems')!;
  p.subjects = p.subjects.map((s) => (s.id === os.id ? { ...s, teacherId: '' } : s));
  const insight = setupInsights(p).find((i) => i.id === `no-teacher-${os.id}`)!;
  assert.match(insight.detail, /Rao has matching expertise/);
  const fixed = applyActions(p, insight.fix!.actions);
  assert.equal(fixed.subjects.find((s) => s.id === os.id)!.teacherId, teacherNamed(p, 'Rao').id);
  assert.equal(suggestTeachers({ name: 'Computer Networks', isLab: false }, p)[0].teacher.name, 'Mr. Shah');
});

test('missing lab is caught and the fix adds one', () => {
  const p = profile();
  p.rooms = p.rooms.filter((r) => r.type !== 'lab');
  p.subjects = p.subjects.map((s) => ({ ...s, roomId: '' }));
  const insight = setupInsights(p).find((i) => i.id.startsWith('no-room-'))!;
  assert.equal(insight.level, 'blocker');
  const fixed = applyActions(p, insight.fix!.actions);
  assert.ok(fixed.rooms.some((r) => r.type === 'lab'));
});

const slots = buildSlots('09:00', '13:00', 60, null, null);
const days = ['Monday', 'Tuesday', 'Wednesday'];
const s = (id: string, extra: Partial<ScheduledSession>): ScheduledSession => ({
  id,
  subject_id: 'maths',
  teacher_id: 't1',
  room_id: 'r1',
  division_id: 'A',
  kind: 'lecture',
  duration_slots: 1,
  day: 'Monday',
  slot: slots[0],
  ...extra,
});
const ctx = (sessions: ScheduledSession[]) => ({
  days,
  slots,
  sessions,
  teachers: [{ id: 't1', name: 'Prof. Mehta', maxLecturesPerDay: 4, maxLecturesPerWeek: 20, unavailableDays: ['Wednesday'] }],
  rooms: [{ id: 'r1', name: 'Room 101', type: 'classroom' as const, capacity: 60 }],
  divisions: [{ id: 'A', name: 'SE-A', batches: [] }],
  names: { maths: 'Maths', physics: 'Physics', t1: 'Prof. Mehta', r1: 'Room 101', A: 'SE-A' },
});

test('explanations name the real reasons and list legal alternatives', () => {
  const sessions = [s('early', { subject_id: 'physics' }), s('maths', { slot: slots[1], size: 50 }), s('maths2', { day: 'Tuesday', slot: slots[2] })];
  const explanation = explainSession(sessions[1], ctx(sessions));
  assert.match(explanation.summary, /Maths for SE-A is on Monday at 10:00 with Prof. Mehta in Room 101/);
  assert.ok(explanation.reasons.some((r) => r.includes('does not teach on Wednesday')));
  assert.ok(explanation.reasons.some((r) => r.includes('teaches Physics to SE-A at 09:00')));
  assert.ok(explanation.reasons.some((r) => r.includes('Room 101 seats 60, enough for 50')));
  // Never Wednesday (teacher off), never on top of physics or the other maths.
  assert.ok(explanation.alternatives.every((a) => a.day !== 'Wednesday'));
  assert.ok(!explanation.alternatives.some((a) => a.day === 'Monday' && a.slot === slots[0]));
  assert.ok(!canPlace(sessions[1], 'Tuesday', 2, ctx(sessions)));
  assert.ok(canPlace(sessions[1], 'Tuesday', 0, ctx(sessions)));
});

test('timetable insights praise a clean week and suggest a style for its weak spot', () => {
  const p = profile();
  const spread = p.teachers.slice(0, 2).flatMap((teacher, ti) =>
    p.institution.workingDays.map((day, di) =>
      s(`${ti}-${di}`, { teacher_id: teacher.id, day, slot: buildSlots('09:00', '16:00', 60, 3, 30)[ti === 0 ? 0 : 5] }),
    ),
  );
  const insights = timetableInsights(p, spread);
  assert.ok(insights.some((i) => i.id === 'all-placed'));
  assert.ok(insights.find((i) => i.id === 'every-day')?.fix?.actions.some((a) => a.type === 'generate' && a.style === 'teacher_days'));
  assert.equal(timetableInsights(p, spread, 2)[0].level, 'blocker');
});

test('learning from choices moves weights towards what the coordinator picked', () => {
  const early = featuresOf([s('a', {}), s('b', { day: 'Tuesday' })], days, slots);
  const late = featuresOf([s('a', { slot: slots[3] }), s('b', { day: 'Tuesday', slot: slots[3] })], days, slots);
  let model = emptyModel();
  assert.ok(!hasLearned(model));
  model = learnFromChoice(model, early, [late]);
  model = learnFromChoice(model, early, [late]);
  assert.ok(hasLearned(model));
  assert.ok(model.weights.avoidLast > emptyModel().weights.avoidLast);
  assert.ok(solverWeights(model).late > solverWeights(emptyModel()).late);
  assert.match(describePreferences(model), /prefer/);
  const total = Object.values(model.weights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 0.01);
});

test('learning from drags', () => {
  const moved = learnFromMove(emptyModel(), { fromDay: 'Monday', fromSlot: 0, toDay: 'Monday', toSlot: 2, lastSlot: 3, teacherAlreadyThere: false });
  assert.ok(moved.weights.avoidFirst > emptyModel().weights.avoidFirst);
  assert.match(moved.history[0], /first period/);
  const nothing = learnFromMove(emptyModel(), { fromDay: 'Monday', fromSlot: 2, toDay: 'Monday', toSlot: 3, lastSlot: 3, teacherAlreadyThere: false });
  assert.equal(nothing.observations, 0);
});

test('commands: absences, leave and days off', () => {
  const p = profile();
  const mehta = teacherNamed(p, 'Mehta');
  assert.equal(findTeacher('mehta is sick', p.teachers)?.id, mehta.id);
  assert.equal(dateIn('tomorrow', MONDAY), '2026-10-20');
  assert.equal(dateIn('on Friday', MONDAY), '2026-10-23');
  assert.equal(dateIn('Monday', MONDAY), '2026-10-19');

  const absent = parseCommand('Prof. Mehta is absent tomorrow', p, MONDAY);
  assert.deepEqual(absent.actions, [{ type: 'markAbsent', teacherId: mehta.id, date: '2026-10-20' }]);
  assert.ok(absentTeacherIds(applyActions(p, absent.actions).operations, '2026-10-20').has(mehta.id));

  const leave = parseCommand('Iyer is on leave from Monday to Wednesday for a conference', p, MONDAY);
  assert.equal(leave.actions[0].type, 'leave');
  const applied = applyActions(p, leave.actions);
  assert.equal(applied.operations.absences.length, 3);
  assert.equal(applied.operations.absences[0].reason, 'conference');

  const off = parseCommand("Rao can't teach on Fridays", p, MONDAY);
  assert.deepEqual(off.actions, [{ type: 'teacherDayOff', teacherId: teacherNamed(p, 'Rao').id, day: 'Friday' }]);
});

test('commands: limits, adding and assigning', () => {
  const p = profile();
  const iyer = teacherNamed(p, 'Iyer');
  assert.deepEqual(parseCommand('max 3 a day for Iyer', p, MONDAY).actions, [
    { type: 'updateTeacher', teacherId: iyer.id, changes: { maxLecturesPerDay: 3 } },
  ]);
  assert.deepEqual(parseCommand('Iyer can teach at most 14 periods a week', p, MONDAY).actions[0], {
    type: 'updateTeacher',
    teacherId: iyer.id,
    changes: { maxLecturesPerWeek: 14 },
  });

  const added = parseCommand('add teacher Dr. Neha Kamat, expert in Machine Learning and Python', p, MONDAY);
  assert.deepEqual(added.actions, [{ type: 'addTeacher', name: 'Dr. Neha Kamat', expertise: ['Machine Learning', 'Python'] }]);
  const withKamat = applyActions(p, added.actions);
  assert.equal(withKamat.teachers.length, p.teachers.length + 1);
  // Adding the same name twice does not duplicate.
  assert.equal(applyActions(withKamat, added.actions).teachers.length, withKamat.teachers.length);

  const lab = parseCommand('add lab 3 with 32 seats', p, MONDAY).actions[0];
  assert.deepEqual(lab, { type: 'addRoom', name: 'Lab 3', roomType: 'lab', capacity: 32 });
  const cls = parseCommand('add class SE-C with 58 students and 2 batches', p, MONDAY).actions[0];
  assert.deepEqual(cls, { type: 'addClass', name: 'SE-C', size: 58, batches: ['C1', 'C2'] });

  const assign = parseCommand('Shah teaches Operating Systems for SE-B', p, MONDAY).actions[0];
  assert.equal(assign.type, 'assignTeacher');
  const newSubject = parseCommand('Kamat teaches Machine Learning 4 times a week', withKamat, MONDAY).actions[0];
  assert.deepEqual({ ...newSubject, teacherId: 'x' }, { type: 'addSubject', name: 'Machine Learning', isLab: false, sessionsPerWeek: 4, durationSlots: 1, teacherId: 'x' });
});

test('commands: generating, variations, hours, and graceful misses', () => {
  const p = profile();
  assert.deepEqual(parseCommand('make 3 variations', p).actions, [{ type: 'generateVariants', styles: ['balanced', 'compact', 'teacher_days'] }]);
  assert.deepEqual(parseCommand('generate a timetable that finishes early', p).actions, [{ type: 'generate', style: 'compact' }]);
  assert.deepEqual(parseCommand('classes start at 9 and end at 4', p).actions, [{ type: 'setHours', startTime: '09:00', endTime: '16:00' }]);
  assert.deepEqual(parseCommand('periods of 50 minutes', p).actions, [{ type: 'setHours', slotDurationMinutes: 50 }]);
  const miss = parseCommand('what is the weather', p);
  assert.equal(miss.understood, false);
  assert.ok(describeAction({ type: 'teacherDayOff', teacherId: p.teachers[0].id, day: 'Friday' }, p).includes('Fridays'));
});

test('model intents are checked against real names before becoming actions', async () => {
  const { actionsFromIntent } = await import('../src/command');
  const p = profile();
  const iyer = teacherNamed(p, 'Iyer');
  assert.deepEqual(actionsFromIntent({ intent: 'leave', teacher: 'Iyer', date_from: 'Monday', date_to: 'Wednesday' }, p, MONDAY).actions, [
    { type: 'leave', teacherId: iyer.id, from: '2026-10-19', to: '2026-10-21' },
  ]);
  // A teacher the model made up is refused.
  const ghost = actionsFromIntent({ intent: 'absent', teacher: 'Professor Nobody', date_from: 'today' }, p, MONDAY);
  assert.equal(ghost.understood, false);
  assert.deepEqual(ghost.actions, []);
  assert.equal(actionsFromIntent({ intent: 'limit_week', teacher: 'Iyer', number: 12 }, p, MONDAY).actions[0].type, 'updateTeacher');
  assert.equal(actionsFromIntent({ intent: 'unknown' }, p, MONDAY).understood, false);
});
