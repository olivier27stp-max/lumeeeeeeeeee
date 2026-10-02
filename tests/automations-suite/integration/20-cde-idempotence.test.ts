/**
 * D — IDEMPOTENCE ET CONCURRENCE : un effet voulu, une seule fois.
 *
 *  · même événement reçu deux fois (rejeu d'outbox, double clic, rafale) ;
 *  · reprise d'une tâche : pas de second envoi (garde « déjà envoyé », clé
 *    d'idempotence stable) ;
 *  · deux « workers » concurrents sur la même file ;
 *  · réglages de ré-entrée (`reentree`, `delai_entre_passages_jours`) ;
 *  · BOUCLES entre automatisations (étiquettes, « démarrer une
 *    automatisation », déplacements de deal A→B→A) : détectées et bornées.
 *
 * Vrai moteur, staging, bureau A de test en bac à sable.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { demarrerMoteur, marque, attendre, envoisSimules, traiterFile } from '../harnais/moteur';
import {
  Menage, creerClient, creerRegle, journaux, taches, avancer, rendreDues, envoisMarques,
  emettreNote, attendreJournaux, attendreTraitement, notesMarquees, pause, modeBac,
} from './20-cde-outils';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
const menage = new Menage();
const DEBUT = '2000-01-01T00:00:00Z';

beforeAll(async () => { b = await demarrerMoteur(); });
afterEach(async () => { await menage.vider(); });
afterAll(async () => { await modeBac(b, 'succes'); await menage.vider(); });

const note = (m: string, texte = 'note') => ({ type: 'ajouter_note', config: { body: `${texte} ${m}` } });
const courriel = (m: string) =>
  ({ type: 'send_email', config: { subject: `Sujet ${m}`, body: `<p>Bonjour ${m}</p>`, type_envoi: 'transactionnel' } });
const texto = (m: string) => ({ type: 'send_sms', config: { body: `Texto ${m}`, type_envoi: 'transactionnel' } });

/** Fait « passer le temps » pour l'anti-doublon de 2 min : la dernière exécution immédiate a eu lieu il y a `minutes`. */
async function vieillirJournaux(ruleId: string, minutes: number) {
  const j = await journaux(b, ruleId);
  const tranche = Math.floor((Date.now() - minutes * 60_000) / (2 * 60_000));
  for (const [i, l] of j.entries()) {
    const base = String(l.execution_key ?? '').split('@')[0];
    const { error } = await b.admin.from('automation_execution_logs').update({
      created_at: new Date(Date.now() - minutes * 60_000).toISOString(),
      ...(l.execution_key ? { execution_key: `${base}@${tranche - i}` } : {}),
    }).eq('id', l.id);
    if (error) throw new Error(error.message);
  }
}

/** Rejoue une ligne d'outbox comme `rejouerEvenementsOrphelins` (sans balayer les autres entreprises de staging). */
async function rejouerLigne(id: number, reglesTraitees?: string[]) {
  const { data: l, error } = await b.admin.from('domain_events').select('*').eq('id', id).single();
  if (error) throw new Error(error.message);
  await b.admin.from('domain_events').update({ processed_at: null, attempts: (l.attempts ?? 0) + 1 }).eq('id', id);
  await b.eventBus.rejouer(id, {
    type: l.type, orgId: l.org_id, entityType: l.entity_type, entityId: l.entity_id,
    metadata: l.metadata ?? {}, outboxId: id,
    reglesTraitees: reglesTraitees ?? [...(l.regles_traitees ?? [])],
    rejoueDepuis: l.created_at,
  } as never);
}

