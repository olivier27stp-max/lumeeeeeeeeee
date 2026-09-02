import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Les liens invalides n'exposent plus la base de données.
 *
 * Trouvé le 2026-09-01 : une adresse avec un identifiant mal formé — vieux
 * lien, faute de frappe, lien partagé vers une fiche supprimée — affichait le
 * message brut de PostgreSQL :
 *
 *     invalid input syntax for type uuid: "identifiant-casse"
 *
 * Et quatre requêtes partaient vers la base AVANT toute vérification.
 *
 * Un utilisateur n'a rien à comprendre à un code d'erreur SQL. On refuse
 * l'identifiant en amont et on affiche un message qui a du sens.
 */

const RACINE = process.cwd();
const lire = (p: string) => fs.readFileSync(path.join(RACINE, p), 'utf8');

const PAGES_DETAIL = [
  ['src/pages/ClientDetails.tsx', 'Client introuvable'],
  ['src/pages/Clients.tsx', null],
] as const;

describe('les pages de détail refusent un identifiant mal formé', () => {
  for (const [fichier, message] of PAGES_DETAIL) {
    describe(fichier, () => {
      const source = lire(fichier);

      it('vérifie le format avant toute requête', () => {
        expect(source).toContain('const estUuid =');
        expect(source).toMatch(/\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/);
      });

      if (message) {
        it('affiche un message compréhensible', () => {
          expect(source).toContain(message);
        });
      }
    });
  }
});

describe('aucune page n\'affiche le message brut de la base', () => {
  const PAGES = [
    'src/pages/ClientDetails.tsx',
    'src/pages/JobDetails.tsx',
    'src/pages/RequestDetails.tsx',
  ];

  for (const f of PAGES) {
    it(`${f} filtre les erreurs techniques`, () => {
      const source = lire(f);
      // Le catch doit reconnaître les erreurs de format et les traduire.
      expect(source).toMatch(/invalid input \(syntax\|format\)|invalid input syntax/);
      expect(source).toContain('22P02');
    });
  }
});
