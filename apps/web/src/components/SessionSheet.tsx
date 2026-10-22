import { useEffect } from 'react';
import type { Conflict, RoomForm, ScheduledSession } from '../types';

interface SessionSheetProps {
  session: ScheduledSession;
  days: string[];
  slots: string[];
  rooms: RoomForm[];
  names: Record<string, string>;
  conflicts: Conflict[];
  onChange: (patch: Partial<ScheduledSession>) => void;
  onClose: () => void;
}

/** Tap a session (phones, or anyone who prefers it to dragging) to move it, change the room, or lock it. */
export function SessionSheet({ session, days, slots, rooms, names, conflicts, onChange, onClose }: SessionSheetProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mine = conflicts.filter((conflict) => conflict.sessionIds.includes(session.id));

  return (
    <div className="sheet-layer" role="dialog" aria-modal="true" aria-label="Edit session">
      <div className="drawer-scrim" onClick={onClose} />
      <div className="sheet glass">
        <div className="sheet-handle" />
        <header className="sheet-head">
          <div>
            <strong>{names[session.subject_id]}</strong>
            <span className="muted small">
              {names[session.division_id]}
              {session.batch ? ` · ${session.batch}` : ''} · {names[session.teacher_id]} · {session.duration_slots} period(s)
            </span>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {mine.length > 0 && (
          <ul className="alert danger block">
            {mine.map((conflict, index) => (
              <li key={index}>{conflict.message}</li>
            ))}
          </ul>
        )}
        <span className="field-label">Day</span>
        <div className="chip-row">
          {days.map((day) => (
            <button key={day} type="button" className={`chip ${session.day === day ? 'active' : ''}`} onClick={() => onChange({ day })}>
              {day.slice(0, 3)}
            </button>
          ))}
        </div>
        <span className="field-label">Starts</span>
        <div className="chip-row">
          {slots.map((slot, index) => (
            <button key={slot} type="button" className={`chip ${session.slot === slot ? 'active' : ''}`} onClick={() => onChange({ slot })}>
              P{index + 1} · {slot.split('-')[0]}
            </button>
          ))}
        </div>
        <label className="sheet-room">
          Room
          <select value={session.room_id} onChange={(e) => onChange({ room_id: e.target.value })}>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name} · {room.capacity} seats
              </option>
            ))}
          </select>
        </label>
        <div className="action-row">
          <button type="button" className={session.locked ? 'secondary' : 'secondary accent'} onClick={() => onChange({ locked: !session.locked })}>
            {session.locked ? '🔓 Unlock' : '🔒 Lock in place'}
          </button>
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
