import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, UNAUTHORIZED_EVENT, getMe, login, logout, setupOwner } from '../api';
import type { AuthUser } from '../types';

type GateState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'signin'; needsSetup: boolean } | { kind: 'ready'; user: AuthUser };

interface AuthGateProps {
  children: (user: AuthUser, signOut: () => Promise<void>) => ReactNode;
}

/** Shows first-run setup or sign-in until there is a session, then renders the app. */
export function AuthGate({ children }: AuthGateProps) {
  const [state, setState] = useState<GateState>({ kind: 'loading' });

  const check = async () => {
    try {
      const { user } = await getMe();
      setState({ kind: 'ready', user });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setState({ kind: 'signin', needsSetup: Boolean(error.body.needsSetup) });
      } else {
        setState({ kind: 'error', message: error instanceof Error ? error.message : 'Cannot reach the server.' });
      }
    }
  };

  useEffect(() => {
    check();
    const onUnauthorized = () => setState({ kind: 'signin', needsSetup: false });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const signOut = async () => {
    try {
      await logout();
    } finally {
      setState({ kind: 'signin', needsSetup: false });
    }
  };

  if (state.kind === 'ready') return <>{children(state.user, signOut)}</>;

  return (
    <div className="auth-screen">
      <div className="card auth-card">
        <div className="brand">
          <div className="brand-mark">TF</div>
          <div>
            <strong>TimeFlex</strong>
            <span>Timetable scheduler</span>
          </div>
        </div>
        {state.kind === 'loading' && <p className="loading-state">Connecting…</p>}
        {state.kind === 'error' && (
          <>
            <p className="text-danger" role="alert">
              {state.message}
            </p>
            <button type="button" className="secondary" onClick={check}>
              Try again
            </button>
          </>
        )}
        {state.kind === 'signin' && (
          <SignInForm
            needsSetup={state.needsSetup}
            onSignedIn={(user) => setState({ kind: 'ready', user })}
          />
        )}
      </div>
    </div>
  );
}

function SignInForm({ needsSetup, onSignedIn }: { needsSetup: boolean; onSignedIn: (user: AuthUser) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (needsSetup && password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const { user } = needsSetup ? await setupOwner(username, password) : await login(username, password);
      onSignedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit}>
      <h1>{needsSetup ? 'Create the owner account' : 'Sign in'}</h1>
      {needsSetup && (
        <p className="hint">
          This is a fresh install. The owner account is the admin: it sets up the institution, teachers and subjects,
          approves timetables, and adds viewer accounts for staff.
        </p>
      )}
      <label>
        Username
        <input
          type="text"
          autoComplete="username"
          autoFocus
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete={needsSetup ? 'new-password' : 'current-password'}
          required
          minLength={needsSetup ? 8 : undefined}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {needsSetup && (
        <label>
          Confirm password
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </label>
      )}
      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="primary" disabled={busy}>
        {busy ? 'Please wait…' : needsSetup ? 'Create account' : 'Sign in'}
      </button>
    </form>
  );
}
