/* ═══════════════════════════════════════════════════════════════
   Lume MCP Server — Model Context Protocol endpoint
   ─────────────────────────────────────────────────────────────
   Exposes the org's CRM as MCP tools so any MCP client (Claude,
   Cursor, ChatGPT, a custom agent) can query it in natural language.

   AUTH — X-API-Key: lk_live_… , created in Settings → API & MCP.
   The key carries its own org_id (server-side, from `api_keys`);
   no client-supplied org is ever trusted. The `mcp` scope is
   required — a key without it is rejected even if otherwise valid.

   LECTURE + ÉCRITURE SOUS SCOPE — les lectures exigent `mcp:read` ;
   les écritures exigent `mcp:write` (accordé par la personne sur
   l'écran de consentement) ET l'identité (session OAuth rejouée).
   Une clé d'API — partagée, sans humain derrière — ne voit ni les
   écritures ni les lectures sensibles (needsIdentity). Le filtre de
   visibilité (outilsPour) et le contrôle d'appel sont le MÊME code :
   un outil invisible est inappelable.

   ⚠️  Ajouter un outil à AGENT_TOOLS avec un handler le publie ici
   automatiquement, sous les règles ci-dessus. Rien d'impropre à un
   client tiers ne doit y entrer.

   TRANSPORT — JSON-RPC 2.0 over HTTP POST (the MCP "streamable
   HTTP" transport, non-streaming subset). Implemented directly:
   three methods, no SDK dependency, no extra supply-chain surface.
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { validateApiKey } from '../lib/api-keys';
import { getServiceClient, requireAuthedClient } from '../lib/supabase';
import { logSecurityEvent, extractIP } from '../lib/security';
import { sendSafeError } from '../lib/error-handler';
import { AGENT_TOOLS, TOOLS_BY_NAME, type AgentTool } from '../lib/agent/tools';
import { validateAccessToken, canonicalResource, baseUrl, SCOPE_MCP_READ, SCOPE_MCP_WRITE, buildUserScopedClient } from '../lib/oauth';
import { getUserContext, hasPermission } from '../lib/rbac';

const router = Router();

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'lume-crm', version: '1.1.0' };
const REQUIRED_SCOPE = 'mcp';

/**
 * Instructions livrées au modèle à la connexion (champ `instructions` du
 * résultat d'initialize — le mécanisme MCP prévu pour dicter la manière
 * d'utiliser un serveur).
 *
 * Raison d'être : sans elles, l'assistant répondait comme s'il parlait à un
 * développeur — UUID des tâches, `user_id` des membres, noms d'outils, champs
 * bruts. L'utilisateur de Lume est un entrepreneur en services ; il doit
 * recevoir des phrases, des noms et des montants en dollars, jamais la
 * plomberie. Les identifiants restent DANS les résultats d'outils parce que
 * les appels suivants en ont besoin (assigner un job, lire un fil SMS) —
 * c'est leur seul usage.
 */
