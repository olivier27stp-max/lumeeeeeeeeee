-- ════════════════════════════════════════════════════════════════════════
-- Numéros d'entités : chiffres seulement + plus petit numéro libre
-- ════════════════════════════════════════════════════════════════════════
-- Demande : « je veux le numéro seulement, pas INV-…, pas de lettres, et
-- toujours le plus petit numéro possible pour chaque élément ».
--
--   1. Tous les numéros (jobs, devis, factures, clients) sont stockés en
--      chiffres seulement : « 7 » — plus de préfixe INV- ni de zéros (000007).
--   2. L'attribution automatique donne le PLUS PETIT numéro positif libre de
--      l'org (les trous sont comblés), au lieu de max+1.
--   3. Les numéros existants sont normalisés (INV-000007 → 7) quand c'est
--      sans collision; les lignes soft-deleted comptent comme « pris ».
--   4. company_settings.invoice_prefix est retiré du calcul (défaut '').
--
-- À appliquer APRÈS 20260708 / 20260716 / 20260729 / 20260731 (cette
-- migration redéfinit leurs fonctions).
-- ════════════════════════════════════════════════════════════════════════

begin;

-- 0. Plus petit numéro positif libre d'une org pour une entité ─────────────
--    Les lignes supprimées (soft delete) comptent : un numéro déjà porté par
--    une ligne supprimée n'est jamais réutilisé (la contrainte unique des
--    factures couvre aussi les supprimées).
create or replace function public.org_smallest_free_number(p_org uuid, p_entity text)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tbl text;
  v_col text;
  v_result bigint;
begin
  -- Garde cross-org (même règle que le fix 20260620 sur invoice_next_number) :
  -- un utilisateur authentifié ne peut lire que les numéros de son org.
  if auth.uid() is not null and not public.has_org_membership(auth.uid(), p_org) then
    raise exception 'Not allowed for this organization';
  end if;

  if p_entity = 'job' then v_tbl := 'jobs'; v_col := 'job_number';
  elsif p_entity = 'quote' then v_tbl := 'quotes'; v_col := 'quote_number';
  elsif p_entity = 'invoice' then v_tbl := 'invoices'; v_col := 'invoice_number';
  elsif p_entity = 'client' then v_tbl := 'clients'; v_col := 'client_number';
  else raise exception 'Unknown entity "%"', p_entity using errcode = '22023';
  end if;

  execute format(
    'with nums as (
       select distinct nullif(regexp_replace(%1$I, ''\D'', '''', ''g''), '''')::bigint as n
       from public.%2$I
       where org_id = $1 and %1$I ~ ''\d''
     )
     select min(s.s)
     from generate_series(1, coalesce((select count(*) from nums), 0) + 1) as s(s)
     where not exists (select 1 from nums where nums.n = s.s)',
    v_col, v_tbl)
  into v_result
  using p_org;

  return coalesce(v_result, 1);
end;
$$;
revoke all on function public.org_smallest_free_number(uuid, text) from public, anon;
grant execute on function public.org_smallest_free_number(uuid, text) to authenticated, service_role;

-- 1. invoice_next_number : chiffres seulement, plus petit numéro libre ─────
create or replace function public.invoice_next_number(p_org uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_next bigint;
begin
  -- Garde cross-org conservée du fix 20260620.
  if auth.uid() is not null and not public.has_org_membership(auth.uid(), p_org) then
    raise exception 'Not allowed for this organization';
  end if;

  -- Sérialise l'attribution par org (deux créations simultanées ne peuvent
  -- pas recevoir le même « plus petit numéro libre »).
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':invoice', 0));

  v_next := public.org_smallest_free_number(p_org, 'invoice');

  -- Compat : la séquence reste ≥ au dernier numéro attribué (lue par
  -- get_invoice_next_number pour l'écran Réglages).
  insert into public.invoice_sequences (org_id, last_value)
  values (p_org, v_next)
  on conflict (org_id) do update
    set last_value = greatest(public.invoice_sequences.last_value, excluded.last_value),
        updated_at = now();

  return v_next::text;
end;
$fn$;

-- 2. rpc_peek_next_numbers : plus petit libre, facture sans préfixe ────────
create or replace function public.rpc_peek_next_numbers()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_inv bigint;
begin
  if v_org is null then
    raise exception 'No organization context';
  end if;

  v_inv := public.org_smallest_free_number(v_org, 'invoice');

  return jsonb_build_object(
    'job', public.org_smallest_free_number(v_org, 'job')::text,
    'quote', public.org_smallest_free_number(v_org, 'quote')::text,
    'invoice_seq', v_inv,
    'invoice', v_inv::text,
    'client', public.org_smallest_free_number(v_org, 'client')::text
  );
end;
$$;

-- 3. Triggers d'attribution jobs/clients : plus petit numéro libre ─────────
--    Même structure qu'avant (numéro fourni respecté + compteur en avance);
--    seule l'attribution automatique change (trou le plus bas au lieu du
--    compteur+1). Le compteur est conservé : les validations « ≤ prochain »
--    de 20260716/20260731 le lisent.
create or replace function public.assign_job_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid := coalesce(new.org_id, public.current_org_id());
  v_next bigint;
