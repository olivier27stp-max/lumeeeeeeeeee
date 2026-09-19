/**
 * T11 (intégration, STAGING) — désabonnements à l'exécution, trace Loi 25, purge.
 *
 *   T11.3  STOP reçu APRÈS la planification d'une relance → refus à l'exécution   vert
 *   T11.4  désabonnement courriel après planification → refus à l'exécution,
 *          SANS reprise                                             ROUGE (F26)
 *          (le refus est bien là, mais « has unsubscribed » n'est pas dans la
 *          liste des erreurs définitives d'isTransientFailure : la relance est
 *          retentée 3 fois sur 2 h 35 avant d'être abandonnée)
 *   T11.7  le log d'un envoi porte destinataire, acteur, événement, instantané
 *          de la règle (colonnes M3)                                    ROUGE (F8)
 *   T11.8  purge_automation_history(12) existe et n'efface que l'ancien (M6) ROUGE (F21)
 *
 * Opt-in `AUTOMATIONS_IT=1` / `DB_URL` ; refuse la prod ; fixtures `qa-t11-*`
 * nettoyées (les opt-outs sont sur l'org de test, effacés en cascade).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { Banc, DISPONIBLE, type OrgTest } from './_fixtures';

const sms: Array<{ to: string; body: string }> = [];
const courriels: Array<{ to: string }> = [];
vi.mock('../../../server/lib/mailer', () => ({ isMailerConfigured: () => true, sendEmail: vi.fn(async (p: any) => { courriels.push({ to: p.to }); return { sent: true, messageId: 'test' }; }) }));
vi.mock('../../../server/routes/emails', () => ({ getCompanySettings: async () => ({}), buildEmailLayout: (_c: unknown, b: string) => b, senderFor: () => ({ from: 'qa@lume.test' }) }));
vi.mock('../../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15550000000' }));
const twilio = { messages: { create: vi.fn(async (p: { to: string; body: string }) => { sms.push({ to: p.to, body: p.body }); return { sid: `SM_${sms.length}` }; }) } };

const banc = new Banc('t11');
let A: OrgTest;

function figerLHeureEnJournee() { const d = new Date(); d.setUTCHours(18, 0, 0, 0); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(d); }

async function insererTache(type: 'send_sms' | 'send_email', config: Record<string, unknown>) {
  const { data, error } = await banc.admin.from('automation_scheduled_tasks').insert({
    org_id: A.id, automation_rule_id: A.regles.get('quote_followup_3d'), entity_type: 'schedule_event', entity_id: A.visite,
    action_config: { type, config, trigger_event: 'appointment.created', event_metadata: {} },
    status: 'pending', attempts: 0, execution_key: `t11-${banc.stamp}-${Math.random().toString(36).slice(2, 8)}`, execute_at: new Date(Date.now() - 60_000).toISOString(),
  }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id as string;
}
const statutDe = async (id: string) => (await banc.admin.from('automation_scheduled_tasks').select('status, last_error').eq('id', id).single()).data!;

describe.skipIf(!DISPONIBLE)('T11 — conformité (staging)', () => {
  beforeAll(async () => {
    A = await banc.creerOrg('A');
    await banc.demarrerServeur({ client: twilio, phoneNumber: '+15550000000' });
  }, 60_000);
  afterAll(async () => { vi.useRealTimers(); await banc.nettoyer(); }, 60_000);
  beforeEach(() => { sms.length = 0; courriels.length = 0; twilio.messages.create.mockClear(); figerLHeureEnJournee(); });

  it('T11.3 — STOP reçu après la planification → la relance SMS est refusée à l’exécution, sans reprise', async () => {
    const { processScheduledTasks } = await import('../../../server/lib/automationEngine');
    const t = await insererTache('send_sms', { body: 'Relance [client_first_name]' });
    const { error } = await banc.admin.from('sms_opt_outs').insert({ org_id: A.id, phone: A.client.phone, reason: 'STOP' });
    if (error) throw new Error(error.message);
    await processScheduledTasks(banc.admin);
    expect(sms.filter((s) => s.to === A.client.phone)).toHaveLength(0);
    const apres = await statutDe(t);
    expect(apres.status).toBe('failed');
    expect(apres.last_error).toMatch(/opted out/i);
    await banc.admin.from('sms_opt_outs').delete().eq('org_id', A.id);
  }, 30_000);

  it('T11.4 — ROUGE ATTENDU (F26) : désabonnement courriel après la planification → refus à l’exécution, sans reprise', async () => {
    const { processScheduledTasks } = await import('../../../server/lib/automationEngine');
    const t = await insererTache('send_email', { subject: 'Relance', body: '<p>Bonjour [client_first_name]</p>' });
    const { error } = await banc.admin.from('email_unsubscribes').insert({ org_id: A.id, email: A.client.email.toLowerCase(), category: 'marketing', token: `t11-${banc.stamp}`, reason: 'lien de désabonnement' });
    if (error) throw new Error(error.message);
    await processScheduledTasks(banc.admin);
    expect(courriels.filter((c) => c.to === A.client.email)).toHaveLength(0);
    const apres = await statutDe(t);
    expect(apres.last_error).toMatch(/unsubscribed/i);
    expect(apres.status, `désabonné, donc définitif — pourtant : ${apres.status} (${apres.last_error})`).toBe('failed');
    await banc.admin.from('email_unsubscribes').delete().eq('org_id', A.id);
  }, 30_000);

  it('T11.7 — ROUGE ATTENDU (F8, M3) : le log d’un envoi porte le destinataire, l’acteur, l’événement et l’instantané de la règle', async () => {
    const { processScheduledTasks } = await import('../../../server/lib/automationEngine');
    const t = await insererTache('send_sms', { body: 'Trace [client_first_name]' });
    await processScheduledTasks(banc.admin);
    const { data, error } = await banc.admin.from('automation_execution_logs').select('id, recipient, actor_id, event_id, rule_snapshot, conditions_evaluated').eq('scheduled_task_id', t).maybeSingle();
    expect(error?.message ?? '', 'colonnes de trace absentes de automation_execution_logs (migration M3 du plan)').toBe('');
    expect(data?.recipient).toBe(A.client.phone);
    expect(data?.rule_snapshot).toBeTruthy();
  }, 30_000);

  it('T11.8 — ROUGE ATTENDU (F21, M6) : purge_automation_history(12) efface les journaux de plus de 12 mois et garde les récents', async () => {
    const vieux = new Date(Date.now() - 400 * 86400_000).toISOString();
    const { data: ancien, error: e1 } = await banc.admin.from('automation_execution_logs').insert({
      org_id: A.id, automation_rule_id: A.regles.get('quote_followup_3d'), trigger_event: 'qa', entity_type: 'schedule_event', entity_id: A.visite, action_type: 'log_activity', action_config: {}, result_success: true, created_at: vieux,
    }).select('id').single();
    if (e1) throw new Error(e1.message);
    const { data: recent, error: e2 } = await banc.admin.from('automation_execution_logs').insert({
      org_id: A.id, automation_rule_id: A.regles.get('quote_followup_3d'), trigger_event: 'qa', entity_type: 'schedule_event', entity_id: A.visite, action_type: 'log_activity', action_config: {}, result_success: true,
    }).select('id').single();
    if (e2) throw new Error(e2.message);
    const { error } = await banc.admin.rpc('purge_automation_history', { p_months: 12 });
    expect(error?.message ?? '', 'la fonction purge_automation_history n’existe pas (migration M6 du plan)').toBe('');
    const { data: restants } = await banc.admin.from('automation_execution_logs').select('id').in('id', [ancien.id, recent.id]);
    expect((restants || []).map((r) => r.id)).toEqual([recent.id]);
  }, 30_000);
});
