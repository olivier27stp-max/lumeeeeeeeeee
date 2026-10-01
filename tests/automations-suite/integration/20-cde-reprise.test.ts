/**
 * E — ÉCHECS ET REPRISE : un fournisseur en panne ne fait rien perdre en
 * silence.
 *
 *  · panne / délai du fournisseur (mode `panne` / `delai` du bac à sable) →
 *    échec journalisé, reprise à 5 min, 30 min, 2 h, 4 tentatives, puis
 *    `failed` + notification à l'entreprise ;
 *  · erreur définitive → abandon immédiat + notification ;
 *  · échec au milieu d'un parcours → reprise à la BONNE étape, les étapes
 *    réussies ne sont pas rejouées ;
 *  · « redémarrage » : tâches `running` figées (> 15 min) récupérées, délais
 *    en attente conservés en base ;
 *  · courriel de fond `reessayer` → `email_retry_queue`.
 *
 * Vrai moteur, staging, bureau A de test en bac à sable.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { demarrerMoteur, marque, attendre, traiterFile } from '../harnais/moteur';
import {
  Menage, creerClient, creerRegle, journaux, taches, avancer, rendreDues, envoisMarques,
  emettreNote, attendreJournaux, notesMarquees, modeBac, courrielFictif, pause,
} from './20-cde-outils';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
const menage = new Menage();

beforeAll(async () => { b = await demarrerMoteur(); });
afterEach(async () => { await modeBac(b, 'succes'); await menage.vider(); });
afterAll(async () => { await modeBac(b, 'succes'); await menage.vider(); });

const note = (m: string, texte = 'note') => ({ type: 'ajouter_note', config: { body: `${texte} ${m}` } });
const courriel = (m: string, sujet = 'Sujet') =>
  ({ type: 'send_email', config: { subject: `${sujet} ${m}`, body: `<p>Bonjour ${m}</p>`, type_envoi: 'transactionnel' } });
const texto = (m: string) => ({ type: 'send_sms', config: { body: `Texto ${m}`, type_envoi: 'transactionnel' } });

/** Minutes entre maintenant et l'échéance de la tâche (arrondi). */
const dansMinutes = (iso: string) => Math.round((Date.parse(iso) - Date.now()) / 60_000);

async function notificationsDe(tacheId: string) {
  const { data, error } = await b.admin.from('notifications').select('id, type, title, body').eq('org_id', b.orgA).eq('reference_id', tacheId);
  if (error) throw new Error(error.message);
  menage.ajouter(() => b.admin.from('notifications').delete().eq('org_id', b.orgA).eq('reference_id', tacheId));
  return data ?? [];
}

