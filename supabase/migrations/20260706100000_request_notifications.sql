begin;

-- ═══════════════════════════════════════════════════════════════
-- Request notifications — align public.notifications with the app
-- ═══════════════════════════════════════════════════════════════
-- The table was created (20260305190000) with a minimal shape:
-- (id, org_id, type, ref_id, title, body, metadata, read_at, ...).
-- Later code references columns that were never added, so those
-- writes/reads fail silently in prod:
--   • useRealtimeNotifications selects entity_type → sidebar badges
--     always empty
--   • automation-events / alerts-engine insert entity_type/entity_id/
--     category/user_id → inserts rejected
--   • quotes.ts inserts icon/reference_id → inserts rejected
-- Adding the columns fixes the existing paths and enables the new
-- "request received" notification (badge Requests + Pipeline, toast).

alter table public.notifications add column if not exists user_id uuid;
alter table public.notifications add column if not exists entity_type text;
alter table public.notifications add column if not exists entity_id uuid;
alter table public.notifications add column if not exists category text;
alter table public.notifications add column if not exists icon text;
alter table public.notifications add column if not exists reference_id uuid;
alter table public.notifications add column if not exists dismissed_at timestamptz;

-- Badge counts query: unread rows grouped by entity_type, per org.
create index if not exists idx_notifications_org_unread_entity
  on public.notifications (org_id, entity_type)
  where is_read = false;

-- Safety: make sure notifications is in the realtime publication — without
-- this the client never receives INSERT events (no toast, no live badge).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.notifications;
    exception when duplicate_object then
      null;
    end;
  end if;
end;
$$;

commit;
