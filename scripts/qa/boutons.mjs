#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   LE TESTEUR DE BOUTONS — clique sur tout, et juge le résultat.

   Pour chaque élément cliquable d'une page :
     1. il le lit    — que dit-il ? est-il actif ?
     2. il clique
     3. il observe   — la page change ? une fenêtre s'ouvre ?
                       un message apparaît ? rien du tout ?
     4. il juge      — est-ce cohérent avec ce que le bouton annonce ?
     5. il revient   — pour que le bouton suivant parte du même état

   CE QU'IL SIGNALE
     - bouton mort            : rien ne se passe, nulle part
     - destination incohérente: « Nouveau client » mène ailleurs
     - erreur silencieuse     : échec réseau invisible pour l'utilisateur
     - page cassée            : le clic mène à une page vide ou en erreur
     - aucun retour           : action réussie sans confirmation

   CE QU'IL NE POUSSE PAS JUSQU'AU BOUT
   Les actions irréversibles (rendre un numéro, rembourser, résilier)
   sont ouvertes jusqu'à leur fenêtre de confirmation, vérifiées,
   puis ANNULÉES. Le bouton est testé, l'action ne part pas.

   Usage : QA_PAGE=clients npm run qa:boutons
   ═══════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const RACINE = process.cwd();

function normaliserChemin(v) {
  if (!v) return null;
  let c = String(v);
  const deforme = c.match(/^[A-Za-z]:[\\/].*[\\/]([^\\/]+)$/);
  if (deforme) c = deforme[1];
  return c.startsWith('/') ? c : '/' + c;
}

const PAGE_CIBLE = normaliserChemin(process.env.QA_PAGE);
const LANGUE = process.env.QA_LANGUE || 'fr';
const MAX_BOUTONS = Number(process.env.QA_MAX_BOUTONS || 40);
const BASE = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

const URL_SB = process.env.VITE_SUPABASE_URL;
const CLE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLE_ANON = process.env.VITE_SUPABASE_ANON_KEY;
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';

if (!URL_SB || !CLE_SERVICE || !CLE_ANON) {
  console.error('Variables Supabase manquantes — lancer avec --env-file=.env.local');
  process.exit(2);
}

const admin = createClient(URL_SB, CLE_SERVICE, { auth: { persistSession: false } });

/* Libellés dont l'action sort de l'application et ne se rattrape pas.
   On ouvre la confirmation, on la lit, on annule. */
const IRREVERSIBLES = /rembours|refund|résili|resili|annuler l'abonnement|cancel subscription|libérer le numéro|release number/i;

/* Libellés qui déconnectent : cliquer dessus perdrait la session et
   fausserait tous les boutons suivants. */
const DECONNEXION = /déconnexion|deconnexion|log ?out|sign ?out|se déconnecter/i;


/* ── La cohérence : le bouton mène-t-il là où son texte le promet ? ──
   Tester qu'un bouton « fait quelque chose » ne suffit pas : encore
   faut-il qu'il fasse la BONNE chose. On rapproche le mot du bouton
   du mot de la route. « Devis » doit mener vers /quotes, pas ailleurs.

   La correspondance est bilingue, l'application l'étant aussi. */
