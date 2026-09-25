/**
 * Tarifs des modèles Claude (API Anthropic, $ US par million de tokens) et
 * calcul du coût d'un appel. Source : tableau des modèles au 2026-06-24.
 *
 * Lecture en cache = 10 % du prix d'entrée ; écriture en cache = 200 %
 * (points de cache d'UNE HEURE dans l'orchestrateur ; une écriture 5 min
 * coûterait 125 %, on n'en fait plus).
 * Le coût est gardé en cents avec décimales : un tour de conversation coûte
 * souvent moins d'un cent, l'arrondir à zéro fausserait le budget.
 */
export interface TarifModele {
  input: number;       // $ / 1M tokens
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const TARIFS: Record<string, TarifModele> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 1,   cacheWrite: 20 },
  'claude-opus-5':   { input: 5,  output: 25, cacheRead: 0.5,  cacheWrite: 10 },
  'claude-sonnet-5': { input: 2,  output: 10, cacheRead: 0.2,  cacheWrite: 4 },
  'claude-haiku-4-5': { input: 1, output: 5,  cacheRead: 0.1,  cacheWrite: 2 },
  /**
   * Gemini (transcription vocale et plongements), relevé le 2026-09-22 sur
   * https://ai.google.dev/gemini-api/docs/pricing — palier payant.
   *
   * Deux pièges vérifiés à la source plutôt que supposés :
   *  - 2.5 Pro ne distingue PAS l'audio : un token d'audio est facturé au
   *    même prix qu'un token de texte (1,25 $/M). 2.5 Flash, lui, facture
   *    l'audio à part (1,00 $/M contre 0,30 $ pour le texte) — c'est le tarif
   *    audio qu'on retient ici, puisque ce modèle ne sert qu'à transcrire.
   *  - les prix de Pro DOUBLENT au-delà de 200 k tokens de prompt (2,50 $ /
   *    15 $). Une dictée est bornée à 60 s, soit ~1 500 tokens : on reste
   *    toujours dans le premier palier. Si un jour un appel Gemini dépasse
   *    200 k, ce tarif sous-comptera — à revoir ce jour-là.
   *
   * `cacheWrite` à 0 : ces appels n'écrivent rien en cache (aucun
   * `cachedContent` n'est créé), donc la colonne ne sert pas.
   */
  'gemini-2.5-pro':   { input: 1.25, output: 10,   cacheRead: 0.125, cacheWrite: 0 },
  'gemini-2.5-flash': { input: 1,    output: 2.5,  cacheRead: 0.1,   cacheWrite: 0 },
  'gemini-embedding-001': { input: 0.2, output: 0, cacheRead: 0,     cacheWrite: 0 },
};

/**
 * Sonnet 5 par défaut (décision Rafba 2026-09-10) : les tâches Lumi sont
 * toujours les mêmes (chercher, compter, créer un suivi, envoyer un devis) et
 * Opus 5 coûtait 2,5× plus cher pour la même réponse. LUMI_MODEL permet de
 * remonter sur Opus sans redéployer.
 */
export const MODELE_PAR_DEFAUT = 'claude-sonnet-5';

export interface UsageTokens {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  /**
   * Détail des écritures en cache renvoyé par l'API : 5 min (125 % du tarif
   * d'entrée) ou 1 h (200 %). Le prompt et les outils sont en 1 h, la
   * conversation en 5 min : sans ce détail, on se comptait la conversation
   * 60 % trop cher.
   */
  cache_creation?: { ephemeral_1h_input_tokens: number; ephemeral_5m_input_tokens: number } | null;
}

/**
 * Un modèle facturé dont le tarif n'est PAS dans TARIFS. Depuis le
 * 2026-09-22, la table couvre Claude ET Gemini : la liste est donc vide, et
 * `coutEnCents` chiffre tout ce que le code appelle.
 *
 * La fonction reste — c'est le garde-fou du prochain fournisseur qu'on
 * branchera : tant qu'un modèle n'a pas de tarif relevé À LA SOURCE, il doit
 * être nommé ici plutôt que chiffré au hasard. Ne jamais deviner un prix :
 * un coût inventé est pire qu'un coût absent, parce qu'on s'y fie.
 */
export function tarifInconnu(model: string): boolean {
  const sansDate = model.replace(/-\d{8}$/, '');
  return !TARIFS[model] && !TARIFS[sansDate];
}

/** Tarif le plus cher : un modèle inconnu est facturé à ce prix, jamais 0 (on ne sous-compte pas). */
const TARIF_PLANCHER = TARIFS['claude-opus-5'];

/** Coût d'un appel en cents (décimaux). Modèle inconnu → tarif Opus 5, jamais 0. */
export function coutEnCents(model: string, u: UsageTokens): number {
  // Un id daté (« claude-haiku-4-5-20251001 ») se lit sans sa date ; sinon un modèle connu passait au tarif plancher (Haiku compté 5× trop cher le 2026-09-17).
  const t = TARIFS[model] ?? TARIFS[model.replace(/-\d{8}$/, '')] ?? TARIF_PLANCHER;
  // Sans détail (vieux journal, test), tout est compté au tarif 1 h : jamais sous-compté.
  const ecrit1h = u.cache_creation ? u.cache_creation.ephemeral_1h_input_tokens : (u.cache_creation_input_tokens ?? 0);
  const ecrit5m = u.cache_creation ? u.cache_creation.ephemeral_5m_input_tokens : 0;
  const dollars =
    (u.input_tokens * t.input
      + u.output_tokens * t.output
      + (u.cache_read_input_tokens ?? 0) * t.cacheRead
      + ecrit1h * t.cacheWrite
      + ecrit5m * t.input * 1.25) / 1_000_000;
  return Math.round(dollars * 100 * 10_000) / 10_000;
}

export function modeleLumi(env: NodeJS.ProcessEnv = process.env): string {
  const m = (env.LUMI_MODEL || '').trim();
  return m && TARIFS[m] ? m : MODELE_PAR_DEFAUT;
}
