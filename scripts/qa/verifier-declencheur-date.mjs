/**
 * « DATE ATTEINTE » — réglé dans un VRAI navigateur, contre la VRAIE base.
 *
 * Ce déclencheur était grisé « bientôt » parce que ses deux réglages
 * n'étaient saisissables NULLE PART : le balayage quotidien lit
 * `conditions.champ_id`, ne trouvait rien, et passait son chemin. La règle
 * se publiait, s'affichait active, et ne partait jamais.
 *
 * Un test unitaire prouve que l'écran réagit à ce qu'on lui donne. Il ne
 * prouve pas que le réglage ARRIVE EN BASE — et c'est là qu'on se fait
 * prendre : Zod retire en silence une clé absente du schéma, le serveur
 * répond 200, et la valeur a disparu au rechargement.
 *
 *   node --env-file=.env.local scripts/qa/verifier-declencheur-date.mjs
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

/** Un vrai clic — `evaluate(el.click())` ne déclenche pas React. */
async function cliquerTexte(page, mot) {
  for (const b of await page.$$('button')) {
    const t = await b.evaluate((e) => e.textContent || '');
    if (t.includes(mot)) { await b.click(); return true; }
  }
  return false;
}

async function main() {
  console.log('\n═══ Déclencheur « Date atteinte » ═══\n');

  const session = await ouvrirSession();
  const { data: membre } = await admin
    .from('memberships').select('org_id').eq('user_id', session.user.id)
    .eq('status', 'active').limit(1).maybeSingle();
  if (!membre) throw new Error(`aucune organisation active pour ${COMPTE}`);
  const ORG = membre.org_id;

  /*
   * Un champ date jetable sur la fiche client. `key` doit respecter
   * `custom_fields_key_format` : ^[a-z][a-z0-9_]{0,49}$ — un tiret ou une
   * majuscule fait échouer l'insertion avec un message obscur.
   */
  const cle = `qa_date_${Date.now()}`.slice(0, 50);
  const { data: champ, error: eChamp } = await admin.from('custom_fields').insert({
    org_id: ORG, object_type: 'client', key: cle,
    label: 'QA — fin de garantie', field_type: 'date',
  }).select('id, label').single();
  if (eChamp) throw new Error(`création du champ date : ${eChamp.message}`);

  const { data: regle, error: eRegle } = await admin.from('automation_rules').insert({
    org_id: ORG,
    name: `QA — date atteinte ${Date.now()}`,
    trigger_event: 'date.reached',
    delay_seconds: 0,
    is_active: false,
    actions: [{ type: 'send_sms', config: { body: 'Votre garantie expire bientôt.' } }],
    steps: [],
  }).select('id, name').single();
  if (eRegle) throw new Error(`création de la règle : ${eRegle.message}`);

  const navigateur = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await navigateur.newPage();
    await page.setViewport({ width: 1440, height: 900 });
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

    // ── 1. Le déclencheur n'est plus grisé ───────────────────────────
    const grise = await page.evaluate(() => document.body.innerText.includes('bientôt'));
    dire(!grise, 'le déclencheur n’est plus marqué « bientôt »');

    // ── 2. Ouvrir les RÉGLAGES du déclencheur ────────────────────────
    /*
     * Sur un canevas VIDE, la carte « Quand » n'existe pas : l'écran
     * propose « Choisir le déclencheur » puis, en dessous, le bouton de
     * réglage. C'est l'état dans lequel une règle neuve se trouve — donc
     * celui qu'il faut mesurer.
     */
    let ouvert = false;
    for (const b of await page.$$('button')) {
      const t = await b.evaluate((e) => e.textContent || '');
      if (t.includes('Régler le déclencheur') || t.includes('à choisir')
          || t.includes('Quelle date surveiller') || t.includes('QA — fin de garantie')) {
        await b.click(); ouvert = true; break;
      }
    }
    dire(ouvert, 'le réglage du déclencheur est ATTEIGNABLE',
      ouvert ? '' : 'aucun bouton pour l’ouvrir — le champ resterait insaisissable');
    await attendre(1400);

    const panneau = await page.evaluate(() => {
      const a = document.querySelector('aside[aria-label*="déclencheur"], aside[aria-label*="rigger"]');
      return a ? a.innerText.slice(0, 400) : '';
    });
    dire(!!panneau, 'le panneau de réglages s’ouvre',
      panneau ? '' : 'sans lui, le champ date reste insaisissable');
    dire(panneau.includes('Quelle date'), 'il demande QUELLE date surveiller');
    dire(panneau.includes('jours avant'), 'et combien de jours avant');

    // ── 3. Le champ date créé est proposé ────────────────────────────
    const options = await page.evaluate(() => {
      const a = document.querySelector('aside[aria-label*="déclencheur"], aside[aria-label*="rigger"]');
      const s = a?.querySelector('select');
      return s ? Array.from(s.options).map((o) => o.textContent.trim()) : [];
    });
    dire(options.includes('QA — fin de garantie'),
      'le champ date de l’entreprise est proposé', options.join(' | ').slice(0, 90));

    // ── 4. Enregistrer, et VÉRIFIER EN BASE ──────────────────────────
    await page.evaluate((id) => {
      const a = document.querySelector('aside[aria-label*="déclencheur"], aside[aria-label*="rigger"]');
      const s = a?.querySelector('select');
      if (!s) return;
      // Passer par le setter natif : React ignore une écriture directe
      // de `.value` et l'enregistrement partirait avec l'ancienne valeur.
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(s, id);
      s.dispatchEvent(new Event('change', { bubbles: true }));
    }, champ.id);
    await attendre(400);

    const nb = await page.evaluate(() => {
      const a = document.querySelector('aside[aria-label*="déclencheur"], aside[aria-label*="rigger"]');
      const i = a?.querySelector('input[type="number"]');
      if (!i) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, '30');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    });
    dire(nb, 'le délai se saisit');

    await attendre(300);
    await cliquerTexte(page, 'Enregistrer');
    await attendre(2500);

    const { data: apres } = await admin
      .from('automation_rules').select('conditions').eq('id', regle.id).maybeSingle();
    const c = apres?.conditions ?? {};
    dire(c.champ_id === champ.id, 'le champ date est ENREGISTRÉ EN BASE',
      c.champ_id ? '' : `reçu : ${JSON.stringify(c)}`);
    dire(c.jours_avant === 30, 'le délai aussi, et en NOMBRE',
      `reçu : ${JSON.stringify(c.jours_avant)} (${typeof c.jours_avant})`);

    // ── 5. Le réglage se lit sous la carte, sans rien ouvrir ─────────
    await page.reload({ waitUntil: 'networkidle2', timeout: 60_000 });
    await degagerLaVue(page);
    await attendre(2500);
    const surLaCarte = await page.evaluate(() => document.body.innerText);
    dire(surLaCarte.includes('QA — fin de garantie'),
      'le champ choisi s’affiche sous la carte « Quand »');
  } finally {
    await navigateur.close();
    await admin.from('automation_rules').delete().eq('id', regle.id);
    await admin.from('custom_fields').delete().eq('id', champ.id);
    console.log('\n  Données de test supprimées.');
  }

  console.log(`\n═══ ${ok.length} réussi(s), ${ko.length} échec(s) ═══\n`);
  if (ko.length) { for (const k of ko) console.log(`  · ${k}`); process.exit(1); }
}

main().catch((e) => { console.error('\n✗', e.message); process.exit(1); });
