-- ═══════════════════════════════════════════════════════════════
-- Durcissement control plane + traces d'audit — 2026-07-30
--
-- Appliqué en production via l'API Supabase; consigné ici pour survivre
-- à un `db reset` et être reproductible ailleurs. Idempotent.
--
-- Méthode : pour chaque table, la question « si un utilisateur
-- authentifié malveillant pouvait écrire une ligne arbitraire ici,
-- qu'est-ce qu'il gagne ? ». Quand la réponse est un plan gratuit, un
-- quota effacé, une trace réécrite ou une protection contournée,
-- l'écriture ne doit pas être restreinte : elle doit être impossible.
--
-- Chaque fermeture a été validée contre un scan des 106 opérations
-- d'écriture réelles du front (.insert/.update/.upsert/.delete sur
-- chaque .from() dans src/), puis vérifiée par requête croisée :
-- 0 opération bloquée après application.
-- ═══════════════════════════════════════════════════════════════


-- ── 1. Control plane : 33 tables système ──────────────────────
--
-- Ce qui était ouvert et ce que ça donnait :
--   plans, org_features, promo_codes, referrals → se donner un forfait,
--     activer des fonctionnalités payantes, fabriquer des codes promo
--   payment_provider_secrets/providers/requirements → toucher aux
--     credentials de paiement
--   invoice_sequences, quote_sequences, org_invoice_sequences → casser
--     la numérotation séquentielle exigée par Revenu Québec
--   audit_events, security_*, integration_audit_logs, login_history,
--     data_export_log → effacer ses traces après une intrusion
--   rate_limits, ip_blocklist, failed_login_attempts → désactiver les
--     protections anti-brute-force qui le visent
--   webhook_events, processed_checkout_sessions, billing_receipt_log,
--     dead_letters → rejouer un paiement, ou marquer traité ce qui ne
--     l'est pas (ces tables d'idempotence protègent l'argent)
--   api_keys, active_sessions, mfa_trusted_devices, role_templates →
--     forger une clé, prolonger une session, s'auto-approuver un appareil
--   consents, dsar_requests → falsifier un consentement Loi 25
--
-- Aucune n'est écrite depuis src/. Toutes sont alimentées par l'API
-- Express en service_role, qui contourne la RLS. Lecture inchangée : les
-- pages Sécurité, Facturation et Audit affichent toujours leurs données.

do $$
declare
  t text;
  cibles text[] := array[
    'plans','api_keys','audit_events','security_incidents','security_events',
    'security_alerts','rate_limits','ip_blocklist','failed_login_attempts',
    'login_history','payment_provider_secrets','payment_providers',
    'payment_requirements','invoice_sequences','quote_sequences',
    'org_invoice_sequences','promo_codes','referrals','webhook_events',
    'webhook_deliveries','processed_checkout_sessions','provisioning_events',
    'billing_receipt_log','org_features','dead_letters','secret_rotation_log',
    'integration_audit_logs','data_export_log','consents','dsar_requests',
    'active_sessions','mfa_trusted_devices','role_templates'
  ];
begin
  foreach t in array cibles loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
    end if;
  end loop;
end $$;


-- ── 2. Traces d'audit en append-only ──────────────────────────
--
-- Ces tables enregistrent ce qui s'est passé : qui a consulté une
-- soumission, quand un rappel est parti, comment un statut a évolué.
-- Leur valeur vient de ce qu'on ne peut pas les réécrire — une piste
-- d'audit modifiable ne prouve rien.
--
-- Append-only ne veut pas dire « interdit d'écrire » mais « interdit de
-- RÉÉCRIRE » : INSERT reste ouvert là où le front en a besoin (vérifié :
-- quote_status_history, tracking_events, workflow_logs et
-- team_schedule_audit sont alimentées depuis src/), UPDATE et DELETE
-- sont fermés partout.
--
-- Volontairement EXCLUES : schedule_events, time_entries, job_time_logs,
-- fs_commission_entries, course_progress, field_daily_stats — elles
-- ressemblent à des logs mais portent des données métier que
-- l'utilisateur doit pouvoir corriger.

do $$
declare
  t text;
  audit_only text[] := array[
    'activity_log','automation_execution_logs','decision_logs',
    'decision_outcomes','invoice_send_events','quote_send_log',
    'quote_status_history','quote_views','reminder_log','note_history',
    'team_schedule_audit','tracking_events','workflow_logs','field_house_events'
  ];
