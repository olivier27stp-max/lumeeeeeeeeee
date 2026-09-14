/* ═══════════════════════════════════════════════════════════════
   Automation Engine — Event-driven rule executor.
   Listens to CRM events via the event bus, matches automation
   rules, schedules or executes actions.
   ═══════════════════════════════════════════════════════════════ */

import { SupabaseClient } from '@supabase/supabase-js';
import { eventBus, CRMEvent, CRMEventType } from './eventBus';
import {
  ActionContext,
  ActionType,
  executeAction,
  resolveEntityVariables,
} from './actions';
import { logger } from './logger';
import { traduireErreurAutomatisation } from './automationErreurs';

interface AutomationRule {
  id: string;
  org_id: string;
  name: string;
  trigger_event: string;
  conditions: Record<string, any>;
  delay_seconds: number;
  actions: Array<{ type: ActionType; config: Record<string, any> }>;
  is_active: boolean;
  created_at?: string;
}

interface EngineConfig {
  supabase: SupabaseClient;
  twilio: { client: any; phoneNumber: string } | null;
  baseUrl: string;
}

let engineConfig: EngineConfig | null = null;

// ── Condition evaluator ─────────────────────────────────────

/**
 * Compare deux valeurs sans se laisser piéger par leur type.
 *
 * Les conditions sont stockées en jsonb et proviennent souvent d'un champ de
 * saisie : elles arrivent donc en CHAÎNE. Les métadonnées d'événement, elles,
 * portent le type réel — `days_overdue` et `amount_cents` sont des NOMBRES.
 * Avec une égalité stricte, `3 !== "3"` : la règle ne se déclenchait jamais,
 * et l'utilisateur n'avait aucun moyen de comprendre pourquoi (le moteur
 * passait au suivant en silence).
 *
 * On normalise donc en chaîne pour comparer, après avoir écarté `null` et
 * `undefined` — sinon `null` et la chaîne « null » deviendraient égaux.
 */
function memeValeur(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === 'object' || typeof b === 'object') return false;
  return String(a) === String(b);
}

/** Opérateurs que `evaluateConditions` sait évaluer. */
const OPERATEURS_CONNUS = ['eq', 'neq', 'in', 'not_in'];

function evaluateConditions(
  conditions: Record<string, any>,
  event: CRMEvent,
): boolean {
  if (!conditions || Object.keys(conditions).length === 0) return true;

  // Simple condition matching against event metadata
  for (const [key, expected] of Object.entries(conditions)) {
    const actual = event.metadata[key];

    // Support operators
    if (typeof expected === 'object' && expected !== null && !Array.isArray(expected)) {
      // Un opérateur inconnu était purement IGNORÉ : la condition passait pour
      // vraie et la règle s'exécutait sur tout. Une règle « si montant > 5000 »
      // partait donc pour n'importe quel montant — un faux positif, bien plus
      // dangereux qu'un blocage. On refuse désormais d'évaluer ce qu'on ne
      // comprend pas.
      const inconnus = Object.keys(expected).filter((op) => !OPERATEURS_CONNUS.includes(op));
      if (inconnus.length > 0) {
        console.warn(
          `[automationEngine] condition ignorée — opérateur(s) non supporté(s) sur « ${key} » : ${inconnus.join(', ')}`,
        );
        return false;
      }

      if ('eq' in expected && !memeValeur(actual, expected.eq)) return false;
      if ('neq' in expected && memeValeur(actual, expected.neq)) return false;
      if ('in' in expected && Array.isArray(expected.in)
        && !expected.in.some((v: unknown) => memeValeur(actual, v))) return false;
      if ('not_in' in expected && Array.isArray(expected.not_in)
        && expected.not_in.some((v: unknown) => memeValeur(actual, v))) return false;
    } else {
      // Direct equality
      if (!memeValeur(actual, expected)) return false;
    }
  }
  return true;
}

// ── Deduplication key builder ───────────────────────────────

// La clé NE DOIT PAS contenir la date : `idx_scheduled_tasks_dedup` est unique
// sur (org_id, execution_key) parmi les tâches pending/running, et c'est ce qui
// empêche de planifier deux fois la même action. Avec la date du jour, renvoyer
// le même devis le lendemain produisait une clé différente : les 5 relances
// déjà en attente restaient, 5 nouvelles s'ajoutaient, et le client recevait
// tout en double (constaté en prod : 10 tâches pending pour un seul devis).
function buildExecutionKey(ruleId: string, entityId: string, actionIndex: number): string {
  return `${ruleId}:${entityId}:${actionIndex}`;
}

// ── Quiet hours (SMS only) ──────────────────────────────────
// No automated text lands on a client's phone outside 08:00–19:59 local
// (Québec). Emails/notifications are unaffected — only SMS wakes people up.

const QUIET_TZ = 'America/Toronto';
const SEND_START_HOUR = 8;
const SEND_END_HOUR = 20; // exclusive — last send at 19:59

function localHour(d: Date): number {
  return parseInt(
    new Intl.DateTimeFormat('en-CA', { timeZone: QUIET_TZ, hour: '2-digit', hour12: false }).format(d),
    10,
  );
}

export function isQuietHours(d: Date = new Date()): boolean {
  const h = localHour(d);
  return h < SEND_START_HOUR || h >= SEND_END_HOUR;
}

/**
 * Cette action doit-elle respecter la fenêtre 8h–20h ?
 *
 * Les SMS, toujours. Les courriels, seulement quand ils sont COMMERCIAUX.
 *
 * Le critère est le délai de la règle, et non une liste de déclencheurs à
 * maintenir : un message immédiat est une confirmation que le destinataire
 * attend (« rendez-vous confirmé », « dépôt reçu ») — le retarder jusqu'à 8h
 * lui ferait croire que sa demande n'est pas passée. Un message différé est
 * une relance ou un suivi : rien ne justifie qu'il parte à 3h du matin.
 *
 * Corrige aussi une incohérence visible : une règle envoyant SMS + courriel
 * voyait ses deux moitiés partir à des heures différentes, le SMS étant seul
 * reporté.
 */
function shouldRespectQuietHours(actionType: string, delaySeconds: number): boolean {
  if (actionType === 'send_sms') return true;
  if (actionType !== 'send_email') return false;
  // Délai non nul (positif OU négatif, comme les rappels « X h avant ») =
  // message programmé, donc pas une confirmation attendue dans l'instant.
  return delaySeconds !== 0;
}

/** Next moment inside the send window, stepping 30 min (DST-safe, no tz lib). */
export function nextSendTime(from: Date = new Date()): Date {
  const next = new Date(from);
  for (let i = 0; i < 48; i++) {
    next.setTime(next.getTime() + 30 * 60 * 1000);
    if (!isQuietHours(next)) return next;
  }
  return from;
}

// ── Interrupteurs ───────────────────────────────────────────

/**
 * Interrupteur GLOBAL (F6). `AUTOMATIONS_ENABLED=false` arrête tout — les
 * événements comme le tick — sans toucher à la base : c'est précisément quand
 * la base est en cause qu'on en a besoin. Lu à chaque appel, jamais figé au
 * chargement, pour être modifiable à chaud (variable Railway).
 */
