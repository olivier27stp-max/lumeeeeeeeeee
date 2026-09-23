# PIPELINE_PLAN.md — Pipeline de ventes (avant-job)

> **Statut : PHASES 0, 1 et 2 livrées. Migrations appliquées sur STAGING seulement.**
> Audit en lecture seule du 2026-09-23 contre `origin/main` (15a719ee).
> Aucune écriture en base, aucune migration, aucun commit.
> Ce fichier est le plan d'origine **réécrit contre le code réel**. Les écarts
> sont signalés en clair : rien n'a été corrigé en silence.

---

## 0. Ce qu'il faut lire en premier

Cinq constats renversent des prémisses du plan initial. Ils sont tous vérifiés,
avec la preuve à côté.

| # | Le plan suppose | La réalité | Preuve |
|---|---|---|---|
| **A** | Multi-tenancy par `tenant_id` | **`org_id`**, partout. `tenant_id` n'existe nulle part | 0 occurrence dans `SCHEMA_SNAPSHOT.md` (8733 l.) et dans `supabase/migrations/` (533 fichiers) ; 351 fichiers de migration utilisent `org_id` |
| **B** | L'ancien pipeline = données de test à dropper | `pipeline_deals` = **126 lignes, 7 policies, 6 triggers propres + 5 externes, 14 fonctions SQL, 2 vues, 2 crons, 3 écrivains distincts** | §2 ci-dessous |
| **C** | Réutiliser « l'entité lead/client existante » | **Déjà fait, et c'est une décision produit appliquée** : la table `leads` a été supprimée, un lead = `clients` avec `status='lead'` | `20260705000000_eliminate_leads_table.sql` |
| **D** | Les actions d'étape passent par « l'outbox » | **Il n'y a pas d'outbox.** Le bus est un `EventEmitter` en mémoire ; un événement émis pendant un redémarrage est perdu définitivement | `server/lib/eventBus.ts:84-131` ; 0 résultat pour `outbox\|domain_event` hors documentation |
| **E** | Merge des doublons sur téléphone/courriel | **Désactivé volontairement le 2026-07-07**, avec une migration qui a supprimé les index d'unicité. Motif : couples, propriétaire/locataire | `20260720000000_allow_duplicate_client_contacts.sql` ; `server/lib/leadClientSync.ts:38-46` |

Deux collisions de surface s'y ajoutent :

- **La route `/pipeline` est déjà prise** par le kanban D2D (`src/App.tsx:1637`).
- **« Ventes » dans Lume, c'est le module D2D** (`t.nav.d2d = 'Vente'`, `src/i18n/fr.ts:34`),
  gaté par le forfait payant `includes_d2d`. « Supprimer le pipeline D2D » et
  « brancher le pipeline dans la section Ventes » désignent donc le même endroit.

---

## 1. Ce qui existe déjà et qu'on ne refait pas

Réutilisable tel quel — c'est autant de travail en moins que le plan initial prévoyait.

| Besoin du plan | Existe déjà | Où |
|---|---|---|
| FK composites anti-fuite inter-org | **Convention maison établie** | `pipeline_deals_client_id_same_org (org_id, client_id) → clients(org_id, id)`, idem job/quote/lead |
| Board kanban drag & drop | Board mûr : colonnes droppables, cartes sortables, garde de transition, update optimiste + rollback, verrou anti-concurrence, panneau latéral | `src/pages/D2DPipeline.tsx` (613 l.) — `DealCard:108`, `StageColumn:195`, `handleDragEnd:419` |
| Onglets de page | Pattern canonique, état dans l'URL | `src/pages/Finances.tsx:57-66` + classes `tab-nav`/`tab-item` (`src/index.css:1034+`) |
| Sélecteur de période | `PeriodSelector` + `periodRange()` pure et testable | `src/components/insights/PeriodSelector.tsx`, `src/lib/insightsPeriod.ts` |
| Cards de stats | `MiniTrendCard` (générique, prend une série brute), `RevenueTrendCard`, `ServiceMixCard` ; recharts 3.7 | `src/components/insights/` |
| Convention RPC de stats | 13 RPC `rpc_insights_*` avec arguments uniformes `p_org, p_from, p_to` | `src/lib/insightsApi.ts` |
| Feature flag pour cacher une route | Triple gate `Gated` / `PlanFeatureGate` / `ModuleGate` (table `org_features`) | `src/App.tsx:1633-1643`, `src/hooks/useModuleAccess.ts` |
| Confirmation / dialogues | `confirmer()` impératif (pas de `confirm()` natif — interdit par test) | `src/components/ui/ConfirmDialog.tsx` |
| Normalisation E.164 | Fonction existante… mais **jamais appelée à l'ingestion** (câblée SMS uniquement) | `server/lib/helpers.ts:382-388` |
| Scoring de doublons | `scoreClientDuplicate()` (courriel exact 95, téléphone 90, nom+adresse) — **utilisé seulement à l'import**, pas au formulaire | `server/lib/migration/duplicates.ts:34` |
| Fusion de clients | RPC transactionnel `fusionner_clients(p_org, p_garder, p_absorber)` | outil `merge_clients`, `tools-etendus.ts:2566` |
| Permissions | `leads.create/read/update/delete/assign` existent déjà | `src/lib/permissions.ts:50` |
| Déclencheur de changement d'étape | **`pipeline_deal.stage_changed` existe et est émis**, avec `old_stage`/`new_stage` dans `metadata` | `eventBus.ts:16`, `automation-events.ts:321-372` |

