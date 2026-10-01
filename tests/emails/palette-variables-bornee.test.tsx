// @vitest-environment jsdom
/**
 * La palette « Insérer » de l'éditeur de courriel ne mange plus l'écran.
 *
 * Audit du 2026-10-01 (constat observé à l'écran, 1440×900) : pour un courriel
 * d'automatisation, la palette alignait plus de 120 boutons — les champs de
 * base de cinq objets — sur ≈ 450 px des 810 de la fenêtre. Le courriel qu'on
 * écrivait ne tenait plus que sur quelques lignes.
 *
 * Elle a maintenant une hauteur bornée, défile, et se filtre en tapant.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../src/components/ui/ConfirmDialog', () => ({ confirmer: vi.fn(async () => true), default: () => null }));
vi.mock('../../src/hooks/useChampsPersoActifs', () => ({ useChampsPersoActifs: () => ({ isEnabled: false, loading: false }) }));
vi.mock('../../src/lib/champsPersoApi', () => ({ listerChamps: async () => ({ fields: [] }) }));
vi.mock('../../src/lib/automationRulesApi', () => ({
  updateRuleMessage: vi.fn(async () => {}),
  getCompanyBranding: async () => ({ company_name: 'Nettoyage Test' }),
}));
vi.mock('../../src/lib/emailTemplatesApi', () => ({
  apercuCourriel: async () => '<p>aperçu</p>',
  envoyerEssaiCourriel: async () => 'proprio@lume-qa.test',
}));
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }));

import EmailPreviewEditor from '../../src/components/automations/EmailPreviewEditor';

let conteneur: HTMLDivElement;
let racine: Root | null = null;

async function monter(props: { typeCourriel?: string } = {}) {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    racine!.render(
      <QueryClientProvider client={qc}>
        <EmailPreviewEditor
          ruleId="r1" ruleName="Merci" subject="Merci" fr
          body="<h2>Bonjour,</h2><p>Merci de votre confiance.</p>"
          onClose={() => {}} onSaved={() => {}} declencheur="lead.created" {...props}
        />
      </QueryClientProvider>,
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const palette = () => document.body.querySelector('[data-testid="palette-variables"]') as HTMLElement;
const boutonsPalette = () => Array.from(palette().querySelectorAll('button'));
const recherche = () => document.body.querySelector('input[type="search"]') as HTMLInputElement | null;
async function taper(champ: HTMLInputElement, texte: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(champ, texte);
    champ.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

afterEach(async () => {
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
});

describe('palette « Insérer » d’un courriel d’automatisation', () => {
  it('toutes les variables restent offertes, dans une zone à hauteur bornée qui défile', async () => {
    await monter();
    // 98 champs de base à eux seuls (≈ 120 avec les champs personnalisés du bureau). Aucun n'est retiré — ils défilent.
    expect(boutonsPalette().length).toBeGreaterThan(90);
    expect(palette().className).toContain('max-h-[72px]');
    expect(palette().className).toContain('overflow-y-auto');
  });

  it('un champ « Chercher une variable » réduit la liste, sans accent ni casse', async () => {
    await monter();
    const total = boutonsPalette().length;
    const champ = recherche();
    expect(champ?.getAttribute('aria-label')).toBe('Chercher une variable à insérer');
    await taper(champ!, 'TELEPHONE');
    const restants = boutonsPalette();
    expect(restants.length).toBeGreaterThan(0);
    expect(restants.length).toBeLessThan(total / 4);
    for (const b of restants) {
      const lu = `${b.textContent} ${b.title}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      expect(lu).toMatch(/telephone|phone/);
    }
  });

  it('une variable trouvée par la recherche s’insère dans le courriel', async () => {
    await monter();
    await taper(recherche()!, 'prénom');
    const bouton = boutonsPalette()[0];
    const ecriture = bouton.title;
    expect(ecriture.length).toBeGreaterThan(2);
    await act(async () => { bouton.click(); });
    const zones = Array.from(document.body.querySelectorAll('textarea')).map((t) => t.value);
    expect(zones.some((z) => z.includes(ecriture))).toBe(true);
  });

  it('une recherche sans résultat le dit, au lieu d’une zone vide', async () => {
    await monter();
    await taper(recherche()!, 'zzzzqq');
    expect(boutonsPalette()).toHaveLength(0);
    expect(palette().textContent).toContain('Aucune variable à ce nom.');
  });

  it('effacer la recherche rend toute la liste', async () => {
    await monter();
    const total = boutonsPalette().length;
    await taper(recherche()!, 'adresse');
    expect(boutonsPalette().length).toBeLessThan(total);
    await taper(recherche()!, '');
    expect(boutonsPalette()).toHaveLength(total);
  });
});

describe('palette d’un modèle de courriel à peu de variables', () => {
  it('pas de champ de recherche quand la liste tient en quelques boutons', async () => {
    await monter({ typeCourriel: 'review_request' });
    if (boutonsPalette().length <= 12) expect(recherche()).toBeNull();
    else expect(recherche()).not.toBeNull();
  });
});
