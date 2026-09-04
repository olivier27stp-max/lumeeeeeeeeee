-- ═══════════════════════════════════════════════════════════════
-- Audit des métadonnées du 2026-09-04 : ce qui était réellement cassé.
--
-- MÉTHODE
-- Sur la prod, en lecture seule : 70 colonnes *_id sans clé étrangère
-- (orphelins comptés sur les 18 les plus parlantes : zéro), 139 relations
-- entre tables org-scopées (org_id parent = org_id enfant : zéro écart),
-- 14 vues (toutes security_invoker), 0 trigger désactivé, 0 table sans
-- clé primaire. Les advisors Supabase par-dessus.
--
-- Il reste QUATRE choses concrètes, corrigées ici.
--
-- 1. 17 CLÉS ÉTRANGÈRES « NOT VALID », JAMAIS VALIDÉES
--    Créées NOT VALID pour ne pas bloquer à l'époque, puis oubliées. Une
--    telle contrainte protège les nouvelles lignes mais tolère les
--    anciennes qui la violent — et deux le faisaient :
--      form_submissions.lead_id   11 soumissions (Coquin lavage, juin)
--                                 pointant vers un client supprimé.
--                                 La contrainte dit ON DELETE SET NULL :
--                                 on lui fait faire ce qu'elle aurait fait.
--      org_client_counters.org_id 6 compteurs d'organisations supprimées.
--                                 La contrainte dit ON DELETE CASCADE.
--    Les 15 autres n'ont aucune violation : validation directe.
--
-- 2. updated_at FIGÉ SUR TROIS TABLES
--    tasks, client_payment_profiles, job_tags ont la colonne mais aucun
--    trigger — et l'application ne la pose pas non plus. Sur tasks, en
--    prod, updated_at = created_at sur 100 % des lignes : « modifié le »
--    ment. set_updated_at() est le trigger standard du projet (105 tables).
--
-- 3. UNE POLITIQUE RLS RÉÉVALUÉE PAR LIGNE
--    demo_requests_platform_admin appelle current_setting() à nu : évalué
--    pour chaque ligne examinée. Enveloppé dans (select …), une seule fois.
--    Logique identique.
--
-- 4. DEUX FONCTIONS OUVERTES PAR LES PRIVILÈGES PAR DÉFAUT
--    Supabase accorde EXECUTE à anon et authenticated sur CHAQUE nouvelle
--    fonction. Un `revoke … from public` ne retire pas ces grants-là :
--    ce sont des grants explicites, pas hérités de PUBLIC. Sur 142
--    fonctions ayant un revoke dans les migrations, deux n'ont jamais eu
--    de grant voulu à authenticated et restaient pourtant appelables :
--      oauth_menage()            vérifié : un simple utilisateur l'exécute.
--                                Effet nul (ménage idempotent), privilège
--                                faux quand même. Le serveur l'appelle en
--                                service_role (index.ts).
--      search_global_source()    gardée par has_org_membership dans son
--                                corps (vérifié : 0 résultat depuis une
--                                autre org) ; seul le serveur l'appelle.
--                                Fermée par principe de moindre privilège.
--
-- CE QUI N'EST PAS TOUCHÉ, ET POURQUOI
--    pipeline_deals.stage_id, company_settings.review_template_id,
--    memberships/invitations.department_id pointent vers des tables qui
--    n'existent pas — mais 0 ligne renseignée et 0 usage en écriture.
--    Colonnes mortes, pas bugs. Les retirer serait un chantier à part.
--    orgs.company_group_id est une clé de regroupement multi-bureaux, pas
--    une clé étrangère : normal.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── 1. Faire rétroactivement ce que les contraintes auraient fait ──
update public.form_submissions s
   set lead_id = null
 where lead_id is not null
   and not exists (select 1 from public.clients c where c.id = s.lead_id);

delete from public.org_client_counters k
 where not exists (select 1 from public.orgs o where o.id = k.org_id);

-- ── puis valider les 17 ──────────────────────────────────────────
alter table public.field_house_profiles        validate constraint field_house_profiles_lead_id_fkey;
alter table public.field_rep_performance       validate constraint field_rep_performance_territory_id_fkey;
alter table public.field_settings              validate constraint field_settings_default_pin_template_id_fkey;
alter table public.field_territory_assignments validate constraint field_territory_assignments_territory_id_fkey;
alter table public.form_submissions            validate constraint form_submissions_lead_id_fkey;
alter table public.fs_battles                  validate constraint fs_battles_opponent_team_id_fkey;
alter table public.fs_battles                  validate constraint fs_battles_challenger_team_id_fkey;
alter table public.fs_battles                  validate constraint fs_battles_winner_team_id_fkey;
alter table public.fs_commission_entries       validate constraint fs_commission_entries_lead_id_fkey;
alter table public.fs_field_sessions           validate constraint fs_field_sessions_territory_id_fkey;
alter table public.lead_sources                validate constraint lead_sources_org_id_fkey;
alter table public.org_client_counters         validate constraint org_client_counters_org_id_fkey;
alter table public.pipeline_deals              validate constraint pipeline_deals_pin_id_fkey;
alter table public.quote_measurement_camera    validate constraint quote_measurement_camera_org_id_fkey;
alter table public.quotes                      validate constraint quotes_source_template_id_fkey;
alter table public.referrals                   validate constraint referrals_referred_org_id_fkey;
alter table public.referrals                   validate constraint referrals_referrer_org_id_fkey;

-- ── 2. updated_at qui bouge ──────────────────────────────────────
drop trigger if exists tasks_updated_at on public.tasks;
create trigger tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

drop trigger if exists client_payment_profiles_updated_at on public.client_payment_profiles;
create trigger client_payment_profiles_updated_at
  before update on public.client_payment_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists job_tags_updated_at on public.job_tags;
create trigger job_tags_updated_at
  before update on public.job_tags
  for each row execute function public.set_updated_at();

-- ── 3. current_setting() évalué une fois ─────────────────────────
drop policy if exists demo_requests_platform_admin on public.demo_requests;
create policy demo_requests_platform_admin on public.demo_requests
  for all
  using      ((select auth.uid())::text = (select current_setting('app.platform_owner_id', true)))
  with check ((select auth.uid())::text = (select current_setting('app.platform_owner_id', true)));

-- ── 4. Retirer ce que les privilèges par défaut avaient donné ────
revoke execute on function public.oauth_menage() from anon, authenticated;
revoke execute on function public.search_global_source(uuid, text) from anon, authenticated;

commit;
