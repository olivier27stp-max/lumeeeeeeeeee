/**
 * T10 (unitaire) — ERREURS ET DÉPENDANCES EXTERNES.
 *
 * Vrais modules, client enregistreur, fournisseurs pilotés par le test
 * (rejet, blocage, écriture de suivi refusée), horloge figée en journée.
 *
 * ROUGE ATTENDU aujourd'hui :
 *   T10.3  après un échec DÉFINITIF, personne n'est prévenu (aucune notification)
 *   T10.4  un fournisseur qui ne répond pas bloque le tick sans limite (aucun
 *          délai d'attente autour de sendEmail)
 *   T10.5  une écriture de suivi refusée n'empêche pas l'action de se dire
 *          réussie (request_review sans ligne review_requests → l'anti-doublon
 *          7 jours est aveugle) — absence de transaction, R6
 *   T10.7  une règle qui lève avant sa boucle d'actions fait sauter les règles
 *          suivantes du même événement (catch global de handleEvent)
 *   T10.9  un événement émis avant l'initialisation du moteur est perdu sans
 *          trace autre qu'activity_log (F9)
 *
 * Voir AUTOMATIONS_TEST_PLAN.md, T10.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mailer = { sendEmail: vi.fn(async (_p: any) => ({ sent: true, messageId: 'x' })) };
vi.mock('../../../server/lib/mailer', () => ({ isMailerConfigured: () => true, sendEmail: (p: any) => mailer.sendEmail(p) }));
vi.mock('../../../server/routes/emails', () => ({ getCompanySettings: async () => ({}), buildEmailLayout: (_c: unknown, b: string) => b, senderFor: () => ({ from: 'test@lume.test' }), langueEntreprise: () => 'fr' }));
vi.mock('../../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15550000000' }));
// Le gel des communications lit la base par `getServiceClient()` — le VRAI
// client, pas le faux du test : la lecture échouait et aucun envoi ne partait.
vi.mock('../../../server/lib/migration/gel-communications', () => ({
  destinataireGele: async () => null,
  journaliserBlocage: () => {},
  MESSAGE_GEL: 'gel',
}));

import { clientEnregistreur, requetes, type Requete } from './_enregistreur';

const ORG = '11111111-1111-4111-8111-111111111111';
const VISITE = '55555555-5555-4555-8555-555555555555';
const JOB = '44444444-4444-4444-8444-444444444444';

const monde = () => ({
  company_settings: { data: { company_name: 'A inc.', default_language: 'fr', review_enabled: true, google_review_url: 'https://g.page/r/x' } },
  schedule_events: { data: { id: VISITE, job_id: JOB, start_at: '2026-09-25T13:00:00Z', status: 'scheduled', deleted_at: null, job: { id: JOB, title: 'Gouttières', property_address: '10 rue A', client_id: 'client-a', clients: { first_name: 'Alice', last_name: 'A', email: 'alice@a.test', phone: '+15145550101' } } } },
  jobs: { data: { title: 'Gouttières', client_id: 'client-a' } },
  // `sms_consent_at` : ces tâches différées sont COMMERCIALES, donc soumises au
  // verrou de consentement (LCAP). Sans base légale, chaque envoi échouerait
  // sur « consentement manquant » au lieu du défaut que le test examine.
  clients: { data: { id: 'client-a', first_name: 'Alice', last_name: 'A', email: 'alice@a.test', phone: '+15145550101', sms_consent_at: '2026-01-01T00:00:00Z', email_consent_at: '2026-01-01T00:00:00Z', email_opt_out_at: null } },
  job_agreements: { data: null }, sms_opt_outs: { data: null }, conversations: { data: { id: 'conv-1', client_id: null } },
  messages: { data: null, count: 0 }, activity_log: { data: null, count: 0 }, automation_execution_logs: { data: null }, notifications: { data: null },
  review_requests: { data: null }, satisfaction_surveys: { data: { id: 'sondage-1' } }, email_templates: { data: null },
});

const tache = (id: string, attempts: number, corps = 'Rappel', extra: Record<string, unknown> = {}) => ({
  id, org_id: ORG, automation_rule_id: 'regle-1', entity_type: 'schedule_event', entity_id: VISITE, attempts,
  execute_at: '2026-09-15T17:00:00Z', status: 'pending', execution_key: `regle-1:${VISITE}:${id}`,
  action_config: { type: 'send_sms', config: { body: corps }, trigger_event: 'appointment.created', event_metadata: {} },
  automation_rules: { name: 'Rappel', actions: [], conditions: {} }, ...extra,
});

let twilio: { messages: { create: ReturnType<typeof vi.fn> } };
beforeEach(() => {
  vi.clearAllMocks();
  mailer.sendEmail.mockImplementation(async () => ({ sent: true, messageId: 'x' }));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-15T18:00:00Z'));
  twilio = { messages: { create: vi.fn(async (p: any) => ({ sid: `SM_${p.body}` })) } };
});
afterEach(() => vi.useRealTimers());

async function moteur(reponses: Record<string, any>) {
  const { initAutomationEngine, processScheduledTasks } = await import('../../../server/lib/automationEngine');
  const { eventBus } = await import('../../../server/lib/eventBus');
  const { client, journal } = clientEnregistreur(reponses);
  eventBus.removeAllListeners();
  initAutomationEngine({ supabase: client, twilio: { client: twilio, phoneNumber: '+15550000000' }, baseUrl: 'http://test' });
  return { client, journal, eventBus, processScheduledTasks };
}
const laisserTravailler = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
const clotures = (journal: Requete[]) => requetes(journal, 'automation_scheduled_tasks', 'update').map((r) => r.valeur as any).filter((v) => v && !('attempts' in v) && v.status !== 'pending' || (v?.last_error));

describe('T10.1 — fournisseur SMS en panne : reprises à délai croissant, puis abandon', () => {
  it('échecs successifs → +5 min, +30 min, +2 h, puis failed', async () => {
    const attentes: Array<number | 'failed'> = [];
    for (const attempts of [0, 1, 2, 3]) {
      twilio.messages.create.mockRejectedValueOnce(new Error('ECONNRESET'));
      const { processScheduledTasks, client, journal } = await moteur({ ...monde(), automation_scheduled_tasks: { data: [tache('t', attempts)] } });
      await processScheduledTasks(client);
      const fin = requetes(journal, 'automation_scheduled_tasks', 'update').map((r) => r.valeur as any).at(-1);
      attentes.push(fin.status === 'failed' ? 'failed' : Math.round((new Date(fin.execute_at).getTime() - Date.now()) / 60_000));
      if (fin.status !== 'failed') expect(fin.last_error).toContain(`reprise ${attempts + 1}/4`);
    }
    expect(attentes).toEqual([5, 30, 120, 'failed']);
  });

  it('jamais de perte silencieuse : chaque échec écrit un log d’exécution avec la cause', async () => {
    twilio.messages.create.mockRejectedValueOnce(new Error('ECONNRESET'));
    const { processScheduledTasks, client, journal } = await moteur({ ...monde(), automation_scheduled_tasks: { data: [tache('t', 0)] } });
    await processScheduledTasks(client);
    const logs = requetes(journal, 'automation_execution_logs', 'insert').map((r) => r.valeur as any);
    expect(logs).toHaveLength(1);
    expect(logs[0].result_success).toBe(false);
    expect(logs[0].result_error).toBe('ECONNRESET');
    expect(logs[0].scheduled_task_id).toBe('t');
  });
});

describe('T10.2 — erreur définitive : abandon immédiat, sans reprise', () => {
  for (const [cause, monter] of [
    ['destinataire sans téléphone', (m: any) => { m.schedule_events.data.job.clients.phone = null; }],
    ['désabonné (STOP)', (m: any) => { m.sms_opt_outs = { data: { id: 'optout' } }; }],
  ] as Array<[string, (m: any) => void]>) {
    it(cause, async () => {
      const m = monde(); monter(m);
      const { processScheduledTasks, client, journal } = await moteur({ ...m, automation_scheduled_tasks: { data: [tache('t', 0)] } });
      await processScheduledTasks(client);
      const fin = requetes(journal, 'automation_scheduled_tasks', 'update').map((r) => r.valeur as any).at(-1);
      expect(fin.status).toBe('failed');
      expect(twilio.messages.create).not.toHaveBeenCalled();
    });
  }
});

describe('T10.3 — après un échec définitif, l’administrateur est prévenu', () => {
  it('ROUGE ATTENDU : une notification à l’org existe avec le motif en clair', async () => {
    // `phone` est inféré `string` depuis le fixture ; le cas testé est justement son absence.
    const m = monde(); (m.schedule_events.data.job.clients as { phone: string | null }).phone = null;
    const { processScheduledTasks, client, journal } = await moteur({ ...m, automation_scheduled_tasks: { data: [tache('t', 0)] } });
    await processScheduledTasks(client);
    const fin = requetes(journal, 'automation_scheduled_tasks', 'update').map((r) => r.valeur as any).at(-1);
    expect(fin.status).toBe('failed');
    const notifs = requetes(journal, 'notifications', 'insert').map((r) => r.valeur as any);
    expect(notifs.length, 'aucune notification après un échec définitif : l’entrepreneur ne saura jamais que son client n’a rien reçu').toBeGreaterThan(0);
    expect(`${notifs[0]?.title} ${notifs[0]?.body}`).not.toMatch(/No recipient phone/); // cause traduite, pas l'erreur brute
  });
});

describe('T10.4 — un fournisseur qui ne répond pas ne bloque pas le tick', () => {
  it('ROUGE ATTENDU : sendEmail bloqué 40 s → l’action échoue en moins de 8 s et la tâche est reprise', async () => {
    mailer.sendEmail.mockImplementation(() => new Promise((r) => setTimeout(() => r({ sent: true, messageId: 'tard' }), 40_000)));
    const t = tache('t', 0, 'x', { action_config: { type: 'send_email', config: { subject: 'S', body: 'B' }, trigger_event: 'appointment.created', event_metadata: {} } });
    const { processScheduledTasks, client, journal } = await moteur({ ...monde(), automation_scheduled_tasks: { data: [t] } });
    const garde = new Promise<'bloque'>((r) => setTimeout(() => r('bloque'), 8_000));
    const issue = await Promise.race([processScheduledTasks(client).then(() => 'termine' as const), garde]);
    expect(issue, 'le tick est resté suspendu derrière un fournisseur muet : aucune autre tâche ne sera traitée').toBe('termine');
    const fin = requetes(journal, 'automation_scheduled_tasks', 'update').map((r) => r.valeur as any).at(-1);
    expect(fin?.status).toBe('pending');
  }, 15_000);
});

describe('T10.5 — écritures multiples sans transaction (R6)', () => {
  it('ROUGE ATTENDU : request_review dont le suivi (review_requests) est refusé ne doit pas se dire réussi', async () => {
    const { executeRequestReview } = await import('../../../server/lib/actions');
    const { client, journal } = clientEnregistreur({ ...monde(), review_requests: (req: any) => (req.op === 'insert' ? { data: null, error: { message: 'connexion perdue' } } : { data: null }) });
    const vars = { client_first_name: 'Alice', client_name: 'Alice A', client_email: 'alice@a.test', client_phone: '+15145550101', company_name: 'A inc.', job_name: 'Gouttières' };
    const r = await executeRequestReview({}, vars, { supabase: client, orgId: ORG, entityType: 'job', entityId: JOB, twilio: { client: twilio, phoneNumber: '+1' }, baseUrl: 'http://t' });
    const sondages = requetes(journal, 'satisfaction_surveys', 'insert').length;
    const suivis = requetes(journal, 'review_requests', 'insert').length;
    expect(sondages).toBe(1);
    expect(suivis).toBe(1);
    // Le sondage existe, le suivi non : l'anti-doublon 7 jours ne verra jamais cet envoi.
    expect(r.success, 'action rapportée réussie alors que son suivi n’a pas été écrit : demi-état').toBe(false);
  });
});

describe('T10.6 — une tâche qui échoue n’empêche pas les autres du même tick', () => {
  it('3 tâches, la 2e lève → 1re et 3e exécutées, 2e reprise', async () => {
    twilio.messages.create.mockImplementation(async (p: any) => { if (/BOOM/.test(p.body)) throw new Error('BOOM'); return { sid: 'ok' }; });
    const { processScheduledTasks, client, journal } = await moteur({ ...monde(), automation_scheduled_tasks: { data: [tache('t1', 0, 'un'), tache('t2', 0, 'BOOM'), tache('t3', 0, 'trois')] } });
    await processScheduledTasks(client);
    expect(twilio.messages.create).toHaveBeenCalledTimes(3);
    const logs = requetes(journal, 'automation_execution_logs', 'insert').map((r) => r.valeur as any);
    expect(logs.map((l) => l.result_success)).toEqual([true, false, true]);
    const reprise = requetes(journal, 'automation_scheduled_tasks', 'update').map((r) => r.valeur as any).filter((v) => v.last_error);
    expect(reprise).toHaveLength(1);
    expect(reprise[0].status).toBe('pending');
  });
});

describe('T10.7 — une règle qui lève ne fait pas sauter les règles suivantes du même événement', () => {
  it('ROUGE ATTENDU : la 1re règle lève (lecture qui explose) → la 2e règle doit quand même s’exécuter', async () => {
    const regle = (id: string) => ({ id, org_id: ORG, name: id, trigger_event: 'appointment.created', conditions: {}, delay_seconds: 0, is_active: true, actions: [{ type: 'log_activity', config: { event_type: id } }] });
    const erreurs = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { eventBus, journal } = await moteur({
      ...monde(),
      automation_rules: { data: [regle('r1'), regle('r2')] },
      // La 1re résolution de variables lève (incident réseau sur la lecture des réglages) ; les suivantes marchent.
      company_settings: (_req: any, n: number) => { if (n === 1) throw new Error('ECONNRESET pendant company_settings'); return { data: { company_name: 'A inc.' } }; },
    });
    await eventBus.emit('appointment.created', { orgId: ORG, entityType: 'schedule_event', entityId: VISITE, metadata: {} });
    await laisserTravailler();
    const executees = requetes(journal, 'automation_execution_logs', 'insert').map((r) => (r.valeur as any).action_config?.event_type);
    expect(executees, `règles exécutées : ${JSON.stringify(executees)} — la 2e a été sautée par le catch global`).toContain('r2');
    erreurs.mockRestore();
  });
});

describe('T10.8 — une lecture en erreur dans une condition d’arrêt conserve la tâche', () => {
  it('invoices illisible → la tâche n’est ni annulée ni exécutée à l’aveugle, elle est reprise plus tard', async () => {
    const t = { ...tache('t', 0), entity_type: 'invoice', entity_id: 'inv-1' };
    const erreurs = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { processScheduledTasks, client, journal } = await moteur({
      ...monde(),
      invoices: { data: null, error: { message: 'statement timeout' } },
      automation_scheduled_tasks: { data: [t] },
    });
    await processScheduledTasks(client);
    const majs = requetes(journal, 'automation_scheduled_tasks', 'update').map((r) => r.valeur as any);
    expect(majs.some((v) => v.status === 'cancelled'), 'tâche annulée sur une simple erreur de lecture').toBe(false);
    expect(erreurs).toHaveBeenCalledWith(expect.stringContaining("condition d'arrêt indéterminable"), 'statement timeout');
    erreurs.mockRestore();
  });
});

describe('T10.9 — un événement émis avant l’initialisation du moteur', () => {
  it('ROUGE ATTENDU (F9) : il est perdu — rien n’est persisté pour un traitement ultérieur', async () => {
    vi.resetModules();
    const { eventBus } = await import('../../../server/lib/eventBus');
    const { client, journal } = clientEnregistreur({ activity_log: { data: null } });
    eventBus.init(client);
    // Le moteur n'est PAS initialisé (démarrage en cours, redéploiement…).
    await eventBus.emit('appointment.created', { orgId: ORG, entityType: 'schedule_event', entityId: VISITE, metadata: {} });
    await laisserTravailler();
    const persiste = journal.filter((r) => r.op === 'insert' && r.table !== 'activity_log');
    expect(persiste.map((r) => r.table), 'aucune file d’événements : la confirmation de ce rendez-vous ne partira jamais').not.toHaveLength(0);
  });
});
