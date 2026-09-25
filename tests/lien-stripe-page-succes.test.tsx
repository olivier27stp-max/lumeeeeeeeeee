// @vitest-environment jsdom
/**
 * APRÈS UN PAIEMENT PAR LIEN STRIPE (2026-09-25).
 *
 * Un lien de paiement créé dans Stripe renvoie le client sur
 * /checkout/success?session_id=…, mais sa session ne porte pas nos
 * métadonnées (plan_id, interval). La page affichait alors un forfait vide
 * et « Renouvellement mensuel · 450 $ / mois » à un client trimestriel.
 *
 * Et le cron des abonnements figés, lancé 45 s après un déploiement qui
 * suit une migration, tombait sur le rechargement du cache PostgREST
 * (PGRST002) et sautait une journée de surveillance.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { setSession: vi.fn(), signInWithPassword: vi.fn() } } }));
vi.mock('../src/lib/billingApi', () => ({ setInitialPassword: vi.fn(), setupTaxRegion: vi.fn(), completeSetup: vi.fn() }));
vi.mock('../src/lib/storage', () => ({ uploadFile: vi.fn(), STORAGE_BUCKETS: {} }));
vi.mock('../src/components/AddressAutocomplete', () => ({ default: () => null }));

import CheckoutSetup from '../src/pages/CheckoutSetup';
import { detecterAbonnementsFiges } from '../server/lib/abonnements-figes';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

let conteneur: HTMLDivElement | null = null;
afterEach(() => { conteneur?.remove(); conteneur = null; vi.useRealTimers(); });

function rendre(interval: 'monthly' | 'quarterly' | 'yearly') {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  const racine = createRoot(conteneur);
  act(() => {
    racine.render(<CheckoutSetup sessionId="cs_x" email="a@b.c" planName="Minimum" amountCents={45000} interval={interval} currency="CAD" />);
  });
  return conteneur.textContent || '';
}

describe('page de succès : le rythme payé', () => {
  it('un client trimestriel voit « aux 3 mois », pas « mensuel »', () => {
    const texte = rendre('quarterly');
    expect(texte).toMatch(/3 mois|3 months|3 mo/);
    expect(texte).not.toMatch(/Renouvellement mensuel|Monthly renewal/);
  });

  it('non-régression : mensuel et annuel inchangés', () => {
    expect(rendre('monthly')).toMatch(/Renouvellement mensuel|Monthly renewal/);
    conteneur?.remove();
    expect(rendre('yearly')).toMatch(/Renouvellement annuel|Annual renewal/);
  });
});

describe('confirm-checkout lit le forfait sur l abonnement créé', () => {
  it('pas seulement sur les métadonnées de la session (absentes pour un lien Stripe)', () => {
    const BILLING = lire('server/routes/billing.ts');
    const corps = BILLING.slice(BILLING.indexOf("router.post('/billing/confirm-checkout'"), BILLING.indexOf("router.post('/billing/set-initial-password'"));
    expect(corps).toContain(".eq('id', processed.subscription_id)");
    expect(corps).toContain('intervalleLu(sub?.interval ?? meta.interval)');
    expect(corps).not.toContain("(meta.interval || 'monthly') as 'monthly' | 'yearly'");
  });
});

describe('abonnements figés : reprise pendant le rechargement du cache PostgREST', () => {
  function adminQuiRepond(reponses: Array<{ data: unknown; error: { code: string; message: string } | null }>) {
    let appels = 0;
    const chaine: any = {};
    for (const m of ['from', 'select', 'eq', 'not']) chaine[m] = () => chaine;
    chaine.lt = () => Promise.resolve(reponses[Math.min(appels++, reponses.length - 1)]);
    return { admin: chaine, appels: () => appels };
  }
  const PGRST002 = { code: 'PGRST002', message: 'Could not query the database for the schema cache. Retrying.' };

  it('PGRST002 puis succès → le cron termine au lieu d échouer', async () => {
    vi.useFakeTimers();
    const { admin, appels } = adminQuiRepond([{ data: null, error: PGRST002 }, { data: [], error: null }]);
    const promesse = detecterAbonnementsFiges(admin);
    await vi.runAllTimersAsync();
    await expect(promesse).resolves.toEqual({ examines: 0, figes: 0, avecStripe: 0 });
    expect(appels()).toBe(2);
  });

  it('PGRST002 qui persiste → l erreur remonte quand même (jamais de faux « rien à signaler »)', async () => {
    vi.useFakeTimers();
    const { admin, appels } = adminQuiRepond([{ data: null, error: PGRST002 }]);
    const promesse = detecterAbonnementsFiges(admin);
    const verdict = expect(promesse).rejects.toThrow(/lecture impossible/);
    await vi.runAllTimersAsync();
    await verdict;
    expect(appels()).toBe(4);
  });

  it('une autre erreur n est pas réessayée', async () => {
    const { admin, appels } = adminQuiRepond([{ data: null, error: { code: '42P01', message: 'relation absente' } }]);
    await expect(detecterAbonnementsFiges(admin)).rejects.toThrow(/lecture impossible/);
    expect(appels()).toBe(1);
  });
});
