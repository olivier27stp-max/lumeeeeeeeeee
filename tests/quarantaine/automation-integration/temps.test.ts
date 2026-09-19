/**
 * T9 (intégration, STAGING) — CE QUI CHANGE PENDANT QU'UNE TÂCHE ATTEND.
 *
 * Une organisation réelle, le vrai moteur sous service_role, la vraie file.
 * Twilio et courriel remplacés par des enregistreurs. Horloge du processus
 * figée à 14 h Montréal (heures calmes hors jeu).
 *
 * Ce qu'on prouve :
 *   T9.8   règle désactivée pendant l'attente → la tâche NE part PAS      ROUGE (F16)
 *   T9.9   texte modifié pendant l'attente → le NOUVEAU texte part        ROUGE (F16)
 *   T9.10a visite supprimée pendant l'attente → tâche annulée              vert
 *   T9.10b job supprimé pendant l'attente → tâche annulée, pas de « Bonjour , »  ROUGE (F16)
 *   T9.7   date de visite changée SANS passer par le hook → les rappels
 *          restent calés sur l'ancienne date                        LIMITE DOCUMENTÉE
 *
 * Opt-in `AUTOMATIONS_IT=1` / `DB_URL` ; refuse la prod ; fixtures `qa-t9-*`
 * nettoyées. Voir `_fixtures.ts`.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { Banc, DISPONIBLE, type OrgTest } from './_fixtures';

const sms: Array<{ to: string; body: string }> = [];
vi.mock('../../../server/lib/mailer', () => ({ isMailerConfigured: () => true, sendEmail: vi.fn(async () => ({ sent: true, messageId: 'test' })) }));
vi.mock('../../../server/routes/emails', () => ({ getCompanySettings: async () => ({}), buildEmailLayout: (_c: unknown, b: string) => b, senderFor: () => ({ from: 'qa@lume.test' }) }));
vi.mock('../../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15550000000' }));
const twilio = { messages: { create: vi.fn(async (p: { to: string; body: string }) => { sms.push({ to: p.to, body: p.body }); return { sid: `SM_${sms.length}` }; }) } };

const banc = new Banc('t9');
let A: OrgTest;

function figerLHeureEnJournee() {
  const d = new Date(); d.setUTCHours(18, 0, 0, 0);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(d);
}

async function insererTache(champs: Record<string, unknown>) {
  const { data, error } = await banc.admin.from('automation_scheduled_tasks').insert({
    org_id: A.id, automation_rule_id: A.regles.get('job_reminder_2h'), entity_type: 'schedule_event', entity_id: A.visite,
    action_config: { type: 'send_sms', config: { body: 'Ancien texte [client_first_name]' }, trigger_event: 'appointment.created', event_metadata: {} },
    status: 'pending', attempts: 0, execution_key: `t9-${banc.stamp}-${Math.random().toString(36).slice(2, 8)}`, execute_at: new Date(Date.now() - 60_000).toISOString(),
    ...champs,
  }).select('id').single();
  if (error) throw new Error(`insert tâche : ${error.message}`);
  return data.id as string;
}

const statutDe = async (id: string) => (await banc.admin.from('automation_scheduled_tasks').select('status, execute_at, last_error').eq('id', id).single()).data!;

describe.skipIf(!DISPONIBLE)('T9 — le temps (staging)', () => {
  beforeAll(async () => {
    A = await banc.creerOrg('A');
    await banc.demarrerServeur({ client: twilio, phoneNumber: '+15550000000' });
  }, 60_000);
  afterAll(async () => { vi.useRealTimers(); await banc.nettoyer(); }, 60_000);
  beforeEach(() => { sms.length = 0; twilio.messages.create.mockClear(); figerLHeureEnJournee(); });

  it('T9.8 — ROUGE ATTENDU (F16) : règle désactivée pendant l’attente → la tâche ne part pas', async () => {
    const { processScheduledTasks } = await import('../../../server/lib/automationEngine');
    const regle = A.regles.get('job_reminder_2h')!;
    const tache = await insererTache({ automation_rule_id: regle });
    await banc.admin.from('automation_rules').update({ is_active: false }).eq('id', regle);
    try {
      await processScheduledTasks(banc.admin);
      const apres = await statutDe(tache);
      expect(sms.length, `SMS parti alors que la règle est désactivée (statut : ${apres.status})`).toBe(0);
      expect(apres.status).toBe('cancelled');
    } finally {
      await banc.admin.from('automation_rules').update({ is_active: true }).eq('id', regle);
    }
  }, 30_000);

  it('T9.9 — ROUGE ATTENDU (F16) : texte modifié pendant l’attente → le nouveau texte part', async () => {
    const { processScheduledTasks } = await import('../../../server/lib/automationEngine');
    const regle = A.regles.get('job_reminder_2h')!;
    const { data: avant } = await banc.admin.from('automation_rules').select('actions').eq('id', regle).single();
    const tache = await insererTache({ automation_rule_id: regle });
    const actions = (avant!.actions as any[]).map((a) => (a.type === 'send_sms' ? { ...a, config: { ...a.config, body: 'Nouveau texte [client_first_name]' } } : a));
    await banc.admin.from('automation_rules').update({ actions }).eq('id', regle);
    try {
      await processScheduledTasks(banc.admin);
      expect(sms.length).toBe(1);
      expect(sms[0].body, `texte parti : « ${sms[0].body} »`).toContain('Nouveau texte');
      expect((await statutDe(tache)).status).toBe('completed');
    } finally {
      await banc.admin.from('automation_rules').update({ actions: avant!.actions }).eq('id', regle);
    }
  }, 30_000);

  it('T9.10a — visite supprimée pendant l’attente → tâche annulée, rien n’est envoyé', async () => {
    const { processScheduledTasks } = await import('../../../server/lib/automationEngine');
    const tache = await insererTache({});
    await banc.admin.from('schedule_events').update({ deleted_at: new Date().toISOString() }).eq('id', A.visite);
    try {
      await processScheduledTasks(banc.admin);
      expect(sms.length).toBe(0);
      expect((await statutDe(tache)).status).toBe('cancelled');
    } finally {
      await banc.admin.from('schedule_events').update({ deleted_at: null }).eq('id', A.visite);
    }
  }, 30_000);

  it('T9.10b — ROUGE ATTENDU (F16) : job supprimé pendant l’attente → tâche annulée, jamais de « Bonjour , »', async () => {
    const { processScheduledTasks } = await import('../../../server/lib/automationEngine');
    const regle = A.regles.get('thank_you_after_job')!;
    const tache = await insererTache({
      automation_rule_id: regle, entity_type: 'job', entity_id: A.job,
      action_config: { type: 'send_sms', config: { body: 'Merci [client_first_name] pour [job_name]' }, trigger_event: 'job.completed', event_metadata: {} },
    });
    await banc.admin.from('jobs').update({ deleted_at: new Date().toISOString() }).eq('id', A.job);
    try {
      await processScheduledTasks(banc.admin);
      const apres = await statutDe(tache);
      expect(sms.length, `SMS parti pour un job supprimé : « ${sms[0]?.body} » (statut : ${apres.status})`).toBe(0);
      expect(apres.status).toBe('cancelled');
    } finally {
      await banc.admin.from('jobs').update({ deleted_at: null }).eq('id', A.job);
    }
  }, 30_000);

  it('T9.7 — LIMITE DOCUMENTÉE : la date de visite changée directement en base ne recale pas les rappels', async () => {
    const { processScheduledTasks } = await import('../../../server/lib/automationEngine');
    const { data: v } = await banc.admin.from('schedule_events').select('start_at').eq('id', A.visite).single();
    const ancienStart = new Date(v!.start_at).getTime();
    const executeAt = new Date(ancienStart - 2 * 3600_000).toISOString(); // « 2 h avant » l'ancienne date, dans le futur
    const tache = await insererTache({ execute_at: executeAt });
    // La visite est déplacée d'une journée SANS passer par POST /automations/events/appointment-rescheduled
    // (import, SQL, mobile hors ligne…).
    await banc.admin.from('schedule_events').update({ start_at: new Date(ancienStart + 86400_000).toISOString(), end_at: new Date(ancienStart + 86400_000 + 3600_000).toISOString() }).eq('id', A.visite);
    try {
      await processScheduledTasks(banc.admin);
      const apres = await statutDe(tache);
      // Comportement ACTUEL, figé pour qu'un changement soit délibéré : le rappel reste calé sur l'ancienne date.
      expect(apres.status).toBe('pending');
      expect(new Date(apres.execute_at).toISOString()).toBe(new Date(executeAt).toISOString());
    } finally {
      await banc.admin.from('schedule_events').update({ start_at: v!.start_at }).eq('id', A.visite);
      await banc.admin.from('automation_scheduled_tasks').update({ status: 'cancelled', completed_at: new Date().toISOString() }).eq('id', tache);
    }
  }, 30_000);
});
