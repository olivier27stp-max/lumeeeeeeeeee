/**
 * La preuve dont dépend l'UNIFICATION des règles (mission finale, P6) :
 * convertir une règle « à plat » (`actions` + `delay_seconds`, `steps` nul)
 * en parcours ne doit rien changer pour un client.
 *
 * Mesuré en prod par le coordinateur (lecture seule) : 547 règles sur 595
 * sont à plat, dont 386 publiées ; une entreprise réelle a 110 envois EN
 * ATTENTE attachés à des règles à plat. La conversion écrit dans `steps` la
 * projection de la règle (`projeterFormatOrigine`, src/lib/sequenceTypes.ts :
 * étapes `origine-attente`, `origine-0`, `origine-1`…) et garde `actions`
 * identique au parcours. `delay_seconds` n'est pas touché.
 *
 * Cinq cas, sur le VRAI moteur et la pile locale :
 *   1. un envoi en attente né AVANT la conversion (délai de 2 jours) ;
 *   2. la même chose pour un rappel « la veille » d'un rendez-vous (délai négatif) ;
 *   3. une règle à trois actions (texto, courriel, journal interne) ;
 *   4. un NOUVEL événement après la conversion, comparé à la même règle
 *      restée à plat dans le second bureau — mêmes envois, mêmes moments ;
 *   5. la clé d'unicité : pas de doublon au passage.
 *
 * Bureau A « (b) » : la règle convertie. Bureau B « (b) » : le témoin à plat.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { attendre, marque, traiterFile } from '../../automations-suite/harnais/moteur';
import { preparerBureau, ok, creerClient, creerJob, type Bureau } from '../../automations-suite/integration/10-b-outils';
import { regle, courriel, texto, emettre, attendreTaches, tachesDe, journauxDe, envoisAvec, type Journal } from './outils-b';
import { projeterFormatOrigine } from '../../../src/lib/sequenceTypes';

let b: Bureau & { fuseau: string };
const UN_JOUR = 86_400;
const TOUT_LE_JOUR = { fenetre: { debut: 0, fin: 24 } };
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reglesB: string[] = [];
const clientsB: string[] = [];

beforeAll(async () => { b = await preparerBureau(); }, 120_000);
afterAll(async () => {
  if (reglesB.length) await b.admin.from('automation_rules').delete().in('id', reglesB);
  if (clientsB.length) await b.admin.from('clients').delete().in('id', clientsB);
});

/** La conversion, telle que la migration d'unification la fera : `steps` = la projection ; `actions` et `delay_seconds` inchangés. */
async function convertir(id: string) {
  const r = await ok<{ actions: unknown; delay_seconds: number }>(b.admin.from('automation_rules').select('actions, delay_seconds').eq('id', id).single(), 'règle');
  const steps = projeterFormatOrigine(r);
  await ok(b.admin.from('automation_rules').update({ steps }).eq('id', id).select('id'), 'conversion');
  return steps;
}

/** Les lignes d'ACTION du journal (pas les traces « conditions »). */
const actionsDe = (lignes: Journal[]) => lignes.filter((l) => l.action_type !== 'conditions');

/**
 * L'échéance arrive : les tâches en attente de la règle sont dues, et la file du bureau passe — une passe = un tick
 * du planificateur (5 minutes en production). Renvoie le nombre de passes qu'il a fallu pour que la règle ait
 * `attendues` lignes d'action au journal (au plus `max`).
 */
async function echeance(org: string, id: string, attendues: number, max = 6): Promise<number> {
  const lire = async () => (await b.admin.from('automation_execution_logs').select('action_type, result_error').eq('automation_rule_id', id)).data ?? [];
  const fini = async () => (await lire()).filter((l) => l.action_type !== 'conditions' && !/^en cours$|attente/.test(String(l.result_error ?? ''))).length >= attendues;
  let passes = 0;
  while (passes < max && !(await fini())) {
    // Seules les tâches DÉJÀ prévues pour « maintenant ou avant » passent ; le délai de la règle, lui, est avancé une fois.
    if (passes === 0) {
      await ok(b.admin.from('automation_scheduled_tasks').update({ execute_at: new Date(Date.now() - 1_000).toISOString() })
        .eq('automation_rule_id', id).eq('status', 'pending').select('id'), 'rendre dues');
    }
    await traiterFile(b.admin, org);
    passes++;
    await pause(500);
  }
  return passes;
}

