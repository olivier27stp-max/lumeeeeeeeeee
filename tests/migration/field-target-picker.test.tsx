// @vitest-environment jsdom
//
// Sélecteur de champ Lume (console des migrations › Correspondances) : menu
// deux colonnes, recherche globale insensible aux accents, exclusion fixe,
// clavier, retour du focus. Rendu isolé, sans backend.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import FieldTargetPicker, { type FieldCatalog } from '../../src/components/migration/FieldTargetPicker';

const CATALOG: FieldCatalog = {
  property: [
    { field: 'address', labelFr: 'Adresse', labelEn: 'Address' },
    { field: 'city', labelFr: 'Ville', labelEn: 'City' },
    { field: 'name', labelFr: 'Nom de la propriété', labelEn: 'Property name' },
    { field: 'client_ref', labelFr: 'Client associé', labelEn: 'Client reference' },
  ],
  client: [
    { field: 'email', labelFr: 'Courriel', labelEn: 'Email' },
    { field: 'address', labelFr: 'Adresse', labelEn: 'Address' },
  ],
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
type OnChange = (entity: string | null, field: string | null) => void;
let onChange: ReturnType<typeof vi.fn<OnChange>>;

function render(props: Partial<React.ComponentProps<typeof FieldTargetPicker>> = {}) {
  act(() => {
    root.render(
      <FieldTargetPicker
        catalog={CATALOG}
        value={{ entity: 'property', field: 'address' }}
        excluded={false}
        defaultEntity="client"
        columnLabel="Adresse"
        onChange={onChange}
        {...props}
      />,
    );
  });
}

const trigger = () => container.querySelector('button')!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const search = () => dialog()!.querySelector<HTMLInputElement>('input')!;
const categories = () => Array.from(dialog()!.querySelectorAll<HTMLButtonElement>('[data-zone="category"]'));
const fields = () => Array.from(dialog()!.querySelectorAll<HTMLButtonElement>('[data-zone="field"]'));
const exclude = () => dialog()!.querySelector<HTMLButtonElement>('[data-zone="exclude"]')!;

function open() { act(() => { trigger().click(); }); }
function type(text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(search(), text);
    search().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function key(el: Element, k: string) { act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); }); }

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = () => {};
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onChange = vi.fn<OnChange>();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('FieldTargetPicker', () => {
  it('affiche « Catégorie → Champ » dans la cellule et la coche sur le champ courant', () => {
    render();
    expect(trigger().textContent).toContain('Propriétés');
    expect(trigger().textContent).toContain('Adresse');
    expect(dialog()).toBeNull();

    open();
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(search());
    const active = categories().find((c) => c.getAttribute('aria-current') === 'true');
    expect(active?.textContent).toContain('Propriétés');
    const selected = fields().find((f) => f.getAttribute('aria-selected') === 'true');
    expect(selected?.textContent).toContain('Adresse');
    expect(selected?.querySelector('svg')).not.toBeNull();
    // Regroupement visuel des champs de Propriétés.
    expect(dialog()!.textContent).toContain('Rattachement client');
  });

  it('ouvre sur la catégorie du fichier quand rien n\'est associé, et affiche l\'exclusion', () => {
    render({ value: null, excluded: true });
    expect(trigger().textContent).toContain('Ne pas importer cette colonne');
    open();
    expect(categories().find((c) => c.getAttribute('aria-current') === 'true')?.textContent).toContain('Clients');
    expect(exclude().querySelector('svg[class*="lucide-check"]')).not.toBeNull();
  });

  it('cliquer une catégorie change les champs sans fermer ; cliquer un champ applique et ferme', () => {
    render();
    open();
    act(() => { categories().find((c) => c.textContent?.includes('Clients'))!.click(); });
    expect(dialog()).not.toBeNull();
    expect(fields().map((f) => f.textContent)).toEqual(['Courriel', 'Adresse']);
    act(() => { fields()[0].click(); });
    expect(onChange).toHaveBeenCalledWith('client', 'email');
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('recherche globale, sans accents ni casse, avec la catégorie sur chaque résultat', () => {
    render();
    open();
    type('ADRÉSSE');
    const hits = fields();
    expect(hits).toHaveLength(2);
    expect(hits[0].textContent).toContain('Clients');
    expect(hits[1].textContent).toContain('Propriétés');
    // La catégorie active reste visible et compte ses résultats.
    expect(categories().find((c) => c.textContent?.includes('Propriétés'))?.textContent).toContain('1');

    type('propriétés adresse');
    expect(fields()).toHaveLength(1);
    expect(fields()[0].textContent).toContain('Propriétés');

    type('zzz');
    expect(fields()).toHaveLength(0);
    expect(dialog()!.textContent).toContain('Aucun champ ne correspond à « zzz »');
    expect(exclude()).not.toBeNull();
  });

  it('Entrée dans la recherche applique le premier résultat', () => {
    render();
    open();
    type('courriel');
    key(search(), 'Enter');
    expect(onChange).toHaveBeenCalledWith('client', 'email');
    expect(dialog()).toBeNull();
  });

  it('« Ne pas importer » envoie (null, null) et ferme', () => {
    render();
    open();
    act(() => { exclude().click(); });
    expect(onChange).toHaveBeenCalledWith(null, null);
    expect(dialog()).toBeNull();
  });

  it('navigation au clavier : flèches entre recherche, catégories et champs', () => {
    render();
    open();
    key(search(), 'ArrowDown');
    expect(document.activeElement?.textContent).toContain('Adresse');
    key(document.activeElement!, 'ArrowDown');
    expect(document.activeElement?.textContent).toContain('Ville');
    key(document.activeElement!, 'ArrowLeft');
    expect(document.activeElement?.getAttribute('data-zone')).toBe('category');
    expect(document.activeElement?.textContent).toContain('Propriétés');
    key(document.activeElement!, 'ArrowUp');
    expect(document.activeElement?.textContent).toContain('Clients');
    expect(categories().find((c) => c.getAttribute('aria-current') === 'true')?.textContent).toContain('Clients');
    key(document.activeElement!, 'ArrowRight');
    expect(document.activeElement?.textContent).toContain('Courriel');
    key(document.activeElement!, 'End');
    key(document.activeElement!, 'ArrowDown');
    expect(document.activeElement).toBe(exclude());
  });

  it('Échap et clic extérieur ferment et rendent le focus au déclencheur', () => {
    render();
    open();
    key(search(), 'Escape');
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());

    open();
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('une correspondance hors catalogue reste lisible sans planter', () => {
    render({ value: { entity: 'client', field: 'ancien_champ' } });
    expect(trigger().textContent).toContain('Clients → ancien_champ');
    open();
    expect(fields().some((f) => f.getAttribute('aria-selected') === 'true')).toBe(false);
  });
});
