import type { SlotKey } from '../types';
import { slotKey } from '../utils';

export interface Availability {
  unavailableDays: string[];
  unavailableSlots: SlotKey[];
  preferredSlots?: SlotKey[];
}

interface AvailabilityGridProps {
  days: string[];
  slots: string[];
  value: Availability;
  /** Teachers get a third "preferred" state; rooms are just open or closed. */
  withPreference?: boolean;
  onChange: (value: Availability) => void;
}

type CellState = 'open' | 'preferred' | 'blocked';

/**
 * Day x slot grid. Click a cell to cycle open -> preferred -> blocked (or open <-> blocked),
 * click a day header to block or reopen the whole day.
 */
export function AvailabilityGrid({ days, slots, value, withPreference = false, onChange }: AvailabilityGridProps) {
  const preferred = value.preferredSlots ?? [];

  const stateOf = (day: string, slot: string): CellState => {
    const key = slotKey(day, slot);
    if (value.unavailableDays.includes(day) || value.unavailableSlots.includes(key)) return 'blocked';
    return preferred.includes(key) ? 'preferred' : 'open';
  };

  const cycle = (day: string, slot: string) => {
    if (value.unavailableDays.includes(day)) return;
    const key = slotKey(day, slot);
    const current = stateOf(day, slot);
    const next: CellState =
      current === 'open' ? (withPreference ? 'preferred' : 'blocked') : current === 'preferred' ? 'blocked' : 'open';
    onChange({
      unavailableDays: value.unavailableDays,
      unavailableSlots:
        next === 'blocked' ? [...value.unavailableSlots, key] : value.unavailableSlots.filter((item) => item !== key),
      ...(withPreference && {
        preferredSlots: next === 'preferred' ? [...preferred, key] : preferred.filter((item) => item !== key),
      }),
    });
  };

  const toggleDay = (day: string) => {
    const off = value.unavailableDays.includes(day);
    onChange({
      ...value,
      unavailableDays: off ? value.unavailableDays.filter((item) => item !== day) : [...value.unavailableDays, day],
    });
  };

  const labels: Record<CellState, string> = { open: '', preferred: '★', blocked: '✕' };

  return (
    <div className="availability">
      <table>
        <thead>
          <tr>
            <th />
            {days.map((day) => (
              <th key={day}>
                <button
                  type="button"
                  className={value.unavailableDays.includes(day) ? 'day-toggle off' : 'day-toggle'}
                  title={value.unavailableDays.includes(day) ? 'Unavailable all day: click to reopen' : 'Click to block the whole day'}
                  onClick={() => toggleDay(day)}
                >
                  {day.slice(0, 3)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => (
            <tr key={slot}>
              <th>{slot.split('-')[0]}</th>
              {days.map((day) => {
                const state = stateOf(day, slot);
                return (
                  <td key={day}>
                    <button
                      type="button"
                      className={`avail-cell ${state}`}
                      aria-label={`${day} ${slot}: ${state}`}
                      onClick={() => cycle(day, slot)}
                    >
                      {labels[state]}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        Click a cell to {withPreference ? 'mark it preferred (★), then unavailable (✕)' : 'close it (✕)'}; click a day to
        block it entirely.
      </p>
    </div>
  );
}
