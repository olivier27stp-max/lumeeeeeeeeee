/**
 * Plafond de fréquence (3 messages commerciaux par client et par 24 h) :
 * ce n'est plus un ÉCHEC, c'est un SAUT (mission finale, consigne du
 * coordinateur).
 *
 * Avant : le 4e message donnait une ligne rouge « Frequency cap reached for
 * +1514… » dans le journal — le numéro du client à l'écran —, une
 * notification d'échec au propriétaire, et le parcours du client s'arrêtait
 * là alors que rien n'était en panne.
 *
 * Maintenant : `result_success = true`, `saute_code = 'plafond_frequence'`,
 * une phrase française SANS numéro ni adresse (le destinataire reste dans
 * `to`), le parcours continue, aucune notification d'échec.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const etat = vi.hoisted(() => ({ textos: [] as string[] }));
/** Dans la file, l'action « texto » rend ce que l'action réelle rend au plafond (prouvé au premier bloc). */
const SAUT_PLAFOND = {
  success: true,
  data: {
    saute: 'Limite d’envois atteinte : ce client a déjà reçu 3 messages commerciaux en 24 h',
    saute_code: 'plafond_frequence',
    to: '+15145550100',
  },
};
vi.mock('../../../server/lib/actions/index', async (orig) => {
  const reel = await orig<any>();
  return {
    ...reel,
    executeAction: vi.fn(async (type: string, ...reste: unknown[]) => (
      type === 'send_sms' && etat.textos.push('plafond') ? SAUT_PLAFOND : reel.executeAction(type, ...reste))),
  };
});

import { fauxSupabase, type Ligne } from './_faux-supabase';
import { viderCacheFuseau } from '../../../server/lib/automations-fuseau-org';
import { viderCachePause } from '../../../server/lib/automations-pause-org';

const ORG = '11111111-1111-4111-8111-111111111111';
const NUMERO = '+15145550100';
const il_y_a = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** Midi à Toronto : dans les heures d'envoi (8 h – 20 h), quelle que soit l'heure où le test tourne. */
const MIDI = new Date('2026-10-02T16:00:00Z');

beforeEach(() => {
  etat.textos.length = 0; viderCacheFuseau(); viderCachePause();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MIDI);
});
afterEach(() => vi.useRealTimers());

describe('[plafond] l’action « texto » au plafond : un saut, pas un échec', () => {
  const tables = (dejaPartis: number) => ({
    sms_opt_outs: [],
    clients: [{ id: 'c1', org_id: ORG, phone: '(514) 555-0100', sms_consent_at: '2026-01-01', email_consent_at: null, email_opt_out_at: null, deleted_at: null }],
    messages: Array.from({ length: dejaPartis }, (_, i) => ({
      id: `m${i}`, org_id: ORG, phone_number: NUMERO, direction: 'outbound', sender_user_id: null, created_at: il_y_a(60 + i),
    })),
  });
  const contexte = (sb: ReturnType<typeof fauxSupabase>) => ({
    supabase: sb.client, orgId: ORG, entityType: 'client', entityId: 'c1', baseUrl: 'http://t', commercial: true,
    twilio: { client: { messages: { create: async () => { throw new Error('ne doit pas partir'); } } }, phoneNumber: '+15145550000' },
  });

  it('3 textos commerciaux déjà partis en 24 h : le 4e est SAUTÉ — succès, code « plafond_frequence »', async () => {
    const { executeSendSms } = await vi.importActual<typeof import('../../../server/lib/actions/index')>('../../../server/lib/actions/index');
    const sb = fauxSupabase(tables(3));
    const r = await executeSendSms({ body: 'Promo' }, { client_phone: NUMERO }, contexte(sb) as never);
    expect(r).toEqual(SAUT_PLAFOND);
    expect(r.error).toBeUndefined();
  });

  it('la phrase montrée à l’écran ne porte NI le numéro NI l’adresse du client : il reste dans `to`', async () => {
    const { executeSendSms } = await vi.importActual<typeof import('../../../server/lib/actions/index')>('../../../server/lib/actions/index');
    const r = await executeSendSms({ body: 'Promo' }, { client_phone: NUMERO }, contexte(fauxSupabase(tables(3))) as never);
    const donnees = r.data as { saute: string; to: string };
    expect(donnees.saute).not.toMatch(/\+?\d{7,}|@/);
    expect(donnees.saute).not.toMatch(/Frequency cap/i);
    expect(donnees.to).toBe(NUMERO);
  });
});

describe('[plafond] dans la file : le parcours du client CONTINUE, sans notification d’échec', () => {
  const hook = { type: 'webhook', config: { url: 'https://hooks.example.test/suite' } };
  const tache = (): Ligne => ({
    id: 'tache-1', org_id: ORG, automation_rule_id: 'r1', entity_type: 'webhook', entity_id: 'e1', attempts: 0, status: 'pending', step_id: 'a',
    execute_at: il_y_a(1), created_at: il_y_a(120), execution_key: 'r1:e1:step:a',
    action_config: { type: 'send_sms', config: { body: 'Promo', type_envoi: 'marketing' }, event_metadata: {} }, sequence_context: {},
    automation_rules: {
      name: 'Parcours promo', actions: [], conditions: {}, settings: null, is_active: true, deleted_at: null,
      trigger_event: 'webhook.received', delay_seconds: 0,
      steps: [
        { id: 'a', type: 'action', action: { type: 'send_sms', config: { body: 'Promo', type_envoi: 'marketing' } }, suivant: 'b' },
        { id: 'b', type: 'action', action: hook, suivant: null },
      ],
    },
  });

  async function passer() {
    const { initAutomationEngine, processScheduledTasks } = await import('../../../server/lib/automationEngine');
    const { eventBus } = await import('../../../server/lib/eventBus');
    const sb = fauxSupabase({
      company_settings: [{ org_id: ORG, timezone: 'America/Toronto', automations_paused: false, quiet_hours_start: null, quiet_hours_end: null }],
      automation_scheduled_tasks: [tache()],
    });
    eventBus.removeAllListeners();
    initAutomationEngine({ supabase: sb.client, twilio: { client: {}, phoneNumber: '+15145550000' } as never, baseUrl: 'http://t' });
    await processScheduledTasks(sb.client);
    return sb;
  }

  it('l’étape au plafond est close « terminée », le journal porte le saut — et l’étape suivante est planifiée', async () => {
    const sb = await passer();
    expect(etat.textos).toEqual(['plafond']);
    const [premiere] = sb.tables.automation_scheduled_tasks;
    expect(premiere).toMatchObject({ id: 'tache-1', status: 'completed' });
    const saut = sb.tables.automation_execution_logs.find((l) => l.action_type === 'send_sms');
    expect(saut).toMatchObject({ result_success: true, result_error: null, result_data: { saute_code: 'plafond_frequence', to: NUMERO } });
    expect(String(saut!.result_data.saute)).not.toContain(NUMERO);
    // Le parcours continue : l'étape suivante « b » est en file, à son heure.
    expect(sb.tables.automation_scheduled_tasks.map((t) => [t.step_id, t.status])).toEqual([['a', 'completed'], ['b', 'pending']]);
    expect(sb.tables.automation_scheduled_tasks[1].action_config).toMatchObject({ type: 'webhook' });
    expect(sb.tables.automation_execution_logs.filter((l) => l.result_success === false)).toEqual([]);
  });

  it('aucune notification d’échec n’est écrite pour le propriétaire', async () => {
    const sb = await passer();
    expect(sb.tables.notifications ?? []).toEqual([]);
  });
});
