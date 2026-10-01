/**
 * F — Sécurité / multi-tenant : les ROUTES Express des automatisations.
 *
 * Les vrais routeurs, montés en mémoire derrière le VRAI `rbacMiddleware`
 * (auth + permissions de la page Rôles), appelés avec de VRAIS jetons
 * (sessionDe). Le vrai moteur écoute le bus (demarrerMoteur) : un événement
 * que la route laisserait passer ferait réellement tourner les règles de A.
 *
 *  · le propriétaire de A, avec les identifiants d'objets de B (règle,
 *    dossier, adresse d'appel, client, devis, rendez-vous), n'obtient RIEN :
 *    404 / refus, et B est intact (relu par service_role) ;
 *  · le technicien de A n'a accès à aucune écriture (403 du rbac).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { sessionDe, COMPTES } from '../harnais/bureau-test';
import { demarrerMoteur, marque, envoisSimules, attendre } from '../harnais/moteur';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
let serveur: Server;
let base = '';
let jetonA = '';
let jetonB = '';
let jetonT = '';
const m = marque('F-routes');
const nettoyer: Array<() => PromiseLike<unknown>> = [];
/** Objets de B, créés par service_role. */
const B: Record<string, string> = {};
/** Objets de A. */
const A: Record<string, string> = {};

