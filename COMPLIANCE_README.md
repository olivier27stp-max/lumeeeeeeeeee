# Compliance — Guide équipe

> Point d'entrée unique pour comprendre le dispositif de conformité (Loi 25 / LPRPDE / RGPD / CCPA) livré dans Lume CRM.
> Dernière mise à jour : 2026-04-21.

## TL;DR — où trouver quoi

| Besoin | Document |
|---|---|
| État de conformité + gaps | [`compliance_audit.md`](compliance_audit.md) |
| Politique de rétention | [`docs/legal/data_retention_policy.md`](docs/legal/data_retention_policy.md) |
| Plan de réponse aux incidents | [`docs/legal/breach_response_plan.md`](docs/legal/breach_response_plan.md) |
| Template DPA (B2B) | [`docs/legal/dpa_template.md`](docs/legal/dpa_template.md) |
| Politique cookies | [`docs/legal/cookie_policy.md`](docs/legal/cookie_policy.md) |
| Liste sous-traitants | [`docs/legal/subprocessor_list.md`](docs/legal/subprocessor_list.md) + `/subprocessors` |
| ROPA (RGPD art. 30) | [`docs/compliance/ropa.md`](docs/compliance/ropa.md) |
| Checklist pré-prod | [`compliance_checklist.md`](compliance_checklist.md) |
| Tests de conformité | [`tests/compliance/`](tests/compliance/) |

## Responsabilités

| Rôle | Owner | Tâches |
|---|---|---|
| DPO (responsable protection RP) | `privacy@lumecrm.ca` (à désigner) | Triage DSAR, sign-off politique, contact régulateurs |
| Incident Commander (astreinte) | Rotation docs interne | Phase détection → containment (voir breach plan §2) |
| Legal | `legal@lumecrm.ca` | Validation templates, DPAs enterprise |
| Platform / DevOps | Eng. lead | pg_cron, Supabase, environment variables |
| Security | Eng. lead | Revue vulnérabilités, rotation secrets |

## Architecture compliance

```
┌─────────────────────────┐
│ UI consentement          │ CookieBanner + /account/privacy + /privacy + /terms + /subprocessors
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Endpoints DSR + incident │ /api/dsr/*, /api/team/*/compliance, /api/incidents/*
└────────┬────────────────┘
         │ service_role (bypass RLS, re-check via verify_org_access)
         ▼
┌──────────────────────────────────┐
│ RPCs SECURITY DEFINER              │ anonymize_*, export_*_data, record_consent,
│                                    │ create_incident, request_hard_delete_member
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│ Tables                            │ consents, dsar_requests, security_incidents,
│                                    │ incident_timeline, failed_login_attempts
│ + RLS existantes renforcées        │ contacts.org_id NOT NULL
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│ pg_cron                            │ lume_purge_audit_events (03:15 UTC)
│                                    │ lume_retention_job (04:00 UTC)
└──────────────────────────────────┘
         │
         ▼ côté externe
┌──────────────────────────────────┐
│ Gate IA                            │ server/lib/pii-redaction.ts (Gemini + Ollama remote)
└──────────────────────────────────┘
```

## Workflows type

### Un client demande à supprimer son compte

1. Il clique "Request account deletion" sur `/account/privacy`
2. `POST /api/dsr/request` crée une entrée dans `dsar_requests` (SLA 30j)
3. DPO voit la demande dans la queue (table `dsar_requests`)
4. Validation + identité vérifiée → admin appelle `POST /api/dsr/erase/client/:id` avec `{confirm:"ERASE"}`
5. `anonymize_client` RPC — PII remplacée par `ANONYMIZED`, `audit_events` écrit
6. DPO marque `dsar_requests.status = 'completed'` + `completed_at = now()`

### Un employé quitte l'entreprise

1. Admin va sur la page TeamMemberDetails
2. Clique "Request permanent deletion", choisit un collègue à qui réassigner les leads/jobs
3. `POST /api/team/:memberId/request-delete` avec `{reassign_to, confirm:"DELETE"}`
4. `request_hard_delete_member` RPC : réassignation immédiate + `deletion_scheduled_at = now() + 30d` + suspension membership
5. Pendant 30j l'admin peut annuler via `POST /api/team/:memberId/cancel-delete`
6. Au jour J+30, `execute_scheduled_member_deletions()` (via `run_retention_job`) supprime réellement la ligne

### Incident de confidentialité

1. Alerte auto (`detect_login_anomalies`) OU user-report
2. IC ouvre `POST /api/incidents` → status 'detected'
3. Triage, containment, assessment (1h → 4h → 24h)
4. Si risque sérieux : notification CAI via template `breach_response_plan.md §4.1`
5. Timestamp `cai_notified_at` + description dans `incident_timeline`
6. Post-mortem + `lessons_learned` → `status = 'closed'`

## Commandes utiles

```bash
# Tests compliance
npx vitest run tests/compliance

# Typecheck
npx tsc --noEmit

# Exécuter retention manuellement (dev)
# Dans SQL Editor Supabase :
#   select public.run_retention_job();

# Simuler un échec login (dev)
# curl -X POST http://localhost:3002/api/incidents/failed-login \
#   -H "Content-Type: application/json" -d '{"email":"test@x.com"}'
```

## Variables d'environnement sensibles

```bash
# Serveur uniquement
SUPABASE_URL=                       # obligatoire
SUPABASE_SERVICE_ROLE_KEY=          # obligatoire (bypass RLS)
AI_REDACT_PII=1                     # 1 = actif (défaut). Ne JAMAIS mettre 0 en prod.
RESEND_API_KEY=
GEMINI_API_KEY=                     # optionnel
OLLAMA_URL=                         # défaut localhost → pas de redaction

# Client
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## Gaps encore ouverts (à adresser hors compliance technique)

- **DPO désigné + joignable** (Loi 25 art. 3.1) — placeholder `privacy@lumecrm.ca`
- **EFVP** (Évaluation des facteurs relatifs à la vie privée) pour hébergement US-East — à rédiger
- **Templates légaux validés par un avocat** — tous les `.md` sous `docs/legal/` sont des templates

## Versions des documents publiés

| Document | Version | Lieu |
|---|---|---|
| Privacy policy | `privacy-policy-2026-04-21` | `src/pages/Privacy.tsx` + `src/lib/consentApi.ts` |
| Terms of service | `tos-2026-04-21` | `src/pages/Terms.tsx` |
| Cookie policy | `cookie-policy-2026-04-21` | `src/components/CookieBanner.tsx` |
| Retention policy | `retention-policy-2026-04-21` | `docs/legal/data_retention_policy.md` |
| Breach plan | `breach-plan-2026-04-21` | `docs/legal/breach_response_plan.md` |
| DPA template | `dpa-2026-04-21` | `docs/legal/dpa_template.md` |
| Subprocessor list | `subprocessors-2026-04-21` | `src/pages/Subprocessors.tsx` + `docs/legal/subprocessor_list.md` |
| ROPA | `ropa-2026-04-21` | `docs/compliance/ropa.md` |

**Bumper la version du document à chaque changement substantiel** (cela déclenche automatiquement la re-collecte du consentement côté utilisateur).

## Disclaimer

> Ce dispositif technique ne remplace pas une consultation juridique spécialisée. Avant mise en production, faire valider par un DPO et un conseil juridique dans chaque juridiction ciblée.
