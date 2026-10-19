import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DepartmentForm, DivisionForm, InstitutionForm, RoomForm, SubjectForm, TeacherForm } from '../types';
import { batchNames, nextName } from '../naming';
import { breaksAfter, buildSlots, createId, hasExpertise } from '../utils';
import { FluidBackground } from './FluidBackground';
import { Stepper } from './Stepper';

/**
 * Guided first setup: one question per screen, big targets, sensible defaults.
 * Everything writes straight into the institution profile (which autosaves),
 * so leaving half way loses nothing and the regular pages show the same data.
 */

const DAY_OPTIONS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOUR_PRESETS: [string, string][] = [
  ['08:00', '14:00'],
  ['09:00', '16:00'],
  ['09:00', '17:00'],
  ['10:00', '17:00'],
];
const YEARS = ['First year', 'Second year', 'Third year', 'Fourth year'];

type StepId = 'days' | 'hours' | 'periods' | 'break' | 'department' | 'classes' | 'teachers' | 'rooms' | 'subjects' | 'review';

const STEPS: { id: StepId; title: string }[] = [
  { id: 'days', title: 'Days' },
  { id: 'hours', title: 'Hours' },
  { id: 'periods', title: 'Periods' },
  { id: 'break', title: 'Break' },
  { id: 'department', title: 'Department' },
  { id: 'classes', title: 'Classes' },
  { id: 'teachers', title: 'Teachers' },
  { id: 'rooms', title: 'Rooms' },
  { id: 'subjects', title: 'Subjects' },
  { id: 'review', title: 'Review' },
];

const splitTags = (value: string) => [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];

interface SetupWizardProps {
  institution: InstitutionForm;
  department: DepartmentForm;
  divisions: DivisionForm[];
  teachers: TeacherForm[];
  rooms: RoomForm[];
  subjects: SubjectForm[];
  problems: string[];
  busy: boolean;
  onInstitution: (institution: InstitutionForm) => void;
  onDepartment: (department: DepartmentForm) => void;
  onDivisions: (divisions: DivisionForm[]) => void;
  onTeachers: (teachers: TeacherForm[]) => void;
  onRooms: (rooms: RoomForm[]) => void;
  onSubjects: (subjects: SubjectForm[]) => void;
  /** Generates and resolves to a one-line result, e.g. "All 48 sessions placed." */
  onGenerate: () => Promise<string>;
  onExit: (target: 'overview' | 'timetable') => void;
}

