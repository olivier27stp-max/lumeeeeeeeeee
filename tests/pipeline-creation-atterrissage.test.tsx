// @vitest-environment jsdom
//
// P1-6 — « le board ne se rafraîchit pas toujours après création ».
//
// Le QA décrivait le défaut comme INCONSTANT. Il ne l'était pas : un deal
// créé part toujours dans le pipeline PAR DÉFAUT de l'organisation, jamais
// dans celui qu'on regarde. En consultant un autre pipeline, le compteur
// restait donc à zéro — et invalider le cache n'y changeait rien, puisque
// le deal n'était pas là.
//
// Ce test fige le contrat : le board apprend OÙ le deal a atterri, et
// bascule dessus au lieu de laisser croire que rien ne s'est passé.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** Le pipeline par défaut, où la base place les deals quand on n'en choisit aucun. */
const PIPELINE_DEFAUT = 'p-defaut';

/** Les fiches que la recherche de clients renvoie ; vide par défaut. */
const rechercheClientsMock = vi.fn(async (..._a: any[]): Promise<any[]> => []);

const creerMock = vi.fn(async (..._a: any[]) => ({
  dealId: 'd-neuf', fusionne: false, dealExistant: false, pipelineId: PIPELINE_DEFAUT,
}));

vi.mock('../src/lib/pipelineVentesApi', async () => {
  const reel = await vi.importActual<any>('../src/lib/pipelineVentesApi');
  return {
    ...reel,
    creerDealManuel: (...a: any[]) => creerMock(...(a as [])),
    fetchVues: async () => [],
    creerVue: async () => 'v1',
    supprimerVue: async () => {},
    journaliserLot: async () => {},
    // Le formulaire cherche des clients, des devis et des doublons : jamais de réseau ici.
    rechercherClientsPourDeal: (...a: any[]) => rechercheClientsMock(...(a as [])),
    rechercherDevisPourDeal: async () => [],
  };
});

vi.mock('../src/i18n', () => ({
  useTranslation: () => ({ language: 'fr', t: { common: { close: 'Fermer' } } }),
}));

const toastInfo = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: (...a: any[]) => toastInfo(...a) },
}));

import PipelineBoard from '../src/components/pipeline/PipelineBoard';

const ETAPES = [
  { id: 'e1', pipeline_id: 'p-autre', name_fr: 'Nouveau', name_en: 'New', guidance_fr: '', guidance_en: '', position: 1, kind: 'open', probability: 20, show_in_reports: true, archived_at: null },
] as any[];

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

async function rendre(pipelineActif: string) {
  const onChangerPipeline = vi.fn();
  const onChangement = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    racine.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <PipelineBoard
            deals={[]}
            etapes={ETAPES}
            montants={{}}
            membres={[]}
            pipelines={[
              { id: PIPELINE_DEFAUT, name: 'Par défaut', is_default: true },
              { id: 'p-autre', name: 'Autre', is_default: false },
            ]}
            pipelineActif={pipelineActif}
            onChangerPipeline={onChangerPipeline}
            onOuvrir={vi.fn()}
            onDeplacer={vi.fn()}
            onAssigner={vi.fn()}
            onChangement={onChangement}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
  return { onChangerPipeline, onChangement };
}

