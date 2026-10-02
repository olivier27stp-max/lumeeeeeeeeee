# editeur — après les correctifs « majeurs » (2026-10-02) : 186 tests, 150 verts, 35 rouges `@defaut`, 1 rouge sans marque (régression)

**Revérification du 2026-10-02**, sur `D:/lume-uiaudit/wt-verif` (branche de correction `mission/auto-finale-u` à a80b2c25 + `main`),
pile locale. Les 12 lignes « majeur » de ce lot et les deux constats prioritaires (A-01, A-09) sont FERMÉS au vrai navigateur ;
deux mineurs le sont du même coup (12:161 → 198, 14:80). Quatorze marqueurs `@defaut` retirés : il en reste 35, tous mineurs ou
cosmétiques, tous rouges sur leur attente. **Un test sans marque est rouge : une régression du correctif EDT-166** (voir
« Régression relevée à la revérification »). Le dossier compte 186 tests : deux ont été ajoutés (A-01 ; l'étape en cours
d'ajout à la sortie). Détail : sections « Défauts corrigés depuis », « Specs adaptées le 2026-10-02 » et « Dernière relance ».

Ce qui suit, jusqu'à la section « Régression », est l'état du TRI du 2026-10-01, tenu à jour (lignes déplacées, numéros de
ligne actuels).

Passe d'origine : 183 tests du dossier, 113 verts, 70 rouges (`sorties/e2e-local/passe1.txt`).
Dernière relance : voir « Dernière relance » en bas.

À savoir avant de lire :

- **145 des 183 tests n'avaient jamais tourné** avant la passe (`sorties/editeur/a-relancer.md`). Un test SANS marque qui tombait
  n'avait donc, le plus souvent, jamais été vu vert ; un test `@defaut` affirmait une piste lue dans le code (S-01, S-03…), pas
  un rouge déjà observé. Chacun a été rejugé sur ce qu'il fait aujourd'hui.
- **Le dossier compte maintenant 184 tests** : un test `@defaut` a été AJOUTÉ (05b:303) pour un défaut trouvé en instruisant
  un autre test. Rien n'a été retiré, sauté ni assoupli.
- **49 tests `@defaut` restent rouges**, et non 47 : les 47 défauts tirés des 70 échecs, plus un `@defaut` que la passe comptait
  VERT à tort (10:241, faux vert — voir plus bas), plus le test ajouté.

## Défauts du produit encore ouverts

35 tests (49 au tri du 2026-10-01), tous marqués `@defaut`, rouges sur l'attente qui décrit le défaut (pas sur un sélecteur
vieilli). Aucun n'a de numéro au tableau des constats (§ 8 de `AUTOMATIONS_UI_AUDIT.md`) : ce sont les « pistes » de la carte
(S-xx), confirmées ici par une exécution. Les numéros de ligne sont ceux des fichiers au 2026-10-02.

### Perte de travail ou envoi qui ne correspond pas à l'écran (majeurs) — TOUS FERMÉS le 2026-10-02

