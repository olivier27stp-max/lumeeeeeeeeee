import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

export interface TeamInput {
  name: string;
  color_hex?: string;
  description?: string;
  is_active?: boolean;
}

export interface TeamRecord {
  id: string;
  org_id: string;
  name: string;
  color_hex: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  deleted_at?: string | null;
}

const DEFAULT_TEAM_COLOR = '#3B82F6';

function normalizeColorHex(color?: string | null) {
  const value = (color || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  return DEFAULT_TEAM_COLOR;
}

export async function listTeams(): Promise<TeamRecord[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('id,org_id,name,color_hex,description,is_active,created_at,updated_at,deleted_at')
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (error) throw error;
  return (data || []) as TeamRecord[];
}

export async function createTeam(input: TeamInput): Promise<TeamRecord> {
  const name = input.name.trim();
  if (!name) throw new Error('Team name is required.');

  const { data, error } = await supabase
    .from('teams')
    .insert({
      name,
      color_hex: normalizeColorHex(input.color_hex),
      description: input.description?.trim() || null,
      is_active: input.is_active ?? true,
    })
    .select('id,org_id,name,color_hex,description,is_active,created_at,updated_at,deleted_at')
    .single();

  if (error) throw error;
  return data as TeamRecord;
}

export async function updateTeam(teamId: string, input: TeamInput): Promise<TeamRecord> {
  const name = input.name.trim();
  if (!name) throw new Error('Team name is required.');

  const payload: Record<string, unknown> = {
    name,
    color_hex: normalizeColorHex(input.color_hex),
    updated_at: new Date().toISOString(),
  };
  if (input.description !== undefined) payload.description = input.description.trim() || null;
  if (input.is_active !== undefined) payload.is_active = input.is_active;

  const { data, error } = await supabase
    .from('teams')
    .update(payload)
    .eq('id', teamId)
    .select('id,org_id,name,color_hex,description,is_active,created_at,updated_at,deleted_at')
    .single();

  if (error) throw error;
  return data as TeamRecord;
}

export async function softDeleteTeam(teamId: string): Promise<void> {
  const orgId = await getCurrentOrgIdOrThrow();
  const nowIso = new Date().toISOString();

  const { error: teamError } = await supabase
    .from('teams')
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq('id', teamId)
    .eq('org_id', orgId);

  if (teamError) throw teamError;

  const { error: jobsError } = await supabase
    .from('jobs')
    .update({ team_id: null, updated_at: nowIso })
    .eq('team_id', teamId)
    .eq('org_id', orgId)
    .is('deleted_at', null);

  if (jobsError) throw jobsError;

  const { error: eventsError } = await supabase
    .from('schedule_events')
    .update({ team_id: null, updated_at: nowIso })
    .eq('team_id', teamId)
    .eq('org_id', orgId)
    .is('deleted_at', null);

  if (eventsError) throw eventsError;
}
