-- Lumi réservé au forfait Autopilot (décision Rafba, 2026-09-19)
-- ─────────────────────────────────────────────────────────────────
-- Avant : Scale (slug « pro », 250 $/mois) incluait Lumi avec un budget
-- d'inférence de 20 $/mois. Après : seul Autopilot (360 $/mois, 45 $ de
-- budget) donne accès à l'assistant. Lumi devient l'argument de vente qui
-- distingue les deux forfaits.
--
-- Effet sur les clients : AUCUN abonnement actif n'est sur Scale au moment
-- d'écrire (les deux abonnements de prod sont Autopilot), donc personne ne
-- perd un accès en cours. Si un abonnement Scale existait, l'org passerait
-- au comportement « plan sans Lumi » déjà géré par le code
-- (server/lib/lumi/budget.ts : includes_ai faux → étages 0-4 seulement,
-- raccourcis et FAQ continuent de répondre, jamais d'erreur).
--
-- ai_monthly_budget_cents est remis à 0 en même temps qu'includes_ai passe à
-- faux : les deux doivent rester cohérents, parce que `etatBudget` calcule
-- `includes` à partir des DEUX (includes_ai ET budget > 0). Laisser 20 $ sur
-- un plan sans IA ferait croire à un budget disponible dans les rapports.

begin;

update public.plans
   set includes_ai = false,
       ai_monthly_budget_cents = 0,
       updated_at = now()
 where slug = 'pro'
   and includes_ai is true;

-- Garde-fou : Autopilot doit rester le SEUL plan avec Lumi. Si cette
-- migration est rejouée sur un environnement où un autre plan a été ouvert à
-- l'IA entre-temps, on veut le voir échouer plutôt que de le découvrir sur la
-- facture.
do $$
declare
  n integer;
  liste text;
begin
  select count(*), coalesce(string_agg(slug, ', ' order by slug), '')
    into n, liste
    from public.plans
   where includes_ai is true;

  if n <> 1 or liste <> 'autopilot' then
    raise exception 'Lumi doit être activé sur Autopilot uniquement ; plans avec includes_ai = true : « % » (%)', liste, n;
  end if;
end $$;

commit;