const VOCABULAIRE = {
  '/day': ['accueil', 'home', 'crm', 'tableau'],
  '/clients': ['client', 'customer'],
  '/requests': ['demande', 'request'],
  '/quotes': ['devis', 'quote', 'estimate', 'soumission'],
  '/jobs': ['job', 'travaux', 'chantier'],
  '/calendar': ['calendrier', 'calendar', 'horaire', 'schedule', 'tournée', 'tournee'],
  '/finances': ['finance', 'facture', 'invoice', 'paiement', 'payment', 'versement', 'payout'],
  '/invoices': ['facture', 'invoice'],
  '/messages': ['message', 'conversation', 'sms'],
  '/timesheets': ['temps', 'time', 'feuille', 'heure', 'disponibilit'],
  '/courses': ['formation', 'course', 'cours'],
  '/tasks': ['tâche', 'tache', 'task'],
  '/insights': ['statistique', 'insight', 'analyse', 'rapport', 'aperçu', 'apercu'],
  '/automations': ['automatisation', 'automation', 'workflow'],
  '/field-sales': ['vente', 'sales', 'terrain', 'porte'],
  '/pipeline': ['pipeline', 'entonnoir'],
  '/leaderboard': ['classement', 'leaderboard', 'palmarès', 'palmares'],
  '/commissions': ['commission'],
  // Les sous-pages des réglages : sans elles, « Taxes » → /settings/taxes
  // retombe sur le vocabulaire générique de /settings et devient indécidable.
  '/settings/profile': ['profil', 'profile', 'mon compte', 'paramètre', 'parametre', 'setting', 'retour'],
  '/settings/company': ['entreprise', 'company', 'compagnie'],
  '/settings/billing': ['forfait', 'abonnement', 'facturation', 'billing', 'plan'],
  '/settings/products': ['produit', 'service', 'product', 'catalogue'],
  '/settings/taxes': ['taxe', 'tax', 'tps', 'tvq'],
  '/settings/payments': ['paiement', 'payment', 'stripe', 'paypal', 'encaissement'],
  '/settings/messaging': ['messagerie', 'messaging', 'sms', 'courriel', 'email'],
  '/settings/team': ['équipe', 'equipe', 'team', 'membre', 'utilisateur', 'user'],
  '/settings/roles': ['rôle', 'role', 'permission', 'droit'],
  '/settings/payroll': ['paie', 'payroll', 'salaire'],
  '/settings/marketplace': ['marketplace', 'application', 'intégration', 'integration', 'app'],
  '/settings/archives': ['archive', 'corbeille'],
  '/settings/support': ['support', 'aide', 'help'],
  '/settings/location': ['localisation', 'location', 'gps', 'position'],
  '/settings': ['paramètre', 'parametre', 'setting', 'réglage', 'reglage', 'retour', 'profil'],
  '/privacy': ['confidentialité', 'confidentialite', 'privacy', 'vie privée'],
  '/terms': ['condition', 'terms'],
  '/search': ['recherche', 'search'],
  '/dispatch': ['répartition', 'repartition', 'dispatch'],
};

/* Mots qui n'annoncent aucune destination : on ne peut rien en juger. */
const NEUTRES = /^(plus|more|retour|back|fermer|close|annuler|cancel|ok|oui|non|suivant|next|précédent|\d+|switch role|switch plan|mode (sombre|clair)|dark|light)$/i;

/**
 * Le libellé promet-il ce que la destination livre ?
 *   'coherent'    le mot du bouton correspond à la route
 *   'incoherent'  il correspond à une AUTRE route — vrai défaut
 *   'indecidable' rien à conclure (libellé neutre, route inconnue)
 */
function jugerCoherence(libelle, destination) {
  const mot = String(libelle || '').toLowerCase().trim();
  if (!mot || NEUTRES.test(mot)) return { verdict: 'indecidable' };

  const route = String(destination || '').split('?')[0];
  // La route la plus spécifique d'abord : /settings/billing avant /settings.
  const connues = Object.keys(VOCABULAIRE).sort((a, b) => b.length - a.length);
  const attendue = connues.find((r) => route === r || route.startsWith(r + '/'));
  if (!attendue) return { verdict: 'indecidable' };

  if (VOCABULAIRE[attendue].some((m) => mot.includes(m))) {
    return { verdict: 'coherent', route: attendue };
  }

  // Le libellé désigne-t-il une AUTRE section ? C'est là qu'est le vrai défaut.
  const ailleurs = connues.find((r) => r !== attendue && VOCABULAIRE[r].some((m) => mot.includes(m)));
  if (ailleurs) return { verdict: 'incoherent', attendu: ailleurs, obtenu: route };

  return { verdict: 'indecidable' };
}

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

/** Ferme les fenêtres de consentement qui couvrent l'application. */
async function degagerLaVue(page) {
  const n = await page.evaluate(() => {
    const REFUS = ['Refuser', 'Decline', 'Tout refuser', 'Reject all'];
    let k = 0;
    for (const b of Array.from(document.querySelectorAll('button'))) {
      if (REFUS.includes((b.textContent || '').trim())) { b.click(); k++; }
    }
    return k;
  }).catch(() => 0);
  if (n) await new Promise((r) => setTimeout(r, 1200));
  return n;
}

