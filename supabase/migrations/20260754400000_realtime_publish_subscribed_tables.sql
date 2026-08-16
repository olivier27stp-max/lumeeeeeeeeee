-- Realtime : publie les tables auxquelles le frontend s'abonne déjà.
--
-- Le code s'abonne (postgres_changes) à 12 tables de plus que ce que la
-- publication supabase_realtime contient — ces abonnements ne recevaient
-- JAMAIS d'événement : Pipeline sans live-sync, calendrier/équipes/factures
-- sans rafraîchissement en direct. (La 12e, `leads`, n'existe plus — son
-- abonnement dans Pipeline.tsx est du code mort, inoffensif.)
--
-- Le RLS s'applique aussi au realtime : chaque client ne reçoit que les
-- lignes que ses policies lui laissent voir.

do $$
declare
  t text;
begin
  foreach t in array array[
    'clients', 'invoices', 'jobs', 'pipeline_deals', 'quotes',
    'recurring_team_schedules', 'schedule_events', 'team_schedule_assignments',
    'teams', 'time_entries', 'time_off_requests'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
