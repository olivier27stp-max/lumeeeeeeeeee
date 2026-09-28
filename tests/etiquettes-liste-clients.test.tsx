// @vitest-environment jsdom
//
// Liste Clients — filtre « Étiquettes » (étape 3 du plan étiquettes + champs).
//
// Réglages → Étiquettes envoie vers /clients?etiquette=<nom> : ce lien ne
// filtrait RIEN (le paramètre était ignoré). Le filtre doit partir EN BASE
// (listClients) pour que la pagination et le total restent justes — filtrer
// la seule page chargée montrerait « 3 clients » sur 20 000.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };

vi.mock('../src/i18n', () => ({
  useTranslation: () => ({
    language: 'fr',
    t: {
      clients: new Proxy({}, { get: (_c, k) => String(k) }),
      common: new Proxy({}, { get: (_c, k) => String(k) }),
    },
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));
vi.mock('../src/hooks/usePermissions', () => ({ usePermissions: () => ({ role: 'owner', permissions: {} }) }));
vi.mock('../src/lib/orgApi', () => ({ getCurrentOrgIdOrThrow: async () => 'org-1', getCurrentOrgId: async () => 'org-1' }));

/** Un faux constructeur PostgREST : toute méthode chaîne, l'attente rend les lignes de la table. */
function requete(table: string): any {
  const lignes = table === 'client_tags'
    ? [{ client_id: 'c1', tag: 'Été à faire' }, { client_id: 'c1', tag: 'VIP' }]
    : [];
  const q: any = new Proxy({}, {
    get: (_c, k) => (k === 'then'
      ? (ok: (v: unknown) => unknown) => Promise.resolve({ data: lignes, error: null, count: lignes.length }).then(ok)
      : () => q),
  });
  return q;
}
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: (t: string) => requete(t),
    rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }), getUser: async () => ({ data: { user: { id: 'u' } } }) },
  },
}));

const listClientsMock = vi.fn(async (..._a: any[]) => ({
  items: [{ id: 'c1', first_name: 'Zoé', last_name: 'Zèbre', company: null, status: 'lead', created_at: '2026-09-01T00:00:00Z' }],
  total: 1,
}) as any);
vi.mock('../src/lib/clientsApi', async () => {
  const reel = await vi.importActual<any>('../src/lib/clientsApi');
  return { ...reel, listClients: (...a: any[]) => listClientsMock(...a) };
});

vi.mock('../src/lib/champsPersoApi', async () => {
  const reel = await vi.importActual<any>('../src/lib/champsPersoApi');
  return {
    ...reel,
    listerChamps: async () => ({ fields: [], folders: [] }),
    lireValeursLot: async () => ({}),
    filtrerParChamps: async () => [],
    lireFuseau: async () => 'America/Toronto',
  };
});
vi.mock('../src/lib/colonnesTableauApi', async () => {
  const reel = await vi.importActual<any>('../src/lib/colonnesTableauApi');
  return { ...reel, lireColonnesTableau: async () => null, enregistrerColonnesTableau: async () => {} };
});
vi.mock('../src/lib/etiquettesApi', async () => {
  const reel = await vi.importActual<any>('../src/lib/etiquettesApi');
  return {
    ...reel,
    listerEtiquettes: async () => [
      { nom: 'Été à faire', couleur: '#f59e0b', nb_clients: 1, catalogue: true },
      { nom: 'VIP', couleur: '#dc2626', nb_clients: 1, catalogue: true },
    ],
  };
});

import Clients from '../src/pages/Clients';

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;
let adresse = '';

function Adresse() {
  const l = useLocation();
  adresse = `${l.pathname}${l.search}`;
  return null;
}

async function laisserRepondre() {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function rendre(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    racine.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[url]}>
          <Adresse />
          <Routes><Route path="/clients" element={<Clients />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await laisserRepondre();
}

const boutons = () => [...conteneur.querySelectorAll('button')] as HTMLButtonElement[];
const dernierFiltre = () => listClientsMock.mock.calls.at(-1)?.[0]?.etiquettes ?? null;

beforeEach(() => {
  listClientsMock.mockClear();
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

describe('liste Clients — filtre « Étiquettes »', () => {
  it('?etiquette= (encodé) filtre EN BASE dès l’arrivée', async () => {
    await rendre(`/clients?etiquette=${encodeURIComponent('Été à faire')}`);
    expect(listClientsMock).toHaveBeenCalled();
    // Tous les appels, pas seulement le dernier : jamais une page non filtrée d'abord.
    for (const [q] of listClientsMock.mock.calls) expect(q.etiquettes).toEqual({ noms: ['Été à faire'], mode: 'une' });
    const pastille = boutons().find((b) => b.getAttribute('aria-controls') && /Étiquettes/.test(b.textContent ?? ''));
    expect(pastille?.textContent).toContain('Été à faire');
  });

  it('sans paramètre : aucun filtre ; la colonne montre les étiquettes en couleur', async () => {
    await rendre('/clients');
    expect(dernierFiltre()).toBeNull();
    const groupe = conteneur.querySelector('[role="group"][aria-label^="Étiquettes :"]')!;
    expect(groupe.getAttribute('aria-label')).toBe('Étiquettes : Été à faire, VIP');
    const vip = [...groupe.querySelectorAll('span[style]')].find((s) => s.textContent === 'VIP') as HTMLElement;
    expect(vip.style.backgroundColor).toBe('rgb(220, 38, 38)');
  });

  it('choisir dans le panneau : au moins une / toutes ; × retire le filtre et nettoie l’URL', async () => {
    await rendre('/clients?etiquette=VIP');
    const pastille = () => boutons().find((b) => b.getAttribute('aria-controls') && /Étiquettes/.test(b.textContent ?? ''))!;
    await act(async () => { pastille().click(); });
    await laisserRepondre();
    const ete = boutons().find((b) => b.getAttribute('aria-pressed') !== null && b.textContent?.includes('Été à faire'))!;
    await act(async () => { ete.click(); });
    await laisserRepondre();
    expect(dernierFiltre()).toEqual({ noms: ['VIP', 'Été à faire'], mode: 'une' });
    // Le lien d'arrivée ne revient pas une fois le filtre changé.
    expect(adresse).toBe('/clients');
    const mode = [...conteneur.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'toutes')) as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(mode, 'toutes');
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await laisserRepondre();
    expect(dernierFiltre()).toEqual({ noms: ['VIP', 'Été à faire'], mode: 'toutes' });
    await act(async () => { boutons().find((b) => b.getAttribute('aria-label') === 'Retirer le filtre d’étiquettes')!.click(); });
    await laisserRepondre();
    expect(dernierFiltre()).toBeNull();
  });
});
