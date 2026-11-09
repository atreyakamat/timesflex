import fs from 'node:fs/promises';
import path from 'node:path';

import pg from 'pg';
import { nanoid } from 'nanoid';

const { Pool } = pg;

const schema = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS institutions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE institutions ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES accounts (id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS institutions_owner ON institutions (owner_id);

CREATE TABLE IF NOT EXISTS timetables (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  label TEXT,
  status TEXT NOT NULL,
  request JSONB NOT NULL,
  generated_sessions JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_institution FOREIGN KEY (institution_id) REFERENCES institutions (id)
);

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notices_institution ON notices (institution_id, created_at DESC);

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS platform_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS contact TEXT;

CREATE TABLE IF NOT EXISTS memberships (
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  institution_id TEXT NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  teacher_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, institution_id)
);
CREATE INDEX IF NOT EXISTS memberships_institution ON memberships (institution_id);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  institution_id TEXT NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  teacher_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_by TEXT
);

CREATE TABLE IF NOT EXISTS student_events (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS student_events_institution ON student_events (institution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS student_events_student ON student_events (institution_id, student_id);

CREATE TABLE IF NOT EXISTS message_links (
  message_id TEXT PRIMARY KEY,
  notice_id TEXT NOT NULL REFERENCES notices (id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL
);
`;

const toAccount = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  passwordHash: row.password_hash,
  platformAdmin: row.platform_admin === true,
  createdAt: row.created_at,
});

const toInstitution = (row) => ({
  id: row.id,
  ownerId: row.owner_id,
  status: row.status ?? 'active',
  contact: row.contact ?? null,
  name: row.name,
  type: row.type,
  data: row.data,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toTimetable = (row) => ({
  id: row.id,
  institutionId: row.institution_id,
  label: row.label,
  status: row.status,
  request: row.request,
  generatedSessions: row.generated_sessions,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toMember = (row) => ({ accountId: row.account_id, institutionId: row.institution_id, role: row.role, teacherId: row.teacher_id });
const toInvite = (row) => ({
  id: row.id,
  tokenHash: row.token_hash,
  institutionId: row.institution_id,
  role: row.role,
  teacherId: row.teacher_id,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  usedAt: row.used_at,
  usedBy: row.used_by,
});
const toEvent = (row) => ({ ...row.data, id: row.id, institutionId: row.institution_id });

const MAX_EVENTS = 2000;
/** The same filtering for both stores. */
const matchesEvent = ({ studentId, kind, status, date, recordedBy }) => (event) =>
  (!studentId || event.studentId === studentId) && (!kind || event.kind === kind) && (!status || event.status === status) && (!date || event.date === date) && (!recordedBy || event.recordedBy === recordedBy);

/** Thrown by createAccount when the e-mail is taken. */
export class DuplicateEmailError extends Error {
  constructor() {
    super('An account with this e-mail already exists');
  }
}

/**
 * Both stores expose the same async interface, so the API does not care
 * whether it runs against PostgreSQL or the zero-setup local JSON file.
 */
export const createPgStore = async (connectionString) => {
  const pool = new Pool({ connectionString });
  // A dropped idle connection must not take the API down. The pool reconnects on the next query.
  pool.on('error', (error) => console.warn('Database connection lost:', error.message));

  // The database may still be starting.
  let client;
  for (let attempt = 1; !client; attempt += 1) {
    try {
      client = await pool.connect();
    } catch (error) {
      if (attempt >= 30) throw new Error(`Could not reach the database: ${error.message}`);
      console.warn(`Waiting for the database (${attempt}): ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  try {
    // One at a time: two copies starting together would collide creating the same tables.
    await client.query('SELECT pg_advisory_lock(727001)');
    try {
      await client.query(schema);
    } finally {
      await client.query('SELECT pg_advisory_unlock(727001)');
    }
  } finally {
    client.release();
  }

  const getTimetable = async (id) => {
    const result = await pool.query('SELECT * FROM timetables WHERE id = $1', [id]);
    return result.rows[0] ? toTimetable(result.rows[0]) : null;
  };

  return {
    kind: 'postgres',
    async createAccount({ name, email, passwordHash }) {
      try {
        const result = await pool.query(
          'INSERT INTO accounts (id, name, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING *',
          [nanoid(), name, email, passwordHash],
        );
        return toAccount(result.rows[0]);
      } catch (error) {
        if (error.code === '23505') throw new DuplicateEmailError();
        throw error;
      }
    },
    close: () => pool.end(),
    async setPlatformAdmin(id, value) {
      await pool.query('UPDATE accounts SET platform_admin = $1 WHERE id = $2', [value, id]);
    },
    async addMember({ accountId, institutionId, role, teacherId }) {
      await pool.query(
        `INSERT INTO memberships (account_id, institution_id, role, teacher_id) VALUES ($1, $2, $3, $4)
         ON CONFLICT (account_id, institution_id) DO UPDATE SET role = $3, teacher_id = $4`,
        [accountId, institutionId, role, teacherId ?? null],
      );
    },
    async getMembership(accountId, institutionId) {
      const result = await pool.query('SELECT * FROM memberships WHERE account_id = $1 AND institution_id = $2', [accountId, institutionId]);
      return result.rows[0] ? toMember(result.rows[0]) : null;
    },
    async listMemberships(accountId) {
      const result = await pool.query('SELECT * FROM memberships WHERE account_id = $1 ORDER BY created_at DESC', [accountId]);
      return result.rows.map(toMember);
    },
    async listMembers(institutionId) {
      const result = await pool.query('SELECT * FROM memberships WHERE institution_id = $1 ORDER BY created_at', [institutionId]);
      return result.rows.map(toMember);
    },
    async removeMember(accountId, institutionId) {
      await pool.query('DELETE FROM memberships WHERE account_id = $1 AND institution_id = $2', [accountId, institutionId]);
    },
    async createInvite(invite) {
      await pool.query(
        'INSERT INTO invites (id, token_hash, institution_id, role, teacher_id, created_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [invite.id, invite.tokenHash, invite.institutionId, invite.role, invite.teacherId, invite.createdBy, invite.expiresAt],
      );
    },
    async getInvite(tokenHash) {
      const result = await pool.query('SELECT * FROM invites WHERE token_hash = $1', [tokenHash]);
      return result.rows[0] ? toInvite(result.rows[0]) : null;
    },
    async claimInvite(tokenHash, accountId) {
      const result = await pool.query('UPDATE invites SET used_at = NOW(), used_by = $1 WHERE token_hash = $2 AND used_at IS NULL RETURNING id', [accountId, tokenHash]);
      return result.rowCount === 1;
    },
    async listInvites(institutionId) {
      const result = await pool.query('SELECT * FROM invites WHERE institution_id = $1 ORDER BY created_at DESC', [institutionId]);
      return result.rows.map(toInvite);
    },
    async deleteInvite(id, institutionId) {
      await pool.query('DELETE FROM invites WHERE id = $1 AND institution_id = $2', [id, institutionId]);
    },
    async deleteUnusedInvites(institutionId, teacherId) {
      await pool.query('DELETE FROM invites WHERE institution_id = $1 AND teacher_id IS NOT DISTINCT FROM $2 AND used_at IS NULL', [institutionId, teacherId]);
    },
    async createEvent({ id, institutionId, studentId, ...rest }) {
      const data = { studentId, ...rest };
      await pool.query('INSERT INTO student_events (id, institution_id, student_id, data) VALUES ($1, $2, $3, $4)', [id, institutionId, studentId, JSON.stringify(data)]);
      return { id, institutionId, ...data };
    },
    async getEvent(id) {
      const result = await pool.query('SELECT * FROM student_events WHERE id = $1', [id]);
      return result.rows[0] ? toEvent(result.rows[0]) : null;
    },
    async updateEvent(id, { id: _id, institutionId: _institutionId, ...data }) {
      await pool.query('UPDATE student_events SET data = $1 WHERE id = $2', [JSON.stringify(data), id]);
    },
    async listEvents(institutionId, filters = {}) {
      const result = await pool.query(
        `SELECT * FROM student_events WHERE institution_id = $1 AND ($2::text IS NULL OR student_id = $2) ORDER BY created_at DESC LIMIT ${MAX_EVENTS}`,
        [institutionId, filters.studentId ?? null],
      );
      return result.rows.map(toEvent).filter(matchesEvent(filters));
    },
    async listAllInstitutions() {
      const result = await pool.query('SELECT * FROM institutions ORDER BY created_at DESC');
      return result.rows.map(toInstitution);
    },
    async setInstitutionFields(id, { ownerId, status }) {
      if (ownerId !== undefined) await pool.query('UPDATE institutions SET owner_id = $1, updated_at = NOW() WHERE id = $2', [ownerId, id]);
      if (status !== undefined) await pool.query('UPDATE institutions SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);
    },
    async timetableStatuses(institutionId) {
      const result = await pool.query('SELECT status FROM timetables WHERE institution_id = $1', [institutionId]);
      return result.rows.map((row) => row.status);
    },
    async updateAccountPassword(id, passwordHash) {
      await pool.query('UPDATE accounts SET password_hash = $1 WHERE id = $2', [passwordHash, id]);
    },
    async listDemoAccountIds(emailSuffix, createdBefore) {
      const result = await pool.query('SELECT id FROM accounts WHERE email LIKE $1 AND created_at < $2', [`%${emailSuffix}`, createdBefore]);
      return result.rows.map((row) => row.id);
    },
    async getAccount(id) {
      const result = await pool.query('SELECT * FROM accounts WHERE id = $1', [id]);
      return result.rows[0] ? toAccount(result.rows[0]) : null;
    },
    async getAccountByEmail(email) {
      const result = await pool.query('SELECT * FROM accounts WHERE email = $1', [email]);
      return result.rows[0] ? toAccount(result.rows[0]) : null;
    },
    async createSession({ tokenHash, accountId, expiresAt }) {
      await pool.query('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES ($1, $2, $3)', [
        tokenHash,
        accountId,
        expiresAt,
      ]);
    },
    async getSession(tokenHash) {
      const result = await pool.query('SELECT * FROM sessions WHERE token_hash = $1 AND expires_at > NOW()', [tokenHash]);
      const row = result.rows[0];
      return row ? { tokenHash: row.token_hash, accountId: row.account_id, expiresAt: row.expires_at } : null;
    },
    async deleteSession(tokenHash) {
      await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
    },
    async deleteAccountSessions(accountId, keepTokenHash = '') {
      await pool.query('DELETE FROM sessions WHERE account_id = $1 AND token_hash <> $2', [accountId, keepTokenHash]);
    },
    async deleteExpiredSessions() {
      await pool.query('DELETE FROM sessions WHERE expires_at <= NOW()');
    },
    /** Removes the account with its sessions, institutions and their timetables. */
    async deleteAccount(id) {
      await pool.query(
        'DELETE FROM timetables WHERE institution_id IN (SELECT id FROM institutions WHERE owner_id = $1)',
        [id],
      );
      await pool.query('DELETE FROM institutions WHERE owner_id = $1', [id]);
      const result = await pool.query('DELETE FROM accounts WHERE id = $1', [id]);
      return result.rowCount > 0;
    },
    async listInstitutions(ownerId) {
      const result = await pool.query('SELECT * FROM institutions WHERE owner_id = $1 ORDER BY updated_at DESC', [ownerId]);
      return result.rows.map(toInstitution);
    },
    async getInstitution(id) {
      const result = await pool.query('SELECT * FROM institutions WHERE id = $1', [id]);
      return result.rows[0] ? toInstitution(result.rows[0]) : null;
    },
    async createInstitution({ id = nanoid(), ownerId, name, type, contact, data }) {
      const result = await pool.query(
        'INSERT INTO institutions (id, owner_id, name, type, contact, data) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [id, ownerId ?? null, name, type, contact ?? null, JSON.stringify(data ?? {})],
      );
      return toInstitution(result.rows[0]);
    },
    async updateInstitution(id, { name, type, data }) {
      const result = await pool.query(
        `UPDATE institutions SET name = $2, type = $3, data = $4, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, name, type, JSON.stringify(data ?? {})],
      );
      return result.rows[0] ? toInstitution(result.rows[0]) : null;
    },
    async deleteInstitution(id) {
      await pool.query('DELETE FROM timetables WHERE institution_id = $1', [id]);
      const result = await pool.query('DELETE FROM institutions WHERE id = $1', [id]);
      return result.rowCount > 0;
    },
    async createTimetable({ institutionId, label, status, request }) {
      const id = nanoid();
      await pool.query(
        `INSERT INTO timetables (id, institution_id, label, status, request, generated_sessions)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, institutionId, label ?? null, status ?? 'draft', JSON.stringify(request ?? {}), '[]'],
      );
      return getTimetable(id);
    },
    async createNotice({ id, institutionId, ...rest }) {
      await pool.query('INSERT INTO notices (id, institution_id, data) VALUES ($1, $2, $3)', [id, institutionId, JSON.stringify(rest)]);
      return { id, institutionId, ...rest };
    },
    async getNotice(id) {
      const result = await pool.query('SELECT * FROM notices WHERE id = $1', [id]);
      return result.rows[0] ? { ...result.rows[0].data, id: result.rows[0].id, institutionId: result.rows[0].institution_id } : null;
    },
    async listNotices(institutionId, limit) {
      const result = await pool.query('SELECT * FROM notices WHERE institution_id = $1 ORDER BY created_at DESC LIMIT $2', [institutionId, limit]);
      return result.rows.map((row) => ({ ...row.data, id: row.id, institutionId: row.institution_id }));
    },
    async updateNotice(id, { id: _id, institutionId: _institutionId, ...rest }) {
      await pool.query('UPDATE notices SET data = $1 WHERE id = $2', [JSON.stringify(rest), id]);
    },
    async pruneNotices(institutionId, keep) {
      await pool.query(
        'DELETE FROM notices WHERE id IN (SELECT id FROM notices WHERE institution_id = $1 ORDER BY created_at DESC OFFSET $2)',
        [institutionId, keep],
      );
    },
    async linkMessage(messageId, noticeId, teacherId) {
      await pool.query('INSERT INTO message_links (message_id, notice_id, teacher_id) VALUES ($1, $2, $3) ON CONFLICT (message_id) DO NOTHING', [messageId, noticeId, teacherId]);
    },
    async findMessageLink(messageId) {
      const result = await pool.query('SELECT * FROM message_links WHERE message_id = $1', [messageId]);
      return result.rows[0] ? { noticeId: result.rows[0].notice_id, teacherId: result.rows[0].teacher_id } : null;
    },
    async deleteTimetables(institutionId) {
      await pool.query('DELETE FROM timetables WHERE institution_id = $1', [institutionId]);
    },
    async pruneTimetables(institutionId, keep) {
      await pool.query(
        `DELETE FROM timetables WHERE id IN (
           SELECT id FROM timetables WHERE institution_id = $1 AND status <> 'approved'
           ORDER BY created_at DESC OFFSET $2
         )`,
        [institutionId, keep],
      );
    },
    async listTimetables(institutionId) {
      const result = await pool.query(
        'SELECT * FROM timetables WHERE institution_id = $1 ORDER BY created_at DESC',
        [institutionId],
      );
      return result.rows.map(toTimetable);
    },
    getTimetable,
    async updateTimetableSessions(id, generatedSessions, status) {
      await pool.query(
        `UPDATE timetables SET generated_sessions = $1, status = $2, updated_at = NOW() WHERE id = $3`,
        [JSON.stringify(generatedSessions ?? []), status, id],
      );
      return getTimetable(id);
    },
  };
};

export const createFileStore = async (filePath) => {
  let state = {};
  try {
    state = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  state = { accounts: [], sessions: [], institutions: [], timetables: [], notices: [], messageLinks: [], memberships: [], invites: [], events: [], ...state };
  const dropNoticesOf = (ids) => {
    state.memberships = state.memberships.filter((item) => !ids.has(item.institutionId));
    state.invites = state.invites.filter((item) => !ids.has(item.institutionId));
    state.events = state.events.filter((item) => !ids.has(item.institutionId));
    const gone = new Set(state.notices.filter((item) => ids.has(item.institutionId)).map((item) => item.id));
    state.notices = state.notices.filter((item) => !gone.has(item.id));
    state.messageLinks = state.messageLinks.filter((item) => !gone.has(item.noticeId));
  };

  // Serialise writes so concurrent requests never interleave partial files.
  let writing = Promise.resolve();
  const persist = () => {
    writing = writing.then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.tmp`;
      await fs.writeFile(temp, JSON.stringify(state, null, 2));
      await fs.rename(temp, filePath);
    });
    return writing;
  };
  const now = () => new Date().toISOString();
  const clone = (value) => (value ? structuredClone(value) : null);

  return {
    kind: 'file',
    async createAccount({ name, email, passwordHash }) {
      if (state.accounts.some((item) => item.email === email)) throw new DuplicateEmailError();
      const record = { id: nanoid(), name, email, passwordHash, createdAt: now() };
      state.accounts.push(record);
      await persist();
      return clone(record);
    },
    async setPlatformAdmin(id, value) {
      const record = state.accounts.find((item) => item.id === id);
      if (record) record.platformAdmin = value;
      await persist();
    },
    async addMember({ accountId, institutionId, role, teacherId }) {
      state.memberships = state.memberships.filter((item) => !(item.accountId === accountId && item.institutionId === institutionId));
      state.memberships.push({ accountId, institutionId, role, teacherId: teacherId ?? null, createdAt: now() });
      await persist();
    },
    async getMembership(accountId, institutionId) {
      return clone(state.memberships.find((item) => item.accountId === accountId && item.institutionId === institutionId));
    },
    async listMemberships(accountId) {
      return clone(state.memberships.filter((item) => item.accountId === accountId));
    },
    async listMembers(institutionId) {
      return clone(state.memberships.filter((item) => item.institutionId === institutionId));
    },
    async removeMember(accountId, institutionId) {
      state.memberships = state.memberships.filter((item) => !(item.accountId === accountId && item.institutionId === institutionId));
      await persist();
    },
    async createInvite(invite) {
      state.invites.push(structuredClone(invite));
      await persist();
    },
    async getInvite(tokenHash) {
      return clone(state.invites.find((item) => item.tokenHash === tokenHash));
    },
    async claimInvite(tokenHash, accountId) {
      const invite = state.invites.find((item) => item.tokenHash === tokenHash && !item.usedAt);
      if (!invite) return false;
      Object.assign(invite, { usedAt: now(), usedBy: accountId });
      await persist();
      return true;
    },
    async listInvites(institutionId) {
      return clone(state.invites.filter((item) => item.institutionId === institutionId));
    },
    async deleteInvite(id, institutionId) {
      state.invites = state.invites.filter((item) => !(item.id === id && item.institutionId === institutionId));
      await persist();
    },
    async deleteUnusedInvites(institutionId, teacherId) {
      state.invites = state.invites.filter((item) => !(item.institutionId === institutionId && (item.teacherId ?? null) === (teacherId ?? null) && !item.usedAt));
      await persist();
    },
    async createEvent(event) {
      state.events.push(structuredClone(event));
      await persist();
      return clone(event);
    },
    async getEvent(id) {
      return clone(state.events.find((item) => item.id === id));
    },
    async updateEvent(id, event) {
      const index = state.events.findIndex((item) => item.id === id);
      if (index !== -1) state.events[index] = structuredClone(event);
      await persist();
    },
    async listEvents(institutionId, filters = {}) {
      return clone(
        state.events
          .filter((item) => item.institutionId === institutionId)
          .filter(matchesEvent(filters))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, MAX_EVENTS),
      );
    },
    async listAllInstitutions() {
      return clone([...state.institutions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    },
    async setInstitutionFields(id, fields) {
      const record = state.institutions.find((item) => item.id === id);
      if (record) Object.assign(record, Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)), { updatedAt: now() });
      await persist();
    },
    async timetableStatuses(institutionId) {
      return state.timetables.filter((item) => item.institutionId === institutionId).map((item) => item.status);
    },
    async updateAccountPassword(id, passwordHash) {
      const record = state.accounts.find((item) => item.id === id);
      if (record) record.passwordHash = passwordHash;
      await persist();
    },
    async listDemoAccountIds(emailSuffix, createdBefore) {
      return state.accounts.filter((item) => item.email.endsWith(emailSuffix) && new Date(item.createdAt) < new Date(createdBefore)).map((item) => item.id);
    },
    async getAccount(id) {
      return clone(state.accounts.find((item) => item.id === id));
    },
    async getAccountByEmail(email) {
      return clone(state.accounts.find((item) => item.email === email));
    },
    async createSession({ tokenHash, accountId, expiresAt }) {
      // Drop expired sessions while we are here.
      state.sessions = state.sessions.filter((item) => new Date(item.expiresAt) > new Date());
      state.sessions.push({ tokenHash, accountId, expiresAt: new Date(expiresAt).toISOString() });
      await persist();
    },
    async getSession(tokenHash) {
      return clone(state.sessions.find((item) => item.tokenHash === tokenHash && new Date(item.expiresAt) > new Date()));
    },
    async deleteSession(tokenHash) {
      state.sessions = state.sessions.filter((item) => item.tokenHash !== tokenHash);
      await persist();
    },
    async deleteAccountSessions(accountId, keepTokenHash = '') {
      state.sessions = state.sessions.filter((item) => item.accountId !== accountId || item.tokenHash === keepTokenHash);
      await persist();
    },
    async deleteExpiredSessions() {
      state.sessions = state.sessions.filter((item) => new Date(item.expiresAt) > new Date());
      await persist();
    },
    /** Removes the account with its sessions, institutions and their timetables. */
    async deleteAccount(id) {
      const before = state.accounts.length;
      const owned = new Set(state.institutions.filter((item) => item.ownerId === id).map((item) => item.id));
      state.timetables = state.timetables.filter((item) => !owned.has(item.institutionId));
      dropNoticesOf(owned);
      state.institutions = state.institutions.filter((item) => item.ownerId !== id);
      state.sessions = state.sessions.filter((item) => item.accountId !== id);
      state.accounts = state.accounts.filter((item) => item.id !== id);
      state.memberships = state.memberships.filter((item) => item.accountId !== id);
      await persist();
      return state.accounts.length < before;
    },
    async listInstitutions(ownerId) {
      return clone(
        state.institutions
          .filter((item) => item.ownerId === ownerId)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );
    },
    async getInstitution(id) {
      return clone(state.institutions.find((item) => item.id === id));
    },
    async createInstitution({ id, ownerId, name, type, contact, data }) {
      const record = { id: id ?? nanoid(), ownerId, name, type, status: 'active', contact: contact ?? null, data: data ?? {}, createdAt: now(), updatedAt: now() };
      state.institutions.push(record);
      await persist();
      return clone(record);
    },
    async updateInstitution(id, { name, type, data }) {
      const record = state.institutions.find((item) => item.id === id);
      if (!record) return null;
      Object.assign(record, { name, type, data: data ?? {}, updatedAt: now() });
      await persist();
      return clone(record);
    },
    async deleteInstitution(id) {
      const before = state.institutions.length;
      state.institutions = state.institutions.filter((item) => item.id !== id);
      state.timetables = state.timetables.filter((item) => item.institutionId !== id);
      dropNoticesOf(new Set([id]));
      await persist();
      return state.institutions.length < before;
    },
    async createTimetable({ institutionId, label, status, request }) {
      const record = {
        id: nanoid(),
        institutionId,
        label: label ?? null,
        status: status ?? 'draft',
        request: request ?? {},
        generatedSessions: [],
        createdAt: now(),
        updatedAt: now(),
      };
      state.timetables.push(record);
      await persist();
      return clone(record);
    },
    async createNotice(notice) {
      state.notices.push(structuredClone(notice));
      await persist();
      return clone(notice);
    },
    async getNotice(id) {
      return clone(state.notices.find((item) => item.id === id));
    },
    async listNotices(institutionId, limit) {
      return clone(
        state.notices
          .filter((item) => item.institutionId === institutionId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, limit),
      );
    },
    async updateNotice(id, notice) {
      const index = state.notices.findIndex((item) => item.id === id);
      if (index !== -1) state.notices[index] = structuredClone(notice);
      await persist();
    },
    async pruneNotices(institutionId, keep) {
      const stale = new Set(
        state.notices
          .filter((item) => item.institutionId === institutionId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(keep)
          .map((item) => item.id),
      );
      state.notices = state.notices.filter((item) => !stale.has(item.id));
      state.messageLinks = state.messageLinks.filter((item) => !stale.has(item.noticeId));
      await persist();
    },
    async linkMessage(messageId, noticeId, teacherId) {
      state.messageLinks.push({ messageId, noticeId, teacherId });
      await persist();
    },
    async findMessageLink(messageId) {
      return clone(state.messageLinks.find((item) => item.messageId === messageId));
    },
    async deleteTimetables(institutionId) {
      state.timetables = state.timetables.filter((item) => item.institutionId !== institutionId);
      await persist();
    },
    async pruneTimetables(institutionId, keep) {
      const stale = new Set(
        state.timetables
          .filter((item) => item.institutionId === institutionId && item.status !== 'approved')
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(keep)
          .map((item) => item.id),
      );
      state.timetables = state.timetables.filter((item) => !stale.has(item.id));
      await persist();
    },
    async listTimetables(institutionId) {
      return clone(
        state.timetables
          .filter((item) => item.institutionId === institutionId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
    },
    async getTimetable(id) {
      return clone(state.timetables.find((item) => item.id === id));
    },
    async updateTimetableSessions(id, generatedSessions, status) {
      const record = state.timetables.find((item) => item.id === id);
      if (!record) return null;
      Object.assign(record, { generatedSessions: generatedSessions ?? [], status, updatedAt: now() });
      await persist();
      return clone(record);
    },
  };
};

export const createStore = async ({ databaseUrl, dataFile }) =>
  databaseUrl ? createPgStore(databaseUrl) : createFileStore(dataFile);
