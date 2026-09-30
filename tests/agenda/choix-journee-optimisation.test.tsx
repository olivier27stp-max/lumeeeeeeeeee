// @vitest-environment jsdom
//
// « Optimiser la journée » : on choisit la journée avant d'ouvrir Lumi
// (demande de Rafba, 2026-09-30 — le bouton prenait le jour sélectionné sans le
// dire). Chaque jour montre ses visites ; un jour vide ne se choisit pas.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

const appels: { startAt: string; endAt: string }[] = [];
vi.mock('../../src/lib/scheduleApi', () => ({
  listScheduleEventsRange: async (p: { startAt: string; endAt: string }) => {
    appels.push(p);
    const v = (id: string, start_at: string, team_id: string | null, status = 'scheduled') => ({ id, job_id: `j${id}`, team_id, start_at, end_at: start_at, timezone: 'America/Toronto', status, deleted_at: null });
    return [
      v('1', '2026-09-30T13:00:00Z', 'eqA'),            // aujourd'hui 9 h à Toronto
      v('2', '2026-09-30T15:00:00Z', 'eqB'),
      v('3', '2026-10-01T03:30:00Z', 'eqA'),            // 23 h 30 le 30 à Toronto (le 1er en UTC)
      v('4', '2026-10-02T13:00:00Z', 'eqA', 'cancelled'),
      v('5', '2026-10-20T13:00:00Z', 'eqA'),            // jour affiché, hors des 7 prochains
    ].filter((e) => e.start_at >= p.startAt && e.start_at < p.endAt);
  },
}));

import ChoixJourneeOptimisation from '../../src/components/schedule/ChoixJourneeOptimisation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let hote: HTMLDivElement | null = null;
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-30T16:00:00Z')); appels.length = 0; });
afterEach(() => { act(() => racine?.unmount()); hote?.remove(); racine = null; hote = null; vi.useRealTimers(); });

const equipes = [{ id: 'eqA', name: 'Équipe A' }, { id: 'eqB', name: 'Équipe B' }] as never;

async function rendre(jourAffiche: string, onChoisir = vi.fn(), equipeInitiale: string | null = null) {
  hote = document.createElement('div');
  document.body.appendChild(hote);
  racine = createRoot(hote);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    racine!.render(
      <QueryClientProvider client={qc}>
        <ChoixJourneeOptimisation fuseau="America/Toronto" teams={equipes} jourAffiche={jourAffiche} equipeInitiale={equipeInitiale} fr onChoisir={onChoisir} />
      </QueryClientProvider>,
    );
  });
  // Attend la fin du chargement (« … » tant que les visites ne sont pas là).
  for (let i = 0; i < 50 && hote.textContent!.includes('…'); i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
  return onChoisir;
}
const jour = (j: string) => hote!.querySelector<HTMLButtonElement>(`[data-testid="jour-${j}"]`)!;

describe('choix de la journée à optimiser', () => {
  it('propose les 7 prochains jours au fuseau de l’entreprise, avec leurs visites', async () => {
    await rendre('2026-09-30');
    const jours = [...hote!.querySelectorAll('[data-testid^="jour-"]')].map((b) => b.getAttribute('data-testid'));
    expect(jours).toEqual(['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'].map((j) => `jour-${j}`));
    // 23 h 30 à Toronto compte pour le 30, pas pour le 1er (UTC).
    expect(jour('2026-09-30').textContent).toContain('Aujourd’hui');
    expect(jour('2026-09-30').textContent).toContain('3 visites');
    expect(jour('2026-09-30').textContent).toContain('affiché');
    expect(jour('2026-10-01').textContent).toContain('Demain');
    // Visite annulée : le jour est vide, donc pas cliquable.
    expect(jour('2026-10-02').textContent).toContain('Aucune visite');
    expect(jour('2026-10-02').disabled).toBe(true);
  });

  it('le jour affiché dans le Calendrier est proposé même s’il est plus loin', async () => {
    await rendre('2026-10-20');
    expect(jour('2026-10-20').textContent).toContain('1 visite');
    expect(jour('2026-10-20').textContent).toContain('affiché');
  });

  it('cliquer un jour l’envoie avec l’équipe choisie ; le compte suit l’équipe', async () => {
    const onChoisir = await rendre('2026-09-30', vi.fn(), 'eqB');
    expect(jour('2026-09-30').textContent).toContain('1 visite');
    await act(async () => { jour('2026-09-30').click(); });
    expect(onChoisir).toHaveBeenCalledWith('2026-09-30', 'eqB');

    const select = hote!.querySelector('select')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, '');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(jour('2026-09-30').textContent).toContain('3 visites');
    await act(async () => { jour('2026-09-30').click(); });
    expect(onChoisir).toHaveBeenLastCalledWith('2026-09-30', null);
  });

  it('une autre date se choisit à la main', async () => {
    const onChoisir = await rendre('2026-09-30');
    const input = hote!.querySelector<HTMLInputElement>('input[type="date"]')!;
    expect(input.min).toBe('2026-09-30');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '2026-11-12');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { hote!.querySelector('form')!.requestSubmit(); });
    expect(onChoisir).toHaveBeenCalledWith('2026-11-12', null);
  });
});
