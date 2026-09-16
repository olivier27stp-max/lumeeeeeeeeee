/* ═══════════════════════════════════════════════════════════════
   Tests — Workflow « Avis clients » (règles pures de server/lib/reviews)
   ═══════════════════════════════════════════════════════════════ */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_REVIEW_INVITE_MESSAGE_FR,
  DEFAULT_SURVEY_QUESTION_FR,
  reviewEmail,
  reviewSmsBody,
  surveyTexts,
  isPositiveRating,
  isValidRating,
  normalizeReviewUrl,
  reviewDestinations,
  reviewInviteMessage,
  surveyNextStep,
} from '../../server/lib/reviews';

describe('Avis clients — seuil de note', () => {
  it('5 étoiles seulement = avis public', () => {
    expect(isPositiveRating(5)).toBe(true);
    expect(isPositiveRating(4)).toBe(false);
  });

  it('1 à 4 étoiles = commentaires internes', () => {
    expect(isPositiveRating(1)).toBe(false);
    expect(isPositiveRating(2)).toBe(false);
    expect(isPositiveRating(3)).toBe(false);
    expect(isPositiveRating(4)).toBe(false);
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

  it('note basse → formulaire de commentaires d abord, liens publics quand même, aucune redirection', () => {
    // Politique Google (« review gating ») : on ne filtre jamais qui peut
    // laisser un avis. La note basse change l'ORDRE (formulaire privé d'abord),
    // pas l'accès au lien public.
    const next = surveyNextStep(4, both);
    expect(next.step).toBe('feedback_form');
    expect(next.destinations).toHaveLength(2);
    expect(next.auto_redirect_url).toBeNull();
  });

  it('la page publique montre le lien public sous le formulaire et sur l écran de fin', () => {
    const src = readFileSync(resolve(__dirname, '../../src/pages/SatisfactionSurvey.tsx'), 'utf8');
    expect(src).toContain('const liensPublics');
    // Une fois dans le formulaire (note basse), une fois sur « Terminé ».
    expect(src.split('{liensPublics}').length - 1).toBe(2);
  });

  it('note haute + une seule plateforme → redirection automatique', () => {
    const next = surveyNextStep(5, { google_review_url: both.google_review_url });
    expect(next.step).toBe('public_review');
    expect(next.auto_redirect_url).toBe(both.google_review_url);
  });

  it('note haute + deux plateformes → choix, pas de redirection automatique', () => {
    const next = surveyNextStep(5, both);
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

describe('Avis clients — messages personnalisables', () => {
  const vars = {
    client_first_name: 'Marie',
    client_name: 'Marie Tremblay',
    company_name: 'Vision Lavage',
    job_name: 'Lavage de vitres',
    survey_url: 'https://lumecrm.net/survey/abc',
  };

  it('SMS par défaut, variables résolues', () => {
    const body = reviewSmsBody({}, vars);
    expect(body).toContain('Bonjour Marie');
    expect(body).toContain('Vision Lavage');
    expect(body).toContain(vars.survey_url);
  });

  it('SMS personnalisé, lien ajouté s’il manque', () => {
    const body = reviewSmsBody({ review_sms_body: 'Salut [client_first_name], une note pour [company_name] ?' }, vars);
    expect(body).toBe('Salut Marie, une note pour Vision Lavage ? https://lumecrm.net/survey/abc');
  });

  it('courriel par défaut : objet résolu + bouton vers le sondage', () => {
    const mail = reviewEmail({}, vars);
    expect(mail.subject).toBe("Vision Lavage — Comment s'est passé notre service ?");
    expect(mail.html).toContain(`href="${vars.survey_url}"`);
    expect(mail.html).toContain('Noter mon expérience');
    expect(mail.html).toContain('Lavage de vitres');
  });

  it('courriel personnalisé : paragraphes, HTML échappé, bouton ajouté à la fin si [survey_url] absent', () => {
    const mail = reviewEmail({
      review_email_subject: 'Votre avis, [client_first_name] ?',
      review_email_body: 'Bonjour [client_first_name],\n\nMerci <3 pour votre confiance.',
    }, vars);
    expect(mail.subject).toBe('Votre avis, Marie ?');
    expect(mail.html).toContain('<p style="margin:0 0 16px;">Bonjour Marie,</p>');
    expect(mail.html).toContain('Merci &lt;3 pour votre confiance.');
    expect(mail.html.indexOf('Noter mon expérience')).toBeGreaterThan(mail.html.indexOf('confiance'));
    expect(mail.text.endsWith(vars.survey_url)).toBe(true);
  });

  it('textes de la page : défauts FR/EN puis personnalisés', () => {
    expect(surveyTexts({}, 'fr').question).toBe(DEFAULT_SURVEY_QUESTION_FR);
    expect(surveyTexts({}, 'en').question).toBe('How did we do?');
    const t = surveyTexts({ review_survey_question: 'Alors, content ?', review_thank_you_message: 'Merci !' }, 'fr');
    expect(t.question).toBe('Alors, content ?');
    expect(t.thank_you_message).toBe('Merci !');
    expect(t.low_rating_message.length).toBeGreaterThan(10);
  });
});
