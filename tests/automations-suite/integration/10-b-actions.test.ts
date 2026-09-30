/**
 * [B] Chaque action (24 types) et son EFFET EXACT en base ou dans
 * `envois_simules` (ce qui AURAIT été envoyé, mot pour mot).
 *
 * Déclencheur représentatif : « Note ajoutée » (POST /api/activity-notes, le
 * chemin humain) pour les actions sur un client ; « Visite créée » (trigger
 * SQL) pour le rendez-vous ; « Entrée dans l'étape » (pipeline_events) pour
 * les opportunités ; « Champ modifié » (PUT /api/custom-values) pour les
 * documents en brouillon (facture, soumission) et le job.
 *
 * Les règles sont publiées par la vraie route de l'éditeur, SAUF les trois
 * actions que l'éditeur ne propose pas mais que les préréglages portent
 * (`update_status`, `send_notification`, `log_activity` en règle simple) :
 * elles sont insérées comme le seeder des préréglages le fait.
 *
 * Matrice : tests/automations-suite/matrice/B.md (B-100 à B-199).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { marque, attendre, envoisSimules, appelsTwilio, appelsHttpBloques } from '../harnais/moteur';
import {
  preparerBureau, apiEnMemoire, creerRegle, supprimerRegles, tachesTitrees, journaux, tachesPlanifiees,
  traiterBase, traiterPipeline, creerClient, creerJob, creerDevis, creerFacture, creerDeal, pipelineParDefaut,
  creerChamp, ecrireChamps, ok, type Api, type Bureau,
} from './10-b-outils';

let b: Bureau & { fuseau: string };
let api: Api;
const regles: string[] = [];
let numeroBureau = '';

beforeAll(async () => {
  b = await preparerBureau();
  const canal = await ok<{ phone_number: string }>(b.admin.from('communication_channels').select('phone_number')
    .eq('org_id', b.orgA).eq('channel_type', 'sms').eq('status', 'active').limit(1).single(), 'canal texto');
  numeroBureau = canal.phone_number;
  const [notes, regles_, champs] = await Promise.all([
    import('../../../server/routes/activity-notes'),
    import('../../../server/routes/automation-rules'),
    import('../../../server/routes/custom-fields'),
  ]);
  api = await apiEnMemoire(b, [{ routeur: notes.default }, { routeur: regles_.default }, { routeur: champs.default }]);
});
// Une règle laissée active réagirait aux événements des tests suivants.
afterEach(async () => {
  await supprimerRegles(b.admin, regles.splice(0));
});
afterAll(async () => {
  await supprimerRegles(b.admin, regles);
  await api?.fermer();
});

async function regle(nom: string, declencheur: string, actions: Array<{ type: string; config: Record<string, unknown> }>, extra: { conditions?: Record<string, unknown>; delay_seconds?: number } = {}) {
  const id = await creerRegle(api, { nom, declencheur, actions, ...extra });
  regles.push(id);
  return id;
}

/** Insertion directe, comme le seeder des préréglages (actions hors éditeur). */
async function reglePrereglee(nom: string, declencheur: string, actions: Array<{ type: string; config: Record<string, unknown> }>) {
  const r = await ok<{ id: string }>(b.admin.from('automation_rules').insert({
    org_id: b.orgA, name: nom, trigger_event: declencheur, conditions: {}, delay_seconds: 0, actions, is_active: true, is_preset: false,
  }).select('id').single(), 'règle préréglée');
  regles.push(r.id);
  return r.id;
}

async function noter(clientId: string, texte = 'Note de test') {
  const r = await api.appeler('POST', '/api/activity-notes', { entityType: 'client', entityId: clientId, body: texte });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
}

/** Le journal définitif (une action lente est d'abord « en attente du résultat »). */
async function journalFinal(ruleId: string, n = 1) {
  return attendre(() => journaux(b.admin, ruleId), (l) => l.length >= n && l.every((x) => x.result_success || !/attente|^en cours$/.test(String(x.result_error ?? ''))), 20_000);
}

