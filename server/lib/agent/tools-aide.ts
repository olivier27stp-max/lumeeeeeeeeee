/**
 * search_help — grounding sur la doc produit (item 14, AGENTFORCE_GAP.md B5).
 * ─────────────────────────────────────────────────────────────────
 * « Comment je fais X dans Lume ? » : avant, Lumi répondait de mémoire du
 * prompt ou disait qu'il ne savait pas. Ici, un outil de LECTURE cherche dans
 * les pages Fonctionnalités du site (src/pages/marketing/fonctionsData.ts :
 * la même source que ce que le client lit sur lume) et renvoie les passages
 * les plus proches AVEC la page d'origine, pour que Lumi cite sa source.
 * Règle dure inchangée : pas dans un résultat = « je ne sais pas ».
 *
 * Index en mémoire au premier appel (8 pages, ~23 ko) : aucune migration,
 * aucune base. Score = mots-clés normalisés en commun (titre ×3, points ×2,
 * FAQ ×2, texte ×1). Volontairement simple : c'est du support produit, pas
 * de la recherche sémantique.
 */
import type { AgentTool } from './tools';
import { FONCTIONS, type Bi } from '../../../src/pages/marketing/fonctionsData';
import { normaliser } from '../lumi/normaliser';

interface Passage { page: string; slug: string; titre: string; texte: string; poids: number; mots: Set<string> }

const VIDES = new Set(['le', 'la', 'les', 'de', 'des', 'du', 'un', 'une', 'et', 'ou', 'en', 'a', 'au', 'aux', 'ce', 'ca', 'que', 'qui', 'dans', 'sur', 'pour', 'par', 'est', 'je', 'tu', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'the', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'my', 'your', 'comment', 'how', 'do', 'i', 'faire', 'fais', 'peux', 'peut', 'lume', 'avec', 'with']);

function mots(s: string): Set<string> {
  return new Set(normaliser(s).filter((m) => m.length > 2 && !VIDES.has(m)));
}

let INDEX: Passage[] | null = null;
function index(): Passage[] {
  if (INDEX) return INDEX;
  const out: Passage[] = [];
  const bi = (b: Bi) => `${b.fr} ${b.en}`;
  for (const f of FONCTIONS) {
    const page = `/fonctions/${f.slug}`;
    const titre = f.title.fr;
    out.push({ page, slug: f.slug, titre, texte: f.lead.fr, poids: 3, mots: mots(`${bi(f.title)} ${bi(f.lead)}`) });
    for (const p of f.points) out.push({ page, slug: f.slug, titre: `${titre} — ${p.t.fr}`, texte: p.d.fr, poids: 2, mots: mots(`${bi(p.t)} ${bi(p.d)}`) });
    for (const s of f.steps) out.push({ page, slug: f.slug, titre: `${titre} — ${s.t.fr}`, texte: s.d.fr, poids: 1, mots: mots(`${bi(s.t)} ${bi(s.d)}`) });
    for (const q of f.faq) out.push({ page, slug: f.slug, titre: `${titre} — ${q.q.fr}`, texte: q.a.fr, poids: 2, mots: mots(`${bi(q.q)} ${bi(q.a)}`) });
  }
  INDEX = out;
  return out;
}

/** Les passages les plus proches de la question (pur, testable). */
export function chercherAide(question: string, limite = 3): Array<{ page: string; titre: string; extrait: string; score: number }> {
  const q = mots(question);
  if (q.size === 0) return [];
  const scores = index().map((p) => {
    let commun = 0;
    for (const m of q) if (p.mots.has(m)) commun += 1;
    return { p, score: commun * p.poids };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  // Une page au plus deux fois : la réponse doit rester courte et citer 1 à 3 pages.
  const vus = new Map<string, number>();
  const out = [];
  for (const { p, score } of scores) {
    const n = vus.get(p.slug) ?? 0;
    if (n >= 2) continue;
    vus.set(p.slug, n + 1);
    out.push({ page: p.page, titre: p.titre, extrait: p.texte, score });
    if (out.length >= limite) break;
  }
  return out;
}

export const searchHelp: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'search_help',
    description: 'How-to questions about Lume itself ("how do I set up the request form?", "can my client pay online?"): searches the product documentation and returns the closest passages WITH their page. Answer only from these passages and name the page as the source; if nothing matches, say you do not know.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'The question, in the user\'s words.' } },
      required: ['query'],
    },
  },
  handler: async (args) => {
    const passages = chercherAide(String(args.query || ''), 3);
    return {
      count: passages.length,
      passages,
      note: passages.length ? 'Cite la page (ex. « voir Clients et demandes ») ; ne complète pas avec ce qui n\'y est pas.' : 'Rien dans la documentation : dis que tu ne sais pas et propose de demander au soutien.',
    };
  },
};
