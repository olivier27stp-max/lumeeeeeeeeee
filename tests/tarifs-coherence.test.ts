/**
 * LES PRIX VIVENT À TROIS ENDROITS (2026-09-22).
 *
 * La page Tarifs (`Pricing.tsx`), la table `plans` (ce que le checkout
 * facture) et Stripe (les prix réels). Trois copies d'un même chiffre
 * finissent toujours par diverger : un client verrait 347 sur la page et
 * serait débité 340.
 *
 * Ce test verrouille les deux copies qui vivent dans le dépôt : la page et
 * la migration. Stripe se vérifie à la main (un prix y est immuable, on en
 * crée de nouveaux) — voir le prompt de mise à jour livré avec ce chantier.
 *
 * Règle de la grille, décidée le 2026-09-22 :
 *   Minimum    150 CAD · 10 % de rabais annuel
 *   Scale      347 CAD · 15 %
 *   Autopilot  495 CAD · 30 %  → 347/mois en annuel, soit le mensuel de Scale
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const racine = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(racine, p), 'utf8');

/** La grille qui fait foi. Changer un prix = changer CE tableau, puis les deux sources. */
const GRILLE = [
  { slug: 'starter', nom: 'Minimum', cad: 150, usd: 109, rabais: 0.10, annuelCad: 135 },
  { slug: 'pro', nom: 'Scale', cad: 347, usd: 249, rabais: 0.15, annuelCad: 295 },
  { slug: 'autopilot', nom: 'Autopilot', cad: 495, usd: 359, rabais: 0.30, annuelCad: 347 },
] as const;

const page = lire('src/pages/marketing/Pricing.tsx');
const migration = lire('supabase/migrations/20260922000000_tarifs_rabais_annuels.sql');

describe('grille tarifaire — page et base d accord', () => {
  it.each(GRILLE)('$nom : la page affiche le bon mensuel et le bon rabais', (p) => {
    const bloc = page.slice(page.indexOf(`name: '${p.nom}'`), page.indexOf(`name: '${p.nom}'`) + 1200);
    expect(bloc).toContain(`CAD: { monthly: ${p.cad}`);
    expect(bloc).toContain(`USD: { monthly: ${p.usd}`);
    expect(bloc).toMatch(new RegExp(`annualDiscount: ${String(p.rabais).replace('.', '\\.')}`));
  });

  it.each(GRILLE)('$nom : la migration écrit les mêmes montants, en cents', (p) => {
    const bloc = migration.slice(migration.indexOf(`slug = '${p.slug}'`) - 400, migration.indexOf(`slug = '${p.slug}'`));
    expect(bloc).toContain(`monthly_price_cad = ${p.cad * 100}`);
    expect(bloc).toContain(`monthly_price_usd = ${p.usd * 100}`);
    // L'annuel est toujours douze fois le mensuel remisé : jamais un montant
    // saisi à la main, sinon le rabais affiché ment.
    expect(bloc).toContain(`yearly_price_cad = ${p.annuelCad * 12 * 100}`);
  });

  it('Autopilot en annuel vaut exactement le mensuel de Scale', () => {
    const scale = GRILLE.find((p) => p.slug === 'pro')!;
    const autopilot = GRILLE.find((p) => p.slug === 'autopilot')!;
    expect(autopilot.annuelCad).toBe(scale.cad);
  });

  it('l ancien modèle « prix de première année » a bien disparu', () => {
    // La page promettait « X la première année, puis Y » : deux montants
    // saisis à la main, sans lien avec le rabais annoncé.
    expect(page).not.toContain('annualFirstYr');
    expect(page).not.toContain('annualFullYr');
  });

  it('la bascule annonce « jusqu à » : le rabais n est pas le même partout', () => {
    // Annoncer « −30 % » sec serait faux pour Minimum (10 %) et Scale (15 %).
    expect(page).toMatch(/upTo:/);
    expect(page).toContain('c.upTo(bestDiscount)');
  });
});
