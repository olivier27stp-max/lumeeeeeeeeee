# Twilio — numéro SMS automatique à l'abonnement

_État au 2026-09-24. Aucun secret dans ce document._

## 1. Le flux

```
Abonnement (forfait plans.includes_sms = pro, autopilot)
  ├─ POST /api/billing/subscribe            (parcours dans l'app)            server/routes/billing.ts
  └─ webhook Stripe checkout.session.completed (lien de paiement)            server/routes/payments.ts
        │   (les deux, non bloquants : un échec de numéro n'annule jamais l'abonnement)
        ▼
provisionSmsForNewSubscription()                                             server/lib/twilioProvisioning.ts
  1. numéro en délai de grâce ? → réactivé, rien d'acheté
  2. canal SMS actif ? → rien                      ┐ idempotence :
  3. demande déjà en file ? → rien                 ┘ 1 org = 1 numéro
  4. ligne provisioning_events
       TWILIO_AUTO_PROVISION≠true → status=retrying (en file), alerte #support, STOP
       sinon                      → status=pending, achat :
  5. AvailablePhoneNumbers(CA|US).local  (indicatif déduit de company_settings, repli pays)
  6. IncomingPhoneNumbers.create  smsUrl = <PUBLIC_URL>/api/messages/inbound
                                  statusCallback = <PUBLIC_URL>/api/messages/status
                                  pas de voiceUrl (SMS d'abord)
  7. RPC provision_sms_channel → communication_channels (phone_number E.164, metadata.twilio_sid)
        │
        ├─ succès → provisioning_events.status = success
        └─ échec  → status = retrying + metadata.{nature, prochain_essai}, Sentry, alerte #support
                     (numéro acheté mais non enregistré : sid + numéro gardés sur la ligne,
                      la relance l'ENREGISTRE sans en racheter un)
        ▼
relancerProvisionnementsEnAttente()   toutes les 10 min, sous verrou (server/index.ts)
  délai 15 min → 1 h → 4 h → 16 h → 24 h ; abandon (failed + alerte) 14 jours après le 1er essai ;
  forfait perdu entre-temps → abandoned ; numéro obtenu entre-temps → success.
        ▼
SMS entrant → Twilio → POST /api/messages/inbound → org retrouvée par le numéro « To »
```

**Choix des événements.** Ils étaient déjà en place : `POST /api/billing/subscribe` est le parcours réellement emprunté en prod, `checkout.session.completed` couvre le lien de paiement. Pas `invoice.paid` : il se déclenche à chaque renouvellement. On ne s'en sert pas pour l'achat, mais l'idempotence tiendrait quand même.

