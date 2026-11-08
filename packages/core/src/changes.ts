import { coveredSlots, formatDateKey, sessionsOnDay, weekAsText, weekdayOf } from './ops';
import type { ProfileData } from './samples';
import type { OperationsData, RoomForm, ScheduledSession } from './types';

/**
 * What changed since teachers were last told, who it affects, and what to say to each of them.
 * Session ids differ between versions, so classes are matched by subject, class and batch.
 */

export type ChangeKind = 'moved' | 'room' | 'teacher' | 'added' | 'removed';

export interface TimetableChange {
  kind: ChangeKind;
  before?: ScheduledSession;
  after?: ScheduledSession;
}

/** What teachers were last told. */
export interface PublishedTimetable {
  versionId: string;
  at: string;
  sessions: ScheduledSession[];
  names: Record<string, string>;
}

export interface UpdateRecipient {
  teacherId: string;
  name: string;
  /** The full message. */
  text: string;
  /** The same on one line, for WhatsApp templates, which don't allow line breaks. */
  summary: string;
  /** A few words for the list: what this person is being told. */
  headline: string;
}

export interface TimetableUpdate {
  title: string;
  kind: 'timetable' | 'cover';
  recipients: UpdateRecipient[];
  /** A summary to paste into a group. */
  groupText: string;
  changeCount: number;
}

const groupKey = (s: ScheduledSession) => `${s.subject_id}|${s.division_id}|${s.batch ?? ''}`;
const place = (s: ScheduledSession) => `${s.day}|${s.slot}`;

export const diffTimetable = (before: ScheduledSession[], after: ScheduledSession[]): TimetableChange[] => {
  const changes: TimetableChange[] = [];
  const groups = new Map<string, { before: ScheduledSession[]; after: ScheduledSession[] }>();
  const groupOf = (s: ScheduledSession) => {
    const key = groupKey(s);
    if (!groups.has(key)) groups.set(key, { before: [], after: [] });
    return groups.get(key)!;
  };
  before.forEach((s) => groupOf(s).before.push(s));
  after.forEach((s) => groupOf(s).after.push(s));

  for (const group of groups.values()) {
    // Same time first: those are unchanged, or changed only in room or teacher.
    let oldOnes = [...group.before];
    let newOnes: ScheduledSession[] = [];
    for (const session of group.after) {
      const index = oldOnes.findIndex((old) => place(old) === place(session));
      if (index === -1) {
        newOnes.push(session);
        continue;
      }
      const [old] = oldOnes.splice(index, 1);
      if (old.teacher_id !== session.teacher_id) changes.push({ kind: 'teacher', before: old, after: session });
      else if (old.room_id !== session.room_id) changes.push({ kind: 'room', before: old, after: session });
    }
    // Whatever is left has moved. Beyond that, classes were added or removed.
    const pairs = Math.min(oldOnes.length, newOnes.length);
    for (let i = 0; i < pairs; i += 1) changes.push({ kind: 'moved', before: oldOnes[i], after: newOnes[i] });
    oldOnes = oldOnes.slice(pairs);
    newOnes = newOnes.slice(pairs);
    oldOnes.forEach((session) => changes.push({ kind: 'removed', before: session }));
    newOnes.forEach((session) => changes.push({ kind: 'added', after: session }));
  }
  return changes;
};

const when = (s: ScheduledSession) => `${s.day.slice(0, 3)} ${s.slot.split('-')[0]}`;
const what = (s: ScheduledSession, names: Record<string, string>) => `${names[s.subject_id] ?? 'A class'} · ${names[s.division_id] ?? ''}${s.batch ? ` ${s.batch}` : ''}`;

/** A change in plain words. `teacherId` words a change of teacher from that person's side. */
export const describeChange = (change: TimetableChange, names: Record<string, string>, oldNames: Record<string, string> = names, teacherId?: string) => {
  const { before, after, kind } = change;
  const roomOf = (s: ScheduledSession, map = names) => map[s.room_id] ?? 'a room';
  switch (kind) {
    case 'moved':
      return `${what(after!, names)}: moved from ${when(before!)} to ${when(after!)}, in ${roomOf(after!)}`;
    case 'room':
      return `${what(after!, names)}, ${when(after!)}: now in ${roomOf(after!)} (was ${roomOf(before!, { ...names, ...oldNames })})`;
    case 'teacher': {
      const newName = names[after!.teacher_id] ?? 'someone else';
      if (teacherId === after!.teacher_id) return `${what(after!, names)}, ${when(after!)}: you now take this class, in ${roomOf(after!)}`;
      if (teacherId === before!.teacher_id) return `${what(after!, names)}, ${when(after!)}: ${newName} now takes this class`;
      return `${what(after!, names)}, ${when(after!)}: now taken by ${newName}`;
    }
    case 'added':
      return `${what(after!, names)}: new class on ${when(after!)}, in ${roomOf(after!)}`;
    default:
      return `${what(before!, { ...names, ...oldNames })}, ${when(before!)}: no longer happening`;
  }
};

