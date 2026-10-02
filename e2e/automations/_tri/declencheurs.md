# declencheurs — 123 tests : 109 verts, 14 rouges `@defaut` (revérification du 2026-10-02, après les correctifs de `mission/auto-finale-u`)

État au 2026-10-02 (arbre `D:/lume-uiaudit/wt-verif`, produit corrigé jusqu'à `b575a7ad`) : **109 verts / 14 rouges `@defaut` / 0 rouge sans
marque**. La passe complète a donné 108 / 14 / 1 : le rouge sans marque (`07-libelles-declencheurs:73`) était une panne du poste
(`ERR_NO_BUFFER_SPACE` sur l'image d'un avatar), vert rejoué seul. 14 défauts sont fermés par les correctifs (les 10 « majeurs »
du lot et 4 mineurs) — voir « Revérification du 2026-10-02 » en bas, et « Défauts corrigés depuis ».

Avant les correctifs (tri du 2026-10-01) : 47 échecs à la passe, après tri : 28 défauts, 13 specs réparées, 0 environnement, 6 fragiles.

Passe d'origine : 123 tests du dossier, 76 verts, 47 rouges (`sorties/e2e-local/passe1.txt`).
Dernière relance (dossier entier, un worker, pile locale, bureaux du jeu `declencheurs`) : voir « Revérification du 2026-10-02 » en bas.

À savoir avant de lire : ce matin, 6 des 123 tests seulement avaient tourné jusqu'au bout (`sorties/declencheurs/a-relancer.md` :
« 123 tests écrits, 6 exécutés »). Les tests SANS marque qui tombaient n'avaient donc jamais été vus verts, et les tests
`@defaut` affirmaient un défaut lu dans le code ou relevé à la main, pas un rouge déjà observé. Chacun a été rejugé sur ce
qu'il fait réellement aujourd'hui.

## Défauts du produit encore ouverts

14 tests, tous marqués `@defaut`, rouges à la passe du 2026-10-02 sur l'attente qui décrit le défaut (pas sur un
sélecteur vieilli). Tous « mineur » ou « cosmétique » : les 10 « majeurs » du tri du 2026-10-01 sont fermés (section suivante).
Aucun n'a de numéro au tableau des constats (§ 8 de `AUTOMATIONS_UI_AUDIT.md`), sauf le dernier (liste-12).
Les numéros de ligne sont ceux des specs au 2026-10-02 (ils ont bougé avec les tests adaptés).

