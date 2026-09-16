/**
 * Étage 4 — cache sémantique (item 15, AGENTFORCE_GAP.md B3).
 * ───────────────────────────────────────────────────────
 * Une question déjà répondue, reformulée (« ai-je des jobs en retard » ≈
 * « est-ce que j'ai des jobs en retard ? ») → la réponse existante, sans
 * tour d'agent. Le seul étage payant de la couche zéro-appel : un embedding
 * Gemini (gemini-embedding-001, 256 dimensions, ~300 ms), ~1 000 × moins
 * cher qu'un tour ; son coût n'est pas tarifé dans le code (pas de grille
 * Gemini) : la trace stocke cost NULL, jamais un chiffre inventé.
 *
 * Seuil : cosinus ≥ 0,92. Mesuré le 2026-09-13 : paraphrase 0,993, question
 * différente (« combien de clients ? » vs « jobs en retard ? ») 0,848.
 *
 * ISOLATION — le seul endroit du système où une fuite inter-tenant est
 * possible par conception :
 * - données client : index par (org, personne) — `lumi:sem:<org>:<user>` ;
 *   jamais lu hors de cette clé ; version d'org + TTL 10 min ;
 * - support produit (page publique, aucune donnée client) : index partagé
 *   `lumi:sem:public`, TTL 24 h.
 * Le test tests/lumi-caches.test.ts prouve que deux orgs avec la même
 * question ne se voient pas.
 *
 * Volume : ≤ 200 entrées par index (FIFO), calcul de similarité en Node —
 * suffisant tant qu'une personne ne pose pas des milliers de questions
 * distinctes ; au-delà, pgvector (migration) sera le bon outil.
 */
import { geminiApiKey } from '../config';
import { magasin } from './magasin';
import { normaliserEnonce } from './traces';
import type { Fiche } from './fiches';
import { logger } from '../logger';

export const SEUIL_SIMILARITE = 0.92;
export const DIMENSIONS = 256;
export const TTL_TENANT_S = 10 * 60;
export const TTL_PUBLIC_S = 24 * 60 * 60;
const MAX_ENTREES = 200;
const MODELE_EMBEDDING = 'gemini-embedding-001';

export interface EntreeSemantique {
  enonce: string;
  vec: number[];
  texte: string;
  fiches: Fiche[];
  outils: string[];
  version: number;
  ts: number;
}

export type Portee = { genre: 'tenant'; orgId: string; userId: string } | { genre: 'public' } | { genre: 'global'; espace: string };

export function cleIndex(p: Portee): string {
  if (p.genre === 'public') return 'lumi:sem:public';
  if (p.genre === 'global') return `lumi:sem:global:${p.espace}`;
  return `lumi:sem:${p.orgId}:${p.userId}`;
}

export function cosinus(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

/** Embedding d'un énoncé (null si Gemini n'est pas configuré ou répond mal : l'étage est alors sauté). */
export async function embed(texte: string, fetchImpl: typeof fetch = fetch): Promise<number[] | null> {
  if (!geminiApiKey) return null;
  try {
    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${MODELE_EMBEDDING}:embedContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey },
      body: JSON.stringify({ content: { parts: [{ text: texte.slice(0, 2000) }] }, outputDimensionality: DIMENSIONS, taskType: 'SEMANTIC_SIMILARITY' }),
    });
    if (!res.ok) { logger.warn('[lumi/semantique] embedding refusé', { status: res.status }); return null; }
    const j: any = await res.json();
    const v = j?.embedding?.values;
    return Array.isArray(v) && v.length === DIMENSIONS ? v.map(Number) : null;
  } catch (e: any) {
    logger.warn('[lumi/semantique] embedding raté', { error: e?.message });
    return null;
  }
}

