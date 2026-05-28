import { useState } from 'react';
import { parseRequirements } from '../api';
import type { DivisionForm, RoomForm, SubjectForm, TeacherForm } from '../types';
import { createId } from '../utils';

interface ChatSetupProps {
  onApply: (draft: {
    teachers: TeacherForm[];
    subjects: SubjectForm[];
    rooms: RoomForm[];
    divisions: DivisionForm[];
  }) => void;
}

export function ChatSetup({ onApply }: ChatSetupProps) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<any>(null);

  const handleParse = async () => {
    setLoading(true);
    try {
      const result = await parseRequirements(text);
      setDraft(result);
    } catch (e) {
      alert('Failed to parse text');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (!draft) return;

    const finalDraft = {
      teachers: draft.teachers.map((t: any) => ({ ...t, id: createId() })),
      rooms: draft.rooms.map((r: any) => ({ ...r, id: createId() })),
      divisions: draft.divisions.map((d: any) => ({ ...d, id: createId() })),
      subjects: draft.subjects.map((s: any) => ({ 
        ...s, 
        id: createId(), 
        teacherId: '', 
        roomId: '' 
      })),
    };

    onApply(finalDraft);
    setDraft(null);
    setText('');
  };

  return (
    <section className="card chat-setup">
      <header>
        <h1>Chat flow setup</h1>
        <p>Convert natural language requirements into a structured draft.</p>
      </header>

      <div className="chat-container">
        <textarea
          placeholder="e.g. Add teachers John Doe and Jane Smith. Add subjects Mathematics and Science. Add rooms 101 and 102."
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
        />
        <button 
          type="button" 
          className="secondary" 
          onClick={handleParse} 
          disabled={loading || !text}
        >
          {loading ? 'Parsing...' : 'Analyze Requirements'}
        </button>
      </div>

      {draft && (
        <div className="draft-preview">
          <h3>Review Draft</h3>
          <div className="draft-summary">
            {draft.teachers.length > 0 && (
              <p>👥 <strong>{draft.teachers.length}</strong> Teachers</p>
            )}
            {draft.subjects.length > 0 && (
              <p>📚 <strong>{draft.subjects.length}</strong> Subjects</p>
            )}
            {draft.rooms.length > 0 && (
              <p>🏢 <strong>{draft.rooms.length}</strong> Rooms</p>
            )}
            {draft.divisions.length > 0 && (
              <p>🏫 <strong>{draft.divisions.length}</strong> Divisions</p>
            )}
          </div>
          <div className="action-row">
            <button type="button" className="primary" onClick={handleApply}>
              Accept & Apply to Profile
            </button>
            <button type="button" className="secondary" onClick={() => setDraft(null)}>
              Discard
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
