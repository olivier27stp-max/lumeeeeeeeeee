/**
 * Outils communs des tests d'intégration de la catégorie B (matrice
 * déclencheur × condition × action) — tests/automations-suite/matrice/B.md.
 *
 * Tout passe par le VRAI code : règles créées par la vraie route
 * (`POST /api/automations/rules`, Zod + cohérence + contrôle de publication,
 * comme l'éditeur), événements provoqués par les vraies routes Express montées
 * en mémoire (même chaîne que server/index.ts : json, urlencoded, RBAC), files
 * de la base traitées pour NOTRE bureau seulement.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll } from 'vitest';
import { demarrerMoteur, attendre } from '../harnais/moteur';
import { sessionDe, COMPTES } from '../harnais/bureau-test';

export type Bureau = Awaited<ReturnType<typeof demarrerMoteur>>;

/**
 * Un fuseau où il est, en ce moment, entre 10 h et 17 h : la fenêtre d'envoi
 * (8 h-20 h, heures calmes) ne doit pas faire dépendre les tests de l'heure à
 * laquelle la suite tourne. On change le FUSEAU de l'entreprise de test, pas
 * le moteur : tout le reste (report, calcul des jours) suit le vrai code.
 */
export function fuseauEnJournee(maintenant = new Date()): string {
  const candidats = [
    'America/Toronto', 'America/Vancouver', 'Pacific/Honolulu', 'Asia/Tokyo', 'Europe/Paris',
    'Asia/Kolkata', 'Pacific/Auckland', 'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Bangkok', 'Atlantic/Azores',
  ];
  for (const tz of candidats) {
    const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(maintenant)) % 24;
    if (h >= 10 && h <= 16) return tz;
  }
  return 'America/Toronto';
}

/**
 * Prépare le bureau A pour un fichier de la catégorie B :
 *  · fuseau « en journée » (voir plus haut) ;
 *  · préréglages DÉSACTIVÉS dans ce bureau : ils réagissent aux mêmes
 *    événements (lead.created en porte plusieurs) et modifieraient les
 *    entités éprouvées ; ils sont couverts par la catégorie K ;
 *  · automatisations non en pause.
 */
let bureauPrepare: Bureau | null = null;
let prereglagesEteints: string[] = [];

/**
 * Rend au bureau A ses préréglages. Enregistré ICI, à l'import du module :
 * chaque fichier de tests qui importe ces outils le reçoit d'office.
 * Si rien n'avait été retenu (un passage précédent tué avant de rendre), on
 * recopie l'état du bureau B, que les tests B ne touchent jamais.
 */
afterAll(async () => {
  const b = bureauPrepare;
  if (!b) return;
  if (prereglagesEteints.length) {
    await b.admin.from('automation_rules').update({ is_active: true }).in('id', prereglagesEteints);
    return;
  }
  const { data: reference } = await b.admin.from('automation_rules').select('preset_key')
    .eq('org_id', b.orgB).eq('is_preset', true).eq('is_active', true).is('deleted_at', null);
  const cles = (reference ?? []).map((r) => r.preset_key as string).filter(Boolean);
  if (cles.length) {
    await b.admin.from('automation_rules').update({ is_active: true })
      .eq('org_id', b.orgA).eq('is_preset', true).is('deleted_at', null).in('preset_key', cles);
  }
});

