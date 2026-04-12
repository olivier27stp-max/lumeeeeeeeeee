import { supabase } from './supabase';
import type { FsFieldSession, FsGpsPoint } from '../types';

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------
async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

const BASE = '/api';

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${BASE}${path}`, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') p.set(k, String(v));
  }
  const str = p.toString();
  return str ? `?${str}` : '';
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export function startFieldSession(opts: {
  territoryId?: string;
  latitude: number;
  longitude: number;
}): Promise<FsFieldSession> {
  return apiFetch('/field-sessions/start', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export function endFieldSession(
  sessionId: string,
  latitude: number,
  longitude: number
): Promise<FsFieldSession> {
  return apiFetch(`/field-sessions/${sessionId}/end`, {
    method: 'POST',
    body: JSON.stringify({ latitude, longitude }),
  });
}

export function pauseFieldSession(sessionId: string): Promise<FsFieldSession> {
  return apiFetch(`/field-sessions/${sessionId}/pause`, { method: 'POST' });
}

export function resumeFieldSession(sessionId: string): Promise<FsFieldSession> {
  return apiFetch(`/field-sessions/${sessionId}/resume`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// GPS tracking
// ---------------------------------------------------------------------------

export function recordGpsPoint(
  sessionId: string,
  lat: number,
  lng: number,
  accuracy?: number
): Promise<FsGpsPoint> {
  return apiFetch(`/field-sessions/${sessionId}/gps`, {
    method: 'POST',
    body: JSON.stringify({ lat, lng, accuracy }),
  });
}

export function getGpsTrail(
  sessionId: string
): Promise<Array<{ lat: number; lng: number; recorded_at: string }>> {
  return apiFetch(`/field-sessions/${sessionId}/trail`);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getActiveSession(): Promise<FsFieldSession | null> {
  return apiFetch('/field-sessions/active');
}

export function getAllActiveSessions(): Promise<FsFieldSession[]> {
  return apiFetch('/field-sessions/active/all');
}

export function getSessionHistory(
  from: string,
  to: string,
  userId?: string
): Promise<FsFieldSession[]> {
  return apiFetch(`/field-sessions/history${qs({ from, to, userId })}`);
}
