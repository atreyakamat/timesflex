import type { Page } from '../App';
import {
  absentTeacherIds,
  currentSlotIndex,
  effectiveTeacher,
  profileItems,
  profileStrength,
  sessionsOnDay,
  toDateKey,
  weekdayOf,
} from '../ops';
import type {
  DivisionForm,
  InstitutionForm,
  OperationsData,
  RoomForm,
  ScheduledSession,
  SubjectForm,
  TeacherForm,
  TimetableRecord,
} from '../types';
import { divisionSize } from '../utils';
import { stepWorkingDay } from './DateNav';

interface OverviewProps {
  institution: InstitutionForm;
  departmentLabel: string;
  days: string[];
  slots: string[];
  divisions: DivisionForm[];
  teachers: TeacherForm[];
  rooms: RoomForm[];
  subjects: SubjectForm[];
  names: Record<string, string>;
  steps: { id: Page; label: string; hint: string; done: boolean }[];
  sessions: ScheduledSession[];
  liveVersion?: TimetableRecord;
  operations: OperationsData;
  onGo: (page: Page) => void;
}

export function Overview({
  institution,
  departmentLabel,
  days,
  slots,
  divisions,
  teachers,
  rooms,
  subjects,
  names,
  steps,
  sessions,
  liveVersion,
  operations,
  onGo,
}: OverviewProps) {
  const hasTimetable = sessions.length > 0;
  const nextStep = steps.find((step) => !step.done);
  const done = steps.filter((step) => step.done).length;

  const today = toDateKey(new Date());
  const weekday = weekdayOf(today);
  const isWorkingDay = days.includes(weekday);
  const todays = sessionsOnDay(sessions, weekday, slots);
  const nextDay = isWorkingDay ? undefined : weekdayOf(stepWorkingDay(today, days, 1));
  const nowIndex = currentSlotIndex(slots, new Date());
  const runningNow = nowIndex >= 0 ? todays.filter(coversNow) : [];
  const absent = absentTeacherIds(operations, today);
  const uncovered = todays.filter(
    (item) => absent.has(item.teacher_id) && effectiveTeacher(item, today, operations.substitutions) === item.teacher_id,
  );

  function coversNow(item: ScheduledSession) {
    const start = slots.indexOf(item.slot);
    return start <= nowIndex && nowIndex < start + item.duration_slots;
  }

  const students = divisions.reduce((sum, item) => sum + divisionSize(item), 0);
  const weeklyPeriods = sessions.reduce((sum, item) => sum + item.duration_slots, 0);
  const items = profileItems({ institution, divisions, teachers, rooms, subjects });
  const strength = profileStrength(items);
  const withRoster = divisions.filter((item) => item.students?.length).length;
  const withContact = teachers.filter((item) => item.email || item.phone).length;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">
            {departmentLabel}
            {institution.academicYear ? ` · ${institution.academicYear}` : ''}
          </p>
          <h1>{institution.name || 'Your institution'}</h1>
        </div>
      </header>

      {!hasTimetable ? (
        <section className="panel hero-panel">
          <div className="hero-panel-text">
            <h2>Your timetable is {Math.round((done / steps.length) * 100)}% set up</h2>
            <p>
              {nextStep
                ? `Next: ${nextStep.label.toLowerCase()} (${nextStep.hint.toLowerCase()}).`
                : 'Everything is in place. Generate it.'}
            </p>
            <button type="button" className="primary large" onClick={() => onGo(nextStep?.id ?? 'timetable')}>
              {nextStep ? `Continue: ${nextStep.label}` : 'Generate timetable'} →
            </button>
          </div>
          <ol className="checklist">
            {steps.map((step) => (
              <li key={step.id} className={step.done ? 'done' : ''}>
                <button type="button" onClick={() => onGo(step.id)}>
                  <span className="step-dot">{step.done ? '✓' : ''}</span>
                  <span>
                    <strong>{step.label}</strong>
                    <small>{step.hint}</small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <section className="panel today-panel">
          <div className="today-head">
            <div>
              <p className="eyebrow">Today · {weekday}</p>
              <h2>
                {!isWorkingDay
                  ? `No classes today${nextDay ? ` · next: ${nextDay}, ${sessionsOnDay(sessions, nextDay, slots).length} sessions` : ''}`
                  : nowIndex >= 0
                    ? `${runningNow.length} class${runningNow.length === 1 ? '' : 'es'} running now`
                    : `${todays.length} sessions today`}
              </h2>
              <p className="muted">
                {liveVersion ? `${liveVersion.label} · ${liveVersion.status === 'approved' ? 'approved' : 'not approved yet'}` : ''}
                {nowIndex >= 0 ? ` · period ${nowIndex + 1}, ${slots[nowIndex].replace('-', '–')}` : ''}
              </p>
            </div>
            <div className="action-row compact">
              <button type="button" className="primary" onClick={() => onGo('today')}>
                Open today
              </button>
              <button type="button" className="secondary" onClick={() => onGo('timetable')}>
                Timetable
              </button>
            </div>
          </div>
          {uncovered.length > 0 && (
            <button type="button" className="alert warn" onClick={() => onGo('substitutions')}>
              {uncovered.length} period(s) today have an absent teacher and no substitute. Arrange cover →
            </button>
          )}
          {isWorkingDay && runningNow.length > 0 && (
            <div className="now-strip">
              {runningNow.map((item) => (
                <div key={item.id} className={`mini-session ${item.kind === 'lab' ? 'lab' : ''}`}>
                  <strong>{names[item.subject_id]}</strong>
                  <span>
                    {names[item.division_id]}
                    {item.batch ? ` ${item.batch}` : ''} · {names[effectiveTeacher(item, today, operations.substitutions)] ?? 'Free'} ·{' '}
                    {names[item.room_id]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="stat-row">
        {[
          [divisions.length, 'Classes', 'classes'],
          [students, 'Students', 'people'],
          [teachers.length, 'Teachers', 'teachers'],
          [rooms.length, 'Rooms & labs', 'rooms'],
          [subjects.length, 'Subjects', 'subjects'],
          [weeklyPeriods, 'Periods / week', 'timetable'],
        ].map(([value, label, target]) => (
          <button key={label as string} type="button" className="stat" onClick={() => onGo(target as Page)}>
            <strong>{value as number}</strong>
            <span>{label as string}</span>
          </button>
        ))}
      </section>

      <section>
        <div className="section-head">
          <h2>Do more with your timetable</h2>
        </div>
        <div className="tool-grid">
          <ToolCard
            title="Send each teacher their timetable"
            text="Share a teacher’s week on WhatsApp or e-mail in one tap."
            meter={teachers.length ? [withContact, teachers.length, 'teachers have contact details'] : undefined}
            action={withContact < teachers.length ? 'Add contacts' : 'Open people'}
            onClick={() => onGo('people')}
          />
          <ToolCard
            title="Arrange substitutes"
            text="Mark a teacher absent and get a ranked list of who is free to cover."
            locked={!hasTimetable}
            action="Substitutions"
            onClick={() => onGo('substitutions')}
          />
          <ToolCard
            title="Find a free room"
            text="See which rooms and labs are empty in any period, and how busy each one is."
            locked={!hasTimetable}
            action="Free rooms"
            onClick={() => onGo('free-rooms')}
          />
          <ToolCard
            title="Take attendance from the timetable"
            text="Each period is already a register. Tap absentees, see who is below 75%."
            meter={divisions.length ? [withRoster, divisions.length, 'classes have a class list'] : undefined}
            locked={!hasTimetable && withRoster >= divisions.length}
            action={withRoster < divisions.length ? 'Add class lists' : 'Attendance'}
            onClick={() => onGo(withRoster < divisions.length ? 'classes' : 'attendance')}
          />
        </div>
      </section>

      <section className="panel">
        <div className="strength-head">
          <div className="ring" style={{ ['--value' as string]: strength }}>
            <span>{strength}%</span>
          </div>
          <div>
            <h2>Profile strength</h2>
            <p className="muted">Optional details that make your timetables and tools better. Add them any time.</p>
          </div>
        </div>
        <div className="strength-list">
          {items.map((item) => (
            <button key={item.id} type="button" className="strength-item" onClick={() => onGo(item.step as Page)}>
              <div className="strength-top">
                <strong>{item.label}</strong>
                <span className="muted small">
                  {item.total ? `${item.done}/${item.total}` : 'n/a'}
                </span>
              </div>
              <div className="bar">
                <div style={{ width: `${item.total ? (item.done / item.total) * 100 : 100}%` }} />
              </div>
              <span className="muted small">{item.unlocks}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ToolCard({
  title,
  text,
  meter,
  locked,
  action,
  onClick,
}: {
  title: string;
  text: string;
  meter?: [number, number, string];
  locked?: boolean;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className={`tool-card ${locked ? 'locked' : ''}`}>
      <h3>{title}</h3>
      <p>{text}</p>
      {meter && (
        <div className="tool-meter">
          <div className="bar">
            <div style={{ width: `${meter[1] ? (meter[0] / meter[1]) * 100 : 0}%` }} />
          </div>
          <span className="muted small">
            {meter[0]} of {meter[1]} {meter[2]}
          </span>
        </div>
      )}
      <button type="button" className="secondary small" onClick={onClick} disabled={locked}>
        {locked ? '🔒 After your first timetable' : `${action} →`}
      </button>
    </div>
  );
}
