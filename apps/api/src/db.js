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
`;

const toAccount = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  passwordHash: row.password_hash,
  createdAt: row.created_at,
});

const toInstitution = (row) => ({
  id: row.id,
  ownerId: row.owner_id,
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
  const client = await pool.connect();
  try {
    await client.query(schema);
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
    async listInstitutions(ownerId) {
      const result = await pool.query('SELECT * FROM institutions WHERE owner_id = $1 ORDER BY updated_at DESC', [ownerId]);
      return result.rows.map(toInstitution);
    },
    async getInstitution(id) {
      const result = await pool.query('SELECT * FROM institutions WHERE id = $1', [id]);
      return result.rows[0] ? toInstitution(result.rows[0]) : null;
    },
    async createInstitution({ ownerId, name, type, data }) {
      const result = await pool.query(
        `INSERT INTO institutions (id, owner_id, name, type, data) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [nanoid(), ownerId, name, type, JSON.stringify(data ?? {})],
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
  state = { accounts: [], sessions: [], institutions: [], timetables: [], ...state };

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
    async createInstitution({ ownerId, name, type, data }) {
      const record = { id: nanoid(), ownerId, name, type, data: data ?? {}, createdAt: now(), updatedAt: now() };
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
