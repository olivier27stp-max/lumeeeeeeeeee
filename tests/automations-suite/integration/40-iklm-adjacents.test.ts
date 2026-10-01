/**
 * K — Systèmes adjacents aux automatisations, en version condensée des
 * catégories B à F : effet correct, négatif, idempotence / double exécution,
 * échec fournisseur (bac à sable `panne`), isolation A/B.
 *
 *  · relances de factures (executerRelancesPaiement, cron payment-reminders)
 *  · factures récurrentes (runDueSchedules + « exécuter maintenant » de Lumi)
 *  · jobs récurrents (processRecurringJobs)
 *  · rapports planifiés (processScheduledReports)
 *  · relances d'abonnement Lume (runDunningScan)
 *
 * Chaque moteur tourne sur le bureau A (ou B) SEULEMENT (option `orgId`),
 * jamais sur les autres entreprises de staging. Rien ne part : bac à sable
 * (entreprise ou destinataire en lume-qa.test) ; on lit envois_simules.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { demarrerMoteur, marque } from '../harnais/moteur';
import { sessionDe, COMPTES } from '../harnais/bureau-test';
import { TABLE_REPRISES } from '../../../server/lib/courriels/reprises';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
const nettoyer: Array<() => PromiseLike<unknown>> = [];
const jour = (decalage: number) => new Date(Date.now() + decalage * 86400_000).toISOString().slice(0, 10);

async function mode(org: string, m: 'succes' | 'panne') {
  await b.admin.from('orgs_envois_simules').update({ mode: m }).eq('org_id', org);
  (await import('../../../server/lib/bac-a-sable')).oublierBacASable();
}

async function client(org: string, m: string, email: string): Promise<string> {
  const { data, error } = await b.admin.from('clients').insert({
    org_id: org, created_by: org === b.orgA ? b.users.proprioA : b.users.proprioB, first_name: 'Adjacent', last_name: m, status: 'active',
    email, phone: '+15555550144', email_consent_at: new Date().toISOString(), sms_consent_at: new Date().toISOString(),
  }).select('id').single();
  if (error) throw new Error(error.message);
  nettoyer.push(() => b.admin.from('clients').delete().eq('id', data.id));
  return data.id as string;
}

async function facture(org: string, clientId: string, champs: Record<string, unknown>): Promise<string> {
  const { data, error } = await b.admin.from('invoices').insert({
    org_id: org, client_id: clientId, created_by: org === b.orgA ? b.users.proprioA : b.users.proprioB,
    invoice_number: `QA-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    subtotal_cents: 50000, tax_cents: 0, total_cents: 50000, paid_cents: 0, balance_cents: 50000,
    // Le statut est DÉRIVÉ par trigger (issued_at + solde) : « envoyée » = émise, solde > 0.
    ...(champs.status && champs.status !== 'draft' ? { issued_at: new Date(Date.now() - 45 * 86400_000).toISOString() } : {}),
    ...champs,
  }).select('id').single();
  if (error) throw new Error(error.message);
  nettoyer.push(() => b.admin.from('invoices').delete().eq('id', data.id));
  return data.id as string;
}

async function courrielsVers(adresse: string, depuis: string) {
  const { data } = await b.admin.from('envois_simules').select('canal, destinataire, sujet, corps, meta').eq('canal', 'courriel').eq('destinataire', adresse).gte('created_at', depuis);
  return data ?? [];
}

beforeAll(async () => { b = await demarrerMoteur(); });
afterAll(async () => {
  await mode(b.orgA, 'succes');
  for (const f of nettoyer.reverse()) await f();
});

/* ═══════════════════════ Relances de factures ═══════════════════════ */
describe('K — relances de factures (cron payment-reminders)', () => {
  const publicBase = 'https://staging.lume-qa.test';
  let reglagesAvant: Record<string, unknown> | null = null;
  const relancer = async (org: string) => (await import('../../../server/routes/reminders-cron')).executerRelancesPaiement({ publicBase, orgId: org });

  beforeAll(async () => {
    const { data } = await b.admin.from('reminder_settings').select('*').eq('org_id', b.orgA).maybeSingle();
    reglagesAvant = data;
    await b.admin.from('reminder_settings').upsert({
      org_id: b.orgA, enabled: true,
      schedule: [{ days_after_due: 1, channel: 'email' }, { days_after_due: 7, channel: 'email' }, { days_after_due: 14, channel: 'email' }, { days_after_due: 30, channel: 'email' }],
    }, { onConflict: 'org_id' });
  });
  afterAll(async () => {
    if (reglagesAvant) await b.admin.from('reminder_settings').upsert(reglagesAvant, { onConflict: 'org_id' });
    else await b.admin.from('reminder_settings').delete().eq('org_id', b.orgA);
  });

  it('[K-020] facture en retard de 3 jours → UN courriel de relance (palier J+1), journalisé', async () => {
    const depuis = new Date().toISOString();
    const m = marque('K-020');
    const adresse = `k020-${Date.now().toString(36)}@lume-qa.test`;
    const inv = await facture(b.orgA, await client(b.orgA, m, adresse), { status: 'sent', due_date: jour(-3) });
    const r = await relancer(b.orgA);
    expect(r.errors.filter((e) => e.invoice_id === inv)).toEqual([]);
    const envois = await courrielsVers(adresse, depuis);
    expect(envois.length).toBe(1);
    const { data: log } = await b.admin.from('reminder_log').select('days_after_due, channel, status').eq('invoice_id', inv);
    expect(log).toEqual([{ days_after_due: 1, channel: 'email', status: 'sent' }]);
  });

  it('[K-021] facture en retard de 40 jours : UN seul courriel le même soir (le palier le plus haut), pas quatre', async () => {
    const depuis = new Date().toISOString();
    const adresse = `k021-${Date.now().toString(36)}@lume-qa.test`;
    const inv = await facture(b.orgA, await client(b.orgA, marque('K-021'), adresse), { status: 'sent', due_date: jour(-40) });
    await relancer(b.orgA);
    expect((await courrielsVers(adresse, depuis)).length).toBe(1);
    const { data: log } = await b.admin.from('reminder_log').select('days_after_due').eq('invoice_id', inv);
    expect((log ?? []).map((l) => l.days_after_due)).toEqual([30]);

    // [K-022] Idempotence : un 2e passage (le lendemain, ou un double tir du cron) ne renvoie rien.
    const depuis2 = new Date().toISOString();
    await relancer(b.orgA);
    expect((await courrielsVers(adresse, depuis2)).length).toBe(0);
  });

  it('[K-023] négatif : facture PAYÉE ou pas encore échue → aucune relance', async () => {
    const depuis = new Date().toISOString();
    const a1 = `k023a-${Date.now().toString(36)}@lume-qa.test`;
    const a2 = `k023b-${Date.now().toString(36)}@lume-qa.test`;
    await facture(b.orgA, await client(b.orgA, marque('K-023'), a1), { status: 'paid', due_date: jour(-10), paid_cents: 50000, balance_cents: 0 });
    await facture(b.orgA, await client(b.orgA, marque('K-023'), a2), { status: 'sent', due_date: jour(5) });
    await relancer(b.orgA);
    expect((await courrielsVers(a1, depuis)).length + (await courrielsVers(a2, depuis)).length).toBe(0);
  });

  it('[K-024] fournisseur en panne : la relance est journalisée « failed » avec l’erreur, sans planter le passage', async () => {
    const adresse = `k024-${Date.now().toString(36)}@lume-qa.test`;
    const inv = await facture(b.orgA, await client(b.orgA, marque('K-024'), adresse), { status: 'sent', due_date: jour(-2) });
    await mode(b.orgA, 'panne');
    try {
      await relancer(b.orgA);
    } finally {
      await mode(b.orgA, 'succes');
    }
    const { data: log } = await b.admin.from('reminder_log').select('status, error_message').eq('invoice_id', inv);
    expect(log?.length).toBe(1);
    expect(log![0].status).toBe('failed');
    expect(String(log![0].error_message)).toMatch(/panne/i);
  });

  it('[K-025] isolation : un passage limité au bureau A ne relance jamais une facture du bureau B', async () => {
    const depuis = new Date().toISOString();
    const adresse = `k025-${Date.now().toString(36)}@lume-qa.test`;
    await b.admin.from('reminder_settings').upsert({ org_id: b.orgB, enabled: true, schedule: [{ days_after_due: 1, channel: 'email' }] }, { onConflict: 'org_id' });
    nettoyer.push(() => b.admin.from('reminder_settings').delete().eq('org_id', b.orgB));
    const inv = await facture(b.orgB, await client(b.orgB, marque('K-025'), adresse), { status: 'sent', due_date: jour(-5) });
    await relancer(b.orgA);
    expect((await courrielsVers(adresse, depuis)).length).toBe(0);
    const { data: log } = await b.admin.from('reminder_log').select('id').eq('invoice_id', inv);
    expect(log).toEqual([]);
  });
});

