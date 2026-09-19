/**
 * T4 (unitaire) — IDEMPOTENCE ET REPRISE DU MOTEUR D'AUTOMATISATIONS.
 *
 * Vrais modules (`automationEngine`, `actions`, `eventBus`), client Supabase
 * enregistreur (`_enregistreur.ts`), Twilio et courriel remplacés par des
 * enregistreurs, horloge figée en pleine journée (heures calmes hors jeu).
 *
 * ROUGE ATTENDU aujourd'hui :
 *   T4.1  le même événement émis deux fois → deux SMS (F3 : aucune clé pour les
 *         actions immédiates)
 *   T4.5  une reprise après échec renvoie sans clé d'idempotence fournisseur (F5)
 *
 * Voir AUTOMATIONS_TEST_PLAN.md, T4.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../server/lib/mailer', () => ({ sendEmail: vi.fn(async () => ({ sent: true })), isMailerConfigured: () => true }));
vi.mock('../../../server/routes/emails', () => ({ getCompanySettings: async () => ({}), buildEmailLayout: (_c: unknown, b: string) => b, senderFor: () => ({ from: 'test@lume.test' }) }));
vi.mock('../../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15550000000' }));

import { clientEnregistreur, requetes } from './_enregistreur';

const ORG = '11111111-1111-4111-8111-111111111111';
const VISITE = '55555555-5555-4555-8555-555555555555';
const REGLE = '66666666-6666-4666-8666-666666666666';

const regleImmediate = {
  id: REGLE, org_id: ORG, name: 'Confirmation', trigger_event: 'appointment.created', conditions: {}, delay_seconds: 0, is_active: true,
  actions: [{ type: 'send_sms', config: { body: 'Bonjour [client_first_name], rendez-vous confirmé.' } }],
};
const regleDifferee = { ...regleImmediate, id: 'regle-differee', name: 'Rappel J-1', delay_seconds: -86400 };

/** Réponses de base : réglages, visite et client de A. */
const donneesA = () => ({
  company_settings: { data: { company_name: 'A inc.', default_language: 'fr' } },
  schedule_events: { data: { id: VISITE, job_id: 'job-a', start_at: '2026-09-20T13:00:00Z', status: 'scheduled', deleted_at: null, job: { id: 'job-a', title: 'Gouttières', property_address: '10 rue A', client_id: 'client-a', clients: { first_name: 'Alice', last_name: 'A', email: 'alice@a.test', phone: '+15145550101' } } } },
  job_agreements: { data: null },
  sms_opt_outs: { data: null },
  conversations: { data: { id: 'conv-1', client_id: null } },
  messages: { data: null, count: 0 },
  activity_log: { data: null },
  automation_execution_logs: { data: null },
});

let twilio: { messages: { create: ReturnType<typeof vi.fn> } };

beforeEach(() => {
  vi.clearAllMocks();
  // 14 h à Montréal, un mardi : hors heures calmes, sans changement d'heure.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-15T18:00:00Z'));
  twilio = { messages: { create: vi.fn(async () => ({ sid: `SM_${Math.random().toString(36).slice(2, 8)}` })) } };
});
afterEach(() => { vi.useRealTimers(); });

async function moteur(reponses: Record<string, any>) {
  const { initAutomationEngine, processScheduledTasks } = await import('../../../server/lib/automationEngine');
  const { eventBus } = await import('../../../server/lib/eventBus');
  const { client, journal } = clientEnregistreur(reponses);
  // Le bus est un singleton : chaque initAutomationEngine ajoute un listener → on repart propre.
  eventBus.removeAllListeners();
  initAutomationEngine({ supabase: client, twilio: { client: twilio, phoneNumber: '+15550000000' }, baseUrl: 'http://test' });
  return { client, journal, eventBus, processScheduledTasks };
}

/** Le listener du bus est asynchrone et non attendu : on laisse la file de promesses se vider. */
const laisserTravailler = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

