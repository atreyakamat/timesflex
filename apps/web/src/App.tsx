import { useEffect, useMemo, useRef, useState } from 'react';

import {
  createTimetable,
  currentSession,
  hasSession,
  listTimetables,
  setUnauthorizedHandler,
  signOut,
  solveTimetable,
  updateInstitution,
  updateTimetable,
} from './api';
import { AcademicStructure } from './components/AcademicStructure';
import { Attendance } from './components/Attendance';
import { Auth } from './components/Auth';
import { ChatSetup } from './components/ChatSetup';
import { FluidBackground } from './components/FluidBackground';
import { FreeRooms } from './components/FreeRooms';
import { Landing } from './components/Landing';
import { InstitutionSetup } from './components/InstitutionSetup';
import { Overview } from './components/Overview';
import { People } from './components/People';
import { RoomSetup } from './components/RoomSetup';
import { SubjectSetup } from './components/SubjectSetup';
import { Substitutions } from './components/Substitutions';
import { TeacherProfile, avatarHue, initials } from './components/TeacherProfile';
import { TeacherSetup } from './components/TeacherSetup';
import { ThemeToggle } from './components/ThemeToggle';
import { TimetablePreview } from './components/TimetablePreview';
import { Today } from './components/Today';
import { Welcome, type StartMode } from './components/Welcome';
import { emptyOperations } from './ops';
import { sampleProfile, type ProfileData } from './samples';
import { useTheme } from './theme';
import type {
  Account,
  AccountSession,
  ChatDraft,
  DepartmentForm,
  DivisionForm,
  InstitutionForm,
  InstitutionRecord,
  OperationsData,
  RoomForm,
  ScheduledSession,
  SessionRequest,
  SubjectForm,
  TeacherForm,
  TimetableRecord,
} from './types';
import { buildSlots, buildSolverRequest, createId, findConflicts, setupProblems, setupWarnings } from './utils';

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

export type Page =
  | 'overview'
  | 'quick'
  | 'basics'
  | 'classes'
  | 'teachers'
  | 'rooms'
  | 'subjects'
  | 'timetable'
  | 'today'
  | 'substitutions'
  | 'free-rooms'
  | 'attendance'
  | 'people';

/** The timetable wizard, in order. Quick setup is an optional shortcut into it. */
const setupSteps: { id: Page; label: string; hint: string }[] = [
  { id: 'quick', label: 'Describe it (AI)', hint: 'Optional shortcut' },
  { id: 'basics', label: 'Basics', hint: 'Days, hours, breaks' },
  { id: 'teachers', label: 'Teachers', hint: 'Profiles and expertise' },
  { id: 'classes', label: 'Classes', hint: 'Divisions and batches' },
  { id: 'rooms', label: 'Rooms & labs', hint: 'Capacity and type' },
  { id: 'subjects', label: 'Subjects', hint: 'Who teaches what' },
  { id: 'timetable', label: 'Timetable', hint: 'Generate and edit' },
];

