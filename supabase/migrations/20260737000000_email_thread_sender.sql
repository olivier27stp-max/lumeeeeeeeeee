-- ============================================================
-- Add sender columns to email_threads so the inbox list can show
-- the sender (name + email) like Gmail, not just the subject.
-- Additif.
-- ============================================================
alter table public.email_threads add column if not exists from_name  text;
alter table public.email_threads add column if not exists from_email text;
