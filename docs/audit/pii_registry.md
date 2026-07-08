# Registre PII — Loi 25 (auto-généré 2026-07-08)

52 tables contiennent des renseignements personnels. Ce registre est un **asset de conformité Loi 25** (et un argument de vente). À maintenir à jour, idéalement via `COMMENT ON COLUMN` en base.

## Catégories de PII détectées
- **Identité/contact** : nom, courriel, téléphone, adresse
- **Géolocalisation** : latitude/longitude, adresses de propriétés/jobs
- **Réseau/sécurité** : adresses IP (sessions, logs, tentatives de connexion)
- **Fiscal** : `tax_id` (billing_profiles)

## Tables à PII « client final » (priorité effacement/anonymisation)
Ces tables portent l'identité des clients des pros — cible n°1 du droit à l'effacement :
- `clients` — first_name, last_name, email, phone, address, city, postal_code, billing_address (+ champs consentement : `email_consent_at`, `email_opt_out_at`)
- `contacts` — full_name, email, phone, adresse
- `properties` — address, street, city, postal_code, lat/long
- `jobs` — property_address, address, lat/long
- `bookings` — customer_first_name/last_name/email/phone, service_address
- `form_submissions` — first_name, last_name, email, phone, adresse, ip_address
- `invoices` — client_email_snapshot · `invoice_send_events` — recipient_email/phone
- `quote_views` — ip_address · `demo_requests` — full_name, email, phone, ip_address

## Tables à PII « équipe/utilisateur »
`profiles` (full_name) · `memberships` (full_name) · `team_members` (nom, email, phone, ville) · `billing_profiles` (full_name, email, adresse, phone, **tax_id**) · `mfa_phone`/`mfa_sms_challenges` (phone) · `technician_locations`/`tracking_*` (lat/long).

## Tables techniques à PII réseau (rétention courte recommandée)
`active_sessions`, `login_history`, `failed_login_attempts`, `audit_events`, `consents`, `data_export_log`, `security_events`, `ip_blocklist`, `quote_views` — toutes portent `ip_address`. → politique de purge (ex. 90 jours) à définir.

## Recommandations Loi 25 (structurelles)
1. **Droit à l'effacement** : concevoir `anonymize_client(client_id)` qui remplace nom/email/téléphone/adresse par des valeurs neutres **tout en préservant les données financières** (`invoices`, montants) requises par l'ARQ (rétention fiscale 6-7 ans). Ne PAS hard-delete les factures.
2. **Rétention** : job de purge des tables réseau (IP) après X jours ; anonymisation des clients inactifs après la période de rétention fiscale.
3. **Snapshots** : `invoices.client_email_snapshot` est une bonne pratique (immuabilité) — le garder, mais l'inclure dans l'anonymisation si le client exerce son droit.
4. **Documenter en base** : `COMMENT ON COLUMN clients.email IS 'PII: contact client';` etc. — rend le registre vivant et vérifiable.

## Liste brute (toutes les tables PII)
`a2p_registrations, active_sessions, alert_rules, audit_events, billing_profiles, billing_receipt_log, bookings, clients, communication_channels, communication_settings, company_settings, consents, contacts, conversations, data_export_log, demo_requests, email_campaign_recipients, email_opt_outs, failed_login_attempts, field_house_profiles, form_submissions, geofences, invitations, invoice_send_events, invoice_templates, invoices, ip_blocklist, jobs, login_history, memberships, messages, mfa_phone, mfa_sms_challenges, org_billing_settings, profiles, proof_of_presence, properties, quote_views, quotes, referrals, reminder_settings, request_forms, review_requests, scheduled_reports, security_events, sms_opt_outs, subscriptions, team_members, technician_locations, tracking_events, tracking_live_locations, tracking_points`
