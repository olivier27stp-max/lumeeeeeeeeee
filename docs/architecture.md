# Architecture — Lume CRM

## Overview
Single-tenant-per-org SaaS. One Supabase project shared across all orgs, isolated by `org_id` + RLS. Frontend is a React SPA, backend is a standalone Express server.

```
Browser (React SPA :5173)
    │
    ├── Supabase JS client  ──► Supabase (Postgres + Auth + Storage + Realtime)
    │
    └── /api/* (Vite proxy) ──► Express server (:3002)
                                    └── Supabase service_role client (bypasses RLS)
```

## Frontend (React SPA)
- Entry: `src/main.tsx` → `src/App.tsx`
- Routing: React Router v6, all routes defined in `App.tsx`
- Auth: Supabase Auth; session stored in browser, injected into all API calls
- State: local `useState`/`useMemo` per page — no global state manager (no Redux/Zustand)
- Data fetching: `src/lib/*Api.ts` files call Supabase directly OR proxy through `/api/*`
- i18n: `useTranslation()` hook, keys defined in `src/i18n/en.ts` and `fr.ts`
- UI: TailwindCSS utility classes + custom CSS variables in `src/index.css`

## Backend (Express :3002)
- Entry: `server/index.ts`
- All routes mounted under `/api`
- Request validation: Zod schemas in `server/lib/validation.ts`
- Auth: `requireAuthedClient()` extracts Bearer token → builds user-scoped Supabase client
- Admin ops: `getServiceClient()` → service_role key, bypasses RLS
- Automation: event-driven engine (`server/lib/automationEngine.ts`) + cron scheduler (`server/lib/scheduler.ts`)

## Supabase Usage
| Layer | Client | Usage |
|---|---|---|
| Frontend | `src/lib/supabase.ts` (anon key) | SELECT, user-scoped mutations |
| Server routes | `buildSupabaseWithAuth(token)` | Mutations on behalf of user |
| Server admin | `getServiceClient()` (service_role) | Bypasses RLS — deletions, migrations |

## Data Flow Example (Delete Deal)
1. User clicks Delete in `Pipeline.tsx`
2. `serverDeleteDeal(dealId)` in `pipelineApi.ts` → `POST /api/deals/soft-delete`
3. Server validates auth → calls `getServiceClient()` → updates `pipeline_deals.deleted_at`
4. Response → frontend removes deal from state → calls `load()` to refetch

## Vite Proxy
Requests to `/api/*` are proxied from `:5173` to `:3002`.
`API_PORT` in `.env.local` controls the target port (must match `server/index.ts`).

## Automation Engine
- Listens to Supabase Realtime events
- Triggers defined in `pipeline_deals` stage changes, invoice events, etc.
- Actions: SMS (Twilio), Email (Resend), Slack notifications
- Presets in `server/lib/presets/`

## Integrations
- **Stripe**: webhooks at `/api/webhooks/stripe`, raw body required (mounted before JSON middleware)
- **PayPal**: `server/lib/paypalClient.ts`
- **QuickBooks**: `server/lib/integrations/providers/quickbooks.ts`
- **Twilio**: SMS sending via `server/routes/messages.ts`
- **Slack**: `server/lib/integrations/providers/slack.ts`
