import type { AgentAction } from './agent';
import { toDateKey } from './ops';
import type { ProfileData } from './samples';
import type { TeacherForm } from './types';
import type { VariantStyle } from './variants';

/**
 * Understands short instructions typed to the assistant, offline and instantly:
 * "Mehta is on leave tomorrow", "Rao can't teach on Fridays", "max 3 a day for Iyer",
 * "add teacher Dr. Neha Kamat, expert in Machine Learning", "make 3 variations".
 * Anything it cannot read is handed to the local model by the API.
 */

export interface CommandResult {
  actions: AgentAction[];
  /** What the assistant says back, in plain words. */
  reply: string;
  understood: boolean;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_RE = /\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?\b/gi;
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, once: 1, twice: 2,
};
const AWAY = /\b(absent|away|on leave|leave|sick|unwell|ill|off|not coming|not in|won'?t be in|can'?t come|unavailable|out|conference|seminar|attending|workshop|training|travell?ing|appointment|medical|holiday|vacation)\b/i;

const dayName = (token: string) => WEEKDAYS.find((day) => day.toLowerCase().startsWith(token.toLowerCase().slice(0, 3))) ?? null;
const numberIn = (text: string) => {
  const digit = /\b(\d{1,3})\b/.exec(text);
  if (digit) return Number(digit[1]);
  const word = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'i').exec(text);
  return word ? NUMBER_WORDS[word[1].toLowerCase()] : null;
};
/** A limit's number, so "three lectures in one day" means three, not one. */
const limitIn = (text: string) => numberIn(text.replace(/\b(?:in |per )?(?:one|a|each|every) (?:day|week)\b/gi, ' '));
const stripTitle = (name: string) => name.replace(/^(prof|dr|mr|mrs|ms)\.?\s+/i, '').toLowerCase();

/** The teacher named in the text: full name first, then any distinctive word of their name. */
export const findTeacher = (text: string, teachers: TeacherForm[]) => {
  const lower = text.toLowerCase();
  const full = teachers.find((t) => lower.includes(stripTitle(t.name)));
  if (full) return full;
  const matches = teachers.filter((t) =>
    stripTitle(t.name)
      .split(/\s+/)
      .some((part) => part.length > 2 && new RegExp(`\\b${part.replace(/[^\w]/g, '')}\\b`, 'i').test(text)),
  );
  return matches.length === 1 ? matches[0] : null;
};

const findByName = <T extends { name: string }>(text: string, items: T[]) => {
  const lower = text.toLowerCase();
  return [...items].sort((a, b) => b.name.length - a.name.length).find((item) => lower.includes(item.name.toLowerCase())) ?? null;
};

/** today / tomorrow / a weekday (the next one) / YYYY-MM-DD, as a date key. */
export const dateIn = (text: string, today: Date): string | null => {
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
  if (iso) return iso[1];
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (/\btoday\b/i.test(text)) return toDateKey(base);
  if (/\btomorrow\b/i.test(text)) return toDateKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1));
  const match = new RegExp(DAY_RE.source, 'i').exec(text);
  const day = match ? dayName(match[1]) : null;
  if (!day) return null;
  // A weekday means its next occurrence, and today when it names today.
  const ahead = (WEEKDAYS.indexOf(day) - base.getDay() + 7) % 7;
  return toDateKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() + ahead));
};

/** "next week", "early next week", "this week" as Monday-to-Friday dates. */
const weekSpanIn = (text: string, today: Date): { from: string; to: string } | null => {
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const at = (offset: number) => toDateKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset));
  const toMonday = (8 - base.getDay()) % 7 || 7;
  if (/\bnext week\b/i.test(text)) {
    return /\b(early|start of|beginning of)\b/i.test(text) ? { from: at(toMonday), to: at(toMonday + 1) } : { from: at(toMonday), to: at(toMonday + 4) };
  }
  if (/\bthis week\b/i.test(text) && base.getDay() >= 1 && base.getDay() <= 5) return { from: at(0), to: at(5 - base.getDay()) };
  return null;
};

