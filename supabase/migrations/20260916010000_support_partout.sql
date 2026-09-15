-- Support « le même partout » : un ticket sait d'où il vient (app, portail de
-- migration, site public) et, pour le portail, à quelle migration il se rattache.
-- Les réponses humaines (Slack) sont ainsi renvoyées au bon endroit.
alter table public.support_tickets
  add column if not exists source text not null default 'app',
  add column if not exists migration_id uuid references public.data_migrations(id) on delete set null;

alter table public.support_tickets
  drop constraint if exists support_tickets_source_check;
alter table public.support_tickets
  add constraint support_tickets_source_check check (source in ('app', 'migration_portal', 'public'));

create index if not exists support_tickets_migration on public.support_tickets (migration_id, last_message_at desc)
  where migration_id is not null;

comment on column public.support_tickets.source is 'D''où le client a écrit : app (chat d''aide), migration_portal (portail de migration), public (site).';
