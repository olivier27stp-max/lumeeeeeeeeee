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
  challengeId: string,
  userId: string
) {
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

  for (const participant of participants ?? []) {
    // Count events matching the metric slug within the challenge period
    const { data: events } = await supabase
      .from('field_house_events')
      .select('id')
      .eq('org_id', orgId)
      .eq('created_by', participant.user_id)
      .gte('created_at', challenge.start_date)
      .lte('created_at', challenge.end_date);

    const score = events?.length ?? 0;

    await supabase
      .from('fs_challenge_participants')
      .update({ current_value: score, updated_at: new Date().toISOString() })
      .eq('id', participant.id);
  }
}

export async function evaluateChallenge(
  supabase: SupabaseClient,
  orgId: string,
  challengeId: string
) {
  await updateChallengeProgress(supabase, orgId, challengeId);

  const { data: participants } = await supabase
    .from('fs_challenge_participants')
    .select('*')
    .eq('challenge_id', challengeId)
    .order('current_value', { ascending: false });

  await supabase
    .from('fs_challenges')
    .update({
      status: 'completed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', challengeId)
    .eq('org_id', orgId);

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
    const { count } = await supabase
      .from('field_house_events')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('created_by', userId)
      .gte('created_at', battle.start_date)
      .lte('created_at', battle.end_date);
    return count ?? 0;
  };

  const challengerScore = await countEvents(battle.challenger_user_id);
  const opponentScore = await countEvents(battle.opponent_user_id);

  await supabase
    .from('fs_battles')
    .update({
      challenger_score: challengerScore,
      opponent_score: opponentScore,
      updated_at: new Date().toISOString(),
    })
    .eq('id', battleId);

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
  const { data: badges } = await supabase
    .from('fs_badges')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .is('deleted_at', null);

  const { data: earned } = await supabase
    .from('fs_rep_badges')
    .select('badge_id')
    .eq('org_id', orgId)
    .eq('user_id', userId);

  const earnedIds = new Set((earned ?? []).map((e) => e.badge_id));

  for (const badge of badges ?? []) {
    if (earnedIds.has(badge.id)) continue;

    const criteria = badge.criteria as Record<string, unknown> | null;
    if (!criteria) continue;

    // Check each criterion
    let qualified = true;

    if (criteria.doors_knocked) {
      const { count } = await supabase
        .from('field_house_events')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('created_by', userId)
        .in('status', ['knock', 'door_knock']);
      if ((count ?? 0) < (criteria.doors_knocked as number)) qualified = false;
    }

    if (criteria.closes) {
      const { count } = await supabase
        .from('field_house_events')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('created_by', userId)
        .in('status', ['sale', 'lead', 'closed_won']);
      if ((count ?? 0) < (criteria.closes as number)) qualified = false;
    }

    if (qualified) {
      await supabase.from('fs_rep_badges').insert({
        org_id: orgId,
        user_id: userId,
        badge_id: badge.id,
      });

      // Create feed post for badge award
      await supabase.from('fs_feed_posts').insert({
        org_id: orgId,
        user_id: userId,
        type: 'badge',
        visibility: 'company',
        title: badge.name_en,
        body: badge.description_en,
        reference_type: 'badge',
        reference_id: badge.id,
      });
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
    .select('*, badge:fs_badges(*)')
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

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

export async function createFeedPost(
  supabase: SupabaseClient,
  orgId: string,
  data: Record<string, unknown>
) {
  const { data: post, error } = await supabase
    .from('fs_feed_posts')
    .insert({ ...data, org_id: orgId })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return post;
}

export async function getFeed(
  supabase: SupabaseClient,
  orgId: string,
  options: { visibility?: string; teamId?: string; cursor?: string; userId?: string }
) {
  let query = supabase
    .from('fs_feed_posts')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(20);

  if (options.visibility) query = query.eq('visibility', options.visibility);
  if (options.teamId) query = query.eq('team_id', options.teamId);
  if (options.cursor) query = query.lt('created_at', options.cursor);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const posts = data ?? [];
  if (posts.length === 0) return [];

  // Enrich with author info
  const authorIds = [...new Set(posts.map((p) => p.user_id))];
  const { data: members } = await supabase
    .from('memberships')
    .select('user_id, full_name, avatar_url')
    .eq('org_id', orgId)
    .in('user_id', authorIds);

  const memberMap = new Map(
    (members ?? []).map((m) => [m.user_id, m])
  );

  // Get reactions for all posts
  const postIds = posts.map((p) => p.id);
  const { data: reactions } = await supabase
    .from('fs_feed_reactions')
    .select('*')
    .in('post_id', postIds);

  // Get comments for all posts
  const { data: comments } = await supabase
    .from('fs_feed_comments')
    .select('*')
    .in('post_id', postIds)
    .order('created_at', { ascending: true });

  // Enrich comment authors
  const commentAuthorIds = [...new Set((comments ?? []).map((c) => c.user_id))];
  const { data: commentMembers } = commentAuthorIds.length > 0
    ? await supabase
        .from('memberships')
        .select('user_id, full_name, avatar_url')
        .eq('org_id', orgId)
        .in('user_id', commentAuthorIds)
    : { data: [] };

  const commentMemberMap = new Map(
    (commentMembers ?? []).map((m) => [m.user_id, m])
  );

  return posts.map((post) => {
    const author = memberMap.get(post.user_id);
    const postReactions = (reactions ?? []).filter((r) => r.post_id === post.id);
    const postComments = (comments ?? []).filter((c) => c.post_id === post.id);

    // Count reactions by emoji
    const reactionCounts: Record<string, number> = {};
    for (const r of postReactions) {
      reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1;
    }

    const myReaction = options.userId
      ? postReactions.find((r) => r.user_id === options.userId)?.emoji || null
      : null;

    return {
      ...post,
      author_name: author?.full_name || 'Unknown',
      author_avatar: author?.avatar_url || null,
      reaction_counts: reactionCounts,
      my_reaction: myReaction,
      reactions: postReactions,
      comments: postComments.map((c) => {
        const ca = commentMemberMap.get(c.user_id);
        return {
          ...c,
          author_name: ca?.full_name || 'Unknown',
          author_avatar: ca?.avatar_url || null,
        };
      }),
    };
  });
}

export async function addReaction(
  supabase: SupabaseClient,
  postId: string,
  userId: string,
  emoji: string
) {
  // Upsert: replace existing reaction
  await supabase
    .from('fs_feed_reactions')
    .delete()
    .eq('post_id', postId)
    .eq('user_id', userId);

  const { data, error } = await supabase
    .from('fs_feed_reactions')
    .insert({ post_id: postId, user_id: userId, emoji })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function removeReaction(
  supabase: SupabaseClient,
  postId: string,
  userId: string
) {
  const { error } = await supabase
    .from('fs_feed_reactions')
    .delete()
    .eq('post_id', postId)
    .eq('user_id', userId);

  if (error) throw new Error(error.message);
}

export async function addComment(
  supabase: SupabaseClient,
  postId: string,
  userId: string,
  body: string
) {
  const { data, error } = await supabase
    .from('fs_feed_comments')
    .insert({ post_id: postId, user_id: userId, body })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}
