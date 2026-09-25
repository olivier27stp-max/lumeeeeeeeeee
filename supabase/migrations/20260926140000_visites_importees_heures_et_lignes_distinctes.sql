-- Visites importées : (1) leur heure, (2) une ligne de job par service.
--
-- Vision Lavage, 2026-09-25. (1) 913 visites étaient à « pas d'heure précise » (00:00–23:59)
-- alors que l'export Jobber « Visits » porte la plage dans UNE colonne « Times »
-- (« 8:30AM - 2:00PM ») que la correspondance n'avait pas reconnue (le code la lit
-- désormais : synonyme « times » → start_time). (2) Le rattrapage 20260926130000 avait
-- regroupé les services d'un job sans facture en UNE ligne « A, B » ; ce sont des
-- produits distincts du catalogue → une ligne par service, sous-total réparti à parts
-- égales (reste des cents sur la dernière), note explicite sur chaque ligne.
-- Ne touche que les dossiers créés par une migration. Rejouable.
begin;
set local lock_timeout = '5s';

-- (1) Heures des visites, depuis la ligne source (Date + Times), heure locale America/Toronto.
with src as (
  select e.id,
         coalesce(s.normalized->>'date', to_char(to_date(s.payload->>'Date', 'Mon DD, YYYY'), 'YYYY-MM-DD')) as jour,
         regexp_match(coalesce(s.payload->>'Times', ''), '^\s*(\d{1,2}:\d{2}\s*[AaPp][Mm])\s*[-–—]\s*(\d{1,2}:\d{2}\s*[AaPp][Mm])\s*$') as plage
    from public.schedule_events e
    join lateral (
      select r.staging_record_id from public.migration_import_records r
       where r.entity_table = 'schedule_events' and r.entity_id = e.id
       order by r.created_at desc limit 1
    ) ir on true
    join public.migration_staging_records s on s.id = ir.staging_record_id
   where e.deleted_at is null
     and (e.start_at at time zone 'America/Toronto')::time = time '00:00'
     and (e.end_at   at time zone 'America/Toronto')::time = time '23:59'
),
heures as (
  select id,
         -- to_timestamp lit en fuseau de session ; « at time zone current_setting('TimeZone') » redonne
         -- l'heure murale telle qu'écrite, que l'on pose ensuite dans le fuseau du bureau.
         (to_timestamp(jour || ' ' || upper(replace(plage[1], ' ', '')), 'YYYY-MM-DD HH12:MIAM') at time zone current_setting('TimeZone')) at time zone 'America/Toronto' as debut,
         (to_timestamp(jour || ' ' || upper(replace(plage[2], ' ', '')), 'YYYY-MM-DD HH12:MIAM') at time zone current_setting('TimeZone')) at time zone 'America/Toronto' as fin
    from src
   where plage is not null and jour is not null
)
update public.schedule_events e
   set start_at = h.debut,
       end_at   = case when h.fin > h.debut then h.fin else h.debut + interval '1 hour' end,
       start_time = h.debut,
       end_time   = case when h.fin > h.debut then h.fin else h.debut + interval '1 hour' end,
       timezone = coalesce(e.timezone, 'America/Toronto'),
       updated_at = now()
  from heures h
 where h.id = e.id;

-- (2) Une ligne par service : remplace la ligne unique « A, B, C » (sans note) des jobs importés.
with cibles as (
  select l.id as ligne_id, l.job_id, l.org_id, l.created_by, l.name, l.unit_price_cents as total
    from public.job_line_items l
   where l.deleted_at is null
     and l.description is null
     and l.name like '%, %'
     and l.qty = 1
     and exists (select 1 from public.migration_import_records r where r.entity_table = 'jobs' and r.entity_id = l.job_id)
     and (select count(*) from public.job_line_items l2 where l2.job_id = l.job_id and l2.deleted_at is null) = 1
),
parts as (
  select c.*, t.nom, t.ord, count(*) over (partition by c.ligne_id) as n
    from cibles c, regexp_split_to_table(c.name, ', ') with ordinality as t(nom, ord)
),
retirees as (
  update public.job_line_items l set deleted_at = now(), updated_at = now()
   where l.id in (select ligne_id from cibles)
  returning l.id
)
insert into public.job_line_items (org_id, job_id, name, qty, unit_price_cents, total_cents, included, created_by, description, created_at)
select p.org_id, p.job_id, left(btrim(p.nom), 500), 1,
       case when p.ord = p.n then p.total - (p.total / p.n) * (p.n - 1) else p.total / p.n end,
       case when p.ord = p.n then p.total - (p.total / p.n) * (p.n - 1) else p.total / p.n end,
       true, p.created_by,
       'Prix réparti à parts égales : l’export Jobber ne donne pas le prix par service.',
       now() + (p.ord - 1) * interval '1 millisecond'
  from parts p
 where exists (select 1 from retirees r where r.id = p.ligne_id);

commit;
