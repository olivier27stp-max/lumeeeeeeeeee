# Audit utilisateur de la page Automatisations — rapport

*Mission du 2026-10-01. État au 2026-10-01, 19 h 35 UTC. Carte des éléments : `AUTOMATIONS_UI_MAP.md` (377 éléments).*

## 1. Verdict pour le launch du 26 octobre

**Pas encore prêt à déclarer « chaque bouton fonctionne » — mais tous les défauts bloquants trouvés sont corrigés et en production.**

Ce qui est acquis :

- 68 constats consignés par la tournée « chaque bouton » ; 61 corrigés et déployés, 2 corrigés en partie, 5 laissés ouverts (3 demandent une migration, 2 sont des décisions de produit — voir § 6).
- Les 2 bloquants (contournement des gardes de l'API par une barre finale ou une majuscule ; réglages d'un ancien déclencheur qui restaient et empêchaient la règle de partir) sont corrigés, en prod, vérifiés sur le vrai site.
- Chaque lot a été vérifié **sur lumecrm.net**, dans un bureau de test en bac à sable, avant et après son déploiement.

Ce qui manque pour dire « prêt » :

1. **La passe automatique complète n'a pas tourné.** 1 054 tests de bout en bout sont écrits (un par élément de la carte et par parcours) ; moins de 150 ont été exécutés. Ils visaient staging, qui est tombé sous leur charge le 1er octobre ; la consigne est depuis « tests en prod, jamais en staging ». Le banc est réparé mais reste à brancher sur le bureau de test de la prod et à relancer. Tant que ce n'est pas fait, la couverture annoncée ci-dessous est une couverture *écrite*, pas *prouvée*.
2. **Trois constats majeurs demandent une décision** (garde en base contre les écritures directes, § 6).
3. **Phase 5 (Lumi et les automatisations)** : « Construire avec Lumi » est couvert (batterie 122/123, deux défauts vécus en prod corrigés) ; les 25 demandes à Lumi *dans le clavardage de l'app* n'ont pas été rejouées par cette mission — la mission « Lumi fiable » (autre session) évalue les outils de Lumi en prod en ce moment.

## 2. Couverture

| | Éléments de la carte | Tests écrits | Tests exécutés dans un vrai navigateur |
|---|---|---|---|
| Liste | 103 | 201 | 24 |
| Bibliothèque de modèles, messages | 80 | 221 | 31 |
| Éditeur | 96 | 183 | 38 |
| Déclencheurs | 81 | 123 | 6 |
| Actions | 115 | 177 | 31 |
| Rôles et API directe | 118 (105 couverts) | 139 | 14 |
| **Total** | **377 éléments distincts** | **1 054** | **144** |

À côté de cette passe, vérifications manuelles pilotées par script **sur le vrai site** (bureau « Grok Audit (TEST) », envois en bac à sable) :

| Script | Ce qu'il vérifie | Avant déploiement | Après |
|---|---|---|---|
| `p4-lot1` | menus, Échap, palette « Insérer », aperçu réel, écran neuf, étape visée | 1/6 | 6/6 |
| `p5-lot1b` | diagnostic sans identifiants, fausse alerte de variable | — | 2/2 |
| `p6-lot2` | ordre de la liste, un seul menu, sous-navigation, modèles, tiroir, Ctrl+Z, refus lisibles | 1/8 | 8/8 |
| `p8` `p9` `p10` (tablette) | liste, barre du haut, éditeur sur iPad paysage et portrait | 1/3, 1/2, 19/24 | 3/3, 2/2, 24/24 |
| `40-roles-api` | technicien et vendeur refusés sur les 32 routes de l’API (403 avec une phrase lisible), y compris barre finale, majuscules et double barre ; sans session : 401 ; propriétaire et admin lisent | — | 9/9 |

Ces scripts sont maintenant dans le dépôt (`scripts/qa/automations-prod/`) et se lancent d’une commande : **`npm run test:automations:e2e`** — 54 vérifications sur 54 réussies le 2026-10-01 à 19 h 40 UTC, sortie en JSON et en markdown. C’est une passe **après déploiement** : elle juge ce qui est en ligne. Ce qui bloque un merge avant déploiement reste la CI.

Tests unitaires et de composant ajoutés par les correctifs : environ 330, tous dans la suite de la CI (qui bloque le merge).

## 3. Appareils, navigateurs, rôles, langues

| | Résultat |
|---|---|
| Bureau 1440 (Chromium) | conforme |
| iPad paysage 1024 (WebKit) | la liste était inutilisable (interrupteur, messages et menu « ⋮ » hors écran, 0/10 atteignables) : **corrigé par #876**, 10/10 ; éditeur conforme |
| iPad portrait 768 (WebKit) | idem, plus l'avatar « Mon profil » qui dépasse de l'écran sur toutes les pages ; corrigé par #876 |
| Téléphone 375 | la section n'est pas offerte : porte mobile « Le bureau sur l'ordi. Le terrain dans l'app. » — voulu |
| Firefox, Safari de bureau | conformes ; Firefox remonte à chaque page l'exception du verrou de session de supabase-js, sans effet visible (P-001) |
| Rôles | propriétaire et admin : complet ; technicien et vendeur : refusés sur les 32 routes de l’API par appel direct (403, vérifié sur le vrai site), y compris avec une adresse détournée ; **membre « lecture + modification » : voir § 6** |
| Anglais | libellés alignés (« Build with Lumi »), textes anglais ajoutés aux 54 notifications / tâches des modèles ; reste le titre « Workflows list » (P-002) |

