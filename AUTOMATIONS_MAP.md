# Carte des automatisations de Lume (phase 0)

Relevé fait le 2026-10-02 dans l'arbre `D:/lume-final/wt`, branche `mission/automatisations-finale`. La lecture a
commencé à la tête `038d2fe8` ; pendant la lecture, la branche a avancé jusqu'à `22b85158` (fusion de `origin/main`
et des preuves des agents E et F). Entre les deux, quatre fichiers du produit ont changé
(`server/lib/agent/tools-argent.ts`, `tools-etendus.ts`, `tools.ts`, `server/lib/lumi/complements-cartes.ts`) : leurs
numéros de ligne cités ici ont été revérifiés à `22b85158`.
Tout ce qui suit a été lu dans le code de cet arbre. Rien n'a été exécuté : ni serveur, ni test, ni base.
Les références sont écrites `chemin:ligne`, depuis la racine du dépôt. Elles valent pour cette tête : d'autres
fusions les déplaceront.

Ce qui est fusionné dans cet arbre au moment de la lecture : les corrections de l'éditeur (agent U, majeurs
seulement), de Lumi (agent L) et des modèles / messages / réglages (agent T). Ce qui n'y est PAS encore : les
corrections du moteur (agent M) et celles des statistiques, de l'historique et des journaux (agent S). Le moteur
et les écrans de chiffres décrits ici sont donc ceux d'avant ces deux lots.

Mots employés :
- « règle » = une ligne de la table `automation_rules` = une automatisation ;
- « parcours » = la colonne `steps` (étapes chaînées du nouvel éditeur) ;
- « à plat » = l'ancien format, colonnes `actions` + `delay_seconds` ;
- « session » = un utilisateur connecté, rôle `authenticated` en base (soumis à la RLS) ;
- « rôle de service » = le serveur avec la clé `service_role` (contourne la RLS).

---

## 1. Les modèles de données

### 1.1 Il y a un seul modèle vivant, et un ancien encore lu

| Modèle | Table | État dans le code |
|---|---|---|
| Vivant | `automation_rules` | Lu et écrit par l'éditeur, la liste, le moteur, Lumi, les préréglages, la bibliothèque de modèles et l'API. |
| Ancien | `automations` (colonnes `trigger`, `delay_value`, `delay_unit`, `message_template`, `active`, `category` — `supabase/SCHEMA_SNAPSHOT.md:620-632`) | Aucun écran, aucune route, aucun outil. Un seul lecteur : le planificateur, à chaque passage (`server/lib/scheduler.ts:850-888`). Personne n'y écrit. |

Un troisième système existe à côté, pour le même besoin que « Facture en retard » : les relances de paiement
(`reminder_settings`, `reminder_log`, route `server/routes/reminders-cron.ts`). Il n'utilise pas `automation_rules`
pour s'exécuter, mais il le lit pour ne pas doubler une relance (`server/routes/reminders-cron.ts:194`).

### 1.2 La table `automation_rules`

Colonnes (`supabase/SCHEMA_SNAPSHOT.md:553-576`) :

| Colonne | Rôle |
|---|---|
| `id`, `org_id`, `name`, `description` | Identité. `org_id` = le bureau. |
| `trigger_event` (texte) | UN déclencheur. Aucune contrainte en base sur sa valeur : c'est le serveur qui vérifie le catalogue. |
| `conditions` (jsonb, `{}` par défaut) | Les réglages du déclencheur et les filtres. Clés réservées : `champs_perso`, `client_a_etiquette`, `client_sans_etiquette`. |
| `actions` (jsonb, `[]` par défaut, NON NULL) | Ancien format : liste d'actions `{ type, config }`. |
| `delay_seconds` (entier, 0 par défaut) | Ancien format : un seul délai pour toutes les actions. Négatif = « X avant le rendez-vous ». Ignoré dès qu'un parcours existe. |
| `steps` (jsonb, nul par défaut) | Nouveau format : le parcours. Étapes `action`, `attendre`, `si`, `arreter`, reliées par `suivant` / `alors` / `sinon` / `si_reponse` / `si_depasse` (`src/lib/sequenceTypes.ts:15-80`). La tête du parcours est `steps[0]`. |
| `settings` (jsonb, nul par défaut) | Réglages de la règle : `fenetre`, `jours_ouvrables`, `reentree`, `arret_sur_reponse`, `delai_entre_passages_jours`, `arreter_si_resolu` (`server/lib/automationEngine.ts:483-497`). |
| `is_active` (booléen, **vrai par défaut en base**) | La seule notion brouillon / publié. Il n'y a pas de version brouillon séparée, pas de version publiée figée, pas de table de versions. Modifier une règle publiée modifie ce qui part. |
| `is_preset`, `preset_key` | Automatisation fournie par Lume. |
| `pipeline_id`, `stage_id` | Portée pipeline pour les déclencheurs `deal.*` (`server/lib/automationEngine.ts:80-99`). |
| `folder_id` | Dossier de rangement (`automation_folders`). |
| `modele_id` | Copie liée à une règle d'un autre bureau. Toute modification du contenu la détache (`server/routes/automation-rules.ts:672`). |
| `lumi_conversation` (jsonb, `[]`) | Le fil du panneau « Construire avec Lumi », 40 derniers tours. |
| `deleted_at`, `purged_at` | Corbeille, puis suppression définitive (la ligne reste, pour garder les journaux). Contrainte : purgée ⇒ déjà à la corbeille (`supabase/SCHEMA_SNAPSHOT.md:8106`). |
| `created_at`, `updated_at` | `updated_at` sert de numéro de version à l'éditeur (garde `version_lue`, voir 5.1). |

Garde en base (`supabase/migrations/20261007300000_automation_rules_garde.sql`) : le déclencheur
`trg_automation_rules_garde` refuse à une session (rôles `authenticated` et `anon`) de publier (`is_active` de faux à
vrai), de créer une règle publiée ou fournie, de toucher à `org_id` / `is_preset` / `preset_key`, de changer le
déclencheur ou de supprimer une règle fournie, de purger hors corbeille, et tout `DELETE`. Le rôle de service et les
fonctions `SECURITY DEFINER` passent. Cette garde ne contrôle PAS le contenu (`trigger_event` d'une règle à soi,
`steps`, `actions`, `conditions`, `settings`, `name`).

Politiques RLS (`supabase/SCHEMA_SNAPSHOT.md:4706-4719`) : lecture = droit `automations.read` ; insertion, modification
et suppression = droit `automations.update` ; plus la politique restrictive `bureau_actif`.

Autre déclencheur de la table : `trg_automation_rules_updated` (`supabase/SCHEMA_SNAPSHOT.md:10183`).

### 1.3 Les deux représentations : `steps` et `actions`

La règle retenue pendant la mission (écrite dans `server/lib/automations-etapes.ts:1-26` et
`server/lib/automations-ecriture.ts:1-30`) :

1. La source unique est `steps`. Dès qu'un parcours existe, c'est lui que le moteur exécute.
2. `actions` n'est plus qu'un reflet : les actions du parcours, dans l'ordre, recopiées à chaque écriture d'un parcours.
3. Une règle sans parcours (ancien format) reste exécutée depuis `actions` + `delay_seconds`.
4. Les lecteurs passent par un accès unique : `etapesDeLaRegle` / `messagesDeLaRegle` côté serveur
   (`server/lib/automations-etapes.ts:65`, `:106`), `messagesDeRegle` côté navigateur (`src/lib/automationRulesApi.ts:204`).

Cette règle n'est pas encore appliquée partout. Trois points à connaître :

- **Le sens de « a un parcours » n'est pas le même partout.** Le moteur et le serveur disent « `steps` est un tableau
  NON VIDE » (`server/lib/automationEngine.ts:1542`, `server/lib/automations-etapes.ts:56-58`). Le navigateur dit
  « `steps` est un tableau, même vide » (`src/lib/automationRulesApi.ts:208`). Pour une règle `steps = []` avec des
  `actions`, le moteur exécute `actions`, et les écrans Réglages › Messagerie n'en montrent aucun message.
- **Trois fonctions différentes fabriquent le reflet `actions`**, pas dans le même ordre : `actionsDepuisEtapes`
  (ordre du tableau, `server/lib/automations-etapes.ts:131`), `refletDuParcours` (ordre du parcours, 20 au plus,
  `server/lib/automation-messages.ts:119` et `src/lib/automationRulesApi.ts:192`), `actionsDuParcours`
  (`src/lib/publicationAutomatisation.ts:66`, utilisée par l'éditeur).
- **Les règles déjà en base ne sont pas rattrapées.** Le reflet n'est réécrit qu'à la prochaine modification du
  parcours. Je n'ai trouvé dans `supabase/migrations/` aucune migration qui re-dérive `actions` de `steps` pour
  toutes les règles. Un script d'essai à blanc existe (`scripts/qa/finale/unification-essai-a-blanc.mts`, arrivé
  pendant la lecture, non relu) ; ce n'est pas une migration.

#### Qui ÉCRIT `steps` et `actions`

« Client » = avec quel accès l'écriture part.

