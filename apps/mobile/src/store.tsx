import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  applyActions,
  buildSlots,
  buildSolverRequest,
  emptyModel,
  emptyOperations,
  featuresOf,
  findConflicts,
  hasLearned,
  learnFromChoice,
  learnFromMove,
  sampleProfile,
  setupProblems,
  solverWeights,
  styleLabel,
  type Account,
  type AccountSession,
  type AgentAction,
  type Conflict,
  type InstitutionRecord,
  type OperationsData,
  type PreferenceModel,
  type ProfileData,
  type ScheduledSession,
  type SessionRequest,
  type TimetableRecord,
  type VariantStyle,
} from '@core';
import { api, loadToken, setUnauthorizedHandler } from './api';

/** The institution profile plus what the assistant has learned about the coordinator. */
export type Profile = ProfileData & { learning: PreferenceModel; selectedVersionId?: string };

/** 'yours' = balanced plus the learned weights. */
export type GenerateStyle = VariantStyle | 'yours';

const blankProfile = (name = '', type: Profile['institution']['type'] = 'college'): Profile => ({
  institution: {
    name,
    type,
    workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    startTime: '09:00',
    endTime: '16:00',
    slotDurationMinutes: 60,
    breakAfterSlots: 3,
    breakDurationMinutes: 30,
  },
  department: { name: '', yearLabel: '', semesterLabel: '' },
  divisions: [],
  teachers: [],
  rooms: [],
  subjects: [],
  operations: emptyOperations(),
  learning: emptyModel(),
});

const profileFrom = (record: InstitutionRecord): Profile => {
  const data = ((record.data as any)?.profile ?? record.data ?? {}) as Partial<Profile>;
  const base = blankProfile(record.name, record.type);
  return {
    ...base,
    ...data,
    institution: { ...base.institution, ...(data.institution ?? {}), name: data.institution?.name || record.name },
    department: { ...base.department, ...(data.department ?? {}) },
    divisions: data.divisions ?? [],
    teachers: data.teachers ?? [],
    rooms: data.rooms ?? [],
    subjects: data.subjects ?? [],
    operations: { ...emptyOperations(), ...(data.operations ?? {}) },
    learning: { ...emptyModel(), ...(data.learning ?? {}) },
  };
};

type SaveState = 'saved' | 'saving' | 'error';

