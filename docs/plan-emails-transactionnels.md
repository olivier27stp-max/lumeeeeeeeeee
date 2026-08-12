# Plan — Emails transactionnels Lume

**Date** : 2026-08-12
**Périmètre** : niveau A (Lume → orgs clientes) + niveau B (orgs → clients finaux)
**Décisions actées** : fondation d'abord ; bilingue fr/en avec fr par défaut ; exécution phase par phase avec validation.

**Arbitrages tranchés le 2026-08-12** (voir §5 pour le raisonnement complet) :
1. **Migration vers Resend en phase 1**, pas en phase 3. Gmail SMTP n'a pas de webhooks de bounce/complaint : une adresse morte reste invisible et dégrade la réputation d'expéditeur. Migrer après avoir câblé le dunning obligerait à refaire le travail.
2. **Grâce `past_due` = 7 jours**, avec bandeau d'avertissement dès le jour 1. Aligné sur la fenêtre des Smart Retries de Stripe.
3. **Phase 2 : on corrige les routes menteuses**, après vérification du front appelant pour que l'erreur remonte en message clair.

**Prérequis à fournir** (bloquant pour la phase 1) : domaine d'envoi vérifié chez Resend (SPF/DKIM, accès DNS requis) + `RESEND_API_KEY` dans `.env.local` et côté Railway.

---

## 1. État des lieux — ce qu'il faut savoir avant de décider quoi que ce soit

Cinq constats issus de la lecture du code. Ils conditionnent tout le reste.

### 1.1 Ce n'est plus Resend, c'est Nodemailer + SMTP Gmail

Le SDK `resend` n'est pas installé. Tout passe par [mailer.ts](server/lib/mailer.ts), 82 lignes, un transporteur Nodemailer singleton sur `smtp.gmail.com:587`. Il ne reste de Resend que des vestiges textuels — dont un `provider: 'resend'` écrit en dur en base à [communications.ts:191](server/routes/communications.ts#L191).

Conséquence directe et **bloquante pour le volume** : Gmail SMTP plafonne à ~500 destinataires/jour sur un compte gratuit, ~2000 sur Workspace. Et surtout, `SendEmailParams` n'accepte **pas de headers custom** — donc `List-Unsubscribe` est techniquement impossible aujourd'hui. C'est un problème de conformité CASL, pas seulement de confort.

### 1.2 `sendEmail()` ne throw jamais — et 1 chemin sur 10 ne vérifie pas le résultat

`sendEmail()` retourne `{ sent: false, error }` au lieu de lever. Toute la fiabilité repose donc sur le fait que l'appelant teste `result.sent`.

