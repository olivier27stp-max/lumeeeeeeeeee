/**
 * Une règle d'automatisation attachée à une étape ne doit se déclencher QUE
 * pour cette étape.
 *
 * `automation_rules` porte `pipeline_id` et `stage_id` depuis la migration
 * 20260923100100, mais le moteur ne les regardait pas : il filtrait sur
 * l'organisation et le type d'événement, rien d'autre. Une règle attachée à
 * « Contacté » se déclenchait donc à l'entrée dans n'importe quelle étape.
 *
 * Personne ne l'avait vu, parce que la base était irréprochable : les
 * colonnes existaient, les clés étrangères aussi. Seule l'exécution le
 * montrait — le banc `scripts/qa/verifier-moteur-pipeline.mjs` a créé deux
 * tâches là où une seule était attendue.
 *
 * Ce test fige le comportement pour que le choix d'étape de la page
 * Automatisations ne redevienne jamais décoratif.
 */
import { describe, it, expect } from 'vitest';
import { regleViseCetEvenement } from '../server/lib/automationEngine';

const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '22222222-2222-2222-2222-222222222222';
const E1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const E2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function regle(over: Record<string, unknown> = {}) {
  return {
    id: 'r1', org_id: 'o1', name: 'test', trigger_event: 'deal.stage_entered',
    conditions: {}, delay_seconds: 0, actions: [], is_active: true,
    pipeline_id: null, stage_id: null, ...over,
  } as any;
}

function evenement(over: Record<string, unknown> = {}) {
  return {
    type: 'deal.stage_entered', orgId: 'o1', entityType: 'deal', entityId: 'd1',
    metadata: { pipeline_id: P1, stage_id: E1, ...(over.metadata as object ?? {}) },
    ...over,
  } as any;
}

describe('portée des règles du pipeline', () => {
  it("se déclenche quand l'étape correspond", () => {
    expect(regleViseCetEvenement(regle({ stage_id: E1 }), evenement())).toBe(true);
  });

  it("ne se déclenche PAS pour une autre étape", () => {
    // Le défaut trouvé le 2026-09-23 : ceci renvoyait `true`.
    expect(regleViseCetEvenement(regle({ stage_id: E2 }), evenement())).toBe(false);
  });

  it("ne se déclenche PAS pour un autre pipeline", () => {
    expect(
      regleViseCetEvenement(regle({ pipeline_id: P2 }), evenement()),
    ).toBe(false);
  });

  it("sans étape, s'applique à toutes les étapes du pipeline", () => {
    // C'est la façon d'écrire « à chaque changement d'étape » : la largeur
    // est voulue, pas un oubli.
    expect(regleViseCetEvenement(regle({ pipeline_id: P1 }), evenement())).toBe(true);
    expect(
      regleViseCetEvenement(regle({ pipeline_id: P1 }), evenement({ metadata: { stage_id: E2 } })),
    ).toBe(true);
  });

  it('ne filtre jamais les événements qui ne sont pas du pipeline', () => {
    // Une règle « facture en retard » n'a ni pipeline ni étape : la portée du
    // pipeline ne doit pas la faire disparaître.
    const autre = { type: 'invoice.overdue', orgId: 'o1', entityType: 'invoice', entityId: 'i1', metadata: {} } as any;
    expect(regleViseCetEvenement(regle({ stage_id: E1 }), autre)).toBe(true);
  });

  it("laisse passer un événement sans métadonnées d'étape", () => {
    // Un événement ancien ou mal formé ne doit pas être avalé en silence :
    // mieux vaut exécuter la règle que de perdre l'action sans trace.
    expect(
      regleViseCetEvenement(regle({ stage_id: E1 }), evenement({ metadata: {} })),
    ).toBe(true);
  });
});
