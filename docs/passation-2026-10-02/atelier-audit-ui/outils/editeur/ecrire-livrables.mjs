// Écrit constats.jsonl et couverture.md du lot « editeur » à partir :
//  · de la liste des tests écrits (sorties/editeur/liste-tests.txt, produite par `playwright --list`) ;
//  · du dernier état CONNU de chaque test exécuté le 2026-10-01 (table ci-dessous, tenue à la main).
// Aucun accès réseau. Usage : node ecrire-livrables.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const SORTIES = 'D:/lume-uiaudit/sorties/editeur';
const CAP = `${SORTIES}/captures`;
const PRE = `${SORTIES}/preuves`;
const T = {
  corbeilleModif: '01-chargement-liens-directs.spec.ts › [EDT-003] automatisation à la corbeille : on ne peut pas la modifier depuis son adresse (S-15) @defaut',
  corbeilleDit: '01-chargement-liens-directs.spec.ts › [EDT-003] automatisation à la corbeille : l’éditeur DIT qu’elle est à la corbeille (S-15) @defaut',
  chargement: '01-chargement-liens-directs.spec.ts › [EDT-001] pendant le chargement, l’écran DIT qu’il charge (texte ou rôle « status ») @defaut',
  enregistreNouvelle: '03-creation-de-zero.spec.ts › [EDT-012] sur une automatisation jamais enregistrée, l’indicateur ne dit pas « Enregistré » (constat f1-2) @defaut',
  choisir: '03-creation-de-zero.spec.ts › [EDT-029] la carte du déclencheur ne dit pas « Choisir » quand un déclencheur est déjà inscrit dessous (constat f1-2) @defaut',
  deuxPanneaux: '11-dialogues-gardes-panneaux.spec.ts › [EDT-032][EDT-037] un seul panneau à droite : ouvrir « Quand » pendant qu’une étape est ouverte ne les empile pas (S-07) @defaut',
  ctrlZ: '02-barre-du-haut.spec.ts › [EDT-010] Ctrl+Z annule la dernière modification du parcours (S-42) @defaut',
};