begin
  if v_org is null then
    return new;
  end if;

  if new.job_number is not null and btrim(new.job_number) <> '' then
    if new.job_number ~ '^\s*\d+$' then
      insert into public.org_job_counters (org_id, last_number)
      values (v_org, btrim(new.job_number)::bigint)
      on conflict (org_id) do update
        set last_number = greatest(public.org_job_counters.last_number, excluded.last_number),
            updated_at  = now();
    end if;
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':job', 0));
  v_next := public.org_smallest_free_number(v_org, 'job');

  insert into public.org_job_counters (org_id, last_number)
  values (v_org, v_next)
  on conflict (org_id) do update
    set last_number = greatest(public.org_job_counters.last_number, excluded.last_number),
        updated_at  = now();

  new.job_number := v_next::text;
  return new;
end;
$$;

create or replace function public.assign_client_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid := coalesce(new.org_id, public.current_org_id());
  v_next bigint;
begin
  if v_org is null then
    return new;
  end if;

  if new.client_number is not null and btrim(new.client_number) <> '' then
    if new.client_number ~ '^\s*\d+$' then
      insert into public.org_client_counters (org_id, last_number)
      values (v_org, btrim(new.client_number)::bigint)
      on conflict (org_id) do update
        set last_number = greatest(public.org_client_counters.last_number, excluded.last_number),
            updated_at  = now();
    end if;
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':client', 0));
  v_next := public.org_smallest_free_number(v_org, 'client');

  insert into public.org_client_counters (org_id, last_number)
  values (v_org, v_next)
  on conflict (org_id) do update
    set last_number = greatest(public.org_client_counters.last_number, excluded.last_number),
        updated_at  = now();

  new.client_number := v_next::text;
  return new;
end;
$$;

