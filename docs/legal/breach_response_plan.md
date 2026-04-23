# Breach Response Plan — Lume CRM

**Version:** `breach-plan-2026-04-22`
**Last updated:** 2026-04-22

## 1. Purpose

This plan defines how Lume CRM detects, contains, assesses, notifies, and recovers from a confidentiality incident, meeting:

- **Québec — Law 25 art. 3.5, 3.7, 3.8** — register, notification of "incident causing a risk of serious injury" to the *Commission d'accès à l'information* (CAI) and affected persons.
- **Canada federal — PIPEDA s. 10.1 / Breach of Security Safeguards Regulations** — notification to the OPC and affected persons if "real risk of significant harm".
- **GDPR art. 33–34** — notification to the supervisory authority within **72 hours** and to data subjects if "high risk".

## 2. Roles

| Role | Responsibility |
|---|---|
| **Incident Commander (IC)** | Decides on severity, coordinates response, owns communications |
| **DPO** | Legal assessment, notification drafting, regulator contact |
| **Security Engineer** | Technical triage, containment, forensics |
| **Product Lead** | Customer communications, in-product notices |

### 2.1 Primary on-call contact (24/7)

| Rôle | Nom | Courriel | Téléphone |
|---|---|---|---|
| DPO / Incident Commander (cumule les rôles pendant la phase beta) | William Hébert | willhebert30@gmail.com | +1 819-817-9526 |

En phase beta (entreprise individuelle), William Hébert cumule les rôles d'Incident Commander, de DPO et de Security Engineer. Toute personne détectant un incident potentiel doit immédiatement appeler le **819-817-9526** ou écrire à **willhebert30@gmail.com** avec `[SECURITY INCIDENT]` en objet.

Les escalades et extensions de l'équipe (délégation formelle des rôles) seront documentées ici dès que l'entreprise sera incorporée ou dès l'embauche d'un·e collaborateur·rice permanent·e.

## 3. Workflow

```
DETECTION → TRIAGE → CONTAINMENT → ASSESSMENT → NOTIFICATION → RECOVERY → POST-MORTEM
```

### 3.1 Detection

- Automatic: `/api/incidents/anomalies` flags brute-force login activity (via `detect_login_anomalies()` RPC).
- User report: customer, employee, third party.
- Internal audit: unusual audit_events pattern, log review.

**Action:** open a `security_incidents` row via `POST /api/incidents` or `create_incident()` RPC. Severity: initial estimate.

### 3.2 Triage (within 1 hour of detection)

- IC assigns Incident Commander + security engineer.
- Verify the incident is real (not a false positive).
- Classify scope: type, data categories, estimated # affected users/records.
- Update `status = 'triaging'`.

### 3.3 Containment (within 4 hours)

- Revoke compromised credentials (`POST /api/team/:id/force-logout`, rotate API keys).
- Block source IPs at WAF level.
- Isolate affected tables / turn off affected features with a feature flag.
- Snapshot logs, database state, relevant evidence. Write to `incident_timeline`.
- Update `status = 'contained'`.

### 3.4 Risk assessment

The DPO (or delegate) evaluates whether the incident presents a **"risque sérieux"** (Law 25) / **"real risk of significant harm"** (PIPEDA) / **"high risk"** (GDPR), considering:

- Sensitivity of data (identity, financial, health > behavioral > aggregate)
- Number of persons affected
- Likelihood of misuse
- Ease of identifying persons
- Mitigating factors (data was encrypted, quickly contained, etc.)

Document in `security_incidents.risk_serious` + `risk_rationale`.

### 3.5 Notification

