/**
 * Tarifs des modèles Claude (API Anthropic, $ US par million de tokens) et
 * calcul du coût d'un appel. Source : tableau des modèles au 2026-06-24.
 *
 * Lecture en cache = 10 % du prix d'entrée ; écriture en cache = 125 %.
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
  'claude-opus-5':   { input: 5,  output: 25, cacheRead: 0.5,  cacheWrite: 6.25 },
  'claude-sonnet-5': { input: 2,  output: 10, cacheRead: 0.2,  cacheWrite: 2.5 },
  'claude-haiku-4-5': { input: 1, output: 5,  cacheRead: 0.1,  cacheWrite: 1.25 },
};

export const MODELE_PAR_DEFAUT = 'claude-opus-5';

export interface UsageTokens {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Coût d'un appel en cents (décimaux). Modèle inconnu → tarif Opus 5, jamais 0. */
export function coutEnCents(model: string, u: UsageTokens): number {
  const t = TARIFS[model] ?? TARIFS[MODELE_PAR_DEFAUT];
  const dollars =
    (u.input_tokens * t.input
      + u.output_tokens * t.output
      + (u.cache_read_input_tokens ?? 0) * t.cacheRead
      + (u.cache_creation_input_tokens ?? 0) * t.cacheWrite) / 1_000_000;
  return Math.round(dollars * 100 * 10_000) / 10_000;
}

export function modeleLumi(env: NodeJS.ProcessEnv = process.env): string {
  const m = (env.LUMI_MODEL || '').trim();
  return m && TARIFS[m] ? m : MODELE_PAR_DEFAUT;
}
