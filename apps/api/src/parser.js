import { completeJson } from './llm.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ROOM_TYPES = ['classroom', 'lab', 'seminar-hall'];
// Placeholder names small models emit when a sentence lacks a real entity.
const GENERIC_NAMES = new Set(
  ['teacher', 'teachers', 'room', 'rooms', 'subject', 'subjects', 'lab', 'labs', 'division', 'class', 'batch', 'classroom', 'professor'],
);
const MAX_INPUT_CHARS = 6000;

const nullable = (type) => ({ type: [type, 'null'] });
const stringList = { type: 'array', items: { type: 'string' } };
const object = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

/**
 * Deliberately flat schema: names instead of ids, nullable instead of guessed values.
 * Small models fill short, shallow objects far more reliably than nested graphs, and
 * the server resolves references (subject -> teacher/room) deterministically afterwards.
 */
export const draftSchema = object({
  institution: object({
    name: nullable('string'),
    workingDays: stringList,
    startTime: nullable('string'),
    endTime: nullable('string'),
    slotDurationMinutes: nullable('integer'),
    breakAfterSlots: nullable('integer'),
    breakDurationMinutes: nullable('integer'),
  }),
  divisions: { type: 'array', items: object({ name: { type: 'string' }, batches: stringList }) },
  teachers: {
    type: 'array',
    items: object({
      name: { type: 'string' },
      maxLecturesPerDay: nullable('integer'),
      maxLecturesPerWeek: nullable('integer'),
      unavailableDays: stringList,
    }),
  },
  rooms: {
    type: 'array',
    items: object({
      name: { type: 'string' },
      type: { type: 'string', enum: ROOM_TYPES },
      capacity: nullable('integer'),
    }),
  },
  subjects: {
    type: 'array',
    items: object({
      name: { type: 'string' },
      isLab: { type: 'boolean' },
      sessionsPerWeek: nullable('integer'),
      durationSlots: nullable('integer'),
      teacher: nullable('string'),
      room: nullable('string'),
    }),
  },
});

const SYSTEM_PROMPT = `You convert a college timetable coordinator's notes into JSON.
Rules:
- Copy names exactly as written. Never invent people, rooms, subjects or divisions.
- Use null or [] for anything not stated. Do not guess numbers.
- workingDays and unavailableDays use full English day names, e.g. "Monday".
- Times are 24-hour "HH:MM". "9am" -> "09:00", "4:30pm" -> "16:30".
- A subject is a lab (isLab true) if it is called a lab or practical.
- durationSlots = consecutive periods per session (a "2 hour lab" with 1 hour periods = 2).
- sessionsPerWeek = how many times per week the subject happens.
- subject.teacher / subject.room = the teacher or room named for that subject.
- Rooms named like a lab are type "lab"; halls are "seminar-hall"; others "classroom".
- Divisions are class sections such as "SE-A"; batches are lab groups such as "A1".

Example notes: "Week is Mon-Fri 10am to 3pm, 1 hour periods. Division Q with batches Q1 and Q2. Prof. Ito teaches Botany 3 times a week in Hall 7, max 3 per day, not available Friday. Botany Lab is a 2 hour practical once a week with Prof. Ito in Green Lab."
Example JSON: {"institution":{"name":null,"workingDays":["Monday","Tuesday","Wednesday","Thursday","Friday"],"startTime":"10:00","endTime":"15:00","slotDurationMinutes":60,"breakAfterSlots":null,"breakDurationMinutes":null},"divisions":[{"name":"Q","batches":["Q1","Q2"]}],"teachers":[{"name":"Prof. Ito","maxLecturesPerDay":3,"maxLecturesPerWeek":null,"unavailableDays":["Friday"]}],"rooms":[{"name":"Hall 7","type":"seminar-hall","capacity":null},{"name":"Green Lab","type":"lab","capacity":null}],"subjects":[{"name":"Botany","isLab":false,"sessionsPerWeek":3,"durationSlots":1,"teacher":"Prof. Ito","room":"Hall 7"},{"name":"Botany Lab","isLab":true,"sessionsPerWeek":1,"durationSlots":2,"teacher":"Prof. Ito","room":"Green Lab"}]}
Now convert the user's notes. Output only JSON.`;

// ---------- normalisation helpers ----------

const squash = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number) || value === null || value === '') return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
};

export const normalizeDay = (value) => {
  const key = squash(value).slice(0, 3);
  return DAYS.find((day) => day.toLowerCase().startsWith(key) && key.length === 3) ?? null;
};