## 4. Envois : rien n'est parti

Tout a été fait dans des bureaux de test inscrits au bac à sable (`orgs_envois_simules`) : bureaux « [TEST] QA Automatisations » sur staging au début, « Grok Audit (TEST) » en prod ensuite. Canari 6/6 au départ. Aucun envoi réel constaté. « M'envoyer un essai » n'a jamais été cliqué par les scripts.

Incident à signaler : le 1er octobre, six agents en parallèle sur staging ont saturé sa base (503) ; elle a été redémarrée, sans effet sur la prod. Depuis : une seule passe à la fois, et plus aucune sur staging.

## 5. Ce qui a été livré

| PR | Contenu | En prod |
|---|---|---|
| #851, #855, #858 | « Construire avec Lumi » : ne garde plus un texto d'exemple, dit ce qu'il retire, signale une automatisation déjà publiée | oui |
| #862 | Sécurité : barre finale / majuscule ne contournent plus les gardes de l'API | oui |
| #859 (lot 1) | menus, corbeille non éditable, étape visée en menu, aperçu de courriel fidèle, palette de variables, pas de bureau créé sur lecture ratée | oui, 17:36 UTC |
| #866 (lot 1b) | diagnostic sans identifiants de la plateforme, pas de mur de vente sur forfait illisible, fausse alerte « variable inexistante » | oui, 18:03 UTC |
| #870 (lot 2) | 45 constats : liste, éditeur, bibliothèque de modèles, routes, refus lisibles, anglais | oui, 19:01 UTC |
| #876 (lot 3) | tablette : liste, barre du haut, cibles tactiles | oui, 19:21 UTC |

Fonctions de base ajoutées (elles manquaient) : menu des étapes pour « Déplacer l'opportunité », recherche dans la palette de variables, Ctrl+Z / Ctrl+Y, Échap sur les menus et le tiroir, écran « à la corbeille » avec « Restaurer », écran « n'existe plus », « Réessayer » quand l'état de la pause est illisible, sous-navigation en liens.

## 6. Ouvert — à décider

1. **Écritures directes qui contournent le serveur (roles-05, 06, 07 — majeurs).** Un membre à qui on a donné le droit « modifier les automatisations » peut, en appelant la base directement (pas par l'écran), publier une règle incomplète, se déclarer « automatisation fournie », changer un déclencheur pour une valeur inconnue, ou supprimer une règle pour de bon. Ça reste dans SON bureau et demande ce droit, mais les gardes du serveur ne s'appliquent pas. Correctif proposé : droits par colonne en base (`REVOKE UPDATE` puis `GRANT UPDATE` sur les seules colonnes de contenu), retrait du `DELETE`, un déclencheur de table qui protège les règles fournies, et cinq écritures du serveur à faire passer par le rôle de service après le contrôle de droit. C'est une migration : staging puis prod, une seule main sur le schéma. **Non fait sans ton accord.**
2. **Le mot « Modèles »** désigne deux choses : l'onglet de la liste (automatisations fournies pas encore publiées) et la « Bibliothèque de modèles » (copies en brouillon). Proposition : renommer l'onglet « Prêtes à publier ».
3. **« Anniversaire client »** part 12 mois après la création de la fiche, pas à l'anniversaire du client (liste-12) : le sous-titre le dit, le nom non.
4. **Confirmation à la publication quand une étape porte encore le texte d'exemple** de l'éditeur (P-008) : proposée, non bâtie.
5. **Table des gardes de l'API** : elle ne reconnaît comme paramètre qu'un uuid, un nombre ou un segment de plus de 10 caractères ; un identifiant court passe hors table. Sans conséquence aujourd'hui (les routes concernées ont leur propre contrôle), à durcir.
6. **Texte anglais « New lead… »** des notifications déjà semées dans les bureaux existants : corrigé pour les nouveaux bureaux, les anciens demandent une migration de données.

## 7. Non testé

- La passe automatique complète (voir § 1).
- Les parcours qui demandent deux bureaux réels en prod (« Copier vers d'autres bureaux ») : un seul bureau de test en prod.
- « M'envoyer un essai » (enverrait un vrai courriel, même à soi).
- L'envoi réel de textos : Twilio n'est pas configuré en prod (« Twilio not configured » au diagnostic) ; les étapes texto sont sautées et l'écran le dit.
- Volume (D-17) : pas d'essai de charge, le disque C: du poste est plein à 99 %.
- Lumi dans le clavardage de l'app (phase 5), hors « Construire avec Lumi ».

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
