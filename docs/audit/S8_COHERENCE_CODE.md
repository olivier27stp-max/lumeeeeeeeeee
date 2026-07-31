# S8 — Cohérence code ↔ base

**Date** : 2026-07-31
**Périmètre** : `src/` (SPA Vite+React) et `server/` (Express). `mobile/` exclu (branche séparée, non déployée).
**Méthode** : lecture seule. Aucun accès à la base — ce document est l'**inventaire côté code**, destiné à être croisé avec le catalogue SQL (`S2_CATALOGUE.md` / `S7_CATALOGUE_COMPLET.md`).

> ⚠️ **Écart de contexte à signaler** : la mission désignait la branche `audit/db`. Le dépôt est en réalité sur **`fix/audit-p0`**, HEAD `d2d5ca0` (« docs: manuel de maintien de la base de donnees »). Tous les numéros de ligne ci-dessous se rapportent à cet état.

---

## 0. Honnêteté de couverture

| Élément | Inspecté | Total | Méthode |
|---|---:|---:|---|
| Fichiers `src/**/*.ts(x)` | 498 | 498 | analyse scriptée (AST-lite par regex) sur 100 % ; ~15 fichiers relus manuellement |
| Fichiers `server/**/*.ts` | 164 | 164 | idem |
| Fichiers de routes `server/routes/` | 69 | 69 | 61 (ceux utilisant `getServiceClient()`) audités handler-par-handler ; 8 restants n'appellent jamais `getServiceClient()` donc hors périmètre §2 |
| Handlers de route lus intégralement | ≥ 339 | 452 déclarés | somme déclarée par les 4 passes : 139 + 120 + (15 fichiers, total non chiffré) + 80. Les 3 constats les plus graves ont été **revérifiés personnellement** ligne à ligne |
| Migrations SQL | ~3 consultées ponctuellement | 300+ | **non audité** — hors périmètre (c'est le rôle du catalogue) |

**Ce que ce document ne peut pas affirmer** : qu'un objet listé ici existe réellement en base, ni qu'il a les bons `GRANT`. C'est précisément l'objet du croisement.

**Limites méthodologiques connues** :
- L'extraction de colonnes suit la chaîne `.from('x')…` jusqu'au prochain `.from(`. Sur les fichiers où deux requêtes se suivent sans séparateur clair, une colonne peut être attribuée à la mauvaise table. Signalé en §3.2 quand c'est le cas.
- Les tables atteintes uniquement via une fonction RPC (jamais via `.from()`) n'apparaissent pas dans §1.1.
- Le rapprochement « endpoint serveur ↔ appel client » a été **abandonné** : le front passe par un helper sans préfixe `/api/`, ce qui produisait ~60 % de faux positifs. Seuls les routers **non montés** (vérifiés directement) sont rapportés.

---

## 1. Inventaire des objets base référencés par le code

### 1.1 Tables et vues (`.from('X')`)

**78 objets distincts dans `src/`**, **159 dans `server/`**.

#### `src/` (SPA — client Supabase, RLS active)

| Table / vue | fichiers | réfs | accès | 1er site |
|---|---:|---:|---|---|
| `activity_log` | 1 | 2 | lecture seule | `src/lib/activityApi.ts:64` |
| `applied_taxes` | 2 | 3 | R/W · delete+insert | `src/lib/invoicesApi.ts:897` |
| `attachments` | 4 | 7 | lecture seule | `src/components/OnboardingWizard.tsx:72` |
| `automation_rules` | 1 | 4 | R/W · update | `src/lib/automationRulesApi.ts:35` |
| `avatars` | 2 | 6 | lecture seule | `src/pages/D2DOnboarding.tsx:86` |
| `client_tags` | 2 | 4 | R/W · delete+insert | `src/pages/ClientDetails.tsx:344` |
| `clients` | 18 | 43 | R/W · update | `src/components/ActivityCenter.tsx:375` |
| `company_settings` | 11 | 15 | R/W · update+upsert | `src/contexts/CompanyContext.tsx:105` |
| `conversations` | 2 | 3 | R/W · update | `src/App.tsx:302` |
| `custom_column_values` | 1 | 4 | R/W · delete+upsert | `src/lib/customFieldsApi.ts:173` |
| `custom_columns` | 1 | 6 | R/W · insert+update | `src/lib/customFieldsApi.ts:76` |
| `email_templates` | 1 | 9 | R/W · delete+insert+update | `src/lib/emailTemplatesApi.ts:27` |
| `field_daily_stats` | 1 | 1 | lecture seule | `src/pages/D2DDashboard.tsx:458` |
| `field_pins` | 2 | 2 | lecture seule | `src/lib/repStatsApi.ts:222` |
| `geofences` | 1 | 3 | R/W · insert+update | `src/lib/locationApi.ts:460` |
| `gps_providers` | 1 | 5 | R/W · update+upsert | `src/lib/locationApi.ts:125` |
| `invoice_items` | 1 | 1 | lecture seule | `src/lib/invoicesApi.ts:499` |
| `invoice_send_events` | 1 | 1 | lecture seule | `src/lib/invoicesApi.ts:862` |
| `invoice_templates` | 1 | 2 | lecture seule | `src/lib/invoicesApi.ts:840` |
| `invoices` | 13 | 27 | R/W · update | `src/components/CreateInvoiceModal.tsx:336` |
| `job_agreements` | 1 | 3 | R/W · insert+update | `src/lib/jobAgreementsApi.ts:136` |
| `job_billing_milestones` | 1 | 4 | R/W · delete+insert+update | `src/lib/jobBillingApi.ts:42` |
| `job_intents` | 1 | 3 | R/W · update | `src/lib/pipelineApi.ts:599` |
| `job_line_items` | 3 | 6 | R/W · delete+insert | `src/lib/quotesApi.ts:971` |
| `job_recurrence_rules` | 2 | 5 | R/W · insert+update | `src/lib/recurringJobsApi.ts:101` |
| `job_templates` | 1 | 3 | R/W · delete+insert | `src/lib/recurringJobsApi.ts:45` |
| `jobs` | 29 | 57 | R/W · update | `src/components/HomeServiceMixCard.tsx:23` |
| `jobs_active` | 3 | 14 | lecture seule | `src/lib/dashboardApi.ts:149` |
| `lead_sources` | 1 | 2 | R/W · upsert | `src/lib/leadSourcesApi.ts:29` |
| `location_tracking_settings` | 1 | 2 | R/W · upsert | `src/lib/locationConsentApi.ts:11` |
| `memberships` | 10 | 16 | R/W · insert+update | `src/App.tsx:293` |
| `messages` | 1 | 1 | lecture seule | `src/lib/messagingApi.ts:73` |
| `notifications` | 2 | 6 | R/W · update | `src/components/ActivityCenter.tsx:339` |
| `org_billing_settings` | 3 | 3 | lecture seule | `src/contexts/CompanyContext.tsx:121` |
| `orgs` | 4 | 4 | R/W · insert+update | `src/App.tsx:446` |
| `payment_provider_secrets` | 2 | 2 | lecture seule | `src/lib/stripeClient.ts:26` |
| `payments` | 3 | 3 | lecture seule | `src/components/insights/PaymentMethodMixCard.tsx:27` |
| `pipeline_deals` | 6 | 11 | R/W · update | `src/lib/leadsApi.ts:263` |
| `pipeline_deals_visible` | 1 | 2 | lecture seule | `src/lib/pipelineApi.ts:275` |
| `predefined_services` | 1 | 4 | R/W · insert+update | `src/lib/servicesApi.ts:23` |
| `profiles` | 15 | 20 | R/W · update+upsert | `src/App.tsx:464` |
| `proof_of_presence` | 1 | 2 | R/W · insert | `src/lib/locationApi.ts:515` |
| `properties` | 1 | 5 | R/W · insert+update | `src/lib/propertiesApi.ts:52` |
| `quote_line_items` | 1 | 5 | R/W · delete+insert | `src/lib/quotesApi.ts:325` |
| `quote_measurement_camera` | 1 | 2 | R/W · upsert | `src/lib/measurementApi.ts:27` |
| `quote_measurements` | 1 | 5 | R/W · delete+insert+update | `src/lib/measurementApi.ts:58` |
| `quote_sections` | 2 | 5 | R/W · insert+update | `src/lib/quotesApi.ts:340` |
| `quote_send_log` | 1 | 1 | lecture seule | `src/lib/quotesApi.ts:376` |
| `quote_status_history` | 1 | 4 | R/W · insert | `src/lib/quotesApi.ts:377` |
| `quotes` | 9 | 27 | R/W · update | `src/components/insights/QuoteConversionCard.tsx:13` |
| `recurring_team_schedules` | 1 | 6 | R/W · delete+insert+update | `src/lib/teamScheduleApi.ts:220` |
| `schedule_events` | 12 | 20 | R/W · update | `src/components/NewJobModal.tsx:1564` |
| `service_contracts` | 1 | 2 | R/W · insert | `src/lib/serviceContractsApi.ts:100` |
| `specific_notes` | 1 | 6 | R/W · delete+insert+update | `src/lib/specificNotesApi.ts:50` |
| `tasks` | 1 | 8 | R/W · insert+update | `src/lib/tasksApi.ts:96` |
| `tasks_active` | 2 | 2 | lecture seule | `src/components/HomeTasksCard.tsx:30` |
| `tax_configs` | 2 | 2 | lecture seule | `src/lib/jobAgreementsApi.ts:227` |
| `team_assignments` | 1 | 2 | R/W · delete | `src/lib/teamsApi.ts:131` |
| `team_availability` | 1 | 5 | R/W · insert+update | `src/lib/availabilityApi.ts:59` |
| `team_availability_active` | 2 | 2 | lecture seule | `src/lib/teamScheduleApi.ts:196` |
| `team_date_slots` | 2 | 10 | R/W · delete+insert+update | `src/lib/teamScheduleApi.ts:201` |
| `team_members` | 6 | 15 | R/W · insert+update | `src/components/TeamProfilesGrid.tsx:42` |
| `team_schedule_assignments` | 1 | 6 | R/W · delete+insert+update | `src/lib/teamScheduleApi.ts:214` |
| `team_schedule_audit` | 1 | 1 | R/W · insert | `src/lib/teamScheduleApi.ts:492` |
| `teams` | 7 | 11 | R/W · insert+update | `src/components/timesheets/TeamScheduleGrid.tsx:178` |
| `technician_device_mappings` | 1 | 4 | R/W · delete+upsert | `src/lib/locationApi.ts:350` |
| `technician_locations` | 1 | 4 | R/W · insert | `src/lib/locationApi.ts:295` |
| `time_entries` | 7 | 17 | R/W · delete+update | `src/components/TeamProfilesGrid.tsx:86` |
| `time_off_requests` | 1 | 4 | R/W · delete+insert+update | `src/lib/teamScheduleApi.ts:227` |
| `tracking_events` | 1 | 2 | R/W · insert | `src/lib/trackingApi.ts:304` |
| `tracking_live_locations` | 1 | 3 | R/W · update+upsert | `src/lib/trackingApi.ts:195` |
| `tracking_points` | 1 | 3 | R/W · insert | `src/lib/trackingApi.ts:220` |
| `tracking_sessions` | 1 | 5 | R/W · insert+update | `src/lib/trackingApi.ts:119` |
| `workflow_edges` | 1 | 4 | R/W · delete+insert | `src/lib/workflowApi.ts:238` |
| `workflow_logs` | 1 | 2 | R/W · insert | `src/lib/workflowApi.ts:321` |
| `workflow_nodes` | 1 | 5 | R/W · delete+insert+update | `src/lib/workflowApi.ts:216` |
| `workflow_runs` | 1 | 4 | R/W · insert+update | `src/lib/workflowApi.ts:310` |
| `workflows` | 1 | 5 | R/W · delete+insert+update | `src/lib/workflowApi.ts:139` |

#### `server/` (Express — mélange client RLS + service_role)

| Table / vue | fichiers | réfs | accès | 1er site |
|---|---:|---:|---|---|
| `a2p_registrations` | 2 | 8 | R/W · update+upsert | `server/lib/twilioA2P.ts:55` |
| `active_sessions` | 1 | 1 | lecture seule | `server/routes/security.ts:415` |
| `activity_log` | 4 | 5 | R/W · insert | `server/lib/eventBus.ts:96` |
| `activity_notes` | 1 | 4 | R/W · insert+update | `server/routes/activity-notes.ts:30` |
| `agent_messages` | 1 | 1 | R/W · insert | `server/routes/agent-auth.ts:131` |
| `alert_rules` | 1 | 1 | lecture seule | `server/lib/alerts-engine.ts:29` |
| `api_keys` | 2 | 6 | R/W · insert+update | `server/lib/api-keys.ts:33` |
| `app_connections` | 1 | 16 | R/W · update+upsert | `server/lib/integrations/service.ts:83` |
| `audit_events` | 4 | 6 | R/W · insert | `server/lib/security.ts:499` |
| `automation_execution_logs` | 2 | 4 | R/W · insert | `server/lib/automationEngine.ts:153` |
| `automation_rules` | 2 | 3 | lecture seule | `server/lib/automationEngine.ts:297` |
| `automation_scheduled_tasks` | 2 | 9 | R/W · insert+update | `server/lib/automationEngine.ts:129` |
| `automations` | 1 | 1 | lecture seule | `server/lib/scheduler.ts:520` |
| `billing_profiles` | 4 | 11 | R/W · upsert | `server/lib/referral-rewards.ts:116` |
| `billing_receipt_log` | 3 | 5 | R/W · delete+insert | `server/scripts/arm-setup-test.ts:21` |
| `booking_pages` | 1 | 8 | R/W · insert+update | `server/routes/booking.ts:149` |
| `bookings` | 1 | 6 | R/W · insert+update | `server/routes/booking.ts:205` |
| `checklist_templates` | 1 | 5 | R/W · insert+update | `server/routes/checklists.ts:51` |
| `client_tags` | 1 | 1 | R/W · delete | `server/routes/leads.ts:343` |
| `clients` | 33 | 89 | R/W · insert+update | `server/lib/helpers.ts:421` |
| `clients_active` | 1 | 2 | lecture seule | `server/routes/campaigns.ts:85` |
| `commission_settings` | 2 | 5 | R/W · upsert | `server/lib/field-sales/commission-engine.ts:173` |
| `communication_channels` | 7 | 15 | R/W · update | `server/scripts/repair-twilio-webhooks.ts:43` |
| `communication_messages` | 1 | 3 | R/W · insert | `server/routes/communications.ts:106` |
| `communication_settings` | 1 | 1 | lecture seule | `server/routes/communications.ts:290` |
| `company_operating_profile` | 3 | 4 | R/W · upsert | `server/lib/field-sales/scoring-engine.ts:446` |
| `company_settings` | 22 | 34 | R/W · insert+update+upsert | `server/lib/twilioProvisioning.ts:175` |
| `connected_accounts` | 2 | 4 | R/W · insert+update | `server/lib/stripe-connect.ts:22` |
| `conversations` | 2 | 6 | R/W · insert+update | `server/lib/helpers.ts:409` |
| `course_assignments` | 1 | 6 | R/W · delete+upsert | `server/routes/courses.ts:190` |
| `course_lessons` | 1 | 16 | R/W · delete+insert+update | `server/routes/courses.ts:271` |
| `course_modules` | 1 | 14 | R/W · delete+insert+update | `server/routes/courses.ts:265` |
| `course_progress` | 1 | 5 | R/W · upsert | `server/routes/courses.ts:351` |
| `courses` | 1 | 19 | R/W · insert+update | `server/routes/courses.ts:19` |
| `data_export_log` | 2 | 2 | R/W · insert | `server/lib/data-export-log.ts:51` |
| `dead_letters` | 1 | 1 | R/W · insert | `server/lib/dead-letter.ts:24` |
| `dsar_requests` | 1 | 1 | R/W · insert | `server/routes/dsr.ts:196` |
| `email_accounts` | 4 | 12 | R/W · update+upsert | `server/lib/email/accountService.ts:128` |
| `email_campaign_recipients` | 1 | 4 | R/W · insert+update | `server/routes/campaigns.ts:302` |
| `email_campaigns` | 2 | 16 | R/W · delete+insert+update | `server/routes/campaigns.ts:162` |
| `email_messages` | 3 | 5 | R/W · insert+upsert | `server/lib/email/sync/gmail.ts:191` |
| `email_oauth_states` | 1 | 3 | R/W · insert+update | `server/lib/email/accountService.ts:63` |
| `email_opt_outs` | 1 | 2 | lecture seule | `server/routes/campaigns.ts:121` |
| `email_templates` | 3 | 14 | R/W · delete+insert+update | `server/lib/actions/index.ts:479` |
| `email_threads` | 3 | 7 | R/W · update+upsert | `server/lib/email/sync/gmail.ts:170` |
| `field_daily_stats` | 3 | 8 | R/W · insert+update | `server/lib/field-sales/scoring-engine.ts:413` |
| `field_house_events` | 6 | 17 | R/W · delete+insert | `server/lib/fieldPinSync.ts:249` |
| `field_house_profiles` | 7 | 34 | R/W · insert+update | `server/lib/fieldPinSync.ts:95` |
| `field_pin_entity_links` | 4 | 5 | R/W · upsert | `server/lib/fieldPinSync.ts:258` |
| `field_pins` | 4 | 18 | R/W · delete+insert+update | `server/lib/fieldPinSync.ts:225` |
| `field_sales_reps` | 2 | 5 | R/W · insert+update | `server/lib/field-sales/territory-assignment-engine.ts:57` |
| `field_sales_team_members` | 1 | 1 | R/W · insert | `server/routes/field-sales.ts:1368` |
| `field_sales_teams` | 1 | 2 | R/W · insert | `server/routes/field-sales.ts:1346` |
| `field_settings` | 1 | 2 | R/W · upsert | `server/routes/field-sales.ts:1113` |
| `field_territories` | 5 | 12 | R/W · insert+update | `server/lib/field-sales/daily-plan-engine.ts:67` |
| `field_territory_assignments` | 1 | 1 | lecture seule | `server/lib/field-sales/territory-assignment-engine.ts:75` |
| `form_submissions` | 2 | 6 | R/W · insert+update | `server/routes/search.ts:82` |
| `fs_badges` | 1 | 3 | R/W · insert | `server/lib/field-sales/gamification-engine.ts:295` |
| `fs_battles` | 1 | 4 | R/W · insert+update | `server/lib/field-sales/gamification-engine.ts:193` |
| `fs_challenge_participants` | 1 | 5 | R/W · insert+update | `server/lib/field-sales/gamification-engine.ts:50` |
| `fs_challenges` | 1 | 5 | R/W · insert+update | `server/lib/field-sales/gamification-engine.ts:20` |
| `fs_check_in_records` | 1 | 2 | R/W · insert | `server/lib/field-sales/session-engine.ts:54` |
| `fs_commission_entries` | 2 | 19 | R/W · insert+update | `server/lib/field-sales/commission-engine.ts:159` |
| `fs_commission_rules` | 2 | 10 | R/W · insert+update | `server/lib/field-sales/commission-engine.ts:168` |
| `fs_field_sessions` | 1 | 11 | R/W · insert+update | `server/lib/field-sales/session-engine.ts:29` |
| `fs_gps_points` | 1 | 2 | R/W · insert | `server/lib/field-sales/session-engine.ts:185` |
| `fs_rep_badges` | 1 | 3 | R/W · insert | `server/lib/field-sales/gamification-engine.ts:302` |
| `fs_rep_stat_snapshots` | 1 | 1 | R/W · upsert | `server/lib/field-sales/leaderboard-engine.ts:358` |
| `goals` | 1 | 4 | R/W · delete+insert | `server/routes/goals.ts:15` |
| `incident_timeline` | 1 | 3 | R/W · insert | `server/routes/incidents.ts:95` |
| `integration_audit_logs` | 1 | 1 | R/W · insert | `server/lib/integrations/service.ts:61` |
| `integration_oauth_states` | 1 | 3 | R/W · insert+update | `server/lib/integrations/service.ts:132` |
| `invitations` | 2 | 16 | R/W · insert+update | `server/routes/invitations.ts:69` |
| `invoice_items` | 4 | 5 | R/W · insert | `server/lib/scheduler.ts:298` |
| `invoice_send_events` | 1 | 1 | R/W · insert | `server/routes/emails.ts:285` |
| `invoices` | 21 | 42 | R/W · insert+update | `server/lib/scheduler.ts:60` |
| `ip_blocklist` | 2 | 6 | R/W · delete+upsert | `server/lib/security.ts:147` |
| `job_agreements` | 3 | 9 | R/W · update | `server/routes/search.ts:97` |
| `job_checklists` | 1 | 4 | R/W · delete+insert+update | `server/routes/checklists.ts:181` |
| `job_line_items` | 2 | 2 | R/W · insert | `server/routes/quotes.ts:625` |
| `job_recurrence_rules` | 1 | 4 | R/W · update | `server/lib/recurringJobScheduler.ts:34` |
| `jobs` | 21 | 44 | R/W · insert+update | `server/lib/scheduler.ts:202` |
| `jobs_active` | 1 | 2 | lecture seule | `server/lib/agent/tools.ts:160` |
| `location_tracking_settings` | 1 | 1 | lecture seule | `server/lib/location-consent.ts:39` |
| `login_history` | 3 | 7 | R/W · insert | `server/lib/security.ts:646` |
| `memberships` | 25 | 72 | R/W · delete+insert+update | `server/lib/alerts-engine.ts:126` |
| `messages` | 3 | 6 | R/W · insert+update+upsert | `server/lib/actions/index.ts:270` |
| `mfa_phone` | 2 | 3 | R/W · update+upsert | `server/lib/mfa-sms.ts:43` |
| `mfa_sms_challenges` | 1 | 5 | R/W · insert+update | `server/lib/mfa-sms.ts:91` |
| `mfa_trusted_devices` | 1 | 3 | R/W · insert+update | `server/lib/mfa-sms.ts:55` |
| `notifications` | 10 | 21 | R/W · insert+update | `server/lib/alerts-engine.ts:195` |
| `org_billing_settings` | 2 | 2 | lecture seule | `server/routes/leaderboard.ts:215` |
| `org_features` | 1 | 2 | R/W · upsert | `server/routes/feature-flags.ts:15` |
| `org_knowledge` | 1 | 4 | R/W · update+upsert | `server/routes/org-knowledge.ts:19` |
| `orgs` | 13 | 31 | R/W · delete+insert+update | `server/scripts/test-twilio-provisioning.ts:46` |
| `payment_provider_secrets` | 2 | 6 | R/W · upsert | `server/lib/payments.ts:139` |
| `payment_provider_settings` | 3 | 8 | R/W · update+upsert | `server/lib/payments.ts:102` |
| `payment_providers` | 1 | 1 | lecture seule | `server/lib/payments.ts:1009` |
| `payment_requests` | 3 | 8 | R/W · insert+update | `server/lib/stripe-connect.ts:256` |
| `payment_requirements` | 2 | 6 | R/W · insert+update | `server/routes/quotes.ts:896` |
| `payments` | 5 | 13 | R/W · insert+update | `server/lib/payments.ts:807` |
| `payroll_adjustments` | 1 | 3 | R/W · insert+update | `server/routes/payroll.ts:175` |
| `payroll_payments` | 1 | 4 | R/W · delete+upsert | `server/routes/payroll.ts:185` |
| `payroll_settings` | 1 | 2 | R/W · upsert | `server/routes/payroll.ts:21` |
| `pipeline_deals` | 7 | 24 | R/W · insert+update | `server/lib/helpers.ts:270` |
| `plans` | 8 | 23 | R/W · update | `server/lib/twilioProvisioning.ts:142` |
| `predefined_services` | 2 | 3 | R/W · insert | `server/lib/industryPresets.ts:203` |
| `processed_checkout_sessions` | 3 | 6 | R/W · delete+insert | `server/scripts/arm-setup-test.ts:18` |
| `profiles` | 9 | 17 | R/W · update+upsert | `server/lib/location-consent.ts:40` |
| `promo_codes` | 1 | 3 | R/W · update | `server/routes/billing.ts:212` |
| `properties` | 1 | 1 | lecture seule | `server/routes/search.ts:89` |
| `provisioning_events` | 2 | 4 | R/W · insert+update | `server/routes/onboarding.ts:188` |
| `push_tokens` | 1 | 1 | lecture seule | `server/lib/pushNotifications.ts:30` |
| `quote_attachments` | 1 | 3 | R/W · insert | `server/routes/quotes.ts:790` |
| `quote_line_items` | 1 | 3 | lecture seule | `server/routes/quotes.ts:610` |
| `quote_sections` | 1 | 1 | lecture seule | `server/routes/quotes.ts:774` |
| `quote_send_log` | 1 | 2 | R/W · insert | `server/routes/quotes.ts:356` |
| `quote_status_history` | 2 | 9 | R/W · insert | `server/lib/scheduler.ts:455` |
| `quote_templates` | 1 | 16 | R/W · insert+update | `server/routes/quote-templates.ts:16` |
| `quote_views` | 1 | 2 | R/W · insert | `server/routes/quotes.ts:118` |
| `quotes` | 15 | 39 | R/W · update | `server/lib/scheduler.ts:432` |
| `recurring_invoice_schedules` | 2 | 7 | R/W · insert+update | `server/lib/recurringInvoicesEngine.ts:143` |
| `recurring_team_schedules` | 1 | 1 | lecture seule | `server/routes/team-suggestions.ts:118` |
| `referrals` | 3 | 15 | R/W · insert+update | `server/lib/referral-rewards.ts:42` |
| `reminder_log` | 2 | 6 | R/W · insert | `server/routes/reminders-cron.ts:161` |
| `reminder_settings` | 2 | 4 | R/W · insert+update | `server/routes/reminders-cron.ts:112` |
| `request_forms` | 1 | 9 | R/W · insert+update | `server/routes/request-forms.ts:20` |
| `review_requests` | 2 | 4 | R/W · insert+update | `server/lib/actions/index.ts:426` |
| `role_templates` | 2 | 4 | R/W · upsert | `server/routes/invitations.ts:48` |
| `satisfaction_surveys` | 2 | 4 | R/W · insert+update | `server/lib/actions/index.ts:444` |
| `schedule_events` | 11 | 13 | R/W · insert+update | `server/lib/scheduler.ts:98` |
| `scheduled_reports` | 2 | 8 | R/W · delete+insert+update | `server/lib/scheduled-reports.ts:135` |
| `security_alerts` | 2 | 4 | R/W · insert+update | `server/lib/security.ts:614` |
| `security_events` | 2 | 4 | R/W · insert | `server/lib/security.ts:474` |
| `security_incidents` | 1 | 5 | R/W · update | `server/routes/incidents.ts:66` |
| `service_contracts` | 2 | 3 | R/W · insert | `server/routes/quotes.ts:593` |
| `sms_opt_outs` | 2 | 4 | R/W · delete+upsert | `server/lib/actions/index.ts:229` |
| `subscriptions` | 11 | 64 | R/W · delete+insert+update | `server/scripts/arm-setup-test.ts:20` |
| `tasks` | 2 | 2 | R/W · insert | `server/lib/actions/index.ts:335` |
| `tax_configs` | 3 | 7 | R/W · delete+insert+update | `server/routes/taxes.ts:104` |
| `tax_group_items` | 1 | 6 | R/W · delete+insert | `server/routes/taxes.ts:106` |
| `tax_groups` | 1 | 13 | R/W · delete+insert+update | `server/routes/taxes.ts:105` |
| `team_availability` | 1 | 1 | lecture seule | `server/routes/team-suggestions.ts:89` |
| `team_capabilities` | 1 | 1 | lecture seule | `server/routes/team-suggestions.ts:187` |
| `team_date_slots` | 1 | 1 | lecture seule | `server/routes/team-suggestions.ts:97` |
| `team_members` | 3 | 4 | lecture seule | `server/routes/team-compliance.ts:33` |
| `team_schedule_assignments` | 1 | 1 | lecture seule | `server/routes/team-suggestions.ts:113` |
| `teams` | 2 | 2 | lecture seule | `server/routes/jobs.ts:30` |
| `time_entries` | 2 | 10 | R/W · insert+update | `server/routes/timesheets.ts:38` |
| `time_off_requests` | 1 | 1 | lecture seule | `server/routes/team-suggestions.ts:126` |
| `tracking_events` | 1 | 3 | R/W · insert | `server/routes/tracking.ts:86` |
| `tracking_live_locations` | 1 | 3 | R/W · update+upsert | `server/routes/tracking.ts:128` |
| `tracking_points` | 1 | 2 | R/W · insert | `server/routes/tracking.ts:163` |
| `tracking_sessions` | 2 | 10 | R/W · insert+update | `server/routes/tracking.ts:65` |
| `users` | 1 | 1 | lecture seule | `server/lib/supabase.ts:60` |
| `webhook_deliveries` | 2 | 10 | R/W · insert+update | `server/lib/webhookDispatcher.ts:106` |
| `webhook_endpoints` | 2 | 11 | R/W · insert+update | `server/lib/webhookDispatcher.ts:72` |
| `webhook_events` | 2 | 4 | R/W · insert+update | `server/lib/stripe-connect.ts:203` |
| `workflows` | 1 | 1 | lecture seule | `server/lib/automationEngine.ts:322` |

### 1.2 Fonctions (`.rpc('X')`)

**47 fonctions distinctes dans `src/`**, **47 dans `server/`** (recouvrement partiel).

Point structurant : **la totalité des 47 RPC appelées depuis `src/` passe par le client utilisateur** (`supabase.rpc`) — donc soumis à `GRANT EXECUTE ... TO authenticated` et à la RLS des tables sous-jacentes. C'est exactement le mode de panne décrit dans l'énoncé (droit retiré → appel front mort). Côté `server/`, la répartition est mixte.

#### `src/`

| Fonction | fichiers | client | sites |
|---|---:|---|---|
| `batch_soft_delete_clients` | 1 | utilisateur (RLS) | `src/pages/Clients.tsx:141` |
| `create_client_with_duplicate_handling` | 1 | utilisateur (RLS) | `src/lib/clientsApi.ts:213` |
| `create_job_from_intent` | 1 | utilisateur (RLS) | `src/lib/pipelineApi.ts:681` |
| `create_pipeline_deal` | 1 | utilisateur (RLS) | `src/lib/pipelineApi.ts:332` |
| `current_org_id` | 3 | utilisateur (RLS) | `src/hooks/useGpsTracking.ts:64` · `src/lib/orgApi.ts:22` · `src/pages/Clients.tsx:139` |
| `delete_client_cascade` | 1 | utilisateur (RLS) | `src/lib/archiveApi.ts:76` |
| `delete_invoice_cascade` | 1 | utilisateur (RLS) | `src/lib/invoicesApi.ts:967` |
| `delete_job_cascade` | 1 | utilisateur (RLS) | `src/lib/archiveApi.ts:83` |
| `delete_lead_and_optional_client` | 1 | utilisateur (RLS) | `src/lib/pipelineApi.ts:565` |
| `delete_lead_cascade` | 1 | utilisateur (RLS) | `src/lib/archiveApi.ts:89` |
| `delete_quote_cascade` | 1 | utilisateur (RLS) | `src/lib/quotesApi.ts:603` |
| `finish_job_and_prepare_invoice` | 1 | utilisateur (RLS) | `src/lib/invoicesApi.ts:599` |
| `get_available_slots` | 1 | utilisateur (RLS) | `src/lib/pipelineApi.ts:508` |
| `list_archived_items` | 1 | utilisateur (RLS) | `src/lib/archiveApi.ts:27` |
| `restore_client` | 1 | utilisateur (RLS) | `src/lib/archiveApi.ts:40` |
| `restore_job` | 1 | utilisateur (RLS) | `src/lib/archiveApi.ts:58` |
| `restore_lead` | 1 | utilisateur (RLS) | `src/lib/archiveApi.ts:49` |
| `rpc_add_visit` | 1 | utilisateur (RLS) | `src/lib/scheduleApi.ts:300` |
| `rpc_create_invoice_draft` | 1 | utilisateur (RLS) | `src/lib/invoicesApi.ts:427` |
| `rpc_create_job_with_optional_schedule` | 1 | utilisateur (RLS) | `src/lib/jobsApi.ts:725` |
| `rpc_create_quote` | 1 | utilisateur (RLS) | `src/lib/quotesApi.ts:269` |
| `rpc_insights_budget_vs_actual` | 1 | utilisateur (RLS) | `src/lib/insightsApi.ts:511` |
| `rpc_insights_churn_risk` | 1 | utilisateur (RLS) | `src/lib/insightsApi.ts:457` |
| `rpc_insights_client_lifetime_value` | 1 | utilisateur (RLS) | `src/lib/insightsApi.ts:415` |
| `rpc_insights_cohort_retention` | 1 | utilisateur (RLS) | `src/lib/insightsApi.ts:496` |
| `rpc_insights_invoices_summary` | 1 | utilisateur (RLS) | `src/lib/insightsApi.ts:198` |
| `rpc_insights_job_profitability` | 1 | utilisateur (RLS) | `src/lib/insightsApi.ts:435` |
| `rpc_insights_lead_conversion` | 1 | utilisateur (RLS) | `src/lib/insightsApi.ts:174` |
| `rpc_insights_overview` | 1 | utilisateur (RLS) | `src/lib/insightsApi.ts:142` |
| `rpc_insights_period_comparison` | 1 | utilisateur (RLS) | `src/lib/insightsApi.ts:275` |
| `rpc_insights_pipeline_velocity` | 1 | utilisateur (RLS) | `src/lib/insightsApi.ts:329` |
| `rpc_insights_revenue_forecast` | 1 | utilisateur (RLS) | `src/lib/insightsApi.ts:293` |
| `rpc_insights_revenue_series` | 1 | utilisateur (RLS) | `src/lib/insightsApi.ts:161` |
| `rpc_insights_team_performance` | 1 | utilisateur (RLS) | `src/lib/insightsApi.ts:308` |
| `rpc_invoices_kpis_30d` | 1 | utilisateur (RLS) | `src/lib/invoicesApi.ts:190` |
| `rpc_list_invoices` | 2 | utilisateur (RLS) | `src/lib/invoicesApi.ts:311` · `src/pages/Invoices.tsx:341` |
| `rpc_list_payments` | 1 | utilisateur (RLS) | `src/lib/paymentsApi.ts:223` |
| `rpc_payments_overview_kpis` | 1 | utilisateur (RLS) | `src/lib/paymentsApi.ts:202` |
| `rpc_peek_next_numbers` | 1 | utilisateur (RLS) | `src/lib/numbersApi.ts:26` |
| `rpc_recalculate_quote` | 1 | utilisateur (RLS) | `src/lib/quotesApi.ts:345` · `src/lib/quotesApi.ts:552` · `src/lib/quotesApi.ts:592` |
| `rpc_reschedule_event` | 1 | utilisateur (RLS) | `src/lib/scheduleApi.ts:255` |
| `rpc_save_invoice_draft` | 1 | utilisateur (RLS) | `src/lib/invoicesApi.ts:470` |
| `rpc_schedule_job` | 3 | utilisateur (RLS) | `src/lib/pipelineApi.ts:479` · `src/lib/pipelineApi.ts:531` · `src/lib/scheduleApi.ts:226` · `src/lib/jobsApi.ts:204` |
| `rpc_unschedule_job` | 2 | utilisateur (RLS) | `src/lib/scheduleApi.ts:415` · `src/lib/jobsApi.ts:222` |
| `rpc_update_entity_number` | 1 | utilisateur (RLS) | `src/lib/numbersApi.ts:95` |
| `set_deal_stage` | 3 | utilisateur (RLS) | `src/lib/leadsApi.ts:271` · `src/lib/quotesApi.ts:213` · `src/lib/pipelineApi.ts:370` · `src/lib/pipelineApi.ts:425` |
| `soft_delete_job` | 1 | utilisateur (RLS) | `src/lib/jobsApi.ts:1250` |

#### `server/`

| Fonction | fichiers | client | sites |
|---|---:|---|---|
| `anonymize_client` | 1 | **service_role** | `server/routes/dsr.ts:135` · `server/routes/dsr.ts:173` |
| `apply_invoice_payment` | 1 | **service_role** | `server/routes/payments.ts:215` |
| `cancel_hard_delete_member` | 1 | **service_role** | `server/routes/team-compliance.ts:78` |
| `check_password_strength` | 1 | **service_role** | `server/routes/security.ts:521` |
| `create_incident` | 1 | utilisateur (RLS) | `server/routes/incidents.ts:42` |
| `create_invoice_from_job` | 1 | utilisateur (RLS) | `server/routes/leads.ts:403` |
| `create_invoice_from_milestone` | 1 | utilisateur (RLS) | `server/routes/leads.ts:397` |
| `current_org_id` | 1 | utilisateur (RLS) | `server/lib/supabase.ts:79` |
| `detect_login_anomalies` | 1 | **service_role** | `server/routes/incidents.ts:196` |
| `ensure_payment_settings_row` | 1 | utilisateur (RLS) | `server/lib/payments.ts:97` |
| `export_client_data` | 1 | **service_role** | `server/routes/dsr.ts:85` |
| `export_user_data` | 1 | **service_role** | `server/routes/dsr.ts:40` |
| `get_user_id_by_email` | 2 | **service_role** | `server/lib/supabase.ts:43` · `server/routes/invitations.ts:270` · `server/routes/invitations.ts:438` |
| `has_org_admin_role` | 2 | utilisateur (RLS) + **service_role** | `server/lib/supabase.ts:191` · `server/routes/team-compliance.ts:36` · `server/routes/team-compliance.ts:129` · `server/routes/team-compliance.ts:174` |
| `has_org_membership` | 1 | utilisateur (RLS) | `server/lib/supabase.ts:147` · `server/lib/supabase.ts:162` |
| `invalidate_all_sessions` | 1 | **service_role** | `server/routes/security.ts:438` |
| `invalidate_user_sessions` | 1 | **service_role** | `server/routes/team-compliance.ts:141` |
| `invoice_next_number` | 3 | utilisateur (RLS) + **service_role** | `server/lib/scheduler.ts:305` · `server/lib/invoice-numbering.ts:13` · `server/lib/recurringInvoicesEngine.ts:40` |
| `list_member_audit_events` | 1 | **service_role** | `server/routes/team-compliance.ts:176` |
| `next_recurrence_at` | 1 | utilisateur (RLS) | `server/lib/recurringJobScheduler.ts:169` |
| `provision_sms_channel` | 1 | **service_role** | `server/lib/twilioProvisioning.ts:50` |
| `purge_old_audit_events` | 1 | **service_role** | `server/routes/cron.ts:60` |
| `recalculate_invoice_totals` | 1 | **service_role** | `server/lib/recurringInvoicesEngine.ts:108` |
| `record_consent` | 1 | **service_role** | `server/routes/dsr.ts:245` |
| `record_email_opt_out` | 1 | **service_role** | `server/routes/campaigns.ts:531` |
| `record_failed_login` | 1 | **service_role** | `server/routes/incidents.ts:214` |
| `release_advisory_lock` | 1 | **service_role** | `server/lib/advisory-lock.ts:28` |
| `request_hard_delete_member` | 1 | **service_role** | `server/routes/team-compliance.ts:57` |
| `reverse_invoice_payment` | 1 | **service_role** | `server/routes/payments.ts:1473` |
| `rpc_create_invoice_draft` | 1 | utilisateur (RLS) | `server/routes/quotes.ts:1449` |
| `rpc_create_job_with_optional_schedule` | 2 | utilisateur (RLS) | `server/routes/quotes.ts:572` · `server/routes/leads.ts:561` |
| `rpc_insights_churn_risk` | 1 | **service_role** | `server/lib/scheduled-reports.ts:48` |
| `rpc_insights_client_lifetime_value` | 1 | **service_role** | `server/lib/scheduled-reports.ts:45` |
| `rpc_insights_invoices_summary` | 1 | **service_role** | `server/lib/scheduled-reports.ts:41` |
| `rpc_insights_lead_conversion` | 1 | **service_role** | `server/lib/scheduled-reports.ts:37` |
| `rpc_insights_overview` | 1 | **service_role** | `server/lib/scheduled-reports.ts:33` |
| `rpc_insights_revenue_series` | 1 | utilisateur (RLS) | `server/lib/agent/tools.ts:475` |
| `rpc_list_invoices` | 1 | utilisateur (RLS) | `server/lib/agent/tools.ts:344` · `server/lib/agent/tools.ts:403` |
| `run_retention_job` | 1 | **service_role** | `server/routes/cron.ts:51` |
| `search_global` | 1 | **service_role** | `server/routes/search.ts:296` |
| `search_global_by_type` | 1 | **service_role** | `server/lib/helpers.ts:237` |
| `search_global_counts` | 1 | **service_role** | `server/routes/search.ts:388` |
| `security_maintenance` | 1 | **service_role** | `server/lib/security.ts:834` |
| `set_deal_stage` | 1 | **service_role** | `server/routes/quotes.ts:381` · `server/routes/quotes.ts:518` · `server/routes/quotes.ts:963` · `server/routes/quotes.ts:1336` |
| `set_member_mfa_required` | 1 | **service_role** | `server/routes/team-compliance.ts:98` |
| `try_advisory_lock` | 1 | **service_role** | `server/lib/advisory-lock.ts:17` |
| `verify_org_access` | 1 | **service_role** | `server/lib/org-access.ts:29` |

### 1.3 Colonnes citées — 15 tables les plus utilisées

| # | Table | réfs | Colonnes citées dans `.select(` / `.eq(` / `.order(` / `.filter(` |
|---:|---|---:|---|
| 1 | `clients` | 132 | `id`, `org_id`, `last_name`, `first_name`, `deleted_at`, `email`, `phone`, `company`, `created_at`, `status`, `address`, `display_as_company`, `lead_status`, `value`, `updated_at`, `assigned_to`, `source`, `portal_token`, `portal_token_hash`, `notes`, `title`, `user_id`, `created_by`, `province`, `portal_token_expires_at`, `portal_token_revoked_at`, `tags`, `schedule`, `billing_same_as_service`, `billing_address`, `place_id`, `latitude`, `longitude`, `name`, `city`, `tax_exempt` |
| 2 | `jobs` | 101 | `id`, `org_id`, `created_at`, `deleted_at`, `status`, `title`, `client_id`, `total_cents`, `property_address`, `scheduled_at`, `job_number`, `team_id`, `lead_id`, `client_name`, `salesperson_id`, `latitude`, `job_type`, `total_amount`, `longitude`, `created_by`, `completed_at`, `address`, `geocode_status`, `expenses_cents`, `version`, `updated_at`, `assigned_to`, `total`, `end_at`, `currency`, `subtotal_cents`, `tax_lines` |
| 3 | `memberships` | 88 | `user_id`, `org_id`, `role`, `status`, `full_name`, `avatar_url`, `team_id`, `permissions`, `created_at`, `scope`, `department_id`, `manager_id`, `experience_level`, `show_on_leaderboard`, `permissions_custom`, `language` |
| 4 | `invoices` | 69 | `id`, `org_id`, `status`, `client_id`, `deleted_at`, `invoice_number`, `due_date`, `total_cents`, `balance_cents`, `paid_at`, `created_at`, `issued_at`, `job_id`, `currency`, `subject`, `view_token`, `paid_cents`, `updated_at`, `sent_at`, `is_viewed`, `view_count`, `billing_milestone_id`, `is_recurring`, `next_recurrence_date`, `quote_id`, `line_items`, `tax_cents` |
| 5 | `quotes` | 66 | `id`, `org_id`, `deleted_at`, `status`, `created_at`, `client_id`, `quote_number`, `total_cents`, `lead_id`, `valid_until`, `view_token`, `currency`, `last_name`, `title`, `created_by`, `deposit_required`, `deposit_type`, `deposit_value`, `deposit_status`, `job_id`, `first_name`, `company`, `display_as_company`, `sent_at`, `email`, `deposit_cents`, `require_payment_method`, `approved_at`, `converted_at`, `assigned_to`, `salesperson_id`, `sent_via_email_at`, `sent_via_sms_at`, `subtotal_cents`, `discount_cents`, `tax_rate_label`, `tax_cents`, `notes`, `contract_disclaimer`, `declined_at`, `quote_type`, `service_plan` |
| 6 | `subscriptions` | 64 | `status`, `id`, `org_id`, `created_at`, `plan_id`, `interval`, `currency`, `stripe_subscription_id`, `amount_cents`, `canceled_at`, `extra_seats`, `trial_end`, `extra_offices`, `current_period_end`, `stripe_customer_id`, `current_period_start`, `scheduled_plan_id`, `stripe_seat_item_id`, `stripe_office_item_id`, `name`, `monthly_price_cad` |
| 7 | `company_settings` | 49 | `org_id`, `company_name`, `logo_url`, `phone`, `email`, `city`, `postal_code`, `street1`, `province`, `website`, `id`, `country`, `google_review_url`, `revenue_goal_cents`, `primary_color`, `currency`, `review_enabled`, `setup_completed`, `setup_dismissed` |
| 8 | `profiles` | 37 | `id`, `full_name`, `avatar_url`, `location_consent`, `onboarding_done`, `company_name`, `location_consent_at` |
| 9 | `orgs` | 35 | `id`, `name`, `company_group_id`, `created_at`, `country`, `region`, `city`, `postal_code`, `email`, `address`, `updated_at` |
| 10 | `pipeline_deals` | 35 | `id`, `deleted_at`, `org_id`, `lead_id`, `created_at`, `stage`, `value`, `job_id`, `rep_id`, `quote_id`, `created_by`, `value_cents`, `won_at`, `client_id` |
| 11 | `field_house_profiles` | 34 | `id`, `org_id`, `deleted_at`, `current_status`, `lat`, `lng`, `reknock_priority_score`, `client_id`, `metadata`, `address_normalized`, `address`, `territory_id`, `lead_id`, `quote_id`, `last_activity_at`, `visit_count`, `assigned_user_id`, `ai_next_action`, `job_id`, `created_at` |
| 12 | `schedule_events` | 33 | `start_at`, `deleted_at`, `id`, `job_id`, `end_at`, `org_id`, `team_id`, `status`, `start_time`, `notes`, `end_time`, `timezone`, `title`, `created_at`, `client_id`, `property_address`, `latitude`, `longitude`, `client_name` |
| 13 | `notifications` | 27 | `org_id`, `id`, `created_at`, `is_read`, `read_at`, `entity_type`, `body`, `type`, `reference_id`, `dismissed_at`, `category` |
| 14 | `time_entries` | 27 | `org_id`, `date`, `employee_id`, `id`, `punch_in_at`, `breaks`, `punch_out_at`, `status`, `punch_out`, `job_id`, `punch_in`, `employee_name`, `notes` |
| 15 | `email_templates` | 23 | `id`, `org_id`, `type`, `is_default`, `subject`, `body`, `name`, `is_active`, `created_at` |

---

## 2. Chemins d'écriture non gardés (`getServiceClient()` + mutation)

**61 fichiers de routes sur 69** utilisent `getServiceClient()`, qui contourne la RLS (`server/lib/supabase.ts:16`).

Le motif de garde dominant, et globalement bien respecté, est :
`requireAuthedClient(req,res)` → `auth.orgId` (déjà validé contre `has_org_membership` quand le header `x-org-id` est présent, `server/lib/supabase.ts:143-146`) → puis `.eq('org_id', auth.orgId)` ou `org_id: auth.orgId` sur l'écriture.

Conformément à la consigne, chaque écriture a été suivie **jusque dans le helper aval** avant tout verdict. Résultat : **sur les 61 fichiers, 3 défauts réels + 1 mineur**. Les batches 3 et 4 (30 fichiers, dont `payments.ts`, `quotes.ts`, `billing.ts`, `taxes.ts`, `security.ts`, `tracking.ts`, `timesheets.ts`) sont **intégralement propres**.

### 2.1 🔴 `field_pins` — suppression cross-tenant systématique

`server/routes/field-sales.ts:534-546`, route `DELETE /field-sales/houses/:id` :

```ts
const { error: pinErr, count: pinCount } = await admin
  .from('field_pins')
  .delete()
  .eq('house_id', req.params.id)
  .eq('org_id', auth.orgId);
...
// Also try without org_id filter as fallback (in case pin has different org_id)
if (!pinCount || pinCount === 0) {
  await admin
    .from('field_pins')
    .delete()
    .eq('house_id', req.params.id);
}
```

Deux défauts cumulés :
1. Le repli est **explicitement sans filtre `org_id`** (le commentaire l'assume).
2. `supabase-js` ne renvoie `count` que si l'on demande `{ count: 'exact' }`. Ici `pinCount` vaut **toujours `null`**, donc `!pinCount` est **toujours vrai** : le repli non filtré s'exécute à **chaque** appel, y compris quand la suppression scopée a réussi.

Conséquence : tout utilisateur authentifié qui passe le `house_id` d'un autre tenant supprime les pins de ce tenant. Le soft-delete de la maison ligne 521-525 est correctement scopé et ne fait rien — la victime garde donc la ligne mais perd les pins, sans aucune trace.

### 2.2 🔴 `findOrCreateConversation` — lookup SMS non scopé (vérifié personnellement)

`server/lib/helpers.ts:397-425`. Le helper **reçoit** `orgId` en 2ᵉ paramètre et ne l'utilise sur **aucune** des deux lectures :

```ts
const { data: existing } = await serviceClient
  .from('conversations')
  .select('*')
  .in('phone_number', variants)     // ← pas de .eq('org_id', orgId)
  .limit(1)
  .maybeSingle();
if (existing) return existing;
...
  const { data: client } = await serviceClient
    .from('clients')
    .select('id, first_name, last_name')
    .or(phoneFilter)                // ← pas de .eq('org_id', orgId)
    .limit(1)
    .maybeSingle();
```

`orgId` n'est utilisé qu'à l'`insert` final (ligne 434). Appelants : `server/routes/communications.ts:89` (`POST /communications/send-sms`) et `server/routes/messages.ts` (`POST /messages/send`).

Conséquences, service_role, RLS contournée :
- `server/routes/communications.ts:94-103` insère ensuite une ligne `messages` avec `conversation_id: conversation.id` — **le fil d'un autre tenant** — et `client_id: conversation.client_id`, l'UUID client d'un autre tenant.
- Branche création : le `clients` non filtré remonte le nom complet d'un client d'un autre tenant, écrit dans `conversations.client_name` (`helpers.ts:437-438`) et donc affiché dans l'inbox de l'attaquant. **Fuite de PII cross-tenant.**

### 2.3 🔴 SMS entrant routé vers le mauvais tenant

`server/routes/messages.ts:243-251` — même motif, sur le webhook Twilio entrant :

```ts
const { data: existingConvo } = await serviceClient
  .from('conversations')
  .select('id, org_id, client_id, client_name')
  .in('phone_number', phoneVariants)   // aucun filtre sur To / org
  .limit(1)
  .maybeSingle();

let conversation = existingConvo;
let orgId = existingConvo?.org_id;
```

Puis `server/routes/messages.ts:325` : `const effectiveOrgId = orgId || conversation.org_id;`, et l'upsert `messages` ligne 331-341 écrit le corps du SMS sous cet `org_id`.

Le webhook lui-même est correctement authentifié (signature `x-twilio-signature`, ligne 158) — le problème est le **routage d'org**, pas l'auth. Le routage par numéro destinataire (`communication_channels`, lignes 283-296) n'est qu'un **dernier recours**, atteint seulement si aucune conversation *et* aucun client ne matche le numéro émetteur, la recherche `clients` (lignes 256-262) étant elle aussi globale à tous les tenants.

Chaîne d'exploitation : le tenant A crée une conversation pour le numéro d'un client du tenant B (via `POST /messages/send`, cf. §2.2) → toute réponse SMS ultérieure de ce client vers le numéro Twilio **de B** est stockée sous l'`org_id` de A et lisible par A.

À noter au passage, comportements globaux volontaires mais à documenter : `messages.ts:203-212` (STOP → opt-out propagé à toutes les orgs, conformité CASL) et `messages.ts:223` (`sms_opt_outs.delete().eq('phone', …)` sans `org_id`, START global).

### 2.4 🟡 `field_sales_team_members` — `rep_id` non validé

`server/routes/field-sales.ts:1367-1370` :

```ts
await admin.from('field_sales_team_members')
  .insert(member_ids.map((rid: string) => ({ team_id: team.id, rep_id: rid })));
```

`rep_id` provient du body et n'est jamais vérifié contre `auth.orgId`. La table n'a pas de colonne `org_id`. L'équipe elle-même est bien scopée (ligne 1362). `GET /teams` (ligne 1346-1348) fait ensuite le join `field_sales_team_members(rep_id, field_sales_reps(id, display_name))` → **fuite des noms de représentants d'un autre tenant**.

### 2.5 Points de vigilance (non exploitables aujourd'hui, à durcir)

| Emplacement | Nature |
|---|---|
| `server/routes/payments.ts:268-272` | `payment_requirements.update({status:'paid'}).eq('id', payReqId)` dans le webhook Stripe, **aucun filtre org** ; `payReqId` vient de `intent.metadata`. Un tenant possédant son propre compte Stripe et pointant un webhook vers nous pourrait marquer payée l'exigence d'un autre tenant. |
| `server/routes/payments.ts:261-262` | `quotes.update` sibling : le filtre org n'est appliqué que `if (webhookOrgId)`. Metadata sans `org_id` → dégradation en update-par-id. |
| `server/lib/stripe-connect.ts:321-324` | `updatePaymentRequestStatus(id,…)` non scopé par design. Tous les appelants actuels passent un id issu d'un SELECT scopé → sûr aujourd'hui, mais l'invariant est conventionnel et non appliqué. |
| `server/routes/billing.ts:468` | `POST /billing/subscribe`, branche parrainage : écrit sur la `subscriptions` **d'une autre org** (`referral.referrer_org_id`). Garde-fous en place (auto-parrainage bloqué :433, idempotence :441) — comportement voulu, mais un `referral_code` fourni par l'attaquant offre +30 j à une org tierce. |
| `server/routes/tracking.ts:64-68`, `server/routes/timesheets.ts:119-123` | Expiration de session par `user_id`+`status` sans `org_id` : un utilisateur multi-bureaux qui pointe au bureau A ferme silencieusement sa session ouverte au bureau B. Bug de données, pas de tenancy. |
| `server/routes/dsr.ts:231-243` | `POST /dsr/consent` public : si `org_id` est omis, n'importe qui écrit une ligne de consentement non scopée pour un `subject_id` arbitraire. |
| `server/routes/payroll.ts:271`, `server/routes/courses.ts:924-929` | `user_id` / `user_ids` du body jamais vérifiés comme membres de l'org. Intra-tenant, pas de franchissement de frontière. |

---

## 3. Incohérences de contrat

### 3.1 Convention `p_*` sur les paramètres RPC

**112 sites d'appel `.rpc()` avec objet de paramètres analysés. Aucune violation de la convention `p_*`.** L'unique candidat (`src/lib/paymentsApi.ts:223`) est un artefact de mon parseur : le code réel est `p_from: query.date === 'custom' ? … : null`, correctement préfixé.

Deux anomalies de **contrat d'arité**, plus graves que le nommage :

**a) `rpc_list_invoices` — appel à arité variable, `src/lib/invoicesApi.ts:294-311`**

```ts
// Only send p_salesperson when filtering — keeps the call compatible with
// the pre-migration 9-arg rpc_list_invoices until 20260717000000 is applied.
if (query.salespersonId && query.salespersonId !== 'All') params.p_salesperson = query.salespersonId;
const { data, error } = await supabase.rpc('rpc_list_invoices', params);
```

Le front dépend donc de **deux signatures simultanées**. Trois issues, toutes silencieuses côté catalogue :
- une seule signature 10-arg en base → le chemin sans filtre commercial casse (`PGRST202`) ;
- une seule signature 9-arg → le filtrage par commercial casse ;
- les deux → PostgREST peut échouer sur `could not choose the best candidate function`.

**À croiser en priorité** : combien de surcharges de `rpc_list_invoices` existent en prod, et la migration `20260717000000` est-elle posée ? Même appel dupliqué dans `src/pages/Invoices.tsx:336-341` (export CSV) avec la même logique conditionnelle.

**b) `rpc_invoices_kpis_30d` appelé avec `{}` — `src/lib/invoicesApi.ts:190`**
Aucun paramètre : suppose une signature **zéro-argument** qui déduit l'org de `current_org_id()`. Idem pour le motif `p_org: null` généralisé dans `insightsApi.ts` / `paymentsApi.ts` (13 appels) — le code **délègue entièrement le cloisonnement tenant** au corps SQL de la fonction. Si une de ces fonctions perd son `current_org_id()` par défaut, elle ne plante pas : elle renvoie potentiellement les données de tous les tenants.