/** La meilleure entrée au-dessus du seuil, pour cette portée et cette version (pur sur l'index). */
/** Mots creux d'une question (verbes de demande, déterminants) : ils ne distinguent rien. */
const MOTS_CREUX: ReadonlySet<string> = new Set(['montre', 'montrer', 'voir', 'liste', 'lister', 'dis', 'donne', 'quoi', 'quel', 'quels', 'quelle', 'quelles', 'combien', 'comment', 'avec', 'pour', 'dans', 'tous', 'toutes', 'mes', 'mon', 'les', 'des', 'une', 'pas', 'que', 'qui', 'est', 'sont', 'jai', 'moi', 'peux', 'peut', 'veux', 'faut', 'pourrais', 'stp', 'svp', 'plait', 'chez', 'encore', 'actuellement', 'presentement', 'show', 'list', 'what', 'which', 'the', 'and', 'all', 'can', 'you', 'please', 'have']);
/** Mots porteurs d'un énoncé normalisé (≥ 3 lettres, hors mots creux), pour le garde lexical. */
function motsPorteurs(enonce: string): Set<string> {
  return new Set((normaliserEnonce(enonce) ?? '').split(/\s+/).filter((m) => m.length >= 3 && !MOTS_CREUX.has(m)));
}

/**
 * Garde lexical : deux questions courtes qui ne diffèrent que par le nom clé
 * (« mes modèles de soumission » / « mes modèles de facture ») ont un cosinus
 * ≥ 0,92 et recevaient la même réponse (batterie du 2026-09-16). En plus du
 * cosinus, il faut que ≥ 75 % des mots porteurs de la question soient dans
 * l'énoncé mémorisé (60 % laissait passer « enlève la carte enregistrée de
 * Gagnon » ← « supprime la carte de Gagnon du pipeline » : le nom propre
 * pèse trop). Un cache raté coûte 1 ¢ ; une fausse réponse coûte la
 * confiance. Sans énoncé fourni (appelants anciens) : pas de garde.
 */
export const PART_MOTS_COMMUNS_MIN = 0.75;
export function lexicalementProche(enonce: string, memorise: string): boolean {
  const a = motsPorteurs(enonce);
  if (a.size === 0) return true;
  const b = motsPorteurs(memorise);
  let communs = 0;
  for (const m of a) if (b.has(m)) communs += 1;
  return communs / a.size >= PART_MOTS_COMMUNS_MIN;
}

export function meilleure(index: EntreeSemantique[], vec: number[], version: number | null, ageMaxMs = Infinity, maintenant = Date.now(), enonce?: string | null): { entree: EntreeSemantique; similarite: number } | null {
  let best: { entree: EntreeSemantique; similarite: number } | null = null;
  for (const e of index) {
    if (version !== null && e.version !== version) continue;
    // Expiration PAR ENTRÉE : la clé de l'index est prolongée à chaque écriture,
    // une vieille réponse survivait tant que l'org en mémorisait d'autres.
    if (maintenant - e.ts > ageMaxMs) continue;
    if (enonce && !lexicalementProche(enonce, e.enonce)) continue;
    const s = cosinus(vec, e.vec);
    if (s >= SEUIL_SIMILARITE && (!best || s > best.similarite)) best = { entree: e, similarite: s };
  }
  return best;
}

export async function chercherSemantique(p: Portee, vec: number[], version: number | null, enonce?: string | null): Promise<{ entree: EntreeSemantique; similarite: number } | null> {
  const index = (await magasin().get<EntreeSemantique[]>(cleIndex(p))) ?? [];
  return meilleure(index, vec, version, (p.genre === 'tenant' ? TTL_TENANT_S : TTL_PUBLIC_S) * 1000, Date.now(), enonce);
}

export async function memoriserSemantique(p: Portee, e: Omit<EntreeSemantique, 'ts'>): Promise<void> {
  const cle = cleIndex(p);
  const index = (await magasin().get<EntreeSemantique[]>(cle)) ?? [];
  const enonce = normaliserEnonce(e.enonce) ?? '';
  const sans = index.filter((x) => x.enonce !== enonce);
  sans.push({ ...e, enonce, ts: Date.now() });
  while (sans.length > MAX_ENTREES) sans.shift();
  await magasin().set(cle, sans, p.genre === 'tenant' ? TTL_TENANT_S : TTL_PUBLIC_S);
}

/** Repli : la réponse mémorisée pour cet énoncé n'était pas la bonne. */
export async function oublierSemantique(p: Portee, enonce: string): Promise<void> {
  const cle = cleIndex(p);
  const index = (await magasin().get<EntreeSemantique[]>(cle)) ?? [];
  const n = normaliserEnonce(enonce) ?? '';
  const reste = index.filter((x) => x.enonce !== n);
  if (reste.length !== index.length) await magasin().set(cle, reste, p.genre === 'tenant' ? TTL_TENANT_S : TTL_PUBLIC_S);
}
