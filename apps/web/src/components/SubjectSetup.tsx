import { useState } from 'react';
import type { DivisionForm, RoomForm, SubjectForm, TeacherForm } from '../types';
import { createId, subjectDivisions } from '../utils';

interface SubjectSetupProps {
  subjects: SubjectForm[];
  teachers: TeacherForm[];
  rooms: RoomForm[];
  divisions: DivisionForm[];
  warnings: string[];
  onAddSubject: (subject: SubjectForm) => void;
  onUpdateSubject: (subject: SubjectForm) => void;
  onRemoveSubject: (id: string) => void;
}

const AUTO_ROOM = '';

function RoomSelect({ rooms, value, isLab, onChange }: { rooms: RoomForm[]; value: string; isLab: boolean; onChange: (id: string) => void }) {
  const suitable = rooms.filter((room) => (room.type === 'lab') === isLab);
  const other = rooms.filter((room) => (room.type === 'lab') !== isLab);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} title="Room">
      <option value={AUTO_ROOM}>Any free {isLab ? 'lab' : 'classroom'} (auto)</option>
      {suitable.map((room) => (
        <option key={room.id} value={room.id}>
          {room.name} · {room.capacity} seats
        </option>
      ))}
      {other.length > 0 && (
        <optgroup label={isLab ? 'Not labs' : 'Labs'}>
          {other.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name} · {room.capacity} seats
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

function TeacherSelect({
  teachers,
  value,
  placeholder,
  onChange,
}: {
  teachers: TeacherForm[];
  value: string;
  placeholder: string;
  onChange: (id: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} title="Teacher">
      <option value="">{placeholder}</option>
      {teachers.map((teacher) => (
        <option key={teacher.id} value={teacher.id}>
          {teacher.name}
        </option>
      ))}
    </select>
  );
}

export function SubjectSetup({
  subjects,
  teachers,
  rooms,
  divisions,
  warnings,
  onAddSubject,
  onUpdateSubject,
  onRemoveSubject,
}: SubjectSetupProps) {
  const [name, setName] = useState('');
  const [isLab, setIsLab] = useState(false);
  const [duration, setDuration] = useState(1);
  const [sessionsPerWeek, setSessionsPerWeek] = useState(3);
  const [teacherId, setTeacherId] = useState('');
  const [roomId, setRoomId] = useState(AUTO_ROOM);
  const [expanded, setExpanded] = useState<string | null>(null);

  const handleAdd = () => {
    if (!name.trim()) return;
    onAddSubject({
      id: createId(),
      name: name.trim(),
      isLab,
      durationSlots: Math.max(1, Math.round(duration) || 1),
      sessionsPerWeek: Math.max(1, Math.round(sessionsPerWeek) || 1),
      teacherId,
      roomId,
      divisionIds: [],
      teacherOverrides: {},
      difficult: false,
    });
    setName('');
  };

  const toggleDivision = (subject: SubjectForm, divisionId: string) => {
    const current = subject.divisionIds?.length ? subject.divisionIds : divisions.map((item) => item.id);
    const next = current.includes(divisionId) ? current.filter((id) => id !== divisionId) : [...current, divisionId];
    // An empty list means "all divisions", so the last selected division cannot be removed.
    if (next.length === 0) return;
    // Selecting every division is the same as "all", which also covers divisions added later.
    onUpdateSubject({ ...subject, divisionIds: next.length === divisions.length ? [] : next });
  };

  return (
    <section className="card">
      <header>
        <h1>Subjects and assignments</h1>
        <p>
          Who teaches each subject, to which classes, and where. Labs run once per lab batch; leave the room on “auto” to
          let the solver pick one that fits.
        </p>
      </header>

      {warnings.length > 0 && (
        <ul className="draft-warnings">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      <div className="inline-form">
        <input type="text" placeholder="Subject name" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={isLab ? 'lab' : 'lecture'} onChange={(e) => setIsLab(e.target.value === 'lab')}>
          <option value="lecture">Lecture</option>
          <option value="lab">Lab</option>
        </select>
        <label className="mini">
          Slots each
          <input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} min={1} />
        </label>
        <label className="mini">
          Per week
          <input type="number" value={sessionsPerWeek} onChange={(e) => setSessionsPerWeek(Number(e.target.value))} min={1} />
        </label>
        <TeacherSelect teachers={teachers} value={teacherId} placeholder="Select teacher" onChange={setTeacherId} />
        <RoomSelect rooms={rooms} value={roomId} isLab={isLab} onChange={setRoomId} />
        <button type="button" onClick={handleAdd}>
          Add subject
        </button>
      </div>

      <div className="list">
        {subjects.map((subject) => {
          const taughtTo = subjectDivisions(subject, divisions);
          const missingTeacher = taughtTo.some((division) => !(subject.teacherOverrides?.[division.id] || subject.teacherId));
          const overrides = Object.entries(subject.teacherOverrides ?? {}).filter(([, id]) => id).length;
          return (
            <div key={subject.id} className={`list-item stacked ${missingTeacher ? 'needs-attention' : ''}`}>
              <div className="list-row">
                <div className="list-content">
                  <input
                    key={subject.name}
                    className="name-input"
                    type="text"
                    aria-label="Subject name"
                    defaultValue={subject.name}
                    onBlur={(e) => {
                      const value = e.target.value.trim();
                      if (value && value !== subject.name) onUpdateSubject({ ...subject, name: value });
                      else e.target.value = subject.name;
                    }}
                  />
                  <span>
                    {subject.isLab ? 'Lab' : 'Lecture'} · {subject.sessionsPerWeek}/week × {subject.durationSlots} slot(s)
                    {subject.isLab ? ' · per batch' : ''}
                    {overrides ? ` · ${overrides} class-specific teacher(s)` : ''}
                  </span>
                </div>
                <div className="inline-fields">
                  <TeacherSelect
                    teachers={teachers}
                    value={subject.teacherId}
                    placeholder="Assign teacher…"
                    onChange={(id) => onUpdateSubject({ ...subject, teacherId: id })}
                  />
                  <RoomSelect
                    rooms={rooms}
                    value={subject.roomId}
                    isLab={subject.isLab}
                    onChange={(id) => onUpdateSubject({ ...subject, roomId: id })}
                  />
                  <label className="mini">
                    Per week
                    <input
                      type="number"
                      min={1}
                      value={subject.sessionsPerWeek}
                      onChange={(e) => onUpdateSubject({ ...subject, sessionsPerWeek: Math.max(1, Number(e.target.value)) })}
                    />
                  </label>
                  <label className="mini">
                    Slots
                    <input
                      type="number"
                      min={1}
                      value={subject.durationSlots}
                      onChange={(e) => onUpdateSubject({ ...subject, durationSlots: Math.max(1, Number(e.target.value)) })}
                    />
                  </label>
                  <label className="check" title="Heavy subjects are spread so a class does not get several on one day">
                    <input
                      type="checkbox"
                      checked={Boolean(subject.difficult)}
                      onChange={(e) => onUpdateSubject({ ...subject, difficult: e.target.checked })}
                    />
                    Heavy
                  </label>
                  <button type="button" className="text-danger" onClick={() => window.confirm(`Delete ${subject.name}?`) && onRemoveSubject(subject.id)}>
                    Delete
                  </button>
                </div>
              </div>

              {divisions.length > 0 && (
                <div className="chip-row compact">
                  <span className="chip-label">Taught to</span>
                  {divisions.map((division) => (
                    <button
                      key={division.id}
                      type="button"
                      className={taughtTo.includes(division) ? 'chip active' : 'chip'}
                      onClick={() => toggleDivision(subject, division.id)}
                    >
                      {division.name}
                    </button>
                  ))}
                  {taughtTo.length > 1 && (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        // "Same teacher for all" clears the per-class overrides instead of only hiding them.
                        if (expanded === subject.id) onUpdateSubject({ ...subject, teacherOverrides: {} });
                        setExpanded(expanded === subject.id ? null : subject.id);
                      }}
                    >
                      {expanded === subject.id ? 'Same teacher for all' : 'Different teacher per class…'}
                    </button>
                  )}
                </div>
              )}

              {expanded === subject.id && (
                <div className="override-grid">
                  {taughtTo.map((division) => (
                    <label key={division.id}>
                      {division.name}
                      <TeacherSelect
                        teachers={teachers}
                        value={subject.teacherOverrides?.[division.id] ?? ''}
                        placeholder={`Same as subject (${teachers.find((t) => t.id === subject.teacherId)?.name ?? 'unassigned'})`}
                        onChange={(id) =>
                          onUpdateSubject({
                            ...subject,
                            teacherOverrides: { ...(subject.teacherOverrides ?? {}), [division.id]: id },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
