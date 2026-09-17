// @vitest-environment jsdom
/**
 * Les routes citées par Lumi dans le chat de support deviennent des liens
 * (2026-09-17) : « Paramètres → Membres (/settings/team) » se clique.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TexteAvecLiens } from '../../src/components/SupportChat';

let root: Root | null = null;
let hote: HTMLDivElement | null = null;
function monter(ui: React.ReactElement) {
  hote = document.createElement('div');
  document.body.appendChild(hote);
  root = createRoot(hote);
  act(() => { root!.render(<MemoryRouter>{ui}</MemoryRouter>); });
  return hote;
}
afterEach(() => { act(() => { root?.unmount(); }); hote?.remove(); root = null; hote = null; });

describe('TexteAvecLiens', () => {
  it('rend chaque route de l app en bouton, le reste en texte, et navigue au clic', () => {
    const onNavigate = vi.fn();
    const h = monter(<TexteAvecLiens texte="Allez dans Paramètres → Membres (/settings/team), puis « Inviter un membre ». Voir aussi /finances." onNavigate={onNavigate} />);
    const boutons = [...h.querySelectorAll('button')];
    expect(boutons.map((b) => b.textContent)).toEqual(['/settings/team', '/finances']);
    act(() => { boutons[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onNavigate).toHaveBeenCalledWith('/settings/team');
    expect(h.textContent).toContain('puis « Inviter un membre »');
  });
  it('une route à paramètre ou un chemin inconnu reste du texte', () => {
    const h = monter(<TexteAvecLiens texte="Ouvrez /jobs/:id ou /admin/x ; le fichier /tmp/a.txt" />);
    expect(h.querySelectorAll('button')).toHaveLength(0);
    expect(h.textContent).toContain('/jobs/:id');
  });
});
