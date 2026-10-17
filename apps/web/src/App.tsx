import { useEffect, useMemo, useState } from 'react';

import {
  createInstitution,
  createTimetable,
  listTimetables,
  solveTimetable,
  updateInstitution,
  updateTimetable,
} from './api';
import { AcademicStructure } from './components/AcademicStructure';
import { ChatSetup } from './components/ChatSetup';
import { Dashboard } from './components/Dashboard';
import { InstitutionSetup } from './components/InstitutionSetup';
import { RoomSetup } from './components/RoomSetup';
import { SubjectSetup } from './components/SubjectSetup';
import { TeacherSetup } from './components/TeacherSetup';
import { TimetablePreview } from './components/TimetablePreview';
import { UserManagement } from './components/UserManagement';
import type {
  AuthUser,
  ChatDraft,
  DepartmentForm,
  DivisionForm,
  InstitutionForm,
  InstitutionRecord,
  RoomForm,
  ScheduledSession,
  SessionRequest,
  SubjectForm,
  TeacherForm,
  TimetableRecord,
} from './types';
import { buildSolverRequest, slotsFor, createId, findConflicts, setupProblems, setupWarnings } from './utils';

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
  { id: 'chat', label: 'Quick setup (AI)' },
  { id: 'institution', label: 'Institution' },
  { id: 'structure', label: 'Structure' },
  { id: 'teachers', label: 'Teachers' },
  { id: 'rooms', label: 'Rooms & Labs' },
  { id: 'subjects', label: 'Subjects' },
  { id: 'generate', label: 'Generate' },
];

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Snapshots used to tell whether anything changed since the last save or load.
const profileKey = (value: {
  institution: InstitutionForm;
  department: DepartmentForm;
  divisions: DivisionForm[];
  teachers: TeacherForm[];
  rooms: RoomForm[];
  subjects: SubjectForm[];
}) => JSON.stringify(value);
const sessionsKey = (scheduled: ScheduledSession[], unscheduled: SessionRequest[]) => JSON.stringify([scheduled, unscheduled]);
const EMPTY_SESSIONS = sessionsKey([], []);

interface AppProps {
  user: AuthUser;
  onSignOut: () => Promise<void>;
}