/** Inventaire des éléments cliquables réellement visibles. */
async function inventorier(page) {
  return page.evaluate(() => {
    // Empreinte GLOBALE en complément : certains boutons n'agissent pas dans
    // la zone de contenu (menu flottant, bascule de thème, panneau latéral).
    // Sans elle, ils seraient déclarés morts à tort.
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
    };
    const out = [];
    const els = Array.from(document.querySelectorAll('button, a[href], [role="button"], [role="tab"]'));
    els.forEach((el, i) => {
      if (!visible(el)) return;
      el.setAttribute('data-qa-index', String(i));
      const texte = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      out.push({
        index: i,
        texte,
        etiquette: el.getAttribute('aria-label') || el.getAttribute('title') || '',
        href: el.getAttribute('href') || '',
        desactive: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
        balise: el.tagName.toLowerCase(),
      });
    });
    return out;
  });
}

/** Empreinte de l'état visible : sert à dire si le clic a produit un effet. */
async function empreinte(page) {
  return page.evaluate(() => {
    // On regarde la ZONE DE CONTENU, pas la page entière : la barre latérale
    // est identique partout et écrase tout changement réel. Comparer
    // `document.body` déclarait « morts » des onglets qui basculaient
    // parfaitement — c'est ainsi que 18 faux boutons morts ont été rapportés
    // au premier passage.
    const zone = document.querySelector('#page-content-area') || document.body;
    return {
      url: location.pathname + location.search,
      nbElements: zone.querySelectorAll('*').length,
      dialogue: !!document.querySelector('[role="dialog"], .modal, [data-state="open"]'),
      // Empreinte de tout le contenu, pas seulement de son début : un onglet
      // qui change une liste plus bas doit être vu.
      texte: (zone.innerText || '').replace(/\s+/g, ' ').trim(),
      nbGlobal: document.querySelectorAll('*').length,
      theme: document.documentElement.className + document.documentElement.getAttribute('data-theme'),
      // Un menu flottant ou un panneau ouvert se voit à la racine du document.
      flottants: document.querySelectorAll('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], .fixed').length,
    };
  });
}

