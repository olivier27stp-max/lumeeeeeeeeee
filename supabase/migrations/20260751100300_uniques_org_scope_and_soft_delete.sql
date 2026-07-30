-- ============================================================================
-- N2.10 + N3.2 — Uniques : filtre soft-delete et scope tenant
-- ============================================================================
-- Deux defauts distincts corriges ici, apres classification manuelle de chacun
-- des 41 index uniques concernes.
--
-- A) Uniques SANS `where deleted_at is null` sur une table soft-deletable :
--    supprimer une ligne bloque a jamais la recreation de la meme valeur.
--
-- B) Uniques NON scopees au tenant : bug fonctionnel (deux orgs ne peuvent pas
--    avoir la meme valeur) ET fuite d'information par message d'erreur.
--
-- NON MODIFIES — globalement uniques par CONCEPTION (ne pas « corriger ») :
--   * Jetons et secrets, dont l'unicite globale est une propriete de securite :
--     clients.portal_token, invoices.view_token, quotes.view_token,
--     job_agreements.view_token, payment_requests.public_token,
--     request_forms.api_key, api_keys.key_hash, satisfaction_surveys.token,
--     email_oauth_states.state, integration_oauth_states.state.
--     Les scoper par org AFFAIBLIRAIT la securite (collision inter-org possible).
--   * Identifiants de fournisseurs externes, uniques chez le fournisseur :
--     connected_accounts.stripe_account_id, processed_checkout_sessions.*,
--     messages.provider_message_id, payments.provider_*.
--     Les scoper casserait l'idempotence des webhooks (N4.3).
--   * ip_blocklist : deja gere via COALESCE(org_id, uuid-zero) pour le blocage
--     global. Correct tel quel.
-- ============================================================================

set lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- A) Ajout du filtre `deleted_at is null`
-- ----------------------------------------------------------------------------

-- NOTE SUR L'ORDRE DES DROP :
-- 13 des 17 index vises sont adosses a une CONTRAINTE unique. Postgres refuse
-- `drop index` sur ceux-la (« constraint ... requires it »). Il faut donc
-- `alter table ... drop constraint` D'ABORD ; l'index disparait avec elle.
-- Le `drop index if exists` qui suit ne sert qu'aux index purs (tasks_*,
-- idx_scheduled_tasks_dedup, idx_time_entries_one_active).

-- invoices : numero de facture. Le defaut le plus grave — supprimer une facture
-- interdisait definitivement la reutilisation de son numero dans l'org.
alter table public.invoices drop constraint if exists invoices_org_number_uniq;
drop index if exists public.invoices_org_number_uniq;
create unique index if not exists invoices_org_number_uniq
  on public.invoices (org_id, invoice_number)
  where deleted_at is null;

-- tasks : identifiant public par org.
drop index if exists public.tasks_org_public_id_idx;
create unique index if not exists tasks_org_public_id_idx
  on public.tasks (org_id, public_id)
  where deleted_at is null;

-- jobs.deal_id : un job par deal. Un job supprime bloquait le deal a vie.
alter table public.jobs drop constraint if exists jobs_deal_id_key;
drop index if exists public.jobs_deal_id_key;
create unique index if not exists jobs_deal_id_uq
  on public.jobs (deal_id)
  where deal_id is not null and deleted_at is null;

-- fs_badges : slug de badge par org.
alter table public.fs_badges drop constraint if exists fs_badges_org_id_slug_key;
drop index if exists public.fs_badges_org_id_slug_key;
create unique index if not exists fs_badges_org_slug_uq
  on public.fs_badges (org_id, slug)
  where deleted_at is null;

-- connected_accounts : un compte Stripe Connect par org.
alter table public.connected_accounts drop constraint if exists connected_accounts_org_id_key;
drop index if exists public.connected_accounts_org_id_key;
create unique index if not exists connected_accounts_org_id_uq
  on public.connected_accounts (org_id)
  where deleted_at is null;

-- team_availability : (team, jour, heure). Scope tenant ajoute au passage :
-- team_id appartient deja a une org, mais l'index prefixe par org_id sert
-- aussi la RLS (N3.6).
alter table public.team_availability
  drop constraint if exists team_availability_team_id_weekday_start_minute_key;
drop index if exists public.team_availability_team_id_weekday_start_minute_key;
create unique index if not exists team_availability_org_team_slot_uq
  on public.team_availability (org_id, team_id, weekday, start_minute)
  where deleted_at is null;

-- ----------------------------------------------------------------------------
-- B) Scope tenant sur les identifiants metier
-- ----------------------------------------------------------------------------

