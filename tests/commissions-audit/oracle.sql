-- ============================================================================
-- ORACLE des commissions — calcul INDÉPENDANT du moteur (audit 2026-09-30).
--
-- Ne réutilise aucune ligne de fs_commission_entries : part des factures, des
-- jobs, des devis, des fiches Équipe et des règles, et recalcule en SQL ce que
-- chaque rep DOIT toucher. $1 = uuid[] des orgs, $2 = jsonb de l'historique
-- des taux (il n'existe pas d'historique des règles en base).
--
-- Règles appliquées (codées = C, exigées par le brief = B, décision en
-- attente = D — l'oracle suit alors le comportement codé) :
--   B  base = sous-total − rabais, AVANT taxes
--   C  gagnée quand la facture est soldée (status = 'paid'), à paid_at
--   B  mois (paliers, périodes) = mois civil dans le fuseau de l'entreprise
--   C  rep = devis du job → lead → job.salesperson_id → job.created_by
--   C  membre « à l'heure » = aucune commission ; sans plan = aucune
--   C  règle assignée au rep, sinon plan par défaut
--   D11 taux = celui en vigueur au paiement
--   C  paliers additifs : bonus % sur la facture qui franchit / dépasse le seuil,
--      cumul = factures GAGNÉES du rep plus tôt dans le même mois
--   D7 split = parts de la règle, normalisées par leur somme ;
--   B  Σ parts = montant exact (plus grand reste), jamais > 100 %
--   C  politique 'auto' : remboursée avant versement → reprise ; versée → reste
--   D10 rep désactivé : touche quand même (comportement codé)
--   C  facture sans job → aucune commission (D17)
-- ============================================================================
with
params as (select $1::uuid[] as orgs, $2::jsonb as taux),
fuseau as (
  select o.id org_id, coalesce(cs.timezone, 'America/Toronto') tz
  from orgs o left join company_settings cs on cs.org_id = o.id
  where o.id = any($1::uuid[])
),
factures as (
  select i.id, i.org_id, i.job_id, i.status, i.paid_at,
         greatest(i.subtotal_cents - least(coalesce(i.discount_cents, 0), i.subtotal_cents), 0) as base_cents,
         to_char(i.paid_at at time zone fz.tz, 'YYYY-MM') as mois
  from invoices i join fuseau fz on fz.org_id = i.org_id
  where i.paid_at is not null or exists (
    select 1 from payments p where p.invoice_id = i.id and p.status in ('succeeded', 'refunded')
  )
),
-- Date où la facture a été soldée, même si un remboursement l'a « rouverte »
-- depuis (paid_at est alors remis à null par le trigger).
soldees as (
  select fa.*, coalesce(fa.paid_at, (
    select max(p.payment_date) from payments p where p.invoice_id = fa.id and p.status in ('succeeded','refunded')
  )) as soldee_le,
  exists (select 1 from payments p where p.invoice_id = fa.id and p.status = 'refunded') as remboursee
  from factures fa
  where fa.status = 'paid'
     or (select coalesce(sum(p.amount_cents), 0) from payments p where p.invoice_id = fa.id and p.status in ('succeeded','refunded'))
        >= (select total_cents from invoices where id = fa.id)
),
avec_rep as (
  select s.*, coalesce(
    (select q.salesperson_id from quotes q where q.job_id = s.job_id and q.org_id = s.org_id and q.deleted_at is null order by q.created_at desc limit 1),
    (select c.assigned_to from quotes q join clients c on c.id = q.lead_id where q.job_id = s.job_id and q.deleted_at is null order by q.created_at desc limit 1),
    (select coalesce(j.salesperson_id, j.created_by) from jobs j where j.id = s.job_id)
  ) as rep
  from soldees s
  where s.job_id is not null
),
avec_regle as (
  select a.*, r.id as regle_id, r.base_kind, r.base_value_cents, r.performance_tiers, r.attribution,
         coalesce((
           select (h->>'pourcent')::numeric from jsonb_array_elements((select taux from params)) h
           where (h->>'regle')::uuid = r.id and (h->>'depuis')::timestamptz <= a.soldee_le
           order by (h->>'depuis')::timestamptz desc limit 1
         ), r.base_percent) as pourcent
  from avec_rep a
  join team_members tm on tm.org_id = a.org_id and tm.user_id = a.rep and tm.compensation_mode in ('commission', 'both')
  join lateral (
    select r.* from fs_commission_rules r
    where r.org_id = a.org_id and r.is_active and r.deleted_at is null
      and (a.rep = any(r.assigned_user_ids)
           or (r.id = (select default_rule_id from commission_settings where org_id = a.org_id)
               and not exists (select 1 from fs_commission_rules r2 where r2.org_id = a.org_id and r2.is_active and r2.deleted_at is null and a.rep = any(r2.assigned_user_ids))))
    order by (a.rep = any(r.assigned_user_ids)) desc, r.priority desc limit 1
  ) r on true
),
cumul as (
  select x.*,
         coalesce(sum(x.base_cents) over (partition by x.org_id, x.rep, x.mois order by x.soldee_le rows between unbounded preceding and 1 preceding), 0) as cumul_avant
  from avec_regle x
),
montant as (
  select c.*,
    (case when c.base_kind = 'flat' then coalesce(c.base_value_cents, 0)
          else round(c.base_cents * c.pourcent / 100.0) end)
    + coalesce((
        select sum(
          case when (t->>'metric') = 'sale_count' then
                 case when (select count(*) from avec_regle y where y.org_id = c.org_id and y.rep = c.rep and y.mois = c.mois and y.soldee_le < c.soldee_le) + 1 >= (t->>'threshold')::numeric
                      then round(c.base_cents * coalesce((t->>'modifier_percent')::numeric, 0) / 100.0) + coalesce((t->>'modifier_flat_cents')::numeric, 0) else 0 end
               else
                 case when c.cumul_avant + c.base_cents >= (t->>'threshold')::numeric
                      then round(c.base_cents * coalesce((t->>'modifier_percent')::numeric, 0) / 100.0) + coalesce((t->>'modifier_flat_cents')::numeric, 0) else 0 end
          end)
        from jsonb_array_elements(coalesce(c.performance_tiers, '[]'::jsonb)) t), 0) as total_cents
  from cumul c
),
parts as (
  select m.*, s.ord, (s.v->>'user_id')::uuid as beneficiaire, (s.v->>'pct')::numeric as pct,
         sum((s.v->>'pct')::numeric) over (partition by m.id) as somme_pct
  from montant m
  cross join lateral (
    select v, ord from jsonb_array_elements(
      case when m.attribution->>'mode' = 'split' and jsonb_typeof(m.attribution->'splits') = 'array'
           then m.attribution->'splits'
           else jsonb_build_array(jsonb_build_object('user_id', m.rep, 'pct', 100)) end
    ) with ordinality as a(v, ord)
  ) s
),
-- Plus grand reste : chaque part reçoit floor(), puis les cents restants vont
-- aux plus grands restes (ordre des parts en cas d'égalité).
plancher as (
  select p.*, floor(p.total_cents * p.pct / p.somme_pct) as bas,
         (p.total_cents * p.pct / p.somme_pct) - floor(p.total_cents * p.pct / p.somme_pct) as reste
  from parts p
),
reparti as (
  select pl.*,
         pl.bas + case when row_number() over (partition by pl.id order by pl.reste desc, pl.ord)
                          <= pl.total_cents - sum(pl.bas) over (partition by pl.id) then 1 else 0 end as part_cents
  from plancher pl
)
select r.org_id, r.id as invoice_id, r.beneficiaire as user_id, r.part_cents::bigint as montant_cents,
       r.base_cents::bigint as base_cents, r.mois, r.soldee_le,
       case when r.remboursee and not exists (
              select 1 from payroll_payments pp
              where pp.org_id = r.org_id and pp.user_id = r.beneficiaire
                and (r.soldee_le at time zone (select tz from fuseau where org_id = r.org_id))::date between pp.period_start and pp.period_end)
            then 'reprise' else 'active' end as etat
from reparti r
where r.part_cents > 0
order by r.org_id, r.soldee_le, r.beneficiaire;
