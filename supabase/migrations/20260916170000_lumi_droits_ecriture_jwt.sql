-- Lumi écrit avec le JWT de l'utilisateur (règle 4 du mandat : jamais
-- service_role dans le runtime de l'agent). Or 19 tables que ses outils
-- écrivent DIRECTEMENT n'accordent ni INSERT, ni UPDATE, ni DELETE au rôle
-- `authenticated` (vérifié sur staging ET en prod le 2026-09-16, par
-- has_table_privilege — jobs/invoices/quotes, eux, ont des droits par colonne
-- et fonctionnent). L'app n'y voit rien : ses routes passent par service_role.
-- Résultat : ~30 outils de Lumi (modèles de devis/facture, factures récurrentes,
-- relances, taxes, paie, objectifs, rapports planifiés, listes de vérification,
-- formations, terrain, demandes de formulaire) échouent à l'exécution avec
-- « permission denied for table … » — vu par le seed de la batterie.
--
-- Deux couches, comme pour invoices/quotes/payments (« RLS = page Rôles ») :
--   1. GRANT insert/update/delete à authenticated (les policies d'org existent
--      déjà sur chacune de ces tables : has_org_membership) ;
--   2. une policy RESTRICTIVE par table qui exige la MÊME clé de permission
--      que la garde de l'outil dans Lumi (garde.ts / PERMISSIONS_*), pour
--      qu'un membre sans ce droit ne puisse pas écrire par PostgREST ce que
--      la route serveur lui refuserait. service_role n'est pas concerné.
--
-- Changement de posture assumé (ces tables étaient « serveur seulement ») :
-- décidé par Rafba le 2026-09-16. L'alternative aurait été de réécrire ces
-- ~30 outils pour passer par les routes de l'app.
-- Appliquée sur staging puis en prod le 2026-09-16 (autorisation de Rafba) : droits, 57 policies
-- restrictives, check:broken-objects et check:db-coherence sans écart sur les deux.

begin;

-- 1) Droits de table (les colonnes restent toutes ouvertes : les policies font le tri par org et par permission).
grant insert, update, delete on table
  public.checklist_templates, public.courses, public.course_modules, public.course_lessons,
  public.field_house_profiles, public.field_settings, public.field_territories,
  public.form_submissions, public.goals, public.invoice_templates, public.job_checklists,
  public.payroll_settings, public.quote_templates, public.recurring_invoice_schedules,
  public.reminder_settings, public.scheduled_reports, public.tax_configs, public.tax_groups, public.tax_group_items
to authenticated;

-- 2) Policies restrictives : clé de permission = celle de l'outil Lumi correspondant.
create or replace function public._lumi_policy_permission(p_table text, p_cmd text, p_expr text)
returns void language plpgsql as $$
declare v_nom text := format('%s_perm_%s', p_table, lower(p_cmd));
begin
  execute format('drop policy if exists %I on public.%I', v_nom, p_table);
  if p_cmd = 'INSERT' then
    execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (%s)', v_nom, p_table, p_expr);
  elsif p_cmd = 'UPDATE' then
    execute format('create policy %I on public.%I as restrictive for update to authenticated using (%s) with check (%s)', v_nom, p_table, p_expr, p_expr);
  else
    execute format('create policy %I on public.%I as restrictive for delete to authenticated using (%s)', v_nom, p_table, p_expr);
  end if;
end $$;

-- Tables à org_id : une clé par commande.
do $$
declare
  t record;
begin
  for t in select * from (values
    ('checklist_templates',        'settings.update',        'settings.update',        'settings.update'),
    ('courses',                    'team.update',            'team.update',            'team.update'),
    ('field_house_profiles',       'door_to_door.edit',      'door_to_door.edit',      'door_to_door.edit'),
    ('field_settings',             'door_to_door.edit',      'door_to_door.edit',      'door_to_door.edit'),
    ('field_territories',          'door_to_door.edit',      'door_to_door.edit',      'door_to_door.edit'),
    ('form_submissions',           'leads.update',           'leads.update',           'leads.delete'),
    ('goals',                      'reports.read',           'reports.read',           'reports.read'),
    ('invoice_templates',          'invoices.create',        'invoices.update',        'invoices.delete'),
    ('job_checklists',             'jobs.update',            'jobs.update',            'jobs.update'),
    ('payroll_settings',           'settings.update',        'settings.update',        'settings.update'),
    ('quote_templates',            'quotes.update',          'quotes.update',          'quotes.delete'),
    ('recurring_invoice_schedules','invoices.create',        'invoices.update',        'invoices.delete'),
    ('reminder_settings',          'settings.update',        'settings.update',        'settings.update'),
    ('scheduled_reports',          'financial.view_reports', 'financial.view_reports', 'financial.view_reports'),
    ('tax_configs',                'settings.update',        'settings.update',        'settings.update'),
    ('tax_groups',                 'settings.update',        'settings.update',        'settings.update')
  ) as v(tbl, k_ins, k_upd, k_del)
  loop
    perform public._lumi_policy_permission(t.tbl, 'INSERT', format('public.member_has_permission((select auth.uid()), org_id, %L)', t.k_ins));
    perform public._lumi_policy_permission(t.tbl, 'UPDATE', format('public.member_has_permission((select auth.uid()), org_id, %L)', t.k_upd));
    perform public._lumi_policy_permission(t.tbl, 'DELETE', format('public.member_has_permission((select auth.uid()), org_id, %L)', t.k_del));
  end loop;
end $$;

-- Tables sans org_id : par leur parent.
do $$
declare
  e_mod text := 'exists (select 1 from public.courses c where c.id = course_id and public.member_has_permission((select auth.uid()), c.org_id, ''team.update''))';
  e_lec text := 'exists (select 1 from public.course_modules m join public.courses c on c.id = m.course_id where m.id = module_id and public.member_has_permission((select auth.uid()), c.org_id, ''team.update''))';
  e_tgi text := 'exists (select 1 from public.tax_groups g where g.id = tax_group_id and public.member_has_permission((select auth.uid()), g.org_id, ''settings.update''))';
  c text;
begin
  foreach c in array array['INSERT', 'UPDATE', 'DELETE'] loop
    perform public._lumi_policy_permission('course_modules', c, e_mod);
    perform public._lumi_policy_permission('course_lessons', c, e_lec);
    perform public._lumi_policy_permission('tax_group_items', c, e_tgi);
  end loop;
end $$;

drop function public._lumi_policy_permission(text, text, text);

commit;
