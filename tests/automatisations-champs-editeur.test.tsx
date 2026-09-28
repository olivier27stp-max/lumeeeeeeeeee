// @vitest-environment jsdom
//
// LES CHAMPS PERSONNALISÉS DANS L'ÉDITEUR D'AUTOMATISATIONS — sur les VRAIS
// panneaux (PanneauDeclencheur, PanneauEtape), pas sur l'ancien formulaire
// que plus rien n'affiche.
//
// Avant : « Champ modifié » ne laissait pas choisir quel champ, « Mettre à
// jour un champ » demandait un identifiant technique à taper, aucune
// condition ni variable de champ n'était offerte. Les sélecteurs existaient
// dans `AutomationBuilder.tsx`, jamais monté.
//
// On vérifie ce qui PART à l'enregistrement : c'est ce que le moteur relit.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../src/hooks/useModuleAccess', () => ({
  useModuleAccess: () => ({ isEnabled: false, loading: false }),
}));

import PanneauDeclencheur from '../src/components/automations/PanneauDeclencheur';
import PanneauEtape from '../src/components/automations/PanneauEtape';
import { trouverDeclencheur, actionCompatible, trouverAction } from '../src/lib/automationCatalogue';
import { objetDeLaRegle, valeurConditionDepuisSaisie, sansConditionsIncompletes } from '../src/components/champs/automatisations';
import type { ChampPerso } from '../src/lib/champs/types';
import type { Etape } from '../src/lib/sequenceTypes';

const ID_TYPE = '11111111-1111-4111-8111-111111111111';
const ID_URGENT = '22222222-2222-4222-8222-222222222222';
const ID_BUDGET = '33333333-3333-4333-8333-333333333333';
const ID_FERMETURE = '44444444-4444-4444-8444-444444444444';
const ID_FENETRES = '55555555-5555-4555-8555-555555555555';
const ID_CONTRAT = '66666666-6666-4666-8666-666666666666';
const OPT_COMMERCIAL = 'aaaaaaaa-0000-4000-8000-000000000001';
const OPT_RESIDENTIEL = 'aaaaaaaa-0000-4000-8000-000000000002';

function champ(over: Partial<ChampPerso>): ChampPerso {
  return {
    id: 'x', object_type: 'deal', folder_id: null, key: 'k', label: 'L', placeholder: null, help_text: null,
    field_type: 'single_line', config: {}, is_required: false, is_searchable: false, is_unique: false,
    position: 0, created_at: '', updated_at: '', archived_at: null, options: [], ...over,
  };
}

const CHAMPS: ChampPerso[] = [
  champ({
    id: ID_TYPE, key: 'type_service', label: 'Type de service', field_type: 'dropdown_single',
    options: [
      { id: OPT_COMMERCIAL, label: 'Commercial', color: null, position: 0, archived_at: null },
      { id: OPT_RESIDENTIEL, label: 'Résidentiel', color: null, position: 1, archived_at: null },
    ],
  }),
  champ({ id: ID_URGENT, key: 'urgent', label: 'Urgent', field_type: 'checkbox' }),
  champ({ id: ID_BUDGET, key: 'budget', label: 'Budget', field_type: 'monetary' }),
  champ({ id: ID_FERMETURE, key: 'fermeture', label: 'Fermeture prévue', field_type: 'date' }),
  champ({ id: ID_FENETRES, object_type: 'quote', key: 'fenetres', label: 'Nombre de fenêtres', field_type: 'number' }),
  champ({ id: ID_CONTRAT, object_type: 'client', key: 'fin_contrat', label: 'Fin de contrat', field_type: 'date' }),
];

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function rendre(el: React.ReactElement) {
  act(() => root.render(el));
}