const texteDe = (e: { sujet: string | null; corps: string | null }) => `${e.sujet ?? ''} ${e.corps ?? ''}`;

describe('conversion d’une règle à plat — un envoi en ATTENTE, né avant la conversion', () => {
  it('[M30-01] délai de 2 jours : après la conversion, l’envoi part à la MÊME heure, avec le MÊME texte, UNE fois ; rien n’est annulé, aucune seconde tâche', async () => {
    const m = marque('M30-01');
    const c = await creerClient(b, m);
    const id = await regle(b, m, { trigger_event: 'note.added', delay_seconds: 2 * UN_JOUR, actions: [courriel(m, 'Relance prévue')], settings: TOUT_LE_JOUR });
    await emettre(b, 'note.added', 'client', c.id);
    const [avant] = await attendreTaches(b, id, 1);
    expect(Math.abs(Date.parse(avant.execute_at) - (Date.now() + 2 * UN_JOUR * 1000))).toBeLessThan(60_000);

    const steps = await convertir(id);
    expect(steps.map((e) => e.id)).toEqual(['origine-attente', 'origine-0']);

    // La conversion ne touche pas la tâche : même ligne, même échéance.
    const [apres] = await tachesDe(b, id);
    expect([apres.id, apres.status, apres.execute_at]).toEqual([avant.id, 'pending', avant.execute_at]);

    await echeance(b.orgA, id, 1);
    const taches = await tachesDe(b, id);
    const journal = await journauxDe(b, id);
    const envois = await envoisAvec(b, m);
    const etat = JSON.stringify({ taches: taches.map((t) => [t.status, t.step_id, t.last_error]), journal: journal.map((j) => [j.action_type, j.result_success, j.result_data?.saute_code ?? null]) });
    expect(journal.filter((j) => j.result_data?.saute_code === 'etape_retiree'), `rien n’est annulé « étape retirée » — ${etat}`).toEqual([]);
    expect(envois.map(texteDe), etat).toEqual([expect.stringContaining('Relance prévue')]);
    expect(taches.map((t) => t.status), `une seule tâche, terminée — ${etat}`).toEqual(['completed']);
    expect(actionsDe(journal).map((j) => [j.action_type, j.result_success])).toEqual([['send_email', true]]);
  }, 180_000);

  it('[M30-02] rappel « la veille » d’un rendez-vous (délai négatif → attente « avant la date ») : même heure, même texte, une fois', async () => {
    const m = marque('M30-02');
    const c = await creerClient(b, m, { phone: '+12045550181' });
    const j = await creerJob(b, m, c.id);
    const debut = new Date(Date.now() + 6 * UN_JOUR * 1000);
    const v = await ok<{ id: string }>(b.admin.from('schedule_events').insert({
      org_id: b.orgA, job_id: j.id, title: `Visite ${m}`, status: 'scheduled', created_by: b.users.proprioA,
      start_at: debut.toISOString(), end_at: new Date(debut.getTime() + 3600_000).toISOString(),
    }).select('id').single(), 'visite');
    const id = await regle(b, m, { trigger_event: 'appointment.created', delay_seconds: -UN_JOUR, actions: [courriel(m, 'Rappel : votre rendez-vous est demain')], settings: TOUT_LE_JOUR });
    await emettre(b, 'appointment.created', 'schedule_event', v.id, { job_id: j.id, client_id: c.id, start_time: debut.toISOString() });
    const [avant] = await attendreTaches(b, id, 1);
    expect(Math.abs(Date.parse(avant.execute_at) - (debut.getTime() - UN_JOUR * 1000))).toBeLessThan(2 * 3600_000);

    const steps = await convertir(id);
    expect(steps[0]).toMatchObject({ id: 'origine-attente', type: 'attendre', mode: 'avant_date', secondes_avant: UN_JOUR });
    const [apres] = await tachesDe(b, id);
    expect([apres.id, apres.status, apres.execute_at]).toEqual([avant.id, 'pending', avant.execute_at]);

    // La veille du rendez-vous : on amène la VISITE à demain (le rappel est alors dû), sans toucher la tâche autrement.
    const demain = new Date(Date.now() + UN_JOUR * 1000 - 60_000);
    await ok(b.admin.from('schedule_events').update({ start_at: demain.toISOString(), end_at: new Date(demain.getTime() + 3600_000).toISOString() }).eq('id', v.id).select('id'), 'la veille');
    await ok(b.admin.from('automation_scheduled_tasks').update({
      execute_at: new Date(Date.now() - 1_000).toISOString(),
      action_config: { ...apres.action_config, event_metadata: { ...(apres.action_config.event_metadata ?? {}), start_time: demain.toISOString() } },
    }).eq('id', apres.id).select('id'), 'échéance');
    await traiterFile(b.admin, b.orgA);
    await pause(500);
    await traiterFile(b.admin, b.orgA);

    const taches = await tachesDe(b, id);
    const journal = await journauxDe(b, id);
    const etat = JSON.stringify({ taches: taches.map((t) => [t.status, t.step_id, t.last_error]), journal: journal.map((x) => [x.action_type, x.result_success, x.result_data?.saute_code ?? null]) });
    expect(journal.filter((x) => x.result_data?.saute_code === 'etape_retiree'), `rien n’est annulé « étape retirée » — ${etat}`).toEqual([]);
    expect((await envoisAvec(b, m)).map(texteDe), etat).toEqual([expect.stringContaining('Rappel : votre rendez-vous est demain')]);
    expect(taches.map((t) => t.status), etat).toEqual(['completed']);
  }, 180_000);

  it('[M30-03] trois actions (texto, courriel, journal interne) en attente : les trois partent, dans l’ordre, une fois chacune', async () => {
    const m = marque('M30-03');
    const c = await creerClient(b, m, { phone: '+12045550183' });
    const actions = [texto(m, 'Texto de suivi'), courriel(m, 'Courriel de suivi'), { type: 'log_activity', config: { event_type: 'suivi_automatique', metadata: { marque: m } } }];
    const id = await regle(b, m, { trigger_event: 'note.added', delay_seconds: UN_JOUR, actions, settings: TOUT_LE_JOUR });
    await emettre(b, 'note.added', 'client', c.id);
    const avant = await attendreTaches(b, id, 3);
    expect(new Set(avant.map((t) => t.execute_at)).size, 'les trois envois sont prévus au même instant').toBe(1);

    const steps = await convertir(id);
    expect(steps.map((e) => e.id)).toEqual(['origine-attente', 'origine-0', 'origine-1', 'origine-2']);
    expect((await tachesDe(b, id)).map((t) => [t.id, t.status, t.execute_at])).toEqual(avant.map((t) => [t.id, 'pending', t.execute_at]));

    const passes = await echeance(b.orgA, id, 3);
    const taches = await tachesDe(b, id);
    const journal = await journauxDe(b, id);
    const etat = JSON.stringify({ passes, taches: taches.map((t) => [t.status, t.step_id, t.last_error]), journal: journal.map((x) => [x.action_type, x.result_success, x.result_data?.saute_code ?? null]) });
    expect(journal.filter((x) => x.result_data?.saute_code === 'etape_retiree'), `rien n’est annulé « étape retirée » — ${etat}`).toEqual([]);
    expect(actionsDe(journal).map((x) => [x.action_type, x.result_success]), etat).toEqual([['send_sms', true], ['send_email', true], ['log_activity', true]]);
    const envois = await envoisAvec(b, m);
    expect(envois.map((e) => e.canal).sort(), etat).toEqual(['courriel', 'sms']);
    expect(taches.map((t) => t.status), `trois tâches, terminées, aucune de plus — ${etat}`).toEqual(['completed', 'completed', 'completed']);
    expect(passes, 'les trois partent au même passage de la file, comme avant la conversion').toBe(1);
    const trace = await ok<Array<{ id: string }>>(b.admin.from('activity_log').select('id').eq('org_id', b.orgA).eq('entity_id', c.id).eq('event_type', 'suivi_automatique'), 'journal interne');
    expect(trace, 'le journal interne est écrit une fois').toHaveLength(1);
  }, 180_000);
});

