-- ============================================================================
-- D4 : jobs.client_id ON DELETE CASCADE -> SET NULL (2026-08-02)
-- ============================================================================
-- Avant : supprimer un client hard-deletait TOUS ses jobs (et via la chaine,
-- ses deals) sans trace. Desormais SET NULL => le job survit (client_id NULL,
-- recuperable) au lieu d'etre efface silencieusement.
-- SUR : le flux normal passe par delete_client_cascade (supprime les jobs AVANT
-- le client => SET NULL ne se declenche jamais la) ; la suppression d'org efface
-- les jobs via jobs.org_id CASCADE ; SET NULL ne BLOQUE jamais (contrairement a
-- RESTRICT). La composite jobs_client_id_same_org (NO ACTION) reste inchangee et
-- passe sur (org_id, NULL). jobs.client_id est nullable, 37 lignes toutes valides.
-- ============================================================================

begin;
alter table public.jobs drop constraint jobs_client_id_fkey;
alter table public.jobs add constraint jobs_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete set null;
commit;
