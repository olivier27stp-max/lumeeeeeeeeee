/**
 * Automated Payment Reminders — cron worker.
 *
 * POST /api/cron/payment-reminders
 *   Auth: Bearer <CRON_SECRET> OR header x-cron-secret: <CRON_SECRET>
 *
 * For each org with reminder_settings.enabled = true:
 *   For each schedule entry {days_after_due, channel}:
 *     For each invoice with status IN ('sent','partial')
 *       AND due_date IS NOT NULL
 *       AND due_date < (today - days_after_due days)
 *       AND not already logged for (invoice_id, days_after_due, channel):
 *         - send email/sms per channel
 *         - upsert reminder_log row (UNIQUE constraint guarantees idempotency)
 *
 * Status remains in ('sent','partial') — there's no 'overdue' status in
 * invoices.status check constraint; the dashboard derives "overdue" from
 * due_date < now() on read.
 */

import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { sendEmail, isMailerConfigured, adresseInjoignable } from '../lib/mailer';
import { getCompanySettings, senderForOrg, marqueDepuis, langueEntreprise } from './emails';
import { rendreCourrielClient, dateLisible, MOTS } from '../lib/courriels/gabarit';
import { texteDuCourriel } from '../lib/courriels/modeles';
import { logger } from '../lib/logger';
import { sendSmsIfConfigured, applyTemplate, isSmsOptedOut } from '../lib/notificationHelpers';
import { twilioClient, twilioPhoneNumber } from '../lib/config';
import { resolvePublicBaseUrl, normalizeE164 } from '../lib/helpers';
import { createPaymentRequest } from '../lib/stripe-connect';
import { getOrgSmsFromNumber, SmsNumberNotProvisionedError, SmsNotInPlanError } from '../lib/twilioProvisioning';
import { evaluateConditions } from '../lib/automationEngine';
import { estParcours, regleSansRienAFaire } from '../lib/automationSequences';
import { horsFenetre } from '../lib/automationEngine';
import { fuseauOrg } from '../lib/automations-fuseau-org';
import type { CRMEvent } from '../lib/eventBus';

const router = Router();

function checkCronAuth(req: Request, res: Response): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    res.status(503).json({ error: 'CRON_SECRET not configured on server' });
    return false;
  }
  // Accept either Authorization: Bearer ... or x-cron-secret
  const header = req.headers['authorization'];
  let provided: string | null = null;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    provided = header.slice(7).trim();
  } else if (typeof req.headers['x-cron-secret'] === 'string') {
    provided = String(req.headers['x-cron-secret']);
  }
  if (!provided) {
    res.status(401).json({ error: 'Invalid cron secret' });
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Invalid cron secret' });
    return false;
  }
  return true;
}

interface ScheduleEntry {
  days_after_due: number;
  channel: 'email' | 'sms' | 'both';
  template_id?: string | null;
}

/**
 * Âge maximal d'une facture encore relançable, en jours.
 *
 * POURQUOI CE PLAFOND EXISTE
 * La sélection ne portait qu'une borne HAUTE (`due_date <= aujourd'hui - J`).
 * Toute facture plus vieille restait éligible pour TOUJOURS, et à chaque
 * palier du calendrier. Mesuré en production le 2026-09-25 : 4 factures en
 * retard de 138 à 173 jours × 4 paliers (J+1, J+7, J+14, J+30) = 16 messages
 * qui seraient partis la même nuit, au premier déclenchement du cron.
 *
 * Une facture oubliée depuis six mois ne se règle pas par une salve de
 * rappels : elle se règle à la main. Passé ce plafond, on ne relance plus.
 *
 * `REMINDER_MAX_AGE_DAYS=0` désactive le plafond (comportement d'avant).
 */
export const PLAFOND_RELANCE_JOURS_DEFAUT = 90;

export function plafondRelanceJours(env: NodeJS.ProcessEnv = process.env): number {
  const brut = env.REMINDER_MAX_AGE_DAYS?.trim();
  // Number(' ') vaut 0 : sans le trim, une variable laissée blanche
  // DÉSACTIVERAIT le plafond au lieu de retomber sur la valeur par défaut.
  if (brut === undefined || brut === '') return PLAFOND_RELANCE_JOURS_DEFAUT;
  const n = Number(brut);
  // Une valeur illisible ne doit pas SUPPRIMER le garde-fou en silence.
  if (!Number.isFinite(n) || n < 0) return PLAFOND_RELANCE_JOURS_DEFAUT;
  return Math.floor(n);
}

/**
 * Fenêtre de dates relançable pour un palier donné.
 *
 * Retourne `{ max }` seul si le plafond est désactivé, sinon `{ min, max }`.
 * `min` est la date d'échéance la plus ANCIENNE encore admise.
 */
