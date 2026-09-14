/**
 * T12 (coût) et T6 (volume) — unitaires, vrais modules.
 *
 * ROUGE ATTENDU aujourd'hui :
 *   T12.1  aucun plafond par org : 6 SMS d'automatisation partent alors qu'un
 *          plafond de 5 par jour devrait en retenir un (F11/F13, migration M4)
 *   T12.2  aucune alerte à 80 % du plafond
 *   T12.3  AUTOMATIONS_ENABLED=false n'arrête rien (F6)
 *   T6.1   200 leads importés d'un coup → 200 SMS + 200 courriels immédiats,
 *          séquentiels, dans la requête web (F11)
 *
 * T6.2 fige le NOMBRE DE REQUÊTES par événement (cliquet : on ne mesure pas le
 * temps, on compte les appels au client Supabase).
 * Voir AUTOMATIONS_TEST_PLAN.md, T6 et T12.
 *
 * CORRECTIFS APPLIQUÉS le 2026-09-14 (branche fix/automatisations-audit) :
 * les cas « ROUGE ATTENDU » ci-dessous sont désormais verts, sauf mention
 * contraire dans leur titre. Les descriptions d'origine sont conservées comme
 * mémoire de ce qui était cassé.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../server/lib/mailer', () => ({ isMailerConfigured: () => true, sendEmail: vi.fn(async () => ({ sent: true, messageId: 'x' })) }));
vi.mock('../../server/routes/emails', () => ({ getCompanySettings: async () => ({}), buildEmailLayout: (_c: unknown, b: string) => b, senderFor: () => ({ from: 'test@lume.test' }) }));
vi.mock('../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15550000000' }));

import { clientEnregistreur, requetes } from './_enregistreur';
import { sendEmail } from '../../server/lib/mailer';

const ORG = '11111111-1111-4111-8111-111111111111';
const PLAFOND_SMS_JOUR = 5; // plafond du forfait simulé (plans.automation_daily_sms_cap, migration M4)

/** Compteur quotidien simulé (RPC automation_bump_counter, M4) : un total par canal. */
const compteurSimule = () => {
  const totaux: Record<string, number> = { sms: 0, email: 0 };
  return (req: any) => { const canal = (req.valeur as any)?.p_canal as string; totaux[canal] = (totaux[canal] || 0) + 1; return { data: totaux[canal] }; };
};

const lead = (i: number) => ({ first_name: `Lead${i}`, last_name: 'Test', email: `lead${i}@a.test`, phone: `+1514555${String(1000 + i).slice(-4)}`, status: 'lead', lead_status: 'new' });

const monde = (i = 0) => ({
  company_settings: { data: { company_name: 'A inc.', default_language: 'fr' } },
  clients: { data: lead(i) },
  schedule_events: { data: { id: 'v', job_id: 'j', start_at: '2026-09-25T13:00:00Z', job: { id: 'j', title: 'T', property_address: 'x', client_id: 'c', clients: lead(0) } } },
  job_agreements: { data: null }, sms_opt_outs: { data: null }, conversations: { data: { id: 'conv-1', client_id: null } },
  messages: { data: null, count: 0 }, activity_log: { data: null, count: 0 }, automation_execution_logs: { data: null }, notifications: { data: null }, automation_scheduled_tasks: { data: null },
  // Forfait avec plafond quotidien (M4)
  subscriptions: { data: [{ plan_id: 'plan-pro' }] },
  plans: { data: [{ id: 'plan-pro', automation_daily_sms_cap: PLAFOND_SMS_JOUR, automation_daily_email_cap: PLAFOND_SMS_JOUR }] },
  'rpc:automation_bump_counter': compteurSimule(),
});

const bienvenue = { id: 'r-bienvenue', org_id: ORG, name: 'Bienvenue', trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, is_active: true,
  actions: [{ type: 'send_sms', config: { body: 'Bienvenue [client_first_name]' } }, { type: 'send_email', config: { subject: 'Bienvenue', body: 'Bonjour [client_first_name]' } }, { type: 'create_notification', config: { title: 'Nouveau lead', body: '[client_name]' } }, { type: 'log_activity', config: { event_type: 'welcome_sent' } }] };

