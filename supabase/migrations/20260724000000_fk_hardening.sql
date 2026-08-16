-- ============================================================
-- ⛔ HISTORIQUE — NE PAS REJOUER (constaté le 2026-08-07)
-- ------------------------------------------------------------
-- Ses 20 contraintes sont DÉJÀ en place : vérifié le 2026-08-07 contre le
-- catalogue de la prod, 20/20 présentes, aucune manquante (et 0 orphelin sur
-- les 19 relations au 2026-08-03). La rejouer échouerait donc en 42710
-- (duplicate_object) dès le premier `add constraint` ; le fichier entier étant
-- dans une transaction, tout serait annulé.
--
-- NB — `public.job_time_logs` (lignes 33 et 55) existe bel et bien, en prod
-- comme en staging (0 ligne). Elle figure pourtant dans les drops de
-- 20260752600000_drop_dead_tables.sql : cette migration a bien été appliquée
-- (21 de ses 23 tables ont disparu), mais job_time_logs et job_materials ont
-- été recréées après coup, des deux côtés à l'identique. Ne pas se fier à la
-- lecture d'un fichier de migration pour savoir ce qui existe : interroger le
-- catalogue.
--
-- Pour créer un environnement neuf, la source de vérité est `supabase/baseline/`
-- (`npm run db:bootstrap`), pas ce dossier — voir CLAUDE.md.
-- ============================================================
-- MIGRATION: FK hardening — add missing foreign keys on real tables
-- ------------------------------------------------------------
-- ⚠️ RUN ON STAGING FIRST. Adding FKs changes write behavior: any code path
-- that inserts a child row before its parent (or with a dangling id) will
-- start failing. Audited 2026-07-08 against prod: of 24 uuid columns missing
-- FKs on real tables, 21 have ZERO orphans today (safe), 3 need attention.
--
-- Pattern: ADD CONSTRAINT ... NOT VALID (instant, no table scan/lock pain),
-- then VALIDATE CONSTRAINT (checks existing rows without blocking writes).
-- ON DELETE left as default NO ACTION — the app soft-deletes (deleted_at),
-- so hard parent deletes should be blocked anyway. Adjust per-case if needed.
-- ============================================================

begin;

-- ── 1) Pre-fix: 6 orphaned field_house_profiles.client_id (deleted clients) ──
update public.field_house_profiles set client_id = null
where client_id is not null
  and not exists (select 1 from public.clients c where c.id = client_id);

-- ── 2) Safe FK additions (0 orphans as of audit) ──
alter table public.tracking_points          add constraint tracking_points_job_id_fkey           foreign key (job_id)     references public.jobs(id)     not valid;
alter table public.tracking_points          add constraint tracking_points_team_id_fkey          foreign key (team_id)    references public.teams(id)    not valid;
alter table public.tracking_live_locations  add constraint tracking_live_locations_job_id_fkey   foreign key (job_id)     references public.jobs(id)     not valid;
alter table public.tracking_live_locations  add constraint tracking_live_locations_team_id_fkey  foreign key (team_id)    references public.teams(id)    not valid;
alter table public.field_house_profiles     add constraint field_house_profiles_job_id_fkey      foreign key (job_id)     references public.jobs(id)     not valid;
alter table public.field_house_profiles     add constraint field_house_profiles_quote_id_fkey    foreign key (quote_id)   references public.quotes(id)   not valid;
alter table public.field_house_profiles     add constraint field_house_profiles_invoice_id_fkey  foreign key (invoice_id) references public.invoices(id) not valid;
alter table public.field_house_profiles     add constraint field_house_profiles_client_id_fkey   foreign key (client_id)  references public.clients(id)  not valid;
alter table public.memberships              add constraint memberships_team_id_fkey              foreign key (team_id)    references public.teams(id)    not valid;
alter table public.pipeline_deals           add constraint pipeline_deals_quote_id_fkey          foreign key (quote_id)   references public.quotes(id)   not valid;
alter table public.job_time_logs            add constraint job_time_logs_job_id_fkey             foreign key (job_id)     references public.jobs(id)     not valid;
alter table public.course_assignments       add constraint course_assignments_team_id_fkey       foreign key (team_id)    references public.teams(id)    not valid;
alter table public.fs_commission_entries    add constraint fs_commission_entries_job_id_fkey     foreign key (job_id)     references public.jobs(id)     not valid;
alter table public.geofences                add constraint geofences_job_id_fkey                 foreign key (job_id)     references public.jobs(id)     not valid;
alter table public.proof_of_presence        add constraint proof_of_presence_job_id_fkey         foreign key (job_id)     references public.jobs(id)     not valid;
alter table public.invitations              add constraint invitations_org_id_fkey               foreign key (org_id)     references public.orgs(id)     not valid;
alter table public.job_agreements           add constraint job_agreements_org_id_fkey            foreign key (org_id)     references public.orgs(id)     not valid;
alter table public.job_billing_milestones   add constraint job_billing_milestones_org_id_fkey    foreign key (org_id)     references public.orgs(id)     not valid;
alter table public.mfa_phone                add constraint mfa_phone_org_id_fkey                 foreign key (org_id)     references public.orgs(id)     not valid;
alter table public.service_contracts        add constraint service_contracts_org_id_fkey         foreign key (org_id)     references public.orgs(id)     not valid;

