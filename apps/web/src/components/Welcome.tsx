import { useState } from 'react';
import { FluidBackground } from './FluidBackground';

export type StartMode = 'guided' | 'ai' | 'sample';

interface WelcomeProps {
  personName: string;
  institutionName: string;
  onStart: (mode: StartMode) => Promise<unknown>;
}

const modes: { id: StartMode; icon: string; title: string; text: string }[] = [
  {
    id: 'guided',
    icon: '➜',
    title: 'Guided setup (recommended)',
    text: 'One simple question at a time: days, periods, classes, teachers, rooms, subjects. About ten minutes.',
  },
  {
    id: 'ai',
    icon: '✦',
    title: 'Describe your department',
    text: 'Write it in plain words. A local AI drafts teachers, classes, rooms and subjects for you to check.',
  },
  {
    id: 'sample',
    icon: '▦',
    title: 'Explore with sample data',
    text: 'Fill your account with a complete sample department and see a timetable in one click.',
  },
];

/** First screen after creating an account: pick how to fill the institution. */
export function Welcome({ personName, institutionName, onStart }: WelcomeProps) {
  const [mode, setMode] = useState<StartMode>('guided');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      await onStart(mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start. Is the server running?');
      setBusy(false);
    }
  };

  return (
    <div className="welcome">
      <FluidBackground />
      <div className="welcome-card glass">
        <p className="eyebrow">Account created</p>
        <h1>Welcome, {personName.split(' ')[0]}.</h1>
        <p className="lead">How would you like to set up {institutionName}? You can switch at any time.</p>

        <div className="mode-grid">
          {modes.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`mode-card ${mode === item.id ? 'active' : ''}`}
              onClick={() => setMode(item.id)}
              aria-pressed={mode === item.id}
            >
              <span className="mode-icon">{item.icon}</span>
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </button>
          ))}
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="action-row end">
          <button type="button" className="primary large glow" onClick={start} disabled={busy}>
            {busy ? 'Setting up…' : 'Continue →'}
          </button>
        </div>
      </div>
    </div>
  );
}
