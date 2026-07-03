-- Request form logo: optional custom logo shown at the top of the public form.
-- When NULL, the public endpoint falls back to company_settings.logo_url.
alter table public.request_forms add column if not exists logo_url text;