export function fenetreRelance(
  aujourdHui: Date,
  joursApresEcheance: number,
  plafondJours: number,
): { min: string | null; max: string } {
  const jour = (d: Date) => d.toISOString().slice(0, 10);
  const haut = new Date(aujourdHui.getTime());
  haut.setUTCDate(haut.getUTCDate() - joursApresEcheance);
  if (plafondJours <= 0) return { min: null, max: jour(haut) };
  const bas = new Date(aujourdHui.getTime());
  bas.setUTCDate(bas.getUTCDate() - plafondJours);
  return { min: jour(bas), max: jour(haut) };
}

/* Textes par défaut du rappel, dans la langue de l'entreprise.
   Ils étaient en anglais en dur : une entreprise québécoise qui n'avait pas
   écrit son propre texte relançait ses clients en anglais. Le reste du courriel
   (titre, bouton, montant) suivait déjà `company_settings.default_language`.

   Le ton suit les maquettes validées : on n'accuse pas. Un client en retard est
   presque toujours distrait, et la phrase « si c'est déjà réglé, ce message se
   croise avec votre paiement » évite l'échange vexé qui suit un rappel sec.
   L'objet ne répète pas le nom de l'entreprise : l'expéditeur l'affiche déjà,
   et la place gagnée sert à faire tenir le montant avant la coupure. */
/** « Bonjour , » quand le nom manque → « Bonjour, ». */
function sansNomVide(texte: string): string {
  return texte.replace(/\b(Bonjour|Hello|Hi)\s+,/g, '$1,');
}

const DEFAUTS = {
  fr: {
    sujet: 'Facture {invoice_number} — il reste {amount_due}',
    corps:
      'Bonjour {client_name},\n\n' +
      /* Une phrase d'un seul tenant, pas trois morceaux concaténés : le
         catalogue doit pouvoir la citer TELLE QUELLE pour pré-remplir
         l'éditeur (tests/courriels/catalogue-courriels.test.ts vérifie la
         correspondance au mot près). Coupée en trois, elle obligeait à montrer
         un fragment illisible au propriétaire. */
      'Un petit rappel, sans plus : la facture {invoice_number} de {amount_due} était due le {due_date}. Si le paiement est déjà parti, ce message le croise — merci !\n\n' +
      'Vous pouvez la régler ici : {pay_url}\n\n' +
      'Un imprévu ? Répondez à ce courriel, on peut étaler le paiement.\n\n' +
      'Merci,\n{company_name}',
    sms: 'Rappel : facture {invoice_number} ({amount_due}), due le {due_date}. Régler : {pay_url}',
  },
  en: {
    sujet: 'Invoice {invoice_number} — {amount_due} outstanding',
    corps:
      'Hello {client_name},\n\n' +
      'A gentle reminder: invoice {invoice_number} for {amount_due} was due on {due_date}. If your payment is already on its way, this message crossed it — thank you!\n\n' +
      'You can pay here: {pay_url}\n\n' +
      'Something came up? Reply to this email — we can spread the payment.\n\n' +
      'Thank you,\n{company_name}',
    sms: 'Reminder: invoice {invoice_number} ({amount_due}) was due {due_date}. Pay: {pay_url}',
  },
} as const;

/**
 * Retire les lignes dont le lien a disparu.
 *
 * Quand Stripe Connect n'est pas configuré, `pay_url` est vide : sans ce
 * nettoyage le client lirait « Vous pouvez la régler ici : » suivi de rien,
 * et le SMS « Régler : ». La ligne n'a plus de raison d'être.
 */
/**
 * Une facture = UNE source de relances (launch 2026-09-28).
 *
 * Trois systèmes relançaient la même facture sans se parler : ce cron
 * (réglages « Rappels de paiement »), le parcours « Relance de facture » du
 * pack et toute automatisation « Facture en retard ». Le client recevait la
 * même relance deux ou trois fois. Quand une automatisation PUBLIÉE couvre
 * la facture, ce cron la laisse à l'automatisation :
 *   · une règle « Facture en retard » dont les conditions acceptent la facture ;
 *   · le parcours « Relance de facture » déjà engagé pour CETTE facture.
 * Lecture ratée = on ne sait pas : le cron relance comme avant (un doublon
 * possible vaut mieux qu'une facture jamais relancée).
 *
 * Retourne un prédicat par facture ; aucune requête de plus si l'entreprise
 * n'a aucune automatisation de relance.
 */
