# actions — revérifié le 2026-10-02 sur la branche de correction : 17 défauts ouverts (20 tests, tous mineurs ou cosmétiques), 0 majeur

Dernière relance (dossier entier, pile locale, un worker, arbre `wt-verif` = `mission/auto-finale-u` à a80b2c25 + `main`) :
**183 tests — 163 passés, 20 échoués** (26,2 min). Les 20 échecs portent tous ` @defaut` et tombent chacun sur l'attente
qui décrit le défaut (relevé : `D:/lume-uiaudit/sorties/verif-actions/passe3-dossier-entier.txt`, `passe3-resultats.json`).
Aucun test sans marque n'échoue ; aucun test `@defaut` ne passe.

Avant la correction (tri du 2026-10-01, ancien produit) : 177 tests — 143 passés, 34 échoués `@defaut`.
Écart de 177 à 183 : six tests ajoutés pendant la revérification (un dans `06-publication`, cinq dans `08-messages-langue`).

Numéros de ligne = fichiers tels qu'ils sont sur disque après la revérification (`e2e/automations/actions/`).

## Défauts du produit encore ouverts

| Identifiants | Spec:ligne | Écran | Ce qu'on fait | Ce qu'on voit | Ce qu'on devrait voir | Gravité |
|---|---|---|---|---|---|---|
| CHA-33, ACT-14, EDT-018 (S-10, reste) | 06-publication:247 | Éditeur d'un brouillon dont l'étape « Déplacer l'opportunité » vise « Gagné » en texte libre (règle d'avant le menu, ou écrite hors écran) | Cliquer l'interrupteur « Publier ». | La confirmation « Publier cette automatisation ? » est proposée : « Gagné » n'est l'identifiant d'aucune étape, le déplacement échouerait. | Un refus qui nomme « L'étape visée ». (Le champ lui-même est devenu un menu : ce cas ne se crée plus à l'écran.) | mineur |
| EDT-105, CHA-24, EDT-126, EDT-022 | 03-champs-types:710 | Panneau « Mettre à jour un champ personnalisé » dont le champ a été archivé ou supprimé | Ouvrir l'étape. | Le panneau dit « Ce champ n'existe plus… », mais « Enregistrer » reste actif et le canevas n'affiche aucun bandeau « à corriger avant de publier ». | « Enregistrer » grisé, et le canevas annonce le problème avant la publication. | mineur |
| CHA-16, CHA-17, CHA-11, CHA-12, EDT-108 | 03-champs-types:358, :371 | Panneaux « Retirer une étiquette » et « Notifier l'équipe » | Saisir une étiquette puis cocher « Retirer toutes les étiquettes » ; ou choisir « Un membre précis », un membre, puis revenir à « Le propriétaire ». Enregistrer. | Le champ disparaît de l'écran mais sa valeur est enregistrée en base (`etiquette: "VIP QA"` à côté de `toutes: true` ; `membre_id` à côté de `destinataire: proprietaire`). | La base ne porte que ce que l'écran montre. | mineur |
| EDT-079 | 03-champs-types:408 | Panneau « Assigner un responsable » quand la lecture des membres échoue (500) | Ouvrir l'étape. | Un menu qui n'offre que « — Personne — », sans un mot. | Le panneau dit que la liste n'a pas pu être lue. | mineur |
| CHA-02, EDT-086 | 03-champs-types:138 | Panneau « Envoyer un courriel » › « Répondre à » | Taper « pas-une-adresse ». | « Enregistrer » reste actif, aucun message. | L'adresse fausse est signalée, l'étape n'est pas enregistrable telle quelle. | mineur |
| EDT-086, EDT-084, EDT-103, CHA-03, CHA-15, CHA-19 | 03-champs-types:104 | Panneaux : « Objet » (200), « L'étiquette » (60), « Source » (60), « Nom de l'action » (80) | Écrire au-delà de la limite. | La frappe est ignorée, sans compteur ni message (221 caractères écrits, 200 gardés ; 81 → 60 ; 96 → 80). | Un compteur ou « limite atteinte », comme sous les zones de texte. | mineur |
| CHA-07, EDT-037 | 03-champs-types:180 | Canevas › carte « Envoyer un texto » | Texte de l'étape : « Rabais si le total est < 500 $ ou > 1000 $ ». | La carte affiche « Rabais si le total est 1000 $ » : ce qui est entre « < » et « > » a disparu. | Le texte tel qu'il est écrit. | mineur |
| CHA-15, CHA-21, CHA-38, CHA-32, EDT-037 | 03-champs-types:798 | Canevas › cartes « Ajouter une étiquette », « Assigner un responsable », « Appeler un webhook », « Déplacer l'opportunité » | Regarder le parcours. | Les quatre cartes ne portent que le nom de l'action. | Quelle étiquette, quel membre, quelle adresse, quelle étape. | mineur |
| EDT-109, CHA-07, CHA-03, CHA-26 | 04-variables:91, :102 | Panneau d'un texto, d'un courriel, d'une tâche › boutons « Insérer une information du client » | Placer le curseur au milieu du texte, ou dans « Objet » / « Titre de la tâche », puis cliquer « Nom du client ». | La variable s'ajoute à la FIN du texte principal (« Bonjour , merci de votre confiance.[client_name] ») ; depuis « Objet » ou « Titre », elle part dans « Message » / « Détail ». | La variable s'insère là où est le curseur, dans le champ où l'on écrivait. | mineur |
| EDT-112, EDT-113, EDT-114 | 04-variables:122 | Panneau d'un texto sur « Devis envoyé » | Regarder les boutons de variables. | « Lien facture » et « Date du rendez-vous » sont offerts : sur un devis ils partiraient vides. (« Total » écrit `[invoice_total]`, que le serveur ne remplit pas non plus sur un devis — `resolveEntityVariables` ; le test ne l'affirme pas.) | Seulement les variables que ce déclencheur sait remplir. | mineur |
| EDT-104, EDT-126 | 05-panneau-etape:187 | Panneau d'un texto › « Quoi faire » | Passer à « Envoyer un courriel ». | « Objet » est vide et « Enregistrer » grisé : aucun objet de départ n'est proposé (alors que la même action ajoutée par le tiroir naît avec « Un message de [company_name] »). | L'objet reçoit son texte de départ ; l'étape reste enregistrable. | mineur |
| EDT-104, EDT-126, ACT-17 | 05-panneau-etape:197 | Panneau d'une étape « Envoyer la facture » sur « Nouveau prospect » (déclencheur changé après coup) | Ouvrir l'étape. | Le refus est bien dit, mais le menu « Quoi faire » affiche « Envoyer un courriel » alors que l'étape est « Envoyer la facture ». | Le menu ne montre pas une autre action à la place de celle de l'étape. | mineur |
| ACT-05, CHA-14, EDT-104, EDT-126 | 05-panneau-etape:209 | Panneau d'une étape « Envoyer dans Slack » déjà présente | Ouvrir l'étape (le canevas, lui, la signale). | Le panneau ne dit rien de l'indisponibilité, « Enregistrer » est actif, « Quoi faire » affiche « Envoyer un courriel ». | « Bientôt : la connexion à votre Slack n'existe pas encore. » dans le panneau, « Enregistrer » grisé. | mineur |
| EDT-057, EDT-059 | 01-tiroir-actions:83 | Tiroir « Actions » › recherche | Taper « webhook » (il ne reste qu'« Appeler un webhook ») puis Entrée. | Rien. | L'unique action restante est choisie : son panneau s'ouvre. | mineur |
| ACT-05, EDT-063 | 01-tiroir-actions:208 | Tiroir « Actions » › « Envoyer dans Slack » (grisée) | L'atteindre au clavier ou au lecteur d'écran. | Bouton `disabled` : hors de l'ordre de tabulation, la raison n'est lisible qu'à la souris. | L'action grisée est atteignable et sa raison lisible. | mineur |
| EDT-101, EDT-130 | 05-panneau-etape:112, 07-anglais:230 | Panneau d'une étape « Attendre » (ou « Condition ») | Ouvrir l'étape. | L'onglet s'appelle « Modifier l'action » / « Edit action » et le bouton anglais « Save action » : une attente n'est pas une action. | Un libellé qui vaut pour toute étape. | cosmétique |
| CHA-07, EDT-037 (nouveau, signalé par la session de correction) | 08-messages-langue:236 | Canevas › carte « Envoyer un texto » d'une étape qui porte `body` et `body_en`, dans un bureau qui envoie en ANGLAIS | Regarder le parcours. | La carte résume `body`, le français (« Rabais de 10 % jusqu'au 1er mai. »), alors que le panneau montre — et que le moteur envoie — l'anglais. | La carte résume le texte qui part. | mineur |

