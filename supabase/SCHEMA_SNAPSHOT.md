# Instantané du schéma — référentiel de lecture

> ⚠️ **Ce fichier n'est PAS exécutable et n'est PAS la source de vérité du
> déploiement.** C'est une photographie de `pg_catalog`, générée pour qu'on
> dispose enfin d'un référentiel FIABLE — l'ancien `complete_schema.sql` était
> figé au 13 juin, en retard de 121 migrations, et a produit **quatre findings
> faux** pendant l'audit du 31 juillet (vues sans `security_invoker`,
> `search_path` mutable, contraintes `NOT VALID`, tables sans clé primaire —
> tous démentis par la base réelle).
>
> **Régénérer avec** `scripts/gen-schema-snapshot.mjs` après tout changement
> structurel. Un référentiel périmé est pire qu'aucun référentiel.

**Généré le 2026-07-31 14:33 UTC depuis la production (`bbzcuzqfgsdvjsymfwmr`).**

## 1. Tables (218)

| Table | RLS | FORCE | Policies | Lignes (est.) |
|---|---|---|---|---|
| `a2p_registrations` | ✅ | ✅ | 1 | 0 |
| `active_sessions` | ✅ | ✅ | 2 | 63 |
| `activity_log` | ✅ | ✅ | 2 | 587 |
| `activity_notes` | ✅ | ✅ | 3 | 1 |
| `agent_messages` | ✅ | ✅ | 1 | 16 |
| `alert_rules` | ✅ | ✅ | 3 | 0 |
| `api_keys` | ✅ | ✅ | 4 | 0 |
| `app_connections` | ✅ | ✅ | 4 | 1 |
| `applied_taxes` | ✅ | ✅ | 1 | 0 |
| `approvals` | ✅ | ✅ | 1 | 0 |
| `audit_events` | ✅ | ✅ | 4 | 2198 |
| `automation_execution_logs` | ✅ | ✅ | 4 | 175 |
| `automation_rules` | ✅ | ✅ | 4 | 89 |
| `automation_scheduled_tasks` | ✅ | ✅ | 4 | 359 |
| `automations` | ✅ | ✅ | 4 | 0 |
| `billing_profiles` | ✅ | ✅ | 1 | 3 |
| `billing_receipt_log` | ✅ | ✅ | 1 | 2 |
| `board_comments` | ✅ | ✅ | 4 | 0 |
| `board_drawings` | ✅ | ✅ | 3 | 0 |
| `board_votes` | ✅ | ✅ | 3 | 0 |
| `booking_pages` | ✅ | ✅ | 2 | 0 |
| `bookings` | ✅ | ✅ | 3 | 0 |
| `checklist_templates` | ✅ | ✅ | 2 | 0 |
| `client_tags` | ✅ | ✅ | 3 | 0 |
| `clients` | ✅ | ✅ | 4 | 66 |
| `commission_settings` | ✅ | ✅ | 2 | 0 |
| `communication_channels` | ✅ | ✅ | 1 | 1 |
| `communication_messages` | ✅ | ✅ | 1 | 9 |
| `communication_settings` | ✅ | ✅ | 1 | 31 |
| `company_operating_profile` | ✅ | ✅ | 1 | 0 |
| `company_settings` | ✅ | ✅ | 4 | 1 |
| `confidence_calibration` | ✅ | ✅ | 1 | 0 |
| `connected_accounts` | ✅ | ✅ | 4 | 3 |
| `consents` | ✅ | ✅ | 2 | 0 |
| `contacts` | ✅ | ✅ | 4 | 21 |
| `conversations` | ✅ | ✅ | 4 | 7 |
| `course_assignments` | ✅ | ✅ | 3 | 0 |
| `course_lessons` | ✅ | ✅ | 4 | 5 |
| `course_modules` | ✅ | ✅ | 4 | 7 |
| `course_progress` | ✅ | ✅ | 3 | 5 |
| `courses` | ✅ | ✅ | 4 | 16 |
| `custom_column_values` | ✅ | ✅ | 4 | 0 |
| `custom_columns` | ✅ | ✅ | 4 | 2 |
| `data_export_log` | ✅ | ✅ | 4 | 0 |
| `dead_letters` | ✅ | ✅ | 1 | 0 |
| `decision_logs` | ✅ | ✅ | 2 | 4 |
| `decision_outcomes` | ✅ | ✅ | 1 | 0 |
| `demo_requests` | ✅ | ✅ | 1 | 2 |
| `dsar_requests` | ✅ | ✅ | 3 | 0 |
| `email_accounts` | ✅ | ✅ | 4 | 2 |
| `email_campaign_recipients` | ✅ | ✅ | 1 | 0 |
| `email_campaigns` | ✅ | ✅ | 2 | 0 |
| `email_messages` | ✅ | ✅ | 1 | 190 |
| `email_oauth_states` | ✅ | ✅ | 1 | 8 |
| `email_opt_outs` | ✅ | ✅ | 2 | 0 |
| `email_templates` | ✅ | ✅ | 5 | 11 |
| `email_threads` | ✅ | ✅ | 1 | 175 |
| `failed_login_attempts` | ✅ | ✅ | 1 | 0 |
| `few_shot_examples` | ✅ | ✅ | 1 | 0 |
| `field_daily_stats` | ✅ | ✅ | 4 | 15 |
| `field_house_events` | ✅ | ✅ | 4 | 184 |
| `field_house_profiles` | ✅ | ✅ | 4 | 159 |
| `field_pin_entity_links` | ✅ | ✅ | 1 | 6 |
| `field_pin_templates` | ✅ | ✅ | 4 | 0 |
| `field_pins` | ✅ | ✅ | 4 | 115 |
| `field_rep_performance` | ✅ | ✅ | 1 | 0 |
| `field_sales_reps` | ✅ | ✅ | 4 | 3 |
| `field_sales_team_members` | ✅ | ✅ | 2 | 0 |
| `field_sales_teams` | ✅ | ✅ | 2 | 0 |
| `field_schedule_slots` | ✅ | ✅ | 1 | 0 |
| `field_settings` | ✅ | ✅ | 4 | 0 |
| `field_territories` | ✅ | ✅ | 4 | 12 |
| `field_territory_assignments` | ✅ | ✅ | 1 | 0 |
| `form_submissions` | ✅ | ✅ | 1 | 20 |
| `fs_badges` | ✅ | ✅ | 4 | 0 |
| `fs_battles` | ✅ | ✅ | 4 | 0 |
| `fs_challenge_participants` | ✅ | ✅ | 3 | 0 |
| `fs_challenges` | ✅ | ✅ | 4 | 0 |
| `fs_check_in_records` | ✅ | ✅ | 2 | 0 |
| `fs_commission_entries` | ✅ | ✅ | 4 | 36 |
| `fs_commission_rules` | ✅ | ✅ | 4 | 1 |
| `fs_field_sessions` | ✅ | ✅ | 3 | 0 |
| `fs_gps_points` | ✅ | ✅ | 2 | 0 |
| `fs_rep_badges` | ✅ | ✅ | 2 | 0 |
| `fs_rep_stat_snapshots` | ✅ | ✅ | 4 | 0 |
| `geofences` | ✅ | ✅ | 1 | 0 |
| `goals` | ✅ | ✅ | 3 | 0 |
| `gps_providers` | ✅ | ✅ | 1 | 0 |
| `incident_timeline` | ✅ | ✅ | 2 | 0 |
| `integration_audit_logs` | ✅ | ✅ | 4 | 4 |
| `integration_oauth_states` | ✅ | ✅ | 4 | 0 |
| `invitations` | ✅ | ✅ | 3 | 4 |
| `invoice_items` | ✅ | ✅ | 4 | 14 |
| `invoice_send_events` | ✅ | ✅ | 2 | 0 |
| `invoice_sequences` | ✅ | ✅ | 1 | 1 |
| `invoice_templates` | ✅ | ✅ | 4 | 6 |
| `invoices` | ✅ | ✅ | 4 | 13 |
| `ip_blocklist` | ✅ | ✅ | 4 | 0 |
| `job_agreements` | ✅ | ✅ | 4 | 4 |
| `job_billing_milestones` | ✅ | ✅ | 4 | ? |
| `job_checklists` | ✅ | ✅ | 1 | 0 |
| `job_intents` | ✅ | ✅ | 4 | 0 |
| `job_line_items` | ✅ | ✅ | 4 | 20 |
| `job_materials` | ✅ | ✅ | 3 | 0 |
| `job_recurrence_rules` | ✅ | ✅ | 1 | 0 |
| `job_templates` | ✅ | ✅ | 1 | 0 |
| `job_time_logs` | ✅ | ✅ | 1 | 1 |
| `jobs` | ✅ | ✅ | 4 | 34 |
| `lead_lists` | ✅ | ✅ | 1 | 0 |
| `lead_sources` | ✅ | ✅ | 4 | ? |
| `lists` | ✅ | ✅ | 1 | 0 |
| `location_tracking_settings` | ✅ | ✅ | 4 | 0 |
| `login_history` | ✅ | ✅ | 4 | 63 |
| `memberships` | ✅ | ✅ | 5 | 25 |
| `messages` | ✅ | ✅ | 4 | 46 |
| `mfa_phone` | ✅ | ✅ | 1 | 1 |
| `mfa_sms_challenges` | ✅ | ✅ | 1 | ? |
| `mfa_trusted_devices` | ✅ | ✅ | 1 | ? |
| `note_boards` | ✅ | ✅ | 4 | 0 |
| `note_connections` | ✅ | ✅ | 4 | 0 |
| `note_entity_links` | ✅ | ✅ | 3 | 0 |
| `note_history` | ✅ | ✅ | 2 | 0 |
| `note_items` | ✅ | ✅ | 4 | 0 |
| `notes` | ✅ | ✅ | 4 | 0 |
| `notes_checklist` | ✅ | ✅ | 4 | 0 |
| `notes_files` | ✅ | ✅ | 3 | 0 |
| `notes_tags` | ✅ | ✅ | 3 | 0 |
| `notifications` | ✅ | ✅ | 4 | 2 |
| `org_billing_settings` | ✅ | ✅ | 3 | 0 |
| `org_client_counters` | ✅ | ✅ | 1 | 21 |
| `org_features` | ✅ | ✅ | 3 | 9 |
| `org_invoice_sequences` | ✅ | ✅ | 1 | 12 |
| `org_job_counters` | ✅ | ✅ | 1 | 2 |
| `org_knowledge` | ✅ | ✅ | 1 | 0 |
| `orgs` | ✅ | ✅ | 4 | 30 |
| `payment_provider_secrets` | ✅ | ✅ | 4 | 1 |
| `payment_provider_settings` | ✅ | ✅ | 4 | 1 |
| `payment_providers` | ✅ | ✅ | 4 | 0 |
| `payment_requests` | ✅ | ✅ | 4 | 4 |
| `payment_requirements` | ✅ | ✅ | 3 | 1 |
| `payments` | ✅ | ✅ | 4 | 3 |
| `payroll_adjustments` | ✅ | ✅ | 1 | ? |
| `payroll_payments` | ✅ | ✅ | 1 | ? |
| `payroll_settings` | ✅ | ✅ | 4 | 0 |
| `pipeline_deals` | ✅ | ✅ | 4 | 121 |
| `pipelines` | ✅ | ✅ | 1 | 2 |
| `plans` | ✅ | ✅ | 1 | 3 |
| `predefined_services` | ✅ | ✅ | 4 | 13 |
| `processed_checkout_sessions` | ✅ | ✅ | 1 | 0 |
| `profiles` | ✅ | ✅ | 3 | 32 |
| `promo_codes` | ✅ | ✅ | 1 | 1 |
| `proof_of_presence` | ✅ | ✅ | 1 | 0 |
| `properties` | ✅ | ✅ | 4 | 50 |
| `provisioning_events` | ✅ | ✅ | 1 | 0 |
| `push_tokens` | ✅ | ✅ | 4 | 0 |
| `quote_attachments` | ✅ | ✅ | 4 | 1 |
| `quote_line_items` | ✅ | ✅ | 5 | 19 |
| `quote_measurements` | ✅ | ✅ | 4 | 0 |
| `quote_sections` | ✅ | ✅ | 4 | 9 |
| `quote_send_log` | ✅ | ✅ | 2 | 0 |
| `quote_sequences` | ✅ | ✅ | 1 | 1 |
| `quote_status_history` | ✅ | ✅ | 2 | 6 |
| `quote_templates` | ✅ | ✅ | 1 | 3 |
| `quote_views` | ✅ | ✅ | 5 | 0 |
| `quotes` | ✅ | ✅ | 4 | 16 |
| `rate_limits` | ✅ | ✅ | 2 | 0 |
| `recurring_invoice_schedules` | ✅ | ✅ | 2 | 0 |
| `recurring_team_schedules` | ✅ | ✅ | 4 | ? |
| `referrals` | ✅ | ✅ | 1 | 1 |
| `reminder_log` | ✅ | ✅ | 1 | 0 |
| `reminder_settings` | ✅ | ✅ | 2 | 0 |
| `request_forms` | ✅ | ✅ | 1 | 1 |
| `review_requests` | ✅ | ✅ | 2 | 0 |
| `role_templates` | ✅ | ✅ | 2 | ? |
| `satisfaction_surveys` | ✅ | ✅ | 2 | 7 |
| `scenario_options` | ✅ | ✅ | 2 | 4 |
| `scenario_runs` | ✅ | ✅ | 1 | 4 |
| `schedule_events` | ✅ | ✅ | 4 | 37 |
| `scheduled_reports` | ✅ | ✅ | 4 | 0 |
| `secret_rotation_log` | ✅ | ✅ | 1 | 0 |
| `security_alerts` | ✅ | ✅ | 4 | 0 |
| `security_canary_runs` | ✅ | ✅ | 0 | ? |
| `security_events` | ✅ | ✅ | 4 | 95 |
| `security_incidents` | ✅ | ✅ | 3 | 0 |
| `service_contracts` | ✅ | ✅ | 4 | 1 |
| `sms_opt_outs` | ✅ | ✅ | 2 | 0 |
| `specific_notes` | ✅ | ✅ | 4 | 6 |
| `subscriptions` | ✅ | ✅ | 2 | 7 |
| `tags` | ✅ | ✅ | 4 | 0 |
| `tasks` | ✅ | ✅ | 4 | 4 |
| `tax_configs` | ✅ | ✅ | 1 | 2 |
| `tax_group_items` | ✅ | ✅ | 1 | 2 |
| `tax_groups` | ✅ | ✅ | 1 | 5 |
| `team_assignments` | ✅ | ✅ | 2 | ? |
| `team_availability` | ✅ | ✅ | 4 | 0 |
| `team_capabilities` | ✅ | ✅ | 4 | 0 |
| `team_date_slots` | ✅ | ✅ | 4 | 0 |
| `team_members` | ✅ | ✅ | 4 | 6 |
| `team_schedule_assignments` | ✅ | ✅ | 4 | 4 |
| `team_schedule_audit` | ✅ | ✅ | 2 | 4 |
| `teams` | ✅ | ✅ | 4 | 5 |
| `technician_device_mappings` | ✅ | ✅ | 1 | 0 |
| `technician_locations` | ✅ | ✅ | 1 | 0 |
| `time_entries` | ✅ | ✅ | 4 | 8 |
| `time_off_requests` | ✅ | ✅ | 4 | ? |
| `tracking_events` | ✅ | ✅ | 2 | 371 |
| `tracking_live_locations` | ✅ | ✅ | 3 | 9 |
| `tracking_points` | ✅ | ✅ | 2 | 1851 |
| `tracking_sessions` | ✅ | ✅ | 3 | 148 |
| `user_agent_preferences` | ✅ | ✅ | 1 | 0 |
| `webhook_deliveries` | ✅ | ✅ | 1 | 0 |
| `webhook_endpoints` | ✅ | ✅ | 2 | 0 |
| `webhook_events` | ✅ | ✅ | 4 | 28 |
| `workflow_edges` | ✅ | ✅ | 1 | 0 |
| `workflow_logs` | ✅ | ✅ | 1 | 0 |
| `workflow_nodes` | ✅ | ✅ | 1 | 0 |
| `workflow_runs` | ✅ | ✅ | 4 | 0 |
| `workflows` | ✅ | ✅ | 4 | 31 |

## 2. Colonnes

### `a2p_registrations`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `legal_business_name` text
- `ein` text
- `business_type` text
- `vertical` text
- `street` text
- `city` text
- `region` text
- `postal_code` text
- `country` text DEFAULT 'US'::text
- `website` text
- `support_email` text
- `support_phone` text
- `use_case` text
- `campaign_description` text
- `message_samples` jsonb NOT NULL DEFAULT '[]'::jsonb
- `opt_in_keywords` text[] NOT NULL DEFAULT ARRAY[]::text[]
- `opt_in_message` text
- `opt_out_message` text DEFAULT 'Reply STOP to unsubscribe.'::text
- `has_embedded_links` boolean DEFAULT false
- `has_embedded_phone` boolean DEFAULT false
- `twilio_customer_profile_sid` text
- `twilio_brand_sid` text
- `twilio_campaign_sid` text
- `twilio_messaging_service_sid` text
- `brand_status` text NOT NULL DEFAULT 'not_started'::text
- `campaign_status` text NOT NULL DEFAULT 'not_started'::text
- `brand_error` text
- `campaign_error` text
- `last_checked_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `active_sessions`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `user_id` uuid NOT NULL
- `org_id` uuid NOT NULL
- `session_token_hash` text NOT NULL
- `device_fingerprint` text
- `ip_address` inet
- `user_agent` text
- `country_code` text
- `last_activity` timestamp with time zone DEFAULT now()
- `is_valid` boolean DEFAULT true
- `invalidated_reason` text
- `created_at` timestamp with time zone DEFAULT now()

### `activity_log`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `entity_type` text NOT NULL
- `entity_id` uuid NOT NULL
- `related_entity_type` text
- `related_entity_id` uuid
- `event_type` text NOT NULL
- `actor_id` uuid
- `metadata` jsonb NOT NULL DEFAULT '{}'::jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `activity_notes`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `entity_type` text NOT NULL
- `entity_id` uuid NOT NULL
- `body` text NOT NULL
- `actor_id` uuid
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone

### `agent_messages`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `session_id` uuid NOT NULL
- `role` text NOT NULL
- `content` text NOT NULL DEFAULT ''::text
- `message_type` text NOT NULL DEFAULT 'text'::text
- `structured_data` jsonb
- `model` text
- `tokens_in` integer DEFAULT 0
- `tokens_out` integer DEFAULT 0
- `duration_ms` integer DEFAULT 0
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `alert_rules`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `rule_type` text NOT NULL
- `enabled` boolean NOT NULL DEFAULT true
- `threshold_days` integer DEFAULT 30
- `threshold_count` integer DEFAULT 5
- `notify_email` boolean DEFAULT false
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `api_keys`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `created_by` uuid NOT NULL
- `name` text NOT NULL
- `key_hash` text NOT NULL
- `key_prefix` text NOT NULL
- `scopes` text[] NOT NULL DEFAULT ARRAY['read'::text]
- `rate_limit_per_minute` integer NOT NULL DEFAULT 60
- `last_used_at` timestamp with time zone
- `last_used_ip` inet
- `expires_at` timestamp with time zone
- `revoked` boolean DEFAULT false
- `revoked_at` timestamp with time zone
- `created_at` timestamp with time zone DEFAULT now()

### `app_connections`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `app_id` text NOT NULL
- `status` text NOT NULL DEFAULT 'not_connected'::text
- `credentials` jsonb NOT NULL DEFAULT '{}'::jsonb
- `connected_at` timestamp with time zone NOT NULL DEFAULT now()
- `last_tested` timestamp with time zone
- `error_message` text
- `connected_by` uuid
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `auth_type` text
- `connected_account_name` text
- `connected_account_id` text
- `scopes_granted` text[]
- `encrypted_access_token` text
- `encrypted_refresh_token` text
- `token_expires_at` timestamp with time zone
- `encrypted_credentials` jsonb DEFAULT '{}'::jsonb
- `last_test_result` text
- `last_error` text
- `disconnected_at` timestamp with time zone

### `applied_taxes`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `document_type` text NOT NULL
- `document_id` uuid NOT NULL
- `tax_config_id` uuid
- `name` text NOT NULL
- `rate` numeric(8,4) NOT NULL
- `amount_cents` integer NOT NULL DEFAULT 0
- `is_compound` boolean NOT NULL DEFAULT false
- `sort_order` integer NOT NULL DEFAULT 0
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `approvals`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `session_id` uuid NOT NULL
- `decision_log_id` uuid
- `action_type` text NOT NULL
- `action_params` jsonb NOT NULL DEFAULT '{}'::jsonb
- `status` text NOT NULL DEFAULT 'pending'::text
- `requested_at` timestamp with time zone NOT NULL DEFAULT now()
- `responded_at` timestamp with time zone
- `responded_by` uuid
- `expires_at` timestamp with time zone DEFAULT (now() + '01:00:00'::interval)

### `audit_events`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `actor_id` uuid
- `action` text
- `entity_type` text
- `entity_id` uuid
- `metadata` jsonb NOT NULL DEFAULT '{}'::jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `event_type` text
- `old_values` jsonb
- `new_values` jsonb
- `ip_address` inet
- `user_agent` text

### `automation_execution_logs`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `automation_rule_id` uuid
- `scheduled_task_id` uuid
- `trigger_event` text NOT NULL
- `entity_type` text NOT NULL
- `entity_id` uuid NOT NULL
- `action_type` text NOT NULL
- `action_config` jsonb NOT NULL DEFAULT '{}'::jsonb
- `result_success` boolean NOT NULL DEFAULT false
- `result_data` jsonb
- `result_error` text
- `duration_ms` integer DEFAULT 0
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `automation_rules`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `name` text NOT NULL
- `description` text DEFAULT ''::text
- `trigger_event` text NOT NULL
- `conditions` jsonb NOT NULL DEFAULT '{}'::jsonb
- `delay_seconds` integer NOT NULL DEFAULT 0
- `actions` jsonb NOT NULL DEFAULT '[]'::jsonb
- `is_active` boolean NOT NULL DEFAULT true
- `is_preset` boolean NOT NULL DEFAULT false
- `preset_key` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `automation_scheduled_tasks`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `automation_rule_id` uuid NOT NULL
- `entity_type` text NOT NULL
- `entity_id` uuid NOT NULL
- `action_config` jsonb NOT NULL DEFAULT '{}'::jsonb
- `execute_at` timestamp with time zone NOT NULL
- `status` text NOT NULL DEFAULT 'pending'::text
- `execution_key` text NOT NULL
- `attempts` integer NOT NULL DEFAULT 0
- `last_error` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `completed_at` timestamp with time zone

### `automations`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `name` text NOT NULL
- `trigger` text NOT NULL
- `delay_value` integer NOT NULL DEFAULT 0
- `delay_unit` text NOT NULL DEFAULT 'days'::text
- `message_template` text NOT NULL DEFAULT ''::text
- `active` boolean NOT NULL DEFAULT true
- `category` text NOT NULL DEFAULT 'follow_up'::text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `billing_profiles`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `billing_email` text
- `company_name` text
- `full_name` text
- `address` text
- `city` text
- `region` text
- `country` text DEFAULT 'CA'::text
- `postal_code` text
- `phone` text
- `currency` text NOT NULL DEFAULT 'CAD'::text
- `stripe_customer_id` text
- `tax_id` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `billing_receipt_log`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `subscription_id` uuid
- `recipient_email` text NOT NULL
- `email_type` text NOT NULL DEFAULT 'payment_receipt'::text
- `stripe_payment_intent_id` text
- `stripe_checkout_session_id` text
- `stripe_invoice_id` text
- `amount_cents` integer NOT NULL DEFAULT 0
- `currency` text NOT NULL DEFAULT 'CAD'::text
- `plan_name` text
- `status` text NOT NULL DEFAULT 'pending'::text
- `error_message` text
- `message_id` text
- `sent_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `board_comments`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `board_id` uuid NOT NULL
- `item_id` uuid
- `parent_id` uuid
- `user_id` uuid NOT NULL
- `user_name` text NOT NULL DEFAULT ''::text
- `content` text NOT NULL DEFAULT ''::text
- `resolved` boolean NOT NULL DEFAULT false
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `board_drawings`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `board_id` uuid NOT NULL
- `created_by` uuid NOT NULL
- `path_data` text NOT NULL DEFAULT ''::text
- `color` text NOT NULL DEFAULT '#000000'::text
- `stroke_width` real NOT NULL DEFAULT 3
- `opacity` real NOT NULL DEFAULT 1
- `tool` text NOT NULL DEFAULT 'pen'::text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `board_votes`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `board_id` uuid NOT NULL
- `item_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `user_name` text NOT NULL DEFAULT ''::text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `booking_pages`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `slug` text NOT NULL
- `title` text NOT NULL
- `description` text
- `service_type` text
- `duration_minutes` integer NOT NULL DEFAULT 60
- `buffer_minutes` integer NOT NULL DEFAULT 15
- `availability` jsonb NOT NULL DEFAULT '{}'::jsonb
- `advance_notice_hours` integer NOT NULL DEFAULT 24
- `max_days_ahead` integer NOT NULL DEFAULT 30
- `is_active` boolean NOT NULL DEFAULT true
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `bookings`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `booking_page_id` uuid
- `customer_first_name` text NOT NULL
- `customer_last_name` text NOT NULL
- `customer_email` text NOT NULL
- `customer_phone` text
- `service_address` text
- `notes` text
- `scheduled_at` timestamp with time zone NOT NULL
- `duration_minutes` integer NOT NULL
- `status` text NOT NULL DEFAULT 'pending'::text
- `lead_id` uuid
- `job_id` uuid
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `checklist_templates`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `name` text NOT NULL
- `description` text
- `job_type` text
- `items` jsonb NOT NULL DEFAULT '[]'::jsonb
- `is_active` boolean NOT NULL DEFAULT true
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `client_tags`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `client_id` uuid NOT NULL
- `tag` text NOT NULL
- `created_at` timestamp with time zone DEFAULT now()

### `clients`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL DEFAULT current_org_id()
- `first_name` text
- `last_name` text
- `company` text
- `email` text
- `phone` text
- `address` text
- `status` text NOT NULL DEFAULT 'active'::text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone
- `contact_id` uuid
- `created_by` uuid DEFAULT auth.uid()
- `deleted_by` uuid
- `fts_vector` tsvector
- `notes` text
- `archived_at` timestamp with time zone
- `archived_by` uuid
- `portal_token` text DEFAULT (gen_random_uuid())::text
- `email_blind` text
- `phone_blind` text
- `portal_token_hash` text
- `portal_token_expires_at` timestamp with time zone
- `portal_token_revoked_at` timestamp with time zone
- `sms_consent_at` timestamp with time zone
- `email_consent_at` timestamp with time zone
- `email_opt_out_at` timestamp with time zone
- `email_opt_out_reason` text
- `city` text
- `province` text
- `postal_code` text
- `last_client_activity_at` timestamp with time zone
- `display_as_company` boolean NOT NULL DEFAULT false
- `billing_same_as_service` boolean NOT NULL DEFAULT true
- `billing_address` text
- `lead_status` text
- `source` text
- `title` text
- `user_id` uuid
- `assigned_to` uuid
- `assigned_team` text
- `value` numeric(12,2) DEFAULT 0
- `tags` text[] DEFAULT '{}'::text[]
- `schedule` jsonb
- `line_items` jsonb DEFAULT '[]'::jsonb
- `description` text
- `phones` jsonb NOT NULL DEFAULT '[]'::jsonb
- `email_label` text NOT NULL DEFAULT 'main'::text
- `lead_source` text
- `tax_ids` uuid[]
- `street_number` text
- `street_name` text
- `country` text
- `latitude` numeric
- `longitude` numeric
- `place_id` text
- `client_number` text
- `tax_exempt` boolean NOT NULL DEFAULT false
- `version` integer NOT NULL DEFAULT 1

### `commission_settings`

- `org_id` uuid NOT NULL
- `reversal_policy` text NOT NULL DEFAULT 'alert'::text
- `default_rule_id` uuid
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `communication_channels`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid
- `channel_type` text NOT NULL
- `provider` text NOT NULL DEFAULT 'twilio'::text
- `phone_number` text
- `email_address` text
- `is_default` boolean NOT NULL DEFAULT false
- `status` text NOT NULL DEFAULT 'active'::text
- `metadata` jsonb DEFAULT '{}'::jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `communication_messages`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid
- `client_id` uuid
- `job_id` uuid
- `channel_type` text NOT NULL
- `direction` text NOT NULL DEFAULT 'outbound'::text
- `provider` text
- `channel_id` uuid
- `from_value` text
- `to_value` text
- `subject` text
- `body_text` text
- `body_html` text
- `template_key` text
- `status` text NOT NULL DEFAULT 'queued'::text
- `sent_at` timestamp with time zone
- `delivered_at` timestamp with time zone
- `failed_at` timestamp with time zone
- `provider_message_id` text
- `error_message` text
- `metadata` jsonb DEFAULT '{}'::jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `communication_settings`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `sms_enabled` boolean NOT NULL DEFAULT false
- `email_enabled` boolean NOT NULL DEFAULT true
- `sms_two_way_enabled` boolean NOT NULL DEFAULT false
- `default_sms_channel_id` uuid
- `booking_confirmation_sms_enabled` boolean NOT NULL DEFAULT false
- `booking_confirmation_email_enabled` boolean NOT NULL DEFAULT true
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `company_operating_profile`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `industry_type` text NOT NULL DEFAULT 'general'::text
- `avg_job_duration_minutes` integer NOT NULL DEFAULT 120
- `avg_jobs_per_day` integer NOT NULL DEFAULT 4
- `max_travel_radius_km` numeric NOT NULL DEFAULT 50
- `weight_proximity` numeric NOT NULL DEFAULT 0.3
- `weight_team_availability` numeric NOT NULL DEFAULT 0.25
- `weight_value` numeric NOT NULL DEFAULT 0.25
- `weight_recency` numeric NOT NULL DEFAULT 0.2
- `preferred_reknock_delay_days` integer NOT NULL DEFAULT 7
- `scheduling_pattern_type` text NOT NULL DEFAULT 'clustered'::text
- `peak_hours_start` time without time zone NOT NULL DEFAULT '09:00:00'::time without time zone
- `peak_hours_end` time without time zone NOT NULL DEFAULT '17:00:00'::time without time zone
- `operating_days` integer[] NOT NULL DEFAULT '{1,2,3,4,5}'::integer[]
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `company_settings`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `created_by` uuid
- `company_name` text NOT NULL DEFAULT ''::text
- `phone` text NOT NULL DEFAULT ''::text
- `website` text NOT NULL DEFAULT ''::text
- `email` text NOT NULL DEFAULT ''::text
- `street1` text NOT NULL DEFAULT ''::text
- `street2` text NOT NULL DEFAULT ''::text
- `city` text NOT NULL DEFAULT ''::text
- `province` text NOT NULL DEFAULT ''::text
- `postal_code` text NOT NULL DEFAULT ''::text
- `country` text NOT NULL DEFAULT ''::text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `logo_url` text
- `google_review_url` text
- `review_enabled` boolean NOT NULL DEFAULT false
- `review_template_id` uuid
- `review_widget_settings` jsonb NOT NULL DEFAULT '{"theme": "light", "filter": "all", "layout": "cards", "max_display": 6}'::jsonb
- `primary_color` text DEFAULT '#1a1a2e'::text
- `secondary_color` text DEFAULT '#6b7280'::text
- `quote_footer_text` text DEFAULT ''::text
- `job_footer_text` text DEFAULT ''::text
- `default_quote_layout` text DEFAULT 'minimal_pro'::text
- `default_invoice_layout` text DEFAULT 'clean_billing'::text
- `default_tax_group_id` uuid
- `industry` text
- `default_unit` text
- `setup_completed` boolean NOT NULL DEFAULT false
- `revenue_goal_cents` integer NOT NULL DEFAULT 0
- `invoice_prefix` text NOT NULL DEFAULT ''::text
- `currency` text NOT NULL DEFAULT 'CAD'::text
- `timezone` text NOT NULL DEFAULT 'America/Toronto'::text

### `confidence_calibration`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `domain` text NOT NULL
- `total_predictions` integer NOT NULL DEFAULT 0
- `correct_predictions` integer NOT NULL DEFAULT 0
- `avg_predicted_conf` numeric(5,2) DEFAULT 0
- `avg_actual_success` numeric(5,2) DEFAULT 0
- `calibration_factor` numeric(5,3) DEFAULT 1.0
- `bucket_0_20` integer DEFAULT 0
- `bucket_0_20_correct` integer DEFAULT 0
- `bucket_20_40` integer DEFAULT 0
- `bucket_20_40_correct` integer DEFAULT 0
- `bucket_40_60` integer DEFAULT 0
- `bucket_40_60_correct` integer DEFAULT 0
- `bucket_60_80` integer DEFAULT 0
- `bucket_60_80_correct` integer DEFAULT 0
- `bucket_80_100` integer DEFAULT 0
- `bucket_80_100_correct` integer DEFAULT 0
- `last_recalculated_at` timestamp with time zone NOT NULL DEFAULT now()

### `connected_accounts`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `stripe_account_id` text NOT NULL
- `account_type` text NOT NULL DEFAULT 'express'::text
- `onboarding_complete` boolean NOT NULL DEFAULT false
- `charges_enabled` boolean NOT NULL DEFAULT false
- `payouts_enabled` boolean NOT NULL DEFAULT false
- `details_submitted` boolean NOT NULL DEFAULT false
- `country` text
- `default_currency` text NOT NULL DEFAULT 'CAD'::text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone

### `consents`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `subject_type` text NOT NULL
- `subject_id` uuid NOT NULL
- `purpose` text NOT NULL
- `granted` boolean NOT NULL
- `doc_version` text
- `doc_url` text
- `ip_address` inet
- `user_agent` text
- `method` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `contacts`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `full_name` text
- `email` text
- `phone` text
- `address_line1` text
- `address_line2` text
- `city` text
- `province` text
- `postal_code` text
- `country` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `conversations`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `client_id` uuid
- `phone_number` text NOT NULL
- `client_name` text
- `last_message_text` text
- `last_message_at` timestamp with time zone DEFAULT now()
- `unread_count` integer DEFAULT 0
- `status` text DEFAULT 'active'::text
- `created_at` timestamp with time zone DEFAULT now()
- `updated_at` timestamp with time zone DEFAULT now()

### `course_assignments`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `course_id` uuid NOT NULL
- `user_id` uuid
- `team_id` uuid
- `assigned_at` timestamp with time zone NOT NULL DEFAULT now()
- `assigned_by` uuid

### `course_lessons`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `module_id` uuid NOT NULL
- `title` text NOT NULL DEFAULT ''::text
- `content_type` text NOT NULL DEFAULT 'video'::text
- `video_url` text
- `embed_url` text
- `text_content` text
- `attachments` jsonb NOT NULL DEFAULT '[]'::jsonb
- `duration_min` integer NOT NULL DEFAULT 0
- `sort_order` integer NOT NULL DEFAULT 0
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `course_modules`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `course_id` uuid NOT NULL
- `title` text NOT NULL DEFAULT ''::text
- `sort_order` integer NOT NULL DEFAULT 0
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `course_progress`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `user_id` uuid NOT NULL
- `course_id` uuid NOT NULL
- `lesson_id` uuid NOT NULL
- `completed` boolean NOT NULL DEFAULT false
- `completed_at` timestamp with time zone
- `last_viewed` timestamp with time zone NOT NULL DEFAULT now()

### `courses`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `title` text NOT NULL DEFAULT ''::text
- `description` text NOT NULL DEFAULT ''::text
- `cover_image` text
- `status` text NOT NULL DEFAULT 'draft'::text
- `created_by` uuid
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone
- `target_roles` jsonb NOT NULL DEFAULT '[]'::jsonb
- `target_user_ids` jsonb NOT NULL DEFAULT '[]'::jsonb
- `category` text NOT NULL DEFAULT ''::text
- `visibility` text NOT NULL DEFAULT 'all'::text

### `custom_column_values`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `column_id` uuid NOT NULL
- `record_id` uuid NOT NULL
- `value_text` text
- `value_number` numeric
- `value_boolean` boolean
- `value_date` date
- `value_json` jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `custom_columns`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `entity` text NOT NULL
- `name` text NOT NULL
- `col_type` text NOT NULL
- `config` jsonb NOT NULL DEFAULT '{}'::jsonb
- `position` integer NOT NULL DEFAULT 0
- `visible` boolean NOT NULL DEFAULT true
- `required` boolean NOT NULL DEFAULT false
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone

### `data_export_log`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `export_type` text NOT NULL
- `entity_type` text NOT NULL
- `record_count` integer NOT NULL DEFAULT 0
- `ip_address` inet
- `user_agent` text
- `watermark` text NOT NULL DEFAULT encode(gen_random_bytes(8), 'hex'::text)
- `created_at` timestamp with time zone DEFAULT now()

### `dead_letters`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `source` text NOT NULL
- `payload` jsonb NOT NULL
- `error_msg` text NOT NULL
- `attempts` integer NOT NULL DEFAULT 1
- `first_seen_at` timestamp with time zone NOT NULL DEFAULT now()
- `last_seen_at` timestamp with time zone NOT NULL DEFAULT now()
- `resolved_at` timestamp with time zone

### `decision_logs`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `session_id` uuid NOT NULL
- `decision_type` text NOT NULL
- `input_summary` text
- `chosen_option` text
- `confidence` numeric(4,2)
- `reasoning` text
- `approved_by` uuid
- `approved_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `decision_outcomes`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `decision_log_id` uuid
- `session_id` uuid
- `message_id` uuid
- `domain` text
- `action_type` text
- `confidence` numeric(5,2)
- `outcome` text NOT NULL DEFAULT 'pending'::text
- `outcome_score` numeric(5,2)
- `outcome_note` text
- `revenue_impact_cents` bigint DEFAULT 0
- `time_saved_minutes` integer DEFAULT 0
- `user_id` uuid
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `resolved_at` timestamp with time zone

### `demo_requests`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `full_name` text NOT NULL
- `company_name` text NOT NULL
- `email` text NOT NULL
- `phone` text NOT NULL
- `industry` text NOT NULL
- `employee_count` text
- `source` text
- `availability` text
- `message` text
- `status` text NOT NULL DEFAULT 'new'::text
- `notes` text
- `contacted_at` timestamp with time zone
- `converted_at` timestamp with time zone
- `converted_user_id` uuid
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `ip_address` text
- `user_agent` text

