-- ───────────────────────────────────────────────────────────────
-- Champs personnalisés : les valeurs SUIVENT la fiche quand elle en devient une autre.
--
--   devis → job      (quotes.job_id posé : route de l'app, Lumi, tout chemin)
--   job   → facture  (invoices.job_id à la création : create_invoice_from_job,
--                     finish_job_and_prepare_invoice, par visite, par jalon…)
--   devis → facture  (pas de lien en base : la route /quotes/convert-to-invoice
--                     appelle cf_copier_valeurs elle-même)
--
-- Même règle que cf_copier_valeurs_deal_vers_job (inchangée) : champ cible de
-- même clé et même type, non archivé, encore vide sur la fiche cible ; une
-- option se retrouve par son libellé. Une copie ne bloque JAMAIS la conversion.
-- ───────────────────────────────────────────────────────────────

create or replace function public.cf_copier_valeurs(
  p_org uuid, p_de text, p_de_id uuid, p_vers text, p_vers_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nb integer := 0;
  r record;
  v_nouvelle uuid;
  v_option uuid;
  v_existe boolean;
begin
  if p_de not in ('client', 'deal', 'job', 'quote', 'invoice')
     or p_vers not in ('client', 'deal', 'job', 'quote', 'invoice') then
    raise exception 'cf_copier_valeurs : objet invalide (% → %)', p_de, p_vers;
  end if;
  if p_de_id is null or p_vers_id is null or p_de = p_vers then
    return 0;
  end if;
  -- Les deux fiches appartiennent à l'entreprise annoncée.
  execute format('select exists (select 1 from public.%I where id = $1 and org_id = $2)', p_de || 's')
    into v_existe using p_de_id, p_org;
  if not v_existe then return 0; end if;
  execute format('select exists (select 1 from public.%I where id = $1 and org_id = $2)', p_vers || 's')
    into v_existe using p_vers_id, p_org;
  if not v_existe then return 0; end if;

  for r in execute format($q$
    select v.*, fc.id as champ_cible, fc.field_type as type_cible
      from public.custom_field_values v
      join public.custom_fields fs on fs.id = v.field_id
      join public.custom_fields fc on fc.org_id = v.org_id and fc.object_type::text = $3
                                  and fc.key = fs.key and fc.field_type = fs.field_type and fc.archived_at is null
     where v.org_id = $1 and v.%I = $2
       and not exists (select 1 from public.custom_field_values x where x.field_id = fc.id and x.%I = $4)
  $q$, p_de || '_id', p_vers || '_id')
  using p_org, p_de_id, p_vers, p_vers_id
  loop
    v_option := null;
    if r.value_option_id is not null then
      select oc.id into v_option
        from public.custom_field_options os
        join public.custom_field_options oc on oc.field_id = r.champ_cible
                                           and lower(oc.label) = lower(os.label) and oc.archived_at is null
       where os.id = r.value_option_id
       limit 1;
      -- Option sans équivalent dans la liste cible : rien à copier pour ce champ.
      if v_option is null then continue; end if;
    end if;

    execute format($i$
      insert into public.custom_field_values (org_id, field_id, object_type, %I, value_text, value_number,
        value_money_cents, value_currency, value_date, value_timestamp, value_option_id)
      values ($1, $2, $3::public.cf_object_type, $4, $5, $6, $7, $8, $9, $10, $11)
      returning id
    $i$, p_vers || '_id')
    into v_nouvelle
    using r.org_id, r.champ_cible, p_vers, p_vers_id, r.value_text, r.value_number,
      r.value_money_cents, r.value_currency, r.value_date, r.value_timestamp, v_option;

    if r.type_cible = 'dropdown_multi' then
      insert into public.custom_field_value_options (org_id, field_id, value_id, option_id)
      select r.org_id, r.champ_cible, v_nouvelle, oc.id
        from public.custom_field_value_options vo
        join public.custom_field_options os on os.id = vo.option_id
        join public.custom_field_options oc on oc.field_id = r.champ_cible
                                           and lower(oc.label) = lower(os.label) and oc.archived_at is null
       where vo.value_id = r.id
      on conflict do nothing;
    end if;
    v_nb := v_nb + 1;
  end loop;
  return v_nb;
end $$;

revoke all on function public.cf_copier_valeurs(uuid, text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.cf_copier_valeurs(uuid, text, uuid, text, uuid) to service_role;

-- devis → job : quand un devis reçoit son job.
create or replace function public.cf_devis_job_lie()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.job_id is not null and new.job_id is distinct from old.job_id then
    begin
      perform public.cf_copier_valeurs(new.org_id, 'quote', new.id, 'job', new.job_id);
    exception when others then
      raise warning 'cf_copier_valeurs(quote %, job %) : %', new.id, new.job_id, sqlerrm;
    end;
  end if;
  return null;
end $$;

revoke all on function public.cf_devis_job_lie() from public, anon, authenticated;

drop trigger if exists quotes_cf_copier_vers_job on public.quotes;
create trigger quotes_cf_copier_vers_job after update of job_id on public.quotes
  for each row execute function public.cf_devis_job_lie();

-- job → facture : à la création d'une facture liée à un job (ou au rattachement).
create or replace function public.cf_facture_job_liee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.job_id is not null and (tg_op = 'INSERT' or new.job_id is distinct from old.job_id) then
    begin
      perform public.cf_copier_valeurs(new.org_id, 'job', new.job_id, 'invoice', new.id);
    exception when others then
      raise warning 'cf_copier_valeurs(job %, invoice %) : %', new.job_id, new.id, sqlerrm;
    end;
  end if;
  return null;
end $$;

revoke all on function public.cf_facture_job_liee() from public, anon, authenticated;

drop trigger if exists invoices_cf_copier_depuis_job on public.invoices;
create trigger invoices_cf_copier_depuis_job after insert or update of job_id on public.invoices
  for each row execute function public.cf_facture_job_liee();