const SERVER_INSTRUCTIONS = `Tu es branché sur Lume, le CRM d'une entreprise de services. Tu parles à son propriétaire ou à un membre de son équipe — jamais à un développeur.

RÈGLES DE PRÉSENTATION (importantes) :
- Réponds comme un collègue humain, dans la langue de l'utilisateur. Des phrases, pas des dumps de données.
- N'affiche JAMAIS d'identifiant technique : UUID, id, user_id, client_id, job_id… Ce sont des rouages internes réservés à tes propres appels d'outils (assigner, relire, modifier). Pour désigner quelqu'un ou quelque chose : son nom, son numéro de job, son titre.
- Ne mentionne jamais les noms d'outils, de champs (display_status, raw_status…) ni le vocabulaire base de données. Traduis : « Late » = en retard, « upcoming » = à venir, « draft » = brouillon, « open » = à faire.
- Les montants arrivent en cents : affiche-les en dollars canadiens (12500 → 125,00 $). C'est du CAD ; ne convertis jamais dans une autre devise.
- Les dates et heures sont dans le fuseau de l'entreprise, l'Est (America/Montreal). Présente-les dans ce fuseau — « mardi 9 h », pas une heure UTC ni un horodatage brut. Ne décale jamais un rendez-vous d'un fuseau à l'autre.
- Ne liste pas d'options ou de personnes que l'utilisateur n'a pas demandées. Exception : une vraie ambiguïté à trancher (deux clients du même nom) — pose alors la question simplement, sans étaler les fiches.
- Va à l'essentiel : si on demande le chiffre d'affaires, donne le chiffre et une phrase de contexte, pas un rapport.
- Les rôles et statuts aussi en mots de tous les jours : « owner » = propriétaire, « in_progress » = en cours.
- Quand une liste porte un champ total_matching, c'est le VRAI total : annonce-le (« tu en as 22, voici les 15 plus récents »), ne dis jamais « il y en a peut-être plus ».

LE CALENDRIER : l'horaire Lume (les visites de jobs) EST l'agenda de l'utilisateur — c'est là que vit sa journée de travail. Ne dis jamais qu'il « n'a pas d'agenda branché », et ne suggère un calendrier externe que s'il parle d'événements qui ne sont pas des jobs (rendez-vous personnels, réunions).

RÉFLEXES D'ASSISTANT :
- « Mon brief », « ma journée », « quoi de neuf » → get_morning_briefing, et présente-le comme un collègue qui ouvre la journée : l'urgent d'abord, en trois ou quatre phrases.
- Avant un appel ou une visite client, ou sur « parle-moi de X » → get_client_profile : l'historique, ce qu'il doit, le dernier échange.
- Quand l'utilisateur dit « retiens que… », « à l'avenir… », « n'oublie pas que… » → remember_this. En début de sujet pertinent, consulte recall_notes pour honorer ses préférences.
- « Qu'est-ce que tu as fait récemment ? » → get_recent_agent_actions.
- « Relance mes impayés / mes retards » → get_overdue_payments pour la liste, PROPOSE un message personnalisé par client (montant dû, jours de retard, ton courtois), montre-les TOUS, et n'appelle send_payment_reminders qu'après un OUI clair. Rappelle que les automatisations couvrent déjà les relances standards — celle-ci est ta relance sur mesure, maintenant.

MÊME QUAND ÇA ÉCHOUE, TU RESTES UN COLLÈGUE — c'est là que le naturel se perd :
- Un outil qui échoue, un droit qui manque, une capacité absente : dis simplement ce qui n'a pas marché et ce que tu proposes (« je n'arrive pas à sortir tes chiffres de factures — reconnecte Lume dans tes réglages et je te les donne »). N'expose JAMAIS de noms d'outils, de signatures, de champs, de messages d'erreur bruts ni de raisonnement sur le schéma — même pour expliquer un problème.
- Ne parle pas de la mécanique (outils, base de données, MCP, session, colonnes) sauf si l'utilisateur demande EXPLICITEMENT le détail technique. « Comment ça se fait que ça marche pas ? » appelle une explication d'exploitant, pas un diagnostic de développeur.
- Si une action semble impossible, ne déduis pas des limites à voix haute à partir des signatures d'outils : dis ce que tu peux faire à la place, et propose le geste dans Lume s'il en faut un.

RÈGLES D'ACTION :
- Avant TOUT envoi (send_sms, send_quote, send_invoice) : montre le contenu exact et le destinataire, attends un OUI explicite. Un envoi ne se rattrape pas.
- Les factures que tu crées restent des brouillons — dis-le à l'utilisateur : rien ne part chez son client.
- Si un outil échoue ou qu'un droit manque, explique-le en une phrase simple, sans jargon.

SIGNAUX DISCRETS DANS LES RÉSULTATS (réagis-y en collègue, sans les nommer) :
- « session_a_reconnecter » ou « note_session » : la connexion à Lume a expiré. Donne quand même la réponse (elle est bonne), puis glisse UNE fois, en fin de message, un rappel léger : « reconnecte Lume dans tes réglages quand tu as deux minutes, ça garde tout à jour ». N'y reviens pas à chaque réponse.
- « deja_fait » : tu avais déjà fait exactement ça il y a peu. Ne le refais pas ; rappelle simplement que c'est déjà en place (« c'est déjà fait — le job est là »), sans parler de doublon ni de mécanique.
- « incomplet » sur un job : le job EST créé mais il manque un morceau (articles, total ou position sur la carte). Ne le recrée SURTOUT pas. Dis ce qui est fait et ce qui reste (« le job est créé, mais je n'ai pas pu poser les articles — veux-tu les ajouter ? »).
- « address_warning » : l'adresse manque de ville/code postal, la carte peut mal la placer. Demande la ville avant de considérer le repérage fiable.
- Un montant à « null » avec « montants_masques » : cette personne n'a pas accès aux chiffres dans Lume. Ne devine pas, ne recalcule pas — dis simplement que les montants ne sont pas dans son accès.`;