export function SetupWizard(props: SetupWizardProps) {
  const { institution, department, divisions, teachers, rooms, subjects, onInstitution } = props;
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState('');
  const step = STEPS[index];
  const card = useRef<HTMLDivElement>(null);

  // Move focus to the first field of each new question, for keyboard and screen-reader users.
  useEffect(() => {
    card.current?.querySelector<HTMLElement>('input, button.tile, button.chip')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [index]);

  const slots = buildSlots(
    institution.startTime,
    institution.endTime,
    institution.slotDurationMinutes,
    institution.breakAfterSlots,
    institution.breakDurationMinutes,
  );
  const slotsWithoutBreak = buildSlots(institution.startTime, institution.endTime, institution.slotDurationMinutes, null, null);

  const canContinue: Record<StepId, boolean> = {
    days: institution.workingDays.length > 0,
    hours: slotsWithoutBreak.length > 0,
    periods: slots.length > 0,
    break: slots.length > 0,
    department: department.name.trim().length > 0,
    classes: divisions.length > 0,
    teachers: teachers.length > 0,
    rooms: rooms.length > 0,
    subjects: subjects.length > 0,
    review: true,
  };

  const go = (delta: number) => setIndex((value) => Math.min(STEPS.length - 1, Math.max(0, value + delta)));
  const jump = (id: StepId) => setIndex(STEPS.findIndex((item) => item.id === id));

  const generate = async () => {
    setResult(await props.onGenerate());
  };

  return (
    <div className="wizard">
      <FluidBackground />
      <header className="wizard-bar">
        <div className="brand static">
          <div className="brand-mark">TF</div>
          <div>
            <strong>Set up {institution.name || 'your timetable'}</strong>
            <span>
              Step {index + 1} of {STEPS.length} · {step.title}
            </span>
          </div>
        </div>
        <button type="button" className="ghost small" onClick={() => props.onExit('overview')}>
          Save & exit
        </button>
      </header>
      <div className="wizard-progress" aria-hidden="true">
        {STEPS.map((item, i) => (
          <button
            key={item.id}
            type="button"
            tabIndex={-1}
            className={i < index ? 'done' : i === index ? 'current' : ''}
            onClick={() => i < index && setIndex(i)}
            title={item.title}
          />
        ))}
      </div>

      <main
        className="wizard-stage"
        onKeyDown={(event) => {
          const target = event.target as HTMLElement;
          // Enter moves on, except inside "add one" forms where Enter adds the item.
          if (event.key === 'Enter' && !target.closest('.composer') && target.tagName !== 'BUTTON' && canContinue[step.id] && step.id !== 'review') {
            event.preventDefault();
            go(1);
          }
        }}
      >
        <div key={step.id} ref={card} className="question glass">
          {step.id === 'days' && (
            <Question title="Which days do you teach?" hint="Tap to switch a day on or off.">
              <div className="tile-grid days">
                {DAY_OPTIONS.map((day) => {
                  const on = institution.workingDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      className={`tile ${on ? 'active' : ''}`}
                      aria-pressed={on}
                      onClick={() =>
                        onInstitution({
                          ...institution,
                          workingDays: on
                            ? institution.workingDays.filter((value) => value !== day)
                            : DAY_OPTIONS.filter((value) => value === day || institution.workingDays.includes(value)),
                        })
                      }
                    >
                      <strong>{day.slice(0, 3)}</strong>
                      <span>{day}</span>
                    </button>
                  );
                })}
              </div>
              <div className="chip-row center">
                <button type="button" className="chip" onClick={() => onInstitution({ ...institution, workingDays: DAY_OPTIONS.slice(0, 5) })}>
                  Monday to Friday
                </button>
                <button type="button" className="chip" onClick={() => onInstitution({ ...institution, workingDays: DAY_OPTIONS })}>
                  Monday to Saturday
                </button>
              </div>
            </Question>
          )}

          {step.id === 'hours' && (
            <Question title="When does the teaching day start and end?" hint="Pick a common one or set your own.">
              <div className="chip-row center">
                {HOUR_PRESETS.map(([start, end]) => (
                  <button
                    key={start + end}
                    type="button"
                    className={`chip ${institution.startTime === start && institution.endTime === end ? 'active' : ''}`}
                    onClick={() => onInstitution({ ...institution, startTime: start, endTime: end })}
                  >
                    {start} – {end}
                  </button>
                ))}
              </div>
              <div className="time-pair">
                <label>
                  Starts
                  <input type="time" value={institution.startTime} onChange={(e) => onInstitution({ ...institution, startTime: e.target.value })} />
                </label>
                <span className="muted">to</span>
                <label>
                  Ends
                  <input type="time" value={institution.endTime} onChange={(e) => onInstitution({ ...institution, endTime: e.target.value })} />
                </label>
              </div>
              {!canContinue.hours && <p className="text-warning center">The day must end after it starts.</p>}
            </Question>
          )}

          {step.id === 'periods' && (
            <Question title="How long is one period?" hint="Labs can take two or more periods back to back.">
              <div className="chip-row center">
                {[40, 45, 50, 55, 60].map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    className={`chip big ${institution.slotDurationMinutes === minutes ? 'active' : ''}`}
                    onClick={() => onInstitution({ ...institution, slotDurationMinutes: minutes })}
                  >
                    {minutes} min
                  </button>
                ))}
              </div>
              <div className="center-row">
                <Stepper
                  label="Or exactly"
                  value={institution.slotDurationMinutes}
                  min={20}
                  max={180}
                  step={5}
                  unit="min"
                  onChange={(value) => onInstitution({ ...institution, slotDurationMinutes: value })}
                />
              </div>
              <p className="answer">
                That gives <strong>{slotsWithoutBreak.length}</strong> periods a day.
              </p>
            </Question>
          )}

          {step.id === 'break' && (
            <Question title="Is there a break or lunch?" hint="No class is ever split by it.">
              <div className="segmented wide">
                <button
                  type="button"
                  className={institution.breakAfterSlots ? 'active' : ''}
                  onClick={() =>
                    onInstitution({
                      ...institution,
                      breakAfterSlots: institution.breakAfterSlots ?? Math.max(1, Math.floor(slotsWithoutBreak.length / 2)),
                      breakDurationMinutes: institution.breakDurationMinutes || 30,
                    })
                  }
                >
                  Yes, one break
                </button>
                <button
                  type="button"
                  className={!institution.breakAfterSlots ? 'active' : ''}
                  onClick={() => onInstitution({ ...institution, breakAfterSlots: null, breakDurationMinutes: null })}
                >
                  No break
                </button>
              </div>
              {institution.breakAfterSlots ? (
                <div className="question-grid">
                  <Stepper
                    label="After period"
                    value={institution.breakAfterSlots}
                    min={1}
                    max={Math.max(1, slotsWithoutBreak.length - 1)}
                    onChange={(value) => onInstitution({ ...institution, breakAfterSlots: value })}
                  />
                  <div className="stepper">
                    <span className="stepper-label">Length</span>
                    <div className="chip-row">
                      {[15, 20, 30, 45, 60].map((minutes) => (
                        <button
                          key={minutes}
                          type="button"
                          className={`chip ${institution.breakDurationMinutes === minutes ? 'active' : ''}`}
                          onClick={() => onInstitution({ ...institution, breakDurationMinutes: minutes })}
                        >
                          {minutes} min
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
              <DayPreview slots={slots} />
            </Question>
          )}

          {step.id === 'department' && (
            <Question title="Which department is this timetable for?" hint="You can add more years later.">
              <label>
                Department or course
                <input
                  type="text"
                  value={department.name}
                  placeholder="e.g. Computer Engineering"
                  onChange={(e) => props.onDepartment({ ...department, name: e.target.value })}
                />
              </label>
              <span className="field-label">Year</span>
              <div className="chip-row">
                {YEARS.map((year) => (
                  <button
                    key={year}
                    type="button"
                    className={`chip ${department.yearLabel === year ? 'active' : ''}`}
                    onClick={() => props.onDepartment({ ...department, yearLabel: year })}
                  >
                    {year}
                  </button>
                ))}
              </div>
              <span className="field-label">Semester</span>
              <div className="chip-row">
                {Array.from({ length: 8 }, (_, i) => `Semester ${i + 1}`).map((semester) => (
                  <button
                    key={semester}
                    type="button"
                    className={`chip ${department.semesterLabel === semester ? 'active' : ''}`}
                    onClick={() => props.onDepartment({ ...department, semesterLabel: semester })}
                  >
                    {semester.replace('Semester ', 'Sem ')}
                  </button>
                ))}
              </div>
            </Question>
          )}

          {step.id === 'classes' && <ClassesStep {...props} />}
          {step.id === 'teachers' && <TeachersStep {...props} />}
          {step.id === 'rooms' && <RoomsStep {...props} />}
          {step.id === 'subjects' && <SubjectsStep {...props} />}

          {step.id === 'review' && (
            <Question title={result ? 'Your timetable is ready' : 'Ready to build your timetable'} hint={result || 'Here is what TimeFlex will schedule.'}>
              <div className="review-grid">
                {[
                  [`${institution.workingDays.length} × ${slots.length}`, 'days × periods', 'days'],
                  [divisions.length, 'classes', 'classes'],
                  [teachers.length, 'teachers', 'teachers'],
                  [rooms.length, 'rooms & labs', 'rooms'],
                  [subjects.length, 'subjects', 'subjects'],
                ].map(([value, label, target]) => (
                  <button key={label as string} type="button" className="review-tile" onClick={() => jump(target as StepId)}>
                    <strong>{value}</strong>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              {props.problems.length > 0 && (
                <div className="alert warn block">
                  <h3>Fix these first</h3>
                  <ul>
                    {props.problems.map((problem) => (
                      <li key={problem}>{problem.replace(/ \([^)]*\)\.?$/, '.')}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="action-row center">
                {result ? (
                  <button type="button" className="primary large glow" onClick={() => props.onExit('timetable')}>
                    See the timetable →
                  </button>
                ) : (
                  <button type="button" className="primary large glow" onClick={generate} disabled={props.busy || props.problems.length > 0}>
                    {props.busy ? 'Building your timetable…' : 'Generate my timetable'}
                  </button>
                )}
              </div>
            </Question>
          )}
        </div>
      </main>

      <footer className="wizard-nav">
        <button type="button" className="secondary" onClick={() => go(-1)} disabled={index === 0}>
          ← Back
        </button>
        {step.id !== 'review' && (
          <button type="button" className="primary" onClick={() => go(1)} disabled={!canContinue[step.id]}>
            {index === STEPS.length - 2 ? 'Review' : 'Continue'} →
          </button>
        )}
      </footer>
    </div>
  );
}

function Question({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <>
      <h1>{title}</h1>
      {hint && <p className="question-hint">{hint}</p>}
      <div className="question-body">{children}</div>
    </>
  );
}

function DayPreview({ slots }: { slots: string[] }) {
  const breaks = breaksAfter(slots);
  return (
    <div className="day-preview center">
      {slots.map((slot, index) => (
        <span key={slot} className="day-preview-item">
          <span className="period">
            <small>P{index + 1}</small>
            {slot.split('-')[0]}
          </span>
          {breaks.has(index) && <span className="period break">Break</span>}
        </span>
      ))}
    </div>
  );
}

/** The list under an "add one" form: what has been added so far, each removable. */
function Added<T extends { id: string; name: string }>({
  items,
  describe,
  onRemove,
  empty,
}: {
  items: T[];
  describe: (item: T) => string;
  onRemove: (id: string) => void;
  empty: string;
}) {
  if (!items.length) return <p className="added-empty">{empty}</p>;
  return (
    <ul className="added">
      {items.map((item) => (
        <li key={item.id}>
          <span>
            <strong>{item.name}</strong>
            <small>{describe(item)}</small>
          </span>
          <button type="button" className="icon-button" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.id)}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

function ClassesStep({ divisions, department, onDivisions }: SetupWizardProps) {
  const [name, setName] = useState('');
  const [size, setSize] = useState(60);
  const [batches, setBatches] = useState(2);
  const input = useRef<HTMLInputElement>(null);
  const last = divisions[divisions.length - 1];
  const suggestion = last ? nextName(last.name) : null;

  const add = (value = name) => {
    const clean = value.trim();
    if (!clean || divisions.some((item) => item.name.toLowerCase() === clean.toLowerCase())) return;
    onDivisions([
      ...divisions,
      {
        id: createId(),
        name: clean,
        size,
        batches: batches ? batchNames(clean, batches) : [],
        yearLabel: [department.yearLabel, department.semesterLabel].filter(Boolean).join(' · '),
      },
    ]);
    setName('');
    input.current?.focus();
  };

  return (
    <Question title="Add your classes, one at a time" hint="Each class (division) gets its own timetable. Lab batches let practicals run in parallel.">
      <div className="composer">
        <label>
          Class name
          <input
            ref={input}
            type="text"
            value={name}
            placeholder={suggestion ?? 'e.g. SE-A'}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          />
        </label>
        <div className="question-grid">
          <Stepper label="Students" value={size} min={1} max={400} step={5} onChange={setSize} />
          <div className="stepper">
            <span className="stepper-label">Lab batches</span>
            <div className="segmented">
              {[0, 2, 3, 4].map((count) => (
                <button key={count} type="button" className={batches === count ? 'active' : ''} onClick={() => setBatches(count)}>
                  {count || 'None'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="composer-actions">
          <button type="button" className="primary" onClick={() => add()} disabled={!name.trim()}>
            Add class
          </button>
          {suggestion && !name && (
            <button type="button" className="chip" onClick={() => add(suggestion)}>
              + {suggestion}
            </button>
          )}
        </div>
      </div>
      <Added
        items={divisions}
        empty="No classes yet."
        describe={(item) => `${item.size || '?'} students · ${item.batches.length ? `batches ${item.batches.join(', ')}` : 'no lab batches'}`}
        onRemove={(id) => onDivisions(divisions.filter((item) => item.id !== id))}
      />
    </Question>
  );
}

function TeachersStep({ teachers, onTeachers }: SetupWizardProps) {
  const [name, setName] = useState('');
  const [expertise, setExpertise] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const add = () => {
    const clean = name.trim();
    if (!clean) return;
    onTeachers([
      ...teachers,
      {
        id: createId(),
        name: clean,
        maxLecturesPerDay: 4,
        maxLecturesPerWeek: 18,
        unavailableDays: [],
        canTeachLabs: true,
        ...(splitTags(expertise).length ? { expertise: splitTags(expertise) } : {}),
      },
    ]);
    setName('');
    setExpertise('');
    input.current?.focus();
  };

  return (
    <Question title="Who teaches? Add them one by one" hint="Expertise helps TimeFlex suggest the right teacher for each subject. Limits and contacts can be added later in their profile.">
      <div className="composer">
        <label>
          Name
          <input
            ref={input}
            type="text"
            value={name}
            placeholder="e.g. Prof. Anita Mehta"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          />
        </label>
        <label>
          Expertise <small className="muted">optional, comma separated</small>
          <input
            type="text"
            value={expertise}
            placeholder="e.g. Databases, Operating Systems"
            onChange={(e) => setExpertise(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          />
        </label>
        <div className="composer-actions">
          <button type="button" className="primary" onClick={add} disabled={!name.trim()}>
            Add teacher
          </button>
        </div>
      </div>
      <Added
        items={teachers}
        empty="No teachers yet."
        describe={(item) => (item.expertise?.length ? item.expertise.join(', ') : 'No expertise added')}
        onRemove={(id) => onTeachers(teachers.filter((item) => item.id !== id))}
      />
    </Question>
  );
}

function RoomsStep({ rooms, onRooms }: SetupWizardProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<RoomForm['type']>('classroom');
  const [capacity, setCapacity] = useState(60);
  const input = useRef<HTMLInputElement>(null);
  const last = rooms[rooms.length - 1];
  const suggestion = last ? nextName(last.name) : null;

  const add = (value = name) => {
    const clean = value.trim();
    if (!clean || rooms.some((item) => item.name.toLowerCase() === clean.toLowerCase())) return;
    onRooms([...rooms, { id: createId(), name: clean, type, capacity, equipment: '' }]);
    setName('');
    input.current?.focus();
  };

  return (
    <Question title="Where do classes happen?" hint="Add classrooms and labs. Rooms are picked automatically so each class fits.">
      <div className="composer">
        <label>
          Room name
          <input
            ref={input}
            type="text"
            value={name}
            placeholder={suggestion ?? 'e.g. Room 101 or Lab 1'}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          />
        </label>
        <div className="question-grid">
          <div className="stepper">
            <span className="stepper-label">Type</span>
            <div className="segmented">
              {(
                [
                  ['classroom', 'Classroom'],
                  ['lab', 'Lab'],
                  ['seminar-hall', 'Hall'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={type === value ? 'active' : ''}
                  onClick={() => {
                    setType(value);
                    setCapacity(value === 'lab' ? 30 : value === 'seminar-hall' ? 120 : 60);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Stepper label="Seats" value={capacity} min={1} max={500} step={5} onChange={setCapacity} />
        </div>
        <div className="composer-actions">
          <button type="button" className="primary" onClick={() => add()} disabled={!name.trim()}>
            Add room
          </button>
          {suggestion && !name && (
            <button type="button" className="chip" onClick={() => add(suggestion)}>
              + {suggestion}
            </button>
          )}
        </div>
      </div>
      <Added
        items={rooms}
        empty="No rooms yet."
        describe={(item) => `${item.type === 'seminar-hall' ? 'hall' : item.type} · ${item.capacity} seats`}
        onRemove={(id) => onRooms(rooms.filter((item) => item.id !== id))}
      />
    </Question>
  );
}

function SubjectsStep({ subjects, teachers, divisions, onSubjects }: SetupWizardProps) {
  const [name, setName] = useState('');
  const [isLab, setIsLab] = useState(false);
  const [perWeek, setPerWeek] = useState(3);
  const [length, setLength] = useState(1);
  const [teacherId, setTeacherId] = useState('');
  const [classes, setClasses] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  // Teachers whose expertise matches the typed subject come first.
  const ordered = [...teachers].sort(
    (a, b) => Number(hasExpertise(b, name)) - Number(hasExpertise(a, name)) || a.name.localeCompare(b.name),
  );
  const chosenClasses = classes.length ? classes : divisions.map((item) => item.id);

  const add = () => {
    const clean = name.trim();
    if (!clean || !teacherId) return;
    onSubjects([
      ...subjects,
      {
        id: createId(),
        name: clean,
        isLab,
        durationSlots: isLab ? length : 1,
        sessionsPerWeek: perWeek,
        teacherId,
        roomId: '',
        divisionIds: chosenClasses.length === divisions.length ? [] : chosenClasses,
        teacherOverrides: {},
      },
    ]);
    setName('');
    setTeacherId('');
    setClasses([]);
    input.current?.focus();
  };

  const toggleClass = (id: string) => {
    const next = chosenClasses.includes(id) ? chosenClasses.filter((value) => value !== id) : [...chosenClasses, id];
    setClasses(next.length ? next : chosenClasses);
  };

  return (
    <Question title="What is taught, and by whom?" hint="One subject at a time. Labs run once for each lab batch.">
      <div className="composer">
        <label>
          Subject
          <input
            ref={input}
            type="text"
            value={name}
            placeholder="e.g. Operating Systems"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          />
        </label>
        <div className="question-grid">
          <div className="stepper">
            <span className="stepper-label">Kind</span>
            <div className="segmented">
              <button
                type="button"
                className={!isLab ? 'active' : ''}
                onClick={() => {
                  setIsLab(false);
                  setPerWeek(3);
                  setLength(1);
                }}
              >
                Lecture
              </button>
              <button
                type="button"
                className={isLab ? 'active' : ''}
                onClick={() => {
                  setIsLab(true);
                  setPerWeek(1);
                  setLength(2);
                }}
              >
                Lab
              </button>
            </div>
          </div>
          <Stepper label="Times a week" value={perWeek} min={1} max={12} onChange={setPerWeek} />
          {isLab && <Stepper label="Periods each" value={length} min={1} max={4} onChange={setLength} />}
        </div>
        <span className="field-label">Taught by</span>
        <div className="chip-row">
          {ordered.map((teacher) => (
            <button
              key={teacher.id}
              type="button"
              className={`chip ${teacherId === teacher.id ? 'active' : ''}`}
              onClick={() => setTeacherId(teacher.id)}
              aria-pressed={teacherId === teacher.id}
            >
              {name && hasExpertise(teacher, name) ? '★ ' : ''}
              {teacher.name}
            </button>
          ))}
        </div>
        {divisions.length > 1 && (
          <>
            <span className="field-label">For classes</span>
            <div className="chip-row">
              {divisions.map((division) => (
                <button
                  key={division.id}
                  type="button"
                  className={`chip ${chosenClasses.includes(division.id) ? 'active' : ''}`}
                  onClick={() => toggleClass(division.id)}
                  aria-pressed={chosenClasses.includes(division.id)}
                >
                  {division.name}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="composer-actions">
          <button type="button" className="primary" onClick={add} disabled={!name.trim() || !teacherId}>
            Add subject
          </button>
          {name.trim() && !teacherId && <span className="muted small">Pick who teaches it.</span>}
        </div>
      </div>
      <Added
        items={subjects}
        empty="No subjects yet."
        describe={(item) => {
          const teacher = teachers.find((t) => t.id === item.teacherId)?.name ?? 'no teacher';
          const forWhom = item.divisionIds?.length
            ? divisions.filter((d) => item.divisionIds!.includes(d.id)).map((d) => d.name).join(', ')
            : 'all classes';
          return `${item.isLab ? `Lab, ${item.durationSlots} periods` : 'Lecture'} · ${item.sessionsPerWeek}/week · ${teacher} · ${forWhom}`;
        }}
        onRemove={(id) => onSubjects(subjects.filter((item) => item.id !== id))}
      />
    </Question>
  );
}
