import type { SocialLinks } from './socialLinks';
import { supabase } from './supabase';
import { deviceTokenHeader } from './deviceToken';
import type { ConnectedAccount, PaymentRequest } from '../types';

// ── Auth helpers (same pattern as paymentsApi) ──

async function getAuthHeaders(extra?: Record<string, string>) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    Authorization: `Bearer ${token}`,
    ...(extra || {}),
  };
}

async function fetchApiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
  const response = await fetch(url, {
    ...init,
    headers: { ...headers, ...deviceTokenHeader(), ...(init?.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error((payload as any)?.error || `Request failed (${response.status}).`) as Error & { code?: string };
    if ((payload as any)?.code) err.code = (payload as any).code;
    throw err;
  }
  return payload as T;
}

// ── Connected Account ──

export interface AccountStatusResponse {
  connected: boolean;
  account: ConnectedAccount | null;
  warning?: string;
}

export async function getAccountStatus(): Promise<AccountStatusResponse> {
  return fetchApiJson<AccountStatusResponse>('/api/connect/account-status');
}

export async function createConnectedAccount(country = 'CA'): Promise<{ account: ConnectedAccount }> {
  return fetchApiJson('/api/connect/create-account', {
    method: 'POST',
    body: JSON.stringify({ country }),
  });
}

export async function createOnboardingLink(): Promise<{ url: string; expires_at: number }> {
  return fetchApiJson('/api/connect/create-onboarding-link', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function refreshOnboardingLink(): Promise<{ url: string; expires_at: number }> {
  return fetchApiJson('/api/connect/refresh-onboarding-link', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** Lien one-shot vers le dashboard Stripe Express (versements, solde, compte bancaire). */
export async function createDashboardLink(): Promise<{ url: string }> {
  return fetchApiJson('/api/connect/dashboard-link', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// ── Réglages Lume Payments (interrupteurs, pourboires, portefeuilles…) ──

export interface PaymentSettings {
  org_id: string;
  quote_payments_enabled: boolean;
  invoice_payments_enabled: boolean;
  tips_enabled: boolean;
  wallets_enabled: boolean;
  require_payment_method_default: boolean;
  notify_owner_email: boolean;
  updated_at: string | null;
}

export type PaymentSettingsPatch = Partial<Omit<PaymentSettings, 'org_id' | 'updated_at'>>;

export async function getPaymentSettings(): Promise<PaymentSettings> {
  const { settings } = await fetchApiJson<{ settings: PaymentSettings }>('/api/connect/settings');
  return settings;
}

export async function updatePaymentSettings(patch: PaymentSettingsPatch): Promise<PaymentSettings> {
  const { settings } = await fetchApiJson<{ settings: PaymentSettings }>('/api/connect/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return settings;
}

// ── Aperçu des versements (lecture seule, admin/owner) ──

export interface PayoutsOverview {
  currency: string;
  available_cents: number;
  pending_cents: number;
  next_payout: { amount_cents: number; arrival_date: string; status: string } | null;
  recent_payouts: Array<{ id: string; amount_cents: number; arrival_date: string; status: string; method: string }>;
  bank: { kind: 'bank_account' | 'card'; label: string; last4: string } | null;
  payout_schedule: { interval: string; delay_days: number | null } | null;
  instant_payouts_available: boolean;
  disputes: { open_count: number };
}

export async function getPayoutsOverview(): Promise<PayoutsOverview> {
  const { overview } = await fetchApiJson<{ overview: PayoutsOverview }>('/api/connect/payouts-overview');
  return overview;
}

// ── Payment Requests ──

export interface CreatePaymentRequestResponse {
  payment_request: PaymentRequest;
  notifications?: {
    email?: { sent: boolean; reason?: string; emailId?: string };
    sms?: { sent: boolean; reason?: string; sid?: string };
  };
}

export async function createPaymentRequest(invoiceId: string, sendVia: string = 'link_only'): Promise<CreatePaymentRequestResponse> {
  return fetchApiJson('/api/payment-requests/create', {
    method: 'POST',
    body: JSON.stringify({ invoiceId, sendVia }),
  });
}

export async function resendPaymentRequest(invoiceId: string, sendVia: string = 'link_only'): Promise<CreatePaymentRequestResponse> {
  return fetchApiJson('/api/payment-requests/resend', {
    method: 'POST',
    body: JSON.stringify({ invoiceId, sendVia }),
  });
}

// ── Remboursements ──
// Les remboursements se font depuis le tableau de bord Stripe, pas depuis Lume
// (décision du 2026-09-01). Le client `refundPayment` qui vivait ici n'était
// appelé par AUCUNE page : il laissait croire que l'application savait
// rembourser, alors qu'aucun bouton ne l'a jamais déclenché.
//
// La route serveur `POST /api/payments/refund` est CONSERVÉE : elle fonctionne,
// elle est protégée par la permission `financial.view_payments`, et elle
// annule correctement le paiement dans la facture. Elle reste disponible si un
// bouton devait être ajouté un jour.
//
// L'affichage d'un paiement remboursé (badge, icône, traductions) reste utile :
// un remboursement fait dans Stripe redescend par le webhook.

export async function getPaymentRequestsForInvoice(invoiceId: string): Promise<{ payment_requests: PaymentRequest[] }> {
  return fetchApiJson(`/api/payment-requests/${invoiceId}/status`);
}

// ── Public Payment Page (no auth needed) ──

export interface PublicPaymentData {
  /** 'pending' | 'sent' | 'paid' | 'disabled' (paiements en ligne coupés par l'entreprise). */
  status: string;
  payment_request_id?: string;
  public_token?: string;
  amount_cents: number;
  currency: string;
  message?: string;
  /** Réglages Lume Payments de l'entreprise qui touchent la page. */
  options?: {
    tips_enabled: boolean;
    wallets_enabled: boolean;
  };
  invoice?: {
    invoice_number: string;
    subject: string | null;
    total_cents: number;
    balance_cents: number;
  };
  items?: Array<{
    id: string;
    description: string;
    qty: number;
    unit_price_cents: number;
    line_total_cents: number;
  }>;
  client?: {
    name: string;
    email: string | null;
  } | null;
  business?: {
    name: string | null;
    logo_url: string | null;
    email: string | null;
    phone: string | null;
    /** Couleur de marque de l'org — renvoyée par server/routes/public-pay.ts. */
    brand_color?: string | null;
    /** Réseaux sociaux — icônes au pied de la page. */
    social_links?: SocialLinks | null;
    /** Langue de l'entreprise : la page s'affiche dans celle-là. */
    language?: 'fr' | 'en' | null;
  } | null;
}

export async function fetchPublicPaymentData(publicToken: string): Promise<PublicPaymentData> {
  const response = await fetch(`/api/pay/${publicToken}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((payload as any)?.error || `Request failed (${response.status}).`);
  }
  return payload as PublicPaymentData;
}

export interface CreatePublicPaymentIntentResponse {
  client_secret: string;
  payment_intent_id: string;
  amount_cents: number;
  currency: string;
  publishable_key: string;
}

/**
 * Pourboire choisi sur la page publique : le serveur recalcule le montant du
 * PaymentIntent (solde + pourboire) et renvoie le total à afficher.
 */
export async function setPublicTip(publicToken: string, tipCents: number): Promise<{ ok: boolean; tip_cents: number; amount_cents: number }> {
  const response = await fetch(`/api/pay/${publicToken}/tip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tip_cents: tipCents }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((payload as any)?.error || `Request failed (${response.status}).`);
  }
  return payload as { ok: boolean; tip_cents: number; amount_cents: number };
}

export async function createPublicPaymentIntent(publicToken: string): Promise<CreatePublicPaymentIntentResponse> {
  const response = await fetch(`/api/pay/${publicToken}/create-payment-intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((payload as any)?.error || `Request failed (${response.status}).`);
  }
  return payload as CreatePublicPaymentIntentResponse;
}