| Identifiants | Spec:ligne | Écran | Ce qu'on fait | Ce qu'on voit | Ce qu'on devrait voir | Gravité |
|---|---|---|---|---|---|---|
| EDT-064, EDT-073 | 03-panneau-declencheur:77 | Éditeur › panneau « Réglages du déclencheur » | On tape dans « Quelle étiquette », puis on clique la croix « Fermer » | Le panneau se ferme, la saisie est perdue, aucune question | La question « Fermer sans enregistrer ? », comme le panneau d'étape | mineur |
| EDT-074 | 03-panneau-declencheur:105 | Même panneau, bouton « Enregistrer » | On clique « Enregistrer » pendant que le serveur tarde à répondre | Le bouton reste actif et identique : rien ne dit que ça enregistre, on peut recliquer | Bouton désactivé (ou « Enregistrement… ») le temps de l'appel, une seule écriture | mineur |
| EDT-082, EDT-072, DEC-25 | 03-panneau-declencheur:181 | Panneau de « Date atteinte » | On ouvre les réglages d'une automatisation dont le champ date surveillé a été supprimé | La carte dit « champ supprimé », mais le panneau montre « — Choisir une date — » sans un mot | Le panneau dit que le champ n'existe plus (ou affiche l'avertissement « Sans « Quelle date surveiller »… ») | mineur |
| EDT-081, DEC-26 | 03-panneau-declencheur:208 | Panneau de « Opportunité entre dans une étape » | On ouvre les réglages d'une automatisation dont l'étape visée a été supprimée | La carte dit « étape supprimée », le panneau affiche « — Toutes les étapes — » | Le panneau signale que l'étape n'existe plus | mineur |
| EDT-084 | 03-panneau-declencheur:277 | Panneau du déclencheur, champs « Quelle étiquette », « Seulement si le client a / n'a PAS l'étiquette » | On tape une étiquette de plus de 200 caractères | La saisie n'est pas bornée (pas de longueur maximale) ; le refus n'arrive qu'à l'enregistrement (message du serveur, clair et en français) | Une saisie bornée à ce que le serveur accepte | cosmétique |
| EDT-074, DEC-18, S-02 | 03-panneau-declencheur:566 | Panneau de « Étiquette ajoutée », sur une automatisation qui porte encore les réglages d'un ancien déclencheur (« mois », « au plus par heure ») | On remplit « Quelle étiquette » et on enregistre | Les réglages invisibles de l'ancien déclencheur restent dans la règle (`mois`, `max_par_heure`) | Après enregistrement, la règle ne porte que ce que le panneau montre | mineur — à décider (voir note 1) |
| EDT-090, EDT-074 | 04-filtres-conditions:406 | Panneau du déclencheur › section « Filtres » | On ajoute une condition « QA Nombre = » sans valeur, puis « Enregistrer » | « Réglages enregistrés » ; la ligne a été retirée sans que rien ne le dise | Un signalement de la ligne incomplète avant que le panneau se ferme | mineur |
| EDT-093 | 04-filtres-conditions:476 | Section « Filtres », opérateur « est l'un de » sur une liste | On choisit un champ liste dont une option a été archivée | L'option archivée (« Retirée ») est encore proposée | Seules les options actives | mineur |
| EDT-120 | 05-etapes-controle:220 | Canevas, carte d'une étape « Attendre » en mode « La réponse du client » | On regarde la carte | « Attendre 3 jour(s) », comme une attente simple | La carte dit qu'on attend la réponse du client (le parcours s'arrête s'il répond) | mineur |
| EDT-118, EDT-119, EDT-120, DEC-11 | 05-etapes-controle:276 | Carte d'une étape « Attendre », mode « Ce délai AVANT le rendez-vous » | On règle 45 minutes avant le rendez-vous et on enregistre | La carte dit « 1 heure(s) avant le rendez-vous » (la base porte bien 45 minutes) | « 45 minute(s) avant le rendez-vous » | mineur |
| EDT-118 | 05-etapes-controle:396 | Panneau d'une étape « Attendre », automatisation dont la fenêtre d'envoi est réglée de 9 h à 17 h | On lit l'aide sous le délai | « Les messages ne partent jamais entre 20 h et 8 h… » | L'aide suit la fenêtre réglée pour cette automatisation (« entre 17 h et 9 h ») | mineur |
| EDT-125 | 05-etapes-controle:529 | Panneau d'une étape « Si… », zone « Conditions » | On écrit 11 conditions, ou une valeur de 300 caractères | « Enregistrer » reste offert (le serveur en accepte 10, et 200 caractères) | Le panneau retient la saisie et dit la limite | mineur |
| EDT-018, EDT-022, DEC-25 | 06-publication-declencheur:70 | Éditeur, bandeau « 1 chose à corriger avant de publier » | On clique le problème du déclencheur (« Date atteinte » : « Quelle date surveiller » doit être rempli…) | C'est un texte, pas un bouton : rien ne s'ouvre | Le clic ouvre les réglages du déclencheur, comme un problème d'étape ouvre l'étape | mineur |
| LST-070, DEC-15 (liste-12) | 07-libelles-declencheurs:53 | Liste des automatisations, ligne « Anniversaire client » | On lit la ligne sous le nom | « Nouveau prospect · 12 mois après » | Un nom ou un déclencheur qui dise ce qui se passe vraiment | mineur — décision de produit, « NON FAIT » au tableau des constats |

Note 1 — 03:566 (03:533 au tri du 2026-10-01). `PanneauDeclencheur.enregistrer` repart exprès des conditions existantes (commentaire du 2026-09-24 : « une règle
peut porter des conditions qui ne viennent pas de ce panneau »). Depuis #859, changer de déclencheur nettoie ces clés (les deux
tests voisins sont verts) : il ne reste que les règles déjà polluées AVANT #859, que le panneau ne répare pas. Dans le doute,
laissé en défaut.

## Défauts corrigés depuis (marqueur @defaut retiré)

### Fermés par les correctifs de `mission/auto-finale-u` — revérifiés au vrai navigateur le 2026-10-02 (14)

« Ligne d'alors » = la ligne du tri du 2026-10-01 (celle de `D:/lume-final/notes/U-corrections.md`) ; « ligne » = celle de la spec aujourd'hui.
Chacun était vert dès la passe « tel quel » (specs non modifiées, produit corrigé), sauf 05:501 et 05:338 (voir « Comment »).

