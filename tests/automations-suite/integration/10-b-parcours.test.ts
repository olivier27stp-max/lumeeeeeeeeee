/**
 * [B] Parcours multi-étapes (`steps`) et délais : ordre d'exécution, dates
 * calculées (`execute_at`), les DEUX branches d'un « si » jugé sur l'état
 * ACTUEL, arrêt, attente d'une réponse (réveil par un vrai texto entrant),
 * attente « avant la date », ré-entrée, sortie de parcours, arrêt sur
 * réponse, règle repassée en brouillon.
 *
 * Le temps avance comme en production : on ramène `execute_at` à maintenant
 * puis on fait passer la file planifiée du bureau (`traiterFile`).
 *
 * Matrice : tests/automations-suite/matrice/B.md (B-300 à B-399).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { marque, attendre, traiterFile } from '../harnais/moteur';
import {
  preparerBureau, apiEnMemoire, creerRegle, supprimerRegles, tachesTitrees, tachesPlanifiees, journaux,
  traiterBase, creerClient, creerJob, creerFacture, drapeau, ok, smsEntrant, reserverTelephone, type Api, type Bureau,
} from './10-b-outils';

process.env.TWILIO_AUTH_TOKEN = 'qa_jeton_twilio_test_automatisations';
process.env.TWILIO_WEBHOOK_BASE_URL = 'https://twilio.lume-qa.test';
const NUMERO_BUREAU = '+15555550199';

let b: Bureau & { fuseau: string };
let api: Api;
const regles: string[] = [];
const JOUR = 86_400;

beforeAll(async () => {
  b = await preparerBureau();
  await ok(b.admin.from('communication_channels').update({ phone_number: NUMERO_BUREAU }).eq('org_id', b.orgA).eq('channel_type', 'sms'), 'numéro du bureau');
  const [notes, regles_, messages] = await Promise.all([
    import('../../../server/routes/activity-notes'),
    import('../../../server/routes/automation-rules'),
    import('../../../server/routes/messages'),
  ]);
  api = await apiEnMemoire(b, [{ routeur: notes.default }, { routeur: regles_.default }, { routeur: messages.default }]);
});
afterEach(async () => { await supprimerRegles(b.admin, regles.splice(0)); });
afterAll(async () => {
  await supprimerRegles(b.admin, regles);
  await api?.fermer();
});

const tache = (id: string, titre: string, suivant: string | null = null) => ({ id, type: 'action', action: { type: 'create_task', config: { title: titre } }, suivant });

async function parcours(nom: string, declencheur: string, steps: unknown[], extra: { settings?: Record<string, unknown>; conditions?: Record<string, unknown> } = {}) {
  const actions = (steps as Array<{ type: string; action?: { type: string; config: Record<string, unknown> } }>)
    .filter((s) => s.type === 'action').map((s) => s.action!);
  const id = await creerRegle(api, { nom, declencheur, steps, actions, ...extra });
  regles.push(id);
  return id;
}

async function noter(clientId: string, texte = 'Note') {
  const r = await api.appeler('POST', '/api/activity-notes', { entityType: 'client', entityId: clientId, body: texte });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
}

/** Les tâches planifiées de la règle, une fois que `n` au moins existent. */
async function file(ruleId: string, n = 1) {
  return attendre(() => tachesPlanifiees(b.admin, ruleId), (t) => t.length >= n, 20_000);
}

/** Avance le temps : la tâche est due maintenant, puis la file passe. */
async function avancer(tacheId: string) {
  await ok(b.admin.from('automation_scheduled_tasks').update({ execute_at: new Date(Date.now() - 1000).toISOString() }).eq('id', tacheId), 'avancer');
  await traiterFile(b.admin, b.orgA);
}

const proche = (iso: string, attenduMs: number, toleranceMs = 120_000) => Math.abs(Date.parse(iso) - attenduMs) < toleranceMs;

