// @vitest-environment jsdom
//
// Une page gardée par PlanFeatureGate ne doit être montée qu'UNE fois, même
// quand le forfait en cache a expiré. Signalé le 2026-09-30 : « Optimiser la
// journée » (Calendrier → /lumi?action=…) n'affichait rien. Le forfait était en
// cache depuis plus de 30 s ; la revérification repassait `loading` à true, la
// garde affichait un sablier et DÉMONTAIT Lumi, qui avait déjà vidé son lien
// et lancé l'action — le remontage n'avait plus rien à faire.
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../src/i18n', () => ({ useTranslation: () => ({ language: 'fr', t: {} }) }));
vi.mock('../src/components/PlanUpgradeModal', () => ({ default: () => null }));

const autopilot = { id: 'p1', monthly_price_usd: 99, includes_ai: true };
let reponse: () => Promise<unknown> = async () => ({ subscription: { plan_id: 'p1', plans: autopilot } });
vi.mock('../src/lib/billingApi', () => ({
  fetchPlans: async () => [autopilot],
  fetchCurrentBilling: () => reponse(),
}));

import PlanFeatureGate from '../src/components/PlanFeatureGate';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let hote: HTMLDivElement | null = null;
afterEach(() => { act(() => racine?.unmount()); hote?.remove(); racine = null; hote = null; vi.restoreAllMocks(); });

let montages = 0;
function Page() {
  useEffect(() => { montages++; }, []);
  return <p>page</p>;
}

async function ouvrir() {
  hote = document.createElement('div');
  document.body.appendChild(hote);
  racine = createRoot(hote);
  await act(async () => { racine!.render(<PlanFeatureGate flag="includes_ai"><Page /></PlanFeatureGate>); });
  // Laisse la revérification du forfait aboutir.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe('PlanFeatureGate — forfait en cache expiré', () => {
  it('la page n’est montée qu’une fois quand le forfait est revérifié en arrière-plan', async () => {
    // 1re visite : remplit le cache.
    await ouvrir();
    act(() => racine?.unmount()); hote?.remove();

    // 31 s plus tard (cache expiré), on revient sur une page gardée.
    const maintenant = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(maintenant + 31_000);
    let liberer: () => void = () => {};
    reponse = () => new Promise((r) => { liberer = () => r({ subscription: { plan_id: 'p1', plans: autopilot } }); });
    montages = 0;
    await ouvrir();
    expect(hote!.textContent).toBe('page');
    await act(async () => { liberer(); await new Promise((r) => setTimeout(r, 0)); });

    expect(hote!.textContent).toBe('page');
    expect(montages).toBe(1);
  });
});
