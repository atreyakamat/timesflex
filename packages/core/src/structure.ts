import { applyActions } from './agent';
import { canTeach, parseSubjectList, parseTeacherLines, seedRooms } from './onboarding';
import type { ProfileData } from './samples';
import type { DivisionForm, ScheduledSession, SubjectForm } from './types';
import { buildSlots, createId, divisionSize, subjectDivisions, teacherFor } from './utils';
import { batchNames } from './naming';

/**
 * How an institute is organised: years and branches make a grid, and each box says how many
 * divisions it has. Classes come from the grid, subjects belong to a year and branch so every
 * division gets them, and teachers are linked to subjects.
 */

export const DEFAULT_YEARS = ['FY', 'SY', 'TY', 'BE'];
export const DEFAULT_BRANCHES = ['Comp', 'IT', 'Mech', 'ECE'];
const DEFAULT_CELL = { divisions: 1, students: 60 };
const LAB = /\b(lab|labs|laboratory|practical|practicals|workshop)\b/i;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export interface StructureCell {
  divisions: number;
  /** Students in each division. */
  students: number;
}

export interface InstituteStructure {
  years: string[];
  branches: string[];
  /** Years taught as one, not split by branch: often FY. */
  commonYears: string[];
  cells: Record<string, StructureCell>;
  /** Lab batches per division. 0 means none. */
  batches: number;
}

export const emptyStructure = (): InstituteStructure => ({ years: [], branches: [], commonYears: [], cells: {}, batches: 2 });

export const groupKey = (year: string, branch: string) => `${year}|${branch}`;
const groupName = (year: string, branch: string) => `${year} ${branch}`.trim();

/** The boxes of the grid, in order. With no branches, or a common year, a year is one box. */
export const structureBoxes = (structure: InstituteStructure) =>
  structure.years.flatMap((year) =>
    (structure.commonYears.includes(year) || !structure.branches.length ? [''] : structure.branches).map((branch) => {
      const key = groupKey(year, branch);
      return { key, year, branch, label: groupName(year, branch), ...DEFAULT_CELL, ...structure.cells[key] };
    }),
  );

/** Class names for one box: "SY Comp", or "SY Comp A", "SY Comp B" when there are several. */
const divisionNames = (label: string, count: number) => (count > 1 ? Array.from({ length: count }, (_, i) => `${label} ${String.fromCharCode(65 + i)}`) : [label]);

export const structureTotals = (structure: InstituteStructure) => {
  const boxes = structureBoxes(structure);
  return {
    classes: boxes.reduce((sum, box) => sum + box.divisions, 0),
    students: boxes.reduce((sum, box) => sum + box.divisions * box.students, 0),
  };
};

const addSubjectTo = (subject: SubjectForm, divisions: DivisionForm[]) => {
  const ids = divisions.filter((d) => d.group === subject.group).map((d) => d.id);
  const overrides = Object.fromEntries(Object.entries(subject.teacherOverrides ?? {}).filter(([id]) => ids.includes(id)));
  return { ...subject, divisionIds: ids, teacherOverrides: overrides };
};

/**
 * Makes the classes match the grid. Classes keep their identity where the name still fits, so
 * nothing already set up is lost; classes made by hand are left alone.
 */
export const applyStructure = <P extends ProfileData>(profile: P, structure: InstituteStructure): P => {
  const wanted: DivisionForm[] = structureBoxes(structure).flatMap((box) =>
    divisionNames(box.label, box.divisions).map((name, position) => {
      const existing = profile.divisions.filter((d) => d.group === box.key)[position];
      const batches = existing?.batches.length === structure.batches ? existing.batches : structure.batches ? batchNames(name, structure.batches) : [];
      return { ...(existing ?? { id: createId() }), name, batches, size: box.students, year: box.year, branch: box.branch, group: box.key };
    }),
  );
  const handMade = profile.divisions.filter((d) => !d.group);
  const divisions = [...handMade, ...wanted];
  const subjects = profile.subjects.flatMap((subject) => {
    if (subject.group === undefined) return [subject];
    const next = addSubjectTo(subject, divisions);
    // A subject whose year and branch is gone goes with it.
    return next.divisionIds?.length ? [next] : [];
  });
  return { ...profile, structure, divisions, subjects };
};

/** What a change to the grid would remove, so it can be confirmed first. */
export const structureImpact = (profile: ProfileData, next: InstituteStructure) => {
  const after = applyStructure(profile, next);
  const classes = profile.divisions.filter((d) => !after.divisions.some((other) => other.id === d.id));
  const subjects = profile.subjects.filter((s) => !after.subjects.some((other) => other.id === s.id));
  return { classes, subjects };
};

