-- Agent E — 5 000 clients FICTIFS dans MON bureau B (suffixe e) de la pile LOCALE, pour mesurer
-- le compteur « Touche X clients » (point 6 de la mission). Idempotent : repart de zéro.
--
--   MSYS_NO_PATHCONV=1 docker exec -i -u postgres lumefinal-db psql -U supabase_admin -d postgres \
--     -v org=<id du bureau B (e)> -v proprio=<id du propriétaire B> -f - < scripts/qa/finale/e/charge-5000-clients.sql
--
-- Numéros en +1 555 000 xxxx (indicatif 555 : jamais attribué), adresses en lume-qa.test.
-- Le bureau est inscrit au bac à sable : rien ne peut partir vers ces fiches.
\set ON_ERROR_STOP on
begin;

delete from public.sms_opt_outs where org_id = :'org' and reason = 'E-CHARGE';
delete from public.email_unsubscribes where org_id = :'org' and reason = 'E-CHARGE';
delete from public.clients where org_id = :'org' and last_name like 'E-CHARGE %';

insert into public.clients (org_id, created_by, first_name, last_name, email, phone, status, company, city, sms_consent_at, email_consent_at)
select :'org', :'proprio', 'Charge', 'E-CHARGE ' || g, 'e-charge-' || g || '@lume-qa.test', '+1555000' || lpad(g::text, 4, '0'),
       case when g % 7 = 0 then 'lead' else 'active' end,
       case when g % 5 = 0 then 'Entreprise ' || g end,
       (array['Montréal', 'Laval', 'Longueuil', 'Québec'])[1 + g % 4], now(), now()
  from generate_series(1, 5000) g;

-- Étiquettes : 30 % VIP, 20 % Commercial, 10 % « Ne pas relancer ».
insert into public.client_tags (client_id, tag)
select c.id, t.tag
  from public.clients c
  cross join lateral (
    select 'VIP' as tag where (substring(c.last_name from 10)::int) % 10 < 3
    union all select 'Commercial' where (substring(c.last_name from 10)::int) % 5 = 0
    union all select 'Ne pas relancer' where (substring(c.last_name from 10)::int) % 10 = 9
  ) t
 where c.org_id = :'org' and c.last_name like 'E-CHARGE %';

-- Champ personnalisé « Référé par » (texte) : Facebook / Google / Bouche à oreille / vide.
insert into public.custom_field_values (org_id, field_id, object_type, client_id, value_text)
select :'org', f.id, 'client', c.id,
       (array['Facebook', 'Google', 'Bouche à oreille'])[1 + (substring(c.last_name from 10)::int) % 4]
  from public.clients c
  join public.custom_fields f on f.org_id = c.org_id and f.object_type = 'client' and f.key = 'refere_par'
 where c.org_id = :'org' and c.last_name like 'E-CHARGE %' and (substring(c.last_name from 10)::int) % 4 <> 3;

-- « Aucune demande d'avis (noreview) » cochée pour 5 %.
insert into public.custom_field_values (org_id, field_id, object_type, client_id, value_boolean)
select :'org', f.id, 'client', c.id, true
  from public.clients c
  join public.custom_fields f on f.org_id = c.org_id and f.object_type = 'client' and f.key = 'noreview'
 where c.org_id = :'org' and c.last_name like 'E-CHARGE %' and (substring(c.last_name from 10)::int) % 20 = 0;

-- STOP texto pour 3 %, désabonnement courriel pour 2 %.
insert into public.sms_opt_outs (org_id, phone, reason)
select :'org', c.phone, 'E-CHARGE' from public.clients c
 where c.org_id = :'org' and c.last_name like 'E-CHARGE %' and (substring(c.last_name from 10)::int) % 33 = 0
on conflict do nothing;
insert into public.email_unsubscribes (org_id, email, category, reason)
select :'org', lower(c.email), 'all', 'E-CHARGE' from public.clients c
 where c.org_id = :'org' and c.last_name like 'E-CHARGE %' and (substring(c.last_name from 10)::int) % 50 = 0;

commit;

select (select count(*) from public.clients where org_id = :'org' and last_name like 'E-CHARGE %') as clients,
       (select count(*) from public.client_tags t join public.clients c on c.id = t.client_id where c.org_id = :'org') as etiquettes,
       (select count(*) from public.custom_field_values where org_id = :'org') as valeurs_de_champs,
       (select count(*) from public.sms_opt_outs where org_id = :'org') as stop_texto,
       (select count(*) from public.email_unsubscribes where org_id = :'org') as desabonnes_courriel;
