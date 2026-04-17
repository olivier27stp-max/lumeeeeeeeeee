-- Align plans with marketing pricing page — single source of truth
-- Names: Init / Scale / Autopilot
-- Prices: match landing page exactly

UPDATE public.plans SET
  name = 'Init',
  name_fr = 'Init',
  monthly_price_usd = 10500,
  monthly_price_cad = 10500,
  yearly_price_usd = 107100,
  yearly_price_cad = 107100,
  features = '["CRM management", "Quotes & invoicing", "Online payments", "Customer management", "Mobile access", "Basic reporting"]'::jsonb,
  max_clients = NULL,
  max_jobs_per_month = NULL
WHERE slug = 'starter';

UPDATE public.plans SET
  name = 'Scale',
  name_fr = 'Scale',
  monthly_price_usd = 24000,
  monthly_price_cad = 24000,
  yearly_price_usd = 244800,
  yearly_price_cad = 244800,
  features = '["Everything in Init", "Track employee timesheets", "Automate quote and invoice follow-ups", "Access quote templates", "Two-way texting with customers", "Track employee performance", "AI assistant"]'::jsonb,
  max_clients = NULL,
  max_jobs_per_month = NULL
WHERE slug = 'pro';

UPDATE public.plans SET
  name = 'Autopilot',
  name_fr = 'Autopilot',
  monthly_price_usd = 36000,
  monthly_price_cad = 36000,
  yearly_price_usd = 367200,
  yearly_price_cad = 367200,
  features = '["Everything in Scale", "Premium support", "Built for large teams"]'::jsonb,
  max_clients = NULL,
  max_jobs_per_month = NULL
WHERE slug = 'autopilot';
