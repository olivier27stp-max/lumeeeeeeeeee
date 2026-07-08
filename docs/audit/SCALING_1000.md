# Playbook de scaling — 0 → 1000 tenants

> But : garder la DB aussi sûre et rapide à 1000 clients qu'à 10. La **sécurité** scale déjà (RLS identique à toute échelle, testé + gate CI). Ce doc traite la **performance** et l'**ops**. Chaque item : impact, effort, risque, où l'appliquer.
>
> ⚠️ Règle d'or : **rien de ceci ne se YOLO en prod.** Ça touche le comportement ou le code app. Ordre = staging → test de charge → déploiement mesuré. Le gate CI RLS (`npm run test:rls`) valide qu'aucune étape ne réintroduit de fuite.

---

## LEVIER #1 — Optimiser les policies RLS (le plus gros gain) · effort L · impact 🔴🔴🔴

**Problème mesuré :** 492 policies sur 187 tables appellent `auth.uid()` **par ligne** + font un **JOIN vers `memberships`** pour résoudre l'org. À 1000 tenants × milliers de lignes, chaque `SELECT` re-scanne `memberships` → effondrement.

**Fix en 2 temps :**

**1a. Wrapper `auth.uid()` → `(select auth.uid())`** (comportement identique, éval une fois/requête).
- Sûr fonctionnellement (Postgres cache le scalaire), mais **muter 492 policies = gros blast radius** → générer, appliquer en staging, valider avec `test:rls` + un check "l'accès légitime est préservé".
- Gain : moyen. C'est le quick-win Supabase officiel.

**1b. Mettre `org_id` dans les custom claims du JWT** (le vrai gain).
- Aujourd'hui : `org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())` → sous-requête à chaque fois.
- Cible : `org_id = (auth.jwt() ->> 'org_id')::uuid` → **comparaison directe, zéro JOIN**.
- **Nécessite un changement app** : injecter `org_id` (et `role`) dans le JWT au login (Supabase Auth Hook / custom access token hook). Gérer le multi-org (claim = org actif, changé au switch de workspace).
- Gain : **énorme** (élimine le JOIN sur chaque requête de chaque table).
- Effort : M app + L migration policies. **C'est LA priorité scaling.**

---

## LEVIER #2 — Partitionner les tables à très gros volume · effort M/L · impact 🟠🟠

À 1000 tenants, ces tables grossissent sans limite (une ligne par ping GPS / événement) :
- `tracking_points`, `tracking_events`, `tracking_live_locations` (GPS terrain)
- `messages`, `audit_events`, `login_history`, `webhook_events`

**Fix :** partitionnement Postgres **par date** (`RANGE` mensuel) pour les tables temporelles → les vieilles partitions se DROP/archivent instantanément (rétention Loi 25 gratuite en bonus), et les requêtes récentes ne scannent qu'une petite partition.
- Migration en 2 temps (créer la table partitionnée, copier, basculer) — **downtime-aware**, staging obligatoire.
- Alternative plus simple d'abord : **index partiels** + job de purge (voir #4).

---

## LEVIER #3 — Index composites alignés sur les requêtes réelles · effort S/M · impact 🟠

`org_id` seul est indexé partout ✅. Mais à l'échelle, les requêtes filtrent `org_id + autre chose`. Ajouter (mesurer via `pg_stat_statements` d'abord, ne pas deviner) :
- `(org_id, status)` sur `jobs`, `quotes`, `invoices`
- `(org_id, created_at desc)` sur les listes paginées (`jobs`, `clients`, `invoices`)
- `(org_id, scheduled_at)` sur `schedule_events`
Retirer les index jamais utilisés (`pg_stat_user_indexes`, `idx_scan = 0`) — ils ralentissent les écritures.

---

## LEVIER #4 — Défense en profondeur : clés composites `tenant_id` · effort M · impact 🟠 (sécurité à l'échelle)

Aujourd'hui l'isolation repose **uniquement** sur les policies. À 1000 tenants, un seul bug de policy = fuite massive. Filet structurel :
1. `UNIQUE (org_id, id)` sur les parents (`clients`, `jobs`, `quotes`, `invoices`).
2. FK composites : `FOREIGN KEY (org_id, client_id) REFERENCES clients (org_id, id)` → **impossible structurellement** de lier une facture au client d'un autre org, même si une policy bugue.
- **Prérequis :** l'enfant doit porter `org_id` cohérent avec le parent (vérifier les données + que l'app le set). Appliqué à l'aveugle → inserts qui échouent. → staging + vérif de cohérence d'abord.

---

## LEVIER #5 — Connection pooling & Ops · effort S · impact 🟠

- **Pooling :** confirmer que l'app tape le **pooler transaction-mode** (port 6543), pas de state session-level, prepared statements compatibles. À 1000 clients, épuiser les connexions directes = panne.
- **Monitoring :** activer `pg_stat_statements`, alerter sur les requêtes > X ms et les seq scans sur tables tenant. Sans ça, tu découvres les lenteurs par les plaintes clients.
- **Backups :** PITR activé + **tester une vraie restauration** (complète ET d'un seul tenant). À 1000 clients, "on n'a jamais testé le restore" = roulette russe.

---

## LEVIER #6 — Résorber la dette qui empire à l'échelle · effort L · impact 🟡

- **Modèle « personne »** éclaté sur 4 tables (spec : `docs/schema-person-model-refactor.md`) → dérive de données amplifiée à l'échelle.
- Table `leads` fantôme + `lead_id` morts → nettoyer avant que ça se propage.

---

## Ordre d'exécution recommandé (sprints staging)
1. **Monitoring d'abord** (#5) — mesurer avant d'optimiser. `pg_stat_statements` + slow query log.
2. **JWT claims + wrapping policies** (#1) — le plus gros gain perf, validé par `test:rls`.
3. **Index composites** (#3) — guidés par les mesures du #1.
4. **Purge/rétention** puis **partitionnement** (#2/#4) des tables GPS/événements.
5. **Clés composites** (#4) — défense en profondeur.
6. **Dette schéma** (#6) — quand l'équipe a la bande passante.

## Ce qui reste vrai à 1000 comme à 10
Isolation RLS (testée + gate CI), argent en cents, timestamps tz, idempotence. **La sécurité ne se dégrade pas avec l'échelle** — c'est la perf qu'on optimise ici, pas la correction.
