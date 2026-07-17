import { supabase } from './supabase';

const API_BASE = '/api';

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  // Office actif sélectionné — le serveur scope dessus (même convention que
  // billingApi) ; sans ce header, create-office partait du premier membership.
  let activeOrg = '';
  try { activeOrg = localStorage.getItem('lume-active-org') || ''; } catch {}
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ''}`,
    'x-org-id': activeOrg,
  };
}

export interface CreatedOffice {
  id: string;
  name: string;
  company_group_id?: string | null;
}

/** Erreur API enrichie — `code`/`capacity` servent aux messages localisés. */
export interface OfficeApiError extends Error {
  code?: string;
  capacity?: number;
  used?: number;
}

/**
 * Crée un nouvel office (= org) dans la même compagnie que l'org courant.
 * Réservé au propriétaire. Le créateur devient owner du nouvel office.
 * Rejette avec code='office_limit_reached' quand le plan est à sa limite.
 */
export async function createOffice(name: string): Promise<{ office: CreatedOffice }> {
  const res = await fetch(`${API_BASE}/orgs/create-office`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err: OfficeApiError = new Error(data.error || 'Failed to create office.');
    err.code = data.code;
    err.capacity = data.capacity;
    err.used = data.used;
    throw err;
  }
  return res.json();
}
