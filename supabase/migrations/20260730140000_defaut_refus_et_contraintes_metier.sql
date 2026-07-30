-- ═══════════════════════════════════════════════════════════════
-- Défaut-refus complet + contraintes métier
--
-- Appliqué en production; consigné ici pour survivre à un `db reset`.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════


-- ── 1. Défaut-refus : fermeture des grants d'écriture inutilisés ──
--
-- Supabase accorde INSERT/UPDATE/DELETE à `authenticated` sur chaque
-- nouvel objet de `public`. La RLS était donc la SEULE couche de
-- protection : une policy mal écrite un jour, et la donnée sort ou
-- disparaît. Après ce correctif, une table oubliée devient inerte au lieu
-- d'être ouverte — c'est le seul changement qui réduit toutes les
-- catégories de risque à la fois.
--
-- 212 tables étaient écrivables ; le front n'en adresse que 59.
-- Les 96 fermées ici l'ont été après vérification individuelle :
-- 0 occurrence de .insert/.update/.upsert/.delete dans src/, et
-- confirmation qu'aucun nom de table n'est construit dynamiquement
-- (tous les .from() prennent un littéral, donc le scan est exhaustif).
--
-- Ne sont PAS affectés :
--   • les 48 RPC appelées par le front — SECURITY DEFINER, elles
--     s'exécutent avec les droits du propriétaire, pas de l'appelant ;
--   • les uploads Storage — chemin distinct de PostgREST ;
--   • l'API Express — service_role contourne la RLS et les grants.
--
-- La LECTURE reste ouverte partout : aucun affichage ne peut casser.
--
-- Cas qui méritaient un second regard, tous vérifiés sans écriture front :
--   payments        → encaissements via Stripe + webhook serveur ; le front
--                     ne fait que lire. Écrire ici = s'inventer des
--                     paiements reçus.
--   tax_configs     → un taux TPS/TVQ modifié fausserait toutes les
--                     factures suivantes.
--   integration_oauth_states → porte le `state` anti-CSRF du flux OAuth.
--                     Écrire ici = fabriquer un state valide et détourner
--                     le retour d'autorisation (connexion QuickBooks).
--   webhook_endpoints → rediriger un webhook exfiltre les événements.
--   messages        → lecture seule côté front (messagingApi.ts) ; les
--                     envois passent par l'API (Twilio/Resend).
--   fs_badges, fs_commission_rules → un vendeur ne s'attribue pas ses
--                     propres primes.

do $$
declare
  t text;
  cibles text[] := array[
    -- lot 1
    'automation_scheduled_tasks','confidence_calibration','demo_requests',
    'few_shot_examples','fs_badges','fs_commission_rules',
    'fs_rep_stat_snapshots','integration_oauth_states','scenario_options',
    'scenario_runs','webhook_endpoints',
    -- lot 2 (a–e)
    'a2p_registrations','activity_notes','agent_messages','alert_rules',
    'approvals','automations','billing_profiles','board_comments',
    'board_drawings','board_votes','booking_pages','bookings',
    'checklist_templates','commission_settings','communication_channels',
    'communication_messages','communication_settings','company_operating_profile',
    'contacts','course_assignments','course_lessons','course_modules',
    'course_progress','courses','email_accounts','email_campaign_recipients',
    'email_campaigns','email_messages','email_opt_outs','email_threads',
    -- lot 3 (f–n)
    'field_daily_stats','field_house_profiles','field_pin_entity_links',
    'field_pin_templates','field_pins','field_rep_performance',
    'field_sales_reps','field_sales_team_members','field_sales_teams',
    'field_schedule_slots','field_settings','field_territories',
    'field_territory_assignments','form_submissions','fs_battles',
    'fs_challenge_participants','fs_challenges','fs_check_in_records',
    'fs_commission_entries','fs_field_sessions','fs_gps_points',
    'fs_rep_badges','goals','incident_timeline','invitations','invoice_items',
    'invoice_templates','job_checklists','job_materials','job_time_logs',
    'lists','messages','mfa_phone','note_boards','note_connections',
    'note_entity_links','note_items','notes','notes_checklist','notes_files',
    'notes_tags',
    -- lot 4 (o–z)
    'org_billing_settings','org_knowledge','payment_provider_settings',
    'payment_requests','payments','payroll_adjustments','payroll_payments',
    'payroll_settings','pipelines','push_tokens','quote_attachments',
    'quote_templates','recurring_invoice_schedules','reminder_settings',
    'request_forms','review_requests','satisfaction_surveys',
    'scheduled_reports','sms_opt_outs','tags','tax_configs','tax_group_items',
    'tax_groups','team_capabilities','user_agent_preferences'
  ];
begin
  foreach t in array cibles loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
    end if;
  end loop;
end $$;

-- Empêche la réapparition : toute NOUVELLE table de public ne sera plus
-- écrivable par anon par défaut. Sans ceci, le durcissement s'érode au
-- prochain merge et une table oubliée repart ouverte au lieu d'inerte.
alter default privileges in schema public
  revoke insert, update, delete on tables from anon;


-- ── 2. Contraintes métier ─────────────────────────────────────
--
-- Une contrainte vaut mieux qu'une validation applicative : elle s'applique
-- à TOUS les chemins d'écriture (front, API, RPC, migration, correction
-- manuelle dans le dashboard), pas seulement à celui qu'on a pensé à
-- valider.
--
-- Trouvé en production avant de les ajouter : une job dont la fin précédait
-- le début de 5 jours ([ROUTE-DEMO] Tonte pelouse), corrigée avant
-- application. C'est le type d'incohérence qui fausse un calcul de durée,
-- une facturation horaire ou une optimisation de tournée sans jamais lever
-- d'erreur.
--
-- NOT VALID : s'applique aux écritures futures sans rejouer un scan complet
-- (aucun verrou long en production). Les données existantes ont été
-- vérifiées conformes juste avant ; un `validate constraint` pourra être
-- lancé plus tard à froid.
--
-- Note sur les montants : le trigger invoices_apply_status_logic applique
-- déjà `greatest(..., 0)` sur subtotal/tax/total, donc un montant négatif
-- est de toute façon ramené à zéro avant la contrainte. Celle-ci est une
-- seconde ceinture, utile si ce trigger était un jour modifié — pas une
-- lacune comblée.

alter table public.invoices
  drop constraint if exists invoices_total_non_negatif;
alter table public.invoices
  add constraint invoices_total_non_negatif
  check (total_cents >= 0) not valid;

alter table public.quotes
  drop constraint if exists quotes_total_non_negatif;
alter table public.quotes
  add constraint quotes_total_non_negatif
  check (total_cents is null or total_cents >= 0) not valid;

alter table public.jobs
  drop constraint if exists jobs_dates_coherentes;
alter table public.jobs
  add constraint jobs_dates_coherentes
  check (start_at is null or end_at is null or end_at > start_at) not valid;

alter table public.schedule_events
  drop constraint if exists schedule_events_dates_coherentes;
alter table public.schedule_events
  add constraint schedule_events_dates_coherentes
  check (start_at is null or end_at is null or end_at > start_at) not valid;
