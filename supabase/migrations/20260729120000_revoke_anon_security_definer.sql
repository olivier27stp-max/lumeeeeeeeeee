-- ═══════════════════════════════════════════════════════════════
-- Durcissement — retire anon/PUBLIC des fonctions SECURITY DEFINER
--
-- RLS ne s'applique pas aux fonctions. Une fonction SECURITY DEFINER
-- s'execute avec les droits de son proprietaire, donc elle voit toutes
-- les organisations. Supabase accorde EXECUTE par defaut sur tout nouvel
-- objet de public: 17 RPC etaient donc appelables SANS ETRE CONNECTE,
-- avec les droits du proprietaire.
--
-- Trois fuites confirmees, exploitables sans compte:
--   ac_client_name(uuid)            -> nom de n'importe quel client
--   resolve_primary_property(uuid)  -> propriete de n'importe quel client
--   ac_log_event(p_org, ...)        -> INSERT d'une notification dans
--                                      l'organisation de son choix
--
-- Aucune n'est appelee depuis le code applicatif (verifie: 0 occurrence
-- de .rpc('<nom>') dans src/ et server/). Ce sont des helpers internes de
-- triggers. Les triggers ne sont pas affectes: ils s'executent avec les
-- droits du proprietaire de la table, pas ceux de l'appelant.
--
-- IMPORTANT — pourquoi "from public" et pas seulement "from anon":
-- l'ACL de ces fonctions commence par "=X/postgres", c'est-a-dire un grant
-- EXECUTE au pseudo-role PUBLIC qui englobe tout le monde, anon compris.
-- Un "revoke ... from anon" ne l'enleve pas: anon n'y figure pas
-- nommement, il herite de PUBLIC. C'est le piege classique de ce
-- durcissement — une premiere passe sur anon seul n'avait rien change.
--
-- authenticated conserve un grant nominal distinct
-- (authenticated=X/postgres) et n'est pas touche: les 47 RPC appelees par
-- le front continuent de fonctionner. Verifie apres application:
-- 0 RPC executable par anon, 182 fonctions toujours ouvertes a
-- authenticated.
-- ═══════════════════════════════════════════════════════════════

do $$
declare
  fn record;
  n int := 0;
begin
  for fn in
    select quote_ident(n.nspname) || '.' || quote_ident(p.proname)
             || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      -- Les triggers ne sont jamais appelables directement: on garde la
      -- migration au plus pres du risque reel.
      and pg_get_function_result(p.oid) <> 'trigger'
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke execute on function %s from anon', fn.sig);
    execute format('revoke execute on function %s from public', fn.sig);
    n := n + 1;
  end loop;

  raise notice 'EXECUTE revoque sur % fonction(s) SECURITY DEFINER', n;
end $$;

-- Correctif structurel: sans ceci, la prochaine fonction ajoutee repart
-- exposee. C'est ce qui empeche le probleme de revenir au prochain merge.
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from public;
