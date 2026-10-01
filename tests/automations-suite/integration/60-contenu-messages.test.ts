/**
 * Contenu des messages d'automatisation — ce que le CLIENT lit vraiment.
 *
 *  · [H-020] les dates (échéance de facture, validité de devis, rendez-vous)
 *    partent en toutes lettres, dans la langue de l'entreprise, sans décalage
 *    de fuseau pour une date seule ;
 *  · [H-022] [A-247] la demande d'avis d'un client sans prénom dit
 *    « Bonjour, » — pas « Bonjour Bonjour, » — et son texte n'est résolu
 *    qu'UNE fois (une valeur entre crochets n'est pas reprise pour une variable).
 *
 * Vrai moteur contre staging, bureaux de test en bac à sable : on lit
 * `envois_simules` (ce qui SERAIT parti), jamais un fournisseur.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { demarrerMoteur, marque, envoisSimules, attendre, journalDefinitif, fuseauEnJournee } from '../harnais/moteur';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
const m = marque('CONTENU');
const nettoyer: Array<() => PromiseLike<unknown>> = [];
const reglesDuTest: string[] = [];
let n = 0;

async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, quoi: string): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error || data === null || data === undefined) throw new Error(`${quoi} : ${error?.message ?? 'aucune donnée'}`);
  return data as NonNullable<T>;
}

const proprio = (org: string) => (org === b.orgA ? b.users.proprioA : b.users.proprioB);

async function unClient(org: string, champs: Record<string, unknown> = {}) {
  n += 1;
  const tel = `+1555555${String(100 + ((Math.floor(Date.now() / 1000) + n * 13) % 100)).padStart(4, '0')}`;
  const c = await ok(b.admin.from('clients').insert({
    org_id: org, created_by: proprio(org), first_name: 'Camille', last_name: m, status: 'active',
    email: `contenu-${Date.now().toString(36)}-${n}@lume-qa.test`, phone: tel,
    email_consent_at: new Date().toISOString(), sms_consent_at: new Date().toISOString(),
    ...champs,
  }).select('id, email, phone').single(), 'client');
  await b.admin.from('messages').delete().eq('org_id', org).eq('phone_number', c.phone);
  nettoyer.push(() => b.admin.from('clients').delete().eq('id', c.id));
  nettoyer.push(() => b.admin.from('messages').delete().eq('org_id', org).eq('phone_number', c.phone));
  return c as { id: string; email: string; phone: string };
}

async function uneFacture(org: string, clientId: string, echeance: string) {
  const f = await ok(b.admin.from('invoices').insert({
    org_id: org, client_id: clientId, created_by: proprio(org),
    invoice_number: `QA-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    subtotal_cents: 50000, tax_cents: 0, total_cents: 50000, paid_cents: 0, balance_cents: 50000,
    issued_at: new Date().toISOString(), due_date: echeance,
  }).select('id').single(), 'facture');
  nettoyer.push(() => b.admin.from('invoices').delete().eq('id', f.id));
  return f.id as string;
}

async function unDevis(org: string, clientId: string, validite: string | null) {
  const q = await ok(b.admin.from('quotes').insert({
    org_id: org, client_id: clientId, status: 'awaiting_response', title: `Devis ${m}`,
    quote_number: `QA-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, created_by: proprio(org),
    valid_until: validite,
  }).select('id').single(), 'devis');
  nettoyer.push(() => b.admin.from('quotes').delete().eq('id', q.id));
  return q.id as string;
}

async function uneRegle(org: string, corps: Record<string, unknown>) {
  n += 1;
  const r = await ok(b.admin.from('automation_rules').insert({
    org_id: org, name: `${m} ${n}`, trigger_event: 'client.tagged', conditions: {}, delay_seconds: 0,
    is_active: true, is_preset: false, settings: { fenetre: { debut: 0, fin: 24 } }, ...corps,
  }).select('id').single(), 'règle');
  reglesDuTest.push(r.id);
  nettoyer.push(() => b.admin.from('automation_rules').delete().eq('id', r.id));
  return r.id as string;
}

async function journaux(regle: string) {
  const { data } = await b.admin.from('automation_execution_logs')
    .select('action_type, result_success, result_data, result_error').eq('automation_rule_id', regle);
  return data ?? [];
}

async function declencher(org: string, regle: string, entite: { type: string; id: string }, nb = 1, evenement = 'client.tagged') {
  const depuis = new Date().toISOString();
  await b.eventBus.emit(evenement as never, { orgId: org, entityType: entite.type, entityId: entite.id, metadata: { tag: 'qa-contenu' } });
  const logs = await attendre(() => journaux(regle), (l) => l.length >= nb && l.every((x) => journalDefinitif(x.result_error)), 30_000);
  return { logs, envois: await envoisSimules(b.admin, org, depuis) };
}

async function reglages(org: string, champs: Record<string, unknown>) {
  await ok(b.admin.from('company_settings').update(champs).eq('org_id', org).select('org_id'), 'réglages');
  const { oublierLanguesOrg } = await import('../../../server/lib/automationEngine');
  const { viderCacheFuseau } = await import('../../../server/lib/automations-fuseau-org');
  oublierLanguesOrg();
  viderCacheFuseau();
}

let avantA: Record<string, unknown> | null = null;
let avantB: Record<string, unknown> | null = null;
const COLONNES = 'default_language, timezone, review_enabled, google_review_url, facebook_review_url, review_sms_body, review_email_subject, review_email_body';

beforeAll(async () => {
  b = await demarrerMoteur();
  avantA = await ok(b.admin.from('company_settings').select(COLONNES).eq('org_id', b.orgA).single(), 'réglages A') as Record<string, unknown>;
  avantB = await ok(b.admin.from('company_settings').select(COLONNES).eq('org_id', b.orgB).single(), 'réglages B') as Record<string, unknown>;
}, 120_000);
afterEach(async () => {
  if (reglesDuTest.length) await b.admin.from('automation_rules').update({ is_active: false }).in('id', reglesDuTest.splice(0));
});
afterAll(async () => {
  // Le fuseau « en journée » du harnais est recalculé : un test a pu le changer.
  if (avantA) await reglages(b.orgA, { ...avantA, timezone: fuseauEnJournee() });
  if (avantB) await reglages(b.orgB, { ...avantB, timezone: fuseauEnJournee() });
  for (const f of nettoyer.reverse()) await f();
});

describe('H — dates écrites au client', () => {
  it('[H-020] échéance de facture et validité de devis : « 15 octobre 2026 » en français, « October 15, 2026 » en anglais — jamais AAAA-MM-JJ', async () => {
    const { resolveEntityVariables } = await import('../../../server/lib/actions');
    const client = await unClient(b.orgB);
    const facture = await uneFacture(b.orgB, client.id, '2026-10-15');
    const devis = await unDevis(b.orgB, client.id, '2026-11-01');

    await reglages(b.orgB, { default_language: 'fr', timezone: 'America/Toronto' });
    const frF = await resolveEntityVariables(b.admin, b.orgB, 'invoice', facture);
    const frD = await resolveEntityVariables(b.admin, b.orgB, 'quote', devis);
    expect(frF.invoice_due_date).toBe('15 octobre 2026');
    expect(frD.quote_valid_until).toBe('1 novembre 2026');

    await reglages(b.orgB, { default_language: 'en' });
    const enF = await resolveEntityVariables(b.admin, b.orgB, 'invoice', facture);
    const enD = await resolveEntityVariables(b.admin, b.orgB, 'quote', devis);
    expect(enF.invoice_due_date).toBe('October 15, 2026');
    expect(enD.quote_valid_until).toBe('November 1, 2026');
  });

  it('[H-020] une date seule ne change pas de jour avec le fuseau de l’entreprise (Honolulu, Auckland) ; sans date, la variable reste vide', async () => {
    const { resolveEntityVariables } = await import('../../../server/lib/actions');
    const client = await unClient(b.orgB);
    const facture = await uneFacture(b.orgB, client.id, '2026-03-01');
    const devisSansDate = await unDevis(b.orgB, client.id, null);
    for (const fuseau of ['Pacific/Honolulu', 'Pacific/Auckland', 'America/Toronto']) {
      await reglages(b.orgB, { default_language: 'fr', timezone: fuseau });
      const v = await resolveEntityVariables(b.admin, b.orgB, 'invoice', facture);
      expect(v.invoice_due_date, fuseau).toBe('1 mars 2026');
    }
    const d = await resolveEntityVariables(b.admin, b.orgB, 'quote', devisSansDate);
    expect(d.quote_valid_until).toBe('');
  });

  it('[H-020] le texto et le courriel envoyés portent la date lisible ; le webhook, lui, garde AAAA-MM-JJ sous le même nom', async () => {
    await reglages(b.orgA, { default_language: 'fr' });
    const client = await unClient(b.orgA);
    const facture = await uneFacture(b.orgA, client.id, '2026-10-15');
    const regle = await uneRegle(b.orgA, { actions: [
      { type: 'send_sms', config: { body: `${m} due le [invoice_due_date]`, type_envoi: 'transactionnel' } },
      { type: 'send_email', config: { subject: `${m} échéance {invoice_due_date}`, body: '<p>Due le [invoice_due_date]</p>', type_envoi: 'transactionnel' } },
    ] });
    const { logs, envois } = await declencher(b.orgA, regle, { type: 'invoice', id: facture }, 2);
    const texto = envois.find((e) => e.destinataire === client.phone);
    const courriel = envois.find((e) => e.destinataire === client.email);
    expect(texto?.corps, JSON.stringify(logs)).toBe(`${m} due le 15 octobre 2026`);
    expect(courriel?.sujet, JSON.stringify(logs)).toBe(`${m} échéance 15 octobre 2026`);
    expect(String(courriel?.corps)).toContain('Due le 15 octobre 2026');
    expect(String(courriel?.corps)).not.toContain('2026-10-15');

    const { resolveEntityVariables, variablesPourMachine } = await import('../../../server/lib/actions');
    const machine = variablesPourMachine(await resolveEntityVariables(b.admin, b.orgA, 'invoice', facture));
    expect(machine.invoice_due_date).toBe('2026-10-15');
    expect(Object.keys(machine).filter((k) => k.endsWith('_iso'))).toEqual([]);
  });
});

describe('H — demande d’avis : salutation et résolution unique', () => {
  async function unJob(org: string, clientId: string, titre: string) {
    const job = await ok(b.admin.from('jobs').insert({
      org_id: org, created_by: proprio(org), client_id: clientId, title: titre, status: 'completed',
      job_number: `C-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    }).select('id').single(), 'job');
    nettoyer.push(() => b.admin.from('jobs').delete().eq('id', job.id));
    nettoyer.push(() => b.admin.from('review_requests').delete().eq('job_id', job.id));
    nettoyer.push(() => b.admin.from('satisfaction_surveys').delete().eq('job_id', job.id));
    return job.id as string;
  }
  const AVIS = { review_enabled: true, google_review_url: 'https://g.page/r/qa-contenu/review', review_sms_body: null, review_email_subject: null, review_email_body: null };
  async function demanderAvis(org: string, jobId: string) {
    const regle = await uneRegle(org, { trigger_event: 'task.completed', actions: [{ type: 'request_review', config: {} }] });
    return declencher(org, regle, { type: 'job', id: jobId }, 1, 'task.completed');
  }

  it('[H-022] client SANS prénom ni nom, entreprise française : « Bonjour, merci… » — jamais « Bonjour Bonjour, »', async () => {
    await reglages(b.orgA, { ...AVIS, default_language: 'fr' });
    const client = await unClient(b.orgA, { first_name: null, last_name: null, company: null });
    const { logs, envois } = await demanderAvis(b.orgA, await unJob(b.orgA, client.id, `Vitres ${m}`));
    const texto = envois.find((e) => e.destinataire === client.phone);
    const courriel = envois.find((e) => e.destinataire === client.email);
    expect(texto, JSON.stringify(logs)).toBeTruthy();
    expect(courriel, JSON.stringify(logs)).toBeTruthy();
    expect(String(texto!.corps)).toMatch(/^Bonjour, merci d'avoir choisi Nettoyage Test A !/);
    expect(String(texto!.corps)).not.toMatch(/Bonjour\s+Bonjour|Bonjour ,/);
    expect(String(courriel!.corps)).toContain('>Bonjour,</p>');
    expect(String(courriel!.corps)).not.toMatch(/Bonjour\s+Bonjour|Bonjour ,/);
  });

  it('[H-022] client SANS prénom, entreprise anglaise : « Hi there, thanks… »', async () => {
    await reglages(b.orgB, { ...AVIS, default_language: 'en' });
    const client = await unClient(b.orgB, { first_name: null, last_name: null, company: null });
    const { logs, envois } = await demanderAvis(b.orgB, await unJob(b.orgB, client.id, `Windows ${m}`));
    const texto = envois.find((e) => e.destinataire === client.phone);
    const courriel = envois.find((e) => e.destinataire === client.email);
    expect(String(texto?.corps), JSON.stringify(logs)).toMatch(/^Hi there, thanks for choosing Nettoyage Test B!/);
    expect(String(courriel?.corps)).toContain('>Hi there,</p>');
    expect(String(courriel?.corps)).not.toMatch(/Bonjour/);
  });

  it('[A-247] le texte n’est résolu qu’UNE fois : crochets et accolades d’un prénom ou d’un titre de job arrivent intacts', async () => {
    await reglages(b.orgA, { ...AVIS, default_language: 'fr' });
    const client = await unClient(b.orgA, { first_name: 'Zoé [VIP]', last_name: m });
    const titre = `Lavage [vitres] {sud} ${m}`;
    const { logs, envois } = await demanderAvis(b.orgA, await unJob(b.orgA, client.id, titre));
    const texto = envois.find((e) => e.destinataire === client.phone);
    const courriel = envois.find((e) => e.destinataire === client.email);
    expect(String(texto?.corps), JSON.stringify(logs)).toMatch(/^Bonjour Zoé \[VIP\], merci d'avoir choisi Nettoyage Test A !/);
    expect(String(courriel?.corps), JSON.stringify(logs)).toContain('Bonjour Zoé [VIP],');
    expect(String(courriel?.corps)).toContain(`Nous venons de terminer ${titre} `);
  });
});
