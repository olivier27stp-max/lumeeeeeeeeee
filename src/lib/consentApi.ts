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

/**
 * Version vivante de la politique de témoins.
 *
 * C'est le SEUL levier qui redemande son choix à l'utilisateur : on la monte
 * quand le texte de la politique change pour de vrai — une catégorie ajoutée
 * ou retirée, un nouveau sous-traitant, une finalité différente. Un choix
 * déjà fait tient sinon indéfiniment : re-poser la question sans que rien
 * n'ait changé, c'est du harcèlement de bandeau, et ça pousse les gens à
 * cliquer « Tout accepter » pour s'en débarrasser.
 *
 * Il n'y a donc PAS de péremption par le temps (voir `readStoredConsent`).
 */
export const CURRENT_COOKIE_POLICY_VERSION = 'cookie-policy-2026-09-26';
export const CURRENT_PRIVACY_POLICY_VERSION = 'privacy-policy-2026-07-23';
export const CURRENT_TOS_VERSION = 'tos-2026-09-10';

export function readStoredConsent(): StoredConsent | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredConsent;
    // Un changement de version de la politique invalide le choix — et c'est
    // la seule chose qui l'invalide. Pas de péremption aux 13 mois : décision
    // produit du 2026-09-26, assumée contre la recommandation de la CNIL de
    // redemander périodiquement. Ce qu'on protège, c'est qu'un « non » ne soit
    // jamais re-sollicité tant que rien n'a changé. `decidedAt` reste stocké :
    // il date le choix dans le registre, il ne le périme plus.
    if (parsed.docVersion !== CURRENT_COOKIE_POLICY_VERSION) return null;
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
 * Le consentement « Statistiques » est-il accordé ?
 *
 * SEUL point de vérité pour tout ce qui MESURE (aujourd'hui : le traçage de
 * performance Sentry, voir `src/lib/sentry.ts`). Toute future mesure
 * d'audience doit passer par ici — sinon le bandeau redevient un décor.
 *
 * Relu à chaque appel plutôt que mis en cache : un choix changé dans le
 * bandeau, ou réinitialisé depuis le Centre de confidentialité, doit prendre
 * effet sans rechargement.
 *
 * Refus par défaut : pas de choix enregistré = pas de mesure.
 */
export function aConsentiAuxStatistiques(): boolean {
  return readStoredConsent()?.analytics === true;
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
  // Les quatre finalités restent journalisées — c'est la trace de ce qui était
  // RÉELLEMENT en vigueur ce jour-là — mais le `method` dit laquelle a été
  // choisie et laquelle est imposée. Écrire 'web-banner' sur une case que
  // l'utilisateur n'a jamais vue reviendrait à fabriquer un consentement.
  const purposes: Array<[ConsentPurpose, boolean, string]> = [
    ['cookies-essential', true, 'strictement-necessaire'],
    ['cookies-analytics', choice.analytics, 'web-banner'],
    ['cookies-marketing', choice.marketing, 'web-banner'],
    ['cookies-preferences', choice.preferences, 'strictement-necessaire'],
  ];
  await Promise.all(
    purposes.map(([purpose, granted, method]) =>
      recordConsent({
        subjectType: 'user',
        subjectId: userId,
        purpose,
        granted,
        authToken,
        orgId,
        method,
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
