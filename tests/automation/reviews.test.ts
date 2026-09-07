/* ═══════════════════════════════════════════════════════════════
   Tests — Workflow « Avis clients » (règles pures de server/lib/reviews)
   ═══════════════════════════════════════════════════════════════ */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REVIEW_INVITE_MESSAGE_FR,
  isPositiveRating,
  isValidRating,
  normalizeReviewUrl,
  reviewDestinations,
  reviewInviteMessage,
  surveyNextStep,
} from '../../server/lib/reviews';

describe('Avis clients — seuil de note', () => {
  it('4 et 5 étoiles = avis public', () => {
    expect(isPositiveRating(4)).toBe(true);
    expect(isPositiveRating(5)).toBe(true);
  });

  it('1 à 3 étoiles = commentaires internes', () => {
    expect(isPositiveRating(1)).toBe(false);
    expect(isPositiveRating(2)).toBe(false);
    expect(isPositiveRating(3)).toBe(false);
  });

  it('valide une note entière de 1 à 5 seulement', () => {
    expect(isValidRating(3)).toBe(true);
    expect(isValidRating('5')).toBe(true);
    expect(isValidRating(0)).toBe(false);
    expect(isValidRating(6)).toBe(false);
    expect(isValidRating(2.5)).toBe(false);
    expect(isValidRating(undefined)).toBe(false);
  });
});

describe('Avis clients — liens de redirection', () => {
  it('Google d’abord, puis Facebook', () => {
    const d = reviewDestinations({
      google_review_url: 'https://g.page/r/abc/review',
      facebook_review_url: 'https://www.facebook.com/lume/reviews',
    });
    expect(d.map((x) => x.platform)).toEqual(['google', 'facebook']);
  });

  it('ignore les liens vides ou invalides', () => {
    expect(reviewDestinations({ google_review_url: '', facebook_review_url: null })).toEqual([]);
    expect(reviewDestinations({ google_review_url: 'pas un lien' })).toEqual([]);
    expect(reviewDestinations(null)).toEqual([]);
  });

  it('tolère un lien sans https://', () => {
    expect(normalizeReviewUrl('www.facebook.com/lume/reviews')).toBe('https://www.facebook.com/lume/reviews');
    expect(normalizeReviewUrl('  https://g.page/r/abc/review ')).toBe('https://g.page/r/abc/review');
  });
});

describe('Avis clients — prochaine étape du sondage', () => {
  const both = {
    google_review_url: 'https://g.page/r/abc/review',
    facebook_review_url: 'https://www.facebook.com/lume/reviews',
  };

  it('note basse → formulaire de commentaires, aucune redirection', () => {
    const next = surveyNextStep(2, both);
    expect(next.step).toBe('feedback_form');
    expect(next.destinations).toEqual([]);
    expect(next.auto_redirect_url).toBeNull();
  });

  it('note haute + une seule plateforme → redirection automatique', () => {
    const next = surveyNextStep(5, { google_review_url: both.google_review_url });
    expect(next.step).toBe('public_review');
    expect(next.auto_redirect_url).toBe(both.google_review_url);
  });

  it('note haute + deux plateformes → choix, pas de redirection automatique', () => {
    const next = surveyNextStep(4, both);
    expect(next.step).toBe('public_review');
    expect(next.destinations).toHaveLength(2);
    expect(next.auto_redirect_url).toBeNull();
  });

  it('note haute sans lien configuré → aucune destination', () => {
    const next = surveyNextStep(5, {});
    expect(next.step).toBe('public_review');
    expect(next.destinations).toEqual([]);
  });
});

describe('Avis clients — message d’invitation', () => {
  it('texte par défaut quand rien n’est configuré', () => {
    expect(reviewInviteMessage({}, 'fr')).toBe(DEFAULT_REVIEW_INVITE_MESSAGE_FR);
    expect(reviewInviteMessage({ review_invite_message: '   ' }, 'fr')).toBe(DEFAULT_REVIEW_INVITE_MESSAGE_FR);
  });

  it('texte personnalisé prioritaire', () => {
    expect(reviewInviteMessage({ review_invite_message: 'Merci !' }, 'fr')).toBe('Merci !');
  });
});