describe('[B] parcours : ordre, délais, branches', () => {
  it('[B-300] action → attendre 1 jour → action : 1re étape en file (pas en direct), attente absorbée, 2e étape datée à +1 j, exécutée quand elle est due', async () => {
    const m = marque('B-300');
    const client = await creerClient(b, m);
    const id = await parcours(m, 'note.added', [
      tache('a1', `${m} étape 1`, 'w1'),
      { id: 'w1', type: 'attendre', delai_secondes: JOUR, suivant: 'a2' },
      tache('a2', `${m} étape 2`),
    ]);
    await noter(client.id);
    const [t1] = await file(id);
    expect(t1).toMatchObject({ status: 'pending', step_id: 'a1', entity_type: 'client', entity_id: client.id });
    expect(proche(t1.execute_at, Date.now())).toBe(true);
    expect(await tachesTitrees(b.admin, b.orgA, `${m} étape 1`)).toHaveLength(0); // rien d'immédiat
    await avancer(t1.id);
    expect(await tachesTitrees(b.admin, b.orgA, `${m} étape 1`)).toHaveLength(1);
    const taches = await file(id, 2);
    const t2 = taches.find((t) => t.step_id === 'a2')!;
    expect(taches.find((t) => t.id === t1.id)!.status).toBe('completed');
    expect(t2.status).toBe('pending');
    expect(proche(t2.execute_at, Date.now() + JOUR * 1000)).toBe(true);
    expect((t2.sequence_context as { franchies?: number }).franchies).toBe(2);
    expect(await tachesTitrees(b.admin, b.orgA, `${m} étape 2`)).toHaveLength(0);
    await avancer(t2.id);
    expect(await tachesTitrees(b.admin, b.orgA, `${m} étape 2`)).toHaveLength(1);
    const fin = await tachesPlanifiees(b.admin, id);
    expect(fin.map((t) => [t.step_id, t.status])).toEqual([['a1', 'completed'], ['a2', 'completed']]);
    expect((await journaux(b.admin, id)).map((l) => l.result_success)).toEqual([true, true]);
  });

  it('[B-301] si / alors : condition vraie sur l’état ACTUEL → branche « alors » seulement', async () => {
    const m = marque('B-301');
    const client = await creerClient(b, m);
    const id = await parcours(m, 'note.added', [
      { id: 's1', type: 'si', conditions: { statut: 'active' }, alors: 'oui', sinon: 'non' },
      tache('oui', `${m} alors`), tache('non', `${m} sinon`),
    ]);
    await noter(client.id);
    const [si] = await file(id);
    expect(si.step_id).toBe('s1');
    await avancer(si.id);
    const [suite] = (await file(id, 2)).filter((t) => t.step_id !== 's1');
    expect(suite.step_id).toBe('oui');
    await avancer(suite.id);
    expect(await tachesTitrees(b.admin, b.orgA, `${m} alors`)).toHaveLength(1);
    expect(await tachesTitrees(b.admin, b.orgA, `${m} sinon`)).toHaveLength(0);
  });

  it('[B-302] si / sinon : la fiche a changé APRÈS le déclenchement → la branche « sinon » est suivie', async () => {
    const m = marque('B-302');
    const client = await creerClient(b, m);
    const id = await parcours(m, 'note.added', [
      { id: 's1', type: 'si', conditions: { statut: 'active' }, alors: 'oui', sinon: 'non' },
      tache('oui', `${m} alors`), tache('non', `${m} sinon`),
    ]);
    await noter(client.id);
    const [si] = await file(id);
    await ok(b.admin.from('clients').update({ status: 'inactive' }).eq('id', client.id), 'fiche changée');
    await avancer(si.id);
    const [suite] = (await file(id, 2)).filter((t) => t.step_id !== 's1');
    expect(suite.step_id).toBe('non');
    await avancer(suite.id);
    expect(await tachesTitrees(b.admin, b.orgA, `${m} sinon`)).toHaveLength(1);
    expect(await tachesTitrees(b.admin, b.orgA, `${m} alors`)).toHaveLength(0);
  });

  it('[B-303] si sur un champ personnalisé (champs_perso) : branche selon la valeur en base', async () => {
    const m = marque('B-303');
    const client = await creerClient(b, m);
    const champs = await import('../../../server/routes/custom-fields');
    const api2 = await apiEnMemoire(b, [{ routeur: champs.default }]);
    try {
      const r = await api2.appeler('POST', '/api/custom-fields', { label: `Prioritaire ${Date.now().toString(36)}`, field_type: 'checkbox', object_type: 'client' });
      expect(r.status).toBe(201);
      const champ = r.json.field as { id: string };
      const id = await parcours(m, 'note.added', [
        { id: 's1', type: 'si', conditions: { champs_perso: [{ field_id: champ.id, op: 'is', value: true }] }, alors: 'oui', sinon: 'non' },
        tache('oui', `${m} alors`), tache('non', `${m} sinon`),
      ]);
      await noter(client.id);
      const [si] = await file(id);
      const w = await api2.appeler('PUT', `/api/custom-values/client/${client.id}`, { values: [{ field_id: champ.id, value: true }] });
      expect(w.status).toBe(200);
      await avancer(si.id);
      const [suite] = (await file(id, 2)).filter((t) => t.step_id !== 's1');
      expect(suite.step_id).toBe('oui');
    } finally {
      await api2.fermer();
    }
  });

  it('[B-304] arrêter : rien n’est planifié après l’étape « arrêter »', async () => {
    const m = marque('B-304');
    const client = await creerClient(b, m);
    const id = await parcours(m, 'note.added', [
      { id: 's1', type: 'si', conditions: { statut: 'active' }, alors: 'stop', sinon: 'a1' },
      { id: 'stop', type: 'arreter' },
      tache('a1', `${m} jamais`),
    ]);
    await noter(client.id);
    const [si] = await file(id);
    await avancer(si.id);
    await new Promise((r) => setTimeout(r, 800));
    const toutes = await tachesPlanifiees(b.admin, id);
    expect(toutes.map((t) => [t.step_id, t.status])).toEqual([['s1', 'completed']]);
    expect(await tachesTitrees(b.admin, b.orgA, `${m} jamais`)).toHaveLength(0);
  });
});

