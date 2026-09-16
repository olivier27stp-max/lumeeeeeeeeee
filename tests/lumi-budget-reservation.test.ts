/**
 * Plafond dur du budget IA (audit Lumi B4) : réservation avant l'appel,
 * règlement après, message gabarit au palier épuisé, repli sans la RPC.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('../server/lib/supabase', () => ({ companyOrgIds: async (_a: unknown, orgId: string) => [orgId], getServiceClient: () => ({}) }));
import { estimationCoutAppel, reserverBudget, reglerBudget, messagePause, dateRemiseAZero, SEUIL_ECONOME, SEUIL_RESTREINT } from '../server/lib/lumi/budget';

function adminRpc(reponse: (fn: string, args: any) => { data?: unknown; error?: { code?: string; message: string } | null }) {
  const appels: Array<[string, any]> = [];
  return { appels, admin: { rpc: vi.fn(async (fn: string, args: any) => { appels.push([fn, args]); return { data: null, error: null, ...reponse(fn, args) }; }) } as any };
}

describe('estimation du coût maximal d un appel', () => {
  it('est pessimiste : entrée au tarif plein + sortie au plafond', () => {
    // Sonnet 5 : (10 000 car. / 3,5 + 3 000 outils) × 2 $/M + 4 096 × 10 $/M ≈ 0,117 + 4,1 ¢
    const c = estimationCoutAppel('claude-sonnet-5', 10_000, 4096);
    expect(c).toBeGreaterThan(4.096);
    expect(c).toBeLessThan(6);
    // Haiku : sortie à 5 $/M au lieu de 10 $ → environ la moitié.
    expect(estimationCoutAppel('claude-haiku-4-5', 10_000, 4096)).toBeLessThan(c / 1.8);
  });
});

describe('réservation / règlement', () => {
  it('ok → id renvoyé puis réglé au coût réel', async () => {
    const { admin, appels } = adminRpc((fn) => (fn === 'reserve_ai_budget' ? { data: { status: 'ok', reservation_id: 'r1' } } : {}));
    const r = await reserverBudget(admin, 'org-1', 5.7);
    expect(r).toEqual({ id: 'r1', statut: 'ok' });
    await reglerBudget(admin, r.id, 0.4321);
    expect(appels).toEqual([
      ['reserve_ai_budget', { p_org: 'org-1', p_cents: 5.7, p_proactive: false }],
      ['settle_ai_budget', { p_reservation: 'r1', p_cost: 0.4321 }],
    ]);
  });
  it('capped → aucun id, et rien à régler', async () => {
    const { admin, appels } = adminRpc(() => ({ data: { status: 'capped', reservation_id: null } }));
    const r = await reserverBudget(admin, 'org-1', 5);
    expect(r).toEqual({ id: null, statut: 'capped' });
    await reglerBudget(admin, r.id, 1);
    expect(appels.filter(([fn]) => fn === 'settle_ai_budget')).toHaveLength(0);
  });
  it('RPC absente (migration pas appliquée) → indisponible, jamais une exception', async () => {
    const { admin } = adminRpc(() => ({ error: { code: 'PGRST202', message: 'Could not find the function public.reserve_ai_budget' } }));
    expect(await reserverBudget(admin, 'org-1', 5)).toEqual({ id: null, statut: 'indisponible' });
  });
  it('autre erreur → exception (on ne devine pas un budget)', async () => {
    const { admin } = adminRpc(() => ({ error: { code: '42501', message: 'permission denied' } }));
    await expect(reserverBudget(admin, 'org-1', 5)).rejects.toThrow(/permission denied/);
  });
});

describe('message gabarit au palier épuisé', () => {
  it('nomme le 1er du mois suivant, en fr et en en', () => {
    const t = new Date('2026-09-16T15:00:00Z');
    expect(dateRemiseAZero('fr', t)).toBe('1er octobre');
    expect(dateRemiseAZero('en', t)).toBe('October 1');
    expect(messagePause('fr', t)).toBe("Ton assistant IA avancé est en pause jusqu'au 1er octobre. Les actions rapides marchent toujours.");
    expect(messagePause('en', t)).toContain('paused until October 1');
    // Décembre → 1er janvier de l'année suivante.
    expect(dateRemiseAZero('fr', new Date('2026-12-20T15:00:00Z'))).toBe('1er janvier');
  });
  it('seuils du mandat : 70 % et 90 %', () => {
    expect(SEUIL_ECONOME).toBe(0.7);
    expect(SEUIL_RESTREINT).toBe(0.9);
  });
});