### `dsar_requests`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `subject_type` text NOT NULL
- `subject_id` uuid NOT NULL
- `request_type` text NOT NULL
- `status` text NOT NULL DEFAULT 'pending'::text
- `requested_by` uuid
- `requester_ip` inet
- `justification` text
- `response_url` text
- `completed_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `email_accounts`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `provider` text NOT NULL
- `email_address` text NOT NULL
- `encrypted_access_token` text
- `encrypted_refresh_token` text
- `token_expires_at` timestamp with time zone
- `history_id` text
- `delta_link` text
- `scopes` text[] NOT NULL DEFAULT '{}'::text[]
- `status` text NOT NULL DEFAULT 'connected'::text
- `last_error` text
- `last_synced_at` timestamp with time zone
- `connected_at` timestamp with time zone NOT NULL DEFAULT now()
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `email_campaign_recipients`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `campaign_id` uuid NOT NULL
- `org_id` uuid NOT NULL
- `client_id` uuid
- `email` text NOT NULL
- `status` text NOT NULL DEFAULT 'pending'::text
- `error_message` text
- `opened_at` timestamp with time zone
- `clicked_at` timestamp with time zone
- `sent_at` timestamp with time zone

### `email_campaigns`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `created_by` uuid
- `name` text NOT NULL
- `subject` text NOT NULL
- `body_html` text NOT NULL
- `body_text` text
- `segment` text NOT NULL DEFAULT 'all_clients'::text
- `custom_query` jsonb
- `status` text NOT NULL DEFAULT 'draft'::text
- `scheduled_at` timestamp with time zone
- `sent_at` timestamp with time zone
- `total_recipients` integer DEFAULT 0
- `total_sent` integer DEFAULT 0
- `total_failed` integer DEFAULT 0
- `total_bounced` integer DEFAULT 0
- `total_opened` integer DEFAULT 0
- `total_clicked` integer DEFAULT 0
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `email_messages`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `thread_id` uuid NOT NULL
- `account_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `provider_message_id` text NOT NULL
- `from_name` text
- `from_email` text
- `to_emails` text[] NOT NULL DEFAULT '{}'::text[]
- `cc_emails` text[] NOT NULL DEFAULT '{}'::text[]
- `subject` text
- `snippet` text
- `body_html` text
- `body_text` text
- `direction` text NOT NULL DEFAULT 'inbound'::text
- `is_read` boolean NOT NULL DEFAULT false
- `has_attachments` boolean NOT NULL DEFAULT false
- `attachments` jsonb NOT NULL DEFAULT '[]'::jsonb
- `sent_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `rfc_message_id` text

### `email_oauth_states`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `provider` text NOT NULL
- `state` text NOT NULL
- `redirect_uri` text NOT NULL
- `code_verifier` text
- `consumed_at` timestamp with time zone
- `expires_at` timestamp with time zone NOT NULL DEFAULT (now() + '00:15:00'::interval)
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `email_opt_outs`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `email` text NOT NULL
- `opted_out_at` timestamp with time zone NOT NULL DEFAULT now()
- `reason` text

### `email_templates`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `created_by` uuid
- `name` text NOT NULL
- `type` text NOT NULL DEFAULT 'generic'::text
- `subject` text NOT NULL DEFAULT ''::text
- `body` text NOT NULL DEFAULT ''::text
- `variables` jsonb NOT NULL DEFAULT '[]'::jsonb
- `is_active` boolean NOT NULL DEFAULT true
- `is_default` boolean NOT NULL DEFAULT false
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `email_threads`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `account_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `org_id` uuid NOT NULL
- `provider_thread_id` text NOT NULL
- `subject` text
- `snippet` text
- `last_message_at` timestamp with time zone
- `is_read` boolean NOT NULL DEFAULT false
- `has_attachments` boolean NOT NULL DEFAULT false
- `message_count` integer NOT NULL DEFAULT 0
- `folder` text NOT NULL DEFAULT 'inbox'::text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `from_name` text
- `from_email` text

### `failed_login_attempts`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `email` text
- `ip_address` inet
- `user_agent` text
- `reason` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `few_shot_examples`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `domain` text NOT NULL
- `user_message` text NOT NULL
- `agent_response` text NOT NULL
- `source` text NOT NULL DEFAULT 'thumbs_up'::text
- `quality_score` numeric(5,2) NOT NULL DEFAULT 5.0
- `feedback_type` text DEFAULT 'positive'::text
- `original_message_id` uuid
- `original_session_id` uuid
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `last_used_at` timestamp with time zone
- `use_count` integer DEFAULT 0
- `is_active` boolean DEFAULT true

### `field_daily_stats`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `date` date NOT NULL
- `knocks` integer DEFAULT 0
- `no_answers` integer DEFAULT 0
- `leads` integer DEFAULT 0
- `quotes_sent` integer DEFAULT 0
- `sales` integer DEFAULT 0
- `callbacks` integer DEFAULT 0
- `conversion_rate` numeric(5,2) DEFAULT 0
- `revenue_cents` bigint DEFAULT 0
- `created_at` timestamp with time zone DEFAULT now()

### `field_house_events`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `house_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `event_type` text NOT NULL
- `note_text` text
- `note_voice_url` text
- `ai_summary` text
- `metadata` jsonb DEFAULT '{}'::jsonb
- `created_at` timestamp with time zone DEFAULT now()

### `field_house_profiles`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `address` text NOT NULL
- `address_normalized` text
- `lat` double precision
- `lng` double precision
- `place_id` text
- `current_status` text NOT NULL DEFAULT 'unknown'::text
- `house_score` text DEFAULT 'cold'::text
- `territory_id` uuid
- `assigned_user_id` uuid
- `lead_id` uuid
- `client_id` uuid
- `next_action` text
- `next_action_date` timestamp with time zone
- `visit_count` integer DEFAULT 0
- `last_activity_at` timestamp with time zone
- `metadata` jsonb DEFAULT '{}'::jsonb
- `created_at` timestamp with time zone DEFAULT now()
- `updated_at` timestamp with time zone DEFAULT now()
- `deleted_at` timestamp with time zone
- `reknock_priority_score` numeric NOT NULL DEFAULT 0
- `fatigue_score` numeric NOT NULL DEFAULT 0
- `ai_next_action` text
- `ai_score_explanation` text
- `quote_id` uuid
- `job_id` uuid
- `last_scored_at` timestamp with time zone
- `closed_by_user_id` uuid
- `closed_by_role` text
- `closed_at` timestamp with time zone
- `invoice_id` uuid

### `field_pin_entity_links`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `house_id` uuid NOT NULL
- `entity_type` text NOT NULL
- `entity_id` uuid NOT NULL
- `linked_at` timestamp with time zone NOT NULL DEFAULT now()

### `field_pin_templates`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `label` text NOT NULL
- `icon` text DEFAULT 'pin'::text
- `color` text DEFAULT '#6b7280'::text
- `affects_stats` boolean DEFAULT true
- `sort_order` integer DEFAULT 0
- `created_at` timestamp with time zone DEFAULT now()

### `field_pins`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `house_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `status` text NOT NULL
- `has_note` boolean DEFAULT false
- `priority` integer DEFAULT 0
- `pin_color` text
- `pin_icon` text
- `created_at` timestamp with time zone DEFAULT now()
- `updated_at` timestamp with time zone DEFAULT now()

### `field_rep_performance`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `territory_id` uuid
- `period_start` date NOT NULL
- `period_end` date NOT NULL
- `total_knocks` integer NOT NULL DEFAULT 0
- `total_leads` integer NOT NULL DEFAULT 0
- `total_sales` integer NOT NULL DEFAULT 0
- `total_callbacks` integer NOT NULL DEFAULT 0
- `total_no_answer` integer NOT NULL DEFAULT 0
- `close_rate` numeric NOT NULL DEFAULT 0
- `avg_knocks_per_day` numeric NOT NULL DEFAULT 0
- `revenue_cents` bigint NOT NULL DEFAULT 0
- `computed_at` timestamp with time zone NOT NULL DEFAULT now()

### `field_sales_reps`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `display_name` text NOT NULL
- `avatar_url` text
- `role` text NOT NULL DEFAULT 'sales_rep'::text
- `is_active` boolean NOT NULL DEFAULT true
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `field_sales_team_members`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `team_id` uuid NOT NULL
- `rep_id` uuid NOT NULL
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `field_sales_teams`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `name` text NOT NULL
- `leader_id` uuid
- `color` text DEFAULT '#6366f1'::text
- `is_active` boolean NOT NULL DEFAULT true
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `field_schedule_slots`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid
- `slot_date` date NOT NULL
- `start_time` timestamp with time zone NOT NULL
- `end_time` timestamp with time zone NOT NULL
- `score` numeric NOT NULL DEFAULT 0
- `explanation` text NOT NULL DEFAULT ''::text
- `nearby_jobs` integer NOT NULL DEFAULT 0
- `nearby_pins` integer NOT NULL DEFAULT 0
- `is_peak_hour` boolean NOT NULL DEFAULT false
- `computed_at` timestamp with time zone NOT NULL DEFAULT now()

### `field_settings`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `feature_enabled` boolean DEFAULT false
- `territory_restriction_enabled` boolean DEFAULT false
- `auto_revisit_days` integer DEFAULT 3
- `auto_followup_days` integer DEFAULT 1
- `voice_notes_enabled` boolean DEFAULT true
- `ai_summaries_enabled` boolean DEFAULT false
- `default_pin_template_id` uuid
- `automation_defaults` jsonb DEFAULT '{}'::jsonb
- `created_at` timestamp with time zone DEFAULT now()
- `updated_at` timestamp with time zone DEFAULT now()
- `show_peer_payouts` boolean NOT NULL DEFAULT true

### `field_territories`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `name` text NOT NULL
- `color` text DEFAULT '#6366f1'::text
- `polygon_geojson` jsonb NOT NULL
- `assigned_team_id` uuid
- `assigned_user_id` uuid
- `is_exclusive` boolean DEFAULT false
- `stats_knocks` integer DEFAULT 0
- `stats_leads` integer DEFAULT 0
- `stats_sales` integer DEFAULT 0
- `created_at` timestamp with time zone DEFAULT now()
- `updated_at` timestamp with time zone DEFAULT now()
- `deleted_at` timestamp with time zone
- `assigned_rep_id` uuid
- `notes` text
- `is_active` boolean NOT NULL DEFAULT true
- `coverage_percent` numeric NOT NULL DEFAULT 0
- `territory_score` numeric NOT NULL DEFAULT 0
- `fatigue_score` numeric NOT NULL DEFAULT 0
- `total_pins` integer NOT NULL DEFAULT 0
- `active_leads` integer NOT NULL DEFAULT 0
- `close_rate` numeric NOT NULL DEFAULT 0
- `last_scored_at` timestamp with time zone

### `field_territory_assignments`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `territory_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `assigned_at` timestamp with time zone NOT NULL DEFAULT now()
- `unassigned_at` timestamp with time zone
- `performance_score` numeric NOT NULL DEFAULT 0
- `knocks_during` integer NOT NULL DEFAULT 0
- `leads_during` integer NOT NULL DEFAULT 0
- `sales_during` integer NOT NULL DEFAULT 0
- `close_rate` numeric NOT NULL DEFAULT 0
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `form_submissions`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `form_id` uuid NOT NULL
- `first_name` text NOT NULL
- `last_name` text NOT NULL
- `company` text
- `email` text NOT NULL
- `phone` text NOT NULL
- `street_address` text
- `unit` text
- `city` text
- `country` text
- `region` text
- `postal_code` text
- `custom_responses` jsonb NOT NULL DEFAULT '{}'::jsonb
- `notes` text
- `lead_id` uuid
- `deal_id` uuid
- `client_id` uuid
- `ip_address` text
- `user_agent` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `assessment_start_at` timestamp with time zone
- `assessment_end_at` timestamp with time zone
- `assessment_team_id` uuid
- `assessment_user_id` uuid
- `assessment_instructions` text
- `archived_at` timestamp with time zone
- `deleted_at` timestamp with time zone

### `fs_badges`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `slug` text NOT NULL
- `name_en` text NOT NULL
- `name_fr` text NOT NULL
- `description_en` text
- `description_fr` text
- `icon` text
- `color` text
- `category` text
- `criteria` jsonb DEFAULT '{}'::jsonb
- `is_active` boolean NOT NULL DEFAULT true
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone

### `fs_battles`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `created_by` uuid NOT NULL
- `name` text NOT NULL
- `type` text NOT NULL
- `metric_slug` text NOT NULL
- `challenger_user_id` uuid
- `challenger_team_id` uuid
- `opponent_user_id` uuid
- `opponent_team_id` uuid
- `challenger_score` numeric NOT NULL DEFAULT 0
- `opponent_score` numeric NOT NULL DEFAULT 0
- `start_date` date NOT NULL
- `end_date` date NOT NULL
- `status` text NOT NULL DEFAULT 'pending'::text
- `winner_user_id` uuid
- `winner_team_id` uuid
- `prize_description` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone

### `fs_challenge_participants`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `challenge_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `current_value` numeric NOT NULL DEFAULT 0
- `completed_at` timestamp with time zone
- `joined_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `fs_challenges`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `created_by` uuid NOT NULL
- `name_en` text NOT NULL
- `name_fr` text NOT NULL
- `description_en` text
- `description_fr` text
- `type` text NOT NULL
- `metric_slug` text NOT NULL
- `target_value` numeric
- `start_date` date NOT NULL
- `end_date` date NOT NULL
- `status` text NOT NULL DEFAULT 'active'::text
- `prize_description` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone

### `fs_check_in_records`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `session_id` uuid
- `type` text NOT NULL
- `lat` double precision NOT NULL
- `lng` double precision NOT NULL
- `accuracy` numeric
- `photo_url` text
- `notes` text
- `recorded_at` timestamp with time zone NOT NULL DEFAULT now()
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `fs_commission_entries`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `rule_id` uuid NOT NULL
- `lead_id` uuid
- `job_id` uuid
- `status` text NOT NULL DEFAULT 'pending'::text
- `amount` numeric NOT NULL
- `base_amount` numeric NOT NULL DEFAULT 0
- `description` text
- `approved_by` uuid
- `approved_at` timestamp with time zone
- `paid_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone
- `invoice_id` uuid
- `triggered_at` timestamp with time zone NOT NULL DEFAULT now()
- `auto_reversed` boolean NOT NULL DEFAULT false
- `reverse_reason` text
- `calc_breakdown` jsonb

### `fs_commission_rules`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `name` text NOT NULL
- `description` text
- `type` text NOT NULL
- `flat_amount` numeric
- `percentage` numeric
- `tiers` jsonb DEFAULT '[]'::jsonb
- `applies_to_role` text
- `applies_to_user_id` uuid
- `is_active` boolean NOT NULL DEFAULT true
- `priority` integer NOT NULL DEFAULT 0
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone
- `base_kind` text
- `base_percent` numeric
- `base_value_cents` integer
- `product_overrides` jsonb NOT NULL DEFAULT '[]'::jsonb
- `performance_tiers` jsonb NOT NULL DEFAULT '[]'::jsonb
- `bonuses` jsonb NOT NULL DEFAULT '[]'::jsonb
- `attribution` jsonb NOT NULL DEFAULT '{"mode": "solo"}'::jsonb
- `assigned_user_ids` uuid[] NOT NULL DEFAULT '{}'::uuid[]

### `fs_field_sessions`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `territory_id` uuid
- `status` text NOT NULL DEFAULT 'active'::text
- `started_at` timestamp with time zone NOT NULL DEFAULT now()
- `paused_at` timestamp with time zone
- `completed_at` timestamp with time zone
- `total_duration_minutes` integer
- `doors_knocked` integer NOT NULL DEFAULT 0
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `fs_gps_points`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `session_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `lat` double precision NOT NULL
- `lng` double precision NOT NULL
- `accuracy` numeric
- `altitude` numeric
- `speed` numeric
- `heading` numeric
- `recorded_at` timestamp with time zone NOT NULL DEFAULT now()
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `fs_rep_badges`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `badge_id` uuid NOT NULL
- `earned_at` timestamp with time zone NOT NULL DEFAULT now()
- `metadata` jsonb DEFAULT '{}'::jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `fs_rep_stat_snapshots`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `period` text NOT NULL
- `period_start` date NOT NULL
- `period_end` date NOT NULL
- `doors_knocked` integer NOT NULL DEFAULT 0
- `conversations` integer NOT NULL DEFAULT 0
- `demos_set` integer NOT NULL DEFAULT 0
- `demos_held` integer NOT NULL DEFAULT 0
- `quotes_sent` integer NOT NULL DEFAULT 0
- `closes` integer NOT NULL DEFAULT 0
- `revenue` numeric NOT NULL DEFAULT 0
- `follow_ups_completed` integer NOT NULL DEFAULT 0
- `conversion_rate` numeric NOT NULL DEFAULT 0
- `average_ticket` numeric NOT NULL DEFAULT 0
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `geofences`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `name` text NOT NULL
- `latitude` double precision NOT NULL
- `longitude` double precision NOT NULL
- `radius_m` integer NOT NULL DEFAULT 100
- `job_id` uuid
- `active` boolean NOT NULL DEFAULT true
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `goals`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `created_by` uuid
- `metric` text NOT NULL
- `target_value` bigint NOT NULL
- `period` text NOT NULL DEFAULT 'monthly'::text
- `start_date` date NOT NULL
- `end_date` date NOT NULL
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `gps_providers`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `provider` text NOT NULL
- `active` boolean NOT NULL DEFAULT true
- `config` jsonb NOT NULL DEFAULT '{}'::jsonb
- `last_sync` timestamp with time zone
- `sync_status` text
- `error_msg` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `incident_timeline`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `incident_id` uuid NOT NULL
- `actor_id` uuid
- `event_type` text NOT NULL
- `payload` jsonb DEFAULT '{}'::jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `integration_audit_logs`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `connection_id` uuid
- `app_id` text NOT NULL
- `user_id` uuid
- `action` text NOT NULL
- `status` text
- `message` text
- `metadata` jsonb DEFAULT '{}'::jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `integration_oauth_states`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `app_id` text NOT NULL
- `state` text NOT NULL
- `code_verifier` text
- `redirect_uri` text NOT NULL
- `expires_at` timestamp with time zone NOT NULL DEFAULT (now() + '00:10:00'::interval)
- `consumed_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `invitations`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `email` text NOT NULL
- `role` text NOT NULL DEFAULT 'technician'::text
- `token` text
- `token_hash` text
- `scope` text NOT NULL DEFAULT 'self'::text
- `team_id` uuid
- `department_id` uuid
- `custom_permissions` jsonb NOT NULL DEFAULT '{}'::jsonb
- `invited_by` uuid NOT NULL
- `status` text NOT NULL DEFAULT 'pending'::text
- `expires_at` timestamp with time zone NOT NULL DEFAULT (now() + '7 days'::interval)
- `accepted_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `invoice_items`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL DEFAULT current_org_id()
- `invoice_id` uuid NOT NULL
- `description` text NOT NULL
- `qty` numeric(12,2) NOT NULL DEFAULT 1
- `unit_price_cents` integer NOT NULL DEFAULT 0
- `line_total_cents` integer NOT NULL DEFAULT 0
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `amount` numeric
- `deleted_at` timestamp with time zone
- `sort_order` integer NOT NULL DEFAULT 0
- `source_type` text
- `source_id` uuid
- `title` text
- `version` integer NOT NULL DEFAULT 1

### `invoice_send_events`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `invoice_id` uuid NOT NULL
- `org_id` uuid NOT NULL
- `event_type` text NOT NULL DEFAULT 'sent'::text
- `recipient_email` text
- `recipient_phone` text
- `channel` text
- `metadata` jsonb DEFAULT '{}'::jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `invoice_sequences`

- `org_id` uuid NOT NULL
- `last_value` integer NOT NULL DEFAULT 0
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `invoice_templates`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid
- `name` text NOT NULL
- `content` jsonb NOT NULL DEFAULT '{}'::jsonb
- `is_default` boolean NOT NULL DEFAULT false
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone
- `template_type` text DEFAULT 'standard'::text
- `locale` text DEFAULT 'fr-CA'::text
- `currency` text DEFAULT 'CAD'::text
- `tax_config` jsonb DEFAULT '{"tps_rate": 5.0, "tvq_rate": 9.975, "tps_number": "", "tvq_number": ""}'::jsonb
- `payment_terms` text DEFAULT 'Net 30'::text
- `footer_html` text
- `title` text DEFAULT ''::text
- `description` text DEFAULT ''::text
- `line_items` jsonb NOT NULL DEFAULT '[]'::jsonb
- `taxes` jsonb NOT NULL DEFAULT '[]'::jsonb
- `client_note` text DEFAULT ''::text
- `branding` jsonb NOT NULL DEFAULT '{}'::jsonb
- `payment_methods` jsonb NOT NULL DEFAULT '{}'::jsonb
- `email_subject` text DEFAULT ''::text
- `email_body` text DEFAULT ''::text
- `archived_at` timestamp with time zone
- `layout_type` text NOT NULL DEFAULT 'classic'::text
- `is_system_template` boolean NOT NULL DEFAULT false
- `slug` text
- `created_by` uuid

### `invoices`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL DEFAULT current_org_id()
- `created_by` uuid NOT NULL DEFAULT auth.uid()
- `client_id` uuid
- `invoice_number` text NOT NULL
- `status` text NOT NULL DEFAULT 'draft'::text
- `subject` text
- `issued_at` timestamp with time zone
- `due_date` date
- `subtotal_cents` integer NOT NULL DEFAULT 0
- `tax_cents` integer NOT NULL DEFAULT 0
- `total_cents` integer NOT NULL DEFAULT 0
- `paid_cents` integer NOT NULL DEFAULT 0
- `balance_cents` integer NOT NULL DEFAULT 0
- `paid_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone
- `job_id` uuid
- `public_token` text
- `currency` text DEFAULT 'CAD'::text
- `sent_at` timestamp with time zone
- `deleted_by` uuid
- `subtotal` numeric NOT NULL DEFAULT 0
- `tax_total` numeric NOT NULL DEFAULT 0
- `total` numeric NOT NULL DEFAULT 0
- `fts_vector` tsvector
- `view_token` uuid DEFAULT gen_random_uuid()
- `is_viewed` boolean DEFAULT false
- `viewed_at` timestamp with time zone
- `view_count` integer DEFAULT 0
- `last_viewed_at` timestamp with time zone
- `is_recurring` boolean DEFAULT false
- `recurrence_interval` text
- `next_recurrence_date` date
- `parent_invoice_id` uuid
- `notes` text
- `internal_notes` text
- `discount_cents` integer NOT NULL DEFAULT 0
- `template_id` uuid
- `property_id` uuid
- `client_name_snapshot` text
- `client_email_snapshot` text
- `billing_milestone_id` uuid
- `version` integer NOT NULL DEFAULT 1

### `ip_blocklist`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `ip_address` inet NOT NULL
- `reason` text NOT NULL
- `blocked_by` uuid
- `org_id` uuid NOT NULL
- `expires_at` timestamp with time zone
- `created_at` timestamp with time zone DEFAULT now()

### `job_agreements`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `job_id` uuid
- `client_id` uuid
- `require_signature` boolean NOT NULL DEFAULT true
- `terms` text NOT NULL DEFAULT ''::text
- `logo_url` text
- `status` text NOT NULL DEFAULT 'draft'::text
- `view_token` uuid NOT NULL DEFAULT gen_random_uuid()
- `sent_at` timestamp with time zone
- `signer_name` text
- `signature_data` text
- `signed_at` timestamp with time zone
- `snapshot` jsonb
- `created_by` uuid DEFAULT auth.uid()
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone
- `quote_id` uuid

### `job_billing_milestones`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `job_id` uuid NOT NULL
- `position` integer NOT NULL DEFAULT 0
- `label` text NOT NULL DEFAULT ''::text
- `percent` numeric(6,3)
- `amount_cents` integer NOT NULL DEFAULT 0
- `due_date` date
- `created_by` uuid DEFAULT auth.uid()
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `job_checklists`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `job_id` uuid NOT NULL
- `template_id` uuid
- `items` jsonb NOT NULL DEFAULT '[]'::jsonb
- `responses` jsonb NOT NULL DEFAULT '{}'::jsonb
- `completed_by` uuid
- `completed_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `job_intents`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `lead_id` uuid NOT NULL
- `deal_id` uuid
- `triggered_stage` text NOT NULL
- `status` text NOT NULL DEFAULT 'pending'::text
- `created_by` uuid DEFAULT auth.uid()
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `consumed_at` timestamp with time zone
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone

### `job_line_items`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `job_id` uuid NOT NULL
- `name` text NOT NULL
- `qty` numeric NOT NULL DEFAULT 1
- `unit_price_cents` integer NOT NULL DEFAULT 0
- `total_cents` integer NOT NULL DEFAULT 0
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone
- `created_by` uuid NOT NULL DEFAULT auth.uid()
- `included` boolean NOT NULL DEFAULT true
- `version` integer NOT NULL DEFAULT 1

### `job_materials`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `job_id` uuid NOT NULL
- `created_by` uuid NOT NULL DEFAULT auth.uid()
- `name` text NOT NULL
- `quantity` numeric NOT NULL DEFAULT 1
- `unit` text
- `unit_cost_cents` integer
- `note` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `job_recurrence_rules`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `job_id` uuid NOT NULL
- `org_id` uuid NOT NULL
- `frequency` text NOT NULL
- `interval_days` integer DEFAULT 7
- `day_of_week` integer[]
- `day_of_month` integer
- `start_date` date NOT NULL
- `end_date` date
- `max_occurrences` integer
- `occurrences_created` integer DEFAULT 0
- `next_run_at` timestamp with time zone
- `is_active` boolean DEFAULT true
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `timezone` text
- `local_time` time without time zone

### `job_templates`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `created_by` uuid NOT NULL
- `title` text NOT NULL DEFAULT ''::text
- `description` text
- `job_type` text DEFAULT 'one_off'::text
- `line_items` jsonb DEFAULT '[]'::jsonb
- `tags` text[] DEFAULT '{}'::text[]
- `notes` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `job_time_logs`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `job_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `started_at` timestamp with time zone NOT NULL DEFAULT now()
- `ended_at` timestamp with time zone
- `seconds` integer
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `jobs`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL DEFAULT current_org_id()
- `job_number` text NOT NULL
- `title` text NOT NULL
- `client_id` uuid
- `client_name` text
- `property_address` text DEFAULT '-'::text
- `scheduled_at` timestamp with time zone
- `status` text NOT NULL DEFAULT 'draft'::text
- `total_cents` integer NOT NULL DEFAULT 0
- `currency` text NOT NULL DEFAULT 'CAD'::text
- `job_type` text
- `notes` text
- `invoice_url` text
- `attachments` jsonb DEFAULT '[]'::jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `description` text
- `deleted_at` timestamp with time zone
- `total_amount` numeric(12,2) DEFAULT 0
- `created_by` uuid DEFAULT auth.uid()
- `deal_id` uuid
- `lead_id` uuid
- `team_id` uuid
- `address` text
- `latitude` double precision
- `longitude` double precision
- `geocoded_at` timestamp with time zone
- `geocode_status` text
- `deleted_by` uuid
- `end_at` timestamp with time zone
- `completed_at` timestamp with time zone
- `closed_at` timestamp with time zone
- `start_at` timestamp with time zone
- `subtotal` numeric NOT NULL DEFAULT 0
- `tax_lines` jsonb NOT NULL DEFAULT '[]'::jsonb
- `tax_total` numeric NOT NULL DEFAULT 0
- `total` numeric NOT NULL DEFAULT 0
- `billing_split` boolean NOT NULL DEFAULT false
- `fts_vector` tsvector
- `salesperson_id` uuid
- `requires_invoicing` boolean NOT NULL DEFAULT false
- `archived_at` timestamp with time zone
- `archived_by` uuid
- `deposit_required` boolean NOT NULL DEFAULT false
- `deposit_type` text
- `deposit_value` numeric(12,2) DEFAULT 0
- `deposit_cents` integer NOT NULL DEFAULT 0
- `require_payment_method` boolean NOT NULL DEFAULT false
- `deposit_status` text DEFAULT 'not_required'::text
- `property_id` uuid
- `tags` text[] NOT NULL DEFAULT '{}'::text[]
- `ask_for_review` boolean NOT NULL DEFAULT false
- `assigned_user_id` uuid
- `expenses_cents` integer NOT NULL DEFAULT 0
- `sale_date` date DEFAULT CURRENT_DATE
- `show_on_leaderboard` boolean NOT NULL DEFAULT true
- `version` integer NOT NULL DEFAULT 1
- `subtotal_cents` integer NOT NULL DEFAULT 0
- `tax_cents` integer NOT NULL DEFAULT 0

### `lead_lists`

- `lead_id` uuid NOT NULL
- `list_id` uuid NOT NULL

### `lead_sources`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `name` text NOT NULL
- `created_by` uuid DEFAULT auth.uid()
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `lists`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `name` text NOT NULL
- `description` text
- `user_id` uuid NOT NULL DEFAULT auth.uid()

### `location_tracking_settings`

- `org_id` uuid NOT NULL
- `enabled` boolean NOT NULL DEFAULT true
- `created_by` uuid
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `login_history`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `user_id` uuid NOT NULL
- `org_id` uuid NOT NULL
- `ip_address` inet
- `user_agent` text
- `device_fingerprint` text
- `country_code` text
- `city` text
- `login_method` text DEFAULT 'password'::text
- `success` boolean DEFAULT true
- `failure_reason` text
- `session_id` text
- `created_at` timestamp with time zone DEFAULT now()

### `memberships`

- `user_id` uuid NOT NULL
- `org_id` uuid NOT NULL
- `role` text NOT NULL DEFAULT 'staff'::text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `scope` text NOT NULL DEFAULT 'company'::text
- `permissions` jsonb DEFAULT '{}'::jsonb
- `team_id` uuid
- `department_id` uuid
- `manager_id` uuid
- `status` text NOT NULL DEFAULT 'active'::text
- `language` text NOT NULL DEFAULT 'fr'::text
- `full_name` text
- `avatar_url` text
- `updated_at` timestamp with time zone DEFAULT now()
- `experience_level` text
- `show_on_leaderboard` boolean NOT NULL DEFAULT true
- `permissions_custom` boolean NOT NULL DEFAULT false

### `messages`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `conversation_id` uuid NOT NULL
- `org_id` uuid NOT NULL
- `client_id` uuid
- `phone_number` text NOT NULL
- `direction` text NOT NULL
- `message_text` text NOT NULL
- `status` text DEFAULT 'queued'::text
- `provider_message_id` text
- `sender_user_id` uuid
- `error_message` text
- `created_at` timestamp with time zone DEFAULT now()

### `mfa_phone`

- `user_id` uuid NOT NULL
- `org_id` uuid NOT NULL
- `phone` text NOT NULL
- `verified_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `mfa_sms_challenges`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `user_id` uuid NOT NULL
- `phone` text NOT NULL
- `code_hash` text NOT NULL
- `purpose` text NOT NULL DEFAULT 'stepup'::text
- `attempts` integer NOT NULL DEFAULT 0
- `consumed_at` timestamp with time zone
- `expires_at` timestamp with time zone NOT NULL
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `mfa_trusted_devices`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `user_id` uuid NOT NULL
- `token_hash` text NOT NULL
- `label` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `last_seen_at` timestamp with time zone NOT NULL DEFAULT now()
- `expires_at` timestamp with time zone NOT NULL

### `note_boards`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `created_by` uuid NOT NULL
- `title` text NOT NULL DEFAULT 'Untitled Board'::text
- `description` text
- `board_type` text NOT NULL DEFAULT 'freeform'::text
- `thumbnail_url` text
- `is_template` boolean NOT NULL DEFAULT false
- `tags` text[] DEFAULT '{}'::text[]
- `viewport_x` double precision NOT NULL DEFAULT 0
- `viewport_y` double precision NOT NULL DEFAULT 0
- `viewport_zoom` double precision NOT NULL DEFAULT 1
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `archived_at` timestamp with time zone
- `archived_by` uuid

### `note_connections`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `board_id` uuid NOT NULL
- `source_id` uuid NOT NULL
- `target_id` uuid NOT NULL
- `label` text
- `line_type` text NOT NULL DEFAULT 'bezier'::text
- `color` text DEFAULT '#6b7280'::text
- `stroke_width` integer DEFAULT 2
- `animated` boolean NOT NULL DEFAULT false
- `arrow_start` boolean NOT NULL DEFAULT false
- `arrow_end` boolean NOT NULL DEFAULT true
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `note_entity_links`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `item_id` uuid NOT NULL
- `entity_type` text NOT NULL
- `entity_id` uuid NOT NULL
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `note_history`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `note_id` uuid NOT NULL
- `old_content` text NOT NULL DEFAULT ''::text
- `new_content` text NOT NULL DEFAULT ''::text
- `edited_by` uuid NOT NULL
- `edited_at` timestamp with time zone NOT NULL DEFAULT now()

### `note_items`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `board_id` uuid NOT NULL
- `created_by` uuid NOT NULL
- `item_type` text NOT NULL DEFAULT 'sticky_note'::text
- `pos_x` double precision NOT NULL DEFAULT 0
- `pos_y` double precision NOT NULL DEFAULT 0
- `width` double precision NOT NULL DEFAULT 200
- `height` double precision NOT NULL DEFAULT 150
- `rotation` double precision NOT NULL DEFAULT 0
- `z_index` integer NOT NULL DEFAULT 0
- `content` text DEFAULT ''::text
- `rich_content` jsonb
- `color` text DEFAULT '#fef08a'::text
- `font_size` integer DEFAULT 14
- `text_align` text DEFAULT 'left'::text
- `shape_type` text
- `border_style` text DEFAULT 'none'::text
- `file_url` text
- `file_name` text
- `file_type` text
- `file_size` bigint
- `link_url` text
- `link_title` text
- `link_preview` text
- `locked` boolean NOT NULL DEFAULT false
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `notes`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `created_by` uuid NOT NULL
- `content` text NOT NULL DEFAULT ''::text
- `pinned` boolean NOT NULL DEFAULT false
- `color` text
- `entity_type` text
- `entity_id` uuid
- `reminder_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `notes_checklist`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `note_id` uuid NOT NULL
- `text` text NOT NULL DEFAULT ''::text
- `is_checked` boolean NOT NULL DEFAULT false
- `position` integer NOT NULL DEFAULT 0
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `notes_files`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `note_id` uuid NOT NULL
- `file_url` text NOT NULL
- `file_name` text NOT NULL DEFAULT ''::text
- `file_type` text NOT NULL DEFAULT ''::text
- `file_size` bigint DEFAULT 0
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `notes_tags`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `note_id` uuid NOT NULL
- `tag` text NOT NULL
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `notifications`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `type` text NOT NULL
- `ref_table` text
- `ref_id` uuid
- `message` text DEFAULT ''::text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `read_at` timestamp with time zone
- `deleted_at` timestamp with time zone
- `user_id` uuid
- `body` text
- `icon` text
- `link` text
- `reference_id` uuid
- `is_read` boolean DEFAULT false
- `category` text
- `title` text
- `entity_type` text
- `entity_id` uuid
- `dismissed_at` timestamp with time zone
- `actor_name` text

### `org_billing_settings`

- `org_id` uuid NOT NULL
- `company_name` text
- `tax_number_1` text
- `tax_number_2` text
- `address` text
- `email_from` text
- `sms_from` text
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `org_client_counters`

- `org_id` uuid NOT NULL
- `last_number` bigint NOT NULL DEFAULT 0
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `org_features`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `feature` text NOT NULL
- `enabled` boolean NOT NULL DEFAULT false
- `metadata` jsonb NOT NULL DEFAULT '{}'::jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `org_invoice_sequences`

- `org_id` uuid NOT NULL
- `next_number` bigint NOT NULL DEFAULT 1
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `org_job_counters`

- `org_id` uuid NOT NULL
- `last_number` bigint NOT NULL DEFAULT 0
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `org_knowledge`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `category` text NOT NULL
- `key` text NOT NULL
- `value` text NOT NULL
- `importance` integer DEFAULT 5
- `is_active` boolean DEFAULT true
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `orgs`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `name` text NOT NULL
- `created_by` uuid DEFAULT auth.uid()
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `employee_count` text
- `logo_url` text
- `company_group_id` uuid

### `payment_provider_secrets`

- `org_id` uuid NOT NULL
- `stripe_publishable_key` text
- `stripe_secret_key_enc` text
- `paypal_client_id` text
- `paypal_secret_enc` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `payment_provider_settings`

- `org_id` uuid NOT NULL
- `default_provider` text NOT NULL DEFAULT 'none'::text
- `stripe_enabled` boolean NOT NULL DEFAULT false
- `paypal_enabled` boolean NOT NULL DEFAULT false
- `stripe_keys_present` boolean NOT NULL DEFAULT false
- `paypal_keys_present` boolean NOT NULL DEFAULT false
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `payment_providers`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `stripe_enabled` boolean NOT NULL DEFAULT false
- `stripe_account_id` text
- `stripe_webhook_secret` text
- `paypal_enabled` boolean NOT NULL DEFAULT false
- `paypal_merchant_id` text
- `paypal_webhook_id` text
- `default_provider` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `payment_requests`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `invoice_id` uuid NOT NULL
- `public_token` text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'::text)
- `amount_cents` integer NOT NULL
- `currency` text NOT NULL DEFAULT 'CAD'::text
- `status` text NOT NULL DEFAULT 'pending'::text
- `expires_at` timestamp with time zone
- `stripe_payment_intent_id` text
- `payment_url` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone

### `payment_requirements`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `entity_type` text NOT NULL
- `entity_id` uuid NOT NULL
- `requirement_type` text NOT NULL
- `amount_cents` integer DEFAULT 0
- `currency` text NOT NULL DEFAULT 'CAD'::text
- `status` text NOT NULL DEFAULT 'pending'::text
- `due_at` timestamp with time zone
- `payment_method_required` boolean NOT NULL DEFAULT false
- `payment_id` uuid
- `notes` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `payments`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL DEFAULT current_org_id()
- `created_by` uuid NOT NULL DEFAULT auth.uid()
- `invoice_id` uuid
- `job_id` uuid
- `client_id` uuid
- `amount_cents` integer NOT NULL
- `paid_at` timestamp with time zone NOT NULL
- `method` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone
- `currency` text NOT NULL DEFAULT 'CAD'::text
- `status` text NOT NULL DEFAULT 'pending'::text
- `payment_date` timestamp with time zone NOT NULL DEFAULT now()
- `payout_date` timestamp with time zone
- `provider` text NOT NULL DEFAULT 'manual'::text
- `provider_payment_id` text
- `provider_order_id` text
- `provider_event_id` text
- `payment_request_id` uuid
- `stripe_charge_id` text
- `stripe_transfer_id` text
- `stripe_balance_transaction_id` text
- `application_fee_amount` integer
- `stripe_fee_amount` integer
- `net_amount` integer
- `failure_reason` text

### `payroll_adjustments`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `period_start` date NOT NULL
- `period_end` date NOT NULL
- `amount_cents` integer NOT NULL
- `note` text
- `created_by` uuid NOT NULL
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone

### `payroll_payments`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `period_start` date NOT NULL
- `period_end` date NOT NULL
- `hours` numeric(8,2) NOT NULL DEFAULT 0
- `gross_cents` integer NOT NULL DEFAULT 0
- `commission_cents` integer NOT NULL DEFAULT 0
- `adjustments_cents` integer NOT NULL DEFAULT 0
- `total_cents` integer NOT NULL DEFAULT 0
- `note` text
- `paid_at` timestamp with time zone NOT NULL DEFAULT now()
- `paid_by` uuid NOT NULL
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `payroll_settings`

