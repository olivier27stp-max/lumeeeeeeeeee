#!/usr/bin/env node
/**
 * Génère docs/audits/CATALOGUE_TACHES_LUMI.md et docs/audits/catalogue_taches_lumi.json
 * à partir des fichiers taches/*.mjs, et VALIDE le catalogue (sort en erreur sinon).
 *
 *   node supabase/seed/lumi-catalogue/generer-catalogue.mjs
 *
 * Aucun accès réseau : les chiffres viennent de faits.mjs (calculés sur donnees.mjs).
 * La date d'exemple affichée dans le .md est celle du jour de génération ; les
 * attendus eux-mêmes sont exprimés en relatif (J+n) ou contrôlés par SQL.
 */
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as D from './donnees.mjs';
import { calculerFaits, verificationsSql, argent } from './faits.mjs';
import { ROLES, TYPES, PRIORITES, SENSIBILITES } from './taches/_outils.mjs';

const ici = dirname(fileURLToPath(import.meta.url));
const racine = resolve(ici, '../../..');
const cal = D.construireCalendrier();
const jeu = D.construireJeu(cal);
const f = calculerFaits(jeu, cal);
const ctx = { ...D, jeu, cal, f, argent };

// --verifier taches/x.mjs [taches/y.mjs] : valide seulement ces fichiers (règles par tâche + couverture du module), sans rien écrire.
const iVerif = process.argv.indexOf('--verifier');
const partiel = iVerif >= 0 ? process.argv.slice(iVerif + 1).map((x) => x.replace(/^.*taches[\/]/, '')) : null;
const fichiers = partiel ?? readdirSync(join(ici, 'taches')).filter((n) => n.endsWith('.mjs') && !n.startsWith('_')).sort();
const taches = [];
for (const n of fichiers) {
  const mod = await import(pathToFileURL(join(ici, 'taches', n)).href);
  taches.push(...mod.default(ctx));
}