describe('[B] attentes « réponse » et « avant la date »', () => {
  it('[B-310] attendre la réponse (au plus 2 j) : échéance datée à +2 j ; un vrai texto entrant la réveille et la branche « réponse » est suivie', async () => {
    const m = marque('B-310');
    const tel = '+15555550197';
    await reserverTelephone(b, tel);
    const client = await creerClient(b, m, { phone: tel });
    const id = await parcours(m, 'note.added', [
      { id: 'w1', type: 'attendre', mode: 'reponse', delai_secondes: 2 * JOUR, si_reponse: 'rep', suivant: 'relance' },
      tache('rep', `${m} a répondu`), tache('relance', `${m} relance`),
    ]);
    await noter(client.id);
    const [w] = await file(id);
    expect(w.step_id).toBe('w1');
    expect(proche(w.execute_at, Date.now() + 2 * JOUR * 1000)).toBe(true);
    await new Promise((r) => setTimeout(r, 1100)); // la réponse doit être POSTÉRIEURE à la mise en attente
    const r = await smsEntrant(api, tel, NUMERO_BUREAU, `Oui ça marche ${m}`);
    expect(r.status).toBe(200);
    // Réveillée : l'échéance est ramenée à maintenant (sans avancer le temps nous-mêmes).
    const reveillee = await attendre(() => tachesPlanifiees(b.admin, id), (t) => Date.parse(t[0].execute_at) <= Date.now() + 5000, 15_000);
    expect(Date.parse(reveillee[0].execute_at)).toBeLessThanOrEqual(Date.now() + 5000);
    await traiterFile(b.admin, b.orgA);
    const suite = (await file(id, 2)).find((t) => t.step_id !== 'w1')!;
    expect(suite.step_id).toBe('rep');
    expect((await tachesPlanifiees(b.admin, id)).find((t) => t.step_id === 'w1')!.last_error).toBe('Le client a répondu : la suite « réponse » a été suivie.');
  });

  it('[B-311] attendre la réponse, sans réponse : à l’échéance, la relance (suivant) est planifiée', async () => {
    const m = marque('B-311');
    const client = await creerClient(b, m, { phone: '+15555550196' });
    const id = await parcours(m, 'note.added', [
      { id: 'w1', type: 'attendre', mode: 'reponse', delai_secondes: JOUR, si_reponse: 'rep', suivant: 'relance' },
      tache('rep', `${m} a répondu`), tache('relance', `${m} relance`),
    ]);
    await noter(client.id);
    const [w] = await file(id);
    await avancer(w.id);
    const suite = (await file(id, 2)).find((t) => t.step_id !== 'w1')!;
    expect(suite.step_id).toBe('relance');
    await avancer(suite.id);
    expect(await tachesTitrees(b.admin, b.orgA, `${m} relance`)).toHaveLength(1);
    expect(await tachesTitrees(b.admin, b.orgA, `${m} a répondu`)).toHaveLength(0);
  });

  async function visite(m: string, debut: Date) {
    const client = await creerClient(b, m);
    const job = await creerJob(b, m, client.id);
    return ok<{ id: string }>(b.admin.from('schedule_events').insert({
      org_id: b.orgA, job_id: job.id, title: `Visite ${m}`, status: 'scheduled', created_by: b.users.proprioA,
      start_at: debut.toISOString(), end_at: new Date(debut.getTime() + 3600_000).toISOString(),
    }).select('id').single(), 'visite');
  }

  it('[B-312] attendre « 1 jour avant » le rendez-vous : échéance = début − 24 h ; rendez-vous avancé → le rappel part', async () => {
    const m = marque('B-312');
    const id = await parcours(m, 'appointment.created', [
      { id: 'w1', type: 'attendre', delai_secondes: 0, mode: 'avant_date', secondes_avant: JOUR, suivant: 'rappel', si_depasse: null },
      tache('rappel', `${m} rappel`),
    ], { conditions: { title: `Visite ${m}` } });
    const debut = new Date(Date.now() + 3 * JOUR * 1000);
    const v = await visite(m, debut);
    await traiterBase(b);
    const [w] = await file(id);
    expect(w.step_id).toBe('w1');
    expect(proche(w.execute_at, debut.getTime() - JOUR * 1000)).toBe(true);
    // Le rendez-vous est avancé : « la veille » est maintenant (tolérance 30 min).
    await ok(b.admin.from('schedule_events').update({ start_at: new Date(Date.now() + JOUR * 1000 - 5 * 60_000).toISOString() }).eq('id', v.id), 'avancé');
    await avancer(w.id);
    const suite = (await file(id, 2)).find((t) => t.step_id === 'rappel')!;
    expect(suite).toBeTruthy();
    await avancer(suite.id);
    expect(await tachesTitrees(b.admin, b.orgA, `${m} rappel`)).toHaveLength(1);
  });

  it('[B-313] attendre « 1 jour avant », rendez-vous réservé pour dans 2 h : le moment est passé → branche si_depasse', async () => {
    const m = marque('B-313');
    const id = await parcours(m, 'appointment.created', [
      { id: 'w1', type: 'attendre', delai_secondes: 0, mode: 'avant_date', secondes_avant: JOUR, suivant: 'rappel', si_depasse: 'tard' },
      tache('rappel', `${m} rappel veille`), tache('tard', `${m} rappel tardif`),
    ], { conditions: { title: `Visite ${m}` } });
    await visite(m, new Date(Date.now() + 2 * 3600_000));
    await traiterBase(b);
    const [t] = await file(id);
    expect(t.step_id).toBe('tard');
    await avancer(t.id);
    expect(await tachesTitrees(b.admin, b.orgA, `${m} rappel tardif`)).toHaveLength(1);
    expect(await tachesTitrees(b.admin, b.orgA, `${m} rappel veille`)).toHaveLength(0);
  });

  it('[B-314] attendre « avant la date », rendez-vous annulé entre-temps : le parcours s’arrête', async () => {
    const m = marque('B-314');
    const id = await parcours(m, 'appointment.created', [
      { id: 'w1', type: 'attendre', delai_secondes: 0, mode: 'avant_date', secondes_avant: JOUR, suivant: 'rappel' },
      tache('rappel', `${m} rappel`),
    ], { conditions: { title: `Visite ${m}` } });
    const v = await visite(m, new Date(Date.now() + 3 * JOUR * 1000));
    await traiterBase(b);
    const [w] = await file(id);
    await ok(b.admin.from('schedule_events').update({ status: 'cancelled' }).eq('id', v.id), 'annulé');
    await avancer(w.id);
    const toutes = await tachesPlanifiees(b.admin, id);
    expect(toutes.map((t) => t.step_id)).toEqual(['w1']);
    expect(toutes[0].status).not.toBe('pending');
    expect(await tachesTitrees(b.admin, b.orgA, `${m} rappel`)).toHaveLength(0);
  });

  it('[B-315] délai négatif d’une règle simple (« 1 jour avant » le rendez-vous) : tâche datée début − 24 h', async () => {
    const m = marque('B-315');
    const id = await creerRegle(api, { nom: m, declencheur: 'appointment.created', delay_seconds: -JOUR, conditions: { title: `Visite ${m}` }, actions: [{ type: 'create_task', config: { title: m } }] });
    regles.push(id);
    const debut = new Date(Date.now() + 3 * JOUR * 1000);
    await visite(m, debut);
    await traiterBase(b);
    const [t] = await file(id);
    expect(t.status).toBe('pending');
    expect(proche(t.execute_at, debut.getTime() - JOUR * 1000)).toBe(true);
    expect((t.action_config as { type?: string }).type).toBe('create_task');
    await avancer(t.id);
    expect(await tachesTitrees(b.admin, b.orgA, m)).toHaveLength(1);
  });

  it('[B-316] délai positif d’une règle simple (+1 h) : tâche datée +1 h, exécutée quand elle est due', async () => {
    const m = marque('B-316');
    const client = await creerClient(b, m);
    const id = await creerRegle(api, { nom: m, declencheur: 'note.added', delay_seconds: 3600, actions: [{ type: 'create_task', config: { title: m } }] });
    regles.push(id);
    await noter(client.id);
    const [t] = await file(id);
    expect(proche(t.execute_at, Date.now() + 3600_000)).toBe(true);
    expect(await tachesTitrees(b.admin, b.orgA, m)).toHaveLength(0);
    await avancer(t.id);
    expect(await tachesTitrees(b.admin, b.orgA, m)).toHaveLength(1);
    expect((await tachesPlanifiees(b.admin, id))[0].status).toBe('completed');
  });
});