- `org_id` uuid NOT NULL
- `pay_period_type` text NOT NULL DEFAULT 'biweekly'::text
- `anchor_date` date NOT NULL DEFAULT CURRENT_DATE
- `pay_day_offset` integer NOT NULL DEFAULT 5
- `timezone` text NOT NULL DEFAULT 'America/Toronto'::text
- `created_by` uuid
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `pipeline_deals`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL DEFAULT current_org_id()
- `lead_id` uuid
- `stage_id` uuid
- `value_cents` integer NOT NULL DEFAULT 0
- `currency` text NOT NULL DEFAULT 'CAD'::text
- `probability` integer NOT NULL DEFAULT 50
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone
- `value` numeric(12,2) NOT NULL DEFAULT 0
- `created_by` uuid DEFAULT auth.uid()
- `job_id` uuid
- `stage` text NOT NULL
- `title` text NOT NULL
- `notes` text
- `client_id` uuid
- `lost_at` timestamp with time zone
- `deleted_by` uuid
- `archived_at` timestamp with time zone
- `archived_by` uuid
- `won_at` timestamp with time zone
- `rep_id` uuid
- `d2d_status` text DEFAULT 'pending'::text
- `lost_reason` text
- `pin_id` uuid
- `quote_id` uuid
- `source` text DEFAULT 'manual'::text
- `version` integer NOT NULL DEFAULT 1

### `pipelines`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `name` text NOT NULL
- `user_id` uuid NOT NULL DEFAULT auth.uid()

### `plans`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `slug` text NOT NULL
- `name` text NOT NULL
- `name_fr` text NOT NULL
- `monthly_price_usd` integer NOT NULL DEFAULT 0
- `monthly_price_cad` integer NOT NULL DEFAULT 0
- `yearly_price_usd` integer NOT NULL DEFAULT 0
- `yearly_price_cad` integer NOT NULL DEFAULT 0
- `features` jsonb NOT NULL DEFAULT '[]'::jsonb
- `max_clients` integer
- `max_jobs_per_month` integer
- `is_active` boolean NOT NULL DEFAULT true
- `sort_order` integer NOT NULL DEFAULT 0
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `includes_sms` boolean NOT NULL DEFAULT false
- `seats_included` integer
- `extra_seat_price_usd` integer
- `extra_seat_price_cad` integer
- `includes_ai` boolean DEFAULT false
- `includes_d2d` boolean DEFAULT false
- `includes_courses` boolean DEFAULT false
- `includes_api` boolean DEFAULT false
- `stripe_product_id` text
- `stripe_monthly_price_id_usd` text
- `stripe_monthly_price_id_cad` text
- `stripe_yearly_price_id_usd` text
- `stripe_yearly_price_id_cad` text
- `included_offices` integer
- `extra_office_price_usd` integer
- `extra_office_price_cad` integer
- `intro_months` integer
- `intro_price_monthly_usd` integer
- `intro_price_monthly_cad` integer
- `intro_price_yearly_usd` integer
- `intro_price_yearly_cad` integer
- `stripe_intro_coupon_id_monthly_usd` text
- `stripe_intro_coupon_id_monthly_cad` text
- `stripe_intro_coupon_id_yearly_usd` text
- `stripe_intro_coupon_id_yearly_cad` text
- `includes_automations` boolean NOT NULL DEFAULT false
- `includes_timesheets` boolean NOT NULL DEFAULT false
- `includes_request_forms` boolean NOT NULL DEFAULT false
- `includes_marketplace` boolean NOT NULL DEFAULT false

### `predefined_services`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `name` text NOT NULL
- `description` text
- `default_price_cents` integer NOT NULL DEFAULT 0
- `category` text
- `default_duration_minutes` integer
- `is_active` boolean DEFAULT true
- `sort_order` integer DEFAULT 0
- `created_at` timestamp with time zone DEFAULT now()
- `updated_at` timestamp with time zone DEFAULT now()

### `processed_checkout_sessions`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `stripe_checkout_session_id` text NOT NULL
- `org_id` uuid NOT NULL
- `user_id` uuid
- `subscription_id` uuid
- `status` text NOT NULL DEFAULT 'processed'::text
- `processed_at` timestamp with time zone NOT NULL DEFAULT now()
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `profiles`

- `id` uuid NOT NULL
- `full_name` text
- `avatar_url` text
- `company_name` text
- `updated_at` timestamp with time zone DEFAULT timezone('utc'::text, now())
- `onboarding_done` boolean DEFAULT false
- `push_token` text
- `location_consent` boolean
- `location_consent_at` timestamp with time zone

### `promo_codes`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `code` text NOT NULL
- `discount_type` text NOT NULL DEFAULT 'percentage'::text
- `discount_value` integer NOT NULL DEFAULT 0
- `max_uses` integer
- `current_uses` integer NOT NULL DEFAULT 0
- `valid_from` timestamp with time zone NOT NULL DEFAULT now()
- `valid_until` timestamp with time zone
- `is_active` boolean NOT NULL DEFAULT true
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `proof_of_presence`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `geofence_id` uuid NOT NULL
- `job_id` uuid
- `event_type` text NOT NULL
- `latitude` double precision NOT NULL
- `longitude` double precision NOT NULL
- `distance_m` double precision NOT NULL
- `recorded_at` timestamp with time zone NOT NULL DEFAULT now()

### `properties`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `client_id` uuid NOT NULL
- `name` text NOT NULL
- `address` text
- `street_number` text
- `street_name` text
- `city` text
- `province` text
- `postal_code` text
- `country` text
- `latitude` numeric
- `longitude` numeric
- `place_id` text
- `is_primary` boolean NOT NULL DEFAULT false
- `created_by` uuid NOT NULL DEFAULT auth.uid()
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone
- `version` integer NOT NULL DEFAULT 1

### `provisioning_events`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `subscription_id` uuid
- `event_type` text NOT NULL
- `status` text NOT NULL DEFAULT 'pending'::text
- `twilio_number` text
- `twilio_sid` text
- `error_message` text
- `attempt_count` integer NOT NULL DEFAULT 1
- `metadata` jsonb NOT NULL DEFAULT '{}'::jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `push_tokens`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid NOT NULL DEFAULT auth.uid()
- `token` text NOT NULL
- `platform` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `quote_attachments`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `quote_id` uuid NOT NULL
- `file_url` text NOT NULL
- `file_name` text NOT NULL
- `file_type` text
- `uploaded_by` uuid
- `uploaded_at` timestamp with time zone NOT NULL DEFAULT now()
- `source_type` text DEFAULT 'manual'::text

### `quote_line_items`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `quote_id` uuid NOT NULL
- `source_service_id` uuid
- `name` text NOT NULL
- `description` text
- `quantity` numeric(10,2) NOT NULL DEFAULT 1
- `unit_price_cents` integer NOT NULL DEFAULT 0
- `total_cents` integer NOT NULL DEFAULT 0
- `sort_order` integer NOT NULL DEFAULT 0
- `is_optional` boolean NOT NULL DEFAULT false
- `item_type` text NOT NULL DEFAULT 'service'::text
- `image_url` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `quote_measurements`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL DEFAULT current_org_id()
- `quote_id` uuid NOT NULL
- `measurement_type` text NOT NULL
- `label` text NOT NULL DEFAULT ''::text
- `unit` text NOT NULL DEFAULT 'ft'::text
- `value` numeric NOT NULL DEFAULT 0
- `area_value` numeric
- `perimeter_value` numeric
- `geojson` jsonb NOT NULL DEFAULT '{}'::jsonb
- `screenshot_url` text
- `notes` text
- `color` text NOT NULL DEFAULT '#FF4444'::text
- `sort_order` integer NOT NULL DEFAULT 0
- `created_by` uuid NOT NULL DEFAULT auth.uid()
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `quote_sections`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `quote_id` uuid NOT NULL
- `section_type` text NOT NULL
- `title` text
- `content` text
- `sort_order` integer NOT NULL DEFAULT 0
- `enabled` boolean NOT NULL DEFAULT true
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `quote_send_log`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `quote_id` uuid NOT NULL
- `channel` text NOT NULL
- `recipient` text NOT NULL
- `sent_by` uuid
- `sent_at` timestamp with time zone NOT NULL DEFAULT now()
- `delivery_status` text DEFAULT 'sent'::text
- `provider_message_id` text
- `error` text

### `quote_sequences`

- `org_id` uuid NOT NULL
- `last_value` integer NOT NULL DEFAULT 0
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `quote_status_history`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `quote_id` uuid NOT NULL
- `old_status` text
- `new_status` text NOT NULL
- `changed_by` uuid
- `changed_at` timestamp with time zone NOT NULL DEFAULT now()
- `reason` text

### `quote_templates`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `created_by` uuid
- `name` text NOT NULL
- `description` text
- `services` jsonb NOT NULL DEFAULT '[]'::jsonb
- `images` text[] NOT NULL DEFAULT '{}'::text[]
- `notes` text
- `terms` text
- `custom_fields` jsonb NOT NULL DEFAULT '{}'::jsonb
- `deleted_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `is_default` boolean NOT NULL DEFAULT false
- `is_active` boolean NOT NULL DEFAULT true
- `sort_order` integer NOT NULL DEFAULT 0
- `template_category` text
- `quote_title` text
- `intro_text` text
- `footer_notes` text
- `deposit_required` boolean NOT NULL DEFAULT false
- `deposit_type` text
- `deposit_value` numeric(12,2) DEFAULT 0
- `tax_enabled` boolean NOT NULL DEFAULT true
- `tax_rate` numeric(8,4) DEFAULT 14.975
- `tax_label` text DEFAULT 'TPS+TVQ (14.975%)'::text
- `sections` jsonb NOT NULL DEFAULT '[]'::jsonb
- `layout_config` jsonb NOT NULL DEFAULT '{}'::jsonb
- `style_config` jsonb NOT NULL DEFAULT '{}'::jsonb
- `cover_image` text

### `quote_views`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `invoice_id` uuid NOT NULL
- `client_id` uuid
- `ip_address` text
- `user_agent` text
- `viewed_at` timestamp with time zone DEFAULT now()

### `quotes`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `quote_number` text NOT NULL
- `title` text NOT NULL DEFAULT ''::text
- `lead_id` uuid
- `client_id` uuid
- `job_id` uuid
- `status` text NOT NULL DEFAULT 'draft'::text
- `context_type` text NOT NULL DEFAULT 'lead'::text
- `salesperson_id` uuid
- `created_by` uuid NOT NULL DEFAULT auth.uid()
- `view_token` uuid NOT NULL DEFAULT gen_random_uuid()
- `sent_via_email_at` timestamp with time zone
- `sent_via_sms_at` timestamp with time zone
- `last_sent_channel` text
- `approved_at` timestamp with time zone
- `declined_at` timestamp with time zone
- `expired_at` timestamp with time zone
- `converted_at` timestamp with time zone
- `valid_until` date
- `subtotal_cents` integer NOT NULL DEFAULT 0
- `discount_type` text
- `discount_value` numeric(12,2) DEFAULT 0
- `discount_cents` integer NOT NULL DEFAULT 0
- `tax_rate_label` text DEFAULT 'TPS+TVQ (14.975%)'::text
- `tax_rate` numeric(8,4) DEFAULT 14.975
- `tax_cents` integer NOT NULL DEFAULT 0
- `total_cents` integer NOT NULL DEFAULT 0
- `currency` text NOT NULL DEFAULT 'CAD'::text
- `notes` text
- `internal_notes` text
- `contract_disclaimer` text
- `deposit_required` boolean NOT NULL DEFAULT false
- `deposit_type` text
- `deposit_value` numeric(12,2) DEFAULT 0
- `require_payment_method` boolean NOT NULL DEFAULT false
- `deleted_at` timestamp with time zone
- `deleted_by` uuid
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deposit_cents` integer NOT NULL DEFAULT 0
- `deposit_status` text DEFAULT 'not_required'::text
- `source_template_id` uuid
- `source_template_name` text
- `layout_type` text DEFAULT 'minimal_pro'::text
- `property_id` uuid
- `changes_requested_at` timestamp with time zone
- `archived_at` timestamp with time zone
- `quote_type` text NOT NULL DEFAULT 'one_off'::text
- `service_plan` jsonb
- `logo_url` text
- `version` integer NOT NULL DEFAULT 1

### `rate_limits`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `user_id` uuid NOT NULL
- `action` text NOT NULL
- `window_start` timestamp with time zone NOT NULL DEFAULT date_trunc('minute'::text, now())
- `count` integer NOT NULL DEFAULT 1

### `recurring_invoice_schedules`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `client_id` uuid NOT NULL
- `template_invoice_id` uuid
- `subject` text NOT NULL
- `items` jsonb NOT NULL DEFAULT '[]'::jsonb
- `frequency` text NOT NULL
- `start_date` date NOT NULL
- `end_date` date
- `next_run_date` date NOT NULL
- `due_days_offset` integer NOT NULL DEFAULT 30
- `auto_send` boolean NOT NULL DEFAULT false
- `is_active` boolean NOT NULL DEFAULT true
- `last_invoice_id` uuid
- `last_run_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `recurring_team_schedules`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `team_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `day_of_week` smallint NOT NULL
- `start_time` time without time zone NOT NULL DEFAULT '08:00:00'::time without time zone
- `end_time` time without time zone NOT NULL DEFAULT '17:00:00'::time without time zone
- `effective_start_date` date NOT NULL DEFAULT CURRENT_DATE
- `effective_end_date` date
- `recurrence_rule` text NOT NULL DEFAULT 'weekly'::text
- `is_active` boolean NOT NULL DEFAULT true
- `created_by` uuid
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `version` integer NOT NULL DEFAULT 1

### `referrals`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `referrer_user_id` uuid NOT NULL
- `referrer_org_id` uuid NOT NULL
- `code` text NOT NULL
- `referred_email` text
- `referred_org_id` uuid
- `referred_user_id` uuid
- `status` text NOT NULL DEFAULT 'invited'::text
- `reward_amount_cents` integer NOT NULL DEFAULT 15000
- `reward_currency` text NOT NULL DEFAULT 'USD'::text
- `converted_at` timestamp with time zone
- `rewarded_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `reminder_log`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `invoice_id` uuid NOT NULL
- `days_after_due` integer NOT NULL
- `channel` text NOT NULL
- `sent_to` text NOT NULL
- `sent_at` timestamp with time zone NOT NULL DEFAULT now()
- `status` text NOT NULL DEFAULT 'sent'::text
- `error_message` text

### `reminder_settings`

- `org_id` uuid NOT NULL
- `enabled` boolean NOT NULL DEFAULT true
- `schedule` jsonb NOT NULL DEFAULT '[{"channel": "email", "days_after_due": 1}, {"channel": "email", "days_after_due": 7}, {"channel": "both", "days_after_due": 14}, {"channel": "both", "days_after_due": 30}]'::jsonb
- `custom_email_subject` text
- `custom_email_body` text
- `custom_sms_body` text
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `request_forms`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `created_by` uuid
- `api_key` text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'::text)
- `title` text NOT NULL DEFAULT 'Service Request'::text
- `description` text
- `success_message` text NOT NULL DEFAULT 'Thank you! We will get back to you shortly.'::text
- `enabled` boolean NOT NULL DEFAULT true
- `custom_fields` jsonb NOT NULL DEFAULT '[]'::jsonb
- `notify_email` boolean NOT NULL DEFAULT true
- `notify_in_app` boolean NOT NULL DEFAULT true
- `deleted_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `logo_url` text

### `review_requests`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `client_id` uuid
- `job_id` uuid
- `survey_id` uuid
- `email_template_id` uuid
- `subject_sent` text
- `status` text NOT NULL DEFAULT 'pending'::text
- `sent_at` timestamp with time zone
- `clicked_at` timestamp with time zone
- `submitted_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `role_templates`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `slug` text NOT NULL
- `name` text NOT NULL
- `description` text
- `is_system` boolean NOT NULL DEFAULT false
- `default_scope` text NOT NULL DEFAULT 'self'::text
- `permissions` jsonb NOT NULL DEFAULT '{}'::jsonb
- `is_active` boolean NOT NULL DEFAULT true
- `sort_order` integer NOT NULL DEFAULT 0
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `satisfaction_surveys`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `client_id` uuid
- `job_id` uuid
- `token` text NOT NULL
- `rating` integer
- `feedback` text
- `submitted_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `scenario_options`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `scenario_run_id` uuid NOT NULL
- `label` text NOT NULL
- `score` numeric(5,2) NOT NULL DEFAULT 0
- `benefits` text[] NOT NULL DEFAULT '{}'::text[]
- `risks` text[] NOT NULL DEFAULT '{}'::text[]
- `outcome` text
- `confidence` numeric(4,2) NOT NULL DEFAULT 0
- `is_winner` boolean NOT NULL DEFAULT false
- `rank` integer NOT NULL DEFAULT 0
- `metadata` jsonb DEFAULT '{}'::jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `scenario_runs`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `session_id` uuid NOT NULL
- `decision_log_id` uuid
- `trigger_type` text NOT NULL
- `context_snapshot` jsonb DEFAULT '{}'::jsonb
- `model_used` text
- `duration_ms` integer DEFAULT 0
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `schedule_events`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL DEFAULT current_org_id()
- `job_id` uuid
- `title` text NOT NULL DEFAULT 'Schedule event'::text
- `start_time` timestamp with time zone
- `end_time` timestamp with time zone
- `assigned_user` uuid
- `notes` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone
- `status` text
- `created_by` uuid DEFAULT auth.uid()
- `timezone` text
- `team_id` uuid
- `start_at` timestamp with time zone
- `end_at` timestamp with time zone
- `version` integer NOT NULL DEFAULT 1

### `scheduled_reports`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL DEFAULT current_org_id()
- `created_by` uuid NOT NULL DEFAULT auth.uid()
- `recipient_email` text NOT NULL
- `frequency` text NOT NULL DEFAULT 'weekly'::text
- `day_of_week` integer DEFAULT 1
- `day_of_month` integer DEFAULT 1
- `enabled` boolean NOT NULL DEFAULT true
- `last_sent_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `secret_rotation_log`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `secret_name` text NOT NULL
- `rotated_by` uuid
- `rotated_at` timestamp with time zone DEFAULT now()
- `next_rotation_due` timestamp with time zone
- `notes` text

### `security_alerts`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid
- `alert_type` text NOT NULL
- `severity` text NOT NULL
- `title` text NOT NULL
- `description` text
- `metadata` jsonb DEFAULT '{}'::jsonb
- `acknowledged` boolean DEFAULT false
- `acknowledged_by` uuid
- `acknowledged_at` timestamp with time zone
- `created_at` timestamp with time zone DEFAULT now()

### `security_canary_runs`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `ran_at` timestamp with time zone NOT NULL DEFAULT now()
- `controle` text NOT NULL
- `valeur` integer NOT NULL
- `ok` boolean DEFAULT (valeur = 0)

### `security_events`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid
- `user_id` uuid
- `event_type` text NOT NULL
- `severity` text NOT NULL
- `source` text NOT NULL DEFAULT 'system'::text
- `ip_address` inet
- `user_agent` text
- `details` jsonb DEFAULT '{}'::jsonb
- `resolved` boolean DEFAULT false
- `resolved_by` uuid
- `resolved_at` timestamp with time zone
- `created_at` timestamp with time zone DEFAULT now()

### `security_incidents`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `incident_type` text NOT NULL
- `severity` text NOT NULL DEFAULT 'low'::text
- `status` text NOT NULL DEFAULT 'detected'::text
- `detected_at` timestamp with time zone NOT NULL DEFAULT now()
- `detected_by` uuid
- `detection_method` text
- `affected_users` integer DEFAULT 0
- `affected_records` integer DEFAULT 0
- `data_categories` text[] DEFAULT ARRAY[]::text[]
- `risk_serious` boolean DEFAULT false
- `risk_rationale` text
- `title` text NOT NULL
- `description` text
- `root_cause` text
- `containment_actions` text
- `cai_notified_at` timestamp with time zone
- `cnil_notified_at` timestamp with time zone
- `opc_notified_at` timestamp with time zone
- `affected_notified_at` timestamp with time zone
- `notification_method` text
- `resolved_at` timestamp with time zone
- `lessons_learned` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `service_contracts`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `job_id` uuid NOT NULL
- `client_id` uuid
- `title` text NOT NULL DEFAULT ''::text
- `year` integer NOT NULL
- `visits` jsonb NOT NULL DEFAULT '[]'::jsonb
- `status` text NOT NULL DEFAULT 'active'::text
- `notes` text
- `created_by` uuid DEFAULT auth.uid()
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone
- `version` integer NOT NULL DEFAULT 1

### `sms_opt_outs`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `phone` text NOT NULL
- `opted_out_at` timestamp with time zone NOT NULL DEFAULT now()
- `reason` text

### `specific_notes`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `entity_type` text NOT NULL
- `entity_id` uuid NOT NULL
- `text` text
- `files` jsonb NOT NULL DEFAULT '[]'::jsonb
- `tags` text[] DEFAULT '{}'::text[]
- `created_by` uuid
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `subscriptions`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `user_id` uuid NOT NULL
- `plan_id` uuid NOT NULL
- `status` text NOT NULL
- `current_period_end` timestamp with time zone
- `created_at` timestamp with time zone DEFAULT timezone('utc'::text, now())
- `org_id` uuid NOT NULL
- `interval` text DEFAULT 'monthly'::text
- `currency` text DEFAULT 'CAD'::text
- `amount_cents` integer DEFAULT 0
- `promo_code` text
- `referral_code` text
- `cancel_at_period_end` boolean DEFAULT false
- `canceled_at` timestamp with time zone
- `current_period_start` timestamp with time zone DEFAULT now()
- `stripe_checkout_session_id` text
- `stripe_payment_intent_id` text
- `stripe_invoice_id` text
- `payment_confirmed_at` timestamp with time zone
- `receipt_email_sent` boolean NOT NULL DEFAULT false
- `receipt_email_sent_at` timestamp with time zone
- `receipt_email_error` text
- `stripe_subscription_id` text
- `stripe_customer_id` text
- `scheduled_plan_id` uuid
- `scheduled_interval` text
- `scheduled_at` timestamp with time zone
- `extra_seats` integer NOT NULL DEFAULT 0
- `stripe_seat_item_id` text
- `extra_offices` integer NOT NULL DEFAULT 0
- `stripe_office_item_id` text

### `tags`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `name` text NOT NULL
- `color_hex` text DEFAULT '#6B7280'::text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `tasks`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `public_id` text NOT NULL DEFAULT ''::text
- `title` text NOT NULL
- `description` text
- `status` text NOT NULL DEFAULT 'open'::text
- `priority` text NOT NULL DEFAULT 'medium'::text
- `type` text NOT NULL DEFAULT 'Admin'::text
- `due_date` date
- `linked_entity_type` text
- `linked_entity_id` uuid
- `linked_person_type` text
- `linked_person_id` uuid
- `assignee_user_id` uuid
- `completed_at` timestamp with time zone
- `created_by` uuid NOT NULL
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone
- `job_id` uuid
- `version` integer NOT NULL DEFAULT 1

### `tax_configs`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `name` text NOT NULL
- `rate` numeric(8,4) NOT NULL DEFAULT 0
- `type` text NOT NULL DEFAULT 'percentage'::text
- `region` text NOT NULL DEFAULT ''::text
- `country` text NOT NULL DEFAULT 'CA'::text
- `is_compound` boolean NOT NULL DEFAULT false
- `is_active` boolean NOT NULL DEFAULT true
- `sort_order` integer NOT NULL DEFAULT 0
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `registration_number` text

### `tax_group_items`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `tax_group_id` uuid NOT NULL
- `tax_config_id` uuid NOT NULL
- `sort_order` integer NOT NULL DEFAULT 0

### `tax_groups`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `name` text NOT NULL
- `region` text NOT NULL DEFAULT ''::text
- `country` text NOT NULL DEFAULT 'CA'::text
- `is_default` boolean NOT NULL DEFAULT false
- `is_active` boolean NOT NULL DEFAULT true
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `team_assignments`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `team_id` uuid NOT NULL
- `is_primary` boolean NOT NULL DEFAULT false
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `team_availability`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `team_id` uuid NOT NULL
- `weekday` smallint NOT NULL
- `start_minute` integer NOT NULL
- `end_minute` integer NOT NULL
- `timezone` text NOT NULL DEFAULT 'America/Toronto'::text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone

### `team_capabilities`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `team_id` uuid NOT NULL
- `service_type` text NOT NULL
- `skill_tags` text[] DEFAULT '{}'::text[]
- `notes` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `team_date_slots`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `team_id` uuid NOT NULL
- `slot_date` date NOT NULL
- `start_time` time without time zone NOT NULL
- `end_time` time without time zone NOT NULL
- `status` text NOT NULL DEFAULT 'available'::text
- `notes` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `version` integer NOT NULL DEFAULT 1

### `team_members`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid
- `first_name` text NOT NULL DEFAULT ''::text
- `last_name` text NOT NULL DEFAULT ''::text
- `email` text NOT NULL
- `phone` text NOT NULL DEFAULT ''::text
- `role` text NOT NULL DEFAULT 'technician'::text
- `status` text NOT NULL DEFAULT 'active'::text
- `last_login` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `avatar_url` text
- `street1` text NOT NULL DEFAULT ''::text
- `street2` text NOT NULL DEFAULT ''::text
- `city` text NOT NULL DEFAULT ''::text
- `province` text NOT NULL DEFAULT ''::text
- `postal_code` text NOT NULL DEFAULT ''::text
- `country` text NOT NULL DEFAULT ''::text
- `labour_cost_hourly` numeric(10,2) DEFAULT NULL::numeric
- `working_hours` jsonb NOT NULL DEFAULT '{"friday": {"end": "17:00", "start": "08:00", "active": true}, "monday": {"end": "17:00", "start": "08:00", "active": true}, "sunday": {"end": "17:00", "start": "08:00", "active": false}, "tuesday": {"end": "17:00", "start": "08:00", "active": true}, "saturday": {"end": "17:00", "start": "08:00", "active": false}, "thursday": {"end": "17:00", "start": "08:00", "active": true}, "wednesday": {"end": "17:00", "start": "08:00", "active": true}}'::jsonb
- `permissions` jsonb NOT NULL DEFAULT '{}'::jsonb
- `communication_preferences` jsonb NOT NULL DEFAULT '{"errors": true, "system": true, "surveys": true, "invoice_reminders": true, "appointment_reminders": true}'::jsonb
- `team_id` uuid
- `suspended_at` timestamp with time zone
- `deletion_scheduled_at` timestamp with time zone
- `deletion_requested_by` uuid
- `mfa_required` boolean NOT NULL DEFAULT false
- `password_reset_required` boolean NOT NULL DEFAULT false
- `hourly_rate_cents` integer NOT NULL DEFAULT 0
- `birth_date` date
- `compensation_mode` text NOT NULL DEFAULT 'hourly'::text

### `team_schedule_assignments`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `team_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `work_date` date NOT NULL
- `start_time` time without time zone NOT NULL DEFAULT '08:00:00'::time without time zone
- `end_time` time without time zone NOT NULL DEFAULT '17:00:00'::time without time zone
- `availability_status` text NOT NULL DEFAULT 'available'::text
- `note` text
- `source` text NOT NULL DEFAULT 'manual'::text
- `recurring_schedule_id` uuid
- `created_by` uuid
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `version` integer NOT NULL DEFAULT 1

### `team_schedule_audit`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `actor_id` uuid
- `action` text NOT NULL
- `team_id` uuid
- `target_user_id` uuid
- `work_date` date
- `old_value` jsonb
- `new_value` jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `teams`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL DEFAULT current_org_id()
- `name` text NOT NULL
- `color_hex` text NOT NULL DEFAULT '#3B82F6'::text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `deleted_at` timestamp with time zone
- `description` text
- `is_active` boolean NOT NULL DEFAULT true
- `display_order` integer NOT NULL DEFAULT 0

### `technician_device_mappings`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `provider_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `external_id` text NOT NULL
- `external_name` text
- `active` boolean NOT NULL DEFAULT true
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `technician_locations`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `provider` text NOT NULL
- `external_id` text
- `latitude` double precision NOT NULL
- `longitude` double precision NOT NULL
- `accuracy_m` double precision
- `speed_kmh` double precision
- `heading` double precision
- `battery_pct` smallint
- `altitude_m` double precision
- `address` text
- `recorded_at` timestamp with time zone NOT NULL
- `received_at` timestamp with time zone NOT NULL DEFAULT now()
- `raw_payload` jsonb

### `time_entries`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `employee_id` uuid
- `employee_name` text
- `date` date NOT NULL
- `punch_in` time without time zone NOT NULL
- `punch_out` time without time zone
- `breaks` jsonb NOT NULL DEFAULT '[]'::jsonb
- `notes` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `job_id` uuid
- `team_id` uuid
- `punch_in_at` timestamp with time zone
- `punch_out_at` timestamp with time zone
- `status` text NOT NULL DEFAULT 'completed'::text
- `approved_by` uuid
- `approved_at` timestamp with time zone

### `time_off_requests`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `start_date` date NOT NULL
- `end_date` date NOT NULL
- `all_day` boolean NOT NULL DEFAULT true
- `start_time` time without time zone
- `end_time` time without time zone
- `kind` text NOT NULL DEFAULT 'time_off'::text
- `status` text NOT NULL DEFAULT 'approved'::text
- `reason` text
- `note` text
- `approved_by` uuid
- `created_by` uuid
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `tracking_events`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `session_id` uuid
- `user_id` uuid NOT NULL
- `event_type` text NOT NULL
- `event_at` timestamp with time zone NOT NULL DEFAULT now()
- `latitude` double precision
- `longitude` double precision
- `details` jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `tracking_live_locations`

- `user_id` uuid NOT NULL
- `org_id` uuid NOT NULL
- `session_id` uuid
- `team_id` uuid
- `latitude` double precision NOT NULL
- `longitude` double precision NOT NULL
- `accuracy_m` double precision
- `heading` double precision
- `speed_mps` double precision
- `is_moving` boolean NOT NULL DEFAULT true
- `job_id` uuid
- `recorded_at` timestamp with time zone NOT NULL DEFAULT now()
- `tracking_status` text NOT NULL DEFAULT 'active'::text
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `tracking_points`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `session_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `team_id` uuid
- `latitude` double precision NOT NULL
- `longitude` double precision NOT NULL
- `accuracy_m` double precision
- `heading` double precision
- `speed_mps` double precision
- `altitude_m` double precision
- `is_moving` boolean NOT NULL DEFAULT true
- `job_id` uuid
- `recorded_at` timestamp with time zone NOT NULL DEFAULT now()
- `raw_payload` jsonb

### `tracking_sessions`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `team_id` uuid
- `time_entry_id` uuid
- `source` text NOT NULL DEFAULT 'web'::text
- `status` text NOT NULL DEFAULT 'active'::text
- `started_at` timestamp with time zone NOT NULL DEFAULT now()
- `ended_at` timestamp with time zone
- `last_point_at` timestamp with time zone
- `point_count` integer NOT NULL DEFAULT 0
- `total_distance_m` double precision NOT NULL DEFAULT 0
- `metadata` jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `user_agent_preferences`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `user_id` uuid NOT NULL
- `preferred_detail_level` text DEFAULT 'medium'::text
- `preferred_language` text DEFAULT 'en'::text
- `preferred_tone` text DEFAULT 'professional'::text
- `avg_response_time_ms` bigint DEFAULT 0
- `approval_rate` numeric(5,2) DEFAULT 0
- `preferred_option_style` text DEFAULT 'balanced'::text
- `domain_preferences` jsonb DEFAULT '{}'::jsonb
- `total_interactions` integer DEFAULT 0
- `total_approvals` integer DEFAULT 0
- `total_rejections` integer DEFAULT 0
- `total_thumbs_up` integer DEFAULT 0
- `total_thumbs_down` integer DEFAULT 0
- `last_interaction_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

### `webhook_deliveries`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `endpoint_id` uuid NOT NULL
- `org_id` uuid NOT NULL
- `event_name` text NOT NULL
- `payload` jsonb NOT NULL
- `status` text NOT NULL DEFAULT 'pending'::text
- `attempt_count` integer NOT NULL DEFAULT 0
- `http_status` integer
- `response_body` text
- `error_message` text
- `next_attempt_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `sent_at` timestamp with time zone

### `webhook_endpoints`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `name` text NOT NULL
- `url` text NOT NULL
- `events` text[] NOT NULL DEFAULT '{}'::text[]
- `secret` text NOT NULL
- `is_active` boolean NOT NULL DEFAULT true
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `last_delivery_at` timestamp with time zone
- `last_delivery_status` text

### `webhook_events`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `provider` text NOT NULL DEFAULT 'stripe'::text
- `stripe_event_id` text
- `stripe_account_id` text
- `event_type` text NOT NULL
- `payload` jsonb NOT NULL DEFAULT '{}'::jsonb
- `status` text NOT NULL DEFAULT 'pending'::text
- `processed_at` timestamp with time zone
- `error_message` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone DEFAULT now()

### `workflow_edges`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `workflow_id` uuid NOT NULL
- `source_id` uuid NOT NULL
- `target_id` uuid NOT NULL
- `source_handle` text
- `target_handle` text
- `label` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `workflow_logs`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `run_id` uuid NOT NULL
- `node_id` uuid
- `level` text NOT NULL DEFAULT 'info'::text
- `message` text NOT NULL
- `data` jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `workflow_nodes`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `workflow_id` uuid NOT NULL
- `node_type` text NOT NULL
- `action_type` text
- `label` text
- `config` jsonb NOT NULL DEFAULT '{}'::jsonb
- `position_x` double precision NOT NULL DEFAULT 0
- `position_y` double precision NOT NULL DEFAULT 0
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

### `workflow_runs`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `workflow_id` uuid NOT NULL
- `org_id` uuid NOT NULL
- `status` text NOT NULL DEFAULT 'running'::text
- `trigger_data` jsonb
- `started_at` timestamp with time zone NOT NULL DEFAULT now()
- `completed_at` timestamp with time zone
- `duration_ms` integer
- `error_msg` text
- `nodes_executed` integer NOT NULL DEFAULT 0

### `workflows`

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `org_id` uuid NOT NULL
- `name` text NOT NULL
- `description` text
- `active` boolean NOT NULL DEFAULT false
- `trigger_type` text NOT NULL
- `trigger_config` jsonb NOT NULL DEFAULT '{}'::jsonb
- `created_by` uuid
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `status` text NOT NULL DEFAULT 'draft'::text
- `preset_id` text
- `category` text
- `icon` text
- `version` integer NOT NULL DEFAULT 1
- `public_id` text NOT NULL DEFAULT ''::text
- `wf_type` text NOT NULL DEFAULT 'System'::text
- `delay_value` integer NOT NULL DEFAULT 0
- `delay_unit` text NOT NULL DEFAULT 'immediate'::text
- `conditions` jsonb NOT NULL DEFAULT '[]'::jsonb
- `actions_config` jsonb NOT NULL DEFAULT '[]'::jsonb

## 3. Policies RLS (584)


### `a2p_registrations`

- **a2p_registrations_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `active_sessions`

- **sessions_select_own** — SELECT, PERMISSIVE, roles={public}
  - USING: `(user_id = ( SELECT auth.uid() AS uid))`
- **sessions_service_all** — ALL, PERMISSIVE, roles={service_role}
  - USING: `(( SELECT auth.role() AS role) = 'service_role'::text)`

### `activity_log`

- **activity_log_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **activity_log_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`

### `activity_notes`

- **activity_notes_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **activity_notes_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **activity_notes_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `agent_messages`

- **agent_messages_org_policy** — ALL, PERMISSIVE, roles={public}
  - USING: `((org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))) OR (org_id = ( SELECT auth.uid() AS uid)))`
  - WITH CHECK: `((org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))) OR (org_id = ( SELECT auth.uid() AS uid)))`

### `alert_rules`

- **alert_rules_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **alert_rules_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **alert_rules_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `api_keys`

- **api_keys_insert_admin** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM memberships WHERE ((memberships.org_id = api_keys.org_id) AND (memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
- **api_keys_select_admin** — SELECT, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM memberships WHERE ((memberships.org_id = api_keys.org_id) AND (memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
- **api_keys_service_all** — ALL, PERMISSIVE, roles={service_role}
  - USING: `(( SELECT auth.role() AS role) = 'service_role'::text)`
- **api_keys_update_admin** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM memberships WHERE ((memberships.org_id = api_keys.org_id) AND (memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`

### `app_connections`

- **app_connections_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **app_connections_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **app_connections_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **app_connections_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `applied_taxes`

- **applied_taxes_tenant_read** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(((document_type = 'invoice'::text) AND (EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = applied_taxes.document_id) AND (i.org_id = ( SELECT current_org_id() AS current_org_id)))))) OR ((document_type = 'quote'::text) AND (EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = applied_taxes.document_id) AN`

### `approvals`

- **approvals_org_policy** — ALL, PERMISSIVE, roles={public}
  - USING: `((org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))) OR (org_id = ( SELECT auth.uid() AS uid)))`
  - WITH CHECK: `((org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))) OR (org_id = ( SELECT auth.uid() AS uid)))`

### `audit_events`

- **audit_events_insert_org** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **audit_events_no_delete_ever** — DELETE, PERMISSIVE, roles={public}
  - USING: `false`
- **audit_events_no_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `false`
- **audit_events_select_org** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `automation_execution_logs`

- **automation_execution_logs_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **automation_execution_logs_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **automation_execution_logs_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **automation_execution_logs_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `automation_rules`

- **automation_rules_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **automation_rules_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **automation_rules_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **automation_rules_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`

### `automation_scheduled_tasks`

- **automation_scheduled_tasks_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **automation_scheduled_tasks_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **automation_scheduled_tasks_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **automation_scheduled_tasks_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `automations`

- **automations_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = automations.org_id)))`
- **automations_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = automations.org_id)))`
- **automations_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = automations.org_id)))`
- **automations_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = automations.org_id)))`
  - WITH CHECK: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = automations.org_id)))`

### `billing_profiles`

- **billing_profiles_org_member_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `billing_receipt_log`

- **billing_receipt_log_org_member_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `board_comments`

- **board_comments_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `(( SELECT auth.uid() AS uid) = user_id)`
- **board_comments_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1 FROM (note_boards nb JOIN memberships m ON (((m.org_id = nb.org_id) AND (m.user_id = ( SELECT auth.uid() AS uid))))) WHERE (nb.id = board_comments.board_id))))`
- **board_comments_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM (note_boards nb JOIN memberships m ON (((m.org_id = nb.org_id) AND (m.user_id = ( SELECT auth.uid() AS uid))))) WHERE (nb.id = board_comments.board_id)))`
- **board_comments_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(( SELECT auth.uid() AS uid) = user_id)`
  - WITH CHECK: `(( SELECT auth.uid() AS uid) = user_id)`

### `board_drawings`

- **board_drawings_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `(( SELECT auth.uid() AS uid) = created_by)`
- **board_drawings_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `((( SELECT auth.uid() AS uid) = created_by) AND (EXISTS ( SELECT 1 FROM (note_boards nb JOIN memberships m ON (((m.org_id = nb.org_id) AND (m.user_id = ( SELECT auth.uid() AS uid))))) WHERE (nb.id = board_drawings.board_id))))`
- **board_drawings_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM (note_boards nb JOIN memberships m ON (((m.org_id = nb.org_id) AND (m.user_id = ( SELECT auth.uid() AS uid))))) WHERE (nb.id = board_drawings.board_id)))`

### `board_votes`

- **board_votes_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `(( SELECT auth.uid() AS uid) = user_id)`
- **board_votes_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1 FROM (note_boards nb JOIN memberships m ON (((m.org_id = nb.org_id) AND (m.user_id = ( SELECT auth.uid() AS uid))))) WHERE (nb.id = board_votes.board_id))))`
- **board_votes_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM (note_boards nb JOIN memberships m ON (((m.org_id = nb.org_id) AND (m.user_id = ( SELECT auth.uid() AS uid))))) WHERE (nb.id = board_votes.board_id)))`

