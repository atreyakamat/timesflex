import { Fragment, useState } from 'react';
import type { Page } from '../App';
import {
  absentTeacherIds,
  coveredSlots,
  currentSlotIndex,
  effectiveTeacher,
  findAttendance,
  sessionsOnDay,
  studentsFor,
  toDateKey,
  weekdayOf,
} from '../ops';
import type {
  DivisionForm,
  OperationsData,
  RoomForm,
  ScheduledSession,
  SubjectForm,
  TeacherForm,
  TimetableRecord,
} from '../types';
import { breaksAfter } from '../utils';
import { DateNav, stepWorkingDay } from './DateNav';

interface TodayProps {
  days: string[];
  slots: string[];
  divisions: DivisionForm[];
  teachers: TeacherForm[];
  rooms: RoomForm[];
  subjects: SubjectForm[];
  names: Record<string, string>;
  sessions: ScheduledSession[];
  operations: OperationsData;
  liveVersion?: TimetableRecord;
  onGo: (page: Page) => void;
}

export function Today({ days, slots, divisions, teachers, names, sessions, operations, liveVersion, onGo }: TodayProps) {
  const [date, setDate] = useState(() => toDateKey(new Date()));
  const [filter, setFilter] = useState('all');

  const weekday = weekdayOf(date);
  const isToday = date === toDateKey(new Date());
  const nowIndex = isToday ? currentSlotIndex(slots, new Date()) : -1;
  const breaks = breaksAfter(slots);
  const absent = absentTeacherIds(operations, date);

  const [kind, id] = filter.split(':');
  const dayList = sessionsOnDay(sessions, weekday, slots).filter((session) => {
    if (kind === 'division') return session.division_id === id;
    if (kind === 'teacher') return effectiveTeacher(session, date, operations.substitutions) === id || session.teacher_id === id;
    return true;
  });
  const needsCover = dayList.filter(
    (session) => absent.has(session.teacher_id) && !operations.substitutions.some((s) => s.date === date && s.sessionId === session.id),
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Run your week</p>
          <h1>{isToday ? 'Today' : weekday}</h1>
          <p>
            Live from {liveVersion?.label ?? 'your timetable'}
            {liveVersion && liveVersion.status !== 'approved' ? ' (not approved yet)' : ''}, with substitutions applied.
          </p>
        </div>
      </header>

      <section className="panel toolbar">
        <DateNav value={date} days={days} onChange={setDate} />
        <label className="mini wide">
          Show
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">Everyone</option>
            <optgroup label="Class">
              {divisions.map((item) => (
                <option key={item.id} value={`division:${item.id}`}>
                  {item.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Teacher">
              {teachers.map((item) => (
                <option key={item.id} value={`teacher:${item.id}`}>
                  {item.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </section>

      {absent.size > 0 && (
        <button type="button" className={`alert ${needsCover.length ? 'warn' : 'ok'}`} onClick={() => onGo('substitutions')}>
          Absent: {[...absent].map((teacherId) => names[teacherId]).join(', ')}.{' '}
          {needsCover.length ? `${needsCover.length} period(s) still need a substitute →` : 'All periods covered.'}
        </button>
      )}

      {!days.includes(weekday) ? (
        <div className="empty">
          No classes on {weekday}.{' '}
          <button type="button" className="link-button" onClick={() => setDate(stepWorkingDay(date, days, 1))}>
            Go to the next working day
          </button>
        </div>
      ) : (
        <section className="panel flush">
          <div className="day-timeline">
            {slots.map((slot, index) => {
              const here = dayList.filter((session) => session.slot === slot);
              const ongoing = nowIndex >= 0 && index === nowIndex;
              const past = isToday && nowIndex >= 0 ? index < nowIndex : false;
              return (
                <Fragment key={slot}>
                  <div className={`timeline-row ${ongoing ? 'now' : ''} ${past ? 'past' : ''}`}>
                    <div className="timeline-time">
                      <strong>P{index + 1}</strong>
                      <span>{slot.replace('-', '–')}</span>
                      {ongoing && <em>Now</em>}
                    </div>
                    <div className="timeline-cards">
                      {here.length === 0 && <span className="muted small">No session starts</span>}
                      {here.map((session) => (
                        <SessionLine
                          key={session.id}
                          session={session}
                          date={date}
                          names={names}
                          slots={slots}
                          operations={operations}
                          absent={absent}
                          hasRoster={studentsFor(divisions.find((d) => d.id === session.division_id), session.batch).length > 0}
                          onGo={onGo}
                        />
                      ))}
                    </div>
                  </div>
                  {breaks.has(index) && <div className="timeline-break">Break</div>}
                </Fragment>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function SessionLine({
  session,
  date,
  names,
  slots,
  operations,
  absent,
  hasRoster,
  onGo,
}: {
  session: ScheduledSession;
  date: string;
  names: Record<string, string>;
  slots: string[];
  operations: OperationsData;
  absent: Set<string>;
  hasRoster: boolean;
  onGo: (page: Page) => void;
}) {
  const substitution = operations.substitutions.find((item) => item.date === date && item.sessionId === session.id);
  const teacherAbsent = absent.has(session.teacher_id);
  const end = coveredSlots(session, slots).at(-1)?.split('-')[1];
  const record = findAttendance(operations.attendance, date, session.id);

  let teacher = <span>{names[session.teacher_id]}</span>;
  if (substitution) {
    teacher = substitution.substituteTeacherId ? (
      <span>
        <s>{names[session.teacher_id]}</s> → <strong>{names[substitution.substituteTeacherId]}</strong>
      </span>
    ) : (
      <span className="text-warning">Free period ({names[session.teacher_id]} absent)</span>
    );
  } else if (teacherAbsent) {
    teacher = <span className="text-danger">{names[session.teacher_id]} absent, needs cover</span>;
  }

  return (
    <div className={`line-card ${session.kind === 'lab' ? 'lab' : ''} ${teacherAbsent && !substitution ? 'alerting' : ''}`}>
      <div>
        <strong>{names[session.subject_id]}</strong>
        <span className="muted">
          {' '}
          · {names[session.division_id]}
          {session.batch ? ` ${session.batch}` : ''}
        </span>
      </div>
      <div className="line-meta">
        {teacher}
        <span>· {names[session.room_id]}</span>
        {session.duration_slots > 1 && <span className="muted">· until {end}</span>}
      </div>
      {hasRoster && (
        <button type="button" className="chip small-chip" onClick={() => onGo('attendance')}>
          {record ? `Attendance ✓ ${record.absentStudentIds.length} absent` : 'Take attendance'}
        </button>
      )}
    </div>
  );
}
