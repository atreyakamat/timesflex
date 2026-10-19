import { useEffect, useState } from 'react';
import type { Page } from '../App';
import {
  attendanceSummary,
  findAttendance,
  saveAttendance,
  sessionsOnDay,
  studentsFor,
  weekdayOf,
} from '../ops';
import type { DivisionForm, OperationsData, RoomForm, ScheduledSession, SubjectForm, TeacherForm } from '../types';
import { DateNav, nearestWorkingDay } from './DateNav';

interface AttendanceProps {
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
  onGo: (page: Page) => void;
}

export function Attendance({ days, slots, divisions, subjects, names, sessions, operations, onChange, onGo }: AttendanceProps) {
  const [tab, setTab] = useState<'take' | 'report'>('take');
  const [date, setDate] = useState(() => nearestWorkingDay(days));
  const firstWithList = divisions.find((item) => item.students?.length) ?? divisions[0];
  const [divisionId, setDivisionId] = useState(firstWithList?.id ?? '');
  const [sessionId, setSessionId] = useState('');
  const [absentees, setAbsentees] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState('');
  const [threshold, setThreshold] = useState(75);
  const [copied, setCopied] = useState(false);

  const division = divisions.find((item) => item.id === divisionId);
  const weekday = weekdayOf(date);
  const classSessions = sessionsOnDay(sessions, weekday, slots).filter((item) => item.division_id === divisionId);
  const session = classSessions.find((item) => item.id === sessionId);
  const students = studentsFor(division, session?.batch);

  // Pick the first period of the class, and load what was already taken for it.
  useEffect(() => {
    if (!classSessions.some((item) => item.id === sessionId)) setSessionId(classSessions[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [divisionId, date, sessions]);
  useEffect(() => {
    setAbsentees(findAttendance(operations.attendance, date, sessionId)?.absentStudentIds ?? []);
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, date]);

  const toggle = (id: string) => {
    setSaved(false);
    setAbsentees((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));
  };

  const save = () => {
    if (!session) return;
    onChange(saveAttendance(operations, { date, session, absentStudentIds: absentees }));
    setSaved(true);
    // Move on to the next period that has not been taken yet.
    const next = classSessions.find((item) => item.id !== session.id && !findAttendance(operations.attendance, date, item.id));
    if (next) setTimeout(() => setSessionId(next.id), 500);
  };

  const summary = division ? attendanceSummary(division, operations.attendance, subjectFilter || undefined) : [];
  const defaulters = summary.filter((row) => row.percent !== null && row.percent < threshold);
  const takenCount = new Set(
    operations.attendance.filter((item) => item.divisionId === divisionId).map((item) => `${item.date}|${item.sessionId}`),
  ).size;

  const copyDefaulters = async () => {
    const text = `${division?.name} · below ${threshold}%${subjectFilter ? ` in ${names[subjectFilter]}` : ''}\n${defaulters
      .map((row) => `${row.student.rollNo}  ${row.student.name}  ${row.percent}% (${row.attended}/${row.total})`)
      .join('\n')}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked.
    }
  };

  const classPicker = (
    <label className="mini wide">
      Class
      <select value={divisionId} onChange={(e) => setDivisionId(e.target.value)}>
        {divisions.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
            {item.students?.length ? ` · ${item.students.length} students` : ' · no class list'}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Run your week</p>
          <h1>Attendance</h1>
          <p>Every period in the timetable is a register. Tap the students who are absent and save.</p>
        </div>
        <div className="segmented">
          <button type="button" className={tab === 'take' ? 'active' : ''} onClick={() => setTab('take')}>
            Take
          </button>
          <button type="button" className={tab === 'report' ? 'active' : ''} onClick={() => setTab('report')}>
            Report
          </button>
        </div>
      </header>

      {!division ? (
        <div className="empty">Add a class first.</div>
      ) : !division.students?.length ? (
        <section className="panel">
          <div className="toolbar plain">{classPicker}</div>
          <div className="empty">
            {division.name} has no class list yet. Paste it once (roll no and name, straight from Excel) and every period
            becomes a register.
            <div className="action-row center">
              <button type="button" className="primary" onClick={() => onGo('classes')}>
                Add the class list
              </button>
            </div>
          </div>
        </section>
      ) : tab === 'take' ? (
        <>
          <section className="panel toolbar">
            <DateNav value={date} days={days} onChange={setDate} />
            {classPicker}
          </section>

          {!days.includes(weekday) || classSessions.length === 0 ? (
            <div className="empty">
              {division.name} has no classes on {weekday}.
            </div>
          ) : (
            <section className="panel">
              <div className="period-tabs">
                {classSessions.map((item) => {
                  const taken = findAttendance(operations.attendance, date, item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`period-tab ${item.id === sessionId ? 'active' : ''} ${taken ? 'taken' : ''}`}
                      onClick={() => setSessionId(item.id)}
                    >
                      <small>{item.slot.split('-')[0]}</small>
                      <strong>{names[item.subject_id]}</strong>
                      <span>
                        {item.batch ? `${item.batch} · ` : ''}
                        {taken ? `✓ ${taken.absentStudentIds.length} absent` : 'not taken'}
                      </span>
                    </button>
                  );
                })}
              </div>

              {session && (
                <>
                  <div className="section-head">
                    <h2>
                      {names[session.subject_id]}
                      {session.batch ? ` · batch ${session.batch}` : ''}{' '}
                      <span className="muted small">· {names[session.teacher_id]}</span>
                    </h2>
                    <span className="pill">
                      {students.length - absentees.filter((id) => students.some((s) => s.id === id)).length}/{students.length} present
                    </span>
                  </div>
                  {students.length === 0 && (
                    <p className="muted">No students are in batch {session.batch}. Assign batches in the class list.</p>
                  )}
                  <div className="register">
                    {students.map((student) => {
                      const isAbsent = absentees.includes(student.id);
                      return (
                        <button
                          key={student.id}
                          type="button"
                          className={`register-cell ${isAbsent ? 'absent' : ''}`}
                          onClick={() => toggle(student.id)}
                          aria-pressed={isAbsent}
                        >
                          <small>{student.rollNo}</small>
                          <span>{student.name || 'Unnamed'}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="action-row">
                    <button type="button" className="primary" onClick={save}>
                      {saved ? 'Saved ✓' : `Save · ${absentees.length} absent`}
                    </button>
                    <button type="button" className="secondary" onClick={() => setAbsentees([])}>
                      Everyone present
                    </button>
                    <button type="button" className="ghost" onClick={() => setAbsentees(students.map((s) => s.id))}>
                      Everyone absent
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
        </>
      ) : (
        <>
          <section className="panel toolbar">
            {classPicker}
            <label className="mini wide">
              Subject
              <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}>
                <option value="">All subjects</option>
                {subjects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="mini">
              Minimum %
              <input type="number" min={0} max={100} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
            </label>
          </section>
          <section className="panel">
            <div className="section-head">
              <h2>
                {division.name}{' '}
                <span className="muted small">
                  · {takenCount} period(s) recorded · {defaulters.length} below {threshold}%
                </span>
              </h2>
              {defaulters.length > 0 && (
                <button type="button" className="secondary small" onClick={copyDefaulters}>
                  {copied ? 'Copied ✓' : 'Copy defaulter list'}
                </button>
              )}
            </div>
            {takenCount === 0 ? (
              <p className="muted">No attendance taken for {division.name} yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Roll</th>
                      <th>Name</th>
                      <th>Batch</th>
                      <th className="num">Attended</th>
                      <th style={{ width: '30%' }}>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((row) => (
                      <tr key={row.student.id} className={row.percent !== null && row.percent < threshold ? 'flag' : ''}>
                        <td>{row.student.rollNo}</td>
                        <td>{row.student.name}</td>
                        <td>{row.student.batch ?? '-'}</td>
                        <td className="num">
                          {row.attended}/{row.total}
                        </td>
                        <td>
                          {row.percent === null ? (
                            <span className="muted">-</span>
                          ) : (
                            <div className="pct">
                              <div className="bar thin">
                                <div
                                  className={row.percent < threshold ? 'over' : ''}
                                  style={{ width: `${row.percent}%` }}
                                />
                              </div>
                              <span className="num">{row.percent}%</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