/** Tout ce qui est exécutable, lecture et écriture confondues. */
const MCP_TOOLS: AgentTool[] = AGENT_TOOLS.filter((t) => typeof t.handler === 'function');

/**
 * Les outils que CET appelant peut voir et appeler.
 * Un outil invisible ici est aussi inappelable plus bas — même filtre.
 *   • écriture  → jeton OAuth portant `mcp:write` (jamais en mode clé :
 *     une clé d'org n'a pas d'identité, donc pas d'audit nominatif).
 *   • needsIdentity → session OAuth uniquement (paie, finances, GPS…).
 */
function outilsPour(auth: McpAuth): AgentTool[] {
  const peutEcrire = auth.mode === 'oauth' && auth.scopes.includes(SCOPE_MCP_WRITE);
  const aIdentite = auth.mode === 'oauth';
  return MCP_TOOLS.filter((t) => {
    if (t.kind === 'write' && !peutEcrire) return false;
    if (t.needsIdentity && !aIdentite) return false;
    return true;
  });
}

/* ── Montants selon le rôle ──────────────────────────────────────
   L'application masque les montants à certains rôles (écran des rôles,
   fonction `membre_voit_les_montants`, vue jobs_pour_role). L'agent
   doit obéir à LA MÊME règle — sinon un technicien d'une org cliente
   verrait via Claude les prix que l'écran lui cache.

   Application au CENTRE, pas outil par outil : une seule porte, et tout
   outil futur est couvert d'office.
   • Outils PUREMENT financiers → refus clair, en langage d'exploitant.
   • Tous les autres → les champs de montants (…_cents, …_pct financiers)
     sont blanchis dans la réponse, avec une note qui l'explique.
   • Clé d'API : identifiant créé par un admin de l'org — visibilité
     complète, comme depuis toujours.                                   */

/* ── Matrice de permissions de l'app, appliquée aux outils ─────────
   Les montants (ci-dessous) ne sont qu'UNE ligne de l'écran des rôles.
   Le reste — SMS, GPS, feuilles de temps, clients, jobs… — doit obéir
   pareil : la décision vient de getUserContext/hasPermission (rbac.ts),
   la MÊME mécanique que les routes de l'application (propriétaire
   toujours oui, technicien jamais financier, réglages de l'org par-
   dessus). Un outil sans entrée ici est ouvert à tout membre.          */
