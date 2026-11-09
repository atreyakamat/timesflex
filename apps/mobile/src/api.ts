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
  NoticeRecipient,
  NoticeRecord,
  TimetableUpdate,
} from '@core';
import type { ModelIntent } from '@core';
import { storage } from './storage';

let serverOverride: string | null = null;

/**
 * Where the API lives. An address saved in the app wins, then EXPO_PUBLIC_API_URL ("/" means
 * this page's own address, used by the Docker web build); otherwise the web build talks to
 * localhost, and a phone talks to the computer running `expo start` (its LAN address),
 * so the same `npm run dev` serves both.
 */
const apiBase = () => {
  if (serverOverride) return serverOverride;
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (Platform.OS === 'web') return 'http://localhost:3001';
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:3001`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:3001' : 'http://localhost:3001';
};

const TOKEN_KEY = 'timeflex.session';
const SERVER_KEY = 'timeflex.server';
let token: string | null = null;
let onUnauthorized: () => void = () => {};

// Every request waits for this. Without it, a screen that asks for something as it opens goes
// out with no login, gets "please sign in" back, and signs the person out.
let loaded: Promise<void> | null = null;
const whenLoaded = () =>
  (loaded ??= (async () => {
    serverOverride = await storage.get(SERVER_KEY);
    token = await storage.get(TOKEN_KEY);
  })());

export const loadToken = async () => {
  await whenLoaded();
  return token;
};

/** fetch with a time limit. Written by hand because AbortSignal.timeout isn't on every phone. */
const fetchWithin = async (url: string, init: RequestInit, ms: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Points the phone app at another server, so one APK keeps working when the server's address
 * changes. Checks the address really is a TimeFlex server before saving it.
 */
export const changeServer = async (address: string) => {
  const trimmed = address.trim().replace(/\/+$/, '');
  const url = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let isTimeFlex = false;
  try {
    const response = await fetchWithin(`${url}/health`, {}, 6000);
    isTimeFlex = response.ok && (await response.json()).service === 'timesflex-api';
  } catch {
    // Reported below.
  }
  if (!isTimeFlex) throw new Error(`No TimeFlex server found at ${url}. Check the address, and that this phone is on the same network.`);
  serverOverride = url;
  await storage.set(SERVER_KEY, url);
  return url;
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

const request = async <T>(path: string, options: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> => {
  await whenLoaded();
  const sentToken = token;
  let response: Response;
  try {
    response = await fetchWithin(
      `${apiBase()}${path}`,
      {
        method: options.method ?? 'GET',
        headers: { 'Content-Type': 'application/json', ...(sentToken ? { Authorization: `Bearer ${sentToken}` } : {}) },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      },
      options.timeoutMs ?? 30000,
    );
  } catch {
    throw new ApiError(`Cannot reach the TimeFlex server${apiBase() ? ` at ${apiBase()}` : ''}. Is it running?`, 0);
  }
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = JSON.parse(text).error ?? text;
    } catch {
      // Plain-text error body.
    }
    // Only a login the server has actually refused counts as being signed out.
    if (response.status === 401 && sentToken && sentToken === token && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/signup')) {
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
  async startDemo() {
    const session = await request<AccountSession>('/api/auth/demo', { method: 'POST', body: {} });
    await setToken(session.token ?? null);
    return session;
  },
  changePassword: (current: string, next: string) => request('/api/auth/password', { method: 'POST', body: { current, next } }),
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
    request<{ timetable: TimetableRecord; solver: SolverResult }>(`/api/timetables/${timetableId}/solve`, { method: 'POST', timeoutMs: 180000 }),
  clearInstitution: (id: string) => request(`/api/institutions/${id}/history`, { method: 'DELETE' }),
  updateTimetable: (timetableId: string, body: { generatedSessions?: unknown[]; status?: TimetableStatus }) =>
    request<TimetableRecord>(`/api/timetables/${timetableId}`, { method: 'PUT', body }),
  interpret: (text: string, context: Record<string, string[]>) =>
    request<{ intent: ModelIntent; source: string; elapsedMs: number }>('/api/agent/interpret', { method: 'POST', body: { text, context } }),
  parse: (text: string, context: { teachers: string[]; rooms: string[] }) =>
    request<ParseResult>('/api/parse', { method: 'POST', body: { text, context } }),
  listNotices: (id: string) => request<NoticeRecord[]>(`/api/institutions/${id}/notices`),
  createNotice: (id: string, body: Pick<TimetableUpdate, 'title' | 'kind' | 'groupText' | 'recipients'>) => request<NoticeRecord>(`/api/institutions/${id}/notices`, { method: 'POST', body }),
  markRecipient: (noticeId: string, teacherId: string, status: NoticeRecipient['status']) => request<NoticeRecord>(`/api/notices/${noticeId}/recipients/${teacherId}`, { method: 'PUT', body: { status } }),
  markGroup: (noticeId: string, shared: boolean) => request<NoticeRecord>(`/api/notices/${noticeId}/group`, { method: 'PUT', body: { shared } }),
  sendNotice: (noticeId: string) => request<NoticeRecord>(`/api/notices/${noticeId}/send`, { method: 'POST', body: {}, timeoutMs: 180000 }),
  notifyStatus: () => request<{ whatsappApi: boolean }>('/api/notify/status'),
  aiStatus: () => request<{ provider: string; reachable: boolean; modelAvailable: boolean; model: string; error?: string | null }>('/api/ai/status'),
};
