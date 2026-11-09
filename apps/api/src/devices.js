import crypto from 'node:crypto';

import express from 'express';
import { nanoid } from 'nanoid';

import { attendanceOf, liveSessionsOf } from './attendance.js';
import { bearerToken, createRateLimiter, hashToken } from './auth.js';
import { profileOf } from './members.js';

const CODE_PREFIX = 'TF1';
const KEY_PREFIX = 'tfd_';
const KINDS = ['gate', 'classroom', 'integration'];
const MAX_DEVICES = 50;
const MAX_NAME = 80;
const MAX_IDENTIFIER = 200;
const MAX_BATCH = 500;
const MAX_UNMATCHED = 20;
const MAX_MINUTES_LATE = 240;
const DAY = 24 * 60 * 60 * 1000;
// Machines keep working offline, so a scan can arrive days later. A clock can run a little fast.
const OLDEST_SCAN = 14 * DAY;
const CLOCK_SLACK = 10 * 60 * 1000;
// Two reads of one card or finger, moments apart, are one scan.
const DOUBLE_TAP = 60 * 1000;
const DEFAULT_GRACE = 10;
const DEFAULT_ZONE = 'Asia/Kolkata';

/** The date, time and weekday at the college, wherever the server happens to be. */
export const localParts = (iso, timeZone = DEFAULT_ZONE) => {
  const format = (zone) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'long' });
  let formatter;
  try {
    formatter = format(timeZone);
  } catch {
    formatter = format(DEFAULT_ZONE);
  }
  const part = Object.fromEntries(formatter.formatToParts(new Date(iso)).map(({ type, value }) => [type, value]));
  return { date: `${part.year}-${part.month}-${part.day}`, time: `${part.hour}:${part.minute}`, day: part.weekday };
};

const newSecret = () => crypto.randomBytes(32).toString('base64url');
const signature = (secret, studentId) => crypto.createHmac('sha256', secret).update(studentId).digest('base64url').slice(0, 22);
export const cardCode = (secret, studentId) => `${CODE_PREFIX}.${studentId}.${signature(secret, studentId)}`;

/** The student a signed card is for, or null if it was forged, altered or retired. */
export const verifyCard = (secret, code) => {
  const first = code.indexOf('.');
  const last = code.lastIndexOf('.');
  if (first === -1 || last <= first + 1 || code.slice(0, first) !== CODE_PREFIX) return null;
  const studentId = code.slice(first + 1, last);
  const given = Buffer.from(code.slice(last + 1));
  const expected = Buffer.from(signature(secret, studentId));
  return given.length === expected.length && crypto.timingSafeEqual(given, expected) ? studentId : null;
};

const everyStudent = (institution) => (profileOf(institution).divisions ?? []).flatMap((division) => (division.students ?? []).map((student) => ({ student, division })));

/** Who a scan means. A roll number that fits two students is refused: guessing would mark the wrong one. */
export const identify = async (store, institution, identifier) => {
  const value = identifier.trim();
  const students = everyStudent(institution);
  if (value.startsWith(`${CODE_PREFIX}.`)) {
    const id = verifyCard(await store.getCardSecret(institution.id, newSecret()), value);
    return (id && students.find(({ student }) => student.id === id)) || null;
  }
  const wanted = value.toLowerCase();
  const matches = students.filter(({ student }) => String(student.rollNo ?? '').trim().toLowerCase() === wanted);
  return matches.length === 1 ? matches[0] : null;
};

const minutesOf = (time) => {
  const [hours, minutes] = time.slice(0, 5).split(':').map(Number);
  return hours * 60 + minutes;
};

/** The first class this student has on this day, or null. */
export const firstClass = (sessions, division, student, day) =>
  sessions
    .filter((session) => session.day === day && session.division_id === division.id && (!session.batch || !student.batch || session.batch === student.batch) && /^\d{2}:\d{2}/.test(session.slot ?? ''))
    .sort((a, b) => minutesOf(a.slot) - minutesOf(b.slot))[0] ?? null;

