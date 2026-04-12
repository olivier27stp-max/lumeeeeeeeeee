import { supabase } from './supabase';
import type { LeaderboardEntry, RepPerformanceDetail, FsRepBadge } from '../types';

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
// API
// ---------------------------------------------------------------------------

export function getLeaderboard(
  period: 'daily' | 'weekly' | 'monthly',
  teamId?: string
): Promise<LeaderboardEntry[]> {
  return apiFetch(`/leaderboard${qs({ period, teamId })}`);
}

export function getRepPerformance(
  userId: string,
  from: string,
  to: string
): Promise<{ performance: RepPerformanceDetail; badges: FsRepBadge[] }> {
  return apiFetch(`/leaderboard/rep/${userId}${qs({ from, to })}`);
}

export function getRealtimeStats(
  userId: string
): Promise<RepPerformanceDetail> {
  return apiFetch(`/leaderboard/realtime/${userId}`);
}
