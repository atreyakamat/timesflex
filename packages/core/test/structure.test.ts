import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addMissingRooms,
  addSubjects,
  applyStructure,
  buildSolverRequest,
  buildSlots,
  classGroups,
  copySubjects,
  emptyStructure,
  groupKey,
  linkDivisionTeacher,
  linkTeacher,
  linkTeachersFromList,
  sampleProfile,
  seedRooms,
  renameInStructure,
  sampleInstitute,
  setupEstimate,
  setupInsights,
  structureImpact,
  timetableDrift,
  structureBoxes,
  structureTotals,
  subjectDivisions,
  subjectsInGroup,
  subjectsNeedingTeacher,
  teacherFor,
  type InstituteStructure,
  type ProfileData,
} from '../src/index';

const blank = (): ProfileData => ({ ...sampleProfile(), teachers: [], subjects: [], rooms: [], divisions: [] });
const grid = (extra: Partial<InstituteStructure> = {}): InstituteStructure => ({ ...emptyStructure(), years: ['FY', 'SY'], branches: ['Comp', 'IT'], ...extra });
const SY_COMP = groupKey('SY', 'Comp');
const SY_IT = groupKey('SY', 'IT');
const names = (p: ProfileData) => p.divisions.map((d) => d.name);

test('years and branches make the grid of classes', () => {
  const p = applyStructure(blank(), grid());
  assert.deepEqual(names(p), ['FY Comp', 'FY IT', 'SY Comp', 'SY IT']);
  assert.equal(p.divisions[0].size, 60);
});

test('several divisions are lettered, and totals add up', () => {
  const s = grid({ years: ['SY'], cells: { [SY_COMP]: { divisions: 3, students: 40 } } });
  assert.deepEqual(names(applyStructure(blank(), s)), ['SY Comp A', 'SY Comp B', 'SY Comp C', 'SY IT']);
  assert.deepEqual(structureTotals(s), { classes: 4, students: 180 });
});

test('a common year is one box, not split by branch', () => {
  const p = applyStructure(blank(), grid({ commonYears: ['FY'], cells: { [groupKey('FY', '')]: { divisions: 2, students: 70 } } }));
  assert.deepEqual(names(p), ['FY A', 'FY B', 'SY Comp', 'SY IT']);
  assert.equal(p.divisions[0].size, 70);
});

test('with no branches, as in a school, each year is one box', () => {
  assert.deepEqual(structureBoxes({ ...emptyStructure(), years: ['Class 9'] }).map((b) => b.label), ['Class 9']);
});

test('lab batches are named per class, and can be turned off', () => {
  const s = grid({ years: ['SY'], branches: ['Comp'], cells: { [SY_COMP]: { divisions: 2, students: 60 } } });
  assert.deepEqual(applyStructure(blank(), s).divisions.map((d) => d.batches), [['A1', 'A2'], ['B1', 'B2']]);
  assert.deepEqual(applyStructure(blank(), { ...s, batches: 0 }).divisions[0].batches, []);
});

test('changing the grid keeps what is already set up, and leaves hand-made classes alone', () => {
  const handMade: ProfileData = { ...blank(), divisions: [{ id: 'old', name: 'Evening batch', batches: [] }] };
  const first = applyStructure(handMade, grid({ years: ['SY'] }));
  const comp = first.divisions.find((d) => d.name === 'SY Comp')!;
  const again = applyStructure(first, grid({ years: ['SY'], cells: { [SY_COMP]: { divisions: 1, students: 75 } } }));
  assert.equal(again.divisions.find((d) => d.name === 'SY Comp')!.id, comp.id);
  assert.equal(again.divisions.find((d) => d.name === 'SY Comp')!.size, 75);
  assert.ok(again.divisions.some((d) => d.id === 'old'));
});

