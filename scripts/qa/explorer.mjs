#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   L'EXPLORATEUR — le robot qui visite l'application.

   Il ouvre un vrai navigateur, ouvre une session, et parcourt chaque
   page de la carte. Pour chacune il note ce qu'un client verrait :
   la page s'affiche-t-elle ? une erreur passe-t-elle en silence ?
   les données arrivent-elles ?

   CE QU'IL TRAQUE EN PARTICULIER
   Les morts silencieuses. Avec PostgREST, une seule colonne
   inexistante fait échouer TOUTE la requête sans jamais lever
   d'exception : la page s'affiche, l'air normale, mais vide. C'est
   ainsi que les jobs récurrents et le classement des vendeurs sont
   restés cassés des semaines sans que personne le voie.

   MODES
     --observation   ne crée RIEN, se contente de regarder (défaut)
     --env=staging   ou --env=prod
     --role=owner    owner | admin | sales_rep | technician
     --page=/clients ne visiter qu'une page (mise au point)

   Usage : npm run qa:explorer
   ═══════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const RACINE = process.cwd();
const args = process.argv.slice(2);
const lire = (n, d) => {
  const a = args.find((x) => x.startsWith(`--${n}=`));
  return a ? a.split('=')[1] : d;
};

// Les options passent AUSSI par l'environnement : sous Git Bash, un argument
// commençant par « / » est réécrit en chemin Windows (/day → C:/…/day), et
// `node --env-file` capte les arguments inconnus avant le script.
const OBSERVATION = !(args.includes('--ecriture') || process.env.QA_ECRITURE === '1');
const ENV = process.env.QA_ENV || lire('env', 'staging');
const ROLE = process.env.QA_ROLE || lire('role', 'owner');
// Git Bash réécrit toute valeur commençant par « / » en chemin Windows, y
// compris dans une variable d'environnement (/day → C:/Program Files/Git/day).
// On accepte donc « day » aussi bien que « /day », et on répare la déformation.
function normaliserChemin(v) {
  if (!v) return null;
  let c = String(v);
  const deforme = c.match(/^[A-Za-z]:[\/].*[\/]([^\/]+)$/);
  if (deforme) c = deforme[1];
  return c.startsWith('/') ? c : '/' + c;
}
const PAGE_UNIQUE = normaliserChemin(process.env.QA_PAGE || lire('page', null));
const LANGUE = process.env.QA_LANGUE || lire('langue', 'fr');
const BASE = (process.env.QA_URL || (ENV === 'prod' ? 'https://lumecrm.net' : process.env.FRONTEND_URL) || 'http://localhost:5173').replace(/\/$/, '');

// Viser la PRODUCTION : le site déployé et sa base, au lieu du local. Les
// clés sont récupérées à la volée via la Management API — elles ne sont pas
// dans .env.local, et n'ont pas à y être.
const PROD = ENV === 'prod';
let URL_SB = process.env.VITE_SUPABASE_URL;
let CLE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
let CLE_ANON = process.env.VITE_SUPABASE_ANON_KEY;

if (PROD) {
  // Garde-fou absolu : en production, on REGARDE, on n'écrit jamais.
  if (!OBSERVATION) {
    console.error('REFUS : l’écriture en production n’est pas permise par ce banc.');
    process.exit(2);
  }
  const ref = process.env.SUPABASE_PROJECT_REF_PROD;
  const jeton = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !jeton) {
    console.error('SUPABASE_PROJECT_REF_PROD et SUPABASE_ACCESS_TOKEN sont requis pour viser la prod.');
    process.exit(2);
  }
  const rep = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, {
    headers: { Authorization: `Bearer ${jeton}`, 'User-Agent': 'curl/8.7.1' },
  });
  const cles = await rep.json();
  const trouver = (nom) => (Array.isArray(cles) ? cles.find((k) => k.name === nom)?.api_key : null);
  URL_SB = `https://${ref}.supabase.co`;
  CLE_ANON = trouver('anon');
  CLE_SERVICE = trouver('service_role');
  if (!CLE_ANON || !CLE_SERVICE) {
    console.error('Impossible de récupérer les clés de production.');
    process.exit(2);
  }
}
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';

if (!URL_SB || !CLE_SERVICE || !CLE_ANON) {
  console.error('Variables Supabase manquantes — lancer avec --env-file=.env.local');
  process.exit(2);
}

// Garde-fou : en écriture, on refuse la prod tant que le filet n'est pas armé.
if (!OBSERVATION && ENV === 'prod' && !process.env.QA_REDIRECT_TO) {
  console.error('REFUS : écriture en production sans filet de sécurité.');
  console.error('Armer QA_REDIRECT_TO dans .env.local — voir npm run qa:verifier-filet.');
  process.exit(2);
}

