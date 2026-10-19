import { useEffect, useState, type KeyboardEvent } from 'react';
import { weekAsText, whatsappLink } from '../ops';
import type { DivisionForm, ScheduledSession, SubjectForm, TeacherForm } from '../types';
import { buildGrid, subjectDivisions, teacherFor } from '../utils';
import { AvailabilityGrid } from './AvailabilityGrid';

interface TeacherProfileProps {
  teacher: TeacherForm;
  subjects: SubjectForm[];
  divisions: DivisionForm[];
  sessions: ScheduledSession[];
  days: string[];
  slots: string[];
  names: Record<string, string>;
  departmentName: string;
  onChange: (teacher: TeacherForm) => void;
  onClose: () => void;
  onRemove?: (id: string) => void;
}

export const initials = (name: string) =>
  name
    .replace(/^(prof|dr|mr|mrs|ms)\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

/** Gradient avatar colour from the name, so each person keeps the same colour. */
export const avatarHue = (name: string) => [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;

export function TeacherProfile({
  teacher,
  subjects,
  divisions,
  sessions,
  days,
  slots,
  names,
  departmentName,
  onChange,
  onClose,
  onRemove,
}: TeacherProfileProps) {
  const [tag, setTag] = useState('');
  const [tab, setTab] = useState<'profile' | 'week' | 'availability'>('profile');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = (patch: Partial<TeacherForm>) => onChange({ ...teacher, ...patch });
  const expertise = teacher.expertise ?? [];
  const addTag = (value: string) => {
    const clean = value.trim().replace(/,$/, '');
    if (clean && !expertise.some((item) => item.toLowerCase() === clean.toLowerCase())) update({ expertise: [...expertise, clean] });
    setTag('');
  };
  const onTagKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addTag(tag);
    } else if (event.key === 'Backspace' && !tag && expertise.length) {
      update({ expertise: expertise.slice(0, -1) });
    }
  };

  const assignments = subjects
    .map((subject) => ({
      subject,
      classes: subjectDivisions(subject, divisions).filter((division) => teacherFor(subject, division.id) === teacher.id),
    }))
    .filter((item) => item.classes.length);
  const suggestions = [...new Set(subjects.map((subject) => subject.name.replace(/\s+lab$/i, '')))].filter(
    (name) => !expertise.some((item) => item.toLowerCase() === name.toLowerCase()),
  );

  const mine = sessions.filter((session) => session.teacher_id === teacher.id);
  const periods = mine.reduce((sum, session) => sum + session.duration_slots, 0);
  const grid = buildGrid(days, slots, mine);
  const mentorOf = divisions.filter((division) => division.classTeacherId === teacher.id).map((division) => division.name);
  const codes = Object.fromEntries(subjects.map((subject) => [subject.id, subject.code || subject.name]));
  const text = mine.length ? weekAsText({ title: teacher.name, sessions: mine, days, slots, names, perspective: 'teacher' }) : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked.
    }
  };

  return (
    <div className="drawer-layer" role="dialog" aria-modal="true" aria-label={`${teacher.name} profile`}>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer glass">
        <header className="profile-hero" style={{ ['--hue' as string]: avatarHue(teacher.name) }}>
          <button type="button" className="icon-button close" onClick={onClose} aria-label="Close profile">
            ×
          </button>
          <div className="avatar xl">{initials(teacher.name)}</div>
          <div className="profile-title">
            <input
              className="name-input"
              value={teacher.name}
              aria-label="Name"
              onChange={(e) => update({ name: e.target.value })}
            />
            <span>
              {[teacher.designation || 'Teacher', departmentName].filter(Boolean).join(' · ')}
            </span>
            <div className="chip-row compact">
              <span className="pill">{periods} periods / week</span>
              {mentorOf.length > 0 && <span className="pill ok">Class teacher · {mentorOf.join(', ')}</span>}
              {teacher.canTeachLabs === false && <span className="pill">No labs</span>}
            </div>
          </div>
        </header>

        <div className="segmented wide drawer-tabs">
          {(['profile', 'week', 'availability'] as const).map((item) => (
            <button key={item} type="button" className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>
              {item === 'profile' ? 'Profile' : item === 'week' ? 'Week' : 'Availability'}
            </button>
          ))}
        </div>

        <div className="drawer-body">
          {tab === 'profile' && (
            <>
              <section>
                <h3>Expertise</h3>
                <p className="muted small">What they can teach. Used to suggest the right teacher for each subject.</p>
                <div className="tag-input">
                  {expertise.map((item) => (
                    <span key={item} className="chip active">
                      {item}
                      <button
                        type="button"
                        aria-label={`Remove ${item}`}
                        onClick={() => update({ expertise: expertise.filter((value) => value !== item) })}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    value={tag}
                    placeholder={expertise.length ? 'Add more…' : 'e.g. Databases, Machine Learning'}
                    onChange={(e) => setTag(e.target.value)}
                    onKeyDown={onTagKey}
                    onBlur={() => tag && addTag(tag)}
                  />
                </div>
                {suggestions.length > 0 && (
                  <div className="chip-row compact">
                    <span className="chip-label">Suggest:</span>
                    {suggestions.slice(0, 6).map((item) => (
                      <button key={item} type="button" className="chip" onClick={() => addTag(item)}>
                        + {item}
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3>Teaches</h3>
                {assignments.length === 0 ? (
                  <p className="muted small">Nothing assigned yet. Assign subjects in the Subjects step.</p>
                ) : (
                  <ul className="assign-list">
                    {assignments.map(({ subject, classes }) => (
                      <li key={subject.id}>
                        <span>
                          {subject.code && <span className="code">{subject.code}</span>}
                          {subject.name}
                          {subject.isLab && <span className="tag lab">lab</span>}
                        </span>
                        <span className="muted small">{classes.map((division) => division.name).join(', ')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3>About</h3>
                <div className="form-grid tight">
                  <label className="mini">
                    Designation
                    <input
                      value={teacher.designation ?? ''}
                      placeholder="e.g. Assistant Professor"
                      onChange={(e) => update({ designation: e.target.value })}
                    />
                  </label>
                  <label className="mini">
                    Qualification
                    <input
                      value={teacher.qualification ?? ''}
                      placeholder="e.g. M.Tech, PhD"
                      onChange={(e) => update({ qualification: e.target.value })}
                    />
                  </label>
                  <label className="mini">
                    Experience (years)
                    <input
                      type="number"
                      min={0}
                      value={teacher.experienceYears ?? ''}
                      onChange={(e) => update({ experienceYears: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
                    />
                  </label>
                  <label className="mini">
                    Employee ID
                    <input value={teacher.employeeId ?? ''} onChange={(e) => update({ employeeId: e.target.value })} />
                  </label>
                </div>
                <label className="mini full">
                  Short bio
                  <textarea
                    rows={3}
                    value={teacher.bio ?? ''}
                    placeholder="Research interests, courses they enjoy, anything students should know."
                    onChange={(e) => update({ bio: e.target.value })}
                  />
                </label>
              </section>

              <section>
                <h3>Contact</h3>
                <div className="form-grid tight">
                  <label className="mini">
                    E-mail
                    <input type="email" value={teacher.email ?? ''} onChange={(e) => update({ email: e.target.value })} />
                  </label>
                  <label className="mini">
                    Phone / WhatsApp
                    <input type="tel" value={teacher.phone ?? ''} onChange={(e) => update({ phone: e.target.value })} />
                  </label>
                </div>
              </section>

              <section>
                <h3>Teaching limits</h3>
                <div className="inline-fields">
                  <label className="mini">
                    Max / day
                    <input
                      type="number"
                      min={1}
                      value={teacher.maxLecturesPerDay}
                      onChange={(e) => update({ maxLecturesPerDay: Math.max(1, Number(e.target.value)) })}
                    />
                  </label>
                  <label className="mini">
                    Max / week
                    <input
                      type="number"
                      min={1}
                      value={teacher.maxLecturesPerWeek}
                      onChange={(e) => update({ maxLecturesPerWeek: Math.max(1, Number(e.target.value)) })}
                    />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={teacher.canTeachLabs !== false}
                      onChange={(e) => update({ canTeachLabs: e.target.checked })}
                    />
                    Handles labs
                  </label>
                </div>
              </section>
            </>
          )}

          {tab === 'week' && (
            <section>
              {mine.length === 0 ? (
                <p className="muted">No timetable yet. Generate one and this teacher’s week appears here.</p>
              ) : (
                <>
                  <div className="mini-timetable" style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))` }}>
                    <span />
                    {days.map((day) => (
                      <strong key={day}>{day.slice(0, 3)}</strong>
                    ))}
                    {slots.map((slot) => (
                      <div key={slot} className="mini-row">
                        <small>{slot.split('-')[0]}</small>
                        {days.map((day) => {
                          const here = grid[day]?.[slot] ?? [];
                          const session = here[0];
                          return (
                            <span key={day} className={session ? (session.kind === 'lab' ? 'cell lab' : 'cell on') : 'cell'}>
                              {session && session.slot === slot && (
                                <>
                                  {codes[session.subject_id]}
                                  <em>
                                    {names[session.division_id]}
                                    {session.batch ? ` ${session.batch}` : ''}
                                  </em>
                                </>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  <div className="person-actions">
                    <span className="small">Send this week:</span>
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
                    <button type="button" className="chip" onClick={copy}>
                      {copied ? 'Copied ✓' : 'Copy'}
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {tab === 'availability' && (
            <section>
              <p className="muted small">When they cannot teach, and when they would rather teach.</p>
              <AvailabilityGrid
                days={days}
                slots={slots}
                withPreference
                value={{
                  unavailableDays: teacher.unavailableDays ?? [],
                  unavailableSlots: teacher.unavailableSlots ?? [],
                  preferredSlots: teacher.preferredSlots ?? [],
                }}
                onChange={(value) => update(value)}
              />
            </section>
          )}
        </div>

        {onRemove && (
          <footer className="drawer-foot">
            <button type="button" className="ghost small danger-text" onClick={() => onRemove(teacher.id)}>
              Remove teacher
            </button>
            <button type="button" className="primary" onClick={onClose}>
              Done
            </button>
          </footer>
        )}
      </aside>
    </div>
  );
}
