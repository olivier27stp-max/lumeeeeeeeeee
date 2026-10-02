/**
 * C — CAS NÉGATIFS : ce qui ne doit RIEN faire, et ce qui doit être sauté
 * proprement.
 *
 *  · règle brouillon / corbeille / purgée / supprimée → aucun effet, ni
 *    immédiat, ni par une tâche déjà en file ;
 *  · condition fausse → aucun effet ;
 *  · données manquantes → l'action est sautée avec un motif, les autres
 *    actions de la règle continuent ;
 *  · automatisation modifiée pendant un parcours → la règle réelle du code,
 *    prouvée (voir chaque test).
 *
 * Vrai moteur, staging, bureau A de test en bac à sable (aucun envoi réel).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { demarrerMoteur, marque, attendre } from '../harnais/moteur';
import {
  Menage, creerClient, creerRegle, journaux, taches, avancer, rendreDues, envoisMarques,
  emettreNote, attendreJournaux, attendreTraitement, notesMarquees, courrielFictif,
} from './20-cde-outils';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
const menage = new Menage();
const DEBUT = '2000-01-01T00:00:00Z';

beforeAll(async () => { b = await demarrerMoteur(); });
afterEach(async () => { await menage.vider(); });
afterAll(async () => { await menage.vider(); });

const note = (m: string, texte = 'note') => ({ type: 'ajouter_note', config: { body: `${texte} ${m}` } });
const courriel = (m: string, corps = '<p>Bonjour {client_first_name}</p>') =>
  ({ type: 'send_email', config: { subject: `Sujet ${m}`, body: `${corps} ${m}`, type_envoi: 'transactionnel' } });
const texto = (m: string) => ({ type: 'send_sms', config: { body: `Texto ${m}`, type_envoi: 'transactionnel' } });

describe('C — règle qui ne tourne pas : aucun effet immédiat', () => {
  const cas: Array<[string, string, Record<string, unknown>]> = [
    ['C-001', 'brouillon (is_active=false)', { is_active: false }],
    ['C-002', 'à la corbeille (deleted_at, restée active)', { is_active: true, deleted_at: new Date().toISOString() }],
    ['C-003', 'purgée (deleted_at + purged_at)', { is_active: true, deleted_at: new Date().toISOString(), purged_at: new Date().toISOString() }],
  ];
  for (const [id, libelle, etat] of cas) {
    it(`[${id}] règle ${libelle} → note.added ne produit ni journal, ni note, ni envoi`, async () => {
      const m = marque(id);
      const depuis = new Date().toISOString();
      const client = await creerClient(b, menage, m);
      const regle = await creerRegle(b, menage, m, { actions: [note(m), courriel(m)], ...etat });
      await emettreNote(b, client);
      const ev = await attendreTraitement(b, client, 'note.added', DEBUT);
      expect(ev[0].regles_traitees ?? []).not.toContain(regle);
      expect(await journaux(b, regle)).toEqual([]);
      expect(await taches(b, regle)).toEqual([]);
      expect(await notesMarquees(b, m)).toEqual([]);
      expect(await envoisMarques(b, depuis, m)).toEqual([]);
    });
  }

  it('[C-004] règle SUPPRIMÉE physiquement → aucun journal, aucune note', async () => {
    const m = marque('C-004');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [note(m)] });
    await b.admin.from('automation_rules').delete().eq('id', regle);
    await emettreNote(b, client);
    await attendreTraitement(b, client, 'note.added', DEBUT);
    expect(await notesMarquees(b, m)).toEqual([]);
    expect(await journaux(b, regle)).toEqual([]);
  });
});

describe('C — condition fausse', () => {
  it('[C-005] condition « canal = web » et événement canal = telephone → aucun effet', async () => {
    const m = marque('C-005');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [note(m)], conditions: { canal: 'web' } });
    await emettreNote(b, client, { canal: 'telephone' });
    await attendreTraitement(b, client, 'note.added', DEBUT);
    // Aucune action ; depuis L-004 le journal dit POURQUOI la règle n'est pas partie.
    expect((await journaux(b, regle)).map((l) => [l.action_type, l.result_success, l.result_data?.saute])).toEqual([
      ['conditions', true, 'Conditions non remplies : canal'],
    ]);
    expect(await notesMarquees(b, m)).toEqual([]);
  });

  it('[C-006] condition sur une métadonnée ABSENTE de l’événement → aucun effet', async () => {
    const m = marque('C-006');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [note(m)], conditions: { montant: { gte: 100 } } });
    await emettreNote(b, client, {});
    await attendreTraitement(b, client, 'note.added', DEBUT);
    expect((await journaux(b, regle)).map((l) => [l.action_type, l.result_success, l.result_data?.saute])).toEqual([
      ['conditions', true, 'Conditions non remplies : montant'],
    ]);
    expect(await notesMarquees(b, m)).toEqual([]);
  });

  it('[C-007] témoin positif : la même condition VRAIE → une note, un journal réussi', async () => {
    const m = marque('C-007');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [note(m)], conditions: { canal: 'web' } });
    await emettreNote(b, client, { canal: 'web' });
    const j = await attendreJournaux(b, regle, 1);
    expect(j.map((l) => [l.action_type, l.result_success])).toEqual([['ajouter_note', true]]);
    const notes = await notesMarquees(b, m);
    expect(notes).toHaveLength(1);
    expect(notes[0].entity_id).toBe(client);
  });

  it('[C-008] étiquette exigée absente (client_a_etiquette) → aucun effet', async () => {
    const m = marque('C-008');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [note(m)], conditions: { client_a_etiquette: `VIP-${m}` } });
    await emettreNote(b, client);
    await attendreTraitement(b, client, 'note.added', DEBUT);
    expect((await journaux(b, regle)).map((l) => [l.action_type, l.result_success, l.result_data?.saute])).toEqual([
      ['conditions', true, 'Conditions non remplies : étiquette du client'],
    ]);
    expect(await notesMarquees(b, m)).toEqual([]);
  });
});

describe('C — tâche DÉJÀ en file quand la règle cesse de tourner', () => {
  /** Règle différée d'une heure ; renvoie la tâche en attente. */
  async function tacheEnFile(m: string, actions: unknown[]) {
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions, delay_seconds: 3600 });
    await emettreNote(b, client);
    const t = await attendre(() => taches(b, regle), (x) => x.length === actions.length);
    expect(t.map((x) => x.status)).toEqual(actions.map(() => 'pending'));
    return { client, regle };
  }

  it('[C-010] repassée en BROUILLON avant l’échéance → tâche annulée avec motif, rien n’est fait', async () => {
    const m = marque('C-010');
    const depuis = new Date().toISOString();
    const { regle } = await tacheEnFile(m, [note(m), courriel(m)]);
    await b.admin.from('automation_rules').update({ is_active: false }).eq('id', regle);
    await avancer(b, regle);
    const t = await taches(b, regle);
    expect(t.map((x) => [x.status, x.last_error])).toEqual([
      ['cancelled', 'Automatisation en brouillon : envoi annulé.'],
      ['cancelled', 'Automatisation en brouillon : envoi annulé.'],
    ]);
    expect(await notesMarquees(b, m)).toEqual([]);
    expect(await envoisMarques(b, depuis, m)).toEqual([]);
    // Rien n'est FAIT — et, depuis la mission finale (B-05), chaque tâche annulée laisse une ligne « saute »
    // au journal qui dit pourquoi (`regle_inactive`) : avant, l'arrêt n'existait que sur la tâche.
    expect((await journaux(b, regle)).map((l) => [l.result_success, (l.result_data as { saute_code?: string } | null)?.saute_code]))
      .toEqual([[true, 'regle_inactive'], [true, 'regle_inactive']]);
  });

  it('[C-011] mise à la CORBEILLE avant l’échéance → tâche annulée « supprimée »', async () => {
    const m = marque('C-011');
    const { regle } = await tacheEnFile(m, [note(m)]);
    await b.admin.from('automation_rules').update({ deleted_at: new Date().toISOString() }).eq('id', regle);
    await avancer(b, regle);
    const [t] = await taches(b, regle);
    expect([t.status, t.last_error]).toEqual(['cancelled', 'Automatisation supprimée : envoi annulé.']);
    expect(await notesMarquees(b, m)).toEqual([]);
  });

  it('[C-012] PURGÉE (corbeille puis « supprimer définitivement ») → tâche annulée, rien n’est fait', async () => {
    const m = marque('C-012');
    const { regle } = await tacheEnFile(m, [note(m)]);
    const quand = new Date().toISOString();
    await b.admin.from('automation_rules').update({ deleted_at: quand, is_active: false }).eq('id', regle);
    const { error } = await b.admin.from('automation_rules').update({ purged_at: quand }).eq('id', regle);
    expect(error).toBeNull();
    await avancer(b, regle);
    const [t] = await taches(b, regle);
    expect(t.status).toBe('cancelled');
    expect(await notesMarquees(b, m)).toEqual([]);
  });

  it('[C-013] supprimée PHYSIQUEMENT → ses tâches disparaissent (FK en cascade), rien n’est fait', async () => {
    const m = marque('C-013');
    const { regle } = await tacheEnFile(m, [note(m)]);
    await b.admin.from('automation_rules').delete().eq('id', regle);
    expect(await taches(b, regle)).toEqual([]);
    await avancer(b, regle);
    expect(await notesMarquees(b, m)).toEqual([]);
  });

  it('[C-014] « Tout arrêter » (pause d’entreprise) → la tâche due reste en attente, intacte ; à la reprise elle part', async () => {
    const m = marque('C-014');
    const { regle } = await tacheEnFile(m, [note(m)]);
    const { oublierPause } = await import('../../../server/lib/automations-pause-org');
    await b.admin.from('company_settings').update({ automations_paused: true }).eq('org_id', b.orgA);
    oublierPause(b.orgA);
    try {
      await avancer(b, regle);
      const [t] = await taches(b, regle);
      expect([t.status, t.attempts]).toEqual(['pending', 0]);
      expect(await notesMarquees(b, m)).toEqual([]);
    } finally {
      await b.admin.from('company_settings').update({ automations_paused: false }).eq('org_id', b.orgA);
      oublierPause(b.orgA);
    }
    await avancer(b, regle);
    const [t] = await taches(b, regle);
    expect(t.status).toBe('completed');
    expect(await notesMarquees(b, m)).toHaveLength(1);
  });

  it('[C-015] « Tout arrêter » → un événement reçu pendant la pause est ignoré (rien planifié, rien journalisé)', async () => {
    const m = marque('C-015');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [note(m)] });
    const { oublierPause } = await import('../../../server/lib/automations-pause-org');
    await b.admin.from('company_settings').update({ automations_paused: true }).eq('org_id', b.orgA);
    oublierPause(b.orgA);
    try {
      await emettreNote(b, client);
      await attendreTraitement(b, client, 'note.added', DEBUT);
    } finally {
      await b.admin.from('company_settings').update({ automations_paused: false }).eq('org_id', b.orgA);
      oublierPause(b.orgA);
    }
    expect(await journaux(b, regle)).toEqual([]);
    expect(await notesMarquees(b, m)).toEqual([]);
  });

  it('[C-016] interrupteur global AUTOMATIONS_ENABLED=off → ni événement traité, ni tâche réclamée ; la file est conservée', async () => {
    const m = marque('C-016');
    const { regle } = await tacheEnFile(m, [note(m)]);
    const client2 = await creerClient(b, menage, `${m}-2`);
    const avant = process.env.AUTOMATIONS_ENABLED;
    process.env.AUTOMATIONS_ENABLED = 'off';
    try {
      await emettreNote(b, client2);
      await attendreTraitement(b, client2, 'note.added', DEBUT);
      await avancer(b, regle);
    } finally {
      if (avant === undefined) delete process.env.AUTOMATIONS_ENABLED; else process.env.AUTOMATIONS_ENABLED = avant;
    }
    const t = await taches(b, regle);
    // Une seule tâche (celle d'avant l'arrêt) : l'événement de client2 n'a rien planifié.
    expect(t.map((x) => [x.status, x.attempts])).toEqual([['pending', 0]]);
    expect(await notesMarquees(b, m)).toEqual([]);
  });
});

