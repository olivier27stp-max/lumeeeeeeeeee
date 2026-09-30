/**
 * Le filtre anti-injection SQL ne bloque plus les phrases normales en anglais
 * (audit des outils de Lumi, 2026-09-30) : « Delete Sophie from my clients »
 * était refusé ET l'IP bannie 60 minutes.
 */
import { describe, it, expect, vi } from 'vitest';
import { sanitizeRequestBody, containsSQLInjection, CHAMPS_TEXTE_LIBRE } from '../server/lib/security';

const passer = (body: Record<string, unknown>) => {
  const res: any = { status: vi.fn(() => res), json: vi.fn(() => res) };
  const next = vi.fn();
  sanitizeRequestBody()({ body, headers: {}, socket: {} } as any, res, next);
  return { next, res };
};

describe('texte libre et heuristique SQL', () => {
  it('les phrases de tous les jours passent dans les champs de texte', () => {
    for (const message of ['Delete Sophie Bouchard from my clients, with everything attached to her.', 'Update the address, set it to 12 rue Principale', 'Select all my tasks for tomorrow']) {
      expect(containsSQLInjection(message)).toBe(true); // l'heuristique les attrape…
      const { next, res } = passer({ message, conversation_id: null });
      expect(next).toHaveBeenCalled(); // …mais le champ de texte libre n'est pas inspecté
      expect(res.status).not.toHaveBeenCalled();
    }
  });
  it('les champs de conversation et de notes sont bien exemptés, pas les autres', () => {
    for (const k of ['message', 'note', 'notes', 'description', 'body', 'text']) expect(CHAMPS_TEXTE_LIBRE.has(k)).toBe(true);
    expect(CHAMPS_TEXTE_LIBRE.has('client_id')).toBe(false);
    expect(CHAMPS_TEXTE_LIBRE.has('status')).toBe(false);
  });
});