describe('conversion d’une règle à plat — un NOUVEL événement après la conversion, comparé au témoin resté à plat', () => {
  /** La même règle dans le bureau B (témoin), jamais convertie. */
  async function temoin(m: string, champs: Record<string, unknown>) {
    const r = await ok<{ id: string }>(b.admin.from('automation_rules').insert({
      org_id: b.orgB, name: `${m} témoin`, trigger_event: 'note.added', conditions: {}, is_active: true, is_preset: false, ...champs,
    }).select('id').single(), 'règle témoin');
    reglesB.push(r.id);
    const c = await ok<{ id: string }>(b.admin.from('clients').insert({
      org_id: b.orgB, created_by: b.users.proprioB, first_name: 'Témoin', last_name: m, status: 'active',
      email: `m30-${Date.now().toString(36)}@lume-qa.test`, email_consent_at: new Date().toISOString(),
    }).select('id').single(), 'client témoin');
    clientsB.push(c.id);
    return { regleId: r.id, clientId: c.id };
  }
  const tachesTemoin = (id: string) => ok<Array<{ status: string; step_id: string | null; execute_at: string }>>(
    b.admin.from('automation_scheduled_tasks').select('status, step_id, execute_at').eq('automation_rule_id', id).order('created_at'), 'tâches témoin');
  const journalTemoin = async (id: string) => actionsDe(await ok<Journal[]>(b.admin.from('automation_execution_logs')
    .select('id, trigger_event, entity_type, entity_id, action_type, result_success, result_data, result_error, scheduled_task_id, created_at')
    .eq('automation_rule_id', id).order('created_at'), 'journal témoin'));
  async function emettreTemoin(clientId: string) {
    await b.eventBus.emit('note.added' as never, { orgId: b.orgB, entityType: 'client', entityId: clientId, metadata: {} } as never);
    await attendre(async () => ok<Array<{ processed_at: string | null }>>(
      b.admin.from('domain_events').select('processed_at').eq('org_id', b.orgB).eq('entity_id', clientId).eq('type', 'note.added'), 'outbox témoin'),
    (l) => l.length > 0 && l.every((x) => x.processed_at), 30_000);
  }
  // Trois actions qui n'attendent pas la fenêtre d'envoi et ne dépendent ni d'un numéro ni d'un consentement.
  const troisActions = (m: string) => [
    courriel(m, 'Premier courriel'),
    { type: 'create_notification', config: { title: `Suivi ${m}`, body: 'À rappeler' } },
    { type: 'log_activity', config: { event_type: 'suivi_automatique', metadata: { marque: m } } },
  ];

  it('[M30-04a] délai de 2 jours : même échéance que le témoin ; à l’échéance, les mêmes actions, dans le même ordre, au même passage de la file', async () => {
    const m = marque('M30-04a');
    const c = await creerClient(b, m);
    const id = await regle(b, m, { trigger_event: 'note.added', delay_seconds: 2 * UN_JOUR, actions: troisActions(m), settings: TOUT_LE_JOUR });
    const t = await temoin(m, { delay_seconds: 2 * UN_JOUR, actions: troisActions(m), settings: TOUT_LE_JOUR });
    await convertir(id);

    const depart = Date.now();
    await emettre(b, 'note.added', 'client', c.id);
    await emettreTemoin(t.clientId);
    const converti = await attendreTaches(b, id, 1);
    const aPlat = await attendre(() => tachesTemoin(t.regleId), (l) => l.length >= 3, 20_000);
    const premiere = (l: Array<{ execute_at: string }>) => Math.min(...l.map((x) => Date.parse(x.execute_at)));
    // Même moment prévu : dans 2 jours, des deux côtés.
    expect(Math.abs(premiere(converti) - premiere(aPlat)), 'échéance du premier envoi : convertie contre à plat').toBeLessThan(30_000);
    expect(Math.abs(premiere(converti) - (depart + 2 * UN_JOUR * 1000))).toBeLessThan(60_000);

    const passesConverti = await echeance(b.orgA, id, 3);
    const passesTemoin = await echeance(b.orgB, t.regleId, 3);
    const jc = actionsDe(await journauxDe(b, id));
    const jt = await journalTemoin(t.regleId);
    const mesure = JSON.stringify({ passes_de_la_file: { convertie: passesConverti, a_plat: passesTemoin }, convertie: jc.map((x) => [x.action_type, x.result_success]), a_plat: jt.map((x) => [x.action_type, x.result_success]) });
    expect(jc.map((x) => [x.action_type, x.result_success]), mesure).toEqual(jt.map((x) => [x.action_type, x.result_success]));
    expect(jt.map((x) => x.action_type), mesure).toEqual(['send_email', 'create_notification', 'log_activity']);
    // « Aux mêmes moments » : une passe de la file = un tick du planificateur (5 minutes en production).
    expect(passesConverti, `nombre de passes de la file pour tout envoyer — ${mesure}`).toBe(passesTemoin);
  }, 240_000);

  it('[M30-04b] SANS délai : la règle à plat agit à l’événement ; la règle convertie agit-elle au même moment, sans attendre un passage de la file ?', async () => {
    const m = marque('M30-04b');
    const c = await creerClient(b, m);
    const id = await regle(b, m, { trigger_event: 'note.added', delay_seconds: 0, actions: troisActions(m), settings: TOUT_LE_JOUR });
    const t = await temoin(m, { delay_seconds: 0, actions: troisActions(m), settings: TOUT_LE_JOUR });
    const steps = await convertir(id);
    expect(steps.map((e) => e.id)).toEqual(['origine-0', 'origine-1', 'origine-2']);

    await emettre(b, 'note.added', 'client', c.id);
    await emettreTemoin(t.clientId);
    // AUCUNE passe de la file : ce qui est fait 6 secondes après l'événement.
    await pause(6_000);
    const jt = await journalTemoin(t.regleId);
    const jc = actionsDe(await journauxDe(b, id));
    const enFile = (await tachesDe(b, id)).map((x) => [x.status, x.step_id]);
    const mesure = JSON.stringify({ six_secondes_apres_l_evenement: { a_plat: jt.map((x) => x.action_type), convertie: jc.map((x) => x.action_type), convertie_en_file: enFile } });
    expect(jt.map((x) => x.action_type), mesure).toEqual(['send_email', 'create_notification', 'log_activity']);
    expect(jc.map((x) => x.action_type), `la règle convertie n’a pas agi à l’événement : elle attend le prochain passage de la file — ${mesure}`).toEqual(jt.map((x) => x.action_type));
  }, 240_000);
});