-- ── 3) Validate (checks existing rows; run after step 2 succeeds) ──
alter table public.tracking_points          validate constraint tracking_points_job_id_fkey;
alter table public.tracking_points          validate constraint tracking_points_team_id_fkey;
alter table public.tracking_live_locations  validate constraint tracking_live_locations_job_id_fkey;
alter table public.tracking_live_locations  validate constraint tracking_live_locations_team_id_fkey;
alter table public.field_house_profiles     validate constraint field_house_profiles_job_id_fkey;
alter table public.field_house_profiles     validate constraint field_house_profiles_quote_id_fkey;
alter table public.field_house_profiles     validate constraint field_house_profiles_invoice_id_fkey;
alter table public.field_house_profiles     validate constraint field_house_profiles_client_id_fkey;
alter table public.memberships              validate constraint memberships_team_id_fkey;
alter table public.pipeline_deals           validate constraint pipeline_deals_quote_id_fkey;
alter table public.job_time_logs            validate constraint job_time_logs_job_id_fkey;
alter table public.course_assignments       validate constraint course_assignments_team_id_fkey;
alter table public.fs_commission_entries    validate constraint fs_commission_entries_job_id_fkey;
alter table public.geofences                validate constraint geofences_job_id_fkey;
alter table public.proof_of_presence        validate constraint proof_of_presence_job_id_fkey;
alter table public.invitations              validate constraint invitations_org_id_fkey;
alter table public.job_agreements           validate constraint job_agreements_org_id_fkey;
alter table public.job_billing_milestones   validate constraint job_billing_milestones_org_id_fkey;
alter table public.mfa_phone                validate constraint mfa_phone_org_id_fkey;
alter table public.service_contracts        validate constraint service_contracts_org_id_fkey;

commit;

-- ============================================================
-- ⚠️ NOT INCLUDED — needs a dev decision first: the dead `leads` references
-- ------------------------------------------------------------
-- The `leads` table NO LONGER EXISTS (only lead_lists does; CLAUDE.md's
-- `leads_active` view is gone too — likely renamed to pipeline_deals).
-- Yet `lead_id` columns remain in ~7 tables, and form_submissions has 20 rows
-- with lead_id values that match NOTHING (not pipeline_deals either).
-- No code reads a `leads` table. Options for the dev:
--   (a) drop the dead lead_id columns (grep code writers first), or
--   (b) remap them to pipeline_deals(id) and add FKs.
-- Do NOT add lead_id FKs until this is resolved.
-- ============================================================
