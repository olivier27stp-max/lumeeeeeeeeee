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

/** Client Anthropic partagé (clé `ANTHROPIC_API_KEY`), construit au premier usage. */
export function clientAnthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export function isLumiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.ANTHROPIC_API_KEY;
}