### 3.2 Colonnes lues mais jamais écrites par le code (dépendance à un trigger/défaut DB)

| Colonne | Lue en | Écrite par le code ? | Risque |
|---|---|---|---|
| `jobs.total_amount`, `jobs.total`, `jobs.subtotal`, `jobs.tax_total` | `src/pages/RepProfile.tsx:486`, `src/pages/ClientDetails.tsx:474`, `src/lib/jobsApi.ts:248,256-258,499-501` | **Non**, volontairement — `src/lib/jobsApi.ts:641-643` : « seules les colonnes `*_cents` sont écrites » ; `:1015` : « `total_amount` est recalculé par `sync_jobs_legacy_money` (N1.7) » | Si le trigger `sync_jobs_legacy_money` (migration `20260751101100_money_single_source_of_truth.sql`) est absent ou désactivé en prod, RepProfile et ClientDetails affichent **0 $** sans erreur. |
| `clients.version`, `jobs.version`, `invoices.version` | verrouillage optimiste : `.eq('version', expectedVersion)` — `src/lib/clientsApi.ts:285`, `src/lib/jobsApi.ts:688,712,1057`, `src/lib/invoicesApi.ts:691` | **Non** | Si le trigger d'incrément n'existe pas, `version` reste constante : le verrou optimiste ne détecte **jamais** de conflit et écrase silencieusement les modifications concurrentes. |
| `clients.portal_token_hash` | filtre d'authentification du portail client : `server/routes/portal.ts:40-41` | **Non** — seul écrivain trouvé : le backfill unique `supabase/migrations/20260624000002_v1_hardening_clients_portal_token.sql:40` | Tout client créé **après** cette migration a `portal_token_hash = NULL`. Le lookup par hash échoue et le code retombe sur le lookup en clair `.eq('portal_token', token)` (`portal.ts:49-50`). Le durcissement est donc **inopérant pour les nouveaux clients**, silencieusement. |

