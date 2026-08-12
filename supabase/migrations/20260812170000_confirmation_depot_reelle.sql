-- Confirmation de dépôt : la faire fonctionner, sans créer de doublon
--
-- LE PROBLÈME
-- Le preset `deposit_received` attendait `invoice.paid` portant
-- `payment_type: 'deposit'` dans ses métadonnées. Aucun émetteur ne fournissait
-- cette clé — ni `lib/payments.ts`, ni `routes/automation-events.ts`. La
-- condition était donc TOUJOURS fausse.
--
-- Mesuré en prod : 30 règles actives, badge vert dans l'interface, et zéro
-- envoi depuis la mise en service. Un client qui versait son dépôt ne recevait
-- jamais la confirmation que sa place était réservée.
--
-- La cause profonde : le dépôt d'une soumission ne passe pas par une facture.
-- Le webhook Stripe met à jour `quotes.deposit_status` et n'émettait aucun
-- événement (`server/routes/payments.ts`, bloc `quote_deposit`).
--
-- LE CORRECTIF, EN DEUX MORCEAUX
--   1. Côté code : ce bloc émet désormais `invoice.paid` avec
--      `payment_type: 'deposit'` et `entityType: 'quote'`.
--   2. Côté données (cette migration) : `payment_confirmation` reçoit la
--      condition INVERSE.
--
-- Pourquoi le point 2 est indispensable : `payment_confirmation` avait une
-- condition vide, donc il se déclenche sur TOUS les `invoice.paid`. Sans
-- exclusion, émettre l'événement pour un dépôt ferait partir les deux presets
-- ensemble — « Dépôt bien reçu, votre place est réservée » ET « Paiement reçu,
-- merci » dans la même seconde. On remplacerait un preset muet par un doublon.
--
-- L'opérateur `neq` est bien supporté par `evaluateConditions`
-- (`server/lib/automationEngine.ts`) : vérifié avant d'écrire cette migration.
--
-- Idempotente : rejouée, la condition est déjà posée et rien ne change.

do $$
declare
  v_exclusion integer;
  v_condition integer;
begin
  -- 1. `payment_confirmation` ne doit plus se déclencher sur un dépôt.
  update public.automation_rules
     set conditions = jsonb_build_object('payment_type', jsonb_build_object('neq', 'deposit')),
         description = 'Remercier le client pour son paiement',
         updated_at = now()
   where preset_key = 'payment_confirmation'
     and coalesce(conditions, '{}'::jsonb) = '{}'::jsonb;
  get diagnostics v_exclusion = row_count;

  -- 2. `deposit_received` doit porter la condition qui le cible.
  --
  -- Prod et staging divergent : la prod porte déjà `{"payment_type":"deposit"}`
  -- (30 orgs), staging a une condition VIDE — vestige d'un seed antérieur.
  -- Sans cette seconde passe, les orgs concernées verraient le preset partir à
  -- CHAQUE paiement, en doublon avec `payment_confirmation` : on remplacerait
  -- un preset muet par un preset trop bavard.
  update public.automation_rules
     set conditions = jsonb_build_object('payment_type', 'deposit'),
         updated_at = now()
   where preset_key = 'deposit_received'
     and coalesce(conditions, '{}'::jsonb) = '{}'::jsonb;
  get diagnostics v_condition = row_count;

  raise notice '[depot] % payment_confirmation exclues, % deposit_received ciblées',
    v_exclusion, v_condition;
end $$;
