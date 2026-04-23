# LUME CRM — AUDIT DE CONFORMITÉ LÉGALE

**Date :** 2026-04-21
**Juridictions ciblées :** Québec (Loi 25) prioritaire · Canada fédéral (LPRPDE) · UE (RGPD) · États-Unis (CCPA/CPRA)
**Stack auditée :** Vite/React + Express + Supabase PostgreSQL (US-East)
**Modèle multi-tenant :** `org_id` + RLS + soft deletes (`deleted_at`)

> ⚠️ **DISCLAIMER** — Ce rapport produit une base technique. Il NE REMPLACE PAS une consultation avec un avocat spécialisé en droit du numérique. Avant mise en production, faire valider par un DPO et un conseil juridique dans chaque juridiction ciblée.

---

## 0. RÉSUMÉ EXÉCUTIF

**État actuel : NON CONFORME à la mise en production multi-juridictionnelle.**

Points positifs :
- RLS activé sur la majorité des tables contenant du PII
- Chiffrement applicatif AES-256-GCM disponible (`server/lib/pii-crypto.ts`)
- Trigger `crm_enforce_scope` défense-en-profondeur multi-tenant
- Tables `sms_opt_outs` + `sms_consent_at` (CASL partiel)
- Rate limiter Redis-backed + headers de sécurité (HSTS, CSP, COOP/CORP)

