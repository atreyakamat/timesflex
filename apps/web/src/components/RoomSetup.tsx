import { useState } from 'react';
import type { RoomForm } from '../types';
import { createId } from '../utils';
import { AvailabilityGrid } from './AvailabilityGrid';

interface RoomSetupProps {
  rooms: RoomForm[];
  days: string[];
  slots: string[];
  onAddRoom: (room: RoomForm) => void;
  onUpdateRoom: (room: RoomForm) => void;
  onRemoveRoom: (id: string) => void;
}

export function RoomSetup({ rooms, days, slots, onAddRoom, onUpdateRoom, onRemoveRoom }: RoomSetupProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<RoomForm['type']>('classroom');
  const [capacity, setCapacity] = useState(60);
  const [open, setOpen] = useState<string | null>(null);

  const handleAdd = () => {
    if (!name.trim()) return;
    onAddRoom({ id: createId(), name: name.trim(), type, capacity: Math.max(1, Math.round(capacity) || 1), equipment: '' });
    setName('');
  };

  return (
    <section className="card">
      <header>
        <h1>Rooms and labs</h1>
        <p>
          Subjects without a fixed room are placed in any free room of the right type that seats the class. Close a room
          for times it is not available.
        </p>
      </header>
      <div className="inline-form">
        <input type="text" placeholder="Room name" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value as RoomForm['type'])}>
          <option value="classroom">Classroom</option>
          <option value="lab">Lab</option>
          <option value="seminar-hall">Seminar hall</option>
        </select>
        <label className="mini">
          Seats
          <input type="number" value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} min={1} />
        </label>
        <button type="button" onClick={handleAdd}>
          Add room
        </button>
      </div>
      <div className="list">
        {rooms.map((room) => {
          const closed = (room.unavailableDays?.length ?? 0) + (room.unavailableSlots?.length ?? 0);
          return (
            <div key={room.id} className="list-item stacked">
              <div className="list-row">
                <div className="list-content">
                  <input
                    key={room.name}
                    className="name-input"
                    type="text"
                    aria-label="Room name"
                    defaultValue={room.name}
                    onBlur={(e) => {
                      const value = e.target.value.trim();
                      if (value && value !== room.name) onUpdateRoom({ ...room, name: value });
                      else e.target.value = room.name;
                    }}
                  />
                  <span>
                    {room.type} · {room.capacity} seats{closed ? ` · ${closed} closed` : ''}
                  </span>
                </div>
                <div className="inline-fields">
                  <select value={room.type} onChange={(e) => onUpdateRoom({ ...room, type: e.target.value as RoomForm['type'] })}>
                    <option value="classroom">Classroom</option>
                    <option value="lab">Lab</option>
                    <option value="seminar-hall">Seminar hall</option>
                  </select>
                  <label className="mini">
                    Seats
                    <input
                      type="number"
                      min={1}
                      value={room.capacity}
                      onChange={(e) => onUpdateRoom({ ...room, capacity: Math.max(1, Number(e.target.value)) })}
                    />
                  </label>
                  {room.type === 'lab' && (
                    <input
                      type="text"
                      className="equipment"
                      placeholder="Equipment / software"
                      value={room.equipment ?? ''}
                      onChange={(e) => onUpdateRoom({ ...room, equipment: e.target.value })}
                    />
                  )}
                  <button type="button" className="secondary small" onClick={() => setOpen(open === room.id ? null : room.id)}>
                    {open === room.id ? 'Hide availability' : 'Availability'}
                  </button>
                  <button type="button" className="text-danger" onClick={() => window.confirm(`Delete ${room.name}?`) && onRemoveRoom(room.id)}>
                    Delete
                  </button>
                </div>
              </div>
              {open === room.id && (
                <AvailabilityGrid
                  days={days}
                  slots={slots}
                  value={{ unavailableDays: room.unavailableDays ?? [], unavailableSlots: room.unavailableSlots ?? [] }}
                  onChange={(value) => onUpdateRoom({ ...room, ...value })}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
