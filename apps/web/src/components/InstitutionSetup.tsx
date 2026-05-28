import type { InstitutionForm } from '../types';

interface InstitutionSetupProps {
  institution: InstitutionForm;
  onUpdate: (institution: InstitutionForm) => void;
  dayOptions: string[];
}

export function InstitutionSetup({ institution, onUpdate, dayOptions }: InstitutionSetupProps) {
  const handleChange = (field: keyof InstitutionForm, value: any) => {
    onUpdate({ ...institution, [field]: value });
  };

  const toggleDay = (day: string) => {
    const workingDays = institution.workingDays.includes(day)
      ? institution.workingDays.filter((value) => value !== day)
      : [...institution.workingDays, day];
    handleChange('workingDays', workingDays);
  };

  return (
    <section className="card">
      <header>
        <h1>Institution profile</h1>
        <p>Store the base profile once and reuse it for every timetable version.</p>
      </header>
      <div className="form-grid">
        <label>
          Institution name
          <input
            type="text"
            value={institution.name}
            onChange={(event) => handleChange('name', event.target.value)}
          />
        </label>
        <label>
          Institution type
          <select
            value={institution.type}
            onChange={(event) => handleChange('type', event.target.value)}
          >
            <option value="college">College</option>
            <option value="school">School</option>
            <option value="university">University</option>
          </select>
        </label>
        <label>
          Start time
          <input
            type="time"
            value={institution.startTime}
            onChange={(event) => handleChange('startTime', event.target.value)}
          />
        </label>
        <label>
          End time
          <input
            type="time"
            value={institution.endTime}
            onChange={(event) => handleChange('endTime', event.target.value)}
          />
        </label>
        <label>
          Slot duration (minutes)
          <input
            type="number"
            min={30}
            value={institution.slotDurationMinutes}
            onChange={(event) => handleChange('slotDurationMinutes', Number(event.target.value))}
          />
        </label>
        <label>
          Break after slots
          <input
            type="number"
            min={1}
            value={institution.breakAfterSlots ?? ''}
            onChange={(event) =>
              handleChange('breakAfterSlots', event.target.value ? Number(event.target.value) : null)
            }
          />
        </label>
        <label>
          Break duration (minutes)
          <input
            type="number"
            min={0}
            value={institution.breakDurationMinutes ?? ''}
            onChange={(event) =>
              handleChange('breakDurationMinutes', event.target.value ? Number(event.target.value) : null)
            }
          />
        </label>
      </div>
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
    </section>
  );
}
