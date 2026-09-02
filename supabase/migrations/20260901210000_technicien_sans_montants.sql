-- ============================================================================
-- Un technicien ne doit voir aucun montant — la base doit le faire respecter
-- ============================================================================
-- CONSTAT (2026-09-01, banc des rôles du robot de recette)
-- Une session ouverte sous le rôle `technician` lit directement, sans filtre :
--     invoices : total_cents 162690, 17246 …
--     jobs     : total_cents 141500, 42500 …
--
-- Or `src/lib/permissions.ts` est explicite pour ce rôle :
--     « ── ZERO financial permissions ──
--       financial.view_pricing = false … invoices.* = false »
-- et `resolvePermissions()` refuse même un passe-droit qui donnerait une
-- permission financière à un technicien. C'est présenté comme une frontière
-- dure.
--
-- POURQUOI ELLE NE TENAIT PAS
-- Le masquage (`stripFinancialFields`) vit dans l'application, et n'est
-- appliqué côté serveur que sur la route de recherche. Les politiques de
-- lecture, elles, ne filtrent que par ORGANISATION :
--     invoices_select_org : membre de l'org
--     jobs_select_org     : has_org_membership(auth.uid(), org_id)
-- Un technicien qui interroge la base depuis les outils du navigateur — ou
-- n'importe quel client — contourne donc entièrement le masquage.
--
-- RISQUE RÉEL AUJOURD'HUI : NUL, et c'est le bon moment pour corriger.
--     prod    : 33 owner, 6 sales_rep, 1 admin — AUCUN technicien
--     staging : 1 technicien, créé pour ce test
-- Les vendeurs ne sont pas concernés : ils ont `financial.view_pricing`.
-- Le défaut se manifesterait au premier technicien embauché ; la correction
-- serait alors plus risquée, avec des utilisateurs actifs.
--
-- CE QUE FAIT CETTE MIGRATION
--   • `invoices` : lecture refusée aux techniciens (invoices.* = false).
--   • `jobs`     : lecture conservée — un technicien DOIT voir ses jobs — mais
--     à travers une vue qui met les montants à NULL.
--
-- POURQUOI UNE VUE PLUTÔT QU'UNE POLITIQUE POUR LES JOBS
-- PostgreSQL ne sait pas masquer une colonne par politique : une politique
-- filtre des LIGNES, pas des CHAMPS. Retirer la lecture des jobs à un
-- technicien le priverait de son outil de travail. La vue `jobs_pour_role`
-- rend les mêmes lignes, montants blanchis selon le rôle de l'appelant.
--
-- Idempotent : `drop policy if exists` / `create or replace view`.
-- ============================================================================

-- ── 1. Les factures : hors de portée d'un technicien ────────────────
drop policy if exists invoices_select_org on public.invoices;
create policy invoices_select_org on public.invoices
  as permissive for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
       where m.org_id = invoices.org_id
         and m.user_id = (select auth.uid())
         and m.status = 'active'
         -- Tout rôle SAUF technicien : `invoices.* = false` pour lui.
         and coalesce(m.role, '') <> 'technician'
    )
  );

-- ── 1b. Les devis : hors de portée également ────────────────────────
-- `quotes.read` n'est pas dans les permissions du technicien (voir le préréglage
-- `technician` de src/lib/permissions.ts) : un devis porte des montants et une
-- négociation commerciale, sans rapport avec le travail sur le terrain.
-- Seule la LECTURE est modifiée ; insert/update/delete restent inchangés.
drop policy if exists quotes_select on public.quotes;
create policy quotes_select on public.quotes
  as permissive for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
       where m.org_id = quotes.org_id
         and m.user_id = (select auth.uid())
         and m.status = 'active'
         and coalesce(m.role, '') <> 'technician'
    )
  );