20 tests pour 17 défauts.

## Défauts corrigés depuis (marqueur @defaut retiré)

### Revérification du 2026-10-02 — correctifs de la branche `mission/auto-finale-u` (table `D:/lume-final/notes/U-corrections.md`)

Onze lignes de l'ancien tableau sont fermées. Quinze des 34 tests `@defaut` sont passés au vert : dix tels quels (la
marque seule a été retirée), cinq dont le geste a été réécrit pour le comportement décidé (voir « Specs adaptées » :
`03:240`, `03:477`, `07:258`, `08:74`, `08:115`). Les 19 autres sont toujours rouges ; un vingtième `@defaut` est neuf (`08:236`).

| Ligne (table U) | Défaut | Commit | Spec:ligne verte |
|---|---|---|---|
| 1 | Publiée : une étape choisie dans le tiroir était écrite en base (donc mise en ligne) 3 s plus tard, sans « Enregistrer ». | `3b739958` | `06-publication:155` (tel quel) ; `06-publication:180` (neuf : 5,5 s d'attente, aucune écriture, ligne de la règle identique `updated_at` compris ; « Fermer sans ajouter cette étape ? » → « Ne pas l'ajouter » : plus de carte, base identique, encore après rechargement) |
| 2 | Version anglaise (`body_en`) invisible, périmée en silence. | `539be241` ajusté par `a80b2c25` | `08-messages-langue:74`, `:104`, `:115`, `:156` (bureau français) ; `:195`, `:220` (bureau qui envoie en anglais, état provoqué) |
| 3 | Courriel fourni converti : HTML brut dans « Message ». | `d6685b42` | `08-messages-langue:252` (tel quel) |
| 4 | « Attendre » 3 jours, retaper 5 donnait 5 minutes. | `cf1620d4` | `05-panneau-etape:325` (tel quel) |
| 5 | « Date atteinte » sur un champ du pipeline : le tiroir offrait ce que le canevas et le serveur refusaient. | `163e541c` | `01-tiroir-actions:277` cas « Date atteinte (sur un champ date du pipeline) » ; `06-publication:130` (tels quels) |
| 6 | « Appel reçu de l'extérieur » : six actions offertes et publiées, qui échouent à chaque passage. | `09dc78f8` | `01-tiroir-actions:277` cas « Appel reçu de l'extérieur » (tel quel) |
| 7 (mineure) | « Champ personnalisé modifié » sur un champ du client : le tiroir grisait les six actions, le serveur publiait. | `163e541c` | `01-tiroir-actions:277` cas « Champ personnalisé modifié (sur un champ du client) » (tel quel) |
| 8 | 999 ou -5 jours, 10 000 001 $ passaient « Enregistrer », puis le serveur refusait tout le parcours sans dire où. | `71d2b5e9` | `03-champs-types:217` (tel quel) ; `03-champs-types:240` (réécrit) |
| 9 | Adresse de webhook en `http://`, mal formée ou interne. | `71d2b5e9` | `03-champs-types:459` (tel quel) ; `03-champs-types:477` (réécrit) |
| 24 (mineure) | Interface anglaise : le refus du serveur s'affichait en français. | `71d2b5e9` | `07-anglais:258` (réécrit) |
| — (mineure, `05:345`) | « Attendre » 900 jours : « Enregistrer » restait actif. | `59ed48b5` | `05-panneau-etape:345` (tel quel — le test n'affirme que « Enregistrer » désactivé, pas le texte de la limite) |

### Tri du 2026-10-01

11 tests `@defaut` passaient à la passe, et passent encore à la relance ; ` @defaut` retiré du titre, rien d'autre.

- `01-tiroir-actions:76` — [EDT-057] à l'ouverture du tiroir, le curseur est dans la recherche (`TiroirChoix.tsx`, focus à l'ouverture).
- `02-catalogue-actions:143` — [CHA-09][ACT-03] « Notifier l'équipe » naît avec « Suivi à faire pour [client_name] » (constat actions-02, #870). Le titre était calculé : `${a.cle === 'create_notification' ? ' @defaut' : ''}` retiré.
- `02-catalogue-actions:163` × 5 — [CHA-11], [CHA-28], [CHA-31], [CHA-32], [CHA-40] : l'option vide des menus ne dit plus « — Inchangé — » là où rien n'est à laisser inchangé (constat actions-03, #870). Titre calculé : `${trompeur ? ' @defaut' : ''}` retiré, avec la constante `trompeur` devenue inutile.
- `04-variables:213` et `:221` — [EDT-132] « Variable inconnue : [x] — sera vide dans le message envoyé. » (#840).
- `04-variables:254` — [EDT-133] « 200 / 1600 · 2 SMS » (constat actions-04, #840).
- `06-publication:232` — [CHA-33] « L'étape visée » est un menu des étapes du pipeline (constat actions-01, #859).

## Specs adaptées à la revérification du 2026-10-02 (comportements décidés)

1. **Une étape choisie dans le tiroir n'entre dans le parcours qu'à « Enregistrer » de son panneau** (`3b739958`).
   - `_aides.ts` : `enregistrerEtape` (clic sur « Enregistrer », le panneau se ferme), `ecrituresVers` (les requêtes
     d'écriture de l'éditeur sur une règle), `laisserPasserLEnregistrementAuto` (5,5 s, pour prouver une absence).
     `creerBrouillonAvecAction` écrit en base et n'est pas concerné.
   - `01-tiroir-actions:125`, `:145`, `:164` (« Attendre », « Condition », « Arrêter ici ») : après le choix, la base porte
     encore UNE étape ; « Enregistrer » ; puis les mêmes attentes qu'avant sur la base.
   - `07-anglais:100` (×20) : la base est vide après le choix ; pour les 14 actions dont chaque champ obligatoire naît avec un
     texte de départ, « Save action » puis la base porte le brouillon ANGLAIS (plus `destinataire: membre` pour « Notify the
     team », seul réglage que le test change lui-même).
   - Les tests de `02-catalogue-actions` cliquaient déjà « Enregistrer » : inchangés.
2. **Le panneau d'étape refuse lui-même une saisie invalide, rien ne part** (`71d2b5e9`).
   - `03-champs-types:240` (ex-`:229`) et `:477` (ex-`:436`) : le geste « Enregistrer puis lire le message du serveur »
     n'existe plus. Le test affirme : la raison écrite deux fois (encadré et à côté du bouton), avec la borne ;
     « Enregistrer » désactivé, même au clic forcé ; aucune requête d'écriture en 5,5 s ; aucun message de refus ; indicateur
     sur « Enregistré » ; base inchangée. Le refus du SERVEUR est gardé, par un appel direct : 400, « Étape 1 (« … ») :
     « … » doit être au plus 365. », sans « nouvel essai ». `moniteur.attendu(400 PATCH)` retiré (ce 400 ne passe plus par l'écran).
   - `07-anglais:258` (ex-`:239`) : mêmes deux moitiés en anglais (adresse et nombre), et le refus du serveur avec
     `Accept-Language: en`.
3. **Version anglaise d'un message** (`539be241` ajusté par `a80b2c25`) — `08-messages-langue:74` (ex-`:56`) et `:115`
   (ex-`:70`) réécrits, `:104`, `:156`, `:195`, `:220`, `:236` ajoutés. Le bureau anglais est PROVOQUÉ : la lecture de
   `company_settings.default_language` par l'éditeur est rendue « en » pour l'onglet ; la base du bureau reste en français.
4. **`04-variables:54` (ex-`:40`)** : exigeait les 6 boutons de variable sur « Devis envoyé », ce que `:122` (ex-`:101`)
   décrit comme un défaut. Tranché par ce que le serveur remplit (`resolveEntityVariables`) : chaque bouton est éprouvé sur
   un déclencheur qui remplit sa variable (devis : nom, entreprise, lien du devis ; facture : total, lien facture ;
   rendez-vous : date). Le test d'origine était vert sur le produit d'aujourd'hui (les 6 boutons sont offerts partout).
   Restent dépendants des 6 boutons sur « Devis envoyé » : `04-variables:234` et `07-anglais:172` (non modifiés).

## Specs réparées au tri du 2026-10-01 (ce qui avait changé dans le produit, et le commit ou le fichier qui le prouve)

Cinq tests rouges à la passe, verts à la relance.

1. `02-catalogue-actions:69` (garde du catalogue) et `02-catalogue-actions:90` cas « Déplacer l'opportunité » —
   « L'étape visée » (`stage_id`) est un MENU des étapes du bureau, plus un champ de texte de 40 caractères :
   `src/lib/automationCatalogue.ts` (`type: 'etape_pipeline'`, sans `max`), commit 1a1e9091 (#859).
   Réparé dans `_catalogue.ts` (CHA-33 : type `etape_pipeline`, plus de `max`, on choisit « Pipeline · Étape » par son nom,
   l'identifiant est enregistré puis relu par son nom) et dans `02-catalogue-actions.spec.ts` (`remplir` / `relire` traitent
   ce type comme un menu). Ajout dans `07-anglais.spec.ts` : l'option vide du menu est « — Pick a stage — ».
2. `06-publication:31` et `06-publication:66` — le titre du bandeau rouge du canevas s'accorde au nombre :
   « 1 chose à corriger avant de publier », « 3 choses à corriger avant de publier » (avant : « N chose(s)… ») :
   `src/pages/AutomationBuilderPage.tsx`, commit 1a1e9091 (#859). Les deux tests affirment maintenant le
   texte exact. Trois attentes NÉGATIVES sur l'ancien libellé passaient à vide et ont été remises sur le nouveau
   (`/^\d+ choses? à corriger avant de publier$/`) : dans `06-publication:31`, `06-publication:130` (test S-09) et
   `03-champs-types:710` (seconde attente du test `@defaut` du champ disparu).
3. `03-champs-types:528` (« Démarrer une automatisation » › menu « Laquelle ») — le menu n'offre plus le préréglage
   RETIRÉ « Estimate Follow-Up (3 days) » (`preset_key = estimate_followup` sur `estimate.sent`, que plus rien n'émet) :
   `server/routes/automation-rules.ts` et `src/lib/automationCatalogue.ts`, commit 098dd153. Le test compare le
   menu à « publié, vivant, pas la règle ouverte, pas un préréglage retiré » et affirme que le préréglage retiré n'est PAS offert.

## Environnement

- Passe « tel quel » du 2026-10-02 (avant adaptation) : deux échecs `ERR_NO_BUFFER_SPACE` (`02-catalogue-actions:90`
  « Envoyer la facture », `04-variables:40`), verts à la relance.
- Première tentative de la relance finale : « L'API ne répond pas après 120 s » (aucun test lancé) ; la même commande,
  relancée, a tourné en entier.
- Le poste a redémarré pendant une relance partielle (`passe1-04-06-08.txt`, inachevée, non comptée).

## Encore rouge sans conclusion (et pourquoi)

Aucun : les 20 tests rouges sont les 20 `@defaut` du tableau.

## Ce qui n'a pas été vérifié

- Projet « bureau » seulement (1440 × 900, Chromium) : aucun autre projet de la matrice n'a été relancé.
- Une seule relance complète du dossier après adaptation ; chaque fichier adapté a toutefois tourné une fois avant, avec
  le même résultat.
- Le bureau anglais est simulé à la lecture de la langue (voir plus haut) : l'envoi réel d'un texto en anglais par le
  moteur après « retirer la version française » n'est pas éprouvé ici.
- La version anglaise de l'OBJET d'un courriel (`subject_en`) : aucun test du dossier ne la corrige à l'écran.
- `05-panneau-etape:345` : seul « Enregistrer » désactivé est affirmé ; la phrase de la limite n'est pas lue par le test.
- Les gravités sont l'estimation du tri, pas celles du tableau de l'audit.
