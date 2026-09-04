// Client API du portail de migration temporaire. Le jeton d'invitation voyage
// dans le header `x-migration-invite` sur chaque appel, en plus de la session
// Lume (Bearer). Aucune donnée n'est lisible avec le jeton seul.

import { supabase } from './supabase';

const BASE = '/api';

export class PortalError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'PortalError';
    this.code = code;
    this.status = status;
  }
}

async function portalHeaders(token: string): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const access = data.session?.access_token ?? '';
  return {
    'Content-Type': 'application/json',
    Authorization: access ? `Bearer ${access}` : '',
    'x-migration-invite': token,
  };
}

async function portalFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const headers = await portalHeaders(token);
  if (!headers.Authorization) throw new PortalError('Connexion requise.', 'auth_required', 401);
  const res = await fetch(`${BASE}/migration-portal${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new PortalError(body?.error ?? `HTTP ${res.status}`, body?.code ?? 'error', res.status);
  }
  return body as T;
}

export interface PortalFile {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  kind: 'data' | 'archive';
  category_detected: string | null;
  row_count: number | null;
  column_count: number | null;
  security_status: string;
  parse_status: string;
  parse_error: string | null;
  created_at: string;
}

export interface PortalSession {
  migration_id: string;
  workspace_name: string;
  source_crm: string;
  status: string;
  categories: string[];
  importable_categories: string[];
  expires_at: string;
  read_only: boolean;
  can_upload: boolean;
  can_edit_mappings: boolean;
  files: PortalFile[];
  detected_counts: Record<string, number>;
  open_questions: number;
  latest_approval: { decision: string; report_version: number; created_at: string } | null;
  freeze: { start: string | null; end: string | null; confirmed_at: string | null };
  user: { email: string; role: string };
}

export function getPortalSession(token: string): Promise<PortalSession> {
  return portalFetch(token, '/session');
}

export function getPortalInstructions(token: string): Promise<any> {
  return portalFetch(token, '/instructions');
}

export function listPortalFiles(token: string): Promise<PortalFile[]> {
  return portalFetch(token, '/files');
}

export async function uploadPortalFile(token: string, file: File): Promise<PortalFile> {
  const headers = await portalHeaders(token);
  if (!headers.Authorization) throw new PortalError('Connexion requise.', 'auth_required', 401);
  delete (headers as Record<string, string>)['Content-Type'];
  const res = await fetch(`${BASE}/migration-portal/files?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) throw new PortalError(body?.error ?? `HTTP ${res.status}`, body?.code ?? 'error', res.status);
  return body as PortalFile;
}

export function deletePortalFile(token: string, fileId: string): Promise<{ ok: boolean }> {
  return portalFetch(token, `/files/${fileId}`, { method: 'DELETE' });
}

export interface PortalColumn {
  id: string;
  file_id: string;
  position: number;
  header: string;
  detected_type: string;
  empty_ratio: number;
  samples_masked: string[];
}

export interface PortalMapping {
  id: string;
  file_id: string;
  column_id: string;
  target_entity: string | null;
  target_field: string | null;
  confidence: number;
  reason: string | null;
  status: string;
}

export interface PortalMappingsResponse {
  columns: PortalColumn[];
  mappings: PortalMapping[];
  can_edit: boolean;
  field_catalog: Record<string, { field: string; labelFr: string; labelEn: string }[]>;
}

export function getPortalMappings(token: string): Promise<PortalMappingsResponse> {
  return portalFetch(token, '/mappings');
}

export function correctPortalMapping(
  token: string,
  mappingId: string,
  payload: { target_entity: string | null; target_field: string | null },
): Promise<PortalMapping> {
  return portalFetch(token, `/mappings/${mappingId}/correct`, { method: 'POST', body: JSON.stringify(payload) });
}

export interface PortalIssue {
  id: string;
  type: string;
  severity: string;
  title: string;
  details_masked: Record<string, unknown>;
  options: string[];
  client_answer: string | null;
  client_answered_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

export function listPortalIssues(token: string): Promise<PortalIssue[]> {
  return portalFetch(token, '/issues');
}

export function answerPortalIssue(token: string, issueId: string, answer: string): Promise<PortalIssue> {
  return portalFetch(token, `/issues/${issueId}/answer`, { method: 'POST', body: JSON.stringify({ answer }) });
}

export interface PortalPreview {
  report: any;
  generated_at: string | null;
  approval_sentences: { fr: string; en: string };
  can_approve: boolean;
}

export function getPortalPreview(token: string): Promise<PortalPreview> {
  return portalFetch(token, '/preview');
}

export interface PortalPreviewRow {
  row_number: number;
  status: string;
  fields: Record<string, string>;
}

/** Premières lignes transformées, PII masquée côté serveur. */
export function getPortalPreviewRows(token: string): Promise<{ by_entity: Record<string, PortalPreviewRow[]> }> {
  return portalFetch(token, '/preview-rows');
}

/** CSV des lignes en erreur/exclues (les données du bureau, pour correction). */
export async function downloadPortalRejectsCsv(token: string): Promise<string> {
  const headers = await portalHeaders(token);
  if (!headers.Authorization) throw new PortalError('Connexion requise.', 'auth_required', 401);
  const res = await fetch(`${BASE}/migration-portal/rejects.csv`, { headers });
  if (!res.ok) {
    let body: any = null;
    try { body = await res.json(); } catch { body = null; }
    throw new PortalError(body?.error ?? `HTTP ${res.status}`, body?.code ?? 'error', res.status);
  }
  return res.text();
}

export function submitPortalApproval(
  token: string,
  payload: { decision: 'approved' | 'refused' | 'changes_requested'; confirmed_text?: string; comment?: string },
): Promise<{ id: string; decision: string; report_version: number }> {
  return portalFetch(token, '/approval', { method: 'POST', body: JSON.stringify(payload) });
}

export function getPortalReport(token: string): Promise<any> {
  return portalFetch(token, '/report');
}

export interface PortalMessage {
  id: string;
  author_kind: 'client' | 'assistant' | 'admin';
  body: string;
  created_at: string;
}

export function listPortalMessages(token: string): Promise<PortalMessage[]> {
  return portalFetch(token, '/messages');
}

export function sendPortalMessage(token: string, body: string): Promise<PortalMessage> {
  return portalFetch(token, '/messages', { method: 'POST', body: JSON.stringify({ body }) });
}
