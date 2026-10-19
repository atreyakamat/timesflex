import { useState } from 'react';
import type { Page } from '../App';
import { attendanceSummary, weekAsText, whatsappLink } from '../ops';
import type { DivisionForm, OperationsData, RoomForm, ScheduledSession, SubjectForm, TeacherForm } from '../types';
import { divisionSize, subjectDivisions, teacherFor } from '../utils';
import { RosterEditor } from './RosterEditor';
import { avatarHue, initials } from './TeacherProfile';

interface PeopleProps {
  days: string[];
  slots: string[];
  divisions: DivisionForm[];
  teachers: TeacherForm[];
  rooms: RoomForm[];
  subjects: SubjectForm[];
  names: Record<string, string>;
  sessions: ScheduledSession[];
  operations: OperationsData;
  onUpdateTeacher: (teacher: TeacherForm) => void;
  onUpdateDivision: (division: DivisionForm) => void;
  onOpenProfile: (id: string) => void;
  onGo: (page: Page) => void;
}

export function People({
  days,
  slots,
  divisions,
  teachers,
  subjects,
  names,
  sessions,
  operations,
  onUpdateDivision,
  onOpenProfile,
  onGo,
}: PeopleProps) {
  const [tab, setTab] = useState<'staff' | 'students'>('staff');
  const [divisionId, setDivisionId] = useState(divisions[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const division = divisions.find((item) => item.id === divisionId);
  const students = divisions.reduce((sum, item) => sum + divisionSize(item), 0);
  const listed = divisions.reduce((sum, item) => sum + (item.students?.length ?? 0), 0);

  const teaching = (teacher: TeacherForm) =>
    subjects
      .map((subject) => {
        const classes = subjectDivisions(subject, divisions).filter((item) => teacherFor(subject, item.id) === teacher.id);
        return classes.length ? `${subject.name} (${classes.map((item) => item.name).join(', ')})` : null;
      })
      .filter(Boolean)
      .join(' · ');

  const timetableText = (teacher: TeacherForm) =>
    weekAsText({
      title: teacher.name,
      sessions: sessions.filter((item) => item.teacher_id === teacher.id),
      days,
      slots,
      names,
      perspective: 'teacher',
    });

  const copy = async (teacher: TeacherForm) => {
    try {
      await navigator.clipboard.writeText(timetableText(teacher));
      setCopied(teacher.id);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // Clipboard can be blocked.
    }
  };

  const shownTeachers = query
    ? teachers.filter((t) => `${t.name} ${t.designation ?? ''} ${t.email ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    : teachers;

  const summary = division ? attendanceSummary(division, operations.attendance) : [];
  const percentById = Object.fromEntries(
    summary.filter((row) => row.percent !== null).map((row) => [row.student.id, `${row.percent}%`]),
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Directory</p>
          <h1>People</h1>
          <p>
            Everyone you added for the timetable, in one place: {teachers.length} teachers and {students} students
            {listed < students ? ` (${listed} with names)` : ''}.
          </p>
        </div>
        <div className="segmented">
          <button type="button" className={tab === 'staff' ? 'active' : ''} onClick={() => setTab('staff')}>
            Staff
          </button>
          <button type="button" className={tab === 'students' ? 'active' : ''} onClick={() => setTab('students')}>
            Students
          </button>
        </div>
      </header>

      {tab === 'staff' ? (
        <>
          {teachers.length > 5 && (
            <section className="panel toolbar">
              <input type="search" placeholder="Search staff" value={query} onChange={(e) => setQuery(e.target.value)} />
            </section>
          )}
          {teachers.length === 0 && (
            <div className="empty">
              No teachers yet.{' '}
              <button type="button" className="link-button" onClick={() => onGo('teachers')}>
                Add them in the Teachers step
              </button>
            </div>
          )}
          <div className="people-grid">
            {shownTeachers.map((teacher) => {
              const mine = sessions.filter((item) => item.teacher_id === teacher.id);
              const periods = mine.reduce((sum, item) => sum + item.duration_slots, 0);
              const mentorOf = divisions.filter((item) => item.classTeacherId === teacher.id).map((item) => item.name);
              const text = mine.length ? timetableText(teacher) : '';
              return (
                <div key={teacher.id} className="person-card">
                  <button type="button" className="person-head" onClick={() => onOpenProfile(teacher.id)}>
                    <div className="avatar" style={{ ['--hue' as string]: avatarHue(teacher.name) }}>
                      {initials(teacher.name)}
                    </div>
                    <div>
                      <strong>{teacher.name}</strong>
                      <span className="muted small">
                        {[teacher.designation, mentorOf.length ? `Class teacher, ${mentorOf.join(', ')}` : '']
                          .filter(Boolean)
                          .join(' · ') || 'Teacher'}
                      </span>
                    </div>
                    <span className="pill">{periods} periods/wk</span>
                  </button>
                  <p className="muted small">{teaching(teacher) || 'No subjects assigned yet'}</p>
                  {(teacher.expertise?.length ?? 0) > 0 && (
                    <div className="expertise-line">
                      {teacher.expertise!.map((item) => (
                        <span key={item} className="mini-chip">
                          {item}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="contact-line small">
                    <span className={teacher.email ? '' : 'muted'}>✉ {teacher.email || 'No e-mail'}</span>
                    <span className={teacher.phone ? '' : 'muted'}>☏ {teacher.phone || 'No phone'}</span>
                    {teacher.qualification && <span>🎓 {teacher.qualification}</span>}
                  </div>
                  <div className="person-actions">
                    {mine.length === 0 ? (
                      <span className="muted small">Generate the timetable to share it.</span>
                    ) : (
                      <>
                        <span className="small">Send their timetable:</span>
                        {teacher.phone && (
                          <a className="chip link-chip" href={whatsappLink(teacher.phone, text)} target="_blank" rel="noreferrer">
                            WhatsApp
                          </a>
                        )}
                        {teacher.email && (
                          <a
                            className="chip link-chip"
                            href={`mailto:${teacher.email}?subject=${encodeURIComponent('Your timetable')}&body=${encodeURIComponent(text)}`}
                          >
                            E-mail
                          </a>
                        )}
                        <button type="button" className="chip" onClick={() => copy(teacher)}>
                          {copied === teacher.id ? 'Copied ✓' : 'Copy'}
                        </button>
                      </>
                    )}
                    <button type="button" className="link-button push" onClick={() => onOpenProfile(teacher.id)}>
                      View profile →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <section className="panel toolbar">
            <label className="mini wide">
              Class
              <select value={divisionId} onChange={(e) => setDivisionId(e.target.value)}>
                {divisions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.students?.length ? `${item.students.length} listed` : 'no list'}
                  </option>
                ))}
              </select>
            </label>
            {division?.classTeacherId && (
              <span className="muted small">Class teacher: {names[division.classTeacherId]}</span>
            )}
          </section>
          {division ? (
            <section className="panel">
              <RosterEditor
                key={division.id}
                division={division}
                onChange={onUpdateDivision}
                extra={Object.keys(percentById).length ? { label: 'Attendance', values: percentById } : undefined}
              />
            </section>
          ) : (
            <div className="empty">Add a class first.</div>
          )}
        </>
      )}
    </div>
  );
}
