import { Fragment, useMemo, useState, type DragEvent } from 'react';
import type { Page } from '../App';
import { exportExcel, exportPdf, type ExportInput } from '../export';
import { weekAsText } from '../ops';
import type {
  Conflict,
  DivisionForm,
  InstitutionForm,
  RoomForm,
  ScheduledSession,
  SessionRequest,
  TeacherForm,
  TimetableRecord,
} from '../types';
import { allViews, breaksAfter, buildGrid, isBlocked, matchesView, viewTitle, type ViewKey } from '../utils';

interface TimetablePreviewProps {
  institution: InstitutionForm;
  departmentLabel: string;
  divisions: DivisionForm[];
  teachers: TeacherForm[];
  rooms: RoomForm[];
  slots: string[];
  names: Record<string, string>;
  busy: boolean;
  problems: string[];
  warnings: string[];
  scheduledSessions: ScheduledSession[];
  /** Subject codes by subject id, shown before the name. */
  codesBySubject?: Record<string, string>;
  unscheduledSessions: SessionRequest[];
  diagnostics: string[];
  conflicts: Conflict[];
  versions: TimetableRecord[];
  timetableId: string | null;
  onGenerate: () => void;
  onSessionUpdate: (sessionId: string, patch: Partial<ScheduledSession>) => void;
  onSelectVersion: (id: string) => void;
  onSetStatus: (status: 'approved' | 'edited') => void;
  onGo: (page: Page) => void;
}

type ExportScope = 'view' | 'classes' | 'batches' | 'teachers' | 'rooms' | 'everything';

const gridLabel = (value: string) => value.replace('-', ' – ');

const statusLabel: Record<string, string> = {
  draft: 'Draft',
  generated: 'Generated',
  partial: 'Partial',
  edited: 'Edited',
  approved: 'Approved',
};

const formatDate = (value?: string) =>
  value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';

