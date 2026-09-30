/**
 * Employee hourly rate — the labour-cost input the P&L reads. Stored on
 * team_members.hourly_rate_cents, keyed by the auth user_id so it joins to
 * time_entries.employee_id in profitabilityApi.fetchJobPnL. Because an org's
 * team_members rows may not exist yet (invites only create memberships), setting
 * a rate upserts the row for that user.
 */
import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

export interface RemunerationMembre {
  teamMemberId: string;
  userId: string | null;
  hourlyRateCents: number;
  labourCostHourly: number | null;
  birthDate: string | null;
}

/**
 * Taux horaires et date de naissance : ces colonnes ne sont PAS lisibles en direct (grants par
 * colonne, migration 20261004300300). La base rend sa propre fiche, ou toute l'équipe avec
 * team.update / financial.view_margins / financial.view_reports (date de naissance d'un autre : team.update seulement).
 */
export async function fetchRemunerations(orgId?: string): Promise<RemunerationMembre[]> {
  const p_org = orgId ?? await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase.rpc('membres_remuneration', { p_org });
  if (error) throw error;
  return ((data || []) as Array<{ team_member_id: string; user_id: string | null; hourly_rate_cents: number | null; labour_cost_hourly: number | string | null; birth_date: string | null }>).map((r) => ({
    teamMemberId: r.team_member_id,
    userId: r.user_id,
    hourlyRateCents: Number(r.hourly_rate_cents) || 0,
    labourCostHourly: r.labour_cost_hourly == null ? null : Number(r.labour_cost_hourly),
    birthDate: r.birth_date,
  }));
}

/** user_id → hourly rate in cents, for the current org (only the rows the caller may see). */
export async function fetchHourlyRates(): Promise<Record<string, number>> {
  try {
    const map: Record<string, number> = {};
    for (const r of await fetchRemunerations()) {
      if (r.userId) map[r.userId] = r.hourlyRateCents;
    }
    return map;
  } catch (err) {
    console.error('fetchHourlyRates failed:', err);
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
      phone: '',
      hourly_rate_cents: cents,
    });
    if (error) throw error;
  }
}
