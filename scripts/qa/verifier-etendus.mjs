#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   VÉRIFICATION — outils étendus : lectures, scopes, ÉCRITURES

   Trois familles de contrôles :
   1. LECTURES : chaque nouvel outil comparé à la source que l'app
      consulte (la leçon des jobs — deux sources = deux vérités).
   2. SCOPES : un jeton lecture seule ne voit AUCUNE écriture ; une
      clé d'API ne voit aucun outil à identité (paie, GPS, écritures).
   3. ÉCRITURES : chaque outil crée réellement, l'idempotence renvoie
      le même résultat au lieu d'un doublon, le plafond refuse, les
      statuts invalides refusent. Tout est nettoyé à la fin.

   Ne teste JAMAIS un envoi SMS réel : on vérifie seulement que
   l'outil échoue proprement quand Twilio est absent, et qu'il est
   invisible sans le scope d'écriture.

   Usage : node --env-file=.env.local scripts/qa/verifier-etendus.mjs
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const API = (process.env.QA_API_URL || 'http://localhost:3002').replace(/\/$/, '');
const BASE = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const RESOURCE = `${BASE}/api/mcp`;
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';

const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const ok = [], ko = [];
const R = (cond, libelle, detail = '') => {
  if (cond) { ok.push(libelle); console.log(`  ✓ ${libelle}${detail ? '   ' + detail : ''}`); }
  else { ko.push(libelle + (detail ? ' — ' + detail : '')); console.log(`  ✗ ${libelle}${detail ? ' — ' + detail : ''}`); }
};

const pkce = () => {
  const verifier = crypto.randomBytes(48).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};

async function session() {
  const { data: lien, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
  if (error) throw new Error(`lien refusé : ${error.message}`);
  const { data, error: e2 } = await anon.auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });
  if (e2) throw new Error(`session refusée : ${e2.message}`);
  return data.session;
}

