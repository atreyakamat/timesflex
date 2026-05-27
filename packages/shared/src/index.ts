export type InstitutionType = 'school' | 'college' | 'university';

export type SessionKind =
  | 'lecture'
  | 'lab'
  | 'break'
  | 'lunch'
  | 'event'
  | 'exam'
  | 'staff-duty';

export interface TimeSlot {
  day: string;
  startTime: string;
  endTime: string;
}

export interface InstitutionProfile {
  id: string;
  name: string;
  type: InstitutionType;
  workingDays: string[];
  workingHours: {
    startTime: string;
    endTime: string;
  };
  breaks: TimeSlot[];
  departments: DepartmentProfile[];
}

export interface DepartmentProfile {
  id: string;
  name: string;
  years: AcademicYearProfile[];
}

export interface AcademicYearProfile {
  id: string;
  label: string;
  semesters: SemesterProfile[];
}

export interface SemesterProfile {
  id: string;
  label: string;
  divisions: DivisionProfile[];
}

export interface DivisionProfile {
  id: string;
  name: string;
  batches: string[];
}

export interface TeacherProfile {
  id: string;
  name: string;
  subjectIds: string[];
  maxLecturesPerDay: number;
  maxLecturesPerWeek: number;
  availableSlots: TimeSlot[];
  unavailableSlots: TimeSlot[];
  preferredSlots: TimeSlot[];
  canHandleLabs: boolean;
}

export interface RoomProfile {
  id: string;
  name: string;
  capacity: number;
  type: 'classroom' | 'lab' | 'seminar-hall';
  availableSlots: TimeSlot[];
  equipment: string[];
  allowedSubjectIds: string[];
}

export interface SubjectProfile {
  id: string;
  name: string;
  lectureDurationMinutes: number;
  isLab: boolean;
}

export interface ScheduleSession {
  id: string;
  kind: SessionKind;
  subjectId?: string;
  teacherId?: string;
  roomId?: string;
  divisionId?: string;
  batchName?: string;
  day: string;
  startTime: string;
  endTime: string;
  locked: boolean;
}

export interface TimetableRequest {
  institutionId: string;
  departmentId: string;
  yearId?: string;
  semesterId?: string;
  divisions: string[];
  subjects: SubjectProfile[];
  teachers: TeacherProfile[];
  rooms: RoomProfile[];
  slots: TimeSlot[];
}
