// Leaderboard performance stats — same authed server routes the web
// RepProfile page uses (server/routes/leaderboard.ts). The server scopes to
// the caller's org from the JWT.

import { serverGet } from './server';

/** Plage de dates explicite (YYYY-MM-DD, inclusif). from === to = un seul jour. */
export interface LeaderboardRange {
  from: string;
  to: string;
}

export interface LeaderboardOptions {
  /** 'mine' = office actif uniquement ; 'all' = tous les offices de la compagnie. */
  scope?: 'mine' | 'all';
  /** Office actuellement sélectionné (transmis au serveur pour scoper 'mine'). */
  orgId?: string;
  /** Catégorie d'expérience : recrue (1re année) ou expérimenté. */
  experience?: 'rookie' | 'experienced';
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  team_name: string | null;
  team_id: string | null;
  /** Nom du bureau (org) du rep — affiché seulement si la compagnie a 2+ offices. */
  office_name: string | null;
  experience_level: 'rookie' | 'experienced' | null;
  closes: number;
  revenue: number;
  doors_knocked: number;
  conversion_rate: number;
  trend: number;
}

/** Ranked reps over a date window — GET /api/leaderboard (same route as the web page). */
export function getLeaderboard(
  range: LeaderboardRange,
  opts: LeaderboardOptions = {},
): Promise<LeaderboardEntry[]> {
  return serverGet<LeaderboardEntry[]>(
    `/leaderboard${qs({ from: range.from, to: range.to, scope: opts.scope, orgId: opts.orgId, experience: opts.experience })}`,
  );
}

export interface Office {
  id: string;
  name: string;
}

/** List the offices (orgs) of the caller's company for the office filter. */
export function getOffices(): Promise<{ offices: Office[]; activeOrgId: string }> {
  return serverGet('/leaderboard/offices');
}

export interface RepProfileInfo {
  profile: { id: string; full_name: string | null; avatar_url: string | null } | null;
  /** Nom du bureau (office) du rep. */
  office: string;
  /** Org du rep dans la compagnie — sert à scoper ses stats. */
  orgId: string;
}

/**
 * Identité du rep — résolue côté serveur car la RLS client bloque
 * profiles/team_members pour les reps d'un autre office.
 */
export function getRepProfileInfo(userId: string): Promise<RepProfileInfo> {
  return serverGet(`/leaderboard/rep/${userId}/profile`);
}

export interface RepPerformanceDetail {
  doors_knocked: number;
  conversations: number;
  demos_set: number;
  demos_held: number;
  quotes_sent: number;
  closes: number;
  revenue: number;
  conversion_rate: number;
  average_ticket: number;
  follow_ups_completed: number;
}

export const EMPTY_PERFORMANCE: RepPerformanceDetail = {
  doors_knocked: 0,
  conversations: 0,
  demos_set: 0,
  demos_held: 0,
  quotes_sent: 0,
  closes: 0,
  revenue: 0,
  conversion_rate: 0,
  average_ticket: 0,
  follow_ups_completed: 0,
};

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') p.set(k, v);
  }
  const str = p.toString();
  return str ? `?${str}` : '';
}

/** Live (all-time) performance for a rep — GET /api/leaderboard/realtime/:userId. */
export function getRealtimeStats(userId: string): Promise<RepPerformanceDetail> {
  return serverGet<RepPerformanceDetail>(`/leaderboard/realtime/${userId}`);
}

/** Performance for a rep over a date window — GET /api/leaderboard/rep/:userId. */
export function getRepPerformance(
  userId: string,
  from: string,
  to: string,
): Promise<{ performance: RepPerformanceDetail }> {
  return serverGet(`/leaderboard/rep/${userId}${qs({ from, to })}`);
}