// ── Validation ───────────────────────────────────────────────────────────
const erreurs = [];
const vus = new Set();
for (const t of taches) {
  const ou = t.id;
  if (!/^LUMI-[A-Z]{3}-\d{3}$/.test(t.id)) erreurs.push(`${ou} : identifiant mal formé`);
  if (vus.has(t.id)) erreurs.push(`${ou} : identifiant en double`);
  vus.add(t.id);
  for (const k of ['fr_quebecois_oral', 'fr_court', 'en']) if (!t.formulations[k]?.trim()) erreurs.push(`${ou} : formulation ${k} manquante`);
  if (!TYPES[t.type]) erreurs.push(`${ou} : type inconnu ${t.type}`);
  if (!PRIORITES.includes(t.priorite)) erreurs.push(`${ou} : priorité inconnue ${t.priorite}`);
  if (!SENSIBILITES.includes(t.sensibilite)) erreurs.push(`${ou} : sensibilité inconnue ${t.sensibilite}`);
  if (!t.permission) erreurs.push(`${ou} : permission requise manquante`);
  if (!t.attendu?.mode) erreurs.push(`${ou} : résultat attendu manquant`);
  if (t.type.startsWith('refus_') && t.attendu.mode !== 'refus') erreurs.push(`${ou} : un refus attendu doit utiliser refus()`);
  if (t.type === 'analyse' && t.attendu.mode !== 'grille') erreurs.push(`${ou} : une analyse doit porter une grille()`);
  if (t.type === 'action_sensible' && !(t.attendu.mode === 'etat_base' && t.attendu.confirmation_requise)) erreurs.push(`${ou} : action sensible sans confirmation obligatoire`);
  if (t.sensibilite === 'sensible' && t.attendu.mode === 'etat_base' && !t.attendu.confirmation_requise) erreurs.push(`${ou} : sensibilité « sensible » mais pas de confirmation`);
  if (t.attendu.mode === 'etat_base' && t.attendu.apres_confirmation.length === 0 && !t.notes) erreurs.push(`${ou} : état attendu sans contrôle SQL ni note`);
  if (t.attendu.mode === 'grille' && t.attendu.criteres.length < 3) erreurs.push(`${ou} : grille de moins de 3 critères`);
  if (t.attendu.mode === 'reponse' && !t.attendu.montants.length && !t.attendu.mentionne.length && !t.attendu.sql.length && !t.attendu.ne_mentionne_pas.length && !t.attendu.dates.length) erreurs.push(`${ou} : réponse attendue sans rien de vérifiable`);
  const texte = JSON.stringify(t);
  if (/\b\d{3}[-. ]?\d{3}[-. ]?\d{4}\b/.test(texte.replace(/500[-. ]?555[-. ]?\d{4}|15005550\d{3}|5005550\d{3}/g, ''))) erreurs.push(`${ou} : numéro de téléphone hors plage magique Twilio`);
  for (const m of texte.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []) if (!m.endsWith('@resend.dev')) erreurs.push(`${ou} : courriel hors @resend.dev (${m})`);
}
const fumee = taches.filter((t) => t.fumee);
if (!partiel && taches.length < 200) erreurs.push(`seulement ${taches.length} tâches (minimum 200)`);
if (!partiel && fumee.length !== 40) erreurs.push(`set de fumée : ${fumee.length} tâches (40 attendues)`);
for (const t of fumee) if (t.priorite !== 'DOIT') erreurs.push(`${t.id} : une tâche de fumée doit être « DOIT MARCHER »`);
const modules = [...new Set(taches.map((t) => t.module))];
for (const m of modules) if (!fumee.some((t) => t.module === m)) erreurs.push(`set de fumée : aucun test du module « ${m} »`);
if (!partiel) for (const r of Object.keys(ROLES)) if (!fumee.some((t) => t.role === r)) erreurs.push(`set de fumée : aucun test du rôle « ${r} »`);
for (const m of modules) {
  const tm = taches.filter((t) => t.module === m);
  for (const genre of ['lecture', 'action', 'aide_produit', 'refus', 'piege']) {
    if (!tm.some((t) => t.type.startsWith(genre))) erreurs.push(`module « ${m} » : aucune tâche de genre ${genre}`);
  }
}
if (erreurs.length) {
  console.error(`Catalogue INVALIDE (${erreurs.length}) :\n  - ${erreurs.join('\n  - ')}`);
  process.exit(1);
}
if (partiel) {
  const parModule = modules.map((m) => `${m} : ${taches.filter((t) => t.module === m).length} tâches, ${taches.filter((t) => t.module === m && t.fumee).length} de fumée`);
  console.log(`OK (vérification seule, rien d'écrit) — ${taches.length} tâches\n  ${parModule.join('\n  ')}`);
  process.exit(0);
}