export function automationsActivees(): boolean {
  return (process.env.AUTOMATIONS_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
}

/** Réglages d'une org utiles au moteur, lus une fois par événement ou par tick (F24). */
interface ReglagesOrg {
  langue: 'fr' | 'en';
  /** Fuseau de l'entreprise (company_settings.timezone, défaut America/Toronto). */
  fuseau: string;
  /** Pause par org (M2) : rien ne part, les tâches attendent. */
  enPause: boolean;
  /** Simulation par org (M2) : on journalise « aurait envoyé », sans fournisseur. */
  essaiABlanc: boolean;
}

/** Cache par org, le temps d'un événement ou d'un tick — jamais entre deux. */
type CacheReglages = Map<string, Promise<ReglagesOrg>>;

async function lireReglagesOrg(supabase: SupabaseClient, orgId: string): Promise<ReglagesOrg> {
  const defaut: ReglagesOrg = { langue: 'fr', fuseau: QUIET_TZ, enPause: false, essaiABlanc: false };
  try {
    const { data, error } = await supabase
      .from('company_settings')
      .select('default_language, timezone, automations_paused_at, automations_dry_run')
      .eq('org_id', orgId)
      .maybeSingle();
    if (error) {
      // Les deux colonnes d'interrupteur arrivent par migration (M2). Tant
      // qu'elle n'est pas appliquée, PostgREST refuse TOUTE la requête : on
      // relit alors langue et fuseau plutôt que de tout perdre.
      const { data: repli } = await supabase
        .from('company_settings')
        .select('default_language, timezone')
        .eq('org_id', orgId)
        .maybeSingle();
      return { ...defaut, langue: repli?.default_language === 'en' ? 'en' : 'fr', fuseau: repli?.timezone || QUIET_TZ };
    }
    return {
      langue: data?.default_language === 'en' ? 'en' : 'fr',
      fuseau: data?.timezone || QUIET_TZ,
      enPause: !!data?.automations_paused_at,
      essaiABlanc: data?.automations_dry_run === true,
    };
  } catch {
    return defaut;
  }
}

function reglagesDe(cache: CacheReglages, supabase: SupabaseClient, orgId: string): Promise<ReglagesOrg> {
  let p = cache.get(orgId);
  if (!p) {
    p = lireReglagesOrg(supabase, orgId);
    cache.set(orgId, p);
  }
  return p;
}

// ── Consentement commercial (F7) ────────────────────────────

/**
 * Déclencheurs dont les actions DIFFÉRÉES sont des communications commerciales
 * au sens de la LCAP (relance de vente, réengagement, saisonnier, anniversaire),
 * par opposition aux suivis d'une demande du client (devis, facture, rendez-vous)
 * qui relèvent de la relation d'affaires en cours.
 */
const DECLENCHEURS_COMMERCIAUX = new Set(['job.completed', 'lead.status_changed', 'pipeline_deal.stage_changed']);

function estCommerciale(triggerEvent: string | undefined, delaySeconds: number): boolean {
  return delaySeconds > 0 && !!triggerEvent && DECLENCHEURS_COMMERCIAUX.has(triggerEvent);
}

/**
 * Consentement commercial du client (`clients.marketing_consent`, migration M5) :
 * 'express' | 'implied' | 'none'. Lecture séparée et tolérante : tant que la
 * colonne n'existe pas, ou si la lecture échoue, on considère la relation
 * d'affaires implicite (le comportement d'avant) — mais on le journalise.
 */
async function lireConsentement(supabase: SupabaseClient, orgId: string, clientId: string | null): Promise<'express' | 'implied' | 'none'> {
  if (!clientId) return 'implied';
  const { data, error } = await supabase
    .from('clients')
    .select('marketing_consent')
    .eq('id', clientId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) {
    console.error(`[automationEngine] consentement illisible (client ${clientId}, org ${orgId}) — relation implicite supposée:`, error.message);
    return 'implied';
  }
  const v = data?.marketing_consent;
  return v === 'none' || v === 'express' ? v : 'implied';
}

// ── Plafond quotidien par org (F11/F13, M4) ─────────────────

interface PlafondsOrg { sms: number; email: number }
const CACHE_PLAFONDS_MS = 60_000;
const cachePlafonds = new Map<string, { valeur: PlafondsOrg; expire: number }>();

/**
 * Plafonds quotidiens du forfait (`plans.automation_daily_sms_cap` /
 * `_email_cap`, migration M4). 0 = pas de plafond. Sans abonnement lisible : pas
 * de plafond non plus — on ne bloque jamais sur une panne de lecture.
 */
async function plafondsDe(supabase: SupabaseClient, orgId: string): Promise<PlafondsOrg> {
  const maintenant = Date.now();
  const enCache = cachePlafonds.get(orgId);
  if (enCache && enCache.expire > maintenant) return enCache.valeur;
  let valeur: PlafondsOrg = { sms: 0, email: 0 };
  try {
    // `subscriptions.plan_id` n'a pas de clé étrangère vers `plans` : deux
    // lectures, comme dans twilioProvisioning.orgPlanIncludesSms.
    const { data: subs } = await supabase
      .from('subscriptions')
      .select('plan_id')
      .eq('org_id', orgId)
      .in('status', ['active', 'trialing']);
    const ids = (subs || []).map((s: any) => s.plan_id).filter(Boolean);
    if (ids.length) {
      const { data: plans } = await supabase
        .from('plans')
        .select('id, automation_daily_sms_cap, automation_daily_email_cap')
        .in('id', ids);
      for (const p of (plans || []) as any[]) {
        valeur = { sms: Math.max(valeur.sms, Number(p.automation_daily_sms_cap) || 0), email: Math.max(valeur.email, Number(p.automation_daily_email_cap) || 0) };
      }
    }
  } catch (e: any) {
    console.error(`[automationEngine] plafonds du forfait illisibles (org ${orgId}) — aucun plafond appliqué:`, e?.message || e);
  }
  cachePlafonds.set(orgId, { valeur, expire: maintenant + CACHE_PLAFONDS_MS });
  return valeur;
}

/** Pour les tests : oublie les plafonds mis en cache. */
export function viderCachePlafonds(): void {
  cachePlafonds.clear();
}

/** 8 h demain, heure de Montréal (approximation DST-safe via nextSendTime depuis minuit UTC+1j). */
function demainMatin(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(11, 0, 0, 0); // 11 h UTC = 7 h EDT / 6 h EST → nextSendTime ramène dans la fenêtre 8 h-20 h
  return isQuietHours(d) ? nextSendTime(d) : d;
}

type VerdictPlafond = { ok: true } | { ok: false; raison: string };

/**
 * Compte l'envoi du jour (RPC `automation_bump_counter`, atomique) et le compare
 * au plafond du forfait. Au-delà : refus (l'appelant reporte à demain, jamais
 * de perte). À 80 % : une alerte à l'entrepreneur, une seule fois par jour
 * (au passage exact du seuil).
 */
async function verifierPlafondQuotidien(
  supabase: SupabaseClient,
  orgId: string,
  canal: 'sms' | 'email',
): Promise<VerdictPlafond> {
  const plafonds = await plafondsDe(supabase, orgId);
  const plafond = plafonds[canal];
  if (!plafond || plafond <= 0) return { ok: true };

  const { data, error } = await supabase.rpc('automation_bump_counter', { p_org: orgId, p_canal: canal });
  if (error) {
    console.error(`[automationEngine] compteur quotidien indisponible (org ${orgId}, ${canal}) — envoi autorisé:`, error.message);
    return { ok: true };
  }
  const total = Number(data) || 0;
  const seuilAlerte = Math.ceil(plafond * 0.8);
  if (total === seuilAlerte && seuilAlerte < plafond) {
    await notifierAdmins(supabase, orgId, {
      type: 'automation_cap_warning',
      title: canal === 'sms' ? 'Plafond de SMS bientôt atteint' : 'Plafond de courriels bientôt atteint',
      body: `${total} ${canal === 'sms' ? 'SMS' : 'courriels'} d’automatisation envoyés aujourd’hui sur un plafond de ${plafond}. Au-delà, les envois seront reportés à demain.`,
    });
  }
  if (total > plafond) {
    return { ok: false, raison: `Daily cap reached (${plafond} ${canal}/day for this plan) — deferred to tomorrow` };
  }
  return { ok: true };
}

// ── Notification à l'entrepreneur ───────────────────────────

/**
 * Prévient les owners/admins de l'org (une notification par personne ; à
 * défaut de membres lisibles, une notification d'org sans destinataire).
 * Best-effort : jamais bloquant.
 */
async function notifierAdmins(
  supabase: SupabaseClient,
  orgId: string,
  notif: { type: string; title: string; body: string; entity_type?: string | null; entity_id?: string | null },
): Promise<void> {
  try {
    const { data: admins } = await supabase
      .from('memberships')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .in('role', ['owner', 'admin']);
    const cibles = (Array.isArray(admins) ? admins : admins ? [admins] : []).map((m: any) => m.user_id).filter(Boolean);
    const lignes = (cibles.length ? cibles : [null]).map((userId) => ({
      org_id: orgId,
      user_id: userId,
      type: notif.type,
      title: notif.title,
      body: notif.body,
      entity_type: notif.entity_type ?? null,
      entity_id: notif.entity_id ?? null,
      link: '/automations',
      is_read: false,
    }));
    const { error } = await supabase.from('notifications').insert(lignes);
    if (error) console.error(`[automationEngine] notification impossible (org ${orgId}):`, error.message);
  } catch (e: any) {
    console.error(`[automationEngine] notification impossible (org ${orgId}):`, e?.message || e);
  }
}

// ── Trace d'exécution (F8, M3) ──────────────────────────────

interface LigneLog {
  org_id: string;
  automation_rule_id: string | null;
  scheduled_task_id?: string | null;
  trigger_event: string;
  entity_type: string;
  entity_id: string;
  action_type: string;
  action_config: Record<string, unknown>;
  result_success: boolean;
  result_data: unknown;
  result_error: string | null;
  duration_ms: number;
  // Colonnes de trace (M3) — retirées au repli si la migration n'est pas passée.
  recipient?: string | null;
  actor_id?: string | null;
  rule_snapshot?: Record<string, unknown> | null;
  dry_run?: boolean;
}

/**
 * Journalise une exécution. Les colonnes de trace (M3) manquent tant que la
 * migration n'est pas appliquée ; PostgREST refuserait alors TOUTE la ligne —
 * on réécrit sans elles plutôt que de perdre le journal.
 */
async function ecrireLog(supabase: SupabaseClient, ligne: LigneLog): Promise<void> {
  const { error } = await supabase.from('automation_execution_logs').insert(ligne);
  if (!error) return;
  const colonneAbsente = error.code === 'PGRST204' || /column/i.test(error.message || '');
  if (!colonneAbsente) {
    console.error(`[automationEngine] failed to write execution log (rule ${ligne.automation_rule_id}, org ${ligne.org_id}):`, error.message);
    return;
  }
  const { recipient: _r, actor_id: _a, rule_snapshot: _s, dry_run: _d, ...sansTrace } = ligne;
  const { error: erreurRepli } = await supabase.from('automation_execution_logs').insert(sansTrace);
  if (erreurRepli) {
    console.error(`[automationEngine] failed to write execution log (rule ${ligne.automation_rule_id}, org ${ligne.org_id}):`, erreurRepli.message);
  }
}

/** Destinataire d'une action, pour la trace — jamais le corps du message. */
function destinataireDe(actionType: string, vars: Record<string, string>): string | null {
  if (actionType === 'send_sms') return vars.client_phone || null;
  if (actionType === 'send_email') return vars.client_email || null;
  if (actionType === 'request_review') return vars.client_email || vars.client_phone || null;
  return null;
}

// ── Délai maximal d'une action (T10.4) ──────────────────────

function delaiActionMs(): number {
  const v = Number(process.env.AUTOMATION_ACTION_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 20_000;
}

/**
 * Un fournisseur muet ne doit pas suspendre le tick : au-delà du délai,
 * l'action est réputée échouée (cause transitoire → reprise), et le tick passe
 * à la tâche suivante. La promesse d'origine continue en arrière-plan ; si
 * elle aboutit tard, la reprise pourra doubler l'envoi — c'est le prix d'une
 * file qui ne se fige jamais (F5 : clé d'idempotence fournisseur à venir).
 */
function avecDelaiMax<T>(p: Promise<T>, ms: number, quoi: string): Promise<T> {
  let minuterie: NodeJS.Timeout;
  const garde = new Promise<never>((_, rej) => {
    minuterie = setTimeout(() => rej(new Error(`${quoi} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([p, garde]).finally(() => clearTimeout(minuterie)) as Promise<T>;
}

// ── Execute actions for a rule ──────────────────────────────

/** Fenêtre pendant laquelle une action immédiate déjà exécutée n'est pas rejouée (F3). */
const FENETRE_IDEMPOTENCE_MS = 24 * 3600_000;

/**
 * Réserve l'exécution d'une action IMMÉDIATE (F3).
 *
 * Auparavant, une action à délai 0 s'exécutait sans laisser de trace avant
 * l'envoi : le même hook posté deux fois (double clic, rejeu réseau, deux
 * onglets) envoyait deux confirmations. On passe désormais par la même table
 * que les actions différées : une ligne `running` portant la clé
 * `règle:entité:index`, protégée par l'index unique `idx_scheduled_tasks_dedup`
 * (pending/running). Deux exécutions concurrentes → la seconde reçoit 23505 et
 * s'efface. Une exécution déjà `completed` depuis moins de 24 h → on ne rejoue
 * pas non plus, sauf rejeu LÉGITIME signalé par l'émetteur
 * (`metadata.rescheduled` : rendez-vous déplacé, le client doit être reprévenu).
 *
 * Retourne `null` quand il ne faut PAS exécuter ; sinon l'id de la réservation
 * (ou `undefined` si la réservation n'a pas pu être écrite — on exécute quand
 * même, une confirmation vaut mieux qu'un silence).
 */
async function reserverExecutionImmediate(
  supabase: SupabaseClient,
  rule: AutomationRule,
  event: CRMEvent,
  action: AutomationRule['actions'][number],
  executionKey: string,
): Promise<string | null | undefined> {
  if (!event.metadata?.rescheduled) {
    const depuis = new Date(Date.now() - FENETRE_IDEMPOTENCE_MS).toISOString();
    const { data: dejaFaite, error } = await supabase
      .from('automation_scheduled_tasks')
      .select('id')
      .eq('org_id', event.orgId)
      .eq('execution_key', executionKey)
      .eq('status', 'completed')
      .gte('completed_at', depuis)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error(`[automationEngine] vérification d'idempotence impossible (${executionKey}) — exécution quand même:`, error.message);
    } else if (dejaFaite) {
      logger.info(`[automationEngine] action immédiate déjà exécutée il y a moins de 24 h, ignorée : ${executionKey}`);
      return null;
    }
  }

  const { data, error } = await supabase
    .from('automation_scheduled_tasks')
    .insert({
      org_id: event.orgId,
      automation_rule_id: rule.id,
      entity_type: event.entityType,
      entity_id: event.entityId,
      action_config: { ...action, trigger_event: event.type, event_metadata: event.metadata, event_actor_id: event.actorId || null },
      execute_at: new Date().toISOString(),
      status: 'running',
      attempts: 1,
      execution_key: executionKey,
    })
    .select('id')
    .maybeSingle();
  if (error) {
    if (error.code === '23505') {
      logger.info(`[automationEngine] action immédiate déjà en cours ou en attente, ignorée : ${executionKey}`);
      return null;
    }
    console.error(`[automationEngine] réservation impossible (${executionKey}) — exécution sans réservation:`, error.message);
    return undefined;
  }
  return data?.id ?? undefined;
}

/** Clôt la réservation d'une action immédiate. */
async function cloreReservation(supabase: SupabaseClient, id: string | null | undefined, succes: boolean, erreur?: string | null) {
  if (!id) return;
  const { error } = await supabase
    .from('automation_scheduled_tasks')
    .update(succes
      ? { status: 'completed', completed_at: new Date().toISOString(), last_error: null }
      : { status: 'failed', completed_at: new Date().toISOString(), last_error: erreur || null })
    .eq('id', id);
  if (error) console.error(`[automationEngine] clôture de réservation impossible (${id}):`, error.message);
}

async function executeRuleActions(
  rule: AutomationRule,
  event: CRMEvent,
  config: EngineConfig,
  cache: CacheReglages,
) {
  const reglages = await reglagesDe(cache, config.supabase, event.orgId);
  if (reglages.enPause) {
    logger.info(`[automationEngine] org ${event.orgId} en pause — règle "${rule.name}" non exécutée`);
    return;
  }

  const vars = await resolveEntityVariables(
    config.supabase,
    event.orgId,
    event.entityType,
    event.entityId,
  );

  for (let i = 0; i < rule.actions.length; i++) {
    const action = rule.actions[i];
    const executionKey = buildExecutionKey(rule.id, event.entityId, i);

    // Reporte à la prochaine fenêtre d'envoi les actions déclenchées en heures
    // calmes. Une règle immédiate (délai 0) porte une confirmation attendue :
    // seuls ses SMS sont reportés, jamais ses courriels.
    if (shouldRespectQuietHours(action.type, rule.delay_seconds) && isQuietHours()) {
      // supabase-js ne lève jamais : l'erreur (dont le doublon 23505) arrive
      // dans la réponse, pas dans un catch.
      const { error: deferError } = await config.supabase.from('automation_scheduled_tasks').insert({
        org_id: event.orgId,
        automation_rule_id: rule.id,
        entity_type: event.entityType,
        entity_id: event.entityId,
        action_config: { ...action, trigger_event: event.type, event_metadata: event.metadata, event_actor_id: event.actorId || null },
        execute_at: nextSendTime().toISOString(),
        status: 'pending',
        execution_key: executionKey,
      });
      if (deferError) {
        if (deferError.code !== '23505') {
          console.error(`[automationEngine] failed to defer quiet-hours SMS (rule ${rule.id}, org ${event.orgId}):`, deferError.message);
        }
      } else {
        logger.info(`[automationEngine] ${action.type} deferred to send window (quiet hours) for rule "${rule.name}"`);
      }
      continue;
    }

    // Plafond quotidien du forfait (M4) : au-delà, l'envoi est reporté à
    // demain matin — jamais perdu, jamais envoyé en trop.
    const canal = action.type === 'send_sms' ? 'sms' : action.type === 'send_email' ? 'email' : null;
    if (canal) {
      const verdict = await verifierPlafondQuotidien(config.supabase, event.orgId, canal);
      if (!verdict.ok) {
        const { error: capError } = await config.supabase.from('automation_scheduled_tasks').insert({
          org_id: event.orgId,
          automation_rule_id: rule.id,
          entity_type: event.entityType,
          entity_id: event.entityId,
          action_config: { ...action, trigger_event: event.type, event_metadata: event.metadata, event_actor_id: event.actorId || null },
          execute_at: demainMatin().toISOString(),
          status: 'pending',
          execution_key: executionKey,
          last_error: verdict.raison,
        });
        if (capError && capError.code !== '23505') {
          console.error(`[automationEngine] report pour plafond impossible (rule ${rule.id}, org ${event.orgId}):`, capError.message);
        }
        logger.info(`[automationEngine] ${action.type} reporté à demain (plafond quotidien) — règle "${rule.name}"`);
        continue;
      }
    }

    const reservation = await reserverExecutionImmediate(config.supabase, rule, event, action, executionKey);
    if (reservation === null) continue;

    const ctx: ActionContext = {
      supabase: config.supabase,
      orgId: event.orgId,
      entityType: event.entityType,
      entityId: event.entityId,
      twilio: config.twilio,
      baseUrl: config.baseUrl,
      // Une demande d'avis est une sollicitation : elle compte dans le plafond
      // de fréquence par client, même immédiate (T11.6).
      commercial: action.type === 'request_review',
      langue: reglages.langue,
    };

    const startTime = Date.now();
    const trace = {
      recipient: destinataireDe(action.type, vars),
      actor_id: event.actorId || null,
      rule_snapshot: { trigger_event: rule.trigger_event, conditions: rule.conditions, delay_seconds: rule.delay_seconds, action },
    };

    try {
      let result;
      if (reglages.essaiABlanc) {
        result = { success: true, data: { dry_run: true, to: trace.recipient } };
      } else {
        result = await avecDelaiMax(executeAction(action.type, action.config, vars, ctx), delaiActionMs(), action.type);
      }
      const durationMs = Date.now() - startTime;

      await ecrireLog(config.supabase, {
        org_id: event.orgId,
        automation_rule_id: rule.id,
        scheduled_task_id: reservation ?? null,
        trigger_event: event.type,
        entity_type: event.entityType,
        entity_id: event.entityId,
        action_type: action.type,
        action_config: action.config,
        result_success: result.success,
        result_data: result.data || null,
        result_error: result.error || null,
        duration_ms: durationMs,
        ...trace,
        dry_run: reglages.essaiABlanc,
      });
      await cloreReservation(config.supabase, reservation, result.success, result.error);

      if (!result.success) {
        console.error(`[automationEngine] action ${action.type} failed for rule "${rule.name}":`, result.error);
      }
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      console.error(`[automationEngine] action ${action.type} threw for rule "${rule.name}":`, err.message);

      await ecrireLog(config.supabase, {
        org_id: event.orgId,
        automation_rule_id: rule.id,
        scheduled_task_id: reservation ?? null,
        trigger_event: event.type,
        entity_type: event.entityType,
        entity_id: event.entityId,
        action_type: action.type,
        action_config: action.config,
        result_success: false,
        result_data: null,
        result_error: err.message,
        duration_ms: durationMs,
        ...trace,
        dry_run: false,
      });
      await cloreReservation(config.supabase, reservation, false, err.message);
    }
  }
}

// ── Resolve execution time ──────────────────────────────────

/**
 * Tolérance avant d'abandonner un rappel dont l'heure est déjà passée.
 *
 * Un rappel « la veille » calculé avec 20 minutes de retard reste pertinent ;
 * le même rappel calculé 3 jours trop tard ne l'est plus.
 */
const RETARD_TOLERE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Calcule le moment d'exécution d'une action différée.
 *
 * Retourne `null` quand la tâche doit être ABANDONNÉE plutôt que planifiée.
 *
 * Auparavant, un rappel dont l'heure était déjà passée était exécuté « dans
 * 5 secondes ». Concrètement : créer aujourd'hui un rendez-vous pour DEMAIN
 * déclenchait immédiatement le rappel « J-7 », et le client recevait dans la
 * seconde « votre rendez-vous est dans une semaine » — alors qu'il est demain.
 * Un message factuellement faux, sur le cas le plus courant qui soit (la prise
 * de rendez-vous à court terme).
 *
 * On garde une tolérance : un rappel légèrement en retard part quand même,
 * parce que le décalage vient alors du tick de 5 minutes, pas d'une erreur de
 * cadence.
 */
/** Composantes de l'heure locale d'un instant dans un fuseau. */
function composantesLocales(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour') % 24, mi: g('minute'), s: g('second') };
}

/** L'instant UTC dont l'heure murale dans `tz` est `c` (deux itérations suffisent, DST compris). */
function instantLocal(tz: string, c: { y: number; mo: number; d: number; h: number; mi: number; s: number }): Date {
  let devine = Date.UTC(c.y, c.mo - 1, c.d, c.h, c.mi, c.s);
  for (let i = 0; i < 2; i++) {
    const r = composantesLocales(new Date(devine), tz);
    devine -= Date.UTC(r.y, r.mo - 1, r.d, r.h, r.mi, r.s) - Date.UTC(c.y, c.mo - 1, c.d, c.h, c.mi, c.s);
  }
  return new Date(devine);
}

/**
 * « N jours avant, à la même heure LOCALE » (F14). Soustraire N × 86 400 s
 * décalait le rappel d'une heure quand un changement d'heure tombait entre les
 * deux dates : rappel J-7 à 11 h pour un rendez-vous à 10 h (T9.2).
 */
function joursAvantHeureLocale(rendezVous: Date, jours: number, tz: string): Date {
  const c = composantesLocales(rendezVous, tz);
  const cal = new Date(Date.UTC(c.y, c.mo - 1, c.d) - jours * 86_400_000);
  return instantLocal(tz, { y: cal.getUTCFullYear(), mo: cal.getUTCMonth() + 1, d: cal.getUTCDate(), h: c.h, mi: c.mi, s: c.s });
}

async function resolveExecuteAt(
  rule: AutomationRule,
  event: CRMEvent,
  config: EngineConfig,
  fuseau: string,
): Promise<Date | null> {
  // Negative delay = "X seconds before the event's reference time"
  // Used for appointment reminders (e.g., -86400 = 1 day before start_time)
  if (rule.delay_seconds < 0 && (event.entityType === 'schedule_event' || event.entityType === 'appointment')) {
    const { data: evt, error } = await config.supabase
      .from('schedule_events')
      .select('start_at, start_time')
      .eq('id', event.entityId)
      .eq('org_id', event.orgId)
      .maybeSingle();

    // Une erreur de lecture ne doit pas être confondue avec « pas de date » :
    // sans ce garde, on retombait sur le délai positif ci-dessous et le rappel
    // « 1 semaine avant » partait 1 semaine APRÈS la création du rendez-vous.
    if (error) {
      console.error(`[automationEngine] lecture de schedule_events échouée (rule ${rule.id}):`, error.message);
      return null;
    }

    const startField = evt?.start_at || evt?.start_time;
    if (startField) {
      const eventTime = new Date(startField).getTime();
      const enJours = rule.delay_seconds % 86_400 === 0;
      const executeAt = enJours
        ? joursAvantHeureLocale(new Date(eventTime), -rule.delay_seconds / 86_400, fuseau)
        : new Date(eventTime + rule.delay_seconds * 1000);
      const retard = Date.now() - executeAt.getTime();

      if (retard > RETARD_TOLERE_MS) {
        // Le créneau du rappel est franchement dépassé : l'envoyer dirait au
        // client quelque chose de faux.
        logger.info(
          `[automationEngine] rappel abandonné (créneau dépassé de ${Math.round(retard / 60000)} min) — règle "${rule.name}"`,
        );
        return null;
      }
      if (retard > 0) {
        // Léger retard (tick de 5 min) : on part tout de suite, le message
        // reste juste.
        return new Date(Date.now() + 5000);
      }

      // Un rappel « avant » que les heures calmes repousseraient APRÈS le
      // rendez-vous n'a plus de sens (rappel 2 h avant un rendez-vous à 7 h :
      // échu à 5 h, poussé à 8 h, une heure après le passage — T9.5). « C'est
      // aujourd'hui, on s'en vient ! » ne peut pas partir la veille au soir :
      // on l'abandonne, et on le dit.
      const smsOuCourriel = rule.actions.some((a) => a.type === 'send_sms' || a.type === 'send_email');
      if (smsOuCourriel && isQuietHours(executeAt) && nextSendTime(executeAt).getTime() > eventTime) {
        logger.info(`[automationEngine] rappel abandonné (les heures calmes le pousseraient après le rendez-vous) — règle "${rule.name}"`);
        return null;
      }
      return executeAt;
    }
  }

  // Normal positive delay from now
  return new Date(Date.now() + Math.abs(rule.delay_seconds) * 1000);
}

// ── Schedule delayed actions ────────────────────────────────

async function scheduleDelayedActions(
  rule: AutomationRule,
  event: CRMEvent,
  config: EngineConfig,
  cache: CacheReglages,
) {
  const { fuseau } = await reglagesDe(cache, config.supabase, event.orgId);
  const executeAt = await resolveExecuteAt(rule, event, config, fuseau);

  // `null` = créneau dépassé ou date de référence illisible : on ne planifie
  // rien plutôt que d'envoyer un rappel devenu faux.
  if (!executeAt) return;

  for (let i = 0; i < rule.actions.length; i++) {
    const action = rule.actions[i];
    const executionKey = buildExecutionKey(rule.id, event.entityId, i);

    // supabase-js ne lève jamais : le doublon (23505) comme toute autre erreur
    // se lit dans la réponse — un catch ici n'aurait jamais rien attrapé.
    const { error: insertError } = await config.supabase.from('automation_scheduled_tasks').insert({
      org_id: event.orgId,
      automation_rule_id: rule.id,
      entity_type: event.entityType,
      entity_id: event.entityId,
      action_config: { ...action, trigger_event: event.type, event_metadata: event.metadata, event_actor_id: event.actorId || null },
      execute_at: executeAt.toISOString(),
      status: 'pending',
      execution_key: executionKey,
    });
    if (insertError) {
      // Unique constraint violation = duplicate, skip
      if (insertError.code === '23505') {
        logger.info(`[automationEngine] skipped duplicate scheduled task: ${executionKey}`);
      } else {
        console.error(`[automationEngine] failed to schedule task (rule ${rule.id}, org ${event.orgId}):`, insertError.message);
      }
    }
  }
}

// ── Event handler ───────────────────────────────────────────

async function handleEvent(event: CRMEvent) {
  if (!engineConfig) return;
  if (!automationsActivees()) {
    logger.info(`[automationEngine] AUTOMATIONS_ENABLED=false — événement ${event.type} ignoré (org ${event.orgId})`);
    return;
  }

  const cache: CacheReglages = new Map();

  try {
    // ── 1. Match automation_rules ──
    // Ordre explicite (F17) : sans lui, l'ordre d'exécution de deux règles du
    // même événement dépendait du plan d'exécution de Postgres.
    const { data: rules, error } = await engineConfig.supabase
      .from('automation_rules')
      .select('*')
      .eq('org_id', event.orgId)
      .eq('trigger_event', event.type)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (error) {
      console.error('[automationEngine] failed to fetch rules:', error.message);
    }

    if (rules && rules.length > 0) {
      for (const rule of rules as AutomationRule[]) {
        // Chaque règle est isolée (T10.7) : une lecture qui explose dans la
        // première ne doit pas faire sauter les suivantes.
        try {
          if (!evaluateConditions(rule.conditions, event)) continue;
          if (rule.delay_seconds !== 0) {
            await scheduleDelayedActions(rule, event, engineConfig, cache);
          } else if (event.metadata?.suppress_immediate) {
            // Visite créée en lot (plan de service, job multi-visites) : seule la
            // PREMIÈRE visite déclenche la confirmation immédiate — sans ce
            // garde, un plan de 10 visites envoyait 10 confirmations d'un coup
            // au client. Les rappels datés (délai négatif) ne sont pas touchés :
            // ils passent par scheduleDelayedActions ci-dessus et restent calés
            // sur la date de CHAQUE visite.
            logger.info(`[automationEngine] confirmation immédiate supprimée (visite en lot) — règle "${rule.name}"`);
          } else {
            await executeRuleActions(rule, event, engineConfig, cache);
          }
        } catch (err: any) {
          console.error(`[automationEngine] règle "${rule.name}" (${rule.id}) en erreur sur ${event.type}:`, err.message);
        }
      }
    }

    // Le second système d'automatisations (table `workflows`, constructeur
    // visuel) a été retiré : aucune interface ne permettait d'en créer, les
    // 31 lignes existantes vivaient dans une seule org et n'ont jamais été
    // exécutées (`workflow_runs` vide). Leur planification différée violait de
    // surcroît une clé étrangère — `automation_scheduled_tasks.automation_rule_id`
    // pointe vers `automation_rules`, pas vers `workflows`.
    //
    // Les automatisations du produit vivent dans `automation_rules`, traitées
    // juste au-dessus.

  } catch (err: any) {
    console.error('[automationEngine] error handling event:', err.message);
  }
}

// ── Scheduled task processor (called by scheduler) ──────────

/** Nombre maximal de tentatives pour une tâche planifiée (1 initiale + 3 reprises). */
const MAX_TASK_ATTEMPTS = 4;

/**
 * Un échec est-il réessayable ?
 *
 * Distinction volontaire : une panne SMTP passagère mérite une reprise, un
 * client sans adresse courriel n'en méritera jamais — le réessayer trois fois
 * ne ferait que retarder l'inévitable et polluer les journaux.
 *
 * Deux sources : le drapeau `permanent` posé par l'action elle-même (préféré,
 * F26), et — pour les erreurs qui n'en portent pas — une liste de motifs.
 */
function isTransientFailure(error?: string | null, permanent?: boolean): boolean {
  if (permanent) return false;
  if (!error) return true; // cause inconnue → on laisse sa chance à la reprise
  const definitifs = [
    'no recipient',           // pas d'adresse / pas de téléphone
    'not configured',         // SMTP ou Twilio absent (config, pas incident)
    'opted out',              // désabonnement SMS : ne jamais réessayer
    'has unsubscribed',       // désabonnement courriel (F26) : idem
    'plan does not include',  // forfait insuffisant
    'are disabled',           // fonctionnalité désactivée dans les réglages
    'frequency cap',          // plafond atteint : le retenter donnerait le même refus
    'consent',                // pas de consentement commercial (F7)
    'règle désactivée',       // la règle a été éteinte pendant l'attente (F16)
  ];
  const lower = error.toLowerCase();
  return !definitifs.some((d) => lower.includes(d));
}

/**
 * Détermine l'état suivant d'une tâche qui vient d'échouer.
 *
 * Sans cette logique, une tâche échouée passait en `failed` définitif : le
 * fetch ne sélectionne que les `pending`, donc elle n'était PLUS JAMAIS
 * reprise. Le compteur `attempts` était bien incrémenté, mais jamais relu.
 * Résultat mesuré en prod : 8 tâches perdues, dont 6 relances par courriel
 * tombées sur un « SMTP not configured » passager.
 *
 * Reprise à délai croissant (5 min, 30 min, 2 h) pour laisser le temps à un
 * service externe de se rétablir sans marteler la file.
 */
function nextStateAfterFailure(
  attempts: number,
  error?: string | null,
  permanent?: boolean,
): Record<string, unknown> {
  const dejaTentees = Number(attempts || 0) + 1; // `attempts` a été incrémenté à la prise
  const peutReessayer = dejaTentees < MAX_TASK_ATTEMPTS && isTransientFailure(error, permanent);

  if (!peutReessayer) {
    return {
      status: 'failed',
      completed_at: new Date().toISOString(),
      last_error: error || null,
    };
  }

  const delaisMinutes = [5, 30, 120];
  const attente = delaisMinutes[Math.min(dejaTentees - 1, delaisMinutes.length - 1)];
  return {
    status: 'pending',
    execute_at: new Date(Date.now() + attente * 60_000).toISOString(),
    last_error: `${error || 'échec'} — reprise ${dejaTentees}/${MAX_TASK_ATTEMPTS} dans ${attente} min`,
  };
}

/**
 * Délai au-delà duquel une tâche « en cours » est considérée comme abandonnée.
 *
 * Large volontairement : une action lente (SMTP poussif, Twilio qui traîne)
 * doit pouvoir finir sans être reprise en parallèle.
 */
const TACHE_FIGEE_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Remet en file les tâches restées « en cours » après un arrêt brutal.
 *
 * Une tâche passe en `running` avant son exécution. Si le processus meurt
 * entre les deux — déploiement, plantage, mémoire épuisée — la ligne reste
 * `running` pour toujours :
 *   · le fetch ne sélectionne que les `pending`, donc elle n'est jamais
 *     reprise ;
 *   · l'index d'unicité couvre `running`, donc sa clé reste occupée et cette
 *     action ne peut PLUS JAMAIS être replanifiée pour cette entité.
 *
 * Chaque déploiement pendant un tick perdait ainsi quelques relances et
 * rendait l'entité concernée sourde pour cette règle.
 */
async function recupererTachesFigees(supabase: SupabaseClient): Promise<void> {
  const limite = new Date(Date.now() - TACHE_FIGEE_MS).toISOString();
  const { data, error } = await supabase
    .from('automation_scheduled_tasks')
    .update({ status: 'pending', execute_at: new Date().toISOString() })
    .eq('status', 'running')
    // `updated_at` N'EXISTE PAS sur cette table (colonnes vérifiées en base).
    // Avec PostgREST, une seule colonne inconnue fait échouer TOUTE la requête
    // — et supabase-js ne lève pas : la récupération des tâches figées ne
    // faisait donc jamais rien, en silence. `execute_at` est réécrit au moment
    // où la tâche est réclamée, il date bien le début du blocage.
    .lt('execute_at', limite)
    .select('id');

  if (error) {
    console.error('[automationEngine] récupération des tâches figées échouée:', error.message);
    return;
  }
  if (data && data.length > 0) {
    console.warn(`[automationEngine] ${data.length} tâche(s) figée(s) remise(s) en file (arrêt brutal détecté)`);
  }
}

/** Index de l'action dans la règle, porté par la clé `règle:entité:index`. */
function indexActionDe(executionKey: string | null | undefined): number | null {
  const m = /:(\d+)$/.exec(executionKey || '');
  return m ? Number(m[1]) : null;
}

/** Annule une tâche avec son motif (visible dans l'historique, F25). */
async function annulerTache(supabase: SupabaseClient, taskId: string, motif: string) {
  const { error } = await supabase
    .from('automation_scheduled_tasks')
    .update({ status: 'cancelled', completed_at: new Date().toISOString(), last_error: motif })
    .eq('id', taskId);
  if (error) console.error(`[automationEngine] failed to cancel scheduled task ${taskId}:`, error.message);
}

export async function processScheduledTasks(supabase: SupabaseClient) {
  if (!engineConfig) return;
  if (!automationsActivees()) {
    logger.info('[automationEngine] AUTOMATIONS_ENABLED=false — tick ignoré, la file reste intacte');
    return;
  }

  // Avant tout : libérer ce qu'un arrêt brutal aurait laissé coincé.
  await recupererTachesFigees(supabase);

  const now = new Date().toISOString();
  const cache: CacheReglages = new Map();

  // Fetch pending tasks that are ready
  const { data: tasks, error } = await supabase
    .from('automation_scheduled_tasks')
    // Clé étrangère nommée explicitement — même cause que dans
    // recurringJobScheduler : depuis 20260751100200, automation_scheduled_tasks
    // a deux clés vers automation_rules (l'originale, et la composite
    // (org_id, automation_rule_id) qui porte l'isolation multi-tenant).
    // PostgREST répondait PGRST201 et AUCUNE tâche d'automatisation planifiée
    // n'était plus exécutée.
    //
    // `is_active` et `actions` sont relus ICI, à l'exécution (F16) : la copie
    // faite à la planification peut avoir des jours — l'entrepreneur qui
    // désactive une règle ou corrige un texte doit être obéi.
    .select('*, automation_rules!automation_scheduled_tasks_automation_rule_id_fkey(name, actions, conditions, is_active, trigger_event, delay_seconds)')
    .eq('status', 'pending')
    .lte('execute_at', now)
    .order('execute_at', { ascending: true })
    .limit(50);

  if (error) {
    console.error('[automationEngine] failed to fetch scheduled tasks:', error.message);
    return;
  }
  if (!tasks || tasks.length === 0) return;

  for (const task of tasks as any[]) {
    // Heures calmes : on repousse à la prochaine fenêtre sans consommer de
    // tentative. Toute tâche présente ici est par construction DIFFÉRÉE (une
    // action immédiate s'exécute en direct, sans passer par cette file) : elle
    // porte donc une relance ou un suivi, jamais une confirmation attendue.
    // Les deux canaux sont concernés — auparavant seuls les SMS l'étaient, et
    // un courriel de relance pouvait partir à 3h du matin.
    const taskType = task.action_config?.type;
    if ((taskType === 'send_sms' || taskType === 'send_email') && isQuietHours()) {
      const prochaine = nextSendTime();
      // Un rappel « avant le rendez-vous » que le report ferait partir APRÈS
      // le rendez-vous est annulé (T9.5) : mieux vaut rien qu'un « on s'en
      // vient ! » une heure après le passage.
      const debut = task.action_config?.event_metadata?.start_time;
      const debutMs = debut ? new Date(debut).getTime() : NaN;
      const avantLeRendezVous = Number.isFinite(debutMs) && new Date(task.execute_at).getTime() <= debutMs;
      if (avantLeRendezVous && debutMs < prochaine.getTime()) {
        await annulerTache(supabase, task.id, 'Rappel abandonné : les heures calmes le pousseraient après le rendez-vous');
        continue;
      }
      const { error: pushError } = await supabase
        .from('automation_scheduled_tasks')
        .update({ execute_at: prochaine.toISOString() })
        .eq('id', task.id);
      if (pushError) {
        console.error(`[automationEngine] failed to push task ${task.id} out of quiet hours:`, pushError.message);
      }
      continue;
    }

    // Org en pause (M2) : la tâche attend, sans consommer de tentative, et
    // sans encombrer le tick (repoussée d'une heure).
    const reglages = await reglagesDe(cache, supabase, task.org_id);
    if (reglages.enPause) {
      const { error: pushError } = await supabase
        .from('automation_scheduled_tasks')
        .update({ execute_at: new Date(Date.now() + 3600_000).toISOString() })
        .eq('id', task.id);
      if (pushError) console.error(`[automationEngine] failed to push paused task ${task.id}:`, pushError.message);
      continue;
    }

    // Mark as running. Si la prise n'est pas persistée, la tâche reste
    // 'pending' et serait ré-exécutée au tour suivant — on la saute plutôt
    // que d'envoyer deux fois la même action.
    const { data: claimed, error: claimError } = await supabase
      .from('automation_scheduled_tasks')
      // `execute_at` est réécrit à l'instant de la prise : la table n'a pas de
      // colonne `updated_at`, et c'est cet horodatage qui permet de repérer
      // une tâche restée `running` après un arrêt brutal (cf.
      // `recupererTachesFigees`). Sans lui, la détection n'aurait aucun repère
      // temporel.
      //
      // Le filtre `.eq('status','pending')` rend la prise atomique : avec deux
      // instances du serveur, une seule voit sa mise à jour aboutir, l'autre
      // touche 0 ligne et passe son tour. Sans lui, les deux réussissaient et
      // exécutaient l'action — le client recevait le message en double.
      .update({ status: 'running', attempts: task.attempts + 1, execute_at: new Date().toISOString() })
      .eq('id', task.id)
      .eq('status', 'pending')
      .select('id');
    if (claimError) {
      console.error(`[automationEngine] failed to claim scheduled task ${task.id}:`, claimError.message);
      continue;
    }
    // Zéro ligne touchée = une autre instance (ou un tick qui se chevauche) a
    // pris la tâche entre le fetch et l'update. On la lui laisse.
    if (!claimed || claimed.length === 0) continue;

    try {
      const actionConfig = task.action_config;
      const actionType = actionConfig.type as ActionType;
      const regle = task.automation_rules || null;

      // F5 — reprise après un arrêt brutal : si l'exécution précédente de CETTE
      // tâche a déjà été journalisée réussie (le processus est mort entre
      // l'envoi et la clôture), on clôt sans renvoyer. Twilio et Resend n'offrent
      // pas de clé d'idempotence sur l'envoi : ce journal est notre seule garde.
      if (Number(task.attempts) >= 1 && (actionType === 'send_sms' || actionType === 'send_email' || actionType === 'request_review')) {
        const { data: dejaReussie, error: dejaErr } = await supabase
          .from('automation_execution_logs')
          .select('id')
          .eq('scheduled_task_id', task.id)
          .eq('result_success', true)
          .limit(1)
          .maybeSingle();
        if (!dejaErr && dejaReussie) {
          const { error: e } = await supabase.from('automation_scheduled_tasks')
            .update({ status: 'completed', completed_at: new Date().toISOString(), last_error: null })
            .eq('id', task.id);
          if (e) console.error(`[automationEngine] failed to close scheduled task ${task.id}:`, e.message);
          logger.info(`[automationEngine] tâche ${task.id} déjà exécutée avec succès — clôturée sans renvoi`);
          continue;
        }
      }

      // F16 — la règle telle qu'elle est MAINTENANT prime sur la copie.
      if (regle && regle.is_active === false) {
        await annulerTache(supabase, task.id, 'Règle désactivée pendant l’attente');
        continue;
      }
      let config = actionConfig.config || {};
      const index = indexActionDe(task.execution_key);
      const actionsRegle: any[] = Array.isArray(regle?.actions) ? regle.actions : [];
      let actionActuelle = index !== null ? actionsRegle[index] : null;
      if (!(actionActuelle && actionActuelle.type === actionType)) {
        // Clé sans index (ancienne tâche, tâche insérée à la main) : on retrouve
        // l'action par son type quand il n'y en a qu'une de ce type.
        const memeType = actionsRegle.filter((a) => a?.type === actionType);
        actionActuelle = memeType.length === 1 ? memeType[0] : null;
      }
      if (actionActuelle?.config) {
        config = actionActuelle.config;
      }

      // Check stop conditions before executing
      const motifArret = await checkStopConditions(
        supabase,
        task.org_id,
        task.entity_type,
        task.entity_id,
        actionConfig.trigger_event,
        actionConfig.event_metadata || {},
      );

      if (motifArret) {
        await annulerTache(supabase, task.id, motifArret);
        continue;
      }

      const vars = await resolveEntityVariables(
        supabase,
        task.org_id,
        task.entity_type,
        task.entity_id,
      );

      const delaiRegle = Number(regle?.delay_seconds ?? 1);
      const commerciale = estCommerciale(actionConfig.trigger_event, delaiRegle) && (actionType === 'send_sms' || actionType === 'send_email');

      // Consentement (F7) : une sollicitation commerciale exige que le client
      // n'ait pas dit non. Échec DÉFINITIF, jamais repris.
      if (commerciale) {
        const consentement = await lireConsentement(supabase, task.org_id, vars.client_id || null);
        if (consentement === 'none') {
          const erreur = 'No marketing consent for this client — commercial message withheld';
          await ecrireLog(supabase, {
            org_id: task.org_id, automation_rule_id: task.automation_rule_id, scheduled_task_id: task.id,
            trigger_event: actionConfig.trigger_event || 'scheduled', entity_type: task.entity_type, entity_id: task.entity_id,
            action_type: actionType, action_config: config, result_success: false, result_data: null, result_error: erreur, duration_ms: 0,
            recipient: destinataireDe(actionType, vars), actor_id: actionConfig.event_actor_id || null,
            rule_snapshot: regle ? { trigger_event: regle.trigger_event, conditions: regle.conditions, delay_seconds: regle.delay_seconds, action: { type: actionType, config } } : null,
            dry_run: false,
          });
          const { error: e } = await supabase.from('automation_scheduled_tasks')
            .update(nextStateAfterFailure(task.attempts, erreur, true)).eq('id', task.id);
          if (e) console.error(`[automationEngine] failed to close scheduled task ${task.id}:`, e.message);
          continue;
        }
      }

      // Plafond quotidien du forfait (M4) : reporté à demain, sans tentative consommée.
      const canal = actionType === 'send_sms' ? 'sms' : actionType === 'send_email' ? 'email' : null;
      if (canal) {
        const verdict = await verifierPlafondQuotidien(supabase, task.org_id, canal);
        if (!verdict.ok) {
          const { error: e } = await supabase.from('automation_scheduled_tasks')
            .update({ status: 'pending', attempts: task.attempts, execute_at: demainMatin().toISOString(), last_error: verdict.raison })
            .eq('id', task.id);
          if (e) console.error(`[automationEngine] report pour plafond impossible (${task.id}):`, e.message);
          continue;
        }
      }

      const ctx: ActionContext = {
        supabase,
        orgId: task.org_id,
        entityType: task.entity_type,
        entityId: task.entity_id,
        twilio: engineConfig.twilio,
        baseUrl: engineConfig.baseUrl,
        // Toute tâche de cette file est DIFFÉRÉE, donc commerciale : soumise au
        // plafond de fréquence. Les actions immédiates (confirmations) ne
        // passent pas ici et restent exemptes.
        commercial: true,
        langue: reglages.langue,
      };

      const startTime = Date.now();
      const result = reglages.essaiABlanc
        ? { success: true, data: { dry_run: true, to: destinataireDe(actionType, vars) } }
        : await avecDelaiMax(executeAction(actionType, config, vars, ctx), delaiActionMs(), actionType);
      const durationMs = Date.now() - startTime;

      await ecrireLog(supabase, {
        org_id: task.org_id,
        automation_rule_id: task.automation_rule_id,
        scheduled_task_id: task.id,
        trigger_event: actionConfig.trigger_event || 'scheduled',
        entity_type: task.entity_type,
        entity_id: task.entity_id,
        action_type: actionType,
        action_config: config,
        result_success: result.success,
        result_data: result.data || null,
        result_error: result.error || null,
        duration_ms: durationMs,
        recipient: destinataireDe(actionType, vars),
        actor_id: actionConfig.event_actor_id || null,
        rule_snapshot: regle ? { trigger_event: regle.trigger_event, conditions: regle.conditions, delay_seconds: regle.delay_seconds, action: { type: actionType, config } } : null,
        dry_run: reglages.essaiABlanc,
      });

      // Update task status — avec reprise sur échec transitoire.
      const etatSuivant = result.success
        ? { status: 'completed', completed_at: new Date().toISOString(), last_error: null }
        : nextStateAfterFailure(task.attempts, result.error, result.permanent);
      const { error: statusError } = await supabase
        .from('automation_scheduled_tasks')
        .update(etatSuivant)
        .eq('id', task.id);
      if (statusError) {
        // La tâche resterait 'running' pour toujours : personne ne la reprend.
        console.error(`[automationEngine] failed to close scheduled task ${task.id}:`, statusError.message);
      }

      // Échec définitif : l'entrepreneur doit le savoir (T10.3), en français.
      if (etatSuivant.status === 'failed') {
        await notifierAdmins(supabase, task.org_id, {
          type: 'automation_failed',
          title: `Automatisation non envoyée : ${regle?.name || actionType}`,
          body: traduireErreurAutomatisation(result.error),
          entity_type: task.entity_type,
          entity_id: task.entity_id,
        });
      }
    } catch (err: any) {
      console.error(`[automationEngine] scheduled task ${task.id} failed:`, err.message);
      const { error: statusError } = await supabase
        .from('automation_scheduled_tasks')
        .update(nextStateAfterFailure(task.attempts, err.message))
        .eq('id', task.id);
      if (statusError) {
        console.error(`[automationEngine] failed to mark task ${task.id} as failed:`, statusError.message);
      }
    }
  }
}

// ── Stop condition checker ──────────────────────────────────

/**
 * Faut-il abandonner cette tâche planifiée ?
 *
 * Retourne le MOTIF (chaîne) quand la relance n'a plus lieu d'être (facture
 * payée, devis accepté, rendez-vous annulé…) — il est écrit dans `last_error`
 * pour qu'une annulation se voie (F25) — et `null` quand la tâche peut partir.
 *
 * Toutes les lectures portent `org_id` (F1) : sous `service_role`, c'est le
 * seul garde-fou entre les organisations.
 *
 * Précaution centrale : `supabase-js` ne lève jamais d'exception, il retourne
 * `{ data, error }`. Sur erreur (délai dépassé, incident réseau, RLS), `data`
 * vaut `null`, que le code interprétait comme « entité supprimée » et
 * traduisait par une annulation irrémédiable. Un hoquet de deux secondes
 * suffisait à supprimer des relances en attente, sans log ni reprise.
 *
 * Règle appliquée partout : une erreur de LECTURE ne conclut rien. On laisse
 * la tâche en place ; le tick suivant réessaiera.
 */
async function checkStopConditions(
  supabase: SupabaseClient,
  orgId: string,
  entityType: string,
  entityId: string,
  triggerEvent?: string,
  eventMetadata: Record<string, any> = {},
): Promise<string | null> {
  /** Journalise et signale qu'aucune conclusion ne peut être tirée. */
  const illisible = (table: string, message: string): null => {
    console.error(
      `[automationEngine] condition d'arrêt indéterminable (${table}, ${entityType} ${entityId}) — tâche conservée:`,
      message,
    );
    return null; // ne PAS annuler
  };

  // Invoice reminders: stop if paid, cancelled, disputed, or client archived
  if (entityType === 'invoice') {
    const { data: inv, error } = await supabase
      .from('invoices')
      .select('status, client_id')
      .eq('id', entityId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (error) return illisible('invoices', error.message);
    if (!inv) return 'Facture supprimée';
    if (['paid', 'cancelled', 'void'].includes(inv.status)) return `Facture ${inv.status === 'paid' ? 'payée' : 'annulée'}`;
    // Estimate follow-ups (ancien flux) : stop if accepted or rejected
    if (triggerEvent === 'estimate.sent' && ['accepted', 'rejected'].includes(inv.status)) return `Estimation ${inv.status}`;
    // Check if client is archived/deleted
    if (inv.client_id) {
      const { data: cl, error: clErr } = await supabase
        .from('clients').select('deleted_at').eq('id', inv.client_id).eq('org_id', orgId).maybeSingle();
      if (clErr) return illisible('clients', clErr.message);
      if (cl?.deleted_at) return 'Client archivé';
    }
  }

  // Appointment reminders: stop if cancelled, deleted, or the job is gone
  if (entityType === 'schedule_event' || entityType === 'appointment') {
    const { data: evt, error } = await supabase
      .from('schedule_events')
      .select('status, deleted_at, job_id')
      .eq('id', entityId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (error) return illisible('schedule_events', error.message);
    if (!evt) return 'Rendez-vous supprimé';
    if (evt.deleted_at) return 'Rendez-vous supprimé';
    if (evt.status === 'cancelled') return 'Rendez-vous annulé';
    if (evt.job_id) {
      const { data: job, error: jobErr } = await supabase
        .from('jobs').select('deleted_at, status').eq('id', evt.job_id).eq('org_id', orgId).maybeSingle();
      if (jobErr) return illisible('jobs', jobErr.message);
      if (!job || job.deleted_at) return 'Job supprimée';
      if (job.status === 'cancelled') return 'Job annulée';
    }
  }

  // Job follow-ups (thank you, cross-sell…): stop if the job is deleted or cancelled
  if (entityType === 'job') {
    const { data: job, error } = await supabase
      .from('jobs')
      .select('deleted_at, status, client_id')
      .eq('id', entityId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (error) return illisible('jobs', error.message);
    if (!job || job.deleted_at) return 'Job supprimée';
    if (job.status === 'cancelled') return 'Job annulée';
    if (job.client_id) {
      const { data: cl, error: clErr } = await supabase
        .from('clients').select('deleted_at').eq('id', job.client_id).eq('org_id', orgId).maybeSingle();
      if (clErr) return illisible('clients', clErr.message);
      if (cl?.deleted_at) return 'Client archivé';
    }
  }

  // Quote follow-ups: stop once the client responded (approved, declined,
  // changes requested) or the quote left circulation (expired, converted, archived)
  if (entityType === 'quote') {
    const { data: quote, error } = await supabase
      .from('quotes')
      .select('status, deleted_at')
      .eq('id', entityId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (error) return illisible('quotes', error.message);
    if (!quote) return 'Soumission supprimée';
    if (quote.deleted_at) return 'Soumission supprimée';
    if (['approved', 'declined', 'changes_requested', 'expired', 'converted', 'archived', 'void'].includes(quote.status)) return `Soumission ${quote.status}`;
  }

  // Lead: stop if archived or deleted (a lead is a client with status='lead')
  if (entityType === 'lead') {
    const { data: lead, error } = await supabase
      .from('clients')
      .select('status, lead_status, deleted_at')
      .eq('id', entityId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (error) return illisible('clients', error.message);
    if (!lead) return 'Prospect supprimé';
    if (lead.deleted_at) return 'Prospect archivé';
    // Stop once it's no longer an open lead (promoted/won) or funnel-closed.
    if (lead.status !== 'lead') return 'Prospect converti en client';
    // F25 : une tâche ARMÉE PAR la perte du prospect (réengagement à 90 jours)
    // ne doit pas être annulée parce que le prospect est perdu — c'est sa
    // raison d'être. Les autres suivis de prospect s'arrêtent bien sur « lost ».
    const armeeParLaPerte = triggerEvent === 'lead.status_changed' && eventMetadata?.new_status === 'lost';
    const fermes = armeeParLaPerte
      ? ['closed', 'converted', 'closed_won']
      : ['lost', 'closed', 'converted', 'closed_won', 'closed_lost'];
    if (fermes.includes(lead.lead_status)) return `Prospect ${lead.lead_status}`;
  }

  return null;
}

// ── Public API ──────────────────────────────────────────────

export function initAutomationEngine(config: EngineConfig) {
  engineConfig = config;

  // Initialize event bus with supabase
  eventBus.init(config.supabase);

  // Listen to all events
  eventBus.onAnyEvent(handleEvent);

  logger.info('[automationEngine] initialized and listening for events');
}
