// Construit sorties/declencheurs/couverture.md SANS rien exécuter : lit les titres des tests dans les specs,
// et leur dernier état CONNU (table ETATS ci-dessous, tenue à la main d'après les passes du 2026-10-01).
//   node couverture-statique.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const SPECS = 'D:/lume-uiaudit/wt/e2e/automations/declencheurs';
const SORTIES = 'D:/lume-uiaudit/sorties/declencheurs';

// ── Le catalogue attendu (noms des déclencheurs, pour développer les tests paramétrés) ──
const cat = readFileSync(`${SPECS}/_catalogue.ts`, 'utf8');
const DECL = [...cat.matchAll(/d\('(DEC-\d\d)', '([a-z_.]+)', '([^']+)'/g)].map((m) => ({ id: m[1], cle: m[2], fr: m[3] }));
if (DECL.length !== 28) throw new Error(`catalogue : ${DECL.length} déclencheurs lus (28 attendus)`);

// ── Les titres ──
const tests = [];
for (const f of readdirSync(SPECS).filter((x) => x.endsWith('.spec.ts')).sort()) {
  const src = readFileSync(`${SPECS}/${f}`, 'utf8');
  for (const m of src.matchAll(/^\s*test\((['`])((?:\\.|(?!\1).)*)\1,/gm)) {
    const titre = m[2].replace(/\\'/g, "'");
    if (f.startsWith('02-')) {
      for (const d of DECL) tests.push({ f, titre: titre.replace('${decl.id}', d.id).replace('${decl.fr}', d.fr) });
    } else if (f.startsWith('03-') && titre.includes('${t.libelle}')) {
      for (const l of ['QA Texte', 'QA Courriel', 'QA Site web', 'QA Nombre', 'QA Montant', 'QA Liste', 'QA Choix multiples', 'QA Date', 'QA Case']) {
        tests.push({ f, titre: titre.replace('${t.libelle}', l) });
      }
    } else if (f.startsWith('04-') && titre.includes('${famille}')) {
      const FAM = [
        ['texte (ligne simple)', '[EDT-090]', 'est, n’est pas, contient, ne contient pas, est vide, n’est pas vide'],
        ['nombre et montant', '[EDT-091][EDT-092]', '=, ≠, plus grand que, plus petit que, entre, est vide, n’est pas vide'],
        ['liste (simple et choix multiples)', '[EDT-093]', 'est l’un de, n’est aucun de, est vide, n’est pas vide'],
        ['date', '[EDT-094][EDT-095][EDT-096][EDT-097]', 'aujourd’hui, hier, dans les derniers, il y a plus de, il y a moins de, avant le, après le, entre, est vide, n’est pas vide'],
        ['case à cocher', '[EDT-089]', 'est'],
        ['fichier', '', 'est vide, n’est pas vide'],
      ];
      for (const [fam, ids, ops] of FAM) {
        tests.push({ f, titre: titre.replace('${ids}', ids).replace('${famille}', fam).replace(/\$\{\[\.\.\.new Set\(cas\.map\(\(c\) => c\.libelle\)\)\]\.join\(', '\)\}/, ops) });
      }
    } else {
      tests.push({ f, titre });
    }
  }
}

// ── Dernier état connu ──
const VERT = (quand) => `vert (exécuté le 2026-10-01, ${quand})`;
const PANNE = 'rouge — panne ou lenteur de staging, à relancer';
const ETATS = [
  // [fragment du titre, état]
  ['[EDT-057] la recherche filtre', VERT('passe 1')],
  ['[DEC-03]', VERT('passe 1')],
  ['[DEC-28][EDT-058][EDT-068][EDT-074]', VERT('essai avant la panne')],
  ['[EDT-057] à l’ouverture du tiroir', 'rouge — défaut produit → declencheurs-04'],
  ['[EDT-056] Échap', 'rouge — défaut produit → declencheurs-05'],
  ['[EDT-032] un déclencheur que le bureau n’a pas', 'rouge — défaut produit → declencheurs-06'],
  ['[EDT-058] deux choix rapprochés', `${PANNE} (défaut observé en exploration → declencheurs-02)`],
  ['[EDT-058] pendant que le changement', `${PANNE} (défaut observé en exploration → declencheurs-03)`],
  ['[EDT-032][EDT-058][EDT-063] la carte « Quand »', PANNE],
  ['[EDT-056] « Fermer »', PANNE],
  ['[EDT-058] rechoisir', PANNE],
  ['[EDT-029][EDT-030][EDT-058] canevas vide', PANNE],
  ['[EDT-058] avec les drapeaux actifs', PANNE],
  ['[DEC-01][EDT-058]', PANNE],
  ['[DEC-02][EDT-058][EDT-068][EDT-074]', PANNE],
  ['[DEC-24][EDT-058][EDT-068][EDT-074]', PANNE],
  ['passer de « Date atteinte » réglée à « Devis envoyé »', 'écrit, jamais exécuté (défaut observé en exploration → declencheurs-01)'],
  ['passer par « Devis ouvert par le client » puis choisir « Nouveau prospect »', 'écrit, jamais exécuté (défaut observé en exploration → declencheurs-01)'],
  ['ne réécrit pas les clés d’un ancien déclencheur', 'écrit, jamais exécuté (défaut observé en exploration → declencheurs-01)'],
  ['« Quand déclencher » : l’option vide', 'écrit, jamais exécuté (libellé observé en exploration → declencheurs-07)'],
];
const etatDe = (t) => ETATS.find(([frag]) => t.titre.includes(frag))?.[1] ?? 'écrit, jamais exécuté';
for (const t of tests) t.etat = etatDe(t);

// ── Les ID du lot ──
const LOT = [
  ['EDT-018', 'interrupteur de publication — seulement pour le refus d’un déclencheur incomplet'],
  ['EDT-022', 'lien d’un problème dans le bandeau rouge — problème du déclencheur'],
  ['EDT-029', '« Choisir le déclencheur » (canevas vide)'], ['EDT-030', '« Régler le déclencheur » (canevas vide)'],
  ['EDT-032', 'carte « Quand »'], ['EDT-056', 'tiroir — Fermer'], ['EDT-057', 'tiroir — recherche'], ['EDT-058', 'tiroir — item déclencheur'],
  ['EDT-060', 'tiroir — Attendre'], ['EDT-061', 'tiroir — Condition'], ['EDT-062', 'tiroir — Arrêter ici'], ['EDT-063', 'tiroir — item désactivé (déclencheur « bientôt »)'],
  ['EDT-064', 'panneau déclencheur — Fermer'], ['EDT-065', 'Changer de déclencheur…'], ['EDT-066', 'Quel champ'], ['EDT-067', 'Quand il devient'],
  ['EDT-068', 'champs du déclencheur'], ['EDT-069', 'compteur « Client inactif »'], ['EDT-070', 'section Filtres'], ['EDT-071', 'case « Arrêter si… »'],
  ['EDT-072', 'avertissement « Sans … »'], ['EDT-073', 'Annuler'], ['EDT-074', 'Enregistrer'],
  ['EDT-076', 'champ « choix »'], ['EDT-077', 'champ « nombre »'], ['EDT-081', 'champ « étape de pipeline »'], ['EDT-082', 'champ « champ date »'],
  ['EDT-083', 'champ « service »'], ['EDT-084', 'champ « étiquette »'],
  ['EDT-087', 'conditions — Champ'], ['EDT-088', 'conditions — Opérateur'], ['EDT-089', 'conditions — valeur d’une case'], ['EDT-090', 'conditions — valeur texte'],
  ['EDT-091', 'conditions — valeur numérique'], ['EDT-092', 'conditions — deuxième valeur'], ['EDT-093', 'conditions — options d’une liste'],
  ['EDT-094', 'conditions — nombre d’une durée'], ['EDT-095', 'conditions — unité'], ['EDT-096', 'conditions — date'], ['EDT-097', 'conditions — deuxième date'],
  ['EDT-098', 'Retirer la condition'], ['EDT-099', 'Ajouter une condition'],
  ['EDT-107', 'saisie selon le type du champ (« Quand il devient »)'],
  ['EDT-118', 'Attendre — nombre'], ['EDT-119', 'Attendre — unité'], ['EDT-120', 'Attendre — ce qu’on attend'],
  ['EDT-121', 'exemple `statut = `'], ['EDT-122', 'exemple `source = `'], ['EDT-123', 'exemple `total_cents > `'], ['EDT-124', 'exemple `created_at >= `'],
  ['EDT-125', 'zone « Conditions »'], ['EDT-127', 'conditions de champs de l’étape « Si… »'],
  ['LST-070', 'liste — ligne sous le nom (libellé du déclencheur)'],
  ...DECL.map((d) => [d.id, `déclencheur « ${d.fr} » (${d.cle})`]),
];

const esc = (s) => s.replace(/\|/g, '/');
const lignesIds = ['| ID | Élément | Test (fichier › titre) | Dernier état connu |', '|---|---|---|---|'];
const sansTest = [];
for (const [id, quoi] of LOT) {
  const concernes = tests.filter((t) => t.titre.includes(`[${id}]`));
  if (!concernes.length) { sansTest.push(id); lignesIds.push(`| ${id} | ${quoi} | — | AUCUN TEST |`); continue; }
  concernes.forEach((t, i) => lignesIds.push(`| ${i === 0 ? id : ''} | ${i === 0 ? quoi : ''} | ${t.f} › ${esc(t.titre)} | ${t.etat} |`));
}

// ── Le tableau du catalogue : déclencheurs, champs, modes d'attente, opérateurs ──
const t02 = (id) => tests.find((t) => t.f.startsWith('02-') && t.titre.includes(`[${id}]`));
const SOUS_DRAPEAU = { 'DEC-09': 'auto_paiement_echoue', 'DEC-10': 'auto_consultation_documents', 'DEC-20': 'auto_client_inactif' };
const catDecl = ['| ID | Déclencheur | Offert au bureau A (sans drapeau) | Test du catalogue | Dernier état connu |', '|---|---|---|---|---|'];
for (const d of DECL) {
  const drapeau = SOUS_DRAPEAU[d.id];
  catDecl.push(`| ${d.id} | ${d.fr} (\`${d.cle}\`) | ${drapeau ? `NON — sous drapeau \`${drapeau}\` (aucune ligne \`org_features\` pour le bureau A) ; éprouvé dans le bureau B, où le drapeau est actif` : 'oui'} | 02-catalogue-declencheurs.spec.ts › [${d.id}]… | ${t02(d.id).etat} |`);
}

const etat = (frag) => {
  const t = tests.find((x) => x.titre.includes(frag));
  if (!t) throw new Error(`test introuvable pour « ${frag} »`);
  return `${t.f} › ${esc(t.titre.slice(0, 110))}… — **${t.etat}**`;
};
const CHAMPS = [
  ['DEC-02 `ouverture` — Quand déclencher (choix)', ['[DEC-02][EDT-058]', '« Quand déclencher » : l’option vide']],
  ['DEC-02 `montant__gte` — Montant minimum ($) (nombre)', ['[DEC-02][EDT-058]', 'montants : une valeur valide', 'montants incohérents']],
  ['DEC-02 `montant__lte` — Montant maximum ($) (nombre)', ['[DEC-02][EDT-058]', 'montants : une valeur valide', 'montants incohérents']],
  ['DEC-02 `service_id` — Contient le service (service)', ['[DEC-02][EDT-058]', '« Contient le service » offre']],
  ['DEC-02 `stage_id` — L’opportunité est à l’étape (étape de pipeline)', ['[DEC-02][EDT-058]', '« Contient le service » offre']],
  ['DEC-02 `etiquette` — Le client a l’étiquette (étiquette)', ['[DEC-02][EDT-058]']],
  ['DEC-10 `ouverture` — Quand déclencher (choix)', ['[DEC-10]']],
  ['DEC-18 `tag` — Quelle étiquette (étiquette)', ['[DEC-18][EDT-058]', 'les champs « étiquette » proposent', 'une étiquette ne peut pas dépasser', 'étiquette trop longue refusée']],
  ['DEC-19 `tag` — Quelle étiquette (étiquette)', ['[DEC-19]']],
  ['DEC-20 `mois` — Aucun job terminé depuis (mois) (nombre, obligatoire)', ['[DEC-20][EDT-058]', '« Client inactif » : le compteur', '« Client inactif » : 0 mois', '« Client inactif » sans nombre de mois']],
  ['DEC-20 `max_par_heure` — Au plus, par heure (nombre)', ['[DEC-20][EDT-058]', '« Client inactif » : le compteur']],
  ['DEC-25 `champ_id` — Quelle date surveiller (champ date, obligatoire)', ['[DEC-25][EDT-058]', '« Date atteinte » : la liste offre', 'le champ date surveillé a été supprimé : la carte', 'le PANNEAU le dit aussi', '« Date atteinte » sans date choisie : le bandeau', 'sur un champ date SUPPRIMÉ']],
  ['DEC-25 `jours_avant` — Combien de jours avant (nombre)', ['[DEC-25][EDT-058]', '« Combien de jours avant »']],
  ['DEC-26 `stage_id` — Quelle étape (étape de pipeline)', ['[DEC-26][EDT-058]', '« Quelle étape » offre', 'l’étape visée a été supprimée']],
  ['DEC-27 `stage_id` — Quelle étape (étape de pipeline)', ['[DEC-27]']],
  ['Filtre commun `client_a_etiquette` — Seulement si le client a l’étiquette', ['[DEC-01][EDT-058]', 'les champs « étiquette » proposent']],
  ['Filtre commun `client_sans_etiquette` — Seulement si le client n’a PAS l’étiquette', ['[DEC-01][EDT-058]', 'les champs « étiquette » proposent']],
  ['DEC-28 (hors catalogue) « Quel champ » → `field_id: { eq }`', ['[DEC-28][EDT-058]', '« Quel champ » range']],
  ['DEC-28 (hors catalogue) « Quand il devient » → `new_value: { eq }` (9 types de champ)', ['champ « QA Texte »', 'champ « QA Courriel »', 'champ « QA Site web »', 'champ « QA Nombre »', 'champ « QA Montant »', 'champ « QA Liste »', 'champ « QA Choix multiples »', 'champ « QA Date »', 'champ « QA Case »', 'paragraphe, téléphone, fichier']],
  ['Case de sortie `settings.arreter_si_resolu` (5 déclencheurs, drapeau `auto_sortie_parcours`)', ['la case « Arrêter si… » : offerte', 'décocher « Arrêter si la facture', 'la case décochée le reste']],
];
const catChamps = ['| Champ du déclencheur | Tests (fichier › titre — dernier état connu) |', '|---|---|'];
for (const [nom, frags] of CHAMPS) catChamps.push(`| ${nom} | ${frags.map(etat).join('<br>')} |`);

const ATTENTE = [
  ['Mode `duree` « Simplement ce délai » × minutes', 'mode « Simplement ce délai »'], ['Mode `duree` × heures', 'mode « Simplement ce délai »'], ['Mode `duree` × jours', 'mode « Simplement ce délai »'],
  ['Mode `reponse` « La réponse du client » × minutes', 'mode « La réponse du client'], ['Mode `reponse` × heures', 'mode « La réponse du client'], ['Mode `reponse` × jours', 'mode « La réponse du client'],
  ['Mode `avant_date` « Ce délai AVANT le rendez-vous » × minutes', '« 45 minutes AVANT le rendez-vous »'], ['Mode `avant_date` × heures', 'mode « Ce délai AVANT le rendez-vous »'], ['Mode `avant_date` × jours', 'mode « Ce délai AVANT le rendez-vous »'],
  ['Carte d’une attente « réponse du client »', 'une attente « réponse du client » se distingue'],
  ['Nombre effacé puis retapé (S-18)', 'effacer le nombre puis en taper un autre'], ['Unité à 0 ; 24 heures → « 1 jours » (S-18)', 'l’unité choisie reste celle'],
  ['Bornes (366 jours ; 30 jours avant)', 'une attente plus longue que ce que le serveur accepte'], ['Message de refus du serveur', 'le refus du serveur pour une attente trop longue'],
  ['Aide « 20 h – 8 h » contre la fenêtre réglée', 'l’aide « jamais entre 20 h et 8 h »'],
  ['Ajout depuis le tiroir (Attendre / Condition / Arrêter ici) ; « Arrêter ici » : rien à configurer', '« Attendre », « Condition » et « Arrêter ici » s’ajoutent'],
];
const catAttente = ['| Attendre / arrêter | Test (fichier › titre — dernier état connu) |', '|---|---|'];
for (const [nom, frag] of ATTENTE) catAttente.push(`| ${nom} | ${etat(frag)} |`);

const SIGNES = [['`=` (eq, valeur à plat)', 'les six signes'], ['`!=` (neq)', 'les six signes'], ['`>` (gt)', 'les six signes'], ['`>=` (gte)', 'les six signes'], ['`<` (lt)', 'les six signes'], ['`<=` (lte)', 'les six signes'],
  ['intervalle (deux lignes, même clé)', 'les six signes'], ['exemples cliquables', 'les quatre exemples cliquables'], ['ligne mal écrite (S-20)', 'une ligne mal écrite'],
  ['limites du serveur (10 clés, 200 caractères)', 'plus de conditions ou des valeurs plus longues'], ['`in` / `not_in` sans syntaxe dans l’éditeur (S-21)', 'une condition « est l’un de » (in / not_in)']];
const catSignes = ['| Condition en texte (étape « Si… ») | Test (fichier › titre — dernier état connu) |', '|---|---|'];
for (const [nom, frag] of SIGNES) catSignes.push(`| ${nom} | ${etat(frag)} |`);

const OPS = [
  ['texte', ['is — est', 'is_not — n’est pas', 'contains — contient', 'not_contains — ne contient pas', 'is_empty — est vide', 'is_not_empty — n’est pas vide'], 'famille « texte (ligne simple) »'],
  ['nombre', ['eq — =', 'neq — ≠', 'gt — plus grand que', 'lt — plus petit que', 'between — entre', 'is_empty', 'is_not_empty', 'gt sur un montant (dollars → cents)'], 'famille « nombre et montant »'],
  ['liste', ['any_of — est l’un de (liste simple, choix multiples)', 'none_of — n’est aucun de', 'is_empty', 'is_not_empty'], 'famille « liste (simple et choix multiples) »'],
  ['date', ['today — aujourd’hui', 'yesterday — hier', 'in_last — dans les derniers', 'more_than_ago — il y a plus de', 'less_than_ago — il y a moins de', 'before — avant le', 'after — après le', 'between — entre', 'is_empty', 'is_not_empty'], 'famille « date »'],
  ['case', ['is — est (oui / non)'], 'famille « case à cocher »'],
  ['fichier', ['is_empty', 'is_not_empty'], 'famille « fichier »'],
];
const catOps = ['| Famille | Opérateur | Test (fichier › titre — dernier état connu) |', '|---|---|---|'];
for (const [fam, ops, frag] of OPS) for (const o of ops) catOps.push(`| ${fam} | ${o} | ${etat(frag)} |`);
catOps.push(`| (éditeur) | opérateurs offerts par type de champ ; remise à zéro | ${etat('les opérateurs offerts suivent le type du champ')} |`);
catOps.push(`| (éditeur) | 10 lignes au plus ; retirer une ligne | ${etat('« Ajouter une condition » jusqu’à 10 lignes')} |`);
catOps.push(`| (éditeur) | ligne incomplète | ${etat('une ligne laissée sans valeur n’est pas enregistrée')}<br>${etat('une ligne incomplète retirée à l’enregistrement est SIGNALÉE')} |`);
catOps.push(`| (éditeur) | décimale tapée au clavier, « NaN » (S-19) | ${etat('valeur numérique tapée au clavier')} |`);
catOps.push(`| (éditeur) | option archivée (S-31) | ${etat('une option ARCHIVÉE')} |`);
catOps.push(`| (éditeur) | durée bornée 1 à 3650 | ${etat('durée d’une condition de date')} |`);
catOps.push(`| (étape « Si… ») | conditions de champs dans l’étape | ${etat('une condition de champ s’ajoute à côté des conditions en texte')} |`);

writeFileSync(`${SORTIES}/tableau-catalogue.md`, [
  '### Déclencheurs (28)', '', ...catDecl, '',
  '### Champs des déclencheurs (15 champs propres + 2 filtres d’étiquettes + « Champ modifié » + case de sortie)', '', ...catChamps, '',
  '### Attendre (3 modes × 3 unités) et arrêter', '', ...catAttente, '',
  '### Conditions en texte — les 6 signes', '', ...catSignes, '',
  '### Conditions de champs — les 20 opérateurs (6 familles)', '', ...catOps, '',
].join('\n'));

const compte = (motif) => tests.filter((t) => motif.test(t.etat)).length;
const resume = {
  tests_ecrits: tests.length,
  executes_verts: compte(/^vert/),
  rouges_defaut_produit: compte(/^rouge — défaut produit/),
  rouges_panne: compte(/^rouge — panne/),
  jamais_executes: compte(/^écrit, jamais exécuté/),
  marques_defaut: tests.filter((t) => / @defaut$/.test(t.titre)).length,
  ids_du_lot: LOT.length, ids_sans_test: sansTest,
};
writeFileSync(`${SORTIES}/resume.json`, JSON.stringify(resume, null, 1));
writeFileSync(`${SORTIES}/tableau-ids.md`, lignesIds.join('\n') + '\n');
writeFileSync(`${SORTIES}/tests.json`, JSON.stringify(tests, null, 1));
console.log(JSON.stringify(resume, null, 1));