/* ═══════════════════════ Factures récurrentes ═══════════════════════ */
describe('K — factures récurrentes', () => {
  async function planif(org: string, clientId: string, champs: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await b.admin.from('recurring_invoice_schedules').insert({
      org_id: org, client_id: clientId, subject: `Entretien ${marque('R')}`, items: [{ description: 'Entretien', qty: 1, unit_price_cents: 20000 }],
      frequency: 'monthly', start_date: jour(-1), next_run_date: jour(0), due_days_offset: 15, auto_send: false, is_active: true, ...champs,
    }).select('id').single();
    if (error) throw new Error(error.message);
    nettoyer.push(() => b.admin.from('recurring_invoice_schedules').delete().eq('id', data.id));
    return data.id as string;
  }
  const factures = async (clientId: string) => {
    const { data } = await b.admin.from('invoices').select('id, status, total_cents, due_date').eq('client_id', clientId);
    for (const f of data ?? []) nettoyer.push(() => b.admin.from('invoices').delete().eq('id', f.id));
    return data ?? [];
  };

  it('[K-030] échéance du jour → UNE facture brouillon aux bons montants, échéance avancée d’un mois', async () => {
    const { runDueSchedules } = await import('../../../server/lib/recurringInvoicesEngine');
    const c = await client(b.orgA, marque('K-030'), 'k030@lume-qa.test');
    const id = await planif(b.orgA, c);
    const r = await runDueSchedules(b.admin, { orgId: b.orgA });
    expect(r.results.find((x) => x.schedule_id === id)?.ok).toBe(true);
    const f = await factures(c);
    expect(f.length).toBe(1);
    expect(f[0].status).toBe('draft');
    expect(f[0].due_date).toBe(jour(15));
    const { data: s } = await b.admin.from('recurring_invoice_schedules').select('next_run_date').eq('id', id).single();
    const attendu = new Date(); attendu.setMonth(attendu.getMonth() + 1);
    expect(s!.next_run_date).toBe(attendu.toISOString().slice(0, 10));
  });

  it('[K-031] double exécution simultanée (deux instances, ou cron + « exécuter maintenant ») → UNE seule facture pour l’échéance', async () => {
    const { runDueSchedules } = await import('../../../server/lib/recurringInvoicesEngine');
    const c = await client(b.orgA, marque('K-031'), 'k031@lume-qa.test');
    await planif(b.orgA, c);
    await Promise.all([runDueSchedules(b.admin, { orgId: b.orgA }), runDueSchedules(b.admin, { orgId: b.orgA })]);
    expect((await factures(c)).length).toBe(1);
  });

  it('[K-032] auto_send → la facture part au client (courriel simulé) et passe « envoyée »', async () => {
    const { runDueSchedules } = await import('../../../server/lib/recurringInvoicesEngine');
    const depuis = new Date().toISOString();
    const adresse = `k032-${Date.now().toString(36)}@lume-qa.test`;
    const c = await client(b.orgA, marque('K-032'), adresse);
    await planif(b.orgA, c, { auto_send: true });
    await runDueSchedules(b.admin, { orgId: b.orgA });
    const f = await factures(c);
    expect(f.map((x) => x.status)).toEqual(['sent']);
    expect((await courrielsVers(adresse, depuis)).length).toBe(1);
  });

  it('[K-033] « exécuter maintenant » (Lumi) refuse une facturation récurrente ARRÊTÉE', async () => {
    const c = await client(b.orgA, marque('K-033'), 'k033@lume-qa.test');
    const id = await planif(b.orgA, c, { is_active: false });
    const { jeton } = await sessionDe(b.admin, COMPTES.proprioA.email);
    const { buildSupabaseWithAuth } = await import('../../../server/lib/supabase');
    const { executerOutilGarde } = await import('../../../server/lib/agent/garde');
    const r = await executerOutilGarde({ name: 'run_recurring_invoice_now', args: { schedule_id: id }, userId: b.users.proprioA, orgId: b.orgA, client: buildSupabaseWithAuth(`Bearer ${jeton}`, b.orgA) });
    expect(JSON.stringify(r)).not.toMatch(/"created":true/);
    expect(await factures(c)).toEqual([]);
  });

  it('[K-034] isolation : un passage limité au bureau A ne génère rien pour le bureau B', async () => {
    const { runDueSchedules } = await import('../../../server/lib/recurringInvoicesEngine');
    const c = await client(b.orgB, marque('K-034'), 'k034@lume-qa.test');
    await planif(b.orgB, c);
    await runDueSchedules(b.admin, { orgId: b.orgA });
    expect(await factures(c)).toEqual([]);
  });
});

