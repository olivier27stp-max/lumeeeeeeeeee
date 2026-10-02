/**
 * Point 15 — modifier une automatisation ACTIVE pendant que des clients y
 * sont : ancienne version ou nouvelle ? Et point 18 (moteur) : plusieurs
 * déclencheurs sur une même automatisation.
 *
 * La modification passe par la VRAIE route de l'éditeur
 * (PATCH /api/automations/rules/:id). Vrai moteur, pile locale, bureau A
 * « (b) » en bac à sable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { attendre, marque } from '../../automations-suite/harnais/moteur';
import {
  preparerBureau, apiEnMemoire, ok, creerClient, creerJob, drapeau, type Api, type Bureau,
} from '../../automations-suite/integration/10-b-outils';
import { regle, emettre, attendreTaches, avancer, tachesDe, journauxDe, envoisAvec, texto } from './outils-b';

let b: Bureau & { fuseau: string };
let api: Api;
const JOUR = 86_400;
const TOUT_LE_JOUR = { fenetre: { debut: 0, fin: 24 } };

beforeAll(async () => {
  b = await preparerBureau();
  const regles = await import('../../../server/routes/automation-rules');
  api = await apiEnMemoire(b, [{ routeur: regles.default }]);
});
afterAll(async () => { await api?.fermer(); });

const message = (id: string, texte: string, suivant: string | null) =>
  ({ id, type: 'action', action: { type: 'send_email', config: { subject: texte, body: `<p>${texte}</p>` } }, suivant });
const attente = (id: string, jours: number, suivant: string) => ({ id, type: 'attendre', delai_secondes: jours * JOUR, suivant });

function parcours(m: string, version: string, joursAvantB = 3) {
  const steps = [
    message('a', `${m} ${version} étape A`, 'w1'),
    attente('w1', joursAvantB, 'b'),
    message('b', `${m} ${version} étape B`, 'w2'),
    attente('w2', 3, 'c'),
    message('c', `${m} ${version} étape C`, null),
  ];
  return { steps, actions: steps.filter((s) => s.type === 'action').map((s) => (s as ReturnType<typeof message>).action) };
}

/*
 * ATTENTES AJUSTÉES par l'agent M (corrections). B avait écrit trois attentes possibles pour un comportement qui
 * restait à décider. La mission a tranché (point 15), et le moteur le fait (`actionCouranteDeLaTache`,
 * server/lib/automationEngine.ts) :
 *   1. une exécution en cours suit la version COURANTE du parcours à sa prochaine étape ;
 *   2. une étape qui attend garde l'échéance déjà fixée (modifier un délai ne déplace pas les attentes en cours) ;
 *   3. l'étape où un client attend a été supprimée ou remplacée → l'exécution s'arrête proprement, motif
 *      « étape retirée du parcours », sans erreur et sans sauter à une autre étape.
 */
describe('point 15 — le TEXTE est modifié pendant qu’un client est dans le parcours', () => {
  it('[B15-01] après la modification, le client ne reçoit plus AUCUN ancien message : chaque étape suivante part dans sa version courante', async () => {
    // (B attendait « une seule version pour tout le parcours » ; avant le correctif le client recevait
    //  « V1 étape A | V1 étape B | V2 étape C » — l'ANCIEN B après la modification. Décision : version courante.)
    const m = marque('B15-01');
    const c = await creerClient(b, m);
    const v1 = parcours(m, 'V1');
    const id = await regle(b, m, { trigger_event: 'note.added', ...v1, settings: TOUT_LE_JOUR });
    await emettre(b, 'note.added', 'client', c.id);
    await attendreTaches(b, id, 1);
    await avancer(b, id); // étape A part, l'étape B est planifiée (dans 3 jours)

    // Le propriétaire réécrit ses trois messages dans l'éditeur.
    const v2 = parcours(m, 'V2');
    const r = await api.appeler('PATCH', `/api/automations/rules/${id}`, { steps: v2.steps, actions: v2.actions });
    expect(r.status, JSON.stringify(r.json)).toBe(200);

    await avancer(b, id); // 3 jours plus tard : étape B
    await avancer(b, id); // 3 jours plus tard : étape C
    const sujets = (await envoisAvec(b, m)).map((e) => String(e.sujet).replace(m, '').trim());
    expect(sujets, `le client a reçu : ${sujets.join(' | ')}`).toEqual(['V1 étape A', 'V2 étape B', 'V2 étape C']);
  });
});

