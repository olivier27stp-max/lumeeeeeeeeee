/**
 * LA FRONTIÈRE ENTRE LE SERVEUR ET LE NAVIGATEUR.
 *
 * `src/` est le dossier que Vite bundle : tout ce qui y est importé finit
 * dans le JavaScript public. Trois fichiers qui déchiffrent les clés Stripe
 * et PayPal (`crypto.ts`, `stripeClient.ts`, `paypalClient.ts`) y vivaient,
 * importés uniquement par `server/` — propre aujourd'hui, mais un seul import
 * accidentel depuis un composant React aurait publié la logique de
 * déchiffrement des secrets de paiement. C'est déjà arrivé une fois dans ce
 * dépôt (supabaseAdmin.ts). Audit 2026-09-09, I3 : ils sont sous server/lib/.
 *
 * Ce test fige la frontière : rien dans src/ n'importe node:crypto, la clé
 * service_role, ni un module de server/.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const RACINE = resolve(__dirname, '..');

function fichiers(dossier: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dossier)) {
    const p = join(dossier, e);
    if (statSync(p).isDirectory()) out.push(...fichiers(p));
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

/** Fichiers où une occurrence est acceptée, avec la raison. */
const DEROGATIONS: Record<string, string> = {
  // Exemple de code montré à l'utilisateur dans un gabarit de chaîne (panneau
  // de documentation des webhooks) — ce n'est pas un import du module.
  'src/pages/WebhookSettings.tsx': 'exemple de vérification de signature affiché en documentation',
};

const INTERDITS: Array<{ nom: string; motif: RegExp }> = [
  { nom: 'node:crypto', motif: /^\s*import\b[^;]*\bfrom\s+['"](node:)?crypto['"]/m },
  { nom: 'clé service_role', motif: /SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY/ },
  { nom: 'un module de server/', motif: /^\s*import\b[^;]*\bfrom\s+['"][^'"]*\/server\/[^'"]*['"]/m },
  { nom: 'les anciens modules secrets (crypto / stripeClient / paypalClient)', motif: /from\s+['"][^'"]*\/(stripeClient|paypalClient|crypto)['"]/ },
];

describe('src/ ne franchit pas la frontière', () => {
  const sources = fichiers(resolve(RACINE, 'src')).map((f) => ({
    chemin: relative(RACINE, f).replace(/\\/g, '/'),
    texte: readFileSync(f, 'utf8'),
  }));

  for (const { nom, motif } of INTERDITS) {
    it(`aucun fichier de src/ n'importe ${nom}`, () => {
      const fautifs = sources
        .filter((s) => !DEROGATIONS[s.chemin] && motif.test(s.texte))
        .map((s) => s.chemin);
      expect(fautifs).toEqual([]);
    });
  }

  it('les dérogations restent limitées et justifiées', () => {
    expect(Object.keys(DEROGATIONS)).toHaveLength(1);
    for (const [f, raison] of Object.entries(DEROGATIONS)) {
      expect(existsSync(resolve(RACINE, f)), f).toBe(true);
      expect(raison.length).toBeGreaterThan(10);
    }
  });
});

describe('les modules secrets vivent sous server/lib/', () => {
  for (const f of ['crypto.ts', 'stripeClient.ts', 'paypalClient.ts']) {
    it(`${f} est côté serveur et plus dans src/lib/`, () => {
      expect(existsSync(resolve(RACINE, 'server/lib', f)), `server/lib/${f}`).toBe(true);
      expect(existsSync(resolve(RACINE, 'src/lib', f)), `src/lib/${f}`).toBe(false);
    });
  }
});
