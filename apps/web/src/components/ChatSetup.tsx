import { useEffect, useState } from 'react';
import { getAiStatus, parseRequirements } from '../api';
import type { AiStatus, ChatDraft, ParseResult } from '../types';

interface ChatSetupProps {
  onApply: (draft: ChatDraft) => void;
  context: { teachers: string[]; rooms: string[] };
}

const SAMPLE = `Computer Engineering, second year. Classes run Monday to Friday, 9am to 4pm, 1 hour periods, with a 30 minute break after the 3rd period.
Divisions SE-A (batches A1, A2) and SE-B (batches B1, B2). SE-A has 60 students and SE-B has 56 students.
Prof. Mehta teaches DBMS 4 times a week in Room 101, max 4 lectures a day, not available on Friday.
Dr. Rao teaches Operating Systems 3 times a week in Room 102.
Ms. Kulkarni teaches Maths 3 times a week in Room 101.
DBMS Lab is a 2 hour practical once a week with Prof. Mehta in Lab 1.`;

type ListKey = 'divisions' | 'teachers' | 'rooms' | 'subjects';

const describe: Record<ListKey, (item: any) => string> = {
  divisions: (d) =>
    (d.batches.length ? `batches ${d.batches.join(', ')}` : 'no batches') + (d.size ? ` · ${d.size} students` : ''),
  teachers: (t) =>
    `${t.maxLecturesPerDay}/day, ${t.maxLecturesPerWeek}/week` +
    (t.unavailableDays.length ? ` · off ${t.unavailableDays.join(', ')}` : ''),
  rooms: (r) => `${r.type} · ${r.capacity} seats`,
  subjects: (s) =>
    `${s.isLab ? 'Lab' : 'Lecture'} · ${s.sessionsPerWeek}/week × ${s.durationSlots} slot(s) · ` +
    `${s.teacher ?? 'no teacher'} · ${s.room ?? 'no room'}`,
};

export function ChatSetup({ onApply, context }: ChatSetupProps) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);

  useEffect(() => {
    getAiStatus().then(setAi).catch(() => setAi(null));
  }, []);

  const handleParse = async () => {
    setLoading(true);
    setError('');
    try {
      setResult(await parseRequirements(text, context));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse text');
    } finally {
      setLoading(false);
    }
  };

  const removeItem = (key: ListKey, index: number) => {
    if (!result) return;
    const draft = { ...result.draft, [key]: result.draft[key].filter((_, i) => i !== index) };
    setResult({ ...result, draft });
  };

  const handleApply = () => {
    if (!result) return;
    onApply(result.draft);
    setResult(null);
    setText('');
  };

  const aiReady = ai?.reachable && ai.modelAvailable;
  const inst = result?.draft.institution;
  const timing = inst
    ? [
        inst.name,
        inst.workingDays.length ? inst.workingDays.join(', ') : null,
        inst.startTime && inst.endTime ? `${inst.startTime}–${inst.endTime}` : null,
        inst.slotDurationMinutes ? `${inst.slotDurationMinutes} min periods` : null,
        inst.breakAfterSlots && inst.breakDurationMinutes
          ? `${inst.breakDurationMinutes} min break after period ${inst.breakAfterSlots}`
          : null,
      ].filter(Boolean)
    : [];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Shortcut · optional</p>
          <h1>Describe your department</h1>
          <p>
            Write it the way you would tell a colleague. A local AI model turns it into a draft of every step, which you
            review before anything is added. Your text never leaves this computer.
          </p>
        </div>
      </header>
    <section className="panel chat-setup">
      <div className={`ai-pill ${aiReady ? 'ok' : 'off'}`} title={ai?.error ?? ''}>
        {ai === null
          ? 'Checking local AI…'
          : aiReady
            ? `Local AI ready · ${ai.model}`
            : `Local AI offline: the built-in parser will be used instead (start Ollama for better results).`}
      </div>

      <div className="chat-container">
        <textarea
          placeholder="e.g. Monday to Friday, 9am to 4pm. Division SE-A with batches A1, A2. Prof. Mehta teaches DBMS 4 times a week in Room 101…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
        />
        <div className="action-row">
          <button type="button" className="primary" onClick={handleParse} disabled={loading || !text.trim()}>
            {loading ? (aiReady ? 'Reading with local AI…' : 'Parsing…') : 'Build draft'}
          </button>
          <button type="button" className="secondary" onClick={() => setText(SAMPLE)} disabled={loading}>
            Use sample text
          </button>
        </div>
        {error && <p className="text-danger">{error}</p>}
      </div>

      {result && (
        <div className="draft-preview">
          <h3>
            Review draft{' '}
            <small>
              {result.source === 'llm' ? `by ${ai?.model ?? 'local model'}` : 'by rule parser'} ·{' '}
              {(result.elapsedMs / 1000).toFixed(1)}s
            </small>
          </h3>

          {result.warnings.length > 0 && (
            <ul className="draft-warnings">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}

          {timing.length > 0 && (
            <p>
              <strong>Timing:</strong> {timing.join(' · ')}
            </p>
          )}

          {(['divisions', 'teachers', 'rooms', 'subjects'] as ListKey[]).map((key) =>
            result.draft[key].length ? (
              <div key={key} className="draft-group">
                <h4>
                  {key} ({result.draft[key].length})
                </h4>
                <div className="list">
                  {result.draft[key].map((item: any, index: number) => (
                    <div key={`${key}-${item.name}`} className="list-item">
                      <div className="list-content">
                        <strong>{item.name}</strong>
                        <span>{describe[key](item)}</span>
                      </div>
                      <button type="button" className="ghost small danger-text" onClick={() => removeItem(key, index)}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null,
          )}

          <div className="action-row">
            <button type="button" className="primary" onClick={handleApply}>
              Accept & apply to profile
            </button>
            <button type="button" className="secondary" onClick={() => setResult(null)}>
              Discard
            </button>
          </div>
        </div>
      )}
    </section>
    </div>
  );
}