const expandDays = (values) => {
  const days = [];
  for (const raw of values ?? []) {
    const parts = String(raw).split(/\s*(?:-|–|to|through)\s*/i);
    if (parts.length === 2 && normalizeDay(parts[0]) && normalizeDay(parts[1])) {
      const from = DAYS.indexOf(normalizeDay(parts[0]));
      const to = DAYS.indexOf(normalizeDay(parts[1]));
      if (from <= to) days.push(...DAYS.slice(from, to + 1));
      continue;
    }
    const day = normalizeDay(raw);
    if (day) days.push(day);
  }
  return DAYS.filter((day) => days.includes(day));
};

export const normalizeTime = (value) => {
  const match = String(value ?? '').trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (match[3] === 'pm' && hours < 12) hours += 12;
  if (match[3] === 'am' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const dedupeByName = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = squash(item.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Find `name` among `candidates` by exact, then containment, then surname match. */
export const matchName = (name, candidates) => {
  const key = squash(name);
  if (!key) return null;
  const exact = candidates.find((candidate) => squash(candidate) === key);
  if (exact) return exact;
  const contained = candidates.filter((candidate) => {
    const other = squash(candidate);
    return other && (other.includes(key) || key.includes(other));
  });
  if (contained.length === 1) return contained[0];
  const last = clean(name).split(' ').pop()?.toLowerCase();
  const bySurname = candidates.filter((candidate) => clean(candidate).split(' ').pop()?.toLowerCase() === last);
  return bySurname.length === 1 ? bySurname[0] : null;
};

/**
 * Turn whatever the model (or the rule parser) produced into a safe draft:
 * clamp numbers, apply defaults, drop names that never appear in the source text
 * (small models hallucinate, especially from the few-shot example), and link
 * subjects to teachers/rooms by name.
 */
export const normalizeDraft = (raw, sourceText, context = {}) => {
  const warnings = [];
  const source = squash(sourceText);
  const grounded = (kind) => (item) => {
    if (GENERIC_NAMES.has(squash(item.name))) return false;
    if (source.includes(squash(item.name))) return true;
    warnings.push(`Ignored ${kind} "${item.name}" because it does not appear in your text.`);
    return false;
  };
  const list = (value) => (Array.isArray(value) ? value : []);

  const inst = raw?.institution ?? {};
  const institution = {
    name: inst.name && source.includes(squash(inst.name)) ? clean(inst.name) : null,
    workingDays: expandDays(list(inst.workingDays)),
    startTime: normalizeTime(inst.startTime),
    endTime: normalizeTime(inst.endTime),
    slotDurationMinutes: inst.slotDurationMinutes == null ? null : clamp(inst.slotDurationMinutes, 15, 240, null),
    breakAfterSlots: inst.breakAfterSlots == null ? null : clamp(inst.breakAfterSlots, 1, 12, null),
    breakDurationMinutes: inst.breakDurationMinutes == null ? null : clamp(inst.breakDurationMinutes, 0, 240, null),
  };
  const endHour = Number(institution.endTime?.slice(0, 2));
  if (institution.startTime && institution.endTime <= institution.startTime && endHour < 12) {
    // "8:30 to 2:30" means 2:30 pm.
    institution.endTime = `${String(endHour + 12).padStart(2, '0')}${institution.endTime.slice(2)}`;
  }
  if (institution.startTime && institution.endTime && institution.startTime >= institution.endTime) {
    warnings.push(`Start time ${institution.startTime} is not before end time ${institution.endTime}; ignored both.`);
    institution.startTime = institution.endTime = null;
  }

  const divisions = dedupeByName(
    list(raw?.divisions)
      .map((item) => ({
        name: clean(item?.name).replace(/^(?:division|div\.?|class|section)\s+/i, ''),
        batches: [...new Set(list(item?.batches).map(clean).filter(Boolean))],
        size: item?.size == null ? null : clamp(item.size, 1, 1000, null),
      }))
      .filter((item) => item.name)
      .filter(grounded('division')),
  );

  // Small models sometimes list a subject or room as a teacher ("DBMS Lab").
  const otherNames = new Set([...list(raw?.subjects), ...list(raw?.rooms)].map((item) => squash(item?.name)));
  const teachers = dedupeByName(
    list(raw?.teachers)
      .map((item) => {
        const maxLecturesPerDay = clamp(item?.maxLecturesPerDay, 1, 12, 4);
        return {
          name: clean(item?.name),
          maxLecturesPerDay,
          maxLecturesPerWeek: clamp(item?.maxLecturesPerWeek, maxLecturesPerDay, 60, Math.max(20, maxLecturesPerDay)),
          unavailableDays: expandDays(list(item?.unavailableDays)),
        };
      })
      .filter((item) => item.name)
      .filter((item) => !otherNames.has(squash(item.name)))
      .filter(grounded('teacher')),
  );

  const rooms = dedupeByName(
    list(raw?.rooms)
      .map((item) => {
        const name = clean(item?.name);
        let type = ROOM_TYPES.includes(item?.type) ? item.type : 'classroom';
        if (/\blab|laboratory/i.test(name)) type = 'lab';
        return { name, type, capacity: clamp(item?.capacity, 1, 1000, type === 'lab' ? 30 : 60) };
      })
      .filter((item) => item.name)
      .filter(grounded('room')),
  );

  const knownTeachers = [...(context.teachers ?? []), ...teachers.map((item) => item.name)];
  const knownRooms = [...(context.rooms ?? []), ...rooms.map((item) => item.name)];

  const subjects = dedupeByName(
    list(raw?.subjects)
      .map((item) => {
        const name = clean(item?.name);
        const isLab = Boolean(item?.isLab) || /\b(lab|practical)/i.test(name);
        return {
          name,
          isLab,
          sessionsPerWeek: clamp(item?.sessionsPerWeek, 1, 15, isLab ? 1 : 3),
          durationSlots: clamp(item?.durationSlots, 1, 6, isLab ? 2 : 1),
          teacher: item?.teacher ? clean(item.teacher) : null,
          room: item?.room ? clean(item.room) : null,
        };
      })
      .filter((item) => item.name)
      .filter(grounded('subject')),
  );

  for (const subject of subjects) {
    if (subject.teacher) {
      const match = matchName(subject.teacher, knownTeachers);
      if (match) {
        subject.teacher = match;
      } else if (source.includes(squash(subject.teacher))) {
        // Mentioned only alongside the subject: add the teacher with default limits.
        teachers.push({ name: subject.teacher, maxLecturesPerDay: 4, maxLecturesPerWeek: 20, unavailableDays: [] });
        knownTeachers.push(subject.teacher);
      } else {
        subject.teacher = null;
      }
    }
    if (subject.room) {
      const match = matchName(subject.room, knownRooms);
      if (match) {
        subject.room = match;
      } else if (source.includes(squash(subject.room))) {
        const type = subject.isLab || /lab/i.test(subject.room) ? 'lab' : 'classroom';
        rooms.push({ name: subject.room, type, capacity: type === 'lab' ? 30 : 60 });
        knownRooms.push(subject.room);
      } else {
        subject.room = null;
      }
    }
    if (!subject.teacher) warnings.push(`${subject.name}: no teacher assigned yet.`);
    if (!subject.room) warnings.push(`${subject.name}: no room assigned yet.`);
    const room = rooms.find((item) => item.name === subject.room);
    if (subject.isLab && room && room.type !== 'lab') {
      warnings.push(`${subject.name} is a lab but ${room.name} is not a lab room.`);
    }
  }

  return { draft: { institution, divisions, teachers, rooms, subjects }, warnings };
};

// ---------- rule-based fallback (works with no model at all) ----------

const splitNames = (block) =>
  block
    .split(/,|\band\b|;/i)
    .map((value) => clean(value.replace(/^(?:called|named|are|is|:)\s*/i, '')))
    .filter(Boolean);

// Words that mark a phrase as a rule ("max 3 lectures a day") rather than a name.
const NOT_A_NAME =
  /\b(?:max(?:imum)?|min(?:imum)?|can(?:not|'t)?|not|available|unavailable|lectures?|periods?|per|each|every|day|days|week|take|takes|must|should|only|no|teaches?|taught)\b/i;
const looksLikeName = (value) =>
  value.split(/\s+/).length <= 5 && !NOT_A_NAME.test(value) && !/[()]/.test(value);

export const ruleParse = (text) => {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  const raw = { institution: { workingDays: [] }, divisions: [], teachers: [], rooms: [], subjects: [] };
  // Only plural list phrasing ("teachers Alice, Bob") is read here; a singular
  // mention ("in Room 101, max 3 lectures") is a detail of another sentence.
  const grab = (pattern, { dropParentheses = false } = {}) => {
    for (const sentence of sentences) {
      const match = sentence.match(pattern);
      if (!match) continue;
      let block = match[1].replace(/[.!?]$/, '');
      if (dropParentheses) block = block.replace(/\([^)]*\)/g, '');
      return splitNames(block);
    }
    return [];
  };

  for (const name of grab(/\bteachers\s+([^.]+)/i).filter(looksLikeName)) raw.teachers.push({ name });
  for (const name of grab(/\brooms\s+([^.]+)/i).filter(looksLikeName)) {
    raw.rooms.push({ name, type: /lab/i.test(name) ? 'lab' : 'classroom' });
  }
  for (const name of grab(/\bdivisions\s+([^.]+)/i, { dropParentheses: true }).filter(looksLikeName)) {
    raw.divisions.push({ name, batches: [] });
  }
  for (const part of grab(/\bsubjects\s+([^.]+)/i)) {
    const slots = part.match(/(\d+)\s*slots?/i);
    const perWeek = part.match(/(\d+)\s*(?:times|sessions|lectures)/i);
    raw.subjects.push({
      name: clean(part.replace(/\(.*?\)/g, '')),
      isLab: /lab|practical/i.test(part),
      durationSlots: slots ? Number(slots[1]) : null,
      sessionsPerWeek: perWeek ? Number(perWeek[1]) : null,
    });
  }

  raw.institution = { ...raw.institution, ...ruleTiming(text) };
  return raw;
};

// ---------- deterministic timing rules ----------

const DAY_WORD = '(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?\\b';
const DAY_RANGE = `\\b${DAY_WORD}\\s*(?:-|–|to|through|till|until)\\s*${DAY_WORD}`;
const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 };
const WORD_NUMBERS = {
  once: 1, twice: 2, thrice: 3, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, single: 1, double: 2,
};

/** Every day named in `text`, including those inside ranges like "Mon-Fri" or "weekdays". */
export const daysMentioned = (text) => {
  const lower = String(text).toLowerCase();
  const found = new Set();
  for (const match of lower.matchAll(new RegExp(DAY_RANGE, 'g'))) {
    expandDays([`${match[1]}-${match[2]}`]).forEach((day) => found.add(day));
  }
  for (const match of lower.matchAll(new RegExp(`\\b${DAY_WORD}`, 'g'))) {
    const day = normalizeDay(match[1]);
    if (day) found.add(day);
  }
  if (/\bweekdays\b/.test(lower)) DAYS.slice(0, 5).forEach((day) => found.add(day));
  return DAYS.filter((day) => found.has(day));
};

/**
 * Regex extraction for the regular, high-stakes timing fields. These patterns are
 * predictable enough that rules beat a 1-2B model, so they take precedence.
 */
export const ruleTiming = (text) => {
  const lower = String(text).toLowerCase();
  const timing = {};

  const range = lower.match(new RegExp(DAY_RANGE));
  if (range) timing.workingDays = expandDays([`${range[1]}-${range[2]}`]);
  else if (/\bweekdays\b/.test(lower)) timing.workingDays = DAYS.slice(0, 5);

  const setHours = (startRaw, endRaw) => {
    const start = normalizeTime(startRaw);
    let end = normalizeTime(endRaw);
    if (!start || !end) return false;
    const endHour = Number(end.slice(0, 2));
    // "8:30 to 2:30" means 2:30 pm.
    if (end <= start && endHour < 12) end = `${String(endHour + 12).padStart(2, '0')}${end.slice(2)}`;
    if (end <= start) return false;
    Object.assign(timing, { startTime: start, endTime: end });
    return true;
  };
  const clock = '(\\d{1,2}(?:[:.]\\d{2})?\\s*(?:am|pm)?)';
  const clockRange = new RegExp(`(from|between|timings?:?)?\\s*${clock}\\s*(?:-|–|to|till|until|and)\\s*${clock}`, 'g');
  for (const match of lower.matchAll(clockRange)) {
    // Skip "3 to 4 lectures": a real time range has am/pm, a colon, or "from/between".
    if (!match[1] && !/am|pm|:/.test(match[2] + match[3])) continue;
    if (setHours(match[2], match[3])) break;
  }
  if (!timing.startTime) {
    const openClose = lower.match(
      new RegExp(`(?:opens?|starts?|begins?)\\s+(?:at\\s+)?${clock}[^.\\n]*?(?:closes?|ends?|finishes?)\\s+(?:at\\s+|by\\s+)?${clock}`),
    );
    if (openClose) setHours(openClose[1], openClose[2]);
  }

  const period =
    lower.match(/(\d{2,3})\s*-?\s*min(?:ute)?s?\s*(?:long\s*)?(?:periods?|lectures?|slots?|classes)/) ??
    lower.match(/(?:periods?|lectures?|slots?)\s*(?:are|is|of)\s*(\d{2,3})\s*min/);
  if (period) timing.slotDurationMinutes = Number(period[1]);
  else if (/\b(?:1|one|an?)\s*-?\s*hour(?:\s*long)?\s*(?:periods?|lectures?|slots?|classes)/.test(lower)) {
    timing.slotDurationMinutes = 60;
  }

  const breakLength =
    lower.match(/(\d{1,3})\s*-?\s*min(?:ute)?s?\s*(?:long\s*)?(?:break|recess|lunch)/) ??
    lower.match(/(?:break|recess|lunch)\s*(?:break\s*)?(?:of|for|is|:)?\s*(\d{1,3})\s*min/);
  if (breakLength) timing.breakDurationMinutes = Number(breakLength[1]);
  else if (/half\s*(?:an)?\s*hour\s*(?:break|recess|lunch)/.test(lower)) timing.breakDurationMinutes = 30;
  else if (/\b(?:1|one|an)\s*-?\s*hour\s*(?:break|recess|lunch)/.test(lower)) timing.breakDurationMinutes = 60;

  const after =
    lower.match(
      /(?:break|recess|lunch)[^.\n]*?after\s*(?:the\s*)?(?:(\d+)(?:st|nd|rd|th)?|(first|second|third|fourth|fifth|sixth))\s*(?:period|lecture|slot|hour|class)/,
    ) ?? lower.match(/(?:break|recess|lunch)[^.\n]*?after\s*(?:period|lecture|slot)\s*(\d+)/);
  if (after) timing.breakAfterSlots = Number(after[1] ?? ORDINALS[after[2]]);

  return timing;
};

// ---------- sentence-local grounding ----------

const PER_WEEK_UNIT = '(?:times?|lectures?|sessions?|periods?|classes|lessons?)?\\s*(?:(?:a|per|each|/)\\s*week|weekly)';
const LIMIT = '(?:max(?:imum)?|at most|up to|no more than|only)\\s*(\\d+)\\s*(?:lectures?|periods?|classes|sessions?|hours?)?\\s*';

/** "max 2 lectures daily" / "at most 3 per day" -> 2 / 3, or null. */
const statedLimit = (context, unit) => {
  const match = context.match(new RegExp(`${LIMIT}(?:(?:a|per|each)\\s*)?(?:${unit})\\b`, 'i'));
  return match ? Number(match[1]) : null;
};
const LENGTH_UNIT = '(?:hours?|hrs?|periods?|slots?)\\b';
const UNAVAILABLE =
  /not available|unavailable|can'?t (?:come|teach|make it)|cannot (?:come|teach)|\boff on\b|\bis off\b|absent|on leave|\bno classes? on\b/i;
const PRONOUN_START = /^(he|she|they|his|her|their|it|this|these)\b/i;
const TITLE_DOT = /\b(prof|dr|mr|mrs|ms|st|no|sr|jr)\./gi;

/** Split into sentences without breaking on titles like "Prof." or "Dr.". */
export const splitSentences = (text) =>
  String(text)
    .replace(TITLE_DOT, '$1\u0000')
    .split(/\n+|(?<=[.!?;])\s+/)
    .map((sentence) => clean(sentence.replace(/\u0000/g, '.')))
    .filter(Boolean);

const numbersIn = (text) => {
  const lower = String(text).toLowerCase();
  const numbers = new Set((lower.match(/\d+/g) ?? []).map(Number));
  for (const [word, value] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) numbers.add(value);
  }
  return numbers;
};

/**
 * Keep an entity's attributes only if they appear in a sentence that names that
 * entity (or a following "He/She…" sentence). This stops small models copying one
 * teacher's limits or days onto another, and leaking values from the prompt example.
 */
export const groundRaw = (raw, text) => {
  const sentences = splitSentences(text);
  const contextOf = (name) => {
    const key = squash(name);
    const surname = squash(clean(name).split(' ').pop());
    const picked = [];
    sentences.forEach((sentence, index) => {
      const words = sentence.toLowerCase().split(/[^a-z0-9']+/).map(squash);
      if ((key && squash(sentence).includes(key)) || (surname.length >= 3 && words.includes(surname))) {
        picked.push(sentence);
        if (sentences[index + 1] && PRONOUN_START.test(sentences[index + 1])) picked.push(sentences[index + 1]);
      }
    });
    return picked.join(' ');
  };
  const num = (value, context) => (value != null && numbersIn(context).has(Number(value)) ? value : null);
  // A number only counts if its unit follows it: "5 lectures per week" grounds
  // sessionsPerWeek=5, but "at most 2 per day" must not ground durationSlots=2.
  const withUnit = (value, context, unit) => {
    if (value == null) return null;
    const words = [String(value), ...Object.keys(WORD_NUMBERS).filter((word) => WORD_NUMBERS[word] === Number(value))];
    const once = ['once', 'twice', 'thrice'].filter((word) => WORD_NUMBERS[word] === Number(value));
    const alternatives = [`\\b(?:${words.join('|')})\\s*-?\\s*${unit}`, ...once.map((word) => `\\b${word}\\b`)];
    return new RegExp(alternatives.join('|'), 'i').test(context) ? value : null;
  };
  // "3 times a week" must not ground "max 3 per day": limits need their unit nearby.
  const perDay = (value, context) => (/\b(?:day|daily)\b/i.test(context) ? num(value, context) : null);
  const perWeek = (value, context) => (/\b(?:week|weekly)\b/i.test(context) ? num(value, context) : null);
  const list = (value) => (Array.isArray(value) ? value : []);
  const all = numbersIn(text);
  const inst = raw?.institution ?? {};
  const time = (value) => {
    const normal = normalizeTime(value);
    const hour = normal ? Number(normal.slice(0, 2)) : NaN;
    return normal && (all.has(hour) || all.has(hour - 12)) ? value : null;
  };
  const mentionedDays = daysMentioned(text);

  return {
    institution: {
      name: inst.name ?? null,
      workingDays: expandDays(list(inst.workingDays)).filter((day) => mentionedDays.includes(day)),
      startTime: time(inst.startTime),
      endTime: time(inst.endTime),
      slotDurationMinutes: num(inst.slotDurationMinutes, text),
      breakAfterSlots: num(inst.breakAfterSlots, text),
      breakDurationMinutes: num(inst.breakDurationMinutes, text),
      ...ruleTiming(text),
    },
    divisions: list(raw?.divisions).map((item) => ({
      ...item,
      batches: list(item?.batches).filter((batch) => squash(text).includes(squash(batch))),
      size: divisionSize(item?.name, text),
    })),
    teachers: list(raw?.teachers).map((item) => {
      const context = contextOf(item?.name);
      const days = daysMentioned(context);
      return {
        ...item,
        maxLecturesPerDay: perDay(item?.maxLecturesPerDay, context) ?? statedLimit(context, 'day|daily'),
        maxLecturesPerWeek: perWeek(item?.maxLecturesPerWeek, context) ?? statedLimit(context, 'week|weekly'),
        unavailableDays: [
          ...new Set([
            ...expandDays(list(item?.unavailableDays)).filter((day) => days.includes(day)),
            ...splitSentences(context).filter((sentence) => UNAVAILABLE.test(sentence)).flatMap(daysMentioned),
          ]),
        ],
      };
    }),
    rooms: list(raw?.rooms).map((item) => ({ ...item, capacity: num(item?.capacity, contextOf(item?.name)) })),
    subjects: list(raw?.subjects).map((item) => {
      const context = contextOf(item?.name);
      return {
        ...item,
        sessionsPerWeek: withUnit(item?.sessionsPerWeek, context, PER_WEEK_UNIT),
        durationSlots: withUnit(item?.durationSlots, context, LENGTH_UNIT),
      };
    }),
  };
};

// ---------- deterministic "X teaches Y in Z" recall ----------

// Case-sensitive on purpose: names and subjects are capitalised, filler words are not.
const TEACHER_NAME = "(?:(?:[Pp]rof|[Dd]r|Mrs|Mr|Ms)\\.?\\s+)?[A-Z][\\w'.-]*(?:\\s+[A-Z][\\w'.-]*){0,2}";
const SUBJECT_NAME = '[A-Z][\\w&+/-]*(?:\\s+[A-Z][\\w&+/-]*){0,4}';
const ACTIVE = new RegExp(`(${TEACHER_NAME})\\s+(?:teaches|takes|handles|will teach|is teaching)\\s+(${SUBJECT_NAME})`, 'g');
const PASSIVE = new RegExp(`(${SUBJECT_NAME})\\s+(?:is|are|will be)\\s+(?:taken|taught|handled)\\s+by\\s+(${TEACHER_NAME})`, 'g');
// List-style lines are only trusted with a titled name, which tells teacher from subject:
// "Mr. Khan: Software Testing", "Accounts - Mrs. Pillai", "Business Law by Ms. Rego".
const TITLED_NAME = "(?:[Pp]rof|[Dd]r|Mrs|Mr|Ms)\\.?\\s+[A-Z][\\w'.-]*(?:\\s+[A-Z][\\w'.-]*){0,2}";
const TEACHER_FIRST = new RegExp(`^(${TITLED_NAME})\\s*[:–-]\\s*(${SUBJECT_NAME})`, 'g');
const SUBJECT_FIRST = new RegExp(`^(${SUBJECT_NAME})\\s*[:–-]\\s*(${TITLED_NAME})`, 'g');
const SUBJECT_BY = new RegExp(`(${SUBJECT_NAME})\\s+by\\s+(${TITLED_NAME})`, 'g');
// "DBMS Lab is a 2 hour practical once a week with Prof. Mehta in Lab 1": details sit before the teacher.
const SUBJECT_WITH = new RegExp(`^(${SUBJECT_NAME})\\s+(?:is|are)\\s+an?\\s+[^.]*?\\bwith\\s+(${TITLED_NAME})`, 'g');
const LEADING_FILLER = /^(?:Also|Then|And|Next|Finally|The)\s+/;
const ROOM_PATTERNS = [
  /\bin\s+(?:the\s+)?([A-Z][\w]*\s+(?:Lab|Hall|Laboratory))\b/,
  /\b((?:[Rr]oom|[Hh]all|[Ll]ab|[Cc]lassroom)\s+[A-Z]?-?\d+[\w-]*)/,
  /\bin\s+([A-Z]?-?\d+[\w-]*)\b/,
];

const findRoom = (text) => {
  for (const pattern of ROOM_PATTERNS) {
    const match = text.match(pattern);
    if (match) return clean(match[1]).replace(/^./, (first) => first.toUpperCase());
  }
  return null;
};

/** Extract "Prof. X teaches Subject 3 times a week in Room 101" / "Subject is taught by X" clauses. */
export const ruleAssignments = (text) =>
  splitSentences(text).flatMap((sentence) => {
    const matches = [
      ...[...sentence.matchAll(ACTIVE)].map((match) => ({ match, teacher: match[1], subject: match[2] })),
      ...[...sentence.matchAll(PASSIVE)].map((match) => ({ match, teacher: match[2], subject: match[1] })),
      ...[...sentence.matchAll(TEACHER_FIRST)].map((match) => ({ match, teacher: match[1], subject: match[2] })),
      ...[...sentence.matchAll(SUBJECT_FIRST)].map((match) => ({ match, teacher: match[2], subject: match[1] })),
      ...[...sentence.matchAll(SUBJECT_BY)].map((match) => ({ match, teacher: match[2], subject: match[1] })),
      ...[...sentence.matchAll(SUBJECT_WITH)].map((match) => ({
        match,
        teacher: match[2],
        subject: match[1],
        detailsFrom: match[1].length,
      })),
    ].sort((x, y) => x.match.index - y.match.index);
    return matches.map(({ match, teacher, subject, detailsFrom }, index) => {
      // Details for this assignment run until the next assignment in the sentence.
      const start = match.index + (detailsFrom ?? match[0].length);
      const rest = sentence.slice(start, matches[index + 1]?.match.index ?? sentence.length);
      const perWeek =
        rest.match(/(\d+|once|twice|thrice|one|two|three|four|five|six|seven)\s*(?:times|lectures?|sessions?|periods?|classes)?\s*(?:a|per|each)\s*week/i) ??
        rest.match(/\b(once|twice|thrice)\b/i);
      const duration =
        rest.match(/(\d+)\s*-?\s*(?:periods?|slots?|hours?)\s*(?:long|each)/i) ??
        rest.match(/(\d+)\s*-?\s*(?:periods?|slots?|hours?)\s+(?:practical|lab|session|block)/i);
      return {
        teacher: clean(teacher.replace(LEADING_FILLER, '')),
        subject: clean(subject.replace(LEADING_FILLER, '')),
        room: findRoom(rest),
        sessionsPerWeek: perWeek ? (WORD_NUMBERS[perWeek[1].toLowerCase()] ?? Number(perWeek[1])) : null,
        durationSlots: duration ? Number(duration[1]) : null,
      };
    });
  });

const GROUP = '([A-Z0-9][\\w-]*)(?:\\s*\\(\\s*batch(?:es)?:?\\s+([^)]*)\\)|\\s+(?:has|with)\\s+batch(?:es)?:?\\s+([A-Z0-9][\\w-]*(?:\\s*(?:,|and)\\s*[A-Z0-9][\\w-]*)*))?';
const DIVISION_WORD = '(?:[Dd]ivisions?|[Cc]lass|[Ss]ections?|[Gg]rades?|[Ss]td\\.?|[Ss]tandards?)';
const DIVISION_START = new RegExp(`\\b${DIVISION_WORD}\\s+${GROUP}`, 'g');
const DIVISION_NEXT = new RegExp(`^\\s*(?:,|and|&)\\s*(?:${DIVISION_WORD}\\s+)?${GROUP}`);

/** Extract "Divisions SE-A (batches A1, A2) and SE-B", "Class FY-1 has batches P, Q, R". */
export const ruleDivisions = (text) => {
  const divisions = [];
  const batchList = (value) => (value ? value.split(/,|\band\b/).map(clean).filter(Boolean) : []);
  for (const match of String(text).matchAll(DIVISION_START)) {
    divisions.push({ name: match[1], batches: batchList(match[2] ?? match[3]) });
    let rest = text.slice(match.index + match[0].length);
    for (let next = rest.match(DIVISION_NEXT); next; next = rest.match(DIVISION_NEXT)) {
      divisions.push({ name: next[1], batches: batchList(next[2] ?? next[3]) });
      rest = rest.slice(next[0].length);
    }
  }
  return divisions;
};

const STUDENTS = /(\d{1,4})\s*(?:students|pupils|learners)\b/i;

/**
 * Class size, read by rule only: "SE-A has 60 students", "SE-A and SE-B, 60 students each".
 * Prefers the first count after the division's name in a sentence that names it.
 */
export const divisionSize = (name, text) => {
  const needle = clean(name).toLowerCase();
  if (!needle) return null;
  for (const sentence of splitSentences(text)) {
    const at = sentence.toLowerCase().indexOf(needle);
    if (at === -1) continue;
    const found = sentence.slice(at).match(STUDENTS) ?? sentence.match(STUDENTS);
    if (found) return Number(found[1]);
  }
  return null;
};

/** "Room A-12" and "A-12" are the same room. */
const roomKey = (name) => squash(name).replace(/^(?:room|classroom)/, '');

/**
 * Add what the rules found but the model missed. Where a rule matched, its values
 * win: the patterns only fire on unambiguous sentences, small models do not.
 */
export const mergeAssignments = (raw, text) => {
  const merged = {
    ...raw,
    divisions: (raw.divisions ?? []).map((item) => ({ ...item })),
    teachers: [...(raw.teachers ?? [])],
    rooms: [...(raw.rooms ?? [])],
    subjects: (raw.subjects ?? []).map((item) => ({ ...item })),
  };
  const addTeacher = (name) => {
    if (name && !matchName(name, merged.teachers.map((t) => t.name))) {
      merged.teachers.push({ name, maxLecturesPerDay: null, maxLecturesPerWeek: null, unavailableDays: [] });
    }
  };
  const addRoom = (name) => {
    if (name && !merged.rooms.some((item) => roomKey(item?.name) === roomKey(name))) {
      merged.rooms.push({ name, type: /lab/i.test(name) ? 'lab' : 'classroom', capacity: null });
    }
  };

  for (const found of ruleDivisions(text)) {
    const division = merged.divisions.find((item) => squash(item?.name) === squash(found.name));
    if (!division) merged.divisions.push(found);
    else if (!division.batches?.length) division.batches = found.batches;
  }

  for (const found of ruleAssignments(text)) {
    addTeacher(found.teacher);
    addRoom(found.room);
    const subject = merged.subjects.find((item) => squash(item?.name) === squash(found.subject));
    if (subject) {
      subject.teacher = found.teacher;
      subject.room = found.room ?? subject.room;
      subject.sessionsPerWeek = found.sessionsPerWeek ?? subject.sessionsPerWeek;
      subject.durationSlots = found.durationSlots ?? subject.durationSlots;
    } else {
      merged.subjects.push({
        name: found.subject,
        isLab: /lab|practical/i.test(found.subject),
        sessionsPerWeek: found.sessionsPerWeek,
        durationSlots: found.durationSlots,
        teacher: found.teacher,
        room: found.room,
      });
    }
  }

  // Teachers and rooms the model only named inside a subject still need to be
  // grounded (limits, days off), so promote them before grounding runs.
  for (const subject of merged.subjects) {
    if (subject?.teacher && squash(text).includes(squash(subject.teacher))) addTeacher(subject.teacher);
    if (subject?.room && squash(text).includes(squash(subject.room))) addRoom(subject.room);
  }
  return merged;
};

/** Parse free text into a reviewable draft. Uses the local model, falls back to rules. */
export const parseRequirements = async (text, context = {}) => {
  const input = String(text).slice(0, MAX_INPUT_CHARS);
  const started = Date.now();
  try {
    const raw = await completeJson({ system: SYSTEM_PROMPT, user: input, schema: draftSchema });
    const { draft, warnings } = normalizeDraft(groundRaw(mergeAssignments(raw, input), input), input, context);
    return { draft, warnings, source: 'llm', elapsedMs: Date.now() - started };
  } catch (error) {
    const { draft, warnings } = normalizeDraft(groundRaw(mergeAssignments(ruleParse(input), input), input), input, context);
    return {
      draft,
      warnings: [`Local model unavailable (${error.message}). Used the basic rule parser instead.`, ...warnings],
      source: 'rules',
      elapsedMs: Date.now() - started,
    };
  }
};
