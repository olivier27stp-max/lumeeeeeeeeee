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
import { marque } from '../../automations-suite/harnais/moteur';
import {
  preparerBureau, apiEnMemoire, ok, creerClient, creerJob, drapeau, type Api, type Bureau,
} from '../../automations-suite/integration/10-b-outils';
import { regle, emettre, attendreTaches, avancer, tachesDe, envoisAvec, texto } from './outils-b';

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

describe('point 15 — le TEXTE est modifié pendant qu’un client est dans le parcours', () => {
  it('[B15-01] le client reçoit une seule version du parcours (toute l’ancienne OU toute la nouvelle), pas un mélange', async () => {
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
    expect(sujets).toHaveLength(3);
    const versions = new Set(sujets.map((s) => s.split(' ')[0]));
    expect(versions.size, `le client a reçu : ${sujets.join(' | ')}`).toBe(1);
  });
});

describe('point 15 — le DÉLAI est modifié pendant qu’un client attend', () => {
  it('[B15-02] attente passée de 3 jours à 1 jour : le client déjà en attente suit le NOUVEAU délai', async () => {
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
    const jours = Math.round((Date.parse(apres.execute_at) - Date.now()) / (JOUR * 1000));
    expect(jours, `l’étape B reste prévue dans ${jours} jour(s) pour le client déjà en attente`).toBe(1);
  });
});

describe('point 15 — une étape est REMPLACÉE pendant qu’un client y attend', () => {
  it('[B15-03] le message B est supprimé puis recréé (nouvel identifiant) : le client en attente reçoit quand même la suite du parcours', async () => {
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
    // Attendu : le client n'est pas éjecté en silence du parcours — il reçoit B puis C.
    expect(sujets.length, `reçu : ${sujets.join(' | ')} ; tâches : ${taches.map((t) => `${t.step_id}=${t.status} (${t.last_error ?? ''})`).join(', ')}`).toBe(3);
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