describe('D — même événement reçu plusieurs fois', () => {
  it('[D-001] rejeu d’outbox (même outbox id) après traitement complet → aucun second effet', async () => {
    const m = marque('D-001');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [note(m)] });
    await emettreNote(b, client);
    const [ev] = await attendreTraitement(b, client, 'note.added', DEBUT);
    expect(ev.regles_traitees).toEqual([regle]);
    await rejouerLigne(ev.id);
    expect(await notesMarquees(b, m)).toHaveLength(1);
    expect(await journaux(b, regle)).toHaveLength(1);
  });

  it('[D-002] rejeu d’outbox d’un traitement COUPÉ (règle non cochée), 5 min plus tard → l’action réussie n’est pas refaite', async () => {
    const m = marque('D-002');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [note(m), { type: 'ajouter_etiquette', config: { etiquette: `T-${m}` } }] });
    await emettreNote(b, client);
    const [ev] = await attendreTraitement(b, client, 'note.added', DEBUT);
    await attendreJournaux(b, regle, 2);
    // Hors de la fenêtre anti-doublon de 2 min : seule la garde de rejeu peut arrêter le doublon.
    await vieillirJournaux(regle, 5);
    await b.admin.from('domain_events').update({ created_at: new Date(Date.now() - 6 * 60_000).toISOString() }).eq('id', ev.id);
    await rejouerLigne(ev.id, []);
    expect(await notesMarquees(b, m)).toHaveLength(1);
    expect(await journaux(b, regle)).toHaveLength(2);
  });

  it('[D-003] même événement émis deux fois de suite (double clic) → un seul effet (fenêtre anti-doublon 2 min)', async () => {
    const m = marque('D-003');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [note(m), courriel(m)] });
    await emettreNote(b, client);
    await emettreNote(b, client);
    await attendreTraitement(b, client, 'note.added', DEBUT, 2);
    await attendreJournaux(b, regle, 2);
    expect(await notesMarquees(b, m)).toHaveLength(1);
    expect(await envoisMarques(b, depuis, m)).toHaveLength(1);
    expect((await journaux(b, regle)).map((l) => l.action_type).sort()).toEqual(['ajouter_note', 'send_email']);
  });

  it('[D-004] 6 émissions SIMULTANÉES (Promise.all) du même événement → un seul effet par action', async () => {
    const m = marque('D-004');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [note(m), texto(m)] });
    await Promise.all(Array.from({ length: 6 }, () => emettreNote(b, client)));
    await attendreTraitement(b, client, 'note.added', DEBUT, 6);
    await attendreJournaux(b, regle, 2);
    expect(await notesMarquees(b, m)).toHaveLength(1);
    expect(await envoisMarques(b, depuis, m)).toHaveLength(1);
    expect(await journaux(b, regle)).toHaveLength(2);
  });

  it('[D-005] 6 émissions simultanées sur 6 clients DIFFÉRENTS → 6 effets, aucun perdu', async () => {
    const m = marque('D-005');
    const clients = await Promise.all(Array.from({ length: 6 }, (_, i) => creerClient(b, menage, `${m}-${i}`)));
    const regle = await creerRegle(b, menage, m, { actions: [note(m)] });
    await Promise.all(clients.map((c) => emettreNote(b, c)));
    const j = await attendreJournaux(b, regle, 6);
    expect(j.filter((l) => l.result_success)).toHaveLength(6);
    const notes = await notesMarquees(b, m);
    expect(new Set(notes.map((n) => n.entity_id))).toEqual(new Set(clients));
  });

  it('[D-006] règle DIFFÉRÉE, même événement deux fois → une seule tâche en file (index unique)', async () => {
    const m = marque('D-006');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [note(m)], delay_seconds: 3600 });
    await Promise.all([emettreNote(b, client), emettreNote(b, client)]);
    await attendreTraitement(b, client, 'note.added', DEBUT, 2);
    const t = await taches(b, regle);
    expect(t.map((x) => [x.status, x.execution_key])).toEqual([['pending', `${regle}:${client}:0`]]);
  });
});