**État de l'org « phone_provisioning_pending ».** C'est la dernière ligne `provisioning_events` de l'org, en `pending` ou `retrying`. Ce n'est pas une nouvelle colonne, donc aucune migration. Elle est exposée par `GET /api/communications/sms-provisioning` et affichée dans Réglages → Messagerie SMS (« en cours d'attribution »).

## 2. Constat (discovery)

| Élément | Constat |
|---|---|
| Code | **Implémenté** depuis avril 2026 (migration `20260421000000_twilio_auto_provisioning.sql`), branché sur les 2 parcours. |
| En prod | **Jamais exécuté** : `provisioning_events` est vide. Le seul numéro, `+18707703627` (Coquin lavage, `PNcb72…78db`), a été enregistré à la main par le support (`metadata.manually_registered = true`). |
| Orgs SMS sans numéro | 1 : « Grok Audit (TEST) », insérée directement (pas de Stripe). Elle n'est pas rattrapée automatiquement, voir § 5. |
| Compte Twilio en prod | `TWILIO_ACCOUNT_SID` sur Railway. Pas lu directement (CLI Railway déconnecté). **Déduit** : c'est le parent `AC9a30…`, car les envois sortants de prod partent de `+18707703627`, qui appartient au parent. **À confirmer** par Will dans Railway. |
| Authentification | Jeton principal (`TWILIO_AUTH_TOKEN`) du parent. La clé API `lume` n'est **pas** utilisée par le code. |
| Sous-compte Oscar | Non référencé par le code. Aucun changement. |
| `.env.local` (staging) | Aucune variable Twilio : aucun achat possible en local. |

**Ce qui aurait cassé au premier client réel :**
1. **Conformité** : le profil principal est en *Draft*, donc l'achat est refusé.
2. L'échec partait en `failed` **sans relance**, avec pour seule alerte Sentry.
3. Un numéro acheté dont l'écriture en base échouait était perdu : il restait payé sur Twilio, et la relance manuelle en rachetait un second.

## 3. Ce que change la PR

- `TWILIO_AUTO_PROVISION` : un interrupteur, **éteint par défaut**. Éteint, la demande est mise en file, l'équipe est prévenue et rien n'est acheté. Dès qu'on l'allume, la file est servie, donc aucun abonné n'est perdu.
- Relance automatique avec délai croissant, abandon après 14 jours, classement de l'échec (`conformite`, `permissions`, `inventaire`, `configuration`, `enregistrement`, `autre`). Le message brut de Twilio est conservé.
- Numéro acheté mais non enregistré : il est gardé sur la ligne, puis réenregistré sans rachat.
- Alertes dans #support (Slack, s'il est configuré) au 1er échec, à l'abandon, à la réussite après relance et à chaque mise en file.
- Clé Restricted facultative pour l'achat seul : `TWILIO_PROVISIONING_API_KEY_SID` / `_SECRET`. Le reste (envois, validation de signature) garde le jeton principal.
- Tests : `tests/twilio-provisioning-file.test.ts` (18 cas, Twilio simulé).

**Hors changement :** `+18707703627` et ses webhooks. La relance ne touche qu'aux orgs **sans** canal actif, et la libération ne touche qu'aux canaux `inactive` qui ont une date de libération. Aucun appel à l'API Twilio n'a été fait pendant ce travail. Le bouton « Obtenir mon numéro » (Réglages) reste manuel et ne dépend pas de l'interrupteur.

## 4. Runbook

### A. Conformité (Will seul)
1. Console Twilio (compte **parent**) → Trust Hub → Customer Profiles → profil principal `BU46017…` → compléter.
2. Vérification Persona (pièce d'identité + selfie) → Submit.
3. Attendre le statut **Twilio-approved**. Tant qu'il est *Draft* ou *Pending*, l'achat échoue proprement : la demande reste en file et l'alerte indique `conformite`.

### B. Clé Restricted `lume-provisioning` (recommandé)
1. Compte **parent** (jamais Oscar) → Account → API keys → Create → type **Restricted**, nom `lume-provisioning`.
2. Permissions : **Phone Numbers** (lecture/écriture : IncomingPhoneNumbers, AvailablePhoneNumbers). Rien d'autre.
3. Noter le SID `SK…` et le secret (affiché une seule fois), puis les coller directement dans Railway. Ne jamais les mettre dans le chat, un commit ou un fichier suivi.
4. La clé `lume` existante (0 permission) n'est pas utilisée par le code. On peut la supprimer plus tard, après vérification.

### C. Variables Railway (prod), à poser seulement avec le GO de Will

```diff
+ TWILIO_PROVISIONING_API_KEY_SID=SK…        # étape B
+ TWILIO_PROVISIONING_API_KEY_SECRET=…       # étape B
+ TWILIO_AUTO_PROVISION=true                 # APRÈS le test de l'étape D
  PUBLIC_URL=https://lumecrm.net             # à vérifier : présent et exact (webhook des nouveaux numéros)
  TWILIO_ACCOUNT_SID=AC9a30…                 # à vérifier : c'est bien le parent
```
Rotation de la clé : créer la nouvelle clé, remplacer les deux variables, redéployer, supprimer l'ancienne clé.

### D. Premier achat test (après « approved »)
1. Diagnostic sans achat : `npx tsx server/scripts/diagnose-sms-provisioning.ts` avec les variables de prod. Il vérifie les identifiants, `PUBLIC_URL`, le solde et le stock CA/US, et n'achète rien.
2. **Un** achat, sur une org de test uniquement (jamais un client payant) : `npx tsx server/scripts/test-twilio-provisioning.ts <org de test>`.
3. Contrôler dans la console Twilio : SMS URL = `https://lumecrm.net/api/messages/inbound` (POST), voix vide. Puis envoyer un SMS depuis un téléphone de l'équipe et vérifier qu'il arrive dans Lume.
4. Rapport : SID `PN…`, numéro E.164, URL du webhook.
5. Seulement ensuite : `TWILIO_AUTO_PROVISION=true`.

## 5. GO Will restants

1. Conformité Trust Hub (§ 4A). **Bloquant.**
2. Créer la clé `lume-provisioning` et la poser dans Railway (§ 4B/C).
3. Confirmer `TWILIO_ACCOUNT_SID` = parent et `PUBLIC_URL` en prod.
4. Premier achat test sur quelle org (§ 4D) ?
5. Allumer `TWILIO_AUTO_PROVISION=true`.
6. « Grok Audit (TEST) » : lui donner un numéro ou non (org de test, pas de rattrapage automatique) ?
7. Le bouton manuel « Obtenir mon numéro » doit-il aussi obéir à l'interrupteur ?
