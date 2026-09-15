-- ═══════════════════════════════════════════════════════════════════
-- Bot de migration : suivi par migration
-- ───────────────────────────────────────────────────────────────────
-- Le bot (server/lib/migration/bot.ts) fait avancer une migration assistée
-- « lorsque demandé » : analyse, gabarits, correspondances, doublons,
-- import test, questions au client, demande d'approbation. Jamais
-- l'approbation ni l'import final (humains). Trois colonnes :
--   bot_actif              : le cron le relance tout seul tant que c'est vrai
--   bot_derniere_execution : quand il est passé la dernière fois
--   bot_dernier_rapport    : ce qu'il a décidé (aussi dans migration_audit_logs,
--                            acteur 'assistant' ; ici pour l'écran admin)
-- N'ajoute que trois colonnes nullables / à défaut. Aucune autre table,
-- politique ou fonction touchée.
-- ═══════════════════════════════════════════════════════════════════
alter table public.data_migrations
  add column if not exists bot_actif boolean not null default false,
  add column if not exists bot_derniere_execution timestamptz,
  add column if not exists bot_dernier_rapport jsonb;

comment on column public.data_migrations.bot_actif is
  'Le bot de migration relance cette migration tout seul (cron) tant que c''est vrai. L''approbation client et l''import final restent humains.';

create index if not exists data_migrations_bot_actif_idx
  on public.data_migrations (bot_actif)
  where bot_actif = true and deleted_at is null;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'data_migrations' and column_name = 'bot_actif') then
    raise exception 'data_migrations.bot_actif manquante';
  end if;
end $$;
