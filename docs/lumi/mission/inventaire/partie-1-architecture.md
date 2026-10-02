# Partie 1 — Architecture et boucle d'agent de Lumi

Lecture seule du dépôt `C:\Users\Rafba\lume-lumi-mission` (HEAD `39f6ffc2`, 2026-10-01). Aucun serveur, test ou script lancé. Les chemins sont relatifs à la racine du dépôt. Les valeurs des variables d'environnement de production n'ont pas été lues : seuls les noms et les défauts du code sont donnés.

Convention : « à confirmer par test » = déduit du code et de la documentation de l'API, non exécuté.

---

## 1. Points d'entrée

### 1.1 Vue d'ensemble

| Canal | Entrée | Moteur | Fichier |
|---|---|---|---|
| App web, texte | `POST /api/lumi/chat` (SSE) | Étages 0 à 6, puis `tourLumi` | `server/routes/lumi.ts:522` |
| App web, bouton ou suggestion | `POST /api/lumi/action` (SSE) | Raccourci nommé, 0 modèle | `server/routes/lumi.ts:856` |
| App web, carte Confirmer / Annuler | `POST /api/lumi/execute` (SSE, ou JSON en `dry_run`) | Exécution d'écriture, 0 modèle | `server/routes/lumi.ts:923` |
| App web, dictée | `POST /api/agent/transcribe` puis `/api/lumi/chat` | Gemini (transcription) | `server/routes/agent.ts:27` |
| Texto (SMS) d'un membre de l'équipe | Webhook Twilio entrant → `repondreAuMembre` | `tourLumi` directement, sans étages 0 à 5 | `server/routes/messages.ts:545-565`, `server/lib/sms/fil-lumi.ts:156`, `server/lib/sms/lumi-sms.ts:147` |
| Note vocale par MMS | Même webhook, transcription avant | Gemini puis `tourLumi` | `server/routes/messages.ts:357-378`, `server/lib/sms/note-vocale.ts:90` |
| Client MCP externe (Claude, Cursor…) | `POST /api/mcp` (JSON-RPC) | Aucun modèle côté Lume : exécution d'outils seulement | `server/routes/mcp.ts:291` |
| Chat d'aide (support) | `POST /api/support/chat` | `repondreSupportIA` (boucle séparée, 4 étapes) | `server/routes/support.ts:66`, `server/lib/support/ia.ts:192` |
| Chat public du site | `POST /api/public/sales-chat` | `repondreSupportIA`, surface `public` | `server/routes/sales-chat.ts:46` |
| Générateur d'automatisations | `POST /api/automations/rules/generer` | Appel Sonnet simple | `server/routes/automation-rules.ts:310`, `server/lib/lumi/generer-parcours.ts:543` |
| Briefing du matin (cron horaire) | `genererBriefingsDuMatin` | Gabarit, 0 modèle | `server/lib/lumi/briefing.ts:220`, `server/index.ts:1561-1573` |
| Ancien agent Gemini | `POST /api/agent/chat` | Fermé : répond 410 | `server/routes/agent.ts:92-94` |

Application mobile native : non trouvée dans ce dépôt. Sur téléphone, un utilisateur connecté est renvoyé vers la page « télécharger l'application » (`src/lib/mobileGate.ts:1-16`). L'entrée « téléphone » présente dans le code est le canal SMS ci-dessus.

### 1.2 Routes HTTP de `server/routes/lumi.ts`

| Méthode et chemin | Rôle | Ligne |
|---|---|---|
| `POST /lumi/chat` | Un message, réponse en SSE | 522 |
| `POST /lumi/action` | Action d'interface (étage 0) | 856 |
| `POST /lumi/execute` | Confirmer, annuler ou simuler (`dry_run`) une écriture | 923 |
| `GET`, `PUT /lumi/mode` | Mode de confirmation de la personne | 1029, 1040 |
| `GET`, `PUT /lumi/autorisations` | Outils « toujours confirmer » | 1062, 1074 |
| `GET /lumi/quota` | Crédits ; modèle et plafonds pour les comptes `@lume-test.ca` | 1094-1109 |
| `GET /lumi/credits` | État des crédits | 1116 |
| `GET /lumi/credits/historique` | Consommation par jour et par utilisateur | 1132 |
| `GET /lumi/conversations` | 50 dernières conversations | 1185-1192 |
| `GET /lumi/conversations/:id` | Messages rendus pour l'interface | 1261 |
| `DELETE /lumi/conversations/:id` | Suppression définitive | 1285-1291 |

L'en-tête du fichier ne liste que six routes (`server/routes/lumi.ts:4-9`). Il est périmé.

### 1.3 Montage et gardes dans `server/index.ts`

| Garde | Détail | Renvoi |
|---|---|---|
| Montage | `app.use('/api', lumiRouter)` | `server/index.ts:887` |
| Corps JSON | 512 ko au maximum (6 Mo pour la transcription) | `server/index.ts:390-391` |
| Débit, sans Redis | 30 requêtes par minute et par personne sur `/api/lumi` | `server/index.ts:677`, `server/index.ts:694` |
| Débit, avec Redis | Préréglage `standard`, 30 par minute | `server/index.ts:735`, `server/lib/rate-limiter.ts:41` |
| Débit propre à `/lumi/chat` | 60 tours par heure et par personne, seulement si Redis est configuré | `server/routes/lumi.ts:517-522`, `server/lib/rate-limiter.ts:45`, `server/lib/rate-limiter.ts:95-98` |
| Permission de rôle | `external_agent.use` sur six routes seulement | `server/lib/route-permissions.ts:83-88`, `server/index.ts:816` |
| Abonnement | `subscriptionGuard()` | `server/index.ts:820` |
| Forme et taille | `maxBodySize`, `guardCommonShape` | `server/routes/lumi.ts:66-67` |
| Schémas Zod | Message de 1 à 8 000 caractères ; `origine` facultative | `server/routes/lumi.ts:70-95` |

`contexteTour` s'exécute au début de `/chat`, `/action` et `/execute` (`server/routes/lumi.ts:265-333`). Il refuse avec 503 `lumi_not_configured` sans `ANTHROPIC_API_KEY` (266-269). Il refuse avec 403 `plan_sans_lumi` si le forfait n'inclut pas Lumi (273-277). Il lit le nom et le fuseau de l'entreprise (288-294), les 30 souvenirs les plus récents si la personne a `settings.update` (309-315), les restrictions du rôle (319-323), puis bâtit le prompt (325-326).

### 1.4 Flux SSE

Le flux est ouvert par `ouvrirSse` (`server/routes/lumi.ts:151-161`). Chaque événement a la forme `event: <type>` puis `data: <JSON>`.

| Événement | Contenu | Émis par |
|---|---|---|
| `text` | `{ delta }` | `server/lib/lumi/orchestrateur.ts:429` |
| `tool` | `{ name, statut: debut | fin | refus }` (outils de lecture seulement) | `orchestrateur.ts:502-509`, `orchestrateur.ts:525` |
| `proposal` | Carte d'écriture : `tool_use_id`, `tool`, `args`, `capacite`, `apercu`, `auto`, `groupe` | `orchestrateur.ts:486`, `orchestrateur.ts:542` |
| `executed` | Reçu : `tool_use_id`, `ok`, `fiche`, `auto` | `orchestrateur.ts:488`, `server/routes/lumi.ts:1012` |
| `fiches` | Liens vers les fiches touchées | `orchestrateur.ts:514` |
| `report` | Rapport `build_report` | `orchestrateur.ts:511` |
| `usage` | Modèle et tokens de chaque appel (jamais de montant) | `orchestrateur.ts:444` |
| `error` | `refusal`, `plafond_tour`, `trop_d_etapes`, ou `Lumi failed to respond.` | `orchestrateur.ts:402`, `451`, `551` ; `server/routes/lumi.ts:505` |
| `done` | `conversation_id`, `credits`, `proposal`, `etage`, parfois `raccourci` ou `recu` | `server/routes/lumi.ts:478` et dix autres sorties (256, 595, 627, 663, 666, 709, 731, 776, 802, 910, 1015) |

Aucun battement de cœur (ping) n'est émis pendant un long appel : non trouvé. La fermeture du navigateur est détectée (`server/routes/lumi.ts:372-373`), mais l'appel au modèle n'est pas interrompu : aucun signal d'annulation n'est passé à `messages.stream` (`orchestrateur.ts:413-428`).

### 1.5 Client web

| Élément | Fait | Renvoi |
|---|---|---|
| Route | `/lumi`, sous permission `external_agent.use` et drapeau `includes_ai` | `src/App.tsx:1564` |
| Transport | `fetch` POST, lecture manuelle du flux, découpage sur `\n\n` | `src/lib/lumiApi.ts:171-201` |
| En-têtes | `Authorization`, `x-org-id`, jeton d'appareil | `src/lib/lumiApi.ts:18-28` |
| Historique | Jamais renvoyé par l'interface ; le serveur le rejoue | `src/lib/lumiApi.ts:4-7` |
| Envoi | `envoyerMessageLumi`, `executerActionLumi` (422 → `indisponible`), `deciderPropositionLumi` | `src/lib/lumiApi.ts:206-253` |
| Rendu des événements | `appliquerEvenement` | `src/pages/Lumi.tsx:353-452` |
| Annulation | `AbortController` côté navigateur seulement | `src/pages/Lumi.tsx:337`, `src/pages/Lumi.tsx:457` |
| Dictée | 60 s au maximum ; le texte transcrit remplit la boîte, l'utilisateur relit puis envoie | `src/features/agent/hooks/useVoiceInput.ts:22`, `src/pages/Lumi.tsx:538-548` |
| Lecture à voix haute | Si la question a été dictée | `src/pages/Lumi.tsx:438-445` |

### 1.6 Canal SMS (texte et vocal)

