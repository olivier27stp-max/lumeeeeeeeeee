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

router.post('/cron/payment-reminders', async (req, res) => {
  if (!checkCronAuth(req, res)) return;
  const svc = getServiceClient();

  let processed = 0;
  let sent = 0;
  let failed = 0;
  const errors: Array<{ invoice_id?: string; error: string }> = [];

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
  const verrou = await withAdvisoryLock('cron-payment-reminders', async () => {
    // 1. Load orgs with reminders enabled
    const { data: settingsRows, error: settingsErr } = await svc
      .from('reminder_settings')
      .select('org_id, schedule, custom_email_subject, custom_email_body, custom_sms_body, enabled')
      .eq('enabled', true);
    if (settingsErr) return sendSafeError(res, settingsErr, 'Failed to load reminder settings.', '[cron/reminders]');

    const today = new Date();
    const plafond = plafondRelanceJours();

    for (const settings of settingsRows || []) {
      const orgId: string = settings.org_id;
      const schedule = Array.isArray(settings.schedule) ? (settings.schedule as ScheduleEntry[]) : [];
      if (!schedule.length) continue;

      // Fetch company branding for templating
      const { data: orgSettings } = await svc
        .from('company_settings')
        .select('company_name, email, phone')
        .eq('org_id', orgId)
        .maybeSingle();
      // Plus de repli « Your service provider » : une org francophone sans nom
      // signait son rappel en anglais. Sans nom, on n'en invente pas.
      const companyName = orgSettings?.company_name || '';

      // For each schedule entry, find candidate invoices
      for (const entry of schedule) {
        const daysAfter = Number(entry.days_after_due);
        const channel = entry.channel;
        if (!Number.isFinite(daysAfter) || daysAfter < 0) continue;
        if (!['email', 'sms', 'both'].includes(channel)) continue;

        const fenetre = fenetreRelance(today, daysAfter, plafond);

        let requete = svc
          .from('invoices')
          .select('id, org_id, client_id, invoice_number, total_cents, balance_cents, currency, due_date, status, subject')
          .eq('org_id', orgId)
          .in('status', ['sent', 'partial'])
          .lte('due_date', fenetre.max)
          .gt('balance_cents', 0);
        // Borne basse : au-delà du plafond, on ne relance plus (voir
        // PLAFOND_RELANCE_JOURS_DEFAUT).
        if (fenetre.min) requete = requete.gte('due_date', fenetre.min);
        const { data: invoices, error: invErr } = await requete.limit(500);
        if (invErr) {
          errors.push({ error: `load invoices org=${orgId}: ${invErr.message}` });
          continue;
        }

        for (const inv of invoices || []) {
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

            // Fetch client contact
            const { data: client } = await svc
              .from('clients')
              .select('id, first_name, last_name, email, phone')
              .eq('id', inv.client_id)
              .maybeSingle();
            const clientName = [client?.first_name, client?.last_name].filter(Boolean).join(' ') || 'Customer';
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
              invoice_number: inv.invoice_number || inv.id.slice(0, 8),
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
              const body = nettoyerLiensMorts(applyTemplate(settings.custom_email_body || defauts.corps, vars));
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
    };
  }); // fin withAdvisoryLock (le finally interne libère toujours le verrou)

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
