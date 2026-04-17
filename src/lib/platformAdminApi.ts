/**
 * LUME CRM — Platform Admin API Client (v2)
 * ============================================
 * SaaS founder control center.
 * Tabs: Business, Operations, Users, Billing
 */

import { supabase } from './supabase';

// ─── Types ──────────────────────────────────────────────────────

// Business tab
export interface BusinessMetrics {
  totalOrgs: number;
  newOrgs30d: number;
  mrrCents: number;
  arpuCents: number;
  activeSubscriptions: number;
  newSubscriptions30d: number;
  canceled30d: number;
  revenue30dCents: number;
  revenueGrowthPct: number | null;
  planBreakdown: PlanBreakdown[];
}

export interface PlanBreakdown {
  name: string;
  slug: string;
  active: number;
  trialing: number;
  mrr_cents: number;
}

export interface RevenuePoint {
  date: string;
  revenue_cents: number;
}

export interface GrowthPoint {
  month: string;
  new_orgs: number;
  new_users: number;
}

// Operations tab
export interface OperationsData {
  healthStatus: 'healthy' | 'attention' | 'critical';
  failedPayments: FailedPayment[];
  pastDueSubscriptions: PastDueSub[];
  trialsEndingSoon: TrialEnding[];
  webhookErrors: WebhookError[];
  inactiveOrgs: InactiveOrg[];
  counts: {
    failed_payments: number;
    past_due: number;
    trials_ending: number;
    inactive_orgs: number;
    webhook_errors: number;
  };
}

export interface FailedPayment {
  id: string;
  org_id: string;
  org_name: string;
  amount_cents: number;
  currency: string;
  failure_reason: string | null;
  created_at: string;
}

export interface PastDueSub {
  id: string;
  org_id: string;
  org_name: string;
  amount_cents: number;
  current_period_end: string | null;
  plans?: { slug: string; name: string };
}

export interface TrialEnding {
  id: string;
  org_id: string;
  org_name: string;
  trial_end: string | null;
  plans?: { slug: string; name: string };
}

export interface WebhookError {
  id: string;
  provider: string;
  event_type: string;
  error_message: string | null;
  created_at: string;
}

export interface InactiveOrg {
  id: string;
  name: string;
  created_at: string;
}

// Users tab
export interface UsersData {
  totalUsers: number;
  totalOrgs: number;
  avgUsersPerOrg: number;
  activeOrgs7d: number;
  activeOrgs30d: number;
  inactive30d: number;
  workspaces: Workspace[];
}

export interface Workspace {
  id: string;
  name: string;
  created_at: string;
  member_count: number;
  jobs_30d: number;
  logins_30d: number;
  last_activity: string;
  days_since_activity: number;
  engagement: 'high' | 'medium' | 'low' | 'inactive';
}

// Billing tab
export interface BillingRow {
  id: string;
  org_id: string;
  org_name: string;
  plan_name: string;
  plan_slug: string;
  status: string;
  interval: string;
  amount_cents: number;
  currency: string;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  created_at: string;
  last_payment_status: string | null;
  last_payment_date: string | null;
}

// Org detail (shared)
export interface OrgDetail {
  org: any;
  members: Array<{
    user_id: string;
    role: string;
    created_at: string;
    full_name: string;
    avatar_url: string | null;
  }>;
  subscription: {
    plan_name: string;
    plan_slug: string;
    status: string;
    interval: string;
    amount_cents: number;
    current_period_end: string | null;
    trial_end: string | null;
  } | null;
  stats: {
    total_jobs: number;
    total_clients: number;
    revenue_all_time_cents: number;
    revenue_30d_cents: number;
  };
}

// ─── Helpers ────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${session.access_token}` };
}

async function apiFetch<T>(path: string): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/platform-admin/${path}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

// ─── API Functions ──────────────────────────────────────────────

let _ownerCheckCache: { userId: string; result: boolean } | null = null;

export async function checkIsPlatformOwner(): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id || '';
    if (_ownerCheckCache && _ownerCheckCache.userId === userId) return _ownerCheckCache.result;
    const data = await apiFetch<{ isPlatformOwner: boolean }>('check');
    _ownerCheckCache = { userId, result: data.isPlatformOwner };
    return data.isPlatformOwner;
  } catch { return false; }
}

// Business tab
export const fetchBusinessMetrics = () => apiFetch<BusinessMetrics>('business');
export const fetchRevenueSeries = (days = 30) => apiFetch<{ series: RevenuePoint[] }>(`revenue-series?days=${days}`).then(d => d.series);
export const fetchGrowthSeries = () => apiFetch<{ series: GrowthPoint[] }>('growth-series').then(d => d.series);

// Operations tab
export const fetchOperations = () => apiFetch<OperationsData>('operations');

// Users tab
export const fetchUsersData = () => apiFetch<UsersData>('users');

// Billing tab
export async function fetchBillingData(params?: { status?: string; interval?: string; search?: string }): Promise<{ subscriptions: BillingRow[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.interval) qs.set('interval', params.interval);
  if (params?.search) qs.set('search', params.search);
  const query = qs.toString();
  return apiFetch(`billing${query ? `?${query}` : ''}`);
}

// Org detail (shared)
export const fetchOrgDetail = (orgId: string) => apiFetch<OrgDetail>(`org/${orgId}`);
