import { setAbsent, setLeave } from './ops';
import type { ProfileData } from './samples';
import type { DivisionForm, RoomForm, SubjectForm, TeacherForm } from './types';
import { createId } from './utils';
import type { VariantStyle } from './variants';

/**
 * Everything the assistant can change, as plain data. The assistant (rules, the local
 * model, or an insight's quick fix) only ever proposes a list of these; the person sees
 * the list in words and approves it, and then `applyActions` makes the change. Nothing
 * is applied without that step.
 */
export type AgentAction =
  | { type: 'addTeacher'; name: string; expertise?: string[]; maxLecturesPerDay?: number; maxLecturesPerWeek?: number }
  | { type: 'updateTeacher'; teacherId: string; changes: Partial<Omit<TeacherForm, 'id'>> }
  | { type: 'teacherDayOff'; teacherId: string; day: string }
  | { type: 'addClass'; name: string; size?: number; batches?: string[] }
  | { type: 'addRoom'; name: string; roomType: RoomForm['type']; capacity: number }
  | { type: 'addSubject'; name: string; isLab: boolean; sessionsPerWeek: number; durationSlots: number; teacherId: string }
  | { type: 'assignTeacher'; subjectId: string; teacherId: string; divisionId?: string }
  | { type: 'updateSubject'; subjectId: string; changes: Partial<Omit<SubjectForm, 'id'>> }
  | { type: 'markAbsent'; teacherId: string; date: string }
  | { type: 'leave'; teacherId: string; from: string; to: string; reason?: string }
  | { type: 'setWorkingDays'; days: string[] }
  | { type: 'setHours'; startTime?: string; endTime?: string; slotDurationMinutes?: number }
  | { type: 'generate'; style: VariantStyle }
  | { type: 'generateVariants'; styles: VariantStyle[] };

/** Actions that need the solver (and a running server) rather than a profile change. */
export const isRunAction = (action: AgentAction) => action.type === 'generate' || action.type === 'generateVariants';

const name = (profile: ProfileData, id: string) =>
  [...profile.teachers, ...profile.subjects, ...profile.divisions, ...profile.rooms].find((item) => item.id === id)?.name ?? 'someone';

/** One plain sentence per action, for the "here is what I will do" preview. */
export const describeAction = (action: AgentAction, profile: ProfileData): string => {
  switch (action.type) {
    case 'addTeacher':
      return `Add teacher ${action.name}${action.expertise?.length ? ` (${action.expertise.join(', ')})` : ''}`;
    case 'updateTeacher': {
      const parts = Object.entries(action.changes).map(([key, value]) => {
        if (key === 'maxLecturesPerDay') return `at most ${value} periods a day`;
        if (key === 'maxLecturesPerWeek') return `at most ${value} periods a week`;
        if (key === 'expertise') return `expertise: ${(value as string[]).join(', ')}`;
        if (key === 'canTeachLabs') return value ? 'can take labs' : 'does not take labs';
        return `${key}: ${String(value)}`;
      });
      return `Set ${name(profile, action.teacherId)}: ${parts.join(', ')}`;
    }
    case 'teacherDayOff':
      return `${name(profile, action.teacherId)} does not teach on ${action.day}s`;
    case 'addClass':
      return `Add class ${action.name}${action.size ? ` with ${action.size} students` : ''}${action.batches?.length ? `, lab batches ${action.batches.join(', ')}` : ''}`;
    case 'addRoom':
      return `Add ${action.roomType === 'lab' ? 'lab' : action.roomType === 'seminar-hall' ? 'hall' : 'room'} ${action.name} (${action.capacity} seats)`;
    case 'addSubject':
      return `Add ${action.isLab ? 'lab' : 'subject'} ${action.name}, ${action.sessionsPerWeek}× a week, taught by ${name(profile, action.teacherId)}`;
    case 'assignTeacher':
      return `${name(profile, action.teacherId)} teaches ${name(profile, action.subjectId)}${action.divisionId ? ` for ${name(profile, action.divisionId)}` : ''}`;
    case 'updateSubject': {
      const parts = Object.entries(action.changes).map(([key, value]) =>
        key === 'sessionsPerWeek' ? `${value}× a week` : key === 'durationSlots' ? `${value} period(s) each` : `${key}: ${String(value)}`,
      );
      return `Change ${name(profile, action.subjectId)}: ${parts.join(', ')}`;
    }
    case 'markAbsent':
      return `Mark ${name(profile, action.teacherId)} absent on ${action.date}`;
    case 'leave':
      return `${name(profile, action.teacherId)} on leave ${action.from === action.to ? `on ${action.from}` : `from ${action.from} to ${action.to}`}${action.reason ? ` (${action.reason})` : ''}`;
    case 'setWorkingDays':
      return `Teach on ${action.days.join(', ')}`;
    case 'setHours': {
      const parts = [
        action.startTime && `start at ${action.startTime}`,
        action.endTime && `end at ${action.endTime}`,
        action.slotDurationMinutes && `${action.slotDurationMinutes}-minute periods`,
      ].filter(Boolean);
      return `Day: ${parts.join(', ')}`;
    }
    case 'generate':
      return `Build a new timetable (${action.style.replace('_', ' ')})`;
    case 'generateVariants':
      return `Build ${action.styles.length} variations to compare`;
  }
};

