# COST_AUDIT — Leviers de coût token (Phase 2, lecture seule)

Base : `AGENT_MAP.md` (commit `16567e36`). Tous les tokens viennent de `count_tokens` ; tous les volumes viennent de `ai_usage` / `lumi_messages` en prod (30 jours, lecture seule). Tarifs Sonnet 5 : 2 $ / M entrée, 10 $ / M sortie, 0,20 $ / M cache lue, 2,50 $ / M cache écrite 5 min, 4 $ / M cache écrite 1 h (`server/lib/lumi/tarifs.ts`).

**Avertissement sur les dollars.** Le volume prod des 30 derniers jours est de 40 appels et 0,58 $. Toute colonne « $/mois » à ce volume est inférieure à 1 $ et n'a aucun pouvoir de décision. Je donne donc : tokens économisés par requête (mesurés), % du coût d'un appel (calculé sur les tarifs), et le $/mois **uniquement** sous le scénario explicite « S100 » = 100 conversations par jour × 5 appels (moyenne mesurée) = 15 000 appels / mois, avec la répartition mesurée en prod (cache lue 88 % des tokens d'entrée, 191 tokens de sortie). S100 est une hypothèse de volume, pas une mesure.

Coût d'un appel Lumi **à cache chaude**, calculé sur les tarifs et les tailles mesurées : 6 600 tokens fixes lus en cache (0,13 ¢) + historique lu en cache (variable, médiane non mesurée par appel) + ~200 tokens neufs (0,04 ¢) + 191 tokens de sortie (0,19 ¢) ≈ **0,36 ¢**. **Démarrage à froid** : 6 600 × 4 $ / M = **2,6 ¢** de plus. Ces deux nombres sont la référence des pourcentages ci-dessous.

---

## Quick wins (< 1 h chacun)

| # | Quoi | Fichier | Gain |
|---|---|---|---|
| Q1 | Les 3 suggestions à texte fixe du widget public deviennent des réponses fixes (étage 0) : « Combien ça coûte ? », « Est-ce que ça gère factures et devis ? », « Ça remplace quoi ? » | `src/components/marketing/LumiAgent.tsx` l. 17-21, 187 ; réponse côté serveur dans `server/routes/sales-chat.ts` (table `REPONSES_FIXES` avant `generateContent`) | 1 appel Gemini (2 291 tokens + 400 de sortie) économisé par clic ; part du trafic : **non mesurable** (aucun log sales-chat) |
| Q2 | **Les 4 suggestions Lumi atteignent le modèle** (vérifié en direct le 2026-09-13 : « Quelles factures sont en retard ? » = 3,2 ¢ à froid, « quelles » et « sont » ne sont pas dans les mots connus ; « Quel est mon chiffre du mois ? » idem). Les passer à l'étage 0 (`{ action, params }`) plutôt que d'élargir la détection : « chiffre du mois » → `revenu-mois`, « factures en retard » → `retards`, « journée de demain » → `agenda` (`demain`), « meilleurs clients » → nouveau raccourci `top-clients` sur `get_top_clients` | `server/lib/lumi/raccourcis.ts` (`DEFINITIONS`, `rendreRaccourci`), `src/pages/Lumi.tsx` l. 476-478 | 1 appel + démarrage à froid éventuel par clic (0,36 à 3,2 ¢ mesurés) ; c'est le premier geste d'un nouvel utilisateur |
| Q3 | Journaliser `usageMetadata` de Gemini (`promptTokenCount`, `candidatesTokenCount`, `cachedContentTokenCount`, `thoughtsTokenCount`) dans `ai_usage` | `server/lib/agent/gemini.ts` l. 125-146 (la réponse est déjà parsée), `server/lib/lumi/budget.ts` · `journaliserUsage` (ajouter `canal`) | rend mesurables les agents 2 à 5 ; bloquant pour tout le reste côté Gemini |
| Q4 | Stocker le détail des écritures en cache (`usage.cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`), déjà lu par `coutEnCents` | `journaliserUsage` + 2 colonnes (**migration** : à écrire en SQL commenté, non exécutée, R9) | rend mesurable le taux de cache hit par bloc |
| Q5 | Fermer la route Gemini orpheline `POST /api/agent/chat` (page masquée, route ouverte) : `410` ou retrait du montage | `server/index.ts` l. 767, `server/routes/agent.ts` l. 41 (garder `/agent/transcribe`) | supprime une surface qui coûte du Gemini sans UI et sans journalisation ; **R15** |

---

## Tableau des leviers (trié par $ économisés / effort, puis par certitude)

| Levier | Fichiers | Effort | Risque de régression | Tokens économisés / requête | $/mois sous S100 | Dépend de |
|---|---|---|---|---|---|---|
| **F1** Étage 0 sur les suggestions (Q1 + Q2) | `raccourcis.ts`, `Lumi.tsx`, `LumiAgent.tsx`, `sales-chat.ts` | S | nul (réponse gabarit, mêmes gardes) | 100 % de l'appel pour ces clics (6 800 tokens lus + 191 sortis, ou 2 700 Gemini) | non mesurable : part des clics inconnue (Q3 + trace B9) | — |
| **F2** Reçu d'exécution sans modèle : après Confirmer, la phrase « C'est fait, devis Q-0043 créé » est un gabarit ; le modèle n'est rappelé que si l'utilisateur écrit | `server/routes/lumi.ts` · `POST /lumi/execute` l. 282-320 (`executerTourSse` avec `execute`), `execution.ts` (note « DONE »), `fiches.ts` · `ficheCreee` | M | faible : perte de la « suite naturelle » proposée par le modèle après une écriture (« veux-tu l'envoyer ? ») — à remettre en gabarit par outil | 1 appel complet par écriture confirmée (≈ 0,36 ¢ chaud) ; chaque conversation avec écriture en a au moins 1 | 15 000 × part d'écritures (non mesurée ; 0 écriture agent en prod sur 24 h) | B2 (gabarits) |
| **E1** Dégraisser les 14 descriptions d'outils de base — **FAIT (item 9)** : 2 728 → **2 467 tokens** mesurés (`scripts/qa/compter-tokens-outils.mts`), règles gardées (« omettre query pour compter TOUT », statut à l'écran), batterie 5 % d'erreurs après | `server/lib/agent/tools.ts` | S | validé par la batterie | 261 tokens par démarrage à froid (0,1 ¢) et par relecture (0,005 ¢) | négligeable | — |
| **B1** Cache : rien à corriger ; ordre stable → variable respecté (`promptSystemeLumi` : `[stable+CACHE_1H, variable]`, outils en ordre fixe, `defer_loading` après le point) ; TTL 1 h validé contre les écarts mesurés (simulation 9,0 ¢ vs 10,3 ¢ en 5 min) ; taux de lecture en cache mesuré **88 %** des tokens d'entrée Sonnet | `orchestrateur.ts` l. 150-231 | — | — | 0 | 0 | Q4 pour le détail par bloc |
| **D1** Historique : fenêtre 60 messages + purge des `tool_result` > 40 k caractères (3 derniers gardés) déjà en place ; un résumé compacté n'est **pas justifié** au volume mesuré (6,4 messages / conversation en moyenne, max 28) | `routes/lumi.ts` · `chargerHistorique`, `orchestrateur.ts` · `purgerVieuxResultats` | — | — | 0 aujourd'hui ; seuil de bascule proposé si les conversations dépassent 40 messages : résumé Haiku des messages au-delà des 20 derniers, 1 appel Haiku (< 0,1 ¢) contre la relecture de ~10 k tokens (0,2 ¢ en cache) par tour | 0 | trace B9 (longueur réelle) |
| **D2** Blocs `thinking` stockés et rejoués (19 blocs, 675 caractères en moyenne) | `orchestrateur.ts` l. 246-249 (`nouveaux.push` de `reponse.content` entier) | S | nul si retirés des tours précédents (la doc API dit que les blocs de réflexion des tours précédents sont ignorés et non facturés ; **non vérifié** ici) | 0 facturé selon la doc ; ~170 tokens / message assistant de stockage | 0 | vérification par `cache_read_input_tokens` avec / sans |
| **H1** Boucle : `MAX_ETAPES = 8`, `maxRetries = 2` (SDK), aucune détection de répétition lecture (un même outil + mêmes args peut être rappelé N fois) | `orchestrateur.ts` l. 41, 120, 265-330 | S | nul : mémoïser (outil, args) dans le tour et renvoyer le résultat précédent avec `note: 'same call as before'` | 1 étape (≈ 0,36 ¢) par répétition ; fréquence **non mesurable** (les `tool_use` sont en base : requête à ajouter à la trace) | non mesurable | B9 |
| **H2** `max_tokens = 4096` vs 191 de sortie moyenne : pas un coût (plafond, pas dépense) ; `effort: medium` sur le palier normal | `orchestrateur.ts` l. 42, `budget.ts` · `reglagesPourPalier` | S | moyen : `effort: low` sur tout dégrade potentiellement les tours à outils ; à mesurer sur la batterie ; candidat sûr = `low` quand le message précédent était un raccourci ou une suite sans outil | thinking non séparable de `output_tokens` : **non mesurable** avant essai | non mesurable | batterie |
| **C1** Routage de modèle : Haiku refusé pour les tours complets (batterie du 2026-09-11 : 21 % d'erreurs vs 5 %, écritures sans confirmation) ; candidats sûrs : transcription `gemini-2.5-pro` → `gemini-2.5-flash` (env `GEMINI_TRANSCRIBE_MODEL`, 0 code), routeur B4 sur Haiku, résumé D1 sur Haiku ; titres de conversation déjà sans modèle (`message.slice(0, 80)`) | `transcribe.ts` l. 17, `budget.ts` | S | transcription : à valider sur 10 dictées réelles (mémoire projet : WAV 16 kHz + Pro choisi pour la qualité) | non mesurable (Q3) | non mesurable | Q3 |
| **G1** Grounding : le prompt public embarque la doc produit (2 291 tokens) ; à ce volume et sans cache Gemini mesurée, un retrieval ciblé n'a de sens que si le prompt dépasse ~5 k tokens ; Lumi se fonde sur les résultats d'outils (pas de doc injectée) | `sales-chat.ts` l. 33-75 | — | — | 0 recommandé maintenant | 0 | Q3 |
| **I1** Asynchrone / Batch : rien d'éligible — briefing composé sans modèle (`briefing.ts`), rapports PDF générés en direct dans la conversation, évaluation CI liée au serveur en streaming | — | — | — | 0 | 0 | — |
| **J1** Garde-fous : plafond mensuel par org (`plans.ai_monthly_budget_cents`, Scale 40 $ / Autopilot 80 $), paliers 60 % → Haiku, 100 % → 1 tour / min ; 60 tours / h / personne ; 30 req / min ; public 15 / min / IP. **Manque** : plafond d'écritures par session et par heure, plafond $ par conversation, alerte par personne | `budget.ts`, `rate-limiter.ts` l. 40-44, `index.ts` l. 598-652 | S | nul | — (protection, pas économie) | — | — |
| **E2** Résultats DB : projection explicite partout, limites présentes ; `get_timesheets` et `get_d2d_stats` chargent jusqu'à 20 000 lignes et agrègent en TS, `get_top_services` 5 000 jobs — coût DB et latence, pas tokens (agrégés avant envoi) | `tools-etendus.ts` blocs `getTimesheets`, `getD2dStats`, `getTopServices` | M | faible (RPC d'agrégation à écrire = **migration**, R9 : SQL commenté seulement) | 0 token | 0 | R9 |

Ordre recommandé : **Q3 → Q5 → F1 → E1 (avec batterie) → F2 → H1 → J1**, puis C1/H2 quand Q3 et la trace B9 permettent de mesurer.

---

## Réponses point par point (2A)

### A. Instrumentation — partiellement présente, bloquante côté Gemini
- Présent : `ai_usage` (org, user, conversation, modèle, 4 compteurs de tokens, coût) pour Lumi ; journalisé par appel (`journaliserUsage`, `routes/lumi.ts` l. 216-221). Coût calculé par `coutEnCents` avec le détail 5 min / 1 h.
- Absent : tout Gemini (agents 2, 3, 4, 5) ; détail 5 min / 1 h non stocké ; aucun lien appel → outils appelés → étage → latence. **Livrable #1 = Q3 + Q4 + trace B9.** Sans ça, C1, H2, F1 restent des estimations.

### B. Prompt caching — correct, à laisser
- `cache_control` : bloc stable du prompt (1 h), dernier outil de base (1 h), dernier message (5 min glissant). 3 points sur 4 autorisés.
- Contenu variable avant le préfixe : **aucun**. Date, prénom, souvenirs sont dans le second bloc système (`promptSystemeLumi`, `todayIso` remplacé par `DATE` dans le stable). Le nom d'entreprise est dans le bloc stable : une cache par org, ce qui est inévitable (les orgs ne partagent rien).
- Piège restant : `LUMI_MODEL` change de modèle → cache par modèle ; le palier économe bascule sur Haiku à 60 % → nouvelle cache froide (2 728 + 3 871 tokens à 2 $ / M Haiku écriture = 1,3 ¢, une fois).
- TTL : 1 h justifié (3 écarts sur 28 entre 5 et 60 min, 22 sous 5 min ; simulation 9,0 ¢ vs 10,3 ¢).
- Taux mesuré : Sonnet 343 932 lus / (343 932 + 39 166 + 5 584) = **88 %** des tokens d'entrée servis par la cache.
- Gemini (sales-chat) : aucune cache explicite ; 2.5 Flash applique une cache implicite sur les préfixes répétés, **non vérifiable** sans `cachedContentTokenCount` (Q3).

### C. Routage de modèle
Voir C1. Règle de bascule proposée pour Lumi (après B4) : routeur Haiku `{topic, action, params, confidence}` → action déterministe si `confidence ≥ 0,85` et action dans le registre B2 ; sinon Sonnet. Jamais Haiku pour un tour qui peut écrire (preuve : batterie 2026-09-11, tâche créée sans confirmation, tâche annulée créée quand même).

### D. Contexte conversationnel
Voir D1, D2. Seuil de résumé : quand `chargerHistorique` retourne plus de 40 messages (aucune conversation en prod n'y est : max 28), résumer les messages au-delà des 20 derniers avec Haiku, stocker le résumé comme premier message utilisateur (jamais en base : recalculé, comme la purge). Pas prioritaire.

### E. Schémas et résultats d'outils
Voir E1, E2. Avant / après par outil : **non mesurable avant réécriture** ; le protocole est en place (`scripts/qa/compter-tokens-prompt.mts` à étendre aux outils, `count_tokens` par déclaration). Chargement paresseux par topic : déjà le cas via `tool_search_tool_regex` + `defer_loading` (55 outils sur 69) ; B1 formalise les 14 outils de base en topics.

### F. Court-circuits
Étage 0 (interface) : F1. Étages 1-2 : `raccourcis.ts` couvre 5 intentions ; extension à ~30 énoncés maximum. Part de trafic absorbable : **non mesurable** (82 messages utilisateur en prod, aucune classification loguée). Sur la batterie d'évaluation (80 énoncés représentatifs choisis à la main, pas du trafic réel) : 8 énoncés sur 80 passent aujourd'hui par un raccourci (10 %), et la batterie est volontairement chargée en cas difficiles. À mesurer sur la trace B9 après 30 jours.

### G. Grounding
G1 : rien à retirer du prompt public à cette taille ; Lumi n'injecte aucune doc. La règle « pas dans un résultat d'outil = je ne sais pas » est dans le prompt (« chaque chiffre vient d'un résultat d'outil ») et testée par la batterie (cas `secu-*`, `injection-fiche`, `piege-*`).

### H. Boucle agentique
H1, H2. Retry : SDK 2 tentatives sur 429/5xx (facturation seulement si la requête aboutit) ; l'orchestrateur ne retente pas un tour échoué (événement `error`, l'utilisateur clique Réessayer = 1 appel). Réponses : 1 à 3 phrases imposées, 191 tokens mesurés.

### I. Asynchrone
I1 : rien.

### J. Garde-fous financiers
J1. Ajouter : compteur d'écritures par conversation (refus au-delà de N = 20, à décider), coût cumulé par conversation avec arrêt à 1 $ (aucune conversation prod ne dépasse 10 ¢), et le plafond de l'org déjà en place reste la barrière finale.

---

## Non mesurable sans instrumentation

| Quantité | Manque | À ajouter |
|---|---|---|
| Coût des 4 usages Gemini | `usageMetadata` ignoré | Q3 |
| Part des clics sur suggestions vs texte libre | aucune trace de l'origine d'un message | champ `origine` (`suggestion` / `texte` / `voix` / `carte`) dans la trace B9 |
| Part du trafic par intention (étages 1-5) | 82 messages, pas de classification | trace B9 + routeur en mode « observation » (classifie sans agir, 1 appel Haiku, pendant 30 jours) |
| Tokens de réflexion | inséparables de `output_tokens` | essai A/B `effort` sur la batterie |
| Cache hit par bloc (prompt / outils / historique) | seuls les totaux sont stockés | Q4 |
| Répétitions d'un même appel d'outil dans un tour | `tool_use` stockés mais non requêtés | vue SQL sur `lumi_messages` (lecture) |
| Latence par étage | non journalisée | `duree_ms` dans la trace |
| Poids de `tool_search_tool_regex` | refusé par `count_tokens` | différence d'`input_tokens` sur un appel réel |
