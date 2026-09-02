import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * La liste des jobs n'affiche aucun prix à qui n'a pas le droit d'en voir.
 *
 * Trouvé le 2026-09-01 en ouvrant une session technicien dans un vrai
 * navigateur : /jobs affichait 450 $, 850 $, 675 $ — de vrais montants
 * (Réparation clôture, Peinture balcon, Entretien commercial).
 *
 * La page de détail (JobDetails.tsx:144) faisait déjà ce contrôle ; la liste
 * ne le faisait pas. Un technicien voyait donc les prix de tous les jobs en
 * ouvrant simplement le menu.
 *
 * Le droit suit le réglage de l'entreprise (écran des rôles) : par défaut
 * refusé, activable par l'entrepreneur.
 */

const RACINE = process.cwd();
const lire = (p: string) => fs.readFileSync(path.join(RACINE, p), 'utf8');

describe('la liste des jobs contrôle la permission', () => {
  const source = lire('src/pages/Jobs.tsx');

  it('elle consulte le contexte de permissions', () => {
    expect(source).toContain('usePermissions');
    expect(source).toContain("hasPermission(permsCtx.permissions, 'financial.view_pricing'");
  });

  it('formatMoney ne rend rien sans le droit', () => {
    const bloc = source.slice(source.indexOf('const formatMoney'));
    const fin = bloc.slice(0, bloc.indexOf('};'));
    expect(fin).toContain('if (!peutVoirLesPrix) return');
  });

  it('propriétaire et administrateur gardent l\u2019accès', () => {
    expect(source).toMatch(/permsCtx\.role === 'owner' \|\| permsCtx\.role === 'admin'/);
  });
});

describe('la page de détail garde son contrôle', () => {
  it('JobDetails vérifiait déjà la permission', () => {
    // C'est le modèle qu'on a repris ; il ne doit pas disparaître.
    const source = lire('src/pages/JobDetails.tsx');
    expect(source).toContain("hasPermission(permsCtx.permissions, 'financial.view_pricing'");
  });
});
