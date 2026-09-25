/**
 * PERF (unitaire) — COÛT EN REQUÊTES DE CHAQUE ACTION (A8 / F24).
 *
 * On ne mesure pas le temps (trop dépendant de la machine) : on COMPTE les
 * appels au client Supabase pour un événement, action par action, avec le
 * client enregistreur. Chaque chiffre est un cliquet : le dépasser doit être
 * un choix, pas un accident.
 *
 * Valeurs MESURÉES le 2026-09-13 sur le code actuel (événement `job.completed`,
 * une règle immédiate, une action). Le socle « règle + variables » coûte 8 :
 *   activity_log (bus), automation_rules, company_settings (variables), jobs,
 *   clients, job_agreements ×2 (contrat à signer + contrat signé),
 *   company_settings (langue) — deux relectures évitables de company_settings
 *   et deux de job_agreements pour un job sans contrat.
 * puis par action :
 *   log_activity        +2  (activity_log, log d'exécution)
 *   create_notification +2  (notifications, log)
 *   create_task         +3  (memberships, tasks, log)
 *   send_sms            +4  (sms_opt_outs, conversations, messages, log)
 *   send_email          +5  (email_unsubscribes lu DEUX fois + un INSERT
 *                            email_unsubscribes par courriel — getUnsubscribeUrl
 *                            crée un jeton à chaque envoi —, activity_log, log)
 *   request_review      +15 (company_settings et jobs relus, review_requests,
 *                            satisfaction_surveys, email_templates, puis le
 *                            coût d'un courriel + d'un SMS, review_requests, activity_log, log)
 *   welcome (4 actions) +13
 * Les seuils ci-dessous SONT ces mesures : ils tombent si le moteur en fait plus.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../server/lib/mailer', () => ({ isMailerConfigured: () => true, sendEmail: vi.fn(async () => ({ sent: true, messageId: 'x' })) }));
vi.mock('../../../server/routes/emails', () => ({ getCompanySettings: async () => ({}), buildEmailLayout: (_c: unknown, b: string) => b, senderFor: () => ({ from: 'test@lume.test' }), langueEntreprise: () => 'fr' }));
vi.mock('../../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15550000000' }));
// Le gel des communications lit la base par `getServiceClient()` — le VRAI
// client, pas le faux du test : la lecture échouait et aucun envoi ne partait.
vi.mock('../../../server/lib/migration/gel-communications', () => ({
  destinataireGele: async () => null,
  journaliserBlocage: () => {},
  MESSAGE_GEL: 'gel',
}));

import { clientEnregistreur } from './_enregistreur';

const ORG = '11111111-1111-4111-8111-111111111111';
const JOB = '44444444-4444-4444-8444-444444444444';

const monde = () => ({
  company_settings: { data: { company_name: 'A inc.', default_language: 'fr', review_enabled: true, google_review_url: 'https://g.page/r/x' } },
  jobs: { data: { title: 'Gouttières', client_id: 'client-a' } },
  clients: { data: { first_name: 'Alice', last_name: 'A', email: 'alice@a.test', phone: '+15145550101' } },
  job_agreements: { data: null }, sms_opt_outs: { data: null }, email_unsubscribes: { data: null }, conversations: { data: { id: 'conv-1', client_id: null } },
  messages: { data: null, count: 0 }, activity_log: { data: null, count: 0 }, automation_execution_logs: { data: null }, notifications: { data: null },
  tasks: { data: null }, memberships: { data: { user_id: 'owner' } }, review_requests: { data: null }, satisfaction_surveys: { data: { id: 's' } }, email_templates: { data: null },
});

let twilio: any;
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-15T18:00:00Z')); twilio = { messages: { create: vi.fn(async () => ({ sid: 'SM' })) } }; });
afterEach(() => vi.useRealTimers());

async function coutDe(actions: Array<{ type: string; config: Record<string, unknown> }>) {
  const { initAutomationEngine } = await import('../../../server/lib/automationEngine');
  const { eventBus } = await import('../../../server/lib/eventBus');
  const { client, journal } = clientEnregistreur({ ...monde(), automation_rules: { data: [{ id: 'r', org_id: ORG, name: 'r', trigger_event: 'job.completed', conditions: {}, delay_seconds: 0, is_active: true, actions }] } });
  eventBus.removeAllListeners();
  initAutomationEngine({ supabase: client, twilio: { client: twilio, phoneNumber: '+15550000000' }, baseUrl: 'http://test' });
  await eventBus.emit('job.completed', { orgId: ORG, entityType: 'job', entityId: JOB, metadata: {} });
  // Le listener est asynchrone et les actions chargent des modules à la volée :
  // on attend que CHAQUE action ait écrit son log d'exécution (borne réelle 5 s).
  const logs = () => journal.filter((r) => r.table === 'automation_execution_logs' && r.op === 'insert').length;
  const limite = performance.now() + 5000;
  while (logs() < actions.length && performance.now() < limite) await new Promise((r) => setTimeout(r, 5));
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  return { total: journal.length, detail: journal.map((r) => `${r.op}:${r.table}`) };
}

describe('cliquet — requêtes Supabase par événement immédiat', () => {
  const SOCLE = 8; // mesuré : bus, règles, réglages, jobs, clients, job_agreements ×2, langue
  const cas: Array<[string, Array<{ type: string; config: Record<string, unknown> }>, number]> = [
    ['aucune action (socle)', [], SOCLE],
    ['log_activity', [{ type: 'log_activity', config: { event_type: 'x' } }], SOCLE + 2],
    ['create_notification', [{ type: 'create_notification', config: { title: 't', body: 'b' } }], SOCLE + 2],
    ['create_task', [{ type: 'create_task', config: { title: 't' } }], SOCLE + 3],
    ['send_sms', [{ type: 'send_sms', config: { body: 'x' } }], SOCLE + 4],
    // +6 depuis le 2026-09-23 : la vérification de consentement (LCAP) lit
    // `clients` avant tout courriel — y compris transactionnel, car
    // `email_opt_out_at` bloque aussi celui-là. C'est un CHOIX assumé : une
    // requête contre une infraction. Le SMS transactionnel, lui, court-circuite
    // (le STOP est déjà vérifié par `sms_opt_outs`), d'où send_sms inchangé.
    ['send_email', [{ type: 'send_email', config: { subject: 's', body: 'b' } }], SOCLE + 6],
    // +17 : cette action envoie un courriel ET un SMS, donc deux passages par
    // la vérification de consentement (le SMS y passe ici car la demande d'avis
    // est commerciale).
    ['request_review', [{ type: 'request_review', config: {} }], SOCLE + 17],
    ['welcome (sms + email + notification + log)', [{ type: 'send_sms', config: { body: 'x' } }, { type: 'send_email', config: { subject: 's', body: 'b' } }, { type: 'create_notification', config: { title: 't', body: 'b' } }, { type: 'log_activity', config: { event_type: 'x' } }], SOCLE + 4 + 6 + 2 + 2],
  ];
  for (const [nom, actions, seuil] of cas) {
    it(`${nom} : ≤ ${seuil} requêtes`, async () => {
      const { total, detail } = await coutDe(actions);
      expect(total, `mesuré ${total} : ${detail.join(', ')}`).toBeLessThanOrEqual(seuil);
    });
  }

  it('tableau récapitulatif (informatif)', async () => {
    const lignes: string[] = [];
    for (const [nom, actions] of cas) lignes.push(`${nom.padEnd(44)} ${String((await coutDe(actions)).total).padStart(3)}`);
    process.stdout.write(`[perf] requêtes par événement immédiat (1 règle)` + '\n' + lignes.join('\n') + '\n');
    expect(lignes.length).toBe(cas.length);
  });
});
