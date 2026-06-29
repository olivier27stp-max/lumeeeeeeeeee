// Thin client for the web CRM's authenticated server routes (server/routes/*).
// The deployed web app at EXPO_PUBLIC_WEB_URL also hosts the Express API under
// `/api`, and those routes authenticate with the Supabase JWT via the
// `Authorization: Bearer <access_token>` header — the exact token the mobile app
// already holds. So features that MUST run server-side (real Twilio SMS from the
// org's own number, SMTP email) are reachable from mobile with no extra creds.

import { supabase } from '../supabase';

const BASE = process.env.EXPO_PUBLIC_WEB_URL?.replace(/\/$/, '') ?? '';

export class ServerError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ServerError';
    this.status = status;
    this.code = code;
  }
}

/** True when EXPO_PUBLIC_WEB_URL is set, so server routes can be reached at all. */
export function serverConfigured(): boolean {
  return BASE.length > 0;
}

/** Get a valid access token, refreshing if it's expired/near-expiry (RN's
 * background auto-refresh isn't always running). */
async function freshToken(forceRefresh = false): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  let session = data.session;
  const expMs = (session?.expires_at ?? 0) * 1000;
  if (session && (forceRefresh || expMs < Date.now() + 60_000)) {
    const { data: r } = await supabase.auth.refreshSession();
    if (r.session) session = r.session;
  }
  return session?.access_token ?? null;
}

async function serverPost<T = any>(path: string, body: unknown): Promise<T> {
  if (!BASE) throw new ServerError('Server URL not configured (EXPO_PUBLIC_WEB_URL).', 0, 'no_base');

  const doFetch = async (token: string): Promise<Response> => {
    try {
      return await fetch(`${BASE}/api${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new ServerError((e as Error)?.message ?? 'Network request failed.', 0, 'network');
    }
  };

  let token = await freshToken();
  if (!token) throw new ServerError('Not signed in.', 401, 'no_session');
  let res = await doFetch(token);

  // Token rejected → refresh once and retry (handles expired/stale tokens).
  if (res.status === 401) {
    const refreshed = await freshToken(true);
    if (refreshed && refreshed !== token) {
      token = refreshed;
      res = await doFetch(token);
    }
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty / non-JSON body */
  }
  if (!res.ok) {
    throw new ServerError(json?.error ?? `Request failed (${res.status}).`, res.status, json?.code);
  }
  return json as T;
}

async function serverGet<T = any>(path: string): Promise<T> {
  if (!BASE) throw new ServerError('Server URL not configured (EXPO_PUBLIC_WEB_URL).', 0, 'no_base');

  const doFetch = async (token: string): Promise<Response> => {
    try {
      return await fetch(`${BASE}/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
      throw new ServerError((e as Error)?.message ?? 'Network request failed.', 0, 'network');
    }
  };

  let token = await freshToken();
  if (!token) throw new ServerError('Not signed in.', 401, 'no_session');
  let res = await doFetch(token);
  if (res.status === 401) {
    const refreshed = await freshToken(true);
    if (refreshed && refreshed !== token) {
      token = refreshed;
      res = await doFetch(token);
    }
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) throw new ServerError(json?.error ?? `Request failed (${res.status}).`, res.status, json?.code);
  return json as T;
}

export interface PayPeriodSummary {
  period: { start: string; end: string; payDate?: string } & Record<string, any>;
  hours: number;
  commission: { total: number; pending: number; approved: number; paid: number };
  userId: string;
}

/**
 * The signed-in user's current pay period: hours worked + commission heading to
 * them. Server-computed (GET /api/payroll/current-period); a tech/rep only ever
 * sees their own unless they're an admin passing a userId.
 */
export async function getCurrentPayPeriod(): Promise<PayPeriodSummary> {
  return serverGet<PayPeriodSummary>('/payroll/current-period');
}

/**
 * Send a real SMS through the org's provisioned Twilio number (server route
 * POST /api/messages/send). The server also logs it to conversations/messages,
 * so the thread updates on next refetch. Throws ServerError with code
 * `sms_not_provisioned` (409) or status 503 when the org/Twilio isn't set up —
 * callers can fall back to the native composer in those cases.
 */
export async function sendSmsViaServer(input: {
  phone: string;
  text: string;
  clientId?: string | null;
  clientName?: string | null;
}): Promise<void> {
  await serverPost('/messages/send', {
    phone_number: input.phone,
    message_text: input.text,
    client_id: input.clientId ?? undefined,
    client_name: input.clientName ?? undefined,
  });
}

/**
 * Whether we should silently fall back to the native composer instead of
 * surfacing the error. We fall back on EVERYTHING (not provisioned, server down,
 * auth/token rejected, network…) so the user is never blocked — EXCEPT a real
 * opt-out, which is a legal block the user must see.
 */
export function isSmsUnavailable(e: unknown): boolean {
  if (!(e instanceof ServerError)) return true; // unexpected error → fall back
  return e.code !== 'sms_opted_out';
}

/**
 * Send an invoice by email via the server (POST /api/emails/send-invoice).
 * The server resolves the client email + renders the template; we only pass the
 * invoice id (and optionally an override subject/body). Works because mobile and
 * web share the same `invoices` table.
 *
 * NOTE: there is also /api/emails/send-quote, but the server stores quotes in the
 * `invoices` table while mobile uses a separate `quotes` table, so that route
 * can't resolve a mobile quote id — quote email is intentionally not wired here.
 */
export async function sendInvoiceEmailViaServer(input: {
  invoiceId: string;
  subject?: string | null;
  body?: string | null;
}): Promise<void> {
  await serverPost('/emails/send-invoice', {
    invoiceId: input.invoiceId,
    subject: input.subject ?? undefined,
    body: input.body ?? undefined,
  });
}

// ─── Stripe Connect (self-serve payment onboarding, per company) ────────────
// Each org connects its OWN Stripe account so it can collect card payments on
// the client pay page. The server (server/routes/connect.ts) owns the Stripe
// API; mobile just drives the same authed endpoints the desktop uses. Only an
// owner/admin can activate (enforced server-side).

export interface ConnectedAccount {
  id: string;
  org_id: string;
  stripe_account_id: string;
  onboarding_complete: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  country: string | null;
  default_currency: string;
}

export interface ConnectStatus {
  connected: boolean;
  account: ConnectedAccount | null;
  /** Set when the server itself has no Stripe key configured. */
  warning?: string;
}

/** Live Stripe Connect status for the org (GET /api/connect/account-status). */
export async function getConnectStatus(orgId: string): Promise<ConnectStatus> {
  return serverGet<ConnectStatus>(`/connect/account-status?orgId=${encodeURIComponent(orgId)}`);
}

/** Create the org's connected account (owner/admin only). Idempotent server-side. */
export async function activateConnectedAccount(orgId: string): Promise<{ account: ConnectedAccount }> {
  return serverPost<{ account: ConnectedAccount }>('/connect/create-account', { orgId, country: 'CA' });
}

/**
 * Get a Stripe-hosted onboarding URL the owner opens to finish setup (bank,
 * identity…). `refresh` reuses the same endpoint to mint a fresh link when an
 * earlier one expired. The link's return/refresh URLs point back at the web app.
 */
export async function getConnectOnboardingLink(
  orgId: string,
  refresh = false,
): Promise<{ url: string; expires_at: number }> {
  const path = refresh ? '/connect/refresh-onboarding-link' : '/connect/create-onboarding-link';
  return serverPost<{ url: string; expires_at: number }>(path, { orgId });
}
