import { emptyOperations, splitIntoBatches } from './ops';
import type {
  DepartmentForm,
  DivisionForm,
  InstitutionForm,
  OperationsData,
  RoomForm,
  StudentRecord,
  SubjectForm,
  TeacherForm,
} from './types';
import { createId } from './utils';

export interface ProfileData {
  institution: InstitutionForm;
  department: DepartmentForm;
  divisions: DivisionForm[];
  teachers: TeacherForm[];
  rooms: RoomForm[];
  subjects: SubjectForm[];
  operations: OperationsData;
}

const FIRST = [
  'Aarav', 'Aditi', 'Akash', 'Ananya', 'Arjun', 'Bhavna', 'Chirag', 'Deepa', 'Dev', 'Diya', 'Esha', 'Farhan',
  'Gauri', 'Harsh', 'Ishaan', 'Isha', 'Jay', 'Kavya', 'Karan', 'Lavanya', 'Manav', 'Meera', 'Nikhil', 'Neha',
  'Om', 'Pooja', 'Pranav', 'Priya', 'Rahul', 'Riya', 'Rohan', 'Sakshi', 'Sameer', 'Sana', 'Siddharth', 'Sneha',
  'Tanmay', 'Tanvi', 'Uday', 'Vaishnavi', 'Varun', 'Vidya', 'Yash', 'Zoya',
];
const LAST = [
  'Patil', 'Sharma', 'Desai', 'Joshi', 'Kulkarni', 'Naik', 'Gupta', 'Iyer', 'Menon', 'Shaikh', 'Rao', 'Pawar',
  'Fernandes', 'Kamat', 'Shetty', 'Bhat', 'Chavan', 'Mehta', 'Pillai', 'Verma',
];

const roster = (prefix: string, count: number, offset: number): StudentRecord[] =>
  Array.from({ length: count }, (_, index) => {
    const name = `${FIRST[(index * 7 + offset) % FIRST.length]} ${LAST[(index * 3 + offset) % LAST.length]}`;
    return { id: createId(), rollNo: `${prefix}${String(index + 1).padStart(2, '0')}`, name };
  });

