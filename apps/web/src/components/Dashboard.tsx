import { useEffect, useState } from 'react';
import { deleteInstitution, listInstitutions } from '../api';
import type { InstitutionRecord } from '../types';

interface DashboardProps {
  onLoadInstitution: (record: InstitutionRecord) => void;
  onNewInstitution: () => void;
}

export function Dashboard({ onLoadInstitution, onNewInstitution }: DashboardProps) {
  const [institutions, setInstitutions] = useState<InstitutionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInstitutions = () => {
    setLoading(true);
    listInstitutions()
      .then(setInstitutions)
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
        alert('Failed to delete institution');
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
        <button className="primary" onClick={onNewInstitution}>
          + New Institution
        </button>
      </header>

      {loading ? (
        <div className="loading-state">Loading institutions...</div>
      ) : (
        <div className="institution-grid">
          {institutions.map((inst) => (
            <div key={inst.id} className="card clickable" onClick={() => onLoadInstitution(inst)}>
              <div className="card-badge">{inst.type}</div>
              <button 
                className="delete-icon" 
                onClick={(e) => handleDelete(e, inst.id)}
                title="Delete Institution"
              >
                ×
              </button>
              <h3>{inst.name}</h3>
              <p>Managed profile with subjects, teachers and rooms.</p>
              <div className="card-footer">
                <span>Open Profile →</span>
              </div>
            </div>
          ))}
          {institutions.length === 0 && (
            <div className="card empty-card">
              <p>No institutions found. Create one to get started.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
