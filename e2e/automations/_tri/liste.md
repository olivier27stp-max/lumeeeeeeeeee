# liste — 75 échecs à la passe, après tri : 49 défauts, 23 specs réparées, 0 environnement, 3 fragiles

Dernière relance (dossier entier, pile locale, un worker, MES ports 48423 / 48304 / 5195) : **205 tests — 156 passés, 49 échoués** (23,0 min).
Les 49 échecs portent tous ` @defaut` et tombent chacun sur l'attente qui décrit le défaut (relevé ligne à ligne dans
`D:/lume-uiaudit/sorties/tri-liste/relance-dossier.txt`). Aucun test sans marque n'échoue ; aucun test `@defaut` ne passe.

Numéros de ligne = fichiers tels qu'ils sont sur disque après le tri (`e2e/automations/liste/`).

À savoir pour lire ce tri : d'après `D:/lume-uiaudit/sorties/liste/a-relancer.md`, **177 des 201 tests du dossier n'avaient jamais tourné**
avant la passe locale (staging était tombé pendant leur écriture). Les `@defaut` étaient donc des SOUPÇONS ; chacun de ceux qui
restent est maintenant un constat vu rouge pour la bonne raison. Et une partie des « specs réparées » ne vient pas d'un changement
du produit mais d'une attente fausse dès l'écriture : c'est dit à chaque fois.

Aucun de ces défauts n'a de numéro au tableau des constats (§ 8 de `AUTOMATIONS_UI_AUDIT.md`), sauf « Anniversaire client » (liste-12).
Les gravités sont mon estimation.

## Défauts du produit encore ouverts