- L'identité est le numéro de l'expéditeur, comparé au téléphone d'un membre actif de l'entreprise propriétaire du numéro appelé (`server/lib/sms/identifier-membre.ts:41-94`). Deux membres avec le même numéro : refus.
- Le tour appelle `tourLumi` directement (`server/lib/sms/lumi-sms.ts:199-224`). Les étages 0 à 5 ne sont pas utilisés.
- L'historique est constitué des 12 derniers messages du fil, en texte seul, sans résultats d'outils (`server/lib/sms/fil-lumi.ts:28`, `fil-lumi.ts:93-111`), puis tronqué à 12 messages (`lumi-sms.ts:35`, `lumi-sms.ts:205`).
- La réponse est coupée à 900 caractères, 400 s'il y a une proposition (`lumi-sms.ts:32`, `lumi-sms.ts:228`).
- Une écriture proposée attend un « oui » : la proposition est stockée dans le texte du message sortant, derrière un marqueur invisible (`fil-lumi.ts:35-49`, `fil-lumi.ts:224`). Elle expire après 15 minutes et doit venir du même membre (`server/lib/sms/confirmation.ts:18-37`). Elle est consommée par une mise à jour conditionnelle (`fil-lumi.ts:138-149`).
- Note vocale : téléchargement chez Twilio puis `transcribeAudio` (`server/lib/sms/note-vocale.ts:90-131`).

### 1.7 Serveur MCP et ce qu'il partage avec Lumi

| Élément | Fait | Renvoi |
|---|---|---|
| Montage | `/api/mcp`, 120 requêtes par minute et par jeton, avant la porte MFA | `server/index.ts:795-805` |
| Transport | JSON-RPC 2.0 sur POST, sans flux : `initialize`, `ping`, `tools/list`, `tools/call` | `server/routes/mcp.ts:291-475` |
| Authentification | Jeton OAuth (`mcp:read`, `mcp:write`) ou clé `X-API-Key` avec le scope `mcp` | `server/routes/mcp.ts:171-244` |
| Écritures | Seulement en OAuth avec `mcp:write` ; exécutées tout de suite, sans carte | `server/routes/mcp.ts:76-84`, `server/routes/mcp.ts:421` |
| Outils | `AGENT_TOOLS` moins ceux marqués `canal: 'lumi'` | `server/routes/mcp.ts:67` |

Partagé avec Lumi : le registre d'outils (`server/lib/agent/tools.ts`), la matrice `PERMISSION_PAR_OUTIL`, `OUTILS_FINANCIERS`, `masquerMontants`, `membreVoitLesMontants` (`server/lib/agent/garde.ts:34`, `133`, `216`, `161`), le masquage des identifiants (`server/lib/agent/refs.ts`), les consignes de présentation (`server/lib/agent/consignesCollegue.ts`, importées par `server/routes/mcp.ts:41` et `server/lib/lumi/orchestrateur.ts:36`), et l'idempotence `executerIdempotent` puisque les mêmes handlers tournent.

Non partagé : le MCP n'appelle pas `executerOutilGarde`. Il refait les contrôles de permission et de montants lui-même, puis appelle le handler directement (`server/routes/mcp.ts:344-377`, `421`). Voir la section 8.

---

## 2. La boucle d'agent

### 2.1 Ordre exact des étages pour `POST /api/lumi/chat`

Les numéros d'étage écrits dans les traces viennent de `ETAGE` (`server/lib/lumi/traces.ts:33-35`) : 0 interface, 1 énoncé exact, 2 raccourci, 3 cache exact, 4 cache sémantique, 5 routeur, 6 agent.

| Ordre | Étage tracé | Ce qui se passe | Condition d'entrée | Ce qui fait passer au suivant | Coût | Renvoi |
|---|---|---|---|---|---|---|
| 0 | — | Limites de débit, permission, validation, `contexteTour` | Toujours | Tout refus arrête la requête (401, 403, 429, 503) | Base seulement | `server/routes/lumi.ts:522-526` |
| 1 | — | Chargement ou création de la conversation ; fenêtre d'historique selon le palier | Toujours | — | Base | `server/routes/lumi.ts:528-541` |
| 2 | — | Toute proposition restée sans réponse est annulée par un `tool_result` « cancelled » | Une proposition en attente | — | 0 | `server/routes/lumi.ts:546-549` |
| 3 | — | Détection d'un repli (« non », « pas ça », ou `origine: 'repli'`) | Toujours | Un repli désactive les étages sans modèle | 0 | `server/routes/lumi.ts:116-119`, `559-560` |
| 4 | 1 ou 2 | Aide écrite : FAQ, article direct, aide multiple | Premier message, pas de repli, pas de proposition annulée, pas une demande d'action | Aucun texte d'aide trouvé | 0 | `server/routes/lumi.ts:581-610` |
| 5 | 1 ou 2 | Raccourci de lecture : 23 énoncés exacts, motif « job N », 10 définitions par mots | Pas de repli, pas de proposition annulée, pas une demande d'action ; valable à tout moment de la conversation | Rien reconnu, ou l'outil rend une erreur | 0 | `server/routes/lumi.ts:615-636`, `server/lib/lumi/raccourcis.ts:66-92`, `194-229` |
| 6 | 2 | « Optimiser la journée » | Pas de repli, pas de proposition annulée | Rien reconnu | 0 | `server/routes/lumi.ts:643-649` |
| 7 | 2 | Action directe : fiches par numéro, listes de réglages, pointage, pause, mémoire, cartes préparées par le code, réponses fixes (« merci », « salut ») | Pas de repli, pas de proposition annulée | `null` au moindre doute | 0 | `server/routes/lumi.ts:650-675`, `server/lib/lumi/actions-directes.ts:363`, `677-748` |
| 8 | — | Sur repli : l'entrée précédente est retirée des deux caches | Repli avec énoncé précédent | — | 0 | `server/routes/lumi.ts:678-682` |
| 9 | 3 | Cache exact de réponse (clé sha256 : org, personne, version des données, énoncé normalisé ; durée 60 s) | Premier message, énoncé cachable | Absent du cache | 0 | `server/routes/lumi.ts:685-692`, `server/lib/lumi/cache-reponses.ts:29`, `39-43` |
| 10 | 4 | Cache sémantique : plongement Gemini, cosinus ≥ 0,92, garde lexical ≥ 75 %, index par (org, personne) 10 min, puis index global « aide » 24 h | Comme l'étage 3, et clé Gemini présente | Rien au-dessus du seuil | Un plongement Gemini, non journalisé | `server/routes/lumi.ts:693-717`, `server/lib/lumi/cache-semantique.ts:33-37`, `102-124` |
| 11 | 0 (résultat `refus`) | Plafond de coût de la conversation : gabarit « ouvre une nouvelle conversation » | Historique ≥ 10 messages et dépense `ai_usage` de la conversation ≥ 40 ¢ | Sous le plafond | 0 | `server/routes/lumi.ts:722-739`, `server/lib/lumi/regles-cout.ts:50` |
| 12 | 5 | Routeur Haiku : classe le message dans un sujet | `LUMI_ROUTEUR=actif`, pas de repli, pas de proposition annulée ; s'applique à tous les messages, pas seulement au premier | Toujours suivi, sauf hors-sujet servi | Un appel Haiku | `server/routes/lumi.ts:750-764`, `server/lib/lumi/routeur.ts:267-300` |
| 12a | 5 | Hors-sujet : gabarit de refus | Verdict `hors_scope`, confiance ≥ 0,85, premier message, aucun mot du métier ni de Lume, aucun nom propre | Une condition manque | Coût du routeur | `server/routes/lumi.ts:770-786`, `server/lib/lumi/hors-scope.ts:100-115` |
| 12b | 5 | Raccourci choisi par le routeur | `decision === 'action'` | Branche inerte : le prompt du routeur impose `action = null` | — | `server/routes/lumi.ts:791-820`, `server/lib/lumi/routeur.ts:151` |
| 12c | 5 | Carte bâtie par extraction | `verdict.extraction` présent | Branche inerte : le champ n'est plus dans le schéma de l'outil `classer` | — | `server/routes/lumi.ts:826-844`, `server/lib/lumi/routeur.ts:73-85`, `277-287` |
| 13 | 6 | Sous-agent : si le sujet est sûr (≥ 0,85) et la décision est `modele`, les outils de ce sujet sont chargés à la place du jeu de base | Verdict du routeur valide | Sinon jeu de base | — | `server/routes/lumi.ts:847`, `server/lib/lumi/sous-agents.ts:53-58` |
| 14 | 6 | `executerTourSse` : plafond journalier, réglages du palier, puis `tourLumi` | Tout ce qui précède n'a pas répondu | Fin de la requête | Appels au modèle principal | `server/routes/lumi.ts:848`, `335-510` |

Une « demande d'action » est reconnue par `estDemandeDAction` : un verbe d'ordre en tête d'une proposition, sauf si la phrase commence par un mot de question (`server/lib/lumi/demande-action.ts:18-47`).

`/api/lumi/action` saute tout cela : l'action nommée est traduite en raccourci et exécutée (`server/routes/lumi.ts:856-915`). En cas d'échec, la route répond 422 et le client renvoie le texte à `/chat`, sauf pour un bouton de l'application (`src/pages/Lumi.tsx:514-524`).

### 2.2 Ce qui est mémorisé après un tour d'agent

Un tour d'étage 6 est mis en cache (exact et sémantique) seulement si : premier message, pas de proposition, pas d'écriture exécutée, texte non vide, outils de lecture seulement, énoncé cachable, aucune erreur du modèle (`server/routes/lumi.ts:490-502`, `server/lib/lumi/cache-reponses.ts:65-73`). Une réponse issue du seul `search_help`, sans nom d'entreprise ni de personne, va aussi dans l'index global « aide » (`server/routes/lumi.ts:496-500`). Toute écriture d'agent incrémente la version de l'org, ce qui périme les deux caches (`server/lib/agent/tools-etendus.ts:327`, `server/lib/lumi/version-org.ts:15-17`). Le magasin est Upstash Redis s'il est configuré, sinon une Map en mémoire par processus (`server/lib/lumi/magasin.ts:75-84`).

### 2.3 À l'intérieur de `tourLumi` (étage 6)

Fichier : `server/lib/lumi/orchestrateur.ts:336-553`.

