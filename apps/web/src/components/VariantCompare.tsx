import type { TimetableRecord } from '../types';
import { bestBy, styleLabel, timetableMetrics, type TimetableMetrics } from '../variants';

interface VariantCompareProps {
  versions: TimetableRecord[];
  currentId: string | null;
  days: string[];
  slots: string[];
  onSelect: (id: string) => void;
}

const ROWS: { key: keyof TimetableMetrics; label: string; hint: string }[] = [
  { key: 'teacherDays', label: 'Teacher days', hint: 'Days teachers must come in, all teachers together' },
  { key: 'teacherGaps', label: 'Teacher free gaps', hint: 'Idle periods between a teacher’s classes' },
  { key: 'classGaps', label: 'Class free gaps', hint: 'Idle periods between a class’s periods' },
  { key: 'firstPeriod', label: 'First-period classes', hint: 'Sessions in the first period' },
  { key: 'lastPeriod', label: 'Last-period classes', hint: 'Sessions in the last period' },
  { key: 'averageFinish', label: 'Day ends at period', hint: 'On average, for a class' },
  { key: 'heaviestClassDay', label: 'Busiest class day', hint: 'Most periods any class has in one day' },
];

/** Side-by-side numbers for the most recent versions, best value per row highlighted. Lower is better. */
export function VariantCompare({ versions, currentId, days, slots, onSelect }: VariantCompareProps) {
  const shown = versions.filter((version) => version.generatedSessions?.length).slice(0, 5);
  if (shown.length < 2) return null;
  const rows = shown.map((version) => ({ id: version.id, version, metrics: timetableMetrics(version.generatedSessions, { days, slots }) }));
  const best = bestBy(rows);

  return (
    <section className="panel compare no-print">
      <div className="section-head">
        <div>
          <h2>Compare versions</h2>
          <p className="muted small">Lower is better on every row. The best in each row is highlighted.</p>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table compare-table">
          <thead>
            <tr>
              <th />
              {rows.map(({ id, version }) => (
                <th key={id} className={id === currentId ? 'current' : ''}>
                  <span className="compare-name">{version.label}</span>
                  <span className="muted">{styleLabel(version.request?.style)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Periods placed</td>
              {rows.map(({ id, metrics }) => (
                <td key={id} className={`num ${id === currentId ? 'current' : ''}`}>
                  {metrics.periods}
                </td>
              ))}
            </tr>
            {ROWS.map((row) => (
              <tr key={row.key}>
                <td title={row.hint}>{row.label}</td>
                {rows.map(({ id, metrics }) => (
                  <td key={id} className={`num ${best[row.key] === id ? 'best' : ''} ${id === currentId ? 'current' : ''}`}>
                    {metrics[row.key]}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td />
              {rows.map(({ id, version }) => (
                <td key={id} className={id === currentId ? 'current' : ''}>
                  {id === currentId ? (
                    <span className="pill ok">Showing</span>
                  ) : (
                    <button type="button" className="secondary small" onClick={() => onSelect(id)}>
                      Show
                    </button>
                  )}
                  {version.status === 'approved' && <span className="pill ok"> Approved</span>}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