describe('E — fournisseur en panne : reprises puis échec définitif signalé', () => {
  it('[E-001] courriel, fournisseur en PANNE → reprises à 5 min, 30 min, 2 h, puis failed + notification ; chaque essai journalisé', async () => {
    const m = marque('E-001');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { name: `Relance ${m}`, actions: [courriel(m)], delay_seconds: 3600 });
    await emettreNote(b, client);
    await attendre(() => taches(b, regle), (x) => x.length === 1);
    await modeBac(b, 'panne');

    const attendus = [[1, 5], [2, 30], [3, 120]] as const;
    for (const [tentative, minutes] of attendus) {
      await avancer(b, regle);
      const [t] = await taches(b, regle);
      expect([t.status, t.attempts]).toEqual(['pending', tentative]);
      expect(dansMinutes(t.execute_at)).toBe(minutes);
      expect(t.last_error).toBe(`Fournisseur simulé en panne (bac à sable) — reprise ${tentative}/4 dans ${minutes} min`);
    }
    await avancer(b, regle);
    const [t] = await taches(b, regle);
    expect([t.status, t.attempts, t.last_error]).toEqual(['failed', 4, 'Fournisseur simulé en panne (bac à sable)']);
    const j = await journaux(b, regle);
    expect(j.map((l) => [l.result_success, l.result_error])).toEqual(
      [1, 2, 3, 4].map(() => [false, 'Fournisseur simulé en panne (bac à sable)']),
    );
    expect(j.every((l) => l.scheduled_task_id === t.id)).toBe(true);
    const notifs = await notificationsDe(t.id);
    expect(notifs.map((n) => [n.type, n.title, n.body])).toEqual([[
      'automation_failed', `Échec d'envoi — Relance ${m}`,
      'Le courriel n\'est pas parti et ne partira pas : Fournisseur simulé en panne (bac à sable).',
    ]]);
  });

  it('[E-002] texto, fournisseur en DÉLAI dépassé → reprise ; le fournisseur revient → envoyé une seule fois', async () => {
    const m = marque('E-002');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [texto(m)], delay_seconds: 3600 });
    await emettreNote(b, client);
    await attendre(() => taches(b, regle), (x) => x.length === 1);
    await modeBac(b, 'delai');
    await avancer(b, regle);
    const [t1] = await taches(b, regle);
    expect([t1.status, t1.attempts]).toEqual(['pending', 1]);
    expect(t1.last_error).toMatch(/^Délai dépassé — fournisseur simulé \(bac à sable\) — reprise 1\/4 dans 5 min$/);
    await modeBac(b, 'succes');
    await avancer(b, regle);
    const [t2] = await taches(b, regle);
    expect([t2.status, t2.attempts, t2.last_error]).toEqual(['completed', 2, null]);
    // Le texto a été « tenté » en panne (consigné, puis échec), puis envoyé : un seul envoi RÉUSSI dans Messages.
    const { data: msgs } = await b.admin.from('messages').select('id').eq('org_id', b.orgA).eq('direction', 'outbound').like('message_text', `%${m}%`);
    expect(msgs).toHaveLength(1);
    const envois = await envoisMarques(b, depuis, m);
    expect(envois.map((e) => (e.meta as { mode?: string }).mode)).toEqual(['delai', 'succes']);
  });

  it('[E-003] erreur DÉFINITIVE (étiquette vide) → failed dès le 1er essai + notification, aucune reprise', async () => {
    const m = marque('E-003');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [{ type: 'ajouter_etiquette', config: { etiquette: '' } }], delay_seconds: 3600 });
    await emettreNote(b, client);
    await attendre(() => taches(b, regle), (x) => x.length === 1);
    await avancer(b, regle);
    const [t] = await taches(b, regle);
    expect([t.status, t.attempts, t.last_error]).toEqual(['failed', 1, 'Aucune étiquette à ajouter.']);
    expect(await notificationsDe(t.id)).toHaveLength(1);
  });

  it('[E-004] une action en échec n’empêche pas les AUTRES tâches de la même règle (note faite, courriel en reprise)', async () => {
    const m = marque('E-004');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [courriel(m), note(m)], delay_seconds: 3600 });
    await emettreNote(b, client);
    await attendre(() => taches(b, regle), (x) => x.length === 2);
    await modeBac(b, 'panne');
    await avancer(b, regle);
    const t = await taches(b, regle);
    const parType = Object.fromEntries(t.map((x) => [x.action_config.type, [x.status, x.attempts]]));
    expect(parType).toEqual({ send_email: ['pending', 1], ajouter_note: ['completed', 1] });
    expect(await notesMarquees(b, m)).toHaveLength(1);
  });
});

