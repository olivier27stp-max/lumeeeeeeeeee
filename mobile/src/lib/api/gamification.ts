// Field-sales gamification: badges, challenges, battles. Read-focused on mobile;
// a rep can join a challenge (insert their own participant row). Progress/scores
// are maintained server-side. Tables: fs_badges, fs_rep_badges, fs_challenges,
// fs_challenge_participants, fs_battles.

import { supabase } from '../supabase';

export interface EarnedBadge {
  id: string;
  earned_at: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
}

export interface Challenge {
  id: string;
  name: string;
  description: string | null;
  type: 'daily' | 'weekly';
  metric_slug: string;
  target_value: number | null;
  end_date: string;
  prize_description: string | null;
  my_value: number | null; // null = not joined
}

export interface Battle {
  id: string;
  name: string;
  type: 'rep_vs_rep' | 'team_vs_team';
  metric_slug: string;
  challenger_score: number;
  opponent_score: number;
  end_date: string;
  status: string;
}

/** Badges earned by a user, with the badge definition attached. */
export async function listMyBadges(orgId: string, userId: string): Promise<EarnedBadge[]> {
  const { data: earned, error } = await supabase
    .from('fs_rep_badges')
    .select('badge_id, earned_at')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .order('earned_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (earned ?? []) as { badge_id: string; earned_at: string }[];
  if (!rows.length) return [];

  const { data: defs } = await supabase
    .from('fs_badges')
    .select('id, name_fr, name_en, description_fr, description_en, icon, color')
    .in('id', rows.map((r) => r.badge_id));
  const byId = new Map((defs ?? []).map((d: any) => [d.id, d]));

  return rows.map((r) => {
    const d: any = byId.get(r.badge_id) ?? {};
    return {
      id: r.badge_id,
      earned_at: r.earned_at,
      name: d.name_fr || d.name_en || 'Badge',
      description: d.description_fr || d.description_en || null,
      icon: d.icon ?? null,
      color: d.color ?? null,
    };
  });
}

/** Active challenges + this user's progress (my_value = null if not joined). */
export async function listActiveChallenges(orgId: string, userId: string): Promise<Challenge[]> {
  const { data, error } = await supabase
    .from('fs_challenges')
    .select('id, name_fr, name_en, description_fr, description_en, type, metric_slug, target_value, end_date, prize_description')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .order('end_date', { ascending: true });
  if (error) throw new Error(error.message);
  const challenges = (data ?? []) as any[];
  if (!challenges.length) return [];

  const { data: parts } = await supabase
    .from('fs_challenge_participants')
    .select('challenge_id, current_value')
    .eq('user_id', userId)
    .in('challenge_id', challenges.map((c) => c.id));
  const mine = new Map((parts ?? []).map((p: any) => [p.challenge_id, Number(p.current_value)]));

  return challenges.map((c) => ({
    id: c.id,
    name: c.name_fr || c.name_en || 'Défi',
    description: c.description_fr || c.description_en || null,
    type: c.type,
    metric_slug: c.metric_slug,
    target_value: c.target_value != null ? Number(c.target_value) : null,
    end_date: c.end_date,
    prize_description: c.prize_description ?? null,
    my_value: mine.has(c.id) ? mine.get(c.id)! : null,
  }));
}

export async function joinChallenge(challengeId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('fs_challenge_participants')
    .insert({ challenge_id: challengeId, user_id: userId, current_value: 0 });
  if (error) throw new Error(error.message);
}

export async function listActiveBattles(orgId: string): Promise<Battle[]> {
  const { data, error } = await supabase
    .from('fs_battles')
    .select('id, name, type, metric_slug, challenger_score, opponent_score, end_date, status')
    .eq('org_id', orgId)
    .in('status', ['pending', 'active'])
    .order('end_date', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Battle[];
}
