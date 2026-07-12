-- ════════════════════════════════════════════════════════════════════
-- Agreements are JOB-ONLY — a signed quote is itself the approved contract
-- ────────────────────────────────────────────────────────────────────
-- Business rule change:
--   • An agreement can only be attached to a job (never to a quote).
--   • A job whose quote was converted into it (quotes.job_id = job)
--     cannot receive an agreement: the quote IS the approved document,
--     and the client must never be asked for a second signature.
--
-- Existing quote-linked agreements (job_id null, quote_id set):
--   • unsigned (draft/sent) → soft-archived (deleted_at). Nothing signed
--     is lost; the quote's own signature flow replaces them.
--   • signed → kept as read-only historical rows. Their public
--     /contract/:view_token link keeps working through the frozen
--     `snapshot`. They are never re-attached to the job: a converted
--     quote is always the job's approved document, so attaching the old
--     agreement would create the forbidden "quote AND agreement" state.
--
-- The legacy `quote_id` column is kept for those historical rows only —
-- the trigger below makes any NEW quote association impossible, even
-- through direct PostgREST/API calls.
--
-- Idempotent — safe to run multiple times.
-- Apply with: npx tsx scripts/apply-sql.ts supabase/migrations/20260733000000_agreements_job_only.sql
-- ════════════════════════════════════════════════════════════════════

begin;

-- ── 1) Archive unsigned quote-linked agreements ─────────────────────
update public.job_agreements
set deleted_at = now(),
    updated_at = now()
where quote_id is not null
  and job_id is null
  and deleted_at is null
  and status <> 'signed';

-- ── 2) Enforce the new rules at the database level ──────────────────
create or replace function public.job_agreements_enforce_job_only()
returns trigger
language plpgsql
as $$
begin
  -- New agreements can never attach to a quote.
  if (tg_op = 'INSERT' and new.quote_id is not null)
     or (tg_op = 'UPDATE' and new.quote_id is not null
         and new.quote_id is distinct from old.quote_id) then
    raise exception 'Agreements can no longer be attached to quotes. The signed quote itself is the approved contract.';
  end if;

  -- New agreements must attach to a job.
  if tg_op = 'INSERT' and new.job_id is null then
    raise exception 'An agreement must be attached to a job.';
  end if;

  -- A job that already has an associated (converted) quote cannot receive
  -- an agreement — the quote serves as the approved contract. Checked on
  -- insert, on re-parenting, and on un-archiving.
  if new.job_id is not null
     and new.deleted_at is null
     and (
       tg_op = 'INSERT'
       or new.job_id is distinct from old.job_id
       or (old.deleted_at is not null and new.deleted_at is null)
     )
     and exists (
       select 1 from public.quotes q
       where q.job_id = new.job_id
         and q.deleted_at is null
     ) then
    raise exception 'This job already has an associated quote. An agreement cannot be added because the quote serves as the approved contract for this job.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_job_agreements_job_only on public.job_agreements;
create trigger trg_job_agreements_job_only
  before insert or update on public.job_agreements
  for each row execute function public.job_agreements_enforce_job_only();

-- ── 3) Fast lookup of a job's source quote (Job Hub "Approved Quote"
--       card + trigger check above) ──────────────────────────────────
create index if not exists idx_quotes_job_id on public.quotes (job_id) where job_id is not null;

commit;

notify pgrst, 'reload schema';
