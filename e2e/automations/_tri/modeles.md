# modeles — 118 échecs à la passe, après tri : 48 défauts, 69 specs réparées, 0 environnement, 1 fragile

Dernière relance (dossier entier, pile locale du tri, un worker) : **222 tests — 171 passés, 51 échoués** (29,7 min,
`D:/lume-uiaudit/sorties/tri-modeles/relance-dossier.txt`).
- **49** échecs portent ` @defaut` et tombent chacun sur l'attente qui décrit le défaut (relevé ligne à ligne).
- **2** échecs sans marque (`01:151` MOD-006, `02:131` job_reminder_2h) : le moniteur a relevé
  `net::ERR_NO_BUFFER_SPACE` sur le chargement d'un module de Vite (le poste, pas le produit). Relancés seuls aussitôt
  (`-g "MOD-006|job_reminder_2h"`, `relance-2-tests.txt`) : **2 passés, 0 échoué**.
- Aucun test `@defaut` ne passe. État final : **173 verts, 49 rouges, tous `@defaut`**.

Le compte de départ : `passe1.txt` porte bien 118 `x` pour ce dossier ; `echecs.md` n'en liste que 117 — il lui manque
`06-reglages-globaux:524` (« endpoint »), compté ici.

Les 49 rouges = les 48 défauts de la passe + 1 défaut NOUVEAU isolé pendant le tri (`03:113`, sorti d'un test sans marque).
Numéros de ligne = fichiers tels qu'ils sont sur disque après le tri (`e2e/automations/modeles/`).

## Défauts du produit encore ouverts

| Identifiants | Spec:ligne | Écran | Ce qu'on fait | Ce qu'on voit | Ce qu'on devrait voir | Gravité |
|---|---|---|---|---|---|---|
| MOD-029, EDT-037, EDT-042 | 02-chaque-modele:131 (cas `pack_relance_devis`) — **reçoit ` @defaut`** | Éditeur ouvert par « Utiliser ce modèle » sur « Relance de devis — 1, 2, 5, 10 et 30 jours » (vaut pour tout parcours dont les deux branches d'un « Si » se rejoignent) | Bibliothèque → ce modèle → « Utiliser ce modèle ». | Le canevas dessine **180 cartes** pour un parcours de **23 étapes** : après chaque « Si le devis est parti par texto », la suite est redessinée une fois sous « si oui » et une fois sous « si non » ; au 5ᵉ « Si », chaque relance figure 32 fois, côte à côte. Mesuré : 180 = exactement le nombre de chemins (calcul `cartesSiArbre`). Les 4 autres parcours fournis (sans branches qui se rejoignent) montrent bien une carte par étape. | Une carte par étape ; les deux branches se rejoignent sur la même suite. | majeur |
| MSG-010 | 03-texto:172 | Liste › ligne dépliée d'une automatisation qui envoie DEUX textos | Corriger le premier texto, « Enregistrer ». | « Message enregistré ». En base, le second texto a reçu le texte du premier : les deux disent maintenant « Premier texto, corrigé. ». | Seul le texto modifié change. | majeur |
| MSG-036 | 04-courriel:816 | Liste › ligne dépliée d'une automatisation qui envoie DEUX courriels › « Modifier » du premier | Changer l'objet du premier, « Enregistrer ». | « Courriel enregistré ». Le second courriel a pris l'objet ET le corps du premier. | Le second courriel reste intact. | majeur |
| MSG-020, MSG-036 | 04-courriel:394 | Éditeur de courriel d'un courriel fourni qui porte un lien (« Voir votre soumission ») et un passage en gras | Corriger un mot d'un AUTRE paragraphe, « Enregistrer ». | Le lien n'est plus un lien (son libellé a disparu, il reste le crochet), le gras a disparu. | Ce qu'on n'a pas touché garde sa mise en forme et son lien. | majeur |
| MSG-001, MSG-010 | 03-texto:345 | Liste › texto d'une automatisation, bureau dont les messages partent en ANGLAIS | Déplier la ligne, corriger le texto, « Enregistrer ». | Le champ montre le texte FRANÇAIS ; la correction s'écrit dans le français. Le texte anglais — celui que les clients reçoivent — n'est ni montré ni modifié. | Le champ montre et modifie le texte qui part. | majeur |
| MSG-019, MSG-036 | 04-courriel:834 | Éditeur de courriel, même bureau (messages en anglais) | « Modifier », changer l'objet, « Enregistrer ». | L'éditeur montre l'objet français « Votre rendez-vous » ; l'objet anglais qui part (« Your appointment ») reste inchangé. | L'éditeur montre et modifie le courriel qui part. | majeur |
| MSG-017 | 04-courriel:725 | Éditeur de courriel › « Aperçu réel » (et l'essai qu'on s'envoie) | Ouvrir l'aperçu d'un courriel qui finit par « Merci, [company_name] ». | « Merci, **Coquin lavage** » — le nom d'une AUTRE entreprise, écrit en dur comme exemple (`src/lib/variablesCourriel.ts` l. 40). | Le nom de MON entreprise (« Nettoyage Test A »), comme dans l'en-tête du même aperçu. | majeur |
| MSG-001, MSG-010 | 03-texto:316 | Liste › texto | Coller 1 700 caractères, « Enregistrer ». | « 1700 caractères · 12 SMS », « Enregistrer » actif, rien ne dit qu'un texto plafonne à 1 600 (l'éditeur plein écran, lui, refuse). | Un refus clair (« 1 600 caractères au plus »), bouton grisé. | majeur |
| REG-005 | 06-reglages-globaux:299 | Réglages globaux › Adresses d'appel › bouton « Active / En pause » | Deux clics rapprochés (pause puis reprise) quand le premier appel traîne. | L'écran finit sur « Active » ; la base contient `enabled=false` : l'adresse est en pause sans que personne le voie. | L'écran affiche ce que la base contient (ou le second clic attend le premier). | majeur |
| MSG-036 | 04-courriel:260 | Éditeur de courriel | Changer l'objet, « Enregistrer ». | La fenêtre disparaît toute seule dès l'enregistrement (la liste se recharge et la démonte). | La fenêtre reste ouverte et dit « Aucune modification ». | mineur |
| MSG-020, MSG-036 | 04-courriel:410 | Éditeur de courriel d'un courriel qui commence par un paragraphe (pas de titre) | Corriger la 2ᵉ ligne, « Enregistrer ». | La première ligne « Bonjour [client_first_name], » est enregistrée en TITRE (`<h2>`). | Un paragraphe reste un paragraphe. | mineur |
| MSG-001 | 03-texto:363 | Liste › onglet Corbeille › ligne dépliée d'une automatisation supprimée | Regarder le texto. | Le champ est modifiable, comme sur une automatisation vivante ; rien ne dit qu'il faut restaurer d'abord. (Au moment du contrôle, le texte en base n'avait pas changé : je n'ai pas établi si l'enregistrement est refusé ou seulement pas encore parti.) | Champ en lecture seule dans la corbeille. | mineur |
| MSG-010 | 03-texto:155 | Liste › texto, panne de la base à l'enregistrement | « Enregistrer » pendant une panne. | Le message montre l'erreur brute : « canceling statement due to statement timeout ». | Une phrase en français (« Enregistrement impossible… »). | mineur |
| MSG-002 | 03-texto:237 | Liste › texto › boutons « Insérer » | Placer le curseur après « Bonjour », cliquer « Prénom du client ». | « Bonjour , à demain.[client_first_name] » : la variable part en fin de texte. | « Bonjour [client_first_name], à demain. » | mineur |
| MSG-025 | 04-courriel:538 | Éditeur de courriel › palette « Insérer » | Même geste dans une ligne du courriel. | La variable part en fin de ligne. | La variable à l'endroit du curseur. | mineur |
| MSG-025 | 04-courriel:547 | Éditeur de courriel vidé de toutes ses lignes | Cliquer « Prénom du client ». | Rien ne se passe, rien n'est dit ; le bouton n'est pas grisé. | Une ligne apparaît avec la variable, ou le bouton est grisé. | mineur |
| MSG-025, MSG-017 | 04-courriel:560 | Éditeur de courriel › onglet « Aperçu réel » | Cliquer un bouton « Insérer ». | Le texte (qu'on ne voit pas) est modifié : le pied passe à « Modifications non enregistrées ». | Palette masquée ou inactive sur l'aperçu. | mineur |
| MSG-001 | 03-texto:259 | Liste › texto, variable inconnue | Écrire « Bonjour [prenom], à demain. » | L'avertissement dit bien « sera vide dans le message envoyé », mais « Le client lira : Bonjour [prenom], à demain. » | « Le client lira : Bonjour , à demain. » (ce qui partira). | mineur |
| MSG-020 | 04-courriel:620 | Éditeur de courriel | Écrire « Bonjour [prenom], » dans une ligne. | Aucun avertissement (seules les clés PROCHES d'une variable connue sont signalées) ; le client lira « Bonjour , ». | Le même avertissement que dans l'éditeur de texto. | mineur |
| MSG-001 | 03-texto:306 | Liste › texto, compteur de SMS | Écrire 150 lettres + `[client_first_name]`. | « 169 caractères · 2 SMS » : le compte porte sur le NOM de la variable, alors que le client lira 155 caractères (1 SMS). | Le nombre de SMS du texte que le client lira (ou la mention que c'est une estimation). | mineur |
| MSG-018 | 04-courriel:793 | Éditeur de courriel › « M'envoyer un essai », échec de l'envoi | Cliquer « M'envoyer un essai » quand le serveur répond « Aucun service de courriel n'est configuré… ». | « Envoi impossible », sans la raison. | La raison donnée par le serveur. | mineur |
| MSG-033, MSG-020 | 04-courriel:588 | Éditeur de courriel › « Aperçu réel », écran 1440 × 900 | Ouvrir l'aperçu. | La palette ne mange plus la place (≥ 300 px pour le courriel : corrigé), mais « M'envoyer un essai » est sous le cadre de 620 px, hors de vue sans défiler. | Le bouton visible sans défiler. | mineur |
| MSG-019 | 04-courriel:366 | Éditeur de courriel › objet | Taper un objet de 300 caractères. | Rien : ni compteur, ni avertissement. | Un signal au-delà de ~70 caractères. | mineur |
| MSG-037 | 04-courriel:201 | Éditeur de courriel › fermer avec une modification | Cliquer ×. | « Vos modifications ne sont pas enregistrées. Fermer quand même ? » avec « Annuler » / « Confirmer ». | Des boutons qui disent ce qu'ils font (« Fermer sans enregistrer »). | mineur |
| MSG-013, MSG-015 | 04-courriel:212 | Éditeur de courriel, au clavier | Ouvrir par Entrée sur « Modifier », Maj+Tab 12 fois, Échap. | Le focus n'entre pas dans la fenêtre, sort 12 fois sur 12 vers la page derrière ; la fenêtre n'a pas `role="dialog"`. | Focus dans la fenêtre, piégé, rendu à « Modifier » à la fermeture. | mineur |
| MSG-023 | 04-courriel:443 | Éditeur de courriel › « Paragraphe » | Ajouter une ligne. | La ligne apparaît sans le curseur. | On peut taper tout de suite. | mineur |
| MSG-021 | 04-courriel:478 | Éditeur de courriel › corbeille d'une ligne | L'atteindre par Tab. | Elle reçoit le focus mais reste invisible (opacité 0 hors survol). | Visible au clavier et au toucher. | mineur |
| MSG-016, MSG-017 | 04-courriel:683 | Éditeur de courriel › onglets « Modifier / Aperçu réel » | Passer sur « Aperçu réel » avec un lecteur d'écran. | Aucun attribut ne dit quel onglet est actif. | `aria-selected` ou `aria-pressed`. | mineur |
| MSG-036 | 04-courriel:895 | Éditeur de courriel, interface ANGLAISE, enregistrement refusé | « Save » sans accès. | « Modification refusée — vous n'avez pas accès à cette automatisation. » | Le même refus en anglais. | mineur |
| MSG-004, MSG-008 | 03-texto:438 | Liste › texto, interface ANGLAISE | Lire « The client will read: ». | « See you on 14 août 2026 at 9 h 00 — Votre entreprise » : les exemples sont français. | Des exemples anglais. | mineur |
| MSG-001 (nouveau) | 03-texto:113 — **nouveau test ` @defaut`**, sorti de `03:99` | Liste › texto | Ne taper que des espaces ou des retours à la ligne. | « Le message ne peut pas être vide. » s'affiche, mais « Le client lira : » est suivi d'un blanc. | Le tiret « — » montré pour un champ vide. | cosmétique |
| MOD-029, MOD-002 | 01-bibliotheque:489 | Bibliothèque › aperçu d'un modèle | « Utiliser ce modèle », puis Échap pendant la création. | La fenêtre se ferme ; une seconde plus tard l'éditeur de la copie s'ouvre quand même. | La fenêtre reste ouverte tant que la création court (ses deux boutons sont déjà désactivés). | mineur |
| MOD-029 | 01-bibliotheque:525 | Bibliothèque › « Utiliser ce modèle », coupure réseau | Cliquer pendant une coupure. | Message : « Failed to fetch ». | Une phrase en français. | mineur |
| MOD-026 | 01-bibliotheque:568 | Bibliothèque, coupure réseau au chargement | Ouvrir la bibliothèque. | « Impossible de charger les modèles. » puis « Failed to fetch ». | Une raison en français. | mineur |
| MOD-026 | 01-bibliotheque:626 | Bibliothèque, interface ANGLAISE, panne du catalogue (502) | Ouvrir la bibliothèque. | « Could not load the templates. » puis, comme raison, « Impossible de charger les modèles. ». | La raison en anglais. | mineur |
| MOD-001, MOD-016, MOD-021 | 01-bibliotheque:328 | Bibliothèque rouverte | Filtrer, chercher, trier par nom, passer en liste, fermer, rouvrir. | La recherche et les catégories repartent de zéro ; le tri (« Nom ») et l'affichage (liste) sont gardés. | Tout repart de zéro, ou tout est gardé. | mineur |
| MOD-029 | 02-chaque-modele:246 | Bibliothèque, interface ANGLAISE | « Use this template » sur « Contract signed ». | L'éditeur ouvre « Contrat signé ». | Le nom annoncé par l'aperçu. | mineur |
| MOD-024 | 02-chaque-modele:263 | Bibliothèque, interface ANGLAISE, bureau qui écrit en français | Ouvrir l'aperçu de « Thank you after the job ». | Les textes anglais, sans rien dire ; les clients recevront les français. | Les textes qui partiront, ou la mention que c'est une traduction. | mineur |
| MOD-029 | 02-chaque-modele:351 | Liste après « Utiliser ce modèle » sur « Contrat signé » | Chercher « Contrat signé ». | Deux lignes au nom strictement identique (le préréglage fourni et la copie). | La copie se distingue (« Contrat signé (2) »). | mineur |
| APR-003 | 05-vue-ensemble:155 | Vue d'ensemble › tuile « Total des déclenchements » | Deux automatisations déclenchées par le même prospect le même jour. | La tuile dit 1 ; la liste dit 1 + 1. | La somme de la liste (2). | mineur |
| APR-003 | 05-vue-ensemble:209 | Vue d'ensemble, journaux d'activité illisibles | Ouvrir la page pendant la panne. | « 0 » déclenchement, courbe à plat, comme s'il ne s'était rien passé. | « — » ou un message, comme pour les deux autres tuiles. | mineur |
| APR-003 | 05-vue-ensemble:173 | Vue d'ensemble › Résumé des erreurs | Une TÂCHE en échec. | « 1 envoi(s) ont échoué ces 7 derniers jours. » | Un singulier juste, et pas « envoi » pour une tâche. | cosmétique |
| REG-004 | 06-reglages-globaux:467 | Réglages globaux › Adresses d'appel, lecture en panne | Ouvrir la page (une adresse existe). | Le message d'erreur passe, puis la carte dit « Aucune adresse pour l'instant ». | La carte dit qu'elle n'a pas pu lire. | mineur |
| REG-004 | 06-reglages-globaux:183 | Réglages globaux › « Créer une adresse », refus du serveur | Cliquer. | « Impossible de créer l'adresse. », sans la raison du serveur (le `catch` l'ignore). | La raison (« Votre rôle ne permet pas… »). | mineur |
| REG-004 | 06-reglages-globaux:198 | Réglages globaux › Adresses d'appel | Créer trois adresses. | Trois lignes « Formulaire de mon site », impossibles à distinguer ni à renommer. | Des noms distincts, ou un renommage. | mineur |
| REG-005 | 06-reglages-globaux:329 | Réglages globaux › bouton « Active » | Le lire au lecteur d'écran. | Un bouton « Active » sans état ni indication qu'un clic met en pause. | Interrupteur ou `aria-pressed`. | mineur |
| REG-001 | 06-reglages-globaux:72 | Réglages globaux › carte « Mettre en pause » | Lire la carte. | « chaque automatisation se met en pause individuellement depuis la liste », alors que la liste offre « Tout arrêter ». | La carte parle de « Tout arrêter ». | cosmétique |
| REG-003 | 06-reglages-globaux:116 | Réglages globaux › « Langue des messages » et liste | Lire la carte, puis la liste. | La carte dit « définie une fois… dans Paramètres » ; la liste a son propre sélecteur « Messages en FR / EN ». | Un seul endroit, ou une carte qui le dit. | cosmétique |
| REG-004, REG-006 | 06-reglages-globaux:544 | Réglages globaux, interface ANGLAISE | Créer puis supprimer une adresse. | « Endpoint created. », « Delete this endpoint? » à côté de « Create an address ». | Un seul mot : « address ». | cosmétique |

## Défauts corrigés depuis (marqueur @defaut retiré)

Passaient déjà à la passe (marqueur retiré, rien d'autre — sauf la ligne signalée) :
- `01-bibliotheque:114` [MOD-004] à l'aperçu d'un modèle, le focus est dans la fenêtre.
- `01-bibliotheque:143` [MOD-005] « Tous les modèles » n'a plus l'air actif pendant une recherche.
- `01-bibliotheque:204` [MOD-014] une catégorie cochée reste visible après « Afficher moins ».
- `01-bibliotheque:427` [MOD-024] l'aperçu montre tous les messages (les deux branches).
- `01-bibliotheque:642` [MOD-001] l'onglet de la liste ne s'appelle plus « Modèles ». **Une ligne ajoutée** : l'onglet « Prêtes à publier » doit être visible avant de constater l'absence de « Modèles » (sinon l'attente négative passerait à vide sur une barre d'onglets pas encore affichée).
- `02-chaque-modele:224` [MOD-024] (anglais) aucun aperçu ne montre de français.
- `02-chaque-modele:298` [MOD-024] aucun aperçu ne montre de clé technique.
- `02-chaque-modele:318` [MOD-024] le nombre d'étapes de la carte est celui de l'éditeur.
- `04-courriel:773` [MSG-018] l'essai est retenu parce que le BUREAU est en bac à sable.
- `06-reglages-globaux:67` [REG-002] « Vue d'ensemble » porte « Bêta » sur les trois écrans.

Rouges à la passe pour une raison de spec ; une fois la spec réparée, le défaut s'avère corrigé :
- `03-texto:400` [MSG-001] vocabulaire : le bloc dit « Texto envoyé au client », comme le reste de la page (#870).
- `03-texto:380` [MSG-001][MSG-012] l'aperçu des messages d'un parcours à étapes remplace les variables (« Bonjour Marie, merci! »).
- `04-courriel:629` [MSG-020] les variables des courriels fournis ne sont plus dites « inexistantes » (#866).
- `04-courriel:693` [MSG-017] l'aperçu réel d'un courriel d'automatisation ne montre plus de montant ni « Voir et payer » (#859).
- `04-courriel:707` [MSG-017] l'aperçu réel remplace les variables comme le bloc compact. **Deux lignes ajoutées** : « Bonjour Marie, » et « Nous serons chez vous le 14 août 2026. » doivent s'y lire (les deux attentes d'origine étaient négatives).
- `06-reglages-globaux:125` [REG-003] langue illisible : la carte dit « Impossible de lire la langue pour le moment. ». Le test tombait sur le moniteur : la page journalise désormais la panne simulée (`console.error('[automations/reglages] langue des messages illisible')`). Je l'ai déclarée attendue (`moniteur.attendu`, comme les tests voisins « la page journalise l'échec ») ET j'ai ajouté ce que l'utilisateur voit : ni « Français » ni « English », le message, le lien « Changer dans les réglages ». **À relire si vous jugez qu'une déclaration au moniteur ne se décide pas ici.**

## Specs réparées (ce qui avait changé dans le produit, et le commit ou le fichier qui le prouve)

| Spec:ligne (cas à la passe) | Ce qui a changé dans le produit | Preuve | Ce que la spec affirme maintenant |
|---|---|---|---|
| `02:131` — 33 modèles (« l'aperçu montrait « Étape technique, automatique », absent de la copie ») | L'aperçu d'un modèle écrit « Note dans l'historique » / « Étape technique, automatique » sous une étape `log_activity` : un mot d'interface, pas un texte du modèle | #870 (963851e0) : `BibliothequeModeles.tsx` l. 76-83 et 646-648, mêmes mots que `SequenceCanvas.tsx` l. 105 et 138 | Cette ligne apparaît exactement UNE fois par étape `log_activity` de la copie (ni plus ni moins), et autant d'étapes s'intitulent « Note dans l'historique » ; tous les AUTRES textes de l'aperçu doivent toujours se retrouver dans la copie |
| `02:131` — `quote_opened_notify`, `quote_opened_move_deal` (« Quand Devis ouvert par le client » introuvable) | La carte « Quand » porte, sous le déclencheur, le résumé de ses réglages : son nom est « Quand Devis ouvert par le client Première ouverture seulement » | `AutomationBuilderPage.tsx` l. 1630-1684 (`declencheurDetail`) ; `SequenceCanvas.tsx` l. 363-366 (#870 y a ajouté les `title`) | La première ligne de la carte est EXACTEMENT le déclencheur de l'aperçu ; la seconde, s'il y en a une, ne contient que des réglages que l'aperçu annonçait dans sa ligne « Conditions » ; et l'aperçu annonce des conditions si et seulement si le modèle en a |
| `02:198` — 7 modèles en anglais (0 carte trouvée) | Rien n'a changé : le bouton s'appelle « Options for <étape> » depuis #533 ; l'aide cherchait « Step options » / « Options for step », jamais portés par le produit. **Erreur de la spec** (`aides.ts`, `cartesEtape`) | `SequenceCanvas.tsx` l. 257 ; `git log -S"Options for "` → 21d502ad (2026-09-24) | Même attente (autant de cartes que d'étapes), avec le vrai libellé |
| `03` — 12 tests sans marque + 9 `@defaut` (champ introuvable) | Le bloc dit « Texto envoyé au client » / « Text sent to client » (plus « SMS… ») | #870 : `MessageEditor.tsx` l. 140-151 | `zone` (l. 35), `03:52`, `03:416` cherchent le nouveau libellé. Les 9 `@defaut` atteignent maintenant leur vraie attente (ils restent rouges dessus) |
| `03:271` et `03:411` (compteur de SMS) | Rien n'est annoncé tant qu'UN seul SMS part ; à partir de deux : « N SMS (accent spécial ou émoji : 67 caractères par SMS) » | #840 (39f6ffc2) : `src/lib/smsSegments.ts` `libelleSegments` | Français : 160 → rien ; 161 et 306 → 2 SMS ; 307 → 3 ; « ê » à 70 → rien ; 71 → « 2 SMS (accent spécial…) » ; 134 → 2 ; 135 → 3 ; émoji seul → rien ; 69 lettres + émoji → 2. Anglais : 16 → rien ; 71 → « 2 SMS (special accent or emoji: 67 characters per SMS) » |
| `03:331` (1 000 caractères) | Rien : la spec comptait mal son propre texte (988 « x » = 999 caractères, et elle exigeait 1 000). **Erreur de la spec** | — | 989 « x » : 1 000 caractères enregistrés en entier |
| `03:99` (texto vide) | Rien : la dernière attente (« — » après des retours à la ligne) décrit un petit défaut réel | `MessageEditor.tsx` l. 185 (`remplacerVariables(texte) \|\| '—'`) | Le test garde le refus et « rien n'est écrit » pour les trois saisies, et « — » pour un champ vide ; l'attente « — » pour des espaces ou des retours à la ligne vit dans `03:113 @defaut` (rouge) |
| `03:380` (`@defaut`, aperçu d'un parcours) | — (voir « corrigés ») | — | `exact: true` : « Bonjour Marie, merci! » (texto) se distinguait mal de « Bonjour Marie, Merci! » (courriel du même parcours) |
| `04:651`, `04:736` (sans marque) et `04:693`, `04:707`, `04:725` (`@defaut`) : « resolved to 2 elements » | L'aperçu réel est le VRAI gabarit d'envoi : il porte, caché, le pré-en-tête (les premières lignes du courriel une seconde fois) | #859 / #786 : `server/routes/emails.ts` l. 805-892 (`rendreCourrielClient`), `server/lib/courriels/gabarit.ts` l. 378 | Le titre se vise par son rôle (`titreApercu`), les textes en entier (`exact`), la puce par son `listitem` ; mêmes vérifications qu'avant |
| `04:629` (`@defaut`, courriel fourni avec `[quote_link]`) | Le courriel de « Rappel de dépôt — devis accepté » n'a plus `[quote_link]` (le bouton du gabarit le remplace) | #870 : `server/lib/automationPresets.data.ts` | Le premier courriel FOURNI qui porte encore `[quote_link]` (parcours « Dépôt » / « Relance de devis ») ; même attente : aucune alerte « n'existe pas » |
| `05:46`, `05:69`, `05:269`, `06:34`, `06:101`, `06:515` (sous-navigation) | Trois LIENS, la section courante en `aria-current="page"` ; plus aucun bouton | #870 : `src/components/automations/SousNavigation.tsx` | Les trois liens, dans l'ordre, avec leur `href` ; un seul `aria-current`, sur la bonne section ; aucun bouton dans la navigation ; Tab passe au lien suivant et Entrée navigue (aller et retour). L'ancienne attente « la section courante n'est pas un bouton » passait à vide : remplacée |
| `05:92` (tuiles « Total » / « Publiées » : 37 attendu, 36 affiché) | Un préréglage RETIRÉ (« Estimate Follow-Up », déclencheur mort) n'est plus montré nulle part | 098dd153 : `estPrereglageRetire`, `src/lib/automationCatalogue.ts` l. 115-122 ; `getAutomationRules` l. 61 | Le compte attendu écarte ce préréglage-là (au plus un), par la fonction du produit ; égalité stricte gardée |

## Test fragile (1)

- `06:479` [REG-010] (rouge à la passe) et `05:233` [APR-004] (vert par chance) : « Fonctionnalité premium » est écrit sur la page ET dans l'en-tête de la fenêtre de forfait qui s'ouvre d'office (`PlanUpgradeModal.tsx` l. 316, depuis mai). Selon l'instant, `getByText` en voyait un ou deux. Les deux tests visent maintenant celui de la page (le premier du document) et vérifient la phrase qui le suit.

## Environnement

Aucun. Aucun test du dossier ne téléverse d'image ni ne demande de clé d'IA ; « M'envoyer un essai » (`04:736`, `04:773`) passe ici : le bac à sable retient le courriel.

## Encore rouge sans conclusion (et pourquoi)

Rien ne reste rouge sans conclusion. Trois remarques hors de mon périmètre d'écriture :

- **`_outils/banc.ts`, `PANNE_ENVIRONNEMENT`** : `net::ERR_NO_BUFFER_SPACE` (le poste à court de tampons réseau pendant que plusieurs sessions tournent) n'est pas dans la liste. Deux tests verts sont tombés dessus à la relance du dossier, annoncés comme « problème du produit » au lieu de « PANNE D'ENVIRONNEMENT — à relancer ». Je n'ai pas touché au fichier.
- **`echecs.md`** omet `06:524` (rouge dans `passe1.txt`).
- **`AUTOMATIONS_UI_MAP.md`** est en retard sur le produit pour ce dossier : MSG-001 (« SMS envoyé au client »), APR-001/002 et REG-001/002 (« bouton (sous-navigation) »), REG-002 (« sans pastille Bêta ici »).
