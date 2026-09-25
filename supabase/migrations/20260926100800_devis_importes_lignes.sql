-- ───────────────────────────────────────────────────────────────
-- Soumissions importées sans lignes : on leur donne leurs lignes.
--
-- Même défaut et même règle que les factures (20260926100700) :
--   · lignes de la colonne « Line items » (Jobber : « Nom (qté, $total de la
--     ligne), … ») si leur somme égale EXACTEMENT le sous-total ;
--   · sinon, une ligne « Montant importé » égale au sous-total.
-- Une ligne de soumission ne recalcule pas l'en-tête : les montants de la
-- soumission ne bougent pas. Rejouable : seules les soumissions importées
-- encore sans lignes sont visées. L'importeur fait désormais la même chose
-- (server/lib/migration/lignes-facture.ts).
-- ───────────────────────────────────────────────────────────────

with src as (
  select q.id, q.org_id, q.subtotal_cents,
         (select coalesce(s.normalized->>'line_items', s.payload->>'Line items')
            from public.migration_import_records r
            join public.migration_staging_records s on s.id = r.staging_record_id
           where r.entity_table = 'quotes' and r.entity_id = q.id
           order by r.created_at desc
           limit 1) as texte
    from public.quotes q
   where q.deleted_at is null
     and exists (select 1 from public.migration_import_records r where r.entity_table = 'quotes' and r.entity_id = q.id)
     and not exists (select 1 from public.quote_line_items l where l.quote_id = q.id)
),
-- Motif paresseux EN PREMIER (gourmandise de l'expression = premier quantificateur).
lues as (
  select src.id, t.ord, btrim(t.m[1]) as nom, t.m[2]::numeric as qte,
         round(replace(t.m[3], ',', '')::numeric * 100)::bigint as total_ligne
    from src,
         lateral regexp_matches(coalesce(src.texte, ''), '(.*?) \((\d+(?:\.\d+)?), \$([\d,]*\.\d{2})\)(?:, |$)', 'g')
           with ordinality as t(m, ord)
),
valides as (
  select src.id
    from src join lues on lues.id = src.id
   group by src.id, src.subtotal_cents
  having sum(lues.total_ligne) = src.subtotal_cents
     and bool_and(lues.qte > 0 and lues.nom <> '')
),
divisibles as (
  select l.*, (l.qte = trunc(l.qte) and l.total_ligne % l.qte = 0) as exact
    from lues l join valides v on v.id = l.id
)
insert into public.quote_line_items (org_id, quote_id, name, quantity, unit_price_cents, sort_order)
select src.org_id, d.id,
       left(case when d.exact then d.nom else d.nom || ' (× ' || d.qte::text || ')' end, 500),
       case when d.exact then d.qte else 1 end,
       case when d.exact then (d.total_ligne / d.qte)::int else d.total_ligne::int end,
       (d.ord - 1)::int
  from divisibles d join src on src.id = d.id
union all
select src.org_id, src.id, 'Montant importé', 1, src.subtotal_cents, 0
  from src
 where src.subtotal_cents > 0
   and src.id not in (select id from valides);
