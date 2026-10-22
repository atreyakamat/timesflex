import { useState } from 'react';
import type { DivisionForm, SubjectForm, TeacherForm } from '../types';
import { createId, subjectDivisions, teacherFor } from '../utils';
import { avatarHue, initials } from './TeacherProfile';

interface TeacherSetupProps {
  teachers: TeacherForm[];
  subjects: SubjectForm[];
  divisions: DivisionForm[];
  days: string[];
  slots: string[];
  onAddTeacher: (teacher: TeacherForm) => void;
  onUpdateTeacher: (teacher: TeacherForm) => void;
  onRemoveTeacher: (id: string) => void;
  onOpenProfile: (id: string) => void;
}

const splitTags = (value: string) => [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];

export function TeacherSetup({
  teachers,
  subjects,
  divisions,
  days,
  onAddTeacher,
  onUpdateTeacher,
  onRemoveTeacher,
  onOpenProfile,
}: TeacherSetupProps) {
  const [name, setName] = useState('');
  const [designation, setDesignation] = useState('');
  const [expertise, setExpertise] = useState('');
  const [email, setEmail] = useState('');
  const [maxPerDay, setMaxPerDay] = useState(4);
  const [maxPerWeek, setMaxPerWeek] = useState(18);
  const [openAfterAdd, setOpenAfterAdd] = useState(true);

  const handleAdd = () => {
    if (!name.trim()) return;
    const teacher: TeacherForm = {
      id: createId(),
      name: name.trim(),
      maxLecturesPerDay: maxPerDay,
      maxLecturesPerWeek: maxPerWeek,
      unavailableDays: [],
      canTeachLabs: true,
      ...(designation.trim() && { designation: designation.trim() }),
      ...(splitTags(expertise).length && { expertise: splitTags(expertise) }),
      ...(email.trim() && { email: email.trim() }),
    };
    onAddTeacher(teacher);
    setName('');
    setDesignation('');
    setExpertise('');
    setEmail('');
    if (openAfterAdd) onOpenProfile(teacher.id);
  };

  /** Subjects and classes this teacher is assigned, and the periods per week that adds up to. */
  const workload = (teacher: TeacherForm) => {
    let slotsPerWeek = 0;
    const lines: string[] = [];
    for (const subject of subjects) {
      const taught = subjectDivisions(subject, divisions).filter((division) => teacherFor(subject, division.id) === teacher.id);
      if (!taught.length) continue;
      lines.push(`${subject.name} (${taught.map((division) => division.name).join(', ')})`);
      for (const division of taught) {
        const sittings = subject.isLab && division.batches.length ? division.batches.length : 1;
        slotsPerWeek += subject.sessionsPerWeek * subject.durationSlots * sittings;
      }
    }
    return { lines, slotsPerWeek };
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Step 2 · Teachers</p>
          <h1>Who teaches here?</h1>
          <p>
            Add your teachers one by one. Each gets a profile: what they teach, their expertise, their limits and when
            they are free.
          </p>
        </div>
      </header>

      <section className="panel add-teacher">
        <h2>Add a teacher</h2>
        <div className="inline-form">
          <label className="grow">
            Name
            <input
              type="text"
              placeholder="e.g. Prof. Anita Mehta"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </label>
          <label className="grow">
            Designation
            <input
              type="text"
              placeholder="e.g. Assistant Professor"
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
            />
          </label>
          <label className="grow wide-field">
            Expertise <small className="muted">comma separated</small>
            <input
              type="text"
              placeholder="e.g. Databases, Operating Systems"
              value={expertise}
              onChange={(e) => setExpertise(e.target.value)}
            />
          </label>
        </div>
        <div className="inline-form">
          <label className="grow">
            <span>
              E-mail <small className="muted">optional, to send them their timetable</small>
            </span>
            <input type="email" placeholder="name@college.edu" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="mini">
            Max / day
            <input type="number" value={maxPerDay} onChange={(e) => setMaxPerDay(Number(e.target.value))} min={1} />
          </label>
          <label className="mini">
            Max / week
            <input type="number" value={maxPerWeek} onChange={(e) => setMaxPerWeek(Number(e.target.value))} min={1} />
          </label>
          <label className="check">
            <input type="checkbox" checked={openAfterAdd} onChange={(e) => setOpenAfterAdd(e.target.checked)} />
            Open profile after adding
          </label>
          <button type="button" className="primary" onClick={handleAdd} disabled={!name.trim()}>
            Add teacher
          </button>
        </div>
      </section>

      {teachers.length === 0 && (
        <div className="empty">No teachers yet. Add your first one above. It takes about ten seconds each.</div>
      )}

      <div className="teacher-list">
        {teachers.map((teacher) => {
          const { lines, slotsPerWeek } = workload(teacher);
          const capacity = Math.min(
            teacher.maxLecturesPerWeek,
            teacher.maxLecturesPerDay * days.filter((day) => !teacher.unavailableDays?.includes(day)).length,
          );
          const over = slotsPerWeek > capacity;
          return (
            <div key={teacher.id} className={`teacher-row ${over ? 'needs-attention' : ''}`}>
              <button type="button" className="teacher-main" onClick={() => onOpenProfile(teacher.id)}>
                <span className="avatar" style={{ ['--hue' as string]: avatarHue(teacher.name) }}>
                  {initials(teacher.name)}
                </span>
                <span className="teacher-text">
                  <strong>
                    {teacher.name}
                    {teacher.designation && <span className="tag">{teacher.designation}</span>}
                  </strong>
                  <span className="muted small">{lines.length ? lines.join(' · ') : 'No subjects assigned yet'}</span>
                  {(teacher.expertise?.length ?? 0) > 0 && (
                    <span className="expertise-line">
                      {teacher.expertise!.slice(0, 4).map((item) => (
                        <span key={item} className="mini-chip">
                          {item}
                        </span>
                      ))}
                      {teacher.expertise!.length > 4 && <span className="muted small">+{teacher.expertise!.length - 4}</span>}
                    </span>
                  )}
                </span>
              </button>
              <div className="teacher-side">
                <span className="load">
                  <span className="bar thin">
                    <span className={over ? 'over' : ''} style={{ width: `${Math.min(100, capacity ? (slotsPerWeek / capacity) * 100 : 0)}%` }} />
                  </span>
                  <span className={over ? 'text-warning small' : 'muted small'}>
                    {slotsPerWeek}/{capacity} periods
                  </span>
                </span>
                <label className="check small">
                  <input
                    type="checkbox"
                    checked={teacher.canTeachLabs !== false}
                    onChange={(e) => onUpdateTeacher({ ...teacher, canTeachLabs: e.target.checked })}
                  />
                  Labs
                </label>
                <button type="button" className="secondary small" onClick={() => onOpenProfile(teacher.id)}>
                  Profile
                </button>
                <button type="button" className="ghost small danger-text" onClick={() => onRemoveTeacher(teacher.id)}>
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
