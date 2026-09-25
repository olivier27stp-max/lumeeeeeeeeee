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
import { CARTE_APP, indexCarteApp } from '../../server/lib/support/carte-app';

const EXCLUES = new Set([
  '/', '/privacy', '/terms', '/subprocessors', '/pricing', '/checkout', '/checkout/success',
  '/apps/callback', '/email/callback', '/dev/plan-switch', '/creator-space/*', '/admin/migrations',
  '/company-settings', '/manage-team', '/settings/users', '/invoices', '/lume-agent', // redirections
  // Les deux orthographes françaises de « paramètres » : de pures
  // redirections vers /settings (P1-6), pas des écrans à décrire.
  '/parametres', '/paramètres',
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
  it('reste un texte borné : la carte est indexée par search_help (plus dans le prompt depuis #412), seul son index entre dans le prompt', () => {
    // 25 000 depuis les champs personnalisés v2 (2026-09-26) : la carte n'est plus dans le prompt,
    // seul son index y entre (borné juste en dessous) — l'agrandir ne coûte rien par tour.
    expect(CARTE_APP.length).toBeLessThan(25_000);
    expect(indexCarteApp().length).toBeLessThan(4_000);
    expect(CARTE_APP).toContain('/tasks');
  });
});
