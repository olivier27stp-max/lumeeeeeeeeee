// @vitest-environment jsdom
/**
 * Une langue qu'on n'a pas pu LIRE n'est pas « Français ».
 *
 * Audit du 2026-10-01 (constat liste-05) : bureau réglé en anglais, lecture de
 * `company_settings` en panne (500). `getAutomationLanguage` ignorait l'erreur
 * de la requête et répondait « fr » : la liste surlignait « FR » et la page
 * « Réglages globaux » affichait « Français » — l'écran affirmait que les
 * messages partaient en français alors qu'ils partaient en anglais.
 *
 * La lecture ratée remonte maintenant comme une erreur, et les écrans disent
 * qu'ils ne savent pas.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base = vi.hoisted(() => ({
  reponse: { data: { default_language: 'en' } as { default_language: string } | null, error: null as { message: string } | null },
}));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => base.reponse }) }) }),
    auth: {
      getUser: async () => ({ data: { user: null } }),
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock('../../src/lib/orgApi', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getCurrentOrgId: async () => '11111111-1111-4111-8111-111111111111',
}));
vi.mock('../../src/components/automations/AdressesDAppel', () => ({ default: () => null }));
vi.mock('../../src/components/PermissionGate', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../src/i18n', () => ({ useTranslation: () => ({ language: 'fr', t: {} }) }));
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, info: () => {} } }));

import { getAutomationLanguage } from '../../src/lib/automationRulesApi';
import AutomationsReglages from '../../src/pages/AutomationsReglages';

let conteneur: HTMLDivElement;
let racine: Root | null = null;
async function monterReglages(): Promise<string> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => { racine!.render(<MemoryRouter><AutomationsReglages /></MemoryRouter>); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return conteneur.textContent ?? '';
}
beforeEach(() => {
  base.reponse = { data: { default_language: 'en' }, error: null };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
  vi.mocked(console.error).mockRestore?.();
});

describe('getAutomationLanguage', () => {
  it('rend la langue lue', async () => {
    expect(await getAutomationLanguage()).toBe('en');
    base.reponse = { data: { default_language: 'fr' }, error: null };
    expect(await getAutomationLanguage()).toBe('fr');
  });

  it('une lecture en ERREUR remonte — elle ne devient pas « fr »', async () => {
    base.reponse = { data: null, error: { message: 'canceling statement due to statement timeout' } };
    await expect(getAutomationLanguage()).rejects.toThrow(/statement timeout/);
  });

  it('aucun réglage enregistré (réponse valide, sans ligne) : français, la langue par défaut de Lume', async () => {
    base.reponse = { data: null, error: null };
    expect(await getAutomationLanguage()).toBe('fr');
  });
});

describe('page « Réglages globaux »', () => {
  it('langue lue : elle est affichée', async () => {
    const ecran = await monterReglages();
    expect(ecran).toContain('English');
    expect(ecran).not.toContain('Impossible de lire la langue');
  });

  it('langue illisible : l’écran le dit, et n’affiche ni « Français » ni « English »', async () => {
    base.reponse = { data: null, error: { message: '500' } };
    const ecran = await monterReglages();
    expect(ecran).toContain('Impossible de lire la langue pour le moment.');
    expect(ecran).not.toMatch(/>?Français<?/);
    expect(conteneur.querySelector('[data-testid="langue-des-messages"]')).toBeNull();
  });
});
