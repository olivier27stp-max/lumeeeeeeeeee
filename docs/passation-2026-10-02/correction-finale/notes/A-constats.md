# Constats de l'agent A — Lumi ↔ automatisations

Branche `mission/auto-finale-a` (origin/main `11e75ebc`), pile locale, bureaux « [TEST] QA Automatisations A/B (a) »,
2026-10-01. Phase d'enquête : aucun fichier du produit n'a été modifié.

- Tests : `tests/automations-finale/a/` (config `vitest.config.ts`). État : **18 rouges** (un par défaut prouvé) et
  2 verts (faits établis). Commandes en tête de la config. Relevés : `D:/lume-final/sorties/a/`.
- Scripts : `scripts/qa/finale/a/` (reproductions au vrai navigateur, balayage des outils, conversations).
- Carte « qui lit, qui écrit » : `notes/A-carte.md`.
- Coût des appels au modèle pour toute la passe : **61,33 ¢** (65 appels ; `ai_usage` du bureau A (a)).

---

## 0. Le bug n° 1, tel que prouvé

### La reproduction (vrai navigateur, vrai modèle)

`scripts/qa/finale/a/repro-bug1-panneau.mts frais "<la phrase du propriétaire, mot pour mot>"` — relevé :
`sorties/a/repro-bug1-panneau-frais.json`, capture `sorties/a/bug1-frais-panneau-perime.png`.

1. Éditeur → « Facture en retard » → « + » → « Envoyer un texto ». L'étape naît avec le texte d'exemple
   (« Bonjour [client_name], c’est [company_name]. Merci ! ») **et son panneau s'ouvre à droite**
   (`AutomationBuilderPage.tsx:480-499`).
2. Sans toucher au panneau, le propriétaire écrit à Lumi, à gauche : « salut lumi avec lautomatisation jai mis
   peux tu faire un message envoyer texto de mettre un texte de relance de facture ».
3. Route appelée : `POST /api/automations/rules/generer` (200), avec `parcours_actuel = { trigger_event:
   invoice.overdue, steps:[e1 send_sms « Bonjour [client_name]… »] }` et `rule_id`. Aucun outil : ce chemin n'en a pas.
4. Lumi répond : « J'ai remplacé le texte d'exemple par un vrai texto de relance de facture, avec le lien de
   paiement. Nouveau texte : • Texto : « Bonjour [client_first_name], votre facture [invoice_number] est en
   retard… » » — la même réponse qu'en prod, à quelques mots près.
5. Écritures réelles : `PATCH { trigger_event }` puis, 3 s plus tard, `PATCH { name, steps }` (l'enregistrement
   automatique du navigateur). En base : `steps[0].action.config.body` = le nouveau texte ; `actions[0].config.body`
   = « À compléter ». **C'est exactement l'état relevé en prod sur la règle du propriétaire.**
6. À l'écran, sans recharger : la carte du canevas change (« Bonjour [client_first_name], v… », coupée par la
   largeur de la carte, presque identique à l'ancienne) ; **le panneau d'étape, à droite, montre toujours
   « Bonjour [client_name], c’est [company_name]. Merci ! »**. C'est le « aucun changement visible ».
7. Suites possibles, toutes mesurées : fermer le panneau par la croix → « Fermer sans enregistrer ? Les
   modifications de cette étape ne sont pas enregistrées » (il n'a rien tapé) ; cliquer « Enregistrer » dans le
   panneau → le texte d'exemple repart en base par-dessus celui de Lumi (variante `ouvert`,
   `sorties/a/repro-ouvert.log`) ; recharger → le nouveau texte apparaît partout.

**Cause racine : l'état local du panneau d'étape (constat A-01), pas les deux copies `steps` / `actions`.**
La piste « `actions` garde “À compléter” » est vraie en base (constat A-02), mais aucun écran de la branche ne
montre `actions` pour une règle qui a un parcours : mesuré écran par écran avec
`scripts/qa/finale/a/ecrans-regle.mts` (`sorties/a/ecrans-regle.json`) —

| Écran (règle : `steps` = nouveau texte, `actions` = « À compléter ») | Montre |
|---|---|
| Éditeur — carte du canevas | `steps` (tronqué) |
| Éditeur — panneau d'étape (rouvert) | `steps` |
| Éditeur — « Aperçu » et route `/rules/:id/apercu` | `steps` (avec `[invoice_number]` et `[invoice_link]` rendus vides, A-20) |
| Liste — ligne dépliée « Voir les messages » | `steps` |
| Réglages › Messagerie | la règle n'y figure pas (A-19) |
| Bibliothèque de modèles | ne montre que le catalogue, jamais les règles de l'entreprise |

Chemin (b), clavardage général (`/lumi`), au vrai navigateur : `scripts/qa/finale/a/repro-bug1-page-lumi.mts`
(`sorties/a/repro-bug1-page-lumi.json`, `…-passe1-extrait.json`) et, par l'API, `repro-bug1-clavardage.mts`.
La demande vague « change le message de l’automatisation » : aucun outil, une double question (« laquelle… et
quel texte ? »). La demande précise : `list_automations` → carte `update_automation_sms_body { rule_id, body }` →
« Confirmer » → écriture de `steps` ET `actions` (un seul message) → « C'est fait : l’action. ». L'éditeur resté
ouvert dans un autre onglet ne bouge pas ; à sa prochaine modification il réenregistre son parcours périmé et
**efface le texte de Lumi** (A-09).

### Les sept causes de la mission, une par une