describe('[B] actions de communication (envois simulés, mot pour mot)', () => {
  it('[B-100] send_email : destinataire = courriel du client, objet et corps rendus, suivi, journal email_sent, aucun fournisseur touché', async () => {
    const m = marque('B-100');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, m);
    const twilioAvant = appelsTwilio.length;
    const httpAvant = appelsHttpBloques().length;
    const id = await regle(m, 'note.added', [{ type: 'send_email', config: {
      subject: `Merci {client_first_name} ${m}`, body: '<p>Bonjour {client_first_name} {client_last_name}, de la part de {company_name}.</p>', type_envoi: 'transactionnel',
    } }]);
    await noter(client.id);
    const [log] = await journalFinal(id);
    expect(log, JSON.stringify(log)).toMatchObject({ action_type: 'send_email', result_success: true, entity_type: 'client', entity_id: client.id });
    expect(log.result_data).toMatchObject({ to: client.email, subject: `Merci Cliente ${m}` });
    const envois = (await envoisSimules(b.admin, b.orgA, depuis)).filter((e) => e.sujet === `Merci Cliente ${m}`);
    expect(envois).toHaveLength(1);
    const [e] = envois;
    expect(e.canal).toBe('courriel');
    expect(e.destinataire).toBe(client.email);
    expect(e.corps).toContain(`Bonjour Cliente ${m}, de la part de Nettoyage Test A.`);
    expect(e.meta).toMatchObject({ raison: 'entreprise', suivi: { orgId: b.orgA, entityType: 'client', entityId: client.id } });
    // Transactionnel : pas d'en-tête de désabonnement commercial.
    expect((e.meta as { headers?: Record<string, string> }).headers?.['List-Unsubscribe']).toBeUndefined();
    const { data: act } = await b.admin.from('activity_log').select('event_type, metadata').eq('org_id', b.orgA)
      .eq('entity_id', client.id).eq('event_type', 'email_sent');
    expect(act).toEqual([expect.objectContaining({ metadata: expect.objectContaining({ to: client.email, subject: `Merci Cliente ${m}`, source: 'automation' }) })]);
    expect(appelsTwilio.length).toBe(twilioAvant);
    expect(appelsHttpBloques().length).toBe(httpAvant);
  });

  it('[B-101] send_sms : E.164 du client, corps final rendu, expéditeur = numéro du bureau, message sortant écrit dans la conversation', async () => {
    const m = marque('B-101');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, m, { phone: '+15555550147' });
    const id = await regle(m, 'note.added', [{ type: 'send_sms', config: { body: `Bonjour {client_first_name}, ${m}`, type_envoi: 'transactionnel' } }]);
    await noter(client.id);
    const [log] = await journalFinal(id);
    expect(log, JSON.stringify(log)).toMatchObject({ action_type: 'send_sms', result_success: true });
    const envois = (await envoisSimules(b.admin, b.orgA, depuis)).filter((e) => e.canal === 'sms' && String(e.corps).includes(m));
    expect(envois).toHaveLength(1);
    expect(envois[0]).toMatchObject({ destinataire: '+15555550147', corps: `Bonjour Cliente, ${m}` });
    expect((envois[0].meta as { from?: string }).from).toBe(numeroBureau);
    const { data: msg } = await b.admin.from('messages').select('direction, message_text, status, phone_number, client_id, provider_message_id')
      // Rattaché à la conversation du NUMÉRO (déjà ouverte par un passage précédent, peut-être).
      .eq('org_id', b.orgA).eq('message_text', `Bonjour Cliente, ${m}`);
    expect(msg).toEqual([expect.objectContaining({ direction: 'outbound', message_text: `Bonjour Cliente, ${m}`, status: 'sent', phone_number: '+15555550147' })]);
    expect(String(msg![0].provider_message_id)).toMatch(/^SM_SIMULE_/);
  });

  it('[B-102] send_sms marketing : la mention de désabonnement (STOP) est ajoutée au corps final', async () => {
    const m = marque('B-102');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, m, { phone: '+15555550148' });
    const id = await regle(m, 'note.added', [{ type: 'send_sms', config: { body: `Promo ${m}`, type_envoi: 'marketing' } }]);
    await noter(client.id);
    const [log] = await journalFinal(id);
    expect(log, JSON.stringify(log)).toMatchObject({ result_success: true });
    const [e] = (await envoisSimules(b.admin, b.orgA, depuis)).filter((x) => x.canal === 'sms' && String(x.corps).includes(m));
    expect(e.destinataire).toBe('+15555550148');
    expect(String(e.corps).startsWith(`Promo ${m}`)).toBe(true);
    expect(String(e.corps)).toMatch(/STOP/);
  });

  it('[B-103] create_notification (toute l’équipe) : une ligne notifications type automation, titre et corps rendus', async () => {
    const m = marque('B-103');
    const client = await creerClient(b, m);
    const id = await regle(m, 'note.added', [{ type: 'create_notification', config: { title: `Note sur {client_name} ${m}`, body: 'À rappeler' } }]);
    await noter(client.id);
    const [log] = await journalFinal(id);
    expect(log, JSON.stringify(log)).toMatchObject({ result_success: true });
    const { data } = await b.admin.from('notifications').select('type, title, body, reference_id, user_id').eq('org_id', b.orgA).like('title', `%${m}%`);
    expect(data).toEqual([expect.objectContaining({ type: 'automation', title: `Note sur Cliente ${m} ${m}`, body: 'À rappeler', reference_id: client.id })]);
  });

  it('[B-104] create_notification destinataire = propriétaire : une ligne ciblée par propriétaire actif', async () => {
    const m = marque('B-104');
    const client = await creerClient(b, m);
    const id = await regle(m, 'note.added', [{ type: 'create_notification', config: { title: `Pour le proprio ${m}`, body: 'x', destinataire: 'proprietaire' } }]);
    await noter(client.id);
    const [log] = await journalFinal(id);
    expect(log, JSON.stringify(log)).toMatchObject({ result_success: true });
    const { data } = await b.admin.from('notifications').select('user_id, title').eq('org_id', b.orgA).like('title', `%${m}%`);
    expect(data).toEqual([expect.objectContaining({ user_id: b.users.proprioA })]);
  });

  it('[B-105] send_notification (alias des préréglages) : même effet que create_notification', async () => {
    const m = marque('B-105');
    const client = await creerClient(b, m);
    const id = await reglePrereglee(m, 'note.added', [{ type: 'send_notification', config: { title: `Alias ${m}`, body: 'b' } }]);
    await noter(client.id);
    const [log] = await journalFinal(id);
    expect(log, JSON.stringify(log)).toMatchObject({ action_type: 'send_notification', result_success: true });
    const { data } = await b.admin.from('notifications').select('type, title').eq('org_id', b.orgA).eq('title', `Alias ${m}`);
    expect(data).toEqual([{ type: 'automation', title: `Alias ${m}` }]);
  });

  it('[B-106] envoyer_slack (indisponible) : échec propre, message clair, rien publié', async () => {
    const m = marque('B-106');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, m);
    // L'éditeur refuse de la publier : insertion directe (règle d'avant l'indisponibilité).
    const id = await reglePrereglee(m, 'note.added', [{ type: 'envoyer_slack', config: { body: `Slack ${m}` } }]);
    await noter(client.id);
    const [log] = await journalFinal(id);
    expect(log, JSON.stringify(log)).toMatchObject({ action_type: 'envoyer_slack', result_success: false });
    expect(log.result_error).toContain('pas encore disponible');
    expect((await envoisSimules(b.admin, b.orgA, depuis)).filter((e) => String(e.corps ?? '').includes(m))).toHaveLength(0);
  });

  it('[B-107] webhook : POST vers l’URL, corps JSON = org, entité et variables résolues (envoi simulé)', async () => {
    const m = marque('B-107');
    const depuis = new Date().toISOString();
    const client = await creerClient(b, m);
    const url = `https://93.184.215.14/qa-b107-${Date.now()}`;
    const id = await regle(m, 'note.added', [{ type: 'webhook', config: { url } }]);
    await noter(client.id);
    const [log] = await journalFinal(id);
    expect(log, JSON.stringify(log)).toMatchObject({ action_type: 'webhook', result_success: true, result_data: { status: 200 } });
    const envois = (await envoisSimules(b.admin, b.orgA, depuis)).filter((e) => e.canal === 'webhook' && e.destinataire === url);
    expect(envois).toHaveLength(1);
    const corps = JSON.parse(String(envois[0].corps));
    expect(corps).toMatchObject({ org_id: b.orgA, entity_type: 'client', entity_id: client.id });
    expect(corps.data).toMatchObject({ client_name: `Cliente ${m}`, client_email: client.email, company_name: 'Nettoyage Test A' });
  });
});

