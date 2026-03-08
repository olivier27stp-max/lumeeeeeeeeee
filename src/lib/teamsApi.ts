import { supabase } from './supabase';

export interface TeamInput {
  name: string;
  color_hex?: string;
}

export interface TeamRecord {
  id: string;
  org_id: string;
  name: string;
  color_hex: string;
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
    .select('id,org_id,name,color_hex,created_at,updated_at,deleted_at')
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
    })
    .select('id,org_id,name,color_hex,created_at,updated_at,deleted_at')
    .single();

  if (error) throw error;
  return data as TeamRecord;
}

export async function updateTeam(teamId: string, input: TeamInput): Promise<TeamRecord> {
  const name = input.name.trim();
  if (!name) throw new Error('Team name is required.');

  const { data, error } = await supabase
    .from('teams')
    .update({
      name,
      color_hex: normalizeColorHex(input.color_hex),
      updated_at: new Date().toISOString(),
    })
    .eq('id', teamId)
    .select('id,org_id,name,color_hex,created_at,updated_at,deleted_at')
    .single();

  if (error) throw error;
  return data as TeamRecord;
}

export async function softDeleteTeam(teamId: string): Promise<void> {
  const nowIso = new Date().toISOString();

  const { error: teamError } = await supabase
    .from('teams')
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq('id', teamId);

  if (teamError) throw teamError;

  const { error: jobsError } = await supabase
    .from('jobs')
    .update({ team_id: null, updated_at: nowIso })
    .eq('team_id', teamId)
    .is('deleted_at', null);

  if (jobsError) throw jobsError;

  const { error: eventsError } = await supabase
    .from('schedule_events')
    .update({ team_id: null, updated_at: nowIso })
    .eq('team_id', teamId)
    .is('deleted_at', null);

  if (eventsError) throw eventsError;
}
