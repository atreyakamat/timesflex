export type InstitutionType = 'school' | 'college' | 'university';

export type RoomType = 'classroom' | 'lab' | 'seminar-hall';

export interface InstitutionForm {
  name: string;
  type: InstitutionType;
  workingDays: string[];
  startTime: string;
  endTime: string;
  slotDurationMinutes: number;
  breakAfterSlots: number | null;
  breakDurationMinutes: number | null;
}

export interface DepartmentForm {
  name: string;
  yearLabel: string;
  semesterLabel: string;
}

export interface DivisionForm {
  id: string;
  name: string;
  batches: string[];
  /** Students in the division; labs split it evenly across batches. 0 = unknown. */
  size?: number;
  /** Year / semester the division belongs to, e.g. "SE · Sem 3". */
  yearLabel?: string;
}

/** "Monday|09:00-10:00": one cell of the week. */
export type SlotKey = string;

export interface TeacherForm {
  id: string;
  name: string;
  maxLecturesPerDay: number;
  maxLecturesPerWeek: number;
  unavailableDays?: string[];
  unavailableSlots?: SlotKey[];
  /** Soft preference: when set, the solver tries to keep this teacher inside these slots. */
  preferredSlots?: SlotKey[];
  /** Defaults to true. */
  canTeachLabs?: boolean;
}

export interface RoomForm {
  id: string;
  name: string;
  type: RoomType;
  capacity: number;
  /** Lab equipment or software, e.g. "30 PCs, MySQL". */
  equipment?: string;
  unavailableDays?: string[];
  unavailableSlots?: SlotKey[];
}

export interface SubjectForm {
  id: string;
  name: string;
  isLab: boolean;
  durationSlots: number;
  sessionsPerWeek: number;
  teacherId: string;
  /** Empty means the solver picks any suitable room. */
  roomId: string;
  /** Divisions that take this subject; empty or missing means all of them. */
  divisionIds?: string[];
  /** Per-division teacher, when a division is taught by someone else. */
  teacherOverrides?: Record<string, string>;
  /** Heavy subjects are spread so a class does not get several on one day. */
  difficult?: boolean;
}

export interface SessionRequest {
  id: string;
  subject_id: string;
  teacher_id: string;
  room_id: string;
  division_id: string;
  batch?: string | null;
  kind: string;
  duration_slots: number;
  size?: number;
  difficult?: boolean;
  locked?: boolean;
  day?: string | null;
  slot?: string | null;
}

export interface TeacherConstraint {
  teacher_id: string;
  max_lectures_per_day: number;
  max_lectures_per_week: number;
  unavailable: TimeRef[];
  preferred: TimeRef[];
}

export interface TimeRef {
  day: string;
  slot?: string | null;
}

export interface SolverRoom {
  id: string;
  type: RoomType;
  capacity: number;
  unavailable: TimeRef[];
}

export interface SolverRequest {
  days: string[];
  slots: string[];
  sessions: SessionRequest[];
  teacher_constraints: TeacherConstraint[];
  rooms: SolverRoom[];
  names: Record<string, string>;
}

export interface ScheduledSession extends SessionRequest {
  day: string;
  slot: string;
}

export interface InstitutionRecord {
  id: string;
  name: string;
  type: InstitutionType;
  data: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export type TimetableStatus = 'draft' | 'generated' | 'partial' | 'edited' | 'approved';

export interface TimetableRecord {
  id: string;
  institutionId: string;
  label: string;
  status: TimetableStatus;
  request: SolverRequest;
  generatedSessions: ScheduledSession[];
  createdAt?: string;
  updatedAt?: string;
}

export interface SolverResult {
  status: string;
  scheduled_sessions: ScheduledSession[];
  unscheduled_sessions: SessionRequest[];
  diagnostics: string[];
}

/** Structured draft returned by POST /api/parse (local model or rule parser). */
export interface ChatDraft {
  institution: {
    name: string | null;
    workingDays: string[];
    startTime: string | null;
    endTime: string | null;
    slotDurationMinutes: number | null;
    breakAfterSlots: number | null;
    breakDurationMinutes: number | null;
  };
  divisions: { name: string; batches: string[]; size?: number | null }[];
  teachers: { name: string; maxLecturesPerDay: number; maxLecturesPerWeek: number; unavailableDays: string[] }[];
  rooms: { name: string; type: RoomType; capacity: number }[];
  subjects: {
    name: string;
    isLab: boolean;
    sessionsPerWeek: number;
    durationSlots: number;
    teacher: string | null;
    room: string | null;
  }[];
}

export interface ParseResult {
  draft: ChatDraft;
  warnings: string[];
  source: 'llm' | 'rules';
  elapsedMs: number;
}

export interface AiStatus {
  provider: string;
  model: string;
  baseUrl: string;
  reachable: boolean;
  modelAvailable: boolean;
  error: string | null;
}

export interface Conflict {
  message: string;
  sessionIds: string[];
}
