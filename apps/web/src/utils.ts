import type {
  Conflict,
  DivisionForm,
  RoomForm,
  ScheduledSession,
  SessionRequest,
  SolverRequest,
  SubjectForm,
  SlotKey,
  TeacherForm,
  TimeRef,
} from './types';

export const createId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const parseTime = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

const formatTime = (minutes: number) => {
  const hours = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  const mins = (minutes % 60).toString().padStart(2, '0');
  return `${hours}:${mins}`;
};

export const buildSlots = (
  startTime: string,
  endTime: string,
  durationMinutes: number,
  breakAfterSlots: number | null,
  breakDurationMinutes: number | null,
) => {
  const slots: string[] = [];
  if (!startTime || !endTime || durationMinutes <= 0) {
    return slots;
  }

  const endMinutes = parseTime(endTime);
  let cursor = parseTime(startTime);
  let slotIndex = 0;

  while (cursor + durationMinutes <= endMinutes) {
    slots.push(`${formatTime(cursor)}-${formatTime(cursor + durationMinutes)}`);
    cursor += durationMinutes;
    slotIndex += 1;

    if (breakAfterSlots && breakDurationMinutes && slotIndex === breakAfterSlots) {
      cursor += breakDurationMinutes;
    }
  }

  return slots;
};

/** Slot indices followed by a break (the next slot does not start when this one ends). */
export const breaksAfter = (slots: string[]) => {
  const breaks = new Set<number>();
  for (let i = 0; i < slots.length - 1; i += 1) {
    if (slots[i].split('-')[1] !== slots[i + 1].split('-')[0]) breaks.add(i);
  }
  return breaks;
};

export const slotKey = (day: string, slot: string): SlotKey => `${day}|${slot}`;

/** Whole days plus single cells, limited to the days and slots that currently exist. */
const timeRefs = (days: string[], slots: string[], wholeDays: string[] = [], cells: SlotKey[] = []): TimeRef[] => [
  ...wholeDays.filter((day) => days.includes(day)).map((day) => ({ day })),
  ...cells
    .map((key) => key.split('|'))
    .filter(([day, slot]) => days.includes(day) && slots.includes(slot) && !wholeDays.includes(day))
    .map(([day, slot]) => ({ day, slot })),
];

/** True when a teacher or room is blocked for this day and slot. */
export const isBlocked = (
  item: { unavailableDays?: string[]; unavailableSlots?: SlotKey[] } | undefined,
  day: string,
  slot: string,
) => Boolean(item && (item.unavailableDays?.includes(day) || item.unavailableSlots?.includes(slotKey(day, slot))));

export const subjectDivisions = (subject: SubjectForm, divisions: DivisionForm[]) =>
  subject.divisionIds?.length ? divisions.filter((item) => subject.divisionIds!.includes(item.id)) : divisions;

export const teacherFor = (subject: SubjectForm, divisionId: string) =>
  subject.teacherOverrides?.[divisionId] || subject.teacherId;

/** Students in one sitting: the whole division, or an even share of it for a lab batch. */
export const groupSize = (division: DivisionForm | undefined, batch: string | null | undefined) => {
  const size = division?.size ?? 0;
  if (!size) return 0;
  return batch && division?.batches.length ? Math.ceil(size / division.batches.length) : size;
};

const roomFits = (room: RoomForm, isLab: boolean, size: number) =>
  (room.type === 'lab') === isLab && !(size && room.capacity && room.capacity < size);

const groupKey = (division: DivisionForm | undefined, subject: SubjectForm, batch: string | null) =>
  `${division?.id}|${batch ?? ''}|${subject.id}`;

/**
 * Expand the profile into one solver session per weekly occurrence. Labs run per
 * batch when the division has batches; locked sessions from the current timetable
 * are carried over pinned, and only the remainder is left for the solver to place.
 */
