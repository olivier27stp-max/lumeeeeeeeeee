-- ============================================================================
-- 01_comments — documentation métadonnées (audit DB métadonnées, 2026-08-01)
-- ============================================================================
-- Ajoute COMMENT ON TABLE aux 96 tables non documentées + COMMENT ON COLUMN
-- sur les colonnes PII (inventaire Loi 25) et secrets. NE MODIFIE AUCUNE DONNÉE
-- ni structure — risque nul. Style aligné sur les 124 tables déjà commentées.
-- ============================================================================

-- ===== activity_notes =====
COMMENT ON TABLE public.activity_notes IS '[CRM] Free-text notes/comments attached to any entity (polymorphic entity_type/entity_id) with actor and soft-delete. Tenant-scoped by org_id.';
COMMENT ON COLUMN public.activity_notes.body IS 'PII — free-text note body may contain personal information about clients/contacts.';

-- ===== alert_rules =====
COMMENT ON TABLE public.alert_rules IS '[Automation] Per-org configurable alert rules (thresholds by days/count) that trigger notifications. Tenant-scoped by org_id.';

-- ===== applied_taxes =====
COMMENT ON TABLE public.applied_taxes IS '[Billing] Tax line items applied to a document (invoice/quote via document_type/document_id), snapshotting name/rate/amount at time of issue. Tenant scope inherited via parent document.';

-- ===== automations =====
COMMENT ON TABLE public.automations IS '[Automation] Per-org automation rule definitions (trigger + delay + templated message) that fire follow-up communications. Tenant-scoped by org_id.';

-- ===== billing_profiles =====
COMMENT ON TABLE public.billing_profiles IS '[Billing] Per-org SaaS billing/customer profile (Stripe customer, billing contact and address, tax id, currency). Tenant-scoped by org_id.';
COMMENT ON COLUMN public.billing_profiles.billing_email IS 'PII — billing contact email.';
COMMENT ON COLUMN public.billing_profiles.full_name IS 'PII — billing contact full name.';
COMMENT ON COLUMN public.billing_profiles.phone IS 'PII — billing contact phone number.';
COMMENT ON COLUMN public.billing_profiles.address IS 'PII — billing street address.';
COMMENT ON COLUMN public.billing_profiles.city IS 'PII — billing city.';
COMMENT ON COLUMN public.billing_profiles.postal_code IS 'PII — billing postal code.';

-- ===== billing_receipt_log =====
COMMENT ON TABLE public.billing_receipt_log IS '[Billing] Log of subscription billing/receipt emails sent per org (Stripe intent/session/invoice refs, send status). Tenant-scoped by org_id.';
COMMENT ON COLUMN public.billing_receipt_log.recipient_email IS 'PII — receipt recipient email address.';

-- ===== booking_pages =====
COMMENT ON TABLE public.booking_pages IS '[Scheduling] Per-org public self-service booking page configs (slug, availability rules, duration/buffer). Tenant-scoped by org_id.';

-- ===== bookings =====
COMMENT ON TABLE public.bookings IS '[Scheduling] Customer-submitted appointment bookings from public booking pages, optionally linked to a lead/job. Tenant-scoped by org_id.';
COMMENT ON COLUMN public.bookings.customer_first_name IS 'PII — booking customer first name.';
COMMENT ON COLUMN public.bookings.customer_last_name IS 'PII — booking customer last name.';
COMMENT ON COLUMN public.bookings.customer_email IS 'PII — booking customer email.';
COMMENT ON COLUMN public.bookings.customer_phone IS 'PII — booking customer phone.';
COMMENT ON COLUMN public.bookings.service_address IS 'PII — service location address.';
COMMENT ON COLUMN public.bookings.notes IS 'PII — free-text notes may contain personal information.';

-- ===== checklist_templates =====
COMMENT ON TABLE public.checklist_templates IS '[Jobs] Per-org reusable job checklist templates (items as jsonb) scoped by job_type. Tenant-scoped by org_id.';

