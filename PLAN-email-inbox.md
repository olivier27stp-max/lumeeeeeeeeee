# Plan d'exécution — Inbox Gmail & Outlook DANS la page Messages

> **Règle d'or : on ne casse rien.** Le SMS de `src/pages/Messages.tsx` continue de marcher exactement
> comme avant. L'email est **ajouté à l'intérieur** de cette même page via un sélecteur `SMS · Email`.
> Aucune régression sur l'existant.

**Cadrage validé :** OAuth API officielle · client complet · **une boîte perso par owner** · greffé sur Messages.

---

## 🔑 Découverte clé (ce qui change le plan)

Ton projet a DÉJÀ une infra d'intégrations OAuth complète dans `server/lib/integrations/` :
flux OAuth (state CSRF, échange de code, callback), chiffrement AES-256-GCM (`src/lib/crypto.ts`,
clé `PAYMENTS_ENCRYPTION_KEY`), refresh auto des tokens, registry de providers, audit log.

**MAIS** elle est scopée **par org** : `app_connections` est `unique(org_id, app_id)` avec RLS owner/admin.
Or on veut **une boîte perso par owner** → une connexion par `(user_id)`, pas par org.

**Décision d'archi :** on **réutilise la mécanique** (crypto, forme des providers OAuth, logique
d'échange/refresh) mais dans une **table dédiée `email_accounts`** scopée `(org_id, user_id, provider)`.
→ Zéro impact sur `app_connections` et les intégrations existantes. Isolation par owner respectée.

---

## Garde-fous anti-régression (à vérifier à CHAQUE étape)

- [ ] Le SMS fonctionne toujours (envoi + réception + temps réel) — c'est le canal par défaut.
- [ ] On n'édite JAMAIS `app_connections`, `service.ts`, ni les providers existants (stripe/slack/qb/twilio).
- [ ] `src/lib/crypto.ts` : on l'**importe**, on ne le modifie pas.
- [ ] Nouvelle table, nouvelles routes, nouveau provider-registry email → tout est additif.
- [ ] TypeScript strict, validation Zod, `getServiceClient()` pour les ops admin, RLS sur la table.

---

## Étape 1 — Socle : connexion des comptes email (OAuth)

**But testable :** un owner clique « Connecter Gmail », fait l'OAuth Google, revient dans l'app,
et voit son compte listé comme *connecté*. Le refresh token est chiffré en base.

**Fichiers créés :**
| Fichier | Rôle |
|---------|------|
| `supabase/migrations/<ts>_email_accounts.sql` | Table `email_accounts` + index + RLS (owner voit SES comptes) + trigger updated_at |
| `server/lib/email/types.ts` | Types provider email (calqués sur `integrations/types.ts`) |
| `server/lib/email/crypto.ts` | Ré-export de `encryptSecret`/`decryptSecret` (comme `integrations/crypto.ts`) |
| `server/lib/email/providers/gmail.ts` | Provider Gmail : `buildAuthorizeUrl`, `exchangeCode`, `refreshToken`, `getProfile` |
| `server/lib/email/providers/outlook.ts` | Provider Outlook (Microsoft Graph) : idem |
| `server/lib/email/providers/index.ts` | Registry + `registerAllEmailProviders()` |
| `server/lib/email/accountService.ts` | connect / list / disconnect / refresh, scopés `(org_id, user_id)` |
| `server/routes/email-accounts.ts` | `/api/email/accounts` : start OAuth, callback, list, disconnect |
| `src/lib/emailInboxApi.ts` | Client front : `listAccounts`, `startConnect`, `disconnect` |

**Fichiers modifiés (additif seulement) :**
- `server/index.ts` → monter `emailAccountsRouter` + rate limiter sur `/api/email`
- `src/App.tsx` → réutiliser `/apps/callback` OU ajouter `/email/callback` (à décider)
- `.env.local` → `GMAIL_CLIENT_ID/SECRET`, `MS_CLIENT_ID/SECRET` (fournis par toi)

