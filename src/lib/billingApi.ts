import { supabase } from './supabase';

const API_BASE = '/api';

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ''}`,
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
  return data.plans;
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
  subscriptionId?: string;
  message?: string;
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
