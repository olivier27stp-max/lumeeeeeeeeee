#!/usr/bin/env bash
# ============================================================================
# clone-prod-to-staging.sh — recopie le SCHÉMA de la prod sur le staging.
#
#   npm run db:clone-staging
#
# Ce que ça fait :
#   1. dump du schéma de la PROD (public + app + archive)
#   2. remise à zéro des schémas côté STAGING
#   3. restauration du dump
#   4. réapplication de ce que pg_dump ignore (extensions, buckets + policies
#      storage, publication temps réel, tâches cron, trigger auth)
#   5. rechargement du cache PostgREST + vérification via db:diff
#
# ⚠️ DESTRUCTIF POUR LE STAGING : toutes les données de test sont perdues.
#    Repeupler ensuite avec `node scripts/qa-seed.mjs`.
# ⚠️ La PROD n'est JAMAIS écrite — elle est seulement lue. Une garde refuse de
#    tourner si la cible et la source sont le même projet.
#
# Prérequis : Docker démarré, et dans .env.local :
#   SUPABASE_PROJECT_REF, SUPABASE_PROJECT_REF_PROD, SUPABASE_DB_PASSWORD
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

env_get() { grep "^$1=" .env.local | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"; }

STAGING_REF="$(env_get SUPABASE_PROJECT_REF)"
PROD_REF="$(env_get SUPABASE_PROJECT_REF_PROD)"
DB_PASS="$(env_get SUPABASE_DB_PASSWORD)"

[ -n "$STAGING_REF" ] && [ -n "$PROD_REF" ] && [ -n "$DB_PASS" ] || {
  echo "ERREUR: SUPABASE_PROJECT_REF, SUPABASE_PROJECT_REF_PROD et SUPABASE_DB_PASSWORD requis dans .env.local" >&2
  exit 1
}

# Garde-fou : ne jamais écrire sur la prod.
if [ "$STAGING_REF" = "$PROD_REF" ]; then
  echo "REFUS: SUPABASE_PROJECT_REF pointe sur la PROD ($PROD_REF)." >&2
  echo "       Ce script écrase sa cible. Remets SUPABASE_PROJECT_REF sur le staging." >&2
  exit 1
fi

# Les hôtes db.<ref>.supabase.co sont en IPv6 seulement : on passe par le pooler
# session. Le préfixe régional diffère d'un projet à l'autre, on le détecte.
find_host() {
  local ref="$1"
  for h in aws-0-ca-central-1.pooler.supabase.com aws-1-ca-central-1.pooler.supabase.com; do
    if docker run --rm -e PGPASSWORD="$DB_PASS" postgres:17 \
         psql -h "$h" -p 5432 -U "postgres.$ref" -d postgres -tAc 'select 1' >/dev/null 2>&1; then
      echo "$h"; return 0
    fi
  done
  echo "ERREUR: aucun pooler ne répond pour $ref (mot de passe ? projet en pause ?)" >&2
  return 1
}

echo "→ Détection des hôtes…"
PROD_HOST="$(find_host "$PROD_REF")"
STAGING_HOST="$(find_host "$STAGING_REF")"
echo "  prod=$PROD_HOST  staging=$STAGING_HOST"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ Dump du schéma de la prod ($PROD_REF)…"
docker run --rm -e PGPASSWORD="$DB_PASS" -v "$TMP:/out" postgres:17 \
  pg_dump -h "$PROD_HOST" -p 5432 -U "postgres.$PROD_REF" -d postgres \
  --schema-only --no-owner -n public -n app -n archive -f /out/schema.sql

# Lignes refusées sur une base cible : privilèges réservés à la plateforme,
# recréation du schéma public, et marqueurs internes de pg_dump.
grep -vE '^(ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin|CREATE SCHEMA public;|COMMENT ON SCHEMA public IS|\\restrict |\\unrestrict )' \
  "$TMP/schema.sql" > "$TMP/schema_clean.sql"
echo "  $(wc -l < "$TMP/schema_clean.sql") lignes prêtes."

echo "→ Remise à zéro du staging ($STAGING_REF)…"
# On VIDE le schéma public au lieu de le supprimer : un `drop schema public`
# efface aussi son commentaire, ses privilèges et surtout les DEFAULT
# PRIVILEGES posés par `supabase_admin` — que nous n'avons pas le droit de
# recréer. La conformité stricte serait alors impossible à retrouver.
# Les objets appartenant à une extension (pg_net vit dans public) sont
# épargnés, sinon l'extension casse.
docker run --rm -e PGPASSWORD="$DB_PASS" postgres:17 \
  psql -h "$STAGING_HOST" -p 5432 -U "postgres.$STAGING_REF" -d postgres -v ON_ERROR_STOP=1 -c "
    drop schema if exists app cascade;
    drop schema if exists archive cascade;
    do \$\$
    declare r record;
    begin
      for r in (
        select c.oid::regclass as ident, c.relkind
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','v','m','S')
          and not exists (select 1 from pg_depend d
                          where d.objid = c.oid and d.deptype = 'e')
        order by case c.relkind when 'v' then 0 when 'm' then 1 else 2 end
      ) loop
        begin
          if r.relkind = 'v' then execute format('drop view if exists %s cascade', r.ident);
          elsif r.relkind = 'm' then execute format('drop materialized view if exists %s cascade', r.ident);
          elsif r.relkind = 'S' then execute format('drop sequence if exists %s cascade', r.ident);
          else execute format('drop table if exists %s cascade', r.ident);
          end if;
        exception when others then null;  -- déjà emporté par un cascade
        end;
      end loop;

      for r in (
        select p.oid::regprocedure as sig, p.prokind
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and not exists (select 1 from pg_depend d
                          where d.objid = p.oid and d.deptype = 'e')
      ) loop
        begin
          if r.prokind = 'a' then execute format('drop aggregate if exists %s cascade', r.sig);
          else execute format('drop function if exists %s cascade', r.sig);
          end if;
        exception when others then null;
        end;
      end loop;

      for r in (
        select t.oid::regtype as ident
        from pg_type t join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' and t.typtype in ('e','c','d')
          and not exists (select 1 from pg_depend d
                          where d.objid = t.oid and d.deptype = 'e')
          and not exists (select 1 from pg_class c where c.oid = t.typrelid and c.relkind <> 'c')
      ) loop
        begin execute format('drop type if exists %s cascade', r.ident);
        exception when others then null; end;
      end loop;

      -- Configurations de recherche textuelle (ex. french_unaccent) : sans ça
      -- la restauration échoue en doublon sur pg_ts_config_cfgname_index.
      for r in (
        select c.oid::regconfig as ident
        from pg_ts_config c join pg_namespace n on n.oid = c.cfgnamespace
        where n.nspname = 'public'
          and not exists (select 1 from pg_depend d
                          where d.objid = c.oid and d.deptype = 'e')
      ) loop
        begin execute format('drop text search configuration if exists %s cascade', r.ident);
        exception when others then null; end;
      end loop;

      for r in (
        select d0.oid::regdictionary as ident
        from pg_ts_dict d0 join pg_namespace n on n.oid = d0.dictnamespace
        where n.nspname = 'public'
          and not exists (select 1 from pg_depend d
                          where d.objid = d0.oid and d.deptype = 'e')
      ) loop
        begin execute format('drop text search dictionary if exists %s cascade', r.ident);
        exception when others then null; end;
      end loop;
    end \$\$;
  " >/dev/null

echo "→ Restauration du schéma…"
docker run --rm -e PGPASSWORD="$DB_PASS" -v "$TMP:/out" postgres:17 \
  psql -h "$STAGING_HOST" -p 5432 -U "postgres.$STAGING_REF" -d postgres \
  --single-transaction -v ON_ERROR_STOP=1 -f /out/schema_clean.sql >/dev/null

echo "→ Réapplication de ce que pg_dump ignore (baseline 02)…"
docker run --rm -e PGPASSWORD="$DB_PASS" -v "$PWD/supabase/baseline:/bl" postgres:17 \
  psql -h "$STAGING_HOST" -p 5432 -U "postgres.$STAGING_REF" -d postgres \
  -f /bl/02_post_schema.sql 2>&1 | grep -iE '^psql:.*ERROR' | grep -viE 'already exists|existe déjà' || true

echo "→ Alignement des privilèges sur la prod…"
# Indispensable : un projet neuf donne TOUS les droits à `authenticated` sur les
# nouvelles tables, et un dump ne peut qu'ajouter des privilèges, pas en retirer.
python3 scripts/sync-acl-from-prod.py

echo "→ Rechargement du cache PostgREST…"
docker run --rm -e PGPASSWORD="$DB_PASS" postgres:17 \
  psql -h "$STAGING_HOST" -p 5432 -U "postgres.$STAGING_REF" -d postgres \
  -c "notify pgrst, 'reload schema';" >/dev/null

echo "→ Vérification (db:diff)…"
python3 scripts/db-diff.py

cat <<'EOF'

✅ Staging recloné depuis la prod.

   Les DONNÉES de staging ont été effacées. Pour le repeupler :
     node scripts/qa-seed.mjs        (nécessite QA_ORG_ID / QA_USER_ID — voir le script)

   La config d'AUTHENTIFICATION (URLs de redirection, providers OAuth,
   confirmation automatique des courriels) n'est PAS dans la base : elle se
   règle via l'API de gestion et survit au clonage.
EOF