export function App({ user, onSignOut }: AppProps) {
  // Single-owner app: admins set everything up; viewers browse and export timetables.
  const canEdit = user.role === 'admin';
  const visibleSteps = canEdit ? steps : [{ id: 'generate', label: 'Timetable' }];
  const [view, setView] = useState<'dashboard' | 'editor' | 'users'>('dashboard');
  const [activeStep, setActiveStep] = useState(steps[0].id);
  const [institution, setInstitution] = useState(initialInstitution);
  const [department, setDepartment] = useState(initialDepartment);
  const [divisions, setDivisions] = useState<DivisionForm[]>([]);
  const [teachers, setTeachers] = useState<TeacherForm[]>([]);
  const [rooms, setRooms] = useState<RoomForm[]>([]);
  const [subjects, setSubjects] = useState<SubjectForm[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [timetableId, setTimetableId] = useState<string | null>(null);
  const [scheduledSessions, setScheduledSessions] = useState<ScheduledSession[]>([]);
  const [unscheduledSessions, setUnscheduledSessions] = useState<SessionRequest[]>([]);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [versions, setVersions] = useState<TimetableRecord[]>([]);
  const [savedProfile, setSavedProfile] = useState(() =>
    profileKey({ institution: initialInstitution, department: initialDepartment, divisions: [], teachers: [], rooms: [], subjects: [] }),
  );
  const [savedSessions, setSavedSessions] = useState(EMPTY_SESSIONS);

  const currentProfile = profileKey({ institution, department, divisions, teachers, rooms, subjects });
  const profileDirty = canEdit && currentProfile !== savedProfile;
  const sessionsDirty = canEdit && sessionsKey(scheduledSessions, unscheduledSessions) !== savedSessions;
  const dirty = profileDirty || sessionsDirty;

  // Warn before closing or reloading the tab with unsaved work.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const confirmDiscard = (what: string) => !dirty || window.confirm(`You have unsaved changes. ${what}`);

  const resetSchedule = () => {
    setVersions([]);
    setTimetableId(null);
    setScheduledSessions([]);
    setUnscheduledSessions([]);
    setDiagnostics([]);
    setSavedSessions(EMPTY_SESSIONS);
  };

  const showVersion = (version: TimetableRecord) => {
    setTimetableId(version.id);
    setScheduledSessions(version.generatedSessions ?? []);
    setUnscheduledSessions(version.report?.unscheduledSessions ?? []);
    setDiagnostics(version.report?.diagnostics ?? []);
    setSavedSessions(sessionsKey(version.generatedSessions ?? [], version.report?.unscheduledSessions ?? []));
  };

  const handleLoadInstitution = async (record: InstitutionRecord) => {
    const profile = (record.data as any)?.profile || record.data || {};
    const loaded = {
      institution: { ...initialInstitution, ...(profile.institution ?? {}) },
      department: profile.department || initialDepartment,
      divisions: profile.divisions || [],
      teachers: profile.teachers || [],
      rooms: profile.rooms || [],
      subjects: profile.subjects || [],
    };
    setInstitution(loaded.institution);
    setDepartment(loaded.department);
    setDivisions(loaded.divisions);
    setTeachers(loaded.teachers);
    setRooms(loaded.rooms);
    setSubjects(loaded.subjects);
    setSavedProfile(profileKey(loaded));
    setInstitutionId(record.id);
    resetSchedule();
    setView('editor');
    setActiveStep('generate');
    setStatusMessage(`Loaded ${record.name}.`);

    try {
      const all = await listTimetables(record.id);
      setVersions(all);
      const latest = all.find((version) => version.generatedSessions?.length);
      if (latest) {
        showVersion(latest);
        setStatusMessage(`Loaded ${record.name} with its latest timetable (${latest.status}).`);
      }
    } catch {
      // The profile is still usable without its previous timetable.
    }
  };

  const handleNewInstitution = () => {
    setSavedProfile(
      profileKey({ institution: initialInstitution, department: initialDepartment, divisions: [], teachers: [], rooms: [], subjects: [] }),
    );
    setInstitution(initialInstitution);
    setDepartment(initialDepartment);
    setDivisions([]);
    setTeachers([]);
    setRooms([]);
    setSubjects([]);
    setInstitutionId(null);
    resetSchedule();
    setView('editor');
    setActiveStep('chat');
    setStatusMessage('New profile. Describe your department in plain words, or fill the tabs by hand.');
  };

  /** Merge a reviewed chat draft into the profile, matching existing records by name. */
  const handleChatApply = (draft: ChatDraft) => {
    const nextTeachers = teachers.map((t) => ({ ...t }));
    for (const item of draft.teachers) {
      const existing = nextTeachers.find((t) => sameName(t.name, item.name));
      if (existing) {
        Object.assign(existing, {
          maxLecturesPerDay: item.maxLecturesPerDay,
          maxLecturesPerWeek: item.maxLecturesPerWeek,
          unavailableDays: [...new Set([...(existing.unavailableDays ?? []), ...item.unavailableDays])],
        });
      } else {
        nextTeachers.push({ id: createId(), ...item, canTeachLabs: true });
      }
    }

    const nextRooms = [...rooms];
    for (const item of draft.rooms) {
      if (!nextRooms.some((r) => sameName(r.name, item.name))) nextRooms.push({ id: createId(), ...item });
    }

    const nextDivisions = divisions.map((d) => ({ ...d }));
    for (const item of draft.divisions) {
      const existing = nextDivisions.find((d) => sameName(d.name, item.name));
      if (existing) {
        existing.batches = [...new Set([...existing.batches, ...item.batches])];
        if (item.size) existing.size = item.size;
      } else {
        nextDivisions.push({
          id: createId(),
          name: item.name,
          batches: item.batches,
          size: item.size ?? 0,
          yearLabel: [department.yearLabel, department.semesterLabel].filter(Boolean).join(' · '),
        });
      }
    }

    const nextSubjects = subjects.map((s) => ({ ...s }));
    for (const item of draft.subjects) {
      const teacherId = nextTeachers.find((t) => item.teacher && sameName(t.name, item.teacher))?.id ?? '';
      const roomId = nextRooms.find((r) => item.room && sameName(r.name, item.room))?.id ?? '';
      const fields = {
        name: item.name,
        isLab: item.isLab,
        durationSlots: item.durationSlots,
        sessionsPerWeek: item.sessionsPerWeek,
      };
      const existing = nextSubjects.find((s) => sameName(s.name, item.name));
      if (existing) {
        Object.assign(existing, fields, {
          teacherId: teacherId || existing.teacherId,
          roomId: roomId || existing.roomId,
        });
      } else {
        nextSubjects.push({ id: createId(), ...fields, teacherId, roomId, divisionIds: [], teacherOverrides: {} });
      }
    }

    const inst = draft.institution;
    setInstitution((current) => ({
      ...current,
      name: inst.name ?? current.name,
      workingDays: inst.workingDays.length ? inst.workingDays : current.workingDays,
      startTime: inst.startTime ?? current.startTime,
      endTime: inst.endTime ?? current.endTime,
      slotDurationMinutes: inst.slotDurationMinutes ?? current.slotDurationMinutes,
      breakAfterSlots: inst.breakAfterSlots ?? current.breakAfterSlots,
      breakDurationMinutes: inst.breakDurationMinutes ?? current.breakDurationMinutes,
      // A break described in the chat replaces the break list; otherwise keep what was set up.
      breaks: inst.breakAfterSlots && inst.breakDurationMinutes ? undefined : current.breaks,
    }));
    setTeachers(nextTeachers);
    setRooms(nextRooms);
    setDivisions(nextDivisions);
    setSubjects(nextSubjects);

    const incomplete = nextSubjects.filter((s) => !s.teacherId).length;
    setActiveStep(incomplete ? 'subjects' : 'institution');
    setStatusMessage(
      incomplete
        ? `Draft applied. ${incomplete} subject(s) still need a teacher.`
        : 'Draft applied. Check each tab, then Generate. Subjects without a room get any suitable one.',
    );
  };

  const slots = useMemo(() => slotsFor(institution), [institution]);

  const names = useMemo(() => {
    const map: Record<string, string> = {};
    for (const item of [...divisions, ...teachers, ...rooms, ...subjects]) map[item.id] = item.name;
    return map;
  }, [divisions, teachers, rooms, subjects]);

  const conflicts = useMemo(
    () => findConflicts(scheduledSessions, {
        days: institution.workingDays,
        slots,
        teachers,
        rooms,
        names,
        labCountsAsOne: Boolean(institution.labCountsAsOne),
      }),
    [scheduledSessions, institution.workingDays, institution.labCountsAsOne, slots, teachers, rooms, names],
  );

  const profile = { days: institution.workingDays, slots, divisions, subjects, teachers, rooms };
  const problems = setupProblems(profile);
  const warnings = setupWarnings(profile);
  const departmentLabel = [department.name, department.yearLabel, department.semesterLabel].filter(Boolean).join(' · ');

  const saveProfile = async () => {
    const payload = {
      name: institution.name || department.name || 'Untitled institution',
      type: institution.type,
      profile: { institution, department, divisions, teachers, rooms, subjects, slots },
    };
    const snapshot = currentProfile;
    if (institutionId) {
      await updateInstitution(institutionId, payload);
      setSavedProfile(snapshot);
      return institutionId;
    }
    const record = await createInstitution(payload);
    setInstitutionId(record.id);
    setSavedProfile(snapshot);
    return record.id;
  };

  const handleGenerate = async () => {
    if (problems.length) {
      setStatusMessage('Fix the setup issues listed on the Generate tab first.');
      return;
    }
    if (sessionsDirty && !window.confirm('Regenerating keeps only locked sessions. Unsaved moves to other sessions will not carry over. Continue?')) {
      return;
    }
    setBusy(true);
    try {
      setStatusMessage('Saving institution profile...');
      const resolvedInstitutionId = await saveProfile();

      const locked = scheduledSessions.filter((session) => session.locked);
      const request = buildSolverRequest({
        days: institution.workingDays,
        slots,
        divisions,
        teachers,
        rooms,
        subjects,
        locked,
        labCountsAsOne: Boolean(institution.labCountsAsOne),
      });

      setStatusMessage('Creating timetable version...');
      const timetableRecord = await createTimetable(resolvedInstitutionId, {
        label: `Version ${versions.length + 1}`,
        request,
      });
      setStatusMessage(`Solving ${request.sessions.length} sessions with OR-Tools...`);
      const solved = await solveTimetable(timetableRecord.id);
      // Only switch to the new version once it has a result, so a failed solve
      // leaves the previous version on screen and as the save target.
      setTimetableId(timetableRecord.id);
      showVersion(solved.timetable);
      setVersions([solved.timetable, ...versions]);
      setStatusMessage(
        solved.solver.status === 'ok'
          ? `All ${solved.solver.scheduled_sessions.length} sessions placed${locked.length ? ` (${locked.length} locked kept)` : ''}.`
          : `Placed ${solved.solver.scheduled_sessions.length}, could not place ${solved.solver.unscheduled_sessions.length}. See the notes below the grid.`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to generate timetable.');
    } finally {
      setBusy(false);
    }
  };

  const handleSessionUpdate = (sessionId: string, patch: Partial<ScheduledSession>) => {
    setScheduledSessions((current) =>
      current.map((session) => (session.id === sessionId ? { ...session, ...patch } : session)),
    );
  };

  const currentVersion = versions.find((version) => version.id === timetableId);
  const isApproved = currentVersion?.status === 'approved';

  /** Put a session the solver could not place into the timetable by hand. */
  const handlePlaceSession = (sessionId: string, where: { day: string; slot: string; room_id: string }) => {
    const session = unscheduledSessions.find((item) => item.id === sessionId);
    if (!session) return;
    setUnscheduledSessions((current) => current.filter((item) => item.id !== sessionId));
    setScheduledSessions((current) => [...current, { ...session, ...where, batch: session.batch ?? null, locked: false }]);
  };

  /** Take a session out of the grid; it goes back to the unplaced list. */
  const handleUnplaceSession = (sessionId: string) => {
    const session = scheduledSessions.find((item) => item.id === sessionId);
    if (!session) return;
    const { day: _day, slot: _slot, ...rest } = session;
    setScheduledSessions((current) => current.filter((item) => item.id !== sessionId));
    setUnscheduledSessions((current) => [...current, { ...rest, locked: false }]);
  };

  const handleSaveEdits = async () => {
    setBusy(true);
    setStatusMessage('Saving...');
    try {
      await saveProfile();
      // Approved versions are read-only on the server; saving the profile must not touch them.
      if (timetableId && !isApproved) {
        const saved = await updateTimetable(timetableId, {
          generatedSessions: scheduledSessions,
          report: { unscheduledSessions, diagnostics },
        });
        setVersions((list) => list.map((version) => (version.id === saved.id ? saved : version)));
        setSavedSessions(sessionsKey(scheduledSessions, unscheduledSessions));
      }
      setStatusMessage(
        !timetableId
          ? 'Profile saved.'
          : isApproved
            ? 'Profile saved. The approved timetable was left unchanged; unapprove it to edit.'
            : 'Profile and timetable edits saved.',
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to save edits.');
    } finally {
      setBusy(false);
    }
  };

  const handleSelectVersion = (id: string) => {
    const version = versions.find((item) => item.id === id);
    if (!version) return;
    if (sessionsDirty && !window.confirm('You have unsaved timetable edits. Switch versions and discard them?')) return;
    showVersion(version);
    setStatusMessage(`Showing ${version.label} (${version.status}).`);
  };

  const handleSetStatus = async (status: 'approved' | 'edited') => {
    if (!timetableId) return;
    setBusy(true);
    try {
      // Approving saves the current edits with it, so the approved version is exactly what is on screen.
      // Unapproving only changes the status.
      const saved = await updateTimetable(
        timetableId,
        status === 'approved'
          ? { generatedSessions: scheduledSessions, report: { unscheduledSessions, diagnostics }, status }
          : { status },
      );
      if (status === 'approved') setSavedSessions(sessionsKey(scheduledSessions, unscheduledSessions));
      setVersions((list) => list.map((version) => (version.id === saved.id ? saved : version)));
      setStatusMessage(
        status === 'approved' ? `${saved.label} approved. Export it from this tab.` : `${saved.label} reopened for edits.`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to update the version.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell">
      {view === 'users' ? (
        <main className="content" style={{ gridColumn: '1 / -1' }}>
          <UserManagement currentUser={user} onClose={() => setView('dashboard')} />
        </main>
      ) : view === 'dashboard' ? (
        <main className="content" style={{ gridColumn: '1 / -1' }}>
          <Dashboard
            user={user}
            canEdit={canEdit}
            onLoadInstitution={handleLoadInstitution}
            onNewInstitution={handleNewInstitution}
            onOpenUsers={() => setView('users')}
            onSignOut={onSignOut}
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

            <button
              className="nav-back"
              onClick={() => confirmDiscard('Leave without saving?') && setView('dashboard')}
            >
              ← Back to Dashboard
            </button>

            <nav className="step-list">
              {visibleSteps.map((step) => (
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
            {canEdit && (
              <button type="button" className="secondary" onClick={handleSaveEdits} disabled={busy}>
                Save profile
              </button>
            )}
            {dirty && (
              <p className="unsaved" role="status">
                Unsaved changes
              </p>
            )}
            <div className="status-card" aria-live="polite">
              <span>Status</span>
              <p>{statusMessage || 'Fill the setup tabs to start generating.'}</p>
            </div>
          </aside>

          <main className="content">
            {activeStep === 'chat' && (
              <ChatSetup
                onApply={handleChatApply}
                context={{ teachers: teachers.map((t) => t.name), rooms: rooms.map((r) => r.name) }}
              />
            )}

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
                onUpdateDivision={(d) => setDivisions(divisions.map((item) => (item.id === d.id ? d : item)))}
                onRemoveDivision={(id) => setDivisions(divisions.filter((d) => d.id !== id))}
              />
            )}

            {activeStep === 'teachers' && (
              <TeacherSetup
                teachers={teachers}
                subjects={subjects}
                divisions={divisions}
                days={institution.workingDays}
                slots={slots}
                onAddTeacher={(t) => setTeachers([...teachers, t])}
                onUpdateTeacher={(t) => setTeachers(teachers.map((item) => (item.id === t.id ? t : item)))}
                onRemoveTeacher={(id) => setTeachers(teachers.filter((t) => t.id !== id))}
              />
            )}

            {activeStep === 'rooms' && (
              <RoomSetup
                rooms={rooms}
                days={institution.workingDays}
                slots={slots}
                onAddRoom={(r) => setRooms([...rooms, r])}
                onUpdateRoom={(r) => setRooms(rooms.map((item) => (item.id === r.id ? r : item)))}
                onRemoveRoom={(id) => setRooms(rooms.filter((r) => r.id !== id))}
              />
            )}

            {activeStep === 'subjects' && (
              <SubjectSetup
                subjects={subjects}
                teachers={teachers}
                rooms={rooms}
                divisions={divisions}
                warnings={warnings}
                onAddSubject={(s) => setSubjects([...subjects, s])}
                onUpdateSubject={(s) => setSubjects(subjects.map((item) => (item.id === s.id ? s : item)))}
                onRemoveSubject={(id) => setSubjects(subjects.filter((s) => s.id !== id))}
              />
            )}

            {activeStep === 'generate' && (
              <TimetablePreview
                institution={institution}
                departmentLabel={departmentLabel}
                divisions={divisions}
                teachers={teachers}
                rooms={rooms}
                slots={slots}
                names={names}
                busy={busy}
                problems={problems}
                warnings={warnings}
                scheduledSessions={scheduledSessions}
                unscheduledSessions={unscheduledSessions}
                diagnostics={diagnostics}
                conflicts={conflicts}
                versions={versions}
                timetableId={timetableId}
                onGenerate={handleGenerate}
                onSaveEdits={handleSaveEdits}
                onSessionUpdate={handleSessionUpdate}
                onSelectVersion={handleSelectVersion}
                onSetStatus={handleSetStatus}
                onPlaceSession={handlePlaceSession}
                onUnplaceSession={handleUnplaceSession}
                readOnly={!canEdit}
              />
            )}
          </main>
        </>
      )}
    </div>
  );
}
