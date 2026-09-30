// @vitest-environment jsdom
//
// CRÉDITS LUMI — Paramètres › Facturation et page de prix, sur les VRAIS
// composants (2026-09-30).
//
//   · Facturation : section « Crédits Lumi » (restants, renouvellement,
//     historique par jour, par utilisateur SEULEMENT si le serveur le
//     fournit), en crédits — aucun « $ » dans la section ;
//   · rétrogradation depuis Autopilot : on perd des crédits Lumi, pas un
//     agent « illimité » ;
//   · page de prix : « 1 000 crédits Lumi / mois » pour Autopilot, rien pour
//     Scale, et plus aucun « Illimité / Unlimited » pour Lumi.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../src/lib/supabase', () => {
  const auth = {
    getUser: vi.fn(async () => ({ data: { user: null } })),
    getSession: vi.fn(async () => ({ data: { session: null } })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    updateUser: vi.fn(async () => ({})),
  };
  return { supabase: { auth } };
});

const plan = (over: Record<string, unknown>) => ({
  id: 'p', slug: 'x', name: 'X', name_fr: 'X', monthly_price_usd: 0, monthly_price_cad: 0, yearly_price_usd: 0, yearly_price_cad: 0,
  features: [], max_clients: null, max_jobs_per_month: null, is_active: true, sort_order: 0, seats_included: 10, ...over,
});
const SCALE = plan({ id: 'p-pro', slug: 'pro', name: 'Scale', name_fr: 'Scale', sort_order: 2, monthly_price_cad: 34700, includes_ai: false, lumi_credits_mensuels: 0, features: ['Everything in Minimum'] });
// Autopilot porte encore l'ANCIEN libellé en base : il doit s'afficher sous le nouveau.
const AUTOPILOT = plan({ id: 'p-auto', slug: 'autopilot', name: 'Autopilot', name_fr: 'Autopilot', sort_order: 3, monthly_price_cad: 49500, seats_included: 20, includes_ai: true, lumi_credits_mensuels: 1000, features: ['Everything in Scale', 'Lume AI Agent (voice + unlimited)'] });

let planCourant: any = AUTOPILOT;
vi.mock('../src/lib/billingApi', () => ({
  fetchPlans: vi.fn(async () => [SCALE, AUTOPILOT]),
  fetchCurrentBilling: vi.fn(async () => ({
    subscription: {
      id: 's1', plan_id: planCourant.id, plans: planCourant, status: 'active', interval: 'monthly', currency: 'CAD',
      amount_cents: planCourant.monthly_price_cad, current_period_start: '2026-09-12T00:00:00Z', current_period_end: '2026-11-12T00:00:00Z',
    },
    billing_profile: null,
  })),
  changePlan: vi.fn(async () => ({})),
  openCustomerPortal: vi.fn(async () => ({ url: '' })),
  cancelScheduledChange: vi.fn(async () => ({ message: '' })),
}));
vi.mock('../src/components/SeatsBanner', () => ({ default: () => null }));

let historiqueServi: any;
const chargerCredits = vi.fn(async () => ({
  inclus: true, total: 1000, utilises: 258, restants: 742, pourcentage: 26,
  renouvellement_le: '2026-11-12', palier: 'normal', avertissement: null,
}));
vi.mock('../src/lib/lumiCreditsApi', async () => {
  const vrai = await vi.importActual<Record<string, unknown>>('../src/lib/lumiCreditsApi');
  return { ...vrai, chargerCreditsLumi: () => chargerCredits(), chargerHistoriqueCreditsLumi: vi.fn(async () => historiqueServi) };
});

// Page de prix : le formulaire de démo et la région ne sont pas l'objet du test.
vi.mock('../src/components/marketing/BookDemoForm', () => ({ default: () => null }));
vi.mock('../src/hooks/useRegion', () => ({ useRegion: () => ({ currency: 'CAD', region: 'CA', setRegion: () => {} }) }));
vi.mock('../src/hooks/usePageMeta', () => ({ usePageMeta: () => {} }));

