-- ───────────────────────────────────────────────────────────────
-- Factures importées sans lignes : on leur donne leurs lignes.
--
-- L'importeur ne créait que l'en-tête des factures (totaux). Conséquences :
-- un brouillon importé s'ouvrait à 0 $ dans l'éditeur (l'enregistrer effaçait
-- son montant), le PDF n'avait aucun détail, et l'invariant
-- invoice_totals_balance les signalait (638, toutes chez Vision Lavage).
-- L'importeur les crée désormais (server/lib/migration/lignes-facture.ts) ;
-- ceci rattrape les factures déjà importées, avec LA MÊME règle :
--   · lignes de la colonne « Line items » (Jobber : « Nom (qté, $total de la
--     ligne), … ») si leur somme égale EXACTEMENT le sous-total ;
--   · sinon, une ligne « Montant importé » égale au sous-total.
-- Le total ne bouge donc jamais. Tout part en UNE instruction : le recalcul
-- (trigger par ligne, exécuté en fin d'instruction) voit la somme complète,
-- ce que la protection des factures émises exige (prouvé sur staging).
-- Rejouable : seules les factures importées encore sans lignes sont visées.
-- ───────────────────────────────────────────────────────────────

with src as (
  select i.id, i.org_id, i.subtotal_cents,
         (select coalesce(s.normalized->>'line_items', s.payload->>'Line items')
            from public.migration_import_records r
            join public.migration_staging_records s on s.id = r.staging_record_id
           where r.entity_table = 'invoices' and r.entity_id = i.id
           order by r.created_at desc
           limit 1) as texte
    from public.invoices i
   where i.deleted_at is null
     and exists (select 1 from public.migration_import_records r where r.entity_table = 'invoices' and r.entity_id = i.id)
     and not exists (select 1 from public.invoice_items ii where ii.invoice_id = i.id and ii.deleted_at is null)
),
-- Motif paresseux EN PREMIER : en PostgreSQL, la gourmandise de toute
-- l'expression suit son premier quantificateur.
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
insert into public.invoice_items (org_id, invoice_id, description, qty, unit_price_cents, sort_order)
select src.org_id, d.id,
       case when d.exact then d.nom else d.nom || ' (× ' || d.qte::text || ')' end,
       case when d.exact then d.qte else 1 end,
       case when d.exact then (d.total_ligne / d.qte)::int else d.total_ligne::int end,
       (d.ord - 1)::int
  from divisibles d join src on src.id = d.id
union all
select src.org_id, src.id, 'Montant importé', 1, src.subtotal_cents, 0
  from src
 where src.subtotal_cents > 0
   and src.id not in (select id from valides);
