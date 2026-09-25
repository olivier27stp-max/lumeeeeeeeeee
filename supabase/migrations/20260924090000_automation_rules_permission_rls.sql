-- ═══════════════════════════════════════════════════════════════
-- Les automatisations deviennent modifiables par l'utilisateur —
-- la RLS doit donc porter la permission de la page Rôles.
--
-- AVANT : les 4 policies de `automation_rules` ne vérifiaient que
-- l'appartenance à l'org (`org_id IN (SELECT ... FROM memberships)`).
-- Tant que la table n'était qu'un catalogue de préréglages en lecture,
-- ça passait : personne ne pouvait rien y écrire depuis l'interface.
--
-- À partir du moment où l'interface permet de CRÉER une automatisation,
-- cette policy laisse n'importe quel membre — un technicien, un vendeur —
-- écrire une règle qui envoie des SMS et des courriels aux clients au nom
-- de l'entreprise. C'est exactement ce que la page Rôles est censée
-- empêcher.
--
-- APRÈS : lecture = `automations.read`, écriture = `automations.update`,
-- avec `member_has_permission()`, comme `invoices` et `quotes`.
--
-- Les deux clés existent déjà (`src/lib/permissions.ts:320-321`) et sont
-- déjà distribuées par `ROLE_PRESETS` — aucune migration de données, aucun
-- rôle à reconfigurer.
--
-- Le moteur, lui, n'est pas concerné : il écrit avec le client service_role
-- (`getServiceClient()`), qui contourne la RLS.
-- ═══════════════════════════════════════════════════════════════

-- ── Lecture ──────────────────────────────────────────────────
drop policy if exists automation_rules_select_org on public.automation_rules;
create policy automation_rules_select_org
  on public.automation_rules
  for select
  to authenticated
  using (member_has_permission((select auth.uid()), org_id, 'automations.read'));

-- ── Création ─────────────────────────────────────────────────
drop policy if exists automation_rules_insert_org on public.automation_rules;
create policy automation_rules_insert_org
  on public.automation_rules
  for insert
  to authenticated
  with check (member_has_permission((select auth.uid()), org_id, 'automations.update'));

-- ── Modification ─────────────────────────────────────────────
-- WITH CHECK autant que USING : sans le premier, on pourrait modifier une
-- règle pour la déplacer vers une autre org.
drop policy if exists automation_rules_update_org on public.automation_rules;
create policy automation_rules_update_org
  on public.automation_rules
  for update
  to authenticated
  using (member_has_permission((select auth.uid()), org_id, 'automations.update'))
  with check (member_has_permission((select auth.uid()), org_id, 'automations.update'));

-- ── Suppression ──────────────────────────────────────────────
drop policy if exists automation_rules_delete_org on public.automation_rules;
create policy automation_rules_delete_org
  on public.automation_rules
  for delete
  to authenticated
  using (member_has_permission((select auth.uid()), org_id, 'automations.update'));

-- ── Les policies « _admin » doublées ─────────────────────────
-- Découvertes en vérifiant le résultat sur staging : elles n'étaient PAS dans
-- SCHEMA_SNAPSHOT.md, et elles doublent chaque écriture avec
-- `has_org_admin_role(...)`.
--
-- Les policies permissives se combinent en OU : tant qu'elles existent, un
-- admin écrit sans que `member_has_permission` soit seulement évalué. La
-- permission « Modifier les automatisations » de la page Rôles devient alors
-- décorative pour lui — on croit l'avoir retirée, et elle continue de passer.
--
-- Les retirer n'enlève aucun accès : `ROLE_PRESETS.admin` est `allTrue()`
-- (src/lib/permissions.ts), donc tout admin détient `automations.update` et
-- passe désormais par la policy qui porte la clé. La différence est qu'un
-- propriétaire peut maintenant réellement la lui retirer.
drop policy if exists automation_rules_insert_admin on public.automation_rules;
drop policy if exists automation_rules_update_admin on public.automation_rules;
drop policy if exists automation_rules_delete_admin on public.automation_rules;