export const buildSolverRequest = ({
  days,
  slots,
  divisions,
  teachers,
  rooms,
  subjects,
  locked,
}: {
  days: string[];
  slots: string[];
  divisions: DivisionForm[];
  teachers: TeacherForm[];
  rooms: RoomForm[];
  subjects: SubjectForm[];
  locked: ScheduledSession[];
}): SolverRequest => {
  const pinnedCount = new Map<string, number>();
  const sessions: SessionRequest[] = [];

  for (const session of locked) {
    const subject = subjects.find((item) => item.id === session.subject_id);
    const division = divisions.find((item) => item.id === session.division_id);
    if (!subject || !division) continue;
    const key = groupKey(division, subject, session.batch ?? null);
    pinnedCount.set(key, (pinnedCount.get(key) ?? 0) + 1);
    sessions.push({ ...session, locked: true });
  }

  for (const subject of subjects) {
    for (const division of subjectDivisions(subject, divisions)) {
      const groups = subject.isLab && division.batches.length ? division.batches : [null];
      for (const batch of groups) {
        const remaining = subject.sessionsPerWeek - (pinnedCount.get(groupKey(division, subject, batch)) ?? 0);
        for (let count = 0; count < remaining; count += 1) {
          sessions.push({
            id: createId(),
            subject_id: subject.id,
            teacher_id: teacherFor(subject, division.id),
            room_id: subject.roomId,
            division_id: division.id,
            batch,
            kind: subject.isLab ? 'lab' : 'lecture',
            duration_slots: subject.durationSlots,
            size: groupSize(division, batch),
            difficult: Boolean(subject.difficult),
          });
        }
      }
    }
  }

  const names: Record<string, string> = {};
  for (const item of [...divisions, ...teachers, ...rooms, ...subjects]) names[item.id] = item.name;

  return {
    days,
    slots,
    sessions,
    teacher_constraints: teachers.map((teacher) => ({
      teacher_id: teacher.id,
      max_lectures_per_day: teacher.maxLecturesPerDay,
      max_lectures_per_week: teacher.maxLecturesPerWeek,
      unavailable: timeRefs(days, slots, teacher.unavailableDays, teacher.unavailableSlots),
      preferred: timeRefs(days, slots, [], teacher.preferredSlots),
    })),
    rooms: rooms.map((room) => ({
      id: room.id,
      type: room.type,
      capacity: room.capacity,
      unavailable: timeRefs(days, slots, room.unavailableDays, room.unavailableSlots),
    })),
    names,
  };
};

interface Profile {
  days: string[];
  slots: string[];
  divisions: DivisionForm[];
  subjects: SubjectForm[];
  teachers: TeacherForm[];
  rooms: RoomForm[];
}

/** Things that must be fixed before the solver can run. */
export const setupProblems = ({ days, slots, divisions, subjects, teachers, rooms }: Profile) => {
  const problems: string[] = [];
  if (!days.length) problems.push('Pick at least one working day (Institution).');
  if (!slots.length) problems.push('Working hours produce no time slots (Institution).');
  if (!divisions.length) problems.push('Add at least one division (Structure).');
  if (!subjects.length) problems.push('Add at least one subject (Subjects).');
  for (const subject of subjects) {
    const taughtTo = subjectDivisions(subject, divisions);
    if (subject.divisionIds?.length && !taughtTo.length) {
      problems.push(`${subject.name} is not taught to any existing division (Subjects).`);
    }
    for (const division of taughtTo) {
      const teacher = teachers.find((item) => item.id === teacherFor(subject, division.id));
      if (!teacher) {
        const forWhom = taughtTo.length > 1 && subject.teacherOverrides?.[division.id] ? ` for ${division.name}` : '';
        problems.push(`${subject.name}${forWhom} has no teacher assigned (Subjects).`);
      } else if (subject.isLab && teacher.canTeachLabs === false) {
        problems.push(`${teacher.name} is marked as not handling labs but is assigned ${subject.name} (Teachers).`);
      }
    }
    if (subject.roomId && !rooms.some((item) => item.id === subject.roomId)) {
      problems.push(`${subject.name} uses a room that no longer exists (Subjects).`);
    }
    if (!subject.roomId && !rooms.some((room) => (room.type === 'lab') === subject.isLab)) {
      problems.push(`${subject.name} needs a ${subject.isLab ? 'lab' : 'classroom'}, but none exists (Rooms & Labs).`);
    }
  }
  return [...new Set(problems)];
};

