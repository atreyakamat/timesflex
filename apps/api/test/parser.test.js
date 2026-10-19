import assert from 'node:assert/strict';
import test from 'node:test';

import { extractJson } from '../src/llm.js';
import {
  daysMentioned,
  divisionSize,
  groundRaw,
  matchName,
  mergeAssignments,
  normalizeDay,
  normalizeDraft,
  normalizeTime,
  ruleAssignments,
  ruleDivisions,
  ruleParse,
  ruleTiming,
  splitSentences,
} from '../src/parser.js';

const SAMPLE = `Classes run Monday to Friday, 9am to 4pm, 1 hour periods, with a 30 minute break after the 3rd period.
Divisions SE-A (batches A1, A2) and SE-B (batches B1, B2).
Prof. Mehta teaches DBMS 4 times a week in Room 101, max 3 lectures a day, not available on Friday.
Dr. Rao teaches Operating Systems 3 times a week in Room 102.
Thermodynamics is taken by Mrs. Iyer, four lectures a week. Mrs. Iyer can't come on Mondays.
DBMS Lab is a 2 hour practical once a week with Prof. Mehta in Lab 1.`;

test('timing rules read days, hours, period length and break', () => {
  assert.deepEqual(ruleTiming(SAMPLE), {
    workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    startTime: '09:00',
    endTime: '16:00',
    slotDurationMinutes: 60,
    breakDurationMinutes: 30,
    breakAfterSlots: 3,
  });
  assert.equal(ruleTiming('Mon-Sat from 8:30 to 2:30').endTime, '14:30');
  assert.equal(ruleTiming('college opens at 10 and closes at 5pm').endTime, '17:00');
  assert.equal(ruleTiming('lunch 45 min after 4th lecture').breakDurationMinutes, 45);
  assert.deepEqual(ruleTiming('3 to 4 lectures a day'), {});
  assert.deepEqual(daysMentioned('once a month on the monitor'), []);
});

test('splits sentences without breaking on titles', () => {
  assert.deepEqual(splitSentences('Prof. Mehta teaches DBMS. He is off on Fri.'), [
    'Prof. Mehta teaches DBMS.',
    'He is off on Fri.',
  ]);
});

test('assignment rules handle active, passive and list phrasings', () => {
  const found = ruleAssignments(
    `${SAMPLE}\nAlice teaches Algorithms, Bob teaches Networks.\nMr. Khan: Software Testing, 2 per week.\nAccounts - Mrs. Pillai, 5 periods a week.\nBusiness Law by Ms. Rego twice a week.`,
  ).map((item) => [item.teacher, item.subject, item.room, item.sessionsPerWeek]);
  assert.deepEqual(found, [
    ['Prof. Mehta', 'DBMS', 'Room 101', 4],
    ['Dr. Rao', 'Operating Systems', 'Room 102', 3],
    ['Mrs. Iyer', 'Thermodynamics', null, 4],
    ['Prof. Mehta', 'DBMS Lab', 'Lab 1', 1],
    ['Alice', 'Algorithms', null, null],
    ['Bob', 'Networks', null, null],
    ['Mr. Khan', 'Software Testing', null, 2],
    ['Mrs. Pillai', 'Accounts', null, 5],
    ['Ms. Rego', 'Business Law', null, 2],
  ]);
});

test('assignment rules read "X is a N hour practical ... with T in R"', () => {
  const [found] = ruleAssignments('DBMS Lab is a 2 hour practical once a week with Prof. Mehta in Lab 1.');
  assert.deepEqual(found, {
    teacher: 'Prof. Mehta',
    subject: 'DBMS Lab',
    room: 'Lab 1',
    sessionsPerWeek: 1,
    durationSlots: 2,
  });
  assert.deepEqual(ruleAssignments('Maths is a core subject.'), []);
});

