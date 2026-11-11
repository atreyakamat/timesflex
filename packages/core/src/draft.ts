import type { ProfileData } from './samples';
import type { ChatDraft } from './types';
import { createId } from './utils';

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Merge a reviewed plain-text draft (from /api/parse) into the profile, matching existing
 * teachers, rooms, classes and subjects by name so describing the department twice
 * updates rather than duplicates.
 */
export const mergeDraft = <P extends ProfileData>(profile: P, draft: ChatDraft): P => {
  const teachers = profile.teachers.map((t) => ({ ...t }));
  for (const item of draft.teachers) {
    const existing = teachers.find((t) => same(t.name, item.name));
    if (existing) {
      existing.maxLecturesPerDay = item.maxLecturesPerDay;
      existing.maxLecturesPerWeek = item.maxLecturesPerWeek;
      existing.unavailableDays = [...new Set([...(existing.unavailableDays ?? []), ...item.unavailableDays])];
    } else {
      teachers.push({ id: createId(), ...item, canTeachLabs: true });
    }
  }
  const rooms = [...profile.rooms];
  for (const item of draft.rooms) if (!rooms.some((r) => same(r.name, item.name))) rooms.push({ id: createId(), ...item });

  const divisions = profile.divisions.map((d) => ({ ...d }));
  for (const item of draft.divisions) {
    const existing = divisions.find((d) => same(d.name, item.name));
    if (existing) {
      existing.batches = [...new Set([...existing.batches, ...item.batches])];
      if (item.size) existing.size = item.size;
    } else {
      divisions.push({
        id: createId(),
        name: item.name,
        batches: item.batches,
        size: item.size ?? 0,
        yearLabel: [profile.department.yearLabel, profile.department.semesterLabel].filter(Boolean).join(' · '),
      });
    }
  }

  const subjects = profile.subjects.map((s) => ({ ...s }));
  for (const item of draft.subjects) {
    const teacherId = teachers.find((t) => item.teacher && same(t.name, item.teacher))?.id ?? '';
    const roomId = rooms.find((r) => item.room && same(r.name, item.room))?.id ?? '';
    const fields = { name: item.name, isLab: item.isLab, durationSlots: item.durationSlots, sessionsPerWeek: item.sessionsPerWeek };
    const existing = subjects.find((s) => same(s.name, item.name));
    if (existing) Object.assign(existing, fields, { teacherId: teacherId || existing.teacherId, roomId: roomId || existing.roomId });
    else subjects.push({ id: createId(), ...fields, teacherId, roomId, divisionIds: [], teacherOverrides: {} });
  }

  const inst = draft.institution;
  return {
    ...profile,
    institution: {
      ...profile.institution,
      name: inst.name ?? profile.institution.name,
      workingDays: inst.workingDays.length ? inst.workingDays : profile.institution.workingDays,
      startTime: inst.startTime ?? profile.institution.startTime,
      endTime: inst.endTime ?? profile.institution.endTime,
      slotDurationMinutes: inst.slotDurationMinutes ?? profile.institution.slotDurationMinutes,
      breakAfterSlots: inst.breakAfterSlots ?? profile.institution.breakAfterSlots,
      breakDurationMinutes: inst.breakDurationMinutes ?? profile.institution.breakDurationMinutes,
    },
    teachers,
    rooms,
    divisions,
    subjects,
  };
};