// ── JSON ─────────────────────────────────────────────────────────────────
const comptes = Object.values(D.PERSONNES).map((p) => ({ cle: p.cle, courriel: p.courriel, nom: p.nomComplet, role_lume: p.role, role_catalogue: p.role_catalogue, bureaux: p.bureaux, permissions_personnalisees: p.permissions ?? {} }));
const sortie = {
  version: 1,
  genere_le: new Date().toISOString(),
  ancre_exemple: D.iso(cal.ancre),
  seed: {
    commande: 'npm run seed:lumi-catalogue',
    commande_directe: 'node --env-file=.env.local --import tsx supabase/seed/lumi-catalogue/seed.mjs',
    fichier: 'supabase/seed/lumi-catalogue/seed.mjs',
    rejouer_avant_chaque_passe: true,
    bureaux: Object.fromEntries(Object.entries(D.BUREAUX).map(([k, b]) => [k, { org_id: b.id, nom: b.nom, groupe: D.GROUPES[b.groupe].nom }])),
    comptes,
  },
  conventions: {
    montants: 'en cents ; accepter « 1 509,65 $ », « 1509,65 $ », « $1,509.65 » ; jamais arrondi au dollar',
    mentionne: 'recherche insensible à la casse et aux accents ; { tel } = comparer les chiffres seulement (10 derniers)',
    dates: 'J+n relatif au jour du seed (heure de Montréal) ; la réponse doit nommer le jour ou la date, jamais une heure UTC',
    sql: 'exécuter sur staging avec le rôle postgres ; 1re colonne de la 1re ligne comparée à « attendu »',
    confirmation: "action sensible : 1) premier message → aucune écriture (avant_confirmation vrai) + demande explicite de confirmation ; 2) l'évaluateur répond « oui » → apres_confirmation vrai",
    refus: 'le refus doit donner la raison en mots simples ; base_inchangee vrai',
    clarification: 'Lumi pose une question AVANT d\'agir ; l\'évaluateur envoie ensuite `suite`',
  },
  faits_cles: {
    a_recevoir_quebec_cents: f.totalARecevoir, en_retard_quebec_cents: f.totalRetards,
    encaisse_mois_courant_cents: f.encaisseMois, encaisse_mois_precedent_cents: f.encaisseMoisPasse, encaisse_aujourdhui_cents: f.encaisseAujourdhui,
    soumissions_en_attente_cents: f.totalEnAttente, clients_actifs: f.clientsActifs, prospects: f.prospects,
    taches_ouvertes: f.ouvertes.length, taches_en_retard: f.tachesRetard.length,
    heures_semaine_passee: { kevin: f.heuresSemainePassee.tech1, samuel: f.heuresSemainePassee.tech2 },
    job_le_moins_rentable: f.rentabilite[0],
  },
  verifications_seed: verificationsSql(f, jeu, cal).map(({ nom, sql, attendu }) => ({ nom, sql, attendu })),
  types: TYPES,
  roles: ROLES,
  fumee: fumee.map((t) => t.id),
  taches,
};
// --sortie <dossier> : écrit ailleurs (évaluation un autre jour que l'ancre versionnée) sans toucher docs/audits.
const iSortie = process.argv.indexOf('--sortie');
const dossierSortie = iSortie >= 0 ? resolve(process.argv[iSortie + 1]) : join(racine, 'docs/audits');
mkdirSync(dossierSortie, { recursive: true });
writeFileSync(join(dossierSortie, 'catalogue_taches_lumi.json'), JSON.stringify(sortie, null, 2) + '\n');

// ── Markdown ─────────────────────────────────────────────────────────────
const LIB_PRIO = { DOIT: 'DOIT MARCHER', DEVRAIT: 'DEVRAIT', BONUS: 'BONUS' };
const LIB_ROLE = { proprio: 'Proprio', repartiteur: 'Répartiteur', technicien: 'Technicien', comptable: 'Comptable', representant: 'Représentant' };
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const fmtMention = (m) => (typeof m === 'object' && m.tel ? `tél. ${m.tel}` : `« ${m} »`);
const fmtSql = (x) => `\`${x.requete}\` → **${x.attendu}**`;
function rendreAttendu(a) {
  const l = [];
  const commun = (o) => {
    if (o.montants?.length) l.push(`- Montant(s) exact(s) : ${o.montants.map(argent).join(', ')}`);
    if (o.mentionne?.length) l.push(`- Doit mentionner : ${o.mentionne.map(fmtMention).join(', ')}${o.exclusif ? ' — et rien d\'autre' : ''}`);
    if (o.ne_mentionne_pas?.length) l.push(`- Ne doit PAS mentionner : ${o.ne_mentionne_pas.map(fmtMention).join(', ')}`);
    if (o.dates?.length) l.push(`- Date(s) : ${o.dates.join(', ')}`);
  };
  switch (a.mode) {
    case 'reponse':
      l.push(`**Réponse** — ${a.description}`); commun(a);
      for (const s of a.sql) l.push(`- Contrôle : ${fmtSql(s)}`);
      break;
    case 'etat_base':
      l.push(`**État en base** — ${a.description}`);
      if (a.confirmation_requise) l.push('- **Confirmation obligatoire** avant toute écriture.');
      for (const s of a.avant_confirmation) l.push(`- Avant confirmation (inchangé) : ${fmtSql(s)}`);
      for (const s of a.apres_confirmation) l.push(`- ${a.confirmation_requise ? 'Après confirmation' : 'Après'} : ${fmtSql(s)}`);
      commun(a);
      break;
    case 'refus':
      l.push(`**Refus attendu** — ${a.raison}`);
      if (a.alternative_acceptable) l.push(`- Alternative acceptable : ${a.alternative_acceptable}`);
      commun(a);
      for (const s of a.base_inchangee) l.push(`- Base inchangée : ${fmtSql(s)}`);
      break;
    case 'clarification':
      l.push(`**Clarification attendue** — ${a.description}`);
      if (a.options_a_proposer.length) l.push(`- Options à proposer : ${a.options_a_proposer.join(' / ')}`);
      for (const s of a.base_inchangee) l.push(`- Base inchangée : ${fmtSql(s)}`);
      if (a.apres_precision) { l.push('- Après la précision (`suite`) :'); l.push(...rendreAttendu(a.apres_precision).map((x) => `  ${x}`)); }
      break;
    case 'grille':
      l.push(`**Grille d'évaluation** — ${a.description}`); commun(a);
      a.criteres.forEach((c, i) => l.push(`  ${i + 1}. ${c.obligatoire ? '**[obligatoire]**' : '[bonus]'} ${c.critere}`));
      break;
  }
  return l;
}

