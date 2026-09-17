/**
 * Lumi, l'assistant de support — LE MÊME PARTOUT.
 *
 * Un seul cerveau, appelé par toutes les surfaces :
 *   - 'app'              : chat d'aide dans Lume (routes/support.ts)
 *   - 'migration_portal' : messages du client dans le portail de migration
 *   - 'public'           : chat du site (routes/sales-chat.ts), visiteur sans compte
 * … et la même équipe humaine derrière, dans Slack (transfer_to_human).
 *
 * Il est AU COURANT DE TOUT ce qui concerne ce client : le dossier
 * (support/dossier.ts — forfait, réglages, volumes, paiements, migration,
 * demandes passées, actions de Lumi) entre dans le prompt à chaque tour.
 * Il répond à partir (1) de search_help (la doc, les réponses de la FAQ et
 * la carte de l'app : boutons exacts de chaque écran), (2) de l'index des
 * écrans, (3) du dossier. Il n'écrit rien dans le compte, sauf démarrer une
 * migration quand le client le demande (start_migration : réversible,
 * auditée) — et TRANSFÈRE à un humain dès que la demande dépasse ce cadre.
 *
 * Coût pour Lume (pas pour l'org) : Sonnet 5, réflexion adaptative à effort
 * bas. La partie stable du prompt est mise en cache (1 h) ; le dossier, qui
 * change par client, vient après. Depuis le 2026-09-17 la carte complète et
 * les réponses de la FAQ ne sont plus dans le prompt (11 500 → ~3 000
 * tokens) : à notre volume le cache est presque toujours froid, et c'est la
 * réécriture du prompt qui coûtait. Le modèle va les chercher par search_help
 * quand il en a besoin (un « comment faire » = un appel d'outil de plus, sur
 * un prompt quatre fois plus court).
 */
import type Anthropic from '@anthropic-ai/sdk';
import { clientAnthropic } from '../lumi/llm';
import { chercherAide } from '../agent/tools-aide';
import { ARTICLES } from '../../../src/components/supportArticles';
import { SYSTEM_PROMPT as CONNAISSANCE_PUBLIQUE } from '../agent/promptVente';
import { indexCarteApp } from './carte-app';
import { coutEnCents } from '../lumi/tarifs';
import { logger } from '../logger';

/** Sonnet 5 par défaut ; LUMI_SUPPORT_MODELE permet de mesurer un autre modèle (Haiku) avec scripts/qa/evaluer-support-qualite.mts. */
export const MODELE_SUPPORT = process.env.LUMI_SUPPORT_MODELE || 'claude-sonnet-5';
const MAX_ETAPES = 4;
const MAX_TOKENS = 1024;

export function isSupportIAConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.ANTHROPIC_API_KEY;
}

export type SurfaceSupport = 'app' | 'migration_portal' | 'public';

export interface ContexteSupport {
  langue: 'fr' | 'en';
  companyName: string;
  planLabel: string;
  userName: string;
  slaTexte: string;
  /** Défaut : 'app'. */
  surface?: SurfaceSupport;
  /** Dossier client (support/dossier.ts). Jamais pour la surface publique. */
  dossier?: string | null;
  /** Route de l'app où le client se trouve en écrivant (ex. /jobs/123) : Lumi répond « ici », pas « depuis le menu ». */
  page?: string | null;
}

/** Ce que l'assistant peut FAIRE, fourni par la surface (le module ne touche pas à la base lui-même). */
export interface OutilsSupport {
  /** Statut de la migration du client, en mots simples (ou « aucune »). */
  statutMigration?: () => Promise<string>;
  /** Démarre une migration en mode autonome et renvoie le lien du portail. */
  demarrerMigration?: (p: { sourceCrm: string }) => Promise<{ ok: true; lien: string; expire: string } | { ok: false; raison: string }>;
}

export interface ReponseSupportIA {
  texte: string;
  /** Le modèle a demandé un humain (ou n'a pas su répondre). */
  transferer: boolean;
  motif: string | null;
  coutCents: number;
  /** Outils appelés pendant le tour (pour la trace). */
  outils: string[];
}

/** Les SUJETS de la FAQ (les réponses viennent par search_help, qui les indexe). */
function faqSujets(langue: 'fr' | 'en'): string {
  return ARTICLES.map((a) => (langue === 'fr' ? a.q_fr : a.q_en)).join(' · ');
}

