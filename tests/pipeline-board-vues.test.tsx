// @vitest-environment jsdom
//
// Le VRAI board de ventes, rendu.
//
// Deux défauts corrigés ici étaient invisibles en base, et c'est pour ça que
// ce test existe :
//
//   · le sélecteur de pipeline affichait UNE option codée en dur, sans
//     `onChange`. La table `pipelines_ventes` était parfaitement correcte —
//     on pouvait créer un 2e pipeline dans les réglages sans jamais pouvoir
//     le consulter ;
//   · deux onglets de vues (« Deals ouverts » et « Tous ») portaient
//     exactement les mêmes filtres et affichaient donc la même chose.
//
// Une requête à la base n'aurait rien signalé dans les deux cas. Seul le
// rendu le dit.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const fetchVuesMock = vi.fn(async () => [] as any[]);
const creerVueMock = vi.fn(async () => 'vue-1');

vi.mock('../src/lib/pipelineVentesApi', () => ({
  fetchVues: (...a: any[]) => fetchVuesMock(...(a as [])),
  creerVue: (...a: any[]) => creerVueMock(...(a as [])),
  supprimerVue: vi.fn(async () => undefined),
  creerDealManuel: vi.fn(async () => ({ deal_id: 'd', client_id: 'c', cree: true })),
  estJobACreer: () => false,
  nomClient: (d: any) => `${d.client?.first_name ?? ''} ${d.client?.last_name ?? ''}`.trim() || 'Client',
  // Forme RÉELLE de `priorite` : un objet, pas une chaîne. Un mock trop
  // simple faisait planter le rendu sur `LIBELLE_PRIORITE[prio.niveau]`.
  // Les pastilles sont dérivées : on garde la forme réelle (tableau
  // d'objets), sinon le rendu planterait sur `p.ton`. Leur logique a son
  // propre test — ici on veut seulement que la carte se dessine.
  pastilles: () => [],
  priorite: (d: any, stages: any[]) => {
    const s = stages.find((x: any) => x.id === d.stage_id);
    return s && s.kind === 'open' ? { niveau: 'frais', jours: 0 } : null;
  },
  fetchRaisonsProposees: vi.fn(async () => []),
}));

vi.mock('../src/hooks/usePermissions', () => ({
  usePermissions: () => ({ role: 'owner', permissions: {} }),
}));

vi.mock('../src/i18n', () => ({
  // `t` doit porter les clés que les composants partagés lisent vraiment :
  // `Modal` fait `t.common.close` pour son bouton de fermeture, et un `t`
  // vide le fait planter — un défaut du mock, pas du composant.
  useTranslation: () => ({
    language: 'fr',
    t: { common: { close: 'Fermer', cancel: 'Annuler', save: 'Enregistrer' } },
  }),
}));

import PipelineBoard from '../src/components/pipeline/PipelineBoard';

const ETAPES = [
  { id: 'e1', pipeline_id: 'p1', name_fr: 'Nouveau lead', name_en: 'New lead', guidance_fr: '', guidance_en: '', position: 1, kind: 'open' as const, archived_at: null },
  { id: 'e2', pipeline_id: 'p1', name_fr: 'Gagné', name_en: 'Won', guidance_fr: '', guidance_en: '', position: 2, kind: 'won' as const, archived_at: null },
  { id: 'e3', pipeline_id: 'p1', name_fr: 'Perdu', name_en: 'Lost', guidance_fr: '', guidance_en: '', position: 3, kind: 'lost' as const, archived_at: null },
];

const PIPELINES = [
  { id: 'p1', name: 'Pipeline de ventes', is_default: true },
  { id: 'p2', name: 'Contrats saisonniers', is_default: false },
];

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

