/**
 * G — Conformité LCAP / Loi 25 des automatisations, et marque des courriels.
 *
 *  · désabonnement courriel et STOP texto respectés par les automatisations,
 *    commerciales ET transactionnelles, drapeau `auto_desabonnement_canal`
 *    éteint (défaut) comme allumé ;
 *  · lien de désabonnement + en-têtes List-Unsubscribe dans CHAQUE courriel
 *    commercial automatisé (immédiat ou différé) ;
 *  · marque : seulement la couleur, le logo et le texte de l'entreprise ;
 *    aucune trace de Lume (exigence de Rafba) — les écarts qui relèvent d'une
 *    décision sont en ROUGE ATTENDU.
 *
 * Tout passe par le vrai moteur ; les envois sont lus dans `envois_simules`.
 */
// Expéditeur de la plateforme tel qu'en production (réglage de TEST fixé ici,
// avant le chargement de server/lib/config.ts par le moteur).
process.env.EMAIL_FROM = 'Lume CRM <noreply@lumecrm.net>';

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { demarrerMoteur, marque, envoisSimules, attendre } from '../harnais/moteur';
import { journalDefinitif } from '../harnais/moteur';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
const m = marque('G');
const nettoyer: Array<() => PromiseLike<unknown>> = [];
const reglesDuTest: string[] = [];
const TOUTE_LA_JOURNEE = { fenetre: { debut: 0, fin: 24 } };
let n = 0;
let reglagesAvant: Record<string, unknown> | null = null;

async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, quoi: string): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error || data === null || data === undefined) throw new Error(`${quoi} : ${error?.message ?? 'aucune donnée'}`);
  return data as NonNullable<T>;
}

async function unClient(extra: Record<string, unknown> = {}) {
  n += 1;
  const tel = `+1555555${String(100 + ((Math.floor(Date.now() / 1000) + n * 13) % 100)).padStart(4, '0')}`;
  const c = await ok(b.admin.from('clients').insert({
    org_id: b.orgA, created_by: b.users.proprioA, first_name: 'Gaston', last_name: m, status: 'active',
    email: `g-${Date.now().toString(36)}-${n}@lume-qa.test`, phone: tel,
    email_consent_at: new Date().toISOString(), sms_consent_at: new Date().toISOString(), ...extra,
  }).select('id, email, phone').single(), 'client');
  await b.admin.from('messages').delete().eq('org_id', b.orgA).eq('phone_number', c.phone);
  await b.admin.from('sms_opt_outs').delete().eq('org_id', b.orgA).eq('phone', c.phone);
  nettoyer.push(() => b.admin.from('clients').delete().eq('id', c.id));
  nettoyer.push(() => b.admin.from('email_unsubscribes').delete().eq('org_id', b.orgA).eq('email', c.email));
  nettoyer.push(() => b.admin.from('sms_opt_outs').delete().eq('org_id', b.orgA).eq('phone', c.phone));
  nettoyer.push(() => b.admin.from('messages').delete().eq('org_id', b.orgA).eq('phone_number', c.phone));
  return c as { id: string; email: string; phone: string };
}

async function uneRegle(corps: Record<string, unknown>) {
  n += 1;
  const r = await ok(b.admin.from('automation_rules').insert({
    org_id: b.orgA, name: `${m} ${n}`, trigger_event: 'client.tagged', conditions: {}, delay_seconds: 0,
    is_active: true, is_preset: false, settings: TOUTE_LA_JOURNEE, ...corps,
  }).select('id').single(), 'règle');
  reglesDuTest.push(r.id);
  nettoyer.push(() => b.admin.from('automation_rules').delete().eq('id', r.id));
  nettoyer.push(() => b.admin.from('automation_scheduled_tasks').delete().eq('automation_rule_id', r.id));
  return r.id as string;
}

