/**
 * T12 / T6 (intégration, STAGING) — pause par org, dry-run, rattrapage de file.
 *
 *   T12.4  `company_settings.automations_paused_at` posé sur A → A muette,
 *          B continue                                       ROUGE (F6, migration M2)
 *   T12.5  `automations_dry_run` sur A → log avec dry_run, aucun appel Twilio
 *                                                            ROUGE (F6, migration M2)
 *   T6.3   120 tâches échues → 3 ticks les vident, aucune perte, aucune tâche
 *          restée « running »                                              vert
 *
 * Les deux premiers échouent dès la mise en place (colonne absente) : le
 * message le dit. Opt-in `AUTOMATIONS_IT=1` / `DB_URL` ; refuse la prod ;
 * fixtures `qa-t12-*` nettoyées.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { Banc, DISPONIBLE, attendre, type OrgTest } from './_fixtures';

const sms: Array<{ to: string; body: string }> = [];
vi.mock('../../../server/lib/mailer', () => ({ isMailerConfigured: () => true, sendEmail: vi.fn(async () => ({ sent: true, messageId: 'test' })) }));
vi.mock('../../../server/routes/emails', () => ({ getCompanySettings: async () => ({}), buildEmailLayout: (_c: unknown, b: string) => b, senderFor: () => ({ from: 'qa@lume.test' }), langueEntreprise: () => 'fr' }));
vi.mock('../../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15550000000' }));
const twilio = { messages: { create: vi.fn(async (p: { to: string; body: string }) => { sms.push({ to: p.to, body: p.body }); return { sid: `SM_${sms.length}` }; }) } };

const banc = new Banc('t12');
let A: OrgTest; let B: OrgTest;
let jetonA = ''; let jetonB = '';

function figerLHeureEnJournee() {
  const d = new Date(); d.setUTCHours(18, 0, 0, 0);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(d);
}

describe.skipIf(!DISPONIBLE)('T12 / T6 — coût et volume (staging)', () => {
  beforeAll(async () => {
    A = await banc.creerOrg('A', '+15145550101');
    B = await banc.creerOrg('B', '+15145550102');
    jetonA = await banc.jetonDe(A.owner.email);
    jetonB = await banc.jetonDe(B.owner.email);
    await banc.demarrerServeur({ client: twilio, phoneNumber: '+15550000000' });
  }, 90_000);
  afterAll(async () => { vi.useRealTimers(); await banc.nettoyer(); }, 60_000);
  beforeEach(() => { sms.length = 0; twilio.messages.create.mockClear(); figerLHeureEnJournee(); });

  it('T12.4 — ROUGE ATTENDU (F6, M2) : org A en pause → aucun envoi pour A, B continue', async () => {
    const { error } = await banc.admin.from('company_settings').update({ automations_paused_at: new Date().toISOString() }).eq('org_id', A.id);
    expect(error?.message ?? '', 'la colonne company_settings.automations_paused_at n’existe pas (migration M2 du plan)').toBe('');
    try {
      await banc.poster(jetonA, A.id, 'appointment-created', { eventId: A.visite, jobId: A.job, clientId: A.client.id });
      await banc.poster(jetonB, B.id, 'appointment-created', { eventId: B.visite, jobId: B.job, clientId: B.client.id });
      await attendre(async () => sms.some((s) => s.to === B.client.phone));
      await new Promise((r) => setTimeout(r, 2000));
      expect(sms.filter((s) => s.to === B.client.phone).length, 'B devait continuer').toBeGreaterThanOrEqual(1);
      expect(sms.filter((s) => s.to === A.client.phone).length, 'A est en pause : rien ne doit partir').toBe(0);
      const { taches } = await banc.tracesDe(A.visite);
      // Les tâches de A peuvent être planifiées (elles attendront la fin de la pause) mais aucune ne doit s'exécuter.
      expect(taches.filter((t) => t.status === 'completed')).toHaveLength(0);
    } finally {
      await banc.admin.from('company_settings').update({ automations_paused_at: null }).eq('org_id', A.id);
    }
  }, 40_000);

  it('T12.5 — ROUGE ATTENDU (F6, M2) : dry-run sur A → log « aurait envoyé », aucun appel Twilio', async () => {
    const { error } = await banc.admin.from('company_settings').update({ automations_dry_run: true }).eq('org_id', A.id);
    expect(error?.message ?? '', 'la colonne company_settings.automations_dry_run n’existe pas (migration M2 du plan)').toBe('');
    try {
      const { processScheduledTasks } = await import('../../../server/lib/automationEngine');
      const { data: t, error: e2 } = await banc.admin.from('automation_scheduled_tasks').insert({
        org_id: A.id, automation_rule_id: A.regles.get('job_reminder_2h'), entity_type: 'schedule_event', entity_id: A.visite,
        action_config: { type: 'send_sms', config: { body: 'Essai à blanc [client_first_name]' }, trigger_event: 'appointment.created', event_metadata: {} },
        status: 'pending', attempts: 0, execution_key: `t12-dry-${banc.stamp}`, execute_at: new Date(Date.now() - 60_000).toISOString(),
      }).select('id').single();
      if (e2) throw new Error(e2.message);
      await processScheduledTasks(banc.admin);
      expect(twilio.messages.create, 'Twilio appelé en mode dry-run').not.toHaveBeenCalled();
      const { data: logs } = await banc.admin.from('automation_execution_logs').select('result_data, result_success').eq('scheduled_task_id', t.id);
      expect(logs?.length).toBe(1);
      expect(logs![0].result_data?.dry_run).toBe(true);
    } finally {
      await banc.admin.from('company_settings').update({ automations_dry_run: false }).eq('org_id', A.id);
    }
  }, 40_000);

  it('T6.3 — 120 tâches échues → 3 ticks les vident, aucune perte, aucune tâche restée « running »', async () => {
    const { processScheduledTasks } = await import('../../../server/lib/automationEngine');
    const lignes = Array.from({ length: 120 }, (_, i) => ({
      org_id: A.id, automation_rule_id: A.regles.get('job_reminder_2h'), entity_type: 'schedule_event', entity_id: A.visite,
      action_config: { type: 'log_activity', config: { event_type: `qa_volume_${i}` }, trigger_event: 'appointment.created', event_metadata: {} },
      status: 'pending', attempts: 0, execution_key: `t6-${banc.stamp}-${i}`, execute_at: new Date(Date.now() - 60_000).toISOString(),
    }));
    const { error } = await banc.admin.from('automation_scheduled_tasks').insert(lignes);
    if (error) throw new Error(error.message);
    const etat = async () => {
      const { data } = await banc.admin.from('automation_scheduled_tasks').select('status').eq('org_id', A.id).like('execution_key', `t6-${banc.stamp}-%`);
      return (data || []).reduce((m: Record<string, number>, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
    };
    const debut = performance.now();
    for (let tick = 1; tick <= 3; tick++) {
      await processScheduledTasks(banc.admin);
      const e = await etat();
      expect(e.running ?? 0, `tick ${tick} : tâches restées running`).toBe(0);
      expect(e.completed ?? 0).toBe(Math.min(50 * tick, 120));
    }
    const duree = Math.round((performance.now() - debut) / 1000);
    const fin = await etat();
    expect(fin.completed).toBe(120);
    expect(fin.pending ?? 0).toBe(0);
    // Ordre de grandeur, non bloquant : 120 tâches log_activity en ~N s → à comparer d'une passe à l'autre.
    console.info(`[T6.3] 120 tâches en 3 ticks : ${duree} s`);
  }, 180_000);
});
