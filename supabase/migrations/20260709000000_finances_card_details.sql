-- ════════════════════════════════════════════════════════════════
-- Finances page — card details on payments + enriched invoice list
--
--  1. Add card_last4 / card_brand to public.payments (filled by the
--     Stripe webhook going forward; existing rows stay null).
--  2. Redefine rpc_list_invoices to surface payment-level data for the
--     "Facturation" tab: latest succeeded payment (payer, method,
--     provider, card brand/last4, payment id), property site, quote #.
--
--  IMPORTANT: same 9-arg signature is preserved (the grant depends on
--  it). Only the returns-table and the body change.
-- ════════════════════════════════════════════════════════════════

begin;

-- ─── 1. Card columns on payments ───────────────────────────────
alter table public.payments add column if not exists card_last4 text;
alter table public.payments add column if not exists card_brand text;

comment on column public.payments.card_last4 is
  'Last 4 digits of card, set by the Stripe webhook; null for non-card or pre-existing payments';
comment on column public.payments.card_brand is
  'Card brand (visa/mastercard/amex...), set by the Stripe webhook';

-- ─── 2. Enriched rpc_list_invoices ─────────────────────────────
create or replace function public.rpc_list_invoices(
  p_status text default 'all',
  p_range text default 'all',
  p_q text default null,
  p_sort text default 'due_date_desc',
  p_limit integer default 25,
  p_offset integer default 0,
  p_from date default null,
  p_to date default null,
  p_org uuid default null
)
returns table (
  id uuid,
  client_id uuid,
  client_name text,
  invoice_number text,
  status text,
  subject text,
  issued_at timestamptz,
  due_date date,
  total_cents integer,
  balance_cents integer,
  paid_cents integer,
  created_at timestamptz,
  updated_at timestamptz,
  property_id uuid,
  job_id uuid,
  site text,
  quote_number text,
  payer_name text,
  payment_method text,
  provider text,
  card_last4 text,
  card_brand text,
  payment_id uuid,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_status text := lower(coalesce(p_status, 'all'));
  v_range text := lower(coalesce(p_range, 'all'));
  v_sort text := lower(coalesce(p_sort, 'due_date_desc'));
  v_limit integer := greatest(coalesce(p_limit, 25), 1);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  v_org := coalesce(p_org, public.current_org_id());
  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  return query
  with base as (
    select
      i.id,
      i.client_id,
      coalesce(
        nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
        nullif(trim(c.company), ''),
        'Unknown client'
      ) as client_name,
      i.invoice_number,
      i.status,
      i.subject,
      i.issued_at,
      i.due_date,
      i.total_cents,
      i.balance_cents,
      i.paid_cents,
      i.created_at,
      i.updated_at,
      i.property_id,
      i.job_id,
      coalesce(nullif(trim(prop.address), ''), prop.name) as site,
      lq.quote_number,
      coalesce(
        nullif(trim(concat_ws(' ', pc.first_name, pc.last_name)), ''),
        nullif(trim(pc.company), ''),
        nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
        nullif(trim(c.company), '')
      ) as payer_name,
      lp.method as payment_method,
      lp.provider,
      lp.card_last4,
      lp.card_brand,
      lp.id as payment_id,
      coalesce(i.issued_at::date, i.created_at::date) as reference_date
    from public.invoices i
    left join public.clients c on c.id = i.client_id
    -- latest succeeded payment for this invoice (limit 1 → no row fan-out)
    left join lateral (
      select p.id, p.method, p.provider, p.card_last4, p.card_brand, p.client_id
      from public.payments p
      where p.invoice_id = i.id
        and p.org_id = v_org
        and p.status = 'succeeded'
        and p.deleted_at is null
      order by coalesce(p.paid_at, p.payment_date, p.created_at) desc
      limit 1
    ) lp on true
    left join public.clients pc on pc.id = lp.client_id and pc.org_id = v_org
    left join public.properties prop on prop.id = i.property_id and prop.org_id = v_org
    -- quote number via quotes.job_id → invoices.job_id
    left join lateral (
      select q.quote_number
      from public.quotes q
      where q.job_id = i.job_id
        and q.org_id = v_org
        and q.deleted_at is null
      order by q.created_at desc
      limit 1
    ) lq on true
    where i.org_id = v_org
      and i.deleted_at is null
      and (c.id is null or c.org_id = v_org)
  ),
  filtered as (
    select *
    from base b
    where
      (
        v_status = 'all'
        or (v_status = 'draft' and b.status = 'draft')
        or (v_status = 'paid' and b.status = 'paid')
        or (
          v_status = 'past_due'
          and b.status in ('sent', 'partial')
          and b.balance_cents > 0
          and b.due_date < current_date
        )
        or (
          v_status = 'sent_not_due'
          and b.status in ('sent', 'partial')
          and b.balance_cents > 0
          and b.due_date >= current_date
        )
      )
      and (
        v_range = 'all'
        or (v_range = '30d' and b.reference_date >= (current_date - interval '30 days')::date)
        or (v_range = 'this_month' and date_trunc('month', b.reference_date) = date_trunc('month', current_date))
        or (
          v_range = 'custom'
          and (p_from is null or b.reference_date >= p_from)
          and (p_to is null or b.reference_date <= p_to)
        )
      )
      and (
        v_q is null
        or b.client_name ilike ('%' || v_q || '%')
        or b.invoice_number ilike ('%' || v_q || '%')
        or coalesce(b.subject, '') ilike ('%' || v_q || '%')
      )
  )
  select
    f.id,
    f.client_id,
    f.client_name,
    f.invoice_number,
    f.status,
    f.subject,
    f.issued_at,
    f.due_date,
    f.total_cents,
    f.balance_cents,
    f.paid_cents,
    f.created_at,
    f.updated_at,
    f.property_id,
    f.job_id,
    f.site,
    f.quote_number,
    f.payer_name,
    f.payment_method,
    f.provider,
    f.card_last4,
    f.card_brand,
    f.payment_id,
    count(*) over() as total_count
  from filtered f
  order by
    case when v_sort = 'client_asc' then lower(f.client_name) end asc nulls last,
    case when v_sort = 'client_desc' then lower(f.client_name) end desc nulls last,
    case when v_sort = 'invoice_number_asc' then f.invoice_number end asc nulls last,
    case when v_sort = 'invoice_number_desc' then f.invoice_number end desc nulls last,
    case when v_sort = 'due_date_asc' then f.due_date end asc nulls last,
    case when v_sort = 'due_date_desc' then f.due_date end desc nulls last,
    case when v_sort = 'status_asc' then f.status end asc nulls last,
    case when v_sort = 'status_desc' then f.status end desc nulls last,
    case when v_sort = 'total_asc' then f.total_cents end asc nulls last,
    case when v_sort = 'total_desc' then f.total_cents end desc nulls last,
    case when v_sort = 'balance_asc' then f.balance_cents end asc nulls last,
    case when v_sort = 'balance_desc' then f.balance_cents end desc nulls last,
    f.created_at desc
  limit v_limit
  offset v_offset;
end;
$fn$;

commit;
