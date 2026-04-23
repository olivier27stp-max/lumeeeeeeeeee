# SOP — Réponse aux demandes des personnes concernées (DSR)

**Version :** `sop-dsr-2026-04-21`
**Propriétaire :** DPO
**Délai légal de réponse :** **30 jours** (Loi 25 art. 32, LPRPDE s. 8(3), RGPD art. 12(3))

---

## 1. Canaux de réception

Une demande valide peut arriver par :

1. **Formulaire self-service** `/account/privacy` → `POST /api/dsr/request` → entrée dans `dsar_requests`
2. **Email** à `willhebert30@gmail.com`
3. **Courrier postal** au siège (rare)
4. **Via un client (B2B)** qui transmet la demande d'un de SES utilisateurs finaux

**Toute demande doit être enregistrée dans `dsar_requests`** même si elle arrive par email/courrier. Le DPO crée l'entrée manuellement.

---

## 2. Workflow — 30 jours maximum

### Jour 0 — Réception (dans les 24h)

- [ ] Accuser réception au demandeur (template §5.1)
- [ ] Classifier le type : `access`, `erasure`, `rectification`, `portability`, `objection`, `restriction`
- [ ] Créer / mettre à jour `dsar_requests` avec `status='pending'`
- [ ] Vérifier la juridiction : Québec / Canada / UE → change les obligations
- [ ] Répondre dans un mois (prolongation de 2 mois possible sous RGPD si complexe, avec information au demandeur)

### Jour 1-3 — Vérification d'identité

Avant tout traitement, vérifier que le demandeur EST la personne concernée.
Méthodes acceptées :

- Identifiant unique depuis le compte (UUID user)
- Lien magique envoyé à l'email enregistré
- Réponse à partir de l'email enregistré
- Pour demande par courrier : copie ID + échantillon de signature

Si doute → demander pièce d'identité (mais ne pas la conserver au-delà de la vérification).

### Jour 3-20 — Exécution

#### Si type = `access` ou `portability`

```sql
-- Pour un user interne (employee)
select public.export_user_data('[user-uuid]');

-- Pour un client final d'une org
select public.export_client_data('[client-uuid]');
```

Ou via API :
```
GET /api/dsr/export/me                      (admin bearer token)
GET /api/dsr/export/client/:id              (admin bearer token)
```

Envoyer le JSON au demandeur via lien sécurisé à expiration (ex: upload sur un bucket Supabase signé 7 jours).

#### Si type = `erasure`

1. **Vérifier les obligations légales de conservation :**
   - Factures / paiements liés ? → garder 10 ans (obligation fiscale)
   - Litige en cours ? → suspendre l'effacement (legal hold)
   - Si oui, répondre au demandeur : "partiel — certaines données conservées X années pour cause Y"
2. Exécuter :
   ```
   POST /api/dsr/erase/client/:id   { "confirm": "ERASE" }
   POST /api/dsr/erase/lead/:id     { "confirm": "ERASE" }
   ```
   Les PII sont remplacées par `ANONYMIZED`, la ligne reste pour intégrité FK.
3. Pour un user interne → hard delete programmé via `/api/team/:id/request-delete` (grace 30j).

#### Si type = `rectification`

- Si les données sont rectifiables dans l'app → demander au user de le faire lui-même OU le faire côté admin.
- Logger dans `audit_events` l'action de rectification.

#### Si type = `objection` (marketing / profilage)

- Ajouter à `email_opt_outs` et/ou `sms_opt_outs` :
  ```
  select public.record_email_opt_out('user@example.com', '[org-uuid]', 'user-request');
  ```
- Mettre à jour `clients.email_opt_out_at`.

#### Si type = `restriction`

- Marquer la demande `status='in_progress'` avec commentaire dans `incident_timeline`-équivalent (ou `dsar_requests.justification`).
- Suspendre le traitement marketing, garder stockage.

### Jour 25-30 — Réponse

- [ ] Envoyer la réponse finale au demandeur (template §5.2)
- [ ] Mettre à jour `dsar_requests` : `status='completed'`, `completed_at=now()`, `response_url` si export
- [ ] Archiver la correspondance dans le dossier DPO (6 ans)

---

## 3. Cas particuliers

### Demande manifestement infondée ou excessive

RGPD art. 12(5) / Loi 25 art. 32 : refus possible. **Documenter la raison** dans `dsar_requests.justification`, marquer `status='rejected'`, répondre au demandeur avec recours possible (CAI/CNIL/OPC).

