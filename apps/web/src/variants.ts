import type { ScheduledSession } from './types';

/**
 * Timetable variants: the same hard rules, solved with different soft preferences,
 * and the numbers that make them comparable side by side.
 */

export type VariantStyle = 'balanced' | 'compact' | 'spread' | 'teacher_days' | 'late_start';

export const VARIANT_STYLES: { id: VariantStyle; label: string; description: string }[] = [
  { id: 'balanced', label: 'Balanced', description: 'Subjects spread out, days evenly loaded, mornings first.' },
  { id: 'compact', label: 'Compact days', description: 'Classes packed into the morning so days finish early.' },
  { id: 'spread', label: 'Even spread', description: 'The same number of periods every day for classes and teachers.' },
  { id: 'teacher_days', label: 'Fewer teacher days', description: 'Each teacher’s periods grouped onto fewer days.' },
  { id: 'late_start', label: 'Late start', description: 'The first period kept free wherever possible.' },
];

export const styleLabel = (style?: string) => VARIANT_STYLES.find((item) => item.id === style)?.label ?? 'Balanced';

export interface TimetableMetrics {
  /** Teaching periods placed (a two-period lab counts twice). */
  periods: number;
  /** Total days teachers have to come in, summed over teachers. */
  teacherDays: number;
  /** Free periods sandwiched between a teacher's first and last period of a day. */
  teacherGaps: number;
  /** Same for classes: free periods between a class's first and last period. */
  classGaps: number;
  /** Periods placed in the first slot of the day. */
  firstPeriod: number;
  /** Periods placed in the last slot of the day. */
  lastPeriod: number;
  /** Average slot (1-based) at which a class's day ends. */
  averageFinish: number;
  /** Busiest single day for any class, in periods. */
  heaviestClassDay: number;
}

const covered = (session: ScheduledSession, slots: string[]) => {
  const start = slots.indexOf(session.slot);
  return start === -1 ? [] : Array.from({ length: session.duration_slots }, (_, i) => start + i).filter((i) => i < slots.length);
};

const gaps = (indices: number[]) => {
  if (indices.length < 2) return 0;
  const unique = [...new Set(indices)].sort((a, b) => a - b);
  return unique[unique.length - 1] - unique[0] + 1 - unique.length;
};

export const timetableMetrics = (sessions: ScheduledSession[], { days, slots }: { days: string[]; slots: string[] }): TimetableMetrics => {
  const teacherDay = new Map<string, number[]>();
  // A class's day includes its batch sessions (any batch counts as the class being in).
  const classDay = new Map<string, number[]>();
  let periods = 0;
  let firstPeriod = 0;
  let lastPeriod = 0;
  for (const session of sessions) {
    if (!days.includes(session.day)) continue;
    const cells = covered(session, slots);
    periods += cells.length;
    if (cells.includes(0)) firstPeriod += 1;
    if (cells.includes(slots.length - 1)) lastPeriod += 1;
    const tKey = `${session.teacher_id}|${session.day}`;
    teacherDay.set(tKey, [...(teacherDay.get(tKey) ?? []), ...cells]);
    const cKey = `${session.division_id}|${session.day}`;
    classDay.set(cKey, [...(classDay.get(cKey) ?? []), ...cells]);
  }
  const classDays = [...classDay.values()];
  return {
    periods,
    teacherDays: teacherDay.size,
    teacherGaps: [...teacherDay.values()].reduce((sum, cells) => sum + gaps(cells), 0),
    classGaps: classDays.reduce((sum, cells) => sum + gaps(cells), 0),
    firstPeriod,
    lastPeriod,
    averageFinish: classDays.length
      ? Math.round((classDays.reduce((sum, cells) => sum + Math.max(...cells) + 1, 0) / classDays.length) * 10) / 10
      : 0,
    heaviestClassDay: classDays.reduce((max, cells) => Math.max(max, new Set(cells).size), 0),
  };
};

/** For each metric, which version is best (lowest), so the comparison can highlight it. */
export const bestBy = (rows: { id: string; metrics: TimetableMetrics }[]) => {
  const keys: (keyof TimetableMetrics)[] = ['teacherDays', 'teacherGaps', 'classGaps', 'firstPeriod', 'lastPeriod', 'averageFinish', 'heaviestClassDay'];
  const best: Partial<Record<keyof TimetableMetrics, string>> = {};
  for (const key of keys) {
    const values = rows.map((row) => row.metrics[key]);
    const min = Math.min(...values);
    // Only highlight a real winner, not a tie across every version.
    if (values.filter((value) => value === min).length < rows.length) best[key] = rows.find((row) => row.metrics[key] === min)?.id;
  }
  return best;
};