/** Saves scans for one college, remembering the day's scans so a batch costs few queries. */
const scanRecorder = async (store, institution, { source, sourceId, gate }) => {
  const profile = profileOf(institution);
  const timeZone = profile.institution?.timezone ?? DEFAULT_ZONE;
  const grace = Number.isInteger(profile.institution?.lateAfterMinutes) ? profile.institution.lateAfterMinutes : DEFAULT_GRACE;
  const sessions = gate ? await liveSessionsOf(store, institution.id) : [];
  const days = new Map();
  const scansOn = async (date) => {
    if (!days.has(date)) days.set(date, await store.listScans(institution.id, { date }));
    return days.get(date);
  };

  /** Arriving after the first class has started is a late mark, once a day, by the same rules as a teacher's. */
  const markLate = async ({ student, division }, local, session) => {
    const minutes = minutesOf(local.time) - minutesOf(session.slot);
    if (minutes <= grace) return;
    const already = await store.listEvents(institution.id, { studentId: student.id, date: local.date, kind: 'late' });
    if (already.some((event) => event.status !== 'void' && (event.slot ?? null) === session.slot)) return;
    await store.createEvent({
      id: nanoid(),
      institutionId: institution.id,
      studentId: student.id,
      studentName: student.name,
      rollNo: student.rollNo,
      divisionId: division.id,
      divisionName: division.name,
      kind: 'late',
      date: local.date,
      time: local.time,
      slot: session.slot,
      minutesLate: Math.min(minutes, MAX_MINUTES_LATE),
      note: `Scanned at ${source}`,
      status: 'reviewed',
      recordedBy: `device:${sourceId}`,
      recordedByName: source,
      createdAt: new Date().toISOString(),
    });
  };

  /** Returns false when this scan was already recorded. */
  return async (found, at, scanId) => {
    const { student, division } = found;
    const local = localParts(at, timeZone);
    const today = await scansOn(local.date);
    const instant = new Date(at).getTime();
    const own = today.filter((scan) => scan.studentId === student.id);
    const id = crypto.createHash('sha256').update(`${sourceId}|${scanId ?? `${student.id}|${at}`}`).digest('hex').slice(0, 32);
    if (own.some((scan) => scan.id === id || Math.abs(new Date(scan.at).getTime() - instant) < DOUBLE_TAP)) return false;
    const scan = { id, studentId: student.id, studentName: student.name, rollNo: student.rollNo, divisionId: division.id, divisionName: division.name, at: new Date(at).toISOString(), date: local.date, time: local.time, source, gate: Boolean(gate), createdAt: new Date().toISOString() };
    if (!(await store.addScan(institution.id, scan))) return false;
    const firstToday = !own.some((item) => item.gate && new Date(item.at).getTime() < instant);
    today.push(scan);
    if (gate && firstToday) {
      const session = firstClass(sessions, division, student, local.day);
      if (session) await markLate(found, local, session);
    }
    return true;
  };
};

const publicScan = ({ id, studentId, studentName, rollNo, divisionId, divisionName, at, date, time, source }) => ({ id, studentId, studentName, rollNo, divisionId, divisionName, at, date, time, source });

/** What other software gets: plain names instead of internal ids. */
const integrationViews = (institution) => {
  const profile = profileOf(institution);
  const nameIn = (list, id) => (list ?? []).find((item) => item.id === id)?.name ?? null;
  return {
    students: () => (profile.divisions ?? []).flatMap((division) => (division.students ?? []).map((student) => ({ id: student.id, rollNo: student.rollNo, name: student.name, class: division.name, batch: student.batch ?? null }))),
    session: (session) => ({ id: session.id, day: session.day, slot: session.slot, kind: session.kind ?? null, batch: session.batch ?? null, subject: nameIn(profile.subjects, session.subject_id), teacher: nameIn(profile.teachers, session.teacher_id), class: nameIn(profile.divisions, session.division_id), room: nameIn(profile.rooms, session.room_id) }),
    attendance: (record) => {
      const division = (profile.divisions ?? []).find((item) => item.id === record.divisionId);
      const absent = record.absentStudentIds ?? [];
      return {
        date: record.date,
        slot: record.slot,
        sessionId: record.sessionId,
        subject: nameIn(profile.subjects, record.subjectId),
        class: division?.name ?? null,
        batch: record.batch ?? null,
        takenAt: record.takenAt,
        absent: absent.map((id) => {
          const student = (division?.students ?? []).find((item) => item.id === id);
          return { id, rollNo: student?.rollNo ?? null, name: student?.name ?? null };
        }),
      };
    },
  };
};

