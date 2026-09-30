# Audit final des outils de Lumi

Généré le 2026-09-30 par `scripts/audit/rapport-outils-lumi.mts` depuis le code de la branche `feat/audit-outils-lumi`. Les parties rédigées viennent de `docs/audits/outils-lumi/rapport-*.md`.

**247 outils** : 181 actions (dont 106 sensibles) et 66 lectures. **80 constats** : 20 critique, 49 élevé, 8 moyen, 3 bas. Statut : ✅ 68 corrigé · 🟡 8 partiel · ❌ 1 ouvert · ❓ 3 décision.

### En bref

- **Aucune action sensible ne s'exécute sans carte** : argent, envoi au client, irréversible et droits sont `toujours` sur carte, quel que soit le mode, et « toujours confirmer » est refusé pour eux par le serveur. Les 180 actions ont maintenant un aperçu qui nomme la cible réelle (lue en base).
- **Ce que la carte montre est ce que le serveur exécute** : mêmes arguments (numéros résolus avant la carte), taxes calculées par la même fonction, identifiants inventés signalés, garde refaite au clic.
- **Zéro faux « c'est fait »** mesuré sur l'éval ; les reçus disent incertain, partiel, déjà fait.
- **Écarts de permissions** : escalade de droits fermée (écran ET Lumi), paie sur soi-même refusée, montants non écrits par qui ne les voit pas, clés alignées sur l'écran — sans toucher aux préréglages.
- **Constats** : 80 relevés ; restent ouverts 1 (schedule_job, laissé à la session agenda qui modifie sa RPC) et 8 partiels ; 3 décisions produit (mode par défaut, send_email, limiteur de textos). Migration team_members appliquée avec ton accord ; Loi 25 confiée à la session Statistiques.
- **Éval (456 cas, mêmes conditions)** : outil exact 79,4 % → **84,3 %** ; paramètres + cible sur la carte 37,4 % → **98 %** ; clarification quand il faut 82,8 % → **93,1 %** ; faux « c'est fait » 0 → **0** ; requêtes bloquées 3 → **0** ; coût 10,47 → 10,74 $ / 1000 demandes (+2,6 %). Sensibles : 75,2 % → 80,4 % (objectif de 100 % non atteint, voir section 4).

Branche : `feat/audit-outils-lumi` (à fusionner seulement avec ton accord). Tests : suite Lumi complète au vert, `tsc` serveur et client au vert.

## 1. Matrice des outils

