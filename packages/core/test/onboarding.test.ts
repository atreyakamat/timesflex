import assert from 'node:assert/strict';
import test from 'node:test';

import { applyActions, parseSubjectList, parseTeacherLines, sampleProfile, seedRooms, seedSubjects, setupEstimate, teachableSubjects, teachersFor, type ProfileData } from '../src/index';

const blank = (): ProfileData => ({ ...sampleProfile(), teachers: [], subjects: [], rooms: [], divisions: [] });
const withTeachers = (people: [string, string[]][]) =>
  applyActions(
    blank(),
    people.map(([name, expertise]) => ({ type: 'addTeacher' as const, name, expertise })),
  ) as ProfileData;

test('subject lists split on commas, "and" and slashes, without repeats', () => {
  assert.deepEqual(parseSubjectList('DBMS, OS and Networks / dbms'), ['DBMS', 'OS', 'Networks']);
  assert.deepEqual(parseSubjectList('  '), []);
});

test('a pasted teacher list understands the ways people write it', () => {
  assert.deepEqual(
    parseTeacherLines('Prof. Mehta: DBMS, Operating Systems\nDr. Rao - Maths\nIyer teaches Networks and Networks Lab\n\n3. Prof. Shah\nprof. mehta: Duplicate'),
    [
      { name: 'Prof. Mehta', canTeach: ['DBMS', 'Operating Systems'] },
      { name: 'Dr. Rao', canTeach: ['Maths'] },
      { name: 'Iyer', canTeach: ['Networks', 'Networks Lab'] },
      { name: 'Prof. Shah', canTeach: [] },
    ],
  );
});

test('hyphens inside a name are not separators', () => {
  assert.deepEqual(parseTeacherLines('Anne-Marie Lobo: Physics'), [{ name: 'Anne-Marie Lobo', canTeach: ['Physics'] }]);
});

test('each subject is listed once, however many teachers can teach it', () => {
  const profile = withTeachers([['A', ['DBMS', 'OS']], ['B', ['dbms']]]);
  assert.deepEqual(teachableSubjects(profile), ['DBMS', 'OS']);
  assert.deepEqual(teachersFor('DBMS', profile).map((t) => t.name), ['A', 'B']);
});

test('subjects come from what teachers can teach; labs are recognised; load is shared out', () => {
  const profile = seedSubjects(withTeachers([['A', ['DBMS', 'OS', 'Networks']], ['B', ['DBMS', 'OS', 'Networks Lab']]]));
  assert.deepEqual(profile.subjects.map((s) => s.name), ['DBMS', 'OS', 'Networks', 'Networks Lab']);
  const lab = profile.subjects.find((s) => s.name === 'Networks Lab')!;
  assert.equal(lab.isLab, true);
  assert.equal(lab.durationSlots, 2);
  const nameOf = (id: string) => profile.teachers.find((t) => t.id === id)?.name;
  assert.equal(nameOf(lab.teacherId), 'B');
  assert.equal(nameOf(profile.subjects.find((s) => s.name === 'Networks')!.teacherId), 'A');
});

test('seeding twice adds nothing and keeps changes already made', () => {
  const once = seedSubjects(withTeachers([['A', ['DBMS']]]));
  const edited = { ...once, subjects: once.subjects.map((s) => ({ ...s, sessionsPerWeek: 5 })) };
  const twice = seedSubjects(edited);
  assert.equal(twice.subjects.length, 1);
  assert.equal(twice.subjects[0].sessionsPerWeek, 5);
});

test('rooms are suggested from the classes and labs, and never replace real ones', () => {
  const base = applyActions(seedSubjects(withTeachers([['A', ['Physics Lab']]])), [
    { type: 'addClass', name: 'SE-A', size: 60, batches: ['A1', 'A2'] },
    { type: 'addClass', name: 'SE-B', size: 40, batches: [] },
  ]) as ProfileData;
  const rooms = seedRooms(base).rooms;
  assert.deepEqual(rooms.map((r) => [r.name, r.type, r.capacity]), [
    ['Room 101', 'classroom', 60],
    ['Room 102', 'classroom', 60],
    ['Lab 1', 'lab', 30],
    ['Lab 2', 'lab', 30],
  ]);
  const kept = { ...base, rooms: [rooms[0]] };
  assert.equal(seedRooms(kept).rooms.length, 1);
});

test('the estimate says when a teacher or a class does not fit', () => {
  const base = seedRooms(applyActions(seedSubjects(withTeachers([['A', ['Maths']]])), [{ type: 'addClass', name: 'SE-A', size: 60, batches: [] }]) as ProfileData);
  const fine = setupEstimate(base);
  assert.equal(fine.fits, true);
  assert.equal(fine.teachers[0].load, 3);
  assert.equal(fine.classes[0].load, 3);

  const heavy = { ...base, subjects: base.subjects.map((s) => ({ ...s, sessionsPerWeek: 40 })) };
  const estimate = setupEstimate(heavy);
  assert.equal(estimate.fits, false);
  assert.equal(estimate.teachers[0].fits, false);
  assert.equal(estimate.buildSeconds(3), 21);
});

test('a big department gets enough labs, and the estimate notices when labs run short', () => {
  const actions = Array.from({ length: 24 }, (_, i) => ({ type: 'addClass' as const, name: `C${i + 1}`, size: 60, batches: [`A${i}`, `B${i}`] }));
  const base = applyActions(seedSubjects(withTeachers([['A', ['Physics Lab']]])), actions) as ProfileData;
  const seeded = seedRooms(base);
  const labs = seeded.rooms.filter((room) => room.type === 'lab');
  assert.ok(labs.length > 2, `expected more than 2 labs, got ${labs.length}`);
  assert.equal(setupEstimate(seeded).rooms.find((line) => line.id === 'labs')?.fits, true);
  const short = { ...seeded, rooms: seeded.rooms.filter((room) => room.type !== 'lab').concat(labs[0]), subjects: seeded.subjects.map((s) => ({ ...s, sessionsPerWeek: 4 })) };
  assert.equal(setupEstimate(short).fits, false);
});
