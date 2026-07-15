-- ============================================================
-- Store the RFC 2822 Message-ID header on each message so replies
-- can set In-Reply-To / References correctly (proper threading).
-- Additif.
-- ============================================================
alter table public.email_messages add column if not exists rfc_message_id text;
