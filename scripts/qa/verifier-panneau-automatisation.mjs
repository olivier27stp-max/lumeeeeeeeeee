/**
 * Le panneau d'édition d'une étape — vérifié dans un VRAI navigateur.
 *
 * Une base parfaite ne dit rien de l'écran. Ce script ouvre l'éditeur, clique
 * une carte, remplit le panneau et vérifie que la modification survit à un
 * rechargement — c'est-à-dire qu'elle est vraiment partie au serveur.
 *
 * Deux pièges déjà payés dans ce projet, évités ici :
 *   · `page.evaluate(() => el.click())` ne déclenche PAS les gestionnaires
 *     React. On passe donc par `elementHandle.click()`, un vrai clic.
 *   · un test qui mesure « 0 sur 0 » n'est pas vert : il n'a rien mesuré.
 *     Chaque étape affirme d'abord que sa cible existe.
 *
 *   node --env-file=.env.local scripts/qa/verifier-panneau-automatisation.mjs
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

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ferme le bandeau Loi 25, qui se monte APRES le premier rendu.
 *
 * Il couvre l'ecran et capture tous les clics. Le pre-remplir dans
 * localStorage ne suffit pas toujours : l'app le remonte quand la forme
 * enregistree ne correspond pas a ce qu'elle attend. On clique donc pour de
 * vrai, en reessayant — c'est la lecon de `scripts/qa/boutons.mjs`, ou ce
 * bandeau avait fait declarer « 0 element cliquable » une page qui en compte
 * 51.
 */
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

/** Le texte d'un élément, ou '' — sans jamais lever. */
async function texte(page, selecteur) {
  return page.$eval(selecteur, (e) => e.textContent?.trim() ?? '').catch(() => '');
}