async function rendre(props: Partial<React.ComponentProps<typeof PipelineBoard>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    racine.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PipelineBoard
            deals={[]}
            etapes={ETAPES}
            montants={{}}
            membres={[]}
            pipelines={PIPELINES}
            pipelineActif="p1"
            onChangerPipeline={vi.fn()}
            onOuvrir={vi.fn()}
            onDeplacer={vi.fn()}
            onAssigner={vi.fn()}
            {...props}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

/** Le sélecteur de pipeline : celui dont les options portent des id de pipeline. */
function selecteurPipeline(): HTMLSelectElement | null {
  const selects = [...conteneur.querySelectorAll('select')] as HTMLSelectElement[];
  return selects.find((s) => [...s.options].some((o) => o.value === 'p1')) ?? null;
}

beforeEach(() => {
  fetchVuesMock.mockClear();
  creerVueMock.mockClear();
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

describe('board — sélecteur de pipeline', () => {
  it('propose tous les pipelines, pas une option codée en dur', async () => {
    await rendre();
    const sel = selecteurPipeline();
    expect(sel, 'aucun sélecteur ne liste les pipelines').not.toBeNull();
    const valeurs = [...sel!.options].map((o) => o.value);
    expect(valeurs).toEqual(['p1', 'p2']);
    // Le défaut « ventes » était la valeur en dur de l'ancien sélecteur.
    expect(valeurs).not.toContain('ventes');
  });

  it('affiche le pipeline actif, et prévient le parent quand on en change', async () => {
    const onChangerPipeline = vi.fn();
    await rendre({ onChangerPipeline });
    const sel = selecteurPipeline()!;
    expect(sel.value).toBe('p1');

    await act(async () => {
      sel.value = 'p2';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChangerPipeline).toHaveBeenCalledWith('p2');
  });

  it("se désactive quand l'organisation n'a qu'un seul pipeline", async () => {
    await rendre({ pipelines: [PIPELINES[0]] });
    // Un sélecteur actif qui n'offre aucun choix invite à un clic sans effet.
    expect(selecteurPipeline()!.disabled).toBe(true);
  });
});

describe('board — onglets de vues', () => {
  it('ne montre jamais deux onglets identiques', async () => {
    await rendre();
    const libelles = [...conteneur.querySelectorAll('[role="tab"]')]
      .map((e) => e.textContent?.trim() ?? '');
    expect(libelles.length).toBeGreaterThan(0);
    expect(new Set(libelles).size).toBe(libelles.length);
  });

  it('affiche les vues enregistrées à la suite des vues intégrées', async () => {
    fetchVuesMock.mockResolvedValueOnce([
      { id: 'v1', pipeline_id: 'p1', user_id: 'u1', nom: 'Mes gros jobs', filtres: { priorite: 'urgent' }, tri: null, affichage: null, position: 0 },
      { id: 'v2', pipeline_id: 'p1', user_id: null, nom: 'Vue équipe', filtres: {}, tri: null, affichage: null, position: 1 },
    ]);
    await rendre();
    // Le rendu attend la requête des vues.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const texte = conteneur.textContent ?? '';
    expect(texte).toContain('Mes gros jobs');
    expect(texte).toContain('Vue équipe');
    // Une vue d'équipe doit se distinguer : sinon on ne comprend pas
    // pourquoi on n'arrive pas à la supprimer.
    expect(texte).toContain('équipe');
  });
});

describe('board — filtres avancés', () => {
  /** Un deal minimal, dans l'étape et avec l'âge qu'on veut tester. */
  function deal(id: string, stage: string, jours = 0) {
    const t = new Date(Date.now() - jours * 86_400_000).toISOString();
    return {
      id, pipeline_id: 'p1', stage_id: stage, client_id: `c-${id}`,
      assigned_user_id: null, source: 'manual',
      utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, fbclid: null,
      job_id: null, quote_id: null, first_contacted_at: null,
      last_activity_at: t, stage_entered_at: t, won_at: null, lost_at: null,
      lost_reason: null, lost_from_stage_id: null, pin_id: null, field_rep_id: null,
      created_at: t,
      client: { first_name: 'Client', last_name: id, company: null, email: null, phone: null, address: null },
    } as any;
  }

  /** Les titres des colonnes réellement dessinées. */
  function colonnes(): string[] {
    return [...conteneur.querySelectorAll('h3')].map((h) => h.textContent?.trim() ?? '');
  }

  /**
   * React installe son propre setter sur `value` : écrire `input.value = x`
   * puis émettre `input` ne le réveille pas. Il faut passer par le setter
   * natif du prototype, que React surveille.
   */
  function saisir(el: HTMLInputElement, valeur: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, valeur);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function ouvrirPanneau() {
    const bouton = [...conteneur.querySelectorAll('button')]
      .find((b) => /filtre|filter/i.test(b.textContent ?? '')) as HTMLButtonElement | undefined;
    expect(bouton, 'bouton Filtres introuvable').toBeTruthy();
    await act(async () => { bouton!.click(); });
  }

  function champ(label: RegExp): HTMLSelectElement | HTMLInputElement {
    const lab = [...conteneur.querySelectorAll('label')]
      .find((l) => label.test(l.textContent ?? ''));
    expect(lab, `label ${label} introuvable`).toBeTruthy();
    // `getElementById` plutôt qu'un sélecteur : les ids de `useId()`
    // contiennent des « : », que jsdom n'échappe pas sans CSS.escape.
    const el = [...conteneur.querySelectorAll('select,input')]
      .find((n) => (n as HTMLElement).id === lab!.htmlFor);
    expect(el, `champ de ${label} introuvable`).toBeTruthy();
    return el as HTMLSelectElement | HTMLInputElement;
  }

  it("le filtre d'étape ne garde que la colonne demandée", async () => {
    await rendre({ deals: [deal('a', 'e1'), deal('b', 'e2')] });
    await ouvrirPanneau();

    // On compte les COLONNES, pas le texte de la page : le sélecteur d'étape
    // cite aussi « Gagné » et « Perdu » dans ses options.
    expect(colonnes()).toEqual(['Nouveau lead', 'Gagné', 'Perdu']);

    const sel = champ(/Étape|Stage/) as HTMLSelectElement;
    await act(async () => {
      sel.value = 'e1';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Laisser les autres colonnes afficherait « aucun deal » pour une
    // information qu'on vient justement de demander à masquer.
    expect(colonnes()).toEqual(['Nouveau lead']);
  });

  it('le montant minimum écarte les deals sans montant connu', async () => {
    // Un deal sans montant n'est pas « 0 $ » : c'est un montant qu'on ignore.
    await rendre({
      deals: [deal('riche', 'e1'), deal('inconnu', 'e1')],
      montants: { riche: 500_000 },
    });
    await ouvrirPanneau();

    const input = champ(/Montant minimum|Minimum amount/) as HTMLInputElement;
    await act(async () => { saisir(input, '2000'); });

    expect(conteneur.textContent).toContain('riche');
    expect(conteneur.textContent).not.toContain('inconnu');
  });

  it('« entrés depuis » écarte les deals plus vieux que la fenêtre', async () => {
    await rendre({ deals: [deal('recent', 'e1', 2), deal('vieux', 'e1', 60)] });
    await ouvrirPanneau();

    const sel = champ(/Entrés depuis|Created within/) as HTMLSelectElement;
    await act(async () => {
      sel.value = '7';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(conteneur.textContent).toContain('recent');
    expect(conteneur.textContent).not.toContain('vieux');
  });
});

describe('board — actions en lot', () => {
  function deal(id: string, stage = 'e1') {
    const t = new Date().toISOString();
    return {
      id, pipeline_id: 'p1', stage_id: stage, client_id: `c-${id}`,
      assigned_user_id: null, source: 'manual',
      utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, fbclid: null,
      job_id: null, quote_id: null, first_contacted_at: null,
      last_activity_at: t, stage_entered_at: t, won_at: null, lost_at: null,
      lost_reason: null, lost_from_stage_id: null, pin_id: null, field_rep_id: null,
      created_at: t,
      client: { first_name: 'Client', last_name: id, company: null, email: null, phone: null, address: null },
    } as any;
  }

  function cases(): HTMLInputElement[] {
    return [...conteneur.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
  }

  it("la barre d'actions n'apparaît que quand un deal est coché", async () => {
    await rendre({ deals: [deal('a'), deal('b')] });
    // Une barre toujours visible prendrait de la place pour un geste rare.
    expect(conteneur.textContent).not.toContain('sélectionné');

    await act(async () => { cases()[0].click(); });
    expect(conteneur.textContent).toContain('1 deal sélectionné');

    await act(async () => { cases()[1].click(); });
    expect(conteneur.textContent).toContain('2 deals sélectionnés');
  });

  it('assigner en lot appelle le parent pour chaque deal coché', async () => {
    const onAssigner = vi.fn(async () => {});
    await rendre({ deals: [deal('a'), deal('b')], membres: [{ id: 'm1', name: 'Alex' }], onAssigner });

    await act(async () => { cases()[0].click(); });
    await act(async () => { cases()[1].click(); });

    const sel = [...conteneur.querySelectorAll('select')]
      .find((x) => [...x.options].some((o) => o.value === 'm1')) as HTMLSelectElement;
    await act(async () => {
      sel.value = 'm1';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onAssigner).toHaveBeenCalledTimes(2);
    expect(onAssigner).toHaveBeenCalledWith('a', 'm1');
    expect(onAssigner).toHaveBeenCalledWith('b', 'm1');
    // La sélection se vide : garder des cartes cochées après coup laisserait
    // croire qu'une seconde action porterait encore sur elles.
    expect(conteneur.textContent).not.toContain('sélectionné');
  });

  it('le déplacement en lot ne propose JAMAIS gagné ni perdu', async () => {
    await rendre({ deals: [deal('a')] });
    await act(async () => { cases()[0].click(); });

    const sel = [...conteneur.querySelectorAll('select')]
      .find((x) => [...x.options].some((o) => /Déplacer vers/.test(o.textContent ?? ''))) as HTMLSelectElement;
    const libelles = [...sel.options].map((o) => o.textContent);

    // Gagner ouvre la fenêtre de création de job ; perdre exige une raison.
    // Un déplacement en masse sauterait les deux et laisserait des deals
    // fermés sans job ni motif — ce que les statistiques lisent ensuite.
    expect(libelles).toContain('Nouveau lead');
    expect(libelles).not.toContain('Gagné');
    expect(libelles).not.toContain('Perdu');
  });
});

describe('board — enregistrer une vue', () => {
  function boutonEnregistrer(): HTMLButtonElement {
    const b = [...conteneur.querySelectorAll('button')]
      .find((x) => /Enregistrer la vue/.test(x.textContent ?? '')) as HTMLButtonElement;
    expect(b, 'bouton « Enregistrer la vue » introuvable').toBeTruthy();
    return b;
  }

  it("le bouton est désactivé tant qu'aucun filtre n'est actif", async () => {
    await rendre();
    // Une vue « aucun filtre » ne sert à rien : c'est déjà l'onglet « Tous ».
    expect(boutonEnregistrer().disabled).toBe(true);
  });

  it('enregistre les filtres courants sous le nom donné', async () => {
    await rendre();

    // Un filtre, pour activer le bouton.
    const recherche = conteneur.querySelector('input[type="search"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(recherche, 'Tremblay');
      recherche.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(boutonEnregistrer().disabled).toBe(false);

    await act(async () => { boutonEnregistrer().click(); });

    // Par son libellé : le modal est rendu dans document.body (portail),
    // pas dans `conteneur`.
    const lab = [...document.querySelectorAll('label')]
      .find((l) => /Nom de la vue/.test(l.textContent ?? ''));
    expect(lab, 'libellé du nom introuvable').toBeTruthy();
    const nom = document.getElementById(lab!.htmlFor) as HTMLInputElement;
    expect(nom, 'champ du nom introuvable').toBeTruthy();
    await act(async () => {
      setter?.call(nom, 'Mes Tremblay');
      nom.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const valider = [...document.querySelectorAll('button')]
      .find((b) => b.getAttribute('type') === 'submit') as HTMLButtonElement;
    await act(async () => { valider.click(); });

    expect(creerVueMock).toHaveBeenCalledTimes(1);
    const [pipelineId, nomVue, filtres] = creerVueMock.mock.calls[0] as any[];
    expect(pipelineId).toBe('p1');
    expect(nomVue).toBe('Mes Tremblay');
    // Les filtres RENSEIGNÉS voyagent avec la vue — c'est tout son intérêt.
    expect(filtres.texte).toBe('Tremblay');
  });
});
