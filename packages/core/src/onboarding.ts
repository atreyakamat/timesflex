import { teacherCapacity, teacherLoad, classLoad } from './insights';
import type { ProfileData } from './samples';
import type { TeacherForm } from './types';
import { buildSlots, createId, divisionSize, subjectDivisions } from './utils';

/**
 * First-run setup asks one thing: who teaches, and what can each of them teach? Subjects and
 * rooms are worked out from that, ready to adjust, and the estimate shows whether it all fits.
 */

const LAB = /\b(lab|labs|laboratory|practical|practicals|workshop)\b/i;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Splits "DBMS, OS and Networks" into its subjects. */
export const parseSubjectList = (text: string): string[] => {
  const seen: string[] = [];
  for (const raw of text.split(/,|;|\/|&|\band\b|\n/i)) {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (name && !seen.some((item) => same(item, name))) seen.push(name);
  }
  return seen;
};

/**
 * Reads a pasted list, one teacher a line:
 *   Prof. Mehta: DBMS, Operating Systems
 *   Dr. Rao - Maths
 *   Iyer teaches Networks and Networks Lab
 */
export const parseTeacherLines = (text: string): { name: string; canTeach: string[] }[] => {
  const people: { name: string; canTeach: string[] }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const clean = line.trim().replace(/^[\d.)\-*•\s]+(?=\p{L})/u, '');
    if (!clean) continue;
    const match = /^(.+?)(?:\s*:\s*|\s+[-–—]\s+|\s+(?:teaches|can teach)\s+)(.*)$/i.exec(clean);
    const name = (match ? match[1] : clean).trim();
    if (!name || people.some((person) => same(person.name, name))) continue;
    people.push({ name, canTeach: match ? parseSubjectList(match[2]) : [] });
  }
  return people;
};

/** Every subject some teacher can teach, each once, in the order they were added. */
export const teachableSubjects = (profile: Pick<ProfileData, 'teachers'>): string[] => {
  const names: string[] = [];
  for (const teacher of profile.teachers) {
    for (const tag of teacher.expertise ?? []) {
      if (tag.trim() && !names.some((name) => same(name, tag))) names.push(tag.trim());
    }
  }
  return names;
};

export const canTeach = (teacher: TeacherForm, subjectName: string) => (teacher.expertise ?? []).some((tag) => same(tag, subjectName));

export const teachersFor = (subjectName: string, profile: Pick<ProfileData, 'teachers'>) => profile.teachers.filter((teacher) => canTeach(teacher, subjectName));

/** Adds a subject for everything teachers can teach, given to whoever has the most time spare. */
export const seedSubjects = <P extends ProfileData>(profile: P): P => {
  let next = profile;
  for (const name of teachableSubjects(profile)) {
    if (next.subjects.some((subject) => same(subject.name, name))) continue;
    const isLab = LAB.test(name);
    const [best] = teachersFor(name, next)
      .map((teacher) => ({ teacher, spare: teacherCapacity(teacher, next.institution.workingDays) - teacherLoad(teacher, next) }))
      .sort((a, b) => b.spare - a.spare);
    next = {
      ...next,
      subjects: [
        ...next.subjects,
        {
          id: createId(),
          name,
          isLab,
          sessionsPerWeek: isLab ? 1 : 3,
          durationSlots: isLab ? 2 : 1,
          teacherId: best?.teacher.id ?? '',
          roomId: '',
          divisionIds: [],
          teacherOverrides: {},
        },
      ],
    };
  }
  return next;
};

const weekPeriods = ({ institution: i }: ProfileData) => buildSlots(i.startTime, i.endTime, i.slotDurationMinutes, i.breakAfterSlots, i.breakDurationMinutes).length * i.workingDays.length;

/** Room periods needed in a week. Each lab batch needs its own sitting. */
const roomDemand = (profile: ProfileData) => {
  let classrooms = 0;
  let labs = 0;
  for (const subject of profile.subjects) {
    for (const division of subjectDivisions(subject, profile.divisions)) {
      const periods = subject.sessionsPerWeek * subject.durationSlots;
      if (subject.isLab) labs += periods * Math.max(1, division.batches.length);
      else classrooms += periods;
    }
  }
  return { classrooms, labs };
};

/** A first guess at rooms: one classroom per class, and enough labs for parallel batches. */
export const seedRooms = <P extends ProfileData>(profile: P): P => {
  if (profile.rooms.length) return profile;
  const largest = Math.max(0, ...profile.divisions.map((division) => divisionSize(division)));
  const rooms: P['rooms'] = profile.divisions.map((_, index) => ({
    id: createId(),
    name: `Room ${101 + index}`,
    type: 'classroom',
    capacity: largest || 60,
    equipment: '',
  }));
  if (profile.subjects.some((subject) => subject.isLab)) {
    const batches = Math.max(1, ...profile.divisions.map((division) => division.batches.length));
    const batchSize = largest ? Math.ceil(largest / batches) : 30;
    // Enough for parallel batches, and for the week's lab periods with room to manoeuvre.
    const demand = roomDemand(profile).labs;
    const periods = Math.max(1, weekPeriods(profile));
    const labs = Math.max(batches, Math.ceil(demand / (periods * 0.6)));
    for (let index = 0; index < labs; index += 1) {
      rooms.push({ id: createId(), name: `Lab ${index + 1}`, type: 'lab', capacity: batchSize, equipment: '' });
    }
  }
  return { ...profile, rooms };
};

export interface LoadLine {
  id: string;
  name: string;
  load: number;
  capacity: number;
  fits: boolean;
}

/** How full the week will be, before anything is built. */
export const setupEstimate = (profile: ProfileData) => {
  const { institution: i } = profile;
  const periodsPerDay = buildSlots(i.startTime, i.endTime, i.slotDurationMinutes, i.breakAfterSlots, i.breakDurationMinutes).length;
  const periodsPerWeek = periodsPerDay * i.workingDays.length;
  const classes: LoadLine[] = profile.divisions.map((division) => {
    const load = classLoad(division.id, profile);
    return { id: division.id, name: division.name, load, capacity: periodsPerWeek, fits: load <= periodsPerWeek };
  });
  const teachers: LoadLine[] = profile.teachers.map((teacher) => {
    const load = teacherLoad(teacher, profile);
    const capacity = Math.min(teacherCapacity(teacher, i.workingDays), periodsPerWeek);
    return { id: teacher.id, name: teacher.name, load, capacity, fits: load <= capacity };
  });
  const demand = roomDemand(profile);
  const pool = (name: string, id: string, load: number, count: number): LoadLine => ({ id, name, load, capacity: count * periodsPerWeek, fits: load <= count * periodsPerWeek });
  const rooms: LoadLine[] = [
    pool('Classrooms', 'classrooms', demand.classrooms, profile.rooms.filter((room) => room.type !== 'lab').length),
    ...(demand.labs ? [pool('Labs', 'labs', demand.labs, profile.rooms.filter((room) => room.type === 'lab').length)] : []),
  ];
  return {
    periodsPerDay,
    periodsPerWeek,
    classes,
    teachers,
    rooms,
    fits: [...classes, ...teachers, ...rooms].every((line) => line.fits),
    /** Measured upper bound: a six-second search per version, plus about a second per class to prepare. */
    buildSeconds: (versions: number) => versions * (6 + profile.divisions.length),
  };
};
