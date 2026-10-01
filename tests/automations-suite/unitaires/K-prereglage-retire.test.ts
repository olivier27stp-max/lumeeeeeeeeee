/**
 * K-004 — un préréglage dont plus rien n'émet le déclencheur n'est ni montré,
 * ni semé.
 *
 * `estimate_followup` attend `estimate.sent`. Aucun chemin de l'application
 * n'émet plus cet événement (K-003), mais le préréglage restait dans la liste
 * des automatisations : 9 entreprises l'affichaient « publié » en prod le
 * 2026-10-01 — une relance de devis annoncée, qui ne partait jamais.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PREREGLAGES_RETIRES, estPrereglageRetire } from '../../../src/lib/automationCatalogue';
import { AUTOMATION_PRESETS } from '../../../server/lib/automationPresets.data';
import { PACK_PARCOURS } from '../../../server/lib/automationPack.data';

describe('K — préréglage retiré', () => {
  it('[K-004] estimate_followup sur estimate.sent est retiré ; rebranché sur un vrai déclencheur, il redevient visible', () => {
    expect(estPrereglageRetire({ preset_key: 'estimate_followup', trigger_event: 'estimate.sent' })).toBe(true);
    expect(estPrereglageRetire({ preset_key: 'estimate_followup', trigger_event: 'quote.sent' })).toBe(false);
  });

  it('[K-004] aucune autre règle n’est touchée : autre préréglage, règle maison, clé piégée', () => {
    expect(estPrereglageRetire({ preset_key: 'quote_followup_1d', trigger_event: 'quote.sent' })).toBe(false);
    expect(estPrereglageRetire({ preset_key: null, trigger_event: 'estimate.sent' })).toBe(false);
    expect(estPrereglageRetire({ trigger_event: 'estimate.sent' })).toBe(false);
    expect(estPrereglageRetire({ preset_key: 'constructor', trigger_event: 'estimate.sent' })).toBe(false);
    expect(estPrereglageRetire({ preset_key: 'toString', trigger_event: undefined })).toBe(false);
  });

  it('[K-004] chaque préréglage retiré est bien semé sur son déclencheur mort — et lui seul dans tout le catalogue', () => {
    const catalogue = [...AUTOMATION_PRESETS, ...PACK_PARCOURS];
    const retires = catalogue.filter((p) => estPrereglageRetire(p)).map((p) => p.preset_key);
    expect(retires.sort()).toEqual(Object.keys(PREREGLAGES_RETIRES).sort());
    // Le déclencheur mort n'est porté par aucun préréglage encore offert.
    const morts = new Set(Object.values(PREREGLAGES_RETIRES));
    expect(catalogue.filter((p) => !estPrereglageRetire(p) && morts.has(p.trigger_event)).map((p) => p.preset_key)).toEqual([]);
  });

  it('[K-004] les quatre lecteurs passent par le filtre : liste de l’écran, route, éditeur, Lumi — et le semis', () => {
    const lire = (f: string) => readFileSync(f, 'utf8');
    expect(lire('src/lib/automationRulesApi.ts')).toMatch(/\.filter\(\(r\) => !estPrereglageRetire\(r\)\)/);
    const route = lire('server/routes/automation-rules.ts');
    expect(route.match(/!estPrereglageRetire\(r\)/g)?.length).toBe(2);
    expect(lire('server/lib/agent/tools-etendus.ts')).toMatch(/\.filter\(\(r\) => !estPrereglageRetire\(r\)\)/);
    expect(lire('server/lib/automationPresetSeeder.ts')).toMatch(/!have\.has\(p\.preset_key\) && !estPrereglageRetire\(p\)/);
  });
});