const admin = createClient(URL_SB, CLE_SERVICE, { auth: { persistSession: false } });

/* ── La carte ─────────────────────────────────────────────────── */

const cheminCarte = path.join(RACINE, 'qa-carte.json');
if (!fs.existsSync(cheminCarte)) {
  console.error('qa-carte.json absent — lancer d\'abord : npm run qa:carte');
  process.exit(2);
}
const carte = JSON.parse(fs.readFileSync(cheminCarte, 'utf8'));

/* ── Ouverture de session ─────────────────────────────────────── */

async function ouvrirSession() {
  const { data: lien, error: e1 } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: COMPTE,
  });
  if (e1) throw new Error(`lien magique refusé : ${e1.message}`);

  const anon = createClient(URL_SB, CLE_ANON, { auth: { persistSession: false } });
  const { data: sess, error: e2 } = await anon.auth.verifyOtp({
    token_hash: lien.properties.hashed_token,
    type: 'magiclink',
  });
  if (e2) throw new Error(`session refusée : ${e2.message}`);
  return sess.session;
}

async function trouverOrg(userId) {
  const { data } = await admin
    .from('memberships')
    .select('org_id, role')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  return data;
}

/* ── Ce qu'on observe sur une page ────────────────────────────── */

const ECRANS = [
  // Une page introuvable est le pire accueil possible : l'utilisateur a
  // suivi un lien de l'application et tombe dans le vide. À traquer en
  // priorité — d'où sa place en tête de liste.
  { cle: 'page_introuvable', textes: ['404', 'Page introuvable', 'Page not found', 'Not Found', "n'existe pas", 'does not exist', 'Oups'] },
  { cle: 'acces_restreint', textes: ['Accès restreint', 'Access Restricted'] },
  { cle: 'module_verrouille', textes: ['Module verrouillé', 'Module Locked', 'débloquer ce module'] },
  { cle: 'abonnement_bloque', textes: ['Accès bloqué', 'Access Blocked', 'abonnement'] },
  { cle: 'porte_mobile', textes: ['Téléchargez l\'application', 'Download the app'] },
  { cle: 'erreur', textes: ['Une erreur est survenue', 'Something went wrong', 'Erreur inattendue'] },
];

