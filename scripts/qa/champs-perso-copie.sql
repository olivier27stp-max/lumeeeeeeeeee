-- Champs personnalisés : copie devis → job → facture (migration 20260926100500).
-- STAGING seulement. Tout se passe dans un bloc qui se termine par une exception :
-- rien n'est conservé, le message RESULTAT donne les constats.
--   node q.mjs -f scripts/qa/champs-perso-copie.sql
-- Attendu : job nombre=42 | liste=bleu t | multi=A,B | type différent f | facture 42 | copiées=1 | 2e appel=0 | org étrangère=0
do $$
declare
  v_org uuid; v_quote uuid; v_job uuid; v_inv uuid; v_inv2 uuid;
  fq_n uuid; fj_n uuid; fi_n uuid; fq_l uuid; fj_l uuid; fq_m uuid; fj_m uuid; fj_x uuid; fq_x uuid;
  oq_a uuid; oq_b uuid; oj_a uuid; oj_b uuid; mq_a uuid; mq_b uuid; mj_a uuid; mj_b uuid;
  v_val uuid; res text := '';
begin
  select org_id into v_org from public.deals where id = '23aa57ee-3ae3-4628-ab35-819215349765';
  select id into v_quote from public.quotes where org_id = v_org and deleted_at is null and job_id is null limit 1;
  select id into v_job from public.jobs where org_id = v_org and deleted_at is null
     and not exists (select 1 from public.custom_field_values x where x.job_id = jobs.id) limit 1;
  select id into v_inv from public.invoices where org_id = v_org and deleted_at is null and status = 'draft' limit 1;
  select id into v_inv2 from public.invoices where org_id = v_org and deleted_at is null and status = 'draft' and id <> v_inv limit 1;

  insert into public.custom_fields (org_id, object_type, key, label, field_type) values (v_org,'quote','','QA copie nombre','number') returning id into fq_n;
  insert into public.custom_fields (org_id, object_type, key, label, field_type) values (v_org,'job','','QA copie nombre','number') returning id into fj_n;
  insert into public.custom_fields (org_id, object_type, key, label, field_type) values (v_org,'invoice','','QA copie nombre','number') returning id into fi_n;
  insert into public.custom_fields (org_id, object_type, key, label, field_type) values (v_org,'quote','','QA copie liste','dropdown_single') returning id into fq_l;
  insert into public.custom_fields (org_id, object_type, key, label, field_type) values (v_org,'job','','QA copie liste','dropdown_single') returning id into fj_l;
  insert into public.custom_fields (org_id, object_type, key, label, field_type) values (v_org,'quote','','QA copie multi','dropdown_multi') returning id into fq_m;
  insert into public.custom_fields (org_id, object_type, key, label, field_type) values (v_org,'job','','QA copie multi','dropdown_multi') returning id into fj_m;
  -- même clé, type différent : ne doit PAS être copié
  insert into public.custom_fields (org_id, object_type, key, label, field_type) values (v_org,'job','','QA copie texte','single_line') returning id into fj_x;
  insert into public.custom_fields (org_id, object_type, key, label, field_type) values (v_org,'quote','','QA copie texte','number') returning id into fq_x;
  insert into public.custom_field_values (org_id, field_id, object_type, quote_id, value_number)
    values (v_org, fq_x, 'quote', v_quote, 7);

  insert into public.custom_field_options (org_id, field_id, label, position) values (v_org, fq_l, 'Rouge', 0) returning id into oq_a;
  insert into public.custom_field_options (org_id, field_id, label, position) values (v_org, fq_l, 'Bleu', 1) returning id into oq_b;
  insert into public.custom_field_options (org_id, field_id, label, position) values (v_org, fj_l, 'bleu', 0) returning id into oj_b;
  insert into public.custom_field_options (org_id, field_id, label, position) values (v_org, fj_l, 'rouge', 1) returning id into oj_a;
  insert into public.custom_field_options (org_id, field_id, label, position) values (v_org, fq_m, 'A', 0) returning id into mq_a;
  insert into public.custom_field_options (org_id, field_id, label, position) values (v_org, fq_m, 'B', 1) returning id into mq_b;
  insert into public.custom_field_options (org_id, field_id, label, position) values (v_org, fj_m, 'B', 0) returning id into mj_b;
  insert into public.custom_field_options (org_id, field_id, label, position) values (v_org, fj_m, 'A', 1) returning id into mj_a;

  insert into public.custom_field_values (org_id, field_id, object_type, quote_id, value_number) values (v_org, fq_n, 'quote', v_quote, 42);
  insert into public.custom_field_values (org_id, field_id, object_type, quote_id, value_option_id) values (v_org, fq_l, 'quote', v_quote, oq_b);
  insert into public.custom_field_values (org_id, field_id, object_type, quote_id) values (v_org, fq_m, 'quote', v_quote) returning id into v_val;
  insert into public.custom_field_value_options (org_id, field_id, value_id, option_id) values (v_org, fq_m, v_val, mq_a), (v_org, fq_m, v_val, mq_b);

  -- 1. devis → job par le trigger
  update public.quotes set job_id = v_job where id = v_quote;
  res := res || format(' | job nombre=%s', (select value_number from public.custom_field_values where field_id=fj_n and job_id=v_job));
  res := res || format(' | job liste=bleu? %s', (select value_option_id = oj_b from public.custom_field_values where field_id=fj_l and job_id=v_job));
  res := res || format(' | job multi=%s', (select string_agg(o.label, ',' order by o.label) from public.custom_field_values v join public.custom_field_value_options vo on vo.value_id=v.id join public.custom_field_options o on o.id=vo.option_id where v.field_id=fj_m and v.job_id=v_job));
  res := res || format(' | type différent copié? %s', exists(select 1 from public.custom_field_values where field_id=fj_x and job_id=v_job));
  -- 2. job → facture par le trigger (rattachement d'une facture brouillon)
  update public.invoices set job_id = v_job where id = v_inv;
  res := res || format(' | facture (trigger) nombre=%s', (select value_number from public.custom_field_values where field_id=fi_n and invoice_id=v_inv));
  -- 3. devis → facture par la fonction (route)
  res := res || format(' | devis→facture copiées=%s', public.cf_copier_valeurs(v_org, 'quote', v_quote, 'invoice', v_inv2));
  -- 4. pas d'écrasement : 2e appel ne copie rien
  res := res || format(' | 2e appel=%s', public.cf_copier_valeurs(v_org, 'quote', v_quote, 'invoice', v_inv2));
  -- 5. autre org : refusé
  res := res || format(' | org étrangère=%s', public.cf_copier_valeurs(gen_random_uuid(), 'quote', v_quote, 'invoice', v_inv2));
  raise exception 'RESULTAT%', res;
end $$;