/** Renames a year or branch everywhere it appears, keeping every class and subject attached. */
export const renameInStructure = <P extends ProfileData>(profile: P, kind: 'year' | 'branch', from: string, to: string): P => {
  const name = to.trim();
  const structure = profile.structure;
  const list = kind === 'year' ? structure?.years : structure?.branches;
  if (!structure || !name || !list?.includes(from) || list.some((item) => item !== from && same(item, name))) return profile;
  const swap = (value: string) => (value === from ? name : value);
  const newKey = (key: string) => {
    const [year, branch] = key.split('|');
    return kind === 'year' ? groupKey(swap(year), branch) : groupKey(year, swap(branch));
  };
  return {
    ...profile,
    structure: {
      ...structure,
      years: kind === 'year' ? structure.years.map(swap) : structure.years,
      branches: kind === 'branch' ? structure.branches.map(swap) : structure.branches,
      commonYears: kind === 'year' ? structure.commonYears.map(swap) : structure.commonYears,
      cells: Object.fromEntries(Object.entries(structure.cells).map(([key, cell]) => [newKey(key), cell])),
    },
    divisions: profile.divisions.map((division) => {
      if (!division.group) return division;
      const oldLabel = groupName(division.year ?? '', division.branch ?? '');
      const year = kind === 'year' ? swap(division.year ?? '') : (division.year ?? '');
      const branch = kind === 'branch' ? swap(division.branch ?? '') : (division.branch ?? '');
      return { ...division, year, branch, group: newKey(division.group), name: `${groupName(year, branch)}${division.name.slice(oldLabel.length)}` };
    }),
    subjects: profile.subjects.map((subject) => (subject.group ? { ...subject, group: newKey(subject.group) } : subject)),
  };
};

export interface ClassGroup {
  key: string;
  label: string;
  divisions: DivisionForm[];
}

/** Classes grouped by year and branch. Classes made by hand form their own group. */
export const classGroups = (profile: Pick<ProfileData, 'divisions'>): ClassGroup[] => {
  const groups: ClassGroup[] = [];
  for (const division of profile.divisions) {
    const key = division.group ?? '';
    const label = division.group ? groupName(division.year ?? '', division.branch ?? '') : 'Your classes';
    const found = groups.find((group) => group.key === key);
    if (found) found.divisions.push(division);
    else groups.push({ key, label, divisions: [division] });
  }
  return groups;
};

export const subjectsInGroup = (profile: Pick<ProfileData, 'subjects'>, key: string) => profile.subjects.filter((subject) => (subject.group ?? '') === key);

const newSubject = (name: string, group: ClassGroup): SubjectForm => {
  const isLab = LAB.test(name);
  return {
    id: createId(),
    name,
    isLab,
    sessionsPerWeek: isLab ? 1 : 3,
    durationSlots: isLab ? 2 : 1,
    teacherId: '',
    roomId: '',
    ...(group.key ? { group: group.key, divisionIds: group.divisions.map((d) => d.id) } : { divisionIds: [] }),
    teacherOverrides: {},
  };
};

/** Adds "DBMS, OS, DBMS Lab" to a year and branch. Names it already has are skipped. */
export const addSubjects = <P extends ProfileData>(profile: P, key: string, text: string): P => {
  const group = classGroups(profile).find((item) => item.key === key);
  if (!group) return profile;
  const have = subjectsInGroup(profile, key);
  const fresh = parseSubjectList(text).filter((name) => !have.some((subject) => same(subject.name, name)));
  return { ...profile, subjects: [...profile.subjects, ...fresh.map((name) => newSubject(name, group))] };
};

/** Branches often share a syllabus. Copies the subjects, not who teaches them. */
export const copySubjects = <P extends ProfileData>(profile: P, fromKey: string, toKey: string): P => {
  const group = classGroups(profile).find((item) => item.key === toKey);
  if (!group) return profile;
  const have = subjectsInGroup(profile, toKey);
  const copies = subjectsInGroup(profile, fromKey)
    .filter((subject) => !have.some((other) => same(other.name, subject.name)))
    .map((subject) => ({ ...newSubject(subject.name, group), isLab: subject.isLab, sessionsPerWeek: subject.sessionsPerWeek, durationSlots: subject.durationSlots }));
  return { ...profile, subjects: [...profile.subjects, ...copies] };
};

const withExpertise = <P extends ProfileData>(profile: P, teacherId: string, subjectName: string): P => ({
  ...profile,
  teachers: profile.teachers.map((teacher) => (teacher.id === teacherId && !canTeach(teacher, subjectName) ? { ...teacher, expertise: [...(teacher.expertise ?? []), subjectName] } : teacher)),
});

/** One teacher for every division of the subject. */
export const linkTeacher = <P extends ProfileData>(profile: P, subjectId: string, teacherId: string): P => {
  const subject = profile.subjects.find((item) => item.id === subjectId);
  if (!subject) return profile;
  return withExpertise({ ...profile, subjects: profile.subjects.map((item) => (item.id === subjectId ? { ...item, teacherId, teacherOverrides: {} } : item)) }, teacherId, subject.name);
};

/** A different teacher for one division: Mehta for SY-A, Rao for SY-B. */
export const linkDivisionTeacher = <P extends ProfileData>(profile: P, subjectId: string, divisionId: string, teacherId: string): P => {
  const subject = profile.subjects.find((item) => item.id === subjectId);
  if (!subject) return profile;
  return withExpertise(
    { ...profile, subjects: profile.subjects.map((item) => (item.id === subjectId ? { ...item, teacherOverrides: { ...item.teacherOverrides, [divisionId]: teacherId } } : item)) },
    teacherId,
    subject.name,
  );
};

