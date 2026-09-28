/**
 * L'interrupteur ROUGE veut dire « rien ne part » — y compris ce qui était
 * déjà prévu. Constaté le 2026-09-28 : repasser « Relance de devis » en
 * brouillon laissait partir les relances déjà en file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { motifAnnulationRegle } from '../../server/lib/automationEngine';

describe('une tâche prévue dont la règle ne tourne plus', () => {
  it('brouillon → annulée, avec le motif', () => {
    expect(motifAnnulationRegle({ is_active: false, deleted_at: null })).toMatch(/brouillon/);
  });
  it('corbeille → annulée', () => {
    expect(motifAnnulationRegle({ is_active: false, deleted_at: '2026-09-28T00:00:00Z' })).toMatch(/supprimée/);
  });
  it('publiée → part normalement', () => {
    expect(motifAnnulationRegle({ is_active: true, deleted_at: null })).toBeNull();
  });
  it('règle inconnue → pas de décision ici', () => {
    expect(motifAnnulationRegle(null)).toBeNull();
  });
});

describe('le moteur applique la règle', () => {
  const moteur = readFileSync(resolve(__dirname, '../../server/lib/automationEngine.ts'), 'utf8');
  it('lit is_active et deleted_at avec la tâche', () => {
    expect(moteur).toMatch(/conditions, steps, settings, is_active, deleted_at\)/);
  });
  it('annule AVANT tout envoi, juste après la pause d’entreprise', () => {
    const iPause = moteur.indexOf('await orgEnPause(supabase, task.org_id)) continue;');
    const iAnnule = moteur.indexOf('const motifAnnulation = motifAnnulationRegle(task.automation_rules);');
    const iEnvoi = moteur.indexOf('horsFenetre(reglagesRegle, new Date(), fuseauTache)');
    expect(iPause).toBeGreaterThan(-1);
    expect(iAnnule).toBeGreaterThan(iPause);
    expect(iAnnule).toBeLessThan(iEnvoi);
  });
});
