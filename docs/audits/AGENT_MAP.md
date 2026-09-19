# AGENT_MAP — Reconnaissance des agents Lume (Phase 1, lecture seule)

Commit audité : `16567e36` (`origin/main`, 2026-09-11) lu dans un worktree détaché. Aucun fichier du dépôt modifié.
Chiffres : mesurés (API `count_tokens`, table `ai_usage`, `lumi_messages`, `agent_actions` en prod, lecture seule) ou marqués **non mesurable**. Aucun chiffre estimé à l'œil.

Rectificatif de cadrage : la pile est **Vite + React 19 (SPA) + Express + Supabase**, pas Next.js. Le mot « tenant » dans ce rapport = `org_id` (l'app dit « org » / « office »).

---

## 1.1 Points d'appel LLM

| # | Agent | Fichier · fonction | Fournisseur / modèle | max_tokens | temperature | streaming | retry |
|---|---|---|---|---|---|---|---|
| 1 | **Lumi** (assistant complet, dans l'app) | `server/lib/lumi/orchestrateur.ts` · `tourLumi()` → `anthropic().messages.stream()` | Anthropic, `claude-sonnet-5` par défaut (`server/lib/lumi/tarifs.ts` · `MODELE_PAR_DEFAUT`, surchargeable par `LUMI_MODEL`) ; `claude-haiku-4-5` au palier « économe » (`server/lib/lumi/budget.ts` · `reglagesPourPalier`) | `MAX_TOKENS = 4096` (orchestrateur l. 42) | non envoyée (interdit sur Sonnet 5) ; `thinking: adaptive` + `output_config.effort` medium (normal) / low (économe), rien sur Haiku (`parametresReflexion`) | oui (SSE vers le client, `server/routes/lumi.ts` · `executerTourSse`) | SDK par défaut : `maxRetries = 2` (408/409/429/5xx) — `new Anthropic()` sans option (l. 120). Boucle outils : `MAX_ETAPES = 8` (l. 41) |
| 2 | **Agent de support / vente public** (« Lumi » de la page d'accueil, sans compte) | `server/routes/sales-chat.ts` · `POST /api/public/sales-chat` → `generateContent()` de `server/lib/agent/gemini.ts` | Google Gemini, `gemini-2.5-flash` (`server/lib/config.ts` · `geminiModel`, env `GEMINI_MODEL`) | `maxOutputTokens: 400`, `disableThinking: true` (`thinkingBudget: 0`) | 0.6 | non (JSON) | aucun retry applicatif ; 429 Gemini remonté tel quel au widget (`gemini.ts` l. 118-123). Historique borné à 10 messages, 20 max × 1 500 caractères (`salesChatSchema`) |
| 3 | **Agent Gemini historique** (« Lume Agent », `MrLumeChat`) | `server/routes/agent.ts` · `POST /api/agent/chat` → `server/lib/agent/orchestrator.ts` · `runAgent()` → `generateContent()` | Gemini `gemini-2.5-flash` | non plafonné côté route (`agentChatSchema` : messages ≤ 8 000 caractères) | non fixée | non | boucle `MAX_STEPS = 6` (`orchestrator.ts` l. 13) |
| 4 | **Transcription vocale** (Lumi et MrLumeChat) | `server/lib/agent/transcribe.ts` · `transcribeAudio()` via `POST /api/agent/transcribe` (`server/routes/agent.ts` l. 26) | Gemini `gemini-2.5-pro` (`GEMINI_TRANSCRIBE_MODEL`) | 2 048 | 0 | non | aucun ; audio ≤ 60 s (`agentTranscribeSchema`, base64 ≤ 5,6 Mo) |
| 5 | **Suggestion de mapping à l'import CSV** | `server/lib/migration/aiSuggest.ts` · `aiSuggestForColumn()` | Gemini `gemini-2.5-flash` | non fixé | 0.1 | non | aucun |

Notes :
- **#3 est une surface morte mais vivante.** La page `/lume-agent` est redirigée vers `/day` (`src/App.tsx` l. 1513-1515, test `tests/lume-agent-masque.test.ts`), mais la route `POST /api/agent/chat` reste montée (`server/index.ts` l. 767) et appelable par tout utilisateur authentifié avec le même prompt de base (`server/lib/agent/systemPrompt.ts` · `buildSystemPrompt`) et les mêmes outils. **Deux implémentations concurrentes du même comportement (R15)** : `server/lib/agent/orchestrator.ts` (Gemini) et `server/lib/lumi/orchestrateur.ts` (Claude). Je n'en ajoute pas une troisième ; à trancher en Phase 2.
- Les raccourcis déterministes (`server/lib/lumi/raccourcis.ts` · `detecterRaccourci`, `repondreRaccourci`) court-circuitent #1 pour cinq intentions : aucun appel modèle (voir 1.3).
- Le briefing du matin (`server/lib/lumi/briefing.ts` · `composerBriefing`) est composé sans modèle : 0 appel.
- Aucun autre appel LLM dans `server/` (grep `messages.stream|messages.create|generateContent|GoogleGenerativeAI|openai` : les autres correspondances sont Twilio `client.messages.create`).
- Le MCP (`server/routes/mcp.ts`) n'appelle aucun modèle : c'est le client (Claude Desktop, ChatGPT) qui paie ses tokens. Il expose les mêmes outils que Lumi (voir 1.4).

## 1.2 Anatomie de chaque agent (tokens mesurés avec `count_tokens`, tokenizer Sonnet 5)

### Lumi

| Composant | Tokens | Renvoyé à chaque tour ? | Cacheable ? | État actuel |
|---|---|---|---|---|
| Prompt système, bloc stable (`promptSystemeLumi()[0]` : rôle, sécurité, recherche d'outils, `CONSIGNES_COLLEGUE`) | **3 871** | oui | oui | `cache_control` 1 h (`CACHE_1H`, orchestrateur l. 231) |
| Prompt système, bloc variable (date, prénom, entreprise) | **27** | oui | non (voulu) | placé APRÈS le point de cache ✔ |
| Souvenirs de l'org (`org_knowledge`, catégorie `assistant`, ≤ 30 lignes × 240 car.) | 0 en prod aujourd'hui ; **non mesurable** en général (dépend de l'org) | oui | non (bloc variable) | après le point de cache ✔ |
| Définitions des 14 outils de base (`OUTILS_DE_BASE`, schémas JSON + descriptions) | **2 728** | oui | oui | `cache_control` 1 h sur le dernier outil de base (l. 159) |
| Outil serveur `tool_search_tool_regex` | non mesurable par `count_tokens` (refusé : « Server tools are not supported ») | oui | — | — |
| 55 outils différés (`defer_loading: true`) | **11 587** si tous chargés ; 0 tant qu'aucun n'est cherché | non (chargés à la demande, par recherche regex) | non (un outil différé ne peut pas porter `cache_control`) | ✔ |
| Historique de conversation (`lumi_messages`) | dépend ; en prod : **6,4 messages / conversation en moyenne, max 28** (13 conversations) | oui, jusqu'à `MAX_MESSAGES_HISTORIQUE = 60` messages | oui | point de cache glissant 5 min sur le dernier message (`avecCacheConversation`) ; `purgerVieuxResultats` au-delà de 40 000 caractères (≈ 10 k tokens) : les `tool_result` sauf les 3 derniers deviennent une note |
| Résultat d'outil (`tool_result`) | en prod : **618 caractères en moyenne, p90 851, max 4 060** (23 résultats) ; plafond dur 60 000 caractères par résultat (`.slice(0, 60_000)`, l. 313) | oui, tant qu'il est dans l'historique | oui (via le point glissant) | UUID masqués en réfs courtes avant envoi (`server/lib/agent/refs.ts` · `masquerIds`) |

Répartition mesurée par outil de base (une déclaration seule, incluant ~400 tokens de cadrage que l'API ajoute dès qu'un outil est présent — soustraire ~400 pour le poids propre) :
`list_jobs` 684 · `list_quotes` 610 · `search_clients` 599 · `create_task` 579 · `search_leads` 545 · `get_client_profile` 517 · `query_schedule` 516 · `list_invoices` 514 · `list_tasks` 508 · `get_overdue_payments` 486 · `get_team_locations` 455 · `recall_notes` 449 · `get_job` 441 · `get_company_info` 427.

Contexte fixe par appel (cache chaud) : **≈ 6 600 tokens + outil de recherche** (3 871 + 2 728), lus à 10 % du tarif ; réécrits à 200 % à chaque démarrage à froid (> 1 h sans appel pour cette combinaison prompt + outils ; la clé de cache est globale à l'org uniquement via le nom d'entreprise dans le bloc stable — `company` est interpolé dans le bloc stable, donc **une cache par org**).

### Agent de support public (sales-chat)

| Composant | Tokens (proxy tokenizer Sonnet ; Gemini compte différemment) | À chaque tour ? | Cacheable ? |
|---|---|---|---|
| `SYSTEM_PROMPT` (`server/routes/sales-chat.ts` l. 33-75) : description produit, prix, règles | **2 291** | oui | aucune cache : `generateContent` de `gemini.ts` n'utilise pas le cache de contexte Gemini |
| Outils | 0 (aucun) | — | — |
| Historique | ≤ 10 derniers messages (route l. 84-95), 1 500 car. max chacun | oui | non |

Coût réel : **non mesurable** — aucune journalisation d'usage pour Gemini (voir 1.7).

### Agent Gemini historique (`/api/agent/chat`)

`buildSystemPrompt` : **1 168** tokens (proxy) + les 69 outils convertis en `functionDeclarations` (non mesuré, pas de `count_tokens` Gemini dans le dépôt). Pas de cache, pas de journalisation.

## 1.3 Cycle de vie d'une conversation

### Lumi — cas typique « Combien de factures en retard, relance-les »

1. `POST /api/lumi/chat` (`server/routes/lumi.ts` l. 245) → `contexteTour()` : budget du mois (`etatBudget`), palier, prompt, fuseau. Trois lectures Supabase (service_role) avant tout appel modèle.
2. `chargerHistorique()` : toute la conversation depuis `lumi_messages` (≤ 60 messages), réfs restaurées, purge des vieux `tool_result`.
3. **Étage sans modèle** : `detecterRaccourci(message)` — si le message entier est fait de mots connus et matche l'une des 5 intentions (`clients-total`, `agenda`, `revenu-mois`, `retards`, `briefing`), `repondreRaccourci()` exécute l'outil sous les mêmes gardes et rend un gabarit : **0 appel LLM, 0 ¢**, ~700 ms mesurés. Sinon :
4. `tourLumi()` : appel 1 (prompt + outils + historique + message) → le modèle appelle `get_overdue_payments` → `executerOutilGarde()` (permission de rôle, montants masqués) → résultat masqué → appel 2 → le modèle propose `send_payment_reminders` (écriture) → **arrêt du tour, carte de confirmation** (`proposal`) ; la conversation est sauvée avec le `tool_use` sans `tool_result`.
5. L'utilisateur clique Confirmer → `POST /api/lumi/execute` (l. 282) → `executerEcriture()` (`server/lib/lumi/execution.ts`) → `executerOutilGarde` → handler → `tool_result` « DONE » → appel 3 : le modèle rend compte.

Par tour : **1 appel + 1 par étape d'outil**, plafond 8 étapes. Chaque appel renvoie l'intégralité : prompt stable (cache 1 h), outils (cache 1 h), historique complet jusqu'au message précédent (cache 5 min glissante), nouveau contenu au plein tarif.

Mesuré en prod (30 jours, `ai_usage`) :

| | Sonnet 5 | Opus 5 (session locale épinglée, corrigée) |
|---|---|---|
| appels | 28 | 12 |
| conversations | 5 | 3 |
| entrée brute / cache écrite / cache lue / sortie (tokens) | 5 584 / 39 166 / 343 932 / 5 360 | 12 602 / 18 845 / 150 805 / 1 895 |
| coût | 27,4 ¢ | 30,4 ¢ |

Appels par conversation : **médiane 3,5, moyenne 5, max 14**. Sortie moyenne : **191 tokens / appel**. Écarts entre appels d'une même org : 22 ≤ 5 min, 3 entre 5 et 60 min, 3 > 1 h.

Où l'historique grossit : chaque `tool_result` reste en base intégralement (jusqu'à 60 000 car.) ; en mémoire il est purgé au-delà du seuil. Les `thinking` blocks ne sont pas stockés (le stream ne les renvoie pas en `content` stocké — **à vérifier en Phase 2** : `nouveauxMessages` stocke `reponse.content` tel quel, orchestrateur l. 246-249).

Mode d'auto-exécution : en mode « argent » (défaut, `memberships.lumi_mode`), les écritures non sensibles (jobs, tâches, statuts, notes) partent **sans carte** pendant le tour (orchestrateur l. 280-289, `ECRITURES_SENSIBLES` dans `execution.ts`). Voir R11 en 1.4.

### Sales-chat — cas typique « Combien ça coûte ? »

1 appel Gemini par message du visiteur, historique ≤ 10 messages renvoyé en clair, prompt de 2 291 tokens renvoyé à chaque fois sans cache. Pas de conversation persistée. Rate limit : 15 req / min / IP (`redisRateLimit` preset `public`, `server/index.ts` l. 642).

### Transcription

1 appel Gemini Pro par message vocal (Lumi et MrLumeChat), avant le tour Lumi : un message dicté = 2 fournisseurs, 2 appels minimum.

## 1.4 Surface d'action

69 outils dans `AGENT_TOOLS` (`server/lib/agent/tools.ts`, `tools-etendus.ts`, `tools-rapports.ts`) : **38 lectures, 31 écritures**. Exposés à Lumi (tous) et au MCP (tous sauf `build_report`, `canal: 'lumi'`), l'agent Gemini historique les reçoit en `functionDeclarations`.

Mécanismes communs :
- **Garde de rôle** : `server/lib/agent/garde.ts` · `executerOutilGarde()` — 63 outils ont une clé de permission (`PERMISSION_PAR_OUTIL`, la même matrice que la page Rôles via `hasPermission`), 18 sont « financiers » (`OUTILS_FINANCIERS`, refusés si `membre_voit_les_montants()` est faux). Les 6 outils sans clé : à lister en Phase 2 (probablement `get_company_info`, `recall_notes`, `remember_this`, `forget_note`, `get_recent_agent_actions`, `build_report`).
- **Idempotence + audit** : `tools-etendus.ts` · `executerIdempotent()` — empreinte `sha256(args)` posée dans `agent_actions` AVANT d'agir, index unique `agent_actions_dedup_idx (org_id, outil, args_hash)` vérifié en prod ; doublon → `deja_fait` avec le résultat mémorisé ; effet partiel (`EffetPartiel`) → empreinte conservée ; échec propre → empreinte libérée. Chaque succès écrit aussi `security_events` (`agent_write_executed`). **Les 31 écritures passent par `executerIdempotent`** (vérifié : 32 appels dans `tools-etendus.ts`, les 4 handlers de `tools.ts` — `handlerCreateQuote`, `handlerCreateInvoice`, `handlerCreateJob`, `handlerSendSms` — y sont définis l. 1478-1660 et 1205). Fenêtre : les empreintes sont purgées après **24 h** (`supabase/migrations/20260903090000_agent_ecritures.sql` · `oauth_menage()`), donc une action identique est refusée 24 h, puis possible.
- **Confirmation** : Lumi = carte `proposal` (`server/routes/lumi.ts` · `propositionsEnAttente`, `src/components/lumi/CarteAutorisation.tsx`) avec aperçu réel du document pour devis/facture et texte exact + destinataire pour SMS/courriel (`server/lib/lumi/fiches.ts` · `apercuProposition`). MCP = confirmation faite par le client MCP (Claude Desktop), pas par nous.
- **Dry-run : inexistant** (grep `dry`, `simulation` : rien). R12 non satisfaite aujourd'hui.
- **Transactions : côté SQL seulement** là où un RPC les porte (`rpc_create_job_with_optional_schedule`, `rpc_create_quote`, `finish_job_and_prepare_invoice`, `fusionner_clients`, `apply_invoice_payment`). Les handlers multi-tables en TS (`update_job` → `jobs` + `job_line_items`, `create_quote` → RPC puis `rpc_recalculate_quote`) ne sont pas transactionnels : ils s'appuient sur `EffetPartiel` pour ne pas rejouer. R6 partiellement satisfaite.
- **Suppression physique** : aucune. Relecture du 2026-09-13 : `delete_task` fait `update({ deleted_at })` sur `tasks` (soft delete) ; ma première lecture, fondée sur le nom de l'outil, était fausse. R8 satisfaite, verrouillée par `tests/lumi-garde-fous.test.ts`.

### Écritures (31)

| Outil | Tables / RPC / route interne | Validations existantes | Effets de bord | Réversible | Sensible (carte même en mode « argent ») |
|---|---|---|---|---|---|
| `create_client` | `create_client_with_duplicate_handling` (RPC) | doublon par téléphone/courriel, adresse | — | soft (archivage) | non |
| `update_client` | `clients` | champs connus | — | oui | non |
| `convert_lead_to_client` | `clients` | statut lead | — | oui | non |
| `merge_clients` | `fusionner_clients` (RPC) | les deux fiches de l'org | fusion d'historique | **non** | oui |
| `create_job` | `rpc_create_job_with_optional_schedule` + `job_line_items` | client existant, date, articles ; `incomplet` si articles échouent | visite créée, position carte | archivage | non |
| `update_job` | `jobs`, `job_line_items`, `tax_configs` | articles | recalcul | oui | non |
| `update_job_status` | `jobs` ; `POST /automations/events/job-completed` | statut légal | **automatisations** (sondage d'avis SMS/courriel, facture auto) | oui sauf effets | non |
| `assign_job` | `jobs` | membre de l'org | notification | oui | non |
| `archive_job` | `jobs` | — | — | oui | oui |
| `set_job_expenses` | `jobs` | montants en cents | — | oui | non |
| `add_visit` / `reschedule_job` / `cancel_visit` | `rpc_add_visit`, `rpc_reschedule_event`, `rpc_unschedule_job` ; routes `/automations/events/appointment-*` | job existant, chevauchements comptés | rappels client par automatisation | oui / oui / non | non / non / non |
| `create_quote` | `rpc_create_quote` + `rpc_recalculate_quote` | client, articles, taxes par défaut | — | annulation | oui |
| `send_quote` | `POST /quotes/send-email` (au nom de l'utilisateur, `appelInterne`) | devis existant, courriel client | **courriel au client** | **non** | oui |
| `cancel_quote` | `quotes` | statut | — | non | oui |
| `convert_quote_to_job` | `POST /quotes/convert-to-job` + `rpc_add_visit` | devis accepté | job + visite | archivage | oui |
| `create_invoice` / `create_invoice_from_job` | `rpc_create_invoice_draft` + `rpc_save_invoice_draft` / `finish_job_and_prepare_invoice` | client, articles / job terminé | brouillon seulement | annulation | oui |
| `send_invoice` | `POST /emails/send-invoice` | facture existante | **courriel au client** | **non** | oui |
| `mark_invoice_paid` | `apply_invoice_payment` (RPC, **service_role**) ; `/automations/events/invoice-paid` | facture ouverte | paiement enregistré, relances stoppées | **non** | oui |
| `send_payment_reminders` | `clients`, `messages`, `sms_opt_outs` (Twilio) | opt-out SMS respecté | **SMS aux clients** | **non** | oui |
| `send_sms` | Twilio, `messages`, `sms_opt_outs` (service_role) | E.164, opt-out | **SMS** | **non** | oui |
| `send_email` | `POST /emails/send-custom` | adresse | **courriel** | **non** | oui |
| `create_task` / `update_task` / `update_task_status` / `delete_task` | `tasks` | assigné membre de l'org | — | oui / oui / oui / **DELETE physique** | non |
| `add_note` | `activity_notes` (service_role, `actor_id` = utilisateur) | — | fil d'activité | oui | non |
| `remember_this` / `forget_note` | `org_knowledge` (service_role) | clé stable | prompt suivant modifié | oui | non (ÉCRITURES_ANODINES : jamais de carte) |

### Lectures (38)

Toutes projettent des colonnes explicites (grep `select('*')` sur `server/lib/agent` : **0 occurrence**) et filtrent `org_id = ctx.orgId`. Limites : `clamp(args.limit, défaut, max)` sur les listes (clients 10/25, jobs 15/30, devis 15/30, factures 15/30, conversations 15/30, tâches 20/40, retards 50/100, demandes 15/30) ; plafonds fixes ailleurs (`get_team` 200, `list_services` 200, `get_timesheets` et `get_d2d_stats` **20 000 lignes** puis agrégation en TS, `get_top_services` **5 000 jobs** en TS, `get_job` 200 visites). `query_schedule` : 200 événements puis jointure jobs en TS. Pas de pagination par curseur ; `total_matching` via `count: 'exact'`.
`get_client_profile` et `get_morning_briefing` font 5 à 6 requêtes chacun (clients, jobs, devis, factures, conversations, tâches, demandes).

## 1.5 Surface DB

| Sujet | État |
|---|---|
| Rôle d'exécution des outils (Lumi) | `ctx.client` = client Supabase **à l'identité de l'utilisateur** (`requireAuthedClient`, `server/lib/supabase.ts`) → RLS active ✔ |
| Rôle d'exécution des outils (MCP) | session OAuth → client utilisateur (`buildUserScopedClient`) ; **clé API → `service_role`** avec filtre `org_id` manuel (`server/routes/mcp.ts` · `buildToolClient()` l. 246-262, lectures seulement, documenté comme compromis) |
| **service_role sur le chemin agent (R4)** — finding critique, à remonter | 24 sites. `server/routes/lumi.ts` : budget, conversations, messages, modes, autorisations, `org_knowledge`, `company_settings` (14 sites). `server/lib/agent/garde.ts` l. 119 (`membre_voit_les_montants`) et l. 163 (`getUserContext`). `server/lib/agent/tools-etendus.ts` : l. 263 journal `agent_actions`, l. 726 `companyOrgIds` (catalogue partagé), l. 1597 `sms_opt_outs` (send_sms), l. 2067/2095/2117 `org_knowledge` (remember/forget/recall), l. 2825 `apply_invoice_payment`, l. 2875 `activity_notes`. `server/routes/mcp.ts` l. 261 et 346. Chaque site a un `org_id` explicite venant du contexte serveur, mais RLS n'est pas la barrière. |
| `tenant_id` / `user_id` (R3) | toujours `ctx.orgId` / `ctx.userId` issus de `requireAuthedClient` (JWT + en-tête `x-org-id` validé contre `memberships`) ou du jeton OAuth/clé API ; **aucun outil n'a `org_id` ou `user_id` dans ses paramètres** (vérifié sur les 69 schémas). Les UUID d'entités sont masqués en réfs courtes vers le modèle et démasqués à l'entrée (`refs.ts`), et chaque handler refiltre `org_id`. |
| Idempotence (R5) | `agent_actions` + index unique, 24 h — voir 1.4. **Le MCP partage le même mécanisme** (mêmes handlers). |
| Audit (R10) | `agent_actions` (qui, quoi, args_hash, résultat, org, date) + `security_events` (`agent_write_executed`, `agent_write_partial`) + `activity_log` pour certains outils. Pas de trace unifiée « énoncé → étage → topic → action → coût » (voir 1.7). 0 ligne dans `agent_actions` en prod aujourd'hui (purge 24 h ; aucune écriture agent dans les dernières 24 h). |
| Journalisation d'usage (A) | `ai_usage` : `org_id, user_id, conversation_id, model, input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens, cost_cents, created_at` — **Lumi seulement**. Détail 5 min / 1 h des écritures en cache lu par `coutEnCents` mais **non stocké**. Rien pour Gemini (#2, #3, #4, #5). |
| Migrations / DDL | aucune dans ce travail (R9 respectée). |

## 1.6 Points d'entrée UI qui aboutissent à un appel LLM

| Entrée | Fichier | Ce qui part | Appel LLM ? |
|---|---|---|---|
| Champ texte Lumi + bouton Envoyer | `src/pages/Lumi.tsx` · `envoyer()` → `envoyerMessageLumi()` (`src/lib/lumiApi.ts`) | texte libre | oui, sauf raccourci |
| 4 suggestions cliquables Lumi (« Quel est mon chiffre du mois ? », « Quelles factures sont en retard ? », « Prépare ma journée de demain », « Qui sont mes meilleurs clients ? ») | `Lumi.tsx` l. 476-478, `onClick={() => envoyer(s)}` | **texte libre identique à chaque clic** | oui, **les 4** — vérifié en direct sur staging le 2026-09-13 : « Quelles factures sont en retard ? » part au modèle (3,2 ¢ à froid) parce que « quelles » et « sont » ne sont pas dans les mots connus de `detecterRaccourci` ; « Quel est mon chiffre du mois ? » idem (« quel ») ; les deux autres ne matchent aucun raccourci. Aucune suggestion n'est absorbée aujourd'hui (correction d'une première lecture qui en comptait 2). |
| Bouton Réessayer | `Lumi.tsx` · `reessayer()` l. 470 | renvoie la dernière question | oui |
| Micro (dictée) | `Lumi.tsx` l. 439 · `useVoiceInput` → `POST /api/agent/transcribe` puis `envoyer()` | audio → texte → tour | **2 appels** (Gemini Pro + Claude) |
| Lien profond `/lumi?c=<id>` (notification du briefing) | `Lumi.tsx` l. 257 ; `briefing.ts` l. 212 | ouvre la conversation | non (lecture) ; la réponse de l'utilisateur dans ce fil = tour normal |
| Carte Confirmer / Annuler | `CarteAutorisation.tsx` → `deciderPropositionLumi()` → `POST /lumi/execute` | exécution + reprise du tour | **oui, 1 appel** après l'exécution pour que le modèle rende compte (`executerTourSse` avec `execute`) |
| Sélecteur de mode, cases « Toujours confirmer », historique, suppression | `Lumi.tsx` | réglages | non |
| Widget « Lumi » page d'accueil publique : champ + 3 suggestions (« Combien ça coûte, Lume ? », …) | `src/components/marketing/LumiAgent.tsx` l. 17-21, 74, 187 | texte libre → `/api/public/sales-chat` | oui (Gemini), **y compris pour les 3 suggestions à texte fixe** |
| Import CSV (mapping des colonnes) | `server/lib/migration/aiSuggest.ts` via la route d'import | nom de colonne | oui (Gemini), une fois par colonne inconnue |
| `MrLumeChat` (4 suggestions, micro) | `src/features/agent/components/MrLumeChat.tsx` | — | page masquée ; **route API toujours ouverte** |

Aucun bouton de l'app métier (jobs, factures, calendrier) ne déclenche de LLM : les automatisations (`server/lib/actions/index.ts` · `executeAction`) sont déterministes.

## 1.7 Données manquantes

| Donnée | Pourquoi | Instrumentation proposée (Phase 2) |
|---|---|---|
| Coût et volume de l'agent de support public (#2), de l'agent Gemini (#3), de la transcription (#4), du mapping CSV (#5) | aucune journalisation d'usage Gemini ; `generateContent` ignore `usageMetadata` de la réponse | journaliser `usageMetadata.{promptTokenCount, candidatesTokenCount, cachedContentTokenCount}` dans `ai_usage` avec `model` Gemini et une colonne `canal` |
| Taux de cache hit réel de Lumi par appel | `ai_usage` a les totaux mais pas le détail 5 min / 1 h ni la distinction prompt / outils / historique | stocker `usage.cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` (déjà lus par `coutEnCents`) |
| Tokens de réflexion (thinking) dans la sortie | l'API les compte dans `output_tokens` sans les séparer | non séparable côté API ; mesurer par différence avec `effort: low` sur la batterie |
| Trafic réel par intention (pour chiffrer les étages 1-4 de la couche zéro-appel) | seulement 13 conversations / 82 messages en prod ; aucune classification loguée ; les énoncés sont dans `lumi_messages.content` mais 82 messages ne font pas une distribution | ajouter dans la trace par tour : `raccourci` (déjà dans l'événement `done`), énoncé normalisé, outils appelés, coût |
| Poids Gemini exact des prompts #2 et #3 | pas d'appel `countTokens` Gemini dans le dépôt ; chiffres donnés avec le tokenizer Sonnet en proxy | `POST models/{model}:countTokens` de Gemini |
| Poids de l'outil serveur `tool_search_tool_regex` | `count_tokens` refuse les outils serveur | mesurer par différence sur un vrai appel (`usage.input_tokens` avec / sans) |
| Latence par tour et par étage | non journalisée (l'interface calcule `duree` côté client seulement) | colonne `duree_ms` dans la trace |
| Feedback utilisateur (« pas ça ») | aucun bouton, aucune table | à concevoir (B3 repli) |
| Les 6 outils sans clé de permission | non listés dans cette passe | `Object.keys(TOOLS_BY_NAME).filter(n => !PERMISSION_PAR_OUTIL[n])` |
| Colonnes projetées outil par outil | 38 lectures × 1 à 6 requêtes ; relevé table/limite fait, colonnes non recopiées | à faire pour les outils lourds (`get_client_profile`, `get_morning_briefing`, `get_timesheets`, `get_d2d_stats`, `get_top_services`) |

---

## Points à trancher avant la Phase 2 (règles impossibles à respecter en l'état)

1. **R4 (jamais de `service_role` sur le chemin agent)** est violée à 24 endroits, dont le journal d'idempotence lui-même (`executerIdempotent`), les gardes de rôle et le stockage des conversations. Respecter R4 à la lettre impose soit des policies RLS sur `agent_actions`, `lumi_*`, `org_knowledge`, `ai_usage` pour `authenticated` (= migration, interdite par R9), soit d'accepter le `service_role` sur ces tables internes et de le proscrire uniquement dans les **handlers d'outils** (l. 1597, 2067, 2095, 2117, 2825, 2875 de `tools-etendus.ts` et `mcp.ts` l. 261). Je propose la seconde lecture ; **à confirmer par toi**.
2. **R8** : `delete_task` supprime physiquement. Le remplacer par un soft delete dépend d'une colonne `deleted_at` sur `tasks` (vue `tasks_active` existe, donc probablement oui — à vérifier en Phase 2, sans migration).
3. **R11** vs mode « argent » : depuis la PR #365, jobs, tâches, statuts, notes et planification partent sans carte en mode par défaut ; `update_job_status → completed` déclenche des SMS au client via les automatisations (sondage d'avis). Strictement, R11 (« jamais d'auto-envoi ») est respectée par l'agent mais pas par l'effet de bord. À classer en Phase 2 (déplacer `update_job_status` dans `ECRITURES_SENSIBLES` quand des automatisations client sont actives ?).
4. **R15** : deux orchestrateurs (Gemini `runAgent`, Claude `tourLumi`) et deux prompts de base (`buildSystemPrompt`, `promptSystemeLumi`) coexistent ; la route Gemini est ouverte sans UI.

Je m'arrête ici. En attente de ton go pour la Phase 2 (`COST_AUDIT.md` + `AGENTFORCE_GAP.md`), toujours en lecture seule.