| Cause | Verdict | Preuve |
|---|---|---|
| 1. Outils de Lumi sur l'ancien modèle, page sur le nouveau | **Écartée** pour le cas signalé : le panneau et les outils écrivent `steps`, que la page et le moteur lisent. Reste vrai en périphérie : `actions` périmé (A-02, A-07), `ecrituresSensiblesPour` ne lit que `actions` (A-11), filtre de Réglages › Messagerie (A-19). | `ecrans-regle.json` ; tests `a-moteur-deux-copies` |
| 2. Version publiée contre brouillon | **Écartée** : il n'y a qu'une ligne et un drapeau `is_active` (`A-carte.md` § 1). | schéma relevé |
| 3. Mauvais champ (texto / courriel, mauvaise étape) | **Écartée** : la bonne étape est réécrite (prod et local). | `repro-bug1-panneau-*.json` |
| 4. Mauvaise résolution (par nom → mauvaise automatisation) | **Écartée** pour le cas signalé (le panneau travaille sur `rule_id`). **Confirmée** dans le clavardage : « la relance » part vers les relances de paiement, et une automatisation nommée est dite introuvable (A-15). | conversations C08, D17, D21 |
| 5. Succès sans écriture | **Écartée** pour le cas signalé (l'écriture a lieu, 3 s après la réponse). **Confirmée** ailleurs : « déjà fait » (A-03). | `relire-apres-ecriture.json`, C16 |
| 6. Cache du front non invalidé | **CONFIRMÉE — c'est la cause** : le brouillon du panneau d'étape n'est jamais rafraîchi (A-01) ; et l'éditeur ouvert ne voit pas une écriture venue d'ailleurs (A-09). | tests `a-panneau-lumi` |
| 7. Aucun outil appelé, succès inventé | **Écartée** : dans le panneau, « Nouveau texte » est calculé par le serveur en comparant avant / après (`generer-parcours.ts:237-285`) ; sur la trentaine de tours de clavardage joués, aucun succès inventé. Vu en revanche : un ÉCHEC inventé (« je n'ai pas trouvé d'automatisation nommée… », aucun outil appelé, D21) et un texte montré différent du texte enregistré (A-05). | `conversations-*.json` |

### Ce que le moteur exécute quand `steps` et `actions` divergent

`steps`. Mesuré : règle `steps` = « …TEXTE-DU-PARCOURS… », `actions` = « À compléter », événement « Facture en
retard » dans le bureau de test → un seul texto simulé, celui de `steps` ; « À compléter » ne part pas.
Test vert : `tests/automations-finale/a/integration/a-moteur-deux-copies.test.ts::le moteur exécute `steps``.
Code : `server/lib/automationEngine.ts:1542-1567`.

---

## 1. Constats

### A-01 — Lumi dit avoir changé le message, mais le panneau de l'étape garde l'ancien texte — et l'« Enregistrer » du panneau efface celui de Lumi
- Point de la mission : 1 (et 3)
- Gravité : bloquant
- Ce qu'on voit : on vient d'ajouter « Envoyer un texto » ; on demande à Lumi de changer le message ; Lumi cite
  son nouveau texte ; le champ « Texte du message », à droite, montre toujours le texte d'exemple. Si on clique
  « Enregistrer » dans ce panneau, c'est l'ancien texte qui est gardé. Si on le ferme, l'app demande « Fermer sans
  enregistrer ? » alors qu'on n'y a rien tapé.
- Reproduction : `QA_AUTO_SUFFIXE=a npx tsx --env-file=.env.local scripts/qa/finale/a/repro-bug1-panneau.mts frais`
  (vrai modèle) ; ou les tests ci-dessous (réponse de Lumi interceptée, sans coût).
- Preuve : `tests/automations-finale/a/ui/a-panneau-lumi.test.ts::le panneau ouvert montre le texte que Lumi vient d’écrire — pas l’ancien`,
  `::« Enregistrer » dans le panneau resté ouvert n’écrase pas le texte de Lumi`,
  `::fermer le panneau sans y avoir rien tapé ne demande pas « Fermer sans enregistrer ? »` (3 rouges) ;
  capture `sorties/a/bug1-frais-panneau-perime.png`.
- Cause racine : `src/components/automations/PanneauEtape.tsx:192` garde un brouillon local
  (`useState(etape)`) qui n'est rechargé que si l'IDENTIFIANT de l'étape change (l. 219-224). Lumi renvoie la même
  étape (`e1`) avec un autre texte : `memoriser(propose.steps)` (`AutomationBuilderPage.tsx:686`) met à jour le
  canevas, pas le panneau. Le panneau se croit alors « modifié » (l. 233-237) et son « Enregistrer »
  (`enregistrerEtape`, `AutomationBuilderPage.tsx:980-983`) réécrit l'étape avec le brouillon périmé.
- Correctif proposé : dans `PanneauEtape.tsx`, quand l'étape reçue change sans que l'utilisateur ait tapé dans le
  panneau, reprendre la nouvelle étape ; s'il a tapé, le dire (« Lumi a aussi modifié cette étape ») et laisser
  choisir. Dans `AutomationBuilderPage.construireAvecLumi`, fermer (ou rafraîchir) le panneau d'une étape que la
  proposition modifie ou retire. Aucun autre fichier.
- Risque / à décider par Rafba : que faire quand l'utilisateur a une saisie en cours dans le panneau au moment où
  Lumi répond (garder la sienne, prendre celle de Lumi, ou demander).

### A-02 — Le message d'une automatisation existe en deux exemplaires dans la même ligne, et l'éditeur n'en tient qu'un à jour
- Point de la mission : 1, P6
- Gravité : majeur
- Ce qu'on voit : rien à l'écran aujourd'hui (voir § 0) ; en base, toute automatisation bâtie dans l'éditeur garde
  `actions = [texto « À compléter »]` à côté de son vrai parcours. En prod : 36 parcours dans cet état
  (`notes/P1-1-piste.md`). Tout lecteur de `actions` se trompe (A-11, A-19), tout futur écran aussi.
- Reproduction : créer une automatisation dans l'éditeur, ajouter une étape, relire la ligne.
- Preuve : `tests/automations-finale/a/integration/a-moteur-deux-copies.test.ts::l’éditeur enregistre le parcours : `actions` ne garde pas un texte que `steps` n’a plus` (rouge).
- Cause racine : `AutomationBuilderPage.tsx:177-190` crée la règle avec une action provisoire (le schéma exige au
  moins une action) ; les enregistrements suivants n'envoient que `{ name, steps }` (l. 1190, 1331, 1499, 1525,
  2002) ; la route de modification écrit ce qu'elle reçoit sans rien dériver (`server/routes/automation-rules.ts:672-678`).
  L'ancien éditeur dérivait `actions` des étapes (`AutomationBuilder.tsx:251-264`) ; il n'est plus importé nulle part.