/** Tools that run on top of a finished timetable. */
const dailyTools: { id: Page; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: '◷' },
  { id: 'substitutions', label: 'Substitutions', icon: '⇄' },
  { id: 'free-rooms', label: 'Free rooms', icon: '▢' },
  { id: 'attendance', label: 'Attendance', icon: '✓' },
];

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';
type Screen = 'checking' | 'landing' | 'signup' | 'login' | 'welcome' | 'editor';

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [screen, setScreen] = useState<Screen>(hasSession() ? 'checking' : 'landing');
  const [account, setAccount] = useState<Account | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [accountMenu, setAccountMenu] = useState(false);
  const [page, setPage] = useState<Page>('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [institution, setInstitution] = useState(initialInstitution);
  const [department, setDepartment] = useState(initialDepartment);
  const [divisions, setDivisions] = useState<DivisionForm[]>([]);
  const [teachers, setTeachers] = useState<TeacherForm[]>([]);
  const [rooms, setRooms] = useState<RoomForm[]>([]);
  const [subjects, setSubjects] = useState<SubjectForm[]>([]);
  const [operations, setOperations] = useState<OperationsData>(emptyOperations);
  const [statusMessage, setStatusMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [timetableId, setTimetableId] = useState<string | null>(null);
  const [scheduledSessions, setScheduledSessions] = useState<ScheduledSession[]>([]);
  const [sessionsDirty, setSessionsDirty] = useState(false);
  const [unscheduledSessions, setUnscheduledSessions] = useState<SessionRequest[]>([]);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [versions, setVersions] = useState<TimetableRecord[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  // False right after a profile is loaded, so loading it does not count as an edit.
  const hydrated = useRef(false);
  // Set when a freshly applied profile (the sample) must be saved even though it was just loaded.
  const saveAfterLoad = useRef(false);

  const go = (next: Page) => {
    setPage(next);
    setMenuOpen(false);
    // A message belongs to the page it was raised on; callers that navigate set theirs after this.
    setStatusMessage('');
    window.scrollTo({ top: 0 });
  };

  const applyProfile = (profile: Partial<ProfileData>) => {
    hydrated.current = false;
    setInstitution({ ...initialInstitution, ...(profile.institution ?? {}) });
    setDepartment(profile.department || initialDepartment);
    setDivisions(profile.divisions || []);
    setTeachers(profile.teachers || []);
    setRooms(profile.rooms || []);
    setSubjects(profile.subjects || []);
    setOperations({ ...emptyOperations(), ...(profile.operations ?? {}) });
    setVersions([]);
    setTimetableId(null);
    setScheduledSessions([]);
    setSessionsDirty(false);
    setUnscheduledSessions([]);
    setDiagnostics([]);
    setSaveState('saved');
  };

  const handleLoadInstitution = async (record: InstitutionRecord) => {
    const profile = ((record.data as any)?.profile || record.data || {}) as Partial<ProfileData>;
    applyProfile(profile);
    setInstitutionId(record.id);
    setScreen('editor');

    try {
      const all = await listTimetables(record.id);
      setVersions(all);
      const pick = all.find((version) => version.status === 'approved') ?? all.find((version) => version.generatedSessions?.length);
      if (pick) {
        setTimetableId(pick.id);
        setScheduledSessions(pick.generatedSessions);
      }
      go(pick ? 'overview' : profile.subjects?.length ? 'timetable' : 'overview');
    } catch {
      go('overview');
    }
  };

  /** After sign-up: fill the new institution the way the user picked. */
  const handleStart = async (mode: StartMode) => {
    if (mode === 'sample') {
      const sample = sampleProfile();
      applyProfile({ ...sample, institution: { ...sample.institution, name: institution.name || sample.institution.name, type: institution.type } });
      saveAfterLoad.current = true;
      setScreen('editor');
      go('timetable');
      setStatusMessage('Sample department loaded. Press Generate to build its timetable.');
      return;
    }
    setScreen('editor');
    go(mode === 'ai' ? 'quick' : 'teachers');
    setStatusMessage(
      mode === 'ai' ? 'Describe your department in plain words.' : 'Add your first teacher. Each one gets a profile.',
    );
  };

  const openSession = async (session: AccountSession, isNew: boolean) => {
    setAccount(session.account);
    if (!session.institution) {
      setScreen('landing');
      return;
    }
    await handleLoadInstitution(session.institution);
    if (isNew) setScreen('welcome');
  };

  // Resume a saved session on load, and drop back to sign-in whenever the API says it expired.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAccount(null);
      setInstitutionId(null);
      setScreen('login');
    });
    if (!hasSession()) return;
    currentSession()
      .then((session) => openSession(session, false))
      .catch(() => setScreen('landing'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSignOut = async () => {
    setAccountMenu(false);
    try {
      await signOut();
    } catch {
      // Signed out locally either way.
    }
    setAccount(null);
    setInstitutionId(null);
    applyProfile({});
    setScreen('landing');
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
    }));
    setTeachers(nextTeachers);
    setRooms(nextRooms);
    setDivisions(nextDivisions);
    setSubjects(nextSubjects);

    const incomplete = nextSubjects.filter((s) => !s.teacherId).length;
    go(incomplete ? 'subjects' : 'basics');
    setStatusMessage(
      incomplete
        ? `Draft applied. ${incomplete} subject(s) still need a teacher.`
        : 'Draft applied. Walk through each step to check it, then generate.',
    );
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

  const names = useMemo(() => {
    const map: Record<string, string> = {};
    for (const item of [...divisions, ...teachers, ...rooms, ...subjects]) map[item.id] = item.name;
    return map;
  }, [divisions, teachers, rooms, subjects]);

  const conflicts = useMemo(
    () => findConflicts(scheduledSessions, { days: institution.workingDays, slots, teachers, rooms, names }),
    [scheduledSessions, institution.workingDays, slots, teachers, rooms, names],
  );

  const profile = { days: institution.workingDays, slots, divisions, subjects, teachers, rooms };
  const problems = setupProblems(profile);
  const warnings = setupWarnings(profile);
  const departmentLabel = [department.name, department.yearLabel, department.semesterLabel].filter(Boolean).join(' · ');

  // Daily tools run on the approved version when there is one, otherwise on the newest generated one.
  const liveVersion =
    versions.find((version) => version.status === 'approved') ??
    versions.find((version) => version.generatedSessions?.length);
  const liveSessions = liveVersion
    ? liveVersion.id === timetableId
      ? scheduledSessions
      : liveVersion.generatedSessions
    : [];
  const hasTimetable = liveSessions.length > 0;

  const saveProfile = async () => {
    const payload = {
      name: institution.name || department.name || 'Untitled institution',
      type: institution.type,
      profile: { institution, department, divisions, teachers, rooms, subjects, operations, slots },
    };
    if (!institutionId) throw new Error('No institution is open. Sign in again.');
    await updateInstitution(institutionId, payload);
    return institutionId;
  };

  // Autosave the profile a moment after the last change.
  useEffect(() => {
    if (!institutionId) return;
    if (!hydrated.current) {
      hydrated.current = true;
      if (!saveAfterLoad.current) return;
      saveAfterLoad.current = false;
    }
    setSaveState('dirty');
    const timer = setTimeout(() => {
      setSaveState('saving');
      saveProfile()
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'));
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institution, department, divisions, teachers, rooms, subjects, operations]);

  // Autosave hand edits to the open timetable version.
  useEffect(() => {
    if (!sessionsDirty || !timetableId) return;
    setSaveState('dirty');
    const timer = setTimeout(async () => {
      setSaveState('saving');
      try {
        const saved = await updateTimetable(timetableId, { generatedSessions: scheduledSessions });
        setVersions((list) => list.map((version) => (version.id === saved.id ? saved : version)));
        setSessionsDirty(false);
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [scheduledSessions, sessionsDirty, timetableId]);

  const handleGenerate = async () => {
    if (problems.length) {
      setStatusMessage('Fix the setup issues listed above first.');
      return;
    }
    setBusy(true);
    try {
      setStatusMessage('Saving your setup...');
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
      });

      const timetableRecord = await createTimetable(resolvedInstitutionId, {
        label: `Version ${versions.length + 1}`,
        request,
      });
      setTimetableId(timetableRecord.id);

      setStatusMessage(`Solving ${request.sessions.length} sessions...`);
      const solved = await solveTimetable(timetableRecord.id);
      setScheduledSessions(solved.solver.scheduled_sessions);
      setSessionsDirty(false);
      setUnscheduledSessions(solved.solver.unscheduled_sessions);
      setDiagnostics(solved.solver.diagnostics ?? []);
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
    setSessionsDirty(true);
  };

  const handleSelectVersion = (id: string) => {
    const version = versions.find((item) => item.id === id);
    if (!version) return;
    setTimetableId(version.id);
    setScheduledSessions(version.generatedSessions ?? []);
    setSessionsDirty(false);
    setUnscheduledSessions([]);
    setDiagnostics([]);
    setStatusMessage(`Showing ${version.label}.`);
  };

  const handleSetStatus = async (status: 'approved' | 'edited') => {
    if (!timetableId) return;
    setBusy(true);
    try {
      // Approving saves the current edits with it, so the approved version is exactly what is on screen.
      const saved = await updateTimetable(timetableId, { generatedSessions: scheduledSessions, status });
      setSessionsDirty(false);
      setVersions((list) => list.map((version) => (version.id === saved.id ? saved : version)));
      setStatusMessage(
        status === 'approved'
          ? `${saved.label} approved. Today, substitutions and attendance now use it.`
          : `${saved.label} reopened for edits.`,
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to update the version.');
    } finally {
      setBusy(false);
    }
  };

  if (screen === 'checking') {
    return (
      <div className="splash">
        <FluidBackground />
        <div className="brand-mark pulse">TF</div>
      </div>
    );
  }

  if (screen === 'landing') {
    return (
      <Landing
        theme={theme}
        onToggleTheme={toggleTheme}
        onSignUp={() => setScreen('signup')}
        onSignIn={() => setScreen('login')}
      />
    );
  }

  if (screen === 'signup' || screen === 'login') {
    return (
      <Auth
        mode={screen}
        theme={theme}
        onToggleTheme={toggleTheme}
        onModeChange={setScreen}
        onBack={() => setScreen('landing')}
        onSignedIn={openSession}
      />
    );
  }

  if (screen === 'welcome') {
    return (
      <Welcome
        personName={account?.name ?? ''}
        institutionName={institution.name || 'your institution'}
        onStart={handleStart}
      />
    );
  }

  const stepDone: Record<string, boolean> = {
    quick: teachers.length > 0 || subjects.length > 0,
    basics: Boolean(institution.name && institution.workingDays.length && slots.length),
    classes: divisions.length > 0,
    teachers: teachers.length > 0,
    rooms: rooms.length > 0,
    subjects: subjects.length > 0 && problems.length === 0,
    timetable: hasTimetable,
  };
  const profileTeacher = teachers.find((teacher) => teacher.id === profileId);
  const stepIndex = setupSteps.findIndex((step) => step.id === page);
  const nextStep = stepIndex >= 0 ? setupSteps[stepIndex + 1] : undefined;
  const prevStep = stepIndex > 0 ? setupSteps[stepIndex - 1] : undefined;
  const coreSteps = setupSteps.slice(1);
  const doneCount = coreSteps.filter((step) => stepDone[step.id]).length;

  const pageTitle =
    page === 'overview'
      ? 'Overview'
      : page === 'people'
        ? 'People'
        : (setupSteps.find((step) => step.id === page) ?? dailyTools.find((tool) => tool.id === page))?.label;

  const saveLabel: Record<SaveState, string> = {
    saved: 'All changes saved',
    saving: 'Saving…',
    dirty: 'Unsaved changes',
    error: 'Could not save. Is the API running?',
  };

  const shared = {
    days: institution.workingDays,
    slots,
    divisions,
    teachers,
    rooms,
    subjects,
    names,
  };

  return (
    <div className={`app-shell ${menuOpen ? 'menu-open' : ''}`}>
      <FluidBackground />
      <aside className="sidebar glass">
        <button type="button" className="brand" onClick={() => go('overview')} title="Overview">
          <div className="brand-mark">TF</div>
          <div>
            <strong>TimeFlex</strong>
            <span>{institution.name || 'Your institution'}</span>
          </div>
        </button>

        <nav className="nav">
          <button type="button" className={`nav-item ${page === 'overview' ? 'active' : ''}`} onClick={() => go('overview')}>
            <span className="nav-icon">⌂</span>
            Overview
          </button>

          <div className="nav-section">
            <span>Build your timetable</span>
            <small>
              {doneCount}/{coreSteps.length}
            </small>
          </div>
          <div className="nav-progress">
            <div style={{ width: `${(doneCount / coreSteps.length) * 100}%` }} />
          </div>
          {setupSteps.map((step, index) => (
            <button
              key={step.id}
              type="button"
              className={`nav-item step ${page === step.id ? 'active' : ''} ${stepDone[step.id] ? 'done' : ''}`}
              onClick={() => go(step.id)}
            >
              <span className="step-dot">{stepDone[step.id] ? '✓' : index === 0 ? '✦' : index}</span>
              <span className="nav-label">
                {step.label}
                <small>{step.hint}</small>
              </span>
            </button>
          ))}

          <div className="nav-section">
            <span>Run your week</span>
            {!hasTimetable && <small title="Generate a timetable to unlock">🔒</small>}
          </div>
          {dailyTools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className={`nav-item ${page === tool.id ? 'active' : ''}`}
              onClick={() => go(tool.id)}
              disabled={!hasTimetable}
              title={hasTimetable ? '' : 'Generate a timetable to unlock'}
            >
              <span className="nav-icon">{tool.icon}</span>
              {tool.label}
            </button>
          ))}

          <div className="nav-section">
            <span>Directory</span>
          </div>
          <button type="button" className={`nav-item ${page === 'people' ? 'active' : ''}`} onClick={() => go('people')}>
            <span className="nav-icon">☺</span>
            People
          </button>
        </nav>

        <div className="sidebar-footer">
          {accountMenu && (
            <div className="account-menu glass">
              <span className="muted small">Signed in as</span>
              <strong>{account?.email}</strong>
              <button type="button" className="ghost small" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          )}
          <button type="button" className="account-chip" onClick={() => setAccountMenu(!accountMenu)} aria-expanded={accountMenu}>
            <span className="avatar small" style={{ ['--hue' as string]: avatarHue(account?.name ?? '') }}>
              {initials(account?.name ?? '?')}
            </span>
            <span className="account-text">
              <strong>{account?.name}</strong>
              <small>Institution admin</small>
            </span>
            <span className="muted">⋯</span>
          </button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setMenuOpen(false)} />

      <div className="main">
        <header className="topbar glass">
          <button type="button" className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu">
            ☰
          </button>
          <div className="topbar-title">
            <span>{institution.name || 'Untitled institution'}</span>
            <strong>{pageTitle}</strong>
          </div>
          <span className={`save-state ${saveState}`}>{saveLabel[saveState]}</span>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </header>

        {statusMessage && (
          <div className="status-strip" role="status">
            <span>{statusMessage}</span>
            <button type="button" onClick={() => setStatusMessage('')} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}

        <main className="content">
          {page === 'overview' && (
            <Overview
              institution={institution}
              departmentLabel={departmentLabel}
              {...shared}
              steps={coreSteps.map((step) => ({ ...step, done: stepDone[step.id] }))}
              sessions={liveSessions}
              liveVersion={liveVersion}
              operations={operations}
              onGo={go}
            />
          )}

          {page === 'quick' && (
            <ChatSetup
              onApply={handleChatApply}
              context={{ teachers: teachers.map((t) => t.name), rooms: rooms.map((r) => r.name) }}
            />
          )}

          {page === 'basics' && (
            <InstitutionSetup institution={institution} onUpdate={setInstitution} dayOptions={dayOptions} slots={slots} />
          )}

          {page === 'classes' && (
            <AcademicStructure
              department={department}
              onDepartmentUpdate={setDepartment}
              divisions={divisions}
              teachers={teachers}
              onAddDivision={(d) => setDivisions([...divisions, d])}
              onUpdateDivision={(d) => setDivisions(divisions.map((item) => (item.id === d.id ? d : item)))}
              onRemoveDivision={(id) => setDivisions(divisions.filter((d) => d.id !== id))}
            />
          )}

          {page === 'teachers' && (
            <TeacherSetup
              teachers={teachers}
              subjects={subjects}
              divisions={divisions}
              days={institution.workingDays}
              slots={slots}
              onAddTeacher={(t) => setTeachers([...teachers, t])}
              onUpdateTeacher={(t) => setTeachers(teachers.map((item) => (item.id === t.id ? t : item)))}
              onRemoveTeacher={(id) => setTeachers(teachers.filter((t) => t.id !== id))}
              onOpenProfile={setProfileId}
            />
          )}

          {page === 'rooms' && (
            <RoomSetup
              rooms={rooms}
              days={institution.workingDays}
              slots={slots}
              onAddRoom={(r) => setRooms([...rooms, r])}
              onUpdateRoom={(r) => setRooms(rooms.map((item) => (item.id === r.id ? r : item)))}
              onRemoveRoom={(id) => setRooms(rooms.filter((r) => r.id !== id))}
            />
          )}

          {page === 'subjects' && (
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

          {page === 'timetable' && (
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
              codesBySubject={Object.fromEntries(subjects.filter((s) => s.code).map((s) => [s.id, s.code!]))}
              unscheduledSessions={unscheduledSessions}
              diagnostics={diagnostics}
              conflicts={conflicts}
              versions={versions}
              timetableId={timetableId}
              onGenerate={handleGenerate}
              onSessionUpdate={handleSessionUpdate}
              onSelectVersion={handleSelectVersion}
              onSetStatus={handleSetStatus}
              onGo={go}
            />
          )}

          {page === 'today' && (
            <Today {...shared} sessions={liveSessions} operations={operations} liveVersion={liveVersion} onGo={go} />
          )}

          {page === 'substitutions' && (
            <Substitutions {...shared} sessions={liveSessions} operations={operations} onChange={setOperations} />
          )}

          {page === 'free-rooms' && <FreeRooms {...shared} sessions={liveSessions} />}

          {page === 'attendance' && (
            <Attendance {...shared} sessions={liveSessions} operations={operations} onChange={setOperations} onGo={go} />
          )}

          {page === 'people' && (
            <People
              {...shared}
              sessions={liveSessions}
              operations={operations}
              onUpdateTeacher={(t) => setTeachers(teachers.map((item) => (item.id === t.id ? t : item)))}
              onUpdateDivision={(d) => setDivisions(divisions.map((item) => (item.id === d.id ? d : item)))}
              onOpenProfile={setProfileId}
              onGo={go}
            />
          )}

          {stepIndex >= 0 && (
            <footer className="step-footer">
              {prevStep ? (
                <button type="button" className="secondary" onClick={() => go(prevStep.id)}>
                  ← {prevStep.label}
                </button>
              ) : (
                <span />
              )}
              {nextStep ? (
                <button type="button" className="primary" onClick={() => go(nextStep.id)}>
                  Next: {nextStep.label} →
                </button>
              ) : hasTimetable ? (
                <button type="button" className="primary" onClick={() => go('today')}>
                  Run your week →
                </button>
              ) : null}
            </footer>
          )}
        </main>
      </div>
      {profileTeacher && (
        <TeacherProfile
          teacher={profileTeacher}
          subjects={subjects}
          divisions={divisions}
          sessions={liveSessions}
          days={institution.workingDays}
          slots={slots}
          names={names}
          departmentName={department.name}
          onChange={(t) => setTeachers(teachers.map((item) => (item.id === t.id ? t : item)))}
          onClose={() => setProfileId(null)}
          onRemove={(id) => {
            setTeachers(teachers.filter((t) => t.id !== id));
            setProfileId(null);
          }}
        />
      )}
    </div>
  );
}
