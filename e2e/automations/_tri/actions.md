# actions — 39 échecs à la passe, après tri : 34 défauts, 5 specs réparées, 0 environnement, 0 fragiles

Dernière relance (dossier entier, pile locale du tri, un worker) : **177 tests — 143 passés, 34 échoués** (29,2 min).
Les 34 échecs portent tous ` @defaut` et tombent chacun sur l'attente qui décrit le défaut (relevé ligne à ligne dans
`D:/lume-uiaudit/sorties/tri-actions/relance-dossier.txt`). Aucun test sans marque n'échoue ; aucun test `@defaut` ne passe.

Numéros de ligne = fichiers tels qu'ils sont sur disque après le tri (`e2e/automations/actions/`).

## Défauts du produit encore ouverts

| Identifiants | Spec:ligne | Écran | Ce qu'on fait | Ce qu'on voit | Ce qu'on devrait voir | Gravité |
|---|---|---|---|---|---|---|
| EDT-059, EDT-130, ACT-02, CHA-07 | 06-publication:154 | Éditeur d'une automatisation PUBLIÉE › tiroir « Actions » | « Ajouter », puis clic sur « Envoyer un texto ». On ne touche à rien d'autre : le panneau reste ouvert, « Enregistrer » n'est pas cliqué. | Trois secondes plus tard l'enregistrement automatique écrit l'étape en base : le parcours EN LIGNE porte déjà le texto d'exemple (« Bonjour [client_name], c'est [company_name]. Merci ! »). | Rien n'est mis en ligne tant que l'étape n'a pas été enregistrée dans son panneau. | majeur |
| CHA-07, EDT-108, EDT-130 | 08-messages-langue:56, :70 | Panneau d'une étape « Envoyer un texto » qui porte aussi un texte anglais (`body_en` — le cas des automatisations fournies converties) | Ouvrir l'étape ; corriger le texte (« 20 % jusqu'au 1er juin ») ; « Enregistrer ». | Le panneau ne montre qu'un texte. L'ancien texte anglais (« 10% off until May 1st. ») reste en base, invisible, et continue de partir aux clients d'un bureau en anglais. | La version anglaise est visible et modifiable — ou elle ne survit pas à une correction qu'on ne peut pas lui appliquer. | majeur |
| CHA-05, CHA-03, EDT-041, EDT-075 | 08-messages-langue:93 | Automatisation fournie (format d'origine) › clic sur l'étape « Envoyer un courriel » (conversion) | Cliquer la carte du courriel : le parcours se convertit, le panneau s'ouvre. | Le champ « Message » contient le HTML brut : `<div style="font-family:sans-serif;…"><h2>Bonjour [client_first_name],</h2><p>…`. | Un texte lisible, qu'on corrige comme un texte ; aucune balise ni style à l'écran. | majeur |
| EDT-118, EDT-119 | 05-panneau-etape:325 | Panneau d'une étape « Attendre » réglée à 3 jours | Cliquer dans le nombre, tout sélectionner, effacer, taper 5. | L'unité retombe à « minutes » dès que le champ est vide, et le champ affiche « 05 » : 3 jours sont devenus 5 minutes. | « 5 » et « jours » : l'unité choisie ne change pas quand on retape le nombre. | majeur |
| ACT-14, ACT-15, ACT-16, CHA-35, EDT-059, EDT-063, EDT-018 (S-09) | 01-tiroir-actions:263 (cas « Date atteinte » sur un champ date du pipeline), 06-publication:129 | Éditeur, déclencheur « Date atteinte » réglé sur un champ date du PIPELINE | Ouvrir le tiroir : « Assigner l'opportunité », « Modifier l'opportunité », « Déplacer l'opportunité » sont offertes. En ajouter une, choisir un membre, enregistrer. | Le canevas affiche aussitôt le bandeau rouge « 1 chose à corriger avant de publier — « Assigner l'opportunité » ne peut pas suivre ce déclencheur. » ; le serveur refuse la publication (422) pour ces trois actions. | Ce que le tiroir laisse ajouter se publie : le canevas et le serveur tiennent compte du champ surveillé (une opportunité), comme le tiroir et le panneau. | majeur |
| ACT-13 à ACT-18, EDT-059, EDT-063 | 01-tiroir-actions:263 (cas « Appel reçu de l'extérieur ») | Éditeur, déclencheur « Appel reçu de l'extérieur » | Ouvrir le tiroir « Actions » ; publier un parcours qui contient « Envoyer la facture », « Envoyer le devis », « Changer le statut du rendez-vous », « Déplacer / Modifier / Assigner l'opportunité ». | Aucune des six n'est grisée et le serveur publie. Or cet événement n'apporte ni devis, ni facture, ni rendez-vous, ni opportunité (`entityType: 'automation_webhook_receipt'`, server/routes/webhooks-entrants.ts) : elles échoueront à chaque passage. | Les six actions grisées « Ne va pas avec ce déclencheur », et refusées à la publication. | majeur |
| ACT-13 à ACT-18, EDT-059, EDT-063 | 01-tiroir-actions:263 (cas « Champ personnalisé modifié » sur un champ du client) | Éditeur, déclencheur « Champ personnalisé modifié » réglé sur un champ du CLIENT | Publier (par le serveur) un parcours qui contient les six actions liées à un devis, une facture, un rendez-vous ou une opportunité. | Le tiroir les grise bien toutes les six ; le serveur, lui, publie le parcours sans rien refuser. | Le tiroir et la publication disent la même chose : les six sont refusées. | mineur |
| EDT-077, CHA-29, CHA-20, EDT-126, EDT-130 | 03-champs-types:214, :229 | Panneau « Créer une tâche » (« À faire dans (jours) ») et « Modifier le client » (« Valeur estimée ($) ») | Taper 999 ou -5 jours, ou 10 000 001 $ ; « Enregistrer ». | « Enregistrer » reste actif, aucun message. Trois secondes plus tard : « Enregistrement impossible pour le moment — nouvel essai automatique. (« À faire dans (jours) » doit etre au plus 365.) » — sans accent, promet un nouvel essai voué à échouer, l'indicateur reste sur « Modifié » et l'étape fautive n'est pas désignée. Plus rien du parcours ne s'enregistre tant que la valeur reste. | Refus dans le panneau, avec la borne ; à défaut un message du serveur en bon français, sans « nouvel essai », qui désigne l'étape. | majeur |
| EDT-085, CHA-38, EDT-126, EDT-130 | 03-champs-types:424, :436 | Panneau « Appeler un webhook » › « L'adresse » | Taper `http://…`, « pas une adresse », `ftp://…` ou `https://localhost/interne` ; « Enregistrer ». | « Enregistrer » reste actif, aucun message. Puis : « Enregistrement impossible pour le moment — nouvel essai automatique. (« L'adresse » doit commencer par https://.) », en boucle, indicateur bloqué sur « Modifié ». | Refus dans le panneau, avec la raison ; pas de « nouvel essai automatique » pour une saisie refusée. | majeur |
| EDT-118, EDT-126 | 05-panneau-etape:345 | Panneau d'une étape « Attendre » | Taper 900 (jours). | « Enregistrer » reste actif ; le serveur refuse au-delà de 366 jours (même boucle que ci-dessus). | Refus dans le panneau, avec la limite. | mineur |
| CHA-33, ACT-14, EDT-018 (S-10, reste) | 06-publication:190 | Éditeur d'un brouillon dont l'étape « Déplacer l'opportunité » vise « Gagné » en texte libre (règle d'avant le menu, ou écrite hors écran) | Cliquer l'interrupteur « Publier ». | La confirmation « Publier cette automatisation ? » est proposée : « Gagné » n'est l'identifiant d'aucune étape, le déplacement échouerait. | Un refus qui nomme « L'étape visée ». (Le champ lui-même est devenu un menu : ce cas ne se crée plus à l'écran.) | mineur |
| EDT-105, CHA-24, EDT-126, EDT-022 | 03-champs-types:639 | Panneau « Mettre à jour un champ personnalisé » dont le champ a été archivé ou supprimé | Ouvrir l'étape. | Le panneau dit « Ce champ n'existe plus… », mais « Enregistrer » reste actif et le canevas n'affiche aucun bandeau « à corriger avant de publier ». | « Enregistrer » grisé, et le canevas annonce le problème avant la publication. | mineur |
| CHA-16, CHA-17, CHA-11, CHA-12, EDT-108 | 03-champs-types:323, :336 | Panneaux « Retirer une étiquette » et « Notifier l'équipe » | Saisir une étiquette puis cocher « Retirer toutes les étiquettes » ; ou choisir « Un membre précis », un membre, puis revenir à « Le propriétaire ». Enregistrer. | Le champ disparaît de l'écran mais sa valeur est enregistrée en base (`etiquette: "VIP QA"` à côté de `toutes: true` ; `membre_id` à côté de `destinataire: proprietaire`). | La base ne porte que ce que l'écran montre. | mineur |
| EDT-079 | 03-champs-types:373 | Panneau « Assigner un responsable » quand la lecture des membres échoue (500) | Ouvrir l'étape. | Un menu qui n'offre que « — Personne — », sans un mot. | Le panneau dit que la liste n'a pas pu être lue. | mineur |
| CHA-02, EDT-086 | 03-champs-types:135 | Panneau « Envoyer un courriel » › « Répondre à » | Taper « pas-une-adresse ». | « Enregistrer » reste actif, aucun message. | L'adresse fausse est signalée, l'étape n'est pas enregistrable telle quelle. | mineur |
| EDT-086, EDT-084, EDT-103, CHA-03, CHA-15, CHA-19 | 03-champs-types:101 | Panneaux : « Objet » (200), « L'étiquette » (60), « Source » (60), « Nom de l'action » (80) | Écrire au-delà de la limite. | La frappe est ignorée, sans compteur ni message (221 caractères écrits, 200 gardés ; 81 → 60 ; 96 → 80). | Un compteur ou « limite atteinte », comme sous les zones de texte. | mineur |
| CHA-07, EDT-037 | 03-champs-types:177 | Canevas › carte « Envoyer un texto » | Texte de l'étape : « Rabais si le total est < 500 $ ou > 1000 $ ». | La carte affiche « Rabais si le total est 1000 $ » : ce qui est entre « < » et « > » a disparu. | Le texte tel qu'il est écrit. | mineur |
| CHA-15, CHA-21, CHA-38, CHA-32, EDT-037 | 03-champs-types:727 | Canevas › cartes « Ajouter une étiquette », « Assigner un responsable », « Appeler un webhook », « Déplacer l'opportunité » | Regarder le parcours. | Les quatre cartes ne portent que le nom de l'action. | Quelle étiquette, quel membre, quelle adresse, quelle étape. | mineur |
| EDT-109, CHA-07, CHA-03, CHA-26 | 04-variables:70, :81 | Panneau d'un texto, d'un courriel, d'une tâche › boutons « Insérer une information du client » | Placer le curseur au milieu du texte, ou dans « Objet » / « Titre de la tâche », puis cliquer « Nom du client ». | La variable s'ajoute à la FIN du texte principal (« Bonjour , merci de votre confiance.[client_name] ») ; depuis « Objet » ou « Titre », elle part dans « Message » / « Détail ». | La variable s'insère là où est le curseur, dans le champ où l'on écrivait. | mineur |
| EDT-112, EDT-113, EDT-114 | 04-variables:101 | Panneau d'un texto sur « Devis envoyé » | Regarder les boutons de variables. | « Lien facture » et « Date du rendez-vous » sont offerts : sur un devis ils partiraient vides. | Seulement les variables que ce déclencheur sait remplir. | mineur |
| EDT-104, EDT-126 | 05-panneau-etape:187 | Panneau d'un texto › « Quoi faire » | Passer à « Envoyer un courriel ». | « Objet » est vide et « Enregistrer » grisé : aucun objet de départ n'est proposé (alors que la même action ajoutée par le tiroir naît avec « Un message de [company_name] »). | L'objet reçoit son texte de départ ; l'étape reste enregistrable. | mineur |
| EDT-104, EDT-126, ACT-17 | 05-panneau-etape:197 | Panneau d'une étape « Envoyer la facture » sur « Nouveau prospect » (déclencheur changé après coup) | Ouvrir l'étape. | Le refus est bien dit, mais le menu « Quoi faire » affiche « Envoyer un courriel » alors que l'étape est « Envoyer la facture ». | Le menu ne montre pas une autre action à la place de celle de l'étape. | mineur |
| ACT-05, CHA-14, EDT-104, EDT-126 | 05-panneau-etape:209 | Panneau d'une étape « Envoyer dans Slack » déjà présente | Ouvrir l'étape (le canevas, lui, la signale). | Le panneau ne dit rien de l'indisponibilité, « Enregistrer » est actif, « Quoi faire » affiche « Envoyer un courriel ». | « Bientôt : la connexion à votre Slack n'existe pas encore. » dans le panneau, « Enregistrer » grisé. | mineur |
| EDT-085, CHA-38, EDT-130 | 07-anglais:239 | Interface en anglais › « Call a webhook », adresse en http:// refusée par le serveur | « Save action ». | « Could not save right now — retrying automatically. (« L'adresse » doit commencer par https://.) » : le refus du serveur est en français. | Un message entièrement en anglais. | mineur |
| EDT-057, EDT-059 | 01-tiroir-actions:83 | Tiroir « Actions » › recherche | Taper « webhook » (il ne reste qu'« Appeler un webhook ») puis Entrée. | Rien. | L'unique action restante est choisie : son panneau s'ouvre. | mineur |
| ACT-05, EDT-063 | 01-tiroir-actions:194 | Tiroir « Actions » › « Envoyer dans Slack » (grisée) | L'atteindre au clavier ou au lecteur d'écran. | Bouton `disabled` : hors de l'ordre de tabulation, la raison n'est lisible qu'à la souris. | L'action grisée est atteignable et sa raison lisible. | mineur |
| EDT-101, EDT-130 | 05-panneau-etape:112, 07-anglais:218 | Panneau d'une étape « Attendre » (ou « Condition ») | Ouvrir l'étape. | L'onglet s'appelle « Modifier l'action » / « Edit action » et le bouton anglais « Save action » : une attente n'est pas une action. | Un libellé qui vaut pour toute étape. | cosmétique |

34 tests pour 27 défauts.

## Défauts corrigés depuis (marqueur @defaut retiré)

11 tests `@defaut` passaient à la passe, et passent encore à la relance ; ` @defaut` retiré du titre, rien d'autre.

- `01-tiroir-actions:76` — [EDT-057] à l'ouverture du tiroir, le curseur est dans la recherche (`TiroirChoix.tsx`, focus à l'ouverture).
- `02-catalogue-actions:143` — [CHA-09][ACT-03] « Notifier l'équipe » naît avec « Suivi à faire pour [client_name] » (constat actions-02, #870). Le titre était calculé : `${a.cle === 'create_notification' ? ' @defaut' : ''}` retiré.
- `02-catalogue-actions:163` × 5 — [CHA-11], [CHA-28], [CHA-31], [CHA-32], [CHA-40] : l'option vide des menus ne dit plus « — Inchangé — » là où rien n'est à laisser inchangé (constat actions-03, #870). Titre calculé : `${trompeur ? ' @defaut' : ''}` retiré, avec la constante `trompeur` devenue inutile.
- `04-variables:192` et `:200` — [EDT-132] « Variable inconnue : [x] — sera vide dans le message envoyé. » (#840).
- `04-variables:233` — [EDT-133] « 200 / 1600 · 2 SMS » (constat actions-04, #840).
- `06-publication:175` — [CHA-33] « L'étape visée » est un menu des étapes du pipeline (constat actions-01, #859).

## Specs réparées (ce qui avait changé dans le produit, et le commit ou le fichier qui le prouve)

Cinq tests rouges à la passe, verts à la relance.

1. `02-catalogue-actions:69` (garde du catalogue) et `02-catalogue-actions:90` cas « Déplacer l'opportunité » —
   « L'étape visée » (`stage_id`) est un MENU des étapes du bureau, plus un champ de texte de 40 caractères :
   `src/lib/automationCatalogue.ts` l. 1060-1070 (`type: 'etape_pipeline'`, sans `max`), commit 1a1e9091 (#859).
   Réparé dans `_catalogue.ts` (CHA-33 : type `etape_pipeline`, plus de `max`, on choisit « Pipeline · Étape » par son nom,
   l'identifiant est enregistré puis relu par son nom) et dans `02-catalogue-actions.spec.ts` (`remplir` / `relire` traitent
   ce type comme un menu). Ajout dans `07-anglais.spec.ts` : l'option vide du menu est « — Pick a stage — ».
2. `06-publication:30` et `06-publication:65` — le titre du bandeau rouge du canevas s'accorde au nombre :
   « 1 chose à corriger avant de publier », « 3 choses à corriger avant de publier » (avant : « N chose(s)… ») :
   `src/pages/AutomationBuilderPage.tsx` l. 2123-2129, commit 1a1e9091 (#859). Les deux tests affirment maintenant le
   texte exact. Trois attentes NÉGATIVES sur l'ancien libellé passaient à vide et ont été remises sur le nouveau
   (`/^\d+ choses? à corriger avant de publier$/`) : `06-publication:60`, `06-publication:148` (test S-09, qui tombe
   maintenant sur le bandeau lui-même) et `03-champs-types:645` (seconde attente du test `@defaut` du champ disparu).
3. `03-champs-types:457` (« Démarrer une automatisation » › menu « Laquelle ») — le menu n'offre plus le préréglage
   RETIRÉ « Estimate Follow-Up (3 days) » (`preset_key = estimate_followup` sur `estimate.sent`, que plus rien n'émet) :
   `server/routes/automation-rules.ts` l. 211-215 et `src/lib/automationCatalogue.ts` l. 102-122, commit 098dd153.
   Vérifié en base (pile locale) : la règle absente du menu à la passe, `95b7dca4-…`, est bien ce préréglage, publié
   d'office à la création du bureau ; le bureau du tri en porte un aussi (`562362e3-…`). Le test compare maintenant le
   menu à « publié, vivant, pas la règle ouverte, pas un préréglage retiré » et affirme en plus que le préréglage
   retiré n'est PAS offert.

## Environnement

Aucun. Aucun test du dossier ne dépend du stockage de fichiers ni d'une clé d'IA ; le moniteur n'a relevé aucune
panne d'infrastructure pendant la relance.

## Encore rouge sans conclusion (et pourquoi)

Aucun : les 34 tests rouges sont les 34 `@defaut` du tableau.

Rien de fautif relevé dans `e2e/automations/_outils/`.

## Ce qui n'a pas été vérifié

- Projet « bureau » seulement (1440 × 900, Chromium) : aucun autre projet de la matrice n'a été relancé.
- Le code servi par le jeu de serveurs du tri (Vite 5194) est supposé être celui du worktree `wt-e2e` (HEAD = #889) ;
  je ne l'ai pas contrôlé autrement que par les résultats.
- Une seule relance complète du dossier : la stabilité d'une passe à l'autre n'est pas mesurée (les fichiers 02 et 06
  ont toutefois été relancés une fois chacun avant, avec le même résultat).
- Les gravités sont mon estimation, pas celles du tableau de l'audit (ces défauts n'y figurent pas : seuls
  actions-01 à actions-07 y sont, tous corrigés).
- Écart de méthode : les retraits de ` @defaut` et l'ajout du type `etape_pipeline` dans `02` ont été faits par un petit
  script Python passé en heredoc (délimiteur entre apostrophes, aucun `\` dans les chaînes remplacées, nombre
  d'occurrences contrôlé avant chaque remplacement) ; tout le reste par l'outil d'édition. Les fichiers ont été relus
  et relancés depuis : rien n'a été abîmé.
- Le cas « Champ personnalisé modifié » : le commentaire du catalogue dit que le serveur « tranchera à l'exécution » ;
  le test l'a marqué `@defaut` et je l'ai laissé tel (dans le doute : défaut).
