import type { ScheduledSession } from './types';
import { timetableMetrics, type TimetableMetrics } from './variants';

/**
 * Preference learning. Each timetable is described by a few features (how late days end,
 * how many days teachers come in, gaps, first and last periods, the heaviest day). The
 * model keeps one weight per feature: how much this coordinator dislikes it. Weights are
 * updated from what the coordinator does, with a simple pairwise perceptron:
 *
 *   - choosing or approving version A over B: weights move towards (features(B) - features(A)),
 *     i.e. "whatever B had more of, they dislike";
 *   - dragging a class: moving it earlier raises "finish early", out of the first period
 *     raises "avoid first period", onto a day the teacher already teaches raises "fewer
 *     teacher days".
 *
 * The learned weights become solver weights for a "Your style" timetable. Small, fast,
 * explainable, and it runs on the device; no training data leaves the institution.
 */

export const FEATURES = ['finishEarly', 'teacherDays', 'teacherGaps', 'classGaps', 'avoidFirst', 'avoidLast', 'evenDays'] as const;
export type Feature = (typeof FEATURES)[number];

export interface PreferenceModel {
  weights: Record<Feature, number>;
  /** How many signals it has learned from; below a few, "Your style" is not offered yet. */
  observations: number;
  /** Most recent things it learned from, newest first, in plain words. */
  history: string[];
}

const LEARNING_RATE = 0.35;
const MIN_OBSERVATIONS = 2;

export const emptyModel = (): PreferenceModel => ({
  weights: { finishEarly: 0.2, teacherDays: 0.1, teacherGaps: 0.1, classGaps: 0.15, avoidFirst: 0.05, avoidLast: 0.15, evenDays: 0.25 },
  observations: 0,
  history: [],
});

/** Features scaled to roughly 0-1 so they can be compared across timetables of any size. */
export const featuresOf = (sessions: ScheduledSession[], days: string[], slots: string[]): Record<Feature, number> => {
  const m: TimetableMetrics = timetableMetrics(sessions, { days, slots });
  const teachers = new Set(sessions.map((s) => s.teacher_id)).size || 1;
  const classes = new Set(sessions.map((s) => s.division_id)).size || 1;
  const count = sessions.length || 1;
  const periods = slots.length || 1;
  return {
    finishEarly: m.averageFinish / periods,
    teacherDays: m.teacherDays / teachers / (days.length || 1),
    teacherGaps: Math.min(1, m.teacherGaps / teachers / periods),
    classGaps: Math.min(1, m.classGaps / classes / periods),
    avoidFirst: m.firstPeriod / count,
    avoidLast: m.lastPeriod / count,
    evenDays: m.heaviestClassDay / periods,
  };
};

const normalise = (weights: Record<Feature, number>) => {
  const clipped = Object.fromEntries(FEATURES.map((f) => [f, Math.max(0.01, weights[f])])) as Record<Feature, number>;
  const total = FEATURES.reduce((sum, f) => sum + clipped[f], 0);
  return Object.fromEntries(FEATURES.map((f) => [f, Math.round((clipped[f] / total) * 1000) / 1000])) as Record<Feature, number>;
};

const remember = (model: PreferenceModel, weights: Record<Feature, number>, note: string): PreferenceModel => ({
  weights: normalise(weights),
  observations: model.observations + 1,
  history: [note, ...model.history].slice(0, 12),
});

/** The coordinator preferred `chosen` over each of `others` (picked or approved it). */
export const learnFromChoice = (
  model: PreferenceModel,
  chosen: Record<Feature, number>,
  others: Record<Feature, number>[],
  note = 'You picked a version',
): PreferenceModel => {
  if (!others.length) return model;
  const weights = { ...model.weights };
  for (const other of others) {
    for (const feature of FEATURES) {
      weights[feature] += (LEARNING_RATE * (other[feature] - chosen[feature])) / others.length;
    }
  }
  return remember(model, weights, note);
};

/** The coordinator dragged a session from one place to another. */
export const learnFromMove = (
  model: PreferenceModel,
  move: { fromDay: string; fromSlot: number; toDay: string; toSlot: number; lastSlot: number; teacherAlreadyThere: boolean },
): PreferenceModel => {
  const weights = { ...model.weights };
  const notes: string[] = [];
  if (move.toSlot < move.fromSlot) {
    weights.finishEarly += LEARNING_RATE * 0.3;
    if (move.fromSlot === move.lastSlot) weights.avoidLast += LEARNING_RATE * 0.3;
    notes.push('moved a class earlier');
  }
  if (move.fromSlot === 0 && move.toSlot > 0) {
    weights.avoidFirst += LEARNING_RATE * 0.4;
    notes.push('moved a class out of the first period');
  }
  if (move.fromDay !== move.toDay && move.teacherAlreadyThere) {
    weights.teacherDays += LEARNING_RATE * 0.3;
    notes.push("put a class on a day its teacher already teaches");
  }
  if (!notes.length) return model;
  return remember(model, weights, `You ${notes.join(' and ')}`);
};

export const hasLearned = (model: PreferenceModel) => model.observations >= MIN_OBSERVATIONS;

/** Solver weights (see services/solver STYLES) from the learned preferences. */
export const solverWeights = (model: PreferenceModel) => {
  const w = model.weights;
  return {
    late: Math.round(1 + 8 * w.finishEarly + 4 * w.avoidLast),
    first_period: Math.round(40 * w.avoidFirst),
    teacher_day: Math.round(60 * w.teacherDays),
    division_peak: Math.round(3 + 30 * w.evenDays),
    teacher_peak: Math.round(2 + 16 * w.evenDays),
    repeat: 30,
    difficult_peak: 12,
    preference: 4,
  };
};

const LABELS: Record<Feature, string> = {
  finishEarly: 'days that finish early',
  teacherDays: 'teachers coming in on fewer days',
  teacherGaps: 'few idle periods for teachers',
  classGaps: 'no free periods in the middle of a class’s day',
  avoidFirst: 'a free first period',
  avoidLast: 'nothing in the last period',
  evenDays: 'the same load every day',
};

/** "You seem to prefer days that finish early and the same load every day." */
export const describePreferences = (model: PreferenceModel) => {
  if (!hasLearned(model)) return 'Pick versions and move classes around; TimeFlex will learn what you like.';
  const top = [...FEATURES].sort((a, b) => model.weights[b] - model.weights[a]).slice(0, 2);
  return `You seem to prefer ${LABELS[top[0]]} and ${LABELS[top[1]]}.`;
};