const constats = [
  {
    id: 'EDITEUR-01', ids_carte: ['EDT-003', 'EDT-037', 'EDT-012'],
    ecran: 'Éditeur ouvert par son adresse /automations/<id>, automatisation à la corbeille (deleted_at posé, non purgée)',
    element: 'Tout l’éditeur : canevas, panneau d’étape, enregistrement automatique',
    attendu: 'Une automatisation à la corbeille ne s’ouvre pas comme une autre : écran ou bandeau « à la corbeille — restaurez-la », et aucune écriture possible tant qu’elle n’est pas restaurée.',
    observe: 'Elle s’ouvre exactement comme une automatisation vivante (aucun bandeau, « Brouillon », « Enregistré »). Le texte d’une étape modifié dans le panneau est ÉCRIT en base (steps réécrit, relu avec service_role). Seule la publication est refusée (« Cette automatisation est à la corbeille : restaurez-la avant de la publier. »).',
    gravite: 'majeur', capture: `${CAP}/edt-s15-corbeille.png`, test: T.corbeilleModif, autres_tests: [T.corbeilleDit], preuve: `${PRE}/s15-corbeille-modifiable.txt`,
    cause_probable: 'server/routes/automation-rules.ts:178 — la lecture de l’éditeur filtre `purged_at` mais pas `deleted_at` ; le PATCH (:556-562) n’exclut pas non plus une règle supprimée ; src/pages/AutomationBuilderPage.tsx n’a aucun état « corbeille » (carte E06, soupçon S-15 confirmé).',
  },
  {
    id: 'EDITEUR-02', ids_carte: ['EDT-012'],
    ecran: '/automations/nouvelle (liste → Créer → « Partir de zéro »), avant toute modification',
    element: 'Indicateur d’enregistrement de la barre du haut',
    attendu: 'Tant qu’aucune ligne n’existe en base, l’indicateur ne dit pas « Enregistré » (rien, ou « Brouillon non enregistré »).',
    observe: '« ✓ Enregistré » est affiché dès l’ouverture et tant qu’on ne touche à rien, alors qu’aucune ligne n’existe dans automation_rules (vérifié en base toutes les 0,8 s pendant 5 s). À la première modification il passe à « Modifié », la ligne naît ~3 s plus tard : à partir de là il dit vrai. Constat f1-2 confirmé.',
    gravite: 'mineur', capture: `${CAP}/explo-nouvelle.png`, test: T.enregistreNouvelle, preuve: `${PRE}/explo-nouvelle-chronologie.txt`,
    cause_probable: 'src/pages/AutomationBuilderPage.tsx:214 — `etatSauvegarde` naît à `a_jour` même pour le brouillon local (`id === "nouvelle"`, :703-711) ; affichage :1636.',
  },
  {
    id: 'EDITEUR-03', ids_carte: ['EDT-029'],
    ecran: 'Canevas vide (nouvelle automatisation, ou automatisation enregistrée sans étape)',
    element: 'Carte en pointillés « Choisir le déclencheur »',
    attendu: 'Soit aucun déclencheur n’est choisi et la carte invite à choisir, soit un déclencheur est déjà là et la carte le dit (« Déclencheur : Devis envoyé — changer »).',
    observe: 'La carte dit « Choisir le déclencheur » ET affiche dessous « Devis envoyé » (déclencheur posé d’office). Texte du bouton relevé par le test : « Choisir le déclencheurDevis envoyé ». On ne sait pas s’il reste quelque chose à choisir. Constat f1-2 confirmé.',
    gravite: 'cosmetique', capture: `${CAP}/explo-nouvelle.png`, test: T.choisir, preuve: `${PRE}/03-creation-de-zero-resultats/`,
    cause_probable: 'src/pages/AutomationBuilderPage.tsx:1938-1948 — libellé fixe « Choisir le déclencheur » suivi de `declencheurLabel` ; le brouillon local naît avec `trigger_event: "quote.sent"` (:706).',
  },
  {
    id: 'EDITEUR-04', ids_carte: ['EDT-032', 'EDT-037'],
    ecran: 'Onglet Parcours, 1440×900, une étape ouverte',
    element: 'Carte « Quand » cliquée pendant qu’un panneau d’étape est ouvert',
    attendu: 'Un seul panneau à droite à la fois (c’est ce que dit le commentaire du code) : ouvrir le déclencheur ferme ou remplace le panneau d’étape, avec confirmation si une saisie est en cours.',
    observe: 'Les deux panneaux de 380 px s’affichent côte à côte (« Réglages du déclencheur » + « Modifier l’étape ») : le canevas tombe à 680 px sur 1440, la carte de Lumi est rognée et le bouton « Ajouter » la recouvre. Trois boutons « Annuler » et deux « Enregistrer » sont alors à l’écran. Soupçon S-07 confirmé (première moitié ; la seconde — « + » sans effet — n’a pas pu être exécutée).',
    gravite: 'mineur', capture: `${CAP}/explo-panneau-etape-plus-quand.png`, test: T.deuxPanneaux, preuve: `${CAP}/explo-panneau-etape-plus-quand.yml`,
    cause_probable: 'src/pages/AutomationBuilderPage.tsx:2317 — la condition d’affichage de PanneauEtape ne teste pas `reglageDeclencheur` (celle du tiroir Actions, :2301, le teste).',
  },
  {
    id: 'EDITEUR-05', ids_carte: ['EDT-001'],
    ecran: 'Ouverture de l’éditeur (chargement, plus ~4,5 s de reprises en cas d’échec passager)',
    element: 'Écran de chargement plein écran',
    attendu: 'L’écran dit qu’il charge : un texte (« Chargement de l’automatisation… ») ou au moins un rôle « status » lisible par un lecteur d’écran.',
    observe: 'Un rond gris de 24 px au milieu d’une page blanche, sans aucun texte ni rôle (`aria-hidden` sur l’icône). Avec staging lent, l’écran est resté ainsi plusieurs dizaines de secondes : rien ne distingue « ça charge » de « c’est figé ».',
    gravite: 'mineur', capture: `${CAP}/edt-e02-chargement.png`, test: T.chargement,
    cause_probable: 'src/pages/AutomationBuilderPage.tsx:1506-1512 — `<Loader2 aria-hidden>` seul, sans texte ni `role="status"`.',
  },
  {
    id: 'EDITEUR-06', ids_carte: ['EDT-010', 'EDT-011'],
    ecran: 'Onglet Parcours, après la suppression d’une étape',
    element: 'Raccourci clavier Ctrl+Z',
    attendu: 'Ctrl+Z annule la dernière modification du parcours, comme la flèche « Annuler » de la barre (et Ctrl+Y / Ctrl+Maj+Z la rétablit).',
    observe: 'Ctrl+Z ne fait rien : la carte supprimée ne revient pas (attendue 4 s). Seuls les deux petits boutons fléchés de la barre annulent / rétablissent — eux fonctionnent (tests verts, écran et base). Soupçon S-42 confirmé pour Ctrl+Z.',
    gravite: 'mineur', capture: '', test: T.ctrlZ, preuve: `${PRE}/resultats-02-barre-du-haut-1re-passe.json`,
    cause_probable: 'src/pages/AutomationBuilderPage.tsx — aucun écouteur `keydown` global (le seul écouteur de fenêtre est `beforeunload`, :1281-1286) ; `annuler` / `refaire` (:783-795) ne sont branchés que sur les boutons (:1603-1620).',
  },
  {
    id: 'EDITEUR-HL1', ids_carte: [],
    ecran: 'HORS LOT — coquille de l’app (observé sur /automations et /automations/<id>), pendant les lenteurs de staging',
    element: 'Vérification « ce compte a-t-il un bureau ? » au chargement',
    attendu: 'Une lecture d’adhésions qui échoue ou tarde est traitée comme une ERREUR (on réessaie, on ne conclut rien). Jamais de création de bureau pour un compte qui en a déjà un.',
    observe: 'Quand le verrou d’auth est « volé » (exception « Lock broken by another request with the "steal" option » de supabase-js, vue des dizaines de fois), l’app envoie 1 à 3 `POST /rest/v1/orgs` pour le propriétaire du bureau de test — qui a déjà son bureau. Staging répond 403. Le déclencheur est la lenteur de staging ; la réaction (tenter de créer un bureau) vient du code. Non vérifié en production.',
    gravite: 'majeur', capture: '', test: '(moniteur du banc, specs 01, 02 et 03 — pas de test dédié : hors lot)', preuve: `${PRE}/hl1-verrou-auth-creation-de-bureau.txt`,
    cause_probable: 'src/App.tsx:549-570 — `const mem = (nbMemberships ?? 0) > 0` : un `count` nul (lecture ratée) vaut « aucune adhésion », puis `supabase.from("orgs").insert(...)`.',
  },
];
writeFileSync(`${SORTIES}/constats.jsonl`, constats.map((c) => JSON.stringify(c)).join('\n') + '\n');