/**
 * Apply the profile-changing actions. Run actions (generate) are skipped here; the app
 * runs them after saving. Unknown ids are ignored rather than throwing, so a stale
 * suggestion cannot corrupt the profile.
 */
export const applyActions = (profile: ProfileData, actions: AgentAction[]): ProfileData => {
  let next: ProfileData = {
    ...profile,
    teachers: [...profile.teachers],
    divisions: [...profile.divisions],
    rooms: [...profile.rooms],
    subjects: [...profile.subjects],
  };
  const updateTeacher = (id: string, change: (teacher: TeacherForm) => TeacherForm) => {
    next.teachers = next.teachers.map((teacher) => (teacher.id === id ? change(teacher) : teacher));
  };
  const updateSubject = (id: string, change: (subject: SubjectForm) => SubjectForm) => {
    next.subjects = next.subjects.map((subject) => (subject.id === id ? change(subject) : subject));
  };

  for (const action of actions) {
    switch (action.type) {
      case 'addTeacher':
        if (next.teachers.some((t) => t.name.toLowerCase() === action.name.toLowerCase())) break;
        next.teachers.push({
          id: createId(),
          name: action.name,
          maxLecturesPerDay: action.maxLecturesPerDay ?? 4,
          maxLecturesPerWeek: action.maxLecturesPerWeek ?? 18,
          unavailableDays: [],
          canTeachLabs: true,
          ...(action.expertise?.length ? { expertise: action.expertise } : {}),
        });
        break;
      case 'updateTeacher':
        updateTeacher(action.teacherId, (teacher) => ({ ...teacher, ...action.changes }));
        break;
      case 'teacherDayOff':
        updateTeacher(action.teacherId, (teacher) => ({
          ...teacher,
          unavailableDays: [...new Set([...(teacher.unavailableDays ?? []), action.day])],
        }));
        break;
      case 'addClass': {
        if (next.divisions.some((d) => d.name.toLowerCase() === action.name.toLowerCase())) break;
        const division: DivisionForm = {
          id: createId(),
          name: action.name,
          batches: action.batches ?? [],
          size: action.size ?? 60,
          yearLabel: [next.department.yearLabel, next.department.semesterLabel].filter(Boolean).join(' · '),
        };
        next.divisions.push(division);
        break;
      }
      case 'addRoom':
        if (next.rooms.some((r) => r.name.toLowerCase() === action.name.toLowerCase())) break;
        next.rooms.push({ id: createId(), name: action.name, type: action.roomType, capacity: action.capacity, equipment: '' });
        break;
      case 'addSubject':
        next.subjects.push({
          id: createId(),
          name: action.name,
          isLab: action.isLab,
          sessionsPerWeek: action.sessionsPerWeek,
          durationSlots: action.durationSlots,
          teacherId: action.teacherId,
          roomId: '',
          divisionIds: [],
          teacherOverrides: {},
        });
        break;
      case 'assignTeacher':
        updateSubject(action.subjectId, (subject) =>
          action.divisionId
            ? { ...subject, teacherOverrides: { ...(subject.teacherOverrides ?? {}), [action.divisionId]: action.teacherId } }
            : { ...subject, teacherId: action.teacherId },
        );
        break;
      case 'updateSubject':
        updateSubject(action.subjectId, (subject) => ({ ...subject, ...action.changes }));
        break;
      case 'markAbsent':
        next = { ...next, operations: setAbsent(next.operations, action.date, action.teacherId, true) };
        break;
      case 'leave':
        next = {
          ...next,
          operations: setLeave(next.operations, {
            teacherId: action.teacherId,
            from: action.from,
            to: action.to,
            days: next.institution.workingDays,
            reason: action.reason,
          }),
        };
        break;
      case 'setWorkingDays':
        if (action.days.length) next = { ...next, institution: { ...next.institution, workingDays: action.days } };
        break;
      case 'setHours':
        next = {
          ...next,
          institution: {
            ...next.institution,
            ...(action.startTime ? { startTime: action.startTime } : {}),
            ...(action.endTime ? { endTime: action.endTime } : {}),
            ...(action.slotDurationMinutes ? { slotDurationMinutes: action.slotDurationMinutes } : {}),
          },
        };
        break;
      case 'generate':
      case 'generateVariants':
        break;
    }
  }
  return next;
};
