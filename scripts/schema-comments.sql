-- COPIE-COLLE TOUT ÇA DANS LE SQL EDITOR ET CLIQUE RUN (1 seule fois)
-- Ça ajoute les descriptions de domaine sur chaque table pour le Schema Visualizer

-- AUTH
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.memberships IS ''[A] Auth — User ↔ Org membership'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.orgs IS ''[A] Auth — Organizations (tenants)'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.profiles IS ''[A] Auth — User profiles (name, avatar)'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.company_settings IS ''[A] Auth — Company info per org'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.user_settings IS ''[A] Auth — User preferences'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
-- CRM
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.leads IS ''[B] CRM — Leads (potential customers)'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.clients IS ''[B] CRM — Clients (active customers)'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.contacts IS ''[B] CRM — Shared contact info'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.pipeline_deals IS ''[B] CRM — Pipeline Kanban cards'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.pipeline_stages IS ''[B] CRM — Stage definitions (legacy)'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.job_intents IS ''[B] CRM — Job creation triggers'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.notes IS ''[B] CRM — Notes on entities'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.notes_files IS ''[B] CRM — Note file attachments'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.notes_tags IS ''[B] CRM — Note tags'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.notes_checklist IS ''[B] CRM — Note checklists'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.note_history IS ''[B] CRM — Note version history'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.note_boards IS ''[B] CRM — Visual note boards'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.custom_fields IS ''[B] CRM — Custom field definitions (v2)'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.custom_field_values IS ''[B] CRM — Custom field values (v2)'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
-- OPERATIONS
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.jobs IS ''[C] Ops — Work orders / jobs'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.job_line_items IS ''[C] Ops — Job line items (services)'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.teams IS ''[C] Ops — Teams / crews'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.team_members IS ''[C] Ops — Team membership'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.schedule_events IS ''[C] Ops — Calendar events for jobs'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.tasks IS ''[C] Ops — Internal to-do tasks'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.availabilities IS ''[C] Ops — User availability slots'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.team_availability IS ''[C] Ops — Team weekly schedule'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.team_date_slots IS ''[C] Ops — Team date overrides'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.predefined_services IS ''[C] Ops — Service catalog'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
-- BILLING
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.invoices IS ''[D] Billing — Invoices'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.invoice_items IS ''[D] Billing — Invoice line items'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.invoice_sequences IS ''[D] Billing — Invoice numbering'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.payments IS ''[D] Billing — Payments received'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.payment_providers IS ''[D] Billing — Provider configs'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.payment_provider_settings IS ''[D] Billing — Provider settings'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.payment_provider_secrets IS ''[D] Billing — Provider API keys'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.payment_settings IS ''[D] Billing — Org payment prefs'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.invoice_templates IS ''[D] Billing — Invoice templates'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
-- COMMUNICATION
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.notifications IS ''[E] Comms — In-app notifications'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.email_templates IS ''[E] Comms — Email templates'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.conversations IS ''[E] Comms — Message threads'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.messages IS ''[E] Comms — Individual messages'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.communication_messages IS ''[E] Comms — SMS/email log'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.communication_channels IS ''[E] Comms — Channel configs'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.communication_settings IS ''[E] Comms — Org comm prefs'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
-- AUTOMATION
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.automation_rules IS ''[F] Auto — Event-driven rules (21 presets)'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.automation_scheduled_tasks IS ''[F] Auto — Delayed action queue'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.automation_execution_logs IS ''[F] Auto — Execution audit trail'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.activity_log IS ''[F] Auto — All CRM events log'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.audit_events IS ''[F] Auto — Data change audit'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.satisfaction_surveys IS ''[F] Auto — Customer surveys'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.review_requests IS ''[F] Auto — Google review tracking'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
-- WORKFLOWS
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.workflows IS ''[G] Workflows — Visual builder defs'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.workflow_nodes IS ''[G] Workflows — Builder nodes'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.workflow_edges IS ''[G] Workflows — Node connections'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.workflow_runs IS ''[G] Workflows — Run history'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.workflow_logs IS ''[G] Workflows — Run logs'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
-- AI
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.ai_conversations IS ''[H] AI — Assistant conversations'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.ai_messages IS ''[H] AI — Conversation messages'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
-- GPS
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.technician_locations IS ''[I] GPS — Technician positions'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.technician_device_mappings IS ''[I] GPS — Device mappings'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.geofences IS ''[I] GPS — Job site geofences'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.proof_of_presence IS ''[I] GPS — Presence proof logs'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.gps_providers IS ''[I] GPS — Provider configs'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
-- FILES
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.attachments IS ''[J] Files — Entity attachments'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
-- INTERNAL
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.client_link_backfill_ambiguous IS ''[K] Internal — Migration tracking'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'COMMENT ON TABLE public.quote_views IS ''[K] Internal — Invoice view tracking'''; EXCEPTION WHEN undefined_table THEN NULL; END $$;

SELECT 'Done! All table comments added.' as result;
