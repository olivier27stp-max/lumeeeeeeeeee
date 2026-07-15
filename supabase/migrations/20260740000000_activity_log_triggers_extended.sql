/* ═══════════════════════════════════════════════════════════════
   Extended activity_log triggers — capture create/update events for
   jobs, quotes, invoices that are written client-side via RPC (so the
   server eventBus never sees them). All carry client_id as the related
   entity so they surface on the client's Events panel too.
   Anti-noise: job/invoice UPDATE only logs *notable* field changes.
   ═══════════════════════════════════════════════════════════════ */

-- ── Job CREATED (any source: direct RPC, API, import) ─────────
create or replace function public.log_job_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_log (org_id, entity_type, entity_id, related_entity_type, related_entity_id, event_type, actor_id, metadata)
  values (
    new.org_id,
    'job',
    new.id,
    case when new.client_id is not null then 'client' else null end,
    new.client_id,
    'job_created',
    coalesce(new.created_by, auth.uid()),
    jsonb_build_object('title', coalesce(new.title, ''), 'client_id', coalesce(new.client_id::text, ''))
  );
  return new;
end;
$$;

drop trigger if exists trg_log_job_created on public.jobs;
create trigger trg_log_job_created
  after insert on public.jobs
  for each row execute function public.log_job_created();

-- ── Job UPDATED — notable changes only (schedule / amount) ────
-- Status changes are already handled by log_job_completed (existing trigger),
-- so we skip status here to avoid duplicate rows.
create or replace function public.log_job_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only log when the schedule or the total changed, and it is not a soft-delete.
  if new.deleted_at is null and (
       new.scheduled_at is distinct from old.scheduled_at
    or new.total_amount is distinct from old.total_amount
  ) then
    insert into public.activity_log (org_id, entity_type, entity_id, related_entity_type, related_entity_id, event_type, actor_id, metadata)
    values (
      new.org_id,
      'job',
      new.id,
      case when new.client_id is not null then 'client' else null end,
      new.client_id,
      'job_updated',
      auth.uid(),
      jsonb_build_object(
        'title', coalesce(new.title, ''),
        'scheduled_changed', (new.scheduled_at is distinct from old.scheduled_at),
        'amount_changed', (new.total_amount is distinct from old.total_amount)
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_job_updated on public.jobs;
create trigger trg_log_job_updated
  after update on public.jobs
  for each row execute function public.log_job_updated();

-- ── Quote CREATED ────────────────────────────────────────────
create or replace function public.log_quote_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_log (org_id, entity_type, entity_id, related_entity_type, related_entity_id, event_type, actor_id, metadata)
  values (
    new.org_id,
    'quote',
    new.id,
    case when new.client_id is not null then 'client' else null end,
    new.client_id,
    'quote_created',
    coalesce(new.created_by, auth.uid()),
    jsonb_build_object('quote_number', coalesce(new.quote_number, ''), 'total_cents', coalesce(new.total_cents, 0))
  );
  return new;
end;
$$;

drop trigger if exists trg_log_quote_created on public.quotes;
create trigger trg_log_quote_created
  after insert on public.quotes
  for each row execute function public.log_quote_created();

-- ── Invoice UPDATED — notable change only (total_cents) ───────
-- Creation, sent, and paid are already logged elsewhere; here we only
-- capture edits that change the invoice total.
create or replace function public.log_invoice_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.total_cents is distinct from old.total_cents then
    insert into public.activity_log (org_id, entity_type, entity_id, related_entity_type, related_entity_id, event_type, actor_id, metadata)
    values (
      new.org_id,
      'invoice',
      new.id,
      case when new.client_id is not null then 'client' else null end,
      new.client_id,
      'invoice_updated',
      auth.uid(),
      jsonb_build_object(
        'invoice_number', coalesce(new.invoice_number, ''),
        'old_total_cents', coalesce(old.total_cents, 0),
        'new_total_cents', coalesce(new.total_cents, 0)
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_invoice_updated on public.invoices;
create trigger trg_log_invoice_updated
  after update on public.invoices
  for each row execute function public.log_invoice_updated();
