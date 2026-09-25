-- Préfixe de numéro par bureau sur les factures et soumissions (Q1 du plan
-- multi-bureaux, décision de Rafba 2026-09-25) : CL-1042 à Coquin lavage,
-- VL-1042 à Vision Lavage — plus de numéros identiques dans une même entreprise.
--
-- Choix technique : le préfixe est STOCKÉ dans le numéro des nouveaux
-- documents (≈ 650 endroits lisent/affichent un numéro ; les préfixer à
-- l'affichage en aurait oublié). La numérotation reste intacte : le « plus
-- petit numéro libre » et les séquences lisent déjà les CHIFFRES du numéro
-- (regexp_replace '\D'), et le préfixe n'a que des lettres.
--   * company_settings.prefixe_documents : 1 à 5 lettres majuscules, nul = aucun ;
--   * un seul trigger par table, APRÈS la numérotation (ordre alphabétique
--     « zz »), couvre TOUS les chemins d'écriture (SQL, serveur, Lumi,
--     automatisations, renumérotation manuelle) : un numéro qui n'est que des
--     chiffres reçoit « PRÉFIXE- » ; un numéro importé ou déjà préfixé est laissé tel quel ;
--   * aucune rétroactivité : les documents existants gardent leur numéro ;
--   * le contrôle de doublon des soumissions compare maintenant les chiffres
--     (celui des factures le faisait déjà) : « 1050 » et « CL-1050 » sont le même numéro.
-- Sans préfixe configuré, rien ne change pour aucune entreprise.

alter table public.company_settings
  add column if not exists prefixe_documents text;
alter table public.company_settings
  drop constraint if exists company_settings_prefixe_documents_format;
alter table public.company_settings
  add constraint company_settings_prefixe_documents_format
  check (prefixe_documents is null or prefixe_documents ~ '^[A-Z]{1,5}$');
comment on column public.company_settings.prefixe_documents is
  'Préfixe des numéros de factures et soumissions de ce bureau (ex. CL → CL-1042). Lettres majuscules, 1 à 5. Nul = numéros sans préfixe.';

create or replace function public.appliquer_prefixe_document()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_prefixe text;
begin
  if tg_table_name = 'invoices' then
    if new.invoice_number is null or new.invoice_number !~ '^\d+$' then return new; end if;
  elsif tg_table_name = 'quotes' then
    if new.quote_number is null or new.quote_number !~ '^\d+$' then return new; end if;
  else
    return new;
  end if;

  select cs.prefixe_documents into v_prefixe
    from public.company_settings cs
   where cs.org_id = new.org_id
   limit 1;
  if v_prefixe is null then return new; end if;

  if tg_table_name = 'invoices' then
    new.invoice_number := v_prefixe || '-' || new.invoice_number;
  else
    new.quote_number := v_prefixe || '-' || new.quote_number;
  end if;
  return new;
end;
$function$;
revoke all on function public.appliquer_prefixe_document() from public, anon, authenticated;

drop trigger if exists trg_invoices_zz_prefixe on public.invoices;
create trigger trg_invoices_zz_prefixe
  before insert or update of invoice_number on public.invoices
  for each row execute function public.appliquer_prefixe_document();

drop trigger if exists trg_quotes_zz_prefixe on public.quotes;
create trigger trg_quotes_zz_prefixe
  before insert or update of quote_number on public.quotes
  for each row execute function public.appliquer_prefixe_document();

-- Doublons de soumission : comparer les CHIFFRES (le reste des deux fonctions
-- est identique à la prod du 2026-09-25).

