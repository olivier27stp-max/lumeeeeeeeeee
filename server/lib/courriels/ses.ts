/**
 * Amazon SES — fournisseur d'envoi à gros volume (2026-09-17).
 * ────────────────────────────────────────────────────────────
 * Décision de Rafba : « SES, mets-le tout de suite, va être plus simple ».
 * Le coût est ~0,10 $ US / 1 000 courriels contre un forfait chez Resend.
 *
 * DEUX CHOSES À SAVOIR AVANT DE BASCULER
 *
 * 1. SES démarre en « bac à sable » : 200 courriels par jour, et uniquement
 *    vers des adresses vérifiées une à une. Il faut demander la « production
 *    access » dans la console AWS (24 à 48 h). Tant que ce n'est pas accordé,
 *    basculer serait un recul : d'où `COURRIEL_FOURNISSEUR`, qui laisse
 *    Resend principal jusqu'au jour J.
 *
 * 2. SES parle le SMTP standard : aucun SDK AWS n'est nécessaire, le chemin
 *    nodemailer déjà en place suffit. Les identifiants SMTP SES ne sont PAS
 *    les clés d'accès AWS — ils se créent dans SES → SMTP settings, et le mot
 *    de passe n'est montré qu'une fois.
 *
 * CE QUE CE MODULE APPORTE
 *   - `reglagesSmtpSes()` : l'hôte et le port SES selon la région, pour que
 *     `SES_REGION` suffise (au lieu de recopier un hôte à la main) ;
 *   - `messageIdSes()` : SES renvoie son identifiant dans l'en-tête du même
 *     nom ; nodemailer le rend entre chevrons, on le normalise pour que
 *     `email_deliveries.message_id` corresponde à ce que les notifications
 *     de rebond citeront ;
 *   - `evenementDepuisSns()` : traduction d'une notification SNS (Bounce,
 *     Complaint, Delivery, Open, Click) vers le vocabulaire interne, pour que
 *     le webhook des rebonds traite SES exactement comme Resend.
 *
 * Env :
 *   COURRIEL_FOURNISSEUR = ses | resend | smtp   (sinon : automatique)
 *   SES_REGION           = ca-central-1 (défaut), us-east-1…
 *   SES_SMTP_USER / SES_SMTP_PASS                 (SES → SMTP settings)
 *   SES_CONFIGURATION_SET                          (facultatif : suivi et SNS)
 *
 * Pur et testé : tests/courriels/ses.test.ts.
 */

/** Régions SES courantes ; l'hôte SMTP suit toujours ce motif. */
export const REGION_SES_DEFAUT = 'ca-central-1';

export function hoteSmtpSes(region = REGION_SES_DEFAUT): string {
  return `email-smtp.${region}.amazonaws.com`;
}

export interface ReglagesSmtpSes {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
}

/**
 * Les réglages SMTP de SES, ou null si les identifiants manquent (on ne
 * bascule jamais sur un fournisseur à moitié configuré : mieux vaut rester
 * sur Resend que d'échouer à chaque envoi).
 * Port 587 en STARTTLS : le 465 existe mais 587 passe mieux les pare-feux
 * d'hébergeurs, et Railway ne bloque ni l'un ni l'autre.
 */
export function reglagesSmtpSes(env: NodeJS.ProcessEnv = process.env): ReglagesSmtpSes | null {
  const user = String(env.SES_SMTP_USER || '').trim();
  const pass = String(env.SES_SMTP_PASS || '').trim();
  if (!user || !pass) return null;
  const region = String(env.SES_REGION || REGION_SES_DEFAUT).trim() || REGION_SES_DEFAUT;
  return { host: hoteSmtpSes(region), port: 587, secure: false, auth: { user, pass } };
}

/** SES est-il utilisable ? (identifiants présents) */
export function sesConfigure(env: NodeJS.ProcessEnv = process.env): boolean {
  return reglagesSmtpSes(env) !== null;
}

