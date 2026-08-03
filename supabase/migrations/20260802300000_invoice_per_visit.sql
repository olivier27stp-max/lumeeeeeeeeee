-- Plans de service — facturation par visite (jobs.billing_mode = 'per_visit').
-- Quand une visite est marquée terminée, une facture est créée pour cette
-- visite précise (« comme des jobs individuelles »).
--
-- 1) invoices.schedule_event_id : lie la facture à sa visite (idempotence —
--    re-compléter une visite ne crée jamais une 2e facture).
-- 2) RPC create_invoice_from_visit : montant = part égale du total du job
--    (total_cents ÷ nb de visites actives) ; la DERNIÈRE visite facturée
--    reçoit le reste exact pour que la somme des factures = total du job.
--    Accessible à tout membre de l'org (les techniciens complètent les
--    visites sur le terrain) — le montant est déterministe, jamais choisi
--    par l'appelant.

begin;

-- ── 1) Lien facture ↔ visite ────────────────────────────────────────────
alter table public.invoices
  add column if not exists schedule_event_id uuid references public.schedule_events(id);

create unique index if not exists invoices_schedule_event_unique
  on public.invoices (schedule_event_id)
  where schedule_event_id is not null and deleted_at is null;

comment on column public.invoices.schedule_event_id is
  'Visite (schedule_events) que cette facture couvre — jobs en billing_mode per_visit.';

-- ── 2) RPC : créer la facture d''une visite (idempotent) ────────────────
drop function if exists public.create_invoice_from_visit(uuid, uuid, uuid, boolean);
create or replace function public.create_invoice_from_visit(
  p_org_id uuid,
  p_job_id uuid,
  p_visit_id uuid,
  p_send_now boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_job record;
  v_visit record;
  v_existing record;
  v_invoice_id uuid;
  v_invoice_status text;
  v_invoice_number text;
  v_amount integer;
  v_visit_count integer;
  v_invoiced_cents integer;
  v_invoiced_count integer;
  v_label text;
  v_visit_date date;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null or p_job_id is null or p_visit_id is null then
    raise exception 'p_org_id, p_job_id and p_visit_id are required' using errcode = '22023';
  end if;

  -- Membre de l'org suffit : les visites sont complétées par les techniciens
  -- sur le terrain et le montant est calculé ici, jamais fourni par l'appelant.
  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this organization' using errcode = '42501';
  end if;

  select j.id, j.org_id, j.client_id, j.title, j.total_cents, j.deleted_at
    into v_job
  from public.jobs j
  where j.id = p_job_id
    and j.org_id = p_org_id
  limit 1;

  if not found or v_job.deleted_at is not null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;

  if v_job.client_id is null then
    raise exception 'Job must be linked to a client before invoicing' using errcode = '23514';
  end if;

  select e.id, e.start_at, e.timezone, e.deleted_at
    into v_visit
  from public.schedule_events e
  where e.id = p_visit_id
    and e.job_id = p_job_id
    and e.org_id = p_org_id
  limit 1;

  if not found or v_visit.deleted_at is not null then
    raise exception 'Visit not found' using errcode = 'P0002';
  end if;

  -- Idempotence : une visite = au plus une facture.
  select i.id, i.status
    into v_existing
  from public.invoices i
  where i.schedule_event_id = p_visit_id
    and i.deleted_at is null
  order by i.created_at desc
  limit 1;

  if found then
    if p_send_now and v_existing.status = 'draft' then
      update public.invoices
         set status = 'sent',
             issued_at = coalesce(issued_at, now()),
             updated_at = now()
       where id = v_existing.id;
      select status into v_invoice_status from public.invoices where id = v_existing.id;
    else
      v_invoice_status := v_existing.status;
    end if;
    return jsonb_build_object(
      'invoice_id', v_existing.id,
      'already_exists', true,
      'status', coalesce(v_invoice_status, v_existing.status)
    );
  end if;

  -- Part de cette visite : total du job ÷ visites actives ; la dernière
  -- visite non facturée reçoit le reste exact (somme = total, au cent près).
  select count(*)::int into v_visit_count
  from public.schedule_events e
  where e.job_id = p_job_id
    and e.org_id = p_org_id
    and e.deleted_at is null;

  select coalesce(sum(i.total_cents), 0)::int, count(*)::int
    into v_invoiced_cents, v_invoiced_count
  from public.invoices i
  where i.job_id = p_job_id
    and i.schedule_event_id is not null
    and i.deleted_at is null;

  if v_visit_count <= 0 then
    raise exception 'Job has no active visits' using errcode = '23514';
  end if;

  if v_invoiced_count >= v_visit_count - 1 then
    v_amount := greatest(coalesce(v_job.total_cents, 0) - v_invoiced_cents, 0);
  else
    v_amount := round(coalesce(v_job.total_cents, 0)::numeric / v_visit_count)::int;
  end if;

  if v_amount <= 0 then
    raise exception 'Nothing left to invoice for this job' using errcode = '23514';
  end if;

  v_visit_date := (v_visit.start_at at time zone coalesce(nullif(v_visit.timezone, ''), 'America/Montreal'))::date;
  v_label := coalesce(nullif(trim(v_job.title), ''), 'Job')
    || ' — Visite du ' || to_char(v_visit_date, 'YYYY-MM-DD');

  v_invoice_number := public.invoice_next_number(p_org_id);

  insert into public.invoices (
    org_id,
    created_by,
    client_id,
    job_id,
    schedule_event_id,
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
    p_org_id,
    v_uid,
    v_job.client_id,
    p_job_id,
    p_visit_id,
    v_invoice_number,
    case when p_send_now then 'sent' else 'draft' end,
    v_label,
    case when p_send_now then now() else null end,
    (current_date + interval '14 days')::date,
    0, 0, 0, 0, 0
  )
  returning id, status into v_invoice_id, v_invoice_status;

  insert into public.invoice_items (org_id, invoice_id, description, qty, unit_price_cents, line_total_cents)
  values (p_org_id, v_invoice_id, v_label, 1, v_amount, v_amount);

  perform public.recalculate_invoice_totals(v_invoice_id);

  if p_send_now then
    update public.invoices
       set status = 'sent',
           issued_at = coalesce(issued_at, now()),
           updated_at = now()
     where id = v_invoice_id;
  end if;

  select status into v_invoice_status from public.invoices where id = v_invoice_id;

  if to_regclass('public.audit_events') is not null then
    execute
      'insert into public.audit_events (org_id, actor_id, event_type, metadata, created_at)
       values ($1, $2, $3, $4::jsonb, now())'
    using p_org_id, v_uid, 'invoice.created_from_visit', jsonb_build_object(
      'job_id', p_job_id,
      'visit_id', p_visit_id,
      'invoice_id', v_invoice_id,
      'send_now', p_send_now
    );
  end if;

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'already_exists', false,
    'status', coalesce(v_invoice_status, case when p_send_now then 'sent' else 'draft' end)
  );
exception
  when unique_violation then
    select i.id, i.status
      into v_existing
    from public.invoices i
    where i.schedule_event_id = p_visit_id
      and i.deleted_at is null
    order by i.created_at desc
    limit 1;

    if found then
      return jsonb_build_object(
        'invoice_id', v_existing.id,
        'already_exists', true,
        'status', v_existing.status
      );
    end if;

    raise;
end;
$fn$;

revoke all on function public.create_invoice_from_visit(uuid, uuid, uuid, boolean) from public;
grant execute on function public.create_invoice_from_visit(uuid, uuid, uuid, boolean) to authenticated, service_role;

commit;