| Qui écrit | Où (fichier:ligne) | `steps` | `actions` | Client |
|---|---|---|---|---|
| Création par l'API ou l'éditeur — `POST /api/automations/rules` | `server/routes/automation-rules.ts:271-294` | tel que reçu, sinon nul | tel que reçu (obligatoire dans le schéma) | session |
| L'éditeur crée une règle neuve | `src/pages/AutomationBuilderPage.tsx:309`, `:1178` | — | un texto provisoire « À compléter » | par la route ci-dessus |
| Modification par l'API ou l'éditeur — `PATCH /api/automations/rules/:id` | `server/routes/automation-rules.ts:776-785` | si présent dans le corps | si présent dans le corps ; sinon re-dérivé du parcours QUAND le parcours change et n'est pas vide (`refletDesActions`, `server/lib/automations-etapes.ts:156-160`) | session |
| L'éditeur enregistre (automatique, publication, conversion) | `src/pages/AutomationBuilderPage.tsx:1355-1366`, `:2029` | le parcours | le reflet `actionsDuParcours` | par la route PATCH |
| Texte d'un message — `PATCH /api/automations/rules/:id/messages` (liste, Réglages › Messagerie, Réglages › Avis, éditeur de courriel) | `server/routes/automation-messages.ts:263-265`, calcul dans `server/lib/automation-messages.ts:234-245` | l'étape visée, si la règle a un parcours | le reflet du parcours ; sinon l'action visée | session |
| « Utiliser ce modèle » — `POST /api/automations/templates/utiliser` | `server/routes/automation-rules.ts:897-911` | le parcours du modèle, ou la projection de ses `actions` | **les `actions` du modèle, recopiées telles quelles** (pas le reflet du parcours) | session |
| « Dupliquer » — `POST /api/automations/rules/:id/duplicate` | `server/routes/automation-rules.ts:970-991` | copie | copie | session |
| « Copier vers d'autres bureaux » et propagation aux copies liées | `server/lib/automatisations-bureaux.ts:164-177`, `:228-242`, `:288-290` | copie | copie | session bornée au bureau cible |
| Héritage à la création d'un bureau | `server/lib/office-inheritance.ts:548-565` | copie | copie | rôle de service |
| Semis des préréglages (serveur) | `server/lib/automationPresetSeeder.ts:163-190` | seulement pour les parcours du pack (`PACK_PARCOURS`) | toujours | rôle de service |
| Semis des préréglages (base) | fonction `seed_automation_presets(p_org_id)` (`supabase/SCHEMA_SNAPSHOT.md:7887`), dernière définition `supabase/migrations/20261003600000_courriels_prereglages.sql:37-49` ; déclencheur `trg_org_created_seed_automations` sur `orgs` (`supabase/SCHEMA_SNAPSHOT.md:10349`) | non : les insertions ne portent pas `steps` | oui | `SECURITY DEFINER` |
| Migrations de données | ex. `supabase/migrations/20261003600000_courriels_prereglages.sql:935`, `:942` (`update … set steps = …`) | réécrit `steps` de parcours fournis | non vérifié (voir « Non vérifié ») | `postgres` |
| Lumi — toute écriture de contenu passe par `ecrireRegle` | `server/lib/automations-ecriture.ts:197-198` (reflet), `:211-215` (modification), `:224-241` (création) | le parcours | re-dérivé du parcours dans la MÊME écriture ; pour une règle à plat, `actions` est écrit directement | session (`ctx.client`) |
| └ `create_automation_from_text` | `server/lib/agent/tools-reglages.ts:633-641`, `:658-667` | parcours généré | reflet | |
| └ `update_automation_from_text` | `server/lib/agent/tools-reglages.ts:797-804` | parcours modifié | reflet | |
| └ `update_automation_message`, `update_automation_sms_body` | `server/lib/agent/tools-reglages.ts:884-898` | l'étape visée | reflet ; règle à plat : l'action visée | |
| Panneau « Construire avec Lumi » — `POST /api/automations/rules/generer` | `server/routes/automation-rules.ts:559-565`, `server/lib/lumi/panneau-automatisation.ts:243` | rien (le parcours est rendu au navigateur, qui l'enregistre par PATCH) | rien | écrit seulement `lumi_conversation`, par la session |
| Ancien éditeur en fenêtre `AutomationBuilder.tsx` | `src/components/automations/AutomationBuilder.tsx:251-264` | parcours | dérivé | **code mort** : aucun fichier de `src/` ne l'importe |

Le navigateur n'écrit plus jamais `automation_rules` directement (voir 6.2).

#### Qui LIT `steps` et `actions`

| Qui lit | Où (fichier:ligne) | Ce qu'il lit | Conforme à la règle ? |
|---|---|---|---|
| Moteur — lancement d'une règle | `server/lib/automationEngine.ts:1536-1581` | `steps` s'il est non vide ; sinon `actions` + `delay_seconds` | oui |
| Moteur — actions immédiates, tâches à délai | `server/lib/automationEngine.ts:958-1000`, `:1346-1382` | `actions` (règle à plat seulement) | oui |
| Moteur — file planifiée | `server/lib/automationEngine.ts:1959`, `:2023`, `:2121-2123`, `:2219` | À chaque tâche, relit de la règle : `is_active`, `deleted_at`, `settings`, et `steps` (pour savoir si l'étape existe encore, juger un « si », trouver la suite). **Le contenu de l'action exécutée, lui, vient de la COPIE gardée dans la tâche** (`action_config`), faite au moment où la tâche a été mise en file. | oui pour la source ; voir 3.3 pour l'effet d'une modification |
| Action « Démarrer une automatisation » | `server/lib/actions/index.ts:3075-3095` | les deux : refuse seulement si `actions` ET `steps` sont vides | oui |
| Accès unique serveur | `server/lib/automations-etapes.ts:65-69` | `steps`, sinon projection de `actions` | c'est la règle |
| Contrôles de publication | `src/lib/publicationAutomatisation.ts:100-125`, `server/lib/automations-publication.ts:149` | les deux (une règle neuve avec « À compléter » = parcours vide) | oui |
| Route d'aperçu « ce qui partirait » | `server/routes/automation-test.ts:338-386` | `steps` d'abord, sinon `actions` | oui |
| Route du texte d'un message | `server/lib/automation-messages.ts:138`, `:234-245` | `steps` d'abord | oui |
| Lumi — lecture et résumé (`get_automation`, cartes, contexte de page, panneau) | `server/lib/agent/tools-reglages.ts:363-372`, `server/lib/lumi/avant-carte.ts:74`, `server/lib/lumi/contexte-automatisation.ts:66`, `:253`, `server/lib/lumi/panneau-automatisation.ts:132` | par `etapesDeLaRegle` | oui |
| Lumi — « faut-il une carte avant de terminer un job ? » | `server/lib/lumi/execution.ts:44`, `:156` | par l'accès unique | oui (corrigé pendant la mission) |
| Lumi — « tu en as déjà une » | `server/lib/lumi/deja-publiees.ts:49-62` | les deux, par `typesDAction` | oui |
| Lumi — compléments de carte (texte actuel d'un message, résumé avant activation) | `server/lib/lumi/complements-cartes.ts:121-129`, `:152-158`, `:449-454` | `steps` d'abord, sinon `actions`, par un code à lui | oui sur le fond, mais sans passer par l'accès unique |
| Éditeur plein écran | `src/pages/AutomationBuilderPage.tsx:1211`, `:1967-1990` | `steps` ; `actions` seulement pour reconnaître et projeter une règle à plat | oui |
| Liste — nombre d'étapes, messages dépliés | `src/pages/Automations.tsx:1884-1888`, `:2188-2260` | `steps` d'abord, sinon `actions` | oui |
| Liste — « demande-t-elle un avis ? » | `src/pages/Automations.tsx:859-861` | les deux | oui |
| Liste — `getChannels(actions)` | `src/pages/Automations.tsx:296` | `actions` seulement | **fonction jamais appelée** (aucun autre usage dans le fichier) |
| Réglages › Messagerie | `src/pages/SettingsMessaging.tsx:512`, `:521-525` | `messagesDeRegle` (parcours d'abord) | oui |
| Réglages › Avis — texte | `src/pages/SettingsReviews.tsx:311` | `texteDuMessage` (parcours d'abord) | oui |
| **Réglages › Avis — bouton de modification du texto** | `src/pages/SettingsReviews.tsx:705` | **`rule.actions.some(...)` : `actions` seulement** | **non** — reste à basculer |
| **Optimisation de journée (trajets)** | `server/lib/trajets/propositionJournee.ts:239-241` | `actions` ET `steps` mis bout à bout, cherchés en texte | **non** — ne passe pas par l'accès unique ; pour une règle à parcours dont `actions` serait périmé, il peut voir un envoi qui n'existe plus |
| Copies (dupliquer, copier vers bureaux, héritage, modèle) | voir tableau des écrivains | recopient les deux colonnes telles quelles | une copie garde un reflet périmé s'il l'était |

### 1.4 L'ancienne table `automations`

- Lue à chaque passage du planificateur : `server/lib/scheduler.ts:850-853` (`select * where active = true`).
- Ses cinq traitements : `days_after_quote_sent` (`server/lib/scheduler.ts:135`), `days_before_appointment` (`:175`),
  `on_invoice_due_date` (`:217`), `days_after_invoice_due` (`:253`), `days_after_job_completed` (`:292`), distribués
  par `server/lib/scheduler.ts:861-888`.
- Ils envoient leurs textos par un chemin à eux (`sendOrgSms`, `server/lib/scheduler.ts:95`), hors du moteur : ni
  fenêtre d'envoi, ni consentement, ni plafond, ni pause par bureau, ni journal `automation_execution_logs`.
- Ses politiques RLS laissent tout membre lire et écrire (`supabase/SCHEMA_SNAPSHOT.md:4742-4752`), sans droit
  `automations.*`.
- Aucun `from('automations')` ailleurs dans `server/` ni dans `src/`.

### 1.5 Les tables satellites

| Table | Ce qu'elle porte | Qui écrit | Qui lit | Accès d'une session |
|---|---|---|---|---|
| `automation_scheduled_tasks` | Une ligne par envoi prévu : action à délai, étape de parcours, report hors heures, report de rafale, reprise d'un échec. `status` ∈ pending, running, completed, failed, cancelled. `execution_key` sert d'anti-doublon (index unique `idx_scheduled_tasks_dedup`, `supabase/migrations/20260751100300_uniques_org_scope_and_soft_delete.sql:146`). `step_id`, `sequence_context` pour les parcours. | Le moteur (`server/lib/automationEngine.ts:1008`, `:1033`, `:1189`, `:1363`, mises à jour `:1903-2558`), les parcours (`server/lib/automationSequences.ts:457`, `:530`, `:545`, `:589`), l'action « Arrêter une automatisation » (`server/lib/actions/index.ts:3006`), la suppression d'une règle (`server/routes/automation-rules.ts:1050-1055`), le déplacement d'un rendez-vous (`server/routes/automation-events.ts:156`). | Moteur (`server/lib/automationEngine.ts:1952`), onglet Historique (`src/lib/automationJournauxApi.ts:124`), statistiques (`server/routes/automation-stats.ts:112`), aperçu de test (`server/routes/automation-test.ts:212`), carte de Lumi (`server/lib/lumi/complements-cartes.ts:413`), relances de paiement (`server/routes/reminders-cron.ts:228`). | lecture seule, droit `automations.read` (`supabase/SCHEMA_SNAPSHOT.md:4721-4727`) |
| `automation_execution_logs` | Une ligne par action exécutée, sautée ou échouée ; une ligne `action_type = 'conditions'` par règle écartée par ses filtres. `result_data.saute` + `saute_code` pour un envoi sauté. | Le moteur seulement (`server/lib/automationEngine.ts:402`, `:873`, `:911`, `:1326`, `:2356`, `:2449`, `:2489`), les parcours (`server/lib/automationSequences.ts:473`). | Onglet Journaux et Vue d'ensemble (`src/lib/automationJournauxApi.ts:77`, `:448`), liste (`src/lib/automationRulesApi.ts:525`), statistiques (`server/routes/automation-stats.ts:124`), Lumi `get_automation_health` (`server/lib/agent/tools-etendus.ts:1077`), reçus (`server/lib/recu/lecture.ts:69`), trajets (`server/lib/trajets/propositionJournee.ts:136`), le moteur lui-même (anti-doublon `:841`, `:858` ; débit de textos `:693` ; relance de facture `:792` ; « une fois par client » `:1642`). | lecture seule, droit `automations.read` (`supabase/SCHEMA_SNAPSHOT.md:4683-4689`) |
| `automation_evenements_base` | File d'événements écrits par des déclencheurs SQL, dans la même transaction que le changement. Anti-doublon : index unique `(org_id, type, entity_id, cle)`. | Déclencheurs SQL (`supabase/migrations/20261003100000_evenements_automatisations_par_la_base.sql:63-201`). Le serveur coche et compte les tentatives (`server/lib/evenementsBase.ts:107`, `:123`, `:149`). | `server/lib/evenementsBase.ts:132`. | aucun (`...sql:58-60`) |
| `pipeline_events` | File des événements du pipeline de ventes (`deal.stage_entered`, `deal.stage_exited`, `deal.stage_idle`…). | Déclencheur SQL sur `deals` et fonction `pipeline_detecter_stagnation()` (voir section 2) ; le serveur coche (`server/lib/pipelineEvenements.ts:111`, `:129`) ; l'action « Déplacer l'opportunité » y pose l'anti-boucle (`server/lib/actions/index.ts:2524-2533`). | `server/lib/pipelineEvenements.ts:78`. | lecture par tout membre du bureau (`supabase/SCHEMA_SNAPSHOT.md:6534-6540`) |
| `domain_events` | Boîte d'envoi (outbox) du bus : chaque événement émis, `processed_at`, `attempts`, `regles_traitees` (les règles qui ont déjà agi). | `server/lib/eventBus.ts:328`, `:369` ; `server/lib/outbox.ts:66`, `:118`, `:179`, ménage `:199`. | `server/lib/outbox.ts:91`, `server/lib/evenementsBase.ts:162`, `server/lib/lumi/panneau-automatisation.ts:66`. | aucun, d'après sa migration (`supabase/migrations/20260929230000_domain_events_outbox.sql:64-68`) |
| `orgs_envois_simules` | Les bureaux inscrits au bac à sable : leurs envois ne sortent pas. Colonnes `org_id`, `mode`, `raison`. | Aucun code de `server/` ni de `src/` n'y écrit (inscription faite hors de l'application). | `server/lib/bac-a-sable.ts:99`, `server/lib/support/resume-quotidien.ts:132`. | aucun, d'après sa migration (`supabase/migrations/20261005100000_bac_a_sable_envois.sql:32-38`) |
| `envois_simules` | Chaque envoi retenu par le bac à sable : canal, destinataire, sujet, corps. | `server/lib/bac-a-sable.ts:168`. | Aucun écran. | aucun (même migration) |
| `automation_folders` | Dossiers de la liste. | Routes `server/routes/automation-rules.ts:1196`, `:1222`, `:1247`. | `:240`, `:1178`. | lecture `automations.read`, écriture `automations.update` (`supabase/SCHEMA_SNAPSHOT.md:4691-4704`) |
| `automation_webhooks` | Adresses d'appel entrantes : nom, clé `api_key`, `enabled`, `deleted_at`. | Routes `server/routes/automation-rules.ts:1438`, `:1465`, `:1487`, `:1508`, `:1532`. | `:1393`, `:1402`, `:1412` ; réception `server/routes/webhooks-entrants.ts:145`. | lecture `automations.read` ; **politique `automation_webhooks_write` = TOUT (dont DELETE) avec `automations.update`** (`supabase/SCHEMA_SNAPSHOT.md:4734-4740`) |
| `automation_webhook_receipts` | Trace de chaque appel reçu : accepté ou refusé, corps. Supprimée en cascade avec l'adresse (`supabase/SCHEMA_SNAPSHOT.md:8123`). | `server/routes/webhooks-entrants.ts:205`, `:223`. | Aucun `from('automation_webhook_receipts').select` dans `server/` ni `src/`. | lecture `automations.read` |
| `client_tags` | Étiquettes d'un client (`client_id`, `tag`). **Pas de colonne `org_id`.** | Navigateur (voir 6.2), serveur (`server/lib/etiquettes.ts` et actions du moteur). | Navigateur, moteur (`server/lib/etiquettes.ts:65-86`). | lecture, insertion et suppression par tout membre du bureau du client, sans droit `clients.update` (`supabase/SCHEMA_SNAPSHOT.md:4805-4812`) |
| `org_features` | Drapeaux par bureau, dont les cinq drapeaux d'automatisation (section 2). | Hors périmètre (Creator Space, `/api/features`). | `server/lib/automations-drapeaux.ts:64-67`. | — |
| `company_settings` | `default_language` (langue des messages), `automations_paused`, `automations_paused_at`, `automations_paused_by`, `timezone`, réglages d'avis. | Route de pause (`server/routes/automation-rules.ts:1327-1342`), Lumi `set_automation_language` (`server/lib/agent/tools-reglages.ts:1016-1020`), navigateur (voir 6.2). | Moteur (langue `server/lib/automationEngine.ts:632-648`, pause, fuseau). | — |
| `sms_opt_outs`, `email_unsubscribes` | Retraits (STOP, désabonnement courriel). | Texto entrant, page de désabonnement (section 8). | Actions d'envoi (section 3). | — |
| `activity_log` | Le fil d'activité des fiches. Sert aussi d'anti-doublon durable au détecteur de factures en retard, et de compteur au plafond de fréquence des courriels. | Le bus, à chaque événement (`server/lib/eventBus.ts:291-310`) ; l'envoi d'un courriel d'automatisation (`server/lib/actions/index.ts:1512-1518`) ; l'action interne `log_activity`. | `server/lib/scheduler.ts:678-682` ; `server/lib/actions/index.ts:290-300`. | — |
| `agent_actions` | Journal des actions de Lumi. | `executerIdempotent`, panneau de l'éditeur (section 7). | `get_recent_agent_actions`. | — |
| `cron_locks` | Verrou du planificateur et des crons. | Par les fonctions de base `try_advisory_lock` / `release_advisory_lock` (`server/lib/advisory-lock.ts:17`, `:28`, appelées `server/lib/scheduler.ts:960-961`). Le lien entre ces fonctions et la table vient de la migration `supabase/migrations/20260754000000_cron_locks_lease.sql`, non relue. | idem. | non vérifié |
| `reminder_settings`, `reminder_log` | Le système parallèle des relances de paiement. | `server/routes/reminders-cron.ts`, écran Paiements. | idem. | — |

Tables cherchées et ABSENTES de l'arbre : aucune table d'historique des modifications d'une automatisation
(ni `automation_rule_versions`, ni `automation_modifications`), aucune table `workflows` lue par le code (le moteur
dit l'avoir retirée, `server/lib/automationEngine.ts:1512-1520`).

---

## 2. Les déclencheurs

Le catalogue est `DECLENCHEURS` dans `src/lib/automationCatalogue.ts:145-484` (puis `:518-522`, qui ajoute à
presque tous les deux filtres d'étiquette du client). Il compte **28 déclencheurs**. Le commentaire du fichier dit
encore « Les 17 déclencheurs offerts » (`src/lib/automationCatalogue.ts:142`) : il est périmé.

Comment un événement arrive au moteur, selon son producteur :

- **route** : le serveur appelle `eventBus.emit(...)` dans la requête. L'événement est d'abord consigné dans
  `domain_events` (rejouable), puis donné au moteur.
- **base** : un déclencheur SQL écrit dans `automation_evenements_base`, dans la même transaction que le
  changement. Le serveur lit cette file toutes les 15 secondes (`server/lib/evenementsBase.ts:33`, `:202-210`) et
  émet sur le bus (`server/lib/evenementsBase.ts:174`).
- **pipeline** : un déclencheur SQL écrit dans `pipeline_events` ; le planificateur vide cette file à chaque
  passage de 5 minutes (`server/lib/pipelineEvenements.ts:74-101`, appelé `server/lib/scheduler.ts:804`).
- **balayage** : un passage périodique du serveur ou de pg_cron cherche les fiches concernées.
- **navigateur** : le navigateur fait le changement en base, puis prévient le serveur par
  `POST /api/automations/events/...` (`src/lib/automationEventsApi.ts:21-34`). L'appel est « tire et oublie » :
  s'il échoue ou si l'onglet se ferme, l'événement n'existe pas.

« Offert » = proposé dans le tiroir de l'éditeur. Le serveur n'envoie à l'éditeur que les déclencheurs dont le
drapeau est actif pour le bureau (`server/routes/automation-rules.ts:179-185`). Aucun déclencheur ne porte la marque
`bientot` dans cet arbre.

| # | Clé | Libellé à l'écran | Producteur réel (fichier:ligne) | Type | Drapeau | Offert |
|---|---|---|---|---|---|---|
| 1 | `quote.sent` | Devis envoyé | `server/routes/quotes.ts:421` (envoi par courriel), `:575` (envoi par texto) ; action du moteur « Envoyer le devis » `server/lib/actions/index.ts:3213` ; `server/routes/automation-events.ts:409` (route `quote-sent`, **sans appelant** : `emitQuoteSent` de `src/lib/automationEventsApi.ts:70` n'est appelée nulle part) | route | — | oui |
| 2 | `quote.viewed` | Devis ouvert par le client | `server/lib/vuesSoumission.ts:153`, appelé quand la page publique du devis est servie (`server/routes/quotes.ts:773`, route `GET /quotes/public/:token` `:754`) | route publique | — | oui |
| 3 | `quote.approved` | Devis accepté | déclencheur SQL `automation_evenements_devis` sur `quotes` (`supabase/migrations/20261003100000_evenements_automatisations_par_la_base.sql:148-174`) | base | — | oui |
| 4 | `quote.declined` | Devis refusé | même déclencheur SQL (`...sql:158-165`) | base | — | oui |
| 5 | `quote.changes_requested` | Modifications demandées | `server/routes/quotes.ts:1501` (page publique `POST /quotes/public/request-changes`) | route publique | — | oui |
| 6 | `invoice.sent` | Facture envoyée | déclencheur SQL `automation_evenements_facture` sur `invoices`, brouillon → envoyée ou créée déjà envoyée (`...sql:179-201`) ; renvoi d'une facture déjà envoyée `server/routes/emails.ts:512` ; factures récurrentes `server/lib/recurringInvoicesEngine.ts:175` | base + route | — | oui |
| 7 | `invoice.paid` | Facture payée | `server/lib/payments.ts:1026` (paiement réussi et facture soldée) ; `server/routes/invoice-mark-paid.ts:132` (marquée payée à la main) ; `server/routes/payments.ts:374` (dépôt Stripe d'un devis : l'entité émise est un **devis**, pas une facture) | route / webhook de paiement | — | oui |
| 8 | `invoice.overdue` | Facture en retard | `detectOverdueInvoices`, `server/lib/scheduler.ts:616-712` (émission `:701`), appelé à chaque passage (`:812`). N'émet qu'aux jalons de 1, 3, 5, 15 et 30 jours de retard (`server/lib/scheduler-utils.ts:63`), le jour étant compté dans le fuseau du bureau (`server/lib/scheduler.ts:656-663`). Factures `sent` ou `partial` seulement (`:639`). | balayage, 5 min | — | oui |
| 9 | `payment.failed` | Paiement échoué | `server/lib/paiement-echoue.ts:150`, appelé par le webhook Stripe (`traiterPaiementEchoue`, `server/routes/payments.ts:427`). Sans le drapeau, rien n'est émis (`server/lib/paiement-echoue.ts:110`). | webhook Stripe | `auto_paiement_echoue` | si drapeau |
| 10 | `invoice.viewed` | Facture consultée par le client | `server/lib/vuesFacture.ts:85`, appelé par `GET /invoices/public/:token` seulement si le drapeau est actif (`server/routes/invoices-public.ts:186`) | route publique | `auto_consultation_documents` | si drapeau |
| 11 | `appointment.created` | Rendez-vous planifié | déclencheur SQL `automation_evenements_visite` sur `schedule_events`, à l'insertion (`...sql:85-121`). Réémis quand une visite est déplacée : `server/routes/automation-events.ts:185` (route `appointment-rescheduled`, appelée par le navigateur `src/lib/jobsApi.ts:300`, `:304`, `src/lib/scheduleApi.ts:340` et par Lumi `server/lib/agent/tools-etendus.ts:2972`, `:3075`) | base + navigateur | — | oui |
| 12 | `appointment.cancelled` | Rendez-vous annulé | même déclencheur SQL, quand `status` passe à `cancelled` (`...sql:104-111`) ; `supabase/migrations/20261003100010_retirer_de_l_horaire_emet_l_annulation.sql` | base | — | oui |
| 13 | `job.completed` | Job terminé | déclencheur SQL `automation_evenements_job` sur `jobs`, `status` → `completed` (`...sql:124-145`) | base | — | oui |
| 14 | `job.ready_for_invoicing` | Job prêt à facturer | `server/routes/automation-events.ts:277`, dans la route `job-completed`, **seulement si celui qui appelle a le rôle technicien** (`:267`, `:276`). Appelants : navigateur `src/lib/jobsApi.ts:1238`, Lumi `server/lib/agent/tools-etendus.ts:1777`. | navigateur | — | oui |
| 15 | `lead.created` | Nouveau prospect | `server/routes/leads.ts:153` (`POST /leads/create`) ; formulaire public `server/routes/request-forms.ts:940` ; `server/routes/automation-events.ts:460` (route `lead-created`, **sans appelant** : `emitLeadCreated` n'est appelée nulle part) | route | — | oui |
| 16 | `lead.status_changed` | Statut du prospect changé | `server/routes/leads.ts:615` (`POST /leads/update-status`) ; `server/routes/automation-events.ts:496` (route `lead-status-changed`, **sans appelant**) | route | — | oui |
| 17 | `client.replied` | Le client répond | texto entrant `server/routes/messages.ts:637` (webhook Twilio `POST /messages/inbound`, `:215`) ; courriel reçu `server/lib/email/sync/gmail.ts:262` | webhook / synchro | — | oui |
| 18 | `client.tagged` | Étiquette ajoutée | `annoncerEtiquette`, `server/lib/etiquettes.ts:41`, appelé par : la route `client-tagged` (`server/routes/automation-events.ts:545`, prévenue par le navigateur `src/lib/etiquettesApi.ts:13`), l'action du moteur « Ajouter une étiquette » (`server/lib/actions/index.ts:2680`), Lumi (`server/lib/agent/tools-leads.ts:1344`) | navigateur + action + Lumi | — | oui |
| 19 | `client.untagged` | Étiquette retirée | même fonction ; route `client-untagged` ; action « Retirer une étiquette » (`server/lib/actions/index.ts:2707`, `:2715`) ; Lumi (`server/lib/agent/tools-leads.ts:1379`) | navigateur + action + Lumi | — | oui |
| 20 | `client.inactive` | Client inactif | `server/lib/client-inactif.ts:137`, balayage lancé par `server/index.ts:1606-1613`. Ne traite que les bureaux qui ont le drapeau (`server/lib/client-inactif.ts:162`), de 9 h à 19 h dans leur fuseau (`:47-48`), 25 par heure par défaut (`:45`). | balayage, 1 h | `auto_client_inactif` | si drapeau |
| 21 | `agreement.signed` | Contrat signé | `server/routes/agreements.ts:606` (page publique `POST /agreements/public/sign`). L'entité émise est le **job**. | route publique | — | oui |
| 22 | `task.completed` | Tâche terminée | `server/routes/automation-events.ts:628` (route `task-completed`), appelée seulement par le navigateur `src/lib/tasksApi.ts:198`, `:232`. N'émet rien pour une tâche sans client (`:615-619`). | navigateur | — | oui |
| 23 | `note.added` | Note ajoutée | `server/routes/activity-notes.ts:100` (`POST /activity-notes`, le fil d'activité) | route | — | oui |
| 24 | `webhook.received` | Appel reçu de l'extérieur | `server/routes/webhooks-entrants.ts:234` (`POST /api/hooks/:cle`) | route publique | — | oui |
| 25 | `date.reached` | Date atteinte | `server/lib/rappels-dates.ts:260` (champ date d'une opportunité), `:300` (champ date d'un client), par `POST /api/cron/rappels-dates` (`server/routes/cron.ts:94-104`), appelé par pg_cron `lume_rappels_dates` à 12 h 15 UTC (`supabase/migrations/20261004200200_crons_rappels_dates_factures_recurrentes_webhooks.sql:82`) | balayage, 1 fois par jour | — | oui |
| 26 | `deal.stage_entered` | Opportunité entre dans une étape | déclencheur SQL `trg_deals_emettre_evenements` sur `deals` (`supabase/migrations/20260923100100_pipeline_moteur_et_forfait.sql:171`), fonction `deals_emettre_evenements` (dernière version `supabase/migrations/20260925230000_pipelines_facon_ghl.sql:1308`, insertion `:1342-1344`) → `pipeline_events` → `server/lib/pipelineEvenements.ts:101` | pipeline | — | oui |
| 27 | `deal.stage_idle` | Opportunité qui dort | fonction SQL `pipeline_detecter_stagnation()` (`supabase/migrations/20261004200000_deal_sans_mouvement_regle_editeur.sql:18-72`), appelée à chaque passage par `server/lib/pipelineEvenements.ts:163` (depuis `server/lib/scheduler.ts:805`) | pipeline, 5 min | — | oui |
| 28 | `custom_field.changed` | Champ personnalisé modifié | `server/lib/champs/service.ts:487`, quand une valeur change vraiment | route | — | oui |

### Déclencheurs sans producteur

Aucun des 28 n'est sans producteur dans le code. Cinq ne sont produits que par UN chemin, alors que le geste
existe ailleurs dans le produit :

| Déclencheur | Ce qui manque |
|---|---|
| `job.ready_for_invoicing` | Dépend d'un appel du navigateur ou de Lumi, et du rôle technicien de l'appelant. Un job terminé par un propriétaire ou un admin n'émet rien. Aucun rattrapage si l'appel échoue. |
| `task.completed` | Seul le navigateur prévient. Une tâche terminée par Lumi n'émet rien : aucun appel à la route `task-completed` dans `server/lib/agent/`. |
| `note.added` | Seul le fil d'activité (`/activity-notes`) émet. L'onglet Notes des fiches (table `specific_notes`) et l'outil Lumi `add_note` (`server/lib/agent/tools-etendus.ts:3537-3542`) n'émettent rien. |
| `lead.created` | Les prospects créés par le porte-à-porte n'émettent rien : aucun `emit` dans `server/routes/field-sales.ts` (insertion `:316`), `server/lib/fieldPinSync.ts` (`:358`), `server/lib/leadClientSync.ts` (`:74`). |
| `client.tagged` / `client.untagged` depuis une fiche | L'étiquette est écrite par le navigateur directement en base, puis le navigateur prévient le serveur. Si le second appel échoue, l'étiquette est posée et l'automatisation ne part pas. |

### Événements émis que le catalogue n'offre pas

| Événement | Émetteur | Remarque |
|---|---|---|
| `deal.stage_exited` | même fonction SQL que `deal.stage_entered` (`...pipelines_facon_ghl.sql:1326`) | Aucune règle ne peut l'écouter depuis l'éditeur. |
| `estimate.sent` | `server/routes/emails.ts:643` (route `POST /emails/send-quote`) | Aucun fichier de `src/` n'appelle cette route. C'est le déclencheur du préréglage retiré `estimate_followup` (`src/lib/automationCatalogue.ts:115`). |
| `lead.converted`, `job.created` | `server/routes/leads.ts:734`, `:750` | Écoutés par le pipeline porte-à-porte, pas par des règles. |
| `pipeline_deal.stage_changed` | `server/routes/automation-events.ts:371` (route `deal-stage-changed`, appelée par `src/lib/pipelineApi.ts:398`, `:452`) | Ancien pipeline porte-à-porte. |

Types déclarés au bus mais jamais émis par aucun code : `appointment.updated`, `quote.created`, `quote.converted`,
`invoice.created`, `estimate.accepted`, `estimate.rejected`, `lead.updated`, `client.archived`, `client.deleted`
(`server/lib/eventBus.ts:137-180` ; aucun `emit` correspondant dans `server/`).

### Les cinq drapeaux (`server/lib/automations-drapeaux.ts:30-36`)

Un drapeau est une ligne de `org_features` (`feature`, `enabled`). Absent ou éteint = ancien comportement. Lecture
gardée 30 secondes en mémoire (`:40`). Une lecture qui échoue vaut « éteint » (`:75-78`).

| Drapeau | Ce qu'il ouvre | Lu où |
|---|---|---|
| `auto_desabonnement_canal` | Le désabonnement par canal : un message transactionnel part même à un client désabonné, le marketing est sauté. Ouvre aussi le champ « type d'envoi » d'un message (`src/lib/automationCatalogue.ts:740`). | `server/lib/automationEngine.ts:988`, `:2423` ; `server/routes/messages.ts:320` ; `server/routes/unsubscribe.ts:175`, `:241` ; `server/routes/desabonnement.ts:43` |
| `auto_sortie_parcours` | La sortie automatique du parcours avec la case « Arrêter si… » (`settings.arreter_si_resolu`). | `server/lib/automationEngine.ts:2147` |
| `auto_consultation_documents` | Le déclencheur « Facture consultée » et les variables `{{facture.*}}`. | `server/routes/invoices-public.ts:186` ; `server/lib/actions/index.ts:1076` |
| `auto_paiement_echoue` | Le déclencheur « Paiement échoué » et les variables `{{paiement.*}}`. | `server/lib/paiement-echoue.ts:110` ; `server/lib/actions/index.ts:1051` |
| `auto_client_inactif` | Le déclencheur « Client inactif » et le lien de réservation. | `server/lib/client-inactif.ts:162` ; `server/lib/actions/index.ts:128` ; `server/routes/reservation.ts:44`, `:138` |

Un déclencheur sous drapeau est refusé à la création et au changement de déclencheur si le bureau ne l'a pas
(`declencheurOffertA`, `server/lib/automations-drapeaux.ts:91-99` ; appelé `server/routes/automation-rules.ts:259`,
`:469`, `:731`, `server/lib/automations-ecriture.ts:164`).

---

## 3. Conditions, actions et étapes de contrôle

### 3.1 Les conditions

Au déclenchement, le moteur juge une règle dans cet ordre (`server/lib/automationEngine.ts:1465-1494`) :

| # | Quoi | Fonction (fichier:ligne) | Jugé sur | Opérateurs | Si ça ne passe pas |
|---|---|---|---|---|---|
| 1 | La règle vise-t-elle cet événement ? (portée pipeline, règle visée d'un balayage) | `regleViseCetEvenement`, `server/lib/automationEngine.ts:80-99` | les métadonnées de l'événement | égalité | rien, aucune trace |
| 2 | Quelle occurrence (jalon de retard, étiquette posée, étape, champ modifié…) | `separerCiblage` + `evaluateConditions`, `:333-363`, `:221-316` ; clés par déclencheur dans `CLES_DE_CIBLAGE` (`:333-347`) | les métadonnées de l'événement | voir ligne 3 | rien, aucune trace |
| 3 | Les filtres (source, montant…) | `evaluateConditions`, `:221-316` | les métadonnées de l'événement | égalité simple ; `eq`, `neq`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte` (`:214`) ; suffixes de clé `__gt`, `__gte`, `__lt`, `__lte` (`:243`). ET entre les clés. Opérateur inconnu ou comparaison impossible = faux (`:264-270`, `:298-308`). | ligne de journal « Conditions non remplies : … » (`journaliserRegleEcartee`, `:395-423`, code `conditions`) |
| 4 | Les champs personnalisés (`conditions.champs_perso`) | `conditionsChampsOk`, `server/lib/champs/automatisations.ts:40-63` | les valeurs ACTUELLES des champs de la fiche de l'événement | par famille de champ (texte, nombre, liste, date, case) — `src/lib/champs/filtres.ts` | ligne de journal « champs personnalisés » |
| 5 | Les étiquettes du client (`client_a_etiquette`, `client_sans_etiquette`) | `conditionsEtiquettesOk`, `server/lib/etiquettes.ts:66-86` | les étiquettes actuelles du client de la fiche | a / n'a pas, UNE étiquette par clé | ligne de journal « étiquette du client » |
| 6 | « Une fois par client tous les N jours » (`settings.delai_entre_passages_jours`) | `dejaPasseRecemment`, `server/lib/automationEngine.ts:1634-1656` | journaux et tâches de la règle | — | rien en base (journal du serveur seulement, `:1492`) |

Ce que l'éditeur laisse écrire dans une étape « si » : les signes `=`, `!=`, `>`, `>=`, `<`, `<=` et « est l'un
de » / « n'est aucun de » (`src/lib/conditionsEtapeSi.ts:34-40`), plus les conditions de champs personnalisés. La
constante `OPERATEURS_CONDITIONS` du catalogue ne liste que `eq`, `neq`, `in`, `not_in`
(`src/lib/automationCatalogue.ts:1576`) alors que son commentaire dit lister ce que le moteur sait évaluer : elle
est en retard sur le moteur, qui sait aussi `gt`, `gte`, `lt`, `lte`.
Ce que le serveur accepte dans `conditions` : 64 caractères par clé, listes `in` / `not_in` de 50 valeurs au plus,
10 conditions de champs au plus (`server/lib/validation.ts:991-1017`).

Ce qui n'existe pas : un OU entre deux conditions ; deux étiquettes dans la même clé ; un champ du client quand
l'événement porte une facture, un devis, un job ou un rendez-vous (les conditions de champs ne voient que la fiche
de l'événement) ; un « type de client ». Il n'y a aucune clé `ciblage` dans le code.

Ces conditions sont jugées UNE fois, à l'arrivée de l'événement. Elles ne sont pas rejugées avant une action
différée. Seule l'étape « si » d'un parcours relit l'état (3.3).

### 3.2 Les actions

Le catalogue est `ACTIONS` dans `src/lib/automationCatalogue.ts:816-1253` : **21 actions**. Le commentaire du fichier
dit encore « Les 18 actions offertes » (`:800`) : il est périmé. Le moteur en connaît trois de plus, hors
catalogue. Le répartiteur est `aiguillerAction`, `server/lib/actions/index.ts:3253-3323`.

« Fiche » = le type de fiche sur laquelle l'action sait travailler (`entites` du catalogue). Vide = toutes.

| # | Clé | Libellé | Ce que ça fait | Exécuteur (fichier:ligne) | Fiche | Vers le client |
|---|---|---|---|---|---|---|
| 1 | `send_email` | Envoyer un courriel | Courriel au client de la fiche, habillé du gabarit de l'entreprise. Champs : `from_name`, `reply_to`, `subject`, `preheader`, `body`, et leurs versions `_en`. | `executeSendEmail`, `server/lib/actions/index.ts:1307` | toutes | oui |
| 2 | `send_sms` | Envoyer un texto | Texto au client, depuis le numéro du bureau. Écrit aussi dans la boîte Messages. | `executeSendSms`, `:1554` | toutes | oui |
| 3 | `create_notification` | Notifier l'équipe | Notification dans Lume (propriétaire, responsable, équipe du deal, un membre, ou tous), en option par courriel. | `executeCreateNotification`, `:1799` | toutes | non |
| 4 | `request_review` | Demander un avis | Crée un sondage d'avis et l'envoie par courriel et par texto. Les textes viennent des réglages d'avis, pas de l'action. | `executeRequestReview`, `:2063` | toutes | oui |
| 5 | `envoyer_slack` | Envoyer dans Slack | **Rien.** Grisée dans l'éditeur (`indisponible`, `src/lib/automationCatalogue.ts:920`), et le moteur répond toujours un échec « pas encore disponible ». | `executeEnvoyerSlack`, `:2939-2957` | toutes | non |
| 6 | `ajouter_etiquette` | Ajouter une étiquette | Pose une étiquette sur le client, puis émet `client.tagged`. | `executeAjouterEtiquette`, `:2658` | toutes | non |
| 7 | `retirer_etiquette` | Retirer une étiquette | Retire une étiquette ou toutes, puis émet `client.untagged`. | `executeRetirerEtiquette`, `:2687` | toutes | non |
| 8 | `modifier_client` | Modifier le client | Change le statut, la source ou la valeur estimée. | `executeModifierClient`, `:2725` | toutes | non |
| 9 | `assigner_responsable` | Assigner un responsable | Donne le client à un membre (option « seulement si personne »). | `executeAssignerResponsable`, `:2772` | toutes | non |
| 10 | `ajouter_note` | Ajouter une note | Écrit une note sur la fiche. | `executeAjouterNote`, `:2817` | toutes | non |
| 11 | `create_task` | Créer une tâche | Tâche interne (titre, détail, priorité, échéance, membre). | `executeCreateTask`, `:1892` | toutes | non |
| 12 | `modifier_statut_rendezvous` | Changer le statut du rendez-vous | `scheduled`, `completed` ou `cancelled`. | `executeStatutRendezVous`, `:2856` | rendez-vous | non |
| 13 | `move_deal_stage` | Déplacer l'opportunité | Vers une étape précise, ou vers « Soumission envoyée », « Soumission ouverte », « Gagné ». | `executeMoveDealStage`, `:2392` | opportunité, devis | non |
| 14 | `modifier_deal` | Modifier l'opportunité | Change la source. | `executeModifierDeal`, `:2882` | opportunité | non |
| 15 | `assigner_deal` | Assigner l'opportunité | Donne l'opportunité à un membre. | `executeAssignerDeal`, `:2907` | opportunité | non |
| 16 | `envoyer_facture` | Envoyer la facture | Envoie la facture liée par courriel. | `executeEnvoyerFacture`, `:3226` (par `envoyerDocument`, `:3121`) | facture | oui |
| 17 | `envoyer_soumission` | Envoyer le devis | Envoie le devis lié par courriel, puis émet `quote.sent` (`:3213`). | `executeEnvoyerSoumission`, `:3234` | devis | oui |
| 18 | `webhook` | Appeler un webhook | POST des données vers une adresse https externe, avec garde contre les adresses internes. | `executeWebhook`, `:2961-2993` | toutes | non |
| 19 | `demarrer_automatisation` | Démarrer une automatisation | Fait entrer la fiche dans une autre règle publiée, par le même chemin qu'un déclencheur — **sans rejuger les conditions de la règle démarrée** (`demarrerRegle`, `server/lib/automationEngine.ts:1588-1612`). | `executeDemarrerAutomatisation`, `:3049-3108` | toutes | non |
| 20 | `arreter_automatisation` | Arrêter une automatisation | Annule les tâches `pending` de la fiche (cette règle, ou toutes). | `executeArreterAutomatisation`, `:2997-3021` | toutes | non |
| 21 | `update_custom_field` | Mettre à jour un champ personnalisé | Écrit une valeur dans un champ de la fiche de l'événement. | `executerMajChamp`, `server/lib/champs/automatisations.ts:66` | selon le champ | non |
| — | `send_notification` | (hors catalogue) | Alias de `create_notification`. | `:3277-3280` | | |
| — | `update_status` | (hors catalogue) | Écrit un statut dans une table permise. | `executeUpdateStatus`, `:2030` | | |
| — | `log_activity` | (hors catalogue) | Note interne dans `activity_log`. Présente dans des préréglages ; gardée à la conversion, jamais proposée. | `executeLogActivity`, `:2316` | | |

Plafonds de saisie : 5 actions par règle à plat (`ACTIONS_MAX`, `src/lib/automationCatalogue.ts:1564`), 20 actions dans
la colonne `actions` (`server/lib/validation.ts:1218`), **30 étapes par parcours** (`ETAPES_MAX`,
`server/lib/validation.ts:1120`). Le moteur, lui, laisse franchir 50 étapes (`ETAPES_MAX_PAR_PARCOURS`,
`server/lib/automationSequences.ts:123`).

#### Les gardes d'un envoi

Dans l'ordre où le code les applique. « Sauté » = l'action est écrite au journal comme réussie avec
`result_data.saute` ; le parcours continue. « Échec » = `result_success = false` ; un échec passager est repris.

| Garde | Courriel | Texto | Résultat | Code |
|---|---|---|---|---|
| Client marqué « aucune demande d'avis » (champ `noreview`), pour les préréglages d'avis et l'action « Demander un avis » | `server/lib/actions/index.ts:3262-3271`, `:2115` | idem | sauté | `client_sans_avis` |
| Pas d'adresse / pas de numéro | `:1321` | `:1573` | sauté | `sans_courriel`, `sans_telephone` |
| Envoi de textos non configuré, ou forfait sans textos | — | `:1568`, `:1629-1634` | sauté | `sms_non_configure` |
| Adresse qui a rebondi ou porté plainte | `:1340-1342` | — | sauté | `adresse_injoignable` |
| Désabonnement (`email_unsubscribes`) / STOP (`sms_opt_outs`) | `:1362-1370` | `:1577-1590` | sauté ; avec le drapeau « par canal », seul le marketing est sauté | `desabonne` |
| Identité de l'entreprise manquante (nom, adresse postale) pour un envoi commercial | `:1380-1383` | — | sauté | `identite_manquante` |
| Consentement (exprès ou relation d'affaires) | `:1388-1394` | `:1594-1599` | sauté ; lecture ratée = échec repris | `sans_consentement` ou `desabonne` |
| Plafond de fréquence : 3 messages commerciaux par destinataire sur 24 h (`AUTOMATION_MAX_COMMERCIAL_PER_DAY`, `:260-263`) | `:1400-1402` | `:1604-1606` | **échec**, texte anglais « Frequency cap reached for <adresse ou numéro> », non repris (`server/lib/automationEngine.ts:1724`) | aucun code |
| Mention « STOP » et nom de l'entreprise ajoutés à un texto commercial | — | `:1616-1618` | — | — |
| Lien de désabonnement et en-têtes `List-Unsubscribe` sur un courriel commercial | `:1414`, `:1439-1443`, `:1496-1503` | — | — | — |
| Gel des communications pendant une migration | — | `:1637-1642` | échec | aucun |
| Déjà envoyé depuis une tentative précédente (reprise, rejeu) | `:1477-1479` | `:1643-1645` | sauté | `deja_envoye` |
| Bac à sable : bureau inscrit dans `orgs_envois_simules` | `server/lib/mailer.ts:3` | `server/lib/config.ts:5` (client Twilio enveloppé) | l'envoi est écrit dans `envois_simules` au lieu de partir | — |

Gardes du moteur, avant d'appeler l'action :

| Garde | Où | Résultat |
|---|---|---|
| Arrêt global `AUTOMATIONS_ENABLED` | `server/lib/automations-interrupteur.ts:41-53`, lu `server/lib/automationEngine.ts:1401`, `:1943` | l'événement est ignoré ; la file n'est pas touchée |
| Pause du bureau (« Tout arrêter ») | `server/lib/automations-pause-org.ts:57`, lu `:1409`, `:1966-1967`, `:1988` | l'événement est ignoré ; les tâches restent en attente |
| Anti-boucle : la règle est déjà dans la chaîne de l'événement (5 au plus, `server/lib/etiquettes.ts:20`, `:89-92`) | `:1459-1462` | ignoré |
| Fenêtre d'envoi : 8 h à 20 h par défaut, fuseau du bureau ; `settings.fenetre` (bornes 7 h à 22 h, `server/lib/validation.ts:1142-1143`) et `settings.jours_ouvrables` | action immédiate `:1005-1030` ; file `:2050-2091` | reporté au prochain créneau (pas de 30 min, `:602-616`). **Une règle à plat sans délai ne reporte que ses textos et demandes d'avis, pas ses courriels** (`:567-580`). |
| Rafale : plus de 30 textos d'automatisation dans la dernière minute pour le bureau (`:689-704`) | `:1032-1052`, `:2345-2351` | reporté d'une minute ; notification « Rafale de textos » une fois par 6 h (`:720-757`) |
| Une seule relance par facture et par jour, toutes règles de relance confondues (20 h) | `:770-809`, appliqué `:1054-1063`, `:2353-2365` | sauté, code `deja_envoye` |
| Doublon d'une action immédiate dans les 2 minutes | `reserverActionImmediate`, `:818-897` (index unique `idx_execution_logs_immediat_dedup`) | ignoré, aucune ligne |
| Doublon d'une tâche déjà en file (même `execution_key`) | `:1373-1380`, `server/lib/automationSequences.ts:466-469` | ignoré, aucune ligne |
| Délai maximal d'une action : 5 secondes (`:1677`) | `:1074-1113`, `:2430-2476` | écrit « en attente », complété quand l'action répond ; reprise posée |
| Reprise d'un échec passager : 5 min, 30 min, 2 h, 4 essais au plus (`:1661`, `:1854-1876`) ; échec définitif = notification à l'entreprise (`:1815-1852`) | `:1123-1137`, `:2509-2548` | — |

Il n'existe PAS dans cet arbre : de garde « même message d'une autre automatisation » (doublon entre deux règles),
de ciblage rejugé avant un envoi différé.

#### Les codes de résultat

Le moteur écrit aujourd'hui ces codes dans `result_data.saute_code` (type `CodeSaut`,
`server/lib/actions/index.ts:151-162`, plus `conditions` écrit par le moteur) :

| Code | Écrit où |
|---|---|
| `sms_non_configure` | `server/lib/actions/index.ts:1568`, `:1629-1634` |
| `sans_telephone` | `:1573` |
| `sans_courriel` | `:1321` |
| `adresse_injoignable` | `:1341` |
| `desabonne` (code par défaut de `saute()`, `:165`) | `:1366`, `:1368`, `:1390`, `:1393`, `:1588`, `:1589`, `:1686`, `:2296` |
| `sans_consentement` | `:1393`, `:1598` |
| `identite_manquante` | `:1382` |
| `deja_envoye` | `:1479`, `:1645` ; `server/lib/automationEngine.ts:1058`, `:2360` |
| `date_absente` | `server/lib/automationEngine.ts:1336` |
| `boucle` | `:3069`, `:3072` |
| `client_sans_avis` | `:2115`, `:3265` |
| `conditions` | `server/lib/automationEngine.ts:413` |

Le catalogue des issues `src/lib/automationMotifs.ts` déclare 29 codes en 8 groupes (doublon, désabonné, hors
ciblage, donnée manquante, condition plus valide, hors heures, limite d'envois, autre). **Dans cet arbre, aucun
fichier ne l'importe** : ni `src/`, ni `server/`, ni `tests/`, ni `scripts/`, ni `e2e/`. Il est seulement copié dans
l'image du serveur (`Dockerfile:68`). Dix-sept de ses codes ne sont écrits par aucun code : `doublon`,
`une_fois_par_client`, `hors_ciblage`, `avis_desactives`, `sans_lien_avis`, `sans_cible`, `condition_plus_valide`,
`entite_supprimee`, `fiche_fusionnee`, `client_a_repondu`, `etape_retiree`, `regle_inactive`, `rappel_perime`,
`hors_heures`, `plafond_frequence`, `rafale`, `pause_bureau`. Le champ `action_config.motif_code` qu'il annonce
(`src/lib/automationMotifs.ts:14`) n'est écrit nulle part.

Les écrans traduisent donc encore à leur façon (`src/lib/automationJournauxApi.ts`) : `motifSaut` (`:293`) rend la
phrase française du moteur telle quelle, `raisonLisible` (`:319`) et `raisonEchecListe` (`:372`) reconnaissent des
motifs par morceaux de texte.

Résultats écrits comme des RÉUSSITES alors que rien n'a été fait : `{ aucun_deal }`, `{ pas_d_etape_cible }`,
`{ deja_ailleurs }`, `{ deja_dans_l_etape }` (`server/lib/actions/index.ts:2420-2482`),
`{ ignore: 'un responsable était déjà assigné' }` (`:2805`).

Résultats écrits comme des ÉCHECS alors que c'est un état normal : demandes d'avis désactivées (`:2076`), aucun
lien d'avis (`:2079`), avis déjà demandé dans les 7 jours (`:2149`), plafond de fréquence (`:1401`, `:1605`, `:2220`).

### 3.3 Les étapes de contrôle d'un parcours

| Étape | Ce qu'elle fait | Où (fichier:ligne) |
|---|---|---|
| `attendre`, mode durée (défaut) | Pas de tâche à elle : son délai s'ajoute à l'étape suivante. | `server/lib/automationSequences.ts:359-368` |
| `attendre`, mode `reponse` | Une tâche-échéance. À l'échéance : le client a répondu → `si_reponse` (ou fin) ; sinon → `suivant`. Une réponse du client avant l'échéance la réveille. | `server/lib/automationSequences.ts:411-413` ; `server/lib/automationEngine.ts:2282-2318` ; réveil `:1413-1415`, `:2765` |
| `attendre`, mode `avant_date` | Calée sur le début du rendez-vous. La date est relue à l'échéance : annulé → fin ; déplacé → replanifié ; moment passé → `si_depasse`. | `server/lib/automationSequences.ts:386-402`, `:504-559` ; `server/lib/automationEngine.ts:2331-2339` |
| `si` | Une branche choisie sur l'état RELU de la fiche (mêmes opérateurs que 3.1, plus champs et étiquettes). | `server/lib/automationEngine.ts:2219-2267` ; relecture `metadonneesFraiches`, `:2603` |
| `arreter` | Fin du parcours. | `server/lib/automationSequences.ts:370` |
| `action` | Une des actions de 3.2. Seulement sur succès, l'étape suivante est planifiée. | `server/lib/automationEngine.ts:2520-2538` |

Autres règles de contrôle :

| Sujet | Règle | Où |
|---|---|---|
| Rien n'est planifié d'avance | Seule la première étape exécutable est mise en file ; chaque étape faite ouvre la suivante. | `server/lib/automationEngine.ts:1536-1567` ; `server/lib/automationSequences.ts:341-490` |
| Première étape d'un parcours | Elle passe par la file : elle part au passage suivant du planificateur, pas dans la seconde. Une règle à plat sans délai, elle, part tout de suite. | `server/lib/automationEngine.ts:1548`, `:1579` |
| Ré-entrée | Sans réglage : un seul passage tant qu'une tâche de la même clé attend. `settings.reentree` : chaque passage a ses clés. | `server/lib/automationEngine.ts:433-459`, `:1557-1559` ; `server/lib/automationSequences.ts:185-188` |
| Sortie avant chaque tâche | Règle en brouillon ou à la corbeille (`:2002-2015`) ; étape retirée du parcours (`:2023-2033`) ; client supprimé (`:2133-2140`) ; conditions d'arrêt (`checkStopConditions`, `:2870`, ou `verdictSortie` avec le drapeau, `server/lib/sortie-parcours.ts:119`) ; « arrêter quand le client répond » (`:2186-2191`). La tâche passe `cancelled`, le motif est dans `last_error`. **Aucune ligne n'est écrite dans `automation_execution_logs`.** | `server/lib/automationEngine.ts` |
| Rappel « X avant » périmé | Créneau dépassé de plus de 30 min : abandonné (`:1291-1298`). Report hors heures qui tomberait après le rendez-vous : annulé (`:2064-2081`). | idem |
| Modifier une règle publiée | Une tâche déjà en file garde la COPIE de son action (texte compris) prise à la mise en file (`server/lib/automationSequences.ts:425-426`, `server/lib/automationEngine.ts:1368`) et l'exécute telle quelle (`:2121-2123`) : le texte modifié ne vaut que pour les tâches mises en file après. Comme une attente est fusionnée avec l'action qui la suit, le message d'après une attente de 3 jours est copié 3 jours avant de partir. L'échéance déjà fixée ne bouge pas. Une étape retirée annule la tâche (`:2023-2033`). Une condition « si » et la suite du parcours, elles, sont lues dans la version courante (`:2219-2258`). Les deux versions peuvent donc se mélanger pour un même client. | `server/lib/automationEngine.ts`, `server/lib/automationSequences.ts` |
| Plusieurs déclencheurs sur une règle | Impossible : `trigger_event` est un seul texte. | `supabase/SCHEMA_SNAPSHOT.md:559` |
| Objectifs (« goals ») | N'existent pas. | — |

---

## 4. Le chemin d'exécution, de bout en bout

Tout le moteur tourne DANS le processus Express. Il n'y a pas de worker séparé. Les seuls planificateurs
extérieurs sont des tâches pg_cron de la base, qui appellent des routes `/api/cron/*`.

1. **L'événement naît** chez un des producteurs de la section 2.
2. **Le bus** (`eventBus.emit`, `server/lib/eventBus.ts:213-246`) écrit `activity_log` et consigne l'événement dans
   `domain_events` (`:325-349`), puis appelle les écouteurs sans les attendre. Les événements `deal.*` ne sont pas
   consignés (ils ont déjà leur file, `:187-191`). `invoice.overdue` passe d'abord par `activity_log` : un doublon y
   est refusé et l'événement n'est pas diffusé (`:201`, `:218-220`).
3. **Le moteur** est abonné à tous les types (`initAutomationEngine`, `server/lib/automationEngine.ts:3008-3018`,
   démarré `server/index.ts:1419`). `handleEvent` (`:1396-1526`) lit les règles publiées du bureau pour ce
   déclencheur, dans l'ordre de création, juge les conditions (3.1), puis appelle `lancerRegle` (`:1536-1581`).
4. **`lancerRegle`** : parcours → première étape en file ; règle à plat avec délai → une tâche par action
   (`scheduleDelayedActions`, `:1346-1382`) ; règle à plat sans délai → actions tout de suite
   (`executeRuleActions`, `:958-1140`).
5. **La file** `automation_scheduled_tasks` est dépilée par `processScheduledTasks` (`:1938-2565`) : tâches
   `pending` échues, par lots de 50 (`:1932`), prise atomique (`:2096-2118`), puis sorties, fenêtre d'envoi, étape de
   contrôle ou action, journal, étape suivante.
6. **Le journal** : une ligne `automation_execution_logs` par action (`:1116`, `:2489`).
7. **La ligne de l'outbox est cochée** quand tous les écouteurs ont fini (`server/lib/eventBus.ts:360-385`). Chaque
   règle qui a agi est notée dans `regles_traitees` (`server/lib/outbox.ts:170`) pour ne pas être rejouée.

### Qui fait tourner quoi, et à quelle cadence

| Mécanisme | Où | Cadence | Verrou | Ce qu'il fait |
|---|---|---|---|---|
| Bus → moteur | `server/lib/eventBus.ts:213`, `server/lib/automationEngine.ts:3015` | temps réel | — | règles immédiates, mise en file |
| File « événements de la base » | `demarrerEvenementsBase`, `server/lib/evenementsBase.ts:202-210` ; démarrée `server/lib/scheduler.ts:928` | 15 s | prise par ligne (`attempts`), 5 essais (`:31`), lots de 100 | lit `automation_evenements_base`, émet sur le bus |
| Passage du planificateur (« tick ») | `startScheduler`, `server/lib/scheduler.ts:902-934` ; `tickProtege`, `:953-970` | au démarrage, puis toutes les 5 min (`:16`) | garde locale + verrou `automation-scheduler` (`:960-961`) | voir la liste ci-dessous |
| Clients inactifs | `server/index.ts:1606-1613` | 45 s après le démarrage, puis 1 h | `clients-inactifs`, avec suivi `withCronCheckIn` | balayage de la section 2, n° 20 |
| Jobs récurrents | `startRecurringJobScheduler`, `server/index.ts:1417` | (hors périmètre : crée des visites, le déclencheur SQL fait le reste) | | |
| pg_cron `lume_rappels_dates` → `POST /api/cron/rappels-dates` | `supabase/migrations/20261004200200_crons_rappels_dates_factures_recurrentes_webhooks.sql:82` ; route `server/routes/cron.ts:94-104` | 1 fois par jour, 12 h 15 UTC | **aucun** | « Date atteinte » |
| pg_cron `lume_payment_reminders` → `POST /api/cron/payment-reminders` | `supabase/migrations/20260925180000_cron_relances_factures.sql:86-90` ; route `server/routes/reminders-cron.ts:648` | 1 fois par jour, 13 h UTC | `cron-payment-reminders` (`:665`) | relances de paiement (système parallèle) |
| pg_cron `lume_recurring_invoices` → `POST /api/cron/recurring-invoices` | `...20261004200200...sql:83` ; `server/routes/cron.ts:69-84` | 1 fois par jour, 11 h 45 UTC | `cron-recurring-invoices` | factures récurrentes (émettent `invoice.sent`) |
| pg_cron `lume_webhook_retries` → `POST /api/cron/webhook-retries` | `...20261004200200...sql:84` ; `server/routes/cron.ts:106-117` | toutes les 10 min | `cron-webhook-retries` | webhooks SORTANTS de la plateforme (hors automatisations) |
| pg_cron `lume_retention_logs` | `supabase/migrations/20260910160000_scale_retention_logs.sql:76` | 1 fois par jour, 4 h 20 UTC | — | purge : `automation_execution_logs` à 90 jours, `activity_log` à 180 jours, notifications lues à 90 jours (`...sql:28-31`, `:59`) |

Les routes `/api/cron/*` exigent l'en-tête `x-cron-secret` égal à `CRON_SECRET` (`server/routes/cron.ts:24-49`).

Contenu d'un passage du planificateur, dans l'ordre (`server/lib/scheduler.ts:769-892`) :

| Ordre | Étape | Ligne |
|---|---|---|
| 1 | Ancien clonage de factures `invoices.is_recurring` (`handleRecurringInvoices`) | `:772` |
| 2 | La file planifiée : lots de 50, 20 lots et 3 minutes au plus (`viderFile`, `:26-39`) | `:782` |
| 3 | Rejeu des événements orphelins de l'outbox, puis ménage | `:790-792` |
| 4 | File du pipeline, puis détection des opportunités qui dorment | `:803-805` |
| 5 | Factures en retard | `:812` |
| 6 | Devis expirés | `:819` |
| 7 | Ménage des fichiers de champs (1 fois par jour) | `:828-832` |
| 8 | Archivage des devis expirés ou refusés depuis 30 jours | `:838-848` |
| 9 | Ancienne table `automations` | `:850-888` |

`LUME_TACHES_DE_FOND=off` coupe le planificateur et les crons du processus, mais pas le moteur d'événements
(`server/index.ts:1402-1409`).

### Les rattrapages

| Cas | Ce qui se passe | Où |
|---|---|---|
| Événement consigné mais écouteurs pas finis (redémarrage) | Rejoué au passage suivant après 3 min, 3 fois au plus, pendant 24 h. Ménage des lignes de plus de 14 jours. | `server/lib/outbox.ts:36-47`, `:85-158`, `:195` |
| Lecture des règles ratée | L'événement n'est pas coché : il sera rejoué. | `server/lib/automationEngine.ts:1438-1442` ; `server/lib/eventBus.ts:366-374` |
| Tâche restée `running` (processus mort dessus) | Remise en file après 15 min. | `server/lib/automationEngine.ts:1884-1923` |
| Événement de la base non traité | 5 essais ; l'outbox est consultée avant de réémettre. | `server/lib/evenementsBase.ts:147-166` |
| Événement du pipeline non traité | 4 essais, lots de 200, délai de grâce de 3 s. | `server/lib/pipelineEvenements.ts:36-60` |
| Jalon « Facture en retard » d'un jour sans passage | Perdu : l'émission exige l'égalité avec un jalon (`server/lib/scheduler.ts:667`). | — |
| « Date atteinte » d'un jour où le cron n'a pas tourné | Non rattrapé : le balayage ne lit que les valeurs égales au jour visé (`value_date = jourVise`), 500 par règle au plus. | `server/lib/rappels-dates.ts:213-230` |
| Appel du navigateur perdu (`task-completed`, `job-completed`, étiquettes, visite déplacée) | Aucun rattrapage. | `src/lib/automationEventsApi.ts:21-34` |

---

## 5. Les routes d'API et les écrans

### 5.1 Les routes d'API

Gardes communes, dans l'ordre : limiteurs de débit (`/api/automations/events`, `server/index.ts:719` ;
`/api/automations/rules` : lecture, écriture 120 par minute, génération 30 par minute, `server/index.ts:683-689`,
`:721`) ; table des droits `rbacMiddleware` (`server/index.ts:832`, `server/lib/route-permissions.ts:518-576`) ;
abonnement (`server/index.ts:836`) ; forfait `includes_automations` sur tout `/api/automations/` et
`/api/reminders/` (`server/lib/feature-guard.ts:67-68`, `server/index.ts:841`).

Une route absente de la table des droits passe sans contrôle de droit (`server/lib/route-permissions.ts:546-547`) :
c'est alors au gestionnaire de vérifier. **Toutes les routes `/api/automations/*` de cet arbre ont une entrée dans
la table.** « Droit » ci-dessous = la clé de `server/lib/route-permissions.ts` (ligne entre parenthèses).

« Client » = avec quel accès la route lit et écrit : S = session de l'utilisateur (RLS), R = rôle de service.

| Méthode | Chemin | Fichier:ligne | Droit | Client | Ce qu'elle fait |
|---|---|---|---|---|---|
| GET | `/api/automations/rules` | `server/routes/automation-rules.ts:145` | `automations.read` (139) | S | Règles du bureau (corbeille comprise, purgées exclues) + catalogue offert. |
| GET | `/api/automations/editeur?rule_id=` | `:196` | `automations.read` (143) | S | Une règle, le catalogue, la liste légère des autres règles publiées. |
| POST | `/api/automations/rules` | `:244` | `automations.update` (148) | S, puis R pour publier | Crée en brouillon ; si `is_active: true` est demandé, contrôles de publication puis activation par le rôle de service (`:307-322`). |
| POST | `/api/automations/rules/generer` | `:372` | `automations.update` (162) | S ; R pour le budget, le journal et le rythme | Panneau « Construire avec Lumi » (section 7). |
| PATCH | `/api/automations/rules/:id` | `:608` | `automations.update` (149) | S, puis R pour publier | Modifie. Garde de version `version_lue` → 409 `modifiee_ailleurs` (`:660-664`, `:784`). Refus : corbeille 409, règle fournie dont on change le déclencheur 400, parcours publié vidé 422, publiée cassée 422. Propage aux copies liées (`:829-835`). |
| PATCH | `/api/automations/rules/:id/messages` | `server/routes/automation-messages.ts:108` | `automations.update` (151) ; revérifié dans la route (`:116-118`) | S | Écrit UN message (texte, objet, autre langue) et le reflet `actions`. |
| DELETE | `/api/automations/rules/:id` | `server/routes/automation-rules.ts:1006` | `automations.update` (152) | R pour annuler les tâches (`:1049-1055`), S pour la corbeille | Corbeille. Refuse une règle fournie (400). |
| POST | `/api/automations/rules/:id/duplicate` | `:945` | `automations.update` (153) | S | Copie en brouillon. |
| POST | `/api/automations/rules/:id/restaurer` | `:1102` | `automations.update` (175) | S | Sort de la corbeille, en brouillon. |
| DELETE | `/api/automations/rules/:id/definitivement` | `:1139` | `automations.update` (177) | S | Pose `purged_at` (la ligne reste). |
| POST | `/api/automations/rules/:id/copier-bureaux` | `:1278` | `automations.update` (156) | session bornée à chaque bureau cible ; R pour lire les copies | Copie vers d'autres bureaux, liée ou non. |
| GET | `/api/automations/bureaux-cibles` | `:1267` | **`automations.update`** (160) | — | Bureaux où l'on peut copier. |
| POST | `/api/automations/rules/:id/publication` | `server/routes/automation-publication.ts:42` | `automations.update` (158) | S pour la preuve de droit et la dépublication, R pour publier (`server/lib/automations-publication.ts:196-220`) | Publier / dépublier une règle. |
| POST | `/api/automations/rules/publication` | `server/routes/automation-publication.ts:24` | `automations.update` (159) | idem | Publier / dépublier en lot. |
| GET | `/api/automations/rules/stats[?rule_id=]` | `server/routes/automation-stats.ts:208` | `automations.read` (141) | S | Chiffres par règle et par étape, fenêtre fixe de 60 jours (`:35`). |
| POST | `/api/automations/rules/:id/apercu` | `server/routes/automation-test.ts:324` | `automations.read` (147) | S | « Ce qui partirait, et à qui », sur un vrai client. N'envoie rien. |
| GET | `/api/automations/test` | `server/routes/automation-test.ts:38` | `automations.read` (135) + propriétaire ou admin (`:42-43`) | R | Diagnostic des préréglages. Aucun appelant dans `src/`. |
| GET | `/api/automations/templates` | `server/routes/automation-rules.ts:847` | `automations.read` (154) | — | La bibliothèque de modèles (constante du serveur). |
| POST | `/api/automations/templates/utiliser` | `:863` | `automations.update` (155) | S | Copie un modèle en brouillon. Idempotence par en-tête, 10 minutes (`:860-861`). |
| GET / POST / PATCH / DELETE | `/api/automations/folders[/:id]` | `:1173`, `:1191`, `:1217`, `:1239` | lecture `automations.read` (178) ; écriture `automations.update` (179-181) | S | Dossiers. |
| GET | `/api/automations/pause` | `:1301` | `automations.read` (188) | S | État de la pause du bureau. |
| POST | `/api/automations/pause` | `:1321` | `automations.update` (189) ; en base, seul un admin peut écrire `company_settings` (0 ligne → 403, `:1351-1357`) | S | « Tout arrêter » / reprendre. Vide le cache du moteur (`:1361`). |
| GET / POST / PATCH / DELETE | `/api/automations/webhooks[/:id]`, `POST …/:id/regenerer` | `:1406`, `:1427`, `:1498`, `:1525`, `:1455` | lecture `automations.read` (182) ; écriture `automations.update` (183-186) | S ; R pour lire ou écrire la clé (`:1393`, `:1402`, `:1486`) | Adresses d'appel entrantes. La clé complète ne sort qu'à la création et à la régénération. |
| GET | `/api/automations/clients-inactifs/apercu?mois=` | `server/routes/reservation.ts:133` | `automations.read` (145) | — | « X clients correspondent aujourd'hui » (déclencheur « Client inactif »). |
| POST | `/api/automations/events/appointment-rescheduled` | `server/routes/automation-events.ts:93` | `jobs.update` ou `calendar.update` (194) | R | Annule les rappels à l'ancienne date, réémet `appointment.created`. |
| POST | `/api/automations/events/job-completed` | `:227` | `jobs.complete` (165) | R | Émet `job.ready_for_invoicing` si l'appelant est technicien. |
| POST | `/api/automations/events/task-completed` | `:560` | `jobs.update`, `clients.update` ou `leads.update` (204) | R | Émet `task.completed`. |
| POST | `/api/automations/events/client-tagged`, `…/client-untagged` | `:553`, `:554` | `clients.update` ou `leads.update` (200, 201) | R | Vérifie l'état réel de l'étiquette, puis émet. |
| POST | `/api/automations/events/deal-stage-changed` | `:336` | **`automations.update`** (166) | R | Émet `pipeline_deal.stage_changed` (ancien pipeline). |
| POST | `/api/automations/events/quote-sent`, `…/lead-created`, `…/lead-status-changed` | `:398`, `:442`, `:480` | **`automations.update`** (167, 170, 171) | R | Émettent. Aucun appelant dans `src/` ni `server/`. |
| POST | `/api/automations/events/appointment-created`, `…/appointment-cancelled`, `…/quote-approved`, `…/invoice-paid` | `:64`, `:74`, `:423`, `:433` | `automations.update` (163, 164, 168) ; `financial.view_invoices` (169) | — | **Ne font plus rien** : répondent `{ ok: true, via: 'base' }`. Gardées pour les onglets restés sur une ancienne version. Encore appelées par Lumi avec la session de l'utilisateur (`server/lib/agent/tools-etendus.ts:3135`, `:4011` ; `server/lib/agent/tools-terrain.ts:527`, `:578`) : pour un membre sans `automations.update`, la table des droits répond 403 et l'outil rend l'avertissement « automatisations non déclenchées » (`server/lib/agent/tools-etendus.ts:2211-2219`), alors que l'événement naît du déclencheur SQL. |

Routes hors `/api/automations` qui touchent aux automatisations : voir sections 7 (Lumi) et 8 (points d'entrée
externes).

Ce que les routes d'écriture ne font PAS dans cet arbre : aucune n'écrit dans un historique des modifications
(il n'y a pas de table). La seule trace d'une modification est `updated_at`.

### 5.2 Les écrans

Routes React (`src/App.tsx`) :

| Route | Composant | Droit de la route | Fichier:ligne |
|---|---|---|---|
| `/automations` | `Automations` (liste, onglets Toutes / À vérifier / Prêtes à publier / Corbeille, `src/pages/Automations.tsx:1281-1286` ; bibliothèque de modèles ; éditeurs de texto et de courriel) | `automations.read` | `src/App.tsx:1668` |
| `/automations/apercu` | `AutomationsApercu` (Vue d'ensemble) | `automations.read` | `src/App.tsx:1677` |
| `/automations/reglages` | `AutomationsReglages` (réglages globaux : langue, pause, adresses d'appel) | `automations.update` | `src/App.tsx:1678` |
| `/automations/:id` et `/automations/nouvelle` | `AutomationBuilderPage` (éditeur plein écran : onglets Parcours, Réglages, Historique, Journaux) | `automations.update` | `src/App.tsx:1682` |
| `/automations/hub`, `/automations/builder` | redirection vers `/automations` | — | `src/App.tsx:1683-1684` |

Toutes sont derrière le forfait `includes_automations` (`PlanFeatureGate`). L'entrée de menu demande
`automations.read` (`src/App.tsx:1159`). La page de la liste enveloppe pourtant tout son contenu dans le droit
`automations.update` (`src/pages/Automations.tsx:1297`) : un membre qui n'a que la lecture voit le menu, ouvre la
route, et lit « Accès restreint ». La Vue d'ensemble, elle, demande la lecture (`src/pages/AutomationsApercu.tsx:84`).

Composants (dossier `src/components/automations/`) : `SousNavigation`, `BandeauPause`, `BibliothequeModeles`,
`MessageEditor`, `EmailPreviewEditor`, `AutreVersionMessage`, `InterrupteurPublication`, `CopierVersBureauxModal`,
`AdressesDAppel`, `SequenceCanvas`, `TiroirChoix`, `PanneauDeclencheur`, `PanneauEtape`, `ChampAction`,
`OngletReglages`, `OngletJournaux`, `ClavardageLumi`. `AutomationBuilder.tsx` (874 lignes) n'est importé par
aucun fichier de `src/` : c'est du code mort (seul un test en lit le texte, `tests/champs-variables-ghl.test.ts:92`).

Écrans hors de la section qui modifient ou montrent des automatisations : Réglages › Messagerie
(`src/pages/SettingsMessaging.tsx`), Réglages › Avis clients (`src/pages/SettingsReviews.tsx`), le clavardage
Lumi (`src/pages/Lumi.tsx`). Les autres points d'entrée (barre latérale, palette, recherche, Réglages, pipeline,
fiche client, aide, cloche) sont les 28 lignes EXT-001 à EXT-028 de `AUTOMATIONS_UI_MAP.md` (partie 3, § 2).

#### La liste des éléments interactifs

La liste exhaustive, élément par élément et état par état, est `AUTOMATIONS_UI_MAP.md` : 377 éléments en
7 familles (LST 103, MOD 29, MSG 37, APR 4, REG 10, EDT 166, EXT 28), plus le catalogue de l'éditeur. **Elle n'est
pas recopiée ici.**

Ce qui a été vérifié, et comment : cette carte de l'interface a été dressée sur le commit `c402ad57`
(`AUTOMATIONS_UI_MAP.md:602`, `:1388`). J'ai comparé le code des écrans entre ce commit et la tête de l'arbre
(`git diff c402ad57..HEAD`, 21 fichiers, 3 674 lignes ajoutées, 607 retirées) et relevé chaque ligne ajoutée ou
retirée qui porte un bouton, un champ, un lien, un gestionnaire de clic ou une confirmation. Je n'ai PAS revérifié
un par un les 377 éléments restés en place, et rien n'a été joué au navigateur. Les numéros de ligne cités dans
`AUTOMATIONS_UI_MAP.md` ne sont plus justes pour les fichiers modifiés.

Éléments AJOUTÉS depuis la carte de l'interface (absents de `AUTOMATIONS_UI_MAP.md`, à ajouter à la checklist) :

| Écran | Élément | Ce qu'il fait | Fichier:ligne |
|---|---|---|---|
| Éditeur, tous onglets | Bandeau « Vos automatisations sont en pause. » | Information (la pause du bureau), sans bouton. | `src/pages/AutomationBuilderPage.tsx:2720-2738` |
| Éditeur, tous onglets | Bandeau « Cette automatisation a été modifiée ailleurs… » + bouton **Recharger** | Recharge la version en base ; rien n'est enregistré avant. | `:2742-2763` |
| Éditeur, tous onglets | Bandeau « Enregistrement refusé… » + bouton **Ouvrir l'étape** | Ouvre l'étape que le serveur désigne. | `:2768-2787` |
| Éditeur | Confirmation « Arrêter ici et retirer la suite ? » (bouton « Arrêter ici ») | Avant d'insérer « Arrêter ici » au milieu d'un parcours. | `:703-712` |
| Éditeur, panneau Lumi | Confirmation « Appliquer les changements de Lumi ? » (bouton « Appliquer ») | Sur une automatisation publiée, la proposition de Lumi n'entre dans le parcours qu'après un oui. | `:925-937` |
| Éditeur | Une étape choisie dans le tiroir n'entre dans le parcours qu'à « Enregistrer » de son panneau ; confirmation « Fermer sans ajouter cette étape ? » | Changement de comportement d'un élément existant. | `:715-718` ; `src/components/automations/PanneauEtape.tsx` (confirmation de fermeture) |
| Éditeur | Le bouton « Précédent » du navigateur passe maintenant par la confirmation « Quitter sans enregistrer ? » (la confirmation existait ; c'est ce chemin qui est nouveau) | Garde de sortie. | `src/pages/AutomationBuilderPage.tsx:2125`, `:2205` |
| Panneau d'étape | Bandeau « Lumi a modifié cette étape pendant que vous l'éditiez. » + boutons **Voir la version de Lumi** / **Garder ma version** | « Enregistrer » attend ce choix. | `src/components/automations/PanneauEtape.tsx:750-776` |
| Panneau d'étape, éditeur de courriel, Réglages › Messagerie | Bloc replié « Version anglaise (…) — utilisée seulement si vos messages partent en anglais » (ou l'inverse) : bouton pour déplier, champ de l'autre langue, deux boutons radio **La retirer** / **La garder telle quelle** | Les deux langues d'un message. | `src/components/automations/AutreVersionMessage.tsx:116-151` ; utilisé `src/components/automations/PanneauEtape.tsx`, `src/components/automations/EmailPreviewEditor.tsx`, `src/pages/SettingsMessaging.tsx` |
| Panneau d'étape | Messages d'erreur sous un champ hors bornes (délai, montant, adresse de webhook) ; « Enregistrer » inactif | Refus dans le panneau, avec la borne. | `src/components/automations/PanneauEtape.tsx:945`, `:1149` |
| Panneau du déclencheur | Message d'erreur de plage (minimum plus grand que le maximum, mois hors bornes) ; infobulle du bouton « Enregistrer » | idem | `src/components/automations/PanneauDeclencheur.tsx` (bouton `title={fautes[0]}`) |
| Éditeur de courriel | Champ **Chercher une variable à insérer** ; champ **Objet** de l'autre langue ; bouton « Supprimer cette ligne » ; la fenêtre est un vrai dialogue (`role="dialog"`) | | `src/components/automations/EmailPreviewEditor.tsx` |
| Réglages globaux › adresses d'appel | Bandeau d'erreur de lecture + bouton **Réessayer** | | `src/components/automations/AdressesDAppel.tsx:233` |
| Liste | Bandeau de pause : bouton **Réessayer** (lecture ratée) | | `src/components/automations/BandeauPause.tsx:140` |
| Liste | Confirmation « Publier avec le texte d'exemple ? » | Avant de publier une règle qui porte encore le texte d'exemple. | `src/pages/Automations.tsx:774` |
| Liste, Vue d'ensemble, Réglages globaux | La sous-navigation est devenue trois LIENS (`SousNavigation`) au lieu de boutons | Mêmes destinations. | `src/components/automations/SousNavigation.tsx:80-83` |
| Réglages › Messagerie | Lien **Ouvrir dans Automatisations** quand une règle envoie plusieurs textos | Ouvre l'éditeur de la règle. | `src/pages/SettingsMessaging.tsx:664-675` |
| Clavardage Lumi (`/lumi?automatisation=<id>`) | Pastille « À propos de l'automatisation « … » » + bouton **Ne plus parler de cette automatisation** | Contexte de page (section 7). | `src/pages/Lumi.tsx:813-818` |

Éléments dont le COMPORTEMENT a changé sans changer de place : l'enregistrement d'un texto ou d'un courriel depuis
la liste, l'éditeur de courriel, Réglages › Messagerie et Réglages › Avis passe par
`PATCH /api/automations/rules/:id/messages` (avant : écriture directe en base) ; le filtre d'un nombre dans
l'éditeur de conditions accepte les décimales (`src/components/champs/EditeurConditions.tsx`).

Éléments RETIRÉS : aucun bouton ni champ n'a disparu d'après le diff (les boutons de sous-navigation sont devenus
des liens ; le bouton « Envoyer un essai » de l'éditeur de courriel a changé de place).

Écrans qui n'ont PAS changé depuis la carte de l'interface (aucune ligne modifiée) : `OngletJournaux.tsx`
(Historique et Journaux), `InterrupteurPublication.tsx`, `CopierVersBureauxModal.tsx`. `AutomationsApercu.tsx` n'a
reçu que la sous-navigation. Les chiffres de la liste, de la Vue d'ensemble, de l'Historique et des Journaux sont
donc ceux que décrivent `AUTOMATIONS_UI_MAP.md` et la carte de l'agent D : fenêtre fixe de 60 jours
(`src/lib/automationJournauxApi.ts:31`, `server/routes/automation-stats.ts:35`), 200 lignes au plus, un seul filtre
« Statut » dans l'Historique, filtres « Action » et « Statut » dans les Journaux, aucune recherche, aucun lien vers
la fiche, aucun export, aucun historique des modifications.

---

## 6. Les appels du navigateur

### 6.1 Appels au serveur

| Fonction | Fichier:ligne | Appel |
|---|---|---|
| `chargerAutomatisations` | `src/lib/automationBuilderApi.ts:125` | GET `/api/automations/rules` |
| `chargerEditeur` | `:139` | GET `/api/automations/editeur` |
| `creerAutomatisation` | `:150` | POST `/api/automations/rules` |
| `modifierAutomatisation` (envoie `version_lue`), `rangerDansDossier` | `:160`, `:531` | PATCH `/api/automations/rules/:id` |
| `changerPublication` ; `toggleAutomationRule` | `:186` ; `src/lib/automationRulesApi.ts:72` | POST `/api/automations/rules/:id/publication` |
| `changerPublicationEnLot` | `src/lib/automationBuilderApi.ts:218` | POST `/api/automations/rules/publication` |
| `chargerStatistiques` | `:252` | GET `/api/automations/rules/stats` |
| `dupliquerAutomatisation` | `:264` | POST `/api/automations/rules/:id/duplicate` |
| `fetchModelesAutomatisation` | `:275` | GET `/api/automations/templates` |
| `utiliserModele` | `:287` | POST `/api/automations/templates/utiliser` |
| `chargerBureauxCibles` | `:310` | GET `/api/automations/bureaux-cibles` |
| `copierVersBureaux` | `:317` | POST `/api/automations/rules/:id/copier-bureaux` |
| `supprimerAutomatisation` | `:327` | DELETE `/api/automations/rules/:id` |
| `genererParcoursAvecLumi` | `:405` | POST `/api/automations/rules/generer` |
| `chargerDossiers`, `creerDossier`, `renommerDossier`, `supprimerDossier` | `:500`, `:506`, `:514`, `:523` | `/api/automations/folders` |
| `apercuAutomatisation` | `:551` | POST `/api/automations/rules/:id/apercu` |
| `restaurerAutomatisation` | `:565` | POST `/api/automations/rules/:id/restaurer` |
| `supprimerDefinitivementAutomatisation` | `:578` | DELETE `/api/automations/rules/:id/definitivement` |
| `ecrireMessageDeRegle` (et `updateRuleMessage`, `updateRuleSmsBody` qui l'appellent) | `src/lib/automationRulesApi.ts:371`, `:291`, `:478` | PATCH `/api/automations/rules/:id/messages` |
| `listerAdressesDAppel`, `creerAdresseDAppel`, `basculerAdresseDAppel`, `regenererAdresseDAppel`, `supprimerAdresseDAppel` | `src/lib/automationWebhooksApi.ts:62`, `:69`, `:79`, `:90`, `:99` | `/api/automations/webhooks` |
| `lireEtatPause`, `basculerPause` | `src/lib/automationWebhooksApi.ts:118`, `:125` | GET / POST `/api/automations/pause` |
| `apercuClientsInactifs` | `src/lib/reservationApi.ts:44` | GET `/api/automations/clients-inactifs/apercu` |
| `emitAppointmentRescheduled`, `emitJobCompleted`, `emitDealStageChanged`, `emitClientTagged`, `emitClientUntagged`, `emitTaskCompleted` | `src/lib/automationEventsApi.ts:42`, `:52`, `:59`, `:104`, `:109`, `:120` | POST `/api/automations/events/...`, sans attendre la réponse ni la lire |
| `emitQuoteSent`, `emitLeadCreated`, `emitLeadStatusChanged` | `src/lib/automationEventsApi.ts:70`, `:79`, `:86` | idem — **jamais appelées** |
| Gestion des étiquettes (créer, renommer, supprimer du catalogue) | `src/lib/etiquettesApi.ts:45-66` | routes d'étiquettes (hors `/api/automations`) |
| Clavardage Lumi | `src/lib/lumiApi.ts` | `/api/lumi/chat`, `/api/lumi/execute` (section 7) |

### 6.2 Lectures et écritures DIRECTES en base (PostgREST), sans passer par le serveur

Relevé par recherche de tous les `.from('<table>')` de `src/`.

**Sur `automation_rules` : plus aucune écriture depuis le navigateur.** Il reste trois lectures :

| Lecture | Fichier:ligne | Remarque |
|---|---|---|
| `select *` des règles du bureau | `src/lib/automationRulesApi.ts:54-60` | Liste, Vue d'ensemble, Réglages › Messagerie, Réglages › Avis. Rend aussi `lumi_conversation` et la corbeille. |
| `select actions, steps` d'une règle par `id` (sans filtre de bureau, la RLS borne) | `src/lib/automationRulesApi.ts:330-334` | Avant d'écrire un message. |
| `select updated_at` d'une règle | `src/lib/automationBuilderApi.ts:206` | Relecture de la version au retour sur la fenêtre. |

Les autres tables du moteur : lectures seules.

| Table | Opération | Fichier:ligne |
|---|---|---|
| `automation_execution_logs` | lecture | `src/lib/automationJournauxApi.ts:77` (Journaux), `:448` (Vue d'ensemble) ; `src/lib/automationRulesApi.ts:525` (échecs de 7 jours) |
| `automation_scheduled_tasks` | lecture | `src/lib/automationJournauxApi.ts:124` (Historique) |
| `clients`, `schedule_events`, `jobs` (et devis, factures) | lecture | `src/lib/automationJournauxApi.ts:202-257` (noms des clients des journaux) |
| `memberships`, `client_tags` | lecture | `src/lib/automationBuilderApi.ts:453`, `:477` (listes de l'éditeur) |
| `automation_folders`, `automation_webhooks`, `automation_webhook_receipts`, `pipeline_events`, `domain_events`, `envois_simules` | aucun accès | — |

**Les écritures directes qui restent et qui touchent aux automatisations** (le point de sécurité suivi) :

| Table | Écriture | Fichier:ligne | Pourquoi ça compte |
|---|---|---|---|
| `client_tags` | **insertion** d'une étiquette | `src/lib/etiquettesApi.ts:71` | Écrite en base par le navigateur, puis le serveur est prévenu (`:13`, route `client-tagged`). La politique RLS ne demande que d'être membre du bureau du client, pas le droit `clients.update` (`supabase/SCHEMA_SNAPSHOT.md:4805-4812`). |
| `client_tags` | **suppression** d'une étiquette | `src/lib/etiquettesApi.ts:80` | idem ; un membre sans le droit sur la route `client-untagged` retire l'étiquette et l'automatisation « Étiquette retirée » ne part pas. |
| `company_settings` | `default_language` (langue des messages) | `src/lib/automationRulesApi.ts:614-618` (sélecteur de la liste et des réglages globaux) | Hors du serveur ; la base n'accepte que d'un admin (0 ligne sinon, dit à l'écran `:620-624`). |
| `company_settings` | réglages d'avis (`review_enabled`, textes du texto et du courriel d'avis, liens) | `src/pages/SettingsReviews.tsx:234`, `:239` | Ce sont les textes que l'action « Demander un avis » envoie. |
| `company_settings` | fiche d'entreprise (dont `default_language`, `timezone`, nom et adresse) | `src/pages/CompanySettings.tsx:277`, `:290` | Le fuseau et l'identité servent à la fenêtre d'envoi et à la garde d'identité. |
| `clients` | colonnes de consentement (`sms_consent_at`, `email_consent_at`…) | `src/lib/clientsApi.ts:457` | Lues par la garde de consentement des envois. |
| `tasks` | statut `done` d'une tâche | `src/lib/tasksApi.ts:187`, `:223` (suivi de `emitTaskCompleted`) ; **`src/lib/pipelineVentesApi.ts:548-553` (fiche d'un deal : aucun appel au serveur, « Tâche terminée » ne part pas)** | Producteur du déclencheur n° 22. |
| `jobs` | statut `completed` | `src/lib/jobsApi.ts:1228` (suivi de `emitJobCompleted`, `:1238`) ; `src/pages/Jobs.tsx:948` ; `src/pages/Invoices.tsx:397` | `job.completed` naît du déclencheur SQL ; `job.ready_for_invoicing` seulement du premier chemin. |
| `schedule_events` | statut, équipe, suppression douce | `src/components/schedule/VisitDetailModal.tsx:178` ; `src/pages/JobDetails.tsx:509` ; `src/lib/jobsApi.ts:1448` | Les rendez-vous créés, déplacés et retirés de l'horaire passent, eux, par des fonctions de la base (`rpc_schedule_job`, `rpc_reschedule_event`, `rpc_add_visit`, `rpc_unschedule_job` : `src/lib/jobsApi.ts:241`, `:312` ; `src/lib/scheduleApi.ts:282`, `:307`, `:381`, `:486`). |
| `quotes`, `invoices` | statut (dont **retour en brouillon** d'une facture) | `src/lib/quotesApi.ts:568` ; `src/lib/invoicesApi.ts:875`, `:882-890` | Les déclencheurs SQL réagissent à ces changements. |
| `deals` | étape, responsable, date prévue | `src/lib/pipelineVentesApi.ts:580-638` | Le déclencheur SQL remplit `pipeline_events`. |
| `specific_notes` | insertion, modification, suppression d'une note | `src/lib/specificNotesApi.ts:72`, `:97`, `:109` | N'émet pas « Note ajoutée » (section 2). |

`automation_webhooks` : le navigateur n'y écrit pas, mais la base l'y autoriserait — la politique
`automation_webhooks_write` couvre toutes les commandes, DELETE compris (`supabase/SCHEMA_SNAPSHOT.md:4738-4740`).

Ce que la garde en base de `automation_rules` laisse encore passer à une session qui a `automations.update`, par
un appel direct à PostgREST (aucun écran ne le fait) : écrire `trigger_event` d'une règle à soi hors du catalogue,
écrire `steps`, `actions`, `conditions`, `settings` sans la validation du serveur (texte vide ou trop long sur une
règle publiée), insérer un brouillon sans le forfait. Aucune migration de cet arbre ne retire les droits
d'insertion, de modification et de suppression à `authenticated` sur cette table.

---

## 7. Lumi

Version du prompt du clavardage : `VERSION_PROMPT = 'v2026-10-02.1'`, empreinte `bf8d92d1ef51`
(`server/lib/lumi/version.ts:16`, `:19`). Version du prompt du générateur de parcours :
`VERSION_PROMPT_PARCOURS = 'parcours-2026-10-02.2'`, modèle `claude-sonnet-5`
(`server/lib/lumi/generer-parcours.ts:73`, `:49`).

### 7.1 Les deux portes d'entrée

| | Clavardage général | Panneau « Construire avec Lumi » de l'éditeur |
|---|---|---|
| Écran | `/lumi` (`src/pages/Lumi.tsx`) | panneau de l'éditeur (`src/components/automations/ClavardageLumi.tsx`, logique dans `src/pages/AutomationBuilderPage.tsx:880-1030`) |
| Routes | `POST /api/lumi/chat` (`server/routes/lumi.ts:623`), puis `POST /api/lumi/execute` après confirmation (`:1106`) ; aussi `POST /api/lumi/action` (`:1039`) | `POST /api/automations/rules/generer` (`server/routes/automation-rules.ts:372`) |
| Droit | `external_agent.use` (`server/lib/route-permissions.ts:84-85`, `:89`), puis le droit de chaque outil | `automations.update` (`:162`) |
| Qui écrit la règle | le serveur, par les outils ci-dessous, après « Confirmer » | **le navigateur** : la route rend un parcours, l'éditeur l'enregistre par PATCH. La route n'écrit que `lumi_conversation` (`server/routes/automation-rules.ts:559-565`). |
| Exception | — | « active-la » puis « oui », ou « mets-la en pause » : le serveur publie ou dépublie lui-même par `changerPublication`, sans passer par le modèle (`server/lib/lumi/panneau-automatisation.ts:118-190`, appelé par `reponseSansChangement`, `:258-288`). Il refuse si ce qui est à l'écran n'est pas ce qui est enregistré (`:155-163`) ou si une étape porte le texte d'exemple (`:164-172`). |
| Contexte donné au modèle | l'automatisation ouverte ou citée, en résumé écrit par du code : `contexte_page` (`server/routes/lumi.ts:90`, `:698`), `contexteDeLaPage` et `automatisationsCitees` (`server/lib/lumi/contexte-automatisation.ts:63`, `:219`) | la demande, les 6 derniers échanges, le parcours à l'écran (`trigger_event`, `steps`), le nom enregistré et les étapes d'avant la dernière modification de Lumi (`server/routes/automation-rules.ts:407-430`) |
| Journal d'actions (`agent_actions`) | chaque écriture, par `executerIdempotent` | une ligne par proposition (`journaliserProposition`, `server/lib/lumi/panneau-automatisation.ts:291-297`) et par publication (`:144`, `:177`), avec `canal: 'editeur'` (`:42`) |
| Budget | budget Lumi du bureau | budget Lumi du bureau, réservé avant l'appel (dans `genererParcours`) |

Le lien du contexte de page : `/lumi?automatisation=<id>` est lu par `contextePageDepuisAdresse`
(`src/lib/lumiContextePage.ts:31`, `src/pages/Lumi.tsx:270`). La fonction qui fabrique ce lien,
`lienLumiSurAutomatisation` (`src/lib/lumiContextePage.ts:23`), **n'est appelée par aucun écran** : il n'y a pas de
bouton dans l'éditeur ni dans la liste qui ouvre le clavardage sur une automatisation.

Ce que l'éditeur ne lit pas dans la réponse de `/generer` : les champs `modifie`, `renomme` et `publiee`
(`server/routes/automation-rules.ts:582-583`, `server/lib/lumi/panneau-automatisation.ts:285-286`). Aucun de ces
trois mots n'apparaît dans `src/pages/AutomationBuilderPage.tsx` ni dans `src/lib/automationBuilderApi.ts`.
Conséquences : l'éditeur applique `propose.nom` même si Lumi n'a pas été prié de renommer
(`src/pages/AutomationBuilderPage.tsx:962`) ; il réenregistre le parcours rendu même quand rien n'a changé
(`:958`) ; après « active-la » puis « oui », l'état « Publiée » de l'écran ne suit pas sans rechargement.

### 7.2 Les outils du clavardage

Écriture de contenu : une seule porte, `ecrireRegle` (`server/lib/automations-ecriture.ts:73`), qui valide, écrit
`steps` et le reflet `actions`, puis relit la ligne. Elle écrit avec le client de l'utilisateur (`ctx.client`),
pas le rôle de service. Elle ne propage pas aux copies liées des autres bureaux et n'envoie pas de garde de
version.

| Outil | Nature | Droit | Fichier:ligne | Ce qu'il écrit | Relit la base après ? | Jamais sans carte ? |
|---|---|---|---|---|---|---|
| `list_automations` | lecture | `automations.read` (`server/lib/agent/garde.ts:63`) | `server/lib/agent/tools-etendus.ts:1035` | — ; rend 50 règles au plus, hors corbeille : nom, déclencheur en clair, publié ou non | — | — |
| `get_automation` | lecture | `automations.read` | `server/lib/agent/tools-reglages.ts:1057` | — ; par identifiant ou par nom partiel : état, déclencheur, filtres, chaque étape, chaque message tel qu'enregistré, portée, obstacles à la publication | — | — |
| `get_automation_health` | lecture | `automations.read` (`server/lib/agent/garde.ts:64`) | `server/lib/agent/tools-etendus.ts:1067` | — ; les 100 dernières lignes du journal : partis, sautés (par motif), échoués (par cause). Compte les règles écartées (`conditions`) parmi les « sautés ». | — | — |
| `list_automation_templates` | lecture | `automations.read` | `server/lib/agent/tools-lot-entreprise.ts:624` | — | — | — |
| `toggle_automation_rule` | écriture | `automations.update` | `server/lib/agent/tools-reglages.ts:452` | `is_active`, par `changerPublication` (`:488`). Refuse de publier un texte d'exemple (`:473-484`). | **oui** (`:491-494`) ; rend l'état relu, les étapes et la portée | oui (`server/lib/agent/registre.ts:95`) |
| `create_automation_from_text` | écriture | `automations.update` | `:547` | Une règle en brouillon : parcours généré (`genererParcours`), reflet `actions` ; une 2e règle si demandée (`:633`, `:658`) | **oui** (par `ecrireRegle`) | oui |
| `update_automation_from_text` | écriture | `automations.update` | `:736` | La MÊME règle : étapes, déclencheur, nom si demandé (`:797-804`). Rien n'est activé. Une règle publiée que la modification casserait reste intacte. | **oui** | **non** : absent de `JAMAIS_D_OFFICE` (`server/lib/agent/registre.ts:86-103`) alors qu'il change ce qu'une règle publiée envoie |
| `update_automation_message` | écriture | `automations.update` | `:938` | Corps et/ou objet d'UN message (`reecrireMessageAutomation`, `:845-926`). Refuse la corbeille, une variable inconnue, un « plus court » qui ne l'est pas. | **oui** ; rend `texte_enregistre` | oui |
| `update_automation_sms_body` | écriture | `automations.update` | `:976` | idem, texto seulement | **oui** | oui |
| `set_automation_language` | écriture | `automations.update` + admin en base | `:1004` | `company_settings.default_language` — toute l'entreprise, pas une règle. Écriture directe par la session (`:1016-1020`). | **oui** (`:1024-1027`) | non |
| `rename_automation_rule` | écriture | `automations.update` | `server/lib/agent/tools-lot-entreprise.ts:527` | `name`, par la route PATCH (`:548`) | non — rend le nom de la réponse de la route | non |
| `duplicate_automation_rule` | écriture | `automations.update` | `:494` | Copie en brouillon, par la route (`:508`) | en partie : `garantirBrouillon` (`:433-452`) vérifie `is_active` dans la réponse, sinon l'éteint par une écriture directe de la session (`:440-445`) | non |
| `delete_automation_rule` | écriture | `automations.update` | `:458` | Corbeille + envois prévus annulés, par la route DELETE (`:475`) | non — la route répond 404 si rien n'a été touché | oui (`server/lib/agent/registre.ts:102`) |
| `create_automation_from_template` | écriture | `automations.update` | `:684` | Copie d'un modèle en brouillon, par la route (`:706`) | en partie (`garantirBrouillon`) | oui |
| `pause_all_automations` | écriture | `automations.update` + admin en base | `:566` | `company_settings.automations_paused`, par la route (`:581`) | **oui** : la route rend l'état relu, l'outil refuse s'il diffère (`:584-589`) | oui |
| `get_recent_agent_actions` | lecture | — | `server/lib/agent/tools-etendus.ts:2601` | — ; lit `agent_actions` | — | — |
| `get_reminder_settings`, `update_reminder_settings`, `send_payment_reminders` | lecture / écriture | — | `server/lib/agent/tools-argent.ts:1952`, `:1978` ; `server/lib/agent/tools-etendus.ts:4023` | Le système PARALLÈLE des relances de paiement (`reminder_settings`), pas `automation_rules` | non relu ici | — |

Soit **15 outils d'automatisation** (4 de lecture, 11 d'écriture), plus `get_recent_agent_actions` et les 3
outils des relances de paiement.

Autour des outils :

- Avant la carte de confirmation, le serveur écrit lui-même ce qui partira (`server/lib/lumi/avant-carte.ts:84`,
  `:141`) et les compléments de carte lisent le texte actuel (`server/lib/lumi/complements-cartes.ts:121-158`).
- « Faut-il une carte avant de terminer un job ? » lit les règles publiées sur « Job terminé » par l'accès unique
  (`server/lib/lumi/execution.ts:44`, `:156`).
- Raccourcis sans modèle : « liste mes automatisations » et « active / désactive l'automatisation X »
  (`server/lib/lumi/actions-directes.ts:84`, `:443`).
- Sujet du routeur : `server/lib/lumi/topics.ts:87`.
- Consigne « jamais introuvable sans avoir cherché » : `server/lib/agent/consignesCollegue.ts:50`.
- Les outils voisins qui déclenchent des automatisations rappellent les routes d'événements
  (`server/lib/agent/tools-etendus.ts:1777`, `:2972`, `:3075`, `:3135`, `:4011` ;
  `server/lib/agent/tools-terrain.ts:527`, `:578`) ou annoncent une étiquette
  (`server/lib/agent/tools-leads.ts:1344`, `:1379`).

Ce que Lumi ne sait pas faire sur une automatisation, d'après les outils présents : restaurer de la corbeille,
ranger dans un dossier, copier vers un autre bureau, changer les réglages (`settings` : fenêtre d'envoi,
ré-entrée, arrêt si résolu), jouer l'aperçu « ce qui partirait », cibler par type de client (n'existe pas dans le
produit).

---

## 8. Les points d'entrée externes

| Entrée | Route ou mécanisme | Fichier:ligne | Authentification | Ce qu'elle déclenche |
|---|---|---|---|---|
| Webhook entrant d'un client (site, Zapier, Facebook Leads) | `POST /api/hooks/:cle` | `server/routes/webhooks-entrants.ts:118` ; monté avant le parseur JSON (`server/index.ts:396`) | la clé de 64 caractères dans l'adresse ; 60 appels par minute et par clé (`:50-51`), 20 échecs par minute et par IP (`:77`) ; forfait du bureau (`:166`) ; corps de 64 Ko au plus (`:44`), JSON ou formulaire | `webhook.received`. N'écrit aucune fiche : une trace dans `automation_webhook_receipts` (`:205`, `:223`), puis l'événement (`:234`). Les champs de contrôle du moteur sont retirés du corps (`:272-279`). |
| Formulaire public de demande | `POST /api/public/form/:apiKey/submit` | `server/routes/request-forms.ts:468` (émission `:940`) | clé du formulaire | `lead.created` (source `request_form`) |
| Texto entrant (réponse d'un client, STOP) | `POST /api/messages/inbound` | `server/routes/messages.ts:215` | signature Twilio (`:241-263`) | STOP / START traités d'abord (`:299-352`, `server/lib/desabonnement/sms.ts`) : écrit `sms_opt_outs` ; puis le message entre dans la conversation du bureau du numéro, et `client.replied` est émis (`:637`). Les attentes « jusqu'à réponse » du client sont réveillées (`server/lib/automationEngine.ts:1413-1415`). |
| Accusé de livraison d'un texto | `POST /api/messages/status` | `server/routes/messages.ts:661` | signature Twilio | met à jour le statut du message |
| Courriel entrant d'un client | synchro Gmail | `server/lib/email/sync/gmail.ts:262` | compte Gmail branché du bureau | `client.replied` |
| Désabonnement (lien d'un courriel) | `GET` et `POST /api/unsubscribe/:token` | `server/routes/unsubscribe.ts:133`, `:227` | jeton | écrit `email_unsubscribes` (`:188-189`, `:260-261`) et, par canal, `sms_opt_outs` (`:57-58`) |
| Rebonds et plaintes de courriel | `POST /api/webhooks/email`, webhooks SES | `server/routes/webhooks-email.ts`, `server/routes/webhooks-ses.ts` | signature du fournisseur | alimentent la garde « adresse injoignable » (non relu en détail) |
| Paiement échoué | webhook Stripe | `server/routes/payments.ts:427` → `server/lib/paiement-echoue.ts:150` | signature Stripe | `payment.failed` (si drapeau) |
| Paiement reçu | webhook Stripe, PayPal | `server/lib/payments.ts:1026`, `server/routes/payments.ts:374` | signature | `invoice.paid` |
| Page publique d'un devis | `GET /api/quotes/public/:token`, `POST …/accept`, `…/decline`, `…/request-changes` | `server/routes/quotes.ts:754`, `:924`, `:1355`, `:1438` | jeton | `quote.viewed` (`:773`) ; accepté / refusé par le déclencheur SQL ; `quote.changes_requested` (`:1501`) |
| Page publique d'une facture | `GET /api/invoices/public/:token` | `server/routes/invoices-public.ts:108` | jeton | `invoice.viewed` (si drapeau, `:186`) |
| Signature d'un contrat | `POST /api/agreements/public/sign` | `server/routes/agreements.ts:533` | jeton | `agreement.signed` (`:606`) |
| Lien de réservation (client inactif) | `/api/reservation/:jeton` | `server/routes/reservation.ts:44` | jeton, drapeau | destination d'un message d'automatisation |
| Crons de la base | `POST /api/cron/rappels-dates`, `/payment-reminders`, `/recurring-invoices`, `/webhook-retries` | `server/routes/cron.ts:94`, `:69`, `:106` ; `server/routes/reminders-cron.ts:648` | `x-cron-secret` | voir section 4 |
| Changements faits directement en base (import, script, autre outil) | déclencheurs SQL | `supabase/migrations/20261003100000_evenements_automatisations_par_la_base.sql` ; `supabase/migrations/20260923100100_pipeline_moteur_et_forfait.sql:171` | — | rendez-vous créé ou annulé, job terminé, devis accepté ou refusé, facture envoyée, opportunité qui change d'étape : l'événement naît quel que soit l'auteur du changement |
| Création d'un bureau | semis des automatisations fournies | `server/lib/automationPresetSeeder.ts:150-190` ; fonction SQL `seed_automation_presets` | — | insère les règles fournies |
| MCP (assistant externe) | mêmes outils que Lumi | `server/routes/mcp.ts` (non relu en détail) | OAuth ou clé | lecture et écriture des automatisations |

---

## 9. Comptes par bureau et par modèle

Lecture seule de la prod, le 2026-10-02 à 12:35 UTC (`scripts/qa/finale/unification-essai-a-blanc.mts`).
685 règles dans `automation_rules`, 14 bureaux ; l'ancienne table `automations` est vide.

| Bureau | Règles | À parcours (`steps`) | À plat (`actions`) | dont publiées | Neuves (aucune étape) | Corbeille | Envois en attente sur des règles à plat |
|---|---|---|---|---|---|---|---|
| Entreprise réelle n° 1 | 51 | 4 | 40 | 21 | 3 | 4 | 110 |
| Entreprise réelle n° 2 | 40 | 1 | 39 | 32 | 0 | 0 | 2 |
| 12 bureaux de test, d'essai et d'archive | 594 | 37 | 468 | 333 | 3 | 86 | 115 |
| **Total** | **685** | **42** | **547** | **386** | **6** | **90** | **227** |

Ce que ces comptes disent :

- **80 % des règles vivantes sont à l'ancien format à plat** (547 sur 595) : ce sont surtout les préréglages
  semés à l'ouverture d'un compte (39 ou 40 par bureau), jamais convertis.
- Conversion en parcours : possible sans rien perdre pour **537 des 547** (mêmes actions et même délai à
  l'aller-retour). Les 10 autres sont le même préréglage retiré, « Estimate Follow-Up (3 days) », branché sur
  `estimate.sent` — un événement que rien n'émet : il est publié mais ne part jamais (une occurrence dans
  l'entreprise réelle n° 2).
- **41 règles à parcours portent une copie `actions` périmée** (5 dans les deux entreprises réelles) : semées ou
  créées avant que `actions` soit recopié du parcours à chaque écriture.
- Par déclencheur, règles vivantes : `quote.sent` 105, `job.completed` 100, `lead.created` 76, `invoice.sent` 76,
  `appointment.created` 62, `quote.approved` 48, `invoice.paid` 29, `quote.viewed` 28, `lead.status_changed` 27,
  `agreement.signed` 14, `estimate.sent` 14, `appointment.cancelled` 14, `deal.stage_entered` 1, `invoice.overdue` 1.

## 10. Écarts entre les notes de départ et le code, et ce qui n'a pas été vérifié

### 10.1 Écarts entre les notes de départ et le code

Les notes ont été écrites avant les corrections, sur d'autres arbres (`wt-a`, `wt-b`, `wt-d`, `wt-e`). Quand une
note et le code de cet arbre divergent, c'est le code qui est décrit dans les sections 1 à 8.

**Ce que les notes disent corrigé ou prévu, et qui N'EST PAS dans cet arbre**

| Note | Ce qu'elle dit | Ce que dit le code de cet arbre |
|---|---|---|
| `JOURNAL.md` (agent M : B-13, B-14, B-18, B-19 « commités ») | Corrections du moteur faites. | Elles sont sur la branche de l'agent M, pas fusionnées ici. Le moteur est celui d'avant : « Date atteinte » sans rattrapage (`server/lib/rappels-dates.ts:224-230`), route `rappels-dates` sans verrou (`server/routes/cron.ts:94-104`), notes et tâches de Lumi sans événement (section 2), planificateur sans suivi `withCronCheckIn` (aucune occurrence dans `server/lib/scheduler.ts`). |
| `JOURNAL.md` (agent S lancé : statistiques, Historique, Journaux, `server/lib/automations-stats.ts`, `server/lib/automations-modifications.ts`) | Nouveaux fichiers et écrans. | Absents : ces deux fichiers n'existent pas ; `OngletJournaux.tsx` et la route de statistiques sont inchangés ; aucune table d'historique des modifications. |
| `JOURNAL.md` (« Catalogue unique des issues `src/lib/automationMotifs.ts` : le moteur écrit les codes, les écrans les lisent ») | Le catalogue est branché. | Le fichier existe mais n'est importé nulle part ; 17 de ses 29 codes ne sont écrits par aucun code (section 3.2). Le plafond de fréquence est toujours un échec en anglais avec le numéro du client. |
| `E-conception.md` | Ciblage dans `conditions.ciblage`, garde anti-doublon de 24 h, catalogue `src/lib/automationVariables.ts`, valeur de remplacement `{prénom\|là}`. | Rien de tout cela n'existe : aucune clé `ciblage`, pas de fichier `automationVariables.ts`, `resolveTemplate` sans valeur de remplacement : une variable vide ou inconnue devient une chaîne vide (`server/lib/actions/index.ts:601-637`). |
| `L-corrections.md` § 4 (« Éditeur — décrit, NON fait ») | À faire par l'agent de l'éditeur : ne rien enregistrer si `modifie: false`, refléter `publiee`, bouton « Demander à Lumi ». | Toujours pas fait (section 7.1). `lienLumiSurAutomatisation` n'a aucun appelant. |
| `L-corrections.md` § 4, `T-corrections.md` (constat A-21) | Un courriel en texte brut part en un seul bloc ; à corriger au moteur. | Non corrigé au moteur : `executeSendEmail` rend le corps tel quel (`server/lib/actions/index.ts:1330`, `:1485`). Les outils de Lumi, eux, enregistrent maintenant le courriel en HTML (`server/lib/agent/tools-reglages.ts:425-427`). |
| `T-corrections.md` (blocs « À REPORTER ») | Patchs prêts pour `MessageEditor.tsx`, `SequenceCanvas.tsx`, `AutomationsApercu.tsx`, `automationJournauxApi.ts`, et la ligne du nom d'une copie de modèle. | `MessageEditor.tsx`, `SequenceCanvas.tsx`, `OngletJournaux.tsx`, `AutomationsApercu.tsx` et `src/lib/automationJournauxApi.ts` n'ont aucune ligne modifiée depuis le commit `351f16e5` (celui d'avant la mission) : ces patchs ne sont pas appliqués. Le nom d'une copie de modèle suit toujours la langue des MESSAGES du bureau (`server/routes/automation-rules.ts:889-890`), pas celle de l'interface. |
| `DURCISSEMENT-ecritures.md` | Une seule porte pour écrire, par le rôle de service, puis retrait des droits d'écriture à `authenticated`. | `ecrireRegle` existe mais écrit avec la session et ne sert qu'aux outils de Lumi. Les routes écrivent toujours elles-mêmes avec la session (section 1.3). Aucune migration ne retire les droits. `client_tags` et `automation_webhooks` : politiques inchangées. |

**Ce que les notes disent encore faux, et qui EST corrigé dans cet arbre**

| Note | Ce qu'elle dit | Ce que dit le code de cet arbre |
|---|---|---|
| `A-carte.md` § 3, `D-carte.md` § 1, `AUTOMATIONS_UI_MAP.md` (partie 3, § 4.1, EXT-007, EXT-008), `AUTOMATIONS_INVENTORY.md` (écart 7) | Le texte d'un message est écrit directement en base par le navigateur (`updateRuleMessage`). | Il passe par `PATCH /api/automations/rules/:id/messages` ; le navigateur n'écrit plus `automation_rules` (section 6.2). |
| `A-carte.md` § 3, `P1-1-piste.md`, `REGISTRE.md` (A-02) | L'éditeur n'écrit que `steps` ; `actions` reste « À compléter ». | Le PATCH re-dérive `actions` quand le parcours change (`server/routes/automation-rules.ts:779`) et l'éditeur envoie le reflet (`src/pages/AutomationBuilderPage.tsx:1355-1366`). Les règles déjà en base ne sont pas rattrapées. |
| `A-carte.md` § 3 et § 5 | `create_automation_from_text` écrit `actions: []` ; `update_automation_message` laisse `actions` périmé ; `toggle_automation_rule` rend la valeur demandée. | Les trois passent par `ecrireRegle` ou relisent la base (section 7.2). |
| `A-carte.md` § 4, `REGISTRE.md` (A-11) | `execution.ts` ne lit que `actions`. | Il passe par l'accès unique (`server/lib/lumi/execution.ts:44`, `:156`). |
| `A-carte.md` § 4, `REGISTRE.md` (A-19), `L-corrections.md` § 5 | Réglages › Messagerie filtre sur `actions`. | Il filtre par `messagesDeRegle` (`src/pages/SettingsMessaging.tsx:512`). Il reste `src/pages/SettingsReviews.tsx:705`. |
| `A-carte.md` § 5 et § 6 | 15 outils dont 3 de relances ; Lumi ne peut pas lire une automatisation ni en modifier la structure. | 15 outils d'automatisation, dont `get_automation` et `update_automation_from_text` (nouveaux), plus les 3 outils de relances. |
| `A-carte.md` § 5 | Le panneau de l'éditeur n'écrit rien dans `agent_actions` ; « active-la » ne s'envoie pas (moins de 10 caractères). | Il journalise (`server/lib/lumi/panneau-automatisation.ts:291`) ; une réponse courte est acceptée en conversation (`:199-202`) ; il publie et dépublie lui-même. |
| `A-carte.md` § 5 | Le panneau utilise le modèle Haiku. | `MODELE = 'claude-sonnet-5'` (`server/lib/lumi/generer-parcours.ts:49`). |
| `A-carte.md` § 7 | Aucun contexte de page n'est envoyé au clavardage. | `contexte_page` existe côté serveur et côté page Lumi — mais aucun écran ne fabrique le lien (section 7.1). |
| `REGISTRE.md` (A-09) | Aucune garde de version. | `version_lue` → 409 (`server/routes/automation-rules.ts:660-664`). Les outils de Lumi n'envoient pas cette garde. |
| `AUTOMATIONS_UI_MAP.md` (partie 3, § 4.2) | Aucun déclencheur ne protège `is_active`, `is_preset`, `preset_key`. | `trg_automation_rules_garde` (`supabase/migrations/20261007300000_automation_rules_garde.sql`). |
| `AUTOMATIONS_UI_MAP.md` (décompte) | 43 routes serveur. | 44 routes sous `/api/automations` (la route des messages s'est ajoutée). |

**Écarts de fond**

| Note | Ce qu'elle dit | Ce que dit le code |
|---|---|---|
| `REGISTRE.md` (« Prouvé correct par B ») | « Une facture émise ne revient pas en brouillon. » | Le navigateur a une fonction qui écrit `status: 'draft'` sur une facture (`revertToDraft`, `src/lib/invoicesApi.ts:882-890`) et Lumi a l'outil `revert_invoice_to_draft` (`server/lib/agent/tools-argent.ts:1097`). Je n'ai pas vérifié si la base le refuse. |
| `A-carte.md` § 2 | « La file planifiée relit la règle à chaque étape : une étape modifiée entre-temps part avec le NOUVEAU texte. » | La tâche exécute la copie de l'action prise à sa mise en file (`server/lib/automationEngine.ts:2121-2123`) ; seule une tâche mise en file après la modification porte le nouveau texte (section 3.3). |
| `B-carte.md` § 3 | Trois déclencheurs à un seul chemin (`note.added`, `task.completed`, `job.ready_for_invoicing`). | Deux de plus : `lead.created` (porte-à-porte, que B donnait « non vérifié ») et les tâches cochées dans la fiche d'un deal (`src/lib/pipelineVentesApi.ts:548-553`), qui n'appellent pas le serveur. |
| `B-carte.md` § 3 | `quote.sent`, `lead.created`, `lead.status_changed` listent aussi `automation-events.ts` comme producteur. | Ces trois routes n'ont aucun appelant. |
| `MISSION.md` (phase 0) | « versions brouillon/publiée », « plusieurs déclencheurs ». | Une seule colonne `is_active`, aucune version ; un seul déclencheur par règle. |
| Commentaires du code | « Les 17 déclencheurs offerts », « Les 18 actions offertes ». | 28 déclencheurs, 21 actions (`src/lib/automationCatalogue.ts:142`, `:800`). |
| `supabase/SCHEMA_SNAPSHOT.md` | Se présente comme la référence du schéma (générée le 2026-09-30). | Ne contient pas le déclencheur `trg_automation_rules_garde`, appliqué après. |

**Numéros de ligne des notes** : ceux qui visent `server/lib/automationEngine.ts`, `server/lib/actions/index.ts`,
`server/lib/scheduler.ts` et les fichiers de files d'événements sont encore justes (ces fichiers n'ont pas été
touchés par les lots fusionnés). Ceux qui visent `server/routes/automation-rules.ts`,
`server/lib/agent/tools-reglages.ts`, `server/lib/agent/tools-etendus.ts`, `server/lib/validation.ts`,
`src/lib/automationRulesApi.ts`, `src/pages/AutomationBuilderPage.tsx`, `src/components/automations/PanneauEtape.tsx`
et `src/pages/SettingsMessaging.tsx` ont bougé ; les lignes à jour sont celles de cette carte.

### 10.2 Non vérifié

| Sujet | Pourquoi |
|---|---|
| Tout ce qui est de la prod ou de l'exécution : nombre de règles, tâches en file, événements émis, passages réussis de pg_cron, secrets présents, valeur de `FEATURE_GUARD`, drapeaux allumés par bureau | Consigne : aucune requête contre une base, aucun serveur lancé. La section 9 est laissée au coordinateur. |
| Les 377 éléments interactifs de `AUTOMATIONS_UI_MAP.md`, un par un | J'ai vérifié le delta par comparaison de code depuis le commit de cette carte (section 5.2), pas chaque élément resté en place. Rien n'a été joué au navigateur. |
| Les fiches de tri `e2e/automations/_tri/*.md`, `AUTOMATIONS_UI_AUDIT.md`, `AUTOMATIONS_TEST_MATRIX.md` | Non relues en détail : ce sont des constats et des cas de test, pas des descriptions du code. |
| Le schéma réel de la base | `supabase/SCHEMA_SNAPSHOT.md` date du 2026-09-30 et n'a pas les migrations d'après. Les politiques de `domain_events`, `envois_simules` et `orgs_envois_simules` n'y figurent pas ; leurs migrations retirent tout droit à `anon` et `authenticated` (`supabase/migrations/20260929230000_domain_events_outbox.sql:64-68`, `supabase/migrations/20261005100000_bac_a_sable_envois.sql:32-38`). Je n'ai pas pu confirmer qu'elles sont appliquées. |
| Les migrations qui réécrivent `steps` de règles fournies : remettent-elles `actions` en accord ? | Seules les lignes citées ont été lues (`supabase/migrations/20261003600000_courriels_prereglages.sql:935-942`). |
| Les variables remplies par fiche et les listes de variables des écrans (`E-carte.md` § 3) | `resolveEntityVariables` (`server/lib/actions/index.ts:806-1223`) et les palettes n'ont pas été relus ligne à ligne. Le moteur n'ayant pas changé, la carte de l'agent E vaut pour la partie serveur ; les numéros de ligne de `PanneauEtape.tsx` ont bougé. |
| Le détail des conditions d'arrêt (`checkStopConditions`, `verdictSortie`) et du consentement (`consentementCommercial`) | Localisés (`server/lib/automationEngine.ts:2870`, `server/lib/sortie-parcours.ts:119`, `server/lib/actions/index.ts:387`), non relus branche par branche. |
| Le contenu du générateur de parcours (`server/lib/lumi/generer-parcours.ts`, 1 100 lignes et plus), l'orchestrateur du clavardage, le modèle qu'il emploie, le serveur MCP (`server/routes/mcp.ts`) | Seuls la version, le modèle du générateur et les points d'entrée ont été lus. |
| Les bibliothèques de modèles et de préréglages (`server/lib/automationTemplates.ts`, `server/lib/automationPresets.data.ts`, `server/lib/automationPack.data.ts`) : nombre de modèles, cohérence de leurs `actions` avec leurs `steps` | Fichiers de données non lus. |
| Les relances de paiement (`server/routes/reminders-cron.ts`), les webhooks de courriel (`webhooks-email.ts`, `webhooks-ses.ts`), la synchro Gmail | Lus seulement aux points qui touchent les automatisations. |
| L'application mobile | Aucun code mobile cherché dans cet arbre. |
| Les mineurs de l'agent U, les lots des agents M et S | Pas dans cet arbre au moment de la lecture. |

