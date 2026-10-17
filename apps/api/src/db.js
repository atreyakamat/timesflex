import fs from 'node:fs/promises';
import path from 'node:path';

import pg from 'pg';
import { nanoid } from 'nanoid';

const { Pool } = pg;

// Ordered, append-only. Each entry runs once, inside a transaction, and is
// recorded in schema_migrations. Never edit a shipped migration; add a new one.
export const MIGRATIONS = [
  {
    version: 1,
    name: 'institutions and timetables',
    sql: `
      CREATE TABLE IF NOT EXISTS institutions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
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
      );`,
  },
  {
    version: 2,
    name: 'solve report and institution index',
    sql: `
      ALTER TABLE timetables ADD COLUMN IF NOT EXISTS report JSONB;
      CREATE INDEX IF NOT EXISTS timetables_institution_idx ON timetables (institution_id);`,
  },
  {
    version: 3,
    name: 'users and sessions',
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        disabled BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX sessions_user_idx ON sessions (user_id);`,
  },
  {
    version: 4,
    name: 'audit log',
    sql: `
      CREATE TABLE audit_log (
        id BIGSERIAL PRIMARY KEY,
        at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        username TEXT,
        action TEXT NOT NULL,
        target TEXT,
        detail JSONB
      );
      CREATE INDEX audit_log_at_idx ON audit_log (at DESC);`,
  },
];

const AUDIT_FILE_LIMIT = 2000;

export const migrate = async (pool) => {
  const client = await pool.connect();
  try {
    // One API instance migrates at a time.
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const applied = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((row) => row.version));
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
          migration.version,
          migration.name,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${error.message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    client.release();
  }
};

const toInstitution = (row) => ({
  id: row.id,
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
  report: row.report ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toUser = (row) => ({
  id: row.id,
  username: row.username,
  passwordHash: row.password_hash,
  role: row.role,
  disabled: row.disabled,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toAudit = (row) => ({
  id: String(row.id),
  at: row.at,
  username: row.username,
  action: row.action,
  target: row.target,
  detail: row.detail ?? null,
});

const toSession = (row) => ({ id: row.id, userId: row.user_id, expiresAt: row.expires_at });

/**
 * Both stores expose the same async interface, so the API does not care
 * whether it runs against PostgreSQL or the zero-setup local JSON file.
 */
export const createPgStore = async (connectionString) => {
  const pool = new Pool({ connectionString });
  await migrate(pool);

  const getTimetable = async (id) => {
    const result = await pool.query('SELECT * FROM timetables WHERE id = $1', [id]);
    return result.rows[0] ? toTimetable(result.rows[0]) : null;
  };

  return {
    kind: 'postgres',
    pool,
    async listInstitutions() {
      const result = await pool.query('SELECT * FROM institutions ORDER BY updated_at DESC');
      return result.rows.map(toInstitution);
    },
    async getInstitution(id) {
      const result = await pool.query('SELECT * FROM institutions WHERE id = $1', [id]);
      return result.rows[0] ? toInstitution(result.rows[0]) : null;
    },
    async createInstitution({ name, type, data }) {
      const result = await pool.query(
        `INSERT INTO institutions (id, name, type, data) VALUES ($1, $2, $3, $4) RETURNING *`,
        [nanoid(), name, type, JSON.stringify(data ?? {})],
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
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM timetables WHERE institution_id = $1', [id]);
        const result = await client.query('DELETE FROM institutions WHERE id = $1', [id]);
        await client.query('COMMIT');
        return result.rowCount > 0;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
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
    async countUsers() {
      return Number((await pool.query('SELECT COUNT(*) AS n FROM users')).rows[0].n);
    },
    async listUsers() {
      return (await pool.query('SELECT * FROM users ORDER BY created_at')).rows.map(toUser);
    },
    async getUser(id) {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      return result.rows[0] ? toUser(result.rows[0]) : null;
    },
    async getUserByUsername(username) {
      const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
      return result.rows[0] ? toUser(result.rows[0]) : null;
    },
    async createUser({ username, passwordHash, role }) {
      const result = await pool.query(
        'INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *',
        [nanoid(), username, passwordHash, role],
      );
      return toUser(result.rows[0]);
    },
    async updateUser(id, { role, disabled, passwordHash }) {
      const result = await pool.query(
        `UPDATE users SET role = COALESCE($2, role), disabled = COALESCE($3, disabled),
           password_hash = COALESCE($4, password_hash), updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, role ?? null, disabled ?? null, passwordHash ?? null],
      );
      return result.rows[0] ? toUser(result.rows[0]) : null;
    },
    async deleteUser(id) {
      return (await pool.query('DELETE FROM users WHERE id = $1', [id])).rowCount > 0;
    },
    async createSession({ id, userId, expiresAt }) {
      await pool.query('DELETE FROM sessions WHERE expires_at < NOW()');
      await pool.query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', [id, userId, expiresAt]);
    },
    async getSession(id) {
      const result = await pool.query('SELECT * FROM sessions WHERE id = $1', [id]);
      return result.rows[0] ? toSession(result.rows[0]) : null;
    },
    async deleteSession(id) {
      await pool.query('DELETE FROM sessions WHERE id = $1', [id]);
    },
    async deleteUserSessions(userId, { except } = {}) {
      await pool.query('DELETE FROM sessions WHERE user_id = $1 AND id <> COALESCE($2, \'\')', [userId, except ?? null]);
    },
    async addAudit({ username, action, target, detail }) {
      await pool.query('INSERT INTO audit_log (username, action, target, detail) VALUES ($1, $2, $3, $4)', [
        username ?? null,
        action,
        target ?? null,
        detail === undefined ? null : JSON.stringify(detail),
      ]);
    },
    async listAudit({ limit = 100 } = {}) {
      const result = await pool.query('SELECT * FROM audit_log ORDER BY at DESC, id DESC LIMIT $1', [limit]);
      return result.rows.map(toAudit);
    },
    getTimetable,
    // Only the fields passed are changed.
    async updateTimetable(id, { generatedSessions, status, report }) {
      await pool.query(
        `UPDATE timetables SET
           generated_sessions = COALESCE($2, generated_sessions),
           status = COALESCE($3, status),
           report = COALESCE($4, report),
           updated_at = NOW()
         WHERE id = $1`,
        [
          id,
          generatedSessions === undefined ? null : JSON.stringify(generatedSessions),
          status ?? null,
          report === undefined ? null : JSON.stringify(report),
        ],
      );
      return getTimetable(id);
    },
  };
};

