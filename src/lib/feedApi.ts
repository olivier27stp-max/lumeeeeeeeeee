// Feed API — direct Supabase client for fs_feed_* tables.
// Requires migration 20260613000000_clostra_gamification_commissions.sql to be applied.
// Without it, calls will return Postgres error 42P01 (relation does not exist).
import { supabase } from './supabase';
import type { FsFeedPost, FsFeedReaction, FsFeedComment, FeedReactionEmoji } from '../types';

// ── Posts ──────────────────────────────────────────────────────────────

export async function listFeedPosts(orgId: string, limit = 50): Promise<FsFeedPost[]> {
  const { data, error } = await supabase
    .from('fs_feed_posts')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as FsFeedPost[];
}

export async function getFeedPost(id: string): Promise<FsFeedPost | null> {
  const { data, error } = await supabase
    .from('fs_feed_posts')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as FsFeedPost | null;
}

export async function createFeedPost(
  input: Partial<FsFeedPost> & { org_id: string; user_id: string }
): Promise<FsFeedPost> {
  const { data, error } = await supabase
    .from('fs_feed_posts')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data as FsFeedPost;
}

export async function updateFeedPost(id: string, patch: Partial<FsFeedPost>): Promise<FsFeedPost> {
  const { data, error } = await supabase
    .from('fs_feed_posts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as FsFeedPost;
}

export async function deleteFeedPost(id: string): Promise<void> {
  const { error } = await supabase
    .from('fs_feed_posts')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ── Reactions ───────────────────────────────────────────────────────────

export async function listReactions(postId: string): Promise<FsFeedReaction[]> {
  const { data, error } = await supabase
    .from('fs_feed_reactions')
    .select('*')
    .eq('post_id', postId);
  if (error) throw error;
  return (data ?? []) as FsFeedReaction[];
}

export async function addReaction(
  postId: string,
  userId: string,
  emoji: FeedReactionEmoji
): Promise<FsFeedReaction> {
  // Upsert on (post_id, user_id) — one reaction per user per post.
  const { data, error } = await supabase
    .from('fs_feed_reactions')
    .upsert({ post_id: postId, user_id: userId, emoji }, { onConflict: 'post_id,user_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data as FsFeedReaction;
}

export async function removeReaction(postId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('fs_feed_reactions')
    .delete()
    .eq('post_id', postId)
    .eq('user_id', userId);
  if (error) throw error;
}

// ── Comments ────────────────────────────────────────────────────────────

export async function listComments(postId: string): Promise<FsFeedComment[]> {
  const { data, error } = await supabase
    .from('fs_feed_comments')
    .select('*')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as FsFeedComment[];
}

export async function addComment(
  postId: string,
  userId: string,
  body: string
): Promise<FsFeedComment> {
  const { data, error } = await supabase
    .from('fs_feed_comments')
    .insert({ post_id: postId, user_id: userId, body })
    .select('*')
    .single();
  if (error) throw error;
  return data as FsFeedComment;
}

export async function updateComment(id: string, body: string): Promise<FsFeedComment> {
  const { data, error } = await supabase
    .from('fs_feed_comments')
    .update({ body, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as FsFeedComment;
}

export async function deleteComment(id: string): Promise<void> {
  const { error } = await supabase.from('fs_feed_comments').delete().eq('id', id);
  if (error) throw error;
}
