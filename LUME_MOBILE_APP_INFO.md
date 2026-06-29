# Lume Mobile App — Fiche récap complète
_Dernière mise à jour : 2026-06-29_

Fichier de référence regroupant tout ce qu'il faut savoir sur l'app mobile Lume. (Source : mémoire Claude + état du dépôt.)

---

## 1. Où vit le projet
- **Dépôt :** `/Users/williamhebert/Projects/lumeeeeeeeeee` (le dossier `/Users/williamhebert/Lume mobile app` n'existe PAS — toujours travailler dans `Projects/lumeeeeeeeeee`).
- **App mobile :** sous-dossier `mobile/`.
- **Branche git :** `mobile-app` (remote : github.com/olivier27stp-max/lumeeeeeeeeee).
- **Stack :** Expo SDK 56, expo-router, nativewind, react-query, Supabase.
- ⚠️ **Push bloqué** — pas d'auth GitHub sur cette machine (pas de gh, pas de clé SSH, pas de token). Les commits restent **locaux** tant que tu ne fais pas `gh auth login`. La branche `mobile-app` n'est PAS sur le remote (mobile = local seulement). Le repo est public (lecture OK) mais pousser exige un token en écriture.

## 2. Rôles & sécurité (role-adaptive)
- Réutilise le RBAC du desktop tel quel : `src/lib/permissions.ts` copié vers `mobile/src/lib/permissions.ts` — **garder synchronisé, ne pas forker**.
- Rôles depuis la table `memberships`.
- **Techniciens : zéro visibilité financière** (prix masqués au niveau data via `stripFinancialFields` + UI gated sur `canSeePricing`).
- **Mode app global** (`mobile/src/lib/view-mode.tsx`) : `tech` | `sales`. `sales_rep` verrouillé sur sales, `technician` sur tech, owner/admin peuvent switcher (persisté dans AsyncStorage `lume_view_mode`). Le switch est dans **More** (profile.tsx « Mode d'affichage »), pas sur Home.
- Tabs sales = **Classement · Map · Profil · ☰ More** (refonte inspirée Enzy).

## 3. Fonctionnalités construites
**Milestones M0–M8 :** sécurité prix, fondation rôles, photos de job (bucket job-photos), time tracking, features Jobber (signature client, SMS natif « en route », horaire semaine + route), carte D2D, lecture facturation admin, create/edit gated par rôle, cache offline + profils EAS.

**Home & navigation :** avatars DiceBear partout, Home redesign (header + cloche notifs + recherche client + carrousel « Today's Jobs »), tap job → feuille de job éditable, Horaire Jour/Semaine/Mois, messagerie 2 voies, notifications auto, recherche globale, dashboard owner, rappels de paiement 1-tap, écran referral.

**Côté TECH :** checklists/forms, tâches, notes/photos internes, champs personnalisés, visibilité paie, matériaux, multi-visites.

**Côté REP :** commissions, pipeline de leads + création, gamification (badges/défis/battles), RDV. Stats portes-à-portes, conversion, leaderboard avec recherche.

**Carte D2D = WebView Mapbox (PAS react-native-maps)** — Apple MapKit est bloqué sur l'iPhone (« la map load à l'infini »). Solution : `mobile/src/components/D2DWebMap.tsx` = Mapbox GL JS dans `react-native-webview`. GPS exact, choix de pin au long-press, zones d'équipe en polygones, dessin de zones admin/owner.

**Routes serveur joignables :** l'API `/api` du web déployé s'authentifie avec le **JWT Supabase** que l'app détient déjà → features serveur joignables sans nouveau code. `mobile/src/lib/api/server.ts` câble le vrai SMS Twilio avec fallback composer natif.

## 4. Paiements (Lume Payments)
- **Modèle :** plateforme **Stripe Connect** (modèle Jobber Payments). Chaque compagnie = compte Express connecté ; clients paient via destination charges ; Lume prend une application fee = revenu.
- **Marge = le spread, automatique :** fee = `PLATFORM_FEE_PERCENT`% + `PLATFORM_FEE_FIXED_CENTS`¢ (env, défaut 2.9% + 30¢). Payouts auto par Stripe. Baisser le taux Stripe agrandit le spread sans changer le code. (Délibérément PAS de `on_behalf_of`.)
- **Onboarding mobile construit :** `mobile/src/app/(app)/payments-setup.tsx` + wrappers dans `server.ts`, rangée « Paiements » dans profile.tsx (owner/admin). Ouvre l'onboarding Stripe hébergé via expo-web-browser.
- ⚠️ **BLOQUÉ — Stripe pas connecté :** aucun paiement en ligne ne marche tant que l'org n'a pas connecté Stripe Connect. Symptômes : facture « Payments unavailable », dépôt de soumission impayable. **Tout le code est prêt** — c'est juste l'onboarding KYC qui manque.
  - **Fix :** Desktop → **Settings → Payments** (`/settings/payments`) → « Connect Stripe ». OU via le nouvel écran mobile une fois le serveur déployé.
  - **À faire par toi (KYC/légal, non automatisable) :** activer Connect sur le Stripe de la plateforme, mettre `STRIPE_SECRET_KEY` + `STRIPE_CONNECT_WEBHOOK_SECRET` + `PLATFORM_FEE_*` dans Railway, compléter le KYC/banque plateforme.

## 5. Déploiement
- **Web/serveur :** **Railway** (PAS Vercel). URL : `https://lumeeeeeeeeee-production.up.railway.app` (déploie la branche `main`). Secrets dans Railway → Variables. CLI Railway pas installée localement.
- `EXPO_PUBLIC_WEB_URL` est réglé dans `mobile/.env.local` → active liens referral + liens de paiement facture/soumission.
- `EXPO_PUBLIC_MAPBOX_TOKEN` dans `mobile/.env.local` (token public Mapbox).

## 6. Migrations Supabase À LANCER manuellement (push bloqué)
- `20260702` job_time_logs
- `20260703` field_daily_stats_trigger
- `20260704` job_materials
- `20260705` push_tokens
- `20260706` peer_payout_visibility (sinon les pairs voient 0 $)
- `20260707` push_sender
Tant que job_materials/push_tokens ne sont pas lancées, ces features dégradent proprement (vides).

## 7. Build & test sur iPhone
- **Appareil :** « iPhone de William », udid `00008150-000142942204401C` (iPhone, iOS 26.x), USB. Équipe de signature `JSVKJG5N2D`. Bundle id de l'app courante : **com.wilheb.lumecrm** (« Lume CRM »).
- ⚠️ **DEUX icônes « Lume CRM » sur l'appareil :**
  - `com.williamhebert.lumecrm` (v1.0.0) = vieux build **Release**, ignore Metro, ne reçoit jamais les updates JS.
  - `com.wilheb.lumecrm` (v0.1.0) = **dev client Debug** qui hot-reload depuis Metro.
  - Quand « ça change pas » → suspecter d'abord qu'on ouvre la mauvaise icône.
- **L'utilisateur ne fait PAS les builds lui-même** (« tu le fais tjr tt seul ») — fais le rebuild pour lui.
- **Build Release qui marche (2026-06-28) :** `cd mobile && npx expo run:ios --configuration Release --device 00008150-000142942204401C` (en background, ~plusieurs min). Auto-signing OK sans env extra.
  - Normal pendant la compile : la vieille app affiche « loading from Metro » et hang — ne pas tuer le build, la nouvelle Release la remplace.
- **Dev client Debug** (hot-reload) : `npx expo start` + `PATH="/Users/williamhebert/.gem/ruby/2.6.0/bin:$PATH" RUBYOPT="-rlogger" npx expo run:ios --device <udid>`.
- Maps/caméra exigent un **dev build EAS** (pas Expo Go).

## 8. Gotchas durement gagnés
- **`job_line_items` INSERT RLS exige `created_by = auth.uid()`** — sinon le job sauve sans produits/prix en silence. (quote_line_items / invoice_items n'en ont PAS besoin.)
- **Ne jamais stocker un `Set`/`Map` comme data React Query** — la persistance offline sérialise en JSON, un Set se réhydrate en `{}` et `.has()` plante. Retourner des arrays.
- **Ne jamais spread la data React Query** (`[...list]`) — peut se réhydrater en `{}` non-array → crash Hermes. Utiliser `Array.isArray(x) ? x.slice() : []`.
- **Une seule colonne inexistante fait échouer tout le select PostgREST en silence** (ex : `billing_email` absent de `profiles`). Sélectionner seulement les colonnes qui existent.
- **Ajouter un module natif → rebuild du dev build obligatoire** (sinon crash natif EXC_BAD_ACCESS).
- **STALE JS BUNDLE :** un build Release peut réussir mais embarquer un VIEUX `main.jsbundle`. Préfixer **`FORCE_BUNDLING=1`** + purger les caches Metro (`rm -rf "$TMPDIR"/metro-cache ...`). Signal fiable = la **taille en octets** de `.app/main.jsbundle` change entre builds (pas `strings`/grep — Hermes = bytecode).
- **Device build timeout (erreur 70)** quand l'iPhone est verrouillé → builder avec `-destination 'generic/platform=iOS'` puis installer avec `xcrun devicectl device install app` (l'install seule a besoin du déverrouillage).
- **`pod install` cassé par défaut** (Ruby 2.6 système) → `RUBYOPT="-rlogger"` + gem bin sur PATH.
- **Profil Stripe provisioning expire** (compte Apple gratuit, 7 jours) → rebuild avec `-allowProvisioningUpdates`.
- **Un seul Metro + un seul build natif à la fois** (sinon `build.db` locké).
- **Ne pas faire tourner deux agents IA sur le même repo** (ils s'écrasent les fichiers).

## 9. Encore reporté (v2)
- Stripe natif in-app (mobile génère seulement un lien web).
- PDF facture/soumission (besoin d'un endpoint serveur de rendu).
- Vrai **sender** de push notifications (DB push_tokens + recette prêts ; besoin d'un compte Apple Developer payant + clé APNs + EAS projectId via `eas init` + lancer la migration push_sender).
- Auto-crédit referral (logique serveur).
- Contrat de porte / e-signature (marqué optionnel).
- Plan IA quotidien (« on est pas rendu là »).

---
_Note : ces infos sont des observations point-in-time. Toujours vérifier contre le code actuel avant d'affirmer un détail file:line._