export async function preparerBureau(): Promise<Bureau & { fuseau: string }> {
  const b = await demarrerMoteur();
  const fuseau = fuseauEnJournee();
  await ok(b.admin.from('company_settings').update({ timezone: fuseau, automations_paused: false }).eq('org_id', b.orgA), 'fuseau');
  // On retient ce qu'on éteint, pour le RENDRE à la fin du fichier (voir le
  // afterAll plus bas) : sans ça, le fichier des préréglages (catégorie K)
  // trouvait tout éteint dès qu'il passait après un fichier B.
  const actifs = await ok<Array<{ id: string }>>(
    b.admin.from('automation_rules').select('id').eq('org_id', b.orgA).eq('is_preset', true).eq('is_active', true), 'préréglages actifs');
  bureauPrepare = b;
  prereglagesEteints = (actifs ?? []).map((r) => r.id);
  await ok(b.admin.from('automation_rules').update({ is_active: false }).eq('org_id', b.orgA).eq('is_preset', true), 'préréglages');
  // Règles laissées actives par un passage interrompu : elles réagiraient à tout.
  await ok(b.admin.from('automation_rules').update({ is_active: false }).eq('org_id', b.orgA).like('name', '[QA-AUTO%'), 'restes');
  const { viderCacheFuseau } = await import('../../../server/lib/automations-fuseau-org');
  const { viderCachePause } = await import('../../../server/lib/automations-pause-org');
  const { oublierDrapeaux } = await import('../../../server/lib/automations-drapeaux');
  viderCacheFuseau();
  viderCachePause();
  oublierDrapeaux();
  return { ...b, fuseau };
}

export async function ok<T = unknown>(p: PromiseLike<{ data?: unknown; error: { message: string } | null }>, quoi: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${quoi} : ${error.message}`);
  return data as T;
}

// ── API en mémoire ───────────────────────────────────────────────

export interface Api {
  url: string;
  fermer: () => Promise<void>;
  /** Appel authentifié (JWT réel du compte, bureau A en en-tête). */
  appeler: (methode: string, chemin: string, corps?: unknown, qui?: 'proprioA' | 'techA') => Promise<{ status: number; json: any }>;
  /** Appel ANONYME (page publique, webhook) : aucun jeton, en-têtes fournis. */
  publique: (methode: string, chemin: string, corps?: string, entetes?: Record<string, string>) => Promise<{ status: number; json: any }>;
}

async function lireReponse(r: Response): Promise<{ status: number; json: any }> {
  const texte = await r.text();
  let json: any = texte;
  try { json = JSON.parse(texte); } catch { /* corps non JSON (TwiML…) */ }
  return { status: r.status, json };
}

/**
 * `brut` : route POST à corps brut (webhook signé), `avant` : routeur qui lit
 * lui-même son corps brut (adresses /api/hooks/:cle) — tous deux montés AVANT
 * express.json(), comme dans server/index.ts.
 */
type Montage = { chemin?: string; routeur: express.Router | express.RequestHandler; brut?: string; avant?: boolean };

/**
 * Monte des routeurs réels dans une app Express en mémoire, dans l'ordre de
 * server/index.ts : les routes à corps brut (webhooks signés) AVANT
 * express.json(), puis json + urlencoded, puis le RBAC, puis les routeurs.
 */
export async function apiEnMemoire(b: Bureau, montages: Montage[]): Promise<Api> {
  const { rbacMiddleware } = await import('../../../server/lib/route-permissions');
  const app = express();
  for (const m of montages.filter((x) => x.brut)) {
    app.post(m.brut!, express.raw({ type: 'application/json', limit: '1mb' }), m.routeur as express.RequestHandler);
  }
  for (const m of montages.filter((x) => x.avant)) app.use(m.chemin ?? '/api', m.routeur);
  app.use(express.json({ limit: '512kb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(rbacMiddleware());
  for (const m of montages.filter((x) => !x.brut && !x.avant)) app.use(m.chemin ?? '/api', m.routeur);
  const srv: Server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const jetons: Partial<Record<'proprioA' | 'techA', string>> = {};
  const jeton = async (qui: 'proprioA' | 'techA') => (jetons[qui] ??= (await sessionDe(b.admin, COMPTES[qui].email)).jeton);
  return {
    url,
    fermer: () => new Promise((r) => srv.close(() => r())),
    appeler: async (methode, chemin, corps, qui = 'proprioA') => {
      const r = await fetch(`${url}${chemin}`, {
        method: methode,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await jeton(qui)}`, 'x-org-id': b.orgA },
        body: corps === undefined ? undefined : JSON.stringify(corps),
      });
      return lireReponse(r);
    },
    publique: async (methode, chemin, corps, entetes = {}) =>
      lireReponse(await fetch(`${url}${chemin}`, { method: methode, headers: entetes, body: corps })),
  };
}

