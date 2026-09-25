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

async function throwApiError(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => ({}));
  const err: OfficeApiError = new Error(data.error || fallback);
  err.code = data.code;
  err.capacity = data.capacity;
  err.used = data.used;
  throw err;
}

// ── Liste des bureaux (Réglages → Bureaux) ──────────────────────────

export interface OfficeSummary {
  id: string;
  name: string;
  created_at: string;
  phone: string;
  street1: string;
  city: string;
  province: string;
  member_count: number;
  /** Porte l'abonnement de la compagnie. */
  is_primary: boolean;
  /** L'utilisateur courant en est membre (peut y basculer). */
  is_member: boolean;
  is_current: boolean;
}

export interface OfficesListing {
  offices: OfficeSummary[];
  capacity: number;
  used: number;
  can_create: boolean;
  caller_role: 'owner' | 'admin';
}

export async function listOffices(): Promise<OfficesListing> {
  const res = await fetch(`${API_BASE}/orgs/offices`, { headers: await authHeaders() });
  if (!res.ok) await throwApiError(res, 'Failed to load offices.');
  return res.json();
}

// ── Création ────────────────────────────────────────────────────────

export interface OfficeAddressInput {
  street1?: string;
  street2?: string;
  city?: string;
  province?: string;
  postal_code?: string;
  country?: string;
}

export interface OfficeInherit {
  branding: boolean;
  taxes: boolean;
  email_templates: boolean;
  tags_sources: boolean;
}

export interface CreateOfficeInput {
  name: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: OfficeAddressInput | null;
  inherit?: OfficeInherit;
  grant_user_ids?: string[];
}

export interface GrantableMember {
  user_id: string;
  role: 'owner' | 'admin';
  full_name: string;
  avatar_url: string | null;
  email: string;
}

export async function listGrantableMembers(): Promise<GrantableMember[]> {
  const res = await fetch(`${API_BASE}/orgs/offices/grantable-members`, { headers: await authHeaders() });
  if (!res.ok) await throwApiError(res, 'Failed to load members.');
  const data = await res.json();
  return data.members || [];
}

/**
 * Crée un nouvel office (= org) dans la même compagnie que l'org courant.
 * Réservé au propriétaire. Le créateur devient owner du nouvel office.
 * Rejette avec code='office_limit_reached' quand le plan est à sa limite.
 */
export async function createOffice(input: CreateOfficeInput): Promise<{ office: CreatedOffice; granted: string[] }> {
  const res = await fetch(`${API_BASE}/orgs/create-office`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) await throwApiError(res, 'Failed to create office.');
  return res.json();
}

// ── Accès aux bureaux (Réglages → Bureaux → Accès) ──────────────────

export type OfficeAccessRole = 'admin' | 'sales_rep' | 'technician';

export interface OfficeAccessOffice {
  id: string;
  name: string;
  is_current: boolean;
}

export interface OfficeAccessPerson {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  email: string;
  /** Propriétaire : a tous les bureaux, non modifiable ici. */
  is_owner: boolean;
  /** Par bureau : rôle + statut de l'adhésion (absent = aucun accès). */
  access: Record<string, { role: string; status: string }>;
}

export interface OfficeAccessMatrix {
  offices: OfficeAccessOffice[];
  people: OfficeAccessPerson[];
  caller_id: string;
}

export async function getOfficeAccess(): Promise<OfficeAccessMatrix> {
  const res = await fetch(`${API_BASE}/orgs/offices/access`, { headers: await authHeaders() });
  if (!res.ok) await throwApiError(res, 'Failed to load office access.');
  return res.json();
}

/** `role: null` retire l'accès de la personne à ce bureau. */
export async function setOfficeAccess(userId: string, orgId: string, role: OfficeAccessRole | null): Promise<void> {
  const res = await fetch(`${API_BASE}/orgs/offices/access`, {
    method: 'PUT',
    headers: await authHeaders(),
    body: JSON.stringify({ user_id: userId, org_id: orgId, role }),
  });
  if (!res.ok) await throwApiError(res, 'Failed to update office access.');
}

// ── Vue d'ensemble des bureaux (propriétaire) ────────────────────────

export interface OfficeFigures {
  revenue_cents: number;
  invoiced_cents: number;
  outstanding_cents: number;
  past_due_count: number;
  new_leads: number;
  converted_quotes: number;
  new_jobs: number;
  requests: number;
  unread_conversations: number;
}

export interface OfficesOverview {
  from: string;
  to: string;
  offices: Array<{ org_id: string; name: string; chiffres: OfficeFigures }>;
  totals: OfficeFigures;
}

/** Les chiffres de chacun des bureaux du propriétaire, sur la période, et leur total. */
export async function fetchOfficesOverview(from: string, to: string): Promise<OfficesOverview> {
  const res = await fetch(`${API_BASE}/orgs/offices/overview?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) await throwApiError(res, 'Impossible de charger la vue d’ensemble des bureaux.');
  return res.json();
}