/* ═══════════════════════ Jobs récurrents ═══════════════════════ */
describe('K — jobs récurrents', () => {
  let fuseauAvant = 'America/Toronto';
  beforeAll(async () => {
    const { data } = await b.admin.from('company_settings').select('timezone').eq('org_id', b.orgA).single();
    fuseauAvant = (data?.timezone as string) || 'America/Toronto';
  });
  afterAll(async () => { await b.admin.from('company_settings').update({ timezone: fuseauAvant }).eq('org_id', b.orgA); });

  async function jobSource(org: string, m: string) {
    const c = await client(org, m, 'job@lume-qa.test');
    const { data, error } = await b.admin.from('jobs').insert({
      org_id: org, client_id: c, created_by: org === b.orgA ? b.users.proprioA : b.users.proprioB, job_number: `QA-${Date.now().toString(36)}`, title: m, status: 'scheduled',
    }).select('id').single();
    if (error) throw new Error(error.message);
    nettoyer.push(() => b.admin.from('jobs').delete().eq('id', data.id));
    return { job: data.id as string, client: c };
  }
  async function regle(org: string, job: string, champs: Record<string, unknown>) {
    const { data, error } = await b.admin.from('job_recurrence_rules').insert({
      org_id: org, job_id: job, frequency: 'weekly', interval_days: 7, start_date: jour(-7), is_active: true, occurrences_created: 0, ...champs,
    }).select('id').single();
    if (error) throw new Error(error.message);
    nettoyer.push(() => b.admin.from('job_recurrence_rules').delete().eq('id', data.id));
    return data.id as string;
  }
  async function copies(clientId: string, source: string) {
    const { data } = await b.admin.from('jobs').select('id, scheduled_at').eq('client_id', clientId).neq('id', source);
    for (const j of data ?? []) {
      nettoyer.push(() => b.admin.from('schedule_events').delete().eq('job_id', j.id));
      nettoyer.push(() => b.admin.from('jobs').delete().eq('id', j.id));
    }
    return data ?? [];
  }

  it('[K-040] occurrence due → UN job copié + sa visite au calendrier ; la règle avance d’une semaine ; 2e passage : rien de plus', async () => {
    const { processRecurringJobs } = await import('../../../server/lib/recurringJobScheduler');
    const { job, client: c } = await jobSource(b.orgA, marque('K-040'));
    const due = new Date(Date.now() - 3600_000);
    const id = await regle(b.orgA, job, { next_run_at: due.toISOString(), timezone: 'America/Toronto', local_time: null });
    await processRecurringJobs(b.admin, { orgId: b.orgA });
    const j = await copies(c, job);
    expect(j.length).toBe(1);
    const { data: ev } = await b.admin.from('schedule_events').select('start_at').eq('job_id', j[0].id);
    expect(ev?.length).toBe(1);
    const { data: r } = await b.admin.from('job_recurrence_rules').select('next_run_at, occurrences_created').eq('id', id).single();
    expect(r!.occurrences_created).toBe(1);
    expect(new Date(r!.next_run_at as string).getTime()).toBeGreaterThan(Date.now());
    await processRecurringJobs(b.admin, { orgId: b.orgA });
    expect((await copies(c, job)).length).toBe(1);
  });

  it('[K-041] une série sans fuseau hérite de CELUI DE L’ENTREPRISE : 9 h reste 9 h à Vancouver', async () => {
    const { processRecurringJobs } = await import('../../../server/lib/recurringJobScheduler');
    await b.admin.from('company_settings').update({ timezone: 'America/Vancouver' }).eq('org_id', b.orgA);
    const { job } = await jobSource(b.orgA, marque('K-041'));
    const id = await regle(b.orgA, job, { next_run_at: new Date(Date.now() - 3600_000).toISOString(), timezone: null, local_time: '09:00' });
    await processRecurringJobs(b.admin, { orgId: b.orgA });
    const { data: r } = await b.admin.from('job_recurrence_rules').select('next_run_at').eq('id', id).single();
    const heureLocale = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(r!.next_run_at as string));
    expect(heureLocale).toBe('09:00');
  });

  const heureA = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  const jourA = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  async function fuseauBureau(tz: string) {
    const { error } = await b.admin.from('company_settings').update({ timezone: tz }).eq('org_id', b.orgA);
    if (error) throw new Error(`fuseau du bureau : ${error.message}`);
    (await import('../../../server/lib/automations-fuseau-org')).viderCacheFuseau();
  }
  /** L'heure de la job d'origine — une écriture ratée (staging lent) doit se voir, pas fausser l'attente. */
  async function planifierJob(job: string, instant: string) {
    const { error } = await b.admin.from('jobs').update({ scheduled_at: instant }).eq('id', job);
    if (error) throw new Error(`heure de la job d'origine : ${error.message}`);
  }
  async function recurrenceParLumi(job: string, debut: string) {
    const { jeton } = await sessionDe(b.admin, COMPTES.proprioA.email);
    const { buildSupabaseWithAuth } = await import('../../../server/lib/supabase');
    const { executerOutilGarde } = await import('../../../server/lib/agent/garde');
    const r = await executerOutilGarde({ name: 'create_recurrence_rule', args: { job_id: job, frequency: 'weekly', start_date: debut }, userId: b.users.proprioA, orgId: b.orgA, client: buildSupabaseWithAuth(`Bearer ${jeton}`, b.orgA) });
    const regleId = (r as { result?: { rule_id?: string } }).result?.rule_id;
    if (regleId) nettoyer.push(() => b.admin.from('job_recurrence_rules').delete().eq('id', regleId));
    const { data } = await b.admin.from('job_recurrence_rules').select('next_run_at, local_time, timezone').eq('id', regleId ?? '').single();
    return data!;
  }

  it('[K-042] une récurrence créée par Lumi place ses visites à une heure de jour : celle de la job d’origine (14 h 30 à Toronto), plus ~1 h du matin', async () => {
    await fuseauBureau('America/Toronto');
    const { job } = await jobSource(b.orgA, marque('K-042'));
    // 18:30Z le 15 octobre 2026 = 14 h 30 à Toronto (heure avancée).
    await planifierJob(job, '2026-10-15T18:30:00Z');
    const regle = await recurrenceParLumi(job, jour(3));
    const h = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: '2-digit', hour12: false }).format(new Date(regle.next_run_at as string)));
    expect(h).toBeGreaterThanOrEqual(7);
    expect(heureA(regle.next_run_at as string, 'America/Toronto')).toBe('14:30');
    expect(jourA(regle.next_run_at as string, 'America/Toronto')).toBe(jour(3));
    expect(regle.local_time).toBe('14:30:00');
    // Le fuseau n'est plus « America/Montreal » en dur : la série hérite de celui de l'entreprise.
    expect(regle.timezone).toBeNull();
  }, 180_000);

  it('[K-042] sans heure connue (job jamais planifiée), la série prend 9 h LOCALE — à Vancouver aussi', async () => {
    await fuseauBureau('America/Vancouver');
    const { job } = await jobSource(b.orgA, marque('K-042b'));
    const regle = await recurrenceParLumi(job, jour(3));
    expect(heureA(regle.next_run_at as string, 'America/Vancouver')).toBe('09:00');
    expect(jourA(regle.next_run_at as string, 'America/Vancouver')).toBe(jour(3));
    expect(regle.local_time).toBe('09:00:00');
  }, 180_000);

  it('[K-044] série SANS heure (créée par l’app, ou par Lumi avant le correctif) : la visite copiée prend l’heure de la job d’origine, pas l’instant du passage', async () => {
    const { processRecurringJobs } = await import('../../../server/lib/recurringJobScheduler');
    const { fuseauEnJournee } = await import('../harnais/moteur');
    const tz = fuseauEnJournee(); // il est entre 10 h et 16 h dans ce fuseau
    await fuseauBureau(tz);
    const { job, client: c } = await jobSource(b.orgA, marque('K-044'));
    // La job d'origine est à 23 h 15 locale : ce soir, donc pas encore passée.
    const { instantLocal, jourLocal } = await import('../../../server/lib/dates-locales');
    await planifierJob(job, instantLocal(jourLocal(tz, new Date(), -7), '23:15', tz));
    const id = await regle(b.orgA, job, { next_run_at: new Date(Date.now() - 3600_000).toISOString(), timezone: null, local_time: null });
    await processRecurringJobs(b.admin, { orgId: b.orgA });
    const j = await copies(c, job);
    expect(j.length).toBe(1);
    expect(heureA(j[0].scheduled_at as string, tz)).toBe('23:15');
    expect(jourA(j[0].scheduled_at as string, tz)).toBe(jourLocal(tz, new Date()));
    const { data: ev } = await b.admin.from('schedule_events').select('start_at').eq('job_id', j[0].id);
    expect(ev?.map((e) => heureA(e.start_at as string, tz))).toEqual(['23:15']);
    const { data: r } = await b.admin.from('job_recurrence_rules').select('next_run_at, local_time').eq('id', id).single();
    expect(r!.local_time).toBe('23:15:00');
    expect(heureA(r!.next_run_at as string, tz)).toBe('23:15');
    expect(jourA(r!.next_run_at as string, tz)).toBe(jourLocal(tz, new Date(), 7));
  }, 180_000);

  it('[K-045] série sans heure dont l’heure est DÉJÀ passée aujourd’hui : jamais de visite dans le passé — cette occurrence garde son instant, les suivantes prennent l’heure de la série', async () => {
    const { processRecurringJobs } = await import('../../../server/lib/recurringJobScheduler');
    const { fuseauEnJournee } = await import('../harnais/moteur');
    const tz = fuseauEnJournee();
    await fuseauBureau(tz);
    const { job, client: c } = await jobSource(b.orgA, marque('K-045'));
    const { instantLocal, jourLocal } = await import('../../../server/lib/dates-locales');
    // 6 h 10 locale : déjà passée (il est au moins 10 h).
    await planifierJob(job, instantLocal(jourLocal(tz, new Date(), -7), '06:10', tz));
    const du = new Date(Date.now() - 600_000).toISOString();
    const id = await regle(b.orgA, job, { next_run_at: du, timezone: null, local_time: null });
    await processRecurringJobs(b.admin, { orgId: b.orgA });
    const j = await copies(c, job);
    expect(j.length).toBe(1);
    expect(new Date(j[0].scheduled_at as string).toISOString()).toBe(du);
    const { data: r } = await b.admin.from('job_recurrence_rules').select('next_run_at, local_time').eq('id', id).single();
    expect(r!.local_time).toBe('06:10:00');
    expect(heureA(r!.next_run_at as string, tz)).toBe('06:10');
    expect(jourA(r!.next_run_at as string, tz)).toBe(jourLocal(tz, new Date(du), 7));
  }, 180_000);

  it('[K-043] isolation : un passage limité au bureau A ne copie aucun job du bureau B', async () => {
    const { processRecurringJobs } = await import('../../../server/lib/recurringJobScheduler');
    const { job, client: c } = await jobSource(b.orgB, marque('K-043'));
    await regle(b.orgB, job, { next_run_at: new Date(Date.now() - 3600_000).toISOString(), timezone: 'America/Toronto' });
    await processRecurringJobs(b.admin, { orgId: b.orgA });
    expect(await copies(c, job)).toEqual([]);
  });
});