/**
 * L'identifiant d'un message SES, tel qu'on veut le retrouver plus tard.
 * Les notifications SNS citent « 010001... » : on enlève les chevrons et le
 * domaine éventuels pour que les deux se rejoignent dans
 * `email_deliveries.message_id`.
 */
export function messageIdSes(brut: string | null | undefined): string {
  const s = String(brut || '').trim().replace(/^<|>$/g, '');
  const arobase = s.indexOf('@');
  return arobase > 0 ? s.slice(0, arobase) : s;
}

/**
 * L'identifiant qu'AMAZON a donné au message, extrait de sa réponse SMTP.
 *
 * Le piège, et il est total : `info.messageId` de nodemailer n'est PAS
 * l'identifiant d'Amazon. C'est l'en-tête `Message-ID` que nodemailer a
 * fabriqué lui-même AVANT de se connecter (smtp-transport/index.js : `const
 * messageId = mail.message.messageId()` puis `info.messageId = messageId`).
 * En SMTP simple il ressemble à « <a1b2c3-...@lumecrm.net> », un UUID qui
 * n'existe nulle part chez Amazon.
 *
 * Le vrai identifiant arrive dans la RÉPONSE du serveur, qu'on lit dans
 * `info.response` : SES répond « 250 Ok 010001999... ».
 *
 * Conséquence si on se trompe — c'est ce qui est arrivé : les envois
 * fonctionnent, les lignes `email_deliveries` s'écrivent, tout a l'air
 * parfait, et AUCUN évènement SNS ne retrouve jamais sa ligne, parce qu'Amazon
 * cite un identifiant qui n'a jamais été enregistré. Pas une erreur, pas un
 * rebond, pas une ouverture. Un suivi silencieusement mort.
 *
 * On retombe sur `Message-ID` seulement s'il porte le domaine d'Amazon
 * (`amazonses.com`) — c'est le cas de l'API SES, pas du SMTP.
 */
export function messageIdDepuisReponseSes(info: { response?: string; messageId?: string } | null | undefined): string {
  /* « 250 Ok 010001999abc-... » : on prend le DERNIER mot de la réponse, qui
     est l'identifiant. Il contient des tirets, d'où le découpage sur les
     espaces plutôt qu'une expression qui devrait deviner sa forme exacte. */
  const reponse = String(info?.response || '').trim();
  if (/^250(\s|$)/.test(reponse)) {
    const dernier = reponse.split(/\s+/).pop() || '';
    // « 250 Ok » tout court ne porte aucun identifiant : ne rien inventer.
    if (dernier.length >= 16 && /^[0-9a-zA-Z._-]+$/.test(dernier)) return dernier;
  }

  // Repli : l'en-tête, mais seulement s'il vient vraiment d'Amazon.
  const entete = String(info?.messageId || '');
  if (/amazonses\.com/i.test(entete)) return messageIdSes(entete);

  // Rien d'exploitable : mieux vaut une chaîne vide qu'un identifiant qui
  // ne correspondra jamais à rien et ferait croire que le suivi fonctionne.
  return '';
}

export type EvenementCourriel = 'delivered' | 'bounced' | 'complained' | 'delayed' | 'opened' | 'clicked';

export interface EvenementSes {
  type: EvenementCourriel;
  messageId: string;
  /** Adresses concernées (rebond : celles qui ont échoué). */
  destinataires: string[];
  quand: string | null;
  /** Pour un clic : l'adresse ouverte. */
  url: string | null;
  /** Diagnostic SES (« smtp; 550 5.1.1 user unknown »), pour la colonne error. */
  detail: string | null;
  /** Un rebond « Transient » (boîte pleine, serveur en panne) n'est PAS définitif. */
  definitif: boolean;
}

