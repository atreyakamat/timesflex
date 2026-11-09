import { nanoid } from 'nanoid';

import { createRateLimiter } from './auth.js';
import { profileOf } from './members.js';

const KINDS = ['late', 'outside', 'bunked', 'other'];
const FLAGS = ['outside', 'bunked'];
const MAX_NOTE = 1000;
const MAX_MINUTES = 240;
const DAY = 24 * 60 * 60 * 1000;
const dateKey = (ms) => new Date(ms).toISOString().slice(0, 10);

/** What's wrong with a mark, in plain words, or null when it's fine. */
export const eventProblem = ({ kind, date, minutesLate, note, time, slot }, now = Date.now()) => {
  if (!KINDS.includes(kind)) return 'Choose what to mark';
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return 'Choose a valid date';
  // A day's slack either way, since the server and college may be in different time zones.
  if (date > dateKey(now + DAY)) return 'A mark can’t be in the future';
  if (date < dateKey(now - 60 * DAY)) return 'Marks can only go back 60 days';
  if (note !== undefined && typeof note !== 'string') return 'The remark must be text';
  if ((note ?? '').length > MAX_NOTE) return `Remarks can be at most ${MAX_NOTE} characters`;
  if (kind === 'other' && !note?.trim()) return 'Write the remark';
  if (kind === 'late' && minutesLate !== undefined && (!Number.isInteger(minutesLate) || minutesLate < 1 || minutesLate > MAX_MINUTES)) return `Minutes late must be 1 to ${MAX_MINUTES}`;
  if (time !== undefined && (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time))) return 'Choose a valid time';
  if (slot !== undefined && (typeof slot !== 'string' || slot.length > 40)) return 'Choose a valid period';
  return null;
};

/** The student's record from the college's saved class lists. Never from the request. */
const findOnRoster = (institution, studentId) => {
  for (const division of profileOf(institution).divisions ?? []) {
    const student = (division.students ?? []).find((item) => item.id === studentId);
    if (student) return { student, division };
  }
  return null;
};

