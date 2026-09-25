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
| `01_schema.sql` | les 10 extensions (en tête : le schéma en dépend), puis schémas `public`, `app`, `archive` : 254 tables, 15 vues, 407 fonctions, 675 policies, 263 triggers, contraintes, index, privilèges | `pg_dump` de la prod, 2026-09-25 |
| `02_post_schema.sql` | ce que `pg_dump` ne contient pas : trigger de création de compte sur `auth.users`, 7 buckets + leurs 13 policies, publication temps réel (20 tables), 10 tâches `pg_cron` | catalogue de la prod, 2026-09-25 |

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

- ✅ **Rejoué de bout en bout le 2026-09-25** sur un conteneur vierge de l'image
  Supabase `public.ecr.aws/supabase/postgres:17.6.1.167` : `01` puis `02`,
  **zéro erreur** ; la base obtenue compte exactement ce que compte la prod
  (254 tables, 15 vues, 407 fonctions, 675 policies, 7 buckets, 13 policies de
  storage, 10 tâches, 20 tables temps réel). Deux objets créés sur un vrai projet
  par les services Supabase (pas par l'image) ont été ajoutés au conteneur avant
  le rejeu : `auth.jwt()` (service d'authentification) et les tables
  `storage.buckets` / `storage.objects` (service de stockage).
- ⚠️ Aucune **donnée** n'est incluse, sauf la table de référence `plans` qui,
  elle, doit être copiée depuis la prod (sinon aucun abonnement n'est possible).
  Pour peupler un environnement de test : `node scripts/qa-seed.mjs`.

## Maintenance

Régénérer ce dossier après tout changement structurel (lecture seule de la prod) :

```bash
node --env-file=.env.local scripts/regenerer-baseline.mjs
```

Prérequis : Docker, et dans `.env.local` `SUPABASE_DB_PASSWORD` (mot de passe
Postgres **prod**), `SUPABASE_PROJECT_REF_PROD`, `SUPABASE_ACCESS_TOKEN`. Le script
retire les lignes qu'un projet neuf refuse, place les extensions en tête de `01`,
relit `02` dans le catalogue, et refuse d'écrire une tâche `pg_cron` qui ressemble
à un secret.
