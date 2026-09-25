-- ═══════════════════════════════════════════════════════════════
-- Supprimer une job doit délier le deal qui la portait
--
-- LE DÉFAUT. `deals.job_id` continuait de pointer vers une job effacée.
-- Rien ne plantait — c'est bien le problème :
--
--   · le badge « Job à créer » est dérivé de `kind = 'won'` ET de
--     `job_id is null` (`estJobACreer`). Un deal gagné dont la job vient
--     d'être supprimée gardait donc son `job_id` : le badge ne s'affichait
--     pas, et plus rien ne rappelait qu'il n'y avait aucune job à exécuter.
--
--   · la fiche du deal montre un lien vers une job qui n'existe plus.
--
-- Le montant, lui, se comportait déjà bien : `pipeline_montants` ignore une
-- job supprimée et retombe sur le devis. C'est l'état du deal qui mentait,
-- pas le chiffre.
--
-- Trouvé sur la production : un deal pointait vers une job supprimée la
-- veille pendant le QA. Il n'était pas gagné, donc personne ne l'avait vu —
-- le défaut était latent, pas visible.
--
-- CE QU'ON NE FAIT PAS. On ne déplace pas le deal et on ne touche pas à son
-- étape : supprimer une job n'annule pas une vente. On retire seulement un
-- lien devenu faux, et le badge « Job à créer » réapparaît de lui-même,
-- puisqu'il est dérivé.
--
-- ROLLBACK :
--   drop trigger if exists trg_jobs_delier_deal on public.jobs;
--   drop function if exists public.jobs_delier_deal();
-- ═══════════════════════════════════════════════════════════════

begin;

create or replace function public.jobs_delier_deal()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  -- Soft delete : la job passe de vivante à effacée.
  if old.deleted_at is null and new.deleted_at is not null then
    update public.deals
    set job_id = null, updated_at = now()
    where job_id = new.id
      and deleted_at is null;
  end if;

  -- Restauration : on ne re-lie RIEN. Le deal a pu être rattaché à une autre
  -- job entre-temps, et deviner lequel reprendre créerait un lien inventé.
  return new;
end;
$fn$;

comment on function public.jobs_delier_deal() is
  'Une job supprimée délie le deal qui la portait : sans ça `deals.job_id` pointait dans le vide et le badge « Job à créer » ne réapparaissait jamais (2026-09-25).';

drop trigger if exists trg_jobs_delier_deal on public.jobs;

create trigger trg_jobs_delier_deal
  after update of deleted_at on public.jobs
  for each row
  execute function public.jobs_delier_deal();

-- Le lien déjà cassé en production, réparé une fois.
update public.deals d
set job_id = null, updated_at = now()
from public.jobs j
where j.id = d.job_id
  and d.deleted_at is null
  and j.deleted_at is not null;

commit;
