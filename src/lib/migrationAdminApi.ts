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

export interface EtatCommunications { gele: boolean; migration_id: string | null; gele_le: string | null; active_le: string | null; active_par: string | null }
/** « Activer le compte » : lève le gel des communications posé à l'import final. */
export function activateAccount(id: string): Promise<{ ok: boolean; communications: EtatCommunications }> {
  return apiFetch(`/migrations/${id}/activate-account`, { method: 'POST', body: JSON.stringify({}) });
}

/** Dépose un fichier (CSV ou PDF) dans une migration depuis la console — même réception que le portail. */
export async function uploadAdminFile(id: string, file: File): Promise<{ id: string; original_name: string }> {
  const headers = await getAuthHeaders();
  delete headers['Content-Type'];
  const res = await fetch(`${BASE}/migration-admin/migrations/${id}/files?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  let body: any = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
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

export function deleteFile(id: string, fileId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/migrations/${id}/files/${fileId}`, { method: 'DELETE' });
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

export type MappingFlag = 'red' | 'amber' | 'green' | 'blue' | 'purple';

export function flagMapping(id: string, mappingId: string, flag: MappingFlag | null): Promise<any> {
  return apiFetch(`/migrations/${id}/mappings/${mappingId}/flag`, { method: 'POST', body: JSON.stringify({ flag }) });
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

// ── Boucle qualité, employés historiques et gabarits (post-audit) ──

export async function downloadRejectsCsv(id: string): Promise<string> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${BASE}/migration-admin/migrations/${id}/rejects.csv`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export function retryErrors(id: string): Promise<{ ok: boolean; reset: number }> {
  return apiFetch(`/migrations/${id}/retry-errors`, { method: 'POST', body: JSON.stringify({}) });
}

export interface MigrationStaffEntry { source_key: string; label: string; count: number; user_id: string | null }
export function getMigrationStaff(id: string): Promise<{ staff: MigrationStaffEntry[] }> {
  return apiFetch(`/migrations/${id}/staff`);
}

export function saveStaffMap(id: string, mappings: { source: string; user_id: string | null }[]): Promise<{ ok: boolean; saved: number }> {
  return apiFetch(`/migrations/${id}/staff-map`, { method: 'POST', body: JSON.stringify({ mappings }) });
}

export function getMigrationMembers(id: string): Promise<{ user_id: string; role: string; name: string }[]> {
  return apiFetch(`/migrations/${id}/members`);
}

export function listMappingTemplates(sourceCrm?: string): Promise<{ id: string; source_crm: string; name: string; created_at: string }[]> {
  return apiFetch(`/templates${sourceCrm ? `?source_crm=${encodeURIComponent(sourceCrm)}` : ''}`);
}

export function saveMappingTemplate(id: string, name: string): Promise<{ ok: boolean; template_id: string; headers: number }> {
  return apiFetch(`/migrations/${id}/save-template`, { method: 'POST', body: JSON.stringify({ name }) });
}

/** Lance une passe du bot en arrière-plan (plusieurs minutes possibles) ; `depuis` sert à reconnaître la fin de passe. */
export function lancerBotMigration(id: string): Promise<{ started: true; depuis: string }> {
  return apiFetch(`/migrations/${id}/bot`, { method: 'POST' });
}
/** Rapport du bot, partiel pendant une passe (en_cours, etape_courante, progression) : lecture légère pour le suivi en direct. */
export function getRapportBot(id: string): Promise<{ rapport: RapportBotMigration | null; derniere_execution: string | null }> {
  return apiFetch(`/migrations/${id}/bot`);
}
/** Attend la fin d'une passe lancée par lancerBotMigration : suit bot_derniere_execution (toutes les 5 s, 20 min max). */
/**
 * Attend la fin de LA passe lancée par ce clic. Trois conditions, toutes sur le rapport lui-même
 * (pas de comparaison de chaînes ISO aux formats différents) :
 * - le rapport n'est plus marqué `en_cours` ;
 * - sa `fin` est postérieure au lancement (`depuis`) ;
 * - sa `debut` aussi — un rapport final d'une passe antérieure ne compte pas.
 * Le 2026-09-21, « Passe du bot terminée » s'affichait alors qu'une passe tournait encore.
 */
export async function attendreFinBot(id: string, depuis: string, opts: { intervalleMs?: number; maxMs?: number } = {}): Promise<RapportBotMigration | null> {
  const intervalle = opts.intervalleMs ?? 5000;
  const limite = Date.now() + (opts.maxMs ?? 20 * 60 * 1000);
  const t0 = new Date(depuis).getTime() - 5000; // tolérance : `depuis` est pris juste avant le vrai démarrage
  while (Date.now() < limite) {
    await new Promise((r) => setTimeout(r, intervalle));
    let etat: { rapport: RapportBotMigration | null; derniere_execution: string | null };
    try { etat = await getRapportBot(id); } catch { continue; }
    const r = etat.rapport;
    if (!r || r.en_cours) continue;
    const debut = r.debut ? new Date(r.debut).getTime() : NaN;
    const fin = r.fin ? new Date(r.fin).getTime() : NaN;
    if (Number.isFinite(debut) && Number.isFinite(fin) && debut >= t0 && fin >= t0) return r;
  }
  return null;
}
export interface DecisionBotMigration { etape: string; cible: string; decision: string; detail?: string }
export interface AuditBotMigration {
  fichiers: Array<{ nom: string; entite: string | null; nature: string | null }>;
  corrections: Array<{ fichier: string; colonne: string; avant: string | null; apres: string | null; pourquoi: string }>;
  alertes: Array<{ fichier: string; colonne: string; message: string; action: string }>;
  a_verifier: Array<{ fichier: string; colonne: string; actuel: string | null; candidats: string[]; pourquoi: string }>;
  manques: Array<{ fichier: string; colonne: string; entite: string; proposition: string; besoin: string }>;
  modele: string | null;
  /** Markdown prêt à coller dans Claude Code (« applique l'audit »). */
  texte_pour_claude: string;
}
export interface RapportBotMigration {
  migration_id: string; declencheur: 'manuel' | 'cron'; debut: string; fin: string;
  statut_avant: string; statut_apres: string; decisions: DecisionBotMigration[]; questions_posees: number; arret: string; cout_cents: number | null;
  /** Absent sur les rapports d'avant 2026-09-17. */
  audit?: AuditBotMigration;
  /** Vrai pendant la passe : le rapport est partiel et se met à jour. */
  en_cours?: boolean;
  etape_courante?: string | null;
  progression?: { fichiers_faits: number; fichiers_total: number } | null;
}
/** Le cron reprend la migration tout seul tant que c'est vrai. */
export function definirBotActif(id: string, actif: boolean): Promise<any> {
  return patchMigration(id, { bot_actif: actif });
}
export type ModeBotMigration = 'client' | 'autonome';
/** 'autonome' : le client n'a rien à faire (défauts sûrs, admin prévenu) ; 'client' : questions dans le portail. */
export function definirModeBot(id: string, mode: ModeBotMigration): Promise<any> {
  return patchMigration(id, { bot_mode: mode });
}
/** Approbation au nom du client par l'admin (mode autonome) : même ligne d'approbation, commentaire explicite. */
export function approuverAuNomDuClient(id: string, comment?: string): Promise<{ ok: boolean; status: string }> {
  return apiFetch(`/migrations/${id}/approve-on-behalf`, { method: 'POST', body: JSON.stringify({ comment: comment ?? null }) });
}

export function applyMappingTemplate(id: string, templateId: string): Promise<{ ok: boolean; applied: number }> {
  return apiFetch(`/migrations/${id}/apply-template`, { method: 'POST', body: JSON.stringify({ template_id: templateId }) });
}
