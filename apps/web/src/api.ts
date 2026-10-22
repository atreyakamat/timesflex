import type {
  AccountSession,
  AiStatus,
  InstitutionRecord,
  InstitutionType,
  OperationsData,
  ParseResult,
  SolverRequest,
  SolverResult,
  TimetableRecord,
  TimetableStatus,
} from './types';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3001';
const TOKEN_KEY = 'timeflex.session';

// The session token lives in localStorage so a reload keeps you signed in.
let token: string | null = (() => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
})();

const setToken = (value: string | null) => {
  token = value;
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage can be blocked; the session then lasts until the tab closes.
  }
};

export const hasSession = () => Boolean(token);

/** Called when the API says the session is gone, so the app can return to sign-in. */
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (handler: () => void) => {
  onUnauthorized = handler;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const requestJson = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(options.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError('The TimeFlex server is not reachable. Start it with "npm run dev".', 0);
  }

  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = JSON.parse(text).error ?? text;
    } catch {
      // Plain-text error.
    }
    if (response.status === 401 && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/signup')) {
      setToken(null);
      onUnauthorized();
    }
    throw new ApiError(message || `Request failed: ${response.status}`, response.status);
  }

  return response.json() as Promise<T>;
};

/* ---------- Accounts ---------- */

export const signUp = async (payload: {
  name: string;
  email: string;
  password: string;
  institutionName: string;
  institutionType: InstitutionType;
}): Promise<AccountSession> => {
  const session = await requestJson<AccountSession>('/api/auth/signup', { method: 'POST', body: JSON.stringify(payload) });
  setToken(session.token ?? null);
  return session;
};

export const signIn = async (email: string, password: string): Promise<AccountSession> => {
  const session = await requestJson<AccountSession>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setToken(session.token ?? null);
  return session;
};

export const currentSession = () => requestJson<AccountSession>('/api/auth/me');

export const signOut = async () => {
  try {
    await requestJson('/api/auth/logout', { method: 'POST' });
  } finally {
    setToken(null);
  }
};

/* ---------- Institution and timetables ---------- */

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

/** Day-to-day records (absences, substitutions, attendance) save separately from the profile. */
export const saveOperations = async (institutionId: string, operations: OperationsData): Promise<OperationsData> => {
  return requestJson(`/api/institutions/${institutionId}/operations`, {
    method: 'PUT',
    body: JSON.stringify(operations),
  });
};

/** Permanently deletes the account and its institution. Needs the password again. */
export const deleteAccount = async (password: string) => {
  await requestJson('/api/auth/account', { method: 'DELETE', body: JSON.stringify({ password }) });
  setToken(null);
};