**Schéma `email_accounts` :**
```
id uuid pk · org_id uuid · user_id uuid (owner) · provider text ('gmail'|'outlook')
email_address text · encrypted_access_token text · encrypted_refresh_token text
token_expires_at timestamptz · history_id text · delta_link text (sync incrémentale)
status text ('connected'|'error'|'reconnect_required') · scopes text[]
last_synced_at · connected_at · created_at · updated_at
unique(user_id, provider, email_address)
RLS: user_id = auth.uid()  (chaque owner ne voit QUE ses comptes)
```

**⚠️ Bloqueur externe (toi) :** clés OAuth Google Cloud + Azure. Le code marche dès qu'elles sont là.

---

## Étape 2 — Synchronisation en lecture

**But testable :** les vrais emails reçus de l'owner apparaissent en base et via un endpoint.

- `supabase/migrations/<ts>_email_messages.sql` → `email_threads` + `email_messages`
  (from/to/cc, subject, snippet, body_html, is_read, has_attachments, provider_message_id, thread_id, folder).
- `server/lib/email/sync/gmail.ts` + `outlook.ts` → sync initiale + incrémentale (History API / Graph delta).
- `server/routes/email-inbox.ts` → `GET /api/email/threads`, `GET /api/email/threads/:id`.
- Adaptateur commun `EmailProvider` (interface) → un adapter Gmail, un adapter Graph.

---

## Étape 3 — L'onglet Email DANS Messages *(le point sensible)*

**But testable :** dans la page Messages, bascule `SMS · Email`, on lit ses vrais threads.

**Approche non-invasive pour `Messages.tsx` :**
- Ajouter un state `channel: 'sms' | 'email'` + le sélecteur segmenté en tête de sidebar.
- Extraire le rendu email dans un **composant séparé** `src/components/messages/EmailInbox.tsx`
  (liste + thread), pour ne pas alourdir `Messages.tsx`.
- `channel === 'sms'` → rendu SMS actuel INCHANGÉ. `channel === 'email'` → `<EmailInbox />`.
- Réutiliser `UnifiedAvatar`, les helpers de date, le style existant (cf. maquette validée).

---

## Étape 4 — Envoi & réponse

- `POST /api/email/send` → Gmail `messages.send` / Graph `sendMail`, threading RFC 2822 (`In-Reply-To`, `References`).
- UI : zone Répondre dans le thread + modal Composer. Brouillons optionnels.

---

## Étape 5 — Client complet

- Marquer lu/non lu, archiver, supprimer → propagés à la vraie boîte (Gmail modify / Graph).
- Pièces jointes (téléchargement + envoi). Recherche. Dossiers (Inbox/Envoyés/Brouillons).

---

## Étape 6 — Temps réel

- Gmail push (Pub/Sub) + Graph subscriptions → webhook `/api/email/webhook`.
- Cron de renouvellement des abonnements (ils expirent). **Fallback polling** en attendant. *(décision ouverte)*

---

## Décisions

- ✅ **Gmail + Outlook en parallèle** dès l'étape 1 (les deux providers branchés ensemble).
- ✅ **Callback : page `/email/callback` dédiée** — isolée du flux Apps existant, renvoie vers l'onglet Messages.
- ❓ **Temps réel** : polling d'abord (rapide) puis push, ou push direct ? → *en attente* (concerne l'étape 6).

---

## À préparer côté consoles (toi, en parallèle)

**Google Cloud :** projet + Gmail API activée · écran de consentement OAuth · test users ·
`GMAIL_CLIENT_ID`/`SECRET` · **lancer la vérif CASA (long pole, plusieurs semaines)**.
**Azure :** App registration · permissions `Mail.Read`, `Mail.Send`, `offline_access` · client secret · `MS_CLIENT_ID`/`SECRET`.

---

*Plan vivant — Étape 1 prête à démarrer. Le code sera écrit sans jamais toucher au chemin SMS existant.*
