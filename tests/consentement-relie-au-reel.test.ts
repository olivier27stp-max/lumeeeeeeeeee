import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Le bandeau de témoins était un décor.
 *
 * Constaté le 2026-09-26 : les trois cases « Statistiques », « Marketing » et
 * « Préférences » n'étaient lues NULLE PART. Le choix partait dans
 * localStorage et dans le journal `consents`, puis plus rien ne le
 * consultait — `readStoredConsent()` ne servait qu'au bandeau lui-même, pour
 * savoir s'il devait se remontrer.
 *
 * Pendant ce temps Sentry mesurait le parcours de chaque visiteur (traçage de
 * performance, `tracesSampleRate: 1.0`, démarré dans `main.tsx` avant même
 * l'affichage du bandeau), y compris après « Tout refuser » — alors que la
 * politique de confidentialité affirmait le contraire noir sur blanc.
 *
 * Ces tests verrouillent les deux moitiés du lien : une case ne survit que si
 * elle pilote quelque chose, et ce qui mesure demande d'abord la permission.
 */

const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
});

const RACINE = process.cwd();
const lire = (p: string) => fs.readFileSync(path.join(RACINE, p), 'utf8');

const { aConsentiAuxStatistiques, writeStoredConsent, CURRENT_COOKIE_POLICY_VERSION } =
  await import('../src/lib/consentApi');

describe('le consentement aux statistiques se refuse par défaut', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
  });

  it('aucun choix enregistré = pas de mesure', () => {
    expect(aConsentiAuxStatistiques()).toBe(false);
  });

  it('« Tout refuser » coupe la mesure', () => {
    writeStoredConsent({ analytics: false, marketing: false, preferences: true });
    expect(aConsentiAuxStatistiques()).toBe(false);
  });

  it('« Tout accepter » l\'autorise', () => {
    writeStoredConsent({ analytics: true, marketing: false, preferences: true });
    expect(aConsentiAuxStatistiques()).toBe(true);
  });

  it('un consentement donné sous une ANCIENNE politique ne vaut plus', () => {
    // Le seul cas qui invalide un choix. Les catégories du bandeau ont déjà
    // changé de sens une fois : un « oui » donné à l'ancienne formulation ne
    // peut pas valoir pour la nouvelle.
    store['lume.cookieConsent.v1'] = JSON.stringify({
      analytics: true, marketing: true, preferences: true,
      decidedAt: new Date().toISOString(),
      docVersion: 'cookie-policy-2026-07-23',
    });
    expect(aConsentiAuxStatistiques()).toBe(false);
  });

  it('un « oui » ancien reste valide tant que la politique n\'a pas bougé', () => {
    store['lume.cookieConsent.v1'] = JSON.stringify({
      analytics: true, marketing: false, preferences: true,
      decidedAt: new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString(),
      docVersion: CURRENT_COOKIE_POLICY_VERSION,
    });
    expect(aConsentiAuxStatistiques()).toBe(true);
  });
});

describe('Sentry ne mesure la performance qu\'avec le consentement', () => {
  const source = lire('src/lib/sentry.ts');

  it('passe par le point de vérité du consentement', () => {
    expect(source).toContain("from './consentApi'");
    expect(source).toContain('aConsentiAuxStatistiques()');
  });

  it('n\'utilise plus un taux figé à l\'initialisation', () => {
    // `tracesSampleRate` serait lu une fois pour toutes au démarrage : un
    // consentement retiré plus tard ne couperait rien jusqu'au rechargement.
    expect(source).not.toMatch(/^\s*tracesSampleRate:/m);
    expect(source).toContain('tracesSampler:');
  });

  it('renvoie zéro sans consentement', () => {
    expect(source).toMatch(/tracesSampler:\s*\(\)\s*=>\s*\(aConsentiAuxStatistiques\(\)\s*\?\s*\w+\(\)\s*:\s*0\)/);
  });

  it('garde le signalement des pannes actif — c\'est une autre base légale', () => {
    // Couper aussi les erreurs nous rendrait aveugles aux pannes des clients
    // qui refusent la mesure. Intérêt légitime, documenté dans la politique.
    expect(source).toContain('export function captureClientException');
    expect(source).not.toMatch(/captureClientException[\s\S]{0,400}aConsentiAuxStatistiques/);
  });

  it('n\'enregistre jamais l\'écran de l\'utilisateur', () => {
    expect(source).toContain('replaysSessionSampleRate: 0');
    expect(source).toContain('replaysOnErrorSampleRate: 0');
  });
});

describe('le bandeau ne propose que des cases qui pilotent quelque chose', () => {
  const banniere = lire('src/components/CookieBanner.tsx');

  it('plus de case « Marketing » : aucun traceur publicitaire n\'existe', () => {
    expect(banniere).not.toContain('t.cookies.marketing');
    for (const fichier of ['src/i18n/fr.ts', 'src/i18n/en.ts']) {
      expect(lire(fichier), `libellé mort resté dans ${fichier}`).not.toContain('marketingDesc:');
    }
  });

  it('plus de case « Préférences » : c\'est du stockage strictement nécessaire', () => {
    expect(banniere).not.toContain('t.cookies.preferences');
    for (const fichier of ['src/i18n/fr.ts', 'src/i18n/en.ts']) {
      expect(lire(fichier), `libellé mort resté dans ${fichier}`).not.toContain('preferencesDesc:');
    }
  });

  it('la case restante est bien branchée sur le champ lu par Sentry', () => {
    expect(banniere).toContain('t.cookies.analytics');
    expect(banniere).toContain('analytics: statsAcceptees');
  });

  it('journalise quand même l\'état réel des quatre finalités', () => {
    // Le registre doit rester lisible par un enquêteur : « marketing refusé »
    // est une information, l'absence de ligne n'en est pas une.
    expect(banniere).toContain('marketing: false');
    expect(banniere).toContain('preferences: true');
  });

  it('refuser reste aussi facile qu\'accepter', () => {
    expect(banniere).toContain('t.cookies.acceptAll');
    expect(banniere).toContain('t.cookies.rejectAll');
  });
});

describe('le journal distingue le consenti de l\'imposé', () => {
  const api = lire('src/lib/consentApi.ts');

  it('les finalités imposées ne sont pas marquées « web-banner »', () => {
    // Écrire 'web-banner' sur une case que personne n'a vue reviendrait à
    // fabriquer un consentement dans un registre censé faire preuve.
    expect(api).toContain("['cookies-essential', true, 'strictement-necessaire']");
    expect(api).toContain("['cookies-preferences', choice.preferences, 'strictement-necessaire']");
    expect(api).toContain("['cookies-analytics', choice.analytics, 'web-banner']");
  });
});

describe('la politique de confidentialité décrit ce qui tourne vraiment', () => {
  const politique = lire('src/pages/Privacy.tsx');

  it('ne promet plus des « témoins de marketing sous consentement » inexistants', () => {
    expect(politique).not.toContain("Les témoins d'analyse et de marketing ne sont déposés qu'avec votre consentement");
  });

  it('nomme le sous-traitant et sépare les deux bases légales', () => {
    expect(politique).toContain('Sentry');
    expect(politique).toContain('intérêt légitime');
  });
});
