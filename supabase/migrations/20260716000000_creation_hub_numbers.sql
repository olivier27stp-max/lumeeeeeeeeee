-- ════════════════════════════════════════════════════════════════════════
-- Hub de création — numéros (#) pré-remplis, modifiables et validés
-- ════════════════════════════════════════════════════════════════════════
-- Objectif :
--   Dans la section principale de chaque formulaire de création (job,
--   soumission, facture), le # est pré-rempli avec le prochain numéro de la
--   séquence de l'org. L'utilisateur peut le modifier, mais ne peut pas
--   utiliser un numéro qui n'existe pas encore (au-delà du prochain numéro)
--   ni un numéro déjà pris.
--
--   1. rpc_peek_next_numbers()      → aperçu des prochains numéros SANS
--                                     consommer les séquences (pré-remplissage).
--   2. rpc_create_quote             → nouveau param p_quote_number (validé).
--   3. rpc_create_invoice_draft     → nouveau param p_invoice_number (validé).
--
--   Les jobs gardent leur trigger existant (assign_job_number) : le numéro
--   fourni est respecté et le compteur avancé; la validation « ≤ prochain »
--   se fait côté client comme la vérification de doublon déjà en place.
-- ════════════════════════════════════════════════════════════════════════

-- 0. Compteur des jobs : idempotent au cas où 20260708000000 n'est pas
--    encore appliquée (rpc_peek_next_numbers le référence).
create table if not exists public.org_job_counters (
  org_id      uuid primary key,
  last_number bigint not null default 0,
  updated_at  timestamptz not null default now()
);
alter table public.org_job_counters enable row level security;

-- 1. Aperçu des prochains numéros (job, soumission, facture) ──────────────
--    greatest(séquence, max existant) couvre les orgs dont la séquence n'a
--    pas encore été initialisée ou est en retard sur des numéros manuels.
create or replace function public.rpc_peek_next_numbers()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  v_job   bigint;
  v_quote bigint;
  v_inv   bigint;
begin
  if v_org is null then
    raise exception 'No organization context';
  end if;

  select greatest(
    coalesce((select c.last_number from public.org_job_counters c where c.org_id = v_org), 0),
    coalesce((select max(nullif(regexp_replace(j.job_number, '\D', '', 'g'), '')::bigint)
              from public.jobs j
              where j.org_id = v_org and j.job_number ~ '\d'), 0)
  ) + 1 into v_job;

  select greatest(
    coalesce((select s.last_value from public.quote_sequences s where s.org_id = v_org), 0),
    coalesce((select max(nullif(regexp_replace(q.quote_number, '\D', '', 'g'), '')::bigint)
              from public.quotes q
              where q.org_id = v_org and q.quote_number ~ '\d'), 0)
  ) + 1 into v_quote;

  select greatest(
    coalesce((select s.last_value from public.invoice_sequences s where s.org_id = v_org), 0),
    coalesce((select max(nullif(regexp_replace(i.invoice_number, '\D', '', 'g'), '')::bigint)
              from public.invoices i
              where i.org_id = v_org and i.invoice_number ~ '\d'), 0)
  ) + 1 into v_inv;

  return jsonb_build_object(
    'job', v_job::text,
    'quote', v_quote::text,
    'invoice_seq', v_inv,
    'invoice', 'INV-' || lpad(v_inv::text, 6, '0')
  );
end;
$$;

-- 2. rpc_create_quote : accepte un numéro fourni (validé) ─────────────────
--    Nouvelle signature → on supprime l'ancienne pour éviter l'ambiguïté
--    de surcharge côté PostgREST.
drop function if exists public.rpc_create_quote(
  uuid, uuid, text, uuid, text, text, integer, text, text, boolean, boolean);

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
  v_seq integer;
  v_quote_id uuid;
  v_valid_until date;
  v_wanted bigint;
  v_next bigint;
begin
  -- Resolve org
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
    -- Auto-increment quote number
    insert into public.quote_sequences (org_id, last_value, updated_at)
    values (v_org_id, 1, now())
    on conflict (org_id) do update
      set last_value = quote_sequences.last_value + 1,
          updated_at = now()
    returning last_value into v_seq;

    v_quote_number := v_seq::text;
  end if;

  v_valid_until := current_date + p_valid_days;

  -- Create the quote
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

  -- Log initial status
  insert into public.quote_status_history (quote_id, old_status, new_status, changed_by)
  values (v_quote_id, null, 'draft', auth.uid());

  return jsonb_build_object(
    'quote_id', v_quote_id,
    'quote_number', v_quote_number,
    'valid_until', v_valid_until
  );
end;
$$;

-- 3. rpc_create_invoice_draft : accepte un numéro fourni (validé) ─────────
drop function if exists public.rpc_create_invoice_draft(uuid, text, date);

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
    -- Numéro fourni : accepter « INV-000042 » ou « 42 », valider, puis
    -- garder la séquence au moins à ce niveau.
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

    v_number := 'INV-' || lpad(v_wanted::text, 6, '0');

    -- La contrainte unique (org_id, invoice_number) inclut les factures
    -- supprimées (soft delete) : on vérifie donc sans filtrer deleted_at.
    if exists (
      select 1 from public.invoices i
      where i.org_id = v_org and i.invoice_number = v_number
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

NOTIFY pgrst, 'reload schema';
