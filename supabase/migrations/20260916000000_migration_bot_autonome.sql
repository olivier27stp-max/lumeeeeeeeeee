-- Bot de migration : mode autonome (le client n'a rien à faire).
-- 'autonome' (défaut) : le bot ne pose jamais de question au client ; il prend
--   l'option qui ne perd rien et se défait (colonne inconnue → notes, doublon
--   sur le nom seul → nouvelle fiche) et prévient l'admin Lume.
-- 'client'  : comportement d'avant, questions regroupées dans le portail.
alter table public.data_migrations
  add column if not exists bot_mode text not null default 'autonome';

alter table public.data_migrations
  drop constraint if exists data_migrations_bot_mode_check;
alter table public.data_migrations
  add constraint data_migrations_bot_mode_check check (bot_mode in ('client', 'autonome'));

comment on column public.data_migrations.bot_mode is
  'autonome = le bot ne demande rien au client (défauts sûrs, admin prévenu) ; client = questions dans le portail';