export function TimetablePreview({
  institution,
  departmentLabel,
  divisions,
  teachers,
  rooms,
  slots,
  names,
  busy,
  problems,
  warnings,
  scheduledSessions,
  codesBySubject = {},
  unscheduledSessions,
  diagnostics,
  conflicts,
  versions,
  timetableId,
  onGenerate,
  onSessionUpdate,
  onSelectVersion,
  onSetStatus,
  onGo,
}: TimetablePreviewProps) {
  const [view, setView] = useState<ViewKey>('all');
  const [scope, setScope] = useState<ExportScope>('view');
  const [exporting, setExporting] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [copied, setCopied] = useState(false);

  const days = institution.workingDays;
  const breaks = useMemo(() => breaksAfter(slots), [slots]);
  const visible = useMemo(() => scheduledSessions.filter((session) => matchesView(session, view)), [scheduledSessions, view]);
  const grid = useMemo(() => buildGrid(days, slots, visible), [days, slots, visible]);
  const conflicted = useMemo(() => new Set(conflicts.flatMap((conflict) => conflict.sessionIds)), [conflicts]);
  const lockedCount = scheduledSessions.filter((session) => session.locked).length;
  const current = versions.find((version) => version.id === timetableId);
  const title = viewTitle(view, names);
  const codes = codesBySubject;

  // In a teacher or room view, shade the cells where that teacher or room is unavailable.
  const [viewKind, viewId] = view.split(':');
  const blockedOwner =
    viewKind === 'teacher' ? teachers.find((t) => t.id === viewId) : viewKind === 'room' ? rooms.find((r) => r.id === viewId) : undefined;

  const sessionLabel = (session: SessionRequest) =>
    `${names[session.subject_id] ?? 'Subject'} · ${names[session.division_id] ?? 'Division'}${session.batch ? ` ${session.batch}` : ''}`;

  const handleExport = async (format: 'xlsx' | 'pdf') => {
    const everything = allViews(divisions, teachers, rooms);
    const views: ViewKey[] =
      scope === 'view'
        ? [view]
        : scope === 'everything'
          ? [...everything.classes, ...everything.batches, ...everything.teachers, ...everything.rooms]
          : everything[scope];
    const input: ExportInput = {
      institutionName: institution.name || departmentLabel,
      subtitle: [
        departmentLabel,
        institution.academicYear,
        current ? `${current.label} (${statusLabel[current.status] ?? current.status})` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      days,
      slots,
      sessions: scheduledSessions,
      names,
      views,
    };
    const filename = `${institution.name || departmentLabel} ${scope === 'view' ? title : scope}`;
    setExporting(format);
    try {
      if (format === 'xlsx') await exportExcel(input, filename);
      else await exportPdf(input, filename);
    } finally {
      setExporting('');
    }
  };

  const copyAsText = async () => {
    const text = weekAsText({
      title,
      sessions: visible,
      days,
      slots,
      names,
      perspective: viewKind === 'teacher' ? 'teacher' : 'class',
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked; nothing else to do.
    }
  };

  const onDrop = (event: DragEvent, day: string, slot: string) => {
    event.preventDefault();
    setDragOver(null);
    const id = event.dataTransfer.getData('text/plain');
    if (id) onSessionUpdate(id, { day, slot });
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Step 6 · Timetable</p>
          <h1>Your timetable</h1>
          <p>Generate it, then fine tune: drag a session to move it, double-click to lock it, regenerate the rest.</p>
        </div>
      </header>

      {problems.length > 0 && (
        <div className="alert warn block">
          <h3>Before generating</h3>
          <ul>
            {problems.map((problem) => {
              const step = /\((Institution|Structure|Teachers|Rooms & Labs|Subjects)\)/.exec(problem)?.[1];
              const target: Record<string, Page> = {
                Institution: 'basics',
                Structure: 'classes',
                Teachers: 'teachers',
                'Rooms & Labs': 'rooms',
                Subjects: 'subjects',
              };
              return (
                <li key={problem}>
                  {problem.replace(/ \([^)]*\)\.?$/, '.')}{' '}
                  {step && (
                    <button type="button" className="link-button" onClick={() => onGo(target[step])}>
                      Fix
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <section className="panel">
      {warnings.length > 0 && (
        <ul className="draft-warnings">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      <div className="action-row no-print">
        <button type="button" className="primary" onClick={onGenerate} disabled={busy || problems.length > 0}>
          {busy
            ? 'Working…'
            : scheduledSessions.length
              ? `Regenerate${lockedCount ? ` (keep ${lockedCount} locked)` : ''}`
              : 'Generate timetable'}
        </button>
        {current && (
          <button
            type="button"
            className={current.status === 'approved' ? 'secondary' : 'secondary approve'}
            onClick={() => onSetStatus(current.status === 'approved' ? 'edited' : 'approved')}
            disabled={busy || (current.status !== 'approved' && conflicts.length > 0)}
            title={conflicts.length ? 'Resolve conflicts before approving' : ''}
          >
            {current.status === 'approved' ? 'Unapprove' : 'Approve version'}
          </button>
        )}
      </div>

      {versions.length > 0 && (
        <div className="version-bar no-print">
          <label>
            Version
            <select value={timetableId ?? ''} onChange={(e) => onSelectVersion(e.target.value)} disabled={busy}>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.label} · {formatDate(version.createdAt)} · {statusLabel[version.status] ?? version.status}
                </option>
              ))}
            </select>
          </label>
          {current && <span className={`status-badge ${current.status}`}>{statusLabel[current.status] ?? current.status}</span>}
          <span className="stats">
            {scheduledSessions.length} placed
            {unscheduledSessions.length ? ` · ${unscheduledSessions.length} missing` : ''} · {conflicts.length} conflict(s) ·{' '}
            {lockedCount} locked
          </span>
        </div>
      )}

      <div className="view-picker">
        <label className="no-print">
          View
          <select value={view} onChange={(event) => setView(event.target.value)}>
            <option value="all">All classes</option>
            <option value="labs">All labs</option>
            <optgroup label="Class timetable">
              {divisions.map((item) => (
                <option key={item.id} value={`division:${item.id}`}>
                  {item.name}
                  {item.yearLabel ? ` (${item.yearLabel})` : ''}
                </option>
              ))}
            </optgroup>
            {divisions.some((item) => item.batches.length) && (
              <optgroup label="Batch timetable">
                {divisions.flatMap((item) =>
                  item.batches.map((batch) => (
                    <option key={`${item.id}:${batch}`} value={`batch:${item.id}:${batch}`}>
                      {item.name} · {batch}
                    </option>
                  )),
                )}
              </optgroup>
            )}
            <optgroup label="Teacher timetable">
              {teachers.map((item) => (
                <option key={item.id} value={`teacher:${item.id}`}>
                  {item.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Room timetable">
              {rooms.map((item) => (
                <option key={item.id} value={`room:${item.id}`}>
                  {item.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <div className="export-controls no-print">
          <label>
            Export
            <select value={scope} onChange={(e) => setScope(e.target.value as ExportScope)}>
              <option value="view">This view</option>
              <option value="classes">Every class</option>
              <option value="batches">Every batch</option>
              <option value="teachers">Every teacher</option>
              <option value="rooms">Every room</option>
              <option value="everything">Everything</option>
            </select>
          </label>
          <button type="button" className="secondary" onClick={() => handleExport('xlsx')} disabled={!scheduledSessions.length || !!exporting}>
            {exporting === 'xlsx' ? 'Exporting…' : 'Excel'}
          </button>
          <button type="button" className="secondary" onClick={() => handleExport('pdf')} disabled={!scheduledSessions.length || !!exporting}>
            {exporting === 'pdf' ? 'Exporting…' : 'PDF'}
          </button>
          <button type="button" className="secondary" onClick={() => window.print()} disabled={!visible.length}>
            Print
          </button>
          {(viewKind === 'teacher' || viewKind === 'division' || viewKind === 'batch') && (
            <button type="button" className="secondary" onClick={copyAsText} disabled={!visible.length}>
              {copied ? 'Copied ✓' : 'Copy as text'}
            </button>
          )}
        </div>
        <h2 className="print-title">{title}</h2>
      </div>

      {conflicts.length > 0 && (
        <div className="alert danger block">
          <h3>Conflicts ({conflicts.length})</h3>
          <ul>
            {conflicts.map((conflict, index) => (
              <li key={index}>{conflict.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="timetable-scroll">
        <table className="timetable-grid">
          <thead>
            <tr>
              <th className="slot">Time</th>
              {days.map((day) => (
                <th key={day}>{day}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((slot, index) => (
              <Fragment key={slot}>
                <tr>
                  <th className="slot">{gridLabel(slot)}</th>
                  {days.map((day) => {
                    const cellKey = `${day}|${slot}`;
                    const blocked = blockedOwner && isBlocked(blockedOwner, day, slot);
                    return (
                      <td
                        key={cellKey}
                        className={`${dragOver === cellKey ? 'drop-target' : ''} ${blocked ? 'blocked' : ''}`}
                        onDragOver={(event) => {
                          event.preventDefault();
                          if (dragOver !== cellKey) setDragOver(cellKey);
                        }}
                        onDragLeave={() => setDragOver((value) => (value === cellKey ? null : value))}
                        onDrop={(event) => onDrop(event, day, slot)}
                      >
                        {(grid[day]?.[slot] ?? []).map((session) => {
                          const hasConflict = conflicted.has(session.id);
                          const continued = session.slot !== slot;
                          return (
                            <div
                              key={session.id}
                              draggable={!continued}
                              onDragStart={(event) => {
                                event.dataTransfer.setData('text/plain', session.id);
                                event.dataTransfer.effectAllowed = 'move';
                              }}
                              className={`session-card ${session.kind === 'lab' ? 'lab' : ''} ${hasConflict ? 'conflict' : ''} ${continued ? 'continued' : ''}`}
                              title={continued ? 'Continues from the slot above' : 'Drag to move · double-click to lock or unlock'}
                              onDoubleClick={() => onSessionUpdate(session.id, { locked: !session.locked })}
                            >
                              {hasConflict && <div className="conflict-badge">!</div>}
                              <strong>
                                {session.locked ? '🔒 ' : ''}
                                {codes[session.subject_id] ? <span className="code">{codes[session.subject_id]}</span> : null}
                                {names[session.subject_id] ?? 'Subject'}
                                {session.batch ? ` (${session.batch})` : ''}
                              </strong>
                              {!continued && (
                                <>
                                  {viewKind !== 'division' && viewKind !== 'batch' && (
                                    <span>{names[session.division_id] ?? 'Division'}</span>
                                  )}
                                  {viewKind !== 'teacher' && <span>{names[session.teacher_id] ?? 'Teacher'}</span>}
                                  {viewKind !== 'room' && <span>{names[session.room_id] ?? 'Room'}</span>}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </td>
                    );
                  })}
                </tr>
                {breaks.has(index) && (
                  <tr className="break-row">
                    <th className="slot">{`${slot.split('-')[1]} – ${slots[index + 1].split('-')[0]}`}</th>
                    <td colSpan={days.length}>Break</td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {scheduledSessions.length === 0 && (
        <div className="empty-grid no-print">
          {problems.length ? 'Fix the items above, then generate.' : 'Press Generate to build every class, teacher and room timetable at once.'}
        </div>
      )}

      {(unscheduledSessions.length > 0 || diagnostics.length > 0) && (
        <div className="alert warn block">
          <h3>Why some sessions are missing</h3>
          <ul>
            {diagnostics.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {unscheduledSessions.length > 0 && (
            <p>
              Not placed:{' '}
              {Object.entries(
                unscheduledSessions.reduce<Record<string, number>>((acc, session) => {
                  const key = sessionLabel(session);
                  acc[key] = (acc[key] ?? 0) + 1;
                  return acc;
                }, {}),
              )
                .map(([label, count]) => `${label} ×${count}`)
                .join(', ')}
            </p>
          )}
        </div>
      )}

      {visible.length > 0 && (
        <div className="editor no-print">
          <button type="button" className="link-button" onClick={() => setShowEditor(!showEditor)}>
            {showEditor ? 'Hide session list' : `Edit sessions as a list (${visible.length})`}
          </button>
          {showEditor && (
            <div className="list">
              {visible.map((session) => (
                <div key={session.id} className={`list-item ${conflicted.has(session.id) ? 'needs-attention' : ''}`}>
                  <div className="list-content">
                    <strong>{sessionLabel(session)}</strong>
                    <span>
                      {names[session.teacher_id] ?? 'Teacher'} · {session.duration_slots} slot(s)
                      {session.size ? ` · ${session.size} students` : ''}
                    </span>
                  </div>
                  <div className="inline-fields">
                    <select value={session.day} onChange={(event) => onSessionUpdate(session.id, { day: event.target.value })}>
                      {days.map((day) => (
                        <option key={day} value={day}>
                          {day}
                        </option>
                      ))}
                    </select>
                    <select value={session.slot} onChange={(event) => onSessionUpdate(session.id, { slot: event.target.value })}>
                      {slots.map((slot) => (
                        <option key={slot} value={slot}>
                          {gridLabel(slot)}
                        </option>
                      ))}
                    </select>
                    <select value={session.room_id} onChange={(event) => onSessionUpdate(session.id, { room_id: event.target.value })}>
                      {rooms.map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={session.locked ? 'chip active' : 'chip'}
                      onClick={() => onSessionUpdate(session.id, { locked: !session.locked })}
                      title="Locked sessions keep their place when you regenerate"
                    >
                      {session.locked ? '🔒 Locked' : 'Lock'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
    </div>
  );
}