- Correctif proposé : une seule source de vérité. Côté route (`automation-rules.ts`, création et modification) :
  dès que `steps` est non vide, écrire `actions` = les actions du parcours, dans l'ordre (ou `[]`), et accepter une
  création avec `steps: []` sans action provisoire ; côté lectures, passer par une fonction unique « messages
  d'une règle ». Migration (P6) : recalculer `actions` des 69 parcours de prod — à passer en simulation d'abord.
  Retirer `src/components/automations/AutomationBuilder.tsx` (code mort).
- Risque / à décider par Rafba : la migration touche des automatisations de vrais bureaux (2 bureaux, 7 parcours).

### A-03 — Lumi répond « c'est fait » sans rien écrire quand on lui redemande la même chose dans les 10 minutes (« déjà fait »)
- Point de la mission : 1 (balayage « succès sans écriture »)
- Gravité : bloquant
- Ce qu'on voit : Lumi active une automatisation ; on la repasse en brouillon à l'écran ; on redemande à Lumi de
  l'activer : « C'était déjà fait » — et elle reste en brouillon. Même chose pour le texte d'un message, la langue
  des messages (anglais → français → anglais : le 3e ne fait rien), une tâche rouverte.
- Reproduction : conversation C16 (`jouer-conversations.mts --scenarios C16`) ; ou les tests ci-dessous.
- Preuve : `tests/automations-finale/a/integration/a-outils-lumi-relire.test.ts::update_automation_message : redemandé après une modification à l’écran…`,
  `::toggle_automation_rule : réactivée par Lumi après un retour en brouillon…`,
  `::set_automation_language : « en » → « fr » (à l’écran) → « en »…`,
  `::hors automatisations aussi… update_task_status…` (4 rouges) ; C16 T3 : « C'était déjà fait : l’action. »,
  `default_language` = « fr ».
- Cause racine : `server/lib/agent/tools-etendus.ts:281-350` (`executerIdempotent`) : une empreinte
  (bureau, outil, personne, arguments) de moins de 10 minutes rend le résultat MÉMORISÉ (`deja_fait: true`) sans
  rappeler l'action ni relire l'état. Seuls 5 des 199 appels passent `encoreValable` (création, copie, modèle,
  suppression, pause générale) ; les 194 autres rejouent un succès périmé.
- Correctif proposé : dans `executerIdempotent` (`tools-etendus.ts`), ne répondre « déjà fait » que si l'état est
  toujours celui du résultat mémorisé. Le plus simple et général : pour toute écriture qui pose un ÉTAT
  (activer, texte, langue, statut, nom…), ne pas dédoublonner du tout — la refaire est sans danger — et réserver
  l'anti double-clic aux CRÉATIONS et aux ENVOIS (là où un doublon coûte). À défaut, un `encoreValable` par outil
  d'état. Puis `server/lib/lumi/recus.ts:88` : « déjà fait » ne s'affiche que confirmé par une relecture.
- Risque / à décider par Rafba : la fenêtre de 10 minutes reste-t-elle pour les envois et les créations (oui, à mon avis).

### A-04 — Lumi renomme l'automatisation alors qu'on lui demande seulement de changer un message ou un délai
- Point de la mission : 1, 3
- Gravité : majeur
- Ce qu'on voit : « Mauvais payeurs — Longueuil (Will) » devient « Relance facture en retard » après « mets le
  texto ben plus court » ; « Relance de devis 3 jours » devient « Relance de soumission » après « change le délai à
  7 jours ». Rien ne le dit.
- Reproduction : `jouer-conversations.mts --demandes D01,D02,D04`.
- Preuve : `sorties/a/conversations-D01_D02_D04_….json` (3 sur 3) ; `tests/automations-finale/a/ui/a-panneau-lumi.test.ts::le nom donné par l’utilisateur survit à « change le message »` (rouge).
- Cause racine : `AutomationBuilderPage.tsx:690` — `if (propose.nom) setNom(propose.nom)`, sans condition, puis
  l'enregistrement automatique écrit ce nom. Le modèle ne reçoit pas le nom actuel (`parcours_actuel` ne porte que
  `trigger_event` et `steps`, l. 682-684) et en invente toujours un (`generer-parcours.ts:861`).
- Correctif proposé : envoyer le nom actuel au modèle et ne prendre `nom` que si la règle n'a pas encore de
  parcours (création) ou si la demande est de renommer (un champ `renomme: true` dans la réponse, comme `modifie`).
  Fichiers : `AutomationBuilderPage.tsx`, `src/lib/automationBuilderApi.ts`, `server/routes/automation-rules.ts`,
  `server/lib/lumi/generer-parcours.ts`.
- Risque / à décider par Rafba : aucun.