describe('D — reprise d’une tâche : pas de second envoi', () => {
  it('[D-010] tâche courriel récupérée APRÈS l’envoi (arrêt avant clôture) → « déjà envoyé », pas de second courriel', async () => {
    const m = marque('D-010');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [courriel(m)], delay_seconds: 3600 });
    await emettreNote(b, client);
    await attendre(() => taches(b, regle), (x) => x.length === 1);
    await avancer(b, regle);
    expect(await envoisMarques(b, depuis, m)).toHaveLength(1);
    // Le processus serait mort entre l'envoi et la clôture : la tâche est restée « running ».
    const [t] = await taches(b, regle);
    await b.admin.from('automation_scheduled_tasks').update({ status: 'running', completed_at: null, execute_at: new Date(Date.now() - 20 * 60_000).toISOString() }).eq('id', t.id);
    await traiterFile(b.admin, b.orgA);
    expect(await envoisMarques(b, depuis, m)).toHaveLength(1);
    const [apres] = await taches(b, regle);
    expect([apres.status, apres.attempts]).toEqual(['completed', 2]);
    const j = await journaux(b, regle);
    expect(j.map((l) => (l.result_data as any)?.saute_code ?? 'envoye')).toEqual(['envoye', 'deja_envoye']);
  });

  it('[D-011] tâche texto récupérée APRÈS l’envoi → « déjà envoyé », pas de second texto', async () => {
    const m = marque('D-011');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [texto(m)], delay_seconds: 3600 });
    await emettreNote(b, client);
    await attendre(() => taches(b, regle), (x) => x.length === 1);
    await avancer(b, regle);
    expect(await envoisMarques(b, depuis, m)).toHaveLength(1);
    const [t] = await taches(b, regle);
    await b.admin.from('automation_scheduled_tasks').update({ status: 'running', completed_at: null, execute_at: new Date(Date.now() - 20 * 60_000).toISOString() }).eq('id', t.id);
    await traiterFile(b.admin, b.orgA);
    expect(await envoisMarques(b, depuis, m)).toHaveLength(1);
    expect((await journaux(b, regle)).map((l) => (l.result_data as any)?.saute_code ?? 'envoye')).toEqual(['envoye', 'deja_envoye']);
  });

  it('[D-012] webhook en reprise → la MÊME clé Idempotency-Key à chaque tentative (tâche:étape)', async () => {
    const m = marque('D-012');
    const client = await creerClient(b, menage, m);
    const urlHook = `https://93.184.215.14/d012/${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const regle = await creerRegle(b, menage, m, { actions: [{ type: 'webhook', config: { url: urlHook } }], delay_seconds: 3600 });
    await emettreNote(b, client);
    await attendre(() => taches(b, regle), (x) => x.length === 1);
    await modeBac(b, 'panne');
    try { await avancer(b, regle); } finally { await modeBac(b, 'succes'); }
    const [t1] = await taches(b, regle);
    expect([t1.status, t1.attempts]).toEqual(['pending', 1]);
    await avancer(b, regle);
    const hooks = (await envoisSimules(b.admin, b.orgA, DEBUT)).filter((e) => e.canal === 'webhook' && e.destinataire === urlHook);
    expect(hooks).toHaveLength(2);
    const cles = hooks.map((h) => (h.meta as { entetes?: Record<string, string> }).entetes?.['Idempotency-Key']);
    expect(cles).toEqual([`${t1.id}:action`, `${t1.id}:action`]);
    expect((await taches(b, regle))[0].status).toBe('completed');
  });
});

describe('D — deux workers concurrents', () => {
  it('[D-020] deux processScheduledTasks en parallèle sur 8 tâches dues → chaque tâche exécutée UNE fois', async () => {
    const m = marque('D-020');
    const clients = await Promise.all(Array.from({ length: 8 }, (_, i) => creerClient(b, menage, `${m}-${i}`)));
    const regle = await creerRegle(b, menage, m, { actions: [note(m)], delay_seconds: 3600 });
    await Promise.all(clients.map((c) => emettreNote(b, c)));
    await attendre(() => taches(b, regle), (x) => x.length === 8);
    await rendreDues(b, regle);
    await Promise.all([traiterFile(b.admin, b.orgA), traiterFile(b.admin, b.orgA), traiterFile(b.admin, b.orgA)]);
    const t = await taches(b, regle);
    expect(t.map((x) => [x.status, x.attempts])).toEqual(clients.map(() => ['completed', 1]));
    const notes = await notesMarquees(b, m);
    expect(notes).toHaveLength(8);
    expect(new Set(notes.map((n) => n.entity_id)).size).toBe(8);
    expect(await journaux(b, regle)).toHaveLength(8);
  });

  it('[D-021] parcours : deux workers concurrents → l’étape suivante planifiée une seule fois', async () => {
    const m = marque('D-021');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, {
      steps: [
        { id: 'a', type: 'attendre', delai_secondes: 60, suivant: 'b' },
        { id: 'b', type: 'action', action: note(m, 'b'), suivant: 'c' },
        { id: 'c', type: 'attendre', delai_secondes: 60, suivant: 'd' },
        { id: 'd', type: 'action', action: note(m, 'd') },
      ],
    });
    await emettreNote(b, client);
    await attendre(() => taches(b, regle), (x) => x.length === 1);
    await rendreDues(b, regle);
    await Promise.all([traiterFile(b.admin, b.orgA), traiterFile(b.admin, b.orgA)]);
    await rendreDues(b, regle);
    await Promise.all([traiterFile(b.admin, b.orgA), traiterFile(b.admin, b.orgA)]);
    const t = await taches(b, regle);
    expect(t.map((x) => [x.step_id, x.status])).toEqual([['b', 'completed'], ['d', 'completed']]);
    expect((await notesMarquees(b, m)).map((n) => n.content).sort()).toEqual([`b ${m}`, `d ${m}`]);
  });
});

describe('D — réglages de ré-entrée', () => {
  it('[D-030] sans « reentree » : le même client redéclenche pendant qu’une tâche attend → refusé ; avec « reentree » → deux passages', async () => {
    const m = marque('D-030');
    const client = await creerClient(b, menage, m);
    const sans = await creerRegle(b, menage, `${m}-sans`, { actions: [note(m, 'sans')], delay_seconds: 3600 });
    const avec = await creerRegle(b, menage, `${m}-avec`, { actions: [note(m, 'avec')], delay_seconds: 3600, settings: { fenetre: { debut: 0, fin: 24 }, reentree: true } });
    await emettreNote(b, client);
    await attendre(async () => [...await taches(b, sans), ...await taches(b, avec)], (x) => x.length === 2);
    await emettreNote(b, client);
    await attendreTraitement(b, client, 'note.added', DEBUT, 2);
    expect(await taches(b, sans)).toHaveLength(1);
    const t = await taches(b, avec);
    expect(t).toHaveLength(2);
    expect(t[0].execution_key).not.toBe(t[1].execution_key);
  });

  it('[D-031] « reentree » n’autorise pas un DOUBLE envoi immédiat à la même seconde (clé sans suffixe)', async () => {
    const m = marque('D-031');
    const client = await creerClient(b, menage, m);
    const regle = await creerRegle(b, menage, m, { actions: [note(m)], settings: { fenetre: { debut: 0, fin: 24 }, reentree: true } });
    await Promise.all([emettreNote(b, client), emettreNote(b, client)]);
    await attendreTraitement(b, client, 'note.added', DEBUT, 2);
    await attendreJournaux(b, regle, 1);
    expect(await notesMarquees(b, m)).toHaveLength(1);
  });

  it('[D-032] « delai_entre_passages_jours = 1 » : 2e passage 5 min plus tard sauté ; témoin sans réglage repart ; passé 2 jours → repart', async () => {
    const m = marque('D-032');
    const client = await creerClient(b, menage, m);
    const avec = await creerRegle(b, menage, `${m}-avec`, { actions: [note(m, 'avec')], settings: { fenetre: { debut: 0, fin: 24 }, delai_entre_passages_jours: 1 } });
    const temoin = await creerRegle(b, menage, `${m}-temoin`, { actions: [note(m, 'temoin')] });
    await emettreNote(b, client);
    await attendreJournaux(b, avec, 1);
    await attendreJournaux(b, temoin, 1);
    await vieillirJournaux(avec, 5);
    await vieillirJournaux(temoin, 5);
    await emettreNote(b, client);
    await attendreJournaux(b, temoin, 2);
    await attendreTraitement(b, client, 'note.added', DEBUT, 2);
    // Le 2e passage est sauté — et, depuis la mission finale, le journal le DIT : une ligne
    // « une_fois_par_client » (avant : rien, « pourquoi ce client n'a rien reçu ? » restait sans réponse).
    const lignes = await attendre(() => journaux(b, avec), (l) => l.length >= 2);
    expect(lignes.map((l) => (l.result_data as { saute_code?: string } | null)?.saute_code ?? 'action').sort()).toEqual(['action', 'une_fois_par_client']);
    // Deux jours plus tard : la règle repart.
    await vieillirJournaux(avec, 2 * 24 * 60);
    await emettreNote(b, client);
    await attendreJournaux(b, avec, 3);
    const contenus = (await notesMarquees(b, m)).map((n) => n.content.split(' ')[0]).sort();
    expect(contenus).toEqual(['avec', 'avec', 'temoin', 'temoin']);
  });
});

describe('D — boucles entre automatisations', () => {
  it('[D-040] étiquettes : A retire X quand X est posée, B remet X quand X est retirée → une passe chacune, puis arrêt', async () => {
    const m = marque('D-040');
    const tag = `X-${m}`;
    const client = await creerClient(b, menage, m);
    const a = await creerRegle(b, menage, `${m}-A`, { trigger_event: 'client.tagged', conditions: { tag }, actions: [{ type: 'retirer_etiquette', config: { etiquette: tag } }] });
    const bb = await creerRegle(b, menage, `${m}-B`, { trigger_event: 'client.untagged', conditions: { tag }, actions: [{ type: 'ajouter_etiquette', config: { etiquette: tag } }] });
    await b.admin.from('client_tags').insert({ client_id: client, tag });
    const { annoncerEtiquette } = await import('../../../server/lib/etiquettes');
    await annoncerEtiquette(b.admin, { orgId: b.orgA, clientId: client, tag, sens: 'ajoutee' });
    await attendreJournaux(b, a, 1);
    await attendreJournaux(b, bb, 1);
    // Tous les événements d'étiquette du client traités : la chaîne est éteinte.
    await attendreTraitement(b, client, 'client.tagged', DEBUT, 2);
    await attendreTraitement(b, client, 'client.untagged', DEBUT, 1);
    await pause(1500);
    expect(await journaux(b, a)).toHaveLength(1);
    expect(await journaux(b, bb)).toHaveLength(1);
    const { data: tags } = await b.admin.from('client_tags').select('tag').eq('client_id', client);
    expect(tags).toEqual([{ tag }]);
    const { data: ev } = await b.admin.from('domain_events').select('type, metadata').eq('entity_id', client).in('type', ['client.tagged', 'client.untagged']).order('id');
    expect((ev ?? []).map((e) => [e.type, (e.metadata as { chaine?: string[] }).chaine ?? []])).toEqual([
      ['client.tagged', []],
      ['client.untagged', [a]],
      ['client.tagged', [a, bb]],
    ]);
  });

  it('[D-041] « démarrer une automatisation » A → B → A : la boucle est sautée avec le motif « boucle »', async () => {
    const m = marque('D-041');
    const client = await creerClient(b, menage, m);
    const bId = await creerRegle(b, menage, `${m}-B`, { trigger_event: 'date.reached', actions: [note(m, 'B')] });
    const a = await creerRegle(b, menage, `${m}-A`, { actions: [note(m, 'A'), { type: 'demarrer_automatisation', config: { rule_id: bId } }] });
    await b.admin.from('automation_rules').update({ actions: [note(m, 'B'), { type: 'demarrer_automatisation', config: { rule_id: a } }] }).eq('id', bId);
    await emettreNote(b, client);
    await attendreJournaux(b, a, 2);
    await attendreJournaux(b, bId, 2);
    await pause(1500);
    const ja = await journaux(b, a);
    const jb = await journaux(b, bId);
    expect(ja.map((l) => [l.action_type, l.result_success])).toEqual([['ajouter_note', true], ['demarrer_automatisation', true]]);
    expect(jb.map((l) => [l.action_type, (l.result_data as any)?.saute_code ?? null])).toEqual([['ajouter_note', null], ['demarrer_automatisation', 'boucle']]);
    expect((await notesMarquees(b, m)).map((n) => n.content.split(' ')[0]).sort()).toEqual(['A', 'B']);
  });

  it('[D-042] deal : A déplace S1→S2, B déplace S2→S1 → la boucle s’arrête (même d’un tick de 5 min à l’autre)', async () => {
    const m = marque('D-042');
    const client = await creerClient(b, menage, m);
    const { data: etapes } = await b.admin.from('pipeline_stages').select('id, pipeline_id, kind, position')
      .eq('org_id', b.orgA).is('archived_at', null).eq('kind', 'open').order('position');
    const [s1, s2] = etapes as Array<{ id: string; pipeline_id: string }>;
    expect(s1.pipeline_id).toBe(s2.pipeline_id);
    const a = await creerRegle(b, menage, `${m}-A`, { trigger_event: 'deal.stage_entered', stage_id: s1.id, pipeline_id: s1.pipeline_id, conditions: { stage_id: s1.id }, actions: [{ type: 'move_deal_stage', config: { stage_id: s2.id } }] });
    const bb = await creerRegle(b, menage, `${m}-B`, { trigger_event: 'deal.stage_entered', stage_id: s2.id, pipeline_id: s2.pipeline_id, conditions: { stage_id: s2.id }, actions: [{ type: 'move_deal_stage', config: { stage_id: s1.id } }] });
    const { data: deal, error } = await b.admin.from('deals').insert({ org_id: b.orgA, client_id: client, pipeline_id: s1.pipeline_id, stage_id: s1.id }).select('id').single();
    expect(error).toBeNull();
    menage.ajouter(() => b.admin.from('deals').delete().eq('id', deal!.id));
    const { traiterEvenementsPipeline, DELAI_GRACE_MS } = await import('../../../server/lib/pipelineEvenements');
    // 6 « ticks » de 5 min : chacun fait avancer la file du pipeline de NOTRE bureau.
    // Un événement n'est lu qu'après son délai de grâce : on le laisse passer.
    for (let tick = 0; tick < 6; tick++) {
      await pause(DELAI_GRACE_MS + 1500);
      await traiterEvenementsPipeline(b.admin, { orgId: b.orgA });
      await pause(2500);
      await vieillirJournaux(a, 5);
      await vieillirJournaux(bb, 5);
    }
    const deplacements = [...await journaux(b, a), ...await journaux(b, bb)]
      .filter((l) => l.result_success && (l.result_data as any)?.stage_id && !(l.result_data as any)?.deja_dans_l_etape);
    // A une fois (S1→S2), B une fois (S2→S1), puis A est dans la chaîne : arrêt.
    expect(deplacements.length, 'nombre de déplacements automatiques').toBe(2);
    const { data: final } = await b.admin.from('deals').select('stage_id').eq('id', deal!.id).single();
    expect(final!.stage_id).toBe(s1.id);
    const { data: restants } = await b.admin.from('pipeline_events').select('id').eq('deal_id', deal!.id).is('processed_at', null);
    expect(restants).toEqual([]);
  });
});