describe('E — échec au milieu d’un parcours', () => {
  it('[E-010] note → courriel (panne) → note : reprise au courriel, la 1re note n’est pas refaite, la suite part après', async () => {
    const m = marque('E-010');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, {
      steps: [
        { id: 's1', type: 'action', action: note(m, 'un'), suivant: 's2' },
        { id: 's2', type: 'action', action: courriel(m), suivant: 's3' },
        { id: 's3', type: 'action', action: note(m, 'trois') },
      ],
    });
    await emettreNote(b, client);
    await attendre(() => taches(b, regle), (x) => x.length === 1);
    await avancer(b, regle); // s1
    await modeBac(b, 'panne');
    await avancer(b, regle); // s2 échoue
    let t = await taches(b, regle);
    expect(t.map((x) => [x.step_id, x.status, x.attempts])).toEqual([['s1', 'completed', 1], ['s2', 'pending', 1]]);
    await modeBac(b, 'succes');
    await avancer(b, regle); // s2 réussit → s3 planifiée
    await avancer(b, regle); // s3
    t = await taches(b, regle);
    expect(t.map((x) => [x.step_id, x.status, x.attempts])).toEqual([['s1', 'completed', 1], ['s2', 'completed', 2], ['s3', 'completed', 1]]);
    expect((await notesMarquees(b, m)).map((n) => n.content.split(' ')[0]).sort()).toEqual(['trois', 'un']);
    const envois = await envoisMarques(b, depuis, m);
    expect(envois.map((e) => (e.meta as { mode?: string }).mode)).toEqual(['panne', 'succes']);
  });

  it('[E-011] étape en échec DÉFINITIF → le parcours s’arrête là (la suite n’est jamais planifiée), notification', async () => {
    const m = marque('E-011');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, {
      steps: [
        { id: 's1', type: 'action', action: { type: 'ajouter_etiquette', config: { etiquette: '' } }, suivant: 's2' },
        { id: 's2', type: 'action', action: note(m, 'deux') },
      ],
    });
    await emettreNote(b, client);
    await attendre(() => taches(b, regle), (x) => x.length === 1);
    await avancer(b, regle);
    await avancer(b, regle);
    const t = await taches(b, regle);
    expect(t.map((x) => [x.step_id, x.status])).toEqual([['s1', 'failed']]);
    expect(await notesMarquees(b, m)).toEqual([]);
    expect(await notificationsDe(t[0].id)).toHaveLength(1);
  });
});

describe('E — redémarrage du serveur', () => {
  it('[E-020] tâche « running » figée depuis 20 min (arrêt brutal) → récupérée et exécutée une fois', async () => {
    const m = marque('E-020');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [note(m)], delay_seconds: 3600 });
    await emettreNote(b, client);
    const [t0] = await attendre(() => taches(b, regle), (x) => x.length === 1);
    await b.admin.from('automation_scheduled_tasks').update({ status: 'running', attempts: 1, execute_at: new Date(Date.now() - 20 * 60_000).toISOString() }).eq('id', t0.id);
    await traiterFile(b.admin, b.orgA);
    const [t] = await taches(b, regle);
    expect([t.status, t.attempts]).toEqual(['completed', 2]);
    expect(await notesMarquees(b, m)).toHaveLength(1);
  });

  it('[E-021] tâche « running » depuis 2 min (encore en cours ailleurs) → laissée tranquille', async () => {
    const m = marque('E-021');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [note(m)], delay_seconds: 3600 });
    await emettreNote(b, client);
    const [t0] = await attendre(() => taches(b, regle), (x) => x.length === 1);
    const debut = new Date(Date.now() - 2 * 60_000).toISOString();
    await b.admin.from('automation_scheduled_tasks').update({ status: 'running', attempts: 1, execute_at: debut }).eq('id', t0.id);
    await traiterFile(b.admin, b.orgA);
    const [t] = await taches(b, regle);
    expect([t.status, t.attempts, Date.parse(t.execute_at)]).toEqual(['running', 1, Date.parse(debut)]);
    expect(await notesMarquees(b, m)).toEqual([]);
  });

  it('[E-022] délais en attente conservés : un tick ne touche pas une tâche future (ni statut, ni échéance)', async () => {
    const m = marque('E-022');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, {
      steps: [
        { id: 'a', type: 'attendre', delai_secondes: 3 * 86400, suivant: 'b' },
        { id: 'b', type: 'action', action: note(m) },
      ],
    });
    await emettreNote(b, client);
    const [avant] = await attendre(() => taches(b, regle), (x) => x.length === 1);
    expect(Math.round((Date.parse(avant.execute_at) - Date.parse(avant.created_at)) / 3600_000)).toBe(72);
    await traiterFile(b.admin, b.orgA);
    await traiterFile(b.admin, b.orgA);
    const [apres] = await taches(b, regle);
    expect([apres.status, apres.attempts, apres.execute_at]).toEqual(['pending', 0, avant.execute_at]);
    expect(await notesMarquees(b, m)).toEqual([]);
  });

  it('[E-023] courriel coupé net après l’envoi (tâche restée running) → récupéré SANS second envoi', async () => {
    const m = marque('E-023');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [courriel(m)], delay_seconds: 3600 });
    await emettreNote(b, client);
    await attendre(() => taches(b, regle), (x) => x.length === 1);
    await rendreDues(b, regle);
    await traiterFile(b.admin, b.orgA);
    const [t0] = await taches(b, regle);
    await b.admin.from('automation_scheduled_tasks').update({ status: 'running', completed_at: null, execute_at: new Date(Date.now() - 16 * 60_000).toISOString() }).eq('id', t0.id);
    await traiterFile(b.admin, b.orgA);
    expect(await envoisMarques(b, depuis, m)).toHaveLength(1);
    expect((await taches(b, regle))[0].status).toBe('completed');
  });
});

