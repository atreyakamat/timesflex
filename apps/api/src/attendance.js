import { nanoid } from 'nanoid';

import { profileOf } from './members.js';

const DAY = 24 * 60 * 60 * 1000;
const dateKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const MAX_ABSENT = 2000;

/** Day-to-day records live beside the profile, or inside it on a college that has never saved. */
export const operationsOf = (institution) => institution?.data?.operations ?? profileOf(institution).operations ?? {};

const keyOf = (record) => `${record.date}|${record.sessionId}`;

/** Older records were saved inside the college's profile. A record in the table always wins. */
export const mergeAttendance = (older = [], stored = []) => {
  const taken = new Set(stored.map(keyOf));
  return [...older.filter((record) => !taken.has(keyOf(record))), ...stored];
};

/** All of a college's attendance, however it was saved. */
export const attendanceOf = async (store, institution, { date } = {}) => {
  const older = (operationsOf(institution).attendance ?? []).filter((record) => !date || record.date === date);
  return mergeAttendance(older, await store.listAttendance(institution.id, { date }));
};

/** The college as its admin's app should see it, with attendance taken by anyone included. */
export const withAttendance = async (store, institution) => {
  const stored = await store.listAttendance(institution.id);
  if (!stored.length) return institution;
  const data = institution.data ?? {};
  const holder = data.profile ?? data;
  const operations = { ...(holder.operations ?? {}), attendance: mergeAttendance(operationsOf(institution).attendance ?? [], stored) };
  return { ...institution, data: data.profile ? { ...data, profile: { ...holder, operations } } : { ...data, operations } };
};

/** What the app sends when saving: anything the table already holds doesn't need a second copy. */
export const olderOnly = async (store, institutionId, incoming) => {
  const stored = await store.listAttendance(institutionId);
  const taken = new Set(stored.map(keyOf));
  return { older: incoming.filter((record) => !taken.has(keyOf(record))), stored };
};

export const liveSessionsOf = async (store, institutionId) => (await store.listTimetables(institutionId)).find((timetable) => timetable.status === 'approved')?.generatedSessions ?? [];

/** Whether this person may take the register for this class on this date. */
export const canTake = (access, session, date) => {
  if (access.role === 'admin') return true;
  if (!access.teacherId) return false;
  if (session.teacher_id === access.teacherId) return true;
  return (operationsOf(access.institution).substitutions ?? []).some((item) => item.date === date && item.sessionId === session.id && item.substituteTeacherId === access.teacherId);
};

const dateProblem = (date, now = Date.now()) => {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return 'Choose a valid date';
  // A day's slack, since the server and college may be in different time zones.
  if (date > dateKey(now + DAY)) return 'Attendance can’t be in the future';
  if (date < dateKey(now - 60 * DAY)) return 'Attendance can only go back 60 days';
  return null;
};

export const mountAttendance = (app, { store, route, fail, memberAccess }) => {
  const notFound = (response) => fail(response, 404, 'Not found');

  /** A class in the college's timetable. The admin can also reach a version not yet approved. */
  const findSession = async (access, sessionId) => {
    const timetables = await store.listTimetables(access.institution.id);
    const approved = timetables.filter((timetable) => timetable.status === 'approved');
    const reachable = access.role === 'admin' ? [...approved, ...timetables.filter((timetable) => timetable.status !== 'approved')] : approved;
    for (const timetable of reachable) {
      const session = (timetable.generatedSessions ?? []).find((item) => item.id === sessionId);
      if (session) return session;
    }
    return null;
  };

  app.post('/api/institutions/:id/attendance', route(async (request, response) => {
    const access = await memberAccess(request, request.params.id);
    if (!access) return notFound(response);
    const { date, sessionId, absentStudentIds } = request.body ?? {};
    const problem = dateProblem(date);
    if (problem) return fail(response, 400, problem);
    if (typeof sessionId !== 'string') return fail(response, 400, 'Choose a class');
    if (!Array.isArray(absentStudentIds) || absentStudentIds.length > MAX_ABSENT || !absentStudentIds.every((id) => typeof id === 'string')) return fail(response, 400, 'The list of absent students isn’t right');

    const session = await findSession(access, sessionId);
    if (!session) return notFound(response);
    if (!canTake(access, session, date)) return fail(response, 403, 'This isn’t your class. Ask the office if you’re covering it.');

    const division = (profileOf(access.institution).divisions ?? []).find((item) => item.id === session.division_id);
    const onRoster = new Set((division?.students ?? []).map((student) => student.id));
    if (!absentStudentIds.every((id) => onRoster.has(id))) return fail(response, 400, 'Someone on that list isn’t in this class.');

    const record = {
      id: nanoid(),
      date,
      sessionId: session.id,
      subjectId: session.subject_id,
      divisionId: session.division_id,
      ...(session.batch ? { batch: session.batch } : {}),
      slot: session.slot,
      absentStudentIds: [...new Set(absentStudentIds)],
      takenAt: new Date().toISOString(),
      takenBy: request.account.id,
      takenByName: request.account.name,
    };
    await store.upsertAttendance(access.institution.id, record);
    response.status(201).json(record);
  }));

  app.get('/api/institutions/:id/attendance', route(async (request, response) => {
    const access = await memberAccess(request, request.params.id);
    if (!access) return notFound(response);
    const date = typeof request.query.date === 'string' && request.query.date ? request.query.date : undefined;
    const all = await attendanceOf(store, access.institution, { date });
    if (access.role === 'admin') return response.json(all);
    // A teacher sees their own classes, and whatever they took themselves.
    const sessions = await liveSessionsOf(store, access.institution.id);
    const mine = new Set(sessions.filter((session) => access.teacherId && session.teacher_id === access.teacherId).map((session) => session.id));
    response.json(all.filter((record) => mine.has(record.sessionId) || record.takenBy === request.account.id));
  }));
};