/** Meta caps template values, so a long week ends by saying there's more. */
const fitTemplate = (text: string) => (text.length > 780 ? `${text.slice(0, 760).replace(/[;,]?\s*\S*$/, '')} … please ask your coordinator for the rest` : text);

/** A teacher's week on one line. */
const weekLine = (sessions: ScheduledSession[], days: string[], slots: string[], names: Record<string, string>) =>
  fitTemplate(
    days
      .flatMap((day) => sessionsOnDay(sessions, day, slots).map((s) => `${day.slice(0, 3)} ${s.slot.split('-')[0]} ${names[s.subject_id] ?? ''} (${names[s.division_id] ?? ''}${s.batch ? ` ${s.batch}` : ''}, ${names[s.room_id] ?? ''})`))
      .join('; '),
  );

const firstName = (name: string) => name.replace(/^(prof|dr|mr|mrs|ms)\.?\s+/i, '').split(/\s+/)[0] ?? name;
const namesOf = (profile: ProfileData) => {
  const names: Record<string, string> = {};
  for (const item of [...profile.divisions, ...profile.teachers, ...profile.rooms, ...profile.subjects]) names[item.id] = item.name;
  return names;
};

/**
 * Who needs telling, and what. With nothing published yet, everyone gets their whole week;
 * after that, only the people a change touches hear about it.
 */
