# AI Guidelines — Lume CRM

## First Steps for Every Session
1. Read `CLAUDE.md` — understand the stack, ports, and conventions
2. Read the specific file(s) mentioned by the user before making changes
3. If a bug is reported, identify the file and function before writing any code

## Prompt Workflow
```
User reports bug / requests feature
    ↓
Read CLAUDE.md (if new session)
    ↓
Identify affected file(s) — ask if unclear
    ↓
Read the file(s)
    ↓
Write minimal patch (Edit tool, not full Write)
    ↓
Confirm fix — do not scan unrelated code
```

## Token-Saving Rules
- Do NOT paste file contents back to the user — they can see their own files
- Do NOT read files that are irrelevant to the task
- Do NOT run broad directory scans unless the user asks to explore the codebase
- Do NOT re-explain what you read — go straight to the action
- Use `Grep` and `Glob` for targeted searches instead of reading entire files

## Code Modification Rules
- **Always use `Edit` tool** (patch) — not `Write` (full rewrite) unless creating a new file
- Only touch the lines that need changing
- Do not reformat, rename variables, or add comments to untouched code
- Do not add features beyond what was asked

## Common Gotchas in This Project

### API Proxy
- Vite proxies `/api/*` to `API_PORT` (default 3002)
- If API calls silently fail, check that `API_PORT=3002` is in `.env.local` and Vite was restarted

### Soft Deletes & RLS
- Supabase RLS can silently block UPDATE queries (0 rows affected, no error)
- If a delete "works" but records come back on reload, the update didn't persist
- Use `getServiceClient()` (service_role) on the server for admin operations
- The server endpoint `POST /api/deals/soft-delete` exists for deal deletion that bypasses RLS

### Zod Validation
- `z.string().optional()` rejects `null` — use `.nullable()` for fields that receive `null`
- All server route schemas are in `server/lib/validation.ts`

### Pipeline Stages
- `PIPELINE_STAGES` is defined in `src/lib/pipelineApi.ts` — source of truth
- The `grouped` map in `Pipeline.tsx` must use `PIPELINE_STAGES` dynamically — never hardcode stage names

### i18n
- All user-facing strings must use `t.*` keys
- New strings: add to both `src/i18n/en.ts` and `src/i18n/fr.ts`

### Server vs Client Supabase
- `src/lib/supabase.ts` — anon key, used in frontend — subject to RLS
- `server/lib/supabase.ts` → `getServiceClient()` — service_role, bypasses RLS — server only

## What NOT to Do
- Do not suggest adding Redux, Zustand, or any state manager — project uses local state intentionally
- Do not suggest migrating to Next.js — project is a Vite SPA by design
- Schema reference is `supabase/SCHEMA_SNAPSHOT.md` (généré depuis la prod). `complete_schema.sql` a été supprimé (périmé, dérive prouvée) — ne pas le recréer
- Do not add `console.log` in production code
- Do not skip Zod validation on new server routes
- Do not hard-delete database rows
- Do not push to remote git without explicit user request
