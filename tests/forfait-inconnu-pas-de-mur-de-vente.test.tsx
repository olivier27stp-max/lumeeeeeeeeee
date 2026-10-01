// @vitest-environment jsdom
/**
 * Un forfait qu'on n'a pas pu LIRE n'est pas un forfait qui n'inclut rien.
 *
 * Audit du 2026-10-01 (constat majeur actions-05, observé à l'écran) : bureau
 * sous forfait Autopilot, `GET /api/billing/plans` répond 500. L'abonnement,
 * lui, est bien lu — mais sans son forfait joint, et la liste des forfaits est
 * vide : le forfait courant devient `null`, et l'éditeur d'automatisations est
 * remplacé par la fenêtre de vente « Passer à Scale ». Un client qui paie se
 * fait proposer d'acheter ce qu'il a déjà, et l'état reste en cache.
 *
 * Abonnement présent + forfait introuvable = on ne sait pas : on laisse passer
 * (le serveur revérifie les droits à chaque appel) et on ne met rien en cache.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  plans: vi.fn(),
  courant: vi.fn(),
}));
vi.mock('../src/lib/billingApi', () => ({
  fetchPlans: () => api.plans(),
  fetchCurrentBilling: () => api.courant(),
}));

import { usePlanFeature, invalidatePlanFeatureCache } from '../src/hooks/usePlanFeature';

const AUTOPILOT = { id: 'p-autopilot', slug: 'autopilot', monthly_price_usd: 299, includes_automations: true };
const STARTER = { id: 'p-starter', slug: 'starter', monthly_price_usd: 49, includes_automations: false };

function Sonde() {
  const { hasFeature, loading } = usePlanFeature('includes_automations');
  return <p data-testid="etat">{loading ? 'chargement' : hasFeature ? 'ouvert' : 'mur-de-vente'}</p>;
}

let conteneur: HTMLDivElement;
let racine: Root | null = null;
async function monter(): Promise<string> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => { racine!.render(<Sonde />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return conteneur.querySelector('[data-testid="etat"]')!.textContent ?? '';
}
async function demonter() {
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
}

beforeEach(() => { invalidatePlanFeatureCache(); api.plans.mockReset(); api.courant.mockReset(); });
afterEach(demonter);

describe('forfait illisible', () => {
  it('abonnement lu sans son forfait + liste des forfaits en panne → l’écran reste ouvert', async () => {
    api.plans.mockRejectedValue(new Error('500'));
    api.courant.mockResolvedValue({ subscription: { id: 's1', plan_id: AUTOPILOT.id, status: 'active' }, billing_profile: null });
    expect(await monter()).toBe('ouvert');
  });

  it('rien n’est gardé en cache : au montage suivant, la panne passée, le vrai forfait s’applique', async () => {
    api.plans.mockRejectedValueOnce(new Error('500'));
    api.courant.mockResolvedValue({ subscription: { id: 's1', plan_id: STARTER.id, status: 'active' }, billing_profile: null });
    expect(await monter()).toBe('ouvert');
    await demonter();
    // La liste des forfaits répond de nouveau : le forfait Starter n'inclut pas les automatisations.
    api.plans.mockResolvedValue([STARTER, AUTOPILOT]);
    expect(await monter()).toBe('mur-de-vente');
    expect(api.plans).toHaveBeenCalledTimes(2);
  });
});

describe('forfait lu : rien ne change', () => {
  it('forfait qui inclut la fonction → ouvert', async () => {
    api.plans.mockResolvedValue([STARTER, AUTOPILOT]);
    api.courant.mockResolvedValue({ subscription: { id: 's1', plan_id: AUTOPILOT.id, status: 'active' }, billing_profile: null });
    expect(await monter()).toBe('ouvert');
  });

  it('forfait qui ne l’inclut pas → mur de vente', async () => {
    api.plans.mockResolvedValue([STARTER, AUTOPILOT]);
    api.courant.mockResolvedValue({ subscription: { id: 's1', plan_id: STARTER.id, status: 'active', plans: STARTER }, billing_profile: null });
    expect(await monter()).toBe('mur-de-vente');
  });

  it('aucun abonnement (réponse valide) → mur de vente, même si la liste des forfaits est en panne', async () => {
    api.plans.mockRejectedValue(new Error('500'));
    api.courant.mockResolvedValue({ subscription: null, billing_profile: null });
    expect(await monter()).toBe('mur-de-vente');
  });
});
