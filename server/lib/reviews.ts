/* ═══════════════════════════════════════════════════════════════
   Avis clients — règles pures du workflow de sondage.

   job terminée → sondage d'étoiles (1-5) envoyé tout de suite
     • 5 étoiles : redirection vers Google / Facebook + message d'invitation
     • 4 étoiles ou moins : formulaire de commentaires interne + tâche de suivi

   Tous les textes vus par le client sont personnalisables dans
   Réglages → Avis clients (colonnes review_* de company_settings) ;
   NULL/vide = les défauts ci-dessous.

   Aucune dépendance : partagé entre l'action request_review, la route
   publique /api/survey et les tests.
   ═══════════════════════════════════════════════════════════════ */

/** Note minimale (incluse) à partir de laquelle on demande un avis public. */
export const POSITIVE_RATING_MIN = 5;

export type ReviewPlatform = 'google' | 'facebook';

export interface ReviewDestination {
  platform: ReviewPlatform;
  url: string;
}

export interface ReviewSettingsLike {
  google_review_url?: string | null;
  facebook_review_url?: string | null;
  review_invite_message?: string | null;
  review_sms_body?: string | null;
  review_email_subject?: string | null;
  review_email_body?: string | null;
  review_survey_question?: string | null;
  review_low_rating_message?: string | null;
  review_thank_you_message?: string | null;
}

/** Variables disponibles dans les messages du sondage (syntaxe [var] ou {var}). */
export const REVIEW_TEMPLATE_VARIABLES = [
  'client_first_name',
  'client_name',
  'company_name',
  'job_name',
  'survey_url',
] as const;

export const DEFAULT_REVIEW_INVITE_MESSAGE_FR =
  'Merci beaucoup ! Votre avis compte énormément pour une petite entreprise comme la nôtre. '
  + 'Prendriez-vous 30 secondes pour partager votre expérience ? Ça nous aide vraiment.';

export const DEFAULT_REVIEW_INVITE_MESSAGE_EN =
  'Thank you so much! Your review means the world to a small business like ours. '
  + 'Would you take 30 seconds to share your experience? It truly helps us.';

export const DEFAULT_REVIEW_SMS_BODY_FR =
  "Bonjour [client_first_name], merci d'avoir choisi [company_name] ! "
  + "Comment s'est passé notre service ? Notez-nous en 10 secondes : [survey_url]";

/* Le texto par défaut d'une entreprise ANGLAISE : sans lui, ses clients
   recevaient la demande d'avis en français (le courriel, lui, suivait la
   langue). ASCII seulement : il reste en GSM-7 (160 caractères / segment). */
export const DEFAULT_REVIEW_SMS_BODY_EN =
  'Hi [client_first_name], thanks for choosing [company_name]! '
  + 'How did we do? Rate us in 10 seconds: [survey_url]';

/* L'objet ne répète pas le nom de l'entreprise : l'expéditeur l'affiche déjà
   (audit des courriels du 2026-09-29 — et un nom vide donnait « — Comment… »). */
export const DEFAULT_REVIEW_EMAIL_SUBJECT_FR = "Comment s'est passé notre service ?";
export const DEFAULT_REVIEW_EMAIL_SUBJECT_EN = 'How did we do?';

export const DEFAULT_REVIEW_EMAIL_BODY_FR =
  'Bonjour [client_first_name],\n\n'
  + 'Nous venons de terminer [job_name] et votre opinion compte pour nous.\n\n'
  + 'Notez votre expérience en 10 secondes :\n\n'
  + '[survey_url]\n\n'
  + "Merci d'avoir choisi [company_name] !";

/* La version anglaise : une entreprise anglophone envoyait la demande d'avis
   en français (aucun défaut EN n'existait). */
export const DEFAULT_REVIEW_EMAIL_BODY_EN =
  'Hi [client_first_name],\n\n'
  + 'We just finished [job_name] and your opinion matters to us.\n\n'
  + 'Rate your experience in 10 seconds:\n\n'
  + '[survey_url]\n\n'
  + 'Thank you for choosing [company_name]!';

export const DEFAULT_SURVEY_QUESTION_FR = "Comment s'est passé notre service ?";
export const DEFAULT_SURVEY_QUESTION_EN = 'How did we do?';