describe('T4.1 — même événement livré deux fois → un seul effet immédiat', () => {
  it('ROUGE ATTENDU (F3) : deux émissions identiques d’appointment.created → un seul SMS', async () => {
    const { eventBus, journal } = await moteur({ ...donneesA(), automation_rules: { data: [regleImmediate] } });
    const evenement = { orgId: ORG, entityType: 'schedule_event', entityId: VISITE, metadata: { job_id: 'job-a', start_time: '2026-09-20T13:00:00Z' } };
    await eventBus.emit('appointment.created', evenement);
    await laisserTravailler();
    await eventBus.emit('appointment.created', evenement);
    await laisserTravailler();
    const envois = twilio.messages.create.mock.calls.length;
    const logs = requetes(journal, 'automation_execution_logs', 'insert').length;
    expect(envois, `SMS envoyés pour un seul rendez-vous : ${envois} (logs : ${logs})`).toBe(1);
    expect(logs).toBe(1);
  });

  it('témoin : deux événements pour deux rendez-vous différents → deux SMS', async () => {
    const { eventBus } = await moteur({ ...donneesA(), automation_rules: { data: [regleImmediate] } });
    await eventBus.emit('appointment.created', { orgId: ORG, entityType: 'schedule_event', entityId: VISITE, metadata: {} });
    await laisserTravailler();
    await eventBus.emit('appointment.created', { orgId: ORG, entityType: 'schedule_event', entityId: '77777777-7777-4777-8777-777777777777', metadata: {} });
    await laisserTravailler();
    expect(twilio.messages.create.mock.calls.length).toBe(2);
  });
});

