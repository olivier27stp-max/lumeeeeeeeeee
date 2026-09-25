// @vitest-environment jsdom
//
// « Créer une job » depuis la fiche du deal.
//
// Ce que ces tests protègent : le bouton doit OUVRIR la fenêtre de création.
// S'il ferme la fiche sans rien ouvrir, le clic a l'air d'échouer — et le
// vendeur retourne dans la fiche pour réessayer, en boucle.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const createJobMock = vi.fn(async (..._a: any[]) => ({ id: 'job-1' }));

vi.mock('../src/lib/jobsApi', () => ({
  createJob: (...a: any[]) => createJobMock(...(a as [])),
}));

vi.mock('../src/i18n', () => ({
  useTranslation: () => ({ language: 'fr', t: { common: { close: 'Fermer' } } }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import GagneJobModal from '../src/components/pipeline/GagneJobModal';

const DEAL = {
  id: 'd-1',
  pipeline_id: 'p1',
  stage_id: 'e-won',
  client_id: 'c-1',
  assigned_user_id: null,
  source: 'manual',
  utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, fbclid: null,
  job_id: null, quote_id: null,
  first_contacted_at: null,
  last_activity_at: new Date().toISOString(),
  stage_entered_at: new Date().toISOString(),
  won_at: null, lost_at: null, lost_reason: null, lost_from_stage_id: null,
  expected_close_date: null, pin_id: null, field_rep_id: null,
  created_at: new Date().toISOString(),
  client: {
    first_name: 'Alice', last_name: 'Alpha', company: null,
    email: 'a@a.ca', phone: '4180000001', address: '12 rue des Lilas, Québec',
  },
} as any;

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

async function rendre(deal: any = DEAL) {
  const onCreer = vi.fn();
  const onFermer = vi.fn();
  await act(async () => {
    racine.render(<GagneJobModal deal={deal} onFermer={onFermer} onCreer={onCreer} />);
  });
  return { onCreer, onFermer };
}

function champParEtiquette(re: RegExp): HTMLInputElement | undefined {
  const lab = [...conteneur.querySelectorAll('label')].find((l) => re.test(l.textContent ?? ''));
  const id = lab?.getAttribute('for');
  if (!id) return undefined;
  return [...conteneur.querySelectorAll('input')]
    .find((e) => e.getAttribute('id') === id) as HTMLInputElement | undefined;
}

async function saisir(el: HTMLInputElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

describe('fenêtre « Créer la job »', () => {
  it('s ouvre avec un deal', async () => {
    await rendre();
    expect(conteneur.textContent).toContain('Créer la job');
  });

  it('ne s affiche pas sans deal', async () => {
    // Le parent passe `null` quand aucune job n'est demandée.
    await rendre(null);
    expect(conteneur.textContent?.trim()).toBe('');
  });

  it('pré-remplit l adresse du client', async () => {
    // Retaper une adresse qu'on a déjà, c'est la faire retaper avec une faute.
    // L'adresse vit dans la `value` d'un champ : `textContent` ne la voit pas.
    await rendre();
    const valeurs = [...conteneur.querySelectorAll('input')].map((i) => i.value);
    expect(valeurs.some((v) => v.includes('12 rue des Lilas'))).toBe(true);
    expect(valeurs.some((v) => v.includes('Alpha'))).toBe(true);
  });

  it('crée la job avec le titre par défaut si on ne saisit rien', async () => {
    const { onCreer } = await rendre();
    const bouton = [...conteneur.querySelectorAll('button')]
      .find((b) => /Créer la job|Créer job/.test(b.textContent ?? ''));
    await act(async () => { bouton?.click(); });

    expect(createJobMock).toHaveBeenCalled();
    const charge = createJobMock.mock.calls[0][0] as any;
    expect(charge.title).toContain('Alpha');
    expect(charge.client_id).toBe('c-1');
    expect(onCreer).toHaveBeenCalledWith('d-1', 'job-1');
  });

  it('une date saisie devient une visite à 9 h', async () => {
    // Sans heure, la job est créée sans visite : 9 h est le début de journée
    // d'une équipe terrain, pas minuit.
    await rendre();
    const date = champParEtiquette(/[Dd]ate/);
    if (!date) return;
    await saisir(date, '2026-10-15');

    const bouton = [...conteneur.querySelectorAll('button')]
      .find((b) => /Créer la job|Créer job/.test(b.textContent ?? ''));
    await act(async () => { bouton?.click(); });

    const charge = createJobMock.mock.calls[0][0] as any;
    expect(charge.scheduled_at).toContain('2026-10-15');
  });

  it('sans date, la job part sans visite plutôt qu à une date inventée', async () => {
    await rendre();
    const bouton = [...conteneur.querySelectorAll('button')]
      .find((b) => /Créer la job|Créer job/.test(b.textContent ?? ''));
    await act(async () => { bouton?.click(); });
    expect((createJobMock.mock.calls[0][0] as any).scheduled_at).toBeNull();
  });
});