// ── État connu des tests exécutés ────────────────────────────────────────────
const VERT = (quand) => `vert (exécuté le 2026-10-01 ${quand})`;
const PANNE = 'rouge — panne ou lenteur de staging, à relancer';
const etats = new Map(Object.entries({
  // 01 — trois passes (14:45, 15:21 et 16:00 UTC)
  '[EDT-001] échec de chargement : message clair, « Réessayer » recharge l’automatisation': VERT('15:21 et 16:00 UTC'),
  '[EDT-002] échec de chargement : « Mes automatisations » ramène à la liste': VERT('14:46 UTC ; les deux passes suivantes sont tombées sur la panne de staging'),
  '[EDT-001] pendant le chargement, l’écran DIT qu’il charge (texte ou rôle « status ») @defaut': 'rouge — défaut produit → EDITEUR-05',
  '[EDT-037][EDT-032] l’adresse d’une automatisation existante ouvre SON parcours, identique à la base': VERT('14:47 et 15:25 UTC'),
  '[EDT-003] identifiant inexistant : « introuvable » + retour à la liste, sans erreur brute': VERT('14:47 UTC'),
  '[EDT-003] identifiant mal formé (/automations/abc) : « introuvable », pas de page blanche': VERT('16:02 UTC'),
  '[EDT-003] automatisation supprimée définitivement : « introuvable », rien d’elle n’est affiché': VERT('14:48 et 16:02 UTC'),
  '[EDT-003] automatisation du bureau B ouverte par le propriétaire du bureau A : refus, rien de B ne s’affiche': VERT('14:50 et 16:03 UTC'),
  '[EDT-003] automatisation à la corbeille : l’éditeur DIT qu’elle est à la corbeille (S-15) @defaut': 'défaut produit observé à l’écran → EDITEUR-01 (capture) ; test corrigé après un faux vert (le nom de la règle contenait « corbeille »), pas ré-exécuté depuis',
  '[EDT-003] automatisation à la corbeille : on ne peut pas la modifier depuis son adresse (S-15) @defaut': 'rouge — défaut produit → EDITEUR-01 (deux passes)',
  '[EDT-018] automatisation à la corbeille : la publier est refusé avec un message en français': VERT('16:04 UTC'),
  '[EDT-003] un technicien qui ouvre l’adresse d’une automatisation est arrêté avant l’éditeur': VERT('15:32 et 16:05 UTC'),
  // 02 — une passe (14:58–15:20 UTC)
  '[EDT-004] « Mes automatisations » sans rien modifier : retour direct à la liste, la ligne y est': PANNE,
  '[EDT-004] « Mes automatisations » juste après une modification : elle est enregistrée AVANT de partir': PANNE,
  '[EDT-005][EDT-006][EDT-007] renommer avec accents et émojis, Entrée : écran = base, relu identique après rechargement': VERT('15:02 UTC'),
  '[EDT-006] nom très long : la saisie s’arrête à 120 caractères, le nom tient dans la barre, la base a le même': PANNE,
  '[EDT-006] nom vidé : l’ancien nom reste (écran et base) et le champ rouvert le montre @defaut': PANNE,
  '[EDT-008] Échap pendant le renommage ANNULE la saisie (S-17) @defaut': PANNE,
  '[EDT-009] cliquer ailleurs ferme le champ et garde le nouveau nom, enregistré en base': PANNE,
  '[EDT-010][EDT-011] annuler puis refaire une suppression d’étape : l’écran et la base suivent': VERT('15:10 UTC'),
  '[EDT-011] après « annuler », une nouvelle modification efface le « refaire »': VERT('15:12 UTC'),
  '[EDT-010] Ctrl+Z annule la dernière modification du parcours (S-42) @defaut': 'rouge — défaut produit → EDITEUR-06',
  '[EDT-010] annuler ne rattrape PAS un renommage : le bouton reste grisé après un simple changement de nom': PANNE,
  '[EDT-012] Modifié → Enregistrement… → Enregistré : « Enregistré » n’apparaît que quand la base a la modification': VERT('15:18 UTC'),
  '[EDT-012] une étape née incomplète : « 1 étape(s) à compléter », rien n’est écrit en base, le bandeau désigne l’étape': `${PANNE} (la première moitié est passée : indicateur et bandeau conformes, capture edt-012-incomplet.png ; l’enregistrement final a dépassé 30 s)`,
  // 03 — une passe partielle (≈ 15:50–16:05 UTC), en concurrence avec une autre de mes passes
  '[EDT-029][EDT-031] ouvrir « Partir de zéro » ne crée RIEN en base ; repartir non plus': `${PANNE} (comportement observé conforme pendant l’exploration : aucune ligne à l’ouverture)`,
  '[EDT-012] sur une automatisation jamais enregistrée, l’indicateur ne dit pas « Enregistré » (constat f1-2) @defaut': 'défaut produit observé à l’écran et en base → EDITEUR-02 (exploration) ; le test lui-même est tombé sur la panne, à relancer',
  '[EDT-029] la carte du déclencheur ne dit pas « Choisir » quand un déclencheur est déjà inscrit dessous (constat f1-2) @defaut': 'rouge — défaut produit → EDITEUR-03',
  '[EDT-031][EDT-059][EDT-012] première étape : la ligne naît à ce moment-là, une seule fois, et « Enregistré » dit vrai': VERT('≈ 15:55 UTC'),
  '[EDT-037][EDT-032] relecture : après rechargement puis réouverture depuis la liste, l’écran = la base, carte par carte': PANNE,
  '[EDT-006] renommer une automatisation jamais enregistrée la crée : une seule ligne, parcours vide, brouillon': `${PANNE} (comportement observé conforme pendant l’exploration)`,
  '[EDT-014][EDT-015][EDT-016] onglets Réglages / Historique / Journaux d’un brouillon jamais enregistré : message clair, pas d’erreur': PANNE,
  '[EDT-017] « Aperçu » sur un brouillon jamais enregistré : message d’information, rien en base': VERT('≈ 16:00 UTC'),
  '[EDT-018] « Publier » un brouillon vide : refus expliqué, interrupteur inchangé, rien en base': VERT('≈ 16:01 UTC'),
  '[EDT-012] deux modifications coup sur coup sur une nouvelle automatisation : UNE seule ligne en base': VERT('≈ 16:03 UTC'),
  // 04 — trois premiers tests lancés puis passe interrompue
  '[EDT-013][EDT-014][EDT-015][EDT-016] chaque onglet montre son écran ; le retour à « Parcours » rend le canevas intact': PANNE,
  '[EDT-017][EDT-055] « Aperçu » montre chaque étape qui partirait, dit que rien n’est envoyé, et se referme': PANNE,
  '[EDT-017] « Aperçu » juste après une modification : il montre la version à l’écran (enregistrée d’abord)': PANNE,
  // 11 — jamais exécuté, mais le défaut a été vu pendant l’exploration
  '[EDT-032][EDT-037] un seul panneau à droite : ouvrir « Quand » pendant qu’une étape est ouverte ne les empile pas (S-07) @defaut': 'écrit, jamais exécuté — défaut produit observé pendant l’exploration → EDITEUR-04 (capture)',
}));

