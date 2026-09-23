import nodemailer from 'nodemailer';
import { redirigerEmail } from './qa-redirect';
import { logger } from './logger';
import { getServiceClient } from './supabase';
import { destinataireGele, journaliserBlocage, MESSAGE_GEL } from './migration/gel-communications';
import { htmlVersTextePourEnvoi } from './courriels/texte';
import { planifierPremiereReprise, TABLE_REPRISES } from './courriels/reprises';
import { reglagesSmtpSes, sesConfigure, messageIdSes } from './courriels/ses';

/**
 * Centralized email sender.
 *
 * Trois fournisseurs, choisis par l'environnement (voir `fournisseurCourriel`) :
 *
 *   COURRIEL_FOURNISSEUR=ses → Amazon SES par SMTP (courriels/ses.ts). Le
 *     moins cher à gros volume (~0,10 $ US / 1 000). Attention : SES démarre
 *     en bac à sable (200/jour) tant qu'Amazon n'a pas accordé la
 *     « production access ». Rebonds et suivi arrivent par SNS sur
 *     POST /api/webhooks/ses.
 *
 *   RESEND_API_KEY présent → API Resend (https://resend.com), domaine
 *     lumecrm.net avec SPF / DKIM / DMARC, webhooks de rebond captés par
 *     POST /api/webhooks/email. C'est le chemin de production visé.
 *
 *   sinon → SMTP (Gmail par défaut). Audit QA 2026-09-09, n°8 : un seul
 *     compte Gmail pour tout le transactionnel de tous les clients — plafond
 *     ~500 destinataires/jour, expéditeur @gmail.com, et AUCUN rebond capté :
 *     une adresse mal saisie donnait une facture « envoyée, en attente de
 *     paiement » pour toujours.
 *
 * Quel que soit le fournisseur, chaque envoi laisse une ligne dans
 * `email_deliveries` (statut `sent`), que le webhook fait évoluer. L'interface
 * lit la dernière ligne d'une entité pour afficher « courriel non livré », et
 * les relances sautent une adresse qui a rebondi.
 *
 * Env :
 *   COURRIEL_FOURNISSEUR — ses | resend | smtp (sinon : automatique)
 *   SES_SMTP_USER / SES_SMTP_PASS / SES_REGION — Amazon SES
 *   RESEND_API_KEY — active Resend
 *   EMAIL_FROM     — expéditeur par défaut (ex. "Lume CRM <factures@lumecrm.net>")
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS — repli SMTP
 */

let transporter: nodemailer.Transporter | null = null;
let transporteurSes: nodemailer.Transporter | null = null;

/**
 * Transport SES : le SMTP d'Amazon, pas un SDK. Séparé du transport SMTP
 * générique pour que les deux puissent coexister (SES en principal, Gmail en
 * repli local) sans se marcher dessus.
 */
function getTransporteurSes(): nodemailer.Transporter {
  if (transporteurSes) return transporteurSes;
  const reglages = reglagesSmtpSes();
  if (!reglages) throw new Error('SES demandé mais SES_SMTP_USER / SES_SMTP_PASS manquent.');
  transporteurSes = nodemailer.createTransport({ ...reglages, pool: true, maxConnections: 5, maxMessages: 100 });
  logger.info('[mailer] transport SES prêt', { host: reglages.host });
  return transporteurSes;
}

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    throw new Error('[mailer] SMTP_USER and SMTP_PASS are required. Set them in .env.local');
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  logger.info(`[mailer] SMTP transport ready (${host}:${port})`);
  return transporter;
}

export type FournisseurCourriel = 'ses' | 'resend' | 'smtp';

