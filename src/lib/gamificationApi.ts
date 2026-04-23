import { supabase } from './supabase';
import type {
  FsBadge, FsRepBadge, FsChallenge, FsBattle,
} from '../types';

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

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export function getBadges(): Promise<FsBadge[]> {
  return apiFetch('/gamification/badges');
}

export function createBadge(data: Partial<FsBadge>): Promise<FsBadge> {
  return apiFetch('/gamification/badges', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getRepBadges(userId: string): Promise<FsRepBadge[]> {
  return apiFetch(`/gamification/badges/rep/${userId}`);
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

export function getActiveChallenges(): Promise<FsChallenge[]> {
  return apiFetch('/gamification/challenges');
}

export function createChallenge(data: Partial<FsChallenge>): Promise<FsChallenge> {
  return apiFetch('/gamification/challenges', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function joinChallenge(challengeId: string): Promise<unknown> {
  return apiFetch(`/gamification/challenges/${challengeId}/join`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Battles
// ---------------------------------------------------------------------------

export function getActiveBattles(): Promise<FsBattle[]> {
  return apiFetch('/gamification/battles');
}

export function createBattle(data: Partial<FsBattle>): Promise<FsBattle> {
  return apiFetch('/gamification/battles', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

