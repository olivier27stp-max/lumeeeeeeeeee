-- ORDER_HINT: 1/2 — timestamp collision with 20260412000000_tax_registration_numbers.sql
-- (Issue C-001, audit 2026-04-21). Apply this file BEFORE the sibling.
-- Lexicographic order by full filename matches intended order. Do NOT rename (would break applied-migration checksums).

-- Relax email format check constraints to allow encrypted PII values.
-- Encrypted values are prefixed with "enc:" and are base64-encoded,
-- so they won't match email format. The check now allows either:
--   1. Valid email format (plaintext)
--   2. "enc:" prefixed encrypted values
--   3. NULL

-- Leads table
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_email_format_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_email_format_check
  CHECK (email IS NULL OR email ~ '^enc:' OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- Clients table (if constraint exists)
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_email_format_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_email_format_check
  CHECK (email IS NULL OR email ~ '^enc:' OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- Phone format checks (if they exist)
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_phone_format_check;
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_phone_format_check;
