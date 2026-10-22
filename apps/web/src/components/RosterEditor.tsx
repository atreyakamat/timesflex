import { useState } from 'react';
import { parseRoster, splitIntoBatches } from '../ops';
import type { DivisionForm, StudentRecord } from '../types';
import { createId } from '../utils';

interface RosterEditorProps {
  division: DivisionForm;
  onChange: (division: DivisionForm) => void;
  /** Extra column, e.g. attendance %, keyed by student id. */
  extra?: { label: string; values: Record<string, string> };
}

/** Paste or edit a class list. Keeps the division size equal to the list length. */
export function RosterEditor({ division, onChange, extra }: RosterEditorProps) {
  const students = division.students ?? [];
  const [paste, setPaste] = useState('');
  const [showPaste, setShowPaste] = useState(students.length === 0);
  const [filter, setFilter] = useState('');

  const commit = (next: StudentRecord[]) =>
    onChange({ ...division, students: next, size: next.length || division.size });

  const importPaste = (mode: 'append' | 'replace') => {
    const parsed = parseRoster(paste).map((item) => ({ id: createId(), ...item }));
    if (!parsed.length) return;
    const base = mode === 'replace' ? [] : students;
    commit(splitIntoBatches([...base, ...parsed], division.batches));
    setPaste('');
    setShowPaste(false);
  };

  const update = (id: string, patch: Partial<StudentRecord>) =>
    commit(students.map((student) => (student.id === id ? { ...student, ...patch } : student)));

  const addOne = () =>
    commit([
      ...students,
      { id: createId(), rollNo: String(students.length + 1), name: '', batch: division.batches[division.batches.length - 1] },
    ]);

  const perBatch = division.batches.map((batch) => [batch, students.filter((s) => s.batch === batch).length] as const);
  const shown = filter
    ? students.filter((s) => `${s.rollNo} ${s.name}`.toLowerCase().includes(filter.toLowerCase()))
    : students;

  return (
    <div className="roster">
      <div className="roster-bar">
        <strong>
          {students.length ? `${students.length} students` : 'No class list yet'}
          {perBatch.length > 0 && students.length > 0 && (
            <span className="muted small"> · {perBatch.map(([batch, count]) => `${batch}: ${count}`).join(' · ')}</span>
          )}
        </strong>
        <div className="action-row compact">
          {students.length > 8 && (
            <input type="search" placeholder="Find student" value={filter} onChange={(e) => setFilter(e.target.value)} />
          )}
          {division.batches.length > 0 && students.length > 0 && (
            <button
              type="button"
              className="secondary small"
              onClick={() => commit(splitIntoBatches(students, division.batches))}
              title="First block of roll numbers to the first batch, and so on"
            >
              Re-split batches evenly
            </button>
          )}
          <button type="button" className="secondary small" onClick={() => setShowPaste(!showPaste)}>
            {showPaste ? 'Close' : 'Paste list'}
          </button>
          <button type="button" className="secondary small" onClick={addOne}>
            + Student
          </button>
        </div>
      </div>

      {showPaste && (
        <div className="paste-box">
          <textarea
            rows={5}
            placeholder={'One student per line, straight from Excel:\n1, Aarav Patil\n2, Diya Naik\n…'}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          <div className="action-row compact">
            <button type="button" className="primary small" onClick={() => importPaste('append')} disabled={!paste.trim()}>
              Add {parseRoster(paste).length || ''} students
            </button>
            {students.length > 0 && (
              <button type="button" className="secondary small" onClick={() => importPaste('replace')} disabled={!paste.trim()}>
                Replace the list
              </button>
            )}
            <span className="muted small">
              Columns: roll no, name, and optionally e-mail and phone.
              {division.batches.length > 0 && ' Students are split into lab batches by roll number.'}
            </span>
          </div>
        </div>
      )}

      {students.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Roll</th>
                <th>Name</th>
                {division.batches.length > 0 && <th style={{ width: 100 }}>Batch</th>}
                <th>E-mail</th>
                <th style={{ width: 140 }}>Phone</th>
                {extra && <th style={{ width: 90 }}>{extra.label}</th>}
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {shown.map((student) => (
                <tr key={student.id}>
                  <td>
                    <input value={student.rollNo} onChange={(e) => update(student.id, { rollNo: e.target.value })} />
                  </td>
                  <td>
                    <input value={student.name} placeholder="Name" onChange={(e) => update(student.id, { name: e.target.value })} />
                  </td>
                  {division.batches.length > 0 && (
                    <td>
                      <select value={student.batch ?? ''} onChange={(e) => update(student.id, { batch: e.target.value })}>
                        <option value="">-</option>
                        {division.batches.map((batch) => (
                          <option key={batch} value={batch}>
                            {batch}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td>
                    <input
                      type="email"
                      value={student.email ?? ''}
                      onChange={(e) => update(student.id, { email: e.target.value })}
                    />
                  </td>
                  <td>
                    <input type="tel" value={student.phone ?? ''} onChange={(e) => update(student.id, { phone: e.target.value })} />
                  </td>
                  {extra && <td className="num">{extra.values[student.id] ?? '-'}</td>}
                  <td>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove ${student.name}`}
                      onClick={() => commit(students.filter((item) => item.id !== student.id))}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
