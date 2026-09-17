// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * L'adresse de facturation est une VRAIE entité (properties.kind = 'billing',
 * une par client), distincte des adresses de service. Le composant :
 *   - case cochée (défaut) → les factures utilisent l'adresse de service ;
 *   - décochée → l'adresse de facturation apparaît ; s'il n'y en a pas encore,
 *     l'éditeur s'ouvre directement.
 * Ce test suivait l'ancien composant (bouton role="switch" + champ texte) et
 * échouait depuis la refonte ; il reproduit maintenant le contrat actuel.
 */

const updateClientMock = vi.fn(async (...args: any[]) => ({ id: args[0], ...args[1] }));
const getClientByIdMock = vi.fn(async (id: string) => ({ id }));
vi.mock('../src/lib/clientsApi', () => ({
  updateClient: (...args: any[]) => updateClientMock(...args),
  getClientById: (id: string) => getClientByIdMock(id),
}));

let billingProperty: any = null;
vi.mock('../src/lib/propertiesApi', () => ({
  getBillingProperty: vi.fn(async () => billingProperty),
  upsertBillingProperty: vi.fn(async () => ({})),
  removeBillingProperty: vi.fn(async () => ({})),
}));

// L'autocomplétion (Google Places) est remplacée par un simple <input>
// portant le même placeholder : c'est ce que le test interroge.
vi.mock('../src/components/AddressAutocomplete', () => ({
  default: (props: any) => (
    <input
      value={props.value}
      onChange={(e: any) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      aria-label={props.placeholder}
    />
  ),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { BillingAddressSection } from '../src/components/BillingAddressSection';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  updateClientMock.mockClear();
  getClientByIdMock.mockClear();
  billingProperty = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderWith(client: any) {
  await act(async () => {
    root.render(<BillingAddressSection client={client} fr onUpdated={() => {}} />);
  });
  // Laisse le chargement de la propriété de facturation se terminer.
  await act(async () => {});
}

const CASE = () => container.querySelector('input[type="checkbox"]') as HTMLInputElement;
const ADDR_INPUT = () =>
  container.querySelector('input[placeholder="Adresse de facturation"]') as HTMLInputElement | null;

describe('BillingAddressSection', () => {
  it('masque tout tant que « identique à l’adresse de service » est coché', async () => {
    await renderWith({ id: 'c1', billing_same_as_service: true, billing_address: null });
    expect(CASE().checked).toBe(true);
    expect(ADDR_INPUT()).toBeNull();
    expect(container.textContent).not.toContain('Ajouter une adresse de facturation');
  });

  it('décocher enregistre le drapeau et ouvre l’éditeur quand aucune adresse n’existe', async () => {
    await renderWith({ id: 'c1', billing_same_as_service: true, billing_address: null });
    await act(async () => {
      CASE().click();
    });
    expect(updateClientMock).toHaveBeenCalledWith('c1', { billing_same_as_service: false });
    expect(CASE().checked).toBe(false);
    // Pas d'adresse de facturation → l'éditeur s'ouvre directement.
    expect(ADDR_INPUT()).not.toBeNull();
  });

  it('affiche l’adresse de facturation existante quand elle diffère', async () => {
    billingProperty = { id: 'p9', kind: 'billing', address: '99 Billing St', city: 'Laval' };
    await renderWith({ id: 'c1', billing_same_as_service: false, billing_address: '99 Billing St' });
    expect(CASE().checked).toBe(false);
    expect(container.textContent).toContain('99 Billing St');
    // Au repos, pas d'éditeur : la ligne + Modifier / Retirer.
    expect(ADDR_INPUT()).toBeNull();
    expect(container.querySelector('button[aria-label="Modifier l’adresse de facturation"]')).not.toBeNull();
  });
});
