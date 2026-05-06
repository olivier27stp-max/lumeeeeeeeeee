# CLAUDE.md — Lume CRM

## Project
**Lume CRM** — Production SaaS CRM for service businesses. Multi-tenant, org-scoped, built with Vite + React + Express + Supabase.

## Stack
- **Frontend**: React 19 (SPA), Vite, TypeScript, TailwindCSS, React Router v6, Framer Motion, `@dnd-kit`
- **Backend**: Node.js Express server (`server/`) running on port 3002
- **Database**: Supabase (PostgreSQL + Auth + Storage + Realtime)
- **Payments**: Stripe + PayPal
- **SMS**: Twilio
- **Email**: Resend
- **i18n**: Custom (`src/i18n/` — `en.ts` + `fr.ts`)
- **AI**: Claude API via orchestrator (`src/lib/ai/`)

## Key Ports
- Vite dev server: `5173`
- Express API: `3002` — **set `API_PORT=3002` in `.env.local` so Vite proxy works**

## Project Structure
```
src/
  pages/          # One file per route/page
  components/     # Shared UI components
  lib/            # API clients (*Api.ts) + utilities
  lib/ai/         # AI orchestrator, tools, memory
  contexts/       # React contexts (JobModal, Calendar)
  hooks/          # Custom React hooks
  i18n/           # Translations (en/fr)
  types.ts        # Shared TypeScript types

server/
  index.ts        # Express app entry point
  routes/         # Route handlers (leads, payments, emails, etc.)
  lib/            # Server utilities (supabase, validation, helpers)

supabase/
  migrations/     # SQL migrations
  complete_schema.sql  # Full schema reference
```

## Database Patterns
- All tables use `org_id uuid` for multi-tenancy
- Soft deletes via `deleted_at timestamptz` — never hard delete
- Views `leads_active`, `clients_active` filter `WHERE deleted_at IS NULL`
- RLS on every table — policies check `has_org_membership(auth.uid(), org_id)`
- Sensitive operations use `SECURITY DEFINER` RPCs or `service_role` client
- **`getServiceClient()`** in `server/lib/supabase.ts` bypasses RLS — use for admin ops

## Coding Rules
- Read the file before editing it
- Return minimal patches — never rewrite full files
- Do not touch unrelated modules
- TypeScript strict — no `any` unless existing pattern uses it
- All API calls go through `src/lib/*Api.ts` files — never fetch directly from pages
- Server routes validate input with Zod schemas in `server/lib/validation.ts`
- Zod `nullable()` required for fields that can receive `null` from clients

## AI Behavior
- Always read `CLAUDE.md` first
- Read the specific file(s) before modifying
- Ask for clarification if the affected file is unclear
- Do not scan the whole repo unless explicitly asked
- See `docs/ai-guidelines.md` for full workflow
