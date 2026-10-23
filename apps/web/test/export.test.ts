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
const slots = buildSlots('09:00', '13:00', 60, 2, 30); // 09-10, 10-11, break, 11:30-12:30

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