export const DEFAULT_LOW_RATING_MESSAGE_FR =
  "Nous sommes désolés que ce ne soit pas à la hauteur. Dites-nous ce qui n'a pas fonctionné : "
  + "votre message est envoyé directement à l'équipe, il n'est pas publié.";
export const DEFAULT_LOW_RATING_MESSAGE_EN =
  "We're sorry it wasn't up to par. Tell us what went wrong: your message goes straight to the team, it is not published.";

export const DEFAULT_THANK_YOU_MESSAGE_FR = "Merci pour votre franchise. Un membre de l'équipe vous contactera rapidement.";
export const DEFAULT_THANK_YOU_MESSAGE_EN = 'Thank you for your honesty. A team member will reach out to you shortly.';

/** Libellé du bouton dans le courriel (le lien [survey_url] devient ce bouton). */
export const REVIEW_EMAIL_BUTTON_LABEL_FR = 'Noter mon expérience';
export const REVIEW_EMAIL_BUTTON_LABEL_EN = 'Rate my experience';

export function isPositiveRating(rating: number): boolean {
  return Number.isFinite(rating) && rating >= POSITIVE_RATING_MIN;
}

export function isValidRating(value: unknown): value is number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5;
}

/** Tolère « www.facebook.com/… » : préfixe https:// au lieu de rejeter. */
export function normalizeReviewUrl(raw: string | null | undefined): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return /^https?:\/\/[^\s.]+\.\S{2,}$/i.test(withScheme) ? withScheme : '';
}

/**
 * Plateformes configurées, Google en premier. Une entreprise sans aucun lien
 * n'a pas de destination : l'action request_review refuse alors d'envoyer.
 */
export function reviewDestinations(settings: ReviewSettingsLike | null | undefined): ReviewDestination[] {
  if (!settings) return [];
  const out: ReviewDestination[] = [];
  const google = normalizeReviewUrl(settings.google_review_url);
  const facebook = normalizeReviewUrl(settings.facebook_review_url);
  if (google) out.push({ platform: 'google', url: google });
  if (facebook) out.push({ platform: 'facebook', url: facebook });
  return out;
}

function customOr(value: string | null | undefined, fallback: string): string {
  const custom = String(value || '').trim();
  return custom || fallback;
}

export function reviewInviteMessage(settings: ReviewSettingsLike | null | undefined, lang: 'fr' | 'en' = 'fr'): string {
  return customOr(settings?.review_invite_message, lang === 'fr' ? DEFAULT_REVIEW_INVITE_MESSAGE_FR : DEFAULT_REVIEW_INVITE_MESSAGE_EN);
}

/** Textes de la page publique /survey/:token. */
export function surveyTexts(settings: ReviewSettingsLike | null | undefined, lang: 'fr' | 'en' = 'fr') {
  const fr = lang === 'fr';
  return {
    question: customOr(settings?.review_survey_question, fr ? DEFAULT_SURVEY_QUESTION_FR : DEFAULT_SURVEY_QUESTION_EN),
    low_rating_message: customOr(settings?.review_low_rating_message, fr ? DEFAULT_LOW_RATING_MESSAGE_FR : DEFAULT_LOW_RATING_MESSAGE_EN),
    thank_you_message: customOr(settings?.review_thank_you_message, fr ? DEFAULT_THANK_YOU_MESSAGE_FR : DEFAULT_THANK_YOU_MESSAGE_EN),
    invite_message: reviewInviteMessage(settings, lang),
  };
}

/** Remplace [var] et {var} ; une variable inconnue devient vide. */
export function resolveReviewTemplate(template: string, vars: Record<string, string | null | undefined>): string {
  return String(template || '')
    .replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
    .replace(/\[(\w+)\]/g, (_, k) => vars[k] ?? '');
}

