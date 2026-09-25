// Deux défauts d'affichage signalés le 2026-09-25, tous deux dans la même
// page : Paramètres → Formulaire de demande.
//
// 1. « je ne vois pas mon ancienne ni où m'en faire des nouvelles »
//    La barre des formulaires ne s'affichait qu'à partir de DEUX formulaires.
//    Mais c'est elle qui porte « + Nouveau formulaire » : avec un seul —
//    donc dans le cas de tout le monde au départ — il devenait impossible
//    d'en créer un second. Le raisonnement était à l'envers : c'est
//    précisément là qu'elle sert le plus.
//
// 2. « je dois recliquer dessus pour que ça apparaisse »
//    `PlanFeatureGate` faisait `if (loading) return null` : pendant la
//    vérification du forfait, la page était VIDE — pas un indicateur, rien.
//    L'utilisateur croyait que le lien n'avait pas marché et recliquait ; au
//    second clic le forfait était en cache, d'où « il faut cliquer deux
//    fois ».
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const ecran = () => fs.readFileSync('src/pages/RequestFormSettings.tsx', 'utf8');
const gate = () => fs.readFileSync('src/components/PlanFeatureGate.tsx', 'utf8');

describe('la barre des formulaires est toujours atteignable', () => {
  it("ne se cache plus quand il n'y a qu'un seul formulaire", () => {
    const s = ecran();
    // La condition qui la cachait ne doit pas revenir.
    expect(s).not.toContain('formulaires.length > 1 || !form');
  });

  it('« + Nouveau formulaire » reste dans la page', () => {
    const s = ecran();
    expect(s).toContain('onClick={nouveauFormulaire}');
    expect(s).toMatch(/Nouveau formulaire/);
  });

  it('le formulaire existant est listé', () => {
    expect(ecran()).toContain('formulaires.map((f)');
  });
});

describe('la page ne reste jamais vide pendant la vérification du forfait', () => {
  it('PlanFeatureGate montre un indicateur, pas du vide', () => {
    const s = gate();
    // `return null` pendant le chargement = écran blanc = « ça n'a pas marché ».
    expect(s).not.toMatch(/if \(loading\) return null;/);
    expect(s).toContain('animate-spin');
  });

  it("l'indicateur est annoncé aux lecteurs d'écran", () => {
    const s = gate();
    expect(s).toContain('role="status"');
    expect(s).toContain('aria-live="polite"');
    // Un spinner sans texte ne dit rien à qui ne le voit pas.
    expect(s).toContain('sr-only');
  });
});
