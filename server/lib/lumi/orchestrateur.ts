/* ═══════════════════════════════════════════════════════════════
   Lumi — orchestrateur Claude (agent IA dans l'application)
   ─────────────────────────────────────────────────────────────
   Boucle d'appels d'outils sur l'API Anthropic, en streaming :
   - les outils de LECTURE s'exécutent (avec les gardes communes au MCP :
     permission de la page Rôles, montants masqués selon le rôle) et leurs
     résultats repartent au modèle ;
   - un outil d'ÉCRITURE n'est JAMAIS exécuté ici : il devient une
     PROPOSITION, l'utilisateur confirme dans l'interface, et c'est
     POST /api/lumi/execute qui l'exécute — puis le modèle reprend.

   Le prompt système et les définitions d'outils sont mis en cache
   (cache_control) : c'est ce qui divise le coût par trois. Toute variation
   d'un appel à l'autre (date, nom) est repoussée APRÈS le point de cache.
   Cache d'UNE HEURE (ttl 1h) : avec les 5 minutes par défaut, chaque reprise
   de conversation après une pause réécrivait ~4 000 tokens à 125 % du tarif
   (2,6 ¢ sur les 6 ¢ d'un tour). L'écriture 1h coûte 2× le tarif d'entrée
   au lieu de 1,25×, mais elle ne se répète plus de toute l'heure.

   Outils différés (tool search) : mesuré le 2026-09-10, les 67 définitions
   pesaient 13 128 tokens sur un contexte fixe de 17 336 — relus à CHAQUE
   appel, et réécrits en cache toutes les heures. Seuls les outils du
   quotidien (OUTILS_DE_BASE) restent chargés ; les autres portent
   `defer_loading: true` et n'entrent dans le contexte que lorsque le modèle
   les découvre via `tool_search_tool_regex` (recherche côté API, gratuite,
   qui ajoute la définition APRÈS le préfixe : le cache tient). Le modèle
   les cherche par mot-clé anglais (nom, description, arguments) ; le prompt
   lui dit quelles familles existent.
   ═══════════════════════════════════════════════════════════════ */
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AGENT_TOOLS, TOOLS_BY_NAME } from '../agent/tools';
import { executerOutilGarde, PERMISSION_PAR_OUTIL } from '../agent/garde';
import { masquerIds, demasquerIds } from '../agent/refs';
import { buildSystemPrompt } from '../agent/systemPrompt';
import { CONSIGNES_COLLEGUE } from '../agent/consignesCollegue';
import type { Rapport } from '../agent/tools-rapports';
import { coutEnCents, modeleLumi, type UsageTokens } from './tarifs';
import { fichesDuResultat, apercuProposition, type Fiche, type Apercu } from './fiches';

const MAX_ETAPES = 8;
const MAX_TOKENS = 4096;
/** Point de cache d'une heure (voir l'en-tête). Même objet partout : un seul endroit à changer. */
const CACHE_1H: Anthropic.Messages.CacheControlEphemeral = { type: 'ephemeral', ttl: '1h' };
/** Point de cache 5 min pour la CONVERSATION (les appels d'un tour sont à quelques secondes, les tours à quelques minutes). */
const CACHE_5M: Anthropic.Messages.CacheControlEphemeral = { type: 'ephemeral' };

/**
 * Historique avec un point de cache GLISSANT sur le dernier message : sans
 * lui, toute la conversation (messages, résultats d'outils) était relue au
 * plein tarif à CHAQUE appel — mesuré au 5e tour : 2 663 + 2 977 tokens, les
 * deux tiers du coût du tour. Avec, le préfixe déjà vu est lu au dixième du
 * prix et seul le nouveau contenu est écrit (une fois).
 *
 * Copie superficielle du dernier message seulement : l'historique stocké en
 * base ne doit JAMAIS porter cache_control (rejoué tel quel, on dépasserait
 * les 4 points de cache autorisés → 400). Un TTL de 5 min peut suivre les
 * points 1 h des outils/prompt (l'inverse est refusé par l'API).
 */
export function avecCacheConversation(messages: Anthropic.Messages.MessageParam[]): Anthropic.Messages.MessageParam[] {
  if (messages.length === 0) return messages;
  const dernier = messages[messages.length - 1];
  const blocs: Anthropic.Messages.ContentBlockParam[] = typeof dernier.content === 'string'
    ? [{ type: 'text', text: dernier.content }]
    : dernier.content.map((b) => ({ ...b }));
  if (blocs.length === 0) return messages;
  const cible = blocs[blocs.length - 1];
  // Les blocs de réflexion ne peuvent pas porter de point de cache.
  if (cible.type === 'thinking' || cible.type === 'redacted_thinking') return messages;
  (cible as { cache_control?: Anthropic.Messages.CacheControlEphemeral }).cache_control = CACHE_5M;
  return [...messages.slice(0, -1), { role: dernier.role, content: blocs }];
}

