/**
 * Version du prompt de Lumi (item 8, AGENTFORCE_GAP.md B10).
 * ─────────────────────────────────────────────────────────
 * Les prompts vivent dans le dépôt (orchestrateur.ts, consignesCollegue.ts,
 * promptVente.ts) : diffables, réversibles par git. Ce qui manquait : savoir,
 * pour une trace ou un run de batterie, QUELLE version du prompt a répondu.
 *
 * Règle : tout changement du bloc stable du prompt bump VERSION_PROMPT et
 * EMPREINTE_PROMPT_ATTENDUE (sha256 du bloc, 12 premiers hex). Le test
 * tests/lumi-version.test.ts recalcule l'empreinte : un prompt modifié sans
 * bump fait échouer la suite. La version voyage dans lumi_traces.prompt_version
 * et dans l'artefact de la batterie.
 */
import crypto from 'node:crypto';

export const VERSION_PROMPT = 'v2026-09-23.1';

/** Empreinte figée du bloc stable de promptSystemeLumi (fr, sans souvenirs). Recalculée par le test. */
export const EMPREINTE_PROMPT_ATTENDUE = '192893eb48ed';

export function empreintePrompt(stable: string): string {
  return crypto.createHash('sha256').update(stable, 'utf8').digest('hex').slice(0, 12);
}
