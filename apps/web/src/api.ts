import type { InstitutionRecord, SolverRequest, SolverResult, TimetableRecord } from './types';

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

export const solveTimetable = async (timetableId: string): Promise<{ timetable: TimetableRecord; solver: SolverResult }> => {
  return requestJson(`/api/timetables/${timetableId}/solve`, {
    method: 'POST',
  });
};

export const updateTimetable = async (
  timetableId: string,
  generatedSessions: SolverResult['scheduled_sessions'],
): Promise<TimetableRecord> => {
  return requestJson(`/api/timetables/${timetableId}`, {
    method: 'PUT',
    body: JSON.stringify({ generatedSessions }),
  });
};