export const buildTimetableUpdate = ({
  published,
  sessions,
  profile,
  slots,
}: {
  published: PublishedTimetable | null | undefined;
  sessions: ScheduledSession[];
  profile: ProfileData;
  slots: string[];
}): TimetableUpdate => {
  const names = namesOf(profile);
  const days = profile.institution.workingDays;
  const college = profile.institution.name;

  if (!published) {
    const recipients = profile.teachers
      .map((teacher) => {
        const mine = sessions.filter((s) => s.teacher_id === teacher.id);
        if (!mine.length) return null;
        const week = weekAsText({ title: teacher.name, sessions: mine, days, slots, names, perspective: 'teacher' });
        return {
          teacherId: teacher.id,
          name: teacher.name,
          text: `Hello ${firstName(teacher.name)}, here is your timetable from ${college}.\n\n${week}`,
          summary: `your weekly timetable is ${weekLine(mine, days, slots, names)}`,
          headline: `Their full week: ${plural(mine.length, 'class', 'classes')}`,
        };
      })
      .filter((item): item is UpdateRecipient => !!item);
    return {
      title: 'New timetable',
      kind: 'timetable',
      recipients,
      groupText: `The timetable for ${college} is ready. Each teacher has been sent their own week.`,
      changeCount: sessions.length,
    };
  }

  const changes = diffTimetable(published.sessions, sessions);
  const lines = new Map<string, string[]>();
  const add = (teacherId: string | undefined, line: string) => {
    if (!teacherId) return;
    const list = lines.get(teacherId) ?? [];
    if (!list.includes(line)) list.push(line);
    lines.set(teacherId, list);
  };
  for (const change of changes) {
    for (const teacherId of new Set([change.before?.teacher_id, change.after?.teacher_id])) {
      add(teacherId, describeChange(change, names, published.names, teacherId));
    }
  }
  // A renamed room is a change for everyone teaching there, though no class has moved.
  const renamed = profile.rooms.filter((room) => published.names[room.id] && published.names[room.id] !== room.name);
  for (const room of renamed) {
    for (const session of sessions) {
      if (session.room_id === room.id) add(session.teacher_id, `${published.names[room.id]} is now called ${room.name}`);
    }
  }

  const recipients = [...lines.entries()].map(([teacherId, list]) => {
    const name = names[teacherId] ?? published.names[teacherId] ?? 'Teacher';
    return {
      teacherId,
      name,
      text: `Hello ${firstName(name)}, your timetable at ${college} has changed:\n\n${list.map((line) => `• ${line}`).join('\n')}`,
      summary: fitTemplate(list.join('; ')),
      headline: plural(list.length, 'change'),
    };
  });
  const everything = changes.map((change) => describeChange(change, names, published.names));
  const renames = renamed.map((room) => `${published.names[room.id]} is now called ${room.name}`);
  return {
    title: `${plural(changes.length + renames.length, 'timetable change')}`,
    kind: 'timetable',
    recipients,
    groupText: `Timetable changes at ${college}:\n\n${[...everything, ...renames].map((line) => `• ${line}`).join('\n')}`,
    changeCount: changes.length + renames.length,
  };
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Who is covering what on a day: each substitute hears their periods; so does whoever is away. */
export const buildCoverUpdate = ({
  date,
  ops,
  sessions,
  profile,
  slots,
}: {
  date: string;
  ops: OperationsData;
  sessions: ScheduledSession[];
  profile: ProfileData;
  slots: string[];
}): TimetableUpdate => {
  const names = namesOf(profile);
  const nice = formatDateKey(date);
  const today = sessionsOnDay(sessions, weekdayOf(date), slots);
  const away = new Set(ops.absences.filter((a) => a.date === date).map((a) => a.teacherId));
  const subs = ops.substitutions.filter((s) => s.date === date);
  const lines = new Map<string, string[]>();
  const add = (teacherId: string, line: string) => lines.set(teacherId, [...(lines.get(teacherId) ?? []), line]);
  const group: string[] = [];

  for (const session of today.filter((s) => away.has(s.teacher_id))) {
    const sub = subs.find((x) => x.sessionId === session.id);
    const time = session.slot.split('-')[0];
    const label = `${time} ${names[session.subject_id] ?? ''} · ${names[session.division_id] ?? ''}${session.batch ? ` ${session.batch}` : ''} · ${names[session.room_id] ?? ''}`;
    const who = !sub ? 'not covered yet' : sub.substituteTeacherId ? (names[sub.substituteTeacherId] ?? 'a substitute') : 'free period';
    group.push(`• ${label}: ${names[session.teacher_id] ?? ''} → ${who}`);
    add(session.teacher_id, `${label}: ${who}`);
    if (sub?.substituteTeacherId) add(sub.substituteTeacherId, `${label}: please cover for ${names[session.teacher_id] ?? 'a colleague'}`);
  }
  return {
    title: `Cover for ${nice}`,
    kind: 'cover',
    recipients: [...lines.entries()].map(([teacherId, list]) => {
      const name = names[teacherId] ?? 'Teacher';
      return {
        teacherId,
        name,
        text: `Hello ${firstName(name)}, cover at ${profile.institution.name} for ${nice}:\n\n${list.map((line) => `• ${line}`).join('\n')}`,
        summary: fitTemplate(`cover for ${nice}: ${list.join('; ')}`),
        headline: `${plural(list.length, 'period')} on ${nice}`,
      };
    }),
    groupText: `Substitutions for ${nice}:\n\n${group.join('\n')}`,
    changeCount: group.length,
  };
};

export const roomSuits = (session: Pick<ScheduledSession, 'kind' | 'size'>, room: RoomForm) =>
  (room.type === 'lab') === (session.kind === 'lab') && !(session.size && room.capacity && room.capacity < session.size);

/** Rooms this class could use instead: the right kind, big enough, and free the whole time. */
export const freeRoomsFor = (session: ScheduledSession, sessions: ScheduledSession[], rooms: RoomForm[], slots: string[]) => {
  const needed = new Set(coveredSlots(session, slots));
  return rooms.filter((room) => {
    if (room.id === session.room_id || !roomSuits(session, room)) return false;
    if (room.unavailableDays?.includes(session.day)) return false;
    return !sessions.some((other) => other.id !== session.id && other.room_id === room.id && other.day === session.day && coveredSlots(other, slots).some((slot) => needed.has(slot)));
  });
};

/** Classes whose room was deleted. */
export const sessionsWithoutRoom = (sessions: ScheduledSession[], rooms: RoomForm[]) => sessions.filter((s) => !rooms.some((room) => room.id === s.room_id));

/** Gives classes that lost their room a free one. Any it can't place are left as they are. */
export const repairRooms = (sessions: ScheduledSession[], rooms: RoomForm[], slots: string[]) => {
  let next = sessions;
  let unfixed = 0;
  for (const session of sessionsWithoutRoom(sessions, rooms)) {
    const [room] = freeRoomsFor(session, next, rooms, slots);
    if (room) next = next.map((s) => (s.id === session.id ? { ...s, room_id: room.id } : s));
    else unfixed += 1;
  }
  return { sessions: next, unfixed };
};

/** A notice as the server keeps it. */
export type RecipientStatus = 'pending' | 'opened' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped';

export interface NoticeRecipient extends UpdateRecipient {
  status: RecipientStatus;
  via?: 'link' | 'api';
  error?: string;
  updatedAt?: string;
}

export interface NoticeRecord {
  id: string;
  title: string;
  kind: 'timetable' | 'cover';
  groupText: string;
  groupShared?: boolean;
  createdAt: string;
  recipients: NoticeRecipient[];
}

/** Told means it left for the teacher, or someone decided they needn't hear. */
export const isTold = (status: RecipientStatus) => ['sent', 'delivered', 'read', 'skipped'].includes(status);
export const noticeProgress = (notice: NoticeRecord) => ({ told: notice.recipients.filter((r) => isTold(r.status)).length, total: notice.recipients.length });