describe('[B] réglages : ré-entrée, arrêt sur réponse, sortie de parcours, brouillon', () => {
  const attente = (m: string) => [{ id: 'w1', type: 'attendre', delai_secondes: JOUR, suivant: 'a1' }, tache('a1', `${m} relance`)];

  it('[B-320] sans ré-entrée : un 2e déclenchement pendant le parcours ne crée pas de 2e passage', async () => {
    const m = marque('B-320');
    const client = await creerClient(b, m);
    const id = await parcours(m, 'note.added', attente(m));
    await noter(client.id, 'une');
    await file(id);
    await noter(client.id, 'deux');
    await new Promise((r) => setTimeout(r, 1500));
    expect(await tachesPlanifiees(b.admin, id)).toHaveLength(1);
  });

  it('[B-321] avec ré-entrée : chaque déclenchement ouvre son propre passage', async () => {
    const m = marque('B-321');
    const client = await creerClient(b, m);
    const id = await parcours(m, 'note.added', attente(m), { settings: { reentree: true } });
    await noter(client.id, 'une');
    await file(id);
    await noter(client.id, 'deux');
    const taches = await file(id, 2);
    expect(taches).toHaveLength(2);
    expect(new Set(taches.map((t) => (t.sequence_context as { passage?: string }).passage)).size).toBe(2);
  });

  it('[B-322] arrêt sur réponse : le client écrit pendant l’attente → le texto de relance est annulé (« le client a répondu »)', async () => {
    const m = marque('B-322');
    const tel = '+15555550195';
    await reserverTelephone(b, tel);
    const client = await creerClient(b, m, { phone: tel });
    const id = await parcours(m, 'note.added', [
      { id: 'w1', type: 'attendre', delai_secondes: JOUR, suivant: 's1' },
      { id: 's1', type: 'action', action: { type: 'send_sms', config: { body: `Relance ${m}` } }, suivant: null },
    ], { settings: { arret_sur_reponse: true } });
    await noter(client.id);
    const [t] = await file(id);
    await new Promise((r) => setTimeout(r, 1100));
    expect((await smsEntrant(api, tel, NUMERO_BUREAU, 'Je vous rappelle')).status).toBe(200);
    await attendre(() => b.admin.from('messages').select('id').eq('org_id', b.orgA).eq('direction', 'inbound').eq('client_id', client.id).then((r) => r.data ?? []), (x) => x.length > 0);
    await avancer(t.id);
    const [fin] = await tachesPlanifiees(b.admin, id);
    expect(fin).toMatchObject({ status: 'cancelled', last_error: 'Annulée : le client a répondu.' });
    expect(await journaux(b.admin, id)).toHaveLength(0);
  });

  it('[B-323] sortie de parcours (drapeau auto_sortie_parcours) : facture payée pendant l’attente → relance annulée avec son motif', async () => {
    const m = marque('B-323');
    await drapeau(b, 'auto_sortie_parcours', true);
    const client = await creerClient(b, m);
    const f = await creerFacture(b, m, client.id);
    const id = await parcours(m, 'invoice.sent', attente(m), { conditions: { client_id: client.id } });
    const now = new Date().toISOString();
    await ok(b.admin.from('invoices').update({ status: 'sent', issued_at: now, sent_at: now }).eq('id', f.id), 'envoi');
    await traiterBase(b);
    const [t] = await file(id);
    await ok(b.admin.from('payments').insert({
      org_id: b.orgA, invoice_id: f.id, client_id: client.id, provider: 'manual', status: 'succeeded', amount_cents: f.total_cents,
      currency: 'CAD', payment_date: now, created_by: b.users.proprioA,
    }), 'paiement');
    const { data: fac } = await b.admin.from('invoices').select('status').eq('id', f.id).single();
    expect(fac!.status).toBe('paid');
    await avancer(t.id);
    const [fin] = await tachesPlanifiees(b.admin, id);
    expect(fin.status).toBe('cancelled');
    expect(String(fin.last_error)).not.toBe('');
    expect(await tachesTitrees(b.admin, b.orgA, `${m} relance`)).toHaveLength(0);
    await drapeau(b, 'auto_sortie_parcours', false);
  });

  it('[B-324] règle repassée en brouillon avant l’échéance : la tâche prévue est annulée, rien ne part', async () => {
    const m = marque('B-324');
    const client = await creerClient(b, m);
    const id = await parcours(m, 'note.added', attente(m));
    await noter(client.id);
    const [t] = await file(id);
    await ok(b.admin.from('automation_rules').update({ is_active: false }).eq('id', id), 'brouillon');
    await avancer(t.id);
    const [fin] = await tachesPlanifiees(b.admin, id);
    expect(fin).toMatchObject({ status: 'cancelled', last_error: 'Automatisation en brouillon : envoi annulé.' });
    expect(await tachesTitrees(b.admin, b.orgA, `${m} relance`)).toHaveLength(0);
  });
});