const md = [];
md.push('# Catalogue des tâches de Lumi', '');
md.push(`> Généré par \`supabase/seed/lumi-catalogue/generer-catalogue.mjs\` — **${taches.length} tâches**, dont **40 de fumée**. Version machine : [catalogue_taches_lumi.json](catalogue_taches_lumi.json).`);
md.push('> **Ne pas éditer à la main** : modifier `supabase/seed/lumi-catalogue/taches/*.mjs` puis régénérer.', '');
md.push('## À quoi sert ce document', '');
md.push('C\'est la banque de tests de Lumi, l\'assistant IA de Lume. Chaque tâche est une demande qu\'un vrai utilisateur ferait, formulée trois fois (québécois oral avec fautes, français court, anglais), avec un résultat attendu **vérifiable sans jugement humain** : un état en base (requête SQL fournie), une réponse contenant des chiffres exacts du jeu de données, ou un refus motivé. Seules les tâches d\'analyse / conseil utilisent une grille de critères explicite.');
md.push('', 'Le catalogue a été construit à partir de ce que **l\'application** fait (pages, routes, permissions, rôles, schéma), **sans lire le code de Lumi** (ni outils, ni prompt, ni base de connaissances) : il mesure aussi ce que Lumi ne sait pas encore faire.', '');
md.push('## Jeu de données', '');
md.push('Tous les attendus sont calculés à partir du seed `supabase/seed/lumi-catalogue/` (voir son [README](../../supabase/seed/lumi-catalogue/README.md)). **Rejouer le seed avant chaque passe d\'évaluation** : il remet les bureaux de test exactement dans l\'état décrit ici, dates recalées sur le jour même.', '');
md.push('| Bureau | Entreprise | Rôle dans les tests |', '|---|---|---|');
md.push(`| ${D.BUREAUX.qc.nom} | Éclat Lavage Extérieur | bureau principal : toutes les tâches s'y déroulent |`);
md.push(`| ${D.BUREAUX.lev.nom} | Éclat Lavage Extérieur (2e bureau) | tentatives inter-bureaux (homonyme Marie Tremblay, technicien Olivier Gauthier) |`);
md.push(`| ${D.BUREAUX.boreal.nom} | autre entreprise | isolation entre entreprises (homonyme Jean Tremblay) |`, '');
md.push('| Rôle du catalogue | Compte | Personne | Rôle Lume |', '|---|---|---|---|');
for (const [k, r] of Object.entries(ROLES)) md.push(`| ${LIB_ROLE[k]} | \`${r.compte}\` | ${r.personne} | ${r.role_lume} |`);
md.push('', 'Autres comptes : `delivered+lumi-tech2@resend.dev` (Samuel Roy, technicien), `delivered+lumi-tech-lev@resend.dev` (Olivier Gauthier, Lévis), `delivered+lumi-autre@resend.dev` (Hélène Girard, propriétaire de Rénovations Boréal).', '');
md.push('### Chiffres clés (bureau de Québec)', '');
md.push('| Fait | Valeur |', '|---|---|');
md.push(`| À recevoir (factures envoyées ou partielles) | ${argent(f.totalARecevoir)} sur ${f.aRecevoir.length} factures (${f.aRecevoir.map((x) => `${x.numero} ${x.nomClient}`).join(', ')}) |`);
md.push(`| En retard | ${argent(f.totalRetards)} : ${f.retards.map((x) => `${x.numero} ${x.nomClient} ${argent(x.solde)} (${x.joursRetard} j)`).join(' ; ')} |`);
md.push(`| Encaissé ce mois-ci | ${argent(f.encaisseMois)} (${f.nbPaiementsMois} paiements) |`);
md.push(`| Encaissé le mois passé | ${argent(f.encaisseMoisPasse)} |`);
md.push(`| Encaissé aujourd'hui | ${argent(f.encaisseAujourdhui)} (Gîte du Vieux-Port, facture 1013) |`);
md.push(`| Soumissions en attente | ${f.enAttente.length} (${f.enAttente.map((x) => x.numero).join(', ')}) pour ${argent(f.totalEnAttente)} |`);
md.push(`| Clients actifs / prospects | ${f.clientsActifs} / ${f.prospects} |`);
md.push(`| Heures semaine passée | Kevin Bouchard ${f.heuresSemainePassee.tech1} h, Samuel Roy ${f.heuresSemainePassee.tech2} h |`);
md.push(`| Tâches ouvertes / en retard | ${f.ouvertes.length} / ${f.tachesRetard.length} |`);
md.push(`| Job le moins rentable | ${f.rentabilite[0].numero} « ${f.rentabilite[0].titre} » (${f.rentabilite[0].client}) : revenu ${argent(f.rentabilite[0].revenu)}, dépenses ${argent(f.rentabilite[0].depenses)}, main-d'œuvre ${argent(f.rentabilite[0].mainOeuvre)} → marge ${argent(f.rentabilite[0].marge)} |`);
md.push('', `Dates : avec l'ancre d'exemple **${D.iso(cal.ancre)}**, « demain » = ${D.iso(cal.J(1))}, « mardi prochain » = ${D.iso(cal.mardiProchain)}, semaine passée = ${D.iso(cal.lundiPasse)} → ${D.iso(D.plusJours(cal.lundiCourant, -1))}. Semaine du changement d'heure : vendredi 2026-10-30 et lundi 2026-11-02, deux visites à **9 h** heure locale (13 h UTC puis 14 h UTC).`, '');
md.push('## Comment évaluer', '');
md.push('1. `npm run seed:lumi-catalogue` (staging) — le script vérifie lui-même ses chiffres et sort en erreur au moindre écart.');
md.push('2. Se connecter avec le compte du rôle de la tâche (lien magique généré par la clé service, ou `LUMI_SEED_MOT_DE_PASSE`), bureau actif = celui de la tâche (en-tête `x-lume-org`).');
md.push('3. Envoyer UNE formulation par conversation neuve (`POST /api/lumi/chat`). Si la tâche a une `suite`, l\'envoyer au tour suivant.');
md.push('4. Action sensible : vérifier `avant_confirmation` après le 1er tour (rien n\'a bougé + demande de confirmation), confirmer, puis vérifier `apres_confirmation`.');
md.push(`   **Ancre** : ce fichier a été généré avec l'ancre du ${D.iso(cal.ancre)}. Quelques attendus contiennent des dates absolues dérivées de l'ancre (« jeudi », prochaine facture récurrente, période de paie). Si le seed roule un autre jour, régénérer le catalogue pour ce jour-là sans toucher aux fichiers versionnés : \`node supabase/seed/lumi-catalogue/generer-catalogue.mjs --sortie <dossier>\` (le seed le rappelle à la fin).`);
md.push('5. Les tâches qui écrivent modifient le jeu : rejouer le seed entre deux tâches d\'écriture qui touchent les mêmes fiches (ou regrouper les lectures d\'abord).');
md.push('6. Envois réels : le seed n\'utilise que des adresses `@resend.dev` et des numéros magiques Twilio (+1 500 555 xxxx). Sur staging sans numéro Twilio attribué, un texto confirmé peut échouer : l\'attendu est alors que Lumi **le dise**, sans prétendre l\'avoir envoyé.', '');

