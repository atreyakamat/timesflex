import { useState } from 'react';
import {
  absentTeacherIds,
  assignSubstitute,
  formatDateKey,
  sessionsOnDay,
  setAbsent,
  substituteCandidates,
  weekdayOf,
  whatsappLink,
} from '../ops';
import type { DivisionForm, OperationsData, RoomForm, ScheduledSession, SubjectForm, TeacherForm } from '../types';
import { DateNav, nearestWorkingDay } from './DateNav';

interface SubstitutionsProps {
  days: string[];
  slots: string[];
  divisions: DivisionForm[];
  teachers: TeacherForm[];
  rooms: RoomForm[];
  subjects: SubjectForm[];
  names: Record<string, string>;
  sessions: ScheduledSession[];
  operations: OperationsData;
  onChange: (operations: OperationsData) => void;
}

const FREE = '__free__';

export function Substitutions({ days, slots, teachers, subjects, names, sessions, operations, onChange }: SubstitutionsProps) {
  const [date, setDate] = useState(() => nearestWorkingDay(days));
  const [copied, setCopied] = useState(false);

  const weekday = weekdayOf(date);
  const dayList = sessionsOnDay(sessions, weekday, slots);
  const absent = absentTeacherIds(operations, date);
  const subsToday = operations.substitutions.filter((item) => item.date === date);
  const periodsOf = (teacherId: string) => dayList.filter((session) => session.teacher_id === teacherId);

  const pick = (session: ScheduledSession, value: string) => {
    onChange(
      assignSubstitute(operations, {
        date,
        session,
        substituteTeacherId: value === '' ? null : value === FREE ? '' : value,
      }),
    );
  };

  const noticeLines = [...absent].flatMap((teacherId) =>
    periodsOf(teacherId).map((session) => {
      const sub = subsToday.find((item) => item.sessionId === session.id);
      const cover = !sub ? 'NOT COVERED' : sub.substituteTeacherId ? names[sub.substituteTeacherId] : 'free period';
      return `${session.slot.split('-')[0]}  ${names[session.subject_id]} · ${names[session.division_id]}${session.batch ? ` ${session.batch}` : ''} · ${names[session.room_id]}: ${names[teacherId]} → ${cover}`;
    }),
  );
  const notice = `Substitutions for ${formatDateKey(date)}\n\n${noticeLines.join('\n')}`;

  const copyNotice = async () => {
    try {
      await navigator.clipboard.writeText(notice);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked; the notice is still visible on screen.
    }
  };

  const covering = [...new Set(subsToday.map((item) => item.substituteTeacherId).filter(Boolean))];
  const total = [...absent].reduce((sum, teacherId) => sum + periodsOf(teacherId).length, 0);
  const covered = [...absent].reduce(
    (sum, teacherId) => sum + periodsOf(teacherId).filter((s) => subsToday.some((item) => item.sessionId === s.id)).length,
    0,
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Run your week</p>
          <h1>Substitutions</h1>
          <p>Mark who is absent. For each of their periods TimeFlex lists the teachers who are free, under their daily limit, and best suited.</p>
        </div>
      </header>

      <section className="panel toolbar">
        <DateNav value={date} days={days} onChange={setDate} />
        {absent.size > 0 && (
          <span className={`pill ${covered === total ? 'ok' : 'warn'}`}>
            {covered}/{total} periods covered
          </span>
        )}
      </section>

      {!days.includes(weekday) ? (
        <div className="empty">No classes on {weekday}.</div>
      ) : (
        <>
          <section className="panel">
            <h2>Who is absent?</h2>
            <div className="chip-row">
              {teachers.map((teacher) => {
                const count = periodsOf(teacher.id).length;
                const isAbsent = absent.has(teacher.id);
                return (
                  <button
                    key={teacher.id}
                    type="button"
                    className={`chip ${isAbsent ? 'absent' : ''}`}
                    onClick={() => onChange(setAbsent(operations, date, teacher.id, !isAbsent))}
                    title={isAbsent ? 'Mark present' : 'Mark absent'}
                  >
                    {isAbsent ? '✕ ' : ''}
                    {teacher.name}
                    <small> · {count ? `${count} period${count === 1 ? '' : 's'}` : 'no classes'}</small>
                  </button>
                );
              })}
            </div>
          </section>

          {[...absent].map((teacherId) => {
            const periods = periodsOf(teacherId);
            return (
              <section key={teacherId} className="panel">
                <h2>
                  {names[teacherId]} <span className="muted small">· {periods.length} period(s) to cover</span>
                </h2>
                {periods.length === 0 && <p className="muted">No classes on {weekday}. Nothing to cover.</p>}
                <div className="list">
                  {periods.map((session) => {
                    const sub = subsToday.find((item) => item.sessionId === session.id);
                    const candidates = substituteCandidates({ session, date, slots, sessions, teachers, subjects, ops: operations });
                    const value = !sub ? '' : sub.substituteTeacherId || FREE;
                    // Keep the current pick selectable even if it no longer ranks as free.
                    const current = sub?.substituteTeacherId && !candidates.some((c) => c.teacher.id === sub.substituteTeacherId);
                    return (
                      <div key={session.id} className={`list-item ${sub ? '' : 'needs-attention'}`}>
                        <div className="list-content">
                          <strong>
                            {session.slot.replace('-', '–')} · {names[session.subject_id]}
                          </strong>
                          <span>
                            {names[session.division_id]}
                            {session.batch ? ` ${session.batch}` : ''} · {names[session.room_id]}
                            {session.duration_slots > 1 ? ` · ${session.duration_slots} periods` : ''}
                          </span>
                        </div>
                        <div className="inline-fields">
                          <label className="mini wide xl">
                            Covered by
                            <select value={value} onChange={(e) => pick(session, e.target.value)}>
                              <option value="">Choose a substitute…</option>
                              {candidates.map((candidate, index) => (
                                <option key={candidate.teacher.id} value={candidate.teacher.id}>
                                  {index === 0 ? '★ ' : ''}
                                  {candidate.teacher.name} · {candidate.reasons.join(', ')}
                                </option>
                              ))}
                              {current && <option value={sub!.substituteTeacherId}>{names[sub!.substituteTeacherId]}</option>}
                              <option value={FREE}>Nobody: leave as a free period</option>
                            </select>
                          </label>
                          {candidates.length === 0 && <span className="text-warning small">No teacher is free then.</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {noticeLines.length > 0 && (
            <section className="panel">
              <div className="section-head">
                <h2>Notice</h2>
                <button type="button" className="secondary small" onClick={copyNotice}>
                  {copied ? 'Copied ✓' : 'Copy notice'}
                </button>
              </div>
              <pre className="notice">{notice}</pre>
              {covering.length > 0 && (
                <div className="chip-row">
                  {covering.map((teacherId) => {
                    const teacher = teachers.find((item) => item.id === teacherId);
                    const mine = subsToday
                      .filter((item) => item.substituteTeacherId === teacherId)
                      .map((item) => sessions.find((s) => s.id === item.sessionId))
                      .filter(Boolean) as ScheduledSession[];
                    const message = `Hello ${teacher?.name}, please cover on ${formatDateKey(date)}:\n${mine
                      .map((s) => `${s.slot.split('-')[0]} ${names[s.subject_id]} · ${names[s.division_id]}${s.batch ? ` ${s.batch}` : ''} · ${names[s.room_id]}`)
                      .join('\n')}`;
                    return teacher?.phone ? (
                      <a key={teacherId} className="chip link-chip" href={whatsappLink(teacher.phone, message)} target="_blank" rel="noreferrer">
                        WhatsApp {teacher.name}
                      </a>
                    ) : teacher?.email ? (
                      <a
                        key={teacherId}
                        className="chip link-chip"
                        href={`mailto:${teacher.email}?subject=${encodeURIComponent(`Substitution on ${formatDateKey(date)}`)}&body=${encodeURIComponent(message)}`}
                      >
                        E-mail {teacher.name}
                      </a>
                    ) : (
                      <span key={teacherId} className="chip muted" title="Add a phone or e-mail in People to message them">
                        {teacher?.name}: no contact
                      </span>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
