import type { AgentAction } from './agent';
import type { ProfileData } from './samples';
import type { ScheduledSession, SubjectForm, TeacherForm } from './types';
import { buildSlots, divisionSize, groupSize, hasExpertise, subjectDivisions, teacherFor } from './utils';
import { timetableMetrics } from './variants';

/**
 * The assistant's eyes: plain-language observations about the setup and the timetable,
 * each with an optional one-tap fix (a list of agent actions to preview and apply).
 */

export type InsightLevel = 'blocker' | 'warning' | 'tip' | 'good';

export interface Insight {
  id: string;
  level: InsightLevel;
  title: string;
  detail: string;
  /** Where in the app this is about, so a card can link there. */
  area: 'basics' | 'teachers' | 'classes' | 'rooms' | 'subjects' | 'timetable';
  fix?: { label: string; actions: AgentAction[] };
}

const slotsOf = (profile: ProfileData) =>
  buildSlots(
    profile.institution.startTime,
    profile.institution.endTime,
    profile.institution.slotDurationMinutes,
    profile.institution.breakAfterSlots,
    profile.institution.breakDurationMinutes,
  );

/** Periods per week a teacher is assigned across every class (labs count once per batch). */
export const teacherLoad = (teacher: TeacherForm, profile: Pick<ProfileData, 'subjects' | 'divisions'>) => {
  let periods = 0;
  for (const subject of profile.subjects) {
    for (const division of subjectDivisions(subject, profile.divisions)) {
      if (teacherFor(subject, division.id) !== teacher.id) continue;
      const sittings = subject.isLab && division.batches.length ? division.batches.length : 1;
      periods += subject.sessionsPerWeek * subject.durationSlots * sittings;
    }
  }
  return periods;
};

/** The most periods a teacher can actually teach in a week, given days off and limits. */
export const teacherCapacity = (teacher: TeacherForm, days: string[]) =>
  Math.min(teacher.maxLecturesPerWeek, teacher.maxLecturesPerDay * days.filter((day) => !teacher.unavailableDays?.includes(day)).length);

/** Periods a class sits through each week (labs once per class: batches run in parallel). */
export const classLoad = (divisionId: string, profile: Pick<ProfileData, 'subjects' | 'divisions'>) =>
  profile.subjects
    .filter((subject) => subjectDivisions(subject, profile.divisions).some((division) => division.id === divisionId))
    .reduce((sum, subject) => sum + subject.sessionsPerWeek * subject.durationSlots, 0);

/** Teachers who could take a subject, best first: expertise, then spare capacity. */
export const suggestTeachers = (subject: Pick<SubjectForm, 'name' | 'isLab'>, profile: ProfileData, extraPeriods = 0) => {
  const days = profile.institution.workingDays;
  return profile.teachers
    .filter((teacher) => !(subject.isLab && teacher.canTeachLabs === false))
    .map((teacher) => {
      const spare = teacherCapacity(teacher, days) - teacherLoad(teacher, profile);
      return { teacher, expert: hasExpertise(teacher, subject.name), spare, fits: spare >= extraPeriods };
    })
    .sort((a, b) => Number(b.expert && b.fits) - Number(a.expert && a.fits) || Number(b.fits) - Number(a.fits) || b.spare - a.spare);
};

