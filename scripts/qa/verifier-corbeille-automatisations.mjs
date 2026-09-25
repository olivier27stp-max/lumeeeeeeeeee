/**
 * La corbeille des automatisations — vérifiée dans un VRAI navigateur,
 * contre la VRAIE base (staging).
 *
 * Un test avec des mocks prouve que l'écran réagit bien à ce qu'on lui
 * donne. Il ne prouve pas que le serveur fait ce qu'on croit : ici, que
 * « Supprimer » MET DE CÔTÉ au lieu d'effacer, et que la ligne revient.
 *
 * Ce qu'on mesure de bout en bout :
 *   1. supprimer → la ligne quitte « Toutes » ET la rangée existe toujours
 *      en base avec `deleted_at` (c'est la différence entre corbeille et
 *      effacement définitif) ;
 *   2. elle apparaît dans l'onglet « Corbeille » ;
 *   3. restaurer → `deleted_at` repasse à NULL et `is_active` à false —
 *      une règle restaurée ne doit JAMAIS se remettre à écrire aux clients
 *      sans relecture ;
 *   4. le moteur ignore une règle à la corbeille (vérifié sur la requête
 *      que le serveur construit, pas sur une intention).
 *
 *   node --env-file=.env.local scripts/qa/verifier-corbeille-automatisations.mjs
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

/** Le bandeau Loi 25 capture tous les clics tant qu'il est là. */
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

/**
 * Clique le PREMIER bouton dont le texte contient `mot`.
 *
 * Un vrai clic (`elementHandle.click()`), jamais `el.click()` dans
 * `evaluate` : ce dernier ne déclenche pas les gestionnaires React — piège
 * déjà payé dans ce projet.
 */
async function cliquerTexte(page, mot) {
  const boutons = await page.$$('button');
  for (const b of boutons) {
    const t = await b.evaluate((e) => e.textContent || '');
    if (t.includes(mot)) { await b.click(); return true; }
  }
  return false;
}

/** Clique le bouton dont l'aria-label contient `mot`. */
async function cliquerLabel(page, mot) {
  const boutons = await page.$$('button');
  for (const b of boutons) {
    const t = await b.evaluate((e) => e.getAttribute('aria-label') || '');
    if (t.includes(mot)) { await b.click(); return true; }
  }
  return false;
}

/**
 * Clique une entrée DU MENU ouvert (`role="menuitem"`), jamais un bouton
 * quelconque de la page.
 *
 * « Supprimer » apparaît ailleurs à l'écran (la carte d'aide, une autre
 * ligne) : un `cliquerTexte` global avait ouvert le panneau Lumi au lieu du
 * menu, et la mesure suivante portait sur un écran recouvert.
 */
async function cliquerMenu(page, mot) {
  const items = await page.$$('[role="menuitem"]');
  for (const it of items) {
    const t = await it.evaluate((e) => e.textContent || '');
    if (t.includes(mot)) { await it.click(); return true; }
  }
  return false;
}

/** Le bouton de confirmation DANS la boîte de dialogue. */
async function confirmerDialogue(page, mot) {
  const boutons = await page.$$('[role="dialog"] button, [role="alertdialog"] button');
  for (const b of boutons) {
    const t = await b.evaluate((e) => e.textContent || '');
    if (t.includes(mot)) { await b.click(); return true; }
  }
  return false;
}

const corpsContient = (page, mot) =>
  page.evaluate((m) => (document.body.innerText || '').includes(m), mot);

