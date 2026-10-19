import { useState } from 'react';
import type { DivisionForm, RoomForm, SubjectForm, TeacherForm } from '../types';
import { createId, hasExpertise, subjectDivisions } from '../utils';

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

/** Teachers whose expertise covers the subject are listed first and starred. */
function TeacherSelect({
  teachers,
  value,
  placeholder,
  subjectName = '',
  onChange,
}: {
  teachers: TeacherForm[];
  value: string;
  placeholder: string;
  subjectName?: string;
  onChange: (id: string) => void;
}) {
  const experts = subjectName ? teachers.filter((teacher) => hasExpertise(teacher, subjectName)) : [];
  const others = teachers.filter((teacher) => !experts.includes(teacher));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} title="Teacher">
      <option value="">{placeholder}</option>
      {experts.length > 0 && (
        <optgroup label="Expertise matches">
          {experts.map((teacher) => (
            <option key={teacher.id} value={teacher.id}>
              ★ {teacher.name}
            </option>
          ))}
        </optgroup>
      )}
      {experts.length > 0 ? (
        <optgroup label="Everyone else">
          {others.map((teacher) => (
            <option key={teacher.id} value={teacher.id}>
              {teacher.name}
            </option>
          ))}
        </optgroup>
      ) : (
        others.map((teacher) => (
          <option key={teacher.id} value={teacher.id}>
            {teacher.name}
          </option>
        ))
      )}
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
  const [code, setCode] = useState('');
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
      durationSlots: duration,
      sessionsPerWeek,
      teacherId,
      roomId,
      divisionIds: [],
      teacherOverrides: {},
      difficult: false,
      ...(code.trim() && { code: code.trim() }),
    });
    setName('');
    setCode('');
  };

  const toggleDivision = (subject: SubjectForm, divisionId: string) => {
    const current = subject.divisionIds?.length ? subject.divisionIds : divisions.map((item) => item.id);
    const next = current.includes(divisionId) ? current.filter((id) => id !== divisionId) : [...current, divisionId];
    // Selecting every division is the same as "all", which also covers divisions added later.
    onUpdateSubject({ ...subject, divisionIds: next.length === divisions.length ? [] : next });
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Step 5 · Subjects</p>
          <h1>Who teaches what, to whom?</h1>
          <p>
            Each subject: its teacher, which classes take it, how often, and where. Labs run once per lab batch; leave the
            room on “auto” to let TimeFlex pick one that fits.
          </p>
        </div>
      </header>

      {warnings.length > 0 && (
        <ul className="draft-warnings">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      <section className="panel">
      <h2>Add a subject</h2>
      <div className="inline-form">
        <label className="grow">
          Name
          <input type="text" placeholder="e.g. Operating Systems" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="mini">
          Code
          <input type="text" placeholder="CS302" value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <label className="mini">
          Kind
          <select value={isLab ? 'lab' : 'lecture'} onChange={(e) => setIsLab(e.target.value === 'lab')}>
            <option value="lecture">Lecture</option>
            <option value="lab">Lab</option>
          </select>
        </label>
        <label className="mini">
          Slots each
          <input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} min={1} />
        </label>
        <label className="mini">
          Per week
          <input type="number" value={sessionsPerWeek} onChange={(e) => setSessionsPerWeek(Number(e.target.value))} min={1} />
        </label>
        <label className="mini wide">
          Teacher
          <TeacherSelect teachers={teachers} value={teacherId} placeholder="Select teacher" subjectName={name} onChange={setTeacherId} />
        </label>
        <label className="mini wide">
          Room
          <RoomSelect rooms={rooms} value={roomId} isLab={isLab} onChange={setRoomId} />
        </label>
        <button type="button" className="primary" onClick={handleAdd} disabled={!name.trim()}>
          Add
        </button>
      </div>
      </section>
      {subjects.length === 0 && <div className="empty">No subjects yet.</div>}

      <div className="list">
        {subjects.map((subject) => {
          const taughtTo = subjectDivisions(subject, divisions);
          const missingTeacher = taughtTo.some((division) => !(subject.teacherOverrides?.[division.id] || subject.teacherId));
          const overrides = Object.entries(subject.teacherOverrides ?? {}).filter(([, id]) => id).length;
          return (
            <div key={subject.id} className={`list-item stacked ${missingTeacher ? 'needs-attention' : ''}`}>
              <div className="list-row">
                <div className="list-content">
                  <strong>
                    {subject.code && <span className="code">{subject.code}</span>}
                    {subject.name}
                    {subject.isLab && <span className="tag lab">lab</span>}
                    {subject.difficult && <span className="tag">heavy</span>}
                  </strong>
                  <span>
                    {subject.isLab ? 'Lab' : 'Lecture'} · {subject.sessionsPerWeek}/week × {subject.durationSlots} slot(s)
                    {subject.isLab ? ' · per batch' : ''}
                    {overrides ? ` · ${overrides} class-specific teacher(s)` : ''}
                  </span>
                </div>
                <div className="inline-fields">
                  <TeacherSelect
                    teachers={teachers}
                    subjectName={subject.name}
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
                  <label className="mini">
                    Code
                    <input type="text" value={subject.code ?? ''} onChange={(e) => onUpdateSubject({ ...subject, code: e.target.value })} />
                  </label>
                  <label className="check" title="Heavy subjects are spread so a class does not get several on one day">
                    <input
                      type="checkbox"
                      checked={Boolean(subject.difficult)}
                      onChange={(e) => onUpdateSubject({ ...subject, difficult: e.target.checked })}
                    />
                    Heavy
                  </label>
                  <button type="button" className="ghost small danger-text" onClick={() => onRemoveSubject(subject.id)}>
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
                      onClick={() => setExpanded(expanded === subject.id ? null : subject.id)}
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
                        subjectName={subject.name}
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
    </div>
  );
}
