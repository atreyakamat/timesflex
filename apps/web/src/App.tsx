import { useMemo, useState } from 'react';

import {
  createInstitution,
  createTimetable,
  solveTimetable,
  updateTimetable,
} from './api';
import type {
  DepartmentForm,
  DivisionForm,
  InstitutionForm,
  RoomForm,
  ScheduledSession,
  SessionRequest,
  SubjectForm,
  TeacherForm,
} from './types';
import { buildSlots, createId } from './utils';

const dayOptions = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const initialInstitution: InstitutionForm = {
  name: '',
  type: 'college',
  workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  startTime: '09:00',
  endTime: '17:00',
  slotDurationMinutes: 60,
  breakAfterSlots: 3,
  breakDurationMinutes: 30,
};

const initialDepartment: DepartmentForm = {
  name: 'Computer Engineering',
  yearLabel: 'Year 2',
  semesterLabel: 'Semester 3',
};

const steps = [
  { id: 'institution', label: 'Institution' },
  { id: 'structure', label: 'Structure' },
  { id: 'teachers', label: 'Teachers' },
  { id: 'rooms', label: 'Rooms & Labs' },
  { id: 'subjects', label: 'Subjects' },
  { id: 'generate', label: 'Generate' },
];

const gridLabel = (value: string) => value.replace('-', ' - ');

