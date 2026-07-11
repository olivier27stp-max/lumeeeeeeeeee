import { supabase } from './supabase';
import { deviceTokenHeader } from './deviceToken';

const API_BASE = '/api';

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  // Office actif sélectionné — le serveur scope dessus si l'utilisateur en est
  // membre (cf. requireAuthedClient).
  let activeOrg = '';
  try { activeOrg = localStorage.getItem('lume-active-org') || ''; } catch {}
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ''}`,
    'x-org-id': activeOrg,
    ...deviceTokenHeader(),
  };
}

// ── Types ────────────────────────────────────────────────────────

export interface Plan {
  id: string;
  slug: string;
  name: string;
  name_fr: string;
  monthly_price_usd: number;
  monthly_price_cad: number;
  yearly_price_usd: number;
  yearly_price_cad: number;
  features: string[];
  max_clients: number | null;
  max_jobs_per_month: number | null;
  is_active: boolean;
  sort_order: number;
  seats_included?: number | null;
  extra_seat_price_usd?: number | null;
  extra_seat_price_cad?: number | null;
  included_offices?: number | null;
  extra_office_price_usd?: number | null;
  extra_office_price_cad?: number | null;
  includes_sms?: boolean;
  includes_ai?: boolean;
  includes_d2d?: boolean;
  includes_courses?: boolean;
  includes_api?: boolean;
  includes_automations?: boolean;
  includes_marketplace?: boolean;
  includes_timesheets?: boolean;
}

export interface BillingProfile {
  id: string;
  org_id: string;
  billing_email: string | null;
  company_name: string | null;
  full_name: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postal_code: string | null;
  phone: string | null;
  currency: string;
  stripe_customer_id: string | null;
}

export interface Subscription {
  id: string;
  org_id: string;
  plan_id: string;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';
  interval: 'monthly' | 'yearly';
  currency: string;
  amount_cents: number;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  promo_code: string | null;
  referral_code: string | null;
  created_at: string;
  plans?: Plan;
  scheduled_plan_id?: string | null;
  scheduled_interval?: 'monthly' | 'yearly' | null;
  scheduled_at?: string | null;
}

export interface OnboardingData {
  full_name: string;
  company_name: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  region?: string;
  country?: string;
  postal_code?: string;
  industry?: string;
  company_size?: string;
  currency: 'USD' | 'CAD';
}

export interface SubscribeInput {
  plan_slug: string;
  interval: 'monthly' | 'yearly';
  currency: 'USD' | 'CAD';
  payment_method_id?: string;
  promo_code?: string;
  referral_code?: string;
  billing_email?: string;
  company_name?: string;
  country?: string;
  postal_code?: string;
}

// ── API functions ────────────────────────────────────────────────

export async function fetchPlans(): Promise<Plan[]> {
  const res = await fetch(`${API_BASE}/billing/plans`);
  if (!res.ok) throw new Error('Failed to load plans.');
  const data = await res.json();
  return (data.plans as Plan[]).map((p) => ({
    ...p,
    // Derived plan flags (no dedicated DB column yet):
    // - Automations: Scale+ (everything except Minimum/starter).
    // - Marketplace / integrations / webhooks: Autopilot only.
    includes_automations: p.includes_automations ?? (p.slug !== 'starter'),
    includes_marketplace: p.includes_marketplace ?? (p.slug === 'autopilot'),
    includes_timesheets: p.includes_timesheets ?? (p.slug !== 'starter'),
  }));
}

export async function fetchCurrentBilling(): Promise<{
  subscription: Subscription | null;
  billing_profile: BillingProfile | null;
}> {
  const res = await fetch(`${API_BASE}/billing/current`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load billing info.');
  return res.json();
}

export async function saveOnboarding(data: OnboardingData): Promise<void> {
  const res = await fetch(`${API_BASE}/billing/onboarding`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to save onboarding data.');
}

export async function subscribe(data: SubscribeInput): Promise<{ subscription: Subscription }> {
  const res = await fetch(`${API_BASE}/billing/subscribe`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Subscription failed.');
  return res.json();
}

export async function cancelSubscription(): Promise<void> {
  const res = await fetch(`${API_BASE}/billing/cancel`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to cancel subscription.');
}

/**
 * TEMPORARY test-only helper: switch the org's plan directly (bypasses Stripe).
 * Used by the temporary /dev/plan-switch page to test plan-gated UI.
 */
export async function devSwitchPlan(input: { plan_slug: string; interval: 'monthly' | 'yearly' }): Promise<{
  message: string;
  plan?: { slug: string; name: string; interval: string; amount_cents: number };
}> {
  const res = await fetch(`${API_BASE}/billing/dev-switch-plan`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to switch plan.');
  return res.json();
}

export async function changePlan(input: { plan_slug: string; interval: 'monthly' | 'yearly' }): Promise<{
  message: string;
  no_change?: boolean;
  no_stripe?: boolean;
  plan?: { slug: string; name: string; interval: string; amount_cents: number };
}> {
  const res = await fetch(`${API_BASE}/billing/change-plan`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to change plan.');
  return res.json();
}

export interface SeatUsage {
  included: number;
  used: number;
  extras_charged: number;
  extra_price_cents: number;
  currency: string;
}

export async function fetchSeatUsage(): Promise<SeatUsage> {
  const res = await fetch(`${API_BASE}/billing/seats`, { headers: await authHeaders() });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to load seat usage.');
  return res.json();
}

export async function setExtraSeats(count: number): Promise<{ message: string; extra_seats?: number; no_change?: boolean; no_stripe?: boolean }> {
  const res = await fetch(`${API_BASE}/billing/seats`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ extra_seats: count }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to update extra seats.');
  return res.json();
}

export interface OfficeUsage {
  included: number;
  extras_charged: number;
  extra_price_cents: number;
  currency: string;
}

export async function fetchOfficeUsage(): Promise<OfficeUsage> {
  const res = await fetch(`${API_BASE}/billing/offices`, { headers: await authHeaders() });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to load office usage.');
  return res.json();
}

export async function setExtraOffices(count: number): Promise<{ message: string; extra_offices?: number; no_change?: boolean; no_stripe?: boolean }> {
  const res = await fetch(`${API_BASE}/billing/offices`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ extra_offices: count }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to update extra offices.');
  return res.json();
}

export async function cancelScheduledChange(): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/billing/cancel-scheduled-change`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to cancel scheduled change.');
  return res.json();
}