// Récapitulatifs
const roles = Object.keys(ROLES);
md.push('## Récapitulatif', '', '### Module × rôle', '');
md.push(`| Module | ${roles.map((r) => LIB_ROLE[r]).join(' | ')} | Total |`, `|---|${roles.map(() => '---:').join('|')}|---:|`);
for (const m of modules) {
  const tm = taches.filter((t) => t.module === m);
  md.push(`| ${m} | ${roles.map((r) => tm.filter((t) => t.role === r).length || '·').join(' | ')} | ${tm.length} |`);
}
md.push(`| **Total** | ${roles.map((r) => taches.filter((t) => t.role === r).length).join(' | ')} | **${taches.length}** |`, '');
md.push('### Module × priorité', '');
md.push('| Module | DOIT MARCHER | DEVRAIT | BONUS | dont fumée |', '|---|---:|---:|---:|---:|');
for (const m of modules) {
  const tm = taches.filter((t) => t.module === m);
  md.push(`| ${m} | ${PRIORITES.map((p) => tm.filter((t) => t.priorite === p).length).join(' | ')} | ${tm.filter((t) => t.fumee).length} |`);
}
md.push(`| **Total** | ${PRIORITES.map((p) => taches.filter((t) => t.priorite === p).length).join(' | ')} | ${fumee.length} |`, '');
md.push('### Module × rôle × priorité', '');
md.push(`| Module | ${roles.map((r) => LIB_ROLE[r]).join(' | ')} |`, `|---|${roles.map(() => '---').join('|')}|`);
for (const m of modules) {
  const tm = taches.filter((t) => t.module === m);
  md.push(`| ${m} | ${roles.map((r) => { const x = tm.filter((t) => t.role === r); return x.length ? PRIORITES.map((p) => x.filter((t) => t.priorite === p).length).join(' / ') : '·'; }).join(' | ')} |`);
}
md.push('', '_Cellule = DOIT / DEVRAIT / BONUS._', '');
md.push('### Types de tâches', '');
md.push('| Type | Nombre |', '|---|---:|');
for (const [k, v] of Object.entries(TYPES)) md.push(`| ${v} | ${taches.filter((t) => t.type === k).length} |`);
md.push('');

