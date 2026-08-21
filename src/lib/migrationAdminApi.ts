// Client API de la console interne des migrations (PLATFORM_OWNER_ID).
// Même idiome que leaderboardApi : Bearer + x-org-id (l'org n'est pas utilisée
// par ces routes mais le header reste inoffensif et uniforme).

import { supabase } from './supabase';

const BASE = '/api';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  let activeOrg = '';
  try {
    activeOrg = localStorage.getItem('lume-active-org') || '';
  } catch {
    activeOrg = '';
  }
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-org-id': activeOrg };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${BASE}/migration-admin${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

export async function checkPlatformAdmin(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return false;
    const res = await fetch(`${BASE}/migration-admin/check`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return false;
    const body = await res.json();
    return !!body?.isPlatformAdmin;
  } catch {
    return false;
  }
}

export interface AdminMigrationListItem {
  id: string;
  org_id: string;
  org_name: string | null;
  source_crm: string;
  status: string;
  priority: string;
  categories: string[];
  invited_email: string | null;
  target_date: string | null;
  created_at: string;
  last_activity_at: string;
  files_count: number;
  detected_counts: Record<string, number>;
  open_issues: number;
  risk_level: 'low' | 'medium' | 'high';
  invitation: { expires_at: string; revoked_at: string | null; opened_at: string | null; created_at: string } | null;
  latest_approval: { decision: string; created_at: string; report_version: number } | null;
}

export function listMigrations(params: { status?: string; q?: string; page?: number }): Promise<{
  data: AdminMigrationListItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.q) qs.set('q', params.q);
  if (params.page) qs.set('page', String(params.page));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch(`/migrations${suffix}`);
}

export function createMigration(payload: {
  org_id: string;
  source_crm?: string;
  categories?: string[];
  priority?: string;
  target_date?: string | null;
  internal_notes?: string | null;
  invited_email?: string | null;
}): Promise<{ id: string }> {
  return apiFetch('/migrations', { method: 'POST', body: JSON.stringify(payload) });
}

export function getMigrationDetail(id: string): Promise<any> {
  return apiFetch(`/migrations/${id}`);
}

export function patchMigration(id: string, payload: Record<string, unknown>): Promise<any> {
  return apiFetch(`/migrations/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export function setMigrationStatus(id: string, to: string): Promise<any> {
  return apiFetch(`/migrations/${id}/status`, { method: 'POST', body: JSON.stringify({ to }) });
}

export function generateInvitation(id: string, ttlHours?: number): Promise<{ invite_url: string; expires_at: string }> {
  return apiFetch(`/migrations/${id}/invitation`, { method: 'POST', body: JSON.stringify(ttlHours ? { ttl_hours: ttlHours } : {}) });
}

export function revokeInvitation(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/migrations/${id}/invitation/revoke`, { method: 'POST', body: JSON.stringify({}) });
}

export function extendInvitation(id: string, ttlHours: number): Promise<{ ok: boolean; expires_at: string }> {
  return apiFetch(`/migrations/${id}/invitation/extend`, { method: 'POST', body: JSON.stringify({ ttl_hours: ttlHours }) });
}

export function rejectFile(id: string, fileId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/migrations/${id}/files/${fileId}/reject`, { method: 'POST', body: JSON.stringify({}) });
}

export function reanalyzeFile(id: string, fileId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/migrations/${id}/files/${fileId}/reanalyze`, { method: 'POST', body: JSON.stringify({}) });
}

export function getFileDownloadUrl(id: string, fileId: string): Promise<{ url: string }> {
  return apiFetch(`/migrations/${id}/files/${fileId}/download`);
}

export function decideMapping(
  id: string,
  mappingId: string,
  payload: { status: string; target_entity?: string | null; target_field?: string | null },
): Promise<any> {
  return apiFetch(`/migrations/${id}/mappings/${mappingId}`, { method: 'POST', body: JSON.stringify(payload) });
}

export function createIssue(id: string, payload: { type: string; severity?: string; title: string; client_visible?: boolean; options?: string[] }): Promise<any> {
  return apiFetch(`/migrations/${id}/issues`, { method: 'POST', body: JSON.stringify(payload) });
}

export function resolveIssue(id: string, issueId: string, resolution: string): Promise<any> {
  return apiFetch(`/migrations/${id}/issues/${issueId}/resolve`, { method: 'POST', body: JSON.stringify({ resolution }) });
}

export function decideDuplicate(id: string, dupId: string, decision: string): Promise<any> {
  return apiFetch(`/migrations/${id}/duplicates/${dupId}`, { method: 'POST', body: JSON.stringify({ decision }) });
}

export function startAnalysis(id: string): Promise<{ ok: boolean; files: number }> {
  return apiFetch(`/migrations/${id}/analyze`, { method: 'POST', body: JSON.stringify({}) });
}

export function startTestImport(id: string): Promise<{ ok: boolean; batch_id: string }> {
  return apiFetch(`/migrations/${id}/test-import`, { method: 'POST', body: JSON.stringify({}) });
}

export function requestApproval(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/migrations/${id}/request-approval`, { method: 'POST', body: JSON.stringify({}) });
}

export function startFinalImport(id: string, confirmOrgName: string): Promise<{ ok: boolean; batch_id: string }> {
  return apiFetch(`/migrations/${id}/final-import`, { method: 'POST', body: JSON.stringify({ confirm_org_name: confirmOrgName }) });
}

export function rollbackMigration(id: string, confirmOrgName: string): Promise<{ ok: boolean; softDeleted: number; deactivated: number }> {
  return apiFetch(`/migrations/${id}/rollback`, { method: 'POST', body: JSON.stringify({ confirm_org_name: confirmOrgName }) });
}

export function closeMigration(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/migrations/${id}/close`, { method: 'POST', body: JSON.stringify({}) });
}

export function sendAdminMessage(id: string, body: string): Promise<any> {
  return apiFetch(`/migrations/${id}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
}

export function getMigrationAudit(id: string, page = 1): Promise<{ data: any[]; total: number; page: number; pageSize: number }> {
  return apiFetch(`/migrations/${id}/audit?page=${page}`);
}
