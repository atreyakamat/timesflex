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
  EventKind,
  StudentEvent,
  AttendanceRecord,
  ScanRecord,
  StudentCard,
  Substitution,
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

export interface InviteRow {
  id: string;
  teacherId: string | null;
  role: string;
  status: 'joined' | 'waiting' | 'expired';
}
export interface MemberRow {
  accountId: string;
  name: string;
  email: string;
  role: string;
  teacherId: string | null;
  owner?: boolean;
}
export interface CollegeRow {
  id: string;
  name: string;
  type: string;
  status: 'active' | 'paused';
  contact: string | null;
  adminEmail: string | null;
  stage: 'invited' | 'setting_up' | 'ready' | 'built' | 'approved' | 'live';
  counts: { classes: number; teachers: number; subjects: number; students: number; rooms: number; members: number };
}
export interface Classroom {
  name: string;
  role: 'admin' | 'teacher';
  teacherId: string | null;
  institution: Record<string, unknown>;
  teachers: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
  rooms: { id: string; name: string }[];
  divisions: { id: string; name: string; batches: string[]; size?: number; students: { id: string; rollNo: string; name: string; batch?: string }[] }[];
  sessions: unknown[];
  covering?: Substitution[];
}
export interface DeviceRow {
  id: string;
  name: string;
  kind: 'gate' | 'classroom' | 'integration';
  lastSeenAt: string | null;
  unmatched: string[];
}
export interface ReaderLink {
  readerId: string;
  studentId: string;
  name: string | null;
  rollNo: string | null;
  className: string | null;
}
export interface ImportSummary {
  readable: number;
  matched: number;
  unmatched: string[];
  unmatchedCount: number;
  skipped: number;
  unreadable: string[];
  outOfRange: number;
  rows: { id: string; time: string; name: string | null; className: string | null }[];
  accepted: number;
  duplicates: number;
}
export type ScanResult = { matched: false } | { matched: true; duplicate: boolean; student: { id: string; name: string; rollNo: string; divisionId: string; divisionName: string } };

/** A link someone can tap to accept an invite: this page's address, or the server the app uses. */
export const joinLink = (code: string) => {
  const origin = Platform.OS === 'web' ? globalThis.location?.origin ?? '' : apiBase();
  return `${origin}/join?code=${encodeURIComponent(code)}`;
};

export const api = {
  base: apiBase,
  peekInvite: (code: string) => request<{ college: string; teacher: string | null; role: string }>(`/api/auth/invite/${encodeURIComponent(code)}`),
  async join(body: { code: string; name: string; email: string; password: string }) {
    const session = await request<AccountSession>('/api/auth/join', { method: 'POST', body });
    await setToken(session.token ?? null);
    return session;
  },
  classroom: (id: string) => request<Classroom>(`/api/institutions/${id}/classroom`),
  listEvents: (id: string, filters: { studentId?: string } = {}) => request<StudentEvent[]>(`/api/institutions/${id}/events${filters.studentId ? `?studentId=${encodeURIComponent(filters.studentId)}` : ''}`),
  createEvent: (id: string, body: { studentId: string; kind: EventKind; date: string; time?: string; slot?: string; minutesLate?: number; note?: string }) => request<StudentEvent>(`/api/institutions/${id}/events`, { method: 'POST', body }),
  reviewEvent: (eventId: string, body: { status: 'open' | 'reviewed'; outcome?: string }) => request<StudentEvent>(`/api/events/${eventId}`, { method: 'PUT', body }),
  voidEvent: (eventId: string, reason?: string) => request<StudentEvent>(`/api/events/${eventId}/void`, { method: 'POST', body: { ...(reason ? { reason } : {}) } }),
  takeAttendance: (id: string, body: { date: string; sessionId: string; absentStudentIds: string[] }) => request<AttendanceRecord>(`/api/institutions/${id}/attendance`, { method: 'POST', body }),
  listAttendance: (id: string) => request<AttendanceRecord[]>(`/api/institutions/${id}/attendance`),
  listCards: (id: string) => request<StudentCard[]>(`/api/institutions/${id}/cards`),
  rotateCards: (id: string) => request(`/api/institutions/${id}/cards/rotate`, { method: 'POST', body: {} }),
  scan: (id: string, identifier: string, purpose: 'class' | 'gate') => request<ScanResult>(`/api/institutions/${id}/scans`, { method: 'POST', body: { identifier, purpose } }),
  listScans: (id: string, date: string) => request<ScanRecord[]>(`/api/institutions/${id}/scans?date=${encodeURIComponent(date)}`),
  listReaderIds: (id: string) => request<ReaderLink[]>(`/api/institutions/${id}/reader-ids`),
  linkReaderIds: (id: string, body: { links: { readerId: string; studentId: string }[] } | { text: string }) => request<{ saved: number; problems: { line: string; reason: string }[] }>(`/api/institutions/${id}/reader-ids`, { method: 'POST', body }),
  unlinkReaderId: (id: string, readerId: string) => request(`/api/institutions/${id}/reader-ids/${encodeURIComponent(readerId)}`, { method: 'DELETE' }),
  importScans: (id: string, body: { text: string; kind: 'gate' | 'classroom'; name: string; dryRun: boolean }) => request<ImportSummary>(`/api/institutions/${id}/scans/import`, { method: 'POST', body, timeoutMs: 180000 }),
  listDevices: (id: string) => request<DeviceRow[]>(`/api/institutions/${id}/devices`),
  createDevice: (id: string, body: { name: string; kind: DeviceRow['kind'] }) => request<DeviceRow & { key: string }>(`/api/institutions/${id}/devices`, { method: 'POST', body }),
  deleteDevice: (id: string, deviceId: string) => request(`/api/institutions/${id}/devices/${deviceId}`, { method: 'DELETE' }),
  listInvites: (id: string) => request<InviteRow[]>(`/api/institutions/${id}/invites`),
  createInvite: (id: string, teacherId: string) => request<{ id: string; code: string }>(`/api/institutions/${id}/invites`, { method: 'POST', body: { teacherId } }),
  listMembers: (id: string) => request<MemberRow[]>(`/api/institutions/${id}/members`),
  removeMember: (id: string, accountId: string) => request(`/api/institutions/${id}/members/${accountId}`, { method: 'DELETE' }),
  listColleges: () => request<CollegeRow[]>('/api/platform/colleges'),
  createCollege: (body: { name: string; type: string; contact?: string }) => request<{ id: string; code: string }>('/api/platform/colleges', { method: 'POST', body }),
  inviteCollegeAdmin: (id: string) => request<{ code: string }>(`/api/platform/colleges/${id}/invite`, { method: 'POST', body: {} }),
  setCollegeStatus: (id: string, status: 'active' | 'paused') => request(`/api/platform/colleges/${id}`, { method: 'PUT', body: { status } }),
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
