-- ============================================================================
-- security_canary_runs — deny-all ASSUME, pas un oubli
-- ============================================================================
-- La sonde check_rls_coverage() (20260751101000) signale cette table parce
-- qu'elle a RLS activee + forcee mais AUCUNE policy. Le signalement est
-- correct dans le cas general : « RLS sans policy » est presque toujours une
-- table rendue inaccessible par accident.
--
-- ICI C'EST VOULU. security_canary_runs stocke les resultats de la sonde de
-- securite nocturne (voir 20260730150000_canari_securite_et_verrou_ui.sql et
-- 20260730180000_canari_ssrf_pgnet.sql). Elle est ecrite par un cron tournant
-- en service_role (qui a rolbypassrls) et n'est JAMAIS lue par l'application.
-- Aucune policy = deny-all pour anon et authenticated : c'est exactement la
-- posture souhaitee pour des resultats d'audit interne.
--
-- Plutot que d'ajouter une policy factice pour faire taire la sonde — ce qui
-- affaiblirait la table et masquerait le vrai signal ailleurs — on documente
-- l'intention et on exclut explicitement cette table de la verification.
-- ============================================================================

comment on table public.security_canary_runs is
  'Resultats de la sonde de securite nocturne. RLS forcee SANS policy = '
  'deny-all volontaire : ecrite par cron en service_role, jamais lue par '
  'l''application. Ne PAS ajouter de policy pour satisfaire check_rls_coverage().';

-- ----------------------------------------------------------------------------
-- On affine la sonde : une table sans policy reste signalee, SAUF si son
-- commentaire declare explicitement le deny-all. L'exception est donc portee
-- par la table elle-meme, pas par une liste en dur dans la fonction.
-- ----------------------------------------------------------------------------
create or replace function public.check_rls_coverage()
returns table (table_name text, rls_enabled boolean, rls_forced boolean, policy_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.relname::text, c.relrowsecurity, c.relforcerowsecurity,
         (select count(*) from pg_policy p where p.polrelid = c.oid)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and (not c.relrowsecurity
          or not c.relforcerowsecurity
          or (not exists (select 1 from pg_policy p where p.polrelid = c.oid)
              -- deny-all assume : declare dans le commentaire de la table
              and coalesce(obj_description(c.oid, 'pg_class'), '') not like '%deny-all volontaire%'));
$$;

revoke all on function public.check_rls_coverage() from public, anon, authenticated;

comment on function public.check_rls_coverage() is
  'N3.4 — Doit retourner 0 ligne. Table sans RLS activee, sans RLS forcee, ou '
  'avec RLS mais aucune policy. Une table peut declarer un deny-all assume en '
  'incluant « deny-all volontaire » dans son commentaire.';