*(`schedule_events.start_time`/`end_time` apparaissaient dans le premier passage — attribution erronée de mon parseur, ces colonnes appartiennent à `team_date_slots`/`team_availability`. Écarté.)*

### 3.3 Colonnes écrites mais jamais relues par le code

Analyse complète produite ; ~90 tables concernées. Les cas où la table est **écrite exhaustivement et jamais relue par aucun `.select()`** — donc du stockage pur dont personne ne vérifie l'exploitabilité :

| Table | Colonnes écrites, aucune relecture | Site d'écriture |
|---|---|---|
| `a2p_registrations` | 27 colonnes (tout sauf clés) | `server/lib/twilioA2P.ts:87`, `:175` |
| `integration_audit_logs` | `action, app_id, connection_id, message, metadata, org_id, status, user_id` (100 %) | `server/lib/integrations/service.ts:61` |
| `data_export_log` | `entity_type, export_type, ip_address, record_count, user_agent, user_id` (100 %) | `server/lib/data-export-log.ts:51` |
| `fs_check_in_records` | `lat, lng, org_id, session_id, type, user_id` (100 %) | `server/lib/field-sales/session-engine.ts:54` |
| `field_pin_entity_links` | `entity_id, entity_type, house_id, linked_at, org_id` (100 %) | `server/lib/fieldPinSync.ts:258` |
| `dead_letters` | `error_msg, payload` | `server/lib/dead-letter.ts:24` |
| `incident_timeline` | `actor_id, event_type, payload` | `server/routes/incidents.ts:139` |
| `communication_messages` | 13 colonnes | `server/routes/communications.ts:106`, `:183` |
| `quote_measurements` | 13 colonnes | `src/lib/measurementApi.ts:69` |
| `form_submissions` | 12 colonnes (`custom_responses`, `ip_address`, `user_agent`, `deal_id`…) | `server/routes/request-forms.ts:584` |

