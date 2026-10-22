import { formatDateKey, toDateKey, weekdayOf } from '../ops';

interface DateNavProps {
  value: string;
  days: string[];
  onChange: (date: string) => void;
}

const shift = (dateKey: string, by: number) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return toDateKey(new Date(year, month - 1, day + by));
};

/** Step to the previous or next working day (falls back to a plain day step when none is set). */
export const stepWorkingDay = (dateKey: string, days: string[], direction: 1 | -1) => {
  let next = shift(dateKey, direction);
  for (let i = 0; i < 7 && days.length && !days.includes(weekdayOf(next)); i += 1) next = shift(next, direction);
  return next;
};

/** Today when it is a working day, otherwise the next one. */
export const nearestWorkingDay = (days: string[]) => {
  const today = toDateKey(new Date());
  return !days.length || days.includes(weekdayOf(today)) ? today : stepWorkingDay(today, days, 1);
};

export function DateNav({ value, days, onChange }: DateNavProps) {
  const today = toDateKey(new Date());
  return (
    <div className="date-nav">
      <button type="button" className="secondary small" onClick={() => onChange(stepWorkingDay(value, days, -1))} aria-label="Previous day">
        ‹
      </button>
      <input type="date" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />
      <button type="button" className="secondary small" onClick={() => onChange(stepWorkingDay(value, days, 1))} aria-label="Next day">
        ›
      </button>
      {value !== today && (
        <button type="button" className="ghost small" onClick={() => onChange(today)}>
          Today
        </button>
      )}
      <strong className="date-label">{formatDateKey(value)}</strong>
    </div>
  );
}
