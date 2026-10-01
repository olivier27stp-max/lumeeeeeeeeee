/**
 * Une erreur du serveur porte son STATUT HTTP jusqu'à l'écran.
 *
 * Audit du 2026-10-01 (actions-07) : l'éditeur ne pouvait pas distinguer « cette
 * automatisation n'existe plus » (404) d'une panne passagère — toute erreur
 * arrivait comme un simple texte, et l'enregistrement automatique réessayait
 * sans fin une écriture qui ne pouvait jamais réussir.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'jeton-de-test' } } }) } },
}));
vi.mock('../../src/lib/orgApi', () => ({ getCurrentOrgId: async () => '11111111-1111-1111-1111-111111111111' }));

import { modifierAutomatisation, changerPublication } from '../../src/lib/automationBuilderApi';

const reponse = (status: number, corps: unknown) => new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json' } });

describe('automationBuilderApi — le statut HTTP accompagne le message d’erreur', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('404 sur une modification : le message du serveur ET le statut 404', async () => {
    fetchMock.mockResolvedValue(reponse(404, { error: 'Automatisation introuvable.' }));
    const erreur = await modifierAutomatisation('r-1', { name: 'x' }).catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(Error);
    expect((erreur as Error).message).toBe('Automatisation introuvable.');
    expect((erreur as { status?: number }).status).toBe(404);
  });

  it('500 sans corps lisible : le repli, avec le statut 500', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 500 }));
    const erreur = await modifierAutomatisation('r-1', { name: 'x' }).catch((e: unknown) => e);
    expect((erreur as Error).message).toBe('Impossible de modifier l\'automatisation.');
    expect((erreur as { status?: number }).status).toBe(500);
  });

  it('404 sur la publication : le statut suit aussi', async () => {
    fetchMock.mockResolvedValue(reponse(404, { error: 'Automatisation introuvable.' }));
    const erreur = await changerPublication('r-1', true).catch((e: unknown) => e);
    expect((erreur as { status?: number }).status).toBe(404);
  });
});