describe('[B] actions sur la fiche client', () => {
  it('[B-110] create_task avec priorité, échéance et responsable : ligne tasks exacte', async () => {
    const m = marque('B-110');
    const client = await creerClient(b, m);
    const id = await regle(m, 'note.added', [{ type: 'create_task', config: { title: `Rappeler {client_name} ${m}`, body: 'Détail', priorite: 'high', echeance_jours: '2', membre_id: b.users.techA } }]);
    await noter(client.id);
    await journalFinal(id);
    const taches = await tachesTitrees(b.admin, b.orgA, `Rappeler Cliente ${m} ${m}`);
    const echeance = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect(taches).toEqual([expect.objectContaining({
      description: 'Détail', status: 'open', priority: 'high', assignee_user_id: b.users.techA, created_by: b.users.proprioA,
      linked_entity_type: 'client', linked_entity_id: client.id, due_date: echeance,
    })]);
  });

  it('[B-111] create_task avec un membre d’une AUTRE entreprise : échec, aucune tâche', async () => {
    const m = marque('B-111');
    const client = await creerClient(b, m);
    const id = await regle(m, 'note.added', [{ type: 'create_task', config: { title: m, membre_id: b.users.proprioB } }]);
    await noter(client.id);
    const [log] = await journalFinal(id);
    expect(log, JSON.stringify(log)).toMatchObject({ result_success: false, result_error: "Ce membre n'appartient pas a l'organisation." });
    expect(await tachesTitrees(b.admin, b.orgA, m)).toHaveLength(0);
  });

  it('[B-112] ajouter_etiquette : ligne client_tags ; [B-113] retirer_etiquette : ligne supprimée', async () => {
    const m = marque('B-112');
    const client = await creerClient(b, m);
    const tag = `Fidèle ${Date.now().toString(36)}`;
    const id = await regle(m, 'note.added', [{ type: 'ajouter_etiquette', config: { etiquette: tag } }]);
    await noter(client.id);
    const [log] = await journalFinal(id);
    expect(log, JSON.stringify(log)).toMatchObject({ result_success: true });
    const { data: poses } = await b.admin.from('client_tags').select('tag').eq('client_id', client.id);
    expect(poses).toEqual([{ tag }]);
    // Retrait par une autre règle, déclenchée par une 2e note (après un délai : anti-doublon 2 min par règle).
    await ok(b.admin.from('automation_rules').update({ is_active: false }).eq('id', id), 'pause');
    const id2 = await regle(`${m} retrait`, 'note.added', [{ type: 'retirer_etiquette', config: { etiquette: tag } }]);
    await noter(client.id, 'Deuxième note');
    const [log2] = await journalFinal(id2);
    expect(log2).toMatchObject({ action_type: 'retirer_etiquette', result_success: true });
    const { data: restes } = await b.admin.from('client_tags').select('tag').eq('client_id', client.id);
    expect(restes).toEqual([]);
  });

  it('[B-114] modifier_client : statut, source (rendue) et valeur écrits sur la fiche', async () => {
    const m = marque('B-114');
    const client = await creerClient(b, m);
    const id = await regle(m, 'note.added', [{ type: 'modifier_client', config: { statut: 'inactive', source: 'Salon {company_name}', valeur: '1500' } }]);
    await noter(client.id);
    const [log] = await journalFinal(id);
    expect(log, JSON.stringify(log)).toMatchObject({ result_success: true });
    const { data } = await b.admin.from('clients').select('status, source, value').eq('id', client.id).single();
    expect(data).toMatchObject({ status: 'inactive', source: 'Salon Nettoyage Test A' });
    expect(Number(data!.value)).toBe(1500);
  });

  it('[B-115] assigner_responsable (seulement si vide) : assigne quand vide, ne touche pas un responsable existant', async () => {
    const m = marque('B-115');
    const vide = await creerClient(b, `${m} vide`);
    const pris = await creerClient(b, `${m} pris`, { assigned_to: b.users.proprioA });
    const id = await regle(m, 'note.added', [{ type: 'assigner_responsable', config: { membre_id: b.users.techA, seulement_si_vide: 'true' } }]);
    await noter(vide.id);
    await noter(pris.id);
    const logs = await journalFinal(id, 2);
    expect(logs.every((l) => l.result_success)).toBe(true);
    const { data } = await b.admin.from('clients').select('id, assigned_to').in('id', [vide.id, pris.id]);
    const parId = Object.fromEntries((data ?? []).map((c) => [c.id, c.assigned_to]));
    expect(parId[vide.id]).toBe(b.users.techA);
    expect(parId[pris.id]).toBe(b.users.proprioA);
    expect(logs.find((l) => l.entity_id === pris.id)!.result_data).toEqual({ ignore: 'un responsable était déjà assigné' });
  });

  it('[B-116] ajouter_note : ligne notes rendue, rattachée au client', async () => {
    const m = marque('B-116');
    const client = await creerClient(b, m);
    const id = await regle(m, 'note.added', [{ type: 'ajouter_note', config: { body: `Suivi auto pour {client_name} ${m}` } }]);
    await noter(client.id);
    await journalFinal(id);
    const { data } = await b.admin.from('notes').select('content, entity_type, entity_id').eq('org_id', b.orgA).like('content', `%${m}%`);
    expect(data).toEqual([{ content: `Suivi auto pour Cliente ${m} ${m}`, entity_type: 'client', entity_id: client.id }]);
  });

  it('[B-117] update_custom_field : valeur écrite sur le champ (texte), sans relancer « champ modifié »', async () => {
    const m = marque('B-117');
    const champ = await creerChamp(api, { label: `Segment ${Date.now().toString(36)}`, field_type: 'single_line', object_type: 'client' });
    const client = await creerClient(b, m);
    // Une règle « champ modifié » sur ce champ : elle ne doit PAS partir (source automation).
    const temoin = await regle(`${m} témoin`, 'custom_field.changed', [{ type: 'create_task', config: { title: `${m} boucle` } }], { conditions: { field_id: champ.id } });
    const id = await regle(m, 'note.added', [{ type: 'update_custom_field', config: { field_id: champ.id, value: 'Premium' } }]);
    await noter(client.id);
    const [log] = await journalFinal(id);
    expect(log, JSON.stringify(log)).toMatchObject({ result_success: true });
    const { data } = await b.admin.from('custom_field_values').select('value_text, client_id, object_type').eq('field_id', champ.id).eq('client_id', client.id);
    expect(data).toEqual([expect.objectContaining({ value_text: 'Premium', object_type: 'client' })]);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await journaux(b.admin, temoin)).toHaveLength(0);
  });

  it('[B-118] request_review (déclencheur job terminé) : sondage, courriel + texto simulés, review_requests et journal', async () => {
    const m = marque('B-118');
    const depuis = new Date().toISOString();
    await ok(b.admin.from('company_settings').update({ review_enabled: true, google_review_url: 'https://g.page/r/qa-lume-test' }).eq('org_id', b.orgA), 'réglages avis');
    const client = await creerClient(b, m, { phone: '+15555550149' });
    const job = await creerJob(b, m, client.id);
    const id = await regle(m, 'job.completed', [{ type: 'request_review', config: {} }]);
    await ok(b.admin.from('jobs').update({ status: 'completed' }).eq('id', job.id), 'job terminé');
    await traiterBase(b);
    const [log] = await journalFinal(id);
    expect(log, JSON.stringify(log)).toMatchObject({ action_type: 'request_review', result_success: true });
    const { data: sondages } = await b.admin.from('satisfaction_surveys').select('id, client_id, job_id, token').eq('org_id', b.orgA).eq('job_id', job.id);
    expect(sondages).toHaveLength(1);
    expect(sondages![0].client_id).toBe(client.id);
    const { data: demandes } = await b.admin.from('review_requests').select('client_id, job_id, survey_id, status').eq('org_id', b.orgA).eq('job_id', job.id);
    expect(demandes).toEqual([expect.objectContaining({ client_id: client.id, survey_id: sondages![0].id, status: 'sent' })]);
    const envois = (await envoisSimules(b.admin, b.orgA, depuis)).filter((e) => e.destinataire === client.email || e.destinataire === '+15555550149');
    expect(envois.map((e) => e.canal).sort()).toEqual(['courriel', 'sms']);
    for (const e of envois) expect(String(e.corps)).toContain(`/survey/${sondages![0].token}`);
  });

  it('[B-119] request_review sur un déclencheur CLIENT : la demande est rattachée au client et l’anti-doublon 7 jours s’applique', async () => {
    const m = marque('B-119');
    await ok(b.admin.from('company_settings').update({ review_enabled: true, google_review_url: 'https://g.page/r/qa-lume-test' }).eq('org_id', b.orgA), 'réglages avis');
    const client = await creerClient(b, m, { phone: '+15555550151' });
    const id = await regle(m, 'note.added', [{ type: 'request_review', config: {} }]);
    await noter(client.id, 'Première note');
    const [l1] = await journalFinal(id);
    expect(l1, JSON.stringify(l1)).toMatchObject({ result_success: true });
    const { data: d1 } = await b.admin.from('review_requests').select('client_id, status').eq('org_id', b.orgA).eq('client_id', client.id);
    expect(d1, 'la demande d’avis n’est pas rattachée au client').toEqual([expect.objectContaining({ client_id: client.id, status: 'sent' })]);
    // 2e note : autre règle identique (la 1re est couverte par l'anti-doublon de 2 min).
    await ok(b.admin.from('automation_rules').update({ is_active: false }).eq('id', id), 'pause');
    const id2 = await regle(`${m} bis`, 'note.added', [{ type: 'request_review', config: {} }]);
    await noter(client.id, 'Deuxième note');
    const [l2] = await journalFinal(id2);
    expect(l2).toMatchObject({ result_success: false, result_error: 'A review request was already sent to this client in the last 7 days.' });
    const { count } = await b.admin.from('review_requests').select('id', { count: 'exact', head: true }).eq('org_id', b.orgA).eq('client_id', client.id);
    expect(count).toBe(1);
  });
});