/**
 * Qui envoie. `COURRIEL_FOURNISSEUR` tranche (ses | resend | smtp) ; sinon
 * l'ordre naturel : SES s'il est configuré, sinon Resend, sinon SMTP.
 *
 * Pourquoi une variable plutôt qu'une simple présence de clés : SES démarre
 * en bac à sable (200 courriels/jour). Tant qu'Amazon n'a pas accordé la
 * « production access », on veut pouvoir tout préparer — identifiants en
 * place, envois de test — SANS que la production bascule. Le jour J, une
 * variable sur Railway suffit, sans redéploiement de code.
 *
 * Un fournisseur demandé mais non configuré est ignoré : mieux vaut envoyer
 * par l'ancien chemin que ne pas envoyer du tout.
 */
export function fournisseurCourriel(env: NodeJS.ProcessEnv = process.env): FournisseurCourriel {
  const demande = String(env.COURRIEL_FOURNISSEUR || '').trim().toLowerCase();
  if (demande === 'ses' && sesConfigure(env)) return 'ses';
  if (demande === 'resend' && String(env.RESEND_API_KEY || '').trim()) return 'resend';
  if (demande === 'smtp') return 'smtp';
  /* SES n'est JAMAIS choisi tout seul — c'est tout l'objet du paragraphe
     ci-dessus, et la ligne `if (sesConfigure(env)) return 'ses'` qui vivait
     ici le contredisait. Poser les identifiants SES pour préparer la bascule
     aurait suffi à détourner TOUS les envois vers un compte encore en bac à
     sable (200 courriels/jour, et il refuse toute adresse non vérifiée).
     La bascule reste `COURRIEL_FOURNISSEUR=ses`, le jour où Amazon accorde la
     « production access ». */
  // `.trim()` : une variable posée à « » sur Railway est VRAIE en JavaScript.
  // Sans cela on bascule sur Resend avec une clé inutilisable, et chaque envoi
  // échoue en 401 au lieu de retomber proprement sur le SMTP.
  return String(env.RESEND_API_KEY || '').trim() ? 'resend' : 'smtp';
}

/**
 * Pourquoi le SMTP sert alors qu'une clé Resend existe — `null` si tout va bien.
 *
 * Incident du 2026-09-22 : `RESEND_API_KEY` était posée sur Railway et les 37
 * envois partaient quand même par SMTP. Le SMTP ne renvoie AUCUN accusé, donc
 * ouvertures, clics et rebonds restaient à zéro. Invisible, jusqu'à ce qu'on
 * pense à lire la colonne `provider` d'`email_deliveries`.
 *
 * Les deux causes se corrigent différemment : une variable qui force le SMTP
 * se retire, une clé vide se repose. D'où deux messages distincts.
 */
export function raisonSmtpMalgreResend(env: NodeJS.ProcessEnv = process.env): string | null {
  if (fournisseurCourriel(env) !== 'smtp') return null;
  const demande = String(env.COURRIEL_FOURNISSEUR || '').trim().toLowerCase();
  const cle = String(env.RESEND_API_KEY || '').trim();

  if (demande === 'smtp' && cle) {
    return 'COURRIEL_FOURNISSEUR=smtp force l’ancien chemin alors que RESEND_API_KEY existe — retirer cette variable pour récupérer le suivi';
  }
  if (env.RESEND_API_KEY !== undefined && !cle) {
    return 'RESEND_API_KEY est déclarée mais vide — aucun accusé de réception ne reviendra';
  }
  return null;
}

/**
 * Ce qui empêcherait SES de rapporter quoi que ce soit — `null` si tout va bien.
 *
 * SES peut envoyer parfaitement sans publier le moindre évènement. Deux
 * réglages y suffisent, et leur absence ne produit AUCUNE erreur : les
 * courriels partent, rien ne remonte, et on cherche le défaut ailleurs
 * pendant des jours.
 */
