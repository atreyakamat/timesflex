import { splitIntoBatches } from './ops';
import { rosterOf, sampleProfile, type ProfileData } from './samples';
import { applyStructure, groupKey, type InstituteStructure } from './structure';
import type { RoomForm, SubjectForm, TeacherForm } from './types';
import { createId } from './utils';

/**
 * A small engineering college to explore: first year common to all, Comp and IT after that, with
 * real class lists, a shared maths teacher, and one subject split between divisions. The phone
 * numbers start 00000 so they can't reach anyone by accident.
 */
export const sampleInstitute = (): ProfileData => {
  const teachers: TeacherForm[] = [
    ['Prof. Mehta', 'Associate Professor', 'mehta'],
    ['Dr. Rao', 'Professor & HOD', 'rao'],
    ['Ms. Kulkarni', 'Assistant Professor', 'kulkarni'],
    ['Mr. Shah', 'Assistant Professor', 'shah'],
    ['Dr. Iyer', 'Associate Professor', 'iyer'],
    ["Ms. D'Souza", 'Visiting Faculty', 'dsouza'],
    ['Mr. Pillai', 'Lab Instructor', 'pillai'],
    ['Dr. Sen', 'Associate Professor', 'sen'],
    ['Ms. Naik', 'Assistant Professor', 'naik'],
    ['Mr. Fernandes', 'Assistant Professor', 'fernandes'],
    ['Ms. Patil', 'Assistant Professor', 'patil'],
    ['Mr. Bhat', 'Lab Instructor', 'bhat'],
  ].map(([name, designation, email], index) => ({
    id: createId(),
    name,
    designation,
    email: `${email}@sample-college.edu`,
    phone: `00000 100${String(index + 10)}`,
    maxLecturesPerDay: 5,
    maxLecturesPerWeek: 20,
    unavailableDays: [],
    canTeachLabs: true,
  }));
  const who = (name: string) => teachers.find((t) => t.name.includes(name))!.id;

  const structure: InstituteStructure = {
    years: ['FY', 'SY', 'TY'],
    branches: ['Comp', 'IT'],
    commonYears: ['FY'],
    batches: 2,
    cells: {
      [groupKey('FY', '')]: { divisions: 2, students: 60 },
      [groupKey('SY', 'Comp')]: { divisions: 2, students: 60 },
      [groupKey('SY', 'IT')]: { divisions: 1, students: 60 },
      [groupKey('TY', 'Comp')]: { divisions: 1, students: 55 },
      [groupKey('TY', 'IT')]: { divisions: 1, students: 50 },
    },
  };

  const base = sampleProfile();
  let profile: ProfileData = applyStructure(
    { ...base, institution: { ...base.institution, name: 'Sample College of Engineering' }, department: { name: '', yearLabel: '', semesterLabel: '' }, teachers, subjects: [], rooms: [], divisions: [] },
    structure,
  );

  const subject = (group: string, name: string, teacher: string, sessionsPerWeek = 3, extra: Partial<SubjectForm> = {}): SubjectForm => {
    const isLab = /\blab\b/i.test(name);
    return {
      id: createId(),
      name,
      group,
      isLab,
      durationSlots: isLab ? 2 : 1,
      sessionsPerWeek: isLab ? 1 : sessionsPerWeek,
      teacherId: who(teacher),
      roomId: '',
      divisionIds: profile.divisions.filter((d) => d.group === group).map((d) => d.id),
      teacherOverrides: {},
      ...extra,
    };
  };
  const FY = groupKey('FY', '');
  const SYC = groupKey('SY', 'Comp');
  const SYI = groupKey('SY', 'IT');
  const TYC = groupKey('TY', 'Comp');
  const TYI = groupKey('TY', 'IT');
  const syCompB = profile.divisions.find((d) => d.name === 'SY Comp B')!.id;
  const subjects = [
    subject(FY, 'Engineering Mathematics I', 'Kulkarni', 3, { difficult: true }),
    subject(FY, 'Engineering Physics', 'Sen'),
    subject(FY, 'Programming in C', 'Patil'),
    subject(FY, 'Communication Skills', "D'Souza", 2),
    subject(FY, 'Physics Lab', 'Bhat'),
    subject(SYC, 'Database Management Systems', 'Mehta', 3, { teacherOverrides: { [syCompB]: who('Patil') } }),
    subject(SYC, 'Operating Systems', 'Rao'),
    subject(SYC, 'Engineering Mathematics III', 'Kulkarni', 3, { difficult: true }),
    subject(SYC, 'Data Structures', 'Iyer'),
    subject(SYC, 'DBMS Lab', 'Pillai'),
    subject(SYI, 'Database Management Systems', 'Mehta'),
    subject(SYI, 'Computer Organisation', 'Sen'),
    subject(SYI, 'Engineering Mathematics III', 'Kulkarni', 3, { difficult: true }),
    subject(SYI, 'Data Structures', 'Iyer'),
    subject(SYI, 'DBMS Lab', 'Pillai'),
    subject(TYC, 'Computer Networks', 'Shah'),
    subject(TYC, 'Software Engineering', 'Naik'),
    subject(TYC, 'Machine Learning', 'Rao'),
    subject(TYC, 'Networks Lab', 'Bhat'),
    subject(TYI, 'Computer Networks', 'Shah'),
    subject(TYI, 'Web Technologies', 'Fernandes'),
    subject(TYI, 'Information Security', 'Naik'),
    subject(TYI, 'Web Technologies Lab', 'Fernandes'),
  ];

  // Real class lists, so attendance has something to show.
  const divisions = profile.divisions.map((division, index) => {
    const prefix = division.name.replace(/\s/g, '').toUpperCase();
    const students = splitIntoBatches(rosterOf(prefix, division.size ?? 60, index * 4), division.batches);
    return { ...division, students };
  });

  const room = (name: string, type: RoomForm['type'], capacity: number): RoomForm => ({ id: createId(), name, type, capacity, equipment: '' });
  const rooms = [
    ...['101', '102', '103', '201', '202', '203', '204'].map((n) => room(`Room ${n}`, 'classroom', 70)),
    room('Seminar Hall', 'seminar-hall', 120),
    room('Lab 1', 'lab', 35),
    room('Lab 2', 'lab', 35),
    room('Lab 3', 'lab', 35),
  ];
  profile = { ...profile, divisions, subjects, rooms };
  return profile;
};