-- ── 2. Les jobs : visibles, montants masqués ────────────────────────
-- La politique reste inchangée (un technicien a besoin de ses jobs) ; c'est
-- la vue qui blanchit les montants.
create or replace view public.jobs_pour_role
with (security_invoker = true)
as
-- Colonnes générées depuis la structure RÉELLE de `jobs` : citer une
-- colonne inexistante ferait échouer la vue entière (4 supposées à tort
-- lors du premier essai : city, province, postal_code, assigned_to).
select
  j."id",
  j."org_id",
  j."job_number",
  j."title",
  j."client_id",
  j."client_name",
  j."property_address",
  j."scheduled_at",
  j."status",
  j."currency",
  j."job_type",
  j."notes",
  j."invoice_url",
  j."attachments",
  j."created_at",
  j."updated_at",
  j."description",
  j."deleted_at",
  j."created_by",
  j."deal_id",
  j."lead_id",
  j."team_id",
  j."address",
  j."latitude",
  j."longitude",
  j."geocoded_at",
  j."geocode_status",
  j."deleted_by",
  j."end_at",
  j."completed_at",
  j."closed_at",
  j."start_at",
  j."tax_lines",
  j."billing_split",
  j."fts_vector",
  j."salesperson_id",
  j."requires_invoicing",
  j."archived_at",
  j."archived_by",
  j."deposit_required",
  j."deposit_type",
  j."deposit_value",
  j."require_payment_method",
  j."deposit_status",
  j."property_id",
  j."tags",
  j."ask_for_review",
  j."assigned_user_id",
  j."expenses_cents",
  j."sale_date",
  j."show_on_leaderboard",
  j."version",
  j."tag_ids",
  j."billing_mode",
  j."auto_charge",
  case when public.has_org_role((select auth.uid()), j.org_id, array['owner','admin','sales_rep'])
       then j."total_cents" end as "total_cents",
  case when public.has_org_role((select auth.uid()), j.org_id, array['owner','admin','sales_rep'])
       then j."total_amount" end as "total_amount",
  case when public.has_org_role((select auth.uid()), j.org_id, array['owner','admin','sales_rep'])
       then j."subtotal" end as "subtotal",
  case when public.has_org_role((select auth.uid()), j.org_id, array['owner','admin','sales_rep'])
       then j."tax_total" end as "tax_total",
  case when public.has_org_role((select auth.uid()), j.org_id, array['owner','admin','sales_rep'])
       then j."total" end as "total",
  case when public.has_org_role((select auth.uid()), j.org_id, array['owner','admin','sales_rep'])
       then j."deposit_cents" end as "deposit_cents",
  case when public.has_org_role((select auth.uid()), j.org_id, array['owner','admin','sales_rep'])
       then j."subtotal_cents" end as "subtotal_cents",
  case when public.has_org_role((select auth.uid()), j.org_id, array['owner','admin','sales_rep'])
       then j."tax_cents" end as "tax_cents"
from public.jobs j;

comment on view public.jobs_pour_role is
  'Les jobs, montants masqués pour les rôles sans permission financière '
  '(technicien). `security_invoker` : la vue s''exécute avec les droits de '
  'l''appelant, donc les politiques de `jobs` s''appliquent normalement. '
  'Voir 20260901210000_technicien_sans_montants.sql.';

grant select on public.jobs_pour_role to authenticated;

-- ── Vérification ────────────────────────────────────────────────────
do $$
declare
  n_tech int;
begin
  if not exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
     where c.relname = 'invoices' and p.polname = 'invoices_select_org'
  ) then
    raise exception 'La politique invoices_select_org a disparu.';
  end if;

  if not exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
     where c.relname = 'quotes' and p.polname = 'quotes_select'
  ) then
    raise exception 'La politique quotes_select a disparu.';
  end if;

  if to_regclass('public.jobs_pour_role') is null then
    raise exception 'La vue jobs_pour_role est absente.';
  end if;

  select count(*) into n_tech
    from public.memberships where role = 'technician' and status = 'active';
  raise notice 'Politique et vue en place. % technicien(s) actif(s) concerné(s).', n_tech;
end $$;