const PERMISSION_PAR_OUTIL: Record<string, { cle: string; capacite: string }> = {
  search_clients:            { cle: 'clients.read',       capacite: 'la consultation des clients' },
  get_client_profile:        { cle: 'clients.read',       capacite: 'la consultation des clients' },
  create_client:             { cle: 'clients.create',     capacite: 'la création de clients' },
  update_client:             { cle: 'clients.update',     capacite: 'la modification des clients' },
  search_leads:              { cle: 'leads.read',         capacite: 'la consultation des prospects' },
  list_request_submissions:  { cle: 'leads.read',         capacite: 'la consultation des demandes entrantes' },
  list_jobs:                 { cle: 'jobs.read',          capacite: 'la consultation des jobs' },
  get_job:                   { cle: 'jobs.read',          capacite: 'la consultation des jobs' },
  query_schedule:            { cle: 'jobs.read',          capacite: "la consultation de l'horaire" },
  find_dates_in_location:    { cle: 'jobs.read',          capacite: "la consultation de l'horaire" },
  get_day_route:             { cle: 'jobs.read',          capacite: "la consultation de l'horaire" },
  get_morning_briefing:      { cle: 'jobs.read',          capacite: 'le survol de la journée' },
  create_job:                { cle: 'jobs.create',        capacite: 'la création de jobs' },
  update_job_status:         { cle: 'jobs.update',        capacite: 'la modification des jobs' },
  update_job:                { cle: 'jobs.update',        capacite: 'la modification des jobs' },
  archive_job:               { cle: 'jobs.update',        capacite: "l'archivage des jobs" },
  assign_job:                { cle: 'jobs.assign',        capacite: "l'assignation des jobs" },
  reschedule_job:            { cle: 'calendar.update',    capacite: 'la replanification du calendrier' },
  get_conversations:         { cle: 'messages.read',      capacite: 'la lecture des SMS' },
  get_conversation_messages: { cle: 'messages.read',      capacite: 'la lecture des SMS' },
  send_sms:                  { cle: 'messages.send',      capacite: "l'envoi de SMS" },
  send_payment_reminders:    { cle: 'messages.send',      capacite: "l'envoi de rappels de paiement" },
  get_timesheets:            { cle: 'timesheets.read',    capacite: 'la consultation des feuilles de temps' },
  get_team:                  { cle: 'team.read',          capacite: "la consultation de l'équipe" },
  get_team_locations:        { cle: 'gps.read',           capacite: 'la localisation de l\u2019équipe' },
  get_d2d_stats:             { cle: 'door_to_door.access', capacite: 'les statistiques terrain' },
  list_automations:          { cle: 'automations.read',   capacite: 'la consultation des automatisations' },
  get_payroll_summary:       { cle: 'financial.view_reports', capacite: 'la paie' },
  list_quotes:               { cle: 'quotes.read',        capacite: 'la consultation des devis' },
  create_quote:              { cle: 'quotes.create',      capacite: 'la création de devis' },
  send_quote:                { cle: 'quotes.send',        capacite: "l'envoi de devis" },
  list_invoices:             { cle: 'invoices.read',      capacite: 'la consultation des factures' },
  create_invoice:            { cle: 'invoices.create',    capacite: 'la création de factures' },
  create_invoice_from_job:   { cle: 'invoices.create',    capacite: 'la création de factures' },
  send_invoice:              { cle: 'invoices.send',      capacite: "l'envoi de factures" },
  convert_quote_to_job:      { cle: 'quotes.approve',     capacite: 'la conversion des devis' },
  convert_lead_to_client:    { cle: 'leads.update',       capacite: 'la conversion des prospects' },
  add_visit:                 { cle: 'calendar.update',    capacite: 'la planification du calendrier' },
  // Suivi léger (tâches, notes) : rattaché au dossier job/client. On exige au
  // moins la LECTURE des jobs — clé que tout rôle opérationnel possède (owner,
  // admin, sales_rep, technician). But : donner un garde explicite plutôt que
  // « ouvert à tout membre », SANS bloquer les rôles standards. Ne pas mapper
  // sur jobs.update (les sales_rep ne l'ont pas) ni clients.update (pas les
  // technicians) : ça casserait un usage courant.
  list_tasks:                { cle: 'jobs.read',          capacite: 'la consultation des tâches' },
  create_task:               { cle: 'jobs.read',          capacite: 'la création de tâches' },
  update_task_status:        { cle: 'jobs.read',          capacite: 'la mise à jour des tâches' },
  add_note:                  { cle: 'jobs.read',          capacite: "l'ajout de notes" },
  // Agrégats financiers : permission dédiée, comme la paie.
  get_financial_overview:    { cle: 'financial.view_reports', capacite: 'la vue financière' },
  get_revenue_summary:       { cle: 'financial.view_reports', capacite: 'le résumé des revenus' },
  get_overdue_payments:      { cle: 'financial.view_invoices', capacite: 'les paiements en retard' },
};

