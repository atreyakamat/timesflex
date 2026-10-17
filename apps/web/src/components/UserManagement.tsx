import { useEffect, useState, type FormEvent } from 'react';
import { changePassword, createUser, deleteUser, listAudit, listUsers, updateUser, type AuditEntry } from '../api';
import type { AuthUser, UserRole } from '../types';

const roleLabel: Record<UserRole, string> = { admin: 'Admin', viewer: 'Viewer' };

const actionLabel: Record<string, string> = {
  'auth.setup': 'created the owner account',
  'auth.login': 'signed in',
  'auth.login_failed': 'failed to sign in',
  'auth.logout': 'signed out',
  'auth.password_changed': 'changed their password',
  'user.created': 'added user',
  'user.updated': 'changed user',
  'user.deleted': 'deleted user',
  'institution.created': 'created',
  'institution.updated': 'saved',
  'institution.deleted': 'deleted',
  'timetable.created': 'started',
  'timetable.solved': 'generated',
  'timetable.edited': 'edited',
  'timetable.approved': 'approved',
  'timetable.unapproved': 'unapproved',
};

interface UserManagementProps {
  currentUser: AuthUser;
  onClose: () => void;
}

/** Account settings for everyone; the user list is shown to admins only. */
export function UserManagement({ currentUser, onClose }: UserManagementProps) {
  const isAdmin = currentUser.role === 'admin';
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [activity, setActivity] = useState<AuditEntry[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = () => {
    if (!isAdmin) return;
    listUsers()
      .then(setUsers)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load users.'));
    listAudit()
      .then(setActivity)
      .catch(() => setActivity([]));
  };

  useEffect(refresh, [isAdmin]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  };

  return (
    <section className="card">
      <header className="dashboard-header">
        <div>
          <h1>{isAdmin ? 'Users and account' : 'Your account'}</h1>
          <p>
            {isAdmin
              ? 'Admins set up and approve timetables. Viewers can browse and export them.'
              : `Signed in as ${currentUser.username}.`}
          </p>
        </div>
        <button type="button" className="secondary" onClick={onClose}>
          ← Back
        </button>
      </header>

      <div role="status" aria-live="polite">
        {message && <p className="hint">{message}</p>}
        {error && <p className="text-danger">{error}</p>}
      </div>

      {isAdmin && (
        <>
          <AddUserForm onAdd={(payload) => run(() => createUser(payload), `Added ${payload.username}.`)} />
          <div className="list">
            {users.map((user) => {
              const isMe = user.id === currentUser.id;
              return (
                <div key={user.id} className="list-item">
                  <div className="list-content">
                    <strong>
                      {user.username}
                      {isMe ? ' (you)' : ''}
                    </strong>
                    <span>
                      {roleLabel[user.role]}
                      {user.disabled ? ' · disabled' : ''}
                    </span>
                  </div>
                  <div className="inline-fields">
                    <select
                      aria-label={`Role for ${user.username}`}
                      value={user.role}
                      onChange={(event) =>
                        run(() => updateUser(user.id, { role: event.target.value as UserRole }), `Updated ${user.username}.`)
                      }
                    >
                      <option value="admin">Admin</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    {!isMe && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          run(
                            () => updateUser(user.id, { disabled: !user.disabled }),
                            `${user.disabled ? 'Enabled' : 'Disabled'} ${user.username}.`,
                          )
                        }
                      >
                        {user.disabled ? 'Enable' : 'Disable'}
                      </button>
                    )}
                    {!isMe && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          const password = prompt(`New password for ${user.username} (min 8 characters)`);
                          if (password) run(() => updateUser(user.id, { password }), `Password reset for ${user.username}.`);
                        }}
                      >
                        Reset password
                      </button>
                    )}
                    {!isMe && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          if (confirm(`Delete ${user.username}? This cannot be undone.`)) {
                            run(() => deleteUser(user.id), `Deleted ${user.username}.`);
                          }
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <ChangePasswordForm onChange={(current, next) => run(() => changePassword(current, next), 'Password changed.')} />

      {isAdmin && activity.length > 0 && (
        <>
          <h3>Recent activity</h3>
          <ul className="activity">
            {activity.map((entry) => (
              <li key={entry.id}>
                <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
                <span>
                  <strong>{entry.username ?? 'someone'}</strong> {actionLabel[entry.action] ?? entry.action}
                  {entry.target ? ` ${entry.target}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function AddUserForm({ onAdd }: { onAdd: (payload: { username: string; password: string; role: UserRole }) => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('viewer');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onAdd({ username, password, role });
    setUsername('');
    setPassword('');
  };

  return (
    <form className="inline-form" onSubmit={submit}>
      <input aria-label="New username" placeholder="Username" required value={username} onChange={(e) => setUsername(e.target.value)} />
      <input
        aria-label="New user password"
        type="password"
        placeholder="Password (min 8)"
        autoComplete="new-password"
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <select aria-label="New user role" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
        <option value="viewer">Viewer</option>
        <option value="admin">Admin</option>
      </select>
      <button type="submit">Add user</button>
    </form>
  );
}

function ChangePasswordForm({ onChange }: { onChange: (current: string, next: string) => Promise<void> }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onChange(current, next);
    setCurrent('');
    setNext('');
  };

  return (
    <form className="inline-form" onSubmit={submit}>
      <strong>Change your password</strong>
      <input
        aria-label="Current password"
        type="password"
        placeholder="Current password"
        autoComplete="current-password"
        required
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <input
        aria-label="New password"
        type="password"
        placeholder="New password (min 8)"
        autoComplete="new-password"
        required
        minLength={8}
        value={next}
        onChange={(e) => setNext(e.target.value)}
      />
      <button type="submit">Change password</button>
    </form>
  );
}