export function raisonSesSansSuivi(env: NodeJS.ProcessEnv = process.env): string | null {
  if (fournisseurCourriel(env) !== 'ses') return null;

  if (!String(env.SES_CONFIGURATION_SET || '').trim()) {
    return 'SES_CONFIGURATION_SET manque — Amazon enverra les courriels mais ne publiera ni livraison, ni ouverture, ni rebond';
  }
  if (!String(env.SES_WEBHOOK_TOKEN || '').trim()) {
    return 'SES_WEBHOOK_TOKEN manque — la route /api/webhooks/ses refusera les notifications SNS';
  }

  /* Une valeur PRÉSENTE mais absurde, c'est le même effet qu'absente — en
     pire, parce que le diagnostic disait « tout va bien ».

     Vécu le 2026-09-22 : deux variables gardaient la valeur temporaire « a »
     posée pour contourner le refus de Railway d'enregistrer une variable vide.
     Le diagnostic affichait `ses_variables: true`, l'envoi échouait en
     « 535 Authentication Credentials Invalid », et on a cherché du côté de
     l'expéditeur, du domaine et du code pendant une heure.

     On ne vérifie pas la valeur — ce sont des secrets — mais sa FORME, qui
     est publique et suffit à distinguer un vrai identifiant d'un reliquat. */
  const user = String(env.SES_SMTP_USER || '').trim();
  if (user && !/^AKIA[A-Z0-9]{12,}$/.test(user)) {
    return 'SES_SMTP_USER ne ressemble pas à un identifiant Amazon (attendu : AKIA… sur 20 caractères) — Amazon refusera la connexion';
  }
  const pass = String(env.SES_SMTP_PASS || '').trim();
  if (pass && pass.length < 20) {
    return `SES_SMTP_PASS fait ${pass.length} caractère(s), un mot de passe SMTP Amazon en fait ~44 — valeur temporaire oubliée ?`;
  }
  const jeton = String(env.SES_WEBHOOK_TOKEN || '').trim();
  if (jeton.length < 16) {
    return `SES_WEBHOOK_TOKEN fait ${jeton.length} caractère(s) — trop court pour un jeton partagé, l'abonnement SNS restera « en attente de confirmation »`;
  }
  return null;
}

/** Ce que le courriel concerne — pour retrouver son sort depuis la facture. */
export interface SuiviCourriel {
  orgId: string | null;
  entityType: string;
  entityId?: string | null;
}

export interface SendEmailParams {
  from?: string;
  to: string | string[];
  replyTo?: string;
  subject: string;
  html: string;
  /**
   * Partie texte (multipart/alternative). Absente, elle est dérivée du HTML
   * par `htmlVersTextePourEnvoi` : un courriel HTML seul est un signal de
   * pourriel pour Gmail et Outlook.
   */
  text?: string;
  /**
   * En-têtes SMTP additionnels.
   *
   * Nécessaire pour `List-Unsubscribe` / `List-Unsubscribe-Post` : sans eux,
   * Gmail et Outlook n'affichent pas leur bouton natif « Se désabonner », et
   * les courriels commerciaux sont davantage classés en pourriel.
   */
  headers?: Record<string, string>;
  /** Journalise l'envoi dans email_deliveries (badge « non livré », relances). */
  suivi?: SuiviCourriel;
  /**
   * Opt-in, envois de FOND seulement (cron, webhook, notification) : un échec
   * met le courriel dans `email_retry_queue`, repris par
   * `demarrerReprisesCourriels` (5 min / 30 min / 3 h, puis abandon signalé).
   * Jamais sur un envoi déclenché par un clic : l'utilisateur réessaie
   * lui-même, une file créerait des doublons.
   */
  reessayer?: boolean;
}

export interface SendEmailResult {
  sent: boolean;
  messageId?: string;
  error?: string;
  /** L'envoi a échoué mais attend dans la file de reprise. */
  enFile?: boolean;
}

const RESEND_API = 'https://api.resend.com/emails';

async function envoyerViaResend(p: { from: string; to: string[]; replyTo?: string; subject: string; html: string; text: string; headers?: Record<string, string> }): Promise<{ id: string }> {
  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: p.from,
      to: p.to,
      ...(p.replyTo ? { reply_to: p.replyTo } : {}),
      subject: p.subject,
      html: p.html,
      text: p.text,
      ...(p.headers ? { headers: p.headers } : {}),
    }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body?.id) {
    throw new Error(`Resend ${res.status}: ${body?.message || body?.name || 'unknown error'}`);
  }
  return { id: String(body.id) };
}

