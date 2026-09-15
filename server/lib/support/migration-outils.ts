/**
 * Ce que l'assistant de support peut faire autour d'une migration, pour un
 * client connecté (app) ou dans le portail :
 *   - statutMigrationPour : où en est la migration, en mots simples
 *   - demarrerMigrationPour : créer la migration en mode autonome + le lien
 *     du portail (les mêmes lignes que la console admin : data_migrations,
 *     migration_invitations, audit). Réversible (annulable), jamais d'import.
 * L'admin Lume est prévenu (notification + Slack) : c'est lui qui approuvera
 * au nom du client et lancera l'import final.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateInviteToken, expiryFromNow } from '../migration/tokens';
import { logMigrationAudit } from '../migration/audit';
import { DEFAULT_INVITE_TTL_HOURS } from '../migration/types';
import { statutMigrationEnMots } from './dossier';
import { getBaseUrl, platformAdminIds, platformOwnerId } from '../config';
import { isSlackConfigured, canalSupport, envoyerMessageSlack, echapperSlack } from '../slack';
import { logger } from '../logger';

const SOURCES = new Set(['jobber', 'housecall_pro', 'servicetitan', 'gohighlevel', 'quickbooks', 'other', 'custom_files']);
const STATUTS_EN_COURS = ['draft', 'invitation_sent', 'waiting_for_files', 'files_uploaded', 'parsing', 'mapping', 'human_review', 'waiting_for_client', 'ready_for_test', 'testing', 'test_review', 'waiting_for_approval', 'approved', 'ready_for_final_import', 'importing'];

export async function statutMigrationPour(admin: SupabaseClient, orgId: string, migrationId?: string | null): Promise<string> {
  let q = admin.from('data_migrations').select('id, status, source_crm, bot_mode, bot_dernier_rapport, updated_at').eq('org_id', orgId).is('deleted_at', null).order('created_at', { ascending: false }).limit(1);
  if (migrationId) q = admin.from('data_migrations').select('id, status, source_crm, bot_mode, bot_dernier_rapport, updated_at').eq('id', migrationId).eq('org_id', orgId).is('deleted_at', null).limit(1);
  const { data } = await q.maybeSingle();
  if (!data) return 'Aucune migration de données pour ce compte.';
  const m = data as { id: string; status: string; source_crm: string; bot_mode: string | null; bot_dernier_rapport: { arret?: string; decisions?: unknown[] } | null; updated_at: string };
  const attendu = m.status === 'waiting_for_client' ? 'Attendu du client : répondre aux questions dans le portail.'
    : m.status === 'waiting_for_approval' && m.bot_mode === 'client' ? 'Attendu du client : approuver dans le portail (section Approbation).'
    : m.status === 'invitation_sent' || m.status === 'waiting_for_files' || m.status === 'draft' ? 'Attendu du client : déposer ses fichiers d\'export dans le portail.'
    : 'Rien n\'est attendu du client : Lume s\'en occupe.';
  const { count: fichiers } = await admin.from('migration_files').select('id', { count: 'exact', head: true }).eq('migration_id', m.id).eq('kind', 'data').is('deleted_at', null);
  return `Migration depuis ${m.source_crm} : ${statutMigrationEnMots(m.status)} (mise à jour ${m.updated_at.slice(0, 10)}). Fichiers reçus : ${fichiers ?? 0}. ${attendu}${m.bot_dernier_rapport?.arret ? ` Dernier passage du bot : ${m.bot_dernier_rapport.arret}.` : ''}`;
}

export async function demarrerMigrationPour(admin: SupabaseClient, p: { orgId: string; userId: string; userEmail: string | null; companyName: string; sourceCrm: string }): Promise<{ ok: true; lien: string; expire: string } | { ok: false; raison: string }> {
  const source = SOURCES.has(p.sourceCrm) ? p.sourceCrm : 'custom_files';
  const { data: existante } = await admin.from('data_migrations').select('id, status').eq('org_id', p.orgId).is('deleted_at', null).in('status', STATUTS_EN_COURS).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (existante) return { ok: false, raison: `Une migration est déjà en cours (${statutMigrationEnMots(existante.status)}). Donnez son statut plutôt que d'en créer une autre.` };
  const adminAssigne = platformOwnerId || [...platformAdminIds][0] || null;
  const { data: mig, error } = await admin.from('data_migrations').insert({
    org_id: p.orgId, source_crm: source, status: 'draft', categories: ['clients', 'jobs', 'quotes', 'invoices'], priority: 'normal',
    internal_notes: `Démarrée par le client via l'assistant de support (${new Date().toISOString().slice(0, 10)}).`,
    invited_email: p.userEmail, invited_user_id: p.userId, assigned_admin: adminAssigne, created_by: p.userId,
    bot_mode: 'autonome', bot_actif: true,
  }).select('id').single();
  if (error || !mig) return { ok: false, raison: `Création impossible : ${error?.message ?? 'inconnue'}` };
  const { token, tokenHash } = generateInviteToken();
  const expire = expiryFromNow(DEFAULT_INVITE_TTL_HOURS);
  const { error: eInv } = await admin.from('migration_invitations').insert({ migration_id: mig.id, token_hash: tokenHash, expires_at: expire, created_by: p.userId });
  if (eInv) return { ok: false, raison: `Lien du portail impossible : ${eInv.message}` };
  await admin.from('data_migrations').update({ status: 'invitation_sent' }).eq('id', mig.id).eq('status', 'draft');
  await logMigrationAudit(admin, { migrationId: mig.id, action: 'migration.create', actorId: p.userId, actorRole: 'client', meta: { via: 'support_assistant', source_crm: source } });
  await logMigrationAudit(admin, { migrationId: mig.id, action: 'invitation.generate', actorId: p.userId, actorRole: 'client', meta: { ttl_hours: DEFAULT_INVITE_TTL_HOURS, via: 'support_assistant' } });
  const lien = `${getBaseUrl()}/migration/invite/${token}`;
  // L'admin Lume sait qu'une migration démarre (jamais le jeton : seul le client le reçoit).
  const detail = `${p.companyName} démarre une migration depuis ${source} via l'assistant de support (mode autonome). Console : /admin/migrations#${mig.id}`;
  const cibles = new Set<string>([...platformAdminIds, ...(adminAssigne ? [adminAssigne] : [])]);
  for (const userId of cibles) {
    const { data: membre } = await admin.from('memberships').select('org_id').eq('user_id', userId).eq('status', 'active').order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (!membre?.org_id) continue;
    const { error: eN } = await admin.from('notifications').insert({ org_id: membre.org_id, user_id: userId, type: 'migration_bot', category: 'migration', title: 'Nouvelle migration démarrée par un client', body: detail.slice(0, 180), link: `/admin/migrations#${mig.id}`, icon: 'nouvelle' });
    if (eN) logger.error('[support/migration] notification admin impossible', { error: eN.message, migrationId: mig.id });
  }
  if (isSlackConfigured()) {
    try { await envoyerMessageSlack({ channel: canalSupport(), text: `🗂️ ${echapperSlack(detail)}` }); }
    catch (e: any) { logger.error('[support/migration] Slack impossible', { error: e?.message, migrationId: mig.id }); }
  }
  return { ok: true, lien, expire };
}