export async function couvertureAutomatisations(
  svc: { from: (t: string) => any },
  orgId: string,
  /** Le jour civil (« 2026-10-15 ») dont on compte le retard — celui du passage. */
  aujourdHui: string = new Date().toISOString().slice(0, 10),
): Promise<(inv: { id: string; status?: string | null; total_cents?: number | null; balance_cents?: number | null; invoice_number?: string | null; client_id?: string | null; due_date?: string | null }) => Promise<boolean>> {
  const { data: regles, error } = await svc
    .from('automation_rules')
    .select('id, trigger_event, preset_key, conditions, steps, actions')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .in('trigger_event', ['invoice.overdue', 'invoice.sent']);
  if (error) {
    logger.error('[cron/reminders] automatisations de relance illisibles — relance faite par le cron', { orgId, error: error.message });
    return async () => false;
  }
  type Regle = { id: string; trigger_event: string; preset_key: string | null; conditions: Record<string, unknown> | null; steps?: unknown; actions?: unknown };
  // Une automatisation qui n'exécute RIEN ne couvre aucune facture : un
  // parcours vidé de ses étapes (`steps = []`) garde son ancienne copie
  // `actions`, que le moteur ne lit pas — la tenir pour une relance ferait
  // taire le cron sans que personne ne relance.
  const actives = ((regles ?? []) as Regle[]).filter((r) => !(estParcours(r) && regleSansRienAFaire(r)));
  const enRetard = actives.filter((r) => r.trigger_event === 'invoice.overdue');
  const pack = actives.filter((r) => r.preset_key === 'pack_relance_facture').map((r) => r.id);
  if (!enRetard.length && !pack.length) return async () => false;

  return async (inv) => {
    /* `days_overdue` et `due_date` : ce que porte le VRAI événement
       « Facture en retard » (scheduler.ts). Sans eux, une règle « en retard
       d'au moins 3 jours » était jugée sur un champ absent — donc fausse — et
       le cron relançait une facture que l'automatisation relance aussi : au
       30e jour, les deux le même jour. */
    const echeance = inv.due_date ? String(inv.due_date).slice(0, 10) : null;
    const retard = echeance
      ? Math.round((Date.parse(`${aujourdHui}T00:00:00Z`) - Date.parse(`${echeance}T00:00:00Z`)) / 86_400_000)
      : null;
    const metadata = {
      status: inv.status ?? null, total_cents: inv.total_cents ?? null, balance_cents: inv.balance_cents ?? null,
      montant: Number(inv.balance_cents ?? 0) / 100, invoice_number: inv.invoice_number ?? null, client_id: inv.client_id ?? null,
      ...(retard !== null && Number.isFinite(retard) ? { days_overdue: retard, due_date: echeance } : {}),
    };
    const evenement = { type: 'invoice.overdue', orgId, entityType: 'invoice', entityId: inv.id, metadata } as CRMEvent;
    if (enRetard.some((r) => evaluateConditions((r.conditions ?? {}) as Record<string, any>, evenement))) return true;
    if (pack.length) {
      const { data, error: errTaches } = await svc
        .from('automation_scheduled_tasks')
        .select('id')
        .eq('org_id', orgId)
        .eq('entity_id', inv.id)
        .in('automation_rule_id', pack)
        .limit(1);
      if (errTaches) {
        logger.error('[cron/reminders] parcours de relance illisible — relance faite par le cron', { orgId, invoiceId: inv.id, error: errTaches.message });
        return false;
      }
      if ((data?.length ?? 0) > 0) return true;
    }
    return false;
  };
}

