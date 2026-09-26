// Le trimestriel doit pouvoir être souscrit ET programmé.
//
// CE QUE CES TESTS PROTÈGENT. Six liens de paiement trimestriels existent
// chez Stripe (450 / 327 / 1041 / 747 / 1485 / 1077, soit exactement 3 × le
// mensuel). Deux choses devaient suivre côté Lume :
//
//   1. la validation Zod — trois routes refusaient `quarterly` AVANT que la
//      requête atteigne la base, donc le lien Stripe était rejeté ;
//   2. le CHECK sur `scheduled_interval` — il limitait à monthly/yearly, ce
//      qui empêchait de PROGRAMMER un passage au trimestriel.
//
// Vérifié en base avant d'écrire : `subscriptions.interval` est du texte
// libre, sans contrainte. Souscrire un trimestriel passait déjà ; c'est le
// changement de forfait en cours d'abonnement qui échouait. La distinction
// compte — elle dit ce qui était réellement cassé.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const billing = () => fs.readFileSync('server/routes/billing.ts', 'utf8');
const migration = () => fs.readFileSync(
  'supabase/migrations/20260926160000_abonnement_trimestriel_programmable.sql', 'utf8');
const resolveur = () => fs.readFileSync('server/lib/abonnement-intervalle.ts', 'utf8');

describe('la validation accepte le trimestriel', () => {
  it('les trois routes de facturation le reconnaissent', () => {
    const s = billing();
    // L'ancienne forme ne doit subsister nulle part : une seule route
    // oubliée, et le lien Stripe correspondant est refusé en silence.
    expect(s).not.toContain("z.enum(['monthly', 'yearly'])");
    const n = (s.match(/z\.enum\(\['monthly', 'quarterly', 'yearly'\]\)/g) || []).length;
    expect(n).toBe(3);
  });
});

describe('la base accepte un changement programmé vers le trimestriel', () => {
  it('le CHECK liste les trois intervalles', () => {
    const s = migration();
    expect(s).toMatch(/check \(scheduled_interval = any \(array\['monthly'::text, 'quarterly'::text, 'yearly'::text\]\)\)/);
  });

  it('la migration est additive — aucune ligne touchée', () => {
    const s = migration();
    // On élargit un CHECK. Un update/delete ici toucherait de vrais
    // abonnements payants.
    expect(s).not.toMatch(/\bdelete from\b/i);
    expect(s).not.toMatch(/\bupdate public\.subscriptions\b/i);
  });

  it('le rollback est écrit, avec sa condition', () => {
    // Restaurer l'ancien CHECK échouerait si une ligne porte déjà
    // 'quarterly' : la migration le dit au lieu de le laisser découvrir.
    const s = migration();
    expect(s).toContain('ROLLBACK');
    expect(s).toContain("scheduled_interval = 'quarterly'");
  });
});

describe('le trimestriel vaut 3 × le mensuel, sans remise', () => {
  it('aucune colonne de prix trimestriel n est créée', () => {
    // Le résolveur calcule `monthly × 3`. Ajouter des colonnes obligerait à
    // les tenir en accord avec Stripe à chaque changement de prix.
    const s = migration();
    expect(s).not.toMatch(/add column .*quarterly_price/i);
  });

  it('le résolveur applique bien le facteur 3', () => {
    const s = resolveur();
    expect(s).toMatch(/case 'quarterly': return lire\(`monthly_price_\$\{dev\}`\) \* 3;/);
  });

  it('une période trimestrielle dure 3 mois', () => {
    // Ni 1 (mensuel), ni 12 (annuel) : le défaut classique quand une
    // troisième valeur tombe dans la branche « mensuel » d'un ternaire.
    const s = resolveur();
    expect(s).toMatch(/case 'quarterly': fin\.setMonth\(fin\.getMonth\(\) \+ 3\); return fin;/);
    expect(s).toMatch(/case 'quarterly': return 3;/);
  });
});