-- ===== commission_settings =====
COMMENT ON TABLE public.commission_settings IS '[Payroll] Per-org commission engine settings (reversal policy, default rule). One row per org (PK org_id).';

-- ===== company_operating_profile =====
COMMENT ON TABLE public.company_operating_profile IS '[Scheduling] Per-org operational profile feeding scheduling/route optimization (avg job duration, travel radius, scoring weights, operating days/hours). Tenant-scoped by org_id.';

-- ===== confidence_calibration =====
COMMENT ON TABLE public.confidence_calibration IS '[Agent] Per-org AI agent confidence-calibration statistics by domain (predicted vs actual success, accuracy buckets, calibration factor). Tenant-scoped by org_id.';

-- ===== course_assignments =====
COMMENT ON TABLE public.course_assignments IS '[Training] Assignments of a training course to a user or team (with assigner). Tenant scope inherited via course.org_id.';

-- ===== course_lessons =====
COMMENT ON TABLE public.course_lessons IS '[Training] Lessons within a course module (video/embed/text content, attachments, ordering). Tenant scope inherited via module -> course.org_id.';

-- ===== course_modules =====
COMMENT ON TABLE public.course_modules IS '[Training] Ordered modules grouping lessons within a training course. Tenant scope inherited via course.org_id.';

-- ===== courses =====
COMMENT ON TABLE public.courses IS '[Training] Per-org training/LMS courses (title, cover, status, visibility, target roles/users) with soft-delete. Tenant-scoped by org_id.';

-- ===== dead_letters =====
COMMENT ON TABLE public.dead_letters IS '[System] Global dead-letter queue for failed background jobs/events (source, payload, error, retry attempts). Platform-wide, not org-scoped.';

-- ===== decision_outcomes =====
COMMENT ON TABLE public.decision_outcomes IS '[Agent] Per-org outcome tracking for AI agent decisions (links to decision_log/session/message, outcome + score, revenue/time impact) used for learning. Tenant-scoped by org_id.';

-- ===== demo_requests =====
COMMENT ON TABLE public.demo_requests IS '[Marketing] Public marketing demo/sales-lead requests submitted pre-signup (contact, company, industry, conversion tracking). Platform-wide, not org-scoped.';
COMMENT ON COLUMN public.demo_requests.full_name IS 'PII — requester full name.';
COMMENT ON COLUMN public.demo_requests.email IS 'PII — requester email.';
COMMENT ON COLUMN public.demo_requests.phone IS 'PII — requester phone.';
COMMENT ON COLUMN public.demo_requests.message IS 'PII — free-text message may contain personal information.';
COMMENT ON COLUMN public.demo_requests.notes IS 'PII — internal notes may contain personal information.';
COMMENT ON COLUMN public.demo_requests.ip_address IS 'PII — submitter IP address.';
COMMENT ON COLUMN public.demo_requests.user_agent IS 'PII — submitter browser user-agent string.';

-- ===== email_accounts =====
COMMENT ON TABLE public.email_accounts IS '[Messaging] Connected user email accounts (Gmail/Outlook OAuth) for inbox sync, with encrypted tokens and sync cursors. Tenant-scoped by org_id (per user).';
COMMENT ON COLUMN public.email_accounts.email_address IS 'PII — connected mailbox email address.';
COMMENT ON COLUMN public.email_accounts.encrypted_access_token IS 'Secret — encrypted OAuth access token (not for display/logging).';
COMMENT ON COLUMN public.email_accounts.encrypted_refresh_token IS 'Secret — encrypted OAuth refresh token (not for display/logging).';

-- ===== email_campaign_recipients =====
COMMENT ON TABLE public.email_campaign_recipients IS '[Messaging] Recipients and per-recipient delivery/engagement status (opened/clicked) for an email campaign. Tenant-scoped by org_id.';
COMMENT ON COLUMN public.email_campaign_recipients.email IS 'PII — recipient email address.';