describe('E — actions immédiates en échec', () => {
  it('[E-030] RÈGLE DU CODE : un courriel immédiat en panne est journalisé (échec + motif), les actions suivantes continuent', async () => {
    const m = marque('E-030');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [courriel(m), note(m)] });
    await modeBac(b, 'panne');
    await emettreNote(b, client);
    const j = await attendreJournaux(b, regle, 2);
    expect(j.map((l) => [l.action_type, l.result_success, l.result_error])).toEqual([
      ['send_email', false, 'Fournisseur simulé en panne (bac à sable)'],
      ['ajouter_note', true, null],
    ]);
    // Depuis E-031 : le courriel en panne passagère est repris ; la note, faite, ne l'est pas.
    const t = await taches(b, regle);
    expect(t.map((x) => [x.action_config.type, x.status, x.attempts])).toEqual([['send_email', 'pending', 1]]);
  });

  it('[E-031] une confirmation IMMÉDIATE par texto en panne passagère est REPRISE (5 min, puis 30 min) ; au retour du fournisseur elle part UNE fois', async () => {
    const m = marque('E-031');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [texto(m)] });
    await modeBac(b, 'panne');
    await emettreNote(b, client);
    const j = await attendreJournaux(b, regle, 1);
    expect(j.map((l) => [l.action_type, l.result_success, l.result_error, l.scheduled_task_id])).toEqual([
      ['send_sms', false, 'Fournisseur simulé en panne (bac à sable)', null],
    ]);
    // La reprise suit le parcours d'une tâche différée : la tentative immédiate compte pour 1.
    const [t1] = await attendre(() => taches(b, regle), (x) => x.length === 1);
    expect([t1.status, t1.attempts, t1.step_id]).toEqual(['pending', 1, null]);
    expect(dansMinutes(t1.execute_at)).toBe(5);
    expect(t1.last_error).toBe('Fournisseur simulé en panne (bac à sable) — reprise 1/4 dans 5 min');
    expect(t1.action_config).toMatchObject({ type: 'send_sms', trigger_event: 'note.added', reprise_immediate: true });
    // Rien n'est encore parti.
    const sortants = async () => (await b.admin.from('messages').select('id').eq('org_id', b.orgA).eq('direction', 'outbound').like('message_text', `%${m}%`)).data ?? [];
    expect(await sortants()).toHaveLength(0);

    // Le fournisseur est toujours en panne à +5 min → reprise suivante à 30 min.
    await avancer(b, regle);
    const [t2] = await taches(b, regle);
    expect([t2.status, t2.attempts]).toEqual(['pending', 2]);
    expect(dansMinutes(t2.execute_at)).toBe(30);
    expect(t2.last_error).toBe('Fournisseur simulé en panne (bac à sable) — reprise 2/4 dans 30 min');

    // Il revient : le texto part, une seule fois.
    await modeBac(b, 'succes');
    await avancer(b, regle);
    const [t3] = await taches(b, regle);
    expect([t3.status, t3.attempts, t3.last_error]).toEqual(['completed', 3, null]);
    expect(await sortants()).toHaveLength(1);
    const envois = await envoisMarques(b, depuis, m);
    expect(envois.map((e) => (e.meta as { mode?: string }).mode)).toEqual(['panne', 'panne', 'succes']);
    expect((await journaux(b, regle)).map((l) => [l.result_success, l.scheduled_task_id === t3.id])).toEqual([[false, false], [false, true], [true, true]]);
    // Aucune notification d'échec : le message est parti.
    expect(await notificationsDe(t3.id)).toEqual([]);
  });

  it('[E-034] courriel IMMÉDIAT, fournisseur en panne jusqu’au bout → 5 min, 30 min, 2 h, puis failed + notification à l’entreprise', async () => {
    const m = marque('E-034');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { name: `Confirmation ${m}`, actions: [courriel(m)] });
    await modeBac(b, 'panne');
    await emettreNote(b, client);
    await attendreJournaux(b, regle, 1);
    const [t0] = await attendre(() => taches(b, regle), (x) => x.length === 1);
    expect([t0.status, t0.attempts, dansMinutes(t0.execute_at)]).toEqual(['pending', 1, 5]);
    for (const [tentative, minutes] of [[2, 30], [3, 120]] as const) {
      await avancer(b, regle);
      const [t] = await taches(b, regle);
      expect([t.status, t.attempts]).toEqual(['pending', tentative]);
      expect(dansMinutes(t.execute_at)).toBe(minutes);
      expect(t.last_error).toBe(`Fournisseur simulé en panne (bac à sable) — reprise ${tentative}/4 dans ${minutes} min`);
    }
    await avancer(b, regle);
    const [t] = await taches(b, regle);
    expect([t.status, t.attempts, t.last_error]).toEqual(['failed', 4, 'Fournisseur simulé en panne (bac à sable)']);
    // 4 essais en tout : l'immédiat + 3 reprises, tous journalisés.
    expect((await journaux(b, regle)).map((l) => [l.result_success, l.result_error])).toEqual(
      [1, 2, 3, 4].map(() => [false, 'Fournisseur simulé en panne (bac à sable)']),
    );
    const notifs = await notificationsDe(t.id);
    expect(notifs.map((n) => [n.type, n.title, n.body])).toEqual([[
      'automation_failed', `Échec d'envoi — Confirmation ${m}`,
      'Le courriel n\'est pas parti et ne partira pas : Fournisseur simulé en panne (bac à sable).',
    ]]);
  });

  it('[E-035] échec DÉFINITIF d’une action immédiate (webhook vers une adresse interne) → aucune reprise ; une action interne en échec non plus', async () => {
    const m = marque('E-035');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, {
      actions: [{ type: 'webhook', config: { url: 'https://127.0.0.1/hook' } }, { type: 'ajouter_etiquette', config: { etiquette: '' } }],
    });
    await emettreNote(b, client);
    const j = await attendreJournaux(b, regle, 2);
    expect(j.map((l) => [l.action_type, l.result_success])).toEqual([['webhook', false], ['ajouter_etiquette', false]]);
    expect(String(j[0].result_error)).toMatch(/adresse refusée/i);
    await pause(1000);
    expect(await taches(b, regle)).toEqual([]);
  });

  it('[E-036] l’événement revient pendant qu’une reprise attend (nouvelle panne) → toujours UNE reprise, et UN seul texto au retour du fournisseur', async () => {
    const m = marque('E-036');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [texto(m)] });
    await modeBac(b, 'panne');
    await emettreNote(b, client);
    const [premier] = await attendreJournaux(b, regle, 1);
    await attendre(() => taches(b, regle), (x) => x.length === 1);
    // Le même événement plus de 2 min après (hors fenêtre anti-doublon des actions immédiates) :
    // on vieillit la première exécution au lieu d'attendre.
    await b.admin.from('automation_execution_logs').update({ execution_key: null }).eq('id', premier.id);
    await emettreNote(b, client);
    const j = await attendreJournaux(b, regle, 2);
    expect(j.map((l) => l.result_success)).toEqual([false, false]);
    await pause(1000);
    const enFile = await taches(b, regle);
    expect(enFile.map((t) => [t.status, t.attempts])).toEqual([['pending', 1]]);
    await modeBac(b, 'succes');
    await avancer(b, regle);
    expect((await taches(b, regle)).map((t) => t.status)).toEqual(['completed']);
    const { data: msgs } = await b.admin.from('messages').select('id').eq('org_id', b.orgA).eq('direction', 'outbound').like('message_text', `%${m}%`);
    expect(msgs).toHaveLength(1);
  });

  it('[E-037] règle repassée en BROUILLON pendant que la reprise attend → la reprise est annulée, rien ne part', async () => {
    const m = marque('E-037');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [courriel(m)] });
    await modeBac(b, 'panne');
    await emettreNote(b, client);
    await attendreJournaux(b, regle, 1);
    await attendre(() => taches(b, regle), (x) => x.length === 1);
    await modeBac(b, 'succes');
    await b.admin.from('automation_rules').update({ is_active: false }).eq('id', regle);
    await avancer(b, regle);
    const [t] = await taches(b, regle);
    expect([t.status, t.last_error]).toEqual(['cancelled', 'Automatisation en brouillon : envoi annulé.']);
    expect((await envoisMarques(b, depuis, m)).map((e) => (e.meta as { mode?: string }).mode)).toEqual(['panne']);
  });
});