| Identifiants | Spec:ligne | Écran | Ce qu'on fait | Ce qu'on voit | Ce qu'on devrait voir | Gravité |
|---|---|---|---|---|---|---|
| LST-075, S-32 | 05-lignes:488 | Liste › flèche « Voir les messages » d'une automatisation à l'ancien format qui envoie DEUX textos | Corriger le premier texto, « Enregistrer ». | « Message enregistré ». En base, les deux textos portent maintenant le même texte : le second, que personne n'a touché, est écrasé (`updateRuleMessage` réécrit toutes les actions du même type). Il partira aux clients avec le texte du premier. | Seul le texto modifié change. | majeur |
| LST-054, S-22 | 07-lot:188 | Liste › barre de lot | Cocher une automatisation « Client inactif » en brouillon, « Publier (1) ». | Elle est publiée d'un coup (ligne « Publiée »), sans rien demander. L'interrupteur de la même ligne, lui, annonce combien de clients seront contactés et demande « Activer « Client inactif » ? ». | La même confirmation, avec le nombre de clients visés, avant de publier en lot. | majeur |
| LST-020, LST-002, LST-003, S-01 | 12-permissions:86, :102 | Menu de gauche (« Plus » › « Automatisations ») et sous-navigation de la Vue d'ensemble, pour un rôle qui a « voir les automatisations » sans « modifier » | Cliquer « Automatisations » dans le menu, ou le lien « Automatisations » depuis la Vue d'ensemble (qui, elle, s'ouvre). | « Accès restreint — Vous n'avez pas la permission de voir cette page. » On lui montre la porte puis on la lui ferme : le menu et la route demandent « voir », la page exige « modifier ». En arrière-plan la page lance quand même ses lectures et reçoit des 403 (bureaux cibles). | La liste en lecture seule — ou pas d'entrée de menu ni de lien pour ce rôle. | majeur |
| LST-021 | 10-volume:210 | Liste › onglet « À vérifier » | Une automatisation a échoué avant-hier ; depuis, une autre a échoué 205 fois. | Seule la bruyante est dans « À vérifier (1) » : la lecture s'arrête aux 200 échecs les plus récents, l'autre sort de l'onglet alors qu'elle échoue toujours. | Les deux automatisations, « À vérifier (2) ». | majeur |
| LST-021, S-26 | 03-onglets-etats:229 | Liste › onglet « À vérifier » quand la lecture des échecs est en panne (500) | Ouvrir l'onglet alors qu'une automatisation échoue. | « À vérifier (0) » et « Aucune erreur — tout roule ». | L'écran dit qu'il n'a pas pu lire les échecs ; jamais « tout roule ». | majeur |
| LST-076, LST-083 (nouveau, né du correctif de S-07) | 11-clavier:178 | Liste › menu ⋮ d'une ligne, au clavier | Entrée sur ⋮ (le menu s'ouvre sous le bouton), puis Tab. | Le focus part sur « Lignes par page », puis « Aide et support », et n'arrive à « Modifier » qu'ensuite — sur une liste d'UNE ligne. Sur dix lignes, il faut traverser toutes les lignes suivantes. Le menu est dessiné dans un portail en fin de page (`createPortal`, #859) : il n'est plus à la suite de son bouton dans l'ordre de tabulation. | Tab (ou les flèches) entre dans le menu dès qu'il est ouvert. | majeur (accessibilité) |
| LST-076 | 11-clavier:209 | Liste › menu ⋮ au clavier | Entrée sur ⋮, puis Tab : le focus quitte le bouton. | Le menu reste ouvert derrière, par-dessus les lignes. | Quitter le menu au clavier le referme. | mineur |
| LST-015, S-08 | 11-clavier:161 | Liste › menu « Créer » au clavier | Entrée sur « Créer », puis flèche bas. | Rien : le focus reste sur le bouton, les flèches ne parcourent pas le menu. | Le focus entre dans le menu ; les flèches le parcourent. | mineur |
| LST-020, S-51 | 11-clavier:50 | Liste › onglets (« Toutes », « À vérifier »…) | Focus sur « Toutes », flèche droite. | Rien : quatre arrêts de tabulation, les flèches sans effet (rôle `tab`). | La flèche passe à l'onglet suivant. | mineur |
| LST-011 | 11-clavier:113 | Liste › « Nouveau dossier » au clavier | Entrée sur « Nouveau dossier », puis Échap dans le champ. | Le champ disparaît et le focus retombe sur le corps de la page. | Le focus revient sur « Nouveau dossier ». | mineur |
| LST-093, LST-095 | 08-confirmation:91, :107 | Dialogue de confirmation (« Supprimer cette automatisation ? », « Arrêter toutes vos automatisations ? ») | Tab deux fois dans le dialogue ; ou l'ouvrir au clavier puis Échap. | Au 2e Tab le focus part dans la page derrière. À la fermeture il ne revient pas sur le bouton qui a ouvert le dialogue. | Le focus reste dans le dialogue, puis revient d'où il est parti. | mineur |
| LST-098, LST-099, LST-100, LST-103, S-11 | 09-copier-bureaux:221, :231, :241 | Modale « Copier vers d'autres bureaux » | Échap ; ou regarder où est le focus à l'ouverture ; ou cliquer hors de la modale pendant que la copie est en cours. | Échap ne ferme rien. Le focus reste dans la liste derrière. Un clic sur le fond pendant la copie ferme la modale : la copie se fait, mais le compte rendu par bureau n'est jamais vu. | Échap ferme ; le focus entre dans la modale ; pendant la copie elle ne se ferme pas. | mineur |
| LST-078, S-19 | 06-menu-actions:217 | Liste › menu ⋮ › « Dupliquer » | Recliquer ⋮ puis « Dupliquer » pendant que la première copie se crée (la roue remplace ⋮, mais le bouton reste cliquable). | Deux copies. | Une seule copie. | mineur |
| LST-078, S-17 | 06-menu-actions:255 | Liste, après « Dupliquer » (et tout geste qui recharge la liste) | Dupliquer une automatisation. | Tout le tableau est retiré et remplacé par une roue, puis revient : l'écran clignote, la position de lecture est perdue. | Le tableau reste à l'écran pendant le rechargement. | mineur |
| LST-020 | 03-onglets-etats:143 | Liste, au chargement | Ouvrir la page quand les statistiques répondent lentement. | Les automatisations sont déjà lues, mais le tableau reste une roue tant que les échecs PUIS les statistiques n'ont pas répondu (trois lectures à la suite). | La liste dès qu'elle est lue ; les chiffres arrivent ensuite dans leurs colonnes. | mineur |
| LST-020 | 03-onglets-etats:130 | Liste, au chargement | Ouvrir la page avec un lecteur d'écran. | Une roue muette (aucun `role="status"`, aucun texte). | « Chargement… » annoncé. | mineur |
| LST-060 | 03-onglets-etats:184 | Liste quand la lecture des automatisations est en panne | Regarder les onglets. | L'alerte « Impossible de charger… » est bien là, mais les onglets affichent « Corbeille (0) » alors que la corbeille n'est pas vide. | Pas de compteur tant que la lecture a échoué. | mineur |
| LST-080, S-28 | 02-dossiers:354 | Liste › menu ⋮ › « Déplacer dans un dossier » quand la lecture des dossiers est en panne (500) | Cliquer « Déplacer dans un dossier ». | La barre de dossiers a disparu sans un mot et l'écran dit « Créez d'abord un dossier. » — il en existe un. | L'écran dit que les dossiers n'ont pas pu être lus. | mineur |
| LST-023, LST-024, S-04 | 03-onglets-etats:86, :96 | Liste › onglets et adresse de la page | Ouvrir « Corbeille » puis recharger ; ou arriver par `?onglet=verifier` puis cliquer « Toutes ». | Le rechargement ramène sur « Toutes » ; l'adresse garde `?onglet=verifier` alors qu'on est sur « Toutes » (un lien copié rouvre le mauvais onglet). | L'onglet ouvert est dans l'adresse et survit au rechargement. | mineur |
| LST-020 | 03-onglets-etats:266 | Liste d'un bureau sans aucune automatisation | Regarder l'état vide. | « Aucune automatisation », seul. | L'état vide propose de créer (ou de partir d'un modèle). | mineur |
| LST-035, S-40 | 03-onglets-etats:277 | Liste › recherche | Chercher un texte qu'aucune automatisation ne porte. | « Aucune automatisation » — le bureau en a 35. | « Aucun résultat » pour cette recherche. | mineur |
| LST-034, S-40 | 04-filtres-recherche-tri:160 | Liste › « Filtres avancés » | Choisir « Statut : Brouillon », refermer le panneau. | La liste est vide et rien ne rappelle qu'un filtre est actif (le bouton dit « Filtres avancés », sans plus). | Le bouton signale le filtre actif. | mineur |
| LST-035 | 04-filtres-recherche-tri:99, :106 | Liste › recherche | Taper « elan d'ete » pour « Élan d'été » ; ou le nom entouré d'espaces. | Rien n'est trouvé. | La recherche ignore les accents et les espaces autour du texte. | mineur |
| LST-035, S-41 | 04-filtres-recherche-tri:113, :123 | Liste › recherche | Chercher un mot de la description interne ; ou chercher « Facture payée », écrit sous le nom de la ligne. | Le premier trouve une ligne qui ne montre le mot nulle part ; le second ne trouve rien alors que le texte est à l'écran. | On trouve ce qu'on voit, et on voit pourquoi une ligne est trouvée. | mineur |
| LST-039, LST-043, S-39 | 04-filtres-recherche-tri:205 | Liste › filtre « Catégorie » | Créer soi-même une automatisation sur « Devis envoyé » ; filtrer « Devis ». | Elle n'y est pas : toute automatisation personnelle est rangée dans « Suivi ». | Rangée d'après son déclencheur. | mineur |
| LST-050, LST-062, S-42 | 04-filtres-recherche-tri:264, :413 | Liste › menu « Trier » et en-têtes de colonnes | Choisir « Créées le plus récemment », puis cliquer l'en-tête « Nom » ; ou cliquer trois fois un en-tête. | La liste est triée par nom mais « Trier » affiche toujours « Créées le plus récemment » ; le 3e clic repart en croissant, on ne peut plus revenir à l'ordre par défaut. | Un seul tri affiché à la fois ; un 3e clic lève le tri. | mineur |
| LST-070, S-38 | 05-lignes:119 | Liste › sous-titre d'une ligne dont le déclencheur n'est pas au catalogue | Regarder la ligne. | La clé technique (« e2e.declencheur_inconnu · Immédiat »). | Un libellé lisible (« Déclencheur inconnu »). | mineur |
| LST-070, DEC-15 (liste-12, « NON FAIT » au tableau) | 05-lignes:127 | Liste › ligne « Anniversaire client » | Lire le sous-titre. | « Nouveau prospect · 12 mois après » : l'anniversaire est celui de la fiche. | Un nom ou un déclencheur qui dise ce qui se passe. | mineur — décision de produit |
| LST-070, S-43 | 05-lignes:148 | Liste › avertissement « Les demandes d'avis sont désactivées… Activez-les dans Paramètres › Avis clients. » | Cliquer l'avertissement. | L'éditeur de l'automatisation s'ouvre (le texte est dans le bouton du nom). | Les réglages d'avis. | mineur |
| LST-074, S-23 | 05-lignes:336 | Liste › interrupteur d'une automatisation « Client inactif » | Cliquer l'interrupteur pendant que le serveur compte les clients. | Rien ne bouge tant que le décompte n'est pas revenu : on croit que le clic n'a pas pris. | L'interrupteur montre qu'il travaille. | mineur |
| LST-075, S-06 | 06-menu-actions:433 | Corbeille › flèche « Voir les messages » | Déplier les messages d'une automatisation supprimée. | Le texto est modifiable et enregistrable. | Lecture seule. | mineur |
| LST-054, LST-055, S-21 | 07-lot:179 | Liste › barre de lot | Cocher une automatisation déjà publiée. | « Publier (0) » est actif ; son clic vide la sélection sans un mot. | « Publier (0) » et « Repasser en brouillon (0) » grisés. | mineur |
| LST-054, S-25 | 07-lot:159 | Liste › publier en lot deux parcours impubliables | « Publier (2) ». | Les deux refus sont collés sur une ligne continue (le saut de ligne du message n'est pas rendu). | Un refus par ligne. | mineur |
| LST-069, S-20 | 07-lot:97 | Liste › cases à cocher | Cocher une ligne. | La barre de lot s'insère au-dessus du tableau : toutes les lignes descendent de 70 px sous la souris, le clic suivant tombe sur une autre ligne. | Le tableau ne bouge pas. | mineur |
| LST-061 | 10-volume:164 | Liste de 60 automatisations (plusieurs pages) | « Tout cocher ». | 10 lignes cochées, et rien ne propose d'étendre aux 60. | « Sélectionner les 60 ». | mineur |
| LST-078, S-37 | 13-libelles-et-complements:143 | Liste, interface en anglais › « Duplicate » quand le serveur répond une erreur sans message (502) | « Duplicate ». | « Impossible de dupliquer l'automatisation. » : le message de repli n'existe qu'en français. | Le message en anglais. | mineur |
| LST-027, S-43 | 02-dossiers:150 | Liste › fil d'Ariane, un dossier ouvert | Ouvrir un dossier. | « Accueil », texte fixe : il ne dit pas où l'on est et ne ramène nulle part. | « Accueil › nom du dossier », cliquable. | mineur |
| LST-073 | 05-lignes:78 | Corbeille › ligne d'une automatisation supprimée restée « active » en base | Regarder la ligne. | « Supprimée » à gauche, interrupteur vert (allumé, grisé) à droite. | Interrupteur éteint. (État incohérent : la suppression par l'écran remet bien `is_active` à faux.) | cosmétique |
| LST-061 | 07-lot:66 | Liste › case « Tout cocher » | Cocher une ligne sur deux. | Case vide. | État intermédiaire (tiret). | cosmétique |
| LST-033 | 02-dossiers:283 | Liste › supprimer un dossier | Confirmer la suppression. | Le dossier disparaît, sans un mot (créer un dossier, lui, dit « Dossier créé »). | « Dossier « … » supprimé ». | cosmétique |
| LST-072, S-43 | 05-lignes:409 | Liste › panneau « Stats » d'une ligne | Lire « Le détail est dans l'onglet « Journaux » de l'automatisation. ». | Un texte, sans lien. | Un lien vers les Journaux. | cosmétique |