const STYLE_WORDS: [RegExp, VariantStyle][] = [
  [/compact|finish(es)? early|short(er)? days?|ends? early/i, 'compact'],
  [/even|spread|balanced load/i, 'spread'],
  [/fewer (teacher )?days|teacher days|days off/i, 'teacher_days'],
  [/late start|first period free|start late/i, 'late_start'],
  [/balanced|normal|default/i, 'balanced'],
];
const styleIn = (text: string): VariantStyle => STYLE_WORDS.find(([re]) => re.test(text))?.[1] ?? 'balanced';

export const parseCommand = (input: string, profile: ProfileData, today = new Date()): CommandResult => {
  // Phones type curly apostrophes, and the patterns below expect straight ones.
  const text = input.trim().replace(/[\u2018\u2019]/g, "'");
  const teacher = findTeacher(text, profile.teachers);
  const nothing = (reply: string): CommandResult => ({ actions: [], reply, understood: false });

  // Variations and generating.
  if (/\b(variation|variant|option|version)s?\b/i.test(text) && /\b(make|build|create|generate|give|show|try)\b/i.test(text)) {
    const count = Math.min(5, Math.max(2, numberIn(text) ?? 3));
    const styles: VariantStyle[] = (['balanced', 'compact', 'teacher_days', 'spread', 'late_start'] as VariantStyle[]).slice(0, count);
    return { actions: [{ type: 'generateVariants', styles }], reply: `I'll build ${count} different versions so you can compare them.`, understood: true };
  }
  if (/\b(generate|build|make|create|redo|regenerate)\b.*\b(timetable|schedule|week)\b/i.test(text)) {
    const style = styleIn(text);
    return { actions: [{ type: 'generate', style }], reply: `I'll build a ${style.replace('_', ' ')} timetable.`, understood: true };
  }

  // Absence and leave.
  if (teacher && AWAY.test(text) && /\b(today|tomorrow|\d{4}-\d{2}-\d{2}|from|this|next|on|week)\b/i.test(text)) {
    const span = weekSpanIn(text, today);
    if (span) {
      const reason = /\b(conference|sick|medical|exam duty|training|workshop|personal)\b/i.exec(text)?.[1];
      return {
        actions: [{ type: 'leave', teacherId: teacher.id, ...span, ...(reason ? { reason } : {}) }],
        reply: `I'll mark ${teacher.name} on leave from ${span.from} to ${span.to}. You can arrange cover in Substitutions.`,
        understood: true,
      };
    }
    const range = /\bfrom\b(.+?)\b(to|until|till)\b(.+)$/i.exec(text);
    if (range) {
      const from = dateIn(range[1], today);
      const to = dateIn(range[3], today);
      if (from && to) {
        const reason = /\b(conference|sick|medical|exam duty|training|workshop|personal)\b/i.exec(text)?.[1];
        return {
          actions: [{ type: 'leave', teacherId: teacher.id, from, to: to < from ? from : to, ...(reason ? { reason } : {}) }],
          reply: `I'll mark ${teacher.name} on leave and you can arrange cover in Substitutions.`,
          understood: true,
        };
      }
    }
    const date = dateIn(text, today);
    if (date && !/\bevery\b|\bs\b/i.test(text)) {
      return {
        actions: [{ type: 'markAbsent', teacherId: teacher.id, date }],
        reply: `I'll mark ${teacher.name} absent on ${date}. Then use Auto-assign in Substitutions to cover their classes.`,
        understood: true,
      };
    }
  }

  // Standing days off: "Rao can't teach on Fridays", "Iyer is not available on Mondays".
  if (teacher && /\b(can'?t|cannot|doesn'?t|does not|don'?t|won'?t|not available|unavailable|never|off|free|shouldn'?t)\b/i.test(text)) {
    const days = [...text.matchAll(new RegExp(DAY_RE.source, 'gi'))].map((m) => dayName(m[1])).filter(Boolean) as string[];
    if (days.length) {
      return {
        actions: days.map((day) => ({ type: 'teacherDayOff', teacherId: teacher.id, day })),
        reply: `${teacher.name} will not be given classes on ${days.join(' or ')}.`,
        understood: true,
      };
    }
  }

  // Limits: "max 3 a day for Iyer", "Rao can teach 16 periods a week".
  if (teacher && /\b(max|maximum|at most|up to|limit|only|can teach|more than)\b/i.test(text)) {
    const n = limitIn(text.replace(new RegExp(stripTitle(teacher.name), 'i'), ''));
    if (n) {
      const perWeek = /\bweek/i.test(text);
      return {
        actions: [{ type: 'updateTeacher', teacherId: teacher.id, changes: perWeek ? { maxLecturesPerWeek: n } : { maxLecturesPerDay: n } }],
        reply: `${teacher.name} will teach at most ${n} periods a ${perWeek ? 'week' : 'day'}.`,
        understood: true,
      };
    }
  }

  // Adding things.
  const addTeacher = /\badd (?:a )?(?:new )?(?:teacher|professor|faculty|lecturer)\s+(?:named\s+|called\s+)?(.+?)(?:,|\s+(?:who|expert|specialis|teaches|for)\b|$)/i.exec(text);
  if (addTeacher) {
    const name = addTeacher[1].trim();
    const expertise = /\b(?:expert in|specialis(?:es|ed|t) in|teaches|knows)\s+(.+)$/i.exec(text)?.[1]
      .split(/,|\band\b/)
      .map((item) => item.trim().replace(/\.$/, ''))
      .filter(Boolean);
    return {
      actions: [{ type: 'addTeacher', name, ...(expertise?.length ? { expertise } : {}) }],
      reply: `I'll add ${name}${expertise?.length ? `, with expertise in ${expertise.join(', ')}` : ''}. Open their profile to set limits and contacts.`,
      understood: true,
    };
  }
  // "We hired Dr. Nair who does physics", "a new teacher called Asha Rao joined".
  if (/\b(hired|hiring|joined|joining|new (?:teacher|professor|faculty|lecturer|person|colleague))\b/i.test(text)) {
    const called = /\b(?:called|named)\s+((?:(?:Prof|Dr|Mr|Mrs|Ms)\.?\s+)?[A-Z][\w'-]*(?:\s+[A-Z][\w'-]*)*)/.exec(text) ?? /\b((?:Prof|Dr|Mr|Mrs|Ms)\.?\s+[A-Z][\w'-]*(?:\s+[A-Z][\w'-]*)*)/.exec(text);
    if (called) {
      const name = called[1].trim();
      const expertise = /\b(?:who (?:does|teaches|knows)|to teach|expert in|teaches)\s+(.+)$/i.exec(text)?.[1]
        .split(/,|\band\b/)
        .map((item) => item.trim().replace(/\.$/, ''))
        .filter(Boolean);
      return {
        actions: [{ type: 'addTeacher', name, ...(expertise?.length ? { expertise } : {}) }],
        reply: `I'll add ${name}${expertise?.length ? `, who can teach ${expertise.join(', ')}` : ''}.`,
        understood: true,
      };
    }
  }
  // "We got a new computer lab with forty seats".
  const newRoom = /\b(?:new|another|(?:now )?have an?|got an?)\s+(?:new\s+)?((?:[a-z-]+\s+)??(lab|classroom|room|hall))\b/i.exec(text);
  if (newRoom) {
    const kind = newRoom[2].toLowerCase();
    const roomType = kind === 'lab' ? 'lab' : kind === 'hall' ? 'seminar-hall' : 'classroom';
    const words = newRoom[1].trim().split(/\s+/).map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(' ');
    const name = words.includes(' ') ? words : `New ${words}`;
    const capacity = numberIn(text) ?? (roomType === 'lab' ? 30 : roomType === 'seminar-hall' ? 120 : 60);
    return { actions: [{ type: 'addRoom', name, roomType, capacity }], reply: `I'll add ${name} with ${capacity} seats.`, understood: true };
  }
  const addRoom = /\badd (?:a )?(?:new )?(lab|room|classroom|hall|seminar hall)\s+([\w -]+?)(?:\s+(?:with|for|of)\b|,|$)/i.exec(text);
  if (addRoom) {
    const kind = addRoom[1].toLowerCase();
    const roomType = kind === 'lab' ? 'lab' : kind.includes('hall') ? 'seminar-hall' : 'classroom';
    const label = addRoom[2].trim();
    const name = /^\d/.test(label) ? `${kind === 'lab' ? 'Lab' : 'Room'} ${label}` : label;
    const capacity = numberIn(text.replace(label, '')) ?? (roomType === 'lab' ? 30 : roomType === 'seminar-hall' ? 120 : 60);
    return { actions: [{ type: 'addRoom', name, roomType, capacity }], reply: `I'll add ${name} with ${capacity} seats.`, understood: true };
  }
  const addClass = /\badd (?:a )?(?:new )?(?:class|division|section)\s+(?:called\s+|named\s+)?([\w-]+)/i.exec(text) ?? /\badd\s+([A-Z][\w-]*)\s*,?\s*(?:with\s+)?\d+\s*students/.exec(text);
  if (addClass) {
    const size = /(\d+)\s*students/i.exec(text)?.[1];
    const batchCount = /(\d+|two|three|four)\s*(?:lab )?batch/i.exec(text)?.[1];
    const count = batchCount ? (NUMBER_WORDS[batchCount.toLowerCase()] ?? Number(batchCount)) : 0;
    const suffix = addClass[1].split('-').pop()!.toUpperCase();
    return {
      actions: [
        {
          type: 'addClass',
          name: addClass[1],
          ...(size ? { size: Number(size) } : {}),
          ...(count ? { batches: Array.from({ length: count }, (_, i) => `${suffix.slice(0, 2)}${i + 1}`) } : {}),
        },
      ],
      reply: `I'll add class ${addClass[1]}.`,
      understood: true,
    };
  }

  // Assigning: "Kamat teaches Machine Learning", "give DBMS to Iyer".
  const subject = findByName(text, profile.subjects);
  if (teacher && subject && /\b(teach|teaches|take|takes|give|assign|handle|handles)\b/i.test(text)) {
    const division = findByName(text, profile.divisions);
    return {
      actions: [{ type: 'assignTeacher', subjectId: subject.id, teacherId: teacher.id, ...(division ? { divisionId: division.id } : {}) }],
      reply: `${teacher.name} will teach ${subject.name}${division ? ` for ${division.name}` : ''}.`,
      understood: true,
    };
  }
  if (subject && /\b(times|periods|lectures|sessions)\b.*\bweek\b/i.test(text)) {
    const n = numberIn(text.replace(subject.name, ''));
    if (n) {
      return {
        actions: [{ type: 'updateSubject', subjectId: subject.id, changes: { sessionsPerWeek: n } }],
        reply: `${subject.name} will be ${n} times a week.`,
        understood: true,
      };
    }
  }
  if (teacher && /\b(teach|teaches)\b/i.test(text) && !subject) {
    const what = /\bteach(?:es)?\s+(.+?)(?:\s+(\d+|once|twice)\b.*)?$/i.exec(text)?.[1]?.replace(/[?.!]+$/, '').replace(/\s+(instead|please|now|too|also|as well|from now on)$/i, '').trim();
    if (what) {
      const isLab = /\blab\b/i.test(what);
      const times = numberIn(text) ?? (isLab ? 1 : 3);
      return {
        actions: [{ type: 'addSubject', name: what, isLab, sessionsPerWeek: times, durationSlots: isLab ? 2 : 1, teacherId: teacher.id }],
        reply: `I'll add ${what} (${times}× a week) taught by ${teacher.name}.`,
        understood: true,
      };
    }
  }

  // Hours and days.
  const hours = /\b(?:start|starts|begin|from)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?.*?\b(?:end|ends|finish|finishes|till|until|to|by)\s+(?:at\s+|by\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (hours && /\b(day|class|classes|college|school|teaching)\b/i.test(text)) {
    const fmt = (h: string, m: string | undefined, ap: string | undefined, isEnd: boolean) => {
      let hour = Number(h) % 24;
      if (ap?.toLowerCase() === 'pm' && hour < 12) hour += 12;
      if (!ap && isEnd && hour < 8) hour += 12;
      return `${String(hour).padStart(2, '0')}:${m ?? '00'}`;
    };
    const startTime = fmt(hours[1], hours[2], hours[3], false);
    const endTime = fmt(hours[4], hours[5], hours[6], true);
    return { actions: [{ type: 'setHours', startTime, endTime }], reply: `Teaching will run from ${startTime} to ${endTime}.`, understood: true };
  }
  const minutes = /(\d{2,3})\s*(?:min|minute)/i.exec(text);
  if (minutes && /\bperiod|lecture|slot\b/i.test(text)) {
    return {
      actions: [{ type: 'setHours', slotDurationMinutes: Number(minutes[1]) }],
      reply: `Each period will be ${minutes[1]} minutes.`,
      understood: true,
    };
  }

  if (teacher) return nothing(`I found ${teacher.name}, but not what to change. Try “${teacher.name} is absent tomorrow” or “max 3 a day for ${teacher.name}”.`);
  return nothing('I did not catch that. Try “Mehta is on leave from Monday to Wednesday” or “make 3 variations”.');
};

