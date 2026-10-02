/**
 * B-09 — un message reporté « hors heures d'envoi » laisse UNE ligne lisible
 * au journal de l'automatisation, au premier report seulement.
 *
 * Avant : le report n'existait que comme tâche en attente ; les Journaux
 * étaient vides jusqu'à l'envoi — « pourquoi il n'est pas parti ? » n'avait
 * pas de réponse.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fauxSupabase, type Ligne } from './_faux-supabase';
import { viderCacheFuseau } from '../../../server/lib/automations-fuseau-org';
import { viderCachePause } from '../../../server/lib/automations-pause-org';

const ORG = '11111111-1111-4111-8111-111111111111';
// 1 h 30 du matin à Montréal.
const NUIT = new Date('2026-10-02T05:30:00Z');

beforeEach(() => { viderCacheFuseau(); viderCachePause(); });
afterEach(() => vi.useRealTimers());

async function moteur(tables: Record<string, Ligne[]>) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NUIT);
  const engine = await import('../../../server/lib/automationEngine');
  const { eventBus } = await import('../../../server/lib/eventBus');
  const sb = fauxSupabase({ company_settings: [{ org_id: ORG, timezone: 'America/Montreal', automations_paused: false }], ...tables });
  eventBus.removeAllListeners();
  engine.initAutomationEngine({ supabase: sb.client, twilio: null as never, baseUrl: 'http://t' });
  return { sb, eventBus, processScheduledTasks: engine.processScheduledTasks };
}

describe('[B-09] action immédiate déclenchée la nuit', () => {
  it('le texto est reporté à 8 h ET le journal le dit : « Reporté : hors heures d’envoi », avec le prochain créneau', async () => {
    const { sb, eventBus } = await moteur({
      automation_rules: [{
        id: 'r1', org_id: ORG, name: 'Relance', trigger_event: 'invoice.overdue', conditions: {}, delay_seconds: 0, is_active: true,
        deleted_at: null, steps: null, settings: null, actions: [{ type: 'send_sms', config: { body: 'Votre facture est en retard' } }],
      }],
    });
    await eventBus.emit('invoice.overdue', { orgId: ORG, entityType: 'invoice', entityId: 'f1', metadata: { days_overdue: 3 } });
    for (let i = 0; i < 80; i++) await new Promise((r) => setImmediate(r));

    const [tache] = sb.tables.automation_scheduled_tasks;
    expect(tache.status).toBe('pending');
    expect(tache.last_error).toMatch(/^Reporté : hors heures d’envoi \(prochain créneau : 2 oct\.?,? 08 h 00\)\.$/);
    const lignes = sb.tables.automation_execution_logs;
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      org_id: ORG, automation_rule_id: 'r1', scheduled_task_id: tache.id, entity_type: 'invoice', entity_id: 'f1',
      action_type: 'send_sms', trigger_event: 'invoice.overdue', result_success: true, result_error: null,
      result_data: { saute_code: 'hors_heures', prochain_creneau: '2026-10-02T12:00:00.000Z', fuseau: 'America/Montreal' },
    });
    expect(String(lignes[0].result_data.saute)).toMatch(/^Reporté : hors heures d’envoi — partira au prochain créneau/);
  });
});

describe('[B-09] tâche de la file arrivée à échéance la nuit', () => {
  const tache = (extra: Ligne = {}): Ligne => ({
    id: 'tache-1', org_id: ORG, automation_rule_id: 'r1', entity_type: 'quote', entity_id: 'd1', attempts: 0, status: 'pending', step_id: null,
    execute_at: new Date(NUIT.getTime() - 1000).toISOString(), created_at: new Date(NUIT.getTime() - 86_400_000).toISOString(), execution_key: 'r1:d1:0',
    action_config: { type: 'send_email', config: { subject: 'S', body: 'B' }, trigger_event: 'quote.sent', event_metadata: {} },
    automation_rules: { name: 'Relance de devis', actions: [], steps: null, conditions: {}, settings: null, is_active: true, deleted_at: null, trigger_event: 'quote.sent', delay_seconds: 86_400 },
    ...extra,
  });

  it('premier report : la tâche est repoussée à 8 h, son motif est écrit, UNE ligne au journal ; elle n’est ni prise ni comptée comme une tentative', async () => {
    const { sb, processScheduledTasks } = await moteur({ automation_scheduled_tasks: [tache()] });
    await processScheduledTasks(sb.client);
    const t = sb.tables.automation_scheduled_tasks[0];
    expect(t).toMatchObject({ status: 'pending', attempts: 0, action_config: { motif_code: 'hors_heures' } });
    expect(t.execute_at).toBe('2026-10-02T12:00:00.000Z');
    expect(t.last_error).toMatch(/^Reporté : hors heures d’envoi/);
    expect(sb.tables.automation_execution_logs.map((l) => [l.scheduled_task_id, l.action_type, l.result_data.saute_code]))
      .toEqual([['tache-1', 'send_email', 'hors_heures']]);
  });

  it('reports suivants (long week-end, fenêtre « jours ouvrables ») : aucune ligne de plus', async () => {
    const deja = tache();
    deja.action_config.motif_code = 'hors_heures';
    const { sb, processScheduledTasks } = await moteur({ automation_scheduled_tasks: [deja] });
    await processScheduledTasks(sb.client);
    expect(sb.tables.automation_scheduled_tasks[0].execute_at).toBe('2026-10-02T12:00:00.000Z');
    expect(sb.tables.automation_execution_logs ?? []).toHaveLength(0);
  });

  it('une action interne (créer une tâche) ne connaît pas la fenêtre : elle n’est pas reportée', async () => {
    const interne = tache({ entity_type: 'webhook', action_config: { type: 'log_activity', config: { event_type: 'qa' }, trigger_event: 'webhook.received', event_metadata: {} } });
    const { sb, processScheduledTasks } = await moteur({ automation_scheduled_tasks: [interne] });
    await processScheduledTasks(sb.client);
    expect((sb.tables.automation_execution_logs ?? []).some((l) => l.result_data?.saute_code === 'hors_heures')).toBe(false);
    expect(sb.tables.automation_scheduled_tasks[0].status).not.toBe('pending');
  });
});