describe('C — données manquantes : action sautée avec motif, les autres continuent', () => {
  it('[C-020] client SANS téléphone : texto sauté (sans_telephone), note et courriel faits', async () => {
    const m = marque('C-020');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m, { phone: null });
    const regle = await creerRegle(b, menage, m, { actions: [texto(m), note(m), courriel(m)] });
    await emettreNote(b, client);
    const j = await attendreJournaux(b, regle, 3);
    expect(j.map((l) => [l.action_type, l.result_success, (l.result_data as any)?.saute_code ?? null])).toEqual([
      ['send_sms', true, 'sans_telephone'],
      ['ajouter_note', true, null],
      ['send_email', true, null],
    ]);
    expect(await notesMarquees(b, m)).toHaveLength(1);
    const envois = await envoisMarques(b, depuis, m);
    expect(envois.map((e) => [e.canal, e.destinataire])).toEqual([['courriel', courrielFictif(m)]]);
  });

  it('[C-021] client SANS courriel : courriel sauté (sans_courriel), texto et note faits', async () => {
    const m = marque('C-021');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m, { email: null });
    const regle = await creerRegle(b, menage, m, { actions: [courriel(m), texto(m), note(m)] });
    await emettreNote(b, client);
    const j = await attendreJournaux(b, regle, 3);
    expect(j.map((l) => [l.action_type, l.result_success, (l.result_data as any)?.saute_code ?? null])).toEqual([
      ['send_email', true, 'sans_courriel'],
      ['send_sms', true, null],
      ['ajouter_note', true, null],
    ]);
    const envois = await envoisMarques(b, depuis, m);
    expect(envois.map((e) => e.canal)).toEqual(['sms']);
  });

  it('[C-022] client SANS prénom mais avec nom : {client_first_name} retombe sur le nom complet (règle de setClientVars)', async () => {
    const m = marque('C-022');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m, { first_name: null });
    const regle = await creerRegle(b, menage, m, { actions: [courriel(m, '<p>Bonjour {client_first_name},</p>')] });
    await emettreNote(b, client);
    const j = await attendreJournaux(b, regle, 1);
    expect(j[0].result_success).toBe(true);
    const [envoi] = await envoisMarques(b, depuis, m);
    const corps = String(envoi.corps);
    expect(corps).toContain(`<p>Bonjour ${m},</p>`);
    expect(corps).not.toMatch(/undefined|\{client_first_name\}/);
  });

  it('[C-027] client SANS AUCUN nom (prénom, nom, entreprise vides) : « Bonjour, » propre, sans « undefined » ni variable brute', async () => {
    const m = marque('C-027');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m, { first_name: null, last_name: null, company: null });
    const regle = await creerRegle(b, menage, m, { actions: [courriel(m, '<p>Bonjour {client_first_name},</p>')] });
    await emettreNote(b, client);
    const j = await attendreJournaux(b, regle, 1);
    expect(j[0].result_success).toBe(true);
    const [envoi] = await envoisMarques(b, depuis, m);
    const corps = String(envoi.corps);
    expect(corps).toContain('<p>Bonjour,</p>');
    expect(corps).not.toMatch(/undefined|\{client_first_name\}|Bonjour ,/);
  });

  it('[C-023] entité INEXISTANTE (id jamais créé) : texto et courriel sautés avec motif, pas de plantage', async () => {
    const m = marque('C-023');
    const fantome = randomUUID();
    const regle = await creerRegle(b, menage, m, { actions: [texto(m), courriel(m)] });
    await emettreNote(b, fantome);
    const j = await attendreJournaux(b, regle, 2);
    expect(j.map((l) => [l.action_type, l.result_success, (l.result_data as any)?.saute_code ?? null])).toEqual([
      ['send_sms', true, 'sans_telephone'],
      ['send_email', true, 'sans_courriel'],
    ]);
  });

  it('[C-024] client mis à la CORBEILLE entre l’événement et l’exécution différée → rien n’est fait, tâches annulées « client supprimé »', async () => {
    const m = marque('C-024');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [courriel(m), note(m)], delay_seconds: 3600 });
    await emettreNote(b, client);
    await attendre(() => taches(b, regle), (x) => x.length === 2);
    await b.admin.from('clients').update({ deleted_at: new Date().toISOString() }).eq('id', client);
    await avancer(b, regle);
    expect(await envoisMarques(b, depuis, m)).toEqual([]);
    // Une note (ou une tâche, un webhook…) sur un client à la corbeille est aussi un effet interdit.
    expect(await notesMarquees(b, m)).toEqual([]);
    const t = await taches(b, regle);
    expect(t.map((x) => [x.status, x.last_error])).toEqual([
      ['cancelled', 'Annulée : le client a été supprimé.'],
      ['cancelled', 'Annulée : le client a été supprimé.'],
    ]);
  });

  it('[C-028] idem avec le désabonnement par canal actif (texto transactionnel) → rien ne part vers le client supprimé', async () => {
    const m = marque('C-028');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [texto(m)], delay_seconds: 3600 });
    await emettreNote(b, client);
    await attendre(() => taches(b, regle), (x) => x.length === 1);
    await b.admin.from('clients').update({ deleted_at: new Date().toISOString() }).eq('id', client);
    const { oublierDrapeaux } = await import('../../../server/lib/automations-drapeaux');
    await b.admin.from('org_features').upsert({ org_id: b.orgA, feature: 'auto_desabonnement_canal', enabled: true }, { onConflict: 'org_id,feature' });
    oublierDrapeaux(b.orgA);
    try {
      await avancer(b, regle);
    } finally {
      await b.admin.from('org_features').update({ enabled: false }).eq('org_id', b.orgA).eq('feature', 'auto_desabonnement_canal');
      oublierDrapeaux(b.orgA);
    }
    expect(await envoisMarques(b, depuis, m)).toEqual([]);
    const [t] = await taches(b, regle);
    expect([t.status, t.last_error]).toEqual(['cancelled', 'Annulée : le client a été supprimé.']);
  });

  it('[C-025] client SUPPRIMÉ physiquement entre l’événement et l’exécution différée → rien n’est fait, tâches annulées', async () => {
    const m = marque('C-025');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [courriel(m), note(m)], delay_seconds: 3600 });
    await emettreNote(b, client);
    await attendre(() => taches(b, regle), (x) => x.length === 2);
    await b.admin.from('clients').delete().eq('id', client);
    await avancer(b, regle);
    expect(await envoisMarques(b, depuis, m)).toEqual([]);
    expect(await notesMarquees(b, m)).toEqual([]);
    expect((await taches(b, regle)).map((x) => [x.status, x.last_error])).toEqual([
      ['cancelled', 'Annulée : le client a été supprimé.'],
      ['cancelled', 'Annulée : le client a été supprimé.'],
    ]);
  });

  it('[C-026] une action qui échoue (étiquette vide) n’empêche pas les suivantes (note)', async () => {
    const m = marque('C-026');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [{ type: 'ajouter_etiquette', config: { etiquette: '' } }, note(m)] });
    await emettreNote(b, client);
    const j = await attendreJournaux(b, regle, 2);
    expect(j.map((l) => [l.action_type, l.result_success, l.result_error])).toEqual([
      ['ajouter_etiquette', false, 'Aucune étiquette à ajouter.'],
      ['ajouter_note', true, null],
    ]);
  });
});

