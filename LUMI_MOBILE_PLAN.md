# Lumi sur mobile — audit et plan

> Rédigé pour : William (décideur produit) + l'agent qui implémente.
> Date : 2026-09-30. Dépôt mobile : `/Users/williamhebert/Projects/lumeeeeeeeeee`, branche `mobile-app`.
> Dépôt web/serveur de référence : `/Users/williamhebert/Lume desktop/lumeeeeeeeeee`, branche `main`.

---

## Phase 0 — Audit (lecture seule)

### 0.1 La stack mobile

| Élément | Ce qui existe |
|---|---|
| Framework | Expo SDK **56**, React Native 0.85.3, React 19.2.3, TypeScript strict |
| Navigation | **expo-router** (fichiers). `src/app/(app)/(tabs)/_layout.tsx` = `<Tabs>` **barre d'onglets en bas, sans pager ni swipe**. L'ordre des onglets = l'ordre de déclaration des `<Tabs.Screen>` ; un onglet se cache avec `href: null` |
| Style | **nativewind v4** (Tailwind). Jetons dans `mobile/tailwind.config.js`, copiés du web : `brand` (#171717), `ink`/`ink-muted`/`ink-subtle`, `surface`/`surface-alt`/`surface-border`, `entity.*`, `status.*`, rayons `rounded-3xl` |
| Icônes | **expo-symbols** (`SymbolView`, SF Symbols) monochromes, teintées par la couleur de l'onglet |
| State / cache | `@tanstack/react-query` + persistance AsyncStorage (`query-async-storage-persister`), mutations en file d'attente hors ligne (`src/lib/offline/`) |
| Session Supabase | `src/lib/supabase.ts` — stockage **SecureStore chiffré** (`SecureStorageAdapter`), `autoRefreshToken`, PKCE, refresh piloté par `AppState` |
| Appels serveur | `src/lib/api/server.ts` — `serverGet/Post/Put` vers `EXPO_PUBLIC_WEB_URL + /api`, en-têtes `Authorization: Bearer <jwt>` + `x-org-id`, **avec refresh-et-rejoue sur 401** |
| RBAC | `src/lib/permissions.ts` (copie du web), `usePermissions().can(clé)` |
| Forfait | `src/lib/usePlanFeature.ts` — `includes_ai` existe déjà dans le type `PlanFeatureFlag` |
| i18n | `src/lib/i18n/` — `useTranslation() → { language, setLanguage, t }`, dictionnaires `fr.ts`/`en.ts` copiés du web (4 874 lignes), + `tr()` pour le code non-React |
| Hors ligne | `src/components/OfflineBanner.tsx` (NetInfo) monté dans `(app)/_layout.tsx` |
| Écrans | `ScreenContainer` (SafeAreaView + KeyboardAvoidingView), `ui/Button`, `ui/Card`, `ui/Input`, `CircleButton` |

**Le pattern desktop → mobile déjà appliqué partout** : le mobile ne reconstruit jamais la logique métier. Il copie les *règles* (`permissions.ts`, dictionnaires i18n) et appelle les *mêmes routes serveur* que le web avec le JWT Supabase (commentaire en tête de `src/lib/api/server.ts`). Quand une opération doit être serveur (Twilio, SMTP, Stripe), le mobile appelle la route existante — il ne refait pas l'intégration.

### 0.2 L'implémentation web de Lumi

| Point | Détail |
|---|---|
| Page | `src/pages/Lumi.tsx` (924 lignes), route `/lumi`, **gardée** `<Gated permission="external_agent.use">` + `<PlanFeatureGate flag="includes_ai">` |
| Client API | `src/lib/lumiApi.ts` (286 lignes) — **toute la surface est là** |
| Cartes de confirmation | `src/components/lumi/CarteAutorisation.tsx` (438 lignes) + `FichesLiees` + `avecLiensFiches` |
| Serveur | `server/routes/lumi.ts` (1 110 lignes) + `server/lib/lumi/*` (31 modules, 6 484 lignes) |
| Auth serveur | `requireAuthedClient` : **`Authorization: Bearer` + `x-org-id` uniquement — aucun cookie**. `x-org-id` n'est honoré que si `has_org_membership` le confirme, sinon 403 `org_forbidden` |

**Endpoints** (tous sous `/api`) :

| Méthode | Chemin | Rôle |
|---|---|---|
| POST | `/lumi/chat` | `{conversation_id?, message, language, origine?}` → **SSE** |
| POST | `/lumi/action` | raccourci nommé (étage 0, 0 token) → SSE, ou **422** = repli sur le texte |
| POST | `/lumi/execute` | `{conversation_id, tool_use_id, decision: confirm\|cancel\|dry_run}` → SSE |
| GET/PUT | `/lumi/mode` | mode de confirmation : `demander` \| `argent` \| `tout` |
| GET/PUT | `/lumi/autorisations` | outils en « toujours confirmer » |
| GET | `/lumi/quota` | budget du mois (`BudgetLumi`) |
| GET | `/lumi/conversations` | liste |
| GET | `/lumi/conversations/:id` | messages rendus + usage |
| DELETE | `/lumi/conversations/:id` | suppression |
| POST | `/agent/transcribe` | dictée : `{audio: base64, mimeType, language}` → `{text}` |

**Transport de streaming** : **SSE sur une requête POST**. `EventSource` ne fait que du GET, donc le web lit `res.body.getReader()` et découpe `event: x\ndata: {...}\n\n` à la main (`lireFlux`, `src/lib/lumiApi.ts`). **L'interface ne renvoie jamais l'historique** : le serveur le garde (`lumi_conversations` / `lumi_messages`) et le rejoue.

**Événements du flux** (`EvenementFlux`) : `text` (delta) · `tool` (`debut`/`fin`/`refus`) · `proposal` (+ `groupe` pour plusieurs écritures) · `fiches` · `executed` (reçu) · `report` · `usage` · `done` (+ `conversation_id`, `budget`) · `error`.

**Format des messages** (`MessageLumi`) : `{role, text, tools[], usage?, proposal?, report?, fiches?}`.

**Suggestions de départ** — 4, et ce sont des **actions nommées** (`SuggestionLumi { label, action, params }`), pas du texte : revenu du mois · factures en retard · journée de demain · meilleurs clients.

**i18n** : Lumi web **n'utilise pas le dictionnaire** — tous ses textes sont des ternaires `fr ? '…' : '…'` en dur dans le composant.

### 0.3 Le pipeline vocal web

| Étage | Ce que fait le web |
|---|---|
| **Dictée** | `useVoiceInput` (`src/features/agent/hooks/useVoiceInput.ts`). Web Audio → PCM → **WAV 16 kHz mono** encodé dans le navigateur → `POST /api/agent/transcribe`. Arrêt auto après 2,5 s de silence, max **60 s**. Aperçu en direct via la Web Speech API (`SpeechRecognition`) — *aperçu seulement*, le texte final vient toujours du serveur |
| **STT (fournisseur)** | **Gemini 2.5 Pro** (`server/lib/agent/transcribe.ts`, `GEMINI_TRANSCRIBE_MODEL`), audio en `inlineData`, prompt de transcription québécois. Clé serveur uniquement. Plafond journalier propre (source `voix`), tracé dans `lumi_traces` |
| **TTS** | `useSpeakReplies` — **`window.speechSynthesis` du navigateur**. Aucun endpoint serveur, aucun fournisseur. Déclenché **seulement si la question a été posée au micro**, désactivable, choix mémorisé en `localStorage` |
| **Interruptions** | `speechSynthesis.cancel()` à chaque envoi et au clic sur le bouton haut-parleur |
| **Mode conversation** | **N'EXISTE PAS.** Il n'y a ni boucle écoute↔parole, ni overlay, ni barge-in, ni realtime |

**Rien ne part tout seul** : la transcription remplit la zone de saisie, l'utilisateur relit et envoie lui-même.

### 0.4 Tous les éléments interactifs de Lumi web

| # | Élément | Comportement |
|---|---|---|
| 1 | Badge budget (en-tête) | Affichage seul : `dépensé / budget`, rouge à ≥ 90 %. Coût de la conversation à côté. Comptes `@lume-test.ca` : modèle + tokens en plus |
| 2 | Bouton **Mode de confirmation** (bouclier) | Menu 3 choix : *Demander à chaque fois* / *Confirmer l'argent et les envois* / *Tout faire sans demander*. `PUT /lumi/mode`. « tout » refusé au non-propriétaire (`mode_reserve_proprietaire`) |
| 3 | Bouton **Historique** | Menu des conversations ; clic = `ouvrirConversation(id)` |
| 4 | **Corbeille** par conversation | `confirmer()` puis `DELETE /lumi/conversations/:id` |
| 5 | Bouton **Nouvelle conversation** | Coupe le flux, vide l'écran, remet `conversation_id` à `null` |
| 6 | **Gros bouton micro** (état vide) | Démarre/arrête la dictée. Chrono `m:ss` |
| 7 | **4 suggestions** | `POST /lumi/action`. Sur 422 → renvoie le texte à `/lumi/chat` |
| 8 | **Bloc « Lumi réfléchit… »** | `<details>` repliable : disque animé, durée, coût, liste des outils avec libellés en clair |
| 9 | Texte de la réponse | Markdown maison : `**gras**`, puces, `###` titres, **tableaux**. Les noms de fiches deviennent des liens |
| 10 | **Carte de rapport** | Titre, sous-titre, jusqu'à 6 KPI, **bouton « Télécharger le PDF »** (jsPDF à la demande) |
| 11 | **Carte d'autorisation** | Titre « Lumi veut … », résumé, pastille d'état, `<details>` avec **l'aperçu réel** (devis/facture rendu comme la page publique, texto, courriel, fusion), puis **Confirmer** / **Toujours confirmer *les devis*** / **Refuser** |
| 11b | Carte **groupée** | N lignes repliables, chacune son état et son reçu. Une seule confirmation pour tout |
| 11c | Carte devenue **reçu** | « Devis Q-0043 créé » + **Ouvrir** + **Envoyer à *Marie*** (relance une demande en langage courant) + « Redemander à chaque fois » |
| 12 | **Fiches liées** | Puces sous la réponse → page de la fiche, avec le montant |
| 13 | Ligne **Sources** | Quand pas de fiches : liens vers la page du CRM consultée par chaque outil |
| 14 | **Copier** (survol) | `navigator.clipboard` |
| 15 | **Réessayer** (survol) | Relance la dernière question utilisateur avec `origine: 'repli'` |
| 16 | Bandeau d'erreur | Messages dédiés : `ralenti`, `http_429`, `quota_epuise`, `plan_sans_lumi` (+ bouton « Voir les plans »), `lumi_not_configured`, `voix` (s'efface après 6 s) |
| 17 | **Zone de saisie** | Multiligne, max 160 px, Entrée = envoyer, Maj+Entrée = saut de ligne |
| 18 | **Micro** (barre) | Idem #6, avec chrono et état « Transcription… » |
| 19 | **Haut-parleur** | Bascule la lecture des réponses ; si ça parle, le clic **arrête** |
| 20 | **Envoyer** | Envoie. Pendant le flux : roue. *(Le web n'a **pas** de bouton « stop ».)* |

---

## Phase 1 — Plan

### 1.1 Tableau de parité

| # | Web | Mobile | Statut |
|---|---|---|---|
| — | Endpoint `/api/lumi/*` | **Les mêmes**, via `expo/fetch` | ✅ zéro fork |
| — | SSE sur POST, `body.getReader()` | **`expo/fetch`** expose un vrai `ReadableStream` → `lireFlux` réutilisé tel quel | ✅ vérifié dans `node_modules/expo/src/winter/fetch/FetchResponse.ts` |
| — | Auth `Bearer` + `x-org-id` | Idem, via le refresh-et-rejoue de `api/server.ts` | ✅ aucun changement serveur |
| — | Historique côté serveur | **Partagé de fait** : même table, même endpoint | ✅ |
| 1 | Badge budget | Pastille dans l'en-tête | ✅ |
| 2 | Mode de confirmation | Feuille (ActionSheet) 3 choix | ✅ |
| 3 | Historique | **Drawer** (modal latéral), comme demandé | ✅ |
| 4 | Supprimer une conversation | Balayage ou appui long + `Alert` | ✅ |
| 5 | Nouvelle conversation | Bouton d'en-tête | ✅ |
| 6/18 | Micro (dictée) | `expo-audio` → m4a/AAC → même endpoint | ✅ (**nouvelle dépendance native**) |
| — | Aperçu en direct pendant qu'on parle | **Pas d'équivalent natif sans 2ᵉ fournisseur** | ⚠️ écart assumé — on affiche le chrono + le niveau sonore |
| 7 | 4 suggestions | Idem, mêmes libellés, même `/lumi/action` + repli 422 | ✅ |
| 8 | Bloc « Lumi réfléchit » | Repliable natif, mêmes libellés d'outils | ✅ |
| 9 | Markdown (gras, puces, titres, tableaux) | Rendu porté en `<Text>`/`<View>`, tableau dans un `ScrollView` horizontal | ✅ |
| 10 | Carte de rapport + PDF | Carte identique ; PDF via **`expo-print` + `expo-sharing`** (déjà installés, déjà utilisés par `lib/pdf.ts`) | ✅ |
| 11 | Carte d'autorisation + aperçus | Portée à l'identique (devis, facture, texto, courriel, fusion) | ✅ |
| 11b | Groupes | Idem | ✅ |
| 11c | Reçu + Ouvrir + Envoyer à X | Idem ; « Ouvrir » = **deep link natif** | ⚠️ voir 1.6 |
| 12 | Fiches liées | Puces → deep link | ⚠️ voir 1.6 |
| 13 | Sources | Liens vers les onglets mobiles | ✅ |
| 14 | Copier | **`expo-clipboard`** (nouvelle dépendance) | ✅ |
| 15 | Réessayer | Idem | ✅ |
| 16 | Erreurs | Mêmes codes, mêmes messages | ✅ |
| 17 | Saisie | `TextInput` multiligne auto-grandissant | ✅ |
| 19 | Lecture des réponses | **`expo-speech`** (nouvelle dépendance) — voir 1.4 | ✅ |
| 20 | Envoyer | Envoyer **qui devient « stop »** pendant le flux | 🟡 **demandé par la mission, le web ne l'a pas** — c'est un `AbortController`, aucune logique d'agent ajoutée |
| — | **Mode conversation vocal** | **N'existe pas sur le web** | 🔴 **décision requise — voir 1.7** |
| — | **Dark mode** | **L'app mobile est claire uniquement** | 🔴 **décision requise — voir 1.7** |
| — | Haptics | **L'app n'en a aucun, nulle part** | 🔴 **décision requise — voir 1.7** |

### 1.2 Architecture de connexion

```
Écran Lumi (mobile)
        │  supabase.auth.getSession() → JWT (SecureStore), refresh si < 60 s
        │  AsyncStorage(ACTIVE_ORG_KEY) → x-org-id
        ▼
expo/fetch  POST {EXPO_PUBLIC_WEB_URL}/api/lumi/chat     ← MÊME route que le web
        │   Authorization: Bearer <jwt> · x-org-id · Content-Type: application/json
        ▼
server/routes/lumi.ts → requireAuthedClient (vérifie has_org_membership)
        → plan includes_ai · budget · RBAC external_agent.use · orchestrateur
        ▼
res.body : ReadableStream → lireFlux() → EvenementFlux → même réducteur qu'au web
```

- **Aucune clé API côté client.** La seule chose que le mobile détient est le JWT Supabase qu'il a déjà.
- **Tenant et RBAC 100 % serveur.** Le mobile n'envoie pas de rôle ; il envoie son JWT et l'`org_id` actif, que le serveur revalide.
- **Historique partagé** : le mobile ne renvoie jamais la conversation, exactement comme le web. Une conversation ouverte sur le web se poursuit sur mobile par son `conversation_id` et inversement — c'est une conséquence de l'architecture serveur, pas une synchronisation à écrire.
- **Aucune migration DB. Aucun changement de contrat d'API.**

**Gestion des erreurs** (chaque cas a un état + un bouton « Réessayer ») :

| Cas | Traitement |
|---|---|
| Réseau | `ServerError(status 0)` → bandeau + « Réessayer » |
| **401 / token expiré** | `freshToken(force)` puis **rejeu une fois** (logique déjà écrite dans `api/server.ts`, portée au flux) ; 2ᵉ échec → « Reconnecte-toi » |
| Timeout | `AbortController` à 120 s → « Lumi n'a pas répondu à temps » + Réessayer |
| **Stream coupé en vol** | Le texte déjà reçu reste affiché, le message sort de l'état « en cours », bandeau + Réessayer |
| 402 / plan | Message `plan_sans_lumi` + bouton vers les forfaits |
| 429 / plafond | Messages `http_429`, `ralenti`, `quota_epuise` (identiques au web) |

### 1.3 Plan d'écrans et de composants

**Navigation — l'onglet**

`src/app/(app)/(tabs)/_layout.tsx` : un seul `<Tabs.Screen name="lumi">` **déclaré juste après `index`**. Comme l'ordre des onglets suit l'ordre de déclaration et que les onglets masqués portent `href: null`, cette position unique donne le bon résultat dans les deux modes :

- mode technicien : `Accueil · **Lumi** · Horaire · Temps · Formations · Carte · Plus`
- mode vendeur : `Classement · **Lumi** · Horaire · Carte · Profil · Plus`

Garde : `can('external_agent.use') && usePlanFeature('includes_ai').hasFeature`, sinon `href: null` — mêmes deux gardes que la route web.
⚠️ *La barre passe à 7 onglets en mode technicien ; c'est serré sur iPhone SE. Signalé, pas corrigé : réduire la barre dépasse le mandat.*

**Fichiers à créer**

| Fichier | Rôle |
|---|---|
| `mobile/src/lib/api/lumi.ts` | Port de `src/lib/lumiApi.ts` : **tous les types repris à l'identique** + les 9 endpoints + `lireFlux` sur `expo/fetch` |
| `mobile/src/app/(app)/(tabs)/lumi.tsx` | L'écran : en-tête, fil, composer |
| `mobile/src/components/lumi/TexteLumi.tsx` | Markdown → RN (gras, puces, titres, tableaux, liens de fiches) |
| `mobile/src/components/lumi/CarteAutorisation.tsx` | Cartes d'action + aperçus + groupes + reçus |
| `mobile/src/components/lumi/CarteRapport.tsx` | Rapport + PDF (expo-print) |
| `mobile/src/components/lumi/HistoriqueDrawer.tsx` | Tiroir des conversations |
| `mobile/src/components/lumi/BlocReflexion.tsx` | « Lumi réfléchit… » repliable |
| `mobile/src/lib/lumi/useDictee.ts` | expo-audio → base64 → `/api/agent/transcribe` |
| `mobile/src/lib/lumi/useLectureVocale.ts` | expo-speech |
| `mobile/src/lib/lumi/deepLinks.ts` | `href` serveur → route expo-router |

**Fichiers modifiés** : `(tabs)/_layout.tsx`, `app.json` (plugins + `NSMicrophoneUsageDescription`), `package.json`, `src/lib/i18n/{fr,en}.ts`.

**Mise en page (style ChatGPT mobile)**

```
┌─────────────────────────────┐
│ ☰   Lumi  ✦        + │ safe-area top, insets.top
│     0,42 $ / 5,00 $   🛡    │
├─────────────────────────────┤
│  (vide) mascotte · micro    │
│  Salutation + 4 suggestions │
│                             │
│  ┌──────────────┐           │  Lumi : pleine largeur,
│  │ moi, à droite│           │  avatar 28 px à gauche
│  └──────────────┘           │
│  ◐ Lumi réfléchit…          │
│  Texte markdown             │
│  ┌ Carte d'autorisation ──┐ │
│  │ Confirmer│Toujours│Refus│ │
│  └───────────────────────┘ │
│                       [ ↓ ] │  visible si remonté
├─────────────────────────────┤
│ ┌─────────────────────────┐ │  collé au clavier,
│ │ Écris à Lumi…           │ │  KeyboardAvoidingView
│ │ 🎤  🔊              ( ↑ )│ │  ↑ devient ■ en flux
│ └─────────────────────────┘ │
└─────────────────────────────┘  home indicator respecté
```

- **Auto-scroll** : `onScroll` mesure la distance au bas ; > 80 px = l'utilisateur a repris la main → on arrête de suivre et on affiche le bouton `↓`.
- **Tab bar cachée au clavier** : `Keyboard.addListener` + `navigation.setOptions({ tabBarStyle: { display: 'none' } })`.
- **Appui long sur un message** : feuille d'actions **Copier** / **Réessayer** — exactement les deux actions du web (#14, #15), rien de plus.
- **Hors ligne** : NetInfo → bandeau, envoi désactivé, brouillon conservé (state + AsyncStorage), historique lu depuis le cache react-query en lecture seule.
- **Accessibilité** : `accessibilityLabel` sur chaque bouton (repris des `aria-label` du web), cibles ≥ 44 px, `accessibilityRole`.

### 1.4 Plan vocal

**Même fournisseur que le web, justifié point par point :**

| Étage | Web | Mobile | Justification |
|---|---|---|---|
| **STT** | Gemini 2.5 Pro via `POST /api/agent/transcribe` | **Le même endpoint, le même modèle** | Aucune clé côté client, aucun fournisseur ajouté. Le serveur accepte déjà `audio/mp4` — c'est justement ce que produit `expo-audio` (AAC/m4a) sur iOS **et** Android. Aucun changement serveur |
| **TTS** | `window.speechSynthesis` (Web Speech API) | **`expo-speech`** | La Web Speech API n'existe pas en natif. `expo-speech` est son équivalent exact : il pilote `AVSpeechSynthesizer` (iOS) et `android.speech.tts.TextToSpeech` (Android), c'est-à-dire **les moteurs de l'OS que le navigateur utilisait déjà par en dessous**. Même fournisseur de fait, gratuit, hors ligne, mêmes voix `fr-CA` / `en-US`. Aucun service tiers |

**Dictée (parité stricte, à construire)**
1. Appui sur 🎤 → permission → `expo-audio` enregistre (AAC, mono, 16 kHz).
2. Chrono + niveau sonore ; **arrêt auto après 2,5 s de silence**, **plafond 60 s** (mêmes constantes que `useVoiceInput`).
3. `expo-file-system` lit le fichier en base64 → `POST /api/agent/transcribe`.
4. Le texte **remplit la zone de saisie**. **Rien ne part tout seul** — l'utilisateur relit et envoie, comme sur le web.
5. Si la question est partie du micro, la réponse est lue à voix haute (bascule 🔊, choix mémorisé — comme le `localStorage` du web).

**Cas natifs couverts par la dictée**

| Cas | Traitement |
|---|---|
| Permission micro refusée | État propre + bouton **« Ouvrir les réglages »** (`Linking.openSettings()`) — le web ne pouvait donner que des instructions écrites ; le natif peut faire mieux |
| Session audio | `expo-audio` : `playsInSilentMode` pour que la lecture s'entende **malgré le mode silencieux iOS** ; catégorie `record` pendant l'enregistrement, `playback` pendant la lecture |
| Mode silencieux iOS | Couvert par la ligne ci-dessus |
| Écouteurs / Bluetooth | `allowsRecordingIOS` + routage par défaut de l'OS (`AVAudioSession` gère la bascule) |
| Appel entrant | `AppState` passe à `inactive`/`background` → on **arrête** l'enregistrement et la lecture, sans perdre le texte déjà saisi |
| App en arrière-plan | Idem : arrêt propre, le brouillon survit |

**Mode conversation** → **bloqué sur décision, voir 1.7**.

### 1.5 Deep links (cartes et fiches)

`server/lib/lumi/fiches.ts` produit des `href` web : `/clients/:id`, `/jobs/:id`, `/quotes/:id`, `/invoices/:id`, `/tasks`.

| href serveur | Route mobile | Statut |
|---|---|---|
| `/clients/:id` | `/(app)/clients/[id]` | ✅ |
| `/jobs/:id` | `/(app)/jobs/[id]` | ✅ |
| `/tasks` | `/(app)/tasks` | ✅ |
| `/quotes/:id` | **aucune** (mobile n'a que `quotes/new`, `quotes/send`) | ⚠️ |
| `/invoices/:id` | **aucune** (mobile n'a que `invoices/new`, `invoices/send`) | ⚠️ |

**Repli retenu** : pour un devis ou une facture, le lien ouvre la **fiche du client** quand Lumi la connaît, sinon le bouton « Ouvrir » est **masqué** plutôt que de mener à un écran mort. Aucun écran nouveau n'est créé — ce serait hors mandat.

⚠️ **À savoir** : un devis créé par Lumi part dans la table que lit le **web** ; le mobile a sa propre table `quotes` (divergence antérieure, documentée dans `src/lib/api/server.ts`). Un devis créé via Lumi mobile **n'apparaîtra donc pas dans la liste des devis du mobile**. C'est un écart de modèle de données préexistant, hors mandat, à traiter à part.

### 1.6 Dépendances natives à ajouter

`expo-audio` · `expo-speech` · `expo-clipboard` (+ `expo-haptics` si retenu).

⚠️ **Conséquence opérationnelle** : ce sont des modules **natifs** → il faut **reconstruire le client de développement** (`npx expo run:ios --device …`). Le client déjà installé sur l'appareil **ne suffira pas**. Vu l'historique de signature (Apple ID Xcode déconnecté, profil gratuit à 7 jours), c'est le vrai risque de calendrier de ce chantier — pas le code.

### 1.7 Décisions prises (2026-09-30) et risques restants

**Tes trois arbitrages, et ce qui a été livré en conséquence :**

| Question | Ta réponse | Ce qui a été fait |
|---|---|---|
| Mode conversation vocal | « oui juste dictée pour l'instant » | **Dictée seule**, en parité stricte avec le web. L'overlay écoute/réfléchit/parle n'est pas codé. Les hooks `useDictee` / `useLectureVocale` sont séparés, donc l'ajouter plus tard ne demandera pas de reprendre l'écran |
| Mode sombre | « sur mobile tu peux mettre en dark […] pareil que ce que le user choisit sur web mais possibilité de changer » | Lumi suit **l'apparence du téléphone** par défaut, avec un réglage *Comme le téléphone / Clair / Sombre* dans la feuille du bouclier. ⚠️ Voir la limite ci-dessous |
| Haptiques | « choisis » | **Ajoutés, discrets** : léger à l'envoi et au démarrage/arrêt du micro, moyen à la confirmation d'une action, réussite au reçu. Rien ailleurs |

⚠️ **Ce que « pareil que le web » ne peut pas faire, et pourquoi.** Le web garde son thème dans `localStorage['lume-theme']` (`src/App.tsx`) — donc **dans le navigateur, pas sur le compte**. Il n'y a rien que le téléphone puisse lire. Faire vraiment suivre le choix demanderait d'écrire la préférence sur le compte (`auth user_metadata`, exactement comme la langue le fait déjà dans `lib/i18n`), ce qui veut dire **modifier le web hors de Lumi** — hors mandat. **En attente de ton OK.** En attendant, le téléphone est la meilleure approximation disponible, et le réglage manuel couvre le reste.

⚠️ **Un changement app-wide assumé** : `app.json` passe de `"userInterfaceStyle": "light"` à `"automatic"`. Sans ça, iOS force le thème clair et `useColorScheme()` ne peut pas voir le choix du téléphone. Conséquence : sur un téléphone en sombre, les surfaces **natives** de toute l'app (alertes, sélecteurs de date, clavier) passent en sombre, alors que les écrans restent clairs. C'est une ligne, réversible. **Dis-moi si tu préfères revenir à `"light"`** — Lumi garderait alors son réglage manuel Clair/Sombre.

### 1.8 Risques restants

🔴 **1. Il faut reconstruire le client de développement.** `expo-audio`, `expo-speech`, `expo-clipboard` et `expo-haptics` sont des modules **natifs** : le client déjà installé sur l'iPhone ne les contient pas et **plantera** sur l'écran Lumi. C'est le vrai risque de calendrier, vu l'historique de signature (Apple ID Xcode à reconnecter, profil gratuit à 7 jours). Le code, lui, est prêt.

🔴 **2. Aucun test contre le serveur réel n'a pu être fait depuis cette machine.** Lumi n'a **pas** de clé `ANTHROPIC_API_KEY` en local : il ne tourne que sur le serveur déployé, c'est-à-dire **la prod** — et le `mobile/.env.local` pointe lui aussi sur la prod. Lancer un vrai tour aurait dépensé du budget d'inférence et écrit une conversation dans les données d'un vrai client. Je ne l'ai pas fait sans ton accord. Ce qui a été vérifié à la place est listé dans le livrable.

🟠 **3. Icônes invisibles sur Android — bug préexistant, à l'échelle de l'app.** `expo-symbols` ne dessine sur Android que si `name` est un objet `{ ios, android }` ; avec une simple chaîne SF Symbol il rend `fallback`, donc **rien**. Les 208 fichiers de l'app passent des chaînes simples : **aucun icône de l'app n'apparaît sur Android aujourd'hui**, barre d'onglets comprise. J'ai corrigé **à l'intérieur de l'écran Lumi** (`components/lumi/IconeLumi.tsx`, table SF ↔ Material). Je n'ai pas touché au reste — ce serait un autre chantier. L'onglet Lumi lui-même garde le `TabIcon` de l'app : lui donner seul un icône visible aurait été plus incohérent que l'inverse.

🟡 **4. Le bouton « stop » pendant le streaming** est demandé par la mission et absent du web. C'est un `AbortController` côté interface, aucune logique d'agent : construit, et signalé comme un écart voulu.

🟡 **5. Écarts de parité assumés** : pas d'aperçu de transcription en direct (pas d'équivalent natif sans 2ᵉ fournisseur) ; deep links devis/facture sans destination (voir 1.5) ; 7 onglets en mode technicien sur iPhone SE.

🟡 **6. « Historique partagé », précisément.** Le serveur filtre les conversations sur `org_id` **ET** `user_id` (`server/routes/lumi.ts`). Le partage web ↔ mobile vaut donc pour **la même personne dans le même bureau** — ce qui est le besoin réel. Ce n'est pas un historique d'équipe.

✅ **Aucune migration DB. Aucun changement de contrat d'API partagé. Aucun changement du comportement de Lumi sur le web.**
