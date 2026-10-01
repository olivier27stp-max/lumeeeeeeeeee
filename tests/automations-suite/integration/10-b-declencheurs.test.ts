/**
 * [B] Chaque déclencheur du catalogue, provoqué par son VRAI chemin.
 *
 * Pour chaque déclencheur : deux règles publiées par la vraie route de
 * l'éditeur, l'une dont la condition est VRAIE pour l'événement provoqué,
 * l'autre dont la condition est FAUSSE, toutes deux avec l'action témoin
 * `create_task`. On provoque l'événement par le chemin de production (route
 * Express, trigger SQL + file de la base, file du pipeline, balayage) et on
 * vérifie : la règle vraie a créé SA tâche, liée à la bonne entité ; la règle
 * fausse n'a rien créé. La règle fausse est créée EN PREMIER : le moteur
 * traite les règles par date de création, donc quand la tâche de la vraie
 * existe, la fausse a déjà été jugée.
 *
 * Matrice : tests/automations-suite/matrice/B.md (B-001 à B-099).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { NUMERO_A, cibleProd } from '../harnais/bureau-test';
import { marque, attendre } from '../harnais/moteur';
import {
  preparerBureau, apiEnMemoire, creerRegle, supprimerRegles, tachesTitrees, journaux,
  traiterBase, traiterPipeline, creerClient, creerJob, creerDevis, creerFacture, creerDeal, pipelineParDefaut,
  drapeau, creerChamp, ecrireChamps, ok, SIGNATURE_PNG, NAVIGATEUR, type Api, type Bureau,
} from './10-b-outils';

// Secrets de TEST, posés avant tout import du serveur (config.ts les lit au
// chargement) : jamais ceux de .env.local, absents en CI.
process.env.TWILIO_AUTH_TOKEN = 'qa_jeton_twilio_test_automatisations';
process.env.TWILIO_WEBHOOK_BASE_URL = 'https://twilio.lume-qa.test';

/** Numéro texto propre au bureau A de CE fichier : le SMS entrant doit trouver UNE seule entreprise. */
// Numéro fictif PROPRE à ce jeu de bureaux (routage des textos entrants).
const NUMERO_BUREAU = NUMERO_A;

let b: Bureau & { fuseau: string };
let api: Api;
const regles: string[] = [];

beforeAll(async () => {
  b = await preparerBureau();
  await ok(b.admin.from('communication_channels').update({ phone_number: NUMERO_BUREAU }).eq('org_id', b.orgA).eq('channel_type', 'sms'), 'numéro du bureau');
  const [leads, notes, evenements, regles_, quotes, facturesPubliques, payee, contrats, champs, hooks, messages] = await Promise.all([
    import('../../../server/routes/leads'),
    import('../../../server/routes/activity-notes'),
    import('../../../server/routes/automation-events'),
    import('../../../server/routes/automation-rules'),
    import('../../../server/routes/quotes'),
    import('../../../server/routes/invoices-public'),
    import('../../../server/routes/invoice-mark-paid'),
    import('../../../server/routes/agreements'),
    import('../../../server/routes/custom-fields'),
    import('../../../server/routes/webhooks-entrants'),
    import('../../../server/routes/messages'),
  ]);
  api = await apiEnMemoire(b, [
    { routeur: hooks.default, avant: true },
    { routeur: leads.default }, { routeur: notes.default }, { routeur: evenements.default }, { routeur: regles_.default },
    { routeur: quotes.default }, { routeur: facturesPubliques.default }, { routeur: payee.default }, { routeur: contrats.default },
    { routeur: champs.default }, { routeur: messages.default },
  ]);
});
// Une règle laissée active réagirait aux événements des tests suivants.
afterEach(async () => {
  await supprimerRegles(b.admin, regles.splice(0));
});
afterAll(async () => {
  await supprimerRegles(b.admin, regles);
  await api?.fermer();
});

interface Cellule {
  declencheur: string;
  vraie: Record<string, unknown>;
  fausse: Record<string, unknown>;
}

/**
 * Crée la paire de règles (fausse puis vraie) et renvoie leurs titres.
 */
async function paire(m: string, c: Cellule) {
  const faux = `${m} faux`;
  const vrai = `${m} vrai`;
  regles.push(await creerRegle(api, { nom: faux, declencheur: c.declencheur, conditions: c.fausse, actions: [{ type: 'create_task', config: { title: faux } }] }));
  const idVrai = await creerRegle(api, { nom: vrai, declencheur: c.declencheur, conditions: c.vraie, actions: [{ type: 'create_task', config: { title: vrai, body: 'Pour {client_name}' } }] });
  regles.push(idVrai);
  return { faux, vrai, idVrai };
}

