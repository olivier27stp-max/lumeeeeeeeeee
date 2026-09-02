#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   VÉRIFICATION — écran de consentement OAuth (navigateur)

   Vérifie ce qui nous appartient : l'écran s'affiche seul (sans le
   chrome de l'application), dit la vérité sur ce qui est accordé, et
   le clic « Autoriser » produit une redirection conforme.

   On n'ATTEND PAS l'atterrissage sur claude.ai : ce domaine est réel
   et rejette un flux de test qu'il n'a pas initié. On intercepte donc
   la redirection au moment où elle part.

   Usage : node --env-file=.env.local scripts/qa/verifier-consentement.mjs
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const API = (process.env.QA_API_URL || 'http://localhost:3002').replace(/\/$/, '');
const BASE = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const ok = [], ko = [];
const R = (cond, libelle, detail = '') => {
  if (cond) { ok.push(libelle); console.log(`  ✓ ${libelle}`); }
  else { ko.push(libelle + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`); }
};

(async () => {
  await admin.from('oauth_clients').delete().like('client_name', 'QA Consent%');

  const reg = await fetch(`${API}/api/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'QA Consent — Claude', redirect_uris: [REDIRECT] }),
  }).then((r) => r.json());

  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const url = `${BASE}/oauth/consent?client_id=${encodeURIComponent(reg.client_id)}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}`
    + `&scope=mcp:read&resource=${encodeURIComponent(BASE + '/api/mcp')}&state=xyz`;

  const { data: lien } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
  const { data: sess } = await anon.auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });
  const s = sess.session;
  const { data: m } = await admin.from('memberships')
    .select('org_id').eq('user_id', s.user.id).eq('status', 'active').limit(1).single();

  const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await nav.newPage();
  await page.setViewport({ width: 1200, height: 900 });

  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e.message)));

  // On coupe la navigation vers claude.ai et on garde l'URL demandée :
  // c'est elle qui porte le code, le state et l'iss.
  let redirection = null;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.isNavigationRequest() && req.url().startsWith('https://claude.ai/')) {
      redirection = req.url();
      return req.abort();
    }
    req.continue();
  });

  await page.evaluateOnNewDocument((t, org) => {
    localStorage.setItem('lume-auth-token', JSON.stringify(t));
    localStorage.setItem('lume-active-org', org);
    localStorage.setItem('lume-language', 'fr');
  }, {
    access_token: s.access_token, refresh_token: s.refresh_token,
    expires_at: s.expires_at, expires_in: s.expires_in,
    token_type: 'bearer', user: s.user,
  }, m.org_id);

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 1800));

  const txt = await page.evaluate(() => document.body.innerText);
  R(/Autoriser l.accès/i.test(txt), 'Écran de consentement affiché');
  R(new RegExp('QA Consent').test(txt), 'Nom de l\'application affiché');
  R(/lecture seule/i.test(txt), 'Mention « lecture seule » présente');
  R(!/Accueil|Calendrier|Feuilles de temps/.test(txt), 'Écran autonome (sans barre latérale)');
  R(!/Votre vie privée|Tout accepter/.test(txt), 'Aucun bandeau témoins par-dessus');
  R(/Refuser/.test(txt) && /Autoriser/.test(txt), 'Boutons Autoriser / Refuser présents');

  await page.screenshot({ path: 'qa-consent.png', fullPage: true });

  const btn = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find((b) => /^\s*Autoriser\s*$/i.test(b.textContent || '')));
  await btn.asElement().click();
  await new Promise((r) => setTimeout(r, 2500));

  R(!!redirection, 'Le clic « Autoriser » déclenche la redirection');
  if (redirection) {
    const u = new URL(redirection);
    R(u.origin + u.pathname === REDIRECT, 'Redirection vers l\'URI enregistrée', u.origin + u.pathname);
    R(!!u.searchParams.get('code'), 'Un code d\'autorisation est transmis');
    R(u.searchParams.get('state') === 'xyz', 'Le paramètre state est conservé');
    R(!!u.searchParams.get('iss'), 'Le paramètre iss est présent (RFC 9207)');

    // Le code doit réellement s'échanger contre un jeton.
    const tok = await fetch(`${API}/api/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code', code: u.searchParams.get('code'),
        client_id: reg.client_id, redirect_uri: REDIRECT,
        code_verifier: verifier, resource: `${BASE}/api/mcp`,
      }),
    }).then((r) => r.json());
    R(!!tok.access_token, 'Le code obtenu s\'échange contre un jeton');
  }

  // La navigation vers claude.ai est volontairement abortée : le contexte
  // mort de cette page lève une SecurityError sur localStorage, qui vient de
  // l'interception du test et non de l'application. On l'écarte.
  const gravesJs = erreurs.filter((e) => !/favicon/i.test(e) && !/localStorage.*Access/i.test(e));
  R(gravesJs.length === 0, 'Aucune erreur JS', gravesJs[0]?.slice(0, 80) || '');

  await nav.close();
  await admin.from('oauth_clients').delete().like('client_name', 'QA Consent%');

  console.log(`\n  ${ok.length} vérifications passées, ${ko.length} échec(s).`);
  console.log('  Capture : qa-consent.png');
  if (ko.length) { console.log('\n  À corriger :'); for (const k of ko) console.log(`   • ${k}`); process.exit(1); }
  console.log('  Écran de consentement conforme.\n');
})().catch((e) => { console.error('\n  ÉCHEC :', e.message); process.exit(2); });
