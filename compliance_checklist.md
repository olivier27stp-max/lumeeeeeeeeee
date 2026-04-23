# Pre-Production Compliance Checklist — Lume CRM

**Version:** 2026-04-21
Review this checklist before going live with new customers in Québec/Canada/USA/EU. Every box must be ticked AND signed off by the accountable owner.

## A. Governance

- [ ] DPO designated (name, email, phone on file)
- [ ] DPO email `willhebert30@gmail.com` receives mail
- [ ] Legal contact `willhebert30@gmail.com` receives mail
- [ ] Company legal entity name and registered address filled in `docs/legal/privacy_policy.md`, `docs/legal/terms_of_service.md`, `src/pages/Privacy.tsx`, `src/pages/Terms.tsx`
- [ ] ROPA reviewed and signed (`docs/compliance/ropa.md`)
- [ ] Privacy Impact Assessment (Law 25 art. 17) on file for US hosting

## B. Database migrations applied

- [ ] `20260625000000_compliance_hardening.sql` — contacts.org_id NOT NULL, audit TTL, verify_org_access
- [ ] `20260625000001_dsr_and_consents.sql` — consents + dsar_requests + anonymize/export RPCs
- [ ] `20260625000002_retention_policies.sql` — anonymize leads/clients + pg_cron
- [ ] `20260625000003_team_mgmt_compliance.sql` — hard delete grace + MFA toggle + per-user audit
- [ ] `20260625000004_breach_response.sql` — security_incidents + failed_login_attempts
- [ ] `pg_cron` extension enabled (or manual cron runner set up)
- [ ] `select public.run_retention_job();` executes without error

## C. Environment variables

- [ ] `SUPABASE_SERVICE_ROLE_KEY` set (server only — never in client bundle)
- [ ] `SUPABASE_URL` set
- [ ] `VITE_SUPABASE_ANON_KEY` set (client)
- [ ] `RESEND_API_KEY` set
- [ ] `GEMINI_API_KEY` set (optional — AI features)
- [ ] `OLLAMA_URL` set if using remote Ollama (else loopback default)
- [ ] `AI_REDACT_PII` **unset or `1`** (NOT `0` in production)
- [ ] `STRIPE_*` + `PAYPAL_*` per-org stored encrypted in `payment_provider_secrets`
- [ ] `TWILIO_*` set
- [ ] `UPSTASH_REDIS_*` set (rate limiter — falls back to in-memory if not)
- [ ] No secrets hardcoded in source (`git grep -iE "sk_|pk_|AKIA" src/ server/`)

## D. Network security

- [ ] HTTPS enforced at the edge (Vercel / Cloudflare / Nginx)
- [ ] HSTS preload list submitted (optional but recommended)
- [ ] CSP tightened — no `'unsafe-inline'` outside dev build
- [ ] CORS allowlist configured in `server/index.ts`
- [ ] Rate limit Redis (Upstash) configured in production
- [ ] WAF / DDoS protection at CDN level

## E. Authentication & access

- [ ] MFA available and enforced for Owner/Admin roles
- [ ] Password reset flow tested end-to-end
- [ ] Invitation expiry = 48h (`server/routes/invitations.ts`)
- [ ] Force-logout by admin tested (`POST /api/team/:id/force-logout`)
- [ ] Session timeout configured on the client

## F. Data subject rights (DSR)

- [ ] `GET /api/dsr/export/me` returns a valid JSON for a test user
- [ ] `POST /api/dsr/erase/client/:id` with `{confirm:"ERASE"}` anonymizes a test client
- [ ] `POST /api/dsr/request` records a DSAR with 30-day SLA
- [ ] DPO has a process to triage `dsar_requests` weekly
- [ ] `/account/privacy` page accessible and functional
- [ ] Cookie banner appears on first visit, refuses as easily as accepts, re-prompts after 13 months

## G. Retention

- [ ] Retention schedule in `docs/legal/data_retention_policy.md` matches actual behavior
- [ ] `pg_cron` job `lume_retention_job` scheduled and has run at least once
- [ ] `audit_events` TTL = 3 years (1095 days)
- [ ] Inactive leads get anonymized at 24 months
- [ ] Soft-deleted clients get anonymized at 180 days
- [ ] Invoices/payments kept 10 years (no purge)

## H. Breach response

- [ ] `docs/legal/breach_response_plan.md` reviewed by DPO
- [ ] 24/7 on-call rotation documented (not in repo)
- [ ] `POST /api/incidents/failed-login` wired from login error handler
- [ ] `GET /api/incidents/anomalies` runs daily OR alerts piped to admin
- [ ] CAI / OPC / CNIL notification templates filled in
- [ ] Annual tabletop exercise scheduled

## I. Legal documents

- [ ] `/privacy` page reviewed + signed by counsel
- [ ] `/terms` page reviewed + signed by counsel
- [ ] `/subprocessors` page published
- [ ] `docs/legal/dpa_template.md` ready to send on request
- [ ] Cookie policy visible at `/privacy` and `/account/privacy`
- [ ] All template placeholders replaced (`[COMPANY LEGAL NAME]`, `[STREET ADDRESS]`, etc.)

## J. Monitoring & tests

- [ ] `npx vitest run tests/compliance` passes (16/16)
- [ ] Cross-tenant RLS test passes on staging (see `tests/compliance/README.md`)
- [ ] Supabase logs monitored (failed auth, RLS denials)
- [ ] Error tracking (Sentry or equivalent) installed
- [ ] Uptime monitor on `/api/health` and landing page

## K. Sub-processor management

- [ ] 30-day notification process for new subprocessors documented
- [ ] Subscription to subprocessor breach notifications (Supabase, Stripe, Twilio, Resend)

## L. Go-live

- [ ] Legal counsel final review
- [ ] DPO sign-off
- [ ] CTO / Engineering lead sign-off
- [ ] Date: __________   Signature: __________
