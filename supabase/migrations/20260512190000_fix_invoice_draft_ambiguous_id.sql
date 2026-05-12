-- Fix rpc_create_invoice_draft: the function declares RETURNS TABLE(id uuid, …)
-- which creates a local `id` variable that shadows `clients.id` inside the
-- `where id = p_client_id` clause, raising:
--   "column reference \"id\" is ambiguous" (Postgres 42702)
-- Result: invoice draft creation fails for every user.
--
-- Fix: qualify the column with the table name in the WHERE clauses.

CREATE OR REPLACE FUNCTION public.rpc_create_invoice_draft(
  p_client_id uuid,
  p_subject text DEFAULT NULL,
  p_due_date date DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  invoice_number text,
  status text,
  subject text,
  due_date date,
  total_cents integer,
  balance_cents integer,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare
  v_org uuid;
  v_number text;
  v_client public.clients%rowtype;
  v_invoice public.invoices%rowtype;
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

  v_number := public.invoice_next_number(v_org);

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
