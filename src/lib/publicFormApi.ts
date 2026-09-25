import type { FormField } from '../types';

const API_BASE = '/api';

/**
 * Public, UNAUTHENTICATED request-form client.
 * Used by the embeddable form page (`/form/:apiKey`) — no Supabase session
 * is available because the visitor is an external prospect, not a Lume user.
 * The org is resolved server-side from the public API key.
 */

export interface PublicForm {
  id: string;
  title: string;
  description: string | null;
  success_message: string;
  enabled: boolean;
  /** Form logo (custom, or the company logo as default). */
  logo_url: string | null;
  custom_fields: FormField[];
}

export interface PublicFormSubmission {
  first_name: string;
  last_name: string;
  company?: string | null;
  email: string;
  phone: string;
  street_address?: string | null;
  unit?: string | null;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
  country?: string | null;
  custom_responses?: Record<string, unknown>;
  notes?: string | null;
  /** Public URLs of photos already uploaded via `uploadPublicFormPhoto`. */
  photos?: string[];
  /** Honeypot anti-bot — toujours vide/undefined pour un humain. */
  website?: string;
  /**
   * Attribution marketing, relevée dans l'URL de la page — PAS des champs du
   * formulaire : le visiteur ne les voit ni ne les saisit. Elles permettent de
   * dire quelle campagne a amené le lead, et ce qu'elle a rapporté.
   */
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  fbclid?: string | null;
}

/**
 * Lit les paramètres d'attribution dans l'URL courante.
 *
 * Bornés à 256 caractères comme côté serveur, et `null` plutôt que chaîne
 * vide pour qu'un `?utm_source=` sans valeur ne compte pas comme une source.
 */
export function lireAttribution(search: string = typeof window !== 'undefined' ? window.location.search : ''): {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  fbclid: string | null;
} {
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(search);
  } catch {
    p = new URLSearchParams();
  }
  const lire = (cle: string): string | null => {
    const v = p.get(cle);
    if (v === null) return null;
    const t = v.trim();
    return t === '' ? null : t.slice(0, 256);
  };
  return {
    utm_source: lire('utm_source'),
    utm_medium: lire('utm_medium'),
    utm_campaign: lire('utm_campaign'),
    utm_content: lire('utm_content'),
    fbclid: lire('fbclid'),
  };
}

export async function fetchPublicForm(apiKey: string): Promise<PublicForm> {
  const res = await fetch(`${API_BASE}/public/form/${encodeURIComponent(apiKey)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || 'Unable to load form.');
  return body.form as PublicForm;
}

/**
 * Upload one image for a public form submission. Sends the raw file bytes
 * (no auth session — the org is resolved server-side from the API key) and
 * returns the public URL to include in the submission's `photos[]`.
 */
export async function uploadPublicFormPhoto(apiKey: string, file: File): Promise<string> {
  const res = await fetch(
    `${API_BASE}/public/form/${encodeURIComponent(apiKey)}/upload?filename=${encodeURIComponent(file.name)}`,
    {
      method: 'POST',
      // X-Requested-With satisfies the server's CSRF header check; the raw
      // image Content-Type can't include application/json, so we must signal
      // the JS origin explicitly.
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: file,
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || 'Unable to upload image.');
  return body.url as string;
}

export async function submitPublicForm(
  apiKey: string,
  payload: PublicFormSubmission,
): Promise<{ ok: true; submission_id: string | null }> {
  const res = await fetch(`${API_BASE}/public/form/${encodeURIComponent(apiKey)}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || 'Unable to submit. Please try again.');
  return body;
}
