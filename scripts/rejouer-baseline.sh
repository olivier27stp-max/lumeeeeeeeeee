#!/usr/bin/env bash
# Rejoue supabase/baseline/ sur un PostgreSQL vierge et compte ce qu'on obtient.
# Prouve que le dossier recrée vraiment un environnement. Ne touche à aucune base distante.
#   bash scripts/rejouer-baseline.sh
#
# Le SQL est appliqué en tant que supabase_admin : c'est le rôle privilégié dont
# dispose l'API Management sur un vrai projet (celle qu'utilise npm run db:bootstrap).
set -uo pipefail

IMAGE="public.ecr.aws/supabase/postgres:17.6.1.167"
NOM="lume-rejeu-baseline-$$"
RACINE="$(cd "$(dirname "$0")/.." && pwd)"

nettoyer() { docker rm -f "$NOM" >/dev/null 2>&1 || true; }
trap nettoyer EXIT

echo "── conteneur vierge ($IMAGE)"
docker run -d --name "$NOM" -e POSTGRES_PASSWORD="rejeu$$" "$IMAGE" >/dev/null || exit 1
pret=0
for i in $(seq 1 90); do
  if docker exec "$NOM" pg_isready -U postgres -q 2>/dev/null; then pret=1; break; fi
  [ $((i % 15)) -eq 0 ] && echo "   … démarrage ($((i * 2)) s)"
  sleep 2
done
[ "$pret" = 1 ] || { echo "✗ le conteneur ne démarre pas"; docker logs "$NOM" 2>&1 | tail -5; exit 1; }
sleep 3

sql() { docker exec -i -u postgres "$NOM" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=0 "$@"; }

echo "── ce que les services Supabase créent sur un vrai projet (absent de l'image)"
sql -q <<'SQL' 2>&1 | grep -E 'ERROR' | head -5
create schema if not exists auth;
create schema if not exists storage;
create or replace function auth.jwt() returns jsonb language sql stable
  as $$ select coalesce(nullif(current_setting('request.jwt.claim', true), '')::jsonb,
                        nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
create or replace function storage.foldername(name text) returns text[] language plpgsql stable
  as $$ declare parties text[]; begin
    select string_to_array(name, '/') into parties;
    return parties[1:array_length(parties, 1) - 1];
  end $$;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb,
  encrypted_password text, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists storage.buckets (
  id text primary key, name text not null, owner uuid, created_at timestamptz default now(),
  updated_at timestamptz default now(), public boolean default false, avif_autodetection boolean default false,
  file_size_limit bigint, allowed_mime_types text[], owner_id text, type text default 'STANDARD');
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(), metadata jsonb, path_tokens text[], version text,
  owner_id text, user_metadata jsonb, level int);
alter table storage.objects enable row level security;
alter table auth.users owner to supabase_auth_admin;
alter table storage.buckets owner to supabase_storage_admin;
alter table storage.objects owner to supabase_storage_admin;
SQL

total=0
for f in 01_schema.sql 02_post_schema.sql; do
  echo "── $f"
  sortie="$(sql -f - < "$RACINE/supabase/baseline/$f" 2>&1)"
  erreurs="$(printf '%s\n' "$sortie" | grep -cE '(^|: )ERROR:')"
  total=$((total + erreurs))
  echo "   erreurs : $erreurs"
  [ "$erreurs" -gt 0 ] && printf '%s\n' "$sortie" | grep -oE 'ERROR:.*' | sort | uniq -c | sort -rn | head -10
done

echo "── ce que la base contient au bout du compte"
sql -tA -c "
select 'tables      ' || count(*) from pg_tables where schemaname in ('public','app','archive')
union all select 'vues        ' || count(*) from pg_views where schemaname in ('public','app','archive')
union all select 'fonctions   ' || count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app','archive')
union all select 'policies    ' || count(*) from pg_policies where schemaname in ('public','app','archive','storage')
union all select 'triggers    ' || count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app','archive') and not t.tgisinternal
union all select 'buckets     ' || count(*) from storage.buckets
union all select 'temps réel  ' || count(*) from pg_publication_tables where pubname='supabase_realtime'
union all select 'tâches cron ' || (select count(*)::text from cron.job)
"
echo
[ "$total" -eq 0 ] && echo "✅ rejeu sans erreur" || echo "⚠️  $total erreur(s) au total"