/** Partie STABLE du prompt (mise en cache) : identité, règles, index des écrans, sujets de la FAQ. */
function promptStable(langue: 'fr' | 'en', surface: SurfaceSupport, outils: OutilsSupport): string {
  if (surface === 'public') {
    return `${CONNAISSANCE_PUBLIQUE}

═══ TU ES LE MÊME LUMI PARTOUT ═══
Tu es aussi l'assistant de support des clients de Lume, dans l'app et dans le portail de migration, avec la même équipe humaine derrière. Ici tu parles à un VISITEUR : tu n'as accès à aucun compte et tu ne prétends jamais en voir un. Si le visiteur est déjà client et a un problème de compte, dis-lui d'ouvrir le chat d'aide une fois connecté (bouton « Aide » dans Lume), où tu le reconnaîtras.
Pour une question « comment ça marche » précise, tu peux appeler search_help (la doc du produit) avant de répondre. Jamais un prix, une fonction ou un chiffre inventé.
Le widget affiche du TEXTE BRUT : aucun markdown (pas de **gras**, pas de puces, pas de titres), 2 à 5 phrases courtes, les forfaits séparés par des points ou des points-virgules.`;
  }
  return `You are Lumi, the support assistant of Lume CRM, a CRM for small service businesses (plumbers, cleaners, landscapers…) in Québec. You are THE SAME assistant everywhere: in the app's help chat, in the data-migration portal, on the public website — and the same human team is behind you in Slack. The client should never have to repeat themselves.

Answer in ${langue === 'fr' ? 'French (Québec, vouvoiement, plain words)' : 'English (plain words)'}. Be short: 2 to 6 sentences, no headings, no markdown tables. Give the exact path in the app when you explain how to do something, with its route in parentheses (e.g. « Paramètres → Membres (/settings/team) ») — the chat turns the route into a link the client can click.

You know this client: their account file (« DOSSIER ») is below. Use it to answer directly what concerns THEIR account — plan, renewal date, whether setup, payments or Google reviews are configured, how many clients/jobs they have, where their data migration stands, what they already asked support, what Lumi (the in-app assistant) did recently. Never guess a fact that is not in the dossier, the FAQ, or a tool result. Never mention or invent another client's data.

You answer from (1) what the search_help tool returns — it holds the product documentation, the FAQ answers and the APP MAP (the exact buttons and menus of every screen): call it BEFORE answering any "how do I…" or "where is…" question, with the user's words, (2) the APP MAP index below (which screens exist and their route), (3) the DOSSIER${outils.statutMigration ? ', (4) get_migration_status' : ''}. Never invent a feature, a price, a button or a setting: a path you give must come from search_help or from the index.

Passages titled « Réponse de l'équipe Lume — … » are answers the Lume team gave to other clients and chose to keep: they are the most up-to-date truth (a feature that is coming, a known issue, a workaround). Use them first and say the team confirmed it (« l'équipe a confirmé que … ») — without naming the other client.

HOW-TO QUESTIONS ARE YOURS, NOT THE TEAM'S. A "how do I…" question (delete, edit, archive, find, change, send, set up…) NEVER goes to the team by itself. Call search_help, then give the path it returns. If it does not cover the question exactly, give the closest screen from the APP MAP index, say in one short clause what you are not sure of, and ask ONE clarifying question if the word is ambiguous (in Lume, « tâches » are to-dos in the Tasks page, « travaux » / « jobs » are the scheduled work). End with: « Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l'équipe. » Only if the user then says it did not help, or asks for the team, call transfer_to_human.
${outils.demarrerMigration ? `
If the client wants to bring their data from another CRM (Jobber, Housecall Pro, ServiceTitan, GoHighLevel, QuickBooks, spreadsheets…), call start_migration ONCE with the source. It is safe and reversible: it creates the migration in autonomous mode and returns the portal link. Tell the client the ONLY thing they have to do: open the link and drop their export files (CSV/Excel). Everything else (matching columns, duplicates, test import, approval) is done by Lume — they will not be asked questions. If a migration already exists (see DOSSIER), do not start another one: give its status instead.
` : ''}
Call transfer_to_human — after one short sentence telling the user you are passing them to the team — ONLY when:
- the user asks for a human, a person, a call, or says your answer did not help;
- something is broken: a bug, an error message, a page or action that "doesn't work", data that disappeared;
- money or account matters that need a person: a double charge, a refund, a wrong invoice amount from Lume, a subscription change or cancellation, an access problem you cannot solve with a path;
- the user asks the team to DO something in their account for them (import, fix, delete in bulk, reconfigure).
Do NOT transfer for a how-to question, a question the DOSSIER answers, or a question outside Lume (for those, say kindly that it is outside Lume and stop). A human replies within the delay given below. Never promise anything else on behalf of the team.

APP MAP index (screens and routes, verified in the code; the exact buttons of each screen come from search_help):
${indexCarteApp()}

FAQ topics (search_help returns their answer): ${faqSujets(langue)}`;
}