/** Things worth a look that do not stop generation. */
export const setupWarnings = ({ divisions, subjects, rooms }: Profile) => {
  const warnings: string[] = [];
  for (const subject of subjects) {
    const room = rooms.find((item) => item.id === subject.roomId);
    for (const division of subjectDivisions(subject, divisions)) {
      const size = groupSize(division, subject.isLab ? division.batches[0] : null);
      if (room && size && room.capacity && room.capacity < size) {
        warnings.push(`${room.name} seats ${room.capacity} but ${subject.name} for ${division.name} has ${size} students.`);
      } else if (!subject.roomId && size && !rooms.some((item) => roomFits(item, subject.isLab, size))) {
        warnings.push(
          `No ${subject.isLab ? 'lab' : 'classroom'} seats ${size} for ${subject.name} (${division.name}), so it cannot be placed.`,
        );
      }
    }
    if (room && subject.isLab !== (room.type === 'lab')) {
      warnings.push(`${subject.name} is a ${subject.isLab ? 'lab' : 'lecture'} but ${room.name} is a ${room.type}.`);
    }
  }
  return [...new Set(warnings)];
};

export type Grid = Record<string, Record<string, ScheduledSession[]>>;

export const buildGrid = (days: string[], slots: string[], sessions: ScheduledSession[]): Grid => {
  const grid: Grid = {};
  for (const day of days) {
    grid[day] = {};
    for (const slot of slots) grid[day][slot] = [];
  }
  for (const session of sessions) {
    const start = slots.indexOf(session.slot);
    if (!grid[session.day] || start === -1) continue;
    for (let i = 0; i < session.duration_slots && start + i < slots.length; i += 1) {
      grid[session.day][slots[start + i]].push(session);
    }
  }
  return grid;
};

/**
 * Timetable views: "all", "labs", "division:<id>", "batch:<divisionId>:<batch>",
 * "teacher:<id>" or "room:<id>". A batch view shows the whole-division sessions too.
 */
export type ViewKey = string;

export const matchesView = (session: ScheduledSession, view: ViewKey) => {
  if (view === 'all') return true;
  if (view === 'labs') return session.kind === 'lab';
  const [kind, id, batch] = view.split(':');
  if (kind === 'division') return session.division_id === id;
  if (kind === 'batch') return session.division_id === id && (!session.batch || session.batch === batch);
  if (kind === 'teacher') return session.teacher_id === id;
  return session.room_id === id;
};

export const viewTitle = (view: ViewKey, names: Record<string, string>) => {
  if (view === 'all') return 'All classes';
  if (view === 'labs') return 'All labs';
  const [kind, id, batch] = view.split(':');
  const name = names[id] ?? 'Timetable';
  if (kind === 'batch') return `${name} · batch ${batch}`;
  // "Room 101" and "Lab 1" already say what they are; a bare "101" does not.
  if (kind === 'room') return /\b(room|lab|hall|auditorium)\b/i.test(name) ? name : `Room ${name}`;
  return name;
};

/** Every class, batch, teacher and room view, for "export everything". */
export const allViews = (divisions: DivisionForm[], teachers: TeacherForm[], rooms: RoomForm[]) => ({
  classes: divisions.map((item) => `division:${item.id}`),
  batches: divisions.flatMap((item) => item.batches.map((batch) => `batch:${item.id}:${batch}`)),
  teachers: teachers.map((item) => `teacher:${item.id}`),
  rooms: rooms.map((item) => `room:${item.id}`),
});

/**
 * Re-check every hard constraint on the current (possibly hand-edited) schedule.
 * Mirrors the solver rules so manual moves get the same guarantees.
 */
