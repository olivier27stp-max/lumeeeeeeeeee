// Leaderboard performance stats — same authed server routes the web
// RepProfile page uses (server/routes/leaderboard.ts). The server scopes to
// the caller's org from the JWT.

import { serverGet } from './server';

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
