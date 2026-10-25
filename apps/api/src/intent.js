import { aiConfig, completeJson } from './llm.js';

/**
 * Fallback for assistant requests the rules in packages/core/src/command.ts did not catch.
 * The small local model only classifies the request into this fixed shape; it never edits
 * anything. The app turns the result into actions (checking every name against the real
 * profile) and shows them for approval.
 */

export const INTENTS = [
  'absent',
  'leave',
  'day_off',
  'limit_day',
  'limit_week',
  'add_teacher',
  'add_room',
  'add_class',
  'assign',
  'add_subject',
  'generate',
  'variations',
  'hours',
  'unknown',
];

const schema = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: INTENTS },
    teacher: { type: ['string', 'null'] },
    subject: { type: ['string', 'null'] },
    class_name: { type: ['string', 'null'] },
    room_name: { type: ['string', 'null'] },
    date_from: { type: ['string', 'null'] },
    date_to: { type: ['string', 'null'] },
    day: { type: ['string', 'null'] },
    number: { type: ['integer', 'null'] },
    expertise: { type: 'array', items: { type: 'string' } },
    style: { type: ['string', 'null'], enum: ['balanced', 'compact', 'spread', 'teacher_days', 'late_start', null] },
  },
  required: ['intent'],
};

const system = `You read one instruction from a college timetable coordinator and classify it.
Return JSON only. Copy names exactly as written. Dates: use "today", "tomorrow", a weekday, or YYYY-MM-DD.
Intents:
- absent: a teacher is away on one day. leave: away from date_from to date_to.
- day_off: a teacher never teaches on a weekday (day).
- limit_day / limit_week: a teacher's maximum periods per day / per week (number).
- add_teacher (teacher, expertise), add_room (room_name, number = seats), add_class (class_name, number = students).
- assign: teacher teaches an existing subject (optionally class_name). add_subject: teacher teaches a new subject, number = times per week.
- generate: build a timetable (style). variations: build several versions (number).
- hours: change the teaching day. unknown: anything else.`;

export const interpretCommand = async (text, context = {}) => {
  const started = Date.now();
  if (aiConfig().provider === 'off') return { intent: { intent: 'unknown' }, source: 'off', elapsedMs: 0 };
  const known = [
    context.teachers?.length ? `Teachers: ${context.teachers.slice(0, 40).join('; ')}` : '',
    context.subjects?.length ? `Subjects: ${context.subjects.slice(0, 40).join('; ')}` : '',
    context.classes?.length ? `Classes: ${context.classes.slice(0, 20).join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  try {
    const intent = await completeJson({ system, user: `${known}\n\nInstruction: ${String(text).slice(0, 500)}`, schema });
    return {
      intent: INTENTS.includes(intent?.intent) ? intent : { intent: 'unknown' },
      source: 'llm',
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    return { intent: { intent: 'unknown' }, source: 'off', error: error.message, elapsedMs: Date.now() - started };
  }
};