const OUTILS_FINANCIERS = new Set([
  'get_revenue_summary', 'get_financial_overview', 'get_overdue_payments',
  'list_invoices', 'create_invoice', 'create_invoice_from_job',
  'send_invoice', 'create_quote', 'send_quote', 'list_quotes',
]);

// Champs à blanchir pour un membre sans droit aux montants. On couvre les
// suffixes techniques (_cents, _amount…) ET des noms financiers SANS AMBIGUÏTÉ
// même sans suffixe — filet contre un futur champ mal nommé qui, autrement,
// fuirait faute de finir par `_cents`. On EXCLUT volontairement les mots
// polysémiques comme `total` ou `count` : ce sont souvent des compteurs
// (nombre de jobs, de devis…), pas des montants — les blanchir casserait
// l'affichage. Seuls des noms non ambigus figurent ici.
const CLES_MONTANTS = /(_cents|_amount|_price|margin_pct|goal_progress_pct)$|^(revenue|solde|mrr|arr|ltv|lifetime_value|commission|payout)$/i;

async function montantsVisibles(auth: McpAuth): Promise<boolean> {
  if (auth.mode === 'api_key') return true;
  if (!auth.userId) return false;
  try {
    // La fonction de l'app, telle quelle — SECURITY DEFINER, elle porte la
    // règle complète (rôles à droit d'office + réglage explicite de l'org).
    // p_user vient de la ligne du jeton, jamais de la requête.
    const { data, error } = await getServiceClient()
      .rpc('membre_voit_les_montants', { p_user: auth.userId, p_org: auth.orgId });
    if (error) throw error;
    return data === true;
  } catch (e: any) {
    console.error('[mcp] visibilité des montants indéterminable :', e?.message || e);
    return false; // la philosophie de la fonction : jamais exposer par défaut
  }
}

/** Blanchit récursivement les champs de montants d'un résultat d'outil. */
function masquerMontants(v: any): any {
  if (Array.isArray(v)) return v.map(masquerMontants);
  if (v && typeof v === 'object') {
    const sortie: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) {
      sortie[k] = CLES_MONTANTS.test(k) ? null : masquerMontants(val);
    }
    return sortie;
  }
  return v;
}

/** Gemini FunctionDeclaration → MCP tool descriptor. */
function toMcpTool(tool: AgentTool) {
  return {
    name: tool.declaration.name,
    description: tool.declaration.description,
    inputSchema: tool.declaration.parameters ?? { type: 'object', properties: {} },
  };
}

// ── JSON-RPC helpers ──
type JsonRpcId = string | number | null;

function rpcResult(id: JsonRpcId, result: any) {
  return { jsonrpc: '2.0' as const, id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: '2.0' as const, id, error: { code, message } };
}

// ── Auth ──
// Deux modes coexistent, par ordre de préférence :
//   • OAuth Bearer  → le jeton porte un user_id : RLS redevient actif.
//   • Clé X-API-Key → identifiant partagé par l'org, RLS inactif.
// La clé reste acceptée pour ne rien casser chez ceux qui l'utilisent
// déjà, mais OAuth est le chemin recommandé (et le seul qui pourra
// un jour porter des écritures).
interface McpAuth {
  orgId: string;
  /** Présent en OAuth uniquement — permet un client RLS et un audit nominatif. */
  userId?: string;
  /** Identifiant de la clé (mode clé) ou du jeton (mode OAuth). */
  credentialId: string;
  mode: 'oauth' | 'api_key';
  /** Scopes du jeton OAuth (vide en mode clé). */
  scopes: string[];
}

