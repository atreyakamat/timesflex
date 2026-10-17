import { useState } from 'react';
import type { DepartmentForm, DivisionForm } from '../types';
import { createId } from '../utils';

interface AcademicStructureProps {
  department: DepartmentForm;
  onDepartmentUpdate: (department: DepartmentForm) => void;
  divisions: DivisionForm[];
  onAddDivision: (division: DivisionForm) => void;
  onUpdateDivision: (division: DivisionForm) => void;
  onRemoveDivision: (id: string) => void;
}

const splitList = (value: string) =>
  [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];

export function AcademicStructure({
  department,
  onDepartmentUpdate,
  divisions,
  onAddDivision,
  onUpdateDivision,
  onRemoveDivision,
}: AcademicStructureProps) {
  const defaultYear = [department.yearLabel, department.semesterLabel].filter(Boolean).join(' · ');
  const [name, setName] = useState('');
  const [batches, setBatches] = useState('');
  const [size, setSize] = useState(60);
  const [yearLabel, setYearLabel] = useState('');

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

  // Group divisions by year / semester: Department -> Year -> Division -> Batch.
  const years = [...new Set(divisions.map((division) => division.yearLabel || defaultYear))];

  return (
    <section className="card">
      <header>
        <h1>Academic structure</h1>
        <p>Department, then year and semester, then divisions and their lab batches.</p>
      </header>
      <div className="form-grid">
        <label>
          Department
          <input type="text" value={department.name} onChange={(event) => handleDepartmentChange('name', event.target.value)} />
        </label>
        <label>
          Default year
          <input
            type="text"
            value={department.yearLabel}
            onChange={(event) => handleDepartmentChange('yearLabel', event.target.value)}
          />
        </label>
        <label>
          Default semester
          <input
            type="text"
            value={department.semesterLabel}
            onChange={(event) => handleDepartmentChange('semesterLabel', event.target.value)}
          />
        </label>
      </div>

      <div className="inline-form">
        <input type="text" placeholder="Division, e.g. SE-A" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          type="text"
          placeholder="Lab batches, e.g. A1, A2"
          value={batches}
          onChange={(e) => setBatches(e.target.value)}
        />
        <label className="mini">
          Students
          <input type="number" min={0} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        </label>
        <input
          type="text"
          placeholder={`Year / semester (${defaultYear || 'optional'})`}
          value={yearLabel}
          onChange={(e) => setYearLabel(e.target.value)}
        />
        <button type="button" onClick={handleAdd}>
          Add division
        </button>
      </div>

      {years.map((year) => (
        <div key={year || 'none'} className="year-group">
          <h3>
            {department.name}
            {year ? ` · ${year}` : ''}
          </h3>
          <div className="list">
            {divisions
              .filter((division) => (division.yearLabel || defaultYear) === year)
              .map((division) => (
                <div key={division.id} className="list-item">
                  <div className="list-content">
                    <strong>{division.name}</strong>
                    <span>
                      {division.batches.length
                        ? `${division.batches.length} batches${division.size ? ` of about ${Math.ceil(division.size / division.batches.length)}` : ''}`
                        : 'No lab batches: labs run with the whole division'}
                    </span>
                  </div>
                  <div className="inline-fields">
                    <input
                      key={division.batches.join(',')}
                      type="text"
                      title="Lab batches (comma separated)"
                      defaultValue={division.batches.join(', ')}
                      onBlur={(e) => onUpdateDivision({ ...division, batches: splitList(e.target.value) })}
                    />
                    <label className="mini">
                      Students
                      <input
                        type="number"
                        min={0}
                        value={division.size ?? 0}
                        onChange={(e) => onUpdateDivision({ ...division, size: Math.max(0, Number(e.target.value)) })}
                      />
                    </label>
                    <input
                      type="text"
                      title="Year / semester"
                      value={division.yearLabel ?? defaultYear}
                      onChange={(e) => onUpdateDivision({ ...division, yearLabel: e.target.value })}
                    />
                    <button type="button" className="text-danger" onClick={() => onRemoveDivision(division.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}
    </section>
  );
}
