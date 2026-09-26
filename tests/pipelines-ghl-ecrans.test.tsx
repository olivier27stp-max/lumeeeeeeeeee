// @vitest-environment jsdom
//
// Onglet « Pipelines » façon GoHighLevel (mission du 2026-09-25) — les VRAIS
// composants, rendus. La base est prouvée à part (scripts/qa/verifier-pipelines-ghl.mjs,
// contre staging) ; ici on prouve que chaque geste de l'écran appelle la
// bonne fonction avec les bons arguments, et que les garde-fous se voient.
//
// Remplace pipeline-tableau.test.tsx et pipeline-creer-modal.test.tsx, qui
// testaient les écrans retirés.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const m = {
  dupliquer: vi.fn(async (..._a: any[]) => 'p-copie'),
  reordonner: vi.fn(async (..._a: any[]) => undefined),
  supprimer: vi.fn(async (..._a: any[]) => 3),
  compter: vi.fn(async (..._a: any[]) => 0),
  etapes: vi.fn(async (..._a: any[]): Promise<any[]> => []),
  deals: vi.fn(async (..._a: any[]): Promise<any[]> => []),
  enregistrer: vi.fn(async (..._a: any[]) => 'p-neuf'),
  renommerPipeline: vi.fn(async (..._a: any[]) => undefined),
  renommerEtape: vi.fn(async (..._a: any[]) => undefined),
  supprimerEtape: vi.fn(async (..._a: any[]) => 2),
  affichage: vi.fn(async (..._a: any[]) => undefined),
};

