/**
 * Consent & DSR client API
 * Wraps /api/dsr/* endpoints + local cookie-consent storage.
 */

export type ConsentPurpose =
  | 'cookies-essential'
  | 'cookies-analytics'
  | 'cookies-marketing'
  | 'cookies-preferences'
  | 'email-marketing'
  | 'sms-marketing'
  | 'profiling'
  | 'tos'
  | 'privacy-policy';

export interface ConsentChoice {
  analytics: boolean;
  marketing: boolean;
  preferences: boolean;
  // 'essential' is always true (strictly necessary)
}

export interface StoredConsent extends ConsentChoice {
  decidedAt: string;       // ISO timestamp
  docVersion: string;      // e.g. "cookie-policy-2026-04-21"
}

const STORAGE_KEY = 'lume.cookieConsent.v1';

// Current live version of the cookie policy. Bump when policy text changes
// → triggers re-consent on next visit.
export const CURRENT_COOKIE_POLICY_VERSION = 'cookie-policy-2026-04-21';
export const CURRENT_PRIVACY_POLICY_VERSION = 'privacy-policy-2026-04-21';
export const CURRENT_TOS_VERSION = 'tos-2026-04-21';

// Re-consent every 13 months (RGPD/CNIL guidance)
const REVALIDATE_AFTER_MS = 13 * 30 * 24 * 60 * 60 * 1000;

export function readStoredConsent(): StoredConsent | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredConsent;
    if (parsed.docVersion !== CURRENT_COOKIE_POLICY_VERSION) return null;
    const age = Date.now() - new Date(parsed.decidedAt).getTime();
    if (age > REVALIDATE_AFTER_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredConsent(choice: ConsentChoice): StoredConsent {
  const stored: StoredConsent = {
    ...choice,
    decidedAt: new Date().toISOString(),
    docVersion: CURRENT_COOKIE_POLICY_VERSION,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  return stored;
}

export function clearStoredConsent() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Send a consent entry to the server (immutable journal).
 * Works for both anonymous (pre-login cookie banner) and authenticated users,
 * as long as subject_id is a real UUID (user.id once logged in).
 */
export async function recordConsent(params: {
  subjectType: 'user' | 'client' | 'lead';
  subjectId: string;
  purpose: ConsentPurpose;
  granted: boolean;
  docVersion?: string;
  docUrl?: string;
  method?: string;
  orgId?: string | null;
  authToken?: string | null;
}): Promise<{ consent_id?: string; error?: string }> {
  try {
    const res = await fetch('/api/dsr/consent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'fetch',
        ...(params.authToken ? { Authorization: `Bearer ${params.authToken}` } : {}),
      },
      body: JSON.stringify({
        subject_type: params.subjectType,
        subject_id: params.subjectId,
        purpose: params.purpose,
        granted: params.granted,
        doc_version: params.docVersion ?? CURRENT_COOKIE_POLICY_VERSION,
        doc_url: params.docUrl,
        method: params.method ?? 'web-banner',
        org_id: params.orgId ?? null,
      }),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e: any) {
    return { error: String(e?.message || e) };
  }
}

/**
 * Batch submit the cookie banner choice (4 purposes).
 */
export async function submitCookieConsent(
  choice: ConsentChoice,
  userId: string | null,
  authToken: string | null,
  orgId: string | null,
): Promise<void> {
  if (!userId) return;                // anonymous users: localStorage only
  const purposes: Array<[ConsentPurpose, boolean]> = [
    ['cookies-essential', true],
    ['cookies-analytics', choice.analytics],
    ['cookies-marketing', choice.marketing],
    ['cookies-preferences', choice.preferences],
  ];
  await Promise.all(
    purposes.map(([purpose, granted]) =>
      recordConsent({
        subjectType: 'user',
        subjectId: userId,
        purpose,
        granted,
        authToken,
        orgId,
        method: 'web-banner',
      })
    )
  );
}

// ── DSR endpoints ────────────────────────────────────────────────────

export async function exportMyData(authToken: string): Promise<Blob | null> {
  const res = await fetch('/api/dsr/export/me', {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) return null;
  return await res.blob();
}

export async function exportClientData(clientId: string, authToken: string): Promise<Blob | null> {
  const res = await fetch(`/api/dsr/export/client/${clientId}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) return null;
  return await res.blob();
}

export async function eraseClient(clientId: string, authToken: string): Promise<boolean> {
  const res = await fetch(`/api/dsr/erase/client/${clientId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ confirm: 'ERASE' }),
  });
  return res.ok;
}

export async function eraseLead(leadId: string, authToken: string): Promise<boolean> {
  const res = await fetch(`/api/dsr/erase/lead/${leadId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ confirm: 'ERASE' }),
  });
  return res.ok;
}

export async function submitDsarRequest(params: {
  subjectType: 'user' | 'client' | 'lead';
  subjectId: string;
  requestType: 'access' | 'erasure' | 'rectification' | 'portability' | 'objection' | 'restriction';
  justification?: string;
  authToken: string;
}): Promise<{ request?: any; sla_days?: number; error?: string }> {
  try {
    const res = await fetch('/api/dsr/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${params.authToken}` },
      body: JSON.stringify({
        subject_type: params.subjectType,
        subject_id: params.subjectId,
        request_type: params.requestType,
        justification: params.justification,
      }),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e: any) {
    return { error: String(e?.message || e) };
  }
}