---

## 2. L'existant à remplacer — état des lieux précis

### 2.1 `pipeline_deals` (126 lignes)

30 colonnes, dont des doublons (`value` **et** `value_cents`) et des vestiges
(`stage_id uuid` **sans aucune FK** — il n'existe aucune table de stages).

**Les 5 étapes sont figées dans une contrainte CHECK** :
`pipeline_deals_stage_check → stage IN ('new_prospect','no_response','quote_sent','closed_won','closed_lost')`.

C'est **le vrai morceau du chantier**, pas la table `deals` elle-même. Ces
5 slugs sont recopiés dans au moins six endroits qui doivent rester cohérents :

1. la CHECK en base ;
2. `clients.lead_status`, alimenté par le trigger `sync_lead_stage_from_deal()` ;
3. `src/lib/pipelineApi.ts:6-23` (`stageToDbSlug`, alias legacy) ;
4. `src/lib/d2d-pipeline-stages.ts` (vocabulaire UI **différent** : `new_lead`, `must_recall`) ;
5. `server/lib/agent/tools-leads.ts:36-58` (`versEtape`, ~30 alias FR/EN) ;
6. les `enum` de `tools-d2d-formations.ts`, **testés contre la CHECK** (`tests/lumi-outils-d2d-formations.test.ts:140`).

Des étapes renommables par le client cassent ce chaînage. C'est le cœur du risque.

**Trois écrivains aux sémantiques divergentes** :

| Chemin | Émet un événement ? | Synchronise `clients.lead_status` ? |
|---|---|---|
| RPC `set_deal_stage` (9 appelants) | oui | oui (trigger) |
| `update_d2d_pipeline_item` (outil MCP) | **non** | oui (trigger) |
| `POST /leads/update-status` | oui | oui (direct) |

**Deux crons suppriment des deals en continu** — à connaître avant de bâtir des stats historiques :

- `cleanup-expired-pipeline-deals` (**toutes les heures**) : soft-delete les `closed_won` après **2 jours** et les `closed_lost` après **15 jours** ;
- `cleanup_lost_pipeline_deals_daily` (03:00).

Autrement dit : **aujourd'hui, l'historique des deals gagnés est effacé au bout de 48 h.**
Les stats de Phase 6 (cohortes, entonnoir, cycle) sont impossibles tant que ça tourne.

### 2.2 Tables réellement mortes (à dropper sans risque)

| Table | Lignes | Accès dans le code |
|---|---|---|
| `pipelines` | 2 | **aucun** (vérifié : `from('pipelines')` → 0 résultat). 3 colonnes, scopée `user_id`, **pas de `org_id`** |
| `contacts` | 21 | **aucun** (`from('contacts')` → 0 résultat). Alimentée par un trigger seul |
| `lists` | 0 | — (pas de `org_id` non plus) |
| `lead_lists` | 0 | policy `deny_all` |

→ La table `pipelines` du plan **n'est pas à étendre : elle est à jeter**. Elle n'a
jamais servi et n'est pas multi-tenant.

### 2.3 Dépendances D2D

Le D2D n'est **pas** un module séparable : `pipeline_deals.pin_id`, `rep_id`,
`d2d_status` sont des colonnes du deal lui-même, et `field_house_profiles`
(158 lignes) / `field_pins` (148) sont liées aux `clients` par triggers
(`ensure_field_pin_for_client`, `sync_field_pin_from_client`). La gamification
`fs_*` est vide (0 ligne partout sauf `fs_commission_entries` = 36).

---

## 3. Le moteur d'Automatisations — verdict sur la modularité

**Bonne nouvelle : la base ne bloque rien.** `automation_rules.trigger_event` est
un `text` libre — **aucun CHECK, aucun enum** (`SCHEMA_SNAPSHOT.md:6659-6663`).
`stage_entered` serait accepté immédiatement.

**Les verrous sont en TypeScript**, et ils sont surmontables :

1. `CRMEventType` (`eventBus.ts:11-38`) — union fermée, à étendre ;
2. `EVENT_TO_ACTIVITY` (`eventBus.ts:52-80`) — **c'est lui qui pilote `onAnyEvent`** :
   un type absent de ce `Record` n'est jamais écouté, même s'il est déclaré ;
3. le matching ne filtre que sur `org_id + trigger_event + is_active`
   (`automationEngine.ts:418-423`) — un scoping `pipeline_id`/`stage_id`
   **indexable** exige d'ajouter des colonnes et de modifier cette requête.

**Trois manques réels par rapport au plan :**

| Le plan demande | État | Coût |
|---|---|---|
| Déclencheur `stage_entered` / `stage_exited` | `pipeline_deal.stage_changed` existe déjà et porte `old_stage`/`new_stage` | faible — dériver les deux depuis l'existant |
| Déclencheur `stage_idle` (X jours sans activité) | **N'existe pas.** Aucun déclencheur temporel générique ; seul `detectOverdueInvoices` est codé en dur | moyen — à bâtir dans le tick de 5 min, avec sa propre dédup persistante |
| « Un seul moteur, une seule exécution, un seul log » | Atteignable — mais l'idempotence **n'existe que sur le chemin différé** (`delay_seconds > 0`). À `delay_seconds = 0`, aucune clé, aucune dédup : deux émissions = deux envois | moyen |

**Catalogue d'actions réel** (`server/lib/actions/index.ts:184-192`) — 7 actions utiles :
`send_email`, `send_sms`, `create_notification` (+ alias `send_notification`),
`create_task`, `update_status`, `request_review`, `log_activity`.

L'action « attendre X jours puis déplacer vers une étape » du plan **n'existe pas** :
il n'y a ni action « déplacer vers une étape », ni action « attendre » dans la
séquence (le délai est un champ **de la règle**, un seul par règle). Conformément à
la règle de modularité du plan, je les proposerais comme **nouvelles actions du
moteur global** (`move_to_stage`, et éventuellement `assign_user`), pas comme
exceptions du pipeline — d'autant que l'UI affiche déjà des libellés pour
`add_tag` et `assign_user` **qui n'existent pas côté moteur** (`Automations.tsx:308-322`).

**L'UI d'Automatisations est codée en dur**, pas dérivée du catalogue : quatre
tables statiques (`PRESET_META`, `TRIGGER_DISPLAY`, `getActionLabel`,
`AUTOMATION_NAME_FR`). Une règle de pipeline **fonctionnerait** sans y toucher,
mais s'afficherait avec son déclencheur brut, sans icône, rangée dans « Follow-up ».
Et l'UI ne permet **ni de créer, ni de supprimer une règle** — seulement d'activer,
désactiver et réécrire un message. Le plan suppose l'inverse (« attacher,
réordonner, déplacer, désactiver » depuis les réglages du pipeline) : **cette UI
d'édition de règles est à construire entièrement**.

