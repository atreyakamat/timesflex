// Triggering restart
import cors from 'cors';
import express from 'express';

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
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/timesflex';
const db = await initDb(databaseUrl);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (request, response) => {
  response.json({ service: 'timesflex-api', status: 'ok' });
});

app.get('/api/institutions', async (request, response) => {
  try {
    const institutions = await listInstitutions(db);
    response.json(institutions);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post('/api/institutions', async (request, response) => {
  const { name, type, profile } = request.body ?? {};
  if (!name || !type) {
    response.status(400).json({ error: 'name and type are required' });
    return;
  }

  try {
    const institution = await createInstitution(db, {
      name,
      type,
      data: profile ?? request.body,
    });
    response.status(201).json(institution);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.get('/api/institutions/:id', async (request, response) => {
  try {
    const institution = await getInstitution(db, request.params.id);
    if (!institution) {
      response.status(404).json({ error: 'Institution not found' });
      return;
    }
    response.json(institution);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post('/api/institutions/:id/timetables', async (request, response) => {
  try {
    const institution = await getInstitution(db, request.params.id);
    if (!institution) {
      response.status(404).json({ error: 'Institution not found' });
      return;
    }

    const { label, request: timetableRequest } = request.body ?? {};
    if (!timetableRequest?.days || !timetableRequest?.slots || !timetableRequest?.sessions) {
      response.status(400).json({ error: 'request.days, request.slots, and request.sessions are required' });
      return;
    }

    const timetable = await createTimetable(db, {
      institutionId: institution.id,
      label: label ?? 'Initial version',
      status: 'draft',
      request: timetableRequest,
    });

    response.status(201).json(timetable);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.get('/api/institutions/:id/timetables', async (request, response) => {
  try {
    const institution = await getInstitution(db, request.params.id);
    if (!institution) {
      response.status(404).json({ error: 'Institution not found' });
      return;
    }
    const timetables = await listTimetables(db, institution.id);
    response.json(timetables);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.get('/api/timetables/:id', async (request, response) => {
  try {
    const timetable = await getTimetable(db, request.params.id);
    if (!timetable) {
      response.status(404).json({ error: 'Timetable not found' });
      return;
    }
    response.json(timetable);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post('/api/parse', (request, response) => {
  const { text } = request.body ?? {};
  if (!text) {
    response.status(400).json({ error: 'text is required' });
    return;
  }

  const draft = {
    teachers: [],
    subjects: [],
    rooms: [],
    divisions: [],
  };

  // Extract Teachers
  const teacherMatches = text.matchAll(/(?:add\s+)?teacher\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi);
  for (const match of teacherMatches) {
    draft.teachers.push({ name: match[1], maxLecturesPerDay: 4, maxLecturesPerWeek: 20 });
  }

  // Extract Subjects
  const subjectMatches = text.matchAll(/(?:add\s+)?subject\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi);
  for (const match of subjectMatches) {
    draft.subjects.push({
      name: match[1],
      isLab: match[0].toLowerCase().includes('lab'),
      durationSlots: 1,
      sessionsPerWeek: 3,
    });
  }

  // Extract Rooms
  const roomMatches = text.matchAll(/(?:add\s+)?room\s+(\w+(?:\s+\w+)*)/gi);
  for (const match of roomMatches) {
    draft.rooms.push({ name: match[1], type: 'classroom', capacity: 40 });
  }

  // Extract Divisions
  const divisionMatches = text.matchAll(/(?:add\s+)?division\s+(\w+)/gi);
  for (const match of divisionMatches) {
    draft.divisions.push({ name: match[1], batches: [] });
  }

  response.json(draft);
});

app.post('/api/timetables/:id/solve', async (request, response) => {
  try {
    const timetable = await getTimetable(db, request.params.id);
    if (!timetable) {
      response.status(404).json({ error: 'Timetable not found' });
      return;
    }

    const solverResult = await solveWithSolver(timetable.request);
    const updated = await updateTimetableSessions(
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

app.put('/api/timetables/:id', async (request, response) => {
  const { generatedSessions } = request.body ?? {};
  if (!Array.isArray(generatedSessions)) {
    response.status(400).json({ error: 'generatedSessions must be an array' });
    return;
  }

  try {
    const updated = await updateTimetableSessions(db, request.params.id, generatedSessions, 'edited');
    if (!updated) {
      response.status(404).json({ error: 'Timetable not found' });
      return;
    }
    response.json(updated);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

const port = process.env.PORT ?? 3001;

app.listen(port, () => {
  console.log(`TimeFlex API listening on port ${port}`);
});
