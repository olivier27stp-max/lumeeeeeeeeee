/**
 * T7 (intégration, STAGING) — ISOLATION MULTI-TENANT DU MOTEUR D'AUTOMATISATIONS.
 *
 * Deux organisations réelles (A et B), les vraies routes Express
 * `POST /api/automations/events/*`, le vrai bus, le vrai moteur sous
 * service_role, la vraie RLS. Seuls les fournisseurs (Twilio, courriel) sont
 * remplacés par des enregistreurs : aucun message ne part.
 *
 * Ce qu'on prouve :
 *   T7.1/T7.2  un membre de A ne peut pas faire traiter par le moteur une
 *              entité de B (visite, facture, lead) — 404 attendu, rien en base
 *   T7.6       un événement légitime de A produit des tâches/logs de A, que B
 *              ne voit pas par PostgREST
 *   T7.7       deux orgs avec les mêmes presets : seules les règles de A tournent
 *   T7.8       un numéro de téléphone partagé entre A et B ne fait pas traverser
 *   T7.9/T7.10 un technicien de A, et un membre de B, ne peuvent pas écrire les
 *              tables du moteur de A par PostgREST
 *
 * ROUGE ATTENDU aujourd'hui : T7.1, T7.2, T7.3, T7.4 (F1 — routes sans
 * vérification d'appartenance + lectures par id seul), T7.9 (F4 — RLS
 * d'écriture ouverte à tout membre, migration M1 du plan).
 *
 * Opt-in `AUTOMATIONS_IT=1` (local) ou `DB_URL` (CI) ; refuse la production ;
 * fixtures `qa-t7-<stamp>` nettoyées dans afterAll. Voir `_fixtures.ts`.
 *
 * CORRECTIFS APPLIQUÉS le 2026-09-14 (branche fix/automatisations-audit) :
 * les cas « ROUGE ATTENDU » ci-dessous sont désormais verts, sauf mention
 * contraire dans leur titre. Les descriptions d'origine sont conservées comme
 * mémoire de ce qui était cassé.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Banc, DISPONIBLE, attendre, type OrgTest } from './_fixtures';

/* ── Fournisseurs mockés : enregistreurs, jamais d'envoi ───────── */
const courrielsEnvoyes: Array<{ to: string; subject: string }> = [];
const smsEnvoyes: Array<{ to: string; body: string }> = [];
vi.mock('../../server/lib/mailer', () => ({
  isMailerConfigured: () => true,
  sendEmail: vi.fn(async (p: { to: string; subject: string }) => { courrielsEnvoyes.push({ to: p.to, subject: p.subject }); return { sent: true, messageId: 'test' }; }),
}));
vi.mock('../../server/routes/emails', () => ({
  getCompanySettings: async () => ({}),
  buildEmailLayout: (_c: unknown, body: string) => body,
  senderFor: () => ({ from: 'qa@lume.test' }),
}));
vi.mock('../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15550000000' }));
const twilioFactice = { messages: { create: vi.fn(async (p: { to: string; body: string }) => { smsEnvoyes.push({ to: p.to, body: p.body }); return { sid: 'SM_qa' }; }) } };

const banc = new Banc('t7');
let A: OrgTest; let B: OrgTest;
let technicienA: { id: string; email: string };

