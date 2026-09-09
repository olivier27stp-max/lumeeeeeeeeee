-- ═══════════════════════════════════════════════════════════════
-- Durcissement — re-balayage anon sur les fonctions SECURITY DEFINER
--
-- Le banc RLS a signalé : « ANON can execute SECURITY DEFINER
-- org_restricted_to_own() ». Cette fonction (helper booléen des policies
-- rep-own-scope) a été (re)créée le 2026-09-05 par
-- 20260905050000_org_restricted_to_own_fn.sql, APRÈS le grand balayage
-- 20260729120000. Un `create or replace` repart avec les DEFAULT
-- PRIVILEGES de Supabase (EXECUTE à anon), donc elle s'est retrouvée
-- exposée à anon — exactement le piège « la prochaine fonction ajoutée
-- repart exposée » que 20260729 documentait.
--
-- org_restricted_to_own ne fuit qu'un booléen (l'appelant est-il un
-- membre non-admin d'un org donné) et exige de connaître un couple
-- (user uuid, org uuid) réel — sévérité faible — mais une fonction
-- SECURITY DEFINER ne doit JAMAIS être appelable par anon. On applique
-- le principe de moindre privilège.
--
-- Idempotent : ne touche que les fonctions ENCORE exécutables par anon.
-- authenticated conserve son grant nominal — les policies RLS qui
-- appellent org_restricted_to_own((select auth.uid()), org_id) continuent
-- de fonctionner (elles s'évaluent avec le rôle authenticated).
-- Rejouable sur staging comme sur prod.
-- ═══════════════════════════════════════════════════════════════

do $$
declare
  fn record;
  n int := 0;
begin
  for fn in
    select quote_ident(nsp.nspname) || '.' || quote_ident(p.proname)
             || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig
    from pg_proc p
    join pg_namespace nsp on nsp.oid = p.pronamespace
    where nsp.nspname = 'public'
      and p.prosecdef
      -- Les triggers ne sont jamais appelables directement.
      and pg_get_function_result(p.oid) <> 'trigger'
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke execute on function %s from anon', fn.sig);
    execute format('revoke execute on function %s from public', fn.sig);
    n := n + 1;
  end loop;

  raise notice 'EXECUTE anon révoqué sur % fonction(s) SECURITY DEFINER', n;
end $$;

-- Rappel du correctif structurel (déjà posé en 20260729120000, réaffirmé
-- ici — no-op s'il tient déjà) : sans lui, la prochaine fonction repart
-- exposée à anon.
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from public;