---

## 4. Ingestion — ce qui manque vraiment

Le chemin actuel (`POST /api/public/form/:apiKey/submit`,
`server/routes/request-forms.ts:381-800`) fait déjà, en 11 étapes : honeypot,
résolution d'acteur, INSERT `clients`, marquage lead, INSERT `pipeline_deals`
(avec rollback du client si échec), pin cartographique, INSERT `form_submissions`,
notification, courriel exploitant + accusé visiteur, puis `eventBus.emit('lead.created')`.

**Ce qui manque pour le plan :**

1. **Attribution marketing : zéro.** `utm_source`, `utm_medium`, `utm_campaign`,
   `utm_content`, `fbclid`, `gclid` — **0 occurrence dans tout le projet**.
   Tout est à construire (capture côté page publique, stockage, propagation).
   La décision n°8 (« seul changement : le handler lit les UTM ») sous-estime :
   il faut aussi que le **formulaire public transmette** ces valeurs, donc y toucher
   un minimum, contrairement à « ne PAS toucher aux champs du form ».
2. **Déduplication : volontairement absente** (voir constat E). Ta décision n°4
   la réactive en sens inverse d'une décision produit documentée.
3. **`clients.phone` n'est pas normalisé** : la saisie brute est stockée. Un merge
   « sur téléphone E.164 » suppose d'abord de normaliser à l'écriture, et de
   décider du sort des 931 lignes existantes.