Un appelant ne le fait pas du tout : [quotes.ts:403](server/routes/quotes.ts#L403) écrit `await sendEmail({...})` sans même assigner le retour. **Si le SMTP tombe, la route renvoie `{ok: true}`, avance le devis en `awaiting_response`, écrit `quote_send_log.delivery_status = 'sent'`, pousse le deal en `quote_sent` et émet `quote.sent` — sans qu'aucun courriel ne soit parti.** Le client final n'a rien reçu, mais l'org voit « envoyé » partout dans son UI, y compris dans un log qui affirme la livraison.

C'est le bug le plus grave trouvé, et il existe déjà en production. Il n'attend pas ce chantier.

### 1.3 Le bilingue niveau B est impossible en l'état — il manque une colonne

C'est la découverte qui modifie ta décision « bilingue fr/en ». Il faut la traiter séparément par niveau :

| | Champ de langue disponible | Bilingue faisable ? |
|---|---|---|
| **Niveau A** (destinataire = membre d'une org) | `auth.users.raw_user_meta_data.language` — **réellement écrit** par [LanguageContext.tsx](src/i18n/LanguageContext.tsx) quand l'utilisateur change de langue | **Oui, immédiatement** |
| **Niveau B** (destinataire = client final, prospect) | **Aucun.** `clients` a 59 colonnes, zéro langue. `contacts` : zéro. Pas de table `leads`. | **Non — il faut ajouter la colonne** |

Piège à éviter : `memberships.language` existe (`text NOT NULL DEFAULT 'fr'`) et semble être le bon champ. Il ne l'est pas — **rien dans le code ne l'écrit jamais**. Le seul lecteur, [request-forms.ts:625](server/routes/request-forms.ts#L625), lit donc toujours `'fr'`. L'onboarding va jusqu'à valider un champ `language` en Zod puis le jeter sans le persister ([onboarding.ts:22](server/routes/onboarding.ts#L22)). S'appuyer dessus, c'est construire sur du sable.

La vraie source côté A est `user_metadata.language`.

### 1.4 Il n'y a aucun essai gratuit — mais l'app fait comme si

Aucune colonne `trial_end` / `trial_days`. Aucun appel Stripe avec `trial_period_days`. `handleCheckoutSessionCompleted` écrit toujours `status: 'active'` ([payments.ts:1711](server/routes/payments.ts#L1711)). **Aucun chemin de code n'écrit jamais `status = 'trialing'`.**

Pourtant `'trialing'` est *lu* à 18 endroits, et le Platform Admin affiche un bloc « Trials Ending Soon » qui sera toujours vide. C'est de l'infrastructure fantôme.

Ça élimine d'office toute une famille d'emails (« ton essai se termine dans 3 jours ») : on ne peut pas les écrire, il n'y a rien à observer.

### 1.5 Le dunning n'existe pas, et l'accès est coupé sans préavis

Sur `invoice.payment_failed`, le webhook passe l'abonnement en `past_due` puis émet **un simple `console.warn`** ([payments.ts:545](server/routes/payments.ts#L545)), avec le commentaire « Hook point for dunning emails — kept as a log entry for now ».

Et il y a pire qu'un email manquant : [App.tsx:521](src/App.tsx#L521) n'autorise l'accès qu'aux statuts `['active', 'trialing']`. **`past_due` est exclu — l'org est donc coupée vers `AccessBlocked` dès le premier échec de renouvellement**, alors même que `GET /billing/current` inclut `past_due` pour afficher une UI de réparation que l'utilisateur ne peut plus atteindre. Un client dont la carte expire perd son CRM du jour au lendemain, sans email, sans grâce, sans chemin de réparation visible.

C'est le trou fonctionnel le plus coûteux du système actuel. Un email seul ne le bouche pas — il faut aussi la grâce d'accès. Traité en phase 3.

### 1.6 Aucun filet

Zéro test sur les 10 sites d'envoi. Aucune table de log email générique. Idempotence réelle sur 2 chemins seulement (`billing_receipt_log`, `reminder_log`). Aucun retry, aucune file d'attente. Plusieurs envois partent en fire-and-forget non attendu.

---

## 2. Catalogue des emails

Légende : ✅ existe · ⚠️ existe mais défectueux · ❌ à créer.
Priorité : **P0** = perte d'argent ou de client · **P1** = confiance/support · **P2** = confort.

### 2.1 Niveau A — Lume → ses orgs clientes

| # | Email | Déclencheur | État | Prio |
|---|---|---|---|---|
| A1 | Reçu de paiement d'abonnement | `checkout.session.completed` | ✅ [billing-email.ts:112](server/lib/billing-email.ts#L112), idempotent | — |
| A2 | Bienvenue + création du mot de passe | `checkout.session.completed`, si `isNewUser` | ✅ [payments.ts:1888](server/routes/payments.ts#L1888), HTML inline | — |
| A3 | Vérification d'adresse email | `POST /auth/register` | ✅ [auth.ts:36](server/routes/auth.ts#L36) | — |
| A4 | Invitation à rejoindre une org | `POST /invitations/send` | ⚠️ deux chemins divergents (§2.3) | P1 |
| A5 | Un mois offert (parrainage) | `awardReferrerReward` | ✅ mais **dupliqué** : [billing.ts:524](server/routes/billing.ts#L524) + [referral-rewards.ts:334](server/lib/referral-rewards.ts#L334) | P2 |
| **A6** | **Échec de renouvellement — action requise** | `invoice.payment_failed` | ❌ `console.warn` seul | **P0** |
| **A7** | **Relance de dunning J+3 / J+7** | cron sur `past_due` | ❌ inexistant | **P0** |
| **A8** | **Suspension imminente / effective** | fin de la grâce | ❌ inexistant | **P0** |
| A9 | Carte expirant sous 30 jours | `payment_method` / cron | ❌ | P1 |
| A10 | Paiement récupéré, tout est rentré dans l'ordre | `invoice.paid` après `past_due` | ❌ | P1 |
| A11 | Confirmation d'annulation + date de fin d'accès | `POST /billing/cancel` | ❌ | P1 |
| A12 | Abonnement définitivement terminé | `customer.subscription.deleted` | ❌ | P1 |
| A13 | Changement de plan confirmé (upgrade/downgrade, prorata) | `POST /billing/change-plan` | ❌ | P1 |
| A14 | Renouvellement à venir dans 7 jours (annuel) | `invoice.upcoming` — **event non souscrit** | ❌ | P2 |
| A15 | Sièges/bureaux ajoutés, impact facturation | `POST /billing/seats`, `/offices` | ❌ | P2 |
| A16 | Reçu de renouvellement (mois 2+) | `invoice.paid` récurrent | ❌ — A1 ne couvre que le 1er paiement | P1 |
| A17 | Changement de mot de passe / d'email effectué | routes auth | ❌ (sécurité) | P1 |
| A18 | Nouvelle connexion depuis un appareil inconnu | auth | ❌ | P2 |
| A19 | Limite de plan atteinte (clients, jobs/mois) | compteurs vs `plans.max_*` | ❌ | P2 |

*Écarté délibérément* : « fin d'essai » (A-trial) — sans trial en base, rien à déclencher (§1.4).

### 2.2 Niveau B — orgs → leurs clients finaux

| # | Email | Déclencheur | État | Prio |
|---|---|---|---|---|
| B1 | Facture envoyée | `POST /emails/send-invoice` | ✅ correct | — |
| B2 | Devis envoyé (web, table `invoices`) | `POST /emails/send-quote` | ⚠️ force `status:'sent'` sans garde | P1 |
| B3 | Devis envoyé (mobile, table `quotes`) | `POST /quotes/send-email` | ⚠️ **§1.2 — result ignoré** | **P0** |
| B4 | Soumission mobile | `POST /emails/send-mobile-quote` | ✅ | — |
| B5 | Contrat à signer | `POST /emails/send-agreement` | ✅ | — |
| B6 | Demande de paiement | `POST /payment-requests/create` | ⚠️ statut `'sent'` écrit **avant** l'envoi | P1 |
| B7 | Relance de facture impayée | cron | ⚠️ échec transitoire = relance bloquée à jamais | P1 |
| B8 | Email libre / automatisation | `send-custom`, `executeSendEmail` | ✅ | — |
| **B9** | **Paiement reçu — reçu au client final** | `payment_intent.succeeded` | ❌ **le client paie et ne reçoit rien** | **P0** |
| **B10** | **Échec de prélèvement carte au dossier** | `payment_intent.payment_failed` | ❌ | **P0** |
| B11 | Remboursement émis | `charge.refunded` | ❌ | P1 |
| B12 | Devis accepté — confirmation aux deux parties | acceptation publique | ❌ | P1 |
| B13 | Contrat signé — copie contresignée | signature | ❌ | P1 |
| B14 | Rappel de rendez-vous J-1 | cron sur `schedule_events` | ❌ (existe en SMS) | P1 |
| B15 | Demande d'avis après job terminé | job `completed` | ❌ — type `review_request` existe en base, **jamais lu** | P2 |
| B16 | Facture bientôt due (J-3, avant échéance) | cron | ❌ — B7 ne couvre que l'après | P2 |

### 2.3 Incohérences structurelles à corriger au passage

1. **Deux chemins d'invitation.** [invitations.ts:396](server/routes/invitations.ts#L396) envoie un email brandé et vérifie la limite de sièges. [onboarding.ts:115](server/routes/onboarding.ts#L115) duplique l'insert, envoie via `admin.auth.admin.inviteUserByEmail()` (email Supabase générique, non brandé) et **ne vérifie pas la limite de sièges**. Deux expéditeurs, deux niveaux de contrôle.
2. **Parrainage dupliqué** (A5) — même contenu à deux endroits.
3. **`estimate.sent`** est émis par [emails.ts:431](server/routes/emails.ts#L431) alors que les presets d'automatisation ont migré vers `quote.sent`. Event quasi-mort.
4. **Deux interfaces `CompanyInfo` incompatibles** : [emails.ts:41](server/routes/emails.ts#L41) (`company_email`/`company_phone`) vs [payment-requests.ts:25](server/routes/payment-requests.ts#L25) (`email`/`phone`). Une unification naïve **fait disparaître silencieusement le téléphone** du pied de page des emails de paiement.
5. Les 3 helpers partagés sont exportés depuis `routes/emails.ts`, pas depuis `lib/` — `agreements.ts` importe donc une route.

---

## 3. Invariants — ce qu'on ne casse sous aucun prétexte

À relire avant chaque phase.

1. **`senderFor` : le `from` reste toujours l'adresse vérifiée de la plateforme.** Seuls le display-name et le `Reply-To` sont ceux du tenant. Mettre l'adresse du tenant en `from` casse SPF/DKIM et détruit la délivrabilité de tout le monde. C'est documenté en commentaire à [emails.ts:140](server/routes/emails.ts#L140) — c'est le cœur du modèle niveau B.
2. **`reminder_log` porte l'idempotence du cron de relance.** Toucher à la clé `(invoice_id, days_after_due, channel)` ou à l'ordre insert/envoi provoque des relances dupliquées **chez les clients finaux de nos clients**.
3. **Les noms d'events `invoice.sent` / `quote.sent` / `estimate.sent` sont des données**, pas du code : ils sont stockés en `trigger_event` dans les règles d'automatisation déjà provisionnées chez les tenants. Les renommer casse des automatisations en production.
4. **La garde `event.account` sur `checkout.session.completed`** ([payments.ts:607](server/routes/payments.ts#L607)) est la seule barrière A/B du webhook. Sans elle, un marchand Connect pourrait s'auto-attribuer un plan Enterprise pour 1 $ depuis son propre compte Stripe. On n'y touche pas.
5. **`processed_checkout_sessions` ne doit jamais faire throw le webhook** — sinon Stripe rejoue et double le provisioning.
6. **`communication_messages.provider = 'resend'`** : valeur historiquement fausse mais potentiellement lue en aval. On ne la change pas dans ce chantier.
7. **Une seule main sur la DB à la fois** (CLAUDE.md). Toute migration : staging d'abord, prod ensuite, puis `check:broken-objects` + `check:db-coherence` + `check:schema-refs`.
8. **Chaque nouvel email doit être idempotent par construction** — les webhooks Stripe rejouent, c'est normal et attendu.

---

## 4. Plan d'exécution

Sept phases. Chaque phase est livrable seule, réversible, et validée avant la suivante.

### Phase 0 — Filet de sécurité *(aucun changement de comportement)*

On n'a aucun test sur ces chemins. On en écrit avant de toucher quoi que ce soit.

- Tests sur les 10 sites d'envoi actuels : `sendEmail` mocké, on assert le contrat observable (statuts, logs, events émis).
- **Ces tests figent le comportement actuel, bugs compris** — y compris B3 qui renvoie `{ok:true}` en cas d'échec SMTP. Le test documente le bug ; la phase 2 le renversera explicitement.
- Fichiers : `tests/emails/*.test.ts`.

**Vérif** : `npm test` vert. Zéro fichier de production modifié.

---

### Phase 1 — Fondation

Le socle sur lequel tout le reste se branche. Rien de visible pour l'utilisateur.

**1a. Migration DB** — une seule, `supabase/migrations/<ts>_email_infrastructure.sql` :

> **Sous-phase 1z — bascule Resend.** À faire en dernier dans cette phase, une fois `sendTransactional` en place et testée. On remplace le transport **à l'intérieur de `mailer.ts` uniquement** : la signature `sendEmail(params) → {sent, messageId, error}` ne bouge pas, donc les 10 appelants existants ne sont pas touchés. Ajout du champ `headers` (nécessaire pour `List-Unsubscribe`, cf. 1e) et d'un vrai champ `text` (le multipart améliore nettement la délivrabilité — aujourd'hui tout part en HTML seul).
>
> Bascule progressive via `EMAIL_PROVIDER=smtp|resend` en variable d'env : staging sur `resend` d'abord, prod ensuite, avec repli immédiat sur `smtp` si un problème apparaît. On ne supprime le chemin Nodemailer qu'après une semaine de prod stable.
>
> **Webhooks Resend** (`bounced`, `complained`, `delivered`) → route `POST /api/webhooks/resend`, signature vérifiée, qui met à jour `email_log.status` et alimente une table de suppression. C'est la raison principale de cette migration : sans ça, une adresse morte reste invisible pour toujours.
>
> Bloquant : domaine vérifié SPF/DKIM + `RESEND_API_KEY`.

- Table `email_log` : `id, org_id (nullable — le niveau A n'a pas toujours d'org), level ('platform'|'tenant'), template_key, recipient_email, recipient_type, locale, subject, status ('sent'|'failed'|'skipped'), provider_message_id, error_message, idempotency_key, entity_type, entity_id, metadata jsonb, created_at`.
- **Index UNIQUE partiel sur `idempotency_key` WHERE `idempotency_key IS NOT NULL`** — c'est le cœur de la protection anti-doublon sur replay Stripe.
- `clients.preferred_language text` (nullable, pas de défaut) — **la colonne manquante du §1.3**. Nullable et sans défaut volontairement : `NULL` signifie « inconnu, on retombe sur la langue de l'org », ce qui est distinct de « le client a choisi le français ».
- RLS : lecture `has_org_membership(auth.uid(), org_id)`, écriture réservée au `service_role`. Les lignes `org_id IS NULL` (niveau A) ne sont lisibles que par le service.

**1b. `server/lib/email/send.ts`** — la fonction unique :

```ts
sendTransactional({
  templateKey, to, locale, level, orgId?,
  idempotencyKey?, entity?, data
}): Promise<{ sent: boolean; skipped?: 'duplicate' | 'unsubscribed'; error?: string }>
```

Ordre des opérations, qui est ce qui fait la fiabilité :
1. Résolution de la locale (1c) ;
2. si `idempotencyKey` fourni → tentative d'insert `email_log` en `pending` ; **violation d'unicité = on retourne `skipped:'duplicate'` sans envoyer** ;
3. rendu du template ;
4. `sendEmail()` ;
5. mise à jour de la ligne en `sent` / `failed` avec le `messageId` ou l'erreur.

L'insert **avant** l'envoi est délibéré : en cas de crash entre 4 et 5, on a une ligne orpheline en `pending` (détectable, réparable) plutôt qu'un doublon envoyé au client.

**1c. Résolution de langue** — `resolveLocale()`, dans cet ordre :
- niveau A : `auth.users.raw_user_meta_data.language` → `'fr'` ;
- niveau B : `clients.preferred_language` → langue de l'org qui envoie → `'fr'`.

**On n'utilise pas `memberships.language`** (§1.3 — jamais écrit). Note à porter dans le code, sinon quelqu'un « corrigera » ça dans six mois.

**1d. Registre de templates** — `server/lib/email/templates/`, un fichier par `templateKey`, chacun exportant `{ subject, body }` pour `fr` et `en`, plus le layout partagé déplacé depuis `routes/emails.ts` vers `lib/email/layout.ts` (ré-export depuis `emails.ts` pour ne pas casser l'import d'`agreements.ts` — invariant §5).

**1e. Désabonnement** — `SendEmailParams` gagne un champ `headers`, et `sendTransactional` ajoute `List-Unsubscribe` + `List-Unsubscribe-Post` sur les catégories non-transactionnelles. Table `email_unsubscribes (email, org_id, category, created_at)` + route publique `GET /unsubscribe/:token`. **Les emails strictement transactionnels (reçu, facture, sécurité) ne portent pas de lien de désabonnement** — c'est légal et attendu.

**Vérif** : tests de phase 0 toujours verts (rien n'est encore branché), plus des tests neufs sur `sendTransactional` — notamment un test qui appelle deux fois avec la même clé d'idempotence et assert un seul envoi.

---

### Phase 2 — Corriger les bugs existants *(avant d'ajouter le moindre email)*

Ajouter des emails par-dessus des chaînes cassées, c'est empiler de la dette. On répare d'abord.

- **B3 / [quotes.ts:403](server/routes/quotes.ts#L403)** — assigner le résultat, et **ne plus appliquer les effets de bord si l'envoi a échoué**. C'est un changement de comportement volontaire et assumé : la route retournera désormais une erreur là où elle mentait. Le test de phase 0 est inversé ici, en connaissance de cause.
- **B6 / payment-requests** — déplacer `updatePaymentRequestStatus(..., 'sent')` **après** l'envoi, et refléter l'échec réel dans le statut plutôt que de le forcer à `'sent'` ([payment-requests.ts:281](server/routes/payment-requests.ts#L281)).
- **B7 / reminders-cron** — la dédup filtrera sur `status = 'sent'`, pour qu'un échec SMTP transitoire ne bloque plus la relance à vie. Et corriger le cas `channel:'both'` sans numéro SMS provisionné, où **aucune ligne de log n'est écrite alors que l'email est parti** ([reminders-cron.ts:274](server/routes/reminders-cron.ts#L274)) → relance dupliquée à chaque passage du cron.
- **B2 / send-quote** — aligner sur la garde de statut de `quotes.ts` : ne pas rétrograder un devis déjà accepté.
- **A4** — faire pointer `onboarding.ts` vers le chemin d'invitation unique (email brandé + contrôle des sièges).
- **A5** — supprimer le doublon de l'email de parrainage.

**Vérif** : tests mis à jour ; validation manuelle sur staging de chaque chemin corrigé.

---

### Phase 3 — Dunning niveau A **(la priorité absolue)**

C'est ici qu'on arrête de perdre des clients silencieusement.

- **A6** — sur `invoice.payment_failed`, remplacer le `console.warn` par un email : ce qui s'est passé, montant, lien direct vers le portail Stripe pour corriger la carte, date de suspension. Idempotence : `stripe_invoice_id + attempt_count`.
- **Grâce d'accès — 7 jours, décidé.** Ajouter `past_due` au gate de [App.tsx:521](src/App.tsx#L521) pendant 7 jours à compter du premier échec, avec bandeau d'avertissement persistant dès le jour 1. **Sans ça, l'email A6 arrive chez quelqu'un qui est déjà dehors** — l'email seul ne résout rien.

  Pourquoi 7 jours : c'est la fenêtre des Smart Retries de Stripe. Couper avant, c'est couper des clients dont le paiement allait aboutir tout seul. Et le calcul est asymétrique — un client suspendu à tort coûte un churn définitif plus du support, un client en grâce coûte 7 jours d'usage d'un service déjà provisionné (coût marginal quasi nul).

  ⚠️ **`subscriptions` n'a pas de colonne `updated_at`** (absence documentée par des commentaires dans `payments.ts`). On ne peut donc pas dater le début de la grâce à partir de la ligne existante. Deux options à trancher à l'implémentation : ajouter `past_due_since timestamptz` sur `subscriptions` (propre, une migration de plus), ou dériver la date depuis `email_log` de l'email A6 (aucune migration, mais couple l'accès au log d'emails — fragile). **Je recommande la colonne** : l'accès d'un client ne doit pas dépendre de la réussite d'un envoi d'email.
- **A7** — cron de relance J+3 / J+7 sur les `past_due`.
- **A8** — email de suspension à l'expiration de la grâce, puis blocage effectif.
- **A10** — email de résolution quand `invoice.paid` succède à un `past_due`.
- **A16** — reçu de renouvellement (A1 ne couvre que le premier paiement).

Souscrire les events Stripe manquants côté dashboard : `invoice.upcoming`, `customer.subscription.trial_will_end` (pour plus tard), `payment_intent.requires_action`.

**Vérif** : rejeu de webhooks Stripe en mode test (`stripe trigger invoice.payment_failed`), y compris **un rejeu du même event deux fois** pour prouver l'idempotence. Vérification que le contenu d'`email_log` correspond à ce qui est réellement parti.

---

### Phase 4 — Trous niveau B qui coûtent de l'argent

- **B9** — reçu de paiement au client final. Aujourd'hui, **un client paie une facture et ne reçoit strictement rien.** C'est la première source d'appels « est-ce que mon paiement est passé ? » chez nos clients. Branché sur `payment_intent.succeeded`, idempotent sur `payment_intent.id`.
- **B10** — échec de prélèvement sur carte au dossier.
- **B11** — remboursement émis, sur `charge.refunded`.

Ces trois-là s'insèrent dans un webhook déjà chargé. On les ajoute **après** le traitement métier existant, en best-effort : un échec d'email ne doit jamais faire échouer le traitement du paiement (sinon Stripe rejoue et on double le paiement en base).

**Vérif** : parcours de paiement complet sur staging, de bout en bout.

---

### Phase 5 — Cycle de vie de l'abonnement

A11 (annulation confirmée), A12 (fin effective), A13 (changement de plan), A9 (carte expirant), A17 (changements de sécurité).

### Phase 6 — Engagement

B12 (devis accepté), B13 (contrat signé), B14 (rappel RDV J-1), B15 (demande d'avis — en câblant enfin le type `review_request` qui dort en base), B16 (facture bientôt due), A14/A15/A18/A19.

---

## 5. Arbitrages — tranchés

Trois points qui ne sont pas des détails d'implémentation. Décidés le 2026-08-12.

### 5.1 Fournisseur → Resend, migré en phase 1

Gmail SMTP plafonne à ~500 envois/jour (2000 sur Workspace), mais ce n'est pas la raison principale. **Gmail SMTP n'a aucun webhook de bounce ou de plainte.** Quand une adresse client est morte, on ne l'apprend jamais : on continue d'envoyer dans le vide, et chaque envoi dégrade la réputation du domaine expéditeur — ce qui finit par envoyer en spam les emails des clients qui, eux, existent.

Resend plutôt que Postmark ou SES : le code en garde les traces (`provider: 'resend'` en base, commentaire « drop-in replacement » dans `mailer.ts`), l'API est la plus proche de la signature actuelle, et le travail SPF/DKIM est identique dans les trois cas. SES serait moins cher à grande échelle — tu n'y es pas, et sa configuration est nettement plus lourde.

**En phase 1 et non en phase 3**, contrairement à ce que je proposais initialement : la phase 1 crée le point d'envoi unique, c'est exactement le moment où la bascule coûte le moins cher. Migrer après avoir câblé le dunning obligerait à repasser sur le même code.

### 5.2 Grâce `past_due` → 7 jours

Détaillé en phase 3. Aligné sur les Smart Retries de Stripe, avec bandeau dès le jour 1. La grâce sans avertissement visible ne fait que retarder la surprise.

### 5.3 Phase 2 → on corrige, front vérifié d'abord

`POST /quotes/send-email` retournera une erreur là où elle répondait `{ok:true}`. Une route qui affirme un envoi qui n'a pas eu lieu n'est pas un comportement à préserver. **Mais on lit le front appelant avant de déployer** : si l'erreur remonte en échec silencieux côté UI, on remplace un mensonge par un autre. L'erreur doit produire un message clair à l'utilisateur.

### 5.4 Ce que je ne peux pas décider — il me faut ça de toi

- **Le domaine d'envoi.** Resend exige un domaine vérifié avec SPF/DKIM. `lume.ca` ? autre chose ? Ça demande un accès DNS que je n'ai pas.
- **`RESEND_API_KEY`** dans `.env.local` et côté Railway pour la prod. Jamais dans le chat ni dans un commit (CLAUDE.md §7).

Ces deux points bloquent la sous-phase 1z uniquement. Les phases 0, 1a–1e et 2 avancent sans.

---

## 6. Ordre retenu

Phase 0 → 1 (dont 1z, bascule Resend) → 2 → 3 → 4 → 5 → 6.

Le raisonnement : le filet avant tout ; la fondation avant les emails ; la réparation avant l'ajout ; l'argent (dunning A6-A8, reçu client B9) avant le confort.

**Si la clé Resend et le domaine tardent** : les phases 0, 1a–1e et 2 se font sans. La sous-phase 1z se glisse dès que le DNS est prêt, avant la phase 3 — c'est la seule contrainte de calendrier, parce que le dunning doit partir sur un transport avec webhooks de bounce.

**Prochaine action** : phase 0 — tests de caractérisation sur les 10 sites d'envoi actuels. Aucun fichier de production modifié, aucune migration. C'est la phase la plus sûre du plan et elle conditionne toutes les suivantes.
