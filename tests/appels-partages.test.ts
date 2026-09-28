/**
 * Appels partagés au chargement d'une page.
 *
 * Mesuré en prod le 2026-09-28 sur Automatisations : /api/features ×3 et
 * /api/billing/current ×3, lancés en même temps — ils encombraient le serveur
 * et ralentissaient toute la page. Un seul appel doit partir par rafale.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'jeton' } } }) } },
}));
vi.mock('../src/lib/orgApi', () => ({ bureauActifSync: () => 'bureau-1' }));
vi.mock('../src/lib/deviceToken', () => ({ deviceTokenHeader: () => ({}) }));

let appels: string[] = [];
let reponse: () => Response;

beforeEach(async () => {
  vi.resetModules();
  appels = [];
  reponse = () => new Response(JSON.stringify({ flags: { ventes: { enabled: true } }, subscription: null }), { status: 200 });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    appels.push(String(url));
    await new Promise((r) => setTimeout(r, 10));
    return reponse();
  }));
});

describe('/api/features', () => {
  it('trois demandes simultanées → un seul appel', async () => {
    const { lireFlagsModules } = await import('../src/lib/featuresApi');
    const r = await Promise.all([lireFlagsModules(), lireFlagsModules(), lireFlagsModules()]);
    expect(appels.filter((u) => u.includes('/api/features'))).toHaveLength(1);
    expect(r.every((x) => x.ok)).toBe(true);
  });

  it('une demande juste après reprend la réponse gardée', async () => {
    const { lireFlagsModules } = await import('../src/lib/featuresApi');
    await lireFlagsModules();
    await lireFlagsModules();
    expect(appels).toHaveLength(1);
  });

  it('un échec n’est PAS gardé : la demande suivante repart', async () => {
    const { lireFlagsModules } = await import('../src/lib/featuresApi');
    reponse = () => new Response('{}', { status: 500 });
    expect((await lireFlagsModules()).ok).toBe(false);
    reponse = () => new Response(JSON.stringify({ flags: {} }), { status: 200 });
    expect((await lireFlagsModules()).ok).toBe(true);
    expect(appels).toHaveLength(2);
  });

  it('activer un module vide le cache', async () => {
    const { lireFlagsModules, oublierFlagsModules } = await import('../src/lib/featuresApi');
    await lireFlagsModules();
    oublierFlagsModules();
    await lireFlagsModules();
    expect(appels).toHaveLength(2);
  });
});

describe('/api/billing/current', () => {
  it('trois demandes simultanées → un seul appel', async () => {
    const { fetchCurrentBilling } = await import('../src/lib/billingApi');
    await Promise.all([fetchCurrentBilling(), fetchCurrentBilling(), fetchCurrentBilling()]);
    expect(appels.filter((u) => u.includes('/billing/current'))).toHaveLength(1);
  });

  it('rien n’est gardé après la réponse : l’appel suivant repart', async () => {
    const { fetchCurrentBilling } = await import('../src/lib/billingApi');
    await fetchCurrentBilling();
    await fetchCurrentBilling();
    expect(appels.filter((u) => u.includes('/billing/current'))).toHaveLength(2);
  });
});
