/**
 * F — Sécurité / multi-tenant au niveau du MOTEUR (vrai moteur, vrai bus,
 * vraies lignes en base, bac à sable pour les envois) :
 *
 *  · isolation : une règle de A n'a jamais d'effet sur une entité ou un
 *    événement de B (événement de B, variables d'un deal de B, « démarrer une
 *    automatisation » vers une règle de B) ;
 *  · injection : un prénom, un nom ou un champ personnalisé (y compris une
 *    clé en `_html`) contenant du HTML actif n'arrive JAMAIS actif dans le
 *    courriel rendu (lu dans `envois_simules.corps`) ;
 *  · anti-spam : plafond par client (3 commerciaux / 24 h, par canal),
 *    étalement des textos par entreprise (30 / min), et l'absence de plafond
 *    global par automatisation (décision F11 du 2026-09-23).
 *
 * Toutes les règles de ce fichier portent `settings.fenetre = 0-24` : la
 * fenêtre d'envoi (8 h-20 h) reporterait sinon les textos selon l'heure où la
 * suite tourne — un test qui dépend de l'horloge n'est pas un test.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sessionDe, COMPTES } from '../harnais/bureau-test';
import { demarrerMoteur, marque, envoisSimules, attendre, traiterFile, appelsTwilio, appelsHttpBloques } from '../harnais/moteur';
import { journalDefinitif } from '../harnais/moteur';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
const m = marque('F-moteur');
const nettoyer: Array<() => PromiseLike<unknown>> = [];
const TOUTE_LA_JOURNEE = { fenetre: { debut: 0, fin: 24 } };
let suffixe = 0;
/** Règles créées par le test en cours : éteintes à la fin, sinon elles réagiraient aux tests suivants. */
const reglesDuTest: string[] = [];

async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, quoi: string): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error || data === null || data === undefined) throw new Error(`${quoi} : ${error?.message ?? 'aucune donnée'}`);
  return data as NonNullable<T>;
}

/** Un client de A (ou B), coordonnées fictives uniques, consentements exprès. */
async function unClient(org: string, extra: Record<string, unknown> = {}) {
  suffixe += 1;
  const tel = `+1555555${String(100 + ((Date.now() / 1000 + suffixe * 7) % 100 | 0)).padStart(4, '0')}`;
  const c = await ok(b.admin.from('clients').insert({
    org_id: org, created_by: org === b.orgA ? b.users.proprioA : b.users.proprioB,
    first_name: 'Fgh', last_name: m, status: 'active',
    email: `fgh-${Date.now().toString(36)}-${suffixe}@lume-qa.test`, phone: tel,
    email_consent_at: new Date().toISOString(), sms_consent_at: new Date().toISOString(),
    ...extra,
  }).select('id, email, phone, first_name, last_name').single(), 'client');
  nettoyer.push(() => b.admin.from('clients').delete().eq('id', c.id));
  // Le plafond compte les textos des 24 dernières heures vers ce numéro :
  // un numéro réutilisé par un passage précédent fausserait le compte.
  await b.admin.from('messages').delete().eq('org_id', org).eq('phone_number', c.phone);
  nettoyer.push(() => b.admin.from('messages').delete().eq('org_id', org).eq('phone_number', c.phone));
  return c as { id: string; email: string; phone: string; first_name: string; last_name: string };
}

async function uneRegle(org: string, corps: Record<string, unknown>) {
  const r = await ok(b.admin.from('automation_rules').insert({
    org_id: org, name: `${m} ${String(corps.trigger_event)} ${++suffixe}`, conditions: {}, delay_seconds: 0,
    is_active: true, is_preset: false, settings: TOUTE_LA_JOURNEE, ...corps,
  }).select('id').single(), 'règle');
  nettoyer.push(() => b.admin.from('automation_rules').delete().eq('id', r.id));
  nettoyer.push(() => b.admin.from('automation_scheduled_tasks').delete().eq('automation_rule_id', r.id));
  reglesDuTest.push(r.id as string);
  return r.id as string;
}

async function journaux(regle: string) {
  const { data } = await b.admin.from('automation_execution_logs')
    .select('action_type, result_success, result_data, result_error, entity_id, created_at')
    .eq('automation_rule_id', regle).order('created_at');
  return data ?? [];
}

