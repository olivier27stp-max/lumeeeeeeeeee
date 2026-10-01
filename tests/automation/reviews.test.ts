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
  isReviewPlatform,
  isReviewPreset,
  NO_REVIEW_FIELD_KEY,
  normalizeReviewUrl,
  reviewDestinations,
  reviewInviteMessage,
  reviewLanding,
} from '../../server/lib/reviews';
import { CHAMPS_DE_BASE } from '../../src/lib/champs/base';

describe('Avis clients — aucun filtrage par note (review gating interdit)', () => {
  it('la page publique ne demande plus de note d’étoiles', () => {
    const src = readFileSync(resolve(__dirname, '../../src/pages/SatisfactionSurvey.tsx'), 'utf8');
    expect(src).not.toMatch(/rating/i);
    expect(src).not.toContain('<Star');
  });

  it('la route publique ne branche plus selon la note', () => {
    const src = readFileSync(resolve(__dirname, '../../server/routes/surveys.ts'), 'utf8');
    expect(src).not.toMatch(/isPositiveRating|feedback_form|insatisfait/);
    expect(src).toContain("'/survey/:token/choice'");
  });

  it('plateformes reconnues', () => {
    expect(isReviewPlatform('google')).toBe(true);
    expect(isReviewPlatform('facebook')).toBe(true);
    expect(isReviewPlatform('yelp')).toBe(false);
    expect(isReviewPlatform(undefined)).toBe(false);
  });
});

describe('Avis clients — exclusion « noreview »', () => {
  it('le champ client noreview (case à cocher) est posé d’office dans chaque entreprise', () => {
    const champ = CHAMPS_DE_BASE.find((c) => c.cle === NO_REVIEW_FIELD_KEY);
    expect(champ?.objet).toBe('client');
    expect(champ?.type).toBe('checkbox');
  });

  it('la demande ET le rappel d’avis respectent noreview', () => {
    expect(isReviewPreset('google_review')).toBe(true);
    expect(isReviewPreset('review_reminder_7d')).toBe(true);
    expect(isReviewPreset('job_reminder_1d')).toBe(false);
    expect(isReviewPreset(null)).toBe(false);
    const actions = readFileSync(resolve(__dirname, '../../server/lib/actions/index.ts'), 'utf8');
    expect(actions.split('clientRefuseAvis(').length - 1).toBeGreaterThanOrEqual(2);
    const moteur = readFileSync(resolve(__dirname, '../../server/lib/automationEngine.ts'), 'utf8');
    expect(moteur.split('presetKey: ').length - 1).toBeGreaterThanOrEqual(2);
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

describe('Avis clients — page d’avis (tout le monde)', () => {
  const both = {
    google_review_url: 'https://g.page/r/abc/review',
    facebook_review_url: 'https://www.facebook.com/lume/reviews',
  };

  it('une seule plateforme → redirection automatique', () => {
    const l = reviewLanding({ google_review_url: both.google_review_url });
    expect(l.auto_redirect_url).toBe(both.google_review_url);
  });

  it('deux plateformes → choix, pas de redirection automatique', () => {
    const l = reviewLanding(both);
    expect(l.destinations).toHaveLength(2);
    expect(l.auto_redirect_url).toBeNull();
  });

  it('sans lien configuré → aucune destination', () => {
    expect(reviewLanding({}).destinations).toEqual([]);
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

  it('courriel par défaut : objet résolu + bouton vers la page d’avis', () => {
    const mail = reviewEmail({}, vars);
    // L'objet ne répète plus le nom : l'expéditeur l'affiche déjà.
    expect(mail.subject).toBe('Votre avis compte pour nous');
    expect(mail.html).toContain(`href="${vars.survey_url}"`);
    expect(mail.html).toContain('Laisser un avis');
    expect(mail.html).not.toMatch(/[Nn]ote/);
    expect(mail.html).toContain('Lavage de vitres');
    expect(mail.html).toContain('Le bouton ne fonctionne pas ?');
  });

  it('courriel par défaut en anglais, bouton à la couleur de l’entreprise', () => {
    const mail = reviewEmail({}, vars, { langue: 'en', couleur: '#0a7d4f' });
    expect(mail.subject).toBe('Your review means a lot to us');
    expect(mail.html).toContain('Leave a review');
    expect(mail.html).toContain('background:#0a7d4f');
    expect(mail.html).not.toMatch(/Bonjour|Noter mon/);
    // Une couleur illisible retombe sur le noir, jamais une injection de style.
    expect(reviewEmail({}, vars, { couleur: 'red;x:1' }).html).toContain('background:#171717');
  });

  it('courriel personnalisé : paragraphes, HTML échappé, bouton ajouté à la fin si [survey_url] absent', () => {
    const mail = reviewEmail({
      review_email_subject: 'Votre avis, [client_first_name] ?',
      review_email_body: 'Bonjour [client_first_name],\n\nMerci <3 pour votre confiance.',
    }, vars);
    expect(mail.subject).toBe('Votre avis, Marie ?');
    expect(mail.html).toContain('<p style="margin:0 0 16px;">Bonjour Marie,</p>');
    expect(mail.html).toContain('Merci &lt;3 pour votre confiance.');
    expect(mail.html.indexOf('Laisser un avis')).toBeGreaterThan(mail.html.indexOf('confiance'));
    expect(mail.text.endsWith(vars.survey_url)).toBe(true);
  });

  it('textes de la page : défauts FR/EN puis personnalisés', () => {
    expect(surveyTexts({}, 'fr').question).toBe(DEFAULT_SURVEY_QUESTION_FR);
    expect(surveyTexts({}, 'en').question).toBe('Thank you for trusting us!');
    const t = surveyTexts({ review_survey_question: 'Un petit avis ?' }, 'fr');
    expect(t.question).toBe('Un petit avis ?');
    expect(t.invite_message).toBe(DEFAULT_REVIEW_INVITE_MESSAGE_FR);
  });
});
