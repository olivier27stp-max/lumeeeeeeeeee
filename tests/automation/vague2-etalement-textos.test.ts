/**
 * F11 — une rafale de textos est ÉTALÉE, jamais plafonnée (décision du
 * 2026-09-23, revue par l'audit V2).
 *
 * Le plafond quotidien a été écarté : ce sont les messages d'une entreprise à
 * ses propres clients. Mais une rafale (webhook entrant, synchro) partait
 * d'un coup : 200 textos dans la même minute. Au-delà de
 * DEBIT_SMS_PAR_MINUTE textos d'automatisation dans la dernière minute, les
 * suivants sont reportés d'une minute — tout part, lentement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/lib/mailer', async () => (await import('../quarantaine/_simulations')).mailerSimule(vi.fn(async () => ({ sent: true, messageId: 'x' }))));
vi.mock('../../server/routes/emails', async () => (await import('../quarantaine/_simulations')).emailsSimules());
vi.mock('../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15550000000' }));

import { clientEnregistreur, requetes } from '../quarantaine/automation/_enregistreur';
import { DEBIT_SMS_PAR_MINUTE } from '../../server/lib/automationEngine';

const ORG = '11111111-1111-4111-8111-111111111111';
const TEXTO = { type: 'send_sms', config: { body: 'Bienvenue [client_first_name]' } };
const COURRIEL = { type: 'send_email', config: { subject: 'Bienvenue', body: 'Bonjour' } };
let twilio: { messages: { create: ReturnType<typeof vi.fn> } };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-15T18:00:00Z')); // 14 h à Montréal : hors heures calmes
  twilio = { messages: { create: vi.fn(async () => ({ sid: 'SM' })) } };
});

/** Le texto charge un module à la volée : on laisse au moteur le temps de finir. */
const laisserTravailler = async () => { for (let t = 0; t < 4; t++) { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)); await new Promise((r) => setTimeout(r, 150)); } };

function monde(textosDerniereMinute: number, extra: Record<string, unknown> = {}) {
  return clientEnregistreur({
    company_settings: { data: { company_name: 'A', timezone: 'America/Montreal' } },
    clients: { data: [{ id: 'l1', first_name: 'Marie', phone: '+15145550142', email: 'marie@example.test', status: 'lead', lead_status: 'new', email_consent_at: '2026-01-01T00:00:00Z', sms_consent_at: '2026-01-01T00:00:00Z', email_opt_out_at: null, deleted_at: null }] },
    sms_opt_outs: { data: null }, conversations: { data: { id: 'conv-1' } }, messages: { data: null, count: 0 },
    automation_execution_logs: (req: any) => (req.op === 'select' && req.filtres.some((f: any[]) => f[1] === 'action_type' && f[2] === 'send_sms')
      ? { data: null, count: textosDerniereMinute }
      : { data: req.op === 'insert' ? [{ id: 'resa' }] : null }),
    ...extra,
  });
}

describe('F11 — étalement des textos', () => {
  it(`au-delà de ${DEBIT_SMS_PAR_MINUTE}/min : le texto est reporté d'une minute (pas refusé), le courriel part`, async () => {
    const { initAutomationEngine } = await import('../../server/lib/automationEngine');
    const { eventBus } = await import('../../server/lib/eventBus');
    const { client, journal } = monde(DEBIT_SMS_PAR_MINUTE, { automation_rules: { data: [{ id: 'r1', org_id: ORG, name: 'Bienvenue', trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, is_active: true, actions: [TEXTO, COURRIEL] }] } });
    eventBus.removeAllListeners();
    initAutomationEngine({ supabase: client, twilio: { client: twilio, phoneNumber: '+15550000000' }, baseUrl: 'http://t' });
    await eventBus.emit('lead.created', { orgId: ORG, entityType: 'lead', entityId: 'l1', metadata: {} });
    await laisserTravailler();
    expect(twilio.messages.create).not.toHaveBeenCalled();
    const report = requetes(journal, 'automation_scheduled_tasks', 'insert').map((r) => r.valeur as any).find((v) => v.action_config?.report_rafale);
    // Une minute, plus une seconde de marge : l'instant où une place se libère (B-10).
    expect(report?.execute_at).toBe('2026-09-15T18:01:01.000Z');
    expect(requetes(journal, 'automation_execution_logs', 'update').some((r) => (r.valeur as any)?.result_success === true)).toBe(true); // le courriel
  });

  it('sous le débit : le texto part tout de suite', async () => {
    const { initAutomationEngine } = await import('../../server/lib/automationEngine');
    const { eventBus } = await import('../../server/lib/eventBus');
    const { client, journal } = monde(DEBIT_SMS_PAR_MINUTE - 1, { automation_rules: { data: [{ id: 'r1', org_id: ORG, name: 'Bienvenue', trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, is_active: true, actions: [TEXTO] }] } });
    eventBus.removeAllListeners();
    initAutomationEngine({ supabase: client, twilio: { client: twilio, phoneNumber: '+15550000000' }, baseUrl: 'http://t' });
    await eventBus.emit('lead.created', { orgId: ORG, entityType: 'lead', entityId: 'l1', metadata: {} });
    await laisserTravailler();
    expect(twilio.messages.create).toHaveBeenCalledTimes(1);
  });

  it('dans la file : repoussé d’une minute SANS consommer de tentative', async () => {
    const { initAutomationEngine, processScheduledTasks } = await import('../../server/lib/automationEngine');
    const tache = {
      id: 't1', org_id: ORG, automation_rule_id: 'r1', entity_type: 'lead', entity_id: 'l1', attempts: 2, status: 'pending',
      execute_at: '2026-09-15T17:59:00Z', created_at: '2026-09-15T17:00:00Z', execution_key: 'r1:l1:0',
      action_config: { ...TEXTO, trigger_event: 'lead.created', event_metadata: {} }, automation_rules: { name: 'R', actions: [TEXTO], conditions: {}, trigger_event: 'lead.created', delay_seconds: 3600 },
    };
    const { client, journal } = monde(DEBIT_SMS_PAR_MINUTE, { automation_scheduled_tasks: (req: any) => (req.op === 'select' ? { data: [tache] } : { data: [{ id: 't1' }] }) });
    initAutomationEngine({ supabase: client, twilio: { client: twilio, phoneNumber: '+15550000000' }, baseUrl: 'http://t' });
    await processScheduledTasks(client);
    expect(twilio.messages.create).not.toHaveBeenCalled();
    const report = requetes(journal, 'automation_scheduled_tasks', 'update').map((r) => r.valeur as any).find((v) => /Rafale/.test(v?.last_error ?? ''));
    expect(report).toMatchObject({ status: 'pending', execute_at: '2026-09-15T18:01:01.000Z', attempts: 2 });
  });
});