export const mountEvents = (app, { store, route, fail, memberAccess, limits = {} }) => {
  const limiter = limits.events ?? createRateLimiter({ limit: 600, windowMs: 60 * 60 * 1000 });
  const notFound = (response) => fail(response, 404, 'Not found');

  /** The event, if this account's college holds it. */
  const reachable = async (request, id) => {
    const event = await store.getEvent(id);
    if (!event) return null;
    const access = await memberAccess(request, event.institutionId);
    return access ? { event, access } : null;
  };
  const publicEvent = ({ institutionId, ...event }) => event;

  app.get('/api/institutions/:id/classroom', route(async (request, response) => {
    const access = await memberAccess(request, request.params.id);
    if (!access) return notFound(response);
    const profile = profileOf(access.institution);
    const named = (list) => (list ?? []).map(({ id, name }) => ({ id, name }));
    const timetables = await store.listTimetables(access.institution.id);
    const { startTime, endTime, slotDurationMinutes, breakAfterSlots, breakDurationMinutes, workingDays } = profile.institution ?? {};
    // A plain list of what a teacher needs. Anything added to the profile later stays private by default.
    response.json({
      name: access.institution.name,
      role: access.role,
      teacherId: access.teacherId,
      institution: { name: access.institution.name, type: access.institution.type, startTime, endTime, slotDurationMinutes, breakAfterSlots, breakDurationMinutes, workingDays },
      teachers: named(profile.teachers),
      subjects: named(profile.subjects),
      rooms: named(profile.rooms),
      divisions: (profile.divisions ?? []).map(({ id, name, batches, year, branch, group, size, students }) => ({
        id,
        name,
        batches: batches ?? [],
        year,
        branch,
        group,
        size,
        students: (students ?? []).map((s) => ({ id: s.id, rollNo: s.rollNo, name: s.name, ...(s.batch ? { batch: s.batch } : {}) })),
      })),
      sessions: timetables.find((t) => t.status === 'approved')?.generatedSessions ?? [],
    });
  }));

  app.post('/api/institutions/:id/events', route(async (request, response) => {
    const access = await memberAccess(request, request.params.id);
    if (!access) return notFound(response);
    if (!limiter.take(request.account.id)) return fail(response, 429, 'That is a lot of marks in a short time. Give it a while.');

    const { studentId, kind, date, minutesLate, note, time, slot } = request.body ?? {};
    const problem = eventProblem({ kind, date, minutesLate, note, time, slot });
    if (problem) return fail(response, 400, problem);
    const found = findOnRoster(access.institution, studentId);
    if (!found) return fail(response, 400, 'That student isn’t on your class lists. If you just added them, wait a moment for it to save.');

    // Tapping late twice for one class is one late.
    if (kind === 'late') {
      const same = (await store.listEvents(access.institution.id, { studentId, date, kind })).find((e) => e.status !== 'void' && (e.slot ?? null) === (slot ?? null));
      if (same) return response.status(200).json(publicEvent(same));
    }
    const event = await store.createEvent({
      id: nanoid(),
      institutionId: access.institution.id,
      studentId,
      studentName: found.student.name,
      rollNo: found.student.rollNo,
      divisionId: found.division.id,
      divisionName: found.division.name,
      kind,
      date,
      ...(time ? { time } : {}),
      ...(slot ? { slot } : {}),
      ...(kind === 'late' && minutesLate ? { minutesLate } : {}),
      note: (note ?? '').trim(),
      // A late mark is a record; a flag waits for someone to look at it.
      status: FLAGS.includes(kind) ? 'open' : 'reviewed',
      recordedBy: request.account.id,
      recordedByName: request.account.name,
      createdAt: new Date().toISOString(),
    });
    response.status(201).json(publicEvent(event));
  }));

  app.get('/api/institutions/:id/events', route(async (request, response) => {
    const access = await memberAccess(request, request.params.id);
    if (!access) return notFound(response);
    const { studentId, kind, status, date } = request.query;
    const text = (value) => (typeof value === 'string' && value ? value : undefined);
    const events = await store.listEvents(access.institution.id, {
      studentId: text(studentId),
      kind: text(kind),
      status: text(status),
      date: text(date),
      // A teacher only ever sees what they recorded, whatever they ask for.
      ...(access.role === 'admin' ? {} : { recordedBy: request.account.id }),
    });
    response.json(events.map(publicEvent));
  }));

  app.put('/api/events/:id', route(async (request, response) => {
    const found = await reachable(request, request.params.id);
    if (!found || found.access.role !== 'admin') return notFound(response);
    const { status, outcome } = request.body ?? {};
    if (status !== 'open' && status !== 'reviewed') return fail(response, 400, 'status must be open or reviewed');
    if (outcome !== undefined && (typeof outcome !== 'string' || outcome.length > MAX_NOTE)) return fail(response, 400, `Outcomes can be at most ${MAX_NOTE} characters`);
    if (found.event.status === 'void') return fail(response, 409, 'This mark was voided.');
    const event = { ...found.event, status, ...(outcome !== undefined ? { outcome: outcome.trim() } : {}), reviewedByName: request.account.name, reviewedAt: new Date().toISOString() };
    await store.updateEvent(event.id, event);
    response.json(publicEvent(event));
  }));

  // Wrong marks are voided with a reason, so the record of what happened stays.
  app.post('/api/events/:id/void', route(async (request, response) => {
    const found = await reachable(request, request.params.id);
    if (!found) return notFound(response);
    const isAdmin = found.access.role === 'admin';
    if (!isAdmin && found.event.recordedBy !== request.account.id) return notFound(response);
    if (!isAdmin && found.event.reviewedAt) return fail(response, 409, 'This has been reviewed. Ask an admin to change it.');
    const reason = request.body?.reason;
    if (reason !== undefined && (typeof reason !== 'string' || reason.length > MAX_NOTE)) return fail(response, 400, 'The reason is too long');
    const event = { ...found.event, status: 'void', voidedByName: request.account.name, voidedAt: new Date().toISOString(), ...(reason ? { voidReason: reason.trim() } : {}) };
    await store.updateEvent(event.id, event);
    response.json(publicEvent(event));
  }));

};
