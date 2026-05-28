import { useState } from 'react';
import type { SubjectForm, TeacherForm, RoomForm } from '../types';
import { createId } from '../utils';

interface SubjectSetupProps {
  subjects: SubjectForm[];
  teachers: TeacherForm[];
  rooms: RoomForm[];
  onAddSubject: (subject: SubjectForm) => void;
  onRemoveSubject: (id: string) => void;
}

export function SubjectSetup({
  subjects,
  teachers,
  rooms,
  onAddSubject,
  onRemoveSubject,
}: SubjectSetupProps) {
  const [name, setName] = useState('');
  const [isLab, setIsLab] = useState(false);
  const [duration, setDuration] = useState(1);
  const [sessionsPerWeek, setSessionsPerWeek] = useState(3);
  const [teacherId, setTeacherId] = useState('');
  const [roomId, setRoomId] = useState('');

  const handleAdd = () => {
    if (!name || !teacherId || !roomId) return;
    onAddSubject({
      id: createId(),
      name,
      isLab,
      durationSlots: duration,
      sessionsPerWeek,
      teacherId,
      roomId,
    });
    setName('');
  };

  return (
    <section className="card">
      <header>
        <h1>Subjects and assignments</h1>
        <p>Link teachers and rooms to each subject.</p>
      </header>
      <div className="inline-form">
        <input
          type="text"
          placeholder="Subject name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          value={isLab ? 'lab' : 'lecture'}
          onChange={(e) => setIsLab(e.target.value === 'lab')}
        >
          <option value="lecture">Lecture</option>
          <option value="lab">Lab</option>
        </select>
        <input
          type="number"
          placeholder="Duration slots"
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          min={1}
        />
        <input
          type="number"
          placeholder="Sessions / week"
          value={sessionsPerWeek}
          onChange={(e) => setSessionsPerWeek(Number(e.target.value))}
          min={1}
        />
        <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
          <option value="" disabled>
            Select teacher
          </option>
          {teachers.map((teacher) => (
            <option key={teacher.id} value={teacher.id}>
              {teacher.name}
            </option>
          ))}
        </select>
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="" disabled>
            Select room
          </option>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={handleAdd}>
          Add subject
        </button>
      </div>
      <div className="list">
        {subjects.map((subject) => (
          <div key={subject.id} className="list-item">
            <div className="list-content">
              <strong>{subject.name}</strong>
              <span>
                {subject.isLab ? 'Lab' : 'Lecture'} · {subject.sessionsPerWeek}/week ·{' '}
                {subject.durationSlots} slots
              </span>
            </div>
            <button
              type="button"
              className="text-danger"
              onClick={() => onRemoveSubject(subject.id)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
