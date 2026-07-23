# Validation Google OAuth — Guide Lume CRM

> But : afficher « Lume » (au lieu de l'URL Supabase) sur l'écran de connexion Google
> et lever la limite de 100 utilisateurs, pour la fonction **Boîte de réception Gmail**.
>
> Ce document résume ce qui a été fait côté code (Étape 1, ✅ terminée) et ce qu'il
> reste à faire côté consoles (Étape 2, nécessite tes accès).

---

## Contexte : pourquoi cette validation est nécessaire

Le CRM permet aux utilisateurs de connecter leur boîte **Gmail** (Messages → Boîte de
réception). Cet accès passe par les **API Google** avec des scopes OAuth. Tant que
l'app n'est pas validée par Google :

- l'écran de connexion Google affiche l'URL technique Supabase au lieu de « Lume » ;
- l'app est plafonnée à **100 utilisateurs** ;
- Google affiche « Application non validée ».

---

## Étape 1 — Code (✅ TERMINÉE)

### Réduction du scope Gmail (évite l'audit de sécurité CASA)

**Avant :** `gmail.modify` — scope **RESTREINT** → exigeait un audit de sécurité
tiers (CASA), long et coûteux.

**Après :** `gmail.readonly` + `gmail.send` — scopes **SENSIBLES** seulement →
**pas d'audit CASA**, juste la validation standard.

Scopes désormais demandés (`server/lib/email/providers/gmail.ts`) :

```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/userinfo.email
openid
```

### Fonctions retirées (elles nécessitaient le scope restreint)

- Marquer lu / non-lu, archiver, mettre à la corbeille — retirées côté serveur
  (`server/lib/email/actions/gmail.ts` supprimé, route `/action` retirée) et UI
  (`EmailInbox.tsx`).
- **Conservé** : lire (Reçus / Envoyés / Corbeille en lecture), répondre, répondre
  à tous, transférer, nouveau message, pièces jointes.

### Page de confidentialité

- Nouvelle section **« Intégration Google / Gmail »** ajoutée à `/privacy`
  (bilingue FR/EN) : scopes demandés, engagement « Limited Use », non-utilisation
  pour la pub / l'entraînement IA, conservation/suppression, révocation d'accès.

### ⚠️ Effet de bord au déploiement

Les utilisateurs Gmail déjà connectés devront **se reconnecter une fois** (leur ancien
jeton portait le scope `modify`). L'UI affiche déjà la bannière « Reconnexion requise ».

---

## Étape 2 — Consoles (⏳ À FAIRE — nécessite tes accès)

Prérequis absolu : le CRM doit tourner sur **`lumecrm.net`** (domaine que tu possèdes),
PAS sur l'URL Railway. Google refuse de valider un sous-domaine `*.up.railway.app`.

### 2.1 — Brancher `lumecrm.net` sur Railway

1. Railway → projet Lume → service web → **Settings → Networking → Custom Domain**.
2. Ajouter `lumecrm.net` (et `www.lumecrm.net`).
3. Chez ton registraire (là où tu as acheté lumecrm.net) : ajouter les
   enregistrements DNS (CNAME / A) que Railway affiche.
4. Attendre la propagation + le certificat SSL (quelques minutes à quelques heures).
5. Dans Railway, mettre à jour la variable d'env **`FRONTEND_URL=https://lumecrm.net`**
   (utilisée par le serveur pour construire les URLs de callback).

### 2.2 — Google Search Console (prouver que tu possèdes le domaine)

1. Aller sur https://search.google.com/search-console
2. Ajouter une propriété **Domaine** : `lumecrm.net`
3. Suivre la vérification par enregistrement **TXT DNS** (chez ton registraire).
4. Utiliser le **même compte Google** que celui qui possède le projet OAuth.

### 2.3 — Google Cloud Console (écran de consentement OAuth)

Console → **APIs & Services → OAuth consent screen** :

- **App name** : `Lume`
- **User support email** : ton email
- **App logo** : logo Lume
- **Application home page** : `https://lumecrm.net`
- **Privacy policy URL** : `https://lumecrm.net/privacy`
- **Terms of service URL** : `https://lumecrm.net/terms`
- **Authorized domains** : `lumecrm.net`

Puis **APIs & Services → Credentials → (ton client OAuth Gmail)** :

- **Authorized redirect URIs** — ajouter EXACTEMENT :
  ```
  https://lumecrm.net/api/email/gmail/callback
  ```
  (le code construit cette URL ainsi : `${host}/api/email/${provider}/callback`)
- **Authorized JavaScript origins** :
  ```
  https://lumecrm.net
  ```

> Note : le client OAuth Gmail (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET) est SÉPARÉ
> du client OAuth Supabase (connexion « Se connecter avec Google »). Les deux
> peuvent devoir être mis à jour si les deux affichent l'URL Supabase.

### 2.4 — Page d'accueil publique

Google exige une home page publique (pas juste un login) décrivant l'app + liens
privacy/terms. `lumecrm.net/` doit donc afficher la page marketing (déjà présente
dans le code : routes marketing publiques), et non rediriger direct vers le login.
➡️ À vérifier une fois le domaine branché.

### 2.5 — Soumettre pour validation

OAuth consent screen → **Publish app** → **Prepare for verification** :

- Justifier chaque scope (pourquoi readonly + send sont nécessaires à la Boîte de
  réception).
- Fournir une **vidéo de démo** (YouTube non répertorié) montrant : connexion
  Google → écran de consentement → utilisation dans Lume.
- Soumettre.

**Délai attendu** : quelques jours à ~2 semaines (scopes sensibles, **sans** audit
CASA puisqu'on a retiré le scope restreint).

---

## Checklist rapide

- [x] Scope réduit à `readonly` + `send` (code)
- [x] Actions archive/lu/trash retirées (code)
- [x] Section Gmail ajoutée à /privacy (code)
- [x] Build + typecheck + 323 tests verts
- [ ] `lumecrm.net` branché sur Railway + `FRONTEND_URL` mis à jour
- [ ] Domaine vérifié dans Search Console
- [ ] Écran de consentement OAuth rempli (name, logo, home, privacy, redirect URI)
- [ ] Home page publique vérifiée sur lumecrm.net/
- [ ] Vidéo de démo enregistrée
- [ ] Soumis à Google