beforeAll(async () => { b = await demarrerMoteur(); }, 120_000);
afterEach(async () => {
  if (reglesDuTest.length) await b.admin.from('automation_rules').update({ is_active: false }).in('id', reglesDuTest.splice(0));
});
afterAll(async () => {
  await b.admin.from('tasks').delete().eq('org_id', b.orgA).ilike('title', `%${m}%`);
  for (const f of nettoyer.reverse()) await f();
});

describe('F — isolation du moteur entre bureaux', () => {
  it('[F-060] un événement de B ne fait jamais tourner une règle de A', async () => {
    const clientB = await unClient(b.orgB);
    const regleA = await uneRegle(b.orgA, {
      trigger_event: 'client.tagged',
      actions: [{ type: 'create_task', config: { title: `A sur B ${m}` } }, { type: 'send_sms', config: { body: `A sur B ${m}`, type_envoi: 'transactionnel' } }],
    });
    const depuis = new Date().toISOString();
    await b.eventBus.emit('client.tagged', { orgId: b.orgB, entityType: 'client', entityId: clientB.id, metadata: { tag: 'qa-secu' } });
    // Témoin : la même règle, sur un événement de A, tourne (sinon « 0 » ne prouve rien).
    const clientA = await unClient(b.orgA);
    await b.eventBus.emit('client.tagged', { orgId: b.orgA, entityType: 'client', entityId: clientA.id, metadata: { tag: 'qa-secu' } });
    const logs = await attendre(() => journaux(regleA), (l) => l.length >= 2);
    expect(logs.map((l) => l.entity_id)).toEqual([clientA.id, clientA.id]);
    const versB = (await envoisSimules(b.admin, b.orgA, depuis)).filter((e) => e.destinataire === clientB.phone || e.destinataire === clientB.email);
    expect(versB).toHaveLength(0);
    const { data: tachesB } = await b.admin.from('tasks').select('id').eq('org_id', b.orgA).eq('linked_entity_id', clientB.id);
    expect(tachesB).toHaveLength(0);
  });

  it('[F-061] les variables d’un événement de A ne lisent jamais un deal de B (courriel, téléphone du client de B)', async () => {
    const clientB = await unClient(b.orgB);
    const pipeline = await ok(b.admin.from('pipelines_ventes').insert({ org_id: b.orgB, name: `${m} pipeline` }).select('id').single(), 'pipeline B');
    nettoyer.push(() => b.admin.from('pipelines_ventes').delete().eq('id', pipeline.id));
    const etape = await ok(b.admin.from('pipeline_stages').insert({ org_id: b.orgB, pipeline_id: pipeline.id, name_fr: 'Nouveau', name_en: 'New', position: 1 }).select('id').single(), 'étape B');
    nettoyer.push(() => b.admin.from('pipeline_stages').delete().eq('id', etape.id));
    const deal = await ok(b.admin.from('deals').insert({ org_id: b.orgB, pipeline_id: pipeline.id, stage_id: etape.id, client_id: clientB.id }).select('id').single(), 'deal B');
    nettoyer.push(() => b.admin.from('deals').delete().eq('id', deal.id));

    const { resolveEntityVariables } = await import('../../../server/lib/actions');
    const vars = await resolveEntityVariables(b.admin, b.orgA, 'deal', deal.id);
    // Témoin : dans son propre bureau, le deal se résout.
    const varsB = await resolveEntityVariables(b.admin, b.orgB, 'deal', deal.id);
    expect(varsB.client_email).toBe(clientB.email);
    expect(vars.client_email ?? '', 'le courriel du client de B est lu depuis le bureau A').toBe('');
    expect(vars.client_phone ?? '', 'le téléphone du client de B est lu depuis le bureau A').toBe('');
    expect(vars.client_name ?? '').toBe('');

    // Par le moteur : une règle de A sur un événement de deal portant l'identifiant du deal de B.
    const regleA = await uneRegle(b.orgA, {
      trigger_event: 'deal.stage_entered',
      actions: [{ type: 'send_email', config: { subject: `Deal B ${m}`, body: '<p>{client_name}</p>', type_envoi: 'transactionnel' } }],
    });
    const depuis = new Date().toISOString();
    await b.eventBus.emit('deal.stage_entered', { orgId: b.orgA, entityType: 'deal', entityId: deal.id, metadata: {} });
    await attendre(() => journaux(regleA), (l) => l.length >= 1 && journalDefinitif(l[0].result_error));
    const versB = (await envoisSimules(b.admin, b.orgA, depuis)).filter((e) => e.destinataire === clientB.email);
    expect(versB, 'un courriel de A est parti vers le client de B').toHaveLength(0);
  });

  it('[F-062] « Démarrer une automatisation » vers une règle de B échoue ; la règle de B ne tourne pas', async () => {
    const clientA = await unClient(b.orgA);
    const regleB = await uneRegle(b.orgB, { trigger_event: 'client.tagged', actions: [{ type: 'create_task', config: { title: `B démarrée par A ${m}` } }] });
    const regleA = await uneRegle(b.orgA, { trigger_event: 'client.tagged', actions: [{ type: 'demarrer_automatisation', config: { rule_id: regleB } }] });
    await b.eventBus.emit('client.tagged', { orgId: b.orgA, entityType: 'client', entityId: clientA.id, metadata: { tag: 'qa-secu' } });
    const [log] = await attendre(() => journaux(regleA), (l) => l.length >= 1 && journalDefinitif(l[0].result_error));
    expect(log.result_success).toBe(false);
    expect(await journaux(regleB)).toHaveLength(0);
    const { data: taches } = await b.admin.from('tasks').select('id').ilike('title', `%B démarrée par A ${m}%`);
    expect(taches).toHaveLength(0);
  });

  it('[F-063] « Arrêter l’automatisation » dans A n’annule jamais une tâche prévue de B', async () => {
    const clientB = await unClient(b.orgB);
    const regleB = await uneRegle(b.orgB, { trigger_event: 'client.tagged', is_active: false, actions: [{ type: 'create_task', config: { title: 'x' } }] });
    const tacheB = await ok(b.admin.from('automation_scheduled_tasks').insert({
      org_id: b.orgB, automation_rule_id: regleB, entity_type: 'client', entity_id: clientB.id,
      action_config: {}, execute_at: new Date(Date.now() + 30 * 86400_000).toISOString(), status: 'pending', execution_key: `F-063:${randomUUID()}`,
    }).select('id').single(), 'tâche B');
    const regleA = await uneRegle(b.orgA, { trigger_event: 'client.tagged', actions: [{ type: 'arreter_automatisation', config: { portee: 'toutes' } }] });
    // Même identifiant d'entité que la tâche de B : seule l'org les distingue.
    await b.eventBus.emit('client.tagged', { orgId: b.orgA, entityType: 'client', entityId: clientB.id, metadata: { tag: 'qa-secu' } });
    await attendre(() => journaux(regleA), (l) => l.length >= 1 && journalDefinitif(l[0].result_error));
    const { data } = await b.admin.from('automation_scheduled_tasks').select('status').eq('id', tacheB.id).single();
    expect(data!.status).toBe('pending');
  });
});