describe('[B] actions sur un rendez-vous, un job, une opportunité, un document', () => {
  it('[B-120] modifier_statut_rendezvous (visite créée) : schedule_events.status écrit', async () => {
    const m = marque('B-120');
    const client = await creerClient(b, m);
    const job = await creerJob(b, m, client.id);
    const id = await regle(m, 'appointment.created', [{ type: 'modifier_statut_rendezvous', config: { statut: 'completed' } }], { conditions: { title: `Visite ${m}` } });
    const debut = new Date(Date.now() + 2 * 86_400_000);
    const visite = await ok<{ id: string }>(b.admin.from('schedule_events').insert({
      org_id: b.orgA, job_id: job.id, title: `Visite ${m}`, status: 'scheduled', created_by: b.users.proprioA,
      start_at: debut.toISOString(), end_at: new Date(debut.getTime() + 3600_000).toISOString(),
    }).select('id').single(), 'visite');
    await traiterBase(b);
    const [log] = await journalFinal(id);
    expect(log, JSON.stringify(log)).toMatchObject({ result_success: true, result_data: { statut: 'completed' } });
    const { data } = await b.admin.from('schedule_events').select('status').eq('id', visite.id).single();
    expect(data!.status).toBe('completed');
  });

  it('[B-121] update_status (préréglages) : jobs.status écrit ; table hors liste blanche refusée', async () => {
    const m = marque('B-121');
    const champ = await creerChamp(api, { label: `Suivi job ${Date.now().toString(36)}`, field_type: 'single_line', object_type: 'job' });
    const client = await creerClient(b, m);
    const job = await creerJob(b, m, client.id);
    const id = await reglePrereglee(m, 'custom_field.changed', [
      { type: 'update_status', config: { table: 'jobs', status: 'in_progress' } },
      { type: 'update_status', config: { table: 'memberships', status: 'active' } },
    ]);
    await ok(b.admin.from('automation_rules').update({ conditions: { field_id: champ.id } }).eq('id', id), 'condition');
    await ecrireChamps(api, 'job', job.id, [{ field_id: champ.id, value: 'go' }]);
    const logs = await journalFinal(id, 2);
    const [ok1, refus] = [logs.find((l) => (l.result_data as { table?: string } | null)?.table === 'jobs'), logs.find((l) => !l.result_success)];
    expect(ok1).toBeTruthy();
    expect(refus!.result_error).toBe('Table not allowed for update_status: memberships');
    const { data } = await b.admin.from('jobs').select('status').eq('id', job.id).single();
    expect(data!.status).toBe('in_progress');
  });

  it('[B-122] log_activity (préréglages) : ligne activity_log avec le type et les métadonnées', async () => {
    const m = marque('B-122');
    const client = await creerClient(b, m);
    const id = await reglePrereglee(m, 'note.added', [{ type: 'log_activity', config: { event_type: 'qa_journal_b122', metadata: { marque: m } } }]);
    await noter(client.id);
    await journalFinal(id);
    const { data } = await b.admin.from('activity_log').select('entity_type, entity_id, metadata').eq('org_id', b.orgA).eq('event_type', 'qa_journal_b122').eq('entity_id', client.id);
    expect(data).toEqual([expect.objectContaining({ entity_type: 'client', metadata: expect.objectContaining({ marque: m }) })]);
  });

  it('[B-123] move_deal_stage / [B-124] modifier_deal / [B-125] assigner_deal (entrée dans l’étape) : deal déplacé, source et responsable écrits, historique « automation »', async () => {
    const m = marque('B-123');
    const pipe = await pipelineParDefaut(b);
    const [e1, e2, e3] = pipe.ouvertes;
    const client = await creerClient(b, m);
    const deal = await creerDeal(b, client.id, e1.id, pipe.id);
    await traiterPipeline(b);
    const id = await regle(m, 'deal.stage_entered', [
      { type: 'modifier_deal', config: { source: 'Auto {client_first_name}' } },
      { type: 'assigner_deal', config: { membre_id: b.users.techA } },
      { type: 'move_deal_stage', config: { cible: 'etape', stage_id: e3.id } },
    ], { conditions: { stage_id: e2.id } });
    await ok(b.admin.from('deals').update({ stage_id: e2.id }).eq('id', deal.id), 'étape 2');
    await traiterPipeline(b);
    const logs = await journalFinal(id, 3);
    expect(logs.map((l) => [l.action_type, l.result_success]), JSON.stringify(logs)).toEqual([
      ['modifier_deal', true], ['assigner_deal', true], ['move_deal_stage', true],
    ]);
    const { data } = await b.admin.from('deals').select('stage_id, source, assigned_user_id, assigned_at').eq('id', deal.id).single();
    expect(data).toMatchObject({ stage_id: e3.id, source: 'Auto Cliente', assigned_user_id: b.users.techA });
    expect(data!.assigned_at).toBeTruthy();
    const { data: hist } = await b.admin.from('deal_stage_history').select('to_stage_id, actor_type').eq('deal_id', deal.id).eq('actor_type', 'automation');
    expect(hist?.length).toBeGreaterThanOrEqual(1);
  });

  it('[B-126] envoyer_facture (champ modifié sur une facture en brouillon) : courriel avec lien public, facture passée « envoyée »', async () => {
    const m = marque('B-126');
    const depuis = new Date().toISOString();
    const champ = await creerChamp(api, { label: `Prête ${Date.now().toString(36)}`, field_type: 'checkbox', object_type: 'invoice' });
    const client = await creerClient(b, m);
    const f = await creerFacture(b, m, client.id, 20_000);
    const id = await regle(m, 'custom_field.changed', [{ type: 'envoyer_facture', config: {} }], { conditions: { field_id: champ.id } });
    await ecrireChamps(api, 'invoice', f.id, [{ field_id: champ.id, value: true }]);
    const [log] = await journalFinal(id);
    expect(log, JSON.stringify(log)).toMatchObject({ action_type: 'envoyer_facture', result_success: true });
    const [e] = (await envoisSimules(b.admin, b.orgA, depuis)).filter((x) => x.canal === 'courriel' && x.destinataire === client.email);
    expect(e.sujet).toBe(`Facture ${f.invoice_number}`);
    expect(String(e.corps)).toContain(`/invoice/${f.view_token}`);
    const { data } = await b.admin.from('invoices').select('status, sent_at, issued_at').eq('id', f.id).single();
    expect(data!.status).toBe('sent');
    expect(data!.sent_at).toBeTruthy();
  });

  it('[B-127] envoyer_soumission (champ modifié sur une soumission en brouillon) : courriel avec lien, statut « en attente », quote.sent émis', async () => {
    const m = marque('B-127');
    const depuis = new Date().toISOString();
    const champ = await creerChamp(api, { label: `Prêt ${Date.now().toString(36)}`, field_type: 'checkbox', object_type: 'quote' });
    const client = await creerClient(b, m);
    const devis = await creerDevis(b, m, client.id, { status: 'draft' });
    const suite = await regle(`${m} suite`, 'quote.sent', [{ type: 'create_task', config: { title: `${m} quote.sent` } }], { conditions: { quote_number: devis.quote_number } });
    const id = await regle(m, 'custom_field.changed', [{ type: 'envoyer_soumission', config: {} }], { conditions: { field_id: champ.id } });
    await ecrireChamps(api, 'quote', devis.id, [{ field_id: champ.id, value: true }]);
    const [log] = await journalFinal(id);
    expect(log, JSON.stringify(log)).toMatchObject({ action_type: 'envoyer_soumission', result_success: true });
    const [e] = (await envoisSimules(b.admin, b.orgA, depuis)).filter((x) => x.canal === 'courriel' && x.destinataire === client.email);
    expect(e.sujet).toBe(`Soumission ${devis.quote_number}`);
    expect(String(e.corps)).toContain(`/quote/${devis.view_token}`);
    const { data } = await b.admin.from('quotes').select('status, last_sent_channel, sent_via_email_at').eq('id', devis.id).single();
    expect(data).toMatchObject({ status: 'awaiting_response', last_sent_channel: 'email' });
    const [t] = await attendre(() => tachesTitrees(b.admin, b.orgA, `${m} quote.sent`), (x) => x.length > 0);
    expect(t).toMatchObject({ linked_entity_type: 'quote', linked_entity_id: devis.id });
    expect(await journaux(b.admin, suite)).toHaveLength(1);
  });
});

