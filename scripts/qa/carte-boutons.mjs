#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   L'inventaire des boutons — ce que le robot devra cliquer.

   POURQUOI
   « Tester tous les boutons » suppose de savoir combien il y en a.
   Sans ce décompte, impossible de dire si le robot en a oublié un.
   Cette carte donne, par page, le nombre d'éléments cliquables et
   de champs, et signale ceux qui demandent une précaution.

   CE QU'ELLE REPÈRE EN PLUS
     - les actions IRRÉVERSIBLES (rendre un numéro, rembourser,
       annuler un abonnement) : le robot ira jusqu'à la fenêtre de
       confirmation puis annulera ;
     - les actions destructives ordinaires (supprimer, archiver) :
       réversibles dans Lume, donc cliquables sans crainte ;
     - les libellés en dur, non traduits : ce sont des anomalies
       d'interface à rapporter au passage.

   Sortie : qa-carte-boutons.json

   Usage : npm run qa:carte-boutons
   ═══════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = process.cwd();

/* Actions dont l'effet sort de l'application et ne se rattrape pas.
   Repérées par ce que le code appelle, pas par le texte du bouton :
   un libellé peut mentir, un appel non. */
const IRREVERSIBLES = [
  { motif: /releaseExpiredSmsNumbers|release-sms-number|releaseSmsNumber/i, quoi: 'rendre un numéro de téléphone' },
  { motif: /refunds?\.create|createRefund|\/refund/i, quoi: 'rembourser un paiement' },
  { motif: /subscriptions?\.cancel|cancelSubscription|cancel_subscription/i, quoi: 'annuler un abonnement' },
];

/* Actions destructives mais réversibles : Lume met de côté (deleted_at)
   au lieu d'effacer. Le robot peut cliquer. */
const DESTRUCTIF_REVERSIBLE = /\b(delete|supprimer|archive|archiver|remove|retirer|desactiver|deactivate)\b/i;

function fichiersReact(dossier, acc = []) {
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const p = path.join(dossier, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(e.name)) continue;
      fichiersReact(p, acc);
    } else if (e.name.endsWith('.tsx')) {
      acc.push(p);
    }
  }
  return acc;
}

/* Extraction du libellé d'un bouton : soit du texte brut, soit un
   appel de traduction (t.quelque.chose). Sert au robot pour viser
   par texte visible, faute de data-testid dans le projet. */
function libelles(bloc) {
  const trouves = [];
  for (const m of bloc.matchAll(/>\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 ,.'!?%$-]{2,40})\s*</g)) {
    const t = m[1].trim();
    if (t && !/^(div|span|button|p|h[1-6])$/i.test(t)) trouves.push({ texte: t, traduit: false });
  }
  for (const m of bloc.matchAll(/\{\s*t\.([A-Za-z0-9_.]+)\s*\}/g)) {
    trouves.push({ cle: m[1], traduit: true });
  }
  return trouves;
}

const fichiers = fichiersReact(path.join(RACINE, 'src'));
const parFichier = [];
let totalCliquables = 0;
let totalChamps = 0;
const alertesIrreversibles = [];
const libellesEnDur = [];

for (const f of fichiers) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(RACINE, f).replace(/\\/g, '/');

  const boutons = (src.match(/<button\b/g) || []).length;
  const clics = (src.match(/onClick=/g) || []).length;
  const liens = (src.match(/<Link\b/g) || []).length;
  const champs = (src.match(/<input\b/g) || []).length;
  const listes = (src.match(/<select\b/g) || []).length;
  const zonesTexte = (src.match(/<textarea\b/g) || []).length;
  const bascules = (src.match(/type="checkbox"|type="radio"/g) || []).length;

  const cliquables = clics + liens;
  const saisies = champs + listes + zonesTexte;

  totalCliquables += cliquables;
  totalChamps += saisies;

  // Actions irréversibles présentes dans ce fichier.
  const dangers = [];
  for (const { motif, quoi } of IRREVERSIBLES) {
    if (motif.test(src)) dangers.push(quoi);
  }
  if (dangers.length) alertesIrreversibles.push({ fichier: rel, actions: dangers });

  // Libellés en dur dans les boutons : anomalie d'interface (app bilingue).
  // Deux pièges écartés ici :
  //   - le reste d'une expression JS quand la balise <button ...> tient sur
  //     plusieurs lignes (« setShowModal(true)}> ») : présence de ( ) { } ; = ;
  //   - les noms propres qui ne se traduisent PAS (Street View, Google, PDF…).
  const NOMS_PROPRES = /^(Street|Google|Stripe|PayPal|Twilio|PDF|CSV|Excel|SMS|GPS|URL|API|QR)$/i;
  for (const m of src.matchAll(/<button[^>]*>\s*([^<{}()=;]{3,40}?)\s*</g)) {
    const t = m[1].trim();
    if (!t || !/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 ,.'!?%$-]*$/.test(t)) continue;
    if (NOMS_PROPRES.test(t)) continue;
    libellesEnDur.push({ fichier: rel, texte: t });
  }

  if (cliquables || saisies) {
    parFichier.push({
      fichier: rel,
      cliquables,
      detail: { boutons, onClick: clics, liens, bascules },
      saisies,
      detailSaisies: { champs, listes, zonesTexte },
      actionsIrreversibles: dangers.length ? dangers : undefined,
      contientDestructifReversible: DESTRUCTIF_REVERSIBLE.test(src) || undefined,
    });
  }
}

parFichier.sort((a, b) => b.cliquables - a.cliquables);

const carte = {
  genereLe: new Date().toISOString(),
  resume: {
    fichiersAnalyses: fichiers.length,
    fichiersAvecInteraction: parFichier.length,
    elementsCliquables: totalCliquables,
    champsASaisir: totalChamps,
    fichiersAvecActionIrreversible: alertesIrreversibles.length,
    libellesEnDur: libellesEnDur.length,
  },
  // Ce que le robot ne poussera PAS jusqu'au bout : il ouvre la
  // confirmation, vérifie qu'elle dit vrai, puis annule.
  actionsIrreversibles: alertesIrreversibles,
  parFichier,
  libellesEnDur: libellesEnDur.slice(0, 100),
};

fs.writeFileSync(path.join(RACINE, 'qa-carte-boutons.json'), JSON.stringify(carte, null, 2), 'utf8');

console.log('\n═══ Inventaire des boutons ═══\n');
console.log(`  Fichiers analysés            ${carte.resume.fichiersAnalyses}`);
console.log(`  Fichiers avec interaction    ${carte.resume.fichiersAvecInteraction}`);
console.log('');
console.log(`  Éléments cliquables          ${carte.resume.elementsCliquables}`);
console.log(`  Champs à saisir              ${carte.resume.champsASaisir}`);
console.log('');
console.log(`  ⚠ Actions irréversibles      ${carte.resume.fichiersAvecActionIrreversible} fichier(s)`);
for (const a of alertesIrreversibles) {
  console.log(`      ${a.fichier}`);
  a.actions.forEach((x) => console.log(`        → ${x}`));
}
console.log('');
console.log(`  Libellés en dur (non traduits) ${carte.resume.libellesEnDur}`);
console.log('');
console.log('  Pages les plus chargées :');
parFichier.slice(0, 8).forEach((p) => {
  console.log(`    ${String(p.cliquables).padStart(4)} clics, ${String(p.saisies).padStart(3)} champs  ${p.fichier}`);
});
console.log('\n  → qa-carte-boutons.json\n');
