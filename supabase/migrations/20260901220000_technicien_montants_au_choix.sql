-- ============================================================================
-- L'accès des techniciens aux montants devient un CHOIX de l'entreprise
-- ============================================================================
-- POURQUOI CE CHANGEMENT
-- La migration 20260901210000 interdisait aux techniciens de voir les
-- montants — en dur, sans recours. C'était appliquer une règle du code
-- (« ZERO financial permissions ») sans laisser à l'entrepreneur le choix.
--
-- Or ce choix lui revient : certaines entreprises veulent que leur
-- contremaître voie les prix sur place, d'autres non. Le propriétaire l'a
-- signalé le 2026-09-01.
--
-- CE QUI EXISTAIT DÉJÀ, ET NE FONCTIONNAIT PAS
-- L'écran /settings/roles AFFICHE les interrupteurs financiers pour le
-- technicien — mais grisés, avec un cadenas et l'infobulle « Verrouillé : les
-- techniciens ne peuvent pas accéder aux données financières ».
-- Trois verrous empilés :
--   1. `SettingsRoles.tsx:125`  — le clic est ignoré ;
--   2. `resolvePermissions()`   — un réglage forcé est écarté en silence ;
--   3. la migration précédente  — la base refusait, quoi qu'il arrive.
-- Cette migration lève le troisième. Les deux premiers sont levés côté code.
--
-- COMMENT LE CHOIX S'EXPRIME
-- `role_templates` porte déjà, par organisation, un préréglage par rôle
-- (`slug`) avec ses permissions en JSON. C'est là qu'atterrit l'écran des
-- rôles, via POST /api/roles/update-preset. La base lit désormais ce
-- réglage au lieu d'imposer sa propre règle.
--
-- PAR DÉFAUT : ACCÈS REFUSÉ
-- Sans réglage explicite, un technicien ne voit pas les montants. Décision du
-- propriétaire : on n'expose rien par accident, l'entrepreneur ouvre quand il
-- fait confiance. Un oubli ne peut donc pas exposer les chiffres.
--
-- Idempotent.
-- ============================================================================

-- ── La fonction qui lit le choix de l'entreprise ────────────────────
create or replace function public.membre_voit_les_montants(p_user uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    -- 1. Les rôles à permission financière par défaut : toujours oui.
    (select true
       from public.memberships m
      where m.user_id = p_user and m.org_id = p_org and m.status = 'active'
        and coalesce(m.role, '') in ('owner', 'admin', 'sales_rep')
      limit 1),

    -- 2. Sinon (technicien, ou tout rôle sans droit par défaut) : ce que
    --    l'entreprise a explicitement réglé dans l'écran des rôles.
    (select (rt.permissions ->> 'financial.view_pricing')::boolean
       from public.memberships m
       join public.role_templates rt
         on rt.org_id = m.org_id and rt.slug = m.role
      where m.user_id = p_user and m.org_id = p_org and m.status = 'active'
        and rt.permissions ? 'financial.view_pricing'
      limit 1),

    -- 3. Aucun réglage : refusé. On n'expose jamais par défaut.
    false
  );
$$;

comment on function public.membre_voit_les_montants(uuid, uuid) is
  'Ce membre a-t-il le droit de voir les montants dans cette organisation ? '
  'owner/admin/sales_rep : toujours. Les autres (technicien) : selon le '
  'préréglage de role_templates, réglable dans /settings/roles. Sans réglage : '
  'non. Voir 20260901220000_technicien_montants_au_choix.sql.';

-- Fonction en security definer : personne ne l'appelle directement.
revoke all on function public.membre_voit_les_montants(uuid, uuid) from public, anon;
grant execute on function public.membre_voit_les_montants(uuid, uuid) to authenticated;

-- ── Les factures suivent le choix ───────────────────────────────────
drop policy if exists invoices_select_org on public.invoices;
create policy invoices_select_org on public.invoices
  as permissive for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
       where m.org_id = invoices.org_id
         and m.user_id = (select auth.uid())
         and m.status = 'active'
    )
    and public.membre_voit_les_montants((select auth.uid()), invoices.org_id)
  );

-- ── Les devis aussi ─────────────────────────────────────────────────
drop policy if exists quotes_select on public.quotes;
create policy quotes_select on public.quotes
  as permissive for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
       where m.org_id = quotes.org_id
         and m.user_id = (select auth.uid())
         and m.status = 'active'
    )
    and public.membre_voit_les_montants((select auth.uid()), quotes.org_id)
  );

-- ── La vue des jobs suit le même choix ──────────────────────────────
-- Les jobs restent VISIBLES dans tous les cas — un technicien a besoin de son
-- travail. Seuls les montants sont masqués, et seulement si l'entreprise l'a
-- choisi ainsi.
create or replace view public.jobs_pour_role
with (security_invoker = true)
as
select
  j."id", j."org_id", j."job_number", j."title", j."client_id", j."client_name",
  j."property_address", j."scheduled_at", j."status", j."currency", j."job_type",
  j."notes", j."invoice_url", j."attachments", j."created_at", j."updated_at",
  j."description", j."deleted_at", j."created_by", j."deal_id", j."lead_id",
  j."team_id", j."address", j."latitude", j."longitude", j."geocoded_at",
  j."geocode_status", j."deleted_by", j."end_at", j."completed_at", j."closed_at",
  j."start_at", j."tax_lines", j."billing_split", j."fts_vector",
  j."salesperson_id", j."requires_invoicing", j."archived_at", j."archived_by",
  j."deposit_required", j."deposit_type", j."deposit_value",
  j."require_payment_method", j."deposit_status", j."property_id", j."tags",
  j."ask_for_review", j."assigned_user_id", j."expenses_cents", j."sale_date",
  j."show_on_leaderboard", j."version", j."tag_ids", j."billing_mode",
  j."auto_charge",
  case when public.membre_voit_les_montants((select auth.uid()), j.org_id) then j."total_cents"    end as "total_cents",
  case when public.membre_voit_les_montants((select auth.uid()), j.org_id) then j."total_amount"   end as "total_amount",
  case when public.membre_voit_les_montants((select auth.uid()), j.org_id) then j."subtotal"       end as "subtotal",
  case when public.membre_voit_les_montants((select auth.uid()), j.org_id) then j."tax_total"      end as "tax_total",
  case when public.membre_voit_les_montants((select auth.uid()), j.org_id) then j."total"          end as "total",
  case when public.membre_voit_les_montants((select auth.uid()), j.org_id) then j."deposit_cents"  end as "deposit_cents",
  case when public.membre_voit_les_montants((select auth.uid()), j.org_id) then j."subtotal_cents" end as "subtotal_cents",
  case when public.membre_voit_les_montants((select auth.uid()), j.org_id) then j."tax_cents"      end as "tax_cents"
from public.jobs j;

comment on view public.jobs_pour_role is
  'Les jobs, montants masqués selon le choix de l''entreprise (écran des rôles). '
  '`security_invoker` : les politiques de `jobs` continuent de s''appliquer. '
  'Voir 20260901220000_technicien_montants_au_choix.sql.';

grant select on public.jobs_pour_role to authenticated;

-- ── Vérification ────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.membre_voit_les_montants(uuid,uuid)') is null then
    raise exception 'La fonction membre_voit_les_montants est absente.';
  end if;
  if to_regclass('public.jobs_pour_role') is null then
    raise exception 'La vue jobs_pour_role est absente.';
  end if;
  raise notice 'L''accès aux montants suit désormais le réglage de chaque entreprise.';
end $$;
