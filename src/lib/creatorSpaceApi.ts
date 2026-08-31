// Client API du Creator Space (espace interne plateforme, platformAdminIds).
// Même idiome que migrationAdminApi : Bearer + x-org-id (l'org n'est pas
// utilisée par ces routes mais le header reste uniforme et inoffensif).

import { supabase } from './supabase';

const BASE = '/api/creator-space';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  let activeOrg = '';
  try {
    activeOrg = localStorage.getItem('lume-active-org') || '';
  } catch {
    activeOrg = '';
  }
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-org-id': activeOrg };
}

async function apiFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${BASE}${path}`, {
    headers,
    method: init?.method ?? 'GET',
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

export async function checkCreatorAccess(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return false;
    const res = await fetch(`${BASE}/check`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return false;
    const body = await res.json();
    return !!body?.isCreator;
  } catch {
    return false;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface CreatorOverview {
  totals: {
    companies: number;
    users: number;
    active_companies_7d: number;
    active_companies_30d: number;
    inactive_companies_30d: number;
    new_companies_30d: number;
    subscriptions_active: number;
    subscriptions_past_due: number;
  };
  recent_events: Array<{
    id: string;
    org_id: string;
    org_name: string | null;
    actor_id: string | null;
    action: string | null;
    entity_type: string | null;
    created_at: string;
  }>;
}

export type LogSource = 'audit' | 'activity' | 'security';

export interface CreatorLogRow {
  id: string;
  org_id: string | null;
  org_name: string | null;
  actor_id: string | null;
  action?: string | null;
  event_type?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  severity?: string | null;
  source?: string | null;
  resolved?: boolean | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

export type EngagementLevel = 'high' | 'medium' | 'low' | 'inactive';

export interface WorkspaceEngagement {
  id: string;
  name: string;
  created_at: string;
  member_count: number;
  jobs_30d: number;
  logins_30d: number;
  last_activity: string;
  days_since_activity: number;
  engagement: EngagementLevel;
}

export interface CompanyListItem {
  id: string;
  name: string;
  org_name: string;
  logo_url: string | null;
  company_group_id: string | null;
  created_at: string;
  owner_id: string | null;
  owner_name: string | null;
  contact_email: string | null;
  member_count: number;
  subscription_status: string | null;
  plan_name: string | null;
  plan_slug: string | null;
}

export interface SafeSubscription {
  status: string;
  interval: string | null;
  currency: string | null;
  amount_cents: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean | null;
  canceled_at: string | null;
  created_at: string;
  extra_seats: number;
  extra_offices: number;
  plan: { name: string; name_fr: string; slug: string; seats_included: number | null; included_offices: number | null } | null;
}

export interface CompanyDetail {
  id: string;
  name: string;
  org_name: string;
  logo_url: string | null;
  company_group_id: string | null;
  created_at: string;
  owner: { id: string; name: string | null; email: string | null } | null;
  contact: {
    email: string | null;
    phone: string | null;
    website: string | null;
    city: string | null;
    province: string | null;
    country: string | null;
    industry: string | null;
    timezone: string | null;
  } | null;
  member_count: number;
  offices: Array<{ id: string; name: string; created_at: string; is_current: boolean }>;
  subscription: SafeSubscription | null;
}

export interface CompanyUser {
  user_id: string;
  name: string | null;
  avatar_url: string | null;
  email: string | null;
  role: string;
  scope: string;
  status: string;
  created_at: string;
  last_sign_in_at: string | null;
}

export interface CompanyBilling {
  current: SafeSubscription | null;
  history: SafeSubscription[];
  receipts: Array<{
    id: string;
    email_type: string;
    status: string;
    amount_cents: number | null;
    currency: string | null;
    plan_name: string | null;
    sent_at: string | null;
    created_at: string;
  }>;
}

export interface CompanyPermissions {
  role_counts: Record<string, number>;
  data: Array<{
    user_id: string;
    name: string | null;
    role: string;
    scope: string;
    status: string;
    permissions_custom: boolean;
    overrides: Array<{ key: string; value: boolean }>;
  }>;
}

export interface CompanyEngagement {
  last_activity: string | null;
  logins_30d: number;
  active_users_30d: number;
  jobs_30d: number;
  totals: { clients: number; jobs: number; quotes: number; invoices: number };
  recent_activity: Array<{
    id: string;
    event_type: string;
    entity_type: string;
    actor_id: string | null;
    created_at: string;
  }>;
  caveats: string[];
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
}

// ── Appels ────────────────────────────────────────────────────────────────

export function getOverview(): Promise<CreatorOverview> {
  return apiFetch('/overview');
}

export function getLogs(params: { source?: LogSource; org?: string; q?: string; page?: number }): Promise<Paginated<CreatorLogRow> & { source: LogSource }> {
  const sp = new URLSearchParams();
  if (params.source) sp.set('source', params.source);
  if (params.org) sp.set('org', params.org);
  if (params.q) sp.set('q', params.q);
  if (params.page) sp.set('page', String(params.page));
  return apiFetch(`/logs?${sp.toString()}`);
}

export function getEngagement(params: { level?: EngagementLevel | ''; page?: number }): Promise<Paginated<WorkspaceEngagement> & { counts: Record<'all' | EngagementLevel, number> }> {
  const sp = new URLSearchParams();
  if (params.level) sp.set('level', params.level);
  if (params.page) sp.set('page', String(params.page));
  return apiFetch(`/engagement?${sp.toString()}`);
}

export function listCompanies(params: { q?: string; page?: number }): Promise<Paginated<CompanyListItem>> {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.page) sp.set('page', String(params.page));
  return apiFetch(`/companies?${sp.toString()}`);
}

export function getCompany(orgId: string): Promise<CompanyDetail> {
  return apiFetch(`/companies/${orgId}`);
}

export function getCompanyUsers(orgId: string): Promise<{ data: CompanyUser[] }> {
  return apiFetch(`/companies/${orgId}/users`);
}

export function getCompanyBilling(orgId: string): Promise<CompanyBilling> {
  return apiFetch(`/companies/${orgId}/billing`);
}

export function getCompanyPermissions(orgId: string): Promise<CompanyPermissions> {
  return apiFetch(`/companies/${orgId}/permissions`);
}

/** Révèle le nom derrière un identifiant d'utilisateur d'un autre tenant.
 *  La raison est obligatoire et journalisée côté serveur
 *  (creator_space_reveal) — pas de trace, pas de révélation. */
export function revealActor(userId: string, reason: string): Promise<{ user_id: string; name: string | null }> {
  return apiFetch('/reveal-actor', { method: 'POST', body: { user_id: userId, reason } });
}

export function getCompanyEngagement(orgId: string): Promise<CompanyEngagement> {
  return apiFetch(`/companies/${orgId}/engagement`);
}