/** Subjects where some division still has nobody to teach it. */
export const subjectsNeedingTeacher = (profile: Pick<ProfileData, 'subjects' | 'divisions' | 'teachers'>) =>
  profile.subjects.filter((subject) => subjectDivisions(subject, profile.divisions).some((division) => !profile.teachers.some((t) => t.id === (subject.teacherOverrides?.[division.id] || subject.teacherId))));

/**
 * Reads "Mehta: DBMS, OS", one teacher a line, and gives them each matching subject nobody takes
 * yet. Subjects it can't find are returned, so a typo doesn't quietly vanish.
 */
export const linkTeachersFromList = <P extends ProfileData>(profile: P, text: string): { profile: P; unmatched: string[] } => {
  let next = profile;
  const unmatched: string[] = [];
  for (const person of parseTeacherLines(text)) {
    next = applyActions(next, [{ type: 'addTeacher', name: person.name }]) as P;
    const teacher = next.teachers.find((item) => same(item.name, person.name))!;
    for (const name of person.canTeach) {
      const matching = next.subjects.filter((subject) => same(subject.name, name));
      if (!matching.length) {
        unmatched.push(name);
        next = withExpertise(next, teacher.id, name);
      }
      for (const subject of matching.filter((item) => !item.teacherId)) next = linkTeacher(next, subject.id, teacher.id);
    }
  }
  return { profile: next, unmatched };
};

/**
 * Suggests rooms when there are too few for the classes, such as after adding a branch. It only
 * adds, using a size that fits, and carries on the numbering.
 */
export const addMissingRooms = <P extends ProfileData>(profile: P): P => {
  if (!profile.rooms.length) return seedRooms(profile);
  const seeded = seedRooms({ ...profile, rooms: [] });
  const largest = Math.max(0, ...profile.divisions.map(divisionSize));
  const taken = new Set(profile.rooms.map((room) => room.name.toLowerCase()));
  const uniqueName = (base: string, start: number) => {
    let n = start;
    while (taken.has(`${base} ${n}`.toLowerCase())) n += 1;
    taken.add(`${base} ${n}`.toLowerCase());
    return `${base} ${n}`;
  };
  const extra = (kind: 'lab' | 'classroom') => {
    const have = profile.rooms.filter((room) => (kind === 'lab' ? room.type === 'lab' : room.type !== 'lab')).length;
    const need = seeded.rooms.filter((room) => (kind === 'lab' ? room.type === 'lab' : room.type !== 'lab'));
    return need.slice(have).map((room) => ({ ...room, id: createId(), name: uniqueName(kind === 'lab' ? 'Lab' : 'Room', kind === 'lab' ? 1 : 101), capacity: room.capacity || largest || 60 }));
  };
  return { ...profile, rooms: [...profile.rooms, ...extra('classroom'), ...extra('lab')] };
};

export interface TimetableDrift {
  /** Classes still right, with any change of teacher applied. They can stay exactly where they are. */
  kept: ScheduledSession[];
  /** How many classes the setup needs that aren't on the timetable. */
  missing: number;
  /** Classes on the timetable whose subject, class or teacher has gone. */
  stale: ScheduledSession[];
  reassigned: number;
  changed: boolean;
}

/** How the timetable differs from the setup, after classes, subjects or teachers change. */
export const timetableDrift = (profile: Pick<ProfileData, 'subjects' | 'divisions'>, sessions: ScheduledSession[]): TimetableDrift => {
  const remaining = new Set(sessions.map((s) => s.id));
  const kept: ScheduledSession[] = [];
  let missing = 0;
  let reassigned = 0;
  for (const subject of profile.subjects) {
    for (const division of subjectDivisions(subject, profile.divisions)) {
      for (const batch of subject.isLab && division.batches.length ? division.batches : [null]) {
        const here = sessions.filter((s) => remaining.has(s.id) && s.subject_id === subject.id && s.division_id === division.id && (s.batch ?? null) === batch && s.duration_slots === subject.durationSlots);
        const keep = here.slice(0, subject.sessionsPerWeek);
        const teacher = teacherFor(subject, division.id);
        for (const session of keep) {
          remaining.delete(session.id);
          if (session.teacher_id !== teacher) reassigned += 1;
          kept.push({ ...session, teacher_id: teacher });
        }
        missing += subject.sessionsPerWeek - keep.length;
      }
    }
  }
  const stale = sessions.filter((s) => remaining.has(s.id));
  return { kept, missing, stale, reassigned, changed: missing > 0 || stale.length > 0 || reassigned > 0 };
};

/** Periods a week, for showing how full things are. */
export const weekPeriodsOf = ({ institution: i }: ProfileData) => buildSlots(i.startTime, i.endTime, i.slotDurationMinutes, i.breakAfterSlots, i.breakDurationMinutes).length * i.workingDays.length;
