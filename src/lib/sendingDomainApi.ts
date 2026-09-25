/**
 * Domaine d'envoi propre à l'entreprise (« Envoyer depuis mon adresse »).
 * Routes serveur : /api/sending-domain (owner/admin). Même idiome que
 * leaderboardApi : Bearer + x-org-id.
 */
import { supabase } from './supabase';
import { bureauActifSync } from './orgApi';

export type StatutDomaineEnvoi = 'pending' | 'verified' | 'failed';

export interface EnregistrementDnsEnvoi {
  record: string | null;
  type: string;
  name: string;
  value: string;
  ttl: string | null;
  status: string | null;
  priority: number | null;
}

export interface DomaineEnvoi {
  id: string;
  org_id: string;
  domain: string;
  from_local_part: string;
  status: StatutDomaineEnvoi;
  dns_records: EnregistrementDnsEnvoi[];
  last_checked_at: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EtatDomaineEnvoi {
  domain: DomaineEnvoi | null;
  providerConfigured: boolean;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  let activeOrg = '';
  try { activeOrg = bureauActifSync() || ''; } catch { /* stockage indisponible : le serveur retombe sur l'org courante */ }
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-org-id': activeOrg };
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/sending-domain${path}`, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error ?? `HTTP ${res.status}`);
  return body as T;
}

export function lireDomaineEnvoi(): Promise<EtatDomaineEnvoi> {
  return apiFetch<EtatDomaineEnvoi>('');
}

export function demanderDomaineEnvoi(domain: string): Promise<{ domain: DomaineEnvoi }> {
  return apiFetch<{ domain: DomaineEnvoi }>('', { method: 'POST', body: JSON.stringify({ domain }) });
}

export function verifierDomaineEnvoi(): Promise<{ domain: DomaineEnvoi }> {
  return apiFetch<{ domain: DomaineEnvoi }>('/verify', { method: 'POST' });
}

export function retirerDomaineEnvoi(): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>('', { method: 'DELETE' });
}

/** « facturation@monentreprise.ca » — l'adresse d'expédition qu'un domaine vérifié donne. */
export function adresseExpedition(d: Pick<DomaineEnvoi, 'domain' | 'from_local_part'>): string {
  return `${d.from_local_part || 'facturation'}@${d.domain}`;
}