begin
  foreach t in array audit_only loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
    end if;
  end loop;
end $$;

-- Réouverture ciblée d'INSERT là où le front écrit réellement.
-- (Détecté par vérification croisée : sans ces grants, le changement de
-- statut d'une soumission et la sauvegarde d'horaire d'équipe cassaient.)
grant insert on public.quote_status_history to authenticated;
grant insert on public.tracking_events       to authenticated;
grant insert on public.workflow_logs         to authenticated;
grant insert on public.team_schedule_audit   to authenticated;


-- ── 3. DELETE retiré sur les tables non touchées par le front ──
--
-- DELETE en premier parce que c'est le seul verbe irréversible : un
-- INSERT ou UPDATE bloqué à tort se voit et se corrige, une suppression
-- est définitive. Le gain sur le risque est maximal pour un risque de
-- régression minimal — un affichage ne peut pas casser parce qu'un
-- DELETE est retiré.

do $$
declare
  r record;
  front text[] := array[
    'activity_log','applied_taxes','attachments','automation_rules','client_tags',
    'clients','company_settings','conversations','custom_column_values',
    'custom_columns','email_templates','field_daily_stats','field_pins','geofences',
    'gps_providers','invoice_items','invoice_send_events','invoice_templates',
    'invoices','job_agreements','job_billing_milestones','job_intents',
    'job_line_items','job_recurrence_rules','job_templates','jobs','lead_sources',
    'location_tracking_settings','memberships','messages','notifications',
    'org_billing_settings','orgs','payments','pipeline_deals','predefined_services',
    'profiles','proof_of_presence','properties','quote_line_items',
    'quote_measurement_camera','quote_measurements','quote_sections','quote_send_log',
    'quote_status_history','quotes','recurring_team_schedules','schedule_events',
    'service_contracts','specific_notes','tasks','tax_configs','team_assignments',
    'team_availability','team_date_slots','team_members','team_schedule_assignments',
    'team_schedule_audit','teams','technician_device_mappings','technician_locations',
    'time_entries','time_off_requests','tracking_events','tracking_live_locations',
    'tracking_points','tracking_sessions','workflow_edges','workflow_logs',
    'workflow_nodes','workflow_runs','workflows',
    'notes','notes_files','notes_tags','notes_checklist','note_items','note_boards',
    'note_connections','note_entity_links','note_history','board_comments',
    'board_drawings','board_votes','job_checklists','job_materials','job_time_logs',
    'checklist_templates','contacts','tags','lists','goals','activity_notes',
    'quote_attachments','quote_templates','quote_views','bookings','booking_pages',
    'email_campaigns','email_campaign_recipients','email_messages','email_threads',
    'email_accounts','email_opt_outs','sms_opt_outs','communication_channels',
    'communication_messages','communication_settings','field_sales_reps',
    'field_sales_teams','field_sales_team_members','field_territories',
    'field_territory_assignments','field_schedule_slots','field_settings',
    'field_pin_templates','field_pin_entity_links','field_house_events',
    'field_house_profiles','field_rep_performance','fs_field_sessions','fs_gps_points',
    'fs_check_in_records','fs_challenges','fs_challenge_participants','fs_battles',
    'fs_badges','fs_rep_badges','fs_commission_rules','fs_commission_entries',
    'courses','course_modules','course_lessons','course_assignments','course_progress',
    'pipelines','automations','automation_scheduled_tasks','alert_rules',
    'scheduled_reports','recurring_invoice_schedules','reminder_settings','reminder_log',
    'request_forms','form_submissions','review_requests','satisfaction_surveys',
    'payroll_settings','payroll_adjustments','payroll_payments','commission_settings',
    'tax_groups','tax_group_items','team_capabilities','push_tokens','mfa_phone',
    'user_agent_preferences','org_knowledge','company_operating_profile',
    'billing_profiles','payment_requests','payment_provider_settings','invitations',
    'agent_messages','approvals','scenario_runs','scenario_options','decision_logs',
    'decision_outcomes','few_shot_examples','confidence_calibration','incident_timeline',
    'a2p_registrations','automation_execution_logs'
  ];
begin
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and has_table_privilege('authenticated', c.oid, 'delete')
      and not (c.relname = any(front))
  loop
    execute format('revoke delete on public.%I from authenticated, anon', r.relname);
  end loop;
end $$;
