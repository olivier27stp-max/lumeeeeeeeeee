#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   LE RAPPORT — ce que le robot a trouvé, en français lisible.

   Rassemble les sorties des autres outils (exploration, boutons,
   audit de la base) en un seul document, classé par gravité :

     1. Cassé            — ne fonctionne pas
     2. Différent        — test et production divergent
     3. Chiffres faux    — l'écran ne dit pas ce qu'il y a en base
     4. À améliorer      — ergonomie et finition

   Usage : npm run qa:rapport
   ═══════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = process.cwd();
const lire = (nom) => {
  const p = path.join(RACINE, nom);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
};

const exploration = lire('qa-exploration.json');
const boutons = lire('qa-boutons.json');
const auditStaging = lire('qa-audit-base.json');
const auditProd = lire('qa-audit-base-prod.json');
const carte = lire('qa-carte.json');
const carteBoutons = lire('qa-carte-boutons.json');

const L = [];
const dateFr = new Date().toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });

L.push('# Rapport de recette — Lume');
L.push('');
L.push(`Passage du ${dateFr}.`);
L.push('');

/* ── Ce qui a été couvert ─────────────────────────────────────── */

L.push('## Ce qui a été passé au peigne fin');
L.push('');
if (carte) {
  L.push(`- **${carte.resume.pagesVisitables} pages** dans l'application, ${carte.resume.redirections} redirections`);
}
if (carteBoutons) {
  L.push(`- **${carteBoutons.resume.elementsCliquables} éléments cliquables** et ${carteBoutons.resume.champsASaisir} champs recensés`);
}
if (exploration) {
  L.push(`- **${exploration.resume.pagesVisitees} pages visitées** par le robot`);
}
if (boutons) {
  L.push(`- **${boutons.resume.boutonsTestes} boutons cliqués** un par un sur ${boutons.resume.pages} pages`);
}
L.push('');

/* ── 1. Cassé ─────────────────────────────────────────────────── */

L.push('## 1. Cassé');
L.push('');
const casses = [];