| Ligne d'alors → ligne | Gravité d'alors | Ce qui est corrigé (vu à l'écran et en base) | Par | Comment le marqueur est tombé |
|---|---|---|---|---|
| 03-panneau-declencheur:316 → :333 | majeur | Minimum 5 000 $ / maximum 100 $, minimum de −5 $, maximum de −0,01 $ : « Enregistrer » reste cliquable, le clic n'envoie rien, le panneau écrit « « Montant minimum ($) » est plus grand que « Montant maximum ($) » : rien ne peut remplir les deux… » ou « … doit être au moins 0. » ; base inchangée ; la plage remise à l'endroit s'enregistre | f6a70824 | Vert tel quel. Attentes durcies ensuite (phrase exacte, aucune écriture, base égale à celle d'avant) : vert |
| 03-panneau-declencheur:335 → :365 | mineur | 9999, −366 et 2,5 « jours avant » : refus écrit dans le panneau (« … doit être un nombre entier, entre -365 et 365. »), aucun PATCH, base inchangée ; −365 passe | f6a70824 | Vert tel quel (aucun 400 : le moniteur ne relève plus rien). Attentes durcies : vert |
| 03-panneau-declencheur:581 → :631 | majeur (sous drapeau) | « Client inactif » : 0, 61, 2,5 mois refusés dans le panneau (« … doit être un nombre entier, entre 1 et 60. »), comme 0 « par heure » (« … entre 1 et 1000. ») ; aucun PATCH, base inchangée ; 60 mois / 1 par heure passent | f6a70824 | Vert tel quel. Attentes durcies ; le test affirme maintenant que le drapeau `auto_client_inactif` est posé et que le serveur offre « client.inactive » au bureau B : vert |
| 03-panneau-declencheur:647 → :710 | majeur (sous drapeau) | Basculer « Jours ouvrables seulement » ne touche plus `settings.arreter_si_resolu = false` ; la case se relit décochée ; et, dans l'autre sens, « Enregistrer » du panneau garde `jours_ouvrables` | d5a5a231 | Vert tel quel. Ajouts : drapeau `auto_sortie_parcours` affirmé en base, case visible avant « décochée », enregistrement du panneau après coup : vert |
| 04-filtres-conditions:418 → :418 | majeur | Au vrai clavier : « 12.5 » reste « 12.5 » et vaut 12,5 ; « abc » n'écrit rien (ni « NaN ») ; « 1a2b » donne « 12 » ; « - », « -3. », « -3.75 » restent à l'écran pendant la frappe et −3,75 est enregistré ; « 12,5 » (virgule) reste « 12,5 » et vaut 12,5 ; relu « 12.5 » après rechargement | 7ed78a42 | Vert tel quel. Étendu (virgule, négatif, lettres au milieu, rechargement) : vert |
| 05-etapes-controle:290 → :290 | majeur | « Attendre » 3 jours, effacer, taper 5 : « 5 », « jours », 432 000 s en base | cf1620d4 | Vert tel quel : marqueur retiré, rien d'autre |
| 05-etapes-controle:313 → :313 | mineur | À 0, « jours » reste « jours » ; « 24 » « heures » reste « 24 » « heures » | cf1620d4 | Vert tel quel : marqueur retiré, rien d'autre |
| 05-etapes-controle:338 → :338 | mineur | 400 jours, 367 jours, 45 et 31 jours « avant le rendez-vous » : « Enregistrer » désactivé, « Une attente ne peut pas dépasser 366 jours (un an). » / « On peut envoyer au plus 30 jours avant le rendez-vous. » ; 366 jours et 30 jours avant passent | 59ed48b5 | Rouge tel quel sur la SPEC seulement : les deux « Enregistrer » désactivés passaient, la dernière attente tombait en « localisateur strict » (la limite est écrite deux fois : liste à corriger et à côté du bouton). Attente remplacée par la phrase exacte + les bornes 366 / 367 et 30 / 31 : vert |
| 05-etapes-controle:470 → :513 | majeur | « montant 5000 » et « statut = » : ligne signalée, « Enregistrer » retenu | df770cbc | Vert tel quel : marqueur retiré, rien d'autre |
| 05-etapes-controle:501 → :544 | majeur | Les deux conditions « est l'un de » / « n'est aucun de » sont affichées (« source est l’un de web, facebook », « statut n’est aucun de perdu ») ; une ligne ajoutée à la fin, elles sont INTACTES en base, champ par champ (`source.in`, `statut.not_in`), la troisième est ajoutée en nombre ; relu après rechargement | df770cbc | Rouge tel quel par construction (le test tapait au DÉBUT de la zone : ligne illisible, « Enregistrer » retenu — ce qui est le comportement décidé). Geste réécrit (clic, fin de zone, Entrée, frappe) : vert |
| 06-publication-declencheur:109 → :109 | majeur | « Date atteinte » sur un champ date supprimé : la publication est refusée par un message, aucune question « Publier ? », règle restée en brouillon | a8bc4036 | Vert tel quel : marqueur retiré, rien d'autre |
| 06-publication-declencheur:149 → :149 | majeur | Champ date du PIPELINE + « Assigner l'opportunité » : plus de bandeau rouge, la question « Publier cette automatisation ? » s'ouvre | 163e541c | Vert tel quel : marqueur retiré, rien d'autre |
| 06-publication-declencheur:181 → :181 | majeur | Le même cas par l'API de publication : 200 | 163e541c | Vert tel quel : marqueur retiré, rien d'autre |
| 06-publication-declencheur:191 → :191 | mineur | « Appel reçu de l'extérieur » : les six actions sont grisées, avec « Ne va pas avec ce déclencheur » écrit dessous | 09dc78f8 | Vert tel quel. Le titre disait « avec la raison » sans la vérifier : attente ajoutée, vert |

