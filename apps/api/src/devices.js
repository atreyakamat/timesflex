import crypto from 'node:crypto';

import express from 'express';
import { nanoid } from 'nanoid';

import { attendanceOf, liveSessionsOf } from './attendance.js';
import { bearerToken, createRateLimiter, hashToken } from './auth.js';
import { profileOf } from './members.js';
import { parsePunches } from './punchfile.js';

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
const MAX_READER_LINKS = 5000;
const MAX_IMPORT = 20000;
// An exported file can cover a whole term.
const OLDEST_IMPORT = 62 * DAY;

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

/** "YYYY-MM-DD HH:MM:SS" on the college's clock, as a UTC instant. Machines report time with no zone. */
export const zonedToUtc = (local, timeZone = DEFAULT_ZONE) => {
  const [y, mo, d, h, mi, s] = local.split(/[- :]/).map(Number);
  const asIfUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const format = (zone) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let formatter;
  try {
    formatter = format(timeZone);
  } catch {
    formatter = format(DEFAULT_ZONE);
  }
  // How far the zone is from UTC at a given moment, which changes with summer time.
  const offsetAt = (ms) => {
    const p = Object.fromEntries(formatter.formatToParts(new Date(ms)).map(({ type, value }) => [type, Number(value)]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
  };
  const first = asIfUtc - offsetAt(asIfUtc);
  return new Date(asIfUtc - offsetAt(first)).toISOString();
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

/**
 * Works out who a scan means: a signed card, a machine ID the admin linked, or a roll number.
 * A roll number that fits two students is refused: guessing would mark the wrong one.
 * Loads the college's lists once, so a batch of thousands stays quick.
 */
export const makeResolver = async (store, institution) => {
  const students = everyStudent(institution);
  const byId = new Map(students.map((entry) => [entry.student.id, entry]));
  const linked = new Map((await store.listReaderIds(institution.id)).map((row) => [row.readerId.toLowerCase(), row.studentId]));
  const byRoll = new Map();
  for (const entry of students) {
    const roll = String(entry.student.rollNo ?? '').trim().toLowerCase();
    if (roll) byRoll.set(roll, byRoll.has(roll) ? null : entry);
  }
  let secret = null;
  return async (identifier) => {
    const value = identifier.trim();
    if (value.startsWith(`${CODE_PREFIX}.`)) {
      secret ??= await store.getCardSecret(institution.id, newSecret());
      const id = verifyCard(secret, value);
      return (id && byId.get(id)) || null;
    }
    const wanted = value.toLowerCase();
    if (linked.has(wanted)) return byId.get(linked.get(wanted)) ?? null;
    return byRoll.get(wanted) ?? null;
  };
};
export const identify = async (store, institution, identifier) => (await makeResolver(store, institution))(identifier);

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
    const resolve = await makeResolver(store, institution);
    let accepted = 0;
    let duplicates = 0;
    const unmatched = new Set();
    for (const scan of checked) {
      const found = await resolve(scan.identifier);
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
    // An ID linked since it was reported isn't a problem any more.
    const resolve = await makeResolver(store, institution);
    const devices = await store.listDevices(institution.id);
    for (const device of devices) {
      const still = [];
      for (const id of device.unmatched ?? []) if (!(await resolve(id))) still.push(id);
      device.unmatched = still;
    }
    response.json(devices.map(publicDevice));
  }));

  /* ---------- Machine IDs: when the ID on a fingerprint machine isn't a roll number ---------- */

  app.get('/api/institutions/:id/reader-ids', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return notFound(response);
    const students = new Map(everyStudent(institution).map((entry) => [entry.student.id, entry]));
    const rows = await store.listReaderIds(institution.id);
    response.json(
      rows
        .map(({ readerId, studentId }) => {
          const entry = students.get(studentId);
          return { readerId, studentId, name: entry?.student.name ?? null, rollNo: entry?.student.rollNo ?? null, className: entry?.division.name ?? null };
        })
        .sort((a, b) => a.readerId.localeCompare(b.readerId, undefined, { numeric: true })),
    );
  }));

  app.post('/api/institutions/:id/reader-ids', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return notFound(response);
    const { links, text } = request.body ?? {};
    const students = everyStudent(institution);
    const known = new Set(students.map((entry) => entry.student.id));
    const pairs = [];
    const problems = [];
    const readerIdOk = (value) => typeof value === 'string' && value.trim() && value.trim().length <= 100;
    if (Array.isArray(links)) {
      if (links.length > MAX_READER_LINKS) return fail(response, 400, `At most ${MAX_READER_LINKS} at once`);
      for (const item of links) {
        if (!readerIdOk(item?.readerId) || !known.has(item?.studentId)) return fail(response, 400, 'Each link needs a machine ID and one of your students');
        pairs.push({ readerId: item.readerId.trim(), studentId: item.studentId });
      }
    } else if (typeof text === 'string') {
      // "machine ID, roll number", one per line, pasted from a spreadsheet.
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length > MAX_READER_LINKS) return fail(response, 400, `At most ${MAX_READER_LINKS} lines at once`);
      for (const line of lines) {
        const [readerId, roll] = line.split(/[\t,;]/).map((cell) => cell.trim().replace(/^"(.*)"$/, '$1'));
        if (!readerIdOk(readerId) || !roll) {
          problems.push({ line, reason: 'Write the machine ID, then the roll number' });
          continue;
        }
        const matches = students.filter((entry) => String(entry.student.rollNo ?? '').trim().toLowerCase() === roll.toLowerCase());
        if (matches.length !== 1) {
          problems.push({ line, reason: matches.length ? 'That roll number is used by more than one student. Link this one by picking the student.' : 'No student has that roll number' });
          continue;
        }
        pairs.push({ readerId, studentId: matches[0].student.id });
      }
    } else return fail(response, 400, 'Send links, or lines of "machine ID, roll number"');
    if (pairs.length) await store.setReaderIds(institution.id, pairs);
    response.json({ saved: pairs.length, problems });
  }));

  app.delete('/api/institutions/:id/reader-ids/:readerId', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return notFound(response);
    await store.deleteReaderId(institution.id, request.params.readerId);
    response.json({ success: true });
  }));

  /* ---------- Importing a file a machine or its software exported ---------- */

  app.post('/api/institutions/:id/scans/import', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return notFound(response);
    if (!limiter.take(request.account.id)) return fail(response, 429, 'That is a lot of imports in a short time. Give it a while.');
    const { text, kind = 'classroom', name = 'import', dryRun } = request.body ?? {};
    if (typeof text !== 'string' || !text.trim()) return fail(response, 400, 'Choose a file, or paste its contents');
    if (!['gate', 'classroom'].includes(kind)) return fail(response, 400, 'kind must be gate or classroom');
    if (typeof name !== 'string' || name.length > 120) return fail(response, 400, 'The file name is too long');
    const { punches, skipped, unreadable } = parsePunches(text);
    if (!punches.length) return fail(response, 400, 'We couldn’t find anyone’s ID and a date and time in that file. Check it’s the attendance log, saved as CSV or text.');
    if (punches.length > MAX_IMPORT) return fail(response, 400, `That file has ${punches.length} punches. Import at most ${MAX_IMPORT} at a time, for example a month.`);

    const timeZone = profileOf(institution).institution?.timezone ?? DEFAULT_ZONE;
    const resolve = await makeResolver(store, institution);
    const now = Date.now();
    const unmatched = new Set();
    const usable = [];
    let outOfRange = 0;
    for (const punch of punches) {
      const at = zonedToUtc(punch.time, timeZone);
      const ms = Date.parse(at);
      if (ms > now + CLOCK_SLACK || ms < now - OLDEST_IMPORT) {
        outOfRange += 1;
        continue;
      }
      const found = await resolve(punch.id);
      if (!found) unmatched.add(punch.id);
      usable.push({ punch, at, found });
    }
    const matched = usable.filter((item) => item.found);
    const summary = { readable: punches.length, matched: matched.length, unmatched: [...unmatched].slice(0, 50), unmatchedCount: unmatched.size, skipped, unreadable, outOfRange };
    if (dryRun) {
      const rows = usable.slice(0, 8).map(({ punch, found }) => ({ id: punch.id, time: punch.time, name: found?.student.name ?? null, className: found?.division.name ?? null }));
      return response.json({ ...summary, rows });
    }
    // One fixed source per college, so importing the same file twice adds nothing.
    const record = await scanRecorder(store, institution, { source: `File: ${name}`, sourceId: `import:${institution.id}`, gate: kind === 'gate' });
    matched.sort((a, b) => a.at.localeCompare(b.at));
    let accepted = 0;
    for (const { punch, at, found } of matched) if (await record(found, at, `${punch.id}|${punch.time}`)) accepted += 1;
    response.json({ ...summary, accepted, duplicates: matched.length - accepted });
  }));

  app.delete('/api/institutions/:id/devices/:deviceId', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return notFound(response);
    await store.deleteDevice(request.params.deviceId, institution.id);
    response.json({ success: true });
  }));
};
