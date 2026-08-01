-- ============================================================================
-- AUDIT 2026-07-31 — Correctifs des 4 bloqueurs V1 (fuites d'isolation via anon)
-- ============================================================================
-- Réf. rapport : AUDIT_REPORT.md §2 (GO/NO-GO) + C1-01, C1-02, C1-03, C1-06.
--
-- Les 3 policies `anon` supprimées ici sont VESTIGIALES : aucune n'est utilisée
-- par l'application. Les flux publics légitimes (page de devis, soumission de
-- sondage, tracking de vue) passent par le service-client serveur, token-lié :
--   - devis public       : server/routes/quotes.ts:704-727 (getServiceClient)
--   - sondage public      : server/routes/surveys.ts:18,88 (getServiceClient)
--   - tracking de vue     : server/routes/quotes.ts:118,206 (getServiceClient)
-- Le service_role a rolbypassrls=true : ces DROP ne cassent donc aucun flux.
--
-- IDÉMPOTENT et sûr à rejouer. ROLLBACK en bas du fichier (commenté).
-- NE PAS appliquer à l'aveugle : relire, puis `npm run db:apply` (ou psql).
-- ============================================================================

begin;

-- ── C1-01 [CRITIQUE] ────────────────────────────────────────────────────────
-- quote_line_items_public_read : USING (view_token IS NOT NULL) est une
-- tautologie (view_token uuid NOT NULL DEFAULT gen_random_uuid()). La table n'a
-- pas de org_id. => tout porteur de la clé anon lit les lignes de devis de TOUS
-- les tenants. Le SELECT authentifié reste couvert par quote_line_items_select.
drop policy if exists quote_line_items_public_read on public.quote_line_items;

-- ── C1-02 [CRITIQUE] ────────────────────────────────────────────────────────
-- surveys_update_anon : UPDATE anon sans liaison token/org (USING submitted_at
-- IS NULL). Le correctif du 2026-05-12 ciblait `public.surveys` (table
-- inexistante) au lieu de `public.satisfaction_surveys`, donc n'a jamais pris.
-- On drop sur le BON nom de table.
drop policy if exists surveys_update_anon on public.satisfaction_surveys;

-- ── C1-03 [MAJEUR] ──────────────────────────────────────────────────────────
-- quote_views_insert_anon : INSERT anon contre n'importe quelle facture non
-- supprimée (oracle d'existence d'ID + pollution analytics).
drop policy if exists quote_views_insert_anon on public.quote_views;

-- ── C1-06 [MINEUR, mais enabler de C1-05] ──────────────────────────────────
-- plans_public_read : SELECT USING(true) pour {anon, authenticated}. Expose à
-- l'anon les IDs Stripe (product/price/coupon) + flags d'entitlement, et fournit
-- le plan_id UUID qui sert d'amorce au scénario webhook C1-05.
-- Le catalogue est déjà servi au front via l'endpoint serveur GET /api/billing/plans
-- (billing.ts:45) ; le serveur lit `plans` en service_role (bypass RLS). Aucun
-- code front ne lit `plans` via supabase-js (grep from('plans') dans src/ = 0).
-- => on retire l'accès anon. On conserve un accès en lecture aux membres
--    authentifiés (inoffensif, et évite toute régression d'un chemin non repéré).
drop policy if exists plans_public_read on public.plans;

drop policy if exists plans_authenticated_read on public.plans;
create policy plans_authenticated_read on public.plans
  for select
  to authenticated
  using (true);

commit;

-- ============================================================================
-- ROLLBACK (décommenter et exécuter pour revenir à l'état antérieur) :
-- ----------------------------------------------------------------------------
-- begin;
--   create policy quote_line_items_public_read on public.quote_line_items
--     for select to anon
--     using (exists (select 1 from public.quotes q
--                    where q.id = quote_line_items.quote_id
--                      and q.view_token is not null));
--   create policy surveys_update_anon on public.satisfaction_surveys
--     for update to anon
--     using (submitted_at is null)
--     with check (submitted_at is not null);
--   create policy quote_views_insert_anon on public.quote_views
--     for insert to anon
--     with check (exists (select 1 from public.invoices i
--                         where i.id = quote_views.invoice_id
--                           and i.deleted_at is null));
--   drop policy if exists plans_authenticated_read on public.plans;
--   create policy plans_public_read on public.plans
--     for select to anon, authenticated using (true);
-- commit;
-- ============================================================================

-- ── Vérification post-migration (à lancer manuellement, ne modifie rien) ────
-- select tablename, policyname, roles
--   from pg_policies
--  where schemaname = 'public'
--    and 'anon' = any (roles)
--    and (qual = 'true' or with_check = 'true'
--         or tablename in ('quote_line_items','satisfaction_surveys','quote_views'))
--  order by tablename, policyname;
-- Attendu : plus aucune ligne anon permissive sur ces 4 tables.