async function journaux(regle: string) {
  const { data } = await b.admin.from('automation_execution_logs')
    .select('action_type, result_success, result_data, result_error, created_at').eq('automation_rule_id', regle).order('created_at');
  return data ?? [];
}
const termine = (l: Array<{ result_error: string | null }>, nb = 1) => l.length >= nb && l.every((x) => journalDefinitif(x.result_error));

async function drapeauParCanal(actif: boolean) {
  await ok(b.admin.from('org_features').upsert({ org_id: b.orgA, feature: 'auto_desabonnement_canal', enabled: actif }, { onConflict: 'org_id,feature' }).select('id'), 'drapeau');
  const { oublierDrapeaux } = await import('../../../server/lib/automations-drapeaux');
  oublierDrapeaux(b.orgA);
}

/** Déclenche la règle (événement sans préréglage) et rend journal + envois vers ce client. */
async function declencher(regle: string, client: { id: string; email: string; phone: string }, nb = 1) {
  const depuis = new Date().toISOString();
  await b.eventBus.emit('client.tagged', { orgId: b.orgA, entityType: 'client', entityId: client.id, metadata: { tag: 'qa-secu' } });
  const logs = await attendre(() => journaux(regle), (l) => termine(l, nb), 30_000);
  const envois = (await envoisSimules(b.admin, b.orgA, depuis)).filter((e) => e.destinataire === client.email || e.destinataire === client.phone);
  return { logs, envois };
}

const courriel = (sujet: string, type_envoi: string) => ({ type: 'send_email', config: { subject: `${sujet} ${m}`, body: '<p>Bonjour {client_first_name}, une offre pour vous.</p>', type_envoi } });
const texto = (corps: string, type_envoi: string) => ({ type: 'send_sms', config: { body: `${corps} ${m}`, type_envoi } });

beforeAll(async () => {
  b = await demarrerMoteur();
  reglagesAvant = await ok(b.admin.from('company_settings').select('brand_color, logo_url, review_enabled, google_review_url').eq('org_id', b.orgA).single(), 'réglages');
  await drapeauParCanal(false);
}, 120_000);
afterEach(async () => {
  if (reglesDuTest.length) await b.admin.from('automation_rules').update({ is_active: false }).in('id', reglesDuTest.splice(0));
});
afterAll(async () => {
  await drapeauParCanal(false);
  if (reglagesAvant) await b.admin.from('company_settings').update(reglagesAvant).eq('org_id', b.orgA);
  await b.admin.from('email_unsubscribes').delete().eq('org_id', b.orgA).ilike('email', 'g-%@lume-qa.test');
  for (const f of nettoyer.reverse()) await f();
});

function lienDesabonnement(envoi: { corps: string | null; meta: unknown }) {
  const corps = String(envoi.corps ?? '');
  const entetes = ((envoi.meta as { headers?: Record<string, string> }).headers) ?? {};
  return {
    lien: /href="[^"]*\/api\/unsubscribe\/[0-9a-f]{16,}"/.test(corps),
    listUnsubscribe: /^<https?:\/\/[^>]+\/api\/unsubscribe\/[0-9a-f]{16,}>$/.test(entetes['List-Unsubscribe'] ?? ''),
    unClic: entetes['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click',
  };
}

