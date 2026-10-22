import { useState, type FormEvent } from 'react';
import { signIn, signUp } from '../api';
import type { ResolvedTheme } from '../theme';
import type { AccountSession, InstitutionType } from '../types';
import { FluidBackground } from './FluidBackground';
import { ThemeToggle } from './ThemeToggle';

interface AuthProps {
  mode: 'signup' | 'login';
  theme: ResolvedTheme;
  onToggleTheme: (event: { clientX: number; clientY: number }) => void;
  onModeChange: (mode: 'signup' | 'login') => void;
  onBack: () => void;
  onSignedIn: (session: AccountSession, isNew: boolean) => void;
}

const passwordHint = (password: string) => {
  if (!password) return '';
  if (password.length < 8) return `${8 - password.length} more character${password.length === 7 ? '' : 's'}`;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter((re) => re.test(password)).length;
  return password.length >= 12 || variety >= 3 ? 'Strong password' : 'Good. Longer is stronger.';
};

export function Auth({ mode, theme, onToggleTheme, onModeChange, onBack, onSignedIn }: AuthProps) {
  const [name, setName] = useState('');
  const [institutionName, setInstitutionName] = useState('');
  const [institutionType, setInstitutionType] = useState<InstitutionType>('college');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const signup = mode === 'signup';
  const canSubmit = signup
    ? name.trim() && institutionName.trim() && email.trim() && password.length >= 8
    : email.trim() && password;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError('');
    try {
      const session = signup
        ? await signUp({ name: name.trim(), email: email.trim(), password, institutionName: institutionName.trim(), institutionType })
        : await signIn(email.trim(), password);
      onSignedIn(session, signup);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <FluidBackground />
      <header className="auth-bar">
        <button type="button" className="brand" onClick={onBack} title="Back to the home page">
          <div className="brand-mark">TF</div>
          <div>
            <strong>TimeFlex</strong>
          </div>
        </button>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </header>

      <main className="auth-layout">
        <section className="auth-pitch">
          <p className="eyebrow">{signup ? 'Institution account' : 'Welcome back'}</p>
          <h1>{signup ? 'One account for your whole institution.' : 'Sign in to your institution.'}</h1>
          <ul className="auth-points">
            <li>
              <strong>Teacher profiles</strong>
              <span>Add each professor once: what they teach, their expertise, when they are free.</span>
            </li>
            <li>
              <strong>Every timetable from one setup</strong>
              <span>Class, batch, teacher, lab and room views, kept in sync.</span>
            </li>
            <li>
              <strong>Private by default</strong>
              <span>Runs on your own server, with a local AI that never sends your data out.</span>
            </li>
          </ul>
        </section>

        <form className="auth-card glass" onSubmit={submit} noValidate>
          <div className="segmented wide">
            <button type="button" className={signup ? 'active' : ''} onClick={() => onModeChange('signup')}>
              Create account
            </button>
            <button type="button" className={!signup ? 'active' : ''} onClick={() => onModeChange('login')}>
              Sign in
            </button>
          </div>

          {signup && (
            <>
              <label>
                Institution name
                <input
                  autoFocus
                  type="text"
                  autoComplete="organization"
                  placeholder="e.g. Goa College of Engineering"
                  value={institutionName}
                  onChange={(e) => setInstitutionName(e.target.value)}
                />
              </label>
              <div className="type-picker" role="radiogroup" aria-label="Institution type">
                {(['school', 'college', 'university'] as InstitutionType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={institutionType === type}
                    className={institutionType === type ? 'active' : ''}
                    onClick={() => setInstitutionType(type)}
                  >
                    <span>{type === 'school' ? '✎' : type === 'college' ? '⌂' : '✦'}</span>
                    {type[0].toUpperCase() + type.slice(1)}
                  </button>
                ))}
              </div>
              <label>
                Your name
                <input
                  type="text"
                  autoComplete="name"
                  placeholder="Timetable coordinator or admin"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            </>
          )}

          <label>
            {signup ? 'Work e-mail' : 'E-mail'}
            <input
              autoFocus={!signup}
              type="email"
              autoComplete="email"
              placeholder="you@college.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <span className="password-field">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete={signup ? 'new-password' : 'current-password'}
                placeholder={signup ? 'At least 8 characters' : ''}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" className="ghost small" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </span>
            {signup && password && <small className={password.length < 8 ? 'text-warning' : 'muted'}>{passwordHint(password)}</small>}
          </label>

          {error && <p className="error-text">{error}</p>}

          <button type="submit" className="primary large glow" disabled={!canSubmit || busy}>
            {busy ? (signup ? 'Creating your account…' : 'Signing in…') : signup ? 'Create institution account' : 'Sign in'}
          </button>

          <p className="auth-switch">
            {signup ? 'Already have an account?' : 'New to TimeFlex?'}{' '}
            <button type="button" className="link-button" onClick={() => onModeChange(signup ? 'login' : 'signup')}>
              {signup ? 'Sign in' : 'Create an institution account'}
            </button>
          </p>
        </form>
      </main>
    </div>
  );
}