4. **Aucun test de bout en bout** du formulaire public (ni de `/api/leads/create`).
5. Il n'y a **pas de fonction d'ingestion unique** : la création manuelle passe par
   `POST /api/leads/create`, le formulaire par sa propre route. Le `ingest_lead()`
   du plan est une vraie unification à écrire.

---

## 5. Recommandation sur « le contact »

**Recommandation : ne pas créer d'entité contact. Le contact, c'est `clients`.**

Motifs :

1. Le projet a **déjà tranché** en supprimant la table `leads` au profit de
   `clients` + `status='lead'`, avec 12 colonnes migrées et une stratégie
   explicite de « churn minimal » (les ~30 points de code lisant `lead_id`
   continuent de marcher, `lead_id` contenant désormais un id de **client**).
2. `contacts` existe (21 lignes) mais **aucun code ne la lit ni ne l'écrit** :
   elle est alimentée par un seul trigger. La ressusciter, c'est créer une
   troisième identité concurrente.
3. La règle « un contact, plusieurs deals » est satisfaite telle quelle :
   `pipeline_deals.lead_id → clients(id)` est déjà une relation N-1.

Conséquence : la nouvelle table `deals` porte `client_id uuid NOT NULL`
(+ FK composite `(org_id, client_id)`), et `clients` reste la source d'identité.

---

## 6. Décisions prises (2026-09-23)

Arbitrage du propriétaire. Ces réponses sont désormais des contraintes du chantier.

| # | Question | Décision |
|---|---|---|
| **Q1** | Forfait et route | Le pipeline est inclus dans **Scale** (slug réel : `pro`, 347 $/mois) **et Autopilot** (495 $). Pas dans Minimum (`starter`). Nouveau drapeau de forfait à créer : `includes_pipeline`. |
| **Q2** | Le D2D survit-il ? | **Le pipeline D2D est supprimé.** La Vente Map, le Classement et les Commissions **restent** (Autopilot). Conséquence assumée : les pins de la carte (`pin_id`) et le calcul des commissions (basé sur les deals gagnés) sont **rebranchés sur le nouveau pipeline**, sinon ils cassent. |
| **Q3** | Purge automatique des deals | **Arrêtée.** Les crons `cleanup-expired-pipeline-deals` (horaire) et `cleanup_lost_pipeline_deals_daily` ne s'appliquent pas au nouveau modèle. Gagnés et perdus sont conservés **indéfiniment** (c'est l'historique de ventes). Le board reste propre par **filtrage d'affichage**, jamais par effacement. |
| **Q4** | Déduplication | **Confirmée.** Merge sur téléphone normalisé E.164 **ou** courriel en minuscules, dans la même org. Inverse la décision du 2026-07-07 — choix conscient du propriétaire. Implique de normaliser `clients.phone` à l'écriture. |
| **Q5** | Montant sur le deal | **Pas de montant.** La valeur vient de la job liée. On accepte de perdre `avg_deal_value_cents` (`rpc_insights_pipeline_velocity`) et la somme par colonne du board actuel. |
| **Q6** | Mécanique d'exécution | **Délégué à l'agent — option (a) retenue : vraie file d'événements en base.** Un trigger SQL sur le changement d'étape écrit dans une table d'événements, consommée par le tick de 5 min existant. Motif : une transition faite par Lumi, un import, le mobile ou du SQL doit déclencher les actions d'étape au même titre qu'un glisser-déposer dans le navigateur ; et rien n'est perdu si le serveur redémarre. Corrige au passage une faiblesse connue et documentée du moteur (`AUTOMATIONS_AUDIT.md:97`). |

### Décisions complémentaires (2026-09-23, 2e passe)

