/**
 * La carte de l'app du support (server/lib/support/carte-app.ts) couvre TOUS
 * les écrans de l'app : chaque route déclarée dans src/App.tsx et chaque page
 * du menu Paramètres (SettingsLayout.tsx) doit y être nommée. Un nouvel écran
 * sans ligne dans la carte fait échouer ce test : Lumi ne doit jamais
 * découvrir un écran par un client.
 *
 * Exclues : les pages publiques/marketing, les redirections, les retours
 * OAuth, les pages dev/admin plateforme et l'espace créateur.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CARTE_APP } from '../../server/lib/support/carte-app';

const EXCLUES = new Set([
  '/', '/privacy', '/terms', '/subprocessors', '/pricing', '/checkout', '/checkout/success',
  '/apps/callback', '/email/callback', '/dev/plan-switch', '/creator-space/*', '/admin/migrations',
  '/company-settings', '/manage-team', '/settings/users', '/invoices', '/lume-agent', // redirections
  '/settings/team/:memberId', '/settings/team/:memberId/profile', // fiche membre (détail de /settings/team)
]);

function routesApp(): string[] {
  const src = readFileSync('src/App.tsx', 'utf8');
  return [...new Set([...src.matchAll(/path="(\/[^"]*)"/g)].map((m) => m[1]))].filter((p) => !EXCLUES.has(p));
}
function routesParametres(): string[] {
  const src = readFileSync('src/pages/settings/SettingsLayout.tsx', 'utf8');
  return [...new Set([...src.matchAll(/path: '(\/settings\/[a-z-]+)'/g)].map((m) => m[1]))];
}
/** Une route dynamique (/jobs/:id) est couverte si sa base (/jobs) l'est. */
const base = (p: string) => p.replace(/\/:[^/]+.*$/, '').replace(/\/(new|edit|measure|presets|templates|builder|hub|success|general|teams)$/, '') || p;

describe('carte de l’app du support', () => {
  it('nomme chaque écran de l’app (App.tsx) et chaque page des Paramètres', () => {
    const manquantes = [...routesApp(), ...routesParametres()].filter((p) => !CARTE_APP.includes(base(p)) && !CARTE_APP.includes(p));
    expect(manquantes, `écrans absents de carte-app.ts : ${manquantes.join(', ')}`).toEqual([]);
  });
  it('reste un texte borné, en cache : moins de 16 000 caractères (≈ 6 000 tokens, lus au dixième du prix)', () => {
    expect(CARTE_APP.length).toBeLessThan(16_000);
    expect(CARTE_APP).toContain('/tasks');
  });
});
