import crypto from 'node:crypto';
import net from 'node:net';

import express from 'express';
import { nanoid } from 'nanoid';

import { liveSessionsOf } from './attendance.js';
import { bearerToken, createRateLimiter, hashToken } from './auth.js';
import { localParts, scanRecorder } from './devices.js';
import { profileOf } from './members.js';

const TOKEN_PREFIX = 'tfs_';
const LINK_DAYS = 14;
const PHONE_DAYS = 365;
const DAY = 24 * 60 * 60 * 1000;
const EARLY_MINUTES = 10;
const MAX_NETWORKS = 50;
const MAX_LABEL = 60;
// Anything wider than these isn't "the department", and would let most of the internet in.
const NARROWEST = { 4: 16, 6: 32 };

const plainIp = (ip) => String(ip ?? '').trim().replace(/^::ffff:(?=\d+\.)/i, '');

/** An address or range, tidied, or null if it's invalid or too wide to mean anything. */
export const parseNetwork = (text) => {
  if (typeof text !== 'string') return null;
  const [address, prefixText, extra] = text.trim().split('/');
  const family = net.isIP(address);
  if (!family || extra !== undefined) return null;
  const whole = family === 4 ? 32 : 128;
  if (prefixText !== undefined && !/^\d{1,3}$/.test(prefixText)) return null;
  const prefix = prefixText === undefined ? whole : Number(prefixText);
  if (prefix > whole || prefix < NARROWEST[family]) return null;
  return { address, prefix, family, cidr: `${address}/${prefix}` };
};

/** The saved network this address is on, or null. */
export const networkFor = (networks, ip) => {
  const address = plainIp(ip);
  const family = net.isIP(address);
  if (!family) return null;
  return (
    (networks ?? []).find((item) => {
      const parsed = parseNetwork(item.cidr);
      if (!parsed || parsed.family !== family) return false;
      const list = new net.BlockList();
      list.addSubnet(parsed.address, parsed.prefix, family === 4 ? 'ipv4' : 'ipv6');
      return list.check(address, family === 4 ? 'ipv4' : 'ipv6');
    }) ?? null
  );
};

const minutesOf = (time) => {
  const [hours, minutes] = time.slice(0, 5).split(':').map(Number);
  return hours * 60 + minutes;
};

/** The class this student can tap in to at this moment: from just before it starts until it ends. */
export const currentClass = (sessions, division, student, local) => {
  const now = minutesOf(local.time);
  return (
    sessions.find((session) => {
      if (session.day !== local.day || session.division_id !== division.id) return false;
      if (session.batch && student.batch && session.batch !== student.batch) return false;
      if (session.batch && !student.batch) return false;
      const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})/.exec(session.slot ?? '');
      if (!match) return false;
      const start = minutesOf(match[1]);
      const end = start + (minutesOf(match[2]) - start) * (session.duration_slots || 1);
      return now >= start - EARLY_MINUTES && now < end;
    }) ?? null
  );
};

const findStudent = (institution, studentId) => {
  for (const division of profileOf(institution).divisions ?? []) {
    const student = (division.students ?? []).find((item) => item.id === studentId);
    if (student) return { student, division };
  }
  return null;
};
const newCode = () => crypto.randomBytes(32).toString('base64url');
const isLive = (pass, now) => pass && (!pass.expiresAt || new Date(pass.expiresAt).getTime() > now);

