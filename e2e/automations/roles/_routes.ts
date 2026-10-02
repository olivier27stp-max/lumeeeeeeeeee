/**
 * Le tableau paramétré des routes serveur des automatisations (carte §3) :
 * méthode, chemin, corps minimal valide, rôles autorisés, et — pour chaque
 * route d'écriture — la vérification de l'EFFET réel en base.
 *
 * Un test par route (30-api-roles.spec.ts) appelle chaque ligne avec le jeton
 * de chaque rôle. Ce fichier ne dépend pas de Playwright : la sonde jetable
 * (atelier de l'audit du 2026-10-01) le réutilise tel quel.
 *
 * Identifiants : la carte ne numérote pas les routes ; la série `API-01` à
 * `API-45` est celle de ce lot (ordre des tableaux §3.2 à §3.8).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from './_comptes';

export interface Outils {
  admin: SupabaseClient;
  orgA: string;
  orgB: string;
  idProprioA: string;
  /** Préfixe unique du test : tout ce qui est créé porte ce texte dans son nom. */
  marque: string;
  decor: Decor;
}

/** Données stables du bureau A dont les routes d'événements ont besoin. */
export interface Decor { client: string; job: string; visite: string; devis: string; tache: string; etiquette: string; modele: string }

export interface Ctx { [cle: string]: string }

export type Famille = 'lecture' | 'ecriture' | 'evenement';

export interface RouteApi {
  id: string;
  methode: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Chemin tel que déclaré dans ROUTE_PERMISSIONS (affichage). */
  gabarit: string;
  /** Clé(s) de permission exigée(s), pour le rapport. */
  cle: string;
  famille: Famille;
  /** Rôles du bureau A qui DOIVENT réussir. Tous les autres doivent recevoir 403. */
  autorises: readonly Role[];
  /** Codes acceptés pour un rôle autorisé. */
  succes: readonly number[];
  preparer?: (o: Outils, suffixe: string) => Promise<Ctx>;
  chemin: (c: Ctx, o: Outils) => string;
  corps?: (c: Ctx, o: Outils, suffixe: string) => unknown;
  /**
   * Vrai si l'écriture visée par la route a eu lieu en base. Absent = route sans écriture.
   * `patienceMs` : combien de temps attendre l'effet (long pour un succès attendu, court pour un refus).
   */
  aEcrit?: (o: Outils, c: Ctx, suffixe: string, patienceMs: number) => Promise<boolean>;
  /** Parmi les rôles autorisés, ceux pour qui la route écrit vraiment (défaut : tous). */
  ecritSeulementPour?: readonly Role[];
  /** Remise en état après l'appel (dossiers, adresses d'appel, pause…). Les règles marquées sont nettoyées par le banc. */
  menage?: (o: Outils, c: Ctx, suffixe: string) => Promise<void>;
  /** Texte qui ne doit JAMAIS apparaître dans la réponse faite à un rôle refusé ou à un autre bureau. */
  secret?: (c: Ctx, o: Outils, suffixe: string) => string;
  /** La route cible un objet du bureau A par son identifiant (isolation : B doit recevoir 403 / 404). */
  cibleA: boolean;
}

const LECTEURS: readonly Role[] = ['proprioA', 'adminA', 'editeurA', 'lecteurA'];
const EDITEURS: readonly Role[] = ['proprioA', 'adminA', 'editeurA'];
const ADMINS: readonly Role[] = ['proprioA', 'adminA'];
const TOUS_A: readonly Role[] = ['proprioA', 'adminA', 'editeurA', 'lecteurA', 'vendeurA', 'techA'];

async function ok<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>, quoi: string): Promise<T> {
  const { data, error } = await p;
  if (error || data === null) throw new Error(`${quoi} : ${error?.message ?? 'aucune ligne'}`);
  return data;
}

/** Règle du bureau A, créée par le service (préparation d'état). Le nom porte la marque. */
export async function regleA(o: Outils, suffixe: string, extra: Record<string, unknown> = {}): Promise<string> {
  const l = await ok<{ id: string }>(o.admin.from('automation_rules').insert({
    org_id: o.orgA, name: `${o.marque} ${suffixe}`, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0,
    actions: [{ type: 'log_activity', config: {} }], is_active: false, ...extra,
  }).select('id').single(), 'règle de test');
  return l.id;
}

async function lire(o: Outils, table: string, id: string, colonnes: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await o.admin.from(table).select(colonnes).eq('id', id).maybeSingle();
  if (error) throw new Error(`lecture ${table} : ${error.message}`);
  return (data as Record<string, unknown> | null) ?? null;
}