/**
 * Journal d'envoi. Best-effort : un échec ici ne doit jamais faire échouer
 * l'envoi — mais il est journalisé, un trou dans ce journal est une
 * information (la table peut manquer sur un environnement pas encore migré).
 */
async function journaliserEnvoi(entree: {
  provider: FournisseurCourriel; messageId: string; to: string; subject: string; suivi?: SuiviCourriel;
}): Promise<void> {
  try {
    const { error } = await getServiceClient().from('email_deliveries').insert({
      org_id: entree.suivi?.orgId ?? null,
      provider: entree.provider,
      message_id: entree.messageId,
      to_email: entree.to,
      subject: entree.subject.slice(0, 500),
      entity_type: entree.suivi?.entityType ?? null,
      entity_id: entree.suivi?.entityId ?? null,
      status: 'sent',
    });
    if (error) logger.error('[mailer] email_deliveries non journalisé', { error: error.message, messageId: entree.messageId });
  } catch (err: any) {
    logger.error('[mailer] email_deliveries non journalisé', { error: err?.message || String(err) });
  }
}

/**
 * Un envoi raté marqué `reessayer` entre dans la file de reprise. Retourne
 * vrai si la ligne est écrite ; l'échec d'écriture est journalisé (le courriel
 * est alors vraiment perdu, comme avant la file).
 */
async function mettreEnFile(params: SendEmailParams, from: string, text: string, erreur: string): Promise<boolean> {
  try {
    const { error } = await getServiceClient().from(TABLE_REPRISES).insert({
      org_id: params.suivi?.orgId ?? null,
      from_addr: from,
      to_emails: Array.isArray(params.to) ? params.to : [params.to],
      reply_to: params.replyTo ?? null,
      subject: params.subject,
      html: params.html,
      text,
      headers: params.headers ?? null,
      suivi: params.suivi ?? null,
      last_error: erreur.slice(0, 1000),
      ...planifierPremiereReprise(new Date()),
    });
    if (error) {
      logger.error('[mailer] courriel raté non mis en file', { error: error.message, subject: params.subject });
      return false;
    }
    logger.warn('[mailer] courriel raté mis en file de reprise', { subject: params.subject, orgId: params.suivi?.orgId ?? null });
    return true;
  } catch (err: any) {
    logger.error('[mailer] courriel raté non mis en file', { error: err?.message || String(err), subject: params.subject });
    return false;
  }
}

