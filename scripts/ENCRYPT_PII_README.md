# PII Encryption Migration Guide

## Status
- [x] Encryption key generated and added to `.env.local`
- [x] 8 clients encrypted (email, phone, address)
- [ ] 4 leads need constraint fix first

## Step 1: Fix the email constraint (30 seconds)

Go to: https://supabase.com/dashboard/project/bbzcuzqfgsdvjsymfwmr/sql/new

Paste and run:

```sql
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_email_format_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_email_format_check
  CHECK (email IS NULL OR email ~ '^enc:' OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
```

## Step 2: Encrypt leads (10 seconds)

```bash
npx tsx scripts/migrate-encrypt-pii.ts
```

Expected output: 4 leads encrypted, 0 errors.

## Step 3: Verify

```bash
npx tsx scripts/migrate-encrypt-pii.ts --dry-run
```

Expected: 0 to encrypt (all already encrypted).

## Key Rotation

If you ever need to rotate the PII key:
1. Set `PII_ENCRYPTION_KEY` to the new key
2. Set `PII_ENCRYPTION_KEY_PREVIOUS` to the old key (not yet supported — add to pii-crypto.ts)
3. Run the migration script again — it will re-encrypt with the new key