describe('G — lien de désabonnement dans chaque courriel commercial automatisé', () => {
  it('[G-001] drapeau éteint, courriel commercial DIFFÉRÉ : lien + List-Unsubscribe (un clic)', async () => {
    const client = await unClient();
    const regle = await uneRegle({ delay_seconds: 3600, actions: [courriel('Différé', 'marketing')] });
    await b.eventBus.emit('client.tagged', { orgId: b.orgA, entityType: 'client', entityId: client.id, metadata: { tag: 'qa-secu' } });
    await attendre(async () => (await b.admin.from('automation_scheduled_tasks').select('id').eq('automation_rule_id', regle)).data ?? [], (t) => t.length >= 1, 30_000);
    await b.admin.from('automation_scheduled_tasks').update({ execute_at: new Date(Date.now() - 1000).toISOString() }).eq('automation_rule_id', regle);
    const depuis = new Date(Date.now() - 1000).toISOString();
    const { traiterFile } = await import('../harnais/moteur');
    await traiterFile(b.admin, b.orgA);
    const [envoi] = (await envoisSimules(b.admin, b.orgA, depuis)).filter((e) => e.destinataire === client.email);
    expect(envoi, JSON.stringify(await journaux(regle))).toBeTruthy();
    expect(lienDesabonnement(envoi)).toEqual({ lien: true, listUnsubscribe: true, unClic: true });
  });

  it('[G-002] drapeau éteint, courriel commercial IMMÉDIAT : lien + List-Unsubscribe (inv-2 §9-2)', async () => {
    const client = await unClient();
    const regle = await uneRegle({ actions: [courriel('Immédiat', 'marketing')] });
    const { logs, envois } = await declencher(regle, client);
    expect(envois, JSON.stringify(logs)).toHaveLength(1);
    expect(lienDesabonnement(envois[0])).toEqual({ lien: true, listUnsubscribe: true, unClic: true });
  });

  it('[G-003] courriel TRANSACTIONNEL immédiat : pas de lien de désabonnement (voulu)', async () => {
    const client = await unClient();
    const regle = await uneRegle({ actions: [courriel('Confirmation', 'transactionnel')] });
    const { logs, envois } = await declencher(regle, client);
    expect(envois, JSON.stringify(logs)).toHaveLength(1);
    expect(lienDesabonnement(envois[0])).toEqual({ lien: false, listUnsubscribe: false, unClic: false });
  });

  it('[G-004] drapeau allumé, courriel commercial immédiat : lien + List-Unsubscribe', async () => {
    await drapeauParCanal(true);
    try {
      const client = await unClient();
      const regle = await uneRegle({ actions: [courriel('Canal', 'marketing')] });
      const { logs, envois } = await declencher(regle, client);
      expect(envois, JSON.stringify(logs)).toHaveLength(1);
      expect(lienDesabonnement(envois[0])).toEqual({ lien: true, listUnsubscribe: true, unClic: true });
    } finally { await drapeauParCanal(false); }
  });
});

