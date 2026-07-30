-- ============================================================================
-- CORRECTIF — fonctions trigger executables par anon/PUBLIC
-- ============================================================================
-- DECOUVERT PAR scripts/test-rls-isolation.ts APRES application des migrations
-- de cet audit. La suite a signale :
--     ANON can execute SECURITY DEFINER audit_events_append_only()
--
-- CAUSE : la migration 20260751100100 a cree audit_events_append_only() en
-- SECURITY DEFINER sans revoquer EXECUTE a PUBLIC. Postgres accorde EXECUTE a
-- PUBLIC par defaut sur toute nouvelle fonction ; combine a SECURITY DEFINER,
-- cela en fait une fonction appelable par n'importe qui avec les droits du
-- proprietaire. C'est exactement le defaut N7.2 que cet audit denonce ailleurs.
--
-- IMPACT REEL : faible. Appelee hors trigger, la fonction leve immediatement
-- une exception (TG_OP est NULL hors contexte trigger) ou refuse l'operation.
-- Elle ne lit ni n'ecrit aucune donnee. Mais une fonction SECURITY DEFINER
-- exposee a anon reste une porte a ne pas laisser ouverte, et le principe
-- « default-deny » ne souffre pas d'exception au cas par cas.
--
-- CORRECTIF : une fonction trigger n'a AUCUNE raison d'etre appelable
-- directement. On revoque EXECUTE a PUBLIC, anon et authenticated sur toutes
-- les fonctions trigger creees par cet audit. Les triggers continuent de
-- fonctionner : ils s'executent avec les droits du proprietaire de la table,
-- pas ceux de l'appelant.
-- ============================================================================

-- audit_events_append_only : la fuite signalee.
revoke all on function public.audit_events_append_only() from public;
revoke all on function public.audit_events_append_only() from anon;
revoke all on function public.audit_events_append_only() from authenticated;

-- Fonctions trigger creees par cet audit : meme traitement par principe,
-- meme si elles ne sont pas SECURITY DEFINER.
revoke all on function public.sync_legacy_money_columns() from public;
revoke all on function public.sync_legacy_money_columns() from anon;
revoke all on function public.sync_legacy_money_columns() from authenticated;

-- ----------------------------------------------------------------------------
-- Verification : plus aucune fonction trigger de cet audit n'est executable
-- par anon ou authenticated.
-- ----------------------------------------------------------------------------
do $$
declare
  v_leaks text;
begin
  select string_agg(p.proname, ', ')
    into v_leaks
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('audit_events_append_only', 'sync_legacy_money_columns')
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE'));

  if v_leaks is not null then
    raise exception 'Fonctions trigger encore exposees : %', v_leaks;
  end if;

  raise notice 'Fonctions trigger verrouillees.';
end $$;