### `booking_pages`

- **booking_pages_org_read** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **booking_pages_org_write** — ALL, PERMISSIVE, roles={public}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`

### `bookings`

- **bookings_org_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
- **bookings_org_read** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **bookings_org_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `checklist_templates`

- **checklist_templates_org_read** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **checklist_templates_org_write** — ALL, PERMISSIVE, roles={public}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`

### `client_tags`

- **client_tags_delete** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(EXISTS ( SELECT 1 FROM (clients c JOIN memberships m ON ((m.org_id = c.org_id))) WHERE ((c.id = client_tags.client_id) AND (m.user_id = ( SELECT auth.uid() AS uid)))))`
- **client_tags_insert** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM (clients c JOIN memberships m ON ((m.org_id = c.org_id))) WHERE ((c.id = client_tags.client_id) AND (m.user_id = ( SELECT auth.uid() AS uid)))))`
- **client_tags_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(EXISTS ( SELECT 1 FROM (clients c JOIN memberships m ON ((m.org_id = c.org_id))) WHERE ((c.id = client_tags.client_id) AND (m.user_id = ( SELECT auth.uid() AS uid)))))`

### `clients`

- **clients_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(has_org_membership(( SELECT auth.uid() AS uid), org_id) AND has_org_admin_role(( SELECT auth.uid() AS uid), org_id))`
- **clients_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(has_org_membership(( SELECT auth.uid() AS uid), org_id) AND (created_by = ( SELECT auth.uid() AS uid)))`
- **clients_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **clients_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `commission_settings`

- **commission_settings_modify** — ALL, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **commission_settings_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `communication_channels`

- **comm_channels_org_access** — ALL, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `communication_messages`

- **comm_messages_org_access** — ALL, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `communication_settings`

- **comm_settings_org_access** — ALL, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `company_operating_profile`

- **cop_org_access** — ALL, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `company_settings`

- **company_settings_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = company_settings.org_id)))`
- **company_settings_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = company_settings.org_id)))`
- **company_settings_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = company_settings.org_id)))`
- **company_settings_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = company_settings.org_id)))`
  - WITH CHECK: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = company_settings.org_id)))`

### `confidence_calibration`

- **service_full_access** — ALL, PERMISSIVE, roles={service_role}
  - USING: `true`
  - WITH CHECK: `true`

### `connected_accounts`

- **connected_accounts_delete_admin** — DELETE, PERMISSIVE, roles={public}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
- **connected_accounts_insert_org** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
- **connected_accounts_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(EXISTS ( SELECT 1 FROM memberships m WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.org_id = connected_accounts.org_id))))`
- **connected_accounts_update_org** — UPDATE, PERMISSIVE, roles={public}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`

### `consents`

- **consents_insert_self** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(((subject_type = 'user'::text) AND (subject_id = ( SELECT auth.uid() AS uid))) OR ((org_id IS NOT NULL) AND has_org_membership(( SELECT auth.uid() AS uid), org_id)))`
- **consents_select_own** — SELECT, PERMISSIVE, roles={public}
  - USING: `(((subject_type = 'user'::text) AND (subject_id = ( SELECT auth.uid() AS uid))) OR ((org_id IS NOT NULL) AND has_org_membership(( SELECT auth.uid() AS uid), org_id)))`

### `contacts`

- **contacts_delete_org** — DELETE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **contacts_insert_org** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **contacts_select_org** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **contacts_update_org** — UPDATE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `conversations`

- **conversations_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = conversations.org_id)))`
- **conversations_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = conversations.org_id)))`
- **conversations_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = conversations.org_id)))`
- **conversations_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = conversations.org_id)))`
  - WITH CHECK: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = conversations.org_id)))`

### `course_assignments`

- **course_assignments_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM courses WHERE ((courses.id = course_assignments.course_id) AND has_org_admin_role(( SELECT auth.uid() AS uid), courses.org_id))))`
- **course_assignments_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM courses WHERE ((courses.id = course_assignments.course_id) AND has_org_admin_role(auth.uid(), courses.org_id))))`
- **course_assignments_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM courses WHERE ((courses.id = course_assignments.course_id) AND has_org_membership(( SELECT auth.uid() AS uid), courses.org_id))))`

### `course_lessons`

- **course_lessons_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM (course_modules m JOIN courses c ON ((c.id = m.course_id))) WHERE ((m.id = course_lessons.module_id) AND has_org_admin_role(( SELECT auth.uid() AS uid), c.org_id))))`
- **course_lessons_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM (course_modules m JOIN courses c ON ((c.id = m.course_id))) WHERE ((m.id = course_lessons.module_id) AND has_org_admin_role(auth.uid(), c.org_id))))`
- **course_lessons_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM (course_modules m JOIN courses c ON ((c.id = m.course_id))) WHERE ((m.id = course_lessons.module_id) AND has_org_membership(( SELECT auth.uid() AS uid), c.org_id))))`
- **course_lessons_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM (course_modules m JOIN courses c ON ((c.id = m.course_id))) WHERE ((m.id = course_lessons.module_id) AND has_org_admin_role(( SELECT auth.uid() AS uid), c.org_id))))`
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM (course_modules m JOIN courses c ON ((c.id = m.course_id))) WHERE ((m.id = course_lessons.module_id) AND has_org_admin_role(( SELECT auth.uid() AS uid), c.org_id))))`

### `course_modules`

- **course_modules_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM courses WHERE ((courses.id = course_modules.course_id) AND has_org_admin_role(( SELECT auth.uid() AS uid), courses.org_id))))`
- **course_modules_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM courses WHERE ((courses.id = course_modules.course_id) AND has_org_admin_role(auth.uid(), courses.org_id))))`
- **course_modules_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM courses WHERE ((courses.id = course_modules.course_id) AND has_org_membership(( SELECT auth.uid() AS uid), courses.org_id))))`
- **course_modules_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM courses WHERE ((courses.id = course_modules.course_id) AND has_org_admin_role(( SELECT auth.uid() AS uid), courses.org_id))))`
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM courses WHERE ((courses.id = course_modules.course_id) AND has_org_admin_role(( SELECT auth.uid() AS uid), courses.org_id))))`

### `course_progress`

- **course_progress_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(user_id = ( SELECT auth.uid() AS uid))`
- **course_progress_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(user_id = ( SELECT auth.uid() AS uid))`
- **course_progress_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(user_id = ( SELECT auth.uid() AS uid))`
  - WITH CHECK: `(user_id = ( SELECT auth.uid() AS uid))`

### `courses`

- **courses_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
- **courses_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_admin_role(auth.uid(), org_id)`
- **courses_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **courses_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`

### `custom_column_values`

- **custom_column_values_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **custom_column_values_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **custom_column_values_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **custom_column_values_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `custom_columns`

- **custom_columns_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **custom_columns_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **custom_columns_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **custom_columns_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `data_export_log`

- **export_log_insert_service** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(( SELECT auth.role() AS role) = 'service_role'::text)`
- **export_log_no_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `false`
- **export_log_no_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `false`
- **export_log_select_admin** — SELECT, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM memberships WHERE ((memberships.org_id = data_export_log.org_id) AND (memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`

### `dead_letters`

- **dead_letters_service** — ALL, PERMISSIVE, roles={service_role}
  - USING: `true`
  - WITH CHECK: `true`

### `decision_logs`

- **decision_logs_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `((org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))) OR (org_id = ( SELECT auth.uid() AS uid)))`
- **decision_logs_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `((org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))) OR (org_id = ( SELECT auth.uid() AS uid)))`

### `decision_outcomes`

- **service_full_access** — ALL, PERMISSIVE, roles={service_role}
  - USING: `true`
  - WITH CHECK: `true`

### `demo_requests`

- **demo_requests_platform_admin** — ALL, PERMISSIVE, roles={public}
  - USING: `((( SELECT auth.uid() AS uid))::text = current_setting('app.platform_owner_id'::text, true))`
  - WITH CHECK: `((( SELECT auth.uid() AS uid))::text = current_setting('app.platform_owner_id'::text, true))`

### `dsar_requests`

- **dsar_insert_self** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `((requested_by = ( SELECT auth.uid() AS uid)) OR has_org_membership(( SELECT auth.uid() AS uid), org_id))`
- **dsar_select_org** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **dsar_update_admin** — UPDATE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `email_accounts`

- **email_accounts_delete_own** — DELETE, PERMISSIVE, roles={public}
  - USING: `(user_id = ( SELECT auth.uid() AS uid))`
- **email_accounts_insert_own** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `((user_id = auth.uid()) AND (org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = auth.uid()))))`
- **email_accounts_select_own** — SELECT, PERMISSIVE, roles={public}
  - USING: `(user_id = ( SELECT auth.uid() AS uid))`
- **email_accounts_update_own** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(user_id = ( SELECT auth.uid() AS uid))`
  - WITH CHECK: `(user_id = ( SELECT auth.uid() AS uid))`

### `email_campaign_recipients`

- **ecr_org_read** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `email_campaigns`

- **email_campaigns_org_read** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **email_campaigns_org_write** — ALL, PERMISSIVE, roles={public}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`

### `email_messages`

- **email_messages_select_own** — SELECT, PERMISSIVE, roles={public}
  - USING: `(user_id = ( SELECT auth.uid() AS uid))`

### `email_oauth_states`

- **email_oauth_states_deny_client** — ALL, RESTRICTIVE, roles={anon,authenticated}
  - USING: `false`
  - WITH CHECK: `false`

### `email_opt_outs`

- **email_opt_outs_select_org** — SELECT, PERMISSIVE, roles={public}
  - USING: `((org_id IS NULL) OR has_org_membership(( SELECT auth.uid() AS uid), org_id))`
- **email_opt_outs_service** — ALL, PERMISSIVE, roles={service_role}
  - USING: `true`
  - WITH CHECK: `true`

### `email_templates`

- **email_templates_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **email_templates_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **email_templates_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **email_templates_service** — ALL, PERMISSIVE, roles={service_role}
  - USING: `true`
  - WITH CHECK: `true`
- **email_templates_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`

### `email_threads`

- **email_threads_select_own** — SELECT, PERMISSIVE, roles={public}
  - USING: `(user_id = ( SELECT auth.uid() AS uid))`

### `failed_login_attempts`

- **failed_login_attempts_admin_read** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(EXISTS ( SELECT 1 FROM memberships m WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`

### `few_shot_examples`

- **service_full_access** — ALL, PERMISSIVE, roles={service_role}
  - USING: `true`
  - WITH CHECK: `true`

### `field_daily_stats`

- **field_daily_stats_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **field_daily_stats_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **field_daily_stats_service_full_access** — ALL, PERMISSIVE, roles={service_role}
  - USING: `true`
  - WITH CHECK: `true`
- **field_daily_stats_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `field_house_events`

- **field_house_events_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **field_house_events_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **field_house_events_service_full_access** — ALL, PERMISSIVE, roles={service_role}
  - USING: `true`
  - WITH CHECK: `true`
- **field_house_events_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `field_house_profiles`

- **field_house_profiles_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **field_house_profiles_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **field_house_profiles_service_full_access** — ALL, PERMISSIVE, roles={service_role}
  - USING: `true`
  - WITH CHECK: `true`
- **field_house_profiles_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `field_pin_entity_links`

- **fpel_org_access** — ALL, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `field_pin_templates`

- **field_pin_templates_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **field_pin_templates_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **field_pin_templates_service_full_access** — ALL, PERMISSIVE, roles={service_role}
  - USING: `true`
  - WITH CHECK: `true`
- **field_pin_templates_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `field_pins`

- **field_pins_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **field_pins_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **field_pins_service_full_access** — ALL, PERMISSIVE, roles={service_role}
  - USING: `true`
  - WITH CHECK: `true`
- **field_pins_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `field_rep_performance`

- **frp_org_access** — ALL, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `field_sales_reps`

- **field_sales_reps_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **field_sales_reps_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **field_sales_reps_service** — ALL, PERMISSIVE, roles={service_role}
  - USING: `true`
  - WITH CHECK: `true`
- **field_sales_reps_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `field_sales_team_members`

- **field_sales_team_members_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(EXISTS ( SELECT 1 FROM (field_sales_teams t JOIN memberships m ON ((m.org_id = t.org_id))) WHERE ((t.id = field_sales_team_members.team_id) AND (m.user_id = ( SELECT auth.uid() AS uid)))))`
- **field_sales_team_members_service** — ALL, PERMISSIVE, roles={service_role}
  - USING: `true`
  - WITH CHECK: `true`

### `field_sales_teams`

- **field_sales_teams_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **field_sales_teams_service** — ALL, PERMISSIVE, roles={service_role}
  - USING: `true`
  - WITH CHECK: `true`

### `field_schedule_slots`

- **fss_org_access** — ALL, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `field_settings`

- **field_settings_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **field_settings_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **field_settings_service_full_access** — ALL, PERMISSIVE, roles={service_role}
  - USING: `true`
  - WITH CHECK: `true`
- **field_settings_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `field_territories`

- **field_territories_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **field_territories_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **field_territories_service_full_access** — ALL, PERMISSIVE, roles={service_role}
  - USING: `true`
  - WITH CHECK: `true`
- **field_territories_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `field_territory_assignments`

- **fta_org_access** — ALL, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `form_submissions`

- **form_submissions_org_member** — ALL, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `fs_badges`

- **fs_badges_delete** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
- **fs_badges_insert** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
- **fs_badges_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **fs_badges_update** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`

### `fs_battles`

- **fs_battles_delete** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
- **fs_battles_insert** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
- **fs_battles_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **fs_battles_update** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`

### `fs_challenge_participants`

- **fs_challenge_participants_insert** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `((user_id = auth.uid()) AND (challenge_id IN ( SELECT fs_challenges.id FROM fs_challenges WHERE (fs_challenges.org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = auth.uid()))))))`
- **fs_challenge_participants_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(challenge_id IN ( SELECT fs_challenges.id FROM fs_challenges WHERE (fs_challenges.org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))))`
- **fs_challenge_participants_update** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(challenge_id IN ( SELECT fs_challenges.id FROM fs_challenges WHERE (fs_challenges.org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))))`
  - WITH CHECK: `(challenge_id IN ( SELECT c.id FROM fs_challenges c WHERE (c.org_id IN ( SELECT m.org_id FROM memberships m WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))))`

### `fs_challenges`

- **fs_challenges_delete** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
- **fs_challenges_insert** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
- **fs_challenges_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **fs_challenges_update** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`

### `fs_check_in_records`

- **fs_check_in_records_insert** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(user_id = ( SELECT auth.uid() AS uid))`
- **fs_check_in_records_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `((user_id = ( SELECT auth.uid() AS uid)) OR (org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))`

### `fs_commission_entries`

- **fs_commission_entries_delete** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
- **fs_commission_entries_insert** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
- **fs_commission_entries_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `((user_id = ( SELECT auth.uid() AS uid)) OR (org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text]))))) OR (EXISTS ( SELECT 1 FROM field_settings fs WHERE ((fs.org_id = fs_com`
- **fs_commission_entries_update** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`

### `fs_commission_rules`

- **fs_commission_rules_delete** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
- **fs_commission_rules_insert** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
- **fs_commission_rules_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **fs_commission_rules_update** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`

### `fs_field_sessions`

- **fs_field_sessions_insert** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `((user_id = ( SELECT auth.uid() AS uid)) AND (org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))))`
- **fs_field_sessions_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `((user_id = ( SELECT auth.uid() AS uid)) OR (org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))`
- **fs_field_sessions_update** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(user_id = ( SELECT auth.uid() AS uid))`
  - WITH CHECK: `(user_id = ( SELECT auth.uid() AS uid))`

### `fs_gps_points`

- **fs_gps_points_insert** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(user_id = ( SELECT auth.uid() AS uid))`
- **fs_gps_points_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `((user_id = ( SELECT auth.uid() AS uid)) OR (session_id IN ( SELECT fs_field_sessions.id FROM fs_field_sessions WHERE (fs_field_sessions.org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text,`

### `fs_rep_badges`

- **fs_rep_badges_insert** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
- **fs_rep_badges_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `fs_rep_stat_snapshots`

- **fs_rep_stat_snapshots_delete** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
- **fs_rep_stat_snapshots_insert** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
- **fs_rep_stat_snapshots_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **fs_rep_stat_snapshots_update** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`

### `geofences`

- **geofences_org** — ALL, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `goals`

- **goals_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **goals_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **goals_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `gps_providers`

- **gps_providers_org** — ALL, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `incident_timeline`

- **timeline_insert_org** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM security_incidents si WHERE ((si.id = incident_timeline.incident_id) AND has_org_admin_role(( SELECT auth.uid() AS uid), si.org_id))))`
- **timeline_select_org** — SELECT, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM security_incidents si WHERE ((si.id = incident_timeline.incident_id) AND has_org_admin_role(( SELECT auth.uid() AS uid), si.org_id))))`

### `integration_audit_logs`

- **integration_audit_logs_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **integration_audit_logs_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **integration_audit_logs_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **integration_audit_logs_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `integration_oauth_states`

- **integration_oauth_states_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **integration_oauth_states_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **integration_oauth_states_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **integration_oauth_states_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `invitations`

- **invitations_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **invitations_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(has_org_membership(( SELECT auth.uid() AS uid), org_id) OR (email = (( SELECT users.email FROM auth.users WHERE (users.id = ( SELECT auth.uid() AS uid))))::text))`
- **invitations_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(has_org_membership(( SELECT auth.uid() AS uid), org_id) OR (email = (( SELECT users.email FROM auth.users WHERE (users.id = ( SELECT auth.uid() AS uid))))::text))`
  - WITH CHECK: `(has_org_membership(( SELECT auth.uid() AS uid), org_id) OR (email = (( SELECT users.email FROM auth.users WHERE (users.id = ( SELECT auth.uid() AS uid))))::text))`

### `invoice_items`

- **invoice_items_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **invoice_items_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **invoice_items_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **invoice_items_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `invoice_send_events`

- **ise_insert_org** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **ise_select_org** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `invoice_sequences`

- **invoice_sequences_all** — ALL, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `invoice_templates`

- **invoice_templates_delete_org** — DELETE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **invoice_templates_insert_org** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **invoice_templates_select_org** — SELECT, PERMISSIVE, roles={public}
  - USING: `(has_org_membership(( SELECT auth.uid() AS uid), org_id) OR ((org_id IS NULL) AND (is_system_template = true)))`
- **invoice_templates_update_org** — UPDATE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `invoices`

- **invoices_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **invoices_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM memberships m WHERE ((m.org_id = invoices.org_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
- **invoices_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(EXISTS ( SELECT 1 FROM memberships m WHERE ((m.org_id = invoices.org_id) AND (m.user_id = ( SELECT auth.uid() AS uid)))))`
- **invoices_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(EXISTS ( SELECT 1 FROM memberships m WHERE ((m.org_id = invoices.org_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM memberships m WHERE ((m.org_id = invoices.org_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`

### `ip_blocklist`

- **ip_blocklist_admin_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `((org_id IS NULL) OR (EXISTS ( SELECT 1 FROM memberships WHERE ((memberships.org_id = ip_blocklist.org_id) AND (memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))`
- **ip_blocklist_service_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `(( SELECT auth.role() AS role) = 'service_role'::text)`
- **ip_blocklist_service_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(( SELECT auth.role() AS role) = 'service_role'::text)`
- **ip_blocklist_service_write** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(( SELECT auth.role() AS role) = 'service_role'::text)`

### `job_agreements`

- **job_agreements_delete** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **job_agreements_insert** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **job_agreements_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **job_agreements_update** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `job_billing_milestones`

- **job_billing_milestones_delete** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **job_billing_milestones_insert** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **job_billing_milestones_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **job_billing_milestones_update** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `job_checklists`

- **job_checklists_org_all** — ALL, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `job_intents`

- **job_intents_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **job_intents_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **job_intents_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **job_intents_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `job_line_items`

- **job_line_items_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **job_line_items_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(has_org_membership(( SELECT auth.uid() AS uid), org_id) AND (created_by = ( SELECT auth.uid() AS uid)))`
- **job_line_items_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **job_line_items_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `job_materials`

- **job_materials_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **job_materials_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(has_org_membership(( SELECT auth.uid() AS uid), org_id) AND (created_by = ( SELECT auth.uid() AS uid)))`
- **job_materials_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `job_recurrence_rules`

- **job_recurrence_org** — ALL, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM memberships m WHERE ((m.org_id = job_recurrence_rules.org_id) AND (m.user_id = ( SELECT auth.uid() AS uid)))))`
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM memberships m WHERE ((m.org_id = job_recurrence_rules.org_id) AND (m.user_id = ( SELECT auth.uid() AS uid)))))`

### `job_templates`

- **job_templates_org** — ALL, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM memberships m WHERE ((m.org_id = job_templates.org_id) AND (m.user_id = ( SELECT auth.uid() AS uid)))))`
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM memberships m WHERE ((m.org_id = job_templates.org_id) AND (m.user_id = ( SELECT auth.uid() AS uid)))))`

### `job_time_logs`

- **job_time_logs_all** — ALL, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `jobs`

- **jobs_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(has_org_membership(( SELECT auth.uid() AS uid), org_id) AND has_org_admin_role(( SELECT auth.uid() AS uid), org_id))`
- **jobs_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
- **jobs_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **jobs_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`

### `lead_lists`

- **lead_lists_deny_client** — ALL, RESTRICTIVE, roles={anon,authenticated}
  - USING: `false`
  - WITH CHECK: `false`

### `lead_sources`

- **lead_sources_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **lead_sources_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **lead_sources_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **lead_sources_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `lists`

- **lists_owner_rw** — ALL, PERMISSIVE, roles={authenticated}
  - USING: `(user_id = ( SELECT auth.uid() AS uid))`
  - WITH CHECK: `(user_id = ( SELECT auth.uid() AS uid))`

### `location_tracking_settings`

- **location_tracking_settings_delete_admin** — DELETE, PERMISSIVE, roles={public}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
- **location_tracking_settings_insert_admin** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
- **location_tracking_settings_select_org** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **location_tracking_settings_update_admin** — UPDATE, PERMISSIVE, roles={public}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`

### `login_history`

- **login_history_insert_service** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(( SELECT auth.role() AS role) = 'service_role'::text)`
- **login_history_no_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `false`
- **login_history_no_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `false`
- **login_history_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1 FROM memberships m WHERE ((m.org_id = login_history.org_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))`

### `memberships`

- **memberships_bootstrap_window** — INSERT, RESTRICTIVE, roles={authenticated}
  - WITH CHECK: `(has_org_admin_role(auth.uid(), org_id) OR org_is_within_bootstrap_window(org_id))`
- **memberships_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `((user_id = ( SELECT auth.uid() AS uid)) OR has_org_admin_role(( SELECT auth.uid() AS uid), org_id))`
- **memberships_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(has_org_admin_role(auth.uid(), org_id) OR ((user_id = auth.uid()) AND (lower(COALESCE(role, ''::text)) = 'owner'::text) AND org_has_no_members(org_id)))`
- **memberships_select_own_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(has_org_membership(( SELECT auth.uid() AS uid), org_id) OR (user_id = ( SELECT auth.uid() AS uid)) OR has_org_role(( SELECT auth.uid() AS uid), org_id, ARRAY['owner'::text, 'admin'::text]))`
- **memberships_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `((user_id = ( SELECT auth.uid() AS uid)) OR has_org_admin_role(( SELECT auth.uid() AS uid), org_id))`
  - WITH CHECK: `((user_id = ( SELECT auth.uid() AS uid)) OR has_org_admin_role(( SELECT auth.uid() AS uid), org_id))`

### `messages`

- **messages_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = messages.org_id)))`
- **messages_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = messages.org_id)))`
- **messages_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = messages.org_id)))`
- **messages_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = messages.org_id)))`
  - WITH CHECK: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = messages.org_id)))`

### `mfa_phone`

- **mfa_phone_select_own** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) = user_id)`

### `mfa_sms_challenges`

- **mfa_sms_challenges_deny_client** — ALL, RESTRICTIVE, roles={anon,authenticated}
  - USING: `false`
  - WITH CHECK: `false`

### `mfa_trusted_devices`

- **mfa_trusted_devices_select_own** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) = user_id)`

### `note_boards`

- **note_boards_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **note_boards_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **note_boards_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **note_boards_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `note_connections`

- **note_connections_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `(board_id IN ( SELECT note_boards.id FROM note_boards WHERE (note_boards.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`
- **note_connections_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(board_id IN ( SELECT note_boards.id FROM note_boards WHERE (note_boards.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`
- **note_connections_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(board_id IN ( SELECT note_boards.id FROM note_boards WHERE (note_boards.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`
- **note_connections_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(board_id IN ( SELECT note_boards.id FROM note_boards WHERE (note_boards.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`
  - WITH CHECK: `(board_id IN ( SELECT note_boards.id FROM note_boards WHERE (note_boards.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`

### `note_entity_links`

- **note_entity_links_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `(item_id IN ( SELECT ni.id FROM (note_items ni JOIN note_boards nb ON ((nb.id = ni.board_id))) WHERE (nb.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`
- **note_entity_links_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(item_id IN ( SELECT ni.id FROM (note_items ni JOIN note_boards nb ON ((nb.id = ni.board_id))) WHERE (nb.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`
- **note_entity_links_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(item_id IN ( SELECT ni.id FROM (note_items ni JOIN note_boards nb ON ((nb.id = ni.board_id))) WHERE (nb.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`

### `note_history`

- **note_history_insert** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(note_id IN ( SELECT notes.id FROM notes WHERE (notes.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`
- **note_history_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(note_id IN ( SELECT notes.id FROM notes WHERE (notes.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`

### `note_items`

- **note_items_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `(board_id IN ( SELECT note_boards.id FROM note_boards WHERE (note_boards.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`
- **note_items_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(board_id IN ( SELECT note_boards.id FROM note_boards WHERE (note_boards.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`
- **note_items_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(board_id IN ( SELECT note_boards.id FROM note_boards WHERE (note_boards.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`
- **note_items_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(board_id IN ( SELECT note_boards.id FROM note_boards WHERE (note_boards.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`
  - WITH CHECK: `(board_id IN ( SELECT note_boards.id FROM note_boards WHERE (note_boards.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`

### `notes`

- **notes_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **notes_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **notes_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **notes_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`

### `notes_checklist`

- **notes_checklist_delete** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(note_id IN ( SELECT notes.id FROM notes WHERE (notes.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`
- **notes_checklist_insert** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(note_id IN ( SELECT notes.id FROM notes WHERE (notes.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`
- **notes_checklist_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(note_id IN ( SELECT notes.id FROM notes WHERE (notes.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`
- **notes_checklist_update** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(note_id IN ( SELECT notes.id FROM notes WHERE (notes.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`
  - WITH CHECK: `(note_id IN ( SELECT n.id FROM notes n WHERE (n.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`

### `notes_files`

- **notes_files_delete** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(note_id IN ( SELECT notes.id FROM notes WHERE (notes.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`
- **notes_files_insert** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(note_id IN ( SELECT notes.id FROM notes WHERE (notes.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`
- **notes_files_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(note_id IN ( SELECT notes.id FROM notes WHERE (notes.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`

### `notes_tags`

- **notes_tags_delete** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(note_id IN ( SELECT notes.id FROM notes WHERE (notes.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`
- **notes_tags_insert** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(note_id IN ( SELECT notes.id FROM notes WHERE (notes.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`
- **notes_tags_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(note_id IN ( SELECT notes.id FROM notes WHERE (notes.org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))))`

### `notifications`

- **notifications_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **notifications_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = notifications.org_id)))`
- **notifications_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = notifications.org_id)))`
- **notifications_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = notifications.org_id)))`
  - WITH CHECK: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = notifications.org_id)))`

### `org_billing_settings`

- **org_billing_settings_insert_admin** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
- **org_billing_settings_select_org** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **org_billing_settings_update_admin** — UPDATE, PERMISSIVE, roles={public}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`

### `org_client_counters`

- **org_client_counters_deny_client** — ALL, RESTRICTIVE, roles={anon,authenticated}
  - USING: `false`
  - WITH CHECK: `false`

### `org_features`

- **org_features_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `((org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text]))))) OR (org_id = ( SELECT auth.uid() AS uid)))`
- **org_features_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **org_features_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `((org_id IN ( SELECT memberships.org_id FROM memberships WHERE ((memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text]))))) OR (org_id = ( SELECT auth.uid() AS uid)))`

### `org_invoice_sequences`

- **org_invoice_sequences_service** — ALL, PERMISSIVE, roles={service_role}
  - USING: `true`
  - WITH CHECK: `true`

### `org_job_counters`

- **org_job_counters_deny_client** — ALL, RESTRICTIVE, roles={anon,authenticated}
  - USING: `false`
  - WITH CHECK: `false`

### `org_knowledge`

- **org_knowledge_org_member_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `orgs`

- **orgs_delete_owner** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_role(( SELECT auth.uid() AS uid), id, ARRAY['owner'::text])`
- **orgs_insert_authenticated** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(( SELECT auth.uid() AS uid) IS NOT NULL)`
- **orgs_select_member** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), id)`
- **orgs_update** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `((created_by = ( SELECT auth.uid() AS uid)) OR has_org_admin_role(( SELECT auth.uid() AS uid), id))`
  - WITH CHECK: `((created_by = ( SELECT auth.uid() AS uid)) OR has_org_admin_role(( SELECT auth.uid() AS uid), id))`

### `payment_provider_secrets`

- **payment_secrets_service_only_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `(( SELECT auth.role() AS role) = 'service_role'::text)`
- **payment_secrets_service_only_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(( SELECT auth.role() AS role) = 'service_role'::text)`
- **payment_secrets_service_only_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(( SELECT auth.role() AS role) = 'service_role'::text)`
- **payment_secrets_service_only_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(( SELECT auth.role() AS role) = 'service_role'::text)`

### `payment_provider_settings`

- **payment_provider_settings_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
- **payment_provider_settings_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
- **payment_provider_settings_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **payment_provider_settings_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`

### `payment_providers`

- **payment_providers_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **payment_providers_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **payment_providers_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **payment_providers_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `payment_requests`

- **payment_requests_delete_org** — DELETE, PERMISSIVE, roles={public}
  - USING: `((org_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1 FROM memberships m WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.org_id = payment_requests.org_id)))))`
- **payment_requests_insert_org** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
- **payment_requests_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(EXISTS ( SELECT 1 FROM memberships m WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.org_id = payment_requests.org_id))))`
- **payment_requests_update_org** — UPDATE, PERMISSIVE, roles={public}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`

### `payment_requirements`

- **payment_requirements_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **payment_requirements_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **payment_requirements_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `payments`

- **payments_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **payments_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **payments_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **payments_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `payroll_adjustments`

- **payroll_adjustments_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `payroll_payments`

- **payroll_payments_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `payroll_settings`

- **payroll_settings_delete_org** — DELETE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **payroll_settings_insert_org** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **payroll_settings_select_org** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **payroll_settings_update_org** — UPDATE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `pipeline_deals`

- **pipeline_deals_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **pipeline_deals_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(has_org_membership(( SELECT auth.uid() AS uid), org_id) AND (created_by = ( SELECT auth.uid() AS uid)))`
- **pipeline_deals_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **pipeline_deals_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `pipelines`

- **pipelines_owner_rw** — ALL, PERMISSIVE, roles={authenticated}
  - USING: `(user_id = ( SELECT auth.uid() AS uid))`
  - WITH CHECK: `(user_id = ( SELECT auth.uid() AS uid))`

### `plans`

- **plans_public_read** — SELECT, PERMISSIVE, roles={anon,authenticated}
  - USING: `true`

### `predefined_services`

- **predefined_services_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = predefined_services.org_id)))`
- **predefined_services_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = predefined_services.org_id)))`
- **predefined_services_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = predefined_services.org_id)))`
- **predefined_services_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = predefined_services.org_id)))`
  - WITH CHECK: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = predefined_services.org_id)))`

### `processed_checkout_sessions`

- **processed_checkout_sessions_org_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `profiles`

- **profiles_insert_own** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(id = ( SELECT auth.uid() AS uid))`
- **profiles_select_own** — SELECT, PERMISSIVE, roles={public}
  - USING: `((id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1 FROM (memberships m1 JOIN memberships m2 ON ((m1.org_id = m2.org_id))) WHERE ((m1.user_id = ( SELECT auth.uid() AS uid)) AND (m2.user_id = profiles.id)))))`
- **profiles_update_own** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(id = ( SELECT auth.uid() AS uid))`
  - WITH CHECK: `(id = ( SELECT auth.uid() AS uid))`

### `promo_codes`

- **promo_codes_auth_read** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(is_active = true)`

### `proof_of_presence`

- **pop_org** — ALL, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `properties`

- **properties_delete** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **properties_insert** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **properties_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **properties_update** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `provisioning_events`

- **provisioning_events_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `push_tokens`

- **push_tokens_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `(user_id = ( SELECT auth.uid() AS uid))`
- **push_tokens_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **push_tokens_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(user_id = ( SELECT auth.uid() AS uid))`
  - WITH CHECK: `(user_id = ( SELECT auth.uid() AS uid))`
- **push_tokens_upsert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `((user_id = ( SELECT auth.uid() AS uid)) AND has_org_membership(( SELECT auth.uid() AS uid), org_id))`

### `quote_attachments`

- **quote_attachments_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_attachments.quote_id) AND has_org_membership(( SELECT auth.uid() AS uid), q.org_id))))`
- **quote_attachments_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_attachments.quote_id) AND has_org_membership(( SELECT auth.uid() AS uid), q.org_id))))`
- **quote_attachments_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_attachments.quote_id) AND has_org_membership(( SELECT auth.uid() AS uid), q.org_id))))`
- **quote_attachments_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_attachments.quote_id) AND has_org_membership(( SELECT auth.uid() AS uid), q.org_id))))`
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_attachments.quote_id) AND has_org_membership(( SELECT auth.uid() AS uid), q.org_id))))`

### `quote_line_items`

- **quote_line_items_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_line_items.quote_id) AND has_org_membership(( SELECT auth.uid() AS uid), q.org_id))))`
- **quote_line_items_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_line_items.quote_id) AND has_org_membership(( SELECT auth.uid() AS uid), q.org_id))))`
- **quote_line_items_public_read** — SELECT, PERMISSIVE, roles={anon}
  - USING: `(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_line_items.quote_id) AND (q.view_token IS NOT NULL))))`
- **quote_line_items_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_line_items.quote_id) AND has_org_membership(( SELECT auth.uid() AS uid), q.org_id))))`
- **quote_line_items_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_line_items.quote_id) AND has_org_membership(( SELECT auth.uid() AS uid), q.org_id))))`
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_line_items.quote_id) AND has_org_membership(( SELECT auth.uid() AS uid), q.org_id))))`

### `quote_measurements`

- **quote_measurements_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **quote_measurements_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **quote_measurements_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **quote_measurements_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `quote_sections`

- **quote_sections_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_sections.quote_id) AND has_org_membership(( SELECT auth.uid() AS uid), q.org_id))))`
- **quote_sections_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_sections.quote_id) AND has_org_membership(( SELECT auth.uid() AS uid), q.org_id))))`
- **quote_sections_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_sections.quote_id) AND has_org_membership(( SELECT auth.uid() AS uid), q.org_id))))`
- **quote_sections_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_sections.quote_id) AND has_org_membership(( SELECT auth.uid() AS uid), q.org_id))))`
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_sections.quote_id) AND has_org_membership(( SELECT auth.uid() AS uid), q.org_id))))`

### `quote_send_log`

- **quote_send_log_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_send_log.quote_id) AND has_org_membership(( SELECT auth.uid() AS uid), q.org_id))))`
- **quote_send_log_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_send_log.quote_id) AND has_org_membership(( SELECT auth.uid() AS uid), q.org_id))))`

### `quote_sequences`

- **quote_sequences_all** — ALL, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `quote_status_history`

- **quote_status_history_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_status_history.quote_id) AND has_org_membership(( SELECT auth.uid() AS uid), q.org_id))))`
- **quote_status_history_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM quotes q WHERE ((q.id = quote_status_history.quote_id) AND has_org_membership(( SELECT auth.uid() AS uid), q.org_id))))`

### `quote_templates`

- **quote_templates_org_member** — ALL, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `quote_views`

- **quote_views_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = quote_views.invoice_id) AND (( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = i.org_id))))))`
- **quote_views_insert_anon** — INSERT, PERMISSIVE, roles={anon}
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = quote_views.invoice_id) AND (i.deleted_at IS NULL))))`
- **quote_views_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = quote_views.invoice_id) AND (( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = i.org_id))))))`
- **quote_views_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = quote_views.invoice_id) AND (( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = i.org_id))))))`
- **quote_views_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = quote_views.invoice_id) AND (( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = i.org_id))))))`
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = quote_views.invoice_id) AND (( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = i.org_id))))))`

### `quotes`

- **quotes_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **quotes_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **quotes_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **quotes_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `rate_limits`

- **rate_limits_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(user_id = ( SELECT auth.uid() AS uid))`
- **rate_limits_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(user_id = ( SELECT auth.uid() AS uid))`

### `recurring_invoice_schedules`

- **ris_org_read** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **ris_org_write** — ALL, PERMISSIVE, roles={public}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`

### `recurring_team_schedules`

- **rts_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
- **rts_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE ((m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
- **rts_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **rts_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
  - WITH CHECK: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`

### `referrals`

- **referrals_referrer_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `((referrer_user_id = ( SELECT auth.uid() AS uid)) OR has_org_membership(( SELECT auth.uid() AS uid), referrer_org_id))`

### `reminder_log`

- **reminder_log_org_read** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `reminder_settings`

- **reminder_settings_org_read** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **reminder_settings_org_write** — ALL, PERMISSIVE, roles={public}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`

### `request_forms`

- **request_forms_admin_all** — ALL, PERMISSIVE, roles={authenticated}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`

### `review_requests`

- **review_requests_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **review_requests_service** — ALL, PERMISSIVE, roles={service_role}
  - USING: `true`
  - WITH CHECK: `true`

### `role_templates`

- **role_templates_modify** — ALL, PERMISSIVE, roles={authenticated}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
- **role_templates_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `satisfaction_surveys`

- **surveys_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **surveys_update_anon** — UPDATE, PERMISSIVE, roles={anon}
  - USING: `(submitted_at IS NULL)`
  - WITH CHECK: `(submitted_at IS NOT NULL)`

### `scenario_options`

- **scenario_options_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `((org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))) OR (org_id = ( SELECT auth.uid() AS uid)))`
- **scenario_options_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `((org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))) OR (org_id = ( SELECT auth.uid() AS uid)))`

### `scenario_runs`

- **scenario_runs_org_policy** — ALL, PERMISSIVE, roles={public}
  - USING: `((org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))) OR (org_id = ( SELECT auth.uid() AS uid)))`
  - WITH CHECK: `((org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid)))) OR (org_id = ( SELECT auth.uid() AS uid)))`

### `schedule_events`

