-- Verrous de crons fiables via bail (lease).
--
-- Les advisory locks de session ne survivent pas au pool de connexions
-- PostgREST : l'acquisition et le relâchement tombent sur des connexions
-- différentes, le relâchement échoue silencieusement et le verrou reste
-- coincé — les jobs « lock-guarded » se sautent ensuite sans bruit
-- (3 verrous coincés observés en prod le 2026-08-03).
--
-- Remplacement : une table de bail. Le verrou expire tout seul après
-- 10 minutes même si le processus meurt sans relâcher. Les signatures de
-- try_advisory_lock / release_advisory_lock sont conservées — aucun
-- changement côté serveur (server/lib/advisory-lock.ts).

create table if not exists public.cron_locks (
  key bigint primary key,
  locked_at timestamptz not null default now(),
  locked_until timestamptz not null
);

alter table public.cron_locks enable row level security;
-- Aucune policy : accès via les fonctions SECURITY DEFINER seulement.

create or replace function public.try_advisory_lock(p_key bigint)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_claimed boolean;
begin
  insert into public.cron_locks (key, locked_until)
  values (p_key, now() + interval '10 minutes')
  on conflict (key) do update
    set locked_at = now(), locked_until = now() + interval '10 minutes'
    where cron_locks.locked_until < now()
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end;
$$;

create or replace function public.release_advisory_lock(p_key bigint)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  delete from public.cron_locks where key = p_key;
  return true;
end;
$$;