/** Changer une valeur comme le ferait l'utilisateur (setter natif : React l'observe). */
function saisir(el: Element | null | undefined, v: string) {
  if (!el) throw new Error('champ introuvable');
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
    : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v); // `!` : la propriété existe sur ces prototypes.
  act(() => { el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}

function cliquer(el: Element | null | undefined) {
  if (!el) throw new Error('rien à cliquer');
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

/** Le contrôle dont le <label> contient `texte`. */
function parLibelle(texte: string): HTMLElement | null {
  const label = Array.from(container.querySelectorAll('label')).find((l) => l.textContent?.includes(texte));
  const id = label?.getAttribute('for');
  return id ? container.querySelector(`[id="${id}"]`) : null;
}

function bouton(texte: string) {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(texte));
}

// ─── 1. Déclencheur « Champ modifié » ────────────────────────────

describe('« Champ modifié » : quel champ, et quand il devient …', () => {
  const decl = trouverDeclencheur('custom_field.changed')!; // `!` : déclencheur du catalogue.

  function monter(conditions: Record<string, unknown> | null, onEnregistrer = vi.fn()) {
    rendre(
      <PanneauDeclencheur declencheur={decl} conditions={conditions} fr champsDate={[]} champsPerso={CHAMPS}
        onEnregistrer={onEnregistrer} onFermer={() => {}} onChanger={() => {}} />,
    );
    return onEnregistrer;
  }

  it('liste les champs de TOUS les objets, groupés par objet', () => {
    monter(null);
    const select = parLibelle('Quel champ') as HTMLSelectElement;
    const groupes = Array.from(select.querySelectorAll('optgroup')).map((g) => g.label);
    expect(groupes).toEqual(expect.arrayContaining(['Client', 'Pipeline', 'Devis']));
    expect(select.textContent).toContain('Type de service');
  });

  it('liste déroulante → option : enregistre field_id et new_value (id d’option)', () => {
    const onEnregistrer = monter(null);
    saisir(parLibelle('Quel champ'), ID_TYPE);
    saisir(parLibelle('Quand il devient'), OPT_COMMERCIAL);
    cliquer(bouton('Enregistrer'));
    expect(onEnregistrer).toHaveBeenCalledWith({ field_id: { eq: ID_TYPE }, new_value: { eq: OPT_COMMERCIAL } }, undefined);
  });

  it('case à cocher → booléen ; montant en dollars → cents', () => {
    const onEnregistrer = monter(null);
    saisir(parLibelle('Quel champ'), ID_URGENT);
    saisir(parLibelle('Quand il devient'), 'true');
    cliquer(bouton('Enregistrer'));
    expect(onEnregistrer.mock.calls[0][0]).toMatchObject({ new_value: { eq: true } });

    saisir(parLibelle('Quel champ'), ID_BUDGET);
    saisir(parLibelle('Quand il devient'), '12.50');
    cliquer(bouton('Enregistrer'));
    expect(onEnregistrer.mock.calls[1][0]).toMatchObject({ field_id: { eq: ID_BUDGET }, new_value: { eq: 1250 } });
  });

  it('relit une règle existante (montant en cents → dollars) et vide = n’importe quelle valeur', () => {
    const onEnregistrer = monter({ field_id: { eq: ID_BUDGET }, new_value: { eq: 1250 } });
    expect((parLibelle('Quand il devient') as HTMLInputElement).value).toBe('12.5');
    saisir(parLibelle('Quand il devient'), '');
    cliquer(bouton('Enregistrer'));
    expect(onEnregistrer).toHaveBeenCalledWith({ field_id: { eq: ID_BUDGET } }, undefined);
  });

  it('les FILTRES portent sur l’objet du champ surveillé', () => {
    const onEnregistrer = monter({ field_id: { eq: ID_TYPE } });
    expect(container.querySelector('section[aria-label="Filtres"]')).not.toBeNull();
    cliquer(bouton('Ajouter une condition'));
    // Premier champ du deal : « Type de service » (liste), opérateur « parmi ».
    const option = Array.from(container.querySelectorAll('button[aria-pressed]')).find((b) => b.textContent === 'Commercial');
    cliquer(option);
    cliquer(bouton('Enregistrer'));
    expect(onEnregistrer.mock.calls[0][0].champs_perso).toEqual([
      expect.objectContaining({ field_id: ID_TYPE, value: [OPT_COMMERCIAL] }),
    ]);
  });
});

// ─── 3. Filtres au niveau de la règle, sur tous les déclencheurs ─

describe('les filtres de champs sur un autre déclencheur', () => {
  it('« Devis envoyé » : filtre sur les champs du DEVIS, ligne incomplète retirée', () => {
    const onEnregistrer = vi.fn();
    rendre(
      <PanneauDeclencheur declencheur={trouverDeclencheur('quote.sent')!} conditions={null} fr champsDate={[]}
        champsPerso={CHAMPS} onEnregistrer={onEnregistrer} onFermer={() => {}} />,
    );
    cliquer(bouton('Ajouter une condition'));
    // Seul champ du devis : « Nombre de fenêtres ».
    const select = container.querySelector('section[aria-label="Filtres"] select') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Nombre de fenêtres']);
    cliquer(bouton('Enregistrer'));
    // La ligne n'a pas de valeur : elle bloquerait la règle pour toujours.
    expect(onEnregistrer.mock.calls[0][0]).toEqual({});

    saisir(container.querySelector('section[aria-label="Filtres"] [aria-label="Valeur"]'), '20');
    cliquer(bouton('Enregistrer'));
    expect(onEnregistrer.mock.calls[1][0].champs_perso).toEqual([
      expect.objectContaining({ field_id: ID_FENETRES, value: 20 }),
    ]);
  });
});

// ─── 2. Action « Mettre à jour un champ » ────────────────────────

describe('« Mettre à jour un champ » : une liste, plus un identifiant à taper', () => {
  const etape: Etape = { id: 'e1', type: 'action', action: { type: 'update_custom_field', config: {} } };

  function monter(objet: 'deal' | 'quote' | null, onEnregistrer = vi.fn()) {
    rendre(
      <PanneauEtape etape={etape} fr declencheur="deal.stage_entered" membres={[]} etiquettes={[]}
        champsPerso={CHAMPS} objetChamps={objet} onEnregistrer={onEnregistrer} onSupprimer={() => {}} onFermer={() => {}} />,
    );
    return onEnregistrer;
  }

  it('ne propose que les champs de la fiche de l’événement', () => {
    monter('deal');
    const select = parLibelle('Champ') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    const libelles = Array.from(select.options).map((o) => o.textContent);
    expect(libelles).toContain('Type de service');
    expect(libelles).not.toContain('Nombre de fenêtres');
    expect(libelles).not.toContain('Fin de contrat');
  });

  it('valeur adaptée au type, stockée { field_id, value } en texte', () => {
    const onEnregistrer = monter('deal');
    saisir(parLibelle('Champ'), ID_TYPE);
    saisir(parLibelle('Nouvelle valeur'), OPT_RESIDENTIEL);
    cliquer(bouton('Enregistrer'));
    expect(onEnregistrer.mock.calls[0][0].action).toEqual({
      type: 'update_custom_field', config: { field_id: ID_TYPE, value: OPT_RESIDENTIEL },
    });
  });

  it('un montant se saisit en dollars (executerMajChamp convertit en cents)', () => {
    const onEnregistrer = monter('deal');
    saisir(parLibelle('Champ'), ID_BUDGET);
    const valeur = parLibelle('Nouvelle valeur') as HTMLInputElement;
    expect(valeur.type).toBe('number');
    saisir(valeur, '99.95');
    cliquer(bouton('Enregistrer'));
    expect(onEnregistrer.mock.calls[0][0].action.config).toEqual({ field_id: ID_BUDGET, value: '99.95' });
  });

  it('un champ d’un autre objet est signalé et bloque l’enregistrement', () => {
    rendre(
      <PanneauEtape etape={{ ...etape, action: { type: 'update_custom_field', config: { field_id: ID_FENETRES } } }}
        fr declencheur="deal.stage_entered" membres={[]} etiquettes={[]} champsPerso={CHAMPS} objetChamps="deal"
        onEnregistrer={() => {}} onSupprimer={() => {}} onFermer={() => {}} />,
    );
    expect(container.textContent).toContain('n’est pas un champ de la fiche');
    expect((bouton('Enregistrer') as HTMLButtonElement).disabled).toBe(true);
  });
});

// ─── 3 bis. Conditions de champs dans une étape « si » ───────────

describe('étape « si » : conditions sur les champs, gardées quand on tape', () => {
  it('l’éditeur de champs est là, et la saisie du texte ne les efface pas', () => {
    const onEnregistrer = vi.fn();
    const si: Etape = {
      id: 's1', type: 'si',
      conditions: { champs_perso: [{ field_id: ID_FENETRES, op: 'gt', value: 20 }] },
    };
    rendre(
      <PanneauEtape etape={si} fr declencheur="quote.sent" membres={[]} etiquettes={[]} champsPerso={CHAMPS}
        objetChamps="quote" onEnregistrer={onEnregistrer} onSupprimer={() => {}} onFermer={() => {}} />,
    );
    const texte = container.querySelector('textarea') as HTMLTextAreaElement;
    // Le texte ne porte pas « champs_perso = [object Object] ».
    expect(texte.value).toBe('');
    expect(container.textContent).toContain('… et si les champs personnalisés sont');
    saisir(texte, 'status = sent');
    cliquer(bouton('Enregistrer'));
    expect(onEnregistrer.mock.calls[0][0].conditions).toEqual({
      status: 'sent',
      champs_perso: [{ field_id: ID_FENETRES, op: 'gt', value: 20 }],
    });
  });
});

// ─── 4. « Insérer un champ » dans les messages ───────────────────

describe('« Insérer un champ » dans un courriel ou un texto', () => {
  it('insère {{deal.cle}} dans le corps du message', () => {
    const onEnregistrer = vi.fn();
    rendre(
      <PanneauEtape etape={{ id: 'm1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour ' } } }}
        fr declencheur="quote.sent" membres={[]} etiquettes={[]} champsPerso={CHAMPS} objetChamps="quote"
        onEnregistrer={onEnregistrer} onSupprimer={() => {}} onFermer={() => {}} />,
    );
    expect(container.textContent).toContain('Insérer un champ');
    cliquer(bouton('Pipeline · Type de service'));
    cliquer(bouton('Enregistrer'));
    expect(onEnregistrer.mock.calls[0][0].action.config.body).toBe('Bonjour {{deal.type_service}}');
  });
});