async function dossierA(o: Outils, suffixe: string): Promise<string> {
  const l = await ok<{ id: string }>(o.admin.from('automation_folders').insert({ org_id: o.orgA, name: `${o.marque} ${suffixe}`.slice(0, 60) }).select('id').single(), 'dossier de test');
  return l.id;
}
async function webhookA(o: Outils, suffixe: string): Promise<{ id: string; api_key: string }> {
  return ok<{ id: string; api_key: string }>(o.admin.from('automation_webhooks').insert({ org_id: o.orgA, name: `${o.marque} ${suffixe}`.slice(0, 80), created_by: o.idProprioA }).select('id, api_key').single(), 'adresse d’appel de test');
}
const oterDossiers = async (o: Outils) => { await o.admin.from('automation_folders').delete().in('org_id', [o.orgA, o.orgB]).ilike('name', `%${o.marque}%`); };
const oterWebhooks = async (o: Outils) => {
  const { data } = await o.admin.from('automation_webhooks').select('id').in('org_id', [o.orgA, o.orgB]).ilike('name', `%${o.marque}%`);
  const ids = (data ?? []).map((l) => l.id as string);
  if (!ids.length) return;
  await o.admin.from('automation_webhook_receipts').delete().in('webhook_id', ids);
  await o.admin.from('automation_webhooks').delete().in('id', ids);
};

/**
 * Trace d'un événement : chaque émission écrit une ligne dans `activity_log` (server/lib/eventBus.ts).
 * On compte les lignes du bureau A pour ce type avant l'appel ; une ligne de plus = l'événement est parti,
 * et les automatisations publiées du bureau ont tourné dessus.
 */
async function compterActivite(o: Outils, type: string): Promise<number> {
  const { count, error } = await o.admin.from('activity_log').select('id', { count: 'exact', head: true }).eq('org_id', o.orgA).eq('event_type', type);
  if (error) throw new Error(`activity_log : ${error.message}`);
  return count ?? 0;
}
const avantEvenement = (type: string) => async (o: Outils): Promise<Ctx> => ({ avant: String(await compterActivite(o, type)) });
const evenementEmis = (type: string) => async (o: Outils, c: Ctx, _s: string, patienceMs: number): Promise<boolean> => {
  const fin = Date.now() + patienceMs;
  for (;;) {
    if ((await compterActivite(o, type)) > Number(c.avant)) return true;
    if (Date.now() > fin) return false;
    await new Promise((r) => setTimeout(r, 400));
  }
};

/**
 * Déplace pour de bon la visite du décor (quart d'heure suivant ; retour à J+20 quand elle a trop dérivé) :
 * c'est ce qu'un écran fait avant d'annoncer « visite déplacée ». Écrit par le service, dans le bureau A seulement.
 */
export async function deplacerVisite(o: Outils): Promise<string> {
  const { data: v, error } = await o.admin.from('schedule_events').select('start_at, end_at').eq('id', o.decor.visite).eq('org_id', o.orgA).maybeSingle();
  if (error || !v) throw new Error(`visite du décor : ${error?.message ?? 'introuvable'}`);
  const duree = Math.max(900_000, Date.parse(String(v.end_at)) - Date.parse(String(v.start_at)));
  let debut = Date.parse(String(v.start_at)) + 900_000;
  if (!Number.isFinite(debut) || debut < Date.now() + 10 * 86400_000 || debut > Date.now() + 40 * 86400_000) {
    const base = new Date(Date.now() + 20 * 86400_000); base.setUTCHours(15, 0, 0, 0);
    debut = base.getTime();
  }
  const d = new Date(debut).toISOString();
  const f = new Date(debut + duree).toISOString();
  const { error: e2 } = await o.admin.from('schedule_events').update({ start_at: d, end_at: f, start_time: d, end_time: f }).eq('id', o.decor.visite).eq('org_id', o.orgA);
  if (e2) throw new Error(`déplacement de la visite du décor : ${e2.message}`);
  return d;
}

const REGLE_SIMPLE = (nom: string) => ({ name: nom, trigger_event: 'lead.created', delay_seconds: 0, actions: [{ type: 'log_activity', config: {} }] });