/**
 * En-tête exigé par la spec MCP sur un 401 : c'est LUI qui déclenche
 * la découverte OAuth côté client. Sans cet en-tête, Claude ne sait
 * pas où trouver le serveur d'autorisation et ne propose jamais de
 * se connecter.
 */
function challengeHeader(): string {
  let metadata: string;
  try {
    metadata = `${baseUrl()}/.well-known/oauth-protected-resource`;
  } catch {
    // PUBLIC_BASE_URL absent : on ne peut pas annoncer d'URL correcte.
    return `Bearer scope="${SCOPE_MCP_READ}"`;
  }
  return `Bearer resource_metadata="${metadata}", scope="${SCOPE_MCP_READ} ${SCOPE_MCP_WRITE}"`;
}

/**
 * Authentifie l'appelant (OAuth Bearer ou clé d'API).
 * Répond et renvoie null en cas d'échec.
 */
async function authenticate(req: any, res: any): Promise<McpAuth | null> {
  // ── 1. OAuth Bearer (préféré) ──
  const authz = (req.headers['authorization'] as string | undefined)?.trim();
  if (authz && /^Bearer\s+/i.test(authz)) {
    const token = authz.replace(/^Bearer\s+/i, '').trim();
    const validated = await validateAccessToken(token, canonicalResource());
    if (!validated) {
      logSecurityEvent({
        event_type: 'mcp_oauth_token_invalid',
        severity: 'medium',
        source: 'api',
        ip_address: extractIP(req),
        details: { reason: 'invalide, expiré, révoqué ou audience incorrecte' },
      });
      res.setHeader('WWW-Authenticate', challengeHeader());
      res.status(401).json({ error: 'Invalid or expired access token.' });
      return null;
    }
    if (!validated.scopes.includes(SCOPE_MCP_READ)) {
      res.setHeader(
        'WWW-Authenticate',
        `Bearer error="insufficient_scope", scope="${SCOPE_MCP_READ}"`,
      );
      res.status(403).json({ error: 'insufficient_scope' });
      return null;
    }
    return {
      orgId: validated.orgId,
      userId: validated.userId,
      credentialId: validated.tokenId,
      mode: 'oauth',
      scopes: validated.scopes,
    };
  }

  // ── 2. Clé d'API (rétrocompatibilité) ──
  const raw = (req.headers['x-api-key'] as string | undefined)?.trim();
  if (!raw) {
    // Aucune preuve d'identité : c'est ici que le parcours OAuth démarre.
    res.setHeader('WWW-Authenticate', challengeHeader());
    res.status(401).json({ error: 'Authorization required.' });
    return null;
  }

  const key = await validateApiKey(raw);
  if (!key) {
    logSecurityEvent({
      event_type: 'mcp_auth_failed',
      severity: 'medium',
      source: 'api',
      ip_address: extractIP(req),
      details: { key_prefix: raw.slice(0, 12) },
    });
    res.setHeader('WWW-Authenticate', challengeHeader());
    res.status(401).json({ error: 'Invalid, expired or revoked API key.' });
    return null;
  }

  const scopes = key.scopes || [];
  if (!scopes.includes(REQUIRED_SCOPE) && !scopes.includes('*')) {
    logSecurityEvent({
      org_id: key.orgId,
      event_type: 'api_key_scope_denied',
      severity: 'medium',
      source: 'api',
      ip_address: extractIP(req),
      details: { key_id: key.keyId, required: [REQUIRED_SCOPE], granted: scopes, surface: 'mcp' },
    });
    res.status(403).json({ error: `This key lacks the "${REQUIRED_SCOPE}" scope.` });
    return null;
  }

  return { orgId: key.orgId, credentialId: key.keyId, mode: 'api_key', scopes: [] };
}

