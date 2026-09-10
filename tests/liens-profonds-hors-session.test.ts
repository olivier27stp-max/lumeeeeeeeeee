/**
 * LES LIENS PROFONDS OUVERTS SANS SESSION.
 *
 * Audit QA prod du 2026-09-09, n°7 (prouvé en prod) : /day, /clients,
 * /quotes/new, /settings/billing ouverts sans session → « 404 — Page not
 * found » de la vitrine marketing. Aucune redirection vers la connexion.
 * Le correctif existant ne traitait que l'événement SIGNED_OUT en cours de
 * session ; au chargement à froid (signet, lien reçu, onglet restauré,
 * session expirée), rien ne se passait.
 *
 * Règle figée ici :
 *   - une route de l'app ouverte sans session → /auth?next=<chemin>
 *   - une URL inconnue de la vitrine → 404 marketing (pas de boucle)
 *   - `next` n'est honoré que s'il est INTERNE : jamais //evil.com, jamais
 *     un schéma, jamais /auth lui-même
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cibleApresConnexion, estCibleInterne, rendueSansSession } from '../src/lib/routesSansSession';

const RACINE = resolve(__dirname, '..');

describe('cibleApresConnexion', () => {
  it('renvoie la page protégée demandée', () => {
    expect(cibleApresConnexion('?next=%2Fjobs')).toBe('/jobs');
    expect(cibleApresConnexion('?next=%2Fsettings%2Fbilling%3Ftab%3Dplan')).toBe('/settings/billing?tab=plan');
  });
  it('sans next → accueil', () => {
    expect(cibleApresConnexion('')).toBe('/');
    expect(cibleApresConnexion('?foo=bar')).toBe('/');
  });
  it('REFUSE toute redirection ouverte', () => {
    for (const mauvais of [
      'https://evil.com', '//evil.com', '//evil.com/jobs', '/\\evil.com', 'javascript:alert(1)',
      'evil.com', '', '/auth', '/auth?next=/jobs', '/register', '/jobs\r\nSet-Cookie: x',
    ]) {
      expect(estCibleInterne(mauvais), mauvais).toBe(false);
      expect(cibleApresConnexion(`?next=${encodeURIComponent(mauvais)}`), mauvais).toBe('/');
    }
  });
  it('accepte les chemins internes ordinaires', () => {
    for (const bon of ['/day', '/clients/abc-123', '/quotes/new', '/settings/billing', '/jobs?status=open']) {
      expect(estCibleInterne(bon), bon).toBe(true);
    }
  });
});

describe('le catch-all hors session', () => {
  const src = readFileSync(resolve(RACINE, 'src/routes/PublicRoutes.tsx'), 'utf8');

  it('ne rend plus MarketingNotFound directement en catch-all', () => {
    expect(src).not.toMatch(/path="\*"\s+element=\{<MarketingNotFound/);
    expect(src).toMatch(/path="\*"\s+element=\{<PublicCatchAll/);
  });
  it('redirige vers /auth?next= avec le chemin encodé', () => {
    expect(src).toContain('`/auth?next=${encodeURIComponent(pathname + search)}`');
  });
  it('les routes marketing et légales restent des 404 marketing (pas de boucle vers /auth)', () => {
    // Ce que rendueSansSession déclare public ne doit jamais rediriger.
    for (const p of ['/features/inconnu', '/pricing/x', '/privacy/y']) {
      expect(rendueSansSession(p), p).toBe(true);
    }
    for (const p of ['/day', '/jobs', '/clients/abc', '/settings/billing', '/invoices']) {
      expect(rendueSansSession(p), p).toBe(false);
    }
  });
});

describe('la connexion honore next', () => {
  const auth = readFileSync(resolve(RACINE, 'src/pages/Auth.tsx'), 'utf8');
  it('mot de passe et MFA naviguent vers cibleApresConnexion', () => {
    expect((auth.match(/navigate\(cibleApresConnexion\(location\.search\), \{ replace: true \}\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });
  it('Google range la destination dans sessionStorage, App.tsx la rejoue', () => {
    expect(auth).toContain('sessionStorage.setItem(CLE_NEXT');
    const app = readFileSync(resolve(RACINE, 'src/App.tsx'), 'utf8');
    expect(app).toContain('sessionStorage.getItem(CLE_NEXT)');
    expect(app).toContain('estCibleInterne(cible)');
  });
});
