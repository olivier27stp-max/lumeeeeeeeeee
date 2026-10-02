-- Tables de RÉFÉRENCE de la pile locale des E2E des automatisations (scripts/qa/automations-e2e/pile.sh).
-- Générées le 2026-10-02 depuis la pile locale (elle-même chargée d'une sauvegarde de la prod du 2026-10-01).
-- Aucune donnée de client. Les identifiants Stripe des forfaits sont retirés (colonnes laissées à NULL).
-- À régénérer si les forfaits ou les permissions par défaut des rôles changent en prod.

-- ── Forfaits ──
insert into public.plans select * from jsonb_populate_record(null::public.plans, '{"id": "ce227095-507c-4c9a-af66-5fc9ebc8fa69", "name": "Minimum", "slug": "starter", "name_fr": "Minimum", "features": ["CRM dashboard", "Client management + client portal", "Quotes & invoicing", "Jobs & calendar", "Online payments (Stripe & PayPal)", "Tasks & leads", "Email communications", "Mobile access", "Basic reporting"], "is_active": true, "created_at": "2026-04-05T00:48:23.17115+00:00", "sort_order": 1, "updated_at": "2026-09-25T18:55:29.892181+00:00", "includes_ai": false, "max_clients": null, "includes_api": false, "includes_d2d": false, "includes_sms": false, "intro_months": 3, "seats_included": 2, "includes_courses": false, "yearly_price_cad": 162000, "yearly_price_usd": 117600, "includes_pipeline": false, "monthly_price_cad": 15000, "monthly_price_usd": 10900, "max_jobs_per_month": null, "includes_timesheets": false, "extra_seat_price_cad": 3500, "extra_seat_price_usd": 2500, "includes_automations": false, "includes_marketplace": false, "lumi_credits_mensuels": 0, "includes_request_forms": false, "intro_price_yearly_cad": 130000, "intro_price_yearly_usd": 95400, "ai_monthly_budget_cents": 0, "intro_price_monthly_cad": null, "intro_price_monthly_usd": null}'::jsonb) on conflict do nothing;
insert into public.plans select * from jsonb_populate_record(null::public.plans, '{"id": "d1163a9e-2145-4d7c-8efe-40d5f95cd928", "name": "Scale", "slug": "pro", "name_fr": "Scale", "features": ["Everything in Minimum", "Two-way SMS texting with customers (dedicated number)", "Automated quote & invoice follow-ups", "Quote templates, presets & satellite measure tool", "Employee timesheets", "Track employee performance", "Recurring jobs, checklists & GPS tracking", "Dispatch map & batch messaging", "Internal team chat", "Advanced analytics & insights", "QuickBooks export", "Marketplace integrations & webhooks", "Custom request forms"], "is_active": true, "created_at": "2026-04-05T00:48:23.17115+00:00", "sort_order": 2, "updated_at": "2026-09-25T18:43:09.539479+00:00", "includes_ai": false, "max_clients": null, "includes_api": false, "includes_d2d": false, "includes_sms": true, "intro_months": 3, "seats_included": 10, "includes_courses": true, "yearly_price_cad": 354000, "yearly_price_usd": 254400, "includes_pipeline": true, "monthly_price_cad": 34700, "monthly_price_usd": 24900, "max_jobs_per_month": null, "includes_timesheets": true, "extra_seat_price_cad": 3000, "extra_seat_price_usd": 2100, "includes_automations": true, "includes_marketplace": false, "lumi_credits_mensuels": 0, "includes_request_forms": true, "intro_price_yearly_cad": 294800, "intro_price_yearly_usd": 216800, "ai_monthly_budget_cents": 0, "intro_price_monthly_cad": null, "intro_price_monthly_usd": null}'::jsonb) on conflict do nothing;
insert into public.plans select * from jsonb_populate_record(null::public.plans, '{"id": "a141b7aa-58ab-4264-a84e-56c11147da79", "name": "Autopilot", "slug": "autopilot", "name_fr": "Autopilot", "features": ["Everything in Scale", "Lume AI Agent (voice) — 1,000 Lumi credits / month", "Door-to-door sales suite (map, pipeline, leaderboard, commissions)", "Courses / LMS for team training", "Multi-team management", "Advanced roles & permissions", "Full API access", "Team availability management", "Automated satisfaction surveys", "Premium support", "Dedicated onboarding specialist"], "is_active": true, "created_at": "2026-04-05T00:48:23.17115+00:00", "sort_order": 3, "updated_at": "2026-09-30T20:52:17.745464+00:00", "includes_ai": true, "max_clients": null, "includes_api": true, "includes_d2d": true, "includes_sms": true, "intro_months": 3, "seats_included": 20, "includes_courses": true, "yearly_price_cad": 416400, "yearly_price_usd": 301200, "includes_pipeline": true, "monthly_price_cad": 49500, "monthly_price_usd": 35900, "max_jobs_per_month": null, "includes_timesheets": true, "extra_seat_price_cad": 2500, "extra_seat_price_usd": 1800, "includes_automations": true, "includes_marketplace": true, "lumi_credits_mensuels": 1000, "includes_request_forms": true, "intro_price_yearly_cad": 429200, "intro_price_yearly_usd": 312100, "ai_monthly_budget_cents": 4500, "intro_price_monthly_cad": null, "intro_price_monthly_usd": null}'::jsonb) on conflict do nothing;

-- ── Permissions par défaut des rôles (doit rester égal à ROLE_PRESETS : tests/rls-permissions-parite) ──
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'calendar.read') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'calendar.update') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'clients.create') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'clients.read') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'clients.update') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'commissions.read') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'door_to_door.access') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'door_to_door.convert') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'door_to_door.edit') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'external_agent.use') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'financial.view_pricing') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'jobs.create') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'jobs.read') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'leads.create') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'leads.read') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'leads.update') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'map.access') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'messages.read') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'messages.send') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'quotes.create') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'quotes.read') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'quotes.send') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'quotes.update') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'search.global') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('sales_rep', 'settings.read') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('technician', 'calendar.read') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('technician', 'calendar.update') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('technician', 'clients.read') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('technician', 'external_agent.use') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('technician', 'gps.read') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('technician', 'jobs.complete') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('technician', 'jobs.read') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('technician', 'jobs.update') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('technician', 'messages.read') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('technician', 'messages.send') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('technician', 'settings.read') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('technician', 'timesheets.read') on conflict do nothing;
insert into public.role_permission_defaults (role, permission) values ('technician', 'timesheets.update') on conflict do nothing;