export const setupInsights = (profile: ProfileData): Insight[] => {
  const insights: Insight[] = [];
  const days = profile.institution.workingDays;
  const slots = slotsOf(profile);
  const weekPeriods = days.length * slots.length;

  if (!days.length || !slots.length) {
    insights.push({
      id: 'no-periods',
      level: 'blocker',
      title: 'The week has no periods yet',
      detail: 'Pick working days and hours so there is time to place classes in.',
      area: 'basics',
    });
  }

  for (const teacher of profile.teachers) {
    const load = teacherLoad(teacher, profile);
    const capacity = teacherCapacity(teacher, days);
    if (load > capacity) {
      const needDay = Math.ceil(load / Math.max(1, days.filter((d) => !teacher.unavailableDays?.includes(d)).length));
      insights.push({
        id: `overload-${teacher.id}`,
        level: 'blocker',
        title: `${teacher.name} has more classes than time`,
        detail: `${load} periods a week are assigned, but limits allow ${capacity}. Some classes would be left out.`,
        area: 'teachers',
        fix: {
          label: `Allow ${load} a week (${needDay} a day)`,
          actions: [
            {
              type: 'updateTeacher',
              teacherId: teacher.id,
              changes: { maxLecturesPerWeek: Math.max(load, teacher.maxLecturesPerWeek), maxLecturesPerDay: Math.max(needDay, teacher.maxLecturesPerDay) },
            },
          ],
        },
      });
    } else if (load === 0 && profile.subjects.length) {
      insights.push({
        id: `idle-${teacher.id}`,
        level: 'tip',
        title: `${teacher.name} is not teaching anything yet`,
        detail: teacher.expertise?.length
          ? `Their expertise is ${teacher.expertise.join(', ')}. Assign them a subject, or keep them free for substitutions.`
          : 'Assign them a subject, or keep them free for substitutions.',
        area: 'subjects',
      });
    }
  }

  for (const subject of profile.subjects) {
    const missing = subjectDivisions(subject, profile.divisions).filter((division) => !profile.teachers.some((t) => t.id === teacherFor(subject, division.id)));
    if (missing.length) {
      const periods = subject.sessionsPerWeek * subject.durationSlots * missing.length;
      const [best] = suggestTeachers(subject, profile, periods);
      insights.push({
        id: `no-teacher-${subject.id}`,
        level: 'blocker',
        title: `${subject.name} has no teacher`,
        detail: best
          ? `${best.teacher.name} ${best.expert ? 'has matching expertise' : 'has the most free time'} (${best.spare} spare periods a week).`
          : 'Add a teacher first.',
        area: 'subjects',
        ...(best && { fix: { label: `Give it to ${best.teacher.name}`, actions: [{ type: 'assignTeacher', subjectId: subject.id, teacherId: best.teacher.id }] } }),
      });
    } else if (
      profile.teachers.some((t) => t.id === subject.teacherId) &&
      !hasExpertise(profile.teachers.find((t) => t.id === subject.teacherId)!, subject.name)
    ) {
      const expert = suggestTeachers(subject, profile, subject.sessionsPerWeek * subject.durationSlots).find((item) => item.expert && item.fits);
      if (expert && expert.teacher.id !== subject.teacherId) {
        insights.push({
          id: `expert-${subject.id}`,
          level: 'tip',
          title: `${expert.teacher.name} knows ${subject.name}`,
          detail: `Their expertise matches and they have ${expert.spare} spare periods a week.`,
          area: 'subjects',
          fix: { label: `Switch to ${expert.teacher.name}`, actions: [{ type: 'assignTeacher', subjectId: subject.id, teacherId: expert.teacher.id }] },
        });
      }
    }

    const wantsLab = subject.isLab;
    if (!subject.roomId && !profile.rooms.some((room) => (room.type === 'lab') === wantsLab)) {
      insights.push({
        id: `no-room-${subject.id}`,
        level: 'blocker',
        title: `No ${wantsLab ? 'lab' : 'classroom'} for ${subject.name}`,
        detail: `Add a ${wantsLab ? 'lab' : 'classroom'} so it has somewhere to happen.`,
        area: 'rooms',
        fix: {
          label: `Add ${wantsLab ? 'Lab 1' : 'Room 101'}`,
          actions: [{ type: 'addRoom', name: wantsLab ? 'Lab 1' : 'Room 101', roomType: wantsLab ? 'lab' : 'classroom', capacity: wantsLab ? 35 : 70 }],
        },
      });
    }
    for (const division of subjectDivisions(subject, profile.divisions)) {
      const size = groupSize(division, subject.isLab ? division.batches[0] : null);
      const fitting = profile.rooms.filter((room) => (room.type === 'lab') === subject.isLab && room.capacity >= size);
      if (size && !subject.roomId && profile.rooms.some((room) => (room.type === 'lab') === subject.isLab) && !fitting.length) {
        const biggest = Math.max(...profile.rooms.filter((room) => (room.type === 'lab') === subject.isLab).map((room) => room.capacity));
        insights.push({
          id: `small-room-${subject.id}-${division.id}`,
          level: 'blocker',
          title: `No ${subject.isLab ? 'lab' : 'room'} is big enough for ${division.name}`,
          detail: `${subject.name} needs ${size} seats; the biggest ${subject.isLab ? 'lab' : 'room'} has ${biggest}.${subject.isLab && !division.batches.length ? ' Splitting the class into lab batches would also fix it.' : ''}`,
          area: 'rooms',
        });
      }
    }
  }

  for (const division of profile.divisions) {
    const load = classLoad(division.id, profile);
    if (load > weekPeriods && weekPeriods) {
      insights.push({
        id: `class-over-${division.id}`,
        level: 'blocker',
        title: `${division.name} has more periods than the week holds`,
        detail: `${load} periods are planned, but the week has ${weekPeriods}. Reduce some subjects or add hours.`,
        area: 'subjects',
      });
    } else if (load && weekPeriods && load > weekPeriods * 0.9) {
      insights.push({
        id: `class-tight-${division.id}`,
        level: 'warning',
        title: `${division.name}'s week is almost full`,
        detail: `${load} of ${weekPeriods} periods are used, so there is little room to move things.`,
        area: 'subjects',
      });
    }
    if (!divisionSize(division)) {
      insights.push({
        id: `size-${division.id}`,
        level: 'tip',
        title: `How many students are in ${division.name}?`,
        detail: 'With a number, rooms are chosen so everyone has a seat.',
        area: 'classes',
      });
    }
  }

  if (profile.subjects.some((s) => s.isLab) && profile.divisions.some((d) => !d.batches.length && divisionSize(d) > 40)) {
    insights.push({
      id: 'batches',
      level: 'tip',
      title: 'Large classes could use lab batches',
      detail: 'Splitting a class into two batches lets each half use the lab while the other half has a lecture.',
      area: 'classes',
    });
  }

  if (profile.teachers.length && profile.subjects.length && !insights.some((i) => i.level === 'blocker')) {
    insights.push({
      id: 'ready',
      level: 'good',
      title: 'Everything needed is in place',
      detail: 'Generate the timetable, or build a few variations to compare.',
      area: 'timetable',
      fix: { label: 'Build 3 variations', actions: [{ type: 'generateVariants', styles: ['balanced', 'compact', 'teacher_days'] }] },
    });
  }
  return insights;
};