// ── Les tests écrits ─────────────────────────────────────────────────────────
const tests = readFileSync(`${SORTIES}/liste-tests.txt`, 'utf8').split('\n')
  .map((l) => l.match(/›\s+editeur[\\/]([^:]+):\d+:\d+ › (?:.*? › )?(\[EDT-.*)$/)).filter(Boolean)
  .map((m) => ({ fichier: m[1], titre: m[2].trim() }));
const plage = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => `EDT-${String(a + i).padStart(3, '0')}`);
const ZONES = [
  ['2.1 Écrans de chargement, d’erreur, d’introuvable', 1, 3], ['2.2 Barre du haut', 4, 12], ['2.3 Onglets et barre d’actions', 13, 19],
  ['2.4 Canevas', 20, 55], ['2.5 Tiroir de choix', 56, 63], ['2.10 Clavardage Lumi', 134, 139], ['2.11 Onglet Réglages', 140, 147],
  ['2.12 Onglet Historique', 148, 149], ['2.13 Onglet Journaux', 150, 153], ['2.14 Dialogues et gardes de sortie', 154, 166],
];
const LOT = ZONES.flatMap(([, a, b]) => plage(a, b));
const etatDe = (t) => etats.get(t.titre) ?? 'écrit, jamais exécuté';
const inconnus = [...etats.keys()].filter((k) => !tests.some((t) => t.titre === k));
if (inconnus.length) { console.log('ÉTATS SANS TEST (titre changé ?) :'); for (const k of inconnus) console.log('  ', k); }
const constatsSansTest = constats.filter((c) => c.ids_carte.length && !tests.some((t) => `${t.fichier} › ${t.titre}` === c.test));
if (constatsSansTest.length) { console.log('CONSTATS DONT LE TEST EST INTROUVABLE :'); for (const c of constatsSansTest) console.log('  ', c.id, c.test); }

