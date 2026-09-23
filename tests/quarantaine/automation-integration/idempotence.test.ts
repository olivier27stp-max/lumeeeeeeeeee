/**
 * T4 (intégration, STAGING) — IDEMPOTENCE ET REPRISE DU MOTEUR.
 *
 * Une organisation réelle, le vrai routeur, le vrai moteur sous service_role,
 * la vraie table `automation_scheduled_tasks` avec son index unique
 * `idx_scheduled_tasks_dedup` ; Twilio et courriel remplacés par des
 * enregistreurs. Horloge du processus figée à 14 h (Montréal) pour que les
 * heures calmes ne reportent pas les envois immédiats — la base, elle, garde
 * son horloge réelle.
 *
 * Ce qu'on prouve :
 *   T4.2  le même hook posté deux fois → un seul SMS de confirmation, aucune
 *         tâche différée en double                                  ROUGE (F3)
 *   T4.4  tâche reprise après un « crash » alors que son exécution est déjà
 *         journalisée réussie → pas de renvoi                         ROUGE (F5)
 *   T4.6  deux dépilages concurrents sur la même tâche → un seul envoi   vert
 *   T4.7  tâche « en cours » depuis 14 min : pas reprise ; 16 min : reprise vert
 *   T4.8  même événement rejoué : pas de 2e tâche tant que la 1re est en
 *         attente ; nouvelle tâche une fois la 1re terminée              vert
 *   T4.9  deux demandes d'avis à une minute d'intervalle → un seul sondage vert
 *
 * Opt-in `AUTOMATIONS_IT=1` / `DB_URL` ; refuse la prod ; fixtures `qa-t4-*`
 * nettoyées. Voir `_fixtures.ts`.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { Banc, DISPONIBLE, attendre, type OrgTest } from './_fixtures';

const courriels: Array<{ to: string; subject: string }> = [];
const sms: Array<{ to: string; body: string; args: any }> = [];
vi.mock('../../../server/lib/mailer', () => ({
  isMailerConfigured: () => true,
  sendEmail: vi.fn(async (p: { to: string; subject: string }) => { courriels.push({ to: p.to, subject: p.subject }); return { sent: true, messageId: 'test' }; }),
}));
vi.mock('../../../server/routes/emails', () => ({ getCompanySettings: async () => ({}), buildEmailLayout: (_c: unknown, b: string) => b, senderFor: () => ({ from: 'qa@lume.test' }), langueEntreprise: () => 'fr' }));
vi.mock('../../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15550000000' }));
const twilio = { messages: { create: vi.fn(async (p: { to: string; body: string }) => { sms.push({ to: p.to, body: p.body, args: p }); return { sid: `SM_${sms.length}` }; }) } };

const banc = new Banc('t4');
let A: OrgTest;
let jeton = '';

/** 14 h à Montréal aujourd'hui (18 h UTC) : hors heures calmes, été comme hiver. */
function figerLHeureEnJournee() {
  const d = new Date(); d.setUTCHours(18, 0, 0, 0);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(d);
}

async function insererTache(admin: any, champs: Record<string, unknown>) {
  const { data, error } = await admin.from('automation_scheduled_tasks').insert({
    org_id: A.id, automation_rule_id: A.regles.get('job_reminder_2h'), entity_type: 'schedule_event', entity_id: A.visite,
    action_config: { type: 'send_sms', config: { body: 'Rappel test [client_first_name]' }, trigger_event: 'appointment.created', event_metadata: {} },
    status: 'pending', attempts: 0, execution_key: `t4-${banc.stamp}-${Math.random().toString(36).slice(2, 8)}`, execute_at: new Date().toISOString(),
    ...champs,
  }).select('id, execution_key').single();
  if (error) throw new Error(`insert tâche : ${error.message}`);
  return data as { id: string; execution_key: string };
}

