# S4 — Intégrité des données (prod, lecture seule)

- **Projet** : `bbzcuzqfgsdvjsymfwmr` (production)
- **Horodatage** : 2026-07-31 ~01:45 UTC / 2026-07-30 ~21:45 EDT
- **Méthode** : `HEAD` + `count=exact` (aucune donnée transférée) et `GET` sur
  colonnes non sensibles. Les valeurs servant à détecter les doublons ont été
  **hachées dans le script** : elles n'apparaissent nulle part.
- **Aucune écriture émise. Aucune donnée client dans ce document.**

---

## 1. Le constat qui conditionne la lecture de tout le reste

**La base de production est quasi vide, et son jeu de données n'exerce presque
pas le multi-tenant.**

| Mesure | Valeur |
|---|---|
| Tables/vues exposées via l'API REST | **229** |
| Dont **totalement vides** | **113** (49 %) |
| Peuplées | 116 |
| **Total de lignes, toutes tables confondues** | **8 354** |

Répartition des données métier par organisation :

| Table | Lignes | Orgs concernées | Plus grosse org | Distribution |
|---|---|---|---|---|
| `clients` | 66 | 14 | 53 | 53, puis **13 orgs à 1 client** |
| `jobs` | 34 | **1** | 34 | 34 |
| `invoices` | 13 | 2 | 12 | 12, 1 |
| `quotes` | 16 | 2 | 15 | 15, 1 |
| `payments` | 3 | **1** | 3 | 3 |

Pour mémoire : la base compte **31 organisations**. Donc 17 orgs n'ont même pas
un client, et une seule org porte l'essentiel de l'activité.

### Conséquence méthodologique — à ne pas escamoter

Les résultats parfaits de S2 (`check_cross_tenant_references` = 0 violation,
`check_invoice_totals_balance` = 0, `check_invoice_numbering_invariant` = 0)
**ne prouvent pas que le modèle est sain**. Ils prouvent que *ces données-là* ne
contiennent pas d'anomalie — or :

- `jobs` et `payments` n'existent que dans **une seule org** : un contrôle de
  référence croisée entre orgs sur ces tables ne peut structurellement rien
  trouver ;
- `invoices` et `quotes` s'étalent sur 2 orgs dont l'une n'a qu'une ligne : la
  numérotation de factures par org n'a jamais été mise sous contrainte de
  concurrence ;
- 113 tables vides n'ont **jamais rien exercé** : ni leurs contraintes, ni leurs
  policies, ni leurs triggers.

**Ce qui protège réellement la prod aujourd'hui, ce sont les contraintes et les
policies, pas l'évidence empirique.** L'absence de dégâts constatés est
attendue sur un jeu de données de cette taille ; elle ne doit pas être lue
comme une validation du schéma.

---

## 2. Doublons métier détectés

Calculés par hachage, sur l'intégralité des lignes existantes.

| Contrôle | Lignes examinées | Groupes en doublon | Lignes impliquées | Gravité |
|---|---|---|---|---|
| `clients (org_id, email)` | 66 | **1** | 2 | P3 |
| `clients (org_id, phone)` | 66 | **2** | 5 | P3 |
| `invoices (org_id, invoice_number)` | 13 | 0 | 0 | ✅ |

**Lecture** : sur 66 clients, 7 lignes participent à un doublon d'identité au
sein d'une même org, soit **~10 % de la base clients**. Les valeurs `NULL` ou
vides ont été exclues du calcul, ce ne sont donc pas des faux positifs.

C'est cohérent avec l'historique du schéma : la contrainte d'unicité sur l'email
client a été **retirée délibérément** (migration `allow_duplicate_emails`), et
la déduplication a été déplacée dans la fonction
`create_client_with_duplicate_handling`. Cette fonction sélectionne un candidat
avec `select … limit 1 for update` : **deux insertions concurrentes sur le même
email créent deux clients**, ce que le taux observé rend plausible.

- **Réparable par requête ?** Non. Fusionner deux fiches clients engage des
  jobs, devis, factures et paiements rattachés : c'est une **décision métier**,
  pas un `UPDATE`. Aucune requête de réparation n'est proposée ici (S6).

---

## 3. Invariants d'intégrité vérifiés en base

Résultats obtenus en S2, rappelés ici car ils appartiennent au périmètre S4.
Tous exécutés en lecture seule sur la prod.

| Invariant | Résultat | Valeur probante (compte tenu du §1) |
|---|---|---|
| Références cross-tenant (toutes FK) | **0 violation** | **Faible** — `jobs`/`payments` mono-org, `invoices`/`quotes` quasi mono-org |
| Cohérence totaux de factures ↔ lignes | **0 violation** | Faible — 13 factures |
| Numérotation de factures | **0 collision** | Faible — jamais mise sous concurrence |
| Champs personnalisés orphelins | **0** | Nulle — `custom_column_values` est **vide** |
| Couverture RLS (activée + forcée + policy) | **0 manquement** | **Forte** — indépendant du volume de données |
| Crons en échec | **0** | Forte |
| Fonctions de trigger exposées | **0** | Forte |

> Les trois derniers contrôles portent sur la **structure**, pas sur les
> données : leur résultat est valable quel que soit le remplissage de la base.
> Ce sont les seuls dont on peut se prévaloir sans réserve.

---

## 4. Les 113 tables vides — surface d'attaque sans contrepartie