/** Machines and other software. They hold a key, not a login, so this is mounted before the session check. */
export const mountDeviceApi = (app, { store, route, fail, limits = {} }) => {
  const limiter = limits.device ?? createRateLimiter({ limit: 600, windowMs: 60 * 1000 });

  const requireDevice = route(async (request, response, next) => {
    const key = bearerToken(request);
    const device = key?.startsWith(KEY_PREFIX) ? await store.getDeviceByKeyHash(hashToken(key)) : null;
    const institution = device ? await store.getInstitution(device.institutionId) : null;
    if (!institution || (institution.status ?? 'active') !== 'active') return fail(response, 401, 'This device key isn’t valid. Ask the college admin for a new one.');
    if (!limiter.take(device.id)) return fail(response, 429, 'Too many requests from this device. Slow down.');
    request.device = device;
    request.institution = institution;
    next();
  });
  const readOnly = route(async (request, response, next) => {
    if (request.device.kind !== 'integration') return fail(response, 403, 'This key is for scanning. Create an integration key to read data.');
    await store.updateDevice(request.device.id, { lastSeenAt: new Date().toISOString() });
    next();
  });
  const text = (value) => (typeof value === 'string' && value ? value : undefined);

  app.post('/api/device/v1/scans', express.json({ limit: '256kb' }), requireDevice, route(async (request, response) => {
    const { device, institution } = request;
    if (device.kind === 'integration') return fail(response, 403, 'This key can read data but not record scans.');
    const { scans } = request.body ?? {};
    if (!Array.isArray(scans) || !scans.length || scans.length > MAX_BATCH) return fail(response, 400, `Send 1 to ${MAX_BATCH} scans`);
    const now = Date.now();
    const checked = [];
    for (const scan of scans) {
      const identifier = scan?.identifier;
      if (typeof identifier !== 'string' || !identifier.trim() || identifier.length > MAX_IDENTIFIER) return fail(response, 400, 'Every scan needs an identifier');
      if (scan.scanId !== undefined && (typeof scan.scanId !== 'string' || scan.scanId.length > 100)) return fail(response, 400, 'scanId must be short text');
      const at = scan.at === undefined ? now : typeof scan.at === 'string' ? Date.parse(scan.at) : Number.NaN;
      if (Number.isNaN(at)) return fail(response, 400, 'at must be a date and time');
      if (at > now + CLOCK_SLACK) return fail(response, 400, 'A scan is in the future. Check the machine’s clock.');
      if (at < now - OLDEST_SCAN) return fail(response, 400, 'A scan is too old to accept.');
      checked.push({ identifier, scanId: scan.scanId, at: new Date(at).toISOString() });
    }
    // Oldest first, so someone's real arrival decides whether they were late.
    checked.sort((a, b) => a.at.localeCompare(b.at));
    const record = await scanRecorder(store, institution, { source: device.name, sourceId: device.id, gate: device.kind === 'gate' });
    let accepted = 0;
    let duplicates = 0;
    const unmatched = new Set();
    for (const scan of checked) {
      const found = await identify(store, institution, scan.identifier);
      if (!found) unmatched.add(scan.identifier);
      else if (await record(found, scan.at, scan.scanId)) accepted += 1;
      else duplicates += 1;
    }
    const missed = [...unmatched];
    await store.updateDevice(device.id, { lastSeenAt: new Date().toISOString(), unmatched: [...new Set([...missed, ...(device.unmatched ?? [])])].slice(0, MAX_UNMATCHED) });
    response.json({ accepted, duplicates, unmatched: missed });
  }));

  app.get('/api/integration/v1/students', requireDevice, readOnly, route(async (request, response) => {
    response.json(integrationViews(request.institution).students());
  }));
  app.get('/api/integration/v1/timetable', requireDevice, readOnly, route(async (request, response) => {
    response.json((await liveSessionsOf(store, request.institution.id)).map(integrationViews(request.institution).session));
  }));
  app.get('/api/integration/v1/attendance', requireDevice, readOnly, route(async (request, response) => {
    const { date, from, to } = request.query;
    const records = await attendanceOf(store, request.institution, { date: text(date) });
    const inRange = records.filter((record) => (!text(from) || record.date >= from) && (!text(to) || record.date <= to));
    response.json(inRange.map(integrationViews(request.institution).attendance));
  }));
  app.get('/api/integration/v1/events', requireDevice, readOnly, route(async (request, response) => {
    const events = await store.listEvents(request.institution.id, { date: text(request.query.date) });
    response.json(events.filter((event) => event.status !== 'void').map(({ id, studentId, studentName, rollNo, divisionName, kind, date, time, slot, minutesLate, note, status, outcome, recordedByName }) => ({ id, studentId, studentName, rollNo, class: divisionName, kind, date, time, slot, minutesLate, note, status, outcome, recordedByName })));
  }));
};

