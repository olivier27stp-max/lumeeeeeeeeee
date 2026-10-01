/**
 * [B] Combinaisons à risque de la matrice déclencheur × condition × action :
 * deux règles sur le même déclencheur balayé (réglages du déclencheur
 * portés par l'événement), chaînes d'actions qui produisent un déclencheur
 * (anti-boucle), pipeline.
 *
 * Matrice : tests/automations-suite/matrice/B.md (B-500 à B-599).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { marque, attendre } from '../harnais/moteur';
import { cibleProd } from '../harnais/bureau-test';
import {
  preparerBureau, apiEnMemoire, creerRegle, supprimerRegles, tachesTitrees, journaux,
  traiterPipeline, creerClient, creerJob, creerDeal, pipelineParDefaut, drapeau, ok, type Api, type Bureau,
} from './10-b-outils';

let b: Bureau & { fuseau: string };
let api: Api;
const regles: string[] = [];

beforeAll(async () => {
  b = await preparerBureau();
  const [evenements, regles_] = await Promise.all([
    import('../../../server/routes/automation-events'),
    import('../../../server/routes/automation-rules'),
  ]);
  api = await apiEnMemoire(b, [{ routeur: evenements.default }, { routeur: regles_.default }]);
});
afterEach(async () => { await supprimerRegles(b.admin, regles.splice(0)); });
afterAll(async () => {
  await supprimerRegles(b.admin, regles);
  await api?.fermer();
});

async function regle(nom: string, declencheur: string, conditions: Record<string, unknown>, actions?: Array<{ type: string; config: Record<string, unknown> }>) {
  const id = await creerRegle(api, { nom, declencheur, conditions, actions: actions ?? [{ type: 'create_task', config: { title: nom } }] });
  regles.push(id);
  return id;
}

describe('[B] déclencheurs balayés : deux règles, réglages différents', () => {
  it('[B-500] client.inactive : deux règles au même seuil (6 mois) mais plafonds horaires différents — les DEUX partent', async () => {
    const m = marque('B-500');
    await drapeau(b, 'auto_client_inactif', true);
    const client = await creerClient(b, m);
    await creerJob(b, m, client.id, { status: 'completed', completed_at: new Date(Date.now() - 200 * 86_400_000).toISOString() });
    const a = await regle(`${m} plafond 25`, 'client.inactive', { mois: 6, max_par_heure: 25 });
    const c = await regle(`${m} plafond 50`, 'client.inactive', { mois: 6, max_par_heure: 50 });
    const { balayerEntreprise } = await import('../../../server/lib/client-inactif');
    await balayerEntreprise(b.admin, b.orgA);
    const lien = (t: Array<{ linked_entity_id: string | null }>) => t.filter((x) => x.linked_entity_id === client.id);
    const t25 = lien(await attendre(() => tachesTitrees(b.admin, b.orgA, `${m} plafond 25`), (t) => lien(t).length > 0));
    expect(t25).toHaveLength(1);
    const t50 = lien(await attendre(() => tachesTitrees(b.admin, b.orgA, `${m} plafond 50`), (t) => lien(t).length > 0, 8000));
    expect(t50, `la règle au plafond 50 n'est jamais partie — journal : ${JSON.stringify(await journaux(b.admin, c))}`).toHaveLength(1);
    void a;
  });

  it('[B-501] deal.stage_idle : la règle « 7 jours » ne part pas au 5e jour sur l’alerte d’une règle « 3 jours » de la même étape', async () => {
    const m = marque('B-501');
    const pipe = await pipelineParDefaut(b);
    const e2 = pipe.ouvertes[1];
    const { data: autres } = await b.admin.from('automation_rules').select('org_id')
      .eq('trigger_event', 'deal.stage_idle').eq('is_active', true).is('deleted_at', null).neq('org_id', b.orgA);
    const { data: sable } = await b.admin.from('orgs_envois_simules').select('org_id');
    // En PROD : le serveur fait déjà cet appel à chaque passage, sans doublon possible.
    if (!cibleProd()) expect((autres ?? []).filter((r) => !(sable ?? []).some((s) => s.org_id === r.org_id)), 'appel global refusé').toHaveLength(0);
    const client = await creerClient(b, m);
    const deal = await creerDeal(b, client.id, e2.id, pipe.id);
    await traiterPipeline(b);
    await ok(b.admin.from('deals').update({ last_activity_at: new Date(Date.now() - 5 * 86_400_000).toISOString() }).eq('id', deal.id), 'deal endormi 5 j');
    const sept = await regle(`${m} 7 jours`, 'deal.stage_idle', { stage_id: e2.id }, [{ type: 'create_task', config: { title: `${m} 7 jours`, body: 'Pour {client_name}' } }]);
    const trois = await regle(`${m} 3 jours`, 'deal.stage_idle', { stage_id: e2.id, idle_days: 3 }, [{ type: 'create_task', config: { title: `${m} 3 jours`, body: 'Pour {client_name}' } }]);
    await ok(b.admin.rpc('pipeline_detecter_stagnation'), 'détection');
    await traiterPipeline(b);
    const moi = (t: Array<{ description: string | null }>) => t.filter((x) => x.description === `Pour Cliente ${m}`);
    expect(moi(await attendre(() => tachesTitrees(b.admin, b.orgA, `${m} 3 jours`), (t) => moi(t).length > 0))).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 1500));
    const log7 = (await journaux(b.admin, sept)).filter((l) => l.entity_id === deal.id);
    expect(log7, 'la règle « 7 jours » est partie au 5e jour').toHaveLength(0);
    void trois;
  });
});

describe('[B] chaînes : une action qui produit un déclencheur', () => {
  it('[B-502] client.tagged → ajouter une étiquette : la règle ne se relance pas elle-même (chaîne anti-boucle)', async () => {
    const m = marque('B-502');
    const client = await creerClient(b, m);
    const tag = `Déclic-${Date.now().toString(36)}`;
    const auto = `Auto-${Date.now().toString(36)}`;
    const id = await regle(m, 'client.tagged', {}, [
      { type: 'ajouter_etiquette', config: { etiquette: auto } },
      { type: 'create_task', config: { title: `${m} passage` } },
    ]);
    await ok(b.admin.from('client_tags').insert({ client_id: client.id, tag }), 'étiquette');
    const r = await api.appeler('POST', '/api/automations/events/client-tagged', { clientId: client.id, tag });
    expect(r.status).toBe(200);
    await attendre(() => tachesTitrees(b.admin, b.orgA, `${m} passage`), (t) => t.length > 0);
    await new Promise((res) => setTimeout(res, 2000));
    expect(await tachesTitrees(b.admin, b.orgA, `${m} passage`)).toHaveLength(1);
    const { data: tags } = await b.admin.from('client_tags').select('tag').eq('client_id', client.id).order('tag');
    expect((tags ?? []).map((t) => t.tag).sort()).toEqual([auto, tag].sort());
    // L'étiquette posée par l'automatisation a bien été annoncée… et ignorée par la règle d'origine.
    const { data: act } = await b.admin.from('activity_log').select('metadata').eq('org_id', b.orgA).eq('entity_id', client.id).eq('event_type', 'client_tagged');
    expect((act ?? []).some((a) => (a.metadata as { tag?: string }).tag === auto)).toBe(true);
    expect(await journaux(b.admin, id)).toHaveLength(2);
  });

  it('[B-503] étiquette posée par A → règle B (client.tagged sur cette étiquette) part, avec A dans sa chaîne', async () => {
    const m = marque('B-503');
    const client = await creerClient(b, m);
    const tag = `Source-${Date.now().toString(36)}`;
    const relais = `Relais-${Date.now().toString(36)}`;
    await regle(`${m} A`, 'client.tagged', { tag }, [{ type: 'ajouter_etiquette', config: { etiquette: relais } }]);
    const bId = await regle(`${m} B`, 'client.tagged', { tag: relais }, [{ type: 'create_task', config: { title: `${m} B a suivi` } }]);
    await ok(b.admin.from('client_tags').insert({ client_id: client.id, tag }), 'étiquette');
    expect((await api.appeler('POST', '/api/automations/events/client-tagged', { clientId: client.id, tag })).status).toBe(200);
    const [t] = await attendre(() => tachesTitrees(b.admin, b.orgA, `${m} B a suivi`), (x) => x.length > 0);
    expect(t).toMatchObject({ linked_entity_type: 'client', linked_entity_id: client.id });
    expect((await journaux(b.admin, bId))[0]).toMatchObject({ trigger_event: 'client.tagged', result_success: true });
  });

  it('[B-504] move_deal_stage : deux règles e2→e3 et e3→e2 ne se renvoient pas le deal indéfiniment (chaîne anti-boucle)', async () => {
    const m = marque('B-504');
    const pipe = await pipelineParDefaut(b);
    const [e1, e2, e3] = pipe.ouvertes;
    const client = await creerClient(b, m);
    const deal = await creerDeal(b, client.id, e1.id, pipe.id);
    await traiterPipeline(b);
    // « Ré-entrée » : l'anti-doublon de 2 min ne masque rien, seule la chaîne peut arrêter la boucle.
    const avance = await creerRegle(api, { nom: `${m} avance`, declencheur: 'deal.stage_entered', conditions: { stage_id: e2.id }, settings: { reentree: true }, actions: [{ type: 'move_deal_stage', config: { cible: 'etape', stage_id: e3.id } }] });
    const recule = await creerRegle(api, { nom: `${m} recule`, declencheur: 'deal.stage_entered', conditions: { stage_id: e3.id }, settings: { reentree: true }, actions: [{ type: 'move_deal_stage', config: { cible: 'etape', stage_id: e2.id } }] });
    regles.push(avance, recule);
    await ok(b.admin.from('deals').update({ stage_id: e2.id }).eq('id', deal.id), 'étape 2');
    // Des passages de la file, puis d'autres APRÈS la fenêtre anti-doublon de
    // 2 min (en production : un tick toutes les 5 min, donc à chaque tick).
    const passer = async (n: number) => { for (let i = 0; i < n; i++) { await traiterPipeline(b); await new Promise((r) => setTimeout(r, 1200)); } };
    await passer(6);
    await new Promise((r) => setTimeout(r, 125_000));
    await passer(4);
    const la = await journaux(b.admin, avance);
    const lr = await journaux(b.admin, recule);
    expect(la.length, `ping-pong : « avance » a déplacé le deal ${la.length} fois`).toBe(1);
    expect(lr).toHaveLength(1);
    expect([...la, ...lr].every((l) => l.result_success)).toBe(true);
    // Le deal est revenu en e2 par « recule », et y reste.
    const { data } = await b.admin.from('deals').select('stage_id').eq('id', deal.id).single();
    expect(data!.stage_id).toBe(e2.id);
    // L'entrée provoquée par l'automatisation porte sa chaîne.
    const { data: evs } = await b.admin.from('pipeline_events').select('payload').eq('deal_id', deal.id).eq('type', 'deal.stage_entered').order('id');
    const chaines = (evs ?? []).map((e) => (e.payload as { chaine?: string[] }).chaine ?? null);
    expect(chaines).toContainEqual([avance]);
    expect(chaines).toContainEqual([avance, recule]);
  }, 240_000);
});