| # | Question | Décision |
|---|---|---|
| **Q7** | Qui voit les statistiques | **Propriétaire et admin seulement**, via la permission existante `financial.view_analytics`. Un vendeur ou technicien voit le Board (ses deals et ceux de l'équipe) mais ni l'onglet Statistiques, ni Workflows, ni Réglages. Cohérent avec la page Statistiques actuelle — rien de nouveau à inventer. |
| **Q8** | Facturation | **Nouveau drapeau `includes_pipeline`** sur `plans`, vrai pour `pro` (Scale, 347 $) et `autopilot` (495 $), faux pour `starter`. Volontairement distinct de `includes_automations` pour garder un levier de prix indépendant. |
| **Q9** | Priorité des cartes | **Calculée sur l'inactivité**, jamais saisie : 14 j+ = Urgent, 5-13 j = Moyen, moins de 5 j = Frais. Aucune colonne stockée — une priorité manuelle se périme en silence et fausse les statistiques. |

### Constructeur de workflows — cadrage (analyse Salesforce / GoHighLevel)

Analyse faite le 2026-09-23. **Salesforce Flow Builder** : puissance sans garde-fous, modifiable directement en production, flux « à des centaines d'éléments », administrateurs dédiés obligatoires. **GoHighLevel** : 30+ déclencheurs et 60+ actions ; leur propre documentation admet que « vouloir maîtriser les 30+ déclencheurs d'un coup est la raison n°1 pour laquelle les gens abandonnent ».

Position retenue pour Lume — **trois paliers**, seuls les deux premiers en Q4 :

1. **Recettes** (tout le monde) : cartes prêtes à l'emploi, on ajuste le texte et on active.
2. **Les 4 blocs** (Quand / Si / Attendre / Alors) : le constructeur, avec une **phrase de relecture en français** sous les blocs — si l'automatisation ne se relit pas en une phrase, elle est trop compliquée.
3. **Avancé** (plusieurs attentes, branches) : **hors Q4.** C'est le piège Salesforce ; on ne l'ouvre qu'après avoir vu des clients bloqués au palier 2.

Garde-fous que Salesforce n'a pas, à intégrer : la phrase de relecture, un **mode test avant activation** (s'envoyer le message à soi-même), un **plafond de 5 actions** par workflow, et le journal d'exécution déjà visible dans la fiche du deal.

**Mesure de référence (staging, 2026-09-23) : 461 règles, dont 455 presets et seulement 6 créées à la main.** Personne ne crée d'automatisation aujourd'hui — l'interface ne le permet pas. Le constructeur du pipeline est le test : s'il sert, on généralise avec une preuve.

### Lot différé — « Éditeur d'automatisations, généralisation »

**Après la Phase 7**, condition d'entrée : que le constructeur du pipeline ait tourné en production. La page Automatisations actuelle ne permet ni de créer ni de supprimer une règle ; elle deviendra la vue d'ensemble, branchée sur le même éditeur. Les 396 règles actives en production ne doivent rien voir changer. Les 3 ajouts au moteur (action « déplacer vers une étape », déclencheur « stagne depuis X jours », conditions `gt`/`lt`) sont faits **dans** le chantier pipeline, car il en a besoin — et profitent immédiatement à toute l'app.

### Conséquences directes sur les phases

- **Phase 2** : ajouter le drapeau `includes_pipeline` sur `plans` (true pour `pro` et `autopilot`) ; prévoir la table d'événements (Q6) ; aucune colonne de montant sur `deals` (Q5).
- **Phase 3** : le drop de `pipeline_deals` doit **réattacher** `field_pins` et le moteur de commissions au nouveau modèle (Q2) — c'est la partie la plus délicate du nettoyage, à faire avant le drop, pas après.
- **Phase 4** : dédup + normalisation E.164 à l'écriture (Q4), avec décision à prendre sur les 931 `clients` existants dont le téléphone n'est pas normalisé.
- **Phase 6** : les stats peuvent enfin remonter dans le temps (Q3).

## 7. Phases révisées

Inchangées dans l'esprit ; corrigées sur les faits. **STOP + rapport après chacune.**

- **Phase 0 — Audit.** ✅ Fait. Ce document.
- **Phase 1 — Artefact UI, zéro backend.** Mocks réalistes, composants et tokens
  existants, FR/EN, responsive iPad. Route derrière un flag `org_features`
  (`module_pipeline_ventes`), **sur une route à décider en Q1**. Board, drawer,
  popup Gagné, modal Perdu, réglages d'étapes/actions, onglet Statistiques,
  branchement Ventes — tout en mock.