test('a subject is added once and every division gets it', () => {
  let p = applyStructure(blank(), grid({ years: ['SY'], cells: { [SY_COMP]: { divisions: 2, students: 60 } } }));
  p = addSubjects(p, SY_COMP, 'DBMS, Operating Systems, DBMS Lab, dbms');
  const subjects = subjectsInGroup(p, SY_COMP);
  assert.deepEqual(subjects.map((s) => s.name), ['DBMS', 'Operating Systems', 'DBMS Lab']);
  assert.deepEqual(subjectDivisions(subjects[0], p.divisions).map((d) => d.name), ['SY Comp A', 'SY Comp B']);
  assert.equal(subjects[2].isLab, true);
  assert.equal(subjects[2].durationSlots, 2);
  assert.equal(subjectsInGroup(p, SY_IT).length, 0);
});

test('adding a division later gives it the subjects; removing a year takes its subjects', () => {
  let p = applyStructure(blank(), grid({ years: ['SY'] }));
  p = addSubjects(p, SY_COMP, 'DBMS');
  p = applyStructure(p, grid({ years: ['SY'], cells: { [SY_COMP]: { divisions: 2, students: 60 } } }));
  assert.deepEqual(subjectDivisions(p.subjects[0], p.divisions).map((d) => d.name), ['SY Comp A', 'SY Comp B']);
  p = applyStructure(p, grid({ years: ['FY'] }));
  assert.equal(p.subjects.length, 0);
});

test('one branch can copy another’s subjects, but not who teaches them', () => {
  let p = applyStructure(blank(), grid({ years: ['SY'] }));
  p = addSubjects(p, SY_COMP, 'DBMS, Maths');
  p = linkTeachersFromList(p, 'Mehta: DBMS').profile;
  p = copySubjects(p, SY_COMP, SY_IT);
  const it = subjectsInGroup(p, SY_IT);
  assert.deepEqual(it.map((s) => s.name), ['DBMS', 'Maths']);
  assert.equal(it[0].teacherId, '');
  assert.deepEqual(it[0].divisionIds, p.divisions.filter((d) => d.name === 'SY IT').map((d) => d.id));
});

test('one teacher covers all divisions by default, and a split gives each its own', () => {
  let p = applyStructure(blank(), grid({ years: ['SY'], branches: ['Comp'], cells: { [SY_COMP]: { divisions: 2, students: 60 } } }));
  p = addSubjects(p, SY_COMP, 'DBMS');
  p = linkTeachersFromList(p, 'Mehta\nRao').profile;
  const [a, b] = p.divisions;
  const [mehta, rao] = p.teachers;
  const subject = p.subjects[0].id;
  assert.equal(subjectsNeedingTeacher(p).length, 1);

  p = linkTeacher(p, subject, mehta.id);
  assert.equal(subjectsNeedingTeacher(p).length, 0);
  assert.equal(teacherFor(p.subjects[0], a.id), mehta.id);
  assert.equal(teacherFor(p.subjects[0], b.id), mehta.id);
  assert.deepEqual(p.teachers[0].expertise, ['DBMS']);

  p = linkDivisionTeacher(p, subject, b.id, rao.id);
  assert.equal(teacherFor(p.subjects[0], a.id), mehta.id);
  assert.equal(teacherFor(p.subjects[0], b.id), rao.id);

  // Choosing one teacher again undoes the split.
  p = linkTeacher(p, subject, mehta.id);
  assert.equal(teacherFor(p.subjects[0], b.id), mehta.id);
});

test('a split with no default still counts as taught, division by division', () => {
  let p = applyStructure(blank(), grid({ years: ['SY'], branches: ['Comp'], cells: { [SY_COMP]: { divisions: 2, students: 60 } } }));
  p = addSubjects(p, SY_COMP, 'DBMS');
  p = linkTeachersFromList(p, 'Mehta').profile;
  p = linkDivisionTeacher(p, p.subjects[0].id, p.divisions[0].id, p.teachers[0].id);
  assert.equal(subjectsNeedingTeacher(p).length, 1);
  p = linkDivisionTeacher(p, p.subjects[0].id, p.divisions[1].id, p.teachers[0].id);
  assert.equal(subjectsNeedingTeacher(p).length, 0);
});