-- booking_pages.slug : un slug de page de reservation appartient a une org.
-- Sans org_id, la premiere org qui prend « reservation » le bloque pour toutes.
alter table public.booking_pages drop constraint if exists booking_pages_slug_key;
drop index if exists public.booking_pages_slug_key;
create unique index if not exists booking_pages_org_slug_uq
  on public.booking_pages (org_id, slug);

-- email_accounts : (user, provider, adresse) -> ajout de org_id. Un meme
-- utilisateur peut etre membre de deux orgs et y connecter la meme boite.
alter table public.email_accounts
  drop constraint if exists email_accounts_user_id_provider_email_address_key;
drop index if exists public.email_accounts_user_id_provider_email_address_key;
create unique index if not exists email_accounts_org_user_provider_email_uq
  on public.email_accounts (org_id, user_id, provider, email_address);

-- email_threads : (compte, thread fournisseur) -> ajout de org_id.
alter table public.email_threads
  drop constraint if exists email_threads_account_id_provider_thread_id_key;
drop index if exists public.email_threads_account_id_provider_thread_id_key;
create unique index if not exists email_threads_org_account_thread_uq
  on public.email_threads (org_id, account_id, provider_thread_id);

-- fs_rep_stat_snapshots : (user, periode) -> ajout de org_id. Un representant
-- actif dans deux orgs avait ses statistiques en collision.
alter table public.fs_rep_stat_snapshots
  drop constraint if exists fs_rep_stat_snapshots_user_id_period_period_start_key;
drop index if exists public.fs_rep_stat_snapshots_user_id_period_period_start_key;
create unique index if not exists fs_rep_stat_snapshots_org_user_period_uq
  on public.fs_rep_stat_snapshots (org_id, user_id, period, period_start);

-- push_tokens : (user, token) -> ajout de org_id.
alter table public.push_tokens drop constraint if exists push_tokens_user_id_token_key;
drop index if exists public.push_tokens_user_id_token_key;
create unique index if not exists push_tokens_org_user_token_uq
  on public.push_tokens (org_id, user_id, token);

-- reminder_log : (facture, jours, canal) -> ajout de org_id.
alter table public.reminder_log
  drop constraint if exists reminder_log_invoice_id_days_after_due_channel_key;
drop index if exists public.reminder_log_invoice_id_days_after_due_channel_key;
create unique index if not exists reminder_log_org_invoice_day_channel_uq
  on public.reminder_log (org_id, invoice_id, days_after_due, channel);

-- team_date_slots / team_schedule_assignments : anti-doublon d'horaire.
alter table public.team_date_slots drop constraint if exists no_exact_duplicate;
drop index if exists public.no_exact_duplicate;
create unique index if not exists team_date_slots_org_team_slot_uq
  on public.team_date_slots (org_id, team_id, slot_date, start_time, end_time);

alter table public.team_schedule_assignments drop constraint if exists tsa_no_exact_duplicate;
drop index if exists public.tsa_no_exact_duplicate;
create unique index if not exists tsa_org_team_user_date_start_uq
  on public.team_schedule_assignments (org_id, team_id, user_id, work_date, start_time);

-- automation_scheduled_tasks : cle de deduplication -> ajout de org_id.
drop index if exists public.idx_scheduled_tasks_dedup;
create unique index if not exists idx_scheduled_tasks_dedup
  on public.automation_scheduled_tasks (org_id, execution_key)
  where status = any (array['pending'::text, 'running'::text]);

-- time_entries : un seul pointage actif par employe -> ajout de org_id.
drop index if exists public.idx_time_entries_one_active;
create unique index if not exists idx_time_entries_one_active
  on public.time_entries (org_id, employee_id)
  where status = 'active'::text;

-- ----------------------------------------------------------------------------
-- Verification
-- ----------------------------------------------------------------------------
do $$
declare
  v int;
begin
  select count(*) into v
    from pg_index i
    join pg_class ix on ix.oid = i.indexrelid
   where i.indisunique and not i.indisprimary and i.indpred is null
     and (select relnamespace from pg_class where oid = i.indrelid) = 'public'::regnamespace
     and exists (select 1 from pg_attribute a
                  where a.attrelid = i.indrelid and a.attname = 'deleted_at' and not a.attisdropped)
     and ix.relname in (
       'invoices_org_number_uniq','tasks_org_public_id_idx','fs_badges_org_slug_uq',
       'connected_accounts_org_id_uq','team_availability_org_team_slot_uq','jobs_deal_id_uq');

  if v > 0 then
    raise exception 'Uniques soft-delete : % index encore sans filtre.', v;
  end if;
end $$;