### A-05 — Après une écriture, Lumi ne cite pas ce qui est réellement enregistré : « C'est fait : l’action. »
- Point de la mission : 1 (« chaque outil relit l'état réel et le retourne ; Lumi cite le contenu sauvegardé »)
- Gravité : majeur
- Ce qu'on voit : après « Confirmer », la page `/lumi` répond « C'est fait : l’action. » pour toute action sur une
  automatisation (activer, texte, langue, renommer…). Dans une passe, Lumi a MONTRÉ un texte
  (« Bonjour [prénom]… [lien_paiement] ») et ENREGISTRÉ un autre (« Bonjour {{client_first_name}}…
  {{payment_link}} »).
- Reproduction : `repro-bug1-page-lumi.mts` ; `jouer-conversations.mts --demandes D15`.
- Preuve : `sorties/a/repro-bug1-page-lumi-passe1-extrait.json` ; D15, C02 (« C'est fait : l’action. ») ;
  `tests/automations-finale/a/integration/a-outils-lumi-relire.test.ts::update_automation_message rend le texte enregistré (relu en base)…` (rouge).
- Cause racine : (1) `server/lib/agent/tools-reglages.ts:646-653` : la réponse de l'outil porte `updated`,
  `ancien_texte`, `note` — pas le texte relu ; `toggle_automation_rule` rend `is_active: actif` (la valeur demandée,
  l. 368-374). (2) `server/lib/lumi/recus.ts:39-61` : aucun outil d'automatisation n'a de nom d'action → « l’action » ;
  la phrase après « Confirmer » est un gabarit sans modèle (l. 88-89) qui ne cite rien. (3) Le texte de la bulle
  et l'argument `body` de l'outil sont deux productions du modèle : rien ne les tient égaux.
- Correctif proposé : chaque outil d'écriture d'automatisation relit la ligne après écriture et rend l'état
  (`texte_enregistre`, `is_active` relu, `name` relu) — `tools-reglages.ts`, `tools-lot-entreprise.ts` (session a1).
  `recus.ts` : noms d'action pour les 9 outils d'automatisation et, pour un message, la citation du texte
  enregistré. Consigne (`consignesCollegue.ts`) : jamais « c'est fait » sans résultat d'outil ; le texte montré est
  celui de la carte.
- Risque / à décider par Rafba : aucun.

### A-06 — Lumi (clavardage) écrit des messages avec des variables qui n'existent pas ; le client les reçoit troués, sans lien de paiement
- Point de la mission : 1, 8
- Gravité : bloquant
- Ce qu'on voit : « Bonjour {{client_prenom}}, … votre facture {{facture_numero}} d'un montant de {{solde_du}} …
  via ce lien : {{lien_paiement}} » est accepté et enregistré. À l'envoi : « Bonjour , … votre facture  d'un
  montant de  … via ce lien : . ». Vu 3 fois sur 5 réécritures libres enregistrées par le clavardage (`{{lien_paiement}}`,
  `{{payment_link}}`, `{{balance_due}}`, `[montant]`).
- Reproduction : `repro-bug1-clavardage.mts` ; `repro-bug1-page-lumi.mts`.
- Preuve : `sorties/a/repro-bug1-clavardage.json`, `repro-bug1-page-lumi.json` ;
  `tests/automations-finale/a/integration/a-outils-lumi-relire.test.ts::update_automation_sms_body refuse {{client_prenom}} / {{lien_paiement}}…` (rouge) ;
  `a-moteur-deux-copies.test.ts::ce que le client reçoit quand Lumi écrit {{client_prenom}} et {{lien_paiement}}` (vert : le texto simulé est bien troué).
- Cause racine : `tools-reglages.ts:656-708` n'appelle pas `variablesInconnues` (que le panneau de l'éditeur, lui,
  applique : `generer-parcours.ts:824`) ; la description de l'outil ne donne pas la liste des variables ; le
  clavardage ne peut pas lire le message existant (A-10). La route de modification ne vérifie pas non plus
  (`automation-rules.ts`), ni la publication.
- Correctif proposé : refuser à l'écriture toute variable inconnue, en la nommant et en donnant la bonne
  (`[invoice_link]`), au même endroit pour tous : la route `PATCH`/`POST` (`automation-rules.ts`) et les deux
  outils (`tools-reglages.ts`) ; lister les variables dans la description de l'outil (ou les rendre avec la
  lecture d'A-10). Coordonner avec l'agent E (point 8, « variable inconnue → erreur à la sauvegarde »).
- Risque / à décider par Rafba : des règles déjà en base peuvent porter une variable inconnue — à recenser
  avant de bloquer leur modification.

### A-07 — `update_automation_message` laisse `actions` contredire le parcours dès qu'il y a deux messages
- Point de la mission : 1, P6
- Gravité : mineur (aucun écran ne le montre aujourd'hui ; même racine qu'A-02)
- Ce qu'on voit : rien à l'écran ; en base `steps = ['Premier', 'Nouveau deuxième']`, `actions = ['Premier', 'Deuxième']`.
- Reproduction : `relire-apres-ecriture.mts --auto-seulement` (cas 1.3).
- Preuve : `tests/automations-finale/a/integration/a-outils-lumi-relire.test.ts::parcours à deux textos : après la réécriture du 2e, `actions` ne garde pas l’ancien texte` (rouge).
- Cause racine : `tools-reglages.ts:630-637` (`refletUnique` : `actions` n'est réécrit que s'il n'y a qu'un message
  de ce type). Symétrique côté écran : `src/lib/automationRulesApi.ts:122-153` réécrit TOUS les messages du type
  dans `actions`.
- Correctif proposé : celui d'A-02 (dériver `actions` de `steps` à l'écriture), qui supprime ces deux bricolages.
- Risque / à décider par Rafba : aucun.

### A-08 — Lumi réécrit le message d'une automatisation qui est à la corbeille et répond « mis à jour »
- Point de la mission : 1
- Gravité : mineur
- Ce qu'on voit : la modification « réussit » sur une automatisation supprimée, qui ne partira jamais.
- Reproduction : `relire-apres-ecriture.mts --auto-seulement` (cas 1.5).
- Preuve : `tests/automations-finale/a/integration/a-outils-lumi-relire.test.ts::update_automation_message refuse une règle supprimée…` (rouge).
- Cause racine : `tools-reglages.ts:596-601` lit la règle sans filtrer `deleted_at` (la route de l'éditeur refuse
  ce cas en 409, `automation-rules.ts:574-587`).
- Correctif proposé : passer par la route `PATCH` (comme `rename_automation_rule`), ou filtrer `deleted_at` ; un
  seul chemin d'écriture pour l'écran et pour Lumi.
- Risque / à décider par Rafba : aucun.

### A-09 — L'éditeur ouvert et Lumi (ou deux onglets) s'écrasent en silence
- Point de la mission : 3 (et 15, P7 « deux onglets »)
- Gravité : majeur
- Ce qu'on voit : l'éditeur ouvert ne montre pas ce que Lumi vient de changer depuis `/lumi` (ni depuis un autre
  onglet). À la modification suivante, il réenregistre tout son parcours en mémoire : le texte de Lumi disparaît,
  l'indicateur affiche « Enregistré », aucun message.