test('a pasted list links teachers to subjects, keeps assignments, and reports typos', () => {
  let p = applyStructure(blank(), grid({ years: ['SY'] }));
  p = addSubjects(p, SY_COMP, 'DBMS, OS');
  p = addSubjects(p, SY_IT, 'DBMS');
  const result = linkTeachersFromList(p, 'Mehta: DBMS, Opertaing Systems\nRao: OS, DBMS');
  p = result.profile;
  assert.deepEqual(result.unmatched, ['Opertaing Systems']);
  const mehta = p.teachers.find((t) => t.name === 'Mehta')!.id;
  const rao = p.teachers.find((t) => t.name === 'Rao')!.id;
  assert.deepEqual(p.subjects.map((s) => [s.name, s.teacherId]), [['DBMS', mehta], ['OS', rao], ['DBMS', mehta]]);
});

test('groups keep the order of the grid', () => {
  const p = applyStructure(blank(), grid({ commonYears: ['FY'] }));
  assert.deepEqual(classGroups(p).map((g) => g.label), ['FY', 'SY Comp', 'SY IT']);
});

test('adding a branch later can top up rooms without touching the ones there', () => {
  let p = applyStructure(blank(), grid({ years: ['SY'], branches: ['Comp'] }));
  p = addSubjects(p, SY_COMP, 'DBMS, DBMS Lab');
  p = seedRooms(p);
  const before = p.rooms.map((r) => r.id);
  p = applyStructure(p, grid({ years: ['SY', 'TY'], branches: ['Comp'] }));
  p = addMissingRooms(p);
  assert.ok(before.every((id) => p.rooms.some((r) => r.id === id)));
  assert.equal(p.rooms.filter((r) => r.type === 'classroom').length, 2);
  assert.equal(new Set(p.rooms.map((r) => r.name)).size, p.rooms.length);
  assert.equal(addMissingRooms(p).rooms.length, p.rooms.length);
});

test('the whole path produces a request where each class only gets its own subjects', () => {
  let p = applyStructure(blank(), grid({ commonYears: ['FY'], years: ['FY', 'SY'], batches: 2 }));
  p = addSubjects(p, groupKey('FY', ''), 'Maths');
  p = addSubjects(p, SY_COMP, 'DBMS, DBMS Lab');
  p = copySubjects(p, SY_COMP, SY_IT);
  p = linkTeachersFromList(p, 'Rao: Maths\nMehta: DBMS, DBMS Lab').profile;
  p = seedRooms(p);
  assert.equal(setupInsights(p).filter((i) => i.level === 'blocker').length, 0);
  const i = p.institution;
  const request = buildSolverRequest({
    days: i.workingDays,
    slots: buildSlots(i.startTime, i.endTime, i.slotDurationMinutes, i.breakAfterSlots, i.breakDurationMinutes),
    divisions: p.divisions,
    teachers: p.teachers,
    rooms: p.rooms,
    subjects: p.subjects,
    locked: [],
    style: 'balanced',
  });
  const fy = p.divisions.find((d) => d.name === 'FY')!.id;
  const inFy = request.sessions.filter((s) => s.division_id === fy);
  assert.equal(inFy.length, 3);
  assert.ok(inFy.every((s) => s.subject_id === p.subjects[0].id));
});

test('changing how many divisions keeps each class, its students and its subjects', () => {
  let p = applyStructure(blank(), grid({ years: ['SY'], branches: ['Comp'] }));
  p = addSubjects(p, SY_COMP, 'DBMS');
  const id = p.divisions[0].id;
  p = { ...p, divisions: p.divisions.map((d) => ({ ...d, students: [{ id: 's', rollNo: '1', name: 'A' }] })) };
  p = applyStructure(p, grid({ years: ['SY'], branches: ['Comp'], cells: { [SY_COMP]: { divisions: 2, students: 60 } } }));
  assert.equal(p.divisions[0].id, id);
  assert.equal(p.divisions[0].name, 'SY Comp A');
  assert.equal(p.divisions[0].students?.length, 1);
  assert.equal(p.subjects[0].divisionIds?.length, 2);
});

test('removing a year says exactly what would go, and doing nothing removes nothing', () => {
  let p = applyStructure(blank(), grid({ years: ['SY', 'TY'], branches: ['Comp'] }));
  p = addSubjects(p, SY_COMP, 'DBMS, OS');
  const s = p.structure!;
  assert.deepEqual(structureImpact(p, s), { classes: [], subjects: [] });
  const impact = structureImpact(p, { ...s, years: ['TY'] });
  assert.deepEqual(impact.classes.map((d) => d.name), ['SY Comp']);
  assert.deepEqual(impact.subjects.map((x) => x.name), ['DBMS', 'OS']);
});