export const findConflicts = (
  sessions: ScheduledSession[],
  {
    days,
    slots,
    teachers,
    rooms = [],
    names,
  }: { days: string[]; slots: string[]; teachers: TeacherForm[]; rooms?: RoomForm[]; names: Record<string, string> },
): Conflict[] => {
  const conflicts: Conflict[] = [];
  const name = (id: string) => names[id] ?? 'Unknown';
  const breaks = breaksAfter(slots);
  const cells = new Map<string, ScheduledSession[]>();
  const add = (key: string, session: ScheduledSession) => {
    const list = cells.get(key) ?? [];
    list.push(session);
    cells.set(key, list);
  };

  for (const session of sessions) {
    const start = slots.indexOf(session.slot);
    const label = `${name(session.subject_id)}${session.batch ? ` (${session.batch})` : ''}`;
    if (!days.includes(session.day) || start === -1) {
      conflicts.push({ message: `${label} is on a day or slot that no longer exists`, sessionIds: [session.id] });
      continue;
    }
    if (start + session.duration_slots > slots.length) {
      conflicts.push({ message: `${label} on ${session.day} runs past the end of the day`, sessionIds: [session.id] });
    }
    for (let i = start; i < start + session.duration_slots - 1; i += 1) {
      if (breaks.has(i)) {
        conflicts.push({ message: `${label} on ${session.day} is split by a break`, sessionIds: [session.id] });
        break;
      }
    }
    const covered = slots.slice(start, start + session.duration_slots);
    const teacher = teachers.find((item) => item.id === session.teacher_id);
    if (teacher && covered.some((slot) => isBlocked(teacher, session.day, slot))) {
      conflicts.push({
        message: `${teacher.name} is unavailable on ${session.day} at ${session.slot} (${label})`,
        sessionIds: [session.id],
      });
    }
    const room = rooms.find((item) => item.id === session.room_id);
    if (room && covered.some((slot) => isBlocked(room, session.day, slot))) {
      conflicts.push({
        message: `Room ${room.name} is closed on ${session.day} at ${session.slot} (${label})`,
        sessionIds: [session.id],
      });
    }
    if (room && session.size && room.capacity && room.capacity < session.size) {
      conflicts.push({
        message: `Room ${room.name} seats ${room.capacity} but ${label} has ${session.size} students`,
        sessionIds: [session.id],
      });
    }
    for (const slot of covered) {
      const where = `${session.day}|${slot}`;
      add(`teacher|${session.teacher_id}|${where}`, session);
      add(`room|${session.room_id}|${where}`, session);
      add(`division|${session.division_id}|${where}`, session);
    }
  }

  for (const [key, list] of cells) {
    const unique = [...new Map(list.map((item) => [item.id, item])).values()];
    if (unique.length < 2) continue;
    const [kind, id, day, slot] = key.split('|');
    const at = `${day} ${slot}`;
    if (kind === 'division') {
      // Different lab batches of one division may run in parallel; anything else clashes.
      const whole = unique.filter((item) => !item.batch);
      const batches = unique.map((item) => item.batch).filter(Boolean);
      if (whole.length > 1 || (whole.length && batches.length) || new Set(batches).size < batches.length) {
        conflicts.push({ message: `${name(id)} has two classes at ${at}`, sessionIds: unique.map((item) => item.id) });
      }
    } else {
      const what = kind === 'teacher' ? `${name(id)} is double-booked` : `Room ${name(id)} is double-booked`;
      conflicts.push({ message: `${what} at ${at}`, sessionIds: unique.map((item) => item.id) });
    }
  }

  for (const teacher of teachers) {
    const mine = sessions.filter((item) => item.teacher_id === teacher.id);
    const weekly = mine.reduce((total, item) => total + item.duration_slots, 0);
    if (weekly > teacher.maxLecturesPerWeek) {
      conflicts.push({
        message: `${teacher.name} teaches ${weekly} slots/week (limit ${teacher.maxLecturesPerWeek})`,
        sessionIds: mine.map((item) => item.id),
      });
    }
    for (const day of days) {
      const today = mine.filter((item) => item.day === day);
      const load = today.reduce((total, item) => total + item.duration_slots, 0);
      if (load > teacher.maxLecturesPerDay) {
        conflicts.push({
          message: `${teacher.name} teaches ${load} slots on ${day} (limit ${teacher.maxLecturesPerDay})`,
          sessionIds: today.map((item) => item.id),
        });
      }
    }
  }

  return conflicts;
};

/** One line of text describing a session from the point of view of the current timetable. */
export const describeSession = (session: ScheduledSession, view: ViewKey, names: Record<string, string>) => {
  const group = `${names[session.division_id] ?? '?'}${session.batch ? ` ${session.batch}` : ''}`;
  const parts = [names[session.subject_id] ?? '?'];
  if (!view.startsWith('division') && !view.startsWith('batch')) parts.push(group);
  else if (session.batch) parts.push(session.batch);
  if (!view.startsWith('teacher')) parts.push(names[session.teacher_id] ?? '?');
  if (!view.startsWith('room')) parts.push(names[session.room_id] ?? '?');
  return parts.join(' · ');
};
