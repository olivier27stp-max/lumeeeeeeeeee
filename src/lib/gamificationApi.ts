import { supabase } from './supabase';
import type {
  FsBadge, FsRepBadge, FsChallenge, FsBattle,
  FsFeedPost, FsFeedReaction, FsFeedComment,
  FeedReactionEmoji,
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

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

export function getFeed(options?: {
  visibility?: string;
  teamId?: string;
  cursor?: string;
}): Promise<FsFeedPost[]> {
  const params = new URLSearchParams();
  if (options?.visibility) params.set('visibility', options.visibility);
  if (options?.teamId) params.set('teamId', options.teamId);
  if (options?.cursor) params.set('cursor', options.cursor);
  const q = params.toString();
  return apiFetch(`/gamification/feed${q ? `?${q}` : ''}`);
}

export function createFeedPost(data: {
  type?: string;
  visibility?: string;
  team_id?: string;
  title?: string;
  body?: string;
  image_url?: string;
}): Promise<FsFeedPost> {
  return apiFetch('/gamification/feed', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function addReaction(postId: string, emoji: FeedReactionEmoji): Promise<FsFeedReaction> {
  return apiFetch(`/gamification/feed/${postId}/react`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  });
}

export function removeReaction(postId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/gamification/feed/${postId}/react`, { method: 'DELETE' });
}

export function addComment(postId: string, body: string): Promise<FsFeedComment> {
  return apiFetch(`/gamification/feed/${postId}/comment`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}
