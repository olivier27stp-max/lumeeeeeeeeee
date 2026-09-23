-- Cinq fonctions de trigger SECURITY DEFINER (deals / pipeline_stages) sont
-- exécutables par anon et authenticated. Le test d'isolation RLS de la CI
-- (scripts/test-rls-isolation.ts) les signale comme fuites depuis le
-- 2026-09-23 vers 15 h 48, ce qui rend la CI de main rouge :
--   « ANON can execute SECURITY DEFINER deals_verifier_etape() /
--     pipeline_stages_verifier_archivage() / deals_horodater_etape() /
--     deals_ecrire_historique() / deals_emettre_evenements() »
--
-- Risque réel : FAIBLE. Vérifié dans le catalogue — les cinq sont
-- `returns trigger` sans argument, donc PostgREST ne les expose pas et anon ne
-- peut pas les appeler de l'extérieur. Mais une permission EXECUTE sur une
-- fonction SECURITY DEFINER n'a aucune raison d'exister : elle ne protège rien
-- et fera rougir la CI tant qu'elle est là. Un trigger s'exécute quel que soit
-- le droit EXECUTE du rôle courant — révoquer ne change donc rien à l'app.
--
-- Règle du projet (secdef moindre privilège, même cause que
-- 20260916180000_secdef_billing_properties_revoke.sql) : révoquer anon et
-- authenticated NOMMÉMENT — un revoke à PUBLIC ne suffit pas avec les
-- defaults Supabase, qui accordent aux deux rôles sur les objets nouveaux.
--
-- ⚠ Ces fonctions n'existent dans AUCUNE migration du dépôt : elles ont été
-- créées directement en base, hors du pipeline. C'est exactement la dérive que
-- CLAUDE.md interdit, et c'est pourquoi la CI les a découvertes au lieu d'une
-- revue. À retrouver et à rapatrier dans une migration (voir le suivi).

begin;

revoke execute on function public.deals_verifier_etape() from public, anon, authenticated;
revoke execute on function public.deals_horodater_etape() from public, anon, authenticated;
revoke execute on function public.deals_ecrire_historique() from public, anon, authenticated;
revoke execute on function public.deals_emettre_evenements() from public, anon, authenticated;
revoke execute on function public.pipeline_stages_verifier_archivage() from public, anon, authenticated;

-- Contrôle : la migration échoue plutôt que de laisser croire qu'elle a agi.
do $$
declare reste text;
begin
  select string_agg(p.proname, ', ')
    into reste
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('deals_verifier_etape', 'deals_horodater_etape', 'deals_ecrire_historique',
                       'deals_emettre_evenements', 'pipeline_stages_verifier_archivage')
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if reste is not null then
    raise exception 'EXECUTE encore accordé à anon/authenticated sur : %', reste;
  end if;
end $$;

commit;