/** Jeton OAuth complet pour un scope donné. */
async function jetonPour(sess, clientId, scope) {
  const { verifier, challenge } = pkce();
  const cons = await fetch(`${API}/api/oauth/consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.access_token}` },
    body: JSON.stringify({
      client_id: clientId, redirect_uri: 'https://qa.test/cb', code_challenge: challenge,
      scope, resource: RESOURCE, supabase_refresh_token: sess.refresh_token,
    }),
  }).then((r) => r.json());
  if (!cons.redirect_to) throw new Error('consentement refusé : ' + JSON.stringify(cons).slice(0, 150));
  const code = new URL(cons.redirect_to).searchParams.get('code');
  const tok = await fetch(`${API}/api/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code', code, client_id: clientId,
      redirect_uri: 'https://qa.test/cb', code_verifier: verifier, resource: RESOURCE,
    }),
  }).then((r) => r.json());
  if (!tok.access_token) throw new Error('jeton refusé : ' + JSON.stringify(tok).slice(0, 150));
  return tok.access_token;
}

// Espacement des DÉPARTS de requêtes : le garde anti-rafale du serveur
// (30 req/3 s, puis blocage d'IP PERSISTÉ 15 min) est une protection de
// prod légitime — c'est à la suite de marcher au pas, pas au serveur de
// s'ouvrir. 130 ms entre départs = ~23 req/3 s, sous le seuil, et le test
// de parallélisme reste concurrent (les requêtes se chevauchent en vol).
let fileCadence = Promise.resolve();
function cadence() {
  const tour = fileCadence.then(() => new Promise((r) => setTimeout(r, 130)));
  fileCadence = tour;
  return tour;
}

const rpc = async (jeton, method, params = {}, entetes = {}) => {
  await cadence();
  return fetch(`${API}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}`, ...entetes },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }).then((r) => r.json());
};

const outil = async (jeton, name, args = {}) => {
  const r = await rpc(jeton, 'tools/call', { name, arguments: args });
  if (r.error) return { rpc_error: r.error.message };
  try { return JSON.parse(r.result.content[0].text); } catch { return { brut: JSON.stringify(r).slice(0, 150) }; }
};

(async () => {
  console.log(`\n  Cible : ${API} (staging)\n`);

  // ── Préparation ──
  await admin.from('oauth_clients').delete().like('client_name', 'QA Étendus%');
  const reg = await fetch(`${API}/api/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'QA Étendus', redirect_uris: ['https://qa.test/cb'] }),
  }).then((r) => r.json());
  const sess = await session();
  const { data: m } = await admin.from('memberships')
    .select('org_id').eq('user_id', sess.user.id).eq('status', 'active').limit(1).single();
  const ORG = m.org_id;
  // Repartir propre : les empreintes d'un run précédent fausseraient l'idempotence.
  await admin.from('agent_actions').delete().eq('org_id', ORG);

  const jLecture = await jetonPour(sess, reg.client_id, 'mcp:read');
  const jEcriture = await jetonPour(sess, reg.client_id, 'mcp:read mcp:write');
  console.log(`  Organisation : ${ORG}\n`);

  /* ════ 0. INSTRUCTIONS DE PRÉSENTATION ════ */
  // Sans elles, l'assistant répondait avec des UUID et des noms de champs —
  // le retour utilisateur exact du 2026-09-03. Le champ `instructions`
  // d'initialize est le canal MCP officiel pour dicter le ton.
  console.log('  ── Instructions serveur ──');
  const init = await rpc(jLecture, 'initialize', {});
  const instr = init.result?.instructions || '';
  R(instr.length > 200, 'initialize livre des instructions', `${instr.length} caractères`);
  R(/JAMAIS d'identifiant technique/i.test(instr), 'Interdiction des UUID/ids dans les réponses');
  R(/OUI explicite/i.test(instr), 'Confirmation exigée avant SMS');
  R(/MÊME QUAND ÇA ÉCHOUE/i.test(instr) && /messages d'erreur bruts/i.test(instr),
    'Le registre d\u2019exploitant tient aussi en cas d\u2019échec');

  /* ════ 1. SCOPES ════ */
  console.log('  ── Scopes et visibilité ──');
  const listeLecture = (await rpc(jLecture, 'tools/list')).result.tools.map((t) => t.name);
  const listeEcriture = (await rpc(jEcriture, 'tools/list')).result.tools.map((t) => t.name);
  const ecritures = ['create_job', 'create_client', 'create_task', 'create_quote', 'create_invoice', 'send_sms', 'update_job_status', 'assign_job', 'remember_this', 'send_quote', 'send_invoice', 'reschedule_job', 'update_client', 'update_task_status', 'add_note', 'archive_job', 'create_invoice_from_job', 'convert_quote_to_job', 'convert_lead_to_client', 'add_visit', 'update_job', 'send_payment_reminders', 'cancel_visit', 'update_task', 'delete_task', 'cancel_quote', 'mark_invoice_paid'];
  R(!ecritures.some((n) => listeLecture.includes(n)), 'Jeton lecture : AUCUNE écriture visible',
    `${listeLecture.length} outils`);
  R(ecritures.every((n) => listeEcriture.includes(n)), 'Jeton écriture : les 22 écritures visibles',
    `${listeEcriture.length} outils`);
  const refusEcriture = await outil(jLecture, 'create_task', { title: 'interdit' });
  R(!!refusEcriture.rpc_error, 'Appel d\'écriture refusé sans le scope');

  // Clé d'API : les outils à identité doivent disparaître.
  const cleBrute = 'lk_live_' + crypto.randomBytes(24).toString('base64url').replace(/-/g, 'A');
  await admin.from('api_keys').insert({
    org_id: ORG, created_by: sess.user.id, name: 'QA Étendus — clé',
    key_hash: crypto.createHash('sha256').update(cleBrute).digest('hex'),
    key_prefix: cleBrute.slice(0, 12) + '...', scopes: ['mcp'],
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  });
  const listeCle = (await fetch(`${API}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': cleBrute },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  }).then((r) => r.json())).result.tools.map((t) => t.name);
  R(!listeCle.includes('get_payroll_summary') && !listeCle.includes('get_team_locations') && !listeCle.includes('create_task'),
    'Clé d\'API : ni paie, ni GPS, ni écriture', `${listeCle.length} outils`);

  /* ════ 1b. MONTANTS SELON LE RÔLE ════ */
  // La règle de l'écran des rôles doit tenir AUSSI via l'agent : un
  // technicien d'une org cliente ne doit pas voir via Claude les prix que
  // l'application lui cache. On crée un VRAI membre au rôle restreint, il
  // se connecte, et on vérifie — pendant que le propriétaire (le reste de
  // la suite) continue de tout voir.
  console.log('');
  console.log('  ── Montants selon le rôle ──');
  const courrielTech = 'qa.technicien.montants@test.lume.dev';
  { // repartir propre si un run précédent a planté
    const { data: ancien } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const deja = (ancien?.users || []).find((u) => u.email === courrielTech);
    if (deja) { await admin.from('memberships').delete().eq('user_id', deja.id); await admin.auth.admin.deleteUser(deja.id); }
  }
  const { data: cree, error: eCree } = await admin.auth.admin.createUser({ email: courrielTech, email_confirm: true });
  if (eCree) throw new Error('création du technicien : ' + eCree.message);
  const techId = cree.user.id;
  await admin.from('memberships').insert({ org_id: ORG, user_id: techId, role: 'technician', status: 'active' });

  const { data: lienT } = await admin.auth.admin.generateLink({ type: 'magiclink', email: courrielTech });
  const { data: sessT } = await anon.auth.verifyOtp({ token_hash: lienT.properties.hashed_token, type: 'magiclink' });
  const jTech = await jetonPour(sessT.session, reg.client_id, 'mcp:read');

  const jobsTech = await outil(jTech, 'list_jobs', { limit: 5 });
  R(jobsTech.montants_masques === true, 'Technicien : la réponse annonce le masquage');
  R((jobsTech.jobs || []).every((j) => j.total_cents === null || j.total_cents === undefined),
    'Technicien : aucun montant de job visible', `${(jobsTech.jobs || []).length} job(s) blanchis`);
  R(!!jobsTech.note_montants, 'La note explique le masquage à l\u2019assistant');

  const caTech = await outil(jTech, 'get_revenue_summary', { period: 'this_month' });
  R(!!caTech.error && /rôles|montants/i.test(caTech.error) && caTech.revenue_cents === undefined,
    'Technicien : le chiffre d\u2019affaires est refusé, en langage d\u2019exploitant');

  const factTech = await outil(jTech, 'list_invoices', { limit: 5 });
  R(!!factTech.error && factTech.invoices === undefined, 'Technicien : les factures sont refusées');

  // La MATRICE au-delà des montants : le préréglage technicien de l'app
  // n'inclut ni prospects, ni devis, ni équipe — mais inclut les SMS.
  const leadsTech = await outil(jTech, 'search_leads', { query: '', limit: 3 });
  R(!!leadsTech.error && /prospects/i.test(leadsTech.error), 'Technicien : prospects refusés (matrice)');
  const equipeTech = await outil(jTech, 'get_team', {});
  R(!!equipeTech.error && /équipe/i.test(equipeTech.error), 'Technicien : équipe refusée (matrice)');
  const devisTech = await outil(jTech, 'list_quotes', { limit: 3 });
  R(!!devisTech.error, 'Technicien : devis refusés');
  const smsTech = await outil(jTech, 'get_conversations', { limit: 3 });
  R(!smsTech.error && typeof (smsTech.total_matching ?? smsTech.count) === 'number',
    'Technicien : SMS accessibles (droit du préréglage)', `${smsTech.total_matching ?? smsTech.count}`);

  const { data: unVrai } = await admin.from('clients')
    .select('first_name, last_name').eq('org_id', ORG).is('deleted_at', null)
    .not('first_name', 'is', null).not('last_name', 'is', null).limit(1).maybeSingle();
  if (unVrai?.first_name && unVrai?.last_name) {
    const nomComplet = `${unVrai.first_name} ${unVrai.last_name}`;
    const rechComplet = await outil(jLecture, 'search_clients', { query: nomComplet, limit: 5 });
    R((rechComplet.count ?? 0) >= 1, 'search_clients trouve Prenom Nom complet (multi-tokens)', `"${nomComplet}" -> ${rechComplet.count}`);
  } else {
    console.log('  . recherche multi-tokens : aucun client prenom+nom en staging, saute');
  }
  const clientsTech = await outil(jTech, 'search_clients', { query: '', limit: 5 });
  R((clientsTech.count ?? clientsTech.clients?.length ?? 0) >= 0 && !clientsTech.error,
    'Technicien : le reste du CRM fonctionne normalement', `${clientsTech.count ?? 0} client(s)`);

  // Et le PROPRIÉTAIRE, lui, voit toujours tout — même appel, même org.
  const jobsProprio = await outil(jLecture, 'list_jobs', { limit: 5 });
  R(jobsProprio.montants_masques === undefined
      && (jobsProprio.jobs || []).some((j) => typeof j.total_cents === 'number'),
    'Propriétaire : montants intacts, aucun masquage');

  // Ménage du technicien (jetons, membership, compte).
  await admin.from('oauth_tokens').update({ revoked: true, revoked_at: new Date().toISOString(), revoked_reason: 'qa_roles' })
    .eq('user_id', techId);
  await admin.from('memberships').delete().eq('user_id', techId);
  await admin.auth.admin.deleteUser(techId);

  /* ════ 2. LECTURES vs sources de l'app ════ */
  console.log('\n  ── Lectures : mêmes chiffres que l\'app ──');
  const compte = async (table, filtres = (q) => q) => {
    const { count } = await filtres(admin.from(table).select('*', { count: 'exact', head: true }).eq('org_id', ORG));
    return count ?? 0;
  };

  const conv = await outil(jLecture, 'get_conversations', { limit: 30 });
  R(conv.total_matching === await compte('conversations'), 'get_conversations (total réel)', `${conv.total_matching}`);

  const equipe = await outil(jLecture, 'get_team');
  R(equipe.count === await compte('team_members'), 'get_team', `${equipe.count} membres`);

  const taches = await outil(jLecture, 'list_tasks', { status: 'all', limit: 40 });
  const tachesApp = await compte('tasks', (q) => q.is('deleted_at', null));
  R(taches.total_matching === tachesApp, 'list_tasks (total réel)', `${taches.total_matching}`);

  const demandes = await outil(jLecture, 'list_request_submissions', { limit: 30 });
  const demandesApp = await compte('form_submissions', (q) => q.is('deleted_at', null).is('archived_at', null));
  R(demandes.count === Math.min(demandesApp, 30), 'list_request_submissions', `${demandes.count}`);

  const cours = await outil(jLecture, 'list_courses');
  const coursApp = await compte('courses', (q) => q.is('deleted_at', null));
  R(cours.count === Math.min(coursApp, 30), 'list_courses', `${cours.count}`);

  const autos = await outil(jLecture, 'list_automations');
  R(autos.count === Math.min(await compte('automation_rules'), 50), 'list_automations', `${autos.count}`);

  const heures = await outil(jLecture, 'get_timesheets', {});
  R(!heures.error && Array.isArray(heures.employees), 'get_timesheets répond', `${heures.total_hours ?? '?'} h / 7 j`);

  const d2d = await outil(jLecture, 'get_d2d_stats', {});
  R(!d2d.error && d2d.total && typeof d2d.total.knocks === 'number', 'get_d2d_stats répond', `${d2d.total?.knocks ?? '?'} portes`);

  const fil = await outil(jLecture, 'get_conversation_messages', { phone_number: '+15145550000' });
  R(!fil.error && (fil.count === 0 || Array.isArray(fil.messages)), 'get_conversation_messages répond');

  console.log('\n  ── Lectures sensibles (identité) ──');
  const paie = await outil(jLecture, 'get_payroll_summary');
  R(!paie.error && !!paie.period, 'get_payroll_summary (avec session)', paie.period ? `période ${paie.period.start} → ${paie.period.end}` : '');
  const fin = await outil(jLecture, 'get_financial_overview');
  R(!fin.error && typeof fin.revenue_this_month_cents === 'number', 'get_financial_overview (avec session)');
  const gps = await outil(jLecture, 'get_team_locations');
  R(!gps.error && typeof gps.count === 'number', 'get_team_locations répond', `${gps.count} position(s) fraîche(s)`);

  /* ════ 2b. PARALLÉLISME : la session doit survivre au brief ════ */
  // Le bug vécu en prod le 2026-09-03 : le brief lance plusieurs outils en
  // parallèle, chacun rafraîchissait la session, la rotation simultanée
  // passait pour un vol et Supabase révoquait tout. Ce test tire DIX appels
  // à identité en même temps, puis revérifie que la session respire encore.
  console.log('');
  console.log('  ── Parallélisme (le tueur de session) ──');
  const salve = await Promise.all(
    Array.from({ length: 10 }, () => outil(jLecture, 'get_revenue_summary', { period: 'this_month' })),
  );
  const reussies = salve.filter((r) => typeof r.revenue_cents === 'number').length;
  R(reussies === 10, '10 appels à identité EN PARALLÈLE réussissent', `${reussies}/10`);
  const apresSalve = await outil(jLecture, 'get_financial_overview', {});
  R(typeof apresSalve.revenue_this_month_cents === 'number',
    'La session est encore vivante après la salve',
    apresSalve.error ? 'MORTE — rotation concurrente' : 'OK');

  /* ════ 2c. SESSION DÉDIÉE : le navigateur ne tue plus Claude ════ */
  // LE bug quotidien de Rafba : Claude et le navigateur partageaient une
  // session ; ouvrir Lume rafraîchissait le jeton et tuait la connexion
  // Claude. Correctif : session dédiée créée au consentement. Ici on
  // rafraîchit une AUTRE session du même user (le navigateur) et on vérifie
  // que Claude respire encore juste après.
  console.log('');
  console.log('  ── Session dédiée (le navigateur ne tue plus Claude) ──');
  {
    // 1. Session « navigateur » indépendante pour le même utilisateur.
    const lienNav = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
    const sessNav = (await anon.auth.verifyOtp({ token_hash: lienNav.data.properties.hashed_token, type: 'magiclink' })).data.session;
    // 2. Le navigateur rafraîchit (comme quand tu ouvres Lume), au-delà du reuse_interval.
    const cNav = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    await cNav.auth.refreshSession({ refresh_token: sessNav.refresh_token });
    await new Promise((r) => setTimeout(r, 6000));
    // 3. Claude appelle un outil à identité : il doit RÉPONDRE, pas mourir.
    const apresNav = await outil(jLecture, 'get_revenue_summary', { period: 'this_month' });
    R(typeof apresNav.revenue_cents === 'number',
      'Claude survit au rafraîchissement du navigateur (session dédiée)',
      apresNav.error ? 'MORTE — sessions encore partagées' : 'OK, indépendantes');
  }

  /* ════ 3. ÉCRITURES ════ */
  console.log('\n  ── Écritures ──');
  const aNettoyer = { tasks: [], jobs: [], clients: [], quotes: [], invoices: [] };

  // create_task + idempotence
  const argsTache = { title: 'QA Étendus — tâche test', priority: 'high' };
  const t1 = await outil(jEcriture, 'create_task', argsTache);
  R(t1.created && t1.task?.id, 'create_task crée', t1.task?.id?.slice(0, 8));
  if (t1.task?.id) aNettoyer.tasks.push(t1.task.id);
  const t2 = await outil(jEcriture, 'create_task', argsTache);
  R(t2.deja_fait === true && t2.task?.id === t1.task?.id, 'create_task rejoué → même tâche, pas de doublon');
  const { count: nbTaches } = await admin.from('tasks').select('*', { count: 'exact', head: true })
    .eq('org_id', ORG).eq('title', argsTache.title);
  R(nbTaches === 1, 'Une seule tâche en base malgré deux appels');

  // create_client
  const c1 = await outil(jEcriture, 'create_client', {
    first_name: 'QAÉtendus', last_name: 'Testeur', phone: '+15145550199',
  });
  R(c1.created && c1.client?.id, 'create_client crée', c1.client?.name);
  if (c1.client?.id) aNettoyer.clients.push(c1.client.id);

  // create_job (brouillon sans date, planifié avec date) + plafond
  const j1 = await outil(jEcriture, 'create_job', {
    title: 'QA Étendus — job test', client_id: c1.client?.id,
    line_items: [{ name: 'Lavage', qty: 2, unit_price_cents: 12500 }],
  });
  R(j1.created === true && !!j1.job?.id, 'create_job (complet) crée', j1.job?.job_number ? `#${j1.job.job_number}` : '');
  if (j1.job?.id) aNettoyer.jobs.push(j1.job.id);
  R(j1.subtotal_cents === 25000, 'Sous-total exact (2 x 125,00 $)', `${j1.subtotal_cents}`);
  R(j1.total_cents >= j1.subtotal_cents && Array.isArray(j1.taxes_appliquees),
    'Taxes de l\u2019org appliquees par le calculateur de l\u2019app',
    `${j1.taxes_appliquees?.join(' + ') || 'aucune'} -> total ${j1.total_cents}`);
  const nomsTax = j1.taxes_appliquees || [];
  R(new Set(nomsTax).size === nomsTax.length, 'Aucune taxe en double (tax_configs dupliquees)', nomsTax.join(' + ') || 'aucune');
  const { data: lignesJob } = await admin.from('job_line_items')
    .select('name, qty, unit_price_cents, total_cents').eq('job_id', j1.job?.id).is('deleted_at', null);
  R((lignesJob || []).length === 1 && lignesJob[0].qty === 2 && lignesJob[0].total_cents === 25000,
    'De VRAIES lignes d\u2019items en base (pas un resume en note)', `${(lignesJob || []).length} ligne(s)`);
  const { data: jobBase } = await admin.from('jobs')
    .select('total_cents, subtotal_cents, tax_cents, tax_lines, client_name').eq('id', j1.job?.id).maybeSingle();
  R(jobBase?.subtotal_cents === 25000 && jobBase?.total_cents === j1.total_cents && Array.isArray(jobBase?.tax_lines),
    'Finances ecrites en cents + tax_lines stockees');
  R(!!jobBase?.client_name, 'client_name resolu comme le fait l\u2019app', jobBase?.client_name);
  const dJ1 = await outil(jLecture, 'get_job', { job_id: j1.job?.id });
  R(Array.isArray(dJ1.line_items) && dJ1.line_items.length === 1, 'get_job livre le detail des items');
  const majJob = await outil(jEcriture, 'update_job', {
    job_id: j1.job?.id, title: 'QA Etendus - job test v2',
    line_items: [{ name: 'Grand menage', qty: 3, unit_price_cents: 10000 }],
  });
  R(majJob.updated === true && majJob.subtotal_cents === 30000,
    'update_job remplace les items et recalcule', `sous-total ${majJob.subtotal_cents}`);
  const { count: nbLignesApres } = await admin.from('job_line_items')
    .select('*', { count: 'exact', head: true }).eq('job_id', j1.job?.id).is('deleted_at', null);
  R(nbLignesApres === 1, 'Anciennes lignes remplacees, pas empilees', `${nbLignesApres}`);
  const jCap = await outil(jEcriture, 'create_job', {
    title: 'QA Étendus — trop cher', line_items: [{ name: 'X', qty: 1, unit_price_cents: 200_000_000 }],
  });
  R(!!jCap.error && /plafond/i.test(jCap.error), 'create_job au-delà du plafond refusé');

  // update_job_status : valide, puis invalide
  const s1 = await outil(jEcriture, 'update_job_status', { job_id: j1.job?.id, status: 'in_progress' });
  R(s1.updated && s1.job?.status === 'in_progress', 'update_job_status valide');
  const s2 = await outil(jEcriture, 'update_job_status', { job_id: j1.job?.id, status: 'nimporte' });
  R(!!s2.error && /invalide/i.test(s2.error), 'update_job_status invalide refusé');

  // assign_job : membre réel, puis inconnu
  const { data: unMembre } = await admin.from('team_members')
    .select('user_id').eq('org_id', ORG).limit(1).maybeSingle();
  if (unMembre) {
    const a1 = await outil(jEcriture, 'assign_job', { job_id: j1.job?.id, assignee_user_id: unMembre.user_id });
    R(a1.updated === true, 'assign_job vers un membre réel', a1.assigned_to);
  } else {
    console.log('  · assign_job (membre réel) : aucun team_member dans cette org, sauté');
  }
  const a2 = await outil(jEcriture, 'assign_job', { job_id: j1.job?.id, assignee_user_id: crypto.randomUUID() });
  R(!!a2.error && /membre/i.test(a2.error), 'assign_job vers un inconnu refusé');

  // create_quote — via les mêmes RPC que l'app
  const q1 = await outil(jEcriture, 'create_quote', {
    title: 'QA Étendus — devis test', client_id: c1.client?.id,
    line_items: [{ name: 'Entretien', quantity: 3, unit_price_cents: 10000 }],
  });
  R(q1.created && q1.quote_id, 'create_quote crée (RPC de l\'app)', q1.quote_id?.slice(0, 8));
  if (q1.quote_id) aNettoyer.quotes.push(q1.quote_id);

  // Devis à quantité NÉGATIVE : doit être refusé (total négatif), pas créé.
  const qNeg = await outil(jEcriture, 'create_quote', {
    title: 'QA Étendus — devis négatif', client_id: c1.client?.id,
    line_items: [{ name: 'Bidon', quantity: -5, unit_price_cents: 10000 }],
  });
  R(!qNeg.created && !!qNeg.error && /négatif|positif/i.test(qNeg.error || ''),
    'create_quote à quantité négative refusé', qNeg.error ? 'refusé' : 'CRÉÉ À TORT');
  if (qNeg.quote_id) aNettoyer.quotes.push(qNeg.quote_id);
  const { data: devisBase } = await admin.from('quotes').select('subtotal_cents, total_cents, status').eq('id', q1.quote_id).maybeSingle();
  R(devisBase?.subtotal_cents === 30000 && (devisBase?.total_cents ?? 0) >= 30000,
    'Totaux du devis recalculés PAR la base (taxes incluses)',
    `sous-total ${devisBase?.subtotal_cents}, total ${devisBase?.total_cents}`);

  // create_invoice — brouillon, jamais envoyée
  const f1 = await outil(jEcriture, 'create_invoice', {
    client_id: c1.client?.id, subject: 'QA Étendus — facture test',
    items: [{ description: 'Service', qty: 1, unit_price_cents: 45000 }],
  });
  R(f1.created && f1.invoice_id && f1.status === 'draft', 'create_invoice crée un BROUILLON');
  if (f1.invoice_id) aNettoyer.invoices.push(f1.invoice_id);
  const { data: factBase } = await admin.from('invoices').select('status, total_cents').eq('id', f1.invoice_id).maybeSingle();
  R(factBase?.status === 'draft', 'La facture reste en brouillon en base', factBase?.status);

  // send_sms : sans Twilio local → erreur PROPRE (pas le message générique)
  const sms = await outil(jEcriture, 'send_sms', { phone_number: '+15145550100', message_text: 'test' });
  R(!!sms.error && !/La consultation a échoué/i.test(sms.error), 'send_sms échoue proprement sans Twilio', (sms.error || '').slice(0, 60));


  // ── Relances d'impayés en lot ──
  // Twilio absent en local : on vérifie le TRI (client sans tel ignoré
  // proprement, pas d'échec dur) et le compte-rendu. Un client avec tel
  // mais sans Twilio compte comme « ignoré » avec raison — jamais un crash.
  const relances = await outil(jEcriture, 'send_payment_reminders', {
    reminders: [
      { client_id: c1.client?.id, message: 'Rappel amical : petite facture en attente.' },
      { client_id: '00000000-0000-0000-0000-000000000000', message: 'client fantome' },
    ],
  });
  R(typeof relances.sent_count === 'number' && typeof relances.skipped_count === 'number',
    'send_payment_reminders renvoie un compte-rendu', `envoyés ${relances.sent_count}, ignorés ${relances.skipped_count}`);
  R((relances.skipped || []).some((x) => /introuvable/i.test(x.raison || '')),
    'Client inexistant ignoré proprement (pas de crash du lot)');
  R(relances.sent_count + relances.skipped_count === 2, 'Chaque destinataire est traité une fois');
  // Le client c1 a un téléphone mais Twilio est absent → ignoré, jamais un
  // envoi fantôme.
  R((relances.skipped || []).every((x) => !!x.raison), 'Chaque ignoré porte sa raison');
  /* ════ 4. OUTILS D'ASSISTANT ════ */
  console.log('');
  console.log('');
  console.log('  ── Gestion : calendrier, modifications, classement ──');

  // create_job AVEC date → une VISITE existe au calendrier (le modèle de
  // l'app : un job sans visite est un brouillon invisible au calendrier).
  const demainISO = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const jCal = await outil(jEcriture, 'create_job', {
    title: 'QA Étendus — job calendrier', client_id: c1.client?.id,
    scheduled_at: `${demainISO}T14:00:00Z`,
  });
  R(jCal.created && jCal.visit?.start_at, 'create_job avec date → visite créée', jCal.visit?.start_at);
  if (jCal.job?.id) aNettoyer.jobs.push(jCal.job.id);
  const { data: visiteBase } = await admin.from('schedule_events')
    .select('id, start_at').eq('job_id', jCal.job?.id).is('deleted_at', null).maybeSingle();
  R(!!visiteBase, 'La visite vit dans schedule_events (écran Calendrier)');
  const { data: jobResync } = await admin.from('jobs')
    .select('scheduled_at, status').eq('id', jCal.job?.id).maybeSingle();
  R(!!jobResync?.scheduled_at && jobResync?.status !== 'draft',
    'La RPC a recalculé scheduled_at et le statut', `${jobResync?.status}`);

  // reschedule_job → la visite bouge, comme un glisser-déposer.
  const nouvelHoraire = `${demainISO}T16:30:00Z`;
  const dep = await outil(jEcriture, 'reschedule_job', { job_id: jCal.job?.id, start_at: nouvelHoraire });
  R(dep.rescheduled === true, 'reschedule_job déplace la visite', `chevauchements=${dep.overlaps}`);
  const { data: visiteApres } = await admin.from('schedule_events')
    .select('start_at').eq('id', visiteBase?.id).maybeSingle();
  R(new Date(visiteApres?.start_at).getTime() === new Date(nouvelHoraire).getTime(),
    'Le nouveau créneau est en base', visiteApres?.start_at);

  // update_client → corriger un téléphone.
  const maj = await outil(jEcriture, 'update_client', { client_id: c1.client?.id, phone: '+1514555042' });
  R(maj.updated === true && maj.client?.phone === '+1514555042',
    'update_client corrige le téléphone', maj.client?.phone);
  const majCourrielKO = await outil(jEcriture, 'update_client', { client_id: c1.client?.id, email: 'pas-un-courriel' });
  R(!!majCourrielKO.error && /courriel/i.test(majCourrielKO.error), 'update_client refuse un courriel invalide');

  // update_task_status → faite, puis rouverte.
  const faite = await outil(jEcriture, 'update_task_status', { task_id: t1.task?.id, status: 'done' });
  R(faite.updated === true && faite.task?.status === 'done', 'update_task_status → faite');
  const { data: tacheBase } = await admin.from('tasks').select('completed_at').eq('id', t1.task?.id).maybeSingle();
  R(!!tacheBase?.completed_at, 'completed_at posé comme le fait l\u2019app');

  // add_note → visible dans le fil d'activité, signée par l'utilisateur.
  const note = await outil(jEcriture, 'add_note', { entity_type: 'client', entity_id: c1.client?.id, note: 'QA Étendus — note test' });
  R(note.added === true, 'add_note écrit au fil d\u2019activité');
  const { data: noteBase } = await admin.from('activity_notes')
    .select('id, actor_id').eq('org_id', ORG).eq('entity_id', c1.client?.id).eq('body', 'QA Étendus — note test').maybeSingle();
  R(!!noteBase && noteBase.actor_id === sess.user.id, 'La note porte le vrai auteur (actor_id)');
  if (noteBase?.id) aNettoyer.notes = [noteBase.id];

  // archive_job → sort des comptes, puis restauration.
  const arch = await outil(jEcriture, 'archive_job', { job_id: j1.job?.id });
  R(arch.archived === true, 'archive_job archive');
  const rest = await outil(jEcriture, 'archive_job', { job_id: j1.job?.id, restore: true });
  R(rest.restored === true, 'archive_job restore ramène le job');

  // add_visit → une DEUXIÈME visite sur le job du calendrier.
  const demain2 = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const v2 = await outil(jEcriture, 'add_visit', { job_id: jCal.job?.id, start_at: `${demain2}T09:00:00Z` });
  R(v2.added === true, 'add_visit ajoute une seconde visite', v2.visit?.start_at);
  const { count: nbVisites } = await admin.from('schedule_events')
    .select('*', { count: 'exact', head: true }).eq('job_id', jCal.job?.id).is('deleted_at', null);
  R(nbVisites === 2, 'Le job porte bien deux visites au calendrier', `${nbVisites}`);

  // convert_lead_to_client → le prospect devient client actif.
  const lead1 = await outil(jEcriture, 'create_client', {
    first_name: 'QAÉtendus', last_name: 'Prospect', phone: '+15145550777',
  });
  await admin.from('clients').update({ status: 'lead' }).eq('id', lead1.client?.id);
  const convL = await outil(jEcriture, 'convert_lead_to_client', { lead_id: lead1.client?.id });
  R(convL.converted === true, 'convert_lead_to_client convertit', convL.client?.name);
  const { data: apresConv } = await admin.from('clients').select('status, lead_status').eq('id', lead1.client?.id).maybeSingle();
  R(apresConv?.status === 'active' && apresConv?.lead_status === 'closed_won',
    'Statuts posés comme le fait l\u2019app', `${apresConv?.status}/${apresConv?.lead_status}`);
  if (lead1.client?.id) aNettoyer.clients.push(lead1.client.id);

  // convert_quote_to_job → la route de conversion de l'app.
  const convQ = await outil(jEcriture, 'convert_quote_to_job', { quote_id: q1.quote_id });
  R(convQ.converted === true || (!!convQ.error && !/La consultation a échoué/i.test(convQ.error)),
    'convert_quote_to_job : route de conversion appelée',
    convQ.job?.job_number ? `job #${convQ.job.job_number}` : (convQ.error || '').slice(0, 60));
  if (convQ.job?.id) aNettoyer.jobs.push(convQ.job.id);

  // create_invoice_from_job → le flux « facture le job #X » de l'app.
  const factJob = await outil(jEcriture, 'create_invoice_from_job', { job_id: jCal.job?.id });
  R((factJob.created === true && factJob.status === 'draft') || (!!factJob.error && !/La consultation a échoué/i.test(factJob.error)),
    'create_invoice_from_job : RPC de clôture appelée',
    factJob.invoice_id ? 'brouillon ' + factJob.invoice_id.slice(0, 8) : (factJob.error || '').slice(0, 60));
  if (factJob.invoice_id) aNettoyer.invoices.push(factJob.invoice_id);

  console.log('  ── Assistant : profil, brief, mémoire, envois ──');

  // Profil 360° du client de test — il a un job, un devis et une facture.
  const profil = await outil(jLecture, 'get_client_profile', { client_id: c1.client?.id });
  R(profil.client?.name === 'QAÉtendus Testeur', 'get_client_profile : identité', profil.client?.name);
  R((profil.jobs?.total ?? 0) >= 1 && (profil.jobs?.lifetime_value_cents ?? 0) >= 25000,
    'Profil : historique de jobs et valeur à vie', `${profil.jobs?.total} job(s), ${profil.jobs?.lifetime_value_cents} ¢`);
  R((profil.billing?.invoices_total ?? 0) >= 1, 'Profil : facturation visible', `${profil.billing?.invoices_total} facture(s)`);
  R((profil.quotes?.total ?? 0) >= 1, 'Profil : devis visibles');

  // Briefing — les cinq sections répondent avec de vrais totaux.
  const brief = await outil(jLecture, 'get_morning_briefing', {});
  R(!!brief.date && ['overdue_invoices', 'todays_visits', 'tasks_due', 'new_requests_48h', 'unread_sms']
      .every((k) => typeof brief[k]?.total_matching === 'number'),
    'get_morning_briefing : les 5 sections avec totaux réels',
    `impayés=${brief.overdue_invoices?.total_matching} visites=${brief.todays_visits?.total_matching} tâches=${brief.tasks_due?.total_matching}`);

  // Mémoire — écrire, relire, et visible dans la table de l'app.
  const mem = await outil(jEcriture, 'remember_this', { key: 'qa-jour-facturation', note: 'QA — facturer le vendredi' });
  R(mem.remembered === true, 'remember_this enregistre', mem.key);
  const rappel = await outil(jLecture, 'recall_notes', {});
  R((rappel.notes || []).some((n) => n.key === 'qa-jour-facturation'), 'recall_notes relit la préférence');
  const { data: enTable } = await admin.from('org_knowledge')
    .select('id').eq('org_id', ORG).eq('category', 'assistant').eq('key', 'qa-jour-facturation').maybeSingle();
  R(!!enTable, 'La note vit dans org_knowledge (visible dans l’app)');

  // Continuité — l'agent sait ce qu'il vient de faire.
  const actions = await outil(jLecture, 'get_recent_agent_actions', {});
  R((actions.actions || []).some((a) => ['add_note', 'update_task_status', 'archive_job'].includes(a.outil)),
    'get_recent_agent_actions : les actions récentes y figurent', `${(actions.actions || []).length} action(s)`);

  // Envoi de facture — passe par LA route de l'app avec la session de
  // l'utilisateur. En local sans SMTP, on attend un échec PROPRE (message
  // de la route), jamais le générique — et jamais un envoi fantôme.
  const envoi = await outil(jEcriture, 'send_invoice', { invoice_id: f1.invoice_id });
  R(envoi.sent === true || (!!envoi.error && !/La consultation a échoué/i.test(envoi.error)),
    'send_invoice : route de l’app appelée (envoi réel ou refus propre)',
    envoi.sent ? 'envoyée' : (envoi.error || '').slice(0, 70));
  const memeEnvoi = await outil(jEcriture, 'send_invoice', { invoice_id: f1.invoice_id });
  if (envoi.sent === true) {
    R(memeEnvoi.deja_fait === true, 'send_invoice rejoué → pas de double courriel');
  } else {
    console.log('  · idempotence d’envoi : non testable ici (l’échec libère l’empreinte, voulu)');
  }

  /* ════ Nettoyage ════ */
  for (const id of aNettoyer.invoices) {
    await admin.from('invoice_items').delete().eq('invoice_id', id);
    await admin.from('invoices').delete().eq('id', id);
  }
  for (const id of aNettoyer.quotes) {
    await admin.from('quote_line_items').delete().eq('quote_id', id);
    await admin.from('quote_status_history').delete().eq('quote_id', id);
    await admin.from('quotes').delete().eq('id', id);
  }
  for (const id of aNettoyer.jobs) {
    await admin.from('job_line_items').delete().eq('job_id', id);
    await admin.from('schedule_events').delete().eq('job_id', id);
    await admin.from('jobs').delete().eq('id', id);
  }
  for (const id of (aNettoyer.notes || [])) await admin.from('activity_notes').delete().eq('id', id);
  for (const id of aNettoyer.tasks) await admin.from('tasks').delete().eq('id', id);
  for (const id of aNettoyer.clients) await admin.from('clients').delete().eq('id', id);
  await admin.from('agent_actions').delete().eq('org_id', ORG);
  await admin.from('org_knowledge').delete().eq('org_id', ORG).eq('category', 'assistant').eq('key', 'qa-jour-facturation');
  await admin.from('api_keys').delete().like('name', 'QA Étendus%');
  await admin.from('oauth_tokens').update({ revoked: true, revoked_at: new Date().toISOString(), revoked_reason: 'qa' })
    .eq('client_id', reg.client_id);
  await admin.from('oauth_clients').delete().like('client_name', 'QA Étendus%');
  console.log('\n  (créations de test supprimées, jetons révoqués)');

  console.log(`\n  ${ok.length} vérifications passées, ${ko.length} échec(s).`);
  if (ko.length) { console.log('\n  À corriger :'); for (const k of ko) console.log(`   • ${k}`); process.exit(1); }
  console.log('  Outils étendus conformes.\n');
})().catch((e) => { console.error('\n  ÉCHEC :', e.message); process.exit(2); });
