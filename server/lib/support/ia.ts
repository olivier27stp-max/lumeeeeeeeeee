/**
 * Assistant de support (premier niveau).
 *
 * Répond aux questions « comment faire » à partir de la documentation du
 * produit (search_help, la même que Lumi) et de la FAQ de l'app, et TRANSFÈRE
 * à un humain dès que la demande dépasse ce cadre : bug, facturation, données
 * du compte, action à faire à la place du client, ou « je veux parler à
 * quelqu'un ». Il ne touche à rien dans le compte : lecture de doc seulement.
 *
 * Coût pour Lume (pas pour l'org) : Sonnet 5, réflexion adaptative à effort
 * bas — une réponse en quelques secondes, pas une analyse. Journalisé.
 */
import Anthropic from '@anthropic-ai/sdk';
import { chercherAide } from '../agent/tools-aide';
import { ARTICLES } from '../../../src/components/supportArticles';
import { coutEnCents } from '../lumi/tarifs';
import { logger } from '../logger';

export const MODELE_SUPPORT = 'claude-sonnet-5';
const MAX_ETAPES = 4;
const MAX_TOKENS = 1024;

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}
export function isSupportIAConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.ANTHROPIC_API_KEY;
}

export interface ContexteSupport {
  langue: 'fr' | 'en';
  companyName: string;
  planLabel: string;
  userName: string;
  slaTexte: string;
}

export interface ReponseSupportIA {
  texte: string;
  /** Le modèle a demandé un humain (ou n'a pas su répondre). */
  transferer: boolean;
  motif: string | null;
  coutCents: number;
}

function promptSysteme(c: ContexteSupport): string {
  const faq = ARTICLES.map((a) => `- ${c.langue === 'fr' ? a.q_fr : a.q_en}\n  ${c.langue === 'fr' ? a.a_fr : a.a_en}${a.path ? ` (page : ${a.path})` : ''}`).join('\n');
  return `You are the support assistant of Lume CRM, a CRM for small service businesses (plumbers, cleaners, landscapers…) in Québec. You are talking to ${c.userName} from "${c.companyName}" (${c.planLabel} plan).

Answer in ${c.langue === 'fr' ? 'French (Québec, vouvoiement, plain words)' : 'English (plain words)'}. Be short: 2 to 6 sentences, no headings, no markdown tables. Give the exact path in the app when you explain how to do something (e.g. « Paramètres → Membres »).

You can ONLY answer from (1) the FAQ below and (2) what the search_help tool returns. Never invent a feature, a price or a setting. If neither source answers, do not guess: call transfer_to_human.

Call transfer_to_human — after one short sentence telling the user you are passing them to the team — when:
- the user asks for a human, a person, a call, or says the assistant does not help;
- it is a bug, an error message, something that "doesn't work", missing data, a payment/billing/refund/invoice-amount question, an account or access problem, a request to change something in their account, a cancellation, or anything about their specific data;
- the question is outside Lume (their own business, legal, accounting advice);
- you searched and found nothing useful.
A human replies within ${c.slaTexte}. Never promise anything else on behalf of the team.

FAQ:
${faq}`;
}

const OUTILS: Anthropic.Messages.Tool[] = [
  {
    name: 'search_help',
    description: 'Searches the Lume product documentation for how-to questions and returns the closest passages with their page. Use it before answering any "how do I…" question that the FAQ does not cover.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'The question, in the user\'s words.' } }, required: ['query'] },
  },
  {
    name: 'transfer_to_human',
    description: 'Hands the conversation to the Lume support team (a human in Slack). Call it once, with a one-line reason the team will read.',
    input_schema: { type: 'object', properties: { reason: { type: 'string', description: 'One line: what the user needs, for the team.' } }, required: ['reason'] },
  },
];

export interface MessageSupport { role: 'user' | 'assistant'; content: string }

/**
 * Un tour de conversation. `historique` = les messages précédents (client et
 * assistant, texte seulement), `message` = le nouveau message du client.
 */
export async function repondreSupportIA(
  contexte: ContexteSupport,
  historique: MessageSupport[],
  message: string,
): Promise<ReponseSupportIA> {
  const messages: Anthropic.Messages.MessageParam[] = [
    ...historique.slice(-12).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];
  let texte = '';
  let transferer = false;
  let motif: string | null = null;
  let coutCents = 0;

  for (let etape = 0; etape < MAX_ETAPES; etape++) {
    const reponse = await anthropic().messages.create({
      model: MODELE_SUPPORT,
      max_tokens: MAX_TOKENS,
      system: promptSysteme(contexte),
      tools: OUTILS,
      messages: [...messages], // copie : le tableau continue d'évoluer pendant la boucle
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
    });
    coutCents += coutEnCents(MODELE_SUPPORT, reponse.usage);

    const blocsTexte = reponse.content.filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text');
    texte = [texte, ...blocsTexte.map((b) => b.text)].filter(Boolean).join('\n').trim();
    const appels = reponse.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use');

    if (reponse.stop_reason === 'refusal') { transferer = true; motif = 'Le modèle a refusé de répondre'; break; }
    if (!appels.length) break;

    messages.push({ role: 'assistant', content: reponse.content });
    const resultats: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const appel of appels) {
      if (appel.name === 'transfer_to_human') {
        transferer = true;
        motif = String((appel.input as any)?.reason || '').slice(0, 300) || 'Demande transférée par l’assistant';
        resultats.push({ type: 'tool_result', tool_use_id: appel.id, content: 'The team has been notified. Tell the user in one sentence and stop.' });
      } else if (appel.name === 'search_help') {
        const passages = chercherAide(String((appel.input as any)?.query || ''), 3);
        resultats.push({ type: 'tool_result', tool_use_id: appel.id, content: JSON.stringify({ count: passages.length, passages }) });
      } else {
        resultats.push({ type: 'tool_result', tool_use_id: appel.id, content: 'Unknown tool.', is_error: true });
      }
    }
    messages.push({ role: 'user', content: resultats });
    if (transferer && reponse.stop_reason === 'tool_use' && etape === MAX_ETAPES - 1) break;
  }

  if (!texte) {
    transferer = true;
    motif = motif || 'Aucune réponse produite par l’assistant';
    texte = contexte.langue === 'fr'
      ? 'Je transmets votre demande à notre équipe, qui vous répond ici.'
      : 'I am passing your request to our team, who will reply here.';
  }
  logger.info('[support/ia] tour', { modele: MODELE_SUPPORT, coutCents, transferer });
  return { texte, transferer, motif, coutCents };
}
