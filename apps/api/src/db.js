import fs from 'node:fs/promises';
import path from 'node:path';

import pg from 'pg';
import { nanoid } from 'nanoid';

const { Pool } = pg;

const schema = `
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
);

ALTER TABLE timetables ADD COLUMN IF NOT EXISTS report JSONB;
CREATE INDEX IF NOT EXISTS timetables_institution_idx ON timetables (institution_id);
`;

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
  let state = { institutions: [], timetables: [] };
  try {
    const loaded = JSON.parse(await fs.readFile(filePath, 'utf8'));
    state = {
      institutions: Array.isArray(loaded?.institutions) ? loaded.institutions : [],
      timetables: Array.isArray(loaded?.timetables) ? loaded.timetables : [],
    };
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