- **Phase 2 — Schéma.** ✅ **LIVRÉE (staging).** 3 migrations, appliquées et
  éprouvées sur staging le 2026-09-23 — **la prod n'est pas touchée** :
  - `20260923100000_pipeline_ventes_schema.sql` — `pipelines_ventes`,
    `pipeline_stages`, `deals`, `deal_stage_history` ; `org_id`, RLS forcée,
    FK composites `(org_id, id)` partout ; aucun montant (Q5), aucune priorité
    (Q9) ; `pin_id`/`field_rep_id` prévus pour le rebranchement D2D (Q2).
  - `20260923100100_pipeline_moteur_et_forfait.sql` — `pipeline_id`/`stage_id`
    sur `automation_rules` (nullables : les 461 règles existantes ne changent
    pas), table `pipeline_events` (file d'événements, Q6), fonction
    `pipeline_detecter_stagnation()`, drapeau `includes_pipeline` (Q8).
  - `20260923100200_pipeline_arret_purges.sql` — déplanifie les 2 crons de
    purge (Q3) ; les fonctions restent pour un ménage manuel.

  **Preuves (staging, SQL réel) : 13 tests sur 13.** Historique et événements
  écrits par la base à chaque mouvement ; `won_at`/`lost_at` posés seuls ;
  `lost_from_stage_id` retient l'étape d'avant ; `first_contacted_at` figé ;
  archivage refusé si des deals restent ou s'il ne resterait aucune étape du
  type ; ingestion idempotente ; **isolation inter-organisations vérifiée**
  (étape et client d'une autre org refusés). `check:broken-objects` et
  `check:db-coherence` au vert.

  Reste à faire ici : ~~schéma~~ → le **seed** des presets est en Phase 3.

- **Phase 2 (référence d'origine) — Schéma.** `org_id` (pas `tenant_id`), FK composites, `pipeline_stages`
  avec `kind open|won|lost`, `deals` sans montant, `deal_stage_history`.
  Décision à documenter : colonnes de scoping sur `automation_rules`
  (`pipeline_id`, `stage_id`) + nouveaux déclencheurs.
- **Phase 3 — Seed + nettoyage.** Presets Nettoyage/Construction. Dump SQL **avant**
  tout drop. Le drop de `pipeline_deals` n'est possible qu'après avoir traité
  ses 5 triggers externes, ses 2 crons, ses 2 vues, ses 14 fonctions et ses
  3 écrivains.
- **Phase 4 — Ingestion.** `ingest_lead()` unique. Capture UTM/fbclid (tout à bâtir).
  Dédup selon Q4. Normalisation E.164 à l'écriture.
- **Phase 5 — Branchement.** Historique à chaque transition. Émission des événements
  selon Q6. Idempotence à ajouter sur le chemin immédiat. Outils Lumi/MCP mis à jour
  (les 3 écrivains actuels à unifier).
- **Phase 6 — Statistiques + Ventes.** RPC par bloc, **SECURITY INVOKER**, `org_id`
  dérivé de la session. Attention : les 13 RPC `rpc_insights_*` existants sont
  tous **SECURITY DEFINER** — le plan impose INVOKER, donc on ne les imite pas
  sur ce point, c'est délibéré et plus sûr.
- **Phase 7 — Tests CI bloquants.** Y compris : renommer une étape ne change aucun
  comportement ; les 3 chemins vers Gagné ; concordance Ventes ↔ Statistiques.

---

## 8. Risques ouverts

| Risque | Gravité | Note |
|---|---|---|
| Les 5 slugs d'étapes vivent dans 6 endroits couplés, dont un trigger vers `clients.lead_status` et les pins de la Vente Map | **élevé** | C'est le vrai coût du chantier, pas la table `deals` |
| Pas d'outbox : événements perdus au redémarrage, et invisibles hors navigateur | **élevé** | Q6 |
| Purge horaire des deals gagnés (48 h) incompatible avec les stats historiques | **élevé** | Q3 |
| `pipeline_deals` a 3 écrivains divergents, dont un sans événement | moyen | À unifier en Phase 5 |
| Aucune idempotence sur le chemin `delay_seconds = 0` | moyen | Le plan l'exige (Phase 7) |
| RLS `automation_rules` : tout membre peut écrire une règle via PostgREST (le garde-fou est purement UI) | moyen | Signalé, hors scope — à confirmer si on veut le corriger au passage |
| Zéro test e2e du formulaire public | moyen | À couvrir en Phase 7 |
| Une seule main à la fois sur le schéma (règle CLAUDE.md) | — | Vérifier qu'aucune autre session ne touche la DB avant la Phase 2 |
