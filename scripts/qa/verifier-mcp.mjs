#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   VÉRIFICATION — page Réglages › API & MCP

   Ce que ça fait, pour de vrai : ouvre la page dans un navigateur,
   crée une clé via l'interface, vérifie que la clé brute s'affiche
   une seule fois, que la liste se met à jour, puis révoque.

   Une page qui « charge sans erreur » ne prouve rien : le seul
   test qui compte, c'est le parcours complet de l'utilisateur.

   Usage : node --env-file=.env.local scripts/qa/verifier-mcp.mjs
   ═══════════════════════════════════════════════════════════════ */

import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const BASE = (process.env.QA_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';
const URL_SB = process.env.VITE_SUPABASE_URL;
const CLE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLE_ANON = process.env.VITE_SUPABASE_ANON_KEY;

if (!URL_SB || !CLE_SERVICE || !CLE_ANON) {
  console.error('Variables Supabase manquantes — lancer avec --env-file=.env.local');
  process.exit(2);
}

const admin = createClient(URL_SB, CLE_SERVICE, { auth: { persistSession: false } });
const NOM_CLE = 'QA MCP — auto';

async function ouvrirSession() {
  const { data: lien, error: e1 } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
  if (e1) throw new Error(`lien magique refusé : ${e1.message}`);
  const anon = createClient(URL_SB, CLE_ANON, { auth: { persistSession: false } });
  const { data: sess, error: e2 } = await anon.auth.verifyOtp({
    token_hash: lien.properties.hashed_token,
    type: 'magiclink',
  });
  if (e2) throw new Error(`session refusée : ${e2.message}`);
  return sess.session;
}

const anomalies = [];
const ok = [];

function verifier(condition, libelle, detail = '') {
  if (condition) { ok.push(libelle); console.log(`  ✓ ${libelle}`); }
  else { anomalies.push(libelle + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`); }
}

(async () => {
  console.log(`\n  Cible : ${BASE}/settings/api`);
  console.log('  Ouverture de session…');
  const session = await ouvrirSession();
  const { data: membre } = await admin
    .from('memberships').select('org_id, role')
    .eq('user_id', session.user.id).eq('status', 'active').limit(1).maybeSingle();
  if (!membre) throw new Error(`aucune organisation active pour ${COMPTE}`);
  console.log(`  Organisation : ${membre.org_id} (rôle : ${membre.role})\n`);

  // Nettoyage préalable — un run précédent a pu laisser des clés.
  await admin.from('api_keys').delete().eq('org_id', membre.org_id).like('name', `${NOM_CLE}%`);

  const navigateur = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await navigateur.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const erreursConsole = [];
  page.on('console', (m) => { if (m.type() === 'error') erreursConsole.push(m.text()); });
  page.on('pageerror', (e) => erreursConsole.push(String(e.message || e)));

  const jeton = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: 'bearer',
    user: session.user,
  };
  await page.evaluateOnNewDocument((t, org) => {
    localStorage.setItem('lume-auth-token', JSON.stringify(t));
    localStorage.setItem('lume-active-org', org);
    localStorage.setItem('lume-language', 'fr');
  }, jeton, membre.org_id);

  try {
    // ── 1. La page s'affiche ──
    await page.goto(`${BASE}/settings/api`, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 1500));

    // Le bandeau témoins recouvre le bas de page et intercepte les clics.
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Tout accepter|Accept all/i.test(x.textContent || ''));
      if (b) b.click();
    });
    await new Promise((r) => setTimeout(r, 600));

    const texte = await page.evaluate(() => document.body.innerText);
    verifier(/API\s*&\s*MCP/i.test(texte), 'La page s\'affiche (titre présent)');
    verifier(!/Accès refusé|Access denied|404/i.test(texte), 'Pas de mur de permission', texte.slice(0, 80));
    verifier(/Clés d.accès|Access keys/i.test(texte), 'Section « Clés d\'accès » présente');

    // ── 2. Le bloc de connexion MCP ──
    const aConnexion = /claude mcp add/i.test(texte);
    verifier(aConnexion, 'Commande de connexion affichée',
      aConnexion ? '' : 'bloc absent — PUBLIC_BASE_URL/FRONTEND_URL non défini ?');

    // ── 3. Créer une clé via l'interface ──
    const boutonNouvelle = await page.evaluateHandle(() =>
      [...document.querySelectorAll('button')].find((b) => /Nouvelle clé|New key/i.test(b.textContent || '')));
    const aBouton = await boutonNouvelle.evaluate?.((el) => !!el).catch(() => false);
    verifier(aBouton, 'Bouton « Nouvelle clé » présent');

    if (aBouton) {
      await boutonNouvelle.asElement().click();
      await new Promise((r) => setTimeout(r, 400));
      // Cibler le champ du formulaire par son placeholder exact : `input[placeholder]`
      // attrapait la barre de recherche globale de l'en-tête, et la clé n'était
      // jamais nommée (le formulaire refusait alors la création, à raison).
      const champ = await page.evaluateHandle(() =>
        [...document.querySelectorAll('input')].find((i) => /Claude — portable|Claude — laptop/i.test(i.placeholder || '')));
      const aChamp = await champ.evaluate((el) => !!el).catch(() => false);
      verifier(aChamp, 'Champ « Nom de la clé » présent');
      await champ.asElement().click();
      await champ.asElement().type(NOM_CLE);
      const boutonCreer = await page.evaluateHandle(() =>
        [...document.querySelectorAll('button')].find((b) => /^\s*(Créer|Create)\s*$/i.test(b.textContent || '')));
      await boutonCreer.asElement().click();
      await new Promise((r) => setTimeout(r, 2500));

      const apres = await page.evaluate(() => document.body.innerText);
      const cleAffichee = /lk_live_[A-Za-z0-9_-]{10,}/.exec(apres);
      verifier(!!cleAffichee, 'La clé brute s\'affiche une fois');
      verifier(/Copiez cette clé maintenant|Copy this key now/i.test(apres), 'Avertissement « copiez maintenant » présent');
      verifier(new RegExp(NOM_CLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(apres), 'La clé apparaît dans la liste');

      // ── 4. La clé existe vraiment en base, avec le bon scope ──
      const { data: enBase } = await admin
        .from('api_keys').select('id, name, scopes, org_id, revoked')
        .eq('org_id', membre.org_id).like('name', `${NOM_CLE}%`).maybeSingle();
      verifier(!!enBase, 'La clé est enregistrée en base');
      verifier(enBase?.scopes?.includes('mcp'), 'Scope « mcp » appliqué', JSON.stringify(enBase?.scopes));

      // ── 5. La clé créée par l'UI fonctionne réellement en MCP ──
      if (cleAffichee) {
        const rep = await fetch(`${BASE.replace(/:5173$/, ':3002')}/api/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': cleAffichee[0] },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
        verifier(Array.isArray(rep?.result?.tools) && rep.result.tools.length > 0,
          'La clé de l\'UI ouvre bien la session MCP',
          rep?.result ? `${rep.result.tools.length} outils` : JSON.stringify(rep).slice(0, 120));
        verifier(!rep?.result?.tools?.some((t) => /^(create_|send_)/.test(t.name)),
          'Aucun outil d\'écriture exposé');
      }
    }

    // ── 6. Erreurs console ──
    const graves = erreursConsole.filter((e) => !/favicon|sourcemap|DevTools/i.test(e));
    verifier(graves.length === 0, 'Aucune erreur console', graves.slice(0, 2).join(' | ').slice(0, 160));

    await page.screenshot({ path: 'qa-mcp.png', fullPage: true });
    console.log('\n  Capture : qa-mcp.png');
  } finally {
    await admin.from('api_keys').delete().eq('org_id', membre.org_id).like('name', `${NOM_CLE}%`);
    await navigateur.close();
  }

  console.log(`\n  ${ok.length} vérifications passées, ${anomalies.length} anomalie(s).`);
  if (anomalies.length) {
    console.log('\n  À corriger :');
    for (const a of anomalies) console.log(`   • ${a}`);
    process.exit(1);
  }
  console.log('  Page conforme.\n');
})().catch((e) => { console.error('\n  ÉCHEC :', e.message); process.exit(2); });
