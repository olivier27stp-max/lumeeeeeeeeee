/**
 * B-10 — l'étalement des textos tient ce qu'il annonce : 30 par minute et par
 * entreprise, ni plus (les envois d'une rafale traités en parallèle), ni moins
 * (la file reportée avance à la minute, pas au tick de 5 minutes).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fauxSupabase, type Ligne } from './_faux-supabase';
import {
  rafaleDeTextos, prochainePlaceTexto, oublierPlacesTextos, oublierRafalesSignalees, ecouterRafales, DEBIT_SMS_PAR_MINUTE,
} from '../../../server/lib/automationEngine';
import { viderCacheFuseau } from '../../../server/lib/automations-fuseau-org';
import { viderCachePause } from '../../../server/lib/automations-pause-org';

const ORG = '11111111-1111-4111-8111-111111111111';
const AUTRE = '22222222-2222-4222-8222-222222222222';
// Midi à Montréal : dans la fenêtre d'envoi.
const MIDI = new Date('2026-10-02T16:00:00Z');

beforeEach(() => { oublierPlacesTextos(); oublierRafalesSignalees(); viderCacheFuseau(); viderCachePause(); ecouterRafales(null); });
afterEach(() => { vi.useRealTimers(); ecouterRafales(null); });

describe('[B-10] pas PLUS de 30 par minute : chaque texto réserve sa place avant de partir', () => {
  it('300 demandes simultanées (les événements d’une rafale sont traités en parallèle) : 30 passent, 270 attendent', async () => {
    const sb = fauxSupabase({ automation_execution_logs: [] });
    const verdicts = await Promise.all(Array.from({ length: 300 }, () => rafaleDeTextos(sb.client, ORG)));
    expect(verdicts.filter((attend) => !attend)).toHaveLength(DEBIT_SMS_PAR_MINUTE);
    expect(verdicts.filter((attend) => attend)).toHaveLength(270);
  });

  it('le débit est PAR entreprise : la rafale d’un bureau ne retient pas les textos d’un autre', async () => {
    const sb = fauxSupabase({ automation_execution_logs: [] });
    await Promise.all(Array.from({ length: 40 }, () => rafaleDeTextos(sb.client, ORG)));
    expect(await rafaleDeTextos(sb.client, AUTRE)).toBe(false);
  });

  it('une minute plus tard, les places sont libres', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(MIDI);
    const sb = fauxSupabase({ automation_execution_logs: [] });
    await Promise.all(Array.from({ length: 30 }, () => rafaleDeTextos(sb.client, ORG)));
    expect(await rafaleDeTextos(sb.client, ORG)).toBe(true);
    vi.setSystemTime(new Date(MIDI.getTime() + 61_000));
    expect(await rafaleDeTextos(sb.client, ORG)).toBe(false);
  });

  it('les textos partis d’une AUTRE instance comptent aussi (lus dans le journal) ; un texto sauté ou reporté ne compte pas', async () => {
    const maintenant = new Date().toISOString();
    const partis = Array.from({ length: 30 }, () => ({ org_id: ORG, action_type: 'send_sms', result_success: true, result_data: { to: '+1' }, created_at: maintenant }));
    expect(await rafaleDeTextos(fauxSupabase({ automation_execution_logs: partis }).client, ORG)).toBe(true);
    oublierPlacesTextos();
    const sautes = partis.map((l) => ({ ...l, result_data: { saute: 'Envoi étalé', saute_code: 'rafale' } }));
    expect(await rafaleDeTextos(fauxSupabase({ automation_execution_logs: sautes }).client, ORG)).toBe(false);
  });
});

describe('[B-10] pas MOINS de 30 par minute : un texto reporté l’est jusqu’à la place suivante, pas « au tick »', () => {
  it('la prochaine place : une minute (plus une seconde de marge) après le plus ancien des 30 derniers textos', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(MIDI);
    const sb = fauxSupabase({ automation_execution_logs: [] });
    await Promise.all(Array.from({ length: 30 }, () => rafaleDeTextos(sb.client, ORG)));
    vi.setSystemTime(new Date(MIDI.getTime() + 4_000));
    expect(prochainePlaceTexto(ORG).getTime()).toBe(MIDI.getTime() + 61_000);
  });

  it('file de 35 textos dus : 30 sont pris, les 5 autres sont reportés d’UN coup à la place suivante, journalisés une fois, et le planificateur est prévenu de l’instant', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(MIDI);
    const engine = await import('../../../server/lib/automationEngine');
    const { eventBus } = await import('../../../server/lib/eventBus');
    const taches: Ligne[] = Array.from({ length: 35 }, (_, i) => ({
      id: `t${String(i).padStart(2, '0')}`, org_id: ORG, automation_rule_id: 'r1', entity_type: 'webhook', entity_id: `e${i}`, attempts: 0, status: 'pending', step_id: null,
      execute_at: new Date(MIDI.getTime() - 60_000 + i).toISOString(), created_at: new Date(MIDI.getTime() - 86_400_000).toISOString(), execution_key: `r1:e${i}:0`,
      action_config: { type: 'send_sms', config: { body: 'Votre facture est en retard' }, trigger_event: 'webhook.received', event_metadata: {} },
      automation_rules: { name: 'Relance', actions: [], steps: null, conditions: {}, settings: null, is_active: true, deleted_at: null, trigger_event: 'webhook.received', delay_seconds: 60 },
    }));
    const sb = fauxSupabase({ company_settings: [{ org_id: ORG, timezone: 'America/Montreal', automations_paused: false }], automation_scheduled_tasks: taches });
    const reveils: number[] = [];
    engine.ecouterRafales((quand) => reveils.push(quand.getTime()));
    eventBus.removeAllListeners();
    engine.initAutomationEngine({ supabase: sb.client, twilio: null as never, baseUrl: 'http://t' });
    // Un seul lot, comme le planificateur (50 tâches par lot).
    await engine.processScheduledTasks(sb.client);

    const reportees = sb.tables.automation_scheduled_tasks.filter((t) => t.status === 'pending');
    expect(reportees).toHaveLength(5);
    const prochain = MIDI.getTime() + 61_000;
    expect(new Set(reportees.map((t) => Date.parse(t.execute_at)))).toEqual(new Set([prochain]));
    expect(reportees.every((t) => t.attempts === 0 && String(t.last_error).startsWith('Rafale de textos'))).toBe(true);
    const lignes = sb.tables.automation_execution_logs.filter((l) => l.result_data?.saute_code === 'rafale');
    expect(lignes).toHaveLength(5);
    expect(new Set(lignes.map((l) => l.scheduled_task_id))).toEqual(new Set(reportees.map((t) => t.id)));
    expect(reveils).toEqual([prochain]);
  });
});
