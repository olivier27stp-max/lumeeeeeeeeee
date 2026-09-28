-- ═══════════════════════════════════════════════════════════════
-- Rendre aux administrateurs l'accès qu'ils avaient avant #693
--
-- CONTEXTE. Avant 20260929190000, un administrateur voyait TOUS les
-- pipelines, même restreints : la liste d'accès ne le concernait pas. #693
-- l'y soumet. Les pipelines déjà restreints ont donc, d'un coup, disparu
-- pour leurs administrateurs non listés — qui n'avaient jamais eu à y être.
-- Mesuré en prod le 2026-09-28 : Coquin lavage, « Pipeline de ventes » et
-- « Pipeline de ventes (copie) », Maxime Gagné et Nathan Côté.
--
-- CORRECTIF. Pour chaque pipeline DÉJÀ restreint, chaque administrateur
-- actif absent de la liste y est ajouté avec « Voir » (un admin qui voit
-- modifie : `peut_modifier` n'est pas nécessaire). C'est exactement l'accès
-- qu'il avait avant. Le propriétaire peut ensuite le décocher, cette fois
-- en le choisissant.
--
-- Un pipeline OUVERT (aucune ligne) n'est pas touché : en ajouter le
-- restreindrait. Un admin déjà listé n'est pas dupliqué (idempotent).
--
-- ROLLBACK :
--   delete from public.pipeline_acces
--   where created_by is null and created_at = <horodatage de ce lot>;
--   (les lignes de ce lot sont les seules posées sans auteur, en une fois)
-- ═══════════════════════════════════════════════════════════════

begin;

insert into public.pipeline_acces (org_id, pipeline_id, user_id, peut_modifier, created_by)
select p.org_id, p.id, m.user_id, false, null
from public.pipelines_ventes p
join public.memberships m
  on m.org_id = p.org_id
 and m.role = 'admin'
 and coalesce(m.status, 'active') = 'active'
where p.archived_at is null
  and exists (select 1 from public.pipeline_acces a where a.pipeline_id = p.id)
  and not exists (
    select 1 from public.pipeline_acces a
    where a.pipeline_id = p.id and a.user_id = m.user_id
  )
on conflict (pipeline_id, user_id) do nothing;

commit;
