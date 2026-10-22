import { useState } from 'react';
import {
  absentTeacherIds,
  assignSubstitute,
  autoAssignSubstitutes,
  formatDateKey,
  recentCoverCounts,
  sessionsOnDay,
  setAbsent,
  setLeave,
  substituteCandidates,
  toDateKey,
  uncoveredPeriods,
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

/** Group consecutive absence dates per teacher into "Mon 19 – Wed 21 Oct" style ranges. */
const upcomingLeave = (operations: OperationsData, from: string, names: Record<string, string>) => {
  const byTeacher = new Map<string, { dates: string[]; reason?: string }>();
  for (const absence of operations.absences) {
    if (absence.date < from) continue;
    const entry = byTeacher.get(absence.teacherId) ?? { dates: [] };
    entry.dates.push(absence.date);
    entry.reason ??= absence.reason;
    byTeacher.set(absence.teacherId, entry);
  }
  return [...byTeacher.entries()]
    .map(([teacherId, entry]) => {
      const dates = [...new Set(entry.dates)].sort();
      return { teacherId, name: names[teacherId] ?? 'Teacher', dates, reason: entry.reason };
    })
    .sort((a, b) => a.dates[0].localeCompare(b.dates[0]));
};

const shortDate = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};

export function Substitutions({ days, slots, teachers, subjects, names, sessions, operations, onChange }: SubstitutionsProps) {
  const [date, setDate] = useState(() => nearestWorkingDay(days));
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveTeacher, setLeaveTeacher] = useState('');
  const [leaveFrom, setLeaveFrom] = useState(date);
  const [leaveTo, setLeaveTo] = useState(date);
  const [leaveReason, setLeaveReason] = useState('');
  const [query, setQuery] = useState('');

  const weekday = weekdayOf(date);
  const dayList = sessionsOnDay(sessions, weekday, slots);
  const absent = absentTeacherIds(operations, date);
  const subsToday = operations.substitutions.filter((item) => item.date === date);
  const periodsOf = (teacherId: string) => dayList.filter((session) => session.teacher_id === teacherId);
  const open = uncoveredPeriods(operations, date, sessions, slots);
  const total = [...absent].reduce((sum, teacherId) => sum + periodsOf(teacherId).length, 0);
  const covered = total - open.length;
  const context = { date, slots, sessions, teachers, subjects };

  const pick = (session: ScheduledSession, value: string) => {
    setMessage('');
    onChange(
      assignSubstitute(operations, {
        date,
        session,
        substituteTeacherId: value === '' ? null : value === FREE ? '' : value,
      }),
    );
  };

  const autoAssign = () => {
    const { operations: next, assigned, unfilled } = autoAssignSubstitutes(operations, context);
    onChange(next);
    setMessage(
      unfilled.length
        ? `Covered ${assigned} period(s). ${unfilled.length} could not be covered: nobody is free then. Choose “free period” or adjust by hand.`
        : `Covered all ${assigned} period(s), sharing them fairly.`,
    );
  };

  const saveLeave = () => {
    if (!leaveTeacher) return;
    onChange(setLeave(operations, { teacherId: leaveTeacher, from: leaveFrom, to: leaveTo, days, reason: leaveReason }));
    setLeaveOpen(false);
    setLeaveReason('');
    setMessage(`${names[leaveTeacher]} is marked on leave ${leaveFrom === leaveTo ? `on ${shortDate(leaveFrom)}` : `from ${shortDate(leaveFrom)} to ${shortDate(leaveTo)}`}.`);
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
  const counts = recentCoverCounts(operations, date);
  const leaderboard = teachers
    .map((teacher) => ({ teacher, count: counts.get(teacher.id) ?? 0 }))
    .filter((row) => row.count)
    .sort((a, b) => b.count - a.count);
  const leave = upcomingLeave(operations, toDateKey(new Date()), names);
  const shownTeachers = query ? teachers.filter((t) => t.name.toLowerCase().includes(query.toLowerCase())) : teachers;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Run your week</p>
          <h1>Substitutions</h1>
          <p>Tap who is away. TimeFlex suggests who is free, under their limit and best suited, and shares the extra periods fairly.</p>
        </div>
        <button type="button" className="secondary" onClick={() => setLeaveOpen(!leaveOpen)} aria-expanded={leaveOpen}>
          + Add leave
        </button>
      </header>

      {leaveOpen && (
        <section className="panel leave-form">
          <h2>Leave for several days</h2>
          <div className="inline-form">
            <label className="grow">
              Teacher
              <select value={leaveTeacher} onChange={(e) => setLeaveTeacher(e.target.value)}>
                <option value="">Choose…</option>
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="mini wide">
              From
              <input type="date" value={leaveFrom} onChange={(e) => setLeaveFrom(e.target.value)} />
            </label>
            <label className="mini wide">
              To
              <input type="date" value={leaveTo} min={leaveFrom} onChange={(e) => setLeaveTo(e.target.value)} />
            </label>
            <label className="grow">
              Reason <small className="muted">optional</small>
              <input type="text" value={leaveReason} placeholder="e.g. Conference" onChange={(e) => setLeaveReason(e.target.value)} />
            </label>
            <button type="button" className="primary" onClick={saveLeave} disabled={!leaveTeacher}>
              Save leave
            </button>
          </div>
        </section>
      )}

      <section className="panel toolbar">
        <DateNav value={date} days={days} onChange={(value) => { setDate(value); setMessage(''); }} />
        {absent.size > 0 && (
          <span className={`pill ${covered === total ? 'ok' : 'warn'}`}>
            {covered}/{total} periods covered
          </span>
        )}
        {open.length > 0 && (
          <button type="button" className="primary push-right" onClick={autoAssign}>
            ✦ Auto-assign {open.length} period{open.length === 1 ? '' : 's'}
          </button>
        )}
      </section>

      {message && (
        <div className="alert ok" role="status">
          {message}
        </div>
      )}

      {!days.includes(weekday) ? (
        <div className="empty">No classes on {weekday}.</div>
      ) : (
        <>
          <section className="panel">
            <div className="section-head">
              <h2>Who is away on {weekday}?</h2>
              {teachers.length > 8 && (
                <input type="search" className="search-small" placeholder="Find teacher" value={query} onChange={(e) => setQuery(e.target.value)} />
              )}
            </div>
            <div className="absent-grid">
              {shownTeachers.map((teacher) => {
                const count = periodsOf(teacher.id).length;
                const isAbsent = absent.has(teacher.id);
                return (
                  <button
                    key={teacher.id}
                    type="button"
                    className={`absent-tile ${isAbsent ? 'absent' : ''}`}
                    aria-pressed={isAbsent}
                    onClick={() => {
                      setMessage('');
                      onChange(setAbsent(operations, date, teacher.id, !isAbsent));
                    }}
                  >
                    <strong>
                      {isAbsent ? '✕ ' : ''}
                      {teacher.name}
                    </strong>
                    <span>{isAbsent ? 'Away · tap to undo' : count ? `${count} period${count === 1 ? '' : 's'} today` : 'No classes today'}</span>
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
                  {names[teacherId]}’s periods <span className="muted small">· {periods.length} to cover</span>
                </h2>
                {periods.length === 0 && <p className="muted">No classes on {weekday}. Nothing to cover.</p>}
                <div className="cover-list">
                  {periods.map((session) => {
                    const sub = subsToday.find((item) => item.sessionId === session.id);
                    const candidates = substituteCandidates({ ...context, session, ops: operations });
                    const value = !sub ? '' : sub.substituteTeacherId || FREE;
                    const chosen = sub?.substituteTeacherId;
                    const top = candidates.slice(0, 3);
                    return (
                      <div key={session.id} className={`cover-card ${sub ? 'done' : 'open'}`}>
                        <div className="cover-head">
                          <div>
                            <strong>
                              {session.slot.split('-')[0]} · {names[session.subject_id]}
                            </strong>
                            <span className="muted small">
                              {names[session.division_id]}
                              {session.batch ? ` ${session.batch}` : ''} · {names[session.room_id]}
                              {session.duration_slots > 1 ? ` · ${session.duration_slots} periods` : ''}
                            </span>
                          </div>
                          <span className={`pill ${sub ? 'ok' : 'warn'}`}>
                            {!sub ? 'Needs cover' : chosen ? `${names[chosen]}` : 'Free period'}
                          </span>
                        </div>
                        <div className="cover-picks">
                          {top.map((candidate, index) => (
                            <button
                              key={candidate.teacher.id}
                              type="button"
                              className={`pick ${chosen === candidate.teacher.id ? 'active' : ''}`}
                              onClick={() => pick(session, chosen === candidate.teacher.id ? '' : candidate.teacher.id)}
                              aria-pressed={chosen === candidate.teacher.id}
                            >
                              <strong>
                                {index === 0 ? '★ ' : ''}
                                {candidate.teacher.name}
                              </strong>
                              <span>{candidate.reasons.join(' · ')}</span>
                            </button>
                          ))}
                          {candidates.length === 0 && <span className="text-warning small">Nobody is free then.</span>}
                        </div>
                        <div className="cover-more">
                          <select value={value} onChange={(e) => pick(session, e.target.value)} aria-label="All options">
                            <option value="">{sub ? 'Clear choice' : 'More options…'}</option>
                            {candidates.map((candidate) => (
                              <option key={candidate.teacher.id} value={candidate.teacher.id}>
                                {candidate.teacher.name} · {candidate.reasons.join(', ')}
                              </option>
                            ))}
                            {chosen && !candidates.some((c) => c.teacher.id === chosen) && <option value={chosen}>{names[chosen]}</option>}
                            <option value={FREE}>Nobody: leave as a free period</option>
                          </select>
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
                <h2>Notice for the staff room</h2>
                <div className="action-row compact">
                  <a className="secondary small" href={`https://wa.me/?text=${encodeURIComponent(notice)}`} target="_blank" rel="noreferrer">
                    Share on WhatsApp
                  </a>
                  <button type="button" className="secondary small" onClick={copyNotice}>
                    {copied ? 'Copied ✓' : 'Copy'}
                  </button>
                </div>
              </div>
              <pre className="notice">{notice}</pre>
              {covering.length > 0 && (
                <div className="chip-row">
                  <span className="chip-label">Tell each substitute:</span>
                  {covering.map((teacherId) => {
                    const teacher = teachers.find((item) => item.id === teacherId);
                    const mine = subsToday
                      .filter((item) => item.substituteTeacherId === teacherId)
                      .map((item) => sessions.find((s) => s.id === item.sessionId))
                      .filter(Boolean) as ScheduledSession[];
                    const text = `Hello ${teacher?.name}, please cover on ${formatDateKey(date)}:\n${mine
                      .map((s) => `${s.slot.split('-')[0]} ${names[s.subject_id]} · ${names[s.division_id]}${s.batch ? ` ${s.batch}` : ''} · ${names[s.room_id]}`)
                      .join('\n')}`;
                    return teacher?.phone ? (
                      <a key={teacherId} className="chip link-chip" href={whatsappLink(teacher.phone, text)} target="_blank" rel="noreferrer">
                        WhatsApp {teacher.name}
                      </a>
                    ) : teacher?.email ? (
                      <a
                        key={teacherId}
                        className="chip link-chip"
                        href={`mailto:${teacher.email}?subject=${encodeURIComponent(`Substitution on ${formatDateKey(date)}`)}&body=${encodeURIComponent(text)}`}
                      >
                        E-mail {teacher.name}
                      </a>
                    ) : (
                      <span key={teacherId} className="chip muted" title="Add a phone or e-mail in their profile">
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

      <div className="split-panels">
        <section className="panel">
          <h2>Coming up</h2>
          {leave.length === 0 ? (
            <p className="muted">No leave recorded from today on.</p>
          ) : (
            <ul className="leave-list">
              {leave.map((row) => (
                <li key={row.teacherId}>
                  <span>
                    <strong>{row.name}</strong>
                    <small className="muted">
                      {row.dates.length === 1 ? shortDate(row.dates[0]) : `${shortDate(row.dates[0])} – ${shortDate(row.dates[row.dates.length - 1])}`}
                      {row.dates.length > 1 ? ` · ${row.dates.length} days` : ''}
                      {row.reason ? ` · ${row.reason}` : ''}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="ghost small"
                    onClick={() => onChange(row.dates.reduce((ops, day) => setAbsent(ops, day, row.teacherId, false), operations))}
                  >
                    Cancel leave
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <h2>Cover shared so far</h2>
          <p className="muted small">Periods covered in the last 30 days. Suggestions favour those who did fewer.</p>
          {leaderboard.length === 0 ? (
            <p className="muted">Nobody has covered yet.</p>
          ) : (
            <div className="usage-list">
              {leaderboard.map(({ teacher, count }) => (
                <div key={teacher.id} className="usage-row">
                  <span>{teacher.name}</span>
                  <div className="bar">
                    <div style={{ width: `${(count / leaderboard[0].count) * 100}%` }} />
                  </div>
                  <span className="num">{count}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
