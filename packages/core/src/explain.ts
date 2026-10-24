import { coveredSlots } from './ops';
import type { DivisionForm, RoomForm, ScheduledSession, TeacherForm } from './types';
import { breaksAfter, isBlocked, slotKey } from './utils';

/**
 * "Why is this class here?" Reconstructs, in plain sentences, the facts that shaped one
 * session's position: who was busy earlier in the week, which rooms fit, and which rules
 * ruled other times out. It reads the finished timetable, so it explains the result
 * rather than the solver's internals.
 */

export interface Explanation {
  summary: string;
  reasons: string[];
  /** Other times this session could move to right now without breaking a rule. */
  alternatives: { day: string; slot: string }[];
}

interface Context {
  days: string[];
  slots: string[];
  sessions: ScheduledSession[];
  teachers: TeacherForm[];
  rooms: RoomForm[];
  divisions: DivisionForm[];
  names: Record<string, string>;
}

/** True when nothing else in the timetable stops `session` starting at (day, start). */
export const canPlace = (session: ScheduledSession, day: string, start: number, ctx: Context) => {
  const { slots, sessions, teachers, rooms } = ctx;
  if (start + session.duration_slots > slots.length) return false;
  const breaks = breaksAfter(slots);
  for (let i = start; i < start + session.duration_slots - 1; i += 1) if (breaks.has(i)) return false;
  const span = slots.slice(start, start + session.duration_slots);
  const teacher = teachers.find((t) => t.id === session.teacher_id);
  const room = rooms.find((r) => r.id === session.room_id);
  if (span.some((slot) => isBlocked(teacher, day, slot) || isBlocked(room, day, slot))) return false;
  // The teacher's daily limit counts too, not just clashes.
  if (teacher) {
    const loadThatDay = sessions
      .filter((other) => other.id !== session.id && other.day === day && other.teacher_id === session.teacher_id)
      .reduce((sum, other) => sum + other.duration_slots, 0);
    if (loadThatDay + session.duration_slots > teacher.maxLecturesPerDay) return false;
  }
  return !sessions.some((other) => {
    if (other.id === session.id || other.day !== day) return false;
    const overlap = coveredSlots(other, slots).some((slot) => span.includes(slot));
    if (!overlap) return false;
    const sameClass =
      other.division_id === session.division_id && (!other.batch || !session.batch || other.batch === session.batch);
    return other.teacher_id === session.teacher_id || other.room_id === session.room_id || sameClass;
  });
};

export const explainSession = (session: ScheduledSession, ctx: Context): Explanation => {
  const { days, slots, sessions, teachers, rooms, divisions, names } = ctx;
  const teacher = teachers.find((t) => t.id === session.teacher_id);
  const room = rooms.find((r) => r.id === session.room_id);
  const division = divisions.find((d) => d.id === session.division_id);
  const subject = names[session.subject_id] ?? 'This class';
  const who = `${names[session.division_id] ?? 'the class'}${session.batch ? ` ${session.batch}` : ''}`;
  const reasons: string[] = [];
  const start = slots.indexOf(session.slot);

  if (session.locked) reasons.push('You locked it here, so regenerating keeps it in place.');

  // Teacher's own constraints.
  if (teacher?.unavailableDays?.length) {
    reasons.push(`${teacher.name} does not teach on ${teacher.unavailableDays.join(' or ')}.`);
  }
  const blockedCells = teacher?.unavailableSlots?.length ?? 0;
  if (blockedCells) reasons.push(`${teacher!.name} has ${blockedCells} blocked period(s) in the week.`);
  if (teacher?.preferredSlots?.includes(slotKey(session.day, session.slot))) {
    reasons.push(`It is one of ${teacher.name}'s preferred times.`);
  }

  // Same subject spread across the week.
  const sameSubject = sessions.filter(
    (other) => other.subject_id === session.subject_id && other.division_id === session.division_id && (other.batch ?? '') === (session.batch ?? ''),
  );
  if (sameSubject.length > 1) {
    const otherDays = [...new Set(sameSubject.filter((s) => s.id !== session.id).map((s) => s.day))];
    if (!otherDays.includes(session.day)) {
      reasons.push(`${who} has ${subject} on ${otherDays.join(', ')} too, so it is spread across the week rather than repeated on one day.`);
    }
  }

  // Multi-period blocks and breaks.
  if (session.duration_slots > 1) {
    reasons.push(`It needs ${session.duration_slots} periods in a row without a break in the middle.`);
  }

  // Why not earlier the same day?
  const earlier: string[] = [];
  for (let t = 0; t < start; t += 1) {
    const span = slots.slice(t, t + session.duration_slots);
    const clash = sessions.find(
      (other) =>
        other.id !== session.id &&
        other.day === session.day &&
        coveredSlots(other, slots).some((slot) => span.includes(slot)) &&
        (other.teacher_id === session.teacher_id ||
          (other.division_id === session.division_id && (!other.batch || !session.batch || other.batch === session.batch))),
    );
    if (clash) {
      earlier.push(
        clash.teacher_id === session.teacher_id
          ? `${teacher?.name ?? 'The teacher'} teaches ${names[clash.subject_id]} to ${names[clash.division_id]} at ${clash.slot.split('-')[0]}`
          : `${who} has ${names[clash.subject_id]} at ${clash.slot.split('-')[0]}`,
      );
    }
  }
  if (earlier.length) reasons.push(`Earlier that day: ${[...new Set(earlier)].slice(0, 2).join('; ')}.`);

  // Room choice.
  if (room) {
    const size = session.size || 0;
    const sameKind = rooms.filter((r) => (r.type === 'lab') === (room.type === 'lab'));
    if (size && room.capacity >= size) {
      reasons.push(`${room.name} seats ${room.capacity}, enough for ${size}${sameKind.length > 1 ? `; it was free at this time` : ''}.`);
    } else if (room.type === 'lab') {
      reasons.push(`${room.name} is a lab, which this session needs.`);
    }
  }
  if (division?.batches.length && session.batch) {
    reasons.push(`Other batches of ${division.name} can be elsewhere at the same time.`);
  }

  const alternatives: { day: string; slot: string }[] = [];
  for (const day of days) {
    for (let t = 0; t < slots.length; t += 1) {
      if (day === session.day && t === start) continue;
      if (canPlace(session, day, t, ctx)) alternatives.push({ day, slot: slots[t] });
    }
  }

  const summary = `${subject} for ${who} is on ${session.day} at ${session.slot.split('-')[0]}${teacher ? ` with ${teacher.name}` : ''}${room ? ` in ${room.name}` : ''}.`;
  if (!reasons.length) reasons.push('It is the earliest time that keeps the week balanced for everyone involved.');
  return { summary, reasons, alternatives };
};
