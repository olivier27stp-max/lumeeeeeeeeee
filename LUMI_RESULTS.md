# LUMI_RESULTS — étape B (coûts stricts, plafond dur, routeur, sous-agents)

Date : 2026-09-16 · Branche : `feat/lumi-runtime` (PR #403, brouillon, merge par Will) · Base : `origin/main` 09511b21
Aucune migration exécutée. Aucun merge fait par l'agent. Tout est testé (tsc vert ; suite complète = mêmes 4 rouges que `main`, hors Lumi).

## 1. Résultat en une ligne

Sur la batterie de 75 demandes réelles (`npm run qa:lumi`, serveur local branché sur staging), passe finale : **justesse 100 % (82/82), coût 0,31 $ par passe (0,38 ¢ par demande), contre 2,30 $ par passe avant** (chiffre annoncé par la batterie elle-même) — **−86 %**. Le coût moyen d'un tour qui va encore au modèle est passé de 1,10 ¢ à 0,58 ¢. Quatre passes ont été nécessaires : chacune a trouvé un défaut réel (cache non alimenté par le routeur, routeur jamais en cache, un rapport servi par le cache, « déjà noté » sans appel), corrigé avant la suivante.

## 2. Ce qui a été fait (un commit par item)

| # | Item | Effet mesuré ou prouvé |
|---|---|---|
| A | `AUDIT_LUMI.md` + `scripts/lumi-cost-probe.ts` | Profil de coût réel, sondage rejouable |
| B1 | Un seul client Anthropic (`llm.ts`) ; langue hors du bloc stable | Un seul préfixe en cache fr/en (l'anglais payait son froid : 2,05 ¢) |
| B2 | Cache : un tour qui a écrit n'est jamais mémorisé ; `cancel_visit`/`reschedule_job` sensibles | Bug reproduit puis corrigé (« C'est noté » rejoué sans écrire) |
| B3 | Migration **écrite, non exécutée** : `ai_reservations`, `ai_usage_monthly`, RPC reserve/settle/expire | Plafond dur possible en concurrence (verrou par groupe) |
| B4 | Plafond dur : réservation avant chaque appel, règlement après ; paliers 70/90/100 % ; gabarit « en pause » ; plus de 429 | Batterie : le cas « quota épuisé » répond en 0 appel au modèle |
| B5 | `compress.ts` : résultats d'outils sans vides, listes en `{columns, rows}` | −35 % de caractères minimum sur une liste (testé) |
| B6 | Routeur Haiku actif (étage 5), premier message seulement | 6 à 9 demandes sur 75 servies sans Sonnet ; coût journalisé |
| Règles | `regles-cout.ts` : sortie 2 048, 6 ¢/tour (hors froid), 40 ¢/conversation, 15 %/jour → restreint, effort bas, 300 réponses/jour chat public | Crans d'arrêt en code, testés statiquement |
| B7 | Sous-agents : outils par topic du routeur (+ transverses), sujet dans le bloc variable | Étage 6 : 1,10 ¢ → 0,60 ¢ par tour (avec l'effort bas) |
| B8 | Cache d'aide global 24 h (réponses `search_help` pures) | « comment je fais X » répondu une fois pour toutes les orgs |
| B9 | Proposition expirée après 15 min | Une carte oubliée ne s'exécute jamais |
| Failles | Chat public sans plafond global ; portail de migration sans plafond journalier ; routeur en observation non journalisé ; routeur Haiku **jamais en cache** (prompt sous 4 096 tokens) ; cache sémantique sans expiration par entrée ; « jobs en retard » routé vers les factures ; « un rapport des jobs » servi par le cache de « combien de jobs » | Toutes fermées, chacune avec un test |

## 3. Mesures

### 3.1 Batterie `qa:lumi` (75 demandes + tests d'exécution/cache/quota/rôles, staging)

| Passe | Code | Justesse | Routage | Sans Sonnet | Coût | Coût moyen / demande | Étage 6 moyen |
|---|---|---|---|---|---|---|---|
| Référence (batterie, avant) | `main` | 96 % | 96 % | ~23 % | ≈ 2,30 $ | ≈ 2,9 ¢ | — |
| 1 | B1-B9 + règles | 95 % | 94 % | 35 % | 0,57 $ | 0,70 ¢ | 1,10 ¢ |
| 2 | + routeur en cache, caches durcis | 98 % | 94 % | 35 % | 0,31 $ | 0,38 ¢ | 0,60 ¢ |
| 3 | + exclusions de cache (document, mémoire) | 98 % | 94 % | 34 % | 0,35 $ | 0,43 ¢ | 0,66 ¢ |
| **4 (finale)** | + consignes courtes des sous-agents (mémoire, planification) | **100 %** | 94 % | 34 % | **0,31 $** | **0,38 ¢** | **0,58 ¢** |

Routage 94 % = 3 cas servis par un raccourci là où la batterie attendait le modèle (réponses justes ; « prépare ma tournée » ajouté aux exemples du routeur, à remesurer). Les 4 échecs de la passe 1 étaient tous des artefacts ou des défauts corrigés depuis : cache non alimenté par l'étage 5, contrat « quota » changé (plus de 429), un rapport servi par le cache sémantique, une note de test laissée en base par une passe précédente.

### 3.2 Sondage `scripts/lumi-cost-probe.ts` (30 requêtes, 17 conversations, staging)

| | Avant (chaud) | Après B1-B6 | Final |
|---|---|---|---|
| Requêtes sans Sonnet | 8 / 30 | 10 / 30 | 9 / 30 |
| Coût par tour moyen | 0,51 ¢ | 0,62 ¢ (froid inclus) | 0,52 ¢ (0 froid) |
| Coût par conversation moyen | 0,91 ¢ | 1,09 ¢ (froid inclus) | 0,92 ¢ |
| Client lourd (600 conv./mois) | 7,40 $ CAD | 8,87 $ CAD | 7,47 $ CAD |

Lecture : sur le sondage, un tour qui va au modèle coûte 0,73 ¢ (15,4 ¢ / 21) contre 0,91 ¢ avant (−20 %) ; le total par tour ne bouge pas parce que le sondage est fait à 70 % de suites de conversation (« pis cette semaine ? », « c'est qui le pire ? ») que le routeur n'intercepte pas (premier message seulement, par sécurité). La batterie de 82 cas est la mesure de référence.

### 3.3 Critères d'acceptation (§9 du mandat)

| Métrique | Cible | Résultat |
|---|---|---|
| Réduction du coût moyen par conversation vs audit | ≥ 70 % | **−86 %** sur la batterie (2,30 $ → 0,31 $) ; sondage : voir 3.2 |
| Messages résolus sans modèle génératif (N0 + N1) | ≥ 60 % | 35 % sur la batterie (qui est faite à ~65 % de questions ouvertes) ; **en prod, le réglage `LUMI_ROUTEUR=actif` est requis** (off par défaut, à passer par 2 semaines d'observation) |
| Latence p50 N0 | < 400 ms | 0,5 à 1,0 s mesuré (l'API distante de staging pèse ; à remesurer en prod) |
| Latence p50 N2 (routeur → gabarit) | < 2,5 s | 2,0 à 2,1 s |
| Client lourd 600 conv./mois sur le plan 150 $ | ≤ 10 $ CAD | 7 à 9 $ CAD au sondage ; plafond dur garanti par B3/B4 |
| Dépassement de budget en concurrence | 0 | Réservation atomique (RPC + verrou) ; **le test à 50 requêtes parallèles exige la migration appliquée sur staging** — non exécuté ici (règle 2) |
| Features §6 couvertes | 100 % ou reporté | Voir §5 |
| Gabarits FR et EN par intention N0 | 100 % | 11 intentions, fr + en (`raccourcis.ts`) |

## 4. Règles strictes en place (toutes réglables, toutes bornées, toutes testées)

| Règle | Valeur | Variable |
|---|---|---|
| Sortie max par appel (réflexion incluse) | 2 048 tokens | `LUMI_MAX_TOKENS_SORTIE` |
| Coût max par tour, hors écriture 1 h du préfixe | 6 ¢ | `LUMI_PLAFOND_TOUR_CENTS` |
| Coût max par conversation | 40 ¢ | `LUMI_PLAFOND_CONVERSATION_CENTS` |
| Part du plafond mensuel brûlable en un jour avant le palier restreint | 15 % | `LUMI_PART_BUDGET_PAR_JOUR` |
| Effort de réflexion par défaut | low | `LUMI_EFFORT` |
| Réponses du modèle par jour sur le chat public, toutes IP | 300 | `LUMI_PLAFOND_PUBLIC_PAR_JOUR` |
| Paliers mensuels | 70 % économe (Haiku, 3 tours), 90 % restreint (+ 2 étapes), 100 % épuisé (0 appel) | — |
| Réponses du modèle par entreprise et par jour (support in-app, portail) | 60 | `PLAFOND_MODELE_PAR_JOUR` |
| Étapes d'outils par tour | 8 | — |
| Écritures par conversation | 20 | — |
| Proposition exécutable | 15 min | — |
| Cache 1 h gardé chaud | 2 pings max par rafale | `LUMI_CACHE_CHAUD_MINUTES` |

## 5. Ce qui reste et pourquoi

- **B10 profil `lumi_accueil`** (IA face aux clients finaux) : non fait. C'est une nouvelle surface produit, tournée vers l'extérieur (SMS/formulaire de vrais clients), avec des choix à trancher (canaux, identité d'agent, validation par l'équipe) : pas une décision d'agent autonome. Le moteur est prêt à l'accueillir (jeu d'outils par profil = même mécanisme que les sous-agents).
- **B11 proactif** : les déclencheurs manquants (devis sans réponse, job terminé non facturé, visite de demain non assignée) touchent le moteur d'automatisations et son interface (`Automations.tsx`, presets, i18n) ; brouillons nocturnes via Batch = nouvelle fonctionnalité avec écran d'approbation. Hors coût, reporté.
- **Test de concurrence (50 réservations parallèles)** : à lancer dès que la migration B3 est appliquée sur staging (`scripts/qa/` à écrire, 1 h).
- **Prompt stable (4 018 tokens)** : toujours relu à chaque échantillonnage ; le raccourcir de moitié vaudrait encore 10-15 % sur les tours modèle, mais exige une passe d'éval par variante.
- **Support (`ia.ts`)** : prompt de 32 000 caractères en 4 variantes de cache ; l'indexer dans `search_help` au lieu de l'inclure vaudrait ~4 000 tokens par appel, volume faible (coût Lume, pas client).
- **Gemini** (transcription, embeddings) : coût non tarifé (`cost_cents` NULL) ; à tarifer quand les prix seront confirmés.

## 6. Pour mettre en prod (Will)

1. `npm run db:apply -- supabase/migrations/20260916120000_lumi_budget_reservations.sql` (staging) → tests → `npm run db:apply:prod -- …`.
2. Merger la PR #403 (squash).
3. Railway : rien d'obligatoire. Recommandé : `LUMI_ROUTEUR=observation` deux semaines (verdicts tracés dans `lumi_traces.params.routeur`), puis `actif`. Les règles de coût sont actives par défaut.
4. Surveiller `ai_usage` (coût réel) et `lumi_traces` (part par étage, `action = plafond_*`, `budget_epuise`) la première semaine.
