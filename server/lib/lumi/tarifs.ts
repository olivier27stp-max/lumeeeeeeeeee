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
  'claude-opus-5':   { input: 5,  output: 25, cacheRead: 0.5,  cacheWrite: 10 },
  'claude-sonnet-5': { input: 2,  output: 10, cacheRead: 0.2,  cacheWrite: 4 },
  'claude-haiku-4-5': { input: 1, output: 5,  cacheRead: 0.1,  cacheWrite: 2 },
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

/** Tarif le plus cher : un modèle inconnu est facturé à ce prix, jamais 0 (on ne sous-compte pas). */
const TARIF_PLANCHER = TARIFS['claude-opus-5'];

/** Coût d'un appel en cents (décimaux). Modèle inconnu → tarif Opus 5, jamais 0. */
export function coutEnCents(model: string, u: UsageTokens): number {
  const t = TARIFS[model] ?? TARIF_PLANCHER;
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
