/**
 * Crédits Lumi — garde statique (2026-09-30).
 *
 * Décision du propriétaire : l'usage IA de Lumi se compte en crédits, et
 * AUCUN montant en dollars d'IA n'est affiché au client (ni « 45 $ », ni
 * « 1 crédit = X $ », ni coût par réponse). Autopilot inclut des crédits
 * mensuels : Lumi n'est plus « illimité » nulle part.
 *
 * Les tests jsdom (lumi-credits-page, lumi-credits-facturation-prix)
 * vérifient l'écran ; celui-ci empêche le retour des anciens morceaux de code
 * dans les fichiers qui parlent de Lumi au client.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
/** Le code sans ses lignes de commentaire : un commentaire qui explique « jamais illimité » n'est pas une promesse. */
const code = (f: string) => lire(f).split(/\r?\n/).filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');

const FICHIERS = [
  'src/pages/Lumi.tsx',
  'src/pages/settings/BillingSettings.tsx',
  'src/pages/marketing/Pricing.tsx',
  'src/components/automations/ClavardageLumi.tsx',
  'src/lib/planFeatures.ts',
  'src/components/lumi/CreditsLumi.tsx',
  'src/components/lumi/SectionCreditsLumi.tsx',
  'src/components/ExploreFeaturesModal.tsx',
  'src/pages/marketing/homeApercuSections.tsx',
  'src/pages/marketing/fonctionsData.ts',
];

describe('crédits Lumi — plus de dollars ni d’« illimité » dans les écrans Lumi', () => {
  it.each(FICHIERS)('%s : aucun fmtDollars, aucun « budget IA / budget Lumi »', (f) => {
    const src = code(f);
    expect(src).not.toContain('fmtDollars');
    expect(src).not.toMatch(/budget IA|AI budget|budget Lumi|Lumi budget/i);
  });

  it.each(FICHIERS.filter((f) => f !== 'src/lib/planFeatures.ts'))('%s : aucun « illimité / unlimited »', (f) => {
    expect(code(f)).not.toMatch(/illimit|unlimited/i);
  });

  it('planFeatures : l’ancien libellé « unlimited » n’existe plus que comme clé à REMPLACER', () => {
    const src = code('src/lib/planFeatures.ts');
    const lignes = src.split('\n').filter((l) => /illimit|unlimited/i.test(l));
    // Une seule ligne : la correspondance ancien → nouveau libellé, dont la
    // valeur (ce qui s'affiche) ne promet plus rien d'illimité.
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatch(/'Lume AI Agent \(voice \+ unlimited\)': 'Lume AI Agent \(voice\) — 1,000 Lumi credits \/ month'/);
    expect(src).toContain("'Lume AI Agent (voice) — 1,000 Lumi credits / month': 'Agent IA Lume (voix) — 1 000 crédits Lumi / mois'");
  });

  it('page Lumi : plus de coût par réponse ni par conversation (cost_cents), plus d’objet budget', () => {
    const page = lire('src/pages/Lumi.tsx');
    expect(page).not.toMatch(/cost_cents|budget_cents|depense_cents|BudgetLumi/);
    const api = lire('src/lib/lumiApi.ts');
    expect(api).not.toMatch(/cost_cents|BudgetLumi/);
  });

  it('i18n : une seule clé pour le libellé, en FR et en EN, sans dollars', () => {
    for (const [f, unite] of [['src/i18n/fr.ts', 'crédits Lumi'], ['src/i18n/en.ts', 'Lumi credits']] as const) {
      const src = lire(f);
      const debut = src.indexOf('lumiCredits: {');
      const bloc = src.slice(debut, src.indexOf('\n  },', debut));
      expect(bloc).toContain(`unit: '${unite}'`);
      // Le libellé n'est écrit qu'une fois : tout le reste passe par {unit}.
      expect(bloc.split(unite).length - 1).toBe(1);
      expect(bloc).not.toContain('$');
    }
  });
});