describe('G — désabonnement courriel et STOP texto respectés', () => {
  async function desabonner(client: { email: string; phone: string }) {
    await ok(b.admin.from('email_unsubscribes').insert({ org_id: b.orgA, email: client.email, category: 'all', reason: m }).select('id'), 'désabonnement');
    await ok(b.admin.from('sms_opt_outs').insert({ org_id: b.orgA, phone: client.phone, reason: m }).select('id'), 'STOP');
  }
  const regleMixte = () => uneRegle({ actions: [courriel('Promo', 'marketing'), courriel('Reçu', 'transactionnel'), texto('Promo', 'marketing'), texto('Rappel', 'transactionnel')] });

  it('[G-010] drapeau éteint : désabonné + STOP → AUCUN courriel ni texto, commercial ou transactionnel', async () => {
    const client = await unClient();
    await desabonner(client);
    const regle = await regleMixte();
    const { logs, envois } = await declencher(regle, client, 4);
    expect(envois, JSON.stringify(logs)).toHaveLength(0);
    expect(logs.map((l) => (l.result_data as { saute?: string } | null)?.saute ? 'saute' : String(l.result_success))).toEqual(['saute', 'saute', 'saute', 'saute']);
  });

  /*
   * Mission finale (E-11, décision prise) : un numéro de la liste STOP ne
   * reçoit AUCUN texto, que le drapeau « désabonnement par canal » soit
   * allumé ou non. Avant, ce test affirmait que le texto transactionnel
   * (« Rappel ») partait sous le drapeau. Le courriel n'est pas touché par
   * cette décision : sous le drapeau, un désabonné du courriel reçoit encore
   * le transactionnel strict (« Reçu ») — c'est le sens du drapeau.
   */
  it('[G-011] drapeau allumé : désabonné + STOP → AUCUN texto (commercial ni transactionnel) ; courriel : le commercial est sauté, le transactionnel part', async () => {
    await drapeauParCanal(true);
    try {
      const client = await unClient();
      await desabonner(client);
      const regle = await regleMixte();
      const { logs, envois } = await declencher(regle, client, 4);
      expect(envois.filter((e) => e.canal === 'sms'), `aucun texto vers un numéro STOP — ${JSON.stringify(logs)}`).toHaveLength(0);
      const sujets = envois.map((e) => String(e.sujet).split(' ')[0]).sort();
      expect(sujets, JSON.stringify(logs)).toEqual(['Reçu']);
      // Les deux textos sont des sauts « désabonné », pas des échecs.
      const textos = logs.filter((l) => l.action_type === 'send_sms');
      expect(textos.map((l) => [l.result_success, (l.result_data as { saute_code?: string } | null)?.saute_code])).toEqual([[true, 'desabonne'], [true, 'desabonne']]);
    } finally { await drapeauParCanal(false); }
  });

  it('[G-011b] STOP seul (pas de désabonnement courriel), drapeau allumé PUIS éteint : aucun texto ne part, dans les deux cas', async () => {
    const seulementTextos = () => uneRegle({ actions: [texto('Promo', 'marketing'), texto('Rappel', 'transactionnel')] });
    for (const allume of [true, false]) {
      await drapeauParCanal(allume);
      try {
        const client = await unClient();
        await ok(b.admin.from('sms_opt_outs').insert({ org_id: b.orgA, phone: client.phone, reason: m }).select('id'), 'STOP');
        const regle = await seulementTextos();
        const { logs, envois } = await declencher(regle, client, 2);
        expect(envois.filter((e) => e.canal === 'sms'), `drapeau ${allume ? 'allumé' : 'éteint'} — ${JSON.stringify(logs)}`).toHaveLength(0);
        expect(logs.map((l) => (l.result_data as { saute_code?: string } | null)?.saute_code)).toEqual(['desabonne', 'desabonne']);
      } finally { await drapeauParCanal(false); }
    }
  });

  it('[G-012] texto commercial : l’entreprise est nommée et « Répondez STOP » est ajouté (drapeau éteint, immédiat)', async () => {
    const client = await unClient();
    const regle = await uneRegle({ actions: [texto('Offre du printemps', 'marketing')] });
    const { logs, envois } = await declencher(regle, client);
    expect(envois, JSON.stringify(logs)).toHaveLength(1);
    expect(String(envois[0].corps)).toBe(`Offre du printemps ${m}\nNettoyage Test A - Répondez STOP pour ne plus recevoir.`);
  });

  it('[G-013] demande d’avis : client désabonné + STOP → rien ne part', async () => {
    await ok(b.admin.from('company_settings').update({ review_enabled: true, google_review_url: 'https://g.page/r/qa-secu/review' }).eq('org_id', b.orgA).select('org_id'), 'avis');
    const client = await unClient();
    await desabonner(client);
    const job = await ok(b.admin.from('jobs').insert({ org_id: b.orgA, created_by: b.users.proprioA, client_id: client.id, title: `Job ${m}`, status: 'completed', job_number: `G-${Date.now().toString(36)}` }).select('id').single(), 'job');
    nettoyer.push(() => b.admin.from('satisfaction_surveys').delete().eq('job_id', job.id));
    nettoyer.push(() => b.admin.from('review_requests').delete().eq('job_id', job.id));
    nettoyer.push(() => b.admin.from('jobs').delete().eq('id', job.id));
    const regle = await uneRegle({ trigger_event: 'task.completed', actions: [{ type: 'request_review', config: {} }] });
    const depuis = new Date().toISOString();
    await b.eventBus.emit('task.completed', { orgId: b.orgA, entityType: 'job', entityId: job.id, metadata: {} });
    const logs = await attendre(() => journaux(regle), (l) => termine(l), 30_000);
    const envois = (await envoisSimules(b.admin, b.orgA, depuis)).filter((e) => e.destinataire === client.email || e.destinataire === client.phone);
    expect(envois, JSON.stringify(logs)).toHaveLength(0);
  });

  /*
   * Envoi COMMERCIAL immédiat, drapeau éteint. Le moteur ne pose pas
   * `ctx.commercial` sur une action immédiate (automationEngine.ts,
   * contextePour) : le consentement (base légale LCAP) et le plafond de
   * fréquence n'étaient vérifiés QUE pour les envois différés, ou drapeau
   * allumé. Décision (LCAP) : le TYPE de l'envoi décide — un envoi marketing
   * est commercial, immédiat ou non (actions/index.ts, commercialSiMarketing).
   * Les envois transactionnels ne changent pas.
   */
  let mesureConsentement: { envoye: boolean; logs: Array<{ result_success: boolean; result_data: unknown }> } | null = null;
  it('[G-014] mesure : courriel commercial immédiat vers un client SANS consentement ni relation, drapeau éteint', async () => {
    const client = await unClient({ email_consent_at: null, sms_consent_at: null });
    const regle = await uneRegle({ actions: [courriel('Sans consentement', 'marketing')] });
    const { logs, envois } = await declencher(regle, client);
    mesureConsentement = { envoye: envois.length > 0, logs };
    expect(logs).toHaveLength(1);
  });
  it('[G-015] un courriel commercial immédiat sans base légale ne part pas (drapeau auto_desabonnement_canal éteint) : étape sautée, motif « consentement », le parcours continue', () => {
    expect(mesureConsentement).not.toBeNull();
    expect(mesureConsentement!.envoye, JSON.stringify(mesureConsentement!.logs)).toBe(false);
    const [log] = mesureConsentement!.logs;
    expect(log.result_success).toBe(true);
    expect(log.result_data).toMatchObject({ saute_code: 'sans_consentement' });
  });

  it('[G-016] témoin : le même courriel en TRANSACTIONNEL immédiat part toujours sans consentement (une confirmation répond à une demande du client)', async () => {
    const client = await unClient({ email_consent_at: null, sms_consent_at: null });
    const regle = await uneRegle({ actions: [courriel('Confirmation', 'transactionnel')] });
    const { logs, envois } = await declencher(regle, client);
    expect(envois, JSON.stringify(logs)).toHaveLength(1);
  });

  it('[G-017] base TACITE : sans consentement exprès mais avec une job récente, le courriel commercial immédiat part — et la base légale est consignée (consents)', async () => {
    const client = await unClient({ email_consent_at: null, sms_consent_at: null });
    const job = await ok(b.admin.from('jobs').insert({ org_id: b.orgA, created_by: b.users.proprioA, client_id: client.id, title: `Job ${m}`, status: 'completed', job_number: `G-${Date.now().toString(36)}` }).select('id').single(), 'job');
    nettoyer.push(() => b.admin.from('jobs').delete().eq('id', job.id));
    nettoyer.push(() => b.admin.from('consents').delete().eq('subject_id', client.id));
    const regle = await uneRegle({ actions: [courriel('Offre tacite', 'marketing')] });
    const { logs, envois } = await declencher(regle, client);
    expect(envois, JSON.stringify(logs)).toHaveLength(1);
    expect(lienDesabonnement(envois[0])).toEqual({ lien: true, listUnsubscribe: true, unClic: true });
    const preuves = await attendre(
      async () => (await b.admin.from('consents').select('purpose, method, granted').eq('subject_id', client.id)).data ?? [],
      (l) => l.length > 0, 20_000,
    );
    expect(preuves, 'la base légale retenue doit être démontrable').toHaveLength(1);
    expect(preuves[0]).toMatchObject({ purpose: 'email-marketing', granted: true });
    expect(String(preuves[0].method)).toMatch(/^lcap-tacite/);
  });

  it('[G-018] texto commercial immédiat sans base légale : sauté lui aussi ; le texto transactionnel part', async () => {
    const client = await unClient({ email_consent_at: null, sms_consent_at: null });
    const regle = await uneRegle({ actions: [texto('Offre', 'marketing'), texto('Rappel', 'transactionnel')] });
    const { logs, envois } = await declencher(regle, client, 2);
    expect(envois.map((e) => String(e.corps).split(' ')[0]), JSON.stringify(logs)).toEqual(['Rappel']);
    const saut = logs.find((l) => (l.result_data as { saute_code?: string } | null)?.saute_code === 'sans_consentement');
    expect(saut, JSON.stringify(logs)).toBeTruthy();
  });
});