-- ===== email_campaigns =====
COMMENT ON TABLE public.email_campaigns IS '[Messaging] Per-org bulk email marketing campaigns (subject/body, audience segment, aggregate send/open/click stats). Tenant-scoped by org_id.';

-- ===== email_messages =====
COMMENT ON TABLE public.email_messages IS '[Messaging] Individual synced email messages within a thread (from/to, subject, body, direction, attachments). Tenant scope inherited via account/thread.';
COMMENT ON COLUMN public.email_messages.from_name IS 'PII — sender display name.';
COMMENT ON COLUMN public.email_messages.from_email IS 'PII — sender email address.';
COMMENT ON COLUMN public.email_messages.to_emails IS 'PII — recipient email addresses.';
COMMENT ON COLUMN public.email_messages.cc_emails IS 'PII — CC recipient email addresses.';
COMMENT ON COLUMN public.email_messages.body_html IS 'PII — email body (HTML) may contain personal correspondence.';
COMMENT ON COLUMN public.email_messages.body_text IS 'PII — email body (text) may contain personal correspondence.';
COMMENT ON COLUMN public.email_messages.snippet IS 'PII — message preview snippet.';

-- ===== email_oauth_states =====
COMMENT ON TABLE public.email_oauth_states IS '[Security] Short-lived OAuth CSRF/PKCE state records for email-account connection flow (state, code_verifier, expiry). Tenant-scoped by org_id.';

-- ===== email_threads =====
COMMENT ON TABLE public.email_threads IS '[Messaging] Synced email conversation threads per connected account (subject, last-message time, folder, read/attachment flags). Tenant-scoped by org_id.';
COMMENT ON COLUMN public.email_threads.from_name IS 'PII — latest correspondent display name.';
COMMENT ON COLUMN public.email_threads.from_email IS 'PII — latest correspondent email address.';
COMMENT ON COLUMN public.email_threads.snippet IS 'PII — thread preview snippet.';

-- ===== few_shot_examples =====
COMMENT ON TABLE public.few_shot_examples IS '[Agent] Per-org curated few-shot examples (user message + agent response, quality/feedback) for AI agent prompting by domain. Tenant-scoped by org_id.';

-- ===== form_submissions =====
COMMENT ON TABLE public.form_submissions IS '[CRM] Submissions to per-org request/lead forms (contact details, custom responses, assessment scheduling) linked to lead/deal/client. Tenant-scoped by org_id.';
COMMENT ON COLUMN public.form_submissions.first_name IS 'PII — submitter first name.';
COMMENT ON COLUMN public.form_submissions.last_name IS 'PII — submitter last name.';
COMMENT ON COLUMN public.form_submissions.email IS 'PII — submitter email.';
COMMENT ON COLUMN public.form_submissions.phone IS 'PII — submitter phone.';
COMMENT ON COLUMN public.form_submissions.street_address IS 'PII — submitter street address.';
COMMENT ON COLUMN public.form_submissions.unit IS 'PII — submitter address unit.';
COMMENT ON COLUMN public.form_submissions.city IS 'PII — submitter city.';
COMMENT ON COLUMN public.form_submissions.postal_code IS 'PII — submitter postal code.';
COMMENT ON COLUMN public.form_submissions.notes IS 'PII — free-text notes may contain personal information.';
COMMENT ON COLUMN public.form_submissions.ip_address IS 'PII — submitter IP address.';
COMMENT ON COLUMN public.form_submissions.user_agent IS 'PII — submitter browser user-agent string.';

-- ===== fs_badges =====
COMMENT ON TABLE public.fs_badges IS '[Field-sales] Per-org gamification badge definitions (bilingual name/description, icon, award criteria) with soft-delete. Tenant-scoped by org_id.';

