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
  let state = { institutions: [], timetables: [] };
  try {
    state = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

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
    async listInstitutions() {
      return clone([...state.institutions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    },
    async getInstitution(id) {
      return clone(state.institutions.find((item) => item.id === id));
    },
    async createInstitution({ name, type, data }) {
      const record = { id: nanoid(), name, type, data: data ?? {}, createdAt: now(), updatedAt: now() };
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