const verts = tests.filter((t) => etatDe(t).startsWith('vert'));
const rougesDefaut = tests.filter((t) => etatDe(t).startsWith('rouge — défaut produit'));
const rougesPanne = tests.filter((t) => etatDe(t).startsWith(PANNE) || /tombé sur la panne|pas ré-exécuté/.test(etatDe(t)));
const jamais = tests.filter((t) => etatDe(t).startsWith('écrit, jamais exécuté'));
const lignes = [];
let couverts = 0;
for (const [zone, a, b] of ZONES) {
  lignes.push(`| **${zone}** | | |`);
  for (const id of plage(a, b)) {
    const siens = tests.filter((t) => t.titre.includes(`[${id}]`));
    if (!siens.length) { lignes.push(`| ${id} | — | NON TESTÉ |`); continue; }
    couverts += 1;
    siens.forEach((t, i) => lignes.push(`| ${i === 0 ? id : ''} | ${t.fichier} › ${t.titre.replace(/\|/g, '/')} | ${etatDe(t)} |`));
  }
}
const defauts = tests.filter((t) => t.titre.includes('@defaut'));
const entete = `# Couverture du lot « editeur » — structure de l’éditeur plein écran (\`/automations/:id\`, \`/automations/nouvelle\`)

État au 2026-10-01, fin d’après-midi. **Staging est tombé en panne pendant la tournée** (base UNHEALTHY, PostgREST en 503, « statement timeout », auth lente) : la plupart des specs n’ont jamais pu être exécutées, et une partie de celles qui l’ont été sont tombées sur la panne, pas sur le produit.

- ID du lot couverts par au moins un test ÉCRIT : **${couverts} / ${LOT.length}**
- Tests écrits : **${tests.length}** dans 17 fichiers (\`D:/lume-uiaudit/wt/e2e/automations/editeur/\`), dont ${defauts.length} marqués \`@defaut\` : ils affirment le comportement ATTENDU là où la carte soupçonne un défaut. Tant qu’ils n’ont pas été exécutés, ce ne sont PAS des constats.
- Tests réellement exécutés au moins une fois : **${tests.length - jamais.length}** — **${verts.length} verts**, **${rougesDefaut.length} rouges sur un défaut du produit**, ${rougesPanne.length} tombés sur la panne ou la lenteur de staging (à relancer).
- Jamais exécutés : **${jamais.length}**.

Lecture de la colonne « Dernier état connu » : *vert (exécuté le …)* ; *rouge — défaut produit → constat* ; *rouge — panne ou lenteur de staging, à relancer* ; *écrit, jamais exécuté*.
Les constats sont dans \`constats.jsonl\` (défauts réellement observés seulement). La marche à suivre pour relancer est dans \`a-relancer.md\`.

| ID | Test (fichier › titre) | Dernier état connu |
|---|---|---|
`;
writeFileSync(`${SORTIES}/couverture.md`, entete + lignes.join('\n') + '\n');
console.log(`${couverts}/${LOT.length} ID ; ${tests.length} tests ; exécutés ${tests.length - jamais.length} ; verts ${verts.length} ; rouges défaut ${rougesDefaut.length} ; panne ${rougesPanne.length} ; jamais exécutés ${jamais.length} ; @defaut ${defauts.length}`);
const manquants = LOT.filter((id) => !tests.some((t) => t.titre.includes(`[${id}]`)));
console.log('ID sans test :', manquants.join(', ') || 'aucun');
