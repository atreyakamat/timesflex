import type { BreakRule, InstitutionForm } from '../types';
import { institutionBreaks, slotsFor } from '../utils';

interface InstitutionSetupProps {
  institution: InstitutionForm;
  onUpdate: (institution: InstitutionForm) => void;
  dayOptions: string[];
}

const clampNumber = (value: string, min: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) && value !== '' ? Math.max(min, Math.round(number)) : fallback;
};

export function InstitutionSetup({ institution, onUpdate, dayOptions }: InstitutionSetupProps) {
  const handleChange = <K extends keyof InstitutionForm>(field: K, value: InstitutionForm[K]) => {
    onUpdate({ ...institution, [field]: value });
  };

  // Keep the week in calendar order no matter which order days are toggled in.
  const toggleDay = (day: string) => {
    const selected = new Set(institution.workingDays);
    if (selected.has(day)) selected.delete(day);
    else selected.add(day);
    handleChange(
      'workingDays',
      dayOptions.filter((option) => selected.has(option)),
    );
  };

  const breaks = institutionBreaks(institution);
  const setBreaks = (next: BreakRule[]) =>
    onUpdate({ ...institution, breaks: [...next].sort((a, b) => a.afterSlot - b.afterSlot) });
  const updateBreak = (index: number, patch: Partial<BreakRule>) =>
    setBreaks(breaks.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));

  const slots = slotsFor(institution);
  const timingProblem =
    institution.startTime && institution.endTime && institution.endTime <= institution.startTime
      ? 'End time must be after start time.'
      : slots.length === 0
        ? 'No periods fit between the start and end time. Shorten the periods or the breaks.'
        : '';

  return (
    <section className="card">
      <header>
        <h1>Institution profile</h1>
        <p>Store the base profile once and reuse it for every timetable version.</p>
      </header>
      <div className="form-grid">
        <label>
          Institution name
          <input type="text" value={institution.name} onChange={(event) => handleChange('name', event.target.value)} />
        </label>
        <label>
          Institution type
          <select
            value={institution.type}
            onChange={(event) => handleChange('type', event.target.value as InstitutionForm['type'])}
          >
            <option value="college">College</option>
            <option value="school">School</option>
            <option value="university">University</option>
          </select>
        </label>
        <label>
          Start time
          <input type="time" value={institution.startTime} onChange={(event) => handleChange('startTime', event.target.value)} />
        </label>
        <label>
          End time
          <input type="time" value={institution.endTime} onChange={(event) => handleChange('endTime', event.target.value)} />
        </label>
        <label>
          Period length (minutes)
          <input
            type="number"
            min={15}
            step={5}
            value={institution.slotDurationMinutes}
            onChange={(event) => handleChange('slotDurationMinutes', clampNumber(event.target.value, 15, 60))}
          />
        </label>
      </div>

      <h3>Working days</h3>
      <div className="chip-row">
        {dayOptions.map((day) => (
          <button
            key={day}
            type="button"
            aria-pressed={institution.workingDays.includes(day)}
            className={institution.workingDays.includes(day) ? 'chip active' : 'chip'}
            onClick={() => toggleDay(day)}
          >
            {day}
          </button>
        ))}
      </div>

      <h3>Breaks and lunch</h3>
      <p className="hint">Labs never run across a break. Add as many as the day needs.</p>
      <div className="list">
        {breaks.map((rule, index) => (
          <div key={index} className="list-item">
            <div className="inline-fields">
              <input
                aria-label="Break name"
                type="text"
                value={rule.label}
                onChange={(event) => updateBreak(index, { label: event.target.value })}
              />
              <label className="mini">
                After period
                <input
                  type="number"
                  min={1}
                  value={rule.afterSlot}
                  onChange={(event) => updateBreak(index, { afterSlot: clampNumber(event.target.value, 1, rule.afterSlot) })}
                />
              </label>
              <label className="mini">
                Minutes
                <input
                  type="number"
                  min={5}
                  step={5}
                  value={rule.minutes}
                  onChange={(event) => updateBreak(index, { minutes: clampNumber(event.target.value, 5, rule.minutes) })}
                />
              </label>
              <button
                type="button"
                className="secondary"
                aria-label={`Remove ${rule.label || 'break'}`}
                onClick={() => setBreaks(breaks.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="action-row">
        <button
          type="button"
          className="secondary"
          onClick={() =>
            setBreaks([...breaks, { afterSlot: (breaks.at(-1)?.afterSlot ?? 1) + 2, minutes: 15, label: 'Break' }])
          }
        >
          + Add break
        </button>
        {!breaks.some((rule) => /lunch/i.test(rule.label)) && (
          <button
            type="button"
            className="secondary"
            onClick={() => setBreaks([...breaks, { afterSlot: Math.max(1, Math.ceil(slots.length / 2)), minutes: 45, label: 'Lunch' }])}
          >
            + Add lunch
          </button>
        )}
      </div>

      <h3>Periods</h3>
      {timingProblem ? (
        <p className="text-danger" role="alert">
          {timingProblem}
        </p>
      ) : (
        <div className="chip-row" aria-label="Periods per day">
          {slots.map((slot, index) => (
            <span key={slot} className="chip">
              P{index + 1} · {slot.replace('-', '–')}
            </span>
          ))}
        </div>
      )}

      <h3>Teacher limits</h3>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={Boolean(institution.labCountsAsOne)}
          onChange={(event) => handleChange('labCountsAsOne', event.target.checked)}
        />
        Count a multi-period lab as one lecture toward a teacher's daily and weekly limits
      </label>
      <p className="hint">Off: a 2-period lab counts as 2 lectures.</p>
    </section>
  );
}
