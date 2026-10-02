#!/usr/bin/env bash
# Pile Lume LOCALE et jetable pour les E2E de la section Automatisations :
# Postgres Supabase + GoTrue + PostgREST + Realtime, schéma = supabase/baseline/ + migrations postérieures.
# Ne touche à aucune base distante (ni staging, ni prod).
#
#   bash scripts/qa/automations-e2e/pile.sh            → (re)crée la pile
#   bash scripts/qa/automations-e2e/pile.sh arreter    → arrête les conteneurs (docker stop, rien n'est supprimé)
#   bash scripts/qa/automations-e2e/pile.sh demarrer   → redémarre des conteneurs déjà créés
#
# Ports : db 48432, gotrue 48999, postgrest 48300, realtime 48400 (les 49674-50933 et 54761-55460 sont réservés par Windows).
set -uo pipefail
export MSYS_NO_PATHCONV=1
NET=lumeautoe2e
DB=lumeautoe2e-db
AUTH=lumeautoe2e-auth
REST=lumeautoe2e-rest
RT=lumeautoe2e-realtime
PW=lumeautoe2e-local-pw
JWT=lumeautoe2e-local-jwt-secret-at-least-32-chars-long
IMG=public.ecr.aws/supabase/postgres:17.6.1.167
HERE="$(cd "$(dirname "$0")" && pwd)"
WT="$(cd "$HERE/../../.." && pwd)"
# git.exe ne comprend pas /d/… quand MSYS_NO_PATHCONV est posé (il l'est pour docker).
WTG="$(cygpath -m "$WT" 2>/dev/null || echo "$WT")"

case "${1:-creer}" in
  arreter) docker stop $RT $REST $AUTH $DB 2>/dev/null; exit 0 ;;
  demarrer) docker start $DB >/dev/null && sleep 6 && docker start $AUTH $REST $RT >/dev/null; docker ps --format '{{.Names}} {{.Status}}' | grep lumeautoe2e; exit 0 ;;
esac

docker network create $NET >/dev/null 2>&1 || true
# Seuls NOS conteneurs (noms lumeautoe2e-*) sont recréés.
docker rm -f $RT $REST $AUTH $DB >/dev/null 2>&1 || true

docker run -d --name $DB --network $NET -p 127.0.0.1:48432:5432 -e POSTGRES_PASSWORD=$PW -e JWT_SECRET=$JWT $IMG >/dev/null || exit 1
for i in $(seq 1 90); do docker exec $DB pg_isready -U postgres -q 2>/dev/null && break; sleep 2; done
sleep 5
sql() { docker exec -i -u postgres $DB psql -U supabase_admin -d postgres -v ON_ERROR_STOP=0 "$@"; }

echo "── rôles fournis par l'image"
sql -tA -c "select string_agg(rolname, ',' order by rolname) from pg_roles where rolname in ('anon','authenticated','service_role','authenticator','supabase_auth_admin')"
sql -qc "alter role supabase_auth_admin with password '$PW'; alter role authenticator with password '$PW';"
sql -qc "create schema if not exists _realtime; alter schema _realtime owner to supabase_admin;"

echo "── GoTrue (jeton 30 min et hook de jeton, comme la prod)"
docker run -d --name $AUTH --network $NET -p 127.0.0.1:48999:9999 \
  -e GOTRUE_API_HOST=0.0.0.0 -e PORT=9999 -e API_EXTERNAL_URL=http://127.0.0.1:48421 \
  -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$PW@$DB:5432/postgres" \
  -e GOTRUE_SITE_URL=http://127.0.0.1:5193 -e GOTRUE_URI_ALLOW_LIST='*' -e GOTRUE_DISABLE_SIGNUP=false \
  -e GOTRUE_JWT_SECRET=$JWT -e GOTRUE_JWT_EXP=1800 -e GOTRUE_JWT_AUD=authenticated -e GOTRUE_JWT_ADMIN_ROLES=service_role \
  -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
  -e GOTRUE_SMTP_HOST=localhost -e GOTRUE_SMTP_PORT=2500 -e GOTRUE_SMTP_ADMIN_EMAIL=noreply@example.invalid \
  -e GOTRUE_RATE_LIMIT_EMAIL_SENT=100000 -e GOTRUE_RATE_LIMIT_VERIFY=100000 -e GOTRUE_RATE_LIMIT_TOKEN_REFRESH=100000 \
  -e GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true -e GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI=pg-functions://postgres/public/custom_access_token_hook \
  public.ecr.aws/supabase/gotrue:v2.196.0 >/dev/null
for i in $(seq 1 60); do sql -tAc "select to_regclass('auth.identities')" 2>/dev/null | grep -q identities && break; sleep 2; done
sql -tA -c "select 'auth.users après GoTrue : '||coalesce(to_regclass('auth.users')::text,'∅')"

