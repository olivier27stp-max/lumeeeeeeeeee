#!/usr/bin/env bash
# Stack Lume locale et jetable pour l'audit Statistiques : Postgres Supabase + GoTrue + PostgREST.
# Ne touche à aucune base distante. Ports : db 55432, gotrue 59999, postgrest 53000.
set -uo pipefail
export MSYS_NO_PATHCONV=1
NET=lumefinal
PW=lumefinal-local-pw
JWT=lumefinal-local-jwt-secret-at-least-32-chars-long
IMG=public.ecr.aws/supabase/postgres:17.6.1.167
HERE="$(cd "$(dirname "$0")" && pwd)"
WT="D:/lume-final/wt"

docker network create $NET >/dev/null 2>&1 || true
docker rm -f lumefinal-db lumefinal-auth lumefinal-rest >/dev/null 2>&1 || true

docker run -d --name lumefinal-db --network $NET -p 49432:5432 -e POSTGRES_PASSWORD=$PW \
  -e JWT_SECRET=$JWT $IMG >/dev/null || exit 1
for i in $(seq 1 90); do docker exec lumefinal-db pg_isready -U postgres -q 2>/dev/null && break; sleep 2; done
sleep 4
sql() { docker exec -i -u postgres lumefinal-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=0 "$@"; }

echo "── rôles/auth fournis par l'image ?"
sql -tA -c "select string_agg(rolname, ',') from pg_roles where rolname in ('anon','authenticated','service_role','authenticator','supabase_auth_admin')"
sql -tA -c "select to_regclass('auth.users'), to_regprocedure('auth.uid()')"

sql -qc "alter role supabase_auth_admin with password '$PW'; alter role authenticator with password '$PW';"
echo "── GoTrue"
docker run -d --name lumefinal-auth --network $NET -p 49999:9999 \
  -e GOTRUE_API_HOST=0.0.0.0 -e PORT=9999 -e API_EXTERNAL_URL=http://localhost:44921 \
  -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$PW@lumefinal-db:5432/postgres" \
  -e GOTRUE_SITE_URL=http://localhost:5491 -e GOTRUE_URI_ALLOW_LIST='*' -e GOTRUE_DISABLE_SIGNUP=false \
  -e GOTRUE_JWT_SECRET=$JWT -e GOTRUE_JWT_EXP=86400 -e GOTRUE_JWT_AUD=authenticated -e GOTRUE_JWT_ADMIN_ROLES=service_role \
  -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
  -e GOTRUE_SMTP_HOST=localhost -e GOTRUE_SMTP_PORT=2500 -e GOTRUE_SMTP_ADMIN_EMAIL=noreply@example.invalid \
  public.ecr.aws/supabase/gotrue:v2.196.0 >/dev/null
for i in $(seq 1 60); do sql -tAc "select to_regclass('auth.identities')" 2>/dev/null | grep -q identities && break; sleep 2; done
sql -tA -c "select 'auth.users after gotrue: '||coalesce(to_regclass('auth.users')::text,'∅')"

echo "── prélude (storage minimal, comme scripts/rejouer-baseline.sh)"
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

echo "── baseline 01"
sql -f - < $WT/supabase/baseline/01_schema.sql 2>&1 | grep -oE 'ERROR:.*' | sort | uniq -c | sort -rn | head -8
echo "── baseline 02 (sans pg_cron : aucune tâche planifiée dans cette base jetable)"
sed '/-- ── Tâches planifiées/,$d' $WT/supabase/baseline/02_post_schema.sql | sql -f - 2>&1 | grep -oE 'ERROR:.*' | sort | uniq -c | head -5
echo "── migrations postérieures à la baseline"
while read -r f; do
  out="$(sql -f - < "$WT/$f" 2>&1 | grep -oE 'ERROR:.*' | head -3)"
  [ -n "$out" ] && echo "   $f : $out"
done < <(git -C "$WT" diff --no-renames --name-only --diff-filter=A 4885f75e HEAD -- supabase/migrations | grep ".sql$" | grep -v "/proposed/" | sort)
sql -tAc "select cron.unschedule(jobid) from cron.job" >/dev/null 2>&1
sql -tAc "notify pgrst, 'reload schema'"

echo "── PostgREST (max_rows=1000 comme la prod)"
docker run -d --name lumefinal-rest --network $NET -p 49300:3000 \
  -e PGRST_DB_URI="postgres://authenticator:$PW@lumefinal-db:5432/postgres" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_EXTRA_SEARCH_PATH="public,extensions" -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=$JWT \
  -e PGRST_DB_MAX_ROWS=1000 -e PGRST_DB_USE_LEGACY_GUCS=false \
  public.ecr.aws/supabase/postgrest:v16.2 >/dev/null
sleep 3
curl -s -o /dev/null -w "postgrest HTTP %{http_code}\n" localhost:49300/
curl -s -o /dev/null -w "gotrue HTTP %{http_code}\n" localhost:49999/health
