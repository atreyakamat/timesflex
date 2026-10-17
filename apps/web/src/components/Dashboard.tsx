import { useEffect, useState } from 'react';
import { deleteInstitution, listInstitutions } from '../api';
import type { AuthUser, InstitutionRecord } from '../types';

const summary = (record: InstitutionRecord) => {
  const profile = ((record.data as any)?.profile ?? record.data ?? {}) as Record<string, unknown[] | undefined>;
  const count = (key: string, label: string) => `${profile[key]?.length ?? 0} ${label}`;
  const updated = record.updatedAt ? ` · updated ${new Date(record.updatedAt).toLocaleDateString()}` : '';
  return `${count('divisions', 'divisions')} · ${count('teachers', 'teachers')} · ${count('subjects', 'subjects')}${updated}`;
};

interface DashboardProps {
  user: AuthUser;
  canEdit: boolean;
  onLoadInstitution: (record: InstitutionRecord) => void;
  onNewInstitution: () => void;
  onOpenUsers: () => void;
  onSignOut: () => void;
}

export function Dashboard({ user, canEdit, onLoadInstitution, onNewInstitution, onOpenUsers, onSignOut }: DashboardProps) {
  const [institutions, setInstitutions] = useState<InstitutionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchInstitutions = () => {
    setLoading(true);
    setError('');
    listInstitutions()
      .then(setInstitutions)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load institutions.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchInstitutions();
  }, []);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this institution and all its timetables?')) {
      try {
        await deleteInstitution(id);
        fetchInstitutions();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to delete institution');
      }
    }
  };

  return (
    <div className="dashboard-view">
      <header className="dashboard-header">
        <div>
          <h1>Your Institutions</h1>
          <p>Reuse institutional data across multiple schedule versions.</p>
        </div>
        <div className="action-row">
          <span className="hint">
            {user.username} · {user.role === 'admin' ? 'Admin' : 'Viewer'}
          </span>
          <button type="button" className="secondary" onClick={onOpenUsers}>
            {canEdit ? 'Users' : 'Account'}
          </button>
          <button type="button" className="secondary" onClick={onSignOut}>
            Sign out
          </button>
          {canEdit && (
            <button type="button" className="primary" onClick={onNewInstitution}>
              + New Institution
            </button>
          )}
        </div>
      </header>

      {loading ? (
        <div className="loading-state">Loading institutions...</div>
      ) : error ? (
        <div className="card warning" role="alert">
          <p>{error}</p>
          <button type="button" className="secondary" onClick={fetchInstitutions}>
            Try again
          </button>
        </div>
      ) : (
        <div className="institution-grid">
          {institutions.map((inst) => (
            <div
              key={inst.id}
              className="card clickable"
              role="button"
              tabIndex={0}
              aria-label={`Open ${inst.name}`}
              onClick={() => onLoadInstitution(inst)}
              onKeyDown={(event) => {
                if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  onLoadInstitution(inst);
                }
              }}
            >
              <div className="card-badge">{inst.type}</div>
              {canEdit && (
                <button
                  className="delete-icon"
                  onClick={(e) => handleDelete(e, inst.id)}
                  title="Delete Institution"
                  aria-label={`Delete ${inst.name}`}
                >
                  ×
                </button>
              )}
              <h3>{inst.name}</h3>
              <p>{summary(inst)}</p>
              <div className="card-footer">
                <span>{canEdit ? 'Open Profile →' : 'View Timetable →'}</span>
              </div>
            </div>
          ))}
          {institutions.length === 0 && (
            <div className="card empty-card">
              <p>{canEdit ? 'No institutions yet. Create one to get started.' : 'No timetables have been published yet.'}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