export function App() {
  const [activeStep, setActiveStep] = useState(steps[0].id);
  const [institution, setInstitution] = useState(initialInstitution);
  const [department, setDepartment] = useState(initialDepartment);
  const [divisions, setDivisions] = useState<DivisionForm[]>([]);
  const [teachers, setTeachers] = useState<TeacherForm[]>([]);
  const [rooms, setRooms] = useState<RoomForm[]>([]);
  const [subjects, setSubjects] = useState<SubjectForm[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [timetableId, setTimetableId] = useState<string | null>(null);
  const [scheduledSessions, setScheduledSessions] = useState<ScheduledSession[]>([]);
  const [unscheduledSessions, setUnscheduledSessions] = useState<SessionRequest[]>([]);

  const slots = useMemo(
    () =>
      buildSlots(
        institution.startTime,
        institution.endTime,
        institution.slotDurationMinutes,
        institution.breakAfterSlots,
        institution.breakDurationMinutes,
      ),
    [
      institution.startTime,
      institution.endTime,
      institution.slotDurationMinutes,
      institution.breakAfterSlots,
      institution.breakDurationMinutes,
    ],
  );

  const timetableGrid = useMemo(() => {
    const grid: Record<string, Record<string, ScheduledSession[]>> = {};
    for (const day of institution.workingDays) {
      grid[day] = {};
      for (const slot of slots) {
        grid[day][slot] = [];
      }
    }

    for (const session of scheduledSessions) {
      if (!grid[session.day]) {
        continue;
      }
      if (!grid[session.day][session.slot]) {
        grid[session.day][session.slot] = [];
      }
      grid[session.day][session.slot].push(session);
    }

    return grid;
  }, [institution.workingDays, scheduledSessions, slots]);

  const handleAddDivision = (name: string, batches: string) => {
    if (!name) {
      return;
    }
    setDivisions((current) => [
      ...current,
      {
        id: createId(),
        name,
        batches: batches
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      },
    ]);
  };

  const handleAddTeacher = (name: string, maxPerDay: number, maxPerWeek: number) => {
    if (!name) {
      return;
    }
    setTeachers((current) => [
      ...current,
      {
        id: createId(),
        name,
        maxLecturesPerDay: maxPerDay,
        maxLecturesPerWeek: maxPerWeek,
      },
    ]);
  };

  const handleAddRoom = (name: string, type: RoomForm['type'], capacity: number) => {
    if (!name) {
      return;
    }
    setRooms((current) => [
      ...current,
      {
        id: createId(),
        name,
        type,
        capacity,
      },
    ]);
  };

  const handleAddSubject = (
    name: string,
    isLab: boolean,
    durationSlots: number,
    sessionsPerWeek: number,
    teacherId: string,
    roomId: string,
  ) => {
    if (!name || !teacherId || !roomId) {
      return;
    }
    setSubjects((current) => [
      ...current,
      {
        id: createId(),
        name,
        isLab,
        durationSlots,
        sessionsPerWeek,
        teacherId,
        roomId,
      },
    ]);
  };

  const buildSolverRequest = () => {
    const sessions: SessionRequest[] = [];

    for (const division of divisions) {
      for (const subject of subjects) {
        for (let count = 0; count < subject.sessionsPerWeek; count += 1) {
          sessions.push({
            id: createId(),
            subject_id: subject.id,
            teacher_id: subject.teacherId,
            room_id: subject.roomId,
            division_id: division.id,
            kind: subject.isLab ? 'lab' : 'lecture',
            duration_slots: subject.durationSlots,
          });
        }
      }
    }

    return {
      days: institution.workingDays,
      slots,
      sessions,
    };
  };

  const handleGenerate = async () => {
    setStatusMessage('Saving institution profile...');

    const profile = {
      institution,
      department,
      divisions,
      teachers,
      rooms,
      subjects,
      slots,
    };

    try {
      let resolvedInstitutionId = institutionId;

      if (!resolvedInstitutionId) {
        const institutionRecord = await createInstitution({
          name: institution.name,
          type: institution.type,
          profile,
        });
        resolvedInstitutionId = institutionRecord.id;
        setInstitutionId(institutionRecord.id);
      }

      setStatusMessage('Creating timetable version...');
      const timetableRecord = await createTimetable(resolvedInstitutionId, {
        label: `${department.name} ${department.yearLabel}`,
        request: buildSolverRequest(),
      });
      setTimetableId(timetableRecord.id);

      setStatusMessage('Running OR-Tools solver...');
      const solved = await solveTimetable(timetableRecord.id);
      setScheduledSessions(solved.solver.scheduled_sessions);
      setUnscheduledSessions(solved.solver.unscheduled_sessions);
      setStatusMessage('Schedule ready. You can edit and save it.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to generate timetable.');
    }
  };

  const handleSessionUpdate = (sessionId: string, field: 'day' | 'slot', value: string) => {
    setScheduledSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              [field]: value,
            }
          : session,
      ),
    );
  };

  const handleSaveEdits = async () => {
    if (!timetableId) {
      return;
    }
    setStatusMessage('Saving edits...');
    try {
      await updateTimetable(timetableId, scheduledSessions);
      setStatusMessage('Edits saved.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to save edits.');
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">TF</div>
          <div>
            <strong>TimeFlex</strong>
            <span>Enterprise scheduler</span>
          </div>
        </div>
        <nav className="step-list">
          {steps.map((step) => (
            <button
              key={step.id}
              type="button"
              className={activeStep === step.id ? 'step active' : 'step'}
              onClick={() => setActiveStep(step.id)}
            >
              {step.label}
            </button>
          ))}
        </nav>
        <div className="status-card">
          <span>Status</span>
          <p>{statusMessage || 'Fill the setup tabs to start generating.'}</p>
        </div>
      </aside>

      <main className="content">
        {activeStep === 'institution' && (
          <section className="card">
            <header>
              <h1>Institution profile</h1>
              <p>Store the base profile once and reuse it for every timetable version.</p>
            </header>
            <div className="form-grid">
              <label>
                Institution name
                <input
                  type="text"
                  value={institution.name}
                  onChange={(event) => setInstitution({ ...institution, name: event.target.value })}
                />
              </label>
              <label>
                Institution type
                <select
                  value={institution.type}
                  onChange={(event) =>
                    setInstitution({ ...institution, type: event.target.value as InstitutionForm['type'] })
                  }
                >
                  <option value="college">College</option>
                  <option value="school">School</option>
                  <option value="university">University</option>
                </select>
              </label>
              <label>
                Start time
                <input
                  type="time"
                  value={institution.startTime}
                  onChange={(event) => setInstitution({ ...institution, startTime: event.target.value })}
                />
              </label>
              <label>
                End time
                <input
                  type="time"
                  value={institution.endTime}
                  onChange={(event) => setInstitution({ ...institution, endTime: event.target.value })}
                />
              </label>
              <label>
                Slot duration (minutes)
                <input
                  type="number"
                  min={30}
                  value={institution.slotDurationMinutes}
                  onChange={(event) =>
                    setInstitution({
                      ...institution,
                      slotDurationMinutes: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Break after slots
                <input
                  type="number"
                  min={1}
                  value={institution.breakAfterSlots ?? ''}
                  onChange={(event) =>
                    setInstitution({
                      ...institution,
                      breakAfterSlots: event.target.value ? Number(event.target.value) : null,
                    })
                  }
                />
              </label>
              <label>
                Break duration (minutes)
                <input
                  type="number"
                  min={0}
                  value={institution.breakDurationMinutes ?? ''}
                  onChange={(event) =>
                    setInstitution({
                      ...institution,
                      breakDurationMinutes: event.target.value ? Number(event.target.value) : null,
                    })
                  }
                />
              </label>
            </div>
            <div className="chip-row">
              {dayOptions.map((day) => (
                <button
                  key={day}
                  type="button"
                  className={institution.workingDays.includes(day) ? 'chip active' : 'chip'}
                  onClick={() => {
                    setInstitution((current) => {
                      const workingDays = current.workingDays.includes(day)
                        ? current.workingDays.filter((value) => value !== day)
                        : [...current.workingDays, day];
                      return { ...current, workingDays };
                    });
                  }}
                >
                  {day}
                </button>
              ))}
            </div>
          </section>
        )}

        {activeStep === 'structure' && (
          <section className="card">
            <header>
              <h1>Academic structure</h1>
              <p>Define department, year, semester, divisions, and batches.</p>
            </header>
            <div className="form-grid">
              <label>
                Department name
                <input
                  type="text"
                  value={department.name}
                  onChange={(event) => setDepartment({ ...department, name: event.target.value })}
                />
              </label>
              <label>
                Year label
                <input
                  type="text"
                  value={department.yearLabel}
                  onChange={(event) => setDepartment({ ...department, yearLabel: event.target.value })}
                />
              </label>
              <label>
                Semester label
                <input
                  type="text"
                  value={department.semesterLabel}
                  onChange={(event) => setDepartment({ ...department, semesterLabel: event.target.value })}
                />
              </label>
            </div>
            <div className="inline-form">
              <input type="text" placeholder="Division name" id="division-name" />
              <input type="text" placeholder="Batches (comma separated)" id="division-batches" />
              <button
                type="button"
                onClick={() => {
                  const nameInput = document.getElementById('division-name') as HTMLInputElement | null;
                  const batchInput = document.getElementById('division-batches') as HTMLInputElement | null;
                  handleAddDivision(nameInput?.value ?? '', batchInput?.value ?? '');
                  if (nameInput) {
                    nameInput.value = '';
                  }
                  if (batchInput) {
                    batchInput.value = '';
                  }
                }}
              >
                Add division
              </button>
            </div>
            <div className="list">
              {divisions.map((division) => (
                <div key={division.id} className="list-item">
                  <strong>{division.name}</strong>
                  <span>{division.batches.length ? division.batches.join(', ') : 'No batches'}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeStep === 'teachers' && (
          <section className="card">
            <header>
              <h1>Teachers</h1>
              <p>Add teachers with daily and weekly limits.</p>
            </header>
            <div className="inline-form">
              <input type="text" placeholder="Teacher name" id="teacher-name" />
              <input type="number" placeholder="Max / day" id="teacher-day" min={1} />
              <input type="number" placeholder="Max / week" id="teacher-week" min={1} />
              <button
                type="button"
                onClick={() => {
                  const nameInput = document.getElementById('teacher-name') as HTMLInputElement | null;
                  const dayInput = document.getElementById('teacher-day') as HTMLInputElement | null;
                  const weekInput = document.getElementById('teacher-week') as HTMLInputElement | null;
                  handleAddTeacher(
                    nameInput?.value ?? '',
                    Number(dayInput?.value ?? 4),
                    Number(weekInput?.value ?? 20),
                  );
                  if (nameInput) {
                    nameInput.value = '';
                  }
                  if (dayInput) {
                    dayInput.value = '';
                  }
                  if (weekInput) {
                    weekInput.value = '';
                  }
                }}
              >
                Add teacher
              </button>
            </div>
            <div className="list">
              {teachers.map((teacher) => (
                <div key={teacher.id} className="list-item">
                  <strong>{teacher.name}</strong>
                  <span>
                    {teacher.maxLecturesPerDay}/day, {teacher.maxLecturesPerWeek}/week
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeStep === 'rooms' && (
          <section className="card">
            <header>
              <h1>Rooms and labs</h1>
              <p>Define room capacity and lab resources for practicals.</p>
            </header>
            <div className="inline-form">
              <input type="text" placeholder="Room name" id="room-name" />
              <select id="room-type" defaultValue="classroom">
                <option value="classroom">Classroom</option>
                <option value="lab">Lab</option>
                <option value="seminar-hall">Seminar hall</option>
              </select>
              <input type="number" placeholder="Capacity" id="room-capacity" min={10} />
              <button
                type="button"
                onClick={() => {
                  const nameInput = document.getElementById('room-name') as HTMLInputElement | null;
                  const typeInput = document.getElementById('room-type') as HTMLSelectElement | null;
                  const capacityInput = document.getElementById('room-capacity') as HTMLInputElement | null;
                  handleAddRoom(
                    nameInput?.value ?? '',
                    (typeInput?.value ?? 'classroom') as RoomForm['type'],
                    Number(capacityInput?.value ?? 40),
                  );
                  if (nameInput) {
                    nameInput.value = '';
                  }
                  if (capacityInput) {
                    capacityInput.value = '';
                  }
                }}
              >
                Add room
              </button>
            </div>
            <div className="list">
              {rooms.map((room) => (
                <div key={room.id} className="list-item">
                  <strong>{room.name}</strong>
                  <span>
                    {room.type} · {room.capacity} seats
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeStep === 'subjects' && (
          <section className="card">
            <header>
              <h1>Subjects and assignments</h1>
              <p>Link teachers and rooms to each subject.</p>
            </header>
            <div className="inline-form">
              <input type="text" placeholder="Subject name" id="subject-name" />
              <select id="subject-kind" defaultValue="lecture">
                <option value="lecture">Lecture</option>
                <option value="lab">Lab</option>
              </select>
              <input type="number" placeholder="Duration slots" id="subject-duration" min={1} />
              <input type="number" placeholder="Sessions / week" id="subject-week" min={1} />
              <select id="subject-teacher" defaultValue="">
                <option value="" disabled>
                  Select teacher
                </option>
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.name}
                  </option>
                ))}
              </select>
              <select id="subject-room" defaultValue="">
                <option value="" disabled>
                  Select room
                </option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  const nameInput = document.getElementById('subject-name') as HTMLInputElement | null;
                  const kindInput = document.getElementById('subject-kind') as HTMLSelectElement | null;
                  const durationInput = document.getElementById('subject-duration') as HTMLInputElement | null;
                  const weekInput = document.getElementById('subject-week') as HTMLInputElement | null;
                  const teacherInput = document.getElementById('subject-teacher') as HTMLSelectElement | null;
                  const roomInput = document.getElementById('subject-room') as HTMLSelectElement | null;
                  handleAddSubject(
                    nameInput?.value ?? '',
                    (kindInput?.value ?? 'lecture') === 'lab',
                    Number(durationInput?.value ?? 1),
                    Number(weekInput?.value ?? 3),
                    teacherInput?.value ?? '',
                    roomInput?.value ?? '',
                  );
                  if (nameInput) {
                    nameInput.value = '';
                  }
                }}
              >
                Add subject
              </button>
            </div>
            <div className="list">
              {subjects.map((subject) => (
                <div key={subject.id} className="list-item">
                  <strong>{subject.name}</strong>
                  <span>
                    {subject.isLab ? 'Lab' : 'Lecture'} · {subject.sessionsPerWeek}/week · {subject.durationSlots} slots
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeStep === 'generate' && (
          <section className="card">
            <header>
              <h1>Generate timetable</h1>
              <p>Preview slots, solve the schedule, and fine tune the results.</p>
            </header>
            <div className="summary-grid">
              <div>
                <h3>Slots</h3>
                <div className="chip-row">
                  {slots.map((slot) => (
                    <span key={slot} className="chip active">
                      {gridLabel(slot)}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <h3>Divisions</h3>
                <div className="chip-row">
                  {divisions.map((division) => (
                    <span key={division.id} className="chip active">
                      {division.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="action-row">
              <button type="button" className="primary" onClick={handleGenerate}>
                Generate timetable
              </button>
              <button type="button" className="secondary" onClick={handleSaveEdits}>
                Save manual edits
              </button>
            </div>

            <div className="timetable">
              <div className="timetable-header">
                <div className="timetable-cell">Slot</div>
                {institution.workingDays.map((day) => (
                  <div key={day} className="timetable-cell header">
                    {day}
                  </div>
                ))}
              </div>
              {slots.map((slot) => (
                <div key={slot} className="timetable-row">
                  <div className="timetable-cell slot">{gridLabel(slot)}</div>
                  {institution.workingDays.map((day) => (
                    <div key={`${day}-${slot}`} className="timetable-cell">
                      {(timetableGrid[day]?.[slot] ?? []).map((session) => {
                        const subject = subjects.find((item) => item.id === session.subject_id);
                        const teacher = teachers.find((item) => item.id === session.teacher_id);
                        const room = rooms.find((item) => item.id === session.room_id);
                        const division = divisions.find((item) => item.id === session.division_id);
                        return (
                          <div key={session.id} className="session-card">
                            <strong>{subject?.name ?? 'Subject'}</strong>
                            <span>{division?.name ?? 'Division'} · {room?.name ?? 'Room'}</span>
                            <span>{teacher?.name ?? 'Teacher'}</span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="editor">
              <h3>Edit sessions</h3>
              <div className="list">
                {scheduledSessions.map((session) => {
                  const subject = subjects.find((item) => item.id === session.subject_id);
                  return (
                    <div key={session.id} className="list-item">
                      <strong>{subject?.name ?? session.subject_id}</strong>
                      <div className="inline-fields">
                        <select
                          value={session.day}
                          onChange={(event) => handleSessionUpdate(session.id, 'day', event.target.value)}
                        >
                          {institution.workingDays.map((day) => (
                            <option key={day} value={day}>
                              {day}
                            </option>
                          ))}
                        </select>
                        <select
                          value={session.slot}
                          onChange={(event) => handleSessionUpdate(session.id, 'slot', event.target.value)}
                        >
                          {slots.map((slot) => (
                            <option key={slot} value={slot}>
                              {gridLabel(slot)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {unscheduledSessions.length > 0 && (
              <div className="card warning">
                <h3>Unscheduled sessions</h3>
                <p>These sessions could not be placed by the solver.</p>
                <ul>
                  {unscheduledSessions.map((session) => (
                    <li key={session.id}>{session.subject_id}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