describe('conversion d’une règle à plat — la clé d’unicité', () => {
  it('[M30-05] un client déjà en attente dans la règle à plat n’est pas repris par la règle convertie : pas de doublon au passage', async () => {
    const m = marque('M30-05');
    const c = await creerClient(b, m);
    const id = await regle(b, m, { trigger_event: 'note.added', delay_seconds: 2 * UN_JOUR, actions: [courriel(m, 'Relance unique')], settings: TOUT_LE_JOUR });
    await emettre(b, 'note.added', 'client', c.id);
    await attendreTaches(b, id, 1);
    // Témoin, AVANT la conversion : le même déclencheur, pour le même client, ne planifie pas une 2e relance.
    await emettre(b, 'note.added', 'client', c.id);
    await pause(1_500);
    expect(await tachesDe(b, id), 'à plat : une seule relance en attente').toHaveLength(1);

    await convertir(id);
    // APRÈS la conversion : même déclencheur, même client.
    await emettre(b, 'note.added', 'client', c.id);
    await pause(1_500);
    const enAttente = await tachesDe(b, id);
    expect(enAttente.map((t) => [t.status, t.step_id]), 'après la conversion : toujours une seule relance en attente').toEqual([['pending', null]]);

    await echeance(b.orgA, id, 1);
    await pause(1_000);
    await traiterFile(b.admin, b.orgA);
    const envois = await envoisAvec(b, m);
    const taches = await tachesDe(b, id);
    expect(envois.map(texteDe), JSON.stringify(taches.map((t) => [t.status, t.step_id, t.last_error]))).toEqual([expect.stringContaining('Relance unique')]);
  }, 240_000);
});
