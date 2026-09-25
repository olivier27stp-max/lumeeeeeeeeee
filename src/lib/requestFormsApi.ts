import { supabase } from './supabase';
import type { RequestForm, FormSubmission } from '../types';

const API_BASE = '/api';

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

export async function fetchRequestForm(): Promise<RequestForm | null> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/request-forms`, { headers });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch form');
  const { form } = await res.json();
  return form || null;
}

/**
 * TOUS les formulaires de l'organisation, du plus ancien au plus récent.
 *
 * `fetchRequestForm()` (au singulier) reste pour ce qui n'affiche qu'un
 * formulaire : le serveur renvoie les deux champs, `form` et `forms`.
 */
export async function fetchRequestForms(): Promise<RequestForm[]> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/request-forms`, { headers });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch forms');
  const { forms, form } = await res.json();
  // Repli sur `form` : un serveur pas encore redéployé ne renvoie que lui, et
  // l'écran afficherait une liste vide alors qu'un formulaire existe.
  if (Array.isArray(forms)) return forms;
  return form ? [form] : [];
}

export async function upsertRequestForm(payload: {
  /** Le formulaire à modifier. Absent + `creer` absent = le plus ancien. */
  id?: string;
  /** Force une CRÉATION : c'est « Nouveau formulaire ». Sans ce drapeau, un
   *  envoi sans `id` écraserait le formulaire le plus ancien. */
  creer?: boolean;
  /** Le pipeline qui reçoit les leads. `null` = celui par défaut. */
  pipeline_id?: string | null;
  title: string;
  description?: string | null;
  success_message: string;
  enabled?: boolean;
  logo_url?: string | null;
  custom_fields?: RequestForm['custom_fields'];
  notify_email?: boolean;
  notify_in_app?: boolean;
}): Promise<RequestForm> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/request-forms`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to save form');
  const { form } = await res.json();
  return form;
}

/**
 * Régénère la clé publique d'un formulaire.
 *
 * ATTENTION : tous les liens déjà partagés cessent de fonctionner. L'`id` est
 * exigé dès qu'il y a plusieurs formulaires — le serveur refuse de deviner
 * plutôt que de casser le lien d'un autre.
 */
export async function regenerateApiKey(formId?: string): Promise<string> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/request-forms/regenerate-key`, {
    method: 'POST',
    headers,
    body: JSON.stringify(formId ? { id: formId } : {}),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to regenerate key');
  const { api_key } = await res.json();
  return api_key;
}

export async function fetchFormSubmissions(): Promise<FormSubmission[]> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/request-forms/submissions`, { headers });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch submissions');
  const { submissions } = await res.json();
  return submissions || [];
}

export async function fetchFormSubmission(id: string): Promise<FormSubmission> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/request-forms/submissions/${id}`, { headers });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch submission');
  const { submission } = await res.json();
  return submission;
}

export interface FormSubmissionPatch {
  assessment_start_at?: string | null;
  assessment_end_at?: string | null;
  assessment_team_id?: string | null;
  assessment_user_id?: string | null;
  assessment_instructions?: string | null;
  archived?: boolean;
}

export async function updateFormSubmission(id: string, patch: FormSubmissionPatch): Promise<FormSubmission> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/request-forms/submissions/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to update submission');
  const { submission } = await res.json();
  return submission;
}

export async function deleteFormSubmission(id: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/request-forms/submissions/${id}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to delete submission');
}