-- ===== fs_battles =====
COMMENT ON TABLE public.fs_battles IS '[Field-sales] Head-to-head competitions between reps/teams over a metric and date range (scores, winner, prize). Tenant-scoped by org_id.';

-- ===== fs_challenge_participants =====
COMMENT ON TABLE public.fs_challenge_participants IS '[Field-sales] Participants and their progress (current value, completion) in a field-sales challenge. Tenant scope inherited via challenge.org_id.';

-- ===== fs_challenges =====
COMMENT ON TABLE public.fs_challenges IS '[Field-sales] Per-org gamified sales challenges/goals (bilingual, metric target, date range, prize). Tenant-scoped by org_id.';

-- ===== fs_check_in_records =====
COMMENT ON TABLE public.fs_check_in_records IS '[Field-sales] Geolocated rep check-in/out records during field sessions (type, coordinates, photo). Tenant-scoped by org_id.';
COMMENT ON COLUMN public.fs_check_in_records.lat IS 'PII — GPS latitude of rep check-in.';
COMMENT ON COLUMN public.fs_check_in_records.lng IS 'PII — GPS longitude of rep check-in.';
COMMENT ON COLUMN public.fs_check_in_records.photo_url IS 'PII — check-in photo (may show location/person).';
COMMENT ON COLUMN public.fs_check_in_records.notes IS 'PII — free-text notes may contain personal information.';

-- ===== fs_commission_entries =====
COMMENT ON TABLE public.fs_commission_entries IS '[Field-sales] Commission entries earned per rep (lead/job/invoice attribution, amount, approval/payment lifecycle, reversal). Tenant-scoped by org_id.';

-- ===== fs_commission_rules =====
COMMENT ON TABLE public.fs_commission_rules IS '[Field-sales] Per-org field-sales commission rule definitions (flat/percentage/tiered, base, bonuses, attribution). Tenant-scoped by org_id.';

-- ===== fs_field_sessions =====
COMMENT ON TABLE public.fs_field_sessions IS '[Field-sales] Door-knocking work sessions per rep (territory, status, timing, doors knocked). Tenant-scoped by org_id.';

-- ===== fs_gps_points =====
COMMENT ON TABLE public.fs_gps_points IS '[Field-sales] GPS breadcrumb points recorded during a field-sales session (route tracking). Tenant scope inherited via session (per user).';
COMMENT ON COLUMN public.fs_gps_points.lat IS 'PII — GPS latitude of rep location.';
COMMENT ON COLUMN public.fs_gps_points.lng IS 'PII — GPS longitude of rep location.';
COMMENT ON COLUMN public.fs_gps_points.altitude IS 'PII — GPS altitude of rep location.';
COMMENT ON COLUMN public.fs_gps_points.speed IS 'PII — movement speed derived from rep location.';
COMMENT ON COLUMN public.fs_gps_points.heading IS 'PII — movement heading derived from rep location.';

-- ===== fs_rep_badges =====
COMMENT ON TABLE public.fs_rep_badges IS '[Field-sales] Badges earned by field-sales reps (rep -> badge, earned time, metadata). Tenant-scoped by org_id.';

-- ===== fs_rep_stat_snapshots =====
COMMENT ON TABLE public.fs_rep_stat_snapshots IS '[Field-sales] Periodic aggregated performance snapshots per rep (doors, conversations, demos, closes, revenue, conversion). Tenant-scoped by org_id.';

-- ===== goals =====
COMMENT ON TABLE public.goals IS '[Analytics] Per-org performance goals/targets by metric and period (date range). Tenant-scoped by org_id.';

-- ===== invitations =====
COMMENT ON TABLE public.invitations IS '[Org] Pending team-member invitations per org (email, role, scope, tokenized accept link, status/expiry). Tenant-scoped by org_id.';
COMMENT ON COLUMN public.invitations.email IS 'PII — invitee email address.';
COMMENT ON COLUMN public.invitations.token IS 'Secret — invitation accept token (grants org access).';
COMMENT ON COLUMN public.invitations.token_hash IS 'Secret — hashed invitation token.';