async function appel(jeton: string, methode: string, chemin: string, corps?: unknown, org?: string) {
  const res = await fetch(`${base}/api${chemin}`, {
    method: methode,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jeton}`,
      ...(org ? { 'x-org-id': org } : {}),
    },
    ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
  });
  const texte = await res.text();
  let json: any = null;
  try { json = texte ? JSON.parse(texte) : null; } catch { json = texte; }
  return { statut: res.status, corps: json };
}

async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, quoi: string): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error || data === null || data === undefined) throw new Error(`${quoi} : ${error?.message ?? 'aucune donnée'}`);
  return data as NonNullable<T>;
}

beforeAll(async () => {
  b = await demarrerMoteur();
  const ad = b.admin;
  jetonA = (await sessionDe(ad, COMPTES.proprioA.email)).jeton;
  jetonB = (await sessionDe(ad, COMPTES.proprioB.email)).jeton;
  jetonT = (await sessionDe(ad, COMPTES.techA.email)).jeton;

  const { rbacMiddleware } = await import('../../../server/lib/route-permissions');
  const routeurs = await Promise.all([
    import('../../../server/routes/automation-test'),
    import('../../../server/routes/automation-events'),
    import('../../../server/routes/automation-rules'),
    import('../../../server/routes/automation-publication'),
    import('../../../server/routes/automation-stats'),
  ]);
  const app = express();
  app.use(express.json());
  app.use(rbacMiddleware());
  for (const r of routeurs) app.use('/api', r.default);
  await new Promise<void>((r) => { serveur = app.listen(0, '127.0.0.1', () => r()); });
  base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;

  // ── Objets de B ──
  const clientB = await ok(ad.from('clients').insert({
    org_id: b.orgB, created_by: b.users.proprioB, first_name: 'VoisinB', last_name: m, status: 'lead',
    email: `voisin-b-${Date.now()}@lume-qa.test`, phone: '+15555550177',
    email_consent_at: new Date().toISOString(), sms_consent_at: new Date().toISOString(),
  }).select('id, email').single(), 'client B');
  B.client = clientB.id; B.email = clientB.email;
  nettoyer.push(() => ad.from('clients').delete().eq('id', clientB.id));

  const regleB = await ok(ad.from('automation_rules').insert({
    org_id: b.orgB, name: `${m} B`, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, is_active: false, is_preset: false,
    actions: [{ type: 'create_task', config: { title: `Tâche B ${m}` } }],
  }).select('id').single(), 'règle B');
  B.regle = regleB.id;
  nettoyer.push(() => ad.from('automation_rules').delete().eq('id', regleB.id));

  const dossierB = await ok(ad.from('automation_folders').insert({ org_id: b.orgB, name: `B ${Date.now().toString(36)}` }).select('id').single(), 'dossier B');
  B.dossier = dossierB.id;
  nettoyer.push(() => ad.from('automation_folders').delete().eq('id', dossierB.id));

  const hookB = await ok(ad.from('automation_webhooks').insert({ org_id: b.orgB, name: `B ${m}`.slice(0, 80), enabled: false }).select('id, api_key').single(), 'webhook B');
  B.hook = hookB.id; B.cle = hookB.api_key;
  nettoyer.push(() => ad.from('automation_webhooks').delete().eq('id', hookB.id));

  const devisB = await ok(ad.from('quotes').insert({
    org_id: b.orgB, created_by: b.users.proprioB, client_id: clientB.id, quote_number: `QB-${Date.now().toString(36)}`, status: 'draft',
  }).select('id').single(), 'devis B');
  B.devis = devisB.id;
  nettoyer.push(() => ad.from('quotes').delete().eq('id', devisB.id));

  const jobB = await ok(ad.from('jobs').insert({
    org_id: b.orgB, created_by: b.users.proprioB, client_id: clientB.id, title: `Job B ${m}`, status: 'scheduled', job_number: `QB-${Date.now().toString(36)}`,
  }).select('id').single(), 'job B');
  B.job = jobB.id;
  nettoyer.push(() => ad.from('jobs').delete().eq('id', jobB.id));
  const debut = new Date(Date.now() + 5 * 86400_000);
  const rdvB = await ok(ad.from('schedule_events').insert({
    org_id: b.orgB, created_by: b.users.proprioB, job_id: jobB.id, title: `RDV B ${m}`,
    start_at: debut.toISOString(), end_at: new Date(debut.getTime() + 3600_000).toISOString(),
  }).select('id').single(), 'rendez-vous B');
  B.rdv = rdvB.id;
  nettoyer.push(() => ad.from('schedule_events').delete().eq('id', rdvB.id));
  // Un rappel prévu de B, calé sur ce rendez-vous : A ne doit pas pouvoir l'annuler.
  const tacheB = await ok(ad.from('automation_scheduled_tasks').insert({
    org_id: b.orgB, automation_rule_id: regleB.id, entity_type: 'schedule_event', entity_id: rdvB.id,
    action_config: { type: 'create_task', config: { title: 'rappel B' } }, execute_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
    status: 'pending', execution_key: `F-routes:${randomUUID()}`,
  }).select('id').single(), 'tâche B');
  B.tache = tacheB.id;
  nettoyer.push(() => ad.from('automation_scheduled_tasks').delete().eq('id', tacheB.id));

  // ── Objets de A : une règle ACTIVE qui écoute les événements que les routes émettent ──
  const regleA = await ok(ad.from('automation_rules').insert({
    org_id: b.orgA, name: `${m} A`, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, is_active: true, is_preset: false,
    actions: [
      { type: 'send_email', config: { subject: `Espion ${m}`, body: '<p>Bonjour {client_first_name} {client_email}</p>', type_envoi: 'transactionnel' } },
      { type: 'create_task', config: { title: `Espion ${m} {client_name}` } },
    ],
  }).select('id').single(), 'règle A');
  A.regle = regleA.id;
  nettoyer.push(() => ad.from('automation_rules').delete().eq('id', regleA.id));
  for (const [cle, declencheur] of [['regleStatut', 'lead.status_changed'], ['regleDevis', 'quote.sent'], ['regleRdv', 'appointment.created']] as const) {
    const r = await ok(ad.from('automation_rules').insert({
      org_id: b.orgA, name: `${m} A ${declencheur}`, trigger_event: declencheur, conditions: {}, delay_seconds: 0, is_active: true, is_preset: false,
      actions: [{ type: 'create_task', config: { title: `Espion ${m} {client_name}` } }],
    }).select('id').single(), `règle A ${declencheur}`);
    A[cle] = r.id;
    nettoyer.push(() => ad.from('automation_rules').delete().eq('id', r.id));
  }
}, 180_000);

afterAll(async () => {
  await new Promise<void>((r) => (serveur ? serveur.close(() => r()) : r()));
  // Les tâches créées par les règles espionnes (s'il y en a) partent aussi.
  await b.admin.from('tasks').delete().eq('org_id', b.orgA).ilike('title', `%${m}%`);
  for (const f of nettoyer.reverse()) await f();
});

async function regleBIntacte() {
  const { data } = await b.admin.from('automation_rules').select('name, is_active, deleted_at, purged_at, actions').eq('id', B.regle).single();
  expect(data!.name).toBe(`${m} B`);
  expect(data!.is_active).toBe(false);
  expect(data!.deleted_at).toBeNull();
  expect(data!.purged_at ?? null).toBeNull();
}

describe('F — le propriétaire de A avec les identifiants de B (routes des règles)', () => {
  it('[F-030] x-org-id du bureau B → 403 org_forbidden', async () => {
    const r = await appel(jetonA, 'GET', '/automations/rules', undefined, b.orgB);
    expect(r.statut).toBe(403);
    expect(r.corps?.code).toBe('org_forbidden');
  });

  it('[F-031] GET /automations/rules et /editeur ne montrent jamais la règle de B', async () => {
    const liste = await appel(jetonA, 'GET', '/automations/rules');
    expect(liste.statut).toBe(200);
    const regles = Array.isArray(liste.corps) ? liste.corps : (liste.corps?.rules ?? []);
    expect(regles.length, 'témoin : A voit ses propres règles').toBeGreaterThan(0);
    expect(regles.some((r: { id: string }) => r.id === B.regle)).toBe(false);
    const editeur = await appel(jetonA, 'GET', `/automations/editeur?rule_id=${B.regle}`);
    expect(editeur.statut).toBe(200);
    expect(editeur.corps.rule).toBeNull();
    expect((editeur.corps.autres ?? []).some((r: { id: string }) => r.id === B.regle)).toBe(false);
  });

  it('[F-032] PATCH, DELETE, dupliquer, restaurer, purger la règle de B → 404, B intacte, aucune copie chez A', async () => {
    expect((await appel(jetonA, 'PATCH', `/automations/rules/${B.regle}`, { name: 'PIRATE' })).statut).toBe(404);
    expect((await appel(jetonA, 'DELETE', `/automations/rules/${B.regle}`)).statut).toBe(404);
    expect((await appel(jetonA, 'POST', `/automations/rules/${B.regle}/duplicate`)).statut).toBe(404);
    const restaurer = await appel(jetonA, 'POST', `/automations/rules/${B.regle}/restaurer`);
    expect(restaurer.statut).toBe(404);
    const purger = await appel(jetonA, 'DELETE', `/automations/rules/${B.regle}/definitivement`);
    expect(purger.statut).toBe(404);
    const { data: copies } = await b.admin.from('automation_rules').select('id').eq('org_id', b.orgA).ilike('name', `${m} B%`);
    expect(copies).toHaveLength(0);
    await regleBIntacte();
  });

  it('[F-033] publier la règle de B (unitaire et en lot) → refusé, B reste en brouillon', async () => {
    const un = await appel(jetonA, 'POST', `/automations/rules/${B.regle}/publication`, { actif: true });
    expect(un.statut).toBe(404);
    const lot = await appel(jetonA, 'POST', '/automations/rules/publication', { actif: true, ids: [B.regle] });
    expect(lot.statut).toBe(200);
    expect(lot.corps.resultats).toEqual([expect.objectContaining({ id: B.regle, ok: false })]);
    await regleBIntacte();
  });

  it('[F-034] « Tester » (aperçu) sur la règle de B → 404', async () => {
    const r = await appel(jetonA, 'POST', `/automations/rules/${B.regle}/apercu`, {});
    expect(r.statut).toBe(404);
  });

  it('[F-035] copier vers d’autres bureaux : la règle de A vers B → « sans_droit » ; la règle de B → 404', async () => {
    const vers = await appel(jetonA, 'POST', `/automations/rules/${A.regle}/copier-bureaux`, { org_ids: [b.orgB] });
    expect(vers.statut).toBe(200);
    const resultats = vers.corps.results;
    expect(resultats).toEqual([expect.objectContaining({ org_id: b.orgB, statut: 'sans_droit' })]);
    const { data: chezB } = await b.admin.from('automation_rules').select('id').eq('org_id', b.orgB).eq('name', `${m} A`);
    expect(chezB).toHaveLength(0);
    const depuisB = await appel(jetonA, 'POST', `/automations/rules/${B.regle}/copier-bureaux`, { org_ids: [b.orgA] });
    expect(depuisB.statut).toBe(404);
  });

  it('[F-036] dossiers de B : renommer / supprimer → 404, dossier intact', async () => {
    expect((await appel(jetonA, 'PATCH', `/automations/folders/${B.dossier}`, { name: 'PIRATE' })).statut).toBe(404);
    expect((await appel(jetonA, 'DELETE', `/automations/folders/${B.dossier}`)).statut).toBe(404);
    const { data } = await b.admin.from('automation_folders').select('name').eq('id', B.dossier).single();
    expect(data!.name).not.toBe('PIRATE');
  });

  it('[F-037] adresses d’appel de B : activer, régénérer, supprimer → 404, clé inchangée', async () => {
    expect((await appel(jetonA, 'PATCH', `/automations/webhooks/${B.hook}`, { enabled: true })).statut).toBe(404);
    const regen = await appel(jetonA, 'POST', `/automations/webhooks/${B.hook}/regenerer`);
    expect(regen.statut).toBe(404);
    expect(JSON.stringify(regen.corps)).not.toContain(B.cle);
    expect((await appel(jetonA, 'DELETE', `/automations/webhooks/${B.hook}`)).statut).toBe(404);
    const { data } = await b.admin.from('automation_webhooks').select('enabled, api_key, deleted_at').eq('id', B.hook).single();
    expect(data).toEqual({ enabled: false, api_key: B.cle, deleted_at: null });
    const liste = await appel(jetonA, 'GET', '/automations/webhooks');
    expect(JSON.stringify(liste.corps)).not.toContain(B.hook);
  });

  it('[F-038] « Tout arrêter » de A ne touche pas B (et B ne le lit pas)', async () => {
    const { data: avant } = await b.admin.from('company_settings').select('automations_paused').eq('org_id', b.orgB).single();
    const r = await appel(jetonA, 'POST', '/automations/pause', { paused: false });
    expect(r.statut).toBe(200);
    const { data: apres } = await b.admin.from('company_settings').select('automations_paused').eq('org_id', b.orgB).single();
    expect(apres).toEqual(avant);
  });
});

/** Ce qu'un événement de A sur un objet de B aurait laissé : envois, tâches, journaux. */
async function tracesChezA(depuis: string) {
  const envois = await envoisSimules(b.admin, b.orgA, depuis);
  const { data: taches } = await b.admin.from('tasks').select('id, title, linked_entity_id').eq('org_id', b.orgA).ilike('title', `%${m}%`).gte('created_at', depuis);
  const { data: journaux } = await b.admin.from('automation_execution_logs').select('id, automation_rule_id, entity_id, result_success, result_data')
    .eq('org_id', b.orgA).in('automation_rule_id', [A.regle, A.regleStatut, A.regleDevis, A.regleRdv]).gte('created_at', depuis);
  return { envois: envois.filter((e) => String(e.sujet ?? '').includes(m) || String(e.destinataire).includes(B.email)), taches: taches ?? [], journaux: journaux ?? [] };
}

describe('F — routes d’événements : les identifiants venus du navigateur (inv-3 §1.5)', () => {
  it('[F-040] lead-created avec le client de B → 404, aucune règle de A ne tourne sur lui', async () => {
    const depuis = new Date().toISOString();
    const r = await appel(jetonA, 'POST', '/automations/events/lead-created', { leadId: B.client });
    // Laisser au moteur le temps d'agir s'il avait été déclenché.
    const traces = await attendre(() => tracesChezA(depuis), (t) => t.journaux.length > 0, 4_000);
    expect(traces.envois, 'un courriel est parti vers le client de B').toHaveLength(0);
    expect(traces.taches.filter((t) => t.linked_entity_id === B.client), 'tâche de A liée au client de B').toHaveLength(0);
    expect(traces.journaux, `le moteur de A a tourné sur le client de B : ${JSON.stringify(traces.journaux)}`).toHaveLength(0);
    expect(r.statut, 'la route accepte un client d’un autre bureau').toBe(404);
  });

  it('[F-041] lead-status-changed avec le client de B → 404, rien ne tourne', async () => {
    const depuis = new Date().toISOString();
    const r = await appel(jetonA, 'POST', '/automations/events/lead-status-changed', { leadId: B.client, oldStatus: 'new', newStatus: 'won' });
    const traces = await attendre(() => tracesChezA(depuis), (t) => t.journaux.length > 0, 4_000);
    expect(traces.journaux, `le moteur de A a tourné sur le client de B : ${JSON.stringify(traces.journaux)}`).toHaveLength(0);
    expect(r.statut).toBe(404);
  });

  it('[F-042] quote-sent avec le devis de B → 404, rien ne tourne', async () => {
    const depuis = new Date().toISOString();
    const r = await appel(jetonA, 'POST', '/automations/events/quote-sent', { quoteId: B.devis, channel: 'email' });
    const traces = await attendre(() => tracesChezA(depuis), (t) => t.journaux.length > 0, 4_000);
    expect(traces.journaux, `le moteur de A a tourné sur le devis de B : ${JSON.stringify(traces.journaux)}`).toHaveLength(0);
    expect(r.statut).toBe(404);
  });

  it('[F-043] appointment-rescheduled avec le rendez-vous de B → 404, le rappel de B reste prévu', async () => {
    const depuis = new Date().toISOString();
    const r = await appel(jetonA, 'POST', '/automations/events/appointment-rescheduled', { eventId: B.rdv, jobId: B.job, clientId: B.client, startTime: new Date().toISOString() });
    const traces = await attendre(() => tracesChezA(depuis), (t) => t.journaux.length > 0, 4_000);
    const { data: tache } = await b.admin.from('automation_scheduled_tasks').select('status').eq('id', B.tache).single();
    expect(tache!.status, 'A a annulé le rappel de B').toBe('pending');
    expect(traces.journaux, `le moteur de A a tourné sur le rendez-vous de B : ${JSON.stringify(traces.journaux)}`).toHaveLength(0);
    expect(r.statut).toBe(404);
  });

  it('[F-044] client-tagged, task-completed, job-completed avec les objets de B → 404', async () => {
    await b.admin.from('client_tags').upsert({ client_id: B.client, tag: 'vip-b' }, { onConflict: 'client_id,tag', ignoreDuplicates: true });
    nettoyer.push(() => b.admin.from('client_tags').delete().eq('client_id', B.client));
    expect((await appel(jetonA, 'POST', '/automations/events/client-tagged', { clientId: B.client, tag: 'vip-b' })).statut).toBe(404);
    expect((await appel(jetonA, 'POST', '/automations/events/job-completed', { jobId: B.job })).statut).toBe(404);
    const { data: tacheFaiteB } = await b.admin.from('tasks').insert({
      org_id: b.orgB, created_by: b.users.proprioB, title: `Tâche faite B ${m}`, status: 'done', linked_entity_type: 'client', linked_entity_id: B.client,
    }).select('id').single();
    nettoyer.push(() => b.admin.from('tasks').delete().eq('id', tacheFaiteB!.id));
    expect((await appel(jetonA, 'POST', '/automations/events/task-completed', { taskId: tacheFaiteB!.id })).statut).toBe(404);
  });
});

describe('F — RBAC : le technicien de A (routes)', () => {
  it('[F-050] ne liste pas les automatisations (403 automations.read)', async () => {
    const r = await appel(jetonT, 'GET', '/automations/rules');
    expect(r.statut).toBe(403);
  });

  it('[F-051] ne crée, ne modifie, ne publie, ne duplique ni ne supprime une automatisation (403)', async () => {
    const creer = await appel(jetonT, 'POST', '/automations/rules', {
      name: `${m} tech`, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, is_active: false,
      actions: [{ type: 'create_task', config: { title: 'tech' } }],
    });
    expect(creer.statut).toBe(403);
    expect((await appel(jetonT, 'PATCH', `/automations/rules/${A.regle}`, { name: 'tech' })).statut).toBe(403);
    expect((await appel(jetonT, 'POST', `/automations/rules/${A.regle}/publication`, { actif: false })).statut).toBe(403);
    expect((await appel(jetonT, 'POST', '/automations/rules/publication', { actif: false, ids: [A.regle] })).statut).toBe(403);
    expect((await appel(jetonT, 'POST', `/automations/rules/${A.regle}/duplicate`)).statut).toBe(403);
    expect((await appel(jetonT, 'DELETE', `/automations/rules/${A.regle}`)).statut).toBe(403);
    expect((await appel(jetonT, 'POST', '/automations/templates/utiliser', { templateId: 'x' })).statut).toBe(403);
    expect((await appel(jetonT, 'POST', '/automations/pause', { paused: true })).statut).toBe(403);
    expect((await appel(jetonT, 'POST', '/automations/webhooks', { name: 'tech' })).statut).toBe(403);
    const { data } = await b.admin.from('automation_rules').select('name, is_active, deleted_at').eq('id', A.regle).single();
    expect(data).toEqual({ name: `${m} A`, is_active: true, deleted_at: null });
    const { data: creees } = await b.admin.from('automation_rules').select('id').eq('org_id', b.orgA).eq('name', `${m} tech`);
    expect(creees).toHaveLength(0);
  });

  it('[F-052] ne déclenche pas les événements réservés à automations.update (lead-created, quote-sent)', async () => {
    const { data: leadA } = await b.admin.from('clients').insert({
      org_id: b.orgA, created_by: b.users.proprioA, first_name: 'Tech', last_name: m, status: 'lead', email: `tech-${Date.now()}@lume-qa.test`,
    }).select('id').single();
    nettoyer.push(() => b.admin.from('clients').delete().eq('id', leadA!.id));
    expect((await appel(jetonT, 'POST', '/automations/events/lead-created', { leadId: leadA!.id })).statut).toBe(403);
    expect((await appel(jetonT, 'POST', '/automations/events/quote-sent', { quoteId: randomUUID() })).statut).toBe(403);
  });

  it('[F-053] témoin : le propriétaire de B, dans son bureau, garde l’accès à sa propre règle', async () => {
    const r = await appel(jetonB, 'GET', `/automations/editeur?rule_id=${B.regle}`);
    expect(r.statut).toBe(200);
    expect(r.corps.rule?.id).toBe(B.regle);
  });
});