- Reproduction : `repro-bug1-page-lumi.mts` (étapes 4 à 6).
- Preuve : `sorties/a/repro-bug1-page-lumi.json` ; `tests/automations-finale/a/integration/a-ecrasement-silencieux.test.ts::une écriture périmée de l’éditeur est refusée ou fusionnée : le texto de Lumi survit` (rouge).
- Cause racine : `server/routes/automation-rules.ts:548-678` n'a aucune garde de version ; l'éditeur envoie
  `steps` en entier (`AutomationBuilderPage.tsx:1190`) et ne relit jamais la règle (pas d'abonnement, pas de
  relecture au retour sur l'onglet).
- Correctif proposé : l'éditeur envoie le `updated_at` qu'il a chargé ; la route répond 409 s'il a changé ;
  l'éditeur propose alors « recharger » ou « garder la mienne ». Au retour sur l'onglet, relire la règle si rien
  n'est en cours de saisie. Fichiers : `automation-rules.ts`, `server/lib/validation.ts`,
  `AutomationBuilderPage.tsx`, `automationBuilderApi.ts`. Les outils de Lumi passent par la même route.
- Risque / à décider par Rafba : le comportement en cas de conflit (c'est le « comportement défini et testé » demandé au point 3).

### A-10 — Dans le clavardage, Lumi ne peut pas lire le contenu d'une automatisation
- Point de la mission : 1, 3
- Gravité : majeur
- Ce qu'on voit : « explique-moi ce qu'elle fait » → « elle envoie le texto qu'on vient de peaufiner » ; « plus
  court, plus chaleureux » → « je n'ai pas accès au texte actuel » ; « change seulement l'objet du courriel » →
  « je n'ai pas accès au contenu actuel du courriel ».
- Reproduction : `jouer-conversations.mts --scenarios C02 --demandes D17,D25`.
- Preuve : `sorties/a/conversations-*.json` (C02 T5, D17, D25) ;
  `tests/automations-finale/a/integration/a-outils-lumi-relire.test.ts::un outil de lecture rend le déclencheur, les étapes et le TEXTE exact des messages d’une règle` (rouge).
- Cause racine : `server/lib/agent/tools-etendus.ts:932-958` — `list_automations` rend id, nom, déclencheur, actif.
  Aucun outil ne rend `steps`, `conditions`, `settings`. `update_automation_message` exige `body`, donc l'objet seul
  est impossible.
- Correctif proposé : un outil de lecture `get_automation` (résumé compact : déclencheur en clair, conditions,
  étapes dans l'ordre avec délais et textes exacts, réglages, état, nombre d'envois récents) — résumé produit par
  du code, pas le JSON brut (coût, P4). Rendre `body` facultatif quand `subject` est donné.
- Risque / à décider par Rafba : aucun.

### A-11 — Lumi peut terminer une job sans carte de confirmation alors qu'un parcours va texter le client
- Point de la mission : 1 (ancien modèle contre nouveau)
- Gravité : majeur
- Ce qu'on voit : avec une automatisation « Job terminée → texto » bâtie dans l'éditeur ou par Lumi, « termine la
  job de Mme Tremblay » s'exécute sans carte ; le client reçoit un texto que personne n'a validé.
- Reproduction : test ci-dessous.
- Preuve : `tests/automations-finale/a/integration/a-moteur-deux-copies.test.ts::un parcours ACTIF qui texte le client à « job terminée » rend `update_job_status` sensible, même si `actions` est vide` (rouge).
- Cause racine : `server/lib/lumi/execution.ts:114-125` (`ecrituresSensiblesPour`) lit `actions` seulement ; un
  parcours créé par `create_automation_from_text` a `actions: []` (`tools-reglages.ts:498`).
- Correctif proposé : lire les messages par la fonction unique d'A-02 (`steps` d'abord) dans `execution.ts`.
- Risque / à décider par Rafba : aucun.

### A-12 — Dans l'éditeur, on ne peut pas répondre « oui », « non » ou « active-la » à Lumi
- Point de la mission : 3
- Gravité : majeur
- Ce qu'on voit : le bouton « Envoyer » reste grisé sous 10 caractères. Lumi pose une question (« veux-tu plutôt
  filtrer par montant ? ») à laquelle on ne peut pas répondre « oui ».
- Reproduction : conversation C01 (T6 « active-la » : non envoyable).
- Preuve : `tests/automations-finale/a/ui/a-panneau-lumi.test.ts::« active-la » (9 caractères) peut être envoyé à Lumi depuis l’éditeur` (rouge).
- Cause racine : `src/components/automations/ClavardageLumi.tsx:50`, `AutomationBuilderPage.tsx:660`,
  et la route (`automation-rules.ts:371-373`, 400 « Décris ton automatisation en une phrase »).
- Correctif proposé : garder le minimum de 10 caractères pour le PREMIER message seulement ; dès qu'il y a des
  échanges, accepter toute réponse non vide (écran et route).
- Risque / à décider par Rafba : aucun.

### A-13 — Lumi active une automatisation sans dire ce qui va partir, ni à combien de clients
- Point de la mission : 3 (et 10)
- Gravité : majeur
- Ce qu'on voit : « active-la » → une carte d'activation, sans phrase de Lumi (texte vide, mesuré). La carte porte
  le nom, le déclencheur et l'état (gabarit « <nom> · Facture en retard · en pause », mesuré sur la carte de
  réécriture ; pour l'activation, lu dans le code). Ni le message exact, ni le ciblage, ni le nombre de clients touchés.
- Reproduction : `jouer-conversations.mts --scenarios C02,C04,C11`.
- Preuve : `sorties/a/conversations-*.json` : C02 T6, C04 T2, C11 T1 — texte de Lumi vide, carte `toggle_automation_rule`.
- Cause racine : l'outil ne calcule rien (`tools-reglages.ts:342-376`) ; l'aperçu de la carte lit `name,
  trigger_event, is_active` (`server/lib/lumi/apercu-action.ts:181`, session a1) ; aucun outil ne compte les
  clients concernés ; Lumi ne peut pas lire le message (A-10).
- Correctif proposé : la carte d'activation porte le résumé produit par le code d'A-10 (déclencheur, ciblage,
  texte exact de chaque message) et un compte (« à partir de maintenant, pour chaque facture qui passe en retard ;
  N factures sont déjà en retard, elles ne recevront rien ») — à aligner avec le point 10. Fichiers :
  `tools-reglages.ts`, `complements-cartes.ts` / `apercu-action.ts` (a1).
- Risque / à décider par Rafba : la définition du « nombre de clients touchés » pour un déclencheur d'événement.

### A-14 — Lumi ne couvre pas ce que l'interface permet
- Point de la mission : 1, 3
- Gravité : majeur
- Ce qu'on voit : dans le clavardage, « ajoute un délai de 3 jours » → « il n'existe pas d'outil pour modifier le
  délai… je peux créer une nouvelle automatisation pour remplacer celle-ci » ; dans l'éditeur, « active-la » ne
  fait rien. Aucun des deux canaux ne mène la chaîne de la mission au bout.
