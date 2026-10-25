import type {
  AttendanceRecord,
  DivisionForm,
  InstitutionForm,
  OperationsData,
  RoomForm,
  ScheduledSession,
  StudentRecord,
  SubjectForm,
  Substitution,
  TeacherForm,
} from './types';
import { createId, isBlocked } from './utils';

/**
 * Day-to-day tools built on the timetable: today's schedule, substitutes,
 * free rooms, attendance and directory helpers. Everything here is pure so it
 * can be tested without the UI.
 */

export const emptyOperations = (): OperationsData => ({ absences: [], substitutions: [], attendance: [] });

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Local date as YYYY-MM-DD. */
export const toDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const weekdayOf = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return WEEKDAYS[new Date(year, month - 1, day).getDay()];
};

export const formatDateKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
};

const minutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/** Index of the slot running at `now`, or -1 outside teaching hours. */
export const currentSlotIndex = (slots: string[], now: Date) => {
  const at = now.getHours() * 60 + now.getMinutes();
  return slots.findIndex((slot) => {
    const [start, end] = slot.split('-');
    return at >= minutes(start) && at < minutes(end);
  });
};

/** Index of the next slot that has not started yet, or -1 after the last one. */
export const nextSlotIndex = (slots: string[], now: Date) => {
  const at = now.getHours() * 60 + now.getMinutes();
  return slots.findIndex((slot) => minutes(slot.split('-')[0]) > at);
};

/** Slots a session occupies. */
export const coveredSlots = (session: ScheduledSession, slots: string[]) => {
  const start = slots.indexOf(session.slot);
  return start === -1 ? [] : slots.slice(start, start + session.duration_slots);
};

export const sessionsOnDay = (sessions: ScheduledSession[], day: string, slots: string[]) =>
  sessions
    .filter((session) => session.day === day && slots.includes(session.slot))
    .sort((a, b) => slots.indexOf(a.slot) - slots.indexOf(b.slot) || a.division_id.localeCompare(b.division_id));

/** The teacher actually taking a session on a date, after substitutions. Empty = period left free. */
export const effectiveTeacher = (session: ScheduledSession, date: string, substitutions: Substitution[]) => {
  const sub = substitutions.find((item) => item.date === date && item.sessionId === session.id);
  return sub ? sub.substituteTeacherId : session.teacher_id;
};

export const absentTeacherIds = (ops: OperationsData, date: string) =>
  new Set(ops.absences.filter((item) => item.date === date).map((item) => item.teacherId));

