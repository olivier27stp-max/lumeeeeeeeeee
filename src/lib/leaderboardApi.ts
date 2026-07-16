import { supabase } from './supabase';
import type { LeaderboardEntry, RepPerformanceDetail, FsRepBadge } from '../types';

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------
async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  // Office actif — le serveur scope dessus si l'utilisateur en est membre.
  let activeOrg = '';
  try { activeOrg = localStorage.getItem('lume-active-org') || ''; } catch {}
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-org-id': activeOrg };
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

export interface LeaderboardOptions {
  teamId?: string;
  /** 'mine' = office actif uniquement ; 'all' = tous les offices de la compagnie. */
  scope?: 'mine' | 'all';
  /** Office actuellement sélectionné (transmis au serveur pour scoper 'mine'). */
  orgId?: string;
  /** Catégorie d'expérience : recrue (1re année) ou expérimenté. */
  experience?: 'rookie' | 'experienced';
}

export function getLeaderboard(
  period: 'daily' | 'weekly' | 'monthly',
  opts: LeaderboardOptions = {}
): Promise<LeaderboardEntry[]> {
  return apiFetch(
    `/leaderboard${qs({ period, teamId: opts.teamId, scope: opts.scope, orgId: opts.orgId, experience: opts.experience })}`
  );
}

/** Admin: tag a rep as rookie / experienced (null = clear). */
export function setRepExperience(
  userId: string,
  level: 'rookie' | 'experienced' | null,
): Promise<{ ok: boolean; experience_level: string | null }> {
  return apiFetch(`/leaderboard/rep/${userId}/experience`, {
    method: 'PATCH',
    body: JSON.stringify({ experience_level: level }),
  });
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
