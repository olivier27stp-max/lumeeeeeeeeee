# Revue des migrations proposées (coordinateur, 2026-10-02 ≈ 12:00 UTC)

Lecture seule, contre la pile locale. Rien n'est appliqué à staging ni à la prod.
À refaire sur la version FINALE de chaque fichier quand M et S ont rendu.

| Fichier | Ce qu'elle fait | Touche des données de vrais bureaux ? | Remarques de revue |
|---|---|---|---|
| M-01 `automation_rules.activee_le` | colonne + trigger qui date le passage à actif ; reprise : `activee_le = updated_at` pour les règles déjà actives | OUI (une colonne remplie sur chaque règle active ; rien retiré) → à montrer à Rafba | (1) ajouter `revoke all on function automation_rules_dater_activation() from public, anon, authenticated` (cohérence : elle garde l'ACL par défaut) ; (2) la reprise coupe `trg_automation_rules_updated` le temps de l'UPDATE : verrou court, acceptable ; (3) reprise par `updated_at` = jamais rétroactif, et rien de perdu : un cas franchi avant aurait déjà déclenché. |
| M-02 note ajoutée / tâche terminée par la base | deux triggers qui écrivent dans `automation_evenements_base` | Non (aucune donnée modifiée ; change ce qui déclenche à partir du déploiement) | (1) vérifier au catalogue les colonnes citées (`tasks.linked_entity_type`, `linked_entity_id`, `job_id`, `specific_notes.entity_type/entity_id/text`) et la signature à 8 arguments de `automation_consigner_evenement` ; (2) le serveur doit écarter le doublon avec l'événement du navigateur (dit fait dans `evenementsBase.ts`) → le prouver par un test ; (3) variante `M-02_LOCAL…` : ne JAMAIS l'appliquer ailleurs. |
| M-03 `fusionner_clients` + relances en attente | la relance suit la fiche gardée, sinon s'arrête avec `fiche_fusionnee` | Non au déploiement (agit seulement lors d'une fusion) | (1) comparer le corps « d'avant » avec la PROD (md5 local avant M-03 vs prod) avant d'appliquer ; (2) l'étape 1 réécrit `execution_key` : envelopper dans `begin … exception when unique_violation` (index `idx_scheduled_tasks_dedup`) pour qu'un conflit rare n'annule pas TOUTE la fusion — la tâche tombe alors à l'étape 2 (arrêtée avec motif). À demander à M. |
| M-04 rendez-vous déplacé par la base | trigger sur `schedule_events` | Non | `WHEN (old.start_at is distinct from new.start_at)` : correct. Vérifier `schedule_events.status` et la valeur `'cancelled'` au catalogue. |
| M-05 opportunité qui se rendort | clé d'unicité + jour de la dernière activité, `not exists` sur l'ancienne clé | Non (aucune alerte ré-émise au déploiement : c'est prouvé par M24-01 à 03) | comparer le corps « d'avant » avec la PROD ; `revoke` présent. |
| S-01 statistiques en base | cinq fonctions SECURITY INVOKER | Non | ACL vérifiée en local : `authenticated` + `service_role` seulement, pas `anon`. À faire : EXPLAIN sur un bureau de 3 000 lignes (local) avant la prod — la base de prod est petite (2 Go). |
| S-02 historique des modifications | table neuve + purge 12 mois dans `run_retention_logs()` | Non (table neuve ; aucune durée existante ne change) | (1) la FK `(org_id, rule_id)` s'appuie sur `automation_rules_org_id_id_uq` : présent ; (2) `run_retention_logs()` est REDÉFINIE : comparer le corps « d'avant » avec la PROD au mot près avant d'appliquer. |
| S-03 `anonymize_client` + journaux | l'effacement d'un client nettoie aussi les journaux d'automatisation, la file et le bac à sable | Non au déploiement (agit lors d'une demande d'effacement) ; fonction de CONFORMITÉ → à montrer à Rafba | comparer le corps « d'avant » avec la PROD ; S signale `messages`, `email_deliveries`, `activity_log` hors domaine, non traités. |
| (à écrire) durcissement | `revoke insert, update, delete on automation_rules from authenticated, anon` | Non (droits) ; mais casse tout écrivain oublié → code déployé AVANT | voir `DURCISSEMENT-ecritures.md`. |
| (P6) unification `steps` / `actions` | réécrit les règles à plat des vrais bureaux | OUI → essai à blanc par bureau, attendre l'accord | — |

## Ordre prévu
local (déjà) → staging → `check:broken-objects`, `check:db-coherence`, `check:schema-refs` → prod, une à une.
Numérotation : `202610080000NN_…` (après la garde 20261007300000), M puis S puis durcissement.
Après : `scripts/regenerer-baseline.mjs`, `SCHEMA_SNAPSHOT.md`, `db:diff` à zéro.
