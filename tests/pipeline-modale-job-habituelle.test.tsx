// @vitest-environment jsdom
//
// Créer la job d'un deal gagné ouvre la fenêtre HABITUELLE, celle des pages
// Jobs, Clients et Calendrier — pas une fenêtre propre au pipeline.
//
// CE QUE CE TEST PROTÈGE. Le pipeline avait sa propre petite fenêtre : titre,
// client, adresse, date. Elle créait donc une job SANS MONTANT, alors que 912
// des 939 jobs de production en portent un (`total_cents`) et que c'est lui
// qui les rend facturables. Une vente gagnée produisait une job vide qu'il
// fallait rouvrir pour la compléter.
//
// On vérifie trois choses, dans cet ordre d'importance :
//   1. c'est bien `openJobModal` — la fenêtre habituelle — qui s'ouvre ;
//   2. le client et l'adresse du deal y sont pré-remplis ;
//   3. une fois la job créée, elle est RATTACHÉE au deal (sinon le badge
//      « Job à créer » resterait affiché sur une vente déjà exécutée).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const openJobModalMock = vi.fn((..._a: any[]) => undefined);
const lierJobMock = vi.fn(async (..._a: any[]) => undefined);

/**
 * Le composant sous test est l'effet de `Pipeline.tsx`. Le monter en entier
 * demanderait routeur, session et six requêtes ; on reproduit donc l'effet
 * tel qu'il est écrit, et on vérifie qu'il APPELLE les bonnes choses.
 *
 * Ce raccourci a une limite, assumée : si quelqu'un supprime l'effet de
 * `Pipeline.tsx`, ce test reste vert. Le garde statique plus bas couvre ce
 * cas — il lit le vrai fichier.
 */
function EffetCreationJob({ deal, gagne }: { deal: any; gagne: boolean }) {
  React.useEffect(() => {
    if (!deal) return;
    openJobModalMock({
      initialValues: { client_id: deal.client_id, property_address: deal.client?.address ?? null },
      onCreated: async (job: any) => { await lierJobMock(deal.id, job.id); },
      onCancel: () => { if (gagne) { /* toast « Job à créer » */ } },
    });
  }, [deal, gagne]);
  return null;
}

let hote: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

beforeEach(() => {
  openJobModalMock.mockClear();
  lierJobMock.mockClear();
  hote = document.createElement('div');
  document.body.appendChild(hote);
  racine = createRoot(hote);
});

afterEach(() => {
  act(() => racine.unmount());
  hote.remove();
});

const DEAL = {
  id: 'deal-1',
  client_id: 'cli-9',
  stage_id: 'et-won',
  client: { address: '12 rue des Érables' },
};

describe('créer la job d un deal — la fenêtre habituelle', () => {
  it('ouvre openJobModal, pas une fenêtre propre au pipeline', async () => {
    await act(async () => { racine.render(<EffetCreationJob deal={DEAL} gagne />); });
    expect(openJobModalMock).toHaveBeenCalledTimes(1);
  });

  it('pré-remplit le client et l adresse du deal', async () => {
    await act(async () => { racine.render(<EffetCreationJob deal={DEAL} gagne />); });
    const params = openJobModalMock.mock.calls[0][0] as any;
    expect(params.initialValues.client_id).toBe('cli-9');
    expect(params.initialValues.property_address).toBe('12 rue des Érables');
  });

  it('rattache la job créée au deal', async () => {
    await act(async () => { racine.render(<EffetCreationJob deal={DEAL} gagne />); });
    const params = openJobModalMock.mock.calls[0][0] as any;
    await act(async () => { await params.onCreated({ id: 'job-77' }); });
    expect(lierJobMock).toHaveBeenCalledWith('deal-1', 'job-77');
  });

  it('un deal sans adresse n envoie pas undefined', async () => {
    const sansAdresse = { ...DEAL, client: null };
    await act(async () => { racine.render(<EffetCreationJob deal={sansAdresse} gagne />); });
    const params = openJobModalMock.mock.calls[0][0] as any;
    expect(params.initialValues.property_address).toBeNull();
  });
});

// ── Le garde qui lit le VRAI fichier ────────────────────────
//
// Les tests ci-dessus reproduisent l'effet ; celui-ci vérifie que
// `Pipeline.tsx` fait bien ce qu'ils décrivent. Sans lui, supprimer l'effet
// de la page laisserait toute la suite au vert.
describe('Pipeline.tsx — garde statique', () => {
  it('ouvre la fenêtre habituelle et n a plus sa fenêtre à lui', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/pages/Pipeline.tsx', 'utf8');
    expect(src).toContain('useJobModalController');
    expect(src).toContain('openJobModal(');
    // L'ancienne fenêtre du pipeline ne doit pas revenir : elle créait des
    // jobs sans montant.
    expect(src).not.toContain('<GagneJobModal');
    expect(fs.existsSync('src/components/pipeline/GagneJobModal.tsx')).toBe(false);
  });
});
