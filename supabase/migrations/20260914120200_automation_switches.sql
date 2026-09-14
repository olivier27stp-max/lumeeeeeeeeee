-- Audit automatisations 2026-09-13, F6 — migration M2.
-- Pause par org et mode simulation. Le kill switch GLOBAL est une variable
-- d'environnement (AUTOMATIONS_ENABLED), pas une ligne en base : il doit
-- marcher même si la base est en cause.
alter table public.company_settings
  add column if not exists automations_paused_at timestamptz,
  add column if not exists automations_dry_run boolean not null default false;
comment on column public.company_settings.automations_paused_at is
  'Non nul = aucune automatisation ne part pour cette org ; les tâches restent pending.';
comment on column public.company_settings.automations_dry_run is
  'true = le moteur journalise ce qu''il aurait envoyé (result_data.dry_run) sans appeler Twilio/SMTP.';
