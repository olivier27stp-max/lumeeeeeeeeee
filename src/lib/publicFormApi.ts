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
}

export async function fetchPublicForm(apiKey: string): Promise<PublicForm> {
  const res = await fetch(`${API_BASE}/public/form/${encodeURIComponent(apiKey)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || 'Unable to load form.');
  return body.form as PublicForm;
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
