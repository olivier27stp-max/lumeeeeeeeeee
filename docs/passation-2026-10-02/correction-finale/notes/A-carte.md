# Carte « qui lit, qui écrit » — agent A (Lumi ↔ automatisations)

Établie sur `mission/auto-finale-a` (origin/main `11e75ebc`), pile locale, le 2026-10-01.
Les lignes citées sont celles du worktree `D:/lume-final/wt-a`. Ce qui est marqué **mesuré** a été
exécuté (script ou test) ; le reste est lu dans le code.

## 1. Le modèle de données : une ligne, deux copies du message

Table `automation_rules` (22 colonnes ; relevé `information_schema`) :

| Colonne | Rôle |
|---|---|
| `actions jsonb` (défaut `[]`) | L'ANCIEN modèle « à plat » : une liste d'actions, toutes après `delay_seconds`. |
| `steps jsonb` (nul par défaut) | Le NOUVEAU modèle : le parcours de l'éditeur plein écran (étapes `action`, `attendre`, `si`, `arreter`, chaînées par `suivant` / `alors` / `sinon`). |
| `delay_seconds` | Délai unique de l'ancien modèle (négatif = avant le rendez-vous). Ignoré dès que `steps` existe. |
| `conditions`, `settings` | Filtre du déclencheur ; réglages (fenêtre d'envoi, ré-entrée, arrêt si résolu…). |
| `is_active` | **La seule notion brouillon / publié.** Il n'y a ni version brouillon, ni version publiée, ni table d'historique des versions (aucune colonne `published_at`, `version`, `draft_*` ; aucune table `automation_rule_versions`). Modifier une automatisation publiée modifie ce qui part. |
| `deleted_at`, `purged_at` | Corbeille, puis suppression définitive (la ligne reste). |
| `is_preset`, `preset_key`, `modele_id`, `folder_id` | Automatisation fournie ; copie liée d'un autre bureau ; dossier. |
| `lumi_conversation jsonb` | Le fil du panneau « Construire avec Lumi » (40 derniers tours). |

Deux déclencheurs en base : `trg_automation_rules_updated`, `trg_automation_rules_garde`
(la garde refuse à une session d'utilisateur de passer `is_active` de faux à vrai).
L'ancienne table `automations` (ancien moteur) existe encore, vide en prod (piste du coordinateur).

**Les deux copies.** Une automatisation bâtie dans l'éditeur porte son message DEUX fois :
`steps[n].action.config.body` (ce qui part) et `actions[n].config.body` (un reste). Personne ne les
tient égales (voir § 3). Mesuré : `tests/automations-finale/a/integration/a-moteur-deux-copies.test.ts`.

## 2. Ce que le moteur exécute

`server/lib/automationEngine.ts` :

- `lancerRegle` (l. 1536-1581) : **si `steps` est un tableau non vide, seul `steps` est suivi**
  (l. 1542-1567, première étape inscrite dans `automation_scheduled_tasks`, puis chaque étape ouvre la
  suivante) ; sinon `delay_seconds ≠ 0` → `scheduleDelayedActions` (l. 1344-1358, lit `rule.actions`) ;
  sinon `executeRuleActions` (l. 963-1000, lit `rule.actions`).
- La file planifiée relit la règle à chaque étape : `steps`, `actions`, `settings`, `is_active`,
  `deleted_at` (l. 1959, 2023, 2219) — une étape modifiée entre-temps part avec le NOUVEAU texte.
- `demarrerRegle` (l. 1588-1610, action « Démarrer une automatisation ») : même entrée.
- `server/lib/actions/index.ts` l. 3075-3090 : « Démarrer une automatisation » accepte une règle qui a
  `actions` OU `steps`.

**Mesuré** (test « le moteur exécute `steps` ») : avec `steps` = nouveau texte et `actions` =
« À compléter », le texto simulé porte le texte de `steps` ; « À compléter » ne part jamais.

## 3. Qui écrit `steps` et `actions`

| Qui | Fichier:ligne | `steps` | `actions` |
|---|---|---|---|
| Éditeur plein écran — création | `src/pages/AutomationBuilderPage.tsx:177-190` → `POST /api/automations/rules` | `[]` | **`[{ send_sms, body: « À compléter » }]`** (action provisoire, exigée par le serveur) |
| Éditeur plein écran — enregistrement automatique (3 s), publication, sortie de page | `AutomationBuilderPage.tsx:1190, 1331, 1499, 1525, 2002` → `PATCH { name, steps }` | le parcours | **jamais réécrit** → reste « À compléter » |
| Éditeur — « Convertir » une règle au format d'origine | `AutomationBuilderPage.tsx:1432` → `PATCH { steps }` | projeté depuis `actions` | inchangé |
| Éditeur — 2e automatisation proposée par Lumi | `AutomationBuilderPage.tsx:727-742` | le parcours | la 1re action seulement |
| Panneau « Construire avec Lumi » | `server/routes/automation-rules.ts:354-544` | **n'écrit rien** (renvoie `steps` au navigateur ; n'écrit que `lumi_conversation`, l. 526-530) | — |
| Route de création | `automation-rules.ts:253-276` | tel que reçu (`null` si absent) | tel que reçu |
| Route de modification | `automation-rules.ts:672-678` (`update({ ...patch })`) | si présent dans le corps | si présent dans le corps — **aucune dérivation** |
| Route « Utiliser ce modèle » | `automation-rules.ts:778-792` | copie du modèle (ou projection de ses `actions`) | copie des `actions` du modèle |
| Route « Dupliquer » | `automation-rules.ts:832-862` | copie | copie |
| Copie vers d'autres bureaux, héritage | `server/lib/automatisations-bureaux.ts:155, 228-242, 288` ; `server/lib/office-inheritance.ts:548-562` | copie | copie |
| Préréglages (semis) | `server/lib/automationPresetSeeder.ts:163-190` ; trigger SQL `seed_automation_presets` | seulement les parcours du pack (`PACK_PARCOURS`) | toujours |
| Liste — éditeur de message sur place (`MessageEditor`), Réglages › Messagerie, Réglages › Avis | `src/lib/automationRulesApi.ts:86-160` (`updateRuleMessage`, écriture PostgREST directe) | l'étape, s'il n'y a qu'un message de ce type | **tous** les messages de ce type |
| Lumi — `update_automation_message`, `update_automation_sms_body` | `server/lib/agent/tools-reglages.ts:588-654` | l'étape visée | seulement s'il n'y a qu'UN message de ce type (`refletUnique`, l. 631) |
| Lumi — `create_automation_from_text` | `tools-reglages.ts:489-503, 520-534` | le parcours généré | **`[]`** |
| Lumi — `create_automation_from_template`, `duplicate_automation_rule`, `rename_automation_rule`, `delete_automation_rule` | `server/lib/agent/tools-lot-entreprise.ts:454-721` | par les routes ci-dessus | par les routes ci-dessus |
| Ancien éditeur en fenêtre (`AutomationBuilder.tsx`) | `src/components/automations/AutomationBuilder.tsx:251-264` | le parcours | dérivé des étapes | 

Le dernier est le seul à avoir dérivé `actions` de `steps` — et il n'est plus importé nulle part
(code mort : 874 lignes, à retirer en P6).

## 4. Qui lit `steps` et `actions`

| Qui | Fichier:ligne | Lit | Conséquence |
|---|---|---|---|
| Moteur | § 2 | `steps` d'abord | ce qui part |
| Carte du canevas, panneau d'étape | `AutomationBuilderPage.tsx` (état `steps`), `PanneauEtape.tsx` | `steps` | **mesuré** : montrent le nouveau texte… sauf le panneau déjà ouvert (constat A-01) |
| Éditeur — détection « format d'origine », contrôles de publication | `AutomationBuilderPage.tsx:1097, 1265, 1305, 1377-1397` ; `src/lib/publicationAutomatisation.ts:44-63` ; `src/lib/sequenceTypes.ts:285-312` | les deux | `actions` = « À compléter » compte pour « parcours vide » |
| Aperçu (« ce qui partirait ») | `server/routes/automation-test.ts:339, 382-386` | `steps` d'abord | **mesuré** : texte de `steps` — mais `[invoice_number]` et `[invoice_link]` y sortent vides (l'aperçu prend un client, pas une facture) |
| Liste — ligne dépliée « Voir les messages » | `src/pages/Automations.tsx:2188-2260` | `steps` d'abord (lecture seule) ; sinon `actions` (modifiable) | **mesuré** : texte de `steps` |
| Liste — textes d'exemple, « demande d'avis » | `Automations.tsx:768, 860-861` | les deux | — |
| Réglages › Messagerie | `src/pages/SettingsMessaging.tsx:474` (filtre), `:480` (texte) | **filtre sur `actions`**, texte par `texteDuMessage` (`steps` d'abord) | une règle créée par Lumi (`actions: []`) n'y apparaît jamais ; « Facture en retard » n'est dans aucun groupe (l. 425-431) → jamais listée (**mesuré**) |
| Réglages › Avis | `src/pages/SettingsReviews.tsx:310, 698` | idem | idem |
| Lumi — carte de confirmation (« Texte actuel ») | `server/lib/lumi/complements-cartes.ts:117-140` | `steps` d'abord | correct |
| Lumi — faut-il une carte avant « terminer une job » ? | `server/lib/lumi/execution.ts:114-125` (`ecrituresSensiblesPour`) | **`actions` seulement** | un parcours qui texte le client à « job terminée » est invisible (constat A-11, **mesuré**) |
| Lumi — « tu en as déjà une » | `server/lib/lumi/deja-publiees.ts:51-52` | les deux | — |
| Optimisation de journée | `server/lib/trajets/propositionJournee.ts:239-241` | les deux | — |
| Lumi — `list_automations` | `server/lib/agent/tools-etendus.ts:932-958` | **ni l'un ni l'autre** (id, nom, déclencheur, actif, fournie) | Lumi ne peut pas lire le contenu d'une automatisation (constat A-10) |

## 5. Les outils de Lumi liés aux automatisations (15)

Clavardage général (`POST /api/lumi/chat`, modèle Sonnet 5 ; chaque écriture passe par une carte puis
`POST /api/lumi/execute`). Topic « rapports » de `server/lib/lumi/topics.ts:85-88`.

| Outil | Type | Fichier:ligne | Ce qu'il écrit | Ce qu'il renvoie |
|---|---|---|---|---|
| `list_automations` | lecture | `tools-etendus.ts:932` | — | `count`, `automations[{ id, name, trigger_event, is_active, is_preset }]` — 50 au plus, par nom, sans corbeille |
| `get_automation_health` | lecture | `tools-etendus.ts:960` | — | sur les 100 dernières exécutions : partis, sautés (motifs), échoués (causes) |
| `list_automation_templates` | lecture | `tools-lot-entreprise.ts:621` | — | modèles de la bibliothèque (clé, nom, catégorie, déclencheur, canaux, nombre d'étapes) |
| `toggle_automation_rule` | écriture | `tools-reglages.ts:342` | `is_active` (par `changerPublication`, mêmes contrôles que l'écran) | `updated`, `rule_id`, `name`, **`is_active` = la valeur DEMANDÉE** (non relue), `note` |
| `create_automation_from_text` | écriture | `tools-reglages.ts:403` | une règle en brouillon : `steps` générés (Haiku, `generer-parcours.ts`), `actions: []` ; une 2e règle si demandée | `created`, `rule_id`, `name`, `trigger_event`, `etapes`, `resume` (avec le texte des messages), `note` |
| `update_automation_message` | écriture | `tools-reglages.ts:656` | corps (et objet) d'UN message : `steps` ; `actions` seulement s'il n'y en a qu'un | `updated`, `rule_id`, `name`, `action_type`, **`ancien_texte`** (pas le nouveau relu), `note` |
| `update_automation_sms_body` | écriture | `tools-reglages.ts:685` | idem, texto seulement | idem |
| `set_automation_language` | écriture | `tools-reglages.ts:710` | `company_settings.default_language` (toute l'entreprise, pas une automatisation) | `updated`, `language`, `note` |
| `delete_automation_rule` | écriture | `tools-lot-entreprise.ts:454` | `DELETE /automations/rules/:id` : corbeille + envois prévus annulés | `deleted`, `rule_id`, `name`, `etait_active`, `note` |
| `duplicate_automation_rule` | écriture | `tools-lot-entreprise.ts:490` | `POST …/duplicate` : copie en brouillon | `duplicated`, `rule_id`, `name`, `copie_de`, `is_active` (relu par `garantirBrouillon`) |
| `rename_automation_rule` | écriture | `tools-lot-entreprise.ts:523` | `PATCH { name }` | `updated`, `rule_id`, `name` (celui de la route), `ancien_nom` |
| `pause_all_automations` | écriture | `tools-lot-entreprise.ts:562` | `POST /automations/pause` → `company_settings.automations_paused` | `updated`, `paused` (**relu** par la route ; refuse si l'état réel diffère) |
| `create_automation_from_template` | écriture | `tools-lot-entreprise.ts:680` | `POST /automations/templates/utiliser` : copie en brouillon | `created`, `rule_id`, `name`, `modele`, `declencheur`, `etapes`, `is_active` |
| `get_reminder_settings` / `update_reminder_settings` | lecture / écriture | `tools-argent.ts:1937, 1963` | les **relances de paiement** (un AUTRE système que `automation_rules`) | réglages des relances |
| `send_payment_reminders` | écriture | `tools-etendus.ts:3886` | envoie les relances maintenant | compte |

Panneau « Construire avec Lumi » de l'éditeur (`POST /api/automations/rules/generer`, modèle Haiku,
`server/lib/lumi/generer-parcours.ts`) : ce n'est pas un outil. Le modèle reçoit le catalogue
(déclencheurs, actions, variables), les 6 derniers échanges, et `parcours_actuel` =
`{ trigger_event, steps }` — **pas** le nom, **pas** `conditions`, **pas** `settings`, **pas**
`is_active`. Il renvoie `{ nom, trigger_event, resume, steps, autre }` ; c'est le navigateur qui écrit.

Journal : toute écriture d'un outil pose une ligne `agent_actions` (`executerIdempotent`,
`tools-etendus.ts:281-391`), lue par `get_recent_agent_actions` (`tools-etendus.ts:2484`). Le panneau
de l'éditeur n'y écrit RIEN (mesuré : conversation C01, `agent_actions` vide).

## 6. Ce que l'interface permet / ce que Lumi sait faire

« Panneau » = Lumi dans l'éditeur ; « Clavardage » = Lumi général (`/lumi`). Mesuré = joué au vrai
modèle (`scripts/qa/finale/a/jouer-conversations.mts`, sorties dans `D:/lume-final/sorties/a/`).

| Capacité | Interface | Panneau de l'éditeur | Clavardage général |
|---|---|---|---|
| Créer | oui | oui (décrire) | `create_automation_from_text`, `create_automation_from_template` |
| Lire le contenu (étapes, textes) | oui | oui (reçoit `steps`) | **MANQUE** — `list_automations` ne rend ni étapes ni textes |
| Expliquer | — | oui, mesuré (C01 T5, C13) | **MANQUE** — explique sans le texte (« le texto qu'on vient de peaufiner », C02 T5) |
| Renommer | oui | **MANQUE** (et renomme sans qu'on le demande, A-04) | `rename_automation_rule` |
| Changer le déclencheur | oui | oui, mesuré (D07) | **MANQUE** |
| Conditions du déclencheur (`conditions`) | oui (panneau « Quand ») | **MANQUE** (ne reçoit ni n'écrit `conditions`) | **MANQUE** |
| Condition dans le parcours (« si ») | oui | oui : statut, montant, étiquette (D08 mesuré) | **MANQUE** |
| Ciblage (type de client, étiquettes, champs) | n'existe pas encore (point 6) | **MANQUE** — Lumi le dit, puis se contredit (C01 T4/T7) | **MANQUE** — Lumi le dit (C02 T4) |
| Ajouter / retirer / réordonner une action | oui | oui, mesuré (C13) | **MANQUE** — propose de RECRÉER l'automatisation (C02 T3) |
| Texte d'un texto | oui | oui, mesuré | `update_automation_sms_body` — sans lire l'ancien (D17) |
| Texte et objet d'un courriel | oui | oui | `update_automation_message` — l'objet seul est impossible (corps obligatoire et illisible, D25) |
| Délais | oui | oui, mesuré (C01 T3, C13 T2) | **MANQUE** (C02 T3, D21) |
| Branches | oui | oui | **MANQUE** |
| Réglages (fenêtre d'envoi, ré-entrée, arrêt si résolu, une fois par client) | oui (onglet Réglages) | **MANQUE** | **MANQUE** |
| Langue | réglage d'entreprise | **MANQUE** | `set_automation_language` (entreprise entière) |
| Activer / désactiver | oui | **MANQUE** (et « active-la » ne s'envoie pas : < 10 caractères) | `toggle_automation_rule` — sans résumé préalable (A-13) |
| Dupliquer | oui | **MANQUE** | `duplicate_automation_rule` |
| Supprimer | oui | **MANQUE** | `delete_automation_rule` |
| Restaurer de la corbeille | oui | **MANQUE** | **MANQUE** |
| Ranger dans un dossier | oui | **MANQUE** | **MANQUE** |
| Copier vers d'autres bureaux | oui | **MANQUE** | **MANQUE** |
| Tout arrêter / reprendre | oui | **MANQUE** | `pause_all_automations` |
| Aperçu « ce qui partirait » / tester avec un client | oui (Aperçu) | **MANQUE** | **MANQUE** |
| Voir pourquoi ça n'est pas parti | Journaux | **MANQUE** | `get_automation_health` |

Aucun des deux canaux ne couvre la chaîne de la mission (« change le message → plus court → délai →
clients commerciaux → explique → active-la ») : le panneau ne sait ni cibler ni activer ; le
clavardage ne sait ni lire, ni toucher aux délais, ni cibler.

## 7. Contexte de page (point 3)

- Le clavardage général est une PAGE à part (`/lumi`, `src/pages/Lumi.tsx`). Il n'existe pas de Lumi
  « ouvert depuis l'éditeur » autre que le panneau. Ce que le navigateur envoie à `/api/lumi/chat` :
  `{ conversation_id, message, language, origine }` (`src/lib/lumiApi.ts:220-232`, schéma
  `server/routes/lumi.ts:76-82`) — **aucune page, aucun identifiant, aucun résumé**.
- Le panneau de l'éditeur envoie `{ demande, langue, echanges (6 derniers), parcours_actuel:
  { trigger_event, steps }, rule_id }` (`AutomationBuilderPage.tsx:677-685`,
  `src/lib/automationBuilderApi.ts:376-386`). `steps` est l'état LOCAL de l'éditeur : les
  modifications pas encore enregistrées du canevas en font partie. Le brouillon d'un panneau d'étape
  OUVERT n'en fait pas partie (il vit dans `PanneauEtape`, pas dans `steps`).
