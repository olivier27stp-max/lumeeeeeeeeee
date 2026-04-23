# Data Retention Policy — Lume CRM

**Version:** `retention-policy-2026-04-21`
**Last updated:** 2026-04-21

> ⚠️ Template document — must be reviewed and validated by legal counsel before production use (Québec Law 25, PIPEDA, GDPR, CCPA).

## 1. Purpose

This policy defines how long Lume CRM retains personal and business data, when it is anonymized, and when it is deleted. It implements the "storage limitation" principle of GDPR art. 5(1)(e), PIPEDA principle 4.5, and Québec Law 25 art. 23.

## 2. Retention schedule

| Data category | Retention | Mechanism | Basis |
|---|---|---|---|
| **Active user account data** (profile, memberships) | For the duration of the service | — | Contract |
| **Active leads** (not marked `ANONYMIZED`) | Until 24 months without any update | Anonymized in place via `anonymize_inactive_leads()` | Data minimization |
| **Active clients** | For the duration of the contract | — | Contract, accounting |
| **Soft-deleted clients** (`deleted_at IS NOT NULL`) | 180 days, then PII anonymized | `anonymize_old_soft_deleted_clients()` | Grace period for recovery |
| **Invoices & payments** | **10 years** from issue date | No purge | Canadian tax law, consumer protection |
| **Audit logs** (`audit_events`) | 3 years | `purge_old_audit_events(1095)` | Security baseline |
| **Portal tokens** (revoked) | 30 days | `purge_expired_portal_tokens()` | Operational |
| **Portal tokens** (expired, not revoked) | 180 days | same | Operational |
| **SMS opt-outs** | Retained indefinitely while organization is active | — | CASL compliance — must be honored permanently |
| **Cookie consent records** (`consents`) | Retained while subject exists (immutable journal) | — | Audit trail for proof of consent |
| **DSAR requests** (completed) | 6 years | Manual review | Evidence of compliance obligations |
| **Marketing emails/SMS** | While consent is active | Deleted on withdrawal | Explicit consent |
| **Backups** | 30 days rolling | Supabase platform | Disaster recovery |

## 3. Anonymization vs deletion

Lume CRM prefers **anonymization** (tombstone pattern) over hard deletion when:
- The record is referenced by other records (FK constraints: invoices → clients)
- The record contributes to aggregate statistics (conversion rate, lead source)
- Full deletion would compromise accounting/audit trails

Anonymization replaces PII (`first_name`, `email`, `phone`, `address`) with the sentinel value `ANONYMIZED` or `NULL`, and writes an entry to `audit_events` with `action = 'anonymize'`.

Hard deletion is available via DSR on explicit user request (`POST /api/dsr/erase/*`) and cascades through the database.

## 4. Automated jobs

| Job name | Schedule (UTC) | RPC called |
|---|---|---|
| `lume_purge_audit_events` | `15 3 * * *` (daily 03:15) | `purge_old_audit_events(1095)` |
| `lume_retention_job` | `0 4 * * *` (daily 04:00) | `run_retention_job()` |

The `run_retention_job()` RPC wraps the 4 retention tasks and writes a single `audit_events` entry with the counters.

## 5. Manual invocation

An org admin may trigger retention on demand:

```sql
select public.run_retention_job();
```

Returns:
```json
{
  "anonymized_leads": 12,
  "anonymized_clients": 3,
  "purged_portal_tokens": 47,
  "purged_audit_events": 0
}
```

## 6. Exceptions

- **Legal hold:** If data is subject to litigation or regulatory investigation, retention is suspended for the concerned records until the hold is lifted. This must be documented in the incident register.
- **Invoice data retention (10 years)** cannot be shortened unilaterally. If a data subject requests erasure of invoice data, we anonymize PII but retain the invoice record itself with a tombstone.

## 7. Review

This policy is reviewed annually or upon material change in applicable law. The next review is scheduled for **2027-04-21**.

## 8. Contact

Data Protection Officer: `willhebert30@gmail.com`