/** After sign-in: cards, scanning from the app, and an admin managing devices. */
export const mountDevices = (app, { store, route, fail, memberAccess, ownedInstitution, limits = {} }) => {
  const limiter = limits.scans ?? createRateLimiter({ limit: 6000, windowMs: 60 * 60 * 1000 });
  const notFound = (response) => fail(response, 404, 'Not found');
  const publicDevice = ({ id, name, kind, createdAt, lastSeenAt, unmatched }) => ({ id, name, kind, createdAt, lastSeenAt: lastSeenAt ?? null, unmatched: unmatched ?? [] });

  app.get('/api/institutions/:id/cards', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return notFound(response);
    const secret = await store.getCardSecret(institution.id, newSecret());
    const { divisionId } = request.query;
    const cards = everyStudent(institution)
      .filter(({ division }) => !divisionId || division.id === divisionId)
      .map(({ student, division }) => ({ studentId: student.id, name: student.name, rollNo: student.rollNo, divisionId: division.id, divisionName: division.name, code: cardCode(secret, student.id) }));
    response.json(cards);
  }));

  // For lost cards: every printed card stops working and new ones must be printed.
  app.post('/api/institutions/:id/cards/rotate', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return notFound(response);
    await store.setCardSecret(institution.id, newSecret());
    response.json({ success: true });
  }));

  app.post('/api/institutions/:id/scans', route(async (request, response) => {
    const access = await memberAccess(request, request.params.id);
    if (!access) return notFound(response);
    if (!limiter.take(request.account.id)) return fail(response, 429, 'That is a lot of scans in a short time. Give it a while.');
    const { identifier, purpose } = request.body ?? {};
    if (typeof identifier !== 'string' || !identifier.trim() || identifier.length > MAX_IDENTIFIER) return fail(response, 400, 'Scan a card or type a roll number');
    const found = await identify(store, access.institution, identifier);
    if (!found) return response.json({ matched: false });
    const record = await scanRecorder(store, access.institution, { source: request.account.name, sourceId: request.account.id, gate: purpose === 'gate' });
    const fresh = await record(found, new Date().toISOString());
    const { student, division } = found;
    response.status(201).json({ matched: true, duplicate: !fresh, student: { id: student.id, name: student.name, rollNo: student.rollNo, divisionId: division.id, divisionName: division.name } });
  }));

  app.get('/api/institutions/:id/scans', route(async (request, response) => {
    const access = await memberAccess(request, request.params.id);
    if (!access) return notFound(response);
    const { date } = request.query;
    const day = typeof date === 'string' && date ? date : localParts(new Date().toISOString(), profileOf(access.institution).institution?.timezone).date;
    response.json((await store.listScans(access.institution.id, { date: day })).map(publicScan));
  }));

  app.post('/api/institutions/:id/devices', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return notFound(response);
    const { name, kind } = request.body ?? {};
    if (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_NAME) return fail(response, 400, `Give it a name of at most ${MAX_NAME} characters`);
    if (!KINDS.includes(kind)) return fail(response, 400, `kind must be one of ${KINDS.join(', ')}`);
    if ((await store.listDevices(institution.id)).length >= MAX_DEVICES) return fail(response, 409, `A college can have at most ${MAX_DEVICES} devices`);
    const key = `${KEY_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
    const device = await store.createDevice({ id: nanoid(), institutionId: institution.id, keyHash: hashToken(key), name: name.trim(), kind, createdAt: new Date().toISOString(), lastSeenAt: null, unmatched: [] });
    // Shown once. Only its hash is kept, so it can't be looked up again.
    response.status(201).json({ ...publicDevice(device), key });
  }));

  app.get('/api/institutions/:id/devices', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return notFound(response);
    response.json((await store.listDevices(institution.id)).map(publicDevice));
  }));

  app.delete('/api/institutions/:id/devices/:deviceId', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return notFound(response);
    await store.deleteDevice(request.params.deviceId, institution.id);
    response.json({ success: true });
  }));
};