export const ROUTES: readonly RouteApi[] = [
  // ── §3.2 automation-rules.ts ──────────────────────────────────────────
  {
    id: 'API-01', methode: 'GET', gabarit: '/api/automations/rules', cle: 'automations.read', famille: 'lecture', autorises: LECTEURS, succes: [200], cibleA: false,
    preparer: async (o, s) => ({ regle: await regleA(o, s) }), chemin: () => '/api/automations/rules', secret: (c) => c.regle,
  },
  {
    id: 'API-02', methode: 'GET', gabarit: '/api/automations/editeur?rule_id=', cle: 'automations.read', famille: 'lecture', autorises: LECTEURS, succes: [200], cibleA: false, // un autre bureau reçoit 200 avec `rule: null` : seule l'absence de donnée de A compte
    preparer: async (o, s) => ({ regle: await regleA(o, s) }), chemin: (c) => `/api/automations/editeur?rule_id=${c.regle}`, secret: (_c, o, s) => `${o.marque} ${s}`,
  },
  {
    id: 'API-03', methode: 'POST', gabarit: '/api/automations/rules', cle: 'automations.update', famille: 'ecriture', autorises: EDITEURS, succes: [201], cibleA: false,
    chemin: () => '/api/automations/rules', corps: (_c, o, s) => REGLE_SIMPLE(`${o.marque} créée ${s}`),
    aEcrit: async (o, _c, s) => {
      const { count } = await o.admin.from('automation_rules').select('id', { count: 'exact', head: true }).eq('org_id', o.orgA).eq('name', `${o.marque} créée ${s}`);
      return (count ?? 0) > 0;
    },
  },
  {
    // Lumi n'est pas branché sur cette instance : un rôle autorisé reçoit 422 (« sans Lumi ») ou 5xx ; seul le REFUS des autres est prouvé ici.
    id: 'API-04', methode: 'POST', gabarit: '/api/automations/rules/generer', cle: 'automations.update', famille: 'ecriture', autorises: EDITEURS, succes: [200, 422, 500, 502, 503], cibleA: false,
    chemin: () => '/api/automations/rules/generer', corps: () => ({ demande: 'Envoie un texto de bienvenue à chaque nouveau prospect.', langue: 'fr' }),
  },
  {
    id: 'API-05', methode: 'PATCH', gabarit: '/api/automations/rules/:id', cle: 'automations.update', famille: 'ecriture', autorises: EDITEURS, succes: [200], cibleA: true,
    preparer: async (o, s) => ({ regle: await regleA(o, s) }), chemin: (c) => `/api/automations/rules/${c.regle}`, corps: () => ({ description: 'modifiée par la route' }),
    aEcrit: async (o, c) => (await lire(o, 'automation_rules', c.regle, 'description'))?.description === 'modifiée par la route',
  },
  {
    id: 'API-06', methode: 'GET', gabarit: '/api/automations/templates', cle: 'automations.read', famille: 'lecture', autorises: LECTEURS, succes: [200], cibleA: false,
    chemin: () => '/api/automations/templates',
  },
  {
    id: 'API-07', methode: 'POST', gabarit: '/api/automations/templates/utiliser', cle: 'automations.update', famille: 'ecriture', autorises: EDITEURS, succes: [201], cibleA: false,
    preparer: async (o) => {
      const { count } = await o.admin.from('automation_rules').select('id', { count: 'exact', head: true }).eq('org_id', o.orgA);
      return { avant: String(count ?? 0), depuis: new Date().toISOString() };
    },
    chemin: () => '/api/automations/templates/utiliser', corps: (_c, o) => ({ templateId: o.decor.modele }),
    aEcrit: async (o, c) => {
      const { count } = await o.admin.from('automation_rules').select('id', { count: 'exact', head: true }).eq('org_id', o.orgA);
      return (count ?? 0) > Number(c.avant);
    },
    // La règle née du modèle ne porte pas la marque : on retire ce qui est né pendant l'appel.
    menage: async (o, c) => { await o.admin.from('automation_rules').delete().in('org_id', [o.orgA, o.orgB]).gte('created_at', c.depuis).eq('is_preset', false).not('name', 'ilike', '%[E2E %'); },
  },
  {
    id: 'API-08', methode: 'POST', gabarit: '/api/automations/rules/:id/duplicate', cle: 'automations.update', famille: 'ecriture', autorises: EDITEURS, succes: [201], cibleA: true,
    preparer: async (o, s) => ({ regle: await regleA(o, s) }), chemin: (c) => `/api/automations/rules/${c.regle}/duplicate`,
    aEcrit: async (o, _c, s) => {
      const { count } = await o.admin.from('automation_rules').select('id', { count: 'exact', head: true }).in('org_id', [o.orgA, o.orgB]).ilike('name', `%${o.marque} ${s}%`);
      return (count ?? 0) > 1;
    },
  },
  {
    id: 'API-09', methode: 'DELETE', gabarit: '/api/automations/rules/:id', cle: 'automations.update', famille: 'ecriture', autorises: EDITEURS, succes: [200], cibleA: true,
    preparer: async (o, s) => ({ regle: await regleA(o, s) }), chemin: (c) => `/api/automations/rules/${c.regle}`,
    aEcrit: async (o, c) => (await lire(o, 'automation_rules', c.regle, 'deleted_at'))?.deleted_at != null,
  },
  {
    id: 'API-10', methode: 'POST', gabarit: '/api/automations/rules/:id/restaurer', cle: 'automations.update', famille: 'ecriture', autorises: EDITEURS, succes: [200], cibleA: true,
    preparer: async (o, s) => ({ regle: await regleA(o, s, { deleted_at: new Date().toISOString() }) }), chemin: (c) => `/api/automations/rules/${c.regle}/restaurer`,
    aEcrit: async (o, c) => (await lire(o, 'automation_rules', c.regle, 'deleted_at'))?.deleted_at == null,
  },
  {
    id: 'API-11', methode: 'DELETE', gabarit: '/api/automations/rules/:id/definitivement', cle: 'automations.update', famille: 'ecriture', autorises: EDITEURS, succes: [200], cibleA: true,
    preparer: async (o, s) => ({ regle: await regleA(o, s, { deleted_at: new Date().toISOString() }) }), chemin: (c) => `/api/automations/rules/${c.regle}/definitivement`,
    aEcrit: async (o, c) => { const l = await lire(o, 'automation_rules', c.regle, 'purged_at'); return l === null || l.purged_at != null; },
  },
  {
    id: 'API-12', methode: 'GET', gabarit: '/api/automations/folders', cle: 'automations.read', famille: 'lecture', autorises: LECTEURS, succes: [200], cibleA: false,
    preparer: async (o, s) => ({ dossier: await dossierA(o, s) }), chemin: () => '/api/automations/folders', secret: (c) => c.dossier, menage: oterDossiers,
  },
  {
    id: 'API-13', methode: 'POST', gabarit: '/api/automations/folders', cle: 'automations.update', famille: 'ecriture', autorises: EDITEURS, succes: [201], cibleA: false,
    chemin: () => '/api/automations/folders', corps: (_c, o, s) => ({ name: `${o.marque} créé ${s}`.slice(0, 60) }),
    aEcrit: async (o, _c, s) => {
      const { count } = await o.admin.from('automation_folders').select('id', { count: 'exact', head: true }).eq('org_id', o.orgA).eq('name', `${o.marque} créé ${s}`.slice(0, 60));
      return (count ?? 0) > 0;
    },
    menage: oterDossiers,
  },
  {
    id: 'API-14', methode: 'PATCH', gabarit: '/api/automations/folders/:id', cle: 'automations.update', famille: 'ecriture', autorises: EDITEURS, succes: [200], cibleA: true,
    preparer: async (o, s) => ({ dossier: await dossierA(o, s) }), chemin: (c) => `/api/automations/folders/${c.dossier}`, corps: (_c, o, s) => ({ name: `${o.marque} renommé ${s}`.slice(0, 60) }),
    aEcrit: async (o, c, s) => (await lire(o, 'automation_folders', c.dossier, 'name'))?.name === `${o.marque} renommé ${s}`.slice(0, 60),
    menage: oterDossiers,
  },
  {
    id: 'API-15', methode: 'DELETE', gabarit: '/api/automations/folders/:id', cle: 'automations.update', famille: 'ecriture', autorises: EDITEURS, succes: [204, 200], cibleA: true,
    preparer: async (o, s) => ({ dossier: await dossierA(o, s) }), chemin: (c) => `/api/automations/folders/${c.dossier}`,
    aEcrit: async (o, c) => (await lire(o, 'automation_folders', c.dossier, 'id')) === null,
    menage: oterDossiers,
  },
  {
    id: 'API-16', methode: 'GET', gabarit: '/api/automations/bureaux-cibles', cle: 'automations.update', famille: 'lecture', autorises: EDITEURS, succes: [200], cibleA: false,
    chemin: () => '/api/automations/bureaux-cibles',
  },
  {
    // La cible est le bureau B (AUTRE entreprise) : même un rôle autorisé de A ne doit RIEN y écrire.
    id: 'API-17', methode: 'POST', gabarit: '/api/automations/rules/:id/copier-bureaux', cle: 'automations.update (+ droit dans chaque bureau cible)', famille: 'ecriture', autorises: EDITEURS, succes: [200], cibleA: true,
    preparer: async (o, s) => ({ regle: await regleA(o, s) }), chemin: (c) => `/api/automations/rules/${c.regle}/copier-bureaux`, corps: (_c, o) => ({ org_ids: [o.orgB], lier: false }),
  },
  {
    id: 'API-18', methode: 'GET', gabarit: '/api/automations/pause', cle: 'automations.read', famille: 'lecture', autorises: LECTEURS, succes: [200], cibleA: false,
    chemin: () => '/api/automations/pause',
  },
  {
    id: 'API-19', methode: 'POST', gabarit: '/api/automations/pause', cle: 'automations.update + rôle propriétaire/admin (base)', famille: 'ecriture', autorises: ADMINS, succes: [200], cibleA: false,
    preparer: async (o) => { await o.admin.from('company_settings').update({ automations_paused: false, automations_paused_at: null, automations_paused_by: null }).in('org_id', [o.orgA, o.orgB]); return {}; },
    chemin: () => '/api/automations/pause', corps: () => ({ paused: true }),
    aEcrit: async (o) => {
      const { data } = await o.admin.from('company_settings').select('automations_paused').eq('org_id', o.orgA).maybeSingle();
      return data?.automations_paused === true;
    },
    menage: async (o) => { await o.admin.from('company_settings').update({ automations_paused: false, automations_paused_at: null, automations_paused_by: null }).in('org_id', [o.orgA, o.orgB]); },
  },
  {
    id: 'API-20', methode: 'GET', gabarit: '/api/automations/webhooks', cle: 'automations.read', famille: 'lecture', autorises: LECTEURS, succes: [200], cibleA: false,
    preparer: async (o, s) => { const w = await webhookA(o, s); return { webhook: w.id, cle: w.api_key }; }, chemin: () => '/api/automations/webhooks', secret: (c) => c.webhook, menage: oterWebhooks,
  },
  {
    id: 'API-21', methode: 'POST', gabarit: '/api/automations/webhooks', cle: 'automations.update', famille: 'ecriture', autorises: EDITEURS, succes: [201], cibleA: false,
    chemin: () => '/api/automations/webhooks', corps: (_c, o, s) => ({ name: `${o.marque} créée ${s}`.slice(0, 80) }),
    aEcrit: async (o, _c, s) => {
      const { count } = await o.admin.from('automation_webhooks').select('id', { count: 'exact', head: true }).eq('org_id', o.orgA).eq('name', `${o.marque} créée ${s}`.slice(0, 80));
      return (count ?? 0) > 0;
    },
    menage: oterWebhooks,
  },
  {
    id: 'API-22', methode: 'POST', gabarit: '/api/automations/webhooks/:id/regenerer', cle: 'automations.update', famille: 'ecriture', autorises: EDITEURS, succes: [200], cibleA: true,
    preparer: async (o, s) => { const w = await webhookA(o, s); return { webhook: w.id, cle: w.api_key }; }, chemin: (c) => `/api/automations/webhooks/${c.webhook}/regenerer`,
    aEcrit: async (o, c) => (await lire(o, 'automation_webhooks', c.webhook, 'api_key'))?.api_key !== c.cle,
    menage: oterWebhooks,
  },
  {
    id: 'API-23', methode: 'PATCH', gabarit: '/api/automations/webhooks/:id', cle: 'automations.update', famille: 'ecriture', autorises: EDITEURS, succes: [200], cibleA: true,
    preparer: async (o, s) => { const w = await webhookA(o, s); return { webhook: w.id, cle: w.api_key }; }, chemin: (c) => `/api/automations/webhooks/${c.webhook}`, corps: () => ({ enabled: false }),
    aEcrit: async (o, c) => (await lire(o, 'automation_webhooks', c.webhook, 'enabled'))?.enabled === false,
    menage: oterWebhooks,
  },
  {
    id: 'API-24', methode: 'DELETE', gabarit: '/api/automations/webhooks/:id', cle: 'automations.update', famille: 'ecriture', autorises: EDITEURS, succes: [200], cibleA: true,
    preparer: async (o, s) => { const w = await webhookA(o, s); return { webhook: w.id, cle: w.api_key }; }, chemin: (c) => `/api/automations/webhooks/${c.webhook}`,
    aEcrit: async (o, c) => (await lire(o, 'automation_webhooks', c.webhook, 'deleted_at'))?.deleted_at != null,
    menage: oterWebhooks,
  },
  // ── §3.3 automation-publication.ts ────────────────────────────────────
  {
    // La route de lot répond TOUJOURS 200 avec un résultat par règle : seul l'effet en base tranche.
    id: 'API-25', methode: 'POST', gabarit: '/api/automations/rules/publication', cle: 'automations.update', famille: 'ecriture', autorises: EDITEURS, succes: [200], cibleA: true,
    preparer: async (o, s) => ({ regle: await regleA(o, s, { actions: [{ type: 'create_task', config: { title: 'Rappeler le prospect' } }] }) }),
    chemin: () => '/api/automations/rules/publication', corps: (c) => ({ actif: true, ids: [c.regle] }),
    aEcrit: async (o, c) => (await lire(o, 'automation_rules', c.regle, 'is_active'))?.is_active === true,
  },
  {
    id: 'API-26', methode: 'POST', gabarit: '/api/automations/rules/:id/publication', cle: 'automations.update', famille: 'ecriture', autorises: EDITEURS, succes: [200], cibleA: true,
    preparer: async (o, s) => ({ regle: await regleA(o, s, { actions: [{ type: 'create_task', config: { title: 'Rappeler le prospect' } }] }) }),
    chemin: (c) => `/api/automations/rules/${c.regle}/publication`, corps: () => ({ actif: true }),
    aEcrit: async (o, c) => (await lire(o, 'automation_rules', c.regle, 'is_active'))?.is_active === true,
  },
  // ── §3.4 automation-stats.ts ──────────────────────────────────────────
  {
    id: 'API-27', methode: 'GET', gabarit: '/api/automations/rules/stats', cle: 'automations.read', famille: 'lecture', autorises: LECTEURS, succes: [200], cibleA: false,
    chemin: () => '/api/automations/rules/stats',
  },
  // ── §3.5 automation-test.ts ───────────────────────────────────────────
  {
    id: 'API-28', methode: 'GET', gabarit: '/api/automations/test', cle: 'automations.read + rôle propriétaire/admin (handler)', famille: 'lecture', autorises: ADMINS, succes: [200], cibleA: false,
    chemin: () => '/api/automations/test',
  },
  {
    id: 'API-29', methode: 'POST', gabarit: '/api/automations/rules/:id/apercu', cle: 'automations.read', famille: 'lecture', autorises: LECTEURS, succes: [200], cibleA: true,
    preparer: async (o, s) => ({ regle: await regleA(o, s, { actions: [{ type: 'send_sms', config: { body: `Bonjour ${s}` } }] }) }), chemin: (c) => `/api/automations/rules/${c.regle}/apercu`, secret: (_c, _o, s) => `Bonjour ${s}`,
  },
  // ── §3.6 automation-events.ts ─────────────────────────────────────────
  {
    id: 'API-30', methode: 'POST', gabarit: '/api/automations/events/appointment-created', cle: 'automations.update', famille: 'evenement', autorises: EDITEURS, succes: [200], cibleA: false,
    chemin: () => '/api/automations/events/appointment-created', corps: (_c, o) => ({ eventId: o.decor.visite }),
  },
  {
    id: 'API-31', methode: 'POST', gabarit: '/api/automations/events/appointment-cancelled', cle: 'automations.update', famille: 'evenement', autorises: EDITEURS, succes: [200], cibleA: false,
    chemin: () => '/api/automations/events/appointment-cancelled', corps: (_c, o) => ({ eventId: o.decor.visite }),
  },
  {
    id: 'API-32', methode: 'POST', gabarit: '/api/automations/events/appointment-rescheduled', cle: 'jobs.update OU calendar.update', famille: 'evenement', autorises: TOUS_A, succes: [200], cibleA: true,
    // Depuis #870 la route ne ré-émet RIEN pour une visite restée à la même heure (`{ ok, cancelled: 0, inchange: true }`,
    // server/routes/automation-events.ts § 0) : pour prouver qu'un rôle autorisé déclenche bien la replanification,
    // la visite du décor est VRAIMENT déplacée (par le service) avant chaque appel.
    preparer: async (o) => { await deplacerVisite(o); return { avant: String(await compterActivite(o, 'appointment_created')) }; },
    chemin: () => '/api/automations/events/appointment-rescheduled', corps: (_c, o) => ({ eventId: o.decor.visite }),
    aEcrit: evenementEmis('appointment_created'),
  },
  {
    // N'émet (job.ready_for_invoicing) que si l'acteur est technicien : pour les autres, 200 sans effet.
    id: 'API-33', methode: 'POST', gabarit: '/api/automations/events/job-completed', cle: 'jobs.complete', famille: 'evenement', autorises: ['proprioA', 'adminA', 'techA'], succes: [200], cibleA: true,
    preparer: avantEvenement('job_ready_for_invoicing'),
    chemin: () => '/api/automations/events/job-completed', corps: (_c, o) => ({ jobId: o.decor.job }),
    aEcrit: evenementEmis('job_ready_for_invoicing'), ecritSeulementPour: ['techA'],
    // Le technicien fait naître une notification « prêt à facturer » chez les propriétaires / admins : on la retire.
    menage: async (o) => { await o.admin.from('notifications').delete().eq('org_id', o.orgA).eq('type', 'job_ready_for_invoicing').eq('entity_id', o.decor.job); },
  },
  {
    id: 'API-34', methode: 'POST', gabarit: '/api/automations/events/deal-stage-changed', cle: 'automations.update', famille: 'evenement', autorises: EDITEURS, succes: [200], cibleA: true,
    preparer: avantEvenement('deal_stage_changed'),
    chemin: () => '/api/automations/events/deal-stage-changed', corps: (_c, o) => ({ dealId: o.decor.client, leadId: o.decor.client, oldStage: 'a', newStage: 'b' }),
    aEcrit: evenementEmis('deal_stage_changed'),
  },
  {
    id: 'API-35', methode: 'POST', gabarit: '/api/automations/events/quote-sent', cle: 'automations.update', famille: 'evenement', autorises: EDITEURS, succes: [200], cibleA: true,
    preparer: avantEvenement('quote_sent'),
    chemin: () => '/api/automations/events/quote-sent', corps: (_c, o) => ({ quoteId: o.decor.devis }),
    aEcrit: evenementEmis('quote_sent'),
  },
  {
    id: 'API-36', methode: 'POST', gabarit: '/api/automations/events/quote-approved', cle: 'automations.update', famille: 'evenement', autorises: EDITEURS, succes: [200], cibleA: false,
    chemin: () => '/api/automations/events/quote-approved', corps: (_c, o) => ({ quoteId: o.decor.devis }),
  },
  {
    id: 'API-37', methode: 'POST', gabarit: '/api/automations/events/invoice-paid', cle: 'financial.view_invoices', famille: 'evenement', autorises: ADMINS, succes: [200], cibleA: false,
    chemin: () => '/api/automations/events/invoice-paid', corps: () => ({}),
  },
  {
    id: 'API-38', methode: 'POST', gabarit: '/api/automations/events/lead-created', cle: 'automations.update', famille: 'evenement', autorises: EDITEURS, succes: [200], cibleA: true,
    preparer: avantEvenement('lead_created'),
    chemin: () => '/api/automations/events/lead-created', corps: (_c, o) => ({ leadId: o.decor.client }),
    aEcrit: evenementEmis('lead_created'),
  },
  {
    id: 'API-39', methode: 'POST', gabarit: '/api/automations/events/lead-status-changed', cle: 'automations.update', famille: 'evenement', autorises: EDITEURS, succes: [200], cibleA: true,
    preparer: avantEvenement('status_changed'),
    chemin: () => '/api/automations/events/lead-status-changed', corps: (_c, o) => ({ leadId: o.decor.client, oldStatus: 'new', newStatus: 'contacted' }),
    aEcrit: evenementEmis('status_changed'),
  },
  {
    id: 'API-40', methode: 'POST', gabarit: '/api/automations/events/client-tagged', cle: 'clients.update OU leads.update', famille: 'evenement', autorises: ['proprioA', 'adminA', 'editeurA', 'lecteurA', 'vendeurA'], succes: [200], cibleA: true,
    preparer: avantEvenement('client_tagged'),
    chemin: () => '/api/automations/events/client-tagged', corps: (_c, o) => ({ clientId: o.decor.client, tag: o.decor.etiquette }),
    aEcrit: evenementEmis('client_tagged'),
  },
  {
    id: 'API-41', methode: 'POST', gabarit: '/api/automations/events/client-untagged', cle: 'clients.update OU leads.update', famille: 'evenement', autorises: ['proprioA', 'adminA', 'editeurA', 'lecteurA', 'vendeurA'], succes: [200], cibleA: true,
    preparer: avantEvenement('client_untagged'),
    chemin: () => '/api/automations/events/client-untagged', corps: (_c, o) => ({ clientId: o.decor.client, tag: 'etiquette-jamais-posee' }),
    aEcrit: evenementEmis('client_untagged'),
  },
  {
    id: 'API-42', methode: 'POST', gabarit: '/api/automations/events/task-completed', cle: 'jobs.update OU clients.update OU leads.update', famille: 'evenement', autorises: TOUS_A, succes: [200], cibleA: true,
    preparer: avantEvenement('task_completed'),
    chemin: () => '/api/automations/events/task-completed', corps: (_c, o) => ({ taskId: o.decor.tache }),
    aEcrit: evenementEmis('task_completed'),
  },
  // ── §3.8 autres routes ────────────────────────────────────────────────
  {
    // 404 « Capacité non activée » tant que le drapeau auto_client_inactif est coupé : accepté pour un rôle autorisé.
    id: 'API-44', methode: 'GET', gabarit: '/api/automations/clients-inactifs/apercu?mois=6', cle: 'automations.read (+ drapeau auto_client_inactif)', famille: 'lecture', autorises: LECTEURS, succes: [200, 404], cibleA: false,
    chemin: () => '/api/automations/clients-inactifs/apercu?mois=6',
  },
  {
    id: 'API-45', methode: 'GET', gabarit: '/api/orgs/offices/sante', cle: 'propriétaire seulement', famille: 'lecture', autorises: ['proprioA'], succes: [200], cibleA: false,
    chemin: () => '/api/orgs/offices/sante',
  },
];