echo "── prélude (ce que le service de stockage crée sur un vrai projet)"
sql -q <<'SQL' 2>&1 | grep -E 'ERROR' | head -5
create schema if not exists storage;
create or replace function auth.jwt() returns jsonb language sql stable
  as $$ select coalesce(nullif(current_setting('request.jwt.claim', true), '')::jsonb,
                        nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
create or replace function storage.foldername(name text) returns text[] language plpgsql stable
  as $$ declare parties text[]; begin select string_to_array(name, '/') into parties; return parties[1:array_length(parties, 1) - 1]; end $$;
create table if not exists storage.buckets (id text primary key, name text not null, owner uuid, created_at timestamptz default now(),
  updated_at timestamptz default now(), public boolean default false, avif_autodetection boolean default false,
  file_size_limit bigint, allowed_mime_types text[], owner_id text, type text default 'STANDARD');
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now(),
  metadata jsonb, path_tokens text[], version text, owner_id text, user_metadata jsonb, level int);
alter table storage.objects enable row level security;
alter function auth.jwt() owner to supabase_auth_admin;
SQL

# Un projet neuf donne TOUS les droits à anon / authenticated / service_role sur chaque objet créé (droits par
# défaut), et un dump ne sait qu'AJOUTER des droits. On retire ces droits par défaut le temps de charger la
# baseline : les GRANT / REVOKE du dump donnent alors exactement les droits de la prod. Remis ensuite.
echo "── droits par défaut retirés le temps de la baseline"
DEFAUTS_OFF=""; DEFAUTS_ON=""
for r in supabase_admin postgres; do for o in tables functions sequences; do
  DEFAUTS_OFF="$DEFAUTS_OFF alter default privileges for role $r in schema public revoke all on $o from anon, authenticated, service_role;"
  DEFAUTS_ON="$DEFAUTS_ON alter default privileges for role $r in schema public grant all on $o to anon, authenticated, service_role;"
done; done
sql -qc "$DEFAUTS_OFF" 2>&1 | grep -E 'ERROR' | head -3

echo "── baseline 01"
sql -f - < "$WT/supabase/baseline/01_schema.sql" 2>&1 | grep -oE 'ERROR:.*' | sort | uniq -c | sort -rn | head -8
echo "── baseline 02 (sans pg_cron : aucune tâche planifiée dans cette base jetable)"
sed '/-- ── Tâches planifiées/,$d' "$WT/supabase/baseline/02_post_schema.sql" | sql -f - 2>&1 | grep -oE 'ERROR:.*' | sort | uniq -c | head -5
sql -qc "$DEFAUTS_ON" 2>&1 | grep -E 'ERROR' | head -3

# La baseline n'est pas régénérée à chaque migration (le 2026-10-01 elle datait du 09-26 : 77 migrations
# de retard, dont une colonne de `plans`). On rejoue donc toutes les migrations AJOUTÉES au dépôt depuis le
# commit de sa dernière vraie régénération (message « baseline … régénérée ») — pas depuis le dernier
# commit qui a touché le fichier, qui peut n'être qu'une retouche à la main.
REGEN="$(git -C "$WTG" log -1 --format=%H -i --grep='baseline' --grep='régénérée' --all-match -- supabase/baseline/01_schema.sql)"
[ -z "$REGEN" ] && REGEN="$(git -C "$WTG" log -1 --format=%H -- supabase/baseline/01_schema.sql)"
echo "── migrations postérieures à la baseline (régénérée au commit ${REGEN:0:8})"
n=0; ko=0
while read -r f; do
  [ -z "$f" ] && continue
  n=$((n + 1))
  out="$(sql -f - < "$WT/$f" 2>&1 | grep -oE 'ERROR:.*' | head -3)"
  [ -n "$out" ] && { ko=$((ko + 1)); echo "   $f : $out"; }
done < <(git -C "$WTG" diff --no-renames --name-only --diff-filter=A "$REGEN" HEAD -- supabase/migrations | grep ".sql$" | grep -v "/proposed/" | sort)
echo "   $n migrations rejouées, $ko en erreur"
sql -tAc "select cron.unschedule(jobid) from cron.job" >/dev/null 2>&1
# Le moteur pose son repère de « mise en service » à son premier passage et classe comme ancien tout
# événement écrit avant. Sur une base neuve, le premier test du moteur tombait pour cette seule raison :
# le repère est posé ici, à la création de la pile (même ligne que server/lib/evenementsBase.ts).
sql -qc "insert into automation_evenements_base (org_id, type, entity_type, entity_id, cle, traite_at)
  values ('00000000-0000-0000-0000-000000000000', '__mise_en_service__', 'systeme', '00000000-0000-0000-0000-000000000000', 'repere', now())
  on conflict do nothing" 2>&1 | grep -E 'ERROR' | head -2