-- 4. rpc_create_quote : attribution auto = plus petit libre ────────────────
--    Signature identique à 20260716000000; seul le bloc « auto-increment »
--    change (plus petit libre au lieu de séquence+1).
create or replace function public.rpc_create_quote(
  p_lead_id       uuid default null,
  p_client_id     uuid default null,
  p_title         text default '',
  p_salesperson_id uuid default null,
  p_context_type  text default 'lead',
  p_currency      text default 'CAD',
  p_valid_days    integer default 30,
  p_notes         text default null,
  p_contract      text default null,
  p_deposit_required boolean default false,
  p_require_payment_method boolean default false,
  p_quote_number  text default null
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
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
    -- Numéro fourni : valider puis garder la séquence au moins à ce niveau.
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
        and btrim(q.quote_number) = v_wanted::text
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
    -- Attribution auto : plus petit numéro libre de l'org.
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
  returning id into v_quote_id;

  insert into public.quote_status_history (quote_id, old_status, new_status, changed_by)
  values (v_quote_id, null, 'draft', auth.uid());

  return jsonb_build_object(
    'quote_id', v_quote_id,
    'quote_number', v_quote_number,
    'valid_until', v_valid_until
  );
end;
$$;

-- 5. rpc_create_invoice_draft : numéro fourni stocké en chiffres seulement ─
create or replace function public.rpc_create_invoice_draft(
  p_client_id uuid,
  p_subject text default null,
  p_due_date date default null,
  p_invoice_number text default null
)
returns table(
  id uuid,
  invoice_number text,
  status text,
  subject text,
  due_date date,
  total_cents integer,
  balance_cents integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_org uuid;
  v_number text;
  v_client public.clients%rowtype;
  v_invoice public.invoices%rowtype;
  v_digits text;
  v_wanted bigint;
  v_next bigint;
begin
  v_org := public.current_org_id();
  if v_org is null then
    raise exception 'Unable to resolve org_id for authenticated user';
  end if;

  select *
    into v_client
  from public.clients AS c
  where c.id = p_client_id
    and c.deleted_at is null
  limit 1;

  if v_client.id is null then
    raise exception 'Client not found';
  end if;

  if v_client.org_id <> v_org then
    raise exception 'Client does not belong to your organization';
  end if;

  if lower(coalesce(v_client.status, 'active')) = 'inactive' then
    raise exception 'Client is inactive';
  end if;

  if p_invoice_number is not null and btrim(p_invoice_number) <> '' then
    -- Numéro fourni : accepter « 42 » (ou un ancien « INV-000042 »), valider,
    -- stocker en chiffres seulement, puis garder la séquence à ce niveau.
    v_digits := nullif(regexp_replace(p_invoice_number, '\D', '', 'g'), '');
    if v_digits is null then
      raise exception 'Invalid invoice number "%"', p_invoice_number;
    end if;
    v_wanted := v_digits::bigint;

    select greatest(
      coalesce((select s.last_value from public.invoice_sequences s where s.org_id = v_org), 0),
      coalesce((select max(nullif(regexp_replace(i.invoice_number, '\D', '', 'g'), '')::bigint)
                from public.invoices i
                where i.org_id = v_org and i.invoice_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Invoice number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;

    v_number := v_wanted::text;

    -- Doublon comparé sur la partie numérique (d'anciennes factures peuvent
    -- garder un préfixe si la normalisation a rencontré une collision). La
    -- contrainte unique (org_id, invoice_number) inclut les factures
    -- supprimées : on vérifie donc sans filtrer deleted_at.
    if exists (
      select 1 from public.invoices i
      where i.org_id = v_org
        and i.invoice_number ~ '\d'
        and nullif(regexp_replace(i.invoice_number, '\D', '', 'g'), '')::bigint = v_wanted
    ) then
      raise exception 'Invoice number % is already in use', v_number;
    end if;

    insert into public.invoice_sequences (org_id, last_value)
    values (v_org, v_wanted)
    on conflict (org_id) do update
      set last_value = greatest(invoice_sequences.last_value, excluded.last_value),
          updated_at = now();
  else
    v_number := public.invoice_next_number(v_org);
  end if;

  insert into public.invoices (
    org_id,
    created_by,
    client_id,
    invoice_number,
    status,
    subject,
    issued_at,
    due_date,
    subtotal_cents,
    tax_cents,
    total_cents,
    paid_cents,
    balance_cents
  )
  values (
    v_org,
    auth.uid(),
    p_client_id,
    v_number,
    'draft',
    nullif(trim(p_subject), ''),
    null,
    p_due_date,
    0,
    0,
    0,
    0,
    0
  )
  returning * into v_invoice;

  return query
  select
    v_invoice.id,
    v_invoice.invoice_number,
    v_invoice.status,
    v_invoice.subject,
    v_invoice.due_date,
    v_invoice.total_cents,
    v_invoice.balance_cents,
    v_invoice.created_at;
end;
$function$;

-- 6. rpc_update_entity_number : facture stockée en chiffres seulement ──────
--    Identique à 20260731000000 sauf la branche invoice (plus de préfixe).
create or replace function public.rpc_update_entity_number(
  p_entity text,
  p_id uuid,
  p_number text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
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
        and btrim(q.quote_number) = v_wanted::text and q.id <> p_id
    ) then
      raise exception 'Quote number % is already in use', v_wanted;
    end if;

    v_stored := v_wanted::text;
    update public.quotes
    set quote_number = v_stored, updated_at = now()
    where id = p_id and org_id = v_org and deleted_at is null;
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

    -- Doublon comparé sur la partie numérique; la contrainte unique
    -- (org_id, invoice_number) inclut les factures supprimées.
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
    where id = p_id and org_id = v_org and deleted_at is null;
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
$$;

revoke all on function public.rpc_update_entity_number(text, uuid, text) from public;
grant execute on function public.rpc_update_entity_number(text, uuid, text) to authenticated, service_role;

-- 7. Normalisation des numéros existants (INV-000007 → 7, 0001 → 1) ────────
--    Best-effort : une ligne n'est convertie que si sa valeur numérique est
--    unique dans l'org (aucune collision possible), sinon elle est laissée
--    telle quelle (les comparaisons numériques ci-dessus la gèrent).
update public.invoices i
set invoice_number = ltrim(regexp_replace(i.invoice_number, '\D', '', 'g'), '0')
where i.invoice_number !~ '^[1-9][0-9]*$'
  and nullif(ltrim(regexp_replace(i.invoice_number, '\D', '', 'g'), '0'), '') is not null
  and not exists (
    select 1 from public.invoices i2
    where i2.org_id = i.org_id and i2.id <> i.id
      and i2.invoice_number ~ '\d'
      and nullif(regexp_replace(i2.invoice_number, '\D', '', 'g'), '')::bigint
          = nullif(regexp_replace(i.invoice_number, '\D', '', 'g'), '')::bigint
  );

update public.quotes q
set quote_number = ltrim(regexp_replace(q.quote_number, '\D', '', 'g'), '0')
where q.quote_number !~ '^[1-9][0-9]*$'
  and nullif(ltrim(regexp_replace(q.quote_number, '\D', '', 'g'), '0'), '') is not null
  and not exists (
    select 1 from public.quotes q2
    where q2.org_id = q.org_id and q2.id <> q.id
      and q2.quote_number ~ '\d'
      and nullif(regexp_replace(q2.quote_number, '\D', '', 'g'), '')::bigint
          = nullif(regexp_replace(q.quote_number, '\D', '', 'g'), '')::bigint
  );

update public.jobs j
set job_number = ltrim(regexp_replace(j.job_number, '\D', '', 'g'), '0')
where j.job_number !~ '^[1-9][0-9]*$'
  and nullif(ltrim(regexp_replace(j.job_number, '\D', '', 'g'), '0'), '') is not null
  and not exists (
    select 1 from public.jobs j2
    where j2.org_id = j.org_id and j2.id <> j.id
      and j2.job_number ~ '\d'
      and nullif(regexp_replace(j2.job_number, '\D', '', 'g'), '')::bigint
          = nullif(regexp_replace(j.job_number, '\D', '', 'g'), '')::bigint
  );

update public.clients c
set client_number = ltrim(regexp_replace(c.client_number, '\D', '', 'g'), '0')
where c.client_number is not null
  and c.client_number !~ '^[1-9][0-9]*$'
  and nullif(ltrim(regexp_replace(c.client_number, '\D', '', 'g'), '0'), '') is not null
  and not exists (
    select 1 from public.clients c2
    where c2.org_id = c.org_id and c2.id <> c.id
      and c2.client_number ~ '\d'
      and nullif(regexp_replace(c2.client_number, '\D', '', 'g'), '')::bigint
          = nullif(regexp_replace(c.client_number, '\D', '', 'g'), '')::bigint
  );

-- 8. Retirer le préfixe de facture (feature abandonnée : chiffres seulement) ─
alter table public.company_settings
  alter column invoice_prefix set default '';
update public.company_settings
  set invoice_prefix = ''
  where invoice_prefix is distinct from '';

commit;

notify pgrst, 'reload schema';