-- ===== invoice_sequences =====
COMMENT ON TABLE public.invoice_sequences IS '[Billing] Per-org invoice-number sequence counter (last_value). One row per org.';

-- ===== job_agreements =====
COMMENT ON TABLE public.job_agreements IS '[Jobs] Per-org job service agreements/contracts with e-signature (terms, tokenized view link, signer, signature, snapshot). Tenant-scoped by org_id.';
COMMENT ON COLUMN public.job_agreements.signer_name IS 'PII — name of the person who signed the agreement.';
COMMENT ON COLUMN public.job_agreements.signature_data IS 'PII — captured e-signature data.';
COMMENT ON COLUMN public.job_agreements.view_token IS 'Secret — token granting external access to view/sign the agreement.';

-- ===== job_billing_milestones =====
COMMENT ON TABLE public.job_billing_milestones IS '[Jobs] Progress-billing milestones for a job (ordered label, percent/amount, due date). Tenant-scoped by org_id.';

-- ===== job_checklists =====
COMMENT ON TABLE public.job_checklists IS '[Jobs] Checklist instances attached to a job (items + responses, optionally from a template, completion). Tenant-scoped by org_id.';

-- ===== job_materials =====
COMMENT ON TABLE public.job_materials IS '[Jobs] Materials/parts consumed on a job (name, quantity, unit cost). Tenant-scoped by org_id.';

-- ===== job_tags =====
COMMENT ON TABLE public.job_tags IS '[Jobs] Per-org job tag definitions (name, color) with soft-delete. Tenant-scoped by org_id.';

-- ===== job_time_logs =====
COMMENT ON TABLE public.job_time_logs IS '[Jobs] Time-tracking entries (start/stop, seconds) logged against a job by a user. Tenant-scoped by org_id.';

-- ===== lead_lists =====
COMMENT ON TABLE public.lead_lists IS '[CRM] Join table linking leads to user-defined lists (lead_id, list_id). Tenant scope inherited via lead/list.';

-- ===== lead_sources =====
COMMENT ON TABLE public.lead_sources IS '[CRM] Per-org lead-source options (how leads were acquired). Tenant-scoped by org_id.';

-- ===== lists =====
COMMENT ON TABLE public.lists IS '[CRM] User-defined lists for grouping leads/records (name, description). Scoped by user_id.';

-- ===== location_tracking_settings =====
COMMENT ON TABLE public.location_tracking_settings IS '[Tracking] Per-org toggle/settings for live field location tracking (enabled flag). One row per org.';

-- ===== mfa_phone =====
COMMENT ON TABLE public.mfa_phone IS '[Security] Per-user MFA phone number registration and verification state. Tenant-scoped by org_id (PK user_id).';
COMMENT ON COLUMN public.mfa_phone.phone IS 'PII — user MFA phone number.';

-- ===== mfa_sms_challenges =====
COMMENT ON TABLE public.mfa_sms_challenges IS '[Security] Ephemeral SMS MFA challenges (hashed code, purpose, attempts, expiry) per user. Short-lived, not org-scoped.';
COMMENT ON COLUMN public.mfa_sms_challenges.phone IS 'PII — phone number the MFA code was sent to.';
COMMENT ON COLUMN public.mfa_sms_challenges.code_hash IS 'Secret — hashed one-time MFA code.';

-- ===== mfa_trusted_devices =====
COMMENT ON TABLE public.mfa_trusted_devices IS '[Security] Remembered/trusted devices that skip MFA per user (hashed device token, label, expiry). Not org-scoped.';
COMMENT ON COLUMN public.mfa_trusted_devices.token_hash IS 'PII/Secret — hashed device identifier token.';
COMMENT ON COLUMN public.mfa_trusted_devices.label IS 'PII — user-provided device label.';