/** Date keys from `from` to `to` inclusive, limited to working days. At most 60 days. */
export const workingDatesBetween = (from: string, to: string, days: string[]) => {
  const result: string[] = [];
  const [y, m, d] = from.split('-').map(Number);
  const cursor = new Date(y, m - 1, d);
  for (let i = 0; i < 60; i += 1) {
    const key = toDateKey(cursor);
    if (key > to) break;
    if (!days.length || days.includes(weekdayOf(key))) result.push(key);
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
};

/** Mark a teacher absent on every working day from `from` to `to` (leave), with an optional reason. */
export const setLeave = (
  ops: OperationsData,
  { teacherId, from, to, days, reason }: { teacherId: string; from: string; to: string; days: string[]; reason?: string },
): OperationsData => {
  const dates = new Set(workingDatesBetween(from, to < from ? from : to, days));
  const others = ops.absences.filter((item) => !(item.teacherId === teacherId && dates.has(item.date)));
  return {
    ...ops,
    absences: [
      ...others,
      ...[...dates].map((date) => ({ id: createId(), date, teacherId, ...(reason?.trim() ? { reason: reason.trim() } : {}) })),
    ],
  };
};

/** How many periods each teacher has covered in the 30 days up to `date`. */
export const recentCoverCounts = (ops: OperationsData, date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const since = toDateKey(new Date(y, m - 1, d - 30));
  const counts = new Map<string, number>();
  for (const item of ops.substitutions) {
    if (!item.substituteTeacherId || item.date < since || item.date > date) continue;
    counts.set(item.substituteTeacherId, (counts.get(item.substituteTeacherId) ?? 0) + 1);
  }
  return counts;
};

export interface SubstituteCandidate {
  teacher: TeacherForm;
  score: number;
  reasons: string[];
  loadToday: number;
}

/**
 * Teachers who could cover `session` on `date`: present, not unavailable, free in
 * every slot it covers (counting substitutions already given out), and under their
 * daily limit. Best first: knows the subject, knows the class, lightest day.
 */
export const substituteCandidates = ({
  session,
  date,
  slots,
  sessions,
  teachers,
  subjects,
  ops,
}: {
  session: ScheduledSession;
  date: string;
  slots: string[];
  sessions: ScheduledSession[];
  teachers: TeacherForm[];
  subjects: SubjectForm[];
  ops: OperationsData;
}): SubstituteCandidate[] => {
  const day = weekdayOf(date);
  const absent = absentTeacherIds(ops, date);
  const today = sessionsOnDay(sessions, day, slots);
  const need = new Set(coveredSlots(session, slots));
  const subject = subjects.find((item) => item.id === session.subject_id);
  const covered = recentCoverCounts(ops, date);

  const candidates: SubstituteCandidate[] = [];
  for (const teacher of teachers) {
    if (teacher.id === session.teacher_id || absent.has(teacher.id)) continue;
    if ([...need].some((slot) => isBlocked(teacher, day, slot))) continue;
    if (session.kind === 'lab' && teacher.canTeachLabs === false) continue;
    const mine = today.filter((item) => item.id !== session.id && effectiveTeacher(item, date, ops.substitutions) === teacher.id);
    if (mine.some((item) => coveredSlots(item, slots).some((slot) => need.has(slot)))) continue;
    const loadToday = mine.reduce((total, item) => total + item.duration_slots, 0);
    if (loadToday + session.duration_slots > teacher.maxLecturesPerDay) continue;

    const reasons: string[] = [];
    let score = 0;
    const teachesSubject =
      subject && (subject.teacherId === teacher.id || Object.values(subject.teacherOverrides ?? {}).includes(teacher.id));
    if (teachesSubject) {
      score += 3;
      reasons.push(`teaches ${subject!.name}`);
    }
    if (sessions.some((item) => item.teacher_id === teacher.id && item.division_id === session.division_id)) {
      score += 2;
      reasons.push('knows this class');
    }
    score += Math.max(0, teacher.maxLecturesPerDay - loadToday) / 10;
    reasons.push(loadToday ? `${loadToday} period(s) today` : 'free all day');
    // Share the extra work: each cover in the last 30 days counts against a teacher.
    const recent = covered.get(teacher.id) ?? 0;
    if (recent) {
      score -= recent * 0.6;
      reasons.push(`covered ${recent} recently`);
    }
    candidates.push({ teacher, score, reasons, loadToday });
  }
  return candidates.sort((a, b) => b.score - a.score || a.teacher.name.localeCompare(b.teacher.name));
};

/** Set (or clear, with null) the substitute for one session on one date. */
export const assignSubstitute = (
  ops: OperationsData,
  { date, session, substituteTeacherId }: { date: string; session: ScheduledSession; substituteTeacherId: string | null },
): OperationsData => {
  const rest = ops.substitutions.filter((item) => !(item.date === date && item.sessionId === session.id));
  if (substituteTeacherId === null) return { ...ops, substitutions: rest };
  return {
    ...ops,
    substitutions: [
      ...rest,
      { id: createId(), date, sessionId: session.id, absentTeacherId: session.teacher_id, substituteTeacherId },
    ],
  };
};

/** Periods on `date` whose teacher is absent and that have no substitute (or free-period decision) yet. */
export const uncoveredPeriods = (ops: OperationsData, date: string, sessions: ScheduledSession[], slots: string[]) => {
  const absent = absentTeacherIds(ops, date);
  return sessionsOnDay(sessions, weekdayOf(date), slots).filter(
    (session) =>
      absent.has(session.teacher_id) && !ops.substitutions.some((item) => item.date === date && item.sessionId === session.id),
  );
};

/**
 * Give every uncovered period on `date` its best available substitute, earliest period
 * first. Each pick is counted before the next, so nobody is double-booked or pushed
 * past their daily limit. Periods nobody can take are left for a person to decide.
 */
export const autoAssignSubstitutes = (
  ops: OperationsData,
  context: { date: string; slots: string[]; sessions: ScheduledSession[]; teachers: TeacherForm[]; subjects: SubjectForm[] },
): { operations: OperationsData; assigned: number; unfilled: ScheduledSession[] } => {
  let next = ops;
  let assigned = 0;
  const unfilled: ScheduledSession[] = [];
  for (const session of uncoveredPeriods(ops, context.date, context.sessions, context.slots)) {
    const [best] = substituteCandidates({ ...context, session, ops: next });
    if (!best) {
      unfilled.push(session);
      continue;
    }
    next = assignSubstitute(next, { date: context.date, session, substituteTeacherId: best.teacher.id });
    assigned += 1;
  }
  return { operations: next, assigned, unfilled };
};

/** Mark a teacher absent or present on a date. Marking present also drops their substitutions. */
export const setAbsent = (ops: OperationsData, date: string, teacherId: string, absent: boolean): OperationsData => {
  const others = ops.absences.filter((item) => !(item.date === date && item.teacherId === teacherId));
  if (absent) return { ...ops, absences: [...others, { id: createId(), date, teacherId }] };
  return {
    ...ops,
    absences: others,
    substitutions: ops.substitutions.filter((item) => !(item.date === date && item.absentTeacherId === teacherId)),
  };
};

/** Rooms that are open and not used by any session at this day and slot. */
export const freeRooms = (rooms: RoomForm[], sessions: ScheduledSession[], day: string, slot: string, slots: string[]) => {
  const used = new Set(
    sessions.filter((item) => item.day === day && coveredSlots(item, slots).includes(slot)).map((item) => item.room_id),
  );
  return rooms.filter((room) => !used.has(room.id) && !isBlocked(room, day, slot));
};

/** Share of a room's open periods that the timetable uses, 0-1. */
export const roomUtilization = (room: RoomForm, sessions: ScheduledSession[], days: string[], slots: string[]) => {
  let open = 0;
  let used = 0;
  const busy = new Set<string>();
  for (const session of sessions) {
    if (session.room_id !== room.id) continue;
    for (const slot of coveredSlots(session, slots)) busy.add(`${session.day}|${slot}`);
  }
  for (const day of days) {
    for (const slot of slots) {
      if (isBlocked(room, day, slot)) continue;
      open += 1;
      if (busy.has(`${day}|${slot}`)) used += 1;
    }
  }
  return open ? used / open : 0;
};

/* ---------- Students and attendance ---------- */

/** Students who sit a session: the whole class, or one lab batch. */
export const studentsFor = (division: DivisionForm | undefined, batch?: string | null) => {
  const all = division?.students ?? [];
  return batch ? all.filter((student) => student.batch === batch) : all;
};

export const findAttendance = (records: AttendanceRecord[], date: string, sessionId: string) =>
  records.find((item) => item.date === date && item.sessionId === sessionId);

export const saveAttendance = (
  ops: OperationsData,
  { date, session, absentStudentIds }: { date: string; session: ScheduledSession; absentStudentIds: string[] },
): OperationsData => {
  const rest = ops.attendance.filter((item) => !(item.date === date && item.sessionId === session.id));
  return {
    ...ops,
    attendance: [
      ...rest,
      {
        id: createId(),
        date,
        sessionId: session.id,
        subjectId: session.subject_id,
        divisionId: session.division_id,
        batch: session.batch ?? null,
        slot: session.slot,
        absentStudentIds,
        takenAt: new Date().toISOString(),
      },
    ],
  };
};

export interface StudentAttendance {
  student: StudentRecord;
  attended: number;
  total: number;
  /** 0-100, or null when no attendance has been taken yet. */
  percent: number | null;
}

/** Attendance per student of a division, over every record taken for it (optionally one subject). */
export const attendanceSummary = (division: DivisionForm, records: AttendanceRecord[], subjectId?: string) => {
  const mine = records.filter((item) => item.divisionId === division.id && (!subjectId || item.subjectId === subjectId));
  return (division.students ?? []).map<StudentAttendance>((student) => {
    const sittings = mine.filter((item) => !item.batch || item.batch === student.batch);
    const attended = sittings.filter((item) => !item.absentStudentIds.includes(student.id)).length;
    return {
      student,
      attended,
      total: sittings.length,
      percent: sittings.length ? Math.round((attended / sittings.length) * 100) : null,
    };
  });
};

/**
 * Read a pasted class list. Accepts "roll, name", "roll<TAB>name", "roll name" or just
 * "name" per line, with an optional header row. Rolls are generated when missing.
 */
export const parseRoster = (text: string): Omit<StudentRecord, 'id'>[] => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length && /^(roll|sr|no|name|student)\b/i.test(lines[0]) && !/\d/.test(lines[0])) lines.shift();
  return lines.map((line, index) => {
    const parts = line.includes('\t') ? line.split('\t') : line.includes(',') ? line.split(',') : null;
    const cells = (parts ?? []).map((cell) => cell.trim()).filter(Boolean);
    if (cells.length >= 2) {
      const [first, second, ...rest] = cells;
      const firstIsRoll = /\d/.test(first) && !/\d/.test(second);
      const email = rest.find((cell) => cell.includes('@'));
      const phone = rest.find((cell) => /^\+?[\d\s-]{7,}$/.test(cell));
      return {
        rollNo: firstIsRoll ? first : String(index + 1),
        name: firstIsRoll ? second : first,
        ...(email && { email }),
        ...(phone && { phone }),
      };
    }
    const match = line.match(/^([A-Za-z]*\d[\w/-]*?)[.)]?\s+(.+)$/);
    return match ? { rollNo: match[1], name: match[2].trim() } : { rollNo: String(index + 1), name: line };
  });
};