CREATE OR REPLACE FUNCTION public.rpc_create_quote(p_lead_id uuid DEFAULT NULL::uuid, p_client_id uuid DEFAULT NULL::uuid, p_title text DEFAULT ''::text, p_salesperson_id uuid DEFAULT NULL::uuid, p_context_type text DEFAULT 'lead'::text, p_currency text DEFAULT 'CAD'::text, p_valid_days integer DEFAULT 30, p_notes text DEFAULT NULL::text, p_contract text DEFAULT NULL::text, p_deposit_required boolean DEFAULT false, p_require_payment_method boolean DEFAULT false, p_quote_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org_id uuid;
  v_quote_number text;
  v_quote_id uuid;
  v_valid_until date;
  v_wanted bigint;
  v_next bigint;
begin
  v_org_id := public.current_org_id();
  if v_org_id is null then
    raise exception 'No organization context';
  end if;

  if p_quote_number is not null and btrim(p_quote_number) <> '' then
    if btrim(p_quote_number) !~ '^\d+$' then
      raise exception 'Invalid quote number "%"', p_quote_number;
    end if;
    v_wanted := btrim(p_quote_number)::bigint;

    select greatest(
      coalesce((select s.last_value from public.quote_sequences s where s.org_id = v_org_id), 0),
      coalesce((select max(nullif(regexp_replace(q.quote_number, '\D', '', 'g'), '')::bigint)
                from public.quotes q
                where q.org_id = v_org_id and q.quote_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Quote number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;
    if exists (
      select 1 from public.quotes q
      where q.org_id = v_org_id
        and q.deleted_at is null
        and nullif(regexp_replace(q.quote_number, '\D', '', 'g'), '') = v_wanted::text
    ) then
      raise exception 'Quote number % is already in use', v_wanted;
    end if;

    insert into public.quote_sequences (org_id, last_value, updated_at)
    values (v_org_id, v_wanted, now())
    on conflict (org_id) do update
      set last_value = greatest(quote_sequences.last_value, excluded.last_value),
          updated_at = now();

    v_quote_number := v_wanted::text;
  else
    perform pg_advisory_xact_lock(hashtextextended(v_org_id::text || ':quote', 0));
    v_wanted := public.org_smallest_free_number(v_org_id, 'quote');

    insert into public.quote_sequences (org_id, last_value, updated_at)
    values (v_org_id, v_wanted, now())
    on conflict (org_id) do update
      set last_value = greatest(quote_sequences.last_value, excluded.last_value),
          updated_at = now();

    v_quote_number := v_wanted::text;
  end if;

  v_valid_until := current_date + p_valid_days;

  insert into public.quotes (
    org_id, quote_number, title, lead_id, client_id,
    status, context_type, salesperson_id, created_by,
    currency, valid_until, notes, contract_disclaimer,
    deposit_required, require_payment_method
  ) values (
    v_org_id, v_quote_number, p_title, p_lead_id, p_client_id,
    'draft', p_context_type, p_salesperson_id, auth.uid(),
    p_currency, v_valid_until, p_notes, p_contract,
    p_deposit_required, p_require_payment_method
  )
  returning id, quote_number into v_quote_id, v_quote_number;  -- numéro STOCKÉ (préfixe du bureau compris)

  insert into public.quote_status_history (quote_id, old_status, new_status, changed_by)
  values (v_quote_id, null, 'draft', auth.uid());

  return jsonb_build_object(
    'quote_id', v_quote_id,
    'quote_number', v_quote_number,
    'valid_until', v_valid_until
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_update_entity_number(p_entity text, p_id uuid, p_number text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org    uuid := public.current_org_id();
  v_digits text;
  v_wanted bigint;
  v_next   bigint;
  v_stored text;
  v_count  int;
begin
  if v_org is null then
    raise exception 'No organization context';
  end if;
  if p_id is null then
    raise exception 'p_id is required' using errcode = '22023';
  end if;

  v_digits := nullif(regexp_replace(coalesce(p_number, ''), '\D', '', 'g'), '');
  if v_digits is null then
    raise exception 'Invalid number "%"', p_number using errcode = '22023';
  end if;
  v_wanted := v_digits::bigint;

  if p_entity = 'job' then
    select greatest(
      coalesce((select c.last_number from public.org_job_counters c where c.org_id = v_org), 0),
      coalesce((select max(nullif(regexp_replace(j.job_number, '\D', '', 'g'), '')::bigint)
                from public.jobs j
                where j.org_id = v_org and j.job_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Job number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;
    if exists (
      select 1 from public.jobs j
      where j.org_id = v_org and j.deleted_at is null
        and j.job_number = v_wanted::text and j.id <> p_id
    ) then
      raise exception 'Job number % is already in use', v_wanted;
    end if;

    v_stored := v_wanted::text;
    update public.jobs
    set job_number = v_stored, updated_at = now()
    where id = p_id and org_id = v_org and deleted_at is null;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise exception 'Job not found';
    end if;

    insert into public.org_job_counters (org_id, last_number)
    values (v_org, v_wanted)
    on conflict (org_id) do update
      set last_number = greatest(public.org_job_counters.last_number, excluded.last_number),
          updated_at  = now();

  elsif p_entity = 'quote' then
    select greatest(
      coalesce((select s.last_value from public.quote_sequences s where s.org_id = v_org), 0),
      coalesce((select max(nullif(regexp_replace(q.quote_number, '\D', '', 'g'), '')::bigint)
                from public.quotes q
                where q.org_id = v_org and q.quote_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Quote number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;
    if exists (
      select 1 from public.quotes q
      where q.org_id = v_org and q.deleted_at is null
        and nullif(regexp_replace(q.quote_number, '\D', '', 'g'), '') = v_wanted::text and q.id <> p_id
    ) then
      raise exception 'Quote number % is already in use', v_wanted;
    end if;

    v_stored := v_wanted::text;
    update public.quotes
    set quote_number = v_stored, updated_at = now()
    where id = p_id and org_id = v_org and deleted_at is null
    returning quote_number into v_stored;  -- numéro STOCKÉ (préfixe du bureau compris)
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise exception 'Quote not found';
    end if;

    insert into public.quote_sequences (org_id, last_value, updated_at)
    values (v_org, v_wanted, now())
    on conflict (org_id) do update
      set last_value = greatest(public.quote_sequences.last_value, excluded.last_value),
          updated_at = now();

  elsif p_entity = 'invoice' then
    select greatest(
      coalesce((select s.last_value from public.invoice_sequences s where s.org_id = v_org), 0),
      coalesce((select max(nullif(regexp_replace(i.invoice_number, '\D', '', 'g'), '')::bigint)
                from public.invoices i
                where i.org_id = v_org and i.invoice_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Invoice number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;

    v_stored := v_wanted::text;

    if exists (
      select 1 from public.invoices i
      where i.org_id = v_org and i.id <> p_id
        and i.invoice_number ~ '\d'
        and nullif(regexp_replace(i.invoice_number, '\D', '', 'g'), '')::bigint = v_wanted
    ) then
      raise exception 'Invoice number % is already in use', v_stored;
    end if;

    update public.invoices
    set invoice_number = v_stored, updated_at = now()
    where id = p_id and org_id = v_org and deleted_at is null
    returning invoice_number into v_stored;  -- numéro STOCKÉ (préfixe du bureau compris)
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise exception 'Invoice not found';
    end if;

    insert into public.invoice_sequences (org_id, last_value)
    values (v_org, v_wanted)
    on conflict (org_id) do update
      set last_value = greatest(public.invoice_sequences.last_value, excluded.last_value),
          updated_at = now();

  elsif p_entity = 'client' then
    select greatest(
      coalesce((select c.last_number from public.org_client_counters c where c.org_id = v_org), 0),
      coalesce((select max(nullif(regexp_replace(cl.client_number, '\D', '', 'g'), '')::bigint)
                from public.clients cl
                where cl.org_id = v_org and cl.client_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Client number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;
    if exists (
      select 1 from public.clients c
      where c.org_id = v_org and c.deleted_at is null
        and c.client_number = v_wanted::text and c.id <> p_id
    ) then
      raise exception 'Client number % is already in use', v_wanted;
    end if;

    v_stored := v_wanted::text;
    update public.clients
    set client_number = v_stored, updated_at = now()
    where id = p_id and org_id = v_org and deleted_at is null;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise exception 'Client not found';
    end if;

    insert into public.org_client_counters (org_id, last_number)
    values (v_org, v_wanted)
    on conflict (org_id) do update
      set last_number = greatest(public.org_client_counters.last_number, excluded.last_number),
          updated_at  = now();

  else
    raise exception 'Unknown entity "%"', p_entity using errcode = '22023';
  end if;

  return v_stored;
end;
$function$;