describe('E — courriel de fond « reessayer » → file de reprise', () => {
  it('[E-032] sendEmail({ reessayer: true }) en panne → ligne email_retry_queue « pending », 1re reprise dans 5 min', async () => {
    const m = marque('E-032');
    await modeBac(b, 'panne');
    const { sendEmail } = await import('../../../server/lib/mailer');
    const to = courrielFictif(m);
    const r = await sendEmail({ to, subject: `Reçu ${m}`, html: `<p>${m}</p>`, reessayer: true, suivi: { orgId: b.orgA, entityType: 'client', entityId: null as unknown as string } });
    expect(r).toMatchObject({ sent: false, enFile: true });
    const { data, error } = await b.admin.from('email_retry_queue').select('id, org_id, to_emails, subject, status, attempts, next_attempt_at, last_error').eq('org_id', b.orgA).eq('subject', `Reçu ${m}`);
    expect(error).toBeNull();
    menage.ajouter(() => b.admin.from('email_retry_queue').delete().eq('org_id', b.orgA).eq('subject', `Reçu ${m}`));
    expect(data).toHaveLength(1);
    const [ligne] = data!;
    expect([ligne.status, ligne.attempts, ligne.to_emails, ligne.last_error]).toEqual(['pending', 0, [to], 'Fournisseur simulé en panne (bac à sable)']);
    expect(dansMinutes(ligne.next_attempt_at)).toBe(5);
  });

  it('[E-033] RÈGLE DU CODE : un courriel d’AUTOMATISATION n’entre pas dans email_retry_queue (sa reprise est celle de la file des tâches)', async () => {
    const m = marque('E-033');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [courriel(m, 'Auto')], delay_seconds: 3600 });
    await emettreNote(b, client);
    await attendre(() => taches(b, regle), (x) => x.length === 1);
    await modeBac(b, 'panne');
    await avancer(b, regle);
    const { data } = await b.admin.from('email_retry_queue').select('id').eq('org_id', b.orgA).eq('subject', `Auto ${m}`);
    expect(data).toEqual([]);
    expect((await taches(b, regle))[0].status).toBe('pending');
  });
});