| Trigger | Who | Deadline | Method |
|---|---|---|---|
| Any incident with `risk_serious = true` and a Québec data subject | CAI Québec | Without unjustified delay | Form CAI: <https://www.cai.gouv.qc.ca> |
| Any incident with "real risk of significant harm" and Canadian data subject | OPC federal | As soon as feasible | Form OPC: <https://www.priv.gc.ca/en/report-a-concern/report-a-privacy-breach-at-your-organization/> |
| EU data subjects affected and high risk | Relevant EU supervisory authority (CNIL in FR, etc.) | **72 hours** | CNIL form or equivalent |
| Individuals whose data is at risk | Affected persons | Without unjustified delay (Law 25) / ASAP (PIPEDA) / "undue delay" (GDPR) | Email / in-product banner / postal mail |
| Internal | Executive, legal, customers' DPO (B2B), insurer | Within 24h | Email + Slack |

Record each notification timestamp in the corresponding column (`cai_notified_at`, `opc_notified_at`, `cnil_notified_at`, `affected_notified_at`).

### 3.6 Recovery

- Restore from backups if data was altered/destroyed.
- Patch root cause (code fix, access revocation, config change).
- Increase monitoring on affected component for 30 days.
- Update `status = 'closed'`, set `resolved_at`.

### 3.7 Post-mortem (within 2 weeks)

- Written blameless post-mortem — 1-pager: what happened, timeline, impact, root cause, lessons, follow-ups.
- Save to `security_incidents.lessons_learned`.
- Track follow-up actions in the regular sprint backlog.

## 4. Templates

### 4.1 — Notification to CAI (Québec)

```
Objet : Déclaration d'incident de confidentialité — [ENTITY LEGAL NAME]

Madame, Monsieur,

Conformément à l'article 3.5 de la Loi sur la protection des renseignements
personnels dans le secteur privé (RLRQ, c. P-39.1), [ENTITY] déclare par la
présente un incident de confidentialité à risque sérieux.

Nature de l'incident : [type]
Date de survenance (ou période) : [dates]
Date de détection : [date]
Renseignements personnels visés : [catégories]
Nombre de personnes concernées (estimation) : [n]
Circonstances : [récit bref]
Mesures prises pour atténuer le préjudice : [liste]
Mesures pour éviter la répétition : [liste]
Nombre de personnes notifiées + date prévue : [n / date]
Coordonnées du responsable de la protection des renseignements personnels :
  Nom : [DPO]
  Courriel : willhebert30@gmail.com
  Téléphone : [tel]

[Signature — nom, titre, date]
```

### 4.2 — Notification to OPC (Canada)

Use the OPC PIPEDA Breach Report form. Equivalent fields.

### 4.3 — Notification to CNIL / EU SA (for EU subjects)

Use the CNIL online "notification de violation de données" form. GDPR art. 33(3) fields:

- Nature of the breach (categories + approximate numbers)
- Name and contact details of DPO
- Likely consequences
- Measures taken or proposed

### 4.4 — Notification to affected persons (email)

```
Subject: Important: a security incident affecting your account

Hello [first name],

We are writing to inform you of a confidentiality incident that may have
affected your personal data held in [PRODUCT NAME] on or around [date].

What happened
[Plain language, 2–3 sentences.]

What information was involved
[List categories: name, email, phone, address, etc.]

What we are doing
[Containment + remediation actions.]

What you can do
[Concrete steps: change password, monitor account, watch for phishing, etc.]

For more information
Email: willhebert30@gmail.com
Website: https://[domain]/privacy

You may also file a complaint with:
- Commission d'accès à l'information du Québec — https://www.cai.gouv.qc.ca
- Office of the Privacy Commissioner of Canada — https://www.priv.gc.ca

We are sorry for this incident and the concern it may cause.

[Signer — name, title]
```

## 5. Register (Law 25 art. 3.8)

All incidents — whether they trigger notification or not — are logged in
`public.security_incidents`. The register is retained for at least 2 years
after the last incident entry.

## 6. Testing

Run a tabletop exercise **annually**, based on a scenario drawn from the
threat model. Findings feed back into this plan.

## 7. Change log

- **2026-04-21** — Initial template (Bloc 6 compliance delivery).