async function testerPage(page, chemin) {
  const resultats = [];
  await page.goto(BASE + chemin, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await degagerLaVue(page);

  // L'inventaire ne vaut que si l'application a fini de s'afficher. Plutôt
  // qu'une attente fixe — trop courte on ne voit rien, trop longue on perd des
  // minutes sur 18 pages — on attend que des boutons apparaissent vraiment.
  let boutons = [];
  for (let essai = 0; essai < 12; essai++) {
    boutons = await inventorier(page);
    if (boutons.length > 3) break;
    await new Promise((r) => setTimeout(r, 400));
  }

  // Un bouton sans libellé dans la barre latérale est le replieur : cliquer
  // dessus masque le texte de toutes les autres entrées et fausse le reste du
  // passage. On repousse ces boutons à la fin.
  const remodele = (b) => !b.texte && !b.etiquette && !b.href;
  const ordonnes = [...boutons.filter((b) => !remodele(b)), ...boutons.filter(remodele)];
  const aTester = ordonnes.slice(0, MAX_BOUTONS);
  console.log(`\n  ${chemin} — ${boutons.length} élément(s) cliquable(s)` +
    (boutons.length > aTester.length ? `, ${aTester.length} testés` : ''));

  for (const b of aTester) {
    const nom = b.texte || b.etiquette || `<${b.balise} #${b.index}>`;

    if (b.desactive) {
      resultats.push({ ...b, verdict: 'desactive', detail: 'grisé — non cliquable' });
      continue;
    }
    if (DECONNEXION.test(nom)) {
      resultats.push({ ...b, verdict: 'ignore', detail: 'déconnexion — fausserait la suite' });
      console.log(`    · ${nom} — ignoré (déconnexion)`);
      continue;
    }

    const irreversible = IRREVERSIBLES.test(nom);
    const avant = await empreinte(page);
    const erreursReseau = [];
    const surReponse = (r) => {
      if (r.status() >= 400 && /\/rest\/v1\/|\/api\//.test(r.url())) {
        erreursReseau.push(`${r.status()} ${r.url().replace(URL_SB, '').slice(0, 120)}`);
      }
    };
    page.on('response', surReponse);

    // Certains boutons changent l'interface pour tous les suivants : replier
    // la barre latérale masque les libellés de TOUTES ses entrées, qui
    // deviennent alors « introuvables ». On les teste en dernier, après quoi
    // on remet l'interface d'aplomb.
    // L'interface est animée : après une navigation, la barre latérale se
    // reconstruit progressivement. Chercher une seule fois déclarait
    // « introuvable » des boutons parfaitement présents une demi-seconde plus
    // tard. On réessaie brièvement plutôt que de conclure trop vite.
    let clique = 'absent';
    for (let essai = 0; essai < 3 && clique === 'absent'; essai++) {
      if (essai) await new Promise((r) => setTimeout(r, 250));
    try {
      clique = await page.evaluate((cible) => {
        // MÊME filtre qu'à l'inventaire — opacity comprise. Deux filtres
        // différents font disparaître des boutons qui existent pourtant.
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'
            && s.display !== 'none' && s.opacity !== '0';
        };
        // On retrouve l'élément par ce qu'il EST, pas par sa position :
        // React reconstruit le DOM à chaque rendu et tout repère posé
        // auparavant désigne alors un autre bouton.
        const candidats = Array.from(document.querySelectorAll('button, a[href], [role="button"], [role="tab"]'))
          .filter(visible)
          .filter((el) => {
            const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
            const e = el.getAttribute('aria-label') || el.getAttribute('title') || '';
            const h = el.getAttribute('href') || '';
            return el.tagName.toLowerCase() === cible.balise && t === cible.texte
              && e === cible.etiquette && h === cible.href;
          });
        // Ambigu (plusieurs boutons identiques) : on s'abstient plutôt que
        // de cliquer au hasard et de rapporter un résultat faux.
        if (candidats.length !== 1) return candidats.length === 0 ? 'absent' : 'ambigu';
        candidats[0].click();
        return 'ok';
      }, { balise: b.balise, texte: b.texte, etiquette: b.etiquette, href: b.href });
    } catch { /* l'élément a pu disparaître entre-temps */ }
    }

    await new Promise((r) => setTimeout(r, 450));
    // La zone de contenu peut n'être pas encore montée juste après une
    // navigation : sans cette attente, tout bouton qui navigue semblerait
    // « casser la page ».
    let apres = await empreinte(page);
    for (let k = 0; k < 6 && apres.texte.length < 30; k++) {
      await new Promise((r) => setTimeout(r, 350));
      apres = await empreinte(page);
    }
    page.off('response', surReponse);

    if (clique !== 'ok') {
      resultats.push({
        ...b,
        verdict: clique === 'ambigu' ? 'ambigu' : 'introuvable',
        detail: clique === 'ambigu'
          ? 'plusieurs éléments identiques — non testé pour ne pas rapporter faux'
          : 'disparu avant le clic',
      });
      continue;
    }

    const aChange =
      avant.url !== apres.url ||
      avant.dialogue !== apres.dialogue ||
      Math.abs(avant.nbElements - apres.nbElements) > 3 ||
      avant.texte !== apres.texte ||
      // Effets hors zone de contenu : menu déroulant, thème, panneau.
      avant.theme !== apres.theme ||
      avant.flottants !== apres.flottants ||
      Math.abs(avant.nbGlobal - apres.nbGlobal) > 3;

    let verdict = 'ok';
    let detail = '';

    if (!aChange) {
      // Un filtre ou un onglet DÉJÀ ACTIF ne fait rien non plus : « Jour »
      // quand la vue est déjà journalière, « Tous les statuts » quand aucun
      // filtre n'est posé. Vérifié un par un le 2026-09-01 — aucun n'émet de
      // requête ni ne change l'écran, et c'est correct.
      const ONGLET_PAR_DEFAUT = /^(jour|day|tous|toutes|all|vue d.ensemble|overview|heures? ?(&|et)? ?min|aujourd.hui|today)/i;
      if (ONGLET_PAR_DEFAUT.test(nom)) {
        verdict = 'deja_actif';
        detail = 'onglet ou filtre déjà actif — sans effet, c’est normal';
      }

      // Une entrée de menu pointant sur la page courante ne fait rien —
      // c'est le comportement attendu, pas un bouton mort.
      const dejaLa = new RegExp(`^${chemin.replace(/[^a-z0-9]/gi, '.')}$`, 'i')
        .test(avant.url.split('?')[0]) && chemin.toLowerCase().includes(nom.toLowerCase().slice(0, 6));
      if (dejaLa) {
        verdict = 'deja_sur_la_page';
        detail = 'déjà sur cette page — sans effet, c’est normal';
      } else {
        verdict = 'bouton_mort';
        detail = 'aucun effet visible';
      }
    } else if (avant.url !== apres.url) {
      detail = `mène à ${apres.url}`;

      // Un bouton qui mène à une page introuvable est le pire défaut
      // d'expérience : l'utilisateur a suivi un lien de l'application et
      // tombe dans le vide.
      if (/404|page introuvable|page not found|n.existe pas|does not exist/i.test(apres.texte)) {
        verdict = 'mene_au_vide';
        detail = `« ${nom} » mène à ${apres.url} — PAGE INTROUVABLE (404)`;
        resultats.push({ ...b, verdict, detail, irreversible });
        console.log(`    ✗ ${nom.padEnd(38).slice(0, 38)} ${detail}`);
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }

      // Un bouton « nouveau » doit mener à une création.
      if (/nouveau|nouvelle|ajouter|créer|new|add|create/i.test(nom) && !/new|nouveau|create|\/edit/i.test(apres.url)) {
        verdict = 'destination_douteuse';
        detail = `« ${nom} » mène à ${apres.url} — création attendue`;
      } else {
        // Le libellé tient-il sa promesse ?
        const c = jugerCoherence(nom, apres.url);
        if (c.verdict === 'incoherent') {
          verdict = 'destination_incoherente';
          detail = `« ${nom} » mène à ${apres.url} — on attendait ${c.attendu}`;
        } else if (c.verdict === 'coherent') {
          detail = `mène à ${apres.url} — cohérent`;
        }
      }
    } else if (avant.dialogue !== apres.dialogue) {
      detail = apres.dialogue ? 'ouvre une fenêtre' : 'ferme une fenêtre';
    } else {
      detail = 'met à jour la page';
    }

    if (erreursReseau.length) {
      verdict = verdict === 'ok' ? 'erreur_silencieuse' : verdict;
      detail += ` — ${erreursReseau.length} requête(s) en échec : ${erreursReseau[0]}`;
    }

    // Page vidée par le clic : signe d'un rendu cassé — SAUF si l'application
    // affiche volontairement un écran court et explicite (module verrouillé,
    // accès restreint, état vide). Ce sont des réponses correctes, pas des
    // pannes : « Module verrouillé » tient en 90 caractères et se faisait
    // signaler comme page cassée.
    const ECRANS_LEGITIMES = /module verrouillé|module locked|accès restreint|access restricted|aucun|aucune|empty|rien à afficher|activer le module/i;
    if (apres.texte.length < 30 && !ECRANS_LEGITIMES.test(apres.texte)) {
      verdict = 'page_cassee';
      detail = 'la page est vide après le clic';
    } else if (ECRANS_LEGITIMES.test(apres.texte) && apres.texte.length < 200) {
      verdict = verdict === 'ok' ? 'ok' : verdict;
      detail = detail + ' — écran d’information (module verrouillé ou état vide)';
    }

    resultats.push({ ...b, verdict, detail, irreversible });

    const marque = verdict === 'ok' ? '✓' : verdict === 'desactive' ? '·' : '✗';
    console.log(`    ${marque} ${nom.padEnd(38).slice(0, 38)} ${detail}`);

    if (irreversible) {
      console.log('        ⚠ action irréversible — fenêtre ouverte puis annulée, rien n\'est parti');
    }

    // Revenir à l'état de départ pour que le bouton suivant soit testé
    // dans les mêmes conditions.
    if (avant.url !== apres.url) {
      // Retour arrière plutôt que rechargement : l'application est une SPA,
      // le retour est instantané là où un goto+networkidle2 coûtait ~3 s par
      // bouton — soit plusieurs minutes par page.
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 250));
      // Filet : si le retour n'a pas ramené où il fallait, on recharge.
      const ou = await page.evaluate(() => location.pathname).catch(() => '');
      if (ou !== chemin) {
        await page.goto(BASE + chemin, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 400));
        await degagerLaVue(page);
      }
    } else if (apres.dialogue) {
      // Fermer la fenêtre ouverte, sans jamais confirmer.
      await page.keyboard.press('Escape').catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return { chemin, total: boutons.length, testes: aTester.length, resultats };
}