vi.mock('../src/lib/pipelineVentesApi', () => ({
  dupliquerPipeline: (...a: any[]) => m.dupliquer(...a),
  reordonnerPipelines: (...a: any[]) => m.reordonner(...a),
  supprimerPipeline: (...a: any[]) => m.supprimer(...a),
  compterDealsPipeline: (...a: any[]) => m.compter(...a),
  fetchStages: (...a: any[]) => m.etapes(...a),
  fetchDeals: (...a: any[]) => m.deals(...a),
  enregistrerPipeline: (...a: any[]) => m.enregistrer(...a),
  renommerPipeline: (...a: any[]) => m.renommerPipeline(...a),
  renommerEtape: (...a: any[]) => m.renommerEtape(...a),
  supprimerEtape: (...a: any[]) => m.supprimerEtape(...a),
  definirAffichagePipeline: (...a: any[]) => m.affichage(...a),
  reordonnerEtapes: vi.fn(async () => undefined),
  ajouterEtape: vi.fn(async () => ({ id: 'e-neuve' })),
  desarchiverEtape: vi.fn(async () => undefined),
  fetchRaisonsProposees: vi.fn(async () => []),
  ajouterRaisonProposee: vi.fn(async () => undefined),
  archiverRaisonProposee: vi.fn(async () => undefined),
  fetchBureauxAdministres: vi.fn(async () => []),
  copierVersBureaux: vi.fn(async () => 1),
  fetchMembres: vi.fn(async () => []),
  fetchRolesMembres: vi.fn(async () => ({})),
  fetchAccesPipeline: vi.fn(async () => []),
  donnerAccesPipeline: vi.fn(async () => undefined),
  retirerAccesPipeline: vi.fn(async () => undefined),
  majDroitModifier: vi.fn(async () => undefined),
  rouvrirPipeline: vi.fn(async () => undefined),
}));
vi.mock('../src/components/ui/ConfirmDialog', () => ({ confirmer: vi.fn(async () => true) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import PipelinesListe from '../src/components/pipeline/ghl/PipelinesListe';
import PipelineModal from '../src/components/pipeline/ghl/PipelineModal';
import PipelineDetail from '../src/components/pipeline/ghl/PipelineDetail';

const P1 = { id: 'p-1', name: 'Marketing Pipeline', is_default: true, position: 1, nb_etapes: 6, updated_at: '2026-09-23T16:54:00Z', color_mode: 'none' as const, use_deal_probability: false };
const P2 = { id: 'p-2', name: 'Commercial', is_default: false, position: 2, nb_etapes: 4, updated_at: '2026-09-24T19:31:00Z', color_mode: 'dot' as const, use_deal_probability: false };

const etape = (id: string, nom: string, kind: 'open' | 'won' | 'lost', position: number, probability: number | null, pipeline = 'p-1') => ({
  id, pipeline_id: pipeline, name_fr: nom, name_en: nom, guidance_fr: '', guidance_en: '', position, kind,
  probability, show_in_reports: true, show_in_pie: true, archived_at: null,
});
const ETAPES_P1 = [
  etape('e1', 'Nouveau lead', 'open', 1, 14.29), etape('e2', 'Contacté', 'open', 2, 28.57),
  etape('eg', 'Gagné', 'won', 3, 100), etape('ep', 'Perdu', 'lost', 4, 0),
];

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

async function rendre(el: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    racine.render(<QueryClientProvider client={qc}><MemoryRouter>{el}</MemoryRouter></QueryClientProvider>);
  });
  await attendre();
}
async function attendre(ms = 0) { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); }
async function clic(el: Element | null | undefined) {
  if (!el) throw new Error('élément absent');
  await act(async () => { (el as HTMLElement).click(); });
  await attendre();
}
const boutons = () => [...conteneur.querySelectorAll('button')];
const bouton = (re: RegExp) => boutons().find((b) => re.test(b.getAttribute('aria-label') ?? '') || re.test(b.textContent ?? ''));
async function saisir(el: HTMLInputElement | HTMLSelectElement, valeur: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, valeur); // setter natif : c'est ainsi que React voit la saisie
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
async function quitter(el: HTMLElement) {
  await act(async () => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
  await attendre();
}

beforeEach(() => {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  for (const f of Object.values(m)) f.mockClear();
  m.etapes.mockResolvedValue(ETAPES_P1);
  m.deals.mockResolvedValue([]);
  m.compter.mockResolvedValue(0);
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

const liste = (over: Record<string, unknown> = {}) => (
  <PipelinesListe
    fr
    admin
    pipelines={[P1, P2]}
    chargement={false}
    onCreer={vi.fn()}
    onModifier={vi.fn()}
    onOuvrir={vi.fn()}
    onChangement={vi.fn()}
    {...over}
  />
);

// ── Liste ───────────────────────────────────────────────────────

describe('liste « Pipelines »', () => {
  it('titre, sous-titre, bouton, colonnes GHL et lignes numérotées', async () => {
    await rendre(liste());
    const texte = conteneur.textContent ?? '';
    expect(texte).toContain('Utilisez les pipelines pour suivre vos opportunités');
    expect(bouton(/Créer un pipeline/)).toBeTruthy();
    const entetes = [...conteneur.querySelectorAll('th')].map((t) => t.textContent?.trim());
    expect(entetes).toEqual(['Ordre', '#', 'Nom du pipeline', 'Total d’étapes', 'Mis à jour le', 'Actions']);
    const lignes = [...conteneur.querySelectorAll('tbody tr')].map((r) => r.querySelectorAll('td')[1]?.textContent);
    expect(lignes).toEqual(['1', '2']);
  });

  it('pagination façon GHL : « 1 - 2 de 2 », « Page 1 de 1 »', async () => {
    await rendre(liste());
    const texte = conteneur.textContent ?? '';
    expect(texte).toContain('Lignes par page');
    expect(texte).toContain('1 - 2 de 2');
    expect(texte).toContain('Page 1 de 1');
  });

  it('le menu ⋮ offre exactement les 7 actions, dans l’ordre, Supprimer séparé', async () => {
    await rendre(liste());
    await clic(bouton(/Actions pour Commercial/));
    const items = [...conteneur.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent?.trim());
    expect(items).toEqual([
      'Modifier', 'Dupliquer', 'Copier vers d’autres bureaux', 'Gérer les permissions',
      'Copier le lien', 'Déplacer à la position', 'Supprimer',
    ]);
    expect(conteneur.querySelector('[role="menu"] [role="separator"]')).toBeTruthy();
  });

  it('un membre non administrateur ne voit que Modifier et Copier le lien', async () => {
    await rendre(liste({ admin: false }));
    expect(bouton(/Créer un pipeline/)).toBeFalsy();
    await clic(bouton(/Actions pour Commercial/));
    const items = [...conteneur.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent?.trim());
    expect(items).toEqual(['Modifier', 'Copier le lien']);
  });

  it('Modifier ouvre le modal pré-rempli (remonte au parent)', async () => {
    const onModifier = vi.fn();
    await rendre(liste({ onModifier }));
    await clic(bouton(/Actions pour Commercial/));
    await clic(bouton(/^Modifier$/));
    expect(onModifier).toHaveBeenCalledWith(P2);
  });

  it('Dupliquer appelle la base', async () => {
    await rendre(liste());
    await clic(bouton(/Actions pour Commercial/));
    await clic(bouton(/^Dupliquer$/));
    expect(m.dupliquer).toHaveBeenCalledWith('p-2');
  });

  it('Copier le lien met l’URL de la page détail dans le presse-papier', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await rendre(liste());
    await clic(bouton(/Actions pour Commercial/));
    await clic(bouton(/^Copier le lien$/));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/ventes?tab=reglages&pipeline=p-2'));
  });

  it('Déplacer à la position réordonne et persiste', async () => {
    await rendre(liste());
    await clic(bouton(/Actions pour Commercial/));
    await clic(bouton(/^Déplacer à la position$/));
    const champ = conteneur.querySelector('input[type="number"]') as HTMLInputElement;
    await saisir(champ, '1');
    await clic(bouton(/^Déplacer$/));
    expect(m.reordonner).toHaveBeenCalledWith(['p-2', 'p-1']);
  });

  it('Supprimer un pipeline qui a des deals : destination demandée et transmise', async () => {
    m.compter.mockResolvedValue(3);
    await rendre(liste());
    await clic(bouton(/Actions pour Commercial/));
    await clic(bouton(/^Supprimer$/));
    await attendre(10);
    expect(conteneur.textContent).toContain('Ce pipeline contient 3 deal(s)');
    expect(conteneur.textContent).toContain('Aucune automatisation ne sera déclenchée');
    const valider = boutons().filter((b) => b.textContent?.trim() === 'Supprimer').at(-1);
    await clic(valider);
    expect(m.supprimer).toHaveBeenCalledWith('p-2', { pipelineId: 'p-1', etapeId: 'e1' });
  });

  it('le dernier pipeline ne peut pas être supprimé', async () => {
    await rendre(liste({ pipelines: [P1] }));
    await clic(bouton(/Actions pour Marketing Pipeline/));
    await clic(bouton(/^Supprimer$/));
    expect(conteneur.textContent).toContain('dernier pipeline');
    const valider = boutons().filter((b) => b.textContent?.trim() === 'Supprimer').at(-1) as HTMLButtonElement;
    expect(valider.disabled).toBe(true);
    await clic(valider);
    expect(m.supprimer).not.toHaveBeenCalled();
  });
});

// ── Modal Créer / Modifier ──────────────────────────────────────

describe('modal « Créer un pipeline »', () => {
  const modal = (over: Record<string, unknown> = {}) => (
    <PipelineModal ouvert fr onFermer={vi.fn()} onEnregistre={vi.fn()} {...over} />
  );

  it('pré-rempli avec 4 étapes FR (20/40/60/80) + Gagné et Perdu verrouillés', async () => {
    await rendre(modal());
    const noms = [...conteneur.querySelectorAll('input[id^="etape-nom-"]')].map((i) => (i as HTMLInputElement).value);
    expect(noms).toEqual(['Nouveau lead', 'Contacté', 'Soumission envoyée', 'Fermé', 'Gagné', 'Perdu']);
    const probas = [...conteneur.querySelectorAll('input[id^="etape-proba-"]')].map((i) => (i as HTMLInputElement).value);
    expect(probas.slice(0, 4)).toEqual(['20', '40', '60', '80']);
    expect(conteneur.querySelectorAll('[aria-label="Verrouillée"]').length).toBe(2);
    expect(conteneur.textContent).toContain('Étapes du pipeline (6)');
  });

  it('« Créer » est désactivé tant que le nom est vide', async () => {
    await rendre(modal());
    const creer = bouton(/^Créer$/) as HTMLButtonElement;
    expect(creer.disabled).toBe(true);
    expect(creer.title).toContain('nom');
  });

  it('envoie le nom, les réglages et les étapes dans l’ordre', async () => {
    await rendre(modal());
    await saisir(conteneur.querySelector('input[placeholder="Pipeline marketing"]') as HTMLInputElement, 'Ventes B2B');
    await clic(boutons().find((b) => b.getAttribute('role') === 'radio' && b.textContent?.includes('Fond teinté')));
    await clic(bouton(/^Créer$/));
    expect(m.enregistrer).toHaveBeenCalledTimes(1);
    const [id, champs] = m.enregistrer.mock.calls[0];
    expect(id).toBeNull();
    expect(champs.nom).toBe('Ventes B2B');
    expect(champs.color_mode).toBe('tint');
    expect(champs.etapes.map((e: any) => e.probability)).toEqual([20, 40, 60, 80, 100, 0]);
    expect(champs.etapes.map((e: any) => e.kind)).toEqual(['open', 'open', 'open', 'open', 'won', 'lost']);
  });

  it('« + Ajouter une étape » l’insère avant Gagné', async () => {
    await rendre(modal());
    await clic(bouton(/Ajouter une étape/));
    expect(conteneur.textContent).toContain('Étapes du pipeline (7)');
    const kinds = [...conteneur.querySelectorAll('input[id^="etape-nom-"]')].map((i) => (i as HTMLInputElement).value);
    expect(kinds.slice(4)).toEqual(['', 'Gagné', 'Perdu']);
  });

  it('Modifier : titre, bouton « Enregistrer », étapes existantes chargées', async () => {
    await rendre(modal({ pipeline: P1 }));
    await attendre(10);
    expect(conteneur.textContent).toContain('Modifier le pipeline');
    expect(bouton(/^Enregistrer$/)).toBeTruthy();
    const noms = [...conteneur.querySelectorAll('input[id^="etape-nom-"]')].map((i) => (i as HTMLInputElement).value);
    expect(noms).toEqual(['Nouveau lead', 'Contacté', 'Gagné', 'Perdu']);
    await clic(bouton(/^Enregistrer$/));
    expect(m.enregistrer.mock.calls[0][0]).toBe('p-1');
    expect(m.enregistrer.mock.calls[0][1].etapes[0].id).toBe('e1');
  });
});

// ── Page détail ─────────────────────────────────────────────────

describe('page détail d’un pipeline', () => {
  const detail = () => <PipelineDetail fr pipeline={P1} onRetour={vi.fn()} onChangement={vi.fn()} />;

  it('flèche retour, nom, crayon, onglets Étapes et Smart tags (Bientôt)', async () => {
    await rendre(detail());
    expect(bouton(/Retour à la liste des pipelines/)).toBeTruthy();
    expect(conteneur.textContent).toContain('Marketing Pipeline');
    await clic([...conteneur.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Smart tags'));
    expect(conteneur.textContent).toContain('Bientôt');
  });

  it('le crayon renomme le pipeline, enregistré à la sortie du champ', async () => {
    await rendre(detail());
    await clic(bouton(/Renommer le pipeline/));
    const champ = conteneur.querySelector('input[type="text"]') as HTMLInputElement;
    await saisir(champ, 'Marketing 2027');
    await quitter(champ);
    expect(m.renommerPipeline).toHaveBeenCalledWith('p-1', 'Marketing 2027');
  });

  it('la probabilité se modifie dans la ligne et s’enregistre seule', async () => {
    await rendre(detail());
    const champ = conteneur.querySelector('#etape-e1-proba') as HTMLInputElement;
    expect(champ.value).toBe('14.29');
    await saisir(champ, '33,5');
    await quitter(champ);
    expect(m.renommerEtape).toHaveBeenCalledWith('e1', { probability: 33.5 });
  });

  it('une probabilité hors 0–100 est refusée sans appel', async () => {
    await rendre(detail());
    const champ = conteneur.querySelector('#etape-e1-proba') as HTMLInputElement;
    await saisir(champ, '150');
    await quitter(champ);
    expect(m.renommerEtape).not.toHaveBeenCalled();
  });

  it('entonnoir et camembert se basculent indépendamment', async () => {
    await rendre(detail());
    await clic(bouton(/« Contacté » dans le graphique circulaire/));
    expect(m.renommerEtape).toHaveBeenCalledWith('e2', { show_in_pie: false });
  });

  it('Supprimer une étape avec des deals demande où les déplacer', async () => {
    m.deals.mockResolvedValue([{ id: 'd1', stage_id: 'e1' }, { id: 'd2', stage_id: 'e1' }]);
    await rendre(detail());
    await attendre(10);
    await clic(bouton(/Actions pour l’étape Nouveau lead/));
    await clic(bouton(/^Supprimer$/));
    expect(conteneur.textContent).toContain('2 deal(s) sont à cette étape');
    const valider = boutons().filter((b) => b.textContent?.trim() === 'Supprimer').at(-1);
    await clic(valider);
    expect(m.supprimerEtape).toHaveBeenCalledWith('e1', 'e2');
  });

  it('Gagné et Perdu : cadenas, suppression désactivée', async () => {
    await rendre(detail());
    expect(conteneur.querySelectorAll('[aria-label="Verrouillée"]').length).toBe(2);
    await clic(bouton(/Actions pour l’étape Gagné/));
    const supprimer = boutons().find((b) => b.getAttribute('role') === 'menuitem' && b.textContent?.trim() === 'Supprimer') as HTMLButtonElement;
    expect(supprimer.disabled).toBe(true);
  });
});
