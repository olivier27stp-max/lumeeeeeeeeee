-- Fix: completing a job (and other audited writes) failed with
--   "null value in column \"action\" of relation \"audit_events\" violates not-null constraint"
--
-- audit_events has a legacy `action text NOT NULL` column plus a newer
-- `event_type text` column. Every function now writes only `event_type` (e.g.
-- create_invoice_from_job inserts org_id, actor_id, event_type, metadata,
-- created_at), so the NOT NULL on the old `action` column rejects the insert.
-- Drop the NOT NULL so audit inserts succeed. Idempotent.

ALTER TABLE public.audit_events ALTER COLUMN action DROP NOT NULL;
-- Same problem on entity_type (legacy NOT NULL, functions don't fill it).
ALTER TABLE public.audit_events ALTER COLUMN entity_type DROP NOT NULL;