- Reproduction : `jouer-conversations.mts --scenarios C01,C02 --demandes D21`.
- Preuve : C01 3/7 tours, C02 2/7 tours ; tableau « ce que l'interface permet / ce que Lumi sait faire »
  (`notes/A-carte.md` § 6) : 14 MANQUES pour le panneau, 14 pour le clavardage.
- Cause racine : deux Lumi qui ne se connaissent pas — le panneau (parcours seulement, pas d'état ni de réglages)
  et le clavardage (état et texte seulement, pas de parcours).
- Correctif proposé : un seul jeu d'outils `automation_*` au-dessus des routes de l'éditeur : lire (A-10),
  modifier le parcours (réutiliser `genererParcours` avec le parcours lu en base : délais, étapes, conditions,
  déclencheur), conditions du déclencheur et réglages, renommer, activer, dupliquer, supprimer, restaurer ; le
  panneau de l'éditeur appelle les mêmes. Fichiers : `tools-reglages.ts`, `generer-parcours.ts`, routes ; le
  registre et les topics sont à la session a1.
- Risque / à décider par Rafba : ordre de livraison (le minimum pour l'acceptation du point 1 : lire, modifier
  le parcours par phrase, activer avec résumé).

### A-15 — Le clavardage ne sait pas de quelle automatisation on parle, et se trompe de système dès qu'on dit « relance »
- Point de la mission : 3
- Gravité : majeur
- Ce qu'on voit : « change le message de l’automatisation » → deux questions d'un coup, sans proposer la liste.
  « change le message de la relance » → Lumi lit les réglages des RELANCES DE PAIEMENT et répond sur « le texto
  envoyé à 14 et 30 jours de retard ». « dans l’automatisation « Relance de devis 3 jours », change le délai à
  5 jours » → « je n'ai pas trouvé d'automatisation nommée… » sans avoir appelé aucun outil.
- Reproduction : `jouer-conversations.mts --scenarios C08 --demandes D16,D17,D21` ; `repro-bug1-clavardage.mts`.
- Preuve : `sorties/a/conversations-C02_C04_C08.json` (C08 0/2), `…D01_…D25.json` (D17, D21) ;
  `lumi_traces` : `outils = {get_reminder_settings}` puis `{}` avec `outils_charges: 15`.
- Cause racine : (1) aucun contexte de page : `/lumi` est une page à part et le navigateur n'envoie que
  `{ conversation_id, message, language, origine }` (`src/lib/lumiApi.ts:220-232`, `server/routes/lumi.ts:76-82`).
  (2) Aiguillage par vocabulaire : « relance(s) », « facture(s) », « devis », « rappel » désignent les sujets
  facturation / devis (`server/lib/lumi/sujet-par-regle.ts:26-35`) — précisément les mots des noms
  d'automatisations ; le jeu d'outils chargé n'a alors pas ceux des automatisations (sujet « rapports »,
  `topics.ts:85-88`). (3) Deux systèmes de relance coexistent (`update_reminder_settings` et `automation_rules`).
- Correctif proposé : envoyer la page et l'automatisation ouverte (identifiant + résumé compact d'A-10) avec le
  message quand Lumi est ouvert depuis l'éditeur, et offrir Lumi DANS l'éditeur par ce même canal ; le mot
  « automatisation » l'emporte dans `sujet-par-regle.ts` ; un sujet « automatisations » à part dans `topics.ts`
  (sessions a1 et f1 : `routes/lumi.ts`, `orchestrateur.ts`, `topics.ts`, `sujet-par-regle.ts`).
- Risque / à décider par Rafba : fusionner à terme « relances de paiement » et automatisations (hors mission ?).

### A-16 — Lumi se contredit dans l'éditeur
- Point de la mission : 3
- Gravité : mineur
- Ce qu'on voit : « juste pour les clients commerciaux » → « as-tu une étiquette “Commercial” ? Si oui, je
  l'ajoute comme condition » ; « oui, vas-y » → « je ne peux pas filtrer sur une étiquette avec ce déclencheur ».
  « change le déclencheur pour facture envoyée » → « J'ai changé le déclencheur… Je n’ai rien changé au parcours.
  Dis-moi quel message modifier ».
- Reproduction : `jouer-conversations.mts --scenarios C01 --demandes D07`.
- Preuve : `sorties/a/conversations-C01.json` (T4, T7), `…D07….json`.
- Cause racine : la consigne dit que la condition « tag » ne vaut que pour les déclencheurs d'étiquette
  (`generer-parcours.ts:383-385`) mais le modèle la propose quand même ; `ceQuiAChange` ne regarde que les
  messages et ajoute « je n'ai rien changé » quand seul le déclencheur change (l. 276-283).
- Correctif proposé : `generer-parcours.ts` — passer `trigger_event` avant / après à `ceQuiAChange` ; dire
  clairement dans la consigne ce qui est filtrable par déclencheur (et, quand le ciblage du point 6 existera,
  l'y brancher).
- Risque / à décider par Rafba : aucun.

### A-17 — Le journal des actions de Lumi ne montre pas ce qu'il a fait aux automatisations
- Point de la mission : 3, 5
- Gravité : mineur
- Ce qu'on voit : ce que Lumi change dans l'éditeur (panneau) n'apparaît nulle part ; ce qu'il change par le
  clavardage apparaît comme « update automation sms body », sans le nom de l'automatisation.
- Reproduction : `jouer-conversations.mts --scenarios C01` puis `journal-actions.mts`.
- Preuve : C01 T7 : « agent_actions depuis le début : (vide) » ; `journal-actions.mts` : les outils sans libellé
  sortent en anglais brut (« delete client », « update course ») et sans cible.
- Cause racine : la route `/generer` n'écrit que `lumi_conversation` (`automation-rules.ts:526-530`) et les
  écritures sont celles du navigateur ; `get_recent_agent_actions` n'a ni libellé ni repère pour les outils
  d'automatisation (`tools-etendus.ts:2500-2530`).
- Correctif proposé : journaliser chaque proposition de Lumi APPLIQUÉE par l'éditeur (qui, quoi, avant / après)
  dans le futur historique des modifications (point 5, agent D) ; compléter les libellés et le repère (`name`).
- Risque / à décider par Rafba : aucun.

### A-18 — Le clavardage écrit des textos de plus de 160 caractères, avec émoji, sans le dire
- Point de la mission : 16
- Gravité : mineur
- Ce qu'on voit : textos de 166 et 262 caractères enregistrés (facturés en 2 segments ; un émoji force un codage
  qui abaisse la limite à 70).
