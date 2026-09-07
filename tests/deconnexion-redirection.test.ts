/**
 * Une session qui tombe ne doit jamais laisser l'utilisateur sur un 404.
 *
 * Quand la session expire sur une route protégée (/jobs, /day…), l'app rend
 * PublicRoutes, dont seul le catch-all attrape cette route : « Page
 * introuvable ». App.tsx ramène alors à l'accueil, en se fiant à
 * `rendueSansSession` pour ne PAS le faire sur une page qui reste valable sans
 * compte — une soumission ouverte par un client, une page marketing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rendueSansSession, ROUTES_SANS_SESSION } from '../src/lib/routesSansSession';
import { CHEMINS_PUBLICS } from '../src/lib/mobileGate';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('une route protégée ramène à l’accueil quand la session tombe', () => {
  it.each(['/jobs', '/day', '/clients/abc', '/settings/billing', '/finances?tab=paiements'.split('?')[0]])(
    '%s n’est pas rendue sans session',
    (p) => expect(rendueSansSession(p)).toBe(false),
  );
});

describe('une page valable sans compte n’est pas quittée', () => {
  it.each([
    '/', '/auth', '/auth/callback', '/register', '/reset-password', '/verify-email',
    '/oauth/consent', '/apercu-mobile',
    '/features', '/solutions', '/industries', '/industries/lavage', '/pricing', '/contact',
    '/quote/abc123def456', '/contract/tok', '/pay/tok', '/form/0123456789abcdef0123456789abcdef',
    '/checkout', '/checkout/success', '/privacy', '/terms', '/subprocessors',
  ])('%s reste affichée', (p) => expect(rendueSansSession(p)).toBe(true));

  it('un préfixe ne suffit pas : /authentification n’est pas /auth', () => {
    expect(rendueSansSession('/authentification')).toBe(false);
    expect(rendueSansSession('/pricingx')).toBe(false);
  });
});

describe('la liste suit le fichier de routes', () => {
  it('chaque route de PublicRoutes.tsx est reconnue', () => {
    const src = read('src/routes/PublicRoutes.tsx');
    const chemins = [...src.matchAll(/<Route path="([^"*:]+)"/g)].map((m) => m[1]);
    expect(chemins.length).toBeGreaterThan(5);
    for (const c of chemins) {
      const p = c.startsWith('/') ? c : '/' + c;
      expect(rendueSansSession(p), p).toBe(true);
    }
  });

  it('les pages publiques rendues directement par App.tsx sont reconnues', () => {
    const src = read('src/App.tsx');
    // Seuls les retours anticipés `if (location.pathname === '/x') { return … }`
    // rendent une page sans session ; les comparaisons de isOAuthCallback, elles,
    // concernent des utilisateurs connectés.
    const chemins = [...src.matchAll(/if \(location\.pathname === '([^']+)'\) \{/g)].map((m) => m[1]);
    expect(chemins).toContain('/reset-password');
    for (const p of chemins) expect(rendueSansSession(p), p).toBe(true);
  });

  it('App.tsx ne garde plus la garde `&& prev` qui neutralisait la redirection', () => {
    const src = read('src/App.tsx');
    expect(src).not.toMatch(/SIGNED_OUT' && prev/);
    expect(src).toMatch(/SIGNED_OUT' && !rendueSansSession\(window\.location\.pathname\)/);
  });

  it('aucun doublon entre les deux listes', () => {
    const publics = CHEMINS_PUBLICS as readonly string[];
    for (const r of ROUTES_SANS_SESSION) expect(publics, r).not.toContain(r);
  });
});
