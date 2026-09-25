import { supabase } from './supabase';
import { bureauActifSync } from './orgApi';

const API_BASE = '/api';

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  let activeOrg = '';
  try { activeOrg = bureauActifSync() || ''; } catch {}
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ''}`,
    'x-org-id': activeOrg,
  };
}

export type InviteRole = 'admin' | 'technician' | 'sales_rep';
export type EmployeeCount = '1' | '2-5' | '6-15' | '16-50' | '50+';

export interface WorkspaceCreateInput {
  company: {
    name: string;
    industry: string;
    employee_count: EmployeeCount;
    logo_url?: string | null;
    language?: 'fr' | 'en';
  };
  profile?: { full_name?: string | null } | null;
  contact?: {
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    address?: {
      street1?: string; street2?: string; city?: string;
      province?: string; postal_code?: string; country?: string;
    } | null;
  } | null;
  preferences?: {
    currency?: 'CAD' | 'USD' | null;
    timezone?: string | null;
    revenue_goal_cents?: number | null;
  } | null;
  reviews?: {
    enabled?: boolean | null;
    google_review_url?: string | null;
    facebook_review_url?: string | null;
  } | null;
  invites?: Array<{ email: string; role: InviteRole }>;
}

export interface WorkspaceCreateResult {
  ok: boolean;
  org_id: string;
  tax_region: string;
  invites_sent: number;
}

/**
 * Complète le workspace (compagnie) de l'utilisateur après paiement :
 * nom, industrie, coordonnées, préférences, avis, invitations.
 * Un seul workspace par compte ; les bureaux dépendent du forfait.
 */
export async function createWorkspace(input: WorkspaceCreateInput): Promise<WorkspaceCreateResult> {
  const res = await fetch(`${API_BASE}/workspaces/create`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to create workspace.');
  }
  return res.json();
}
