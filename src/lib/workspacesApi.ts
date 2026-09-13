import { supabase } from './supabase';

const API_BASE = '/api';

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  let activeOrg = '';
  try { activeOrg = localStorage.getItem('lume-active-org') || ''; } catch {}
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ''}`,
    'x-org-id': activeOrg,
  };
}

export type WorkspaceMode = 'onboarding' | 'new';
export type InviteRole = 'admin' | 'technician' | 'sales_rep';
export type EmployeeCount = '1' | '2-5' | '6-15' | '16-50' | '50+';

export interface WorkspaceCreateInput {
  mode: WorkspaceMode;
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
  mode: WorkspaceMode;
  tax_region: string;
  invites_sent: number;
  next: '/checkout' | '/day';
}

/**
 * Crée / complète un workspace (compagnie). Mode 'onboarding' : complète
 * l'org courant après paiement. Mode 'new' : nouvelle compagnie séparée
 * (nouveau company_group), à abonner ensuite via /checkout.
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
