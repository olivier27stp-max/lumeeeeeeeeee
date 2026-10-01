/**
 * M-003 — une règle faite seulement d'actions sans variable ne lit pas les
 * variables de l'événement (≈ 10 requêtes de moins par événement).
 *
 * Ce garde empêche la liste de mentir : si un exécuteur se met à utiliser
 * ses variables, il doit sortir de ACTIONS_SANS_VARIABLES, sinon il recevrait
 * `{}` et enverrait des messages vides.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACTIONS_SANS_VARIABLES } from '../../../server/lib/automationEngine';

const source = readFileSync(resolve(__dirname, '../../../server/lib/actions/index.ts'), 'utf8').replace(/\r\n/g, '\n');

/** Nom de l'exécuteur de chaque type, lu dans l'aiguillage `case 'x': return f(`. */
function executeurDe(type: string): string | null {
  const m = source.match(new RegExp(String.raw`case '${type}':\s*\n\s*return (\w+)\(`));
  return m ? m[1] : null;
}

/** Liste des paramètres d'un exécuteur exporté. */
function parametresDe(nom: string): string | null {
  const m = source.match(new RegExp(String.raw`export async function ${nom}\(([\s\S]*?)\)\s*:\s*Promise`));
  return m ? m[1] : null;
}

describe('[M-003] actions sans variable — la liste dit vrai', () => {
  for (const type of ACTIONS_SANS_VARIABLES) {
    it(`[M-003] « ${type} » : son exécuteur ignore ses variables (paramètre _vars)`, () => {
      const nom = executeurDe(type);
      expect(nom, `aiguillage introuvable pour ${type}`).toBeTruthy();
      const params = parametresDe(nom!);
      expect(params, `exécuteur ${nom} introuvable`).toBeTruthy();
      // Les variables arrivent en `_vars` (jamais lues) — pas en `vars`.
      expect(params!, `${nom} : paramètre des variables`).toMatch(/(^|[\s,(])_vars\s*:/);
      expect(params!).not.toMatch(/(^|[\s,(])vars\s*:/);
    });
  }

  it('[M-003] les actions qui envoient un message ne sont PAS dans la liste', () => {
    for (const t of ['send_sms', 'send_email', 'create_task', 'create_notification', 'request_review', 'webhook', 'ajouter_note']) {
      expect(ACTIONS_SANS_VARIABLES.has(t)).toBe(false);
    }
  });
});