/** Partie VARIABLE du prompt : la personne, l'entreprise, le délai, le dossier. */
function promptVariable(c: ContexteSupport, surface: SurfaceSupport): string {
  if (surface === 'public') return '';
  const ou = surface === 'migration_portal' ? 'They are writing from the data-migration portal (they are not logged in to the app; questions about their migration are expected here).' : 'They are writing from the help chat inside the app.';
  const page = c.page && surface === 'app' ? ` They are currently on the page ${c.page} of the app: when the answer is on that page, say where to click from where they are (« ici, en haut à droite… »), not from the main menu.` : '';
  return `You are talking to ${c.userName} from "${c.companyName}" (${c.planLabel} plan). ${ou}${page} A human replies within ${c.slaTexte}.

DOSSIER (this client only, read-only, as of now):
${c.dossier?.trim() || '(dossier indisponible pour ce tour : ne devine rien sur le compte, transfère si la question porte dessus)'}`;
}

function outilsPour(surface: SurfaceSupport, outils: OutilsSupport): Anthropic.Messages.Tool[] {
  const liste: Anthropic.Messages.Tool[] = [
    {
      name: 'search_help',
      description: 'Searches the Lume product documentation, the FAQ answers and the app map (routes, menus and exact buttons of every screen) and returns the closest passages with their page. Call it before answering any "how do I…" or "where is…" question, with the user\'s words.',
      input_schema: { type: 'object', properties: { query: { type: 'string', description: 'The question, in the user\'s words.' } }, required: ['query'] },
    },
  ];
  if (surface !== 'public') {
    liste.push({
      name: 'transfer_to_human',
      description: 'Hands the conversation to the Lume support team (a human in Slack). Call it once, with a one-line reason the team will read.',
      input_schema: { type: 'object', properties: { reason: { type: 'string', description: 'One line: what the user needs, for the team.' } }, required: ['reason'] },
    });
    if (outils.statutMigration) {
      liste.push({
        name: 'get_migration_status',
        description: 'Returns where this client\'s data migration stands, in plain words, with what (if anything) is expected from them. Use it for any question about their migration or import.',
        input_schema: { type: 'object', properties: {}, required: [] },
      });
    }
    if (outils.demarrerMigration) {
      liste.push({
        name: 'start_migration',
        description: 'Starts a data migration from another CRM for this client (autonomous mode) and returns the portal link where they drop their export files. Call it once, only when the client asks to bring their data into Lume and no migration exists yet.',
        input_schema: { type: 'object', properties: { source_crm: { type: 'string', enum: ['jobber', 'housecall_pro', 'servicetitan', 'gohighlevel', 'quickbooks', 'custom_files', 'other'], description: 'Where the data comes from. Spreadsheets / CSV exports of unknown origin = custom_files.' } }, required: ['source_crm'] },
      });
    }
  }
  return liste;
}

export interface MessageSupport { role: 'user' | 'assistant'; content: string }

/** Pour mesurer (scripts/qa/compter-tokens-support.mts) : les deux blocs du prompt, tels qu'envoyés. */
export function promptsPourMesure(langue: 'fr' | 'en', surface: SurfaceSupport, dossier: string | null): { stable: string; variable: string } {
  const outils: OutilsSupport = surface === 'public' ? {} : { statutMigration: async () => '', demarrerMigration: async () => ({ ok: false, raison: '' }) };
  return { stable: promptStable(langue, surface, outils), variable: promptVariable({ langue, companyName: 'Entreprise', planLabel: 'Scale', userName: 'Client', slaTexte: '4 heures ouvrables', surface, dossier }, surface) };
}

