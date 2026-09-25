/**
 * Dossier client — ce que l'assistant de support SAIT du compte avant de
 * répondre, quelle que soit la surface (app, portail de migration, Slack).
 *
 * Lecture seule, via le client service (le support n'écrit rien). Chaque
 * lecture est tolérante : une table qui manque ou une erreur PostgREST
 * enlève une ligne du dossier, jamais la réponse. Le texte produit est
 * court (une page) : il entre dans le prompt système à chaque tour.
 *
 * Aucune valeur d'un AUTRE client n'y entre : tout est filtré par org_id.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';
import { intervalleLu, libelleFacturation } from '../abonnement-intervalle';

export const STATUTS_MIGRATION_EN_MOTS: Record<string, string> = {
  draft: 'créée, en attente de votre lien de portail',
  invitation_sent: 'lien du portail envoyé, en attente de vos fichiers',
  waiting_for_files: 'en attente de vos fichiers',
  files_uploaded: 'fichiers reçus, analyse à venir',
  parsing: 'fichiers en cours d\'analyse',
  mapping: 'correspondance des colonnes en cours',
  human_review: 'vérification par l\'équipe Lume',
  waiting_for_client: 'en attente d\'une réponse de votre part dans le portail',
  ready_for_test: 'prête pour l\'import test',
  testing: 'import test en cours',
  test_review: 'import test terminé, vérification des résultats',
  waiting_for_approval: 'import test concluant, en attente de l\'approbation',
  approved: 'approuvée, l\'import final suit',
  ready_for_final_import: 'prête pour l\'import final',
  importing: 'import final en cours',
  completed: 'terminée : vos données sont dans Lume',
  completed_with_warnings: 'terminée avec quelques lignes à vérifier',
  failed: 'échouée, l\'équipe Lume s\'en occupe',
  rolled_back: 'annulée et retirée (retour en arrière)',
  cancelled: 'annulée',
};

export function statutMigrationEnMots(status: string): string {
  return STATUTS_MIGRATION_EN_MOTS[status] ?? status;
}

export interface DossierClient {
  /** Bloc texte prêt pour le prompt système. */
  texte: string;
  /** Dernière migration de l'org (pour l'outil get_migration_status). */
  migration: { id: string; status: string; source_crm: string; bot_mode: string | null; arret: string | null } | null;
}

type Admin = SupabaseClient;

async function sur<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>, quoi: string): Promise<T | null> {
  try {
    const r = await p;
    if (r.error) { logger.warn('[support/dossier] lecture ignorée', { quoi, error: r.error.message }); return null; }
    return r.data;
  } catch (err: any) {
    logger.warn('[support/dossier] lecture ignorée', { quoi, error: err?.message || String(err) });
    return null;
  }
}
async function compter(p: PromiseLike<{ count: number | null; error: { message: string } | null }>, quoi: string): Promise<number | null> {
  try {
    const r = await p;
    if (r.error) { logger.warn('[support/dossier] compte ignoré', { quoi, error: r.error.message }); return null; }
    return r.count ?? 0;
  } catch (err: any) {
    logger.warn('[support/dossier] compte ignoré', { quoi, error: err?.message || String(err) });
    return null;
  }
}

function jours(depuis: string | null | undefined): number | null {
  if (!depuis) return null;
  const t = new Date(depuis).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 86_400_000)) : null;
}
function dateCourte(s: string | null | undefined): string {
  if (!s) return '?';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : '?';
}

/**
 * Construit le dossier d'un client (org + personne). ~12 lectures en
 * parallèle, toutes filtrées par org_id ; ~150 ms. Ne lève jamais.
 */
