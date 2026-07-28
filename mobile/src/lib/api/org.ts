// Team + company-settings reads/writes (admin/owner). Direct Supabase under RLS.

import { supabase } from '../supabase';
import { changeMemberRole } from './server';

export interface Member {
  user_id: string;
  org_id: string;
  role: string;
  status: string | null;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

/** Merge a memberships row with the matching profile (names/emails live there). */
async function withProfiles(orgId: string, rows: any[]): Promise<Member[]> {
  const ids = rows.map((r) => r.user_id).filter(Boolean);
  const profileById = new Map<string, any>();
  if (ids.length) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .in('id', ids);
    for (const p of profiles ?? []) profileById.set(p.id, p);
  }
  return rows.map((r): Member => {
    const p = profileById.get(r.user_id);
    return {
      user_id: r.user_id,
      org_id: orgId,
      role: r.role,
      status: r.status ?? null,
      full_name: r.full_name || p?.full_name || null,
      email: null, // profiles has no email column on this project

      avatar_url: p?.avatar_url || r.avatar_url || null,
    };
  });
}

export interface TeamRow {
  id: string;
  name: string;
  color_hex: string | null;
}

/** Active teams for the org — powers the owner/admin team filter on Schedule. */
export async function listTeams(orgId: string): Promise<TeamRow[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('id, name, color_hex')
    .eq('org_id', orgId)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as TeamRow[];
}

export async function listMembers(orgId: string): Promise<Member[]> {
  const { data, error } = await supabase
    .from('memberships')
    .select('user_id, role, status, full_name, avatar_url')
    .eq('org_id', orgId)
    .in('status', ['active', 'pending']);
  if (error) throw new Error(error.message);
  const order = { owner: 0, admin: 1, sales_rep: 2, technician: 3, member: 4 } as Record<string, number>;
  const members = await withProfiles(orgId, data ?? []);
  return members.sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9));
}

export async function getMember(userId: string, orgId: string): Promise<Member | null> {
  const { data, error } = await supabase
    .from('memberships')
    .select('user_id, role, status, full_name, avatar_url')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return (await withProfiles(orgId, [data]))[0];
}

export async function updateMemberRole(userId: string, _orgId: string, role: string): Promise<void> {
  // Routed through the RBAC-guarded server endpoint (server enforces owner/admin,
  // owner-protection and demotion rules) rather than a direct memberships write.
  // The org is derived server-side from the caller's auth, so _orgId is unused.
  await changeMemberRole(userId, role);
}

export interface CompanySettings {
  org_id: string;
  company_name: string | null;
  logo_url: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  // The table uses two address lines (street1/street2) — same columns the web
  // writes, so company details sync both ways. There is no `street` column.
  street1: string | null;
  street2: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  country: string | null;
  /** Objectif de revenus (cents) — le diagramme d'objectif d'Insights le lit. */
  revenue_goal_cents: number | null;
  /** Devise d'affichage (CAD/USD). */
  currency: string | null;
  google_review_url: string | null;
  review_enabled: boolean | null;
}

const COMPANY_COLS =
  'org_id, company_name, logo_url, phone, email, website, street1, street2, city, province, postal_code, country, revenue_goal_cents, currency, google_review_url, review_enabled';

export async function getCompany(orgId: string): Promise<CompanySettings | null> {
  const { data, error } = await supabase
    .from('company_settings')
    .select(COMPANY_COLS)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CompanySettings | null) ?? null;
}

export async function updateCompany(
  orgId: string,
  input: Partial<Omit<CompanySettings, 'org_id'>>,
): Promise<void> {
  // Update if a row exists, else insert one for this org.
  const { data: existing } = await supabase
    .from('company_settings')
    .select('org_id')
    .eq('org_id', orgId)
    .maybeSingle();
  if (existing) {
    const { error } = await supabase
      .from('company_settings')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('org_id', orgId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from('company_settings').insert({ org_id: orgId, ...input });
    if (error) throw new Error(error.message);
  }
  // Keep the org's name in sync — same rule as the web CompanySettings page,
  // which is the single source for the company name.
  if (input.company_name && input.company_name.trim()) {
    await supabase.from('orgs').update({ name: input.company_name.trim() }).eq('id', orgId);
  }
}

export interface ReferralSummary {
  referrals: number; // friends who used the code (signed up or further)
  subscribed: number; // friends who became paying customers
  rewardedCents: number; // total reward earned
  pendingCents: number; // reward pending (subscribed but not yet paid out)
  currency: string;
}

/** Counts + rewards for the user's referrals (rows where a friend was attached). */
export async function getReferralSummary(userId: string): Promise<ReferralSummary> {
  const { data, error } = await supabase
    .from('referrals')
    .select('status, reward_amount_cents, reward_currency, referred_user_id, referred_email, referred_org_id')
    .eq('referrer_user_id', userId);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as any[]).filter(
    (r) => r.referred_user_id || r.referred_email || r.referred_org_id,
  );
  let referrals = 0;
  let subscribed = 0;
  let rewardedCents = 0;
  let pendingCents = 0;
  let currency = 'CAD';
  for (const r of rows) {
    referrals += 1;
    currency = r.reward_currency || currency;
    if (['subscribed', 'reward_pending', 'rewarded'].includes(r.status)) subscribed += 1;
    if (r.status === 'rewarded') rewardedCents += r.reward_amount_cents ?? 0;
    else if (['subscribed', 'reward_pending'].includes(r.status)) pendingCents += r.reward_amount_cents ?? 0;
  }
  return { referrals, subscribed, rewardedCents, pendingCents, currency };
}

/** Get or create the user's referral code (best effort). */
export async function getReferralCode(userId: string, orgId: string): Promise<string> {
  const { data: existing } = await supabase
    .from('referrals')
    .select('code')
    .eq('referrer_user_id', userId)
    .not('code', 'is', null)
    .limit(1)
    .maybeSingle();
  if (existing?.code) return existing.code as string;

  const code = `LUME-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  try {
    await supabase.from('referrals').insert({
      referrer_user_id: userId,
      referrer_org_id: orgId,
      code,
      status: 'pending',
    });
  } catch {
    // best effort — still return a shareable code even if not stored
  }
  return code;
}