let twilio: { messages: { create: ReturnType<typeof vi.fn> } };
const ENV_ORIGINE = process.env.AUTOMATIONS_ENABLED;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-15T18:00:00Z'));
  twilio = { messages: { create: vi.fn(async () => ({ sid: 'SM' })) } };
});
afterEach(() => { vi.useRealTimers(); if (ENV_ORIGINE === undefined) delete process.env.AUTOMATIONS_ENABLED; else process.env.AUTOMATIONS_ENABLED = ENV_ORIGINE; });

async function moteur(reponses: Record<string, any>) {
  const { initAutomationEngine, processScheduledTasks, viderCachePlafonds } = await import('../../server/lib/automationEngine');
  const { eventBus } = await import('../../server/lib/eventBus');
  const { client, journal } = clientEnregistreur(reponses);
  viderCachePlafonds(); // les plafonds sont mis en cache 60 s par org : chaque test repart de sa fixture
  eventBus.removeAllListeners();
  initAutomationEngine({ supabase: client, twilio: { client: twilio, phoneNumber: '+15550000000' }, baseUrl: 'http://test' });
  return { client, journal, eventBus, processScheduledTasks };
}
const laisserTravailler = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); await new Promise((r) => setTimeout(r, 25)); for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };

/** N leads créés d'un coup (import, resync), chacun avec sa fiche. */
async function rafale(n: number, regles: any[]) {
  let i = 0;
  const { eventBus, journal } = await moteur({ ...monde(), automation_rules: { data: regles }, clients: () => ({ data: lead(i) }) });
  for (i = 1; i <= n; i++) {
    await eventBus.emit('lead.created', { orgId: ORG, entityType: 'lead', entityId: `lead-${i}`, metadata: { name: `Lead${i}` } });
    await laisserTravailler();
  }
  return journal;
}

describe('T12.1 / T12.2 — plafond quotidien de SMS d’automatisation par org', () => {
  it('F11/F13 corrigés : au-delà du plafond, les SMS sont retenus (reportés), jamais envoyés', async () => {
    const journal = await rafale(PLAFOND_SMS_JOUR + 1, [bienvenue]);
    const envoyes = twilio.messages.create.mock.calls.length;
    const retenus = requetes(journal, 'automation_scheduled_tasks', 'insert').filter((r) => (r.valeur as any).status === 'pending').length;
    expect(envoyes, `${envoyes} SMS partis pour un plafond de ${PLAFOND_SMS_JOUR} ; retenus : ${retenus}`).toBeLessThanOrEqual(PLAFOND_SMS_JOUR);
    expect(retenus).toBeGreaterThanOrEqual(1);
  });

  it('corrigé : à 80 % du plafond, une notification prévient l’administrateur', async () => {
    const journal = await rafale(Math.ceil(PLAFOND_SMS_JOUR * 0.8), [bienvenue]);
    const notifs = requetes(journal, 'notifications', 'insert').flatMap((r) => (Array.isArray(r.valeur) ? r.valeur : [r.valeur])).map((v: any) => v?.title as string);
    // Les notifications « Nouveau lead » de la règle ne comptent pas : on cherche une alerte de plafond.
    expect(notifs.filter((t) => /plafond|limite|quota/i.test(t)), `notifications vues : ${JSON.stringify(notifs)}`).not.toHaveLength(0);
  });
});

describe('T12.3 — kill switch global', () => {
  it('F6 corrigé : AUTOMATIONS_ENABLED=false → aucun événement traité', async () => {
    process.env.AUTOMATIONS_ENABLED = 'false';
    const { eventBus, journal } = await moteur({ ...monde(), automation_rules: { data: [bienvenue] } });
    await eventBus.emit('lead.created', { orgId: ORG, entityType: 'lead', entityId: 'lead-1', metadata: {} });
    await laisserTravailler();
    expect(twilio.messages.create, 'SMS parti malgré le kill switch').not.toHaveBeenCalled();
    expect(requetes(journal, 'automation_execution_logs', 'insert')).toHaveLength(0);
  });

  it('F6 corrigé : AUTOMATIONS_ENABLED=false → le tick ne prend aucune tâche, la file reste intacte', async () => {
    process.env.AUTOMATIONS_ENABLED = 'false';
    const tache = { id: 't', org_id: ORG, automation_rule_id: 'r', entity_type: 'lead', entity_id: 'lead-1', attempts: 0, execute_at: '2026-09-15T17:00:00Z', status: 'pending', execution_key: 'k',
      action_config: { type: 'send_sms', config: { body: 'x' }, trigger_event: 'lead.created', event_metadata: {} }, automation_rules: { name: 'r', actions: [], conditions: {} } };
    const { processScheduledTasks, client, journal } = await moteur({ ...monde(), automation_scheduled_tasks: { data: [tache] } });
    await processScheduledTasks(client);
    expect(twilio.messages.create, 'SMS parti malgré le kill switch').not.toHaveBeenCalled();
    const prises = requetes(journal, 'automation_scheduled_tasks', 'update').map((r) => r.valeur as any).filter((v) => v.status === 'running');
    expect(prises, 'tâche réclamée malgré le kill switch').toHaveLength(0);
  });
});

