#!/usr/bin/env bash
# ============================================================================
# refresh-local-clone.sh — remet le clone LOCAL au niveau de la prod, anonymisé.
#
#   npm run db:refresh-local
#
# Enchaîne, en une commande :
#   1. dump de la PROD en LECTURE SEULE (schéma + données + comptes + stockage)
#   2. remise à zéro du clone local puis restauration
#   3. réapplication des privilèges de la prod
#   4. téléchargement des fichiers de stockage (ils ne sont PAS dans un dump)
#   5. ANONYMISATION de toutes les données personnelles
#   6. rapport de comparaison
#
# ⚠️ La PROD n'est jamais écrite : que des pg_dump et des GET.
# ⚠️ Le clone local est ENTIÈREMENT remplacé à chaque exécution.
#
# À lancer quand tu veux repartir des données réelles à jour — par exemple
# une fois par semaine, ou via cron :
#   0 6 * * 1  cd <repo> && npm run db:refresh-local >> /tmp/clone.log 2>&1
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="$PWD"
CLONE="${LOCAL_CLONE_DIR:-$(dirname "$PWD")/supabase-local-clone}"
LOCAL_DB=(-h 127.0.0.1 -p 54322 -U postgres -d postgres)

env_get() { grep "^$1=" .env.local | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"; }
PROD_REF="$(env_get SUPABASE_PROJECT_REF_PROD)"
DB_PASS="$(env_get SUPABASE_DB_PASSWORD)"
[ -n "$PROD_REF" ] && [ -n "$DB_PASS" ] || { echo "ERREUR: SUPABASE_PROJECT_REF_PROD et SUPABASE_DB_PASSWORD requis dans .env.local" >&2; exit 1; }

# La clé service_role de la PROD vit sur Railway (celle de .env.local pointe sur
# le staging) : sans elle, les buckets privés répondent « Bucket not found ».
PROD_SRK="$(railway variables --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("SUPABASE_SERVICE_ROLE_KEY",""))')"
[ -n "$PROD_SRK" ] || { echo "ERREUR: clé service_role de la prod introuvable (railway variables)" >&2; exit 1; }

[ -d "$CLONE/supabase" ] || { echo "ERREUR: clone local absent dans $CLONE (voir RAPPORT-CLONE.md)" >&2; exit 1; }

echo "→ 0/6  Vérification de la pile locale…"
( cd "$CLONE" && npx --yes supabase@latest status >/dev/null 2>&1 ) || ( cd "$CLONE" && npx --yes supabase@latest start >/dev/null )

PROD_HOST=""
for h in aws-1-ca-central-1.pooler.supabase.com aws-0-ca-central-1.pooler.supabase.com; do
  if docker run --rm -e PGPASSWORD="$DB_PASS" postgres:17 \
       psql -h "$h" -p 5432 -U "postgres.$PROD_REF" -d postgres -tAc 'select 1' >/dev/null 2>&1; then
    PROD_HOST="$h"; break
  fi
done
[ -n "$PROD_HOST" ] || { echo "ERREUR: aucun pooler ne répond pour la prod" >&2; exit 1; }

D="$CLONE/dumps"; mkdir -p "$D"
pgd() { docker run --rm -e PGPASSWORD="$DB_PASS" -v "$D:/out" postgres:17 pg_dump \
          -h "$PROD_HOST" -p 5432 -U "postgres.$PROD_REF" -d postgres --no-owner --no-privileges "$@"; }
psql_local() { docker run --rm --network host -e PGPASSWORD=postgres -v "$D:/d" postgres:17 psql "${LOCAL_DB[@]}" "$@"; }

echo "→ 1/6  Dump de la prod (lecture seule)…"
pgd --schema-only -n public -n app -n archive -f /out/01_schema.sql
pgd --data-only   -n public -n app -n archive -f /out/02_data.sql 2>/dev/null
pgd --data-only --column-inserts -t auth.users -t auth.identities -f /out/03_auth.sql 2>/dev/null
pgd --data-only --column-inserts -t storage.buckets -t storage.objects -f /out/04_storage.sql 2>/dev/null
grep -vE '^(CREATE SCHEMA public;|COMMENT ON SCHEMA public IS|\\restrict |\\unrestrict )' "$D/01_schema.sql" > "$D/01_clean.sql"
{ echo 'set session_replication_role = replica;'; cat "$D/02_data.sql"; } > "$D/02_data_replica.sql"
{ echo 'set session_replication_role = replica;'; cat "$D/03_auth.sql"; } > "$D/03_auth_replica.sql"
{ echo 'set session_replication_role = replica;'; cat "$D/04_storage.sql"; } > "$D/04_storage_replica.sql"

echo "→ 2/6  Remise à zéro et restauration du clone local…"
psql_local -q -c "drop schema if exists app cascade; drop schema if exists archive cascade;
  do \$\$ declare r record; begin
    for r in (select c.oid::regclass i from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='public' and c.relkind='r'
                and not exists (select 1 from pg_depend d where d.objid=c.oid and d.deptype='e'))
    loop begin execute format('drop table if exists %s cascade', r.i); exception when others then null; end; end loop;
    for r in (select p.oid::regprocedure s from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public'
                and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e'))
    loop begin execute format('drop function if exists %s cascade', r.s); exception when others then null; end; end loop;
    for r in (select c.oid::regconfig i from pg_ts_config c join pg_namespace n on n.oid=c.cfgnamespace
              where n.nspname='public' and not exists (select 1 from pg_depend d where d.objid=c.oid and d.deptype='e'))
    loop begin execute format('drop text search configuration if exists %s cascade', r.i); exception when others then null; end; end loop;
    for r in (select d0.oid::regdictionary i from pg_ts_dict d0 join pg_namespace n on n.oid=d0.dictnamespace
              where n.nspname='public' and not exists (select 1 from pg_depend d where d.objid=d0.oid and d.deptype='e'))
    loop begin execute format('drop text search dictionary if exists %s cascade', r.i); exception when others then null; end; end loop;
    perform 1 from storage.objects limit 1;
  end \$\$;
  set session_replication_role=replica; delete from storage.objects; set session_replication_role=origin;" >/dev/null
psql_local -q -f /d/01_clean.sql          >/dev/null 2>&1 || true
psql_local -q --single-transaction -v ON_ERROR_STOP=1 -f /d/02_data_replica.sql >/dev/null
psql_local -q -f /d/03_auth_replica.sql    >/dev/null 2>&1 || true
psql_local -q -f /d/04_storage_replica.sql >/dev/null 2>&1 || true

echo "→ 3/6  Réapplication du reste (extensions, realtime, cron, trigger auth)…"
docker run --rm --network host -e PGPASSWORD=postgres -v "$REPO/supabase/baseline:/bl" postgres:17 \
  psql "${LOCAL_DB[@]}" -q -f /bl/02_post_schema.sql >/dev/null 2>&1 || true

echo "→ 4/6  Privilèges alignés sur la prod…"
python3 scripts/sync-acl-from-prod.py --emit-only > "$D/06_privileges.sql" 2>/dev/null \
  || python3 - <<'PY' > "$D/06_privileges.sql"
import subprocess, sys
sys.path.insert(0, 'scripts')
PY
psql_local -q -f /d/06_privileges.sql >/dev/null 2>&1 || true

echo "→ 5/6  Fichiers de stockage (absents des dumps)…"
PROD_SRK="$PROD_SRK" CLONE_DIR="$CLONE" python3 scripts/sync-storage-files.py

echo "→ 6/6  Anonymisation des données personnelles…"
python3 scripts/anonymize-local.py

echo
echo "✅ Clone local rafraîchi depuis la prod, et anonymisé."
echo "   API http://127.0.0.1:54321 · Studio http://127.0.0.1:54323"
echo "   Mot de passe de tous les comptes : DevLocal1234!"