Les douze lignes ci-dessous sont gardées pour mémoire (ce qu'on voyait AVANT) ; chacune est reprise, avec son commit et la
ligne actuelle du test vert, dans « Défauts corrigés depuis — revérification du 2026-10-02 ». Les numéros de ligne de ce
tableau sont ceux du tri.

| Identifiants | Spec:ligne | Écran | Ce qu'on fait | Ce qu'on voit | Ce qu'on devrait voir | Gravité |
|---|---|---|---|---|---|---|
| EDT-139, S-01 | 07-clavardage-lumi:274 | Éditeur, après une demande à Lumi qui crée une 2e automatisation (réponse de Lumi simulée, tout le reste réel) | On clique « Ouvrir » sur le toast « … créée en brouillon », sur un réseau lent (6 s pour charger l'autre automatisation) | L'éditeur de la 2e automatisation affiche le NOM de la 1re et le parcours que Lumi venait de poser dans la 1re, sous le déclencheur de la 2e, avec « Enregistré » : l'enregistrement automatique de la 1re est parti dans la 2e pendant le chargement | Chaque automatisation garde son nom et son parcours ; ce que Lumi a posé dans la 1re y est enregistré | majeur |
| EDT-137, S-03 | 07-clavardage-lumi:251 | Éditeur d'une automatisation PUBLIÉE, champ de Lumi (réponse simulée) | On demande un parcours à Lumi | Toast « Lumi a construit le parcours — en pause, à publier quand tu es prêt. » alors que l'automatisation est publiée ; trois secondes plus tard l'enregistrement automatique a REMPLACÉ le parcours en ligne par celui de Lumi (vérifié en base : nouveau parcours, toujours publiée), sans aucune question | Une question avant de remplacer un parcours en ligne, et un message qui ne dit pas « en pause » | majeur |
| EDT-012 (nouveau) | 12-enregistrement:86 | Éditeur, enregistrement automatique | On modifie une étape pendant que le serveur répond une fois « trop de requêtes » (429) | L'indicateur passe à « Enregistrement… » et y reste pour de bon ; un seul envoi part (vu dans la trace), aucun nouvel essai ; la modification n'atteint jamais la base, aucun message | Un nouvel essai 1,5 s plus tard (c'est ce que le code annonce), puis « Enregistré » | majeur |
| EDT-060, EDT-012, S-04 | 12-enregistrement:122 | Éditeur, « Ajouter » → « Attendre » en dernière étape (geste normal) | On enregistre l'étape | Toast « Enregistrement impossible pour le moment — nouvel essai automatique. (La séquence se termine par une attente : rien ne se passera après.) », et l'éditeur renvoie le même parcours refusé en boucle (400 après 400) | Un refus dit comme un refus (quoi corriger), sans promesse de nouvel essai et sans boucle | majeur |
| EDT-012, S-04 | 12-enregistrement:144 | Même situation, puis on réécrit un autre texto | On modifie une autre étape pendant que le refus dure | Le texto réécrit n'est pas en base ; l'indicateur dit « Modifié », comme si l'enregistrement allait venir | Soit la modification valide est enregistrée, soit l'écran dit clairement que RIEN ne s'enregistre tant que l'attente finale est là | majeur |
| EDT-012, S-13 | 12-enregistrement:186 | La même automatisation ouverte dans deux onglets | On modifie une étape dans l'onglet 1 (enregistré), puis une AUTRE étape dans l'onglet 2, ouvert avant | L'onglet 2 enregistre tout son parcours : la modification de l'onglet 1 disparaît de la base, sans avertissement dans aucun des deux | Un avertissement (« modifiée ailleurs, recharger »), ou les deux modifications gardées | majeur |
| EDT-047, EDT-028 (nouveau, test ajouté) | 05b-canevas-outils-origine:303 | Éditeur d'un parcours converti depuis le « format d'origine » (« Convertir en parcours modifiable ») | On supprime la dernière étape et on confirme | L'étape supprimée revient aussitôt, sous le bandeau « Parcours au format d'origine », en lecture seule ; la base a bien `steps` vide mais `actions` porte toujours l'ancien message. On ne peut pas vider un parcours converti — et sur une automatisation publiée, le message « supprimé » continue de partir (vu à la passe sur 12:155, avant correction de sa donnée) | Un canevas vide (« Ajouter une première étape ») ; pour une automatisation publiée, le refus « Cette automatisation est publiée : … » | majeur |
| EDT-062, S-12 | 05-canevas-edition:365 | Canevas, « + » entre la 1re et la 2e carte → « Arrêter ici » | On insère l'arrêt au milieu d'un parcours de trois textos | Les deux textos suivants disparaissent du canevas, sans question ni message | Une question (« la suite sera retirée »), ou la suite gardée | majeur |
| EDT-047, S-12 | 05-canevas-edition:347 | Canevas, menu « ··· » d'une condition dont les deux branches portent des étapes | « Supprimer l'étape », confirmé (« ce qui venait après reste dans le parcours et se rebranche tout seul ») | La branche « si non » n'est plus à l'écran, mais son étape reste dans la règle en base, reliée à rien | Ce qui reste en base est à l'écran — ou le dialogue dit que la branche « si non » sera retirée, et elle l'est vraiment | majeur |
| EDT-166 | 11-dialogues-gardes-panneaux:113 | Éditeur, bouton « Précédent » du navigateur | On réécrit un texto, on laisse une étape incomplète, puis « Précédent » | L'éditeur est quitté : le texto réécrit ET l'étape ajoutée sont perdus ; un toast le dit après coup | La question « Quitter sans enregistrer ? », comme le fait « Mes automatisations » | majeur |
| EDT-018, EDT-019, S-32 | 15-pause-globale:20 | Éditeur d'une automatisation publiée, bureau mis en pause globale (« Tout arrêter ») | On ouvre l'automatisation | « Publiée », en vert, sans un mot : rien ne dit qu'elle n'envoie plus rien (la liste, elle, l'affiche) | Un bandeau ou une mention « en pause » dans l'éditeur | majeur |
| EDT-147, S-08 | 08-onglet-reglages:174 | Onglet « Réglages » d'une automatisation dont la case « Arrêter si… » du déclencheur a été DÉCOCHÉE (`arreter_si_resolu: false`) | On bascule « Jours ouvrables seulement » | En base, `arreter_si_resolu: false` a disparu : la sortie automatique redevient active sans que personne l'ait demandé | La case reste décochée | majeur (sous drapeau `auto_sortie_parcours`) — même défaut que declencheurs 03:647 |

### Gestes qui jettent une saisie ou surprennent (mineurs)

| Identifiants | Spec:ligne | Écran | Ce qu'on fait | Ce qu'on voit | Ce qu'on devrait voir | Gravité |
|---|---|---|---|---|---|---|
| EDT-164, S-05 | 11-dialogues-gardes-panneaux:250 (cas « onglet Réglages ») | Panneau d'étape, saisie en cours | On tape un message, puis on va sur l'onglet « Réglages » et on revient | Le texte tapé a disparu, sans question | La question « Fermer l'étape sans enregistrer ? », ou la saisie gardée au retour | mineur |
| EDT-164, S-05 | 11-dialogues-gardes-panneaux:250 (cas « dupliquer ») | Panneau d'étape, saisie en cours | On tape un message, puis menu « ··· » d'une autre carte → « Dupliquer l'action » | Le panneau passe à la copie : le texte tapé a disparu, sans question | La même question que pour un changement d'étape | mineur |
| EDT-032, S-06 | 11-dialogues-gardes-panneaux:288 | Panneau « Réglages du déclencheur » | On tape une étiquette dans « Seulement si le client a l'étiquette », puis la croix « Fermer » | Le panneau se ferme, la saisie est jetée sans question (le panneau d'étape, lui, demande) | La question « Fermer les réglages sans enregistrer ? » | mineur — même défaut que declencheurs 03:62 |
| EDT-023, S-14 | 07-clavardage-lumi:461 | Éditeur, forfait sans Lumi, carte « Construire avec Lumi — inclus dans Autopilot » | Le parcours porte une étape incomplète et un texto vient d'être réécrit (« 1 étape(s) à compléter ») ; on clique « Voir Autopilot » | L'éditeur est quitté pour la facturation sans question : le texto réécrit est perdu (toast après coup). Revu le 2026-10-02 : toujours ouvert — « Mes automatisations » et « Précédent » demandent, ce bouton non | « Quitter sans enregistrer ? » | mineur |
| EDT-018 | 04-onglets-apercu-publication:221 | Interrupteur « Publier l'automatisation » | Double-clic | La confirmation s'ouvre et se referme aussitôt (le 2e clic tombe sur le voile) : rien ne se passe, rien ne l'explique | La confirmation reste à l'écran | mineur |
| EDT-021, S-45 | 05b-canevas-outils-origine:77 | Canevas, outil main actif | On glisse le canevas en partant d'une carte | Le canevas se déplace ET le panneau de la carte s'ouvre | Le canevas se déplace, rien ne s'ouvre | mineur |
| EDT-008, S-17 | 02-barre-du-haut:119 | Barre du haut, nom en cours de modification | On tape un nouveau nom, puis Échap | La saisie est gardée (et enregistrée) | Échap annule et rend l'ancien nom | mineur |
| EDT-137 (nouveau) | 07-clavardage-lumi:121 | `/automations/nouvelle?lumi=1`, demande envoyée à Lumi qui échoue | On envoie une demande ; Lumi ne construit rien | L'éditeur redevient bien un brouillon local et aucun brouillon vivant ne reste dans la liste, mais une « Nouvelle automatisation » vide est partie à la corbeille (suppression douce) : l'onglet « Corbeille » en montre une de plus à chaque demande qui échoue | Rien dans la corbeille que l'utilisateur n'y ait mis | cosmétique — à décider (voir note 1) |

### Clavier, focus, lecteur d'écran (mineurs)

| Identifiants | Spec:ligne | Écran | Ce qu'on fait | Ce qu'on voit | Ce qu'on devrait voir | Gravité |
|---|---|---|---|---|---|---|
| EDT-037, S-42 | 13-clavier-focus:112 (cas « panneau d'étape ») | Panneau d'étape, sans saisie en cours | Échap | Rien : le panneau reste | Le panneau se ferme | mineur |
| EDT-032, S-42 | 13-clavier-focus:112 (cas « panneau du déclencheur ») | Panneau « Réglages du déclencheur » | Échap | Rien | Le panneau se ferme | mineur |
| EDT-044, S-42 | 13-clavier-focus:112 (cas « menu ··· ») | Menu « ··· » d'une carte | Échap | Rien : il faut cliquer à côté | Le menu se ferme | mineur |
| EDT-055, S-42 | 13-clavier-focus:112 (cas « aperçu ») | Fenêtre « Ce qui partirait » | Échap | Rien : il faut viser la croix | L'aperçu se ferme | mineur |
| EDT-037, S-43 | 13-clavier-focus:124 | Canevas, au clavier | Entrée sur une carte | Le panneau s'ouvre mais le focus reste sur la carte : 11 appuis sur Tab pour l'atteindre | Le focus entre dans le panneau | mineur |
| EDT-100, EDT-037, S-43 | 13-clavier-focus:137 | Panneau d'étape | On ferme le panneau | Le focus n'est plus nulle part : au clavier on repart du début de la page | Le focus revient à la carte | mineur |
| EDT-013 à EDT-016, S-43 | 13-clavier-focus:147 | Onglets Parcours / Réglages / Historique / Journaux | Flèche droite sur « Parcours » | Rien (les onglets portent `role="tab"`, qui annonce cette navigation) | Le focus passe à « Réglages » | mineur |
| EDT-055, S-43 | 13-clavier-focus:156 | Fenêtre « Ce qui partirait » | On ouvre l'aperçu | Il recouvre le canevas sans être annoncé comme un dialogue ni retenir le focus : Tab continue dans les cartes masquées | Un dialogue (rôle, focus retenu) | mineur |
| EDT-154 | 11-dialogues-gardes-panneaux:360 | Dialogue de confirmation (« Supprimer cette étape ? ») | Tab plusieurs fois | Le focus sort du dialogue et atteint les boutons de l'app masquée derrière | Le focus tourne dans le dialogue | mineur |
| EDT-004, S-44 | 02-barre-du-haut:47 | Barre du haut, fenêtre de 600 px | On réduit la fenêtre | Le bouton de retour n'est plus qu'une flèche, sans nom : « bouton » pour un lecteur d'écran | Un nom (« Mes automatisations ») même quand le texte est masqué | mineur |

### Ce que l'écran dit mal (mineurs et cosmétiques)

| Identifiants | Spec:ligne | Écran | Ce qu'on fait | Ce qu'on voit | Ce qu'on devrait voir | Gravité |
|---|---|---|---|---|---|---|
| EDT-042, S-39 | 05-canevas-edition:245 | Canevas, menu « ··· » de la 5e carte | On ouvre le menu | Il s'ouvre en haut au centre du canevas, à 419 px de la carte : rien ne dit à quelle étape il se rapporte | À côté de la carte cliquée | mineur |
| EDT-037, EDT-038, S-38 | 05-canevas-edition:426 | Canevas, cartes sans texte de message | On regarde les cartes « Ajouter une étiquette », « Attendre » (mode « réponse du client »), « Appeler un webhook » | Les trois sont muettes : « Ajouter une étiquette » ne dit pas laquelle ; l'attente de la réponse du client s'affiche « Attendre · 2 jour(s) », comme une attente simple ; « Appeler un webhook » ne montre pas l'adresse | Chaque carte dit ce qu'elle fera : l'étiquette, « la réponse du client », l'adresse | mineur |
| EDT-041 | 05b-canevas-outils-origine:286 | Bandeau « Parcours au format d'origine », parcours NON convertible | On lit le bandeau | « Cliquez sur une étape pour la modifier… » et, dessous, « … il reste en lecture seule » | Une seule des deux phrases | cosmétique |
| EDT-137, S-30 | 07-clavardage-lumi:85 | Carte « Décris ton automatisation à Lumi » | On tape moins de 10 caractères, puis Entrée | Bouton « Construire » grisé, Entrée sans effet, sans un mot : on croit Lumi en panne | La raison (« décris-la en une phrase ») | mineur |
| EDT-017, S-28 | 04-onglets-apercu-publication:105 | Bouton « Aperçu » pendant une préparation lente | On clique | Le bouton est désactivé mais strictement identique (ni grisé, ni roue) | Un état visible | cosmétique |
| EDT-006 | 02-barre-du-haut:104 | Barre du haut, nom | On vide le nom, Entrée, puis on reclique le nom | Le titre affiche l'ancien nom, le champ rouvert est vide | Le champ rouvert montre le nom affiché | cosmétique |
| EDT-148, S-34 | 09-onglet-historique:106 | Onglet « Historique », filtre « Statut » | Une tâche est « En cours » dans le tableau | Le filtre n'offre pas « En cours » (Tous, En attente, Terminés, Échoués, Annulés) | « En cours » dans le filtre | mineur |
| EDT-149, S-34 | 09-onglet-historique:141 | Onglet « Historique », colonne « Étape en cours » | Une attente en cours (sans action), une étape « Texto » | « (e3) » seul pour l'attente, « Texto(e2) » : identifiants techniques, colonne vide pour l'attente | Le nom de l'étape, sans « (e2) » | mineur |
| EDT-149 | 09-onglet-historique:124 | Onglet « Historique », ligne en échec dont la cause n'est pas connue du traducteur | On lit la ligne | « TypeError: fetch failed (ECONNREFUSED 10.0.0.4:443) » | Une phrase en français (« erreur technique, réessayée N fois ») | mineur (voir note 2) |
| EDT-152 | 10-onglet-journaux:202 | Onglet « Journaux », même cas | On lit la ligne | « TypeError: Cannot read properties of undefined (reading 'email') », « Request failed with status code 502 » | Une phrase en français | mineur (voir note 2) |
| EDT-150, S-33 | 10-onglet-journaux:167 | Onglet « Journaux », filtre « Action » | On filtre sur « Courriel » | Le menu ne propose plus que « Toutes les actions » et « Courriel » : pour passer à « Texto » il faut repasser par « Toutes les actions » | Le menu garde toutes les actions de la période | mineur |
| EDT-151, constat f1-4 | 10-onglet-journaux:184 | Onglet « Journaux », filtre « Réussis » | On filtre | Les envois « Sauté » (client désabonné) sont comptés parmi les réussis | « Réussis » = ce qui est parti | mineur |
| EDT-150, EDT-152, S-33 | 10-onglet-journaux:220 | Onglet « Journaux », colonne « Action » | Des exécutions « ajouter une étiquette », « champ personnalisé », « envoyer la facture », « webhook » | La clé technique, sans accents : « ajouter etiquette », « update custom field », « envoyer facture », « webhook » | Le nom de l'action au catalogue | mineur |
| EDT-152, S-33 | 10-onglet-journaux:241 | Onglet « Journaux », règle qui a 230 exécutions | On ouvre l'onglet | « 200 ligne(s) », rien n'indique que 30 exécutions ne sont pas montrées, aucun moyen d'aller plus loin | Le dire (« les 200 plus récentes »), ou une suite | mineur — **compté VERT à la passe, à tort** (voir « Faux vert ») |
| EDT-152 | 10-onglet-journaux:267 | Onglet « Journaux », lecture en panne | La lecture échoue | « Les journaux n'ont pas pu être lus. », sans bouton pour relire : il faut changer d'onglet ou recharger | « Réessayer » | cosmétique |
| EDT-140 à EDT-147, S-36 | 16-anglais:92 | Onglet « Settings », interface en anglais | On ouvre le menu « From » | « 7 h », « 8 h », « 9 h »… (format français) ; le bouton « Back to 8 – 20 » | « 7 AM », « 8 AM »… | cosmétique |
| EDT-148 à EDT-152, S-34 | 16-anglais:106 | Onglet « Execution logs », interface en anglais | Une ligne « Skipped » | Le motif du saut est en français (« client désabonné des textos », écrit tel quel par le moteur) ; et le filtre de statut de « Enrollment history » s'intitule « All events » (le reste de l'historique est bien en anglais) | Le motif en anglais ; « All statuses » | mineur |

Note 1 — 07:120. Le correctif L-7 (audit V2) retire le brouillon vide par une suppression DOUCE (`retirerBrouillonVide`,
`server/routes/automation-rules.ts` l. 316-338) — c'est la règle du projet (« jamais de suppression dure »). Le test, écrit sans
avoir tourné, attendait « plus rien en base ». Ce que le correctif garantit est vérifié et vert dans le même test (aucun
brouillon vivant, rien de publié, l'éditeur revenu à `/automations/nouvelle?lumi=1`). Reste la « Nouvelle automatisation » à la
corbeille : dans le doute, laissé en défaut. Si vous jugez que la corbeille peut la porter, la dernière attente du test est à retirer.

Note 2 — 09:124 et 10:202. `raisonLisible` (`src/lib/automationJournauxApi.ts`) le dit en commentaire : « Une cause inconnue
reste affichée telle quelle — mieux vaut un message technique qu'un silence ». #881 a traduit les causes que le moteur écrit
(24 messages) ; une exception inattendue passe encore telle quelle. C'est un choix écrit, que le test conteste : à vous de trancher.

## Défauts corrigés depuis (marqueur @defaut retiré)

Quatorze. Neuf étaient verts à la passe et le sont restés à ma relance ; seul le marqueur a été retiré du titre.

| Spec:ligne | Ce qui est corrigé | Par |
|---|---|---|
| 01-chargement-liens-directs:61 | Pendant le chargement, l'écran dit qu'il charge (rôle « status » + « Chargement de l'automatisation… ») | #870 (EDITEUR-05) |
| 02-barre-du-haut:197 | Ctrl+Z annule la dernière modification du parcours | #870 (EDITEUR-06) |
| 05b-canevas-outils-origine:196 | La carte « Quand » nomme le déclencheur même quand le bureau n'a pas sa capacité (plus de `payment.failed`) | #870 (declencheurs-06) |
| 07-clavardage-lumi:72 | À 1440×900, la carte de Lumi ne repousse pas un parcours de 3 étapes sous l'écran | piste jamais confirmée par une exécution : infirmée (la carte n'a pas changé depuis le 2026-09-30) |
| 11-dialogues-gardes-panneaux:195 (cas « + ») | Saisie en cours, puis « + » : la question « Fermer l'étape sans enregistrer ? » est posée | #870 (`quandPanneauLibre`) |
| 11-dialogues-gardes-panneaux:245 | Un seul panneau à droite : ouvrir « Quand » ferme le panneau d'étape | #870 (EDITEUR-04) |
| 11-dialogues-gardes-panneaux:256 | « + » pendant que les réglages du déclencheur sont ouverts : le tiroir des actions s'affiche | #870 (EDITEUR-04) |
| 13-clavier-focus:112 (cas « tiroir des actions ») | Échap ferme le tiroir | #870 (`TiroirChoix.tsx`) |
| 13-clavier-focus:112 (cas « tiroir des déclencheurs ») | Échap ferme le tiroir | #870 (declencheurs-05) |

11:195 et 13:112 sont des tests à plusieurs cas sous un même titre : le marqueur est maintenant posé cas par cas
(`defaut: true / false`), pour que les cas corrigés le perdent sans que les cas ouverts le perdent aussi.

Cinq autres `@defaut` étaient ROUGES à la passe pour une raison de spec (ils butaient sur l'ancien écran avant d'arriver à leur
attente) ; une fois la spec ajustée ils passent : le défaut est corrigé, le marqueur est retiré. Ils sont comptés dans les specs réparées.

| Spec:ligne | Ce qui est corrigé | Par |
|---|---|---|
| 01-chargement-liens-directs:155 | Une automatisation à la corbeille ne s'ouvre plus comme une autre : écran « à la corbeille », « Restaurer » | #859 (EDITEUR-01) |
| 01-chargement-liens-directs:171 | On ne peut plus la modifier depuis son adresse : ni carte ni panneau, et le serveur refuse (409, en français) | #859 (EDITEUR-01) |
| 03-creation-de-zero:62 | Une automatisation jamais enregistrée dit « Pas encore enregistrée », plus « Enregistré » | #859 (EDITEUR-02) |
| 03-creation-de-zero:72 | La carte du déclencheur ne dit plus « Choisir le déclencheur » quand un déclencheur est en place | #859 (EDITEUR-03) |
| 06-tiroir-de-choix:100 | À l'ouverture du tiroir des déclencheurs, le curseur est dans la recherche | #870 (declencheurs-04) |

### Faux vert de la passe (marqueur GARDÉ)

`10-onglet-journaux:241` (« plus de 200 exécutions ») était compté vert, donc « corrigé ». Il ne l'est pas : le test acceptait
« un bouton dont le nom contient *plus* », et la barre latérale de l'app — restée dans le DOM derrière le calque de l'éditeur — a
un bouton « Plus » (rubrique du menu). `lireJournaux` plafonne toujours à 200 lignes et l'écran n'en dit rien. La recherche est
maintenant bornée à l'éditeur (`ecranEditeur`) : le test est rouge, sur son attente. Les neuf autres verts ont été relus un par
un contre le code pour écarter le même piège.

### Défauts corrigés depuis — revérification du 2026-10-02 (correctifs de `mission/auto-finale-u`)

Quatorze marqueurs retirés. Commits : ceux de la table `D:/lume-final/notes/U-corrections.md`. « Tel quel » = le test
d'origine est passé au vert sans qu'on y touche (seul le marqueur est retiré ; quand des attentes ont été AJOUTÉES derrière les
siennes, c'est dit). « Geste adapté » = le test butait sur l'ancien parcours avant d'arriver à son attente : le geste est
réécrit, l'attente qui prouve le défaut fermé est gardée (détail dans « Specs adaptées le 2026-10-02 »).

| Ligne du triage | Spec:ligne aujourd'hui | Ce qui est corrigé (vu au vrai navigateur, base relue) | Par | Comment |
|---|---|---|---|---|
| S-01 — 07:274 | 07-clavardage-lumi:313 | « Ouvrir » la 2e automatisation, chargement ralenti à 6 s : la 2e garde SON nom, SON déclencheur et SON parcours (une étape, « Texto de la DEUXIÈME », rien de Lumi) ; la 1re garde son nom et porte le parcours de Lumi ; 6 s plus tard aucune écriture retardataire n'est arrivée dans la 2e (`updated_at` identique) | `073e719f` | tel quel + attentes ajoutées |
| S-03 — 07:251 | 07-clavardage-lumi:252 | Automatisation publiée : la question « Appliquer les changements de Lumi ? » est affichée avec le résumé de la proposition ; tant qu'on n'a pas répondu, 6 s sans aucune écriture, canevas et base inchangés (`updated_at` identique) ; « Annuler » → « Changements de Lumi non appliqués… », rien d'écrit ; « Appliquer » → parcours de Lumi en ligne, message sans « en pause » | `8174ff74` | tel quel + attentes ajoutées (réponse de Lumi simulée) |
| 12:86 (429) | 12-enregistrement:86 | Après un 429, un nouvel essai part : « Enregistré », la modification est en base, jamais « Too many requests » | `dbc83989` | tel quel |
| S-04 — 12:122 | 12-enregistrement:122 | « Attendre » en dernière étape : UN seul envoi refusé (400), jamais renvoyé ; « Refusé — à corriger », bandeau « Enregistrement refusé : rien n'est enregistré tant que ce n'est pas corrigé. » avec la raison, aucun « nouvel essai automatique » ; une étape ajoutée après l'attente et tout s'enregistre | `27939ff8` | geste adapté (400 déclaré, indicateur) + attentes ajoutées |
| S-04 — 12:144 | 12-enregistrement:167 | Pendant le refus, l'écran dit que RIEN ne s'enregistre (« Refusé — à corriger » + bandeau) ; l'attente retirée, le texto réécrit entre-temps arrive en base | `27939ff8` | geste adapté + attentes ajoutées |
| S-13 — 12:186 (= A-09) | 12-enregistrement:223 | Deux onglets : l'écriture périmée de l'onglet 2 est refusée (409 `modifiee_ailleurs`, une seule fois, rien d'écrit) ; bandeau « Cette automatisation a été modifiée ailleurs (par Lumi ou dans un autre onglet). », indicateur « Modifiée ailleurs », « Recharger » → version de l'onglet 1 ; l'onglet 2 enregistre ensuite normalement (les deux modifications en base, aucun faux conflit) ; l'onglet 1, au retour sur sa fenêtre, se recharge sans question | `f01f2393` | geste adapté (409 déclaré sur l'onglet 2) + attentes ajoutées |
| 05b:303 | 05b-canevas-outils-origine:304 | Parcours converti : supprimer la dernière étape laisse un canevas vide, elle ne revient pas sous « format d'origine » | `4e29c110` | tel quel |
| S-12 — 05:365 | 05-canevas-edition:393 | « Arrêter ici » au milieu : question « Arrêter ici et retirer la suite ? » qui dit « les 2 étapes qui suivent… seront retirées » ; « Annuler » ne retire rien ; confirmé et enregistré, la suite est retirée de l'écran ET de la base (rien d'orphelin) | `0db8ce18` | tel quel + attentes ajoutées |
| S-12 — 05:347 | 05-canevas-edition:363 | Supprimer une condition : le dialogue dit « La branche « si non » (1 étape) sera retirée avec la condition. », et c'est vrai en base (4 étapes, toutes reliées), relu après rechargement | `0db8ce18` | geste adapté (le texte du dialogue attendu était l'ancienne promesse, fausse) |
| S-32 — 15:20 | 15-pause-globale:20 | Bureau en pause : l'éditeur d'une automatisation publiée affiche « Vos automatisations sont en pause. » | `9e6dc36f` | tel quel |
| S-08 — 08:174 | 08-onglet-reglages:174 | Basculer « Jours ouvrables seulement » garde `arreter_si_resolu: false` | `d5a5a231` | tel quel |
| EDT-166 — 11:113 | 11-dialogues-gardes-panneaux:161 | « Précédent » avec une étape incomplète et un texto réécrit : « Quitter sans enregistrer ? » est posée AVANT ; « Annuler » garde le travail à l'écran, et « Précédent » redemande | `6ce9a1cb` | geste adapté (l'état incomplet ne s'obtient plus par le tiroir) — **mais ce correctif a une régression, voir ci-dessous** |
| S-04 (mineur) — 12:161 | 12-enregistrement:198 | Casser une automatisation publiée : le refus seul (« Enregistrement refusé — Cette automatisation est publiée… »), sans « nouvel essai automatique » ; la base est protégée | `27939ff8` | tel quel |
| EDT-012 (mineur) — 14:80 | 14-long-parcours:80 | 50 étapes : le refus est dit comme un refus (« Refusé — à corriger », bandeau avec « Un parcours compte au plus 30 étapes »), envoyé une seule fois, sans promesse de nouvel essai | `27939ff8` | geste adapté (le test attendait 60 s l'un des deux anciens états) |

Constats prioritaires de la table, sans `@defaut` dans ce dossier au tri :

| Constat | Spec:ligne | Ce qui est vérifié | Par |
|---|---|---|---|
| A-01 — panneau d'étape périmé (« Lumi dit avoir changé le message, rien ne change ») | 07-clavardage-lumi:369 (test AJOUTÉ, réponse de Lumi simulée) | Panneau ouvert, rien de tapé : il prend le texte de Lumi, et son « Enregistrer » n'écrase pas Lumi (base relue). Saisie en cours : bandeau « Lumi a modifié cette étape pendant que vous l'éditiez. », la saisie est gardée, « Enregistrer » désactivé (« Choisissez d'abord quelle version garder. ») ; « Voir la version de Lumi » et « Garder ma version » font chacun ce qu'ils disent (base relue) | `2b27e032` |
| A-09 — écrasement silencieux | 12-enregistrement:223 | voir S-13 ci-dessus | `f01f2393` |

## Régression relevée à la revérification du 2026-10-02 (test SANS marque, rouge)

`11-dialogues-gardes-panneaux:125` — « [EDT-166] bouton « Précédent » du navigateur juste après une modification : elle est
enregistrée en partant ». Vert au tri du 2026-10-01 (alors ligne 87), rouge trois fois de suite depuis le correctif EDT-166
(`6ce9a1cb`) : passe « tel quel », relance ciblée, passe finale. Le test n'a pas été modifié.

- **Étapes** (un seul onglet, aucune écriture par le côté) : ouvrir une automatisation DEPUIS la liste ; cliquer une carte ;
  taper dans « Texte du message » ; « Enregistrer » du panneau ; bouton « Précédent » du navigateur.
- **Ce qu'on voit** : rien. L'adresse reste celle de l'éditeur, aucune question, aucun message ; l'indicateur passe à
  « Enregistré » (le travail n'est pas perdu : l'enregistrement automatique l'écrit sur place). Il faut appuyer une DEUXIÈME
  fois sur « Précédent » pour revenir à la liste.
- **Erreur** : `expect(page).toHaveURL(/\/automations$/)` — reçu `…/automations/<id>` pendant 60 s.
- **Cause, lue dans le code et mesurée** (sonde jetable, supprimée) : dès qu'une saisie commence dans un panneau, la garde
  pose une entrée d'historique en double (`history.length` 3 → 4, état `lumeGardeEditeur`). Quand il n'y a plus rien à
  perdre (panneau enregistré), l'effet retire son écouteur `popstate` mais laisse l'entrée en double : le premier
  « Précédent » la consomme en silence. Sans aucune saisie (carte ouverte puis refermée), un seul « Précédent » suffit.
  `AutomationBuilderPage.tsx`, effet `aPerdreEnPartant` (« LE BOUTON RETOUR DU NAVIGATEUR »).
- Même mécanique attendue après un ajout par le tiroir enregistré, ou une étape incomplète complétée (non rejoué séparément).

Aucun 409 `modifiee_ailleurs` n'a été rencontré dans un parcours ordinaire (un onglet, aucune écriture par le côté) : sur les
186 tests, le seul 409 est celui que 12:223 provoque exprès dans son second onglet ; le moniteur n'en a relevé aucun autre.

## Specs adaptées le 2026-10-02 (comportements décidés)

Aides communes ajoutées dans `editeur/_aides.ts` (rien de retiré) : `ajouterParLeTiroir` (choisir dans le tiroir PUIS
« Enregistrer » du panneau), `enregistrerPanneau`, `aucuneEcriture` (preuve qu'aucune écriture de règle ne part pendant N s),
`etiquetteVide` / `troisTextosEtUneIncomplete` / `rendreIncomplet` (l'état « 1 étape(s) à compléter » obtenu à partir d'un
parcours qui PORTE une étape incomplète, posée avant d'ouvrir l'éditeur), `bandeauModifieeAilleurs` ; `indicateur()` connaît
« Refusé — à corriger » et « Modifiée ailleurs ».

| Test (ligne au tri → aujourd'hui) | Ce qui a changé dans le produit | Ce que j'ai fait |
|---|---|---|
| 02:247 → 253 | `3b739958` : une étape du tiroir n'entre dans le parcours qu'à « Enregistrer » de son panneau, qui refuse un champ obligatoire vide. Une étape ne peut plus NAÎTRE incomplète | Deux moitiés. (1) Par le tiroir : « Ajouter une étiquette » → « Enregistrer » désactivé, « « L'étiquette » est vide. », 6 s sans écriture, indicateur « Enregistré », base intacte ; remplie et enregistrée → en base. (2) Parcours qui porte une étape incomplète + texto réécrit : toutes les attentes d'origine (« 1 étape(s) à compléter », bandeau cliquable, rien en base, compléter relance l'enregistrement) |
| 03:84 → 84 | idem : la ligne ne naît plus au clic dans le tiroir | Après le choix dans le tiroir : 6 s sans écriture, adresse toujours `/nouvelle`, « Pas encore enregistrée », rien en base. La naissance est vérifiée après « Enregistrer » du panneau (mêmes attentes qu'avant) |
| 05:332 → 333 (cité par la table) | idem : « Annuler » du panneau d'une étape neuve l'abandonne, après question | « Annuler » → « Fermer sans ajouter cette étape ? » → « Ne pas l'ajouter » : canevas et base intacts ; puis l'ajout est refait et enregistré, mêmes attentes qu'avant (la suite sous « si oui », 4 étapes) |
| 06:154 → 155 | idem | Attentes ajoutées : 6 s sans écriture et base intacte avant « Enregistrer » du panneau |
| 06:171 → 176 | idem | Les trois étapes sont enregistrées dans leur panneau (avant : « Annuler ») ; attentes inchangées |
| 11:31 → 34, 11:70 → 106 | idem : l'aide `rendreIncomplet` (cité par la table) ne peut plus produire une étape incomplète par le tiroir | Parcours de départ avec une étape incomplète + texto réécrit ; attentes d'origine gardées, la base est comparée par `updated_at` (jamais réécrite) |
| 11 (nouveau) → 56 | idem — le GESTE de l'ancienne aide (étape du tiroir, panneau refermé) | Test AJOUTÉ : « Fermer sans ajouter cette étape ? » (Annuler la garde) ; « Mes automatisations » → « Abandonner l'étape en cours d'ajout ? » (Annuler reste, « Ne pas l'ajouter » part) ; base jamais écrite |
| 11:101 → 143 | `6ce9a1cb` (EDT-166) : « Précédent » demande AVANT ; le toast d'après coup ne vaut plus quand on a répondu « Quitter » | Le test fixait l'ancien comportement (toast après coup). Il vérifie maintenant : la question, « Quitter » ramène à la liste, AUCUN toast « quittée sans enregistrer », base intacte |
| 07:340 → 461 (`@defaut`, toujours rouge) | `3b739958` | Geste adapté (parcours qui porte une étape incomplète) pour que le test arrive à SON attente ; elle échoue toujours : « Voir Autopilot » quitte sans question |
| 12:122, 12:144, 12:186, 14:80, 05:347, 11:113 | voir le tableau des défauts corrigés | 400 / 409 déclarés au moniteur, là où le refus existe toujours et où le test vérifie ce que l'écran en dit |

Aucune adaptation refusée. Rien n'a été sauté, toléré ni assoupli ; aucune attente d'origine n'a été retirée sans être
remplacée par celle du nouveau comportement (les deux remplacements : le texte du dialogue de 05:347, et le toast d'après
coup de 11:101).

## Specs réparées (ce qui avait changé dans le produit, et le commit ou le fichier qui le prouve)

### Le produit a changé exprès (15)

| Tests (ligne à la passe → ligne aujourd'hui) | Ce qui a changé | Preuve | Ce que j'ai fait |
|---|---|---|---|
| 01:148 → 155, 01:158 → 171 (`@defaut`), 01:173 → 189 | Une automatisation à la corbeille ne s'ouvre plus dans l'éditeur : écran dédié (son nom, « Cette automatisation est à la corbeille : elle ne se déclenche plus et ne se modifie pas… », « Restaurer », « Mes automatisations »), sans onglets, canevas ni interrupteur | #859, constat EDITEUR-01 : `src/pages/AutomationBuilderPage.tsx` l. 1819-1862 (`if (regle.deleted_at)`) ; `git log -S"elle ne se déclenche plus et ne se modifie pas"` → 1a1e9091. Côté serveur : `server/routes/automation-rules.ts` l. 574-587 (409) et `server/lib/automations-publication.ts` l. 105-110 (422) | Les trois tests attendent l'écran « à la corbeille » (texte entier), ses deux boutons, et l'ABSENCE des onglets, de l'interrupteur et des cartes. 171 : en plus, une écriture directe par l'API est refusée (409, « … restaurez-la pour la modifier. »), la base n'a pas bougé (`updated_at` identique). 189 : l'interrupteur n'existe plus, la publication directe par l'API est refusée (422, même phrase qu'avant), puis « Restaurer » rend l'éditeur, en brouillon, avec ses trois cartes (base : `deleted_at` nul, non publiée). Marqueur retiré sur 155 et 171 |
| 03:60 → 62 (`@defaut`) | L'indicateur d'une automatisation neuve dit « Pas encore enregistrée » | #859, constat EDITEUR-02 : `AutomationBuilderPage.tsx` l. 1944-1952 ; `git log -S"Pas encore enregistrée"` → 1a1e9091 | L'aide `indicateur()` (`_aides.ts`) connaît le nouvel état — sans lui elle ne trouvait aucun élément. Le test exige « Pas encore enregistrée », l'absence de « Enregistré » dans la barre, et toujours aucune ligne en base. Marqueur retiré |
| 03:46 → 47, 03:67 → 72 (`@defaut`), 06:24 → 25, 06:50 → 51, 06:62 → 65, 06:97 → 100 (`@defaut`) | La carte en pointillés du canevas vide ne dit plus « Choisir le déclencheur » avec le déclencheur en petit dessous : « Quand », le déclencheur en place, « Cliquer pour choisir un autre déclencheur » | #859, constat EDITEUR-03 : `AutomationBuilderPage.tsx` l. 2264-2283 ; `git log -S"Cliquer pour choisir un autre déclencheur"` → 1a1e9091 | Nouvelle aide `carteDeclencheurVide(page, 'Devis envoyé')` : le bouton par son nom ENTIER. 72 : l'ancien libellé n'existe plus, la carte porte l'invitation, et un clic ouvre bien le tiroir. 51 : après le choix, la carte nomme « Facture envoyée » et plus « Devis envoyé », avant et après rechargement. 25 : titre du test ajusté (« depuis la carte du déclencheur (canevas vide) »). Marqueur retiré sur 72 et 100 |
| 04:260 → 278, 05b:141 → 156, 05b:166 → 181 | Le bandeau des problèmes accorde le nombre : « 1 chose à corriger avant de publier », « 2 choses… », « Publiée mais cassée : 1 chose à corriger — rien ne part correctement » | #859 : `AutomationBuilderPage.tsx` l. 2123-2129 ; `git log -S"chose(s) à corriger"` → 1a1e9091 | Aide `titreBandeau(n, publiee)` ; le texte est exigé EXACT. 181 : en plus, jamais « avant de publier » sur une automatisation déjà publiée |
| 05b:108 → 109 | Un canevas vide et non publié n'affiche plus l'alerte rouge « 1 chose à corriger — ajoutez au moins une étape » ; la carte du déclencheur a changé de libellé (ligne du dessus) | #859 : `AutomationBuilderPage.tsx` l. 2108-2116 (`bloquantsVivants.length > 0 && (regle.is_active \|\| etapesAffichees.length > 0)`) | Le test exige l'ABSENCE du bandeau (ancien et nouveau libellé : `TOUT_BANDEAU`) à l'ouverture, vérifie que « Publier » dit toujours « Ajoutez au moins une étape… » (toast, pas de confirmation, interrupteur et base inchangés), puis les quatre boutons comme avant. L'attente négative de fin, écrite sur l'ancien libellé « chose(s) », passait à vide : elle porte maintenant sur les deux libellés |
| 07:198 → 205 | Le résumé flottant de Lumi ne s'affiche plus tant que la conversation est ouverte à gauche (il cachait la carte du déclencheur) ; il apparaît quand on la replie, réduit à sa première phrase | #855, constat P-005 : `AutomationBuilderPage.tsx` l. 2479-2502 (`resumeLumi && !(lumiLateral && !lumiReduit)`) ; `git log -S"!(lumiLateral && !lumiReduit)"` → 1bc5fa5d | Le test exige l'absence du bandeau conversation ouverte, le replie, exige le bandeau et son texte exact, le ferme par sa croix, rouvre la conversation et y retrouve la réponse. Le reste (bulle, « Lumi construit… », parcours posé, nom, enregistrement en base) est inchangé |

### La spec était fausse dès l'écriture — jamais exécutée avant la passe (5)

| Test (ligne à la passe → aujourd'hui) | Ce qui n'allait pas | Preuve | Ce que j'ai fait |
|---|---|---|---|
| 04:104 → 122 (et la même faute dans 04:54, 04:74, 04:87, 13:154, comptés ailleurs) | `getByRole('button', { name: 'Aperçu' })` désigne DEUX boutons : « Aperçu », et le bouton du nom de la règle, que le test avait appelée « … aperçu … » | Erreur de la passe : « strict mode violation … resolved to 2 elements » | Nom exact (`exact: true`) |
| 05b:27 → 28, 14:45 → 45 | `name: 'Réduire'` désigne aussi « Réduire le menu », le bouton de la barre latérale de l'app (dans le DOM derrière l'éditeur) | Le libellé de la barre latérale date du 2026-09-10 (`git log -S"Réduire le menu"` → dc954dba) : il a toujours été là | Nom exact, pour « Réduire », « Agrandir » et « Recadrer » |
| 05b:89 → 90 | `name: 'Recadrer'` désigne aussi le bouton du nom de la règle (« … recadrer ») | Erreur de la passe (2 éléments) | Nom exact |
| 05:262 → 262 | Le test affirmait qu'aucun bouton ne contient « Déplacer » ; or l'outil main du canevas s'appelle « Déplacer le canevas » | `git log -S"Déplacer le canevas"` → 344b356a (#523) : il a toujours été là | Le test regarde le MENU : ses quatre choix exactement (« Dupliquer l'action », « Modifier l'action », « Supprimer l'action », « Supprimer à partir d'ici »), aucun « Déplacer / Monter / Descendre » dedans ; et le seul « Déplacer » de l'écran est l'outil main. L'affirmation (on ne peut pas réordonner) est inchangée et plus précise qu'avant |

Compte des 20 specs réparées : 15 (le produit a changé : 01 × 3, 03 × 3, 06 × 4, 04:260, 05b:108, 05b:141, 05b:166, 07:198)
+ 5 (fausses dès l'écriture : 04:104, 05:262, 05b:27, 05b:89, 14:45).

## Tests fragiles rendus déterministes (3)

| Test (ligne à la passe → aujourd'hui) | De quoi il dépendait | Ce que j'ai fait |
|---|---|---|
| 04:54 → 59, 04:74 → 87 (aperçu) | D'un client AVEC courriel déjà présent dans le bureau : l'aperçu se calcule sur le client le plus récent qui en a un (`server/routes/automation-test.ts` l. 355-376) ; sinon il dit « Ajoutez un client avec une adresse courriel pour voir un aperçu. » et ne montre aucune étape. Mon bureau de tri, neuf, n'en avait pas. (Ces deux tests butaient d'abord sur le sélecteur « Aperçu » ambigu, réparé comme ci-dessus.) | Chaque test crée son client (`creerClientJoignable`, adresse en `@lume-qa.test`, bureau en bac à sable) et le supprime en `finally`. 59 vérifie en plus que l'aperçu dit sur QUI il est calculé (« Exemple avec <nom> · <courriel> · rien n'est envoyé ») — ce nom est celui du client du test, donc le plus récent du bureau |
| 08:88 → 88 (fenêtre d'envoi) | De l'ORDRE des clés d'un `jsonb` : le test comparait deux textes JSON (`{"debut":10,"fin":20}`), la base rend `{"fin":20,"debut":10}`. L'enregistrement était fait ; le test ne le voyait jamais (délai de 60 s dépassé) | Comparaison champ par champ (`debut`, `fin`, et ces deux clés seulement), puis égalité stricte de tout `settings` |

## Environnement

Aucun des 70 échecs ne tient à la pile locale.

- **Lumi (`07-clavardage-lumi`, 6 échecs).** Vérifié test par test : aucun ne demande une vraie réponse de Lumi. Trois remplacent la
  réponse de `POST /api/automations/rules/generer` (`page.route`) — 07:205, 07:251, 07:274 ; deux ne l'appellent pas — 07:84
  (moins de 10 caractères) et 07:340 (forfait sans Lumi, réponse de `/api/billing/current` réécrite) ; un seul, 07:120, compte sur
  le fait que Lumi NE répond PAS, ce qui est justement l'état de la pile locale, et il échoue sur ce qui reste après l'échec.
  Les boutons marchent : « Construire » part, le toast d'échec arrive, l'éditeur revient à l'état attendu.
  (Dans les sorties de la passe complète, ces deux derniers portent encore 07:273 et 07:339 : une ligne de commentaire a été
  ajoutée au fichier après son lancement.)
- **Stockage de fichiers, base neuve.** Rien dans ce dossier ne lit le stockage. La base neuve a révélé une dépendance (un client
  avec courriel pour l'aperçu) : c'est une fragilité du test, rangée plus haut, pas une limite de la pile.

À l'inverse, deux tests ne valent QUE sur une instance sans IA : 07:97 et 07:120 (« quand Lumi ne répond pas »). Sur un
environnement où Lumi répond, ils tomberaient — il faudrait y simuler l'échec, comme les trois tests à réponse simulée.

## Encore rouge sans conclusion (et pourquoi)

Aucun. Au tri du 2026-10-01 : les 49 rouges étaient les défauts des tableaux. Au 2026-10-02 : 35 rouges `@defaut` (les
tableaux ci-dessus) et un rouge sans marque, la régression 11:125 décrite plus haut.

Aides partagées (`e2e/automations/_outils/`) : rien de fautif pour ce dossier, je n'y ai pas touché. Une remarque sans gravité :
`creerRegle` / `creerParcours` (ce dernier dans `editeur/_aides.ts`) posent dans `actions` le VRAI premier message, alors qu'une
règle née dans l'éditeur y porte l'action provisoire « À compléter ». Les deux formes existent en prod (Lumi, modèles et
conversions posent un vrai message), mais elles ne se comportent pas pareil quand `steps` se vide : c'est ce qui a fait dévier
12:155 (voir la ligne 05b:303 du tableau des défauts).

Ce que j'ai changé hors des tests rouges, pour que vous le sachiez :

- `editeur/_aides.ts` : `indicateur()` connaît « Pas encore enregistrée » ; aides ajoutées `carteDeclencheurVide`, `titreBandeau`,
  `TOUT_BANDEAU`, `ecranEditeur`, `creerClientJoignable`. Rien de retiré.
- `12-enregistrement:161` (`@defaut`, rouge avant comme après) : sa règle de départ porte maintenant l'action provisoire, comme
  une règle née dans l'éditeur. Avec l'ancienne donnée le serveur ACCEPTAIT la suppression (200) et le refus attendu n'arrivait
  jamais : le test était rouge sur une attente intermédiaire. Il est rouge aujourd'hui sur sa dernière attente (le toast dit
  « nouvel essai automatique »), la base protégée étant vérifiée juste avant.
- `04:105` et `13:156` (`@defaut`) : sélecteur « Aperçu » rendu exact ; ils étaient rouges sur le sélecteur, ils le sont
  maintenant sur leur attente.
- `12-enregistrement:86` : marqueur ` @defaut` AJOUTÉ (défaut nouveau), message d'échec explicite, délai ramené de 60 à 20 s
  (la reprise est prévue 1,5 s après le refus).
- `07-clavardage-lumi:120` : marqueur ` @defaut` AJOUTÉ ; l'attente d'origine est gardée en dernier, précédée de ce que le
  correctif L-7 garantit.
- `03:209` : sélecteur « Aperçu » rendu exact (le test était vert ; même piège en attente si la règle changeait de nom).
- `05:377`, `07:251`, `09:141`, `16:106` (`@defaut`, rouges avant comme après) : leurs premières attentes sont passées en
  `expect.soft`, pour que TOUTES les moitiés du défaut soient jugées au lieu de s'arrêter à la première. Aucune attente n'a été
  retirée ni changée. C'est ainsi qu'on sait que les trois cartes sont muettes (05:377), que Lumi remplace bien le parcours
  publié (07:251), que « (e2) » s'affiche (09:141) et que le filtre s'intitule « All events » (16:106).

Deux remarques sur le produit, vues en instruisant, qui ne sont portées par aucun test :

1. **La reprise après « trop de requêtes » ne peut pas marcher telle qu'elle est écrite** (`AutomationBuilderPage.tsx`
   l. 1186-1217) : poser l'état « en cours » relance l'effet, dont le nettoyage met `annule = true` ; à l'essai suivant, la boucle
   sort sur `if (annule) return;` sans jamais remettre l'état à « modifié ». C'est la cause de 12:86.
2. **Un parcours converti garde son ancien message dans `actions`** : c'est la cause de 05b:303. Tant que `steps` n'est pas vide
   le moteur suit `steps` ; dès qu'il l'est, tout (éditeur, contrôle de publication, aperçu) relit `actions`.

## Ce que je n'ai pas pu vérifier

- **Que le moteur envoie vraiment l'ancien message d'un parcours converti puis vidé** (05b:303). Vérifié : l'écran (l'étape
  revient, en lecture seule), la base (`steps` vide, `actions` intact), et le serveur qui accepte de vider une règle PUBLIÉE de
  cette forme (réponse 200 dans la trace de 12:155, à ma première relance, avant correction de sa donnée). Non vérifié : l'envoi
  lui-même — je n'ai pas déclenché le moteur.
- **Le typage des specs modifiées** : `tsc` m'était interdit. Elles se chargent et tournent sous Playwright ; je n'ai laissé
  aucun import inutilisé à ma connaissance (relu à la main), mais `tsc --strict --noUnusedLocals` n'a pas été rejoué.
- **Le remplacement du parcours publié par Lumi avec une VRAIE réponse de Lumi** (07:251) : la réponse est simulée, la pile
  locale n'a pas de clé d'IA. Ce que l'éditeur fait de la proposition, lui, est réel.
- **07:97 et 07:120 sur une instance où Lumi répond** : non tournés ailleurs que sur la pile locale.
- **Les quatre tests passés en `expect.soft`** ont été modifiés APRÈS le lancement de la passe complète, qui a donc exécuté leur
  version d'avant (Playwright garde le code chargé au lancement). Je les ai relancés seuls ensuite — c'est la dernière relance
  ci-dessous. Tout le reste du dossier a tourné, dans la passe complète, tel qu'il est sur le disque.
- **L'effet de la base neuve sur les autres tests verts** : le seul test trouvé dépendant d'une donnée du bureau est l'aperçu
  (04:59, 04:87). Je n'ai pas cherché d'autres faux verts parmi les 113 tests sans marque déjà verts à la passe, hors le motif
  précis qui a trompé 10:241 (un sélecteur de page entière qui attrape la barre latérale) — relu dans tout le dossier.

## Dernière relance — revérification du 2026-10-02

Pile locale (proxy 48425, API 48306, Vite 5197), bureaux du jeu `editeur`, un worker, arbre `D:/lume-uiaudit/wt-verif`
(b575a7ad : `mission/auto-finale-u` à a80b2c25 + `main`). Sorties : `D:/lume-uiaudit/sorties/verif-editeur/`.

**Passe complète finale (24,6 min)** — `passe-finale-2.txt`, JSON `passe-finale-2.json` :

    E2E_PORT_PROXY=48425 E2E_PORT_API=48306 E2E_PORT_VITE=5197 PLAYWRIGHT_BROWSERS_PATH=D:/lume-uiaudit/pw-browsers E2E_SORTIES=D:/lume-uiaudit/sorties/verif-editeur E2E_JEU=editeur E2E_WORKERS=1 node scripts/qa/automations-e2e/lancer.mjs editeur/ --project=bureau

→ **186 tests : 150 passés, 36 échoués** = 35 `@defaut` (chacun rouge sur l'attente de son défaut) + 1 sans marque
(11:125, régression). Aucun `@defaut` n'est vert. Aucune panne du poste, aucun problème relevé par le moniteur.

Avant elle : `passe0.txt` (le dossier TEL QUEL sur le produit corrigé, avant toute retouche : 184 tests, 135 verts, 49 rouges —
8 `@defaut` déjà verts, 8 tests sans marque rouges ; les deux derniers commits de la branche sont arrivés pendant cette passe,
vers le test 137, tout a été rejoué depuis) ; `run1.txt` (26 tests retouchés : 24 verts, S-14 et 11:125 rouges) ; `run2.txt`
(A-01, vert) ; `sonde.txt` (mesure de la régression). `passe-finale.txt` est une passe coupée par un redémarrage du poste :
elle ne compte pas.

## Relance du tri (2026-10-01)

Pile locale du tri (proxy 48422, API 48303, Vite 5194), bureaux du jeu `editeur`, un worker. Après les relances, les deux
bureaux sont propres : aucune règle de test, aucun client, pause globale levée (relu en base).

**Passe complète du dossier (une seule, 23,9 min)** — sortie : `sorties/tri-editeur-passe-A.txt`, JSON : `sorties/tri-editeur-passe-A.json`

    E2E_PORT_PROXY=48422 E2E_PORT_API=48303 E2E_PORT_VITE=5194 PLAYWRIGHT_BROWSERS_PATH=D:/lume-uiaudit/pw-browsers E2E_SORTIES=D:/lume-uiaudit/sorties/tri-editeur E2E_JEU=editeur E2E_WORKERS=1 node scripts/qa/automations-e2e/lancer.mjs editeur/ --project=bureau

→ **184 tests : 135 passés, 49 échoués.** Les 49 échoués sont les 49 `@defaut` des tableaux, chacun rouge sur l'attente qui
décrit son défaut ; aucun test sans marque n'est rouge ; aucun `@defaut` n'est vert.

**Dernière relance (les quatre tests passés en `expect.soft` après le lancement de la passe)** — sortie : `sorties/tri-editeur-run6.txt`

    E2E_PORT_PROXY=48422 E2E_PORT_API=48303 E2E_PORT_VITE=5194 PLAYWRIGHT_BROWSERS_PATH=D:/lume-uiaudit/pw-browsers E2E_SORTIES=D:/lume-uiaudit/sorties/tri-editeur E2E_JEU=editeur E2E_WORKERS=1 node scripts/qa/automations-e2e/lancer.mjs editeur/05-canevas-edition.spec.ts editeur/07-clavardage-lumi.spec.ts editeur/09-onglet-historique.spec.ts editeur/16-anglais.spec.ts --project=bureau -g "S-38|S-03|sans identifiant technique|Enrollment history et Execution logs"

→ **0 passé, 4 échoués** — les quatre sont des `@defaut`, rouges comme attendu, cette fois avec toutes leurs attentes jugées
(3 erreurs pour 05:377, 2 pour 07:251, 2 pour 09:141, 2 pour 16:106). Le compte du dossier ne change pas : 135 / 49.

Relances intermédiaires (specs réparées vues vertes avant la passe complète) : `sorties/tri-editeur-run2.txt` à `run5.txt`.
