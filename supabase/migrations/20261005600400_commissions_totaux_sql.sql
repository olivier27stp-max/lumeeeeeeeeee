-- Audit commissions 2026-09-30 — approuvée par Rafba le 2026-09-30.
--
-- Totaux d'une période calculés EN SQL au lieu de rapatrier chaque ligne
-- (1 000 par aller-retour). Mesuré sur 100 000 commissions/an : ~15 s en
-- lecture paginée, < 1 s ici, totaux identiques au cent.
--
-- Mêmes règles que server/lib/field-sales/commission-periode.ts
-- (totauxCommissions) — un test d'égalité les garde alignées :
--   estimation = pending sans facture ; dû = en attente + approuvé + versé ;
--   reprises à part ; cents entiers ; jour = date locale du fuseau p_tz.
-- Le serveur l'appelle s'il la trouve, sinon il retombe sur la lecture paginée.
-- Réservée au service_role : le serveur applique lui-même la portée « soi ».
create or replace function public.commissions_totaux_periode(
  p_org uuid, p_debut timestamptz, p_fin timestamptz, p_user uuid default null, p_tz text default 'America/Toronto'
) returns jsonb
language sql stable security invoker set search_path = public
as $$
  with e as (
    select id, user_id, invoice_id, status, triggered_at, reverse_reason,
           round(amount * 100)::bigint c, round(coalesce(base_amount, 0) * 100)::bigint b,
           (invoice_id is null and status = 'pending') estimation
    from fs_commission_entries
    where org_id = p_org and deleted_at is null
      and triggered_at >= p_debut and triggered_at < p_fin
      and (p_user is null or user_id = p_user)
  ),
  t as (
    select user_id,
           coalesce(sum(c) filter (where not estimation and status = 'pending'), 0) en_attente_cents,
           coalesce(sum(c) filter (where status = 'approved'), 0) approuve_cents,
           coalesce(sum(c) filter (where status = 'paid'), 0) verse_cents,
           coalesce(sum(c) filter (where status = 'reversed'), 0) repris_cents,
           coalesce(sum(c) filter (where estimation), 0) estime_cents,
           count(distinct invoice_id) filter (where not estimation and status in ('pending', 'approved', 'paid')) ventes,
           coalesce(sum(b) filter (where invoice_id is not null and status <> 'reversed'), 0) base_cents
    from e group by user_id
  )
  select jsonb_build_object(
    'count', (select count(*) from e),
    'ventes', (select count(distinct invoice_id) from e where not estimation and status in ('pending', 'approved', 'paid')),
    'par_rep', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', user_id, 'en_attente_cents', en_attente_cents, 'approuve_cents', approuve_cents,
        'verse_cents', verse_cents, 'repris_cents', repris_cents, 'estime_cents', estime_cents,
        'ventes', ventes, 'base_cents', base_cents)) from t), '[]'::jsonb),
    'par_jour', coalesce((select jsonb_agg(jsonb_build_object('date', d, 'du_cents', s) order by d) from (
        select to_char(triggered_at at time zone p_tz, 'YYYY-MM-DD') d, sum(c) s
        from e where invoice_id is not null and status in ('pending', 'approved', 'paid') group by 1) j), '[]'::jsonb),
    'flagged_ids', coalesce((select jsonb_agg(id) from e where reverse_reason is not null and status <> 'reversed'), '[]'::jsonb)
  );
$$;

revoke all on function public.commissions_totaux_periode(uuid, timestamptz, timestamptz, uuid, text) from public, anon, authenticated;
grant execute on function public.commissions_totaux_periode(uuid, timestamptz, timestamptz, uuid, text) to service_role;