-- ===== org_billing_settings =====
COMMENT ON TABLE public.org_billing_settings IS '[Billing] Per-org settings for billing documents (company name, tax numbers, from email/SMS, address). One row per org.';
COMMENT ON COLUMN public.org_billing_settings.email_from IS 'PII — sender email address used on billing documents.';

-- ===== org_client_counters =====
COMMENT ON TABLE public.org_client_counters IS '[CRM] Per-org sequential client-number counter (last_number). One row per org.';

-- ===== org_invoice_sequences =====
COMMENT ON TABLE public.org_invoice_sequences IS '[Billing] Per-org invoice-number sequence counter (next_number). One row per org.';

-- ===== org_job_counters =====
COMMENT ON TABLE public.org_job_counters IS '[Jobs] Per-org sequential job-number counter (last_number). One row per org.';

-- ===== org_knowledge =====
COMMENT ON TABLE public.org_knowledge IS '[Agent] Per-org knowledge-base facts (category/key/value with importance) feeding the AI agent context. Tenant-scoped by org_id.';

-- ===== payment_requirements =====
COMMENT ON TABLE public.payment_requirements IS '[Payments] Per-org payment requirements/deposits gating an entity (polymorphic entity_type/entity_id, amount, status, due). Tenant-scoped by org_id.';

-- ===== payroll_adjustments =====
COMMENT ON TABLE public.payroll_adjustments IS '[Payroll] Manual payroll adjustments per user and pay period (amount, note) with soft-delete. Tenant-scoped by org_id.';

-- ===== payroll_payments =====
COMMENT ON TABLE public.payroll_payments IS '[Payroll] Recorded payroll payments per user and pay period (hours, gross, commission, adjustments, total). Tenant-scoped by org_id.';

-- ===== payroll_settings =====
COMMENT ON TABLE public.payroll_settings IS '[Payroll] Per-org payroll configuration (pay-period type, anchor date, pay-day offset, timezone). One row per org.';

-- ===== pipelines =====
COMMENT ON TABLE public.pipelines IS '[CRM] Sales pipeline definitions (name). Scoped by user_id.';

-- ===== plans =====
COMMENT ON TABLE public.plans IS '[Billing] Global SaaS subscription plan catalog (bilingual name, USD/CAD pricing, feature flags, limits, Stripe product/price IDs). Platform-wide, not org-scoped.';

-- ===== processed_checkout_sessions =====
COMMENT ON TABLE public.processed_checkout_sessions IS '[Payments] Idempotency log of processed Stripe checkout sessions (session id, status) to prevent double-processing. Tenant-scoped by org_id.';

-- ===== promo_codes =====
COMMENT ON TABLE public.promo_codes IS '[Billing] Global promo/discount codes for subscriptions (type/value, usage limits, validity window). Platform-wide, not org-scoped.';

-- ===== properties =====
COMMENT ON TABLE public.properties IS '[CRM] Client service properties/locations (address, geocoded coordinates, primary flag) with soft-delete. Tenant-scoped by org_id.';
COMMENT ON COLUMN public.properties.address IS 'PII — property street address.';
COMMENT ON COLUMN public.properties.street_number IS 'PII — property street number.';
COMMENT ON COLUMN public.properties.street_name IS 'PII — property street name.';
COMMENT ON COLUMN public.properties.city IS 'PII — property city.';
COMMENT ON COLUMN public.properties.postal_code IS 'PII — property postal code.';
COMMENT ON COLUMN public.properties.latitude IS 'PII — property GPS latitude.';
COMMENT ON COLUMN public.properties.longitude IS 'PII — property GPS longitude.';

-- ===== push_tokens =====
COMMENT ON TABLE public.push_tokens IS '[System] Mobile push-notification device tokens per user/platform. Tenant-scoped by org_id.';
COMMENT ON COLUMN public.push_tokens.token IS 'PII — device push-notification identifier token.';

