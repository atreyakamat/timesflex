const modules = [
  'Institution profile',
  'Academic structure',
  'Teachers and staff',
  'Rooms and labs',
  'Constraint solver',
  'Manual timetable editing',
];

const timetableTypes = [
  'Class timetable',
  'Teacher timetable',
  'Room timetable',
  'Lab timetable',
  'Staff duty timetable',
  'Exam timetable',
];

export function App() {
  return (
    <div className="app-shell">
      <section className="hero">
        <div className="eyebrow">TimeFlex Enterprise Scheduling</div>
        <h1>Build once. Reuse everywhere. Schedule without collisions.</h1>
        <p>
          TimeFlex is designed for institutions that need one source of truth for
          classes, teachers, rooms, labs, events, and timetable variants.
        </p>
        <div className="hero-actions">
          <button type="button" className="primary-button">
            Start department setup
          </button>
          <button type="button" className="secondary-button">
            Review scheduling rules
          </button>
        </div>
      </section>

      <section className="grid two-column">
        <article className="panel">
          <h2>MVP focus</h2>
          <p>
            One college department timetable generator with divisions, teachers,
            subjects, rooms, labs, breaks, and PDF export.
          </p>
          <ul>
            {modules.map((module) => (
              <li key={module}>{module}</li>
            ))}
          </ul>
        </article>

        <article className="panel accent-panel">
          <h2>Supported timetable views</h2>
          <div className="chips">
            {timetableTypes.map((type) => (
              <span key={type} className="chip">
                {type}
              </span>
            ))}
          </div>
        </article>
      </section>

      <section className="grid three-column">
        <article className="metric-card">
          <span className="metric-label">Solver</span>
          <strong>OR-Tools</strong>
          <p>Hard constraints first, soft preferences second.</p>
        </article>
        <article className="metric-card">
          <span className="metric-label">API</span>
          <strong>Node.js</strong>
          <p>CRUD, orchestration, export jobs, and session persistence.</p>
        </article>
        <article className="metric-card">
          <span className="metric-label">Web</span>
          <strong>React</strong>
          <p>Forms, drag-and-drop editing, and timetable visualization.</p>
        </article>
      </section>
    </div>
  );
}
