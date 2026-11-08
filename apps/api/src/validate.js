/** Limits on what a client may send. Anything past these is a mistake or an attack. */

export const LIMITS = {
  name: 120,
  institutionName: 160,
  label: 160,
  assistantText: 20000,
  days: 7,
  slots: 24,
  sessions: 3000,
  listItems: 3000,
  savedSessions: 6000,
  solverSeconds: 30,
  noticeText: 8000,
  noticeRecipients: 500,
};

/** A trimmed string no longer than `max`, or null if it is anything else. */
export const cleanText = (value, max) => {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean && clean.length <= max ? clean : null;
};

/** Only short strings from a list that may be any shape at all. */
const stringList = (value, max = 200) =>
  Array.isArray(value)
    ? value
        .filter((item) => typeof item === 'string')
        .slice(0, max)
        .map((item) => item.slice(0, 160))
    : [];

/** The assistant's context comes from the client, so keep only what it should contain. */
export const cleanContext = (context) => ({
  teachers: stringList(context?.teachers),
  subjects: stringList(context?.subjects),
  classes: stringList(context?.classes),
  rooms: stringList(context?.rooms),
});

/** What is wrong with a timetable request, in plain words, or null if it is fine. */
export const timetableRequestProblem = (request) => {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return 'request is required';
  const { days, slots, sessions, teacher_constraints: teachers, rooms, time_limit_seconds: seconds } = request;
  if (!Array.isArray(days) || !Array.isArray(slots) || !Array.isArray(sessions)) {
    return 'request.days, request.slots, and request.sessions are required';
  }
  if (days.length > LIMITS.days) return `A week can have at most ${LIMITS.days} days`;
  if (slots.length > LIMITS.slots) return `A day can have at most ${LIMITS.slots} periods`;
  if (sessions.length > LIMITS.sessions) return `A timetable can have at most ${LIMITS.sessions} classes`;
  if ((teachers?.length ?? 0) > LIMITS.listItems || (rooms?.length ?? 0) > LIMITS.listItems) return 'Too many teachers or rooms';
  if (seconds !== undefined && (typeof seconds !== 'number' || !(seconds > 0) || seconds > LIMITS.solverSeconds)) {
    return `Solving can take at most ${LIMITS.solverSeconds} seconds`;
  }
  return null;
};