export function nettoyerLiensMorts(texte: string): string {
  return texte
    .split('\n')
    // Une ligne qui finit par « : » après substitution annonçait un lien qui
    // n'est jamais venu.
    .filter((ligne) => !/:\s*$/.test(ligne.trimEnd()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* Figé sur `en-CA`, il rendait « $1,220.17 » dans un rappel par ailleurs
   entièrement français — la francisation du fichier avait oublié l'argent.
   Le même montant repart ensuite dans la carte du gabarit et dans le SMS. */
function formatMoney(cents: number, currency = 'CAD', langue: 'fr' | 'en' = 'fr') {
  try {
    return new Intl.NumberFormat(langue === 'fr' ? 'fr-CA' : 'en-CA', { style: 'currency', currency }).format((cents || 0) / 100);
  } catch {
    return `$${((cents || 0) / 100).toFixed(2)}`;
  }
}

function htmlEscape(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function bodyToHtml(text: string) {
  return htmlEscape(text).replace(/\n/g, '<br/>');
}

/**
 * Écrit la ligne de journal du rappel.
 *
 * C'est elle qui porte l'idempotence : le passage suivant du cron cherche
 * (invoice_id, days_after_due, channel) dans `reminder_log` pour savoir s'il
 * doit relancer. Si l'insert échoue et que l'erreur est avalée, le client
 * reçoit la MÊME relance à chaque exécution du cron — l'échec doit donc être
 * visible dans le rapport de la tâche.
 */
async function insertReminderLog(
  svc: ReturnType<typeof getServiceClient>,
  row: Record<string, unknown>,
  errors: Array<{ invoice_id?: string; error: string }>,
): Promise<void> {
  const { error } = await svc.from('reminder_log').insert(row);
  if (error) {
    console.error('[cron/reminders] reminder_log insert failed — reminder will be re-sent:', {
      invoice_id: row.invoice_id,
      days_after_due: row.days_after_due,
      channel: row.channel,
      error: error.message,
    });
    errors.push({
      invoice_id: String(row.invoice_id || ''),
      error: `reminder_log insert failed (duplicate sends ahead): ${error.message}`,
    });
  }
}

/** Une facture candidate à la relance (les colonnes lues par le cron). */
interface FactureARelancer {
  id: string; org_id: string; client_id: string | null; invoice_number: string | null;
  total_cents: number | null; balance_cents: number | null; currency: string | null;
  due_date: string | null; status: string; subject: string | null;
}

/** Factures lues par page (PostgREST plafonne une réponse à 1 000 lignes). */
export const PAGE_FACTURES = 500;
/** Garde-fou d'un passage : au plus 40 pages — 20 000 factures — par palier et par entreprise. */
export const PAGES_MAX_PAR_PALIER = 40;

/**
 * Lit une requête page après page, jusqu'à la dernière (une page incomplète).
 *
 * `lirePage(de, a)` doit rendre les lignes `de`…`a` d'une requête ORDONNÉE de
 * façon stable (sinon deux pages peuvent rendre la même ligne et en oublier
 * une autre). Une erreur arrête la lecture : les lignes déjà lues sont
 * rendues avec l'erreur — à l'appelant de dire quoi en faire.
 */
export async function lireToutesLesPages<T>(
  lirePage: (de: number, a: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  taille: number = PAGE_FACTURES,
  pagesMax: number = PAGES_MAX_PAR_PALIER,
): Promise<{ lignes: T[]; erreur: string | null; tronque: boolean }> {
  const lignes: T[] = [];
  for (let page = 0; page < pagesMax; page++) {
    const { data, error } = await lirePage(page * taille, page * taille + taille - 1);
    if (error) return { lignes, erreur: error.message, tronque: false };
    const lot = (Array.isArray(data) ? data : []) as T[];
    lignes.push(...lot);
    if (lot.length < taille) return { lignes, erreur: null, tronque: false };
  }
  return { lignes, erreur: null, tronque: true };
}

/**
 * Un passage des relances de factures. Exporté pour la suite d'intégration :
 * `orgId` borne le passage à UNE entreprise (bureau de test), comme
 * processScheduledTasks(supabase, { orgId }) — sans lui, un test relancerait
 * les factures de toutes les entreprises de staging. La route cron l'appelle
 * sans `orgId`, sous verrou.
 */
/** Première heure de la fenêtre d'envoi par défaut (8 h, heure de l'entreprise). */
export const PREMIERE_HEURE_ENVOI = 8;

function heureLocale(d: Date, fuseau: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: fuseau, hour: '2-digit', hour12: false }).format(d)) % 24;
}

export async function executerRelancesPaiement(opts: {
  publicBase: string; orgId?: string; aujourdHui?: Date;
  /** Passage horaire du planificateur : ne traiter une entreprise qu'à sa première heure d'envoi. */
  premiereHeureSeulement?: boolean;
}): Promise<{
  ok: true; processed: number; sent: number; failed: number; errors: Array<{ invoice_id?: string; error: string }>;
  /** Entreprises sautées : hors de leur fenêtre d'envoi (elles seront relancées au passage horaire suivant). */
  hors_fenetre: number;
}> {
  const svc = getServiceClient();
  const publicBase = opts.publicBase;
  let processed = 0;
  let sent = 0;
  let failed = 0;
  const errors: Array<{ invoice_id?: string; error: string }> = [];

  // 1. Load orgs with reminders enabled
  let lectureReglages = svc
    .from('reminder_settings')
    .select('org_id, schedule, custom_email_subject, custom_email_body, custom_sms_body, enabled')
    .eq('enabled', true);
  if (opts.orgId) lectureReglages = lectureReglages.eq('org_id', opts.orgId);
  const { data: settingsRows, error: settingsErr } = await lectureReglages;
  // On LÈVE : répondre ici (sendSafeError) puis laisser la route répondre
  // aussi envoyait la réponse HTTP deux fois (« headers already sent »).
  if (settingsErr) throw new Error(`Failed to load reminder settings: ${settingsErr.message}`);

  const today = opts.aujourdHui ?? new Date();
  const plafond = plafondRelanceJours();
  /** Entreprises sautées à ce passage : hors de leur fenêtre d'envoi. */
  let horsFenetreEnvoi = 0;

  for (const settings of settingsRows || []) {
    const orgId: string = settings.org_id;
    const schedule = Array.isArray(settings.schedule) ? (settings.schedule as ScheduleEntry[]) : [];
    if (!schedule.length) continue;

    /*
     * Fenêtre d'envoi (mission finale, point 11) : une relance de paiement est
     * un message AU CLIENT — elle ne part qu'entre 8 h et 20 h, heure de
     * l'ENTREPRISE. Le cron tourne à 13:00 UTC pour tout le monde : 9 h à
     * Montréal l'été, 8 h l'hiver… et 5 h à Vancouver (B-08). Hors fenêtre,
     * l'entreprise est sautée à ce passage ; rien n'est perdu : le journal
     * `reminder_log` porte l'idempotence, et le tick du planificateur
     * repasse chaque heure (scheduler.ts) — elle est relancée à sa première
     * heure ouvrable.
     */
    const fuseau = await fuseauOrg(svc, orgId);
    if (horsFenetre(null, today, fuseau)) {
      horsFenetreEnvoi++;
      continue;
    }
    // Passage horaire du tick : une entreprise n'y est traitée qu'à sa
    // PREMIÈRE heure d'envoi (8 h, chez elle) — une fois par jour, pas douze.
    if (opts.premiereHeureSeulement && heureLocale(today, fuseau) !== PREMIERE_HEURE_ENVOI) continue;

    // Fetch company branding for templating
    const { data: orgSettings } = await svc
      .from('company_settings')
      .select('company_name, email, phone')
      .eq('org_id', orgId)
      .maybeSingle();
    // Plus de repli « Your service provider » : une org francophone sans nom
    // signait son rappel en anglais. Sans nom, on n'en invente pas.
    const companyName = orgSettings?.company_name || '';
    // Une facture déjà relancée par une automatisation publiée n'est pas relancée ici.
    const couverteParAutomatisation = await couvertureAutomatisations(svc, orgId, today.toISOString().slice(0, 10));

    // Paliers du plus HAUT au plus bas : une facture n'est relancée qu'au
    // palier le plus élevé qu'elle a atteint. Avant, la fenêtre de chaque
    // palier ([J-90 ; J-palier]) contenait aussi les factures plus vieilles :
    // une facture en retard de 40 jours recevait J+1, J+7, J+14 ET J+30 le
    // même soir (4 courriels), et l'index unique du journal (1 ligne par
    // facture, jour et canal) refusait les 3 dernières APRÈS l'envoi — les
    // paliers non journalisés repartaient le lendemain.
    const paliers = [...schedule].sort((x, y) => Number(y.days_after_due) - Number(x.days_after_due));
    const palierAtteint = new Map<string, number>();

    // For each schedule entry, find candidate invoices
    for (const entry of paliers) {
      const daysAfter = Number(entry.days_after_due);
      const channel = entry.channel;
      if (!Number.isFinite(daysAfter) || daysAfter < 0) continue;
      if (!['email', 'sms', 'both'].includes(channel)) continue;

      const fenetre = fenetreRelance(today, daysAfter, plafond);

      /*
       * TOUTES les factures du palier, page par page, dans un ordre STABLE
       * (B-22). Avant : `.limit(500)` sans ordre — toujours les mêmes 500
       * lignes. Une fois celles-ci relancées, chaque passage les relisait,
       * les sautait (déjà au journal), et la 501e facture en retard n'était
       * jamais lue : son client n'était jamais relancé.
       */
      const lirePage = (de: number, a: number) => {
        let requete = svc
          .from('invoices')
          .select('id, org_id, client_id, invoice_number, total_cents, balance_cents, currency, due_date, status, subject')
          .eq('org_id', orgId)
          .in('status', ['sent', 'partial'])
          // Une facture à la CORBEILLE garde son statut « envoyée » : sans ce
          // filtre, son client recevait quand même le rappel (M-25).
          .is('deleted_at', null)
          .lte('due_date', fenetre.max)
          .gt('balance_cents', 0);
        // Borne basse : au-delà du plafond, on ne relance plus (voir
        // PLAFOND_RELANCE_JOURS_DEFAUT).
        if (fenetre.min) requete = requete.gte('due_date', fenetre.min);
        return requete.order('due_date', { ascending: true }).order('id', { ascending: true }).range(de, a);
      };
      const lecture = await lireToutesLesPages<FactureARelancer>(lirePage);
      const invoices = lecture.lignes;
      if (lecture.erreur) {
        // Ce qui a été lu avant l'erreur est traité (le journal porte
        // l'idempotence) ; le reste le sera au passage suivant.
        errors.push({ error: `load invoices org=${orgId}: ${lecture.erreur}` });
        if (!invoices.length) continue;
      }
      if (lecture.tronque) {
        logger.warn('[cron/reminders] palier tronqué : plus de factures en retard que le plafond d’un passage', {
          orgId, daysAfter, lues: invoices.length,
        });
      }

      for (const inv of invoices) {
        // Un palier plus haut a déjà traité cette facture pendant ce passage
        // (relancée, déjà relancée un autre jour, ou couverte par une automatisation).
        const dejaAtteint = palierAtteint.get(inv.id);
        if (dejaAtteint !== undefined && dejaAtteint > daysAfter) continue;
        palierAtteint.set(inv.id, daysAfter);
        processed++;
        try {
          // Dedupe: check log for (invoice_id, days_after_due, channel)
          const { data: logged } = await svc
            .from('reminder_log')
            .select('id')
            .eq('invoice_id', inv.id)
            .eq('days_after_due', daysAfter)
            .eq('channel', channel)
            .maybeSingle();
          if (logged) continue;
          if (await couverteParAutomatisation(inv)) {
            logger.info('[cron/reminders] facture relancée par une automatisation publiée — cron sauté', { orgId, invoiceId: inv.id, daysAfter });
            continue;
          }

          // Fetch client contact
          const { data: client } = await svc
            .from('clients')
            .select('id, first_name, last_name, email, phone')
            .eq('id', inv.client_id)
            .maybeSingle();
          // Pas de nom : pas de « Customer » anglais dans un courriel français —
          // la salutation devient « Bonjour, » (voir `sansNomVide`).
          const clientName = [client?.first_name, client?.last_name].filter(Boolean).join(' ');
          const toEmail = (client?.email || '').trim();
          const toPhone = (client?.phone || '').trim();

          // Build/find pay link (reuses existing pending request when available)
          /* VIDE, pas `/dashboard`. Le repli envoyait le client final vers le
             tableau de bord du CRM, une page a laquelle il n'a aucun acces.
             Le bouton etait bien masque, mais la phrase « Vous pouvez la
             regler ici : {pay_url} » du corps ET le SMS portaient ce lien
             mort. Vide, `nettoyerLiensMorts` retire la phrase entiere. */
          let payUrl = '';
          try {
            const pr = await createPaymentRequest({
              orgId,
              invoiceId: inv.id,
              amountCents: Number(inv.balance_cents || 0),
              currency: String(inv.currency || 'CAD'),
            });
            const token = (pr as any)?.public_token;
            if (token) payUrl = `${publicBase}/pay/${token}`;
          } catch (e: any) {
            // Stripe Connect not set up — fall back to generic dashboard link.
            console.warn('[cron/reminders] payment request create failed:', e?.message);
          }

          const societe = await getCompanySettings(orgId);
          const langueRappel = langueEntreprise(societe);
          const vars = {
            client_name: clientName,
            company_name: companyName,
            // Jamais un morceau d'identifiant interne à la place du numéro (objet).
            invoice_number: inv.invoice_number || '',
            amount_due: formatMoney(Number(inv.balance_cents || 0), String(inv.currency || 'CAD'), langueRappel),
            /* Passait la date ISO BRUTE : le client lisait « était due le
               2026-04-24 » dans le texte ET dans le SMS, alors que la carte
               du même courriel affichait « 24 avril 2026 ». */
            due_date: dateLisible(inv.due_date, langueRappel),
            pay_url: payUrl,
          };

          // EMAIL leg
          // Une adresse qui a rebondi ne sera pas relancée : ça ne sert à
          // rien et ça abîme la réputation du domaine (audit QA n°8). Le
          // propriétaire a reçu une notification « courriel non livré ».
          const adresseMorte = toEmail ? await adresseInjoignable(orgId, toEmail) : false;
          if (adresseMorte) logger.warn('[reminders] adresse injoignable, relance courriel sautée', { invoiceId: inv.id, email: toEmail });

          /* Les réglages de l'entreprise se lisent UNE fois pour les deux
             canaux : le courriel et le SMS en ont tous deux besoin, et c'est
             une requête, pas un cache. Ils portent la langue, dont dépendent
             désormais les textes par défaut — ils étaient anglais en dur, donc
             une entreprise québécoise sans texte à elle relançait ses clients
             en anglais. */
          const defauts = DEFAUTS[langueRappel];

          if ((channel === 'email' || channel === 'both') && toEmail && !adresseMorte && isMailerConfigured()) {
            /* Trois sources de texte, dans cet ordre :
                 1. le modèle « invoice_reminder » de la page Modèles ;
                 2. le texte des réglages de rappel (custom_email_*, historique) ;
                 3. DEFAUTS[langue].
               Le modèle passe en premier : c'est l'écran où une entreprise
               écrit désormais ses textes. Les réglages de rappel restent
               honorés pour ne rien casser chez celles qui les ont remplis.
               Sans ni l'un ni l'autre, le rappel sort mot pour mot comme
               aujourd'hui.

               Quoi qu'il arrive, le montant, le bouton « payer », les numéros
               de taxes et le pied restent posés par le gabarit : un rappel ne
               peut pas partir sans le moyen de régler la facture. */
            const modeleOrg = await texteDuCourriel(orgId, 'invoice_reminder', vars, undefined,
              { invoice: inv.id, client: inv.client_id ?? null });
            const subject = modeleOrg?.sujet || applyTemplate(settings.custom_email_subject || defauts.sujet, vars);
            const body = nettoyerLiensMorts(sansNomVide(applyTemplate(settings.custom_email_body || defauts.corps, vars)));
            // Le texte du rappel (celui de l'entreprise ou le défaut) dans le gabarit commun, avec le montant en carte et le bouton payer.
            const html = rendreCourrielClient({
              langue: langueRappel,
              marque: marqueDepuis(societe),
              preheader: `${vars.amount_due} — ${langueRappel === 'fr' ? 'facture' : 'invoice'} ${vars.invoice_number}`,
              titre: langueRappel === 'fr' ? 'Rappel de paiement' : 'Payment reminder',
              corpsHtml: modeleOrg?.corpsHtml || bodyToHtml(body),
              // `vars.due_date` est DÉJÀ lisible : la repasser à dateLisible
              // la ferait traverser un Date() qui ne sait pas la relire.
              montant: { libelle: MOTS[langueRappel].montantDu, valeur: vars.amount_due, sous: vars.due_date ? `${MOTS[langueRappel].echeance} : ${vars.due_date}` : null },
              bouton: payUrl.includes('/pay/') ? { texte: MOTS[langueRappel].payer(vars.amount_due), url: payUrl } : null,
              note: MOTS[langueRappel].question,
              // Le texte du rappel porte déjà sa signature (« Merci, {company_name} ») : pas de deuxième.
              signature: null,
            });
            // Envoi de fond : un échec transitoire part dans la file de reprise plutôt que d'être perdu.
            const result = await sendEmail({ ...(await senderForOrg(orgId, societe)), to: toEmail, subject, html, suivi: { orgId, entityType: 'reminder', entityId: inv.id }, reessayer: true });
            const emailChannel = channel === 'email' ? 'email' : 'both';
            if (channel === 'both') {
              // For 'both', defer logging until SMS attempted (single row with channel='both').
            } else {
              await insertReminderLog(svc, {
                org_id: orgId,
                invoice_id: inv.id,
                days_after_due: daysAfter,
                channel: emailChannel,
                sent_to: toEmail,
                status: result.sent ? 'sent' : 'failed',
                error_message: result.sent ? null : (result.error || 'send failed'),
              }, errors);
              if (result.sent) sent++;
              else failed++;
            }
            // For 'both' track partial via variable below
            (inv as any)._email_result = result;
          }

          // SMS leg — strictly the org's OWN number. No shared fallback: sending
          // a tenant's invoice reminder from the platform number leaks identity
          // across orgs, and skips the plan gate. Skip the SMS leg instead.
          let orgFromNumber: string | null = null;
          // Conformité CASL : ne pas relancer par SMS un client qui a
          // répondu STOP. Les relances automatiques contournaient la liste.
          const smsOptedOut = toPhone
            ? await isSmsOptedOut(svc, orgId, normalizeE164(toPhone))
            : false;
          if (twilioClient && (channel === 'sms' || channel === 'both') && toPhone && !smsOptedOut) {
            try {
              orgFromNumber = await getOrgSmsFromNumber(orgId);
            } catch (e) {
              if (e instanceof SmsNumberNotProvisionedError || e instanceof SmsNotInPlanError) {
                console.warn(`[reminders-cron] Skipping SMS for org ${orgId}: ${(e as Error).name}`);
                orgFromNumber = null;
              } else {
                throw e;
              }
            }
          }
          if ((channel === 'sms' || channel === 'both') && toPhone && twilioClient && orgFromNumber) {
            // Même règle que le courriel : le texte par défaut suit la langue
            // de l'entreprise, lue une seule fois plus haut.
            const smsBody = nettoyerLiensMorts(applyTemplate(settings.custom_sms_body || defauts.sms, vars));
            // `sendSmsIfConfigured` ne lève jamais : le try/catch qui entourait
            // cet appel était inatteignable, `smsOk` restait donc toujours à
            // true et un échec Twilio était journalisé comme 'sent'. On lit
            // maintenant le résultat réel.
            const smsRes = await sendSmsIfConfigured(
              { client: twilioClient, phoneNumber: orgFromNumber },
              toPhone,
              smsBody,
            );
            const smsOk = smsRes.sent;
            const smsErr = smsRes.sent ? null : (smsRes.error || smsRes.reason || 'sms failed');
            if (channel === 'sms') {
              await insertReminderLog(svc, {
                org_id: orgId,
                invoice_id: inv.id,
                days_after_due: daysAfter,
                channel: 'sms',
                sent_to: toPhone,
                status: smsOk ? 'sent' : 'failed',
                error_message: smsErr,
              }, errors);
              if (smsOk) sent++; else failed++;
            } else {
              // 'both' — combine results, single row
              const emailRes = (inv as any)._email_result;
              const ok = (emailRes?.sent ?? false) || smsOk;
              const sentTo = [toEmail, toPhone].filter(Boolean).join(' / ');
              await insertReminderLog(svc, {
                org_id: orgId,
                invoice_id: inv.id,
                days_after_due: daysAfter,
                channel: 'both',
                sent_to: sentTo || 'unknown',
                status: ok ? 'sent' : 'failed',
                error_message: ok ? null : (smsErr || emailRes?.error || 'both channels failed'),
              }, errors);
              if (ok) sent++; else failed++;
            }
          } else if (channel === 'both' && (inv as any)._email_result) {
            // SMS was unavailable; record what email did
            const emailRes = (inv as any)._email_result;
            await insertReminderLog(svc, {
              org_id: orgId,
              invoice_id: inv.id,
              days_after_due: daysAfter,
              channel: 'both',
              sent_to: toEmail || 'unknown',
              status: emailRes?.sent ? 'sent' : 'failed',
              error_message: emailRes?.sent ? null : (emailRes?.error || 'sms unavailable'),
            }, errors);
            if (emailRes?.sent) sent++; else failed++;
          } else if (channel === 'sms') {
            // Canal SMS seul, mais rien n'a pu être envoyé : pas de numéro
            // chez le client, Twilio non configuré, ou org sans numéro
            // provisionné / hors forfait.
            //
            // Sans cette branche, AUCUNE ligne n'était écrite dans
            // `reminder_log` : la dédup ne trouvait rien au passage suivant
            // et le cron re-tentait la même relance indéfiniment, à chaque
            // exécution, sans que ni le compteur `sent` ni `failed` ne
            // bougent. On trace donc l'échec pour fermer la boucle.
            const reason = !toPhone
              ? 'client has no phone number'
              : smsOptedOut
                ? 'recipient opted out of SMS (STOP)'
                : !twilioClient
                  ? 'twilio not configured'
                  : 'org has no provisioned SMS number (or plan excludes SMS)';
            await insertReminderLog(svc, {
              org_id: orgId,
              invoice_id: inv.id,
              days_after_due: daysAfter,
              channel: 'sms',
              sent_to: toPhone || 'unknown',
              status: 'failed',
              error_message: reason,
            }, errors);
            failed++;
          }
        } catch (e: any) {
          failed++;
          errors.push({ invoice_id: inv.id, error: e?.message || 'unknown' });
          console.error('[cron/reminders] invoice error:', inv.id, e?.message);
        }
      }
    }
  }

  return {
    ok: true,
    processed,
    sent,
    failed,
    errors: errors.slice(0, 20),
    hors_fenetre: horsFenetreEnvoi,
  };
}

router.post('/cron/payment-reminders', async (req, res) => {
  if (!checkCronAuth(req, res)) return;

  let publicBase = '';
  try {
    publicBase = resolvePublicBaseUrl(req);
  } catch (e: any) {
    return sendSafeError(res, e, 'Server PUBLIC_URL not configured.', '[cron/reminders]');
  }

  // Verrou d'exclusion mutuelle : ce cron est un endpoint HTTP externe qui peut
  // double-tirer (scheduler qui relance, retry après timeout). Sans lui, deux
  // exécutions concurrentes passent toutes deux le SELECT de dédup avant que
  // l'INSERT ne bloque — et envoient toutes deux le courriel/SMS (l'index UNIQUE
  // protège la LIGNE, pas l'ENVOI). Le lock garantit un seul run à la fois.
  const { withAdvisoryLock } = await import('../lib/advisory-lock');
  try {
  const verrou = await withAdvisoryLock('cron-payment-reminders', () => executerRelancesPaiement({ publicBase }));

  if (!verrou.acquired) {
    // Un autre passage du cron tient déjà le verrou : rien à faire, ce n'est
    // pas une erreur (évite le double-envoi).
    return res.json({ ok: true, skipped: 'already_running' });
  }
  return res.json(verrou.result);
  } catch (error: any) {
    return sendSafeError(res, error, 'Cron job failed.', '[cron/reminders]');
  }
});

export default router;
