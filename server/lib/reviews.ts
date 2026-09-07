/* ═══════════════════════════════════════════════════════════════
   Avis clients — règles pures du workflow de sondage.

   job terminée → sondage d'étoiles (1-5) envoyé tout de suite
     • 4-5 étoiles : redirection vers Google / Facebook + message d'invitation
     • 1-3 étoiles : formulaire de commentaires interne + tâche de suivi

   Aucune dépendance : partagé entre l'action request_review, la route
   publique /api/survey et les tests.
   ═══════════════════════════════════════════════════════════════ */

/** Note minimale (incluse) à partir de laquelle on demande un avis public. */
export const POSITIVE_RATING_MIN = 4;

export type ReviewPlatform = 'google' | 'facebook';

export interface ReviewDestination {
  platform: ReviewPlatform;
  url: string;
}

export interface ReviewSettingsLike {
  google_review_url?: string | null;
  facebook_review_url?: string | null;
  review_invite_message?: string | null;
}

export const DEFAULT_REVIEW_INVITE_MESSAGE_FR =
  'Merci beaucoup ! Votre avis compte énormément pour une petite entreprise comme la nôtre. '
  + 'Prendriez-vous 30 secondes pour partager votre expérience ? Ça nous aide vraiment.';

export const DEFAULT_REVIEW_INVITE_MESSAGE_EN =
  'Thank you so much! Your review means the world to a small business like ours. '
  + 'Would you take 30 seconds to share your experience? It truly helps us.';

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

export function reviewInviteMessage(settings: ReviewSettingsLike | null | undefined, lang: 'fr' | 'en' = 'fr'): string {
  const custom = String(settings?.review_invite_message || '').trim();
  if (custom) return custom;
  return lang === 'fr' ? DEFAULT_REVIEW_INVITE_MESSAGE_FR : DEFAULT_REVIEW_INVITE_MESSAGE_EN;
}

/**
 * Prochaine étape du sondage pour une note donnée.
 *  - `public_review` : message + liens, redirection automatique si UNE seule
 *    plateforme est configurée (`auto_redirect_url`).
 *  - `feedback_form` : commentaires internes.
 */
export function surveyNextStep(rating: number, settings: ReviewSettingsLike | null | undefined) {
  if (!isPositiveRating(rating)) {
    return { step: 'feedback_form' as const, destinations: [] as ReviewDestination[], auto_redirect_url: null as string | null };
  }
  const destinations = reviewDestinations(settings);
  return {
    step: 'public_review' as const,
    destinations,
    auto_redirect_url: destinations.length === 1 ? destinations[0].url : null,
  };
}
