// @vitest-environment jsdom
/**
 * LE PANNEAU D'UNE ÉTAPE — corrections du triage « actions » (2026-10-01),
 * côté COMPOSANT : le vrai `PanneauEtape`, monté seul. Un bloc `describe` par
 * ligne du triage.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const confirmerMock = vi.hoisted(() => vi.fn(async (_o: unknown) => true));
vi.mock('../../../src/components/ui/ConfirmDialog', () => ({ confirmer: (o: unknown) => confirmerMock(o), default: () => null }));
vi.mock('../../../src/hooks/useModuleAccess', () => ({ useModuleAccess: () => ({ isEnabled: false, loading: false }) }));
vi.mock('../../../src/lib/supabase', () => {
  const chaine: unknown = new Proxy(function () {}, {
    get: (_t, prop) => {
      if (prop === 'then') return (res: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(res);
      return () => chaine;
    },
    apply: () => chaine,
  });
  return {
    supabase: {
      from: () => chaine,
      rpc: async () => ({ data: null, error: null }),
      auth: {
        getUser: async () => ({ data: { user: null } }),
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});

import PanneauEtape from '../../../src/components/automations/PanneauEtape';
import type { Etape } from '../../../src/lib/sequenceTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Proprietes = Partial<React.ComponentProps<typeof PanneauEtape>>;

let conteneur: HTMLDivElement;
let racine: Root | null = null;
/** Ce que « Enregistrer » a renvoyé au parent. */
let enregistrees: Etape[] = [];