/** Le décor : un client, un job, une visite, un devis, une tâche terminée, une étiquette — bureau A, coordonnées fictives. Idempotent. */
export async function assurerDecor(admin: SupabaseClient, orgA: string, idProprioA: string): Promise<Omit<Decor, 'modele'>> {
  const NOM = 'Décor-Rôles';
  const etiquette = 'e2e-roles';
  let { data: client } = await admin.from('clients').select('id').eq('org_id', orgA).eq('last_name', NOM).is('deleted_at', null).limit(1).maybeSingle();
  if (!client) {
    client = await ok<{ id: string }>(admin.from('clients').insert({
      org_id: orgA, created_by: idProprioA, first_name: 'Cliente', last_name: NOM, status: 'active',
      email: 'decor-roles@lume-qa.test', phone: '+15555550177',
    }).select('id').single(), 'client du décor');
  }
  const idClient = (client as { id: string }).id;

  let { data: job } = await admin.from('jobs').select('id').eq('org_id', orgA).eq('title', `Job ${NOM}`).is('deleted_at', null).limit(1).maybeSingle();
  if (!job) job = await ok<{ id: string }>(admin.from('jobs').insert({ org_id: orgA, title: `Job ${NOM}`, client_id: idClient, status: 'scheduled', created_by: idProprioA }).select('id').single(), 'job du décor');
  const idJob = (job as { id: string }).id;

  let { data: visite } = await admin.from('schedule_events').select('id').eq('org_id', orgA).eq('title', `Visite ${NOM}`).is('deleted_at', null).limit(1).maybeSingle();
  if (!visite) {
    const debut = new Date(Date.now() + 20 * 86400_000); debut.setUTCHours(15, 0, 0, 0);
    const fin = new Date(debut.getTime() + 3600_000);
    visite = await ok<{ id: string }>(admin.from('schedule_events').insert({
      org_id: orgA, job_id: idJob, title: `Visite ${NOM}`, start_at: debut.toISOString(), end_at: fin.toISOString(),
      start_time: debut.toISOString(), end_time: fin.toISOString(), status: 'scheduled', created_by: idProprioA, timezone: 'America/Toronto',
    }).select('id').single(), 'visite du décor');
  }

  let { data: devis } = await admin.from('quotes').select('id').eq('org_id', orgA).eq('title', `Devis ${NOM}`).is('deleted_at', null).limit(1).maybeSingle();
  if (!devis) {
    devis = await ok<{ id: string }>(admin.from('quotes').insert({
      org_id: orgA, client_id: idClient, status: 'draft', title: `Devis ${NOM}`, quote_number: `QA-ROLES-${Date.now().toString(36)}`, created_by: idProprioA,
    }).select('id').single(), 'devis du décor');
  }

  let { data: tache } = await admin.from('tasks').select('id').eq('org_id', orgA).eq('title', `Tâche ${NOM}`).is('deleted_at', null).limit(1).maybeSingle();
  if (!tache) {
    tache = await ok<{ id: string }>(admin.from('tasks').insert({
      org_id: orgA, title: `Tâche ${NOM}`, status: 'done', completed_at: new Date().toISOString(), created_by: idProprioA,
      linked_entity_type: 'client', linked_entity_id: idClient,
    }).select('id').single(), 'tâche du décor');
  }

  const { data: pose } = await admin.from('client_tags').select('id').eq('client_id', idClient).eq('tag', etiquette).maybeSingle();
  if (!pose) { const { error } = await admin.from('client_tags').insert({ client_id: idClient, tag: etiquette }); if (error) throw new Error(`étiquette du décor : ${error.message}`); }

  return { client: idClient, job: idJob, visite: (visite as { id: string }).id, devis: (devis as { id: string }).id, tache: (tache as { id: string }).id, etiquette };
}
