-- ═══════════════════════════════════════════════════════════════
-- Moindre privilège — pipeline_abandonner_deal()
--
-- La fonction est SECURITY INVOKER : la RLS s'applique, donc `anon` ne peut
-- de toute façon modifier aucun deal. Le grant EXECUTE à `anon` hérité des
-- DEFAULT PRIVILEGES de Supabase n'est donc pas une faille.
--
-- On le retire quand même : un visiteur non connecté n'abandonne pas un deal,
-- et laisser la porte entrouverte oblige le prochain lecteur à refaire le
-- raisonnement « est-ce exploitable ? » à chaque audit. La surface d'appel
-- doit dire d'elle-même qui a le droit d'appeler.
--
-- `authenticated` garde son grant : c'est l'app qui appelle cette fonction,
-- et la RLS décide ensuite si CE deal-là lui appartient.
-- ═══════════════════════════════════════════════════════════════

begin;

revoke all on function public.pipeline_abandonner_deal(uuid, text) from public, anon;
grant execute on function public.pipeline_abandonner_deal(uuid, text) to authenticated;

commit;
