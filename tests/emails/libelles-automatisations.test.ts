/**
 * Lot 6 — l'interface ne doit pas parler anglais à un client francophone.
 *
 * Deux tables décrivent les automatisations côté front :
 *   · PRESET_META   (Automations.tsx)       — icône + catégorie ;
 *   · RULE_LABELS_FR (SettingsMessaging.tsx) — libellé français.
 *
 * Elles dérivaient chacune de leur côté du catalogue réel
 * (automationPresets.data.ts), sans que rien ne le signale :
 *   · PRESET_META portait 5 clés `invoice_reminder_*` qui n'existent plus,
 *     laissant croire à cinq relances de facture de plus qu'il n'y en a ;
 *   · RULE_LABELS_FR n'en couvrait que 28 sur 35. Pour les 7 autres, le repli
 *     affichait `rule.name` — le nom ANGLAIS du preset. Mesuré en production :
 *     « Cross-Sell — 30 Days After Job », « Google Review Request ».
 *
 * Ces tests figent l'alignement des trois sources.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** Clés du catalogue réel — la seule source de vérité. */
function presetKeys(): Set<string> {
  const s = read('server/lib/automationPresets.data.ts');
  const debut = s.indexOf('= [', s.indexOf('AUTOMATION_PRESETS')) + 2;
  const presets = JSON.parse(s.slice(debut, s.lastIndexOf('];') + 1));
  return new Set(presets.map((p: any) => p.preset_key));
}

/**
 * Extrait les clés d'un objet littéral `NOM: Record<...> = { ... }`.
 *
 * `valeurObjet` distingue les deux formes rencontrées : PRESET_META associe
 * chaque clé à un objet (`cle: { icon, category }`), RULE_LABELS_FR à une
 * chaîne (`cle: 'libellé'`). Sans cette distinction, `icon` et `category`
 * étaient comptés comme des noms de presets.
 */
function clesDe(fichier: string, nom: string, valeurObjet = false): Set<string> {
  const s = read(fichier);
  const i = s.indexOf(nom);
  expect(i, `${nom} introuvable dans ${fichier}`).toBeGreaterThan(-1);
  const bloc = s.slice(i, s.indexOf('\n};', i));
  const motif = valeurObjet ? /^\s{2}([a-z_0-9]+)\s*:\s*\{/gm : /^\s{2}([a-z_0-9]+)\s*:\s*["']/gm;
  const cles = new Set([...bloc.matchAll(motif)].map((m) => m[1]));
  // Un extracteur qui ne trouve rien rendrait tous les tests verts sans rien
  // vérifier — c'est le pire résultat possible.
  expect(cles.size, `aucune clé extraite de ${nom}`).toBeGreaterThan(20);
  return cles;
}

describe('les tables du front suivent le catalogue réel', () => {
  it('PRESET_META ne déclare aucun preset fantôme', () => {
    // Les `invoice_reminder_*` (sans `sent_`) sont d'anciens noms. Vérifié en
    // base avant retrait : 0 règle les utilise, ni en prod ni sur staging.
    const reels = presetKeys();
    const fantomes = [...clesDe('src/pages/Automations.tsx', 'PRESET_META', true)]
      .filter((k) => !reels.has(k));
    expect(fantomes, `clés sans preset : ${fantomes.join(', ')}`).toEqual([]);
  });

  it('chaque preset a une icône et une catégorie', () => {
    const meta = clesDe('src/pages/Automations.tsx', 'PRESET_META', true);
    const sansMeta = [...presetKeys()].filter((k) => !meta.has(k));
    expect(sansMeta, `presets sans META : ${sansMeta.join(', ')}`).toEqual([]);
  });

  it('chaque preset a un libellé français', () => {
    // Sans libellé, le repli affiche `rule.name` — l'anglais du catalogue.
    const labels = clesDe('src/pages/SettingsMessaging.tsx', 'RULE_LABELS_FR');
    const sansLabel = [...presetKeys()].filter((k) => !labels.has(k));
    expect(sansLabel, `presets affichés en anglais : ${sansLabel.join(', ')}`).toEqual([]);
  });

  it('aucun libellé ne traîne pour un preset disparu', () => {
    const reels = presetKeys();
    const orphelins = [...clesDe('src/pages/SettingsMessaging.tsx', 'RULE_LABELS_FR')]
      .filter((k) => !reels.has(k));
    expect(orphelins, `libellés orphelins : ${orphelins.join(', ')}`).toEqual([]);
  });

  it('les libellés ajoutés sont bien en français', () => {
    // Garde-fou contre un copier-coller du nom anglais.
    const s = read('src/pages/SettingsMessaging.tsx');
    const i = s.indexOf('RULE_LABELS_FR');
    const bloc = s.slice(i, s.indexOf('\n};', i));
    for (const cle of ['google_review', 'cross_sell_30d', 'estimate_followup']) {
      const m = new RegExp(cle + ":\\s*(['\"])(.+?)\\1").exec(bloc);
      expect(m, `${cle} sans libellé`).not.toBeNull();
      expect(m![2]).not.toMatch(/\b(Follow-Up|Request|Days|After Job|Reminder)\b/);
    }
  });
});
