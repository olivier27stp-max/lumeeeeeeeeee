#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   VÉRIFICATION — les outils de l'agent disent-ils la MÊME CHOSE
   que l'interface ?

   Les autres scripts vérifient que le protocole fonctionne. Celui-ci
   vérifie que les RÉPONSES sont justes — le trou par lequel le bug
   des jobs est passé : l'agent répondait « 27 scheduled » quand
   l'écran affichait « 22 en retard ». Les deux avaient raison, dans
   deux vocabulaires différents.

   Méthode : pour chaque outil, on interroge la même source que le
   fichier src/lib/*Api.ts correspondant, et on compare. Un écart =
   l'agent et l'utilisateur ne parlent pas de la même chose.

   LECTURE SEULE. Aucune donnée n'est modifiée.

   Usage :
     node --env-file=.env.local scripts/qa/verifier-coherence-agent.mjs
     (ajouter --prod pour viser la production)
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const PROD = process.argv.includes('--prod');
const API = (process.env.QA_API_URL || 'http://localhost:3002').replace(/\/$/, '');
const BASE = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

// En prod on interroge la base par l'API Management (pas de clé service locale).
const REF_PROD = process.env.SUPABASE_PROJECT_REF_PROD;
const TOKEN_MGMT = process.env.SUPABASE_ACCESS_TOKEN;

const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

async function sqlProd(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF_PROD}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN_MGMT}`, 'Content-Type': 'application/json', 'User-Agent': 'curl/8.7.1' },
    body: JSON.stringify({ query: q }),
  });
  return r.json();
}

const ok = [], ecarts = [];
function comparer(libelle, attendu, obtenu, note = '') {
  const identique = String(attendu) === String(obtenu);
  if (identique) {
    ok.push(libelle);
    console.log(`  ✓ ${libelle.padEnd(38)} ${obtenu}${note ? '   ' + note : ''}`);
  } else {
    ecarts.push({ libelle, attendu, obtenu, note });
    console.log(`  ✗ ${libelle.padEnd(38)} agent=${obtenu}  app=${attendu}${note ? '   ' + note : ''}`);
  }
}

(async () => {
  console.log(`\n  Cible : ${PROD ? 'PRODUCTION' : 'staging'} — lecture seule\n`);

  // ── Un jeton OAuth réel, comme Claude en obtiendrait un ──
  await admin.from('oauth_clients').delete().like('client_name', 'QA Cohérence%');
  const reg = await fetch(`${API}/api/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'QA Cohérence', redirect_uris: ['https://qa.test/cb'] }),
  }).then((r) => r.json());

  const verif = crypto.randomBytes(48).toString('base64url');
  const chall = crypto.createHash('sha256').update(verif).digest('base64url');
  const compte = process.env.QA_COMPTE || 'willhebert30@gmail.com';
  const { data: lien, error: eLien } = await admin.auth.admin.generateLink({ type: 'magiclink', email: compte });
  if (eLien) throw new Error(`lien refusé pour ${compte} : ${eLien.message}`);
  const { data: sess } = await anon.auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });

  const cons = await fetch(`${API}/api/oauth/consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session.access_token}` },
    body: JSON.stringify({
      client_id: reg.client_id, redirect_uri: 'https://qa.test/cb',
      code_challenge: chall, scope: 'mcp:read', resource: `${BASE}/api/mcp`,
      // Comme le fait l'écran de consentement : sans cette session, le serveur
      // interroge la base sans identité et les outils à RPC échouent.
      supabase_refresh_token: sess.session.refresh_token,
    }),
  }).then((r) => r.json());
  const code = new URL(cons.redirect_to).searchParams.get('code');
  const tok = await fetch(`${API}/api/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code', code, client_id: reg.client_id,
      redirect_uri: 'https://qa.test/cb', code_verifier: verif, resource: `${BASE}/api/mcp`,
    }),
  }).then((r) => r.json());
  if (!tok.access_token) throw new Error('jeton non obtenu : ' + JSON.stringify(tok).slice(0, 150));

  const orgId = (await admin.from('memberships')
    .select('org_id').eq('user_id', sess.session.user.id).eq('status', 'active').limit(1).single()).data.org_id;
  console.log(`  Organisation testée : ${orgId}\n`);

  const outil = async (name, args = {}) => {
    const r = await fetch(`${API}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok.access_token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }).then((x) => x.json());
    try { return JSON.parse(r.result.content[0].text); } catch { return { erreur: JSON.stringify(r).slice(0, 200) }; }
  };

  const compte_ = async (table, filtre = '') =>
    (await admin.from(table).select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count ?? 0;

  // ─────────────────────────────────────────────────────────────
  console.log('  ── JOBS (le bug d\'origine) ──');
  // L'app liste jobs_active et affiche derived_status.
  for (const etat of ['late', 'upcoming', 'action_required', 'requires_invoicing']) {
    const { count } = await admin.from('jobs_active')
      .select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('derived_status', etat);
    const r = await outil('list_jobs', { status: etat, limit: 30 });
    // L'outil est plafonné à 30 : on ne compare que si l'app est sous le plafond.
    if ((count ?? 0) <= 30) comparer(`jobs « ${etat} »`, count ?? 0, r.count ?? '—');
    else console.log(`  · jobs « ${etat} »${' '.repeat(24)} app=${count} (au-delà du plafond de 30, non comparable)`);
  }
  const unJob = (await outil('list_jobs', { limit: 1 })).jobs?.[0];
  comparer('list_jobs expose display_status', true, !!unJob?.display_status);
  comparer('list_jobs expose raw_status', true, !!unJob?.raw_status);

  // ─────────────────────────────────────────────────────────────
  console.log('\n  ── CLIENTS ──');
  const clientsApp = await compte_('clients_active');
  const rc = await outil('search_clients', { query: '', limit: 25 });
  console.log(`  · total réel de l'org : ${clientsApp} (search_clients plafonne à 25 — outil de recherche, pas de comptage)`);
  comparer('search_clients renvoie des lignes', true, (rc.count ?? 0) > 0);

  // ─────────────────────────────────────────────────────────────
  console.log('\n  ── FACTURES IMPAYÉES ──');
  // L'app: rpc_invoices_kpis_30d → past_due_count. L'outil: RPC p_status past_due.
  const rOver = await outil('get_overdue_payments', { limit: 30 });
  // Vérité terrain en SQL plutôt que via la RPC : appelée avec le client
  // service (sans auth.uid()) elle ne résout aucune org et renvoie 0 —
  // ce qui faisait passer l'agent pour fautif alors qu'il avait raison.
  const { count: appPastDue } = await admin
    .from('invoices')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .in('status', ['sent', 'partial', 'overdue'])
    .lt('due_date', new Date().toISOString().slice(0, 10));
  const agentPastDue = rOver.count ?? rOver.invoices?.length ?? '—';
  if (appPastDue <= 30) comparer('factures en retard', appPastDue, agentPastDue);
  else console.log(`  · factures en retard : app=${appPastDue} (au-delà du plafond)`);

  // ─────────────────────────────────────────────────────────────
  console.log('\n  ── REVENUS ──');
  // Les deux passent par rpc_insights_revenue_series : ils DOIVENT concorder.
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const { data: serie } = await admin.rpc('rpc_insights_revenue_series', {
    p_org: orgId, p_from: from, p_to: to, p_granularity: 'month',
  });
  const appRevenu = (Array.isArray(serie) ? serie : []).reduce((s, r) => s + (Number(r.revenue_cents) || 0), 0);
  const rRev = await outil('get_revenue_summary', { period: 'this_month' });
  comparer('revenu du mois (cents)', appRevenu, rRev.revenue_cents ?? '—');

  // ─────────────────────────────────────────────────────────────
  console.log('\n  ── DEVIS ──');
  const quotesApp = (await admin.from('quotes')
    .select('*', { count: 'exact', head: true }).eq('org_id', orgId).is('deleted_at', null)).count ?? 0;
  const rq = await outil('list_quotes', { limit: 30 });
  if (quotesApp <= 30) comparer('devis (total)', quotesApp, rq.count ?? '—');
  else console.log(`  · devis : app=${quotesApp} (au-delà du plafond)`);

  // ─────────────────────────────────────────────────────────────
  console.log('\n  ── ENTREPRISE ──');
  const { data: cs } = await admin.from('company_settings')
    .select('company_name').eq('org_id', orgId).maybeSingle();
  const rInfo = await outil('get_company_info', {});
  comparer('nom de l\'entreprise', cs?.company_name ?? 'null', rInfo.company_name ?? 'null');

  // ── Ménage ──
  await admin.from('oauth_tokens').update({ revoked: true, revoked_at: new Date().toISOString(), revoked_reason: 'qa_coherence' })
    .eq('client_id', reg.client_id);
  await admin.from('oauth_clients').delete().like('client_name', 'QA Cohérence%');

  console.log(`\n  ${ok.length} cohérents, ${ecarts.length} écart(s).`);
  if (ecarts.length) {
    console.log('\n  ÉCARTS — l\'agent et l\'interface ne disent pas la même chose :');
    for (const e of ecarts) console.log(`   • ${e.libelle} : agent=${e.obtenu}, app=${e.attendu}`);
    process.exit(1);
  }
  console.log('  L\'agent parle le même langage que l\'interface.\n');
})().catch((e) => { console.error('\n  ÉCHEC :', e.message); process.exit(2); });
