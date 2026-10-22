import type { InstitutionForm } from '../types';
import { breaksAfter } from '../utils';

interface InstitutionSetupProps {
  institution: InstitutionForm;
  onUpdate: (institution: InstitutionForm) => void;
  dayOptions: string[];
  slots: string[];
}

export function InstitutionSetup({ institution, onUpdate, dayOptions, slots }: InstitutionSetupProps) {
  const handleChange = <K extends keyof InstitutionForm>(field: K, value: InstitutionForm[K]) => {
    onUpdate({ ...institution, [field]: value });
  };

  const toggleDay = (day: string) => {
    const workingDays = institution.workingDays.includes(day)
      ? institution.workingDays.filter((value) => value !== day)
      : dayOptions.filter((value) => value === day || institution.workingDays.includes(value));
    handleChange('workingDays', workingDays);
  };

  const breaks = breaksAfter(slots);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Step 1 · Basics</p>
          <h1>When does teaching happen?</h1>
          <p>Working days, hours, period length and the break. Every timetable uses these.</p>
        </div>
      </header>

      <section className="panel">
        <div className="form-grid">
          <label>
            Institution name
            <input type="text" value={institution.name} onChange={(event) => handleChange('name', event.target.value)} />
          </label>
          <label>
            Type
            <select
              value={institution.type}
              onChange={(event) => handleChange('type', event.target.value as InstitutionForm['type'])}
            >
              <option value="college">College</option>
              <option value="school">School</option>
              <option value="university">University</option>
            </select>
          </label>
        </div>

        <p className="field-label">Working days</p>
        <div className="chip-row">
          {dayOptions.map((day) => (
            <button
              key={day}
              type="button"
              className={institution.workingDays.includes(day) ? 'chip active' : 'chip'}
              onClick={() => toggleDay(day)}
            >
              {day}
            </button>
          ))}
        </div>

        <div className="form-grid">
          <label>
            Day starts
            <input type="time" value={institution.startTime} onChange={(event) => handleChange('startTime', event.target.value)} />
          </label>
          <label>
            Day ends
            <input type="time" value={institution.endTime} onChange={(event) => handleChange('endTime', event.target.value)} />
          </label>
          <label>
            Period length (minutes)
            <input
              type="number"
              min={30}
              step={5}
              value={institution.slotDurationMinutes}
              onChange={(event) => handleChange('slotDurationMinutes', Number(event.target.value))}
            />
          </label>
          <label>
            Break after period
            <input
              type="number"
              min={1}
              value={institution.breakAfterSlots ?? ''}
              placeholder="No break"
              onChange={(event) => handleChange('breakAfterSlots', event.target.value ? Number(event.target.value) : null)}
            />
          </label>
          <label>
            Break length (minutes)
            <input
              type="number"
              min={0}
              step={5}
              value={institution.breakDurationMinutes ?? ''}
              placeholder="0"
              onChange={(event) =>
                handleChange('breakDurationMinutes', event.target.value ? Number(event.target.value) : null)
              }
            />
          </label>
        </div>

        <p className="field-label">
          Your day: {slots.length} periods × {institution.workingDays.length} days ={' '}
          {slots.length * institution.workingDays.length} periods a week
        </p>
        <div className="day-preview">
          {slots.length === 0 && <span className="muted">These hours give no periods. Check the start and end times.</span>}
          {slots.map((slot, index) => (
            <span key={slot} className="day-preview-item">
              <span className="period">
                <small>P{index + 1}</small>
                {slot.replace('-', '–')}
              </span>
              {breaks.has(index) && <span className="period break">Break</span>}
            </span>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Printed on your timetables</h2>
        <p className="muted">Optional. Shown in the header of every PDF and Excel export.</p>
        <div className="form-grid">
          <label>
            Academic year
            <input
              type="text"
              placeholder="e.g. 2026-27"
              value={institution.academicYear ?? ''}
              onChange={(event) => handleChange('academicYear', event.target.value)}
            />
          </label>
          <label>
            Address / campus
            <input
              type="text"
              placeholder="City or campus"
              value={institution.address ?? ''}
              onChange={(event) => handleChange('address', event.target.value)}
            />
          </label>
          <label>
            Office e-mail
            <input
              type="email"
              value={institution.contactEmail ?? ''}
              onChange={(event) => handleChange('contactEmail', event.target.value)}
            />
          </label>
          <label>
            Office phone
            <input
              type="tel"
              value={institution.contactPhone ?? ''}
              onChange={(event) => handleChange('contactPhone', event.target.value)}
            />
          </label>
        </div>
      </section>
    </div>
  );
}
