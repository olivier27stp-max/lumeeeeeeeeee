// @vitest-environment jsdom
/**
 * Bibliothèque de modèles — constats de l'audit UI du 2026-10-01 (lot 2),
 * prouvés sur la VRAIE fenêtre rendue en jsdom ; seule l'API est simulée, et
 * elle sert le vrai catalogue du serveur.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const api = vi.hoisted(() => ({
  lire: vi.fn(),
  utiliser: vi.fn(),
}));
vi.mock('../../src/i18n', () => ({ useTranslation: () => ({ t: { common: { close: 'Fermer' } }, language: 'fr' }) }));
vi.mock('../../src/lib/automationBuilderApi', () => ({
  fetchModelesAutomatisation: api.lire,
  utiliserModele: api.utiliser,
}));

import BibliothequeModeles from '../../src/components/automations/BibliothequeModeles';
import { MODELES_AUTOMATISATION } from '../../server/lib/automationTemplates';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLDivElement;
const attendre = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => {
  api.lire.mockReset().mockResolvedValue(MODELES_AUTOMATISATION);
  api.utiliser.mockReset();
});
afterEach(() => { act(() => racine?.unmount()); conteneur?.remove(); racine = null; });

async function monter(fr = true) {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => { racine!.render(<BibliothequeModeles open fr={fr} onClose={() => {}} onCree={() => {}} onErreur={() => {}} />); });
  await attendre();
}

const fenetre = () => document.querySelector('[role="dialog"]') as HTMLElement;
const bouton = (re: RegExp) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent ?? '').trim()) || re.test(b.getAttribute('aria-label') ?? '')) as HTMLButtonElement;
/** Un vrai clic pose d'abord le focus sur le bouton : jsdom ne le fait pas tout seul. */
const cliquer = (b: HTMLElement) => act(() => { b.focus(); b.click(); });

describe('modeles-04 — le focus suit l’aperçu', () => {
  it('à l’ouverture de l’aperçu, le focus est sur le titre du modèle, dans la fenêtre', async () => {
    await monter();
    cliquer(bouton(/Prospect — Bienvenue/));
    const actif = document.activeElement as HTMLElement;
    expect(actif).not.toBe(document.body);
    expect(fenetre().contains(actif)).toBe(true);
    expect(actif.tagName).toBe('H3');
    expect(actif.textContent).toBe('Prospect — Bienvenue');
    expect(actif.getAttribute('tabindex')).toBe('-1');
  });

  it('« Retour » rend le focus à la carte du modèle qu’on regardait', async () => {
    await monter();
    cliquer(bouton(/Prospect — Bienvenue/));
    cliquer(bouton(/^Retour$/));
    const actif = document.activeElement as HTMLElement;
    expect(actif.tagName).toBe('BUTTON');
    expect(actif.textContent).toContain('Prospect — Bienvenue');
  });

  it('en vue liste aussi, le focus revient sur la ligne du modèle', async () => {
    await monter();
    cliquer(bouton(/^Liste$/));
    cliquer(bouton(/Contrat signé/));
    expect((document.activeElement as HTMLElement).tagName).toBe('H3');
    cliquer(bouton(/^Retour$/));
    expect((document.activeElement as HTMLElement).textContent).toContain('Contrat signé');
  });
});

const caseDe = (re: RegExp) => {
  const etiquette = [...document.querySelectorAll('label')].find((l) => re.test(l.textContent ?? ''));
  return etiquette ? document.getElementById(etiquette.htmlFor) as HTMLInputElement : null;
};
const compteur = () => (document.querySelector('[aria-live="polite"]')?.textContent ?? '').trim();