-- ===== quote_attachments =====
COMMENT ON TABLE public.quote_attachments IS '[Quotes] File attachments on a quote (URL, name, type, uploader, source). Tenant scope inherited via quote.';

-- ===== quote_measurement_camera =====
COMMENT ON TABLE public.quote_measurement_camera IS '[Quotes] Saved map/3D camera state and address for a quote''s measurement tool. Tenant-scoped by org_id.';
COMMENT ON COLUMN public.quote_measurement_camera.address IS 'PII — measured property address.';

-- ===== quote_measurements =====
COMMENT ON TABLE public.quote_measurements IS '[Quotes] Geospatial measurements captured for a quote (type, value, area/perimeter, GeoJSON, screenshot). Tenant-scoped by org_id.';
COMMENT ON COLUMN public.quote_measurements.geojson IS 'PII — GeoJSON geometry of a client property/site.';

-- ===== quote_send_log =====
COMMENT ON TABLE public.quote_send_log IS '[Quotes] Log of quote deliveries (channel, recipient, delivery status, provider message id). Tenant scope inherited via quote.';
COMMENT ON COLUMN public.quote_send_log.recipient IS 'PII — recipient email/phone the quote was sent to.';

-- ===== quote_sequences =====
COMMENT ON TABLE public.quote_sequences IS '[Quotes] Per-org quote-number sequence counter (last_value). One row per org.';

-- ===== quote_status_history =====
COMMENT ON TABLE public.quote_status_history IS '[Quotes] Audit history of quote status transitions (old/new status, who, reason). Tenant scope inherited via quote.';

-- ===== recurring_invoice_schedules =====
COMMENT ON TABLE public.recurring_invoice_schedules IS '[Billing] Per-org recurring invoice schedules (client, template items, frequency, next-run/auto-send). Tenant-scoped by org_id.';

-- ===== recurring_team_schedules =====
COMMENT ON TABLE public.recurring_team_schedules IS '[Scheduling] Recurring team/user work-schedule templates (day-of-week, time window, recurrence rule, effective dates). Tenant-scoped by org_id.';

-- ===== referrals =====
COMMENT ON TABLE public.referrals IS '[Billing] SaaS referral-program records (referrer org/user -> referred email/org/user, reward amount, conversion). Tenant-scoped by referrer_org_id.';
COMMENT ON COLUMN public.referrals.referred_email IS 'PII — email of the referred prospect.';

-- ===== request_forms =====
COMMENT ON TABLE public.request_forms IS '[CRM] Per-org embeddable request/lead form definitions (custom fields, notifications, API key) with soft-delete. Tenant-scoped by org_id.';
COMMENT ON COLUMN public.request_forms.api_key IS 'Secret — public form submission API key.';

-- ===== role_templates =====
COMMENT ON TABLE public.role_templates IS '[Org] Per-org role/permission templates (system + custom, default scope, permissions jsonb). Tenant-scoped by org_id.';

-- ===== scheduled_reports =====
COMMENT ON TABLE public.scheduled_reports IS '[Analytics] Per-org scheduled report email subscriptions (recipient, frequency, day, last sent). Tenant-scoped by org_id.';
COMMENT ON COLUMN public.scheduled_reports.recipient_email IS 'PII — report recipient email address.';

-- ===== service_contracts =====
COMMENT ON TABLE public.service_contracts IS '[Jobs] Per-org recurring service/maintenance contracts tied to a job/client (scheduled visits jsonb, year, status) with soft-delete. Tenant-scoped by org_id.';

-- ===== subscriptions =====
COMMENT ON TABLE public.subscriptions IS '[Billing] Per-org SaaS subscription state (plan, status, billing period, seats/offices, Stripe subscription/customer/payment refs, receipt tracking). Tenant-scoped by org_id.';