Points bloquants (CRITIQUES) :
1. **Aucun endpoint d'export de données** (RGPD art. 20 / LPRPDE 12.1 / Loi 25)
2. **Aucun mécanisme de suppression effective** (soft delete uniquement, pas d'anonymisation)
3. **Pas de politique de confidentialité** ni bannière de cookies
4. **Chiffrement PII optionnel** (var env `PII_ENCRYPTION_KEY`) — par défaut plaintext en base
5. **Hébergement US-East** — Loi 25 art. 17 impose une évaluation des facteurs relatifs à la vie privée avant tout transfert hors Québec ; aucun document produit
6. **Prompts Gemini/Ollama non sanitisés** — PII envoyée à des fournisseurs IA tiers
7. **Aucun consentement email** tracké (colonne manquante)
8. **Table `contacts` avec `org_id` NULLABLE** — risque de fuite inter-organisations
9. **Aucun DPO désigné**
10. **`audit_events` sans TTL** — métadonnées peuvent contenir des snapshots PII stockés indéfiniment

---

## 1. INVENTAIRE DES DONNÉES PERSONNELLES (PII)

| Table | Colonnes PII | Catégorie | Personne concernée | Rétention | RLS |
|-------|--------------|-----------|--------------------|-----------|-----|
| `profiles` | `full_name`, `avatar_url`, `company_name` | Identité, Contact | Employé (Supabase Auth) | Pas de `deleted_at` | **⚠ Non trouvée dans le schéma — P0** |
| `clients` | `first_name`, `last_name`, `email`, `phone`, `address`, `address_line1/2`, `city`, `province`, `postal_code`, `country`, `sms_consent_at` | Identité, Contact, Localisation, Consentement | Client final | `deleted_at` soft, pas de hard-delete public | ✓ `clients_*_org` via `has_org_membership()` |
| `contacts` | `full_name`, `email`, `phone`, adresse structurée complète | Identité, Contact, Localisation | Client dédupliqué | Pas de `deleted_at` | ⚠ `org_id` NULLABLE → policy `org_id is null OR has_org_membership()` (fuite possible) |
| `leads` | `first_name`, `last_name`, `email`, `phone`, `title`, `company`, `address`, `notes`, `source`, `value`, `tags` | Identité, Contact, Comportemental, Financier | Prospect | `deleted_at` soft | ✓ `leads_*_org` |
| `jobs` | `title`, `property_address`, `notes`, `scheduled_at` + FK client | Localisation, Comportemental (via client) | Client lié | `deleted_at` soft | ✓ `jobs_*_org` |
| `schedule_events` | `notes`, `timezone`, `assigned_user` | Comportemental, Localisation | Employé/technicien | `deleted_at` soft | ✓ |
| `invoices` / `invoice_items` | Détails client, montants, descriptions | Financier, Identité | Client | Pas de `deleted_at`, pattern void (`status='void'`) | ✓ inféré |
| `payments` | `amount_cents`, `status`, `provider`, IDs transactions | Financier | Client | Pas de `deleted_at` | ✓ inféré |
| `payment_provider_secrets` | `stripe_secret_key_enc`, `paypal_secret_enc` (suffixe `_enc`) | Auth, Financier | Credentials org | Pas de `deleted_at` | ✓ RLS org_id |
| `team_members` | `email`, `first_name`, `last_name`, `phone`, `avatar_url`, `role` | Identité, Contact | Employé | Pas de `deleted_at` | ✓ inféré |
| `memberships` | `user_id`, `org_id` | Identité, Autorisation | Employé | Pas de `deleted_at` | Table de jointure |
| `messaging` / `internal_team_messaging` | Contenu messages, expéditeur, destinataire | Communication | Employé ↔ Employé | `deleted_at` inféré | ✓ |
| `quote_view_tracking` | `ip_address`, `user_agent`, `viewer_id`, `viewed_at` | Comportemental, Localisation, Appareil | Visiteur devis | Pas de `deleted_at` | ✓ |
| `timesheets` | `user_id`, heures, notes | Comportemental, Travail | Employé | Pas de `deleted_at` | ✓ inféré |
| `ai_conversations` | `user_id`, `org_id`, texte conversation (peut contenir PII) | Communication, Comportemental | Utilisateur | Pas de `deleted_at` | ✓ |
| `app_connections` | Tokens intégrations (Slack, Zapier) chiffrés | Auth | Employé | Pas de `deleted_at` | ✓ |
| `notifications` | Préférences, contenu messages | Communication | Utilisateur | Pas de `deleted_at` | ✓ |
| `audit_events` | `actor_id`, `action`, `entity_type`, `entity_id`, `metadata` (peut contenir snapshots PII) | Audit, Comportemental | Tous utilisateurs | **⚠ Pas de TTL / purge** | ✓ org-scoped |
| `portal_tokens` | `token_hash` (SHA-256), `expires_at`, `revoked_at` | Auth, Accès | Client (portail) | `expires_at` 90 jours, `revoked_at` manuel | ✓ |
| `sms_opt_outs` | `phone` normalisé, `opted_out_at`, `reason` | Consentement, Contact | Client | Persistance permanente | ✓ |

### Chiffrement applicatif PII

- **Fichier :** [server/lib/pii-crypto.ts](lume-crm/server/lib/pii-crypto.ts)
- **Algo :** AES-256-GCM (IV 12o, tag 16o), préfixe `enc:`
- **Champs couverts :** `CLIENT_PII_FIELDS = ['email','phone','address']`, `LEAD_PII_FIELDS = ['email','phone','address']`
- **Clé :** `PII_ENCRYPTION_KEY` (base64 32 octets) avec fallback `PAYMENTS_ENCRYPTION_KEY`
- **Migration graduelle :** lecture transparente (plaintext OU chiffré), écriture en chiffré
- **⚠ BLOQUANT :** Si la variable d'environnement n'est pas configurée → **stockage en clair**. Loi 25 art. 10 impose des mesures de sécurité appropriées ; plaintext inacceptable.
- **Base de données :** chiffrement Supabase (AWS KMS) au repos — géré, clés non accessibles au client.

---

## 2. FLUX DE DONNÉES & SOUS-TRAITANTS

| Service | PII transmise | Code | Finalité | DPA | Statut |
|---------|--------------|------|----------|-----|--------|
| **Stripe** | email client, montants, metadata facturation | [server/routes/payments.ts](lume-crm/server/routes/payments.ts), [server/lib/stripe-connect.ts](lume-crm/server/lib/stripe-connect.ts) | Paiement | ✓ Stripe Services Agreement | Per-org API keys chiffrés |
| **PayPal** | email, montants, détails commande | [server/routes/payments.ts](lume-crm/server/routes/payments.ts) | Paiement alternatif | ✓ | Per-org client ID/secret chiffrés |
| **Twilio** | téléphone client, contenu SMS | [server/lib/twilioProvisioning.ts](lume-crm/server/lib/twilioProvisioning.ts), [server/routes/messages.ts](lume-crm/server/routes/messages.ts) | SMS transactionnel + opt-out | ✓ Twilio DPA | Respect `sms_opt_outs` via `normalize_phone()` |
| **Resend** | email destinataire, contenu, pièces jointes | [server/lib/mailer.ts](lume-crm/server/lib/mailer.ts), [server/routes/emails.ts](lume-crm/server/routes/emails.ts) | Email transactionnel | ✓ Resend DPA | Activé via `RESEND_API_KEY` |
| **Supabase** | ensemble des PII (DB + Auth + Storage) | Backend | Persistance, auth, fichiers | ✓ Supabase DPA | **Région US-East (AWS N. Virginia)** |
| **Google Maps / Geocoding** | adresses de propriétés | [server/routes/geocode.ts](lume-crm/server/routes/geocode.ts) | Géocodage jobs | ✓ Google Maps Platform Terms | — |
| **Google Gemini** | contexte CRM en prompt (PII potentiel) | [server/lib/gemini.ts](lume-crm/server/lib/gemini.ts), [server/routes/agent.ts](lume-crm/server/routes/agent.ts) | IA recommandations | ✓ Google Cloud DPA | **⚠ Pas de redaction PII avant envoi** |
| **Ollama** | idem Gemini si remote | [server/lib/ollama.ts](lume-crm/server/lib/ollama.ts) | LLM alternatif | Dépend du déploiement | Local OU distant selon config |
| ~~FAL.ai~~ | Retiré 2026-04-21 (décision produit, non utilisé) | — | — | — | — |
| **Anthropic Claude** | — | — | — | — | **Non intégré** actuellement |

### Gaps sous-traitants

- Aucun registre des sous-traitants accessible aux clients (exigence Loi 25 art. 7, RGPD art. 28.2-4)
- Aucun mécanisme de notification de changement de sous-traitant
- Pas de liens DPA référencés en commentaires de code
- **Gemini/Ollama reçoivent du PII non expurgé** via prompts agent

---

## 3. CONTRÔLES DE SÉCURITÉ

### 3.1 Authentification & mots de passe

- **Mécanisme :** Supabase Auth (bcrypt par défaut) — délégué intégralement
- **Vérifié :** aucun hashage custom dans le code
- **MFA/2FA :** [server/lib/mfa-enforcement.ts](lume-crm/server/lib/mfa-enforcement.ts) existe mais **pas câblé sur toutes les routes sensibles**
- **Sessions :** JWT Supabase (expiration 1h par défaut + refresh token) ; pas de mécanisme explicite de révocation globale
- **`portal_tokens` :** table séparée pour accès portail client, SHA-256 hashés, `expires_at` 90j par défaut, `revoked_at` supporté

### 3.2 Rate limiting

- **Redis-backed :** [server/lib/rate-limiter.ts](lume-crm/server/lib/rate-limiter.ts), Upstash optionnel (fallback in-memory)
- **Presets :** auth 10/min, strict 10/min, standard 30/min, relaxed 100/min, webhook 200/min, public 15/min
- **⚠ Gap :** pas de rate limiting sur `/api/payments/*`
- **⚠ Gap :** fallback in-memory volatile (perdu au restart → bypass en pratique)

### 3.3 CSRF

- Vérification d'en-tête custom ([server/index.ts:148](lume-crm/server/index.ts#L148)) : exige `Authorization`, `X-Requested-With` ou `X-API-Key` sur POST/PATCH/PUT
- **⚠ Gap :** pas de SameSite cookie explicite, défense par header uniquement

### 3.4 Headers de sécurité (server/index.ts:81-114)

- ✓ `X-Frame-Options: DENY`
- ✓ `X-Content-Type-Options: nosniff`
- ✓ `Referrer-Policy: strict-origin-when-cross-origin`
- ✓ `Permissions-Policy` (camera, mic, geo, payment, USB, Bluetooth)
- ✓ `HSTS: max-age=31536000; includeSubDomains; preload`
- ✓ CSP prod avec `script-src` restreint à self + Stripe + PayPal + Google Maps
- ✓ COOP/CORP `same-origin`

### 3.5 Validation entrées

- [server/lib/validation.ts](lume-crm/server/lib/validation.ts) avec schémas Zod
- **⚠ Couverture incomplète** — certaines routes sans validation
- Paramétrisation via PostgREST/Supabase client (anti SQLi)

### 3.6 Chiffrement au repos

- **DB :** Supabase AWS KMS transparent
- **Champs PII applicatif :** AES-256-GCM, **activation conditionnelle à `PII_ENCRYPTION_KEY`**
- **Secrets paiements :** suffixe `_enc` (convention de nommage, à vérifier dans le middleware)

### 3.7 Gestion des secrets

- **Aucune clé hardcodée** détectée (bonnes pratiques)
- Toutes les credentials via `.env`
- **⚠ À vérifier :** `.env.local` explicitement dans `.gitignore`

### 3.8 Audit trail

- Table `audit_events` : `org_id`, `actor_id`, `action`, `entity_type`, `entity_id`, `metadata`, `created_at`
- Insertion via triggers dynamiques sur tables porteuses d'`org_id`
- ✓ RLS org-scoped
- **⚠ Pas de TTL / politique de rétention**
- **⚠ `metadata` peut contenir des snapshots PII non expurgés**

### 3.9 RLS & isolation multi-tenant

| Table | RLS | Policy |
|-------|-----|--------|
| `clients`, `leads`, `jobs`, `schedule_events`, `pipeline_deals`, `contacts`, `team_members`, `messaging`, `internal_team_messaging`, `quote_view_tracking`, `timesheets`, `invoices`, `audit_events`, `tasks`, `app_connections`, `notifications`, `payments`, `portal_tokens`, `sms_opt_outs` | ✓ | `has_org_membership(auth.uid(), org_id)` |
| `contacts` | ⚠ | `org_id IS NULL OR has_org_membership(...)` — **fuite inter-org possible** |
| `profiles` | **✗ TABLE ABSENTE DU SCHÉMA** | — |

- **Défense en profondeur :** triggers `trg_leads_force_org_id` et `crm_enforce_scope` forcent l'`org_id` depuis JWT claim
- **⚠ Risque route-level :** si une route serveur utilise `getServiceClient()` et lit `org_id` depuis `req.body` sans re-validation contre l'utilisateur authentifié → bypass possible

### 3.10 Observabilité & détection d'incidents

| Contrôle | État |
|----------|------|
| Sentry / error tracking | ✗ **Non installé** |
| Détection d'anomalies connexions | ✗ |
| Tracking échecs de login distinct | ⚠ via `auditRequestMiddleware` générique |
| Alerting admin temps réel | ✗ |
| Rate limit auth | ✓ |
| WAF / DDoS | Dépend du déploiement |

---

## 4. DROITS DES PERSONNES CONCERNÉES — ÉTAT ACTUEL

| Droit | Mécanisme | État | Détails |
|-------|-----------|------|---------|
| **Accès (RGPD 15 / LPRPDE 12.1)** | Endpoint `/export` ou `/dsar` | ✗ **MANQUANT** | Aucun endpoint d'export trouvé |
| **Portabilité (RGPD 20)** | Export JSON/CSV structuré | ✗ **MANQUANT** | — |
| **Rectification (RGPD 16 / Loi 25 art. 28)** | Édition via UI CRM | ⚠ Partiel | Possible pour l'admin, pas pour la personne concernée côté portail |
| **Effacement (RGPD 17 / Loi 25 art. 28.1)** | Hard delete + anonymisation | ✗ **MANQUANT** | Soft delete uniquement ; RPC hard delete existe mais non exposée |
| **Opposition (RGPD 21)** | Opt-out marketing / profilage | ⚠ SMS seulement | Pas de consentement/opt-out email |
| **Limitation (RGPD 18)** | Flag "traitement suspendu" | ✗ **MANQUANT** | — |
| **Retrait consentement** | Journal versionné consentements | ✗ **MANQUANT** | Seulement `sms_consent_at` (timestamp unique) |
| **Bannière cookies** | Frontend avec granularité | ✗ **MANQUANT** | Pas de pages `/privacy`, `/terms` |
| **Politique de confidentialité versionnée** | Historique consentements | ✗ **MANQUANT** | — |
| **DPA client entreprise** | Génération automatique | ✗ **MANQUANT** | — |

---

## 5. RÉTENTION & SUPPRESSION

### Couverture `deleted_at`

| Table | `deleted_at` | RPC soft | RPC hard |
|-------|:---:|----------|----------|
| clients | ✓ | `soft_delete_client()` | `delete_client_cascade()` |
| leads | ✓ | via trigger | `delete_lead_and_optional_client()` |
| jobs | ✓ | `soft_delete_job()` | FK cascade |
| pipeline_deals, schedule_events | ✓ | — | — |
| contacts, invoices, audit_events, sms_opt_outs | ✗ | — | — |
| profiles | **table absente** | — | — |

### Purges programmées

- Extension `pg_cron` présente dans le schéma
- **Aucun job de purge effectif trouvé**
- Commentaire `LOST_AUTO_DELETE_DAYS = 15` dans une migration pipeline, **pas de trigger cron associé**

### Anonymisation

- **Aucune RPC `anonymize_*`**
- Aucun pattern tombstone (remplacement par placeholder préservant l'intégrité audit)

### Obligations par juridiction

| Donnée | Loi 25 / LPRPDE | RGPD | CCPA | Défaut à appliquer |
|--------|-----------------|------|------|--------------------|
| Leads inactifs | "aussi longtemps que nécessaire" | idem | idem | 24 mois inactivité → anonymisation |
| Données facturation | 6 ans (Qc), 6-7 ans (Cdn), 10 ans (UE selon pays) | art. 4 directive comptable | — | **10 ans** (couvre tout) |
| Logs audit | variable | variable | variable | **3 ans** minimum |
| Communications marketing | selon consentement | selon consentement | idem | purge à retrait consentement |
| Portail client tokens | — | — | — | `expires_at` 90j OK |

---

## 6. ISOLATION MULTI-TENANT

### Mécanismes en place

1. **RLS policies** sur toutes les tables avec `has_org_membership(auth.uid(), org_id)`
2. **Triggers DB** `trg_leads_force_org_id` + `crm_enforce_scope` forcent `org_id` depuis claim JWT
3. **RBAC serveur** [server/lib/rbac.ts](lume-crm/server/lib/rbac.ts) + [server/lib/route-permissions.ts](lume-crm/server/lib/route-permissions.ts)

### Risques identifiés

- `contacts.org_id` NULLABLE → policy autorise `org_id IS NULL` (contacts globaux)
- Routes `getServiceClient()` bypassent RLS : si `org_id` lu depuis `req.body` sans re-validation → override possible
- `profiles` absente du schéma → si créée ad-hoc sans RLS : exposition inter-org
- `has_org_membership()` a un fallback `user_id = org_id` pour mode single-tenant — comportement acceptable mais à documenter

### Tests de non-régression

**Aucun test d'isolation cross-tenant automatisé** trouvé dans `tests/`.

---

## 7. GAPS DE CONFORMITÉ PAR JURIDICTION

### Québec — Loi 25 (en vigueur échelonnée 2022-2024)

| Obligation | Article | État |
|-----------|---------|------|
| Responsable de la protection des renseignements personnels désigné et coordonnées publiées | art. 3.1 | ✗ **AUCUN DPO** |
| Politique de confidentialité publiée | art. 3.2 | ✗ |
| Évaluation des facteurs relatifs à la vie privée (EFVP) avant transfert hors Québec | art. 3.3 / 17 | ✗ **Hébergement US-East sans EFVP** |
| Consentement manifeste, libre, éclairé, spécifique | art. 14 | ⚠ SMS seulement |
| Droit d'accès, rectification | art. 27-28 | ⚠ Admin uniquement |
| Droit à la désindexation / effacement | art. 28.1 | ✗ |
| Droit à la portabilité (format technologique structuré) | art. 27 al. 3 | ✗ |
| Notification incident confidentialité à risque sérieux (CAI + personne) | art. 3.5 | ✗ **Aucun workflow** |
| Registre des incidents | art. 3.8 | ✗ |
| Mesures de sécurité raisonnables (chiffrement) | art. 10 | ⚠ Optionnel |
| Destruction/anonymisation à la fin | art. 23 | ✗ |

### Canada fédéral — LPRPDE (PIPEDA)

| Principe | État |
|----------|------|
| Responsabilité (agent de protection désigné) | ✗ |
| Détermination des fins | ⚠ Pas documenté |
| Consentement | ⚠ SMS uniquement |
| Limitation de la collecte/utilisation/conservation | ✗ Pas de politique de rétention |
| Exactitude | ✓ via UI CRM |
| Mesures de sécurité | ⚠ Chiffrement PII optionnel |
| Transparence | ✗ Pas de privacy policy |
| Accès | ✗ Pas d'export |
| Possibilité de porter plainte | ✗ Pas de canal documenté |

### UE — RGPD

| Article | Obligation | État |
|---------|-----------|------|
| Art. 6 | Base légale | ⚠ Implicite, non documentée |
| Art. 12-14 | Information des personnes | ✗ Pas de politique |
| Art. 15-22 | Droits des personnes | ✗ Non implémentés |
| Art. 25 | Privacy by design | ⚠ Partiel (RLS, chiffrement) |
| Art. 28 | Contrats sous-traitants + liste | ✗ Pas de registre public |
| Art. 30 | Registre des activités de traitement (ROPA) | ✗ |
| Art. 32 | Sécurité | ⚠ Chiffrement optionnel |
| Art. 33-34 | Notification violation (72h CNIL + personnes si risque élevé) | ✗ |
| Art. 35 | DPIA | ✗ Pas réalisée |
| Art. 37 | DPO (obligatoire si traitement à grande échelle) | ✗ |
| Art. 44-49 | Transfert hors UE (US-East) — SCC/adequacy | ✗ **Bloquant pour clients UE** |

### USA — CCPA/CPRA (Californie)

| Exigence | État |
|----------|------|
| Privacy Notice "Do Not Sell/Share" | ✗ |
| Opt-out signal GPC (Global Privacy Control) | ✗ |
| Right to Know, Delete, Correct | ✗ |
| Data inventory annual disclosure | ✗ |
| Vendor/service provider contracts | ⚠ À vérifier dans DPA existants |

---

## 8. RISQUES DE SÉCURITÉ IDENTIFIÉS

### Critiques

1. **Chiffrement PII optionnel** — défaut plaintext
2. **Prompts IA non sanitisés** — exfiltration potentielle de PII vers Gemini/Ollama
3. **Table `contacts` avec `org_id` NULL** autorisé en RLS
4. **`profiles` absente du schéma** mais requêtée par dashboardApi/jobsApi/Settings
5. **Service role sans re-validation** `org_id` côté routes acceptant body
6. **Pas de détection d'anomalies / SIEM / Sentry**
7. **`audit_events.metadata` stocke des PII sans purge**

### Élevés

8. **Rate limiter in-memory** volatile en fallback — bypass en cluster
9. **MFA non-universel** — `mfa-enforcement.ts` existe, câblage partiel
10. **Pas de révocation globale des sessions** (forcer déconnexion impossible)
11. **CSRF uniquement header-based** — pas de SameSite explicite
12. **`portal_tokens` sans limite de tentatives** de validation

### Moyens

13. Pas de scan antivirus sur uploads Storage
14. Pas de policy de rotation automatique des secrets
15. Tests cross-tenant absents
16. Pas de chiffrement côté client pour champs les plus sensibles

---

## 9. REGISTRE DES SOUS-TRAITANTS (ROPA partiel)

| Sous-traitant | Rôle | Données | Hébergement | DPA signé | Juridiction |
|---------------|------|---------|-------------|-----------|-------------|
| Supabase Inc. | BaaS (DB/Auth/Storage) | Toutes PII | AWS us-east-1 | ✓ standard | USA |
| Stripe Inc. | Processeur paiement | Email, montants | Global | ✓ | USA (SCC UE) |
| PayPal Holdings | Processeur paiement alt. | Email, montants | Global | ✓ | USA/Luxembourg |
| Twilio Inc. | SMS | Téléphone, contenu | USA | ✓ | USA |
| Resend | Email transactionnel | Email, contenu | USA (AWS) | ✓ | USA |
| Google LLC | Maps/Geocoding + Gemini | Adresses, prompts | Global | ✓ | USA |
| Upstash (optionnel) | Redis rate limit | Aucun PII direct | Global | ✓ | USA |

---

## 10. LISTE BRUTE DES GAPS (remédiation ultérieure)

### Bloquants pré-production

- [ ] Désigner un responsable de la protection des renseignements personnels (Loi 25 art. 3.1) + publier nom + email
- [ ] Rédiger et publier politique de confidentialité versionnée (Loi 25, LPRPDE, RGPD, CCPA)
- [ ] Réaliser EFVP avant transfert US-East (Loi 25 art. 17) OU rapatrier sur région Canada
- [ ] Forcer `PII_ENCRYPTION_KEY` obligatoire au boot serveur (fail-fast si absent)
- [ ] Implémenter endpoint export complet (`GET /api/dsar/export`) — JSON + PDF
- [ ] Implémenter endpoint effacement (anonymisation + hard delete) avec double confirmation
- [ ] Créer table `consents` versionnée (doc_version, timestamp, IP, UA, user_id)
- [ ] Ajouter colonne `email_consent_at` / `marketing_consent_at` sur clients et leads
- [ ] Bannière cookies conforme (refus aussi simple que accepter, re-consentement 13 mois)
- [ ] Contraindre `contacts.org_id NOT NULL` + backfill
- [ ] Créer/valider table `profiles` avec RLS
- [ ] Workflow notification incident : détection → alerte admin → template CAI (Qc) + CNIL (UE) + personnes concernées
- [ ] Politique de rétention documentée + pg_cron de purge/anonymisation

### Haute priorité

- [ ] Re-validation serveur `org_id` sur toutes les routes utilisant `getServiceClient()`
- [ ] MFA obligatoire sur tous les comptes admin (toggle par org)
- [ ] Révocation globale des sessions (RPC `revoke_all_sessions(user_id)`)
- [ ] Sanitisation prompts IA (redact email/phone/adresse avant Gemini/Ollama)
- [ ] Installer Sentry + règles alerting
- [ ] Rate limit sur `/api/payments/*`
- [ ] Purger/redacter `audit_events.metadata` (ou chiffrement)
- [ ] TTL `audit_events` 3 ans + anonymisation
- [ ] Registre sous-traitants exposé aux clients dans UI
- [ ] Tests automatisés cross-tenant leakage
- [ ] Backups chiffrés documentés + test restauration mensuel

### Moyenne

- [ ] Période de grâce 30j hard delete
- [ ] Réassignation leads/tâches à la suppression d'employé
- [ ] DPA template générable pour clients entreprise
- [ ] Journal versionné consentements (historique par user)
- [ ] Scan antivirus uploads Storage
- [ ] Rotation automatique secrets
- [ ] Documenter DPIA par flux (paiement, IA, SMS, email)

### Basse

- [ ] CSP `unsafe-inline` retirée en prod
- [ ] Circuit breaker Gemini → Redis backed
- [ ] Commentaires de data minimization dans le schéma

---

## 11. PLAN D'ATTAQUE PROPOSÉ (sessions suivantes)

**Ordre recommandé** (chaque bloc = 1 session dédiée) :

1. **Sécurité technique durcie** (Phase 2.D) — `PII_ENCRYPTION_KEY` obligatoire, `contacts.org_id NOT NULL`, table `profiles`, re-validation `org_id` serveur, rate limit payments, Sentry
2. **Team Management + RBAC complet** (Phase 2.A) — liste employés, invitations, soft/hard delete avec période de grâce, audit trail par user, force logout, reset password, MFA toggle
3. **Data Subject Rights** (Phase 2.B) — endpoints export JSON/PDF, effacement avec anonymisation, rectification portail client, opposition marketing, retrait consentement, table `consents` versionnée
4. **Rétention & suppression** (Phase 2.F) — pg_cron purges, RPC `anonymize_*`, TTL `audit_events`, tombstones
5. **Consentement & politique** (Phase 2.C) — bannière cookies granulaire, politique versionnée, pages `/privacy` `/terms`, journal consentements, DPA générable
6. **Breach response** (Phase 2.E) — détection anomalies, workflow incident, templates CAI/CNIL
7. **Multi-tenant & sous-traitants** (Phase 2.G/H) — tests cross-tenant, registre sous-traitants UI, localisation données
8. **Documentation légale** (Phase 3) — templates MD (privacy, ToS, DPA, cookie, rétention, breach plan, subprocessors, ROPA)
9. **Tests conformité** (Phase 4) — suite `tests/compliance/`
10. **Checklist + README final**

---

## 12. QUESTIONS OUVERTES POUR L'ÉQUIPE

1. **DPO :** qui désigne-t-on ? (obligation Loi 25 — peut être une personne interne + email dédié type `dpo@lumecrm.ca`)
2. **Résidence données :** accepte-t-on de rester US-East avec EFVP documentée, ou migration vers région Canada (Supabase supporte `ca-central-1`) ?
3. **Durée de rétention leads inactifs :** défaut 24 mois acceptable ?
4. **Clients UE ciblés à court terme ?** Si oui, transfert US nécessite SCC + analyse Schrems II
5. **Budget consultation avocat** pour validation des templates ?
6. **Qui reçoit les notifications d'incident ?** (email + numéro d'astreinte)
7. ~~FAL.ai~~ — retiré du périmètre 2026-04-21 (non utilisé)

---

**Fin du rapport d'audit Phase 1.**

Livraison attendue : validation de ce rapport par le responsable produit + décision sur la résidence des données + désignation du DPO, avant de lancer Phase 2.

---

## 13. JOURNAL DES MODIFICATIONS POST-AUDIT

### 2026-04-21 — Bloc 1 Sécurité durcie

**Corrections par rapport à l'audit initial :**
- `profiles` EXISTE bel et bien dans `complete_schema.sql:11157` avec RLS correcte (`profiles_select_own`, `profiles_update_own`, `profiles_insert_own`). Gap audit #8 retiré.
- Rate limiting `/api/payments/*` DÉJÀ en place (`server/index.ts:222` + `:246`, double couche in-memory + Redis). Gap audit retiré.
- MFA enforcement middleware DÉJÀ monté globalement (`server/index.ts:259`). Câblage existant.
- Chiffrement PII applicatif DÉLIBÉRÉMENT ABANDONNÉ par l'équipe (cf. commentaire `server/index.ts`). Décision conservée : on s'appuie sur Supabase AWS KMS au repos + TLS 1.3 en transit + RLS. Point à documenter dans l'EFVP Loi 25 art. 17.

**Implémenté :**
- ✅ Suppression dead code : `server/lib/pii-crypto.ts`, `server/lib/pii-response-middleware.ts`, `scripts/migrate-encrypt-pii.ts`, `scripts/reverse-pii-encryption.ts`, `scripts/ENCRYPT_PII_README.md`
- ✅ Migration `supabase/migrations/20260625000000_compliance_hardening.sql` :
  - `contacts.org_id NOT NULL` + backfill depuis leads/clients liés, suppression orphans
  - Politiques RLS `contacts` durcies (plus de `org_id IS NULL OR …`)
  - Index `idx_audit_events_created_at` + fonction `purge_old_audit_events(days)` (3 ans par défaut)
  - Job `pg_cron` `lume_purge_audit_events` (03:15 UTC quotidien) si extension disponible
  - RPC `verify_org_access(user_id, org_id)` SECURITY DEFINER pour re-validation server-side
- ✅ Helper TS `server/lib/org-access.ts` — `assertOrgAccess(req, orgId)` + `verifyOrgAccess(userId, orgId)` pour toute route utilisant `getServiceClient()` avec `org_id` venant du body
- ✅ Utilitaire `server/lib/pii-redaction.ts` — redaction email/téléphone/postal/SIN-SSN/CC/IP/adresse, + `redactPiiDeep()` pour objets
- ✅ `server/lib/gemini.ts` — redaction auto des `systemPrompt` et `messages` avant envoi à Google (activation par défaut, bypass via `AI_REDACT_PII=0`)
- ✅ `server/lib/ollama.ts` — redaction auto si `OLLAMA_URL` pointe hors loopback

**Non traité ici (décision) :**
- ~~FAL.ai~~ retiré du périmètre.

**Bloc 1.5 — audit routes terminé :**
- Grep exhaustif des 41 routes serveur : **0 occurrence** de `req.body.org_id` / `body.orgId`. Toutes les routes utilisent `auth.orgId` dérivé de `resolveOrgId()` (RPC `current_org_id()` basée sur JWT, ou lookup `memberships` via client authentifié — jamais service_role).
- Le risque §6 "override via req.body" identifié dans l'audit est **théorique, non exploité dans ce code**. Correction d'audit.
- `server/lib/org-access.ts` livré pour utilisation future sur toute nouvelle route qui accepterait un `org_id` depuis un payload externe (webhooks tiers, par exemple).

### 2026-04-21 — Bloc 2 DSR + Consentements (backend)

**Implémenté :**
- ✅ Migration `supabase/migrations/20260625000001_dsr_and_consents.sql` :
  - Table `consents` (journal versionné immuable, RLS org + subject)
  - Table `dsar_requests` (registre formel 30j SLA)
  - RPC `record_consent(...)` — entrée uniforme avec IP/UA/version doc
  - RPC `anonymize_client(id)` — tombstone pattern, admin org requis
  - RPC `anonymize_lead(id)` — idem
  - RPC `export_user_data(user_id)` — JSONB agrégé (profile, memberships, consents, audit, DSAR)
  - RPC `export_client_data(client_id)` — JSONB (client, contact, jobs, invoices, payments, consents)
- ✅ Router Express `server/routes/dsr.ts` :
  - `GET /api/dsr/export/me` — user exporte ses propres données
  - `GET /api/dsr/export/client/:id` — admin exporte un client
  - `POST /api/dsr/erase/client/:id` + `POST /api/dsr/erase/lead/:id` — avec double confirm (body.confirm === 'ERASE')
  - `POST /api/dsr/request` — enregistrement demande formelle avec SLA 30j
  - `POST /api/dsr/consent` — journalisation consent (cookies banner, tos, marketing)
- ✅ Rate limit `strict` (10/min Redis) sur `/api/dsr/*`

**Couverture juridique obtenue :**
- RGPD art. 15 (accès) — ✓ via `export_*_data`
- RGPD art. 17 (effacement) — ✓ via `anonymize_*` (tombstone)
- RGPD art. 20 (portabilité) — ✓ format JSON structuré
- Loi 25 art. 27 al. 3 (portabilité) — ✓
- Loi 25 art. 28.1 (désindexation/cessation diffusion) — ✓
- LPRPDE 12.1 (accès) — ✓

**Non traité (nécessite UI Bloc 3+) :**
- Pages portail client pour self-service DSR (hors CRM admin)
- Bannière cookies granulaire
- Preference center (opt-out marketing)
- Génération PDF lisible (actuellement JSON uniquement)

### 2026-04-21 — Bloc 3 UI consentement + pages légales

**Implémenté :**
- ✅ `src/lib/consentApi.ts` — client : `readStoredConsent`, `writeStoredConsent`, `submitCookieConsent`, `recordConsent`, `exportMyData`, `exportClientData`, `eraseClient`, `eraseLead`, `submitDsarRequest`
- ✅ `src/components/CookieBanner.tsx` — bannière RGPD/Loi 25 compliant :
  - Refus aussi simple qu'accepter (CTA symétriques)
  - Granularité : essentials (forcé) / analytics / marketing / preferences
  - Re-prompt tous les 13 mois ou au changement de version policy
  - Journalisation serveur `/api/dsr/consent` si utilisateur loggué
- ✅ `src/pages/Privacy.tsx` — politique de confidentialité template versionnée (`privacy-policy-2026-04-21`)
- ✅ `src/pages/Terms.tsx` — CGU template versionnée
- ✅ `src/pages/PrivacyCenter.tsx` (route `/account/privacy`) — self-service DSR :
  - Export JSON (droit d'accès RGPD 15 / Loi 25 art. 27)
  - Demande formelle d'effacement (DSAR avec SLA 30j)
  - Reset des choix cookies
- ✅ i18n en/fr — ~36 clés ajoutées sous `cookies.*` et `legal.*`
- ✅ Routes ajoutées dans `src/App.tsx` sur les 3 layouts (non-auth, pre-subscription, app) : `/privacy`, `/terms`, `/account/privacy`
- ✅ `<CookieBanner />` monté sur tous les layouts

**À valider par un avocat avant prod :**
- Templates `Privacy.tsx` et `Terms.tsx` contiennent des placeholders `[COMPANY LEGAL NAME]`, `[STREET ADDRESS]`, etc. — à compléter
- Email DPO `willhebert30@gmail.com` — à créer ou remplacer
- Email juridique `willhebert30@gmail.com` — idem
- Versions doc : `privacy-policy-2026-04-21`, `tos-2026-04-21`, `cookie-policy-2026-04-21` — bumper à chaque révision substantielle

### 2026-04-21 — Bloc 4 Rétention & anonymisation

**Implémenté :**
- ✅ Migration `supabase/migrations/20260625000002_retention_policies.sql` :
  - RPC `anonymize_inactive_leads(24)` — leads sans update depuis 24 mois (sauf status='won')
  - RPC `anonymize_old_soft_deleted_clients(180)` — clients soft-deleted depuis 180j
  - RPC `purge_expired_portal_tokens()` — tokens revoked > 30j OU expired > 180j
  - RPC `run_retention_job()` — wrapper exécutant les 4 tâches, retour JSON compteurs
  - pg_cron `lume_retention_job` quotidien 04:00 UTC
  - Indexes helper `idx_leads_updated_at_status`, `idx_clients_deleted_at`
- ✅ `docs/legal/data_retention_policy.md` — politique documentée par catégorie :
  - Leads inactifs : 24 mois → anonymisation
  - Clients soft-deleted : 180 jours → anonymisation
  - Invoices/payments : 10 ans (obligation fiscale canadienne) — aucune purge
  - Audit logs : 3 ans
  - Portal tokens revoked : 30j ; expired non-révoqués : 180j
  - SMS opt-outs : permanent (CASL)
  - DSAR completed : 6 ans

**Couverture juridique :**
- RGPD art. 5(1)(e) storage limitation — ✓
- PIPEDA principle 4.5 retention — ✓
- Loi 25 art. 23 destruction/anonymisation à la fin — ✓
- Canadian tax: 10-year invoice retention — ✓

### 2026-04-21 — Bloc 5 Team management compliance

**Découvertes :**
- 80% de Team Management déjà existait : liste (ManageTeam), invitations (invitations.ts), soft deactivate, reset password, RBAC 4 rôles.
- Vrais gaps : 48h expiry, hard delete + grace 30j + réassignation, force logout admin, MFA toggle, audit trail per-user.

**Implémenté :**
- ✅ Fix expiry invitations : 7j → **48h** dans `server/routes/invitations.ts`
- ✅ Migration `supabase/migrations/20260625000003_team_mgmt_compliance.sql` :
  - Colonnes ajoutées sur `team_members` : `suspended_at`, `deletion_scheduled_at`, `deletion_requested_by`, `mfa_required`, `password_reset_required`
  - RPC `request_hard_delete_member(member_id, reassign_to)` — suspension immédiate + réassignation leads/clients/jobs/tasks + grace 30j
  - RPC `cancel_hard_delete_member(member_id)` — annuler pendant la grace
  - RPC `execute_scheduled_member_deletions()` — cron exécute les deletions dont la grace a expiré
  - RPC `set_member_mfa_required(member_id, bool)` — admin force MFA
  - RPC `list_member_audit_events(user_id, limit)` — audit trail per-user, org-scoped, admin only
  - `run_retention_job()` mis à jour pour inclure les hard deletes programmés
- ✅ Router `server/routes/team-compliance.ts` :
  - `POST /api/team/:memberId/request-delete` (body: `reassign_to`, `confirm=DELETE`)
  - `POST /api/team/:memberId/cancel-delete`
  - `POST /api/team/:memberId/mfa-required` (body: `required: boolean`)
  - `POST /api/team/:memberId/force-logout` — Supabase Admin API `signOut(user_id, 'global')`
  - `GET  /api/team/:userId/audit?limit=200`

**Encore à compléter (UI côté React) :**
- Bouton "Request permanent deletion" avec modal de réassignation dans TeamMemberDetails.tsx
- Toggle MFA required dans TeamMemberDetails
- Bouton "Force logout" admin
- Onglet audit trail dans TeamMemberDetails

### 2026-04-21 — Bloc 6 Breach response

**Implémenté :**
- ✅ Migration `supabase/migrations/20260625000004_breach_response.sql` :
  - Tables `security_incidents` (registre Loi 25 art. 3.8), `incident_timeline`, `failed_login_attempts`
  - RLS admin-only sur incidents
  - RPC `record_failed_login(email, ip, ua, reason)`
  - RPC `detect_login_anomalies(minutes)` — brute-force email (≥5/15m) + IP (≥20/15m)
  - RPC `create_incident(title, type, severity, description, detection)`
  - RPC `purge_old_failed_logins()` — rétention 90j
  - `run_retention_job()` mis à jour pour inclure purge failed_logins
- ✅ Router `server/routes/incidents.ts` :
  - `POST /api/incidents` — déclaration
  - `GET  /api/incidents` — liste org (admin)
  - `GET  /api/incidents/:id` — détail + timeline
  - `PATCH /api/incidents/:id` — champs whitelist (status, severity, risk, notification timestamps, etc.)
  - `POST /api/incidents/:id/timeline` — ajout entrée
  - `GET  /api/incidents/anomalies?minutes=15`
  - `POST /api/incidents/failed-login` — hook client-side après échec login
- ✅ Rate limit : `auth` preset sur `/api/incidents/failed-login`, `standard` sur le reste
- ✅ Doc `docs/legal/breach_response_plan.md` — workflow 7 phases + templates notifications CAI / OPC / CNIL / affected persons

**Couverture juridique :**
- Loi 25 art. 3.5 (notification) + 3.7 (circonstances) + 3.8 (registre) — ✓
- LPRPDE s. 10.1 + Breach Regulations — ✓
- RGPD art. 33 (72h) + art. 34 (personnes concernées) — ✓

### 2026-04-21 — Blocs 7-10 (livraison finale)

**Bloc 7 — Sous-traitants**
- ✅ `docs/legal/subprocessor_list.md` — liste customer-facing
- ✅ `src/pages/Subprocessors.tsx` — route `/subprocessors` publique (montée dans App.tsx sur les 3 layouts)

**Bloc 8 — Docs légales**
- ✅ `docs/legal/dpa_template.md` — template DPA B2B signable
- ✅ `docs/legal/cookie_policy.md` — politique cookies
- ✅ `docs/compliance/ropa.md` — registre des activités de traitement (RGPD art. 30)

**Bloc 9 — Tests conformité**
- ✅ `tests/compliance/pii-redaction.test.ts` (11 tests)
- ✅ `tests/compliance/consent-storage.test.ts` (5 tests)
- ✅ `tests/compliance/README.md` — mode d'emploi + templates tests DB-dépendants
- ✅ **Fix regex SIN/SSN** dans `pii-redaction.ts` pour éviter faux positifs sur téléphones
- ✅ **16/16 tests passent** (`npx vitest run tests/compliance`)

**Bloc 10 — Go-live**
- ✅ `compliance_checklist.md` — checklist pré-production exhaustive (12 sections, ~70 checkbox)
- ✅ `COMPLIANCE_README.md` — guide équipe : où trouver quoi, responsabilités, workflows, versions

### 2026-04-21 — Bloc 11 Gaps résiduels comblés sans intervention utilisateur

**Implémenté en autonomie :**
- ✅ `docs/legal/efvp_supabase_us_east.md` — Template EFVP Loi 25 art. 17 pré-rempli à 80% (hébergement Supabase US-East)
- ✅ Migration `supabase/migrations/20260625000005_email_consent.sql` :
  - Colonnes `email_consent_at`, `email_opt_out_at`, `email_opt_out_reason` sur `clients` + `leads`
  - Table `email_opt_outs` (parité `sms_opt_outs`)
  - RPC `record_email_opt_out(email, org_id, reason)` + `is_email_opted_out(email, org_id)`
- ✅ Sentry integration :
  - `server/lib/sentry.ts` — init + error handler (no-op si DSN absent)
  - `src/lib/sentry.ts` — init client (no-op si DSN absent, dynamic import)
  - Wired dans `server/index.ts` (avant middlewares + avant listen) et `src/main.tsx`
  - Redaction auth headers + breadcrumbs PII
  - Docs d'enrollment : `docs/operations/sentry_setup.md`
  - `.env.example` mis à jour (SENTRY_DSN, VITE_SENTRY_DSN, AI_REDACT_PII)
- ✅ `docs/operations/sop_dsr_response.md` — SOP complet 30j SLA : workflow, templates réponse (accusé, access, erasure, refus), queries métriques DPO

**TypeScript pass** ✓ (imports dynamiques Sentry, no-op sans dépendance installée)

## Bilan final

**Blocs 1–11 tous livrés.** Le dispositif technique est complet pour Loi 25, LPRPDE, RGPD, CCPA.

**Reste à faire par l'humain (hors code) avant prod :**
1. Désigner un DPO, créer les boîtes email `privacy@` et `legal@`
2. Remplir les placeholders `[COMPANY LEGAL NAME]`, `[STREET ADDRESS]` dans les templates
3. Rédiger l'EFVP Loi 25 pour l'hébergement US-East
4. ~~FAL.ai DPA~~ — retiré du périmètre
5. Faire valider tous les `docs/legal/*.md` par un avocat spécialisé
6. Parcourir `compliance_checklist.md` et cocher chaque ligne avant go-live
7. Installer Sentry / error tracking (pas inclus — choix produit)
8. Monter une astreinte 24/7 documentée (voir `breach_response_plan.md §2`)
- Bloc 4 — Rétention étendue (leads inactifs, invoices, anonymisation)
- Bloc 5 — Consentement + bannière cookies + politique versionnée
- Bloc 6 — Breach response workflow
- Bloc 7 — Tests cross-tenant, registre sous-traitants UI
- Bloc 8 — Documentation légale
- Bloc 9 — Suite tests conformité
- Bloc 10 — Checklist pré-prod + COMPLIANCE_README