describe('point 15 — le DÉLAI est modifié pendant qu’un client attend', () => {
  it('[B15-02] attente passée de 3 jours à 1 jour : le client DÉJÀ en attente garde son échéance (3 jours) ; le nouveau délai vaut pour les attentes suivantes', async () => {
    // (B attendait « le nouveau délai » ; décision de la mission : l'échéance déjà fixée ne bouge pas.)
    const m = marque('B15-02');
    const c = await creerClient(b, m);
    const id = await regle(b, m, { trigger_event: 'note.added', ...parcours(m, 'V1', 3), settings: TOUT_LE_JOUR });
    await emettre(b, 'note.added', 'client', c.id);
    await attendreTaches(b, id, 1);
    await avancer(b, id); // étape A part, B planifiée à +3 jours
    const avant = (await tachesDe(b, id)).find((t) => t.step_id === 'b')!;
    expect(Math.round((Date.parse(avant.execute_at) - Date.now()) / (JOUR * 1000))).toBe(3);

    const v = parcours(m, 'V1', 1);
    const r = await api.appeler('PATCH', `/api/automations/rules/${id}`, { steps: v.steps, actions: v.actions });
    expect(r.status, JSON.stringify(r.json)).toBe(200);

    const apres = (await tachesDe(b, id)).find((t) => t.step_id === 'b')!;
    expect(apres.execute_at, 'l’échéance déjà fixée a bougé').toBe(avant.execute_at);
    expect(apres.status).toBe('pending');

    // Un NOUVEAU client, entré après la modification, attend bien 1 jour.
    const c2 = await creerClient(b, `${m} nouveau`);
    await emettre(b, 'note.added', 'client', c2.id);
    const aDeuxieme = await attendre(() => tachesDe(b, id), (l) => l.some((t) => t.entity_id === c2.id), 20_000);
    const etapeA = aDeuxieme.find((t) => t.entity_id === c2.id && t.step_id === 'a')!;
    // Seule l'étape A du nouveau client est rendue due : l'attente du premier ne bouge pas.
    await ok(b.admin.from('automation_scheduled_tasks').update({ execute_at: new Date(Date.now() - 1_000).toISOString() }).eq('id', etapeA.id), 'rendre due');
    const { traiterFile } = await import('../../automations-suite/harnais/moteur');
    await traiterFile(b.admin, b.orgA);
    const nouvelle = (await tachesDe(b, id)).find((t) => t.entity_id === c2.id && t.step_id === 'b' && t.status === 'pending');
    expect(nouvelle, 'étape B du nouveau client non planifiée').toBeTruthy();
    expect(Math.round((Date.parse(nouvelle!.execute_at) - Date.now()) / (JOUR * 1000))).toBe(1);
  });
});