/** Split students over the lab batches in roll order: first block to the first batch, and so on. */
export const splitIntoBatches = (students: StudentRecord[], batches: string[]): StudentRecord[] => {
  if (!batches.length) return students.map(({ batch, ...rest }) => rest);
  const per = Math.ceil(students.length / batches.length);
  return students.map((student, index) => ({ ...student, batch: batches[Math.min(batches.length - 1, Math.floor(index / per))] }));
};

/* ---------- Sharing ---------- */

/** A teacher's or class's week as plain text, for WhatsApp or e-mail. */
export const weekAsText = ({
  title,
  sessions,
  days,
  slots,
  names,
  perspective,
}: {
  title: string;
  sessions: ScheduledSession[];
  days: string[];
  slots: string[];
  names: Record<string, string>;
  perspective: 'teacher' | 'class';
}) => {
  const lines = [`${title}: weekly timetable`];
  for (const day of days) {
    const today = sessionsOnDay(sessions, day, slots);
    if (!today.length) continue;
    lines.push('', day);
    for (const session of today) {
      const group = `${names[session.division_id] ?? ''}${session.batch ? ` ${session.batch}` : ''}`;
      const who = perspective === 'teacher' ? group : names[session.teacher_id] ?? '';
      const end = coveredSlots(session, slots).at(-1)?.split('-')[1] ?? '';
      lines.push(`  ${session.slot.split('-')[0]}-${end}  ${names[session.subject_id] ?? ''} · ${who} · ${names[session.room_id] ?? ''}`);
    }
  }
  return lines.join('\n');
};