/** A student's own phone. They have no password: a one-use link ties one phone to one student. */
export const mountStudentApi = (app, { store, route, fail, now = Date.now, limits = {} }) => {
  // Keyed by address, and a whole department shares one. Codes can't be guessed, so this only stops floods.
  const linkLimiter = limits.studentLink ?? createRateLimiter({ limit: 3000, windowMs: 60 * 60 * 1000 });
  const tapLimiter = limits.studentTap ?? createRateLimiter({ limit: 30, windowMs: 60 * 1000 });
  const gone = (response) => fail(response, 410, 'This link is no longer valid. Ask your college office for a new one.');
  const json = express.json({ limit: '8kb' });

  const usableLink = async (code) => {
    if (typeof code !== 'string' || code.length > 200) return null;
    const pass = await store.getStudentPass(hashToken(code));
    if (pass?.kind !== 'link' || !isLive(pass, now())) return null;
    const institution = await store.getInstitution(pass.institutionId);
    const found = institution && (institution.status ?? 'active') === 'active' ? findStudent(institution, pass.studentId) : null;
    return found ? { pass, institution, ...found } : null;
  };

  const requireStudent = route(async (request, response, next) => {
    const token = bearerToken(request);
    const hash = token?.startsWith(TOKEN_PREFIX) ? hashToken(token) : null;
    const pass = hash ? await store.getStudentPass(hash) : null;
    const institution = pass?.kind === 'phone' && isLive(pass, now()) ? await store.getInstitution(pass.institutionId) : null;
    const found = institution && (institution.status ?? 'active') === 'active' ? findStudent(institution, pass.studentId) : null;
    if (!found) return fail(response, 401, 'This phone isn’t set up any more. Ask your college office for a new link.');
    Object.assign(request, { pass, institution, ...found });
    next();
  });

  /** Everything both the page and the tap need to know about this moment. */
  const situation = async (request) => {
    const { institution, division, student } = request;
    const settings = await store.getCheckinSettings(institution.id);
    const timeZone = profileOf(institution).institution?.timezone;
    const at = new Date(now()).toISOString();
    const local = localParts(at, timeZone);
    const network = settings.enabled ? networkFor(settings.networks, request.ip) : null;
    const session = currentClass(await liveSessionsOf(store, institution.id), division, student, local);
    const scans = session ? await store.listScans(institution.id, { date: local.date }) : [];
    const checkedIn = Boolean(session && scans.some((scan) => scan.studentId === student.id && scan.sessionId === session.id));
    const subjects = profileOf(institution).subjects ?? [];
    const subject = session ? (subjects.find((item) => item.id === session.subject_id)?.name ?? 'Class') : null;
    return { settings, at, local, network, session, checkedIn, subject };
  };

  app.get('/api/student/v1/link/:code', route(async (request, response) => {
    if (!linkLimiter.take(request.ip)) return fail(response, 429, 'Too many attempts. Try again in a little while.');
    const link = await usableLink(request.params.code);
    if (!link) return gone(response);
    response.json({ college: link.institution.name, name: link.student.name, rollNo: link.student.rollNo, className: link.division.name });
  }));

  app.post('/api/student/v1/claim', json, route(async (request, response) => {
    if (!linkLimiter.take(request.ip)) return fail(response, 429, 'Too many attempts. Try again in a little while.');
    const link = await usableLink(request.body?.code);
    // Two phones racing for one link: only one gets it.
    if (!link || !(await store.claimStudentPass(link.pass.tokenHash))) return gone(response);
    await store.deleteStudentPasses(link.pass.institutionId, link.pass.studentId, 'phone');
    const token = `${TOKEN_PREFIX}${newCode()}`;
    await store.createStudentPass({ tokenHash: hashToken(token), institutionId: link.pass.institutionId, studentId: link.pass.studentId, kind: 'phone', expiresAt: new Date(now() + PHONE_DAYS * DAY).toISOString() });
    response.status(201).json({ token });
  }));

  app.get('/api/student/v1/me', requireStudent, route(async (request, response) => {
    const { institution, division, student } = request;
    const { settings, network, session, checkedIn, subject } = await situation(request);
    response.json({
      name: student.name,
      rollNo: student.rollNo,
      className: division.name,
      college: institution.name,
      enabled: settings.enabled,
      onNetwork: Boolean(network),
      session: session ? { subject, slot: session.slot, checkedIn } : null,
    });
  }));

  app.post('/api/student/v1/checkin', requireStudent, route(async (request, response) => {
    if (!tapLimiter.take(request.pass.tokenHash)) return fail(response, 429, 'Slow down, and try again in a minute.');
    const { institution, division, student } = request;
    const { settings, at, network, session, checkedIn, subject } = await situation(request);
    if (!settings.enabled) return fail(response, 403, 'Your college has turned phone check-in off.');
    // The address comes from the connection as nginx saw it. Nothing the phone sends is believed.
    if (!network) return fail(response, 403, 'Connect to your department’s Wi-Fi, turn off mobile data and any VPN, then try again.');
    if (!session) return fail(response, 409, 'You don’t have a class right now.');
    if (checkedIn) return response.json({ status: 'already', subject, slot: session.slot });
    const record = await scanRecorder(store, institution, { source: `Phone on ${network.label}`, sourceId: `phone:${student.id}`, gate: false });
    const fresh = await record({ student, division }, at, `${session.id}|${at.slice(0, 10)}`, { sessionId: session.id });
    response.status(fresh ? 201 : 200).json({ status: fresh ? 'recorded' : 'already', subject, slot: session.slot });
  }));
};

