-- Fusion de deux fiches clients : impossible dès que l'absorbée a une facture
-- émise. fusionner_clients() réassigne invoices.client_id, et le trigger
-- invoices_immutable (20260730130000) refuse tout changement de client_id sur
-- une facture non brouillon (42501 « Cette facture a deja ete emise »). Vu par
-- le seed de la batterie Lumi du 2026-09-16 : « Gagnon : 2 fiches → fusion »
-- → refus, pour les deux doublons de l'org QA. La route de l'app (service_role)
-- échoue pareil : le trigger ne regarde pas le rôle.
--
-- Correctif : la fusion pose un drapeau de transaction (set_config local) que
-- le trigger honore UNIQUEMENT pour client_id — montants, numéro, dates et
-- objet restent verrouillés, fusion ou pas.
--
-- NON APPLIQUÉE : à passer sur staging puis en prod après approbation (règle 2).

begin;

create or replace function public.enforce_invoice_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(old.status, 'draft') = 'draft' then
    return new;
  end if;

  if new.total_cents    is distinct from old.total_cents
  or new.subtotal_cents is distinct from old.subtotal_cents
  or new.tax_cents      is distinct from old.tax_cents
  or new.invoice_number is distinct from old.invoice_number
  or (new.client_id is distinct from old.client_id
      and coalesce(current_setting('app.fusion_clients', true), '') <> 'on')
  or new.due_date       is distinct from old.due_date
  or new.issued_at      is distinct from old.issued_at
  or new.subject        is distinct from old.subject
  then
    raise exception
      'Cette facture a deja ete emise (statut %). Ses montants et son numero ne peuvent plus etre modifies : creez une note de credit ou annulez-la, puis emettez une nouvelle facture.',
      old.status
      using errcode = '42501';
  end if;

  return new;
end $$;

-- fusionner_clients : identique à 20260911030000, plus le drapeau de transaction.
create or replace function public.fusionner_clients(p_org uuid, p_garder uuid, p_absorber uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_garder clients%rowtype;
  v_absorber clients%rowtype;
  v_cible record;
  v_n int;
  v_total int := 0;
  v_detail jsonb := '{}'::jsonb;
  v_ignores int := 0;
  v_row record;
begin
  if p_garder = p_absorber then
    raise exception 'fusionner_clients: les deux fiches sont identiques';
  end if;
  if v_uid is not null and not public.member_has_permission(v_uid, p_org, 'clients.delete') then
    raise exception 'fusionner_clients: permission clients.delete requise' using errcode = '42501';
  end if;
  select * into v_garder from clients where id = p_garder and org_id = p_org and deleted_at is null for update;
  if not found then raise exception 'fusionner_clients: fiche à garder introuvable'; end if;
  select * into v_absorber from clients where id = p_absorber and org_id = p_org and deleted_at is null for update;
  if not found then raise exception 'fusionner_clients: fiche à absorber introuvable'; end if;

  -- Drapeau local à la transaction : le trigger d'immuabilité laisse passer client_id (et rien d'autre).
  perform set_config('app.fusion_clients', 'on', true);

  for v_cible in
    select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where c.contype = 'f' and c.confrelid = 'public.clients'::regclass
       and a.attname <> 'org_id'
     group by 1, 2
  loop
    begin
      execute format('update %s set %I = $1 where %I = $2', v_cible.tbl, v_cible.col, v_cible.col) using p_garder, p_absorber;
      get diagnostics v_n = row_count;
    exception when unique_violation then
      v_n := 0;
      for v_row in execute format('select ctid from %s where %I = $1', v_cible.tbl, v_cible.col) using p_absorber loop
        begin
          execute format('update %s set %I = $1 where ctid = $2', v_cible.tbl, v_cible.col) using p_garder, v_row.ctid;
          v_n := v_n + 1;
        exception when unique_violation then
          v_ignores := v_ignores + 1;
        end;
      end loop;
    end;
    if v_n > 0 then
      v_detail := v_detail || jsonb_build_object(v_cible.tbl || '.' || v_cible.col, v_n);
      v_total := v_total + v_n;
    end if;
  end loop;

  update clients set
    email      = coalesce(nullif(email, ''), v_absorber.email),
    phone      = coalesce(nullif(phone, ''), v_absorber.phone),
    company    = coalesce(nullif(company, ''), v_absorber.company),
    address    = coalesce(nullif(address, ''), v_absorber.address),
    city       = coalesce(nullif(city, ''), v_absorber.city),
    notes      = case
                   when coalesce(v_absorber.notes, '') = '' then notes
                   when coalesce(notes, '') = '' then v_absorber.notes
                   else notes || E'\n' || v_absorber.notes
                 end,
    updated_at = now()
  where id = p_garder;

  update clients set deleted_at = now(), updated_at = now() where id = p_absorber;

  return jsonb_build_object(
    'merged', true, 'kept_client_id', p_garder, 'absorbed_client_id', p_absorber,
    'rows_reassigned', v_total, 'rows_skipped_unique', v_ignores, 'detail', v_detail
  );
end;
$$;

commit;