49 tests pour 41 défauts.

## Défauts corrigés depuis (marqueur @defaut retiré)

**16 tests `@defaut` passaient à la passe** et passent à la relance ; ` @defaut` retiré du titre :

- `01-barre-haut:47` — S-05, liste-03 : sous-navigation en liens, `aria-current` (#870, `SousNavigation.tsx`).
- `01-barre-haut:137` — liste-08 : le double clic sur « Tout arrêter » laisse la confirmation (#870, `confirmerSansDoubleClic.ts`).
- `01-barre-haut:251` — S-51, liste-04 : FR / EN avec `aria-pressed` et groupe nommé (#870).
- `01-barre-haut:378` — S-09, liste-07 : ouvrir « Créer » referme le menu ⋮.
- `02-dossiers:339` — S-10 : le sous-menu des dossiers est replié à la réouverture du menu ⋮.
- `03-onglets-etats:105` — S-51, liste-04 : onglets reliés à leur panneau (#870).
- `04-filtres-recherche-tri:297` — liste-13 : « 2 » avant « 10 » (#870, `parNomAffiche`).
- `05-lignes:503` — S-47, liste-10 : variables remplacées par un exemple dans l'aperçu d'un parcours (#870).
- `05-lignes:519` — S-36, liste-11 : « Texto », plus « SMS » (#870, `MessageEditor.tsx`).
- `06-menu-actions:76` et `:93` — S-07, liste-01 : le menu ⋮ de la dernière ligne et son sous-menu sont entiers (#859, portail).
  `:93` a de plus été rendu déterministe (voir « Fragiles »).
- `06-menu-actions:418` — S-06, EDITEUR-01 : une automatisation à la corbeille n'ouvre plus l'éditeur (#859). Le test passait en 1,1 min
  (il attendait 60 s un onglet qui ne vient plus, puis se contentait de trouver « corbeille » quelque part) : il affirme maintenant
  l'adresse, le message « Cette automatisation est à la corbeille… », le bouton « Restaurer », ni canevas ni interrupteur — 3 s.
- `10-volume:190` — liste-14 : la bulle d'aide ne recouvre plus la pagination (#870).
- `11-clavier:150` et `:197` — S-08, liste-06 : Échap ferme « Créer » et le menu ⋮, le focus revient au bouton (#859).
- `13-libelles-et-complements:133` — S-35, liste-09 : « Build with Lumi » dans l'en-tête comme dans le menu.

**3 défauts corrigés dont le test restait rouge pour une autre raison** (comptés dans « Specs réparées ») : S-27 (`01:144`), S-31 (`01:233`),
ordre par défaut (`04:305`).

**1 soupçon infirmé** : `13-libelles-et-complements:47` (préréglage semé en double) — voir « Specs réparées », n° 12.

## Specs réparées (ce qui avait changé dans le produit, et le commit ou le fichier qui le prouve)

23 tests rouges à la passe, verts à la relance.

**A. Le produit a changé exprès (20 tests)**

1. `01-barre-haut:25`, `:37`, `11-clavier:29` — la sous-navigation est faite de LIENS (`src/components/automations/SousNavigation.tsx`,
   commit 963851e0, #870). La pastille « Bêta » est restée DANS le lien « Vue d'ensemble ». Les tests cherchent des liens, vérifient
   leur `href` ; l'ordre de tabulation attendu (`11:29`) part du lien et dit « Prêtes à publier (0) ».
2. `01-barre-haut:117` (clics répétés sur « Tout arrêter ») — le test affirmait l'ancien comportement (le dialogue disparaît sous le second
   clic). Depuis #870 (`confirmerSansDoubleClic.ts`) il reste : le test exige le dialogue, UN seul, zéro requête avant confirmation, une seule après.
3. `01-barre-haut:144` (S-27, liste-02) — défaut corrigé (#859 / #870, `BandeauPause.tsx` : « Impossible de savoir si vos automatisations
   sont en pause… », « Réessayer », « Tout arrêter » conservé). Le test tombait sur le moniteur : la panne simulée est maintenant consignée
   dans la console. Déclarée attendue ; le test exige le message, le bouton d'urgence actif, puis « Réessayer » qui rétablit l'écran. ` @defaut` retiré.
4. `01-barre-haut:233` (S-31, liste-05) — même cas (#870, `Automations.tsx`, `langueIllisible`) : le test exige « Langue actuelle inconnue »
   et qu'AUCUNE des deux langues ne soit surlignée (`aria-pressed="false"` sur FR et EN). ` @defaut` retiré.
5. `01-barre-haut:391` (LST-001, liste-17) — la croix de la fenêtre de forfait s'appelle « Fermer » en français (`PlanUpgradeModal.tsx`, #870 ;
   elle disait « Close »). Le test exige « Fermer », l'absence de « Close », et que la fenêtre se ferme puis se rouvre vraiment.
6. `03-onglets-etats:20`, `:78` (`?onglet=modeles`), `:245`, `:290`, `05-lignes:35`, `:288`, `06-menu-actions:377`, `13-libelles:74`, `:109` —
   l'onglet « Modèles » s'appelle « Prêtes à publier » / « Ready to publish », le bouton de l'état vide « Voir les automatisations prêtes à
   publier » (commit 56f5f820, `Automations.tsx` l. 1283-1286 et 1836). `03:20` exige en plus la liste exacte des quatre onglets ; `13:109`
   celle des quatre onglets anglais. Attentes NÉGATIVES restées sur l'ancien libellé, qui passaient à vide, remises sur le nouveau :
   `02-dossiers:167`, `03:209`, `03:255` (« Voir les modèles »), et « Prêtes », « publier » ajoutés aux mots français interdits en anglais (`13:107`).
7. `03-onglets-etats:290`, `04-filtres-recherche-tri:171`, `:215` — le préréglage RETIRÉ « Estimate Follow-Up » (`estimate_followup` sur
   `estimate.sent`) reste en base, publié, mais la liste ne le montre plus (commit 098dd153, `src/lib/automationRulesApi.ts` l. 59-61,
   `estPrereglageRetire`). Les décomptes « égaux à la base » le comptaient (36 contre 35 à l'écran ; « Devis » 6 contre 5). Ils sont
   relus en base à l'instant et l'écartent (`reglesAffichables`, `_aides.ts`) ; `04:171` affirme en plus que le total affiché est
   exactement « publiées ou personnelles » et que le préréglage retiré n'est pas à l'écran. Même précaution posée dans `10-volume:35`,
   qui passait par chance (240 et 241 donnent le même nombre de pages).
8. `04-filtres-recherche-tri:305` (ordre par défaut, liste-13) — défaut corrigé (#870, `parNomAffiche` : nom AFFICHÉ, sans accents ni casse,
   nombres lus comme des nombres). Le test comparait à un tri sans l'option « nombres » (« 14 jours » avant « 3 jours »). Il exige maintenant
   l'ordre du produit calculé par le navigateur, prouve qu'il ne s'agit pas des noms stockés, et que « 3 jours » précède bien
   « 14 jours ». ` @defaut` retiré.
9. `06-menu-actions:50` (un seul menu ⋮ à la fois) — le menu d'une ligne est dessiné par-dessus la page (portail, #859) : celui de A
   recouvre le bouton ⋮ de la ligne du dessous, qu'on ne peut plus cliquer « à travers ». Le test ouvre B puis A, exige un seul menu, et
   qu'il soit ancré sous le bouton de A.

**B. Spec jamais exécutée, attente fausse dès l'écriture (3 tests — le produit n'a pas changé)**

10. `08-confirmation:26` (bouton rouge) — la couleur était lue dans `rgb(…)` ; le navigateur l'écrit `oklch(0.577 0.245 27.325)`
    (relevé au tri) et le test lisait « rouge = 0 ». La couleur est peinte sur un pixel puis relue (`couleurDeFond`, `_aides.ts`).
    L'attente NÉGATIVE voisine (`08:135`, « Activer » n'est pas rouge), comparée à `rgb(220, 38, 38)`, passait à vide : même correctif.
11. `13-libelles-et-complements:182` (« Fermer » de l'éditeur de courriel) — deux boutons s'appellent « Fermer » (la croix de l'en-tête, là
    depuis f14d9096, et le bouton du pied) : sélecteur ambigu. Le test exige les deux et clique celui qui porte le mot.
12. `13-libelles-et-complements:47` (préréglage semé en double, ex-`@defaut`) — SOUPÇON INFIRMÉ : la base refuse deux automatisations
    de même clé de préréglage dans un bureau (index unique `idx_automation_rules_org_preset`,
    `supabase/migrations/20260401000000_dedup_automation_presets.sql`, repris dans `supabase/baseline/01_schema.sql`). Le cas « la publiée
    devient invisible » ne peut pas se produire. Le test affirme la garde : erreur 23505 sur la seconde, la même clé permise dans
    l'autre bureau, la première seule en base et visible dans « Prêtes à publier ». ` @defaut` retiré.

(20 tests dans les entrées 1 à 9, 3 dans les entrées 10 à 12.)

## Tests fragiles (rendus déterministes)

Trois des 75 échecs :

1. `05-lignes:210` (« cinq clics rapides : jamais deux requêtes en même temps ») — **le produit a raison** : `src/lib/fileBascule.ts` n'envoie
   une requête qu'au retour de la précédente. Relevé au tri : requête → réponse 200 → requête suivante 2 ms plus tard, à la file. Le test
   comptait avec l'événement `requestfinished` du navigateur, qui n'est JAMAIS émis pour ces requêtes (la page ne lit pas le corps de la
   réponse) : le compteur ne redescendait pas (« 5 en même temps »). La mesure se fait maintenant au passage de la requête (`page.route` :
   comptée au départ, décomptée avant que la réponse soit rendue à la page) — elle ne dépend plus d'aucun délai.
2. `05-lignes:304` et `08-confirmation:120` (« Client inactif ») — le décompte vit derrière un drapeau d'entreprise
   (`org_features.auto_client_inactif`, `server/lib/automations-drapeaux.ts`) que rien ne posait pour le bureau A : 404 « Capacité non
   activée. », dialogue sans nombre. Ce n'est pas la pile locale : sur staging le bureau ne l'avait pas non plus (tests jamais exécutés).
   Les tests posent le drapeau (`activerClientInactif`, `_aides.ts`), attendent que la ROUTE réponde 200 (le serveur garde les drapeaux
   30 s en mémoire), et il est retiré après chaque test. `05:304` exige en plus que le nombre affiché soit CELUI que le serveur a rendu.
   Même préparation ajoutée aux `@defaut` `05:336` et `07:188`, pour qu'ils échouent sur le défaut et non sur le 404.

Hors des 75, vus pendant le tri (verts à la passe par chance) :

- `06-menu-actions:93` — vert à la passe, ROUGE à ma première relance. Le menu ⋮ se referme au moindre défilement ; quand Playwright
  fait défiler pour atteindre la dernière ligne, l'événement « scroll » est émis APRÈS le clic (relevé : clic à 1 409 ms, scroll à
  1 457 ms, 5 fois sur 6) et referme le menu à peine ouvert. `amenerALEcran` (`_aides.ts`) amène le bouton à l'écran et attend la fin du
  défilement avant de cliquer : 8 sur 8.
- `12-permissions:118` (le technicien publie et supprime) — vert à la passe, ROUGE à ma première relance. Le serveur garde les droits
  d'un membre 60 s en mémoire (`server/lib/rbac.ts`, `CACHE_TTL`) : écrits en base par le test, ils ne valaient pas encore côté serveur,
  et le résultat dépendait du temps pris par le test précédent. `attendreDroitsServeur` (`_aides.ts`) interroge deux routes en lecture
  jusqu'à ce qu'elles répondent comme les droits le veulent ; posé aussi dans `01-barre-haut:263` et dans les deux `@defaut` S-01.
- Attentes négatives qui passaient à vide : `12-permissions:75` (« pas d'entrée de menu Automatisations » : l'entrée vit sous « Plus »,
  replié — le test le déplie d'abord) ; `12:102` (« pas d'Accès restreint », vérifié avant que la page ait rien affiché : le test
  passait à ma relance alors que le défaut est là — l'attente positive passe maintenant d'abord) ; `02-dossiers:354` (même inversion) ;
  `13:107` (les mots français interdits en anglais étaient bornés par `\b`, qui ne voit pas le début d'« étape » : limites Unicode).
- `11-clavier:209` — après le portail, « 5 Tab » laissait le focus DANS le menu : le test tabule jusqu'à ce que le focus soit hors du
  menu et de son bouton, puis exige le menu refermé (toujours rouge, pour la bonne raison).

## Environnement

Aucun des 75 échecs ne vient de la pile locale (ni stockage de fichiers, ni IA, ni données d'avant dans ce dossier).

Incidents d'environnement pendant le tri, sans effet sur le résultat final :
- `net::ERR_NO_BUFFER_SPACE` sur le WebSocket du temps réel, une fois (`01:391`, relancé seul : vert). Poste partagé.
- Le jeu de serveurs partagé (48422 / 48303 / 5194) s'est arrêté vers 00:43 UTC pendant ma première passe complète, au 54e test : passe
  arrêtée, gardée dans `relance-dossier-interrompue.txt`. Deux tests sans marque y étaient rouges juste avant l'arrêt (`02-dossiers:295`,
  `03-onglets-etats:78` « corbeille ») ; le détail n'a pas été écrit (passe tuée). Ils sont verts dans la passe complète et l'étaient dans
  les relances par fichier : je n'en connais pas la cause.
- Sur mes ports, deux démarrages ont échoué (« L'API ne répond pas sur 127.0.0.1:48304 après 120 s ») : poste chargé, plusieurs sessions
  démarrant leurs serveurs en même temps. Le troisième a démarré en 12 s.

## Encore rouge sans conclusion (et pourquoi)

Aucun : les 49 tests rouges sont les 49 `@defaut` du tableau.

Remarques sur `e2e/automations/_outils/` (non modifié) :
- `banc.ts`, `PANNE_ENVIRONNEMENT` : `net::ERR_NO_BUFFER_SPACE` n'y est pas ; l'incident ci-dessus est sorti comme « problème relevé par
  le moniteur » et non comme panne d'environnement.
- Rien dans le banc n'attend que le serveur applique des droits (60 s de mémoire) ou un drapeau (30 s) écrits en base par un test :
  tout dossier qui change les droits d'un compte entre deux tests peut voir le même faux rouge que `12:118`. Les deux aides
  (`attendreDroitsServeur`, `activerClientInactif`) sont dans `liste/_aides.ts` ; elles auraient leur place dans le banc.

## Ce qui n'a pas été vérifié

- Projet « bureau » seulement (1440 × 900, Chromium).
- UNE passe complète du dossier a abouti (156 / 49) ; la stabilité d'une passe à l'autre n'est pas mesurée. Chaque fichier a toutefois
  tourné une fois de plus, seul ou par groupes, avant le changement de ports (voir ci-dessous), avec les mêmes verdicts — sauf `06:93`
  et `12:118`, corrigés depuis.
- Le code servi est supposé être celui du worktree `wt-e2e` (HEAD = #889) ; non contrôlé autrement que par les résultats.
- Les commits cités ont été retrouvés par `git log -S` pour : sous-navigation, double clic, langue illisible, ordre par nom affiché,
  « Texto », `tabpanel`, bulle d'aide, portail, Échap, écran « à la corbeille », « Prêtes à publier », préréglage retiré, « Fermer » de la
  fenêtre de forfait. Pour S-09, S-10 et S-35, je m'appuie sur le code lu et le tableau des constats, pas sur un commit précis.
- Le défaut S-32 (second texto écrasé) est prouvé sur une automatisation à l'ancien format créée par le test ; je n'ai pas compté
  combien d'automatisations réelles ont deux textos dans ce format.
- Le défaut du menu ⋮ au clavier (`11:178`) est relevé sur une liste d'une ligne ; « il faut traverser les lignes suivantes » sur une
  liste pleine est déduit de l'ordre du document, pas mesuré.
- Les gravités sont mon estimation.

Relances faites AVANT le changement de ports (serveurs partagés 48422 / 48303 / 5194) : `01` (22/23 puis le 23e seul), `02`+`03`,
`04`+`05`, `06` à `09`, `10` à `13`, `12` seul, deux tests ciblés (`01:263`, `06:93`), quatre diagnostics jetables (fichier supprimé).
APRÈS (mes ports 48423 / 48304 / 5195) : la passe complète du dossier, seule relance du nouvel environnement.
