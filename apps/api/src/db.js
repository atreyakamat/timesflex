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

export const initDb = async (connectionString) => {
  const pool = new Pool({
    connectionString,
  });

  // Verify connection and run schema
  const client = await pool.connect();
  try {
    await client.query(schema);
  } finally {
    client.release();
  }

  return pool;
};

export const createInstitution = async (pool, payload) => {
  const id = nanoid();
  const data = payload.data ?? {};
  const result = await pool.query(
    `INSERT INTO institutions (id, name, type, data)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [id, payload.name, payload.type, JSON.stringify(data)]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    data: row.data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const listInstitutions = async (pool) => {
  const result = await pool.query('SELECT * FROM institutions ORDER BY created_at DESC');
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    data: row.data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
};

export const getInstitution = async (pool, id) => {
  const result = await pool.query('SELECT * FROM institutions WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    data: row.data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const createTimetable = async (pool, payload) => {
  const id = nanoid();
  await pool.query(
    `INSERT INTO timetables (id, institution_id, label, status, request, generated_sessions)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      payload.institutionId,
      payload.label ?? null,
      payload.status ?? 'draft',
      JSON.stringify(payload.request ?? {}),
      JSON.stringify(payload.generatedSessions ?? []),
    ]
  );
  return getTimetable(pool, id);
};

export const listTimetables = async (pool, institutionId) => {
  const result = await pool.query(
    'SELECT * FROM timetables WHERE institution_id = $1 ORDER BY created_at DESC',
    [institutionId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    institutionId: row.institution_id,
    label: row.label,
    status: row.status,
    request: row.request,
    generatedSessions: row.generated_sessions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
};

export const getTimetable = async (pool, id) => {
  const result = await pool.query('SELECT * FROM timetables WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    institutionId: row.institution_id,
    label: row.label,
    status: row.status,
    request: row.request,
    generatedSessions: row.generated_sessions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const updateTimetableSessions = async (pool, id, generatedSessions, status = 'generated') => {
  await pool.query(
    `UPDATE timetables
     SET generated_sessions = $1, status = $2, updated_at = NOW()
     WHERE id = $3`,
    [JSON.stringify(generatedSessions ?? []), status, id]
  );
  return getTimetable(pool, id);
};
