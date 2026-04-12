/**
 * Field Session Engine
 *
 * Manages field session lifecycle (start, pause, resume, end),
 * GPS breadcrumb recording, and check-in/check-out records.
 * Adapted from Clostra for Lume's org_id multi-tenancy model.
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export async function startSession(
  supabase: SupabaseClient,
  orgId: string,
  options: {
    userId: string;
    territoryId?: string;
    latitude: number;
    longitude: number;
  }
) {
  const { userId, territoryId, latitude, longitude } = options;

  // Ensure no active session already exists
  const { data: existing } = await supabase
    .from('fs_field_sessions')
    .select('id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .in('status', ['active', 'paused'])
    .maybeSingle();

  if (existing) {
    throw new Error('An active field session already exists. End it before starting a new one.');
  }

  const { data: session, error } = await supabase
    .from('fs_field_sessions')
    .insert({
      org_id: orgId,
      user_id: userId,
      territory_id: territoryId ?? null,
      status: 'active',
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Create check-in record
  await supabase.from('fs_check_in_records').insert({
    org_id: orgId,
    user_id: userId,
    session_id: session.id,
    type: 'check_in',
    lat: latitude,
    lng: longitude,
  });

  return session;
}

export async function endSession(
  supabase: SupabaseClient,
  orgId: string,
  sessionId: string,
  latitude: number,
  longitude: number
) {
  const { data: session, error: fetchErr } = await supabase
    .from('fs_field_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('org_id', orgId)
    .single();

  if (fetchErr) throw new Error(fetchErr.message);

  const startedAt = new Date(session.started_at);
  const now = new Date();
  const durationMinutes = Math.round(
    (now.getTime() - startedAt.getTime()) / 60000
  );

  const { data: updated, error } = await supabase
    .from('fs_field_sessions')
    .update({
      status: 'completed',
      completed_at: now.toISOString(),
      total_duration_minutes: durationMinutes,
      updated_at: now.toISOString(),
    })
    .eq('id', sessionId)
    .eq('org_id', orgId)
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Create check-out record
  await supabase.from('fs_check_in_records').insert({
    org_id: orgId,
    user_id: session.user_id,
    session_id: sessionId,
    type: 'check_out',
    lat: latitude,
    lng: longitude,
  });

  return updated;
}

export async function pauseSession(
  supabase: SupabaseClient,
  orgId: string,
  sessionId: string
) {
  const { data, error } = await supabase
    .from('fs_field_sessions')
    .update({
      status: 'paused',
      paused_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .eq('org_id', orgId)
    .eq('status', 'active')
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function resumeSession(
  supabase: SupabaseClient,
  orgId: string,
  sessionId: string
) {
  const { data, error } = await supabase
    .from('fs_field_sessions')
    .update({
      status: 'active',
      paused_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .eq('org_id', orgId)
    .eq('status', 'paused')
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// ---------------------------------------------------------------------------
// GPS tracking
// ---------------------------------------------------------------------------

export async function recordGpsPoint(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string,
  lat: number,
  lng: number,
  accuracy: number | null = null
) {
  const { data, error } = await supabase
    .from('fs_gps_points')
    .insert({
      session_id: sessionId,
      user_id: userId,
      lat,
      lng,
      accuracy,
      recorded_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function getGpsTrail(
  supabase: SupabaseClient,
  sessionId: string
) {
  const { data, error } = await supabase
    .from('fs_gps_points')
    .select('lat, lng, recorded_at')
    .eq('session_id', sessionId)
    .order('recorded_at', { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getActiveSession(
  supabase: SupabaseClient,
  orgId: string,
  userId: string
) {
  const { data, error } = await supabase
    .from('fs_field_sessions')
    .select('*')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .in('status', ['active', 'paused'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function getSessionHistory(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  dateRange: { from: string; to: string }
) {
  const { data, error } = await supabase
    .from('fs_field_sessions')
    .select('*')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .gte('started_at', dateRange.from)
    .lte('started_at', dateRange.to)
    .order('started_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getActiveSessions(
  supabase: SupabaseClient,
  orgId: string
) {
  const { data, error } = await supabase
    .from('fs_field_sessions')
    .select('*')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .order('started_at', { ascending: false });

  if (error) throw new Error(error.message);

  // Enrich with member info
  const userIds = (data ?? []).map((s) => s.user_id);
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

  return (data ?? []).map((session) => {
    const member = memberMap.get(session.user_id);
    return {
      ...session,
      rep_name: member?.full_name || 'Unknown',
      rep_avatar: member?.avatar_url || null,
    };
  });
}
