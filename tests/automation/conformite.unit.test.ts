/**
 * T11 (unitaire) — CONFORMITÉ : consentement commercial (LCAP/CASL).
 *
 * Vrais modules, client enregistreur, horloge figée en journée.
 *
 * ROUGE ATTENDU aujourd'hui (F7) :
 *   T11.1  un client sans consentement commercial reçoit quand même une relance
 *          commerciale différée (cross_sell) — aucune notion de consentement
 *          initial, l'existence d'un numéro suffit
 *   T11.5  `lost_lead_reengagement` (lead perdu, jamais client, 90 jours plus
 *          tard) est activé d'office par le seeder — aucune base de
 *          consentement tacite
 *   T11.6  la demande d'avis immédiate (courriel + SMS le même instant) échappe
 *          au plafond de messages commerciaux
 *
 * T11.2 (message transactionnel toujours livré) est le témoin : vert, et doit
 * le rester après correctif. Voir AUTOMATIONS_TEST_PLAN.md, T11.
 *
 * CORRECTIFS APPLIQUÉS le 2026-09-14 (branche fix/automatisations-audit) :
 * les cas « ROUGE ATTENDU » ci-dessous sont désormais verts, sauf mention
 * contraire dans leur titre. Les descriptions d'origine sont conservées comme
 * mémoire de ce qui était cassé.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mailer = { sendEmail: vi.fn(async (_p?: unknown) => ({ sent: true, messageId: 'x' })) };
vi.mock('../../server/lib/mailer', () => ({ isMailerConfigured: () => true, sendEmail: (p: any) => mailer.sendEmail(p) }));
vi.mock('../../server/routes/emails', () => ({ getCompanySettings: async () => ({}), buildEmailLayout: (_c: unknown, b: string) => b, senderFor: () => ({ from: 'test@lume.test' }) }));
vi.mock('../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15550000000' }));

import { clientEnregistreur, requetes } from './_enregistreur';
import { AUTOMATION_PRESETS } from '../../server/lib/automationPresets.data';

const ORG = '11111111-1111-4111-8111-111111111111';
const JOB = '44444444-4444-4444-8444-444444444444';
const VISITE = '55555555-5555-4555-8555-555555555555';

/** Un client SANS consentement commercial (colonne de la migration M5 ; absente aujourd'hui, le moteur l'ignore). */
const clientSansConsentement = { first_name: 'Alice', last_name: 'A', email: 'alice@a.test', phone: '+15145550101', marketing_consent: 'none', marketing_consent_at: null };

const monde = () => ({
  company_settings: { data: { company_name: 'A inc.', default_language: 'fr', review_enabled: true, google_review_url: 'https://g.page/r/x' } },
  clients: { data: clientSansConsentement },
  jobs: { data: { title: 'Gouttières', client_id: 'client-a' } },
  schedule_events: { data: { id: VISITE, job_id: JOB, start_at: '2026-09-25T13:00:00Z', status: 'scheduled', deleted_at: null, job: { id: JOB, title: 'Gouttières', property_address: '10 rue A', client_id: 'client-a', clients: clientSansConsentement } } },
  job_agreements: { data: null }, sms_opt_outs: { data: null }, conversations: { data: { id: 'conv-1', client_id: null } },
  messages: { data: null, count: 0 }, activity_log: { data: null, count: 0 }, automation_execution_logs: { data: null }, notifications: { data: null },
  review_requests: { data: null }, satisfaction_surveys: { data: { id: 'sondage-1' } }, email_templates: { data: null }, automation_scheduled_tasks: { data: null },
});

const preset = (cle: string) => {
  const p = AUTOMATION_PRESETS.find((x) => x.preset_key === cle)!;
  return { id: `regle-${cle}`, org_id: ORG, name: p.name, trigger_event: p.trigger_event, conditions: p.conditions, delay_seconds: p.delay_seconds, actions: p.actions, is_active: true };
};
/** Une tâche différée telle que le tick la lit, pour un preset donné et son action d'index i. */
const tacheDe = (cle: string, i: number, entityType: string, entityId: string) => {
  const r = preset(cle);
  return { id: `t-${cle}-${i}`, org_id: ORG, automation_rule_id: r.id, entity_type: entityType, entity_id: entityId, attempts: 0, execute_at: '2026-09-15T17:00:00Z', status: 'pending', execution_key: `${r.id}:${entityId}:${i}`,
    action_config: { ...r.actions[i], trigger_event: r.trigger_event, event_metadata: {} }, automation_rules: { name: r.name, actions: r.actions, conditions: r.conditions } };
};

let twilio: { messages: { create: ReturnType<typeof vi.fn> } };
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-15T18:00:00Z')); twilio = { messages: { create: vi.fn(async () => ({ sid: 'SM' })) } }; });
afterEach(() => vi.useRealTimers());

