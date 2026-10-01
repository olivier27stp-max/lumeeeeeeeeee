# Carte de l'interface — section Automatisations

Checklist de couverture de l'audit utilisateur du 2026-10-01 : chaque élément interactif de la section, dans chaque état où il apparaît. Un élément listé ici doit avoir au moins un test Playwright dans `e2e/automations/` dont le titre porte son identifiant (`[LST-012] …`). La couverture se calcule par `node scripts/qa/couverture-automations-e2e.mjs`.

## Comment elle a été dressée

1. **Du code** : trois lectures complètes (liste et écrans associés ; éditeur plein écran et catalogue ; routes, points d'entrée, API, rôles, Lumi), avec un contrôle par `grep` de chaque gestionnaire (`onClick`, `onChange`, `<button`, `<select`…) contre les lignes d'inventaire.
2. **Du navigateur** : un relevé automatique des éléments interactifs visibles sur chaque écran, puis la tournée elle-même, qui ajoute les éléments vus à l'écran et absents du code lu (section « Éléments ajoutés pendant la tournée »).

## Décompte

| Famille | Écran | Éléments |
|---|---|---|
| LST- | Liste `/automations` | 103 |
| MOD- | Bibliothèque de modèles | 29 |
| MSG- | Éditeurs de message | 37 |
| APR- | Vue d’ensemble `/automations/apercu` | 4 |
| REG- | Réglages globaux `/automations/reglages` | 10 |
| EDT- | Éditeur plein écran `/automations/:id` | 166 |
| EXT- | Points d’entrée ailleurs dans l’app | 28 |
| | **Total** | **377** |

S'y ajoute le **catalogue** de ce qui se configure dans l'éditeur (partie 2, § 3) : 28 déclencheurs et leurs champs, 4 types d'étape (action, attendre, si, arrêter), 6 opérateurs de condition en texte et 20 opérateurs de condition de champ, 21 actions et leurs 40 champs — et les **43 routes serveur** de la partie 3, testées rôle par rôle.

## Relevé du navigateur (propriétaire, français, 1440 px)

| Écran / onglet | Éléments interactifs visibles |
|---|---|
| liste-toutes | 113 |
| liste-À vérifier | 53 |
| liste-Modèles | 53 |
| liste-Corbeille | 53 |
| apercu | 31 |
| reglages-globaux | 33 |
| editeur-nouvelle | 52 |
| editeur-parcours | 52 |
| editeur-Réglages | 44 |
| editeur-Historique | 39 |
| editeur-Journaux | 40 |

## Éléments ajoutés pendant la tournée

(aucun pour l’instant)


---

# Partie 1 — Liste, modèles, messages, vue d'ensemble, réglages globaux

Source : lecture intégrale du code dans `D:/lume-uiaudit/wt` (aucune exécution, aucun accès base).
Périmètre : `/automations` (liste et onglets), `/automations/apercu`, `/automations/reglages`, la bibliothèque de modèles, les éditeurs de message ouverts depuis la liste, le bandeau de pause, la copie vers d'autres bureaux, les adresses d'appel.
Hors périmètre (autre agent) : l'éditeur plein écran `/automations/:id` et `/automations/nouvelle`, `PlanUpgradeModal`, les points d'entrée ailleurs dans l'app.

Abréviations de fichiers :

| Abrév. | Fichier |
|---|---|
| A | `src/pages/Automations.tsx` |
| APR | `src/pages/AutomationsApercu.tsx` |
| REG | `src/pages/AutomationsReglages.tsx` |
| BIB | `src/components/automations/BibliothequeModeles.tsx` |
| ME | `src/components/automations/MessageEditor.tsx` |
| EPE | `src/components/automations/EmailPreviewEditor.tsx` |
| BP | `src/components/automations/BandeauPause.tsx` |
| CVB | `src/components/automations/CopierVersBureauxModal.tsx` |
| IP | `src/components/automations/InterrupteurPublication.tsx` |
| ADA | `src/components/automations/AdressesDAppel.tsx` |
| CD | `src/components/ui/ConfirmDialog.tsx` |
| MODAL | `src/components/ui/Modal.tsx` |
| PG | `src/components/PermissionGate.tsx` |
| PFG | `src/components/PlanFeatureGate.tsx` |
| BAPI | `src/lib/automationBuilderApi.ts` |
| RAPI | `src/lib/automationRulesApi.ts` |
| WAPI | `src/lib/automationWebhooksApi.ts` |

Libellés : presque tout est en ligne (`fr ? '…' : '…'`). Les seules clés i18n utilisées sont `t.modals.confirmTitle` / `cancelBtn` / `confirmBtn` (fr.ts:1617/1605/1601, en.ts:1625/1613/1609) et `t.common.close` (fr.ts:54, en.ts:52) : toutes présentes dans les deux langues.

Liens qui sortent du périmètre (à noter seulement) :
- `/automations/nouvelle` et `/automations/nouvelle?lumi=1` (A:767) : éditeur, brouillon local, rien n'est créé en base.
- `/automations/{id}` (A:840, 1268, 1790, 1960, 2135) : éditeur plein écran.
- `/settings/company` (REG:124) : page Paramètres entreprise, route gardée par `settings.update` (App.tsx:1608).

---

### 1. Écrans et états

#### 1.0 Enveloppe commune aux trois routes

| État | Condition | Source |
|---|---|---|
| ENV-1 Permissions en cours de lecture : écran vide (rien n'est rendu) | `ctx.loading` | PG:49 |
| ENV-2 « Accès restreint » (icône bouclier, titre, phrase, aucun bouton) | permission de la route absente | PG:26-44, App.tsx:1654/1663/1664 |
| ENV-3 Forfait en cours de vérification : roue + texte sr-only « Chargement… » | `usePlanFeature('includes_automations').loading` | PFG:40-47 |
| ENV-4 « Fonctionnalité désactivée » (blocage plateforme, aucun bouton) | `platformBlocked` | PFG:52-68 |
| ENV-5 « Fonctionnalité premium » + bouton « Voir les détails » + `PlanUpgradeModal` ouverte d'office au montage | forfait sans `includes_automations` | PFG:29-33, 70-100 |

Gardes par route :
- `/automations` : route `automations.read` (App.tsx:1654) PUIS page `automations.update` (A:1219). Un rôle en lecture seule passe la première et tombe sur ENV-2 dans la page.
- `/automations/apercu` : `automations.read` aux deux niveaux (App.tsx:1663, APR:83).
- `/automations/reglages` : `automations.update` aux deux niveaux (App.tsx:1664, REG:65).
- `/automations/hub` et `/automations/builder` redirigent vers `/automations` (App.tsx:1669-1670).

#### 1.1 `/automations` (liste)

| État | Condition | Source |
|---|---|---|
| L-01 Chargement de la liste : en-tête, onglets, barre d'outils visibles ; le tableau ET la pagination sont remplacés par une roue | `loading` vrai — au montage ET à chaque `load()` (après dupliquer, supprimer, restaurer, déplacer, lot, enregistrement d'un message, copie vers bureaux, suppression de dossier) | A:551, 1672-1675 |
| L-02 Erreur de chargement : carte `role="alert"` « Impossible de charger les automatisations pour le moment. » / « Rien n'a été supprimé : c'est la lecture qui a échoué. » + bouton Réessayer, plus un toast | `echecChargement` (échec de `getAutomationRules`) | A:602-606, 1676-1688 |
| L-03 Onglet « Toutes » (défaut) : règles vivantes non-modèles, ou modèles publiés | `onglet === 'toutes'` | A:442-445, 948 |
| L-04 Onglet « À vérifier » | clic ou `?onglet=verifier` ; règles vivantes avec au moins 1 échec sur 7 jours | A:937, 945 |
| L-05 Onglet « Modèles » : préréglages (`is_preset`) non publiés | clic ou `?onglet=modeles` | A:939, 946 |
| L-06 Onglet « Corbeille » : `deleted_at` non nul | clic ou `?onglet=corbeille` | A:934, 947 |
| L-07 Vide : « Aucune automatisation » (toutes, modèles), « Aucune erreur — tout roule » (à vérifier), « La corbeille est vide » ; + bouton « Voir les modèles » si onglet Toutes et au moins un modèle | `visibles.length === 0` | A:1737-1759 |
| L-08 Vide après recherche, filtre, dossier : AUCUN état distinct, mêmes textes que L-07 | `filtrees` vide | A:950-964, 1737 |
| L-09 Barre de dossiers visible | `dossiers.length > 0` | A:1441 |
| L-10 Dossier ouvert (pastille active) ou « Sans dossier » | `dossierActif` = id ou `'racine'` | A:961-962, 1450, 1492 |
| L-11 Saisie d'un nouveau dossier (champ + Créer + Annuler remplacent le bouton) | `saisieDossier` | A:1313-1347 |
| L-12 Renommage d'un dossier en ligne | `dossierRenomme === d.id` | A:1472-1489 |
| L-13 Filtres avancés ouverts | `filtresOuverts` | A:1549-1586 |
| L-14 Menu « Créer » ouvert | `menuCreer` | A:1381-1404 |
| L-15 Bibliothèque de modèles ouverte (voir 1.4) | `bibliotheque` | A:1261-1271 |
| L-16 Sélection en lot active (barre « N sélectionnée(s) ») ; variante corbeille ; variante « lot en cours » (boutons grisés + roue) | `reglesCochees.length > 0` ; `onglet === 'corbeille'` ; `lotEnCours` | A:1596-1669 |
| L-17 Menu ⋮ d'une ligne ouvert ; variante corbeille (2 items) ; sous-menu « dossiers » déplié ; ligne occupée (roue à la place de ⋮) | `menuLigne === rule.id` ; `rule.deleted_at` ; `sousMenuDossier === rule.id` ; `occupeId === rule.id` | A:1921, 1934, 2009, 1916 |
| L-18 Panneau de statistiques déplié (une ligne à la fois) ; variante « Les chiffres n'ont pas pu être lus. » | `statsId === rule.id` ; `stats === null` | A:2055-2087 |
| L-19 Panneau « messages » déplié (une ligne à la fois), 4 variantes : (a) parcours `steps` avec envois, lecture seule + lien éditeur ; (b) parcours sans envoi « Ce parcours n'envoie ni texto ni courriel. » ; (c) ancien format `actions` sans envoi « Cette automatisation n'envoie ni texto ni courriel. » ; (d) ancien format avec `MessageEditor` éditable | `deplieId === rule.id` ; `Array.isArray(rule.steps) && length > 0` ; présence de `send_sms` / `send_email` | A:2090-2167 |
| L-20 Éditeur de courriel plein cadre ouvert (voir 1.5) | `editeurOuvert` | ME:115-125 |
| L-21 Pause globale active : bandeau rouge + étiquette « Publiée · en pause » sur chaque ligne publiée | `enPause === true` | BP:96-121, A:1840, 1846 |
| L-22 Pause inactive : lien discret « Tout arrêter » à droite | `enPause === false` | BP:123-135 |
| L-23 État de pause inconnu : RIEN n'est affiché (ni lien ni bandeau) | lecture échouée, `enPause === null` | BP:47, 94 |
| L-24 Bandeau « Les étapes texto sont sautées tant qu'aucun numéro n'est configuré. » | `textoConfigure === false` | A:1278-1287 |
| L-25 Avertissement « demandes d'avis désactivées » sous le nom d'une ligne | `avisOk === false && rule.is_active && !deleted_at && demandeUnAvis(rule)` | A:1810-1817 |
| L-26 Mention « Copie liée à un autre bureau » sous le nom | `rule.modele_id` | A:1818-1823 |
| L-27 Mention « N échec(s) dans les 7 derniers jours — raison » sous le nom | `failureCounts[rule.id] > 0` | A:1824-1831 |
| L-28 Bascule de publication en vol (roue dans la pastille de l'interrupteur) | `fileBascule.enCours(rule.id)` | IP:51, A:1885 |
| L-29 Statistiques illisibles : « — » dans « Total déclenché » et « En cours » | `stats === null` | A:1854-1855 |
| L-30 Tri par colonne actif (flèche visible, `aria-sort`) | `tri !== null` | A:513-516, 1712-1728 |
| L-31 Plusieurs pages | `filtrees.length > parPage` | A:994, 2176-2214 |
| L-32 Langue des messages en cours d'enregistrement (FR/EN désactivés) | `savingLang` | A:1304 |
| L-33 Dialogue de confirmation ouvert (7 variantes : supprimer, supprimer définitivement, les deux en lot, supprimer un dossier, activer « Client inactif », tout arrêter) | `confirmer()` en attente | CD:80-152 |
| L-34 Modale « Copier vers d'autres bureaux » : formulaire / envoi en cours / résultats | `copieVers` ; `envoi` ; `resultats` | A:2218-2227, CVB:88, 112 |
| L-35 Largeur < lg (1024 px) : colonnes « Modifiée le » et « Créée le » masquées ; tableau `min-w-[980px]` en défilement horizontal | classes `hidden lg:table-cell`, `overflow-x-auto` | A:1691-1692, 1709-1710, 1857-1858 |
| L-36 Sans dossier ET « Déplacer dans un dossier » : la saisie de dossier s'ouvre en haut + toast | `dossiers.length === 0` | A:1992-1997 |

#### 1.2 `/automations/apercu`

| État | Condition | Source |
|---|---|---|
| P-01 Chargement (roue) | `chargement` | APR:116-119 |
| P-02 Données : 3 tuiles + courbe + résumé des erreurs | fin de `Promise.allSettled` | APR:120-242 |
| P-03 Règles illisibles : « — » dans les 2 premières tuiles | `reglesIllisibles` | APR:53, 125-126 |
| P-04 Courbe sans donnée « Aucune donnée pour l'instant. » | `semaines.length === 0` (seulement si `activiteParSemaine` REJETTE ; une erreur Supabase rend 7 tranches à 0) | APR:142-145 ; automationJournauxApi.ts:385, 396-399 |
| P-05 Courbe avec 7 barres + ligne « Du … au … · Déclenchements : n · Croissance : x % » | `semaines.length > 0` | APR:146-191 |
| P-06 Erreurs illisibles (texte orange) | `echecsIllisibles` | APR:200-208 |
| P-07 Aucune erreur (coche verte) | `echecs.length === 0` | APR:209-217 |
| P-08 Erreurs présentes : « N envoi(s) ont échoué ces 7 derniers jours. » + bouton | `echecs.length > 0` | APR:218-233 |

#### 1.3 `/automations/reglages`

| État | Condition | Source |
|---|---|---|
| R-01 Chargement (roue) | `chargement` jusqu'à la lecture de la langue | REG:99-102 |
| R-02 Chargé : 7 cartes (Langue des messages, Notifications, Enregistrement automatique, Mettre en pause, Fenêtre d'envoi, Adresses d'appel, Lumi) | — | REG:103-211 |
| R-03 Adresses : chargement « Chargement… » | `chargement` (ADA) | ADA:149-156 |
| R-04 Adresses : liste vide « Aucune adresse pour l'instant… » | `adresses.length === 0` (aussi après un ÉCHEC de lecture, qui ne fait qu'un toast) | ADA:51-55, 160-166 |
| R-05 Adresse dont la clé est connue (juste créée ou régénérée) : œil + copier + « Copiez-la maintenant : elle ne sera plus affichée. » ; dévoilée ou masquée | `a.api_key` ; `devoilees.has(a.id)` | ADA:170-171, 204-228, 240-244 |
| R-06 Adresse dont la clé n'est plus connue : URL masquée `…/api/hooks/••••xxxx` + bouton « Régénérer » | `!a.api_key` | ADA:202, 229-238 |
| R-07 Création en cours (roue dans le bouton, désactivé) | `creation` | ADA:252-257 |
| R-08 Adresse tout juste copiée (coche verte 2 s) | `copiee === a.id` | ADA:103-104, 225-227 |
| R-09 Dialogues de confirmation : régénérer, supprimer | `confirmer()` | ADA:79-86, 128-137 |

#### 1.4 Bibliothèque de modèles (modale, depuis Créer → « Partir d'un modèle »)

| État | Condition | Source |
|---|---|---|
| M-01 Chargement : 6 cartes squelette | `modeles === null && !erreur` | BIB:299-311 |
| M-02 Erreur : « Impossible de charger les modèles. » + message brut + Réessayer | `erreur` | BIB:288-298 |
| M-03 Grille (défaut) | `vue === 'grille'` | BIB:344-364 |
| M-04 Liste | `vue === 'liste'` | BIB:322-343 |
| M-05 Aucun résultat : « Aucun modèle trouvé » + « Réinitialiser les filtres » | `resultats.length === 0` | BIB:312-321 |
| M-06 Aperçu d'un modèle (remplace la grille ; pied : Retour + Utiliser ce modèle) | `apercu !== null` | BIB:367-406, 410-422 |
| M-07 Création en cours (boutons du pied désactivés, roue) | `envoi` | BIB:412-419 |
| M-08 Colonne de filtres à gauche (≥ md) ; catégories repliées ou non ; « Afficher plus » | `hidden md:block` ; `categoriesOuvertes` ; plus de 5 catégories non vides | BIB:425-439, 277-283 |
| M-09 Téléphone (< md) : bouton « Filtres (n) » et panneau dépliable | `md:hidden` ; `filtresMobile` | BIB:473-487 |

#### 1.5 Éditeurs de message (dans le panneau « messages » d'une ligne à l'ancien format)

| État | Condition | Source |
|---|---|---|
| E-01 Bloc SMS : zone de texte, compteur, « Le client lira : … », boutons Insérer, Enregistrer grisé | `actionType === 'send_sms'`, texte non modifié | ME:131-243 |
| E-02 SMS modifié : Enregistrer actif + « Annuler » apparaît | `texte !== body` | ME:50, 232-240 |
| E-03 SMS vide : « Le message ne peut pas être vide. » en rouge, Enregistrer grisé | `texte.trim() === ''` | ME:52, 210-214 |
| E-04 SMS multi-segments / caractères spéciaux (mentions orange) | `segments > 1` ; `encodage === 'UCS-2'` | ME:151-168 |
| E-05 SMS avec variable inconnue (ligne orange) | `variablesInconnues(texte).length > 0` | ME:174-180 |
| E-06 SMS en cours d'enregistrement / enregistré (roue puis coche 1,8 s) | `enregistrement` ; `enregistre` | ME:228-229 |
| E-07 Bloc courriel compact : objet + 3 premières lignes + « … » + bouton Modifier | `actionType === 'send_email'` | ME:79-128 |
| E-08 Éditeur de courriel, onglet « Modifier » | `!ongletApercu` | EPE:503-622 |
| E-09 Éditeur de courriel, onglet « Aperçu réel » : rendu en cours / iframe / « Aperçu indisponible pour le moment… » | `ongletApercu` ; `chargementApercu` ; `htmlReel` | EPE:463-502 |
| E-10 Courriel vide « Courriel vide — ajoutez une ligne ci-dessous. » | `blocs.length === 0` | EPE:563-567 |
| E-11 Bandeau « Cette variable n'existe pas : … » | `inconnues.length > 0` | EPE:630-645 |
| E-12 « Modifications non enregistrées » vs « Aucune modification » ; Enregistrer actif ou grisé | `modifie` | EPE:666-670, 691 |
| E-13 Dialogue « Vos modifications ne sont pas enregistrées. Fermer quand même ? » | fermeture avec `modifie` | EPE:307-315 |
| E-14 Essai en cours d'envoi (« Envoi… ») | `essaiEnCours` | EPE:489-494 |

---

### 2. Éléments interactifs

Conditions de base (non répétées dans chaque ligne) : forfait `includes_automations` + permission de la route (voir 1.0). Pour la liste et les réglages : `automations.update` ; pour l'aperçu : `automations.read`. Le propriétaire (`owner`) passe toutes les gardes (PG:55).

#### 2.1 Liste `/automations` (LST)

| ID | État(s) où il apparaît | Type | Libellé FR | Libellé EN | Ce qu'il fait d'après le code | Visible / actif seulement si | Source |
|---|---|---|---|---|---|---|---|
| LST-001 | ENV-5 | bouton | Voir les détails | See details | `setModalOpen(true)` : rouvre `PlanUpgradeModal` (hors périmètre) ; la modale s'ouvre aussi seule au montage | forfait sans `includes_automations`, non bloqué par la plateforme | PFG:82-88 |
| LST-002 | tous | bouton (sous-navigation) | Vue d’ensemble + pastille « Bêta » | Overview + « Beta » | `navigate('/automations/apercu')` | toujours | A:1231-1240 |
| LST-003 | tous | bouton (sous-navigation) | Réglages globaux | Global settings | `navigate('/automations/reglages')` | toujours | A:1241-1248 |
| LST-004 | L-22 | bouton d'allure lien | Tout arrêter | Pause everything | Confirmation : titre « Arrêter toutes vos automatisations ? » / « Pause all your automations? » ; message « Plus aucun courriel ni texto ne partira automatiquement, et aucune tâche ne sera créée. Ce qui est déjà prévu est CONSERVÉ : en reprenant, tout repart où c’en était. » / « No automatic email or text will go out, and no task will be created. What is already scheduled is KEPT: when you resume, everything picks up where it left off. » ; bouton rouge « Tout arrêter » / « Pause everything ». Puis `basculerPause(true)` : POST `/api/automations/pause` puis GET de relecture. Toast succès « Automatisations en pause. » / « Automations paused. » ; si l'état relu diffère : « Le changement n’a pas été appliqué. » / « The change was not applied. » ; erreur : message du serveur ou « Changement non enregistré. » / « Change not saved. » | état de pause lu = faux ; désactivé pendant `occupe` ; côté serveur seule une ligne `company_settings` modifiable (administrateur) réussit | BP:51-91, 125-133 |
| LST-005 | L-21 | bouton | Reprendre | Resume | `basculerPause(false)` SANS confirmation ; toast « Automatisations reprises. » / « Automations resumed. » ; mêmes erreurs que LST-004 | état de pause lu = vrai ; désactivé pendant `occupe` | BP:110-118 |
| LST-006 | tous | bouton segmenté (libellé voisin « Messages en » / « Messages in ») | FR | FR | `changerLangue('fr')` : `setAutomationLanguage` (UPDATE Supabase `company_settings.default_language`). Toast « Messages en français » / « Messages set to French ». Erreur : message levé (« Seul un administrateur peut changer la langue des messages. Rien n’a été modifié. » / « Only an administrator can change the message language. Nothing was changed. ») ou « Impossible de changer la langue » / « Could not change language ». Sans effet si déjà actif | désactivé pendant `savingLang` | A:520-540, 1299-1309 ; RAPI:312-332 |
| LST-007 | tous | bouton segmenté | EN | EN | `changerLangue('en')` ; toast « Messages en anglais » / « Messages set to English » | idem LST-006 | A:1299-1309 |
| LST-008 | sauf L-11 | bouton | Nouveau dossier | Create folder | `setSaisieDossier(true)` : affiche LST-009 à 013 à sa place | `!saisieDossier` | A:1348-1355 |
| LST-009 | L-11 | champ texte | (label sr-only + placeholder) Nom du dossier | Folder name | `setNomDossier` ; `maxLength` 60 ; `autoFocus` | `saisieDossier` | A:1318-1331 |
| LST-010 | L-11 | raccourci clavier Entrée (dans LST-009) | — | — | `validerNouveauDossier` : nom vide → ferme la saisie sans rien créer ; sinon `creerDossier` POST `/api/automations/folders`. Toast « Dossier « {nom} » créé » / « Folder “{nom}” created » ; erreur : message du serveur (ex. doublon) | une seule création à la fois (verrou `creationDossierEnVol`) | A:618-634, 1326 |
| LST-011 | L-11 | raccourci clavier Échap (dans LST-009) | — | — | ferme la saisie et vide le champ | — | A:1327 |
| LST-012 | L-11 | bouton | Créer | Create | identique à LST-010 | pas d'état désactivé visible pendant l'appel | A:1332-1338 |
| LST-013 | L-11 | bouton | Annuler | Cancel | ferme la saisie et vide le champ | — | A:1339-1345 |
| LST-014 | tous | bouton | Construire avec Lumi | Build using AI | `navigate('/automations/nouvelle?lumi=1')` (rien n'est créé en base) | toujours (aucune garde de forfait Autopilot ici) | A:766-768, 1358-1365 |
| LST-015 | tous | bouton à menu (`aria-haspopup="menu"`, `aria-expanded`) | Créer | Create workflow | bascule `menuCreer` | toujours | A:1368-1379 |
| LST-016 | L-14 | item de menu | Partir de zéro — « Un parcours vide, à construire. » | Start from scratch — « An empty path, to build. » | ferme le menu, `navigate('/automations/nouvelle')` | menu ouvert | A:1174-1175, 1191-1193, 1389-1401 |
| LST-017 | L-14 | item de menu | Construire avec Lumi — « Décris ce que tu veux, Lumi le monte. Inclus dans Autopilot. » | Build with Lumi — « Describe it, Lumi builds it. Included in Autopilot. » | ferme le menu, `navigate('/automations/nouvelle?lumi=1')` | menu ouvert | A:1176-1177, 1194 |
| LST-018 | L-14 | item de menu | Partir d’un modèle — « Une bibliothèque de modèles prêts à l’emploi. » | Start from a template — « A library of ready-made templates. » | ferme le menu, `setBibliotheque(true)` : ouvre la bibliothèque (table MOD) | menu ouvert | A:1178-1179, 1198 |
| LST-019 | L-14, L-17 | clic n'importe où ailleurs (écouteur `document`) | — | — | ferme le menu Créer ET le menu ⋮ | un des deux menus ouvert | A:710-715 |
| LST-020 | tous | onglet (`role="tab"`) | Toutes | All workflows | `setOnglet('toutes')` ; remet page 1, vide la sélection ; l'URL n'est PAS mise à jour | — (pas de compteur sur cet onglet) | A:1205, 1412-1429 |
| LST-021 | tous | onglet | À vérifier (N) | Needs review (N) | `setOnglet('verifier')` | N = règles vivantes avec échec sur 7 j | A:1206 |
| LST-022 | tous | onglet | Modèles (N) | Templates (N) | `setOnglet('modeles')` | N = préréglages non publiés | A:1207 |
| LST-023 | tous | onglet | Corbeille (N) | Deleted (N) | `setOnglet('corbeille')` | N = règles supprimées non purgées | A:1208 |
| LST-024 | montage | paramètre d'URL `?onglet=` (valeurs `verifier`, `corbeille`, `modeles`) | — | — | choisit l'onglet initial, lu UNE fois au montage | toute autre valeur = « Toutes » | A:441-445 |
| LST-025 | L-09 | pastille-bouton (`aria-pressed`) | Tout | All | `setDossierActif(null)` | au moins un dossier | A:1443-1461 |
| LST-026 | L-09 | pastille-bouton (`aria-pressed`) | Sans dossier | No folder | `setDossierActif('racine')` : ne garde que les règles sans `folder_id` | au moins un dossier | A:1443-1461 |
| LST-027 | L-09 | pastille-bouton (`aria-pressed`), une par dossier | {nom du dossier} {nombre} | idem | `setDossierActif(d.id)` | hors mode renommage de ce dossier | A:1490-1498 |
| LST-028 | L-09 | icône cliquable (crayon), une par dossier | (aria-label) Renommer le dossier {nom} | Rename folder {nom} | passe la pastille en champ de saisie pré-rempli | toujours visible (pas seulement au survol) | A:1500-1507 |
| LST-029 | L-12 | champ texte | (aria-label) Nouveau nom du dossier {nom} | New name for folder {nom} | `setNouveauNom` ; `maxLength` 60 ; `autoFocus` | mode renommage | A:1473-1488 |
| LST-030 | L-12 | raccourci clavier Entrée (dans LST-029) | — | — | `validerRenommage` : nom vide → abandon ; sinon affichage optimiste puis `renommerDossier` PATCH `/api/automations/folders/{id}`. Aucun toast de succès ; erreur : retour à l'ancien nom + toast (message du serveur) | — | A:651-666, 1479 |
| LST-031 | L-12 | raccourci clavier Échap (dans LST-029) | — | — | `setDossierRenomme(null)` : annule | — | A:1482 |
| LST-032 | L-12 | perte de focus (`onBlur` de LST-029) | — | — | `validerRenommage` : VALIDE le renommage (cliquer ailleurs enregistre) | — | A:1477 |
| LST-033 | L-09 | icône cliquable (corbeille), une par dossier | (aria-label) Supprimer le dossier {nom} | Delete folder {nom} | Confirmation : titre « Supprimer le dossier « {nom} » ? » / « Delete folder “{nom}”? » ; message « Les automatisations qu’il contient reviennent à la racine et continuent de tourner. Rien n’est supprimé. » / « The automations inside move back to the root and keep running. Nothing is deleted. » ; bouton « Supprimer » / « Delete » (NON rouge : pas de `danger`). Puis `supprimerDossier` DELETE `/api/automations/folders/{id}`, retrait local, `load()`. Aucun toast de succès ; erreur : toast (message du serveur) | — | A:668-685, 1508-1515 |
| LST-034 | tous | bouton (`aria-expanded`) | Filtres avancés | Advanced filters | bascule le panneau L-13 ; les filtres restent appliqués panneau fermé | — | A:1523-1531 |
| LST-035 | tous | champ texte | (label sr-only + placeholder) Rechercher | Search | filtre côté client sur le nom LOCALISÉ et sur `description` (non affichée) ; remet page 1 et vide la sélection | largeur fixe 260 px | A:951-955, 1537-1544 |
| LST-036 | L-13 | select `#f-categorie` | Catégorie | Category | `setFilterCategory` ; la catégorie vient de `PRESET_META[preset_key]`, repli « Follow-up » pour toute règle sans clé connue | panneau ouvert | A:922-923, 956, 1552-1562 |
| LST-037 | L-13 | option de LST-036 | Toutes | All | valeur `all` | — | A:1558 |
| LST-038 | L-13 | option de LST-036 | Leads | Leads | valeur `Leads` | — | A:124-130, 1559-1561 |
| LST-039 | L-13 | option de LST-036 | Devis | Quotes & Estimates | valeur `Quotes` | — | A:131-137 |
| LST-040 | L-13 | option de LST-036 | Jobs et rendez-vous | Jobs & Scheduling | valeur `Jobs` | — | A:138-144 |
| LST-041 | L-13 | option de LST-036 | Factures | Invoices | valeur `Invoices` | — | A:145-151 |
| LST-042 | L-13 | option de LST-036 | Paiements | Payments | valeur `Payments` | — | A:152-158 |
| LST-043 | L-13 | option de LST-036 | Suivi | Follow-up | valeur `Follow-up` (contient aussi TOUTES les automatisations personnalisées) | — | A:159-165, 923 |
| LST-044 | L-13 | option de LST-036 | Avis | Reviews | valeur `Reviews` | — | A:166-172 |
| LST-045 | L-13 | option de LST-036 | Engagement client | Client Engagement | valeur `Client` | — | A:173-179 |
| LST-046 | L-13 | select `#f-statut` | Statut | Status | `setFilterStatut` | panneau ouvert | A:957-958, 1564-1573 |
| LST-047 | L-13 | option de LST-046 | Tous | All | valeur `all` | — | A:1570 |
| LST-048 | L-13 | option de LST-046 | Publiée | Published | valeur `publiee` | — | A:1571 |
| LST-049 | L-13 | option de LST-046 | Brouillon | Draft | valeur `brouillon` | — | A:1572 |
| LST-050 | L-13 | select `#f-tri-date` | Trier | Sort | `setTriDate` ; ignoré dès qu'un en-tête de colonne est cliqué (`tri` l'emporte) | panneau ouvert | A:965-968, 981-992, 1575-1584 |
| LST-051 | L-13 | option de LST-050 | Ordre par défaut | Default order | valeur `defaut` (ordre serveur : par nom stocké) | — | A:1581 |
| LST-052 | L-13 | option de LST-050 | Créées le plus récemment | Newest first | valeur `recent` | — | A:1582 |
| LST-053 | L-13 | option de LST-050 | Créées le plus anciennement | Oldest first | valeur `ancien` | — | A:1583 |
| LST-054 | L-16 (hors corbeille) | bouton | Publier (n) | Publish (n) | `publierEnLot(true)` : POST `/api/automations/rules/publication` avec les ids cochés non publiés. Toast « {n} automatisation(s) publiée(s) » / « {n} automation(s) published » ; refus : toast d'erreur 15 s, une ligne par règle « « {nom} » — {raison serveur} ». Si n = 0 : vide la sélection SANS message. Pas de confirmation, même pour « Client inactif » | désactivé pendant `lotEnCours` ; actif même si n = 0 | A:1084-1113, 1627-1635 |
| LST-055 | L-16 (hors corbeille) | bouton | Repasser en brouillon (n) | Unpublish (n) | `publierEnLot(false)` ; toast « {n} automatisation(s) repassée(s) en brouillon » / « {n} automation(s) unpublished » | idem LST-054 | A:1114, 1636-1644 |
| LST-056 | L-16 (hors corbeille) | bouton (texte rouge) | Supprimer (n) | Delete (n) | Si aucune règle non-modèle cochée : toast info « Un modèle ne se supprime pas. » / « A template cannot be deleted. ». Sinon confirmation : titre « Supprimer {n} automatisation(s) ? » / « Delete {n} automation(s)? » ; message « Elles partent à la corbeille : elles cessent de se déclencher et les envois déjà prévus sont annulés. Tu pourras les restaurer. » / « They go to the bin: they stop triggering and any queued messages are cancelled. You can restore them later. » ; bouton rouge « Supprimer » / « Delete ». Puis un DELETE `/api/automations/rules/{id}` par règle, en séquence. Toast « {n} automatisation(s) à la corbeille » / « {n} automation(s) moved to the bin » ; échecs : « Échec sur : {noms} » / « Failed on: {noms} » | désactivé pendant `lotEnCours` | A:1116-1144, 1645-1653 |
| LST-057 | L-16 (corbeille) | bouton | Restaurer (n) | Restore (n) | un POST `/api/automations/rules/{id}/restaurer` par règle ; toast « {n} automatisation(s) restaurée(s) en brouillon » / « {n} automation(s) restored as drafts » ; échecs nommés comme LST-056 | onglet Corbeille ; désactivé pendant `lotEnCours` | A:1146-1150, 1606-1614 |
| LST-058 | L-16 (corbeille) | bouton (texte rouge) | Supprimer définitivement (n) | Delete permanently (n) | Confirmation : titre « Supprimer définitivement {n} automatisation(s) ? » / « Permanently delete {n} automation(s)? » ; message « Elles disparaissent de la corbeille et ne pourront plus être restaurées. L’historique des messages déjà envoyés est conservé. » / « They leave the bin and can no longer be restored. The history of messages already sent is kept. » ; bouton rouge « Supprimer définitivement » / « Delete permanently ». Puis un DELETE `/api/automations/rules/{id}/definitivement` par règle ; toast « {n} automatisation(s) supprimée(s) définitivement » / « {n} automation(s) permanently deleted » | onglet Corbeille ; désactivé pendant `lotEnCours` | A:1152-1171, 1615-1623 |
| LST-059 | L-16 | bouton | Tout décocher | Clear selection | `setCochees(new Set())` | désactivé pendant `lotEnCours` | A:1656-1663 |
| LST-060 | L-02 | bouton | Réessayer | Try again | `load()` | échec de chargement | A:1685-1687 |
| LST-061 | tableau | case à cocher (en-tête) | (aria-label) Tout cocher | Select all | coche ou décoche les lignes de la PAGE visible seulement | — | A:1004-1012, 1696-1702 |
| LST-062 | tableau | en-tête de tri | Nom | Name | `trierPar('nom')` : asc au 1er clic, inverse au suivant ; aucun retour à « pas de tri » | — | A:514-516, 1705, 1721-1728 |
| LST-063 | tableau | en-tête de tri | Statut | Status | `trierPar('statut')` (supprimée 0, brouillon 1, publiée 2) | — | A:974, 1706 |
| LST-064 | tableau | en-tête de tri | Total déclenché | Total enrolled | `trierPar('declenches')` | — | A:975, 1707 |
| LST-065 | tableau | en-tête de tri | En cours | Active enrolled | `trierPar('en_cours')` | — | A:976, 1708 |
| LST-066 | tableau | en-tête de tri | Modifiée le | Last updated | `trierPar('modifiee')` | colonne visible seulement ≥ lg (`hidden lg:table-cell`) | A:977, 1709 |
| LST-067 | tableau | en-tête de tri | Créée le | Created on | `trierPar('creee')` | colonne visible seulement ≥ lg | A:978, 1710 |
| LST-068 | L-07 | bouton | Voir les modèles | Browse templates | `setOnglet('modeles')` : bascule sur l'ONGLET Modèles (pas la bibliothèque) | onglet Toutes, liste affichée vide, au moins un modèle | A:1748-1757 |
| LST-069 | ligne | case à cocher | (aria-label) Cocher {nom} | Select {nom} | ajoute ou retire la ligne de la sélection | toutes les lignes, corbeille comprise | A:1774-1784 |
| LST-070 | ligne | ligne cliquable (bouton : icône + nom + sous-titre + mentions) | {nom localisé} ; sous-titre « {déclencheur} · {n} étape(s) » ou « {déclencheur} · {délai} » | idem (« step(s) ») | `navigate('/automations/{id}')` — AUSSI pour une ligne de la corbeille | toutes les lignes | A:1788-1833 |
| LST-071 | L-26 | infobulle au survol (`title`, dans LST-070) | Suit l’automatisation d’un autre bureau ; la modifier ici la détache. | Follows an automation from another office; editing it here detaches it. | texte natif au survol seulement | `rule.modele_id` | A:1819 |
| LST-072 | ligne | icône cliquable (chevron ›, `aria-expanded`) | (aria-label) Statistiques de {nom} | Stats for {nom} | bascule le panneau L-18 (texte seul, aucun contrôle dedans) | toutes les lignes | A:1861-1873 |
| LST-073 | ligne | toggle (`role="switch"`, rouge = brouillon, vert = publiée) | (aria-label) Publier {nom} / Repasser {nom} en brouillon | Publish {nom} / Unpublish {nom} | `handleToggle` : affichage immédiat, puis file `fileBascule` → `changerPublication` POST `/api/automations/rules/{id}/publication` (une requête en vol par règle). Toast « Automatisation publiée » / « Automation published » ou « Repassée en brouillon » / « Back to draft » ; refus : message du serveur (10 s) ou « Impossible de mettre à jour » / « Could not update », et retour à l'état confirmé | désactivé si `deleted_at` ; JAMAIS désactivé pendant un envoi ; ignoré en silence si une confirmation « Client inactif » est déjà ouverte | A:726-757, 401-423, 1882-1891 ; IP:28-53 |
| LST-074 | L-33 | dialogue (avant LST-073 vers « publiée ») | titre « Activer « Client inactif » ? » ; message « {n} client(s) correspond(ent) aujourd’hui. Les messages partiront par petits lots, en journée. » (ou sans le compte si la lecture échoue) ; bouton « Activer » | « Activate “Inactive client”? » ; « {n} client(s) match(es) today. Messages will go out in small batches, during the day. » ; « Activate » | d'abord GET `/api/automations/clients-inactifs/apercu?mois={conditions.mois ou 6}`, puis `confirmer` ; refus = rien | seulement si `trigger_event === 'client.inactive'` et passage à publiée | A:731-753 |
| LST-075 | ligne | icône cliquable (chevron ⌄, `aria-expanded`) | (aria-label) Voir les messages de {nom} | View messages of {nom} | bascule le panneau L-19 | toutes les lignes | A:1893-1905 |
| LST-076 | ligne | bouton à menu ⋮ (`aria-haspopup`, `aria-expanded`) | (aria-label) Actions pour {nom} | Actions for {nom} | ouvre ou ferme le menu de la ligne ; affiche une roue pendant `occupeId` mais reste cliquable | toutes les lignes | A:1908-1919 |
| LST-077 | L-17 (vivante) | item de menu | Modifier | Edit | `navigate('/automations/{id}')` | règle vivante (modèles compris) | A:1957-1965 |
| LST-078 | L-17 (vivante) | item de menu | Dupliquer | Duplicate | `dupliquerAutomatisation` POST `/api/automations/rules/{id}/duplicate` ; toast « Copie créée — elle est en brouillon » / « Copy created — it is a draft » ; si la source est un modèle (`is_preset`) : `navigate` vers la copie, sinon `load()` ; erreur : toast (message du serveur) | règle vivante | A:835-847, 1966-1974 |
| LST-079 | L-17 (vivante) | item de menu | Copier vers d’autres bureaux | Copy to other offices | ouvre la modale L-34 | `bureauxCibles.length > 0` (compte multi-bureaux, lecture réussie) | A:1975-1985 |
| LST-080 | L-17 (vivante) | item de menu | Déplacer dans un dossier | Move to folder | avec dossiers : déplie le sous-menu (LST-081, 082) ; sans dossier : ferme le menu, ouvre la saisie LST-009, toast info « Créez d’abord un dossier. » / « Create a folder first. » | règle vivante | A:1986-2004 |
| LST-081 | L-17, sous-menu | item de menu | ↑ Remettre à la racine | ↑ Move back to root | `rangerDansDossier(id, null)` : PATCH `/api/automations/rules/{id}` `{folder_id: null}` puis `load()` ; toast « Remise à la racine » / « Moved back to root » | `rule.folder_id` non nul | A:687-698, 2011-2020 |
| LST-082 | L-17, sous-menu | item de menu (un par dossier) | {nom du dossier} | idem | PATCH `/api/automations/rules/{id}` `{folder_id}` puis `load()` ; toast « Rangée dans le dossier » / « Moved to folder » | tous les dossiers sauf celui de la règle | A:2021-2031 |
| LST-083 | L-17 (vivante) | item de menu (rouge) | Supprimer | Delete | Confirmation : titre « Supprimer cette automatisation ? » / « Delete this automation? » ; message « « {nom stocké} » part à la corbeille : elle cesse de se déclencher et les envois déjà prévus sont annulés. Tu pourras la restaurer. » / « “{nom}” goes to the bin: it stops triggering and any queued messages are cancelled. You can restore it later. » ; bouton rouge « Supprimer » / « Delete ». Puis DELETE `/api/automations/rules/{id}` ; toast « Automatisation mise à la corbeille » / « Automation moved to the bin » | `!rule.is_preset` | A:849-869, 2034-2044 |
| LST-084 | L-17 (corbeille) | item de menu | Restaurer | Restore | POST `/api/automations/rules/{id}/restaurer` ; toast « Automatisation restaurée — elle est en brouillon » / « Automation restored — it is a draft » ; `load()` | `rule.deleted_at` | A:878-891, 1936-1944 |
| LST-085 | L-17 (corbeille) | item de menu (rouge) | Supprimer définitivement | Delete permanently | Confirmation : titre « Supprimer définitivement ? » / « Delete permanently? » ; message « « {nom} » disparaît de la corbeille et ne pourra plus être restaurée. L’historique des messages déjà envoyés est conservé. » / « “{nom}” leaves the bin and can no longer be restored. The history of messages already sent is kept. » ; bouton rouge « Supprimer définitivement » / « Delete permanently ». Puis DELETE `/api/automations/rules/{id}/definitivement` ; toast « Automatisation supprimée définitivement » / « Automation permanently deleted » | `rule.deleted_at` | A:900-920, 1945-1953 |
| LST-086 | L-19 (a) et (b) | bouton d'allure lien | Modifier dans l’éditeur | Edit in the editor | `navigate('/automations/{id}')` | règle au nouveau format `steps` | A:2133-2139 |
| LST-087 | L-31 | bouton | Précédent | Previous | page − 1 | désactivé si page ≤ 1 | A:2177-2184 |
| LST-088 | L-31 | bouton | Suivant | Next | page + 1 | désactivé si page ≥ nombre de pages | A:2187-2194 |
| LST-089 | tableau | select `#par-page` | (label sr-only) Lignes par page | Rows per page | `setParPage`, page 1, mémorise dans `localStorage['lume-automations-par-page']` | — | A:498-505, 2196-2213 |
| LST-090 | tableau | option de LST-089 | 10 / page | 10 / page | valeur 10 (défaut) | — | A:2210-2212 |
| LST-091 | tableau | option de LST-089 | 25 / page | 25 / page | valeur 25 | — | A:2210-2212 |
| LST-092 | tableau | option de LST-089 | 50 / page | 50 / page | valeur 50 | — | A:2210-2212 |
| LST-093 | L-33 | bouton du dialogue de confirmation | Annuler (`t.modals.cancelBtn`) | Cancel | résout `false` ; reçoit le focus à l'ouverture | toute confirmation | CD:129-136 |
| LST-094 | L-33 | bouton du dialogue de confirmation | libellé de l'appelant ; défaut « Confirmer » (`t.modals.confirmBtn`) | défaut « Confirm » | résout `true` ; rouge si `danger` | toute confirmation | CD:137-147 |
| LST-095 | L-33 | raccourci clavier Échap | — | — | annule (écouteur en capture, `stopPropagation`) | toute confirmation | CD:96-103 |
| LST-096 | L-33 | clic sur le fond | — | — | annule | toute confirmation | CD:107-112 |
| LST-097 | L-33 | raccourci clavier Entrée | — | — | active le bouton qui a le focus, donc « Annuler » par défaut | toute confirmation | CD:94-95 |
| LST-098 | L-34 | icône cliquable × | (aria-label) Fermer | Close | `onClose` : `setCopieVers(null)` | modale ouverte ; non bloqué pendant l'envoi | CVB:76-78 |
| LST-099 | L-34 | clic sur le fond | — | — | `onClose` | idem ; aucun raccourci Échap dans ce composant | CVB:63 |
| LST-100 | L-34 (formulaire) | case à cocher, une par bureau | {nom du bureau} (légende « Bureaux ») | idem (« Offices ») | ajoute ou retire le bureau des cibles ; toutes cochées à l'ouverture | avant résultats | CVB:26, 31-35, 92-98 |
| LST-101 | L-34 (formulaire) | case à cocher | Garder les copies à jour — « Modifier celle-ci modifiera ses copies. Modifier une copie la détache. » | Keep copies in sync — « Editing this one updates its copies. Editing a copy detaches it. » | `setLier` ; cochée par défaut | avant résultats | CVB:100-110 |
| LST-102 | L-34 | bouton | Annuler (puis « Fermer » après résultats) | Cancel (puis « Close ») | `onClose` | jamais désactivé | CVB:135-137 |
| LST-103 | L-34 (formulaire) | bouton | Copier | Copy | `copierVersBureaux` POST `/api/automations/rules/{id}/copier-bureaux` `{org_ids, lier}` ; succès : liste de résultats par bureau (« Copiée et publiée » / « Copied and published », « Copiée en brouillon » / « Copied as draft », « Déjà là : mise à jour et liée » / « Already there: updated and linked », « Automatisation fournie mise à jour » / « Built-in automation updated », « Existe déjà (non modifiée) » / « Already exists (unchanged) », « Pas le droit dans ce bureau » / « No permission in this office », sinon `erreur` du serveur ou « Échec » / « Failed » ; + « À revoir dans ce bureau : … » / « To review in this office: … ») et `load()` de la liste ; erreur globale : toast (message du serveur) | désactivé si aucun bureau coché ou pendant `envoi` | CVB:37-49, 51-60, 138-148 |

Éléments de la liste NON interactifs mais à regarder : section courante de la sous-navigation (« Automatisations » / « Workflows », `<span>`, A:1228-1230) ; fil d'Ariane « Accueil » / « Home » (`<p>` fixe, A:1589) ; numéro de page et « sur N » / « of N » (A:2185-2186) ; en-tête « Stats » et dernier en-tête vide (A:1732-1733) ; panneau de statistiques (texte, A:2058-2084) ; aperçu lecture seule des parcours (A:2117-2132).

#### 2.2 Bibliothèque de modèles (MOD)

| ID | État(s) où il apparaît | Type | Libellé FR | Libellé EN | Ce qu'il fait d'après le code | Visible / actif seulement si | Source |
|---|---|---|---|---|---|---|---|
| MOD-001 | tous | icône cliquable × (titre « Bibliothèque de modèles » / « Template library ») | (aria-label `t.common.close`) Fermer | Close | `onClose` : ferme, remet le focus sur le bouton « Créer » ; recherche et catégories réinitialisées | non bloqué pendant la création | MODAL:95-102 ; A:1264 ; BIB:206-209 |
| MOD-002 | tous | raccourci clavier Échap | — | — | `onClose` (ferme toute la bibliothèque, même depuis l'aperçu) | — | MODAL:49-50 |
| MOD-003 | tous | clic sur le fond | — | — | `onClose` | — | MODAL:77 |
| MOD-004 | tous | raccourci clavier Tab / Maj+Tab | — | — | piège de focus dans la modale | — | MODAL:52-60 |
| MOD-005 | M-08 | bouton (`aria-pressed` = aucune catégorie cochée) | Tous les modèles | All templates | `reinitialiser` : vide les catégories ET la recherche | ≥ md | BIB:237, 426-430 |
| MOD-006 | M-08 | bouton (`aria-expanded`) | Catégories | Categories | replie ou déplie la liste des catégories | ≥ md | BIB:432-436 |
| MOD-007 | M-08, M-09 | case à cocher (+ compteur) | Suivi de soumissions | Quote follow-up | filtre par catégorie `soumissions` (cumulable) | catégorie non vide ; dans les 5 premières sinon après « Afficher plus » | BIB:262-276 ; automationTemplates.ts:31 |
| MOD-008 | M-08, M-09 | case à cocher | Bienvenue / nouveaux clients | Welcome / new clients | catégorie `bienvenue` | idem | automationTemplates.ts:32 |
| MOD-009 | M-08, M-09 | case à cocher | Rendez-vous et rappels | Appointments and reminders | catégorie `rendez_vous` | idem | automationTemplates.ts:33 |
| MOD-010 | M-08, M-09 | case à cocher | Facturation et paiements | Invoicing and payments | catégorie `facturation` | idem | automationTemplates.ts:34 |
| MOD-011 | M-08, M-09 | case à cocher | Après la job (avis, satisfaction) | After the job (reviews, satisfaction) | catégorie `apres_job` | idem | automationTemplates.ts:35 |
| MOD-012 | M-08, M-09 | case à cocher | Relance / réactivation de clients | Client win-back | catégorie `relance_clients` | idem (6e : derrière « Afficher plus » si les 5 premières sont non vides) | automationTemplates.ts:36 |
| MOD-013 | M-08, M-09 | case à cocher | Pipeline / leads | Pipeline / leads | catégorie `pipeline` | idem (7e) | automationTemplates.ts:37 |
| MOD-014 | M-08, M-09 | bouton | Afficher plus / Afficher moins | Show more / Show less | `setToutesCategories` | plus de 5 catégories non vides | BIB:277-283 |
| MOD-015 | liste des modèles | champ de recherche (`type="search"`) | (aria-label) Rechercher un modèle ; placeholder « Rechercher » | Search templates ; « Search » | filtre différé de 200 ms sur nom, description, libellé de catégorie (sans accents) | — | BIB:212-215, 452-454 ; automationTemplates.ts:162-178 |
| MOD-016 | liste des modèles | select | (aria-label) Trier | Sort | `setTri` | — | BIB:456-461 |
| MOD-017 | liste des modèles | option de MOD-016 | Plus récent | Most recent | valeur `recent` (défaut, par `ajoute_le`) | — | BIB:458 |
| MOD-018 | liste des modèles | option de MOD-016 | Nom (A–Z) | Name (A–Z) | valeur `nom` | — | BIB:459 |
| MOD-019 | liste des modèles | option de MOD-016 | Nombre d’étapes | Number of steps | valeur `etapes` (décroissant) | — | BIB:460 |
| MOD-020 | liste des modèles | icône cliquable (`aria-pressed`) | (aria-label) Grille | Grid | `setVue('grille')` | — | BIB:463-466 |
| MOD-021 | liste des modèles | icône cliquable (`aria-pressed`) | (aria-label) Liste | List | `setVue('liste')` | — | BIB:467-470 |
| MOD-022 | M-09 | bouton (`aria-expanded`) | Filtres (n) | Filters (n) | ouvre ou ferme le panneau de filtres mobile | < md seulement (`md:hidden`) | BIB:473-477 |
| MOD-023 | M-09 | bouton | Tous les modèles | All templates | `reinitialiser` (ne ferme pas le panneau) | < md, panneau ouvert | BIB:481-484 |
| MOD-024 | M-03 | carte cliquable (une par modèle) : miniature, catégorie, nom, description, « n étape(s) », icônes de canaux | {nom du modèle} | idem | `ouvrirApercu` : nouvelle clé d'idempotence, affiche l'aperçu | — | BIB:239-242, 347-361 |
| MOD-025 | M-04 | ligne cliquable (une par modèle) | {nom du modèle} | idem | `ouvrirApercu` ; l'étiquette de catégorie est masquée < sm | — | BIB:327-338 |
| MOD-026 | M-02 | bouton | Réessayer | Try again | relance GET `/api/automations/templates` | erreur de chargement | BIB:293-295 |
| MOD-027 | M-05 | bouton | Réinitialiser les filtres | Reset filters | `reinitialiser` | aucun résultat | BIB:316-318 |
| MOD-028 | M-06 | bouton (pied) | Retour | Back | `setApercu(null)` : retour à la liste | désactivé pendant `envoi` | BIB:412-414 |
| MOD-029 | M-06 | bouton principal (pied) | Utiliser ce modèle | Use this template | `utiliserModele` POST `/api/automations/templates/utiliser` `{templateId}` + en-tête `Idempotency-Key`. Succès : la page ferme la bibliothèque, toast « Automatisation créée en brouillon » / « Automation created as a draft », `navigate('/automations/{id}')`. Erreur : toast (message du serveur), la fenêtre reste ouverte | désactivé pendant `envoi` ; verrou synchrone anti double-clic | BIB:244-260, 415-419 ; A:1265-1270 |

Non interactif dans l'aperçu d'un modèle : déclencheur, « Aucune condition. » / « No conditions. » ou « Conditions : … », étapes numérotées, textes avec variables surlignées (BIB:367-406, 497-523).

#### 2.3 Éditeurs de message (MSG)

| ID | État(s) où il apparaît | Type | Libellé FR | Libellé EN | Ce qu'il fait d'après le code | Visible / actif seulement si | Source |
|---|---|---|---|---|---|---|---|
| MSG-001 | E-01 | zone de texte (3 lignes, redimensionnable) | (aria-label) SMS envoyé au client | SMS sent to client | `setTexte` ; aucun `maxLength` | ligne à l'ANCIEN format (`steps` vide) avec action `send_sms` ; ligne de corbeille comprise | ME:140-146 |
| MSG-002 | E-01 | bouton « Insérer : » (title `[client_first_name]`) | Prénom du client | Client first name | ajoute `[client_first_name]` À LA FIN du texte | idem | ME:196-206 ; emailBodyText.ts:195 |
| MSG-003 | E-01 | bouton Insérer (title `[client_name]`) | Nom complet | Full name | ajoute `[client_name]` à la fin | idem | emailBodyText.ts:196 |
| MSG-004 | E-01 | bouton Insérer (title `[company_name]`) | Votre entreprise | Your company | ajoute `[company_name]` | idem | emailBodyText.ts:197 |
| MSG-005 | E-01 | bouton Insérer (title `[invoice_number]`) | N° de facture | Invoice # | ajoute `[invoice_number]` | idem | emailBodyText.ts:198 |
| MSG-006 | E-01 | bouton Insérer (title `[invoice_total]`) | Montant | Amount | ajoute `[invoice_total]` | idem | emailBodyText.ts:199 |
| MSG-007 | E-01 | bouton Insérer (title `[quote_number]`) | N° de soumission | Quote # | ajoute `[quote_number]` | idem | emailBodyText.ts:200 |
| MSG-008 | E-01 | bouton Insérer (title `[appointment_date]`) | Date du RDV | Appointment date | ajoute `[appointment_date]` | idem | emailBodyText.ts:201 |
| MSG-009 | E-01 | bouton Insérer (title `[appointment_time]`) | Heure du RDV | Appointment time | ajoute `[appointment_time]` | idem | emailBodyText.ts:202 |
| MSG-010 | E-01 à E-06 | bouton | Enregistrer | Save | `updateRuleMessage(ruleId, 'send_sms', texte)` : SELECT puis UPDATE Supabase `automation_rules` (réécrit TOUTES les actions `send_sms` de la règle) ; toast « Message enregistré » / « Message saved » ; `onSaved` = `load()` de la liste ; erreur : message levé ou « Enregistrement impossible » / « Could not save » | actif seulement si texte modifié, non vide, pas d'enregistrement en cours | ME:63-77, 217-231 ; RAPI:83-157 |
| MSG-011 | E-02 | bouton | Annuler | Cancel | remet le texte d'origine | visible seulement si modifié | ME:232-240 |
| MSG-012 | E-07 | bouton | Modifier | Edit | ouvre l'éditeur de courriel (E-08) | ligne à l'ancien format avec action `send_email` | ME:89-94 |
| MSG-013 | E-08, E-09 | icône cliquable × | (aria-label) Fermer | Close | `fermer` : si modifié, confirmation E-13 ; sinon ferme | — | EPE:307-315, 421-427 |
| MSG-014 | E-08, E-09 | clic sur le fond | — | — | `fermer` (même garde) | — | EPE:401-406 |
| MSG-015 | E-08, E-09 | raccourci clavier Échap (écouteur `window`) | — | — | `fermer` (même garde) | — | EPE:318-322 |
| MSG-016 | E-08, E-09 | onglet (bouton simple) | Modifier | Edit | `setOngletApercu(false)` | — | EPE:441-450 |
| MSG-017 | E-08, E-09 | onglet (bouton simple) | Aperçu réel | Real preview | `setOngletApercu(true)` puis POST `/api/emails/apercu` `{corpsHtml, type}` ; affiche l'iframe (`sandbox=""`, titre « Aperçu du courriel » / « Email preview ») ou « Aperçu indisponible pour le moment. Votre texte est intact — revenez à « Modifier ». » / « Preview unavailable right now. Your text is safe — go back to “Edit”. » | — | EPE:192-202, 451-484 |
| MSG-018 | E-09 | bouton | M’envoyer un essai (« Envoi… » pendant) | Send me a test (« Sending… ») | POST `/api/emails/apercu` `{corpsHtml, objet, type, envoyer: true}` : ENVOIE UN VRAI COURRIEL à l'adresse du compte connecté ; toast « Essai envoyé à {adresse} » / « Test sent to {adresse} » ; échec : « Envoi impossible » / « Could not send » (sans raison) | onglet Aperçu réel ; désactivé pendant l'envoi | EPE:181-190, 486-495 ; emailTemplatesApi.ts:217-242 |
| MSG-019 | E-08 | champ texte | (aria-label + placeholder) Objet du courriel ; étiquette « Objet » | Email subject ; « Subject » | `setObjet` ; au focus, les boutons Insérer visent l'objet | onglet Modifier | EPE:511-518 |
| MSG-020 | E-08 | zone de texte auto-dimensionnée, une par bloc | (aria-label) Titre / Paragraphe / Puce ; placeholder « Écrivez ici… » | Title / Paragraph / Bullet ; « Type here… » | `majBloc` ; au focus, ce bloc devient la cible des boutons Insérer | onglet Modifier | EPE:97-130, 546-551 |
| MSG-021 | E-08 | icône cliquable (corbeille), une par bloc | (title) Supprimer cette ligne | Remove this line | retire le bloc ; si non vide, toast « Ligne supprimée » / « Line removed » avec action d'annulation | visible SEULEMENT au survol de la ligne (`opacity-0 group-hover:opacity-100`) | EPE:333-352, 553-559 |
| MSG-022 | après MSG-021 | bouton d'action dans le toast | Annuler | Undo | réinsère le bloc à sa position | toast encore affiché | EPE:343-350 |
| MSG-023 | E-08 | bouton | Paragraphe | Paragraph | ajoute un bloc paragraphe vide en fin | onglet Modifier | EPE:570-575 |
| MSG-024 | E-08 | bouton | Puce | Bullet | ajoute un bloc puce vide en fin | onglet Modifier | EPE:576-581 |
| MSG-025 | E-08, E-09 (pied) | bouton « Insérer : » (title `[client_first_name]`) | + Prénom du client | + Client first name | `insererVariable` : ajoute à la fin de l'objet si l'objet a eu le focus en dernier, sinon à la fin du bloc actif (ou du dernier bloc) ; sans bloc : rien | toujours visible, y compris sur l'onglet Aperçu réel | EPE:357-370, 653-662 |
| MSG-026 | idem | bouton Insérer (title `[client_name]`) | + Nom complet | + Full name | idem avec `[client_name]` | idem | idem |
| MSG-027 | idem | bouton Insérer (title `[company_name]`) | + Votre entreprise | + Your company | idem | idem | idem |
| MSG-028 | idem | bouton Insérer (title `[invoice_number]`) | + N° de facture | + Invoice # | idem | idem | idem |
| MSG-029 | idem | bouton Insérer (title `[invoice_total]`) | + Montant | + Amount | idem | idem | idem |
| MSG-030 | idem | bouton Insérer (title `[quote_number]`) | + N° de soumission | + Quote # | idem | idem | idem |
| MSG-031 | idem | bouton Insérer (title `[appointment_date]`) | + Date du RDV | + Appointment date | idem | idem | idem |
| MSG-032 | idem | bouton Insérer (title `[appointment_time]`) | + Heure du RDV | + Appointment time | idem | idem | idem |
| MSG-033 | idem | famille de boutons Insérer générés par les données : un par champ de base (objets client, deal, job, devis, facture — « une quarantaine » d'après champs/automatisations.tsx:330) puis un par champ personnalisé non archivé | + {Objet} · {libellé du champ} (title `{{objet.cle}}`) | idem en anglais | insère `{{objet.cle}}` au même endroit que MSG-025 | champs de base : toujours ; champs personnalisés : drapeau champs perso actif (`useChampsTous`) | EPE:208-215 ; champs/automatisations.tsx:33-43, 389-413 |
| MSG-034 | — | bouton | Revenir au texte d’origine | Restore original | appelle `revenirAuDefaut` | ABSENT depuis la liste : `MessageEditor` ne passe pas cette prop (présent seulement depuis Paramètres → Modèles de courriel) | EPE:675-682 ; ME:116-124 |
| MSG-035 | E-08, E-09 (pied) | bouton | Fermer | Close | `fermer` (garde E-13) | — | EPE:683-688 |
| MSG-036 | E-08, E-09 (pied) | bouton | Enregistrer | Save | `updateRuleMessage(ruleId, 'send_email', html, objet)` : SELECT puis UPDATE Supabase `automation_rules` ; toast « Courriel enregistré » / « Email saved » ; `onSaved` = `load()` de la liste ; erreurs : « Le message ne peut pas être vide. » / « The message cannot be empty. », « L’objet du courriel ne peut pas être vide. » / « The email subject cannot be empty. », « Modification refusée — vous n'avez pas accès à cette automatisation. » (FR seulement), ou « Enregistrement impossible » / « Could not save » | actif seulement si modifié et pas d'enregistrement en cours | EPE:372-398, 689-702 ; RAPI:98-105, 154-156 |
| MSG-037 | E-13 | dialogue de confirmation (boutons LST-093 à 097) | titre par défaut « Êtes-vous sûr ? » ; message « Vos modifications ne sont pas enregistrées. Fermer quand même ? » ; boutons « Annuler » / « Confirmer » (rouge) | « Are you sure? » ; « Your changes are not saved. Close anyway? » ; « Cancel » / « Confirm » | confirmer = ferme et perd les modifications | fermeture avec modifications | EPE:307-315 ; CD:122-147 |

#### 2.4 Vue d'ensemble `/automations/apercu` (APR)

| ID | État(s) où il apparaît | Type | Libellé FR | Libellé EN | Ce qu'il fait d'après le code | Visible / actif seulement si | Source |
|---|---|---|---|---|---|---|---|
| APR-001 | tous | bouton (sous-navigation) | Automatisations | Workflows | `navigate('/automations')` | toujours (mais la cible exige `automations.update`) | APR:92-98 |
| APR-002 | tous | bouton (sous-navigation) | Réglages globaux | Global settings | `navigate('/automations/reglages')` | toujours (cible : `automations.update`) | APR:105-112 |
| APR-003 | P-08 | bouton | Voir les automatisations à vérifier | See workflows needing review | `navigate('/automations?onglet=verifier')` | au moins un échec lu sur 7 jours | APR:226-232 |
| APR-004 | ENV-5 | bouton | Voir les détails | See details | même élément que LST-001 | forfait sans `includes_automations` | PFG:82-88 |

Non interactif : section courante « Vue d'ensemble » + pastille « Bêta » (APR:99-104) ; 3 tuiles « Total des automatisations » / « Total workflows », « Automatisations publiées » / « Published workflows », « Total des déclenchements » / « Total enrollments » (APR:124-134) ; histogramme `role="img"` sans infobulle ni clic (APR:148-175).

#### 2.5 Réglages globaux `/automations/reglages` (REG)

| ID | État(s) où il apparaît | Type | Libellé FR | Libellé EN | Ce qu'il fait d'après le code | Visible / actif seulement si | Source |
|---|---|---|---|---|---|---|---|
| REG-001 | tous | bouton (sous-navigation) | Automatisations | Workflows | `navigate('/automations')` | toujours | REG:74-80 |
| REG-002 | tous | bouton (sous-navigation) | Vue d’ensemble (sans pastille « Bêta » ici) | Overview | `navigate('/automations/apercu')` | toujours | REG:81-87 |
| REG-003 | R-02 | bouton d'allure lien (carte « Langue des messages », à côté de la valeur « Français » ou « English ») | Changer dans les réglages | Change it in settings | `navigate('/settings/company')` | cible gardée par `settings.update` | REG:118-129 ; App.tsx:1608 |
| REG-004 | R-02 (carte « Adresses d’appel » / « Incoming addresses ») | bouton | Créer une adresse | Create an address | `creerAdresseDAppel` POST `/api/automations/webhooks` avec un nom FIXE « Formulaire de mon site » / « My website form » (aucune saisie) ; l'adresse est ajoutée et dévoilée ; toast « Adresse créée. » / « Endpoint created. » ; erreur : « Impossible de créer l’adresse. » / « Could not create the endpoint. » (raison du serveur non affichée) | désactivé pendant `creation` | ADA:60-76, 249-259 |
| REG-005 | adresse | bouton-état | Active / En pause | Active / Paused | `basculerAdresseDAppel` PATCH `/api/automations/webhooks/{id}` `{enabled}` ; affichage optimiste ; erreur : retour + toast « Changement non enregistré. » / « Change not saved. » ; aucun toast de succès | jamais désactivé pendant l'appel | ADA:116-125, 178-188 |
| REG-006 | adresse | icône cliquable (corbeille) | (aria-label) Supprimer {nom} | Delete {nom} | Confirmation : titre « Supprimer cette adresse ? » / « Delete this endpoint? » ; message « Le service branché sur cette adresse cessera de déclencher vos automatisations. Cette adresse ne pourra pas être réutilisée. » / « Whatever is connected to this address will stop triggering your automations. This address cannot be reused. » ; bouton rouge « Supprimer » / « Delete ». Puis retrait optimiste et DELETE `/api/automations/webhooks/{id}` ; erreur : retour + toast « Suppression impossible. » / « Could not delete. » ; aucun toast de succès | — | ADA:127-147, 189-196 |
| REG-007 | R-05 | icône cliquable (œil) | (aria-label) Afficher l’adresse / Masquer l’adresse | Show address / Hide address | dévoile ou masque l'URL complète `{origine}/api/hooks/{clé}` | clé connue (juste après création ou régénération) | ADA:205-218 |
| REG-008 | R-05 | icône cliquable (copier) | (aria-label) Copier l’adresse | Copy address | `navigator.clipboard.writeText(url)` ; coche verte 2 s, pas de toast ; échec : dévoile l'adresse + toast « Copie impossible : sélectionnez l’adresse affichée. » / « Copy failed: select the address shown. » | clé connue | ADA:99-114, 219-228 |
| REG-009 | R-06 | bouton | Régénérer | Regenerate | Confirmation : titre « Régénérer cette adresse ? » / « Regenerate this address? » ; message « Une nouvelle adresse sera créée et affichée une seule fois. L’ancienne cessera immédiatement de déclencher vos automatisations : il faudra coller la nouvelle chez votre fournisseur. » / « A new address will be created and shown once. The old one will stop triggering your automations immediately: paste the new one at your provider. » ; bouton rouge « Régénérer » / « Regenerate ». Puis POST `/api/automations/webhooks/{id}/regenerer` ; toast « Nouvelle adresse : copiez-la maintenant, elle ne sera plus affichée. » / « New address: copy it now, it will not be shown again. » ; erreur : message du serveur ou « Régénération impossible. » / « Could not regenerate. » | clé non connue (après rechargement de la page) ; aucun état occupé pendant l'appel | ADA:78-97, 229-238 |
| REG-010 | ENV-5 | bouton | Voir les détails | See details | même élément que LST-001 | forfait sans `includes_automations` | PFG:82-88 |

Non interactif : les cartes Notifications, Enregistrement automatique (« Auto save »), Mettre en pause (« Pause workflows »), Fenêtre d'envoi (« Send window »), Lumi (« Workflow AI ») ne contiennent qu'un encadré d'information « Déjà en place… » (REG:133-210). Les dialogues de confirmation utilisent LST-093 à 097.

#### 2.6 Décompte

| Écran | Lignes d'inventaire |
|---|---|
| Liste (LST) | 103 |
| Bibliothèque de modèles (MOD) | 29 |
| Éditeurs de message (MSG) | 37 |
| Vue d'ensemble (APR) | 4 |
| Réglages globaux (REG) | 10 |
| Total | 183 |

---

### 3. Appels API

Tous les appels serveur portent `Authorization: Bearer`, `x-org-id` et `Accept-Language` (BAPI:65-78, WAPI:34-47). Via `appelServeur`, une coupure réseau devient « Connexion perdue — vérifiez votre réseau et réessayez. Rien n’a été modifié. » / « Connection lost — check your network and try again. Nothing was changed. » (appelServeur.ts:10-21). Côté serveur, les droits reposent sur la RLS (`automations.read` en lecture, `automations.update` en écriture ; `company_settings` modifiable par un administrateur seulement).

| # | Écran | Fonction cliente | Méthode et chemin / table | Quand il part | Succès à l'écran | Erreur à l'écran |
|---|---|---|---|---|---|---|
| 1 | Liste, Aperçu | `getAutomationRules` (RAPI:45) | Supabase SELECT `automation_rules` (`*`, `org_id`, `purged_at IS NULL`, tri par nom) | montage ; à chaque `load()` | tableau, compteurs d'onglets ; tuiles de l'aperçu | Liste : état L-02 + toast « Impossible de charger les automatisations » / « Failed to load automations » ; Aperçu : « — » dans 2 tuiles |
| 2 | Liste, Aperçu | `getRecentAutomationFailures(200)` (RAPI:230) | Supabase SELECT `automation_execution_logs` (échecs, 7 jours, 200 max) | dans `load()` ; montage de l'aperçu | mention d'échecs par ligne, onglet « À vérifier » ; résumé de l'aperçu | Liste : console seulement (0 échec affiché) ; Aperçu : texte orange P-06 |
| 3 | Liste | `chargerStatistiques` (BAPI:201) | GET `/api/automations/rules/stats` | dans `load()` | colonnes « Total déclenché », « En cours », panneau stats, bandeau texto | console ; « — » dans les colonnes ; « Les chiffres n’ont pas pu être lus. » |
| 4 | Liste | `chargerDossiers` (BAPI:447) | GET `/api/automations/folders` | montage | barre de dossiers | console seulement (pas de barre) |
| 5 | Liste, Réglages | `getAutomationLanguage` (RAPI:301) | Supabase SELECT `company_settings.default_language` | montage | bouton FR/EN actif ; valeur affichée dans Réglages | avalée : reste « fr » |
| 6 | Liste | `setAutomationLanguage` (RAPI:312) | Supabase UPDATE `company_settings` `{default_language}` + `.select` | clic FR / EN | toast « Messages en français / anglais » | toast : message d'erreur (0 ligne = « Seul un administrateur… ») |
| 7 | Liste | `avisActives` (RAPI:345) | Supabase SELECT `company_settings.review_enabled` | montage | avertissement L-25 si faux | avalée (aucun avertissement) |
| 8 | Liste | `chargerBureauxCibles` (BAPI:259) | GET `/api/automations/bureaux-cibles` | montage, jusqu'à 3 essais (800 ms puis 1 600 ms) | item « Copier vers d’autres bureaux » | console ; l'item n'apparaît pas |
| 9 | Liste | `lireEtatPause` (WAPI:116) | GET `/api/automations/pause` | montage de BandeauPause ; après chaque bascule | lien « Tout arrêter » ou bandeau rouge | avalée : rien n'est affiché |
| 10 | Liste | `basculerPause` (WAPI:123) | POST `/api/automations/pause` `{paused}` puis GET de relecture | LST-004, LST-005 | toast « Automatisations en pause. » / « reprises. » | toast : message du serveur (403 « Seul un administrateur peut arrêter… ») ou « Changement non enregistré. » |
| 11 | Liste | `creerDossier` (BAPI:453) | POST `/api/automations/folders` `{name}` | LST-010, LST-012 | toast « Dossier « X » créé » | toast : message du serveur ou repli « Impossible de créer le dossier. » |
| 12 | Liste | `renommerDossier` (BAPI:461) | PATCH `/api/automations/folders/{id}` `{name}` | LST-030, LST-032 | aucun message (nom déjà affiché) | retour arrière + toast |
| 13 | Liste | `supprimerDossier` (BAPI:470) | DELETE `/api/automations/folders/{id}` | LST-033 après confirmation | aucun message ; rechargement | toast |
| 14 | Liste | `rangerDansDossier` → `modifierAutomatisation` (BAPI:478, 133) | PATCH `/api/automations/rules/{id}` `{folder_id}` | LST-081, LST-082 | toast « Rangée dans le dossier » / « Remise à la racine » | toast : message du serveur ou « Impossible de modifier l'automatisation. » |
| 15 | Liste | `changerPublication` (BAPI:151) | POST `/api/automations/rules/{id}/publication` `{actif}` | LST-073 (file : une requête en vol par règle) | toast « Automatisation publiée » / « Repassée en brouillon » | toast 10 s : message du serveur (problèmes du parcours) ; retour à l'état confirmé |
| 16 | Liste | `changerPublicationEnLot` (BAPI:167) | POST `/api/automations/rules/publication` `{ids, actif}` | LST-054, LST-055 | toast « n automatisation(s) publiée(s) » | toast 15 s par règle refusée ; ou toast global |
| 17 | Liste | `apercuClientsInactifs` (reservationApi.ts:44) | GET `/api/automations/clients-inactifs/apercu?mois=N` (`fetch` brut) | LST-073 sur une règle `client.inactive` vers publiée | nombre dans le dialogue LST-074 | console ; dialogue sans le nombre |
| 18 | Liste | `dupliquerAutomatisation` (BAPI:213) | POST `/api/automations/rules/{id}/duplicate` | LST-078 | toast « Copie créée — elle est en brouillon » | toast |
| 19 | Liste | `supprimerAutomatisation` (BAPI:276) | DELETE `/api/automations/rules/{id}` | LST-083, LST-056 | toast « Automatisation mise à la corbeille » | toast |
| 20 | Liste | `restaurerAutomatisation` (BAPI:512) | POST `/api/automations/rules/{id}/restaurer` | LST-084, LST-057 | toast « Automatisation restaurée — elle est en brouillon » | toast |
| 21 | Liste | `supprimerDefinitivementAutomatisation` (BAPI:525) | DELETE `/api/automations/rules/{id}/definitivement` | LST-085, LST-058 | toast « Automatisation supprimée définitivement » | toast |
| 22 | Liste | `copierVersBureaux` (BAPI:266) | POST `/api/automations/rules/{id}/copier-bureaux` `{org_ids, lier}` | LST-103 | liste de résultats par bureau | toast ; la modale reste sur le formulaire |
| 23 | Bibliothèque | `fetchModelesAutomatisation` (BAPI:224) | GET `/api/automations/templates` (`fetch` brut, sans `appelServeur`) | ouverture de la bibliothèque ; MOD-026 | cartes | état M-02 avec le message brut |
| 24 | Bibliothèque | `utiliserModele` (BAPI:236) | POST `/api/automations/templates/utiliser` `{templateId}` + `Idempotency-Key` (`fetch` brut) | MOD-029 | toast « Automatisation créée en brouillon » + navigation vers l'éditeur | toast (message du serveur, ex. 403 « Votre rôle ne permet pas de créer une automatisation. ») |
| 25 | Messages | `updateRuleMessage` (RAPI:83) | Supabase SELECT `automation_rules` (`actions, steps`) puis UPDATE (`actions`, éventuellement `steps`, `updated_at`) | MSG-010, MSG-036 | toast « Message enregistré » / « Courriel enregistré » ; rechargement de la liste | toast : message levé |
| 26 | Messages | `getCompanyBranding` (RAPI:275) | Supabase SELECT `company_settings` (`company_name, logo_url, phone, email`) | ouverture de l'éditeur de courriel | logo, pied de page | avalée (nom « Lume » par défaut) |
| 27 | Messages | `apercuCourriel` (emailTemplatesApi.ts:180) | POST `/api/emails/apercu` `{corpsHtml, type}` | chaque passage sur l'onglet « Aperçu réel » | iframe | « Aperçu indisponible pour le moment… » |
| 28 | Messages | `envoyerEssaiCourriel` (emailTemplatesApi.ts:217) | POST `/api/emails/apercu` `{corpsHtml, objet, type, envoyer: true}` | MSG-018 | toast « Essai envoyé à … » (vrai courriel) | toast « Envoi impossible » |
| 29 | Messages | `listerChamps` via `useChampsTous` (champs/automatisations.tsx:33) | lecture des champs personnalisés (react-query, cache 60 s) | ouverture de l'éditeur de courriel, si le drapeau champs perso est actif | boutons MSG-033 | non lu ici (hors périmètre) |
| 30 | Aperçu | `activiteParSemaine(7)` (automationJournauxApi.ts:365) | Supabase SELECT `automation_execution_logs` (7 semaines, 5 000 lignes max) | montage | tuile « Total des déclenchements », courbe | erreur Supabase : console + total 0 et 7 barres vides (pas de message) |
| 31 | Réglages | `listerAdressesDAppel` (WAPI:60) | GET `/api/automations/webhooks` | montage de la carte ; relancé si la langue d'interface change | liste | toast « Impossible de lire vos adresses d’appel. » / « Could not load your endpoints. » + liste vide |
| 32 | Réglages | `creerAdresseDAppel` (WAPI:67) | POST `/api/automations/webhooks` `{name}` | REG-004 | toast « Adresse créée. » | toast générique |
| 33 | Réglages | `basculerAdresseDAppel` (WAPI:77) | PATCH `/api/automations/webhooks/{id}` `{enabled}` | REG-005 | changement de libellé | retour + toast « Changement non enregistré. » |
| 34 | Réglages | `regenererAdresseDAppel` (WAPI:88) | POST `/api/automations/webhooks/{id}/regenerer` | REG-009 après confirmation | nouvelle adresse dévoilée + toast | toast : message du serveur ou repli |
| 35 | Réglages | `supprimerAdresseDAppel` (WAPI:97) | DELETE `/api/automations/webhooks/{id}` | REG-006 après confirmation | la ligne disparaît | retour + toast « Suppression impossible. » |

Notes : `src/lib/automationEventsApi.ts` n'est importé par AUCUN des fichiers de ces écrans (grep de contrôle : 0 résultat) ; ses appels `POST /api/automations/events/*` partent d'ailleurs dans l'app. `toggleAutomationRule`, `updateRuleSmsBody`, `getFailureCountsByRule` (RAPI) et `chargerAutomatisations` (BAPI) ne sont pas appelés par ces écrans. Les gardes font en plus leurs propres lectures (`usePermissions`, `usePlanFeature`), non détaillées ici.

---

### 4. Soupçons à vérifier au navigateur

Ce sont des pistes tirées de la lecture. Rien ici n'a été exécuté.

#### Permissions et navigation

| # | Soupçon | Ce qu'il faut faire à l'écran pour trancher | Source |
|---|---|---|---|
| S-01 | Un rôle avec `automations.read` sans `automations.update` passe la garde de la route `/automations` mais la page est enveloppée par `automations.update` : la tuile de navigation mène à « Accès restreint ». La vue d'ensemble, elle, lui est ouverte, mais aucun lien n'y mène et ses deux boutons de sous-navigation pointent vers des pages interdites. | Se connecter avec un rôle lecture seule ; cliquer la tuile Automatisations ; ouvrir `/automations/apercu` à la main, cliquer « Automatisations » puis « Réglages globaux ». | App.tsx:1654 ; A:1219 ; APR:92-112 |
| S-02 | « Changer dans les réglages » envoie vers `/settings/company`, gardé par `settings.update` : un rôle qui n'a que `automations.update` arrive sur « Accès restreint ». | Avec un tel rôle, cliquer REG-003. | REG:124 ; App.tsx:1608 |
| S-03 | La page Réglages dit que la langue se change ailleurs « pour ne pas avoir deux endroits », alors que la liste a un interrupteur FR/EN qui écrit le même réglage. Deux endroits, deux discours. | Changer la langue depuis la liste, puis lire la carte « Langue des messages » des réglages. | A:1296-1311 ; REG:106-130 |
| S-04 | L'onglet n'est jamais écrit dans l'URL : rafraîchir ou revenir en arrière ramène sur « Toutes » ; le `?onglet=` d'arrivée reste dans l'URL après changement d'onglet. | Ouvrir « Corbeille », F5 ; puis arriver par `?onglet=verifier`, changer d'onglet, F5. | A:441-445, 1418 |
| S-05 | La sous-navigation est faite de boutons, pas de liens : pas d'ouverture dans un nouvel onglet, pas d'`aria-current`. | Ctrl+clic / clic milieu sur « Vue d'ensemble ». | A:1231-1248 |
| S-06 | Le nom d'une ligne de la CORBEILLE reste cliquable et ouvre l'éditeur d'une automatisation supprimée ; son panneau « messages » (ancien format) reste éditable. | Dans Corbeille, cliquer le nom ; déplier ⌄ et tenter d'enregistrer un SMS. | A:1788-1790, 2143-2163 |

#### Menus, dialogues, clavier

| # | Soupçon | Ce qu'il faut faire à l'écran pour trancher | Source |
|---|---|---|---|
| S-07 | Le menu ⋮ est en `absolute` dans un conteneur `overflow-x-auto` lui-même dans une carte `overflow-hidden` : sur les dernières lignes (ou une liste d'une ou deux lignes) il risque d'être coupé, surtout sous-menu déplié. | Ouvrir ⋮ sur la dernière ligne, puis « Déplacer dans un dossier » ; refaire avec une seule ligne à l'écran. | A:1690-1692, 1926 |
| S-08 | Aucun menu ne gère le clavier : Échap ne ferme ni « Créer » ni ⋮, pas de flèches, pas de focus déplacé dans le menu. | Ouvrir chaque menu au clavier, appuyer sur Échap, flèches, Tab. | A:1381-1404, 1921-2048 |
| S-09 | Les deux menus peuvent être ouverts en même temps (chaque bouton fait `stopPropagation`, donc n'active pas la fermeture de l'autre). | Ouvrir ⋮ d'une ligne puis cliquer « Créer ». | A:1371, 1910, 710-715 |
| S-10 | Le sous-menu de dossiers n'est jamais replié à la fermeture du menu : rouvrir ⋮ sur la même ligne le montre déjà déplié ; recliquer « Déplacer dans un dossier » ne le replie pas. | Déplier le sous-menu, cliquer ailleurs, rouvrir ⋮. | A:460, 1998, 2009 |
| S-11 | La modale « Copier vers d'autres bureaux » n'a aucun raccourci Échap, pas de focus initial ni de piège de focus ; × , « Annuler » et le fond restent actifs pendant la copie (les résultats sont alors perdus). | Ouvrir la modale, Échap ; lancer « Copier » et cliquer aussitôt sur le fond. | CVB:63-78, 135-137 |
| S-12 | L'éditeur de courriel n'a ni `role="dialog"`, ni piège de focus, ni focus initial ; ses deux onglets sont de simples boutons sans `aria-selected`. | Ouvrir l'éditeur, tabuler : le focus sort-il vers la page derrière ? | EPE:401-461 |
| S-13 | Un glisser de sélection de texte qui se termine hors de la carte déclenche le clic du fond : l'éditeur de courriel (sans modification), la modale de copie et la bibliothèque se ferment. | Sélectionner le texte de l'objet en relâchant la souris sur le fond gris. | EPE:405 ; CVB:63 ; MODAL:77 |
| S-14 | Pendant « Utiliser ce modèle », × / Échap / fond ferment la bibliothèque ; la création aboutit quand même et navigue vers l'éditeur après coup. | Cliquer « Utiliser ce modèle » puis Échap immédiatement (réseau ralenti). | BIB:244-260 ; MODAL:50, 77 ; A:1264-1269 |
| S-15 | Renommage de dossier : Entrée valide puis le champ disparaît ; si le navigateur émet un `blur` au démontage, un 2e PATCH part. Même question pour Échap (annule-t-il vraiment, ou le `blur` enregistre-t-il ?). Cliquer la corbeille du dossier pendant le renommage enchaîne renommage puis suppression. | Onglet Réseau ouvert : renommer avec Entrée (compter les PATCH) ; taper un nom puis Échap ; taper un nom puis cliquer la corbeille. | A:1477-1483, 651-666 |
| S-16 | Dans le dialogue de confirmation, le focus est sur « Annuler » : Entrée annule. Voulu, mais à vérifier pour « Activer « Client inactif » ? » (non destructif). | Déclencher chaque confirmation et appuyer sur Entrée. | CD:94-95 |

#### États occupés, double clic, décalages

| # | Soupçon | Ce qu'il faut faire à l'écran pour trancher | Source |
|---|---|---|---|
| S-17 | Chaque `load()` remplace tout le tableau par une roue : après dupliquer, déplacer, supprimer, enregistrer un message… la liste clignote et la position de défilement peut sauter. | Faire défiler bas de page, déplacer une règle dans un dossier, observer. | A:551, 1672 |
| S-18 | Enregistrer dans l'éditeur de courriel appelle `onSaved` = `load()` : le tableau est démonté, donc l'éditeur plein cadre disparaît de lui-même au moment du succès (aucun bouton « Fermer » cliqué). Idem pour le bloc SMS qui est remonté. | Modifier un courriel d'une règle à l'ancien format, cliquer Enregistrer : la fenêtre se ferme-t-elle seule ? Le panneau reste-t-il déplié ? | EPE:389 ; ME:123 ; A:2161, 1672 |
| S-19 | « Dupliquer » : le menu se ferme, une roue remplace ⋮ mais le bouton reste cliquable : rouvrir et recliquer crée une 2e copie. | Réseau ralenti : Dupliquer, rouvrir ⋮, Dupliquer. Compter les copies. | A:835-847, 1908-1919 |
| S-20 | Cocher la première case fait apparaître la barre de lot AU-DESSUS du tableau : toutes les lignes descendent, le clic suivant peut tomber sur une autre ligne. Même effet en ouvrant « Filtres avancés ». | Cocher une ligne puis cliquer aussitôt au même endroit. | A:1596-1669 |
| S-21 | « Publier (0) » et « Repasser en brouillon (0) » restent actifs : le clic vide la sélection sans aucun message. | Cocher uniquement des lignes déjà publiées, cliquer « Publier (0) ». | A:1085-1086, 1627-1644 |
| S-22 | La publication en lot ne pose PAS la confirmation « Client inactif » que pose l'interrupteur d'une ligne. | Cocher une règle « Client inactif » en brouillon, « Publier ». | A:731-753 vs 1084-1112 |
| S-23 | Interrupteur d'une règle « Client inactif » : une lecture réseau précède le dialogue, sans aucun retour visuel ; pendant ce temps (et tant que le dialogue est ouvert) les clics sur les interrupteurs des AUTRES lignes sont ignorés en silence. | Réseau ralenti : cliquer l'interrupteur « Client inactif », puis celui d'une autre ligne. | A:728-753 |
| S-24 | Adresses d'appel : le bouton Active/En pause n'est jamais désactivé (clics rapides = PATCH parallèles, ordre d'arrivée non garanti) ; « Régénérer » et la suppression de dossier n'ont aucun état occupé. | Cliquer 5 fois vite sur « Active » ; recharger et comparer. | ADA:116-125, 78-97 ; A:668-685 |
| S-25 | Les erreurs de lot sont jointes par un saut de ligne dans un toast : affichage probable sur une seule ligne. Si la règle n'est plus dans la liste, c'est son identifiant brut qui est affiché. | Publier en lot deux parcours incomplets, lire le toast. | A:1098-1102 |

#### Erreurs avalées et faux « tout va bien »

| # | Soupçon | Ce qu'il faut faire à l'écran pour trancher | Source |
|---|---|---|---|
| S-26 | Si la lecture des échecs échoue dans la LISTE, rien n'est signalé : « À vérifier (0) » et « Aucune erreur — tout roule ». Le même défaut a été corrigé dans la vue d'ensemble, pas ici. | Bloquer la requête `automation_execution_logs`, recharger, ouvrir « À vérifier ». | A:575-591, 1744-1745 |
| S-27 | Lecture de l'état de pause échouée : aucun bandeau, aucun lien « Tout arrêter », aucun message. Le bouton d'urgence disparaît sans explication. | Bloquer `GET /api/automations/pause`, recharger. | BP:43-47, 94 |
| S-28 | Lecture des dossiers échouée : pas de barre ; « Déplacer dans un dossier » répond « Créez d'abord un dossier. » alors qu'il en existe. | Bloquer `GET /api/automations/folders`, ouvrir ⋮ → Déplacer. | A:465-471, 1992-1996 |
| S-29 | Adresses d'appel : un échec de lecture affiche un toast puis l'état VIDE « Aucune adresse pour l'instant » ; les erreurs de création, bascule et suppression jettent le message du serveur (un rôle sans droit lit « Impossible de créer l'adresse. » sans raison). | Bloquer `GET /api/automations/webhooks` ; tester la création avec un rôle sans droit. | ADA:51-55, 71-72, 121-123, 143-145 |
| S-30 | Vue d'ensemble : une erreur de lecture de l'activité donne « 0 » déclenchement et 7 barres vides, sans message ; le texte « Aucune donnée pour l'instant. » n'est quasi jamais atteint ; le résumé plafonne à 200 échecs et dit « envoi(s) » pour tout type d'action. | Bloquer la requête d'activité ; comparer avec un bureau à plus de 200 échecs. | APR:56-57, 142-145, 223 ; automationJournauxApi.ts:396-399 |
| S-31 | La langue : `getAutomationLanguage` ignore l'erreur et rend « fr ». Les réglages peuvent afficher « Français » pour un bureau en anglais ; la liste surligne « FR ». | Bloquer la lecture de `company_settings`, ouvrir les deux pages. | RAPI:301-310 ; A:518 ; REG:57-60 |
| S-32 | Enregistrer un SMS réécrit TOUTES les actions `send_sms` de la règle (même corps partout), alors que la liste montre un éditeur par action. | Trouver une règle à l'ancien format avec deux textos, en modifier un, recharger. | RAPI:119-121 ; A:2150-2163 |
| S-33 | « M'envoyer un essai » échoue sans raison (« Envoi impossible ») ; et il envoie un vrai courriel : à compter dans la tournée. | Cliquer MSG-018 ; vérifier la boîte ; couper le réseau et recliquer. | EPE:181-190 |

#### Libellés, langues, valeurs brutes

| # | Soupçon | Ce qu'il faut faire à l'écran pour trancher | Source |
|---|---|---|---|
| S-34 | Deux choses s'appellent « modèles » : l'onglet « Modèles » (préréglages du bureau non publiés, modifiables en place) et la « Bibliothèque de modèles » (copie en brouillon). Le bouton « Voir les modèles » de l'état vide mène à l'onglet, « Partir d'un modèle » à la bibliothèque. Dépublier un modèle dans « Toutes » le fait passer dans l'onglet « Modèles » au changement d'onglet. | Comparer les deux chemins ; dépublier un préréglage, changer d'onglet et revenir. | A:939-948, 1198, 1748-1757 |
| S-35 | Le même bouton s'appelle « Build using AI » dans l'en-tête et « Build with Lumi » dans le menu (anglais). En anglais toujours : « Workflows » (navigation, titre « Workflows list », onglet « All workflows ») contre « Automations » (toasts, états vides) ; onglet « Deleted » contre « bin » dans les messages ; « endpoint » contre « address » dans les adresses d'appel. | Passer l'interface en anglais et relever chaque terme. | A:1364, 1176, 1205-1208, 1229, 1292 ; ADA:53, 70, 129, 258 |
| S-36 | Français : « SMS envoyé au client » (éditeur) contre « Texto envoyé au client » (aperçu des parcours) et « étapes texto » (bandeau). Tutoiement (« Tu pourras la restaurer », « Décris ce que tu veux ») contre vouvoiement (« Créez d'abord un dossier. », « Activez-les dans Paramètres »). | Relever les deux formes sur la page. | ME:136 ; A:2122, 1283, 853, 1177, 1995, 1814 |
| S-37 | Messages de repli en français seulement, visibles en interface anglaise quand le serveur ne fournit pas de texte : « Impossible de dupliquer l'automatisation. », « Session expirée. », « Action impossible pour le moment. », « Modification refusée — vous n'avez pas accès à cette automatisation. ». À l'inverse « No organization » est en anglais seulement. Le motif de la dernière étape sautée (panneau stats) vient du moteur en français. | Interface en anglais : provoquer une erreur (session expirée, 500) sur dupliquer, pause, enregistrement d'un message ; déplier les stats d'une règle avec une étape sautée. | BAPI:68, 88-96 ; WAPI:37, 57 ; RAPI:155, 314 ; A:2074-2077 |
| S-38 | Valeurs brutes possibles : clé technique du déclencheur si elle n'est ni au catalogue ni dans `TRIGGER_DISPLAY` (sous-titre d'une ligne) ; dans l'aperçu d'un modèle, les conditions s'affichent avec leurs clés et valeurs techniques (« source ≠ request_form »), le type d'action ou la clé de déclencheur en repli ; dans la modale de copie, `erreur` et « À revoir » du serveur tels quels ; noms de préréglages non listés dans `automationNames.ts` laissés dans leur langue d'origine. | Ouvrir l'aperçu de chaque modèle et lire la ligne « Conditions » ; chercher dans la liste un sous-titre contenant un point (ex. `x.y`) ; en anglais, repérer les noms restés en français. | A:1801 ; BIB:75-95, 385-387, 397 ; CVB:58, 125 ; automationNames.ts:131-134 |
| S-39 | Filtre « Catégorie » : toute automatisation sans clé de préréglage connue est rangée dans « Suivi » ; les autres catégories ne contiennent que des préréglages. | Créer une automatisation de devis, filtrer « Devis » puis « Suivi ». | A:922-923, 956 |
| S-40 | Vide après filtre : même texte « Aucune automatisation » que le vrai vide, le bouton « Filtres avancés » ne signale pas qu'un filtre est actif une fois le panneau refermé, et « Voir les modèles » s'affiche même quand le vide vient de la recherche. | Filtrer « Publiée » sur une catégorie vide, refermer le panneau ; taper une recherche sans résultat dans « Toutes ». | A:1525-1531, 1737-1757 |
| S-41 | La recherche porte aussi sur `description`, jamais affichée : des lignes sortent sans mot correspondant visible. Elle ne porte pas sur le libellé du déclencheur. | Chercher un mot d'une description (ex. un mot anglais d'un préréglage) et un nom de déclencheur. | A:951-955 |
| S-42 | Tri : cliquer un en-tête prend le pas sur le menu « Trier » (qui continue d'afficher son choix), et rien ne permet de revenir à l'ordre par défaut sans recharger. | Choisir « Créées le plus récemment », cliquer l'en-tête « Nom », regarder le menu. | A:513-516, 981-992 |
| S-43 | Le « fil d'Ariane » est un texte fixe « Accueil » : pas un lien, et il n'affiche pas le dossier ouvert. Le panneau de stats renvoie à l'onglet « Journaux » sans lien. L'avertissement « Activez-les dans Paramètres › Avis clients » est dans le bouton du nom : cliquer dessus ouvre l'éditeur, pas les paramètres. | Ouvrir un dossier et lire le fil ; cliquer l'avertissement d'avis. | A:1589, 2079-2081, 1810-1817 |
| S-44 | Carte « Mettre en pause » des réglages : le texte dit que chaque automatisation se met en pause individuellement, sans mentionner « Tout arrêter » qui existe sur la liste. « Vue d'ensemble » porte la pastille « Bêta » partout sauf dans la sous-navigation des réglages. | Lire la carte ; comparer les trois sous-navigations. | REG:159-169, 81-87 ; A:1236-1239 |
| S-45 | Adresses d'appel : la création n'offre aucune saisie de nom et aucune façon de renommer : plusieurs adresses portent toutes « Formulaire de mon site ». | Créer trois adresses. | ADA:60-66 |
| S-46 | Bibliothèque : « Tous les modèles » efface aussi le texte de recherche, et son `aria-pressed` reste vrai pendant une recherche ; la recherche et les catégories sont remises à zéro à la fermeture, pas le tri ni la vue. | Taper une recherche puis cliquer « Tous les modèles » ; fermer, rouvrir. | BIB:206-209, 237, 426 |
| S-47 | Aperçu des parcours (lecture seule) : variables affichées brutes (`[client_first_name]`), alors que l'éditeur à l'ancien format montre des exemples ; les demandes d'avis n'y figurent pas. | Déplier ⌄ sur une règle à étapes et sur une règle ancienne. | A:2109-2131 ; ME:58-61 |
| S-48 | Boutons « Insérer » : toujours ajoutés en FIN de texte ou de bloc, jamais au curseur ; dans l'éditeur de courriel ils restent actifs sur l'onglet « Aperçu réel » (modifient le texte caché) et ne font rien sur un courriel sans bloc ; la liste peut dépasser 50 boutons (8 génériques + champs de base + champs personnalisés). | Placer le curseur au milieu d'un texto, cliquer une variable ; vider un courriel et cliquer une variable ; compter les boutons du pied. | ME:201 ; EPE:357-370, 653-662 |

#### Accessibilité et largeurs d'écran

| # | Soupçon | Ce qu'il faut faire à l'écran pour trancher | Source |
|---|---|---|---|
| S-49 | Téléphone : le tableau fait au moins 980 px, donc interrupteur, ⌄ et ⋮ sont hors écran sans défilement horizontal ; aucune disposition mobile. Sous 1024 px, les colonnes « Modifiée le » / « Créée le » et leur tri disparaissent ; le tri par date de modification n'a alors aucun équivalent. | Ouvrir à 390 × 844 et à 900 px de large. | A:1691-1692, 1709-1710 |
| S-50 | Éléments visibles au survol seulement : la corbeille de chaque ligne d'un courriel (introuvable au toucher et au clavier), l'infobulle « Copie liée », les `title` des boutons de variables. | Tester au clavier et en émulation tactile. | EPE:553-559 ; A:1819 ; ME:200 |
| S-51 | Noms accessibles faibles : boutons « FR » / « EN » sans libellé de groupe ni `aria-pressed` ; dernier en-tête de colonne vide ; bouton Active/En pause sans sémantique d'état ; onglets de la liste en `role="tab"` sans panneau associé ni flèches ; `aria-label` « Dossiers » posé sur un `div` sans rôle. | Parcourir au lecteur d'écran ou inspecter l'arbre d'accessibilité. | A:1299-1309, 1411-1429, 1442, 1733 ; ADA:178-188 |
| S-52 | Garde de permission en chargement = écran totalement vide (aucune roue), contrairement à la garde de forfait. | Recharger la page avec un réseau lent. | PG:49 |

---

### 5. Grep de contrôle

Commande passée sur chaque fichier : nombre d'occurrences de `onClick=`, `onChange=`, `onSubmit=`, `onKeyDown=`, `onBlur=`, `onFocus=`, `href=`, `<Link`, `navigate(`, `<select`, `<input`, `<textarea`, `<button`, `<option`, et des écouteurs `addEventListener`.

| Fichier | onClick= | onChange= | onKeyDown= | onBlur= / onFocus= | navigate( | select / input / textarea | button | option (littérales) | Écouteurs | Lignes d'inventaire qui les couvrent |
|---|---|---|---|---|---|---|---|---|---|---|
| Automations.tsx | 42 (dont 2 `stopPropagation` de conteneur de menu) | 10 (dont 1 prop de BandeauPause) | 2 | 1 / 0 | 8 | 4 / 5 / 0 | 40 | 9 | 1 (`click` sur `document`) | LST-002, 003, 006 à 092 : 89 lignes (un même gestionnaire en boucle donne plusieurs lignes : 2 langues, 3 départs, 4 onglets, 6 en-têtes, 18 options) |
| AutomationsApercu.tsx | 3 | 0 | 0 | 0 | 3 | 0 | 3 | 0 | 0 | APR-001 à 003 |
| AutomationsReglages.tsx | 3 | 0 | 0 | 0 | 3 | 0 | 3 | 0 | 0 | REG-001 à 003 |
| BibliothequeModeles.tsx | 13 | 3 | 0 | 0 | 0 | 1 / 2 / 0 | 13 | 3 | 0 | MOD-005 à 029 : 25 lignes |
| MessageEditor.tsx | 6 (dont 2 `stopPropagation`) | 1 | 0 | 0 | 0 | 0 / 0 / 1 | 4 | 0 | 0 | MSG-001 à 012 |
| EmailPreviewEditor.tsx | 13 (dont 1 `stopPropagation`) + 1 `onClick:` d'action de toast | 3 | 0 | 0 / 3 | 0 | 0 / 1 / 1 | 11 | 0 | 1 (`keydown` Échap) | MSG-013 à 037 |
| BandeauPause.tsx | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | LST-004, 005 |
| CopierVersBureauxModal.tsx | 5 (dont 1 `stopPropagation`) | 2 | 0 | 0 | 0 | 0 / 2 / 0 | 3 | 0 | 0 | LST-098 à 103 |
| InterrupteurPublication.tsx | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | LST-073 |
| AdressesDAppel.tsx | 6 | 0 | 0 | 0 | 0 | 0 | 6 | 0 | 0 | REG-004 à 009 |
| ui/ConfirmDialog.tsx (partagé) | 4 (dont 1 `stopPropagation`) | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 1 (`keydown` Échap) | LST-093 à 097 |
| ui/Modal.tsx (partagé) | 3 (dont 1 `stopPropagation`) | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 (`keydown` Échap + Tab) | MOD-001 à 004 |
| PlanFeatureGate.tsx (partagé) | 2 (dont 1 dans un commentaire) | 0 | 0 | 0 | 0 | 0 | 2 (dont 1 dans un commentaire) | 0 | 0 | LST-001 (= APR-004, REG-010) |

Totaux : 103 `onClick=` dans les 13 fichiers (94 dans les 10 fichiers de la part, 9 dans les 3 composants partagés), dont 8 `stopPropagation` de conteneur et 1 exemple en commentaire, soit 94 gestionnaires de clic réels, tous rattachés à au moins une ligne (183 lignes d'inventaire au total, un gestionnaire en boucle donnant plusieurs lignes). `onSubmit=` : 0 partout (aucun `<form>`). `href=` : 0 partout. `<Link` : 1 seule occurrence, dans Automations.tsx, qui est l'icône `Link2` (A:1820) et non un lien de routeur.

Correspondance ligne par ligne vérifiée pour Automations.tsx (40 clics réels) : A:1233→LST-002 ; 1243→003 ; 1303→006/007 ; 1334→012 ; 1341→013 ; 1350→008 ; 1360→014 ; 1371→015 ; 1393→016/017/018 ; 1418→020 à 023 ; 1450→025/026 ; 1492→027 ; 1502→028 ; 1510→033 ; 1525→034 ; 1608→057 ; 1617→058 ; 1629→054 ; 1638→055 ; 1647→056 ; 1658→059 ; 1685→060 ; 1723→062 à 067 ; 1751→068 ; 1790→070 ; 1863→072 ; 1895→075 ; 1910→076 ; 1939→084 ; 1948→085 ; 1960→077 ; 1969→078 ; 1979→079 ; 1989→080 ; 2015→081 ; 2026→082 ; 2038→083 ; 2135→086 ; 2179→087 ; 2189→088. `onChange` : 1324→009 ; 1476→029 ; 1541→035 ; 1555→036 ; 1567→046 ; 1578→050 ; 1699→061 ; 1777→069 ; 2199→089. `onKeyDown` : 1325→010/011 ; 1478→030/031. `onBlur` : 1477→032. `navigate(` : 767→014/016/017 ; 840→078 ; 1268→MOD-029 ; les 5 autres sont dans les clics ci-dessus.

---

# Partie 2 — Éditeur plein écran et catalogue

Périmètre : `/automations/:id` et `/automations/nouvelle` (route `src/App.tsx:1668`).
Copie lue : `D:/lume-uiaudit/wt`, commit `c402ad57`. Tout vient du code, rien n'a été lancé.
Cette copie n'a PAS le correctif #840 (vérifié : `Variable inconnue` = 0 occurrence dans `PanneauEtape.tsx`). Les deux éléments qu'il ajoute sont listés comme « attendus » (EDT-132, EDT-133).

Abréviations des sources :

| Abrév. | Fichier |
|---|---|
| Page | `src/pages/AutomationBuilderPage.tsx` |
| Canvas | `src/components/automations/SequenceCanvas.tsx` |
| PDecl | `src/components/automations/PanneauDeclencheur.tsx` |
| PEtape | `src/components/automations/PanneauEtape.tsx` |
| Champ | `src/components/automations/ChampAction.tsx` |
| Tiroir | `src/components/automations/TiroirChoix.tsx` |
| Lumi | `src/components/automations/ClavardageLumi.tsx` |
| Regl | `src/components/automations/OngletReglages.tsx` |
| Journ | `src/components/automations/OngletJournaux.tsx` |
| Interr | `src/components/automations/InterrupteurPublication.tsx` |
| ChAuto | `src/components/champs/automatisations.tsx` |
| EdCond | `src/components/champs/EditeurConditions.tsx` |
| Cat | `src/lib/automationCatalogue.ts` |
| Seq | `src/lib/sequenceTypes.ts` |
| Api | `src/lib/automationBuilderApi.ts` |
| JApi | `src/lib/automationJournauxApi.ts` |
| Pub | `src/lib/publicationAutomatisation.ts` |
| Confirm | `src/components/ui/ConfirmDialog.tsx` |
| Srv | `server/routes/automation-rules.ts` (lu pour les statuts et messages seulement) |

Libellés : recopiés du code, à un détail près — le code écrit les apostrophes en typographique (’), ce document en droit ('). Une recherche de texte dans la page doit en tenir compte.

Libellés : presque tous en ligne (`fr ? '…' : '…'`). Seules clés i18n utilisées : `lumiCredits.deducted` / `lumiCredits.unit` (`fr.ts:3940,3952`, `en.ts:3948,3960`) et `modals.cancelBtn` / `confirmBtn` / `confirmTitle` du dialogue de confirmation (`fr.ts:1601-1617`, `en.ts:1609-1625`).

---

### 1. Écrans et états

| # | État | Condition qui le déclenche | Ce qu'on voit | Source |
|---|---|---|---|---|
| E01 | Garde d'accès (avant l'éditeur) | Route enveloppée par `Gated permission="automations.update"` puis `PlanFeatureGate flag="includes_automations"` | Sans la permission : page « Accès restreint » / « Access Restricted » (dans la mise en page normale, pas en plein écran). Forfait sans automatisations : modale de mise à niveau. Vérification du forfait : rond de chargement | `src/App.tsx:1668`, `src/components/PermissionGate.tsx:26-44`, `src/components/PlanFeatureGate.tsx:41-48` |
| E02 | Chargement | `chargement === true` (vrai au montage ; remis à vrai seulement par « Réessayer ») | Plein écran, rond qui tourne, AUCUN texte, aucun `role="status"` | Page:204, 1506-1512 |
| E03 | Reprises de chargement | Échec de `chargerEditeur` : 2 nouveaux essais (attente 1,5 s puis 3 s) avant d'abandonner | Toujours l'état E02 pendant ~4,5 s + durée des appels | Page:689-697 |
| E04 | Échec de chargement | `!regle && echecChargement` | « Impossible de charger cette automatisation pour le moment. » / « Could not load this automation right now. » + 2 boutons | Page:1514-1538 |
| E05 | Introuvable | `!regle` sans échec. Le serveur renvoie `rule: null` si l'identifiant n'est pas un UUID, si la règle est d'un autre bureau (`eq('org_id')`), ou si elle est purgée (`purged_at`) | « Cette automatisation est introuvable. » / « This automation was not found. » + 1 bouton | Page:1540-1555 ; Srv:168-198 |
| E06 | À la corbeille (supprimée, non purgée) | AUCUN état dédié : la requête de l'éditeur filtre `purged_at` mais pas `deleted_at` | La règle s'ouvre comme une règle normale, sans bandeau. Publier est refusé par le serveur (« Cette automatisation est à la corbeille : restaurez-la avant de la publier. ») | Srv:178 ; `server/lib/automations-publication.ts:68-73` |
| E07 | Nouvelle automatisation (brouillon local) | `id === 'nouvelle'` : rien en base, règle fabriquée à l'écran (nom « Nouvelle automatisation » / « New automation », déclencheur `quote.sent`, action provisoire « À compléter ») | Canevas vide (E13), interrupteur rouge, « Enregistré » | Page:129, 703-711 |
| E08 | Nouvelle + `?lumi=1` | `parametres.get('lumi') === '1'` après chargement | Le curseur va dans le champ de Lumi, panneau Lumi déplié | Page:759-765 |
| E09 | Naissance en base | Première écriture (`ecrire`) : POST puis `navigate('/automations/<id>', { replace: true })` sans rechargement | L'adresse change, l'écran reste | Page:143-176, 673 |
| E10 | Brouillon | `regle.is_active === false` | Interrupteur rouge + « Brouillon » / « Draft » | Interr:42, 54-58 |
| E11 | Publiée | `regle.is_active === true` | Interrupteur vert + « Publiée » / « Published » | Interr:42, 54-58 |
| E12 | Bascule en cours | `fileBascule.enCours(regle.id)` | Rond qui tourne dans le bouton de l'interrupteur (jamais désactivé) | Page:1707 ; Interr:37, 51 |
| E13 | Canevas vide | `etapesAffichees.length === 0` | « ou », bouton « Choisir le déclencheur », éventuel bouton de réglage, « Ajouter une première étape », pastille « FIN » / « END » | Page:1929-1989 |
| E14 | Parcours au nouveau format (`steps`) | `steps.length > 0` | `SequenceCanvas` modifiable | Page:1991-2016 |
| E15 | Parcours au format d'origine (`actions`) | `estFormatOrigine` : `steps` vide ET `actions` non vide ET pas l'action provisoire | Bandeau jaune « Parcours au format d'origine » / « Journey in the original format », cartes projetées en LECTURE SEULE (pas de « + », pas de « ··· », pas de bouton « Ajouter ») ; la carte « Quand » reste cliquable | Page:1193-1202, 1886-1927, 1996, 2177 ; Seq:284-293, 308-353 |
| E16 | Format d'origine convertible | `conversion.possible` (aucune action `send_notification` / `update_status`) | Bouton « Convertir en parcours modifiable » | Page:1907-1917 ; Seq:383-400 |
| E17 | Format d'origine non convertible | `!conversion.possible` | Texte « Ce parcours contient une étape technique qui ne se convertit pas : il reste en lecture seule pour ne rien perdre. » | Page:1918-1923 |
| E18 | Conversion en cours | `conversionEnCours` | Bouton désactivé « Conversion… » / « Converting… » | Page:1911-1916 |
| E19 | Tiroir « Déclencheurs » ouvert | `onglet === 'parcours' && tiroirDeclencheur` | Panneau droit 380 px | Page:2270-2280 |
| E20 | Panneau de réglage du déclencheur ouvert | `onglet === 'parcours' && !tiroirDeclencheur && reglageDeclencheur && declencheurCourant && declencheurReglable` | Panneau droit 380 px | Page:2284-2299 |
| E21 | Tiroir « Actions » ouvert | `onglet === 'parcours' && !tiroirDeclencheur && !reglageDeclencheur && ajoutEnCours` | Panneau droit 380 px | Page:2301-2314 |
| E22 | Panneau d'étape ouvert | `onglet === 'parcours' && !tiroirDeclencheur && !ajoutEnCours && etapeOuverte` (NE teste PAS `reglageDeclencheur` : voir soupçon S-07) | Panneau droit 380 px | Page:2317-2333 |
| E22a | … étape « action » | `brouillon.type === 'action'` et pas `log_activity` | Nom, « Quoi faire », champs de l'action, boutons de variables | PEtape:439-572 |
| E22b | … étape technique `log_activity` | `journal` | Texte « Étape technique : Lume inscrit ce moment dans l'historique du client… », aucun champ | PEtape:255, 432-438 |
| E22c | … action « Mettre à jour un champ personnalisé » | `modele.cle === 'update_custom_field'` | `EditeurMajChamp` à la place des champs génériques | PEtape:499-508 |
| E22d | … étape « attendre » | `brouillon.type === 'attendre'` ; 3 modes (`duree`, `reponse`, `avant_date`) | Nombre + unité + « Ce qu'on attend » | PEtape:575-664 |
| E22e | … étape « si » | `brouillon.type === 'si'` | Exemples, zone de texte « Conditions », conditions de champs | PEtape:667-734 |
| E22f | … étape « arrêter » | `brouillon.type === 'arreter'` | « Rien à configurer. Le client sort du parcours en arrivant ici. » | PEtape:736-742 |
| E22g | … onglet Statistiques, avec chiffres | `stats` et somme > 0 | « 60 derniers jours. » + Réussis / Sautés / Échoués / En attente | PEtape:402-420 |
| E22h | … onglet Statistiques, vide | sinon | « Aucun passage encore. Les chiffres apparaîtront après le premier déclenchement. » | PEtape:421-427 |
| E22i | … étape avec problèmes | `problemes.length > 0` | Encadré ambre + premier problème en rouge dans le pied + « Enregistrer » désactivé | PEtape:745-753, 780-784, 798 |
| E23 | Menu « ··· » ouvert | `menuEtape` non nul | Voile plein écran + menu 260 px, position FIXE (`left-1/2 top-24`), pas ancré à la carte | Page:2024-2068 |
| E24 | Aperçu en préparation | `apercuEnCours` | Bouton « Aperçu » désactivé (aucun style « désactivé ») | Page:1694-1695 |
| E25 | Aperçu affiché | `apercu` non nul | Voile + carte « Ce qui partirait » / « What would go out » ; « Aperçu seulement — rien n'est envoyé. » ; exemple avec un vrai client, ou `apercu.message` ; « Aucune étape à montrer. » si vide | Page:2077-2152 |
| E26 | Enregistré | `etatSauvegarde === 'a_jour'` | Coche + « Enregistré » / « Saved » | Page:1636 |
| E27 | Modifié (en attente d'enregistrement) | `'modifie'` : posé par toute modification du parcours, annuler/rétablir, renommage | Nuage + « Modifié » / « Edited » | Page:780, 787, 794, 1583, 1634 |
| E28 | Enregistrement en cours | `'en_cours'` | Rond + « Enregistrement… » / « Saving… » | Page:1007, 1632 |
| E29 | Enregistrement suspendu (étape incomplète) | `'incomplet'` : au moins une action a un champ obligatoire visible vide, ou un type d'action hors catalogue | Nuage ambre + « N étape(s) à compléter » / « N step(s) to complete » ; AUCUN enregistrement automatique tant que ça dure | Page:942-960, 984, 1624-1630 |
| E30 | Erreur d'enregistrement | Échec de l'appel d'enregistrement automatique | Toast d'erreur (id `enregistrement-auto`), retour à « Modifié », nouvel essai à 3, 6, 12, 24 puis 48 s | Page:981-1053 |
| E31 | Travail non enregistré | `etatSauvegarde` ∈ modifie, incomplet, en_cours | Garde `beforeunload` du navigateur | Page:1270-1286 |
| E32 | Problèmes bloquants en direct | `bloquantsVivants.length > 0` | Bandeau rouge (4 problèmes au plus) + bordure rouge des cartes fautives | Page:917-940, 1790-1824 ; Canvas:208-212 |
| E33 | Publiée mais cassée | E32 et `regle.is_active` | Titre « Publiée mais cassée : N chose(s) à corriger — rien ne part correctement » | Page:1797-1800 |
| E34 | Lumi indisponible (forfait) | `!lumiDisponible` (`includes_ai` absent et chargement du forfait terminé) | Carte « Construire avec Lumi — inclus dans Autopilot » + « Voir Autopilot » | Page:117-118, 1828-1849 |
| E35 | Lumi en carte (avant le premier message) | `lumiDisponible && !lumiLateral` | Carte « Décris ton automatisation à Lumi » + 4 pastilles ; reste affichée même quand un parcours existe et même au format d'origine | Page:1850-1879 ; Lumi:174-184 |
| E36 | Lumi en panneau gauche | `lumiLateral && !lumiReduit` (au moins un échange, ou génération en cours) | Panneau gauche « Lumi — ce parcours » (340 px dès `md`, pleine largeur en dessous) | Page:768, 1721-1734 ; Lumi:146-172 |
| E37 | Lumi replié | `lumiLateral && lumiReduit` | Bouton flottant « Lumi » en haut à gauche du canevas | Page:1736-1745 |
| E38 | Génération Lumi en cours | `genere` | Bulle de la demande + « Lumi construit… » / « Lumi is building… », bouton désactivé avec rond | Lumi:79-93, 132-140 |
| E39 | Génération Lumi échouée | exception dans `construireAvecLumi` | Toast d'erreur (texte du serveur). Si le serveur a retiré le brouillon vide (`brouillon_retire`) : retour à `/automations/nouvelle?lumi=1` | Page:640-655 ; Api:380-386 |
| E40 | Résumé de Lumi | `resumeLumi` non nul | Bandeau flottant en haut au centre, avec bouton de fermeture | Page:2154-2167 |
| E41 | Onglet Parcours | `onglet === 'parcours'` | Canevas | Page:1746 |
| E42 | Onglet Réglages | `onglet === 'reglages' && regle.id` | `OngletReglages` | Page:2255-2264 |
| E43 | Onglet Historique | `onglet === 'historique' && regle.id` | `OngletHistorique` : chargement, erreur (« L'historique n'a pas pu être lu. »), vide (« Aucune inscription. »), tableau | Page:2252 ; Journ:296-409 |
| E44 | Onglet Journaux | `onglet === 'journaux' && regle.id` | `OngletJournaux` : chargement, erreur (« Les journaux n'ont pas pu être lus. »), vide (« Aucun journal. »), tableau ; ligne dépliée | Page:2253 ; Journ:135-292 |
| E45 | Onglet secondaire sur une automatisation jamais enregistrée | `onglet !== 'parcours' && !regle.id` | « Cette automatisation n'est pas encore enregistrée : ajoutez une première étape. » | Page:2243-2251 |
| E46 | Boucle dans le graphe | une étape déjà vue dans la chaîne | Encadré ambre « Le parcours revient ici : à corriger avant d'enregistrer. » | Canvas:285-291 |
| E47 | Pause globale (« Tout arrêter ») | INTROUVABLE dans l'éditeur : `BandeauPause` n'est monté que dans `src/pages/Automations.tsx` | Rien : une automatisation publiée affiche « Publiée » en vert même si l'entreprise a tout mis en pause | recherche `BandeauPause` dans `src/` |
| E48 | Lecture seule faute de permission | INTROUVABLE : la route exige `automations.update` ; il n'existe pas de variante « consultation ». La seule lecture seule est celle du format d'origine (E15) | « Accès restreint » (E01) | `src/App.tsx:1668` |
| E49 | Dialogue de confirmation | `confirmer(...)` | Fenêtre modale (7 variantes, § 2.14) | Confirm:86-152 |

Priorité d'affichage à droite : tiroir Déclencheurs > panneau de réglage du déclencheur > tiroir Actions ; le panneau d'étape s'affiche dès que ni le tiroir Déclencheurs ni le tiroir Actions ne sont ouverts (Page:2270-2333).

---

### 2. Éléments interactifs

Colonnes : ID · État(s) · Type · Libellé FR · Libellé EN · Ce qu'il fait · Visible / actif seulement si · Source.

#### 2.1 Écrans de chargement et d'erreur

| ID | État(s) où il apparaît | Type | Libellé FR | Libellé EN | Ce qu'il fait d'après le code | Visible / actif seulement si | Source |
|---|---|---|---|---|---|---|---|
| EDT-001 | E04 | bouton | Réessayer | Try again | Efface l'échec, repasse en chargement, relance `chargerEditeur` (GET `/api/automations/editeur[?rule_id=]`), `chargerMembres`, `chargerEtiquettes` | `!regle && echecChargement` | Page:1521-1527 |
| EDT-002 | E04 | bouton | Mes automatisations | My automations | `quitterEditeur()` → `navigate('/automations')` | idem | Page:1528-1534 |
| EDT-003 | E05 | bouton | Mes automatisations | My automations | `quitterEditeur()` → `navigate('/automations')` | `!regle` sans échec | Page:1546-1552 |

#### 2.2 Barre du haut

| ID | État(s) où il apparaît | Type | Libellé FR | Libellé EN | Ce qu'il fait d'après le code | Visible / actif seulement si | Source |
|---|---|---|---|---|---|---|---|
| EDT-004 | tous (éditeur chargé) | bouton (flèche + texte) | Mes automatisations | My automations | `quitterEditeur()` : si « modifié » ou « en cours » et aucune étape incomplète → enregistre d'abord (`ecrire({ name, steps })` = PATCH `/api/automations/rules/:id` ou POST `/api/automations/rules`), puis `navigate('/automations')`. Si « incomplet » ou enregistrement en échec → dialogue « Quitter sans enregistrer ? » (EDT-163) | Texte masqué sous 640 px (`hidden sm:inline`) : il ne reste que la flèche, sans `aria-label` | Page:1568-1575, 1324-1366 |
| EDT-005 | tous | bouton (nom + crayon) | (nom de l'automatisation) | (idem) | `setEditeNom(true)` : remplace le bouton par un champ | `!editeNom` | Page:1591-1598 |
| EDT-006 | édition du nom | champ texte | aria-label « Nom de l'automatisation » | « Automation name » | `setNom` + passe l'état à « Modifié » → enregistrement automatique 3 s plus tard avec `{ name, steps }`. `maxLength=120`, `autoFocus` | `editeNom` | Page:1580-1589 |
| EDT-007 | édition du nom | raccourci clavier | Entrée | Enter | Ferme le champ (la valeur est gardée) | idem | Page:1585 |
| EDT-008 | édition du nom | raccourci clavier | Échap | Escape | Ferme le champ — la valeur tapée est GARDÉE (pas d'annulation) | idem | Page:1585 |
| EDT-009 | édition du nom | perte de focus | — | — | Ferme le champ | idem | Page:1584 |
| EDT-010 | tous | bouton icône | aria-label « Annuler » | « Undo » | Recule d'un cran dans la pile des versions du PARCOURS (les étapes seulement), passe à « Modifié » | désactivé si `position <= 0` | Page:1603-1611, 783-788 |
| EDT-011 | tous | bouton icône | aria-label « Refaire » | « Redo » | Avance d'un cran dans la pile, passe à « Modifié » | désactivé si `position >= historique.length - 1` | Page:1612-1620, 790-795 |
| EDT-012 | tous | indicateur (non cliquable) | « Enregistré » / « Modifié » / « Enregistrement… » / « N étape(s) à compléter » | « Saved » / « Edited » / « Saving… » / « N step(s) to complete » | Affiche `etatSauvegarde` (E26-E29) | — | Page:1623-1638 |

Raccourcis clavier globaux (Ctrl+Z, Ctrl+Y, Ctrl+S, Échap pour fermer un panneau) : INTROUVABLES. Le seul écouteur global de la page est `beforeunload` (Page:1284).

#### 2.3 Onglets et barre d'actions

| ID | État(s) où il apparaît | Type | Libellé FR | Libellé EN | Ce qu'il fait d'après le code | Visible / actif seulement si | Source |
|---|---|---|---|---|---|---|---|
| EDT-013 | tous | onglet | Parcours | Builder | `setOnglet('parcours')` | — | Page:1557-1562, 1648-1659 |
| EDT-014 | tous | onglet | Réglages | Settings | `setOnglet('reglages')` ; démonte le canevas et tout panneau de droite | — | idem |
| EDT-015 | tous | onglet | Historique | Enrollment history | `setOnglet('historique')` → `lireInscriptions` | — | idem |
| EDT-016 | tous | onglet | Journaux | Execution logs | `setOnglet('journaux')` → `lireJournaux` | — | idem |
| EDT-017 | tous | bouton | Aperçu | Preview | Sans identifiant réel : toast info « Ajoutez une première étape : il n'y a encore rien à prévisualiser. ». État « incomplet » : toast info « Complétez les étapes en cours pour voir l'aperçu à jour. ». Sinon enregistre ce qui attend (`ecrire`), puis `apercuAutomatisation(id)` = POST `/api/automations/rules/:id/apercu` et ouvre E25. Erreur : toast (message du serveur) | désactivé pendant l'appel (`apercuEnCours`) | Page:1663-1701 |
| EDT-018 | tous | interrupteur (`role="switch"`) | aria-label « Publier l'automatisation » | « Publish the automation » | `basculerPublication()` (§ 5). Vers « publiée » : contrôle local, dialogue « Publier cette automatisation ? », enregistrement préalable, puis `changerPublication(id, true)` = POST `/api/automations/rules/:id/publication`. Vers « brouillon » : même appel avec `false`, SANS confirmation. Toasts : « Automatisation publiée » / « Repassée en brouillon » ; erreur = message du serveur | jamais désactivé ; `aria-busy` pendant l'appel | Page:1704-1711, 1061-1162 ; Interr:28-53 |
| EDT-019 | tous | étiquette (non cliquable) | Brouillon / Publiée | Draft / Published | Reflète `regle.is_active` | `avecEtiquette` | Interr:54-58 |

#### 2.4 Canevas (onglet Parcours)

| ID | État(s) où il apparaît | Type | Libellé FR | Libellé EN | Ce qu'il fait d'après le code | Visible / actif seulement si | Source |
|---|---|---|---|---|---|---|---|
| EDT-020 | E37 | bouton | Lumi | Lumi | Redéplie le panneau de Lumi et met le curseur dans son champ | `lumiLateral && lumiReduit` | Page:1737-1744 |
| EDT-021 | canevas | glisser-déposer (souris) | — | — | Déplace le canevas (`mousedown` / `mousemove` / `mouseup` / `mouseleave`) ; aucun gestionnaire tactile ni clavier | seulement si l'outil main est actif (EDT-048) | Page:1750-1755, 1165-1174 |
| EDT-022 | E32 | lien (bouton souligné), un par problème, 4 au plus | (texte du problème, § 5) | (idem) | `ouvrirEtape(p.etapeId)` : ouvre le panneau de l'étape fautive (avec confirmation si un autre brouillon d'étape est en cours) | seulement les problèmes qui portent un `etapeId` ; les autres sont du texte | Page:1806-1820 |
| EDT-023 | E34 | bouton | Voir Autopilot | See Autopilot | `navigate('/settings/billing')` directement (sans passer par `quitterEditeur`) | `!lumiDisponible` | Page:1840-1846 |
| EDT-024 | E35 | pastille | Relance de devis | Quote follow-up | Remplit le champ de Lumi avec « Après l'envoi d'un devis, attends 3 jours puis envoie un texto de suivi si le client n'a pas répondu. » (n'envoie pas) | `lumiDisponible && !lumiLateral` | Page:365-378, 1865-1874 |
| EDT-025 | E35 | pastille | Rappel de rendez-vous | Appointment reminder | Remplit avec « La veille d'un rendez-vous, envoie un texto de rappel au client avec l'heure. » | idem | idem |
| EDT-026 | E35 | pastille | Facture en retard | Overdue invoice | Remplit avec « Quand une facture dépasse son échéance, envoie un courriel poli, puis relance 7 jours plus tard. » | idem | idem |
| EDT-027 | E35 | pastille | Demande d'avis | Review request | Remplit avec « Deux jours après un job terminé, demande un avis au client par texto. » | idem | idem |
| EDT-028 | E16, E18 | bouton | Convertir en parcours modifiable (« Conversion… » pendant l'appel) | Convert to an editable journey (« Converting… ») | `convertirParcours()` : si publiée, dialogue « Convertir ce parcours ? » ; puis `modifierAutomatisation(id, { steps })` = PATCH ; toast « Parcours converti — il est modifiable » ; erreur = message du serveur | `formatOrigine && conversion.possible` ; désactivé pendant l'appel | Page:1908-1917, 1229-1259 |
| EDT-029 | E13 | bouton | Choisir le déclencheur + (libellé du déclencheur courant) | Pick the trigger | Ouvre le tiroir Déclencheurs (`setTiroirDeclencheur(true)`) | canevas vide | Page:1938-1948 |
| EDT-030 | E13 | bouton | (résumé des réglages) ou « Régler le déclencheur » | « Configure the trigger » | Ouvre le panneau de réglage du déclencheur | `declencheurReglable` | Page:1959-1967 |
| EDT-031 | E13 | bouton | Ajouter une première étape | Add a first step | `ouvrirAjout(null)` : ouvre le tiroir Actions pour insérer en tête | canevas vide | Page:1974-1981 |
| EDT-032 | E14, E15 | carte cliquable | Quand + libellé du déclencheur + résumé des réglages | When | Si le déclencheur a des réglages : ouvre le panneau de réglage ; sinon ouvre le tiroir Déclencheurs. Reste cliquable au format d'origine | toujours (`onDeclencheur` fourni) | Canvas:343-365 ; Page:2009-2012 |
| EDT-033 | E14 | bouton icône « + » (en tête) | aria-label « Ajouter une étape ici » | « Add a step here » | `ouvrirAjout(null)` → tiroir Actions, insertion en tête | pas en lecture seule | Canvas:165-172, 386, 391 |
| EDT-034 | E14 | bouton icône « + » (après une étape) | idem | idem | `ouvrirAjout(etape.id)` → insertion après cette étape (la nouvelle hérite de la suite) | pas en lecture seule ; absent après « Arrêter ici » | Canvas:320 |
| EDT-035 | E14 | bouton icône « + » (branche « si oui ») | idem ; pastille « si oui » | « if yes » | `ouvrirAjout(etape.id, 'alors')` | sous une étape « si » | Canvas:302 |
| EDT-036 | E14 | bouton icône « + » (branche « si non ») | idem ; pastille « si non » | « if no » | `ouvrirAjout(etape.id, 'sinon')` | sous une étape « si » | Canvas:306 |
| EDT-037 | E14 | carte cliquable (action) | nom donné, sinon libellé de l'action ; « Note dans l'historique » pour `log_activity` ; « Étape technique » si hors catalogue ; détail = 60 premiers caractères de `body` ou `title` | idem EN ; « History note » ; « Technical step » | `ouvrirEtape(id)` : ouvre le panneau d'étape ; si un autre brouillon d'étape est modifié → dialogue « Changer d'étape sans enregistrer ? » | — | Canvas:97-148, 224-249 ; Page:257-270, 1999 |
| EDT-038 | E14 | carte cliquable (attendre) | Attendre + « N jour(s) » / « N heure(s) » / « N minute(s) » / « tout de suite » / « N jour(s) avant le rendez-vous » | Wait + « right away » / « … before the appointment » | idem | — | Canvas:112-136 |
| EDT-039 | E14 | carte cliquable (si) | Si… + « N condition(s) » | If… | idem | — | Canvas:114-115, 143-146 |
| EDT-040 | E14 | carte cliquable (arrêter) | Arrêter ici | Stop here | idem | — | Canvas:116-117 |
| EDT-041 | E15 | carte cliquable (format d'origine) | (comme EDT-037/038) | (idem) | `convertirParcours(idEtape)` : convertit (confirmation seulement si publiée) puis ouvre l'étape. Non convertible : toast info « Ce parcours contient une étape d'un ancien format qui ne se convertit pas : il reste en lecture seule. » | `formatOrigine` | Page:1999, 1231-1236 |
| EDT-042 | E14 | bouton icône « ··· » | aria-label « Options de l'étape <titre> » | « Options for <title> » | `setMenuEtape(id)` : ouvre le menu (E23) | pas en lecture seule | Canvas:252-261 |
| EDT-043 | E13, E14 | bouton | Ajouter | Add | Calcule la vraie fin du chemin principal (`finDuParcours`) puis `ouvrirAjout(...)` | masqué au format d'origine | Page:2177-2191 ; Seq:233-250 |
| EDT-044 | E23 | voile (bouton plein écran) | aria-label « Fermer le menu » | « Close menu » | `setMenuEtape(null)` | `menuEtape` | Page:2026-2031 |
| EDT-045 | E23 | item de menu | Dupliquer l'action | Duplicate action | `dupliquerEtape(id)` : insère une copie juste après, nom suffixé « (copie) » / « (copy) », l'ouvre. À 30 étapes : toast « Un parcours compte au plus 30 étapes. Retirez-en une avant de dupliquer. » | seulement si l'étape est une action | Page:2036-2043, 818-841 |
| EDT-046 | E23 | item de menu | Modifier l'action / Modifier l'étape | Edit action / Edit step | Ferme le menu, `ouvrirEtape(id)` | — | Page:2040, 2052 |
| EDT-047 | E23 | item de menu (rouge) | Supprimer l'action / Supprimer l'étape | Delete action / Delete step | Ferme le menu, dialogue « Supprimer cette étape ? » (EDT-159) puis `retirerEtape` | — | Page:2041, 2053, 882-894 |
| EDT-048 | canevas | bouton bascule (`aria-pressed`) | aria-label « Déplacer le canevas » | « Pan the canvas » | Active / désactive l'outil main (curseur « grab ») | onglet Parcours | Page:2195-2206 |
| EDT-049 | canevas | bouton icône | aria-label « Agrandir » | « Zoom in » | `zoomer(+0,1)`, borné à 160 % | idem | Page:2207-2214, 1176-1178 |
| EDT-050 | canevas | indicateur (non cliquable) | « 100% » | « 100% » | Affiche `Math.round(zoom * 100)` | idem | Page:2215-2217 |
| EDT-051 | canevas | bouton icône | aria-label « Réduire » | « Zoom out » | `zoomer(-0,1)`, borné à 40 % | idem | Page:2218-2225 |
| EDT-052 | canevas | bouton icône | aria-label « Recadrer » | « Fit to screen » | Zoom à 100 % et décalage à zéro (ne recadre pas sur le contenu) | idem | Page:2226-2233, 1179 |
| EDT-053 | E40 | bouton icône | aria-label « Fermer » | « Close » | `setResumeLumi(null)` | `resumeLumi` | Page:2158-2165 |
| EDT-054 | E23 | item de menu (rouge) | Supprimer à partir d'ici | Delete from here | Dialogue « Supprimer N étape(s) ? » (EDT-158) puis retire l'étape et toute sa descendance (`suivant`, `alors`, `sinon`) | — | Page:2042, 2054, 850-880 |
| EDT-055 | E25 | bouton icône | aria-label « Fermer l'aperçu » | « Close preview » | `setApercu(null)` (seul moyen de fermer : ni Échap ni clic hors de la carte) | `apercu` | Page:2100-2107 |

Non interactifs du canevas : « ou » / « or » (Page:1932), pastilles « FIN » / « END » (Page:1986-1988) et « fin » / « end » (Canvas:403-408), « Aucune étape. Cliquez sur « + » pour commencer. » (Canvas:392-394). Zoom à la molette, pincement, mini-carte : INTROUVABLES (la mini-carte du schéma d'en-tête de fichier n'existe pas).

#### 2.5 Tiroir de choix (Déclencheurs / Actions)

| ID | État(s) où il apparaît | Type | Libellé FR | Libellé EN | Ce qu'il fait d'après le code | Visible / actif seulement si | Source |
|---|---|---|---|---|---|---|---|
| EDT-056 | E19, E21 | bouton icône | aria-label « Fermer » | « Close » | `onFermer` : ferme le tiroir (`setTiroirDeclencheur(false)` ou `setAjoutEnCours(null)`) | — | Tiroir:90-97 |
| EDT-057 | E19, E21 | champ de recherche | aria-label « Rechercher dans Déclencheurs » / « … dans Actions » ; indication « Rechercher… » | « Search Triggers » / « Search Actions » ; « Search… » | Filtre sur titre + aide, sans accents ni casse. Aucun résultat : « Rien ne correspond à cette recherche. » / « Nothing matches that search. ». Pas de focus automatique, Entrée ne choisit rien | — | Tiroir:107-114, 67-75, 120-123 |
| EDT-058 | E19 | item de liste (un par déclencheur offert, 28 au plus — DEC-01 à DEC-28, § 3a) | titre + aide du déclencheur ; titres de famille : Devis, Factures, Rendez-vous, Jobs, Clients et prospects, Pipeline de ventes | Quotes, Invoices, Appointments, Jobs, Clients and leads, Sales pipeline | `choisirDeclencheur(cle)` : ferme le tiroir ; si la clé change, `ecrire({ trigger_event[, conditions] })` (PATCH ou POST) ; erreur = toast (message du serveur) | les 3 déclencheurs sous drapeau n'apparaissent que si le drapeau est actif | Tiroir:135-170 ; Page:470-499 |
| EDT-059 | E21 | item de liste (un par action, 21 — ACT-01 à ACT-21, § 3c) | titre + aide de l'action ; familles : Communication, Client, Travail, Ventes, Argent, Technique | Communication, Client, Work, Sales, Money, Technical | `confirmerAjout(cle)` : crée l'étape avec `configParDefaut`, l'insère, ouvre son panneau. À 30 étapes : toast « Un parcours compte au plus 30 étapes. Retirez-en une avant d'ajouter. » | désactivé si incompatible ou indisponible (EDT-063) | Page:393-414, 423-450 |
| EDT-060 | E21 | item de liste (famille « Parcours » / « Journey ») | Attendre — « Met le parcours en pause avant la suite. » | Wait — « Pauses before the next step. » | Insère une étape `attendre` de 86 400 s (1 jour) et ouvre son panneau | — | Page:438-441 ; Seq:106-107 |
| EDT-061 | E21 | item de liste | Condition — « Sépare le parcours en deux chemins. » | Condition — « Splits the journey in two. » | Insère une étape `si` vide ; la suite existante passe sous « si oui » | — | Page:442-444 ; Seq:146-154 |
| EDT-062 | E21 | item de liste | Arrêter ici — « Le client sort du parcours. » | Stop here — « The client leaves the journey. » | Insère une étape `arreter` ; la suite existante n'est PAS rattachée (elle reste dans `steps`, hors du canevas) | — | Page:445-447 ; Seq:147 |
| EDT-063 | E19, E21 | item désactivé (`disabled`, `title` = la raison) | « Ne va pas avec ce déclencheur » ; « Bientôt : la connexion à votre Slack n'existe pas encore. » ; « Bientôt disponible » | « Does not work with this trigger » ; « Coming soon: connecting your Slack is not available yet. » ; « Coming soon » | Rien (non cliquable, non atteignable au clavier) ; la raison remplace l'aide sous le titre | action incompatible (`actionCompatible` faux), action `indisponible`, déclencheur `bientot` (aucun dans le catalogue actuel) | Tiroir:137-146, 158-162 ; Page:430-436, 476-478 |

#### 2.6 Panneau de réglage du déclencheur

| ID | État(s) où il apparaît | Type | Libellé FR | Libellé EN | Ce qu'il fait d'après le code | Visible / actif seulement si | Source |
|---|---|---|---|---|---|---|---|
| EDT-064 | E20 | bouton icône | aria-label « Fermer » | « Close » | Ferme le panneau SANS confirmation, même si des réglages ont été saisis | — | PDecl:206-213 |
| EDT-065 | E20 | bouton | Changer de déclencheur… | Change trigger… | Ferme le panneau et ouvre le tiroir Déclencheurs | `onChanger` fourni (toujours) | PDecl:217-225 ; Page:2295 |
| EDT-066 | E20 (« Champ personnalisé modifié ») | select | Quel champ (facultatif) ; option vide « — Choisir un champ — » ; groupes par objet (Client, Pipeline, Job, Devis, Facture) ; aide « Vide = n'importe quel champ, sur n'importe quelle fiche. » | Which field (optional) ; « — Choose a field — » ; « Empty = any field, on any record. » | `setChampId` et vide « devient » | `declencheur.cle === 'custom_field.changed'` | PDecl:227-245 ; ChAuto:305-324 |
| EDT-067 | idem, champ choisi et comparable | saisie adaptée au type du champ (voir EDT-107 pour les variantes) | Quand il devient (facultatif) / Quand il contient (liste multiple) ; option vide « — N'importe quelle valeur — » ; aide « Fiche : <objet>. Vide = à chaque changement. » | When it becomes / When it contains ; « — Any value — » ; « Record: <object>. Empty = on every change. » | `setDevient` | champ trouvé et `champComparable` (exclut paragraphe, téléphone, fichier, date avec heure). Champ supprimé : « Ce champ n'existe plus : choisissez-en un autre. » | PDecl:246-279 ; ChAuto:111-114, 159-235 |
| EDT-068 | E20 | champs du déclencheur (un contrôle par champ du catalogue ; rendu générique § 2.7 ; liste par déclencheur § 3a) | (libellés du catalogue) | (idem) | `setBrouillon` local ; rien n'est enregistré avant « Enregistrer » | `champVisible` ; drapeau éventuel du champ | PDecl:283-297 |
| EDT-069 | E20 (« Client inactif ») | indicateur (`role="status"`) | « N client(s) correspond(ent) aujourd'hui. » | « N client(s) match(es) today. » | Résultat de `apercuClientsInactifs(mois)` (GET `/api/automations/clients-inactifs/apercu?mois=`), 300 ms après la dernière frappe ; en erreur : rien | `client.inactive` et réponse reçue | PDecl:128-140, 299-305 |
| EDT-070 | E20 | section « Filtres » (éditeur de conditions de champs, § 2.8) | Filtres — « Seulement si les champs de la fiche (<objet>) remplissent ces conditions au moment de l'événement. » ; « … et si les champs personnalisés sont : » | Filters — « Only if the record's fields (<object>) meet these conditions when the event happens. » ; « … and if the custom fields are: » | `setFiltres` ; enregistré sous `conditions.champs_perso` | l'objet de la règle est connu ET l'entreprise a au moins un champ personnalisé sur cet objet | PDecl:313-331 ; ChAuto:359-379 |
| EDT-071 | E20 | case à cocher | (texte de `CASE_SORTIE`, § 3a) + « Vérifié avant chaque étape qui suit un délai. Le motif de l'arrêt apparaît dans l'historique. » | (idem EN) + « Checked before every step that follows a delay. The reason appears in the history. » | `setArreterSiResolu` ; enregistré dans `settings.arreter_si_resolu` | drapeau `auto_sortie_parcours` actif ET déclencheur parmi `quote.sent`, `invoice.sent`, `invoice.overdue`, `appointment.created`, `deal.stage_entered` | PDecl:93-98, 333-353 |
| EDT-072 | E20 | avertissement (non cliquable) | « Sans « <champ> », l'automatisation ne partirait jamais. » | « Without “<field>”, the automation would never run. » | Liste les champs obligatoires vides ; n'empêche PAS d'enregistrer | `manquants.length > 0` | PDecl:143-145, 355-361 |
| EDT-073 | E20 | bouton | Annuler | Cancel | Ferme SANS confirmation | — | PDecl:365-371 |
| EDT-074 | E20 | bouton | Enregistrer | Save | `enregistrer()` → `enregistrerDeclencheur(conditions, arreterSiResolu)` → `ecrire({ conditions[, settings] })` (PATCH ou POST) ; toast « Réglages enregistrés » / « Settings saved » ; ferme le panneau ; erreur = toast (message du serveur), le panneau reste. Aucun état « en cours », jamais désactivé | — | PDecl:147-187, 372-374 ; Page:1490-1504 |

#### 2.7 Champ générique d'un déclencheur ou d'une action (`ChampAction`)

Libellé du champ suivi de « * » (obligatoire) ou de « (facultatif) » / « (optional) », aide sous le champ (Champ:304-319). Un champ sous drapeau n'est rendu que si le drapeau est actif (Champ:43-50).

| ID | État(s) où il apparaît | Type | Libellé FR | Libellé EN | Ce qu'il fait d'après le code | Visible / actif seulement si | Source |
|---|---|---|---|---|---|---|---|
| EDT-075 | E20, E22a | zone de texte (type `zone`) | (libellé du catalogue) + compteur « n / max » ; « · limite atteinte » | « · limit reached » | `onChange` ; `maxLength = champ.max` ; 6 lignes si max > 2000, sinon 3 ; compteur affiché si max ≥ 200, ambre au-delà de 90 %, rouge à 100 % | — | Champ:69-105 |
| EDT-076 | E20, E22a | select (type `choix`) | option vide : « — Inchangé — » par défaut, ou `vide_fr` du champ ; puis les options du catalogue | « — Unchanged — » ou `vide_en` | `onChange` | — | Champ:107-117 |
| EDT-077 | E20, E22a | champ nombre (type `nombre`) | (libellé du catalogue) | (idem) | `onChange` ; attributs `min` / `max` du catalogue (indicatifs : la frappe hors bornes n'est pas bloquée) | — | Champ:119-131 |
| EDT-078 | E22a | case à cocher (type `bascule`) | le libellé du champ, à droite de la case | (idem) | `onChange('true' ou 'false')` | — | Champ:133-147 |
| EDT-079 | E22a | select (type `membre`) | option vide « — Personne — » ; puis les membres actifs (nom ; « Membre sans nom » si vide) | « — Nobody — » | `onChange(user_id)` | liste vide si `chargerMembres` échoue | Champ:149-159 ; Api:396-414 |
| EDT-080 | E22a | select (type `automatisation`) | « — Choisir — » puis les autres automatisations publiées ; sans aucune : texte « Aucune autre automatisation publiée à démarrer. » | « — Pick one — » ; « No other published automation to start. » | `onChange(id)` | — | Champ:161-185 |
| EDT-081 | E20 | select (type `etape_pipeline`) | « — Toutes les étapes — » puis « <pipeline> · <étape> » ; sans aucune : « Aucune étape de pipeline. Créez-en dans Pipeline de ventes. » | « — Every stage — » ; « No pipeline stage yet. Create some in the sales pipeline. » | `onChange(id)` | les étapes ne sont chargées que si le déclencheur a un champ de ce type | Champ:187-212 ; Page:1408-1431 |
| EDT-082 | E20 | select (type `champ_date`) | « — Choisir une date — » puis « <Client ou Pipeline> · <champ> » ; sans aucun : « Aucun champ date sur le client ni sur le pipeline. Créez-en un dans Paramètres → Champs personnalisés. » | « — Pick a date field — » ; « No date field on the client or the pipeline. Create one in Settings → Custom fields. » | `onChange(id)` | — | Champ:214-241 ; Page:328-333 |
| EDT-083 | E20 | select (type `service`) | « — N'importe quel service — » puis les services actifs | « — Any service — » | `onChange(id)` | chargés seulement si le déclencheur a un champ de ce type | Champ:243-252 ; Page:1396-1405 |
| EDT-084 | E20, E22a | champ texte avec suggestions (type `etiquette`) | (libellé du catalogue) ; `datalist` des étiquettes existantes | (idem) | `onChange` ; saisie libre permise | — | Champ:254-275 |
| EDT-085 | E22a | champ adresse (type `url`) | indication « https:// » | « https:// » | `onChange` ; `type="url"`, aucune validation côté navigateur avant l'envoi | — | Champ:277-288 |
| EDT-086 | E22a | champ texte (type `texte`) | (libellé du catalogue) | (idem) | `onChange` ; `maxLength = champ.max` | — | Champ:290-300 |

#### 2.8 Éditeur de conditions sur les champs personnalisés (`EditeurConditions`)

Utilisé par les Filtres du déclencheur (EDT-070) et par l'étape « si » (EDT-127). 10 conditions au plus ; ET logique entre les lignes.

| ID | État(s) où il apparaît | Type | Libellé FR | Libellé EN | Ce qu'il fait d'après le code | Visible / actif seulement si | Source |
|---|---|---|---|---|---|---|---|
| EDT-087 | E20, E22e | select | (sr) « Champ » ; options = champs actifs de l'objet | « Field » | Change le champ, remet l'opérateur au premier de sa famille et vide les valeurs | une ligne existe | EdCond:70-80 |
| EDT-088 | idem | select | (sr) « Opérateur » ; options selon la famille (§ 3b) | « Operator » | Change l'opérateur, vide les valeurs | idem | EdCond:81-87 |
| EDT-089 | idem | select | (sr) « Valeur » : « oui (cochée) » / « non (pas cochée) » | « yes (checked) » / « no (not checked) » | `value: true ou false` | famille `case` | EdCond:90-99 |
| EDT-090 | idem | champ texte | aria-label « Valeur » | « Value » | `value: texte` (aucun `maxLength` ; le serveur limite à 500) | famille `texte`, hors « est vide » / « n'est pas vide » | EdCond:100-105 |
| EDT-091 | idem | champ texte numérique (`inputMode="decimal"`, pas `type="number"`) | aria-label « Valeur » ; « $ » après si montant | « Value » | `value: Number(texte)` (× 100 arrondi si montant) | famille `nombre`, hors vide / non vide | EdCond:106-123 |
| EDT-092 | idem | champ texte numérique | « et » + aria-label « Deuxième valeur » | « and » + « Second value » | `value2` | opérateur « entre » (nombre) | EdCond:112-120 |
| EDT-093 | idem | boutons bascule (`aria-pressed`), un par option | groupe « Options » ; libellé de l'option | « Options » | Ajoute / retire l'option de `value[]` (options archivées incluses : pas de filtre) | famille `liste`, opérateurs « est l'un de » / « n'est aucun de » | EdCond:124-140 |
| EDT-094 | idem | champ nombre | aria-label « Nombre » | « Number » | `n` borné 1 à 3650 | famille `date`, opérateurs « dans les derniers », « il y a plus de », « il y a moins de » | EdCond:141-146 |
| EDT-095 | idem | select | (sr) « Unité » : jours / semaines / mois | « Unit » : days / weeks / months | `unit` | idem | EdCond:147-155 |
| EDT-096 | idem | sélecteur de date (bouton « Choisir une date » + calendrier : « Mois précédent », « Mois suivant », jours) | Choisir une date | Pick a date | `value: 'AAAA-MM-JJ'` | famille `date`, opérateurs « avant le », « après le », « entre » | EdCond:158-162 ; `src/components/ui/DatePickerInput.tsx:131-208` |
| EDT-097 | idem | sélecteur de date | « et » + Choisir une date | « and » + Pick a date | `value2` | opérateur « entre » (date) | EdCond:163-170 |
| EDT-098 | idem | bouton icône | aria-label « Retirer la condition » | « Remove condition » | Supprime la ligne | une ligne existe | EdCond:174-180 |
| EDT-099 | idem | bouton | Ajouter une condition | Add a condition | Ajoute une ligne sur le premier champ actif, premier opérateur de sa famille | moins de 10 lignes ; sans champ actif : texte « Aucun champ personnalisé pour cet objet. » | EdCond:47-56, 184-191 |

#### 2.9 Panneau d'étape

| ID | État(s) où il apparaît | Type | Libellé FR | Libellé EN | Ce qu'il fait d'après le code | Visible / actif seulement si | Source |
|---|---|---|---|---|---|---|---|
| EDT-100 | E22 | bouton icône | aria-label « Fermer le panneau » | « Close panel » | `fermer()` : si le brouillon diffère → dialogue « Fermer sans enregistrer ? » (EDT-164) ; puis ferme | — | PEtape:362-369, 238-251 |
| EDT-101 | E22 | onglet | Modifier l'action (même pour une attente, une condition, un arrêt) | Edit action | `setOnglet('edition')` | — | PEtape:373-396 |
| EDT-102 | E22 | onglet | Statistiques | Statistics | `setOnglet('stats')` ; affiche E22g ou E22h (chiffres chargés une seule fois à l'ouverture de l'éditeur : `chargerStatistiques`, GET `/api/automations/rules/stats?rule_id=`) | — | PEtape:373-396 ; Page:350-359 |
| EDT-103 | E22a | champ texte | Nom de l'action (facultatif) ; aide « Ce qui s'affiche sur la carte. Utile quand le parcours envoie plusieurs courriels. » ; indication = libellé de l'action | Action name (optional) ; « What shows on the card. Useful when a journey sends several emails. » | `brouillon.nom` ; `maxLength=80` | étape action, hors `log_activity` | PEtape:442-461 |
| EDT-104 | E22a | select | Quoi faire * ; groupes = familles ; options = actions compatibles et disponibles seulement | What to do * | `changerType(type)` : remet la configuration à vide (garde `body` si la nouvelle action a un champ `body`) ; ne pose PAS les valeurs par défaut | idem | PEtape:463-495, 310-321 |
| EDT-105 | E22c | select | Champ * ; « — Choisir un champ — » ; champs de l'objet de l'événement ; sans aucun : « Aucun champ personnalisé sur l'objet « <objet> ». Créez-en un dans Paramètres → Champs personnalisés. » ; champ disparu : « Ce champ n'existe plus (archivé ou supprimé) : choisissez-en un autre. » | Field * ; « No custom field on “<object>”… » ; « This field no longer exists (archived or deleted): pick another one. » | `field_id` + vide `value` | action « Mettre à jour un champ personnalisé » | ChAuto:242-276 ; PEtape:499-508 |
| EDT-106 | E22c | saisie selon le type du champ (variantes ci-dessous) | Nouvelle valeur (facultatif) ; « Vide = effacer le champ. » ; montant : « En dollars. Vide = effacer le champ. » ; option vide « — Effacer le champ — » | New value (optional) ; « Empty = clear the field. » ; « In dollars. Empty = clear the field. » ; « — Clear the field — » | `value` (texte) | un champ est choisi | ChAuto:277-292 |
| EDT-107 | E20, E22c | variantes de `SaisieValeurChamp` : liste multiple en mode action = cases à cocher (une par option non archivée) ; liste (simple, ou multiple en mode condition) = select ; case = select « Oui (cochée) » / « Non (décochée) » ; nombre = champ nombre ; montant = champ nombre pas 0,01 + « $ » ; date = champ date ; paragraphe = zone de texte (5000) ; autres = champ texte / courriel / adresse (500) | « — Aucune — » par défaut | « — None — » ; « Yes (checked) » / « No (unchecked) » | `onChange(texte)` | selon `champ.field_type` | ChAuto:159-235 |
| EDT-108 | E22a | champs de l'action (un contrôle par champ ; rendu § 2.7 ; liste § 3c, CHA-01 à CHA-40) | (libellés du catalogue) | (idem) | `majConfig(cle, valeur)` dans le brouillon local | `champVisible` ; pas pour « Mettre à jour un champ personnalisé » | PEtape:510-524 |
| EDT-109 | E22a | bouton de variable | Nom du client | Client name | Ajoute `[client_name]` À LA FIN du premier champ de type `zone` de l'action (pas à l'endroit du curseur) | l'action a au moins un champ `zone` ; titre « Insérer une information du client » / « Insert client information » | PEtape:123-130, 526-549 |
| EDT-110 | E22a | bouton de variable | Nom de votre entreprise | Your business name | Ajoute `[company_name]` | idem | idem |
| EDT-111 | E22a | bouton de variable | Total | Total | Ajoute `[invoice_total]` | idem | idem |
| EDT-112 | E22a | bouton de variable | Lien facture | Invoice link | Ajoute `[invoice_link]` | idem | idem |
| EDT-113 | E22a | bouton de variable | Lien du devis | Quote link | Ajoute `[quote_link]` | idem | idem |
| EDT-114 | E22a | bouton de variable | Date du rendez-vous | Appointment date | Ajoute `[appointment_date]` | idem | idem |
| EDT-115 | E22a | bloc repliable (`details` / `summary`) | Champs de base (sous le titre « Insérer un champ ») | Base fields (« Insert a field ») | Déplie / replie la liste des variables système | idem | ChAuto:331-334 ; PEtape:552-555 |
| EDT-116 | E22a | boutons de variable système (90 : 20 client, 11 pipeline, 25 job, 22 devis, 12 facture — liste § 3d) | « <Objet> · <libellé> » ; `title` = `{{objet.cle}}` | (idem EN) | Ajoute `{{objet.cle}}` à la fin du premier champ `zone` | bloc déplié | ChAuto:336-341 |
| EDT-117 | E22a | boutons de variable de champ personnalisé (un par champ actif, tous objets sauf Propriété) | « <Objet> · <libellé du champ> » ; `title` = `{{objet.cle}}` | (idem) | Ajoute `{{objet.cle}}` à la fin du premier champ `zone` | l'entreprise a des champs personnalisés | ChAuto:344-353 |
| EDT-118 | E22d | champ nombre | Attendre * | Wait * | `n × secondes de l'unité` dans `delai_secondes` (ou `secondes_avant` en mode « avant ») ; `min=0`, `max=365` (indicatifs) | étape attendre | PEtape:577-594 |
| EDT-119 | E22d | select | aria-label « Unité de temps » : minutes / heures / jours | « Time unit » : minutes / hours / days | Recalcule le délai avec la nouvelle unité | idem | PEtape:595-609 ; unités PEtape:169-173 |
| EDT-120 | E22d | select | Ce qu'on attend : « Simplement ce délai » / « La réponse du client (au plus ce délai) » / « Ce délai AVANT le rendez-vous » | What we wait for : « Just this delay » / « The client's reply (at most this delay) » / « This long BEFORE the appointment » | Change `mode` (`duree`, `reponse`, `avant_date`) et bascule entre `delai_secondes` et `secondes_avant` ; texte d'aide différent par mode | la 3e option n'est offerte que si le déclencheur est `appointment.created` (ou si l'étape est déjà dans ce mode) | PEtape:620-662 |
| EDT-121 | E22e | bouton d'exemple | `statut = ` | `statut = ` | Ajoute la ligne à la fin de la zone « Conditions » | étape si | PEtape:687-705 |
| EDT-122 | E22e | bouton d'exemple | `source = ` | `source = ` | idem | idem | idem |
| EDT-123 | E22e | bouton d'exemple | `total_cents > ` | `total_cents > ` | idem | idem | idem |
| EDT-124 | E22e | bouton d'exemple | `created_at >= ` | `created_at >= ` | idem | idem | idem |
| EDT-125 | E22e | zone de texte (4 lignes, police à chasse fixe) | Conditions ; aide « Une ligne par condition : champ = valeur, ou une comparaison (montant > 5000, created_at >= 2026-06-01). Deux lignes sur le même champ font un intervalle. Le parcours suit « alors » quand toutes sont vraies. » | Conditions ; « One condition per line: field = value, or a comparison (amount > 5000, created_at >= 2026-06-01). Two lines on the same field make a range. The journey follows “then” when all are true. » | Garde le texte tel que tapé ; `analyserConditions` en tire l'objet `conditions` ; une ligne sans opérateur, sans clé ou sans valeur est ignorée sans message | idem | PEtape:669-723, 80-110 |
| EDT-126 | E22i | encadré des problèmes (non cliquable) | (messages § 5) | (idem) | Liste ce qui empêche d'enregistrer l'étape | `problemes.length > 0` | PEtape:745-753 |
| EDT-127 | E22e | conditions de champs (éditeur § 2.8) | « … et si les champs personnalisés sont : » | « … and if the custom fields are: » | `conditions.champs_perso` | l'objet de la règle est connu ET a des champs personnalisés | PEtape:726-732 ; ChAuto:359-379 |
| EDT-128 | E22 | bouton (rouge, poubelle) | Supprimer | Delete | `onSupprimer(id)` → dialogue « Supprimer cette étape ? » (EDT-159) | — | PEtape:760-767 |
| EDT-129 | E22 | bouton | Annuler | Cancel | `fermer()` (comme EDT-100) | — | PEtape:785-791 |
| EDT-130 | E22 | bouton | Enregistrer | Save action | `onEnregistrer(brouillon)` : remplace l'étape dans le parcours (`memoriser`), ferme le panneau, état « Modifié » → enregistrement automatique 3 s plus tard. Pour une étape « si » : retire d'abord les conditions de champs incomplètes. AUCUN appel réseau direct | désactivé si `problemes.length > 0` (le premier problème est affiché en rouge à sa gauche) | PEtape:792-802 ; Page:806-809 |
| EDT-131 | E22g | tuiles de statistiques (non cliquables) | Réussis / Sautés / Échoués / En attente | Succeeded / Skipped / Failed / Pending | Affichage seul | onglet Statistiques | PEtape:407-419 |
| EDT-132 | E22a | ATTENDU (#840, absent de cette copie) : alerte `role="alert"` | « Variable inconnue : [x] — sera vide dans le message envoyé. » | introuvable dans cette copie | Signale une variable non reconnue dans le texte | à vérifier sur la version à jour | absent |
| EDT-133 | E22a (texto) | ATTENDU (#840, absent de cette copie) : compteur | « 200 / 1600 · 2 SMS » | introuvable dans cette copie | Nombre de caractères et de segments du texto | à vérifier sur la version à jour | absent (aujourd'hui : compteur « n / 1600 » de EDT-075) |

#### 2.10 Clavardage Lumi

Les pastilles (EDT-024 à 027), le bouton flottant (EDT-020), « Voir Autopilot » (EDT-023) et le résumé (EDT-053) sont dans le canevas.

| ID | État(s) où il apparaît | Type | Libellé FR | Libellé EN | Ce qu'il fait d'après le code | Visible / actif seulement si | Source |
|---|---|---|---|---|---|---|---|
| EDT-134 | E35, E36 | zone de texte (3 lignes) | (sr) « Décris ton automatisation » ; indication avant le 1er message : « Après l'envoi d'un devis, attends 24 h puis envoie un texto de suivi, attends 2 jours de plus pour un courriel, et crée une tâche d'appel après 3 jours. » ; ensuite : « Change le délai du deuxième message à 2 jours. Retire le courriel. » | « Describe your automation » ; « After sending a quote, wait 24 hours then send a text follow-up… » ; « Change the second message delay to 2 days. Remove the email. » | `onPrompt` | Lumi disponible | Lumi:100-124 |
| EDT-135 | E35, E36 | raccourci clavier | Entrée | Enter | Envoie (si au moins 10 caractères et pas de génération en cours) | — | Lumi:109-115 |
| EDT-136 | E35, E36 | raccourci clavier | Maj+Entrée | Shift+Enter | Saut de ligne | — | Lumi:111 |
| EDT-137 | E35, E36, E38 | bouton | Construire (1er message) / Envoyer (ensuite) / Lumi construit… ; à gauche : « Déduit de tes crédits Lumi » | Build / Send / Lumi is building… ; « Uses your Lumi credits » | `construireAvecLumi()` : crée la règle si besoin (POST), `genererParcoursAvecLumi` = POST `/api/automations/rules/generer`, remplace les étapes du canevas (`memoriser`), met à jour le nom, le déclencheur (`ecrire({ trigger_event })`), le résumé, le fil ; crée ou met à jour une 2e automatisation si proposée (POST ou PATCH). Toast « Lumi a construit le parcours — en pause, à publier quand tu es prêt. » ; erreur : toast (message du serveur) | désactivé si moins de 10 caractères ou génération en cours | Lumi:50, 129-141 ; Page:520-659 |
| EDT-138 | E36 | bouton icône | aria-label « Replier le clavardage » | « Collapse the chat » | `setLumiReduit(true)` (le fil est gardé) | variante latérale | Lumi:157-166 |
| EDT-139 | après une 2e automatisation | bouton d'action du toast (10 s) | Ouvrir | Open | `navigate('/automations/<id de la 2e>')` — même composant, sans remontage | Lumi a proposé `autre` et la création a réussi | Page:604-609 |

#### 2.11 Onglet Réglages

Chaque changement est enregistré tout de suite : `modifierAutomatisation(ruleId, { settings })` = PATCH `/api/automations/rules/:id`, en file (un envoi à la fois). Erreur : toast (message du serveur) et retour à la dernière valeur confirmée.

| ID | État(s) où il apparaît | Type | Libellé FR | Libellé EN | Ce qu'il fait d'après le code | Visible / actif seulement si | Source |
|---|---|---|---|---|---|---|---|
| EDT-140 | E42 | indicateur (non cliquable) | Enregistrement… / Enregistré | Saving… / Saved | État de la file d'envoi (« Enregistré » dès l'ouverture) | — | Regl:142-148 |
| EDT-141 | E42 | interrupteur (`role="switch"`) | Laisser le client repasser | Allow re-entry | `appliquer({ reentree })` | — | Regl:157-168, 51-66 |
| EDT-142 | E42 | interrupteur | Arrêter si le client répond | Stop on response | `appliquer({ arret_sur_reponse })` | — | Regl:170-181 |
| EDT-143 | E42 | select | Une fois par client tous les… : Pas de limite / 1 jour / 3 jours / 7 jours / 14 jours / 30 jours / 90 jours | Once per client every… : No limit / 1 day / 3 days / 7 days / 14 days / 30 days / 90 days | `appliquer({ delai_entre_passages_jours })` (0 = retiré) | — | Regl:185-205 |
| EDT-144 | E42 | select | Fenêtre d'envoi — De : « 7 h » à « 21 h » | Send window — From | `appliquer({ fenetre: { debut, fin } })` | options ≥ heure de fin désactivées | Regl:225-238 |
| EDT-145 | E42 | select | à : « 8 h » à « 22 h » | to | idem | options ≤ heure de début désactivées | Regl:239-251 |
| EDT-146 | E42 | lien (bouton) | Revenir à 8 h – 20 h | Back to 8 – 20 | `appliquer({ fenetre: undefined })` | une fenêtre personnalisée existe | Regl:252-260 |
| EDT-147 | E42 | interrupteur | Jours ouvrables seulement | Business days only | `appliquer({ jours_ouvrables })` | — | Regl:269-278 |

#### 2.12 Onglet Historique

| ID | État(s) où il apparaît | Type | Libellé FR | Libellé EN | Ce qu'il fait d'après le code | Visible / actif seulement si | Source |
|---|---|---|---|---|---|---|---|
| EDT-148 | E43 | select | Statut : Tous / En attente / Terminés / Échoués / Annulés | Status : All events / Pending / Completed / Failed / Cancelled | Relance `lireInscriptions({ ruleId, statut })` (table `automation_scheduled_tasks`, 60 jours, 200 lignes) | — | Journ:330-345 ; JApi:110-137 |
| EDT-149 | E43 | tableau (non cliquable) | Client · Étape en cours · Statut · Prévu le · Terminé le ; compteur « N ligne(s) » | Contact · Current action · Status · Next execution · Completed on ; « N row(s) » | Affichage seul ; aucune ligne cliquable, pas de pagination, pas de filtre de dates, pas de bouton « rafraîchir » | des lignes existent | Journ:346-405 |

#### 2.13 Onglet Journaux

| ID | État(s) où il apparaît | Type | Libellé FR | Libellé EN | Ce qu'il fait d'après le code | Visible / actif seulement si | Source |
|---|---|---|---|---|---|---|---|
| EDT-150 | E44 | select | Action : Toutes les actions + un choix par type d'action PRÉSENT dans les lignes chargées | Action : All actions | Relance `lireJournaux({ ruleId, action, statut })` (table `automation_execution_logs`, 60 jours, 200 lignes) | — | Journ:183-196 ; JApi:69-92 |
| EDT-151 | E44 | select | Statut : Tous les statuts / Réussis / Échoués | Status : All statuses / Succeeded / Failed | idem | — | Journ:198-210 |
| EDT-152 | E44 | ligne cliquable (`tr role="button"`, `aria-expanded`) | Client · Action · Statut · Exécuté le | Contact · Action · Status · Executed on | Déplie / replie le détail : Destinataire, Objet, Message, Titre, « Autres détails » ; ou « Le contenu de cet envoi n'a pas été conservé (exécution antérieure au journal détaillé). » | des lignes existent | Journ:238-281, 86-131 |
| EDT-153 | E44 | raccourci clavier | Entrée ou Espace sur une ligne | Enter or Space | Même effet que le clic | la ligne a le focus (`tabIndex=0`) | Journ:245-253 |

#### 2.14 Dialogues, confirmations et gardes de sortie

Fenêtre commune : `role="dialog"`, focus initial sur « Annuler », au-dessus de tout (`z-[10000]`).

| ID | État(s) où il apparaît | Type | Libellé FR | Libellé EN | Ce qu'il fait d'après le code | Visible / actif seulement si | Source |
|---|---|---|---|---|---|---|---|
| EDT-154 | E49 | bouton | Annuler | Cancel | Répond « non » | — | Confirm:129-136 ; `fr.ts:1605`, `en.ts:1613` |
| EDT-155 | E49 | bouton (rouge si `danger`) | (libellé du dialogue) | (idem) | Répond « oui » | — | Confirm:137-146 |
| EDT-156 | E49 | raccourci clavier | Échap | Escape | Répond « non » | — | Confirm:96-101 |
| EDT-157 | E49 | clic hors de la carte | — | — | Répond « non » | — | Confirm:107-112 |
| EDT-158 | menu « ··· » | dialogue (rouge) | Titre « Supprimer N étape(s) ? » ; message « Cette étape et tout ce qui la suit seront retirés du parcours. » ; bouton « Supprimer » | « Delete N step(s)? » ; « This step and everything after it will be removed. » ; « Delete » | Oui : retire les étapes, ferme menu et panneau | via EDT-054 | Page:866-873 |
| EDT-159 | menu « ··· », panneau d'étape | dialogue (rouge) | « Supprimer cette étape ? » ; « Ce qui venait après reste dans le parcours et se rebranche tout seul. » ; « Supprimer » | « Delete this step? » ; « What came after stays in the journey and reconnects on its own. » ; « Delete » | Oui : `retirerEtape`, ferme le panneau | via EDT-047, EDT-128 | Page:883-890 |
| EDT-160 | canevas | dialogue (rouge) | « Changer d'étape sans enregistrer ? » ; « Les modifications de l'étape ouverte ne sont pas enregistrées : elles seront perdues. » ; « Changer d'étape » | « Switch step without saving? » ; « The open step's changes are not saved: they will be lost. » ; « Switch step » | Oui : ouvre l'autre étape | une autre carte est cliquée et le brouillon d'étape est modifié | Page:257-270 |
| EDT-161 | publication | dialogue | « Publier cette automatisation ? » ; message : « Elle commencera à envoyer de vrais messages à vos clients dès le prochain déclenchement. » OU « Elle se déclenchera dès le prochain événement — pour du travail interne seulement. » + (client inactif) « N client(s) correspond(ent) aujourd'hui. Les messages partiront par petits lots, en journée. » + « ⚠ <avertissement> » pour chaque avertissement ; « Publier » | « Publish this automation? » ; « It will start sending real messages to your clients at the next trigger. » OU « It will run at the next event — internal work only. » ; « Publish » | Oui : enregistre puis publie | via EDT-018 vers « publiée », sans problème bloquant | Page:1125-1139 |
| EDT-162 | format d'origine | dialogue | « Convertir ce parcours ? » ; « Les N étapes affichées deviendront modifiables dans le canevas. L'automatisation continue de fonctionner pendant et après : les envois ne changent pas. » ; « Convertir » | « Convert this journey? » ; « The N steps shown will become editable on the canvas. The automation keeps running during and after: what it sends does not change. » ; « Convert » | Oui : PATCH `{ steps }` | règle publiée seulement (un brouillon se convertit sans question) | Page:1237-1246 |
| EDT-163 | sortie | dialogue (rouge) | « Quitter sans enregistrer ? » ; « Une étape est incomplète, donc le parcours n'a pas pu être enregistré. Si vous quittez maintenant, ces modifications seront perdues. » OU « Vos dernières modifications ne sont pas encore enregistrées. Si vous quittez maintenant, elles seront perdues. » ; « Quitter » | « Leave without saving? » ; « A step is incomplete, so the journey could not be saved. If you leave now, those changes are lost. » OU « Your latest changes are not saved yet. If you leave now, they will be lost. » ; « Leave » | Oui : `navigate('/automations')` | état « incomplet » ou enregistrement de sortie en échec | Page:1348-1362 |
| EDT-164 | panneau d'étape | dialogue (rouge) | « Fermer sans enregistrer ? » ; « Les modifications de cette étape ne sont pas enregistrées : elles seront perdues. » ; « Fermer sans enregistrer » | « Close without saving? » ; « This step's changes are not saved: they will be lost. » ; « Close without saving » | Oui : ferme le panneau | via EDT-100, EDT-129, brouillon modifié | PEtape:238-251 |
| EDT-165 | E31 | garde du navigateur (`beforeunload`) | (message du navigateur) | (idem) | Demande confirmation avant de fermer ou recharger l'onglet | état modifié, incomplet ou en cours | Page:1281-1286 |
| EDT-166 | sortie par le bouton « retour » du navigateur ou tout autre lien | comportement au démontage (pas de dialogue) | Toasts : « Automatisation quittée sans enregistrer : une étape était incomplète. » ; « Vos dernières modifications n'ont pas pu être enregistrées : <erreur> » | « Automation left without saving: a step was incomplete. » ; « Your latest changes could not be saved: <error> » | Si modifié ou en cours : `ecrire({ name, steps })` au démontage ; si incomplet : toast d'erreur, rien n'est enregistré | la sortie n'est pas passée par `quitterEditeur` | Page:1301-1321 |

#### 2.15 Toasts (référence, textes exacts)

| Réf. | Quand | FR | EN | Source |
|---|---|---|---|---|
| T-01 | Publication réussie | Automatisation publiée | Automation published | Page:193-195 |
| T-02 | Retour en brouillon réussi | Repassée en brouillon | Back to draft | Page:193-195 |
| T-03 | Échec de bascule | (message du serveur, ex. « Publication refusée : … ») | (idem, traduit par le serveur) | Page:200 |
| T-04 | Ajout au-delà de 30 étapes | Un parcours compte au plus 30 étapes. Retirez-en une avant d'ajouter. | A journey holds at most 30 steps. Remove one before adding. | Page:396-398 |
| T-05 | Duplication au-delà de 30 étapes | Un parcours compte au plus 30 étapes. Retirez-en une avant de dupliquer. | A journey holds at most 30 steps. Remove one before duplicating. | Page:832-834 |
| T-06 | Changement de déclencheur refusé | (message du serveur) | (idem) | Page:497 |
| T-07 | Déclencheur de Lumi non enregistré | Le déclencheur proposé par Lumi n'a pas pu être enregistré : <erreur> | Lumi's trigger could not be saved: <error> | Page:567-569 |
| T-08 | 2e automatisation créée / mise à jour | « <nom> » créée en brouillon / « <nom> » mise à jour (+ action « Ouvrir ») | “<name>” created as a draft / “<name>” updated (+ « Open ») | Page:604-609 |
| T-09 | 2e automatisation en échec | La 2e automatisation n'a pas pu être créée. | The second automation could not be created. | Page:612 |
| T-10 | Génération Lumi réussie | Lumi a construit le parcours — en pause, à publier quand tu es prêt. | Lumi built the path — paused, publish it when you are ready. | Page:637-639 |
| T-11 | Génération Lumi en échec | (message du serveur, ex. « Lumi a proposé un parcours que le moteur ne saurait pas exécuter. Reformule, ou construis-le avec le « + ». ») | (idem) | Page:641 ; Srv:377-405 |
| T-12 | Enregistrement auto : débit dépassé | Trop de modifications d'un coup — on réessaie dans un instant. | Too many changes at once — retrying in a moment. | Page:1039-1042 |
| T-13 | Enregistrement auto : autre échec | Enregistrement impossible pour le moment — nouvel essai automatique. (<message>) | Could not save right now — retrying automatically. (<message>) | Page:1043-1045 |
| T-14 | Publication : problème bloquant | <premier problème> ; s'il y en a plusieurs : « <premier> (N autre(s) à corriger) » | « … (N more to fix) » | Page:1094-1098 |
| T-15 | Publication : enregistrement préalable en échec | (message du serveur) | (idem) | Page:1151 |
| T-16 | Conversion impossible | Ce parcours contient une étape d'un ancien format qui ne se convertit pas : il reste en lecture seule. | This journey contains an old-format step that cannot be converted: it stays read-only. | Page:1232-1234 |
| T-17 | Conversion réussie | Parcours converti — il est modifiable | Journey converted — it is editable | Page:1253 |
| T-18 | Conversion en échec | (message du serveur) | (idem) | Page:1255 |
| T-19 | Départ avec étape incomplète | Automatisation quittée sans enregistrer : une étape était incomplète. | Automation left without saving: a step was incomplete. | Page:1308-1310 |
| T-20 | Départ : enregistrement en échec | Vos dernières modifications n'ont pas pu être enregistrées : <erreur> | Your latest changes could not be saved: <error> | Page:1317-1319 |
| T-21 | Réglages du déclencheur enregistrés | Réglages enregistrés | Settings saved | Page:1500 |
| T-22 | Réglages du déclencheur en échec | (message du serveur) | (idem) | Page:1502 |
| T-23 | Aperçu sans règle en base | Ajoutez une première étape : il n'y a encore rien à prévisualiser. | Add a first step: there is nothing to preview yet. | Page:1668 |
| T-24 | Aperçu avec étape incomplète | Complétez les étapes en cours pour voir l'aperçu à jour. | Complete the unfinished steps to see an up-to-date preview. | Page:1680 |
| T-25 | Aperçu en échec | (message du serveur, repli « Impossible de préparer l'aperçu. ») | (idem ; repli en français seulement) | Page:1689 ; Api:502 |
| T-26 | Onglet Réglages : échec | (message du serveur) | (idem) | Regl:115 |
| T-27 | Réseau coupé (tout appel serveur) | Connexion perdue — vérifiez votre réseau et réessayez. Rien n'a été modifié. | Connection lost — check your network and try again. Nothing was changed. | `src/lib/appelServeur.ts:14-18` |

---

### 3. Catalogue

#### 3a. Déclencheurs (28)

Source : Cat:123-459 (liste), Cat:468-488 (filtres d'étiquettes ajoutés), Cat:499-506 (familles), Cat:1127-1161 (entité moteur), Cat:111-117 (case de sortie).

Colonnes communes :
- « Entité moteur » = `ENTITE_PAR_DECLENCHEUR` (ce que `actionCompatible` compare). « Objet des champs » = objet dont on peut filtrer / écrire les champs personnalisés (`objetDeLaRegle`).
- « +2 étiq. » = les deux filtres ajoutés d'office : `client_a_etiquette` (« Seulement si le client a l'étiquette » / « Only if the client has tag », type `etiquette`, facultatif) et `client_sans_etiquette` (« Seulement si le client n'a PAS l'étiquette » / « Only if the client does NOT have tag », type `etiquette`, facultatif, aide « Ex. : « Ne pas relancer ». »).
- « Filtres de champs » = section Filtres (EDT-070), offerte seulement si l'objet est connu et que l'entreprise a des champs sur cet objet.
- Aucun déclencheur ne porte `bientot` dans cette copie.

| ID | Clé | FR | EN | Famille | Entité (catalogue) → entité moteur → objet des champs | Champs propres (clé · libellé FR / EN · type · obligatoire · options / bornes) | +2 étiq. | Case de sortie (drapeau `auto_sortie_parcours`) | Drapeau / particularité |
|---|---|---|---|---|---|---|---|---|---|
| DEC-01 | `quote.sent` | Devis envoyé | Quote sent | devis | quote → quote → Devis | aucun | oui | « Arrêter si la soumission est acceptée, refusée ou annulée » (cochée par défaut) | déclencheur par défaut d'une nouvelle automatisation |
| DEC-02 | `quote.viewed` | Devis ouvert par le client | Quote opened by client | devis | quote → quote → Devis | `ouverture` · Quand déclencher / When to trigger · choix · non · « Première ouverture seulement » (`premiere`), « Chaque ouverture » (`chaque`) ; `montant__gte` · Montant minimum ($) / Minimum amount ($) · nombre · non · min 0 ; `montant__lte` · Montant maximum ($) / Maximum amount ($) · nombre · non · min 0 ; `service_id` · Contient le service / Includes service · service · non ; `stage_id` · L'opportunité est à l'étape / Deal is at stage · etape_pipeline · non ; `etiquette` · Le client a l'étiquette / Client has tag · etiquette · non | NON (a déjà `etiquette`) | — | `conditions_defaut: { ouverture: 'premiere' }` |
| DEC-03 | `quote.approved` | Devis accepté | Quote approved | devis | quote → quote → Devis | aucun | oui | — | — |
| DEC-04 | `quote.declined` | Devis refusé | Quote declined | devis | quote → quote → Devis | aucun | oui | — | — |
| DEC-05 | `quote.changes_requested` | Modifications demandées | Changes requested | devis | quote → quote → Devis | aucun | oui | — | — |
| DEC-06 | `invoice.sent` | Facture envoyée | Invoice sent | facture | invoice → invoice → Facture | aucun | oui | « Arrêter si la facture est payée ou annulée » (cochée) | — |
| DEC-07 | `invoice.paid` | Facture payée | Invoice paid | facture | invoice → invoice → Facture | aucun | oui | — | — |
| DEC-08 | `invoice.overdue` | Facture en retard | Invoice overdue | facture | invoice → invoice → Facture | aucun | oui | « Arrêter si la facture est payée ou annulée » (cochée) | — |
| DEC-09 | `payment.failed` | Paiement échoué | Payment failed | facture | invoice → invoice → Facture | aucun | oui | — | drapeau `auto_paiement_echoue` |
| DEC-10 | `invoice.viewed` | Facture consultée par le client | Invoice viewed by client | facture | invoice → invoice → Facture | `ouverture` · Quand déclencher / When to trigger · choix · non · « Première consultation seulement » (`premiere`), « Chaque consultation » (`chaque`) | oui | — | drapeau `auto_consultation_documents` ; `conditions_defaut: { ouverture: 'premiere' }` |
| DEC-11 | `appointment.created` | Rendez-vous planifié | Appointment scheduled | rendezvous | appointment → schedule_event → aucun objet | aucun | oui | « Arrêter si le rendez-vous est annulé » (cochée) | `accepte_delai_negatif` ; seul déclencheur qui offre l'attente « avant le rendez-vous » |
| DEC-12 | `appointment.cancelled` | Rendez-vous annulé | Appointment cancelled | rendezvous | appointment → schedule_event → aucun | aucun | oui | — | — |
| DEC-13 | `job.completed` | Job terminé | Job completed | job | job → job → Job | aucun | oui | — | — |
| DEC-14 | `job.ready_for_invoicing` | Job prêt à facturer | Job ready to invoice | job | job → job → Job | aucun | oui | — | — |
| DEC-15 | `lead.created` | Nouveau prospect | New lead | client | lead → lead → Client | aucun | oui | — | — |
| DEC-16 | `lead.status_changed` | Statut du prospect changé | Lead status changed | client | lead → lead → Client | aucun | oui | — | — |
| DEC-17 | `client.replied` | Le client répond | Client replies | client | lead → client → Client | aucun | oui | — | — |
| DEC-18 | `client.tagged` | Étiquette ajoutée | Tag added | client | lead → client → Client | `tag` · Quelle étiquette / Which tag · etiquette · non · « Vide = n'importe quelle étiquette. » | oui | — | — |
| DEC-19 | `client.untagged` | Étiquette retirée | Tag removed | client | lead → client → Client | `tag` · Quelle étiquette / Which tag · etiquette · non | oui | — | — |
| DEC-20 | `client.inactive` | Client inactif | Inactive client | client | lead → client → Client | `mois` · Aucun job terminé depuis (mois) / No completed job for (months) · nombre · OUI · 1 à 60 ; `max_par_heure` · Au plus, par heure / At most, per hour · nombre · non · 1 à 1000 | oui | — | drapeau `auto_client_inactif` ; `conditions_defaut: { mois: 6, max_par_heure: 25 }` ; compteur de clients visés (EDT-069) |
| DEC-21 | `agreement.signed` | Contrat signé | Agreement signed | client | agreement → job → Job | aucun | oui | — | — |
| DEC-22 | `task.completed` | Tâche terminée | Task completed | job | lead → client → Client | aucun | oui | — | rangé dans la famille « Jobs » |
| DEC-23 | `note.added` | Note ajoutée | Note added | client | lead → client → Client | aucun | oui | — | — |
| DEC-24 | `webhook.received` | Appel reçu de l'extérieur | Incoming webhook | client | lead → (ABSENT de la table) → aucun | aucun | NON | — | aucun réglage : le clic sur la carte « Quand » ouvre directement le tiroir ; toutes les actions sont offertes (entité inconnue) |
| DEC-25 | `date.reached` | Date atteinte | Date reached | client | lead → client (ou Pipeline si le champ date choisi est un champ du pipeline) → Client ou Pipeline | `champ_id` · Quelle date surveiller / Which date to watch · champ_date · OUI ; `jours_avant` · Combien de jours avant / How many days before · nombre · non · -365 à 365 (« 7 = une semaine avant la date. 0 = le jour même. -7 = une semaine après. ») | oui | — | — |
| DEC-26 | `deal.stage_entered` | Opportunité entre dans une étape | Deal enters a stage | vente | deal → deal → Pipeline | `stage_id` · Quelle étape / Which stage · etape_pipeline · non | oui | « Arrêter si l'opportunité change d'étape » (DÉCOCHÉE par défaut) | — |
| DEC-27 | `deal.stage_idle` | Opportunité qui dort | Deal going stale | vente | deal → deal → Pipeline | `stage_id` · Quelle étape / Which stage · etape_pipeline · non | oui | — | — |
| DEC-28 | `custom_field.changed` | Champ personnalisé modifié | Custom field changed | client | lead → `*` (variable) → objet du champ choisi | hors catalogue : « Quel champ » (EDT-066, enregistré `field_id: { eq }`) et « Quand il devient » (EDT-067, enregistré `new_value: { eq }`) | oui | — | sans champ choisi : pas de filtres de champs, toutes les actions offertes |

Résumé affiché sous la carte « Quand » (`declencheurDetail`, Page:1441-1487) : « N'importe quel champ », « champ supprimé », « <champ> → <valeur> », « ⚠ <champ> à choisir », « étape supprimée », « service supprimé », « <libellé> : <valeur> », « N filtre(s) », séparés par « · ».

#### 3b. Étapes de contrôle et conditions

Types d'étape (Seq:15-80) : `action`, `attendre`, `si`, `arreter`. « Objectif », « fenêtre horaire par étape », « ré-entrée par étape », « aller à » : INTROUVABLES comme étapes. La fenêtre d'envoi et la ré-entrée sont des réglages de la règle (onglet Réglages) ; la sortie de parcours est la case du déclencheur (EDT-071) et l'étape « Arrêter ici ».

**Attendre** (PEtape:169-173, 575-664 ; `server/lib/validation.ts:1111-1137`)

| Réglage | Valeurs | Détail |
|---|---|---|
| Nombre | entier ≥ 0 ; attribut `max=365` (indicatif) | Valeur par défaut à la création : 1 jour (86 400 s). Plafonds du serveur : 366 jours pour un délai, 30 jours pour « avant le rendez-vous » |
| Unité | `minutes` (60 s), `heures` (3 600 s), `jours` (86 400 s) | L'affichage choisit la plus grande unité qui tombe juste (`decomposer`) |
| Mode `duree` | « Simplement ce délai » / « Just this delay » | « Le parcours continue une fois le délai écoulé, quoi qu'il arrive. » |
| Mode `reponse` | « La réponse du client (au plus ce délai) » / « The client's reply (at most this delay) » | « S'il répond, le parcours s'arrête ici. Sinon, la suite part une fois le délai écoulé. » La destination `si_reponse` existe dans le type mais n'a AUCUN contrôle dans l'éditeur |
| Mode `avant_date` | « Ce délai AVANT le rendez-vous » / « This long BEFORE the appointment » | Seulement sur `appointment.created`. « Le rappel part ce délai avant le rendez-vous. Rendez-vous déplacé : le rappel suit. Moment déjà passé : ce rappel est sauté. » `si_depasse` : aucun contrôle |
| Aide fixe | « Les messages ne partent jamais entre 20 h et 8 h, même si l'attente se termine la nuit. » | PEtape:611-615 |

**Si… (conditions en texte)** — zone « Conditions » (EDT-125), une condition par ligne, toutes vraies = branche « si oui ».

| Opérateur | Signe à taper | Forme enregistrée | Syntaxe / exemple |
|---|---|---|---|
| `eq` | `=` | valeur à plat : `{ cle: "valeur" }` (toujours du TEXTE, même si c'est un nombre) | `statut = envoye` |
| `neq` | `!=` | `{ cle: { neq: valeur } }` | `source != web` |
| `gt` | `>` | `{ cle: { gt: valeur } }` | `total_cents > 500000` |
| `gte` | `>=` | `{ cle: { gte: valeur } }` | `created_at >= 2026-06-01` |
| `lt` | `<` | `{ cle: { lt: valeur } }` | `montant < 5000` |
| `lte` | `<=` | `{ cle: { lte: valeur } }` | `montant <= 5000` |
| intervalle | deux lignes sur la même clé | `{ cle: { gte: a, lt: b } }` | `montant >= 1000` puis `montant < 5000` |
| `in`, `not_in` | AUCUNE syntaxe dans l'éditeur | acceptés par le serveur (1 à 50 valeurs) | une condition existante de ce type n'apparaît pas dans la zone de texte (soupçon S-21) |

Règles d'analyse (PEtape:80-110) : le premier signe trouvé dans la ligne l'emporte (le plus long à position égale) ; une valeur purement numérique devient un nombre sauf pour `=` ; une ligne sans signe, sans clé ou sans valeur est ignorée. Boutons d'exemple : `statut = `, `source = `, `total_cents > `, `created_at >= `. Limites du serveur : 10 clés au plus, clé de 64 caractères, valeur de 200 caractères (`server/lib/validation.ts:1034-1068`). `OPERATEURS_CONDITIONS` du catalogue (Cat:1291) n'en cite que 4 (`eq`, `neq`, `in`, `not_in`) : la constante est en retard sur le serveur.

**Conditions sur les champs personnalisés** (`champs_perso`, `src/lib/champs/filtres.ts:49-91`) — 20 opérateurs, 6 familles, 10 lignes au plus.

| Famille (types de champ) | Opérateurs (FR / EN) | Saisie de la valeur |
|---|---|---|
| texte (ligne simple, paragraphe, téléphone, courriel, URL) | `is` est / is ; `is_not` n'est pas / is not ; `contains` contient / contains ; `not_contains` ne contient pas / doesn't contain ; `is_empty` est vide / is empty ; `is_not_empty` n'est pas vide / is not empty | champ texte |
| nombre (nombre, monétaire) | `eq` = ; `neq` ≠ ; `gt` plus grand que / greater than ; `lt` plus petit que / less than ; `between` entre / between ; `is_empty` ; `is_not_empty` | un ou deux champs numériques (montant en dollars, stocké en cents) |
| liste (liste déroulante, choix multiples) | `any_of` est l'un de / is any of ; `none_of` n'est aucun de / is none of ; `is_empty` ; `is_not_empty` | pastilles à cocher, une par option |
| date | `today` aujourd'hui / today ; `yesterday` hier / yesterday ; `in_last` dans les derniers / in the last ; `more_than_ago` il y a plus de / more than … ago ; `less_than_ago` il y a moins de / less than … ago ; `before` avant le / before ; `after` après le / after ; `between` entre / between ; `is_empty` ; `is_not_empty` | nombre (1 à 3650) + unité (jours, semaines, mois), ou une / deux dates |
| case (case à cocher) | `is` est / is | oui (cochée) / non (pas cochée) |
| fichier | `is_empty` ; `is_not_empty` | aucune |

Une ligne incomplète est retirée à l'enregistrement (`sansConditionsIncompletes`, ChAuto:146-152 ; règle de complétude EdCond:32-38).

**Arrêter ici** : aucun réglage.

#### 3c. Actions (21) et leurs champs (40)

Source : Cat:690-1112 (actions), Cat:612-622 (champ « Type d'envoi »), Cat:1173-1199 (`actionCompatible`), Cat:1223-1231 (`champVisible`), Cat:1267-1277 (`configParDefaut`).

Compatibilité : une action sans `entites` suit tous les déclencheurs. Sinon elle n'est offerte que si l'entité moteur du déclencheur est dans sa liste. Cas particuliers : `webhook.received` (entité inconnue) et `custom_field.changed` sans champ choisi (`*`) laissent passer TOUTES les actions ; dans l'éditeur, « Date atteinte » sur un champ du pipeline et « Champ personnalisé modifié » avec un champ choisi comptent comme l'objet de ce champ (3e argument de `actionCompatible`, que le contrôle de publication ne passe pas — soupçon S-09).

| ID | Clé | FR | EN | Famille | Vers le client | Compatible avec | Indisponibilité |
|---|---|---|---|---|---|---|---|
| ACT-01 | `send_email` | Envoyer un courriel | Send an email | communication | oui | tous | — |
| ACT-02 | `send_sms` | Envoyer un texto | Send a text message | communication | oui | tous | — |
| ACT-03 | `create_notification` | Notifier l'équipe | Notify the team | communication | non | tous | — |
| ACT-04 | `request_review` | Demander un avis | Ask for a review | communication | oui | tous | — (aucun champ) |
| ACT-05 | `envoyer_slack` | Envoyer dans Slack | Send to Slack | communication | non | tous | « Bientôt : la connexion à votre Slack n'existe pas encore. » / « Coming soon: connecting your Slack is not available yet. » — grisée dans le tiroir, absente du select « Quoi faire », refusée à la publication |
| ACT-06 | `ajouter_etiquette` | Ajouter une étiquette | Add a tag | client | non | tous | — |
| ACT-07 | `retirer_etiquette` | Retirer une étiquette | Remove a tag | client | non | tous | — |
| ACT-08 | `modifier_client` | Modifier le client | Update the client | client | non | tous | — |
| ACT-09 | `assigner_responsable` | Assigner un responsable | Assign an owner | client | non | tous | — |
| ACT-10 | `ajouter_note` | Ajouter une note | Add a note | client | non | tous | — |
| ACT-11 | `update_custom_field` | Mettre à jour un champ personnalisé | Update a custom field | client | non | tous (le champ doit être de l'objet de l'événement) | — |
| ACT-12 | `create_task` | Créer une tâche | Create a task | travail | non | tous | — |
| ACT-13 | `modifier_statut_rendezvous` | Changer le statut du rendez-vous | Change appointment status | travail | non | `appointment.created`, `appointment.cancelled` (entité `schedule_event`) | — |
| ACT-14 | `move_deal_stage` | Déplacer l'opportunité | Move the deal | vente | non | `quote.sent`, `quote.viewed`, `quote.approved`, `quote.declined`, `quote.changes_requested`, `deal.stage_entered`, `deal.stage_idle` (entités `deal`, `quote`) | — |
| ACT-15 | `modifier_deal` | Modifier l'opportunité | Update the deal | vente | non | `deal.stage_entered`, `deal.stage_idle` (entité `deal`) | — |
| ACT-16 | `assigner_deal` | Assigner l'opportunité | Assign the deal | vente | non | `deal.stage_entered`, `deal.stage_idle` | — |
| ACT-17 | `envoyer_facture` | Envoyer la facture | Send the invoice | argent | oui | `invoice.sent`, `invoice.paid`, `invoice.overdue`, `payment.failed`, `invoice.viewed` (entité `invoice`) | — |
| ACT-18 | `envoyer_soumission` | Envoyer le devis | Send the quote | argent | oui | les 5 déclencheurs `quote.*` (entité `quote`) | — |
| ACT-19 | `webhook` | Appeler un webhook | Call a webhook | technique | non | tous | — |
| ACT-20 | `demarrer_automatisation` | Démarrer une automatisation | Start an automation | technique | non | tous | — |
| ACT-21 | `arreter_automatisation` | Arrêter une automatisation | Stop an automation | technique | non | tous | — |

Hors catalogue mais affichées si une règle en porte : `log_activity` (« Note dans l'historique » / « History note », aucun réglage) ; `send_notification` et `update_status` (empêchent la conversion).

Champs des actions :

| ID | Action | Clé | FR | EN | Type | Obligatoire | Max / bornes | Options | Valeur par défaut à la création | Visible seulement si | Drapeau |
|---|---|---|---|---|---|---|---|---|---|---|---|
| CHA-01 | `send_email` | `from_name` | Nom de l'expéditeur | From name | texte | non | 100 | — | — | — | — |
| CHA-02 | `send_email` | `reply_to` | Répondre à | Reply to | texte | non | 200 | — | — | — | — |
| CHA-03 | `send_email` | `subject` | Objet | Subject | texte | OUI | 200 | — | « Un message de [company_name] » / « A message from [company_name] » | — | — |
| CHA-04 | `send_email` | `preheader` | Aperçu | Preview text | texte | non | 200 | — | — | — | — |
| CHA-05 | `send_email` | `body` | Message | Message | zone | OUI | 10 000 | — | « Bonjour [client_name],↵↵Merci de faire affaire avec [company_name].↵↵Au plaisir,↵[company_name] » | — | — |
| CHA-06 | `send_email` | `type_envoi` | Type d'envoi | Message type | choix | non | — | vide = « Automatique (selon l'usage) » ; `transactionnel` « Transactionnel — part même si le client s'est désabonné » ; `marketing` « Marketing — pas envoyé à un client désabonné » | — | — | `auto_desabonnement_canal` |
| CHA-07 | `send_sms` | `body` | Texte du message | Message text | zone | OUI | 1 600 | — | « Bonjour [client_name], c'est [company_name]. Merci ! » | — | — |
| CHA-08 | `send_sms` | `type_envoi` | Type d'envoi | Message type | choix | non | — | comme CHA-06 | — | — | `auto_desabonnement_canal` |
| CHA-09 | `create_notification` | `title` | Titre | Title | texte | OUI | 200 | — | « Suivi a faire pour [client_name] » (sans accent) / « Follow up on [client_name] » | — | — |
| CHA-10 | `create_notification` | `body` | Détail | Details | zone | non | 2 000 | — | — | — | — |
| CHA-11 | `create_notification` | `destinataire` | Pour qui | For whom | choix | non | — | `proprietaire` Le propriétaire ; `responsable` Le responsable du client ; `equipe_du_deal` Le rep assigné + propriétaires et admins ; `membre` Un membre précis ; option vide « — Inchangé — » (aide : « Vide = toute l'équipe. ») | — | — | — |
| CHA-12 | `create_notification` | `membre_id` | Le membre | The member | membre | non | — | membres actifs | — | `destinataire` = `membre` | — |
| CHA-13 | `create_notification` | `par_courriel` | Aussi par courriel | Also by email | bascule | non | — | — | — | — | — |
| CHA-14 | `envoyer_slack` | `body` | Message | Message | zone | OUI | 3 000 | — | « [client_name] — suivi a faire » | — | — |
| CHA-15 | `ajouter_etiquette` | `etiquette` | L'étiquette | The tag | etiquette | OUI | 60 | suggestions | aucune (l'étape naît incomplète) | — | — |
| CHA-16 | `retirer_etiquette` | `toutes` | Retirer toutes les étiquettes | Remove all tags | bascule | non | — | — | — | — | — |
| CHA-17 | `retirer_etiquette` | `etiquette` | L'étiquette | The tag | etiquette | non | 60 | suggestions | — | `toutes` vide ou `false` | — |
| CHA-18 | `modifier_client` | `statut` | Statut | Status | choix | non | — | `lead` Prospect ; `active` Client actif ; `inactive` Inactif | — | — | — |
| CHA-19 | `modifier_client` | `source` | Source | Source | texte | non | 60 | — | — | — | — |
| CHA-20 | `modifier_client` | `valeur` | Valeur estimée ($) | Estimated value ($) | nombre | non | 0 à 10 000 000 | — | — | — | — |
| CHA-21 | `assigner_responsable` | `membre_id` | Le membre | The member | membre | non | — | membres actifs ; « Vide = retire le responsable actuel. » | — | — | — |
| CHA-22 | `assigner_responsable` | `seulement_si_vide` | Seulement si personne n'est assigné | Only if unassigned | bascule | non | — | — | — | — | — |
| CHA-23 | `ajouter_note` | `body` | La note | The note | zone | OUI | 4 000 | — | « Note automatique pour [client_name]. » | — | — |
| CHA-24 | `update_custom_field` | `field_id` | Champ | Field | texte dans le catalogue ; rendu par un select (EDT-105) | OUI | 36 | champs de l'objet | aucune (naît incomplète) | — | — |
| CHA-25 | `update_custom_field` | `value` | Nouvelle valeur | New value | texte dans le catalogue ; rendu selon le type du champ (EDT-106) | non | 5 000 | — | — | un champ est choisi | — |
| CHA-26 | `create_task` | `title` | Titre de la tâche | Task title | texte | OUI | 200 | — | « Rappeler [client_name] » / « Call [client_name] back » | — | — |
| CHA-27 | `create_task` | `body` | Détail | Details | zone | non | 2 000 | — | — | — | — |
| CHA-28 | `create_task` | `priorite` | Priorité | Priority | choix | non | — | `low` Basse ; `medium` Moyenne ; `high` Haute ; option vide « — Inchangé — » | — | — | — |
| CHA-29 | `create_task` | `echeance_jours` | À faire dans (jours) | Due in (days) | nombre | non | 0 à 365 | — | — | — | — |
| CHA-30 | `create_task` | `membre_id` | Assignée à | Assigned to | membre | non | — | membres actifs | — | — | — |
| CHA-31 | `modifier_statut_rendezvous` | `statut` | Nouveau statut | New status | choix | OUI | — | `scheduled` Planifié ; `completed` Terminé ; `cancelled` Annulé | aucune (naît incomplète) | — | — |
| CHA-32 | `move_deal_stage` | `cible` | Vers | To | choix | non | — | `etape` Une étape précise ; `role_envoyee` L'étape « Soumission envoyée » ; `role` L'étape « Soumission ouverte » (depuis « Soumission envoyée ») ; `gagne` L'étape « Gagné » ; option vide « — Inchangé — » | — | — | — |
| CHA-33 | `move_deal_stage` | `stage_id` | L'étape visée | Target stage | TEXTE libre | OUI | 40 | — | aucune (naît incomplète) | `cible` vide ou `etape` | — |
| CHA-34 | `modifier_deal` | `source` | Source | Source | texte | non | 60 | — | — | — | — |
| CHA-35 | `assigner_deal` | `membre_id` | Le membre | The member | membre | non | — | membres actifs ; « Vide = retire le responsable actuel. » | — | — | — |
| CHA-36 | `envoyer_facture` | `body` | Mot d'accompagnement | Cover note | zone | non | 2 000 | — | — | — | — |
| CHA-37 | `envoyer_soumission` | `body` | Mot d'accompagnement | Cover note | zone | non | 2 000 | — | — | — | — |
| CHA-38 | `webhook` | `url` | L'adresse | The address | url | OUI | 500 | — | aucune (naît incomplète) ; « Doit commencer par https:// » | — | — |
| CHA-39 | `demarrer_automatisation` | `rule_id` | Laquelle | Which one | automatisation | OUI | — | autres automatisations publiées | aucune (naît incomplète) | — | — |
| CHA-40 | `arreter_automatisation` | `portee` | Laquelle | Which one | choix | non | — | `courante` Celle-ci ; `toutes` Toutes ; option vide « — Inchangé — » (aide : « Vide = celle-ci. ») | — | — | — |

#### 3d. Variables insérables

**« Insérer une information du client »** (6 boutons, PEtape:123-130) — écrites entre crochets :

| Bouton FR | Bouton EN | Texte inséré |
|---|---|---|
| Nom du client | Client name | `[client_name]` |
| Nom de votre entreprise | Your business name | `[company_name]` |
| Total | Total | `[invoice_total]` |
| Lien facture | Invoice link | `[invoice_link]` |
| Lien du devis | Quote link | `[quote_link]` |
| Date du rendez-vous | Appointment date | `[appointment_date]` |

Les mêmes 6 boutons sont offerts quel que soit le déclencheur.

**« Insérer un champ » → « Champs de base »** (90 boutons, repliés ; `src/lib/champs/standard.ts:100-242`, champs qui ont une section) — texte inséré `{{objet.cle}}` :

| Objet (libellé du bouton) | Nombre | Clés |
|---|---|---|
| Client | 20 | `first_name`, `last_name`, `client_number`, `company`, `display_as_company`, `phone`, `phone_label`, `other_phones`, `email`, `email_label`, `lead_source`, `address`, `street`, `city`, `province`, `postal_code`, `country`, `taxes`, `billing_same_as_service`, `billing_address` |
| Pipeline (`deal`) | 11 | `pipeline`, `client`, `first_name`, `last_name`, `email`, `phone`, `address`, `amount`, `expected_close_date`, `assigned_user`, `source` |
| Job | 25 | `title`, `job_number`, `salesperson`, `sale_date`, `show_on_leaderboard`, `ask_for_review`, `client`, `property`, `job_type`, `visits`, `visit_start_time`, `visit_end_time`, `team`, `requires_invoicing`, `billing_split`, `deposit_required`, `deposit_type`, `deposit_value`, `require_payment_method`, `line_items`, `taxes`, `subtotal`, `agreement`, `notes`, `total` |
| Devis (`quote`) | 22 | `client`, `quote_type`, `title`, `property`, `quote_number`, `salesperson`, `valid_days`, `photos`, `introduction`, `line_items`, `contract_disclaimer`, `client_message`, `notes`, `specific_notes`, `subtotal`, `discount`, `tax`, `deposit_required`, `deposit_type`, `deposit_value`, `require_payment_method`, `total` |
| Facture (`invoice`) | 12 | `client`, `subject`, `invoice_date`, `due_date`, `salesperson`, `line_items`, `subtotal`, `discount`, `tax`, `notes`, `internal_notes`, `total` |

**« Insérer un champ » → champs personnalisés** : un bouton par champ actif de l'entreprise (Client, Pipeline, Job, Devis, Facture ; pas Propriété), libellé « <Objet> · <nom du champ> », texte inséré `{{objet.cle}}` (ChAuto:344-353).

Tous les boutons sont offerts quel que soit l'objet de l'événement.

---

### 4. Appels API de l'éditeur

| # | Fonction cliente | Méthode et cible | Quand il part | Succès | Erreur |
|---|---|---|---|---|---|
| A01 | `chargerEditeur(ruleId)` (Api:112-121) | GET `/api/automations/editeur[?rule_id=<id>]` | Au montage, à chaque changement de `:id`, au clic « Réessayer ». 3 essais (1,5 s puis 3 s) | Règle, catalogue, autres automatisations publiées | Après 3 échecs : E04. `rule: null` : E05 |
| A02 | `chargerMembres()` (Api:396-414) | Supabase `memberships` : `select('user_id, full_name')`, `org_id`, `status = 'active'` | Avec A01 | Menus « membre » | Renvoie `[]` sans message (l'erreur n'est même pas journalisée) |
| A03 | `chargerEtiquettes()` (Api:422-429) | Supabase `client_tags` : `select('tag').limit(500)` | Avec A01 | Suggestions d'étiquettes | Renvoie `[]` sans message |
| A04 | `chargerStatistiques(ruleId)` (Api:201-211) | GET `/api/automations/rules/stats?rule_id=<id>` | Quand `regle.id` change (une seule fois par ouverture) | Onglet Statistiques du panneau d'étape | `console.error` seulement ; l'onglet dit « Aucun passage encore. » |
| A05 | `listerChamps()` via `useChampsTous` (ChAuto:33-43) | GET `/api/custom-fields` ; mis en cache 60 s | Au montage | Champs personnalisés pour filtres, conditions, variables | Liste vide, aucun message |
| A06 | `fetchPipelines()` + `fetchStages(id)` (Page:1408-1431) | Supabase `pipelines_ventes`, `pipeline_stages` | Seulement si le déclencheur a un champ `etape_pipeline` (DEC-02, DEC-26, DEC-27) | Menu des étapes | `console.error` ; le menu affiche « Aucune étape de pipeline. Créez-en dans Pipeline de ventes. » |
| A07 | `listPredefinedServices()` (Page:1396-1405) | Supabase `predefined_services` | Seulement si le déclencheur a un champ `service` (DEC-02) | Menu des services | `console.error` ; menu réduit à « — N'importe quel service — » |
| A08 | `apercuClientsInactifs(mois)` (`src/lib/reservationApi.ts:44-54`) | GET `/api/automations/clients-inactifs/apercu?mois=<n>` | Panneau « Client inactif » (300 ms après la frappe) ; avant la confirmation de publication | Compteur (EDT-069) ; phrase dans le dialogue de publication | `console.error` ; rien à l'écran |
| A09 | drapeaux : `useModuleAccess` × 5 (`auto_sortie_parcours`, `auto_consultation_documents`, `auto_paiement_echoue`, `auto_client_inactif`, `auto_desabonnement_canal`) et `usePlanFeature('includes_ai')` | GET `/api/features` (lecture partagée) ; forfait | Au montage | Déclencheurs, case de sortie, champ « Type d'envoi », carte Lumi | État « inconnu » = traité comme désactivé |
| A10 | `creerAutomatisation(brouillon)` (Api:123-131) | POST `/api/automations/rules` | PREMIÈRE écriture d'une automatisation ouverte sur `/nouvelle` (enregistrement auto, renommage, choix du déclencheur, réglages du déclencheur, envoi à Lumi, aperçu, publication, sortie). Aussi pour la 2e automatisation proposée par Lumi | L'adresse devient `/automations/<id>` sans rechargement | Message du serveur dans le toast de l'appelant |
| A11 | `modifierAutomatisation(id, patch)` (Api:133-144) | PATCH `/api/automations/rules/<id>` | `{ name, steps }` : enregistrement auto, sortie, démontage, avant aperçu, avant publication. `{ trigger_event[, conditions] }` : choix du déclencheur, proposition de Lumi. `{ conditions[, settings] }` : panneau du déclencheur. `{ steps }` : conversion. `{ settings }` : onglet Réglages. 2e automatisation de Lumi (mise à jour) | Selon l'appelant (toasts T-17, T-21 ; indicateur « Enregistré ») | 400 (validation), 403 (« Votre rôle ne permet pas de modifier une automatisation. »), 404 (« Automatisation introuvable. »), 422 `publiee_cassee` (« Cette automatisation est publiée : cette modification l'empêcherait de fonctionner (…). Corrigez-la, ou repassez-la en brouillon d'abord. »), 500 |
| A12 | Enregistrement automatique (Page:981-1053) | A10 ou A11 avec `{ name, steps }` | État « Modifié », règle chargée, aucune étape incomplète. Délai : 3 s après la dernière modification ; après un échec : 6, 12, 24, puis 48 s. En cas de débit dépassé (429) : 2 reprises dans le même essai, après 1,5 s puis 4 s | « Enregistré » (si le parcours n'a pas changé entre-temps, sinon « Modifié ») | Toast T-12 ou T-13 (un seul, remplacé à chaque essai), retour à « Modifié », nouvel essai automatique SANS fin |
| A13 | `genererParcoursAvecLumi(demande, langue, contexte)` (Api:352-388) | POST `/api/automations/rules/generer` avec `demande`, `langue`, `echanges` (6 derniers), `parcours_actuel`, `rule_id` | Bouton ou Entrée dans le champ de Lumi (10 caractères au moins) | Étapes remplacées dans le canevas, toast T-10, fil mis à jour | 400 « Décris ton automatisation en une phrase. » ; 422 avec message ; `brouillon_retire` → retour à `/automations/nouvelle?lumi=1` |
| A14 | `apercuAutomatisation(id)` (Api:498-504) | POST `/api/automations/rules/<id>/apercu` | Bouton « Aperçu » | E25 | Toast T-25 |
| A15 | `changerPublication(id, actif)` (Api:151-158) via la file `creerFileBascule` | POST `/api/automations/rules/<id>/publication` avec `{ actif }` | Interrupteur. Une seule requête en vol ; des clics répétés = au plus 2 requêtes | T-01 ou T-02 | T-03 : 422 « Publication refusée : <problèmes> », 422 corbeille, 403 « Votre rôle ne permet pas de publier une automatisation. », 404, 500 ; l'écran revient au dernier état confirmé |
| A16 | `lireJournaux(filtres)` (JApi:69-92) | Supabase `automation_execution_logs` (colonnes : id, action_type, result_success, result_error, result_data, duration_ms, entity_type, entity_id, trigger_event, created_at) ; 60 jours, 200 lignes ; puis noms des clients (`clients`, `quotes`, `invoices`, `jobs`, `schedule_events`) | Ouverture de l'onglet Journaux, changement de filtre | Tableau | « Les journaux n'ont pas pu être lus. » (pas de bouton pour réessayer) |
| A17 | `lireInscriptions(params)` (JApi:110-137) | Supabase `automation_scheduled_tasks` ; 60 jours, 200 lignes ; puis noms des clients | Ouverture de l'onglet Historique, changement de filtre | Tableau | « L'historique n'a pas pu être lu. » |

Aucune gestion de version ni de conflit : le PATCH écrit sans comparer `updated_at` (Srv:556-562).

---

### 5. Règles de validation et de publication

#### 5.1 Ce qui empêche d'ENREGISTRER

| Règle | Où | Message exact | Source |
|---|---|---|---|
| Nom : 120 caractères au plus (la frappe est bloquée). Nom vide : l'ancien nom est renvoyé sans message | champ nom | aucun | Page:1586, 1015 |
| 30 étapes au plus | ajout, duplication | T-04, T-05 | Page:222, 395-401, 831-837 |
| Une action dont un champ obligatoire visible est vide, ou d'un type hors catalogue, SUSPEND l'enregistrement de tout le parcours | indicateur | « N étape(s) à compléter » / « N step(s) to complete » | Page:942-960, 984 |
| Champ obligatoire vide dans le panneau d'étape | « Enregistrer » désactivé | « « <champ> » est vide. » / « “<field>” is empty. » | PEtape:279-285 |
| Action incompatible avec le déclencheur | « Enregistrer » désactivé | « « <action> » ne peut pas suivre ce déclencheur : choisissez-en une autre. » / « “<action>” cannot follow this trigger: pick another one. » | PEtape:271-277 |
| « Mettre à jour un champ » sur un champ d'un autre objet | « Enregistrer » désactivé | « « <champ> » n'est pas un champ de la fiche que ce déclencheur fait arriver. » / « “<field>” is not a field of the record this trigger brings. » | PEtape:291-298 |
| Longueurs : nom d'étape 80 ; champs texte selon `max` ; zones selon `max` (compteur) | frappe bloquée | « n / max · limite atteinte » | PEtape:450 ; Champ:75, 90-103 |
| Lumi : 10 caractères au moins | bouton désactivé, sans explication | (serveur : « Décris ton automatisation en une phrase. ») | Lumi:50 ; Page:522 ; Srv:327-329 |
| Refus du serveur à l'enregistrement (affichés dans le toast T-13 ou le toast de l'appelant) : action inconnue ; « « <action> » : le champ « <champ> » est obligatoire. » ; « « <champ> » depasse <max> caracteres. » ; « « <champ> » doit etre un nombre / doit etre au moins N / doit etre au plus N / doit etre l'un de : … / doit etre un membre valide / doit commencer par https:// / ne peut pas viser une adresse interne / adresse invalide » ; « « <action> » n'utilise pas le champ « <clé> ». » | serveur | (ci-contre, sans accents dans le code) | `server/lib/validation.ts:798-854, 913-1012` |
| Graphe : « Deux étapes portent le même identifiant. » ; « L'étape « x » renvoie vers « y », qui n'existe pas. » ; « Le parcours revient sur lui-même : les messages partiraient en boucle. » ; « La séquence se termine par une attente : rien ne se passera après. » ; plus de 30 étapes | serveur | (ci-contre) | `server/lib/automationSequences.ts:216-260` ; `server/lib/validation.ts:1164-1174` |
| Attente : 0 à 366 jours ; « avant le rendez-vous » : 30 jours au plus | serveur | « Cannot wait more than a year. » ; « At most 30 days before. » (textes d'origine, éventuellement reformulés par le serveur) | `server/lib/validation.ts:1114-1137` |
| Conditions : 10 clés au plus ; 10 conditions de champs au plus ; opérateurs fermés | serveur | « Too many conditions (10 max). » | `server/lib/validation.ts:1035-1068` |
| Réglages : fenêtre entre 7 h et 22 h, début avant fin ; « une fois par client » 1 à 365 jours | serveur (les menus de l'onglet n'offrent que des valeurs valides) | « Fenêtre d'envoi : entre 7 h et 22 h seulement — aucun texto ne part la nuit. … » ; « La fenêtre doit commencer avant de finir. … » | `server/lib/validation.ts:1186-1237` |
| Automatisation fournie (préréglage) : le déclencheur ne se change pas | serveur | « Le déclencheur d'une automatisation fournie ne se change pas. Dupliquez-la pour en faire une à vous. » | Srv:516-520 |
| Automatisation PUBLIÉE : une modification qui ajoute un problème bloquant est refusée | serveur | « Cette automatisation est publiée : cette modification l'empêcherait de fonctionner (…). Corrigez-la, ou repassez-la en brouillon d'abord. » | Srv:547-554 ; `server/lib/automations-publication.ts:35-39` |
| Rôle sans droit d'écriture | serveur | « Votre rôle ne permet pas de modifier une automatisation. » / « … de créer une automatisation. » | Srv:254-257, 565-567 |
| Réglages du déclencheur : champ obligatoire vide | NE bloque PAS l'enregistrement | « Sans « <champ> », l'automatisation ne partirait jamais. » | PDecl:355-361 |
| Format d'origine non convertible (`send_notification`, `update_status`) | bouton absent, clic sur une carte | T-16 et le texte du bandeau | Seq:383-400 |

#### 5.2 Ce qui empêche de PUBLIER

Contrôle local AVANT le dialogue (`problemesPublication`, même module que le serveur). Le premier problème bloquant est affiché en toast (T-14) et son étape s'ouvre. Les mêmes problèmes sont affichés en continu dans le bandeau rouge (E32).

| Gravité | Message FR | Message EN | Source |
|---|---|---|---|
| bloquant | Choisissez ce qui déclenche cette automatisation. | Pick what triggers this automation. | Cat:1341-1346 |
| bloquant | « <déclencheur> » n'est pas encore branché : l'automatisation ne partirait jamais. | “<trigger>” is not wired yet: the automation would never run. | Cat:1347-1354 |
| bloquant | « <déclencheur> » : « <champ> » doit être rempli, sinon l'automatisation ne partirait jamais. | “<trigger>”: “<field>” is required, otherwise the automation would never run. | Cat:1366-1376 |
| bloquant | Ajoutez au moins une étape : pour l'instant, cette automatisation ne fait rien. | Add at least one step: right now this automation does nothing. | Cat:1383-1390 |
| bloquant | Une étape utilise une action inconnue. | A step uses an unknown action. | Cat:1403-1410 |
| bloquant | « <action> » : <raison d'indisponibilité> | “<action>”: <reason> | Cat:1412-1415 |
| bloquant | « <action> » ne peut pas suivre ce déclencheur. | “<action>” cannot follow this trigger. | Cat:1418-1424 |
| bloquant | « <action> » : « <champ> » est vide. | “<action>”: “<field>” is empty. | Cat:1427-1437 |
| bloquant | Une étape renvoie vers une étape supprimée. | A step points to a deleted step. | Cat:1456-1465 |
| bloquant | Le parcours se termine par une attente : rien ne se passera après. | The journey ends on a wait: nothing will happen afterwards. | Cat:1478-1485 |
| avertissement | Une condition est vide : le parcours suivrait toujours le même chemin. | A condition is empty: the journey would always take the same path. | Cat:1467-1473 |
| avertissement | Aucun message ne part au client : cette automatisation ne fait que du travail interne. | No message goes to the client: this automation only does internal work. | Cat:1487-1493 |

Exceptions (Pub:43-71) : une automatisation fournie restée au format d'origine n'a aucun problème ; une ancienne règle simple n'est vérifiée que sur ses actions du catalogue ; l'action provisoire « À compléter » compte pour un parcours vide.

Après le dialogue : enregistrement des modifications en attente (échec → T-15, pas de publication), puis appel serveur. Refus du serveur (toast T-03) : « Publication refusée : <problèmes séparés par · > » / « Publishing refused: … » ; « Cette automatisation est à la corbeille : restaurez-la avant de la publier. » ; « Votre rôle ne permet pas de publier une automatisation. » ; « Automatisation introuvable. » ; « La modification n'a pas été appliquée — réessayez. » (`server/lib/automations-publication.ts:30-103`).

Repasser en brouillon : jamais refusé par contrôle, jamais confirmé.

---

### 6. Soupçons à vérifier au navigateur

Ce sont des PISTES tirées de la lecture du code. Chacune donne le geste qui tranche. Gravité : ★★★ perte de travail ou comportement faux pour le client final ; ★★ gêne forte ; ★ finition.

#### Perte de travail, écritures inattendues

| # | Grav. | Soupçon | Indice dans le code | Geste pour trancher |
|---|---|---|---|---|
| S-01 | ★★★ | Cliquer « Ouvrir » sur le toast de la 2e automatisation change d'automatisation SANS remonter l'éditeur : l'identifiant d'écriture passe tout de suite à la 2e, alors que l'écran et la minuterie d'enregistrement portent encore la 1re. Les étapes que Lumi vient de poser dans la 1re ne lui sont jamais enregistrées, et peuvent être écrites dans la 2e (nom compris) si le chargement dépasse 3 s | Page:607 (`navigate`), 676 (`idReel.current` réaffecté), 144 (`ecrire` vise `idReel.current`), 1053 (dépendances de la minuterie) ; l'état « Modifié » n'est pas remis à zéro au chargement (Page:699-735) | Sur une nouvelle automatisation, demander à Lumi « relance de devis, et quand le client répond envoie mon lien Calendly ». Dès que le toast paraît, cliquer « Ouvrir » (moins de 3 s). Onglet Réseau : regarder l'adresse et le corps du PATCH qui suit. Revenir à la 1re : a-t-elle ses étapes ? Refaire avec le réseau ralenti (« Slow 3G ») |
| S-02 | ★★★ | Changer de déclencheur GARDE les réglages de l'ancien (`champ_id`, `mois`, `stage_id`, `tag`, filtres de champs…) dans `conditions`. Ils ne sont plus visibles nulle part mais le moteur les compare : la règle ne partirait plus jamais. Les défauts du nouveau déclencheur sont aussi écrasés par les anciennes valeurs | Page:491-494 (`{ ...defaut, ...regle.conditions }` ou pas de `conditions` du tout) ; PDecl:154-164 (ne retire que les clés du déclencheur courant) | Régler « Date atteinte » (champ + 7 jours avant), enregistrer. Changer pour « Devis envoyé ». Onglet Réseau : corps du PATCH, puis réponse (`conditions`). Rouvrir le panneau du déclencheur : rien n'est affiché, mais la réponse porte encore `champ_id` |
| S-03 | ★★★ | Lumi remplace le parcours d'une automatisation PUBLIÉE et l'enregistrement automatique l'écrit 3 s plus tard, sans confirmation ; le toast dit « en pause, à publier quand tu es prêt » alors qu'elle est en ligne. Au format d'origine, la carte Lumi reste offerte : Lumi ne reçoit aucun parcours actuel, reconstruit tout, et l'enregistrement de `steps` fait abandonner les actions d'origine (le cas que le bouton « Ajouter » évite exprès) | Page:544-548, 637-639, 1850 (carte affichée sans tester `formatOrigine` ni `is_active`), 2169-2177 (commentaire A-02) | Ouvrir une automatisation publiée, écrire à Lumi « ajoute un texto après 2 jours ». Lire le toast, attendre « Enregistré », recharger : le parcours en ligne a-t-il changé sans question ? Refaire sur une automatisation fournie au format d'origine |
| S-04 | ★★★ | Un refus de VALIDATION du serveur (400 / 422) est traité comme une panne passagère : toast « Enregistrement impossible pour le moment — nouvel essai automatique. (…) » en boucle (3, 6, 12, 24, 48 s), jamais d'issue, et rien d'autre ne s'enregistre pendant ce temps. Cas atteignables sans étape « incomplète » : une attente ajoutée en fin de parcours ; adresse de webhook en `http://` ; attente de plus de 366 jours ou « avant le rendez-vous » de plus de 30 jours ; plus de 10 lignes de conditions ; retrait qui casse une automatisation publiée | Page:1028-1048 (aucune distinction selon le statut) ; `server/lib/automationSequences.ts:259-260` ; `server/lib/validation.ts:833, 1118, 1132` | (a) Ajouter « Attendre » comme dernière étape et attendre 5 s. (b) Ajouter « Appeler un webhook » avec `http://exemple.com`, enregistrer l'étape. (c) Mettre une attente à 900 jours. Observer l'indicateur, les toasts et l'onglet Réseau pendant une minute |
| S-05 | ★★★ | Le brouillon d'un panneau d'étape est jeté sans question par tout ce qui démonte ou réaffecte le panneau, sauf le clic sur une autre carte : « + », « Ajouter », changement d'onglet, « Dupliquer » d'une autre carte, annuler / rétablir, envoi à Lumi | Page:2317 (panneau masqué dès que `ajoutEnCours`), 840 (`setEtapeChoisie` sans garde), 1746 (onglet) ; PEtape:216-221 | Ouvrir un texto, modifier le texte sans enregistrer, puis : cliquer un « + » et refermer le tiroir ; aller sur « Réglages » et revenir ; dupliquer une autre carte. Le texte tapé est-il encore là ? Y a-t-il eu une question ? |
| S-06 | ★★ | Le panneau de réglage du déclencheur se ferme (X, « Annuler ») sans confirmation, même après saisie ; et « Enregistrer » n'a ni état « en cours » ni désactivation (double clic = deux PATCH) | PDecl:206-213, 365-374 | Régler un filtre, cliquer X : perdu sans question ? Double-cliquer « Enregistrer » avec le réseau ralenti : deux requêtes ? deux toasts ? |
| S-07 | ★★ | Deux panneaux de 380 px peuvent s'afficher ensemble (réglage du déclencheur + étape), contrairement au commentaire « un seul à la fois ». Et un « + » cliqué pendant que le panneau du déclencheur est ouvert ne montre rien : le tiroir Actions n'apparaît qu'à la fermeture de ce panneau | Page:2284, 2301, 2317 (la condition du panneau d'étape ne teste pas `reglageDeclencheur` ; celle du tiroir Actions le teste) | Ouvrir une étape, puis cliquer la carte « Quand » : combien de panneaux ? Avec le panneau du déclencheur ouvert, cliquer un « + » : que se passe-t-il, puis en fermant le panneau ? |
| S-08 | ★★★ | Onglet Réglages : chaque changement retire de `settings` toute clé valant `false`, donc aussi `arreter_si_resolu: false` posée par la case du déclencheur → la sortie automatique redevient active sans que personne l'ait demandé | Regl:95-99 (boucle sur toutes les clés) ; PDecl:95-98 (défaut = coché) | Sur « Facture envoyée » (drapeau de sortie actif), décocher « Arrêter si la facture est payée ou annulée », enregistrer. Aller dans Réglages, basculer « Jours ouvrables seulement ». Rouvrir le panneau du déclencheur : la case est-elle recochée ? |
| S-09 | ★★ | Compatibilité contradictoire : avec « Date atteinte » sur un champ date du PIPELINE, le tiroir et le panneau acceptent « Déplacer / Modifier / Assigner l'opportunité », mais le contrôle de publication (éditeur et serveur) juge sur l'entité « client » et les refuse. À l'inverse, « Appel reçu de l'extérieur » offre TOUTES les actions (envoyer la facture, changer le statut du rendez-vous…) | Page:432, PEtape:271 (3e argument `objetRegle`) contre Cat:1418 (pas de 3e argument) ; Cat:1127-1161 (`webhook.received` absent) | « Date atteinte » + champ date du pipeline + étape « Assigner l'opportunité » : le bandeau rouge apparaît-il alors que l'étape s'enregistre sans reproche ? « Appel reçu de l'extérieur » : « Envoyer la facture » est-elle cliquable ? |
| S-10 | ★★ | « Déplacer l'opportunité → Une étape précise » : « L'étape visée » est un champ de TEXTE libre de 40 caractères (il faut taper un identifiant), pas un menu des étapes | Cat:979-982 (`type: 'texte'`) ; PEtape:514-523 (aucune liste d'étapes transmise) | Ajouter l'action sur « Devis envoyé » : que propose « L'étape visée » ? Que se passe-t-il avec « Gagné » tapé en clair (enregistrement, publication, aperçu) ? |
| S-11 | ★★ | Une étape incomplète (webhook sans adresse, étiquette vide, statut de rendez-vous non choisi…) suspend l'enregistrement de TOUT le parcours, y compris des autres modifications ; seul l'indicateur « N étape(s) à compléter » le dit, sans désigner laquelle | Page:984 ; valeurs par défaut absentes pour CHA-15, 24, 31, 33, 38, 39 | Ajouter « Ajouter une étiquette », fermer le panneau sans la remplir, puis modifier trois autres étapes. Recharger (accepter l'alerte du navigateur) : qu'est-ce qui a survécu ? |
| S-12 | ★★ | Supprimer une condition ne garde que la branche « si oui » : la branche « si non » reste dans `steps`, invisible, toujours comptée (limite de 30, étapes « à compléter », problèmes bloquants cliquables vers une carte qui n'existe pas). Même effet en insérant « Arrêter ici » au milieu : la suite disparaît du canevas sans avertissement | Seq:186-202 (`retirerEtape`), 147 (`rattacher` pour `arreter`) ; le dialogue dit « se rebranche tout seul » (Page:886) | Créer une condition avec une action incomplète dans « si non », supprimer la condition : l'indicateur dit-il encore « 1 étape(s) à compléter » sans carte correspondante ? Insérer « Arrêter ici » entre deux étapes : la seconde disparaît-elle ? |
| S-13 | ★★ | Deux onglets sur la même automatisation : aucun contrôle de version, le dernier enregistrement automatique écrase l'autre sans avertir | Srv:556-562 | Ouvrir la même automatisation dans deux onglets, ajouter une étape différente dans chacun, attendre « Enregistré » des deux côtés, recharger |
| S-14 | ★★ | « Voir Autopilot » quitte l'éditeur par `navigate` direct : pas de confirmation « Quitter sans enregistrer ? » ; avec une étape incomplète, le travail est perdu avec un simple toast | Page:1842, 1304-1312 | Forfait sans Lumi, étape incomplète en cours, cliquer « Voir Autopilot » |
| S-15 | ★★ | Une automatisation à la corbeille s'ouvre et se modifie comme une autre (aucun bandeau) ; seul « Publier » est refusé | Srv:178 (pas de filtre `deleted_at`) | Mettre une automatisation à la corbeille, ouvrir son adresse `/automations/<id>` directement, modifier une étape |
| S-16 | ★★ | Modifier le canevas pendant que Lumi construit : la réponse écrase les modifications faites entre-temps, et la pile annuler / rétablir se désynchronise (la fonction d'empilement gardée par l'appel en cours porte une ancienne position) | Page:548 (`memoriser` capturé avant l'attente), 771-781 | Envoyer une demande à Lumi, supprimer une carte pendant « Lumi construit… », puis utiliser Annuler / Refaire plusieurs fois |
| S-17 | ★ | Échap dans le champ du nom n'annule pas : la valeur tapée est gardée et enregistrée. Nom vidé : l'ancien nom revient sans message | Page:1585, 1015 | Renommer, taper n'importe quoi, Échap. Vider le nom, Entrée |

#### Saisie et contrôles

| # | Grav. | Soupçon | Indice dans le code | Geste pour trancher |
|---|---|---|---|---|
| S-18 | ★★ | Attendre : vider le nombre remet l'unité à « minutes » ; à 0, changer l'unité ne fait rien (0 × unité = 0 → « minutes ») ; l'unité saute toute seule (24 heures → « 1 jours ») ; aucune borne (`max=365` indicatif) ; « 1 jours » au singulier | PEtape:176-180, 588-601 | Dans une attente de 3 jours : effacer le 3, taper 5 — obtient-on 5 minutes ? À 0, choisir « jours ». Taper 24 en heures. Taper 9999 |
| S-19 | ★★ | Conditions de champs, valeur numérique : impossible de taper une décimale (« 1. » est converti en 1 et le point disparaît) ; une lettre affiche « NaN » | EdCond:66-67, 108-111 | Filtre sur un champ nombre ou montant : taper `12.5` caractère par caractère ; taper `a` |
| S-20 | ★★ | Zone « Conditions » : une ligne mal formée est ignorée sans aucun message ; la valeur après `=` reste du texte même si c'est un nombre ; le texte montre des noms techniques (`total_cents`, `created_at`) | PEtape:80-110, 688 | Taper `montant 5000` (sans signe), enregistrer, rouvrir : la ligne a-t-elle disparu ? La carte dit-elle « 0 condition(s) » ? |
| S-21 | ★★ | Une condition existante de forme `in` / `not_in` (posée par Lumi ou un préréglage) n'apparaît pas dans la zone de texte ; à la première frappe, les conditions sont réécrites depuis le texte et elle disparaît | PEtape:50-74 (`SIGNES` sans `in`), 716-720 | Trouver ou faire générer par Lumi une condition « est l'un de », ouvrir l'étape, ajouter un espace dans la zone, enregistrer, regarder le PATCH |
| S-22 | ★★ | Select « Quoi faire » : il n'offre que les actions compatibles ; si l'action de l'étape n'en fait plus partie (déclencheur changé, action indisponible), le menu affiche une AUTRE action que celle de l'étape | PEtape:469-494 (la valeur n'est pas dans les options) | Sur « Facture envoyée », ajouter « Envoyer la facture », changer le déclencheur pour « Nouveau prospect », rouvrir l'étape : que montre le menu, que dit le titre du panneau ? |
| S-23 | ★★ | Changer « Quoi faire » vide la configuration sans poser les valeurs par défaut : l'étape devient incomplète, et le texte d'un texto passe tel quel dans un courriel | PEtape:310-321 | Passer un texto en courriel puis revenir |
| S-24 | ★★ | Les boutons de variables ajoutent toujours À LA FIN du premier champ « zone » (jamais au curseur, jamais dans l'objet ou le titre). Toutes les variables sont offertes quel que soit le déclencheur (« Lien facture » sur un devis) — c'est ce que l'alerte attendue de #840 doit rattraper | PEtape:537-543, 559-566 | Placer le curseur au milieu du message, cliquer « Nom du client ». Cliquer dans « Objet » puis sur une variable. Sur « Devis envoyé », insérer « Lien facture » et lancer l'aperçu |
| S-25 | ★★ | Étapes « complètes » qui ne font rien ou font l'inverse de l'attendu : « Assigner un responsable » / « Assigner l'opportunité » sans membre = RETIRE le responsable ; « Retirer une étiquette » sans étiquette ni « toutes » ; « Modifier le client » avec tout vide | Cat:869-880, 821-831, 838-862 | Ajouter « Assigner un responsable », ne rien choisir, enregistrer, publier : aucune alerte ? Que dit l'aperçu ? |
| S-26 | ★ | Option vide des listes : « — Inchangé — » partout, même là où le vide veut dire autre chose (« Pour qui » : toute l'équipe ; « Priorité » d'une tâche neuve ; « Laquelle » : celle-ci ; « Vers » ; « Quand déclencher » ; « Nouveau statut » obligatoire) | Champ:110 ; Cat:756-759, 910-917, 968-975, 1084-1091 | Ouvrir chacun de ces menus et lire la première option à côté de l'aide |
| S-27 | ★ | Champs numériques du déclencheur : bornes seulement indicatives (0 mois, -5 $, 9999 jours acceptés à l'enregistrement) | Champ:119-131 ; PDecl:163 | « Client inactif » avec 0 mois ; « Montant minimum » à -5 ; enregistrer puis publier |
| S-28 | ★ | Bouton « Aperçu » désactivé pendant l'appel sans style visible ; aperçu : seuls les champs « choix » sont traduits, un membre, une étape de pipeline, une automatisation ou un champ peuvent s'afficher en identifiant ; clés brutes pour les champs hors catalogue ; « rien n'est envoyé » écrit deux fois | Page:1694-1695, 2086-2094, 2128-2140 | Aperçu d'un parcours avec « Notifier l'équipe → Un membre précis », « Démarrer une automatisation », « Mettre à jour un champ » |
| S-29 | ★ | Textes par défaut sans accent : « Suivi a faire pour [client_name] », « [client_name] — suivi a faire » | Cat:751, 800 | Ajouter « Notifier l'équipe » et lire le titre proposé |
| S-30 | ★ | Lumi : bouton désactivé sous 10 caractères sans dire pourquoi ; Entrée ne fait alors rien | Lumi:50, 113 | Taper « relance » et appuyer sur Entrée |
| S-31 | ★ | Options archivées d'une liste proposées dans les conditions « est l'un de » (non filtrées, contrairement aux autres saisies) | EdCond:126 contre ChAuto:167 | Archiver une option d'une liste, puis ouvrir un filtre sur ce champ |

#### Affichage, langue, cohérence

| # | Grav. | Soupçon | Indice dans le code | Geste pour trancher |
|---|---|---|---|---|
| S-32 | ★★ | Aucun signe de la pause globale dans l'éditeur : « Publiée » en vert alors que rien ne part | `BandeauPause` absent de l'éditeur | Activer « Tout arrêter » dans la liste, ouvrir une automatisation publiée |
| S-33 | ★★ | Onglet Journaux : le repli « ce qui était configuré » ne peut jamais servir (`action_config` n'est pas dans la requête) ; « Autres détails » affiche des clés et du JSON bruts ; les actions hors des 9 connues s'affichent en clé brute (« ajouter etiquette », « update custom field »…) ; le menu « Action » se réduit à l'action filtrée ; pas de bouton pour réessayer ni rafraîchir ; 200 lignes sans pagination | JApi:77 contre Journ:87-89 ; JApi:272-286 ; Journ:160 | Ouvrir les journaux d'une automatisation avec étiquette / webhook / facture, déplier des lignes, filtrer sur une action puis tenter d'en choisir une autre |
| S-34 | ★ | Onglet Historique : identifiant d'étape brut « (e3) » ; colonne « Étape en cours » vide si le type manque ; filtre sans « En cours » ni « Sauté » ; option EN « All events » pour un statut ; motifs d'échec inconnus affichés tels quels (anglais technique) ; motif de saut en français dans l'interface anglaise | Journ:340, 380-384 ; JApi:290-340 | Parcourir l'historique en FR puis en EN |
| S-35 | ★ | Messages de repli en français seulement dans l'interface anglaise : « Impossible de charger cette automatisation. », « Session expirée. », « Impossible de préparer l'aperçu. », « Lumi n'a pas pu construire ce parcours. », « Membre sans nom » ; refus de validation du serveur sans accents (« doit etre », « depasse ») | Api:68, 103, 119, 142, 383, 411, 502 ; `server/lib/validation.ts:798-854` | Interface en anglais, couper le serveur (réponse non JSON) puis recharger ; provoquer S-04 (b) en anglais et lire le toast |
| S-36 | ★ | Libellés incohérents : onglet « Modifier l'action » et bouton EN « Save action » sur une attente ou une condition ; carte « Si… » contre panneau « Condition » ; branches « si oui / si non » contre aide « suit « alors » » ; « Devis » contre « soumission » (case de sortie, étapes « Soumission envoyée »…) ; « opportunité » contre « Pipeline » (objet des champs) ; « parcours » contre « séquence » (messages du serveur) ; EN « Pick the trigger » contre « Choose the trigger » dans la carte Autopilot ; EN « Contact » contre « client » ; heures « 8 h » et « Back to 8 – 20 » en anglais | PEtape:375, 801 ; Canvas:115, 302-306 ; PEtape:674 ; Cat:112, 972-974 ; Page:1838, 1944 ; Regl:154, 236, 258 | Relire ces écrans côte à côte en FR et en EN |
| S-37 | ★ | Valeur brute possible sous « Quand » : la clé du déclencheur (`payment.failed`…) quand il n'est pas dans le catalogue renvoyé par le serveur (drapeau coupé) ; dans ce cas la carte n'a plus de réglages | Page:1368-1372 | Ouvrir une automatisation sur un déclencheur sous drapeau après avoir coupé le drapeau |
| S-38 | ★ | Cartes peu parlantes : pas de détail pour les actions sans `body` ni `title` (étiquette, webhook, déplacement, champ) ; l'attente « réponse du client » s'affiche comme une attente simple ; « N condition(s) » compte les clés (toutes les conditions de champs = 1) | Canvas:122-147 | Regarder un parcours avec ces étapes sans ouvrir les panneaux |
| S-39 | ★ | Menu « ··· » toujours en haut au centre du canevas, loin de la carte ; se ferme seulement par le voile ; rien n'indique à quelle carte il se rapporte | Page:2032 | Ouvrir le menu d'une carte en bas d'un long parcours |
| S-40 | ★ | Statistiques d'étape : chargées une fois à l'ouverture, pas d'actualisation ; un échec de lecture affiche « Aucun passage encore » | Page:350-359 | Bloquer `/api/automations/rules/stats` dans l'onglet Réseau et ouvrir l'onglet Statistiques |
| S-41 | ★ | Échecs de lecture avalés : membres, étiquettes, étapes de pipeline (« Aucune étape de pipeline. Créez-en… »), services, compteur des clients inactifs — l'écran dit « rien » au lieu de « erreur » | Api:404, 427 ; Page:1403, 1425-1428 ; PDecl:137 | Bloquer les requêtes Supabase correspondantes et ouvrir les menus |

#### Clavier, lecteur d'écran, toucher, petites largeurs

| # | Grav. | Soupçon | Indice dans le code | Geste pour trancher |
|---|---|---|---|---|
| S-42 | ★★ | Aucun raccourci clavier : Ctrl+Z / Ctrl+Y ne font rien sur le canevas ; Échap ne ferme ni tiroir, ni panneau, ni menu, ni aperçu | un seul écouteur global (`beforeunload`) | Supprimer une carte puis Ctrl+Z ; ouvrir tiroir, panneau, menu, aperçu et appuyer sur Échap |
| S-43 | ★★ | À l'ouverture d'un tiroir ou d'un panneau, le focus ne bouge pas (la recherche du tiroir n'a pas le focus) ; le panneau est après tout le canevas dans l'ordre de tabulation ; l'aperçu n'est pas un dialogue (pas de rôle, pas de piège à focus) ; les onglets ont `role="tab"` sans panneau associé ni flèches ; les items désactivés du tiroir sont inatteignables au clavier | Tiroir:107-114 ; Page:1647-1659, 2077-2152 | Tout parcourir à la touche Tab : ajouter une étape et la configurer sans souris |
| S-44 | ★★ | Bouton retour sans nom accessible sous 640 px (le texte est masqué, l'icône est `aria-hidden`) ; écran de chargement sans texte ni rôle | Page:1573-1574, 1508-1510 | Largeur 375 px, inspecter le nom accessible du bouton ; lecteur d'écran pendant le chargement |
| S-45 | ★★ | Déplacement du canevas à la souris seulement (aucun événement tactile) ; avec l'outil main actif, un glisser commencé sur une carte l'ouvre au relâchement ; zoom par boutons seulement ; « Recadrer » remet 100 % sans cadrer le contenu ; à plus de 100 %, la mise à l'échelle depuis le haut-centre peut rendre la partie gauche d'un parcours à branches inatteignable par défilement | Page:1750-1771, 1165-1179 | Écran tactile ou émulation : glisser avec la main active. Zoom 160 % sur un parcours à deux conditions imbriquées : peut-on défiler jusqu'à la branche de gauche ? |
| S-46 | ★★ | Débordements probables : panneaux de droite à largeur fixe 380 px (plus larges qu'un écran de 375 px) ; panneau Lumi en pleine largeur sous 768 px (le canevas disparaît) ; à 768 px, Lumi 340 + panneau 380 = canevas de 48 px ; résumé de Lumi (520 px, centré, sans marge) qui recouvre « Ajouter » ; bandeau rouge sous le bouton « Ajouter » ; pied du panneau d'étape (Supprimer + message + Annuler + Enregistrer) serré ; tableaux à largeur minimale 720 / 860 px. Note : la porte mobile ne s'applique qu'à un vrai téléphone (agent utilisateur + moins de 768 px) ; un navigateur de bureau rétréci montre l'éditeur | PEtape:354 ; Tiroir:82 ; PDecl:192 ; Lumi:150 ; Page:2155, 2186 ; Journ:228, 362 ; `src/lib/mobileGate.ts:60-65` | Fenêtre à 768 px puis 375 px : ouvrir Lumi, puis une étape, puis le tiroir ; lire le pied du panneau avec un problème affiché ; ouvrir Historique et Journaux |
| S-47 | ★ | Info-bulles seules pour montrer le texte d'une variable (`title` = `{{client.cle}}`) : invisibles au toucher et au clavier | ChAuto:338, 348 | Sur écran tactile, deviner ce qu'insère « Client · Type de numéro » |

Vérifié par lecture, rien à signaler : aucun gestionnaire vide (`onClick={() => {}}`) dans les fichiers de la part ; l'interrupteur de publication supporte les clics répétés (file d'envoi) ; le retour arrière du navigateur enregistre au démontage quand c'est possible.

---

### 7. Contrôle de couverture (grep)

Comptage dans les 12 fichiers d'interface de la part. « Brut » = toutes les occurrences du mot (déclarations de propriétés et passages de fonctions compris). « JSX » = attribut réellement posé (`onClick={`…).

| Fichier | onClick brut / JSX | onChange brut / JSX | onSubmit | onKeyDown JSX | onDrag | onMouse* JSX | onBlur JSX | `<Link` | `navigate(` | `<select` | `<input` | `<textarea` | `<button` |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AutomationBuilderPage.tsx | 27 / 26 | 3 / 2 | 0 | 1 | 0 | 4 | 1 | 0 | 5 | 0 | 1 | 0 | 26 |
| SequenceCanvas.tsx | 9 / 6 | 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 |
| PanneauDeclencheur.tsx | 4 / 4 | 9 / 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 4 |
| PanneauEtape.tsx | 7 / 7 | 9 / 9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 2 | 1 | 7 |
| ChampAction.tsx | 0 / 0 | 26 / 12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 6 | 5 | 1 | 0 |
| TiroirChoix.tsx | 2 / 2 | 1 / 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 2 |
| ClavardageLumi.tsx | 2 / 2 | 1 / 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 2 |
| OngletReglages.tsx | 2 / 2 | 6 / 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 2 |
| OngletJournaux.tsx | 1 / 1 | 3 / 3 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 |
| InterrupteurPublication.tsx | 1 / 1 | 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| champs/automatisations.tsx | 2 / 2 | 35 / 13 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 5 | 1 | 2 |
| champs/EditeurConditions.tsx | 3 / 3 | 15 / 10 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 4 | 0 | 3 |
| **Total** | **60 / 56** | **108 / 59** | **0** | **3** | **0** | **4** | **1** | **0** | **5** | **23** | **19** | **4** | **53** |

Sites de contrôle dans le code : 53 `<button` + 23 `<select` + 19 `<input` + 4 `<textarea` = 99, plus 2 sélecteurs de date, 1 bloc `details` et 1 ligne de tableau cliquable = 103.

Rapprochement avec l'inventaire (§ 2), par fichier — chaque site est rattaché à au moins une ligne :

| Fichier | Sites dans le code | Lignes d'inventaire qui les couvrent |
|---|---|---|
| AutomationBuilderPage.tsx | 26 boutons + 1 champ + 4 gestionnaires souris + 5 `navigate(` | EDT-001 à 031, 043 à 055 (les onglets = 1 site pour 4 lignes ; les pastilles = 1 site pour 4 lignes ; le menu = 1 site pour 4 lignes). `navigate(` : Page:168 (E09), 607 (EDT-139), 654 (E39), 1365 (EDT-004), 1842 (EDT-023) |
| SequenceCanvas.tsx | 4 boutons | EDT-032 (carte Quand), EDT-033 à 036 (« + »), EDT-037 à 041 (carte), EDT-042 (« ··· ») |
| PanneauDeclencheur.tsx | 4 boutons + 1 case | EDT-064, 065, 073, 074, 071 (+ EDT-066 à 070 pour les composants importés) |
| PanneauEtape.tsx | 7 boutons + 3 selects + 2 champs + 1 zone | EDT-100 à 104, 109 à 114, 118 à 125, 128 à 130 |
| ChampAction.tsx | 6 selects + 5 champs + 1 zone | EDT-075 à 086 (12 lignes pour 12 sites) |
| TiroirChoix.tsx | 2 boutons + 1 champ | EDT-056 à 063 |
| ClavardageLumi.tsx | 2 boutons + 1 zone + 1 `onKeyDown` | EDT-134 à 138 |
| OngletReglages.tsx | 2 boutons (dont l'interrupteur, utilisé 3 fois) + 3 selects | EDT-141 à 147 |
| OngletJournaux.tsx | 3 selects + 1 ligne cliquable + 1 `onKeyDown` | EDT-148, 150 à 153 |
| InterrupteurPublication.tsx | 1 bouton | EDT-018 |
| champs/automatisations.tsx | 4 selects + 5 champs + 1 zone + 2 boutons + 1 `details` | EDT-066, 067, 105 à 107, 115 à 117 |
| champs/EditeurConditions.tsx | 4 selects + 4 champs + 3 boutons + 2 sélecteurs de date | EDT-087 à 099 (13 lignes pour 13 sites) |

`onSubmit`, `onDrag*`, `<Link` : 0 partout (aucun formulaire HTML, aucun glisser-déposer de cartes, aucun lien de routeur dans l'éditeur). `onKeyDown` : 3 (nom, champ de Lumi, ligne de journal) ; plus l'écouteur Échap du dialogue de confirmation (Confirm:96-101).

Totaux de l'inventaire : 166 lignes EDT (dont 2 « attendues » par #840), 27 toasts de référence, 28 déclencheurs, 21 actions, 40 champs d'action, 15 champs propres aux déclencheurs + 2 filtres d'étiquettes communs, 4 types d'étape, 3 modes et 3 unités d'attente, 6 signes de condition en texte, 20 opérateurs de conditions de champs en 6 familles, 6 variables « client », 90 variables système, 47 soupçons.

---

# Partie 3 — Routes, points d'entrée, API, rôles, Lumi, envois

Carte de tout ce qui RELIE la section « Automatisations » au reste de Lume, tirée du code du dépôt `D:/lume-uiaudit/wt` (commit `c402ad57`, lecture seule, rien exécuté). Sert de checklist pour la tournée navigateur et les tests par rôle (y compris appels API directs).

Conventions : chemins relatifs à la racine du dépôt, `fichier:ligne`. « introuvable » = cherché, pas trouvé dans le code. Les clés de permission n'existent qu'en deux exemplaires pour ce module : `automations.read` et `automations.update` (`src/lib/permissions.ts:74`). Il n'y a **ni** `automations.create` **ni** `automations.delete`.

---

### 1. Routes et garde-fous

#### 1.1 Routes du client (src/App.tsx)

| Route | Composant | Permission (`Gated`) | Forfait (`PlanFeatureGate`) | Enveloppe | Source |
|---|---|---|---|---|---|
| `/automations` | `Automations` (lazy, `App.tsx:104`) | `automations.read` | `includes_automations` | `PageWrapper` | `src/App.tsx:1654` |
| `/automations/apercu` | `AutomationsApercu` | `automations.read` | `includes_automations` | `PageWrapper` | `src/App.tsx:1663` |
| `/automations/reglages` | `AutomationsReglages` | `automations.update` | `includes_automations` | `PageWrapper` | `src/App.tsx:1664` |
| `/automations/:id` | `AutomationBuilderPage` (plein écran, sans `PageWrapper`) | `automations.update` | `includes_automations` | aucune | `src/App.tsx:1668` |
| `/automations/nouvelle` (+ `?lumi=1`) | même route `:id`, `id = "nouvelle"` | `automations.update` | idem | aucune | navigation depuis `src/pages/Automations.tsx:767` |
| `/automations/hub` | `<Navigate to="/automations" replace />` | aucune | aucune | — | `src/App.tsx:1669` |
| `/automations/builder` | `<Navigate to="/automations" replace />` | aucune | aucune | — | `src/App.tsx:1670` |

Notes :
- `/automations/apercu` et `/automations/reglages` sont déclarées AVANT `/automations/:id` pour ne pas être prises pour un identifiant (`src/App.tsx:1661-1662`). `hub` et `builder` sont déclarées APRÈS `:id` (`1669-1670`) ; React Router v6 classe les segments statiques avant les dynamiques, donc la redirection devrait gagner — **à vérifier dans le navigateur**.
- **Garde interne en plus de la route** : la page `Automations` enveloppe TOUT son contenu dans `<PermissionGate permission="automations.update">` (`src/pages/Automations.tsx:1219` → `2228`), alors que la route et la barre latérale exigent `automations.read`. `AutomationsApercu` s'enveloppe en `automations.read` (`src/pages/AutomationsApercu.tsx:83`), `AutomationsReglages` en `automations.update` (`src/pages/AutomationsReglages.tsx:65`). Voir soupçon S-01.
- `PublicRoutes` / `TokenRoutes` : aucune route d'automatisation (grep sans résultat dans `src/routes/PublicRoutes.tsx` et `src/routes/TokenRoutes.tsx`). Deux pages par jeton sont des DESTINATIONS de messages d'automatisation : `/reserver/:token` (`src/routes/TokenRoutes.tsx:30`, lien « Client inactif ») et `/survey/:token` (`TokenRoutes.tsx:22`, lien d'avis construit dans `server/lib/actions/index.ts:721-738`).
- Hors session, une route de l'app est renvoyée vers `/auth?next=<chemin>` ; `next` n'est honoré que s'il est interne (`src/lib/routesSansSession.ts:43-61`).

#### 1.2 Ce qui s'affiche quand une garde refuse

| Garde | Pendant le chargement | Refus | Source |
|---|---|---|---|
| `Gated` → `PermissionGate` | `null` (page vide) | Icône bouclier + « Accès restreint » / « Access Restricted » + « Vous n'avez pas la permission de voir cette page. Contactez votre administrateur si vous croyez que c'est une erreur. » / « You don't have permission to view this page. Contact your administrator if you believe this is an error. » | `src/components/PermissionGate.tsx:26-45`, `:49` |
| `PlanFeatureGate` (forfait sans la fonction) | spinner + « Chargement… » / « Loading… » (sr-only) | 🔒 « Fonctionnalité premium » / « Premium feature » + « Passez à un forfait supérieur pour accéder à cette section. » / « Upgrade your plan to access this section. » + bouton « Voir les détails » / « See details » ; la modale `PlanUpgradeModal` s'ouvre TOUTE SEULE au montage | `src/components/PlanFeatureGate.tsx:29-33`, `:40-47`, `:69-99` |
| `PlanFeatureGate` (bloqué par la plateforme, Creator Space) | idem | 🔒 « Fonctionnalité désactivée » / « Feature disabled » + « …désactivée pour votre espace de travail. Contactez le support Lume… » ; pas de modale | `src/components/PlanFeatureGate.tsx:52-67` |

Ordre : `Gated` est à l'extérieur, `PlanFeatureGate` à l'intérieur. Un membre sans permission sur un forfait sans automatisations voit donc « Accès restreint », jamais l'offre de forfait. Le propriétaire passe toujours `PermissionGate` (`PermissionGate.tsx:55`).

Modale de forfait pour `includes_automations` : titre « Automatisations » / « Automations », accroche « Mettez vos tâches répétitives en pilote automatique » / « Put your busywork on autopilot » (`src/components/PlanUpgradeModal.tsx:131-143`). Repli côté client quand la colonne manque : `includes_automations = slug !== 'starter'` (`src/lib/billingApi.ts:136-138`).

#### 1.3 Téléphone (« porte mobile »)

- `afficherPorteMobile(pathname)` = chemin non public **ET** `estTelephone()` (`src/lib/mobileGate.ts:78-81`).
- `estTelephone()` exige les DEUX : `userAgent` qui matche `/iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry/i` **et** `window.innerWidth < 768` (`src/lib/mobileGate.ts:69-75`). `iPad` est volontairement exclu.
- `/automations` n'est pas dans `CHEMINS_PUBLICS` (`src/lib/mobileGate.ts:26-41`). Sur un vrai téléphone (< 768 px), `/automations` et toutes ses sous-routes sont donc **remplacées** par `MobileAppGate`, AVANT même l'écran de connexion (`src/App.tsx:712-724`). Texte de la porte en français seulement, codé en dur : « Le bureau sur l'ordi. Le terrain dans l'app. » (`src/pages/MobileAppGate.tsx:63-73`) ; liens de magasin tous `null` (`MobileAppGate.tsx:33-37`).
- Fenêtre d'ordinateur rétrécie sous 768 px (UA non mobile) ou tablette : l'app est **servie normalement** ; seul le tiroir de navigation passe en mode téléphone (`estEcranEtroit()` = `matchMedia('(max-width: 767px)')`, `src/App.tsx:313-315`).
- `/apercu-mobile` affiche la porte à la demande, sans compte (`src/App.tsx:693-698`).
- Pour tester l'interface étroite des automatisations il faut donc un viewport < 768 px **avec un UA d'ordinateur** ; un UA de téléphone ne montrera que la porte.

#### 1.4 Autres effets d'interface liés à la route

- La carte « Setup » ne s'affiche pas sur `/automations*` (`src/components/SetupChecklist.tsx:26-39`).
- Le bouton d'aide flottant est retiré sur `/automations/<id>` (éditeur plein écran), sauf `apercu`, `reglages`, `builder`, `hub` (`src/components/SupportFAB.tsx:33-34`).

---

### 2. Points d'entrée ailleurs dans l'app

Obtenu par `grep -rn "automations\|automation_rules\|automatisation" src` (713 occurrences, 98 fichiers), hors pages et composants Automatisations.

| ID | Où | Élément | Libellé FR / EN | Ce qu'il fait | Visible si | Source |
|---|---|---|---|---|---|---|
| EXT-001 | Barre latérale, section « Plus » | Item de menu (icône Zap) | « Automatisations » / « Automations » (`t.workflows.title`, `src/i18n/fr.ts:1842`, `en.ts:1850`) | `navigate('/automations')` | `automations.read` (ou propriétaire) ET forfait `includes_automations` ; pendant le chargement du forfait l'item est MONTRÉ ; un override plateforme prime | `src/App.tsx:1145`, filtre `canSee` `src/App.tsx:1053-1079` |
| EXT-002 | Palette de commandes | Commande de navigation | « Automations » dans les DEUX langues (codé en dur) ; mots-clés `automations workflows` | `navigate('/automations')` | Toujours (aucun test de permission ni de forfait, contrairement à Factures/Paiements/Insights) | `src/components/CommandPalette.tsx:103` |
| EXT-003 | Recherche globale | Commande tapée | Suggestion « Open automations » (anglais seulement), sous-titre `workflows / automations` | `automations` + Entrée → `/automations` ; `workflows` n'est PAS dans la table exacte (suggestion seulement) | Toujours ; aucun alias français (« automatisations » ne matche pas) | `src/lib/searchParsing.ts:47`, `:65`, `:220-229`, `:247-254` ; `src/components/GlobalSearch.tsx:255-266`, `:349-353` |
| EXT-004 | Réglages, menu de gauche, groupe « Communication » | Bouton (icône Zap) | « Automatisations » / « Automations » (`t.settings.automations`, `fr.ts:683`, `en.ts:682`) | `navigate('/automations')` ; jamais surligné (`external`) | Toujours (pas de filtre de permission sur cet item) | `src/pages/settings/SettingsLayout.tsx:95`, `:203-208` |
| EXT-005 | Réglages → Lume Payments, carte « Notifications » | Lien `<a href>` (rechargement complet de la page) | Ligne « Reçu automatique au client » / « Automatically email receipts to clients », description « Règle « facture payée » des automatisations. » ; lien « Automatisations » / « Automations » | `href="/automations"` | Page gardée `settings.read` (`src/App.tsx:1616`) | `src/pages/PaymentSettings.tsx:202-206` |
| EXT-006 | Réglages → Modèles de courriel | Carte-lien | « Les relances automatiques », « N relances automatiques », « Soumissions, factures, rendez-vous, avis — chacune avec son délai », bouton « Ouvrir » (français seulement dans le code) | `<Link to="/automations">` | Page gardée `settings.update` (`src/App.tsx:1621`) | `src/pages/settings/EmailTemplatesSettings.tsx:407-427`, visite guidée `:455-458` |
| EXT-007 | Réglages → Messagerie SMS | Section « Textos automatiques » / « Automatic texts » | « Ce que Lume texte à vos clients… N automatisation(s) active(s). » ; interrupteur par règle ; zone de texte (max 320) ; « Annuler » / « Enregistrer » | Lit `automation_rules` en direct (supabase-js) ; interrupteur → `POST /api/automations/rules/:id/publication` ; texte → UPDATE direct PostgREST | Seulement si le bureau a un numéro (`channel?.phone_number`) ; page gardée `settings.read` (`src/App.tsx:1619`) ; seules les règles dont le déclencheur est dans 5 groupes sont listées | `src/pages/SettingsMessaging.tsx:358`, `:397-403`, `:465-600` |
| EXT-008 | Réglages → Avis clients | Section « Automatisations liées » / « Related automations » | « Demande d'avis » / « Review request », « Rappel d'avis » / « Review reminder », interrupteur, « Modifier » / « Edit », « Enregistrer le SMS » / « Save SMS » ; lien « Réglages → Messagerie SMS » | Interrupteur → route de publication ; texte → UPDATE direct ; l'interrupteur général des avis publie / dépublie les règles d'avis | Page gardée `settings.update` (`src/App.tsx:1620`) | `src/pages/SettingsReviews.tsx:273-294`, `:296-305`, `:654-742` |
| EXT-009 | Réglages → Entreprise | Sélecteur « Langue de vos clients » / « Your clients' language » | « Les courriels, textos, soumissions, factures et pages que reçoivent vos clients… » | Écrit `company_settings.default_language`, lue par les automatisations | Page gardée `settings.update` (`src/App.tsx:1608`) | `src/pages/CompanySettings.tsx:610-625` |
| EXT-010 | Réglages → Bureaux, carte « Santé des bureaux » | Ligne « Automatisations » + bouton | État « N actives » / « aucune active » ; « Ouvrir les automatisations » / « Open automations » | `navigate('/automations')`, ou `switchCompany(bureau)` + `window.location.assign('/automations')` | Carte visible à partir de 2 bureaux ; l'API `GET /api/orgs/offices/sante` est réservée aux propriétaires | `src/components/offices/SanteBureauxCard.tsx:68-71`, `:115`, `:126-128` ; `server/lib/office-health.ts:106-108` ; `server/routes/orgs.ts:243-250` |
| EXT-011 | Réglages → Bureaux (nouveau bureau, fermeture) | Textes | « Modèles, rôles, champs personnalisés et automatisations » ; « …ses automatisations, récurrences, rappels et rapports programmés s'arrêtent… » ; « N automatisation(s) arrêtée(s) » | Création d'un bureau = copie / semis des automatisations ; fermeture = arrêt | — | `src/pages/OfficeNew.tsx:154-157`, `src/pages/settings/OfficesSettings.tsx:59-70` |
| EXT-012 | Pipeline → réglages d'un pipeline, détail d'une étape | Lien | « Ouvrir les automatisations » / « Open automations » | `<Link to="/automations">` | Dans la ligne dépliée d'une étape ; pas de test de permission dans l'extrait | `src/components/pipeline/ghl/PipelineDetail.tsx:282-288` |
| EXT-013 | Pipeline, actions en lot sur les étiquettes | Texte de confirmation | « …Les automatisations « Étiquette ajoutée » partiront pour chaque client. » / « "Tag added" automations will run for each client. » | Avertit avant de déclencher | — | `src/components/pipeline/PipelineBoard.tsx:1401-1405` |
| EXT-014 | Pipeline, suppression d'un pipeline / d'une étape | Texte | « …Aucune automatisation ne sera déclenchée. » / « No automation will run. » | Information | — | `src/components/pipeline/ghl/ActionsPipeline.tsx:123-124`, `:198-199` |
| EXT-015 | Fiche d'un deal (tiroir) | Section « Relances automatiques » / « Automated follow-ups » ; acteur « Automatisation » / « Automation » dans l'historique | — | Lit `rpc('relances_du_deal')` (pas la table des journaux) | Section montrée si au moins une relance | `src/components/pipeline/DealDrawer.tsx:1270-1272`, `:1994`, `:2020-2023` ; `src/lib/pipelineVentesApi.ts:340-356` |
| EXT-016 | Fiche client, champ « Étiquettes » | Sélecteur d'étiquettes | (libellé `t.clientDetails.tags`) | Écrit `client_tags` puis `POST /api/automations/events/client-tagged` ou `client-untagged` | — | `src/pages/ClientDetails.tsx:803-811` ; `src/lib/etiquettesApi.ts:75`, `:82` |
| EXT-017 | Jobs / calendrier (déplacer une visite, terminer un job) | Appels silencieux | — | `POST /api/automations/events/appointment-rescheduled`, `…/job-completed` | — | `src/lib/jobsApi.ts:300`, `:304`, `:1238` ; `src/lib/scheduleApi.ts:340` |
| EXT-018 | Tâches (marquer terminée, une ou en lot) | Appel silencieux | — | `POST /api/automations/events/task-completed` | — | `src/lib/tasksApi.ts:198`, `:232` |
| EXT-019 | Ancien pipeline (`pipelineApi`) | Appel silencieux | — | `POST /api/automations/events/deal-stage-changed` | Importé seulement par `leadsApi.ts`, `mapLeadToJobDraft.ts`, `types.ts` | `src/lib/pipelineApi.ts:398`, `:452` |
| EXT-020 | Aide (tiroir d'aide et page Support) | Article « Comment fonctionnent les automatisations ? » / « How do automations work? » + bouton « aller à la page » (`ts.goToPage`) | voir texte | `navigate('/automations')` | — | `src/components/supportArticles.ts:122-128` ; `src/components/SupportDrawer.tsx:265-271` ; `src/components/SupportPage.tsx:111-117` |
| EXT-021 | Aide, autres articles | Textes | « …configurer une relance automatique dans Automatisations… » ; « La langue des messages envoyés à vos clients se règle à part, dans Automatisations. » | Renvoi textuel | — | `src/components/supportArticles.ts:166-167`, `:238-239` |
| EXT-022 | Clavardage de support (assistant) | Routes citées rendues en liens | — | Toute route `/automations…` citée par l'assistant devient un lien | — | `src/components/SupportChat.tsx:46-47` ; connaissance de l'assistant : `server/lib/support/carte-app.ts:94` |
| EXT-023 | Lumi (page `/lumi`), carte d'autorisation d'une optimisation de journée | Avertissement | « N automatisation(s) préviennent les clients d'un rendez-vous déplacé : chaque client concerné recevra cet avis. » | Information avant confirmation | Si `automatisations_avis > 0` | `src/components/lumi/CarteAutorisation.tsx:255-260` |
| EXT-024 | Bandeau global « données importées non activées » | Texte | « Les automatisations ne sont pas activées tant que les données n'ont pas été activées dans Migrations. » / « Automations stay off until the data has been activated in Migrations. » | Lien vers `/creator-space/migrations` | Bureau importé et gelé | `src/components/BandeauDonneesNonActivees.tsx:45-58`, `:118` |
| EXT-025 | Cloche de notifications | Notification `automation_failed` | Titre « Échec d'envoi — <nom> », corps « Le texto/courriel n'est pas parti et ne partira pas : <cause>. » (français seulement) | Aucune navigation au clic (la cloche n'a que « tout lire », fermer, ignorer) | Créée par le moteur, sans `user_id` | `server/lib/automationEngine.ts:1505-1531` ; `src/components/NotificationBell.tsx:137`, `:163`, `:167`, `:198` |
| EXT-026 | Onboarding (création du compte) | Aucun élément visible | — | `createWorkspace` → serveur `seedOrgComplete` → `ensureAutomationPresets(admin, orgId, { activateAll: true })` ; plus le trigger SQL `trg_org_created_seed_automations` | — | `src/pages/OnboardingFlow.tsx:343-349` ; `server/routes/onboarding.ts:37`, `:86`, `:123-129` ; `server/lib/seedOrgDefaults.ts:257` ; `server/lib/automationPresetSeeder.ts:4-14` |
| EXT-027 | Site public (marketing) | Menu « Fonctionnalités », ancre | (`m.featureItems.automation`) | `/features#automation` | Public | `src/components/marketing/Header.tsx:29` ; `src/pages/marketing/Features.tsx:123` |
| EXT-028 | Console des migrations (Creator Space) | Confirmation « Activer le compte » / « Geler à nouveau » | « …courriels, SMS, automatisations, rappels, demandes d'avis… sont gelées depuis l'import… » | Lève / pose le gel des communications | Équipe Lume | `src/pages/AdminMigrations.tsx:598-607`, `:1154` |

Introuvables (cherchés) :
- **Tableau de bord / page du jour** : aucun lien ni widget vers les automatisations (grep sans résultat dans `src/pages/Dashboard*.tsx`, `src/pages/Day*.tsx`).
- **Fiche client** : aucun lien vers `/automations` ni liste des automatisations en cours pour ce client ; seule l'étiquette agit (EXT-016).
- **Carte de mise en route** (`SetupChecklist`) : aucun item « automatisations » ; elle se masque seulement sur ces pages (§1.4).
- **Notification menant à l'automatisation fautive** : la notification d'échec ne porte aucun lien (EXT-025).

---

### 3. API serveur

#### 3.1 Gardes transversales (dans l'ordre d'exécution)

1. **CSRF** par en-tête (`server/index.ts:293-323`) : un POST sans `Authorization`, sans `X-Requested-With` et sans `Content-Type: application/json` reçoit `403 { error: 'CSRF check failed — missing required headers' }`. `/hooks/<64 hex>` est exempté (`server/index.ts:309`).
2. **`/api/hooks/:cle`** est monté AVANT `express.json()` et avant toutes les gardes suivantes (`server/index.ts:385`).
3. **Limiteurs** : `/api/automations/events` 30/min par utilisateur (`server/index.ts:653`, `:703`) ; `/api/automations/rules` 300/min en lecture, 120/min en écriture, 30/min pour `/generer` (`server/index.ts:666-673`, `:705`). Les autres préfixes (`/api/automations/folders`, `/webhooks`, `/pause`, `/templates`, `/editeur`, `/test`, `/bureaux-cibles`) n'ont pas de limiteur dédié ; un limiteur global existe d'après `server/routes/webhooks-entrants.ts:70-72`, non relevé ici.
4. **RBAC** `rbacMiddleware()` (`server/index.ts:816`, `server/lib/route-permissions.ts:493-545`) : cherche `MÉTHODE chemin` dans `ROUTE_PERMISSIONS` (correspondance EXACTE, avec remplacement des segments UUID / numériques / > 10 caractères par `:id` etc., `route-permissions.ts:424-447`). Trouvé → authentifie, puis `403 { error: 'Permission denied: <clé> or <clé>' }` si refus, `403 { error: 'No active membership found.' }` sans adhésion. **Pas trouvé → la requête continue sans contrôle de permission** (`route-permissions.ts:521-522`). Messages de refus : `:531`, `:540`.
5. **Paywall** `subscriptionGuard()` (`server/index.ts:820`) : `402 { error: 'subscription_required', reason }` (`server/lib/subscription-guard.ts:234-238`).
6. **Forfait** `featureGuard()` (`server/index.ts:825`) : préfixes `/api/automations/` et `/api/reminders/` → drapeau `includes_automations` (`server/lib/feature-guard.ts:64-69`). Mode par défaut **`log`** (laisse passer et journalise) ; `enforce` → `403 { error: 'feature_not_in_plan', feature, plan }` (`feature-guard.ts:49-52`, `:196-204`). Fail-open si le forfait est illisible.
7. **Authentification** des handlers : `requireAuthedClient` (`server/lib/supabase.ts:197-233`) — `401 { error: 'Missing authorization header.' }` ; le bureau vient de l'en-tête `x-org-id` (vérifié contre les adhésions), sinon du premier bureau. Le client rendu est celui de l'UTILISATEUR (RLS active) sauf mention « service_role ».
8. **Langue des erreurs** : `repondreDansLaLangue` traduit `error` en anglais quand `Accept-Language` commence par `en` (`server/lib/automations-langue.ts:31-34`, `:107-129`), pour `automation-rules.ts:60` et `automation-publication.ts:21` seulement. `automation-stats.ts`, `automation-test.ts`, `automation-events.ts` ne l'utilisent pas.
9. **Validation** : `validate(schema)` → `400 { error: '<messages joints par ; >', details }` (`server/lib/validation.ts:28-41`).

Abréviations du tableau : **JWT** = `requireAuthedClient` ; **RBAC** = entrée de `server/lib/route-permissions.ts` (ligne citée) ; **RLS** = policy Postgres appliquée parce que le handler utilise le client de l'utilisateur ; **svc** = client `service_role` (RLS contournée).

#### 3.2 `server/routes/automation-rules.ts`

| Méthode | Chemin | Ce qu'elle fait | Auth | Permission (clé, où) | Validation d'entrée | Filtre de bureau | Codes et messages |
|---|---|---|---|---|---|---|---|
| GET | `/api/automations/rules` | Règles du bureau (corbeille comprise, hors `purged_at`) + catalogue offert (`:118-142`) | JWT | `automations.read` — RBAC `:116` + RLS SELECT | aucune | `.eq('org_id', auth.orgId)` `:125` + RLS | 500 « Impossible de lire les automatisations. » |
| GET | `/api/automations/editeur?rule_id=` | Une règle + catalogue + liste (id, nom) des autres règles publiées (`:168-198`) | JWT | `automations.read` — RBAC `:120` + RLS | `rule_id` testé par regex `^[0-9a-f-]{36}$` ; invalide → `rule: null` (200) | `.eq('org_id', auth.orgId)` `:178`, `:183` ; hors `purged_at`, mais une règle à la corbeille est renvoyée | 500 « Impossible de lire l'automatisation. » |
| POST | `/api/automations/rules` | Crée une règle (`is_preset: false`, `preset_key: null`, en pause par défaut) (`:213-263`) | JWT | `automations.update` — RBAC `:125` + RLS INSERT | `automationRuleCreateSchema` (`validation.ts:1321`) : `name` 1-120, `description` ≤ 500, `trigger_event` du catalogue, `conditions` ≤ 10, `delay_seconds` de −30 j à +1 an, `actions` 1-20 (5 max sans `steps`), `steps` ≤ 30 étapes sans boucle, `settings` strict (fenêtre 7 h-22 h), `folder_id` uuid ; puis `verifierCoherence` (`:72-114`) et, si `is_active: true`, `problemesBloquants` | `org_id: auth.orgId` imposé à l'insertion `:233` ; dossier vérifié dans le bureau `:207-211`, `:216` | 400 « Dossier introuvable dans ce bureau. » ; 400 message de cohérence (délai négatif, « Deux actions identiques… ») ; 422 `{ code: 'publication_refusee', problemes }` ; 403 « Votre rôle ne permet pas de créer une automatisation. » (Postgres 42501) ; 500 « Impossible de créer l'automatisation. » ; 201 |
| POST | `/api/automations/rules/generer` | Lumi propose un parcours ; n'enregistre que la conversation dans `lumi_conversation` (`:310-482`) | JWT | `automations.update` — RBAC `:137` ; pas de RLS sur la génération (appel modèle + budget en svc `:356`) | Pas de Zod : `demande` ≥ 10 caractères, `langue` fr/en, `echanges` (6 derniers, rôles user/assistant), `parcours_actuel`, `rule_id` (regex uuid) ; le résultat repasse par `sequenceEtapes`, `trouverDeclencheur`, `refAutomatisationInventee` | Budget et journal par `auth.orgId` ; lecture / écriture de la conversation `.eq('org_id', auth.orgId)` `:447`, `:468` | 400 « Décris ton automatisation en une phrase. » ; 422 `{ error, sans_lumi, brouillon_retire }` (refus Lumi, forfait sans Lumi, budget atteint, parcours invalide, déclencheur inexistant, automatisation liée inventée) ; 200 `{ nom, trigger_event, resume, steps, autre }` |
| PATCH | `/api/automations/rules/:id` | Modifie ; détache une copie liée ; propage aux copies des autres bureaux (`:486-583`) | JWT | `automations.update` — RBAC `:126` + RLS UPDATE | `automationRuleUpdateSchema` (`validation.ts:1360-1378`) : sous-ensemble non vide, seules les clés envoyées ; clés inconnues retirées par Zod | `.eq('org_id', auth.orgId)` à la lecture `:497` et à l'écriture `:560` ; pas de filtre `deleted_at` / `purged_at` | 400 « Dossier introuvable dans ce bureau. » ; 404 « Automatisation introuvable. » ; 400 « Le déclencheur d'une automatisation fournie ne se change pas. Dupliquez-la… » ; 400 cohérence ; 422 `publication_refusee` ; 422 `publiee_cassee` ; 403 « Votre rôle ne permet pas de modifier une automatisation. » ; 500 |
| GET | `/api/automations/templates` | Catalogue global des modèles (lecture seule, `Cache-Control: private, max-age=300`) (`:592-597`) | JWT | `automations.read` — RBAC `:129` | aucune | aucun (données globales) | — |
| POST | `/api/automations/templates/utiliser` | Crée UNE règle en brouillon depuis un modèle ; idempotence 10 min par en-tête `Idempotency-Key` (`:608-686`) | JWT | `automations.update` — RBAC `:130` + RLS INSERT | `automationModeleUtiliserSchema` : `templateId` 1-80, `^[a-z0-9_]+$`, strict (`validation.ts:1348-1350`) | `org_id: auth.orgId` `:648` ; clé d'idempotence préfixée par le bureau `:616` | 404 « Modèle introuvable. » ; 403 « Votre rôle ne permet pas de créer une automatisation. » ; 500 « Impossible de créer l'automatisation. » ; 201 |
| POST | `/api/automations/rules/:id/duplicate` | Copie en brouillon, suffixe « (copie) » / « (copy) » (`:690-739`) | JWT | `automations.update` — RBAC `:128` + RLS | aucune (pas de corps) | `.eq('org_id', auth.orgId)` `:698` ; `org_id` imposé `:710` ; pas de filtre corbeille | 404 « Automatisation introuvable. » ; 403 ; 500 « Impossible de dupliquer l'automatisation. » ; 201 |
| DELETE | `/api/automations/rules/:id` | Annule les tâches `pending` (svc), puis met à la corbeille (`deleted_at`, `is_active: false`) (`:743-822`) | JWT | `automations.update` — RBAC `:127` + RLS UPDATE sur la règle ; l'annulation des tâches passe en **svc** `:784-790` | aucune | `.eq('org_id', auth.orgId)` partout `:751`, `:789`, `:811` | 404 ; 400 « Une automatisation fournie ne se supprime pas — désactivez-la, l'effet est le même. » ; 500 « Impossible d'annuler les envois déjà prévus. » ; 403 « Votre rôle ne permet pas de supprimer une automatisation. » ; 500 ; 200 `{ ok: true }` |
| POST | `/api/automations/rules/:id/restaurer` | Sort de la corbeille, en brouillon (`:832-856`) | JWT | `automations.update` — RBAC `:150` + RLS | aucune | `.eq('org_id', auth.orgId)` `:840` | 403 « Votre rôle ne permet pas de restaurer une automatisation. » ; 500 ; 404 « Automatisation introuvable dans la corbeille. » |
| DELETE | `/api/automations/rules/:id/definitivement` | Pose `purged_at` (pas un vrai DELETE) sur une règle déjà à la corbeille (`:869-892`) | JWT | `automations.update` — RBAC `:152` + RLS | aucune | `.eq('org_id', auth.orgId)` `:877` | 403 ; 500 « Impossible de supprimer définitivement l'automatisation. » ; 404 ; 200 `{ ok: true }` |
| GET | `/api/automations/folders` | Liste des dossiers (`:903-919`) | JWT | `automations.read` — RBAC `:153` + RLS | aucune | `.eq('org_id', auth.orgId)` `:910` | 500 « Impossible de lire les dossiers. » |
| POST | `/api/automations/folders` | Crée un dossier (`:921-945`) | JWT | `automations.update` — RBAC `:154` + RLS | `dossierCreateSchema` : `name` 1-60 (`validation.ts:1509-1511`) | `org_id: auth.orgId` `:927` | 409 « Un dossier porte déjà ce nom. » ; 403 « Votre rôle ne permet pas de créer un dossier. » ; 500 ; 201 |
| PATCH | `/api/automations/folders/:id` | Renomme (`:947-967`) | JWT | `automations.update` — RBAC `:155` + RLS | `dossierUpdateSchema` | `.eq('org_id', auth.orgId)` `:955` | 409 ; 403 « …renommer un dossier. » ; 404 « Dossier introuvable. » (PGRST116) ; 500 |
| DELETE | `/api/automations/folders/:id` | Supprime (vrai DELETE ; les règles reviennent à la racine) (`:969-992`) | JWT | `automations.update` — RBAC `:156` + RLS DELETE | aucune | `.eq('org_id', auth.orgId)` `:980` | 403 ; 500 ; 404 « Dossier introuvable. » ; 204 |
| GET | `/api/automations/bureaux-cibles` | Bureaux de la même entreprise où la personne a `automations.update` (`:997-1006`) | JWT | `automations.update` — RBAC `:135` ; contrôle par bureau cible `hasPermission(ctx, 'automations.update')` en svc (`server/lib/automatisations-bureaux.ts:121-137`) | aucune | Adhésions actives de l'utilisateur, même `company_group` | 500 « Impossible de lister vos bureaux. » |
| POST | `/api/automations/rules/:id/copier-bureaux` | Copie (liée ou non) vers d'autres bureaux (`:1008-1019`) | JWT | `automations.update` — RBAC `:131` + droit vérifié dans chaque bureau cible (statut `sans_droit` sinon, `automatisations-bureaux.ts:147`, `:199-203`) | `automationCopieBureauxSchema` : `org_ids` 1-50 uuid, `lier` booléen (`validation.ts:1353-1357`) | Source lue `.eq('org_id', orgSource)` avec le client de l'utilisateur (`automatisations-bureaux.ts:178-182`, `:192-196`) | 404 « Automatisation introuvable. » ; 500 « Impossible de copier l'automatisation. » ; 200 `{ results }` |
| GET | `/api/automations/pause` | État « Tout arrêter » (`:1031-1049`) | JWT | `automations.read` — RBAC `:163` ; RLS SELECT de `company_settings` = toute adhésion | aucune | `.eq('org_id', auth.orgId)` `:1038` | 500 « Impossible de lire l'état des automatisations. » |
| POST | `/api/automations/pause` | Pose / lève la pause d'entreprise (`:1051-1096`) | JWT | `automations.update` — RBAC `:164` **ET** rôle propriétaire / admin : la policy UPDATE de `company_settings` est `has_org_admin_role` (`supabase/SCHEMA_SNAPSHOT.md:4895-4897`) ; 0 ligne → 403 | Pas de Zod : `paused === true` | `.eq('org_id', auth.orgId)` `:1067` | 403 « Votre rôle ne permet pas de mettre les automatisations en pause. » ; 500 ; 403 « Seul un administrateur peut arrêter les automatisations. Rien n'a été arrêté. » / « …reprendre… Elles sont toujours en pause. » ; 200 `{ paused }` |
| GET | `/api/automations/webhooks` | Adresses d'appel + 4 derniers caractères de la clé (suffixe lu en svc) (`:1136-1155`) | JWT | `automations.read` — RBAC `:157` + RLS SELECT | aucune | `.eq('org_id', auth.orgId)` `:1144` et `:1123` | 500 « Impossible de lire vos adresses d'appel. » |
| POST | `/api/automations/webhooks` | Crée une adresse ; renvoie la clé complète UNE fois (`:1157-1183`) | JWT | `automations.update` — RBAC `:158` + RLS INSERT | Pas de Zod : `name` coupé à 80, défaut « Webhook » | `org_id: auth.orgId` `:1169` | 403 « Votre rôle ne permet pas de créer une adresse d'appel. » ; 500 ; 201 `{ …, api_key, cle_masquee }` |
| POST | `/api/automations/webhooks/:id/regenerer` | Nouvelle clé (droit vérifié par un UPDATE RLS, clé écrite en svc) (`:1185-1226`) | JWT | `automations.update` — RBAC `:159` + RLS UPDATE | aucune | `.eq('org_id', auth.orgId)` `:1198`, `:1220` | 403 « …régénérer cette adresse. » ; 500 ; 404 « Adresse d'appel introuvable, ou votre rôle ne permet pas de la régénérer. » |
| PATCH | `/api/automations/webhooks/:id` | Active / désactive, renomme (`:1228-1253`) | JWT | `automations.update` — RBAC `:160` + RLS | Pas de Zod : `enabled` booléen, `name` ≤ 80 | `.eq('org_id', auth.orgId)` `:1241` | 400 « Rien à modifier. » ; 500 ; 404 « Adresse d'appel introuvable. » (aucun 403 distinct : une RLS qui refuse donne 404) |
| DELETE | `/api/automations/webhooks/:id` | Suppression douce (`deleted_at`, `enabled: false`) (`:1255-1277`) | JWT | `automations.update` — RBAC `:161` + RLS | aucune | `.eq('org_id', auth.orgId)` `:1265` | 403 « …supprimer cette adresse. » ; 500 ; 404 ; 200 `{ ok: true }` |

#### 3.3 `server/routes/automation-publication.ts`

| Méthode | Chemin | Ce qu'elle fait | Auth | Permission | Validation | Filtre de bureau | Codes et messages |
|---|---|---|---|---|---|---|---|
| POST | `/api/automations/rules/publication` | Publie / dépublie en lot, en séquence (`:24-40`) | JWT | `automations.update` — RBAC `:134` + RLS UPDATE | `publicationLotSchema` strict : `actif` booléen, `ids` 1-200 uuid (`validation.ts:1519-1522`) | `changerPublication(…, auth.orgId, …)` filtre `.eq('org_id', orgId)` (`server/lib/automations-publication.ts:59`, `:86`) | Toujours 200 `{ resultats: [{ id, ok, is_active } ou { id, ok: false, erreur, problemes }] }` |
| POST | `/api/automations/rules/:id/publication` | Publie / dépublie une règle (`:42-54`) | JWT | `automations.update` — RBAC `:133` + RLS | `publicationSchema` strict : `{ actif }` (`validation.ts:1518`) | idem | 404 « Automatisation introuvable. » ; 422 « Cette automatisation est à la corbeille : restaurez-la avant de la publier. » ; 422 `{ code: 'publication_refusee', problemes }` (« Publication refusée : … ») ; 403 « Votre rôle ne permet pas de publier une automatisation. » ; 500 « Impossible de changer le statut… » / « La modification n'a pas été appliquée — réessayez. » ; 200 `{ id, is_active }` |

#### 3.4 `server/routes/automation-stats.ts`

| Méthode | Chemin | Ce qu'elle fait | Auth | Permission | Validation | Filtre de bureau | Codes et messages |
|---|---|---|---|---|---|---|---|
| GET | `/api/automations/rules/stats[?rule_id=]` | Compte déclenchés / en cours / envoyés / sautés / échecs sur 60 jours (pagination 1 000, plafond 20 000 lignes) ; `texto_configure` (`:203-222`) | JWT | `automations.read` — RBAC `:118` + RLS SELECT sur `automation_scheduled_tasks` et `automation_execution_logs` | `rule_id` regex UUID stricte | `.eq('org_id', orgId)` `:112`, `:124` ; `textoConfigure(auth.orgId)` | 400 « Automatisation invalide. » ; 500 « Impossible de lire les statistiques des automatisations. » (non traduit en anglais) |

#### 3.5 `server/routes/automation-test.ts`

| Méthode | Chemin | Ce qu'elle fait | Auth | Permission | Validation | Filtre de bureau | Codes et messages |
|---|---|---|---|---|---|---|---|
| GET | `/api/automations/test` | Batterie de contrôles en **svc** : préréglages attendus, résolution de variables sur une vraie facture / visite, 10 tâches en attente, 10 derniers journaux, configuration Twilio et SMTP (`:36-299`) | JWT | `automations.read` — RBAC `:112` **ET** `isOrgAdminOrOwner` dans le handler `:40-41` | aucune | `.eq('org_id', orgId)` sur chaque lecture | 403 « Only admins can run automation tests. » ; 500 `{ error: err.message, results }` ; la réponse contient nom, courriel, téléphone d'un client (`:118-120`, `:168`), `SID=<8 premiers caractères>…, Phone=<TWILIO_PHONE_NUMBER>` (`:266`) et `SMTP user: <SMTP_USER>` (`:276`) |
| POST | `/api/automations/rules/:id/apercu` | « Tester » : rend chaque étape sur le client le plus récent qui a un courriel ; rien n'est envoyé (`:316-400`) | JWT | `automations.read` — RBAC `:124` + RLS (règle et client lus avec le client de l'utilisateur) ; variables résolues en svc `:360` | aucune | `.eq('org_id', auth.orgId)` `:333`, `:345` ; pas de filtre corbeille | 404 « Automatisation introuvable. » ; 200 `{ ok, apercu: [], message: 'Ajoutez un client avec une adresse courriel…' }` ; 500 « Impossible de préparer l'aperçu. » (messages non traduits ; `console.error` `:397`) |

#### 3.6 `server/routes/automation-events.ts`

Toutes valident `automationEventSchema` (tous champs facultatifs, `.passthrough()`, `server/lib/validation.ts:387-395`), lisent en **svc**, et vérifient que l'entité appartient à `auth.orgId`.

| Méthode | Chemin | Ce qu'elle fait | Auth | Permission (RBAC seulement) | Validation propre | Filtre de bureau | Codes et messages |
|---|---|---|---|---|---|---|---|
| POST | `/api/automations/events/appointment-created` | Ne fait rien : `{ ok: true, via: 'base' }` (`:23-29`) | aucune dans le handler | `automations.update` (`route-permissions.ts:138`) | — | — | 200 |
| POST | `/api/automations/events/appointment-cancelled` | Idem (`:33-39`) | aucune dans le handler | `automations.update` (`:139`) | — | — | 200 |
| POST | `/api/automations/events/appointment-rescheduled` | Annule les rappels `pending` de la visite puis réémet `appointment.created` (`:52-132`) | JWT | `jobs.update` OU `calendar.update` (`:169`) | `eventId` obligatoire | Visite lue `.eq('org_id', auth.orgId)` `:69` ; tâches `.eq('org_id', auth.orgId)` `:91` | 400 « eventId is required » ; 404 « Rendez-vous introuvable. » ; 500 « Failed to reschedule reminders » / « Internal server error » ; 200 `{ ok, cancelled }` |
| POST | `/api/automations/events/job-completed` | Si l'acteur est technicien : émet `job.ready_for_invoicing` + notification aux propriétaires / admins ; sinon rien (`:136-240`) | JWT | `jobs.complete` (`:140`) | `jobId` obligatoire | `.eq('org_id', auth.orgId)` `:150`, `:164` | 400 « jobId is required » ; 404 « Job not found » ; 500 « Internal server error » |
| POST | `/api/automations/events/deal-stage-changed` | Émet `pipeline_deal.stage_changed` (`:243-302`) | JWT | `automations.update` (`:141`) | `dealId` obligatoire ; le deal lui-même n'est PAS relu en base | Seul le contact (`leadId`) est filtré par `org_id` `:260`, `:268` | 400 « dealId is required » ; 500 |
| POST | `/api/automations/events/quote-sent` | Émet `quote.sent` (`:305-327`) | JWT | `automations.update` (`:142`) | `quoteId` obligatoire | Devis relu `.eq('org_id', auth.orgId)` `:312` | 400 ; 404 « Soumission introuvable. » ; 500 |
| POST | `/api/automations/events/quote-approved` | Ne fait rien (`:330-336`) | aucune dans le handler | `automations.update` (`:143`) | — | — | 200 |
| POST | `/api/automations/events/invoice-paid` | Ne fait rien (`:340-346`) | aucune dans le handler | `financial.view_invoices` (`:144`) | — | — | 200 |
| POST | `/api/automations/events/lead-created` | Émet `lead.created` (`:349-384`) | JWT | `automations.update` (`:145`) | `leadId` obligatoire | `.eq('org_id', auth.orgId)` `:361` | 400 ; 404 « Prospect introuvable. » ; 500 |
| POST | `/api/automations/events/lead-status-changed` | Émet `lead.status_changed` (`:387-421`) | JWT | `automations.update` (`:146`) | `leadId` obligatoire | `.eq('org_id', auth.orgId)` `:399` | 400 ; 404 ; 500 |
| POST | `/api/automations/events/client-tagged` | Annonce « étiquette ajoutée » si elle est VRAIMENT posée (`:430-460`) | JWT | `clients.update` OU `leads.update` (`:175`) | `clientId`, `tag` obligatoires | Client `.eq('org_id', auth.orgId)` `:444` ; `client_tags` lu sans `org_id` (`:447-448`, par `client_id` déjà vérifié) | 400 ; 404 « Client introuvable. » ; 409 « Cette étiquette n'est pas posée sur ce client. » ; 500 |
| POST | `/api/automations/events/client-untagged` | Annonce « étiquette retirée » si elle est VRAIMENT absente (`:461`) | JWT | `clients.update` OU `leads.update` (`:176`) | idem | idem | 409 « Cette étiquette est toujours posée sur ce client. » |
| POST | `/api/automations/events/task-completed` | Émet `task.completed` sur le client rattaché, si la tâche est `done` (`:467-555`) | JWT | `jobs.update` OU `clients.update` OU `leads.update` (`:179`) | `taskId` obligatoire | `.eq('org_id', auth.orgId)` sur la tâche et chaque entité liée | 400 ; 404 « Tâche introuvable. » ; 409 « Cette tâche n'est pas terminée. » ; 200 `{ ok, emis: false, raison: 'tâche sans client rattaché' }` ; 500 |

#### 3.7 `server/routes/webhooks-entrants.ts`

| Méthode | Chemin | Ce qu'elle fait | Auth | Permission | Validation | Filtre de bureau | Codes et messages |
|---|---|---|---|---|---|---|---|
| POST | `/api/hooks/:cle` | Route PUBLIQUE : trace l'appel dans `automation_webhook_receipts` puis émet `webhook.received` (`:118-263`) | La clé de 64 hex dans l'URL (aucune session) ; tout en **svc** | aucune (pas d'utilisateur) ; forfait : `horsForfaitPourOrg(org, 'includes_automations')` `:166` (suit `FEATURE_GUARD`) ; **le paywall d'abonnement ne s'applique pas** (route montée avant, `server/index.ts:385`) | Clé `^[0-9a-f]{64}$` ; corps brut ≤ 64 Ko ; JSON ou `application/x-www-form-urlencoded` ; champs réservés du moteur retirés (`:272-279`) ; 60 appels / min par clé ; 20 échecs / min par IP | Le bureau vient de la ligne `automation_webhooks` trouvée par `api_key` `:144-149` | 429 + `Retry-After` ; 404 « Webhook introuvable. » (clé inconnue, mal formée OU désactivée) ; 500 « Impossible de traiter l'appel pour le moment. » ; 403 `{ error: 'feature_not_in_plan', … }` ; 400 « Appel refusé : corps illisible : JSON ou formulaire attendu. » / « …corps trop volumineux. » ; 200 `{ ok: true }` |

#### 3.8 Autres routes qui lisent ou écrivent les tables d'automatisations

| Méthode | Chemin | Lien avec les automatisations | Auth | Permission | Filtre de bureau | Source |
|---|---|---|---|---|---|---|
| GET | `/api/automations/clients-inactifs/apercu?mois=` | « X clients correspondent aujourd'hui » (déclencheur Client inactif) ; compte en svc | JWT | `automations.read` (RBAC `route-permissions.ts:122`) + drapeau `auto_client_inactif` (404 « Capacité non activée. ») | `auth.orgId` | `server/routes/reservation.ts:133-147` |
| GET | `/api/orgs/offices/sante` | Compte les `automation_rules` actives par bureau (svc) | JWT | Propriétaire seulement (403 « Réservé aux propriétaires. ») | Bureaux du `company_group` | `server/routes/orgs.ts:243-250`, `:275` |
| POST | `/api/orgs/create-office` | Sème les préréglages du nouveau bureau, tous activés | JWT | (non relevé ici) | nouveau bureau | `server/routes/orgs.ts:503`, `:596` |
| POST | `/api/orgs/offices/:id/reprendre-base` | Recopie les règles du bureau de base (svc) | JWT | (non relevé ici) | bureau cible | `server/routes/orgs.ts:363` ; `server/lib/office-inheritance.ts:543-567` |
| POST | `/api/onboarding/complete`, `/api/onboarding/seed-defaults` | `seedOrgComplete` → `ensureAutomationPresets(…, { activateAll: true })` | JWT | (non relevé ici) | bureau de la session | `server/routes/onboarding.ts:37`, `:86`, `:123-129` ; `server/lib/seedOrgDefaults.ts:257` |
| POST | `/api/cron/payment-reminders` | Lit `automation_rules` et `automation_scheduled_tasks` pour ne pas doubler une relance | En-tête `x-cron-secret` | — | par bureau, svc | `server/routes/reminders-cron.ts:187-222`, `:636` |
| POST | `/api/cron/rappels-dates` | Balayage du déclencheur « Date atteinte » | En-tête `x-cron-secret` (401 « Invalid cron secret », 503 si non configuré) | — | svc | `server/routes/cron.ts:24-48`, `:94-104` ; `server/lib/rappels-dates.ts:97` |
| POST | `/api/lumi/chat`, `/api/lumi/action`, `/api/lumi/execute` | Exécutent les outils Lumi du §6 (écritures directes dans `automation_rules`) | JWT | Permission par outil (§6) | `ctx.orgId` | `server/routes/lumi.ts:522`, `:856`, `:923` |
| POST | serveur MCP | Expose les mêmes outils (lecture par clé d'API ou OAuth ; écriture par OAuth `mcp:write`) | Clé `X-API-Key` ou OAuth | Permission par outil en OAuth ; une clé d'API a la « visibilité complète » | bureau de la clé / du jeton | `server/routes/mcp.ts:69-84`, `:86-112` |

#### 3.9 Routes sans vérification de permission ou sans filtre visible

- **Aucune route d'automatisation n'est sans entrée RBAC** dans `ROUTE_PERMISSIONS` (les 43 routes des six fichiers y figurent, `server/lib/route-permissions.ts:112-179`). Mais la correspondance est exacte : voir S-02.
- **Quatre handlers n'authentifient pas eux-mêmes** et reposent uniquement sur le RBAC : `appointment-created`, `appointment-cancelled`, `quote-approved`, `invoice-paid` (`automation-events.ts:23`, `:33`, `:330`, `:340`). Ils ne font rien d'autre que répondre `{ ok: true, via: 'base' }`.
- **`deal-stage-changed` ne vérifie pas que le deal appartient au bureau** : seul `leadId` est relu (`automation-events.ts:248-276`) ; l'événement est émis avec `entityId: dealId` tel que reçu.
- **Corbeille non filtrée** : `PATCH /rules/:id` (`:493-498`), `POST /rules/:id/duplicate` (`:694-699`), `POST /rules/:id/apercu` (`automation-test.ts:329-334`) acceptent une règle `deleted_at` ou `purged_at`.
- **`automation_webhook_receipts`** : écrite par `/api/hooks/:cle`, lue par AUCUNE route ni aucun écran (grep : seules occurrences `webhooks-entrants.ts:205`, `:223`).

---

### 4. Accès direct à la base depuis le navigateur

#### 4.1 Requêtes supabase-js (sans passer par Express)

| Table | Opération | Détail | Appelants | Source |
|---|---|---|---|---|
| `automation_rules` | SELECT `*` | `.eq('org_id', orgId)`, `.is('purged_at', null)`, tri par nom ; renvoie aussi `org_id`, `lumi_conversation`, les règles à la corbeille | Liste (`src/pages/Automations.tsx:553`), Vue d'ensemble (`AutomationsApercu.tsx:49`), Réglages › Messagerie (`SettingsMessaging.tsx:473`), Réglages › Avis (`SettingsReviews.tsx:164`) | `src/lib/automationRulesApi.ts:45-59` |
| `automation_rules` | SELECT `actions, steps` par `id` (sans `org_id`) | lecture avant réécriture d'un message | `updateRuleMessage` | `src/lib/automationRulesApi.ts:107-112` |
| `automation_rules` | **UPDATE** `actions`, `steps`, `updated_at` par `id` (sans `org_id`), `.select('id')` | Réécrit le corps d'un texto ou d'un courriel (et l'objet) ; refuse un message vide côté navigateur seulement ; 0 ligne → « Modification refusée — vous n'avez pas accès à cette automatisation. » | `MessageEditor.tsx:67`, `EmailPreviewEditor.tsx:381`, `SettingsMessaging.tsx:495`, `SettingsReviews.tsx:316` | `src/lib/automationRulesApi.ts:83-157` |
| `automation_execution_logs` | SELECT | Échecs des 7 derniers jours (limite 50 / 200) | Liste, Vue d'ensemble | `src/lib/automationRulesApi.ts:230-246` |
| `automation_execution_logs` | SELECT | Journaux d'une règle sur 60 jours (limite 200), avec `result_data` | Onglet Journaux (`OngletJournaux.tsx:147`) | `src/lib/automationJournauxApi.ts:69-92` |
| `automation_execution_logs` | SELECT | Activité par semaine (limite 5 000) | Vue d'ensemble | `src/lib/automationJournauxApi.ts:365-419` |
| `automation_scheduled_tasks` | SELECT | Inscriptions d'une règle sur 60 jours (limite 200) | Onglet Historique (`OngletJournaux.tsx:307`) | `src/lib/automationJournauxApi.ts:110-137` |
| `clients`, `quotes`, `invoices`, `jobs`, `schedule_events` | SELECT | Résolution des noms de clients des journaux | — | `src/lib/automationJournauxApi.ts:197-257` |
| `company_settings` | SELECT `company_name, logo_url, phone, email` | Aperçu habillé des courriels | Éditeur de courriel | `src/lib/automationRulesApi.ts:275-294` |
| `company_settings` | SELECT / **UPDATE** `default_language` | Langue des envois ; 0 ligne → « Seul un administrateur peut changer la langue des messages. Rien n'a été modifié. » | `Automations.tsx:518-526`, `AutomationsReglages.tsx:57` | `src/lib/automationRulesApi.ts:301-332` |
| `company_settings` | SELECT `review_enabled` | Avertissement « avis désactivés » | `Automations.tsx:788` | `src/lib/automationRulesApi.ts:345-358` |
| `memberships`, `client_tags` | SELECT | Listes « assigner à » et étiquettes de l'éditeur | Éditeur | `src/lib/automationBuilderApi.ts:396-445` |
| RPC `relances_du_deal` | appel | Relances d'un deal sans coordonnées | Fiche du deal | `src/lib/pipelineVentesApi.ts:340-356` |

`automation_folders`, `automation_webhooks` et `automation_webhook_receipts` : **aucun accès direct** depuis le navigateur (tout passe par Express).

#### 4.2 Policies RLS (`supabase/SCHEMA_SNAPSHOT.md`, généré depuis la prod le 2026-09-30)

| Table | Policy | Commande | Condition | Ligne |
|---|---|---|---|---|
| `automation_rules` | `automation_rules_select_org` | SELECT | `member_has_permission(auth.uid(), org_id, 'automations.read')` | `:4712-4713` |
| | `automation_rules_insert_org` | INSERT | WITH CHECK `…'automations.update'` | `:4710-4711` |
| | `automation_rules_update_org` | UPDATE | USING et WITH CHECK `…'automations.update'` | `:4714-4716` |
| | `automation_rules_delete_org` | DELETE | USING `…'automations.update'` | `:4708-4709` |
| | `bureau_actif` | ALL, RESTRICTIVE | `bureau_actif_demande() IS NULL OR org_id IS NULL OR org_id = bureau_actif_demande()` | `:4717-4719` |
| `automation_folders` | `_select` / `_insert` / `_update` / `_delete` | une par commande | lecture `automations.read`, écritures `automations.update` | `:4693-4701` |
| | `bureau_actif` | ALL, RESTRICTIVE | idem | `:4702-4704` |
| `automation_scheduled_tasks` | `automation_scheduled_tasks_select_org` | SELECT seulement | `automations.read` | `:4723-4724` |
| | `bureau_actif` | ALL, RESTRICTIVE | idem | `:4725-4727` |
| `automation_execution_logs` | `automation_execution_logs_select_org` | SELECT seulement | `automations.read` | `:4685-4686` |
| | `bureau_actif` | ALL, RESTRICTIVE | idem | `:4687-4689` |
| `automation_webhooks` | `automation_webhooks_select` | SELECT, rôle `public` | `has_org_membership(…) AND member_has_permission(…, 'automations.read')` | `:4736-4737` |
| | `automation_webhooks_write` | ALL, rôle `public` | `has_org_membership(…) AND …'automations.update'` | `:4738-4740` |
| `automation_webhook_receipts` | `automation_webhook_receipts_select` | SELECT, rôle `public` | `has_org_membership(…) AND …'automations.read'` | `:4731-4732` |
| `company_settings` | `company_settings_update_org` | UPDATE | `has_org_admin_role(auth.uid(), org_id)` | `:4895-4897` |
| | `company_settings_select_org` | SELECT | toute ligne de `memberships` du bureau | `:4893-4894` |

Privilèges de table et de colonne :
- `automation_rules` : `GRANT ALL … TO authenticated` (et à `anon`) dans la baseline (`supabase/baseline/01_schema.sql:57556-57557`). Aucun trigger ne protège `is_preset`, `preset_key`, `is_active`, `deleted_at` ; le seul trigger est `trg_automation_rules_updated` (`SCHEMA_SNAPSHOT.md:10183`).
- `automation_scheduled_tasks`, `automation_execution_logs` : SELECT seulement pour `authenticated` (`01_schema.sql:57539`, `:57566`).
- `automation_webhooks` : la migration `20261003100100_securite_automatisations.sql` retire SELECT puis le rend colonne par colonne **sans `api_key`** ; `20261004100100_cle_webhook_non_choisie.sql` fait de même pour INSERT / UPDATE. La baseline porte encore `GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.automation_webhooks TO authenticated` (`01_schema.sql:57583`) — voir S-17.
- `automation_webhooks` et `automation_webhook_receipts` n'ont PAS la policy restrictive `bureau_actif` que portent les quatre autres tables.
- Journaux : la policy « `automations.read` OU `leads.read` » posée par `20261003100100` a été resserrée ensuite (`20261004100000_journaux_automatisations_prospects.sql`) ; l'instantané ne montre que `automations.read`, et les vendeurs passent par la RPC `relances_du_deal`.

Résolution de `member_has_permission` (`supabase/baseline/01_schema.sql:10572-10611`) : adhésion `active` obligatoire → propriétaire : oui → technicien : jamais une clé financière → surcharge du membre (`memberships.permissions`) → admin : tout sauf `users.delete` → gabarit de rôle du bureau (`role_templates`) → défauts (`role_permission_defaults`).

---

### 5. Rôles

#### 5.1 Clés et préréglages

Clés du module : `automations.read` (« Voir les automatisations » / « View automations ») et `automations.update` (« Modifier les automatisations » / « Edit automations ») (`src/lib/permissions.ts:74`, `:320-324`). Cocher `update` coche `read` dans l'écran des rôles (`src/lib/permissionsCascade.ts:52`). `automations.create` et `automations.delete` : **introuvables**.

| Rôle (`ROLE_PRESETS`, `src/lib/permissions.ts:406-474`) | `automations.read` | `automations.update` |
|---|---|---|
| `owner` (`allTrue()`, `:407`) | oui | oui |
| `admin` (`allTrue()` sauf `users.delete`, `:409-412`) | oui | oui |
| `sales_rep` (`pick([...])`, `:414-441`) | non | non |
| `technician` (`pick([...])`, `:443-473`) | non | non |

Il n'existe que ces quatre rôles (`src/lib/permissions.ts:9-11`) ; `manager`, `support`, `viewer` sont des anciens noms remappés (`:602-606`). Une surcharge par membre ou un gabarit de rôle du bureau peut accorder ou retirer les deux clés.

#### 5.2 Matrice (défauts du code)

| Capacité | owner | admin | sales_rep | technician | Membre perso. `read` seul | Membre perso. `read`+`update`, rôle non admin |
|---|---|---|---|---|---|---|
| Voir l'item « Automatisations » de la barre latérale | oui | oui | non | non | oui | oui |
| Ouvrir `/automations` (liste) | oui | oui | « Accès restreint » | « Accès restreint » | route ouverte, mais contenu « Accès restreint » (S-01) | oui |
| Ouvrir `/automations/apercu` | oui | oui | non | non | oui | oui |
| Ouvrir `/automations/reglages`, l'éditeur | oui | oui | non | non | non | oui |
| Lire règles, dossiers, journaux, stats (API + RLS) | oui | oui | 403 / 0 ligne | 403 / 0 ligne | oui | oui |
| Créer, modifier, dupliquer, publier, corbeille, dossiers, adresses d'appel | oui | oui | 403 | 403 | 403 | oui |
| « Tout arrêter » / reprendre ; langue des envois | oui | oui | non | non | non | **non** (403 « Seul un administrateur… ») |
| `GET /api/automations/test` | oui | oui | 403 | 403 | 403 « Only admins… » | 403 « Only admins… » |
| « Construire avec Lumi » (`/generer`) | oui | oui | 403 | 403 | 403 | oui |
| Outils Lumi de lecture / d'écriture | oui / oui | oui / oui | refus / refus | refus / refus | oui / refus | oui / oui (sauf langue : refus) |
| Signaler une étiquette (`client-tagged`) | oui | oui | oui (`clients.update`) | 403 | selon ses autres clés | selon ses autres clés |
| Signaler une tâche terminée | oui | oui | oui | oui (`jobs.update`) | — | — |
| Signaler une visite déplacée | oui | oui | oui (`calendar.update`) | oui | — | — |
| Signaler un job terminé (`job-completed`) | oui | oui | 403 (pas `jobs.complete`) | oui → émet `job.ready_for_invoicing` | — | — |
| Signaler un changement d'étape (ancien pipeline) | oui | oui | 403 (exige `automations.update`) | 403 | 403 | oui |
| Voir « Relances automatiques » d'un deal (RPC) | oui | oui | oui | (selon accès au pipeline) | — | — |

#### 5.3 Où c'est appliqué

| Niveau | Mécanisme | Source |
|---|---|---|
| Interface — menu | `canSee` : `requiredPermission` + `requiredPlanFlag` | `src/App.tsx:1053-1079`, `:1145` |
| Interface — routes | `Gated` → `PermissionGate` | `src/App.tsx:260-262`, `:1654-1668` |
| Interface — pages | `PermissionGate` interne (`update` pour la liste et les réglages, `read` pour la vue d'ensemble) | `Automations.tsx:1219`, `AutomationsApercu.tsx:83`, `AutomationsReglages.tsx:65` |
| Interface — boutons | **Aucun** `usePermissions` / `hasPermission` dans `src/pages/Automation*.tsx` ni `src/components/automations/*.tsx` (grep) : aucun bouton n'est caché ou désactivé selon le rôle à l'intérieur des pages ; `lectureSeule` dans l'éditeur dépend du FORMAT de la règle, pas du rôle (`AutomationBuilderPage.tsx:1996`) | grep |
| Interface — points d'entrée hors module | Palette, recherche, menu Réglages, lien Paiements, lien Pipeline : aucun filtre de permission (EXT-002 à EXT-005, EXT-012) | §2 |
| Serveur — RBAC | `ROUTE_PERMISSIONS` + `hasPermission(ctx, clé)` (propriétaire → surcharge → admin → préréglage du rôle) | `server/lib/route-permissions.ts:112-179`, `:493-545` ; `server/lib/rbac.ts:207-238` |
| Serveur — handler | `isOrgAdminOrOwner` (test), relecture 0 ligne (pause), droit par bureau cible (copie) | `automation-test.ts:40` ; `automation-rules.ts:1081-1087` ; `automatisations-bureaux.ts:136` |
| Serveur — Lumi / MCP | `PERMISSION_PAR_OUTIL` vérifié dans `executerOutilGarde` | `server/lib/agent/garde.ts:62-63`, `:332-345` ; `server/lib/agent/tools-reglages.ts:1618-1622` |
| Base — RLS | `member_has_permission(…, 'automations.read' / 'automations.update')` | §4.2 |
| Base — rôle admin | `has_org_admin_role` sur `company_settings` (pause, langue) | §4.2 |

#### 5.4 Divergences entre les trois niveaux

1. Route et menu en `automations.read`, contenu de la liste en `automations.update` (S-01).
2. `automations.update` suffit pour l'interface et le RBAC de « Tout arrêter », mais la base exige le RÔLE propriétaire / admin (S-08).
3. Plusieurs routes d'événements exigent `automations.update` alors que l'action d'origine relève d'un autre droit (S-07).
4. L'interface réécrit un message par PostgREST sans passer par la validation ni les gardes du serveur (S-04).
5. La RLS autorise UPDATE et DELETE sur toute colonne de `automation_rules` à qui a `automations.update` ; les interdits du serveur (préréglage non supprimable, déclencheur d'un préréglage figé, publication vérifiée, corbeille) n'existent qu'en Express (S-04).
6. `/settings/messaging` s'ouvre avec `settings.read` (que `sales_rep` et `technician` ont par défaut), mais sa section d'automatisations dépend de `automations.read` côté base (S-12).
7. Le forfait est une garde d'INTERFACE ; côté serveur il n'est appliqué qu'en mode `enforce`, et jamais sur PostgREST ni sur les outils Lumi (S-03).

---

### 6. Lumi et les automatisations

#### 6.1 Outils de l'agent

Chemin d'une écriture dans l'app : le modèle propose → carte de confirmation → `POST /api/lumi/execute` avec `decision: confirm | cancel | dry_run` (`server/routes/lumi.ts:923-1021`) → `executerEcriture` → `executerOutilGarde` (permission, validation des arguments, résolution des numéros) (`server/lib/lumi/execution.ts:26-66` ; `server/lib/agent/garde.ts:319-380`). Une proposition expire après 15 minutes (409 `proposition_expiree`, `lumi.ts:936-945`) ; plafond de 20 écritures par conversation (409 `plafond_ecritures`, `execution.ts:86` ; `lumi.ts:948-958`). Modes : `demander`, `argent` (défaut), `tout` (`execution.ts:70-71`).

| Outil | Nature | Paramètres | Permission (où) | Ce qu'il renvoie | Confirmation | Source |
|---|---|---|---|---|---|---|
| `list_automations` | lecture | aucun | `automations.read` (`garde.ts:62`) | `{ count, automations: [{ id, name, trigger_event, is_active, is_preset }] }`, 50 max, hors corbeille ; `trigger_event` = clé technique, `name` = nom brut en base | non | `server/lib/agent/tools-etendus.ts:902-923` |
| `get_automation_health` | lecture, identité exigée | aucun | `automations.read` (`garde.ts:63`) | Sur les 100 derniers journaux : `partis`, `sautes` + `raisons_des_sauts`, `echoues` + `raisons_des_echecs` (causes traduites en français seulement), `note` | non | `tools-etendus.ts:925-996` |
| `create_automation_from_text` | écriture, identité exigée | `description` (obligatoire, ≥ 10 caractères) | `automations.update` (`tools-reglages.ts:1618`) | `{ created, rule_id, name, trigger_event, etapes, resume, is_active: false, deuxieme_automatisation?, warning?, note }` ; règle créée EN PAUSE avec `actions: []` et `steps` | oui — `sensible` et dans `JAMAIS_D_OFFICE` (jamais sans carte, quel que soit le mode) | `tools-reglages.ts:403-552`, `:1585` ; `registre.ts:86-101` |
| `toggle_automation_rule` | écriture, identité exigée | `rule_id`, `is_active` (obligatoires) | `automations.update` (`tools-reglages.ts:1619`) | `{ updated, rule_id, name, is_active, note }` ; passe par `changerPublication` (mêmes refus que l'interface, mais TOUJOURS en français : paramètre `fr` non transmis, `:365`) | oui — `JAMAIS_D_OFFICE` | `tools-reglages.ts:342-376` |
| `update_automation_message` | écriture, identité exigée | `rule_id`, `action_type` (`send_sms` / `send_email`), `body` (coupé à 5 000), `subject?` (300), `message_number?` | `automations.update` (`:1620`) | `{ updated, rule_id, name, action_type, ancien_texte, note }` ; plusieurs messages du même type sans numéro → erreur qui les liste | oui — `JAMAIS_D_OFFICE` | `tools-reglages.ts:564-659` |
| `update_automation_sms_body` | écriture, identité exigée | `rule_id`, `body` (coupé à 1 600), `message_number?` | `automations.update` (`:1621`) | idem | oui — `JAMAIS_D_OFFICE` | `tools-reglages.ts:661-684` |
| `set_automation_language` | écriture, identité exigée | `language` (`fr` / `en`) | `automations.update` (`:1622`) + RLS admin de `company_settings` (0 ligne → « Seuls le propriétaire ou un administrateur peuvent changer la langue des automatisations. ») | `{ updated, language, note }` | oui en modes `demander` et `argent` (`sensible`, `:1589`) ; **absent de `JAMAIS_D_OFFICE`** (`registre.ts:86-97`) → peut partir sans carte en mode `tout` ou « toujours confirmer » | `tools-reglages.ts:686-711` |

Autour des outils :
- **Raccourcis sans modèle** : « liste mes automatisations » → `list_automations` (`server/lib/lumi/actions-directes.ts:78`) ; « active / désactive / mets en pause l'automatisation <nom> » → carte `toggle_automation_rule` (`actions-directes.ts:430-431`).
- **Carte de confirmation** d'une automatisation : « Automatisation · <nom> · <trigger_event brut> · active / en pause » (`server/lib/lumi/apercu-action.ts:138-142`).
- **Sujet du routeur** : les outils d'automatisation sont dans le sujet `rapports` (`server/lib/lumi/topics.ts:84-88`, `tools-reglages.ts:1656-1658`), mais l'exemple du routeur envoie « pourquoi l'automatisation a pas parti » vers `equipe` (`server/lib/lumi/routeur.ts:223`), dont la liste d'outils ne contient ni `list_automations` ni `get_automation_health` (`topics.ts:72-76`).
- **Écritures voisines** qui déclenchent des automatisations : les outils de jobs, visites, deals et étiquettes rappellent les routes d'événements (`tools-etendus.ts:1639`, `:2814`, `:2917`, `:2964`, `:3839` ; `tools-leads.ts:1094`, `:1233`, `:1275` ; `tools-terrain.ts:517`, `:567`). `update_job_status` devient « sensible » quand une règle active sur `job.completed` porte une action vers le client — la détection lit `actions` seulement (`execution.ts:101-121`).
- **MCP** : mêmes outils, sauf `canal: 'lumi'`. Écritures et outils « identité exigée » seulement par OAuth (`mcp:write`) ; `list_automations` reste accessible par clé d'API. Le MCP n'a pas la carte de confirmation de Lumi (`server/routes/mcp.ts:69-84`).
- **Forfait** : aucun des outils ne vérifie `includes_automations` (grep sans résultat dans `server/lib/agent`, `server/lib/lumi`).

#### 6.2 « Construire avec Lumi » (éditeur)

- **Route** : `POST /api/automations/rules/generer` (§3.2). Client : `genererParcoursAvecLumi` (`src/lib/automationBuilderApi.ts:352-384`).
- **Entrée** : `demande` (≥ 10 caractères, coupée à 2 000), `langue`, `echanges` (6 derniers tours), `parcours_actuel` (JSON coupé à 6 000), `rule_id` (`automation-rules.ts:326-363` ; `generer-parcours.ts:394-423`).
- **Modèle** : `claude-sonnet-5`, `max_tokens` 4 000, prompt système en cache éphémère ; un second essai si la réponse n'est pas un JSON lisible (`generer-parcours.ts:42`, `:55`, `:557-604`).
- **Sortie** : `{ nom (≤ 120), trigger_event, resume (≤ 300 + « Nouveau texte : … » écrit par le serveur), steps, autre | null }` (`generer-parcours.ts:725-737` ; `automation-rules.ts:475-481`). Rien n'est enregistré sauf la conversation (40 derniers tours) dans `automation_rules.lumi_conversation` (`automation-rules.ts:439-473`). Le coût (`coutCents`) est calculé mais n'est pas renvoyé au navigateur.
- **Déclencheurs autorisés** : tous ceux du catalogue `DECLENCHEURS`, listés tels quels dans le prompt (`generer-parcours.ts:188-190`) — y compris ceux réservés à un drapeau (`auto_paiement_echoue`, `auto_consultation_documents`, `auto_client_inactif`, `src/lib/automationCatalogue.ts:219`, `:227`, `:325`). La route vérifie seulement que la clé existe (`automation-rules.ts:384-391`).
- **Actions autorisées** : tout le catalogue `ACTIONS` SAUF `demarrer_automatisation`, `arreter_automatisation` et les actions marquées `indisponible` (`generer-parcours.ts:89-93`, `:191-205`).
- **Conditions autorisées** (prompt) : `status` (`sent`, `approved`, `paid`, `unpaid`), `montant` (`gt`, `gte`, `lt`, `lte`), `tag` (`eq`) (`generer-parcours.ts:276-287`).
- **Garde-fous après le modèle** : normalisation des valeurs (`:448-464`) ; variable inventée → refus qui la nomme (`:690-699`, étapes principales seulement) ; lien manquant (« trou ») dans la 2e automatisation → elle n'est pas créée et la question est posée (`:103-120`, `:706-711`) ; puis `sequenceEtapes`, existence du déclencheur, automatisation liée inexistante (`automation-rules.ts:371-406`) ; une 2e automatisation invalide est écartée en silence côté utilisateur (journal serveur seulement, `:422-429`).
- **Demande ambiguë** : construire la version la plus courante ET poser UNE question dans `resume` (`generer-parcours.ts:337-341`).
- **Demande non supportée ou refusée** : `steps: []` + explication → 422 avec l'explication de Lumi (`:290-296`, `:668-671`). Sur un parcours existant : parcours inchangé, `modifie: false` (`:324-336`). Refus prévus : menace, envoi de nuit « entre 21 h et 8 h », rafale, contournement d'un désabonnement, suppression de fiche, fuite de données.
- **Question sur le parcours** : parcours inchangé + réponse dans `resume` (`:326-328`).
- **Réponse illisible** : « Il n'y a pas encore de parcours à modifier… » ou « Lumi n'a pas compris cette modification… » (`:636-651`) ; réponse coupée : « La réponse de Lumi a été coupée (parcours trop long)… » (`:613-622`).
- **Brouillon vide** : sur un refus, une règle vide créée il y a moins de 10 minutes est mise à la corbeille (`brouillon_retire`, `automation-rules.ts:272-294`, `:321-324`).
- **Facturation** : au budget Lumi du bureau. Réservation AVANT l'appel (`reserverBudget`), règlement au coût réel (`reglerBudget`), journal `ai_usage` avec `source: 'automatisations'` (`generer-parcours.ts:514-519`, `:569-583`, `:605`). Refus : `plan_sans_lumi` → 422 `sans_lumi: true` « Construire avec Lumi est inclus dans le forfait Autopilot… » (`:521-529`) ; `capped` → « Le budget Lumi du mois est atteint… » (`:533-540`) ; réservation impossible → « Lumi est momentanément indisponible (budget illisible)… » (`:547-554`). Appel raté : réservation libérée à 0 (`:743`). Deux envois identiques simultanés partagent un seul appel (`:431-440`). Interface : mention « Déduit de tes crédits Lumi » (`src/components/automations/ClavardageLumi.tsx:127`) et encadré « Construire avec Lumi — inclus dans Autopilot » / « Voir Autopilot » (`src/pages/AutomationBuilderPage.tsx:1833-1845`).

#### 6.3 Consignes du prompt

- `server/lib/agent/consignesCollegue.ts` (57 lignes) : **aucune consigne ne nomme les automatisations**. S'appliquent les règles générales : pas d'identifiant ni de nom de champ affiché, statuts anglais traduits (`:21-22`), « Avant TOUT envoi… attends un OUI » (`:44-45`), ne pas exposer d'erreur brute (`:38-41`).
- Prompt de l'orchestrateur : les automatisations sont citées dans la liste des familles d'outils à chercher (`server/lib/lumi/orchestrateur.ts:254`).
- Routeur : sujet `rapports` — « automatisations : en CRÉER une…, l'activer, la mettre en pause, changer ses messages ou leur langue » (`server/lib/lumi/topics.ts:86`) ; sujet `facturation` renvoie la création d'une automatisation vers `rapports` (`topics.ts:56`).
- Indices de recherche d'outils : `automatisation`, `regle`, `parcours`, `workflow`, `sequence`, `automatise`… → `automation` (`server/lib/lumi/indices-outils.ts:33-35`).
- Assistant de support : fiche « Automatisations » de la carte de l'app (`server/lib/support/carte-app.ts:94`).

---

### 7. Courriels et textos produits

#### 7.1 Chemin d'un envoi

`executeAction` pose le contexte de bureau (bac à sable) puis aiguille par type (`server/lib/actions/index.ts:3107-3190`). Types reconnus : `send_email`, `send_sms`, `create_notification`, `send_notification`, `create_task`, `update_status`, `move_deal_stage`, `request_review`, `log_activity`, `update_custom_field`, `envoyer_slack`, `ajouter_etiquette`, `retirer_etiquette`, `modifier_client`, `assigner_responsable`, `ajouter_note`, `modifier_statut_rendezvous`, `modifier_deal`, `assigner_deal`, `envoyer_facture`, `envoyer_soumission`, `webhook`, `arreter_automatisation`, `demarrer_automatisation` (`:3137-3188`).

**Courriel (`executeSendEmail`, `:1216-1430`)**, dans l'ordre :
1. Destinataire = `vars.client_email`, jamais la règle ; absent → étape sautée « Aucune adresse courriel pour ce client » (`:1227-1228`).
2. Objet et corps résolus dans la langue du bureau (`champLocalise`), prénom vide nettoyé (`:1230-1233`).
3. Fournisseur non configuré → échec `SMTP not configured` (`:1237`).
4. Adresse injoignable (rebond, plainte) → sautée (`:1243-1245`).
5. Désabonné → sautée (toujours, ou seulement le marketing si le drapeau « par canal » est actif) (`:1264-1273`).
6. Courriel commercial sans nom ou adresse postale de l'entreprise → sauté « Courriel commercial non envoyé : … manque (Paramètres → Entreprise)… » (`:1208-1214`, `:1283-1286`).
7. Consentement LCAP (exprès ou tacite) ; base journalisée dans `consents` (`:1291-1300`).
8. Plafond : 3 messages commerciaux par destinataire par 24 h (`AUTOMATION_MAX_COMMERCIAL_PER_DAY`), échec `Frequency cap reached…` (`:241-244`, `:1303-1305`).
9. Bouton vers la page publique de l'entité (`boutonPourEntite`) (`:1331-1337`).
10. Expéditeur : adresse vérifiée de la plateforme ou domaine vérifié du bureau ; seul le nom affiché (`from_name`) et le `reply_to` sont surchargeables (`:1358-1370`). Pré-en-tête masqué (`:1375-1378`).
11. Anti-doublon « déjà envoyé » (`:1380-1382`).
12. `sendEmail({ …, html: buildEmailLayout(company, apercu + body + pied, bouton), suivi: { orgId, entityType, entityId }, headers })` (`:1384-1407`) → ligne `email_deliveries` ; puis `activity_log` (`event_type: 'email_sent'`, `source: 'automation'`) (`:1415-1421`).

**Texto (`executeSendSms`, `:1457-1586`)** : pas de client Twilio → sauté « Aucun numéro texto configuré pour le bureau » ; pas de téléphone → sauté ; `sms_opt_outs` → sauté ; consentement ; plafond 24 h ; mention commerciale ajoutée ; numéro d'envoi DU BUREAU (`getOrgSmsFromNumber`, sinon sauté « Le forfait n'inclut pas les textos » ou « Aucun numéro… ») ; gel des communications d'un bureau importé ; anti-doublon ; envoi Twilio avec `statusCallback` ; ligne `messages` (`direction: 'outbound'`, `status: 'sent'`) visible dans Messages ; erreur 21610 (STOP côté opérateur) → sauté.

**Demande d'avis (`executeRequestReview`, `:1936` et suivantes)** : échec si `review_enabled === false` (« Review requests are disabled in Settings → Customer reviews. ») ou sans lien Google / Facebook (« No Google or Facebook review link configured… ») — messages en anglais dans le journal ; lien `/survey/<token>` (`:721-738`). Les règles d'avis sautent les clients « noreview » (`:3123-3135`).

**Envoyer la facture / le devis** : `envoyerDocument` réutilise le même chemin (consentement, désabonnement, plafond, gabarit) et émet `quote.sent` (`:2986` et suivantes, `:3078`, `:3091-3105`).

**Journal** : chaque exécution écrit `automation_execution_logs` ; un envoi SAUTÉ est un succès technique avec `result_data.saute` (`:146`, `:182` ; lecture `server/routes/automation-stats.ts:90-98`). Un échec définitif crée la notification `automation_failed` (`server/lib/automationEngine.ts:1505-1531`).

#### 7.2 Gabarit du courriel

`buildEmailLayout` → `rendreCourrielClient({ langue, marque, corpsHtml, bouton, signature: null })` (`server/routes/emails.ts:190-202`) dans `server/lib/courriels/gabarit.ts` :
- **Couleur** : couleur de marque du bureau, passée par `couleurBouton` — sous un contraste de 3:1 avec le blanc elle est remplacée par `#111827` (`gabarit.ts:90`, `:207-216`). Elle porte le filet de tête, le bouton, et les liens téléphone / courriel du pied (`:454`, `:481-492`, `:510`).
- **Logo** : à gauche, `max-height: 56px`, `max-width: 170px`, `alt` = nom du bureau ; sans logo, le nom en texte à gauche ; repli VIDE (jamais « Lume ») (`:455-476`).
- **Fond** : blanc (`FOND_CLIENT = '#ffffff'`), carte bordée, largeur 600 px, styles en ligne (`:148-149`, `:23-26`, `:385`).
- **Bouton** : un seul, de la couleur du bureau (`:269-281`).
- **Signature** : `null` pour les automatisations (pas de « — Entreprise » ajouté).
- **Pied** : téléphone et courriel cliquables, nom + adresse postale + site, réseaux sociaux, numéros de taxes (`:481-496`).
- **Mascotte / marque Lume** : **absente** des courriels client — « Plus de pastille Lume au pied (audit du 2026-09-29, marque blanche) » (`:497-500`). L'en-tête du fichier dit encore l'inverse (« seule la mascotte figure au pied », `:13-14`) : commentaire périmé.
- **Langue** : celle du bureau (`langueEntreprise(company)`), y compris pour le bouton et le lien de désabonnement (`actions/index.ts:1329`).

#### 7.3 Désabonnement

- **Courriel** : lien « Se désabonner de ces communications » / « Unsubscribe from these emails », gris, centré, ajouté APRÈS le corps et à l'intérieur de la carte ; en-têtes `List-Unsubscribe` et `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Seulement sur un envoi commercial (`ctx.commercial` ou marketing) (`actions/index.ts:1317`, `:1342-1346`, `:1399-1406`). URL `<FRONTEND_URL ou PUBLIC_URL>/api/unsubscribe/<token>` ; pas de lien si la base d'URL manque (`server/lib/notificationHelpers.ts:214-247`). Routes : `GET` / `POST /api/unsubscribe/:token` (`server/routes/unsubscribe.ts:133`, `:227`).
- **Texto** : sur un texto commercial, ajout sur une nouvelle ligne de « <Entreprise> - Répondez STOP pour ne plus recevoir. » / « Reply STOP to opt out. » ; nom coupé à 40 caractères ; rien n'est répété si le corps contient déjà `STOP` / `ARRÊT` en majuscules ou le nom du bureau (`server/lib/desabonnement/mention-sms.ts:21-58` ; `actions/index.ts:1513-1515`).

#### 7.4 Heures calmes

- Fenêtre par défaut : 8 h à 19 h 59, heure du bureau (`SEND_START_HOUR = 8`, `SEND_END_HOUR = 20`, `server/lib/automationEngine.ts:348-349`, `:374-377`).
- Fenêtre réglable par règle : `settings.fenetre { debut, fin }`, bornée par Zod à 7 h-22 h (`server/lib/validation.ts:1186-1211`) ; `jours_ouvrables` exclut samedi et dimanche (`automationEngine.ts:389-419`). Une fenêtre invalide retombe sur 8 h-20 h.
- Actions concernées : `send_sms`, `send_email`, `request_review`, `envoyer_facture`, `envoyer_soumission` (`:440`). À l'exécution immédiate : texto et demande d'avis toujours ; courriel seulement si une fenêtre est réglée ou si le délai de la règle est non nul (`:442-455`). Dans la file : toute action de message hors fenêtre est repoussée, sans consommer de tentative, par pas de 30 min (24 h, ou 3 jours avec `jours_ouvrables`) (`:457-472`, `:1718-1731`).
- Trois définitions de « la nuit » coexistent : moteur 20 h-8 h ; aide du catalogue « Jamais entre 20 h et 8 h » (`src/lib/automationCatalogue.ts:731-732`) ; validation 22 h-7 h ; prompt de Lumi « entre 21 h et 8 h » (`server/lib/lumi/generer-parcours.ts:292`).

#### 7.5 Bac à sable des envois

`server/lib/bac-a-sable.ts` :
- **Deux filets** : (1) le bureau est inscrit dans `orgs_envois_simules` (cache 30 s, modes `succes` / `panne` / `delai`) ; (2) le destinataire est fictif — numéro nord-américain `555-0100` à `555-0199`, ou adresse en `lume-qa.test` / `.invalid` (`:96-105`, `:118-130`).
- **Détournement** : texto → le client Twilio est enveloppé par un proxy qui consigne au lieu d'envoyer et rend un `sid` `SM_SIMULE_…` (`:170-197` ; `server/lib/config.ts:36`) ; courriel → `sendEmail` consigne et rend `messageId = simule-<id>` (`server/lib/mailer.ts:375`, `:404-412`) ; webhook sortant → consigné, réponse `{ simule: true }` (`server/lib/url-sortante.ts:158-170`).
- **Consigne** : table `envois_simules` (`org_id`, `canal` ∈ `sms` / `courriel` / `webhook`, `destinataire`, `sujet`, `corps`, `meta` avec `raison` et `mode`) (`bac-a-sable.ts:137-163` ; contraintes `SCHEMA_SNAPSHOT.md:8564-8568`, `:9339-9343`). Le reste du chemin (moteur, gabarit, désabonnement, plafonds, journaux `automation_execution_logs`, `messages`, `activity_log`) s'exécute à l'identique.
- **Panne simulée** : `panne` lève une erreur, `delai` lève un `TimeoutError` (`:156-161`).
- **Accès** : `envois_simules` et `orgs_envois_simules` ont la RLS activée et **0 policy** (`SCHEMA_SNAPSHOT.md:92`, `:189`) → `service_role` seulement. **Aucune route ni aucun écran** ne les lit ou n'inscrit un bureau (grep sans résultat dans `server/routes` et `src`).

---

### 8. Application mobile

**Il n'y a pas d'application mobile dans ce dépôt.** Aucun dossier `mobile`, `expo`, `ios`, `android`, `apps` ou `packages` ; aucune dépendance `expo`, `react-native`, `capacitor` ou `cordova` dans `package.json` ; aucun `app.json`, `eas.json`, `AndroidManifest.xml`, `.xcodeproj`. Les seuls fichiers « mobile » sont la porte (`src/lib/mobileGate.ts`, `src/pages/MobileAppGate.tsx`), son test (`tests/mobile-gate.test.ts`), un script QA (`scripts/qa/mobile.mjs`) et un test d'interface (`tests/automations-suite/ui/72-ui-modeles-langue-mobile.test.ts`).

Il n'existe donc aucun écran d'automatisations pour mobile. Sur un téléphone, `/automations` est remplacé par la porte (§1.3), dont les liens de magasin sont tous `null` (`MobileAppGate.tsx:33-37`).

---

### 9. Soupçons à vérifier

Chaque ligne : ce que dit le code, puis le test qui tranche. Rien ici n'a été exécuté.

| ID | Soupçon | Preuve dans le code | Test à faire |
|---|---|---|---|
| S-01 | Un membre qui a `automations.read` sans `automations.update` voit l'item de menu, passe la garde de route, puis tombe sur « Accès restreint » DANS la page liste. Il n'a aucun chemin cliquable vers la Vue d'ensemble, pourtant ouverte en `read`. | Route `read` `src/App.tsx:1654` ; menu `read` `:1145` ; contenu `update` `src/pages/Automations.tsx:1219` ; aperçu `read` `AutomationsApercu.tsx:83` | Créer un membre avec `read` seul. Cliquer « Automatisations » : noter ce qui s'affiche. Ouvrir `/automations/apercu` à la main. `GET /api/automations/rules` doit répondre 200. |
| S-02 | Le RBAC et la garde de forfait comparent le chemin EXACT. Express accepte par défaut une barre oblique finale et ignore la casse (aucun `strict routing` / `case sensitive routing` trouvé). `/api/automations/rules/generer/` (barre finale) ou `/api/Automations/rules` (casse) ne trouveraient aucune règle RBAC (« let route handler's own auth handle it ») ; la variante de casse échapperait en plus à `featureGuard` (`startsWith('/api/automations/')`, sensible à la casse). Reste la RLS — sauf pour les handlers en `service_role` : génération Lumi (crédits du bureau), routes d'événements. | `server/lib/route-permissions.ts:424-447`, `:521-522` ; `server/lib/feature-guard.ts:71-76` ; `automation-rules.ts:355-363` | Avec un jeton de technicien : `POST /api/automations/rules/generer/` (barre finale) avec une `demande` valide → attendu 403 ; si 200 ou 422 « Lumi… », la garde est contournée et des crédits sont consommés. Même test sur `POST /api/automations/events/lead-created/` et `GET /api/AUTOMATIONS/rules`. |
| S-03 | Le forfait n'est une vraie barrière que si `FEATURE_GUARD=enforce` ; le défaut du code est `log`. PostgREST et les outils Lumi / MCP ne vérifient jamais `includes_automations`. `/api/hooks/:cle` échappe aussi au paywall d'abonnement. | `server/lib/feature-guard.ts:49-52`, `:64-69` ; `server/index.ts:385`, `:820-825` ; grep vide dans `server/lib/agent` | Compte au forfait sans automatisations (propriétaire) : `GET /api/automations/rules` → 403 `feature_not_in_plan` attendu. Puis lecture directe `GET /rest/v1/automation_rules` avec le même jeton. Valeur réelle de `FEATURE_GUARD` en prod : introuvable dans le dépôt. |
| S-04 | Écritures directes PostgREST sans les gardes du serveur. (a) `updateRuleMessage` réécrit `actions` / `steps` sans Zod (pas de longueur max, pas de contrôle des variables), sans détacher une copie liée (`modele_id`) ni propager aux copies, sans la garde « publiée cassée ». (b) Avec `automations.update`, la RLS laisse modifier `is_active`, `is_preset`, `preset_key`, `trigger_event`, `deleted_at`, `purged_at` et supprimer pour de bon une ligne (privilège `ALL`, policy DELETE). | `src/lib/automationRulesApi.ts:83-157` ; serveur `automation-rules.ts:506-554`, `:759-763` ; `SCHEMA_SNAPSHOT.md:4708-4716` ; `01_schema.sql:57557` | (a) Sur une copie liée, modifier un texto depuis Réglages › Messagerie, puis vérifier si le lien au modèle subsiste et si l'original l'écrase ensuite. (b) Jeton admin : `PATCH /rest/v1/automation_rules?id=eq.<id>` avec `{"is_active":true}` sur un parcours incomplet ; `DELETE` sur un préréglage. |
| S-05 | La corbeille n'est pas respectée partout. `PATCH /rules/:id` avec `{ is_active: true }` passe sur une règle à la corbeille (la route de publication, elle, répond 422). `POST /:id/duplicate` ressuscite une règle supprimée définitivement. `GET /editeur` ouvre une règle à la corbeille. | `automation-rules.ts:493-498`, `:532-535`, `:694-699`, `:178` ; comparer `automations-publication.ts:69-74` | Mettre une règle à la corbeille puis `PATCH … {"is_active":true}` → noter le code. Supprimer définitivement puis `POST …/duplicate`. Ouvrir `/automations/<id d'une règle en corbeille>`. |
| S-06 | `GET /api/automations/test` renvoie à tout propriétaire / admin d'un bureau client des détails de la PLATEFORME (8 premiers caractères du SID Twilio, numéro Twilio de la plateforme, utilisateur SMTP) et les coordonnées d'un client. Contrôles périmés : 18 préréglages attendus, `TWILIO_PHONE_NUMBER` et `SMTP_USER` au lieu du numéro du bureau et du fournisseur réel. Messages en anglais. Appelée par aucun écran. | `server/routes/automation-test.ts:62-73`, `:118-120`, `:260-278` ; grep `automations/test` dans `src` : vide | Jeton admin d'un bureau de test : `GET /api/automations/test` et lire `results`. |
| S-07 | Des événements exigent `automations.update` alors que l'action relève d'un autre droit : `deal-stage-changed` (appelé par l'ancien `pipelineApi`), `quote-sent`, `lead-created`, `lead-status-changed`. Pour un vendeur : 403, avalé en silence (`fireEvent` ne lit pas la réponse). `job-completed` exige `jobs.complete`, que `sales_rep` n'a pas. `emitQuoteSent`, `emitLeadCreated`, `emitLeadStatusChanged` ne sont plus appelés nulle part. | `server/lib/route-permissions.ts:140-146` ; `src/lib/automationEventsApi.ts:21-33`, `:70-92` ; `src/lib/pipelineApi.ts:398`, `:452` | Vendeur : déplacer une carte de l'ancien pipeline, onglet Réseau → statut de `…/events/deal-stage-changed`. Vendeur : terminer un job → statut de `…/events/job-completed`. |
| S-08 | « Tout arrêter » et la langue des envois demandent le RÔLE propriétaire / admin en base, alors que l'interface et le RBAC ne demandent que `automations.update`. Par ailleurs un refus RBAC arrive en anglais technique (`Permission denied: automations.update`) et peut s'afficher tel quel dans un toast (`erreurDe` montre `error`). | `automation-rules.ts:1068-1087` ; policy `company_settings_update_org` (`SCHEMA_SNAPSHOT.md:4895-4897`) ; `route-permissions.ts:540` ; `src/lib/automationBuilderApi.ts:89-97` | Membre non admin avec `automations.update` : cliquer « Tout arrêter » puis changer la langue ; lire le message. Retirer `automations.update` à un admin et cliquer un bouton d'écriture : lire le toast. |
| S-09 | Lumi : (a) `set_automation_language` n'est pas dans `JAMAIS_D_OFFICE`, contrairement aux quatre autres écritures ; (b) la détection « terminer un job écrit au client » lit `actions` seulement — une règle créée par Lumi a `actions: []` et tout dans `steps` — et ignore `deleted_at` ; (c) le routeur envoie « pourquoi l'automatisation a pas parti » vers `equipe`, qui n'a pas l'outil de diagnostic ; (d) les refus de publication reviennent toujours en français. | `server/lib/agent/registre.ts:86-101` ; `server/lib/lumi/execution.ts:113-121` ; `tools-reglages.ts:489-492`, `:365` ; `routeur.ts:223` vs `topics.ts:72-88` | (a) Mode « tout » : « mets les messages automatiques en anglais » → carte ou exécution directe ? (b) Créer par Lumi une règle sur « job terminé » avec texto, la publier, puis « termine le job X » en mode `argent`. (c) Poser la question et regarder si un outil est appelé. (d) Interface en anglais : demander d'activer un parcours incomplet. |
| S-10 | Vocabulaire différent pour le même objet. Statut : interface « Publiée / Brouillon », carte Lumi « active / en pause », aide « l'activer ou la mettre en pause ». Déclencheur : la carte Lumi et `list_automations` exposent la clé technique (`quote.sent`). Nom d'un préréglage : traduit dans la liste (`automationNames.ts`), autre table dans Réglages › Messagerie (`RULE_LABELS_FR`, français seulement), « Demande d'avis » dans Réglages › Avis, nom brut dans Lumi. En anglais : menu « Automations », onglet de page « Workflows », palette « Automations », recherche « Open automations ». | `server/lib/lumi/apercu-action.ts:141` ; `tools-etendus.ts:912` ; `src/components/supportArticles.ts:126` ; `src/pages/SettingsMessaging.tsx:379-395` ; `src/lib/automationNames.ts:21-70` ; `src/pages/Automations.tsx:1205-1206`, `:1227-1229` ; `CommandPalette.tsx:103` | Relever le nom et le statut du MÊME préréglage dans la liste, l'éditeur, Réglages › Messagerie, Réglages › Avis, la carte Lumi et le journal, en français puis en anglais. |
| S-11 | L'aide contredit l'écran. L'article dit « Rien ne se supprime : une règle inutile se met en pause » (il y a une corbeille et une suppression définitive) et « La langue des messages… se règle… dans Automatisations » (le réglage est dans Paramètres → Entreprise ; la fiche de l'assistant de support dit « Paramètres entreprise »). | `src/components/supportArticles.ts:126-127`, `:238-239` ; `src/pages/CompanySettings.tsx:610-625` ; `server/lib/support/carte-app.ts:94` | Ouvrir l'aide, lire les deux articles, comparer à l'écran. Poser la question de la langue à l'assistant de support et à l'article. |
| S-12 | Réglages › Messagerie : (a) la page s'ouvre avec `settings.read` (vendeur, technicien) mais la liste vient de la RLS `automations.read` → « Aucune automatisation SMS configurée pour cette organisation. » pour eux, faux ; (b) les règles texto dont le déclencheur n'est pas dans les 5 groupes sont comptées dans « N automatisations actives » mais jamais affichées ; (c) un échec de l'interrupteur (publication refusée, 403) est annulé sans aucun message. | `src/App.tsx:1619` ; `SettingsMessaging.tsx:397-403`, `:473-477`, `:482-490`, `:529-538` | (a) Technicien d'un bureau qui a un numéro : ouvrir `/settings/messaging`. (b) Créer une règle texto sur « Étiquette ajoutée », la publier, comparer le compteur et la liste. (c) Basculer une règle au parcours incomplet. |
| S-13 | Limites de longueur d'un texto incohérentes : 160 (consigne de Lumi), 320 (zones de texte des Réglages), 1 600 (catalogue, donc Zod du serveur), 1 600 et 5 000 (outils Lumi, sans validation serveur), aucune limite par l'UPDATE direct. | `generer-parcours.ts:322-323` ; `SettingsMessaging.tsx:563`, `SettingsReviews.tsx:702` ; `src/lib/automationCatalogue.ts:735` ; `tools-reglages.ts:654`, `:680` | Coller 400 caractères dans l'éditeur, puis dans Réglages › Messagerie ; demander à Lumi un texto de 2 000 caractères via `update_automation_message`. |
| S-14 | Le générateur propose des déclencheurs réservés à une capacité non activée pour le bureau : le prompt liste tout le catalogue, la route vérifie seulement que la clé existe. La règle serait enregistrable mais ne partirait jamais. La vérification des variables inventées ne couvre pas la 2e automatisation (`autre`). | `generer-parcours.ts:188-190`, `:690` ; `automation-rules.ts:151-157`, `:384-391` | Bureau sans le drapeau `auto_client_inactif` : « écris à mes clients inactifs depuis 6 mois » → déclencheur proposé ? S'enregistre-t-il, se publie-t-il ? |
| S-15 | Les appels reçus sur une adresse d'appel sont tracés (corps complet, donc données de prospects) mais ne sont lisibles nulle part dans l'app ; la policy les ouvre à `automations.read` par PostgREST. Ni cette table ni `automation_webhooks` n'ont la policy `bureau_actif`. | `webhooks-entrants.ts:205-207`, `:223-225` ; `SCHEMA_SNAPSHOT.md:4729-4740` | Chercher un journal des appels dans Réglages globaux › Adresses d'appel. Compte à deux bureaux : `GET /rest/v1/automation_webhook_receipts` avec l'en-tête du bureau A, vérifier qu'aucune ligne du bureau B ne sort. |
| S-16 | Points d'entrée visibles par des rôles qui n'ont pas le droit : palette (toujours), recherche (toujours), menu Réglages (toujours), lien Paiements (`settings.read`), lien du Pipeline. Tous mènent à « Accès restreint » pour un vendeur ou un technicien. Le lien Paiements est un `<a href>` : rechargement complet de l'app. | §2, EXT-002 à EXT-005, EXT-012 | Technicien : Ctrl+K → « Automations » ; Réglages → « Automatisations » ; noter l'écran. Admin : cliquer le lien dans Lume Payments et observer le rechargement. |
| S-17 | La clé complète d'une adresse d'appel pourrait redevenir lisible dans un environnement reconstruit depuis la baseline : celle-ci accorde encore SELECT / INSERT / UPDATE de table à `authenticated`, alors que deux migrations les ont réduits à des colonnes sans `api_key`. | `supabase/baseline/01_schema.sql:57583` ; `supabase/migrations/20261003100100_securite_automatisations.sql` ; `20261004100100_cle_webhook_non_choisie.sql` | Jeton admin : `GET /rest/v1/automation_webhooks?select=api_key` → attendu « permission denied ». À faire sur staging ET sur tout environnement issu de `db:bootstrap`. |
| S-18 | `deal-stage-changed` émet un événement sur un `dealId` reçu du navigateur sans vérifier qu'il appartient au bureau. | `server/routes/automation-events.ts:248-296` | Jeton admin du bureau A : `POST …/events/deal-stage-changed` avec un `dealId` du bureau B, puis chercher une ligne dans les journaux d'A. |
| S-19 | La notification d'échec d'une automatisation est en français seulement, sans destinataire précis, et ne mène nulle part : la cloche n'a aucune navigation. Les motifs d'échec d'une demande d'avis sont en anglais dans le journal. | `automationEngine.ts:1523-1530` ; `NotificationBell.tsx:137-198` ; `actions/index.ts:1948-1952` | Provoquer un échec (client sans téléphone), ouvrir la cloche en anglais, cliquer la notification. Lire l'onglet Journaux d'une demande d'avis avec les avis désactivés. |
| S-20 | Aucun bouton des pages Automatisations n'est caché ou désactivé selon le rôle ; tout repose sur la garde de page et sur le refus du serveur. La porte mobile et plusieurs textes (Modèles de courriel, porte mobile) n'existent qu'en français. | grep `usePermissions` vide dans `src/pages/Automation*.tsx`, `src/components/automations/*.tsx` ; `EmailTemplatesSettings.tsx:407-427` ; `MobileAppGate.tsx:63-73` | Interface en anglais : ouvrir Réglages → Modèles de courriel et `/apercu-mobile`. |
| S-21 | Commentaire périmé : l'en-tête de `gabarit.ts` annonce une mascotte au pied des courriels client ; le code l'a retirée. | `server/lib/courriels/gabarit.ts:13-14` vs `:497-500` | Déclencher un courriel d'automatisation en bac à sable et lire `envois_simules.corps` : aucune image ni mention Lume attendue. |
| S-22 | `/automations/hub` et `/automations/builder` sont déclarées après `/automations/:id`. Si le classement de React Router ne joue pas, elles ouvriraient l'éditeur sur un identifiant « hub » (« introuvable »). | `src/App.tsx:1668-1670` | Ouvrir les deux URL ; attendu : retour à `/automations`. |