// ─── 5. « Date atteinte » : l'objet suit le champ date choisi ─────

describe('l’objet de la règle suit le champ choisi', () => {
  it('« Date atteinte » sur un champ du deal → deal ; sur un champ client → client', () => {
    expect(objetDeLaRegle('date.reached', { champ_id: ID_FERMETURE }, CHAMPS)).toBe('deal');
    expect(objetDeLaRegle('date.reached', { champ_id: ID_CONTRAT }, CHAMPS)).toBe('client');
    expect(objetDeLaRegle('custom_field.changed', { field_id: { eq: ID_FENETRES } }, CHAMPS)).toBe('quote');
    expect(objetDeLaRegle('custom_field.changed', {}, CHAMPS)).toBeNull();
    expect(objetDeLaRegle('invoice.paid', null, CHAMPS)).toBe('invoice');
  });

  it('les actions du deal sont offertes quand la date surveillée est celle du deal', () => {
    const deplacer = trouverAction('move_deal_stage')!; // `!` : action du catalogue.
    expect(actionCompatible(deplacer, 'date.reached')).toBe(false);
    expect(actionCompatible(deplacer, 'date.reached', 'deal')).toBe(true);
  });

  it('conversions de la valeur de condition', () => {
    const [, urgent, budget] = CHAMPS;
    expect(valeurConditionDepuisSaisie(urgent, 'false')).toBe(false);
    expect(valeurConditionDepuisSaisie(budget, '1 250,5')).toBe(125050);
    expect(sansConditionsIncompletes({ a: 1, champs_perso: [{ field_id: ID_TYPE, op: 'is' }] })).toEqual({ a: 1 });
  });
});
