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

const rpc = async (jeton, method, params = {}, entetes = {}) =>
  fetch(`${API}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}`, ...entetes },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }).then((r) => r.json());

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

  /* ════ 1. SCOPES ════ */
  console.log('  ── Scopes et visibilité ──');
  const listeLecture = (await rpc(jLecture, 'tools/list')).result.tools.map((t) => t.name);
  const listeEcriture = (await rpc(jEcriture, 'tools/list')).result.tools.map((t) => t.name);
  const ecritures = ['create_job', 'create_client', 'create_task', 'create_quote', 'create_invoice', 'send_sms', 'update_job_status', 'assign_job'];
  R(!ecritures.some((n) => listeLecture.includes(n)), 'Jeton lecture : AUCUNE écriture visible',
    `${listeLecture.length} outils`);
  R(ecritures.every((n) => listeEcriture.includes(n)), 'Jeton écriture : les 8 écritures visibles',
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

  /* ════ 2. LECTURES vs sources de l'app ════ */
  console.log('\n  ── Lectures : mêmes chiffres que l\'app ──');
  const compte = async (table, filtres = (q) => q) => {
    const { count } = await filtres(admin.from(table).select('*', { count: 'exact', head: true }).eq('org_id', ORG));
    return count ?? 0;
  };

  const conv = await outil(jLecture, 'get_conversations', { limit: 30 });
  R(conv.count === Math.min(await compte('conversations'), 30), 'get_conversations', `${conv.count}`);

  const equipe = await outil(jLecture, 'get_team');
  R(equipe.count === await compte('team_members'), 'get_team', `${equipe.count} membres`);

  const taches = await outil(jLecture, 'list_tasks', { status: 'all', limit: 40 });
  const tachesApp = await compte('tasks', (q) => q.is('deleted_at', null));
  R(taches.count === Math.min(tachesApp, 40), 'list_tasks (all)', `${taches.count}`);

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
  R(j1.created && j1.job?.status === 'draft' && j1.job?.id, 'create_job sans date → brouillon');
  if (j1.job?.id) aNettoyer.jobs.push(j1.job.id);
  const { data: jobBase } = await admin.from('jobs').select('total_cents, client_name').eq('id', j1.job?.id).maybeSingle();
  R(jobBase?.total_cents === 25000, 'Montant écrit en *_cents (2 × 125,00 $)', `${jobBase?.total_cents}`);
  R(!!jobBase?.client_name, 'client_name résolu comme le fait l\'app', jobBase?.client_name);

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
  R(!!sms.error && !/That lookup/i.test(sms.error), 'send_sms échoue proprement sans Twilio', (sms.error || '').slice(0, 60));

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
  for (const id of aNettoyer.jobs) await admin.from('jobs').delete().eq('id', id);
  for (const id of aNettoyer.tasks) await admin.from('tasks').delete().eq('id', id);
  for (const id of aNettoyer.clients) await admin.from('clients').delete().eq('id', id);
  await admin.from('agent_actions').delete().eq('org_id', ORG);
  await admin.from('api_keys').delete().like('name', 'QA Étendus%');
  await admin.from('oauth_tokens').update({ revoked: true, revoked_at: new Date().toISOString(), revoked_reason: 'qa' })
    .eq('client_id', reg.client_id);
  await admin.from('oauth_clients').delete().like('client_name', 'QA Étendus%');
  console.log('\n  (créations de test supprimées, jetons révoqués)');

  console.log(`\n  ${ok.length} vérifications passées, ${ko.length} échec(s).`);
  if (ko.length) { console.log('\n  À corriger :'); for (const k of ko) console.log(`   • ${k}`); process.exit(1); }
  console.log('  Outils étendus conformes.\n');
})().catch((e) => { console.error('\n  ÉCHEC :', e.message); process.exit(2); });