- **schedule_events_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **schedule_events_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(has_org_membership(( SELECT auth.uid() AS uid), org_id) AND (created_by = ( SELECT auth.uid() AS uid)))`
- **schedule_events_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **schedule_events_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `scheduled_reports`

- **scheduled_reports_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **scheduled_reports_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **scheduled_reports_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **scheduled_reports_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `secret_rotation_log`

- **secret_rotation_service** — ALL, PERMISSIVE, roles={public}
  - USING: `(( SELECT auth.role() AS role) = 'service_role'::text)`

### `security_alerts`

- **security_alerts_insert_service** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(( SELECT auth.role() AS role) = 'service_role'::text)`
- **security_alerts_no_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `false`
- **security_alerts_select_admin** — SELECT, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM memberships WHERE ((memberships.org_id = security_alerts.org_id) AND (memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
- **security_alerts_update_admin** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM memberships WHERE ((memberships.org_id = security_alerts.org_id) AND (memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`

### `security_events`

- **security_events_insert_service** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(( SELECT auth.role() AS role) = 'service_role'::text)`
- **security_events_no_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `false`
- **security_events_no_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(( SELECT auth.role() AS role) = 'service_role'::text)`
- **security_events_select_admin** — SELECT, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM memberships WHERE ((memberships.org_id = security_events.org_id) AND (memberships.user_id = ( SELECT auth.uid() AS uid)) AND (memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`

### `security_incidents`

- **incidents_insert_org** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **incidents_select_org** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
- **incidents_update_admin** — UPDATE, PERMISSIVE, roles={public}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`

### `service_contracts`

- **service_contracts_delete** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **service_contracts_insert** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **service_contracts_select** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **service_contracts_update** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `sms_opt_outs`

- **sms_opt_outs_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(EXISTS ( SELECT 1 FROM memberships m WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.org_id = sms_opt_outs.org_id))))`
- **sms_opt_outs_service** — ALL, PERMISSIVE, roles={service_role}
  - USING: `true`
  - WITH CHECK: `true`

### `specific_notes`

- **specific_notes_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **specific_notes_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **specific_notes_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **specific_notes_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `subscriptions`

- **subscriptions_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **subscriptions_select_own** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) = user_id)`

### `tags`

- **tags_org_delete** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **tags_org_insert** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **tags_org_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **tags_org_update** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `tasks`

- **tasks_delete_org** — DELETE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **tasks_insert_org** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **tasks_select_org** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **tasks_update_org** — UPDATE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `tax_configs`

- **tax_configs_org** — ALL, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `tax_group_items`

- **tax_group_items_access** — ALL, PERMISSIVE, roles={public}
  - USING: `(EXISTS ( SELECT 1 FROM tax_groups g WHERE ((g.id = tax_group_items.tax_group_id) AND has_org_membership(( SELECT auth.uid() AS uid), g.org_id))))`
  - WITH CHECK: `(EXISTS ( SELECT 1 FROM tax_groups g WHERE ((g.id = tax_group_items.tax_group_id) AND has_org_membership(( SELECT auth.uid() AS uid), g.org_id))))`

### `tax_groups`

- **tax_groups_org** — ALL, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `team_assignments`

- **team_assignments_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **team_assignments_write** — ALL, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
  - WITH CHECK: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`

### `team_availability`

- **team_availability_delete_org** — DELETE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **team_availability_insert_org** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **team_availability_org_read** — SELECT, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
- **team_availability_update_org** — UPDATE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `team_capabilities`

- **team_capabilities_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **team_capabilities_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **team_capabilities_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **team_capabilities_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `team_date_slots`

- **team_date_slots_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **team_date_slots_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **team_date_slots_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **team_date_slots_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `team_members`

- **team_members_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
- **team_members_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **team_members_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **team_members_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`

### `team_schedule_assignments`

- **tsa_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
- **tsa_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE ((m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
- **tsa_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **tsa_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`
  - WITH CHECK: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))`

### `team_schedule_audit`

- **tsaud_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = auth.uid())))`
- **tsaud_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`

### `teams`

- **teams_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **teams_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **teams_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **teams_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`

### `technician_device_mappings`

- **tech_device_map_org** — ALL, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `technician_locations`

- **tech_locations_org** — ALL, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`
  - WITH CHECK: `(org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))`

### `time_entries`

- **time_entries_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = time_entries.org_id)))`
- **time_entries_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = time_entries.org_id)))`
- **time_entries_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = time_entries.org_id)))`
- **time_entries_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = time_entries.org_id)))`
  - WITH CHECK: `(( SELECT auth.uid() AS uid) IN ( SELECT memberships.user_id FROM memberships WHERE (memberships.org_id = time_entries.org_id)))`

### `time_off_requests`

- **tor_delete** — DELETE, PERMISSIVE, roles={public}
  - USING: `((org_id IN ( SELECT m.org_id FROM memberships m WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))) OR ((user_id = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::text)))`
- **tor_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `((org_id IN ( SELECT m.org_id FROM memberships m WHERE ((m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))) OR ((user_id = auth.uid()) AND (status = 'pending'::text) AND (org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = auth.uid())))))`
- **tor_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `(org_id IN ( SELECT m.org_id FROM memberships m WHERE (m.user_id = ( SELECT auth.uid() AS uid))))`
- **tor_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `((org_id IN ( SELECT m.org_id FROM memberships m WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))) OR ((user_id = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::text)))`
  - WITH CHECK: `((org_id IN ( SELECT m.org_id FROM memberships m WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))) OR ((user_id = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::text)))`

### `tracking_events`

- **tracking_events_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **tracking_events_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `tracking_live_locations`

- **tracking_live_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **tracking_live_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **tracking_live_upsert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `tracking_points`

- **tracking_points_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **tracking_points_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `tracking_sessions`

- **tracking_sessions_insert** — INSERT, PERMISSIVE, roles={public}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **tracking_sessions_select** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **tracking_sessions_update** — UPDATE, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `user_agent_preferences`

- **service_full_access** — ALL, PERMISSIVE, roles={service_role}
  - USING: `true`
  - WITH CHECK: `true`

### `webhook_deliveries`

- **wh_deliveries_org_read** — SELECT, PERMISSIVE, roles={public}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `webhook_endpoints`

- **wh_endpoints_admin_read** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
- **wh_endpoints_org_write** — ALL, PERMISSIVE, roles={public}
  - USING: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_admin_role(( SELECT auth.uid() AS uid), org_id)`

### `webhook_events`

- **webhook_events_deny** — ALL, RESTRICTIVE, roles={anon,authenticated}
  - USING: `false`
  - WITH CHECK: `false`
- **webhook_events_no_delete** — DELETE, PERMISSIVE, roles={anon,authenticated}
  - USING: `false`
- **webhook_events_no_update** — UPDATE, PERMISSIVE, roles={anon,authenticated}
  - USING: `false`
- **webhook_events_service_all** — ALL, PERMISSIVE, roles={service_role}
  - USING: `true`
  - WITH CHECK: `true`

### `workflow_edges`

- **workflow_edges_org** — ALL, PERMISSIVE, roles={public}
  - USING: `(workflow_id IN ( SELECT workflows.id FROM workflows WHERE (workflows.org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))))`
  - WITH CHECK: `(workflow_id IN ( SELECT workflows.id FROM workflows WHERE (workflows.org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))))`

### `workflow_logs`

- **workflow_logs_org** — ALL, PERMISSIVE, roles={public}
  - USING: `(run_id IN ( SELECT workflow_runs.id FROM workflow_runs WHERE (workflow_runs.org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))))`

### `workflow_nodes`

- **workflow_nodes_org** — ALL, PERMISSIVE, roles={public}
  - USING: `(workflow_id IN ( SELECT workflows.id FROM workflows WHERE (workflows.org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))))`
  - WITH CHECK: `(workflow_id IN ( SELECT workflows.id FROM workflows WHERE (workflows.org_id IN ( SELECT memberships.org_id FROM memberships WHERE (memberships.user_id = ( SELECT auth.uid() AS uid))))))`

### `workflow_runs`

- **workflow_runs_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **workflow_runs_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **workflow_runs_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **workflow_runs_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`

### `workflows`

- **workflows_delete_org** — DELETE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **workflows_insert_org** — INSERT, PERMISSIVE, roles={authenticated}
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **workflows_select_org** — SELECT, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
- **workflows_update_org** — UPDATE, PERMISSIVE, roles={authenticated}
  - USING: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`
  - WITH CHECK: `has_org_membership(( SELECT auth.uid() AS uid), org_id)`


## 4. Fonctions (319)

Corps non inclus — ils divergent, et c'est précisément ce qui a trompé
l'audit. Lire le corps réel avec :
`select prosrc from pg_proc where proname = '...'`

| Fonction | SECURITY DEFINER | search_path | Droits |
|---|---|---|---|
| `_point_in_zone_ring(p_lng double precision, p_lat double precision, geo jsonb)` → boolean | non | ❌ aucun | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `ac_actor_name()` → text | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `ac_client_name(p_client uuid)` → text | ⚠️ oui | search_path=public | service_role=X/postgres |
| `ac_fmt_dollars(p_cents integer)` → text | non | ❌ aucun | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `ac_log_event(p_org uuid, p_type text, p_entity text, p_title text, p_body text, p_l)` → void | ⚠️ oui | search_path=public | service_role=X/postgres |
| `ac_note_context(p_entity_type text, p_entity_id uuid)` → text | ⚠️ oui | search_path=public | service_role=X/postgres |
| `ac_track_activity_notes()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `ac_track_card_saved()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `ac_track_invoices()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `ac_track_payments()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `ac_track_quotes()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `ac_track_specific_notes()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `ac_track_survey_reviews()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `ai_enforce_org_scope()` → trigger | non | search_path=public | service_role=X/postgres |
| `ai_on_message_insert()` → trigger | non | search_path=public | service_role=X/postgres |
| `ai_set_updated_at()` → trigger | non | search_path=public | service_role=X/postgres |
| `anonymize_client(p_client_id uuid)` → void | ⚠️ oui | search_path=public, pg_temp | authenticated=X/postgres | service_role=X/postgres |
| `anonymize_inactive_leads(p_months integer DEFAULT 24)` → bigint | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `anonymize_lead(p_lead_id uuid)` → void | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `anonymize_old_soft_deleted_clients(p_days integer DEFAULT 180)` → bigint | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `apply_automation_presets_fr(p_org_id uuid)` → integer | ⚠️ oui | search_path=public | service_role=X/postgres |
| `apply_invoice_payment(p_invoice_id uuid, p_org_id uuid, p_amount_cents integer)` → TABLE(id uuid, paid_cents integer, balance_cents integer, status text, total_cents integer) | ⚠️ oui | search_path=public | service_role=X/postgres |
| `archive_client(p_org_id uuid, p_client_id uuid)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `archive_record(p_org_id uuid, p_entity_type text, p_entity_id uuid, p_reason text DEF)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `assign_client_number()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `assign_job_number()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `assign_org_company_group()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `audit_events_append_only()` → trigger | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `audit_log_trigger()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `auto_create_comm_settings()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `auto_pipeline_deal_from_quote()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `auto_pipeline_deal_from_quote_impl(new quotes)` → void | ⚠️ oui | search_path=public | service_role=X/postgres |
| `auto_pipeline_deal_from_quote_update()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `automation_invoice_overdue_check()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `automation_job_completed()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `automation_lead_stage_change()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `batch_restore(p_org_id uuid, p_entity_type text, p_entity_ids uuid[])` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `batch_soft_delete(p_org_id uuid, p_entity_type text, p_entity_ids uuid[])` → jsonb | ⚠️ oui | search_path=public | service_role=X/postgres |
| `batch_soft_delete_clients(p_org_id uuid, p_client_ids uuid[])` → jsonb | ⚠️ oui | search_path=public | service_role=X/postgres | authenticated=X/postgres |
| `build_client_fts_vector(r clients)` → tsvector | non | search_path=public | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `build_invoice_fts_vector(r invoices)` → tsvector | non | search_path=public | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `build_job_fts_vector(r jobs)` → tsvector | non | search_path=public | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `bump_row_version()` → trigger | non | search_path="" | service_role=X/postgres |
| `business_days_between(p_start date, p_end date)` → integer | non | search_path=public | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `cancel_hard_delete_member(p_member_id uuid)` → void | ⚠️ oui | search_path=public, pg_temp | authenticated=X/postgres | service_role=X/postgres |
| `check_all_invariants()` → TABLE(check_name text, failures bigint, detail text) | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `check_availability_overlap()` → trigger | non | search_path=public, pg_temp | service_role=X/postgres |
| `check_cross_tenant_references()` → TABLE(relation text, violations bigint) | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `check_custom_field_orphans()` → TABLE(value_id uuid, org_id uuid, entity text, record_id uuid) | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `check_exposed_trigger_functions()` → TABLE(function_name text, exposed_to text) | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `check_failing_cron_jobs()` → TABLE(jobname text, failures_7d bigint, last_error text) | ⚠️ oui | search_path=public, pg_catalog, pg_temp | service_role=X/postgres |
| `check_invoice_numbering_invariant()` → TABLE(org_id uuid, invoice_number text, occurrences bigint) | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `check_invoice_totals_balance()` → TABLE(invoice_id uuid, org_id uuid, invoice_number text, stored_subtotal_cents integer, computed_subtotal_cents bigint) | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `check_password_strength(p_password text)` → jsonb | non | search_path=public | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `check_rate_limit(p_key text, p_max_tokens integer DEFAULT 60, p_refill_rate integer DEF)` → boolean | ⚠️ oui | search_path=public | service_role=X/postgres |
| `check_rate_limit(p_action text, p_max_per_minute integer DEFAULT 60)` → boolean | ⚠️ oui | search_path=public | service_role=X/postgres |
| `check_rls_coverage()` → TABLE(table_name text, rls_enabled boolean, rls_forced boolean, policy_count bigint) | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `check_subscription_active(p_org_id uuid)` → boolean | ⚠️ oui | search_path=public | service_role=X/postgres |
| `check_team_schedule_assignment()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `claim_next_invoice_number(p_org uuid)` → bigint | ⚠️ oui | search_path=public | service_role=X/postgres |
| `cleanup_expired_oauth_states()` → jsonb | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `cleanup_expired_pipeline_deals()` → jsonb | ⚠️ oui | search_path=public | service_role=X/postgres |
| `cleanup_lost_pipeline_deals()` → integer | ⚠️ oui | search_path=public | service_role=X/postgres |
| `cleanup_rate_limits()` → void | ⚠️ oui | search_path=public | service_role=X/postgres |
| `clients_auto_property_from_address()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `clients_before_insert_set_org()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `convert_currency(p_amount_cents integer, p_from_currency text, p_to_currency text, p_da)` → integer | non | search_path=public | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `convert_lead_to_client(p_lead_id uuid)` → uuid | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `create_client_with_duplicate_handling(p_org_id uuid, p_mode text, p_payload jsonb, p_merge_duplicates boolea)` → clients | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `create_field_pin_for_client_row(c clients)` → uuid | ⚠️ oui | search_path=public | service_role=X/postgres |
| `create_incident(p_title text, p_type text, p_severity text, p_description text DEFAULT)` → uuid | ⚠️ oui | search_path=public, pg_temp | authenticated=X/postgres | service_role=X/postgres |
| `create_invoice_from_job(p_org_id uuid, p_job_id uuid, p_send_now boolean DEFAULT false)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `create_invoice_from_job(p_org_id uuid, p_job_id uuid)` → jsonb | ⚠️ oui | search_path=public | service_role=X/postgres |
| `create_invoice_from_milestone(p_org_id uuid, p_job_id uuid, p_milestone_id uuid, p_send_now boolean )` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `create_job_from_intent(p_intent_id uuid, p_lead_id uuid, p_title text, p_address text DEFAULT)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `create_job_from_lead(p_org_id uuid, p_lead_id uuid, p_payload jsonb)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `create_job_from_lead(p_org_id uuid, p_lead_id uuid, p_title text DEFAULT NULL::text, p_stat)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `create_job_from_lead(p_org_id uuid, p_lead_id uuid, p_title text DEFAULT NULL::text, p_addr)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `create_lead_with_client(p_org_id uuid, p_payload jsonb)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `create_or_get_invoice_from_job(p_org_id uuid, p_job_id uuid)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `create_pipeline_deal(p_lead_id uuid, p_title text, p_value numeric, p_stage text DEFAULT 'n)` → uuid | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `crm_enforce_scope()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `crm_invoices_ensure_number()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `crm_is_org_admin(p_org_id uuid, p_user_id uuid DEFAULT auth.uid())` → boolean | non | search_path=public | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `crm_is_org_member(p_org_id uuid, p_user_id uuid DEFAULT auth.uid())` → boolean | non | search_path=public | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `crm_leads_stage_timestamps()` → trigger | non | search_path=public | service_role=X/postgres |
| `crm_next_invoice_number(p_org_id uuid)` → text | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `crm_normalize_lead_stage(p_value text)` → text | non | search_path=public | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `current_org_id()` → uuid | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `current_org_ids()` → SETOF uuid | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `custom_access_token_hook(event jsonb)` → jsonb | ⚠️ oui | search_path=public | service_role=X/postgres | supabase_auth_admin=X/postgres |
| `decay_few_shot_scores()` → void | ⚠️ oui | search_path=public | service_role=X/postgres |
| `delete_client_cascade(p_org_id uuid, p_client_id uuid, p_deleted_by uuid DEFAULT NULL::uuid)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `delete_invoice_cascade(p_org_id uuid, p_invoice_id uuid)` → void | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `delete_job_cascade(p_org_id uuid, p_job_id uuid)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `delete_lead_and_optional_client(p_org_id uuid, p_lead_id uuid, p_also_delete_client boolean DEFAULT fa)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `delete_lead_cascade(p_org_id uuid, p_lead_id uuid)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `delete_quote_cascade(p_org_id uuid, p_quote_id uuid)` → void | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `detect_brute_force(p_user_id uuid, p_window_minutes integer DEFAULT 15, p_threshold integ)` → boolean | ⚠️ oui | search_path=public | service_role=X/postgres |
| `detect_excessive_exports(p_user_id uuid, p_org_id uuid, p_window_minutes integer DEFAULT 10, p_)` → boolean | ⚠️ oui | search_path=public | service_role=X/postgres |
| `detect_impossible_travel(p_user_id uuid, p_country text)` → boolean | ⚠️ oui | search_path=public | service_role=X/postgres |
| `detect_login_anomalies(p_minutes integer DEFAULT 15)` → TABLE(kind text, key text, count bigint) | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `detect_mass_deletion(p_user_id uuid, p_org_id uuid, p_window_minutes integer DEFAULT 5, p_t)` → boolean | ⚠️ oui | search_path=public | service_role=X/postgres |
| `enforce_invoice_immutability()` → trigger | non | search_path="" | service_role=X/postgres |
| `enforce_membership_role_change()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `enforce_soft_delete_admin()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `enforce_tenant()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `enforce_tenant_consistency()` → trigger | non | search_path=public, app | service_role=X/postgres |
| `enforce_zone_exclusivity()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `ensure_field_pin_for_client()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `ensure_payment_settings_row(p_org uuid)` → payment_provider_settings | ⚠️ oui | search_path=public | service_role=X/postgres |
| `execute_scheduled_member_deletions()` → bigint | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `export_client_data(p_client_id uuid)` → jsonb | ⚠️ oui | search_path=public, pg_temp | authenticated=X/postgres | service_role=X/postgres |
| `export_user_data(p_user_id uuid)` → jsonb | ⚠️ oui | search_path=public, pg_temp | authenticated=X/postgres | service_role=X/postgres |
| `field_compute_house_score(p_house_id uuid)` → text | non | search_path=public, pg_temp | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `field_compute_next_action(p_house_id uuid)` → text | non | search_path=public, pg_temp | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `fill_property_id_from_job_or_client()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `find_duplicate_clients(p_org_id uuid, p_first_name text DEFAULT NULL::text, p_last_name text )` → TABLE(client_id uuid, first_name text, last_name text, email text, phone text, company text, similarity_score real) | ⚠️ oui | search_path=public | service_role=X/postgres |
| `finish_job(p_org_id uuid, p_job_id uuid)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `finish_job_and_prepare_invoice(p_org_id uuid, p_job_id uuid)` → TABLE(ok boolean, invoice_id uuid, already_exists boolean) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `fn_field_daily_stats_apply()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `fn_push_on_notification()` → trigger | ⚠️ oui | search_path=public, extensions, net | service_role=X/postgres |
| `format_montreal_date(ts timestamp with time zone, fmt text DEFAULT 'YYYY-MM-DD HH24:MI'::te)` → text | non | search_path=public | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `generate_invoice_from_template(p_org_id uuid, p_template_id uuid, p_client_id uuid, p_job_id uuid DEF)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `generate_task_public_id()` → trigger | non | search_path=public, pg_temp | service_role=X/postgres |
| `generate_workflow_public_id()` → trigger | non | search_path=public, pg_temp | service_role=X/postgres |
| `get_audit_log(p_org_id uuid, p_entity_type text DEFAULT NULL::text, p_entity_id uuid)` → TABLE(id uuid, actor_id uuid, action text, entity_type text, entity_id uuid, event_type text, old_values jsonb, new_values jsonb, metadata jsonb, created_at timestamp with time zone) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `get_available_slots(p_org_id uuid, p_team_id uuid DEFAULT NULL::uuid, p_start_date date DE)` → TABLE(slot_start timestamp with time zone, slot_end timestamp with time zone, team_id uuid) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `get_entity_activity(p_org_id uuid, p_entity_type text, p_entity_id uuid, p_limit integer D)` → TABLE(event_id uuid, action text, event_type text, actor_id uuid, metadata jsonb, created_at timestamp with time zone) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `get_invoice_next_number(p_org uuid)` → integer | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `get_job(p_org_id uuid, p_job_id uuid)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `get_job_kpis(p_org_id uuid, p_status text DEFAULT NULL::text, p_job_type text DEFAU)` → TABLE(ending_within_30 integer, late integer, requires_invoicing integer, action_required integer, unscheduled integer, recent_visits integer, recent_visits_prev integer, visits_scheduled integer, visits_scheduled_prev integer) | non | search_path=public | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `grant_object_permission(p_org_id uuid, p_entity_type text, p_entity_id uuid, p_user_id uuid, p)` → uuid | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `handle_new_user()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `handle_org_created_seed_automations()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `hard_delete_client(p_org_id uuid, p_client_id uuid)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `has_object_permission(p_user_id uuid, p_org_id uuid, p_entity_type text, p_entity_id uuid, p)` → boolean | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `has_org_admin_role(p_user uuid, p_org uuid)` → boolean | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `has_org_membership(target_org uuid)` → boolean | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `has_org_membership(p_user uuid, p_org uuid)` → boolean | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `has_org_role(p_user uuid, p_org uuid, p_roles text[])` → boolean | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `haversine_distance(lat1 double precision, lng1 double precision, lat2 double precision, l)` → double precision | non | search_path=public, pg_temp | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `increment_few_shot_usage(p_id uuid)` → void | ⚠️ oui | search_path=public | service_role=X/postgres |
| `increment_unread_count(p_conversation_id uuid)` → void | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `invalidate_all_sessions(p_user_id uuid, p_reason text DEFAULT 'manual'::text)` → integer | ⚠️ oui | search_path=public | service_role=X/postgres |
| `invoice_items_recalculate_parent()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `invoice_items_set_line_total()` → trigger | non | search_path=public | service_role=X/postgres |
| `invoice_items_sync_org()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `invoice_next_number(p_org uuid)` → text | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `invoices_apply_status_logic()` → trigger | non | search_path=public | service_role=X/postgres |
| `is_email_opted_out(p_email text, p_org_id uuid DEFAULT NULL::uuid)` → boolean | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `is_ip_blocked(check_ip inet, check_org_id uuid DEFAULT NULL::uuid)` → boolean | ⚠️ oui | search_path=public | service_role=X/postgres |
| `is_sms_opted_out(p_org uuid, p_phone text)` → boolean | non | search_path=public, pg_temp | authenticated=X/postgres | service_role=X/postgres |
| `is_valid_timezone(p_tz text)` → boolean | non | search_path=pg_catalog, pg_temp | =X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `job_agreements_enforce_job_only()` → trigger | non | search_path=public | service_role=X/postgres |
| `job_line_items_set_totals()` → trigger | non | search_path=public | service_role=X/postgres |
| `jobs_fill_property_id()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `jobs_sync_address()` → trigger | non | search_path=public, pg_temp | service_role=X/postgres |
| `jobs_sync_future_events_team()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `jobs_sync_totals()` → trigger | non | search_path=public, app | service_role=X/postgres |
| `leads_before_insert_enforce_scope()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `leads_force_org_id()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `leads_set_updated_at()` → trigger | non | search_path=public, app | service_role=X/postgres |
| `list_archived_items(p_org_id uuid)` → jsonb | ⚠️ oui | search_path=public, pg_temp | authenticated=X/postgres | service_role=X/postgres |
| `list_member_audit_events(p_user_id uuid, p_limit integer DEFAULT 200)` → SETOF audit_events | ⚠️ oui | search_path=public, pg_temp | authenticated=X/postgres | service_role=X/postgres |
| `log_invoice_updated()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `log_job_created()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `log_job_updated()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `log_quote_created()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `lume_storage_is_legacy_path(object_name text)` → boolean | non | search_path="" | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `lume_storage_object_org(object_name text)` → uuid | non | search_path="" | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `mark_job_geocode_pending()` → trigger | non | search_path=public | service_role=X/postgres |
| `next_recurrence_at(p_from timestamp with time zone, p_frequency text, p_interval integer )` → timestamp with time zone | non | search_path=public, pg_temp | =X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `normalize_lead_stage_value(p_value text)` → text | non | search_path=public | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `normalize_phone(p_phone text)` → text | non | search_path=public, pg_temp | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `normalize_phone_digits(p text)` → text | non | search_path=public | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `on_pipeline_deal_stage_change()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `org_has_no_members(p_org uuid)` → boolean | ⚠️ oui | search_path=public | service_role=X/postgres | authenticated=X/postgres |
| `org_is_within_bootstrap_window(p_org uuid)` → boolean | ⚠️ oui | search_path=public, pg_temp | authenticated=X/postgres | service_role=X/postgres |
| `org_smallest_free_number(p_org uuid, p_entity text)` → bigint | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `payments_recalculate_invoice_trigger()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `payments_sync_dates_and_update()` → trigger | non | search_path=public | service_role=X/postgres |
| `payments_sync_legacy_dates()` → trigger | non | search_path=public | service_role=X/postgres |
| `pipeline_deals_cascade_client_soft_delete()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `pipeline_deals_emit_job_intent()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `pipeline_deals_sync_value_columns()` → trigger | non | search_path=public, app | service_role=X/postgres |
| `pipeline_deals_sync_values()` → trigger | non | search_path=public | service_role=X/postgres |
| `prevent_paid_invoice_edit()` → trigger | non | search_path=public, pg_temp | service_role=X/postgres |
| `provision_sms_channel(p_org_id uuid, p_phone_number text, p_provider text DEFAULT 'twilio'::)` → uuid | ⚠️ oui | search_path=public | service_role=X/postgres |
| `purge_expired_portal_tokens()` → bigint | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `purge_old_audit_events(p_retention_days integer DEFAULT 1095)` → bigint | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `purge_old_failed_logins()` → bigint | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `purge_old_location_data(p_days integer DEFAULT 180)` → jsonb | ⚠️ oui | search_path="" | service_role=X/postgres |
| `purge_old_soft_deletes(p_org_id uuid, p_days integer DEFAULT 90)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `quote_line_items_set_total()` → trigger | non | search_path=public, pg_temp | service_role=X/postgres |
| `quote_measurements_updated_at()` → trigger | non | search_path=public, pg_temp | service_role=X/postgres |
| `recalculate_calibration(p_org uuid, p_domain text)` → void | ⚠️ oui | search_path=public | service_role=X/postgres |
| `recalculate_invoice_from_payments(p_invoice_id uuid)` → void | ⚠️ oui | search_path=public | service_role=X/postgres |
| `recalculate_invoice_totals(p_invoice_id uuid)` → void | ⚠️ oui | search_path=public | service_role=X/postgres |
| `recalculate_job_totals_from_items()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `recompute_job_schedule(p_job_id uuid)` → void | ⚠️ oui | search_path=public | service_role=X/postgres |
| `record_consent(p_subject_type text, p_subject_id uuid, p_purpose text, p_granted bool)` → uuid | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `record_email_opt_out(p_email text, p_org_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT )` → void | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `record_failed_login(p_email text, p_ip inet DEFAULT NULL::inet, p_user_agent text DEFAULT )` → void | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `release_advisory_lock(p_key bigint)` → boolean | ⚠️ oui | search_path=public | service_role=X/postgres |
| `request_hard_delete_member(p_member_id uuid, p_reassign_to uuid)` → void | ⚠️ oui | search_path=public, pg_temp | authenticated=X/postgres | service_role=X/postgres |
| `resolve_primary_property(p_client_id uuid)` → uuid | ⚠️ oui | search_path=public | service_role=X/postgres |
| `restore_archived_record(p_org_id uuid, p_entity_type text, p_entity_id uuid)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `restore_client(p_org_id uuid, p_client_id uuid)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `restore_job(p_org_id uuid, p_job_id uuid)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `restore_lead(p_org_id uuid, p_lead_id uuid)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `reverse_invoice_payment(p_invoice_id uuid, p_org_id uuid, p_amount_cents integer)` → TABLE(id uuid, paid_cents integer, balance_cents integer, status text) | ⚠️ oui | search_path=public | service_role=X/postgres |
| `revoke_object_permission(p_org_id uuid, p_entity_type text, p_entity_id uuid, p_user_id uuid)` → void | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_add_visit(p_job_id uuid, p_start_at timestamp with time zone, p_end_at timestamp)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_ai_recent_conversations(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)` → TABLE(id uuid, title text, model text, provider text, status text, client_id uuid, client_name text, last_message_preview text, last_message_role text, last_message_at timestamp with time zone, message_count integer, total_input_tokens integer, total_output_tokens integer, total_estimated_cost numeric, created_at timestamp with time zone) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_ceo_dashboard(p_org_id uuid)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_create_invoice_draft(p_client_id uuid, p_subject text DEFAULT NULL::text, p_due_date date D)` → TABLE(id uuid, invoice_number text, status text, subject text, due_date date, total_cents integer, balance_cents integer, created_at timestamp with time zone) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_create_job_with_optional_schedule(p_lead_id uuid DEFAULT NULL::uuid, p_client_id uuid DEFAULT NULL::uuid)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_create_quote(p_lead_id uuid DEFAULT NULL::uuid, p_client_id uuid DEFAULT NULL::uuid)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_database_stats(p_org_id uuid)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_find_free_slots(p_team_id uuid DEFAULT NULL::uuid, p_date date DEFAULT CURRENT_DATE, p)` → TABLE(slot_date date, team_id uuid, team_name text, team_color text, slot_start timestamp with time zone, slot_end timestamp with time zone, duration_minutes integer) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_insights_budget_vs_actual(p_org uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to da)` → TABLE(month_label text, metric text, target_value bigint, actual_value bigint, variance_pct numeric) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_insights_churn_risk(p_org uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)` → TABLE(client_id uuid, client_name text, email text, total_jobs bigint, total_revenue_cents bigint, last_activity_at timestamp with time zone, days_inactive integer, overdue_invoices bigint, overdue_amount_cents bigint, churn_risk_score numeric, risk_level text) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_insights_client_lifetime_value(p_org uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)` → TABLE(client_id uuid, client_name text, first_job_at timestamp with time zone, tenure_days integer, total_jobs bigint, total_revenue_cents bigint, avg_job_value_cents bigint, last_activity_at timestamp with time zone, days_since_last_activity integer, clv_score numeric) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_insights_cohort_retention(p_org uuid DEFAULT NULL::uuid)` → TABLE(cohort_month text, months_after integer, cohort_size bigint, active_count bigint, retention_pct numeric) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_insights_invoices_summary(p_org uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to da)` → TABLE(count_draft bigint, count_sent bigint, count_paid bigint, count_past_due bigint, total_outstanding_cents bigint, avg_payment_time_days numeric) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_insights_job_profitability(p_org uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to da)` → TABLE(total_jobs bigint, total_revenue_cents bigint, total_cost_cents bigint, gross_margin_cents bigint, margin_pct numeric, avg_revenue_per_job_cents bigint, avg_cost_per_job_cents bigint, profitable_jobs bigint, unprofitable_jobs bigint) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_insights_lead_conversion(p_org uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to da)` → TABLE(leads_created bigint, leads_closed bigint, conversion_rate numeric, breakdown jsonb) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_insights_overview(p_org uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to da)` → TABLE(new_leads_count bigint, converted_quotes_count bigint, new_oneoff_jobs_count bigint, invoiced_value_cents bigint, revenue_cents bigint, requests_count bigint) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_insights_period_comparison(p_org uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to da)` → TABLE(metric text, current_value bigint, previous_value bigint, change_pct numeric) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_insights_pipeline_velocity(p_org uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to da)` → TABLE(total_deals bigint, won_deals bigint, lost_deals bigint, win_rate numeric, avg_deal_value_cents bigint, avg_days_to_close numeric) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_insights_revenue_forecast(p_org uuid DEFAULT NULL::uuid)` → TABLE(month_start date, projected_cents bigint, source text) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_insights_revenue_series(p_org uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to da)` → TABLE(bucket_start date, revenue_cents bigint, invoiced_cents bigint) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_insights_team_performance(p_org uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to da)` → TABLE(team_id uuid, team_name text, jobs_count bigint, jobs_completed bigint, completion_rate numeric, revenue_cents bigint, avg_job_value_cents bigint) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_invoices_kpis_30d(p_org uuid DEFAULT NULL::uuid)` → TABLE(past_due_count bigint, past_due_total_cents bigint, sent_not_due_count bigint, sent_not_due_total_cents bigint, draft_count bigint, draft_total_cents bigint, issued_30d_count bigint, issued_30d_total_cents bigint, avg_invoice_30d_cents bigint, avg_payment_time_days_30d numeric) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_list_invoices(p_status text DEFAULT 'all'::text, p_range text DEFAULT 'all'::text, p)` → TABLE(id uuid, client_id uuid, client_name text, invoice_number text, status text, subject text, issued_at timestamp with time zone, due_date date, total_cents integer, balance_cents integer, paid_cents integer, created_at timestamp with time zone, updated_at timestamp with time zone, total_count bigint) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_list_payments(p_status text DEFAULT 'all'::text, p_method text DEFAULT 'all'::text, )` → TABLE(id uuid, client_id uuid, client_name text, invoice_id uuid, invoice_number text, payment_date timestamp with time zone, payout_date timestamp with time zone, status text, method text, amount_cents integer, currency text, total_count bigint) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_payments_overview(p_org uuid DEFAULT NULL::uuid)` → TABLE(available_funds_cents bigint, invoice_payment_time_days_30d numeric, paid_on_time_global_pct_60d numeric, paid_on_time_residential_pct_60d numeric, paid_on_time_commercial_pct_60d numeric, has_property_split boolean) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_payments_overview_kpis(p_org uuid DEFAULT NULL::uuid, p_now timestamp with time zone DEFAULT )` → TABLE(available_funds_cents bigint, invoice_payment_time_days_30d numeric, paid_on_time_global_pct_60d numeric, paid_on_time_residential_pct_60d numeric, paid_on_time_commercial_pct_60d numeric, has_segment_split boolean) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_peek_next_numbers()` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_recalculate_quote(p_quote_id uuid)` → void | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_reschedule_event(p_event_id uuid, p_start_at timestamp with time zone, p_end_at timesta)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_revenue_by_currency(p_org_id uuid, p_from date DEFAULT (CURRENT_DATE - '30 days'::interval)` → TABLE(currency text, total_cents bigint, payment_count integer, cad_equivalent_cents bigint) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_save_invoice_draft(p_invoice_id uuid, p_subject text DEFAULT NULL::text, p_due_date date )` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_schedule_job(p_job_id uuid, p_start_at timestamp with time zone, p_end_at timestamp)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_team_workload(p_org_id uuid, p_from date DEFAULT CURRENT_DATE, p_to date DEFAULT (CU)` → TABLE(team_id uuid, team_name text, team_color text, scheduled_jobs integer, total_hours numeric, utilization_pct numeric) | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_unschedule_job(p_job_id uuid, p_event_id uuid DEFAULT NULL::uuid)` → void | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `rpc_update_entity_number(p_entity text, p_id uuid, p_number text)` → text | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `run_invariant_checks()` → integer | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `run_retention_job()` → jsonb | ⚠️ oui | search_path=public, pg_temp | service_role=X/postgres |
| `run_security_canary()` → void | ⚠️ oui | search_path="" | service_role=X/postgres |
| `same_company_orgs(p_user uuid)` → SETOF uuid | ⚠️ oui | search_path=public | service_role=X/postgres |
| `sanitize_text(p_input text)` → text | non | search_path=public | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `save_note_history()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `schedule_events_apply_job_team_default()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `schedule_events_sync_time_columns()` → trigger | non | search_path=public | service_role=X/postgres |
| `search_fts(p_org_id uuid, p_query text, p_entity_type text DEFAULT NULL::text, p_)` → TABLE(entity_type text, entity_id uuid, title text, subtitle text, rank real, created_at timestamp with time zone) | ⚠️ oui | search_path=public | service_role=X/postgres |
| `search_global(p_org uuid, p_q text, p_limit integer DEFAULT 20, p_offset integer DEF)` → TABLE(entity_type text, entity_id uuid, title text, subtitle text, extra_status text, extra_amount_cents bigint, extra_currency text, extra_date timestamp with time zone, extra_client_id uuid, extra_client_name text, created_at timestamp with time zone, rank integer) | ⚠️ oui | search_path="" | service_role=X/postgres |
| `search_global_by_type(p_org uuid, p_q text, p_entity_type text, p_limit integer DEFAULT 20, )` → TABLE(entity_type text, entity_id uuid, title text, subtitle text, extra_status text, extra_amount_cents integer, extra_currency text, extra_date text, extra_client_id uuid, extra_client_name text, created_at timestamp with time zone, rank double precision) | ⚠️ oui | search_path=public, extensions | service_role=X/postgres |
| `search_global_counts(p_org uuid, p_q text)` → TABLE(entity_type text, total bigint) | ⚠️ oui | search_path=public, extensions | service_role=X/postgres |
| `search_global_source(p_org uuid, p_q text)` → TABLE(entity_type text, entity_id uuid, title text, subtitle text, extra_status text, extra_amount_cents integer, extra_currency text, extra_date text, extra_client_id uuid, extra_client_name text, created_at timestamp with time zone, rank double precision) | ⚠️ oui | search_path=public, extensions | authenticated=X/postgres | service_role=X/postgres |
| `security_maintenance()` → void | ⚠️ oui | search_path=public | service_role=X/postgres |
| `seed_automation_presets(p_org_id uuid)` → integer | ⚠️ oui | search_path=public | service_role=X/postgres |
| `send_invoice(p_org_id uuid, p_invoice_id uuid, p_channel text, p_to text)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `set_activity_notes_updated_at()` → trigger | ⚠️ oui | search_path="" | service_role=X/postgres |
| `set_app_connections_updated_at()` → trigger | ⚠️ oui | search_path="" | service_role=X/postgres |
| `set_automation_rules_updated_at()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `set_connected_accounts_updated_at()` → trigger | non | search_path=public | service_role=X/postgres |
| `set_deal_stage(p_deal_id uuid, p_stage text)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `set_email_accounts_updated_at()` → trigger | ⚠️ oui | search_path="" | service_role=X/postgres |
| `set_email_templates_updated_at()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `set_email_threads_updated_at()` → trigger | ⚠️ oui | search_path="" | service_role=X/postgres |
| `set_invoice_client_snapshot()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `set_invoice_next_number(p_org uuid, p_next integer)` → void | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `set_jobs_updated_at()` → trigger | non | search_path=public | service_role=X/postgres |
| `set_member_mfa_required(p_member_id uuid, p_required boolean)` → void | ⚠️ oui | search_path=public, pg_temp | authenticated=X/postgres | service_role=X/postgres |
| `set_note_updated_at()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `set_notes_updated_at()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `set_payment_requests_updated_at()` → trigger | non | search_path=public | service_role=X/postgres |
| `set_team_date_slots_updated_at()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `set_team_schedule_updated_at()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `set_updated_at()` → trigger | non | search_path=public | service_role=X/postgres |
| `soft_delete_client(p_org_id uuid, p_client_id uuid)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `soft_delete_client_conditional(p_org_id uuid, p_client_id uuid)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `soft_delete_job(p_org_id uuid, p_job_id uuid)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `sync_auth_telemetry()` → TABLE(nouvelles_connexions integer, sessions_suivies integer, sessions_expirees integer) | ⚠️ oui | search_path=public, auth, pg_temp | service_role=X/postgres |
| `sync_field_pin_from_client()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `sync_job_leaderboard_deal()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `sync_lead_or_client_contact()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `sync_lead_stage_from_deal()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `sync_legacy_money_columns()` → trigger | non | search_path=public, pg_temp | service_role=X/postgres |
| `sync_notification_is_read()` → trigger | non | search_path=public, pg_temp | service_role=X/postgres |
| `sync_schedule_event_time_columns()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `tasks_update_timestamp()` → trigger | non | search_path=public, pg_temp | service_role=X/postgres |
| `touch_org_billing_settings_updated_at()` → trigger | non | search_path=public | service_role=X/postgres |
| `trg_agent_messages_after_insert()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `trg_agent_sessions_updated_at()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `trg_auto_invoice_on_job_completed()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `trg_clients_fts_update()` → trigger | non | search_path=public | service_role=X/postgres |
| `trg_invoices_fts_update()` → trigger | non | search_path=public | service_role=X/postgres |
| `trg_jobs_fts_update()` → trigger | non | search_path=public | service_role=X/postgres |
| `trg_leads_fts_update()` → trigger | non | search_path=public | service_role=X/postgres |
| `trg_membership_change_audit()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `trg_memory_entities_updated_at()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `trg_normalize_lead_stage()` → trigger | non | search_path=public | service_role=X/postgres |
| `trg_org_features_updated_at()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `trg_payment_to_invoice_paid()` → trigger | ⚠️ oui | search_path=public | service_role=X/postgres |
| `trigger_sms_number_release()` → void | ⚠️ oui | search_path=public, vault, net | service_role=X/postgres |
| `try_advisory_lock(p_key bigint)` → boolean | ⚠️ oui | search_path=public | service_role=X/postgres |
| `unaccent(text)` → text | non | search_path=extensions | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `update_comm_updated_at()` → trigger | non | search_path=public | service_role=X/postgres |
| `update_conversation_on_message()` → trigger | non | search_path=public | service_role=X/postgres |
| `update_org_knowledge_updated_at()` → trigger | non | search_path=public, pg_temp | service_role=X/postgres |
| `update_specific_notes_updated_at()` → trigger | non | search_path=public, pg_temp | service_role=X/postgres |
| `upsert_job(p_org_id uuid, p_job_id uuid, p_payload jsonb)` → jsonb | ⚠️ oui | search_path=public | authenticated=X/postgres | service_role=X/postgres |
| `user_org_ids(p_user_id uuid)` → SETOF uuid | ⚠️ oui | search_path=public | service_role=X/postgres |
| `validate_e164(p_phone text)` → boolean | non | search_path=public | =X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres |
| `verify_org_access(p_user_id uuid, p_org_id uuid)` → boolean | ⚠️ oui | search_path=public, pg_temp | authenticated=X/postgres | service_role=X/postgres |
| `webhook_payment_received(p_org_id uuid, p_invoice_id uuid, p_provider text, p_provider_payment_)` → jsonb | ⚠️ oui | search_path=public | service_role=X/postgres |

## 5. Vues (11)

- `clients_active` — security_invoker=true
- `jobs_active` — security_invoker=on
- `org_a2p_status` — security_invoker=on
- `pipeline_deals_active` — security_invoker=true
- `pipeline_deals_visible` — security_invoker=true
- `properties_active` — security_invoker=on
- `schedule_events_active` — security_invoker=true
- `tasks_active` — security_invoker=on
- `team_availability_active` — security_invoker=true
- `v_revenue_analytics` — security_invoker=true
- `v_schedule_calendar` — security_invoker=true

## 6. Contraintes (1064)


### `a2p_registrations`

- `a2p_registrations_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `a2p_registrations_org_id_key` — UNIQUE (org_id)
- `a2p_registrations_pkey` — PRIMARY KEY (id)

### `active_sessions`

- `active_sessions_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE SET NULL
- `active_sessions_pkey` — PRIMARY KEY (id)
- `active_sessions_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

### `activity_log`

- `activity_log_actor_id_fkey` — FOREIGN KEY (actor_id) REFERENCES auth.users(id)
- `activity_log_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `activity_log_pkey` — PRIMARY KEY (id)

### `activity_notes`

- `activity_notes_actor_id_fkey` — FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL
- `activity_notes_entity_type_check` — CHECK ((entity_type = ANY (ARRAY['client'::text, 'job'::text])))
- `activity_notes_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `activity_notes_pkey` — PRIMARY KEY (id)

### `agent_messages`

- `agent_messages_message_type_check` — CHECK ((message_type = ANY (ARRAY['text'::text, 'scenario'::text, 'approval_request'::text, 'approval_response'::text, 'tool_result'::text])))
- `agent_messages_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `agent_messages_org_id_id_uq` — UNIQUE (org_id, id)
- `agent_messages_pkey` — PRIMARY KEY (id)
- `agent_messages_role_check` — CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text, 'tool'::text])))

### `alert_rules`

- `alert_rules_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `alert_rules_org_id_rule_type_key` — UNIQUE (org_id, rule_type)
- `alert_rules_pkey` — PRIMARY KEY (id)

### `api_keys`

- `api_keys_created_by_fkey` — FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE
- `api_keys_key_hash_key` — UNIQUE (key_hash)
- `api_keys_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `api_keys_pkey` — PRIMARY KEY (id)

### `app_connections`

- `app_connections_auth_type_check` — CHECK ((auth_type = ANY (ARRAY['oauth'::text, 'api_key'::text, 'credentials'::text, 'manual'::text, 'internal'::text])))
- `app_connections_connected_by_fkey` — FOREIGN KEY (connected_by) REFERENCES auth.users(id)
- `app_connections_last_test_result_check` — CHECK ((last_test_result = ANY (ARRAY['success'::text, 'failure'::text, NULL::text])))
- `app_connections_org_id_app_id_key` — UNIQUE (org_id, app_id)
- `app_connections_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `app_connections_org_id_id_uq` — UNIQUE (org_id, id)
- `app_connections_pkey` — PRIMARY KEY (id)
- `app_connections_status_check` — CHECK ((status = ANY (ARRAY['not_connected'::text, 'setup_required'::text, 'pending_authorization'::text, 'connected'::text, 'token_expired'::text, 'reconnect_required'::text, 'error'::text, 'disabled'::text])))

### `applied_taxes`

- `applied_taxes_document_type_check` — CHECK ((document_type = ANY (ARRAY['quote'::text, 'invoice'::text])))
- `applied_taxes_pkey` — PRIMARY KEY (id)
- `applied_taxes_tax_config_id_fkey` — FOREIGN KEY (tax_config_id) REFERENCES tax_configs(id) ON DELETE SET NULL

### `approvals`

- `approvals_decision_log_id_fkey` — FOREIGN KEY (decision_log_id) REFERENCES decision_logs(id) ON DELETE SET NULL
- `approvals_decision_log_id_same_org` — FOREIGN KEY (org_id, decision_log_id) REFERENCES decision_logs(org_id, id)
- `approvals_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `approvals_pkey` — PRIMARY KEY (id)
- `approvals_responded_by_fkey` — FOREIGN KEY (responded_by) REFERENCES auth.users(id)
- `approvals_status_check` — CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'expired'::text])))

### `audit_events`

- `audit_events_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `audit_events_pkey` — PRIMARY KEY (id)

### `automation_execution_logs`

- `automation_execution_logs_automation_rule_id_fkey` — FOREIGN KEY (automation_rule_id) REFERENCES automation_rules(id) ON DELETE SET NULL
- `automation_execution_logs_automation_rule_id_same_org` — FOREIGN KEY (org_id, automation_rule_id) REFERENCES automation_rules(org_id, id)
- `automation_execution_logs_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `automation_execution_logs_pkey` — PRIMARY KEY (id)
- `automation_execution_logs_scheduled_task_id_fkey` — FOREIGN KEY (scheduled_task_id) REFERENCES automation_scheduled_tasks(id) ON DELETE SET NULL
- `automation_execution_logs_scheduled_task_id_same_org` — FOREIGN KEY (org_id, scheduled_task_id) REFERENCES automation_scheduled_tasks(org_id, id)

### `automation_rules`

- `automation_rules_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `automation_rules_org_id_id_uq` — UNIQUE (org_id, id)
- `automation_rules_pkey` — PRIMARY KEY (id)

### `automation_scheduled_tasks`

- `automation_scheduled_tasks_automation_rule_id_fkey` — FOREIGN KEY (automation_rule_id) REFERENCES automation_rules(id) ON DELETE CASCADE
- `automation_scheduled_tasks_automation_rule_id_same_org` — FOREIGN KEY (org_id, automation_rule_id) REFERENCES automation_rules(org_id, id)
- `automation_scheduled_tasks_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `automation_scheduled_tasks_org_id_id_uq` — UNIQUE (org_id, id)
- `automation_scheduled_tasks_pkey` — PRIMARY KEY (id)
- `automation_scheduled_tasks_status_check` — CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])))

### `automations`

- `automations_category_check` — CHECK ((category = ANY (ARRAY['appointment'::text, 'invoice'::text, 'quote'::text, 'follow_up'::text])))
- `automations_delay_unit_check` — CHECK ((delay_unit = ANY (ARRAY['hours'::text, 'days'::text])))
- `automations_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `automations_pkey` — PRIMARY KEY (id)
- `automations_trigger_check` — CHECK ((trigger = ANY (ARRAY['days_after_quote_sent'::text, 'days_before_appointment'::text, 'on_invoice_due_date'::text, 'days_after_invoice_due'::text, 'days_after_job_completed'::text, 'custom'::text])))

### `billing_profiles`

- `billing_profiles_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE RESTRICT
- `billing_profiles_org_id_key` — UNIQUE (org_id)
- `billing_profiles_pkey` — PRIMARY KEY (id)

### `billing_receipt_log`

- `billing_receipt_log_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE RESTRICT
- `billing_receipt_log_pkey` — PRIMARY KEY (id)
- `billing_receipt_log_status_check` — CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])))
- `billing_receipt_log_subscription_id_fkey` — FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
- `billing_receipt_log_subscription_id_same_org` — FOREIGN KEY (org_id, subscription_id) REFERENCES subscriptions(org_id, id)