describe('G — marque des courriels : l’entreprise seulement', () => {
  let envoi: { corps: string | null; meta: unknown; sujet: string | null } | null = null;
  beforeAll(async () => {
    await ok(b.admin.from('company_settings').update({ brand_color: '#0E7C66', logo_url: 'https://cdn.nettoyage-a.example/logo.png' }).eq('org_id', b.orgA).select('org_id'), 'marque');
    const client = await unClient();
    const regle = await uneRegle({ actions: [courriel('Marque', 'marketing')] });
    const r = await declencher(regle, client);
    envoi = r.envois[0] ?? null;
    if (!envoi) throw new Error(`aucun courriel : ${JSON.stringify(r.logs)}`);
  });

  it('[G-020] logo, couleur et nom de l’entreprise ; nom d’expéditeur = entreprise', () => {
    const corps = String(envoi!.corps);
    expect(corps).toContain('<img src="https://cdn.nettoyage-a.example/logo.png" alt="Nettoyage Test A"');
    expect(corps.toLowerCase()).toContain('#0e7c66');
    expect(corps).toContain('Nettoyage Test A');
    const from = String((envoi!.meta as { from?: string }).from);
    expect(from.startsWith('Nettoyage Test A <')).toBe(true);
  });

  it('[G-021] aucune autre trace de Lume dans le courriel (texte, pied, liens, « Powered by »)', () => {
    const base = (process.env.FRONTEND_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '');
    // Les liens vers l'adresse publique (désabonnement) sont traités en G-023.
    // Ce que le destinataire peut VOIR : sans la feuille de style ni les noms
    // de classes CSS (`lume-fond`, `lume-texte` : invisibles, notés à la
    // matrice), sans le domaine fictif des données de test (lume-qa.test).
    const visible = (html: string) => html.split(base).join('')
      .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/\sclass="[^"]*"/gi, '').replace(/[\w.+-]*@?[\w.-]*lume-qa\.test/gi, '');
    const corps = visible(String(envoi!.corps));
    const texte = visible(String((envoi!.meta as { text?: string }).text ?? ''));
    for (const [quoi, contenu] of [['HTML', corps], ['texte', texte], ['objet', String(envoi!.sujet)]] as const) {
      expect(contenu, `${quoi} : trace de Lume`).not.toMatch(/lume|powered by|envoy[ée] avec|sent with/i);
    }
    const replyTo = String((envoi!.meta as { replyTo?: string }).replyTo ?? '');
    expect(replyTo).not.toMatch(/lume(crm)?\.net/i);
  });

  it.fails('[G-022] ROUGE ATTENDU — décision requise : le petit mascot Lume en bas du courriel (exigence Rafba) — retiré le 2026-09-29, norme « marque blanche côté client » du 2026-09-30', () => {
    expect(String(envoi!.corps)).toMatch(/<img[^>]+(mascot|mascotte)[^>]*>/i);
  });

  it.fails('[G-023] ROUGE ATTENDU — décision requise : l’adresse d’expédition est sur le domaine de Lume (@lumecrm.net) tant que l’entreprise n’a pas vérifié son domaine', () => {
    const from = String((envoi!.meta as { from?: string }).from);
    expect(from).not.toMatch(/@lumecrm\.net>/i);
  });
});
