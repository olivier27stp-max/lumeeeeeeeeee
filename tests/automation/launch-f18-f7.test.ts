/**
 * Launch 2026-09-28 — F18 et F7 SORTIS de la quarantaine (tests/quarantaine/).
 *
 * F18 : `config.to` dans une règle ne détourne jamais un message — le
 *       destinataire vient TOUJOURS de l'entité. Le code le faisait déjà
 *       (DESTINATAIRE_IMPOSE) ; le test restait rouge à cause d'un harnais
 *       périmé (faux modules sans `senderForOrg` ni `adresseInjoignable`).
 * F7  : consentement commercial (LCAP) — une relance commerciale ne part pas
 *       sans base légale (étape sautée, motif journalisé depuis M1) ; le
 *       témoin transactionnel part ; et la demande d'avis, même immédiate,
 *       compte dans le plafond de 3 messages commerciaux / 24 h (corrigé).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mailer = vi.hoisted(() => ({ sendEmail: vi.fn(async (_p?: unknown) => ({ sent: true, messageId: 'x' })) }));
vi.mock('../../server/lib/mailer', () => ({
  isMailerConfigured: () => true,
  adresseInjoignable: async () => false,
  sendEmail: (p: any) => mailer.sendEmail(p),
}));
vi.mock('../../server/routes/emails', () => ({
  getCompanySettings: async () => ({}),
  buildEmailLayout: (_c: unknown, b: string) => b,
  senderFor: () => ({ from: 'test@lume.test' }),
  senderForOrg: async () => ({ from: 'Test <test@lume.test>' }),
  langueEntreprise: () => 'fr',
}));
vi.mock('../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15550000000' }));
vi.mock('../../server/lib/migration/gel-communications', () => ({ destinataireGele: async () => null, journaliserBlocage: () => {}, MESSAGE_GEL: 'gel' }));

import { clientEnregistreur, requetes } from '../quarantaine/automation/_enregistreur';
import { AUTOMATION_PRESETS } from '../../server/lib/automationPresets.data';

const ORG = '11111111-1111-4111-8111-111111111111';
const JOB = '44444444-4444-4444-8444-444444444444';
const VISITE = '55555555-5555-4555-8555-555555555555';
const client = { id: 'client-a', first_name: 'Alice', last_name: 'A', email: 'alice@a.test', phone: '+15145550101', email_consent_at: null, sms_consent_at: null, email_opt_out_at: null };

const monde = () => ({
  company_settings: { data: { company_name: 'A inc.', default_language: 'fr', review_enabled: true, google_review_url: 'https://g.page/r/x' } },
  clients: { data: client },
  jobs: { data: { title: 'Gouttières', client_id: 'client-a' } },
  schedule_events: { data: { id: VISITE, job_id: JOB, start_at: '2026-09-25T13:00:00Z', status: 'scheduled', deleted_at: null, job: { id: JOB, title: 'Gouttières', property_address: '10 rue A', client_id: 'client-a', clients: client } } },
  job_agreements: { data: null }, sms_opt_outs: { data: null }, conversations: { data: { id: 'conv-1', client_id: null } },
  messages: { data: null, count: 0 }, activity_log: { data: null, count: 0 }, automation_execution_logs: { data: null }, notifications: { data: null },
  review_requests: { data: null }, satisfaction_surveys: { data: { id: 'sondage-1' } }, email_templates: { data: null }, automation_scheduled_tasks: { data: null },
  memberships: { data: { user_id: 'owner' } }, tasks: { data: null },
});

const preset = (cle: string) => {
  const p = AUTOMATION_PRESETS.find((x) => x.preset_key === cle)!;
  return { id: `regle-${cle}`, org_id: ORG, name: p.name, trigger_event: p.trigger_event, conditions: p.conditions, delay_seconds: p.delay_seconds, actions: p.actions, is_active: true };
};
const tacheDe = (cle: string, i: number) => {
  const r = preset(cle);
  return { id: `t-${cle}-${i}`, org_id: ORG, automation_rule_id: r.id, entity_type: 'job', entity_id: JOB, attempts: 0, execute_at: '2026-09-15T17:00:00Z', created_at: '2026-09-15T17:00:00Z', status: 'pending', execution_key: `${r.id}:${JOB}:${i}`,
    action_config: { ...r.actions[i], trigger_event: r.trigger_event, event_metadata: {} }, automation_rules: { name: r.name, actions: r.actions, conditions: r.conditions } };
};

let twilio: { messages: { create: ReturnType<typeof vi.fn> } };
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-15T18:00:00Z')); twilio = { messages: { create: vi.fn(async () => ({ sid: 'SM' })) } }; });
afterEach(() => vi.useRealTimers());

async function moteur(reponses: Record<string, any>) {
  const { initAutomationEngine, processScheduledTasks } = await import('../../server/lib/automationEngine');
  const { eventBus } = await import('../../server/lib/eventBus');
  const { client: c, journal } = clientEnregistreur(reponses);
  eventBus.removeAllListeners();
  initAutomationEngine({ supabase: c, twilio: { client: twilio, phoneNumber: '+15550000000' }, baseUrl: 'http://test' });
  journalCourant = journal;
  return { client: c, journal, eventBus, processScheduledTasks };
}
let journalCourant: any[] = [];
/** Attend que chaque action réservée (« en cours ») ait écrit son résultat — pas un nombre de tours fixe. */
const laisserTravailler = async () => {
  const limite = performance.now() + 5000;
  for (;;) {
    const logs = requetes(journalCourant, 'automation_execution_logs', 'insert').map((r) => r.valeur as any);
    const enCours = logs.filter((l) => l?.result_error === 'en cours').length;
    const finis = logs.filter((l) => l?.result_error !== 'en cours').length;
    if ((enCours > 0 && finis >= enCours) || performance.now() > limite) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

describe('F18 — `config.to` n’est jamais honoré', () => {
  const regleAvec = (actions: any[]) => ({ ...monde(), automation_rules: { data: [{ id: 'r', org_id: ORG, name: 'r', trigger_event: 'job.completed', conditions: {}, delay_seconds: 0, is_active: true, actions }] } });

  it('le texto part au client de l’entité, pas au numéro écrit dans la règle', async () => {
    const { eventBus } = await moteur(regleAvec([{ type: 'send_sms', config: { body: 'Merci', to: '+15145559999' } }]));
    await eventBus.emit('job.completed', { orgId: ORG, entityType: 'job', entityId: JOB, metadata: {} });
    await laisserTravailler();
    expect(twilio.messages.create).toHaveBeenCalledTimes(1);
    expect(twilio.messages.create.mock.calls[0][0].to).toBe('+15145550101');
  });

  it('le courriel part au client de l’entité, pas à une adresse externe écrite dans la règle', async () => {
    const { eventBus } = await moteur(regleAvec([{ type: 'send_email', config: { subject: 'S', body: 'B', to: 'concurrent@exemple.test' } }]));
    await eventBus.emit('job.completed', { orgId: ORG, entityType: 'job', entityId: JOB, metadata: {} });
    await laisserTravailler();
    expect(mailer.sendEmail).toHaveBeenCalledTimes(1);
    expect((mailer.sendEmail.mock.calls[0] as any)[0].to).toBe('alice@a.test');
  });
});

describe('F7 — consentement et plafond commercial', () => {
  it('relance commerciale (cross_sell_30d) sans consentement : ne part pas, étape sautée avec motif', async () => {
    const { processScheduledTasks, client: c, journal } = await moteur({ ...monde(), automation_scheduled_tasks: { data: [tacheDe('cross_sell_30d', 0)] } });
    await processScheduledTasks(c);
    expect(mailer.sendEmail).not.toHaveBeenCalled();
    const log = requetes(journal, 'automation_execution_logs', 'insert').map((r) => r.valeur as any)[0];
    expect(log?.result_data?.saute_code).toBe('sans_consentement');
  });

  it('témoin : la confirmation de rendez-vous (transactionnelle) part sans consentement commercial', async () => {
    const { eventBus } = await moteur({ ...monde(), automation_rules: { data: [preset('appointment_confirmation')] } });
    await eventBus.emit('appointment.created', { orgId: ORG, entityType: 'schedule_event', entityId: VISITE, metadata: {} });
    await laisserTravailler();
    expect(twilio.messages.create).toHaveBeenCalledTimes(1);
    expect(mailer.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('client déjà à 3 messages commerciaux / 24 h : la demande d’avis (courriel + texto) est retenue', async () => {
    const r = { ...preset('google_review'), delay_seconds: 0 };
    const { eventBus } = await moteur({ ...monde(), automation_rules: { data: [r] }, messages: { data: null, count: 3 }, activity_log: { data: null, count: 3 } });
    await eventBus.emit('job.completed', { orgId: ORG, entityType: 'job', entityId: JOB, metadata: {} });
    await laisserTravailler();
    expect(twilio.messages.create.mock.calls.length + mailer.sendEmail.mock.calls.length).toBe(0);
  });

  it('sous le plafond, la demande d’avis part', async () => {
    const r = { ...preset('google_review'), delay_seconds: 0 };
    const { eventBus } = await moteur({ ...monde(), automation_rules: { data: [r] } });
    await eventBus.emit('job.completed', { orgId: ORG, entityType: 'job', entityId: JOB, metadata: {} });
    await laisserTravailler();
    expect(twilio.messages.create.mock.calls.length + mailer.sendEmail.mock.calls.length).toBeGreaterThan(0);
  });
});