### `board_comments`

- `board_comments_board_id_fkey` — FOREIGN KEY (board_id) REFERENCES note_boards(id) ON DELETE CASCADE
- `board_comments_item_id_fkey` — FOREIGN KEY (item_id) REFERENCES note_items(id) ON DELETE CASCADE
- `board_comments_parent_id_fkey` — FOREIGN KEY (parent_id) REFERENCES board_comments(id) ON DELETE CASCADE
- `board_comments_pkey` — PRIMARY KEY (id)
- `board_comments_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id)

### `board_drawings`

- `board_drawings_board_id_fkey` — FOREIGN KEY (board_id) REFERENCES note_boards(id) ON DELETE CASCADE
- `board_drawings_created_by_fkey` — FOREIGN KEY (created_by) REFERENCES auth.users(id)
- `board_drawings_pkey` — PRIMARY KEY (id)

### `board_votes`

- `board_votes_board_id_fkey` — FOREIGN KEY (board_id) REFERENCES note_boards(id) ON DELETE CASCADE
- `board_votes_board_id_item_id_user_id_key` — UNIQUE (board_id, item_id, user_id)
- `board_votes_item_id_fkey` — FOREIGN KEY (item_id) REFERENCES note_items(id) ON DELETE CASCADE
- `board_votes_pkey` — PRIMARY KEY (id)
- `board_votes_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id)

### `booking_pages`

- `booking_pages_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `booking_pages_org_id_id_uq` — UNIQUE (org_id, id)
- `booking_pages_pkey` — PRIMARY KEY (id)

### `bookings`

- `bookings_booking_page_id_fkey` — FOREIGN KEY (booking_page_id) REFERENCES booking_pages(id) ON DELETE SET NULL
- `bookings_booking_page_id_same_org` — FOREIGN KEY (org_id, booking_page_id) REFERENCES booking_pages(org_id, id)
- `bookings_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
- `bookings_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `bookings_lead_id_fkey` — FOREIGN KEY (lead_id) REFERENCES clients(id) ON DELETE SET NULL
- `bookings_lead_id_same_org` — FOREIGN KEY (org_id, lead_id) REFERENCES clients(org_id, id)
- `bookings_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `bookings_pkey` — PRIMARY KEY (id)
- `bookings_status_check` — CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'cancelled'::text, 'completed'::text])))

### `checklist_templates`

- `checklist_templates_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `checklist_templates_org_id_id_uq` — UNIQUE (org_id, id)
- `checklist_templates_pkey` — PRIMARY KEY (id)

### `client_tags`

- `client_tags_client_id_fkey` — FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
- `client_tags_client_id_tag_key` — UNIQUE (client_id, tag)
- `client_tags_pkey` — PRIMARY KEY (id)

### `clients`

- `clients_contact_id_fkey` — FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
- `clients_contact_id_same_org` — FOREIGN KEY (org_id, contact_id) REFERENCES contacts(org_id, id)
- `clients_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `clients_org_id_id_uq` — UNIQUE (org_id, id)
- `clients_pkey` — PRIMARY KEY (id)
- `clients_portal_token_key` — UNIQUE (portal_token)
- `clients_status_check` — CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'lead'::text])))

### `commission_settings`

- `commission_settings_default_rule_id_fkey` — FOREIGN KEY (default_rule_id) REFERENCES fs_commission_rules(id) ON DELETE SET NULL
- `commission_settings_default_rule_id_same_org` — FOREIGN KEY (org_id, default_rule_id) REFERENCES fs_commission_rules(org_id, id)
- `commission_settings_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `commission_settings_pkey` — PRIMARY KEY (org_id)
- `commission_settings_reversal_policy_check` — CHECK ((reversal_policy = ANY (ARRAY['auto'::text, 'keep'::text, 'alert'::text])))

### `communication_channels`

- `communication_channels_channel_type_check` — CHECK ((channel_type = ANY (ARRAY['sms'::text, 'email'::text])))
- `communication_channels_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `communication_channels_org_id_id_uq` — UNIQUE (org_id, id)
- `communication_channels_pkey` — PRIMARY KEY (id)
- `communication_channels_status_check` — CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'provisioning'::text, 'failed'::text])))
- `communication_channels_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL

### `communication_messages`

- `communication_messages_channel_id_fkey` — FOREIGN KEY (channel_id) REFERENCES communication_channels(id) ON DELETE SET NULL
- `communication_messages_channel_id_same_org` — FOREIGN KEY (org_id, channel_id) REFERENCES communication_channels(org_id, id)
- `communication_messages_channel_type_check` — CHECK ((channel_type = ANY (ARRAY['sms'::text, 'email'::text])))
- `communication_messages_client_id_fkey` — FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
- `communication_messages_client_id_same_org` — FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id)
- `communication_messages_direction_check` — CHECK ((direction = ANY (ARRAY['outbound'::text, 'inbound'::text])))
- `communication_messages_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
- `communication_messages_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `communication_messages_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `communication_messages_pkey` — PRIMARY KEY (id)
- `communication_messages_status_check` — CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'delivered'::text, 'failed'::text, 'received'::text, 'opened'::text, 'bounced'::text])))
- `communication_messages_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL

### `communication_settings`

- `communication_settings_default_sms_channel_id_fkey` — FOREIGN KEY (default_sms_channel_id) REFERENCES communication_channels(id) ON DELETE SET NULL
- `communication_settings_default_sms_channel_id_same_org` — FOREIGN KEY (org_id, default_sms_channel_id) REFERENCES communication_channels(org_id, id)
- `communication_settings_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `communication_settings_org_id_key` — UNIQUE (org_id)
- `communication_settings_pkey` — PRIMARY KEY (id)

### `company_operating_profile`

- `company_operating_profile_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `company_operating_profile_org_id_key` — UNIQUE (org_id)
- `company_operating_profile_pkey` — PRIMARY KEY (id)

### `company_settings`

- `company_settings_created_by_fkey` — FOREIGN KEY (created_by) REFERENCES auth.users(id)
- `company_settings_default_tax_group_id_fkey` — FOREIGN KEY (default_tax_group_id) REFERENCES tax_groups(id) ON DELETE SET NULL
- `company_settings_default_tax_group_id_same_org` — FOREIGN KEY (org_id, default_tax_group_id) REFERENCES tax_groups(org_id, id)
- `company_settings_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `company_settings_pkey` — PRIMARY KEY (id)
- `company_settings_timezone_valid` — CHECK (is_valid_timezone(timezone))

### `confidence_calibration`

- `confidence_calibration_org_id_domain_key` — UNIQUE (org_id, domain)
- `confidence_calibration_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `confidence_calibration_pkey` — PRIMARY KEY (id)

### `connected_accounts`

- `connected_accounts_account_type_check` — CHECK ((account_type = ANY (ARRAY['express'::text, 'standard'::text, 'custom'::text])))
- `connected_accounts_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE RESTRICT
- `connected_accounts_pkey` — PRIMARY KEY (id)
- `connected_accounts_stripe_account_id_key` — UNIQUE (stripe_account_id)

### `consents`

- `consents_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `consents_pkey` — PRIMARY KEY (id)
- `consents_subject_type_check` — CHECK ((subject_type = ANY (ARRAY['user'::text, 'client'::text, 'lead'::text])))

### `contacts`

- `contacts_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `contacts_org_id_id_uq` — UNIQUE (org_id, id)
- `contacts_pkey` — PRIMARY KEY (id)

### `conversations`

- `conversations_client_id_fkey` — FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
- `conversations_client_id_same_org` — FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id)
- `conversations_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `conversations_org_id_id_uq` — UNIQUE (org_id, id)
- `conversations_pkey` — PRIMARY KEY (id)
- `conversations_status_check` — CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))

### `course_assignments`

- `course_assignments_course_id_fkey` — FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
- `course_assignments_course_id_team_id_key` — UNIQUE (course_id, team_id)
- `course_assignments_course_id_user_id_key` — UNIQUE (course_id, user_id)
- `course_assignments_pkey` — PRIMARY KEY (id)
- `course_assignments_team_id_fkey` — FOREIGN KEY (team_id) REFERENCES teams(id)

### `course_lessons`

- `course_lessons_content_type_check` — CHECK ((content_type = ANY (ARRAY['video'::text, 'embed'::text, 'text'::text, 'pdf'::text, 'link'::text])))
- `course_lessons_module_id_fkey` — FOREIGN KEY (module_id) REFERENCES course_modules(id) ON DELETE CASCADE
- `course_lessons_pkey` — PRIMARY KEY (id)

### `course_modules`

- `course_modules_course_id_fkey` — FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
- `course_modules_pkey` — PRIMARY KEY (id)

### `course_progress`

- `course_progress_course_id_fkey` — FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
- `course_progress_lesson_id_fkey` — FOREIGN KEY (lesson_id) REFERENCES course_lessons(id) ON DELETE CASCADE
- `course_progress_pkey` — PRIMARY KEY (id)
- `course_progress_user_id_lesson_id_key` — UNIQUE (user_id, lesson_id)

### `courses`

- `courses_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `courses_pkey` — PRIMARY KEY (id)
- `courses_status_check` — CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text])))
- `courses_visibility_check` — CHECK ((visibility = ANY (ARRAY['all'::text, 'assigned'::text])))

### `custom_column_values`

- `custom_column_values_column_id_fkey` — FOREIGN KEY (column_id) REFERENCES custom_columns(id) ON DELETE CASCADE
- `custom_column_values_column_id_same_org` — FOREIGN KEY (org_id, column_id) REFERENCES custom_columns(org_id, id)
- `custom_column_values_column_same_org` — FOREIGN KEY (org_id, column_id) REFERENCES custom_columns(org_id, id) ON DELETE CASCADE
- `custom_column_values_exactly_one_value` — CHECK ((((((
CASE
    WHEN (value_text IS NOT NULL) THEN 1
    ELSE 0
END +
CASE
    WHEN (value_number IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (value_boolean IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WH
- `custom_column_values_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `custom_column_values_pkey` — PRIMARY KEY (id)

### `custom_columns`

- `custom_columns_col_type_check` — CHECK ((col_type = ANY (ARRAY['text'::text, 'number'::text, 'status'::text, 'dropdown'::text, 'date'::text, 'checkbox'::text, 'email'::text, 'phone'::text, 'url'::text, 'currency'::text, 'rating'::text, 'label'::text])))
- `custom_columns_entity_check` — CHECK ((entity = ANY (ARRAY['clients'::text, 'jobs'::text, 'invoices'::text])))
- `custom_columns_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `custom_columns_org_id_id_uq` — UNIQUE (org_id, id)
- `custom_columns_pkey` — PRIMARY KEY (id)

### `data_export_log`

- `data_export_log_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `data_export_log_pkey` — PRIMARY KEY (id)
- `data_export_log_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL

### `dead_letters`

- `dead_letters_pkey` — PRIMARY KEY (id)

### `decision_logs`

- `decision_logs_approved_by_fkey` — FOREIGN KEY (approved_by) REFERENCES auth.users(id)
- `decision_logs_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `decision_logs_org_id_id_uq` — UNIQUE (org_id, id)
- `decision_logs_pkey` — PRIMARY KEY (id)

### `decision_outcomes`

- `decision_outcomes_decision_log_id_fkey` — FOREIGN KEY (decision_log_id) REFERENCES decision_logs(id)
- `decision_outcomes_decision_log_id_same_org` — FOREIGN KEY (org_id, decision_log_id) REFERENCES decision_logs(org_id, id)
- `decision_outcomes_message_id_fkey` — FOREIGN KEY (message_id) REFERENCES agent_messages(id)
- `decision_outcomes_message_id_same_org` — FOREIGN KEY (org_id, message_id) REFERENCES agent_messages(org_id, id)
- `decision_outcomes_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `decision_outcomes_pkey` — PRIMARY KEY (id)
- `decision_outcomes_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id)
- `valid_outcome` — CHECK ((outcome = ANY (ARRAY['pending'::text, 'success'::text, 'partial'::text, 'failure'::text, 'rejected'::text, 'ignored'::text])))

### `demo_requests`

- `demo_requests_converted_user_id_fkey` — FOREIGN KEY (converted_user_id) REFERENCES auth.users(id) ON DELETE SET NULL
- `demo_requests_pkey` — PRIMARY KEY (id)
- `demo_requests_status_check` — CHECK ((status = ANY (ARRAY['new'::text, 'contacted'::text, 'demoed'::text, 'converted'::text, 'rejected'::text])))

### `dsar_requests`

- `dsar_requests_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `dsar_requests_pkey` — PRIMARY KEY (id)
- `dsar_requests_request_type_check` — CHECK ((request_type = ANY (ARRAY['access'::text, 'erasure'::text, 'rectification'::text, 'portability'::text, 'objection'::text, 'restriction'::text])))
- `dsar_requests_requested_by_fkey` — FOREIGN KEY (requested_by) REFERENCES auth.users(id)
- `dsar_requests_status_check` — CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'rejected'::text])))
- `dsar_requests_subject_type_check` — CHECK ((subject_type = ANY (ARRAY['user'::text, 'client'::text, 'lead'::text])))

### `email_accounts`

- `email_accounts_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `email_accounts_org_id_id_uq` — UNIQUE (org_id, id)
- `email_accounts_pkey` — PRIMARY KEY (id)
- `email_accounts_provider_check` — CHECK ((provider = ANY (ARRAY['gmail'::text, 'outlook'::text])))
- `email_accounts_status_check` — CHECK ((status = ANY (ARRAY['connected'::text, 'error'::text, 'reconnect_required'::text, 'disconnected'::text])))
- `email_accounts_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

### `email_campaign_recipients`

- `email_campaign_recipients_campaign_id_fkey` — FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE CASCADE
- `email_campaign_recipients_campaign_id_same_org` — FOREIGN KEY (org_id, campaign_id) REFERENCES email_campaigns(org_id, id)
- `email_campaign_recipients_client_id_fkey` — FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
- `email_campaign_recipients_client_id_same_org` — FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id)
- `email_campaign_recipients_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `email_campaign_recipients_pkey` — PRIMARY KEY (id)
- `email_campaign_recipients_status_check` — CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'bounced'::text])))

### `email_campaigns`

- `email_campaigns_created_by_fkey` — FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
- `email_campaigns_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `email_campaigns_org_id_id_uq` — UNIQUE (org_id, id)
- `email_campaigns_pkey` — PRIMARY KEY (id)
- `email_campaigns_status_check` — CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'sending'::text, 'sent'::text, 'failed'::text])))

### `email_messages`

- `email_messages_account_id_fkey` — FOREIGN KEY (account_id) REFERENCES email_accounts(id) ON DELETE CASCADE
- `email_messages_account_id_provider_message_id_key` — UNIQUE (account_id, provider_message_id)
- `email_messages_direction_check` — CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])))
- `email_messages_pkey` — PRIMARY KEY (id)
- `email_messages_thread_id_fkey` — FOREIGN KEY (thread_id) REFERENCES email_threads(id) ON DELETE CASCADE
- `email_messages_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

### `email_oauth_states`

- `email_oauth_states_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `email_oauth_states_pkey` — PRIMARY KEY (id)
- `email_oauth_states_provider_check` — CHECK ((provider = ANY (ARRAY['gmail'::text, 'outlook'::text])))
- `email_oauth_states_state_key` — UNIQUE (state)
- `email_oauth_states_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

### `email_opt_outs`

- `email_opt_outs_org_id_email_key` — UNIQUE (org_id, email)
- `email_opt_outs_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `email_opt_outs_pkey` — PRIMARY KEY (id)

### `email_templates`

- `email_templates_created_by_fkey` — FOREIGN KEY (created_by) REFERENCES auth.users(id)
- `email_templates_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `email_templates_org_id_id_uq` — UNIQUE (org_id, id)
- `email_templates_pkey` — PRIMARY KEY (id)
- `email_templates_type_check` — CHECK ((type = ANY (ARRAY['invoice_sent'::text, 'invoice_reminder'::text, 'quote_sent'::text, 'quote_accepted'::text, 'quote_declined'::text, 'job_confirmation'::text, 'job_reminder'::text, 'job_completed'::text, 'review

### `email_threads`

- `email_threads_account_id_fkey` — FOREIGN KEY (account_id) REFERENCES email_accounts(id) ON DELETE CASCADE
- `email_threads_account_id_same_org` — FOREIGN KEY (org_id, account_id) REFERENCES email_accounts(org_id, id)
- `email_threads_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `email_threads_pkey` — PRIMARY KEY (id)
- `email_threads_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

### `failed_login_attempts`

- `failed_login_attempts_pkey` — PRIMARY KEY (id)

### `few_shot_examples`

- `few_shot_examples_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `few_shot_examples_pkey` — PRIMARY KEY (id)

### `field_daily_stats`

- `field_daily_stats_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `field_daily_stats_org_id_user_id_date_key` — UNIQUE (org_id, user_id, date)
- `field_daily_stats_pkey` — PRIMARY KEY (id)
- `field_daily_stats_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id)

### `field_house_events`

- `field_house_events_event_type_check` — CHECK ((event_type = ANY (ARRAY['knock'::text, 'no_answer'::text, 'lead'::text, 'quote_sent'::text, 'sale'::text, 'note'::text, 'revisit'::text, 'callback'::text, 'do_not_knock'::text, 'status_change'::text])))
- `field_house_events_house_id_fkey` — FOREIGN KEY (house_id) REFERENCES field_house_profiles(id) ON DELETE CASCADE
- `field_house_events_house_id_same_org` — FOREIGN KEY (org_id, house_id) REFERENCES field_house_profiles(org_id, id)
- `field_house_events_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `field_house_events_pkey` — PRIMARY KEY (id)
- `field_house_events_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id)

### `field_house_profiles`

- `field_house_profiles_assigned_user_id_fkey` — FOREIGN KEY (assigned_user_id) REFERENCES auth.users(id)
- `field_house_profiles_client_id_fkey` — FOREIGN KEY (client_id) REFERENCES clients(id)
- `field_house_profiles_client_id_same_org` — FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id)
- `field_house_profiles_current_status_check` — CHECK ((current_status = ANY (ARRAY['unknown'::text, 'not_interested'::text, 'no_answer'::text, 'lead'::text, 'quote_sent'::text, 'sale'::text, 'callback'::text, 'do_not_knock'::text, 'revisit'::text])))
- `field_house_profiles_house_score_check` — CHECK ((house_score = ANY (ARRAY['cold'::text, 'warm'::text, 'hot'::text])))
- `field_house_profiles_invoice_id_fkey` — FOREIGN KEY (invoice_id) REFERENCES invoices(id)
- `field_house_profiles_invoice_id_same_org` — FOREIGN KEY (org_id, invoice_id) REFERENCES invoices(org_id, id)
- `field_house_profiles_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id)
- `field_house_profiles_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `field_house_profiles_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `field_house_profiles_org_id_id_uq` — UNIQUE (org_id, id)
- `field_house_profiles_pkey` — PRIMARY KEY (id)
- `field_house_profiles_quote_id_fkey` — FOREIGN KEY (quote_id) REFERENCES quotes(id)
- `field_house_profiles_quote_id_same_org` — FOREIGN KEY (org_id, quote_id) REFERENCES quotes(org_id, id)
- `field_house_profiles_territory_id_fkey` — FOREIGN KEY (territory_id) REFERENCES field_territories(id) ON DELETE SET NULL
- `field_house_profiles_territory_id_same_org` — FOREIGN KEY (org_id, territory_id) REFERENCES field_territories(org_id, id)

### `field_pin_entity_links`

- `field_pin_entity_links_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `field_pin_entity_links_org_id_house_id_entity_type_entity_i_key` — UNIQUE (org_id, house_id, entity_type, entity_id)
- `field_pin_entity_links_pkey` — PRIMARY KEY (id)

### `field_pin_templates`

- `field_pin_templates_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `field_pin_templates_pkey` — PRIMARY KEY (id)

### `field_pins`

- `field_pins_house_id_fkey` — FOREIGN KEY (house_id) REFERENCES field_house_profiles(id) ON DELETE CASCADE
- `field_pins_house_id_same_org` — FOREIGN KEY (org_id, house_id) REFERENCES field_house_profiles(org_id, id)
- `field_pins_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `field_pins_org_id_house_id_key` — UNIQUE (org_id, house_id)
- `field_pins_pkey` — PRIMARY KEY (id)
- `field_pins_status_check` — CHECK ((status = ANY (ARRAY['unknown'::text, 'not_interested'::text, 'no_answer'::text, 'lead'::text, 'quote_sent'::text, 'sale'::text, 'callback'::text, 'do_not_knock'::text, 'revisit'::text])))
- `field_pins_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id)

### `field_rep_performance`

- `field_rep_performance_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `field_rep_performance_org_id_user_id_territory_id_period_st_key` — UNIQUE (org_id, user_id, territory_id, period_start, period_end)
- `field_rep_performance_pkey` — PRIMARY KEY (id)

### `field_sales_reps`

- `field_sales_reps_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `field_sales_reps_org_id_id_uq` — UNIQUE (org_id, id)
- `field_sales_reps_org_id_user_id_key` — UNIQUE (org_id, user_id)
- `field_sales_reps_pkey` — PRIMARY KEY (id)
- `field_sales_reps_role_check` — CHECK ((role = ANY (ARRAY['sales_rep'::text, 'team_leader'::text, 'manager'::text])))
- `field_sales_reps_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id)

### `field_sales_team_members`

- `field_sales_team_members_pkey` — PRIMARY KEY (id)
- `field_sales_team_members_rep_id_fkey` — FOREIGN KEY (rep_id) REFERENCES field_sales_reps(id) ON DELETE CASCADE
- `field_sales_team_members_team_id_fkey` — FOREIGN KEY (team_id) REFERENCES field_sales_teams(id) ON DELETE CASCADE
- `field_sales_team_members_team_id_rep_id_key` — UNIQUE (team_id, rep_id)

### `field_sales_teams`

- `field_sales_teams_leader_id_fkey` — FOREIGN KEY (leader_id) REFERENCES field_sales_reps(id) ON DELETE SET NULL
- `field_sales_teams_leader_id_same_org` — FOREIGN KEY (org_id, leader_id) REFERENCES field_sales_reps(org_id, id)
- `field_sales_teams_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `field_sales_teams_pkey` — PRIMARY KEY (id)

### `field_schedule_slots`

- `field_schedule_slots_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `field_schedule_slots_pkey` — PRIMARY KEY (id)

### `field_settings`

- `field_settings_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `field_settings_org_id_key` — UNIQUE (org_id)
- `field_settings_pkey` — PRIMARY KEY (id)

### `field_territories`

- `field_territories_assigned_rep_id_fkey` — FOREIGN KEY (assigned_rep_id) REFERENCES field_sales_reps(id) ON DELETE SET NULL
- `field_territories_assigned_rep_id_same_org` — FOREIGN KEY (org_id, assigned_rep_id) REFERENCES field_sales_reps(org_id, id)
- `field_territories_assigned_team_id_fkey` — FOREIGN KEY (assigned_team_id) REFERENCES teams(id) ON DELETE SET NULL
- `field_territories_assigned_team_id_same_org` — FOREIGN KEY (org_id, assigned_team_id) REFERENCES teams(org_id, id)
- `field_territories_assigned_user_id_fkey` — FOREIGN KEY (assigned_user_id) REFERENCES auth.users(id) ON DELETE SET NULL
- `field_territories_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `field_territories_org_id_id_uq` — UNIQUE (org_id, id)
- `field_territories_pkey` — PRIMARY KEY (id)

### `field_territory_assignments`

- `field_territory_assignments_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `field_territory_assignments_pkey` — PRIMARY KEY (id)

### `form_submissions`

- `form_submissions_assessment_team_id_fkey` — FOREIGN KEY (assessment_team_id) REFERENCES teams(id) ON DELETE SET NULL
- `form_submissions_assessment_team_id_same_org` — FOREIGN KEY (org_id, assessment_team_id) REFERENCES teams(org_id, id)
- `form_submissions_assessment_user_id_fkey` — FOREIGN KEY (assessment_user_id) REFERENCES auth.users(id) ON DELETE SET NULL
- `form_submissions_client_id_fkey` — FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
- `form_submissions_client_id_same_org` — FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id)
- `form_submissions_deal_id_fkey` — FOREIGN KEY (deal_id) REFERENCES pipeline_deals(id) ON DELETE SET NULL
- `form_submissions_deal_id_same_org` — FOREIGN KEY (org_id, deal_id) REFERENCES pipeline_deals(org_id, id)
- `form_submissions_form_id_fkey` — FOREIGN KEY (form_id) REFERENCES request_forms(id) ON DELETE CASCADE
- `form_submissions_form_id_same_org` — FOREIGN KEY (org_id, form_id) REFERENCES request_forms(org_id, id)
- `form_submissions_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `form_submissions_pkey` — PRIMARY KEY (id)

### `fs_badges`

- `fs_badges_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `fs_badges_org_id_id_uq` — UNIQUE (org_id, id)
- `fs_badges_pkey` — PRIMARY KEY (id)

### `fs_battles`

- `fs_battles_challenger_user_id_fkey` — FOREIGN KEY (challenger_user_id) REFERENCES auth.users(id) ON DELETE SET NULL
- `fs_battles_created_by_fkey` — FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE
- `fs_battles_opponent_user_id_fkey` — FOREIGN KEY (opponent_user_id) REFERENCES auth.users(id) ON DELETE SET NULL
- `fs_battles_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `fs_battles_pkey` — PRIMARY KEY (id)
- `fs_battles_status_check` — CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'completed'::text, 'cancelled'::text])))
- `fs_battles_type_check` — CHECK ((type = ANY (ARRAY['rep_vs_rep'::text, 'team_vs_team'::text])))
- `fs_battles_winner_user_id_fkey` — FOREIGN KEY (winner_user_id) REFERENCES auth.users(id) ON DELETE SET NULL

### `fs_challenge_participants`

- `fs_challenge_participants_challenge_id_fkey` — FOREIGN KEY (challenge_id) REFERENCES fs_challenges(id) ON DELETE CASCADE
- `fs_challenge_participants_challenge_id_user_id_key` — UNIQUE (challenge_id, user_id)
- `fs_challenge_participants_pkey` — PRIMARY KEY (id)
- `fs_challenge_participants_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

### `fs_challenges`

- `fs_challenges_created_by_fkey` — FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE
- `fs_challenges_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `fs_challenges_pkey` — PRIMARY KEY (id)
- `fs_challenges_status_check` — CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'cancelled'::text])))
- `fs_challenges_type_check` — CHECK ((type = ANY (ARRAY['daily'::text, 'weekly'::text])))

### `fs_check_in_records`

- `fs_check_in_records_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `fs_check_in_records_pkey` — PRIMARY KEY (id)
- `fs_check_in_records_session_id_fkey` — FOREIGN KEY (session_id) REFERENCES fs_field_sessions(id) ON DELETE SET NULL
- `fs_check_in_records_session_id_same_org` — FOREIGN KEY (org_id, session_id) REFERENCES fs_field_sessions(org_id, id)
- `fs_check_in_records_type_check` — CHECK ((type = ANY (ARRAY['check_in'::text, 'check_out'::text])))
- `fs_check_in_records_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

### `fs_commission_entries`

- `fs_commission_entries_approved_by_fkey` — FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL
- `fs_commission_entries_invoice_id_fkey` — FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
- `fs_commission_entries_invoice_id_same_org` — FOREIGN KEY (org_id, invoice_id) REFERENCES invoices(org_id, id)
- `fs_commission_entries_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id)
- `fs_commission_entries_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `fs_commission_entries_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `fs_commission_entries_pkey` — PRIMARY KEY (id)
- `fs_commission_entries_rule_id_fkey` — FOREIGN KEY (rule_id) REFERENCES fs_commission_rules(id) ON DELETE RESTRICT
- `fs_commission_entries_rule_id_same_org` — FOREIGN KEY (org_id, rule_id) REFERENCES fs_commission_rules(org_id, id)
- `fs_commission_entries_status_check` — CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'paid'::text, 'reversed'::text])))
- `fs_commission_entries_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

### `fs_commission_rules`