// ── Règles ───────────────────────────────────────────────────────

export interface RegleDemandee {
  nom: string;
  declencheur: string;
  conditions?: Record<string, unknown>;
  actions?: Array<{ type: string; config: Record<string, unknown> }>;
  steps?: unknown[] | null;
  settings?: Record<string, unknown> | null;
  delay_seconds?: number;
}

/**
 * Crée ET publie une règle par la vraie route de l'éditeur. Échoue si la
 * route refuse (Zod, cohérence, publication) : une règle que l'éditeur ne
 * pourrait pas enregistrer ne prouve rien.
 */
export async function creerRegle(api: Api, r: RegleDemandee): Promise<string> {
  const res = await api.appeler('POST', '/api/automations/rules', {
    name: r.nom,
    trigger_event: r.declencheur,
    conditions: r.conditions ?? {},
    delay_seconds: r.delay_seconds ?? 0,
    actions: r.actions ?? [{ type: 'create_task', config: { title: r.nom } }],
    ...(r.steps ? { steps: r.steps } : {}),
    ...(r.settings ? { settings: r.settings } : {}),
    is_active: true,
  });
  if (res.status !== 201) throw new Error(`règle « ${r.nom} » refusée (${res.status}) : ${JSON.stringify(res.json)}`);
  return String(res.json.id);
}

/** Supprime les règles de ce passage (et leurs tâches, par la cascade). */
export async function supprimerRegles(admin: SupabaseClient, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await admin.from('automation_rules').delete().in('id', ids);
}

// ── Mesures ──────────────────────────────────────────────────────

