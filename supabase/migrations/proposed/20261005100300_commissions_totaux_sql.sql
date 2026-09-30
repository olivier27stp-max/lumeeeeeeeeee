-- ============================================================================
-- PROPOSÉE — NE PAS APPLIQUER SANS L'OK DE RAFBA (audit commissions 2026-09-30)
-- À appliquer APRÈS 20261005100200 (index de période).
--
-- Totaux d'une période calculés EN SQL au lieu de rapatrier chaque ligne.
-- Mesuré sur 100 000 commissions/an (tenant de test) : la lecture paginée
-- exacte prend ~14 s pour une année (100 allers-retours PostgREST), la même
-- agrégation en SQL quelques dizaines de ms.
--
-- Mêmes règles que server/lib/field-sales/commission-periode.ts
-- (totauxCommissions) : estimation = pending sans facture ; dû = en attente +
-- approuvé + versé ; reprises à part ; cents entiers. Après application, le
-- serveur (getPayrollPreview, buildPeriodRows) appellera cette fonction — un
-- test d'égalité avec totauxCommissions() sur le tenant de test garde les deux
-- définitions identiques.
--
-- Réservée au service_role (le serveur applique déjà la portée « soi »).
-- ============================================================================
create or replace function public.commissions_totaux_periode(
  p_org uuid, p_debut timestamptz, p_fin timestamptz, p_user uuid default null
) returns jsonb
language sql stable security invoker set search_path = public
as $$
  with e as (
    select user_id, invoice_id, status, round(amount * 100)::bigint c, round(coalesce(base_amount, 0) * 100)::bigint b,
           (invoice_id is null and status = 'pending') estimation
    from fs_commission_entries
    where org_id = p_org and deleted_at is null
      and triggered_at >= p_debut and triggered_at < p_fin
      and (p_user is null or user_id = p_user)
  ),
  par_rep as (
    select user_id,
           coalesce(sum(c) filter (where not estimation and status in ('pending','approved','paid')), 0) du_cents,
           coalesce(sum(c) filter (where not estimation and status = 'pending'), 0) en_attente_cents,
           coalesce(sum(c) filter (where status = 'approved'), 0) approuve_cents,
           coalesce(sum(c) filter (where status = 'paid'), 0) verse_cents,
           coalesce(sum(c) filter (where status = 'reversed'), 0) repris_cents,
           coalesce(sum(c) filter (where estimation), 0) estime_cents,
           count(distinct invoice_id) filter (where not estimation and status <> 'reversed') ventes,
           coalesce(sum(b) filter (where invoice_id is not null and status <> 'reversed'), 0) base_cents
    from e group by user_id
  )
  select jsonb_build_object(
    'count', (select count(*) from e),
    'totaux', (select jsonb_build_object(
        'du_cents', coalesce(sum(du_cents), 0), 'en_attente_cents', coalesce(sum(en_attente_cents), 0),
        'approuve_cents', coalesce(sum(approuve_cents), 0), 'verse_cents', coalesce(sum(verse_cents), 0),
        'repris_cents', coalesce(sum(repris_cents), 0), 'estime_cents', coalesce(sum(estime_cents), 0),
        'ventes', (select count(distinct invoice_id) from e where not estimation and status <> 'reversed'))
      from par_rep),
    'par_rep', coalesce((select jsonb_agg(to_jsonb(p) order by p.du_cents desc) from par_rep p), '[]'::jsonb)
  );
$$;

revoke all on function public.commissions_totaux_periode(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.commissions_totaux_periode(uuid, timestamptz, timestamptz, uuid) to service_role;