async function main() {
  console.log('\n═══ Panneau d’édition d’une étape ═══\n');

  const session = await ouvrirSession();
  const { data: membre } = await admin
    .from('memberships').select('org_id').eq('user_id', session.user.id)
    .eq('status', 'active').limit(1).maybeSingle();
  if (!membre) throw new Error(`aucune organisation active pour ${COMPTE}`);

  // Une règle jetable, avec un parcours à deux étapes.
  const { data: regle, error: eRegle } = await admin.from('automation_rules').insert({
    org_id: membre.org_id,
    name: 'QA — panneau d’édition',
    trigger_event: 'quote.sent',
    delay_seconds: 0,
    is_active: false,
    actions: [{ type: 'send_sms', config: { body: 'Bonjour' } }],
    // Le parcours se termine par une ACTION, jamais par une attente : le
    // serveur refuse « une séquence qui se termine par une attente, car rien
    // ne se passera après » — et il a raison. Un montage de test invalide
    // aurait fait échouer l'enregistrement pour une raison sans rapport avec
    // ce qu'on veut mesurer.
    steps: [
      { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour' } }, suivant: 'e2' },
      { id: 'e2', type: 'attendre', delai_secondes: 86400, suivant: 'e3' },
      { id: 'e3', type: 'action', action: { type: 'create_notification', config: { title: 'Suivi' } }, suivant: null },
    ],
  }).select('id').single();
  if (eRegle) throw new Error(`création de la règle : ${eRegle.message}`);
  console.log(`  Règle de test : ${regle.id}\n`);

  const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await nav.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const erreursConsole = [];
  page.on('console', (m) => { if (m.type() === 'error') erreursConsole.push(m.text().slice(0, 200)); });
  if (process.env.QA_TRACE) {
    page.on('request', (rq) => {
      if (rq.url().includes('/api/automations') && rq.method() !== 'GET') {
        console.log(`    → ${rq.method()} ${rq.url().slice(-40)}`, (rq.postData() || '').slice(0, 300));
      }
    });
    page.on('response', async (rp) => {
      if (rp.url().includes('/api/automations') && rp.status() >= 400) {
        console.log(`    ← ${rp.status()}`, (await rp.text().catch(() => '')).slice(0, 300));
      }
    });
  }

  const jeton = {
    access_token: session.access_token, refresh_token: session.refresh_token,
    expires_at: session.expires_at, expires_in: session.expires_in,
    token_type: 'bearer', user: session.user,
  };
  await page.evaluateOnNewDocument((t, o) => {
    localStorage.setItem('lume-auth-token', JSON.stringify(t));
    localStorage.setItem('lume-active-org', o);
    localStorage.setItem('lume-language', 'fr');
    // Le bandeau Loi 25 capture TOUS les clics tant qu'il est la : le refus
    // doit etre memorise sous la forme exacte que l'app relit (un objet JSON,
    // pas une chaine). Avec 'refuse', le bandeau se reaffichait et le test
    // cliquait dans le vide.
    const choix = JSON.stringify({ essential: true, analytics: false, marketing: false, at: Date.now() });
    for (const k of ['lume-cookie-consent', 'cookie-consent', 'lume-consent']) localStorage.setItem(k, choix);
  }, jeton, membre.org_id);

  try {
    await page.goto(`${BASE}/automations/${regle.id}`, { waitUntil: 'networkidle2', timeout: 30000 });
    await attendre(1500);
    await degagerLaVue(page);

    // ── 1. Le canevas affiche les cartes ──
    const cartes = await page.$$('[aria-current], button[aria-current], div.relative.w-\\[260px\\]');
    dire(cartes.length > 0, 'le canevas affiche des cartes', `${cartes.length} trouvée(s)`);
    if (!cartes.length) throw new Error('aucune carte : rien à cliquer, le reste du test ne mesurerait rien');

    // ── 2. Cliquer une carte ouvre le panneau ──
    // Un VRAI clic : `evaluate(el => el.click())` ne réveille pas React.
    const premiere = await page.$('div.relative.w-\\[260px\\] button');
    dire(Boolean(premiere), 'une carte est cliquable');
    await premiere.click();
    await attendre(700);

    const panneau = await page.$('aside[aria-label]');
    dire(Boolean(panneau), 'cliquer une carte OUVRE le panneau d’édition');
    if (!panneau) throw new Error('le panneau ne s’ouvre pas — c’est précisément ce qui était cassé');

    // ── 3. Les deux onglets de GHL ──
    const ongletsTxt = await page.$$eval('aside[aria-label] [role="tab"]', (ts) => ts.map((t) => t.textContent.trim()));
    dire(ongletsTxt.length === 2, 'le panneau a deux onglets', ongletsTxt.join(' | '));
    dire(ongletsTxt.some((t) => /Modifier/i.test(t)), '« Modifier l’action » est là');
    dire(ongletsTxt.some((t) => /Statistiques/i.test(t)), '« Statistiques » est là');

    // ── 4. Les boutons du pied ──
    const piedTxt = await page.$$eval('aside[aria-label] button', (bs) => bs.map((b) => b.textContent.trim()));
    for (const attendu of ['Supprimer', 'Annuler', 'Enregistrer']) {
      dire(piedTxt.some((t) => t === attendu), `le bouton « ${attendu} » existe`);
    }

    // ── 5. Le nom de l'action se saisit ──
    const champNom = await page.$('aside[aria-label] input[type="text"]');
    dire(Boolean(champNom), 'le champ « Nom de l’action » existe');
    await champNom.click({ clickCount: 3 });
    await page.keyboard.type('Texto de bienvenue');

    // ── 6. Changer le type d'action change les champs affichés ──
    const selecteurs = await page.$$('aside[aria-label] select');
    dire(selecteurs.length > 0, 'le choix de l’action est un menu');
    const familles = await page.$eval('aside[aria-label] select', (s) =>
      Array.from(s.querySelectorAll('optgroup')).map((g) => g.label));
    dire(familles.length >= 5, 'les actions sont groupées par famille', familles.join(', '));
    const nbOptions = await page.$eval('aside[aria-label] select', (s) => s.options.length);
    /*
     * Le menu est FILTRÉ par le déclencheur : la règle de test part sur
     * « soumission envoyée », donc l'entité qui arrivera est un devis.
     * « Envoyer la facture », « changer le statut du rendez-vous » et les
     * trois actions d'opportunité n'y ont aucun sens — le serveur les
     * refuserait. On vérifie qu'elles sont bien ABSENTES du menu, et que
     * « envoyer la soumission » y est, elle.
     */
    const offertes = await page.$eval('aside[aria-label] select', (s) =>
      Array.from(s.options).map((o) => o.value));
    dire(nbOptions >= 12, 'le menu offre les actions compatibles', `${nbOptions} option(s)`);
    for (const absente of ['envoyer_facture', 'modifier_statut_rendezvous', 'modifier_deal', 'assigner_deal', 'move_deal_stage']) {
      dire(!offertes.includes(absente), `« ${absente} » est retirée du menu sur « soumission envoyée »`);
    }
    dire(offertes.includes('envoyer_soumission'), '« envoyer la soumission » est offerte, elle');
    dire(offertes.includes('ajouter_etiquette'), 'les actions « client » restent offertes partout');

    // Passer sur « Envoyer un courriel » : le panneau doit gagner objet +
    // expéditeur + aperçu, que le texto n'a pas.
    await page.select('aside[aria-label] select', 'send_email');
    await attendre(400);
    const libelles = await page.$$eval('aside[aria-label] label', (ls) => ls.map((l) => l.textContent.trim()));
    for (const attendu of ['Objet', 'Nom de l’expéditeur', 'Répondre à', 'Aperçu']) {
      dire(libelles.some((l) => l.startsWith(attendu)), `« ${attendu} » apparaît pour un courriel`);
    }

    // Revenir au texto : ces champs doivent DISPARAÎTRE.
    await page.select('aside[aria-label] select', 'send_sms');
    await attendre(400);
    const apresRetour = await page.$$eval('aside[aria-label] label', (ls) => ls.map((l) => l.textContent.trim()));
    dire(!apresRetour.some((l) => l.startsWith('Objet')), '« Objet » disparaît quand on revient au texto');

    // ── 7. Un champ conditionnel ──
    await page.select('aside[aria-label] select', 'retirer_etiquette');
    await attendre(400);
    const avantBascule = await page.$$eval('aside[aria-label] label', (ls) => ls.map((l) => l.textContent.trim()));
    dire(avantBascule.some((l) => l.startsWith('L’étiquette')), '« L’étiquette » est visible par défaut');
    const bascule = await page.$('aside[aria-label] input[type="checkbox"]');
    dire(Boolean(bascule), 'la bascule « toutes les étiquettes » existe');
    await bascule.click();
    await attendre(400);
    const apresBascule = await page.$$eval('aside[aria-label] label', (ls) => ls.map((l) => l.textContent.trim()));
    dire(
      !apresBascule.some((l) => l.startsWith('L’étiquette')),
      'cocher « toutes » MASQUE le champ étiquette (champ conditionnel)',
    );

    // ── 8. Enregistrer un texto, et vérifier que ça part au serveur ──
    await page.select('aside[aria-label] select', 'send_sms');
    await attendre(300);
    const zone = await page.$('aside[aria-label] textarea');
    dire(Boolean(zone), 'le champ « Texte du message » existe');
    await zone.click({ clickCount: 3 });
    await page.keyboard.type('Merci pour votre soumission !');

    const boutons = await page.$$('aside[aria-label] button');
    let enregistrer = null;
    for (const b of boutons) {
      const t = await page.evaluate((e) => e.textContent.trim(), b);
      if (t === 'Enregistrer') enregistrer = b;
    }
    dire(Boolean(enregistrer), 'le bouton « Enregistrer » est atteignable');
    // Un bouton DESACTIVE avale le clic sans rien faire : le test croirait
    // avoir enregistre et n'aurait rien mesure. On l'affirme avant de cliquer.
    if (process.env.QA_TRACE) {
      const vus = await page.evaluate(() => ({
        nom: document.querySelector('aside[aria-label] input[type="text"]')?.value ?? null,
        zone: document.querySelector('aside[aria-label] textarea')?.value ?? null,
        action: document.querySelector('aside[aria-label] select')?.value ?? null,
      }));
      console.log('    [trace] ce que le panneau porte :', JSON.stringify(vus));
    }
    // QUI reçoit vraiment le clic à cet endroit ? La carte « Configuration
    // 4/8 » flotte en bas de l'écran et peut recouvrir le pied du panneau.
    if (process.env.QA_TRACE) {
      const dessus = await page.evaluate((b) => {
        const r = b.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { cible: el?.tagName + '.' + String(el?.className).slice(0, 60), estLeBouton: el === b };
      }, enregistrer);
      console.log('    [trace] au point du clic :', JSON.stringify(dessus));
    }
    const desactive = await page.evaluate((b) => b.disabled, enregistrer);
    dire(!desactive, '« Enregistrer » est actif quand le formulaire est complet');
    await enregistrer.click();
    await attendre(2500); // l'enregistrement est différé d'une seconde
    if (process.env.QA_TRACE) {
      const etat = await page.evaluate(() => {
        const t = document.body.innerText;
        for (const mot of ['Enregistre', 'Modifie', 'compl', 'Saved', 'Edited']) {
          const i = t.indexOf(mot);
          if (i >= 0) return t.slice(Math.max(0, i - 30), i + 40).replace(/\s+/g, ' ');
        }
        return 'AUCUN indicateur trouve';
      });
      console.log('    [trace] etat sauvegarde :', JSON.stringify(etat));
      const panneauEncoreLa = await page.$('aside[aria-label]');
      console.log('    [trace] panneau encore ouvert :', Boolean(panneauEncoreLa));
    }

    // ── 9. La preuve : relire la règle EN BASE ──
    const { data: apres } = await admin
      .from('automation_rules').select('steps').eq('id', regle.id).single();
    const e1 = (apres.steps || []).find((s) => s.id === 'e1');
    dire(
      e1?.action?.config?.body === 'Merci pour votre soumission !',
      'le message modifié est ARRIVÉ EN BASE',
      JSON.stringify(e1?.action?.config?.body ?? null),
    );
    dire(e1?.nom === 'Texto de bienvenue', 'le nom de l’action est arrivé en base', JSON.stringify(e1?.nom ?? null));

    // ── 10. Et il survit à un rechargement ──
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await attendre(1500);
    await degagerLaVue(page);
    const surLaCarte = await texte(page, 'div.relative.w-\\[260px\\]');
    dire(
      surLaCarte.includes('Texto de bienvenue'),
      'la carte affiche le nom donné, après rechargement',
      surLaCarte.slice(0, 60),
    );

    // ── 11. L'onglet Statistiques s'ouvre ──
    const carte2 = await page.$('div.relative.w-\\[260px\\] button');
    await carte2.click();
    await attendre(600);
    const tabs = await page.$$('aside[aria-label] [role="tab"]');
    dire(tabs.length === 2, 'les onglets sont toujours là après rechargement');
    await tabs[1].click();
    await attendre(400);
    const contenuStats = await page.evaluate(() => {
      const a = document.querySelector('aside[aria-label]');
      return a ? a.innerText.replace(/\s+/g, ' ') : '';
    });
    dire(
      /Envois|passage|Sends|runs/i.test(contenuStats),
      'l’onglet Statistiques affiche quelque chose',
      contenuStats.slice(0, 120),
    );

    // ── 12. Le TIROIR d'actions (le « + » du canevas) ──
    // C'est ce que Rafba ne voyait pas : le « + » ouvrait un menu de quatre
    // lignes au lieu du tiroir complet de GoHighLevel.
    await page.keyboard.press('Escape').catch(() => {});
    const boutonAjouter = await page.evaluateHandle(() => {
      for (const b of Array.from(document.querySelectorAll('button'))) {
        if ((b.textContent || '').trim() === 'Ajouter') return b;
      }
      return null;
    });
    const elAjouter = boutonAjouter.asElement();
    dire(Boolean(elAjouter), 'le bouton « Ajouter » existe sur le canevas');
    if (elAjouter) {
      await elAjouter.click();
      await attendre(700);
      const tiroir = await page.$('aside[aria-label="Actions"]');
      dire(Boolean(tiroir), '« Ajouter » ouvre le TIROIR d’actions (plus un menu de 4 lignes)');
      if (tiroir) {
        const recherche = await page.$('aside[aria-label="Actions"] input[type="search"]');
        dire(Boolean(recherche), 'le tiroir a une recherche, comme chez GHL');
        const lignes = await page.$$eval('aside[aria-label="Actions"] li button',
          (bs) => bs.map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
        dire(lignes.length >= 15, 'le tiroir liste toutes les étapes', `${lignes.length} entrées`);
        const familles = await page.$$eval('aside[aria-label="Actions"] h3',
          (hs) => hs.map((h) => h.textContent.trim()));
        dire(familles.length >= 5, 'les entrées sont groupées par famille', familles.join(', '));
        dire(familles.includes('Parcours'), 'la famille « Parcours » (attendre, condition, arrêter) est là');

        // La recherche filtre pour de vrai.
        await recherche.click();
        await page.keyboard.type('etiquette');
        await attendre(500);
        const apresRecherche = await page.$$eval('aside[aria-label="Actions"] li button',
          (bs) => bs.map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
        dire(apresRecherche.length > 0 && apresRecherche.length < lignes.length,
          'la recherche filtre (et ignore les accents)', apresRecherche.join(', '));
      }
    }

    // ── 13. La carte du DÉCLENCHEUR s'ouvre d'un clic ──
    // Le tiroir des déclencheurs n'était atteignable que sur un canevas
    // VIDE : dès la première étape, plus aucun moyen d'en changer.
    await page.keyboard.press('Escape').catch(() => {});
    const carteDecl = await page.evaluateHandle(() => {
      for (const b of Array.from(document.querySelectorAll('button'))) {
        if ((b.textContent || '').includes('Quand')) return b;
      }
      return null;
    });
    const elDecl = carteDecl.asElement();
    dire(Boolean(elDecl), 'la carte « Quand » (déclencheur) est cliquable');
    if (elDecl) {
      await elDecl.click();
      await attendre(700);
      const tiroirD = await page.$('aside[aria-label="Déclencheurs"]');
      dire(Boolean(tiroirD), 'cliquer le déclencheur ouvre son tiroir');
      if (tiroirD) {
        const dec = await page.$$eval('aside[aria-label="Déclencheurs"] li button',
          (bs) => bs.map((b) => ({ t: b.textContent.replace(/\s+/g, ' ').trim(), off: b.disabled })));
        dire(dec.length === 16, 'les 16 déclencheurs sont listés', `${dec.length} trouvés`);
        dire(dec.some((d) => d.off && /bient/i.test(d.t)),
          'ceux qui ne partent pas encore sont grisés « bientôt »');
        const famD = await page.$$eval('aside[aria-label="Déclencheurs"] h3',
          (hs) => hs.map((h) => h.textContent.trim()));
        dire(famD.length >= 5, 'groupés par famille', famD.join(', '));
        await page.keyboard.press('Escape').catch(() => {});
        const fermer = await page.$('aside[aria-label="Déclencheurs"] button[aria-label]');
        if (fermer) await fermer.click();
        await attendre(500);
      }
    }

    // ── 14. Le menu « … » d'une carte ──
    const menuBtn = await page.$('[aria-label^="Options de"]');
    dire(Boolean(menuBtn), 'chaque carte porte son menu « … »');
    if (menuBtn) {
      await menuBtn.click();
      await attendre(600);
      const entrees = await page.$$eval('button', (bs) =>
        bs.map((b) => b.textContent.trim()).filter((t) =>
          /^(Dupliquer|Modifier l|Supprimer)/.test(t)));
      dire(entrees.length >= 4, 'le menu offre dupliquer / modifier / supprimer / à partir d’ici',
        entrees.join(' · '));
    }

    // ── 15. Aucune erreur rouge dans la console ──
    const graves = erreursConsole.filter((e) => !/favicon|manifest|sourcemap|Download the React/i.test(e));
    dire(graves.length === 0, 'aucune erreur JavaScript', graves.slice(0, 2).join(' | '));

  } finally {
    await nav.close();
    await admin.from('automation_rules').delete().eq('id', regle.id);
    console.log('\n  Règle de test supprimée.');
  }

  console.log(`\n═══ ${ok.length} réussi(s), ${ko.length} échec(s) ═══\n`);
  if (ko.length) {
    for (const k of ko) console.log(`  ✗ ${k}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error('\nÉCHEC :', e.message); process.exit(1); });