/** A complete, solvable second-year Computer Engineering department to explore every screen. */
export const sampleProfile = (): ProfileData => {
  const teacher = (name: string, extra: Partial<TeacherForm> = {}): TeacherForm => ({
    id: createId(),
    name,
    maxLecturesPerDay: 4,
    maxLecturesPerWeek: 18,
    unavailableDays: [],
    canTeachLabs: true,
    ...extra,
  });
  const mehta = teacher('Prof. Mehta', {
    designation: 'Associate Professor',
    qualification: 'M.Tech, PhD',
    experienceYears: 14,
    expertise: ['Databases', 'DBMS', 'SQL', 'Data Mining'],
    email: 'mehta@sample-college.edu',
    phone: '9820012345',
    unavailableDays: ['Friday'],
  });
  const rao = teacher('Dr. Rao', {
    designation: 'Professor & HOD',
    qualification: 'PhD',
    experienceYears: 22,
    expertise: ['Operating Systems', 'Distributed Computing'],
    email: 'rao@sample-college.edu',
    preferredSlots: ['Monday|09:00-10:00', 'Tuesday|09:00-10:00', 'Wednesday|09:00-10:00'],
  });
  const kulkarni = teacher('Ms. Kulkarni', {
    designation: 'Assistant Professor',
    phone: '9820054321',
    qualification: 'M.Sc Mathematics',
    expertise: ['Mathematics', 'Statistics'],
  });
  const shah = teacher('Mr. Shah', { designation: 'Assistant Professor', expertise: ['Networking', 'Security'] });
  const iyer = teacher('Dr. Iyer', {
    designation: 'Associate Professor',
    email: 'iyer@sample-college.edu',
    expertise: ['Data Structures', 'Algorithms', 'Python'],
  });
  const dsouza = teacher("Ms. D'Souza", { designation: 'Visiting Faculty', expertise: ['Environmental Science'], canTeachLabs: false, unavailableDays: ['Monday'] });
  const pillai = teacher('Mr. Pillai', { designation: 'Lab Instructor', expertise: ['DBMS', 'Data Structures', 'Linux'] });

  const room = (name: string, type: RoomForm['type'], capacity: number, extra: Partial<RoomForm> = {}): RoomForm => ({
    id: createId(),
    name,
    type,
    capacity,
    equipment: '',
    ...extra,
  });
  const lab1 = room('Lab 1', 'lab', 35, { equipment: '32 PCs, MySQL, PostgreSQL', building: 'Main block', floor: '2' });
  const rooms = [
    room('Room 101', 'classroom', 70, { building: 'Main block', floor: '1' }),
    room('Room 102', 'classroom', 70, { building: 'Main block', floor: '1' }),
    room('Room 201', 'classroom', 60),
    lab1,
    room('Lab 2', 'lab', 35, { equipment: '32 PCs, GCC, Python' }),
    room('Seminar Hall', 'seminar-hall', 120, { unavailableDays: ['Wednesday'] }),
  ];

  const yearLabel = 'Second year · Semester 3';
  const seA: DivisionForm = { id: createId(), name: 'SE-A', batches: ['A1', 'A2'], yearLabel, classTeacherId: mehta.id };
  const seB: DivisionForm = { id: createId(), name: 'SE-B', batches: ['B1', 'B2'], yearLabel, classTeacherId: kulkarni.id };
  seA.students = splitIntoBatches(roster('SEA', 60, 0), seA.batches);
  seB.students = splitIntoBatches(roster('SEB', 56, 5), seB.batches);
  seA.size = seA.students.length;
  seB.size = seB.students.length;

  const subject = (name: string, teacherId: string, extra: Partial<SubjectForm> = {}): SubjectForm => ({
    id: createId(),
    name,
    isLab: false,
    durationSlots: 1,
    sessionsPerWeek: 3,
    teacherId,
    roomId: '',
    divisionIds: [],
    teacherOverrides: {},
    difficult: false,
    ...extra,
  });

  return {
    institution: {
      name: 'Sample College of Engineering',
      type: 'college',
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      startTime: '09:00',
      endTime: '16:00',
      slotDurationMinutes: 60,
      breakAfterSlots: 3,
      breakDurationMinutes: 30,
      academicYear: '2026-27',
      address: 'Panaji, Goa',
    },
    department: { name: 'Computer Engineering', yearLabel: 'Second year', semesterLabel: 'Semester 3' },
    divisions: [seA, seB],
    teachers: [mehta, rao, kulkarni, shah, iyer, dsouza, pillai],
    rooms,
    subjects: [
      subject('Database Management Systems', mehta.id, { code: 'CS301', sessionsPerWeek: 4, credits: 4 }),
      subject('Operating Systems', rao.id, { code: 'CS302', credits: 3 }),
      subject('Engineering Mathematics III', kulkarni.id, { code: 'MA301', sessionsPerWeek: 4, difficult: true, credits: 4 }),
      subject('Computer Networks', shah.id, { code: 'CS303', credits: 3 }),
      subject('Data Structures', iyer.id, { code: 'CS304', sessionsPerWeek: 4, difficult: true, credits: 4 }),
      subject('Environmental Studies', dsouza.id, { code: 'HS301', sessionsPerWeek: 2, credits: 2 }),
      subject('DBMS Lab', mehta.id, {
        code: 'CS391',
        isLab: true,
        durationSlots: 2,
        sessionsPerWeek: 1,
        roomId: lab1.id,
        teacherOverrides: { [seB.id]: pillai.id },
      }),
      subject('Data Structures Lab', iyer.id, {
        code: 'CS394',
        isLab: true,
        durationSlots: 2,
        sessionsPerWeek: 1,
        teacherOverrides: { [seB.id]: pillai.id },
      }),
    ],
    operations: emptyOperations(),
  };
};