- Reproduction : `jouer-conversations.mts --scenarios C02`.
- Preuve : C02 T2 (« 166 caractères > 160 ») ; `repro-bug1-clavardage.json` (262 caractères).
- Cause racine : la règle des 160 caractères n'existe que dans la consigne du panneau (`generer-parcours.ts:423`) ;
  l'outil coupe à 1 600 (`tools-reglages.ts:704`).
- Correctif proposé : l'outil rend la longueur et le nombre de segments ; la carte l'affiche (avec l'agent chargé du point 16).
- Risque / à décider par Rafba : aucun.

### A-19 — Réglages › Messagerie ne montre pas les automatisations « Facture en retard » ni celles créées par Lumi
- Point de la mission : P7 (cohérence), 1
- Gravité : mineur
- Ce qu'on voit : « Textos automatiques » liste des règles, mais jamais une relance de facture en retard, ni une
  automatisation créée par Lumi.
- Reproduction : `ecrans-regle.mts`.
- Preuve : `sorties/a/ecrans-regle.json` (« règle absente de la page »).
- Cause racine : `src/pages/SettingsMessaging.tsx:474` filtre sur `actions` (vide pour une règle créée par Lumi) ;
  `TRIGGER_GROUPS` (l. 425-431) ne contient pas `invoice.overdue` ; `getAutomationRules` ne retire pas la corbeille
  (`automationRulesApi.ts:46-62`).
- Correctif proposé : filtrer par la fonction unique d'A-02, ajouter les déclencheurs manquants, retirer la corbeille.
- Risque / à décider par Rafba : cette section fait-elle double emploi avec la page Automatisations ?

### A-20 — L'aperçu « ce qui partirait » montre le message de Lumi avec des trous
- Point de la mission : 8, 17
- Gravité : mineur (hors de mon domaine : signalé pour les agents C et E)
- Ce qu'on voit : « Bonjour Ginette, votre facture  est en retard. … » — le numéro et le lien de la facture sont vides.
- Reproduction : `ecrans-regle.mts`.
- Preuve : `sorties/a/ecrans-regle.json` (aperçu et route `/apercu`).
- Cause racine : `server/routes/automation-test.ts:324-420` prend un client d'exemple, pas une facture.
- Correctif proposé : prendre une entité d'exemple du type du déclencheur.
- Risque / à décider par Rafba : aucun.

### A-21 — Un courriel écrit par Lumi part en un seul bloc, sans paragraphes
- Point de la mission : 16, 1
- Gravité : majeur
- Ce qu'on voit : Lumi écrit un courriel de trois paragraphes ; le client reçoit « Bonjour Maryse, Votre facture…
  Merci, L'équipe » d'une traite.
- Reproduction : test ci-dessous ; `relire-apres-ecriture.mts` (cas 1.7).
- Preuve : `tests/automations-finale/a/integration/a-moteur-deux-copies.test.ts::le corps écrit par update_automation_message (texte brut, sauts de ligne) part avec ses sauts de ligne` (rouge) —
  le courriel simulé contient `<div style="…">Bonjour Cliente,\n\nVotre facture…`.
- Cause racine : l'éditeur de courriel enregistre du HTML (`texteVersHtml`, `EmailPreviewEditor.tsx:405`) ; Lumi
  enregistre du texte brut avec `\n` — l'outil (`tools-reglages.ts:605-607`) comme le panneau (relevé : `/generer`
  rend `"body": "Bonjour [client_first_name],\n\nNous espérons…"`) ; le moteur colle le corps tel quel dans le
  gabarit (`server/lib/actions/index.ts:1330, 1485`).
- Correctif proposé : au moteur, convertir un corps sans balise en paragraphes (`texteVersHtml`) avant le gabarit —
  un seul endroit, qui couvre aussi ce qui est déjà en base.
- Risque / à décider par Rafba : aucun.

---

## 2. Balayage « succès sans écriture » — tous les outils d'écriture de Lumi

`scripts/qa/finale/a/relire-apres-ecriture.mts` : chaque outil est enveloppé ; l'empreinte de TOUTES les tables du
bureau (compte et hachage, 266 tables) est prise avant et après l'appel. Le scénario du reste du CRM est celui de la
session a1 (`scripts/qa/executer-outils-staging.mts`), rejoué tel quel à travers les enveloppes. Relevé :
`sorties/a/relire-apres-ecriture.json` et `.md`.

| | |
|---|---|
| Outils d'écriture recensés | **198** |
| Exécutés | **170** (211 appels) |
| Relus après un appel réussi | **164** |
| En défaut | **4** : `update_automation_message`, `update_automation_sms_body`, `toggle_automation_rule`, `set_automation_language` (A-03, A-05, A-06, A-07, A-08, A-21) |
| Répondent « rien n'a changé » et n'écrivent rien (honnête, pas un défaut) | 3 : `revert_invoice_to_draft` (déjà en brouillon), `update_role_preset` (rien à changer), `approve_timesheet` (aucune entrée) |
| Exécutés sans jamais réussir | 6 : `send_sms` (pas de fournisseur local : refus avant le bac à sable), `send_payment_reminders` (aucun rappel dû), `assign_job` (technicien sans équipe), `set_custom_field` et `schedule_job` (refus métier du scénario), `update_d2d_pipeline_item` (deal absent) |
| Non exécutés | 28 : envois et paiements réels exclus par le scénario a1 (`send_quote`, `send_invoice`, `send_quote_sms`, `send_agreement_email/sms`, `create_payment_request`, `resend_payment_request`, `charge_card_on_file`, `refund_payment`, `remove_card_on_file`, `send_scheduled_report_now`), préalable absent (`process_request_submission`, `delete_request_submission`, `approve_commission`, `mark_commission_paid`, `mark_conversation_read`, `delete_notification`, `convert_quote_to_job`, `create_invoice_for_visit`, `record_invoice_payment`, `mark_invoice_paid`, `merge_clients`, `apply_day_optimization`, `setup_taxes`), consentement de position (`start/pause/resume/end_field_session`) |