describe('F — injection HTML dans les courriels d’automatisation', () => {
  it('[F-070] prénom / nom contenant <script> et <img onerror> : échappés dans le courriel rendu', async () => {
    const client = await unClient(b.orgA, { first_name: '<script>alert("xss")</script>', last_name: '<img src=x onerror=alert(1)>' });
    const regle = await uneRegle(b.orgA, {
      trigger_event: 'client.tagged',
      actions: [{ type: 'send_email', config: {
        subject: `Inj ${m} {client_first_name}`, body: '<p>Bonjour {client_first_name} [client_last_name] {{client.nom}}</p>',
        preheader: '{client_last_name}', from_name: '{client_first_name}', type_envoi: 'transactionnel',
      } }],
    });
    const depuis = new Date().toISOString();
    await b.eventBus.emit('client.tagged', { orgId: b.orgA, entityType: 'client', entityId: client.id, metadata: { tag: 'qa-secu' } });
    const [envoi] = await attendre(async () => (await envoisSimules(b.admin, b.orgA, depuis)).filter((e) => e.destinataire === client.email && String(e.sujet).startsWith('Inj ')), (l) => l.length >= 1);
    expect(envoi, JSON.stringify(await journaux(regle))).toBeTruthy();
    const corps = String(envoi.corps);
    expect(corps).not.toMatch(/<script/i);
    expect(corps).not.toMatch(/<img[^>]*onerror/i);
    expect(corps).toContain('&lt;script&gt;');
    expect(corps).toContain('&lt;img src=x onerror=alert(1)&gt;');
    const from = String((envoi.meta as { from?: string }).from ?? '');
    expect(from).not.toMatch(/[<"]script|<img/i);
  });

  it('[F-071] champ personnalisé à clé en `_html` : sa valeur est échappée comme les autres', async () => {
    const { jeton, client: sessionA } = await sessionDe(b.admin, COMPTES.proprioA.email);
    expect(jeton).toBeTruthy();
    const { creerChamp, ecrireValeurs, listerChamps } = await import('../../../server/lib/champs/service');
    const cle = `note_${Date.now().toString(36)}_html`;
    const { champs: existants } = await listerChamps(sessionA, b.orgA, { objet: 'client' });
    const champ = existants.find((c) => c.key === cle)
      ?? await creerChamp(sessionA, b.orgA, { object_type: 'client', label: `Note ${m}`.slice(0, 60), field_type: 'single_line', key: cle, sur_formulaire: false } as never);
    nettoyer.push(() => b.admin.from('custom_fields').delete().eq('id', champ.id));
    const client = await unClient(b.orgA);
    const ecrit = await ecrireValeurs(sessionA, b.orgA, 'client', client.id, [{ field_id: champ.id, value: '<img src=x onerror=alert(document.cookie)>' }], { source: 'automation' });
    expect(ecrit[0]?.ok, JSON.stringify(ecrit)).toBe(true);
    const { resolveEntityVariables } = await import('../../../server/lib/actions');
    const vars = await resolveEntityVariables(b.admin, b.orgA, 'client', client.id);
    expect(vars[`client_cf_${cle}`] ?? vars[`client.${cle}`], JSON.stringify(Object.keys(vars))).toBe('<img src=x onerror=alert(document.cookie)>');
    const regle = await uneRegle(b.orgA, {
      trigger_event: 'client.tagged',
      actions: [{ type: 'send_email', config: { subject: `Champ ${m}`, body: `<p>Note : {{client.${cle}}} / {client_cf_${cle}}</p>`, type_envoi: 'transactionnel' } }],
    });
    const depuis = new Date().toISOString();
    await b.eventBus.emit('client.tagged', { orgId: b.orgA, entityType: 'client', entityId: client.id, metadata: { tag: 'qa-secu' } });
    const [envoi] = await attendre(async () => (await envoisSimules(b.admin, b.orgA, depuis)).filter((e) => e.destinataire === client.email && String(e.sujet).startsWith('Champ ')), (l) => l.length >= 1);
    expect(envoi, JSON.stringify(await journaux(regle))).toBeTruthy();
    const corps = String(envoi.corps);
    expect(corps, 'la valeur du champ est bien rendue (témoin)').toContain('onerror=alert(document.cookie)');
    expect(corps, 'HTML actif injecté par un champ personnalisé en _html').not.toMatch(/<img[^>]*onerror/i);
    // Échappé UNE fois : le client lit « <img …> » en texte, pas « &lt;img… ».
    expect(corps).toContain('Note : &lt;img src=x onerror=alert(document.cookie)&gt; / &lt;img');
  });
});

describe('F — anti-spam : plafonds', () => {
  /*
   * Plafond PAR CLIENT : 3 messages commerciaux / 24 h, par canal
   * (AUTOMATION_MAX_COMMERCIAL_PER_DAY, défaut 3). Le plus petit volume qui
   * l'atteint : 4 envois au même client. Chemin différé (file), drapeau par
   * canal éteint : c'est la configuration de la plupart des entreprises.
   */
  async function quatreEnvoisDiffereS(action: 'send_sms' | 'send_email') {
    const client = await unClient(b.orgA);
    const actions = [1, 2, 3, 4].map((n) => (action === 'send_sms'
      ? { type: 'send_sms', config: { body: `Promo ${n} ${m}`, type_envoi: 'marketing' } }
      : { type: 'send_email', config: { subject: `Promo ${n} ${m}`, body: `<p>Promo ${n}</p>`, type_envoi: 'marketing' } }));
    const regle = await uneRegle(b.orgA, { trigger_event: 'client.tagged', delay_seconds: 3600, actions });
    const depuis = new Date().toISOString();
    await b.eventBus.emit('client.tagged', { orgId: b.orgA, entityType: 'client', entityId: client.id, metadata: { tag: 'qa-secu' } });
    const taches = await attendre(async () => (await b.admin.from('automation_scheduled_tasks').select('id').eq('automation_rule_id', regle)).data ?? [], (t) => t.length >= 4);
    expect(taches).toHaveLength(4);
    await b.admin.from('automation_scheduled_tasks').update({ execute_at: new Date(Date.now() - 1000).toISOString() }).eq('automation_rule_id', regle);
    await traiterFile(b.admin, b.orgA);
    const envois = (await envoisSimules(b.admin, b.orgA, depuis)).filter((e) => e.destinataire === (action === 'send_sms' ? client.phone : client.email));
    return { envois, logs: await journaux(regle), client };
  }

  it('[F-080] textos commerciaux : le 4e au même client en 24 h est refusé (plafond 3)', async () => {
    const { envois, logs } = await quatreEnvoisDiffereS('send_sms');
    expect(envois, JSON.stringify(logs)).toHaveLength(3);
    expect(logs.filter((l) => l.result_success)).toHaveLength(3);
    const refus = logs.filter((l) => !l.result_success);
    expect(refus).toHaveLength(1);
    expect(refus[0].result_error).toMatch(/Frequency cap reached .*\(max 3 /);
    expect(appelsTwilio).toHaveLength(0);
  });

  it('[F-081] courriels commerciaux : le 4e au même client en 24 h est refusé (plafond 3)', async () => {
    const { envois, logs } = await quatreEnvoisDiffereS('send_email');
    expect(envois, JSON.stringify(logs)).toHaveLength(3);
    const refus = logs.filter((l) => !l.result_success);
    expect(refus).toHaveLength(1);
    expect(refus[0].result_error).toMatch(/Frequency cap reached .*\(max 3 /);
    await b.admin.from('email_unsubscribes').delete().eq('org_id', b.orgA).ilike('email', 'fgh-%@lume-qa.test').eq('category', 'pending');
  });

  it('[F-082] étalement par entreprise : au-delà de 30 textos d’automatisation dans la minute, le suivant est reporté d’une minute', async () => {
    const { DEBIT_SMS_PAR_MINUTE } = await import('../../../server/lib/automationEngine');
    expect(DEBIT_SMS_PAR_MINUTE).toBe(30);
    // L'état « 30 textos partis dans la minute » est posé en base (ce que le
    // moteur compte), plutôt que d'envoyer 30 textos : c'est le plus petit
    // volume qui atteint le seuil.
    const faux = Array.from({ length: DEBIT_SMS_PAR_MINUTE }, () => ({
      org_id: b.orgA, trigger_event: 'client.tagged', entity_type: 'client', entity_id: randomUUID(),
      action_type: 'send_sms', action_config: { rafale: m }, result_success: true,
    }));
    const inseres = await ok(b.admin.from('automation_execution_logs').insert(faux).select('id'), 'rafale');
    nettoyer.push(() => b.admin.from('automation_execution_logs').delete().in('id', inseres.map((r: { id: string }) => r.id)));
    const client = await unClient(b.orgA);
    const regle = await uneRegle(b.orgA, { trigger_event: 'client.tagged', actions: [{ type: 'send_sms', config: { body: `Rafale ${m}`, type_envoi: 'transactionnel' } }] });
    const depuis = new Date().toISOString();
    await b.eventBus.emit('client.tagged', { orgId: b.orgA, entityType: 'client', entityId: client.id, metadata: { tag: 'qa-secu' } });
    const taches = await attendre(async () => (await b.admin.from('automation_scheduled_tasks').select('execute_at, action_config, status').eq('automation_rule_id', regle)).data ?? [], (t) => t.length >= 1);
    expect(taches).toHaveLength(1);
    expect((taches[0].action_config as { report_rafale?: boolean }).report_rafale).toBe(true);
    const ecart = new Date(taches[0].execute_at).getTime() - Date.now();
    expect(ecart).toBeGreaterThan(30_000);
    expect(ecart).toBeLessThanOrEqual(61_000);
    expect((await envoisSimules(b.admin, b.orgA, depuis)).filter((e) => e.destinataire === client.phone)).toHaveLength(0);
    // La rafale posée ne doit pas reporter les textos des tests suivants.
    await b.admin.from('automation_execution_logs').delete().in('id', inseres.map((r: { id: string }) => r.id));
  });

  /*
   * Plafond GLOBAL par automatisation / par entreprise : il N'EXISTE PAS.
   * Décision F11 (2026-09-23, en-tête de `rafaleDeTextos`) : « on ne PLAFONNE
   * pas les messages d'une entreprise à ses clients — tout part », seulement
   * 30 / min. Une règle mal faite (étiquette posée en lot sur 5 000 clients,
   * message typé transactionnel) enverrait donc 5 000 textos en ≈ 2 h 47,
   * chacun à un client différent : le plafond par client ne mord jamais.
   * Proposition : un plafond quotidien par automatisation (ex. 500) au-delà
   * duquel la règle est mise en brouillon et le propriétaire notifié.
   */
  let etatGlobal: { envoye: boolean; journal: { logs: Array<{ result_success: boolean }>; taches: unknown } } | null = null;
  it('[F-083] mesure : une automatisation qui a déjà envoyé 500 textos aujourd’hui en envoie encore', async () => {
    const client = await unClient(b.orgA);
    const regle = await uneRegle(b.orgA, { trigger_event: 'client.tagged', actions: [{ type: 'send_sms', config: { body: `Volume ${m}`, type_envoi: 'transactionnel' } }] });
    const ilYA2h = new Date(Date.now() - 2 * 3600_000).toISOString();
    const faux = Array.from({ length: 500 }, () => ({
      org_id: b.orgA, automation_rule_id: regle, trigger_event: 'client.tagged', entity_type: 'client', entity_id: randomUUID(),
      action_type: 'send_sms', action_config: { volume: m }, result_success: true, created_at: ilYA2h,
    }));
    await ok(b.admin.from('automation_execution_logs').insert(faux).select('id'), 'volume');
    nettoyer.push(() => b.admin.from('automation_execution_logs').delete().eq('automation_rule_id', regle));
    const depuis = new Date().toISOString();
    await b.eventBus.emit('client.tagged', { orgId: b.orgA, entityType: 'client', entityId: client.id, metadata: { tag: 'qa-secu' } });
    await attendre(async () => (await journaux(regle)).filter((l) => l.created_at > depuis), (l) => l.length >= 1 && journalDefinitif(l[0].result_error));
    const envoye = (await envoisSimules(b.admin, b.orgA, depuis)).some((e) => e.destinataire === client.phone);
    const { data: taches } = await b.admin.from('automation_scheduled_tasks').select('status, execute_at, action_config').eq('automation_rule_id', regle);
    etatGlobal = { envoye, journal: { logs: (await journaux(regle)).filter((l) => l.created_at > depuis), taches } };
    expect(etatGlobal.journal.logs, JSON.stringify(etatGlobal.journal)).toHaveLength(1);
    expect(etatGlobal.journal.logs[0].result_success, JSON.stringify(etatGlobal.journal)).toBe(true);
  });

  it.fails('[F-084] ROUGE ATTENDU — décision requise : plafond global par automatisation (le 501e texto du jour ne devrait pas partir ; F11 écarté le 2026-09-23)', () => {
    expect(etatGlobal, 'la mesure F-083 n’a pas tourné').not.toBeNull();
    expect(etatGlobal!.envoye, `texto parti malgré 500 déjà envoyés aujourd'hui par la même automatisation : ${JSON.stringify(etatGlobal!.journal)}`).toBe(false);
  });

  it('[F-085] aucun envoi du bureau de test n’a atteint un fournisseur réel', () => {
    expect(appelsTwilio).toHaveLength(0);
    expect(appelsHttpBloques()).toHaveLength(0);
  });
});