test('division rules read batches in several phrasings', () => {
  assert.deepEqual(ruleDivisions('Divisions SE-A (batches A1, A2) and SE-B.'), [
    { name: 'SE-A', batches: ['A1', 'A2'] },
    { name: 'SE-B', batches: [] },
  ]);
  assert.deepEqual(ruleDivisions('Class FY-1 has batches P, Q, R.'), [{ name: 'FY-1', batches: ['P', 'Q', 'R'] }]);
});

test('grounding stops one teacher limits and days bleeding onto another', () => {
  // What a 0.6B model actually produced: Mehta's limit and day copied onto Rao.
  const modelOutput = {
    institution: { workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], slotDurationMinutes: 30 },
    teachers: [
      { name: 'Prof. Mehta', maxLecturesPerDay: 3, unavailableDays: ['Friday'] },
      { name: 'Dr. Rao', maxLecturesPerDay: 3, unavailableDays: ['Friday'] },
    ],
    subjects: [{ name: 'DBMS', isLab: false, sessionsPerWeek: 4, durationSlots: 3, teacher: 'Prof. Mehta' }],
  };
  const { draft } = normalizeDraft(groundRaw(mergeAssignments(modelOutput, SAMPLE), SAMPLE), SAMPLE);
  const teacher = (name) => draft.teachers.find((item) => item.name === name);

  assert.equal(draft.institution.slotDurationMinutes, 60);
  assert.equal(teacher('Prof. Mehta').maxLecturesPerDay, 3);
  assert.deepEqual(teacher('Prof. Mehta').unavailableDays, ['Friday']);
  assert.equal(teacher('Dr. Rao').maxLecturesPerDay, 4);
  assert.deepEqual(teacher('Dr. Rao').unavailableDays, []);
  assert.deepEqual(teacher('Mrs. Iyer').unavailableDays, ['Monday']);
  // "3 lectures" is not a block length: DBMS falls back to 1 slot.
  assert.equal(draft.subjects.find((item) => item.name === 'DBMS').durationSlots, 1);
  // Subjects the model missed are recovered by the rules.
  assert.ok(draft.subjects.some((item) => item.name === 'Operating Systems' && item.teacher === 'Dr. Rao'));
});

test('normalizes days and times', () => {
  assert.equal(normalizeDay('thurs'), 'Thursday');
  assert.equal(normalizeDay('xyz'), null);
  assert.equal(normalizeTime('9am'), '09:00');
  assert.equal(normalizeTime('4:30pm'), '16:30');
  assert.equal(normalizeTime('12 am'), '00:00');
  assert.equal(normalizeTime('25:00'), null);
});

test('matches teacher names loosely but unambiguously', () => {
  const teachers = ['Dr. Anita Rao', 'Prof. Mehta', 'Mr. Rao Junior'];
  assert.equal(matchName('Prof Mehta', teachers), 'Prof. Mehta');
  assert.equal(matchName('Mehta', teachers), 'Prof. Mehta');
  assert.equal(matchName('Anita Rao', teachers), 'Dr. Anita Rao');
  assert.equal(matchName('Nobody', teachers), null);
});

