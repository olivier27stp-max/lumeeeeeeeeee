-- ============================================================
-- Quotes System — Complete Module
--
-- 1. quotes (main entity)
-- 2. quote_line_items (snapshot of services)
-- 3. quote_sections (intro, disclaimer, etc.)
-- 4. quote_send_log (email/sms tracking)
-- 5. quote_status_history (audit trail)
-- 6. quote_attachments (files)
-- ============================================================

begin;

-- ============================================================
-- 1. quotes
-- ============================================================

create table if not exists public.quotes (
  id                  uuid        primary key default gen_random_uuid(),
  org_id              uuid        not null,
  quote_number        text        not null,
  title               text        not null default '',
  lead_id             uuid        references public.leads(id) on delete set null,
  client_id           uuid        references public.clients(id) on delete set null,
  job_id              uuid        references public.jobs(id) on delete set null,
  status              text        not null default 'action_required'
                                  check (status in (
                                    'draft','action_required','sent','awaiting_response',
                                    'approved','declined','expired','converted'
                                  )),
  context_type        text        not null default 'lead'
                                  check (context_type in ('lead','client','job')),
  salesperson_id      uuid,
  created_by          uuid        not null default auth.uid(),
  view_token          uuid        not null default gen_random_uuid(),

  -- Send tracking
  sent_via_email_at   timestamptz,
  sent_via_sms_at     timestamptz,
  last_sent_channel   text        check (last_sent_channel is null or last_sent_channel in ('email','sms')),

  -- Status timestamps
  approved_at         timestamptz,
  declined_at         timestamptz,
  expired_at          timestamptz,
  converted_at        timestamptz,
  valid_until         date,

  -- Financials
  subtotal_cents      integer     not null default 0,
  discount_type       text        check (discount_type is null or discount_type in ('percentage','fixed')),
  discount_value      numeric(12,2) default 0,
  discount_cents      integer     not null default 0,
  tax_rate_label      text        default 'TPS+TVQ (14.975%)',
  tax_rate            numeric(8,4) default 14.975,
  tax_cents           integer     not null default 0,
  total_cents         integer     not null default 0,
  currency            text        not null default 'CAD',

  -- Content
  notes               text,
  internal_notes      text,
  contract_disclaimer text,

  -- Deposit
  deposit_required    boolean     not null default false,
  deposit_type        text        check (deposit_type is null or deposit_type in ('percentage','fixed')),
  deposit_value       numeric(12,2) default 0,
  require_payment_method boolean  not null default false,

  -- Soft delete
  deleted_at          timestamptz,
  deleted_by          uuid,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists idx_quotes_view_token on public.quotes(view_token);
create index if not exists idx_quotes_org on public.quotes(org_id, created_at desc);
create index if not exists idx_quotes_lead on public.quotes(lead_id) where lead_id is not null;
create index if not exists idx_quotes_client on public.quotes(client_id) where client_id is not null;
create index if not exists idx_quotes_status on public.quotes(org_id, status);

alter table public.quotes enable row level security;

create policy quotes_select on public.quotes
  for select using (public.has_org_membership(auth.uid(), org_id));
create policy quotes_insert on public.quotes
  for insert with check (public.has_org_membership(auth.uid(), org_id));
create policy quotes_update on public.quotes
  for update using (public.has_org_membership(auth.uid(), org_id));
create policy quotes_delete on public.quotes
  for delete using (public.has_org_membership(auth.uid(), org_id));

-- Auto-update updated_at
create trigger trg_quotes_set_updated_at
  before update on public.quotes
  for each row execute function public.set_updated_at();

-- ============================================================
-- 2. quote_line_items
-- ============================================================

create table if not exists public.quote_line_items (
  id                  uuid        primary key default gen_random_uuid(),
  quote_id            uuid        not null references public.quotes(id) on delete cascade,
  source_service_id   uuid        references public.predefined_services(id) on delete set null,
  name                text        not null,
  description         text,
  quantity            numeric(10,2) not null default 1,
  unit_price_cents    integer     not null default 0,
  total_cents         integer     not null default 0,
  sort_order          integer     not null default 0,
  is_optional         boolean     not null default false,
  item_type           text        not null default 'service'
                                  check (item_type in ('service','text','heading')),
  image_url           text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_quote_line_items_quote on public.quote_line_items(quote_id, sort_order);

alter table public.quote_line_items enable row level security;

create policy quote_line_items_select on public.quote_line_items
  for select using (exists (
    select 1 from public.quotes q where q.id = quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));
create policy quote_line_items_insert on public.quote_line_items
  for insert with check (exists (
    select 1 from public.quotes q where q.id = quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));
create policy quote_line_items_update on public.quote_line_items
  for update using (exists (
    select 1 from public.quotes q where q.id = quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));
create policy quote_line_items_delete on public.quote_line_items
  for delete using (exists (
    select 1 from public.quotes q where q.id = quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));

-- Auto line total
create or replace function public.quote_line_items_set_total()
returns trigger language plpgsql as $$
begin
  NEW.total_cents := round(NEW.quantity * NEW.unit_price_cents);
  return NEW;
end;
$$;

create trigger trg_quote_line_items_set_total
  before insert or update of quantity, unit_price_cents on public.quote_line_items
  for each row execute function public.quote_line_items_set_total();

create trigger trg_quote_line_items_set_updated_at
  before update on public.quote_line_items
  for each row execute function public.set_updated_at();

-- ============================================================
-- 3. quote_sections
-- ============================================================

create table if not exists public.quote_sections (
  id                  uuid        primary key default gen_random_uuid(),
  quote_id            uuid        not null references public.quotes(id) on delete cascade,
  section_type        text        not null
                                  check (section_type in (
                                    'introduction','attachments','images','reviews',
                                    'client_message','contract_disclaimer'
                                  )),
  title               text,
  content             text,
  sort_order          integer     not null default 0,
  enabled             boolean     not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_quote_sections_quote on public.quote_sections(quote_id, sort_order);

alter table public.quote_sections enable row level security;

create policy quote_sections_all on public.quote_sections
  for all using (exists (
    select 1 from public.quotes q where q.id = quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));

-- ============================================================
-- 4. quote_send_log
-- ============================================================

create table if not exists public.quote_send_log (
  id                  uuid        primary key default gen_random_uuid(),
  quote_id            uuid        not null references public.quotes(id) on delete cascade,
  channel             text        not null check (channel in ('email','sms')),
  recipient           text        not null,
  sent_by             uuid,
  sent_at             timestamptz not null default now(),
  delivery_status     text        default 'sent',
  provider_message_id text,
  error               text
);

create index if not exists idx_quote_send_log_quote on public.quote_send_log(quote_id, sent_at desc);

alter table public.quote_send_log enable row level security;

create policy quote_send_log_all on public.quote_send_log
  for all using (exists (
    select 1 from public.quotes q where q.id = quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));

-- ============================================================
-- 5. quote_status_history
-- ============================================================

create table if not exists public.quote_status_history (
  id                  uuid        primary key default gen_random_uuid(),
  quote_id            uuid        not null references public.quotes(id) on delete cascade,
  old_status          text,
  new_status          text        not null,
  changed_by          uuid,
  changed_at          timestamptz not null default now(),
  reason              text
);

create index if not exists idx_quote_status_history_quote on public.quote_status_history(quote_id, changed_at desc);

alter table public.quote_status_history enable row level security;

create policy quote_status_history_all on public.quote_status_history
  for all using (exists (
    select 1 from public.quotes q where q.id = quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));

-- ============================================================
-- 6. quote_attachments
-- ============================================================

create table if not exists public.quote_attachments (
  id                  uuid        primary key default gen_random_uuid(),
  quote_id            uuid        not null references public.quotes(id) on delete cascade,
  file_url            text        not null,
  file_name           text        not null,
  file_type           text,
  uploaded_by         uuid,
  uploaded_at         timestamptz not null default now(),
  source_type         text        default 'manual'
);

create index if not exists idx_quote_attachments_quote on public.quote_attachments(quote_id);

alter table public.quote_attachments enable row level security;

create policy quote_attachments_all on public.quote_attachments
  for all using (exists (
    select 1 from public.quotes q where q.id = quote_id and public.has_org_membership(auth.uid(), q.org_id)
  ));

-- ============================================================
-- 7. Quote number sequence
-- ============================================================

create table if not exists public.quote_sequences (
  org_id      uuid    primary key,
  last_value  integer not null default 0,
  updated_at  timestamptz not null default now()
);

alter table public.quote_sequences enable row level security;

create policy quote_sequences_all on public.quote_sequences
  for all using (public.has_org_membership(auth.uid(), org_id));

-- ============================================================
-- 8. RPC: create quote with auto-numbering
-- ============================================================

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
  p_require_payment_method boolean default false
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
begin
  -- Resolve org
  v_org_id := public.current_org_id();
  if v_org_id is null then
    raise exception 'No organization context';
  end if;

  -- Auto-increment quote number
  insert into public.quote_sequences (org_id, last_value, updated_at)
  values (v_org_id, 1, now())
  on conflict (org_id) do update
    set last_value = quote_sequences.last_value + 1,
        updated_at = now()
  returning last_value into v_seq;

  v_quote_number := v_seq::text;
  v_valid_until := current_date + p_valid_days;

  -- Create the quote
  insert into public.quotes (
    org_id, quote_number, title, lead_id, client_id,
    status, context_type, salesperson_id, created_by,
    currency, valid_until, notes, contract_disclaimer,
    deposit_required, require_payment_method
  ) values (
    v_org_id, v_quote_number, p_title, p_lead_id, p_client_id,
    'action_required', p_context_type, p_salesperson_id, auth.uid(),
    p_currency, v_valid_until, p_notes, p_contract,
    p_deposit_required, p_require_payment_method
  )
  returning id into v_quote_id;

  -- Log initial status
  insert into public.quote_status_history (quote_id, old_status, new_status, changed_by)
  values (v_quote_id, null, 'action_required', auth.uid());

  return jsonb_build_object(
    'quote_id', v_quote_id,
    'quote_number', v_quote_number,
    'valid_until', v_valid_until
  );
end;
$$;

-- ============================================================
-- 9. RPC: recalculate quote totals
-- ============================================================

create or replace function public.rpc_recalculate_quote(p_quote_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_subtotal integer;
  v_tax_rate numeric;
  v_discount_type text;
  v_discount_value numeric;
  v_discount_cents integer;
  v_tax_cents integer;
  v_total integer;
begin
  -- Sum line items (exclude optional items from total)
  select coalesce(sum(total_cents), 0) into v_subtotal
  from public.quote_line_items
  where quote_id = p_quote_id and not is_optional;

  -- Get quote settings
  select tax_rate, discount_type, discount_value
  into v_tax_rate, v_discount_type, v_discount_value
  from public.quotes where id = p_quote_id;

  -- Calculate discount
  if v_discount_type = 'percentage' then
    v_discount_cents := round(v_subtotal * v_discount_value / 100);
  elsif v_discount_type = 'fixed' then
    v_discount_cents := round(v_discount_value * 100);
  else
    v_discount_cents := 0;
  end if;

  -- Calculate tax on (subtotal - discount)
  v_tax_cents := round((v_subtotal - v_discount_cents) * coalesce(v_tax_rate, 0) / 100);

  -- Total
  v_total := v_subtotal - v_discount_cents + v_tax_cents;

  -- Update
  update public.quotes set
    subtotal_cents = v_subtotal,
    discount_cents = v_discount_cents,
    tax_cents = v_tax_cents,
    total_cents = v_total,
    updated_at = now()
  where id = p_quote_id;
end;
$$;

commit;