Deux lectures possibles : (a) tables d'audit/télémétrie consommées uniquement en SQL manuel — légitime ; (b) fonctionnalité amputée côté UI. `quote_measurements` et `form_submissions` relèvent probablement de (b). **À trancher avec le catalogue** (une table jamais lue *ni par le code ni par une vue* est un candidat sérieux à la suppression).

### 3.4 Champs renvoyés par une route API et jamais consommés côté client

13 littéraux de réponse contiennent au moins un champ dont le nom **n'apparaît nulle part dans `src/`** :

| Route | Champs morts | Payload complet |
|---|---|---|
| `server/routes/security.ts:318` (`GET /security/summary`) | `unacknowledged_alerts`, `security_events_24h`, `failed_logins_24h`, `blocked_ips`, `critical_events_7d` | **la totalité du payload** — l'endpoint n'est consommé par personne |
| `server/routes/incidents.ts:198` | `anomalies`, `window_minutes` | idem, payload entier |
| `server/routes/incidents.ts:54` | `incident_id` | payload entier |
| `server/routes/incidents.ts:146` | `incident` | payload entier |
| `server/routes/payments.ts:1031` | `public_keys`, `webhook_urls` | `environment, public_keys, webhook_urls` |
| `server/routes/campaigns.ts:274` | `max_per_send`, `over_limit` | `total, sample, max_per_send, over_limit` |
| `server/routes/leads.ts:293` | `deal_deleted`, `lead_deleted` | `ok, deal_deleted, lead_deleted` |
| `server/routes/onboarding.ts:151` | `invites_sent` | `ok, redirect, invites_sent` |
| `server/routes/security.ts:443` | `invalidated` | `ok, invalidated` |
| `server/routes/quotes.ts:244` | `first_view` | `tracked, first_view` |
| `server/routes/request-forms.ts:397` | `spam_filtered` | `ok, spam_filtered` |
| `server/routes/invitations.ts:466` | `requires_login` | `error, requires_login, email` |
| `server/routes/commissions.ts:386` | `is_admin` | `user_id, is_admin` |