let clientAnthropic: Anthropic | null = null;
export function isLumiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.ANTHROPIC_API_KEY;
}
function anthropic(): Anthropic {
  if (!clientAnthropic) clientAnthropic = new Anthropic();
  return clientAnthropic;
}

/**
 * Outils TOUJOURS chargés : ceux du quotidien d'un patron de PME (chercher,
 * compter, regarder l'agenda, les retards, créer un suivi). Tout le reste est
 * différé et découvert à la demande. Ajouter ici un outil coûte ~200 tokens
 * par appel pour TOUTES les orgs : ne le faire que si l'usage réel le justifie.
 */
export const OUTILS_DE_BASE: ReadonlySet<string> = new Set([
  'search_clients', 'search_leads', 'get_client_profile',
  'list_jobs', 'get_job', 'query_schedule',
  'list_invoices', 'get_overdue_payments', 'list_quotes',
  'create_task', 'list_tasks',
  'get_company_info', 'recall_notes',
]);

export const OUTIL_RECHERCHE: Anthropic.Messages.ToolSearchToolRegex20251119 = {
  type: 'tool_search_tool_regex_20251119',
  name: 'tool_search_tool_regex',
};

/**
 * Définitions d'outils au format Claude — ordre stable, sinon le cache saute.
 * [recherche, outils de base (le dernier porte le point de cache), outils différés].
 * Un outil différé ne peut pas porter cache_control (400 de l'API).
 */
export function outilsClaude(): Anthropic.Messages.ToolUnion[] {
  const defs: Anthropic.Messages.Tool[] = AGENT_TOOLS.map((t) => ({
    name: t.declaration.name,
    description: t.declaration.description,
    input_schema: (t.declaration.parameters ?? { type: 'object', properties: {} }) as Anthropic.Messages.Tool['input_schema'],
  }));
  const base = defs.filter((d) => OUTILS_DE_BASE.has(d.name));
  const differes = defs.filter((d) => !OUTILS_DE_BASE.has(d.name)).map((d) => ({ ...d, defer_loading: true }));
  const dernier = base[base.length - 1];
  if (dernier) dernier.cache_control = CACHE_1H;
  return [OUTIL_RECHERCHE, ...base, ...differes];
}

/** Prompt système Lumi : le prompt de l'agent, au nom de Lumi, partie stable en cache. */
export function promptSystemeLumi(ctx: { companyName: string | null; userName: string | null; language: 'fr' | 'en'; todayIso: string }): Anthropic.Messages.TextBlockParam[] {
  // Partie STABLE (sans date ni nom) → cache. La partie variable suit.
  const stable = buildSystemPrompt({ companyName: ctx.companyName, userName: null, language: ctx.language, todayIso: 'DATE' })
    .replace('**Lume Agent**', '**Lumi**')
    .replace(' Today is DATE.', '')
    .replace(
      'WRITE actions — create_quote, create_invoice, create_job, send_sms — are PROPOSALS only.',
      'WRITE actions (anything that creates, changes, sends or deletes something) are PROPOSALS only.',
    )
    // Les mêmes consignes « collègue » que le MCP : jamais d'identifiant, de
    // nom d'outil, de champ ou de vocabulaire base de données dans une réponse.
    + `\n\n# Finding the right tool\nOnly the everyday tools are loaded. Lume has ~55 more, hidden until you look them up with tool_search_tool_regex (a case-insensitive pattern on tool names and descriptions). Families and useful patterns: quotes, invoices & payments (\`quote|invoice|payment|paid|reminder\`), jobs, scheduling & routes (\`job|schedule|route|visit|free_slot\`), clients & leads (\`client|lead|note|remember\`), messaging (\`sms|email|conversation\`), reports & finances (\`report|revenue|financial|profit|churn|top_\`), team & field (\`team|timesheet|payroll|location|d2d|course\`), automations (\`automation|request_submission\`). Search BEFORE saying you can't do something; one search with an alternation pattern usually finds it.`
    + `\n\n# Longueur des réponses
Une à trois phrases par défaut, comme un collègue qui répond à l'oral. Le chiffre ou le fait d'abord, une précision si elle change quelque chose, et c'est tout. Pas de liste pour moins de trois éléments, pas de récapitulatif de ce qu'on vient de faire, pas de « veux-tu que je… » à chaque fois (une seule suite proposée, seulement si elle est évidente). Tu développes uniquement quand on te le demande (« détaille », « explique », « fais-moi un rapport »).`
    + `\n\n# Comment tu parles à l'utilisateur (s'applique aussi en anglais)\n${CONSIGNES_COLLEGUE}\n- Dans Lumi, une action d'écriture s'affiche comme une carte à confirmer : la carte EST le « oui » explicite. Quand tu as tout ce qu'il faut, propose directement (appelle l'outil) — ne demande pas « je le fais ? » en texte avant, ça ferait confirmer deux fois. Décris l'action en mots courants et ne prétends jamais qu'elle est faite avant la confirmation. Si l'outil d'écriture n'est pas chargé, cherche-le avec tool_search_tool_regex puis appelle-le.
- Chaque mot que tu écris est dans la langue de l'utilisateur — y compris la courte phrase avant de consulter quelque chose (« je regarde ça », jamais « I'll check »).
- Rapports : « un rapport », « un PDF », « un document pour mon comptable », « sors-moi mon mois » → build_report (type financier, retards, jobs ou client ; période = du 1er du mois à aujourd'hui si rien n'est précisé, sinon demande-la). La carte du rapport s'affiche SOUS ton message (dis « ci-dessous », jamais « ci-dessus ») avec le bouton de téléchargement ; toi, tu résumes les deux ou trois faits saillants en phrases — sans recopier les tableaux.`;
  const variable = ctx.language === 'fr'
    ? `Aujourd'hui : ${ctx.todayIso}.${ctx.userName ? ` Tu parles à ${ctx.userName}.` : ''}`
    : `Today is ${ctx.todayIso}.${ctx.userName ? ` You are talking to ${ctx.userName}.` : ''}`;
  return [
    { type: 'text', text: stable, cache_control: CACHE_1H },
    { type: 'text', text: variable },
  ];
}