describe('modeles-05 — une catégorie cochée reste visible', () => {
  it('« Pipeline / leads » cochée puis « Afficher moins » : la case reste là, cochée', async () => {
    await monter();
    expect(caseDe(/Pipeline \/ leads/)).toBeNull(); // dans la seconde partie de la liste
    cliquer(bouton(/^Afficher plus$/));
    cliquer(caseDe(/Pipeline \/ leads/)!); // présente : la liste est dépliée
    const n = MODELES_AUTOMATISATION.filter((m) => m.categorie === 'pipeline').length;
    expect(compteur()).toBe(`Affichage de ${n} modèles`);

    cliquer(bouton(/^Afficher moins$/));
    expect(compteur()).toBe(`Affichage de ${n} modèles`); // le filtre tient toujours
    const restee = caseDe(/Pipeline \/ leads/);
    expect(restee, 'la case qui filtre encore a disparu').not.toBeNull();
    expect(restee!.checked).toBe(true);
    // L'autre catégorie de la seconde partie, non cochée, est bien repliée.
    expect(caseDe(/Relance \/ réactivation de clients/)).toBeNull();

    // Décochée, elle n'a plus de raison de rester : la liste repliée revient à ses cinq cases.
    cliquer(restee!);
    expect(caseDe(/Pipeline \/ leads/)).toBeNull();
    expect(compteur()).toBe(`Affichage de ${MODELES_AUTOMATISATION.length} modèles`);
  });
});