test('a year or branch can be renamed, and everything stays attached', () => {
  let p = applyStructure(blank(), grid({ years: ['BE'], cells: { [groupKey('BE', 'Comp')]: { divisions: 2, students: 50 } } }));
  p = addSubjects(p, groupKey('BE', 'Comp'), 'AI');
  const ids = p.divisions.map((d) => d.id);
  p = renameInStructure(p, 'year', 'BE', 'Final');
  p = renameInStructure(p, 'branch', 'Comp', 'CSE');
  assert.deepEqual(p.divisions.map((d) => d.name), ['Final CSE A', 'Final CSE B', 'Final IT']);
  assert.deepEqual(p.divisions.map((d) => d.id).slice(0, 2), ids.slice(0, 2));
  assert.equal(p.subjects[0].group, groupKey('Final', 'CSE'));
  assert.equal(subjectsInGroup(p, groupKey('Final', 'CSE')).length, 1);
  assert.equal(p.structure!.cells[groupKey('Final', 'CSE')].students, 50);
  // Applying the grid again changes nothing.
  assert.deepEqual(applyStructure(p, p.structure!).divisions.map((d) => d.id), p.divisions.map((d) => d.id));
});

test('renaming onto an existing name is refused', () => {
  const p = applyStructure(blank(), grid());
  assert.equal(renameInStructure(p, 'year', 'FY', 'sy'), p);
  assert.equal(renameInStructure(p, 'year', 'FY', '  '), p);
});

const placed = (subject_id: string, division_id: string, teacher_id: string, batch: string | null = null, duration_slots = 1) =>
  ({ id: Math.random().toString(36), subject_id, division_id, teacher_id, batch, duration_slots, kind: 'lecture', room_id: 'r', day: 'Monday', slot: 'a' }) as never;

test('the timetable knows what setup has changed: added, removed and reassigned', () => {
  let p = applyStructure(blank(), grid({ years: ['SY'], branches: ['Comp'], batches: 0 }));
  p = addSubjects(p, SY_COMP, 'DBMS');
  p = linkTeachersFromList(p, 'Mehta: DBMS\nRao').profile;
  const d = p.divisions[0].id;
  const s = p.subjects[0].id;
  const [mehta, rao] = p.teachers.map((t) => t.id);
  const full = [placed(s, d, mehta), placed(s, d, mehta), placed(s, d, mehta)];
  assert.equal(timetableDrift(p, full).changed, false);

  const added = addSubjects(p, SY_COMP, 'OS');
  assert.equal(timetableDrift(added, full).missing, 3);
  assert.equal(timetableDrift(added, full).kept.length, 3);

  const fewer = { ...p, subjects: p.subjects.map((x) => ({ ...x, sessionsPerWeek: 2 })) };
  assert.equal(timetableDrift(fewer, full).stale.length, 1);

  const gone = { ...p, subjects: [] };
  assert.equal(timetableDrift(gone, full).stale.length, 3);

  const swapped = linkTeacher(p, s, rao);
  const drift = timetableDrift(swapped, full);
  assert.equal(drift.reassigned, 3);
  assert.ok(drift.kept.every((x) => x.teacher_id === rao));
  assert.equal(drift.stale.length, 0);
});

test('the sample college is a real institute, with no problems to fix first', () => {
  const p = sampleInstitute();
  assert.deepEqual(classGroups(p).map((g) => g.label), ['FY', 'SY Comp', 'SY IT', 'TY Comp', 'TY IT']);
  assert.equal(p.divisions.length, 7);
  assert.equal(setupInsights(p).filter((i) => i.level === 'blocker').length, 0);
  assert.equal(setupEstimate(p).fits, true);
  assert.equal(subjectsNeedingTeacher(p).length, 0);
  assert.ok(p.divisions.every((d) => d.students?.length === d.size));
  // Sample numbers can't reach a real person.
  assert.ok(p.teachers.every((t) => t.phone?.startsWith('00000')));
});
