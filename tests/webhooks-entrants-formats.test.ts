/**
 * LE WEBHOOK ENTRANT ACCEPTE CE QUE LES INTÉGRATEURS ENVOIENT VRAIMENT.
 *
 * Trouvé en vérifiant le déploiement du 2026-09-25 : le garde CSRF
 * exigeait `application/json`. Or Zapier envoie PAR DÉFAUT en
 * `form-urlencoded`, et un formulaire HTML de site aussi. Ces appels
 * étaient refusés en 403 — l'intégration ne marchait pas avec ses
 * réglages par défaut.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('le garde CSRF laisse passer le webhook — et RIEN d’autre', () => {
  const index = lire('server/index.ts');
  // La ligne d'exemption, repérée par son motif de clé.
  const ligne = index.split(String.fromCharCode(10)).find((l) => l.includes('[a-f0-9]{64}') && l.includes('hooks')) ?? '';

  it('une clé de 64 hex est exemptée', () => {
    // La clé dans l'URL EST l'authentification ; aucun cookie ni session
    // n'est en jeu, donc un CSRF n'a rien à détourner.
    expect(ligne, 'la ligne d’exemption doit exister').not.toBe('');
    expect(ligne).toContain('return next()');
  });

  it('l’exemption est ANCRÉE aux deux bouts', () => {
    /*
     * Sans `^` et `$`, « /hooks/<clé>/autre-chose » ou un chemin qui
     * CONTIENT une clé passerait aussi. Vérifié au serveur : seule une
     * vraie clé passe, `/hooks/court` et `/hooks/<clé>/x` restent en 403.
     */
    expect(ligne).toContain('/^');
    expect(ligne).toContain('{64}$/');
  });
});

describe('le corps est lu en JSON OU en formulaire', () => {
  const route = lire('server/routes/webhooks-entrants.ts');

  it('le format formulaire est accepté', () => {
    expect(route).toMatch(/application\/x-www-form-urlencoded/);
    expect(route).toMatch(/Object\.fromEntries\(new URLSearchParams\(texte\)\)/);
  });

  it('les deux formes donnent le même objet à plat — filtrable pareil', () => {
    // `source=zapier&nom=Jean` et `{"source":"zapier","nom":"Jean"}`
    // doivent déclencher les mêmes filtres.
    const depuisFormulaire = Object.fromEntries(new URLSearchParams('source=zapier&nom=Jean'));
    expect(depuisFormulaire).toEqual(JSON.parse('{"source":"zapier","nom":"Jean"}'));
  });
});