describe('C — automatisation modifiée pendant un parcours en cours', () => {
  /** Parcours : attendre 1 h → note « s2 » → attendre 1 h → note « s4 ». */
  const parcours = (m: string, s2 = 'v1', s4 = 'v1') => [
    { id: 's1', type: 'attendre', delai_secondes: 3600, suivant: 's2' },
    { id: 's2', type: 'action', action: note(m, `s2-${s2}`), suivant: 's3' },
    { id: 's3', type: 'attendre', delai_secondes: 3600, suivant: 's4' },
    { id: 's4', type: 'action', action: note(m, `s4-${s4}`) },
  ];

  async function demarrer(m: string) {
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { steps: parcours(m) });
    await emettreNote(b, client);
    const [t] = await attendre(() => taches(b, regle), (x) => x.length === 1);
    expect([t.step_id, t.status]).toEqual(['s2', 'pending']);
    return { client, regle };
  }

  it('[C-030] RÈGLE DU CODE : le texte d’une étape DÉJÀ planifiée est figé (copie dans la tâche) — l’ancien texte part', async () => {
    const m = marque('C-030');
    const { regle } = await demarrer(m);
    await b.admin.from('automation_rules').update({ steps: parcours(m, 'v2') }).eq('id', regle);
    await avancer(b, regle);
    const notes = await notesMarquees(b, m);
    expect(notes.map((n) => n.content)).toEqual([`s2-v1 ${m}`]);
  });

  it('[C-031] RÈGLE DU CODE : une étape PAS ENCORE planifiée est relue — le nouveau texte part', async () => {
    const m = marque('C-031');
    const { regle } = await demarrer(m);
    await b.admin.from('automation_rules').update({ steps: parcours(m, 'v1', 'v2') }).eq('id', regle);
    await avancer(b, regle); // s2 → planifie s4 (relu : v2)
    await avancer(b, regle); // s4
    const notes = (await notesMarquees(b, m)).map((n) => n.content).sort();
    expect(notes).toEqual([`s2-v1 ${m}`, `s4-v2 ${m}`]);
  });

  it('[C-032] étape planifiée SUPPRIMÉE du parcours → tâche annulée « Étape supprimée », rien n’est fait', async () => {
    const m = marque('C-032');
    const { regle } = await demarrer(m);
    const sansS2 = parcours(m).filter((e) => e.id !== 's2').map((e) => (e.id === 's1' ? { ...e, suivant: 's3' } : e));
    await b.admin.from('automation_rules').update({ steps: sansS2 }).eq('id', regle);
    await avancer(b, regle);
    const t = await taches(b, regle);
    expect(t.map((x) => [x.step_id, x.status, x.last_error])).toEqual([['s2', 'cancelled', 'Étape supprimée du parcours : envoi annulé.']]);
    expect(await notesMarquees(b, m)).toEqual([]);
  });

  it('[C-033] parcours DÉPUBLIÉ en cours de route → l’étape en attente est annulée, le parcours s’arrête', async () => {
    const m = marque('C-033');
    const { regle } = await demarrer(m);
    await avancer(b, regle); // s2 faite, s4 planifiée
    await b.admin.from('automation_rules').update({ is_active: false }).eq('id', regle);
    await avancer(b, regle);
    const t = await taches(b, regle);
    expect(t.map((x) => [x.step_id, x.status])).toEqual([['s2', 'completed'], ['s4', 'cancelled']]);
    expect((await notesMarquees(b, m)).map((n) => n.content)).toEqual([`s2-v1 ${m}`]);
  });

  it('[C-034] RÈGLE DU CODE : changer le délai d’une règle simple ne déplace pas une tâche déjà planifiée', async () => {
    const m = marque('C-034');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [note(m)], delay_seconds: 3600 });
    await emettreNote(b, client);
    const [avant] = await attendre(() => taches(b, regle), (x) => x.length === 1);
    await b.admin.from('automation_rules').update({ delay_seconds: 7 * 86400 }).eq('id', regle);
    const [apres] = await taches(b, regle);
    expect(apres.execute_at).toBe(avant.execute_at);
    expect(Date.parse(apres.execute_at) - Date.parse(apres.created_at)).toBeLessThan(3700_000);
  });

  it('[C-035] RÈGLE DU CODE : brouillon puis republiée AVANT l’échéance → la tâche part (l’annulation se décide à l’échéance)', async () => {
    const m = marque('C-035');
    const { regle } = await demarrer(m);
    await b.admin.from('automation_rules').update({ is_active: false }).eq('id', regle);
    await b.admin.from('automation_rules').update({ is_active: true }).eq('id', regle);
    await rendreDues(b, regle);
    await avancer(b, regle);
    expect((await notesMarquees(b, m)).map((n) => n.content)).toEqual([`s2-v1 ${m}`]);
  });
});
