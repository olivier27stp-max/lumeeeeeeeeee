// @vitest-environment jsdom
//
// Rendu réel de la grille Réglages → Bureaux → Accès : ligne propriétaire
// figée, un menu par personne et bureau, retrait confirmé avant l'appel.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const A = 'org-a';
const B = 'org-b';
const matrice = {
  caller_id: 'owner-1',
  offices: [
    { id: A, name: 'Coquin lavage', is_current: true },
    { id: B, name: 'Vision Lavage', is_current: false },
  ],
  people: [
    { user_id: 'owner-1', full_name: 'Olivier', avatar_url: null, email: 'o@x.test', is_owner: true,
      access: { [A]: { role: 'owner', status: 'active' }, [B]: { role: 'owner', status: 'active' } } },
    { user_id: 'rep-1', full_name: 'Sophie', avatar_url: null, email: 's@x.test', is_owner: false,
      access: { [A]: { role: 'sales_rep', status: 'active' } } },
    { user_id: 'tech-1', full_name: 'Liam', avatar_url: null, email: 'l@x.test', is_owner: false,
      access: { [A]: { role: 'technician', status: 'active' }, [B]: { role: 'technician', status: 'suspended' } } },
  ],
};

const getOfficeAccess = vi.fn(async () => matrice);
const setOfficeAccess = vi.fn(async () => undefined);
const confirmer = vi.fn(async () => true);

vi.mock('../src/lib/officesApi', () => ({
  getOfficeAccess: () => getOfficeAccess(),
  setOfficeAccess: (...a: unknown[]) => setOfficeAccess(...(a as [])),
}));
vi.mock('../src/components/ui/ConfirmDialog', () => ({ confirmer: (o: unknown) => confirmer(o as never) }));
vi.mock('../src/i18n', () => ({ useTranslation: () => ({ language: 'fr', t: {} }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import OfficeAccessGrid from '../src/components/offices/OfficeAccessGrid';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<OfficeAccessGrid />); });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

// Le tableau (ordinateur) vient en premier dans le DOM.
const tableau = () => container.querySelector('table')!;
const menu = (label: string) =>
  tableau().querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);

async function choisir(sel: HTMLSelectElement, valeur: string) {
  await act(async () => {
    // Setter natif : React ignore une affectation directe de .value.
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, valeur);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('OfficeAccessGrid', () => {
  it('une colonne par bureau, le propriétaire sans menu', () => {
    const entetes = Array.from(tableau().querySelectorAll('th')).map((t) => t.textContent);
    expect(entetes).toEqual(['Personne', 'Coquin lavage', 'Vision Lavage']);
    const ligneProprio = Array.from(tableau().querySelectorAll('tbody tr'))[0];
    expect(ligneProprio.textContent).toContain('Olivier');
    expect(ligneProprio.querySelectorAll('select').length).toBe(0);
    expect(ligneProprio.textContent).toContain('Propriétaire');
  });

  it('montre le rôle actuel et « Aucun accès » là où la personne n\'est pas', () => {
    expect(menu('Accès de Sophie au bureau Coquin lavage')!.value).toBe('sales_rep');
    expect(menu('Accès de Sophie au bureau Vision Lavage')!.value).toBe('');
  });

  it('une adhésion suspendue renvoie vers Membres au lieu d\'un menu', () => {
    expect(menu('Accès de Liam au bureau Vision Lavage')).toBeNull();
    expect(tableau().textContent).toContain('Retiré (voir Membres)');
  });

  it('donner un bureau appelle l\'API sans confirmation', async () => {
    await choisir(menu('Accès de Sophie au bureau Vision Lavage')!, 'sales_rep');
    expect(confirmer).not.toHaveBeenCalled();
    expect(setOfficeAccess).toHaveBeenCalledWith('rep-1', B, 'sales_rep');
    expect(getOfficeAccess).toHaveBeenCalledTimes(2); // rechargement après écriture
  });

  it('retirer l\'accès demande confirmation, et rien ne part si on annule', async () => {
    confirmer.mockResolvedValueOnce(false);
    await choisir(menu('Accès de Sophie au bureau Coquin lavage')!, '');
    expect(confirmer).toHaveBeenCalledTimes(1);
    expect(setOfficeAccess).not.toHaveBeenCalled();

    await choisir(menu('Accès de Sophie au bureau Coquin lavage')!, '');
    expect(setOfficeAccess).toHaveBeenCalledWith('rep-1', A, null);
  });
});