export type EvenementLumi =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; statut: 'debut' | 'fin' | 'refus' }
  | { type: 'proposal'; tool_use_id: string; tool: string; args: Record<string, any>; capacite: string | null; apercu: Apercu | null }
  /** Fiches (client, job, devis, facture…) touchées par un outil de lecture : l'interface en fait des liens. */
  | { type: 'fiches'; fiches: Fiche[] }
  | { type: 'report'; tool_use_id: string; rapport: Rapport }
  | { type: 'usage'; model: string; usage: UsageTokens; cost_cents: number }
  | { type: 'error'; message: string };

export interface ResultatTour {
  /** Messages à AJOUTER à la conversation (assistant + résultats d'outils), dans l'ordre. */
  nouveauxMessages: Anthropic.Messages.MessageParam[];
  /** Proposition en attente (écriture), s'il y en a une. */
  proposition: { tool_use_id: string; tool: string; args: Record<string, any> } | null;
  texte: string;
  cost_cents: number;
}

export async function tourLumi(opts: {
  client: SupabaseClient;
  orgId: string;
  userId: string;
  accessToken?: string;
  systeme: Anthropic.Messages.TextBlockParam[];
  historique: Anthropic.Messages.MessageParam[];
  emettre: (e: EvenementLumi) => void;
  journaliser: (u: UsageTokens, model: string, cost_cents: number) => Promise<void>;
  /** Réglages imposés par le palier de budget (mode économe : Haiku, effort bas). */
  reglages?: { model: string; effort: 'low' | 'medium' };
}): Promise<ResultatTour> {
  const model = opts.reglages?.model ?? modeleLumi();
  const effort = opts.reglages?.effort ?? 'medium';
  const outils = outilsClaude();
  const messages: Anthropic.Messages.MessageParam[] = [...opts.historique];
  const nouveaux: Anthropic.Messages.MessageParam[] = [];
  const espaceRefs = `${opts.orgId}:${opts.userId}`;
  let texteTotal = '';
  let coutTotal = 0;

  for (let etape = 0; etape < MAX_ETAPES; etape++) {
    const stream = anthropic().messages.stream({
      model,
      max_tokens: MAX_TOKENS,
      system: opts.systeme,
      tools: outils,
      messages: avecCacheConversation(messages),
      thinking: { type: 'adaptive' },
      output_config: { effort },
    });
    stream.on('text', (delta) => { texteTotal += delta; opts.emettre({ type: 'text', delta }); });
    const reponse = await stream.finalMessage();

    const cout = coutEnCents(model, reponse.usage);
    coutTotal += cout;
    await opts.journaliser(reponse.usage, model, cout);
    opts.emettre({ type: 'usage', model, usage: reponse.usage, cost_cents: cout });

    const assistant: Anthropic.Messages.MessageParam = { role: 'assistant', content: reponse.content };
    messages.push(assistant);
    nouveaux.push(assistant);

    if (reponse.stop_reason === 'refusal') {
      opts.emettre({ type: 'error', message: 'refusal' });
      return { nouveauxMessages: nouveaux, proposition: null, texte: texteTotal, cost_cents: coutTotal };
    }
    // pause_turn : l'API a interrompu le tour après un outil serveur (recherche
    // d'outils) ; on relance avec l'historique tel quel, sans message utilisateur.
    if (reponse.stop_reason === 'pause_turn') continue;
    if (reponse.stop_reason !== 'tool_use') {
      return { nouveauxMessages: nouveaux, proposition: null, texte: texteTotal, cost_cents: coutTotal };
    }

    const appels = reponse.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use');
    // Rien à exécuter côté client (seule une recherche d'outils a eu lieu) :
    // un message utilisateur vide serait refusé par l'API.
    if (appels.length === 0) continue;
    const resultats: Anthropic.Messages.ToolResultBlockParam[] = [];
    let proposition: ResultatTour['proposition'] = null;

    for (const appel of appels) {
      const outil = TOOLS_BY_NAME[appel.name];
      const args = demasquerIds(espaceRefs, (appel.input ?? {}) as Record<string, any>);

      if (!outil) {
        resultats.push({ type: 'tool_result', tool_use_id: appel.id, content: JSON.stringify({ error: `Unknown tool: ${appel.name}` }), is_error: true });
        continue;
      }
      if (outil.kind === 'write') {
        // Une seule proposition à la fois : la première écriture arrête le tour.
        if (!proposition) proposition = { tool_use_id: appel.id, tool: appel.name, args };
        else resultats.push({ type: 'tool_result', tool_use_id: appel.id, content: JSON.stringify({ error: 'Une seule action à la fois : propose celle-ci après la confirmation de la précédente.' }), is_error: true });
        continue;
      }

      opts.emettre({ type: 'tool', name: appel.name, statut: 'debut' });
      try {
        const r = await executerOutilGarde({ name: appel.name, args, userId: opts.userId, orgId: opts.orgId, client: opts.client, accessToken: opts.accessToken });
        if ('refus' in r) {
          opts.emettre({ type: 'tool', name: appel.name, statut: 'refus' });
          resultats.push({ type: 'tool_result', tool_use_id: appel.id, content: JSON.stringify({ error: r.refus }), is_error: true });
        } else {
          opts.emettre({ type: 'tool', name: appel.name, statut: 'fin' });
          // Un rapport part tel quel à l'interface (carte + bouton PDF) ; le modèle reçoit la même structure.
          if (appel.name === 'build_report' && r.result?.rapport) opts.emettre({ type: 'report', tool_use_id: appel.id, rapport: r.result.rapport });
          // Fiches touchées, lues AVANT le masquage : l'interface seule les reçoit.
          const fiches = fichesDuResultat(appel.name, args, r.result);
          if (fiches.length) opts.emettre({ type: 'fiches', fiches });
          const masque = masquerIds(espaceRefs, r.result);
          resultats.push({ type: 'tool_result', tool_use_id: appel.id, content: JSON.stringify(masque ?? null).slice(0, 60_000) });
        }
      } catch (err: any) {
        // Jamais le texte brut d'une erreur (internes de la base) au modèle.
        console.error(`[lumi:${appel.name}]`, err?.message || err);
        opts.emettre({ type: 'tool', name: appel.name, statut: 'refus' });
        resultats.push({ type: 'tool_result', tool_use_id: appel.id, content: JSON.stringify({ error: 'Tool execution failed.' }), is_error: true });
      }
    }

    if (proposition) {
      // Les lectures déjà faites sont conservées ; l'écriture attend la
      // confirmation. Le tool_use en suspens sera résolu par /lumi/execute
      // (confirmé ou annulé) avant tout nouveau message.
      if (resultats.length) {
        const u: Anthropic.Messages.MessageParam = { role: 'user', content: resultats };
        messages.push(u); nouveaux.push(u);
      }
      const apercu = await apercuProposition(proposition.tool, proposition.args, { client: opts.client, orgId: opts.orgId, userId: opts.userId });
      opts.emettre({ type: 'proposal', tool_use_id: proposition.tool_use_id, tool: proposition.tool, args: proposition.args, capacite: PERMISSION_PAR_OUTIL[proposition.tool]?.capacite ?? null, apercu });
      return { nouveauxMessages: nouveaux, proposition, texte: texteTotal, cost_cents: coutTotal };
    }

    const u: Anthropic.Messages.MessageParam = { role: 'user', content: resultats };
    messages.push(u); nouveaux.push(u);
  }

  opts.emettre({ type: 'error', message: 'trop_d_etapes' });
  return { nouveauxMessages: nouveaux, proposition: null, texte: texteTotal, cost_cents: coutTotal };
}
