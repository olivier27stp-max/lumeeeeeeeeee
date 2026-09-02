/**
 * La devise de l'organisation se lit sur `company_settings`, jamais sur
 * `org_billing_settings`.
 *
 * HISTOIRE DE CE BUG — il est revenu DEUX fois
 *   a7da488  corrige : la devise était lue sur `org_billing_settings`
 *   bd81fcf  réintroduit, par une résolution de fusion sur un commit qui
 *            n'avait rien à voir (adresse de propriété dans le formulaire)
 *
 * `org_billing_settings` ne porte pas de colonne `currency`. La demander
 * renvoie un 400 et, comme supabase-js ne lève jamais d'exception, le modal
 * retombait en silence sur la devise par défaut. Personne ne voyait rien.
 *
 * Ce test lit le VRAI fichier source : c'est le seul moyen d'attraper une
 * régression introduite par une fusion, qu'aucun test de comportement ne
 * verrait puisque le code « marche » — il donne juste la mauvaise devise.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(__dirname, '../src/components/NewJobModal.tsx'),
  'utf8',
);

/** Le bloc qui va chercher la devise, isolé de tout le reste du fichier. */
function blocDevise(): string {
  const i = source.indexOf(".select('currency')");
  expect(i, 'le formulaire ne lit plus de devise du tout').toBeGreaterThan(-1);
  // Une fenêtre en amont suffit à contenir le `.from(...)` correspondant.
  return source.slice(Math.max(0, i - 400), i + 200);
}

describe('la devise de l’org vient de la bonne table', () => {
  it('elle est lue sur company_settings', () => {
    expect(blocDevise()).toContain("from('company_settings')");
  });

  it('elle n’est PAS lue sur org_billing_settings — cette table n’a pas de currency', () => {
    expect(blocDevise()).not.toContain("from('org_billing_settings')");
  });

  it('l’erreur éventuelle n’est pas avalée', () => {
    // C'est ce silence qui a laissé le bug vivre en production. Sans
    // remontée d'erreur, la prochaine régression serait de nouveau muette.
    expect(blocDevise()).toMatch(/\berror\b/);
  });
});
