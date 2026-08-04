/**
 * Gamification Engine
 *
 * Manages challenges, battles, badges, and the social feed.
 * Adapted from Clostra for Lume's org_id multi-tenancy model.
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

export async function createChallenge(
  supabase: SupabaseClient,
  orgId: string,
  data: Record<string, unknown>
) {
  const { data: challenge, error } = await supabase
    .from('fs_challenges')
    .insert({ ...data, org_id: orgId })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return challenge;
}

export async function joinChallenge(
  supabase: SupabaseClient,
  orgId: string,
  challengeId: string,
  userId: string
) {
  // fs_challenge_participants n'a pas de colonne org_id : son cloisonnement
  // depend entierement du defi parent. Cet appel se fait en service_role, donc
  // la RLS ne filtre rien — sans cette verification, un utilisateur peut
  // s'inscrire au defi d'une autre organisation en fournissant son UUID.
  const { data: challenge, error: cErr } = await supabase
    .from('fs_challenges')
    .select('id')
    .eq('id', challengeId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (cErr) throw new Error(cErr.message);
  if (!challenge) throw new Error('Challenge not found');

  const { data, error } = await supabase
    .from('fs_challenge_participants')
    .insert({
      challenge_id: challengeId,
      user_id: userId,
      current_value: 0,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function updateChallengeProgress(
  supabase: SupabaseClient,
  orgId: string,
  challengeId: string
) {
  const { data: challenge, error: cErr } = await supabase
    .from('fs_challenges')
    .select('*')
    .eq('id', challengeId)
    .eq('org_id', orgId)
    .single();

  if (cErr) throw new Error(cErr.message);

  const { data: participants, error: pErr } = await supabase
    .from('fs_challenge_participants')
    .select('*')
    .eq('challenge_id', challengeId);

  if (pErr) throw new Error(pErr.message);

  // Le comptage ignorait metric_slug : un defi « portes cognees » comptait
  // aussi les notes et les ventes. Les types listes ici sont ceux reellement
  // presents dans field_house_events.event_type.
  const METRIC_EVENT_TYPES: Record<string, string[]> = {
    doors_knocked: ['knock'],
    knocks: ['knock'],
    leads: ['lead'],
    sales: ['sale'],
    closes: ['sale'],
    quotes_sent: ['quote_sent'],
    callbacks: ['callback'],
  };

  for (const participant of participants ?? []) {
    // Count events matching the metric slug within the challenge period
    const metricTypes = METRIC_EVENT_TYPES[String(challenge.metric_slug || '')] ?? null;
    let evQuery = supabase
      .from('field_house_events')
      .select('id')
      .eq('org_id', orgId)
      .eq('user_id', participant.user_id)
      .gte('created_at', challenge.start_date)
      .lte('created_at', challenge.end_date);
    if (metricTypes) evQuery = evQuery.in('event_type', metricTypes);
    const { data: events, error: evErr } = await evQuery;

    // Lecture ratée → 0 événement : on écrirait une progression fausse.
    if (evErr) {
      console.error(`[gamification] event count failed (org ${orgId}, challenge ${challengeId}, user ${participant.user_id}):`, evErr.message);
      continue;
    }

    const score = events?.length ?? 0;

    const { error: upErr } = await supabase
      .from('fs_challenge_participants')
      .update({ current_value: score, updated_at: new Date().toISOString() })
      .eq('id', participant.id);
    if (upErr) {
      console.error(`[gamification] progress update failed (org ${orgId}, challenge ${challengeId}, participant ${participant.id}):`, upErr.message);
    }
  }
}

export async function evaluateChallenge(
  supabase: SupabaseClient,
  orgId: string,
  challengeId: string
) {
  await updateChallengeProgress(supabase, orgId, challengeId);

  const { data: participants, error: pErr } = await supabase
    .from('fs_challenge_participants')
    .select('*')
    .eq('challenge_id', challengeId)
    .order('current_value', { ascending: false });

  if (pErr) throw new Error(pErr.message);

  const { error: closeErr } = await supabase
    .from('fs_challenges')
    .update({
      status: 'completed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', challengeId)
    .eq('org_id', orgId);

  if (closeErr) throw new Error(closeErr.message);

  if (participants && participants.length > 0) {
    const winner = participants[0];
    await checkAndAwardBadges(supabase, orgId, winner.user_id);
  }

  return participants ?? [];
}

export async function getActiveChallenges(
  supabase: SupabaseClient,
  orgId: string
) {
  const { data, error } = await supabase
    .from('fs_challenges')
    .select('*')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('end_date', { ascending: true });

  if (error) throw new Error(error.message);

  // Load participants for each challenge
  const challengeIds = (data ?? []).map((c) => c.id);
  const { data: allParticipants } = await supabase
    .from('fs_challenge_participants')
    .select('*')
    .in('challenge_id', challengeIds.length > 0 ? challengeIds : ['__none__']);

  // Enrich participant names
  const userIds = [...new Set((allParticipants ?? []).map((p) => p.user_id))];
  const { data: members } = userIds.length > 0
    ? await supabase
        .from('memberships')
        .select('user_id, full_name, avatar_url')
        .eq('org_id', orgId)
        .in('user_id', userIds)
    : { data: [] };

  const memberMap = new Map(
    (members ?? []).map((m) => [m.user_id, m])
  );

  return (data ?? []).map((challenge) => ({
    ...challenge,
    participants: (allParticipants ?? [])
      .filter((p) => p.challenge_id === challenge.id)
      .map((p) => {
        const member = memberMap.get(p.user_id);
        return {
          ...p,
          full_name: member?.full_name || 'Unknown',
          avatar_url: member?.avatar_url || null,
        };
      }),
  }));
}

// ---------------------------------------------------------------------------
// Battles
// ---------------------------------------------------------------------------

export async function createBattle(
  supabase: SupabaseClient,
  orgId: string,
  data: Record<string, unknown>
) {
  const { data: battle, error } = await supabase
    .from('fs_battles')
    .insert({ ...data, org_id: orgId })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return battle;
}

export async function getActiveBattles(
  supabase: SupabaseClient,
  orgId: string
) {
  const { data, error } = await supabase
    .from('fs_battles')
    .select('*')
    .eq('org_id', orgId)
    .in('status', ['pending', 'active'])
    .is('deleted_at', null)
    .order('start_date', { ascending: true });

  if (error) throw new Error(error.message);

  // Enrich with names
  const userIds = [
    ...new Set(
      (data ?? []).flatMap((b) =>
        [b.challenger_user_id, b.opponent_user_id].filter(Boolean)
      )
    ),
  ];

  const { data: members } = userIds.length > 0
    ? await supabase
        .from('memberships')
        .select('user_id, full_name')
        .eq('org_id', orgId)
        .in('user_id', userIds)
    : { data: [] };

  const nameMap = new Map(
    (members ?? []).map((m) => [m.user_id, m.full_name])
  );

  return (data ?? []).map((battle) => ({
    ...battle,
    challenger_name: nameMap.get(battle.challenger_user_id) || 'Unknown',
    opponent_name: nameMap.get(battle.opponent_user_id) || 'Unknown',
  }));
}

export async function updateBattleScores(
  supabase: SupabaseClient,
  orgId: string,
  battleId: string
) {
  const { data: battle, error } = await supabase
    .from('fs_battles')
    .select('*')
    .eq('id', battleId)
    .eq('org_id', orgId)
    .single();

  if (error) throw new Error(error.message);

  const countEvents = async (userId: string | null) => {
    if (!userId) return 0;
    const { count, error: cErr } = await supabase
      .from('field_house_events')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .gte('created_at', battle.start_date)
      .lte('created_at', battle.end_date);
    // Un comptage raté écrirait un score de 0 dans la battle.
    if (cErr) throw new Error(`Battle score count failed (org ${orgId}, battle ${battleId}, user ${userId}): ${cErr.message}`);
    return count ?? 0;
  };

  const challengerScore = await countEvents(battle.challenger_user_id);
  const opponentScore = await countEvents(battle.opponent_user_id);

  const { error: scoreErr } = await supabase
    .from('fs_battles')
    .update({
      challenger_score: challengerScore,
      opponent_score: opponentScore,
      updated_at: new Date().toISOString(),
    })
    .eq('id', battleId);

  if (scoreErr) throw new Error(scoreErr.message);

  return { challengerScore, opponentScore };
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export async function checkAndAwardBadges(
  supabase: SupabaseClient,
  orgId: string,
  userId: string
) {
  const { data: badges, error: badgesErr } = await supabase
    .from('fs_badges')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .is('deleted_at', null);
  if (badgesErr) {
    console.error(`[gamification] badge catalogue load failed (org ${orgId}, user ${userId}):`, badgesErr.message);
    return;
  }

  const { data: earned, error: earnedErr } = await supabase
    .from('fs_rep_badges')
    .select('badge_id')
    .eq('org_id', orgId)
    .eq('user_id', userId);
  // Sans la liste des badges déjà gagnés on ré-attribuerait les mêmes badges.
  if (earnedErr) {
    console.error(`[gamification] earned badges load failed (org ${orgId}, user ${userId}):`, earnedErr.message);
    return;
  }

  const earnedIds = new Set((earned ?? []).map((e) => e.badge_id));

  for (const badge of badges ?? []) {
    if (earnedIds.has(badge.id)) continue;

    const criteria = badge.criteria as Record<string, unknown> | null;
    if (!criteria) continue;

    // Check each criterion
    let qualified = true;

    if (criteria.doors_knocked) {
      const { count, error: knockErr } = await supabase
        .from('field_house_events')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .in('event_type', ['knock', 'door_knock']);
      if (knockErr) {
        console.error(`[gamification] doors_knocked count failed (org ${orgId}, user ${userId}, badge ${badge.id}):`, knockErr.message);
        continue;
      }
      if ((count ?? 0) < (criteria.doors_knocked as number)) qualified = false;
    }

    if (criteria.closes) {
      const { count, error: closeErr } = await supabase
        .from('field_house_events')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .in('event_type', ['sale', 'lead', 'closed_won']);
      if (closeErr) {
        console.error(`[gamification] closes count failed (org ${orgId}, user ${userId}, badge ${badge.id}):`, closeErr.message);
        continue;
      }
      if ((count ?? 0) < (criteria.closes as number)) qualified = false;
    }

    if (qualified) {
      const { error: awardErr } = await supabase.from('fs_rep_badges').insert({
        org_id: orgId,
        user_id: userId,
        badge_id: badge.id,
      });
      if (awardErr) {
        console.error(`[gamification] badge award failed (org ${orgId}, user ${userId}, badge ${badge.id}):`, awardErr.message);
      }
    }
  }
}

export async function getRepBadges(
  supabase: SupabaseClient,
  orgId: string,
  userId: string
) {
  const { data, error } = await supabase
    .from('fs_rep_badges')
    .select('*, badge:fs_badges!fs_rep_badges_badge_id_fkey(*)')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .order('earned_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getBadges(
  supabase: SupabaseClient,
  orgId: string
) {
  const { data, error } = await supabase
    .from('fs_badges')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createBadge(
  supabase: SupabaseClient,
  orgId: string,
  badgeData: Record<string, unknown>
) {
  const { data, error } = await supabase
    .from('fs_badges')
    .insert({ ...badgeData, org_id: orgId })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}