-- ===== tax_configs =====
COMMENT ON TABLE public.tax_configs IS '[Billing] Per-org tax rate definitions (name, rate, type, region/country, compound flag, registration number). Tenant-scoped by org_id.';

-- ===== tax_group_items =====
COMMENT ON TABLE public.tax_group_items IS '[Billing] Join of tax_configs into a tax_group with ordering (combined tax composition). Tenant scope inherited via tax_group.';

-- ===== tax_groups =====
COMMENT ON TABLE public.tax_groups IS '[Billing] Per-org tax groups combining multiple tax_configs by region (default flag). Tenant-scoped by org_id.';

-- ===== team_assignments =====
COMMENT ON TABLE public.team_assignments IS '[Org] User-to-team membership assignments (primary flag). Tenant-scoped by org_id.';

-- ===== team_capabilities =====
COMMENT ON TABLE public.team_capabilities IS '[Scheduling] Per-team service capabilities/skills (service_type, skill_tags) used for job matching. Tenant-scoped by org_id.';
COMMENT ON COLUMN public.team_capabilities.notes IS 'PII — free-text notes may contain personal information.';

-- ===== team_schedule_assignments =====
COMMENT ON TABLE public.team_schedule_assignments IS '[Scheduling] Concrete dated team/user schedule and availability entries (work date, time window, status, source). Tenant-scoped by org_id.';

-- ===== team_schedule_audit =====
COMMENT ON TABLE public.team_schedule_audit IS '[Scheduling] Audit log of team-schedule changes (actor, action, target user/date, old/new value). Tenant-scoped by org_id.';

-- ===== time_off_requests =====
COMMENT ON TABLE public.time_off_requests IS '[Scheduling] Team-member time-off/PTO requests (date range, kind, status, approver). Tenant-scoped by org_id.';
COMMENT ON COLUMN public.time_off_requests.reason IS 'PII — time-off reason may contain personal/medical information.';

-- ===== tracking_events =====
COMMENT ON TABLE public.tracking_events IS '[Tracking] Geolocated field-tracking events per user/session (event type, coordinates, details). Tenant-scoped by org_id.';
COMMENT ON COLUMN public.tracking_events.latitude IS 'PII — GPS latitude of tracked user.';
COMMENT ON COLUMN public.tracking_events.longitude IS 'PII — GPS longitude of tracked user.';

-- ===== tracking_live_locations =====
COMMENT ON TABLE public.tracking_live_locations IS '[Tracking] Latest real-time GPS location per user/session (coordinates, heading/speed, moving flag, tracking status). Tenant-scoped by org_id (PK user_id).';
COMMENT ON COLUMN public.tracking_live_locations.latitude IS 'PII — live GPS latitude of tracked user.';
COMMENT ON COLUMN public.tracking_live_locations.longitude IS 'PII — live GPS longitude of tracked user.';
COMMENT ON COLUMN public.tracking_live_locations.heading IS 'PII — live movement heading of tracked user.';
COMMENT ON COLUMN public.tracking_live_locations.speed_mps IS 'PII — live movement speed of tracked user.';

-- ===== user_agent_preferences =====
COMMENT ON TABLE public.user_agent_preferences IS '[Agent] Per-user learned AI-agent interaction preferences and stats (detail level, language, tone, approval rates, domain preferences). Tenant-scoped by org_id.';

-- ===== webhook_deliveries =====
COMMENT ON TABLE public.webhook_deliveries IS '[System] Delivery attempt log for outbound webhooks (endpoint, event, payload, status, retries, response). Tenant-scoped by org_id.';

-- ===== webhook_endpoints =====
COMMENT ON TABLE public.webhook_endpoints IS '[System] Per-org outbound webhook endpoint configs (URL, subscribed events, signing secret, active flag). Tenant-scoped by org_id.';
COMMENT ON COLUMN public.webhook_endpoints.secret IS 'Secret — webhook payload signing secret.';
