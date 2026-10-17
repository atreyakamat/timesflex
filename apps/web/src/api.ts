import type {
  AiStatus,
  AuthUser,
  UserRole,
  InstitutionRecord,
  ParseResult,
  SolverRequest,
  SolverResult,
  TimetableRecord,
  TimetableStatus,
} from './types';

// Same origin by default: the API serves the built app, and Vite proxies /api in dev.
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

/** Fired when the server says the session is gone, so the app can show the sign-in screen. */
export const UNAUTHORIZED_EVENT = 'timesflex:unauthorized';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const requestJson = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    });
  } catch {
    throw new Error('Cannot reach the TimeFlex server. Check that it is running.');
  }

  if (!response.ok) {
    const text = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON; show the text as-is.
    }
    if (response.status === 401 && !path.startsWith('/api/auth/')) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(String(body.error ?? text) || `Request failed: ${response.status}`, response.status, body);
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

export const getMe = async (): Promise<{ user: AuthUser }> => requestJson('/api/auth/me');

export const login = async (username: string, password: string): Promise<{ user: AuthUser }> =>
  requestJson('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });

export const setupOwner = async (username: string, password: string): Promise<{ user: AuthUser }> =>
  requestJson('/api/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) });

export const logout = async (): Promise<void> => {
  await requestJson('/api/auth/logout', { method: 'POST' });
};

export const changePassword = async (currentPassword: string, newPassword: string): Promise<void> => {
  await requestJson('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
};

export const listUsers = async (): Promise<AuthUser[]> => requestJson('/api/users');

export const createUser = async (payload: { username: string; password: string; role: UserRole }): Promise<AuthUser> =>
  requestJson('/api/users', { method: 'POST', body: JSON.stringify(payload) });

export const updateUser = async (
  id: string,
  changes: { role?: UserRole; disabled?: boolean; password?: string },
): Promise<AuthUser> => requestJson(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(changes) });

export const deleteUser = async (id: string): Promise<void> => {
  await requestJson(`/api/users/${id}`, { method: 'DELETE' });
};
