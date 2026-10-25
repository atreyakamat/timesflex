import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type {
  AccountSession,
  InstitutionRecord,
  InstitutionType,
  OperationsData,
  ParseResult,
  SolverRequest,
  SolverResult,
  TimetableRecord,
  TimetableStatus,
} from '@core';
import type { ModelIntent } from '@core';
import { storage } from './storage';

/**
 * Where the API lives. EXPO_PUBLIC_API_URL wins; otherwise the web build talks to
 * localhost, and a phone talks to the computer running `expo start` (its LAN address),
 * so the same `npm run dev` serves both.
 */
const apiBase = () => {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (Platform.OS === 'web') return 'http://localhost:3001';
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:3001`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:3001' : 'http://localhost:3001';
};

const TOKEN_KEY = 'timeflex.session';
let token: string | null = null;
let onUnauthorized: () => void = () => {};

export const loadToken = async () => {
  token = await storage.get(TOKEN_KEY);
  return token;
};
const setToken = async (value: string | null) => {
  token = value;
  await storage.set(TOKEN_KEY, value);
};
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

const request = async <T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      method: options.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new ApiError(`Cannot reach the TimeFlex server at ${apiBase()}. Is it running?`, 0);
  }
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = JSON.parse(text).error ?? text;
    } catch {
      // Plain-text error body.
    }
    if (response.status === 401 && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/signup')) {
      await setToken(null);
      onUnauthorized();
    }
    throw new ApiError(message || `Request failed (${response.status})`, response.status);
  }
  return response.json() as Promise<T>;
};

export const api = {
  base: apiBase,
  async signUp(body: { name: string; email: string; password: string; institutionName: string; institutionType: InstitutionType }) {
    const session = await request<AccountSession>('/api/auth/signup', { method: 'POST', body });
    await setToken(session.token ?? null);
    return session;
  },
  async signIn(email: string, password: string) {
    const session = await request<AccountSession>('/api/auth/login', { method: 'POST', body: { email, password } });
    await setToken(session.token ?? null);
    return session;
  },
  me: () => request<AccountSession>('/api/auth/me'),
  async signOut() {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } finally {
      await setToken(null);
    }
  },
  async deleteAccount(password: string) {
    await request('/api/auth/account', { method: 'DELETE', body: { password } });
    await setToken(null);
  },
  saveProfile: (id: string, body: { name: string; type: string; profile: Record<string, unknown> }) =>
    request<InstitutionRecord>(`/api/institutions/${id}`, { method: 'PUT', body }),
  saveOperations: (id: string, operations: OperationsData) =>
    request<OperationsData>(`/api/institutions/${id}/operations`, { method: 'PUT', body: operations }),
  listTimetables: (id: string) => request<TimetableRecord[]>(`/api/institutions/${id}/timetables`),
  createTimetable: (id: string, body: { label: string; request: SolverRequest }) =>
    request<TimetableRecord>(`/api/institutions/${id}/timetables`, { method: 'POST', body }),
  solve: (timetableId: string) =>
    request<{ timetable: TimetableRecord; solver: SolverResult }>(`/api/timetables/${timetableId}/solve`, { method: 'POST' }),
  updateTimetable: (timetableId: string, body: { generatedSessions?: unknown[]; status?: TimetableStatus }) =>
    request<TimetableRecord>(`/api/timetables/${timetableId}`, { method: 'PUT', body }),
  interpret: (text: string, context: Record<string, string[]>) =>
    request<{ intent: ModelIntent; source: string; elapsedMs: number }>('/api/agent/interpret', { method: 'POST', body: { text, context } }),
  parse: (text: string, context: { teachers: string[]; rooms: string[] }) =>
    request<ParseResult>('/api/parse', { method: 'POST', body: { text, context } }),
  aiStatus: () => request<{ provider: string; reachable: boolean; modelAvailable: boolean; model: string; error?: string | null }>('/api/ai/status'),
};