Les quatre premiers indiquent des **endpoints entiers sans consommateur** (`/security/summary`, les routes `/incidents`). `invitations.ts:466 requires_login` est le plus suspect fonctionnellement : le serveur signale au front qu'une connexion est requise, et le front ignore ce signal.

### 3.5 🔴 Gestion d'erreur absente — 215 mutations avalées silencieusement

C'est le point le plus important de cette section, et le mode de panne exact décrit dans l'énoncé.

**`supabase-js` ne lève pas d'exception** : il retourne `{ data, error }`. Donc un `try/catch` **ne protège pas** — seule la destructuration de `error` détecte l'échec. Une instruction commençant par `await` sans affectation jette le résultat, `error` compris.

**215 sites** de la forme `await <client>.from(…).insert|update|upsert|delete(…)` ou `await <client>.rpc(…)` sans capture de `error` :
- `src/` : **25**
- `server/` : **190**

Inventaire complet dans `err.txt` (généré, non commité). Les plus lourds de conséquence :

**a) Totaux de devis jamais recalculés — 3 sites**
```
src/lib/quotesApi.ts:345  await supabase.rpc('rpc_recalculate_quote', { p_quote_id: quoteId });
src/lib/quotesApi.ts:552  await supabase.rpc('rpc_recalculate_quote', { p_quote_id: quoteId });
src/lib/quotesApi.ts:592  await supabase.rpc('rpc_recalculate_quote', { p_quote_id: quoteId });
```
Si le `GRANT EXECUTE` sur `rpc_recalculate_quote` est retiré (le scénario déjà survenu), l'appel renvoie une erreur, elle est jetée, l'utilisateur voit un succès et le devis conserve des totaux périmés. **Zéro signal.**

