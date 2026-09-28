// @vitest-environment jsdom
//
// Réglages → Étiquettes et sélecteur commun (étape 2 du plan étiquettes +
// champs, 2026-09-28).
//
// · la page liste chaque étiquette avec sa couleur et son nombre de clients ;
// · renommer vers un nom existant demande de FUSIONNER ;
// · supprimer annonce combien de clients sont touchés ;
// · le sélecteur n'offre « Créer » qu'à qui a « Réglages » (décision D3) ;
// · le catalogue ne s'écrit qu'avec « Réglages » (route et policies).
import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { api, confirmerMock } = vi.hoisted(() => {
const LISTE = [
  { nom: 'Printemps', couleur: '#22c55e', nb_clients: 3, catalogue: true },
  { nom: 'VIP', couleur: '#ef4444', nb_clients: 12, catalogue: true },
];
const api = {
  listerEtiquettes: vi.fn(async () => LISTE),
  creerEtiquette: vi.fn(async (nom: string) => ({ nom, couleur: '#6366f1', existait: false })),
  modifierEtiquette: vi.fn(async (_n: string, c: any) => ({ ok: true, nom: c.nouveau_nom ?? _n, nb_clients: 15 })),
  supprimerEtiquette: vi.fn(async () => ({ ok: true, retiree_de: 12 })),
};
return { api, confirmerMock: vi.fn(async (_o: any) => true) };
});
vi.mock('../src/lib/etiquettesApi', () => ({
  ...api,
  COULEUR_ETIQUETTE_DEFAUT: '#64748b',
  couleurDe: (l: any[] | undefined, n: string) => l?.find((x) => x.nom.toLowerCase() === n.toLowerCase())?.couleur ?? '#64748b',
}));
vi.mock('../src/components/ui/ConfirmDialog', () => ({ confirmer: (o: any) => confirmerMock(o) }));
let perms: { role: string | null; permissions: Record<string, boolean> | null } = { role: 'owner', permissions: {} };
vi.mock('../src/hooks/usePermissions', () => ({ usePermissions: () => perms }));
vi.mock('../src/i18n', () => ({ useTranslation: () => ({ language: 'fr', t: {} }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import EtiquettesSettings from '../src/pages/settings/EtiquettesSettings';
import SelecteurEtiquettes from '../src/components/etiquettes/SelecteurEtiquettes';

let hote: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;
const monter = async (el: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    racine.render(<QueryClientProvider client={qc}><MemoryRouter>{el}</MemoryRouter></QueryClientProvider>);
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const saisir = async (el: HTMLInputElement, v: string) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const bouton = (label: string) => hote.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

beforeEach(() => {
  hote = document.createElement('div'); document.body.appendChild(hote); racine = createRoot(hote);
  perms = { role: 'owner', permissions: {} };
  vi.clearAllMocks();
});
afterEach(() => { act(() => racine.unmount()); hote.remove(); });

describe('Réglages → Étiquettes', () => {
  it('liste chaque étiquette avec son nombre de clients et un lien vers la liste Clients filtrée', async () => {
    await monter(<EtiquettesSettings />);
    expect(hote.textContent).toContain('VIP');
    expect(hote.textContent).toContain('12 client(s)');
    const lien = [...hote.querySelectorAll('a')].find((a) => a.textContent?.includes('12 client'));
    expect(lien?.getAttribute('href')).toBe('/clients?etiquette=VIP');
  });

  it('renommer vers un nom existant demande de FUSIONNER, puis appelle le renommage', async () => {
    await monter(<EtiquettesSettings />);
    await act(async () => { bouton('Renommer Printemps').click(); });
    const champ = hote.querySelector<HTMLInputElement>('input[aria-label="Nouveau nom pour Printemps"]')!;
    await saisir(champ, 'vip');
    await act(async () => { champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(confirmerMock).toHaveBeenCalledTimes(1);
    expect(confirmerMock.mock.calls[0][0].title).toMatch(/Fusionner/);
    expect(api.modifierEtiquette).toHaveBeenCalledWith('Printemps', { nouveau_nom: 'VIP' });
  });

  it('supprimer annonce le nombre de clients touchés', async () => {
    await monter(<EtiquettesSettings />);
    await act(async () => { bouton('Supprimer VIP').click(); });
    expect(confirmerMock.mock.calls[0][0].message).toContain('12 client(s)');
    expect(confirmerMock.mock.calls[0][0].message).toContain('Aucun client n’est supprimé');
    expect(api.supprimerEtiquette).toHaveBeenCalledWith('VIP');
  });
});

describe('sélecteur commun', () => {
  const ouvrir = async () => {
    const plus = [...hote.querySelectorAll('button')].find((b) => b.textContent?.includes('Étiquette'))!;
    await act(async () => { plus.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    return hote.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  };

  it('suggère les étiquettes existantes non posées', async () => {
    await monter(<SelecteurEtiquettes valeurs={['VIP']} onAjouter={vi.fn()} onRetirer={vi.fn()} fr />);
    const champ = await ouvrir();
    await saisir(champ, 'pr');
    const options = [...hote.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    // « VIP » est déjà posée : jamais proposée. La dernière option est « Créer » (propriétaire).
    expect(options[0]).toBe('Printemps');
    expect(options.some((o) => o === 'VIP')).toBe(false);
  });

  it('avec « Réglages » : « Créer » est offert pour un nom nouveau', async () => {
    await monter(<SelecteurEtiquettes valeurs={[]} onAjouter={vi.fn()} onRetirer={vi.fn()} fr />);
    const champ = await ouvrir();
    await saisir(champ, 'Urgent');
    expect(hote.textContent).toContain('Créer « Urgent »');
  });

  it('sans « Réglages » : pas de « Créer », une explication à la place', async () => {
    perms = { role: 'sales_rep', permissions: { 'settings.update': false } };
    await monter(<SelecteurEtiquettes valeurs={[]} onAjouter={vi.fn()} onRetirer={vi.fn()} fr />);
    const champ = await ouvrir();
    await saisir(champ, 'Urgent');
    expect(hote.textContent).not.toContain('Créer « Urgent »');
    expect(hote.textContent).toContain('Seuls les administrateurs créent de nouvelles étiquettes');
  });
});

describe('le catalogue ne s’écrit qu’avec « Réglages »', () => {
  it('routes', () => {
    const src = readFileSync(resolve(__dirname, '../server/lib/route-permissions.ts'), 'utf8');
    for (const r of ["'POST /api/etiquettes'", "'PATCH /api/etiquettes'", "'POST /api/etiquettes/supprimer'"]) {
      expect(src).toContain(`${r}: 'settings.update'`);
    }
    expect(src).not.toContain("'GET /api/etiquettes'");
  });

  it('policies et fonctions (service_role seulement)', () => {
    const sql = readFileSync(resolve(__dirname, '../supabase/migrations/20261001140000_reglages_etiquettes.sql'), 'utf8');
    expect(sql.match(/member_has_permission\(\(select auth\.uid\(\)\), org_id, 'settings\.update'\)/g)?.length).toBe(4);
    for (const f of ['etiquettes_de_l_org(uuid)', 'etiquette_renommer(uuid, text, text)', 'etiquette_supprimer(uuid, text)']) {
      expect(sql).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
    }
  });
});
