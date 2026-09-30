// @vitest-environment jsdom
/**
 * Régression (Rafba, 2026-09-29 : « quand je clique sur étiquette il se passe
 * absolument rien ») : Modal remettait le focus sur la fenêtre à CHAQUE rendu du
 * parent (onClose instable en dépendance de l'effet). Un champ ouvert par un clic
 * perdait le focus et se refermait aussitôt.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../src/i18n', () => ({ useTranslation: () => ({ t: { common: { close: 'Fermer' } }, language: 'fr' }) }));
import Modal from '../src/components/ui/Modal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLDivElement;
afterEach(() => { act(() => racine?.unmount()); conteneur?.remove(); racine = null; });

function Parent() {
  const [n, setN] = useState(0);
  return (
    // onClose recréé à chaque rendu, comme chez la plupart des appelants.
    <Modal open title="Test" onClose={() => {}}>
      <input aria-label="champ" />
      <button type="button" onClick={() => setN(n + 1)}>rendre {n}</button>
    </Modal>
  );
}

const image = () => new Promise((r) => setTimeout(r, 40));

describe('Modal — le focus ne saute pas au rendu du parent', () => {
  it('un champ qui a le focus le garde quand le parent se re-rend', async () => {
    conteneur = document.createElement('div');
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    await act(async () => { racine!.render(<Parent />); });
    await act(async () => { await image(); });
    const champ = conteneur.querySelector('input[aria-label="champ"]') as HTMLInputElement;
    champ.focus();
    expect(document.activeElement).toBe(champ);
    const bouton = [...conteneur.querySelectorAll('button')].find((b) => /rendre/.test(b.textContent ?? '')) as HTMLButtonElement;
    // Le rendu du parent ne doit pas voler le focus (le clic lui-même ne le prend pas : on refocalise avant).
    await act(async () => { bouton.click(); champ.focus(); });
    await act(async () => { await image(); });
    expect(document.activeElement).toBe(champ);
  });
});