/* ═══════════════════════ Rapports planifiés ═══════════════════════ */
describe('K — rapports planifiés', () => {
  async function rapport(org: string, champs: Record<string, unknown>) {
    const { data, error } = await b.admin.from('scheduled_reports').insert({
      org_id: org, created_by: org === b.orgA ? b.users.proprioA : b.users.proprioB, frequency: 'daily', enabled: true, ...champs,
    }).select('id').single();
    if (error) throw new Error(error.message);
    nettoyer.push(() => b.admin.from('scheduled_reports').delete().eq('id', data.id));
    return data.id as string;
  }

  it('[K-050] rapport quotidien dû → UN courriel au destinataire ; 2e passage : rien (last_sent_at)', async () => {
    const { processScheduledReports } = await import('../../../server/lib/scheduled-reports');
    const depuis = new Date().toISOString();
    const adresse = `k050-${Date.now().toString(36)}@lume-qa.test`;
    const id = await rapport(b.orgA, { recipient_email: adresse });
    await processScheduledReports({ orgId: b.orgA });
    const envois = await courrielsVers(adresse, depuis);
    expect(envois.length).toBe(1);
    expect(String(envois[0].sujet)).toMatch(/rapport/i);
    const { data } = await b.admin.from('scheduled_reports').select('last_sent_at').eq('id', id).single();
    expect(data!.last_sent_at).not.toBeNull();
    await processScheduledReports({ orgId: b.orgA });
    expect((await courrielsVers(adresse, depuis)).length).toBe(1);
  });

  it('[K-051] le rapport d’une entreprise en bac à sable est consigné AU NOM de l’entreprise (journal des envois, bac à sable), même vers une adresse ordinaire', async () => {
    const { processScheduledReports } = await import('../../../server/lib/scheduled-reports');
    const depuis = new Date().toISOString();
    const adresse = `k051-${Date.now().toString(36)}@qa.invalid`;
    await rapport(b.orgA, { recipient_email: adresse });
    await processScheduledReports({ orgId: b.orgA });
    const envois = await courrielsVers(adresse, depuis);
    expect(envois.length).toBe(1);
    // Sans `suivi`, le courriel n'était rattaché à aucune entreprise : seul le
    // domaine .invalid le retenait — vers une vraie adresse, le bac à sable de
    // l'entreprise ne s'appliquait pas.
    expect((envois[0].meta as { raison?: string }).raison).toBe('entreprise');
  });

  it('[K-053] fournisseur en panne : le rapport n’est pas perdu (non marqué envoyé, ou en file de reprise)', async () => {
    const { processScheduledReports } = await import('../../../server/lib/scheduled-reports');
    const depuis = new Date().toISOString();
    const id = await rapport(b.orgA, { recipient_email: `k053-${Date.now().toString(36)}@qa.invalid` });
    await mode(b.orgA, 'panne');
    try {
      await processScheduledReports({ orgId: b.orgA });
    } finally {
      await mode(b.orgA, 'succes');
    }
    const { data } = await b.admin.from('scheduled_reports').select('last_sent_at').eq('id', id).single();
    const { data: file } = await b.admin.from(TABLE_REPRISES).select('id').eq('org_id', b.orgA).gte('created_at', depuis);
    for (const f of file ?? []) nettoyer.push(() => b.admin.from(TABLE_REPRISES).delete().eq('id', f.id));
    expect(data!.last_sent_at === null || (file ?? []).length > 0).toBe(true);
    await b.admin.from('scheduled_reports').update({ enabled: false }).eq('id', id);
  });

  it('[K-052] isolation : un passage limité au bureau A n’envoie pas le rapport du bureau B', async () => {
    const { processScheduledReports } = await import('../../../server/lib/scheduled-reports');
    const depuis = new Date().toISOString();
    const adresse = `k052-${Date.now().toString(36)}@lume-qa.test`;
    await rapport(b.orgB, { recipient_email: adresse });
    await processScheduledReports({ orgId: b.orgA });
    expect((await courrielsVers(adresse, depuis)).length).toBe(0);
  });
});