async function creerUnDeal() {
  const b = [...conteneur.querySelectorAll('button')]
    .find((x) => /nouveau deal/i.test(x.textContent ?? ''));
  await act(async () => { b?.click(); });
  // Le formulaire s'ouvre sur « Client existant » : ce test porte sur la saisie d'un nouveau contact.
  const nouveauContact = [...conteneur.querySelectorAll('button')]
    .find((x) => /nouveau contact/i.test(x.textContent ?? ''));
  await act(async () => { nouveauContact?.click(); });

  const prenom = [...conteneur.querySelectorAll('input')]
    .find((i) => /Prénom/i.test(
      conteneur.querySelector(`label[for="${i.id}"]`)?.textContent ?? ''));
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(prenom, 'Alice');
    prenom!.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const envoyer = [...conteneur.querySelectorAll('button')]
    .find((x) => x.getAttribute('type') === 'submit');
  await act(async () => { envoyer?.click(); });
  await act(async () => { await Promise.resolve(); });
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

describe('P1-6 — le board suit le deal créé', () => {
  it('bascule sur le pipeline où le deal a atterri', async () => {
    // On regarde « Autre », le deal part dans « Par défaut ».
    const { onChangerPipeline } = await rendre('p-autre');
    await creerUnDeal();

    expect(creerMock).toHaveBeenCalled();
    expect(onChangerPipeline).toHaveBeenCalledWith(PIPELINE_DEFAUT);
  });

  it('explique le saut au lieu de le subir', async () => {
    // Changer de pipeline sans rien dire serait aussi déroutant qu'un
    // board vide : on NOMME le pipeline où le deal est parti.
    await rendre('p-autre');
    await creerUnDeal();
    expect(toastInfo).toHaveBeenCalled();
    expect(String(toastInfo.mock.calls[0][0])).toMatch(/« Par défaut »/);
  });

  it('ne bascule pas quand on regarde déjà le bon pipeline', async () => {
    // Le cas ordinaire : aucun saut, aucun message.
    const { onChangerPipeline } = await rendre(PIPELINE_DEFAUT);
    await creerUnDeal();
    expect(onChangerPipeline).not.toHaveBeenCalled();
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('rafraîchit le board dans tous les cas', async () => {
    const { onChangement } = await rendre(PIPELINE_DEFAUT);
    await creerUnDeal();
    expect(onChangement).toHaveBeenCalled();
  });
});

/** Laisse passer le délai de saisie (la recherche attend une pause de frappe). */
async function patienter(ms: number) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
  // La requête ne PART qu'au rendu qui suit la pause de frappe : un second
  // passage laisse sa réponse s'afficher avant qu'on clique dessus.
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

function bouton(re: RegExp): HTMLButtonElement | undefined {
  return [...conteneur.querySelectorAll('button')].find((x) => re.test(x.textContent ?? '')) as HTMLButtonElement | undefined;
}

async function taper(el: HTMLInputElement, valeur: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(el, valeur);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function champ(re: RegExp): HTMLInputElement | undefined {
  const lab = [...conteneur.querySelectorAll('label')].find((l) => re.test(l.textContent ?? ''));
  const id = lab?.getAttribute('for');
  return [...conteneur.querySelectorAll('input')].find((i) => i.getAttribute('id') === id);
}

const MARC = { id: 'c-marc', nom: 'Marc Tremblay', telephone: null, courriel: null, adresse: '12 rue des Érables' };

describe("Nouveau deal — partir de l'existant, dans le pipeline choisi", () => {
  it('envoie le pipeline affiché, au lieu de laisser la base choisir le défaut', async () => {
    // Avant : aucun pipeline n'était transmis, le deal partait toujours dans
    // le pipeline par défaut et le board « sautait » après coup.
    await rendre('p-autre');
    await creerUnDeal();
    expect(creerMock.mock.calls[0][0]).toMatchObject({ pipelineId: 'p-autre' });
  });

  it('client existant : envoie SON identifiant, jamais un contact retapé', async () => {
    // Le rapprochement automatique ne reconnaît quelqu'un que par téléphone ou
    // courriel. Marc n'a ni l'un ni l'autre : seul son identifiant évite une
    // seconde fiche Marc Tremblay.
    rechercheClientsMock.mockResolvedValue([MARC]);
    await rendre(PIPELINE_DEFAUT);
    await act(async () => { bouton(/nouveau deal/i)?.click(); });
    await taper(champ(/Rechercher un client/)!, 'tremblay');
    await patienter(300);
    await act(async () => { bouton(/Marc Tremblay/)?.click(); });
    await act(async () => { bouton(/Créer le deal/)?.click(); });
    await act(async () => { await Promise.resolve(); });

    const envoye = creerMock.mock.calls[0][0];
    expect(envoye.clientId).toBe('c-marc');
    expect(envoye.courriel).toBeNull();
    expect(envoye.telephone).toBeNull();
    expect(envoye.quoteId).toBeNull();
  });

  it('nouveau contact : un nom déjà connu est signalé, et la fiche existante est offerte', async () => {
    rechercheClientsMock.mockResolvedValue([MARC]);
    await rendre(PIPELINE_DEFAUT);
    await act(async () => { bouton(/nouveau deal/i)?.click(); });
    await act(async () => { bouton(/nouveau contact/i)?.click(); });
    await taper(champ(/Prénom/)!, 'Marc');
    await taper(champ(/^Nom/)!, 'Tremblay');
    await patienter(450);

    expect(conteneur.textContent).toMatch(/porte déjà ce nom/);
    await act(async () => { bouton(/Utiliser cette fiche/)?.click(); });
    await act(async () => { bouton(/Créer le deal/)?.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(creerMock.mock.calls[0][0].clientId).toBe('c-marc');
  });

  it("nouveau contact : l'avertissement ne bloque pas une homonymie réelle", async () => {
    // Avertir, pas bloquer : deux personnes peuvent porter le même nom.
    rechercheClientsMock.mockResolvedValue([MARC]);
    await rendre(PIPELINE_DEFAUT);
    await act(async () => { bouton(/nouveau deal/i)?.click(); });
    await act(async () => { bouton(/nouveau contact/i)?.click(); });
    await taper(champ(/Prénom/)!, 'Marc');
    await taper(champ(/^Nom/)!, 'Tremblay');
    await patienter(450);
    await act(async () => { bouton(/Créer le deal/)?.click(); });
    await act(async () => { await Promise.resolve(); });

    const envoye = creerMock.mock.calls[0][0];
    expect(envoye.clientId).toBeNull();
    expect(envoye.prenom).toBe('Marc');
  });
});
