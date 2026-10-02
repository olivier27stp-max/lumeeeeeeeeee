# Audit utilisateur de la page Automatisations — rapport

*Mission du 2026-10-01. État au 2026-10-02, 01 h 30 UTC. Carte des éléments : `AUTOMATIONS_UI_MAP.md` (377 éléments).*

## 1. Verdict pour le launch du 26 octobre

**Pas prêt à déclarer « chaque bouton fonctionne » : la passe complète a enfin tourné, et elle a fait sortir environ 220 défauts que la tournée à la main n'avait pas vus. Ils sont décrits un par un et en cours de correction ; rien de ce qui est en production aujourd'hui n'est cassé par les lots de cet audit.**

Ce qui est acquis :

- Les 68 constats de la tournée « chaque bouton » : 64 corrigés et déployés (roles-05, roles-07 et l'onglet « Modèles » se sont ajoutés avec #889), 3 corrigés en partie (roles-06, roles-13, roles-14), 1 ouvert (liste-12) — § 6.
- Les 2 bloquants (contournement des gardes de l'API par une barre finale ou une majuscule ; réglages d'un ancien déclencheur qui restaient et empêchaient la règle de partir) sont corrigés, en prod, vérifiés sur le vrai site.
- **Passe du vrai site : 68 vérifications sur 68** le 1er octobre de 23 h 21 à 23 h 31 UTC (onze scripts l'un après l'autre sur lumecrm.net, bureau de test en bac à sable), publication à l'écran comprise, avec la garde en base en place.
- **La passe automatique complète a tourné** : 1 054 tests de bout en bout sur une base locale jetable (ni staging ni prod), puis chaque dossier trié et relancé. Résultat au § 2.

Ce qui manque pour dire « prêt » :

1. **environ 220 défauts du produit sont ouverts** (236 tests rouges, chacun sur l'attente qui décrit son défaut), dont une vingtaine de majeurs (§ 6). Les plus graves : une automatisation ouverte sur réseau lent qui reçoit le nom et le parcours d'une autre ; deux onglets qui s'écrasent ; une action ajoutée à une automatisation PUBLIÉE qui part en ligne avec son texte d'exemple sans avoir été enregistrée ; le texte anglais d'un message qui reste en base, invisible, après une correction ; « 3 jours » qui devient « 5 minutes » en retapant le nombre ; le nom d'un vrai client (« Coquin lavage ») écrit en dur comme exemple dans l'aperçu des courriels de tous les bureaux. La session « correction finale » les corrige (branches `mission/auto-finale-*`) ; chaque correctif fera passer au vert le test qui le décrit.
2. **Le contenu d'une automatisation s'écrit encore avec la session de l'utilisateur.** La garde en base ferme la publication et les règles fournies (§ 5), pas le contenu : un membre qui a le droit de modifier les automatisations peut encore, par un appel direct à la base, poser un déclencheur inconnu ou vider le texto d'une règle publiée. Fermeture décidée (une seule porte d'écriture côté serveur, puis retrait des droits d'écriture à la session) ; preuve prête : `scripts/qa/verifier-garde-automatisations.mjs --etendue` (10/20 aujourd'hui).
3. **La matrice des appareils n'a pas été rejouée par la passe complète** : seul le projet « bureau » (Chromium 1440) a tourné. iPad paysage et portrait sont couverts par la passe du vrai site (29 vérifications) ; Firefox, Safari de bureau et le téléphone ne le sont que par la tournée à la main.
4. **Phase 5 (Lumi et les automatisations)** : « Construire avec Lumi » est couvert (batterie 122/123, deux défauts vécus en prod corrigés) ; les demandes à Lumi *dans le clavardage de l'app* relèvent de la mission « Lumi fiable » (autre session : 95,9 % sur sa passe finale).

## 2. Couverture

**La passe complète** (`e2e/automations/`, 62 fichiers, un vrai navigateur sur l'app locale, base locale jetable) :

| | Éléments de la carte | Tests | Passent | Rouges = défaut du produit | Rouges sans conclusion |
|---|---|---|---|---|---|
| Liste | 103 | 205 | 156 | 49 | 0 |
| Bibliothèque de modèles, messages | 80 | 222 | 173 | 49 | 0 |
| Éditeur | 96 | 184 | 135 | 49 | 0 |
| Déclencheurs | 81 | 123 | 95 | 28 | 0 |
| Actions | 115 | 177 | 143 | 34 | 0 |
| Rôles, API et base directes | 118 | 141 | 114 | 27 | 0 |
| Banc (sessions, bac à sable, moteur) | — | 6 | 6 | 0 | 0 |
| **Total** | **377 éléments distincts** | **1 058** | **822** | **236** | **0** |

Comment lire ce tableau :

- Première passe, d'un seul trait (1 h 30, deux navigateurs en parallèle) : 565 réussis, 489 échoués. Ce chiffre brut ne dit rien : 139 échecs venaient d'une préparation manquante (le dossier « rôles » veut ses propres bureaux de test), et environ 130 de specs écrites avant les lots 1 à 5 (un libellé changé exprès, un champ devenu une liste, une sous-navigation devenue des liens).
- Chaque dossier a donc été **trié échec par échec** (défaut du produit / spec périmée / environnement / test fragile), les specs périmées réparées *sans affaiblir ce qu'elles prouvent*, puis le dossier **relancé en entier**. Les nombres du tableau sont ceux de ces relances. Deux échecs de la relance « modèles » et un de la relance « rôles » venaient du poste (tampons réseau épuisés, verrou de session) : rejoués seuls, ils passent, et sont comptés verts. La relance « déclencheurs » date d'avant un test remis en « défaut » : son 95 / 28 est déduit de 96 / 27.
- Un test rouge porte la marque `@defaut` : il affirme le comportement **attendu** et reste rouge tant que le défaut existe. Interdit de l'affaiblir. 81 tests marqués ainsi ce matin sont passés au vert depuis (les lots 1 à 5 ont corrigé leur défaut) : leur marque est retirée.
- Les fiches de tri, un défaut par ligne (écran, geste, ce qu'on voit, ce qu'on devrait voir, spec et ligne) : `e2e/automations/_tri/` — c'est la liste de travail de la session qui corrige.
- Limites : un seul projet (« bureau », Chromium 1440 × 900) ; la pile locale n'a ni stockage de fichiers, ni clé d'IA (les réponses de Lumi y sont simulées), ni fournisseur d'envoi (tout part dans le bac à sable) ; une seule relance complète par dossier, donc la stabilité d'une passe à l'autre n'est pas mesurée.

Pour la relancer : `bash scripts/qa/automations-e2e/pile.sh` (une fois : monte la base locale), puis `npm run test:automations:e2e:local`.

À côté de cette passe, vérifications pilotées par script **sur le vrai site** (bureau « Grok Audit (TEST) », envois en bac à sable) :

| Script | Ce qu'il vérifie | Avant déploiement | Après |
|---|---|---|---|
| `10-menus-apercu-editeur` | menus, Échap, palette « Insérer », aperçu réel, écran neuf, étape visée | 1/6 | 6/6 |
| `11-diagnostic-variables` | diagnostic sans identifiants, fausse alerte de variable | — | 2/2 |
| `20-liste-editeur-modeles` | ordre de la liste, un seul menu, sous-navigation, modèles, tiroir, Ctrl+Z, refus lisibles | 1/8 | 8/8 |
| `30` `31` `32` (tablette) | liste, barre du haut, éditeur sur iPad paysage et portrait | 1/3, 1/2, 19/24 | 3/3, 2/2, 24/24 |
| `40-roles-api` | technicien et vendeur refusés sur les 32 routes de l’API (403 avec une phrase lisible), y compris barre finale, majuscules et double barre ; sans session : 401 ; propriétaire et admin lisent | — | 9/9 |
| `50-comportements-navigateur` | éditeur : rechargement, retour arrière et avancer, lien direct vers une règle inexistante (« introuvable ») ou à la corbeille, modification hors ligne (l’écran dit « Modifié », rien n’est écrit, puis ça s’enregistre au retour du réseau), règle supprimée dans un autre onglet (« n’existe plus ») | — | 6/6 |
| `60-anglais` | interface en anglais : liste, vue d’ensemble, réglages globaux, éditeur — aucun texte d’interface resté en français | — | 4/4 |
| `70-journaux-causes` | onglet Journaux : deux causes écrites en anglais par le moteur sont lues en français | 0/1 | 1/1 |
| `80-publication` | liste : publier puis repasser en brouillon avec l’interrupteur, la base relue à chaque fois, rechargement compris — avant et après la migration de garde | 3/3 | 3/3 |

Ces scripts sont dans le dépôt (`scripts/qa/automations-prod/`) et se lancent d’une commande : **`npm run test:automations:e2e`** — 68 vérifications, toutes réussies à la dernière passe (2026-10-01, 23 h 21 → 23 h 31 UTC), sortie en JSON et en markdown. C’est une passe **après déploiement** : elle juge ce qui est en ligne. Depuis la panne du 1er octobre (§ 4) elle tourne un script à la fois, lit `/api/health` avant chacun, garde une session par rôle et s’arrête d’elle-même au premier 429 ou dès que la base dépasse 1 500 ms.

Tests unitaires et de composant ajoutés par les correctifs : environ 330, tous dans la suite de la CI (qui bloque le merge).

## 3. Appareils, navigateurs, rôles, langues

| | Résultat |
|---|---|
| Bureau 1440 (Chromium) | conforme |
| iPad paysage 1024 (WebKit) | la liste était inutilisable (interrupteur, messages et menu « ⋮ » hors écran, 0/10 atteignables) : **corrigé par #876**, 10/10 ; éditeur conforme |
| iPad portrait 768 (WebKit) | idem, plus l'avatar « Mon profil » qui dépasse de l'écran sur toutes les pages ; corrigé par #876 |
| Téléphone 375 | la section n'est pas offerte : porte mobile « Le bureau sur l'ordi. Le terrain dans l'app. » — voulu |
| Firefox, Safari de bureau | conformes ; Firefox remonte à chaque page l'exception du verrou de session de supabase-js, sans effet visible (P-001) |
| Rôles | propriétaire et admin : complet ; technicien et vendeur : refusés sur les 32 routes de l’API par appel direct (403, vérifié sur le vrai site), y compris avec une adresse détournée ; membre « lecture + modification » : la base lui refuse désormais de publier, de se déclarer « fournie » et de supprimer (garde du § 5) ; le contenu d’une règle reste inscriptible en direct (§ 1, point 2) |
| Anglais | les quatre écrans vérifiés sur le vrai site sans un texte d’interface en français ; libellés alignés (« Build with Lumi »), textes anglais ajoutés aux 54 notifications / tâches des modèles ; reste le titre « Workflows list » à côté d’un menu « Workflows » (P-002) |

## 4. Envois : rien n'est parti

Tout a été fait dans des bureaux de test inscrits au bac à sable (`orgs_envois_simules`) : bureaux « [TEST] QA Automatisations » sur staging au début, « Grok Audit (TEST) » en prod ensuite. Canari 6/6 au départ. Aucun envoi réel constaté. « M'envoyer un essai » n'a jamais été cliqué par les scripts.

Incidents à signaler, tous du 1er octobre :

- **Staging, le matin** : six agents en parallèle ont saturé sa base (503) ; elle a été redémarrée, sans effet sur la prod.
- **Prod, 20 h 36 → 21 h 41 UTC : base injoignable pendant une heure.** Trois sessions testaient la prod en même temps ; de mon côté, une passe complète du vrai site (dix scripts d’affilée, une vingtaine d’ouvertures de session, trois 429) puis un script de 17 chargements de page tournaient dans le quart d’heure précédent. La cause exacte n’est pas établie ; le projet Supabase a été redémarré avec ton accord par une autre session. Depuis : contre la prod, un seul flux à la fois, santé lue avant et pendant, arrêt au-dessus de 1 500 ms — c’est écrit dans le lanceur.
- **Staging, 22 h 07 → 22 h 20 UTC** : injoignable sous les jobs « Automatisations » de plusieurs PR poussées ensemble (#886 les a retirés des PR).

Conséquence : la passe complète ne vise plus ni staging ni la prod. Elle tourne sur une base **locale** jetable (schéma de la prod rejoué, deux tables de référence, aucune donnée de client), et le banc refuse toute autre adresse. Mes 16 bureaux de test de staging sont retirés (désactivés, rien d’effacé).

## 5. Ce qui a été livré

| PR | Contenu | En prod |
|---|---|---|
| #851, #855, #858 | « Construire avec Lumi » : ne garde plus un texto d'exemple, dit ce qu'il retire, signale une automatisation déjà publiée | oui |
| #862 | Sécurité : barre finale / majuscule ne contournent plus les gardes de l'API | oui |
| #859 (lot 1) | menus, corbeille non éditable, étape visée en menu, aperçu de courriel fidèle, palette de variables, pas de bureau créé sur lecture ratée | oui, 17:36 UTC |
| #866 (lot 1b) | diagnostic sans identifiants de la plateforme, pas de mur de vente sur forfait illisible, fausse alerte « variable inexistante » | oui, 18:03 UTC |
| #870 (lot 2) | 45 constats : liste, éditeur, bibliothèque de modèles, routes, refus lisibles, anglais | oui, 19:01 UTC |
| #876 (lot 3) | tablette : liste, barre du haut, cibles tactiles | oui, 19:21 UTC |
| #881 (lot 4) | aucune cause d’échec en anglais brut dans la liste ni dans l’onglet Journaux (14 messages du moteur + 10 causes relevées dans les journaux de prod) | oui, 20:08 UTC |
| #889 (lot 5) | onglet « Modèles » → « Prêtes à publier » ; confirmation « Publier avec le texte d’exemple ? » quand une étape n’a pas été rédigée ; « publiée » ne s’écrit plus que par le serveur | oui, 22:34 UTC |
| migration `20261007300000` | garde en base sur `automation_rules` : une session d’utilisateur ne peut plus publier, insérer une règle publiée ou « fournie », changer le bureau ou le statut « fournie », changer le déclencheur ou mettre à la corbeille une règle fournie, purger hors corbeille, ni supprimer pour de bon. 16 écritures jouées avec le rôle d’une session : 7/16 avant, 16/16 après — pile locale, staging, prod | staging 22:35, prod 22:36 UTC |

Fonctions de base ajoutées (elles manquaient) : menu des étapes pour « Déplacer l'opportunité », recherche dans la palette de variables, Ctrl+Z / Ctrl+Y, Échap sur les menus et le tiroir, écran « à la corbeille » avec « Restaurer », écran « n'existe plus », « Réessayer » quand l'état de la pause est illisible, sous-navigation en liens.

## 6. Ouvert

**A. Les défauts sortis de la passe complète** — environ 220 défauts pour 236 tests rouges (une même racine est parfois vue par deux chemins). Le détail est dans `e2e/automations/_tri/` (un fichier par dossier). Les majeurs :

| Où | Ce qui se passe | Preuve |
|---|---|---|
| Éditeur | « Ouvrir » une 2e automatisation sur réseau lent écrit le nom et le parcours de la 1re dans la 2e (S-01) | `editeur/` |
| Éditeur | Deux onglets sur la même règle : le second écrase le premier, sans avertir (S-13) | `editeur/` |
| Éditeur | Après un 429, aucun nouvel essai : l’écran reste sur « Enregistrement… », la modification n’atteint jamais la base | `editeur/12-enregistrement` |
| Éditeur | Parcours converti du format d’origine : supprimer la dernière étape la fait revenir ; une règle publiée peut être vidée | `editeur/05b` |
| Éditeur | Lumi remplace un parcours PUBLIÉ sans poser de question (S-03) | `editeur/07` |
| Éditeur | « Arrêter ici » au milieu fait disparaître la suite ; une condition supprimée laisse sa branche orpheline (S-12) | `editeur/` |
| Éditeur | La pause globale est invisible dans l’éditeur (S-32) ; « Précédent » avec une étape incomplète perd le travail | `editeur/` |
| Actions | Automatisation PUBLIÉE : une action choisie dans le tiroir part en ligne 3 s plus tard avec son texte d’exemple, sans avoir été enregistrée | `actions/06-publication` |
| Actions, messages | Corriger un texto laisse l’ancien texte anglais en base, invisible ; c’est lui qui part aux clients d’un bureau en anglais | `actions/08`, `modeles/` |
| Actions | Un courriel fourni, à la conversion, s’ouvre en HTML brut | `actions/08` |
| Actions, déclencheurs | « Attendre » : effacer « 3 » et taper « 5 » transforme 3 jours en 5 minutes | `actions/05`, `declencheurs/05` |
| Actions | Une saisie que le serveur refuse (nombre hors bornes, adresse en http://) est acceptée par le panneau ; l’enregistrement échoue ensuite en boucle et bloque tout le parcours | `actions/03` |
| Actions, déclencheurs | « Date atteinte » sur un champ du pipeline : le tiroir offre des actions d’opportunité que la publication refuse ; « Appel reçu de l’extérieur » : six actions impossibles ne sont ni grisées ni refusées | `actions/01`, `declencheurs/06` |
| Déclencheurs | Filtre : taper « 12.5 » enregistre 125 ; minimum 5 000 $ et maximum 100 $ acceptés | `declencheurs/04`, `/03` |
| Déclencheurs | Étape « Si… » : les conditions « est l’un de » sont invisibles puis effacées à l’enregistrement suivant ; une ligne mal écrite est jetée sans un mot | `declencheurs/05` |
| Déclencheurs | « Date atteinte » sur un champ supprimé : la publication est proposée | `declencheurs/06` |
| Messages | Modifier le premier de deux textos (ou courriels) d’une automatisation recopie son texte dans le second | `modeles/` |
| Messages | L’aperçu réel d’un courriel affiche « Coquin lavage » pour [company_name] dans tous les bureaux (exemple écrit en dur) — déjà corrigé sur la branche de correction | `modeles/04` |
| Modèles | « Relance de devis — 1, 2, 5, 10 et 30 jours » s’ouvre sur 180 cartes pour 23 étapes (chaque « Si » redessine toute la suite) | `modeles/02` |
| Liste | « Client inactif » publié EN LOT sans confirmation, alors que l’interrupteur de la même ligne annonce le nombre de clients visés et demande confirmation | `liste/07-lot` |
| Liste | Corriger un texto d’une automatisation à l’ancien format qui en a deux réécrit aussi l’autre | `liste/05-lignes` |
| Liste | Rôle « voir sans modifier » : le menu et la Vue d’ensemble mènent à « Accès restreint » | `liste/12-permissions` |
| Liste | Onglet « À vérifier » : au-delà de 200 échecs récents une automatisation en échec en sort ; si la lecture des échecs tombe, l’écran dit « Aucune erreur — tout roule » | `liste/10-volume`, `/03` |
| Liste | Menu « ⋮ » d’une ligne : depuis qu’il est rendu hors du tableau (#859, mon correctif), la touche Tab ne l’atteint plus après son bouton | `liste/11-clavier` |
| Rôles | Écritures directes en base encore possibles : déclencheur hors catalogue, texto de 5 000 caractères, texto vidé d’une règle publiée, suppression dure d’une adresse d’appel, brouillon créé sans le forfait ; un technicien sans droit sur les clients modifie leurs étiquettes | `roles/40`, `/50`, `/55`, `/20` |

**B. Décisions et restes de la tournée**

1. **« Anniversaire client »** part 12 mois après la création de la fiche, pas à l'anniversaire du client (liste-12) : le sous-titre le dit, le nom non. Décision de produit.
2. **Texte anglais « New lead… »** des notifications déjà semées dans les bureaux existants (roles-13) : corrigé pour les nouveaux bureaux ; les anciens demandent une migration de données sur de vrais bureaux — ton accord d'abord.
3. **Tout rôle peut annoncer « visite déplacée »** (roles-14) : sans effet si la visite n'a pas bougé, mais la route n'exige aucun droit.
4. **Table des gardes de l'API** : elle ne reconnaît comme paramètre qu'un uuid, un nombre ou un segment de plus de 10 caractères ; un identifiant court passe hors table. Sans conséquence aujourd'hui (les routes concernées ont leur propre contrôle) ; la durcir touche toute l'API, pas seulement les automatisations — non fait à trois semaines du launch sans une passe de toutes les routes.
5. **Verrou de session** (P-001) : supabase-js lève « Lock broken by another request with the 'steal' option » — vu à chaque page sur Firefox, deux fois sur une dizaine de passes sur Chromium (Vue d'ensemble), une fois avec un blocage de 60 s sur « Chargement de l'espace… ». Cause non établie.
6. **Titre anglais « Workflows list »** à côté d'un menu « Automations » (P-002) : cosmétique.
7. **Base de référence du dépôt en retard** : `supabase/baseline/` date du 26 septembre (77 migrations de retard, une colonne de `plans` manquante). La pile locale rejoue les migrations par-dessus ; à régénérer après la dernière migration de la série en cours.
8. **`check:db-coherence` annonce 4 écarts sans rapport avec cet audit** : `commissions_totaux_periode()`, `quickbooks_claim_jobs()`, `quickbooks_enqueue()`, `quickbooks_enqueue_history()` appelées par le code et non exécutables par une session.

## 6 bis. Ce que disent les journaux de tes vrais bureaux (lecture seule, 2026-10-01)

- **Aucun texto ne part en prod** : aucun numéro texto n’est configuré pour les bureaux (Twilio). Le rappel de rendez-vous de Coquin lavage du 1er octobre à 12 h 09 a été *sauté* pour cette raison ; l’écran le dit (« Les étapes texto sont sautées tant qu’aucun numéro n’est configuré »). Les courriels, eux, partent. Ce n’est pas un défaut du code : tant que le numéro n’est pas en place, toute étape texto de toute automatisation est sautée.
- Le moteur ne prend aucun retard : 0 tâche en attente dépassée, tous bureaux confondus.
- Vision Lavage, 25–28 septembre : 6 échecs sur 8 exécutions — client sans adresse courriel, demandes d’avis désactivées, numéro inconnu du carnet. Depuis, le moteur traite ces cas comme « sautés » et non comme des échecs (#842) ; les anciennes lignes restent dans les journaux.
- Tes trois dernières conversations avec Lumi dans l’éditeur : celle du 30 septembre (« trop long », « tu l’as même pas changé le message ») date d’avant #851 — Lumi changeait bien le texto mais ne le montrait pas. Celle de 18 h 29 le 1er octobre (« Relance facture en retard ») a reçu la réponse voulue : le nouveau texte cité mot pour mot.
- Vu une fois sur une quarantaine de chargements pilotés : l’app est restée plus de 60 s sur « Chargement de l’espace… » (ouverture de session). Non reproduit au chargement suivant ; cause non établie — à rapprocher de l’exception du verrou de session (P-001).

## 7. Non testé

- La matrice de la passe complète hors « bureau » : iPad, téléphone, Firefox, Safari (projets prêts dans `e2e/automations/playwright.config.ts`, jamais lancés en entier).
- Les parcours qui demandent deux bureaux réels en prod (« Copier vers d'autres bureaux ») : couverts en local, pas sur le vrai site (un seul bureau de test en prod).
- « M'envoyer un essai » sur le vrai site (enverrait un vrai courriel, même à soi) ; en local il part dans un serveur de courriel piège.
- L'envoi réel de textos : Twilio n'est pas configuré en prod ; les étapes texto sont sautées et l'écran le dit.
- Les vraies réponses de Lumi dans l'éditeur pendant la passe complète (simulées, faute de clé d'IA en local).
- Téléverser une image dans un courriel (pas de stockage de fichiers en local).
- Volume (D-17) : pas d'essai de charge.
- Le job de CI « Automatisations » (intégration sur staging) n'a validé aucun des lots de cet audit : annulé à chaque merge rapproché, puis retiré des PR.

## 8. Tableau des constats

Gravité : bloquant 2 (2 corrigés) · majeur 17 (14 corrigés, 3 ouverts) · mineur 32 (28 corrigés, 2 partiels, 2 ouverts) · cosmétique 17 (17 corrigés).

| N° | Gravité | Écran | Constat | Statut |
|---|---|---|---|---|
| declencheurs-01 | bloquant | Éditeur /automations/:id — tiroir « Déclencheurs » puis carte « Quand  | Changer de déclencheur (item du tiroir, EDT-058) ; « Enregistrer » du panneau du — Les réglages de l'ancien déclencheur restent en base, invisibles. Il suffit de PASSER par « Devis ouvert par le client » (qui pose d'office ouverture=premiere) puis de ch | #859 |
| roles-01 | bloquant | API serveur — routes d’événements /api/automations/events/* | Garde de permission (rbacMiddleware) devant les routes d’événements — Avec le jeton du technicien, sur l’API Express directe (:3112) ET par le mandataire Vite : POST /api/automations/events/lead-created/ (barre finale), /events/LEAD-CREATED | #862 |
| actions-01 | majeur | Éditeur d’automatisation › panneau d’étape « Déplacer l’opportunité »  | champ « L’étape visée * », affiché quand « Vers » = « Une étape précise » (ou vi — un champ de TEXTE libre (40 caractères). Pour rendre l’étape enregistrable, le test a dû y taper l’identifiant technique de l’étape (d470679a-bdea-4f52-b3d5-2337611d65b7) | #859 |
| actions-05 | majeur | HORS LOT (garde d’accès de l’éditeur, état E01 de la carte) — /automat | fenêtre « Fonctionnalité premium — Automatisations — Passer à Scale, 249 $/mois  — bureau de test sous forfait Autopilot ; GET /api/billing/plans a répondu 500 (« canceling statement due to statement timeout ») ; l’éditeur a été remplacé par la fenêtre  | #866 |
| EDITEUR-01 | majeur | Éditeur ouvert par son adresse /automations/<id>, automatisation à la  | Tout l’éditeur : canevas, panneau d’étape, enregistrement automatique — Elle s’ouvre exactement comme une automatisation vivante (aucun bandeau, « Brouillon », « Enregistré »). Le texte d’une étape modifié dans le panneau est ÉCRIT en base (s | #859 |
| EDITEUR-HL1 | majeur | HORS LOT — coquille de l’app (observé sur /automations et /automations | Vérification « ce compte a-t-il un bureau ? » au chargement — Quand le verrou d’auth est « volé » (exception « Lock broken by another request with the "steal" option » de supabase-js, vue des dizaines de fois), l’app envoie 1 à 3 `P | #859 |
| liste-01 | majeur | /automations (liste) | Menu ⋮ d’une ligne (et son sous-menu de dossiers) — Sur les dernières lignes du tableau (ou une liste de 1 à 3 lignes), le menu est rogné par la carte du tableau : on n’en voit qu’un liseré de quelques pixels sous le bouto | #859 |
| liste-02 | majeur | /automations (liste) | Lien « Tout arrêter » / bandeau de pause — Quand `GET /api/automations/pause` échoue (500 simulé), il n’y a ni lien « Tout arrêter », ni bandeau, ni message : le bouton d’urgence disparaît en silence, et si le bur | #859 |
| liste-16 | majeur | Toute l’application (vu au chargement de /automations) | Démarrage de l’app — « auto-provision » d’un bureau — Quand l’auth répond lentement, le SDK vole son verrou de session (« Lock broken by another request with the 'steal' option », exception non gérée) ; le décompte des adhés | #859 |
| modeles-02 | majeur | Liste › messages d’une automatisation › éditeur de courriel (onglets « | Palette « Insérer : » au pied de l’éditeur — À 1440 × 900, la palette compte plus de 120 boutons sur 19 à 20 rangées et occupe environ 450 px des 810 px de la fenêtre. Il reste environ 205 px pour lire et écrire le  | #859 |
| modeles-03 | majeur | Éditeur de courriel › onglet « Aperçu réel » | Rendu du courriel par le serveur (iframe « Aperçu du courriel ») — Pour un courriel quelconque d’automatisation (titre + deux paragraphes + deux puces), l’aperçu « réel » affiche un bloc « Montant à payer — 1 220,17 $ », un bouton « Voir | #859 |
| modeles-12 | majeur | Chargement de n’importe quelle page de l’app (ici /automations) | Vérification « ce compte a-t-il un bureau ? » au démarrage — Quand `HEAD /rest/v1/memberships?select=org_id&user_id=eq.…` répond 500 (staging saturé), l’app enchaîne aussitôt `POST /rest/v1/orgs?select=id` : elle tente de CRÉER un  | #859 |
| roles-02 | majeur | API serveur — POST /api/automations/rules/generer | Garde de permission devant « Construire avec Lumi » — Chemin exact : 403 « Permission denied: automations.update ». Avec /generer/ (barre finale), /GENERER, /api/Automations/…, /API/automations/…, /api//automations/…, /gener | #862 |
| roles-03 | majeur | API serveur — lectures /api/automations/* | Garde de permission devant les routes de lecture — Jeton du technicien : GET /api/automations/rules/ et /api/AUTOMATIONS/rules → 200 {"rules":[],"catalogue":{…}} ; /pause/ → 200 {"paused":false,"pausedAt":null} (état réel | #862 |
| roles-04 | majeur | API serveur — routes d’événements sans authentification propre | POST /api/automations/events/{invoice-paid, appointment-created, appointment-can — SANS AUCUN JETON, avec une barre finale : 200 {"ok":true,"via":"base"} sur les quatre routes (le chemin exact répond 401). Ces quatre handlers ne font rien aujourd’hui (l | #862 |
| roles-05 | majeur | Base — table automation_rules par PostgREST | Colonne is_active écrite directement par un rôle qui a automations.update — Admin puis membre « read + update » : update automation_rules set is_active = true par supabase-js sur la règle au texto vide → accepté, la base rend is_active:true. La m | OUVERT — demande une migration (voir § 6) |
| roles-06 | majeur | Base — table automation_rules par PostgREST | Colonnes is_preset, preset_key, trigger_event — Membre « read + update » : update { is_preset: true, preset_key: 'invente_par_le_navigateur' } puis { trigger_event: 'declencheur.inexistant' } → acceptés ; relu par le s | OUVERT — demande une migration (voir § 6) |
| roles-07 | majeur | Base — table automation_rules par PostgREST | Corbeille, purge et suppression dure d’une automatisation fournie — Membre « read + update » sur une règle is_preset=true : update { deleted_at, purged_at } → accepté (les deux dates sont posées) ; puis DELETE → la ligne n’existe plus. La | OUVERT — demande une migration (voir § 6) |
| roles-11 | majeur | API serveur — GET /api/automations/test | Batterie de diagnostic rendue à tout propriétaire / admin d’un bureau client — Admin du bureau de test : 200. La réponse contient « SMTP email configured … SMTP user: piege@lume-qa.test » = la valeur de la variable d’environnement SMTP_USER du serve | #866 |
| actions-04 | mineur | Éditeur d’automatisation › panneau d’étape « Envoyer un texto » | compteur sous « Texte du message » — le compteur affiche seulement « 98 / 1600 » : rien ne dit combien de SMS seront facturés. Corrigé par #840 sur `main`, absent de cette copie (commit c402ad57). | #840 |
| actions-06 | mineur | HORS LOT (démarrage de l’app) — toute page, au chargement | vérification « l’utilisateur a-t-il un bureau ? » — pendant la saturation de staging, l’app a tenté de CRÉER un bureau pour un propriétaire qui en a déjà un : « 403 POST …/rest/v1/orgs?select=id » relevé par le moniteur da | #859 |
| actions-07 | mineur | HORS LOT (API) — éditeur ouvert sur une automatisation qui n’existe pl | PATCH /api/automations/rules/:id et l’enregistrement automatique de l’éditeur — la règle avait été supprimée en base pendant que l’éditeur était encore ouvert (ménage de fin de test) : le serveur a répondu 500 « Impossible de modifier l’automatisatio | #870 |
| declencheurs-02 | mineur | Éditeur — tiroir « Déclencheurs » | Item du tiroir (choix d'un déclencheur), deux choix rapprochés — Chaque choix part aussitôt en PATCH, en parallèle. Cinq choix enchaînés : le dernier clic était « Étiquette ajoutée », la base et la carte finissent sur « Opportunité ent | #870 |
| declencheurs-03 | mineur | Éditeur — carte « Quand » juste après un choix dans le tiroir | Carte « Quand », panneau du déclencheur, indicateur d'enregistrement — Le tiroir se ferme, la carte garde l'ANCIEN déclencheur et l'indicateur du haut dit « Enregistré » tant que le serveur n'a pas répondu (1 à 2 s). Un clic sur la carte pen | #870 |
| declencheurs-04 | mineur | Éditeur — tiroir « Déclencheurs » | Champ « Rechercher dans Déclencheurs » — Le champ de recherche n'a pas le focus à l'ouverture (état « inactive » pendant 15 s d'attente) : il faut cliquer dedans, ou traverser tout le canevas à la touche Tab. | #870 |
| declencheurs-05 | mineur | Éditeur — tiroir « Déclencheurs » | Fermeture du tiroir au clavier (Échap) — Échap ne fait rien, même le curseur dans le champ de recherche : le tiroir reste ouvert ; seule la croix le ferme. | #870 |
| declencheurs-06 | mineur | Éditeur — carte « Quand » | Libellé du déclencheur sur la carte — La carte affiche la clé technique brute : « QUAND payment.failed ». La liste des automatisations, elle, lit le catalogue complet. La règle a été créée en base dans un bur | #870 |
| declencheurs-10 | mineur | /automations/nouvelle (Créer → Partir de zéro) | Indicateur d'enregistrement ; bouton « Choisir le déclencheur » — Revérification du constat n° 2 de la session f1 : confirmé. L'écran affiche « Enregistré » alors qu'aucune ligne n'existe (elle naît au premier choix dans le tiroir — vér | #859 |
| EDITEUR-02 | mineur | /automations/nouvelle (liste → Créer → « Partir de zéro »), avant tout | Indicateur d’enregistrement de la barre du haut — « ✓ Enregistré » est affiché dès l’ouverture et tant qu’on ne touche à rien, alors qu’aucune ligne n’existe dans automation_rules (vérifié en base toutes les 0,8 s pendan | #859 |
| EDITEUR-04 | mineur | Onglet Parcours, 1440×900, une étape ouverte | Carte « Quand » cliquée pendant qu’un panneau d’étape est ouvert — Les deux panneaux de 380 px s’affichent côte à côte (« Réglages du déclencheur » + « Modifier l’étape ») : le canevas tombe à 680 px sur 1440, la carte de Lumi est rognée | #870 |
| EDITEUR-05 | mineur | Ouverture de l’éditeur (chargement, plus ~4,5 s de reprises en cas d’é | Écran de chargement plein écran — Un rond gris de 24 px au milieu d’une page blanche, sans aucun texte ni rôle (`aria-hidden` sur l’icône). Avec staging lent, l’écran est resté ainsi plusieurs dizaines de | #870 |
| EDITEUR-06 | mineur | Onglet Parcours, après la suppression d’une étape | Raccourci clavier Ctrl+Z — Ctrl+Z ne fait rien : la carte supprimée ne revient pas (attendue 4 s). Seuls les deux petits boutons fléchés de la barre annulent / rétablissent — eux fonctionnent (test | #870 |
| liste-03 | mineur | /automations (liste) | Sous-navigation « Automatisations · Vue d’ensemble · Réglages globaux » — « Vue d’ensemble » et « Réglages globaux » sont des boutons, la section courante un simple texte : pas d’ouverture dans un nouvel onglet, rien n’indique à un lecteur d’éc | #870 |
| liste-04 | mineur | /automations (liste) | Bascule « Messages en FR / EN » ; onglets ; dernier en-tête de colonne — « FR » et « EN » sont deux boutons sans `aria-pressed` ni groupe nommé : la langue active ne se devine qu’à la couleur. Les onglets (`role="tab"`) n’ont aucun `tabpanel`. | #870 |
| liste-05 | mineur | /automations (liste) | Bascule « Messages en FR / EN » — Bureau réglé en anglais en base (`default_language = en`), lecture en panne (500 simulé) : « FR » est surligné comme langue active. L’écran affirme que les messages parte | #870 |
| liste-06 | mineur | /automations (liste) | Menu « Créer » — Après Échap, le menu « Créer » est toujours ouvert (1 menu compté à l’écran). Seul un clic ailleurs le ferme. | #859 |
| liste-10 | mineur | /automations (liste) | Flèche « Voir les messages » — aperçu d’un parcours à étapes — Pour un parcours à étapes, le texto est affiché avec sa variable brute : « Texto [client_first_name] ». Constat f1 n° 1 confirmé sous cette forme : selon le format de la  | #870 |
| liste-12 | mineur | /automations (liste) | Ligne « Anniversaire client » — sous-titre — Sous-titre « Nouveau prospect · 12 mois après » : l’« anniversaire » est celui de la création de la fiche du prospect. Constat f1 n° 3 confirmé (le sous-titre dit vrai :  | NON FAIT — décision de produit |
| liste-13 | mineur | /automations (liste) | Ordre par défaut de la liste — En français la liste paraît mélangée : « Confirmation de rendez-vous », « Anniversaire client », « Contrat signé », « Vente croisée — 30 jours », « Suivi de dépôt — 2 jou | #870 |
| modeles-01 | mineur | Bibliothèque de modèles › aperçu d’un modèle | Ligne « Conditions » sous le déclencheur (et intitulé des étapes « Si … ») — L’aperçu de « Prospect — Bienvenue » affiche « Conditions : source ≠ request_form » : la clé et la valeur techniques, telles quelles. Le catalogue servi par GET /api/auto | #870 |
| modeles-04 | mineur | Bibliothèque de modèles › ouverture de l’aperçu d’un modèle | Focus clavier après le clic sur une carte — La carte cliquée disparaît et le focus tombe sur `body` : document.activeElement === document.body. Un utilisateur au clavier doit repartir du début ; un lecteur d’écran  | #870 |
| modeles-05 | mineur | Bibliothèque de modèles › colonne « Catégories » | « Afficher moins » après avoir coché une catégorie de la seconde partie de la li — « Pipeline / leads » cochée puis « Afficher moins » : la liste reste filtrée (« Affichage de 8 modèles ») mais la case cochée a disparu. Aucune des cinq cases visibles n’ | #870 |
| modeles-08 | mineur | Bibliothèque de modèles › carte et ligne du modèle « Relance de devis  | Icônes de canaux et « 18 étapes » — La ligne du modèle montre trois icônes : Texto, Notification, Tâche — pas Courriel. Or le modèle servi par l’API contient 5 courriels (étapes e4, e8, e12, e17, e22, branc | #870 |
| modeles-10 | mineur | Bibliothèque de modèles en anglais › aperçu ; puis copie créée | Textes des étapes « Notifier l’équipe » et « Créer une tâche » — Dans le catalogue servi par l’API, 54 textes de notification ou de tâche n’ont AUCUNE version anglaise (ni `title_en`, ni `body_en`, ni `description_en`), dans 17 modèles | #870 |
| modeles-13 | mineur | Liste des automatisations et bibliothèque de modèles | Le mot « Modèles » — La liste a un onglet « Modèles (0) » (les automatisations fournies non publiées, qu’on modifie en place) et le menu Créer ouvre une « Bibliothèque de modèles » (qui crée  | OUVERT — libellé à décider (voir § 6) |
| roles-08 | mineur | API serveur — PATCH /api/automations/rules/:id | Publication d’une règle à la corbeille par PATCH — Admin : PATCH { is_active: true } sur une règle dont deleted_at est posé → 200 ; en base : {"is_active":true,"deleted_at":"2026-10-01T15:20:46.872+00:00"}. La route /publ | #870 |
| roles-09 | mineur | API serveur — POST /api/automations/rules/:id/duplicate | Duplication d’une règle supprimée définitivement — Admin : duplicate sur une règle dont purged_at est posé → 201, une copie « … purgée (copie) » naît en brouillon. Restaurer la même règle répond bien 404 « Automatisation  | #870 |
| roles-10 | mineur | API serveur — POST /rules/:id/apercu et GET /editeur | « Tester » et ouvrir une règle à la corbeille — Admin : POST /rules/:id/apercu sur une règle à la corbeille → 200 avec l’aperçu rendu sur un vrai client (nom, courriel, téléphone) ; GET /editeur?rule_id=<règle à la cor | #870 |
| roles-12 | mineur | API serveur — refus rendus au navigateur | Texte des refus (champ `error`) — Corps réellement reçus : 403 {"error":"Permission denied: automations.update"} (toutes les routes d’écriture, pour le membre en lecture seule, le vendeur et le technicien | #870 |
| roles-13 | mineur | Base — table notifications (ce que le centre d’activités affiche) | Notifications créées par « job terminé » et par le préréglage « nouveau prospect — Lignes lues en base dans le bureau de test A : type job_ready_for_invoicing, titre « Job ready for invoicing: Job Décor-Rôles », corps « Cliente Décor-Rôles has been comp | #870 (job prêt à facturer) — le texte anglais « New lead » des règles DÉJÀ semées reste (migration de données) |
| roles-14 | mineur | API serveur — POST /api/automations/events/appointment-rescheduled | Annonce « visite déplacée » sans vérification que la visite a bougé — Les six rôles du bureau (dont vendeur et technicien, pour une visite quelconque du bureau) : 200 {"ok":true,"cancelled":n} avec n = 0, 0, 2, 7, 7, 8 rappels annulés puis  | #870 (plus de confirmation renvoyée si la visite n’a pas bougé) — reste : tout rôle peut l’annoncer |
| actions-02 | cosmetique | Éditeur d’automatisation › carte et panneau d’une étape « Notifier l’é | titre proposé à la création de l’étape — la carte du canevas affiche « Suivi a faire pour [client_name] » : faute de français dans un texte que Lume écrit lui-même et qui part tel quel dans la notification si on | #870 |
| actions-03 | cosmetique | Éditeur d’automatisation › panneau d’étape « Créer une tâche » | menu « Priorité (facultatif) », option vide — l’option vide s’appelle « — Inchangé — » : il n’existe encore aucune priorité à laisser inchangée (libellé générique de tous les menus « choix ») | #870 |
| declencheurs-07 | cosmetique | Éditeur — panneau du déclencheur « Devis ouvert par le client » | Menu « Quand déclencher » — option vide — L'option vide s'appelle « — Inchangé — » (libellé pensé pour les actions « modifier… ») : sur un déclencheur, rien n'est « inchangé ». Relevé : ["— Inchangé —","Première  | #870 |
| declencheurs-08 | cosmetique | Éditeur — carte « Quand » | Libellé du déclencheur sur la carte — « Opportunité entre dans une étape » est coupé en « Opportunité entre dans … » (carte de 260 px, texte tronqué, aucune info-bulle). Même coupe pour le résumé des réglages | #870 |
| declencheurs-09 | cosmetique | Éditeur — tiroir « Déclencheurs » | Textes d'aide des déclencheurs — Quatre aides gardent l'apostrophe droite : « Quand le paiement d'une facture est encaissé. », « … dépasse sa date d'échéance. », « … mise à l'horaire. Permet aussi d'envo | #870 |
| EDITEUR-03 | cosmetique | Canevas vide (nouvelle automatisation, ou automatisation enregistrée s | Carte en pointillés « Choisir le déclencheur » — La carte dit « Choisir le déclencheur » ET affiche dessous « Devis envoyé » (déclencheur posé d’office). Texte du bouton relevé par le test : « Choisir le déclencheurDevi | #859 |
| liste-07 | cosmetique | /automations (liste) | Menu « Créer » et menu ⋮ — Menu ⋮ d’une ligne ouvert, clic sur « Créer » : les deux menus sont ouverts en même temps (2 éléments `role="menu"`). | #870 |
| liste-08 | cosmetique | /automations (liste) | Lien « Tout arrêter » → dialogue de confirmation — Le premier clic ouvre le dialogue, le second tombe sur son fond et l’annule : à l’écran le dialogue clignote et « rien ne se passe ». (Rien n’est arrêté : sans danger, ma | #870 |
| liste-09 | cosmetique | /automations (liste) — interface en anglais | Bouton « Build using AI » (en-tête) et item « Build with Lumi » (menu « Create w — En anglais, le bouton de l’en-tête s’appelle « Build using AI » et le même choix dans le menu « Build with Lumi ». (En français : « Construire avec Lumi » aux deux endroi | #870 |
| liste-11 | cosmetique | /automations (liste) | Panneau des messages — intitulé du bloc texto — « SMS ENVOYÉ AU CLIENT » dans le panneau d’une règle à l’ancien format, « TEXTO ENVOYÉ AU CLIENT » dans l’aperçu d’un parcours, « étapes texto » dans le bandeau du haut — | #870 |
| liste-14 | cosmetique | /automations (liste) | Pagination (« 10 / page ») et bulle « Aide et support » — Quand la pagination est en bas de la fenêtre (1440×900), la bulle ronde « Aide et support » chevauche le bord droit du sélecteur « 10 / page » (sa flèche). | #870 |
| liste-15 | cosmetique | /automations (liste) | Dialogue « Arrêter toutes vos automatisations ? » — Le message se coupe ainsi : « … Ce qui est déjà prévu est CONSERVÉ » / « : en reprenant, tout repart où c’en était. » — le deux-points est rejeté seul au début de la lign | #870 |
| liste-17 | cosmetique | /automations — forfait sans automatisations | Fenêtre de forfait (PlanUpgradeModal) — bouton de fermeture — Interface en français : le bouton × de la fenêtre de forfait a pour nom accessible « Close ». | #870 |
| modeles-06 | cosmetique | Bibliothèque de modèles › colonne de filtres | Bouton « Tous les modèles » pendant une recherche — Avec « dépôt » dans la recherche (liste réduite), « Tous les modèles » reste surligné et `aria-pressed="true"` : il affirme « tout est affiché » alors que la liste est fi | #870 |
| modeles-07 | cosmetique | Bibliothèque de modèles (carte, aperçu) puis éditeur de la copie | Nombre d’étapes annoncé (« 3 étapes ») contre cartes du canevas — « Prospect — Bienvenue » : la carte et l’aperçu annoncent 3 étapes (texto, courriel, notification) ; l’éditeur de la copie montre 4 cartes, la 4e étant « Note dans l’hist | #870 |
| modeles-09 | cosmetique | Liste › ligne dépliée d’une automatisation à l’ancien format | Titre du bloc d’édition du texto — Le bloc s’intitule « SMS envoyé au client » alors que le bandeau de la même page dit « Les étapes texto sont sautées… », la bibliothèque « Envoyer un texto » et l’éditeur | #870 |
| modeles-11 | cosmetique | Éditeur de courriel › « Aperçu réel », comparé au bloc compact de la l | Variables du message — Le bloc compact de la liste remplace les variables par des exemples (« Objet Marie Tremblay », « Bonjour Marie, »), et le bloc texto aussi (« Le client lira : Bonjour Mar | #859 / #870 |

### Autres constats (registre de la session)

| N° | Gravité | Constat | Statut |
|---|---|---|---|
| P-001 | mineur | Firefox : exception « Acquiring an exclusive Navigator LockManager lock … immediately failed » à chaque chargement (verrou de session de supabase-js), sans effet visible | OUVERT |
| P-002 | cosmétique | En anglais, la liste s’intitule « Workflows list » alors que le menu dit « Automations » | OUVERT |
| P-004 | majeur | Vécu en prod : Lumi gardait le texto d’exemple d’une étape et n’en disait rien | #851 |
| P-005 | mineur | Le résumé de Lumi recouvrait la carte du déclencheur | #855 |
| P-006 | majeur | Lumi bâtissait un doublon d’une automatisation déjà publiée sans le dire | #855, #858 |
| P-007 | majeur | La batterie « Construire avec Lumi » ne joignait plus le modèle (52 % affiché sans un appel abouti) | #851 |
| P-008 | à décider | Rien n’avertit à la publication qu’une étape porte encore le texte d’exemple | OUVERT (§ 6) |
| P-010 | majeur | « Cette variable n’existe pas : [appointment_address] » sur un courriel fourni par Lume | #866 |
| P-011 | majeur | Forfait illisible → mur de vente « Passer à Scale » à un client payant | #866 |
| P-012 | majeur | Le diagnostic montrait des identifiants de la plateforme aux admins d’un bureau | #866 |
| T-01 | majeur | iPad : interrupteur, messages et menu « ⋮ » de la liste hors écran | #876 |
| T-02 | mineur | iPad portrait : l’avatar « Mon profil » dépasse de l’écran (toutes les pages) | #876 |
| T-03 | mineur | Cibles trop petites au doigt : « Tout arrêter », FR/EN, « + » du canevas, menu « … » d’une carte | #876 |