describe.skipIf(!DISPONIBLE)('T4 — idempotence et reprise (staging)', () => {
  beforeAll(async () => {
    A = await banc.creerOrg('A');
    jeton = await banc.jetonDe(A.owner.email);
    await banc.demarrerServeur({ client: twilio, phoneNumber: '+15550000000' });
  }, 60_000);
  afterAll(async () => { vi.useRealTimers(); await banc.nettoyer(); }, 60_000);
  beforeEach(() => { sms.length = 0; courriels.length = 0; twilio.messages.create.mockClear(); figerLHeureEnJournee(); });

  it('T4.2 — ROUGE ATTENDU (F3) : le même hook posté deux fois → un seul SMS de confirmation', async () => {
    const corps = { eventId: A.visite, jobId: A.job, clientId: A.client.id };
    const r1 = await banc.poster(jeton, A.id, 'appointment-created', corps);
    const r2 = await banc.poster(jeton, A.id, 'appointment-created', corps);
    expect(r1.statut).toBe(200); expect(r2.statut).toBe(200);
    await attendre(async () => (await banc.tracesDe(A.visite)).logs.filter((l) => l.action_type === 'send_sms').length >= 1);
    await new Promise((r) => setTimeout(r, 1500));
    const { taches, logs } = await banc.tracesDe(A.visite);
    const smsConfirmation = sms.filter((s) => s.to === A.client.phone && /confirm/i.test(s.body));
    // Les tâches différées sont dédupliquées par l'index unique : une par (règle, action).
    const cles = taches.filter((t) => t.status === 'pending').map((t) => t.execution_key);
    expect(new Set(cles).size, 'tâches différées en double').toBe(cles.length);
    expect(smsConfirmation.length, `SMS de confirmation envoyés pour un seul rendez-vous : ${smsConfirmation.length} (logs send_sms : ${logs.filter((l) => l.action_type === 'send_sms').length})`).toBe(1);
  }, 40_000);

  it('T4.6 — deux dépilages concurrents sur la même tâche échue → un seul envoi', async () => {
    const { processScheduledTasks } = await import('../../../server/lib/automationEngine');
    const t = await insererTache(banc.admin, { execute_at: new Date(Date.now() - 60_000).toISOString() });
    await Promise.all([processScheduledTasks(banc.admin), processScheduledTasks(banc.admin)]);
    const { data: apres } = await banc.admin.from('automation_scheduled_tasks').select('status, attempts').eq('id', t.id).single();
    expect(apres?.status).toBe('completed');
    expect(apres?.attempts).toBe(1);
    expect(sms.filter((s) => /Rappel test/.test(s.body)).length).toBe(1);
  }, 30_000);

  it('T4.7 — une tâche « en cours » depuis 14 min n’est pas reprise ; depuis 16 min, elle l’est', async () => {
    const { processScheduledTasks } = await import('../../../server/lib/automationEngine');
    const recente = await insererTache(banc.admin, { status: 'running', attempts: 1, execute_at: new Date(Date.now() - 14 * 60_000).toISOString() });
    const figee = await insererTache(banc.admin, { status: 'running', attempts: 1, execute_at: new Date(Date.now() - 16 * 60_000).toISOString() });
    await processScheduledTasks(banc.admin);
    const { data: r } = await banc.admin.from('automation_scheduled_tasks').select('id, status').in('id', [recente.id, figee.id]);
    const statut = Object.fromEntries((r || []).map((x) => [x.id, x.status]));
    expect(statut[recente.id], 'tâche récente reprise trop tôt').toBe('running');
    expect(statut[figee.id], 'tâche figée non reprise').toBe('completed');
    expect(sms.filter((s) => /Rappel test/.test(s.body)).length).toBe(1);
    await banc.admin.from('automation_scheduled_tasks').update({ status: 'cancelled', completed_at: new Date().toISOString() }).eq('id', recente.id);
  }, 30_000);

  it('T4.4 — ROUGE ATTENDU (F5) : une tâche reprise après un crash dont l’exécution est déjà journalisée réussie ne renvoie pas', async () => {
    const { processScheduledTasks } = await import('../../../server/lib/automationEngine');
    // Scénario : SMS parti, log écrit, puis crash avant la clôture → la tâche reste `running`.
    const t = await insererTache(banc.admin, { status: 'running', attempts: 1, execute_at: new Date(Date.now() - 16 * 60_000).toISOString() });
    const { error } = await banc.admin.from('automation_execution_logs').insert({
      org_id: A.id, automation_rule_id: A.regles.get('job_reminder_2h'), scheduled_task_id: t.id, trigger_event: 'appointment.created',
      entity_type: 'schedule_event', entity_id: A.visite, action_type: 'send_sms', action_config: { body: 'Rappel test' },
      result_success: true, result_data: { to: A.client.phone, sid: 'SM_avant_crash' },
    });
    if (error) throw new Error(`log : ${error.message}`);
    await processScheduledTasks(banc.admin);
    const renvois = sms.filter((s) => /Rappel test/.test(s.body)).length;
    const { data: apres } = await banc.admin.from('automation_scheduled_tasks').select('status').eq('id', t.id).single();
    expect(renvois, `SMS renvoyé après reprise alors que l'exécution était déjà journalisée réussie (statut final : ${apres?.status})`).toBe(0);
    expect(apres?.status).toBe('completed');
  }, 30_000);

  it('T4.8 — un événement rejoué ne double pas une relance en attente, mais en crée une nouvelle après clôture', async () => {
    const regle = A.regles.get('lead_followup_1d')!;
    const tachesLead = async () => (await banc.admin.from('automation_scheduled_tasks').select('id, status, execution_key').eq('automation_rule_id', regle).eq('entity_id', A.client.id)).data || [];
    await banc.poster(jeton, A.id, 'lead-created', { leadId: A.client.id });
    await banc.poster(jeton, A.id, 'lead-created', { leadId: A.client.id });
    await attendre(async () => (await tachesLead()).length >= 1);
    await new Promise((r) => setTimeout(r, 1000));
    const avant = await tachesLead();
    // lead_followup_1d porte N actions (SMS + journal) : une tâche par action, jamais deux fois la même clé.
    const nbActions = ((await banc.admin.from('automation_rules').select('actions').eq('id', regle).single()).data?.actions as unknown[]).length;
    const pendantes = avant.filter((t) => t.status === 'pending');
    expect(pendantes, `attendu ${nbActions} tâches (une par action) pour deux émissions`).toHaveLength(nbActions);
    expect(new Set(pendantes.map((t) => t.execution_key)).size).toBe(nbActions);
    // Clôture des relances, puis nouvel envoi (le devis est renvoyé, par ex.) → nouvelles relances légitimes.
    await banc.admin.from('automation_scheduled_tasks').update({ status: 'completed', completed_at: new Date().toISOString() }).in('id', pendantes.map((t) => t.id));
    await banc.poster(jeton, A.id, 'lead-created', { leadId: A.client.id });
    await attendre(async () => (await tachesLead()).filter((t) => t.status === 'pending').length >= nbActions);
    const apres = await tachesLead();
    expect(apres.filter((t) => t.status === 'pending')).toHaveLength(nbActions);
    expect(apres).toHaveLength(2 * nbActions);
  }, 40_000);

  it('T4.9 — deux demandes d’avis à une minute d’intervalle → un seul sondage', async () => {
    const { executeRequestReview, resolveEntityVariables } = await import('../../../server/lib/actions');
    await banc.admin.from('company_settings').update({ review_enabled: true, google_review_url: 'https://g.page/r/qa-test' }).eq('org_id', A.id);
    const vars = await resolveEntityVariables(banc.admin, A.id, 'job', A.job);
    const ctx = { supabase: banc.admin, orgId: A.id, entityType: 'job', entityId: A.job, twilio: { client: twilio, phoneNumber: '+15550000000' }, baseUrl: 'http://qa.test' };
    const r1 = await executeRequestReview({}, { ...vars }, ctx);
    const r2 = await executeRequestReview({}, { ...vars }, ctx);
    expect(r1.success, r1.error).toBe(true);
    expect(r2.success).toBe(false);
    expect(r2.error).toMatch(/already sent/i);
    const { data: sondages } = await banc.admin.from('satisfaction_surveys').select('id').eq('org_id', A.id).eq('job_id', A.job);
    expect(sondages ?? []).toHaveLength(1);
  }, 30_000);
});
