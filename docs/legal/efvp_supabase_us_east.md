# Évaluation des facteurs relatifs à la vie privée (EFVP)

## Communication de renseignements personnels à l'extérieur du Québec — Supabase (AWS us-east-1)

**Loi sur la protection des renseignements personnels dans le secteur privé (RLRQ, c. P-39.1), art. 17**

---

**Version :** `efvp-supabase-2026-04-22`
**Date :** 2026-04-22
**Auteur :** William Hébert, responsable de la protection des renseignements personnels
**Entreprise :** William Hébert (entreprise individuelle, Québec) — opérant sous le nom « Lume CRM »
**Prochaine révision :** 2027-04-22 (annuelle)

---

## 1. Objet de l'évaluation

Cette évaluation documente l'analyse requise par l'article 17 de la Loi 25 avant toute communication de renseignements personnels de personnes au Québec à l'extérieur de la province.

**Opération évaluée :** hébergement de la base de données de production du service Lume CRM chez **Supabase Inc.** (société de l'État du Delaware, USA) dont l'infrastructure sous-jacente est fournie par **Amazon Web Services (AWS) — région `us-east-1` (Virginie du Nord, USA)**.

---

## 2. Description des renseignements personnels communiqués

### 2.1 Catégories de renseignements

| Catégorie | Champs | Sensibilité |
|---|---|---|
| Identité | prénom, nom, nom de société | Standard |
| Contact | courriel, téléphone, adresse postale | Standard |
| Géolocalisation (adresses de chantier) | adresse complète, coordonnées GPS | Standard |
| Financiers (facturation) | montants, numéros facture, historique paiement | Sensible (tiers Stripe/PayPal tokenisent le paiement) |
| Comportementaux | notes sur les leads/clients, historique d'activité | Standard |
| Techniques / audit | adresse IP, user-agent, horodatages, logs d'actions | Standard |
| Authentification | mot de passe (haché bcrypt via Supabase Auth), tokens de session | Sensible (jamais stocké en clair) |

**Non-collectés :** numéros d'assurance sociale, renseignements de santé, données biométriques, orientation politique/sexuelle/religieuse, données de mineurs (interdit par CGU).

### 2.2 Personnes concernées

- **Utilisateurs des organisations clientes** (employés, administrateurs) — québécois selon la clientèle
- **Clients finaux et prospects** saisis dans le CRM par nos utilisateurs — majoritairement québécois

### 2.3 Volumes estimés (au 2026-04-22, phase beta)

- Organisations clientes actives : 16 (beta interne + tests)
- Utilisateurs distincts : 18
- Enregistrements (clients/leads/jobs) : ~60
- Volume cible beta publique : 5 à 50 organisations

---

## 3. Finalités

Le traitement hors Québec est strictement nécessaire pour :

1. Fournir le service SaaS Lume CRM (exécution du contrat)
2. Héberger les données dans un environnement fiable, disponible et sécurisé (AWS est un hébergeur certifié SOC 2 Type II, ISO 27001, HIPAA, GDPR)
3. Assurer la continuité du service via la réplication intégrée de Supabase et AWS
4. Permettre le fonctionnement de l'authentification, du stockage et des fonctions serveur gérés par Supabase

**Alternatives examinées :**

- **Supabase `ca-central-1` (Montréal/AWS Canada) :** option disponible. Coût identique. Migration demanderait ~1-2 jours de downtime planifié. **Option différée à une échéance ultérieure — voir §9.**
- **Hébergement entièrement auto-géré au Québec :** rejeté (coûts opérationnels prohibitifs, impact négatif sur disponibilité et sécurité)
- **Autres fournisseurs de BaaS :** pas d'équivalent fonctionnel offrant PostgreSQL managé + Auth + Storage + Realtime

---

## 4. Cadre juridique américain — analyse des risques

### 4.1 Lois applicables côté USA

- **CLOUD Act (Clarifying Lawful Overseas Use of Data Act, 2018)** — autorise les autorités fédérales américaines à exiger la communication de données détenues par des entreprises américaines, même stockées à l'étranger.
- **FISA section 702** — surveillance des personnes non américaines à l'étranger par les agences de renseignement.
- **Executive Order 12333** — surveillance extérieure des communications.

### 4.2 Impact pratique pour Lume CRM

- **Exposition théorique :** les autorités américaines peuvent théoriquement contraindre Supabase/AWS à fournir des données clients québécoises.
- **Exposition pratique :** très faible pour un CRM B2B qui ne traite pas de données sensibles particulières (santé, politique, religion). Aucun cas connu de demande gouvernementale US sur des données CRM d'une PME québécoise.
- **Transparence Supabase :** Supabase publie un rapport de transparence (cf. https://supabase.com/security). À ce jour, aucune demande gouvernementale acceptée sans ordre judiciaire valide.

### 4.3 Mesures de mitigation en place

1. **Chiffrement au repos** : AES-256 via AWS KMS. Clés détenues par AWS. [⚠ limite : les clés ne sont pas détenues par le client final.]
2. **Chiffrement en transit** : TLS 1.3 de bout en bout.
3. **RLS PostgreSQL** : isolation multi-locataire au niveau de la base — Supabase staff ne peut pas requêter de données applicatives sans JWT valide.
4. **Minimisation** : seules les données strictement nécessaires au fonctionnement sont transmises à des tiers (Stripe, Twilio, Resend).
5. **Redaction PII prompts IA** (`server/lib/pii-redaction.ts`) : courriels, téléphones, adresses retirés automatiquement avant envoi à Gemini/Ollama-remote.
6. **Absence de clés de chiffrement client-side** : décision produit explicite (cf. `compliance_audit.md §13`) ; la sécurité repose sur le chiffrement transparent Supabase + RLS + TLS.
7. **Audit trail** : toute action sensible journalisée dans `audit_events` (3 ans).
8. **Registre incidents** (`security_incidents`) avec workflow de notification CAI.

---

## 5. Cadre juridique canadien de protection

### 5.1 Engagements contractuels Supabase

- **DPA (Data Processing Agreement)** signé : https://supabase.com/dpa
- **Clauses contractuelles types** : Supabase incorpore des clauses équivalentes aux SCC UE.
- **Sous-traitants listés** : https://supabase.com/subprocessors (AWS, Cloudflare, Sentry, Vercel, autres)
- **Certifications** : SOC 2 Type II, HIPAA BAA disponible

### 5.2 Engagements Lume CRM

- Notification du client dans les 72 heures en cas d'incident de confidentialité affectant ses données (DPA §12).
- Exportation complète des données sur demande (`/api/dsr/export/*`).
- Anonymisation sur demande d'effacement (`/api/dsr/erase/*`).

---

## 6. Analyse de proportionnalité

| Facteur | Évaluation |
|---|---|
| Nécessité | Haute — aucune alternative équivalente au Québec à coût comparable. |
| Sensibilité des données | Moyenne — PII standard, pas de catégories particulières au sens RGPD art. 9. |
| Volume | Faible à moyen à court terme. |
| Durée du transfert | Pour la durée de la relation contractuelle + obligations de conservation légales. |
| Risque juridique US | Faible dans les faits. Surveillance ciblée possible, surveillance de masse peu probable vu le profil CRM B2B. |
| Bénéfice pour la personne concernée | Indirect mais réel (service fiable, sécurisé, disponible). |
| Mesures compensatoires | Substantielles (cf. §4.3). |

**Conclusion :** le transfert est **proportionné** et **nécessaire**, sous réserve des mesures de mitigation déjà en place et de l'information transparente des personnes concernées.

---

## 7. Information des personnes concernées

Les mentions suivantes figurent dans la politique de confidentialité (`/privacy`) :

- Identité du responsable (William Hébert) et coordonnées du responsable de la protection des renseignements personnels (`willhebert30@gmail.com`, 819-817-9526 — astreinte 24/7 incidents)
- Catégories de renseignements collectées
- Finalités du traitement
- Fait que les renseignements peuvent être communiqués à l'extérieur du Québec (États-Unis)
- Liste des sous-traitants (`/subprocessors`) et leurs lieux d'hébergement
- Droits des personnes concernées et modalités d'exercice

---

## 8. Durée de conservation

Conformément à `docs/legal/data_retention_policy.md` :

- Comptes actifs : durée de la relation
- Leads inactifs : anonymisation après 24 mois
- Clients soft-deleted : anonymisation après 180 jours
- Factures : conservation légale 10 ans
- Logs audit : 3 ans
- Logs tentatives de connexion : 90 jours

---

## 9. Décision

**Option retenue :**

- [x] **A.** Maintien de l'hébergement `us-east-1` avec l'ensemble des mesures de mitigation ci-dessus. Révision annuelle.
- [ ] **B.** Migration vers Supabase `ca-central-1` (Montréal) — envisagée à l'horizon de la croissance au-delà de 100 organisations clientes ou à la première demande documentée d'un client exigeant résidence canadienne.

**Justification de la décision :**

> La phase beta actuelle (≤50 organisations clientes) ne justifie pas le coût opérationnel (1-2 jours de downtime planifié, risques de régression auth/webhooks Stripe/Twilio) d'une migration immédiate. Le transfert vers `us-east-1` demeure strictement nécessaire à l'exploitation du service, est couvert par un DPA Supabase équivalent aux clauses contractuelles types, et bénéficie de mesures de mitigation substantielles (chiffrement AES-256 au repos, TLS 1.3 en transit, RLS PostgreSQL, redaction PII avant traitement IA, audit trail). Les personnes concernées sont informées de ce transfert dans la politique de confidentialité et leurs droits (accès, rectification, effacement, portabilité) sont pleinement exerçables via le portail DSR intégré.

**Engagement de révision :**

- Révision annuelle obligatoire (prochaine : 2027-04-22)
- Révision anticipée si : (a) changement de cadre juridique US affectant les transferts, (b) incident de confidentialité impliquant Supabase ou AWS, (c) dépassement du seuil de 100 organisations clientes, (d) demande spécifique d'un client ou de la CAI.

---

## 10. Signatures

| Rôle | Nom | Signature | Date |
|---|---|---|---|
| Responsable de la protection des renseignements personnels | William Hébert | _William Hébert_ | 2026-04-22 |
| Direction (entreprise individuelle) | William Hébert | _William Hébert_ | 2026-04-22 |

---

## Annexe A — Liens

- Loi 25 texte officiel : https://www.legisquebec.gouv.qc.ca/fr/document/lc/p-39.1
- Guide CAI EFVP : https://www.cai.gouv.qc.ca/
- Supabase Trust Center : https://supabase.com/security
- Supabase DPA : https://supabase.com/dpa
- AWS certifications : https://aws.amazon.com/compliance/programs/
