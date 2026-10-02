# LUMI_INVENTORY — inventaire de Lumi et de l'agent de support

Phase 1 de la mission « Lumi fiable et au plus bas coût » (consigne : `PROMPT_MISSION_LUMI_FIABILITE.md`).
État du code inventorié : `main` au commit `39f6ffc2` (2026-10-01). Lancement visé : 26 octobre 2026.

Ce document a trois parties, écrites à partir de la lecture du code, avec un renvoi `fichier:ligne` pour chaque fait :

1. **Architecture et boucle d'agent** — points d'entrée, étages, modèles, erreurs, historique, confirmations, journaux.
2. **Prompts système et outils** — ce qui part au modèle, token par token (mesuré avec l'API de comptage d'Anthropic, script `scripts/qa/lumi/compter-tokens.mts`).
3. **Connaissances, mémoire, crédits, vocal, support, Loi 25.**

**Statut des constats.** Sauf mention « PROUVÉ », un risque listé ici est déduit du code : il reste à confirmer par un test en production dans un bureau de test (phases 3 et 4). Les prompts complets sont recopiés dans les annexes de la partie 2.

---

## Synthèse

### Ce qu'est Lumi aujourd'hui

| Sujet | Fait |
| --- | --- |
| Entrées | `/api/lumi/chat` (web, flux SSE), `/api/lumi/action` (boutons, 0 modèle), `/api/lumi/execute` (confirmation d'une carte), texto (`lumi-sms.ts`), serveur MCP. |
| Chemin d'un message web | aide écrite → raccourcis → actions directes → cache exact (60 s) → cache sémantique (plongement Gemini) → plafond de conversation (40 ¢) → routeur Haiku 4.5 → agent (`tourLumi`). Le texto va directement à l'agent. |
| Modèle | `claude-sonnet-5` par défaut, `max_tokens` 2 048 réflexion incluse, effort `low`. `claude-haiku-4-5` dès 70 % du budget de la période (ou 15 % dans la journée). |
| Boucle | 8 appels au modèle par tour au plus (2 en palier restreint). |
| Outils | 248 (67 lectures, 181 écritures). Jeu de base : 15 chargés, 233 différés. Un sous-agent par sujet charge 7 à 54 outils. |
| Taille d'une requête, hors conversation | 8 208 tokens au jeu de base ; 17 863 avec le sous-agent facturation ; routeur 6 731. |
| Prompt | Bloc stable 4 567 tokens (en cache), bloc variable 180 à 2 893 tokens (heure, entreprise, souvenirs, rôle). |
| Cache | Points de cache en 5 minutes depuis le 2026-09-30 ; un préfixe par sous-agent et par profil de rôle. |
| Écritures | Jamais exécutées par l'agent : proposition (carte) → `/api/lumi/execute` → idempotence par `agent_actions`. Exception : les écritures « directes » et `remember_this`. |
| Crédits | 1 crédit = 3 ¢ US de coût réel ; Autopilot = 1 000 crédits par période anniversaire ; réservation sous verrou puis règlement au coût réel ; support exclu. |
| Support | `claude-sonnet-5`, prompt 3 179 tokens, requête 4 649 ; aucune action sur le CRM sauf `start_migration`. |
| Vocal | Transcription Gemini 2.5 Pro ; lecture à voix haute par le navigateur. |

### Les risques à traiter en premier

**Sécurité et vie privée**

| # | Risque | Statut |
| --- | --- | --- |
| S1 | `/api/org-knowledge` : tout membre (technicien compris) lit, écrit et retire la mémoire de Lumi ; une note écrite entre dans le prompt du propriétaire. | **PROUVÉ en prod le 2026-10-01**, corrigé par la PR #844. |
| S2 | `lumi_traces` et `agent_actions` lisibles par tout membre actif : questions du propriétaire, coût en dollars. | À prouver. |
| S3 | Lumi par texto : pas de filtre d'outils par rôle, pas de plafond, pas de trace, identité par numéro d'expéditeur. | À prouver. |
| S4 | `POST /api/lumi/action` et 4 autres routes Lumi hors de `external_agent.use`. | À prouver. |
| S5 | Le MCP n'applique pas `executerOutilGarde` (validation, refus d'écrire un montant masqué, journal des refus). | À prouver. |
| S6 | Savoir du support global : le titre d'un passage cite la question d'un client à une autre entreprise. Le cache d'aide global de Lumi filtre moins que celui du support. | À prouver. |
| S7 | Transcription ouverte à tout compte connecté, et probablement jamais débitée (`source: 'voix'` refusée par la contrainte de la base). | À prouver. |
| S8 | Le correctif base de #823 est en prod mais pas dans `main` (PR ouverte). | Constaté : PR #823 ouverte. |

**Fiabilité**

| # | Risque | Statut |
| --- | --- | --- |
| R1 | `stop_reason: max_tokens` traité comme une fin normale : une action coupée peut devenir une carte aux paramètres tronqués, ou bloquer la conversation. | À prouver. |
| R2 | Répondre dans la conversation du briefing du matin peut échouer (premier message `assistant`, bloc `fiches` inconnu de l'API). | À prouver. |
| R3 | Références `refN` : après 30 minutes ou un déploiement, une référence d'une ancienne conversation peut désigner une autre fiche. | À prouver. |
| R4 | Plafond journalier commun à tous les clients (5 $ par défaut) ; atteint, chacun lit « Tes crédits Lumi sont épuisés ». | À prouver (valeur de prod inconnue). |
| R5 | Refus du modèle et tours inachevés tracés comme des succès ; détecteur de montants sans source presque jamais exécuté. | À prouver. |

**Coût**

| # | Risque | Statut |
| --- | --- | --- |
| C1 | Le réchauffeur de cache pinge toutes les 50 minutes pendant 12 heures alors que le cache vit 5 minutes : chaque ping réécrit le préfixe pour rien (≈ 2 à 4 ¢). | À mesurer dans `ai_usage` (source `cache`). |
| C2 | L'heure à la minute et les indices d'outils sont placés avant la conversation : l'historique est réécrit à chaque message au lieu d'être relu en cache. | À mesurer (`cache_read_input_tokens` au 2e tour). |
| C3 | Le routeur Haiku tourne à chaque message ; un changement de sujet change tout le préfixe. | À mesurer. |
| C4 | Un sous-agent envoie plus de tokens que le jeu de base (17 863 contre 8 208), surtout des écritures (78 % des tokens d'outils). | Mesuré au comptage. |
| C5 | Mesuré par la session `lumeeeeeeeeee-a1` en prod : 56 % du coût = écriture de cache, 32 % lecture, 11 % sortie ; une demande isolée coûte 3 à 5 ¢ à froid, 0,6 à 1,3 ¢ à chaud. | Mesuré (à reproduire dans la baseline). |

### Ce que les journaux ne capturent pas encore (cible de la phase 2)

Latence au premier token, nombre d'outils chargés, `stop_reason`, écritures et échecs d'outils, origine « voix », trace par tour du canal texto, coût du routeur dans la trace de l'agent.

### Documentation en décalage avec le code

`CLAUDE.md` annonce Opus 5 et 66 outils ; le code a Sonnet 5 par défaut et 248 outils. Les commentaires parlent encore d'un cache d'une heure, de seuils à 60 %, d'un renouvellement « au 1er ».

---

