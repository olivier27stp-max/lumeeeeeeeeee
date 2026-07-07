/**
 * Employee hourly rate — the labour-cost input the P&L reads. Stored on
 * team_members.hourly_rate_cents, keyed by the auth user_id so it joins to
 * time_entries.employee_id in profitabilityApi.fetchJobPnL. Because an org's
 * team_members rows may not exist yet (invites only create memberships), setting
 * a rate upserts the row for that user.
 */
import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

/** user_id → hourly rate in cents, for the current org. */
export async function fetchHourlyRates(): Promise<Record<string, number>> {
  try {
    const orgId = await getCurrentOrgIdOrThrow();
    const { data, error } = await supabase
      .from('team_members')
      .select('user_id, hourly_rate_cents')
      .eq('org_id', orgId);
    if (error) throw error;
    const map: Record<string, number> = {};
    for (const r of (data || []) as Array<{ user_id: string | null; hourly_rate_cents: number | null }>) {
      if (r.user_id) map[r.user_id] = Number(r.hourly_rate_cents) || 0;
    }
    return map;
  } catch {
    return {};
  }
}

/** Set an employee's hourly rate (cents); creates the team_members row if needed. */
export async function setHourlyRate(input: {
  userId: string;
  email: string | null;
  fullName: string | null;
  cents: number;
}): Promise<void> {
  const orgId = await getCurrentOrgIdOrThrow();
  const cents = Math.max(0, Math.round(input.cents));

  const { data: existing, error: selErr } = await supabase
    .from('team_members')
    .select('id')
    .eq('org_id', orgId)
    .eq('user_id', input.userId)
    .limit(1);
  if (selErr) throw selErr;

  if (existing && existing.length > 0) {
    const { error } = await supabase.from('team_members').update({ hourly_rate_cents: cents }).eq('id', (existing[0] as { id: string }).id);
    if (error) throw error;
  } else {
    const parts = (input.fullName || '').trim().split(/\s+/).filter(Boolean);
    const { error } = await supabase.from('team_members').insert({
      org_id: orgId,
      user_id: input.userId,
      email: input.email || '',
      first_name: parts[0] || '',
      last_name: parts.slice(1).join(' ') || '',
      hourly_rate_cents: cents,
    });
    if (error) throw error;
  }
}
