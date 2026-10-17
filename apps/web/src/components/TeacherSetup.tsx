import { useState } from 'react';
import type { DivisionForm, SubjectForm, TeacherForm } from '../types';
import { createId, subjectDivisions, teacherFor } from '../utils';
import { AvailabilityGrid } from './AvailabilityGrid';

interface TeacherSetupProps {
  teachers: TeacherForm[];
  subjects: SubjectForm[];
  divisions: DivisionForm[];
  days: string[];
  slots: string[];
  onAddTeacher: (teacher: TeacherForm) => void;
  onUpdateTeacher: (teacher: TeacherForm) => void;
  onRemoveTeacher: (id: string) => void;
}

export function TeacherSetup({
  teachers,
  subjects,
  divisions,
  days,
  slots,
  onAddTeacher,
  onUpdateTeacher,
  onRemoveTeacher,
}: TeacherSetupProps) {
  const [name, setName] = useState('');
  const [maxPerDay, setMaxPerDay] = useState(4);
  const [maxPerWeek, setMaxPerWeek] = useState(20);
  const [open, setOpen] = useState<string | null>(null);

  const handleAdd = () => {
    if (!name.trim()) return;
    onAddTeacher({
      id: createId(),
      name: name.trim(),
      maxLecturesPerDay: Math.max(1, Math.round(maxPerDay) || 1),
      maxLecturesPerWeek: Math.max(1, Math.round(maxPerWeek) || 1),
      unavailableDays: [],
      canTeachLabs: true,
    });
    setName('');
  };

  /** "DBMS (SE-A, SE-B) · 8 slots/week" style summary of what this teacher is assigned. */
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
    <section className="card">
      <header>
        <h1>Teachers</h1>
        <p>Set lecture limits, whether they handle labs, and when they can or prefer to teach.</p>
      </header>
      <div className="inline-form">
        <input type="text" placeholder="Teacher name" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="mini">
          Max / day
          <input type="number" value={maxPerDay} onChange={(e) => setMaxPerDay(Number(e.target.value))} min={1} />
        </label>
        <label className="mini">
          Max / week
          <input type="number" value={maxPerWeek} onChange={(e) => setMaxPerWeek(Number(e.target.value))} min={1} />
        </label>
        <button type="button" onClick={handleAdd}>
          Add teacher
        </button>
      </div>
      <div className="list">
        {teachers.map((teacher) => {
          const { lines, slotsPerWeek } = workload(teacher);
          const capacity = Math.min(
            teacher.maxLecturesPerWeek,
            teacher.maxLecturesPerDay * days.filter((day) => !teacher.unavailableDays?.includes(day)).length,
          );
          const blockedCount = (teacher.unavailableDays?.length ?? 0) + (teacher.unavailableSlots?.length ?? 0);
          const preferredCount = teacher.preferredSlots?.length ?? 0;
          return (
            <div key={teacher.id} className={`list-item stacked ${slotsPerWeek > capacity ? 'needs-attention' : ''}`}>
              <div className="list-row">
                <div className="list-content">
                  <input
                    key={teacher.name}
                    className="name-input"
                    type="text"
                    aria-label="Teacher name"
                    defaultValue={teacher.name}
                    onBlur={(e) => {
                      const value = e.target.value.trim();
                      if (value && value !== teacher.name) onUpdateTeacher({ ...teacher, name: value });
                      else e.target.value = teacher.name;
                    }}
                  />
                  <span>{lines.length ? lines.join(' · ') : 'No subjects assigned yet'}</span>
                  <span className={slotsPerWeek > capacity ? 'text-warning' : ''}>
                    {slotsPerWeek} of {capacity} slots/week used
                    {blockedCount ? ` · ${blockedCount} blocked` : ''}
                    {preferredCount ? ` · ${preferredCount} preferred` : ''}
                  </span>
                </div>
                <div className="inline-fields">
                  <label className="mini">
                    /day
                    <input
                      type="number"
                      min={1}
                      value={teacher.maxLecturesPerDay}
                      onChange={(e) => onUpdateTeacher({ ...teacher, maxLecturesPerDay: Math.max(1, Number(e.target.value)) })}
                    />
                  </label>
                  <label className="mini">
                    /week
                    <input
                      type="number"
                      min={1}
                      value={teacher.maxLecturesPerWeek}
                      onChange={(e) => onUpdateTeacher({ ...teacher, maxLecturesPerWeek: Math.max(1, Number(e.target.value)) })}
                    />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={teacher.canTeachLabs !== false}
                      onChange={(e) => onUpdateTeacher({ ...teacher, canTeachLabs: e.target.checked })}
                    />
                    Handles labs
                  </label>
                  <button type="button" className="secondary small" onClick={() => setOpen(open === teacher.id ? null : teacher.id)}>
                    {open === teacher.id ? 'Hide availability' : 'Availability'}
                  </button>
                  <button type="button" className="text-danger" onClick={() => window.confirm(`Delete ${teacher.name}?`) && onRemoveTeacher(teacher.id)}>
                    Delete
                  </button>
                </div>
              </div>
              {open === teacher.id && (
                <AvailabilityGrid
                  days={days}
                  slots={slots}
                  withPreference
                  value={{
                    unavailableDays: teacher.unavailableDays ?? [],
                    unavailableSlots: teacher.unavailableSlots ?? [],
                    preferredSlots: teacher.preferredSlots ?? [],
                  }}
                  onChange={(value) => onUpdateTeacher({ ...teacher, ...value })}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