export async function tachesTitrees(admin: SupabaseClient, orgId: string, titre: string) {
  const { data, error } = await admin.from('tasks')
    .select('id, title, description, status, priority, linked_entity_type, linked_entity_id, created_by, assignee_user_id, due_date')
    .eq('org_id', orgId).eq('title', titre);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Attend la tâche témoin d'une règle (action create_task) et la renvoie. */
export async function attendreTache(admin: SupabaseClient, orgId: string, titre: string, delaiMs = 20_000) {
  return attendre(() => tachesTitrees(admin, orgId, titre), (t) => t.length > 0, delaiMs);
}

export async function journaux(admin: SupabaseClient, ruleId: string) {
  const { data, error } = await admin.from('automation_execution_logs')
    .select('id, trigger_event, entity_type, entity_id, action_type, result_success, result_data, result_error, scheduled_task_id, created_at')
    .eq('automation_rule_id', ruleId).order('created_at');
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Les lignes d'ACTION d'un journal. Depuis L-004, une règle écartée par ses
 * conditions laisse une trace (`action_type = 'conditions'`, saut) : ce n'est
 * pas une action. « La règle fausse n'a rien fait » = aucune ligne d'action.
 */
export function lignesDAction<T extends { action_type: string }>(lignes: T[]): T[] {
  return lignes.filter((l) => l.action_type !== 'conditions');
}

export async function tachesPlanifiees(admin: SupabaseClient, ruleId: string) {
  const { data, error } = await admin.from('automation_scheduled_tasks')
    .select('id, status, step_id, execute_at, attempts, last_error, action_config, sequence_context, entity_type, entity_id, created_at, completed_at')
    .eq('automation_rule_id', ruleId).order('created_at');
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Traite la file « événements écrits par la base » de NOTRE bureau. */
export async function traiterBase(b: Bureau): Promise<number> {
  const { traiterEvenementsBase } = await import('../../../server/lib/evenementsBase');
  return traiterEvenementsBase(b.admin, { orgId: b.orgA });
}

/** Traite la file `pipeline_events` de NOTRE bureau. */
export async function traiterPipeline(b: Bureau): Promise<number> {
  const { traiterEvenementsPipeline, DELAI_GRACE_MS } = await import('../../../server/lib/pipelineEvenements');
  // La file ne lit un événement qu'après son délai de grâce (chaîne
  // anti-boucle écrite) : on laisse ce délai passer, comme le ferait le
  // passage toutes les 5 min. +1,5 s pour l'écart d'horloge poste/base.
  await new Promise((r) => setTimeout(r, DELAI_GRACE_MS + 1500));
  return traiterEvenementsPipeline(b.admin, { orgId: b.orgA });
}

// ── Données ─────────────────────────────────────────────────────

/** Numéro fictif de la plage 555-0110 à 555-0199 (jamais routable). */
export function telephoneFictif(): string {
  return `+155555501${String(10 + Math.floor(Math.random() * 90))}`;
}

export async function creerClient(b: Bureau, m: string, extra: Record<string, unknown> = {}) {
  return ok<{ id: string; first_name: string; last_name: string; email: string; phone: string }>(
    b.admin.from('clients').insert({
      org_id: b.orgA, created_by: b.users.proprioA, first_name: 'Cliente', last_name: m, status: 'active',
      email: `client-${Math.random().toString(36).slice(2, 8)}@lume-qa.test`, phone: '+15555550142',
      sms_consent_at: new Date().toISOString(), email_consent_at: new Date().toISOString(),
      ...extra,
    }).select('id, first_name, last_name, email, phone').single(),
    'client',
  );
}

/** Pipeline par défaut du bureau A et ses étapes ouvertes, dans l'ordre. */
export async function pipelineParDefaut(b: Bureau) {
  const p = await ok<{ id: string }>(b.admin.from('pipelines_ventes').select('id').eq('org_id', b.orgA).eq('is_default', true).single(), 'pipeline');
  const etapes = await ok<Array<{ id: string; kind: string; position: number; role_systeme: string | null }>>(
    b.admin.from('pipeline_stages').select('id, kind, position, role_systeme').eq('pipeline_id', p.id).is('archived_at', null).order('position'), 'étapes');
  return { id: p.id, ouvertes: etapes.filter((e) => e.kind === 'open'), toutes: etapes };
}

export async function creerJob(b: Bureau, m: string, clientId: string | null, extra: Record<string, unknown> = {}) {
  return ok<{ id: string; title: string; job_number: string | null }>(b.admin.from('jobs').insert({
    org_id: b.orgA, title: `Job ${m}`, client_id: clientId, status: 'scheduled', created_by: b.users.proprioA, ...extra,
  }).select('id, title, job_number').single(), 'job');
}

export async function creerDevis(b: Bureau, m: string, clientId: string, extra: Record<string, unknown> = {}) {
  return ok<{ id: string; view_token: string; quote_number: string; status: string }>(b.admin.from('quotes').insert({
    org_id: b.orgA, client_id: clientId, status: 'awaiting_response', title: `Devis ${m}`,
    quote_number: `QA-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, created_by: b.users.proprioA, ...extra,
  }).select('id, view_token, quote_number, status').single(), 'devis');
}

/** Facture en brouillon avec une ligne (totaux recalculés par la base). */
export async function creerFacture(b: Bureau, m: string, clientId: string, montantCents = 10_000, extra: Record<string, unknown> = {}) {
  const f = await ok<{ id: string }>(b.admin.from('invoices').insert({
    org_id: b.orgA, client_id: clientId, status: 'draft', created_by: b.users.proprioA, subject: `Facture ${m}`, ...extra,
  }).select('id').single(), 'facture');
  await ok(b.admin.from('invoice_items').insert({ org_id: b.orgA, invoice_id: f.id, description: `Service ${m}`, qty: 1, unit_price_cents: montantCents }), 'ligne de facture');
  await ok(b.admin.rpc('recalculate_invoice_totals', { p_invoice_id: f.id }), 'recalcul');
  return ok<{ id: string; invoice_number: string; view_token: string; total_cents: number; balance_cents: number; status: string }>(
    b.admin.from('invoices').select('id, invoice_number, view_token, total_cents, balance_cents, status').eq('id', f.id).single(), 'relecture facture');
}

export async function creerDeal(b: Bureau, clientId: string, stageId: string, pipelineId: string, extra: Record<string, unknown> = {}) {
  return ok<{ id: string; stage_entered_at: string }>(b.admin.from('deals').insert({
    org_id: b.orgA, client_id: clientId, pipeline_id: pipelineId, stage_id: stageId, created_by: b.users.proprioA, ...extra,
  }).select('id, stage_entered_at').single(), 'deal');
}

/** Active (ou coupe) un drapeau `org_features` du bureau A. */
export async function drapeau(b: Bureau, feature: string, enabled: boolean) {
  await ok(b.admin.from('org_features').upsert({ org_id: b.orgA, feature, enabled }, { onConflict: 'org_id,feature' }), `drapeau ${feature}`);
  const { oublierDrapeaux } = await import('../../../server/lib/automations-drapeaux');
  oublierDrapeaux(b.orgA);
}

/** Un champ personnalisé créé comme dans Réglages → Champs personnalisés (vraie route). */
export async function creerChamp(api: Api, corps: Record<string, unknown>): Promise<{ id: string; key: string; options?: Array<{ id: string; label: string }> }> {
  const r = await api.appeler('POST', '/api/custom-fields', corps);
  if (r.status !== 201) throw new Error(`champ refusé (${r.status}) : ${JSON.stringify(r.json)}`);
  return r.json.field;
}

/** Écrit des valeurs de champs par la vraie route de la fiche. */
export async function ecrireChamps(api: Api, objet: string, id: string, values: Array<{ field_id: string; value: unknown }>) {
  const r = await api.appeler('PUT', `/api/custom-values/${objet}/${id}`, { values });
  if (r.status !== 200) throw new Error(`valeurs refusées (${r.status}) : ${JSON.stringify(r.json)}`);
  return r.json;
}

/** Une signature PNG 1×1 valide (octets magiques compris). */
export const SIGNATURE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Un navigateur de bureau ordinaire (les robots ne comptent pas comme une ouverture). */
export const NAVIGATEUR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

/**
 * Un texto ENTRANT signé comme Twilio le signe (POST /api/messages/inbound).
 * Exige TWILIO_AUTH_TOKEN et TWILIO_WEBHOOK_BASE_URL posés par le test AVANT
 * l'import du serveur, et le routeur des messages monté dans `api`.
 */
export async function smsEntrant(api: Api, de: string, vers: string, texte: string) {
  const corps = { From: de, To: vers, Body: texte, MessageSid: `SMqa${Date.now()}${Math.random().toString(36).slice(2, 8)}` };
  const twilio = (await import('twilio')).default;
  const base = String(process.env.TWILIO_WEBHOOK_BASE_URL).replace(/\/$/, '');
  const signature = twilio.getExpectedTwilioSignature(String(process.env.TWILIO_AUTH_TOKEN), `${base}/api/messages/inbound`, corps);
  return api.publique('POST', '/api/messages/inbound', new URLSearchParams(corps).toString(), {
    'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': signature,
  });
}

/** Le numéro doit désigner UNE seule fiche (et conversation) du bureau : on libère celles d'avant. */
export async function reserverTelephone(b: Bureau, telephone: string) {
  // Les textos des passages précédents comptent dans le plafond commercial de
  // 24 h du numéro (3 par défaut) : on les retire aussi.
  await b.admin.from('messages').delete().eq('org_id', b.orgA).eq('phone_number', telephone);
  await b.admin.from('clients').update({ phone: null }).eq('org_id', b.orgA).eq('phone', telephone);
  await b.admin.from('conversations').delete().eq('org_id', b.orgA).eq('phone_number', telephone);
}