1. Modèle et effort viennent des réglages du palier, sinon de `modeleLumi()` et `reglesCout().effort_defaut` (367-368).
2. Les outils sont filtrés par les permissions de la personne, puis répartis en « chargés » et « différés » (369, 192-211).
3. Si `max_etapes` vaut 0, le tour rend `plafond: true` sans appel (380-381).
4. À chaque étape :
   - si le coût du tour (hors écritures de cache 1 h) atteint le plafond par tour, l'étape part en effort bas avec `tool_choice: none` ; au double du plafond, événement `error: plafond_tour` et fin (399-404, 423-427) ;
   - le coût maximal de l'appel est réservé en base ; `capped` arrête le tour (407-412) ;
   - appel `messages.stream`, texte relayé au fil de l'eau, puis `finalMessage()` (413-430) ;
   - le coût est journalisé dans `ai_usage`, la réservation est réglée, l'événement `usage` part (433-444) ;
   - le message de l'assistant est ajouté à l'historique, blocs de réflexion compris (446-448) ;
   - le `stop_reason` est traité (voir section 4) ;
   - chaque `tool_use` est exécuté ou transformé en proposition (469-528).
5. S'il y a des écritures à confirmer, le tour s'arrête avec une proposition (530-545). Sinon les résultats repartent au modèle (547-548).
6. Après la dernière étape permise, événement `error: trop_d_etapes` (551-552).

**Nombre maximal d'itérations.** `MAX_ETAPES = 8` appels au modèle par tour (`orchestrateur.ts:51`, `380`, `389`). Le palier « restreint » le ramène à 2, le palier « épuisé » à 0 (`server/lib/lumi/budget.ts:79-80`). Un `pause_turn` et une étape où seule la recherche d'outils a tourné consomment chacun une étape (`orchestrateur.ts:456`, `464`). Si le huitième appel demande encore des outils, ils sont exécutés, mais le modèle n'est pas rappelé pour conclure.

**Outils chargés.** Sans sous-agent : la recherche d'outils plus 15 outils de base (`orchestrateur.ts:169-180`). Avec sous-agent : tous les outils du sujet plus 6 outils transverses (`server/lib/lumi/sous-agents.ts:22`, `45-50`). Les autres portent `defer_loading: true` et sont découverts par `tool_search_tool_regex` (`orchestrateur.ts:182-185`, `207`). Le code ajoute au bloc variable du prompt des indices d'outils calculés à partir des mots du message (`server/routes/lumi.ts:433-439`, `server/lib/lumi/indices-outils.ts:98-115`).

**Résultats d'outils.** Les identifiants sont masqués (`orchestrateur.ts:516`). Le résultat est compacté : valeurs nulles retirées, listes d'au moins 5 objets mises en table, coupe à 60 000 caractères (`server/lib/lumi/compress.ts:19-20`, `41-49`, `70-73`). Les descriptions de paramètres redondantes sont retirées des schémas (`server/lib/lumi/alleger-outils.ts:22-48`).

**Défense contre l'injection.** Dès qu'une des 11 lectures « à contenu externe » a tourné dans la conversation, plus aucune écriture ne part d'office (`orchestrateur.ts:125-135`, `387`, `478`, `515`).

### 2.4 Rôle de chaque fichier demandé

| Fichier | Rôle | Renvoi |
|---|---|---|
| `orchestrateur.ts` | Boucle, prompt système, définitions d'outils, points de cache, purge des vieux résultats | `server/lib/lumi/orchestrateur.ts:94`, `140`, `192`, `225`, `336` |
| `llm.ts` | Seul module qui instancie le SDK ; reprises et délai | `server/lib/lumi/llm.ts:23-36` |
| `routeur.ts` | Un appel Haiku, sortie forcée par l'outil `classer`, validation Zod | `server/lib/lumi/routeur.ts:107-142`, `267-300` |
| `topics.ts` | 11 sujets, leurs outils, ce qu'ils refusent | `server/lib/lumi/topics.ts:16`, `35-114` |
| `sous-agents.ts` | Jeu d'outils par sujet, consigne de sujet, effort (`medium` pour `rapports` seulement) | `server/lib/lumi/sous-agents.ts:45-58`, `99-116` |
| `raccourcis.ts` | Étages 1 et 2 : détection stricte (12 mots au plus) et gabarits | `server/lib/lumi/raccourcis.ts:57`, `194-229`, `312-446`, `452-498` |
| `actions-directes.ts` | Étage 2 bis : lectures, écritures directes, cartes, réponses fixes | `server/lib/lumi/actions-directes.ts:35-60`, `95-114`, `677-748` |
| `execution.ts` | Exécution d'une écriture, modes, autorisations, plafond de 20 écritures | `server/lib/lumi/execution.ts:25-68`, `72-73`, `91`, `154-176` |
| `hors-scope.ts` | Conditions et texte du refus hors-sujet | `server/lib/lumi/hors-scope.ts:80-115` |
| `cache-reponses.ts` | Étage 3 | `server/lib/lumi/cache-reponses.ts:29-88` |
| `cache-semantique.ts` | Étage 4, plongement Gemini | `server/lib/lumi/cache-semantique.ts:66-153` |
| `cache-chaud.ts` | Préchauffage au démarrage et pings d'entretien du cache de prompt | `server/lib/lumi/cache-chaud.ts:117-141`, `200-255` |
| `compress.ts` | Compaction des résultats d'outils | `server/lib/lumi/compress.ts:52-73` |
| `alleger-outils.ts` | Allègement des schémas d'outils | `server/lib/lumi/alleger-outils.ts:33-48` |
| `regles-cout.ts` | Six plafonds réglables par variable d'environnement | `server/lib/lumi/regles-cout.ts:46-55` |
| `plafond-journalier.ts` | Plafond en dollars par jour et par source, en mémoire, par processus | `server/lib/lumi/plafond-journalier.ts:72`, `83-93`, `128-162` |

---

## 3. Modèles et paramètres

### 3.1 Modèle par étage et par palier

| Usage | Modèle (id exact) | `max_tokens` | Réflexion et effort | Flux | Cache de prompt | Renvoi |
|---|---|---|---|---|---|---|
| Agent, palier normal | `LUMI_MODEL` s'il figure dans `TARIFS`, sinon `claude-sonnet-5` | 2 048, réflexion incluse | `thinking: adaptive`, `effort: low` par défaut ; `medium` pour le sous-agent `rapports` | Oui | Voir 3.3 | `server/lib/lumi/tarifs.ts:51`, `101-104` ; `orchestrateur.ts:52-58` ; `sous-agents.ts:99-102` ; `server/routes/lumi.ts:417-419` |
| Agent, palier économe (≥ 70 % du budget) | `claude-haiku-4-5` | 2 048 | Aucune (paramètres omis pour Haiku) | Oui | Idem | `server/lib/lumi/budget.ts:52`, `78` ; `orchestrateur.ts:55-58` |
| Agent, palier restreint (≥ 90 %, ou ≥ 15 % du budget brûlé dans la journée) | `claude-haiku-4-5`, 2 étapes | 2 048 | Aucune | Oui | Idem | `budget.ts:53`, `79`, `198-210` |
| Agent, palier épuisé (≥ 100 %) | Aucun appel | — | — | — | — | `budget.ts:80` ; `server/routes/lumi.ts:427` |
| Agent, étape de conclusion après le plafond par tour | Même modèle | 2 048 | Effort `low`, `tool_choice: none` | Oui | Idem | `orchestrateur.ts:399-427` |
| Routeur | `claude-haiku-4-5` | 400 | Aucune ; `tool_choice` forcé sur `classer` | Non | Bloc système, `ttl: '1h'` | `server/lib/lumi/routeur.ts:56`, `270-291` |
| Ping de cache | Modèle du dernier appel réel | 0 | Aucune | Non | Relit le préfixe du dernier appel | `server/lib/lumi/cache-chaud.ts:117-137` |
| Support et chat public | `LUMI_SUPPORT_MODELE`, sinon `claude-sonnet-5` | 1 024 | `adaptive` + `low` ; 4 étapes au plus | Non | Bloc stable, `ttl: '1h'` | `server/lib/support/ia.ts:41-43`, `208`, `228-236` |
| Générateur d'automatisations | `claude-sonnet-5` | 4 000 | Non précisé (défaut du modèle) | Non | Bloc système, 5 min | `server/lib/lumi/generer-parcours.ts:42`, `55`, `543-548` |
| Bot de migration (hors Lumi) | `LUMI_MODEL_MIGRATION`, sinon `claude-sonnet-5`, puis `claude-opus-5`, `claude-fable-5-1` | non relevé | non relevé | Non | `ttl: '1h'` | `server/lib/migration/bot.ts:96`, `411-427` |
| Plongement (étage 4) | `gemini-embedding-001`, 256 dimensions | — | — | — | — | `server/lib/lumi/cache-semantique.ts:34`, `38`, `69-73` |
| Transcription | `GEMINI_TRANSCRIBE_MODEL`, sinon `gemini-2.5-pro` | 2 048 | `thinkingBudget` 512, température 0 | Non | — | `server/lib/agent/transcribe.ts:19`, `63-69` |