describe('[B] actions de pilotage des automatisations', () => {
  it('[B-130] demarrer_automatisation : la règle cible s’exécute pour la même entité, avec la chaîne anti-boucle', async () => {
    const m = marque('B-130');
    const client = await creerClient(b, m);
    const cible = await regle(`${m} cible`, 'lead.created', [{ type: 'create_task', config: { title: `${m} démarrée` } }]);
    const id = await regle(m, 'note.added', [{ type: 'demarrer_automatisation', config: { rule_id: cible } }]);
    await noter(client.id);
    const [log] = await journalFinal(id);
    expect(log, JSON.stringify(log)).toMatchObject({ action_type: 'demarrer_automatisation', result_success: true });
    const [t] = await attendre(() => tachesTitrees(b.admin, b.orgA, `${m} démarrée`), (x) => x.length > 0);
    expect(t).toMatchObject({ linked_entity_type: 'client', linked_entity_id: client.id });
  });

  it('[B-131] arreter_automatisation (portée toutes) : les tâches prévues de l’entité sont annulées', async () => {
    const m = marque('B-131');
    const client = await creerClient(b, m);
    const differee = await regle(`${m} différée`, 'note.added', [{ type: 'create_task', config: { title: `${m} plus tard` } }], { delay_seconds: 86_400 });
    const id = await regle(m, 'note.added', [{ type: 'arreter_automatisation', config: { portee: 'toutes' } }]);
    await noter(client.id);
    const [log] = await journalFinal(id);
    expect(log, JSON.stringify(log)).toMatchObject({ action_type: 'arreter_automatisation', result_success: true });
    const taches = await tachesPlanifiees(b.admin, differee);
    expect(taches).toHaveLength(1);
    expect(taches[0]).toMatchObject({ status: 'cancelled', entity_id: client.id });
  });
});
