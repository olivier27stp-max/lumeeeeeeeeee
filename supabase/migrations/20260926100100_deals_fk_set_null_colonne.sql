-- ═══════════════════════════════════════════════════════════════
-- Supprimer une job (ou un devis) liée à un deal échouait
--
-- Trouvé pendant l'audit des champs personnalisés (2026-09-24), reproduit
-- sur staging dans une transaction annulée :
--   delete from jobs where id = <job lié à un deal>
--   → 23502 null value in column "org_id" of relation "deals"
--
-- Cause : une FK COMPOSITE (org_id, job_id) en « on delete set null » SANS
-- liste de colonnes remet À NULL TOUTES ses colonnes — org_id compris, qui
-- est NOT NULL. L'intention (délier le deal) exige `set null (job_id)`,
-- possible depuis Postgres 15 (prod : 17.6).
--
-- Seules ces trois FK de toute la base ont ce défaut (requête sur
-- pg_constraint : confdeltype = 'n' et plus d'une colonne).
-- Même cible, même action ; seule la liste de colonnes change. La
-- validation est immédiate : les lignes existantes satisfont déjà la FK.
-- ═══════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';

alter table public.deals drop constraint if exists deals_job_same_org;
alter table public.deals add constraint deals_job_same_org
  foreign key (org_id, job_id) references public.jobs (org_id, id)
  on delete set null (job_id);

alter table public.deals drop constraint if exists deals_quote_same_org;
alter table public.deals add constraint deals_quote_same_org
  foreign key (org_id, quote_id) references public.quotes (org_id, id)
  on delete set null (quote_id);

alter table public.deals drop constraint if exists deals_lost_from_stage_same_org;
alter table public.deals add constraint deals_lost_from_stage_same_org
  foreign key (org_id, lost_from_stage_id) references public.pipeline_stages (org_id, id)
  on delete set null (lost_from_stage_id);

commit;