**b) Étape de pipeline jamais mise à jour — 5 sites**
`src/lib/quotesApi.ts:213`, `server/routes/quotes.ts:381, 518, 963, 1336` : `await …rpc('set_deal_stage', …)` sans contrôle. Un devis peut être marqué accepté sans que le deal passe en `closed_won`.

**c) Toute la piste d'audit et de sécurité**
`server/lib/security.ts:474` (`security_events`), `:614` (`security_alerts`), `:646` (`login_history`), `server/lib/eventBus.ts:96` (`activity_log`), `server/routes/team-compliance.ts:144` (`audit_events`), `server/lib/data-export-log.ts:51`. Si l'une de ces tables est renommée ou perd son `INSERT`, l'audit s'arrête **silencieusement** — et c'est justement la surface sur laquelle on compterait pour détecter l'incident.

**d) Facturation Stripe — `server/routes/billing.ts`, ~20 sites**
`:736, :865, :911, :987, :997, :1066, :1189, :1205, :1220, :1279, :1400, :1416, :1431, :1458, :1920, :1927, :263, :301, :408, :473, :577, :803, :1640, :1673`. Exemple : ligne 997, `await admin.from('subscriptions').insert({ … status: 'active' … })` — si l'insert échoue, Stripe a encaissé et l'org n'a pas d'abonnement, sans aucune trace applicative.