describe('point 15 — une étape est REMPLACÉE pendant qu’un client y attend', () => {
  it('[B15-03] le message B est supprimé puis recréé (nouvel identifiant) : l’exécution du client en attente s’arrête proprement — « étape retirée du parcours » —, sans erreur et sans sauter à une autre étape', async () => {
    // (B attendait que le client reçoive quand même B puis C ; décision de la mission : arrêt propre, motif lisible.)
    const m = marque('B15-03');
    const c = await creerClient(b, m);
    const id = await regle(b, m, { trigger_event: 'note.added', ...parcours(m, 'V1'), settings: TOUT_LE_JOUR });
    await emettre(b, 'note.added', 'client', c.id);
    await attendreTaches(b, id, 1);
    await avancer(b, id); // A part, B planifiée

    // Dans l'éditeur : supprimer la carte B, en ajouter une neuve au même endroit.
    const steps = [
      message('a', `${m} V2 étape A`, 'w1'), attente('w1', 3, 'b2'),
      message('b2', `${m} V2 étape B`, 'w2'), attente('w2', 3, 'c'), message('c', `${m} V2 étape C`, null),
    ];
    const r = await api.appeler('PATCH', `/api/automations/rules/${id}`, { steps, actions: steps.filter((s) => s.type === 'action').map((s) => (s as ReturnType<typeof message>).action) });
    expect(r.status, JSON.stringify(r.json)).toBe(200);

    await avancer(b, id);
    await avancer(b, id);
    const sujets = (await envoisAvec(b, m)).map((e) => String(e.sujet).replace(m, '').trim());
    const taches = await tachesDe(b, id);
    const resume = `reçu : ${sujets.join(' | ')} ; tâches : ${taches.map((t) => `${t.step_id}=${t.status} (${t.last_error ?? ''})`).join(', ')}`;
    // Rien de plus que l'étape A : ni l'ancien B, ni un saut vers C.
    expect(sujets, resume).toEqual(['V1 étape A']);
    const arretee = taches.find((t) => t.step_id === 'b')!;
    expect(arretee.status, resume).toBe('cancelled');
    expect(arretee.action_config.motif_code).toBe('etape_retiree');
    // Aucune erreur, aucune reprise ; aucune autre tâche planifiée.
    expect(taches.filter((t) => t.status === 'failed' || t.status === 'pending'), resume).toEqual([]);
    const journal = await journauxDe(b, id);
    expect(journal.filter((j) => !j.result_success), resume).toEqual([]);
    const ligne = journal.find((j) => j.result_data?.saute_code === 'etape_retiree');
    expect(String(ligne?.result_data?.saute), resume).toMatch(/^Étape retirée du parcours/);
  });
});

describe('point 18 (moteur) — plusieurs déclencheurs sur une même automatisation', () => {
  it('[B18-01] l’éditeur peut enregistrer une automatisation à DEUX déclencheurs (logique OU)', async () => {
    const m = marque('B18-01');
    const r = await api.appeler('POST', '/api/automations/rules', {
      name: m, trigger_event: 'quote.sent', triggers: ['quote.sent', 'invoice.sent'], conditions: {}, delay_seconds: 0,
      actions: [{ type: 'create_task', config: { title: m } }], is_active: false,
    });
    const id = r.json?.id as string | undefined;
    const ligne = id ? await ok<Record<string, unknown>>(b.admin.from('automation_rules').select('*').eq('id', id).single(), 'règle') : {};
    if (id) await b.admin.from('automation_rules').delete().eq('id', id);
    // Aujourd'hui : une colonne `trigger_event` (un seul texte), le champ `triggers` est refusé ou ignoré.
    expect(JSON.stringify(ligne), `réponse ${r.status} : ${JSON.stringify(r.json).slice(0, 200)}`).toContain('invoice.sent');
  });
});

describe('point 13 — texto transactionnel à un client SUPPRIMÉ, drapeau « désabonnement par canal » allumé', () => {
  afterAll(async () => { await drapeau(b, 'auto_desabonnement_canal', false); });

  it('[B13-01] rappel de rendez-vous par texto : le client a été mis à la corbeille pendant le délai → rien ne part', async () => {
    await drapeau(b, 'auto_desabonnement_canal', true);
    const m = marque('B13-01');
    const c = await creerClient(b, m, { phone: '+12045550161' });
    const j = await creerJob(b, m, c.id);
    const debut = new Date(Date.now() + 5 * 86_400_000);
    const v = await ok<{ id: string }>(b.admin.from('schedule_events').insert({
      org_id: b.orgA, job_id: j.id, title: `Visite ${m}`, status: 'scheduled', created_by: b.users.proprioA,
      start_at: debut.toISOString(), end_at: new Date(debut.getTime() + 3600_000).toISOString(),
    }).select('id').single(), 'visite');
    const id = await regle(b, m, { trigger_event: 'appointment.created', delay_seconds: JOUR, actions: [texto(m, 'Rappel de votre rendez-vous')], settings: TOUT_LE_JOUR });
    await emettre(b, 'appointment.created', 'schedule_event', v.id, { job_id: j.id, client_id: c.id });
    await attendreTaches(b, id, 1);
    await ok(b.admin.rpc('soft_delete_client', { p_org_id: b.orgA, p_client_id: c.id }), 'client supprimé');
    await avancer(b, id);
    const [t] = await tachesDe(b, id);
    expect((await envoisAvec(b, m)).length, `tâche : ${t.status} (${t.last_error ?? ''})`).toBe(0);
  });
});
