import cors from 'cors';
import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createInstitution,
  createTimetable,
  getInstitution,
  getTimetable,
  initDb,
  listInstitutions,
  listTimetables,
  updateTimetableSessions,
} from './db.js';
import { solveWithSolver } from './solverClient.js';

const app = express();
const currentDir = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.TIMESFLEX_DB_PATH ?? resolve(currentDir, '../data/timesflex.db');
const db = initDb(dbPath);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (request, response) => {
  response.json({ service: 'timesflex-api', status: 'ok' });
});

app.get('/api/institutions', (request, response) => {
  response.json(listInstitutions(db));
});

app.post('/api/institutions', (request, response) => {
  const { name, type, profile } = request.body ?? {};
  if (!name || !type) {
    response.status(400).json({ error: 'name and type are required' });
    return;
  }

  const institution = createInstitution(db, {
    name,
    type,
    data: profile ?? request.body,
  });

  response.status(201).json(institution);
});

app.get('/api/institutions/:id', (request, response) => {
  const institution = getInstitution(db, request.params.id);
  if (!institution) {
    response.status(404).json({ error: 'Institution not found' });
    return;
  }
  response.json(institution);
});

app.post('/api/institutions/:id/timetables', (request, response) => {
  const institution = getInstitution(db, request.params.id);
  if (!institution) {
    response.status(404).json({ error: 'Institution not found' });
    return;
  }

  const { label, request: timetableRequest } = request.body ?? {};
  if (!timetableRequest?.days || !timetableRequest?.slots || !timetableRequest?.sessions) {
    response.status(400).json({ error: 'request.days, request.slots, and request.sessions are required' });
    return;
  }

  const timetable = createTimetable(db, {
    institutionId: institution.id,
    label: label ?? 'Initial version',
    status: 'draft',
    request: timetableRequest,
  });

  response.status(201).json(timetable);
});

app.get('/api/institutions/:id/timetables', (request, response) => {
  const institution = getInstitution(db, request.params.id);
  if (!institution) {
    response.status(404).json({ error: 'Institution not found' });
    return;
  }
  response.json(listTimetables(db, institution.id));
});

app.get('/api/timetables/:id', (request, response) => {
  const timetable = getTimetable(db, request.params.id);
  if (!timetable) {
    response.status(404).json({ error: 'Timetable not found' });
    return;
  }
  response.json(timetable);
});

app.post('/api/timetables/:id/solve', async (request, response) => {
  const timetable = getTimetable(db, request.params.id);
  if (!timetable) {
    response.status(404).json({ error: 'Timetable not found' });
    return;
  }

  try {
    const solverResult = await solveWithSolver(timetable.request);
    const updated = updateTimetableSessions(
      db,
      timetable.id,
      solverResult.scheduled_sessions,
      solverResult.status === 'ok' ? 'generated' : 'partial',
    );
    response.json({
      timetable: updated,
      solver: solverResult,
    });
  } catch (error) {
    response.status(500).json({ error: error.message ?? 'Solver failed' });
  }
});

app.put('/api/timetables/:id', (request, response) => {
  const { generatedSessions } = request.body ?? {};
  if (!Array.isArray(generatedSessions)) {
    response.status(400).json({ error: 'generatedSessions must be an array' });
    return;
  }

  const updated = updateTimetableSessions(db, request.params.id, generatedSessions, 'edited');
  if (!updated) {
    response.status(404).json({ error: 'Timetable not found' });
    return;
  }
  response.json(updated);
});

const port = process.env.PORT ?? 3001;

app.listen(port, () => {
  console.log(`TimeFlex API listening on port ${port}`);
});
