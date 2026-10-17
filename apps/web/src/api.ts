import type {
  AiStatus,
  InstitutionRecord,
  ParseResult,
  SolverRequest,
  SolverResult,
  TimetableRecord,
  TimetableStatus,
} from './types';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3001';

const requestJson = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
};

export const createInstitution = async (payload: {
  name: string;
  type: string;
  profile: Record<string, unknown>;
}): Promise<InstitutionRecord> => {
  return requestJson('/api/institutions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

export const deleteInstitution = async (id: string): Promise<{ success: boolean }> => {
  return requestJson(`/api/institutions/${id}`, {
    method: 'DELETE',
  });
};

export const createTimetable = async (
  institutionId: string,
  payload: { label: string; request: SolverRequest },
): Promise<TimetableRecord> => {
  return requestJson(`/api/institutions/${institutionId}/timetables`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

export const listInstitutions = async (): Promise<InstitutionRecord[]> => {
  return requestJson('/api/institutions');
};

export const listTimetables = async (institutionId: string): Promise<TimetableRecord[]> => {
  return requestJson(`/api/institutions/${institutionId}/timetables`);
};

export const updateInstitution = async (
  id: string,
  payload: { name: string; type: string; profile: Record<string, unknown> },
): Promise<InstitutionRecord> => {
  return requestJson(`/api/institutions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
};

export const parseRequirements = async (
  text: string,
  context: { teachers: string[]; rooms: string[] },
): Promise<ParseResult> => {
  return requestJson('/api/parse', {
    method: 'POST',
    body: JSON.stringify({ text, context }),
  });
};

export const getAiStatus = async (): Promise<AiStatus> => {
  return requestJson('/api/ai/status');
};

export const solveTimetable = async (timetableId: string): Promise<{ timetable: TimetableRecord; solver: SolverResult }> => {
  return requestJson(`/api/timetables/${timetableId}/solve`, {
    method: 'POST',
  });
};

/** Save edited sessions and/or change the version status (e.g. approve it). */
export const updateTimetable = async (
  timetableId: string,
  changes: { generatedSessions?: SolverResult['scheduled_sessions']; status?: TimetableStatus },
): Promise<TimetableRecord> => {
  return requestJson(`/api/timetables/${timetableId}`, {
    method: 'PUT',
    body: JSON.stringify(changes),
  });
};
