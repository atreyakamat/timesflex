import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { nanoid } from 'nanoid';

const schema = `
CREATE TABLE IF NOT EXISTS institutions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timetables (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  label TEXT,
  status TEXT NOT NULL,
  request TEXT NOT NULL,
  generated_sessions TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (institution_id) REFERENCES institutions (id)
);
`;

const nowIso = () => new Date().toISOString();

const parseJson = (value, fallback = null) => {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

export const initDb = (dbPath) => {
  const resolvedPath = resolve(dbPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.exec(schema);
  return db;
};

export const createInstitution = (db, payload) => {
  const id = nanoid();
  const timestamp = nowIso();
  const data = JSON.stringify(payload.data ?? {});
  db.prepare(
    `INSERT INTO institutions (id, name, type, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, payload.name, payload.type, data, timestamp, timestamp);
  return { id, name: payload.name, type: payload.type, data: payload.data ?? {}, createdAt: timestamp };
};

export const listInstitutions = (db) => {
  return db
    .prepare('SELECT * FROM institutions ORDER BY created_at DESC')
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      data: parseJson(row.data, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
};

export const getInstitution = (db, id) => {
  const row = db.prepare('SELECT * FROM institutions WHERE id = ?').get(id);
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    data: parseJson(row.data, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const createTimetable = (db, payload) => {
  const id = nanoid();
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO timetables (id, institution_id, label, status, request, generated_sessions, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    payload.institutionId,
    payload.label ?? null,
    payload.status ?? 'draft',
    JSON.stringify(payload.request ?? {}),
    JSON.stringify(payload.generatedSessions ?? []),
    timestamp,
    timestamp,
  );
  return getTimetable(db, id);
};

export const listTimetables = (db, institutionId) => {
  return db
    .prepare('SELECT * FROM timetables WHERE institution_id = ? ORDER BY created_at DESC')
    .all(institutionId)
    .map((row) => ({
      id: row.id,
      institutionId: row.institution_id,
      label: row.label,
      status: row.status,
      request: parseJson(row.request, {}),
      generatedSessions: parseJson(row.generated_sessions, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
};

export const getTimetable = (db, id) => {
  const row = db.prepare('SELECT * FROM timetables WHERE id = ?').get(id);
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    institutionId: row.institution_id,
    label: row.label,
    status: row.status,
    request: parseJson(row.request, {}),
    generatedSessions: parseJson(row.generated_sessions, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const updateTimetableSessions = (db, id, generatedSessions, status = 'generated') => {
  const timestamp = nowIso();
  db.prepare(
    `UPDATE timetables
     SET generated_sessions = ?, status = ?, updated_at = ?
     WHERE id = ?`
  ).run(JSON.stringify(generatedSessions ?? []), status, timestamp, id);
  return getTimetable(db, id);
};