interface NotificationSns {
  eventType?: string;
  notificationType?: string;
  mail?: { messageId?: string; timestamp?: string; destination?: string[] };
  bounce?: { bounceType?: string; timestamp?: string; bouncedRecipients?: Array<{ emailAddress?: string; diagnosticCode?: string }> };
  complaint?: { timestamp?: string; complainedRecipients?: Array<{ emailAddress?: string }>; complaintFeedbackType?: string };
  delivery?: { timestamp?: string; recipients?: string[] };
  open?: { timestamp?: string };
  click?: { timestamp?: string; link?: string };
}

/**
 * Traduit une notification SES (SNS) vers le vocabulaire interne, ou null si
 * le type ne nous concerne pas. SES nomme ses évènements de deux façons selon
 * qu'ils viennent d'un « configuration set » (`eventType`) ou de la
 * notification historique (`notificationType`) : on accepte les deux.
 * Pur, testé.
 */
export function evenementDepuisSns(corps: unknown): EvenementSes | null {
  if (!corps || typeof corps !== 'object') return null;
  const n = corps as NotificationSns;
  const brut = String(n.eventType || n.notificationType || '').toLowerCase();
  const messageId = messageIdSes(n.mail?.messageId);
  if (!messageId) return null;

  const commun = { messageId, url: null as string | null, detail: null as string | null, definitif: true };

  if (brut === 'bounce') {
    const transitoire = String(n.bounce?.bounceType || '').toLowerCase() === 'transient';
    return {
      ...commun,
      type: 'bounced',
      destinataires: (n.bounce?.bouncedRecipients || []).map((r) => String(r.emailAddress || '')).filter(Boolean),
      quand: n.bounce?.timestamp || n.mail?.timestamp || null,
      detail: (n.bounce?.bouncedRecipients || []).map((r) => r.diagnosticCode).filter(Boolean).join(' · ') || String(n.bounce?.bounceType || '') || null,
      // Boîte pleine ou serveur en panne : l'adresse n'est pas morte, on ne la bannit pas.
      definitif: !transitoire,
    };
  }
  if (brut === 'complaint') {
    return {
      ...commun,
      type: 'complained',
      destinataires: (n.complaint?.complainedRecipients || []).map((r) => String(r.emailAddress || '')).filter(Boolean),
      quand: n.complaint?.timestamp || n.mail?.timestamp || null,
      detail: n.complaint?.complaintFeedbackType || null,
    };
  }
  if (brut === 'delivery') {
    return { ...commun, type: 'delivered', destinataires: n.delivery?.recipients || n.mail?.destination || [], quand: n.delivery?.timestamp || n.mail?.timestamp || null };
  }
  if (brut === 'open') {
    return { ...commun, type: 'opened', destinataires: n.mail?.destination || [], quand: n.open?.timestamp || n.mail?.timestamp || null };
  }
  if (brut === 'click') {
    return { ...commun, type: 'clicked', destinataires: n.mail?.destination || [], quand: n.click?.timestamp || n.mail?.timestamp || null, url: n.click?.link || null };
  }
  return null;
}

/**
 * Le corps d'une requête SNS arrive en JSON, parfois avec le vrai message
 * dans un champ `Message` encodé en chaîne (abonnement HTTPS). On déplie.
 */
export function deplierMessageSns(corps: unknown): unknown {
  if (!corps || typeof corps !== 'object') return corps;
  const enveloppe = corps as { Message?: unknown; Type?: string };
  if (typeof enveloppe.Message !== 'string') return corps;
  try {
    return JSON.parse(enveloppe.Message);
  } catch {
    return corps;
  }
}

/** Une requête SNS de confirmation d'abonnement : il faut visiter l'URL une fois. */
export function urlDeConfirmationSns(corps: unknown): string | null {
  if (!corps || typeof corps !== 'object') return null;
  const e = corps as { Type?: string; SubscribeURL?: string };
  if (String(e.Type || '') !== 'SubscriptionConfirmation') return null;
  const url = String(e.SubscribeURL || '');
  // Seulement un domaine AWS : sinon n'importe qui nous ferait visiter n'importe quoi.
  return /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//.test(url) ? url : null;
}
