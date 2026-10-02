/**
 * Launch 2026-09-28 — bloc 2 : plus d'erreur avalée qui perd un événement.
 *
 * Règles illisibles (hoquet réseau, délai dépassé) : le moteur journalisait
 * l'erreur et continuait « sans règle », puis le bus cochait la ligne de
 * l'outbox comme traitée — l'événement n'était JAMAIS rejoué. Maintenant la
 * ligne reste non cochée, et l'outbox la rejoue après son délai de grâce.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../server/lib/supabase', async (orig) => ({ ...(await orig<any>()), getServiceClient: () => null }));

import { clientEnregistreur, requetes, type Requete } from './filet-regression/_enregistreur';
import { ORG, IDS } from './filet-regression/_banc';

describe('règles illisibles → l’événement sera rejoué', () => {
  it('la ligne de l’outbox n’est PAS cochée « traitée »', async () => {
    const { client, journal } = clientEnregistreur({
      automation_rules: (req: Requete) => (req.op === 'select' ? { data: null, error: { message: 'canceling statement due to statement timeout' } } : { data: [] }),
      company_settings: { data: [{ automations_paused: false }] },
      domain_events: (req: Requete) => (req.op === 'insert' ? { data: [{ id: 42 }] } : { data: [] }),
      activity_log: { data: [] },
    });
    const { initAutomationEngine } = await import('../../server/lib/automationEngine');
    const { eventBus } = await import('../../server/lib/eventBus');
    eventBus.removeAllListeners();
    initAutomationEngine({ supabase: client, twilio: null, baseUrl: 'https://app.lume.test' } as any);
    await eventBus.emit('quote.declined', { orgId: ORG, entityType: 'quote', entityId: IDS.devis, metadata: {} });
    for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r));
    const coches = requetes(journal, 'domain_events', 'update').map((r) => r.valeur as any);
    expect(coches.length).toBeGreaterThan(0);
    expect(coches.every((v) => !v.processed_at)).toBe(true);
    expect(String(coches[0].last_error)).toMatch(/règles illisibles/);
  });
});

describe('parcours : étape suivante impossible à planifier', () => {
  it('3 essais, puis un échec LISIBLE dans le journal de l’automatisation', async () => {
    const { planifierEtape } = await import('../../server/lib/automationSequences');
    let essais = 0;
    const { client, journal } = clientEnregistreur({
      automation_scheduled_tasks: (req: Requete) => (req.op === 'insert' ? (essais++, { data: null, error: { code: '08006', message: 'connexion perdue' } }) : { data: [] }),
      automation_execution_logs: { data: [] },
    });
    const etapes = [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'x' } }, suivant: null }];
    await planifierEtape({ supabase: client as any, orgId: ORG, ruleId: 'r', entityType: 'quote', entityId: IDS.devis, contexte: {}, franchies: 0 }, etapes as any, 'e1');
    expect(essais).toBe(3);
    const log = requetes(journal, 'automation_execution_logs', 'insert').map((r) => r.valeur as any)[0];
    expect(log?.result_success).toBe(false);
    expect(log?.result_error).toMatch(/parcours interrompu/);
  }, 10_000);

  it('un hoquet passager : réussi au 2e essai, rien au journal', async () => {
    const { planifierEtape } = await import('../../server/lib/automationSequences');
    let essais = 0;
    const { client, journal } = clientEnregistreur({
      automation_scheduled_tasks: (req: Requete) => (req.op === 'insert' ? (++essais === 1 ? { data: null, error: { code: '08006', message: 'x' } } : { data: [{ id: 't' }] }) : { data: [] }),
    });
    const etapes = [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'x' } }, suivant: null }];
    const r = await planifierEtape({ supabase: client as any, orgId: ORG, ruleId: 'r', entityType: 'quote', entityId: IDS.devis, contexte: {}, franchies: 0 }, etapes as any, 'e1');
    expect(r).toBe('e1');
    expect(requetes(journal, 'automation_execution_logs', 'insert')).toHaveLength(0);
  }, 10_000);
});

describe('étape supprimée après planification', () => {
  it('la tâche est ANNULÉE proprement — pas 4 tentatives, pas de notification', async () => {
    const tache = {
      id: 't1', org_id: ORG, automation_rule_id: 'r', entity_type: 'quote', entity_id: IDS.devis, attempts: 0, status: 'pending',
      execute_at: '2026-09-13T15:00:00Z', created_at: '2026-09-13T14:00:00Z', execution_key: 'k', step_id: 'e-supprimee',
      action_config: { type: 'send_sms', config: { body: 'x' } }, sequence_context: {},
      automation_rules: { name: 'R', actions: [], conditions: {}, steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'x' } }, suivant: null }], settings: null, trigger_event: 'quote.sent', delay_seconds: 0, preset_key: null, is_active: true, deleted_at: null },
    };
    const { client, journal } = clientEnregistreur({
      automation_scheduled_tasks: (req: Requete) => (req.op === 'select' ? { data: req.filtres.some(([, c, v]) => c === 'status' && v === 'pending') ? [tache] : [] } : { data: [{ id: 't1' }] }),
      company_settings: { data: [{ automations_paused: false }] },
      notifications: { data: [] },
    });
    const { initAutomationEngine, processScheduledTasks } = await import('../../server/lib/automationEngine');
    initAutomationEngine({ supabase: client, twilio: null, baseUrl: 'https://app.lume.test' } as any);
    await processScheduledTasks(client as any);
    const majs = requetes(journal, 'automation_scheduled_tasks', 'update').map((r) => r.valeur as any).filter((v) => v.status && v.status !== 'running' && v.status !== 'pending');
    expect(majs.at(-1)).toMatchObject({ status: 'cancelled', last_error: 'Étape supprimée du parcours : envoi annulé.' });
    expect(requetes(journal, 'notifications', 'insert')).toHaveLength(0);
    // Aucun ÉCHEC au journal — mais, depuis B-05 (mission finale), l'arrêt y laisse UNE ligne
    // « saute » qui dit pourquoi (`etape_retiree`) : avant, il n'existait que sur la tâche.
    const lignes = requetes(journal, 'automation_execution_logs', 'insert').map((r) => r.valeur as any);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ result_success: true, result_error: null, scheduled_task_id: 't1', result_data: { saute_code: 'etape_retiree' } });
  });
});