async function verifier(p: { faux: string; vrai: string; idVrai: string }, attendu: {
  declencheur: string; entityType: string; entityId: string; lienType: string | null; lienId: string | null; description?: string;
}) {
  // Filtré par l'entité : un balayage (retards, inactifs) peut aussi viser
  // d'autres fiches du bureau laissées par des passages précédents.
  // Une tâche sans lien (deal, webhook) se reconnaît à sa description, qui
  // nomme le client de l'entité.
  const miennes = <T extends { linked_entity_id: string | null; description: string | null }>(t: T[]) => t.filter((x) =>
    x.linked_entity_id === attendu.lienId && (attendu.lienId !== null || attendu.description === undefined || x.description === attendu.description));
  const taches = miennes(await attendre(() => tachesTitrees(b.admin, b.orgA, p.vrai), (t) => miennes(t).length > 0, 20_000));
  // Une action lente (> 5 s) est d'abord journalisée « en attente du résultat »,
  // puis la MÊME ligne est complétée : on attend le résultat définitif.
  const lireLog = async () => (await journaux(b.admin, p.idVrai)).filter((l) => l.entity_id === attendu.entityId);
  const log = await attendre(lireLog, (l) => l.length > 0 && l.every((x) => x.result_success || !/attente|^en cours$/.test(String(x.result_error ?? ''))), 20_000);
  expect(taches, `aucune tâche — journal : ${JSON.stringify(log)}`).toHaveLength(1);
  const [tache] = taches;
  expect(tache).toMatchObject({
    status: 'open', priority: 'medium', created_by: b.users.proprioA,
    linked_entity_type: attendu.lienType, linked_entity_id: attendu.lienId,
  });
  if (attendu.description !== undefined) expect(tache.description).toBe(attendu.description);
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({
    trigger_event: attendu.declencheur, entity_type: attendu.entityType, entity_id: attendu.entityId,
    action_type: 'create_task', result_success: true, scheduled_task_id: null,
  });
  expect(miennes(await tachesTitrees(b.admin, b.orgA, p.faux)), 'la règle à condition fausse a agi').toHaveLength(0);
}

