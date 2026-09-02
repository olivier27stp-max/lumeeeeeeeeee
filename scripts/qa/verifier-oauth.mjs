#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   VÉRIFICATION — serveur d'autorisation OAuth 2.1

   Un serveur d'autorisation ne se teste pas sur son chemin heureux.
   Ce script joue le parcours complet PUIS les abus : PKCE truqué,
   code rejoué, mauvaise audience, redirection non enregistrée, vol
   de jeton de rafraîchissement, isolation entre deux utilisateurs.

   Usage : node --env-file=.env.local scripts/qa/verifier-oauth.mjs
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const API = (process.env.QA_API_URL || 'http://localhost:3002').replace(/\/$/, '');
const BASE = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const RESOURCE = `${BASE}/api/mcp`;
const URL_SB = process.env.VITE_SUPABASE_URL;
const CLE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLE_ANON = process.env.VITE_SUPABASE_ANON_KEY;

const admin = createClient(URL_SB, CLE_SERVICE, { auth: { persistSession: false } });

const ok = [], ko = [];
function verifier(cond, libelle, detail = '') {
  if (cond) { ok.push(libelle); console.log(`  ✓ ${libelle}`); }
  else { ko.push(libelle + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`); }
}

const pkce = () => {
  const verifier_ = crypto.randomBytes(48).toString('base64url');
  return { verifier: verifier_, challenge: crypto.createHash('sha256').update(verifier_).digest('base64url') };
};

async function sessionPour(email) {
  const { data: lien, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`lien refusé pour ${email} : ${error.message}`);
  const anon = createClient(URL_SB, CLE_ANON, { auth: { persistSession: false } });
  const { data, error: e2 } = await anon.auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });
  if (e2) throw new Error(`session refusée : ${e2.message}`);
  return data.session;
}

/** Parcours complet, du consentement au jeton. */
async function parcours(session, clientId, redirectUri, opts = {}) {
  const { verifier: v, challenge } = opts.pkce || pkce();
  const consent = await fetch(`${API}/api/oauth/consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({
      client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge,
      scope: 'mcp:read', resource: opts.resource || RESOURCE,
      // Comme le fait l'écran de consentement : c'est cette session qui donne
      // une identité au serveur, sans laquelle tous les outils à RPC échouent.
      supabase_refresh_token: session.refresh_token,
    }),
  });
  const cj = await consent.json().catch(() => ({}));
  if (!consent.ok) return { erreur: cj, etape: 'consent' };
  const code = new URL(cj.redirect_to).searchParams.get('code');

  const token = await fetch(`${API}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code', code, client_id: clientId,
      redirect_uri: redirectUri, code_verifier: opts.mauvaisVerifier || v,
      resource: opts.resource || RESOURCE,
    }),
  });
  const tj = await token.json().catch(() => ({}));
  return { code, tokens: tj, statut: token.status, verifier: v, redirectUri, clientId };
}

(async () => {
  console.log(`\n  API      : ${API}`);
  console.log(`  Ressource: ${RESOURCE}\n`);

  // Nettoyage d'un éventuel run précédent
  await admin.from('oauth_clients').delete().like('client_name', 'QA OAuth%');

  // ── Enregistrement dynamique ──
  const reg = await fetch(`${API}/api/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'QA OAuth Test', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }),
  });
  const client = await reg.json();
  verifier(reg.status === 201 && !!client.client_id, 'Enregistrement dynamique du client');
  const CID = client.client_id;
  const RURI = 'https://claude.ai/api/mcp/auth_callback';

  // URI non https refusée
  const regBad = await fetch(`${API}/api/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'QA OAuth Bad', redirect_uris: ['http://evil.test/cb'] }),
  });
  verifier(regBad.status === 400, 'URI de redirection non-https refusée');

  // ── Sessions de deux utilisateurs d'orgs différentes ──
  const { data: membres } = await admin
    .from('memberships').select('user_id, org_id').eq('status', 'active').limit(200);
  // Un membre par org, et seulement ceux qui ont une adresse courriel :
  // le lien magique en exige une, et staging contient des comptes sans.
  const parOrg = new Map();
  for (const m of membres || []) {
    if (parOrg.has(m.org_id)) continue;
    const { data } = await admin.auth.admin.getUserById(m.user_id);
    const email = data?.user?.email;
    if (email) parOrg.set(m.org_id, { userId: m.user_id, email });
    if (parOrg.size >= 2) break;
  }
  const deuxOrgs = [...parOrg.entries()].slice(0, 2);
  if (deuxOrgs.length < 2) { console.error('  Il faut 2 orgs avec un membre actif ayant un courriel.'); process.exit(2); }

  const emails = deuxOrgs.map(([, v]) => v.email);
  const sA = await sessionPour(emails[0]);
  const sB = await sessionPour(emails[1]);
  console.log(`  Utilisateur A : ${emails[0]}`);
  console.log(`  Utilisateur B : ${emails[1]}\n`);

  // ── Parcours nominal ──
  const rA = await parcours(sA, CID, RURI);
  verifier(rA.statut === 200 && !!rA.tokens.access_token, 'Parcours complet : code → jeton', JSON.stringify(rA.tokens).slice(0, 120));
  const jetonA = rA.tokens.access_token;

  // ── Le jeton ouvre bien MCP, et l'audit porte un user_id ──
  const appel = await fetch(`${API}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jetonA}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
  verifier(Array.isArray(appel?.result?.tools) && appel.result.tools.length > 0,
    'Le jeton OAuth ouvre la session MCP', appel?.result ? `${appel.result.tools.length} outils` : JSON.stringify(appel).slice(0, 120));
  verifier(!appel?.result?.tools?.some((t) => /^(create_|send_)/.test(t.name)), 'Aucun outil d\'écriture exposé');

  // ── La session Supabase est-elle réellement STOCKÉE ? ──
  // Sans elle, le serveur interroge la base sans identité et TOUS les outils
  // passant par une RPC (revenus, factures) échouent — silencieusement, car
  // le chiffrement échouait dans un catch. En production, PAYMENTS_ENCRYPTION_KEY
  // n'était pas définie : l'autorisation semblait réussir et la moitié des
  // outils restaient muets. Ce test-là ferme cette porte.
  const { data: ligneJeton } = await admin
    .from('oauth_tokens')
    .select('supabase_refresh_token_chiffre')
    .eq('client_id', CID)
    .not('supabase_refresh_token_chiffre', 'is', null)
    .limit(1)
    .maybeSingle();
  verifier(!!ligneJeton?.supabase_refresh_token_chiffre,
    'La session Supabase est stockée avec le jeton',
    'sans elle, revenus et factures restent muets');

  // Et elle doit permettre d'appeler une RPC qui vérifie auth.uid().
  const revenus = await fetch(`${API}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jetonA}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: { name: 'get_revenue_summary', arguments: { period: 'this_month' } } }),
  }).then((r) => r.json());
  let revJson = {};
  try { revJson = JSON.parse(revenus.result.content[0].text); } catch { /* laissé vide */ }
  verifier(!revJson.error && typeof revJson.revenue_cents === 'number',
    'get_revenue_summary répond (RPC + identité)',
    revJson.error ? 'RPC refusée : identité absente' : '');

  // ── ISOLATION : le jeton de A ne voit que l'org de A ──
  const rB = await parcours(sB, CID, RURI);
  const jetonB = rB.tokens.access_token;
  const lire = async (jeton, outil) => {
    const r = await fetch(`${API}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: outil, arguments: { limit: 5 } } }),
    }).then((x) => x.json());
    try { return JSON.parse(r.result.content[0].text); } catch { return null; }
  };
  const cA = await lire(jetonA, 'search_clients');
  const cB = await lire(jetonB, 'search_clients');
  const idsA = new Set((cA?.clients || []).map((c) => c.id));
  const idsB = new Set((cB?.clients || []).map((c) => c.id));
  const croisement = [...idsA].filter((id) => idsB.has(id));
  verifier(croisement.length === 0, 'Isolation entre deux utilisateurs/orgs',
    croisement.length ? `⚠ ${croisement.length} client(s) partagé(s)` : `A:${idsA.size} B:${idsB.size}`);

  // ── ATTAQUE : PKCE truqué ──
  const faux = await parcours(sA, CID, RURI, { mauvaisVerifier: crypto.randomBytes(48).toString('base64url') });
  verifier(faux.statut === 400 && faux.tokens?.error === 'invalid_grant', 'PKCE invalide refusé', JSON.stringify(faux.tokens).slice(0, 100));

  // ── ATTAQUE : code rejoué ──
  const rejeu = await fetch(`${API}/api/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code', code: rA.code, client_id: CID,
      redirect_uri: RURI, code_verifier: rA.verifier, resource: RESOURCE,
    }),
  });
  const rejeuJson = await rejeu.json().catch(() => ({}));
  verifier(rejeu.status === 400, 'Code d\'autorisation rejoué refusé', JSON.stringify(rejeuJson).slice(0, 100));

  // ── ATTAQUE : mauvaise audience (RFC 8707) ──
  const audience = await parcours(sA, CID, RURI, { resource: 'https://autre-service.test/mcp' });
  verifier(audience.etape === 'consent' || audience.statut !== 200, 'Ressource (audience) étrangère refusée');

  // ── ATTAQUE : redirection non enregistrée ──
  const redir = await fetch(`${API}/api/oauth/consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sA.access_token}` },
    body: JSON.stringify({ client_id: CID, redirect_uri: 'https://evil.test/steal', code_challenge: pkce().challenge, scope: 'mcp:read', resource: RESOURCE }),
  });
  verifier(redir.status === 400, 'Redirection non enregistrée refusée');

  // ── ATTAQUE : jeton d'un autre service présenté à Lume ──
  const bidon = await fetch(`${API}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jeton-totalement-invente' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
  });
  verifier(bidon.status === 401, 'Jeton inventé refusé (401)');

  // ── Rotation du rafraîchissement + détection de réutilisation ──
  const refresh1 = await fetch(`${API}/api/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: rA.tokens.refresh_token, client_id: CID, resource: RESOURCE }),
  }).then((r) => r.json());
  verifier(!!refresh1.access_token, 'Rafraîchissement : nouveau jeton émis');

  const refresh2 = await fetch(`${API}/api/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: rA.tokens.refresh_token, client_id: CID, resource: RESOURCE }),
  });
  verifier(refresh2.status === 400, 'Réutilisation du jeton de rafraîchissement refusée');

  // La famille entière doit être révoquée après la réutilisation
  const apresVol = await fetch(`${API}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${refresh1.access_token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/list' }),
  });
  verifier(apresVol.status === 401, 'Vol détecté → toute la famille révoquée');

  // ── Révocation explicite ──
  const revoke = await fetch(`${API}/api/oauth/revoke`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: jetonB }),
  });
  verifier(revoke.status === 200, 'Révocation accepte la requête');
  const apresRevoc = await fetch(`${API}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jetonB}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/list' }),
  });
  verifier(apresRevoc.status === 401, 'Jeton révoqué refusé immédiatement');

  // ── form-urlencoded sur /token (ce que Claude envoie réellement) ──
  // La spec OAuth impose ce Content-Type. Le garde CSRF global le rejetait en
  // 403 : toutes les connexions échouaient juste après « Autoriser », sans
  // laisser de trace en base (le code n'était jamais consommé). Ce test-là
  // aurait attrapé le bug — l'ancienne suite ne testait qu'en JSON.
  const pk = pkce();
  const consentForm = await fetch(`${API}/api/oauth/consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sA.access_token}` },
    body: JSON.stringify({
      client_id: CID, redirect_uri: RURI, code_challenge: pk.challenge,
      scope: 'mcp:read', resource: RESOURCE,
    }),
  }).then((r) => r.json());
  const codeForm = new URL(consentForm.redirect_to).searchParams.get('code');

  const formResp = await fetch(`${API}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: codeForm, client_id: CID,
      redirect_uri: RURI, code_verifier: pk.verifier, resource: RESOURCE,
    }).toString(),
  });
  const formJson = await formResp.json().catch(() => ({}));
  verifier(formResp.status !== 403, 'Le garde CSRF ne bloque pas /oauth/token',
    formResp.status === 403 ? '403 — Claude ne pourra jamais échanger son code' : '');
  verifier(!!formJson.access_token, 'Échange en form-urlencoded (comme Claude)',
    JSON.stringify(formJson).slice(0, 110));

  // ── La clé d'API doit continuer de fonctionner (non-régression) ──
  const { data: m0 } = await admin.from('memberships').select('user_id, org_id').eq('status', 'active').limit(1).single();
  const raw = 'lk_live_' + crypto.randomBytes(24).toString('base64url');
  await admin.from('api_keys').insert({
    org_id: m0.org_id, created_by: m0.user_id, name: 'QA OAuth — clé compat',
    key_hash: crypto.createHash('sha256').update(raw).digest('hex'),
    key_prefix: raw.slice(0, 12) + '...', scopes: ['mcp'],
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  });
  const compat = await fetch(`${API}/api/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': raw },
    body: JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'tools/list' }),
  }).then((r) => r.json());
  verifier(Array.isArray(compat?.result?.tools), 'La clé d\'API fonctionne toujours (non-régression)');

  // ── Ménage ──
  await admin.from('api_keys').delete().like('name', 'QA OAuth%');
  await admin.from('oauth_clients').delete().like('client_name', 'QA OAuth%');

  console.log(`\n  ${ok.length} vérifications passées, ${ko.length} échec(s).`);
  if (ko.length) { console.log('\n  À corriger :'); for (const k of ko) console.log(`   • ${k}`); process.exit(1); }
  console.log('  Serveur OAuth conforme.\n');
})().catch((e) => { console.error('\n  ÉCHEC :', e.message); process.exit(2); });