/** wa.me wants digits only, with country code. Ten-digit numbers are assumed Indian (+91). */
export const whatsappLink = (phone: string, text: string) => {
  const digits = phone.replace(/\D/g, '');
  const full = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
};

/* ---------- Profile strength ---------- */

export interface ProfileItem {
  id: string;
  label: string;
  done: number;
  total: number;
  /** What the extra data unlocks, phrased as a timetable benefit. */
  unlocks: string;
  step: string;
}

export const profileItems = ({
  institution,
  divisions,
  teachers,
  rooms,
  subjects,
}: {
  institution: InstitutionForm;
  divisions: DivisionForm[];
  teachers: TeacherForm[];
  rooms: RoomForm[];
  subjects: SubjectForm[];
}): ProfileItem[] => [
  {
    id: 'basics',
    label: 'Institution details',
    done: [institution.name, institution.academicYear, institution.address].filter(Boolean).length,
    total: 3,
    unlocks: 'Your name and academic year printed on every exported timetable',
    step: 'basics',
  },
  {
    id: 'rosters',
    label: 'Class lists',
    done: divisions.filter((item) => item.students?.length).length,
    total: divisions.length,
    unlocks: 'Automatic lab batches and one-tap attendance',
    step: 'classes',
  },
  {
    id: 'mentors',
    label: 'Class teachers',
    done: divisions.filter((item) => item.classTeacherId).length,
    total: divisions.length,
    unlocks: 'Each class teacher gets their class timetable and attendance report',
    step: 'classes',
  },
  {
    id: 'contacts',
    label: 'Teacher contacts',
    done: teachers.filter((item) => item.email || item.phone).length,
    total: teachers.length,
    unlocks: 'Send every teacher their own timetable and substitution alerts',
    step: 'people',
  },
  {
    id: 'codes',
    label: 'Subject codes',
    done: subjects.filter((item) => item.code).length,
    total: subjects.length,
    unlocks: 'Official course codes on timetables and attendance sheets',
    step: 'subjects',
  },
  {
    id: 'buildings',
    label: 'Room locations',
    done: rooms.filter((item) => item.building).length,
    total: rooms.length,
    unlocks: 'Students and visitors can find where each class is',
    step: 'rooms',
  },
];

/** 0-100 across all items, each weighted equally. Items with nothing to fill count as done. */
export const profileStrength = (items: ProfileItem[]) =>
  Math.round((items.reduce((sum, item) => sum + (item.total ? item.done / item.total : 1), 0) / items.length) * 100);
