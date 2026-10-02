/**
 * Agent F — constat F-08 : à zéro crédit, « Construire avec Lumi » parle de
 * « budget », pas de crédits, et ne dit pas quand ça revient.
 *
 * Partout ailleurs (page Lumi, clavardage, courriel au propriétaire) le client
 * lit « Tes crédits Lumi sont épuisés jusqu'au {date} » (budget.ts
 * `messagePause`). Dans l'éditeur d'automatisations il lit « Le budget Lumi du
 * mois est atteint » : un autre mot pour la même chose, sans date de
 * renouvellement — et « du mois » est faux, la période suit l'anniversaire de
 * l'abonnement.
 *
 * Tests purs : faux client de base, modèle remplacé (il ne doit PAS être appelé).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const etat = vi.hoisted(() => ({ appels: 0 }));
vi.mock('../../../server/lib/lumi/llm', () => ({
  isLumiConfigured: () => true,
  clientAnthropic: () => ({ messages: { create: async () => { etat.appels += 1; throw new Error('le modèle ne doit pas être appelé'); } } }),
}));

import { genererParcours } from '../../../server/lib/lumi/generer-parcours';

function baseEpuisee(statut: 'capped' | 'plan_sans_lumi') {
  const ecritures: string[] = [];
  return {
    ecritures,
    admin: {
      rpc: async (nom: string) => (nom === 'reserve_ai_budget' ? { data: { status: statut, reservation_id: null }, error: null } : { data: null, error: null }),
      from: (table: string) => ({ insert: async () => { ecritures.push(table); return { error: null }; }, upsert: async () => { ecritures.push(table); return { error: null }; } }),
    } as never,
  };
}
const demander = (admin: never, langue: 'fr' | 'en' = 'fr') => genererParcours({
  admin, orgId: '00000000-0000-4000-8000-00000000000a', userId: null, langue,
  demande: `Quand un devis est envoyé, attends 3 jours puis envoie un texto. (${Math.random()})`,
});

beforeEach(() => { etat.appels = 0; });

describe('« Construire avec Lumi » à zéro crédit', () => {
  it('garde-fou : rien n’est envoyé au modèle et rien n’est débité', async () => {
    const base = baseEpuisee('capped');
    const r = await demander(base.admin);
    expect(r.parcours).toBeNull();
    expect(etat.appels).toBe(0);
    expect(base.ecritures).not.toContain('ai_usage');
  });

  it('garde-fou : le message ne porte aucun montant en dollars', async () => {
    const r = await demander(baseEpuisee('capped').admin);
    expect(String(r.erreur)).not.toMatch(/\$|¢|\bcents?\b|dollars?/i);
  });

  it('F-08 — le message parle de CRÉDITS, comme le reste de Lumi', async () => {
    const r = await demander(baseEpuisee('capped').admin);
    expect(String(r.erreur)).toMatch(/crédits/i);
    expect(String(r.erreur), '« budget » n’est le mot d’aucun autre écran de Lumi').not.toMatch(/budget/i);
    const en = await demander(baseEpuisee('capped').admin, 'en');
    expect(String(en.erreur)).toMatch(/credits/i);
    expect(String(en.erreur)).not.toMatch(/budget/i);
  });

  it('garde-fou : un forfait sans Lumi est renvoyé vers Autopilot, sans appel au modèle', async () => {
    const r = await demander(baseEpuisee('plan_sans_lumi').admin);
    expect(r.sansLumi).toBe(true);
    expect(etat.appels).toBe(0);
  });
});
