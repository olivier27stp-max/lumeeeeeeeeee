# AGENTFORCE_GAP — Architecture déterministe, parité Agentforce (Phase 2, lecture seule)

Base : `AGENT_MAP.md`, `COST_AUDIT.md` (commit `16567e36`). Modèle cible : ZÉRO-APPEL → TOPICS → ROUTEUR → ACTIONS → GROUNDING → GUARDRAILS → ESCALADE → EVALS → OBSERVABILITÉ → VERSIONNAGE. Pour chaque brique : état actuel avec fichiers, écart, proposition ancrée dans le code, effort (S/M/L), risque.

Lecture des règles retenue pour ce document (à confirmer, voir la fin d'`AGENT_MAP.md`) : R4 s'applique aux **handlers d'outils** ; les tables internes de l'agent (`ai_usage`, `agent_actions`, `lumi_*`, `org_knowledge`) restent servies par le client service avec `org_id` du contexte serveur tant que R9 interdit d'ajouter des policies.

---

## Vue d'ensemble

| Brique | État | Écart | Effort |
|---|---|---|---|
| B1 Topics | absent (un seul prompt, 14 outils de base + recherche regex) | découpe, instructions par topic, refus hors topic | M |
| B2 Registre d'actions | **existe de fait** : 69 `AgentTool` (`declaration` = schéma, `kind`, `handler`, `needsIdentity`), garde de rôle, idempotence, journal | pas de schéma de sortie, pas de dry-run, pas de « réversible », gabarits de réponse pour 5 actions seulement | M |
| B3 Couche zéro-appel | étage 2 partiel (5 raccourcis), étage 0 partiel (2 suggestions sur 4 ; 0 sur 3 côté public) | étages 0, 1, 3 absents ; étage 4 absent ; repli absent | M |
| B4 Routeur | absent (Sonnet fait classification + exécution dans le même appel) | routeur Haiku JSON strict, seuil, fallback | M |
| B5 Grounding | Lumi : résultats d'outils seulement ✔ ; public : doc dans le prompt | citation de source absente ; « je ne sais pas » testé mais non structurel | S |
| B6 Guardrails | rôle, montants, modes, confirmation, plafond mensuel, rate limit ✔ | plafond d'écritures par session ; `update_job_status` déclenche des SMS sans carte ; `delete_task` physique | S |
| B7 Escalade humaine | absent | critères, transmission, affichage | M |
| B8 Evals | **existe** : 80 cas, CI hebdo, coût par run (`scripts/qa/evaluer-lumi.mjs`, `.github/workflows/lumi-eval.yml`) | pas d'assertion topic/action/params (assertions sur texte et outils) ; pas de golden set pour le routeur ; rien pour sales-chat | S |
| B9 Observabilité | `ai_usage` + `agent_actions` + `security_events` + `lumi_messages` | pas de trace unifiée par tour ; rien côté Gemini | M |
| B10 Versionnage | prompts dans le dépôt ✔ (`orchestrateur.ts`, `consignesCollegue.ts`, `sales-chat.ts`, `systemPrompt.ts`) | prompt public au milieu d'une route ; pas de numéro de version envoyé dans la trace | S |
| B11 Audit UI | 4 + 3 suggestions à texte fixe → LLM ; bouton Confirmer → 1 appel de compte rendu ; route Gemini orpheline | voir tableau B11 | S |

---

## B1. Topics

**État.** `promptSystemeLumi()` (`server/lib/lumi/orchestrateur.ts` l. 175-236) est un prompt unique ; les 14 outils de `OUTILS_DE_BASE` (l. 131-140) sont toujours chargés ; les 55 autres sont découverts par `tool_search_tool_regex` avec des familles déjà nommées dans le prompt (« devis, factures, paiements (`quote|invoice|payment|paid|reminder`) ; jobs, horaire, trajets… »). Ces familles sont des topics implicites.

**Écart.** Aucune instruction par topic, aucune liste d'actions autorisées par topic, aucun refus formulé par topic. Le modèle paie à chaque tour les 14 outils de base même pour « parle-moi de Lume ».

**Proposition.** Fichier `server/lib/lumi/topics.ts` (nouveau, versionné) :

```ts
export interface Topic {
  id: 'planification' | 'facturation' | 'clients' | 'communications' | 'equipe' | 'rapports' | 'memoire' | 'hors_scope';
  description: string;          // pour le routeur B4 (classification)
  instructions: string;         // 5-10 lignes, remplacent la section correspondante du prompt
  actions: string[];            // sous-ensemble de TOOLS_BY_NAME
  refuse: string[];             // ce que le topic ne fait pas (redirige)
}
```

Découpe proposée à partir des 69 outils existants :

| Topic | Outils (lecture) | Actions (écriture) |
|---|---|---|
| planification | `query_schedule`, `list_jobs`, `get_job`, `get_day_route`, `find_free_slot`, `find_dates_in_location`, `optimize_route`, `get_team_locations` | `create_job`, `update_job`, `update_job_status`, `assign_job`, `archive_job`, `add_visit`, `reschedule_job`, `cancel_visit`, `set_job_expenses` |
| facturation | `list_invoices`, `list_quotes`, `get_overdue_payments`, `get_revenue_summary`, `get_financial_overview`, `compare_revenue`, `get_job_profitability`, `get_top_services` | `create_quote`, `send_quote`, `cancel_quote`, `convert_quote_to_job`, `create_invoice`, `create_invoice_from_job`, `send_invoice`, `mark_invoice_paid`, `send_payment_reminders` |
| clients | `search_clients`, `search_leads`, `get_client_profile`, `get_top_clients`, `get_churn_risk`, `list_request_submissions` | `create_client`, `update_client`, `convert_lead_to_client`, `merge_clients`, `add_note` |
| communications | `get_conversations`, `get_conversation_messages` | `send_sms`, `send_email` |
| equipe | `get_team`, `get_timesheets`, `get_payroll_summary`, `get_d2d_stats`, `list_courses`, `list_tasks` | `create_task`, `update_task`, `update_task_status`, `delete_task` |
| rapports | `build_report`, `get_morning_briefing`, `list_automations`, `get_automation_health`, `get_company_info`, `list_services` | — |
| memoire | `recall_notes`, `get_recent_agent_actions` | `remember_this`, `forget_note` |

Branchement : `outilsClaude()` (l. 150) reçoit le topic choisi par B4 et met en base les outils du topic (les autres restent différés). Le bloc stable du prompt garde rôle + sécurité + consignes collègue ; `topic.instructions` entre dans le bloc **variable**. Attention cache : un jeu d'outils de base différent par topic = une cache 1 h par (org, topic) ; avec 7 topics et le volume mesuré (22 écarts sur 28 sous 5 min, même conversation = même topic le plus souvent) le coût en démarrages à froid est acceptable, mais à mesurer avec Q4.

**Effort** M. **Risque** moyen : la batterie (`scripts/qa/evaluer-lumi.mjs`) contient des énoncés multi-topics (« pave » : horaire d'hier + factures en retard) ; le routeur doit pouvoir répondre `topic: 'multi'` → agent complet sans restriction.

## B2. Registre d'actions

**État (réel, à réutiliser tel quel).** `AgentTool` (`server/lib/agent/tools.ts` l. 36-59) : `declaration` (nom, description, `parameters` JSON Schema), `kind: 'read' | 'write'`, `handler(args, ctx)`, `needsIdentity`, `canal`. `TOOLS_BY_NAME` (l. 893). Garde : `executerOutilGarde()` (`garde.ts` l. 150) = permission de rôle (`PERMISSION_PAR_OUTIL`, 63 outils) + montants (`OUTILS_FINANCIERS`, 18). Écriture : `executerIdempotent()` (`tools-etendus.ts` l. 257) = empreinte `sha256(args)` dans `agent_actions` (index unique `(org_id, outil, args_hash)`, purge 24 h) + `security_events`. Exécution Lumi : `executerEcriture()` (`server/lib/lumi/execution.ts`) ; MCP : `routes/mcp.ts` l. 291-420 (même handler, même garde). Validation d'entrée : `champRequis`, `clamp`, `normalizeE164` dans les handlers ; **pas de Zod sur les args d'outils** (Zod est sur les routes, `server/lib/validation.ts`).

**Écart vs R2/R7/R12 et Agentforce.**
- Pas de schéma d'entrée strict validé par code (le JSON Schema sert au modèle, pas au serveur) → ajouter `strict: true` sur les déclarations Anthropic (`outilsClaude()`) **et** une validation Zod dérivée du même schéma dans `executerOutilGarde()` avant le handler.
- Pas de schéma de sortie déclaré ; les gabarits (`rendreRaccourci`, `composerBriefing`) et les fiches (`fichesDuResultat`) sont la sortie de fait.
- Pas de dry-run (R12) : proposer `ctx.dryRun: boolean` dans `ToolContext`, honoré par `executerIdempotent` (n'insère pas l'empreinte, n'appelle pas `action()`, renvoie `{ dry_run: true, would: outil, args }`) ; les 6 handlers qui écrivent sans passer par un RPC unique (`update_job`, `create_quote` + recalcul, `send_payment_reminders`, `add_note`, `update_client`, `set_job_expenses`) doivent tester `ctx.dryRun` avant chaque écriture ; les RPC ne peuvent pas être « à blanc » sans migration → pré-validation R7 en TS puis retour.
- Pré-validation R7 : existence des FK (`client_id`, `job_id`) et transitions d'état vivent dans les RPC (`rpc_create_job_with_optional_schedule`, `finish_job_and_prepare_invoice`) ou dans les routes internes (`/quotes/convert-to-job` refuse un devis non accepté). Manque une vérification TS **avant** l'empreinte pour `update_job_status` (statut légal : `ETIQUETTES_DERIVED` existe pour l'affichage, pas de state machine côté outil), `update_task_status`, `cancel_quote`.
- Champ « réversible » et « sensible » : `ECRITURES_SENSIBLES` (`execution.ts`) et `ECRITURES_ANODINES` (orchestrateur) sont deux listes ; les rendre attributs de l'`AgentTool` (`sensible: true`, `reversible: false`) pour n'avoir qu'une source.

**Classement des 69 capacités.**

DÉTERMINISABLE (fonction TS + gabarit, paramètres extraits par le routeur) — 21 :

| Action | Fonction existante | Gabarit | Paramètres à extraire |
|---|---|---|---|
| compter les clients | `search_clients` (`total_matching`) | `rendreRaccourci('clients-total')` ✔ | — |
| agenda du jour / demain / semaine | `query_schedule` | `rendreRaccourci('agenda')` ✔ | `periode` |
| revenu du mois | `get_revenue_summary` | ✔ | `period` (this_month / this_year / last_30_days) |
| factures en retard | `get_overdue_payments` | ✔ | — |
| briefing | `get_morning_briefing` → `composerBriefing` ✔ | ✔ | — |
| meilleurs clients | `get_top_clients` | à écrire (liste nom · montant) | `limit` |
| job par numéro | `get_job` (job_number) | à écrire (fiche : client, date, statut affiché, total) | `job_number` |
| fiche client | `get_client_profile` | à écrire | `client_id` via `search_clients` (ambiguïté → question) |
| tâches ouvertes | `list_tasks` | à écrire | `assignee` |
| devis en attente | `list_quotes` (`status`) | à écrire | `status` |
| équipe | `get_team` | à écrire (noms + rôles affichés) | — |
| où est l'équipe | `get_team_locations` | à écrire | — |
| créer une tâche | `create_task` | reçu « Tâche « X » créée pour lundi » | `title`, `due_date`, `assignee` |
| changer le statut d'une tâche | `update_task_status` | reçu | `task`, `status` |
| terminer / démarrer une job | `update_job_status` | reçu + avertissement automatisations | `job`, `status` |
| assigner une job | `assign_job` | reçu | `job`, `membre` |
| replanifier / annuler une visite | `reschedule_job`, `cancel_visit` | reçu | `job`, `date` |
| marquer une facture payée | `mark_invoice_paid` | reçu (sensible, carte) | `invoice`, `montant`, `mode` |
| retenir / oublier | `remember_this`, `forget_note` | « C'est noté » | `key`, `note` |
| envoyer devis / facture existants | `send_quote`, `send_invoice` | carte avec document (existe : `apercuProposition`) | `quote`, `to` |

GÉNÉRATIF (Sonnet) — le reste : créer un devis ou une facture avec articles (rédaction des lignes, prix, taxes), créer un job complet, texto ou courriel rédigé, relances personnalisées, fusion de doublons (jugement), rapports commentés, conseil (« ça vaut la peine de relancer ? »), multi-étapes (« crée le job, assigne-le et texte le client »), toute demande ambiguë.

Vocabulaire des gabarits : statut **affiché** uniquement — `ETIQUETTES_DERIVED` (`tools.ts`) et le champ `statut` déjà renvoyé en français par les outils ; jamais `scheduled`, `sent`.

**Effort** M (validation Zod + dry-run + attributs) ; gabarits S chacun. **Risque** faible : le chemin d'exécution ne change pas, on ajoute des vérifications avant.

## B3. Couche zéro-appel

**État.**
- Étage 0 : rien de formel. Les 4 suggestions Lumi (`src/pages/Lumi.tsx` l. 476-478) envoient du texte libre et **aucune** n'est absorbée par un raccourci (vérifié en direct le 2026-09-13 : « Quelles factures sont en retard ? » = 3,2 ¢ à froid). Les 3 suggestions publiques (`LumiAgent.tsx`) → Gemini. Le clic Confirmer (`POST /lumi/execute`) exécute sans modèle puis rappelle le modèle pour la phrase de compte rendu.
- Étage 1 : absent.
- Étage 2 : `detecterRaccourci()` (`server/lib/lumi/raccourcis.ts`) — 5 intentions, détection « mots vides + mots-clés, message entier, ≤ 12 mots », tests `tests/lumi-raccourcis.test.ts`. Vérifié : « combien de clients à Saint-Bruno » retombe sur le modèle.
- Étage 3 et 4 : absents.
- Repli : absent (le bouton Réessayer renvoie au modèle mais ne marque rien).

**Proposition (ordre strict, sortie au premier étage qui matche).**

Étage 0 — `POST /lumi/action` (nouvelle route, à côté de `/lumi/chat`) : corps `{ action, params, conversation_id }` validé Zod, `action` ∈ registre B2 déterminisable. Les suggestions deviennent `{ label, action, params }` ; « Prépare ma journée de demain » → `{ action: 'agenda', params: { periode: 'demain' } }`. Le clic Confirmer garde `/lumi/execute` mais **sans rappel du modèle** (F2 dans `COST_AUDIT.md`) : réponse gabarit à partir de `ficheCreee`. Message stocké comme aujourd'hui (`sauverMessages`, rôle assistant, `content: [{ type: 'text' }]`) pour que le modèle ait le contexte si l'utilisateur écrit ensuite. Côté public : `REPONSES_FIXES` dans `sales-chat.ts` pour les 3 suggestions.

Étage 1 — table `ENONCES_EXACTS` dans `raccourcis.ts` : `normaliser(message).join(' ')` → `{ id, args }`. Alimentée par les énoncés loggués (B9) ; plafond **30 entrées** (au-delà, étage 5). Aujourd'hui : 0 donnée réelle (82 messages), donc démarrer avec les 4 + 3 suggestions et les 8 énoncés de la batterie qui matchent déjà.

Étage 2 — l'existant, étendu à `top-clients`, `job-numero` (regex `\bjob\s*#?\s*(\d{1,6})\b`, sans autre mot inconnu), `taches`, `equipe`, `devis-attente`, `ou-equipe`. Plafond 30 énoncés-types cumulés étages 1 + 2.

Étage 3 — cache de réponse : clé `sha256(normalisé + org_id + user_id + version_contexte)` où `version_contexte` = `max(updated_at)` des tables touchées par l'action (jobs, invoices, clients… lisibles via une requête légère par outil). TTL 60 s pour les données mouvantes, invalidation par la version. Stockage : Redis déjà présent (`server/lib/rate-limiter.ts` · `redisRateLimit` → client Redis) ; clé préfixée `lumi:rep:`. Ne s'applique qu'aux lectures (étages 0-2 y passent déjà sans modèle : l'étage 3 sert surtout aux réponses **du modèle** à un énoncé identique répété, ex. « et mes factures ? » deux fois). Valeur réelle : **non mesurable** (aucune répétition observable sur 82 messages) → à activer après B9.

Étage 4 — cache sémantique : embedding de l'énoncé, similarité contre les réponses précédentes **du même org et du même user** pour les données client ; index partagé entre orgs **uniquement** pour le support produit (sales-chat, questions « comment je fais X dans Lume »). Seuil proposé 0,92 (cosinus) à calibrer sur la batterie ; sous le seuil → étage 5. Clé de cache pour les données client : `(org_id, user_id, embedding)` — le seul endroit du système où une fuite inter-tenant est possible par conception ; test d'isolation obligatoire avant activation (deux orgs, même question, réponses différentes). Fournisseur d'embeddings : aucun dans le dépôt aujourd'hui (pas de `voyage`, pas d'`embeddings`) ; **à choisir** ; coût ~1 000× inférieur à un tour (ordre de grandeur de l'énoncé, non mesuré ici). Je recommande de **ne pas** l'implémenter avant d'avoir 30 jours de trace B9 : à 40 appels / mois il n'y a rien à mettre en cache.

Étage 5 — routeur B4. Étage 6 — `tourLumi()`.

Repli : si l'utilisateur répond « non », « pas ça », « c'est pas ça » (liste courte, `normaliser`) ou clique Réessayer après un étage 0-4, la requête précédente est renvoyée directement à l'étage 6 avec `origine: 'repli'`, et l'énoncé est loggé `candidat_retrait` (B9). Le message stocké de la réponse gabarit reste en base (contexte).

Contrainte dure : les étages 0-4 n'écrivent **que** via `executerEcriture()` → `executerOutilGarde()` → `executerIdempotent()` (R2, R5, R7) et une écriture sensible passe par la carte (R11), donc étage 0 pour une écriture = proposition, pas exécution.

Part de trafic absorbable par étage : **non mesurable** aujourd'hui. Sur la batterie (80 énoncés, biaisée vers les cas difficiles) : étage 2 actuel = 8 / 80 ; avec les 6 raccourcis ajoutés ≈ 14 / 80 (compté à la main sur les questions de `CAS`). Logging à ajouter : B9.

**Effort** M (étages 0-2 + repli : S chacun ; étage 3 : M ; étage 4 : L). **Risque** faible pour 0-2 (gabarits testables), moyen pour 3-4 (fraîcheur, isolation).

## B4. Routeur

**État.** Absent : Sonnet reçoit le message et décide seul (outils + texte).

**Proposition.** `server/lib/lumi/routeur.ts` : un appel `claude-haiku-4-5`, `max_tokens: 200`, sans thinking (`parametresReflexion` renvoie déjà `{}` pour Haiku), `output_config.format` JSON strict (structured outputs) ou `strict: true` sur un outil unique `classifier` :

```json
{ "topic": "facturation", "action": "retards", "params": {}, "confidence": 0.93 }
```

Règles :
- `confidence < 0,85` ou `action` absente du registre déterminisable → étage 6 (Sonnet) avec le `topic` comme indice (B1).
- JSON invalide (parse ou Zod) → étage 6, jamais d'action devinée, événement `routeur_invalide` dans la trace.
- `topic: 'hors_scope'` → réponse gabarit « Je m'occupe de Lume : clients, jobs, devis, factures… » (0 appel supplémentaire).
- `topic: 'multi'` → étage 6 sans restriction d'outils.
- Le routeur ne voit **jamais** d'identifiant ni de résultat d'outil : entrée = énoncé + liste des topics ; sortie = noms d'action et paramètres validés Zod contre le schéma de l'action (R1, R3).
- Coût : prompt du routeur ≈ descriptions de 7 topics + 21 actions (à mesurer avec `count_tokens` ; ordre de grandeur 600-1 000 tokens, cache 1 h) + énoncé ; Haiku 1 $ / M. **Non mesuré** avant écriture.

Mode « observation » recommandé 30 jours : le routeur classifie et logue mais n'agit pas ; on compare à ce que Sonnet a fait (outils appelés) pour calibrer le seuil sur du trafic réel plutôt que sur la batterie.

**Effort** M. **Risque** : un routeur trop confiant exécute la mauvaise lecture (jamais une écriture sans carte : contrainte B3). La batterie doit gagner une colonne `topic` / `action` attendus (B8).

## B5. Grounding

**État.** Lumi : « chaque chiffre, nom ou date vient d'un résultat d'outil » (prompt, `orchestrateur.ts`), `total_matching` et sommes fournies par les outils, réfs masquées ; testé par la batterie (`piege-*`, `secu-*`, `injection-fiche` : contenu des fiches = donnée). Public : doc produit dans `SYSTEM_PROMPT` (2 291 tokens), règles d'honnêteté explicites (« n'invente jamais de statistique »).

**Écart.** Pas de citation de source dans les réponses Lumi (les fiches liées `FichesLiees` en tiennent lieu pour les entités, pas pour les chiffres). Pas de retrieval sur la doc produit (`docs/`, pages `/fonctions/*`) pour les questions « comment je fais X dans Lume ? » : Lumi répond de mémoire du prompt ou dit qu'il ne sait pas.

**Proposition.** (1) Règle structurelle plutôt que prompt : dans `rendreRaccourci` et les gabarits B2, chaque chiffre vient d'un champ nommé du résultat (déjà le cas). (2) Pour le support produit : outil de lecture `search_help(query)` sur un index texte des pages `src/pages/marketing/fonctionsData.ts` et `docs/` (Postgres `tsvector` = **migration**, R9 ; alternative sans migration : index en mémoire au démarrage, `MiniSearch`-like, ~40 pages) ; réponse avec le titre de la page comme source. (3) Sales-chat : mêmes données, ce qui permet de sortir la doc du prompt si elle grossit.

**Effort** S (1), M (2). **Risque** faible.

## B6. Guardrails

**État.**
- Hors scope : prompt (« Tu opères strictement dans l'espace de… », refus des identifiants techniques) ; batterie `hors-sujet`, `secu-*`.
- Confirmation : carte avec contenu exact et destinataire (`apercuProposition` : document devis/facture, SMS `{ to, body }`, courriel `{ to, subject, body }`), groupe d'écritures = une carte ; modes `demander` / `argent` / `tout` (`execution.ts` · `MODES_LUMI`) + « toujours confirmer » par outil (`lumi_autorisations`).
- Permissions : `executerOutilGarde` → `hasPermission(getUserContext(...))` = la page Rôles ; `membre_voit_les_montants` ; le client Supabase des handlers est celui de l'utilisateur (RLS) sauf 7 sites (`AGENT_MAP.md` 1.5).
- Plafonds : mensuel par org, paliers, 60 tours / h / personne, 30 req / min.

**Écarts.**
1. Aucun plafond d'écritures par session ni par heure : en mode `tout`, une boucle de 8 étapes peut enchaîner 8 écritures par tour, 60 tours / h.
2. `update_job_status → completed` (non sensible en mode `argent`) déclenche `POST /automations/events/job-completed` → SMS et courriel au client (sondage d'avis) **sans carte** : R11 respectée par l'agent, contournée par l'effet de bord.
3. `delete_task` : DELETE physique alors que `tasks.deleted_at` existe et que `tasks_active` filtre dessus (R8).
4. 6 outils sans clé de rôle : `get_company_info`, `list_courses`, `recall_notes`, `forget_note`, `get_recent_agent_actions`, `remember_this` — les deux écritures de mémoire sont exécutables par tout membre, y compris un rôle qui ne peut rien modifier ailleurs.
5. Mode `tout` : « un texto peut partir sans que tu le voies » (libellé de l'interface). Contraire à R11 par construction ; à réserver à un rôle propriétaire, ou à retirer.

**Proposition.** (1) `execution.ts` : compteur d'écritures par conversation (dans `lumi_conversations`, colonne → **migration** ; sans migration : compter les `executed` dans `lumi_messages` au chargement) avec refus au-delà de 20 et message gabarit. (2) `ECRITURES_SENSIBLES` calculé : `update_job_status` devient sensible quand l'org a une règle `job.completed` active vers le client (`automation_rules`, lecture déjà faite par `list_automations`) ; la carte affiche « terminer la job enverra le sondage d'avis à X ». (3) `delete_task` → `update({ deleted_at: now() })`. (4) Ajouter `remember_this` / `forget_note` à `PERMISSION_PAR_OUTIL` (clé la moins privilégiée qui écrit, ex. `tasks.create`). (5) Mode `tout` réservé à `owner` (`memberships.role`).

**Effort** S. **Risque** faible ; (2) change le comportement par défaut d'un cas fréquent (terminer une job) : à annoncer.

## B7. Escalade humaine

**État.** Absent. L'échec d'un outil devient une phrase (« ça n'a pas marché »), `security_events` reçoit `agent_write_partial` ; personne n'est prévenu, rien n'est transmis.

**Proposition.** Critères : `EffetPartiel` (écriture à moitié faite), refus du modèle (`stop_reason: refusal`), `trop_d_etapes`, repli B3 deux fois de suite sur la même conversation, `routeur_invalide` répété. Transmission : tâche Lume (`create_task` existant, assignée au propriétaire) avec résumé (dernier énoncé, action, résultat) + lien `/lumi?c=<id>` (pattern du briefing, `briefing.ts` l. 208-213 pour la notification). Affichage : la notification existante (`notifications`, type `lumi_briefing` → nouveau type `lumi_escalade`) et un bandeau dans la conversation. Pas de LLM impliqué.

**Effort** M. **Risque** faible.

## B8. Evals

**État.** `scripts/qa/evaluer-lumi.mjs` : 80 cas réels (factuel, présentation, action, sécurité, rapports, outils, robustesse dont typos / franglais / injection, conversation, exécution, quota, rôles), assertions sur le texte, les outils appelés, la proposition, la base ; coût par run mesuré (0,58 $) ; CI hebdo + déclenchement manuel avec seuil et modèle (`.github/workflows/lumi-eval.yml`) ; artefact JSON. Référence : 5-6 % d'erreurs.

**Écart.** Pas d'assertion `topic` / `action` / `params` (nécessaire pour B4) ; les énoncés viennent de l'auteur, pas des logs ; rien pour sales-chat ; pas de précision de routage ni de coût par requête par étage.

**Proposition.** Ajouter à chaque `CAS` : `topic_attendu`, `action_attendue`, `params_attendus` ; nouveau script `scripts/qa/evaluer-routeur.mjs` qui ne joue que le routeur (Haiku, < 0,05 $ / run estimé — **non mesuré**) et sort précision de topic, précision d'action, taux de fallback. Sortie commune : `taux_erreur_pct`, `cout_cents`, plus `cout_moyen_par_requete` et `part_par_etage`. Sales-chat : 20 énoncés (prix, essai gratuit, hors sujet, injection) avec assertions sur les faits du prompt. Golden set enrichi des énoncés réels dès que B9 les logue.

**Effort** S. **Risque** nul.

## B9. Observabilité

**État.** Quatre tables sans jointure naturelle : `ai_usage` (tokens, coût, conversation), `agent_actions` (écritures, 24 h), `security_events` (`agent_write_*`, `lumi_budget_econome`), `lumi_messages` (énoncés, `tool_use`, `tool_result`, `thinking`). Événement SSE `done` porte `raccourci` mais rien ne le stocke. Latence, étage, topic, origine (suggestion / texte / voix / carte), feedback : absents.

**Proposition.** Table `lumi_traces` (**migration**, SQL commenté ci-dessous, non exécutée) — une ligne par tour : `org_id, user_id, conversation_id, message_id, origine, enonce_normalise, etage, topic, action, params (jsonb), outils (text[]), resultat ('ok'|'refus'|'erreur'|'proposition'), model, input_tokens, cache_5m, cache_1h, cache_lu, output_tokens, cost_cents, duree_ms, feedback, created_at`. Elle remplace `ai_usage` pour Lumi (ou `ai_usage` gagne ces colonnes) et sert R10 (audit), A (coût), B3 (part par étage), B4 (calibrage), B8 (golden set). Écriture : `executerTourSse` (route) et la branche raccourci, sous le client service (table interne, `org_id` du contexte).

```sql
-- PROPOSITION, NON EXÉCUTÉE (R9). À passer par supabase/migrations + db:apply staging puis prod.
-- create table public.lumi_traces (
--   id uuid primary key default gen_random_uuid(),
--   org_id uuid not null references public.orgs(id) on delete cascade,
--   user_id uuid not null references auth.users(id) on delete cascade,
--   conversation_id uuid references public.lumi_conversations(id) on delete set null,
--   origine text not null check (origine in ('texte','suggestion','voix','carte','repli','lien')),
--   enonce_normalise text,
--   etage smallint not null check (etage between 0 and 6),
--   topic text, action text, params jsonb,
--   outils text[] not null default '{}',
--   resultat text not null check (resultat in ('ok','refus','erreur','proposition')),
--   model text, input_tokens int, cache_5m int, cache_1h int, cache_lu int, output_tokens int,
--   cost_cents numeric(10,4) not null default 0,
--   duree_ms int, feedback text,
--   created_at timestamptz not null default now()
-- );
-- alter table public.lumi_traces enable row level security;
-- create policy lumi_traces_select_membre on public.lumi_traces for select to authenticated
--   using (public.has_org_membership(auth.uid(), org_id));
-- create index lumi_traces_org_date_idx on public.lumi_traces (org_id, created_at desc);
```

**Effort** M. **Risque** nul (écriture asynchrone, jamais bloquante ; `dead_letters` si l'insertion échoue, pattern de `catch-vides-chemins-ecriture.test.ts`).

## B10. Versionnage

**État.** Tous les prompts sont dans le dépôt : `server/lib/lumi/orchestrateur.ts` (`promptSystemeLumi`), `server/lib/agent/consignesCollegue.ts` (partagé MCP / Lumi, test de conformité), `server/routes/sales-chat.ts` (`SYSTEM_PROMPT`), `server/lib/agent/systemPrompt.ts` (agent Gemini, orphelin), descriptions d'outils dans `tools*.ts`. Diffables et réversibles par git ✔. Aucune version n'est envoyée avec les appels ni stockée avec les traces.

**Proposition.** `server/lib/lumi/version.ts` : `export const VERSION_PROMPT = 'v2026-09-11'` (mis à jour à la main par PR, vérifié par un test qui compare un hash du bloc stable à une valeur figée : un changement de prompt sans bump de version fait échouer le test). La version voyage dans `lumi_traces.model` (ou une colonne `prompt_version`) et dans l'artefact de la batterie. Sortir `SYSTEM_PROMPT` de `sales-chat.ts` vers `server/lib/agent/promptVente.ts` (déplacement de texte seulement — hors R16 si tu le refuses, il reste où il est).

**Effort** S. **Risque** nul.

## B11. Audit UI — ce qui déclenche un LLM alors qu'un appel API suffirait

| Entrée | Fichier | Aujourd'hui | Cible | Gain |
|---|---|---|---|---|
| 4 suggestions Lumi | `src/pages/Lumi.tsx` l. 476-478, 605-606 | texte libre → modèle (0 sur 4 absorbées par un raccourci, vérifié) | `{ action, params }` → `POST /lumi/action` (étage 0) | 1 appel + éventuel démarrage à froid par clic |
| 3 suggestions publiques | `src/components/marketing/LumiAgent.tsx` l. 17-21, 187 | texte libre → Gemini | réponses fixes serveur | 1 appel Gemini par clic |
| Clic Confirmer | `src/components/lumi/CarteAutorisation.tsx` → `deciderPropositionLumi` → `POST /lumi/execute` | exécution + 1 appel modèle pour « c'est fait » | gabarit de reçu, modèle seulement si l'utilisateur écrit | 1 appel par écriture confirmée |
| Clic Annuler | idem | `tool_result cancelled` + 1 appel modèle | gabarit « Annulé. » | 1 appel par annulation |
| Bouton Réessayer | `Lumi.tsx` l. 470 | renvoie la question au modèle | repli B3 : ré-étage 6 avec `origine: 'repli'` et log `candidat_retrait` | 0 (même coût, mais instrumenté) |
| Micro | `useVoiceInput` → `/api/agent/transcribe` (Gemini Pro) | 2 appels par message | transcription Flash (env) puis étages 0-5 comme un texte | non mesurable (Q3) |
| Lien `/lumi?c=` (briefing) | `Lumi.tsx` l. 257 | 0 appel ✔ | — | — |
| Sélecteur de mode, autorisations, historique | `Lumi.tsx` | 0 appel ✔ | — | — |
| `MrLumeChat` masqué mais `POST /api/agent/chat` ouvert | `server/index.ts` l. 767 | Gemini, non journalisé | fermer (Q5) | surface morte |

---

## Ordre d'implémentation recommandé (un item à la fois, R20)

| # | Item | Dépend de | Effort | Pourquoi dans cet ordre |
|---|---|---|---|---|
| 1 | **B9 trace** (`lumi_traces` : SQL à valider puis migration par toi ; en attendant, colonnes dans `ai_usage` : `origine`, `etage`, `outils`, `duree_ms`, `cache_5m`, `cache_1h`) + Q3 Gemini | — | M | tout le reste se mesure avec ça (R19) |
| 2 | **Q5** fermer `/api/agent/chat` | — | S | surface morte, R15 |
| 3 | **B6** garde-fous : plafond d'écritures par conversation, `delete_task` soft, `remember_this` / `forget_note` sous permission, mode `tout` réservé au propriétaire, `update_job_status` sensible si automatisation client active | — | S | sécurité avant optimisation |
| 4 | **B2** registre : `sensible` / `reversible` sur `AgentTool`, validation Zod des args dans `executerOutilGarde`, `ctx.dryRun` dans `executerIdempotent` et les 6 handlers TS, `strict: true` côté Anthropic | — | M | R2, R7, R12 ; prérequis des étages 0-2 |
| 5 | **B3 étage 0** : `POST /lumi/action`, suggestions en `{ action, params }`, reçu gabarit après Confirmer / Annuler (F2), réponses fixes publiques (Q1) | 4 | S | premier gain de coût réel, 0 risque |
| 6 | **B3 étages 1-2** : 6 raccourcis de plus + table d'énoncés exacts (≤ 30) + repli | 4, 1 (pour alimenter) | S | |
| 7 | **B8** colonnes `topic` / `action` / `params` dans la batterie + `evaluer-routeur.mjs` + 20 cas sales-chat | — | S | avant B4, sinon on calibre à l'aveugle |
| 8 | **B10** version de prompt + test de hash ; prompt public sorti de la route | — | S | |
| 9 | **E1** dégraisser les 14 descriptions d'outils, mesuré par `count_tokens`, validé par la batterie | 7 | S | |
| 10 | **B4 routeur** en mode observation 30 jours, puis actif avec seuil calibré | 1, 7 | M | |
| 11 | **B1 topics** (jeu d'outils de base par topic, instructions par topic) | 10 | M | dépend de la fiabilité mesurée du routeur |
| 12 | **B7 escalade** | 1 | M | |
| 13 | **B3 étage 3** cache de réponse (Redis) | 1 | M | seulement si la trace montre des répétitions |
| 14 | **B5 grounding** support produit (`search_help`) | — | M | |
| 15 | **B3 étage 4** cache sémantique | 1, 13, test d'isolation | L | dernier : seul étage avec un risque inter-tenant, et sans valeur au volume actuel |

Non retenu : Haiku pour les tours complets (batterie), résumé compacté de l'historique (max 28 messages en prod), Batch API (rien d'éligible), retrieval pour le prompt public (2 291 tokens).

Fin de la Phase 2. Aucun fichier du dépôt modifié en dehors des trois rapports (`AGENT_MAP.md`, `COST_AUDIT.md`, `AGENTFORCE_GAP.md`), aucun push. En attente de ton go sur l'item 1.


---

## État après implémentation (2026-09-13) — branche locale `agent/item1-traces`, jamais poussée

Worktree `C:\Users\Rafba\lume-worktrees\item1`, 11 commits au-dessus de `origin/main` (`97baa5a1` → `de98adff`). Aucun push, aucun merge, aucun déploiement. Une migration appliquée (staging puis prod, sur consigne de Rafba) : `20260913000000_lumi_traces.sql`.

| # | Item | État | Fichiers principaux | Preuve |
|---|---|---|---|---|
| 1 | Trace unifiée + usage Gemini | fait, en base | `server/lib/lumi/traces.ts`, `supabase/migrations/20260913000000_lumi_traces.sql`, `gemini.ts` (`usageDeReponseGemini`) | 3 canaux tracés en direct sur staging ; RLS vérifiée avec une session membre |
| 2 | Route Gemini orpheline fermée | fait | `server/routes/agent.ts` (410 `agent_retire`) | `tests/lume-agent-masque.test.ts` |
| 3 | Garde-fous | fait | `execution.ts` (plafond 20 écritures / conversation, `ecrituresSensiblesPour`), `garde.ts` (mémoire sous `settings.update`), `routes/lumi.ts` (mode « tout » = propriétaire) | `tests/lumi-garde-fous.test.ts` ; R8 déjà satisfaite (`delete_task` = soft delete, relecture corrigée) |
| 4 | Registre d'actions | fait | `server/lib/agent/registre.ts` (sensible / anodine / réversible / vers_client), `validation-args.ts` (types, requis, choix, inconnus retirés, branché dans `executerOutilGarde`), `ctx.dryRun` + `decision: 'dry_run'` | `tests/lumi-registre.test.ts` ; dry-run vérifié en direct (`{"dry_run":true,…}`) |
| 5 | Étage 0 | fait | `POST /lumi/action` (actions nommées), `recus.ts` (reçu sans modèle après Confirmer / Annuler), `reponsesFixes.ts` (widget public), suggestions Lumi = actions | 4 suggestions à 0 ¢ en direct ; 3 réponses fixes publiques |
| 6 | Étages 1-2 + repli | fait | `raccourcis.ts` : `ENONCES_EXACTS` (23 entrées, plafond 30 testé), 11 raccourcis (+ `job-numero`, `taches`, `equipe`, `devis-attente`, `ou-equipe`, `top-clients`), repli « pas ça » / Réessayer tracé `candidat_retrait` | `tests/lumi-etages12.test.ts` |
| 7 | Evals | fait | `evaluer-lumi.mjs` (`ACTION_ATTENDUE`, précision de routage, part par étage, coût moyen), `evaluer-vente.mjs` (20 cas publics) | batterie 76/80, routage 51/53 puis 4/4 après correction ; vente 19/20 puis assertion élargie |
| 8 | Versionnage | fait | `server/lib/lumi/version.ts` (`VERSION_PROMPT` + empreinte figée, test qui casse sans bump), `promptVente.ts` | `tests/lumi-items8-14.test.ts` |
| 9 | Descriptions d'outils | fait | `tools.ts` | 2 728 → 2 467 tokens, batterie 5 % |
| 10 | Routeur | fait en **observation** (`LUMI_ROUTEUR=observation`) | `routeur.ts` (Haiku, sortie JSON stricte par outil forcé, Zod, seuil 0,85, jamais d'action devinée) | 60 tours observés pendant la batterie : 0 verdict invalide, 9 fois il aurait agi — 8 justes, 1 faux (« est-ce que je fais de l'argent sur mes jobs ce mois-ci » → `revenu-mois` alors que Sonnet a pris `get_job_profitability`). Seuil et énoncés à calibrer sur 30 jours de `lumi_traces.params.routeur` avant tout mode actif |
| 11 | Topics | données prêtes, **non restrictives** | `topics.ts` (7 topics + hors_scope + multi, chaque outil couvert) | test de couverture ; la restriction des outils par topic attend le calibrage de 10 |
| 12 | Escalade humaine | fait | `escalade.ts` (notifications `lumi_escalade` aux propriétaires + la personne, une par conversation et motif) ; hooks : refus du modèle, trop d'étapes, effet partiel, plafond | test unitaire + statique ; **non vérifié en direct** (aucun de ces cas ne s'est produit dans la batterie) |
| 13 | Cache de réponse | fait (PR #372 + correctif #373) | `server/lib/lumi/magasin.ts` (Upstash Redis, repli mémoire), `cache-reponses.ts`, `version-org.ts` (invalidation à chaque écriture d'agent) | clé org + personne + version, TTL 60 s, premier message seulement, lecture seule ; batterie catégorie « cache » : étage 3 vérifié en direct à 0 ¢ |
| 14 | Grounding | fait | `tools-aide.ts` (`search_help` sur `fonctionsData.ts`, page citée) | test ; découvert par la recherche d'outils (`help`) |
| 15 | Cache sémantique | fait (PR #372 + correctif #373) | `cache-semantique.ts` (embeddings Gemini `gemini-embedding-001`, 256 dims, cosinus ≥ 0,92 ; mesuré : paraphrase 0,993, autre question 0,848) | index par (org, personne), TTL 10 min, jamais partagé entre entreprises (test d'isolation `tests/lumi-caches.test.ts`) ; index partagé pour le widget public seulement ; étage 4 vérifié en direct (Lumi et widget) ; coût de l'embedding non tarifé → trace NULL |

Mesures après implémentation (batterie de 80 cas, staging, `LUMI_ROUTEUR=observation`) :

| | avant la mission (2026-09-11) | après |
|---|---|---|
| taux d'erreur | 5 % | 5 % (76/80 ; les 4 échecs corrigés et rejoués : 4/4 + exécution 4/4) |
| coût du run | 0,58 $ | **0,51 $** |
| cas répondus sans modèle | 8 / 80 | **17 / 80** (étages 1-2), + les 4 suggestions et les reçus (étage 0) hors batterie |
| précision de routage | non mesurée | 96 % → 100 % après ajustement de 2 attentes |
| prompt fixe | 3 836 tokens | 3 871 (ligne `help` ajoutée) ; outils 2 728 → 2 467 |

Pièges rencontrés, à connaître :
- `check:schema-refs` ne voit pas un `.is('colonne', null)` sur une colonne absente (`automation_rules.deleted_at`) : trouvé en direct, corrigé.
- L'empreinte d'idempotence (24 h) de `remember_this` survit à la suppression du souvenir : « retiens que… » répond `deja_fait` sans réécrire. La batterie purge `agent_actions` au départ ; en prod, effacer un souvenir puis le redonner dans les 24 h ne le recrée pas — à traiter (ne pas dédoublonner les écritures anodines).
- Un heredoc Bash mange `\b` (octet 0x08 dans le fichier) : patcher les fichiers avec un script écrit par l'outil Write.

Prochaines actions pour Rafba :
1. Relire la branche et décider du push / de la PR (R18 : je ne pousse pas).
2. Laisser `LUMI_ROUTEUR=observation` sur Railway 30 jours, puis lire `lumi_traces.params.routeur` avant d'envisager un mode actif.
3. Revoir les 23 énoncés exacts avec `select enonce_normalise, count(*) from lumi_traces where etage = 6 group by 1 order by 2 desc` après 30 jours.