/**
 * Un tour de conversation. `historique` = les messages précédents (client et
 * assistant, texte seulement), `message` = le nouveau message du client.
 */
export async function repondreSupportIA(
  contexte: ContexteSupport,
  historique: MessageSupport[],
  message: string,
  outils: OutilsSupport = {},
): Promise<ReponseSupportIA> {
  const surface: SurfaceSupport = contexte.surface ?? 'app';
  const messages: Anthropic.Messages.MessageParam[] = [
    ...historique.slice(-12).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];
  const system: Anthropic.Messages.TextBlockParam[] = [
    { type: 'text', text: promptStable(contexte.langue, surface, outils), cache_control: { type: 'ephemeral', ttl: '1h' } },
  ];
  const variable = promptVariable(contexte, surface);
  if (variable) system.push({ type: 'text', text: variable });
  const definitions = outilsPour(surface, outils);
  let texte = '';
  let transferer = false;
  let motif: string | null = null;
  let coutCents = 0;
  const appeles: string[] = [];

  for (let etape = 0; etape < MAX_ETAPES; etape++) {
    const reponse = await clientAnthropic().messages.create({
      model: MODELE_SUPPORT,
      max_tokens: MAX_TOKENS,
      system,
      tools: definitions,
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
      appeles.push(appel.name);
      const args = (appel.input ?? {}) as Record<string, unknown>;
      if (appel.name === 'transfer_to_human' && surface !== 'public') {
        transferer = true;
        motif = String(args.reason || '').slice(0, 300) || 'Demande transférée par l’assistant';
        resultats.push({ type: 'tool_result', tool_use_id: appel.id, content: 'The team has been notified. Tell the user in one sentence and stop.' });
      } else if (appel.name === 'search_help') {
        const passages = chercherAide(String(args.query || ''), 3);
        resultats.push({ type: 'tool_result', tool_use_id: appel.id, content: JSON.stringify({ count: passages.length, passages }) });
      } else if (appel.name === 'get_migration_status' && outils.statutMigration) {
        let statut = '';
        try { statut = await outils.statutMigration(); } catch (e: any) { statut = `Statut indisponible : ${String(e?.message || e).slice(0, 120)}`; }
        resultats.push({ type: 'tool_result', tool_use_id: appel.id, content: statut });
      } else if (appel.name === 'start_migration' && outils.demarrerMigration) {
        const sourceCrm = String(args.source_crm || 'custom_files');
        let r: Awaited<ReturnType<NonNullable<OutilsSupport['demarrerMigration']>>>;
        try { r = await outils.demarrerMigration({ sourceCrm }); } catch (e: any) { r = { ok: false, raison: String(e?.message || e).slice(0, 160) }; }
        resultats.push({ type: 'tool_result', tool_use_id: appel.id, content: r.ok ? JSON.stringify({ ok: true, portal_link: r.lien, link_expires: r.expire, next_step: 'The client opens the link and drops their export files. Nothing else is asked of them.' }) : JSON.stringify({ ok: false, reason: r.raison }), is_error: !r.ok });
      } else {
        resultats.push({ type: 'tool_result', tool_use_id: appel.id, content: 'Unknown tool.', is_error: true });
      }
    }
    messages.push({ role: 'user', content: resultats });
    if (transferer && reponse.stop_reason === 'tool_use' && etape === MAX_ETAPES - 1) break;
  }

  if (!texte) {
    if (surface === 'public') {
      texte = contexte.langue === 'fr'
        ? "Bonne question ! Le plus simple, c'est une courte démo — tu veux que je t'aide à en réserver une ?"
        : 'Good question! The simplest is a short demo — want me to help you book one?';
    } else {
      transferer = true;
      motif = motif || 'Aucune réponse produite par l’assistant';
      texte = contexte.langue === 'fr'
        ? 'Je transmets votre demande à notre équipe, qui vous répond ici.'
        : 'I am passing your request to our team, who will reply here.';
    }
  }
  logger.info('[support/ia] tour', { modele: MODELE_SUPPORT, surface, coutCents, transferer, outils: appeles });
  return { texte, transferer, motif, coutCents, outils: appeles };
}
