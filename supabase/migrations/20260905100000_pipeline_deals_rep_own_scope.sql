-- ════════════════════════════════════════════════════════════════════
-- RLS: pipeline_deals rejoint le scoping « rep ne voit que les siens »
-- ────────────────────────────────────────────────────────────────────
-- 20260629000000_rls_rep_own_scope.sql a posé des policies RESTRICTIVE sur
-- leads / clients / quotes / jobs mais avait oublié pipeline_deals : un
-- sales_rep voyait (et pouvait modifier via PostgREST) tous les deals de
-- l'org — titre, valeur, notes inclus.
-- Décision produit 2026-09-05 : un sales_rep ne voit que ses propres deals.
--
-- Même approche additive : une policy RESTRICTIVE est AND-ée avec les
-- policies org permissives existantes, elle ne peut que RÉDUIRE la
-- visibilité. Le service_role (API serveur) bypasse la RLS — le scoping du
-- GET/PUT /api/field-sales/pipeline est fait dans le handler (même commit).
-- Réutilise public.org_restricted_to_own() posée par 20260629000000.
--
-- ROLLBACK :
--   drop policy if exists pipeline_deals_rep_own_scope  on public.pipeline_deals;
--   drop policy if exists pipeline_deals_rep_own_update on public.pipeline_deals;
--   drop policy if exists pipeline_deals_rep_own_delete on public.pipeline_deals;
-- ════════════════════════════════════════════════════════════════════

drop policy if exists pipeline_deals_rep_own_scope on public.pipeline_deals;
create policy pipeline_deals_rep_own_scope on public.pipeline_deals
  as restrictive for select to authenticated
  using (
    not public.org_restricted_to_own((select auth.uid()), org_id)
    or rep_id     = (select auth.uid())
    or created_by = (select auth.uid())
  );

drop policy if exists pipeline_deals_rep_own_update on public.pipeline_deals;
create policy pipeline_deals_rep_own_update on public.pipeline_deals
  as restrictive for update to authenticated
  using (
    not public.org_restricted_to_own((select auth.uid()), org_id)
    or rep_id     = (select auth.uid())
    or created_by = (select auth.uid())
  );

drop policy if exists pipeline_deals_rep_own_delete on public.pipeline_deals;
create policy pipeline_deals_rep_own_delete on public.pipeline_deals
  as restrictive for delete to authenticated
  using (
    not public.org_restricted_to_own((select auth.uid()), org_id)
    or rep_id     = (select auth.uid())
    or created_by = (select auth.uid())
  );
