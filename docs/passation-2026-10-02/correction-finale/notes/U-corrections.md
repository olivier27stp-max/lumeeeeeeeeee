# Corrections de l'agent U — éditeur d'automatisations

Worktree `D:/lume-final/wt-u`, branche `mission/auto-finale-u` (rien n'est poussé). Un commit par ligne de triage ;
quand plusieurs lignes ont la même racine, un seul commit les ferme et le tableau le dit.
Tests neufs : `tests/automations-finale/u/` (vraie page / vrai composant en jsdom, vraies routes sur un faux Supabase).
Vérification au vrai navigateur (pile locale, bureau A « (u) ») :
`QA_AUTO_SUFFIXE=u npx tsx --env-file=.env.local scripts/qa/finale/u/verifier.mts <scénario>`.
« Rouge sans le correctif » : `bash scripts/qa/finale/u/sans-correctif.sh <test> [-t "nom"]` (retire le correctif non commité, lance, le remet).
« Spec rejouée » : `bash scripts/qa/finale/u/rejouer-spec.sh <spec> -g "…"` (les specs de la session fd, en lecture seule, contre mes serveurs ;
« verte à ses attentes » = toutes les attentes de la spec passent, seul le moniteur relève les 404 de la WebSocket « realtime » que la pile locale n'a pas).

**État au 2026-10-01, fin de l'étape « majeurs » : les 30 lignes « majeur » des trois triages sont corrigées (23 commits).**
Les mineurs restent à faire, lot par lot.

## Priorité — bug n° 1

| Constat | Commit | Test de régression | Vérifié au navigateur |
|---|---|---|---|
| A-01 — « Lumi dit avoir changé le message, rien ne change » : le panneau d'étape resté ouvert gardait l'ancien texte, et son « Enregistrer » écrasait celui de Lumi | `2b27e032` | `panneau-etape.test.tsx` « A-01 » (10 cas) ; `editeur-page.test.tsx` « A-01 » (5 cas, le geste exact du propriétaire) — 14 rouges sans le correctif | oui — `verifier.mts a01 a01b a01c` (réponse de Lumi interceptée) |
| A-09 — l'éditeur ouvert et une écriture venue d'ailleurs s'écrasaient en silence (= S-13 du lot « éditeur », `12-enregistrement:186`, deux onglets) | `f01f2393` | `serveur-regles.test.ts` « A-09 » (7 cas, vraies routes) ; `editeur-page.test.tsx` « A-09 » (12 cas) ; `api-erreurs.test.ts` (4) ; `onglet-reglages.test.tsx` (2) — 14 rouges sans le correctif | oui — `verifier.mts a09 a09b a09c` (conflit réel écrit en base, « Recharger », retour sur la fenêtre, aucun faux conflit après publication ou réglage) |

Comportement mis en place :
- A-01 : l'étape ouverte change par ailleurs (Lumi, annuler / rétablir, rechargement) et rien n'a été tapé dans le panneau → le panneau prend la nouvelle version, sans question. Une saisie est en cours → bandeau « Lumi a modifié cette étape pendant que vous l'éditiez. » (ou « … modifiée ailleurs… » si ce n'est pas Lumi), « Voir la version de Lumi » / « Garder ma version », et « Enregistrer » attend ce choix. Français et anglais.
- A-09 : `PATCH /api/automations/rules/:id` accepte `version_lue` (le `updated_at` lu) ; règle changée depuis → 409 `modifiee_ailleurs`, rien n'est écrit. L'éditeur l'envoie à chaque écriture (une à la fois), affiche « Cette automatisation a été modifiée ailleurs (par Lumi ou dans un autre onglet) » + « Recharger », sans nouvel essai. Au retour sur la fenêtre : relecture légère de la version, rechargement silencieux si rien n'est en attente. Un appelant sans garde (outils de Lumi, scripts) : comportement d'avant.
- À décider (non fait) : sur un conflit, seul « Recharger » est offert ; « garder ma version » (écraser en connaissance de cause) n'existe pas.

## Majeurs — lot « éditeur » (`D:/lume-uiaudit/sorties/triage/editeur.md`) : 12 lignes, toutes corrigées

| Ligne du triage | Commit | Test de régression | Vérifié au navigateur |
|---|---|---|---|
| S-01 — `07-clavardage-lumi:274` : « Ouvrir » la 2e automatisation sur réseau lent écrivait le nom et le parcours de la 1re dans la 2e | `073e719f` | `editeur-page.test.tsx` « S-01 » (2 cas) | oui — `verifier.mts s01` (chargement ralenti à 6 s) |
| S-13 — `12-enregistrement:186` : deux onglets s'écrasent | `f01f2393` (= A-09) | voir A-09 | oui — `a09 a09b a09c` |
| `12-enregistrement:86` : après un 429, l'enregistrement automatique ne réessayait jamais | `dbc83989` | `editeur-page.test.tsx` « débit dépassé (429) » (4 cas) ; `api-erreurs.test.ts` (2) | oui — `verifier.mts e429` |
| S-04 — `12-enregistrement:122` et `:144` : un refus du serveur présenté comme une panne, renvoyé en boucle, sans désigner l'étape | `27939ff8` | `editeur-page.test.tsx` « S-04 » (7 cas) ; `api-erreurs.test.ts` (2) | oui — `verifier.mts s04` |
| `05b-canevas-outils-origine:303` : un parcours converti ne se vidait pas (l'étape supprimée revenait et continuait de partir) | `4e29c110` | `regles-partagees.test.ts` « actionsDuParcours » (9) ; `serveur-regles.test.ts` « 05b:303 » (7) ; `editeur-page.test.tsx` « 05b:303 » (6) | oui — `verifier.mts c303 c303b` |
| S-03 — `07-clavardage-lumi:251` : sur une automatisation publiée, Lumi remplaçait le parcours en ligne sans question | `8174ff74` | `editeur-page.test.tsx` « S-03 » (4 cas) | oui — `verifier.mts s03` |
| S-12 — `05-canevas-edition:365` et `:347` : « Arrêter ici » au milieu faisait disparaître la suite ; une condition supprimée laissait sa branche « si non » orpheline en base | `0db8ce18` (+ `ab63e4a8`, la garde statique d'un test existant) | `editeur-page.test.tsx` « S-12 » (6 cas) | oui — `verifier.mts s12` |
| S-32 — `15-pause-globale:20` : la pause globale du bureau était invisible dans l'éditeur | `9e6dc36f` | `editeur-page.test.tsx` « S-32 » (6 cas) — 4 rouges sans le correctif (le message du commit dit 5 : c'est 4, mesuré après coup) | oui — `verifier.mts s32` |
| S-08 — `08-onglet-reglages:174` : basculer un réglage effaçait la case « Arrêter si… » décochée | `d5a5a231` | `onglet-reglages.test.tsx` « S-08 » (5 cas) | oui — `verifier.mts s08` |
| EDT-166 — `11-dialogues-gardes-panneaux:113` : « Précédent » du navigateur quittait l'éditeur et perdait le travail | `6ce9a1cb` | `editeur-page.test.tsx` « EDT-166 » (6 cas) | oui — `verifier.mts e166` |

## Majeurs — lot « actions » (`D:/lume-uiaudit/sorties/triage/actions.md`) : 8 lignes, toutes corrigées

| Ligne du triage | Commit | Test de régression | Vérifié au navigateur |
|---|---|---|---|
| 1 — `06-publication:154` : publiée, une étape du tiroir était écrite avant d'être enregistrée dans son panneau | `3b739958` | `editeur-page.test.tsx` « ligne 1 » (9 cas) | oui — `verifier.mts l1` ; spec rejouée : verte à ses attentes |
| 2 — `08-messages-langue:56`, `:70` : version anglaise (`body_en`, `subject_en`) invisible, périmée en silence | `539be241`, ajusté par `a80b2c25` (voir ci-dessous) | `panneau-etape.test.tsx` « ligne 2 » (23 cas : 15 en bureau français, 8 en bureau anglais) ; `editeur-page.test.tsx` « ligne 2 (ajustement) » (3 cas) | oui — `verifier.mts l2` dans un bureau français ET un bureau anglais (13 contrôles, base relue) ; specs `:56` et `:70` à mettre à jour (bloc replié, « Enregistrer » jamais retenu) |
| 3 — `08-messages-langue:93` : courriel fourni converti, HTML brut dans « Message » | `d6685b42` | `panneau-etape.test.tsx` « ligne 3 » (6 cas) | oui — `verifier.mts l3` ; spec rejouée : verte à ses attentes |
| 4 — `05-panneau-etape:325` : « Attendre » 3 jours, retaper 5 donnait 5 minutes | `cf1620d4` | `panneau-etape.test.tsx` « ligne 4 » (8 cas) — 5 rouges sans le correctif | oui — `verifier.mts l4` |
| 5 — `01-tiroir-actions:263` (« Date atteinte » sur un champ du pipeline) : le tiroir offrait ce que le canevas et le serveur refusaient | `163e541c` | `regles-partagees.test.ts` « l'entité que fixe le champ surveillé » (6) ; `serveur-regles.test.ts` « lignes 5 et 7 » (8) ; `editeur-page.test.tsx` « ligne 5 » (2) | oui — `verifier.mts l5` |
| 6 — `01-tiroir-actions:263` (« Appel reçu de l'extérieur ») : six actions offertes et publiées, qui échouent à chaque passage | `09dc78f8` | `regles-partagees.test.ts` « ligne 6 » (3) ; `serveur-regles.test.ts` « ligne 6 » (2) ; `editeur-page.test.tsx` « ligne 6 » (1) — 5 rouges sans le correctif | oui — `verifier.mts l6` |
| 8 — `03-champs-types:214`, `:229` : 999 ou -5 jours, 10 000 001 $ passaient « Enregistrer », puis le serveur refusait tout le parcours sans dire où | `71d2b5e9` | `regles-partagees.test.ts` « fauteDeValeur » (7) ; `serveur-regles.test.ts` « lignes 8, 9 et 24 » (8) ; `panneau-etape.test.tsx` « lignes 8 et 9 » (6) — 18 des 21 rouges sans le correctif | oui — `verifier.mts l8` (panneau + vrai serveur, français et anglais) |
| 9 — `03-champs-types:424`, `:436` : adresse de webhook en `http://`, mal formée ou interne | `71d2b5e9` (même racine que 8) | idem | oui — `verifier.mts l8` |

Ligne 2, comportement après l'ajustement `a80b2c25` (décision du coordinateur) :
- le champ PRINCIPAL, sous son libellé normal, montre le texte que le bureau ENVOIE : `body` s'il envoie en français, `body_en` s'il envoie en anglais (`company_settings.default_language`, lu par la page ; illisible → français) ;
- l'AUTRE langue, quand l'étape en porte une, est dans un bloc secondaire replié : « Version anglaise (Texte du message) — utilisée seulement si vos messages partent en anglais » (et l'inverse) ;
- corriger le texte principal sans toucher à l'autre ne bloque JAMAIS « Enregistrer » : le bloc se déplie, dit « Cette version n'est plus à jour. », avec « La retirer (vos clients recevront le texte ci-dessus) » coché d'office et « La garder telle quelle ». Mettre l'autre version à jour fait disparaître les deux choix ;
- une version retirée disparaît de l'étape (jamais `body_en: ""`). Bureau anglais : retirer la version française fait du texte anglais le seul texte, sous `body`. Même règle pour `subject` / `subject_en` ;
- le moteur (`champLocalise`, `server/lib/actions/index.ts`, lu, non modifié) : en anglais il prend `_en` si elle est remplie, sinon il retombe sur le texte de base ; en français il prend le texte de base et ne retombe PAS sur `_en` si la base est vide. Le panneau ne produit jamais ce dernier cas (le texte unique est toujours sous la clé de base).

Lignes mineures du lot « actions » déjà fermées par ces correctifs : 7 (publication côté serveur du cas « Date atteinte » sur le pipeline — `163e541c`),
24 (`07-anglais:239`, refus du serveur en français dans l'interface anglaise — `71d2b5e9`).

## Majeurs — lot « déclencheurs » (`D:/lume-uiaudit/sorties/triage/declencheurs.md`) : 10 lignes, toutes corrigées

| Ligne du triage | Commit | Test de régression | Vérifié au navigateur |
|---|---|---|---|
| `03-panneau-declencheur:316` : plage de montants impossible (min 5 000 $, max 100 $) ou minimum négatif enregistrés tels quels | `f6a70824` | `panneau-declencheur.test.tsx` « 03:316 » (6 cas) ; `serveur-regles.test.ts` « 03:316 et 03:581 » (6) ; `regles-partagees.test.ts` « fautesDuDeclencheur » (4) — 20 des 27 rouges sans le correctif | oui — `verifier.mts d316` ; spec rejouée : verte à ses attentes |
| `03-panneau-declencheur:581` : « Client inactif », 0 / 61 / 2,5 mois enregistrés tels quels | `f6a70824` (même racine) | `panneau-declencheur.test.tsx` « 03:581 » (4 cas) + serveur ci-dessus | oui — `d316` (serveur réel ; le panneau de ce déclencheur est sous drapeau, non offert au bureau A du banc) ; spec rejouée (bureau B, drapeau actif) : verte à ses attentes |
| `03-panneau-declencheur:647` : basculer « Jours ouvrables seulement » effaçait la case « Arrêter si… » décochée | `d5a5a231` (= S-08 du lot « éditeur ») | `onglet-reglages.test.tsx` « S-08 » | oui — `verifier.mts s08` |
| `04-filtres-conditions:418` : dans un filtre, « 12.5 » devenait 125, des lettres affichaient « NaN » | `7ed78a42` | `panneau-declencheur.test.tsx` « 04:418 » (6 cas, frappe touche par touche) — 5 rouges sans le correctif | oui — `verifier.mts d418` (vrai clavier) ; spec rejouée : verte à ses attentes |
| `05-etapes-controle:290` : « Attendre », effacer 3 et taper 5 donnait 5 minutes | `cf1620d4` (= ligne 4 du lot « actions ») | `panneau-etape.test.tsx` « ligne 4 » | oui — `verifier.mts l4` |
| `05-etapes-controle:470` : étape « Si… », ligne sans signe ou sans valeur jetée en silence | `df770cbc` | `conditions-si.test.ts` (16 cas, le module) ; `panneau-etape.test.tsx` « étape « Si… » » (12 cas) — 10 rouges sans le correctif du panneau | oui — `verifier.mts d470` ; spec rejouée : verte à ses attentes |
| `05-etapes-controle:501` : conditions « est l'un de » (`in` / `not_in`) invisibles, effacées au premier enregistrement | `df770cbc` (même racine) | idem | oui — `verifier.mts d470` (affichées, une ligne ajoutée, les deux d'origine intactes en base) ; spec : rouge par construction (voir « specs à mettre à jour ») |
| `06-publication-declencheur:109` : « Date atteinte » sur un champ date supprimé se publiait | `a8bc4036` | `serveur-regles.test.ts` « 06:109 » (8 cas) ; `editeur-page.test.tsx` « 06:109 » (3 cas) — 7 des 11 rouges sans le correctif | oui — spec rejouée au vrai navigateur : verte à ses attentes |
| `06-publication-declencheur:149` : « Date atteinte » sur un champ du pipeline + « Assigner l'opportunité », bandeau rouge et publication refusée | `163e541c` (= ligne 5 du lot « actions ») | voir ligne 5 | oui — `verifier.mts l5` ; spec rejouée : verte à ses attentes |
| `06-publication-declencheur:181` : le même cas, refusé par l'API de publication | `163e541c` | `serveur-regles.test.ts` « lignes 5 et 7 » | oui — spec rejouée : verte |

Lignes mineures du lot « déclencheurs » déjà fermées par ces correctifs : `03:335` (« jours avant » hors bornes refusé dans le panneau — `f6a70824`,
spec rejouée verte à ses attentes), `05:313` (unité et nombre de « Attendre » — `cf1620d4`), `06:191` (« Appel reçu de l'extérieur » — `09dc78f8`, spec rejouée verte à ses attentes).

Règles partagées posées par ces correctifs (un seul endroit, lu par le panneau, le canevas et le serveur) :
- `fauteDeValeur(champ, valeur)` et `fautesDuDeclencheur(cle, valeurs)` — `src/lib/automationCatalogue.ts` : bornes, nombre entier (`entier`), adresse https non interne, minimum ≤ maximum ;
- `champQuiFixeLEntite` / `entiteDuChamp` / `ENTITE_PAR_DECLENCHEUR['webhook.received']` — même fichier : sur quelle fiche une action est jugée ;
- `problemesAvantPublication({ …, entite, champSurveilleAbsent })` — même fichier ; côté serveur `champSurveilleDeLaRegle` (`server/lib/automations-publication.ts`) ;
- `actionsDuParcours` — `src/lib/publicationAutomatisation.ts` ;
- `texteDesConditions` / `analyserConditions` / `conditionsConservees` — `src/lib/conditionsEtapeSi.ts` (fichier neuf) : les conditions d'une étape « Si… » en texte.

## Specs de la session fd à mettre à jour (elles ne peuvent plus être vertes telles qu'écrites)

| Spec | Pourquoi |
|---|---|
| `actions/01-tiroir-actions:125`, `:140`, `:154` ; `editeur/05-canevas-edition:332` ; l'aide `rendreIncomplet` de `editeur/11…` | ligne 1 : une étape choisie dans le tiroir n'entre dans le parcours qu'à « Enregistrer » de son panneau |
| `actions/03-champs-types:229`, `:436` | lignes 8 et 9 : le panneau refuse, « Enregistrer » n'est plus cliquable |
| `actions/08-messages-langue:56`, `:70` | ligne 2, après `a80b2c25` et `0582d5bf` : la version anglaise est dans UN bloc replié par étape (« Version anglaise — utilisée seulement si vos messages partent en anglais »), et « Enregistrer » n'est jamais retenu (« La retirer » coché d'office) |
| `actions/04-variables:40` | attend 6 boutons de variable sur `quote.sent`, ce que contredit `:101` du même fichier |
| `declencheurs/03-panneau-declencheur` « montants : une valeur valide est gardée en NOMBRE » (vers la ligne 296) | saisit un minimum de 1250,50 $ avec un maximum de 0 $ : une plage impossible, que `:316` demande de refuser |
| `declencheurs/05-etapes-controle:394` (« les quatre exemples cliquables ») | enregistre avec « source = » et « created_at >= » sans valeur et attend qu'elles soient jetées en silence : c'est ce que `:470` interdit |
| `declencheurs/05-etapes-controle:501` | tape « montant > 100 » sans se placer : le curseur est au DÉBUT de la zone, le texte se colle devant « source est l'un de… » ; la ligne obtenue est refusée. Taper à la fin, sur une nouvelle ligne (c'est ce que fait `verifier.mts d470`) |

## Fichiers touchés hors de la zone annoncée (à valider)

- `src/components/automations/AutreVersionMessage.tsx` (composant de l'agent T) — `id`, défilement à l'ouverture, `AvisRetraitAutreVersion` (`b8ece8b6`, demandé par le coordinateur).
- `server/lib/automatisations-bureaux.ts` — `contenuPour` écrit le reflet du parcours (`68239982`, demandé par le coordinateur).
- `src/lib/emailBodyText.ts` — `estCorpsHtml`, sorti de PanneauEtape (`6a35e6ab`).
- `src/components/champs/EditeurConditions.tsx` — `04-filtres-conditions:418` : la racine est là (composant partagé avec les filtres du pipeline, qui profitent du même correctif ; les 42 fichiers de tests pipeline / champs restent verts).
- `src/components/champs/automatisations.tsx` — `objetDeLaRegle` délègue à la règle partagée du catalogue (`163e541c`).
- `src/lib/conditionsEtapeSi.ts` — fichier neuf : la logique sortie de `PanneauEtape.tsx` (`df770cbc`).
- `src/lib/fileBascule.ts` (type de retour), `server/routes/automation-publication.ts` (rend `updated_at`), `server/lib/automations-validation-messages.ts` (lieu de l'étape, anglais).

## Tests existants ajustés (chaque fois expliqué dans le commit)

- `tests/automatisations-v4-editeur.test.tsx` A-05 (clique « Enregistrer » du panneau — ligne 1).
- `tests/automatisations-publication-serveur.test.ts` (la réponse porte `updated_at` — A-09).
- `tests/automatisations-coherence-declencheur-action.test.ts` et `tests/automation/filet-regression/instantanes/webhook.received.json` (ligne 6).
- `tests/automatisations-filtres-dates.test.ts` (quatre cas lisaient le source du panneau : ils éprouvent maintenant le module) et `tests/automatisations-p0-audit.test.ts` (expression attendue) — `df770cbc`.

## Après les majeurs — demandes du coordinateur (2026-10-02)

Tête de `mission/auto-finale-u` : `f70cb08d` (fusions de `mission/automatisations-finale` comprises). Suite complète du dépôt lancée une fois à `10995f3e` : 628 fichiers verts, 2 rouges qui ne sont pas à moi (`t/a-reporter-vue-ensemble`, patchs de l'agent des statistiques ; `support/carte-app-fraicheur`, l'empreinte). `npm run lint` : 0.

### A. Trois tests du dépôt cassés par mes changements

| Test | Commit | Ce qui a été fait |
|---|---|---|
| `tests/chaine-optionnelle-incomplete.test.ts` | `82aceb54` | `ajoutEnAttente?.etape.id` ×3 → `?.etape?.id` (introduits par `3b739958`) |
| `tests/qa-2026-09-25-p2-fin.test.ts` « P2-13 » (2 cas) | `09dd714e` | Comportement VÉRIFIÉ d'abord sur la vraie page (4 cas neufs, `editeur-page.test.tsx` « P2-13 » : enregistré avant de partir, fermeture de l'onglet retenue en « modifié » et « en cours », départ pendant un enregistrement), puis attente du test de source remise sur la nouvelle forme. Aucun recul. |
| `tests/qa-2026-09-25-p2.test.ts` « P2-12 » | `d2a35da3` | Idem : 4 cas neufs sur le vrai panneau (`panneau-etape.test.tsx` « P2-12 », six raisons de griser « Enregistrer », la raison toujours écrite à côté), puis attente du test de source remise à jour. |

### B. Lumi ↔ éditeur

| Point | Commit | Test | Navigateur |
|---|---|---|---|
| A-04 — « change le message » renommait l'automatisation : le nom ne suit que `renomme: true`, ou une automatisation encore sans nom à elle | `7ba10295` | `editeur-page.test.tsx` « A-04 » (4 cas, 2 rouges sans le correctif) | le test `a-ui` de l'agent A reste à rejouer |
| `modifie: false` — une question réenregistrait le parcours : rien n'est appliqué ni enregistré ; la route rend `updated_at` dans cette réponse (sinon la garde A-09 refusait l'écriture suivante) | `c14d7958` | `editeur-page.test.tsx` « `modifie: false` » (6 cas) ; `serveur-regles.test.ts` « POST …/generer » (2 cas) — 6 des 8 rouges sans le correctif | non (réponse de Lumi simulée dans les tests) |
| `publiee` — après « active-la » puis « oui », l'état Publiée / Brouillon suit sans rechargement | `86a6eaa7` | `editeur-page.test.tsx` « `publiee` » (4 cas, 3 rouges sans le correctif) | non |
| Bouton « Demander à Lumi » | — | NON FAIT, décision du coordinateur : il n'existe pas dans l'éditeur, et on n'en crée pas (l'éditeur a déjà « Construire avec Lumi »). | — |

### C. Reports de l'agent T (preuves : `tests/automations-finale/t/a-reporter-*`)

| Patch | Commit | Preuve |
|---|---|---|
| `MessageEditor.patch` (appliqué tel quel) — deux langues côté liste, un seul message écrit, 1 600 caractères, corbeille, curseur | `61612f65` | `a-reporter-message-editor` VERT (19 cas). 4 attentes de tests existants ajustées, celles que T avait listées. |
| `SequenceCanvas.patch` (reporté à la main : le patch ne s'appliquait plus) — 180 cartes pour 23 étapes | `738c0e8b` | `a-reporter-canevas` VERT (2 cas) |
| `automation-rules.patch` — nom et description d'une copie de modèle = langue de l'INTERFACE | `10995f3e` | `a-reporter-nom-copie` VERT (2 cas). Le cas de `tests/automation/bibliotheque-modeles-route.test.ts` qui figeait l'ancienne règle est RÉÉCRIT en 5 cas sur la nouvelle (interface × bureau, suffixe, messages identiques dans les 4 combinaisons). |
| `a-reporter-vue-ensemble` (4 cas) | — | reste rouge : patchs pour l'agent des statistiques (`Automations.tsx`, `AutomationsApercu`), hors de ma zone. |

### Régression, S-14, remarques d'usage, `actions` = reflet

| Demande | Commit | Test | Navigateur |
|---|---|---|---|
| RÉGRESSION de `6ce9a1cb` (`editeur/11:125`) — après une saisie enregistrée, il fallait deux « Précédent » : l'entrée d'historique de la garde s'en va avec elle ; « Mes automatisations » la remplace | `c7e282f8` | `editeur-page.test.tsx` « EDT-166 (régression) » (6 cas sur un vrai chemin d'historique, 3 rouges sans le correctif) | oui — `verifier.mts e166b` (9 contrôles) ; les trois specs « Précédent » d'`editeur/11` rejouées (versions à jour, `wt-verif`) : vertes à leurs attentes |
| S-14 (`07-clavardage-lumi:461`) — « Voir Autopilot » quittait sans question | `ee99f9b0` | `editeur-page.test.tsx` « S-14 » (3 cas, 2 rouges sans le correctif) | oui — spec rejouée : verte à ses attentes |
| Décision 2 — PanneauEtape utilise le bloc partagé `AutreVersionMessage` (un bloc par étape, la version se retire ou se garde EN ENTIER, l'anglais du composant) ; remarque (d) : `subject_en` éprouvé à l'écran (6 cas) | `0582d5bf` | `panneau-etape.test.tsx` « ligne 2 » (28 cas) | oui — `verifier.mts l2`, bureau français puis anglais |
| Remarque (a) — version anglaise retirée « sous le pli » : avis « La version anglaise sera retirée. » + « Voir » à côté d'« Enregistrer » (panneau d'étape, texto de la liste), et le bloc vient dans la vue quand il se déplie (dans le composant partagé : tous les écrans) | `b8ece8b6` | `panneau-etape.test.tsx` « sous le pli » (9 cas) ; `message-editor.test.tsx` (4 cas) — 9 des 13 rouges sans le correctif | oui — `verifier.mts pli`, à 1024 × 768 (8 contrôles) |
| Remarque (b) — étape en cours d'ajout : carte en pointillé + mention, indicateur « Étape non enregistrée » | `36d64232` | `editeur-page.test.tsx` (4 cas) ; `canevas.test.tsx` (4 cas) — 5 des 8 rouges sans le correctif | oui — `verifier.mts attente` (7 contrôles) |
| Remarque (c) — bouton de variable « Total » sur « Devis envoyé » | — | NON FAIT, consigne du coordinateur (la palette de l'agent P le remplacera). | — |
| `actions` = reflet : « Utiliser ce modèle », « Dupliquer », copie vers d'autres bureaux, création avec un parcours | `68239982` | `serveur-regles.test.ts` « `actions` est le reflet du parcours copié » (6 cas, 4 rouges sans le correctif) | non (routes) |
| `actions` = reflet : la 2e automatisation créée par l'éditeur | `7b625878` | `editeur-page.test.tsx` « la 2e automatisation que Lumi fait créer » (2 cas, 2 rouges sans le correctif) | non |
| Remarque « le refus du panneau du déclencheur n'est visible qu'après le clic » — pas voulu : il était écrit dès la saisie mais dans le corps du panneau ; il est aussi à côté du bouton | `f70cb08d` | `panneau-declencheur.test.tsx` (3 cas, 3 rouges sans le correctif) | non |
| Remarque « la phrase "il manque un signe…" doit être AFFIRMÉE » | `df770cbc` (déjà) | `panneau-etape.test.tsx` « 05:470 » affirme la phrase exacte, pas « signalé OU bouton désactivé » | — |

Reste côté écrans hors de ma zone : l'avis « sera retirée » à côté du bouton de l'éditeur de courriel (`EmailPreviewEditor.tsx`) et de Réglages › Messagerie (ils ont déjà le défilement, par le composant).

## Mineurs faits avant ces demandes

| Ligne | Commit | Test | Navigateur |
|---|---|---|---|
| actions `05-panneau-etape:345` = déclencheurs `05-etapes-controle:338` — attente au-delà de 366 jours / 30 jours avant | `59ed48b5` | `panneau-etape.test.tsx` (4 cas, 4 rouges sans le correctif) | spec `actions/05:345` verte à ses attentes ; `declencheurs/05:338` : sa dernière attente (souple) échoue sur un localisateur strict — la limite est écrite deux fois dans le panneau (liste, et à côté du bouton) |
| suite de la ligne 2 — la carte du canevas montre le texte que le bureau ENVOIE | `01e991d9` | `canevas.test.tsx` (7 cas, 3 rouges sans le correctif) | oui — `verifier.mts l2` |
| actions `03-champs-types:177` — « < » et « > » sur la carte | `6a35e6ab` | `canevas.test.tsx` « 03:177 » (4 cas, 2 rouges) | spec rejouée : verte à ses attentes |
| actions `03-champs-types:727` — cartes sans détail (étiquette, membre, webhook, étape) | `d1c840a6` | `canevas.test.tsx` « 03:727 » (6 cas, 4 rouges) | spec rejouée : verte à ses attentes |

## Mineurs — à faire, lot par lot

(tableaux ajoutés à la fin de chaque lot)