/** What the local model returns from /api/agent/interpret (see apps/api/src/intent.js). */
export interface ModelIntent {
  intent: string;
  teacher?: string | null;
  subject?: string | null;
  class_name?: string | null;
  room_name?: string | null;
  date_from?: string | null;
  date_to?: string | null;
  day?: string | null;
  number?: number | null;
  expertise?: string[];
  style?: VariantStyle | null;
}

/** Words that must be in the sentence for the model's reading of it to be believed. */
const EVIDENCE: Record<string, RegExp> = {
  absent: AWAY,
  leave: AWAY,
  day_off: /\b(can'?t|cannot|never|not|no|don'?t|doesn'?t|off|unavailable|free)\b/i,
  limit_day: /\b(max|maximum|most|limit|more than|no more|only|fewer|less)\b/i,
  limit_week: /\b(max|maximum|most|limit|more than|no more|only|fewer|less)\b/i,
  add_teacher: /\b(hire|hired|hiring|joined|joining|new|add)\b/i,
  add_room: /\b(room|lab|hall|classroom)\b/i,
  add_class: /\b(class|division|section)\b/i,
  assign: /\b(teach|teaches|teaching|take|takes|give|assign|handle|handles)\b/i,
  add_subject: /\b(teach|teaches|teaching|take|takes|give|assign|handle|handles)\b/i,
  generate: /\b(?:build|make|generate|create|redo|regenerate|rebuild|need|new|fresh|another)\b.*\b(?:timetable|schedule|week)\b/i,
  variations: /\b(variation|variant|option|version|alternative)s?\b/i,
};
const NEEDS_TEACHER = new Set(['absent', 'leave', 'day_off', 'limit_day', 'limit_week', 'assign', 'add_subject']);

/**
 * A very small model is often confidently wrong, so its answer is only a hint about which kind
 * of request this is. The sentence must back it up, and every detail (who, when, how many) is
 * taken from the sentence itself. Anything it can't support is treated as not understood.
 */
export const understandModelReply = (intent: ModelIntent, text: string, profile: ProfileData, today = new Date()): CommandResult => {
  const unsure: CommandResult = { actions: [], reply: 'I did not catch that. Try “Mehta is on leave from Monday to Wednesday” or “make 3 variations”.', understood: false };
  const evidence = EVIDENCE[intent.intent];
  if (!evidence?.test(text) || /\b(delete|remove|send|email|e-mail|print|share|who|what|when|where|why|how)\b/i.test(text)) return unsure;
  const teacher = findTeacher(text, profile.teachers);
  if (NEEDS_TEACHER.has(intent.intent) && !teacher) return unsure;
  const said = (value?: string | null) => (value?.trim() && text.toLowerCase().includes(value.trim().toLowerCase()) ? value.trim() : null);
  const weekday = new RegExp(DAY_RE.source, 'i').exec(text)?.[1] ?? null;
  const span = weekSpanIn(text, today);
  const range = /\bfrom\b(.+?)\b(?:to|until|till)\b(.+)$/i.exec(text);
  const from = span?.from ?? (range ? dateIn(range[1], today) : dateIn(text, today));
  const to = span?.to ?? (range ? dateIn(range[2], today) : from);
  const remainder = teacher ? text.replace(new RegExp(stripTitle(teacher.name), 'i'), '') : text;
  const perWeek = /\bweek/i.test(text);
  const kind = intent.intent === 'limit_day' || intent.intent === 'limit_week' ? (perWeek ? 'limit_week' : 'limit_day') : intent.intent;
  const result = actionsFromIntent(
    {
      intent: kind,
      teacher: kind === 'add_teacher' ? said(intent.teacher) : (teacher?.name ?? null),
      subject: said(intent.subject),
      class_name: said(intent.class_name),
      room_name: said(intent.room_name),
      date_from: from,
      date_to: to,
      day: weekday,
      number: kind.startsWith('limit') ? limitIn(remainder) : numberIn(remainder),
      expertise: (intent.expertise ?? []).filter((item) => said(item)),
      style: styleIn(text),
    },
    profile,
    today,
  );
  // Half-understood is worse than not understood: only a complete action is offered.
  return result.actions.length ? result : { ...unsure, reply: teacher && result.reply ? result.reply : unsure.reply };
};

/**
 * Turn the model's classification into actions, checking every name against the real
 * profile. A teacher or subject the model invented is refused, not created by accident.
 */
export const actionsFromIntent = (intent: ModelIntent, profile: ProfileData, today = new Date()): CommandResult => {
  const teacher = intent.teacher ? findTeacher(intent.teacher, profile.teachers) : null;
  const needTeacher = (): CommandResult => ({
    actions: [],
    reply: intent.teacher ? `I could not find a teacher called “${intent.teacher}”.` : 'Which teacher do you mean?',
    understood: false,
  });
  const day = intent.day ? dayName(intent.day) : null;
  const from = intent.date_from ? dateIn(intent.date_from, today) : null;
  const to = intent.date_to ? dateIn(intent.date_to, today) : from;
  const n = intent.number && intent.number > 0 ? intent.number : null;

  switch (intent.intent) {
    case 'absent':
    case 'leave': {
      if (!teacher) return needTeacher();
      const start = from ?? (day ? dateIn(day, today) : null);
      if (!start) return { actions: [], reply: `When is ${teacher.name} away?`, understood: false };
      const end = to && to >= start ? to : start;
      return start === end
        ? { actions: [{ type: 'markAbsent', teacherId: teacher.id, date: start }], reply: `I'll mark ${teacher.name} absent on ${start}.`, understood: true }
        : { actions: [{ type: 'leave', teacherId: teacher.id, from: start, to: end }], reply: `I'll mark ${teacher.name} on leave from ${start} to ${end}.`, understood: true };
    }
    case 'day_off':
      if (!teacher) return needTeacher();
      if (!day) return { actions: [], reply: `Which day can ${teacher.name} not teach?`, understood: false };
      return { actions: [{ type: 'teacherDayOff', teacherId: teacher.id, day }], reply: `${teacher.name} will not teach on ${day}s.`, understood: true };
    case 'limit_day':
    case 'limit_week': {
      if (!teacher) return needTeacher();
      if (!n) return { actions: [], reply: 'What should the limit be?', understood: false };
      const perWeek = intent.intent === 'limit_week';
      return {
        actions: [{ type: 'updateTeacher', teacherId: teacher.id, changes: perWeek ? { maxLecturesPerWeek: n } : { maxLecturesPerDay: n } }],
        reply: `${teacher.name} will teach at most ${n} periods a ${perWeek ? 'week' : 'day'}.`,
        understood: true,
      };
    }
    case 'add_teacher':
      if (!intent.teacher?.trim()) return { actions: [], reply: 'What is the new teacher called?', understood: false };
      return {
        actions: [{ type: 'addTeacher', name: intent.teacher.trim(), ...(intent.expertise?.length ? { expertise: intent.expertise } : {}) }],
        reply: `I'll add ${intent.teacher.trim()}.`,
        understood: true,
      };
    case 'add_room': {
      if (!intent.room_name?.trim()) return { actions: [], reply: 'What is the room called?', understood: false };
      const isLab = /lab/i.test(intent.room_name);
      return {
        actions: [{ type: 'addRoom', name: intent.room_name.trim(), roomType: isLab ? 'lab' : 'classroom', capacity: n ?? (isLab ? 30 : 60) }],
        reply: `I'll add ${intent.room_name.trim()}.`,
        understood: true,
      };
    }
    case 'add_class':
      if (!intent.class_name?.trim()) return { actions: [], reply: 'What is the class called?', understood: false };
      return {
        actions: [{ type: 'addClass', name: intent.class_name.trim(), ...(n ? { size: n } : {}) }],
        reply: `I'll add class ${intent.class_name.trim()}.`,
        understood: true,
      };
    case 'assign':
    case 'add_subject': {
      if (!teacher) return needTeacher();
      const subject = intent.subject ? findByName(intent.subject, profile.subjects) : null;
      if (subject) {
        const division = intent.class_name ? findByName(intent.class_name, profile.divisions) : null;
        return {
          actions: [{ type: 'assignTeacher', subjectId: subject.id, teacherId: teacher.id, ...(division ? { divisionId: division.id } : {}) }],
          reply: `${teacher.name} will teach ${subject.name}.`,
          understood: true,
        };
      }
      if (!intent.subject?.trim()) return { actions: [], reply: 'Which subject?', understood: false };
      const isLab = /\blab\b/i.test(intent.subject);
      return {
        actions: [{ type: 'addSubject', name: intent.subject.trim(), isLab, sessionsPerWeek: n ?? (isLab ? 1 : 3), durationSlots: isLab ? 2 : 1, teacherId: teacher.id }],
        reply: `I'll add ${intent.subject.trim()} taught by ${teacher.name}.`,
        understood: true,
      };
    }
    case 'generate':
      return { actions: [{ type: 'generate', style: intent.style ?? 'balanced' }], reply: 'I’ll build a new timetable.', understood: true };
    case 'variations': {
      const count = Math.min(5, Math.max(2, n ?? 3));
      return {
        actions: [{ type: 'generateVariants', styles: (['balanced', 'compact', 'teacher_days', 'spread', 'late_start'] as VariantStyle[]).slice(0, count) }],
        reply: `I’ll build ${count} versions to compare.`,
        understood: true,
      };
    }
    default:
      return { actions: [], reply: 'I did not catch that. Try “Mehta is absent tomorrow” or “make 3 variations”.', understood: false };
  }
};
