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
    onAddRoom({ id: createId(), name: name.trim(), type, capacity, equipment: '' });
    setName('');
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Step 4 · Rooms & labs</p>
          <h1>Where does teaching happen?</h1>
          <p>
            Subjects without a fixed room go to any free room of the right type that seats the class. Close a room for times
            it is not available.
          </p>
        </div>
      </header>
      <section className="panel">
      <h2>Add a room</h2>
      <div className="inline-form">
        <label className="grow">
          Name
          <input type="text" placeholder="e.g. Room 101 or Lab 1" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="mini wide">
          Type
          <select value={type} onChange={(e) => setType(e.target.value as RoomForm['type'])}>
            <option value="classroom">Classroom</option>
            <option value="lab">Lab</option>
            <option value="seminar-hall">Seminar hall</option>
          </select>
        </label>
        <label className="mini">
          Seats
          <input type="number" value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} min={1} />
        </label>
        <button type="button" className="primary" onClick={handleAdd} disabled={!name.trim()}>
          Add
        </button>
      </div>
      </section>
      {rooms.length === 0 && <div className="empty">No rooms yet. Add at least one classroom, plus a lab if you have practicals.</div>}
      <div className="list">
        {rooms.map((room) => {
          const closed = (room.unavailableDays?.length ?? 0) + (room.unavailableSlots?.length ?? 0);
          return (
            <div key={room.id} className="list-item stacked">
              <div className="list-row">
                <div className="list-content">
                  <strong>
                    {room.name}
                    <span className={`tag ${room.type === 'lab' ? 'lab' : ''}`}>{room.type.replace('-', ' ')}</span>
                  </strong>
                  <span>
                    {room.capacity} seats
                    {room.building ? ` · ${room.building}${room.floor ? `, floor ${room.floor}` : ''}` : ''}
                    {closed ? ` · ${closed} closed` : ''}
                  </span>
                </div>
                <div className="inline-fields">
                  <label className="mini wide">
                    Type
                    <select value={room.type} onChange={(e) => onUpdateRoom({ ...room, type: e.target.value as RoomForm['type'] })}>
                      <option value="classroom">Classroom</option>
                      <option value="lab">Lab</option>
                      <option value="seminar-hall">Seminar hall</option>
                    </select>
                  </label>
                  <label className="mini">
                    Seats
                    <input
                      type="number"
                      min={1}
                      value={room.capacity}
                      onChange={(e) => onUpdateRoom({ ...room, capacity: Math.max(1, Number(e.target.value)) })}
                    />
                  </label>
                  <label className="mini wide">
                    Building
                    <input
                      type="text"
                      placeholder="optional"
                      value={room.building ?? ''}
                      onChange={(e) => onUpdateRoom({ ...room, building: e.target.value })}
                    />
                  </label>
                  <label className="mini">
                    Floor
                    <input type="text" value={room.floor ?? ''} onChange={(e) => onUpdateRoom({ ...room, floor: e.target.value })} />
                  </label>
                  {room.type === 'lab' && (
                    <label className="mini wide">
                      Equipment / software
                      <input
                        type="text"
                        className="equipment"
                        placeholder="e.g. 30 PCs, MySQL"
                        value={room.equipment ?? ''}
                        onChange={(e) => onUpdateRoom({ ...room, equipment: e.target.value })}
                      />
                    </label>
                  )}
                  <button type="button" className="secondary small" onClick={() => setOpen(open === room.id ? null : room.id)}>
                    {open === room.id ? 'Hide availability' : 'Availability'}
                  </button>
                  <button type="button" className="ghost small danger-text" onClick={() => onRemoveRoom(room.id)}>
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
    </div>
  );
}