- `fs_commission_rules_applies_to_user_id_fkey` — FOREIGN KEY (applies_to_user_id) REFERENCES auth.users(id) ON DELETE SET NULL
- `fs_commission_rules_base_kind_check` — CHECK ((base_kind = ANY (ARRAY['percent'::text, 'flat'::text])))
- `fs_commission_rules_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `fs_commission_rules_org_id_id_uq` — UNIQUE (org_id, id)
- `fs_commission_rules_pkey` — PRIMARY KEY (id)
- `fs_commission_rules_type_check` — CHECK ((type = ANY (ARRAY['flat'::text, 'percentage'::text, 'tiered'::text])))

### `fs_field_sessions`

- `fs_field_sessions_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `fs_field_sessions_org_id_id_uq` — UNIQUE (org_id, id)
- `fs_field_sessions_pkey` — PRIMARY KEY (id)
- `fs_field_sessions_status_check` — CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'completed'::text])))
- `fs_field_sessions_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

### `fs_gps_points`

- `fs_gps_points_pkey` — PRIMARY KEY (id)
- `fs_gps_points_session_id_fkey` — FOREIGN KEY (session_id) REFERENCES fs_field_sessions(id) ON DELETE CASCADE
- `fs_gps_points_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

### `fs_rep_badges`

- `fs_rep_badges_badge_id_fkey` — FOREIGN KEY (badge_id) REFERENCES fs_badges(id) ON DELETE CASCADE
- `fs_rep_badges_badge_id_same_org` — FOREIGN KEY (org_id, badge_id) REFERENCES fs_badges(org_id, id)
- `fs_rep_badges_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `fs_rep_badges_pkey` — PRIMARY KEY (id)
- `fs_rep_badges_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

### `fs_rep_stat_snapshots`

- `fs_rep_stat_snapshots_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `fs_rep_stat_snapshots_period_check` — CHECK ((period = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text])))
- `fs_rep_stat_snapshots_pkey` — PRIMARY KEY (id)
- `fs_rep_stat_snapshots_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

### `geofences`

- `geofences_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id)
- `geofences_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `geofences_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `geofences_org_id_id_uq` — UNIQUE (org_id, id)
- `geofences_pkey` — PRIMARY KEY (id)

### `goals`

- `goals_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `goals_pkey` — PRIMARY KEY (id)

### `gps_providers`

- `gps_providers_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `gps_providers_org_id_id_uq` — UNIQUE (org_id, id)
- `gps_providers_pkey` — PRIMARY KEY (id)
- `gps_providers_provider_check` — CHECK ((provider = ANY (ARRAY['traccar'::text, 'life360'::text])))
- `gps_providers_sync_status_check` — CHECK ((sync_status = ANY (ARRAY['ok'::text, 'error'::text, 'syncing'::text, 'never'::text])))

### `incident_timeline`

- `incident_timeline_actor_id_fkey` — FOREIGN KEY (actor_id) REFERENCES auth.users(id)
- `incident_timeline_incident_id_fkey` — FOREIGN KEY (incident_id) REFERENCES security_incidents(id) ON DELETE CASCADE
- `incident_timeline_pkey` — PRIMARY KEY (id)

### `integration_audit_logs`

- `integration_audit_logs_action_check` — CHECK ((action = ANY (ARRAY['connect_started'::text, 'oauth_redirect'::text, 'oauth_callback'::text, 'credentials_submitted'::text, 'connection_tested'::text, 'connection_validated'::text, 'token_refreshed'::text, 'token
- `integration_audit_logs_connection_id_fkey` — FOREIGN KEY (connection_id) REFERENCES app_connections(id) ON DELETE SET NULL
- `integration_audit_logs_connection_id_same_org` — FOREIGN KEY (org_id, connection_id) REFERENCES app_connections(org_id, id)
- `integration_audit_logs_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `integration_audit_logs_pkey` — PRIMARY KEY (id)
- `integration_audit_logs_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id)

### `integration_oauth_states`

- `integration_oauth_states_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `integration_oauth_states_pkey` — PRIMARY KEY (id)
- `integration_oauth_states_state_key` — UNIQUE (state)
- `integration_oauth_states_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

### `invitations`

- `invitations_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id)
- `invitations_pkey` — PRIMARY KEY (id)
- `invitations_role_check` — CHECK ((role = ANY (ARRAY['admin'::text, 'sales_rep'::text, 'technician'::text])))
- `invitations_scope_check` — CHECK (((scope IS NULL) OR (scope = ANY (ARRAY['self'::text, 'assigned'::text, 'team'::text, 'company'::text]))))
- `invitations_status_check` — CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'expired'::text, 'revoked'::text])))
- `invitations_team_id_fkey` — FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
- `invitations_team_id_same_org` — FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id)

### `invoice_items`

- `chk_ii_source_type` — CHECK (((source_type IS NULL) OR (source_type = ANY (ARRAY['manual'::text, 'job_line_item'::text, 'predefined_service'::text, 'template'::text]))))
- `invoice_items_invoice_id_fkey` — FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
- `invoice_items_invoice_id_same_org` — FOREIGN KEY (org_id, invoice_id) REFERENCES invoices(org_id, id)
- `invoice_items_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE RESTRICT
- `invoice_items_pkey` — PRIMARY KEY (id)

### `invoice_send_events`

- `chk_se_channel` — CHECK (((channel IS NULL) OR (channel = ANY (ARRAY['email'::text, 'sms'::text]))))
- `chk_se_event_type` — CHECK ((event_type = ANY (ARRAY['sent'::text, 'resent'::text, 'reminder'::text, 'viewed'::text, 'bounced'::text])))
- `invoice_send_events_invoice_id_fkey` — FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
- `invoice_send_events_invoice_id_same_org` — FOREIGN KEY (org_id, invoice_id) REFERENCES invoices(org_id, id)
- `invoice_send_events_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE RESTRICT
- `invoice_send_events_pkey` — PRIMARY KEY (id)

### `invoice_sequences`

- `invoice_sequences_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `invoice_sequences_pkey` — PRIMARY KEY (org_id)

### `invoice_templates`

- `chk_tpl_layout_type` — CHECK ((layout_type = ANY (ARRAY['classic'::text, 'modern'::text, 'minimal'::text, 'bold'::text, 'executive'::text, 'contractor'::text])))
- `invoice_templates_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE SET NULL
- `invoice_templates_org_id_id_uq` — UNIQUE (org_id, id)
- `invoice_templates_pkey` — PRIMARY KEY (id)

### `invoices`

- `chk_invoices_discount_gte0` — CHECK ((discount_cents >= 0))
- `chk_recurrence_interval` — CHECK (((recurrence_interval IS NULL) OR (recurrence_interval = ANY (ARRAY['weekly'::text, 'biweekly'::text, 'monthly'::text, 'quarterly'::text, 'yearly'::text]))))
- `fk_invoices_template_id` — FOREIGN KEY (template_id) REFERENCES invoice_templates(id) ON DELETE SET NULL
- `fk_parent_invoice` — FOREIGN KEY (parent_invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
- `invoices_billing_milestone_id_fkey` — FOREIGN KEY (billing_milestone_id) REFERENCES job_billing_milestones(id) ON DELETE SET NULL
- `invoices_billing_milestone_id_same_org` — FOREIGN KEY (org_id, billing_milestone_id) REFERENCES job_billing_milestones(org_id, id)
- `invoices_client_id_fkey` — FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
- `invoices_client_id_same_org` — FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id)
- `invoices_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
- `invoices_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `invoices_money_non_negative` — CHECK (((COALESCE(total_cents, 0) >= 0) AND (COALESCE(subtotal_cents, 0) >= 0) AND (COALESCE(tax_cents, 0) >= 0) AND (COALESCE(paid_cents, 0) >= 0)))
- `invoices_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE RESTRICT
- `invoices_org_id_id_uq` — UNIQUE (org_id, id)
- `invoices_payment_status_check` — CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'paid'::text, 'partial'::text, 'void'::text])))
- `invoices_pkey` — PRIMARY KEY (id)
- `invoices_property_id_fkey` — FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL
- `invoices_property_id_same_org` — FOREIGN KEY (org_id, property_id) REFERENCES properties(org_id, id)
- `invoices_status_check` — CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'partial'::text, 'paid'::text, 'void'::text])))
- `invoices_template_id_same_org` — FOREIGN KEY (org_id, template_id) REFERENCES invoice_templates(org_id, id)
- `invoices_total_non_negatif` — CHECK ((total_cents >= 0))
- `invoices_void_zero_paid` — CHECK (((status <> 'void'::text) OR (paid_cents = 0) OR (paid_cents IS NULL)))

### `ip_blocklist`

- `ip_blocklist_blocked_by_fkey` — FOREIGN KEY (blocked_by) REFERENCES auth.users(id) ON DELETE SET NULL
- `ip_blocklist_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `ip_blocklist_pkey` — PRIMARY KEY (id)

### `job_agreements`

- `job_agreements_client_id_fkey` — FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
- `job_agreements_client_id_same_org` — FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id)
- `job_agreements_entity_check` — CHECK (((job_id IS NOT NULL) OR (quote_id IS NOT NULL)))
- `job_agreements_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
- `job_agreements_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `job_agreements_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id)
- `job_agreements_pkey` — PRIMARY KEY (id)
- `job_agreements_quote_id_fkey` — FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE
- `job_agreements_quote_id_same_org` — FOREIGN KEY (org_id, quote_id) REFERENCES quotes(org_id, id)

### `job_billing_milestones`

- `job_billing_milestones_amount_cents_check` — CHECK ((amount_cents >= 0))
- `job_billing_milestones_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
- `job_billing_milestones_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `job_billing_milestones_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id)
- `job_billing_milestones_org_id_id_uq` — UNIQUE (org_id, id)
- `job_billing_milestones_pkey` — PRIMARY KEY (id)

### `job_checklists`

- `job_checklists_completed_by_fkey` — FOREIGN KEY (completed_by) REFERENCES auth.users(id) ON DELETE SET NULL
- `job_checklists_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
- `job_checklists_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `job_checklists_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `job_checklists_pkey` — PRIMARY KEY (id)
- `job_checklists_template_id_fkey` — FOREIGN KEY (template_id) REFERENCES checklist_templates(id) ON DELETE SET NULL
- `job_checklists_template_id_same_org` — FOREIGN KEY (org_id, template_id) REFERENCES checklist_templates(org_id, id)

### `job_intents`

- `job_intents_deal_id_fkey` — FOREIGN KEY (deal_id) REFERENCES pipeline_deals(id) ON DELETE SET NULL
- `job_intents_deal_id_same_org` — FOREIGN KEY (org_id, deal_id) REFERENCES pipeline_deals(org_id, id)
- `job_intents_lead_id_fkey` — FOREIGN KEY (lead_id) REFERENCES clients(id) ON DELETE CASCADE
- `job_intents_lead_id_same_org` — FOREIGN KEY (org_id, lead_id) REFERENCES clients(org_id, id)
- `job_intents_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `job_intents_pkey` — PRIMARY KEY (id)
- `job_intents_status_check` — CHECK ((status = ANY (ARRAY['pending'::text, 'consumed'::text, 'canceled'::text])))

### `job_line_items`

- `job_line_items_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
- `job_line_items_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `job_line_items_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `job_line_items_pkey` — PRIMARY KEY (id)
- `job_line_items_qty_positive` — CHECK ((qty > (0)::numeric))

### `job_materials`

- `job_materials_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
- `job_materials_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `job_materials_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `job_materials_pkey` — PRIMARY KEY (id)

### `job_recurrence_rules`

- `job_recurrence_rules_frequency_check` — CHECK ((frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'biweekly'::text, 'monthly'::text, 'custom'::text])))
- `job_recurrence_rules_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
- `job_recurrence_rules_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `job_recurrence_rules_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `job_recurrence_rules_pkey` — PRIMARY KEY (id)

### `job_templates`

- `job_templates_created_by_fkey` — FOREIGN KEY (created_by) REFERENCES auth.users(id)
- `job_templates_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `job_templates_pkey` — PRIMARY KEY (id)

### `job_time_logs`

- `job_time_logs_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id)
- `job_time_logs_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `job_time_logs_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `job_time_logs_pkey` — PRIMARY KEY (id)

### `jobs`

- `jobs_client_id_fkey` — FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
- `jobs_client_id_same_org` — FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id)
- `jobs_dates_coherentes` — CHECK (((start_at IS NULL) OR (end_at IS NULL) OR (end_at > start_at)))
- `jobs_deal_id_fkey` — FOREIGN KEY (deal_id) REFERENCES pipeline_deals(id) ON DELETE SET NULL
- `jobs_deal_id_same_org` — FOREIGN KEY (org_id, deal_id) REFERENCES pipeline_deals(org_id, id)
- `jobs_deposit_status_check` — CHECK ((deposit_status = ANY (ARRAY['not_required'::text, 'pending'::text, 'paid'::text, 'waived'::text])))
- `jobs_deposit_type_check` — CHECK (((deposit_type IS NULL) OR (deposit_type = ANY (ARRAY['percentage'::text, 'fixed'::text]))))
- `jobs_geocode_status_check` — CHECK (((geocode_status IS NULL) OR (geocode_status = ANY (ARRAY['ok'::text, 'failed'::text, 'pending'::text]))))
- `jobs_lead_id_fkey` — FOREIGN KEY (lead_id) REFERENCES clients(id) ON DELETE SET NULL
- `jobs_lead_id_same_org` — FOREIGN KEY (org_id, lead_id) REFERENCES clients(org_id, id)
- `jobs_money_non_negative` — CHECK (((COALESCE(total_cents, 0) >= 0) AND (subtotal_cents >= 0) AND (tax_cents >= 0)))
- `jobs_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `jobs_org_id_id_uq` — UNIQUE (org_id, id)
- `jobs_pkey` — PRIMARY KEY (id)
- `jobs_property_id_fkey` — FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL
- `jobs_property_id_same_org` — FOREIGN KEY (org_id, property_id) REFERENCES properties(org_id, id)
- `jobs_status_check` — CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text])))
- `jobs_team_id_fkey` — FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
- `jobs_team_id_same_org` — FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id)

### `lead_lists`

- `lead_lists_list_id_fkey` — FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
- `lead_lists_pkey` — PRIMARY KEY (lead_id, list_id)

### `lead_sources`

- `lead_sources_org_id_name_key` — UNIQUE (org_id, name)
- `lead_sources_pkey` — PRIMARY KEY (id)

### `lists`

- `lists_pkey` — PRIMARY KEY (id)
- `lists_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

### `location_tracking_settings`

- `location_tracking_settings_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `location_tracking_settings_pkey` — PRIMARY KEY (org_id)

### `login_history`

- `login_history_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE SET NULL
- `login_history_pkey` — PRIMARY KEY (id)
- `login_history_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

### `memberships`

- `memberships_experience_level_check` — CHECK ((experience_level = ANY (ARRAY['rookie'::text, 'experienced'::text])))
- `memberships_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `memberships_pkey` — PRIMARY KEY (user_id, org_id)
- `memberships_team_id_fkey` — FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
- `memberships_team_id_same_org` — FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id)

### `messages`

- `messages_client_id_fkey` — FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
- `messages_client_id_same_org` — FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id)
- `messages_conversation_id_fkey` — FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
- `messages_conversation_id_same_org` — FOREIGN KEY (org_id, conversation_id) REFERENCES conversations(org_id, id)
- `messages_direction_check` — CHECK ((direction = ANY (ARRAY['outbound'::text, 'inbound'::text])))
- `messages_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `messages_pkey` — PRIMARY KEY (id)
- `messages_status_check` — CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'delivered'::text, 'failed'::text, 'received'::text])))

### `mfa_phone`

- `mfa_phone_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id)
- `mfa_phone_pkey` — PRIMARY KEY (user_id)
- `mfa_phone_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

### `mfa_sms_challenges`

- `mfa_sms_challenges_pkey` — PRIMARY KEY (id)
- `mfa_sms_challenges_purpose_check` — CHECK ((purpose = ANY (ARRAY['enroll'::text, 'stepup'::text])))
- `mfa_sms_challenges_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

### `mfa_trusted_devices`

- `mfa_trusted_devices_pkey` — PRIMARY KEY (id)
- `mfa_trusted_devices_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
- `mfa_trusted_devices_user_id_token_hash_key` — UNIQUE (user_id, token_hash)

### `note_boards`

- `note_boards_archived_by_fkey` — FOREIGN KEY (archived_by) REFERENCES auth.users(id)
- `note_boards_board_type_check` — CHECK ((board_type = ANY (ARRAY['freeform'::text, 'meeting'::text, 'brainstorm'::text, 'project_plan'::text, 'retrospective'::text, 'kanban'::text])))
- `note_boards_created_by_fkey` — FOREIGN KEY (created_by) REFERENCES auth.users(id)
- `note_boards_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `note_boards_pkey` — PRIMARY KEY (id)

### `note_connections`

- `no_self_loop` — CHECK ((source_id <> target_id))
- `note_connections_board_id_fkey` — FOREIGN KEY (board_id) REFERENCES note_boards(id) ON DELETE CASCADE
- `note_connections_line_type_check` — CHECK ((line_type = ANY (ARRAY['bezier'::text, 'straight'::text, 'step'::text, 'smoothstep'::text])))
- `note_connections_pkey` — PRIMARY KEY (id)
- `note_connections_source_id_fkey` — FOREIGN KEY (source_id) REFERENCES note_items(id) ON DELETE CASCADE
- `note_connections_target_id_fkey` — FOREIGN KEY (target_id) REFERENCES note_items(id) ON DELETE CASCADE

### `note_entity_links`

- `note_entity_links_entity_type_check` — CHECK ((entity_type = ANY (ARRAY['lead'::text, 'client'::text, 'job'::text, 'invoice'::text, 'payment'::text, 'team_member'::text])))
- `note_entity_links_item_id_entity_type_entity_id_key` — UNIQUE (item_id, entity_type, entity_id)
- `note_entity_links_item_id_fkey` — FOREIGN KEY (item_id) REFERENCES note_items(id) ON DELETE CASCADE
- `note_entity_links_pkey` — PRIMARY KEY (id)

### `note_history`

- `note_history_edited_by_fkey` — FOREIGN KEY (edited_by) REFERENCES auth.users(id)
- `note_history_note_id_fkey` — FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
- `note_history_pkey` — PRIMARY KEY (id)

### `note_items`

- `note_items_board_id_fkey` — FOREIGN KEY (board_id) REFERENCES note_boards(id) ON DELETE CASCADE
- `note_items_border_style_check` — CHECK ((border_style = ANY (ARRAY['none'::text, 'solid'::text, 'dashed'::text, 'dotted'::text])))
- `note_items_created_by_fkey` — FOREIGN KEY (created_by) REFERENCES auth.users(id)
- `note_items_item_type_check` — CHECK ((item_type = ANY (ARRAY['sticky_note'::text, 'text'::text, 'checklist'::text, 'image'::text, 'file'::text, 'link'::text, 'shape'::text, 'diagram_block'::text, 'frame'::text, 'section_header'::text])))
- `note_items_pkey` — PRIMARY KEY (id)
- `note_items_shape_type_check` — CHECK ((shape_type = ANY (ARRAY['rectangle'::text, 'ellipse'::text, 'diamond'::text, 'triangle'::text, 'arrow_right'::text, 'cloud'::text, NULL::text])))
- `note_items_text_align_check` — CHECK ((text_align = ANY (ARRAY['left'::text, 'center'::text, 'right'::text])))

### `notes`

- `notes_color_check` — CHECK ((color = ANY (ARRAY[NULL::text, 'red'::text, 'orange'::text, 'yellow'::text, 'green'::text, 'blue'::text, 'purple'::text, 'pink'::text, 'gray'::text])))
- `notes_created_by_fkey` — FOREIGN KEY (created_by) REFERENCES auth.users(id)
- `notes_entity_type_check` — CHECK ((entity_type = ANY (ARRAY[NULL::text, 'client'::text, 'job'::text, 'lead'::text, 'invoice'::text, 'payment'::text, 'team_member'::text])))
- `notes_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `notes_pkey` — PRIMARY KEY (id)

### `notes_checklist`

- `notes_checklist_note_id_fkey` — FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
- `notes_checklist_pkey` — PRIMARY KEY (id)

### `notes_files`

- `notes_files_note_id_fkey` — FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
- `notes_files_pkey` — PRIMARY KEY (id)

### `notes_tags`

- `notes_tags_note_id_fkey` — FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
- `notes_tags_note_id_tag_key` — UNIQUE (note_id, tag)
- `notes_tags_pkey` — PRIMARY KEY (id)

### `notifications`

- `notifications_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `notifications_pkey` — PRIMARY KEY (id)

### `org_billing_settings`

- `org_billing_settings_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE RESTRICT
- `org_billing_settings_pkey` — PRIMARY KEY (org_id)

### `org_client_counters`

- `org_client_counters_pkey` — PRIMARY KEY (org_id)

### `org_features`

- `org_features_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `org_features_pkey` — PRIMARY KEY (id)
- `org_features_unique` — UNIQUE (org_id, feature)

### `org_invoice_sequences`

- `org_invoice_sequences_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE RESTRICT
- `org_invoice_sequences_pkey` — PRIMARY KEY (org_id)

### `org_job_counters`

- `org_job_counters_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `org_job_counters_pkey` — PRIMARY KEY (org_id)

### `org_knowledge`

- `org_knowledge_org_id_category_key_key` — UNIQUE (org_id, category, key)
- `org_knowledge_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `org_knowledge_pkey` — PRIMARY KEY (id)

### `orgs`

- `orgs_pkey` — PRIMARY KEY (id)

### `payment_provider_secrets`

- `payment_provider_secrets_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `payment_provider_secrets_pkey` — PRIMARY KEY (org_id)

### `payment_provider_settings`

- `payment_provider_settings_default_provider_check` — CHECK ((default_provider = ANY (ARRAY['none'::text, 'stripe'::text, 'paypal'::text])))
- `payment_provider_settings_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `payment_provider_settings_pkey` — PRIMARY KEY (org_id)

### `payment_providers`

- `payment_providers_default_provider_check` — CHECK (((default_provider IS NULL) OR (default_provider = ANY (ARRAY['stripe'::text, 'paypal'::text]))))
- `payment_providers_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE RESTRICT
- `payment_providers_org_id_key` — UNIQUE (org_id)
- `payment_providers_pkey` — PRIMARY KEY (id)

### `payment_requests`

- `payment_requests_amount_cents_check` — CHECK ((amount_cents > 0))
- `payment_requests_invoice_id_fkey` — FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
- `payment_requests_invoice_id_same_org` — FOREIGN KEY (org_id, invoice_id) REFERENCES invoices(org_id, id)
- `payment_requests_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE RESTRICT
- `payment_requests_org_id_id_uq` — UNIQUE (org_id, id)
- `payment_requests_pkey` — PRIMARY KEY (id)
- `payment_requests_public_token_key` — UNIQUE (public_token)
- `payment_requests_status_check` — CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'processing'::text, 'paid'::text, 'expired'::text, 'cancelled'::text])))
- `pr_amount_nonneg` — CHECK ((amount_cents > 0))

### `payment_requirements`

- `payment_requirements_entity_type_check` — CHECK ((entity_type = ANY (ARRAY['quote'::text, 'job'::text, 'invoice'::text])))
- `payment_requirements_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE RESTRICT
- `payment_requirements_payment_id_fkey` — FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL
- `payment_requirements_payment_id_same_org` — FOREIGN KEY (org_id, payment_id) REFERENCES payments(org_id, id)
- `payment_requirements_pkey` — PRIMARY KEY (id)
- `payment_requirements_requirement_type_check` — CHECK ((requirement_type = ANY (ARRAY['deposit'::text, 'full_payment'::text, 'payment_method_on_file'::text])))
- `payment_requirements_status_check` — CHECK ((status = ANY (ARRAY['pending'::text, 'authorized'::text, 'paid'::text, 'waived'::text, 'failed'::text, 'not_applicable'::text])))

### `payments`

- `payments_amount_cents_check` — CHECK ((amount_cents >= 0))
- `payments_amount_cents_non_negative` — CHECK ((amount_cents >= 0))
- `payments_amount_nonneg` — CHECK (((amount_cents IS NULL) OR (amount_cents >= 0)))
- `payments_app_fee_nonneg` — CHECK (((application_fee_amount IS NULL) OR (application_fee_amount >= 0)))
- `payments_client_id_fkey` — FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
- `payments_client_id_same_org` — FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id)
- `payments_invoice_id_fkey` — FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT
- `payments_invoice_id_same_org` — FOREIGN KEY (org_id, invoice_id) REFERENCES invoices(org_id, id)
- `payments_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
- `payments_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `payments_method_check` — CHECK (((method IS NULL) OR (method = ANY (ARRAY['card'::text, 'e-transfer'::text, 'cash'::text, 'check'::text]))))
- `payments_net_nonneg` — CHECK (((net_amount IS NULL) OR (net_amount >= 0)))
- `payments_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE RESTRICT
- `payments_org_id_id_uq` — UNIQUE (org_id, id)
- `payments_payment_request_id_fkey` — FOREIGN KEY (payment_request_id) REFERENCES payment_requests(id) ON DELETE SET NULL
- `payments_payment_request_id_same_org` — FOREIGN KEY (org_id, payment_request_id) REFERENCES payment_requests(org_id, id)
- `payments_pkey` — PRIMARY KEY (id)
- `payments_provider_check` — CHECK ((provider = ANY (ARRAY['stripe'::text, 'paypal'::text, 'manual'::text])))
- `payments_status_check` — CHECK ((status = ANY (ARRAY['succeeded'::text, 'pending'::text, 'failed'::text, 'refunded'::text])))
- `payments_stripe_fee_nonneg` — CHECK (((stripe_fee_amount IS NULL) OR (stripe_fee_amount >= 0)))

### `payroll_adjustments`

- `payroll_adjustments_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `payroll_adjustments_pkey` — PRIMARY KEY (id)

### `payroll_payments`

- `payroll_payments_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `payroll_payments_org_id_user_id_period_start_period_end_key` — UNIQUE (org_id, user_id, period_start, period_end)
- `payroll_payments_pkey` — PRIMARY KEY (id)

### `payroll_settings`

- `payroll_settings_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `payroll_settings_pay_day_offset_check` — CHECK (((pay_day_offset >= 0) AND (pay_day_offset <= 31)))
- `payroll_settings_pay_period_type_check` — CHECK ((pay_period_type = ANY (ARRAY['weekly'::text, 'biweekly'::text, 'semimonthly'::text, 'monthly'::text])))
- `payroll_settings_pkey` — PRIMARY KEY (org_id)

### `pipeline_deals`

- `pipeline_deals_client_id_fkey` — FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
- `pipeline_deals_client_id_same_org` — FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id)
- `pipeline_deals_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
- `pipeline_deals_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `pipeline_deals_lead_id_fkey` — FOREIGN KEY (lead_id) REFERENCES clients(id) ON DELETE CASCADE
- `pipeline_deals_lead_id_same_org` — FOREIGN KEY (org_id, lead_id) REFERENCES clients(org_id, id)
- `pipeline_deals_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `pipeline_deals_org_id_id_uq` — UNIQUE (org_id, id)
- `pipeline_deals_origin_check` — CHECK (((lead_id IS NOT NULL) OR (client_id IS NOT NULL)))
- `pipeline_deals_pkey` — PRIMARY KEY (id)
- `pipeline_deals_probability_check` — CHECK (((probability >= 0) AND (probability <= 100)))
- `pipeline_deals_quote_id_fkey` — FOREIGN KEY (quote_id) REFERENCES quotes(id)
- `pipeline_deals_quote_id_same_org` — FOREIGN KEY (org_id, quote_id) REFERENCES quotes(org_id, id)
- `pipeline_deals_stage_check` — CHECK ((stage = ANY (ARRAY['new_prospect'::text, 'no_response'::text, 'quote_sent'::text, 'closed_won'::text, 'closed_lost'::text])))

### `pipelines`

- `pipelines_pkey` — PRIMARY KEY (id)
- `pipelines_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

### `plans`

- `plans_pkey` — PRIMARY KEY (id)
- `plans_slug_key` — UNIQUE (slug)

### `predefined_services`

- `predefined_services_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `predefined_services_pkey` — PRIMARY KEY (id)

### `processed_checkout_sessions`

- `processed_checkout_sessions_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE RESTRICT
- `processed_checkout_sessions_pkey` — PRIMARY KEY (id)
- `processed_checkout_sessions_stripe_checkout_session_id_key` — UNIQUE (stripe_checkout_session_id)
- `processed_checkout_sessions_subscription_id_fkey` — FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
- `processed_checkout_sessions_subscription_id_same_org` — FOREIGN KEY (org_id, subscription_id) REFERENCES subscriptions(org_id, id)

### `profiles`

- `profiles_id_fkey` — FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
- `profiles_pkey` — PRIMARY KEY (id)

### `promo_codes`

- `promo_codes_code_key` — UNIQUE (code)
- `promo_codes_pkey` — PRIMARY KEY (id)

### `proof_of_presence`

- `proof_of_presence_event_type_check` — CHECK ((event_type = ANY (ARRAY['enter'::text, 'exit'::text])))
- `proof_of_presence_geofence_id_fkey` — FOREIGN KEY (geofence_id) REFERENCES geofences(id) ON DELETE CASCADE
- `proof_of_presence_geofence_id_same_org` — FOREIGN KEY (org_id, geofence_id) REFERENCES geofences(org_id, id)
- `proof_of_presence_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id)
- `proof_of_presence_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `proof_of_presence_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `proof_of_presence_pkey` — PRIMARY KEY (id)

### `properties`

- `properties_client_id_fkey` — FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
- `properties_client_id_same_org` — FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id)
- `properties_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `properties_org_id_id_uq` — UNIQUE (org_id, id)
- `properties_pkey` — PRIMARY KEY (id)

### `provisioning_events`

- `provisioning_events_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE RESTRICT
- `provisioning_events_pkey` — PRIMARY KEY (id)

### `push_tokens`

- `push_tokens_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `push_tokens_pkey` — PRIMARY KEY (id)
- `push_tokens_platform_check` — CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text, 'web'::text])))

### `quote_attachments`

- `quote_attachments_pkey` — PRIMARY KEY (id)
- `quote_attachments_quote_id_fkey` — FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE

### `quote_line_items`

- `quote_line_items_item_type_check` — CHECK ((item_type = ANY (ARRAY['service'::text, 'text'::text, 'heading'::text])))
- `quote_line_items_pkey` — PRIMARY KEY (id)
- `quote_line_items_quote_id_fkey` — FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE
- `quote_line_items_source_service_id_fkey` — FOREIGN KEY (source_service_id) REFERENCES predefined_services(id) ON DELETE SET NULL

### `quote_measurements`

- `quote_measurements_measurement_type_check` — CHECK ((measurement_type = ANY (ARRAY['line'::text, 'path'::text, 'polygon'::text])))
- `quote_measurements_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `quote_measurements_pkey` — PRIMARY KEY (id)
- `quote_measurements_quote_id_fkey` — FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE
- `quote_measurements_quote_id_same_org` — FOREIGN KEY (org_id, quote_id) REFERENCES quotes(org_id, id)

### `quote_sections`

- `quote_sections_pkey` — PRIMARY KEY (id)
- `quote_sections_quote_id_fkey` — FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE
- `quote_sections_section_type_check` — CHECK ((section_type = ANY (ARRAY['introduction'::text, 'attachments'::text, 'images'::text, 'reviews'::text, 'client_message'::text, 'contract_disclaimer'::text])))

### `quote_send_log`

- `quote_send_log_channel_check` — CHECK ((channel = ANY (ARRAY['email'::text, 'sms'::text])))
- `quote_send_log_pkey` — PRIMARY KEY (id)
- `quote_send_log_quote_id_fkey` — FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE

### `quote_sequences`

- `quote_sequences_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `quote_sequences_pkey` — PRIMARY KEY (org_id)

### `quote_status_history`

- `quote_status_history_pkey` — PRIMARY KEY (id)
- `quote_status_history_quote_id_fkey` — FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE

### `quote_templates`

- `quote_templates_created_by_fkey` — FOREIGN KEY (created_by) REFERENCES auth.users(id)
- `quote_templates_deposit_type_check` — CHECK ((deposit_type = ANY (ARRAY['percentage'::text, 'fixed'::text])))
- `quote_templates_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `quote_templates_pkey` — PRIMARY KEY (id)

### `quote_views`

- `quote_views_client_id_fkey` — FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
- `quote_views_invoice_id_fkey` — FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
- `quote_views_pkey` — PRIMARY KEY (id)

### `quotes`

- `quotes_client_id_fkey` — FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
- `quotes_client_id_same_org` — FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id)
- `quotes_context_type_check` — CHECK ((context_type = ANY (ARRAY['lead'::text, 'client'::text, 'job'::text])))
- `quotes_deposit_status_check` — CHECK ((deposit_status = ANY (ARRAY['not_required'::text, 'pending'::text, 'paid'::text, 'waived'::text])))
- `quotes_deposit_type_check` — CHECK (((deposit_type IS NULL) OR (deposit_type = ANY (ARRAY['percentage'::text, 'fixed'::text]))))
- `quotes_discount_type_check` — CHECK (((discount_type IS NULL) OR (discount_type = ANY (ARRAY['percentage'::text, 'fixed'::text]))))
- `quotes_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
- `quotes_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `quotes_last_sent_channel_check` — CHECK (((last_sent_channel IS NULL) OR (last_sent_channel = ANY (ARRAY['email'::text, 'sms'::text]))))
- `quotes_lead_id_fkey` — FOREIGN KEY (lead_id) REFERENCES clients(id) ON DELETE SET NULL
- `quotes_lead_id_same_org` — FOREIGN KEY (org_id, lead_id) REFERENCES clients(org_id, id)
- `quotes_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `quotes_org_id_id_uq` — UNIQUE (org_id, id)
- `quotes_pkey` — PRIMARY KEY (id)
- `quotes_property_id_fkey` — FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL
- `quotes_property_id_same_org` — FOREIGN KEY (org_id, property_id) REFERENCES properties(org_id, id)
- `quotes_quote_type_check` — CHECK ((quote_type = ANY (ARRAY['one_off'::text, 'service_plan'::text])))
- `quotes_status_check` — CHECK ((status = ANY (ARRAY['draft'::text, 'awaiting_response'::text, 'changes_requested'::text, 'approved'::text, 'declined'::text, 'expired'::text, 'converted'::text, 'archived'::text])))
- `quotes_total_non_negatif` — CHECK (((total_cents IS NULL) OR (total_cents >= 0)))

### `rate_limits`

- `rate_limits_pkey` — PRIMARY KEY (id)
- `uq_rate_limit` — UNIQUE (user_id, action, window_start)

### `recurring_invoice_schedules`

- `recurring_invoice_schedules_client_id_fkey` — FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
- `recurring_invoice_schedules_client_id_same_org` — FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id)
- `recurring_invoice_schedules_frequency_check` — CHECK ((frequency = ANY (ARRAY['weekly'::text, 'biweekly'::text, 'monthly'::text, 'quarterly'::text, 'yearly'::text])))
- `recurring_invoice_schedules_last_invoice_id_fkey` — FOREIGN KEY (last_invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
- `recurring_invoice_schedules_last_invoice_id_same_org` — FOREIGN KEY (org_id, last_invoice_id) REFERENCES invoices(org_id, id)
- `recurring_invoice_schedules_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `recurring_invoice_schedules_pkey` — PRIMARY KEY (id)
- `recurring_invoice_schedules_template_invoice_id_fkey` — FOREIGN KEY (template_invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
- `recurring_invoice_schedules_template_invoice_id_same_org` — FOREIGN KEY (org_id, template_invoice_id) REFERENCES invoices(org_id, id)

### `recurring_team_schedules`

- `recurring_team_schedules_created_by_fkey` — FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
- `recurring_team_schedules_day_of_week_check` — CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))
- `recurring_team_schedules_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `recurring_team_schedules_org_id_id_uq` — UNIQUE (org_id, id)
- `recurring_team_schedules_pkey` — PRIMARY KEY (id)
- `recurring_team_schedules_team_id_fkey` — FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
- `recurring_team_schedules_team_id_same_org` — FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id)
- `recurring_team_schedules_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
- `rts_end_after_start` — CHECK ((end_time > start_time))
- `rts_valid_range` — CHECK (((effective_end_date IS NULL) OR (effective_end_date >= effective_start_date)))

### `referrals`

- `referrals_code_key` — UNIQUE (code)
- `referrals_pkey` — PRIMARY KEY (id)

### `reminder_log`

- `reminder_log_channel_check` — CHECK ((channel = ANY (ARRAY['email'::text, 'sms'::text, 'both'::text])))
- `reminder_log_invoice_id_fkey` — FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
- `reminder_log_invoice_id_same_org` — FOREIGN KEY (org_id, invoice_id) REFERENCES invoices(org_id, id)
- `reminder_log_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `reminder_log_pkey` — PRIMARY KEY (id)
- `reminder_log_status_check` — CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text])))

### `reminder_settings`

- `reminder_settings_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `reminder_settings_pkey` — PRIMARY KEY (org_id)

### `request_forms`

- `request_forms_api_key_key` — UNIQUE (api_key)
- `request_forms_created_by_fkey` — FOREIGN KEY (created_by) REFERENCES auth.users(id)
- `request_forms_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `request_forms_org_id_id_uq` — UNIQUE (org_id, id)
- `request_forms_pkey` — PRIMARY KEY (id)

### `review_requests`

- `review_requests_client_id_fkey` — FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
- `review_requests_client_id_same_org` — FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id)
- `review_requests_email_template_id_fkey` — FOREIGN KEY (email_template_id) REFERENCES email_templates(id) ON DELETE SET NULL
- `review_requests_email_template_id_same_org` — FOREIGN KEY (org_id, email_template_id) REFERENCES email_templates(org_id, id)
- `review_requests_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
- `review_requests_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `review_requests_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `review_requests_pkey` — PRIMARY KEY (id)
- `review_requests_status_check` — CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'clicked'::text, 'submitted'::text, 'failed'::text])))
- `review_requests_survey_id_fkey` — FOREIGN KEY (survey_id) REFERENCES satisfaction_surveys(id) ON DELETE SET NULL
- `review_requests_survey_id_same_org` — FOREIGN KEY (org_id, survey_id) REFERENCES satisfaction_surveys(org_id, id)

### `role_templates`

- `role_templates_default_scope_check` — CHECK ((default_scope = ANY (ARRAY['self'::text, 'assigned'::text, 'team'::text, 'department'::text, 'company'::text])))
- `role_templates_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `role_templates_org_id_slug_key` — UNIQUE (org_id, slug)
- `role_templates_pkey` — PRIMARY KEY (id)

### `satisfaction_surveys`

- `satisfaction_surveys_client_id_fkey` — FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
- `satisfaction_surveys_client_id_same_org` — FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id)
- `satisfaction_surveys_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
- `satisfaction_surveys_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `satisfaction_surveys_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `satisfaction_surveys_org_id_id_uq` — UNIQUE (org_id, id)
- `satisfaction_surveys_pkey` — PRIMARY KEY (id)
- `satisfaction_surveys_rating_check` — CHECK (((rating >= 1) AND (rating <= 5)))
- `satisfaction_surveys_token_key` — UNIQUE (token)

### `scenario_options`

