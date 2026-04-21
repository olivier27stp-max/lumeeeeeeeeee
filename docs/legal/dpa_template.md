# Data Processing Agreement (DPA) — Template

**Version:** `dpa-2026-04-21`
**Parties:** [CUSTOMER LEGAL NAME] ("Controller") and [LUME CRM LEGAL ENTITY] ("Processor")

> ⚠️ Template — must be customized per customer and validated by legal counsel. Provided on request to enterprise customers. Not binding until signed.

## 1. Purpose

This DPA forms part of the Lume CRM Subscription Agreement between the Parties and governs Processor's processing of personal data on behalf of Controller under GDPR, PIPEDA, and Québec Law 25.

## 2. Definitions

- **Personal data** as defined in GDPR art. 4(1) / Law 25 "renseignements personnels" / PIPEDA "personal information".
- **Processing** as defined in GDPR art. 4(2).
- **Data subject**, **controller**, **processor**, **subprocessor** as defined in GDPR.

## 3. Subject matter, duration, nature

- **Subject:** operation of the Lume CRM software-as-a-service.
- **Duration:** for the term of the Subscription Agreement plus the deletion period per §13.
- **Nature:** collection, storage, organization, retrieval, consultation, use, alignment, combination, restriction, erasure.
- **Purpose:** customer relationship management activities initiated by the Controller.

## 4. Categories of data and data subjects

- **Data subjects:** Controller's users (employees), Controller's customers and leads (natural persons).
- **Data categories:** identity (name), contact (email, phone, postal address), professional (title, company), business-transaction (job descriptions, invoice amounts), audit/log (IP, user agent, actions), communication (SMS / email content).
- **Special categories (GDPR art. 9):** not knowingly processed. Controller agrees not to upload special-category data without prior agreement.

## 5. Processor obligations

Processor shall:

1. Process personal data only on documented instructions from Controller, including transfers to third countries, unless required by law.
2. Ensure persons authorized to process personal data have committed to confidentiality.
3. Implement the technical and organizational measures described in Annex A.
4. Engage subprocessors only under the conditions of §8.
5. Assist Controller in fulfilling data-subject requests (export, erasure, rectification).
6. Assist Controller with DPIA and security audits.
7. Notify Controller without undue delay and at most **48 hours** after becoming aware of a personal data breach.
8. Make available to Controller all information necessary to demonstrate compliance and allow audits on reasonable notice.
9. At the end of the service, delete or return personal data per §13.

## 6. Controller obligations

Controller shall:

1. Have a lawful basis for the processing and provide accurate information notices to data subjects.
2. Not upload special-category data or data of children under 13 without prior agreement.
3. Configure the service in accordance with its internal policies (retention, access control, MFA).

## 7. Confidentiality

Processor personnel with access to personal data are bound by confidentiality agreements of at least equivalent duration as this DPA.

## 8. Subprocessors

- Controller consents to the subprocessors listed at `https://[domain]/subprocessors`.
- Processor gives at least **30 days' notice** before adding new subprocessors processing personal data. Controller may object in writing; if unresolved, Controller may terminate the affected portion of the service without penalty.
- Each subprocessor is bound by obligations materially equivalent to this DPA.

## 9. International transfers

Primary storage is in the United States. Transfers to third countries outside the EEA / Canada rely on:
- **GDPR:** Standard Contractual Clauses (2021) and supplementary measures.
- **Law 25 (Québec):** Privacy Impact Assessment on file per art. 17.

## 10. Security measures

Annex A (non-exhaustive):
- Encryption at rest (AES-256, KMS managed keys)
- Encryption in transit (TLS 1.3)
- Row-Level Security on all tenant tables
- Role-based access control (RBAC) + optional MFA enforcement
- Rate limiting on sensitive endpoints
- Audit logging with 3-year retention
- Cyclical backups (30-day rolling) with annual restore test
- Security headers (HSTS, CSP, COOP/CORP, Permissions-Policy)
- Vulnerability monitoring + patching

## 11. Data-subject requests

Processor assists Controller in responding to data-subject requests by:
- Providing machine-readable export (`/api/dsr/export/client/:id`)
- Performing anonymization on request (`/api/dsr/erase/client/:id`)
- Providing consent records from the `consents` journal

## 12. Breach notification

Notification triggers follow the Breach Response Plan (`docs/legal/breach_response_plan.md`). Processor notifies Controller within 48 hours of awareness and provides the information required by GDPR art. 33(3).

## 13. End of processing

Upon termination, Processor:
- Stops all processing not required for transition or legal retention.
- On Controller's written request within 30 days, exports all tenant data in JSON + CSV.
- Anonymizes or deletes remaining personal data within 90 days, except data that must be retained by law (e.g. invoices — 10 years).

## 14. Liability

Each Party's liability under this DPA is subject to the limitations of the Subscription Agreement.

## 15. Governing law

Québec, Canada (supplemented by GDPR for EU data subjects).

---

**Signed**

Controller: ______________________ Date: __________

Processor: ______________________ Date: __________
