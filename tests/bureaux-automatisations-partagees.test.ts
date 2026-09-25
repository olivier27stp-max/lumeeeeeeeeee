/**
 * Bureaux — phase 2 : automatisations partagées (2026-09-25). Preuve de bout
 * en bout contre staging : scripts/qa/bureaux-automatisations-partagees.mts (13/13).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { remapper, type Correspondances } from '../server/lib/automatisations-bureaux';

const lire = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
const c = (): Correspondances => ({
  pipelines: new Map([['pA', 'pB']]),
  etapes: new Map([['eA', 'eB']]),
  champs: new Map([['fA', 'fB']]),
  options: new Map([['oA', 'oB']]),
  regles: new Map([['rA', 'rB']]),
  membres: new Set(['u1']),
});

describe('remapper', () => {
  it('retrouve étape, champ, option, règle, et garde un membre du bureau cible', () => {
    const manquants = new Set<string>();
    const r = remapper([
      { type: 'move_deal_stage', config: { stage_id: 'eA' } },
      { type: 'update_custom_field', config: { field_id: 'fA', value: 'oA' } },
      { type: 'demarrer_automatisation', config: { rule_id: 'rA' } },
      { type: 'assigner_responsable', config: { membre_id: 'u1' } },
      { type: 'send_sms', config: { body: 'Bonjour {client}' } },
    ], c(), manquants);
    expect(r.map((a) => a.config)).toEqual([
      { stage_id: 'eB' }, { field_id: 'fB', value: 'oB' }, { rule_id: 'rB' }, { membre_id: 'u1' }, { body: 'Bonjour {client}' },
    ]);
    expect([...manquants]).toEqual([]);
  });

  it('vide ce qui n’existe pas dans le bureau cible et le signale', () => {
    const manquants = new Set<string>();
    const r = remapper({ stage_id: 'inconnu', membre_id: 'u2', champs_perso: [{ field_id: 'autre', value: ['oA', 'x'] }] }, c(), manquants);
    expect(r).toEqual({ stage_id: null, membre_id: null, champs_perso: [{ field_id: null, value: ['oB', 'x'] }] });
    expect([...manquants].sort()).toEqual(['champ personnalisé', 'personne assignée', 'étape du pipeline']);
  });

  it('parcourt les étapes d’une séquence (action imbriquée)', () => {
    const manquants = new Set<string>();
    const r = remapper([{ id: 's1', type: 'action', action: { type: 'move_deal_stage', config: { stage_id: 'eA' } }, suivant: 's2' }], c(), manquants);
    expect(r[0].action.config.stage_id).toBe('eB');
    expect(r[0].suivant).toBe('s2');
  });
});

describe('câblage', () => {
  it('routes gardées par automations.update', () => {
    const r = lire('server/lib/route-permissions.ts');
    expect(r).toContain("'POST /api/automations/rules/:id/copier-bureaux': 'automations.update'");
    expect(r).toContain("'GET /api/automations/bureaux-cibles': 'automations.update'");
  });
  it('un bureau cible exige automations.update dans CE bureau', () => {
    expect(lire('server/lib/automatisations-bureaux.ts')).toContain("hasPermission(ctx, 'automations.update')");
  });
  it('modifier une copie la détache ; modifier le modèle propage', () => {
    const r = lire('server/routes/automation-rules.ts');
    expect(r).toContain('if (existante.modele_id && contenuModifie) patch.modele_id = null;');
    expect(r).toContain('propagerAuxCopies(');
  });
});
