// @vitest-environment jsdom
/**
 * « Déplacer vers une autre pipeline » (Rafba, 2026-09-30 : dupliquer un
 * pipeline n'emporte pas les deals — voulu — mais rien ne permettait de les
 * déplacer). La fenêtre ne propose que les étapes OUVERTES du pipeline
 * choisi, et envoie les deals sélectionnés vers l'étape choisie.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const api = vi.hoisted(() => ({ etapes: vi.fn(), deplacer: vi.fn() }));
vi.mock('../src/i18n', () => ({ useTranslation: () => ({ t: { common: { close: 'Fermer' } }, language: 'fr' }) }));
vi.mock('../src/lib/sentry', () => ({ captureClientException: () => {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../src/lib/pipelineVentesApi', () => ({ fetchStages: api.etapes, deplacerVersPipeline: api.deplacer }));

import ModalChangerPipeline from '../src/components/pipeline/ModalChangerPipeline';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let racine: Root | null = null;
let conteneur: HTMLDivElement;
const attendre = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

const ETAPES = [
  { id: 's1', name_fr: 'Nouveau lead', name_en: 'New lead', kind: 'open', archived_at: null, position: 1 },
  { id: 's2', name_fr: 'Contacté', name_en: 'Contacted', kind: 'open', archived_at: null, position: 2 },
  { id: 's3', name_fr: 'Vieille étape', name_en: 'Old', kind: 'open', archived_at: '2026-01-01', position: 3 },
  { id: 'sg', name_fr: 'Gagné', name_en: 'Won', kind: 'won', archived_at: null, position: 4 },
  { id: 'sp', name_fr: 'Perdu', name_en: 'Lost', kind: 'lost', archived_at: null, position: 5 },
];

beforeEach(() => { api.etapes.mockReset().mockResolvedValue(ETAPES); api.deplacer.mockReset().mockResolvedValue(2); });
afterEach(() => { act(() => racine?.unmount()); conteneur?.remove(); racine = null; });

describe('Déplacer vers une autre pipeline', () => {
  it('ne propose que les étapes ouvertes, puis déplace les deals choisis', async () => {
    conteneur = document.createElement('div');
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    const onDeplace = vi.fn();
    act(() => {
      racine!.render(<ModalChangerPipeline ouvert fr dealIds={['d1', 'd2']} pipelines={[{ id: 'p2', name: 'Commercial' }]} onFermer={() => {}} onDeplace={onDeplace} />);
    });
    await attendre();
    expect(api.etapes).toHaveBeenCalledWith('p2');
    const options = [...document.querySelectorAll('select')][1].querySelectorAll('option');
    expect([...options].map((o) => o.textContent)).toEqual(['Nouveau lead', 'Contacté']);

    const bouton = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Déplacer') as HTMLButtonElement;
    await act(async () => { bouton.click(); });
    await attendre();
    expect(api.deplacer).toHaveBeenCalledWith(['d1', 'd2'], 'p2', 's1');
    expect(onDeplace).toHaveBeenCalledWith('p2', 2);
  });
});
