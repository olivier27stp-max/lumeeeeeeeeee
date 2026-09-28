// @vitest-environment jsdom
//
// « Accès restreint » ne doit JAMAIS s'afficher pendant que le bureau se
// charge. Signalé le 2026-09-28 : un propriétaire voyait l'écran de refus sur
// Automatisations le temps que la lecture de ses adhésions aboutisse.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../src/i18n', () => ({ useTranslation: () => ({ language: 'fr', t: {} }) }));

import PermissionGate from '../src/components/PermissionGate';
import { CompanyContext } from '../src/contexts/CompanyContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let hote: HTMLDivElement | null = null;
afterEach(() => { act(() => racine?.unmount()); hote?.remove(); racine = null; hote = null; });

function rendre(valeur: Record<string, unknown>) {
  hote = document.createElement('div');
  document.body.appendChild(hote);
  racine = createRoot(hote);
  act(() => racine!.render(
    <CompanyContext.Provider value={valeur as never}>
      <PermissionGate permission={'automations.read' as never}><p>contenu</p></PermissionGate>
    </CompanyContext.Provider>,
  ));
  return hote.textContent ?? '';
}

describe('PermissionGate pendant le chargement du bureau', () => {
  it('lecture en reprise (aucun bureau encore, mais pas « aucune compagnie ») → rien, pas de refus', () => {
    const texte = rendre({ loading: false, current: null, hasNoCompany: false, userId: 'u1' });
    expect(texte).not.toContain('Accès restreint');
  });

  it('un compte qui n’a VRAIMENT aucune compagnie → refus', () => {
    const texte = rendre({ loading: false, current: null, hasNoCompany: true, userId: 'u1' });
    expect(texte).toContain('Accès restreint');
  });

  it('propriétaire chargé → contenu', () => {
    const texte = rendre({
      loading: false, hasNoCompany: false, userId: 'u1',
      current: { orgId: 'o1', teamId: null, departmentId: null, managerId: null },
      currentRole: 'owner', currentPermissions: null, currentScope: 'all',
    });
    expect(texte).toContain('contenu');
  });
});

describe('la reprise de lecture garde le chargement', () => {
  it('le nouvel essai est ATTENDU : le finally ne coupe plus le chargement pendant la reprise', () => {
    const src = readFileSync(resolve(__dirname, '../src/contexts/CompanyContext.tsx'), 'utf8');
    expect(src).toMatch(/return await fetchMemberships\(essai \+ 1\);/);
  });
});
