/**
 * Le SEUL module autorisé à instancier le SDK Anthropic (audit Lumi B1).
 * ─────────────────────────────────────────────────────────────────
 * Avant : cinq singletons `new Anthropic()` (orchestrateur, routeur,
 * cache-chaud, support, bot de migration), chacun relisant la clé. Un seul
 * client = un seul endroit pour la clé, les délais, les reprises, et plus
 * tard la journalisation uniforme. La règle est figée par le test statique
 * `tests/lumi-llm-unique.test.ts` : ailleurs dans `server/`, le SDK ne
 * s'importe qu'en `import type`.
 */
import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

/**
 * Reprises et délai, explicites (fiabilité, 2026-09-17) :
 *  - 3 reprises avec attente croissante sur 429 / 5xx / 529 « overloaded » et
 *    coupures réseau (le SDK ne rejoue jamais un 4xx applicatif) ;
 *  - 90 s par appel : au-delà, l'utilisateur a déjà abandonné ; l'échec est
 *    typé et affiché plutôt qu'un chargement sans fin.
 * Réglables sans redéploiement : LUMI_LLM_REPRISES, LUMI_LLM_DELAI_MS.
 */
export function reglagesClient(env: NodeJS.ProcessEnv = process.env): { maxRetries: number; timeout: number } {
  const reprises = Number(env.LUMI_LLM_REPRISES);
  const delai = Number(env.LUMI_LLM_DELAI_MS);
  return {
    maxRetries: Number.isInteger(reprises) && reprises >= 0 && reprises <= 6 ? reprises : 3,
    timeout: Number.isFinite(delai) && delai >= 10_000 && delai <= 600_000 ? delai : 90_000,
  };
}

/** Client Anthropic partagé (clé `ANTHROPIC_API_KEY`), construit au premier usage. */
export function clientAnthropic(): Anthropic {
  if (!client) client = new Anthropic(reglagesClient());
  return client;
}

export function isLumiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.ANTHROPIC_API_KEY;
}
