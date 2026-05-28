import { useState } from 'react';
import type { RoomForm } from '../types';
import { createId } from '../utils';

interface RoomSetupProps {
  rooms: RoomForm[];
  onAddRoom: (room: RoomForm) => void;
  onRemoveRoom: (id: string) => void;
}

export function RoomSetup({ rooms, onAddRoom, onRemoveRoom }: RoomSetupProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<RoomForm['type']>('classroom');
  const [capacity, setCapacity] = useState(40);

  const handleAdd = () => {
    if (!name) return;
    onAddRoom({
      id: createId(),
      name,
      type,
      capacity,
    });
    setName('');
  };

  return (
    <section className="card">
      <header>
        <h1>Rooms and labs</h1>
        <p>Define room capacity and lab resources for practicals.</p>
      </header>
      <div className="inline-form">
        <input
          type="text"
          placeholder="Room name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as RoomForm['type'])}
        >
          <option value="classroom">Classroom</option>
          <option value="lab">Lab</option>
          <option value="seminar-hall">Seminar hall</option>
        </select>
        <input
          type="number"
          placeholder="Capacity"
          value={capacity}
          onChange={(e) => setCapacity(Number(e.target.value))}
          min={10}
        />
        <button type="button" onClick={handleAdd}>
          Add room
        </button>
      </div>
      <div className="list">
        {rooms.map((room) => (
          <div key={room.id} className="list-item">
            <div className="list-content">
              <strong>{room.name}</strong>
              <span>
                {room.type} · {room.capacity} seats
              </span>
            </div>
            <button
              type="button"
              className="text-danger"
              onClick={() => onRemoveRoom(room.id)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
