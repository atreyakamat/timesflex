import { useState } from 'react';
import { splitIntoBatches } from '../ops';
import type { DepartmentForm, DivisionForm, TeacherForm } from '../types';
import { createId, divisionSize, groupSize } from '../utils';
import { RosterEditor } from './RosterEditor';

interface AcademicStructureProps {
  department: DepartmentForm;
  onDepartmentUpdate: (department: DepartmentForm) => void;
  divisions: DivisionForm[];
  teachers: TeacherForm[];
  onAddDivision: (division: DivisionForm) => void;
  onUpdateDivision: (division: DivisionForm) => void;
  onRemoveDivision: (id: string) => void;
}

const splitList = (value: string) => [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];

export function AcademicStructure({
  department,
  onDepartmentUpdate,
  divisions,
  teachers,
  onAddDivision,
  onUpdateDivision,
  onRemoveDivision,
}: AcademicStructureProps) {
  const defaultYear = [department.yearLabel, department.semesterLabel].filter(Boolean).join(' · ');
  const [name, setName] = useState('');
  const [batches, setBatches] = useState('');
  const [size, setSize] = useState(60);
  const [yearLabel, setYearLabel] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const handleDepartmentChange = (field: keyof DepartmentForm, value: string) => {
    onDepartmentUpdate({ ...department, [field]: value });
  };

  const handleAdd = () => {
    if (!name.trim()) return;
    onAddDivision({
      id: createId(),
      name: name.trim(),
      batches: splitList(batches),
      size,
      yearLabel: yearLabel.trim() || defaultYear,
    });
    setName('');
    setBatches('');
  };

  /** Changing batches re-splits a class list so every student stays in an existing batch. */
  const setBatchList = (division: DivisionForm, list: string[]) => {
    const students = division.students?.length ? splitIntoBatches(division.students, list) : division.students;
    onUpdateDivision({ ...division, batches: list, students });
  };

  // Department -> Year / semester -> Division -> Batch.
  const years = [...new Set(divisions.map((division) => division.yearLabel || defaultYear))];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Step 3 · Classes</p>
          <h1>Which classes need a timetable?</h1>
          <p>Each division gets its own timetable. Lab batches let practicals run in parallel.</p>
        </div>
      </header>

      <section className="panel">
        <div className="form-grid">
          <label>
            Department
            <input type="text" value={department.name} onChange={(event) => handleDepartmentChange('name', event.target.value)} />
          </label>
          <label>
            Year
            <input type="text" value={department.yearLabel} onChange={(event) => handleDepartmentChange('yearLabel', event.target.value)} />
          </label>
          <label>
            Semester
            <input
              type="text"
              value={department.semesterLabel}
              onChange={(event) => handleDepartmentChange('semesterLabel', event.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="panel">
        <h2>Add a division</h2>
        <div className="inline-form">
          <label className="grow">
            Name
            <input type="text" placeholder="e.g. SE-A" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="grow">
            Lab batches
            <input type="text" placeholder="e.g. A1, A2" value={batches} onChange={(e) => setBatches(e.target.value)} />
          </label>
          <label className="mini">
            Students
            <input type="number" min={0} value={size} onChange={(e) => setSize(Number(e.target.value))} />
          </label>
          <label className="grow">
            Year / semester
            <input type="text" placeholder={defaultYear || 'optional'} value={yearLabel} onChange={(e) => setYearLabel(e.target.value)} />
          </label>
          <button type="button" className="primary" onClick={handleAdd} disabled={!name.trim()}>
            Add
          </button>
        </div>
      </section>

      {divisions.length === 0 && <div className="empty">No classes yet. Add your first division above.</div>}

      {years.map((year) => (
        <section key={year || 'none'} className="group">
          <h3 className="group-title">
            {department.name}
            {year ? ` · ${year}` : ''}
          </h3>
          <div className="list">
            {divisions
              .filter((division) => (division.yearLabel || defaultYear) === year)
              .map((division) => {
                const hasList = Boolean(division.students?.length);
                const batchSize = division.batches.length ? groupSize(division, division.batches[0]) : 0;
                return (
                  <div key={division.id} className="list-item stacked">
                    <div className="list-row">
                      <div className="list-content">
                        <strong>{division.name}</strong>
                        <span>
                          {divisionSize(division) || '?'} students ·{' '}
                          {division.batches.length
                            ? `${division.batches.length} lab batches${batchSize ? ` of about ${batchSize}` : ''}`
                            : 'labs run with the whole class'}
                        </span>
                      </div>
                      <div className="inline-fields">
                        <label className="mini wide">
                          Batches
                          <input
                            key={division.batches.join(',')}
                            type="text"
                            defaultValue={division.batches.join(', ')}
                            onBlur={(e) => setBatchList(division, splitList(e.target.value))}
                          />
                        </label>
                        <label className="mini">
                          Students
                          <input
                            type="number"
                            min={0}
                            value={divisionSize(division)}
                            disabled={hasList}
                            title={hasList ? 'Set by the class list' : ''}
                            onChange={(e) => onUpdateDivision({ ...division, size: Math.max(0, Number(e.target.value)) })}
                          />
                        </label>
                        <label className="mini wide">
                          Class teacher
                          <select
                            value={division.classTeacherId ?? ''}
                            onChange={(e) => onUpdateDivision({ ...division, classTeacherId: e.target.value })}
                          >
                            <option value="">Not set</option>
                            {teachers.map((teacher) => (
                              <option key={teacher.id} value={teacher.id}>
                                {teacher.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className={hasList ? 'secondary small' : 'secondary small accent'}
                          onClick={() => setOpen(open === division.id ? null : division.id)}
                        >
                          {open === division.id ? 'Hide class list' : hasList ? `Class list (${division.students!.length})` : '+ Class list'}
                        </button>
                        <button type="button" className="ghost small danger-text" onClick={() => onRemoveDivision(division.id)}>
                          Delete
                        </button>
                      </div>
                    </div>
                    {!hasList && open !== division.id && (
                      <p className="nudge">
                        Paste the class list to size lab batches exactly from roll numbers. It also turns each period into an
                        attendance register.
                      </p>
                    )}
                    {open === division.id && <RosterEditor division={division} onChange={onUpdateDivision} />}
                  </div>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}