export async function dossierClient(admin: Admin, orgId: string, userId: string | null): Promise<DossierClient> {
  const il30j = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [
    org, sub, reglages, membres, equipe,
    nClients, nJobs, nDevis, nFactures, nFacturesDues,
    nAutomatisations, nAutomatisationsActives, paiements, stripeConnect,
    rebonds, migration, tickets, actionsLumi, nonLues,
  ] = await Promise.all([
    sur(admin.from('orgs').select('name, created_at, employee_count').eq('id', orgId).maybeSingle(), 'org'),
    sur(admin.from('subscriptions').select('status, plan_id, interval, current_period_end, cancel_at_period_end, plans!subscriptions_plan_id_fkey(name, slug)').eq('org_id', orgId).order('created_at', { ascending: false }).limit(1).maybeSingle(), 'abonnement'),
    sur(admin.from('company_settings').select('setup_completed, timezone, default_language, industry, city, google_review_url, review_enabled').eq('org_id', orgId).maybeSingle(), 'réglages'),
    sur(admin.from('memberships').select('role').eq('org_id', orgId).eq('status', 'active'), 'membres'),
    compter(admin.from('team_members').select('id', { count: 'exact', head: true }).eq('org_id', orgId), 'équipe'),
    compter(admin.from('clients').select('id', { count: 'exact', head: true }).eq('org_id', orgId).is('deleted_at', null), 'clients'),
    compter(admin.from('jobs').select('id', { count: 'exact', head: true }).eq('org_id', orgId).is('deleted_at', null), 'jobs'),
    compter(admin.from('quotes').select('id', { count: 'exact', head: true }).eq('org_id', orgId).is('deleted_at', null), 'devis'),
    compter(admin.from('invoices').select('id', { count: 'exact', head: true }).eq('org_id', orgId).is('deleted_at', null), 'factures'),
    compter(admin.from('invoices').select('id', { count: 'exact', head: true }).eq('org_id', orgId).is('deleted_at', null).gt('balance_cents', 0).neq('status', 'draft'), 'factures dues'),
    compter(admin.from('automation_rules').select('id', { count: 'exact', head: true }).eq('org_id', orgId), 'automatisations'),
    compter(admin.from('automation_rules').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_active', true), 'automatisations actives'),
    sur(admin.from('payment_provider_settings').select('default_provider, stripe_enabled, paypal_enabled').eq('org_id', orgId).maybeSingle(), 'paiements'),
    sur(admin.from('connected_accounts').select('onboarding_complete, charges_enabled, payouts_enabled').eq('org_id', orgId).limit(1).maybeSingle(), 'stripe connect'),
    compter(admin.from('email_deliveries').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'bounced').gte('created_at', il30j), 'rebonds courriel'),
    sur(admin.from('data_migrations').select('id, status, source_crm, bot_mode, bot_actif, updated_at, bot_dernier_rapport').eq('org_id', orgId).is('deleted_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle(), 'migration'),
    sur(admin.from('support_tickets').select('subject, status, source, last_message_at, escalation_reason').eq('org_id', orgId).order('last_message_at', { ascending: false }).limit(5), 'tickets'),
    sur(admin.from('agent_actions').select('outil, created_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(5), 'actions Lumi'),
    userId ? compter(admin.from('notifications').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('user_id', userId).eq('is_read', false).is('deleted_at', null), 'notifications') : Promise.resolve(null),
  ]);

  const L: string[] = [];
  const o = org as { name?: string; created_at?: string; employee_count?: string | null } | null;
  if (o) L.push(`Entreprise : ${o.name ?? '?'} — compte créé le ${dateCourte(o.created_at)} (${jours(o.created_at) ?? '?'} jours)${o.employee_count ? `, ${o.employee_count} employés déclarés` : ''}.`);
  const s = sub as { status?: string; interval?: string | null; current_period_end?: string | null; cancel_at_period_end?: boolean | null; plans?: { name?: string; slug?: string } | Array<{ name?: string; slug?: string }> | null } | null;
  if (s) {
    const plan = Array.isArray(s.plans) ? s.plans[0] : s.plans;
    L.push(`Abonnement : forfait ${plan?.name ?? plan?.slug ?? '?'}, statut ${s.status ?? '?'}${s.interval ? `, ${libelleFacturation(intervalleLu(s.interval)).toLowerCase()}` : ''}${s.current_period_end ? `, période en cours jusqu'au ${dateCourte(s.current_period_end)}` : ''}${s.cancel_at_period_end ? ' — ANNULATION prévue à la fin de la période' : ''}.`);
  } else L.push('Abonnement : aucun abonnement trouvé (compte sans forfait actif).');
  const r = reglages as { setup_completed?: boolean | null; timezone?: string | null; default_language?: string | null; industry?: string | null; city?: string | null; google_review_url?: string | null; review_enabled?: boolean | null } | null;
  if (r) L.push(`Réglages : configuration initiale ${r.setup_completed ? 'terminée' : 'PAS terminée'}${r.industry ? `, industrie ${r.industry}` : ''}${r.city ? `, ${r.city}` : ''}${r.timezone ? `, fuseau ${r.timezone}` : ''}, langue ${r.default_language ?? 'fr'} ; avis Google ${r.google_review_url ? 'configurés' : 'non configurés'}${r.review_enabled === false ? ' (désactivés)' : ''}.`);
  const mb = (membres ?? []) as Array<{ role?: string }>;
  if (mb.length || equipe !== null) {
    const parRole = mb.reduce((a: Record<string, number>, m) => { const k = m.role ?? '?'; a[k] = (a[k] ?? 0) + 1; return a; }, {});
    L.push(`Personnes : ${mb.length} utilisateur${mb.length > 1 ? 's' : ''} (${Object.entries(parRole).map(([k, n]) => `${n} ${k}`).join(', ') || '—'})${equipe !== null ? `, ${equipe} membre${equipe > 1 ? 's' : ''} d'équipe terrain` : ''}.`);
  }
  const compte = (n: number | null, mot: string) => (n === null ? null : `${n} ${mot}`);
  const volumes = [compte(nClients, 'clients'), compte(nJobs, 'jobs'), compte(nDevis, 'devis'), compte(nFactures, 'factures')].filter(Boolean);
  if (volumes.length) L.push(`Données : ${volumes.join(', ')}${nFacturesDues ? ` ; ${nFacturesDues} facture${nFacturesDues > 1 ? 's' : ''} avec un solde dû` : ''}.`);
  if (nAutomatisations !== null) L.push(`Automatisations : ${nAutomatisations} règle${nAutomatisations > 1 ? 's' : ''}${nAutomatisationsActives !== null ? `, ${nAutomatisationsActives} active${nAutomatisationsActives > 1 ? 's' : ''}` : ''}.`);
  const p = paiements as { default_provider?: string | null; stripe_enabled?: boolean | null; paypal_enabled?: boolean | null } | null;
  const sc = stripeConnect as { onboarding_complete?: boolean; charges_enabled?: boolean; payouts_enabled?: boolean } | null;
  const paiementsTxt: string[] = [];
  if (p) paiementsTxt.push(`Stripe ${p.stripe_enabled ? 'activé' : 'non activé'}, PayPal ${p.paypal_enabled ? 'activé' : 'non activé'}${p.default_provider ? `, défaut ${p.default_provider}` : ''}`);
  if (sc) paiementsTxt.push(`Lume Payments (Stripe Connect) : inscription ${sc.onboarding_complete ? 'terminée' : 'PAS terminée'}, encaissements ${sc.charges_enabled ? 'actifs' : 'inactifs'}, virements ${sc.payouts_enabled ? 'actifs' : 'inactifs'}`);
  if (paiementsTxt.length) L.push(`Paiements : ${paiementsTxt.join(' ; ')}.`);
  else if (p === null && sc === null) L.push('Paiements : aucun fournisseur de paiement configuré.');
  if (rebonds) L.push(`Courriels : ${rebonds} rebond${rebonds > 1 ? 's' : ''} (adresse injoignable) dans les 30 derniers jours.`);
  const m = migration as { id: string; status: string; source_crm: string; bot_mode: string | null; bot_actif?: boolean | null; updated_at?: string; bot_dernier_rapport?: { arret?: string } | null } | null;
  let migrationOut: DossierClient['migration'] = null;
  if (m) {
    const arret = m.bot_dernier_rapport?.arret ?? null;
    migrationOut = { id: m.id, status: m.status, source_crm: m.source_crm, bot_mode: m.bot_mode, arret };
    L.push(`Migration de données (depuis ${m.source_crm}) : ${statutMigrationEnMots(m.status)} — mis à jour le ${dateCourte(m.updated_at)}${m.bot_mode === 'client' ? ' ; mode « questions au client »' : ' ; mode autonome (le client n\'a rien à faire)'}${arret ? ` ; dernier passage du bot : ${arret}` : ''}.`);
  } else L.push('Migration de données : aucune migration en cours ni passée.');
  const tk = (tickets ?? []) as Array<{ subject: string; status: string; source?: string | null; last_message_at: string; escalation_reason?: string | null }>;
  if (tk.length) L.push(`Demandes de support récentes : ${tk.map((t) => `« ${t.subject.slice(0, 60)} » (${t.status === 'ai' ? 'assistant' : t.status === 'open' ? 'chez l\'équipe' : t.status === 'answered' ? 'répondue par l\'équipe' : 'fermée'}${t.source && t.source !== 'app' ? `, ${t.source === 'migration_portal' ? 'portail de migration' : t.source}` : ''}, ${dateCourte(t.last_message_at)})`).join(' ; ')}.`);
  const al = (actionsLumi ?? []) as Array<{ outil: string; created_at: string }>;
  if (al.length) L.push(`Dernières actions de Lumi (l'assistant dans l'app) : ${al.map((a) => `${a.outil} (${dateCourte(a.created_at)})`).join(', ')}.`);
  if (nonLues) L.push(`Notifications non lues de cette personne : ${nonLues}.`);

  return { texte: L.join('\n'), migration: migrationOut };
}