describe('T4.3 — actions différées : la clé d’unicité absorbe le doublon', () => {
  it('deux émissions → deux tentatives d’insertion, la seconde en 23505 est absorbée sans erreur', async () => {
    const erreurs = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { eventBus, journal } = await moteur({
      ...donneesA(),
      automation_rules: { data: [regleDifferee] },
      // 1re insertion : ok ; 2e : violation de l'index unique idx_scheduled_tasks_dedup.
      automation_scheduled_tasks: (_req: unknown, n: number) => (n === 1 ? { data: null, error: null } : { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_scheduled_tasks_dedup"' } }),
    });
    const evenement = { orgId: ORG, entityType: 'schedule_event', entityId: VISITE, metadata: {} };
    await eventBus.emit('appointment.created', evenement);
    await laisserTravailler();
    await eventBus.emit('appointment.created', evenement);
    await laisserTravailler();
    const inserts = requetes(journal, 'automation_scheduled_tasks', 'insert');
    expect(inserts).toHaveLength(2);
    // La clé ne contient PAS la date (régression 20260810140000) et identifie règle + entité + action.
    for (const i of inserts) expect((i.valeur as any).execution_key).toBe(`${regleDifferee.id}:${VISITE}:0`);
    expect(erreurs, 'un 23505 attendu ne doit pas être rapporté comme erreur').not.toHaveBeenCalledWith(expect.stringContaining('failed to schedule task'), expect.anything());
    expect(twilio.messages.create).not.toHaveBeenCalled();
    erreurs.mockRestore();
  });
});

describe('T4.5 — reprise après échec du fournisseur', () => {
  const tache = (attempts = 0) => ({
    id: 'tache-1', org_id: ORG, automation_rule_id: REGLE, entity_type: 'schedule_event', entity_id: VISITE, attempts,
    execute_at: '2026-09-15T17:00:00Z', status: 'pending', execution_key: `${REGLE}:${VISITE}:0`,
    action_config: { type: 'send_sms', config: { body: 'Rappel [client_first_name]' }, trigger_event: 'appointment.created', event_metadata: {} },
    automation_rules: { name: 'Rappel', actions: [], conditions: {} },
  });

  it('un timeout Twilio → la tâche repasse pending avec reprise dans 5 min (comportement actuel, vert)', async () => {
    twilio.messages.create.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const { processScheduledTasks, client, journal } = await moteur({ ...donneesA(), automation_scheduled_tasks: { data: [tache(0)] } });
    await processScheduledTasks(client);
    const misesAJour = requetes(journal, 'automation_scheduled_tasks', 'update').map((r) => r.valeur as any);
    const cloture = misesAJour.at(-1);
    expect(cloture.status).toBe('pending');
    expect(cloture.last_error).toContain('reprise 1/4');
    expect(new Date(cloture.execute_at).getTime() - Date.now()).toBeCloseTo(5 * 60_000, -3);
  });

  it('ROUGE ATTENDU (F5) : la reprise porte la même clé d’idempotence fournisseur que la 1re tentative', async () => {
    twilio.messages.create.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const { processScheduledTasks, client } = await moteur({ ...donneesA(), automation_scheduled_tasks: { data: [tache(0)] } });
    await processScheduledTasks(client);
    // Deuxième tick : la tâche est de nouveau échue (attempts = 1).
    const { processScheduledTasks: p2, client: c2 } = await moteur({ ...donneesA(), automation_scheduled_tasks: { data: [tache(1)] } });
    await p2(c2);
    expect(twilio.messages.create).toHaveBeenCalledTimes(2);
    const cles = twilio.messages.create.mock.calls.map((c: any[]) => c[0]?.idempotencyKey ?? c[1]?.idempotencyKey ?? c[0]?.headers?.['Idempotency-Key']);
    expect(cles[0], `1re tentative sans clé d’idempotence fournisseur : ${JSON.stringify(twilio.messages.create.mock.calls[0][0])}`).toBeTruthy();
    expect(cles[1]).toBe(cles[0]);
  });

  it('une erreur définitive (« No recipient phone ») → failed sans reprise', async () => {
    const donnees = donneesA();
    (donnees.schedule_events.data.job.clients as any).phone = null;
    const { processScheduledTasks, client, journal } = await moteur({ ...donnees, automation_scheduled_tasks: { data: [tache(0)] } });
    await processScheduledTasks(client);
    const cloture = requetes(journal, 'automation_scheduled_tasks', 'update').map((r) => r.valeur as any).at(-1);
    expect(cloture.status).toBe('failed');
    expect(twilio.messages.create).not.toHaveBeenCalled();
  });

  it('4e échec transitoire → failed définitif', async () => {
    twilio.messages.create.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const { processScheduledTasks, client, journal } = await moteur({ ...donneesA(), automation_scheduled_tasks: { data: [tache(3)] } });
    await processScheduledTasks(client);
    const cloture = requetes(journal, 'automation_scheduled_tasks', 'update').map((r) => r.valeur as any).at(-1);
    expect(cloture.status).toBe('failed');
  });
});

describe('T4.10 — un log d’exécution qui échoue ne rejoue pas l’action', () => {
  it('insert du log en erreur → un seul SMS, aucune exception', async () => {
    const { eventBus, journal } = await moteur({
      ...donneesA(),
      automation_rules: { data: [regleImmediate] },
      automation_execution_logs: { data: null, error: { message: 'connexion perdue' } },
    });
    const erreurs = vi.spyOn(console, 'error').mockImplementation(() => {});
    await eventBus.emit('appointment.created', { orgId: ORG, entityType: 'schedule_event', entityId: VISITE, metadata: {} });
    await laisserTravailler();
    expect(twilio.messages.create).toHaveBeenCalledTimes(1);
    expect(requetes(journal, 'automation_execution_logs', 'insert')).toHaveLength(1);
    expect(erreurs).toHaveBeenCalledWith(expect.stringContaining('failed to write execution log'), 'connexion perdue');
    erreurs.mockRestore();
  });
});

describe('T4.6 (unitaire) — prise atomique : zéro ligne réclamée = on passe', () => {
  it('si le claim ne touche aucune ligne (autre instance), aucune action ne part', async () => {
    const tache = {
      id: 'tache-1', org_id: ORG, automation_rule_id: REGLE, entity_type: 'schedule_event', entity_id: VISITE, attempts: 0,
      action_config: { type: 'send_sms', config: { body: 'x' }, trigger_event: 'appointment.created' }, automation_rules: { name: 'r', actions: [], conditions: {} },
    };
    const { processScheduledTasks, client } = await moteur({
      ...donneesA(),
      // 1er appel : la sélection rend la tâche ; 2e appel (le claim) : 0 ligne.
      automation_scheduled_tasks: (req: any, n: number) => (req.op === 'update' && n > 1 ? { data: [] } : { data: [tache] }),
    });
    await processScheduledTasks(client);
    expect(twilio.messages.create).not.toHaveBeenCalled();
  });
});
