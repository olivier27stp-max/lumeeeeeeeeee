// @vitest-environment jsdom
/**
 * La sous-navigation « Automatisations · Vue d'ensemble · Réglages globaux »
 * est la MÊME sur les trois pages.
 *
 * Audit du 2026-10-01 (constat liste-03) : des boutons au lieu de liens (pas
 * d'ouverture dans un nouvel onglet), et rien n'annonçait la section courante.
 * La liste a été corrigée ; « Vue d'ensemble » et « Réglages globaux »
 * gardaient leur copie en boutons. Un seul composant sert maintenant les trois.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import SousNavigation, { type SectionAutomatisations } from '../../src/components/automations/SousNavigation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root | null = null;
async function monter(courante: SectionAutomatisations, fr = true) {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => { racine!.render(<MemoryRouter><SousNavigation courante={courante} fr={fr} /></MemoryRouter>); });
}
afterEach(async () => {
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
});
const liens = () => Array.from(conteneur.querySelectorAll('nav a')) as HTMLAnchorElement[];

describe('sous-navigation des automatisations', () => {
  it('trois LIENS, vers les trois sections — aucun bouton', async () => {
    await monter('liste');
    expect(liens().map((a) => a.getAttribute('href'))).toEqual(['/automations', '/automations/apercu', '/automations/reglages']);
    expect(conteneur.querySelectorAll('nav button')).toHaveLength(0);
  });

  it.each<[SectionAutomatisations, string]>([
    ['liste', '/automations'], ['apercu', '/automations/apercu'], ['reglages', '/automations/reglages'],
  ])('sur « %s », seule cette section est annoncée comme courante', async (section, href) => {
    await monter(section);
    const courants = liens().filter((a) => a.getAttribute('aria-current') === 'page');
    expect(courants.map((a) => a.getAttribute('href'))).toEqual([href]);
  });

  it('les mêmes libellés partout, « Bêta » compris', async () => {
    await monter('reglages');
    expect(liens().map((a) => a.textContent)).toEqual(['Automatisations', 'Vue d’ensembleBêta', 'Réglages globaux']);
  });

  it('en anglais', async () => {
    await monter('apercu', false);
    expect(liens().map((a) => a.textContent)).toEqual(['Workflows', 'OverviewBeta', 'Global settings']);
  });
});

describe('les trois pages utilisent CE composant', () => {
  it.each([
    ['src/pages/Automations.tsx', 'liste'],
    ['src/pages/AutomationsApercu.tsx', 'apercu'],
    ['src/pages/AutomationsReglages.tsx', 'reglages'],
  ])('%s → courante="%s", sans copie locale de la navigation', (fichier, section) => {
    const source = readFileSync(join(process.cwd(), fichier), 'utf8');
    expect(source).toContain(`<SousNavigation courante="${section}"`);
    expect(source).not.toContain("aria-label={fr ? 'Sections' : 'Sections'}");
  });
});
