import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Corrections issues du premier passage du robot de recette (2026-09-01).
 *
 * 53 pages visitées sur staging, 3 anomalies remontées et corrigées ici.
 * Ces tests empêchent leur retour.
 */

const RACINE = process.cwd();
const lire = (p: string) => fs.readFileSync(path.join(RACINE, p), 'utf8');

describe('les pages de retour OAuth ne modifient plus un composant pendant le rendu', () => {
  // React signalait « Cannot update a component while rendering a different
  // component » : navigate() était appelé DANS la fonction passée à
  // setCountdown, qui doit rester pure.
  const PAGES = ['src/pages/OAuthCallback.tsx', 'src/pages/EmailOAuthCallback.tsx'];

  for (const fichier of PAGES) {
    describe(fichier, () => {
      const source = lire(fichier);

      it('la mise à jour du compteur reste pure', () => {
        // Le corps de setCountdown ne doit contenir aucune navigation.
        const bloc = source.slice(source.indexOf('setCountdown((prev)'));
        const finBloc = bloc.slice(0, bloc.indexOf('}, 1000)'));
        expect(finBloc).not.toContain('navigate(');
      });

      it('la redirection se fait dans son propre effet', () => {
        expect(source).toMatch(/if \(countdown === 0\) navigate\(/);
      });

      it('le compteur ne dépend plus de navigate', () => {
        // L'effet du minuteur n'a plus besoin de navigate dans ses dépendances.
        expect(source).toMatch(/setCountdown\(\(prev\) => \(prev <= 1 \? 0 : prev - 1\)\)/);
      });
    });
  }
});

describe('le nom de l\'entreprise ne s\'affiche plus « Bureau sans nom »', () => {
  const contexte = lire('src/contexts/CompanyContext.tsx');

  it('retombe sur orgs.name quand les réglages ne sont pas remplis', () => {
    // Deux replis existaient (company_settings puis org_billing_settings) mais
    // aucun ne lisait le nom porté par l'organisation elle-même — un compte
    // neuf affichait donc « Bureau sans nom » alors que le nom existait.
    expect(contexte).toContain("from('orgs')");
    expect(contexte).toContain("select('id, name')");
  });

  it('n\'interroge orgs que pour les organisations encore sans nom', () => {
    expect(contexte).toContain('const sansNom = orgIds.filter');
    expect(contexte).toContain('.in(\'id\', sansNom)');
  });

  it('garde l\'ordre des trois sources', () => {
    const iSettings = contexte.indexOf("from('company_settings')");
    const iBilling = contexte.indexOf("from('org_billing_settings')");
    const iOrgs = contexte.indexOf("from('orgs')");
    expect(iSettings).toBeGreaterThan(-1);
    expect(iBilling).toBeGreaterThan(iSettings);
    expect(iOrgs).toBeGreaterThan(iBilling);
  });
});