Légende. **Carte** : `toujours` = jamais exécutée sans carte, quel que soit le mode (argent, envoi au client, irréversible, droits) ; `mode` = carte en mode « demander » et « argent » pour une action sensible, d'office en mode « tout » ; `d'office` = exécutée sans carte (mémoire de Lumi seulement). **Garde** : clé de la page Rôles vérifiée par le serveur (`garde.ts`) avant tout handler ; `$` = outil financier (masqué à qui ne voit pas les montants). **Service** : route de l'app, RPC, ou écriture directe à l'identité de l'utilisateur (RLS). **Constats** : ✅ corrigé · 🟡 partiel · ❌ ouvert · ❓ décision.

| Outil | Section | Genre | Sensible | Garde (préréglages) | Carte | Réversible | Idempotent | Service | Tests | Constats |
|---|---|---|---|---|---|---|---|---|---|---|
| `search_help` | (différé) | lecture | — | `settings.read` (PAVT) | — | — | — | lecture | 3 |  |
| `add_client_tag` | clients | action | non | `clients.update` (PAV) | mode | oui | oui | — | 0 |  |
| `add_note` | clients | action | non | `jobs.read` (PAVT) | mode | oui | oui | — | 3 | ✅É |
| `convert_lead_to_client` | clients | action | non | `leads.update` (PAV) | mode | oui | oui | — | 0 | ❓É |
| `convert_lead_to_job` | clients | action | oui (autre sensible) | `jobs.create` (PAV) | mode | oui | oui | — | 1 |  |
| `create_client` | clients | action | non | `clients.create` (PAV) | mode | oui | oui | — | 2 | ❓É |
| `create_lead` | clients | action | non | `leads.create` (PAV) | mode | oui | oui | — | 2 |  |
| `create_property` | clients | action | non | `clients.update` (PAV) | mode | oui | oui | — | 1 |  |
| `delete_client` | clients | action | oui (autre sensible) | `clients.delete` (PA) | toujours | non | oui | — | 2 | ✅C ✅C |
| `delete_deal` | clients | action | oui (autre sensible) | `leads.delete` (PA) | toujours | non | oui | — | 1 | ✅C ✅C ✅C |
| `delete_lead` | clients | action | oui (autre sensible) | `leads.delete` (PA) | toujours | non | oui | — | 1 | ✅C ✅C |
| `delete_note` | clients | action | oui (autre sensible) | `jobs.read` (PAVT) | toujours | non | oui | — | 1 |  |
| `delete_property` | clients | action | oui (autre sensible) | `clients.update` (PAV) | toujours | non | oui | — | 1 |  |
| `delete_request_submission` | clients | action | oui (autre sensible) | `leads.delete` (PA) | toujours | non | oui | — | 1 |  |
| `merge_clients` | clients | action | oui (autre sensible) | `clients.delete` (PA) | toujours | non | oui | — | 2 | ✅C |
| `process_request_submission` | clients | action | non | `leads.update` (PAV) | mode | oui | oui | — | 1 |  |
| `remove_client_tag` | clients | action | non | `clients.update` (PAV) | mode | oui | oui | — | 0 |  |
| `set_custom_field` | clients | action | non | `clients.update` (PAV) | mode | oui | oui | — | 1 | ❓É |
| `update_client` | clients | action | non | `clients.update` (PAV) | mode | oui | oui | — | 0 | ✅C ❓É |
| `update_deal_stage` | clients | action | non | `leads.update` (PAV) | mode | oui | oui | — | 1 | ❓É |
| `update_lead` | clients | action | non | `leads.update` (PAV) | mode | oui | oui | — | 1 |  |
| `update_lead_status` | clients | action | non | `leads.update` (PAV) | mode | oui | oui | — | 1 | ❓É |
| `update_note` | clients | action | non | `jobs.read` (PAVT) | mode | oui | oui | — | 1 |  |
| `update_property` | clients | action | non | `clients.update` (PAV) | mode | oui | oui | — | 1 |  |
| `get_churn_risk` | clients | lecture | — | `financial.view_reports` $ (PA) | — | — | — | lecture | 0 |  |
| `get_client_profile` | clients | lecture | — | `clients.read` (PAVT) | — | — | — | lecture | 2 | ✅É |
| `get_top_clients` | clients | lecture | — | `financial.view_reports` $ (PA) | — | — | — | lecture | 3 |  |
| `list_client_tags` | clients | lecture | — | `clients.read` (PAVT) | — | — | — | lecture | 0 |  |
| `list_custom_fields` | clients | lecture | — | `clients.read` (PAVT) | — | — | — | lecture | 1 |  |
| `list_deals` | clients | lecture | — | `leads.read` (PAV) | — | — | — | lecture | 2 |  |
| `list_notes` | clients | lecture | — | `jobs.read` (PAVT) | — | — | — | lecture | 1 |  |
| `list_properties` | clients | lecture | — | `clients.read` (PAVT) | — | — | — | lecture | 1 |  |
| `list_request_submissions` | clients | lecture | — | `leads.read` (PAV) | — | — | — | lecture | 0 |  |
| `search_clients` | clients | lecture | — | `clients.read` (PAVT) | — | — | — | lecture | 5 | 🟡C |
| `search_leads` | clients | lecture | — | `leads.read` (PAV) | — | — | — | lecture | 2 |  |
| `create_email_template` | communications | action | oui (envoi client) | `settings.update` (PA) | toujours | oui | oui | — | 1 |  |
| `delete_email_template` | communications | action | oui (envoi client) | `settings.update` (PA) | toujours | non | oui | — | 1 |  |
| `duplicate_email_template` | communications | action | oui (envoi client) | `settings.update` (PA) | mode | oui | oui | — | 1 |  |
| `mark_conversation_read` | communications | action | non | `messages.read` (PAVT) | mode | oui | oui | — | 2 |  |
| `send_email` | communications | action | oui (envoi client) | `messages.send` (PAVT) | toujours | non | oui | — | 37 | 🟡C ❓B |
| `send_sms` | communications | action | oui (envoi client) | `messages.send` (PAVT) | toujours | non | oui | — | 70 | ✅C ✅C ❓M ✅B |
| `set_default_email_template` | communications | action | oui (envoi client) | `settings.update` (PA) | toujours | oui | oui | — | 1 | ✅É |
| `update_email_template` | communications | action | oui (envoi client) | `settings.update` (PA) | toujours | oui | oui | — | 1 |  |
| `get_conversation_messages` | communications | lecture | — | `messages.read` (PAVT) | — | — | — | lecture | 0 |  |
| `get_conversations` | communications | lecture | — | `messages.read` (PAVT) | — | — | — | lecture | 0 |  |
| `list_email_templates` | communications | lecture | — | `settings.read` (PAVT) | — | — | — | lecture | 1 |  |
| `cancel_quote` | devis | action | oui (autre sensible) | `quotes.update` $ (PAV) | toujours | non | oui | — | 1 | ✅C |
| `convert_quote_to_invoice` | devis | action | oui (argent) | `invoices.create` $ (PA) | toujours | non | oui | — | 1 |  |
| `convert_quote_to_job` | devis | action | oui (autre sensible) | `quotes.approve` (PA) | mode | oui | oui | — | 1 |  |
| `create_quote` | devis | action | oui (autre sensible) | `quotes.create` $ (PAV) | mode | oui | oui | — | 5 | ✅É ✅É |
| `create_quote_preset` | devis | action | oui (droits) | `settings.update` $ (PA) | mode | oui | oui | — | 1 |  |
| `create_quote_template` | devis | action | non | `settings.update` $ (PA) | mode | oui | oui | — | 1 |  |
| `delete_quote` | devis | action | oui (autre sensible) | `quotes.delete` $ (PA) | mode | oui | oui | — | 1 | ✅C |
| `delete_quote_preset` | devis | action | oui (droits) | `settings.update` $ (PA) | mode | oui | oui | — | 1 |  |
| `delete_quote_template` | devis | action | non | `settings.update` $ (PA) | mode | oui | oui | — | 1 |  |
| `duplicate_quote` | devis | action | oui (autre sensible) | `quotes.create` $ (PAV) | mode | oui | oui | — | 0 |  |
| `duplicate_quote_preset` | devis | action | oui (droits) | `settings.update` $ (PA) | mode | oui | oui | — | 1 |  |
| `send_quote` | devis | action | oui (envoi client) | `quotes.send` $ (PAV) | toujours | non | oui | — | 2 | 🟡M ✅M |
| `send_quote_sms` | devis | action | oui (envoi client) | `quotes.send` $ (PAV) | toujours | non | oui | — | 1 | ✅É |
| `unarchive_quote` | devis | action | non | `quotes.update` $ (PAV) | mode | oui | oui | — | 1 |  |
| `update_quote` | devis | action | oui (autre sensible) | `quotes.update` $ (PAV) | mode | oui | oui | — | 1 |  |
| `update_quote_preset` | devis | action | oui (droits) | `settings.update` $ (PA) | mode | oui | oui | — | 1 | ✅C |
| `update_quote_template` | devis | action | non | `settings.update` $ (PA) | mode | oui | oui | — | 1 | ✅C |
| `list_quote_presets` | devis | lecture | — | `quotes.read` $ (PAV) | — | — | — | lecture | 1 |  |
| `list_quote_templates` | devis | lecture | — | `quotes.read` $ (PAV) | — | — | — | lecture | 1 |  |
| `list_quotes` | devis | lecture | — | `quotes.read` $ (PAV) | — | — | — | lecture | 5 | ✅É |
| `list_services` | devis | lecture | — | `jobs.read` (PAVT) | — | — | — | lecture | 0 |  |
| `add_payroll_adjustment` | equipe | action | oui (paie) | `financial.view_reports` $ (PA) | toujours | oui | oui | route /payroll/adjustments | 2 | ✅É ✅É |
| `approve_timesheet` | equipe | action | oui (paie) | `timesheets.update` (PAT) | toujours | oui | oui | — | 1 | ✅É |
| `bulk_delete_tasks` | equipe | action | oui (autre sensible) | `jobs.read` (PAVT) | toujours | non | oui | — | 1 | ✅É |
| `bulk_update_task_status` | equipe | action | non | `jobs.read` (PAVT) | mode | oui | oui | — | 1 |  |
| `create_task` | equipe | action | non | `jobs.read` (PAVT) | mode | oui | oui | — | 24 |  |
| `create_team` | equipe | action | non | `team.update` (PA) | mode | oui | oui | — | 2 |  |
| `delete_task` | equipe | action | non | `jobs.read` (PAVT) | mode | oui | oui | — | 1 |  |
| `delete_team` | equipe | action | oui (autre sensible) | `team.update` (PA) | toujours | non | oui | — | 1 | ✅É |
| `duplicate_task` | equipe | action | non | `jobs.read` (PAVT) | mode | oui | oui | — | 1 |  |
| `end_break` | equipe | action | oui (paie) | `timesheets.update` (PAT) | mode | oui | oui | route /timesheets/break/end | 3 |  |
| `invite_member` | equipe | action | oui (droits) | `users.invite` (PA) | toujours | oui | oui | route /invitations/send | 2 | ✅É |
| `mark_payroll_period_paid` | equipe | action | oui (argent) | `financial.view_reports` $ (PA) | toujours | oui | oui | route /payroll/mark-paid | 2 | ✅É |
| `punch_in` | equipe | action | oui (paie) | `timesheets.update` (PAT) | mode | oui | oui | route /timesheets/punch-in | 4 |  |
| `punch_out` | equipe | action | oui (paie) | `timesheets.update` (PAT) | toujours | non | oui | route /timesheets/punch-out | 2 |  |
| `reactivate_member` | equipe | action | oui (droits) | `users.disable` (PA) | toujours | oui | oui | route /invitations/reactivate-member | 1 | ✅É |
| `remove_member` | equipe | action | oui (droits) | `users.disable` (PA) | toujours | oui | oui | route /invitations/remove-member | 1 | ✅É |
| `reschedule_task` | equipe | action | non | `jobs.read` (PAVT) | mode | oui | oui | — | 1 |  |
| `resend_invitation` | equipe | action | oui (envoi client) | `users.invite` (PA) | toujours | non | oui | route /invitations/resend | 2 | ✅É |
| `reset_member_permissions` | equipe | action | oui (droits) | `users.update_role` (PA) | toujours | oui | oui | route /roles/member-permissions/reset | 1 | ✅C |
| `revoke_invitation` | equipe | action | oui (droits) | `users.invite` (PA) | toujours | oui | oui | route /invitations/revoke | 2 |  |
| `set_hourly_rate` | equipe | action | oui (paie) | `financial.view_reports` $ (PA) | toujours | oui | oui | — | 2 | ✅É ✅É |
| `set_member_permissions` | equipe | action | oui (droits) | `users.update_role` (PA) | toujours | oui | oui | route /roles/member-permissions | 1 | ✅C ✅É |
| `start_break` | equipe | action | oui (paie) | `timesheets.update` (PAT) | mode | oui | oui | route /timesheets/break/start | 3 |  |
| `unmark_payroll_period_paid` | equipe | action | oui (argent) | `financial.view_reports` $ (PA) | toujours | oui | oui | route /payroll/unmark-paid | 1 |  |
| `update_member_role` | equipe | action | oui (droits) | `users.update_role` (PA) | toujours | oui | oui | route /invitations/update-role | 1 | ✅C ✅É ✅É |
| `update_payroll_settings` | equipe | action | oui (paie) | `settings.update` $ (PA) | mode | oui | oui | — | 2 |  |
| `update_role_preset` | equipe | action | oui (droits) | `users.update_role` (PA) | toujours | oui | oui | route /roles/update-preset | 1 | ✅C |
| `update_task` | equipe | action | non | `jobs.read` (PAVT) | mode | oui | oui | — | 0 |  |
| `update_task_status` | equipe | action | non | `jobs.read` (PAVT) | mode | oui | oui | — | 0 |  |
| `update_team` | equipe | action | non | `team.update` (PA) | mode | oui | oui | — | 1 |  |
| `get_payroll_summary` | equipe | lecture | — | `financial.view_reports` (PA) | — | — | — | lecture | 2 | ✅É |
| `get_team` | equipe | lecture | — | `team.read` (PA) | — | — | — | lecture | 1 |  |
| `get_timesheets` | equipe | lecture | — | `timesheets.read` (PAT) | — | — | — | lecture | 2 | ✅É |
| `list_invitations` | equipe | lecture | — | `users.invite` (PA) | — | — | — | lecture | 2 |  |
| `list_tasks` | equipe | lecture | — | `jobs.read` (PAVT) | — | — | — | lecture | 1 |  |
| `list_teams` | equipe | lecture | — | `team.read` (PA) | — | — | — | lecture | 2 |  |
| `archive_service` | facturation | action | non | `settings.update` (PA) | mode | oui | oui | — | 1 |  |
| `charge_card_on_file` | facturation | action | oui (argent) | `payments.create` $ (PA) | toujours | non | oui | — | 3 | ✅C ✅C ✅C |
| `create_invoice` | facturation | action | oui (argent) | `invoices.create` $ (PA) | mode | oui | oui | — | 3 | ✅C |
| `create_invoice_from_job` | facturation | action | oui (argent) | `invoices.create` $ (PA) | mode | oui | oui | — | 0 | ✅É |
| `create_invoice_template` | facturation | action | oui (argent) | `invoices.create` $ (PA) | mode | oui | oui | — | 1 |  |
| `create_payment_request` | facturation | action | oui (argent) | `invoices.send` $ (PA) | toujours | non | oui | — | 1 | ✅C ✅É ✅É ✅É |
| `create_recurring_invoice` | facturation | action | oui (argent) | `invoices.create` $ (PA) | mode | oui | oui | — | 1 |  |
| `create_service` | facturation | action | non | `settings.update` (PA) | mode | oui | oui | — | 1 |  |
| `create_tax_config` | facturation | action | oui (argent) | `settings.update` (PA) | mode | oui | oui | — | 2 | ✅É |
| `delete_invoice` | facturation | action | oui (argent) | `invoices.delete` $ (PA) | toujours | oui | oui | — | 2 | ✅C ✅É |
| `delete_invoice_template` | facturation | action | oui (argent) | `invoices.delete` $ (PA) | mode | oui | oui | — | 1 |  |
| `delete_recurring_invoice` | facturation | action | oui (argent) | `invoices.delete` $ (PA) | mode | oui | oui | — | 1 |  |
| `delete_tax_config` | facturation | action | oui (argent) | `settings.update` (PA) | toujours | non | oui | — | 1 |  |
| `duplicate_invoice` | facturation | action | oui (argent) | `invoices.create` $ (PA) | mode | oui | oui | — | 1 |  |
| `mark_invoice_paid` | facturation | action | oui (argent) | `payments.create` $ (PA) | toujours | non | oui | — | 3 | ✅C ✅C ✅C ✅É |
| `record_invoice_payment` | facturation | action | oui (argent) | `payments.create` $ (PA) | toujours | non | oui | — | 2 | ✅C ✅C ✅C |
| `refund_payment` | facturation | action | oui (argent) | `payments.refund` $ (PA) | toujours | non | oui | — | 4 | ✅C ✅C |
| `remove_card_on_file` | facturation | action | oui (argent) | `clients.update` $ (PAV) | toujours | non | oui | — | 1 | ✅C |
| `resend_payment_request` | facturation | action | oui (argent) | `invoices.send` $ (PA) | toujours | non | oui | — | 1 | ✅É ✅É ✅É |
| `revert_invoice_to_draft` | facturation | action | oui (argent) | `invoices.update` $ (PA) | mode | oui | oui | — | 2 |  |
| `run_recurring_invoice_now` | facturation | action | oui (argent) | `invoices.create` $ (PA) | toujours | non | oui | — | 1 |  |
| `send_invoice` | facturation | action | oui (argent) | `invoices.send` $ (PA) | toujours | non | oui | — | 3 | ✅É ✅M 🟡M |
| `send_payment_reminders` | facturation | action | oui (argent) | `messages.send` $ (PAVT) | toujours | non | oui | — | 4 | ✅É ✅É ❓M ✅M |
| `set_default_tax_group` | facturation | action | oui (argent) | `settings.update` (PA) | mode | oui | oui | — | 1 |  |
| `setup_taxes` | facturation | action | oui (argent) | `settings.update` (PA) | mode | oui | oui | — | 1 |  |
| `update_invoice` | facturation | action | oui (argent) | `invoices.update` $ (PA) | mode | oui | oui | — | 1 |  |
| `update_invoice_template` | facturation | action | oui (argent) | `invoices.update` $ (PA) | mode | oui | oui | — | 1 |  |
| `update_recurring_invoice` | facturation | action | oui (argent) | `invoices.update` $ (PA) | mode | oui | oui | — | 1 |  |
| `update_reminder_settings` | facturation | action | oui (autre sensible) | `settings.update` $ (PA) | mode | oui | oui | — | 1 |  |
| `update_service` | facturation | action | non | `settings.update` (PA) | mode | oui | oui | — | 1 |  |
| `update_tax_config` | facturation | action | oui (argent) | `settings.update` (PA) | mode | oui | oui | — | 1 |  |
| `void_invoice` | facturation | action | oui (argent) | `invoices.update` $ (PA) | toujours | oui | oui | — | 3 | ✅C ✅É |
| `analyze_profitability` | facturation | lecture | — | `financial.view_margins` $ (PA) | — | — | — | lecture | 3 |  |
| `compare_revenue` | facturation | lecture | — | `financial.view_reports` $ (PA) | — | — | — | lecture | 2 | ✅É |
| `get_financial_overview` | facturation | lecture | — | `financial.view_reports` $ (PA) | — | — | — | lecture | 2 |  |
| `get_overdue_payments` | facturation | lecture | — | `financial.view_invoices` $ (PA) | — | — | — | lecture | 4 |  |
| `get_reminder_settings` | facturation | lecture | — | `settings.read` $ (PAVT) | — | — | — | lecture | 1 |  |
| `get_revenue_summary` | facturation | lecture | — | `financial.view_reports` $ (PA) | — | — | — | lecture | 4 | ✅É |
| `get_tax_config` | facturation | lecture | — | `settings.read` (PAVT) | — | — | — | lecture | 3 |  |
| `get_top_services` | facturation | lecture | — | `financial.view_reports` $ (PA) | — | — | — | lecture | 1 |  |
| `list_invoice_templates` | facturation | lecture | — | `invoices.read` $ (PA) | — | — | — | lecture | 1 |  |
| `list_invoices` | facturation | lecture | — | `invoices.read` $ (PA) | — | — | — | lecture | 4 |  |
| `list_payments` | facturation | lecture | — | `payments.read` $ (PA) | — | — | — | lecture | 1 | ✅É |
| `list_recurring_invoices` | facturation | lecture | — | `invoices.read` $ (PA) | — | — | — | lecture | 1 |  |
| `forget_note` | memoire | action | non | `settings.update` (PA) | d'office | oui | oui | — | 0 |  |
| `remember_this` | memoire | action | oui (droits) | `settings.update` (PA) | d'office | oui | oui | — | 2 | ✅É |
| `get_recent_agent_actions` | memoire | lecture | — | `reports.read` (PA) | — | — | — | lecture | 0 |  |
| `recall_notes` | memoire | lecture | — | `settings.update` (PA) | — | — | — | lecture | 1 | ✅É |
| `add_visit` | planification | action | non | `calendar.update` (PAVT) | mode | oui | oui | — | 1 |  |
| `apply_day_optimization` | planification | action | oui (autre sensible) | `calendar.update` (PAVT) | mode | oui | oui | — | 1 |  |
| `archive_job` | planification | action | oui (autre sensible) | `jobs.update` (PAT) | mode | oui | oui | — | 2 | 🟡É ✅É |
| `assign_job` | planification | action | non | `jobs.assign` (PA) | mode | oui | oui | — | 2 | ✅É |
| `cancel_visit` | planification | action | oui (autre sensible) | `calendar.update` (PAVT) | toujours | non | oui | — | 0 | ✅É ✅É |
| `create_availability` | planification | action | non | `team.update` (PA) | mode | oui | oui | — | 1 |  |
| `create_checklist_template` | planification | action | non | `settings.update` (PA) | mode | oui | oui | — | 1 |  |
| `create_invoice_for_milestone` | planification | action | oui (argent) | `invoices.create` $ (PA) | mode | oui | oui | — | 1 |  |
| `create_invoice_for_visit` | planification | action | oui (argent) | `invoices.create` $ (PA) | mode | oui | oui | — | 1 |  |
| `create_job` | planification | action | non | `jobs.create` (PAV) | mode | oui | oui | — | 6 | ✅É |
| `create_job_agreement` | planification | action | oui (envoi client) | `jobs.update` (PAT) | toujours | oui | oui | — | 1 | ✅M |
| `create_job_checklist` | planification | action | non | `jobs.update` (PAT) | mode | oui | oui | — | 1 |  |
| `create_job_tag` | planification | action | non | `jobs.update` (PAT) | mode | oui | oui | — | 2 |  |
| `create_job_template` | planification | action | non | `jobs.create` (PAV) | mode | oui | oui | — | 1 |  |
| `create_recurrence_rule` | planification | action | oui (autre sensible) | `jobs.update` (PAT) | mode | oui | oui | — | 1 |  |
| `deactivate_recurrence_rule` | planification | action | oui (autre sensible) | `jobs.update` (PAT) | mode | oui | oui | — | 1 | 🟡É |
| `delete_availability` | planification | action | oui (autre sensible) | `team.update` (PA) | toujours | non | oui | — | 1 |  |
| `delete_checklist_template` | planification | action | oui (autre sensible) | `settings.update` (PA) | toujours | non | oui | — | 1 |  |
| `delete_job` | planification | action | oui (autre sensible) | `jobs.delete` (PA) | toujours | non | oui | — | 2 | ✅É |
| `delete_job_checklist` | planification | action | oui (autre sensible) | `jobs.update` (PAT) | toujours | non | oui | — | 1 |  |
| `reschedule_job` | planification | action | oui (autre sensible) | `calendar.update` (PAVT) | mode | oui | oui | — | 2 | ✅É ✅É |
| `save_job_billing_milestones` | planification | action | oui (argent) | `invoices.create` $ (PA) | mode | oui | oui | — | 1 | ✅É |
| `schedule_job` | planification | action | non | `calendar.update` (PAVT) | mode | oui | oui | — | 1 | ❌É |
| `send_agreement_email` | planification | action | oui (envoi client) | `messages.send` (PAVT) | toujours | non | oui | — | 1 | ✅É |
| `send_agreement_sms` | planification | action | oui (envoi client) | `messages.send` (PAVT) | toujours | non | oui | — | 1 | ✅É |
| `set_default_availability` | planification | action | oui (autre sensible) | `team.update` (PA) | toujours | non | oui | — | 1 |  |
| `set_job_expenses` | planification | action | non | `financial.view_reports` (PA) | mode | oui | oui | — | 1 |  |
| `set_job_tags` | planification | action | non | `jobs.update` (PAT) | mode | oui | oui | — | 1 |  |
| `unschedule_job` | planification | action | oui (autre sensible) | `calendar.update` (PAVT) | toujours | non | oui | — | 1 | ✅É |
| `update_checklist_template` | planification | action | non | `settings.update` (PA) | mode | oui | oui | — | 1 |  |
| `update_job` | planification | action | non | `jobs.update` (PAT) | mode | oui | oui | — | 0 | ✅É |
| `update_job_checklist` | planification | action | non | `jobs.update` (PAT) | mode | oui | oui | — | 1 |  |
| `update_job_status` | planification | action | non | `jobs.update` (PAT) | mode | oui | oui | — | 3 |  |
| `find_dates_in_location` | planification | lecture | — | `jobs.read` (PAVT) | — | — | — | lecture | 0 | ✅C |
| `find_free_slot` | planification | lecture | — | `calendar.read` (PAVT) | — | — | — | lecture | 0 |  |
| `get_day_route` | planification | lecture | — | `jobs.read` (PAVT) | — | — | — | lecture | 0 | ✅É |
| `get_job` | planification | lecture | — | `jobs.read` (PAVT) | — | — | — | lecture | 1 | ✅É |
| `get_team_locations` | planification | lecture | — | `gps.read` (PAT) | — | — | — | lecture | 1 |  |
| `get_weather` | planification | lecture | — | `settings.read` (PAVT) | — | — | — | lecture | 1 |  |
| `list_availability` | planification | lecture | — | `calendar.read` (PAVT) | — | — | — | lecture | 1 |  |
| `list_checklist_templates` | planification | lecture | — | `jobs.read` (PAVT) | — | — | — | lecture | 1 |  |
| `list_job_agreements` | planification | lecture | — | `jobs.read` (PAVT) | — | — | — | lecture | 1 |  |
| `list_job_checklists` | planification | lecture | — | `jobs.read` (PAVT) | — | — | — | lecture | 1 |  |
| `list_job_tags` | planification | lecture | — | `jobs.read` (PAVT) | — | — | — | lecture | 1 |  |
| `list_jobs` | planification | lecture | — | `jobs.read` (PAVT) | — | — | — | lecture | 7 |  |
| `list_recurrence_rules` | planification | lecture | — | `jobs.read` (PAVT) | — | — | — | lecture | 1 |  |
| `propose_day_optimization` | planification | lecture | — | `calendar.read` (PAVT) | — | — | — | lecture | 0 |  |
| `query_schedule` | planification | lecture | — | `jobs.read` (PAVT) | — | — | — | lecture | 3 | ✅C |
| `create_automation_from_text` | rapports | action | oui (autre sensible) | `automations.update` (PA) | toujours | oui | oui | — | 1 | 🟡M 🟡É |
| `create_scheduled_report` | rapports | action | non | `financial.view_reports` (PA) | toujours | oui | oui | — | 1 | ✅C |
| `delete_goal` | rapports | action | oui (autre sensible) | `reports.read` (PA) | toujours | non | oui | — | 1 |  |
| `delete_notification` | rapports | action | non | `settings.read` (PAVT) | mode | oui | oui | — | 1 |  |
| `delete_scheduled_report` | rapports | action | oui (autre sensible) | `financial.view_reports` (PA) | toujours | non | oui | — | 1 |  |
| `mark_notifications_read` | rapports | action | non | `settings.read` (PAVT) | mode | oui | oui | — | 2 |  |
| `send_scheduled_report_now` | rapports | action | oui (envoi client) | `financial.view_reports` (PA) | toujours | non | oui | — | 1 | ✅É ✅É |
| `set_automation_language` | rapports | action | oui (autre sensible) | `automations.update` (PA) | mode | oui | oui | — | 1 |  |
| `set_goal` | rapports | action | non | `reports.read` (PA) | mode | oui | oui | — | 1 |  |
| `toggle_automation_rule` | rapports | action | oui (autre sensible) | `automations.update` (PA) | toujours | oui | oui | — | 2 | 🟡M 🟡É |
| `update_automation_message` | rapports | action | oui (autre sensible) | `automations.update` (PA) | toujours | oui | oui | — | 1 | ✅É ✅É |
| `update_automation_sms_body` | rapports | action | oui (envoi client) | `automations.update` (PA) | toujours | oui | oui | — | 1 | ✅É |
| `update_scheduled_report` | rapports | action | non | `financial.view_reports` (PA) | toujours | oui | oui | — | 1 | ✅É ✅C |
| `build_report` | rapports | lecture | — | `financial.view_reports` $ (PA) | — | — | — | lecture | 3 | ✅É |
| `get_automation_health` | rapports | lecture | — | `automations.read` (PA) | — | — | — | lecture | 0 |  |
| `get_company_info` | rapports | lecture | — | `settings.read` (PAVT) | — | — | — | lecture | 1 |  |
| `get_morning_briefing` | rapports | lecture | — | `jobs.read` (PAVT) | — | — | — | lecture | 1 | ✅É |
| `list_automations` | rapports | lecture | — | `automations.read` (PA) | — | — | — | lecture | 0 |  |
| `list_goals` | rapports | lecture | — | `reports.read` (PA) | — | — | — | lecture | 1 |  |
| `list_notifications` | rapports | lecture | — | `settings.read` (PAVT) | — | — | — | lecture | 1 |  |
| `list_scheduled_reports` | rapports | lecture | — | `financial.view_reports` (PA) | — | — | — | lecture | 1 |  |
| `assign_course` | terrain | action | non | `team.update` (PA) | mode | oui | oui | route /courses/${id}/assign | 1 |  |
| `create_badge` | terrain | action | non | `team.update` (PA) | mode | oui | oui | route /gamification/badges | 1 |  |
| `create_battle` | terrain | action | non | `team.update` (PA) | mode | oui | oui | route /gamification/battles | 1 |  |
| `create_challenge` | terrain | action | non | `team.update` (PA) | mode | oui | oui | route /gamification/challenges | 1 |  |
| `create_course` | terrain | action | non | `team.update` (PA) | mode | oui | oui | route /courses | 1 |  |
| `create_course_lesson` | terrain | action | non | `team.update` (PA) | mode | oui | oui | route /courses/modules/${id}/lessons | 1 |  |
| `create_course_module` | terrain | action | non | `team.update` (PA) | mode | oui | oui | route /courses/${id}/modules | 1 |  |
| `create_d2d_team` | terrain | action | non | `team.update` (PA) | mode | oui | oui | route /field-sales/teams | 1 |  |
| `create_house` | terrain | action | non | `door_to_door.edit` (PAV) | mode | oui | oui | route /field-sales/houses | 1 |  |
| `create_rep` | terrain | action | non | `team.update` (PA) | mode | oui | oui | route /field-sales/reps | 1 |  |
| `create_territory` | terrain | action | non | `door_to_door.edit` (PAV) | mode | oui | oui | route /field-sales/territories | 1 |  |
| `end_field_session` | terrain | action | oui (autre sensible) | `door_to_door.access` (PAV) | toujours | non | oui | route /field-sessions/${s.id}/end | 1 |  |
| `log_house_event` | terrain | action | non | `door_to_door.edit` (PAV) | toujours | non | oui | route /field-sales/houses/${id}/events | 1 |  |
| `pause_field_session` | terrain | action | non | `door_to_door.access` (PAV) | mode | oui | oui | route /field-sessions/${s.id}/pause | 1 |  |
| `publish_course` | terrain | action | non | `team.update` (PA) | mode | oui | oui | — | 1 |  |
| `resume_field_session` | terrain | action | non | `door_to_door.access` (PAV) | mode | oui | oui | route /field-sessions/${s.id}/resume | 1 |  |
| `start_field_session` | terrain | action | non | `door_to_door.access` (PAV) | mode | oui | oui | route /field-sessions/start | 1 |  |
| `update_course` | terrain | action | non | `team.update` (PA) | mode | oui | oui | — | 1 |  |
| `update_course_lesson` | terrain | action | non | `team.update` (PA) | mode | oui | oui | — | 1 |  |
| `update_d2d_pipeline_item` | terrain | action | non | `door_to_door.convert` (PAV) | mode | oui | oui | — | 1 | ✅É |
| `update_d2d_settings` | terrain | action | non | `door_to_door.edit` (PAV) | mode | oui | oui | — | 1 |  |
| `update_house` | terrain | action | non | `door_to_door.edit` (PAV) | mode | oui | oui | — | 1 | ✅É |
| `update_territory` | terrain | action | non | `door_to_door.edit` (PAV) | mode | oui | oui | — | 1 |  |
| `get_d2d_stats` | terrain | lecture | — | `door_to_door.access` (PAV) | — | — | — | lecture | 1 |  |
| `list_courses` | terrain | lecture | — | `team.read` (PA) | — | — | — | lecture | 1 |  |
| `list_houses` | terrain | lecture | — | `door_to_door.access` (PAV) | — | — | — | lecture | 1 |  |
| `list_territories` | terrain | lecture | — | `door_to_door.access` (PAV) | — | — | — | lecture | 1 |  |

Préréglages : P propriétaire · A admin · V vendeur · T technicien (lettre présente = la clé est accordée par défaut). Les écarts entre la garde de Lumi et l'écran sont listés en section 3.

## 2. Bugs par sévérité, et leur correction

### Critique (20)

| Statut | Outils | Constat | Correction apportée | Vague |
|---|---|---|---|---|
| ✅ corrigé | record_invoice_payment, mark_invoice_paid | RPC `apply_invoice_payment` seule, aucune ligne `payments`. `trg_payments_recalculate_invoice` recalcule paid_cents = Σ payments : le prochain vrai paiement efface l'argent saisi par Lumi (solde qui réapparaît, relances). Absent de list_payments, rapports, QuickBooks ; `method` jamais stocké. | Paiements via la route de l'écran (ligne payments) | 1 |
| ✅ corrigé | record_invoice_payment, mark_invoice_paid | Gardé par `financial.view_payments` (LECTURE) ; l'écran exige `payments.create` ; écriture en service_role → escalade. | Clé payments.create | 1 |
| ✅ corrigé | create_invoice | La carte affiche TPS+TVQ de l'entreprise ; la facture est créée avec `tax_cents` du modèle (0 par défaut) : carte 114,98 $, facture 100 $ ; pas d'`applied_taxes`. | taxesPourDocument : carte = facture | 4 |
| ✅ corrigé | charge_card_on_file | Aucune vérification du statut : une facture annulée (solde > 0) ou un brouillon peut être prélevé. | Refus facture annulée, brouillon, supprimée | 1 |
| ✅ corrigé | record_invoice_payment, create_payment_request, charge_card_on_file, remove_card_on_file, mark_invoice_paid, delete_invoice, refund_payment, void_invoice | Carte vide ou « amount cents 5000 » : ni facture, ni client, ni montant en dollars. | Aperçu générique : cible, montants en $ | 1 |
| ✅ corrigé | update_quote_template, update_quote_preset | Écriture directe gardée par `quotes.update` ; l'écran exige `settings.update` : un vendeur change prix/taxes/modèle par défaut. | Clé settings.update | 1 |
| ✅ corrigé | charge_card_on_file, refund_payment | « Toujours confirmer » accepte tout outil ; le mode « tout » auto-exécute aussi les sensibles : remboursement / prélèvement sans carte. | JAMAIS_D_OFFICE : argent jamais sans carte | 1 |
| ✅ corrigé | update_client, delete_client, cancel_quote, delete_quote, delete_lead, delete_deal | Carte sans la fiche ciblée (« Lumi veut la suppression de clients ») ; avec 3 « Tremblay », on confirme sans voir lequel. | Aperçu nomme la fiche ciblée | 1 |
| ✅ corrigé | merge_clients, delete_client, delete_lead, delete_deal | « Toujours confirmer » / mode « tout » : suppression ou fusion sans carte. | Irréversible = jamais d'office | 1 |
| ✅ corrigé | delete_deal | `also_delete_lead:true` supprime le client lié même s'il est devenu client actif (jobs et factures orphelins). | Refus si client actif ou historique | 3 |
| 🟡 partiel | search_clients | Le résultat ne nomme pas le bureau consulté ; pas de recherche dans l'adresse ni sans accents : « Marie Tremblay de Lévis » → 0 → le modèle retire la ville et agit sur celle de Québec. | Adresse + note « bureau actif » ; recherche sans accents non faite (fonction unaccent en base = migration) | 8 |
| ✅ corrigé | send_sms | La carte lit `args.message ?? args.body` mais l'outil utilise `message_text` : le cadre du message est toujours vide (aussi pour le texto dicté, actions-directes.ts). Le test passe `message` et cache le bug. | Aperçu lit message_text | 1 |
| ✅ corrigé | send_sms | La garde anti-exfiltration est sautée dès qu'un `client_id` est fourni ; rien ne vérifie que le numéro est celui du client ; la carte montre `client_name` (texte libre) au lieu du numéro. Injection → « À Marie Tremblay », le texto part à un autre numéro. | Numéro pris sur la fiche | 1 |
| 🟡 partiel | send_email | `/emails/send-custom` ne vérifie ni adresse injoignable, ni désabonnement, ni consentement F7, ni plafond ; `to` n'est pas vérifié comme contact de l'org. | CRM, désabonnement, rebond vérifiés ; plafond et consentement F7 sur la route non | 2 |
| ✅ corrigé | reset_member_permissions, set_member_permissions | Aucun contrôle « soi-même », « cible admin », « pas plus que ses propres droits » : un admin se redonne des droits retirés par le propriétaire, s'accorde `users.delete`, vide les droits d'un autre admin, donne à un vendeur des clés qu'il n'a plus. | refusEscalade | 1b |
| ✅ corrigé | update_role_preset | Un admin modifie le rôle « admin » (lui compris) : réactive des clés financières retirées, ajoute users.delete, ou retire des droits aux autres admins. | Rôle Admin = propriétaire seulement | 1b |
| ✅ corrigé | update_member_role | Rétrograder garde les anciens droits (permissions non réécrites) ; Lumi affirme « ses permissions repartent du modèle ». | Permissions remises au modèle du rôle | 1b |
| ✅ corrigé | (transversal) | `todayIso` = date UTC : après 20 h à Québec, « demain » = 2 jours plus tard. Aucune heure locale ni décalage : « 9 h » sans décalage devient 9 h UTC (5 h à Québec). | Aujourd'hui et heures au fuseau de l'entreprise | 1b |
| ✅ corrigé | find_dates_in_location, query_schedule | `new Date('2026-10-02')` = minuit UTC ; fin `lte` au même instant : « demain » renvoie 0 visite ou celles de la veille au soir. | Bornes de jour locales | 1b |
| ✅ corrigé | create_scheduled_report, update_scheduled_report | Sans carte (non sensibles), destinataire libre, actif dès la création : revenus, impayés et meilleurs clients envoyés chaque semaine à une adresse externe (injection ou confusion). | Jamais d'office | 1 |

### Élevé (49)

| Statut | Outils | Constat | Correction apportée | Vague |
|---|---|---|---|---|
| ✅ corrigé | create_quote | Aucun `tax_rate` : défaut 14,975 % quelles que soient les taxes ; `total_cents` renvoyé hors taxes ; pas d'`applied_taxes`. | Taux du client, totaux relus | 4 |
| ✅ corrigé | mark_invoice_paid | Une facture annulée devient « payée » (la route répond 409). | Refus facture annulée | 1 |
| ✅ corrigé | delete_invoice, send_invoice, void_invoice | Les liens de paiement actifs restent payables après annulation / suppression ; send_invoice renvoie une facture annulée. | Liens fermés + page publique refuse ; send_invoice refuse | 5 |
| ✅ corrigé | create_invoice_from_job | La RPC crée la facture à tax_cents = 0 (l'écran résout les taxes dans l'éditeur) ; `already_exists` ignoré. À vérifier sur staging. | Taxes posées ; facture existante désignée | 4 |
| ✅ corrigé | save_job_billing_milestones | Aucune lecture ne donne les ids des jalons : un nouvel échéancier supprime et recrée, y compris un jalon facturé → 2e facture de dépôt possible. | Jalon facturé ni retiré ni modifié ; get_job donne les jalons et leur facture | 9 |
| ✅ corrigé | list_payments | `sum_amount_cents` = page (50 max), ignore les remboursements ; bornes UTC. | Sommes sur tous les paiements, nettes, bornes locales | 5 |
| ✅ corrigé | create_payment_request, resend_payment_request | 200 « envoyé » même sans courriel ou texto en échec. | Canal demandé non parti = dit | 5b |
| ✅ corrigé | (transversal) | Préfixe public `/api/payment-requests/` : un technicien crée/envoie des liens de paiement depuis l'écran. | Préfixe public limité à GET (statut) : créer/renvoyer un lien passe par la clé financial.view_payments | 9 |
| ✅ corrigé | create_quote | total renvoyé avant taxes (200 $ pour 229,95 $) ; pas d'option « taxes incluses » ; carte ≠ devis. | Totaux relus en base | 4 |
| ✅ corrigé | list_quotes | Pas de client dans le résultat ni de filtre client. | Filtre client + nom du client | 8 |
| ❓ décision | convert_lead_to_client, update_lead_status, update_deal_stage, set_custom_field, create_client, update_client | Non sensibles : sans carte en mode argent, modifient la mauvaise fiche immédiatement. | Mode « argent » par défaut : ces écritures partent sans carte — décision produit |  |
| ✅ corrigé | get_client_profile | lifetime_value = 5 derniers jobs ; unpaid = total au lieu du solde. | Solde et valeur sur toutes les factures | 5 |
| ✅ corrigé | (transversal) | « Toujours confirmer » (lumi_autorisations) laisse partir tous les textos sans carte, sans contrôle de rôle (le mode « tout » est réservé au propriétaire). | Envois jamais d'office | 1 |
| ✅ corrigé | send_payment_reminders | 0 envoi (Twilio en panne, pas de numéro, tous STOP) = pas d'`error` → « C'est fait : les relances ». Partiel (5/30) idem. | 0 envoi = erreur, ignorés dits | 2 |
| ✅ corrigé | send_payment_reminders | Aucun aperçu : JSON brut avec refs, sans nom ni numéro ; jusqu'à 30 textos. | Aperçu générique (clients et textes) | 1 |
| ✅ corrigé | send_scheduled_report_now, create_payment_request, resend_payment_request, send_agreement_email, send_agreement_sms, send_quote_sms | Carte vide (seul argument = un id, filtré). | Aperçu générique | 1 |
| ✅ corrigé | create_payment_request, resend_payment_request | Client sans courriel / SMS en échec → 200 « envoyé ». | Canal non parti = dit | 5b |
| ✅ corrigé | update_automation_sms_body, update_automation_message | Réécrit `actions` alors que le moteur suit `steps` : les clients reçoivent l'ANCIEN texte ; toutes les actions du même type reçoivent le même texte. | Réécrit l'étape du parcours | 3 |
| ✅ corrigé | resend_invitation | `sensible:false` (sans carte en mode argent) ; la route remet `pending` une invitation révoquée ou acceptée ; échec d'envoi avalé. | Refus révoquée/acceptée, garde, échec dit | 3 |
| ✅ corrigé | send_scheduled_report_now, update_scheduled_report | Création/modif sans carte : une injection redirige un rapport financier vers une adresse externe ; l'échec d'envoi immédiat répond « envoyé » et part en reprise automatique. | Jamais d'office ; échec immédiat dit | 3 |
| ✅ corrigé | add_payroll_adjustment, set_member_permissions, update_member_role, set_hourly_rate, remove_member, delete_team | La carte n'identifie pas la personne ; montants en cents bruts ; pas d'avant → après ; pas d'« irréversible ». | Aperçu nomme la personne, montants en $ | 1 |
| ✅ corrigé | update_member_role, invite_member | Un admin restreint crée un admin (invitation ou promotion) et récupère tout. | Nommer un admin = propriétaire | 1b |
| ✅ corrigé | reactivate_member | Un admin réactive un admin suspendu par le propriétaire. | Réactiver un admin = propriétaire | 1b |
| ✅ corrigé | get_payroll_summary, get_timesheets | Toutes les heures valent 0 : `computeEntryHours` exige punch_in_at/punch_out_at, non sélectionnés. | Heures lues (punch_in_at/out_at), toutes les pages | 1b |
| ✅ corrigé | mark_payroll_period_paid, add_payroll_adjustment, approve_timesheet, set_hourly_rate | Un admin agit sur lui-même (son taux, sa prime, sa paie, ses heures). | refuserSurSoi | 1b |
| ✅ corrigé | get_day_route | Bornes du jour dans le fuseau du serveur (UTC). | bornesJourOrg | 1b |
| ✅ corrigé | assign_job | Écrit assigned_user_id, sans effet visible ; « C'est fait ». | Assigne l'équipe + visites à venir | 6 |
| ✅ corrigé | create_job | Pas de team_id ; exemple du prompt « crée le job, assigne-le » en actions indépendantes. | create_job accepte team_id (vérifié dans l'org) | 9 |
| ✅ corrigé | (transversal) | « C'est fait » dès qu'il n'y a pas d'`error` : warning, incomplet, deja_fait, comptes partiels, incertain ignorés ; note DONE imposée. | Reçus honnêtes | 2 |
| 🟡 partiel | deactivate_recurrence_rule | Sans carte ; visites futures laissées ; un plan de service n'est pas une règle ; clé jobs.update (techniciens). | Sensible ; visites futures et plans de service non touchés | 3 |
| ✅ corrigé | add_note | Sans carte, entité non vérifiée, pas de consigne homonymes, descriptions contradictoires. | Fiche vérifiée ; homonymes → demander | 7 |
| ❌ ouvert | schedule_job | Ne vérifie pas « non planifié » ; la RPC déplace la visite existante ou ne fait rien (≥ 2 visites) ; team ignorée ; `scheduled:true`. | schedule_job : laissé à la session agenda (elle modifie rpc_schedule_job) — coordination faite |  |
| ✅ corrigé | reschedule_job, cancel_visit | Pas de visit_id : cible = prochaine visite sinon la DERNIÈRE PASSÉE, même complétée. | visit_id ; jamais une visite passée | 6 |
| ✅ corrigé | get_job | Visites lues sans deleted_at ni org : une visite annulée ressort « scheduled ». | Visites de l'org, sans les supprimées | 6 |
| 🟡 partiel | archive_job | archived_at lu par personne : le job reste « en retard », visites au calendrier ; description fausse. | Dit la vérité ; archivage réel inexistant à l'écran | 7 |
| ✅ corrigé | update_job | Un technicien (jobs.update, sans droit aux montants) réécrit les prix. | Qui ne voit pas les montants ne les écrit pas | 7 |
| ✅ corrigé | bulk_delete_tasks, reschedule_job, unschedule_job, cancel_visit, archive_job, delete_job | Carte sans le job, ISO UTC brut, UUID de tâches. | Aperçu : job, dates locales | 1 |
| ✅ corrigé | get_revenue_summary | Pas de `last_month` : « le mois passé » répond le mois courant ; bornes en UTC. | last_month, dates, bornes locales | 5 |
| ✅ corrigé | compare_revenue | « Période précédente » = même durée juste avant, pas le mois précédent ; pas d'encaissé ; « nouveaux clients » = prospects. | Prospects, dates de la période comparée | 6 |
| ✅ corrigé | get_morning_briefing | Total en retard = somme des 5 plus anciennes factures. | Total exact | 5 |
| ✅ corrigé | remember_this, recall_notes | Mémoire sans carte, injectée dans le PROMPT SYSTÈME : un texto client peut devenir une consigne permanente pour toute l'org. | Carte après contenu externe ; souvenirs = faits | 1+5 |
| ✅ corrigé | update_automation_message | Réécrit `actions` alors que le moteur suit `steps` : ancien texte envoyé. | Étape du parcours | 3 |
| 🟡 partiel | create_automation_from_text | La condition demandée est perdue (conditions: {} en dur) ; la 2e automatisation est jetée. | 2e automatisation créée ; filtre de déclencheur non | 8 |
| 🟡 partiel | toggle_automation_rule | « is active: true », cartes vides, « rate 9.975 » sans laquelle ni l'ancien taux ; pas d'irréversible. | Carte : taux ACTUEL de la taxe (avant → après) ; textes d'automatisation générés pas encore montrés | 1+9 |
| ✅ corrigé | set_default_email_template | Non sensibles alors que le modèle actif EST le courriel client ; create actif par défaut. | Sensible + jamais d'office | 3 |
| ✅ corrigé | create_tax_config | Pas de contrôle de doublon : double TVQ sur tous les documents ; note fausse sur les groupes régionaux. | Refus doublon | 6 |
| ✅ corrigé | update_d2d_pipeline_item | Écriture directe : un vendeur passe le deal d'un collègue en gagné et se l'attribue. | Réattribuer un deal = propriétaire/admin ; « ses deals » déjà bornés par la RLS quand l'org le restreint | 9 |
| ✅ corrigé | update_house | Pin et pipeline non synchronisés (bug D9 reproduit). | Passe par la route « Modifier le pin » (pin + pipeline + cache) | 9 |
| ✅ corrigé | build_report | Une lecture ratée devient « Aucune facture en retard. 🎉 ». | Lecture ratée = « rapport incomplet » | 6 |

### Moyen (8)

| Statut | Outils | Constat | Correction apportée | Vague |
|---|---|---|---|---|
| ✅ corrigé | send_invoice | Le message de Lumi est inséré en HTML brut (lien d'hameçonnage possible) ; sauts de ligne perdus. | Message échappé | 8 |
| 🟡 partiel | send_invoice, send_quote | La carte ignore le modèle de courriel de l'org ; l'objet affiché prend le total alors que le courriel montre le solde. | Carte : même destinataire et même montant (solde) que le courriel ; modèle de courriel de l'org pas encore montré | 9 |
| ✅ corrigé | send_quote | Destinataire de la carte (client) ≠ celui de la route (client.email ‖ lead.email). | Destinataire = client, sinon prospect (règle de la route) | 9 |
| ❓ décision | send_payment_reminders, send_sms | Twilio appelé en direct : contourne smsLimiter et le limiteur Redis de /api/messages/send. | Limiteur de la route non appliqué : chaque texto de Lumi exige déjà une carte (jamais d'office) — risque accepté, à confirmer |  |
| ✅ corrigé | send_payment_reminders | Pas de dédoublonnage par client (2 textos) ; aucun contrôle d'impayé ; permission messages.send (techniciens) ; hors OUTILS_FINANCIERS. | Dédoublonnage, impayé vérifié, outil financier (qui ne voit pas les montants ne relance pas) | 2+9 |
| ✅ corrigé | create_job_agreement | Création sans carte ; `terms` libres ; client ≠ client du job possible ; la carte d'envoi ne montre ni conditions ni client. | Carte toujours ; contrat toujours au client du job | 3+9 |
| ✅ corrigé | (transversal) | Délai dépassé → pas d'`error` → « Fait ». | Reçu « pas eu la confirmation » | 2 |
| 🟡 partiel | create_automation_from_text, toggle_automation_rule | Carte « is active: true » sans nom ni messages ; textes générés jamais montrés. | Jamais d'office ; textes générés non montrés sur la carte | 1 |

### Bas (3)

| Statut | Outils | Constat | Correction apportée | Vague |
|---|---|---|---|---|
| ❓ décision | send_email | Lumi exige messages.send (techniciens), la route owner/admin → carte qui échoue ensuite. | send_email : route owner/admin vs garde messages.send — aligner l'un ou l'autre (décision produit) |  |
| ✅ corrigé | send_sms | Codes Twilio 21211/21610 perdus ; recherche du numéro par ilike rate les formats « 514-555-0199 ». | Codes Twilio 21211/21610/21614/21408/21612 dits en clair | 9 |
| ✅ corrigé | (transversal) | Pas de renvois entre send_sms / send_quote_sms / send_agreement_sms / relances. | send_sms renvoie vers les autres outils d'envoi | 9 |

### Trouvés en dehors des tableaux d'audit (corrigés)

Défauts transversaux, trouvés en lisant le code d'exécution ou par l'éval — chacun touchait des dizaines d'outils à la fois.

| Sévérité | Défaut | Effet | Correction |
|---|---|---|---|
| critique | Anti-doublon PERMANENT par org (`agent_actions` sans âge ni utilisateur) | La même action redemandée des jours plus tard (relances, pointage d'un autre employé) n'était plus jamais exécutée, et Lumi répondait « déjà fait » | Empreinte par utilisateur, fenêtre de 10 min, « en cours » ≠ « fait » |
| critique | 173 actions sur 180 sans aperçu | On confirmait « Supprimer le client » ou un remboursement sans voir QUI ni COMBIEN | Aperçu générique : chaque identifiant lu en base et nommé, montants en $, dates locales, introuvable = alerte |
| critique | Confirmation par texto : pas d'expiration, pas de lien au membre, double « oui » = double exécution, seule la 1re action du groupe exécutée puis « C'est fait » | Un « oui » tardif exécutait la proposition de la veille | Expiration 15 min, proposition liée au membre, consommée une seule fois, toute la carte exécutée, aperçu déterministe dans le texto |
| critique | Filtre anti-injection SQL sur le texte libre | « Delete Sophie from my clients » bloqué (400) ET IP bannie 60 min : un utilisateur anglophone ne pouvait rien supprimer | Le texte libre (message, notes, description…) n'est plus inspecté comme du SQL (requêtes paramétrées) |
| élevé | Réponses d'aide toutes faites sur des ORDRES | « Configure mes taxes » → le chemin dans Paramètres ; « Remets les permissions de Karim » → le mot de passe oublié ; « Supprime la liste de la job 24 » → la fiche du job | Un ordre (verbe d'action, « peux-tu », « can you ») va toujours au modèle |
| élevé | Numéros affichés passés comme identifiants | « job 33 », « INV-000017 » → requête en échec, « souci de connexion à Lume » sur ~15 outils | La garde résout les numéros dans l'org, avant la carte et avant l'exécution |
| élevé | Identifiants inventés par le modèle (« jean-pierre-gagnon ») | La carte n'affichait rien, l'exécution échouait | Signalés en alerte sur la carte |
| élevé | Fuseau : « aujourd'hui » en UTC, heures sans décalage lues en UTC | Après 20 h, « demain » = après-demain ; « 9 h » devenait 5 h | Jour et heure de l'entreprise dans le prompt ; heures sans décalage converties au fuseau de l'entreprise (heure avancée comprise) |
| élevé | Reçus « C'est fait » sur un résultat incertain, partiel, déjà fait ou avec avertissement | Faux « c'est fait » | Reçus honnêtes (écran et texto) |
| élevé | `send_invoice` : message du modèle inséré en HTML | Lien d'hameçonnage possible dans un courriel au client | Texte échappé |
| moyen | Rentabilité : toutes les tranches d'ids lues en même temps | Pool PostgREST saturé sur un gros tenant (16 000 jobs) | 5 lots à la fois |
| sécu (hors Lumi) | 3 fonctions SECURITY DEFINER des Dépenses exécutables par `anon` | Total des dépenses d'une job de n'importe quelle entreprise lisible | Révoquées (migration appliquée staging + prod, PR #796) |

## 3. Écarts de permissions

Toutes les permissions de Lumi sont vérifiées **côté serveur**, avant le handler, par `executerOutilGarde` (`server/lib/agent/garde.ts`) : clé de la page Rôles (`PERMISSION_PAR_OUTIL`), puis visibilité des montants (`membre_voit_les_montants`), puis validation des arguments. L'org vient de la session (jamais d'un argument), et chaque requête d'outil passe par le client de l'utilisateur (RLS) ou par une route de l'app qui refait ses propres contrôles.

### Corrigés dans cette branche

| Outil(s) | Écart | Avant | Après |
|---|---|---|---|
| `record_invoice_payment`, `mark_invoice_paid` | Clé de LECTURE pour une écriture d'argent | `financial.view_payments` | `payments.create` (comme l'écran) |
| 7 outils de préréglages/modèles de devis | Un vendeur changeait prix, taxes, modèle par défaut | `quotes.update` | `settings.update` (comme l'écran) |
| `set_member_permissions`, `reset_member_permissions`, `update_role_preset`, `update_member_role`, `invite_member`, `reactivate_member` (et les MÊMES routes à l'écran) | Escalade : un admin se redonnait des droits, touchait un autre admin ou le rôle Admin, nommait un admin, donnait une permission qu'il n'a pas | aucun contrôle (routes en service_role) | `refusEscalade` (`server/lib/garde-droits.ts`) : seul le propriétaire fait tout ; les autres ne touchent ni à eux-mêmes, ni à un admin, et n'accordent que ce qu'ils ont |
| `resend_invitation` (route) | Une invitation révoquée ou acceptée revivait, sans garde d'escalade | remise « en attente » | refus 409 + même garde qu'à l'envoi |
| `set_hourly_rate`, `add_payroll_adjustment`, `mark_payroll_period_paid`, `approve_timesheet` | Un admin agissait sur SA propre paie | permis | refusé (`refuserSurSoi`), sauf propriétaire |
| Toute écriture portant un montant | Un technicien sans accès aux montants réécrivait les prix (`update_job`) | permis | refusé si la personne ne voit pas les montants |
| Modes « argent » / « tout », « toujours confirmer » | Argent, envois, irréversible et droits partaient sans carte | selon le mode | `JAMAIS_D_OFFICE` : toujours une carte, et « toujours confirmer » est refusé pour ces actions (serveur) |
| Écritures après lecture de contenu externe | Un texto ou formulaire client pouvait déclencher une écriture d'office (injection) | d'office | carte obligatoire pour le reste du tour |

### Préréglages de rôle : aucun changement

Conformément à la consigne, **aucun préréglage de rôle n'a été modifié**. Les clés ci-dessus sont celles que l'écran exige déjà ; seule la garde de Lumi a été alignée dessus.

### Ouverts

| Outil / lieu | Écart | Proposition |
|---|---|---|
| `send_email` | Lumi exige `messages.send` (techniciens l'ont) ; la route exige owner/admin → carte proposée puis refusée | Aligner la garde sur owner/admin, ou ouvrir la route à `messages.send` — **décision produit** |
| `send_payment_reminders` | `messages.send` suffit : un technicien peut relancer un impayé (il ne voit pourtant pas les montants) | Exiger aussi `financial.view_invoices` (garde à deux clés) |
| `deactivate_recurrence_rule` | Clé `jobs.update` (techniciens) pour arrêter une récurrence | `jobs.delete` ou `settings.update` — décision produit |
| `update_d2d_pipeline_item` | Écriture directe : un vendeur passe le deal d'un collègue en gagné et se l'attribue | Passer par la route du pipeline terrain |
| Route `/api/payment-requests/*` | Préfixe public qui saute la garde de rôle à l'écran | Hors Lumi : à corriger dans `route-permissions.ts` |
| `team_members` (base) | INSERT permis à tout membre pour n'importe quel user_id | Migration proposée `20261004500000_team_members_insert_admin_ou_soi.sql` (non appliquée) |
| `team_members` (base, Loi 25) | Taux horaire et date de naissance lisibles par tous les membres | Nécessite de passer 3 écrans par une RPC avant de restreindre la colonne |
| Mode par défaut « argent » | 75 actions non sensibles partent sans carte (créer un job, déplacer une carte du pipeline…) | **Décision produit** : la mission demande « les 180 ont une carte » ; c'est le mode « demander ». Changer le défaut = une migration (`memberships.lumi_mode DEFAULT 'argent'`, plus la valeur des membres existants) — non écrite, en attente de ta décision |

### Vérifié par preset

Pour chaque outil, la colonne « Garde (préréglages) » de la matrice donne la clé et les rôles qui l'ont par défaut. Les tests `tests/garde-droits.test.ts`, `tests/lumi-garde-fous.test.ts`, `tests/lumi-garde-droits-montants.test.ts` et `tests/rls-permissions-parite` couvrent la garde ; la preuve contre PostgREST reste `npm run qa:rls-roles` (staging).

## 4. Évaluation avant / après

Jeu : `evals/lumi-tools/cas/` (456 cas : 3 par action sensible — français, anglais, désambiguïsation ou clarification —, 1 par autre action, 1 par lecture). Runner : `evals/lumi-tools/run.mts` (mode « demander » : aucune écriture ne s'exécute ; serveurs d'éval sans aucun identifiant d'envoi). « Avant » = `origin/main` au moment de l'audit ; « après » = cette branche fusionnée avec `origin/main` (passe finale). Une passe intermédiaire, avant les dernières corrections, donnait 82,0 % / 96,4 % / 89,7 %.

| Portée | Cas | Outil exact | Paramètres + cible sur la carte | Clarification | Faux « c'est fait » | Outil interdit proposé |
|---|---|---|---|---|---|---|
| **Global** | 456 | 79.4 % → **84.3 %** | 37.4 % → **98 %** | 82.8 % → **93.1 %** | 0 → **0** | 0 → **0** |
| **Sensibles** | 315 | 75.2 % → **80.4 %** | 29.8 % → **97.4 %** | 82.8 % → **93.1 %** | 0 → **0** | 0 → **0** |
| action | 361 | 77.6 % → **83.1 %** | 37.4 % → **98 %** | — → **—** | 0 → **0** | 0 → **0** |
| lecture | 66 | 89.4 % → **90.9 %** | — → **—** | — → **—** | 0 → **0** | 0 → **0** |
| clarification | 29 | 0 % → **0 %** | — → **—** | 82.8 % → **93.1 %** | 0 → **0** | 0 → **0** |
| clients | 50 | 78.7 % → **80.9 %** | 32 % → **100 %** | 100 % → **100 %** | 0 → **0** | 0 → **0** |
| communications | 25 | 69.6 % → **69.6 %** | 75 % → **83.3 %** | 100 % → **100 %** | 0 → **0** | 0 → **0** |
| devis | 47 | 73.8 % → **83.3 %** | 34.6 % → **100 %** | 100 % → **100 %** | 0 → **0** | 0 → **0** |
| equipe | 78 | 84.9 % → **90.4 %** | 18.8 % → **98.1 %** | 80 % → **100 %** | 0 → **0** | 0 → **0** |
| facturation | 102 | 82.3 % → **87.5 %** | 36.2 % → **100 %** | 100 % → **100 %** | 0 → **0** | 0 → **0** |
| memoire | 7 | 83.3 % → **100 %** | 100 % → **100 %** | 0 % → **0 %** | 0 → **0** | 0 → **0** |
| planification | 81 | 63.6 % → **70.1 %** | 13.3 % → **100 %** | 50 % → **75 %** | 0 → **0** | 0 → **0** |
| rapports | 37 | 94.3 % → **97.1 %** | 50 % → **88.2 %** | 100 % → **100 %** | 0 → **0** | 0 → **0** |
| terrain | 29 | 96.4 % → **96.4 %** | 90.5 % → **100 %** | 0 % → **100 %** | 0 → **0** | 0 → **0** |

### Comment lire ces chiffres

- **Outil exact** : Lumi a proposé (écriture) ou appelé (lecture) l'outil attendu, et aucun outil « interdit » (le mauvais geste : supprimer au lieu d'archiver, annuler au lieu de supprimer…).
- **Paramètres + cible** : quand l'outil est le bon, ses paramètres attendus (montant, canal, date…) sont exacts ET la cible est visible sur la carte (numéro de facture, nom du client). C'est la mesure « l'action exécutée est celle que la carte montre ».
- **Clarification** : sur les 29 cas ambigus (homonymes, montant manquant, texte manquant), Lumi n'a rien proposé et a posé une question.
- **Faux « c'est fait »** : réponse qui affirme une action alors que rien n'a été exécuté (en mode « demander », rien ne l'est).
- **Partiel** : Lumi a cherché la bonne fiche mais elle n'existait pas sur staging (job n° 9, demande reçue, contrat…) — ni un succès ni un faux pas.

Conditions identiques pour les deux passes : même jeu de 456 cas, même org de staging, forfait avec Lumi et budget relevé le temps de la batterie (sinon le plafond journalier bascule en palier « restreint » — autre modèle — et fausse tout), serveurs sans aucun identifiant d'envoi.

### Ce que l'éval a trouvé (et qui est corrigé)

L'éval n'a pas seulement mesuré : elle a trouvé 6 défauts que la lecture du code n'avait pas vus — le filtre anti-SQL qui bloquait l'anglais, les réponses d'aide et les raccourcis de lecture qui répondaient à des ORDRES (y compris servis par le cache de réponses), les numéros affichés passés comme identifiants, les identifiants inventés, et la carte de deal qui lisait une colonne inexistante.

### Objectifs de la mission

| Objectif | Résultat |
|---|---|
| 100 % sur l'éval sensible | **Non atteint** (voir le tableau) : les écarts restants sont surtout des cas « partiels » (fiche absente de staging) et quelques choix d'outil du modèle. Aucun écart ne peut exécuter une action sensible sans carte. |
| Zéro faux « c'est fait » | **Atteint** (avant et après) |
| Zéro action différente de la carte | **Atteint par construction** : la carte est calculée sur les MÊMES arguments que l'exécution (numéros résolus avant la carte, taxes par la même fonction), la garde est refaite au clic, et la carte signale toute cible introuvable ou inventée. |
| Zéro écart de permission | **Atteint pour Lumi** (section 3) ; restent 2 décisions produit (send_email, mode par défaut). |

## 5. Coûts API

| Portée | Avant ($ / 1000 demandes) | Après ($ / 1000 demandes) |
|---|---|---|
| **Global** | 10.47 $ | **10.74 $** |
| action | 10.11 $ | 10.92 $ |
| lecture | 13.26 $ | 9.54 $ |
| clarification | 8.57 $ | 11.22 $ |
| clients | 13.56 $ | 11.21 $ |
| communications | 12.83 $ | 9.26 $ |
| devis | 9.79 $ | 10.79 $ |
| equipe | 9.52 $ | 9.6 $ |
| facturation | 10.34 $ | 12.37 $ |
| memoire | 6.44 $ | 14.27 $ |
| planification | 10.41 $ | 11.27 $ |
| rapports | 8.58 $ | 8.09 $ |
| terrain | 10.71 $ | 9.44 $ |

### Lecture

Coût mesuré par l'éval (une demande = une conversation neuve, cache de prompt chaud, palier normal), en dollars US pour 1 000 demandes. Une vraie conversation de plusieurs tours coûte davantage par demande ; l'ordre de grandeur relatif, lui, tient.

### Leviers déjà en place (vérifiés, rien à ajouter sans perte)

| Levier | État |
|---|---|
| Cache de prompt | En place (préfixe partagé entre orgs, TTL 5 min depuis #810) |
| Routage en 2 étapes | En place (`LUMI_ROUTEUR=actif` en prod : routeur Haiku, sous-agents à jeu d'outils réduit) |
| Schémas et résultats compacts | En place (résultats en table, vides retirés : −35 à −45 % de tokens sur les listes) |
| Chemins rapides à 0 token | En place (raccourcis, actions directes, caches exact et sémantique) — **resserrés** : ils ne répondent plus à un ordre |
| Plafond de tours | En place (8 étapes par tour, plafond d'écritures par conversation) |
| Modèle moins cher | **Non appliqué** : une passe au palier « restreint » (modèle moins cher, même jeu) a donné ≈ 4 $/1000 mais 72 % d'outil exact contre 82 % — indicatif seulement (code d'une vague antérieure), à re-mesurer proprement avant toute décision. Règle de la mission : aucune optimisation qui baisse l'éval. |

### Effet de l'audit sur le coût

Le coût par demande est quasi stable (+3 % mesuré). Les corrections ajoutent surtout des lectures en BASE (résolution des numéros, aperçus, vérifications), pas des tokens. La seule hausse de tokens est volontaire : un ordre ne reçoit plus une réponse toute faite à 0 ¢ (FAQ, raccourci, cache) — c'était une économie fausse, puisque la réponse était mauvaise.

### Recommandation

Aucun levier de coût supplémentaire n'est recommandé sans une nouvelle passe d'éval qui le valide. Le plus prometteur à tester : un sous-agent à jeu d'outils plus étroit pour les lectures simples (« c'est quoi mes jobs demain »), en gardant le modèle actuel pour tout ce qui écrit.

## 6. Migrations en attente

Aucun préréglage de rôle modifié, aucune donnée corrigée. Une seule migration de l'audit a été appliquée, après ton accord (ci-dessous) ; le reste attend ta décision.

| Fichier | Effet | Risque | Vérification prévue |
|---|---|---|---|
| `supabase/migrations/20261004500000_team_members_insert_admin_ou_soi.sql` — **APPLIQUÉE staging + prod le 2026-09-30 (accord de Rafba)** | INSERT sur `team_members` réservé aux admins, ou à soi-même | Vérifié sur staging : un vendeur ne crée plus la fiche d’un autre (refus RLS), sa propre fiche passe ; politique identique en prod ; checks sans nouvel écart | — |

À décider avant d'écrire (pas de fichier tant que la décision n'est pas prise) :

1. **Mode Lumi par défaut** : `memberships.lumi_mode DEFAULT 'argent'` → `'demander'` pour que les 180 actions aient une carte (et mise à jour des membres encore au défaut).
2. **Loi 25 — taux horaire et date de naissance** : accord donné le 2026-09-30 ; **confié à la session Statistiques** (qui restreignait déjà la lecture des taux) pour éviter deux migrations sur les mêmes colonnes : `hourly_rate_cents`, `labour_cost_hourly`, `birth_date` (team_members / memberships), les écrans `ProfileSettings.tsx`, `TeamMemberDetails.tsx`, `Commissions.tsx`, et côté serveur `rentabilite/charger.ts`, `routes/payroll.ts`. Elle préviendra avant d'appliquer. **Pas encore corrigé.**
3. **Recherche sans accents** (« Levis » = « Lévis ») : extension `unaccent` + index ; aujourd'hui `search_clients` ne trouve pas un nom tapé sans accent.

Hors audit, déjà fait pendant la session (hors de la règle « outils de Lumi », accord permanent sur les migrations, PR #796) : `20261004210000_secdef_champs_depenses_revoke.sql` — fermeture à `anon`/`authenticated` de 3 fonctions SECURITY DEFINER des Dépenses, appliquée staging + prod, ACL vérifiées.

## 7. Ce qui ne peut pas être garanti

- **Le choix du modèle reste probabiliste.** La carte, la garde et les reçus sont déterministes ; le choix de l'outil et des paramètres, non. L'éval mesure un taux, pas une certitude. Ce qui est garanti : aucune action sensible ne s'exécute sans carte, la carte montre ce que le serveur exécutera (cibles lues en base), et le serveur refait tous ses contrôles au clic.
- **L'injection indirecte** (texte d'un client, d'un formulaire, d'une note) : Lumi ne peut plus rien écrire d'office après avoir lu ce contenu, et ses souvenirs sont présentés comme des faits. Mais une consigne cachée peut encore l'amener à PROPOSER une action : c'est la carte, lue par un humain, qui l'arrête.
- **Les envois « incertains »** (la requête est partie, la réponse jamais revenue) : Lumi le dit et ne réessaie pas, mais seul le fournisseur (Resend, Twilio, Stripe) sait si c'est parti.
- **L'éval tourne sur staging**, avec des données de test : un cas « partiel » signifie souvent que la fiche visée n'existait pas. Les montants lus dépendent des RPC de statistiques, redéfinies sur staging PENDANT les passes par la session Statistiques (heure de Toronto, encaissé net) — sans effet sur le choix des outils, mais les chiffres des lectures ne sont pas comparables d'une passe à l'autre.
- **Les RPC** : les handlers passent par les mêmes RPC que l'écran ; si une RPC change (la session agenda modifie `rpc_reschedule_event`, `rpc_schedule_job`, `rpc_add_visit`), le comportement de Lumi suit — c'est voulu, mais les tests unitaires de Lumi simulent ces RPC.
- **Le coût** est mesuré sur l'éval (cache chaud, un message par conversation) ; une vraie conversation de plusieurs tours coûte davantage par demande.
- **Les deux chemins de confirmation** (carte web, « oui » par texto) sont couverts ; le MCP externe (Claude.ai) a sa propre confirmation côté client, hors de notre contrôle.
