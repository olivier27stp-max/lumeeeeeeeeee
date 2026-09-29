/**
 * Launch 2026-09-28 — bloc 4 : « Construire avec Lumi » n'appelle JAMAIS le
 * modèle si le budget n'a pas pu être réservé. Avant, une panne de la
 * réservation laissait passer l'appel : l'exclusivité Autopilot (refus
 * « plan_sans_lumi », qui n'existe que dans cette réservation) et le plafond
 * du mois tombaient à chaque panne.
 */
import { describe, it, expect, vi } from 'vitest';

const appel = vi.hoisted(() => ({ create: vi.fn(async () => ({ content: [], usage: {} })) }));
vi.mock('../../server/lib/lumi/llm', () => ({ isLumiConfigured: () => true, clientAnthropic: () => ({ messages: { create: appel.create } }) }));
vi.mock('../../server/lib/lumi/budget', async (orig) => ({
  ...(await orig<any>()),
  reserverBudget: vi.fn(async () => { throw new Error('connexion perdue'); }),
  reglerBudget: vi.fn(async () => {}),
  journaliserUsage: vi.fn(async () => {}),
}));

import { genererParcours } from '../../server/lib/lumi/generer-parcours';

describe('réservation de budget Lumi en panne', () => {
  it('aucun appel au modèle, erreur claire', async () => {
    const r = await genererParcours({ admin: {} as any, orgId: 'o', userId: 'u', demande: 'Relance mes devis', langue: 'fr' });
    expect(appel.create).not.toHaveBeenCalled();
    expect(r.parcours).toBeNull();
    expect(r.erreur).toMatch(/momentanément indisponible/);
  });
});