describe('[B] déclencheurs internes — chemin de production', () => {
  it('[B-001][B-002] lead.created (POST /api/leads/create) : email = vrai → tâche liée au prospect ; email ≠ → rien', async () => {
    const m = marque('B-001');
    const email = `prospect-${Date.now()}@lume-qa.test`;
    const p = await paire(m, { declencheur: 'lead.created', vraie: { email }, fausse: { email: 'autre@lume-qa.test' } });
    const r = await api.appeler('POST', '/api/leads/create', { full_name: `Prospect ${m}`, email, phone: '+15555550143' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const { data: lead } = await b.admin.from('clients').select('id').eq('org_id', b.orgA).eq('email', email).single();
    await verifier(p, { declencheur: 'lead.created', entityType: 'lead', entityId: lead!.id, lienType: 'lead', lienId: lead!.id, description: `Pour Prospect ${m}` });
  });

  it('[B-003][B-004] lead.status_changed (POST /api/leads/update-status) : new_status = qualifié vrai / autre faux', async () => {
    const m = marque('B-003');
    const lead = await creerClient(b, m, { status: 'lead', lead_status: 'new' });
    const p = await paire(m, { declencheur: 'lead.status_changed', vraie: { new_status: 'follow_up_1', old_status: 'new' }, fausse: { new_status: 'lost' } });
    const r = await api.appeler('POST', '/api/leads/update-status', { leadId: lead.id, status: 'follow_up_1' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    await verifier(p, { declencheur: 'lead.status_changed', entityType: 'lead', entityId: lead.id, lienType: 'lead', lienId: lead.id });
  });

  it('[B-005][B-006] note.added (POST /api/activity-notes sur un client) : note_sur = client vrai / job faux', async () => {
    const m = marque('B-005');
    const client = await creerClient(b, m);
    const p = await paire(m, { declencheur: 'note.added', vraie: { note_sur: 'client' }, fausse: { note_sur: 'job' } });
    const r = await api.appeler('POST', '/api/activity-notes', { entityType: 'client', entityId: client.id, body: `Note ${m}` });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    await verifier(p, { declencheur: 'note.added', entityType: 'client', entityId: client.id, lienType: 'client', lienId: client.id, description: `Pour Cliente ${m}` });
  });

  it('[B-007][B-008] client.tagged (étiquette posée puis POST /automations/events/client-tagged) : tag visé vrai / autre faux', async () => {
    const m = marque('B-007');
    const client = await creerClient(b, m);
    const tag = `VIP-${Date.now().toString(36)}`;
    const p = await paire(m, { declencheur: 'client.tagged', vraie: { tag }, fausse: { tag: `${tag}-autre` } });
    await ok(b.admin.from('client_tags').insert({ client_id: client.id, tag }), 'étiquette');
    const r = await api.appeler('POST', '/api/automations/events/client-tagged', { clientId: client.id, tag });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    await verifier(p, { declencheur: 'client.tagged', entityType: 'client', entityId: client.id, lienType: 'client', lienId: client.id });
  });

  it('[B-009][B-010] client.untagged (étiquette retirée puis POST …/client-untagged) : tag visé vrai / autre faux', async () => {
    const m = marque('B-009');
    const client = await creerClient(b, m);
    const tag = `Ancien-${Date.now().toString(36)}`;
    const p = await paire(m, { declencheur: 'client.untagged', vraie: { tag }, fausse: { tag: `${tag}-autre` } });
    const r = await api.appeler('POST', '/api/automations/events/client-untagged', { clientId: client.id, tag });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    await verifier(p, { declencheur: 'client.untagged', entityType: 'client', entityId: client.id, lienType: 'client', lienId: client.id });
  });

  it('[B-011][B-012] task.completed (tâche terminée puis POST …/task-completed) : task_title vrai / autre faux', async () => {
    const m = marque('B-011');
    const client = await creerClient(b, m);
    const titre = `Rappeler ${m}`;
    const tache = await ok<{ id: string }>(b.admin.from('tasks').insert({
      org_id: b.orgA, title: titre, status: 'done', priority: 'medium', created_by: b.users.proprioA,
      linked_entity_type: 'client', linked_entity_id: client.id,
    }).select('id').single(), 'tâche');
    const p = await paire(m, { declencheur: 'task.completed', vraie: { task_title: titre }, fausse: { task_title: 'Autre tâche' } });
    const r = await api.appeler('POST', '/api/automations/events/task-completed', { taskId: tache.id });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json).toMatchObject({ ok: true, emis: true });
    await verifier(p, { declencheur: 'task.completed', entityType: 'client', entityId: client.id, lienType: 'client', lienId: client.id });
  });

  it('[B-013][B-014] job.ready_for_invoicing (technicien : POST …/job-completed) : job_name vrai / autre faux', async () => {
    const m = marque('B-013');
    const client = await creerClient(b, m);
    const job = await ok<{ id: string }>(b.admin.from('jobs').insert({
      org_id: b.orgA, title: `Job ${m}`, client_id: client.id, status: 'completed', created_by: b.users.proprioA,
    }).select('id').single(), 'job');
    const p = await paire(m, { declencheur: 'job.ready_for_invoicing', vraie: { job_name: `Job ${m}` }, fausse: { job_name: 'Autre job' } });
    const r = await api.appeler('POST', '/api/automations/events/job-completed', { jobId: job.id }, 'techA');
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    await verifier(p, { declencheur: 'job.ready_for_invoicing', entityType: 'job', entityId: job.id, lienType: 'job', lienId: job.id });
  });
});

describe('[B] déclencheurs écrits par la base (trigger SQL → automation_evenements_base → bus)', () => {
  it('[B-015][B-016] job.completed (jobs.status → completed) : origine base vraie / job_name autre faux', async () => {
    const m = marque('B-015');
    const client = await creerClient(b, m);
    const job = await ok<{ id: string }>(b.admin.from('jobs').insert({
      org_id: b.orgA, title: `Job ${m}`, client_id: client.id, status: 'scheduled', created_by: b.users.proprioA,
    }).select('id').single(), 'job');
    const p = await paire(m, { declencheur: 'job.completed', vraie: { origine: 'base', job_name: `Job ${m}` }, fausse: { job_name: 'Autre job' } });
    await ok(b.admin.from('jobs').update({ status: 'completed' }).eq('id', job.id), 'job terminé');
    await traiterBase(b);
    await verifier(p, { declencheur: 'job.completed', entityType: 'job', entityId: job.id, lienType: 'job', lienId: job.id });
  });
});

const json = (corps: unknown) => JSON.stringify(corps);
const CLIENT_WEB = { 'Content-Type': 'application/json', 'User-Agent': NAVIGATEUR };

describe('[B] devis — chemins de production', () => {
  it('[B-017][B-018] quote.sent (POST /api/quotes/send-email) : channel email vrai / sms faux', async () => {
    const m = marque('B-017');
    const client = await creerClient(b, m);
    const devis = await creerDevis(b, m, client.id, { status: 'draft' });
    const p = await paire(m, { declencheur: 'quote.sent', vraie: { channel: 'email', quote_number: devis.quote_number }, fausse: { channel: 'sms' } });
    const r = await api.appeler('POST', '/api/quotes/send-email', { quoteId: devis.id });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    await verifier(p, { declencheur: 'quote.sent', entityType: 'quote', entityId: devis.id, lienType: 'quote', lienId: devis.id });
  });

  it('[B-019][B-020] quote.viewed (GET public /api/quotes/public/:jeton, vrai navigateur) : première ouverture vraie / is_first_view=false faux', async () => {
    const m = marque('B-019');
    const client = await creerClient(b, m);
    const devis = await creerDevis(b, m, client.id);
    const p = await paire(m, { declencheur: 'quote.viewed', vraie: { ouverture: 'premiere' }, fausse: { is_first_view: false } });
    const r = await api.publique('GET', `/api/quotes/public/${devis.view_token}`, undefined, { 'User-Agent': NAVIGATEUR, 'x-lume-session': m });
    expect(r.status).toBe(200);
    await verifier(p, { declencheur: 'quote.viewed', entityType: 'quote', entityId: devis.id, lienType: 'quote', lienId: devis.id });
  });

  it('[B-021][B-022] quote.approved (acceptation signée sur la page publique → trigger SQL → file de la base)', async () => {
    const m = marque('B-021');
    const client = await creerClient(b, m);
    const devis = await creerDevis(b, m, client.id);
    const p = await paire(m, { declencheur: 'quote.approved', vraie: { origine: 'base', quote_number: devis.quote_number }, fausse: { quote_number: 'AUTRE' } });
    const r = await api.publique('POST', '/api/quotes/public/accept', json({ view_token: devis.view_token, signer_name: 'Cliente QA', signature_data: SIGNATURE_PNG }), CLIENT_WEB);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    await traiterBase(b);
    await verifier(p, { declencheur: 'quote.approved', entityType: 'quote', entityId: devis.id, lienType: 'quote', lienId: devis.id });
  });

  it('[B-023][B-024] quote.declined (refus sur la page publique → trigger SQL → file de la base)', async () => {
    const m = marque('B-023');
    const client = await creerClient(b, m);
    const devis = await creerDevis(b, m, client.id);
    const p = await paire(m, { declencheur: 'quote.declined', vraie: { client_id: client.id }, fausse: { client_id: '00000000-0000-0000-0000-000000000001' } });
    const r = await api.publique('POST', '/api/quotes/public/decline', json({ view_token: devis.view_token, reason: 'Trop cher' }), CLIENT_WEB);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    await traiterBase(b);
    await verifier(p, { declencheur: 'quote.declined', entityType: 'quote', entityId: devis.id, lienType: 'quote', lienId: devis.id });
  });

  it('[B-025][B-026] quote.changes_requested (page publique) : quote_number vrai / autre faux', async () => {
    const m = marque('B-025');
    const client = await creerClient(b, m);
    const devis = await creerDevis(b, m, client.id);
    const p = await paire(m, { declencheur: 'quote.changes_requested', vraie: { quote_number: devis.quote_number }, fausse: { quote_number: 'AUTRE' } });
    const r = await api.publique('POST', '/api/quotes/public/request-changes', json({ view_token: devis.view_token, message: 'Ajouter les vitres' }), CLIENT_WEB);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    await verifier(p, { declencheur: 'quote.changes_requested', entityType: 'quote', entityId: devis.id, lienType: 'quote', lienId: devis.id });
  });
});

describe('[B] factures — chemins de production', () => {
  it('[B-027][B-028] invoice.sent (brouillon → envoyée : trigger SQL → file de la base) : client_id vrai / autre faux', async () => {
    const m = marque('B-027');
    const client = await creerClient(b, m);
    const f = await creerFacture(b, m, client.id);
    const p = await paire(m, { declencheur: 'invoice.sent', vraie: { origine: 'base', client_id: client.id }, fausse: { client_id: '00000000-0000-0000-0000-000000000001' } });
    const now = new Date().toISOString();
    await ok(b.admin.from('invoices').update({ status: 'sent', issued_at: now, sent_at: now }).eq('id', f.id), 'envoi');
    await traiterBase(b);
    await verifier(p, { declencheur: 'invoice.sent', entityType: 'invoice', entityId: f.id, lienType: 'invoice', lienId: f.id });
  });

  it('[B-029][B-030] invoice.paid (POST /api/invoices/:id/mark-paid) : payment_type full vrai / deposit faux', async () => {
    const m = marque('B-029');
    const client = await creerClient(b, m);
    const f = await creerFacture(b, m, client.id, 12_345);
    await ok(b.admin.from('invoices').update({ status: 'sent', issued_at: new Date().toISOString(), sent_at: new Date().toISOString() }).eq('id', f.id), 'envoi');
    const p = await paire(m, { declencheur: 'invoice.paid', vraie: { payment_type: 'full', provider: 'manual', amount_cents: 12_345 }, fausse: { payment_type: 'deposit' } });
    const r = await api.appeler('POST', `/api/invoices/${f.id}/mark-paid`, { method: 'cash' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    await verifier(p, { declencheur: 'invoice.paid', entityType: 'invoice', entityId: f.id, lienType: 'invoice', lienId: f.id });
  });

  it('[B-031][B-032] invoice.overdue (balayage des retards, J+1 dans le fuseau du bureau) : days_overdue 1 vrai / 3 faux', async () => {
    const m = marque('B-031');
    const client = await creerClient(b, m);
    const f = await creerFacture(b, m, client.id);
    // « Hier » dans le fuseau de l'ENTREPRISE, comme le balayage.
    const aujourdhui = new Intl.DateTimeFormat('en-CA', { timeZone: b.fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const hier = new Date(Date.parse(`${aujourdhui}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    await ok(b.admin.from('invoices').update({ status: 'sent', issued_at: new Date().toISOString(), sent_at: new Date().toISOString(), due_date: hier }).eq('id', f.id), 'échéance');
    const p = await paire(m, { declencheur: 'invoice.overdue', vraie: { days_overdue: 1 }, fausse: { days_overdue: 3 } });
    const { detectOverdueInvoices } = await import('../../../server/lib/scheduler');
    await detectOverdueInvoices(b.admin, { orgId: b.orgA });
    await verifier(p, { declencheur: 'invoice.overdue', entityType: 'invoice', entityId: f.id, lienType: 'invoice', lienId: f.id });
  });

  it('[B-033][B-034] invoice.viewed (drapeau auto_consultation_documents, GET public /api/invoices/public/:jeton) : première vraie / is_first_view=false faux', async () => {
    const m = marque('B-033');
    await drapeau(b, 'auto_consultation_documents', true);
    const client = await creerClient(b, m);
    const f = await creerFacture(b, m, client.id);
    await ok(b.admin.from('invoices').update({ status: 'sent', issued_at: new Date().toISOString() }).eq('id', f.id), 'envoi');
    const p = await paire(m, { declencheur: 'invoice.viewed', vraie: { ouverture: 'premiere' }, fausse: { is_first_view: false } });
    const r = await api.publique('GET', `/api/invoices/public/${f.view_token}`, undefined, { 'User-Agent': NAVIGATEUR, 'x-lume-session': m });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    await verifier(p, { declencheur: 'invoice.viewed', entityType: 'invoice', entityId: f.id, lienType: 'invoice', lienId: f.id });
  });
});

describe('[B] rendez-vous, contrats, clients', () => {
  it('[B-035][B-036] appointment.created (visite insérée → trigger SQL → file de la base) : title vrai / autre faux → tâche liée au JOB porteur', async () => {
    const m = marque('B-035');
    const client = await creerClient(b, m);
    const job = await creerJob(b, m, client.id);
    const p = await paire(m, { declencheur: 'appointment.created', vraie: { title: `Visite ${m}` }, fausse: { title: 'Autre visite' } });
    const debut = new Date(Date.now() + 3 * 86_400_000);
    const visite = await ok<{ id: string }>(b.admin.from('schedule_events').insert({
      org_id: b.orgA, job_id: job.id, title: `Visite ${m}`, status: 'scheduled', created_by: b.users.proprioA,
      start_at: debut.toISOString(), end_at: new Date(debut.getTime() + 3600_000).toISOString(),
    }).select('id').single(), 'visite');
    await traiterBase(b);
    await verifier(p, { declencheur: 'appointment.created', entityType: 'schedule_event', entityId: visite.id, lienType: 'job', lienId: job.id });
  });

  it('[B-037][B-038] appointment.cancelled (visite annulée → trigger SQL) : job_id vrai / autre faux', async () => {
    const m = marque('B-037');
    const client = await creerClient(b, m);
    const job = await creerJob(b, m, client.id);
    const debut = new Date(Date.now() + 4 * 86_400_000);
    const visite = await ok<{ id: string }>(b.admin.from('schedule_events').insert({
      org_id: b.orgA, job_id: job.id, title: `Visite ${m}`, status: 'scheduled', created_by: b.users.proprioA,
      start_at: debut.toISOString(), end_at: new Date(debut.getTime() + 3600_000).toISOString(),
    }).select('id').single(), 'visite');
    await traiterBase(b); // l'appointment.created de la création (aucune règle ici)
    const p = await paire(m, { declencheur: 'appointment.cancelled', vraie: { job_id: job.id }, fausse: { job_id: '00000000-0000-0000-0000-000000000001' } });
    await ok(b.admin.from('schedule_events').update({ status: 'cancelled' }).eq('id', visite.id), 'annulation');
    await traiterBase(b);
    await verifier(p, { declencheur: 'appointment.cancelled', entityType: 'schedule_event', entityId: visite.id, lienType: 'job', lienId: job.id });
  });

  it('[B-039][B-040] agreement.signed (signature sur la page publique du contrat) : signer_name vrai / autre faux → tâche liée au job', async () => {
    const m = marque('B-039');
    const client = await creerClient(b, m);
    const job = await creerJob(b, m, client.id);
    const contrat = await ok<{ id: string; view_token: string }>(b.admin.from('job_agreements').insert({
      org_id: b.orgA, job_id: job.id, client_id: client.id, status: 'sent', terms: 'Conditions QA', created_by: b.users.proprioA,
    }).select('id, view_token').single(), 'contrat');
    const p = await paire(m, { declencheur: 'agreement.signed', vraie: { signer_name: `Signataire ${m}` }, fausse: { signer_name: 'Autre signataire' } });
    const r = await api.publique('POST', '/api/agreements/public/sign', json({ view_token: contrat.view_token, signer_name: `Signataire ${m}`, signature_data: SIGNATURE_PNG }), CLIENT_WEB);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    await verifier(p, { declencheur: 'agreement.signed', entityType: 'job', entityId: job.id, lienType: 'job', lienId: job.id });
  });

  it('[B-041][B-042] client.replied (texto entrant signé Twilio, POST /api/messages/inbound) : canal sms vrai / email faux', async () => {
    const m = marque('B-041');
    const telephone = '+15555550198';
    // Une seule fiche porte ce numéro dans le bureau : le routage doit être sans ambiguïté.
    await b.admin.from('clients').update({ phone: null }).eq('org_id', b.orgA).eq('phone', telephone);
    await b.admin.from('conversations').delete().eq('org_id', b.orgA).eq('phone_number', telephone);
    const client = await creerClient(b, m, { phone: telephone });
    const p = await paire(m, { declencheur: 'client.replied', vraie: { canal: 'sms' }, fausse: { canal: 'email' } });
    const corps = { From: telephone, To: NUMERO_BUREAU, Body: `Oui merci ${m}`, MessageSid: `SMqa${Date.now()}${Math.random().toString(36).slice(2, 8)}` };
    const twilio = (await import('twilio')).default;
    const signature = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN!, 'https://twilio.lume-qa.test/api/messages/inbound', corps);
    const r = await api.publique('POST', '/api/messages/inbound', new URLSearchParams(corps).toString(), {
      'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': signature,
    });
    expect(r.status).toBe(200);
    await verifier(p, { declencheur: 'client.replied', entityType: 'client', entityId: client.id, lienType: 'client', lienId: client.id });
  });

  it('[B-043][B-044] client.inactive (drapeau auto_client_inactif, balayage du bureau) : mois 6 vrai / 12 faux', async () => {
    const m = marque('B-043');
    await drapeau(b, 'auto_client_inactif', true);
    const client = await creerClient(b, m);
    const ilYa7Mois = new Date(Date.now() - 213 * 86_400_000).toISOString();
    await creerJob(b, m, client.id, { status: 'completed', completed_at: ilYa7Mois });
    const p = await paire(m, { declencheur: 'client.inactive', vraie: { mois: 6 }, fausse: { mois: 12 } });
    const { balayerEntreprise } = await import('../../../server/lib/client-inactif');
    await balayerEntreprise(b.admin, b.orgA);
    await verifier(p, { declencheur: 'client.inactive', entityType: 'client', entityId: client.id, lienType: 'client', lienId: client.id });
  });
});

describe('[B] champs personnalisés, dates, webhooks entrants', () => {
  it('[B-045][B-046] custom_field.changed (PUT /api/custom-values/client/:id, champ créé par la route des réglages) : field_id vrai / autre champ faux', async () => {
    const m = marque('B-045');
    const suffixe = Date.now().toString(36);
    const champ = await creerChamp(api, { label: `Préférence ${suffixe}`, field_type: 'single_line', object_type: 'client' });
    const autre = await creerChamp(api, { label: `Autre ${suffixe}`, field_type: 'single_line', object_type: 'client' });
    const client = await creerClient(b, m);
    const p = await paire(m, { declencheur: 'custom_field.changed', vraie: { field_id: champ.id, new_value: 'Matin' }, fausse: { field_id: autre.id } });
    await ecrireChamps(api, 'client', client.id, [{ field_id: champ.id, value: 'Matin' }]);
    await verifier(p, { declencheur: 'custom_field.changed', entityType: 'client', entityId: client.id, lienType: 'client', lienId: client.id });
  });

  it('[B-047][B-048] date.reached (balayage quotidien du bureau, champ date d’un client = aujourd’hui) : jours_avant 0 vrai / 3 faux', async () => {
    const m = marque('B-047');
    const champ = await creerChamp(api, { label: `Anniversaire ${Date.now().toString(36)}`, field_type: 'date', object_type: 'client' });
    const client = await creerClient(b, m);
    const { jourLocal, balayerRappelsDates } = await import('../../../server/lib/rappels-dates');
    await ecrireChamps(api, 'client', client.id, [{ field_id: champ.id, value: jourLocal() }]);
    const p = await paire(m, { declencheur: 'date.reached', vraie: { champ_id: champ.id, jours_avant: 0 }, fausse: { champ_id: champ.id, jours_avant: 3 } });
    await balayerRappelsDates(b.admin, new Date(), { orgId: b.orgA });
    await verifier(p, { declencheur: 'date.reached', entityType: 'client', entityId: client.id, lienType: 'client', lienId: client.id });
  });

  it('[J-063] date.reached : une règle EXISTANTE à « 3.5 » ou « 400 » jours avant n’est plus muette (3 et 365, comme le balayage) ; l’éditeur refuse désormais ces valeurs', async () => {
    const m = marque('J-063');
    const champ = await creerChamp(api, { label: `Fin de contrat ${Date.now().toString(36)}`, field_type: 'date', object_type: 'client' });
    const { jourDecale, balayerRappelsDates } = await import('../../../server/lib/rappels-dates');

    // L'éditeur (vraie route) refuse ce que le balayage ne sait pas viser, avec un message clair.
    for (const jours of ['3.5', 400]) {
      const refus = await api.appeler('POST', '/api/automations/rules', {
        name: `${m} refusée`, trigger_event: 'date.reached', conditions: { champ_id: champ.id, jours_avant: jours }, delay_seconds: 0,
        actions: [{ type: 'create_task', config: { title: `${m} refusée` } }], is_active: true,
      });
      expect(refus.status, JSON.stringify(refus.json)).toBe(400);
      expect(refus.json.error).toMatch(/nombre entier de jours, entre -365 et 365/);
    }

    // Règles DÉJÀ en base avec ces valeurs (écrites avant le refus, par Lumi ou par l'API d'alors).
    const existante = async (jours: unknown, titre: string) => {
      const r = await ok<{ id: string }>(b.admin.from('automation_rules').insert({
        org_id: b.orgA, name: titre, trigger_event: 'date.reached', conditions: { champ_id: champ.id, jours_avant: jours }, delay_seconds: 0,
        is_active: true, is_preset: false, actions: [{ type: 'create_task', config: { title: titre } }],
      }).select('id').single(), 'règle existante');
      regles.push(r.id);
      return r.id;
    };
    const idDemi = await existante('3.5', `${m} trois et demi`);
    const idTrop = await existante('400', `${m} quatre cents`);

    // Le PATCH des conditions refuse aussi ; renommer la règle existante reste permis.
    const patch = await api.appeler('PATCH', `/api/automations/rules/${idTrop}`, { conditions: { champ_id: champ.id, jours_avant: '400' } });
    expect(patch.status, JSON.stringify(patch.json)).toBe(400);
    expect(patch.json.error).toMatch(/nombre entier de jours/);
    expect((await api.appeler('PATCH', `/api/automations/rules/${idTrop}`, { description: 'toujours modifiable' })).status).toBe(200);

    const dans3 = await creerClient(b, `${m} dans 3 jours`);
    const dans365 = await creerClient(b, `${m} dans 365 jours`);
    const autreJour = await creerClient(b, `${m} dans 4 jours`);
    const maintenant = new Date();
    await ecrireChamps(api, 'client', dans3.id, [{ field_id: champ.id, value: jourDecale(3, maintenant, b.fuseau) }]);
    await ecrireChamps(api, 'client', dans365.id, [{ field_id: champ.id, value: jourDecale(365, maintenant, b.fuseau) }]);
    await ecrireChamps(api, 'client', autreJour.id, [{ field_id: champ.id, value: jourDecale(4, maintenant, b.fuseau) }]);

    const resume = await balayerRappelsDates(b.admin, maintenant, { orgId: b.orgA });
    expect(resume.erreurs).toBe(0);
    expect(resume.emis).toBe(2);

    const [demi] = await attendre(() => tachesTitrees(b.admin, b.orgA, `${m} trois et demi`), (t) => t.length > 0, 20_000);
    expect(demi, 'la règle « 3.5 jours avant » est restée muette').toBeTruthy();
    expect(demi.linked_entity_id).toBe(dans3.id);
    const [trop] = await attendre(() => tachesTitrees(b.admin, b.orgA, `${m} quatre cents`), (t) => t.length > 0, 20_000);
    expect(trop, 'la règle « 400 jours avant » est restée muette').toBeTruthy();
    expect(trop.linked_entity_id).toBe(dans365.id);
    // Chaque règle n'a agi QUE sur sa fiche : l'événement de l'une ne fait pas partir l'autre.
    await new Promise((r) => setTimeout(r, 1500));
    expect(await tachesTitrees(b.admin, b.orgA, `${m} trois et demi`)).toHaveLength(1);
    expect(await tachesTitrees(b.admin, b.orgA, `${m} quatre cents`)).toHaveLength(1);
    const actions = async (id: string) => (await journaux(b.admin, id)).filter((l) => l.action_type === 'create_task').map((l) => l.entity_id);
    expect(await actions(idDemi)).toEqual([dans3.id]);
    expect(await actions(idTrop)).toEqual([dans365.id]);
  });

  it('[I-036] API : créer une règle sur un déclencheur en rodage non offert (drapeau éteint) → 400 ; y basculer une règle existante → 400 ; drapeau allumé → acceptée', async () => {
    const m = marque('I-036');
    const { data: ligne } = await b.admin.from('org_features').select('enabled').eq('org_id', b.orgA).eq('feature', 'auto_paiement_echoue').maybeSingle();
    const corps = (nom: string, declencheur: string) => ({
      name: nom, trigger_event: declencheur, conditions: {}, delay_seconds: 0,
      actions: [{ type: 'create_task', config: { title: nom } }], is_active: false,
    });
    try {
      await drapeau(b, 'auto_paiement_echoue', false);
      const refus = await api.appeler('POST', '/api/automations/rules', corps(`${m} refusée`, 'payment.failed'));
      expect(refus.status, JSON.stringify(refus.json)).toBe(400);
      expect(refus.json.code).toBe('declencheur_non_offert');
      expect(refus.json.error).toMatch(/« Paiement échoué » n’est pas encore offert/);

      const devis = await api.appeler('POST', '/api/automations/rules', corps(`${m} devis`, 'quote.sent'));
      expect(devis.status, JSON.stringify(devis.json)).toBe(201);
      regles.push(devis.json.id);
      const bascule = await api.appeler('PATCH', `/api/automations/rules/${devis.json.id}`, { trigger_event: 'payment.failed' });
      expect(bascule.status, JSON.stringify(bascule.json)).toBe(400);
      expect(bascule.json.code).toBe('declencheur_non_offert');
      // Le reste de la règle demeure modifiable.
      expect((await api.appeler('PATCH', `/api/automations/rules/${devis.json.id}`, { description: 'toujours modifiable' })).status).toBe(200);

      await drapeau(b, 'auto_paiement_echoue', true);
      const acceptee = await api.appeler('POST', '/api/automations/rules', corps(`${m} acceptée`, 'payment.failed'));
      expect(acceptee.status, JSON.stringify(acceptee.json)).toBe(201);
      regles.push(acceptee.json.id);
    } finally {
      await drapeau(b, 'auto_paiement_echoue', ligne?.enabled === true);
    }
  });

  it('[D-044] date.reached : le balayage REJOUÉ le même jour (reprise, double cron, réessai manuel) n’agit qu’une fois par fiche', async () => {
    const m = marque('D-044');
    const champ = await creerChamp(api, { label: `Garantie ${Date.now().toString(36)}`, field_type: 'date', object_type: 'client' });
    const { jourLocal, balayerRappelsDates } = await import('../../../server/lib/rappels-dates');
    const client = await creerClient(b, m);
    const maintenant = new Date();
    await ecrireChamps(api, 'client', client.id, [{ field_id: champ.id, value: jourLocal(maintenant, b.fuseau) }]);
    const regle = await ok<{ id: string }>(b.admin.from('automation_rules').insert({
      org_id: b.orgA, name: `${m} rappel`, trigger_event: 'date.reached', conditions: { champ_id: champ.id, jours_avant: 0 }, delay_seconds: 0,
      is_active: true, is_preset: false, actions: [{ type: 'create_task', config: { title: `${m} rappel` } }],
    }).select('id').single(), 'règle');
    regles.push(regle.id);

    const premier = await balayerRappelsDates(b.admin, maintenant, { orgId: b.orgA });
    expect(premier.erreurs).toBe(0);
    expect(premier.emis).toBe(1);
    await attendre(() => tachesTitrees(b.admin, b.orgA, `${m} rappel`), (t) => t.length > 0, 20_000);

    // Le cron repasse (deux fois) : la même date est revue, rien ne repart.
    for (let i = 0; i < 2; i++) {
      const rejeu = await balayerRappelsDates(b.admin, maintenant, { orgId: b.orgA });
      expect(rejeu.erreurs).toBe(0);
    }
    await new Promise((r) => setTimeout(r, 3000));
    expect(await tachesTitrees(b.admin, b.orgA, `${m} rappel`)).toHaveLength(1);
    expect((await journaux(b.admin, regle.id)).filter((l) => l.action_type === 'create_task')).toHaveLength(1);
  });

  it('[B-049][B-050] webhook.received (POST /api/hooks/:clé, clé créée par la route) : champ JSON source=site vrai / facebook faux', async () => {
    const m = marque('B-049');
    const cree = await api.appeler('POST', '/api/automations/webhooks', { name: `Site ${m}` });
    expect(cree.status, JSON.stringify(cree.json)).toBe(201);
    const p = await paire(m, { declencheur: 'webhook.received', vraie: { source: 'site', webhook_id: cree.json.id }, fausse: { source: 'facebook' } });
    const r = await api.publique('POST', `/api/hooks/${cree.json.api_key}`, json({ source: 'site', nom: m }), { 'Content-Type': 'application/json' });
    expect(r.status, JSON.stringify(r.json)).toBeLessThan(300);
    const [recu] = await ok<Array<{ id: string }>>(b.admin.from('automation_webhook_receipts').select('id').eq('webhook_id', cree.json.id), 'reçu');
    // L'entité est la TRACE de l'appel : aucune fiche à lier, la tâche existe sans lien.
    await verifier(p, { declencheur: 'webhook.received', entityType: 'automation_webhook_receipt', entityId: recu.id, lienType: null, lienId: null });
  });
});

describe('[B] pipeline de ventes (trigger SQL → pipeline_events → bus)', () => {
  it('[B-051][B-052] deal.stage_entered (deals.stage_id changé) : stage_id visé vrai / autre étape faux', async () => {
    const m = marque('B-051');
    const pipe = await pipelineParDefaut(b);
    const [e1, e2, e3] = pipe.ouvertes;
    const client = await creerClient(b, m);
    const deal = await creerDeal(b, client.id, e1.id, pipe.id);
    await traiterPipeline(b); // l'entrée en 1re étape (aucune règle ici)
    const p = await paire(m, { declencheur: 'deal.stage_entered', vraie: { stage_id: e2.id }, fausse: { stage_id: e3.id } });
    await ok(b.admin.from('deals').update({ stage_id: e2.id }).eq('id', deal.id), 'changement d’étape');
    await traiterPipeline(b);
    // Un deal n'est pas liable à une tâche (CHECK tasks.linked_entity_type) : tâche sans lien.
    await verifier(p, { declencheur: 'deal.stage_entered', entityType: 'deal', entityId: deal.id, lienType: null, lienId: null, description: `Pour Cliente ${m}` });
  });

  it('[B-053][B-054] deal.stage_idle (RPC pipeline_detecter_stagnation → pipeline_events) : étape vraie / autre étape fausse', async () => {
    const m = marque('B-053');
    const pipe = await pipelineParDefaut(b);
    const [, e2, e3] = pipe.ouvertes;
    // La RPC balaie TOUTES les entreprises (pas de paramètre d'org) : elle
    // n'écrit que pour les règles « sans mouvement » actives. On refuse de
    // l'appeler si une entreprise hors bac à sable en a une.
    const { data: autres } = await b.admin.from('automation_rules').select('org_id')
      .eq('trigger_event', 'deal.stage_idle').eq('is_active', true).is('deleted_at', null).neq('org_id', b.orgA);
    const { data: sable } = await b.admin.from('orgs_envois_simules').select('org_id');
    const horsSable = (autres ?? []).filter((r) => !(sable ?? []).some((s) => s.org_id === r.org_id));
    // En PROD, le serveur appelle déjà cette détection à chaque passage, et elle
    // ne peut rien doubler (clé d'unicité par règle, deal et étape) : l'appeler
    // d'ici ne change rien pour les vraies entreprises. Le refus vaut pour staging.
    if (!cibleProd()) expect(horsSable, 'une vraie entreprise a une règle « sans mouvement » : appel global refusé').toHaveLength(0);
    const client = await creerClient(b, m);
    const deal = await creerDeal(b, client.id, e2.id, pipe.id);
    await traiterPipeline(b);
    // À l'insertion, la base impose last_activity_at = now() : on vieillit le deal ensuite.
    await ok(b.admin.from('deals').update({ last_activity_at: new Date(Date.now() - 10 * 86_400_000).toISOString() }).eq('id', deal.id), 'deal endormi');
    const p = await paire(m, { declencheur: 'deal.stage_idle', vraie: { stage_id: e2.id, idle_days: 7 }, fausse: { stage_id: e3.id } });
    await ok(b.admin.rpc('pipeline_detecter_stagnation'), 'détection');
    await traiterPipeline(b);
    await verifier(p, { declencheur: 'deal.stage_idle', entityType: 'deal', entityId: deal.id, lienType: null, lienId: null, description: `Pour Cliente ${m}` });
  });
});
