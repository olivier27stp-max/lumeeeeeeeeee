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
  status: string;
  payment_request_id?: string;
  public_token?: string;
  amount_cents: number;
  currency: string;
  message?: string;
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
