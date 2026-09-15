-- Archivage automatique des canaux clients inactifs (2026-09-16) : un canal
-- sans demande ouverte depuis N jours est archivé par le bot (il sort de la
-- barre latérale, l'historique reste) et désarchivé à la prochaine demande.
alter table public.support_slack_channels
  add column if not exists archived_at timestamptz;
