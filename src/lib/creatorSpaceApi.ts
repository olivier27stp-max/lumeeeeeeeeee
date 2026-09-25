// Client API du Creator Space (espace interne plateforme, platformAdminIds).
// Même idiome que migrationAdminApi : Bearer + x-org-id (l'org n'est pas
// utilisée par ces routes mais le header reste uniforme et inoffensif).

import { supabase } from './supabase';
import { bureauActifSync } from './orgApi';

const BASE = '/api/creator-space';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  let activeOrg = '';
  try {
    activeOrg = bureauActifSync() || '';
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

/** Un bureau (org) d'un workspace. */
export interface CompanyOffice {
  id: string;
  name: string;
  org_name: string;
  member_count: number;
  created_at: string;
  /** Bureau porteur de l'abonnement (sinon le plus ancien) — celui que le
   *  panneau ouvre quand on clique le workspace. */
  is_primary: boolean;
}

/** Un WORKSPACE (company_group ; une org sans groupe = son propre workspace).
 *  `id` = bureau principal ; `member_count` = utilisateurs distincts tous
 *  bureaux confondus. */
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
  offices: CompanyOffice[];
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
  plan: { name: string; name_fr: string; slug: string; seats_included: number | null } | null;
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

export type FeatureOverrideState = 'inherit' | 'on' | 'off';

export interface CompanyFeature {
  key: string;
  kind: 'plan' | 'module';
  label: string;
  description: string;
  /** Défaut hors override : forfait (plan) ou choix du tenant (module). null = aucun forfait. */
  inherited: boolean | null;
  override: FeatureOverrideState;
  effective: boolean | null;
  updated_at: string | null;
}

export interface CompanyOfficesQuota {
  /** Bureaux autorisés pour ce workspace (1 par défaut, relevé par la plateforme). */
  quota: number;
  default_quota: number;
  /** Bureaux compris dans le forfait de la compagnie (Autopilot = 2). */
  plan_quota?: number;
  max_quota: number;
  /** Bureaux existants (orgs du company_group). */
  used: number;
  updated_at: string | null;
  list: Array<{ id: string; name: string; created_at: string; is_current: boolean }>;
}

export interface CompanyFeatures {
  plan: { name: string; name_fr: string; slug: string } | null;
  office_count: number;
  features: CompanyFeature[];
  offices: CompanyOfficesQuota;
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

// ── Notes internes par workspace ────────────────────────────────────────
export interface CompanyNote {
  id: string;
  org_id: string;
  author_id: string;
  author_name: string | null;
  body: string;
  created_at: string;
  /** L'utilisateur courant est l'auteur : peut la retirer. */
  can_delete: boolean;
}

export function getCompanyNotes(orgId: string): Promise<{ data: CompanyNote[] }> {
  return apiFetch(`/companies/${orgId}/notes`);
}

export function addCompanyNote(orgId: string, body: string): Promise<CompanyNote> {
  return apiFetch(`/companies/${orgId}/notes`, { method: 'POST', body: { body } });
}

export function deleteCompanyNote(orgId: string, noteId: string): Promise<{ ok: true }> {
  return apiFetch(`/companies/${orgId}/notes/${noteId}`, { method: 'DELETE' });
}

export function getCompanyEngagement(orgId: string): Promise<CompanyEngagement> {
  return apiFetch(`/companies/${orgId}/engagement`);
}

export function getCompanyFeatures(orgId: string): Promise<CompanyFeatures> {
  return apiFetch(`/companies/${orgId}/features`);
}

/** Force (on), bloque (off) ou rend au forfait (inherit) une fonctionnalité
 *  pour tous les bureaux de la compagnie. La raison est obligatoire et
 *  journalisée côté serveur (creator_space_feature_override) avant l'écriture. */
/** Relève ou abaisse le quota de bureaux du workspace (tous ses bureaux).
 *  Abaisser sous les bureaux existants n'en supprime aucun. Raison
 *  obligatoire, journalisée (creator_space_office_quota). */
export function setCompanyOfficeQuota(orgId: string, quota: number, reason: string): Promise<{ ok: true; quota: number; used: number; org_ids: string[] }> {
  return apiFetch(`/companies/${orgId}/office-quota`, { method: 'PUT', body: { quota, reason } });
}

export function setCompanyFeature(orgId: string, key: string, state: FeatureOverrideState, reason: string): Promise<{ ok: true; key: string; state: FeatureOverrideState; org_ids: string[] }> {
  return apiFetch(`/companies/${orgId}/features/${key}`, { method: 'PUT', body: { state, reason } });
}

// ── Billing : tableau de bord des abonnements ─────────────────────────────

export type BillingSituation =
  | 'suspended'
  | 'past_due'
  | 'anomaly'
  | 'installment_due'
  | 'renewing_7d'
  | 'cancel_scheduled'
  | 'trial_ending'
  | 'renewing_30d'
  | 'churned'
  | 'ok';

export type BillingAlertCode = 'period_expired' | 'no_stripe' | 'past_due_no_date' | 'grace_elapsed' | 'commitment_breach';

export interface BillingWatchRow {
  org_id: string;
  org_name: string;
  owner_name: string | null;
  contact_email: string | null;
  member_count: number;
  last_activity: string | null;
  days_since_activity: number | null;
  engagement: EngagementLevel;

  plan_name: string | null;
  plan_slug: string | null;
  status: string;
  interval: 'monthly' | 'yearly';
  currency: string;
  amount_cents: number;
  customer_since: string;
  payment_confirmed_at: string | null;
  current_period_end: string | null;
  days_to_period_end: number | null;

  situation: BillingSituation;
  priority: number;
  next_charge_at: string | null;
  next_charge_cents: number;
  days_to_next_charge: number | null;

  past_due_since: string | null;
  grace: { expire_le: string; jours_restants: number; actif: boolean } | null;
  suspended: boolean;
  canceled_at: string | null;
  cancel_at_period_end: boolean;
  cancel_effective_at: string | null;
  cancellation_feedback: string | null;
  cancellation_comment: string | null;
  scheduled_plan_name: string | null;
  scheduled_at: string | null;

  installments: {
    count: number;
    paid: number;
    amount_cents: number;
    next_at: string | null;
    commitment_end: string | null;
    days_to_commitment_end: number | null;
  } | null;

  alerts: Array<{ code: BillingAlertCode; label: string }>;
  has_stripe_subscription: boolean;
  last_email: { type: string; status: string; at: string } | null;
  last_note: { at: string; author_name: string | null; excerpt: string } | null;
}

export interface BillingWatch {
  generated_at: string;
  grace_days: number;
  churn_window_days: number;
  /** Faux tant que la migration 20260927140000 (versements, cancel_at) n'est pas appliquée. */
  installments_available: boolean;
  summary: {
    active: number;
    trialing: number;
    past_due: number;
    suspended: number;
    cancel_scheduled: number;
    renewing_7d: number;
    renewing_30d: number;
    installments_active: number;
    installments_due_30d: number;
    trial_ending_7d: number;
    anomalies: number;
    churned_30d: number;
    due_7d_cents: Record<string, number>;
    due_30d_cents: Record<string, number>;
    mrr_cents: Record<string, number>;
  };
  rows: BillingWatchRow[];
}

export function getBillingWatch(): Promise<BillingWatch> {
  return apiFetch('/billing/watch');
}

/** URL du tableau de bord Stripe (abonnement, sinon client) du workspace. */
export function getStripeLink(orgId: string): Promise<{ url: string; kind: 'subscription' | 'customer' }> {
  return apiFetch(`/billing/${orgId}/stripe-link`);
}