async function visiter(page, route) {
  const journal = {
    chemin: route.chemin,
    permission: route.permission || null,
    fichier: route.fichier || null,
    erreursConsole: [],
    requetesEchouees: [],
    reponsesVides: [],
    ecran: 'contenu',
    dureeMs: 0,
    anomalies: [],
  };

  // Écoutes posées avant la navigation, sinon on rate ce qui arrive tôt.
  const surConsole = (msg) => {
    if (msg.type() !== 'error') return;
    const t = msg.text();
    // Bruit connu sans conséquence fonctionnelle.
    if (/favicon|Download the React DevTools|sourcemap/i.test(t)) return;
    journal.erreursConsole.push(t.slice(0, 300));
  };
  const surErreurPage = (err) => journal.erreursConsole.push(`[exception] ${err.message}`.slice(0, 300));

  const surReponse = async (rep) => {
    const url = rep.url();
    if (!/\/rest\/v1\/|\/api\//.test(url)) return;
    const code = rep.status();
    if (code >= 400) {
      journal.requetesEchouees.push({ code, url: url.replace(URL_SB, '').slice(0, 160) });
      return;
    }
    // Le piège PostgREST : 200 avec un corps vide. La page s'affiche,
    // mais elle est creuse — c'est la mort silencieuse à débusquer.
    if (code === 200 && /\/rest\/v1\//.test(url)) {
      try {
        const corps = await rep.text();
        if (corps === '[]' || corps === '' || corps === '{}') {
          journal.reponsesVides.push(url.replace(URL_SB, '').slice(0, 160));
        }
      } catch { /* corps déjà consommé ou flux : sans importance */ }
    }
  };

  page.on('console', surConsole);
  page.on('pageerror', surErreurPage);
  page.on('response', surReponse);

  const debut = Date.now();
  try {
    await page.goto(BASE + route.chemin, { waitUntil: 'networkidle2', timeout: 30000 });
  } catch (e) {
    journal.anomalies.push(`la page ne se charge pas : ${e.message.slice(0, 120)}`);
  }
  journal.dureeMs = Date.now() - debut;

  // Laisser le temps au rendu différé (données, animations).
  await new Promise((r) => setTimeout(r, 1200));

  // Écarter les fenêtres de consentement qui couvrent l'application au
  // premier chargement (localisation GPS, témoins). Un utilisateur les
  // ferme une fois ; le robot doit faire pareil, sinon il photographie
  // 66 fois la même fenêtre. On REFUSE plutôt qu'on accepte : refuser
  // n'active aucun suivi et l'application doit rester pleinement
  // utilisable — c'est d'ailleurs ce que la fenêtre promet.
  const fermees = await page.evaluate(() => {
    const REFUS = ['Refuser', 'Decline', 'Tout refuser', 'Reject all'];
    let n = 0;
    for (const b of Array.from(document.querySelectorAll('button'))) {
      const t = (b.textContent || '').trim();
      if (REFUS.includes(t)) { b.click(); n++; }
    }
    return n;
  }).catch(() => 0);

  if (fermees) {
    journal.consentementsFermes = fermees;
    // Les données ne se chargent qu'une fois la vue dégagée.
    await new Promise((r) => setTimeout(r, 1500));
  }

  const texte = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  const urlFinale = page.url().replace(BASE, '') || '/';

  for (const e of ECRANS) {
    if (e.textes.some((t) => texte.includes(t))) { journal.ecran = e.cle; break; }
  }

  // Page blanche : ni contenu, ni écran de refus identifié.
  // Attention : une page qui REDIRIGE est photographiée en plein transit et
  // paraît vide à tort. /search sans terme renvoie volontairement à l'accueil
  // (SearchResults.tsx:233) — c'est un bon comportement, pas une panne.
  const aRedirige = (page.url().replace(BASE, '') || '/') !== route.chemin;
  if (journal.ecran === 'contenu' && texte.trim().length < 40 && !aRedirige) {
    journal.ecran = 'page_blanche';
    journal.anomalies.push('la page est vide — aucun contenu affiché');
  }

  // Redirection non prévue par la carte.
  if (urlFinale !== route.chemin && !route.chemin.includes(':')) {
    journal.redirigeVers = urlFinale;
  }

  // Une page introuvable atteinte depuis l'application est un défaut grave :
  // aucun lien interne ne devrait mener nulle part.
  if (journal.ecran === 'page_introuvable') {
    journal.anomalies.push('PAGE INTROUVABLE (404) — un lien de l’application mène dans le vide');
  }

  if (journal.erreursConsole.length) {
    journal.anomalies.push(`${journal.erreursConsole.length} erreur(s) dans la console`);
  }
  if (journal.requetesEchouees.length) {
    journal.anomalies.push(`${journal.requetesEchouees.length} requête(s) en échec`);
  }
  if (journal.dureeMs > 8000) {
    journal.anomalies.push(`chargement lent : ${(journal.dureeMs / 1000).toFixed(1)} s`);
  }

  page.off('console', surConsole);
  page.off('pageerror', surErreurPage);
  page.off('response', surReponse);

  return journal;
}

/* ── Déroulé ──────────────────────────────────────────────────── */

async function main() {
  console.log('\n═══ Explorateur — ' + (OBSERVATION ? 'OBSERVATION (ne crée rien)' : 'ÉCRITURE') + ' ═══\n');
  console.log(`  Environnement : ${ENV}`);
  console.log(`  Application   : ${BASE}`);
  console.log(`  Compte        : ${COMPTE}`);
  console.log(`  Langue        : ${LANGUE}`);

  // L'application doit tourner, sinon tout échouerait pour une seule raison.
  try {
    const sonde = await fetch(BASE, { signal: AbortSignal.timeout(5000) });
    if (!sonde.ok) throw new Error(`HTTP ${sonde.status}`);
  } catch (e) {
    console.error(`\n  L'application ne répond pas sur ${BASE} (${e.message}).`);
    console.error('  Démarrer « npm run dev » et « npm run api:dev », puis relancer.\n');
    process.exit(2);
  }

  console.log('\n  Ouverture de session…');
  const session = await ouvrirSession();
  const membre = await trouverOrg(session.user.id);
  if (!membre) throw new Error(`aucune organisation active pour ${COMPTE}`);
  console.log(`  Organisation  : ${membre.org_id} (rôle réel : ${membre.role})`);

  // Les pages à paramètre (/clients/:id) exigent un identifiant réel. On en
  // prend un vrai dans chaque table : sans elles, un tiers de l'application
  // reste invisible — ce sont pourtant les écrans les plus consultés.
  async function chemineAvecId(chemin) {
    const table = chemin.startsWith('/clients') ? 'clients_active'
      : chemin.startsWith('/jobs') ? 'jobs_active'
      : chemin.startsWith('/quotes') ? 'quotes'
      : chemin.startsWith('/invoices') ? 'invoices'
      : chemin.startsWith('/requests') ? 'form_submissions'
      : null;
    if (!table) return null;
    const { data } = await admin.from(table).select('id').eq('org_id', membre.org_id).limit(1);
    if (!data?.[0]) return null;
    return chemin.replace(/:[a-zA-Z]+/, data[0].id);
  }

  let pages;
  if (PAGE_UNIQUE) {
    pages = carte.pages.filter((p) => p.chemin === PAGE_UNIQUE);
  } else {
    pages = carte.pages.filter((p) => !p.aParametre);
    if (process.env.QA_AVEC_DETAILS === '1') {
      for (const p of carte.pages.filter((x) => x.aParametre)) {
        const reel = await chemineAvecId(p.chemin);
        if (reel) pages.push({ ...p, chemin: reel, modele: p.chemin });
      }
    }
  }

  if (!pages.length) {
    console.error('\n  Aucune page à visiter.');
    process.exit(2);
  }
  console.log(`  Pages à visiter : ${pages.length}\n`);

  const navigateur = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await navigateur.newPage();
  // Viewport ordinateur obligatoire : en mobile, la porte d'entrée renvoie
  // « téléchargez l'application » et le robot ne verrait jamais le CRM.
  await page.setViewport({ width: 1440, height: 900 });

  // Session + organisation + langue déposées avant le premier rendu.
  const jeton = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: 'bearer',
    user: session.user,
  };
  await page.evaluateOnNewDocument(
    (t, org, langue) => {
      localStorage.setItem('lume-auth-token', JSON.stringify(t));
      localStorage.setItem('lume-active-org', org);
      localStorage.setItem('lume-language', langue);
    },
    jeton, membre.org_id, LANGUE,
  );

  const dossierCaptures = path.join(RACINE, 'qa-captures');
  fs.mkdirSync(dossierCaptures, { recursive: true });

  const journaux = [];
  let i = 0;
  for (const route of pages) {
    i++;
    const j = await visiter(page, route);
    journaux.push(j);

    const nom = route.chemin.replace(/[^a-z0-9]/gi, '_').replace(/^_|_$/g, '') || 'racine';
    try {
      await page.screenshot({ path: path.join(dossierCaptures, `${nom}.png`), fullPage: false });
      j.capture = `qa-captures/${nom}.png`;
    } catch { /* capture facultative */ }

    const marque = j.anomalies.length ? '✗' : j.ecran === 'contenu' ? '✓' : '·';
    const suffixe = j.ecran !== 'contenu' ? ` [${j.ecran}]` : '';
    console.log(
      `  ${marque} ${String(i).padStart(2)}/${pages.length} ${route.chemin.padEnd(34)}` +
      `${String(j.dureeMs).padStart(5)} ms${suffixe}`,
    );
    for (const a of j.anomalies) console.log(`        → ${a}`);
    if (j.reponsesVides.length) {
      console.log(`        → ${j.reponsesVides.length} requête(s) répondent VIDE (possible mort silencieuse)`);
    }
  }

  await navigateur.close();

  const rapport = {
    genereLe: new Date().toISOString(),
    mode: OBSERVATION ? 'observation' : 'ecriture',
    environnement: ENV,
    compte: COMPTE,
    orgId: membre.org_id,
    role: membre.role,
    resume: {
      pagesVisitees: journaux.length,
      sansProbleme: journaux.filter((j) => !j.anomalies.length && j.ecran === 'contenu').length,
      avecAnomalie: journaux.filter((j) => j.anomalies.length).length,
      pagesBlanches: journaux.filter((j) => j.ecran === 'page_blanche').length,
      pagesIntrouvables: journaux.filter((j) => j.ecran === 'page_introuvable').length,
      accesRefuses: journaux.filter((j) => j.ecran === 'acces_restreint').length,
      reponsesVides: journaux.filter((j) => j.reponsesVides.length).length,
    },
    pages: journaux,
  };

  fs.writeFileSync(path.join(RACINE, 'qa-exploration.json'), JSON.stringify(rapport, null, 2), 'utf8');

  const r = rapport.resume;
  console.log('\n' + '═'.repeat(60));
  console.log(`  Pages visitées        ${r.pagesVisitees}`);
  console.log(`  Sans problème         ${r.sansProbleme}`);
  console.log(`  Avec anomalie         ${r.avecAnomalie}`);
  console.log(`  Pages blanches        ${r.pagesBlanches}`);
  console.log(`  Pages introuvables    ${r.pagesIntrouvables}  (404 — aucun lien ne doit y mener)`);
  console.log(`  Accès refusés         ${r.accesRefuses}  (normal si le rôle ne permet pas)`);
  console.log(`  Requêtes vides        ${r.reponsesVides}  (à examiner : mort silencieuse ?)`);
  console.log('\n  → qa-exploration.json');
  console.log('  → qa-captures/\n');
}

main().catch((e) => {
  console.error('\nExplorateur interrompu :', e.message);
  process.exit(1);
});