import BillingSettings from '../src/pages/settings/BillingSettings';
import Pricing from '../src/pages/marketing/Pricing';
import { LanguageProvider } from '../src/i18n';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  planCourant = AUTOPILOT;
  chargerCredits.mockClear();
  historiqueServi = {
    periode_debut: '2026-10-12', renouvellement_le: '2026-11-12',
    par_jour: [{ jour: '2026-10-12', credits: 4.5 }, { jour: '2026-10-13', credits: 0 }, { jour: '2026-10-14', credits: 12.3 }],
    par_utilisateur: null,
  };
  localStorage.setItem('lume-language', 'fr');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function rendre(el: React.ReactElement) {
  await act(async () => {
    root.render(<MemoryRouter><LanguageProvider>{el}</LanguageProvider></MemoryRouter>);
  });
  for (let i = 0; i < 3; i++) await act(async () => {});
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ');
const section = () => container.querySelector('section[aria-labelledby="credits-lumi-titre"]') as HTMLElement | null;
function cliquer(texte: string) {
  const b = Array.from(container.querySelectorAll('button')).find((x) => x.textContent?.includes(texte));
  if (!b) throw new Error(`Aucun bouton « ${texte} »`);
  act(() => { b.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

describe('Paramètres › Facturation — section « Crédits Lumi »', () => {
  it('FR : restants sur total, renouvellement, barre, historique par jour — en crédits seulement', async () => {
    await rendre(<BillingSettings />);
    const s = section();
    expect(s, 'la section Crédits Lumi est affichée pour un forfait qui inclut Lumi').not.toBeNull();
    const t = norm(s!.textContent);
    expect(t).toContain('Crédits Lumi');
    expect(t).toContain('742');
    expect(t).toContain('sur 1 000');
    expect(t).toContain('Renouvellement le 12 novembre 2026');
    expect(t).toContain('ne sont pas reportés');
    const b = s!.querySelector('[role="progressbar"]')!;
    expect(b.getAttribute('aria-valuenow')).toBe('742');
    expect(b.getAttribute('aria-valuemax')).toBe('1000');
    // Historique : une barre par jour, lisible au lecteur d'écran.
    const jours = s!.querySelectorAll('[data-testid="credits-par-jour"] li');
    expect(jours.length).toBe(3);
    expect(norm(jours[0].textContent)).toBe('12 oct. : 4,5 crédits Lumi');
    expect(norm(jours[2].textContent)).toBe('14 oct. : 12,3 crédits Lumi');
    // Pas de par-utilisateur si le serveur ne le fournit pas (pas external_agent.admin).
    expect(t).not.toContain('Par utilisateur');
    expect(s!.querySelector('[data-testid="credits-par-utilisateur"]')).toBeNull();
    // Jamais de dollars d'IA.
    expect(t).not.toContain('$');
    expect(t).not.toMatch(/budget/i);
  });

  it('par utilisateur : affiché quand l’API le fournit', async () => {
    historiqueServi = { ...historiqueServi, par_utilisateur: [{ user_id: 'u1', nom: 'Will Hébert', credits: 120.5 }, { user_id: 'u2', nom: 'Rafba', credits: 40 }] };
    await rendre(<BillingSettings />);
    const t = norm(section()!.textContent);
    expect(t).toContain('Par utilisateur');
    expect(t).toContain('Will Hébert');
    expect(t).toContain('120,5 crédits Lumi');
    expect(t).not.toContain('$');
  });

  it('EN : « 742 left · of 1,000 », renews on November 12, 2026', async () => {
    localStorage.setItem('lume-language', 'en');
    await rendre(<BillingSettings />);
    const t = norm(section()!.textContent);
    expect(t).toContain('Lumi credits');
    expect(t).toContain('of 1,000');
    expect(t).toContain('Renews on November 12, 2026');
    expect(t).not.toContain('$');
  });

  it('forfait sans Lumi (Scale) : pas de section, pas d’appel', async () => {
    planCourant = SCALE;
    await rendre(<BillingSettings />);
    expect(section()).toBeNull();
    expect(chargerCredits).not.toHaveBeenCalled();
  });

  it('rétrograder depuis Autopilot : on perd des crédits Lumi, jamais un agent « illimité »', async () => {
    await rendre(<BillingSettings />);
    // Carte de forfait : l'ancien libellé en base s'affiche sous le nouveau.
    cliquer('Changer ou rétrograder mon plan');
    await act(async () => {});
    expect(norm(container.textContent)).toContain('Agent IA Lume (voix) — 1 000 crédits Lumi / mois');
    cliquer('Rétrograder vers Scale');
    await act(async () => {});
    const t = norm(container.textContent);
    expect(t).toContain('Lumi, l’assistant IA (1 000 crédits Lumi / mois)');
    expect(t).not.toMatch(/illimit|unlimited/i);
  });
});

describe('page de prix', () => {
  it('FR : Autopilot « 1 000 crédits Lumi / mois », Scale sans Lumi, aucun « Illimité »', async () => {
    await rendre(<Pricing />);
    const t = norm(container.textContent);
    expect(t).toContain('1 000 crédits Lumi / mois');
    expect(t).not.toMatch(/illimit/i);
    expect(t).not.toContain('Quota mensuel');
    const ligne = Array.from(container.querySelectorAll('tr')).find((tr) => tr.textContent?.includes('Lumi, l\'assistant IA — texte et voix'));
    expect(ligne, 'une seule ligne claire pour Lumi dans le comparatif').toBeTruthy();
    const cellules = ligne!.querySelectorAll('td');
    // [libellé, Minimum, Scale, Autopilot]
    expect(norm(cellules[2].textContent)).toBe('');
    expect(cellules[2].querySelector('.pr-no')).not.toBeNull();
    expect(norm(cellules[3].textContent)).toBe('1 000 crédits Lumi / mois');
  });

  it('EN : « 1,000 Lumi credits / month », no « Unlimited »', async () => {
    localStorage.setItem('lume-language', 'en');
    await rendre(<Pricing />);
    const t = norm(container.textContent);
    expect(t).toContain('1,000 Lumi credits / month');
    expect(t).not.toMatch(/unlimited/i);
    expect(t).not.toContain('Monthly quota');
  });
});