- Température, `top_p`, `top_k` : jamais fixés sur les appels Anthropic de Lumi (recherche sans résultat dans `server/lib/lumi`, `server/lib/support`, `server/lib/sms`, `server/routes/lumi.ts`).
- En-têtes bêta : aucun pour Lumi. Le seul du serveur est `server-side-fallback-2026-07-01`, dans le bot de migration (`server/lib/migration/bot.ts:421`).
- Affichage de la réflexion : `display` n'est pas précisé (`orchestrateur.ts:57`). Le texte de réflexion n'est donc pas transmis à l'interface.
- SDK : `@anthropic-ai/sdk` 0.124.0 (`package.json:101`).
- La valeur de `LUMI_MODEL` en production : non trouvée (fichiers d'environnement non lus). `CLAUDE.md` et `server/lib/agent/garde.ts:7` parlent d'Opus 5 ; le défaut du code est Sonnet 5.

### 3.2 Tarifs codés

| Modèle | Entrée | Sortie | Lecture cache | Écriture cache 1 h | Renvoi |
|---|---|---|---|---|---|
| `claude-fable-5-1` | 10 | 50 | 1 | 20 | `server/lib/lumi/tarifs.ts:19` |
| `claude-opus-5` | 5 | 25 | 0,5 | 10 | `tarifs.ts:20` |
| `claude-sonnet-5` | 2 | 10 | 0,2 | 4 | `tarifs.ts:21` |
| `claude-haiku-4-5` | 1 | 5 | 0,1 | 2 | `tarifs.ts:22` |

En dollars US par million de tokens. Une écriture 5 min est comptée à 1,25 fois le tarif d'entrée (`tarifs.ts:97`). Un modèle inconnu est compté au tarif d'Opus 5 (`tarifs.ts:83-88`). Sans le détail `cache_creation`, toute écriture est comptée au tarif 1 h (`tarifs.ts:89-91`). 1 crédit client = 3 ¢ US (`server/lib/lumi/credits.ts:20`).

### 3.3 Points de cache de l'agent

| Point | Emplacement | Durée dans le code | Renvoi |
|---|---|---|---|
| 1 | Dernier outil chargé (non différé) | 5 min (`CACHE_5M`) | `orchestrateur.ts:80`, `208-209` |
| 2 | Bloc système stable (identique pour toutes les entreprises et les deux langues) | 5 min | `orchestrateur.ts:298` |
| 3 | Dernier bloc du dernier message (point glissant) | 5 min | `orchestrateur.ts:94-106`, `418` |

- Le bloc système variable (langue, entreprise, date et heure à la minute, nom, souvenirs, restrictions, sujet, indices d'outils) ne porte pas de point de cache (`orchestrateur.ts:290-300`, `server/lib/lumi/temps.ts:29-37`).
- La constante `CACHE_1H` est déclarée et n'est plus utilisée (`orchestrateur.ts:78`). Le passage de 1 h à 5 min date du 2026-09-30 (commit `208c50c8`, PR #810).
- Minimum pour qu'un préfixe soit mis en cache : 1 024 tokens sur Sonnet 5, 4 096 sur Haiku 4.5 (référence API ; le code le rappelle pour le routeur, `server/lib/lumi/routeur.ts:32-37`).

### 3.4 Variables d'environnement

| Variable | Effet | Défaut | Bornes | Renvoi |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | Active Lumi | — | — | `server/lib/lumi/llm.ts:38-40` |
| `LUMI_MODEL` | Modèle de l'agent | `claude-sonnet-5` | Doit figurer dans `TARIFS` | `tarifs.ts:101-104` |
| `LUMI_EFFORT` | Effort par défaut | `low` | `medium` seul accepté | `regles-cout.ts:52` |
| `LUMI_MAX_TOKENS_SORTIE` | `max_tokens` de l'agent | 2 048 | 256 à 8 192 | `regles-cout.ts:48` |
| `LUMI_PLAFOND_TOUR_CENTS` | Plafond de coût d'un tour | 6 ¢ | 1 à 100 | `regles-cout.ts:49` |
| `LUMI_PLAFOND_CONVERSATION_CENTS` | Plafond de coût d'une conversation | 40 ¢ | 5 à 1 000 | `regles-cout.ts:50` |
| `LUMI_PART_BUDGET_PAR_JOUR` | Part du budget mensuel par jour avant le palier restreint | 0,15 | 0,02 à 1 | `regles-cout.ts:51` |
| `LUMI_PLAFOND_PUBLIC_PAR_JOUR` | Réponses du modèle sur le site par 24 h | 300 | 10 à 100 000 | `regles-cout.ts:53` |
| `LUMI_PLAFOND_JOUR_USD` | Plafond journalier par source, pour toute l'instance | 5 $ | 0 = illimité | `plafond-journalier.ts:72`, `83-93` |
| `LUMI_PLAFOND_JOUR_<SOURCE>_USD` | Idem, par source (`LUMI`, `SUPPORT`, `MIGRATION`, `PUBLIC`, `CACHE_CHAUD`, `EVAL`, `VOIX`) | — | — | `plafond-journalier.ts:42-44`, `84` |
| `LUMI_PLAFOND_JOUR_VOIX_APPELS` | Dictées par jour | 300 | — | `plafond-journalier.ts:60-69` |
| `LUMI_ROUTEUR` | `off`, `observation`, `actif` | `off` | — | `routeur.ts:59-62` |
| `LUMI_LLM_REPRISES` | Reprises du SDK | 3 | 0 à 6 | `llm.ts:23-29` |
| `LUMI_LLM_DELAI_MS` | Délai par appel | 90 000 ms | 10 000 à 600 000 | `llm.ts:28` |
| `LUMI_CACHE_CHAUD_MINUTES` | Fenêtre d'entretien du cache après une activité | 720 | 0 désactive | `cache-chaud.ts:93-97` |
| `LUMI_PRECHAUFFER` | Préchauffage au démarrage | actif | `0` désactive | `cache-chaud.ts:201` |
| `LUMI_TOURS_PAR_HEURE` | `0` lève la limite de 60 tours par heure | limite active | — | `server/routes/lumi.ts:517-520` |
| `LUMI_ALERT_EMAIL` | Destinataire des alertes de budget | `SECURITY_ALERT_EMAIL` | — | `server/routes/lumi.ts:283` |
| `LUMI_SUPPORT_MODELE` | Modèle du support | `claude-sonnet-5` | — | `server/lib/support/ia.ts:41` |
| `GEMINI_API_KEY` | Plongements et transcription | — | — | `server/lib/lumi/cache-semantique.ts:67` |
| `GEMINI_TRANSCRIBE_MODEL` | Modèle de transcription | `gemini-2.5-pro` | — | `server/lib/agent/transcribe.ts:19` |
| `UPSTASH_REDIS_REST_URL`, `_TOKEN` | Magasin des caches et limite horaire | Map en mémoire | — | `server/lib/lumi/magasin.ts:77` |

Constantes non réglables : `MAX_ETAPES = 8` (`orchestrateur.ts:51`), seuils de palier 0,7 et 0,9 (`budget.ts:52-53`), `SEUIL_CONFIANCE = 0,85` (`routeur.ts:55`), `SEUIL_SIMILARITE = 0,92` (`cache-semantique.ts:33`), durées des caches 60 s, 10 min, 24 h (`cache-reponses.ts:29`, `cache-semantique.ts:35-36`), 20 écritures par conversation (`execution.ts:91`), expiration d'une carte 15 min (`server/routes/lumi.ts:146`).

---

## 4. Erreurs et fins de réponse

### 4.1 Traitement des `stop_reason` dans `tourLumi`

| `stop_reason` | Traitement | Renvoi |
|---|---|---|
| `refusal` | Événement `error: refusal`, fin du tour ; le message de l'assistant est conservé ; escalade au propriétaire | `orchestrateur.ts:450-453`, `server/routes/lumi.ts:403-409` |
| `pause_turn` | Relance avec l'historique tel quel ; consomme une étape | `orchestrateur.ts:454-456` |
| `tool_use` | Exécution des lectures, proposition des écritures | `orchestrateur.ts:461-548` |
| `tool_use` sans bloc `tool_use` client (recherche d'outils seule) | Relance, consomme une étape | `orchestrateur.ts:462-464` |
| `end_turn` | Fin normale | `orchestrateur.ts:457-459` |
| `max_tokens` | Aucun traitement propre : traité comme une fin normale | `orchestrateur.ts:457-459` |
| `stop_sequence`, `model_context_window_exceeded` | Aucun traitement propre : fin normale | `orchestrateur.ts:457-459` |

Le support traite `refusal` par un transfert à un humain et ignore `max_tokens` (`server/lib/support/ia.ts:269-270`). Le routeur ne lit pas le `stop_reason` : sans bloc `tool_use` valide, le verdict est `invalide` et le modèle complet répond (`routeur.ts:292-295`).

### 4.2 Reprises et délais

- Reprises : 3, gérées par le SDK, avec attente croissante, sur 408, 409, 429, 5xx (529 compris) et erreurs de connexion (`llm.ts:15-29` ; liste des codes selon la documentation du SDK).
- Délai : 90 s par appel (`llm.ts:28`). Un délai dépassé est lui aussi repris : l'attente totale peut atteindre quatre fois 90 s (référence SDK).
- Aucune reprise propre à l'application : non trouvée. Une coupure au milieu du flux n'est pas reprise ; l'exception remonte.
- Routeur : toute erreur donne `statut: 'erreur'` et le modèle complet répond (`routeur.ts:296-299`).
- Plongement : une erreur fait sauter l'étage 4 (`cache-semantique.ts:74-81`).
- Réservation de budget : une erreur de la RPC autre que « fonction absente » lève une exception et fait échouer le tour (`budget.ts:136-142`).

### 4.3 Ce que voit l'utilisateur

| Situation | Ce que le serveur envoie | Ce qui s'affiche | Renvoi |
|---|---|---|---|
| Clé absente | 503 `lumi_not_configured` | « Lumi n'est pas encore activé sur ce serveur. » | `server/routes/lumi.ts:266-269`, `src/pages/Lumi.tsx:817-818` |
| Forfait sans Lumi | 403 `plan_sans_lumi` | « Lumi est inclus dans le forfait Autopilot. » | `server/routes/lumi.ts:274-277`, `src/pages/Lumi.tsx:815-816` |
| Limite de débit | 429 | « Lumi souffle deux minutes… » | `src/pages/Lumi.tsx:811-812` |
| Refus du modèle | SSE `error: refusal` | « Je ne peux pas répondre à cette demande. », seulement si aucun texte n'a été reçu | `src/pages/Lumi.tsx:425-431` |
| Trop d'étapes, plafond par tour, exception | SSE `error` | « Désolé, je n'ai pas réussi à répondre. Réessayez. », seulement si aucun texte n'a été reçu | `src/pages/Lumi.tsx:425-431` |
| Budget épuisé ou plafond journalier de l'instance | Texte gabarit « Tes crédits Lumi sont épuisés jusqu'au … » | Message normal de l'assistant | `server/routes/lumi.ts:424-427`, `466-473` ; `budget.ts:106-113` |
| Plafond de conversation | Texte gabarit « ouvre une nouvelle conversation » | Message normal | `server/routes/lumi.ts:722-739` |
| Carte expirée | 409 `proposition_expiree` | Le message du serveur | `server/routes/lumi.ts:941-950` |
| 20 écritures atteintes | 409 `plafond_ecritures` | Le message du serveur | `server/routes/lumi.ts:953-963` |
| Erreur avant l'ouverture du flux | Réponse d'erreur générique | `erreur.message` | `server/routes/lumi.ts:849-852` |

Les codes `ralenti` et `quota_epuise` sont gérés par l'interface (`src/pages/Lumi.tsx:809-814`) mais ne sont émis nulle part côté serveur (recherche sans résultat dans `server/`).

### 4.4 Quand un outil échoue

| Cas | Ce que reçoit le modèle | Ce que voit l'utilisateur | Renvoi |
|---|---|---|---|
| Outil inconnu | `tool_result` en erreur « Unknown tool » | Rien | `orchestrateur.ts:473-476` |
| Refus de permission ou de montants | `tool_result` en erreur, avec la phrase à relayer | Pastille d'outil `refus` | `orchestrateur.ts:505-507`, `server/lib/agent/garde.ts:336-351` |
| Arguments invalides | Résultat `{ error: 'Paramètres invalides…' }` (pas marqué `is_error`) | Pastille `fin` | `garde.ts:361-362` |
| Exception du handler de lecture | `tool_result` en erreur « Tool execution failed. » ; détail dans les journaux serveur | Pastille `refus` | `orchestrateur.ts:522-527` |
| Écriture d'office en échec | `tool_result` en erreur ; reçu `ok: false` | Carte marquée échouée | `orchestrateur.ts:487-489` |
| Écriture confirmée en échec | Gabarit « … n'a pas fonctionné. » suivi de la raison | Texte et carte échouée | `server/lib/lumi/recus.ts:89-90` |
| Effet partiel ou incertain | Gabarit « Fait en partie seulement » ou « je n'ai pas eu la confirmation » ; notification aux propriétaires | Texte | `recus.ts:79-84`, `server/routes/lumi.ts:989-994`, `server/lib/lumi/escalade.ts:32-39` |
| Raccourci dont l'outil échoue | Le raccourci rend `null` ; le message descend aux étages suivants | Rien | `raccourcis.ts:485`, `494-497` |

L'escalade crée une notification `lumi_escalade` pour les propriétaires, les administrateurs et la personne, une fois par conversation et par motif (`escalade.ts:41-78`).

---

## 5. Historique de conversation

### 5.1 Tables

| Table | Colonnes | Remarques | Renvoi |
|---|---|---|---|
| `lumi_conversations` | `id`, `org_id`, `user_id`, `title`, `created_at`, `updated_at` | Titre = 80 premiers caractères du premier message, en clair | `supabase/SCHEMA_SNAPSHOT.md:2449-2456`, `server/routes/lumi.ts:537` |
| `lumi_messages` | `id`, `conversation_id`, `org_id`, `role`, `content` (jsonb), `created_at`, `refs` (jsonb) | `content` = blocs au format de l'API, tels quels | `SCHEMA_SNAPSHOT.md:2480-2488` |
| `lumi_briefings` | `org_id`, `user_id`, `jour`, `conversation_id` | Idempotence du briefing | `SCHEMA_SNAPSHOT.md:2441-2447` |
| `lumi_autorisations` | `org_id`, `user_id`, `tool` | Outils « toujours confirmer » | `SCHEMA_SNAPSHOT.md:2434-2439` |
| `memberships.lumi_mode` | `demander`, `argent`, `tout` | Défaut `argent` | `supabase/migrations/20260911050000_lumi_mode_confirmation.sql:10-14` |
| `org_knowledge` (catégorie `assistant`) | `key`, `value` | Souvenirs injectés dans le prompt | `server/routes/lumi.ts:313` |

En SMS, l'historique vit dans la table `messages` de la messagerie, pas dans `lumi_messages` (`server/lib/sms/fil-lumi.ts:72-80`, `93-111`).

### 5.2 Ce qui est stocké

- Message de l'utilisateur : une chaîne (`server/routes/lumi.ts:550`).
- Message de l'assistant : `reponse.content` complet, donc texte, blocs de réflexion signés, `tool_use`, blocs de recherche d'outils côté serveur (`orchestrateur.ts:446-448`).
- Résultats d'outils : message `user` avec des `tool_result`, contenu masqué et compacté (`orchestrateur.ts:516-520`, `547-548`).
- Réponses des étages sans modèle : un message `assistant` texte, que le modèle relira comme le sien (`server/routes/lumi.ts:592`, `621`, `704`).
- Actions directes et optimisation : `tool_use` synthétiques, identifiant `direct_<uuid>` (`server/lib/lumi/actions-directes.ts:718-742`, `server/lib/lumi/optimiserJournee.ts:112-138`).
- Briefing : un message `assistant` qui ouvre la conversation, avec un bloc non standard `{ type: 'fiches' }` (`server/lib/lumi/briefing.ts:305-308`).
- Les messages sont insérés un par un pour garder l'ordre (`server/routes/lumi.ts:193-199`).
- Le `cache_control` n'est jamais stocké : il est posé sur une copie (`orchestrateur.ts:89-93`).

### 5.3 Rechargement à chaque tour

`chargerHistorique` lit tous les messages de la conversation, dans l'ordre (`server/routes/lumi.ts:164-184`).

| Règle | Seuil | Renvoi |
|---|---|---|
| Fenêtre normale | 60 derniers messages | `server/routes/lumi.ts:144`, `budget.ts:77` |
| Fenêtre en palier économe ou restreint | 6 derniers messages (environ 3 tours) | `budget.ts:78-79`, `server/routes/lumi.ts:534` |
| Coupe | Avancée jusqu'au prochain message utilisateur texte, pour ne jamais séparer un `tool_use` de son `tool_result` | `server/routes/lumi.ts:175-181` |
| Purge des vieux résultats d'outils | Si l'historique dépasse 40 000 caractères, tous les `tool_result` sauf les 3 derniers sont remplacés par une note ; en mémoire seulement | `orchestrateur.ts:137-159`, `server/routes/lumi.ts:183` |
| Coupe d'un résultat d'outil | 60 000 caractères | `compress.ts:19`, `execution.ts:62` |
| Souvenirs dans le prompt | 30 au plus, 240 caractères chacun | `orchestrateur.ts:278` |
| Contexte du routeur | Échange précédent : 300 et 400 caractères ; message : 1 000 | `routeur.ts:261-265` |
| Plafond de coût de la conversation | 40 ¢, vérifié à partir de 10 messages | `server/routes/lumi.ts:722-725` |
| SMS | 12 messages relus, texte seul | `fil-lumi.ts:28`, `lumi-sms.ts:205` |

Il n'y a pas de résumé ni de compaction côté API : l'historique est tronqué. Le commentaire « on résume » ne correspond pas au code (`server/routes/lumi.ts:143`). `/lumi/action` et `/lumi/execute` chargent toujours 60 messages, quel que soit le palier (`server/routes/lumi.ts:871`, `931`).

### 5.4 Masquage des identifiants

- À la sortie d'un outil, chaque UUID devient `refN` (`server/lib/agent/refs.ts:27`, `66-87`, `orchestrateur.ts:516`).
- À l'entrée d'un outil, `refN` redevient l'UUID ; un UUID réel passe tel quel ; une référence inconnue est laissée telle quelle (`refs.ts:121-139`, `orchestrateur.ts:471`).
- L'espace de correspondance est en mémoire, par clé `org:utilisateur`, commun à toutes les conversations de la personne, avec un seul compteur (`refs.ts:29-49`, `orchestrateur.ts:372`).
- Un espace inutilisé depuis 30 minutes est supprimé (`refs.ts:37-43`).
- Un instantané complet de l'espace est écrit dans `lumi_messages.refs` avec le dernier message de chaque sauvegarde (`server/routes/lumi.ts:189-196`, `refs.ts:95-99`).
- Au chargement, les instantanés de la conversation sont fusionnés ; une référence déjà vivante avec un autre UUID n'est jamais réécrite (`server/routes/lumi.ts:173`, `refs.ts:102-113`).
- Les fiches envoyées à l'interface sont lues avant le masquage et portent les vrais identifiants (`orchestrateur.ts:512-514`).
- Le MCP utilise le même mécanisme, sans persistance (`server/routes/mcp.ts:415-419`, `464`).

---

## 6. Confirmation des écritures

### 6.1 De l'appel d'outil à la proposition

1. Le modèle appelle un outil dont `kind` vaut `write` (`orchestrateur.ts:470`, `492`).
2. Le code décide si l'écriture part d'office. Il faut tout à la fois : aucune lecture de contenu externe dans la conversation, outil absent de `JAMAIS_D_OFFICE`, outil anodin ou autorisé, et moins de 20 écritures déjà faites (`orchestrateur.ts:478-480`).
3. D'office : carte émise avec `auto: true`, exécution immédiate, reçu, et le tour continue (`orchestrateur.ts:480-491`).
4. Sinon : les numéros affichés sont résolus, l'écriture est mise en attente ; toutes les écritures de la même réponse forment une seule carte (`orchestrateur.ts:492-500`, `530-545`).
5. Le tour s'arrête. Le `tool_use` reste sans `tool_result` dans `lumi_messages`.

Il n'y a pas de table des propositions. L'état « en attente » est déduit de l'historique : les `tool_use` d'écriture sans `tool_result` du dernier message de l'assistant (`server/routes/lumi.ts:207-228`).

### 6.2 `POST /api/lumi/execute`

| Étape | Règle | Renvoi |
|---|---|---|
| Recherche | Le `tool_use_id` doit faire partie du groupe en attente, sinon 409 `aucune_proposition` | `server/routes/lumi.ts:934-937` |
| Expiration | 15 minutes après le dernier message de l'assistant, sinon 409 | `server/routes/lumi.ts:146`, `941-950` |
| Plafond | Écritures faites + en attente ≤ 20, sinon 409 et escalade | `server/routes/lumi.ts:953-963` |
| `dry_run` | Mêmes gardes, aucune écriture, réponse JSON | `server/routes/lumi.ts:965-974` |
| `cancel` | Un `tool_result` « cancelled » par écriture | `server/routes/lumi.ts:979-982` |
| `confirm` | Chaque écriture est exécutée dans l'ordre par `executerEcriture`, à l'identité de l'utilisateur ; un échec n'arrête pas les suivantes | `server/routes/lumi.ts:983-995` |
| Reçu | Gabarit sans modèle ; `tool_result` et texte sauvegardés | `server/routes/lumi.ts:998-1015`, `recus.ts:63-93` |
| Message suivant sans décision | Les propositions en attente sont annulées d'office | `server/routes/lumi.ts:546-549`, `881-884` |

`executerEcriture` passe par `executerOutilGarde` : permission du rôle relue sans cache, visibilité des montants, validation des arguments, normalisation des dates, résolution des numéros (`execution.ts:40`, `garde.ts:329-374`).

En SMS, une confirmation arrête la suite au premier échec (`fil-lumi.ts:198-205`). Le web continue.

### 6.3 Idempotence (`agent_actions`)

| Fait | Détail | Renvoi |
|---|---|---|
| Table | `id`, `org_id`, `user_id`, `outil`, `args_hash`, `resultat` (jsonb), `created_at` | `SCHEMA_SNAPSHOT.md:365-373` |
| Empreinte | sha256 de `{ utilisateur, args }`, clés triées | `server/lib/agent/tools-etendus.ts:195-202`, `280` |
| Unicité | Index unique `(org_id, outil, args_hash)` | `supabase/migrations/20260903090000_agent_ecritures.sql:41` |
| Ordre | L'empreinte est posée avant d'agir | `tools-etendus.ts:282-287` |
| Doublon de moins de 10 minutes | Renvoie le résultat mémorisé, marqué `deja_fait` ; ou une erreur « déjà en cours » si le résultat n'est pas encore écrit | `tools-etendus.ts:265`, `309-319` |
| Doublon de plus de 10 minutes | L'empreinte est libérée ; nouvelle exécution | `tools-etendus.ts:302-308` |
| Échec propre | Empreinte retirée | `tools-etendus.ts:350` |
| Effet partiel | Empreinte gardée ; événement `agent_write_partial` | `tools-etendus.ts:335-346` |
| Succès | `resultat` mémorisé, caches de l'org périmés, événement `agent_write_executed` | `tools-etendus.ts:325-332` |
| Mode à blanc | Aucune empreinte, aucune écriture | `tools-etendus.ts:274-276` |
| Purge | Lignes de plus de 24 h supprimées par `oauth_menage` | `supabase/baseline/01_schema.sql:10849-10850`, `server/index.ts:1480-1485` |

L'empreinte ne contient pas le `tool_use_id`. Deux demandes identiques et légitimes à moins de 10 minutes sont donc traitées comme un doublon. Toutes les écritures passent-elles par `executerIdempotent` ? Non vérifié outil par outil dans cette partie.

### 6.4 Modes d'autorisation

| Mode (`memberships.lumi_mode`) | Ce qui part sans carte | Renvoi |
|---|---|---|
| `demander` | Rien, hors écritures anodines et outils cochés un à un | `execution.ts:156`, `166-175` |
| `argent` (défaut) | Toutes les écritures non sensibles | `execution.ts:134-139`, `158` |
| `tout` (propriétaire seulement) | Toutes, sauf `JAMAIS_D_OFFICE` et `TOUJOURS_CARTE` | `execution.ts:151-160`, `server/routes/lumi.ts:1048-1053` |

- Les outils cochés « toujours confirmer » s'ajoutent au mode (`execution.ts:166-176`). La route refuse de cocher un outil de `JAMAIS_D_OFFICE` (`server/routes/lumi.ts:1082-1084`).
- Écritures anodines, toujours sans carte : `remember_this`, `forget_note` (`server/lib/agent/registre.ts:68-69`, `111`).
- `update_job_status` devient sensible si une automatisation active sur « job terminée » écrit au client ; en cas d'erreur de lecture, il est traité comme sensible (`execution.ts:115-131`).
- Les « écritures directes » de l'étage 2 bis (pointer, dépointer, pause, fin de pause, notifications lues, « retiens… ») sont exécutées tout de suite, sans carte, quel que soit le mode (`actions-directes.ts:95-101`, `717-733`).
- Le MCP n'a pas de carte : la confirmation est celle du client MCP (`server/routes/mcp.ts:421`).

### 6.5 Écritures sensibles

Liste de base, marquées `sensible` (`server/lib/agent/registre.ts:30-66`) : `merge_clients`, `archive_job`, `apply_day_optimization`, `reschedule_job`, `cancel_visit`, `create_quote`, `send_quote`, `cancel_quote`, `convert_quote_to_job`, `create_invoice`, `create_invoice_from_job`, `send_invoice`, `mark_invoice_paid`, `send_payment_reminders`, `send_sms`, `send_email`. Les outils des domaines ajoutent les leurs (`registre.ts:71`, `server/lib/agent/outils-domaines.ts`, non détaillé ici).

`JAMAIS_D_OFFICE` (`registre.ts:85-101`) réunit :
- toute écriture qui atteint le client ou qui ne se défait pas ;
- argent et paie : `refund_payment`, `charge_card_on_file`, `mark_invoice_paid`, `record_invoice_payment`, `void_invoice`, `delete_invoice`, `create_payment_request`, `resend_payment_request`, `remove_card_on_file`, `run_recurring_invoice_now`, `set_hourly_rate`, `add_payroll_adjustment`, `mark_payroll_period_paid`, `unmark_payroll_period_paid`, `approve_timesheet` ;
- droits et accès : `update_member_role`, `set_member_permissions`, `reset_member_permissions`, `update_role_preset`, `invite_member`, `remove_member`, `reactivate_member`, `revoke_invitation`, `resend_invitation` ;
- ce qui parlera au client plus tard : rapports planifiés, modèles de courriel, textes et interrupteurs d'automatisation, `create_job_agreement`.

`TOUJOURS_CARTE` : `apply_day_optimization` (`execution.ts:151`).

---

## 7. Journalisation existante

### 7.1 Les journaux

| Journal | Une ligne par | Écrit par | Colonnes | Renvoi |
|---|---|---|---|---|
| `lumi_traces` | Tour (ou appel d'entretien, ou refus de garde) | `server/routes/lumi.ts` (tous les étages), `server/lib/agent/garde.ts:240`, `server/lib/lumi/cache-chaud.ts:157-176`, `server/routes/agent.ts:68`, `server/routes/sales-chat.ts`, `server/routes/support.ts:185`, `server/lib/support/portail.ts:67`, `server/lib/migration/bot.ts` | `org_id`, `user_id`, `conversation_id`, `canal`, `origine`, `enonce_normalise`, `etage`, `topic`, `action`, `params`, `outils`, `resultat`, `model`, `prompt_version`, `input_tokens`, `cache_5m`, `cache_1h`, `cache_lu`, `output_tokens`, `cost_cents`, `duree_ms`, `feedback`, `created_at` | `SCHEMA_SNAPSHOT.md:2490-2515`, `server/lib/lumi/traces.ts:112-137` |
| `ai_usage` | Appel au modèle | `server/routes/lumi.ts:457` (agent), `382` et `759` (routeur), `server/lib/sms/lumi-sms.ts:213`, `server/routes/agent.ts:59` (dictée), `server/lib/support/ia.ts:250`, `server/lib/lumi/generer-parcours.ts:554` | `org_id`, `user_id`, `conversation_id`, `model`, `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`, `cost_cents`, `source`, `request_id`, `credits_micro`, `taux_version`, `created_at` | `SCHEMA_SNAPSHOT.md:400-416`, `budget.ts:280-310` |
| `ai_usage_monthly`, `ai_reservations` | Org et période ; réservation | RPC `reserve_ai_budget`, `settle_ai_budget` | Montants réservés et dépensés | `SCHEMA_SNAPSHOT.md:390-398`, `418-425` |
| `security_events` | Événement | `agent_write_executed`, `agent_write_partial` (`tools-etendus.ts:328-345`) ; `lumi_budget_econome` (`budget.ts:245-248`) ; échecs d'authentification MCP (`server/routes/mcp.ts:178-238`) | `org_id`, `user_id`, `event_type`, `severity`, `source`, `ip_address`, `user_agent`, `details`, `created_at` | `SCHEMA_SNAPSHOT.md:3933-3947` |
| `agent_actions` | Écriture d'agent | `executerIdempotent` | Voir 6.3 ; purgé à 24 h | `tools-etendus.ts:282-350` |
| `lumi_messages` | Message | `sauverMessages` | Voir 5.1 | `server/routes/lumi.ts:186-201` |
| `notifications` | Escalade, briefing | `escalade.ts:72`, `briefing.ts:311` | Titre, corps (180 caractères), lien | — |
| Journaux du serveur | Ligne | `logger`, `console.error`, `console.warn` | Texte libre ; `logger` masque mots de passe, jetons et clés | `server/lib/logger.ts:13-17`, `55-87` |
| Compteurs du plafond journalier | Source et jour, en mémoire | `plafond-journalier.ts:95-110` | Cents, appels, refus | Perdus au redémarrage |

Particularités à connaître :
- `ai_usage.source` vaut `lumi` par défaut. Le routeur est journalisé sans `source: 'routeur'` (`server/routes/lumi.ts:382-387`, `759-763` ; `budget.ts:278`, `297`).
- `ai_usage` exige un `org_id`. Les pings de cache et le chat public n'y figurent donc pas (`cache-chaud.ts:152-155`, `server/lib/support/ia.ts:249`).
- Un même appel n'est débité qu'une fois grâce à l'index unique `(org_id, request_id)` (`supabase/migrations/20261005200000_lumi_credits.sql:56-57`, `budget.ts:305-307`).
- La colonne `lumi_traces.feedback` existe et n'est écrite nulle part (recherche sans résultat dans `server/routes/lumi.ts` et `server/lib/lumi`).
- `lumi_traces.topic` n'est rempli que pour le hors-sujet (`server/routes/lumi.ts:779`).
- Le canal SMS et le MCP n'écrivent aucune ligne dans `lumi_traces` (aucun appel à `journaliserTrace` dans `server/lib/sms` ni dans `server/routes/mcp.ts`).

### 7.2 Écart avec la liste cible

| Donnée cible | `lumi_traces` | `ai_usage` | Ce qui manque |
|---|---|---|---|
| Tenant | Oui (`org_id`, `user_id`) | Oui | Rien pour le web. SMS et MCP : absents de `lumi_traces` |
| Conversation | Oui | Oui pour le web | SMS, support, dictée : `conversation_id` nul (`lumi-sms.ts:214`, `agent.ts:60`, `ia.ts:253`). Aucun identifiant de tour ne relie `ai_usage`, `lumi_traces` et `lumi_messages` |
| Modèle | Oui, celui du dernier appel du tour (`server/routes/lumi.ts:367`) | Oui, par appel | Dans la trace, un changement de modèle en cours de tour est invisible |
| Tokens d'entrée | Oui | Oui | — |
| Tokens lus en cache | Oui (`cache_lu`) | Oui | — |
| Tokens écrits en cache | Oui (`cache_5m`, `cache_1h`) | Oui, sans distinction 5 min / 1 h | Les pings d'entretien rangent leur écriture dans `cache_1h` alors qu'elle est en 5 min (`cache-chaud.ts:170`) |
| Tokens de sortie | Oui | Oui | Pas de part « réflexion » séparée |
| Nombre d'outils chargés | Non | Non | Manque. Seul `params.sous_agent` donne un indice (`server/routes/lumi.ts:394`) |
| Outils appelés | Partiel | Non | Seulement les lectures réussies, sans doublon ni compte (`server/routes/lumi.ts:365`). Manquent : écritures proposées ou exécutées d'office, outils refusés ou en échec, recherches d'outils, nombre d'étapes |
| Latence au premier token | Non | Non | Manque partout |
| Latence totale | Oui (`duree_ms`) | Non | Mesurée depuis `executerTourSse` : exclut `contexteTour`, les caches et le routeur (`server/routes/lumi.ts:357`, `400`). Durée du routeur à part dans `params.routeur.duree_ms` |
| Coût réel | Oui (`cost_cents`) | Oui | La trace d'étage 6 exclut le coût du routeur (`server/routes/lumi.ts:488` contre `757-763`). Plongements Gemini : jamais chiffrés (`cache-semantique.ts:66-82`). Transcription des notes vocales SMS : jamais chiffrée (`note-vocale.ts:120`) |
| Intention détectée | Partiel | Non | `action` porte le raccourci ou l'outil proposé ; le sujet du routeur est dans `params.routeur.verdict` ; pas de colonne d'intention pour l'étage 6 |
| Succès ou échec | Partiel (`resultat`) | Non | Un refus du modèle, « trop d'étapes » et « plafond du tour » sont tracés `ok` (`server/routes/lumi.ts:488`). Le `stop_reason` n'est pas stocké. Les échecs d'outils ne sont pas tracés |
| Version du prompt | Oui (`prompt_version`) | Non | — |
| Identifiant de requête du fournisseur | Non | Oui (`request_id`) | — |

### 7.3 Renseignements personnels écrits en clair

| Où | Quoi | Qui peut lire | Durée | Renvoi |
|---|---|---|---|---|
| `lumi_traces.enonce_normalise` | Le message de l'utilisateur, en minuscules et sans accents, 200 caractères. Un nom de client dicté y figure | Tout membre actif de l'entreprise, par la politique RLS | Aucune purge trouvée | `traces.ts:103-107`, `121` ; `supabase/baseline/01_schema.sql:49129` ; `supabase/migrations/20260913000000_lumi_traces.sql:29-31` |
| `lumi_traces.params.cible` | Pour une action directe : numéro, courriel, nom, texte dicté, champs d'une fiche | Idem | Idem | `server/routes/lumi.ts:670`, `actions-directes.ts:43` |
| `lumi_traces.params.candidat_retrait` | L'énoncé précédent normalisé, lors d'un repli | Idem | Idem | `server/routes/lumi.ts:848` |
| `lumi_traces.params.extraction` | Client, prénom, nom, téléphone, courriel, adresse (branche inerte aujourd'hui) | Idem | Idem | `server/routes/lumi.ts:839`, `routeur.ts:89-104` |
| `lumi_conversations.title` | 80 premiers caractères du premier message | La personne seulement | Jusqu'à suppression | `server/routes/lumi.ts:537` ; `baseline/01_schema.sql:49087` |
| `lumi_messages.content` | Tout l'échange : messages, résultats d'outils avec noms, téléphones, adresses, montants | La personne seulement | Aucune purge trouvée ; suppression définitive sur demande | `server/routes/lumi.ts:195`, `1291` ; `baseline/01_schema.sql:49107` |
| `security_events.details.resultat` | Les 300 premiers caractères du résultat de chaque écriture | Non vérifié | Non vérifié | `tools-etendus.ts:328-332`, `341-345` |
| `agent_actions.resultat` | Le résultat complet de chaque écriture | Tout membre actif de l'entreprise | 24 h | `tools-etendus.ts:325` ; `baseline/01_schema.sql:44218` |
| `notifications.body` | 180 premiers caractères du briefing ou de l'escalade | Le destinataire | Non vérifié | `briefing.ts:314`, `escalade.ts:66` |
| Table `messages` (SMS) | Texte des échanges avec Lumi et, derrière un marqueur, le JSON de la proposition (arguments réels) | Équipe ayant accès à la messagerie | Non vérifié | `fil-lumi.ts:37-39`, `72-80` |
| Redis (Upstash) | Texte des réponses, fiches, énoncé normalisé, vecteur | Opérateur | 60 s, 10 min, 24 h | `cache-reponses.ts:82`, `cache-semantique.ts:131-139` |
| Journaux du serveur | Montants cités sans source, identifiant de conversation ; messages d'erreur bruts de la base | Opérateur | Selon l'hébergeur | `server/routes/lumi.ts:484-486`, `orchestrateur.ts:524`, `tools-etendus.ts:353` |
| Google (Gemini) | Le texte du premier message de chaque conversation (plongement, 2 000 caractères) ; l'audio des dictées et des notes vocales | Fournisseur tiers | Hors du dépôt | `server/routes/lumi.ts:686`, `cache-semantique.ts:69-73`, `transcribe.ts:53-76` |

La suppression d'une conversation efface ses messages par cascade, mais garde ses traces avec `enonce_normalise` (`baseline/01_schema.sql:41685`, `41701`).

---

## 8. Surprises et risques

Classés par gravité estimée pour un lancement. « À confirmer par test » quand le raisonnement repose sur le comportement de l'API.

### A. Coût

1. **Les pings d'entretien supposent un cache d'une heure, mais le cache est en 5 minutes depuis le 2026-09-30.** Les trois points de cache de l'agent utilisent `CACHE_5M` (`orchestrateur.ts:80`, `209`, `298`). `cache-chaud.ts` ping toujours 50 minutes après la dernière activité, puis toutes les 50 minutes pendant 12 heures, pour jusqu'à 12 préfixes (`cache-chaud.ts:30`, `46`, `93-97`, `227-253`). À 50 minutes, une entrée de 5 minutes a expiré : chaque ping réécrit le préfixe entier (1,25 fois le tarif d'entrée) pour un cache qui expire 5 minutes plus tard. Le préchauffage au démarrage ne sert que si quelqu'un écrit dans les 5 minutes (`cache-chaud.ts:200-219`). Commentaires périmés : `orchestrateur.ts:15-18`, `tarifs.ts:5-7`, `traces.ts:73-78`, `server/index.ts:1544`.
2. **Le cache de la conversation ne peut pas servir d'un tour à l'autre.** L'ordre de rendu de l'API est outils, système, messages. Le bloc système variable, placé avant les messages, contient l'heure à la minute et des indices d'outils calculés à partir de chaque message (`temps.ts:29-37`, `server/routes/lumi.ts:433-439`, `orchestrateur.ts:290-300`). Le point glissant sur le dernier message (`orchestrateur.ts:94-106`) n'est donc relu qu'entre les étapes d'un même tour. Un tour à une seule étape paie l'écriture de toute la conversation sans jamais la relire. À confirmer en mesurant `cache_read_input_tokens` sur le premier appel d'un tour de suite.
3. **Le plafond par tour compte maintenant le démarrage à froid.** Le calcul retire seulement les écritures de cache 1 h, qui n'existent plus (`orchestrateur.ts:435-440`). Un préfixe froid en 5 minutes entre dans les 6 ¢ et peut déclencher l'étape « sans outils ».
4. **Le routeur ajoute un appel Haiku à chaque message, pas seulement au premier** (`server/routes/lumi.ts:751`). Ses seuls effets réels sont le hors-sujet (premier message) et le choix du sous-agent. Les branches « action » et « extraction » sont du code inerte (`routeur.ts:151`, `277-287` ; `server/routes/lumi.ts:787-844`). Un changement de sujet en cours de conversation change le bloc d'outils, donc tout le préfixe en cache. Son cache 1 h n'est entretenu par aucun ping.
5. **Dépenses non journalisées.** Plongement Gemini lancé à chaque premier message, même non cachable (`server/routes/lumi.ts:686`, `cache-semantique.ts:66-82`). Transcription des notes vocales SMS, sans plafond « voix » ni `ai_usage` (`note-vocale.ts:120`, à comparer à `server/routes/agent.ts:41-65`).
6. **Deux commentaires se contredisent sur la recherche d'outils.** `orchestrateur.ts:25-26` dit que la définition s'ajoute après le préfixe et que le cache tient. `sous-agents.ts:37-43` dit avoir mesuré l'inverse (27 000 à 30 000 tokens relus au plein tarif). À remesurer avant toute réduction de coût.
7. **Un appel au modèle continue après la fermeture du navigateur.** Aucun signal d'annulation n'est transmis (`server/routes/lumi.ts:372-373`, `orchestrateur.ts:413`). Le tour est facturé et sauvegardé.

### B. Fiabilité

8. **`max_tokens` n'est pas traité** (`orchestrateur.ts:457-459`). Avec 2 048 tokens, réflexion incluse (`regles-cout.ts:48`), une réponse coupée passe pour complète. Si la coupe tombe dans un `tool_use`, le bloc incomplet est sauvegardé (`orchestrateur.ts:446-448`). Pour une écriture, il devient une proposition « en attente » à arguments tronqués, confirmable par `/lumi/execute` (`server/routes/lumi.ts:207-228`, `934-937`). Pour une lecture, aucun `tool_result` n'est jamais ajouté, et chaque tour suivant de cette conversation risque un refus 400 de l'API. Même risque après un `refusal` qui coupe un `tool_use`. À confirmer par test.
9. **Répondre dans une conversation de briefing risque d'échouer.** Le premier message est de rôle `assistant` et contient un bloc `{ type: 'fiches' }` inconnu de l'API (`briefing.ts:305-308`). `chargerHistorique` ne filtre ni l'un ni l'autre (`server/routes/lumi.ts:164-184`). La notification du matin mène à cette conversation (`briefing.ts:315`). À confirmer par test.
10. **Une erreur en cours de tour perd les messages du tour.** Ils ne sont sauvegardés qu'après le retour de `tourLumi` (`server/routes/lumi.ts:474`, `503-506`). Une écriture déjà exécutée d'office dans ce tour n'apparaît alors plus dans l'historique (`orchestrateur.ts:487-489`).
11. **Collision possible des références `refN` entre conversations.** L'espace est commun à toutes les conversations d'une personne, vit en mémoire, et disparaît après 30 minutes ou à chaque déploiement (`refs.ts:37-49`). Si une nouvelle conversation recrée `ref1…` avant qu'une ancienne soit rouverte, l'instantané de l'ancienne n'écrase pas les références vivantes (`refs.ts:107`). Un `ref3` de l'ancienne conversation désigne alors une autre fiche. La carte montre la cible résolue, mais une lecture ou une écriture d'office viserait la mauvaise entité sans alerte. À confirmer par test.
12. **Le plafond journalier de l'instance affiche « crédits épuisés » au client.** Défaut : 5 $ par jour pour toute la source `lumi`, toutes entreprises confondues, compteur en mémoire par processus (`plafond-journalier.ts:72`, `95-110`). Une fois atteint, chaque client reçoit « Tes crédits Lumi sont épuisés jusqu'au … » et la trace porte l'action `budget_epuise` (`server/routes/lumi.ts:424-427`, `466-473`, `488`). La valeur réglée en production n'a pas été lue.
13. **Le détecteur de montants sans source ne tourne presque jamais.** `chiffresSuspects` n'est calculé que dans la sortie « trop d'étapes » (`orchestrateur.ts:552`). La sortie normale ne le rend pas (`orchestrateur.ts:458`). L'alerte et la métrique de `server/routes/lumi.ts:483-488` sont donc muettes.
14. **Huitième étape sans conclusion.** Si le dernier appel permis demande des outils, ils sont exécutés puis le tour s'arrête sur `trop_d_etapes` (`orchestrateur.ts:547-552`). En palier restreint (2 étapes), cela arrive dès qu'une question demande deux séries de lectures.
15. **Aucun battement de cœur SSE.** Un appel long sans texte laisse le flux muet ; un proxy peut le couper. Non trouvé dans `ouvrirSse` (`server/routes/lumi.ts:151-161`).
16. **Beaucoup d'allers-retours en base avant le premier token.** `etatBudget` (au moins six requêtes, `budget.ts:155-229`), `company_settings`, deux `getUserContext`, souvenirs, crédits (`server/routes/lumi.ts:273-331`), conversation, historique, puis permissions, autorisations (trois requêtes, `execution.ts:166-172`) et réservation. La latence au premier token n'est mesurée nulle part.
17. **Double clic sur Confirmer.** Deux requêtes simultanées voient la même proposition, car l'état vient de l'historique et le résultat n'est écrit qu'après l'exécution (`server/routes/lumi.ts:931-937`, `1010`). L'idempotence de `agent_actions` protège l'écriture, mais deux `tool_result` pour le même `tool_use_id` peuvent être sauvegardés. Le client bloque le second clic (`src/pages/Lumi.tsx:529`). À confirmer par test.
18. **Passage à Haiku avec un historique Sonnet.** En palier économe, l'historique rejoué contient des blocs de réflexion et de recherche d'outils produits par Sonnet 5, et les outils différés restent envoyés (`orchestrateur.ts:446-448`, `budget.ts:78`). Compatibilité à confirmer par test.

### C. Mesure

19. **Un refus du modèle et un tour inachevé sont tracés comme des succès.** `tracer` reçoit `ok` ou `proposition` ; `erreurModele` ne sert qu'à l'escalade (`server/routes/lumi.ts:403`, `488`).
20. **L'origine « voix » n'est jamais envoyée.** `pendingSpokenRef` est remis à faux avant le calcul de l'origine, et `envoyer` n'est jamais appelé avec `spoken` (`src/pages/Lumi.tsx:481-489`, `838`, `876`). Les messages dictés sont tracés `texte`.
21. **Le canal SMS n'a pas de trace par tour**, et son `ai_usage` n'a pas de `conversation_id` (`lumi-sms.ts:213-219`). Le plafond de conversation ne s'y applique donc pas.
22. **Le coût du routeur est rangé sous la source `lumi`** (`server/routes/lumi.ts:759-763`), et il n'entre pas dans le `cost_cents` de la trace d'étage 6.
23. **Le texte mis en cache contient les phrases intermédiaires.** `texteTotal` cumule le texte de toutes les étapes du tour (`orchestrateur.ts:429`, `server/routes/lumi.ts:492`).

### D. Sécurité et confidentialité

24. **Le canal SMS contourne plusieurs gardes du web.** `outilsPermis` n'est pas transmis : le modèle voit tous les outils, la garde d'exécution reste la seule barrière (`lumi-sms.ts:199-224`, `orchestrateur.ts:196`). Pas de restrictions de rôle dans le prompt, pas de plafond d'écritures, pas de plafond journalier, pas de limite de tours par heure, pas de contrôle de `external_agent.use`. L'identité repose sur le numéro de l'expéditeur (`identifier-membre.ts:41-94`). Chaque texto est un tour complet du modèle.
25. **`external_agent.use` ne couvre pas toutes les routes.** `POST /api/lumi/action`, `/lumi/mode`, `/lumi/autorisations`, `/lumi/credits` et `/lumi/credits/historique` ne figurent pas dans la table (`server/lib/route-permissions.ts:83-88`). `/lumi/action` exécute des lectures sous la seule garde d'outil.
26. **Le MCP ne passe pas par `executerOutilGarde`.** Il n'applique ni la validation des arguments, ni la normalisation des dates, ni la résolution des numéros, ni le refus d'écrire un montant quand on ne le voit pas ; il lit les permissions avec le cache et ne journalise pas les refus (`server/routes/mcp.ts:344-377`, `421` contre `garde.ts:336`, `354-373`). Le commentaire de `server/index.ts:776` parle encore d'un serveur en lecture seule.
27. **`lumi_traces` et `agent_actions` sont lisibles par tout membre actif de l'entreprise** (`baseline/01_schema.sql:49129`, `44218`). Un technicien peut y lire les questions du propriétaire et le résultat des écritures.
28. **Le texte des messages part chez Google** pour le plongement, à chaque premier message, même quand l'énoncé n'est pas cachable (`server/routes/lumi.ts:686-688`).
29. **La liste des lectures « à contenu externe » est fixe, 11 outils** (`orchestrateur.ts:125-129`). Tout autre outil qui rend du texte libre saisi par un tiers n'active pas le verrou des écritures d'office.
30. **Les écritures directes ignorent le mode `demander`** et le verrou « contenu externe » (`actions-directes.ts:717-733`). « Retiens… » écrit dans la mémoire de toute l'entreprise sans carte.
31. **La limite de 60 tours par heure n'existe que si Redis est configuré** (`server/lib/rate-limiter.ts:95-98`).

### E. Documentation et code en décalage

32. `CLAUDE.md` annonce Opus 5 et 66 outils ; le code a `claude-sonnet-5` par défaut et plus de 240 outils (`tarifs.ts:51`, `orchestrateur.ts:194`, `indices-outils.ts:4`).
33. `topics.ts:5-8` dit que les sujets ne restreignent pas encore les outils ; `sous-agents.ts:45-58` le fait.
34. Seuils d'alerte : le texte parle de 60 % (`budget.ts:232`, `server/routes/lumi.ts:281`), le code de 70 % et 90 % (`budget.ts:52-53`). Le courriel d'alerte dit « jusqu'au 1er » (`budget.ts:256-257`) alors que la période est à date anniversaire (`credits.ts:13-14`).
35. Le garde-fou journalier par entreprise calcule minuit avec un décalage fixe de −04:00 (`budget.ts:202`).
36. Les codes d'erreur `ralenti` et `quota_epuise` de l'interface sont morts (`src/pages/Lumi.tsx:809-814`).
37. La baseline `supabase/baseline/01_schema.sql` date du 2026-09-26 et ne contient pas `ai_usage.request_id` ni les tables de crédits ajoutées par `supabase/migrations/20261005200000_lumi_credits.sql:52-57`.
38. Le fuseau par défaut diffère selon le module : `America/Toronto` (`server/routes/lumi.ts:289`, `garde.ts:23`), `America/Montreal` (`credits.ts:85`, `server/lib/agent/tools.ts:44`). Même décalage horaire, mais deux constantes.