interface Store {
  ready: boolean;
  account: Account | null;
  institutionId: string | null;
  profile: Profile;
  slots: string[];
  names: Record<string, string>;
  problems: string[];
  versions: TimetableRecord[];
  current: TimetableRecord | null;
  sessions: ScheduledSession[];
  /** The version daily tools use: approved if there is one, else the newest. */
  liveSessions: ScheduledSession[];
  unplaced: SessionRequest[];
  diagnostics: string[];
  conflicts: Conflict[];
  saveState: SaveState;
  busy: string | null;
  isNew: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (body: Parameters<typeof api.signUp>[0]) => Promise<void>;
  signOut: () => Promise<void>;
  update: (change: (profile: Profile) => Profile) => void;
  updateOperations: (change: (ops: OperationsData) => OperationsData) => void;
  loadSample: () => void;
  /** Apply what the assistant proposed (after the person approved it). Returns a line about any run. */
  applyAgent: (actions: AgentAction[]) => Promise<string | null>;
  generate: (style?: GenerateStyle, alternative?: boolean) => Promise<string>;
  generateVariants: (styles: GenerateStyle[]) => Promise<string>;
  selectVersion: (id: string) => void;
  /** Select a version and learn that it was preferred over the others shown. */
  chooseVersion: (id: string, comparedWith: string[]) => void;
  setApproved: (approved: boolean) => Promise<void>;
  moveSession: (id: string, patch: Partial<ScheduledSession>) => void;
  finishOnboarding: () => void;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile>(blankProfile());
  const [versions, setVersions] = useState<TimetableRecord[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ScheduledSession[]>([]);
  const [unplaced, setUnplaced] = useState<SessionRequest[]>([]);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [busy, setBusy] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const profileDirty = useRef(false);
  const opsDirty = useRef(false);
  const sessionsDirty = useRef(false);

  const reset = useCallback(() => {
    setAccount(null);
    setInstitutionId(null);
    setProfile(blankProfile());
    setVersions([]);
    setCurrentId(null);
    setSessions([]);
    setUnplaced([]);
    setDiagnostics([]);
  }, []);

  const open = useCallback(async (session: AccountSession, fresh: boolean) => {
    setAccount(session.account);
    setIsNew(fresh);
    if (!session.institution) return;
    setInstitutionId(session.institution.id);
    setProfile(profileFrom(session.institution));
    profileDirty.current = false;
    opsDirty.current = false;
    const all = await api.listTimetables(session.institution.id).catch(() => [] as TimetableRecord[]);
    setVersions(all);
    const chosen = profileFrom(session.institution).selectedVersionId;
    const pick =
      all.find((v) => v.status === 'approved') ??
      all.find((v) => v.id === chosen && v.generatedSessions?.length) ??
      all.find((v) => v.generatedSessions?.length);
    if (pick) {
      setCurrentId(pick.id);
      setSessions(pick.generatedSessions);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(reset);
    loadToken()
      .then((token) => (token ? api.me().then((session) => open(session, false)) : undefined))
      .catch(() => reset())
      .finally(() => setReady(true));
  }, [open, reset]);

  // Autosave the profile, operations and hand edits, each a moment after the last change.
  useEffect(() => {
    if (!institutionId || !profileDirty.current) return;
    setSaveState('saving');
    const timer = setTimeout(() => {
      const { operations: _ops, ...rest } = profile;
      api
        .saveProfile(institutionId, {
          name: profile.institution.name || 'Untitled institution',
          type: profile.institution.type,
          profile: { ...rest, operations: profile.operations },
        })
        .then(() => {
          profileDirty.current = false;
          setSaveState('saved');
        })
        .catch(() => setSaveState('error'));
    }, 800);
    return () => clearTimeout(timer);
  }, [profile, institutionId]);

  useEffect(() => {
    if (!institutionId || !opsDirty.current) return;
    const timer = setTimeout(() => {
      api
        .saveOperations(institutionId, profile.operations)
        .then(() => {
          opsDirty.current = false;
        })
        .catch(() => setSaveState('error'));
    }, 500);
    return () => clearTimeout(timer);
  }, [profile.operations, institutionId]);

  useEffect(() => {
    if (!currentId || !sessionsDirty.current) return;
    const timer = setTimeout(() => {
      api
        .updateTimetable(currentId, { generatedSessions: sessions })
        .then((saved) => {
          sessionsDirty.current = false;
          setVersions((list) => list.map((v) => (v.id === saved.id ? saved : v)));
        })
        .catch(() => setSaveState('error'));
    }, 800);
    return () => clearTimeout(timer);
  }, [sessions, currentId]);

  const slots = useMemo(
    () =>
      buildSlots(
        profile.institution.startTime,
        profile.institution.endTime,
        profile.institution.slotDurationMinutes,
        profile.institution.breakAfterSlots,
        profile.institution.breakDurationMinutes,
      ),
    [profile.institution],
  );
  const names = useMemo(() => {
    const map: Record<string, string> = {};
    for (const item of [...profile.divisions, ...profile.teachers, ...profile.rooms, ...profile.subjects]) map[item.id] = item.name;
    return map;
  }, [profile]);
  const problems = useMemo(
    () => setupProblems({ days: profile.institution.workingDays, slots, ...profile }),
    [profile, slots],
  );
  const conflicts = useMemo(
    () => findConflicts(sessions, { days: profile.institution.workingDays, slots, teachers: profile.teachers, rooms: profile.rooms, names }),
    [sessions, profile, slots, names],
  );
  const current = versions.find((v) => v.id === currentId) ?? null;
  const live = versions.find((v) => v.status === 'approved') ?? versions.find((v) => v.generatedSessions?.length);
  const liveSessions = live ? (live.id === currentId ? sessions : live.generatedSessions) : [];

  const update = useCallback((change: (profile: Profile) => Profile) => {
    profileDirty.current = true;
    setProfile((p) => change(p));
  }, []);
  const updateOperations = useCallback((change: (ops: OperationsData) => OperationsData) => {
    opsDirty.current = true;
    setProfile((p) => ({ ...p, operations: change(p.operations) }));
  }, []);

  const solveOne = useCallback(
    async (style: GenerateStyle, number: number, alternative = false, base = profile, timeLimitSeconds?: number) => {
      if (!institutionId) throw new Error('Sign in first.');
      const locked = sessions.filter((s) => s.locked);
      const request = buildSolverRequest({
        days: base.institution.workingDays,
        slots: buildSlots(base.institution.startTime, base.institution.endTime, base.institution.slotDurationMinutes, base.institution.breakAfterSlots, base.institution.breakDurationMinutes),
        divisions: base.divisions,
        teachers: base.teachers,
        rooms: base.rooms,
        subjects: base.subjects,
        locked,
        style: style === 'yours' ? 'balanced' : style,
        ...(style === 'yours' ? { weights: solverWeights(base.learning) } : {}),
        ...(alternative ? { seed: Math.floor(Math.random() * 100000) } : {}),
        ...(timeLimitSeconds ? { timeLimitSeconds } : {}),
      });
      const label = `Version ${number} · ${style === 'yours' ? 'Your style' : styleLabel(style)}${alternative ? ' (alt)' : ''}`;
      const record = await api.createTimetable(institutionId, { label, request });
      return api.solve(record.id);
    },
    [institutionId, profile, sessions],
  );

  const show = (record: TimetableRecord, missing: SessionRequest[] = [], notes: string[] = []) => {
    setCurrentId(record.id);
    setSessions(record.generatedSessions ?? []);
    sessionsDirty.current = false;
    setUnplaced(missing);
    setDiagnostics(notes);
  };

  const generate = useCallback(
    async (style: GenerateStyle = 'balanced', alternative = false, base = profile) => {
      setBusy('Building your timetable…');
      try {
        const { timetable, solver } = await solveOne(style, versions.length + 1, alternative, base);
        setVersions((list) => [timetable, ...list]);
        show(timetable, solver.unscheduled_sessions, solver.diagnostics ?? []);
        return solver.status === 'ok'
          ? `All ${solver.scheduled_sessions.length} sessions placed, no clashes.`
          : `Placed ${solver.scheduled_sessions.length}; ${solver.unscheduled_sessions.length} could not fit. See the notes.`;
      } finally {
        setBusy(null);
      }
    },
    [solveOne, versions.length, profile],
  );

  const generateVariants = useCallback(
    async (styles: GenerateStyle[], base = profile) => {
      const made: TimetableRecord[] = [];
      try {
        for (const [index, style] of styles.entries()) {
          setBusy(`Building version ${index + 1} of ${styles.length}…`);
          // Several versions at once: a shorter search each keeps the wait reasonable.
          const { timetable } = await solveOne(style, versions.length + made.length + 1, false, base, 6);
          made.unshift(timetable);
        }
        setVersions((list) => [...made, ...list]);
        if (made.length) show(made[made.length - 1]);
        return `${made.length} versions ready to compare.`;
      } finally {
        setBusy(null);
      }
    },
    [solveOne, versions.length, profile],
  );

  const applyAgent = useCallback(
    async (actions: AgentAction[]) => {
      const next = applyActions(profile, actions) as Profile;
      if (next !== profile) {
        const opsChanged = next.operations !== profile.operations;
        profileDirty.current = true;
        if (opsChanged) opsDirty.current = true;
        setProfile(next);
      }
      const run = actions.find((a) => a.type === 'generate' || a.type === 'generateVariants');
      if (!run) return null;
      if (run.type === 'generate') return generate(run.style, false, next);
      return generateVariants(hasLearned(next.learning) ? [...run.styles, 'yours'] : run.styles, next);
    },
    [profile, generate, generateVariants],
  );

  const days = profile.institution.workingDays;
  const value: Store = {
    ready,
    account,
    institutionId,
    profile,
    slots,
    names,
    problems,
    versions,
    current,
    sessions,
    liveSessions,
    unplaced,
    diagnostics,
    conflicts,
    saveState,
    busy,
    isNew,
    signIn: async (email, password) => open(await api.signIn(email, password), false),
    signUp: async (body) => open(await api.signUp(body), true),
    signOut: async () => {
      await api.signOut().catch(() => {});
      reset();
    },
    update,
    updateOperations,
    loadSample: () => {
      const sample = sampleProfile();
      update((p) => ({ ...p, ...sample, institution: { ...sample.institution, name: p.institution.name || sample.institution.name, type: p.institution.type } }));
    },
    applyAgent,
    generate: (style, alternative) => generate(style, alternative),
    generateVariants: (styles) => generateVariants(styles),
    selectVersion: (id) => {
      const record = versions.find((v) => v.id === id);
      if (!record) return;
      update((p) => ({ ...p, selectedVersionId: id }));
      show(record);
    },
    chooseVersion: (id, comparedWith) => {
      const chosen = versions.find((v) => v.id === id);
      if (!chosen) return;
      const others = versions.filter((v) => comparedWith.includes(v.id) && v.id !== id && v.generatedSessions?.length);
      if (others.length) {
        update((p) => ({
          ...p,
          learning: learnFromChoice(
            p.learning,
            featuresOf(chosen.generatedSessions, days, slots),
            others.map((v) => featuresOf(v.generatedSessions, days, slots)),
            `You chose ${chosen.label.split('·')[1]?.trim() ?? chosen.label}`,
          ),
        }));
      }
      update((p) => ({ ...p, selectedVersionId: id }));
      show(chosen);
    },
    setApproved: async (approved) => {
      if (!currentId) return;
      const saved = await api.updateTimetable(currentId, { generatedSessions: sessions, status: approved ? 'approved' : 'edited' });
      sessionsDirty.current = false;
      setVersions((list) => list.map((v) => (v.id === saved.id ? saved : v)));
    },
    moveSession: (id, patch) => {
      const before = sessions.find((s) => s.id === id);
      if (before && (patch.day || patch.slot)) {
        const toDay = patch.day ?? before.day;
        const toSlot = slots.indexOf(patch.slot ?? before.slot);
        update((p) => ({
          ...p,
          learning: learnFromMove(p.learning, {
            fromDay: before.day,
            fromSlot: slots.indexOf(before.slot),
            toDay,
            toSlot,
            lastSlot: slots.length - 1,
            teacherAlreadyThere: sessions.some((s) => s.id !== id && s.teacher_id === before.teacher_id && s.day === toDay),
          }),
        }));
      }
      sessionsDirty.current = true;
      setSessions((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    },
    finishOnboarding: () => setIsNew(false),
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export const useStore = () => {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside StoreProvider');
  return store;
};