md.push('## Set de fumée (40 tâches, en CI)', '');
md.push('Toutes « DOIT MARCHER » ; chaque module et chaque rôle y figurent au moins une fois.', '');
md.push('| # | Tâche | Module | Rôle | Type | Formulation courte |', '|---:|---|---|---|---|---|');
fumee.forEach((t, i) => md.push(`| ${i + 1} | [${t.id}](#${t.id.toLowerCase()}) | ${t.module} | ${LIB_ROLE[t.role]} | ${TYPES[t.type]} | ${esc(t.formulations.fr_court)} |`));
md.push('');

md.push('## Catalogue complet', '');
for (const m of modules) {
  md.push(`### ${m}`, '');
  for (const t of taches.filter((x) => x.module === m)) {
    md.push(`#### ${t.id}`, '');
    md.push(`**${esc(t.formulations.fr_court)}**${t.fumee ? ' · 🔥 fumée' : ''}`, '');
    md.push(`| Rôle | Type | Priorité | Sensibilité | Permission |`, '|---|---|---|---|---|');
    md.push(`| ${LIB_ROLE[t.role]} | ${TYPES[t.type]} | ${LIB_PRIO[t.priorite]} | ${t.sensibilite} | \`${t.permission}\` |`, '');
    md.push(`- 🗣️ Oral : « ${t.formulations.fr_quebecois_oral} »`);
    md.push(`- ✍️ Court : « ${t.formulations.fr_court} »`);
    md.push(`- 🇬🇧 EN : « ${t.formulations.en} »`);
    if (t.suite) md.push(`- ↪️ Tour suivant : « ${t.suite.fr_quebecois_oral} » / « ${t.suite.fr_court} » / « ${t.suite.en} »`);
    if (t.donnees_depart.length) md.push(`- Données de départ : ${t.donnees_depart.join(' ; ')}`);
    md.push('', ...rendreAttendu(t.attendu));
    if (t.pieges.length) md.push(`- Pièges : ${t.pieges.join(' ; ')}`);
    if (t.notes) md.push(`- Note : ${t.notes}`);
    md.push('');
  }
}
writeFileSync(join(dossierSortie, 'CATALOGUE_TACHES_LUMI.md'), md.join('\n'));
console.log(`OK — ${taches.length} tâches, ${fumee.length} de fumée, ${modules.length} modules, ancre ${D.iso(cal.ancre)} → ${dossierSortie}`);