/**
 * Supabase client used to run tool handlers for an API-key caller.
 *
 * An API key is not tied to a live Supabase session, so there is no user JWT
 * to build an RLS-scoped client from (buildSupabaseWithAuth needs one). We use
 * the service client and rely on the explicit `.eq('org_id', ctx.orgId)` that
 * every read handler already applies, with orgId taken from the key row itself
 * — never from the request body.
 *
 * This trades RLS's second barrier for the handlers' own filter. It is the
 * reason this surface stays read-only: a leak here exposes data, whereas the
 * same gap on a write path would corrupt it. Tests must cover org isolation
 * with two keys from two orgs.
 */
function buildToolClient(): SupabaseClient {
  return getServiceClient();
}

// ═══════════════════════════════════════════════════════════════
// GET /api/mcp/info — what the settings page shows (session auth)
// ═══════════════════════════════════════════════════════════════

router.get('/info', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const base = (process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || '').trim().replace(/\/$/, '');
    return res.json({
      enabled: MCP_TOOLS.length > 0,
      url: `${base}/api/mcp`,
      tools: MCP_TOOLS.map((t) => ({
        name: t.declaration.name,
        description: t.declaration.description,
      })),
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to load MCP info.', '[mcp/info]');
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/mcp — JSON-RPC 2.0 endpoint (API-key auth)
// ═══════════════════════════════════════════════════════════════

router.post('/', async (req, res) => {
  const auth = await authenticate(req, res);
  if (!auth) return;

  const body = req.body || {};
  const id: JsonRpcId = body.id ?? null;
  const method = String(body.method || '');

  try {
    // ── initialize ──
    if (method === 'initialize') {
      return res.json(
        rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: SERVER_INSTRUCTIONS,
        }),
      );
    }

    // ── notifications (no response body per JSON-RPC) ──
    if (method.startsWith('notifications/')) {
      return res.status(202).end();
    }

    // ── ping ──
    if (method === 'ping') {
      return res.json(rpcResult(id, {}));
    }

    // ── tools/list ──
    if (method === 'tools/list') {
      return res.json(rpcResult(id, { tools: outilsPour(auth).map(toMcpTool) }));
    }

    // ── tools/call ──
    if (method === 'tools/call') {
      const name = String(body.params?.name || '');
      const args = (body.params?.arguments || {}) as Record<string, any>;
      const tool = TOOLS_BY_NAME[name];

      // Inconnu, sans handler, ou hors des droits de CET appelant (scope
      // d'écriture absent, identité absente) : refus identique — un outil
      // que la liste ne montre pas ne doit pas non plus s'appeler.
      const autorises = outilsPour(auth);
      if (!tool || typeof tool.handler !== 'function' || !autorises.includes(tool)) {
        return res.json(rpcError(id, -32602, `Unknown or unavailable tool: ${name}`));
      }

      // La MATRICE de permissions de l'app, d'abord : si le rôle de la
      // personne n'inclut pas cette capacité, refus en mots simples —
      // clé d'API exclue (identifiant d'admin, accès complet).
      const regle = PERMISSION_PAR_OUTIL[name];
      if (regle && auth.mode === 'oauth' && auth.userId) {
        const ctxRole = await getUserContext(getServiceClient(), auth.userId, auth.orgId);
        if (!ctxRole || !hasPermission(ctxRole, regle.cle)) {
          return res.json(rpcResult(id, {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: `Les accès Lume de cette personne n'incluent pas ${regle.capacite} `
                  + '(réglage de l\u2019écran des rôles de son entreprise). Dis-le-lui simplement, '
                  + 'et suggère de voir l\u2019administrateur si ce droit devrait changer.',
              }),
            }],
            isError: true,
          }));
        }
      }

      // Les montants suivent le RÔLE de la personne — la même règle que
      // l'écran des rôles de l'application, décidée par sa propre fonction.
      const voitLesMontants = await montantsVisibles(auth);
      if (!voitLesMontants && OUTILS_FINANCIERS.has(name)) {
        return res.json(rpcResult(id, {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'Les accès Lume de cette personne ne couvrent pas les montants et la facturation '
                + '(réglage de l\u2019écran des rôles de son entreprise). Dis-le-lui simplement — sans jargon — '
                + 'et suggère de voir l\u2019administrateur si ce droit devrait changer.',
            }),
          }],
          isError: true,
        }));
      }

      // En OAuth, on interroge la base À L'IDENTITÉ du porteur : RLS
      // redevient actif et les RPC `SECURITY DEFINER` qui vérifient
      // `has_org_membership(auth.uid(), org)` acceptent enfin l'appel.
      //
      // Pour un outil `needsIdentity` (paie, finances, GPS, TOUTE écriture),
      // AUCUN repli : sans session rejouable, on refuse avec une consigne
      // claire plutôt que de contourner les permissions par rôle. Les
      // lectures simples, elles, gardent le repli service (org_id explicite).
      let clientOutil: SupabaseClient;
      let jetonUtilisateur: string | undefined;
      // Vrai quand une lecture retombe sur le service client faute de session
      // rejouable : la donnée reste filtrée par org_id (sûre) mais RLS est
      // contourné et l'utilisateur devrait se reconnecter. On le SIGNALE.
      let sessionDegradee = false;
      if (auth.mode === 'oauth') {
        const sessionUtilisateur = await buildUserScopedClient(auth.credentialId);
        const clientUtilisateur = sessionUtilisateur?.client ?? null;
        jetonUtilisateur = sessionUtilisateur?.accessToken;
        if (!clientUtilisateur && tool.needsIdentity) {
          return res.json(rpcResult(id, {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'Cette action exige votre identité et votre session Lume n’est plus rejouable. '
                  + 'Reconnectez le connecteur Lume dans Claude (Réglages › Connecteurs), puis réessayez.',
              }),
            }],
            isError: true,
          }));
        }
        clientOutil = clientUtilisateur ?? buildToolClient();
        sessionDegradee = !clientUtilisateur; // lecture servie sans identité
      } else {
        clientOutil = buildToolClient();
      }

      const result = await tool.handler(args, {
        client: clientOutil,
        orgId: auth.orgId,
        // En OAuth, l'identité réelle du porteur ; en clé d'API, l'identifiant
        // de la clé (aucun humain derrière). L'audit sait ainsi qui a demandé.
        userId: auth.userId ?? auth.credentialId,
        accessToken: jetonUtilisateur,
      });

      // Masquage central : si la personne ne voit pas les montants dans
      // l'app, elle ne les voit pas non plus ici — champ par champ, avec
      // une note pour que l'assistant l'explique au lieu d'inventer.
      let resultatFinal: any = voitLesMontants
        ? result
        : {
            ...masquerMontants(result),
            montants_masques: true,
            note_montants: 'Les montants sont masqués : le rôle de cette personne dans Lume ne les inclut pas. Ne pas les estimer ni les déduire.',
          };

      // Session dégradée : la lecture a réussi mais sans l'identité du porteur
      // (session Lume expirée). On invite à reconnecter, une fois, discrètement,
      // sans bloquer le résultat déjà obtenu.
      if (sessionDegradee && resultatFinal && typeof resultatFinal === 'object' && !Array.isArray(resultatFinal)) {
        resultatFinal = {
          ...resultatFinal,
          session_a_reconnecter: true,
          note_session: 'Ces données sont à jour, mais votre session Lume a expiré. Pour les actions personnalisées (finances, écritures), reconnectez le connecteur Lume dans Claude quand vous aurez un moment.',
        };
      }

      // MCP returns tool output as content parts; JSON goes in a text part.
      return res.json(
        rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(resultatFinal) }],
          isError: Boolean((resultatFinal as any)?.error),
        }),
      );
    }

    return res.json(rpcError(id, -32601, `Method not found: ${method}`));
  } catch (err: any) {
    // Never surface raw errors to an MCP client (they can leak schema details).
    console.error('[mcp]', err?.message || err);
    return res.json(rpcError(id, -32603, 'Internal error.'));
  }
});

export default router;
