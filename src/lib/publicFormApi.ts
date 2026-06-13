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