# Deux tables de RÉFÉRENCE (aucune donnée de client) que la baseline ne contient pas : les forfaits et les
# permissions par défaut des rôles. Elles viennent d'une sauvegarde de la prod (npm run backup:install),
# lue en local : la prod n'est pas interrogée. Le fichier copié dans le conteneur est supprimé aussitôt.
if [ -n "${E2E_SAUVEGARDE:-}" ] && [ -f "$E2E_SAUVEGARDE" ]; then
  echo "── tables de référence (plans, role_permission_defaults) depuis $(basename "$E2E_SAUVEGARDE")"
  docker cp "$(cygpath -m "$E2E_SAUVEGARDE" 2>/dev/null || echo "$E2E_SAUVEGARDE")" $DB:/tmp/ref.dump
  sql -qc "truncate role_permission_defaults; delete from plans;"
  docker exec -u postgres $DB pg_restore --data-only --no-owner -U supabase_admin -d postgres -t plans -t role_permission_defaults /tmp/ref.dump 2>&1 | tail -3
  docker exec -u root $DB rm -f /tmp/ref.dump
  sql -tA -c "select 'plans ' || count(*) from plans union all select 'role_permission_defaults ' || count(*) from role_permission_defaults union all select 'orgs (doit rester 0) ' || count(*) from orgs"
else
  # Sans sauvegarde sous la main (CI, autre poste) : la semence du dépôt — mêmes deux tables, sans identifiant Stripe.
  echo "── tables de référence (plans, role_permission_defaults) depuis scripts/qa/automations-e2e/reference.sql"
  sql -qc "truncate role_permission_defaults; delete from plans;"
  sql -q -f - < "$HERE/reference.sql" 2>&1 | grep -oE 'ERROR:.*' | head -3
  sql -tA -c "select 'plans ' || count(*) from plans union all select 'role_permission_defaults ' || count(*) from role_permission_defaults union all select 'orgs (doit rester 0) ' || count(*) from orgs"
fi

echo "── PostgREST (max_rows=1000 comme la prod)"
docker run -d --name $REST --network $NET -p 127.0.0.1:48300:3000 \
  -e PGRST_DB_URI="postgres://authenticator:$PW@$DB:5432/postgres" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_EXTRA_SEARCH_PATH="public,extensions" -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=$JWT \
  -e PGRST_DB_MAX_ROWS=1000 -e PGRST_DB_USE_LEGACY_GUCS=false \
  public.ecr.aws/supabase/postgrest:v16.2 >/dev/null

echo "── Realtime (locataire « realtime-dev »)"
docker run -d --name $RT --network $NET -p 127.0.0.1:48400:4000 \
  -e PORT=4000 -e DB_HOST=$DB -e DB_PORT=5432 -e DB_USER=supabase_admin -e DB_PASSWORD=$PW -e DB_NAME=postgres \
  -e DB_AFTER_CONNECT_QUERY='SET search_path TO _realtime' -e DB_ENC_KEY=supabaserealtime -e API_JWT_SECRET=$JWT -e METRICS_JWT_SECRET=$JWT \
  -e SECRET_KEY_BASE=lumeautoe2e-secret-key-base-0123456789abcdef0123456789abcdef0123456789abcdef \
  -e ERL_AFLAGS='-proto_dist inet_tcp' -e DNS_NODES="''" -e RLIMIT_NOFILE=10000 -e APP_NAME=realtime \
  -e SEED_SELF_HOST=true -e RUN_JANITOR=true \
  public.ecr.aws/supabase/realtime:v2.135.3 >/dev/null

for i in $(seq 1 30); do curl -s -o /dev/null -m 3 127.0.0.1:48400/ && break; sleep 2; done
sql -tAc "notify pgrst, 'reload schema'" >/dev/null
curl -s -o /dev/null -w "postgrest HTTP %{http_code}\n" 127.0.0.1:48300/
curl -s -o /dev/null -w "gotrue HTTP %{http_code}\n" 127.0.0.1:48999/health
curl -s -o /dev/null -w "realtime HTTP %{http_code}\n" 127.0.0.1:48400/

echo "── ce que la base contient"
sql -tA -c "
select 'tables      ' || count(*) from pg_tables where schemaname in ('public','app','archive')
union all select 'vues        ' || count(*) from pg_views where schemaname in ('public','app','archive')
union all select 'fonctions   ' || count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app','archive')
union all select 'policies    ' || count(*) from pg_policies where schemaname in ('public','app','archive','storage')
union all select 'triggers    ' || count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app','archive') and not t.tgisinternal
union all select 'temps réel  ' || count(*) from pg_publication_tables where pubname='supabase_realtime'
union all select 'fonctions exécutables par anon ' || count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute')
union all select 'tables écrites par authenticated ' || count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and has_table_privilege('authenticated', c.oid, 'insert')
"
