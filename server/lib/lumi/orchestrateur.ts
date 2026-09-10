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

   Le prompt système et les 66 définitions d'outils sont mis en cache
   (cache_control) : c'est ce qui divise le coût par trois. Toute variation
   d'un appel à l'autre (date, nom) est repoussée APRÈS le point de cache.
   Cache d'UNE HEURE (ttl 1h) : avec les 5 minutes par défaut, chaque reprise
   de conversation après une pause réécrivait ~4 000 tokens à 125 % du tarif
   (2,6 ¢ sur les 6 ¢ d'un tour). L'écriture 1h coûte 2× le tarif d'entrée
   au lieu de 1,25×, mais elle ne se répète plus de toute l'heure.
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

const MAX_ETAPES = 8;
const MAX_TOKENS = 4096;
/** Point de cache d'une heure (voir l'en-tête). Même objet partout : un seul endroit à changer. */
const CACHE_1H: Anthropic.Messages.CacheControlEphemeral = { type: 'ephemeral', ttl: '1h' };

let clientAnthropic: Anthropic | null = null;
export function isLumiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.ANTHROPIC_API_KEY;
}
function anthropic(): Anthropic {
  if (!clientAnthropic) clientAnthropic = new Anthropic();
  return clientAnthropic;
}

/** Définitions d'outils au format Claude — ordre stable, sinon le cache saute. */
export function outilsClaude(): Anthropic.Messages.Tool[] {
  const outils = AGENT_TOOLS.map((t) => ({
    name: t.declaration.name,
    description: t.declaration.description,
    input_schema: (t.declaration.parameters ?? { type: 'object', properties: {} }) as Anthropic.Messages.Tool['input_schema'],
  }));
  const dernier = outils[outils.length - 1];
  if (dernier) (dernier as Anthropic.Messages.Tool).cache_control = CACHE_1H;
  return outils;
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
    + `\n\n# Comment tu parles à l'utilisateur (s'applique aussi en anglais)\n${CONSIGNES_COLLEGUE}\n- Dans Lumi, une action d'écriture s'affiche comme une carte à confirmer : décris-la en mots courants et laisse l'utilisateur confirmer ; ne prétends jamais qu'elle est faite avant.
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
  | { type: 'proposal'; tool_use_id: string; tool: string; args: Record<string, any>; capacite: string | null }
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
}): Promise<ResultatTour> {
  const model = modeleLumi();
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
      messages,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
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
    if (reponse.stop_reason !== 'tool_use') {
      return { nouveauxMessages: nouveaux, proposition: null, texte: texteTotal, cost_cents: coutTotal };
    }

    const appels = reponse.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use');
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
      opts.emettre({ type: 'proposal', tool_use_id: proposition.tool_use_id, tool: proposition.tool, args: proposition.args, capacite: PERMISSION_PAR_OUTIL[proposition.tool]?.capacite ?? null });
      return { nouveauxMessages: nouveaux, proposition, texte: texteTotal, cost_cents: coutTotal };
    }

    const u: Anthropic.Messages.MessageParam = { role: 'user', content: resultats };
    messages.push(u); nouveaux.push(u);
  }

  opts.emettre({ type: 'error', message: 'trop_d_etapes' });
  return { nouveauxMessages: nouveaux, proposition: null, texte: texteTotal, cost_cents: coutTotal };
}
