import { useState } from 'react';
import type { DepartmentForm, DivisionForm } from '../types';
import { createId } from '../utils';

interface AcademicStructureProps {
  department: DepartmentForm;
  onDepartmentUpdate: (department: DepartmentForm) => void;
  divisions: DivisionForm[];
  onAddDivision: (division: DivisionForm) => void;
  onRemoveDivision: (id: string) => void;
}

export function AcademicStructure({
  department,
  onDepartmentUpdate,
  divisions,
  onAddDivision,
  onRemoveDivision,
}: AcademicStructureProps) {
  const [newDivisionName, setNewDivisionName] = useState('');
  const [newDivisionBatches, setNewDivisionBatches] = useState('');

  const handleDepartmentChange = (field: keyof DepartmentForm, value: string) => {
    onDepartmentUpdate({ ...department, [field]: value });
  };

  const handleAddDivision = () => {
    if (!newDivisionName) return;
    onAddDivision({
      id: createId(),
      name: newDivisionName,
      batches: newDivisionBatches
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    });
    setNewDivisionName('');
    setNewDivisionBatches('');
  };

  return (
    <section className="card">
      <header>
        <h1>Academic structure</h1>
        <p>Define department, year, semester, divisions, and batches.</p>
      </header>
      <div className="form-grid">
        <label>
          Department name
          <input
            type="text"
            value={department.name}
            onChange={(event) => handleDepartmentChange('name', event.target.value)}
          />
        </label>
        <label>
          Year label
          <input
            type="text"
            value={department.yearLabel}
            onChange={(event) => handleDepartmentChange('yearLabel', event.target.value)}
          />
        </label>
        <label>
          Semester label
          <input
            type="text"
            value={department.semesterLabel}
            onChange={(event) => handleDepartmentChange('semesterLabel', event.target.value)}
          />
        </label>
      </div>
      <div className="inline-form">
        <input
          type="text"
          placeholder="Division name"
          value={newDivisionName}
          onChange={(e) => setNewDivisionName(e.target.value)}
        />
        <input
          type="text"
          placeholder="Batches (comma separated)"
          value={newDivisionBatches}
          onChange={(e) => setNewDivisionBatches(e.target.value)}
        />
        <button type="button" onClick={handleAddDivision}>
          Add division
        </button>
      </div>
      <div className="list">
        {divisions.map((division) => (
          <div key={division.id} className="list-item">
            <div className="list-content">
              <strong>{division.name}</strong>
              <span>{division.batches.length ? division.batches.join(', ') : 'No batches'}</span>
            </div>
            <button
              type="button"
              className="text-danger"
              onClick={() => onRemoveDivision(division.id)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