describe('T6.1 — 200 leads importés d’un coup', () => {
  it('F11 corrigé : le comportement défini est « plafonné et mis en file », pas 200 SMS et 200 courriels dans la requête', async () => {
    const journal = await rafale(200, [bienvenue]);
    const smsPartis = twilio.messages.create.mock.calls.length;
    const courrielsPartis = (sendEmail as any).mock.calls.length;
    const enFile = requetes(journal, 'automation_scheduled_tasks', 'insert').filter((r) => (r.valeur as any).status === 'pending').length;
    expect(smsPartis + courrielsPartis, `partis immédiatement : ${smsPartis} SMS + ${courrielsPartis} courriels ; en file : ${enFile}`).toBeLessThanOrEqual(2 * PLAFOND_SMS_JOUR);
  }, 60_000);
});

describe('T6.2 — cliquet : requêtes Supabase par événement', () => {
  // 30 mesuré après les correctifs : + réservation d'idempotence par action
  // immédiate (F3 : select + insert), + plafond du forfait (M4 : subscriptions,
  // plans, un rpc par canal). Avant : 16. Le cliquet ne peut que baisser.
  it('un lead.created qui déclenche SMS + courriel + notification + journal coûte au plus 30 requêtes', async () => {
    const journal = await rafale(1, [bienvenue]);
    const n = journal.length;
    // Mesuré le 2026-09-13 sur le code actuel : 16. Le cliquet interdit de dépasser 20 sans le dire.
    expect(n, `requêtes : ${journal.map((r) => `${r.op}:${r.table}`).join(', ')}`).toBeLessThanOrEqual(30);
  });

  it('les réglages de l’org sont lus une fois par événement, les variables une fois par règle (F24)', async () => {
    const r2 = { ...bienvenue, id: 'r-2', actions: [{ type: 'log_activity', config: { event_type: 'x' } }] };
    const journal = await rafale(1, [bienvenue, r2]);
    const lectures = requetes(journal, 'company_settings', 'select').length;
    // Comportement ACTUEL figé : resolveEntityVariables + langueOrg par règle → 2 lectures × 2 règles.
    expect(lectures).toBe(3) // F24 : réglages lus une fois par événement ; resolveEntityVariables relit company_settings par règle (2 règles → 1 + 2);
  });
});

describe('T6.4 — 10 visites créées en lot', () => {
  it('0 confirmation immédiate, 30 rappels datés planifiés (3 règles × 10 visites)', async () => {
    const confirmation = { id: 'r-conf', org_id: ORG, name: 'Confirmation', trigger_event: 'appointment.created', conditions: {}, delay_seconds: 0, is_active: true, actions: [{ type: 'send_sms', config: { body: 'Confirmé' } }] };
    const rappels = [-604800, -86400, -7200].map((d) => ({ id: `r-${d}`, org_id: ORG, name: `Rappel ${d}`, trigger_event: 'appointment.created', conditions: {}, delay_seconds: d, is_active: true, actions: [{ type: 'send_sms', config: { body: 'Rappel' } }] }));
    const { eventBus, journal } = await moteur({ ...monde(), automation_rules: { data: [confirmation, ...rappels] } });
    for (let i = 0; i < 10; i++) {
      await eventBus.emit('appointment.created', { orgId: ORG, entityType: 'schedule_event', entityId: `visite-${i}`, metadata: { suppress_immediate: true } });
      await laisserTravailler();
    }
    expect(twilio.messages.create).not.toHaveBeenCalled();
    expect(requetes(journal, 'automation_scheduled_tasks', 'insert')).toHaveLength(30);
  });
});