/** After sign-in: the admin's side. */
export const mountCheckinAdmin = (app, { store, route, fail, ownedInstitution, now = Date.now }) => {
  const notFound = (response) => fail(response, 404, 'Not found');
  const students = (institution) => (profileOf(institution).divisions ?? []).flatMap((division) => (division.students ?? []).map((student) => ({ student, division })));

  const view = async (institution, request) => {
    const settings = await store.getCheckinSettings(institution.id);
    return { ...settings, yourIp: String(request.ip ?? '').replace(/^::ffff:(?=\d+\.)/i, ''), onNetwork: networkFor(settings.networks, request.ip)?.label ?? null };
  };

  app.get('/api/institutions/:id/checkin', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return notFound(response);
    response.json(await view(institution, request));
  }));

  app.put('/api/institutions/:id/checkin', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return notFound(response);
    const { enabled, networks } = request.body ?? {};
    if (typeof enabled !== 'boolean') return fail(response, 400, 'enabled must be true or false');
    if (!Array.isArray(networks) || networks.length > MAX_NETWORKS) return fail(response, 400, `Add at most ${MAX_NETWORKS} networks`);
    if (enabled && !networks.length) return fail(response, 400, 'Add your department’s network before turning this on');
    const clean = [];
    for (const item of networks) {
      const label = typeof item?.label === 'string' ? item.label.trim() : '';
      if (!label || label.length > MAX_LABEL) return fail(response, 400, `Give each network a name of at most ${MAX_LABEL} characters`);
      const parsed = parseNetwork(item.cidr);
      if (!parsed) return fail(response, 400, `“${String(item.cidr).slice(0, 60)}” isn’t a valid address, or covers too much to be one department`);
      clean.push({ id: typeof item.id === 'string' && item.id.length <= 40 ? item.id : nanoid(), label, cidr: parsed.cidr });
    }
    await store.setCheckinSettings(institution.id, { enabled, networks: clean });
    response.json(await view(institution, request));
  }));

  app.get('/api/institutions/:id/checkin/students', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return notFound(response);
    const phones = new Set((await store.listStudentPasses(institution.id, 'phone')).filter((pass) => isLive(pass, now())).map((pass) => pass.studentId));
    response.json(students(institution).map(({ student, division }) => ({ studentId: student.id, name: student.name, rollNo: student.rollNo, divisionId: division.id, divisionName: division.name, phone: phones.has(student.id) })));
  }));

  // Shown once: only a hash of each code is kept.
  app.post('/api/institutions/:id/checkin/links', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return notFound(response);
    const { studentId, divisionId } = request.body ?? {};
    const chosen = students(institution).filter(({ student, division }) => (typeof studentId === 'string' ? student.id === studentId : typeof divisionId === 'string' && division.id === divisionId));
    if (!chosen.length) return fail(response, 400, 'Choose a student or a class that has students');
    const rows = [];
    for (const { student, division } of chosen) {
      await store.deleteStudentPasses(institution.id, student.id, 'link');
      const code = newCode();
      await store.createStudentPass({ tokenHash: hashToken(code), institutionId: institution.id, studentId: student.id, kind: 'link', expiresAt: new Date(now() + LINK_DAYS * DAY).toISOString() });
      rows.push({ studentId: student.id, name: student.name, rollNo: student.rollNo, divisionId: division.id, divisionName: division.name, code });
    }
    response.status(201).json(rows);
  }));

  app.delete('/api/institutions/:id/checkin/students/:studentId', route(async (request, response) => {
    const institution = await ownedInstitution(request, request.params.id);
    if (!institution) return notFound(response);
    await store.deleteStudentPasses(institution.id, request.params.studentId);
    response.json({ success: true });
  }));
};
