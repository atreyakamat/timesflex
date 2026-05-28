import { useState } from 'react';
import type { TeacherForm } from '../types';
import { createId } from '../utils';

interface TeacherSetupProps {
  teachers: TeacherForm[];
  onAddTeacher: (teacher: TeacherForm) => void;
  onRemoveTeacher: (id: string) => void;
}

export function TeacherSetup({ teachers, onAddTeacher, onRemoveTeacher }: TeacherSetupProps) {
  const [name, setName] = useState('');
  const [maxPerDay, setMaxPerDay] = useState(4);
  const [maxPerWeek, setMaxPerWeek] = useState(20);

  const handleAdd = () => {
    if (!name) return;
    onAddTeacher({
      id: createId(),
      name,
      maxLecturesPerDay: maxPerDay,
      maxLecturesPerWeek: maxPerWeek,
    });
    setName('');
  };

  return (
    <section className="card">
      <header>
        <h1>Teachers</h1>
        <p>Add teachers with daily and weekly limits.</p>
      </header>
      <div className="inline-form">
        <input
          type="text"
          placeholder="Teacher name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="number"
          placeholder="Max / day"
          value={maxPerDay}
          onChange={(e) => setMaxPerDay(Number(e.target.value))}
          min={1}
        />
        <input
          type="number"
          placeholder="Max / week"
          value={maxPerWeek}
          onChange={(e) => setMaxPerWeek(Number(e.target.value))}
          min={1}
        />
        <button type="button" onClick={handleAdd}>
          Add teacher
        </button>
      </div>
      <div className="list">
        {teachers.map((teacher) => (
          <div key={teacher.id} className="list-item">
            <div className="list-content">
              <strong>{teacher.name}</strong>
              <span>
                {teacher.maxLecturesPerDay}/day, {teacher.maxLecturesPerWeek}/week
              </span>
            </div>
            <button
              type="button"
              className="text-danger"
              onClick={() => onRemoveTeacher(teacher.id)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