export const createFileStore = async (filePath) => {
  const collections = ['institutions', 'timetables', 'users', 'sessions', 'audit'];
  let state = Object.fromEntries(collections.map((key) => [key, []]));
  try {
    const loaded = JSON.parse(await fs.readFile(filePath, 'utf8'));
    state = Object.fromEntries(collections.map((key) => [key, Array.isArray(loaded?.[key]) ? loaded[key] : []]));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`Cannot read data file ${filePath}: ${error.message}. Fix or move it, then restart.`);
    }
  }

  // Serialise writes so concurrent requests never interleave partial files.
  // Each write is chained after the previous one settles, so one failed write
  // does not poison every later one.
  let writing = Promise.resolve();
  const persist = () => {
    const snapshot = JSON.stringify(state, null, 2);
    const next = writing.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.tmp`;
      await fs.writeFile(temp, snapshot);
      await fs.rename(temp, filePath);
    });
    writing = next;
    return next;
  };
  // Apply a change in memory and save it; if saving fails, roll memory back so
  // the API never serves data that is not on disk.
  const mutate = async (change) => {
    const before = structuredClone(state);
    const value = change();
    try {
      await persist();
    } catch (error) {
      state = before;
      throw error;
    }
    return value;
  };
  const now = () => new Date().toISOString();
  const clone = (value) => (value ? structuredClone(value) : null);

  return {
    kind: 'file',
    async listInstitutions() {
      return clone([...state.institutions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    },
    async getInstitution(id) {
      return clone(state.institutions.find((item) => item.id === id));
    },
    async createInstitution({ name, type, data }) {
      const record = { id: nanoid(), name, type, data: data ?? {}, createdAt: now(), updatedAt: now() };
      await mutate(() => state.institutions.push(record));
      return clone(record);
    },
    async updateInstitution(id, { name, type, data }) {
      if (!state.institutions.some((item) => item.id === id)) return null;
      return clone(
        await mutate(() => {
          const record = state.institutions.find((item) => item.id === id);
          return Object.assign(record, { name, type, data: data ?? {}, updatedAt: now() });
        }),
      );
    },
    async deleteInstitution(id) {
      if (!state.institutions.some((item) => item.id === id)) return false;
      await mutate(() => {
        state.institutions = state.institutions.filter((item) => item.id !== id);
        state.timetables = state.timetables.filter((item) => item.institutionId !== id);
      });
      return true;
    },
    async createTimetable({ institutionId, label, status, request }) {
      const record = {
        id: nanoid(),
        institutionId,
        label: label ?? null,
        status: status ?? 'draft',
        request: request ?? {},
        generatedSessions: [],
        report: null,
        createdAt: now(),
        updatedAt: now(),
      };
      await mutate(() => state.timetables.push(record));
      return clone(record);
    },
    async listTimetables(institutionId) {
      return clone(
        state.timetables
          .filter((item) => item.institutionId === institutionId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
    },
    async countUsers() {
      return state.users.length;
    },
    async listUsers() {
      return clone([...state.users].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    },
    async getUser(id) {
      return clone(state.users.find((item) => item.id === id));
    },
    async getUserByUsername(username) {
      return clone(state.users.find((item) => item.username === username));
    },
    async createUser({ username, passwordHash, role }) {
      if (state.users.some((item) => item.username === username)) {
        throw Object.assign(new Error('duplicate username'), { code: '23505' });
      }
      const record = { id: nanoid(), username, passwordHash, role, disabled: false, createdAt: now(), updatedAt: now() };
      await mutate(() => state.users.push(record));
      return clone(record);
    },
    async updateUser(id, { role, disabled, passwordHash }) {
      if (!state.users.some((item) => item.id === id)) return null;
      return clone(
        await mutate(() => {
          const record = state.users.find((item) => item.id === id);
          if (role !== undefined) record.role = role;
          if (disabled !== undefined) record.disabled = disabled;
          if (passwordHash !== undefined) record.passwordHash = passwordHash;
          record.updatedAt = now();
          return record;
        }),
      );
    },
    async deleteUser(id) {
      if (!state.users.some((item) => item.id === id)) return false;
      await mutate(() => {
        state.users = state.users.filter((item) => item.id !== id);
        state.sessions = state.sessions.filter((item) => item.userId !== id);
      });
      return true;
    },
    async createSession({ id, userId, expiresAt }) {
      const current = new Date().toISOString();
      await mutate(() => {
        state.sessions = state.sessions.filter((item) => item.expiresAt > current);
        state.sessions.push({ id, userId, expiresAt });
      });
    },
    async getSession(id) {
      return clone(state.sessions.find((item) => item.id === id));
    },
    async deleteSession(id) {
      await mutate(() => {
        state.sessions = state.sessions.filter((item) => item.id !== id);
      });
    },
    async deleteUserSessions(userId, { except } = {}) {
      await mutate(() => {
        state.sessions = state.sessions.filter((item) => item.userId !== userId || item.id === except);
      });
    },
    async addAudit({ username, action, target, detail }) {
      const entry = { id: nanoid(), at: now(), username: username ?? null, action, target: target ?? null, detail: detail ?? null };
      await mutate(() => {
        state.audit.push(entry);
        if (state.audit.length > AUDIT_FILE_LIMIT) state.audit = state.audit.slice(-AUDIT_FILE_LIMIT);
      });
    },
    async listAudit({ limit = 100 } = {}) {
      return clone(state.audit.slice(-limit).reverse());
    },
    async getTimetable(id) {
      return clone(state.timetables.find((item) => item.id === id));
    },
    // Only the fields passed are changed.
    async updateTimetable(id, { generatedSessions, status, report }) {
      if (!state.timetables.some((item) => item.id === id)) return null;
      return clone(
        await mutate(() => {
          const record = state.timetables.find((item) => item.id === id);
          if (generatedSessions !== undefined) record.generatedSessions = generatedSessions;
          if (status !== undefined) record.status = status;
          if (report !== undefined) record.report = report;
          record.updatedAt = now();
          return record;
        }),
      );
    },
  };
};

export const createStore = async ({ databaseUrl, dataFile }) =>
  databaseUrl ? createPgStore(databaseUrl) : createFileStore(dataFile);
