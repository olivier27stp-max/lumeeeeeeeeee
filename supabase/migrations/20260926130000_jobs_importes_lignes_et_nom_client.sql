-- Jobs importés : (1) leurs lignes de services, (2) un vrai nom de client.
--
-- Vision Lavage, 2026-09-24 : 896 jobs importés sans aucune ligne (la fiche et la visite
-- ne montraient que le total) et 220 jobs dont la colonne Client affichait un courriel
-- (jobs.client_name recevait la référence source — « Client email » quand elle était la
-- clé de rattachement — au lieu du nom de la fiche client).
--
-- (1) Lignes. L'export Jobber « One-Off Jobs » ne porte que les NOMS des services, sans
-- montant. Règle, identique au code (server/lib/migration/lignes-facture.ts) :
--   a. si une facture du job a des lignes réelles dont la somme égale EXACTEMENT le
--      sous-total du job → le job reçoit ces lignes (vrais prix unitaires) ;
--   b. sinon UNE ligne dont le nom est la liste des services, au sous-total du job ;
--   c. sans texte, « Montant importé ». Le total du job ne bouge jamais, rien n'est inventé.
-- Ne touche que les jobs créés par une migration et encore sans ligne active.
-- Le trigger crm_enforce_scope exige org_id et created_by sans contexte auth : fournis.
begin;
set local lock_timeout = '5s';

with src as (
  select j.id, j.org_id, j.subtotal_cents,
         coalesce(j.created_by, m.created_by) as created_by,
         (select coalesce(s.normalized->>'line_items', s.payload->>'Line items')
            from public.migration_import_records r2
            join public.migration_staging_records s on s.id = r2.staging_record_id
           where r2.entity_table = 'jobs' and r2.entity_id = j.id
           order by r2.created_at desc
           limit 1) as texte
    from public.jobs j
    join lateral (
      select r.migration_id from public.migration_import_records r
       where r.entity_table = 'jobs' and r.entity_id = j.id
       order by r.created_at desc limit 1
    ) ir on true
    join public.data_migrations m on m.id = ir.migration_id
   where j.deleted_at is null
     and not exists (select 1 from public.job_line_items l where l.job_id = j.id and l.deleted_at is null)
),
fact as (
  -- lignes réelles des factures actives rattachées au job
  select src.id as job_id, ii.description, ii.qty, ii.unit_price_cents,
         row_number() over (partition by src.id order by i.created_at, ii.sort_order, ii.created_at) as ord
    from src
    join public.invoices i on i.job_id = src.id and i.deleted_at is null
    join public.invoice_items ii on ii.invoice_id = i.id and ii.deleted_at is null
),
copiables as (
  select f.job_id
    from fact f join src on src.id = f.job_id
   group by f.job_id, src.subtotal_cents
  having sum(round(f.qty * f.unit_price_cents)) = src.subtotal_cents
     and bool_and(f.description <> 'Montant importé')
     and src.subtotal_cents > 0
),
noms as (
  select src.id,
         nullif(btrim(regexp_replace(coalesce(src.texte, ''), '\s*\((\d+(\.\d+)?)(,\s*\$[\d,]*\.\d{2})?\)', '', 'g')), '') as liste
    from src
)
insert into public.job_line_items (org_id, job_id, name, qty, unit_price_cents, total_cents, included, created_by, created_at)
select src.org_id, f.job_id, left(f.description, 500), f.qty, f.unit_price_cents,
       round(f.qty * f.unit_price_cents)::int, true, src.created_by,
       now() + (f.ord - 1) * interval '1 millisecond'
  from fact f
  join copiables c on c.job_id = f.job_id
  join src on src.id = f.job_id
union all
select src.org_id, src.id, left(coalesce(n.liste, 'Montant importé'), 500), 1,
       greatest(src.subtotal_cents, 0), greatest(src.subtotal_cents, 0), true, src.created_by, now()
  from src
  join noms n on n.id = src.id
 where src.id not in (select job_id from copiables)
   and (src.subtotal_cents > 0 or n.liste is not null);

-- (2) Nom du client : la fiche client fait foi dès que client_name est vide ou ressemble à un courriel.
update public.jobs j
   set client_name = coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), nullif(btrim(c.company), ''), j.client_name)
  from public.clients c
 where c.id = j.client_id
   and j.deleted_at is null
   and (j.client_name is null or btrim(j.client_name) = '' or j.client_name ~ '@')
   and exists (select 1 from public.migration_import_records r where r.entity_table = 'jobs' and r.entity_id = j.id);

commit;