### Fermés avant le tri du 2026-10-01

Neuf étaient verts à la passe (`passe1.txt`) ; je les ai revus verts à ma relance. Seul le marqueur a été retiré du titre.

| Spec:ligne | Ce qui est corrigé | Par |
|---|---|---|
| 01-tiroir-declencheurs:104 | À l'ouverture du tiroir, le curseur est dans la recherche | #870 (declencheurs-04) |
| 01-tiroir-declencheurs:128 | Échap referme le tiroir | #870 (declencheurs-05) |
| 01-tiroir-declencheurs:210 | Pendant l'enregistrement d'un changement de déclencheur, la carte montre le nouveau choix | #870 (declencheurs-03) |
| 01-tiroir-declencheurs:281 | Un déclencheur sous drapeau coupé garde son nom sur la carte (plus de `payment.failed`) | #870 (declencheurs-06) |
| 03-panneau-declencheur:274 | Étiquette trop longue : le refus du serveur est en français et nomme la limite | cd7e56d9 (2026-09-30) — déjà corrigé quand le test a été écrit |
| 03-panneau-declencheur:364 | L'option vide de « Quand déclencher » ne s'appelle plus « — Inchangé — » | #870 (declencheurs-07) |
| 03-panneau-declencheur:496 | Passer de « Date atteinte » à « Devis envoyé » ne laisse plus les réglages de l'ancien déclencheur | #859 (declencheurs-01) |
| 03-panneau-declencheur:516 | Passer par « Devis ouvert par le client » ne laisse plus « première ouverture » dans la règle | #859 (declencheurs-01) |
| 05-etapes-controle:356 | Le refus du serveur pour une attente trop longue est en français | cd7e56d9 (2026-09-30) — déjà corrigé quand le test a été écrit |

Un autre `@defaut` était ROUGE à la passe, pour une raison de spec et non de produit ; une fois la spec ajustée, il
passe : le défaut est corrigé, le marqueur est retiré (il est compté dans les specs réparées ci-dessous).

| Spec:ligne | Ce qui est corrigé | Par |
|---|---|---|
| 01-tiroir-declencheurs:240 | Deux choix de déclencheur rapprochés : c'est le dernier choisi qui reste | #870 (declencheurs-02) |

`03-panneau-declencheur:335` (jours avant hors bornes) n'était PAS dans cette liste au 2026-10-01 : 3bf534a0 avait fait refuser
« 9999 » par le serveur, mais la règle du produit demande un refus DANS le panneau, avant l'envoi. C'est fait depuis f6a70824
(tableau du 2026-10-02 ci-dessus).

## Specs réparées (ce qui avait changé dans le produit, et le commit ou le fichier qui le prouve)

### Le produit a changé exprès (11)

| Tests (ligne à la passe) | Ce qui a changé | Preuve | Ce que j'ai fait |
|---|---|---|---|
| 01:45, 01:278 (tiroir : 25 et 28 déclencheurs) ; 02:128 × 4 (« Facture payée », « Facture en retard », « Rendez-vous planifié », « Statut du prospect changé ») | Quatre textes d'aide sont passés de l'apostrophe droite à l'apostrophe typographique. Aucun déclencheur n'a disparu, l'ordre n'a pas bougé | constat declencheurs-09, corrigé par #870 : `git show 963851e0 -- src/lib/automationCatalogue.ts` (4 lignes `aide_fr`) | `_catalogue.ts` : les 4 aides en « ’ ». Rien d'autre |
| 01:159 (canevas vide) | La carte en pointillés ne dit plus « Choisir le déclencheur » avec le déclencheur en petit dessous : elle dit « Quand », le déclencheur en place, puis « Cliquer pour choisir un autre déclencheur » | constat EDITEUR-03, #859 : `src/pages/AutomationBuilderPage.tsx` l. 2264-2283 (commentaire daté du 2026-10-01) ; `git log -S"Cliquer pour choisir un autre déclencheur"` → 1a1e9091 | Le test cherche le bouton par son nom entier (avant et après le choix), vérifie que l'ancien libellé n'existe plus et que l'écran dit « Pas encore enregistrée » tant que rien n'est en base |
| 06:36, 06:78, 06:130 (bandeau de publication) — et 06:68, qui reste un défaut mais butait d'abord sur ce même texte | Le bandeau accorde le nombre : « 1 chose à corriger avant de publier » (plus de « chose(s) ») | #859 : `AutomationBuilderPage.tsx` l. 2128 ; `git log -S"chose(s) à corriger"` → 1a1e9091 | Sélecteur du bandeau et texte exact mis à jour (`TITRE_BANDEAU`) |
| 01:237 `@defaut` (deux choix rapprochés) | Depuis #870 la carte montre tout de suite le nouveau déclencheur : un clic dessus ouvre ses réglages, plus le tiroir. Le test cliquait la carte pour rouvrir le tiroir et attendait 15 s un tiroir qui ne venait pas | #870, declencheurs-02 et -03 (message de commit : « le dernier déclencheur choisi est celui qui reste, et la carte le montre pendant l'enregistrement ») | Le second choix passe par « Changer de déclencheur… ». Le premier envoi n'est plus retardé de 2,5 s fixes : il est retenu jusqu'après le second choix (et, si le second partait en parallèle — le défaut d'origine —, on le laisse aboutir d'abord pour que le premier arrive en dernier). Vert : marqueur retiré |