const saisir = (el: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); // setter natif : React lit l'événement
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('modeles-06 — « Tous les modèles » ne dit « tout est affiché » que si c’est vrai', () => {
  it('pendant une recherche qui réduit la liste, le bouton n’est plus enfoncé ; il l’est de nouveau après', async () => {
    await monter();
    const tous = () => bouton(/^Tous les modèles$/);
    expect(tous().getAttribute('aria-pressed')).toBe('true');

    act(() => saisir(document.querySelector('input[type="search"]') as HTMLInputElement, 'dépôt'));
    await attendre(260);
    expect(compteur()).not.toBe(`Affichage de ${MODELES_AUTOMATISATION.length} modèles`); // la liste est bien réduite
    expect(tous().getAttribute('aria-pressed')).toBe('false');
    expect(tous().className).not.toMatch(/(^| )bg-surface-secondary( |$)/); // plus surligné

    cliquer(tous());
    await attendre(260);
    expect(compteur()).toBe(`Affichage de ${MODELES_AUTOMATISATION.length} modèles`);
    expect(tous().getAttribute('aria-pressed')).toBe('true');
    expect((document.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('');
  });

  it('une catégorie cochée le relâche aussi (inchangé)', async () => {
    await monter();
    cliquer(caseDe(/Facturation et paiements/)!); // présente : première partie de la liste
    expect(bouton(/^Tous les modèles$/).getAttribute('aria-pressed')).toBe('false');
  });
});

const carte = (id: string) => [...document.querySelectorAll<HTMLButtonElement>('button[data-modele]')].find((b) => b.dataset.modele === id)!;
/** La ligne « Conditions » sous le déclencheur, telle qu'on la lit. */
const ligneConditions = () => ([...fenetre().querySelectorAll('p')].find((p) => /^(Conditions|Aucune condition|No conditions)/.test(p.textContent ?? ''))?.textContent ?? '').trim();
/** Les intitulés des étapes « Si … » de l'aperçu. */
const lignesSi = () => [...fenetre().querySelectorAll('ol li span')].map((s) => (s.textContent ?? '').trim()).filter((t) => /^(Si|If) /.test(t));

describe('modeles-01 — les conditions se lisent en clair, dans la langue de l’interface', () => {
  const DECLENCHEUR: Array<[string, string, string]> = [
    ['welcome_new_lead', 'Conditions : Sauf les demandes venues du formulaire de demande', 'Conditions: Except requests that came from the request form'],
    ['pack_suivi_prospect', 'Conditions : Sauf les demandes venues du formulaire de demande', 'Conditions: Except requests that came from the request form'],
    ['deposit_received', 'Conditions : Seulement pour un paiement de dépôt', 'Conditions: Only for a deposit payment'],
    ['payment_confirmation', 'Conditions : Sauf pour un paiement de dépôt', 'Conditions: Except for a deposit payment'],
    ['lost_lead_reengagement', 'Conditions : Seulement quand le prospect passe à « Perdu »', 'Conditions: Only when the lead is marked “Lost”'],
    ['quote_opened_notify', 'Conditions : Première ouverture seulement', 'Conditions: First open only'],
    ['quote_opened_move_deal', 'Conditions : Première ouverture seulement', 'Conditions: First open only'],
  ];

  for (const [id, fr, en] of DECLENCHEUR) {
    it(`${id} : la ligne « Conditions » dit ce qui est filtré`, async () => {
      await monter(true);
      cliquer(carte(id));
      expect(ligneConditions()).toBe(fr);
      act(() => racine?.unmount()); conteneur.remove();
      await monter(false);
      cliquer(carte(id));
      expect(ligneConditions()).toBe(en);
    });
  }

  it('les étapes « Si » de la relance de devis disent par où le devis est parti', async () => {
    await monter(true);
    cliquer(carte('pack_relance_devis'));
    expect(lignesSi().length).toBeGreaterThan(0);
    for (const l of lignesSi()) expect(l).toBe('Si l’envoi s’est fait par texto');
    act(() => racine?.unmount()); conteneur.remove();
    await monter(false);
    cliquer(carte('pack_relance_devis'));
    expect(lignesSi().length).toBeGreaterThan(0);
    for (const l of lignesSi()) expect(l).toBe('If it was sent by text message');
  });

  it('AUCUN modèle servi ne montre une clé ou une valeur technique', async () => {
    const avecConditions = MODELES_AUTOMATISATION.filter((m) => Object.keys(m.conditions).length > 0
      || (m.steps ?? []).some((e) => e.type === 'si'));
    // La liste du constat : sept modèles filtrés au déclencheur, un avec des étapes « si ».
    expect(avecConditions.length).toBeGreaterThanOrEqual(8);
    for (const francais of [true, false]) {
      await monter(francais);
      for (const m of avecConditions) {
        cliquer(carte(m.id));
        const cles = [
          ...Object.keys(m.conditions),
          ...(m.steps ?? []).flatMap((e) => (e.type === 'si' ? Object.keys(e.conditions) : [])),
        ];
        for (const ligne of [ligneConditions(), ...lignesSi()]) {
          expect(ligne, `${m.id} (${francais ? 'fr' : 'en'})`).not.toMatch(/[_=≠∈<>]/);
          // Ni la forme du repli (« source n’est pas … », « channel is … ») : chaque
          // condition d'un modèle servi a sa phrase à elle. (Le mot de la clé peut,
          // lui, être du vrai français : « Première ouverture seulement ».)
          for (const cle of cles) {
            expect(ligne, `${m.id} (${francais ? 'fr' : 'en'})`).not.toMatch(new RegExp(`(^|[^a-zà-ÿ])${cle.replace(/_/g, ' ')} (est|n’est|is)( |$)`, 'i'));
          }
        }
        cliquer(bouton(francais ? /^Retour$/ : /^Back$/));
      }
      act(() => racine?.unmount()); conteneur.remove();
    }
  });

  it('une condition inconnue de la table reste lisible (repli), sans symbole ni tiret bas', async () => {
    const base = MODELES_AUTOMATISATION.find((m) => m.id === 'thank_you_after_job')!; // présent : modèle du socle
    api.lire.mockResolvedValue([{
      ...base, id: 'invente',
      conditions: { zone_de_service: { neq: 'rive_sud' }, montant: { gte: 500, lt: 2000 }, statut_du_dossier: 'en_cours', ville: { in: ['Laval', 'Longueuil'] } },
    }]);
    await monter(true);
    cliquer(carte('invente'));
    expect(ligneConditions()).toBe('Conditions : zone de service n’est pas « rive sud » · montant est d’au moins 500 · montant est inférieur à 2000 · statut du dossier est « en cours » · ville est parmi « Laval », « Longueuil »');
  });

  it('sans condition, la ligne le dit', async () => {
    await monter(true);
    cliquer(carte('thank_you_after_job'));
    expect(ligneConditions()).toBe('Aucune condition.');
  });
});

/** Les étapes numérotées de l'aperçu, telles qu'on les lit. */
const etapesAffichees = () => [...fenetre().querySelectorAll('ol > li')];
const canauxAnnonces = (dans: Element) => [...dans.querySelectorAll('svg[aria-label]')].map((s) => s.getAttribute('aria-label'));

describe('modeles-07 — autant d’étapes annoncées que de cartes dans l’éditeur', () => {
  it('« Prospect — Bienvenue » : la carte dit 4 étapes, l’aperçu en liste 4, la 4e est la note technique', async () => {
    await monter();
    expect(carte('welcome_new_lead').textContent).toContain('4 étapes');
    cliquer(carte('welcome_new_lead'));
    const etapes = etapesAffichees();
    expect(etapes.length).toBe(4);
    // Les mots de l'éditeur, pour qu'on reconnaisse la même étape des deux côtés.
    expect(etapes[3].textContent).toContain('Note dans l’historique');
    expect(etapes[3].textContent).toContain('Étape technique, automatique');
    expect(fenetre().textContent).not.toContain('log_activity');
  });

  it('en anglais : « History note — Technical step, automatic »', async () => {
    await monter(false);
    expect(carte('welcome_new_lead').textContent).toContain('4 steps');
    cliquer(carte('welcome_new_lead'));
    const etapes = etapesAffichees();
    expect(etapes[3].textContent).toContain('History note');
    expect(etapes[3].textContent).toContain('Technical step, automatic');
  });

  it('chaque carte annonce le nombre d’étapes que son aperçu liste', async () => {
    await monter();
    for (const m of MODELES_AUTOMATISATION) {
      const annonce = Number(/(\d+) étapes?$/.exec((carte(m.id).textContent ?? '').trim())?.[1]);
      cliquer(carte(m.id));
      expect(etapesAffichees().length, m.id).toBe(annonce);
      cliquer(bouton(/^Retour$/));
    }
  });
});

describe('modeles-08 — la carte et l’aperçu montrent toutes les branches', () => {
  it('« Relance de devis » : 23 étapes et l’icône Courriel sur la carte et sur la ligne', async () => {
    await monter();
    expect(carte('pack_relance_devis').textContent).toContain('23 étapes');
    expect(canauxAnnonces(carte('pack_relance_devis'))).toEqual(['Texto', 'Courriel', 'Notification', 'Tâche']);
    cliquer(bouton(/^Liste$/));
    expect(carte('pack_relance_devis').textContent).toContain('23 étapes');
    expect(canauxAnnonces(carte('pack_relance_devis'))).toEqual(['Texto', 'Courriel', 'Notification', 'Tâche']);
  });

  it('l’aperçu montre les 23 étapes, dont les 5 courriels de la branche « si non »', async () => {
    await monter();
    cliquer(carte('pack_relance_devis'));
    const etapes = etapesAffichees();
    expect(etapes.length).toBe(23);
    const courriels = etapes.filter((li) => /Envoyer un courriel/.test(li.textContent ?? ''));
    const textos = etapes.filter((li) => /Envoyer un texto/.test(li.textContent ?? ''));
    expect(courriels.length).toBe(5);
    expect(textos.length).toBe(5);
    // Chaque message dit de quel côté du « Si » il part — les mots de l'éditeur.
    for (const li of textos) expect(li.textContent).toContain('si oui');
    for (const li of courriels) expect(li.textContent).toContain('si non');
    // Le texte du courriel est là, pas seulement son intitulé.
    expect(courriels[0].textContent).toContain('[client_first_name]');
    // Ce qui suit la jonction n'appartient à aucune branche.
    for (const li of etapes.filter((x) => /^\d+Attendre/.test(x.textContent ?? ''))) expect(li.textContent).not.toMatch(/si oui|si non/);
  });

  it('en anglais : « if yes » / « if no »', async () => {
    await monter(false);
    cliquer(carte('pack_relance_devis'));
    const etapes = etapesAffichees();
    expect(etapes.filter((li) => /if yes/.test(li.textContent ?? '')).length).toBe(5);
    expect(etapes.filter((li) => /if no/.test(li.textContent ?? '')).length).toBe(5);
  });
});
