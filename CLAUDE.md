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
  SCHEMA_SNAPSHOT.md   # Full schema reference (généré depuis la prod — SEULE source fiable)
```

## Database Patterns
- All tables use `org_id uuid` for multi-tenancy
- Soft deletes via `deleted_at timestamptz` — never hard delete
- Views `leads_active`, `clients_active` filter `WHERE deleted_at IS NULL`
- RLS on every table — policies check `has_org_membership(auth.uid(), org_id)`
- Sensitive operations use `SECURITY DEFINER` RPCs or `service_role` client
- **`getServiceClient()`** in `server/lib/supabase.ts` bypasses RLS — use for admin ops

## Environments & Migration Workflow
- **Two Supabase projects**: prod `bbzcuzqfgsdvjsymfwmr` (CRM) + staging `boylnjjlhexljmddmjyg` (schema mirror, fake data only). Local dev (`.env.local`) points to **staging** — never point local at prod.
- **Every schema change** = a SQL file in `supabase/migrations/`, applied **staging first, prod second**:
  1. `npm run db:apply -- supabase/migrations/<file>.sql` → applies to staging
  2. Test locally against staging
  3. `npm run db:apply:prod -- supabase/migrations/<file>.sql` → applies to prod
- **Never** change schema via the Supabase dashboard on either project — it silently desyncs the two.
- `npm run db:diff` compares prod vs staging schemas (needs Docker) and reports any drift.
- **`supabase/baseline/`** is the source of truth to create a NEW environment — the 400 files in `supabase/migrations/` do **not** rebuild the DB from scratch (incomplete history; replaying them on an empty DB fails at the 2nd file). `npm run db:bootstrap` applies the baseline. Validated 2026-08-03 by replaying it on a virgin PostgreSQL 17: 199 tables, 11 views, 306 functions, 537 policies, zero errors. Regenerate it after any structural change — see `supabase/baseline/README.md`. Run it when in doubt, or after someone else deployed.
- **`npm run db:clone-staging`** re-clones the schema from prod onto staging in one command (destructive for staging DATA only; prod is read-only, and a guard refuses to run if the target ref equals prod). It **empties** the `public` schema instead of dropping it — a `drop schema public` destroys the `supabase_admin`-owned DEFAULT PRIVILEGES, which **cannot be recreated** by `postgres` nor by the Management API (42501). Always finishes with `npm run db:sync-acl`: a fresh project grants ALL privileges to `authenticated` on new tables, and a dump can only ADD grants, never revoke them.
- **Local clone (`../supabase-local-clone`)**: `npm run db:refresh-local` re-clones prod → local Docker stack **and anonymizes it** in one command. Prod is read-only throughout (pg_dump + GET only). Two things the standard procedure misses: (1) `supabase link`/`db pull` **write** to the remote (they create the `supabase_migrations` history) — never use them under a read-only constraint; (2) storage **files are not in any SQL dump** — only their `storage.objects` rows are. Without `scripts/sync-storage-files.py` the clone shows 60 metadata rows pointing at nothing: broken images that *look* present.
- **Never keep un-anonymized client data locally.** `npm run db:anonymize-local` replaces 130 PII columns across 62 tables (names, emails, phones, addresses, IPs, tax ids, birth dates, free-text notes) with deterministic fakes derived from row **ids** — so identities stay unique AND denormalized copies (`jobs.client_name`, `invoices.*_snapshot`) are re-derived to match their source. Volumes, relations, amounts and dates are untouched. All accounts get the password `DevLocal1234!`.
- **Zero accepted delta**: staging is the development reference, so prod and staging must be STRICTLY identical — schema, function bodies, policies, triggers, event triggers, buckets, realtime publication, cron jobs, extensions. `db:diff` tolerates nothing.

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

## ⚠️ Coordination DB & anti-dérive (LEÇONS CRITIQUES)
**Le vrai risque de ce projet, c'est la DÉRIVE : plusieurs agents/sessions modifient le même code + la même prod en parallèle, et la prod finit par ne plus correspondre à la source.** Bugs réels déjà causés : fonctions référençant une table `leads` supprimée (cassées ~1 mois sans détection), `search_global` figée sur une vieille version. Règles :

1. **Une seule main à la fois sur le schéma/les fonctions DB.** L'UI isolée peut paralléliser ; les changements DB, non. Avant de toucher la DB, s'assurer qu'aucune autre session ne le fait.
2. **JAMAIS de SQL appliqué directement à la prod hors du pipeline de migration.** Tout passe par `supabase/migrations/`. (Le script `scripts/deploy-functions.mjs`, qui redéployait un schéma périmé, a été supprimé pour cette raison — ne pas le recréer.)
3. **Référence de schéma = `supabase/SCHEMA_SNAPSHOT.md`** (généré depuis la prod). `complete_schema.sql` a été supprimé (périmé). Ne pas le recréer.
4. **En supprimant une table/colonne/fonction : grep d'abord** les fonctions/triggers/migrations/code pour les références (`pg_get_functiondef`, `grep -r`). Une référence orpheline plante silencieusement.
5. **Après TOUTE modif DB, lancer** `npm run check:broken-objects` + `npm run check:db-coherence`. Ils attrapent la dérive (c'est ainsi que les 2 bugs `leads` ont été trouvés).
5b. **`npm run check:schema-refs` — à lancer AVANT de chercher un bug à la main.** Croise chaque colonne, valeur CHECK et argument RPC cité par le code avec le catalogue réel de la base. Rappel : avec PostgREST, **une seule colonne inexistante fait échouer TOUTE la requête**, et comme supabase-js ne lève jamais d'exception, la fonctionnalité meurt en silence. C'est ce détecteur qui a trouvé, d'un coup, que les jobs récurrents n'étaient jamais créés, que la gamification terrain était morte, que démarrer une pause échouait et que l'onboarding de facturation perdait toutes les données saisies. Faux positifs vérifiés → `scripts/schema-refs-allowlist.json` (avec justification obligatoire). Ajouter `-- --prod` pour cibler la prod.
6. **Push via git worktree isolé** (`git worktree add --detach <tmp> origin/main`, commit là, `git push origin HEAD:main` avec rebase-retry). Les sessions parallèles font dériver le checkout principal — un `add`/`commit` classique peut se faire rafler.
7. **Secrets** : `SUPABASE_ACCESS_TOKEN` et compagnie vont dans `.env.local` (gitignoré) UNIQUEMENT, jamais dans le chat, un commit, ou une commande hardcodée.
