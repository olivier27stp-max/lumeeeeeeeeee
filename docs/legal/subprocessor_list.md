# Subprocessor List — Lume CRM

**Version:** `subprocessors-2026-04-21`
**Last updated:** 2026-04-21

> ⚠️ Template — customer-facing document. Validate with legal counsel before publishing at `/subprocessors`.

Lume CRM engages the following subprocessors to deliver the service. Each is bound by a Data Processing Agreement (DPA) and is subject to equivalent data protection obligations.

We notify customers **at least 30 days** before adding a new subprocessor that processes personal data.

## Current subprocessors

| Subprocessor | Role | Data processed | Hosting region | DPA reference |
|---|---|---|---|---|
| **Supabase Inc.** | Managed PostgreSQL, Auth, Storage, Realtime | All tenant data (identity, contact, business, audit logs) | AWS us-east-1 (USA) | [supabase.com/dpa](https://supabase.com/dpa) |
| **Stripe Inc.** | Card & bank payment processing (Stripe Connect) | Cardholder data (tokenized), email, amounts, business identity for Connect | Global (primary: USA) | [stripe.com/legal/dpa](https://stripe.com/legal/dpa) |
| **PayPal Holdings** | Alternative payment processing | Buyer email, amounts, order details | Global (primary: USA & Luxembourg) | [paypal.com/us/legalhub/privacy-full](https://www.paypal.com/us/legalhub/privacy-full) |
| **Twilio Inc.** | Outbound/inbound SMS, phone number provisioning | Phone numbers, SMS content | USA | [twilio.com/legal/data-protection-addendum](https://www.twilio.com/legal/data-protection-addendum) |
| **Resend** | Transactional email delivery | Recipient email address, email content, attachments | USA (AWS) | [resend.com/legal/dpa](https://resend.com/legal/dpa) |
| **Google LLC (Maps Platform)** | Address geocoding for job sites | Postal addresses | Global | [cloud.google.com/terms/data-processing-addendum](https://cloud.google.com/terms/data-processing-addendum) |
| **Google LLC (Gemini API)** | AI assistant, content generation | Prompt text (PII redacted via `server/lib/pii-redaction.ts`) | Global | Same as above |
| **Upstash** (optional) | Redis rate-limit cache | Auth-token suffix hashes, IP hashes (no PII) | Global | [upstash.com/dpa](https://upstash.com/dpa) |

## International data transfers

Primary data storage is in **AWS us-east-1 (USA)**. For Québec data subjects, we perform a Privacy Impact Assessment (Law 25 art. 17) before any new transfer. For EU data subjects, transfers are covered by Standard Contractual Clauses.

## Customer notifications

Changes to this list are announced by email to the billing contact of each organization at least 30 days before taking effect. Customers may object to a new subprocessor in writing; we will discuss in good faith and, if no agreement is reached, the customer may terminate the affected portions of the service.

## Contact

Questions about subprocessors: `privacy@lumecrm.ca`.
