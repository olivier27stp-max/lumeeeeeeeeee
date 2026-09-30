-- Autopilot : « Lume AI Agent (voice + unlimited) » → 1 000 crédits Lumi / mois.
--
-- POURQUOI (décision D7 de Rafba, 2026-09-30) : « illimité » était faux — le
-- forfait a un plafond, désormais exprimé en crédits Lumi (20261005200000).
-- Le texte vient de plans.features (affiché dans Facturation et à
-- l'inscription, traduit par src/lib/planFeatures.ts).
--
-- DOWN :
--   update public.plans
--      set features = (select jsonb_agg(case when e = to_jsonb('Lume AI Agent (voice) — 1,000 Lumi credits / month'::text)
--                                            then to_jsonb('Lume AI Agent (voice + unlimited)'::text) else e end)
--                        from jsonb_array_elements(features) e)
--    where slug = 'autopilot';

update public.plans
   set features = (
     select jsonb_agg(
              case when e = to_jsonb('Lume AI Agent (voice + unlimited)'::text)
                   then to_jsonb('Lume AI Agent (voice) — 1,000 Lumi credits / month'::text)
                   else e end
              order by o)
       from jsonb_array_elements(features) with ordinality as t(e, o))
 where slug = 'autopilot'
   and features @> to_jsonb(array['Lume AI Agent (voice + unlimited)']);
