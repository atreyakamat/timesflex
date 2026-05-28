import type {
  DivisionForm,
  InstitutionForm,
  RoomForm,
  ScheduledSession,
  SessionRequest,
  SubjectForm,
  TeacherForm,
} from '../types';
import { exportToCsv } from '../utils';

interface TimetablePreviewProps {
  institution: InstitutionForm;
  divisions: DivisionForm[];
  teachers: TeacherForm[];
  rooms: RoomForm[];
  subjects: SubjectForm[];
  slots: string[];
  scheduledSessions: ScheduledSession[];
  unscheduledSessions: SessionRequest[];
  timetableGrid: Record<string, Record<string, ScheduledSession[]>>;
  conflicts: string[];
  onGenerate: () => void;
  onSaveEdits: () => void;
  onSessionUpdate: (sessionId: string, field: 'day' | 'slot', value: string) => void;
}

const gridLabel = (value: string) => value.replace('-', ' - ');

export function TimetablePreview({
  institution,
  divisions,
  teachers,
  rooms,
  subjects,
  slots,
  scheduledSessions,
  unscheduledSessions,
  timetableGrid,
  conflicts,
  onGenerate,
  onSaveEdits,
  onSessionUpdate,
}: TimetablePreviewProps) {
  const handleExport = () => {
    exportToCsv(
      institution.workingDays,
      slots,
      timetableGrid,
      subjects,
      teachers,
      divisions,
    );
  };

  return (
    <section className="card">
      <header>
        <h1>Generate timetable</h1>
        <p>Preview slots, solve the schedule, and fine tune the results.</p>
      </header>
      <div className="summary-grid">
        <div>
          <h3>Slots</h3>
          <div className="chip-row">
            {slots.map((slot) => (
              <span key={slot} className="chip active">
                {gridLabel(slot)}
              </span>
            ))}
          </div>
        </div>
        <div>
          <h3>Divisions</h3>
          <div className="chip-row">
            {divisions.map((division) => (
              <span key={division.id} className="chip active">
                {division.name}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="action-row">
        <button type="button" className="primary" onClick={onGenerate}>
          Generate timetable
        </button>
        <button type="button" className="secondary" onClick={onSaveEdits}>
          Save manual edits
        </button>
        <button type="button" className="secondary" onClick={handleExport} disabled={scheduledSessions.length === 0}>
          Export to CSV
        </button>
        <button type="button" className="secondary" onClick={() => window.print()} disabled={scheduledSessions.length === 0}>
          Print to PDF
        </button>
      </div>

      {conflicts.length > 0 && (
        <div className="card danger">
          <h3>Scheduling Conflicts</h3>
          <p>The following conflicts were detected in the current schedule:</p>
          <ul>
            {conflicts.map((conflict, index) => (
              <li key={index}>{conflict}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="timetable">
        <div className="timetable-header">
          <div className="timetable-cell">Slot</div>
          {institution.workingDays.map((day) => (
            <div key={day} className="timetable-cell header">
              {day}
            </div>
          ))}
        </div>
        {slots.map((slot) => (
          <div key={slot} className="timetable-row">
            <div className="timetable-cell slot">{gridLabel(slot)}</div>
            {institution.workingDays.map((day) => (
              <div key={`${day}-${slot}`} className="timetable-cell">
                {(timetableGrid[day]?.[slot] ?? []).map((session) => {
                  const subject = subjects.find((item) => item.id === session.subject_id);
                  const teacher = teachers.find((item) => item.id === session.teacher_id);
                  const room = rooms.find((item) => item.id === session.room_id);
                  const division = divisions.find((item) => item.id === session.division_id);
                  return (
                    <div key={session.id} className="session-card">
                      <strong>{subject?.name ?? 'Subject'}</strong>
                      <span>
                        {division?.name ?? 'Division'} · {room?.name ?? 'Room'}
                      </span>
                      <span>{teacher?.name ?? 'Teacher'}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="editor">
        <h3>Edit sessions</h3>
        <div className="list">
          {scheduledSessions.map((session) => {
            const subject = subjects.find((item) => item.id === session.subject_id);
            return (
              <div key={session.id} className="list-item">
                <strong>{subject?.name ?? session.subject_id}</strong>
                <div className="inline-fields">
                  <select
                    value={session.day}
                    onChange={(event) => onSessionUpdate(session.id, 'day', event.target.value)}
                  >
                    {institution.workingDays.map((day) => (
                      <option key={day} value={day}>
                        {day}
                      </option>
                    ))}
                  </select>
                  <select
                    value={session.slot}
                    onChange={(event) => onSessionUpdate(session.id, 'slot', event.target.value)}
                  >
                    {slots.map((slot) => (
                      <option key={slot} value={slot}>
                        {gridLabel(slot)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {unscheduledSessions.length > 0 && (
        <div className="card warning">
          <h3>Unscheduled sessions</h3>
          <p>These sessions could not be placed by the solver.</p>
          <ul>
            {unscheduledSessions.map((session) => (
              <li key={session.id}>{session.subject_id}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
