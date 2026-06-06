import { supabase } from './supabase';

const API_BASE = '/api';

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ''}`,
  };
}

export interface CreatedOffice {
  id: string;
  name: string;
  company_group_id: string | null;
}

/**
 * Crée un nouvel office (= org) dans la même compagnie que l'org courant.
 * Réservé au propriétaire. Le créateur devient owner du nouvel office.
 */
export async function createOffice(name: string): Promise<{ office: CreatedOffice }> {
  const res = await fetch(`${API_BASE}/orgs/create-office`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to create office.');
  return res.json();
}
