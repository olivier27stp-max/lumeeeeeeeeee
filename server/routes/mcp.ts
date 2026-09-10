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
import type { PermissionKey } from '../../src/lib/permissions';
import type { SupabaseClient } from '@supabase/supabase-js';
import { validateApiKey } from '../lib/api-keys';
import { getServiceClient, requireAuthedClient } from '../lib/supabase';
import { logSecurityEvent, extractIP } from '../lib/security';
import { sendSafeError } from '../lib/error-handler';
import { AGENT_TOOLS, TOOLS_BY_NAME, type AgentTool } from '../lib/agent/tools';
import { masquerIds, demasquerIds } from '../lib/agent/refs';
import { validateAccessToken, canonicalResource, baseUrl, SCOPE_MCP_READ, SCOPE_MCP_WRITE, buildUserScopedClient } from '../lib/oauth';
import { getUserContext, hasPermission } from '../lib/rbac';
import { PERMISSION_PAR_OUTIL, OUTILS_FINANCIERS, masquerMontants, membreVoitLesMontants } from '../lib/agent/garde';
import { CONSIGNES_COLLEGUE, CONSIGNE_SESSION_MCP } from '../lib/agent/consignesCollegue';

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

${CONSIGNES_COLLEGUE.replace('SIGNAUX DISCRETS DANS LES RÉSULTATS (réagis-y en collègue, sans les nommer) :\n', `SIGNAUX DISCRETS DANS LES RÉSULTATS (réagis-y en collègue, sans les nommer) :\n${CONSIGNE_SESSION_MCP}\n`)}`;

/** Tout ce qui est exécutable, lecture et écriture confondues. */
const MCP_TOOLS: AgentTool[] = AGENT_TOOLS.filter((t) => typeof t.handler === 'function' && t.canal !== 'lumi');

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
async function montantsVisibles(auth: McpAuth): Promise<boolean> {
  if (auth.mode === 'api_key') return true;
  return membreVoitLesMontants(auth.userId, auth.orgId);
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

      // Réfs opaques : l'espace de correspondance est propre à (org, porteur).
      const espaceRefs = `${auth.orgId}:${auth.userId ?? auth.credentialId}`;
      // ENTRÉE : une réf courte que l'agent nous renvoie (c1, j3…) redevient
      // l'UUID réel avant d'agir. Un vrai UUID passe tel quel (rien ne casse).
      const argsReels = demasquerIds(espaceRefs, args);

      const result = await tool.handler(argsReels, {
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

      // Un échec d'outil : on trace AVEC le contexte (org, utilisateur, outil)
      // — sans ça, le diagnostic prod savait « quel outil » mais jamais « quelle
      // org ni qui », donc impossible de cibler par tenant.
      if ((resultatFinal as any)?.error) {
        console.error('[mcp:tool-error]',
          `outil=${name} org=${auth.orgId} user=${auth.userId ?? auth.credentialId} :`,
          String((resultatFinal as any).error).slice(0, 160));
      }

      // SORTIE : dernier filtre, tout UUID devient une réf courte (c1, j3…).
      // Un seul point de passage → aucun outil ne peut faire fuir un id, ni
      // aujourd'hui ni demain. L'agent ne verra jamais d'UUID.
      const resultatSansIds = masquerIds(espaceRefs, resultatFinal);

      // MCP returns tool output as content parts; JSON goes in a text part.
      return res.json(
        rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(resultatSansIds) }],
          isError: Boolean((resultatFinal as any)?.error),
        }),
      );
    }

    return res.json(rpcError(id, -32601, `Method not found: ${method}`));
  } catch (err: any) {
    // Never surface raw errors to an MCP client (they can leak schema details).
    // On loggue AVEC le contexte pour diagnostiquer sans reproduire.
    console.error('[mcp]', `method=${method} :`, err?.message || err);
    return res.json(rpcError(id, -32603, 'Internal error.'));
  }
});

export default router;