/**
 * Send an email — Resend si configuré, sinon SMTP.
 * Drop-in replacement for Resend's `resend.emails.send()`.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const defaultFrom = process.env.EMAIL_FROM || `Lume CRM <${process.env.SMTP_USER}>`;
  const from = params.from || defaultFrom;
  // Toujours une partie texte : dérivée du HTML si l'appelant n'en fournit pas.
  const text = params.text || htmlVersTextePourEnvoi(params.html);

  // Mode QA : quand QA_REDIRECT_EMAIL est défini, tout courriel part vers cette
  // adresse et le destinataire d'origine passe dans l'objet. Passe-plat sinon.
  const qa = redirigerEmail(params.to, params.subject);
  if (qa.redirige) {
    console.warn(`[qa] courriel redirigé : ${qa.destinataireOrigine} → ${qa.to}`);
  }
  const destinataires = Array.isArray(qa.to) ? qa.to : [qa.to];
  // Bureau en cours d'activation après un import : aucun courriel vers ses clients.
  for (const dest of Array.isArray(params.to) ? params.to : [params.to]) {
    const orgGelee = await destinataireGele(getServiceClient(), { email: dest }, params.suivi?.orgId ?? null);
    if (orgGelee) {
      journaliserBlocage('courriel', orgGelee, dest, params.suivi?.entityType);
      return { sent: false, error: MESSAGE_GEL };
    }
  }
  const provider = fournisseurCourriel();

  try {
    let messageId: string;
    if (provider === 'resend') {
      const { id } = await envoyerViaResend({
        from,
        to: destinataires,
        replyTo: params.replyTo,
        subject: qa.subject,
        html: params.html,
        text,
        headers: params.headers,
      });
      messageId = id;
    } else {
      // SES et SMTP partagent nodemailer ; seul le transport diffère.
      const transport = provider === 'ses' ? getTransporteurSes() : getTransporter();

      /* Le jeu de configuration SES, en en-tête du message.
         `SES_CONFIGURATION_SET` était documentée mais lue NULLE PART : sans
         cet en-tête, Amazon n'attache aucun suivi au courriel et ne publie
         donc rien sur SNS — ni livraison, ni ouverture, ni clic, ni rebond.
         On aurait tout branché (identifiants, sujet SNS, route) pour
         n'observer strictement aucun retour, sans erreur nulle part. */
      const jeuSes = provider === 'ses' ? String(process.env.SES_CONFIGURATION_SET || '').trim() : '';
      const enTetes = {
        ...(params.headers ?? {}),
        ...(jeuSes ? { 'X-SES-CONFIGURATION-SET': jeuSes } : {}),
      };

      const info = await transport.sendMail({
        from,
        to: destinataires.join(', '),
        replyTo: params.replyTo,
        subject: qa.subject,
        html: params.html,
        text,
        ...(Object.keys(enTetes).length ? { headers: enTetes } : {}),
      });
      // SES : on range l'identifiant sous la forme que citeront ses notifications
      // de rebond (sans chevrons ni domaine), sinon aucun rebond ne retrouverait sa ligne.
      messageId = provider === 'ses' ? messageIdSes(info.messageId) : info.messageId;
    }

    // Une ligne par destinataire réel (pas l'adresse de redirection QA).
    const originaux = Array.isArray(params.to) ? params.to : [params.to];
    await Promise.all(originaux.map((to, i) => journaliserEnvoi({
      provider,
      messageId: originaux.length > 1 ? `${messageId}#${i}` : messageId,
      to,
      subject: params.subject,
      suivi: params.suivi,
    })));

    return { sent: true, messageId };
  } catch (err: any) {
    console.error('[mailer] send failed:', err.message);
    // Remonté à Sentry : cette erreur est attrapée volontairement (pour ne pas
    // casser le flux appelant), donc le gestionnaire global ne la verrait
    // jamais. Sans ça, un serveur SMTP en panne reste invisible jusqu'à ce
    // qu'un client se plaigne de ne rien avoir reçu.
    try {
      const { captureException } = await import('./sentry');
      captureException(err, {
        kind: 'email_send_failed',
        to: Array.isArray(params.to) ? params.to.join(', ') : params.to,
        subject: params.subject,
      });
    } catch { /* no-op */ }
    if (params.reessayer && await mettreEnFile(params, from, text, String(err?.message || err))) {
      return { sent: false, error: err.message, enFile: true };
    }
    return { sent: false, error: err.message };
  }
}

/**
 * Check if a mail provider is configured (non-throwing check for optional email features).
 */
export function isMailerConfigured(): boolean {
  return !!process.env.RESEND_API_KEY || !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

/**
 * Cette adresse a-t-elle rebondi (ou signalé un pourriel) pour cette org ?
 * Les relances automatiques s'en servent : relancer une adresse morte ne
 * sert à rien et abîme la réputation du domaine.
 */
export async function adresseInjoignable(orgId: string, email: string): Promise<boolean> {
  try {
    const { data, error } = await getServiceClient()
      .from('email_deliveries')
      .select('id')
      .eq('org_id', orgId)
      .ilike('to_email', email.trim())
      .in('status', ['bounced', 'complained'])
      .limit(1);
    if (error) return false;
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}
