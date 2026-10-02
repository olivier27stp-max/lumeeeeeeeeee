/**
 * CE QU'UNE ERREUR DU SERVEUR PORTE JUSQU'À L'ÉDITEUR, et ce que l'éditeur
 * envoie au serveur — `src/lib/automationBuilderApi.ts`, le vrai module, un
 * `fetch` simulé.
 *
 * L'éditeur décide de quoi faire d'un échec d'après sa FORME : le statut (404,
 * 409, 429…), le `code` du refus, le rang des étapes que le refus désigne, le
 * délai que le serveur demande avant un nouvel essai.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'jeton-de-test' } } }) } },
}));
vi.mock('../../../src/lib/orgApi', () => ({ getCurrentOrgId: async () => '11111111-1111-1111-1111-111111111111' }));

import { modifierAutomatisation, changerPublication } from '../../../src/lib/automationBuilderApi';

const reponse = (status: number, corps: unknown, entetes: Record<string, string> = {}) =>
  new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json', ...entetes } });

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });
const corpsEnvoye = () => JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>;

describe('A-09 — la garde de version voyage avec la modification', () => {
  it('avec une version lue : le corps du PATCH porte `version_lue`', async () => {
    fetchMock.mockResolvedValue(reponse(200, { id: 'r-1', updated_at: 'V2' }));
    await modifierAutomatisation('r-1', { name: 'x' }, 'V1');
    expect(corpsEnvoye()).toEqual({ name: 'x', version_lue: 'V1' });
  });

  it('sans version lue : le corps est celui d’avant (aucune garde)', async () => {
    fetchMock.mockImplementation(async () => reponse(200, { id: 'r-1' }));
    await modifierAutomatisation('r-1', { name: 'x' });
    expect(corpsEnvoye()).toEqual({ name: 'x' });
    fetchMock.mockClear();
    await modifierAutomatisation('r-1', { name: 'x' }, null);
    expect(corpsEnvoye()).toEqual({ name: 'x' });
  });

  it('409 « modifiée ailleurs » : l’erreur porte le statut ET le code du refus', async () => {
    fetchMock.mockResolvedValue(reponse(409, { error: 'Cette automatisation a été modifiée ailleurs (par Lumi ou dans un autre onglet).', code: 'modifiee_ailleurs', updated_at: 'V9' }));
    const erreur = await modifierAutomatisation('r-1', { name: 'x' }, 'V1').catch((e: unknown) => e);
    expect((erreur as Error).message).toBe('Cette automatisation a été modifiée ailleurs (par Lumi ou dans un autre onglet).');
    expect(erreur).toMatchObject({ status: 409, code: 'modifiee_ailleurs' });
  });

  it('publier rend la version de la règle après le changement ; rien quand le serveur ne la donne pas', async () => {
    fetchMock.mockResolvedValue(reponse(200, { id: 'r-1', is_active: true, updated_at: 'V3' }));
    expect(await changerPublication('r-1', true)).toBe('V3');
    fetchMock.mockResolvedValue(reponse(200, { id: 'r-1', is_active: true }));
    expect(await changerPublication('r-1', true)).toBeUndefined();
  });
});

describe('12-enregistrement:86 — un 429 dit quand réessayer', () => {
  it('`Retry-After: 5` → `retryApresMs: 5000`', async () => {
    fetchMock.mockResolvedValue(reponse(429, { error: 'Too many requests. Please try again later.' }, { 'Retry-After': '5' }));
    const erreur = await modifierAutomatisation('r-1', { name: 'x' }).catch((e: unknown) => e);
    expect(erreur).toMatchObject({ status: 429, retryApresMs: 5000 });
  });

  it('sans en-tête : pas de délai inventé', async () => {
    fetchMock.mockResolvedValue(reponse(429, { error: 'Too many requests. Please try again later.' }));
    const erreur = await modifierAutomatisation('r-1', { name: 'x' }).catch((e: unknown) => e);
    expect((erreur as { status?: number }).status).toBe(429);
    expect(erreur).not.toHaveProperty('retryApresMs');
  });
});

describe('S-04 — un refus de validation désigne ses étapes', () => {
  it('`details[].path` (`steps`, n, …) → le rang des étapes fautives, sans doublon', async () => {
    fetchMock.mockResolvedValue(reponse(400, {
      error: 'Étape 2 (« Créer une tâche ») : « À faire dans (jours) » doit être au plus 365.',
      details: [
        { message: 'a', path: ['steps', 1, 'action', 'config', 'echeance_jours'] },
        { message: 'b', path: ['steps', 1, 'action', 'config', 'title'] },
        { message: 'c', path: ['steps', 3, 'delai_secondes'] },
        { message: 'd', path: ['name'] },
        { message: 'e', path: ['steps'] },
      ],
    }));
    const erreur = await modifierAutomatisation('r-1', { steps: [] }).catch((e: unknown) => e);
    expect(erreur).toMatchObject({ status: 400, etapes: [1, 3] });
  });

  it('un refus qui ne nomme aucune étape : pas de liste', async () => {
    fetchMock.mockResolvedValue(reponse(422, { error: 'Cette automatisation est publiée : cette modification l’empêcherait de fonctionner.', code: 'publiee_cassee' }));
    const erreur = await modifierAutomatisation('r-1', { steps: [] }).catch((e: unknown) => e);
    expect(erreur).toMatchObject({ status: 422, code: 'publiee_cassee' });
    expect(erreur).not.toHaveProperty('etapes');
  });
});