describe.skipIf(!DISPONIBLE)('T7 — isolation multi-tenant (staging)', () => {
  beforeAll(async () => {
    // Même numéro de client dans les deux orgs : T7.8 vérifie qu'il ne fait pas traverser.
    A = await banc.creerOrg('A', '+15145550101');
    B = await banc.creerOrg('B', '+15145550101');
    technicienA = await banc.creerUtilisateur('A-tech');
    const { error } = await banc.admin.from('memberships').insert({ user_id: technicienA.id, org_id: A.id, role: 'technician', status: 'active' });
    if (error) throw new Error(`technicien : ${error.message}`);
    await banc.demarrerServeur({ client: twilioFactice, phoneNumber: '+15550000000' });
  }, 60_000);

  afterAll(async () => { await banc.nettoyer(); }, 60_000);

  it('T7.6 — témoin : un événement légitime de A produit des tâches et des logs de A', async () => {
    const jeton = await banc.jetonDe(A.owner.email);
    const r = await banc.poster(jeton, A.id, 'appointment-created', { eventId: A.visite, jobId: A.job, clientId: A.client.id });
    expect(r.statut).toBe(200);
    const ok = await attendre(async () => (await banc.tracesDe(A.visite)).taches.length >= 2);
    expect(ok, 'le moteur n’a produit aucune tâche pour la visite de A').toBe(true);
    const { taches, logs } = await banc.tracesDe(A.visite);
    for (const t of taches) expect(t.org_id).toBe(A.id);
    for (const l of logs) expect(l.org_id).toBe(A.id);
    // T7.7 : mêmes presets dans B, mais seules les règles de A ont tourné.
    const reglesA = new Set(A.regles.values());
    for (const t of taches) expect(reglesA.has(t.automation_rule_id), `tâche liée à une règle hors A : ${t.automation_rule_id}`).toBe(true);
    // La confirmation immédiate de A part après la réponse HTTP : on l'attend
    // ici, sinon elle arrive pendant T7.1 et — A et B partageant le même numéro
    // de client — passerait pour un SMS de A au client de B.
    await attendre(async () => smsEnvoyes.some((s) => /confirm/i.test(s.body)));
    for (const l of logs) if (l.automation_rule_id) expect(reglesA.has(l.automation_rule_id)).toBe(true);
  }, 30_000);

  it('T7.6 (suite) — B ne voit rien de A par PostgREST', async () => {
    const b = banc.clientDe(await banc.jetonDe(B.owner.email));
    const [regles, taches, logs] = await Promise.all([
      b.from('automation_rules').select('id').eq('org_id', A.id),
      b.from('automation_scheduled_tasks').select('id').eq('org_id', A.id),
      b.from('automation_execution_logs').select('id').eq('org_id', A.id),
    ]);
    expect(regles.data ?? []).toHaveLength(0);
    expect(taches.data ?? []).toHaveLength(0);
    expect(logs.data ?? []).toHaveLength(0);
  });

  it('T7.8 — un numéro partagé entre A et B ne fait pas traverser : les variables sont celles de A', async () => {
    const { resolveEntityVariables } = await import('../../server/lib/actions');
    const vars = await resolveEntityVariables(banc.admin, A.id, 'schedule_event', A.visite);
    expect(vars.client_first_name).toBe(A.client.nom);
    expect(vars.client_email).toBe(A.client.email);
    expect(vars.appointment_address).toContain('Org A');
  });

  it('T7.1 — F1 corrigé : A ne peut pas faire traiter la visite de B', async () => {
    courrielsEnvoyes.length = 0; smsEnvoyes.length = 0;
    const jeton = await banc.jetonDe(A.owner.email);
    const r = await banc.poster(jeton, A.id, 'appointment-created', { eventId: B.visite, jobId: B.job });
    await attendre(async () => (await banc.tracesDe(B.visite)).taches.length > 0, 12);
    const { taches, logs } = await banc.tracesDe(B.visite);
    const fuite = {
      statut: r.statut,
      taches_creees_pour_entite_de_B: taches.length,
      logs_pour_entite_de_B: logs.length,
      courriels_au_client_de_B: courrielsEnvoyes.filter((c) => c.to === B.client.email).length,
      sms_au_client_de_B: smsEnvoyes.filter((s) => s.to === B.client.phone).length,
    };
    expect(r.statut, `attendu 404, reçu ${JSON.stringify(fuite)}`).toBe(404);
    expect(taches, `tâches planifiées par A sur une visite de B : ${JSON.stringify(fuite)}`).toHaveLength(0);
    expect(logs, `exécutions de A sur une visite de B : ${JSON.stringify(fuite)}`).toHaveLength(0);
    expect(fuite.courriels_au_client_de_B + fuite.sms_au_client_de_B, `messages de A partis au client de B : ${JSON.stringify(fuite)}`).toBe(0);
  }, 30_000);

  it('T7.3 — F1 corrigé : resolveEntityVariables(org A, visite de B) ne rend rien de B', async () => {
    const { resolveEntityVariables } = await import('../../server/lib/actions');
    const vars = await resolveEntityVariables(banc.admin, A.id, 'schedule_event', B.visite);
    expect(vars.client_email ?? '', `courriel du client de B résolu pour A : ${vars.client_email}`).toBe('');
    expect(vars.client_phone ?? '').toBe('');
    expect(vars.appointment_address ?? '', `adresse de B résolue pour A : ${vars.appointment_address}`).toBe('');
  });

  it('T7.4 — F1 corrigé : idem pour un job, un client, un lead de B', async () => {
    const { resolveEntityVariables } = await import('../../server/lib/actions');
    for (const [type, id] of [['job', B.job], ['client', B.client.id], ['lead', B.client.id]] as const) {
      const vars = await resolveEntityVariables(banc.admin, A.id, type, id);
      expect(vars.client_email ?? '', `${type} de B résolu pour A`).toBe('');
      expect(vars.client_name ?? '', `${type} de B résolu pour A`).toBe('');
    }
  });

  it('T7.2 — F1 corrigé : les autres routes refusent aussi une entité de B', async () => {
    const jeton = await banc.jetonDe(A.owner.email);
    const cas: Array<[string, Record<string, unknown>]> = [
      ['appointment-cancelled', { eventId: B.visite, jobId: B.job }],
      ['appointment-rescheduled', { eventId: B.visite, jobId: B.job, startTime: new Date(Date.now() + 5 * 86400_000).toISOString() }],
      ['lead-created', { leadId: B.client.id }],
      ['lead-status-changed', { leadId: B.client.id, oldStatus: 'new', newStatus: 'lost' }],
    ];
    const statuts: Record<string, number> = {};
    for (const [chemin, corps] of cas) statuts[chemin] = (await banc.poster(jeton, A.id, chemin, corps)).statut;
    await new Promise((r) => setTimeout(r, 2500));
    for (const [chemin] of cas) expect(statuts[chemin], `${chemin} : ${JSON.stringify(statuts)}`).toBe(404);
    const { data: tachesA } = await banc.admin.from('automation_scheduled_tasks').select('entity_id').eq('org_id', A.id).in('entity_id', [B.visite, B.client.id, B.job]);
    expect(tachesA ?? [], 'tâches de A sur des entités de B').toHaveLength(0);
  }, 30_000);

  it('T7.9 — F4 corrigé (M1, migration M1) : un technicien de A ne peut pas écrire les tables du moteur', async () => {
    const t = banc.clientDe(await banc.jetonDe(technicienA.email));
    const regle = A.regles.get('appointment_confirmation')!;
    const { data: tacheA } = await banc.admin.from('automation_scheduled_tasks').select('id').eq('org_id', A.id).limit(1).maybeSingle();

    const tentatives: Record<string, number> = {};
    const r1 = await t.from('automation_rules').update({ is_active: false }).eq('id', regle).select('id');
    tentatives['update automation_rules'] = r1.data?.length ?? 0;
    const r2 = await t.from('automation_rules').insert({ org_id: A.id, name: `${banc.prefixe} règle technicien`, trigger_event: 'job.completed', actions: [{ type: 'update_status', config: { table: 'invoices', status: 'paid' } }] }).select('id');
    tentatives['insert automation_rules'] = r2.data?.length ?? 0;
    if (r2.data?.length) await banc.admin.from('automation_rules').delete().in('id', r2.data.map((x) => x.id));
    if (tacheA) {
      const r3 = await t.from('automation_scheduled_tasks').update({ execute_at: new Date().toISOString() }).eq('id', tacheA.id).select('id');
      tentatives['update automation_scheduled_tasks'] = r3.data?.length ?? 0;
    }
    const r4 = await t.from('automation_execution_logs').delete().eq('org_id', A.id).select('id');
    tentatives['delete automation_execution_logs'] = r4.data?.length ?? 0;
    await banc.admin.from('automation_rules').update({ is_active: true }).eq('id', regle);

    for (const [geste, n] of Object.entries(tentatives)) expect(n, `${geste} : ${n} ligne(s) touchée(s) par un technicien`).toBe(0);
  });

  it('T7.10 — un membre de B ne peut rien écrire dans les tables de A', async () => {
    const b = banc.clientDe(await banc.jetonDe(B.owner.email));
    const regle = A.regles.get('appointment_confirmation')!;
    const r1 = await b.from('automation_rules').update({ is_active: false }).eq('id', regle).select('id');
    const r2 = await b.from('automation_scheduled_tasks').update({ status: 'cancelled' }).eq('org_id', A.id).select('id');
    const r3 = await b.from('automation_execution_logs').delete().eq('org_id', A.id).select('id');
    expect(r1.data ?? []).toHaveLength(0);
    expect(r2.data ?? []).toHaveLength(0);
    expect(r3.data ?? []).toHaveLength(0);
    await banc.admin.from('automation_rules').update({ is_active: true }).eq('id', regle);
  });
});