/** Corps du SMS du sondage, variables résolues. */
export function reviewSmsBody(settings: ReviewSettingsLike | null | undefined, vars: Record<string, string>, langue: 'fr' | 'en' = 'fr'): string {
  const template = customOr(settings?.review_sms_body, langue === 'en' ? DEFAULT_REVIEW_SMS_BODY_EN : DEFAULT_REVIEW_SMS_BODY_FR);
  let body = resolveReviewTemplate(template, vars).trim();
  // Le SMS ne vaut que par son lien : on l'ajoute si l'entreprise l'a oublié.
  if (vars.survey_url && !body.includes(vars.survey_url)) body = `${body} ${vars.survey_url}`.trim();
  return body;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Courriel du sondage : objet + HTML. Le corps est du texte brut où chaque
 * ligne vide sépare un paragraphe ; le lien [survey_url] devient un bouton
 * (ajouté à la fin s'il est absent du texte).
 */
export function reviewEmail(
  settings: ReviewSettingsLike | null | undefined,
  vars: Record<string, string>,
  options: { langue?: 'fr' | 'en'; couleur?: string | null } = {},
): { subject: string; html: string; text: string } {
  const en = options.langue === 'en';
  const subject = resolveReviewTemplate(customOr(settings?.review_email_subject, en ? DEFAULT_REVIEW_EMAIL_SUBJECT_EN : DEFAULT_REVIEW_EMAIL_SUBJECT_FR), vars).trim();
  const bodyTemplate = customOr(settings?.review_email_body, en ? DEFAULT_REVIEW_EMAIL_BODY_EN : DEFAULT_REVIEW_EMAIL_BODY_FR);
  // Le bouton à la couleur de l'ENTREPRISE (il était noir codé en dur) ;
  // une valeur illisible retombe sur le noir.
  const couleur = /^#[0-9a-f]{6}$/i.test(String(options.couleur ?? '')) ? String(options.couleur) : '#171717';
  const url = vars.survey_url || '';
  const placeholder = '[[SURVEY_BUTTON]]';

  // On résout tout SAUF le lien, remplacé par un marqueur pour le bouton.
  const resolved = resolveReviewTemplate(bodyTemplate, { ...vars, survey_url: placeholder, review_link: placeholder });
  const hasButton = resolved.includes(placeholder);
  const text = resolved.split(placeholder).join(url) + (hasButton ? '' : `\n\n${url}`);

  // Le bouton + le lien de secours en texte (« Le bouton ne fonctionne pas ? »),
  // comme tous les autres courriels.
  const button = `<p style="text-align:center;margin:30px 0 8px;"><a href="${escapeHtml(url)}" style="background:${couleur};color:#ffffff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">${en ? REVIEW_EMAIL_BUTTON_LABEL_EN : REVIEW_EMAIL_BUTTON_LABEL_FR}</a></p>`
    + `<p style="text-align:center;margin:0 0 24px;font-size:12px;color:#6b7280;">${en ? 'Button not working?' : 'Le bouton ne fonctionne pas ?'} <a href="${escapeHtml(url)}" style="color:#6b7280;">${en ? 'Open the link' : 'Ouvrir le lien'}</a></p>`;

  const paragraphs = resolved
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      if (p === placeholder) return button;
      const inner = escapeHtml(p).split(placeholder).join(`<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`).replace(/\n/g, '<br/>');
      return `<p style="margin:0 0 16px;">${inner}</p>`;
    });
  if (!hasButton) paragraphs.push(button);

  const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#171717;font-size:15px;line-height:1.5;">${paragraphs.join('')}</div>`;
  return { subject, html, text };
}

/**
 * Prochaine étape du sondage pour une note donnée.
 *  - `public_review` : message + liens, redirection automatique si UNE seule
 *    plateforme est configurée (`auto_redirect_url`).
 *  - `feedback_form` : commentaires internes d'abord, liens publics ensuite.
 */
export function surveyNextStep(rating: number, settings: ReviewSettingsLike | null | undefined) {
  // Politique Google (« review gating ») : on ne filtre jamais qui peut laisser
  // un avis. La note basse change l'ORDRE (formulaire privé d'abord, liens
  // publics ensuite), jamais l'accès au lien public.
  const destinations = reviewDestinations(settings);
  if (!isPositiveRating(rating)) {
    return { step: 'feedback_form' as const, destinations, auto_redirect_url: null as string | null };
  }
  return {
    step: 'public_review' as const,
    destinations,
    auto_redirect_url: destinations.length === 1 ? destinations[0].url : null,
  };
}
