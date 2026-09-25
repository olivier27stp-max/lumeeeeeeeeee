# PLAN — Brancher Grok sur le MCP de Lume, comme Claude

Date : 2026-09-15. Sources : doc xAI « Connectors » (https://docs.x.ai/grok/connectors), « Custom MCP Server Tunneling » (https://docs.x.ai/grok/connectors/custom-mcp-tunneling), « Remote MCP Tools » pour l'API (https://docs.x.ai/developers/tools/remote-mcp) ; le serveur MCP de Lume (`server/routes/mcp.ts`, `server/routes/oauth.ts`, `server/lib/oauth.ts`) ; les 3 comptes bots Grok dans l'org « Viktor Audit (TEST) » (grok1 admin, grok2 sales_rep, grok3 technician). Rafba a l'abonnement SuperGrok.

---

## 1. Deux chemins chez Grok, et le bon pour nous

| Chemin | Qui paie le modèle | Authentification à notre MCP | Où on en est |
|---|---|---|---|
| **grok.com › Connectors › New Connector › Custom** (« Bring your own MCP », plan SuperGrok requis) | l'abonnement — **0 $ de plus**, comme Claude | « If your MCP server requires OAuth or API keys, you will still complete that flow in Grok » → **notre OAuth marche tel quel** : identité, rôle, RLS, écritures sous scope `mcp:write` | **Rien à coder pour essayer.** Notre serveur d'autorisation est standard : métadonnées `/.well-known/oauth-*`, enregistrement dynamique ouvert (RFC 7591, `POST /api/oauth/register`, toute URI `https`), PKCE, consentement dans Lume. Claude passe par là ; Grok devrait aussi. |
| **API xAI** (`type: 'mcp'` dans l'API Responses ou le SDK, pour des bots scriptés) | des crédits xAI à l'usage | jeton statique seulement (`authorization` ou `headers`), **pas d'OAuth** | Lecture seule possible aujourd'hui via `headers: { 'x-api-key': 'lk_live_…' }`. Écritures = il faudrait un « jeton d'agent » lié à un compte (étape B, plus bas). |

Conclusion : **on commence par grok.com avec l'abonnement**, exactement comme Claude. L'API et ses clés ne servent que si tu veux des bots automatiques (scripts) plutôt que des humains qui parlent à Grok.

## 2. Ce qu'on ne sait pas encore de grok.com (à constater à l'essai, 10 minutes)

1. Que Grok mène bien notre flux OAuth au bout (enregistrement dynamique → écran de consentement Lume → jeton). Si ça bloque, le journal `security_events` (`mcp_oauth_token_invalid`, échecs `/api/oauth/*`) dit à quelle étape.
2. S'il lit `initialize.instructions` (nos consignes « collègue »). Claude les lit ; xAI ne le documente pas.
3. S'il **demande l'approbation** avant d'appeler un outil d'écriture, ou s'il exécute d'office. Ça décide si les envois au client (texto, courriel, devis, facture) peuvent rester ouverts à Grok.
4. Combien d'outils il charge (69 exposés) et s'il permet d'en restreindre la liste par connecteur.

## 3. Le plan

### Étape A — Essai avec l'abonnement (0 code, aujourd'hui)
1. Sur grok.com, connecté au compte SuperGrok : Connectors › New Connector › Custom › URL `https://lumecrm.net/api/mcp`.
2. Grok doit ouvrir l'écran de connexion Lume : se connecter avec **grok1** (org de test), cocher `mcp:read` + `mcp:write`, consentir.
3. Cinq questions dans un chat Grok : « qui me doit de l'argent ? », « mon brief du matin », « parle-moi de Marie Tremblay », « crée une tâche : rappeler le fournisseur vendredi », « envoie un texto à … ». Noter : outils appelés (visibles dans `agent_actions` et `security_events`), réponses en français sans identifiant, **si Grok a demandé avant d'écrire**, si le texto est parti sans question.
4. Refaire avec **grok3** (technicien) : les montants doivent être masqués, les finances refusées.
Ce que ça livre : la réponse aux 4 inconnues du point 2, sans une ligne de code.

### Étape B — Si Grok exécute les écritures sans demander (S, sans migration)
Notre serveur voit le client OAuth (`oauth_clients.client_name` / `client_uri` à l'enregistrement dynamique). Règle par client : pour un client qui n'est pas Claude, refuser par défaut les écritures `vers_client` du registre (`send_sms`, `send_email`, `send_quote`, `send_invoice`, `send_payment_reminders`) et `mark_invoice_paid`, avec un message d'exploitant (« pour envoyer, fais-le dans Lume »), sauf un scope explicite `mcp:envois` coché au consentement. Plafond d'écritures par jeton et par heure (30), compté dans `agent_actions`. Tests : deux clients simulés, même outil, un refusé un accepté.

### Étape C — Traces MCP (S)
Aujourd'hui les appels MCP ne sont pas dans `lumi_traces` (canal `agent` prévu, jamais rempli). Une ligne par `tools/call` : canal `agent`, `params.client = client_name` (Claude / Grok / clé API), jeton, outil, durée, résultat, `cost_cents` NULL (c'est l'abonnement qui paie). C'est ce qui dira ce que les bots font vraiment et lequel des deux assistants se trompe.

### Étape D — Page Réglages › API & MCP (S)
La page est écrite pour Claude (« Lume × Claude »). Ajouter « Grok » à côté : la même URL, le chemin grok.com › Connectors › Custom, le rappel que l'écriture dépend du scope coché.

### Étape E — Batterie Grok (M) — seulement si tu veux mesurer sérieusement
Une batterie comme celle de Lumi, mais jouée à travers grok.com ne s'automatise pas (pas d'API pour l'abonnement). Deux options : à la main avec une grille de 15 énoncés (une heure), ou par l'API xAI avec des crédits (`XAI_API_KEY`, `scripts/qa/verifier-mcp-grok.mjs`), qui teste le même serveur MCP mais pas exactement le même chemin d'authentification.

### Étape F — Bots scriptés par l'API (M, une migration) — seulement si tu veux des agents automatiques
Jeton d'agent `lk_agent_…` lié à un compte : émis par le bot connecté à Lume, stocke son refresh token chiffré comme le consentement OAuth le fait déjà (`oauth_tokens.supabase_refresh_token_chiffre`), via un `oauth_clients` fixe « jeton-agent » → `validateAccessToken()` et `buildUserScopedClient()` marchent sans changement. 90 jours, révocable, mêmes bornes d'écriture que l'étape B. Avec `headers`/`authorization` côté API xAI.

## 4. Ordre

| # | Étape | Effort | Migration | Dépend de |
|---|---|---|---|---|
| A | essai grok.com avec grok1 puis grok3 | 10 min, 0 code | non | ton abonnement, les comptes bots |
| C | traces MCP | S | non | — |
| B | bornes d'écriture par client | S | non | le résultat de A (point 3) |
| D | page Réglages | S | non | A |
| E | batterie | M | non | A ; clé xAI seulement pour la version automatisée |
| F | jetons d'agent (API) | M | oui | seulement si tu veux des bots scriptés |

## 5. Ce qu'il faut de toi
- Faire l'étape A (c'est ton compte SuperGrok et ton navigateur) et me dire ce que Grok a fait aux points 2.1 à 2.4. Je regarde en parallèle `security_events` et `agent_actions` en prod pendant l'essai.
- Décider après A si les envois au client restent ouverts à Grok (mon avis : non par défaut).
- Aucune clé xAI tant qu'on reste sur l'abonnement.
