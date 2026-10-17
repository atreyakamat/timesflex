import { Fragment, useMemo, useState, type DragEvent } from 'react';
import { exportExcel, exportPdf, type ExportInput } from '../export';
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
import { allViews, breaksAfter, institutionBreaks, buildGrid, isBlocked, matchesView, viewTitle, type ViewKey } from '../utils';

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
  unscheduledSessions: SessionRequest[];
  diagnostics: string[];
  conflicts: Conflict[];
  versions: TimetableRecord[];
  timetableId: string | null;
  onGenerate: () => void;
  onSaveEdits: () => void;
  onSessionUpdate: (sessionId: string, patch: Partial<ScheduledSession>) => void;
  onSelectVersion: (id: string) => void;
  onSetStatus: (status: 'approved' | 'edited') => void;
  onPlaceSession: (sessionId: string, where: { day: string; slot: string; room_id: string }) => void;
  onUnplaceSession: (sessionId: string) => void;
  /** Viewers can browse and export but not generate or edit. */
  readOnly?: boolean;
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
  unscheduledSessions,
  diagnostics,
  conflicts,
  versions,
  timetableId,
  onGenerate,
  onSaveEdits,
  onSessionUpdate,
  onSelectVersion,
  onSetStatus,
  onPlaceSession,
  onUnplaceSession,
  readOnly = false,
}: TimetablePreviewProps) {
  const [view, setView] = useState<ViewKey>('all');
  const [scope, setScope] = useState<ExportScope>('view');
  const [exporting, setExporting] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const days = institution.workingDays;
  const breaks = useMemo(() => breaksAfter(slots), [slots]);
  const visible = useMemo(() => scheduledSessions.filter((session) => matchesView(session, view)), [scheduledSessions, view]);
  const grid = useMemo(() => buildGrid(days, slots, visible), [days, slots, visible]);
  const conflicted = useMemo(() => new Set(conflicts.flatMap((conflict) => conflict.sessionIds)), [conflicts]);
  const lockedCount = scheduledSessions.filter((session) => session.locked).length;
  const current = versions.find((version) => version.id === timetableId);
  const title = viewTitle(view, names);

  // In a teacher or room view, shade the cells where that teacher or room is unavailable.
  const [viewKind, viewId] = view.split(':');
  const blockedOwner =
    viewKind === 'teacher' ? teachers.find((t) => t.id === viewId) : viewKind === 'room' ? rooms.find((r) => r.id === viewId) : undefined;

  const sessionLabel = (session: SessionRequest) =>
    `${names[session.subject_id] ?? 'Subject'} · ${names[session.division_id] ?? 'Division'}${session.batch ? ` ${session.batch}` : ''}`;

  const [exportError, setExportError] = useState('');
  // Break names by the slot index they follow, so the grid and exports say "Lunch" where it is lunch.
  const breakLabels = useMemo(() => {
    const labels: Record<number, string> = {};
    for (const rule of institutionBreaks(institution)) {
      labels[rule.afterSlot - 1] = labels[rule.afterSlot - 1] ? `${labels[rule.afterSlot - 1]} / ${rule.label}` : rule.label;
    }
    return labels;
  }, [institution]);

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
      subtitle: `${departmentLabel}${current ? ` · ${current.label} (${statusLabel[current.status] ?? current.status})` : ''}`,
      days,
      slots,
      sessions: scheduledSessions,
      names,
      views,
      breakLabels,
    };
    if (views.length === 0) {
      setExportError('There is nothing to export for that choice.');
      return;
    }
    const filename = `${institution.name || departmentLabel} ${scope === 'view' ? title : scope}`;
    setExporting(format);
    setExportError('');
    try {
      if (format === 'xlsx') await exportExcel(input, filename);
      else await exportPdf(input, filename);
    } catch (error) {
      setExportError(`Export failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setExporting('');
    }
  };

  // Approved versions are frozen until an admin unapproves them.
  const canEditSessions = !readOnly && current?.status !== 'approved';

  const onDrop = (event: DragEvent, day: string, slot: string) => {
    event.preventDefault();
    if (!canEditSessions) return;
    setDragOver(null);
    const id = event.dataTransfer.getData('text/plain');
    if (id) onSessionUpdate(id, { day, slot });
  };

  return (
    <section className="card">
      <header>
        <h1>{readOnly ? 'Timetable' : 'Generate timetable'}</h1>
        <p>
          {readOnly
            ? 'Browse each class, teacher and room view, and export it as Excel or PDF.'
            : 'Solve the schedule, then fine tune it: drag sessions to move them, lock the ones you like, and regenerate the rest.'}
        </p>
      </header>

      {!readOnly && problems.length > 0 && (
        <div className="card warning">
          <h3>Before generating</h3>
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
      {!readOnly && warnings.length > 0 && (
        <ul className="draft-warnings">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {!readOnly && (
      <div className="action-row no-print">
        <button type="button" className="primary" onClick={onGenerate} disabled={busy || problems.length > 0}>
          {busy
            ? 'Working…'
            : scheduledSessions.length
              ? `Regenerate${lockedCount ? ` (keep ${lockedCount} locked)` : ''}`
              : 'Generate timetable'}
        </button>
        <button type="button" className="secondary" onClick={onSaveEdits} disabled={busy || !canEditSessions}>
          Save edits
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
        {current?.status === 'approved' && <span className="hint">Approved versions are locked. Unapprove to edit.</span>}
      </div>
      )}

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
              {divisions.some((item) => item.batches.length) && <option value="batches">Every batch</option>}
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
        </div>
        {exportError && (
          <p className="text-danger no-print" role="alert">
            {exportError}
          </p>
        )}
        <h2 className="print-title">{title}</h2>
      </div>

      {conflicts.length > 0 && (
        <div className="card danger">
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
                          if (!canEditSessions) return;
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
                              draggable={canEditSessions && !continued}
                              onDragStart={(event) => {
                                event.dataTransfer.setData('text/plain', session.id);
                                event.dataTransfer.effectAllowed = 'move';
                              }}
                              className={`session-card ${session.kind === 'lab' ? 'lab' : ''} ${hasConflict ? 'conflict' : ''} ${continued ? 'continued' : ''}`}
                              title={
                                continued
                                  ? 'Continues from the slot above'
                                  : canEditSessions
                                    ? 'Drag to move · double-click to lock or unlock'
                                    : undefined
                              }
                              onDoubleClick={() => canEditSessions && onSessionUpdate(session.id, { locked: !session.locked })}
                            >
                              {hasConflict && <div className="conflict-badge">!</div>}
                              <strong>
                                {session.locked ? '🔒 ' : ''}
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
                    <td colSpan={days.length}>{breakLabels[index] || 'Break'}</td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {(unscheduledSessions.length > 0 || diagnostics.length > 0) && (
        <div className="card warning">
          <h3>Why some sessions are missing</h3>
          <ul>
            {diagnostics.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {unscheduledSessions.length > 0 && !canEditSessions && (
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
          {unscheduledSessions.length > 0 && canEditSessions && (
            <>
              <p>Place these by hand. Any clash shows up as a conflict before you approve.</p>
              <div className="list">
                {unscheduledSessions.map((session) => (
                  <PlaceSessionRow
                    key={session.id}
                    label={`${sessionLabel(session)} · ${names[session.teacher_id] ?? 'Teacher'}`}
                    session={session}
                    days={days}
                    slots={slots}
                    rooms={rooms}
                    onPlace={(where) => onPlaceSession(session.id, where)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {canEditSessions && visible.length > 0 && (
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
                    <select
                      aria-label="Room"
                      value={session.room_id}
                      onChange={(event) => onSessionUpdate(session.id, { room_id: event.target.value })}
                    >
                      {rooms.map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.name}
                          {(room.type === 'lab') !== (session.kind === 'lab') ? ' (wrong type)' : ''}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Teacher"
                      value={session.teacher_id}
                      onChange={(event) => onSessionUpdate(session.id, { teacher_id: event.target.value })}
                    >
                      {teachers.map((teacher) => (
                        <option key={teacher.id} value={teacher.id}>
                          {teacher.name}
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
                    <button
                      type="button"
                      className="chip"
                      onClick={() => onUnplaceSession(session.id)}
                      title="Take this session out of the grid"
                    >
                      Unplace
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PlaceSessionRow({
  label,
  session,
  days,
  slots,
  rooms,
  onPlace,
}: {
  label: string;
  session: SessionRequest;
  days: string[];
  slots: string[];
  rooms: RoomForm[];
  onPlace: (where: { day: string; slot: string; room_id: string }) => void;
}) {
  // Suitable rooms first: right type, then anything else marked as such.
  const fits = (room: RoomForm) => (room.type === 'lab') === (session.kind === 'lab');
  const ordered = [...rooms.filter(fits), ...rooms.filter((room) => !fits(room))];
  const [day, setDay] = useState(days[0] ?? '');
  const [slot, setSlot] = useState(slots[0] ?? '');
  const [roomId, setRoomId] = useState(session.room_id || ordered[0]?.id || '');

  return (
    <div className="list-item">
      <div className="list-content">
        <strong>{label}</strong>
        <span>{session.duration_slots} slot(s)</span>
      </div>
      <div className="inline-fields">
        <select aria-label="Day" value={day} onChange={(event) => setDay(event.target.value)}>
          {days.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select aria-label="Start slot" value={slot} onChange={(event) => setSlot(event.target.value)}>
          {slots.map((item) => (
            <option key={item} value={item}>
              {gridLabel(item)}
            </option>
          ))}
        </select>
        <select aria-label="Room" value={roomId} onChange={(event) => setRoomId(event.target.value)}>
          {ordered.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
              {fits(room) ? '' : ' (wrong type)'}
            </option>
          ))}
        </select>
        <button type="button" className="secondary" disabled={!day || !slot || !roomId} onClick={() => onPlace({ day, slot, room_id: roomId })}>
          Place
        </button>
      </div>
    </div>
  );
}
