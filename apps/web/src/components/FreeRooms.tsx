import { useState } from 'react';
import { coveredSlots, currentSlotIndex, freeRooms, nextSlotIndex, roomUtilization, toDateKey, weekdayOf } from '../ops';
import type { DivisionForm, RoomForm, ScheduledSession, SubjectForm, TeacherForm } from '../types';
import { isBlocked } from '../utils';

interface FreeRoomsProps {
  days: string[];
  slots: string[];
  divisions: DivisionForm[];
  teachers: TeacherForm[];
  rooms: RoomForm[];
  subjects: SubjectForm[];
  names: Record<string, string>;
  sessions: ScheduledSession[];
}

export function FreeRooms({ days, slots, rooms, names, sessions }: FreeRoomsProps) {
  const now = new Date();
  const todayName = weekdayOf(toDateKey(now));
  const startSlot = Math.max(0, currentSlotIndex(slots, now) >= 0 ? currentSlotIndex(slots, now) : nextSlotIndex(slots, now));
  const [day, setDay] = useState(days.includes(todayName) ? todayName : days[0] ?? '');
  const [slot, setSlot] = useState(slots[startSlot] ?? slots[0] ?? '');
  const [type, setType] = useState('any');
  const [minSeats, setMinSeats] = useState(0);

  const free = freeRooms(rooms, sessions, day, slot, slots).filter(
    (room) => (type === 'any' || room.type === type) && room.capacity >= minSeats,
  );
  const busy = rooms.filter((room) => !free.includes(room) && (type === 'any' || room.type === type));

  const usage = rooms
    .map((room) => ({ room, value: roomUtilization(room, sessions, days, slots) }))
    .sort((a, b) => b.value - a.value);

  const occupant = (room: RoomForm) =>
    sessions.find((item) => item.room_id === room.id && item.day === day && coveredSlots(item, slots).includes(slot));

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Run your week</p>
          <h1>Free rooms</h1>
          <p>Need a room for an extra lecture, a meeting or a test? Pick a period and see what is empty.</p>
        </div>
      </header>

      <section className="panel toolbar">
        <label className="mini wide">
          Day
          <select value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="mini wide">
          Period
          <select value={slot} onChange={(e) => setSlot(e.target.value)}>
            {slots.map((item, index) => (
              <option key={item} value={item}>
                P{index + 1} · {item.replace('-', '–')}
              </option>
            ))}
          </select>
        </label>
        <label className="mini wide">
          Type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="any">Any</option>
            <option value="classroom">Classroom</option>
            <option value="lab">Lab</option>
            <option value="seminar-hall">Seminar hall</option>
          </select>
        </label>
        <label className="mini">
          Min seats
          <input type="number" min={0} value={minSeats} onChange={(e) => setMinSeats(Math.max(0, Number(e.target.value)))} />
        </label>
      </section>

      <section className="panel">
        <h2>
          {free.length} free {free.length === 1 ? 'room' : 'rooms'}{' '}
          <span className="muted small">
            · {day} {slot.replace('-', '–')}
          </span>
        </h2>
        <div className="room-grid">
          {free.map((room) => (
            <div key={room.id} className="room-card free">
              <strong>{room.name}</strong>
              <span>
                {room.type.replace('-', ' ')} · {room.capacity} seats
              </span>
              {(room.building || room.equipment) && (
                <span className="muted small">{[room.building, room.equipment].filter(Boolean).join(' · ')}</span>
              )}
            </div>
          ))}
          {busy.map((room) => {
            const session = occupant(room);
            return (
              <div key={room.id} className="room-card busy">
                <strong>{room.name}</strong>
                <span className="muted small">
                  {session
                    ? `${names[session.subject_id]} · ${names[session.division_id]}${session.batch ? ` ${session.batch}` : ''}`
                    : isBlocked(room, day, slot)
                      ? 'Closed'
                      : room.capacity < minSeats
                        ? `Only ${room.capacity} seats`
                        : 'In use'}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h2>How busy each room is</h2>
        <p className="muted">Share of open periods in the week that the timetable uses.</p>
        <div className="usage-list">
          {usage.map(({ room, value }) => (
            <div key={room.id} className="usage-row">
              <span>{room.name}</span>
              <div className="bar">
                <div style={{ width: `${Math.round(value * 100)}%` }} />
              </div>
              <span className="num">{Math.round(value * 100)}%</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