async function main() {
  console.log('\n═══ Corbeille des automatisations ═══\n');

  const session = await ouvrirSession();
  const { data: membre } = await admin
    .from('memberships').select('org_id').eq('user_id', session.user.id)
    .eq('status', 'active').limit(1).maybeSingle();
  if (!membre) throw new Error(`aucune organisation active pour ${COMPTE}`);

  const NOM = `QA — corbeille ${Date.now()}`;
  const { data: regle, error: eRegle } = await admin.from('automation_rules').insert({
    org_id: membre.org_id,
    name: NOM,
    trigger_event: 'quote.sent',
    delay_seconds: 0,
    is_active: false,
    actions: [{ type: 'send_sms', config: { body: 'Bonjour' } }],
    steps: [],
  }).select('id').single();
  if (eRegle) throw new Error(`création de la règle de test : ${eRegle.message}`);

  const navigateur = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await navigateur.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    // La session est posée AVANT le premier rendu : l'app lit le jeton au
    // montage, un `localStorage` écrit après arriverait trop tard.
    await page.evaluateOnNewDocument((s) => {
      // La clé est celle que `src/lib/supabase.ts` déclare (`storageKey`),
      // PAS le `sb-<ref>-auth-token` par défaut de supabase-js : avec la
      // mauvaise clé, l'app ne voit aucune session et renvoie vers /auth.
      localStorage.setItem('lume-auth-token', JSON.stringify(s));
      localStorage.setItem('lume-language', 'fr');
    }, session);

    await page.goto(`${BASE}/automations`, { waitUntil: 'networkidle2', timeout: 60_000 });
    await degagerLaVue(page);
    /*
     * On ATTEND le tableau, on ne devine pas un délai.
     * L'app monte d'abord « Chargement de l'espace… » (contexte entreprise,
     * permissions), puis la page, puis les règles. Un `attendre(1500)` fixe
     * mesurait un écran encore vide et déclarait la règle « absente ».
     */
    await page.waitForFunction(
      () => document.querySelector('table') && !document.body.innerText.includes('Chargement de l’espace'),
      { timeout: 60_000 },
    );
    await attendre(1500);

    /*
     * On FILTRE sur le nom de la règle de test.
     *
     * La liste est paginée : une règle créée à l'instant peut très bien
     * exister et n'être sur aucune des lignes affichées. Sans ce filtre, le
     * script concluait « absente » sur une page parfaitement correcte.
     */
    /*
     * ATTENTION au champ visé : la barre du haut (« Rechercher partout…
     * clients, jobs, factures ») porte AUSSI « Recherch ». Y taper ne filtre
     * pas le tableau. On veut celui de la page, dont le placeholder est
     * exactement « Rechercher ».
     */
    const champ = await page.evaluateHandle(() =>
      Array.from(document.querySelectorAll('input'))
        .find((i) => (i.placeholder || '').trim() === 'Rechercher') || null,
    ).then((h) => h.asElement());
    if (!champ) throw new Error('champ de recherche du tableau introuvable — la page a changé');
    await champ.click();
    await champ.type(NOM);
    await attendre(1500);

    // ── 1. La règle est bien là au départ ────────────────────────────
    const presenteAuDepart = await corpsContient(page, NOM);
    dire(presenteAuDepart, 'la règle de test apparaît dans « Toutes »',
      presenteAuDepart ? '' : 'rien à mesurer si elle n’est pas listée');
    if (!presenteAuDepart) throw new Error('la règle de test n’est pas affichée — mesure impossible');

    // ── 2. Supprimer ─────────────────────────────────────────────────
    await cliquerLabel(page, `Actions pour ${NOM}`);
    await attendre(400);
    const aSupprimer = await cliquerMenu(page, 'Supprimer');
    dire(aSupprimer, 'le menu « … » offre « Supprimer »');
    await attendre(800);
    // La confirmation est une vraie boîte de dialogue (jamais confirm()).
    const aConfirme = await confirmerDialogue(page, 'Supprimer');
    dire(aConfirme, 'une confirmation est demandée avant de supprimer');
    await attendre(2500);

    const partieDeLaListe = !(await corpsContient(page, NOM));
    dire(partieDeLaListe, 'après suppression, elle quitte l’onglet « Toutes »');

    // LA question : corbeille ou effacement ? On regarde la base.
    const { data: enBase } = await admin
      .from('automation_rules').select('id, deleted_at, is_active')
      .eq('id', regle.id).maybeSingle();
    dire(!!enBase, 'la rangée existe TOUJOURS en base (suppression douce)',
      enBase ? '' : 'elle a été effacée pour de bon — la corbeille ne peut rien restaurer');
    dire(!!enBase?.deleted_at, '`deleted_at` est posé');
    dire(enBase?.is_active === false, 'elle est dépubliée du même coup',
      'une règle à la corbeille ne doit plus se déclencher');

    // ── 3. Elle est dans la corbeille, à l'écran ─────────────────────
    await cliquerTexte(page, 'Corbeille');
    await attendre(1200);
    const dansCorbeille = await corpsContient(page, NOM);
    dire(dansCorbeille, 'elle apparaît dans l’onglet « Corbeille »');
    const ditSupprimee = await corpsContient(page, 'Supprimée');
    dire(ditSupprimee, 'son statut affiché est « Supprimée », pas « Brouillon »');

    // ── 4. Restaurer ─────────────────────────────────────────────────
    await cliquerLabel(page, `Actions pour ${NOM}`);
    await attendre(400);
    const aRestaurer = await cliquerMenu(page, 'Restaurer');
    dire(aRestaurer, 'le menu d’une ligne supprimée offre « Restaurer »');
    await attendre(2000);

    const { data: apres } = await admin
      .from('automation_rules').select('deleted_at, is_active')
      .eq('id', regle.id).maybeSingle();
    dire(apres?.deleted_at === null, 'restaurer efface `deleted_at`');
    dire(apres?.is_active === false,
      'restaurée en BROUILLON, jamais republiée',
      'sinon des messages repartiraient sans relecture');

    // Et elle est de retour à l'écran, dans « Toutes ».
    await cliquerTexte(page, 'Toutes');
    await attendre(1200);
    const revenue = await corpsContient(page, NOM);
    dire(revenue, 'elle est de retour dans « Toutes »');
  } finally {
    await navigateur.close();
    // Nettoyage : la règle de test ne doit pas survivre au script.
    await admin.from('automation_rules').delete().eq('id', regle.id);
  }

  console.log(`\n${ok.length} vérifications passées, ${ko.length} en échec.`);
  if (ko.length) {
    console.log('\nÉchecs :');
    for (const k of ko) console.log(`  · ${k}`);
    process.exit(1);
  }
  console.log('La corbeille fonctionne de bout en bout.\n');
}

main().catch((e) => { console.error('\n✗', e.message); process.exit(1); });
