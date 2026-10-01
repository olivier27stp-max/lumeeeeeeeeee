/* ═══════════════════════════════════════════════════════════════
   Avis clients — règles pures du workflow de demande d'avis.

   job terminée → lien envoyé tout de suite (courriel + SMS) à TOUS les
   clients, sauf ceux dont le champ personnalisé « noreview » est coché.
   La page /survey/:token mène tout le monde au choix Google / Facebook :
   aucune note préalable, aucun filtrage (2026-09-30). Trier les clients
   selon leur satisfaction avant de les envoyer vers un avis public
   (« review gating ») est interdit par Google et Facebook et constitue une
   pratique trompeuse (FTC 16 CFR 465, Loi sur la concurrence).

   Tous les textes vus par le client sont personnalisables dans
   Réglages → Avis clients (colonnes review_* de company_settings) ;
   NULL/vide = les défauts ci-dessous.

   Aucune dépendance : partagé entre l'action request_review, la route
   publique /api/survey et les tests.
   ═══════════════════════════════════════════════════════════════ */

/**
 * Clé du champ personnalisé client (case à cocher, posé d'office dans chaque
 * entreprise par cf_champs_base) : cochée = ce client ne reçoit AUCUNE
 * demande d'avis ni rappel d'avis.
 */
export const NO_REVIEW_FIELD_KEY = 'noreview';

/** Automatisations qui sollicitent un avis : elles respectent « noreview ». */
export const REVIEW_PRESET_KEYS = ['google_review', 'review_reminder_7d'] as const;

export function isReviewPreset(presetKey: string | null | undefined): boolean {
  return !!presetKey && (REVIEW_PRESET_KEYS as readonly string[]).includes(presetKey);
}

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
  + 'Un avis Google ou Facebook nous aiderait énormément : [survey_url]';

/* L'objet ne répète pas le nom de l'entreprise : l'expéditeur l'affiche déjà
   (audit des courriels du 2026-09-29 — et un nom vide donnait « — Comment… »). */
export const DEFAULT_REVIEW_EMAIL_SUBJECT_FR = 'Votre avis compte pour nous';
export const DEFAULT_REVIEW_EMAIL_SUBJECT_EN = 'Your review means a lot to us';

export const DEFAULT_REVIEW_EMAIL_BODY_FR =
  'Bonjour [client_first_name],\n\n'
  + 'Nous venons de terminer [job_name] et votre opinion compte pour nous.\n\n'
  + 'Prendriez-vous 30 secondes pour nous laisser un avis sur Google ou Facebook ?\n\n'
  + '[survey_url]\n\n'
  + "Merci d'avoir choisi [company_name] !";

/* La version anglaise : une entreprise anglophone envoyait la demande d'avis
   en français (aucun défaut EN n'existait). */
export const DEFAULT_REVIEW_EMAIL_BODY_EN =
  'Hi [client_first_name],\n\n'
  + 'We just finished [job_name] and your opinion matters to us.\n\n'
  + 'Would you take 30 seconds to leave us a review on Google or Facebook?\n\n'
  + '[survey_url]\n\n'
  + 'Thank you for choosing [company_name]!';

/** Titre de la page publique, au-dessus du message d'invitation. */
export const DEFAULT_SURVEY_QUESTION_FR = 'Merci de nous avoir fait confiance !';
export const DEFAULT_SURVEY_QUESTION_EN = 'Thank you for trusting us!';

/** Libellé du bouton dans le courriel (le lien [survey_url] devient ce bouton). */
export const REVIEW_EMAIL_BUTTON_LABEL_FR = 'Laisser un avis';
export const REVIEW_EMAIL_BUTTON_LABEL_EN = 'Leave a review';

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
export function reviewSmsBody(settings: ReviewSettingsLike | null | undefined, vars: Record<string, string>): string {
  const template = customOr(settings?.review_sms_body, DEFAULT_REVIEW_SMS_BODY_FR);
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
 * Où mène la page : TOUJOURS au choix des plateformes configurées, pour tout
 * le monde. Redirection automatique si une seule plateforme existe.
 */
export function reviewLanding(settings: ReviewSettingsLike | null | undefined) {
  const destinations = reviewDestinations(settings);
  return {
    destinations,
    auto_redirect_url: destinations.length === 1 ? destinations[0].url : null as string | null,
  };
}

export function isReviewPlatform(value: unknown): value is ReviewPlatform {
  return value === 'google' || value === 'facebook';
}