**e) Journal des relances de paiement** — `server/routes/reminders-cron.ts:213, 256, 271, 285` : l'écriture dans `reminder_log` est la seule protection contre le double envoi. Non vérifiée.

**f) Cas particulier — `server/routes/invitations.ts:269`**
```ts
await admin.from('profiles').select('id').eq('id',
  (await admin.rpc('get_user_id_by_email', { p_email: email }))?.data
).maybeSingle()
```
RPC imbriquée dans un `.eq()`, `.data` consommé sans regarder `.error`. Si la RPC échoue, `.data` vaut `null` et `.eq('id', null)` s'exécute — chemin d'inscription, exactement le motif qui a masqué le bug une journée entière.

---

## 4. Surface morte côté code

### 4.1 Fichiers de routes non montés dans `server/index.ts`

**5 routers, 34 endpoints, jamais montés.** Vérifié : aucun `import` de ces fichiers nulle part dans `server/` (`server/index.ts` est le seul point d'entrée Express).

| Fichier | Endpoints | Appelé par le front ? |
|---|---:|---|
| `server/routes/recurring-invoices.ts` | 5 (`GET/POST /recurring-invoices`, `PATCH/DELETE /:id`, `POST /:id/run-now`) | 🔴 **OUI** — `src/lib/recurringInvoicesApi.ts:53,70,95,107,119` |
| `server/routes/quickbooks-export.ts` | 4 (`GET /quickbooks-export/{customers,invoices,payments,items}.csv`) | 🔴 **OUI** — `src/pages/QuickBooksExport.tsx:30` |
| `server/routes/campaigns.ts` | 10 | Non |
| `server/routes/booking.ts` | 8 | Non |
| `server/routes/webhooks-config.ts` | 7 | Non |

**Les deux premiers sont des 404 garantis en production.** Atténuation : `src/pages/QuickBooksExport.tsx` n'est référencé par aucune route front (§4.3), et `src/lib/recurringInvoicesApi.ts` n'a qu'un consommateur, `src/lib/statsExtraApi.ts` — ces chemins sont probablement inatteignables aujourd'hui, mais la fonctionnalité « factures récurrentes » et « export QuickBooks » est **livrée non fonctionnelle**.

Effet secondaire notable : les tables `booking_pages`, `bookings`, `email_campaigns`, `email_campaign_recipients`, `webhook_endpoints`, `webhook_deliveries` apparaissent en écriture dans §1.1 alors qu'**aucun code atteignable ne les écrit**. Elles sortiront comme « écrites par le code » d'un croisement naïf. À traiter comme mortes sauf preuve du contraire (`server/routes/cron.ts` touche `email_campaigns` — c'est le seul chemin vivant).

### 4.2 Exports de `src/lib/*Api.ts` importés par aucun autre module

**192 exports morts sur 709**, répartis sur 84 fichiers `*Api.ts` — soit **27 %**.

Modules morts en quasi-totalité (fonctionnalité entière non branchée) :

| Fichier | Exports morts | Note |
|---|---:|---|
| `src/lib/workflowApi.ts` | 18/18 | **module entièrement mort** — et les seules écritures vers `workflows`, `workflow_nodes`, `workflow_edges`, `workflow_runs`, `workflow_logs` (§1.1) |
| `src/lib/locationApi.ts` | 18 | `gps_providers`, `geofences`, `proof_of_presence`, `technician_device_mappings`, `technician_locations` |
| `src/lib/fieldSalesApi.ts` | 15 | |
| `src/lib/quoteTemplatesApi.ts` | 8/8 | module entièrement mort |
| `src/lib/bookingApi.ts` | 8/8 | cohérent avec le router `booking.ts` non monté (§4.1) |
| `src/lib/emailTemplatesApi.ts` | 7 | tout le CRUD ; seul le `list` survit |
| `src/lib/fieldSessionsApi.ts` | 7/7 | module entièrement mort |
| `src/lib/pipelineApi.ts` | 12 | dont `createJobFromIntent` — seul appelant de la RPC `create_job_from_intent` |
| `src/lib/insightsApi.ts` | 7 | dont `fetchChurnRisk`, `fetchBudgetVsActual`, `fetchJobProfitability` |
| `src/lib/commissionsApi.ts` | 6 | |
| `src/lib/gamificationApi.ts` | 6 | |
| `src/lib/trackingApi.ts` | 5 | |
| `src/lib/archiveApi.ts` | 3 | `restoreClient`, `restoreLead`, `restoreJob` — seuls appelants des RPC `restore_*` |

**Implication directe pour le croisement** : plusieurs RPC listées en §1.2 comme « appelées par `src/` » ne sont en réalité appelées par **aucun chemin atteignable**. À vérifier une par une avant de conclure qu'une fonction SQL est vivante : `restore_client`, `restore_lead`, `restore_job`, `create_job_from_intent`, `rpc_insights_churn_risk`, `rpc_insights_budget_vs_actual`, `rpc_insights_job_profitability`, `rpc_insights_revenue_forecast`.

### 4.3 Composants et pages jamais rendus

**41 composants sur 225** et **7 pages sur 98** ne sont référencés par aucun autre fichier de `src/` (recherche sur le nom de base dans le texte intégral, ce qui couvre aussi les `React.lazy(() => import('…'))`).

Pages non routées : `src/pages/ChecklistTemplates.tsx`, `src/pages/D2DDashboard.tsx`, `src/pages/DevPlanSwitch.tsx`, `src/pages/QuickBooksExport.tsx`, `src/pages/RecurringJobs.tsx`, `src/pages/WebhookSettings.tsx`, `src/pages/settings/LanguageSettings.tsx`.

*(`WebhookSettings` est délibérément non routée selon l'audit Settings antérieur ; `D2DDashboard` est le seul lecteur de `field_daily_stats` côté `src/`.)*

Composants notables :
- **`src/components/TenantGuard.tsx`** — composant de sécurité conçu pour bloquer l'accès cross-tenant par manipulation d'URL (docstring lignes 2-10). **Jamais utilisé nulle part.** Sécurité écrite puis oubliée.
- `src/components/NotificationBell.tsx`, `RecordTable.tsx`, `QuickActions.tsx`, `DashboardCard.tsx`, `FinancesOverview.tsx`, `GpsTrackingPanel.tsx`, `TechDayReplay.tsx`, `TeamProfilesGrid.tsx`, `CustomFieldsSettings.tsx`, `ImageGallery.tsx`.
- **17 templates de rendu morts** : 9 sur 11 templates de facture (`ModernTemplate`, `ClassicTemplate`, `BoldTemplate`, `MinimalTemplate`, `ExecutiveTemplate`, `ContractorTemplate`, `BusinessProTemplate`, `ModernPaymentTemplate`) et 6 sur 9 templates de devis, plus leurs sélecteurs `InvoiceTemplatePicker.tsx` / `QuoteLayoutPicker.tsx` / `TemplateSelectModal.tsx`. À croiser avec `invoice_templates.template_key` / `quote_templates` en base : si la base propose des clés dont le composant n'existe plus côté rendu, le PDF casse à la génération.
- 5 cartes `insights/` mortes, dont `PaymentMethodMixCard.tsx` — seul lecteur de `payments` dans `src/`.

---

## 5. Cinq constats prioritaires

Classés par probabilité de panne **silencieuse** en production.

### 1. 215 mutations sans contrôle de `error` — le mode de panne déjà observé
`supabase-js` ne lève pas ; 215 `await …insert/update/rpc(…)` jettent le résultat. Un `GRANT` retiré, une table renommée, une contrainte violée → l'utilisateur voit un succès, rien n'est écrit, aucun log. Les surfaces les plus exposées : recalcul des totaux de devis (`src/lib/quotesApi.ts:345,552,592`), progression du pipeline (`set_deal_stage`, 5 sites), **toute la piste d'audit et de sécurité** (`server/lib/security.ts:474,614,646`, `server/lib/eventBus.ts:96`, `server/routes/team-compliance.ts:144`), et ~20 écritures d'abonnement Stripe dans `server/routes/billing.ts`. C'est le constat n°1 parce qu'il **empêche structurellement de détecter les quatre autres**.

### 2. `rpc_list_invoices` — appel à arité variable, dépendance à deux signatures
`src/lib/invoicesApi.ts:294-311` et `src/pages/Invoices.tsx:336-341` n'ajoutent `p_salesperson` que conditionnellement, en s'appuyant sur un commentaire qui suppose la migration `20260717000000` non posée. Selon ce qui est réellement en base : le filtrage par commercial casse, ou la liste des factures casse, ou PostgREST refuse d'arbitrer entre deux surcharges. **Croisement à faire en premier** : nombre de surcharges de `rpc_list_invoices` en prod. À la même famille : `rpc_invoices_kpis_30d` appelée avec `{}` et les 13 appels `p_org: null` qui délèguent le cloisonnement tenant au corps SQL.

### 3. Trois colonnes lues que le code n'écrit jamais — couplage silencieux à des triggers
- `jobs.total_amount` / `total` : lus par RepProfile et ClientDetails, écrits uniquement par `sync_jobs_legacy_money`. Trigger absent → **0 $ affiché**, sans erreur.
- `*.version` : le verrou optimiste (`.eq('version', …)` sur clients/jobs/invoices) suppose un trigger d'incrément. Absent → aucun conflit n'est jamais détecté et les écritures concurrentes s'écrasent.
- `clients.portal_token_hash` : lu en authentification portail (`server/routes/portal.ts:41`), écrit **uniquement** par un backfill unique de juin. Tout client créé depuis a un hash `NULL` → repli automatique sur la comparaison en clair (`portal.ts:49-50`). Le durcissement de sécurité est **inopérant sans que rien ne le signale**.

### 4. Cinq routers de 34 endpoints jamais montés, dont deux appelés par le front
`recurring-invoices.ts` (appelé par `src/lib/recurringInvoicesApi.ts:53,70,95,107,119`) et `quickbooks-export.ts` (appelé par `src/pages/QuickBooksExport.tsx:30`) sont des 404 garantis. Effet pervers sur le croisement : `booking_pages`, `bookings`, `email_campaigns`, `email_campaign_recipients`, `webhook_endpoints`, `webhook_deliveries` apparaîtront comme « écrites par le code » alors qu'aucun chemin atteignable ne les écrit. Même piège pour les 192 exports morts de §4.2, qui font paraître vivantes des RPC (`restore_client`, `restore_lead`, `restore_job`, `create_job_from_intent`, 4 RPC `rpc_insights_*`) qu'**aucun composant n'appelle**.

### 5. Trois écritures service_role réellement non gardées — dont une destructive à 100 %
- `server/routes/field-sales.ts:541-546` : le repli de suppression de `field_pins` est explicitement sans `org_id`, et sa condition `!pinCount` est **toujours vraie** (`supabase-js` ne renvoie `count` que sur demande explicite). Il s'exécute donc à chaque appel : n'importe quel utilisateur authentifié détruit les pins d'un autre tenant, sans trace.
- `server/lib/helpers.ts:408-425` : `findOrCreateConversation` reçoit `orgId` et ne l'applique sur aucune des deux lectures — messages greffés sur le fil d'un autre tenant, PII client d'un autre tenant écrite dans `conversations.client_name`.
- `server/routes/messages.ts:243-251` + `:325` : le SMS entrant est attribué à la première org trouvée par numéro, quel que soit le numéro destinataire — capture cross-tenant du contenu des SMS clients.

Et, en toile de fond : `src/components/TenantGuard.tsx` — le composant écrit précisément pour empêcher l'accès cross-tenant par URL — **n'est utilisé nulle part**.

---

## Annexes — artefacts générés

Scripts d'extraction (jetables, non commités) dans le scratchpad de session :
`inv2.py` (tables + colonnes), `rpcparams.py` (arité/nommage RPC), `err.py` → `err.txt` (les 215 sites sans contrôle d'erreur), `dead.py` (exports/composants/pages morts), `resp.py` (champs de réponse non consommés).

Fin du document.