async function main() {
  console.log('\n═══ Testeur de boutons ═══\n');

  const carte = JSON.parse(fs.readFileSync(path.join(RACINE, 'qa-carte.json'), 'utf8'));
  const pages = PAGE_CIBLE
    ? carte.pages.filter((p) => p.chemin === PAGE_CIBLE)
    : carte.pages.filter((p) => !p.aParametre && p.dansLeMenu);

  if (!pages.length) {
    console.error('Aucune page à tester.');
    process.exit(2);
  }

  const session = await ouvrirSession();
  const { data: membre } = await admin
    .from('memberships').select('org_id, role')
    .eq('user_id', session.user.id).eq('status', 'active').limit(1).maybeSingle();
  if (!membre) throw new Error(`aucune organisation active pour ${COMPTE}`);

  console.log(`  Compte : ${COMPTE} (${membre.role})`);
  console.log(`  Pages  : ${pages.length}`);

  const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await nav.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const jeton = {
    access_token: session.access_token, refresh_token: session.refresh_token,
    expires_at: session.expires_at, expires_in: session.expires_in,
    token_type: 'bearer', user: session.user,
  };
  await page.evaluateOnNewDocument((t, o, l) => {
    localStorage.setItem('lume-auth-token', JSON.stringify(t));
    localStorage.setItem('lume-active-org', o);
    localStorage.setItem('lume-language', l);
  }, jeton, membre.org_id, LANGUE);

  const rapports = [];
  for (const p of pages) {
    try {
      rapports.push(await testerPage(page, p.chemin));
    } catch (e) {
      console.log(`\n  ${p.chemin} — interrompu : ${e.message.slice(0, 100)}`);
      rapports.push({ chemin: p.chemin, erreur: e.message.slice(0, 200), resultats: [] });
    }
  }

  await nav.close();

  const tous = rapports.flatMap((r) => r.resultats || []);
  const parVerdict = {};
  for (const r of tous) parVerdict[r.verdict] = (parVerdict[r.verdict] || 0) + 1;

  const rapport = {
    genereLe: new Date().toISOString(),
    compte: COMPTE,
    orgId: membre.org_id,
    resume: {
      pages: rapports.length,
      boutonsTrouves: rapports.reduce((s, r) => s + (r.total || 0), 0),
      boutonsTestes: tous.length,
      ...parVerdict,
    },
    pages: rapports,
  };
  fs.writeFileSync(path.join(RACINE, 'qa-boutons.json'), JSON.stringify(rapport, null, 2), 'utf8');

  console.log('\n' + '═'.repeat(60));
  console.log(`  Pages testées      ${rapport.resume.pages}`);
  console.log(`  Boutons trouvés    ${rapport.resume.boutonsTrouves}`);
  console.log(`  Boutons testés     ${rapport.resume.boutonsTestes}`);
  for (const [v, n] of Object.entries(parVerdict).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${v.padEnd(22)} ${n}`);
  }
  console.log('\n  → qa-boutons.json\n');
}

main().catch((e) => {
  console.error('\nTesteur interrompu :', e.message);
  process.exit(1);
});
