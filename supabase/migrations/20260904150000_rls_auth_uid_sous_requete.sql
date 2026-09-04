-- ═══════════════════════════════════════════════════════════════
-- auth.uid() évalué UNE FOIS par requête, pas une fois par ligne.
--
-- POURQUOI
-- Écrit directement dans une politique RLS, `auth.uid()` est un appel de
-- fonction que PostgreSQL réévalue POUR CHAQUE LIGNE examinée. Enveloppé
-- dans `(select auth.uid())`, il devient un InitPlan : calculé une seule
-- fois, puis réutilisé.
--
-- Sur une table de 50 000 lignes, c'est 50 000 appels contre 1.
--
-- CE QUI EST CORRIGÉ
-- 477 des 482 politiques citant auth.uid() utilisaient déjà la bonne
-- forme. Ces 5 étaient les dernières à ne pas l'avoir :
--     job_materials      select / insert / delete
--     job_time_logs      all
--     email_unsubscribes select
--
-- La LOGIQUE est identique — seule l'enveloppe change. Une politique qui
-- autorisait X autorise toujours X, et rien de plus.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── job_materials ────────────────────────────────────────────────
drop policy if exists job_materials_select on public.job_materials;
create policy job_materials_select on public.job_materials
  for select using (has_org_membership((select auth.uid()), org_id));

drop policy if exists job_materials_insert on public.job_materials;
create policy job_materials_insert on public.job_materials
  for insert with check (
    has_org_membership((select auth.uid()), org_id)
    and (created_by = (select auth.uid()))
  );

drop policy if exists job_materials_delete on public.job_materials;
create policy job_materials_delete on public.job_materials
  for delete using (has_org_membership((select auth.uid()), org_id));

-- ── job_time_logs ────────────────────────────────────────────────
drop policy if exists job_time_logs_all on public.job_time_logs;
create policy job_time_logs_all on public.job_time_logs
  for all
  using (has_org_membership((select auth.uid()), org_id))
  with check (has_org_membership((select auth.uid()), org_id));

-- ── email_unsubscribes ───────────────────────────────────────────
drop policy if exists email_unsubscribes_select_org on public.email_unsubscribes;
create policy email_unsubscribes_select_org on public.email_unsubscribes
  for select using (has_org_membership((select auth.uid()), org_id));

commit;
