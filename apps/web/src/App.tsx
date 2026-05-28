import { useMemo, useState } from 'react';

import {
  createInstitution,
  createTimetable,
  solveTimetable,
  updateTimetable,
} from './api';
import { AcademicStructure } from './components/AcademicStructure';
import { Dashboard } from './components/Dashboard';
import { InstitutionSetup } from './components/InstitutionSetup';
import { RoomSetup } from './components/RoomSetup';
import { SubjectSetup } from './components/SubjectSetup';
import { TeacherSetup } from './components/TeacherSetup';
import { TimetablePreview } from './components/TimetablePreview';
import type {
  DepartmentForm,
  DivisionForm,
  InstitutionForm,
  InstitutionRecord,
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

export function App() {
  const [view, setView] = useState<'dashboard' | 'editor'>('dashboard');
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

  const handleLoadInstitution = (record: InstitutionRecord) => {
    const profile = (record.data as any)?.profile || record.data;
    if (profile) {
      setInstitution(profile.institution || initialInstitution);
      setDepartment(profile.department || initialDepartment);
      setDivisions(profile.divisions || []);
      setTeachers(profile.teachers || []);
      setRooms(profile.rooms || []);
      setSubjects(profile.subjects || []);
    }
    setInstitutionId(record.id);
    setView('editor');
    setActiveStep('institution');
    setStatusMessage(`Loaded ${record.name} profile.`);
  };

  const handleNewInstitution = () => {
    setInstitution(initialInstitution);
    setDepartment(initialDepartment);
    setDivisions([]);
    setTeachers([]);
    setRooms([]);
    setSubjects([]);
    setInstitutionId(null);
    setTimetableId(null);
    setScheduledSessions([]);
    setUnscheduledSessions([]);
    setView('editor');
    setActiveStep('institution');
    setStatusMessage('Started new institution profile.');
  };

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
      
      const slotIndex = slots.indexOf(session.slot);
      if (slotIndex === -1) continue;

      for (let i = 0; i < session.duration_slots; i++) {
        const targetSlot = slots[slotIndex + i];
        if (!targetSlot) break;

        if (!grid[session.day][targetSlot]) {
          grid[session.day][targetSlot] = [];
        }
        grid[session.day][targetSlot].push(session);
      }
    }

    return grid;
  }, [institution.workingDays, scheduledSessions, slots]);

  const conflicts = useMemo(() => {
    const list: string[] = [];
    
    for (const day of institution.workingDays) {
      for (const slot of slots) {
        const sessions = timetableGrid[day]?.[slot] ?? [];
        if (sessions.length <= 1) continue;

        // Check Teacher Overlap
        const teacherIds = sessions.map(s => s.teacher_id);
        const uniqueTeachers = new Set(teacherIds);
        if (uniqueTeachers.size < teacherIds.length) {
          list.push(`Teacher overlap on ${day} at ${slot}`);
        }

        // Check Room Overlap
        const roomIds = sessions.map(s => s.room_id);
        const uniqueRooms = new Set(roomIds);
        if (uniqueRooms.size < roomIds.length) {
          list.push(`Room overlap on ${day} at ${slot}`);
        }

        // Check Division Overlap
        const divisionIds = sessions.map(s => s.division_id);
        const uniqueDivisions = new Set(divisionIds);
        if (uniqueDivisions.size < divisionIds.length) {
          list.push(`Division overlap on ${day} at ${slot}`);
        }
      }
    }
    
    return [...new Set(list)]; // Deduplicate
  }, [institution.workingDays, slots, timetableGrid]);

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
      teacher_constraints: teachers.map((t) => ({
        teacher_id: t.id,
        max_lectures_per_day: t.maxLecturesPerDay,
        max_lectures_per_week: t.maxLecturesPerWeek,
      })),
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
      {view === 'dashboard' ? (
        <main className="content" style={{ gridColumn: '1 / -1' }}>
          <Dashboard
            onLoadInstitution={handleLoadInstitution}
            onNewInstitution={handleNewInstitution}
          />
        </main>
      ) : (
        <>
          <aside className="sidebar">
            <div className="brand">
              <div className="brand-mark">TF</div>
              <div>
                <strong>TimeFlex</strong>
                <span>Enterprise scheduler</span>
              </div>
            </div>

            <button className="nav-back" onClick={() => setView('dashboard')}>
              ← Back to Dashboard
            </button>

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
              <InstitutionSetup
                institution={institution}
                onUpdate={setInstitution}
                dayOptions={dayOptions}
              />
            )}

            {activeStep === 'structure' && (
              <AcademicStructure
                department={department}
                onDepartmentUpdate={setDepartment}
                divisions={divisions}
                onAddDivision={(d) => setDivisions([...divisions, d])}
                onRemoveDivision={(id) => setDivisions(divisions.filter((d) => d.id !== id))}
              />
            )}

            {activeStep === 'teachers' && (
              <TeacherSetup
                teachers={teachers}
                onAddTeacher={(t) => setTeachers([...teachers, t])}
                onRemoveTeacher={(id) => setTeachers(teachers.filter((t) => t.id !== id))}
              />
            )}

            {activeStep === 'rooms' && (
              <RoomSetup
                rooms={rooms}
                onAddRoom={(r) => setRooms([...rooms, r])}
                onRemoveRoom={(id) => setRooms(rooms.filter((r) => r.id !== id))}
              />
            )}

            {activeStep === 'subjects' && (
              <SubjectSetup
                subjects={subjects}
                teachers={teachers}
                rooms={rooms}
                onAddSubject={(s) => setSubjects([...subjects, s])}
                onRemoveSubject={(id) => setSubjects(subjects.filter((s) => s.id !== id))}
              />
            )}

            {activeStep === 'generate' && (
              <TimetablePreview
                institution={institution}
                divisions={divisions}
                teachers={teachers}
                rooms={rooms}
                subjects={subjects}
                slots={slots}
                scheduledSessions={scheduledSessions}
                unscheduledSessions={unscheduledSessions}
                timetableGrid={timetableGrid}
                conflicts={conflicts}
                onGenerate={handleGenerate}
                onSaveEdits={handleSaveEdits}
                onSessionUpdate={handleSessionUpdate}
              />
            )}
          </main>
        </>
      )}
    </div>
  );
}