### Demande d'un tiers

Nécessite mandat signé. Ne jamais divulguer sans preuve de mandat.

### Demande impliquant des données d'autres personnes

Lors d'un export client, les `audit_events` peuvent mentionner l'action d'un employé sur ce client. L'export peut inclure le nom de l'employé (c'est un tiers). **C'est acceptable** : c'est dans l'exercice professionnel, pas une vie privée protégée.

### Demande via un client B2B

Le client (Controller) transmet la demande de SON utilisateur final. C'est LUI le Controller, on est Processor. On assiste, on n'est pas le décideur. Réponse : "nous assistons notre client [X], qui répondra dans les délais".

---

## 4. Délais par juridiction

| Juridiction | Délai | Prolongation possible |
|---|---|---|
| Québec — Loi 25 | 30 jours | Sur motif + information |
| Canada — LPRPDE | 30 jours | 30 jours supplémentaires sur notification |
| UE — RGPD | 1 mois | 2 mois supplémentaires si complexe |
| USA — CCPA | 45 jours | 45 jours supplémentaires sur notification |

**On applique le PLUS COURT** par défaut = **30 jours**.

---

## 5. Templates réponse

### 5.1 Accusé de réception

```
Objet : Réception de votre demande concernant vos données personnelles

Bonjour [prénom],

Nous accusons réception de votre demande du [date], enregistrée sous la
référence [dsar-request-id].

Type de demande : [access / erasure / rectification / portability / objection / restriction]

Nous répondrons dans un délai de 30 jours, soit au plus tard le [date + 30j].

Si nous avons besoin d'informations complémentaires pour vérifier votre
identité ou préciser votre demande, nous vous contacterons à ce courriel.

Cordialement,
[Nom du DPO]
Responsable de la protection des renseignements personnels
willhebert30@gmail.com
```

### 5.2 Réponse finale — accès / portabilité

```
Objet : Réponse à votre demande [dsar-request-id]

Bonjour [prénom],

Vous trouverez ci-joint (ou via le lien sécurisé suivant, valide 7 jours)
l'ensemble des renseignements personnels que nous détenons à votre sujet :

[LIEN SIGNÉ]

Le format est JSON structuré, conforme à l'article 20 du RGPD et à
l'article 27 al. 3 de la Loi 25.

Si vous souhaitez plus d'informations ou contester cette réponse, vous
pouvez nous écrire à willhebert30@gmail.com. Vous pouvez également vous
adresser à :
- Commission d'accès à l'information du Québec — https://www.cai.gouv.qc.ca
- Commissariat à la protection de la vie privée du Canada — https://www.priv.gc.ca

Cordialement,
[Nom du DPO]
```

### 5.3 Réponse finale — effacement

```
Objet : Confirmation d'effacement — [dsar-request-id]

Bonjour [prénom],

Nous confirmons l'effacement de vos données personnelles du service Lume CRM,
réalisé le [date].

[Si applicable :] Certaines données sont conservées en application d'une
obligation légale : [liste — ex: données de facturation pour 10 ans].

Vos données ont été :
- Rendues anonymes dans notre base de production le [date]
- Supprimées des sauvegardes au plus tard le [date + 30 jours]
- Effacées chez nos sous-traitants selon leurs propres procédures (cf. /subprocessors)

Cordialement,
[Nom du DPO]
```

### 5.4 Refus motivé

```
Objet : Décision — [dsar-request-id]

Bonjour [prénom],

Nous avons examiné votre demande du [date] et nous ne pouvons y donner suite
pour le motif suivant : [motif précis].

Vous disposez d'un recours auprès de :
- Commission d'accès à l'information du Québec — https://www.cai.gouv.qc.ca

Cordialement,
[Nom du DPO]
```

---

## 6. Métriques à suivre (dashboard DPO)

- Nombre de DSR par mois (par type)
- Délai moyen de réponse
- Taux de respect du 30 jours
- Taux de rejet (doit rester faible, documenter chaque cas)

Query :
```sql
select request_type, status,
       count(*) as total,
       avg(extract(epoch from (completed_at - created_at)) / 86400) as avg_days
  from public.dsar_requests
 where created_at > now() - interval '12 months'
 group by request_type, status
 order by request_type;
```

---

## 7. Révision

Cette procédure est revue **annuellement** ou après chaque incident DSR notable.