/** Observations about a generated week: what is good, and what a different style would improve. */
export const timetableInsights = (profile: ProfileData, sessions: ScheduledSession[], unplaced = 0): Insight[] => {
  const insights: Insight[] = [];
  if (!sessions.length) return insights;
  const days = profile.institution.workingDays;
  const slots = slotsOf(profile);
  const metrics = timetableMetrics(sessions, { days, slots });

  if (unplaced) {
    insights.push({
      id: 'unplaced',
      level: 'blocker',
      title: `${unplaced} session(s) could not be placed`,
      detail: 'Check the notes under the timetable; usually a teacher limit or a missing room is the cause.',
      area: 'timetable',
    });
  } else {
    insights.push({
      id: 'all-placed',
      level: 'good',
      title: `All ${metrics.periods} periods are placed with no clashes`,
      detail: 'No teacher, class or room is double-booked.',
      area: 'timetable',
    });
  }
  const teachersWithClasses = new Set(sessions.map((s) => s.teacher_id)).size || 1;
  if (metrics.teacherGaps / teachersWithClasses >= 3) {
    insights.push({
      id: 'gaps',
      level: 'tip',
      title: 'Teachers wait between classes',
      detail: `On average each teacher has ${(metrics.teacherGaps / teachersWithClasses).toFixed(1)} free periods sandwiched between classes. A compact version packs their day tighter.`,
      area: 'timetable',
      fix: { label: 'Try compact days', actions: [{ type: 'generate', style: 'compact' }] },
    });
  }
  if (metrics.teacherDays / teachersWithClasses >= days.length - 0.5 && days.length >= 5) {
    insights.push({
      id: 'every-day',
      level: 'tip',
      title: 'Most teachers come in every day',
      detail: 'Grouping each teacher onto fewer days gives them full free days for research or admin.',
      area: 'timetable',
      fix: { label: 'Try fewer teacher days', actions: [{ type: 'generate', style: 'teacher_days' }] },
    });
  }
  if (metrics.lastPeriod > metrics.firstPeriod * 2 && metrics.lastPeriod >= 4) {
    insights.push({
      id: 'late',
      level: 'tip',
      title: 'Many classes in the last period',
      detail: `${metrics.lastPeriod} sessions run in the final period of the day, when attention is lowest.`,
      area: 'timetable',
      fix: { label: 'Try compact days', actions: [{ type: 'generate', style: 'compact' }] },
    });
  }
  return insights;
};