Hors automatisations, **aucun outil exécuté n'a répondu « fait » sans qu'une table métier change**. Limite de la
méthode : pour ces outils-là, on prouve qu'ILS ONT ÉCRIT, pas que ce qu'ils ont écrit est ce qu'ils annoncent ;
la relecture exacte (réponse comparée champ par champ) n'est faite que pour les outils d'automatisation. Le défaut
transversal A-03 (« déjà fait ») les concerne tous : prouvé sur `update_task_status`.

## 3. Conversations — état de départ (vrai modèle)

`scripts/qa/finale/a/jouer-conversations.mts` ; données : `tests/automations-finale/a/scenarios-conversation.json`
(20 scénarios, FR et EN) et `demandes-modification.json` (30 demandes). Joués : 7 scénarios, 10 demandes.

| Id | Canal | Résultat | Ce qui casse |
|---|---|---|---|
| C01 | panneau, FR | 3/7 tours | `actions` contredit `steps` (A-02) ; ciblage impossible (point 6) ; « active-la » non envoyable (A-12) ; le panneau ne sait pas activer (A-14) ; contradiction (A-16) |
| C02 | clavardage, FR | 2/7 | « C'est fait : l’action. » (A-05) ; 166 caractères (A-18) ; délai impossible (A-14) ; explication sans le texte (A-10) ; activation sans résumé (A-13) |
| C04 | clavardage, FR | 4/5 | activation sans résumé (A-13) ; références implicites (« celle des devis », « remets-la ») : réussies |
| C08 | clavardage, FR | 0/2 | part vers les relances de paiement (A-15) |
| C11 | clavardage, EN | 2/3 | activation sans résumé (A-13) |
| C13 | panneau, FR | **3/3** | — (ajout d'un courriel conditionnel, correction du délai, retrait de la condition) |
| C16 | clavardage, FR | 2/3 | « C'était déjà fait » alors que la langue est restée « fr » (A-03) |
| D01, D02, D04 | panneau | 0/3 | renommage silencieux (A-04) ; D01 aussi A-02 |
| D07, D08, D11 | panneau | 3/3 | — (déclencheur, condition de montant, ton en anglais) |
| D15 | clavardage | 0/1 | texte exact bien enregistré, mais non cité (A-05) |
| D17 | clavardage | 0/1 | « je n'ai pas accès au texte actuel » (A-10) ; variables inventées dans la proposition (A-06) |
| D21 | clavardage | 0/1 | « je n'ai pas trouvé d'automatisation nommée… », aucun outil (A-15, A-14) |
| D25 | clavardage | 0/1 | objet seul impossible (A-10) |

Total : scénarios 1/7, demandes 3/10. Le panneau de l'éditeur fait bien ce qui touche au PARCOURS (C13, D07, D08,
D11) ; tout le reste manque.

## 4. Coûts relevés (pour P4 — voir aussi LUMI_COST_REPORT.md, non refait)

| Canal | Modèle | Appels | Coût moyen par appel | Cache lu |
|---|---|---|---|---|
| Clavardage général (`source = lumi`) | claude-sonnet-5 | 41 | 0,99 ¢ | 84 % |
| Panneau de l'éditeur et `create_automation_from_text` (`source = automatisations`) | claude-sonnet-5 | 24 | 0,87 ¢ | 84 % |

- Un tour de clavardage : 1,35 ¢ en moyenne (max 7,25 ¢ : premier tour après un redémarrage du serveur, cache
  froid) ; 3,8 s ; ≈ 17 700 tokens relus en cache et 15 outils chargés par tour.
- La conversation de la mission (7 tours) : 4,42 ¢ par le panneau, 7,22 ¢ par le clavardage.
- Le clic « Confirmer » ne coûte rien (étage 0, gabarit) — c'est aussi pourquoi il ne cite rien (A-05).
- Le commentaire de `tools-reglages.ts:389-391` parle de « Haiku, 0,32 ¢ » : le modèle relevé est Sonnet 5.

## 5. Ce que je n'ai pas pu vérifier

- La prod : aucune requête (ni lecture) faite par moi ; les chiffres de prod viennent de `notes/P1-1-piste.md`.
  Que le propriétaire avait bien le panneau d'étape ouvert n'est pas observable après coup : c'est le seul
  enchaînement, parmi ceux essayés, qui redonne à la fois sa phrase, la réponse de Lumi et l'état exact de sa ligne.
- Mobile, vocal : non essayés.
- Rôle technicien et autres rôles dans le clavardage : non joués.
- 13 scénarios et 20 demandes écrits mais non joués (coût) ; l'acceptation « vérifié à l'écran par Playwright »
  n'est faite que pour A-01, A-04, A-12 et les reproductions du § 0.
- `get_recent_agent_actions` sur une action d'automatisation précise : lu dans le code, mesuré sur d'autres outils
  sans libellé.
- Fermer l'onglet dans les 3 secondes qui suivent la réponse de Lumi (avant l'enregistrement automatique), et
  l'état « incomplet » de l'éditeur qui suspend cet enregistrement : non essayés.
- Les 28 outils non exécutés et 6 jamais réussis du § 2.

## 6. Atelier — à savoir

- `D:/lume-final/outils/env-local.mjs` écrit une `PAYMENTS_ENCRYPTION_KEY` de 64 caractères hexadécimaux ; le
  serveur la lit en base64 (48 octets) et s'arrête (« Expected 32 bytes, got 48 »). Corrigé dans MON
  `wt-a/.env.local` seulement (valeur jetable de 32 octets) : les autres worktrees auront le même arrêt au
  premier `serveurs.mjs`.
- `set_automation_language` et les empreintes « déjà fait » polluent d'une passe à l'autre (10 min) : mes scripts
  vident `agent_actions` du bureau A (a) avant de mesurer.
- Mes serveurs (3492 / 5492) sont arrêtés. Le projet `a-ui` démarre les siens sur ces mêmes ports.