Chacune est **exposée via l'API REST publique**, avec ses policies et ses grants,
alors qu'elle ne contient rien. Une table vide n'est pas inoffensive : elle est
*écrivable* si ses policies le permettent, et elle n'a jamais été éprouvée.

Regroupement par domaine :

| Domaine | Exemples | Nb approx. |
|---|---|---|
| Sécurité / conformité **jamais alimentée** | `login_history`, `failed_login_attempts`, `active_sessions`, `security_alerts`, `security_incidents`, `incident_timeline`, `ip_blocklist`, `rate_limits`, `consents`, `dsar_requests`, `data_export_log`, `secret_rotation_log`, `api_keys`, `role_templates` | ~14 |
| Field Sales (`fs_*`, `field_*`) | `fs_challenges`, `fs_badges`, `fs_battles`, `fs_gps_points`, `field_pins`, `field_territory_assignments`… | ~20 |
| Notes / tableaux | `notes`, `note_boards`, `note_items`, `note_connections`, `board_votes`, `board_drawings`… | ~12 |
| Workflows / automatisations | `workflow_nodes`, `workflow_edges`, `workflow_runs`, `workflow_logs`, `automations`, `approvals` | ~8 |
| Paie / RH | `payroll_settings`, `payroll_payments`, `payroll_adjustments`, `time_off_requests`, `commission_settings` | ~6 |
| Paiements / facturation | `payment_providers`, `payment_provider_secrets`, `applied_taxes`, `recurring_invoice_schedules`, `invoice_send_events`, `job_billing_milestones` | ~7 |
| E-mail / campagnes | `email_campaigns`, `email_campaign_recipients`, `email_opt_outs`, `email_oauth_states` | ~5 |
| Divers produit | `bookings`, `booking_pages`, `geofences`, `job_templates`, `checklist_templates`, `tags`, `lists`, `goals`… | ~40 |

**Trois observations à retenir pour la mise en production :**

1. **`payment_provider_secrets` et `payment_providers` sont vides** : aucun
   fournisseur de paiement n'est configuré en base de production à cette heure.
2. **Toute la télémétrie de sécurité est vide** (`login_history`,
   `failed_login_attempts`, `active_sessions`, `security_alerts`,
   `security_incidents`, `ip_blocklist`). Ces tables existent et sont exposées,
   mais rien n'écrit dedans. En cas d'incident, **il n'y aura pas de trace**.
3. **`data_export_log` est vide** alors qu'une migration du 30 juillet
   (`N7.7 — journaliser les 4 derniers exports de données personnelles`) a été
   déployée pour l'alimenter. Soit la fonctionnalité n'a pas encore servi, soit
   la journalisation ne se déclenche pas. **INCONNU — à vérifier : exécuter un
   export de portabilité et confirmer qu'une ligne apparaît.**

À l'inverse, les tables les plus remplies indiquent ce qui tourne réellement :
`audit_events` (2 167), `tracking_points` (1 974), `activity_log` (665),
`tracking_events` (378), `automation_scheduled_tasks` (359).

---

## 5. Ce que S4 n'a PAS pu vérifier

Tous ces points exigent l'accès au catalogue Postgres (`pg_constraint`,
`pg_index`, `pg_attribute`, `information_schema`), **indisponible** faute de
`SUPABASE_ACCESS_TOKEN` ou de chaîne de connexion directe. Voir S2 §0 et §5.

| Contrôle prévu | Statut |
|---|---|
| Colonnes `*_id` sans clé étrangère | **NON VÉRIFIÉ** |
| Clés étrangères sans index | **NON VÉRIFIÉ** |
| Clause `ON DELETE` de chaque FK | **NON VÉRIFIÉ** |
| Tables sans clé primaire | **NON VÉRIFIÉ** |
| `timestamp` sans fuseau horaire | **NON VÉRIFIÉ** |
| Montants stockés en flottant | **NON VÉRIFIÉ** |
| Statuts en texte libre non contraints | **NON VÉRIFIÉ** |
| Uniques rendues inopérantes par les `NULL` | **NON VÉRIFIÉ** |
| Contraintes restées `NOT VALID` | **NON VÉRIFIÉ** |

> Ces neuf points ont fait l'objet de constats **sur le code source** lors de
> l'audit préparatoire (colonnes monétaires en triple sur `jobs`, `CHECK`
> contradictoires, index dupliqués, FK manquantes sur `org_id`). Ils ne sont pas
> confirmés **en base** : le code source lu est en partie périmé
> (`complete_schema.sql` accuse 121 migrations de retard). **Ne pas traiter ces
> constats comme établis avant vérification catalogue.**

---

## 6. Synthèse

| Constat | Gravité | Réparable par requête ? |
|---|---|---|
| 7 clients sur 66 (~10 %) en doublon d'identité intra-org | P3 | **Non** — décision métier (fusion de fiches) |
| Course concurrente possible sur la création de clients (dédup applicative, pas de contrainte) | P2 | Oui — index unique partiel, mais nécessite d'abord de résoudre les doublons existants |
| 113 tables vides exposées à l'API REST | P2 | Oui — retirer de l'exposition PostgREST |
| Télémétrie de sécurité entièrement vide (6 tables) | P2 | Non — code manquant, pas donnée manquante |
| `data_export_log` vide malgré la migration du 30/07 | P2 | À investiguer |
| Aucune violation d'invariant d'intégrité | ✅ | — |
| Aucune référence cross-tenant | ✅ (valeur probante faible) | — |
| Couverture RLS complète | ✅ (valeur probante forte) | — |
