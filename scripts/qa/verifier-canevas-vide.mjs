/**
 * LE CANEVAS VIDE — chaque bouton cliqué, un par un.
 *
 * Signalé par Rafba le 2026-09-25 : sur une automatisation neuve,
 * « Choisir le déclencheur » et « Ajouter une première étape » ne mènent
 * nulle part, et le tiroir des ÉTAPES s'ouvre sur « Communication » alors
 * qu'on vient de demander un DÉCLENCHEUR. Rien n'échoue, rien ne
 * s'affiche : le pire genre de bogue.
 *
 * Ce script ne raisonne pas sur le code. Il clique, et il regarde ce qui
 * s'ouvre — puis il choisit une entrée et vérifie que la règle a VRAIMENT
 * changé en base. Un tiroir qui s'ouvre sans rien enregistrer serait tout
 * aussi cassé.
 *
 *   node --env-file=.env.local scripts/qa/verifier-canevas-vide.mjs
 */

import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.QA_BASE || 'http://localhost:5199';
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';
const URL_SB = process.env.VITE_SUPABASE_URL;
const CLE_ANON = process.env.VITE_SUPABASE_ANON_KEY;
const CLE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_SB || !CLE_ANON || !CLE_SERVICE) {
  console.error('Variables manquantes : VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const admin = createClient(URL_SB, CLE_SERVICE, { auth: { persistSession: false } });

const ok = [];
const ko = [];
const dire = (bon, quoi, detail = '') => {
  (bon ? ok : ko).push(quoi);
  console.log(`  ${bon ? '✓' : '✗'} ${quoi}${detail ? ` — ${detail}` : ''}`);
};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function ouvrirSession() {
  const { data: lien, error: e1 } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
  if (e1) throw new Error(`lien magique refusé : ${e1.message}`);
  const anon = createClient(URL_SB, CLE_ANON, { auth: { persistSession: false } });
  const { data: sess, error: e2 } = await anon.auth.verifyOtp({
    token_hash: lien.properties.hashed_token, type: 'magiclink',
  });
  if (e2) throw new Error(`session refusée : ${e2.message}`);
  return sess.session;
}

async function degagerLaVue(page) {
  const REFUS = ['Tout refuser', 'Refuser', 'Reject all', 'Decline'];
  for (let i = 0; i < 6; i++) {
    const n = await page.evaluate((mots) => {
      let k = 0;
      for (const b of Array.from(document.querySelectorAll('button'))) {
        if (mots.includes((b.textContent || '').trim())) { b.click(); k++; }
      }
      return k;
    }, REFUS).catch(() => 0);
    if (n) { await attendre(800); return n; }
    await attendre(400);
  }
  return 0;
}

/** Un VRAI clic : `el.click()` dans `evaluate` ne déclenche pas React. */
async function cliquerTexte(page, mot) {
  for (const b of await page.$$('button')) {
    const t = await b.evaluate((e) => (e.textContent || '').trim());
    if (t.includes(mot)) { await b.click(); return true; }
  }
  return false;
}

/** Ce qui est ouvert à droite : titre du tiroir + ses familles. */
const tiroirOuvert = (page) => page.evaluate(() => {
  const a = Array.from(document.querySelectorAll('aside'))
    .find((x) => (x.getAttribute('aria-label') || '') !== '' || x.querySelector('input[type="search"], input'));
  if (!a) return null;
  const txt = a.innerText || '';
  return {
    label: a.getAttribute('aria-label') || '',
    titre: txt.split('\n').slice(0, 3).join(' | '),
    entrees: Array.from(a.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 40),
  };
});

async function main() {
  console.log('\n═══ Canevas vide : chaque bouton, un par un ═══\n');

  const session = await ouvrirSession();
  const { data: membre } = await admin
    .from('memberships').select('org_id').eq('user_id', session.user.id)
    .eq('status', 'active').limit(1).maybeSingle();
  if (!membre) throw new Error(`aucune organisation active pour ${COMPTE}`);

  // Une règle NEUVE : c'est l'état exact où Rafba voit le bogue.
  const { data: regle, error: eRegle } = await admin.from('automation_rules').insert({
    org_id: membre.org_id,
    name: `QA — canevas vide ${Date.now()}`,
    trigger_event: 'quote.sent',
    delay_seconds: 0,
    is_active: false,
    actions: [{ type: 'send_sms', config: { body: 'x' } }],
    steps: [],
  }).select('id').single();
  if (eRegle) throw new Error(`création de la règle : ${eRegle.message}`);

  const navigateur = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await navigateur.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e).slice(0, 160)));
    await page.evaluateOnNewDocument((s) => {
      localStorage.setItem('lume-auth-token', JSON.stringify(s));
      localStorage.setItem('lume-language', 'fr');
    }, session);

    await page.goto(`${BASE}/automations/${regle.id}`, { waitUntil: 'networkidle2', timeout: 60_000 });
    await degagerLaVue(page);
    await page.waitForFunction(
      () => !document.body.innerText.includes('Chargement de l’espace'),
      { timeout: 60_000 },
    );
    await attendre(2500);

    // ── 1. « Choisir le déclencheur » ────────────────────────────────
    const aDecl = await cliquerTexte(page, 'Choisir le déclencheur');
    dire(aDecl, '« Choisir le déclencheur » existe et se clique');
    await attendre(1500);

    let t = await tiroirOuvert(page);
    dire(!!t, 'un tiroir s’ouvre', t ? '' : 'RIEN ne s’ouvre — c’est le bogue signalé');

    if (t) {
      const familles = t.entrees.join(' | ');
      // Le tiroir des DÉCLENCHEURS doit parler de devis/factures, pas de
      // « Communication » (qui est une famille d'ACTIONS).
      const bonTiroir = /Soumission|Facture|Rendez-vous|Devis/i.test(familles);
      dire(bonTiroir, 'c’est bien le tiroir des DÉCLENCHEURS',
        bonTiroir ? '' : `familles vues : ${familles.slice(0, 120)}`);
      dire(!/Communication/i.test(familles),
        'il ne montre PAS les familles d’actions (Communication…)',
        /Communication/i.test(familles) ? 'le mauvais tiroir s’est ouvert' : '');

      // ── 2. Choisir « Soumission envoyée » change-t-il la règle ? ────
      const avant = (await admin.from('automation_rules').select('trigger_event').eq('id', regle.id).maybeSingle()).data?.trigger_event;
      const aChoisi = await cliquerTexte(page, 'Facture payée')
        || await cliquerTexte(page, 'Soumission acceptée');
      dire(aChoisi, 'une entrée du tiroir se clique');
      await attendre(2500);
      const apres = (await admin.from('automation_rules').select('trigger_event').eq('id', regle.id).maybeSingle()).data?.trigger_event;
      dire(apres !== avant, 'le déclencheur CHANGE VRAIMENT en base',
        `${avant} → ${apres}`);
    }

    // ── 3. « Ajouter une première étape » ────────────────────────────
    await page.reload({ waitUntil: 'networkidle2', timeout: 60_000 });
    await degagerLaVue(page);
    await attendre(2500);

    const aEtape = await cliquerTexte(page, 'Ajouter une première étape');
    dire(aEtape, '« Ajouter une première étape » existe et se clique');
    await attendre(1500);

    t = await tiroirOuvert(page);
    dire(!!t, 'le tiroir des ÉTAPES s’ouvre', t ? '' : 'RIEN ne s’ouvre');
    if (t) {
      const familles = t.entrees.join(' | ');
      // Le tiroir liste les ACTIONS elles-mêmes (le nom de famille sert
      // d'en-tête de section, pas d'entrée cliquable) : on vérifie donc
      // qu'on y trouve de vraies actions, pas un libellé de famille.
      dire(/Envoyer un courriel|Envoyer un texto/i.test(familles),
        'il montre bien les ACTIONS', familles.slice(0, 90));

      // ── 4. Choisir « Envoyer un courriel » ajoute-t-il une étape ? ──
      const aAction = await cliquerTexte(page, 'Envoyer un courriel');
      dire(aAction, '« Envoyer un courriel » se clique');
      await attendre(2500);

      const { data: apres } = await admin
        .from('automation_rules').select('steps').eq('id', regle.id).maybeSingle();
      const n = Array.isArray(apres?.steps) ? apres.steps.length : 0;
      dire(n > 0, 'l’étape est VRAIMENT ajoutée au parcours', `${n} étape(s) en base`);

      // Et le panneau d'édition s'ouvre sur cette étape.
      const panneau = await page.evaluate(() =>
        Array.from(document.querySelectorAll('aside'))
          .some((a) => /Modifier l’action|Modifier l'action/.test(a.innerText || '')));
      dire(panneau, 'le panneau d’édition s’ouvre sur la nouvelle étape');
    }

    // ── 5. Le champ IA reste là APRÈS l'ajout d'une étape ───────────
    /*
     * Signalé le 2026-09-25 : « je mets une étape, l'IA n'est plus là ».
     * Chez GoHighLevel le champ reste en permanence — et c'est justement
     * quand un parcours existe qu'on veut dire « ajoute une relance ».
     */
    const iaApres = await page.evaluate(() =>
      /Décris ton automatisation/i.test(document.body.innerText));
    dire(iaApres, 'le champ « Décris ton automatisation » reste APRÈS une étape',
      iaApres ? '' : 'il disparaît — c’est le bogue signalé');

    dire(erreurs.length === 0, 'aucune erreur JavaScript', erreurs.join(' // ').slice(0, 200));
  } finally {
    await navigateur.close();
    await admin.from('automation_rules').delete().eq('id', regle.id);
    console.log('\n  Règle de test supprimée.');
  }

  console.log(`\n═══ ${ok.length} réussi(s), ${ko.length} échec(s) ═══\n`);
  if (ko.length) { for (const k of ko) console.log(`  · ${k}`); process.exit(1); }
}

main().catch((e) => { console.error('\n✗', e.message); process.exit(1); });
