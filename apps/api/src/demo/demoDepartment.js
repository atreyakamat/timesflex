// A fictional department for demos and pilot training: two years, four divisions, eight teachers.
// Shapes match what the web app saves as an institution profile.

export const DEMO_NAME = 'Demo Institute of Technology';

const institution = {
  name: DEMO_NAME,
  type: 'college',
  workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  startTime: '09:00',
  endTime: '17:00',
  slotDurationMinutes: 60,
  breakAfterSlots: 2,
  breakDurationMinutes: 15,
  breaks: [
    { afterSlot: 2, minutes: 15, label: 'Break' },
    { afterSlot: 4, minutes: 45, label: 'Lunch' },
  ],
  labCountsAsOne: false,
};

const SE = 'SE · Sem 3';
const TE = 'TE · Sem 5';

const divisions = [
  { id: 'div-se-a', name: 'SE-A', batches: ['A1', 'A2'], size: 60, yearLabel: SE },
  { id: 'div-se-b', name: 'SE-B', batches: ['B1', 'B2'], size: 60, yearLabel: SE },
  { id: 'div-te-a', name: 'TE-A', batches: ['TA1', 'TA2'], size: 60, yearLabel: TE },
  { id: 'div-te-b', name: 'TE-B', batches: ['TB1', 'TB2'], size: 60, yearLabel: TE },
];
const seDivisions = ['div-se-a', 'div-se-b'];
const teDivisions = ['div-te-a', 'div-te-b'];

const teacher = (id, name, extra = {}) => ({ id, name, maxLecturesPerDay: 4, maxLecturesPerWeek: 18, ...extra });
const teachers = [
  teacher('t-kulkarni', 'Dr. Kulkarni', { canTeachLabs: false }),
  teacher('t-dsouza', "Prof. D'Souza"),
  teacher('t-naik', 'Ms. Naik'),
  teacher('t-fernandes', 'Mr. Fernandes', { canTeachLabs: false }),
  teacher('t-rao', 'Dr. Rao'),
  teacher('t-mehta', 'Prof. Mehta'),
  teacher('t-shetty', 'Dr. Shetty', { canTeachLabs: false, unavailableDays: ['Friday'] }),
  teacher('t-pai', 'Ms. Pai', { canTeachLabs: false }),
];

const rooms = [
  { id: 'r-101', name: 'Room 101', type: 'classroom', capacity: 70 },
  { id: 'r-102', name: 'Room 102', type: 'classroom', capacity: 70 },
  { id: 'r-103', name: 'Room 103', type: 'classroom', capacity: 70 },
  { id: 'r-104', name: 'Room 104', type: 'classroom', capacity: 70 },
  { id: 'lab-1', name: 'Lab 1', type: 'lab', capacity: 35, equipment: '32 PCs, GCC, Python' },
  { id: 'lab-2', name: 'Lab 2', type: 'lab', capacity: 35, equipment: '32 PCs, MySQL, PostgreSQL' },
  { id: 'lab-3', name: 'Networks Lab', type: 'lab', capacity: 35, equipment: '30 PCs, switches, Packet Tracer' },
  { id: 'hall-1', name: 'Seminar Hall', type: 'seminar-hall', capacity: 120 },
];

const subject = (id, name, teacherId, divisionIds, extra = {}) => ({
  id,
  name,
  isLab: false,
  durationSlots: 1,
  sessionsPerWeek: 3,
  teacherId,
  roomId: '',
  divisionIds,
  teacherOverrides: {},
  ...extra,
});
const lab = (id, name, teacherId, divisionIds, roomId = '') =>
  subject(id, name, teacherId, divisionIds, { isLab: true, durationSlots: 2, sessionsPerWeek: 1, roomId });

const subjects = [
  subject('s-maths3', 'Engineering Maths III', 't-kulkarni', seDivisions, { sessionsPerWeek: 4, difficult: true }),
  subject('s-ds', 'Data Structures', 't-dsouza', seDivisions),
  subject('s-dbms', 'Database Systems', 't-naik', seDivisions),
  subject('s-dlc', 'Digital Logic', 't-fernandes', seDivisions),
  lab('s-ds-lab', 'Data Structures Lab', 't-dsouza', seDivisions, 'lab-1'),
  lab('s-dbms-lab', 'Database Lab', 't-naik', seDivisions, 'lab-2'),
  subject('s-os', 'Operating Systems', 't-rao', teDivisions, { difficult: true }),
  subject('s-cn', 'Computer Networks', 't-mehta', teDivisions),
  subject('s-toc', 'Theory of Computation', 't-shetty', teDivisions, { difficult: true }),
  subject('s-se', 'Software Engineering', 't-pai', teDivisions, { sessionsPerWeek: 2 }),
  lab('s-os-lab', 'Operating Systems Lab', 't-rao', teDivisions),
  lab('s-cn-lab', 'Networks Lab', 't-mehta', teDivisions, 'lab-3'),
];

/** Period labels such as "09:00-10:00", with the breaks above taken out. */
export function demoSlots({ startTime, endTime, slotDurationMinutes, breaks }) {
  const toMinutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const label = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const slots = [];
  let at = toMinutes(startTime);
  while (at + slotDurationMinutes <= toMinutes(endTime)) {
    slots.push(`${label(at)}-${label(at + slotDurationMinutes)}`);
    at += slotDurationMinutes;
    at += breaks.find((item) => item.afterSlot === slots.length)?.minutes ?? 0;
  }
  return slots;
}

export function demoProfile() {
  return {
    institution,
    department: { name: 'Computer Engineering', yearLabel: 'SE', semesterLabel: 'Sem 3' },
    divisions,
    teachers,
    rooms,
    subjects,
    slots: demoSlots(institution),
  };
}

/** Adds the demo department unless an institution with its name already exists. */
export async function seedDemo(store) {
  const existing = (await store.listInstitutions()).find((item) => item.name === DEMO_NAME);
  if (existing) return { created: false, institution: existing };
  const created = await store.createInstitution({ name: DEMO_NAME, type: 'college', data: demoProfile() });
  await store.addAudit({ username: null, action: 'institution.created', target: DEMO_NAME, detail: { seeded: true } });
  return { created: true, institution: created };
}