async function moteur(reponses: Record<string, any>) {
  const { initAutomationEngine, processScheduledTasks } = await import('../../server/lib/automationEngine');
  const { eventBus } = await import('../../server/lib/eventBus');
  const { client, journal } = clientEnregistreur(reponses);
  eventBus.removeAllListeners();
  initAutomationEngine({ supabase: client, twilio: { client: twilio, phoneNumber: '+15550000000' }, baseUrl: 'http://test' });
  return { client, journal, eventBus, processScheduledTasks };
}
const laisserTravailler = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); await new Promise((r) => setTimeout(r, 25)); for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };

describe('T11.1 — relance commerciale à un client sans consentement', () => {
  it('F7 corrigé : cross_sell_30d (courriel, 30 jours après la job) ne part pas sans consentement', async () => {
    const t = tacheDe('cross_sell_30d', 0, 'job', JOB);
    const { processScheduledTasks, client, journal } = await moteur({ ...monde(), automation_scheduled_tasks: { data: [t] } });
    await processScheduledTasks(client);
    const fin = requetes(journal, 'automation_scheduled_tasks', 'update').map((r) => r.valeur as any).at(-1);
    expect(mailer.sendEmail, `courriel commercial envoyé à un client sans consentement (statut : ${fin?.status})`).not.toHaveBeenCalled();
    expect(fin?.status).toBe('failed');
    expect(String(fin?.last_error)).toMatch(/consent/i);
  });

  it('F7 corrigé : seasonal_reminder_6m (SMS, 6 mois après) ne part pas non plus', async () => {
    const r = preset('seasonal_reminder_6m');
    const i = r.actions.findIndex((a) => a.type === 'send_sms');
    const t = tacheDe('seasonal_reminder_6m', i, 'job', JOB);
    const { processScheduledTasks, client } = await moteur({ ...monde(), automation_scheduled_tasks: { data: [t] } });
    await processScheduledTasks(client);
    expect(twilio.messages.create, 'SMS commercial envoyé à un client sans consentement').not.toHaveBeenCalled();
  });
});

describe('T11.2 — témoin : un message transactionnel part même sans consentement commercial', () => {
  it('appointment_confirmation (immédiat) → SMS et courriel envoyés', async () => {
    const { eventBus } = await moteur({ ...monde(), automation_rules: { data: [preset('appointment_confirmation')] } });
    await eventBus.emit('appointment.created', { orgId: ORG, entityType: 'schedule_event', entityId: VISITE, metadata: {} });
    await laisserTravailler();
    expect(twilio.messages.create).toHaveBeenCalledTimes(1);
    expect(mailer.sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe('T11.5 — réengagement d’un lead perdu, jamais client', () => {
  it('F7 corrigé : le seeder ne doit pas activer lost_lead_reengagement d’office', async () => {
    const { ensureAutomationPresets } = await import('../../server/lib/automationPresetSeeder');
    const { client, journal } = clientEnregistreur({ automation_rules: (req: any) => (req.op === 'select' ? { data: [] } : { data: [] }) });
    await ensureAutomationPresets(client, ORG, { activateAll: false });
    const inseres = requetes(journal, 'automation_rules', 'insert').flatMap((r) => r.valeur as any[]);
    const lost = inseres.find((r) => r.preset_key === 'lost_lead_reengagement');
    expect(lost, 'preset absent du seed').toBeDefined();
    expect(lost.is_active, 'lost_lead_reengagement activé d’office : 90 jours après un refus, sans relation d’affaires, sans consentement').toBe(false);
  });
});

describe('T11.6 — la demande d’avis compte dans le plafond commercial', () => {
  it('F7 corrigé : client déjà à 3 messages commerciaux / 24 h → la demande d’avis (courriel + SMS) est retenue', async () => {
    const r = { ...preset('google_review'), delay_seconds: 0 }; // en prod le seeder ramène le délai à 0 : envoi immédiat
    const { eventBus, journal } = await moteur({
      ...monde(),
      automation_rules: { data: [r] },
      messages: { data: null, count: 3 },      // 3 SMS d'automatisation déjà partis à ce numéro
      activity_log: { data: null, count: 3 },  // 3 courriels d'automatisation déjà partis à cette adresse
    });
    await eventBus.emit('job.completed', { orgId: ORG, entityType: 'job', entityId: JOB, metadata: {} });
    await laisserTravailler();
    const partis = twilio.messages.create.mock.calls.length + mailer.sendEmail.mock.calls.length;
    const logs = requetes(journal, 'automation_execution_logs', 'insert').map((r) => r.valeur as any);
    expect(partis, `${partis} message(s) d'avis partis à un client déjà au plafond (résultat : ${JSON.stringify(logs.map((l) => l.result_error))})`).toBe(0);
  });
});
