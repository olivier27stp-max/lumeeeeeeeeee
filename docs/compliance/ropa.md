# Record of Processing Activities (ROPA)

**Version:** `ropa-2026-04-21`
**Last updated:** 2026-04-21

> ⚠️ Template — internal document maintained by the DPO. Required by GDPR art. 30 and equivalent under Law 25 (inventaire).

## 1. Controller / DPO contact

- Controller: **[COMPANY LEGAL NAME]**, Québec, Canada
- DPO: `privacy@lumecrm.ca`

## 2. Processing activities — as Controller (Lume CRM's own operations)

### 2.1 Customer relationship management (core SaaS)

| Field | Value |
|---|---|
| Purpose | Deliver Lume CRM service to paying organizations |
| Legal basis | Contract (GDPR art. 6(1)(b)) |
| Data categories | Identity, contact, business, audit |
| Data subjects | Customer admins/employees, their end-customers |
| Recipients | Subprocessors listed in `subprocessor_list.md` |
| International transfers | USA (Supabase) — see Privacy Policy §7 |
| Retention | Per `data_retention_policy.md` |
| Security | See DPA Annex A |

### 2.2 Billing & accounting

| Field | Value |
|---|---|
| Purpose | Invoice customers, process payments, tax reporting |
| Legal basis | Contract + legal obligation (tax) |
| Data | Billing contact, payment method tokens (via Stripe), amounts |
| Recipients | Stripe, PayPal, tax authorities |
| Retention | 10 years |

### 2.3 Marketing (prospects)

| Field | Value |
|---|---|
| Purpose | Inform prospects about product updates |
| Legal basis | Consent (GDPR art. 6(1)(a)) — double opt-in |
| Data | Email, name, company |
| Recipients | Resend |
| Retention | Until unsubscribe; max 2 years after last engagement |

### 2.4 Security monitoring & incident response

| Field | Value |
|---|---|
| Purpose | Detect fraud, respond to incidents |
| Legal basis | Legitimate interest (GDPR art. 6(1)(f)) |
| Data | IP, user-agent, login events, `audit_events` |
| Retention | 3 years for audit logs, 90 days for failed login attempts |

### 2.5 HR (internal Lume employees)

| Field | Value |
|---|---|
| Purpose | Employment administration |
| Legal basis | Contract |
| Data | Employee identity, payroll, performance |
| Retention | Per Québec employment standards (6 years after termination) |

## 3. Processing activities — as Processor (on behalf of customer orgs)

Single activity: processing customer-uploaded data within the CRM.
Governed by the DPA (`dpa_template.md`). The customer (Controller) determines purpose and legal basis; Lume (Processor) acts on their instructions.

## 4. Data flow diagram

```
[end-user browser]
   │ HTTPS (TLS 1.3)
   ▼
[Vercel edge + Vite SPA]
   │
   ▼
[Express API (Node.js)] ─── Twilio, Resend, Stripe, PayPal, Gemini (PII redaction gate)
   │
   ▼
[Supabase PostgreSQL + Auth + Storage (US-east-1)]
   │
   ▼
[AWS backups — 30d rolling]
```

## 5. Rights requests log

See `dsar_requests` table (internal). Response SLA: 30 days.

## 6. Review schedule

Annual review by the DPO. Next review: **2027-04-21**.