/* ═══════════════════════ Relances d'abonnement (dunning) ═══════════════════════ */
describe('K — relances d’abonnement Lume (dunning)', () => {
  async function impaye(joursDepuis: number): Promise<string> {
    const { data: plan } = await b.admin.from('plans').select('id').eq('slug', 'autopilot').single();
    const { data, error } = await b.admin.from('subscriptions').insert({
      org_id: b.orgB, user_id: b.users.proprioB, plan_id: plan!.id, status: 'past_due', interval: 'monthly', currency: 'CAD', amount_cents: 0,
      past_due_since: new Date(Date.now() - joursDepuis * 86400_000).toISOString(),
      current_period_end: new Date(Date.now() + 30 * 86400_000).toISOString(),
    }).select('id').single();
    if (error) throw new Error(error.message);
    nettoyer.push(() => b.admin.from('subscriptions').delete().eq('id', data.id));
    return data.id as string;
  }
  const courrielB = 'bureau-b@lume-qa.test';

  it('[K-060] impayé depuis 8 jours → abonnement suspendu (canceled) + UN courriel de suspension ; 2e passage : rien de plus', async () => {
    const { runDunningScan } = await import('../../../server/lib/dunning-engine');
    const depuis = new Date().toISOString();
    const id = await impaye(8);
    await runDunningScan(b.admin, { orgId: b.orgB });
    const { data } = await b.admin.from('subscriptions').select('status, canceled_at').eq('id', id).single();
    expect(data!.status).toBe('canceled');
    expect((await courrielsVers(courrielB, depuis)).length).toBe(1);
    await runDunningScan(b.admin, { orgId: b.orgB });
    expect((await courrielsVers(courrielB, depuis)).length).toBe(1);
  });

  it('[K-061] J+3 à J+6 : UNE relance pour l’épisode d’impayé (pas un courriel par jour) ; un NOUVEL épisode a droit à la sienne', async () => {
    const { runDunningScan } = await import('../../../server/lib/dunning-engine');
    const depuis = new Date().toISOString();
    const id = await impaye(3);
    const debut = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (let j = 0; j < 4; j++) {
        vi.setSystemTime(debut + j * 86400_000);
        await runDunningScan(b.admin, { orgId: b.orgB });
      }
    } finally {
      vi.useRealTimers();
    }
    const relances = await courrielsVers(courrielB, depuis);
    expect(relances.length).toBe(1);
    // La relance ANNONCE la suspension (« sera suspendu dans 4 jours ») ; ce n'est pas le courriel de suspension.
    expect(String(relances[0].sujet)).toMatch(/sera suspendu dans 4 jours/);
    // L'abonnement n'a pas été touché : la relance n'est pas une suspension.
    const { data: sub } = await b.admin.from('subscriptions').select('status').eq('id', id).single();
    expect(sub!.status).toBe('past_due');

    // Un autre épisode (payé, puis de nouveau en échec quatre jours plus tôt) : sa relance part.
    const { error } = await b.admin.from('subscriptions').update({ past_due_since: new Date(Date.now() - 4 * 86400_000).toISOString() }).eq('id', id);
    expect(error).toBeNull();
    await runDunningScan(b.admin, { orgId: b.orgB });
    await runDunningScan(b.admin, { orgId: b.orgB });
    expect((await courrielsVers(courrielB, depuis)).length).toBe(2);
  }, 180_000);

  it('[K-062] isolation : un passage limité au bureau A ne suspend pas l’abonnement impayé du bureau B', async () => {
    const { runDunningScan } = await import('../../../server/lib/dunning-engine');
    const id = await impaye(9);
    await runDunningScan(b.admin, { orgId: b.orgA });
    const { data } = await b.admin.from('subscriptions').select('status').eq('id', id).single();
    expect(data!.status).toBe('past_due');
  });
});
