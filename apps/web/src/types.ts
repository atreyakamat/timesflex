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
}

export interface TeacherForm {
  id: string;
  name: string;
  maxLecturesPerDay: number;
  maxLecturesPerWeek: number;
}

export interface RoomForm {
  id: string;
  name: string;
  type: RoomType;
  capacity: number;
}

export interface SubjectForm {
  id: string;
  name: string;
  isLab: boolean;
  durationSlots: number;
  sessionsPerWeek: number;
  teacherId: string;
  roomId: string;
}

export interface SessionRequest {
  id: string;
  subject_id: string;
  teacher_id: string;
  room_id: string;
  division_id: string;
  kind: string;
  duration_slots: number;
}

export interface SolverRequest {
  days: string[];
  slots: string[];
  sessions: SessionRequest[];
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
}

export interface TimetableRecord {
  id: string;
  institutionId: string;
  label: string;
  status: string;
  request: SolverRequest;
  generatedSessions: ScheduledSession[];
}

export interface SolverResult {
  status: string;
  scheduled_sessions: ScheduledSession[];
  unscheduled_sessions: SessionRequest[];
}
