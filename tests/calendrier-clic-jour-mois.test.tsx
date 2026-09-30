// @vitest-environment jsdom
//
// Vue Mois : cliquer un jour doit ouvrir CE jour en vue Jour. Signalé le
// 2026-09-30 : le clic ramenait au jour déjà affiché (souvent aujourd'hui).
// Le clic fait setDate(jour) puis setView('day') ; React Router donnait à la
// 2e mise à jour l'URL d'avant la 1re, qui était écrasée.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, it, expect, afterEach } from 'vitest';
import { CalendarControllerProvider, useCalendarController } from '../src/contexts/CalendarController';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let hote: HTMLDivElement | null = null;
afterEach(() => { act(() => racine?.unmount()); hote?.remove(); racine = null; hote = null; });

let ctrl: ReturnType<typeof useCalendarController> | null = null;
let recherche = '';
function Sonde() {
  ctrl = useCalendarController();
  recherche = useLocation().search;
  return null;
}

async function rendre(url: string) {
  hote = document.createElement('div');
  document.body.appendChild(hote);
  racine = createRoot(hote);
  await act(async () => {
    racine!.render(<MemoryRouter initialEntries={[url]}><CalendarControllerProvider><Sonde /></CalendarControllerProvider></MemoryRouter>);
  });
}

describe('Calendrier — clic sur un jour en vue Mois', () => {
  it('ouvre le jour CLIQUÉ en vue Jour (même geste que onDayClick de Schedule)', async () => {
    await rendre('/calendar?view=month&date=2026-09-30');
    await act(async () => {
      ctrl!.setDate(new Date(2026, 9, 15, 12));
      ctrl!.setView('day');
    });
    const p = new URLSearchParams(recherche);
    expect(p.get('view')).toBe('day');
    expect(p.get('date')).toBe('2026-10-15');
    expect(ctrl!.view).toBe('day');
    expect(ctrl!.selectedDate.getDate()).toBe(15);
  });

  it('les équipes cochées sont gardées', async () => {
    await rendre('/calendar?view=month&date=2026-09-30&teams=a,b');
    await act(async () => {
      ctrl!.setDate(new Date(2026, 9, 3, 12));
      ctrl!.setView('day');
    });
    expect(new URLSearchParams(recherche).get('teams')).toBe('a,b');
  });

  it('une mise à jour seule, plus tard, part bien de l’URL courante', async () => {
    await rendre('/calendar?view=month&date=2026-09-30');
    await act(async () => { ctrl!.setDate(new Date(2026, 9, 15, 12)); ctrl!.setView('day'); });
    await act(async () => { ctrl!.goNext(); });
    const p = new URLSearchParams(recherche);
    expect(p.get('date')).toBe('2026-10-16');
    expect(p.get('view')).toBe('day');
  });
});