### La spec était fausse dès l'écriture — jamais exécutée avant la passe (2)

| Test (ligne à la passe) | Ce qui n'allait pas | Preuve | Ce que j'ai fait |
|---|---|---|---|
| 04:205, famille « case à cocher » | Le test re-choisissait dans le menu « Opérateur » l'option DÉJÀ affichée (« est »). `selectOption` force alors un changement qu'aucun navigateur n'envoie pour un vrai utilisateur ; or le produit vide la valeur à chaque changement d'opérateur : la ligne « QA Case est oui (cochée) » perdait sa valeur et était retirée à l'enregistrement | `src/components/champs/EditeurConditions.tsx` l. 84 (`onChange` de l'opérateur : `value: null`) et l. 93 (une valeur nulle s'affiche « oui (cochée) ») ; la famille « case » n'a qu'un opérateur, un utilisateur ne peut donc pas déclencher ce changement | Le test ne choisit un opérateur que s'il n'est pas déjà celui du menu, et vérifie l'opérateur affiché. Les attentes en base et au moteur sont inchangées |
| 07:175, anglais, bureau aux drapeaux actifs | Le test attendait la section « Filters » (texte « Only if the record's fields (Invoice)… ») pour « Payment failed » et « Invoice viewed by client ». Or cette section n'existe que si le bureau a des champs personnalisés sur la fiche, et le bureau B n'en a aucun sur la facture | `src/components/automations/PanneauDeclencheur.tsx` l. 335 (`if (!objet || !champsPerso.some((c) => c.object_type === objet)) return null`) | L'attente suit la base : avec des champs sur la fiche, le texte est exigé ; sans champ, c'est l'ABSENCE de la section qui est exigée. Le test du bureau A vérifie d'abord que les cinq fiches ont des champs, donc que le texte est jugé pour chacune |

## Tests fragiles rendus déterministes (6)

Le produit a raison ; le test dépendait de ce qu'un autre lot avait laissé dans le bureau, ou d'un ordre que la base ne fixe pas.

| Test (ligne à la passe) | De quoi il dépendait | Ce que j'ai fait |
|---|---|---|
| 03:119 (« Date atteinte » : liste des champs date) | Liste figée à 3 libellés ; le lot « actions » avait créé « Fin de garantie QA » et « Fermeture prévue QA » dans le même bureau | La liste attendue est relue en base au moment du test (tous les champs date du client puis du pipeline, dans l'ordre du bureau) et l'égalité reste STRICTE : tout ce que le bureau porte, rien qui n'y soit pas. À part : les 3 dates du lot y sont, dans l'ordre ; le bureau porte bien d'autres types et d'autres objets (ce que la liste écarte) |
| 03:212 (suggestions d'étiquettes) | Liste figée à 3 étiquettes ; « VIP QA » et « Ne pas relancer QA » venaient du lot « actions » | Égalité stricte avec les étiquettes posées sur les clients du bureau, relues en base (`etiquettesDuBureau`, même périmètre que la RLS de `client_tags`), et les 3 du lot doivent en faire partie |
| 07:150 (anglais, 25 déclencheurs) | Le texte fixe était séparé des données par une liste de noms connus ; « Nettoyage de gouttières QA », « Fermeture prévue QA », « Intérêts QA » (lot « actions ») passaient pour du texte d'interface en français | Les noms des données sont relus en base (champs, options, services, pipelines, étapes, étiquettes) et retirés du texte avant de le juger. Vérifié mordant : en retirant « Fermeture prévue QA » de cette liste, le test retombe (« Pipeline · Fermeture prévue QA ») |
| 03:358, 04:264, 05:524 (ordre des champs dans les menus) | L'ordre attendu était `position` puis date de création — la règle du produit (`listerChamps`). Mais les champs « métier » d'un bureau naissent dans la même transaction, avec une position PAR DOSSIER : « Référé par », « Code d'accès » et « Courriel de facturation » sont tous en position 0, à la même microseconde. Entre eux, la base ne fixe aucun ordre : la requête du test et celle du produit ne les rendaient pas dans le même | `ecartAvecLOrdreDuBureau` (`_donnees.ts`) : exactement les champs du bureau pour cet objet (relus en base à l'instant), aucun autre, et jamais un champ affiché avant un autre que la règle place devant lui. Seule liberté : l'ordre entre deux champs à égalité stricte, que le produit ne définit pas. Éprouvé hors navigateur sur cinq cas (égalités permutées acceptées ; position inversée, microsecondes inversées, intrus, manquant refusés) |

Preuve que ces six tests tiennent dans un bureau « pas propre » : mes bureaux de tri étaient neufs, donc sans les données du lot
« actions ». J'y ai posé les mêmes (3 champs sur le client dont une date, une date sur le pipeline, un champ sur la facture,
un client porteur de « VIP QA » et « Ne pas relancer QA », deux services dont « Nettoyage de gouttières QA »), puis relancé :
10 passés / 0 échoué. Ces données sont restées dans le bureau A du jeu `declencheurs` (base locale) ; la dernière relance a
tourné avec elles.

## Environnement

Aucun échec de ce dossier ne tient à la pile locale : rien ici ne dépend du stockage de fichiers ni de Lumi, et les 47 rouges
de la passe se sont tous reproduits ou expliqués à l'identique sur les serveurs du tri.

## Encore rouge sans conclusion (et pourquoi)

Aucun. Les 14 rouges restants (2026-10-02) sont les défauts du tableau.

Sur `03-panneau-declencheur:335`, tel qu'écrit le 2026-10-01 (fermé depuis, voir plus haut) : à la passe, il tombait seulement parce que le moniteur relevait le 400 du serveur (ses
attentes passaient toutes). Il affirme maintenant la règle du produit — avec 9999 jours, « Enregistrer » inactif ou la borne
« entre -365 et 365 » écrite dans le panneau, aucune écriture partie, base inchangée — et il est rouge sur ces attentes-là
(le panneau ne refuse pas ; un PATCH part), plus le 400 que le moniteur relève toujours puisqu'il n'est plus déclaré attendu.

Aides partagées (`e2e/automations/_outils/`) : rien de fautif pour ce dossier, je n'y ai pas touché.

Trois remarques sur le produit, vues en instruisant, qui ne sont portées par aucun test (à vous de dire si elles valent un constat) :

1. **L'ordre des champs dans les menus de l'éditeur ne suit pas les dossiers.** `listerChamps` trie par objet, `position`, date
   de création, alors que la position est comptée par dossier. Résultat, relevé en base : « Référé par », « Code d'accès »,
   « Courriel de facturation », « Instructions d'accès », « Aucune demande d'avis » — trois dossiers entremêlés, et un ordre
   entre égaux que rien ne garantit d'un chargement à l'autre.
2. **Une condition « case à cocher » sans valeur s'affiche « oui (cochée) »** (`EditeurConditions.tsx` l. 93). Pas atteignable à
   la main aujourd'hui (un seul opérateur pour ce type), mais l'écran et la donnée peuvent diverger.
3. **03:90 ne va pas au bout de ce qu'il annonce** : il s'arrête à « le bouton n'est pas désactivé » et ne mesure donc pas si
   deux clics produisent deux écritures. Le défaut « rien ne dit que ça enregistre » est établi ; « double écriture » ne l'est pas.

## Relance du tri du 2026-10-01 (avant les correctifs — pour mémoire)

Dossier entier, après toutes les réparations, depuis `D:/lume-uiaudit/wt-e2e` :

    E2E_PORT_PROXY=48422 E2E_PORT_API=48303 E2E_PORT_VITE=5194 PLAYWRIGHT_BROWSERS_PATH=D:/lume-uiaudit/pw-browsers E2E_SORTIES=D:/lume-uiaudit/sorties/tri-declencheurs E2E_JEU=declencheurs E2E_WORKERS=1 node scripts/qa/automations-e2e/lancer.mjs declencheurs/ --project=bureau

Résultat : **96 passés / 27 échoués** sur 123 (16,8 min), journal dans `sorties/tri-declencheurs/passe-finale.txt`.
Les 27 échoués étaient les 27 `@defaut` d'alors ; aucun test sans marque n'était rouge ; aucun `@defaut` n'était vert.

Depuis cette passe, UN test a changé (consigne du coordinateur : le panneau doit refuser lui-même) : `03-panneau-declencheur:335`
est redevenu un `@defaut`. Relancé seul (même commande, `declencheurs/03-panneau-declencheur.spec.ts --project=bureau -g "Combien de jours avant"`) :
**0 passé / 1 échoué**, rouge sur « le panneau refuse de lui-même » et sur « aucune écriture ne part vers le serveur ».
État attendu du dossier aujourd'hui : 95 passés / 28 échoués — le dossier entier n'a pas été relancé après ce changement.

Avant elle : chaque fichier relancé une fois (01 : 11/11 ; 02 : 28/28 ; 03 : 28 passés / 9 ; 04 + 06 : 15 passés / 8 ;
05 : 9 passés / 9 ; 07 : 5 passés / 1), puis les 10 tests sensibles aux données rejoués avec les données d'un autre lot (10/10).

## Ce que je n'ai pas pu vérifier (tri du 2026-10-01 — pour mémoire)

- **Rien n'a tourné sur staging ni en prod** : tout est établi sur la pile locale, code de la PR #889.
- **01:240 mord-il encore ?** Je n'ai pas le droit de remettre le défaut dans le produit pour le voir retomber. Le raisonnement
  (si les deux envois partent en parallèle, le premier arrive en dernier et gagne) est écrit dans le test, pas prouvé par un rouge.
- **Le dossier entier après le retour de 03:335 en `@defaut`** : seul ce test a été relancé ; « 95 passés / 28 échoués » est
  une déduction, pas une passe vue.
- **Le bureau partagé de la passe complète** (jeux `e2e0` / `e2e1`, où les lots se suivent) : je ne l'ai pas rejoué. J'ai imité
  son état dans mon bureau ; l'ordre réel des lots dans une passe complète n'a pas été revu.
- **Les gravités** sont mon estimation, pas une décision.
- **Les deux défauts sous drapeau** (03:581, 03:647) ne touchent un bureau réel que si `auto_client_inactif` /
  `auto_sortie_parcours` y sont actifs ; je n'ai pas regardé l'état de ces drapeaux en prod.
- L'en-tête de `01-tiroir-declencheurs.spec.ts` (commentaire, ligne 3) parle encore de « Choisir le déclencheur » : je ne l'ai
  pas retouché après la dernière relance, pour que le fichier sur disque soit celui qui a tourné.

## Revérification du 2026-10-02 (après les correctifs de `mission/auto-finale-u`)

Arbre `D:/lume-uiaudit/wt-verif` (la branche de correction avec `main` fusionné), pile locale, jeu de bureaux `declencheurs`,
un worker. Table des correctifs : `D:/lume-final/notes/U-corrections.md`. Rien n'a été modifié dans le produit.

### Les trois passes

| Passe | Specs | Produit | Résultat | Journal (`D:/lume-uiaudit/sorties/verif-declencheurs/`) |
|---|---|---|---|---|
| « tel quel » | non modifiées | `7a31fa99` (avant 59ed48b5) | 105 verts / 18 rouges : 16 `@defaut` + 2 sans marque (03:297 et 05:394, les deux specs annoncées « à mettre à jour ») ; 12 `@defaut` verts | `passe-0-tel-quel.txt` |
| fichiers adaptés, un par un | adaptées | `b575a7ad` | 03 (7 tests visés) 7 / 7 ; 04:418 vert ; 05 entier 13 verts / 5 `@defaut` puis 05:338 et 05:544 verts | `passe-1-03.txt`, `passe-1-04.txt`, `passe-1-05.txt`, `passe-2-05.txt` |
| finale, dossier entier | adaptées | `b575a7ad` | **108 verts / 14 rouges `@defaut` / 1 rouge sans marque** (19,0 min) ; le rouge sans marque, `07-libelles-declencheurs:73`, est une panne du poste (`net::ERR_NO_BUFFER_SPACE` sur l'avatar `api.dicebear.com`), **vert rejoué seul** → 109 / 14 / 0 | `passe-finale.txt`, `passe-finale-rejeu-07.txt` |

Commande de la passe finale :

    E2E_PORT_PROXY=48424 E2E_PORT_API=48305 E2E_PORT_VITE=5196 PLAYWRIGHT_BROWSERS_PATH=D:/lume-uiaudit/pw-browsers E2E_SORTIES=D:/lume-uiaudit/sorties/verif-declencheurs E2E_JEU=declencheurs E2E_WORKERS=1 node scripts/qa/automations-e2e/lancer.mjs declencheurs/ --project=bureau

Aucun test vert avant les correctifs n'est devenu rouge, hors les deux specs annoncées (adaptées, vertes).

### Specs adaptées (ni `@defaut` ni défaut : des tests que le comportement décidé faisait tomber)

| Test | Ce qui a changé | Ce qu'il prouve toujours |
|---|---|---|
| 03-panneau-declencheur:312 « montants : une valeur valide est gardée en NOMBRE » (03:297 avant) | Il saisissait minimum 1 250,50 $ / maximum 0 $ — une plage impossible, refusée depuis f6a70824 (le test attendait 60 s une écriture qui ne part plus). Plage retournée : minimum 0 $, maximum 1 250,50 $ | 1250.50 est enregistré en nombre (1250.5) ; 0 est une vraie borne, pas « vide » ; vider les deux champs retire le filtre |
| 05-etapes-controle:417 « les quatre exemples cliquables » (05:394 avant) | Il enregistrait avec « source = » et « created_at >= » sans valeur et attendait que ces lignes soient jetées — ce que 05:470 interdit. Il affirme maintenant le signalement (« Ligne illisible « source = » : il manque la valeur. », idem « created_at >= », « Enregistrer » désactivé, rien d'écrit), puis COMPLÈTE les deux lignes au clavier (fin de zone ; flèche haut + Fin) et enregistre | Chaque exemple ajoute sa ligne à la FIN de la zone (les quatre lignes, dans l'ordre) ; les quatre conditions sont enregistrées dans la forme du moteur ; la carte dit « Si… 4 condition(s) » |
| 05-etapes-controle:544 (05:501 avant) | Geste : clic dans la zone, Ctrl+Fin, Entrée, puis « montant > 100 » (avant : frappe au début de la zone). Attentes ajoutées : les deux lignes affichées en clair, comparaison champ par champ en base, le moteur juge encore les conditions d'origine, relecture après rechargement | Voir le tableau des défauts fermés |
| 05-etapes-controle:338 | Dernière attente : la phrase exacte de la limite (au lieu d'un motif large que deux éléments satisfont), plus les bornes 366 / 367 jours et 30 / 31 jours avant | Voir le tableau des défauts fermés |

Aucune demande d'adaptation refusée : aucune des trois n'affaiblit une preuve (chaque attente retirée est remplacée par celle du
nouveau comportement, plus stricte).

### Le drapeau des tests « sous drapeau » (03:631, 03:710)

`donnees()` (`_donnees.ts`) pose les 4 drapeaux du bureau B dans `org_features`, puis ATTEND (60 s au plus, sinon le test tombe) que
le catalogue servi par l'API au bureau B porte `payment.failed`, `invoice.viewed` et `client.inactive`. Le serveur garde les
drapeaux d'un bureau 30 s, tous ensemble (`server/lib/automations-drapeaux.ts`, une seule entrée de cache par bureau) : quand ces
trois déclencheurs sont offerts, `auto_sortie_parcours` est appliqué aussi. Les deux tests l'affirment maintenant eux-mêmes
(`drapeauApplique` : ligne `enabled` en base ; pour « Client inactif », déclencheur offert par l'API) ; pour la case « Arrêter si… »,
c'est l'écran qui le prouve (la case n'existe que sous drapeau : le test exige qu'elle soit visible, puis décochée).

### Ce que je n'ai pas pu vérifier (2026-10-02)

- **Que les tests retombent si l'on remet le défaut** : je ne touche pas au produit. La preuve « rouge sans le correctif » est celle
  de la session qui corrige (`sans-correctif.sh`, tests jsdom), pas la mienne. Ce que j'ai : 28 rouges avant (tri du 2026-10-01,
  sur l'ancien produit), 14 de ces tests verts sur le produit corrigé, sans changer leur attente de fond.
- **Rien sur staging ni en prod** ; un seul navigateur (Chromium 1440 × 900) ; français seulement pour les messages de refus (la
  version anglaise des phrases existe dans le code, aucun test de ce dossier ne la lit).
- **Les filtres du pipeline**, qui partagent `EditeurConditions.tsx` avec la section « Filtres » : hors de ce dossier, non rejoués ici.
- **La passe finale n'est pas « propre » d'un seul tenant** : un test est tombé sur une panne du poste et n'est vert que rejoué seul.
  Je n'ai pas relancé le dossier entier une seconde fois.
- **05:470 n'a pas été durci** (vert tel quel, marqueur retiré, rien d'autre) : il accepte encore « signalé OU bouton désactivé ».
  La phrase exacte du signalement est affirmée par 05:417 (« il manque la valeur ») ; celle du signe manquant (« il manque un
  signe… ») n'est affirmée par aucun test de ce dossier.

### Remarques sur le produit vues en vérifiant (aucune n'est portée par un test rouge)

1. **Le panneau du déclencheur écrit le refus dès la saisie**, pas seulement au clic — lu dans `PanneauDeclencheur.tsx` (l'encadré
   suit le brouillon ; le clic y ramène par défilement et focus). À l'écran, les tests voient l'encadré après le clic, et le voient
   disparaître dès que la saisie est corrigée, avant tout clic. Conforme à la règle décidée ; « avant le clic » n'est pas affirmé.
2. **Dans un filtre, « - » seul** reste affiché pendant la frappe (vu à l'écran) ; d'après `EditeurConditions.tsx`, la valeur vaut
   alors « rien » : une ligne laissée ainsi serait une ligne incomplète, retirée sans un mot à l'enregistrement — le défaut mineur
   04:406, toujours ouvert. Non rejoué avec ce cas précis.
3. **L'étape « Attendre » écrit la limite deux fois** (liste à corriger et à côté du bouton) — vu à l'écran (les deux éléments
   relevés par le localisateur strict de 05:338).