export async function openCustomerPortal(): Promise<{ url: string }> {
  const res = await fetch(`${API_BASE}/billing/customer-portal`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to open billing portal.');
  return res.json();
}

export async function validatePromoCode(code: string): Promise<{
  code: string;
  discount_type: 'percentage' | 'fixed_cents';
  discount_value: number;
} | null> {
  const res = await fetch(`${API_BASE}/billing/validate-promo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.promo;
}

// ── Email verification check ────────────────────────────────────

export async function checkEmailVerified(): Promise<{
  verified: boolean;
  email: string | null;
}> {
  const res = await fetch(`${API_BASE}/billing/email-verified`, {
    headers: await authHeaders(),
  });
  if (!res.ok) return { verified: false, email: null };
  return res.json();
}

// ── Checkout confirmation (polling) ─────────────────────────────

export interface CheckoutStatus {
  status: 'pending' | 'processing' | 'confirmed';
  email?: string;
  userId?: string;
  orgId?: string;
  subscriptionId?: string;
  message?: string;
  /** Plan display info (present when confirmed) */
  planName?: string;
  interval?: 'monthly' | 'yearly';
  currency?: string;
  amountCents?: number;
  /** True when the account was created by the webhook and still needs a password (payment-link buyers). */
  needsPassword?: boolean;
  /** True only for plans that include a dedicated SMS number (Scale/Autopilot). */
  includesSms?: boolean;
}

export async function confirmCheckout(sessionId: string): Promise<CheckoutStatus> {
  const res = await fetch(`${API_BASE}/billing/confirm-checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  });
  const data = await res.json();
  if (res.status === 202) {
    return { status: data.status || 'processing', email: data.email, message: data.message };
  }
  if (!res.ok) throw new Error(data.error || 'Checkout confirmation failed');
  return data;
}

/**
 * Claim a payment-link account: set its initial password, proven by the paid
 * Stripe session_id. PUBLIC (the buyer has no session yet). Returns the org id.
 */
export async function setInitialPassword(sessionId: string, password: string): Promise<{ ok: boolean; email: string; orgId: string }> {
  const res = await fetch(`${API_BASE}/billing/set-initial-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not set password');
  return data;
}

/** Save the post-payment company profile via the server (service-role write,
 *  RLS-proof) + make the workspace name follow the company name. Authenticated. */
export async function completeSetup(data: {
  company_name: string; phone: string; email: string; address: string;
  city: string; province: string; postal_code: string; country: string; logo_url?: string;
}): Promise<void> {
  const res = await fetch(`${API_BASE}/billing/complete-setup`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || 'Setup save failed');
  }
}

/**
 * Apply a tax preset (province / state key, e.g. 'QC', 'US-CA') as the org's
 * default tax group. Authenticated — call after signing in. Best-effort.
 */
export async function setupTaxRegion(presetKey: string): Promise<void> {
  if (!presetKey || presetKey === 'LATER') return;
  const res = await fetch(`${API_BASE}/taxes/setup`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ preset_key: presetKey, make_default: true }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Tax setup failed');
  }
}

// ── Receipt management ──────────────────────────────────────────

export async function resendReceipt(subscriptionId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/billing/resend-receipt`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ subscription_id: subscriptionId }),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data.error };
  return { ok: true };
}

export interface ReceiptLogEntry {
  id: string;
  recipient_email: string;
  email_type: string;
  plan_name: string | null;
  amount_cents: number;
  currency: string;
  status: string;
  sent_at: string | null;
  created_at: string;
}

export async function fetchReceiptHistory(): Promise<ReceiptLogEntry[]> {
  const res = await fetch(`${API_BASE}/billing/receipt-history`, {
    headers: await authHeaders(),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.receipts || [];
}
