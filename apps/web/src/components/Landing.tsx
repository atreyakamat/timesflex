import { lazy, Suspense } from 'react';
import type { ResolvedTheme } from '../theme';
import { FluidBackground } from './FluidBackground';
import { ThemeToggle } from './ThemeToggle';

const Campus3D = lazy(() => import('./Campus3D'));

interface LandingProps {
  theme: ResolvedTheme;
  onToggleTheme: (event: { clientX: number; clientY: number }) => void;
  onSignUp: () => void;
  onSignIn: () => void;
}

const features = [
  {
    icon: '⚗',
    title: 'Labs and batches, handled',
    text: 'Practicals run per batch in parallel, in a lab that seats them, in one unbroken block that never straddles lunch.',
  },
  {
    icon: '◷',
    title: 'Every teacher’s limits',
    text: 'Daily and weekly loads, days off, blocked periods and preferred slots. No one is double-booked, ever.',
  },
  {
    icon: '▦',
    title: 'Rooms that fit',
    text: 'Leave the room on auto and TimeFlex picks a free classroom or lab with enough seats for the class.',
  },
  {
    icon: '✥',
    title: 'Drag, lock, regenerate',
    text: 'Move any period by hand with live clash checks. Lock what you like and let the solver redo the rest.',
  },
  {
    icon: '⇩',
    title: 'Print-ready exports',
    text: 'Every class, batch, teacher and room timetable as Excel or PDF, one sheet or page each.',
  },
  {
    icon: '✦',
    title: 'Describe it in plain words',
    text: 'Type your department the way you would explain it. A private AI on your own computer drafts the setup.',
  },
];

const steps = [
  { title: 'Create your institution account', text: 'One account for your college or school. Takes a minute.' },
  { title: 'Add teachers, classes and rooms', text: 'One by one, from a pasted list, or by describing them to the AI.' },
  { title: 'Generate, tweak, publish', text: 'A clash-free week in seconds. Approve it and send every teacher theirs.' },
];

const week = [
  { title: 'Today', text: 'Who is teaching where, right now.' },
  { title: 'Substitutions', text: 'A teacher is out? Get a ranked list of who is free to cover.' },
  { title: 'Free rooms', text: 'Find an empty room or lab for any period in one tap.' },
  { title: 'Attendance', text: 'Every period is already a register. Spot students below 75%.' },
];

export function Landing({ theme, onToggleTheme, onSignUp, onSignIn }: LandingProps) {
  return (
    <div className="landing-page">
      <FluidBackground />

      <header className="site-nav glass">
        <div className="brand static">
          <div className="brand-mark">TF</div>
          <div>
            <strong>TimeFlex</strong>
          </div>
        </div>
        <nav className="site-links">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#semester">All semester</a>
        </nav>
        <div className="site-actions">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button type="button" className="ghost" onClick={onSignIn}>
            Sign in
          </button>
          <button type="button" className="primary" onClick={onSignUp}>
            Get started
          </button>
        </div>
      </header>

      <section className="hero-3d">
        <div className="hero-copy">
          <span className="hero-pill glass">
            <i /> For schools, colleges and universities
          </span>
          <h1>
            Clash-free timetables,
            <br />
            <span className="gradient-text">made in minutes.</span>
          </h1>
          <p className="lead">
            Add your teachers, classes and rooms once. TimeFlex builds every class, teacher, lab and room timetable,
            respecting breaks, lab batches and everyone’s limits.
          </p>
          <div className="action-row">
            <button type="button" className="primary large glow" onClick={onSignUp}>
              Create your institution account
            </button>
            <button type="button" className="secondary large glass-button" onClick={onSignIn}>
              Sign in
            </button>
          </div>
          <ul className="hero-ticks">
            <li>No double-booking</li>
            <li>Labs in parallel batches</li>
            <li>Private local AI</li>
          </ul>
        </div>

        <div className="hero-stage">
          <Suspense fallback={<div className="campus-3d loading" />}>
            <Campus3D theme={theme} />
          </Suspense>
          <div className="float-chip glass chip-a">
            <span className="dot ok" /> 0 clashes
          </div>
          <div className="float-chip glass chip-b">
            <strong>48</strong> sessions placed in 2.1 s
          </div>
          <div className="float-chip glass chip-c">
            <span className="swatch lab" /> DBMS Lab · A1 · Lab 1
          </div>
        </div>
      </section>

      <section className="stat-strip glass">
        {[
          ['6', 'timetable views from one setup'],
          ['0', 'hard clashes, checked live'],
          ['~10 min', 'to set up a department'],
          ['100%', 'on your own machine'],
        ].map(([value, label]) => (
          <div key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </section>

      <section id="features" className="site-section">
        <p className="eyebrow">Features</p>
        <h2>Everything a timetable coordinator fights with, solved.</h2>
        <div className="feature-grid">
          {features.map((feature) => (
            <article key={feature.title} className="feature-card glass tilt">
              <span className="feature-icon">{feature.icon}</span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="how" className="site-section">
        <p className="eyebrow">How it works</p>
        <h2>Three steps to your first timetable.</h2>
        <ol className="how-steps">
          {steps.map((step, index) => (
            <li key={step.title} className="glass">
              <span className="how-number">{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="semester" className="site-section split">
        <div>
          <p className="eyebrow">All semester</p>
          <h2>Your timetable keeps working after it is printed.</h2>
          <p className="lead">
            The same setup that builds your timetable runs your days too. No extra data entry, nothing to learn.
          </p>
          <div className="week-grid">
            {week.map((item) => (
              <div key={item.title} className="week-card glass">
                <strong>{item.title}</strong>
                <span>{item.text}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="profile-preview glass tilt" aria-hidden="true">
          <div className="profile-preview-head">
            <div className="avatar large">AM</div>
            <div>
              <strong>Prof. Anita Mehta</strong>
              <span>Associate Professor · Computer Engineering</span>
            </div>
          </div>
          <div className="chip-row">
            {['Databases', 'SQL', 'Data Mining'].map((tag) => (
              <span key={tag} className="chip active">
                {tag}
              </span>
            ))}
          </div>
          <div className="mini-week">
            {Array.from({ length: 25 }, (_, index) => (
              <i key={index} className={index % 3 === 0 ? 'on' : index % 5 === 0 ? 'lab' : ''} />
            ))}
          </div>
          <div className="profile-preview-foot">
            <span>12 periods / week</span>
            <span>Class teacher, SE-A</span>
          </div>
          <p className="profile-caption">Every teacher gets a profile you build on.</p>
        </div>
      </section>

      <section className="cta-band">
        <h2>Make this semester’s timetable today.</h2>
        <p>Set up a whole department in one sitting. Your data stays on your own server.</p>
        <button type="button" className="primary large on-dark" onClick={onSignUp}>
          Create your institution account
        </button>
      </section>

      <footer className="site-footer">
        <div className="brand static">
          <div className="brand-mark">TF</div>
          <strong>TimeFlex</strong>
        </div>
        <span>Timetables for schools and colleges.</span>
      </footer>
    </div>
  );
}