test('drops hallucinated entities and links subjects to teachers and rooms', () => {
  const text =
    'Mon to Fri, 9am-4pm. Division SE-A with batches A1, A2. Prof. Mehta teaches DBMS 4 times a week in Room 101, ' +
    'not available on Friday. DBMS Lab is a 2 hour practical with Prof. Mehta in Lab 3.';
  const raw = {
    institution: { name: null, workingDays: ['Monday-Friday'], startTime: '9am', endTime: '16:00' },
    divisions: [{ name: 'SE-A', batches: ['A1', 'A2', 'A1'] }],
    teachers: [
      { name: 'Prof. Mehta', maxLecturesPerDay: null, maxLecturesPerWeek: null, unavailableDays: ['Fri'] },
      { name: 'Prof. Ito', maxLecturesPerDay: 3, maxLecturesPerWeek: null, unavailableDays: [] },
    ],
    rooms: [{ name: 'Room 101', type: 'classroom', capacity: null }],
    subjects: [
      { name: 'DBMS', isLab: false, sessionsPerWeek: 4, durationSlots: null, teacher: 'Mehta', room: 'Room 101' },
      { name: 'DBMS Lab', isLab: true, sessionsPerWeek: null, durationSlots: 2, teacher: 'Prof. Mehta', room: 'Lab 3' },
      { name: 'Botany', isLab: false, sessionsPerWeek: 3, durationSlots: 1, teacher: 'Prof. Ito', room: 'Hall 7' },
    ],
  };

  const { draft, warnings } = normalizeDraft(raw, text);

  assert.deepEqual(draft.institution.workingDays, ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
  assert.equal(draft.institution.startTime, '09:00');
  assert.deepEqual(draft.divisions, [{ name: 'SE-A', batches: ['A1', 'A2'], size: null }]);
  assert.deepEqual(draft.teachers.map((t) => t.name), ['Prof. Mehta']);
  assert.deepEqual(draft.teachers[0].unavailableDays, ['Friday']);
  assert.deepEqual(draft.subjects.map((s) => s.name), ['DBMS', 'DBMS Lab']);
  assert.equal(draft.subjects[0].teacher, 'Prof. Mehta');
  assert.equal(draft.subjects[1].sessionsPerWeek, 1);
  // "Lab 3" was only mentioned beside the subject, so it is created as a lab room.
  assert.deepEqual(draft.rooms.find((r) => r.name === 'Lab 3')?.type, 'lab');
  assert.ok(warnings.some((w) => w.includes('Prof. Ito')));
  assert.ok(warnings.some((w) => w.includes('Botany')));
});

test('resolves subject teachers against the existing profile', () => {
  const { draft, warnings } = normalizeDraft(
    { subjects: [{ name: 'Maths', isLab: false, teacher: 'Rao', room: null }] },
    'Add Maths taught by Rao.',
    { teachers: ['Dr. Anita Rao'], rooms: [] },
  );
  assert.equal(draft.subjects[0].teacher, 'Dr. Anita Rao');
  assert.equal(draft.teachers.length, 0);
  assert.ok(warnings.some((w) => w.includes('no room')));
});

test('rule parser handles the classic list phrasing', () => {
  const text = 'Add teachers Alice, Bob and Charlie. Add subjects Maths (3 times), Physics Lab (2 slots). Rooms 101 and Lab 2. Divisions A, B.';
  const { draft } = normalizeDraft(ruleParse(text), text);
  assert.deepEqual(draft.teachers.map((t) => t.name), ['Alice', 'Bob', 'Charlie']);
  assert.deepEqual(draft.subjects.map((s) => [s.name, s.isLab, s.durationSlots, s.sessionsPerWeek]), [
    ['Maths', false, 1, 3],
    ['Physics Lab', true, 2, 1],
  ]);
  assert.deepEqual(draft.rooms.map((r) => [r.name, r.type]), [['101', 'classroom'], ['Lab 2', 'lab']]);
  assert.deepEqual(draft.divisions.map((d) => d.name), ['A', 'B']);
});

test('extracts JSON from noisy model replies', () => {
  assert.deepEqual(extractJson('<think>hmm</think>\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! {"a":{"b":2}} hope this helps'), { a: { b: 2 } });
  assert.throws(() => extractJson('no json here'));
});

test('reads division sizes from the sentence that names the division', () => {
  const text = 'Divisions SE-A (batches A1, A2) and SE-B. SE-A has 64 students and SE-B has 58 students.';
  assert.equal(divisionSize('SE-A', text), 64);
  assert.equal(divisionSize('SE-B', text), 58);
  assert.equal(divisionSize('FE-A', text), null);
  assert.equal(divisionSize('TE-A', 'Divisions TE-A and TE-B, 60 students each.'), 60);
  const { draft } = normalizeDraft(groundRaw(mergeAssignments({}, text), text), text);
  assert.deepEqual(
    draft.divisions.map((item) => [item.name, item.size]),
    [
      ['SE-A', 64],
      ['SE-B', 58],
    ],
  );
});
