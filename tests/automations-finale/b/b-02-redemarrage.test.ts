/**
 * Point 2 — un redémarrage du serveur pendant une action IMMÉDIATE.
 *
 * Le moteur réserve l'action dans le journal (« en cours ») AVANT de
 * l'exécuter. Si le processus meurt entre les deux (déploiement Railway),
 * l'événement reste dans l'outbox et il est rejoué au tick suivant. Le rejeu
 * doit alors FAIRE l'action qui n'a jamais eu lieu.
 *
 * Preuve « en vrai » (processus tué par SIGKILL) :
 *   scripts/qa/finale/b/redemarrage.mts → D:/lume-final/sorties/b/redemarrage.json
 * Ce test rejoue le même état de façon déterministe : l'événement consigné
 * non coché + la réservation laissée par le processus mort.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { marque } from '../../automations-suite/harnais/moteur';
import { preparerBureau, ok, creerClient, type Bureau } from '../../automations-suite/integration/10-b-outils';
import { regle, courriel, envoisAvec, journauxDe } from './outils-b';

let b: Bureau & { fuseau: string };
beforeAll(async () => { b = await preparerBureau(); });

describe('point 2 — action immédiate coupée par un redémarrage, puis rejouée par l’outbox', () => {
  it('[B2-10] la confirmation réservée mais jamais envoyée PART au rejeu (elle n’est pas tenue pour faite)', async () => {
    const m = marque('B2-10');
    const c = await creerClient(b, m);
    const action = courriel(m, 'Votre demande est bien reçue');
    const ruleId = await regle(b, m, { trigger_event: 'note.added', actions: [action] });

    // L'état laissé par le processus tué, 4 minutes plus tôt : l'événement consigné, non coché…
    const ilYa4Min = new Date(Date.now() - 4 * 60_000).toISOString();
    const ev = await ok<{ id: number; created_at: string }>(b.admin.from('domain_events').insert({
      org_id: b.orgA, type: 'note.added', entity_type: 'client', entity_id: c.id, metadata: {}, created_at: ilYa4Min,
    }).select('id, created_at').single(), 'événement orphelin');
    // … et la réservation de l'action (server/lib/automationEngine.ts, reserverActionImmediate), jamais complétée.
    const tranche = Math.floor((Date.parse(ilYa4Min) + 500) / (2 * 60_000));
    await ok(b.admin.from('automation_execution_logs').insert({
      org_id: b.orgA, automation_rule_id: ruleId, trigger_event: 'note.added', entity_type: 'client', entity_id: c.id,
      action_type: action.type, action_config: action.config, result_success: false, result_error: 'en cours',
      execution_key: `${ruleId}:${c.id}:0@${tranche}`, created_at: new Date(Date.parse(ilYa4Min) + 500).toISOString(),
    }), 'réservation orpheline');

    // Le rejeu du tick (server/lib/outbox.ts, rejouerEvenementsOrphelins → eventBus.rejouer), pour CET événement.
    await b.eventBus.rejouer(ev.id, {
      type: 'note.added', orgId: b.orgA, entityType: 'client', entityId: c.id, metadata: {},
      outboxId: ev.id, reglesTraitees: [], rejoueDepuis: ev.created_at,
    } as never);

    const envois = await envoisAvec(b, m);
    const journaux = await journauxDe(b, ruleId);
    expect(envois.length, `aucun courriel ; journal : ${journaux.map((j) => `${j.action_type} ${j.result_success ? 'réussi' : j.result_error}`).join(' | ')}`).toBe(1);
    // Et le journal ne garde pas une ligne « en cours » pour toujours.
    expect(journaux.filter((j) => j.result_error === 'en cours')).toHaveLength(0);
  });
});
