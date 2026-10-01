// @vitest-environment jsdom
/**
 * Un refus de permission s'AFFICHE en phrase lisible, pas en clé technique.
 *
 * Audit du 2026-10-01 (constat roles-12) : un membre sans le droit voyait
 * « Permission denied: automations.update » dans un toast. Le serveur joint
 * maintenant `message` (français) et `message_en` ; les deux clients d'API des
 * automatisations les préfèrent à `error`.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('../../src/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'jeton' } } }) } },
}));
vi.mock('../../src/lib/orgApi', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getCurrentOrgId: async () => '11111111-1111-4111-8111-111111111111',
}));

import { messageDuServeur } from '../../src/lib/messageDuServeur';
import { lireEtatPause } from '../../src/lib/automationWebhooksApi';
import { changerPublication } from '../../src/lib/automationBuilderApi';

const REFUS = {
  error: 'Permission denied: automations.update',
  message: 'Votre rôle ne permet pas de modifier les automatisations.',
  message_en: 'Your role does not allow editing automations.',
  permission: 'automations.update',
};
const repondre = (statut: number, corps: unknown) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(
  new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } }),
);

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('messageDuServeur', () => {
  it('préfère la phrase lisible au texte technique', () => {
    expect(messageDuServeur(REFUS)).toBe('Votre rôle ne permet pas de modifier les automatisations.');
  });
  it('interface en anglais : la phrase anglaise', () => {
    localStorage.setItem('lume-language', 'en');
    expect(messageDuServeur(REFUS)).toBe('Your role does not allow editing automations.');
  });
  it('sans phrase lisible : le texte du serveur, comme avant', () => {
    expect(messageDuServeur({ error: 'Automatisation introuvable.' })).toBe('Automatisation introuvable.');
  });
  it('corps inexploitable : null (à l’appelant de donner son repli)', () => {
    expect(messageDuServeur(null)).toBeNull();
    expect(messageDuServeur('<html>')).toBeNull();
    expect(messageDuServeur({ error: 42 })).toBeNull();
    expect(messageDuServeur({ error: '   ' })).toBeNull();
  });
});

describe('les clients d’API des automatisations montrent la phrase lisible', () => {
  it('pause globale (automationWebhooksApi)', async () => {
    repondre(403, REFUS);
    await expect(lireEtatPause()).rejects.toThrow('Votre rôle ne permet pas de modifier les automatisations.');
  });

  it('publication (automationBuilderApi), et le statut reste porté par l’erreur', async () => {
    repondre(403, REFUS);
    const erreur = await changerPublication('11111111-1111-4111-8111-111111111111', true).then(() => null, (e: unknown) => e as Error & { status?: number });
    expect(erreur?.message).toBe('Votre rôle ne permet pas de modifier les automatisations.');
    expect(erreur?.status).toBe(403);
  });
});
