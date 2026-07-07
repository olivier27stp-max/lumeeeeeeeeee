begin;

-- The prod notifications table has a legacy `message text NOT NULL` column
-- that exists in no migration file and that the app never writes. Every
-- insert into notifications (requests, quote accepted/declined, alerts,
-- automation events) has been failing with 23502 since the column appeared.
-- Confirmed live 2026-07-07 via service-role diagnostic: insert without
-- `message` → 23502; insert with it → succeeds and realtime delivers.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notifications'
      and column_name = 'message'
  ) then
    alter table public.notifications alter column message drop not null;
    alter table public.notifications alter column message set default '';
  end if;
end $$;

commit;