if (exploration) {
  for (const p of exploration.pages.filter((x) => x.anomalies?.length)) {
    // Une même panne produit deux lignes : « erreur console » et « requête en
    // échec ». On rapporte le fait, avec l'appel fautif — pas ses symptômes.
    const echec = p.requetesEchouees?.[0];
    if (echec) {
      const chemin = String(echec.url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      casses.push({ ou: p.chemin, quoi: `appel en échec ${echec.code} sur ${chemin}`, fichier: p.fichier });
      continue;
    }
    // La lenteur relève de « à améliorer », pas de « cassé ».
    const vraies = p.anomalies.filter((a) => !/chargement lent/i.test(a));
    for (const a of vraies) casses.push({ ou: p.chemin, quoi: a, fichier: p.fichier });
  }
}
if (boutons) {
  // Une même cause produit un signalement par bouton cliqué : la page Aperçu
  // rappelle Stripe à chaque rendu, donc un seul défaut ressortait huit fois.
  // On regroupe par cause pour que le rapport dise « un problème », pas huit.
  const parCause = new Map();

  for (const page of boutons.pages || []) {
    for (const r of page.resultats || []) {
      if (!['bouton_mort', 'page_cassee', 'erreur_silencieuse', 'destination_douteuse'].includes(r.verdict)) continue;

      // Une entrée de menu pointant sur la page où l'on est déjà ne fait rien :
      // c'est le comportement attendu.
      const nom = (r.texte || r.etiquette || '').toLowerCase();
      const ici = page.chemin.toLowerCase();
      if (r.verdict === 'bouton_mort' && nom.length > 3 && ici.includes(nom.slice(0, 5))) continue;

      // Un onglet déjà actif ne change rien non plus.
      if (r.verdict === 'bouton_mort' && /vue d.ensemble|overview|tous|all/i.test(nom)) continue;

      // La cause racine, pas le message : « mène à X — 403 sur /api/… » et
      // « met à jour la page — 403 sur /api/… » sont LE MÊME défaut vu depuis
      // deux boutons. On garde l'appel en échec, on jette le trajet.
      let cause = r.detail;
      const echec = cause.match(/(\d{3})\s+\S*?(\/api\/[a-z0-9/_-]+)/i);
      if (echec) {
        cause = `appel en échec ${echec[1]} sur ${echec[2]}`;
      } else {
        cause = cause.replace(/mène à \S+/, 'navigue').slice(0, 100);
      }
      const cle = `${r.verdict}|${cause}`;
      if (!parCause.has(cle)) parCause.set(cle, { verdict: r.verdict, cause, ou: new Set(), boutons: new Set() });
      const e = parCause.get(cle);
      e.ou.add(page.chemin);
      e.boutons.add(r.texte || r.etiquette);
    }
  }

  for (const e of parCause.values()) {
    const pages = [...e.ou];
    const nb = e.boutons.size;
    casses.push({
      ou: pages.length > 2 ? `${pages.length} pages` : pages.join(', '),
      quoi: `${e.cause}${nb > 1 ? `  *(vu sur ${nb} boutons — même cause)*` : ` — bouton « ${[...e.boutons][0]} »`}`,
    });
  }
}

// Le même défaut peut être vu par l'explorateur ET par le testeur de boutons.
const vus = new Set();
const uniques = casses.filter((c) => {
  // On dédoublonne sur l'appel en échec lui-même, pas sur la phrase :
  // « 403 sur /api/x » et « 403 sur /api/x — bouton Plus » sont le même défaut.
  const appel = c.quoi.match(/appel en échec \d{3} sur \S+/);
  const cle = appel ? appel[0] : c.quoi.replace(/\s+[—-]\s+bouton.*$/, '').replace(/\s+\*\(.*$/, '').trim();
  if (vus.has(cle)) return false;
  vus.add(cle);
  return true;
});
casses.length = 0;
casses.push(...uniques);

if (!casses.length) {
  L.push('Rien de cassé sur ce passage.');
} else {
  L.push(`${casses.length} constat(s) :`);
  L.push('');
  for (const c of casses) {
    L.push(`- **${c.ou}** — ${c.quoi}${c.fichier ? `  \n  *(${c.fichier})*` : ''}`);
  }
}
L.push('');

/* ── 2. Différences entre les deux environnements ─────────────── */

L.push('## 2. Différent entre test et production');
L.push('');
if (auditStaging && auditProd) {
  const ecarts = [];
  const a = new Set(auditProd.tablesVidesEtOrphelines || []);
  const b = new Set(auditStaging.tablesVidesEtOrphelines || []);
  const seulementProd = [...a].filter((x) => !b.has(x));
  const seulementStaging = [...b].filter((x) => !a.has(x));
  if (seulementProd.length) ecarts.push(`Tables vides en production seulement : ${seulementProd.join(', ')}`);
  if (seulementStaging.length) ecarts.push(`Tables vides en test seulement : ${seulementStaging.join(', ')}`);

  const fkProd = (auditProd.clesEtrangeresSansIndex || []).length;
  const fkStg = (auditStaging.clesEtrangeresSansIndex || []).length;
  if (fkProd !== fkStg) ecarts.push(`Clés étrangères sans index : ${fkProd} en production, ${fkStg} en test`);

  L.push(ecarts.length ? ecarts.map((e) => `- ${e}`).join('\n') : 'Les deux environnements concordent.');
} else {
  L.push('*Comparaison non disponible — lancer `npm run qa:audit-base` sur les deux environnements.*');
}
L.push('');

/* ── 3. Chiffres ──────────────────────────────────────────────── */

L.push('## 3. Chiffres incohérents');
L.push('');
L.push('Les sondes d\'intégrité de la base couvrent ce point :');
L.push('');
L.push('```');
L.push('npm run check:invariants            # sur test');
L.push('npm run check:invariants -- --prod  # sur production');
L.push('```');
L.push('');
L.push('Elles vérifient notamment que le total de chaque facture correspond');
L.push('à la somme de ses lignes, et qu\'aucune donnée d\'une organisation');
L.push('n\'est référencée par une autre.');
L.push('');

/* ── 4. À améliorer ───────────────────────────────────────────── */

L.push('## 4. À améliorer');
L.push('');
const ameliorer = [];

if (carteBoutons?.libellesEnDur?.length) {
  for (const l of carteBoutons.libellesEnDur) {
    ameliorer.push(`Libellé « ${l.texte} » écrit en dur dans ${l.fichier} — il ne se traduira pas`);
  }
}
if (exploration) {
  for (const p of exploration.pages || []) {
    if (p.dureeMs > 6000) {
      ameliorer.push(`**${p.chemin}** met ${(p.dureeMs / 1000).toFixed(1)} s à s'afficher`);
    }
  }
}
if (auditProd?.indexJamaisLus?.length) {
  const gros = auditProd.indexJamaisLus.filter((x) => !/^\d+ bytes|16 kB/.test(x.taille));
  if (gros.length) {
    ameliorer.push(`${gros.length} index n'ont jamais été lus (${gros.slice(0, 3).map((x) => x.idx).join(', ')}…) — à confirmer avant de les retirer`);
  }
}

L.push(ameliorer.length ? ameliorer.map((x) => `- ${x}`).join('\n') : 'Rien à signaler.');
L.push('');

/* ── Ce que le robot n'a pas testé ────────────────────────────── */

L.push('## Ce que ce passage ne couvre pas');
L.push('');
L.push('- Les pages qui demandent un identifiant (`/clients/:id`, `/jobs/:id`…) :');
L.push('  elles exigent de créer une donnée réelle au préalable.');
L.push('- Les pages publiques reçues par lien (signature de contrat, page de');
L.push('  paiement) : elles méritent leur propre passage, sans authentification.');
L.push('- Les rôles autres que propriétaire : le mécanisme de bascule est');
L.push('  désactivé en production, il faut de vrais comptes.');
L.push('');

const chemin = path.join(RACINE, 'qa-rapport.md');
fs.writeFileSync(chemin, L.join('\n'), 'utf8');

console.log('\n═══ Rapport ═══\n');
console.log(`  Cassé          ${casses.length}`);
console.log(`  À améliorer    ${ameliorer.length}`);
console.log(`\n  → qa-rapport.md\n`);
