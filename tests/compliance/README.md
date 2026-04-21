# Compliance Test Suite

Tests for the compliance features delivered in Blocs 1–6.

## What's covered here (pure-logic tests, no DB)

- **pii-redaction.test.ts** — validates `server/lib/pii-redaction.ts` (Gemini/Ollama gate)
- **consent-storage.test.ts** — validates 13-month re-consent + policy version invalidation

Run:

```bash
npx vitest run tests/compliance
```

## What's NOT covered here — requires a test Supabase instance

The following need real RLS / RPC / cron to be meaningful. Provision a staging DB, then run them:

| Area | Test target |
|---|---|
| Cross-tenant RLS | query tables from org-A with org-B JWT → expect empty result or 403 |
| `contacts.org_id NOT NULL` | insert with `org_id = null` → expect failure |
| DSR `anonymize_client` | call as non-admin → expect `'Only org admin/owner can anonymize'` |
| DSR `export_user_data` | cross-user export by non-admin → expect `'Not authorized'` |
| Retention `anonymize_inactive_leads(24)` | seed old lead, run, assert `first_name='ANONYMIZED'` |
| Hard delete grace | `request_hard_delete_member` → assert `memberships.status='suspended'` + scheduled_at set |
| Failed login anomaly | insert 10 rows → `detect_login_anomalies(15)` returns brute_force_email row |
| `audit_events` TTL | seed row dated > 3y, run `purge_old_audit_events(1095)` → gone |

Template (Supabase JS + vitest):

```ts
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_KEY!);
// ... call RPC as specific user via db.auth.admin.createUser + signInWithPassword
```

## CI integration

Add to `.github/workflows/*.yml`:

```yaml
- name: Compliance unit tests
  run: npx vitest run tests/compliance --reporter=default
```