async function monterEtape(etape: Etape, props: Proprietes = {}) {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    racine!.render(
      <QueryClientProvider client={qc}>
        <PanneauEtape
          etape={etape} fr declencheur="quote.sent" membres={[]} etiquettes={[]}
          onEnregistrer={(e) => { enregistrees.push(e); }} onSupprimer={() => {}} onFermer={() => {}}
          {...props}
        />
      </QueryClientProvider>,
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const monter = (type: string, config: Record<string, string>, props: Proprietes = {}) =>
  monterEtape({ id: 'e1', type: 'action', action: { type, config }, suivant: null }, props);

beforeEach(() => { enregistrees = []; confirmerMock.mockClear(); });
afterEach(async () => {
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
});

const texte = () => conteneur.textContent || '';
const boutons = () => Array.from(conteneur.querySelectorAll('button'));
const boutonExact = (t: string) => boutons().find((b) => b.textContent?.trim() === t);
const enregistrer = () => (boutonExact('Enregistrer') ?? boutonExact('Save'))!;
function cliquer(el: Element | undefined | null) {
  if (!el) throw new Error('rien à cliquer');
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}
/** Le contrôle (champ, zone, menu) dont le libellé COMMENCE par ce texte. */
function champ<T extends HTMLElement = HTMLInputElement>(libelle: string): T | null {
  const etiquette = Array.from(conteneur.querySelectorAll('label')).find((l) => (l.textContent ?? '').startsWith(libelle));
  const id = etiquette?.getAttribute('for');
  return id ? conteneur.querySelector<T>(`[id="${id}"]`) : null;
}
function saisir(el: Element | null | undefined, v: string) {
  if (!el) throw new Error('champ introuvable');
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, v);
  act(() => { el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
const configEnregistree = () => {
  const e = enregistrees.at(-1);
  return e?.type === 'action' ? e.action.config : null;
};

// ─── Ligne 2 du triage « actions » ──────────────────────────────

describe('ligne 2 — la version anglaise d’un texte (`body_en`, `subject_en`) est visible et modifiable', () => {
  const FR = 'Rabais de 10 % jusqu’au 1er mai.';
  const EN = '10% off until May 1st.';

  it('un texto qui porte `body_en` le montre, dans le même champ que le français (compteur compris)', async () => {
    await monter('send_sms', { body: FR, body_en: EN });
    expect(champ<HTMLTextAreaElement>('Texte du message *')?.value).toBe(FR);
    const anglais = champ<HTMLTextAreaElement>('Texte du message — version anglaise');
    expect(anglais?.tagName).toBe('TEXTAREA');
    expect(anglais?.value).toBe(EN);
    expect(anglais?.maxLength).toBe(1600);
    expect(texte()).toContain(`${EN.length} / 1600`);
    expect(texte()).toContain('Part à la place du texte français quand la langue du bureau est l’anglais.');
  });

  it('une étape SANS version anglaise n’affiche qu’un texte (rien n’est inventé)', async () => {
    await monter('send_sms', { body: FR });
    expect(conteneur.querySelectorAll('textarea')).toHaveLength(1);
    expect(texte()).not.toContain('version anglaise');
  });

  it('courriel : `subject_en` et `body_en` ont chacun leur champ', async () => {
    await monter('send_email', { subject: 'Votre devis', subject_en: 'Your quote', body: 'Bonjour', body_en: 'Hello' });
    expect(champ('Objet — version anglaise')?.value).toBe('Your quote');
    expect(champ<HTMLTextAreaElement>('Message — version anglaise')?.value).toBe('Hello');
  });

  it('corriger le français sans toucher l’anglais : « Enregistrer » est refusé, avec la raison', async () => {
    await monter('send_sms', { body: FR, body_en: EN });
    expect(enregistrer().disabled).toBe(false);
    saisir(champ('Texte du message *'), 'Rabais de 20 % jusqu’au 1er juin.');
    expect(enregistrer().disabled).toBe(true);
    expect(texte()).toContain('« Texte du message » a changé, pas sa version anglaise : mettez-la à jour, videz-la, ou confirmez qu’elle reste valable.');
    cliquer(enregistrer());
    expect(enregistrees).toEqual([]);
  });

  it('… mettre l’anglais à jour lève le refus : les DEUX textes partent', async () => {
    await monter('send_sms', { body: FR, body_en: EN });
    saisir(champ('Texte du message *'), 'Rabais de 20 % jusqu’au 1er juin.');
    saisir(champ('Texte du message — version anglaise'), '20% off until June 1st.');
    expect(enregistrer().disabled).toBe(false);
    cliquer(enregistrer());
    expect(configEnregistree()).toEqual({ body: 'Rabais de 20 % jusqu’au 1er juin.', body_en: '20% off until June 1st.' });
  });

  it('… ou la confirmer « toujours valable » : elle est gardée telle quelle, en connaissance de cause', async () => {
    await monter('send_sms', { body: 'Bonjour [client_name], votre devis est pret.', body_en: 'Hi [client_name], your quote is ready.' });
    saisir(champ('Texte du message *'), 'Bonjour [client_name], votre devis est prêt.');
    expect(enregistrer().disabled).toBe(true);
    const case_ = Array.from(conteneur.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .find((c) => conteneur.querySelector(`label[for="${c.id}"]`)?.textContent?.includes('La version anglaise reste valable telle quelle'));
    cliquer(case_);
    expect(enregistrer().disabled).toBe(false);
    cliquer(enregistrer());
    expect(configEnregistree()).toEqual({ body: 'Bonjour [client_name], votre devis est prêt.', body_en: 'Hi [client_name], your quote is ready.' });
  });

  it('… ou la vider : la clé disparaît de l’étape (jamais un `body_en` vide en base)', async () => {
    await monter('send_sms', { body: FR, body_en: EN });
    saisir(champ('Texte du message *'), 'Rabais de 20 % jusqu’au 1er juin.');
    saisir(champ('Texte du message — version anglaise'), '');
    // Vidée, elle reste À L'ÉCRAN : on voit qu'elle est vide, on peut la réécrire.
    expect(champ('Texte du message — version anglaise')).not.toBeNull();
    expect(enregistrer().disabled).toBe(false);
    cliquer(enregistrer());
    expect(configEnregistree()).toEqual({ body: 'Rabais de 20 % jusqu’au 1er juin.' });
  });

  it('modifier SEULEMENT l’anglais est enregistrable', async () => {
    await monter('send_sms', { body: FR, body_en: EN });
    saisir(champ('Texte du message — version anglaise'), '10% off until May 1.');
    expect(enregistrer().disabled).toBe(false);
    cliquer(enregistrer());
    expect(configEnregistree()).toEqual({ body: FR, body_en: '10% off until May 1.' });
  });

  it('rouvrir et réenregistrer sans rien changer ne réécrit rien', async () => {
    await monter('send_sms', { body: FR, body_en: EN });
    cliquer(enregistrer());
    expect(configEnregistree()).toEqual({ body: FR, body_en: EN });
  });

  it('une variable inconnue dans la version anglaise est signalée comme dans l’autre', async () => {
    await monter('send_sms', { body: 'Bonjour [client_name]', body_en: 'Hi [firstname]' });
    expect(conteneur.querySelector('[role="alert"]')?.textContent).toBe('Variable inconnue : [firstname] — sera vide dans le message envoyé.');
  });

  it('changer d’action (texto → courriel) garde le texte ET sa version anglaise', async () => {
    await monter('send_sms', { body: FR, body_en: EN });
    saisir(champ<HTMLSelectElement>('Quoi faire'), 'send_email');
    expect(champ<HTMLTextAreaElement>('Message *')?.value).toBe(FR);
    expect(champ<HTMLTextAreaElement>('Message — version anglaise')?.value).toBe(EN);
  });

  it('interface en anglais : libellés et refus en anglais', async () => {
    await monter('send_sms', { body: FR, body_en: EN }, { fr: false });
    expect(champ<HTMLTextAreaElement>('Message text — English version')?.value).toBe(EN);
    saisir(champ('Message text *'), '20 %');
    expect(texte()).toContain('“Message text” changed, not its English version: update it, empty it, or confirm it still holds.');
    expect(texte()).toContain('The English version still holds as is');
  });
});
