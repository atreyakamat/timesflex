import { coveredSlots, currentSlotIndex, toDateKey, weekdayOf } from './ops';
import type { DivisionForm, ScheduledSession } from './types';

/**
 * Students as a whole: finding them across classes, and what teachers have marked about them:
 * late arrivals with remarks, and flags such as being seen outside or bunking.
 */

export type EventKind = 'late' | 'outside' | 'bunked' | 'other';

export const EVENT_KINDS: { id: EventKind; label: string; icon: string; flag: boolean }[] = [
  { id: 'late', label: 'Late', icon: 'time-outline', flag: false },
  { id: 'outside', label: 'Seen outside', icon: 'walk-outline', flag: true },
  { id: 'bunked', label: 'Bunked', icon: 'alert-circle-outline', flag: true },
  { id: 'other', label: 'Remark', icon: 'chatbox-ellipses-outline', flag: false },
];
const isFlag = (kind: EventKind) => kind === 'outside' || kind === 'bunked';

export interface StudentEvent {
  id: string;
  studentId: string;
  studentName: string;
  rollNo: string;
  divisionId: string;
  divisionName: string;
  kind: EventKind;
  date: string;
  time?: string;
  slot?: string;
  minutesLate?: number;
  note: string;
  /** Flags start open until reviewed. Wrong marks become void, and are never erased. */
  status: 'open' | 'reviewed' | 'void';
  recordedBy: string;
  recordedByName: string;
  createdAt: string;
  outcome?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  voidedByName?: string;
  voidReason?: string;
}

export interface StudentRef {
  id: string;
  name: string;
  rollNo: string;
  batch?: string;
  divisionId: string;
  divisionName: string;
}

export const allStudents = (profile: { divisions: DivisionForm[] }): StudentRef[] =>
  profile.divisions.flatMap((division) =>
    (division.students ?? []).map((student) => ({
      id: student.id,
      name: student.name,
      rollNo: student.rollNo,
      ...(student.batch ? { batch: student.batch } : {}),
      divisionId: division.id,
      divisionName: division.name,
    })),
  );

export const findStudent = (profile: { divisions: DivisionForm[] }, id: string) => allStudents(profile).find((student) => student.id === id) ?? null;

/** Names or roll numbers, across every class. */
export const searchStudents = (profile: { divisions: DivisionForm[] }, query: string, limit = 30) => {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return allStudents(profile)
    .filter((student) => student.name.toLowerCase().includes(q) || student.rollNo.toLowerCase().includes(q))
    .slice(0, limit);
};

export const describeEvent = (event: Pick<StudentEvent, 'kind' | 'minutesLate' | 'note'>) => {
  switch (event.kind) {
    case 'late':
      return event.minutesLate ? `Late by ${event.minutesLate} minute${event.minutesLate === 1 ? '' : 's'}` : 'Late';
    case 'outside':
      return 'Seen outside during class';
    case 'bunked':
      return 'Bunked a class';
    default:
      return event.note || 'Remark';
  }
};

const live = (events: StudentEvent[]) => events.filter((event) => event.status !== 'void');

export const eventStats = (events: StudentEvent[], today: string) => {
  const counted = live(events);
  return {
    lateToday: counted.filter((e) => e.kind === 'late' && e.date === today).length,
    flagsToday: counted.filter((e) => isFlag(e.kind) && e.date === today).length,
    openFlags: counted.filter((e) => isFlag(e.kind) && e.status === 'open').length,
  };
};

export const studentHistory = (events: StudentEvent[], studentId: string) => {
  const mine = live(events)
    .filter((e) => e.studentId === studentId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const counts = { late: 0, outside: 0, bunked: 0, other: 0 };
  for (const event of mine) counts[event.kind] += 1;
  return { events: mine, counts };
};

const LATE_LIMIT = 3;
const FLAG_LIMIT = 2;
const WINDOW_DAYS = 30;

/** Students with a repeat pattern in the last 30 days: most serious first. */
export const needsAttention = (events: StudentEvent[], today: string) => {
  const [y, m, d] = today.split('-').map(Number);
  const since = toDateKey(new Date(y, m - 1, d - WINDOW_DAYS));
  const byStudent = new Map<string, StudentEvent[]>();
  for (const event of live(events)) {
    if (event.date >= since) byStudent.set(event.studentId, [...(byStudent.get(event.studentId) ?? []), event]);
  }
  return [...byStudent.entries()]
    .map(([studentId, list]) => {
      const lates = list.filter((e) => e.kind === 'late').length;
      const flags = list.filter((e) => isFlag(e.kind)).length;
      const { studentName, rollNo, divisionName } = list[0];
      return { studentId, studentName, rollNo, divisionName, lates, flags, reason: flags >= FLAG_LIMIT ? `${flags} flags in ${WINDOW_DAYS} days` : `${lates} lates in ${WINDOW_DAYS} days` };
    })
    .filter((row) => row.flags >= FLAG_LIMIT || row.lates >= LATE_LIMIT)
    .sort((a, b) => b.flags - a.flags || b.lates - a.lates);
};

/** The class this student should be in at this moment, if any. */
export const classNow = (student: Pick<StudentRef, 'divisionId' | 'batch'>, sessions: ScheduledSession[], slots: string[], now = new Date()) => {
  const index = currentSlotIndex(slots, now);
  if (index < 0) return null;
  const day = weekdayOf(toDateKey(now));
  return (
    sessions.find(
      (s) => s.day === day && s.division_id === student.divisionId && (!s.batch || s.batch === student.batch) && coveredSlots(s, slots).includes(slots[index]),
    ) ?? null
  );
};

/** A leading = + - @ makes a spreadsheet treat a cell as a formula, so remarks are neutralised. */
const cell = (value: string | number | undefined) => {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const eventsAsCsv = (events: StudentEvent[]) =>
  [
    'Date,Time,Roll no,Student,Class,Mark,Remark,Recorded by,Status',
    ...events.map((e) => [e.date, e.time, e.rollNo, e.studentName, e.divisionName, describeEvent(e), e.note, e.recordedByName, e.status].map(cell).join(',')),
  ].join('\n');
