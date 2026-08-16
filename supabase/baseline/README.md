# Baseline — recréer la base de zéro

**Les 400 fichiers de `supabase/migrations/` ne reconstruisent PAS la base.**
L'historique est incomplet : des tables ont été créées à la main dans le
dashboard avant que les migrations existent, d'autres ont été supprimées
depuis. Rejouer les migrations sur une base vide échoue dès la deuxième
(vérifié le 2026-08-03). C'est pour ça que le projet staging a dû être cloné
par copie de la prod plutôt que reconstruit.

Ce dossier est la **source de vérité** pour créer un environnement neuf.

## Contenu

| Fichier | Contient | Généré depuis |
|---|---|---|
| `01_schema.sql` | schémas `public`, `app`, `archive` : 199 tables, 11 vues, 306 fonctions, 537 policies, contraintes, index, triggers, privilèges | `pg_dump` de la prod, 2026-08-03 |
| `02_post_schema.sql` | ce que `pg_dump` ne contient pas : extensions, 5 buckets + leurs 17 policies, publication temps réel (20 tables), 10 tâches `pg_cron`, trigger de création de compte sur `auth.users` | catalogue de la prod, 2026-08-03 |

Oublier `02` donne un environnement qui **a l'air** correct mais où les
fichiers, le temps réel et les jobs de fond ne fonctionnent pas.

## Créer un nouvel environnement

1. Créer le projet sur supabase.com (même région que la prod).
   Cocher *Enable Data API* et *Automatically expose new tables*.
   **Ne pas** cocher *Enable automatic RLS* : la prod ne l'a pas, et l'activer
   crée un event trigger qui fait diverger le comportement des migrations.
2. Mettre `SUPABASE_PROJECT_REF` (dans `.env.local`) sur le nouveau projet.
3. `npm run db:bootstrap`
4. Vérifier : `npm run db:diff` doit annoncer des schémas identiques.
5. Config d'authentification (hors SQL) : URLs de redirection, providers OAuth,
   `mailer_autoconfirm` pour un environnement de test. Se copient depuis la prod
   via l'API de gestion (`/v1/projects/<ref>/config/auth`).

## Ce qui est prouvé, ce qui ne l'est pas

- ✅ `01_schema.sql` a été **rejoué avec succès sur un PostgreSQL 17 vierge**
  (Docker) le 2026-08-03 : 199 tables, 11 vues, 306 fonctions, 537 policies
  créées, zéro erreur. Les compteurs correspondent exactement à la prod.
- ✅ `02_post_schema.sql` : buckets, policies de stockage et publication temps
  réel validés sur cette même base vierge (5 / 17 / 20, identiques à la prod).
- ⚠️ Les extensions `pg_cron`, `pg_net` et `supabase_vault` — donc les 10 tâches
  planifiées — **ne peuvent pas être testées hors Supabase**. Elles ont été
  créées avec succès sur le projet staging le 2026-08-03, par ce même SQL.
- ⚠️ Aucune **donnée** n'est incluse, sauf la table de référence `plans` qui,
  elle, doit être copiée depuis la prod (sinon aucun abonnement n'est possible).
  Pour peupler un environnement de test : `node scripts/qa-seed.mjs`.

## Maintenance

Régénérer ce dossier après tout changement structurel important :

```bash
docker run --rm -e PGPASSWORD="$SUPABASE_DB_PASSWORD" -v "$PWD/supabase/baseline:/out" postgres:17 \
  pg_dump -h aws-1-ca-central-1.pooler.supabase.com -p 5432 \
  -U postgres.<ref_prod> -d postgres --schema-only --no-owner \
  -n public -n app -n archive -f /out/01_schema.sql
```

Puis retirer du dump les lignes refusées sur un projet neuf :
`ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin`, `CREATE SCHEMA public`,
`COMMENT ON SCHEMA public`, et les marqueurs `\restrict` / `\unrestrict`.
