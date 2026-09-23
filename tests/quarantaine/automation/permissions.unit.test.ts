/**
 * T8 (unitaire) — PERMISSIONS : destinataire arbitraire et contexte d'exécution.
 *
 *   T8.3  une règle portant `config.to` fait partir le message vers ce numéro,
 *         pas vers le client                                     ROUGE (F18)
 *   T8.5  contexte d'exécution documenté : les écritures ne portent jamais
 *         l'acteur de l'événement — la tâche est attribuée au propriétaire de
 *         l'org, le SMS n'a pas d'expéditeur utilisateur                   vert
 *
 * Voir AUTOMATIONS_TEST_PLAN.md, T8, et AUTOMATIONS_AUDIT.md, A4.
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

import { clientEnregistreur, requetes } from './_enregistreur';

const ORG = '11111111-1111-4111-8111-111111111111';
const JOB = '44444444-4444-4444-8444-444444444444';
const ACTEUR = '99999999-9999-4999-8999-999999999999'; // technicien qui ferme le job
const OWNER = '00000000-0000-4000-8000-000000000001';

const monde = () => ({
  company_settings: { data: { company_name: 'A inc.', default_language: 'fr' } },
  jobs: { data: { title: 'Gouttières', client_id: 'client-a' } },
  clients: { data: { first_name: 'Alice', last_name: 'A', email: 'alice@a.test', phone: '+15145550101' } },
  job_agreements: { data: null }, sms_opt_outs: { data: null }, conversations: { data: { id: 'conv-1', client_id: 'client-a' } },
  messages: { data: null, count: 0 }, activity_log: { data: null, count: 0 }, automation_execution_logs: { data: null },
  memberships: { data: { user_id: OWNER } }, tasks: { data: null }, notifications: { data: null },
});

let twilio: any;
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-15T18:00:00Z')); twilio = { messages: { create: vi.fn(async () => ({ sid: 'SM' })) } }; });
afterEach(() => vi.useRealTimers());

async function jouer(actions: Array<{ type: string; config: Record<string, unknown> }>) {
  const { initAutomationEngine } = await import('../../../server/lib/automationEngine');
  const { eventBus } = await import('../../../server/lib/eventBus');
  const { client, journal } = clientEnregistreur({ ...monde(), automation_rules: { data: [{ id: 'r', org_id: ORG, name: 'r', trigger_event: 'job.completed', conditions: {}, delay_seconds: 0, is_active: true, actions }] } });
  eventBus.removeAllListeners();
  initAutomationEngine({ supabase: client, twilio: { client: twilio, phoneNumber: '+15550000000' }, baseUrl: 'http://test' });
  await eventBus.emit('job.completed', { orgId: ORG, entityType: 'job', entityId: JOB, actorId: ACTEUR, metadata: {} });
  const logs = () => requetes(journal, 'automation_execution_logs', 'insert').length;
  const limite = performance.now() + 5000;
  while (logs() < actions.length && performance.now() < limite) await new Promise((r) => setTimeout(r, 5));
  return journal;
}

describe('T8.3 — destinataire arbitraire dans une règle', () => {
  it('ROUGE ATTENDU (F18) : `config.to` est ignoré, le SMS part au client de l’entité', async () => {
    await jouer([{ type: 'send_sms', config: { body: 'Merci [client_first_name]', to: '+15145559999' } }]);
    expect(twilio.messages.create).toHaveBeenCalledTimes(1);
    const to = twilio.messages.create.mock.calls[0][0].to;
    expect(to, `SMS parti vers ${to} (le numéro écrit dans la règle) au lieu du client`).toBe('+15145550101');
  });

  it('ROUGE ATTENDU (F18) : `config.to` templatable — « [client_phone] » ou une adresse externe — n’est pas honoré non plus pour le courriel', async () => {
    const { sendEmail } = await import('../../../server/lib/mailer');
    await jouer([{ type: 'send_email', config: { subject: 'S', body: 'B', to: 'concurrent@exemple.test' } }]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const to = (sendEmail as any).mock.calls[0][0].to;
    expect(to, `courriel parti vers ${to}`).toBe('alice@a.test');
  });
});

describe('T8.5 — contexte d’exécution : « système », jamais l’acteur', () => {
  it('la tâche créée est attribuée au propriétaire de l’org, pas au technicien qui a déclenché', async () => {
    const journal = await jouer([{ type: 'create_task', config: { title: 'Suivi [client_name]' } }]);
    const tache = requetes(journal, 'tasks', 'insert')[0].valeur as any;
    expect(tache.created_by).toBe(OWNER);
    expect(tache.created_by).not.toBe(ACTEUR);
  });

  it('le SMS journalisé dans Messages n’a pas d’expéditeur utilisateur (c’est ce qui le distingue d’un envoi manuel pour le plafond)', async () => {
    const journal = await jouer([{ type: 'send_sms', config: { body: 'x' } }]);
    const message = requetes(journal, 'messages', 'insert')[0].valeur as any;
    expect(message.sender_user_id ?? null).toBeNull();
    expect(message.direction).toBe('outbound');
  });

  it('l’acteur de l’événement n’est écrit que dans activity_log (bus), jamais dans le log d’exécution', async () => {
    const journal = await jouer([{ type: 'log_activity', config: { event_type: 'x' } }]);
    const bus = requetes(journal, 'activity_log', 'insert')[0].valeur as any;
    expect(bus.actor_id).toBe(ACTEUR);
    const log = requetes(journal, 'automation_execution_logs', 'insert')[0].valeur as any;
    expect(log.actor_id ?? undefined).toBeUndefined(); // F8 : l'acteur n'est pas dans la trace d'exécution
  });
});