- `scenario_options_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `scenario_options_pkey` — PRIMARY KEY (id)
- `scenario_options_scenario_run_id_fkey` — FOREIGN KEY (scenario_run_id) REFERENCES scenario_runs(id) ON DELETE CASCADE
- `scenario_options_scenario_run_id_same_org` — FOREIGN KEY (org_id, scenario_run_id) REFERENCES scenario_runs(org_id, id)

### `scenario_runs`

- `scenario_runs_decision_log_id_fkey` — FOREIGN KEY (decision_log_id) REFERENCES decision_logs(id) ON DELETE SET NULL
- `scenario_runs_decision_log_id_same_org` — FOREIGN KEY (org_id, decision_log_id) REFERENCES decision_logs(org_id, id)
- `scenario_runs_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `scenario_runs_org_id_id_uq` — UNIQUE (org_id, id)
- `scenario_runs_pkey` — PRIMARY KEY (id)

### `schedule_events`

- `schedule_events_dates_coherentes` — CHECK (((start_at IS NULL) OR (end_at IS NULL) OR (end_at > start_at)))
- `schedule_events_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
- `schedule_events_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `schedule_events_no_tech_overlap` — EXCLUDE USING gist (assigned_user WITH =, org_id WITH =, tstzrange(start_time, end_time) WITH &&) WHERE (((deleted_at IS NULL) AND (assigned_user IS NOT NULL)))
- `schedule_events_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `schedule_events_pkey` — PRIMARY KEY (id)
- `schedule_events_team_id_fkey` — FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
- `schedule_events_team_id_same_org` — FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id)
- `schedule_events_time_check` — CHECK ((end_time > start_time))

### `scheduled_reports`

- `scheduled_reports_frequency_check` — CHECK ((frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text])))
- `scheduled_reports_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `scheduled_reports_pkey` — PRIMARY KEY (id)

### `secret_rotation_log`

- `secret_rotation_log_pkey` — PRIMARY KEY (id)
- `secret_rotation_log_rotated_by_fkey` — FOREIGN KEY (rotated_by) REFERENCES auth.users(id) ON DELETE SET NULL

### `security_alerts`

- `security_alerts_acknowledged_by_fkey` — FOREIGN KEY (acknowledged_by) REFERENCES auth.users(id) ON DELETE SET NULL
- `security_alerts_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `security_alerts_pkey` — PRIMARY KEY (id)
- `security_alerts_severity_check` — CHECK ((severity = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text, 'low'::text])))
- `security_alerts_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL

### `security_canary_runs`

- `security_canary_runs_pkey` — PRIMARY KEY (id)

### `security_events`

- `security_events_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `security_events_pkey` — PRIMARY KEY (id)
- `security_events_resolved_by_fkey` — FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL
- `security_events_severity_check` — CHECK ((severity = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text, 'low'::text, 'info'::text])))
- `security_events_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL

### `security_incidents`

- `security_incidents_detected_by_fkey` — FOREIGN KEY (detected_by) REFERENCES auth.users(id)
- `security_incidents_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `security_incidents_pkey` — PRIMARY KEY (id)
- `security_incidents_severity_check` — CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])))
- `security_incidents_status_check` — CHECK ((status = ANY (ARRAY['detected'::text, 'triaging'::text, 'contained'::text, 'notified'::text, 'closed'::text])))

### `service_contracts`

- `service_contracts_client_id_fkey` — FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
- `service_contracts_client_id_same_org` — FOREIGN KEY (org_id, client_id) REFERENCES clients(org_id, id)
- `service_contracts_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
- `service_contracts_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `service_contracts_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id)
- `service_contracts_pkey` — PRIMARY KEY (id)

### `sms_opt_outs`

- `sms_opt_outs_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `sms_opt_outs_org_id_phone_key` — UNIQUE (org_id, phone)
- `sms_opt_outs_pkey` — PRIMARY KEY (id)

### `specific_notes`

- `specific_notes_created_by_fkey` — FOREIGN KEY (created_by) REFERENCES auth.users(id)
- `specific_notes_entity_type_check` — CHECK ((entity_type = ANY (ARRAY['client'::text, 'job'::text, 'quote'::text])))
- `specific_notes_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `specific_notes_pkey` — PRIMARY KEY (id)

### `subscriptions`

- `subscriptions_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE RESTRICT
- `subscriptions_org_id_id_uq` — UNIQUE (org_id, id)
- `subscriptions_pkey` — PRIMARY KEY (id)
- `subscriptions_plan_id_fkey` — FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE RESTRICT
- `subscriptions_scheduled_interval_check` — CHECK ((scheduled_interval = ANY (ARRAY['monthly'::text, 'yearly'::text])))
- `subscriptions_scheduled_plan_id_fkey` — FOREIGN KEY (scheduled_plan_id) REFERENCES plans(id) ON DELETE SET NULL
- `subscriptions_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

### `tags`

- `tags_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `tags_pkey` — PRIMARY KEY (id)
- `uq_tags_org_name` — UNIQUE (org_id, name)

### `tasks`

- `tasks_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
- `tasks_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `tasks_linked_entity_type_check` — CHECK ((linked_entity_type = ANY (ARRAY['client'::text, 'lead'::text, 'quote'::text, 'invoice'::text, 'job'::text])))
- `tasks_linked_person_type_check` — CHECK ((linked_person_type = ANY (ARRAY['recruit'::text, 'client'::text, 'prospect'::text, 'contact'::text, 'team_member'::text])))
- `tasks_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `tasks_pkey` — PRIMARY KEY (id)
- `tasks_priority_check` — CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])))
- `tasks_status_check` — CHECK ((status = ANY (ARRAY['open'::text, 'done'::text])))

### `tax_configs`

- `tax_configs_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `tax_configs_pkey` — PRIMARY KEY (id)
- `tax_configs_type_check` — CHECK ((type = ANY (ARRAY['percentage'::text, 'fixed'::text])))

### `tax_group_items`

- `tax_group_items_pkey` — PRIMARY KEY (id)
- `tax_group_items_tax_config_id_fkey` — FOREIGN KEY (tax_config_id) REFERENCES tax_configs(id) ON DELETE CASCADE
- `tax_group_items_tax_group_id_fkey` — FOREIGN KEY (tax_group_id) REFERENCES tax_groups(id) ON DELETE CASCADE
- `tax_group_items_tax_group_id_tax_config_id_key` — UNIQUE (tax_group_id, tax_config_id)

### `tax_groups`

- `tax_groups_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `tax_groups_org_id_id_uq` — UNIQUE (org_id, id)
- `tax_groups_pkey` — PRIMARY KEY (id)

### `team_assignments`

- `team_assignments_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `team_assignments_org_id_user_id_team_id_key` — UNIQUE (org_id, user_id, team_id)
- `team_assignments_pkey` — PRIMARY KEY (id)
- `team_assignments_team_id_fkey` — FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
- `team_assignments_team_id_same_org` — FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id)
- `team_assignments_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

### `team_availability`

- `chk_time_range` — CHECK ((end_minute > start_minute))
- `team_availability_end_minute_check` — CHECK (((end_minute > 0) AND (end_minute <= 1440)))
- `team_availability_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `team_availability_pkey` — PRIMARY KEY (id)
- `team_availability_start_minute_check` — CHECK (((start_minute >= 0) AND (start_minute < 1440)))
- `team_availability_team_id_fkey` — FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
- `team_availability_team_id_same_org` — FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id)
- `team_availability_weekday_check` — CHECK (((weekday >= 0) AND (weekday <= 6)))

### `team_capabilities`

- `team_capabilities_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `team_capabilities_pkey` — PRIMARY KEY (id)
- `team_capabilities_team_id_fkey` — FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
- `team_capabilities_team_id_same_org` — FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id)

### `team_date_slots`

- `end_after_start` — CHECK ((end_time > start_time))
- `team_date_slots_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `team_date_slots_pkey` — PRIMARY KEY (id)
- `team_date_slots_status_check` — CHECK ((status = ANY (ARRAY['available'::text, 'blocked'::text])))
- `team_date_slots_team_id_fkey` — FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
- `team_date_slots_team_id_same_org` — FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id)

### `team_members`

- `team_members_compensation_mode_check` — CHECK ((compensation_mode = ANY (ARRAY['hourly'::text, 'commission'::text, 'both'::text])))
- `team_members_deletion_requested_by_fkey` — FOREIGN KEY (deletion_requested_by) REFERENCES auth.users(id)
- `team_members_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `team_members_pkey` — PRIMARY KEY (id)
- `team_members_role_check` — CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'technician'::text])))
- `team_members_status_check` — CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
- `team_members_team_id_fkey` — FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
- `team_members_team_id_same_org` — FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id)
- `team_members_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL

### `team_schedule_assignments`

- `team_schedule_assignments_availability_status_check` — CHECK ((availability_status = ANY (ARRAY['available'::text, 'unavailable'::text, 'removed'::text])))
- `team_schedule_assignments_created_by_fkey` — FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
- `team_schedule_assignments_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `team_schedule_assignments_pkey` — PRIMARY KEY (id)
- `team_schedule_assignments_recurring_schedule_id_same_org` — FOREIGN KEY (org_id, recurring_schedule_id) REFERENCES recurring_team_schedules(org_id, id)
- `team_schedule_assignments_source_check` — CHECK ((source = ANY (ARRAY['manual'::text, 'exception'::text, 'copy'::text])))
- `team_schedule_assignments_team_id_fkey` — FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
- `team_schedule_assignments_team_id_same_org` — FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id)
- `team_schedule_assignments_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
- `tsa_end_after_start` — CHECK ((end_time > start_time))
- `tsa_recurring_fkey` — FOREIGN KEY (recurring_schedule_id) REFERENCES recurring_team_schedules(id) ON DELETE SET NULL

### `team_schedule_audit`

- `team_schedule_audit_actor_id_fkey` — FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL
- `team_schedule_audit_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `team_schedule_audit_pkey` — PRIMARY KEY (id)

### `teams`

- `teams_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `teams_org_id_id_uq` — UNIQUE (org_id, id)
- `teams_pkey` — PRIMARY KEY (id)

### `technician_device_mappings`

- `technician_device_mappings_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `technician_device_mappings_pkey` — PRIMARY KEY (id)
- `technician_device_mappings_provider_id_fkey` — FOREIGN KEY (provider_id) REFERENCES gps_providers(id) ON DELETE CASCADE
- `technician_device_mappings_provider_id_same_org` — FOREIGN KEY (org_id, provider_id) REFERENCES gps_providers(org_id, id)

### `technician_locations`

- `technician_locations_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `technician_locations_pkey` — PRIMARY KEY (id)

### `time_entries`

- `time_entries_approved_by_fkey` — FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL
- `time_entries_employee_id_fkey` — FOREIGN KEY (employee_id) REFERENCES auth.users(id) ON DELETE SET NULL
- `time_entries_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
- `time_entries_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `time_entries_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `time_entries_org_id_id_uq` — UNIQUE (org_id, id)
- `time_entries_pkey` — PRIMARY KEY (id)
- `time_entries_status_check` — CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'completed'::text])))
- `time_entries_team_id_fkey` — FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
- `time_entries_team_id_same_org` — FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id)

### `time_off_requests`

- `time_off_requests_approved_by_fkey` — FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL
- `time_off_requests_created_by_fkey` — FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
- `time_off_requests_kind_check` — CHECK ((kind = ANY (ARRAY['time_off'::text, 'vacation'::text, 'sick'::text, 'absence'::text, 'unavailable'::text, 'other'::text])))
- `time_off_requests_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `time_off_requests_pkey` — PRIMARY KEY (id)
- `time_off_requests_status_check` — CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])))
- `time_off_requests_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
- `tor_partial_times` — CHECK ((all_day OR ((start_time IS NOT NULL) AND (end_time IS NOT NULL) AND (end_time > start_time))))
- `tor_valid_range` — CHECK ((end_date >= start_date))

### `tracking_events`

- `tracking_events_event_type_check` — CHECK ((event_type = ANY (ARRAY['session_start'::text, 'session_stop'::text, 'session_expired'::text, 'permission_granted'::text, 'permission_denied'::text, 'permission_revoked'::text, 'gps_error'::text, 'gps_recovered':
- `tracking_events_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `tracking_events_pkey` — PRIMARY KEY (id)
- `tracking_events_session_id_fkey` — FOREIGN KEY (session_id) REFERENCES tracking_sessions(id) ON DELETE CASCADE
- `tracking_events_session_id_same_org` — FOREIGN KEY (org_id, session_id) REFERENCES tracking_sessions(org_id, id)

### `tracking_live_locations`

- `tracking_live_locations_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id)
- `tracking_live_locations_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `tracking_live_locations_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `tracking_live_locations_pkey` — PRIMARY KEY (user_id)
- `tracking_live_locations_session_id_fkey` — FOREIGN KEY (session_id) REFERENCES tracking_sessions(id) ON DELETE SET NULL
- `tracking_live_locations_session_id_same_org` — FOREIGN KEY (org_id, session_id) REFERENCES tracking_sessions(org_id, id)
- `tracking_live_locations_team_id_fkey` — FOREIGN KEY (team_id) REFERENCES teams(id)
- `tracking_live_locations_team_id_same_org` — FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id)
- `tracking_live_locations_tracking_status_check` — CHECK ((tracking_status = ANY (ARRAY['active'::text, 'idle'::text, 'offline'::text, 'stale'::text])))

### `tracking_points`

- `tracking_points_job_id_fkey` — FOREIGN KEY (job_id) REFERENCES jobs(id)
- `tracking_points_job_id_same_org` — FOREIGN KEY (org_id, job_id) REFERENCES jobs(org_id, id)
- `tracking_points_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `tracking_points_pkey` — PRIMARY KEY (id)
- `tracking_points_session_id_fkey` — FOREIGN KEY (session_id) REFERENCES tracking_sessions(id) ON DELETE CASCADE
- `tracking_points_session_id_same_org` — FOREIGN KEY (org_id, session_id) REFERENCES tracking_sessions(org_id, id)
- `tracking_points_team_id_fkey` — FOREIGN KEY (team_id) REFERENCES teams(id)
- `tracking_points_team_id_same_org` — FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id)

### `tracking_sessions`

- `tracking_sessions_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `tracking_sessions_org_id_id_uq` — UNIQUE (org_id, id)
- `tracking_sessions_pkey` — PRIMARY KEY (id)
- `tracking_sessions_source_check` — CHECK ((source = ANY (ARRAY['web'::text, 'mobile'::text, 'external'::text])))
- `tracking_sessions_status_check` — CHECK ((status = ANY (ARRAY['active'::text, 'stopped'::text, 'lost_permission'::text, 'error'::text, 'expired'::text])))
- `tracking_sessions_team_id_fkey` — FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
- `tracking_sessions_team_id_same_org` — FOREIGN KEY (org_id, team_id) REFERENCES teams(org_id, id)
- `tracking_sessions_time_entry_id_fkey` — FOREIGN KEY (time_entry_id) REFERENCES time_entries(id) ON DELETE SET NULL
- `tracking_sessions_time_entry_id_same_org` — FOREIGN KEY (org_id, time_entry_id) REFERENCES time_entries(org_id, id)

### `user_agent_preferences`

- `user_agent_preferences_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `user_agent_preferences_org_id_user_id_key` — UNIQUE (org_id, user_id)
- `user_agent_preferences_pkey` — PRIMARY KEY (id)
- `user_agent_preferences_user_id_fkey` — FOREIGN KEY (user_id) REFERENCES auth.users(id)

### `webhook_deliveries`

- `webhook_deliveries_endpoint_id_fkey` — FOREIGN KEY (endpoint_id) REFERENCES webhook_endpoints(id) ON DELETE CASCADE
- `webhook_deliveries_endpoint_id_same_org` — FOREIGN KEY (org_id, endpoint_id) REFERENCES webhook_endpoints(org_id, id)
- `webhook_deliveries_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `webhook_deliveries_pkey` — PRIMARY KEY (id)
- `wh_deliveries_status_check` — CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'abandoned'::text])))

### `webhook_endpoints`

- `webhook_endpoints_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `webhook_endpoints_org_id_id_uq` — UNIQUE (org_id, id)
- `webhook_endpoints_pkey` — PRIMARY KEY (id)

### `webhook_events`

- `webhook_events_pkey` — PRIMARY KEY (id)
- `webhook_events_provider_check` — CHECK ((provider = ANY (ARRAY['stripe'::text, 'paypal'::text])))
- `webhook_events_status_check` — CHECK ((status = ANY (ARRAY['pending'::text, 'processed'::text, 'failed'::text, 'skipped'::text])))
- `webhook_events_stripe_event_id_key` — UNIQUE (stripe_event_id)

### `workflow_edges`

- `workflow_edges_pkey` — PRIMARY KEY (id)
- `workflow_edges_source_id_fkey` — FOREIGN KEY (source_id) REFERENCES workflow_nodes(id) ON DELETE CASCADE
- `workflow_edges_target_id_fkey` — FOREIGN KEY (target_id) REFERENCES workflow_nodes(id) ON DELETE CASCADE
- `workflow_edges_workflow_id_fkey` — FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE

### `workflow_logs`

- `workflow_logs_level_check` — CHECK ((level = ANY (ARRAY['info'::text, 'warn'::text, 'error'::text, 'debug'::text])))
- `workflow_logs_node_id_fkey` — FOREIGN KEY (node_id) REFERENCES workflow_nodes(id) ON DELETE SET NULL
- `workflow_logs_pkey` — PRIMARY KEY (id)
- `workflow_logs_run_id_fkey` — FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE

### `workflow_nodes`

- `workflow_nodes_node_type_check` — CHECK ((node_type = ANY (ARRAY['trigger'::text, 'condition'::text, 'action'::text, 'delay'::text])))
- `workflow_nodes_pkey` — PRIMARY KEY (id)
- `workflow_nodes_workflow_id_fkey` — FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE

### `workflow_runs`

- `workflow_runs_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `workflow_runs_pkey` — PRIMARY KEY (id)
- `workflow_runs_status_check` — CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])))
- `workflow_runs_workflow_id_fkey` — FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
- `workflow_runs_workflow_id_same_org` — FOREIGN KEY (org_id, workflow_id) REFERENCES workflows(org_id, id)

### `workflows`

- `workflows_delay_unit_check` — CHECK ((delay_unit = ANY (ARRAY['immediate'::text, 'minutes'::text, 'hours'::text, 'days'::text])))
- `workflows_org_id_fkey` — FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
- `workflows_org_id_id_uq` — UNIQUE (org_id, id)
- `workflows_pkey` — PRIMARY KEY (id)
- `workflows_status_check` — CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'paused'::text])))

## 7. Triggers (221)

- `a2p_registrations` → **trg_a2p_registrations_updated_at** (`set_updated_at()`)
- `activity_notes` → **trg_ac_track_activity_notes** (`ac_track_activity_notes()`)
- `activity_notes` → **trg_activity_notes_updated_at** (`set_activity_notes_updated_at()`)
- `agent_messages` → **agent_messages_after_insert** (`trg_agent_messages_after_insert()`)
- `alert_rules` → **set_alert_rules_updated_at** (`set_updated_at()`)
- `app_connections` → **trg_app_connections_updated_at** (`set_app_connections_updated_at()`)
- `audit_events` → **audit_events_no_delete** (`audit_events_append_only()`)
- `audit_events` → **audit_events_no_update** (`audit_events_append_only()`)
- `automation_rules` → **trg_automation_rules_updated** (`set_automation_rules_updated_at()`)
- `automations` → **set_automations_updated_at** (`set_updated_at()`)
- `billing_profiles` → **set_billing_profiles_updated_at** (`set_updated_at()`)
- `board_comments` → **set_board_comments_updated_at** (`set_updated_at()`)
- `booking_pages` → **set_booking_pages_updated_at** (`set_updated_at()`)
- `checklist_templates` → **set_checklist_templates_updated_at** (`set_updated_at()`)
- `clients` → **bump_clients_version** (`bump_row_version()`)
- `clients` → **trg_clients_auto_property** (`clients_auto_property_from_address()`)
- `clients` → **trg_clients_cascade_pipeline_soft_delete** (`pipeline_deals_cascade_client_soft_delete()`)
- `clients` → **trg_clients_enforce_scope** (`crm_enforce_scope()`)
- `clients` → **trg_clients_enforce_soft_delete_admin** (`enforce_soft_delete_admin()`)
- `clients` → **trg_clients_ensure_field_pin_address** (`ensure_field_pin_for_client()`)
- `clients` → **trg_clients_ensure_field_pin_insert** (`ensure_field_pin_for_client()`)
- `clients` → **trg_clients_fts** (`trg_clients_fts_update()`)
- `clients` → **trg_clients_set_updated_at** (`set_updated_at()`)
- `clients` → **trg_clients_sync_field_pin** (`sync_field_pin_from_client()`)
- `clients` → **trg_clients_zz_assign_number** (`assign_client_number()`)
- `commission_settings` → **set_commission_settings_updated_at** (`set_updated_at()`)
- `communication_channels` → **trg_comm_channels_updated** (`update_comm_updated_at()`)
- `communication_messages` → **trg_comm_messages_updated** (`update_comm_updated_at()`)
- `communication_settings` → **trg_comm_settings_updated** (`update_comm_updated_at()`)
- `company_operating_profile` → **set_company_operating_profile_updated_at** (`set_updated_at()`)
- `company_settings` → **set_company_settings_updated_at** (`set_updated_at()`)
- `connected_accounts` → **trg_connected_accounts_updated_at** (`set_connected_accounts_updated_at()`)
- `contacts` → **trg_contacts_set_updated_at** (`set_updated_at()`)
- `conversations` → **set_conversations_updated_at** (`set_updated_at()`)
- `course_lessons` → **set_course_lessons_updated_at** (`set_updated_at()`)
- `course_modules` → **set_course_modules_updated_at** (`set_updated_at()`)
- `courses` → **set_courses_updated_at** (`set_updated_at()`)
- `custom_column_values` → **custom_column_values_updated_at** (`set_updated_at()`)
- `custom_columns` → **custom_columns_updated_at** (`set_updated_at()`)
- `dsar_requests` → **set_dsar_requests_updated_at** (`set_updated_at()`)
- `email_accounts` → **trg_email_accounts_updated_at** (`set_email_accounts_updated_at()`)
- `email_campaigns` → **set_email_campaigns_updated_at** (`set_updated_at()`)
- `email_templates` → **trg_email_templates_updated** (`set_email_templates_updated_at()`)
- `email_threads` → **trg_email_threads_updated_at** (`set_email_threads_updated_at()`)
- `field_house_events` → **trg_field_daily_stats_apply** (`fn_field_daily_stats_apply()`)
- `field_house_profiles` → **set_field_house_profiles_updated_at** (`set_updated_at()`)
- `field_house_profiles` → **trg_zone_exclusivity** (`enforce_zone_exclusivity()`)
- `field_pins` → **set_field_pins_updated_at** (`set_updated_at()`)
- `field_sales_reps` → **set_field_sales_reps_updated_at** (`set_updated_at()`)
- `field_sales_teams` → **set_field_sales_teams_updated_at** (`set_updated_at()`)
- `field_settings` → **set_field_settings_updated_at** (`set_updated_at()`)
- `field_territories` → **set_field_territories_updated_at** (`set_updated_at()`)
- `fs_badges` → **set_fs_badges_updated_at** (`set_updated_at()`)
- `fs_battles` → **set_fs_battles_updated_at** (`set_updated_at()`)
- `fs_challenge_participants` → **set_fs_challenge_participants_updated_at** (`set_updated_at()`)
- `fs_challenges` → **set_fs_challenges_updated_at** (`set_updated_at()`)
- `fs_commission_entries` → **set_fs_commission_entries_updated_at** (`set_updated_at()`)
- `fs_commission_rules` → **set_fs_commission_rules_updated_at** (`set_updated_at()`)
- `fs_field_sessions` → **set_fs_field_sessions_updated_at** (`set_updated_at()`)
- `goals` → **set_goals_updated_at** (`set_updated_at()`)
- `gps_providers` → **gps_providers_updated_at** (`set_updated_at()`)
- `invitations` → **trg_invitations_updated_at** (`set_updated_at()`)
- `invoice_items` → **bump_invoice_items_version** (`bump_row_version()`)
- `invoice_items` → **trg_invoice_items_recalculate_parent_delete** (`invoice_items_recalculate_parent()`)
- `invoice_items` → **trg_invoice_items_recalculate_parent_insert** (`invoice_items_recalculate_parent()`)
- `invoice_items` → **trg_invoice_items_recalculate_parent_update** (`invoice_items_recalculate_parent()`)
- `invoice_items` → **trg_invoice_items_set_line_total** (`invoice_items_set_line_total()`)
- `invoice_items` → **trg_invoice_items_sync_org** (`invoice_items_sync_org()`)
- `invoice_sequences` → **set_invoice_sequences_updated_at** (`set_updated_at()`)
- `invoice_templates` → **trg_invoice_templates_set_updated_at** (`set_updated_at()`)
- `invoices` → **invoices_bump_version** (`bump_row_version()`)
- `invoices` → **invoices_immutable** (`enforce_invoice_immutability()`)
- `invoices` → **sync_invoices_legacy_money** (`sync_legacy_money_columns()`)
- `invoices` → **trg_ac_track_invoices** (`ac_track_invoices()`)
- `invoices` → **trg_automation_invoice_overdue** (`automation_invoice_overdue_check()`)
- `invoices` → **trg_invoice_client_snapshot** (`set_invoice_client_snapshot()`)
- `invoices` → **trg_invoice_paid_lock** (`prevent_paid_invoice_edit()`)
- `invoices` → **trg_invoices_apply_status_logic** (`invoices_apply_status_logic()`)
- `invoices` → **trg_invoices_ensure_number** (`crm_invoices_ensure_number()`)
- `invoices` → **trg_invoices_fill_property_id** (`fill_property_id_from_job_or_client()`)
- `invoices` → **trg_invoices_fts** (`trg_invoices_fts_update()`)
- `invoices` → **trg_invoices_set_updated_at** (`set_updated_at()`)
- `invoices` → **trg_log_invoice_updated** (`log_invoice_updated()`)
- `job_agreements` → **trg_job_agreements_job_only** (`job_agreements_enforce_job_only()`)
- `job_agreements` → **trg_job_agreements_set_updated_at** (`set_updated_at()`)
- `job_billing_milestones` → **trg_job_billing_milestones_set_updated_at** (`set_updated_at()`)
- `job_checklists` → **set_job_checklists_updated_at** (`set_updated_at()`)
- `job_intents` → **set_job_intents_updated_at** (`set_updated_at()`)
- `job_line_items` → **bump_job_line_items_version** (`bump_row_version()`)
- `job_line_items` → **trg_job_line_items_enforce_scope** (`crm_enforce_scope()`)
- `job_line_items` → **trg_job_line_items_recalc_totals** (`recalculate_job_totals_from_items()`)
- `job_line_items` → **trg_job_line_items_set_totals** (`job_line_items_set_totals()`)
- `job_line_items` → **trg_job_line_items_set_updated_at** (`set_updated_at()`)
- `job_recurrence_rules` → **set_job_recurrence_rules_updated_at** (`set_updated_at()`)
- `job_templates` → **set_job_templates_updated_at** (`set_updated_at()`)
- `jobs` → **jobs_bump_version** (`bump_row_version()`)
- `jobs` → **set_jobs_updated_at** (`set_jobs_updated_at()`)
- `jobs` → **sync_jobs_legacy_money** (`sync_legacy_money_columns()`)
- `jobs` → **trg_jobs_fill_property_id** (`jobs_fill_property_id()`)
- `jobs` → **trg_jobs_set_updated_at** (`set_updated_at()`)
- `jobs` → **trg_jobs_sync_address** (`jobs_sync_address()`)
- `jobs` → **trg_jobs_updated_at** (`set_jobs_updated_at()`)
- `jobs` → **trg_jobs_zz_assign_number** (`assign_job_number()`)
- `jobs` → **trg_log_job_created** (`log_job_created()`)
- `jobs` → **trg_log_job_updated** (`log_job_updated()`)
- `jobs` → **trg_sync_job_leaderboard_deal_ins** (`sync_job_leaderboard_deal()`)
- `jobs` → **trg_sync_job_leaderboard_deal_upd** (`sync_job_leaderboard_deal()`)
- `location_tracking_settings` → **trg_location_tracking_settings_updated_at** (`set_updated_at()`)
- `memberships` → **set_memberships_updated_at** (`set_updated_at()`)
- `memberships` → **trg_enforce_membership_role_change** (`enforce_membership_role_change()`)
- `memberships` → **trg_membership_security_audit** (`trg_membership_change_audit()`)
- `messages` → **trg_message_insert** (`update_conversation_on_message()`)
- `mfa_phone` → **set_mfa_phone_updated_at** (`set_updated_at()`)
- `note_boards` → **trg_note_boards_updated** (`set_note_updated_at()`)
- `note_items` → **trg_note_items_updated** (`set_note_updated_at()`)
- `notes` → **trg_notes_history** (`save_note_history()`)
- `notes` → **trg_notes_updated** (`set_notes_updated_at()`)
- `notifications` → **trg_push_on_notification** (`fn_push_on_notification()`)
- `notifications` → **trg_sync_notification_is_read** (`sync_notification_is_read()`)
- `org_billing_settings` → **trg_org_billing_settings_set_updated_at** (`set_updated_at()`)
- `org_billing_settings` → **trg_touch_org_billing_settings_updated_at** (`touch_org_billing_settings_updated_at()`)
- `org_client_counters` → **set_org_client_counters_updated_at** (`set_updated_at()`)
- `org_features` → **org_features_updated_at** (`trg_org_features_updated_at()`)
- `org_invoice_sequences` → **set_org_invoice_sequences_updated_at** (`set_updated_at()`)
- `org_job_counters` → **set_org_job_counters_updated_at** (`set_updated_at()`)
- `org_knowledge` → **trg_org_knowledge_updated_at** (`update_org_knowledge_updated_at()`)
- `orgs` → **trg_auto_create_comm_settings** (`auto_create_comm_settings()`)
- `orgs` → **trg_org_created_seed_automations** (`handle_org_created_seed_automations()`)
- `orgs` → **trg_orgs_assign_company_group** (`assign_org_company_group()`)
- `orgs` → **trg_orgs_set_updated_at** (`set_updated_at()`)
- `payment_provider_secrets` → **trg_payment_provider_secrets_set_updated_at** (`set_updated_at()`)
- `payment_provider_secrets` → **trg_payment_provider_secrets_updated_at** (`set_updated_at()`)
- `payment_provider_secrets` → **trg_ppsec_updated_at** (`set_updated_at()`)
- `payment_provider_settings` → **trg_payment_provider_settings_set_updated_at** (`set_updated_at()`)
- `payment_provider_settings` → **trg_payment_provider_settings_updated_at** (`set_updated_at()`)
- `payment_provider_settings` → **trg_pps_updated_at** (`set_updated_at()`)
- `payment_providers` → **trg_payment_providers_enforce_scope** (`crm_enforce_scope()`)
- `payment_providers` → **trg_payment_providers_set_updated_at** (`set_updated_at()`)
- `payment_requests` → **trg_payment_requests_updated_at** (`set_payment_requests_updated_at()`)
- `payment_requirements` → **set_payment_requirements_updated_at** (`set_updated_at()`)
- `payment_requirements` → **trg_ac_track_card_saved** (`ac_track_card_saved()`)
- `payments` → **trg_ac_track_payments** (`ac_track_payments()`)
- `payments` → **trg_payment_to_invoice_paid** (`trg_payment_to_invoice_paid()`)
- `payments` → **trg_payments_enforce_scope** (`crm_enforce_scope()`)
- `payments` → **trg_payments_recalculate_invoice** (`payments_recalculate_invoice_trigger()`)
- `payments` → **trg_payments_set_updated_at** (`set_updated_at()`)
- `payments` → **trg_payments_sync_dates** (`payments_sync_dates_and_update()`)
- `payments` → **trg_payments_sync_legacy_dates** (`payments_sync_legacy_dates()`)
- `payroll_settings` → **set_payroll_settings_updated_at** (`set_updated_at()`)
- `pipeline_deals` → **bump_pipeline_deals_version** (`bump_row_version()`)
- `pipeline_deals` → **trg_pipeline_deals_emit_job_intent** (`pipeline_deals_emit_job_intent()`)
- `pipeline_deals` → **trg_pipeline_deals_enforce_scope** (`crm_enforce_scope()`)
- `pipeline_deals` → **trg_pipeline_deals_set_updated_at** (`set_updated_at()`)
- `pipeline_deals` → **trg_pipeline_deals_sync_lead_stage** (`sync_lead_stage_from_deal()`)
- `pipeline_deals` → **trg_pipeline_deals_sync_values** (`pipeline_deals_sync_values()`)
- `plans` → **set_plans_updated_at** (`set_updated_at()`)
- `predefined_services` → **set_predefined_services_updated_at** (`set_updated_at()`)
- `profiles` → **trg_profiles_set_updated_at** (`set_updated_at()`)
- `properties` → **bump_properties_version** (`bump_row_version()`)
- `properties` → **trg_properties_enforce_scope** (`crm_enforce_scope()`)
- `properties` → **trg_properties_set_updated_at** (`set_updated_at()`)
- `provisioning_events` → **trg_provisioning_events_updated_at** (`set_updated_at()`)
- `push_tokens` → **set_push_tokens_updated_at** (`set_updated_at()`)
- `quote_line_items` → **trg_quote_line_items_set_total** (`quote_line_items_set_total()`)
- `quote_line_items` → **trg_quote_line_items_set_updated_at** (`set_updated_at()`)
- `quote_measurements` → **trg_quote_measurements_updated_at** (`quote_measurements_updated_at()`)
- `quote_sections` → **set_quote_sections_updated_at** (`set_updated_at()`)
- `quote_sequences` → **set_quote_sequences_updated_at** (`set_updated_at()`)
- `quote_templates` → **set_quote_templates_updated_at** (`set_updated_at()`)
- `quotes` → **quotes_bump_version** (`bump_row_version()`)
- `quotes` → **trg_ac_track_quotes** (`ac_track_quotes()`)
- `quotes` → **trg_auto_pipeline_deal_from_quote** (`auto_pipeline_deal_from_quote()`)
- `quotes` → **trg_auto_pipeline_deal_from_quote_update** (`auto_pipeline_deal_from_quote_update()`)
- `quotes` → **trg_log_quote_created** (`log_quote_created()`)
- `quotes` → **trg_quotes_fill_property_id** (`fill_property_id_from_job_or_client()`)
- `quotes` → **trg_quotes_set_updated_at** (`set_updated_at()`)
- `recurring_invoice_schedules` → **set_recurring_invoice_schedules_updated_at** (`set_updated_at()`)
- `recurring_team_schedules` → **bump_recurring_team_schedules_version** (`bump_row_version()`)
- `recurring_team_schedules` → **trg_rts_updated** (`set_team_schedule_updated_at()`)
- `referrals` → **set_referrals_updated_at** (`set_updated_at()`)
- `reminder_settings` → **set_reminder_settings_updated_at** (`set_updated_at()`)
- `request_forms` → **set_request_forms_updated_at** (`set_updated_at()`)
- `role_templates` → **set_role_templates_updated_at** (`set_updated_at()`)
- `satisfaction_surveys` → **trg_ac_track_survey_reviews** (`ac_track_survey_reviews()`)
- `schedule_events` → **bump_schedule_events_version** (`bump_row_version()`)
- `schedule_events` → **trg_schedule_events_apply_job_team_default** (`schedule_events_apply_job_team_default()`)
- `schedule_events` → **trg_schedule_events_enforce_scope** (`crm_enforce_scope()`)
- `schedule_events` → **trg_schedule_events_set_updated_at** (`set_updated_at()`)
- `schedule_events` → **trg_schedule_events_sync_time_columns** (`sync_schedule_event_time_columns()`)
- `scheduled_reports` → **set_scheduled_reports_updated_at** (`set_updated_at()`)
- `security_incidents` → **set_security_incidents_updated_at** (`set_updated_at()`)
- `service_contracts` → **bump_service_contracts_version** (`bump_row_version()`)
- `service_contracts` → **trg_service_contracts_set_updated_at** (`set_updated_at()`)
- `specific_notes` → **trg_ac_track_specific_notes** (`ac_track_specific_notes()`)
- `specific_notes` → **trg_specific_notes_updated_at** (`update_specific_notes_updated_at()`)
- `tasks` → **bump_tasks_version** (`bump_row_version()`)
- `tasks` → **trg_tasks_public_id** (`generate_task_public_id()`)
- `tasks` → **trg_tasks_updated_at** (`tasks_update_timestamp()`)
- `tax_configs` → **set_tax_configs_updated_at** (`set_updated_at()`)
- `tax_groups` → **set_tax_groups_updated_at** (`set_updated_at()`)
- `team_availability` → **set_team_availability_updated_at** (`set_updated_at()`)
- `team_availability` → **trg_check_availability_overlap** (`check_availability_overlap()`)
- `team_capabilities` → **set_team_capabilities_updated_at** (`set_updated_at()`)
- `team_date_slots` → **bump_team_date_slots_version** (`bump_row_version()`)
- `team_date_slots` → **trg_team_date_slots_updated** (`set_team_date_slots_updated_at()`)
- `team_members` → **set_team_members_updated_at** (`set_updated_at()`)
- `team_schedule_assignments` → **bump_team_schedule_assignments_version** (`bump_row_version()`)
- `team_schedule_assignments` → **trg_tsa_updated** (`set_team_schedule_updated_at()`)
- `team_schedule_assignments` → **trg_tsa_validate** (`check_team_schedule_assignment()`)
- `teams` → **set_teams_updated_at** (`set_updated_at()`)
- `technician_device_mappings` → **tech_device_map_updated_at** (`set_updated_at()`)
- `time_entries` → **set_time_entries_updated_at** (`set_updated_at()`)
- `time_off_requests` → **trg_tor_updated** (`set_team_schedule_updated_at()`)
- `tracking_live_locations` → **set_tracking_live_updated_at** (`set_updated_at()`)
- `tracking_sessions` → **set_tracking_sessions_updated_at** (`set_updated_at()`)
- `user_agent_preferences` → **set_user_agent_preferences_updated_at** (`set_updated_at()`)
- `webhook_endpoints` → **set_webhook_endpoints_updated_at** (`set_updated_at()`)
- `webhook_events` → **set_webhook_events_updated_at** (`set_updated_at()`)
- `workflows` → **bump_workflows_version** (`bump_row_version()`)
- `workflows` → **trg_workflows_public_id** (`generate_workflow_public_id()`)
- `workflows` → **workflows_updated_at** (`set_updated_at()`)

## 8. Tâches planifiées (10)

- `cleanup_lost_pipeline_deals_daily` — `0 3 * * *` — actif
- `cleanup-expired-pipeline-deals` — `0 * * * *` — actif
- `lume_invariant_checks` — `40 4 * * *` — actif
- `lume_purge_audit_events` — `15 3 * * *` — actif
- `lume_purge_location_data` — `30 4 * * *` — actif
- `lume_purge_oauth_states` — `25 * * * *` — actif
- `lume_release_sms_numbers` — `10 8 * * *` — ⚠️ INACTIF
- `lume_retention_job` — `0 4 * * *` — actif
- `lume_sync_auth_telemetry` — `*/15 * * * *` — actif
- `security-canary-nightly` — `17 4 * * *` — actif
