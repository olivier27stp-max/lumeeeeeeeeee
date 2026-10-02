// @vitest-environment jsdom
/**
 * Agent P — la section « Qui est ciblé » (src/components/automations/SectionCiblage.tsx).
 * Le VRAI composant, monté seul en jsdom, piloté comme un utilisateur.
 *
 *   npx vitest run --maxWorkers=2 tests/automations-finale/p/section-ciblage.test.tsx
 *
 * Composant contrôlé : un petit banc tient la valeur, comme le fera le panneau du
 * déclencheur. Le compteur est remplacé par une fonction du test (le vrai appel au
 * serveur est éprouvé par ciblage-route.test.ts).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React, { act, useState } from 'react';

vi.mock('../../../src/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import SectionCiblage, { DELAI_COMPTEUR_MS } from '../../../src/components/automations/SectionCiblage';
import type { Ciblage } from '../../../src/lib/automationCiblage';
import type { ApercuCiblageReponse, DemandeApercuCiblage } from '../../../src/lib/automationCiblageApi';
import type { ChampPerso, ObjetChamp, TypeChamp } from '../../../src/lib/champs/types';
import { monter, demonter, attendre, jusqua, cliquer, saisir, bouton, boutonPresent, choix } from '../t/banc-composants';

const champ = (objet: ObjetChamp, key: string, label: string, type: TypeChamp, id = `id-${objet}-${key}`): ChampPerso => ({
  id, object_type: objet, folder_id: null, key, label, placeholder: null, help_text: null, field_type: type, config: {},
  is_required: false, is_searchable: false, is_unique: false, position: 0, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  archived_at: null, options: [],
});
const CHAMPS = [champ('client', 'refere_par', 'Référé par', 'single_line'), champ('client', 'noreview', 'Aucune demande d’avis', 'checkbox'), champ('job', 'carburant', 'Carburant', 'monetary')];

const reponse = (p: Partial<ApercuCiblageReponse> = {}): ApercuCiblageReponse => ({
  total: 5000, dont: { stop_texto: 151, desabonnes_courriel: 0, sans_telephone: 0, sans_courriel: 0, sans_avis: 0 },
  apercu: [{ id: 'c1', nom: 'Alice Gagnon', empechements: [] }, { id: 'c2', nom: 'Benoît Roy', empechements: ['stop_texto'] }],
  tronque: false, plafond: 20000, carnet: 5000, ...p,
});

let demandes: DemandeApercuCiblage[] = [];
let changements: Ciblage[] = [];
let charger: (d: DemandeApercuCiblage) => Promise<ApercuCiblageReponse>;

function Banc(props: { initial?: Ciblage; fr?: boolean; demandeAvis?: boolean; canaux?: Array<'sms' | 'email'>; delaiMs?: number }) {
  const [valeur, setValeur] = useState<Ciblage>(props.initial ?? {});
  return (
    <SectionCiblage
      valeur={valeur} onChange={(c) => { changements.push(c); setValeur(c); }} fr={props.fr ?? true}
      etiquettes={['VIP', 'Commercial', 'Ne pas relancer']} champsPerso={CHAMPS} canaux={props.canaux ?? ['sms']} demandeAvis={props.demandeAvis}
      chargerApercu={(d) => { demandes.push(d); return charger(d); }} delaiMs={props.delaiMs ?? 5}
    />
  );
}

const ecran = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');
const statut = () => (document.querySelector('[role="status"]')?.textContent ?? '').replace(/\s+/g, ' ').trim();
const dernier = () => changements[changements.length - 1];
const selects = (nom: string) => Array.from(document.querySelectorAll('select')).filter((s) => document.querySelector(`label[for="${s.id}"]`)?.textContent === nom);
async function choisir(select: HTMLSelectElement, valeur: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, valeur);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
const champEtiquette = (rang = 0) => Array.from(document.querySelectorAll<HTMLInputElement>('input[aria-label="Étiquette"]'))[rang];

beforeEach(() => { demandes = []; changements = []; charger = async () => reponse(); });
afterEach(async () => { await demonter(); vi.useRealTimers(); });

describe('P — « Qui est ciblé » : par défaut, tous les clients', () => {
  it('« Tous les clients » est coché, aucune ligne n’est montrée, et le compteur dit combien de clients sont touchés', async () => {
    await monter(<Banc />);
    expect(choix('Tous les clients').checked).toBe(true);
    expect(choix('Seulement certains clients').checked).toBe(false);
    expect(boutonPresent('Ajouter une condition')).toBe(false);
    await jusqua(() => statut().startsWith('Touche'));
    expect(statut()).toBe('Touche 5 000 clients · 151 ne recevront pas de texto (STOP)');
    expect(demandes).toEqual([{ ciblage: {}, canaux: ['sms'], demande_avis: false }]);
  });

  it('les exclusions VERROUILLÉES sont affichées et n’ont aucun bouton pour les retirer', async () => {
    await monter(<Banc demandeAvis />);
    expect(ecran()).toContain('Toujours exclus : les clients désabonnés ou qui ont répondu STOP.');
    expect(ecran()).toContain('Toujours exclus de cette demande d’avis : les clients marqués « Aucune demande d’avis ».');
    expect(boutonPresent('Retirer la condition')).toBe(false);
    await jusqua(() => demandes.length === 1);
    expect(demandes[0].demande_avis).toBe(true);
  });

  it('sans demande d’avis, la ligne « Aucune demande d’avis » n’apparaît pas', async () => {
    await monter(<Banc />);
    expect(ecran()).not.toContain('demande d’avis');
  });

  it('la section dit que « X clients » n’est pas « X messages »', async () => {
    await monter(<Banc />);
    expect(ecran()).toContain('Le message part quand l’événement arrive pour l’un d’eux.');
  });
});

describe('P — « Qui est ciblé » : seulement certains clients', () => {
  it('inclure par étiquette : la ligne s’ajoute, se remplit, et le parent reçoit le ciblage', async () => {
    await monter(<Banc />);
    await cliquer(choix('Seulement certains clients'));
    expect(ecran()).toContain('Aucune condition : tous les clients sont inclus.');
    await cliquer(bouton('Ajouter une condition'));
    expect(dernier()).toEqual({ inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: '' }] } });
    await saisir(champEtiquette(), 'VIP');
    expect(dernier()).toEqual({ inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: 'VIP' }] } });
    // Les étiquettes du bureau sont proposées à la saisie.
    expect(Array.from(document.querySelectorAll('datalist option')).map((o) => o.getAttribute('value'))).toEqual(['VIP', 'Commercial', 'Ne pas relancer']);
  });

  it('« au moins une » / « toutes » : réglable dès deux conditions', async () => {
    await monter(<Banc initial={{ inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: 'VIP' }] } }} />);
    const mode = selects('Combien de conditions')[0];
    expect(mode.disabled).toBe(true);
    await cliquer(bouton('Ajouter une condition'));
    await saisir(champEtiquette(1), 'Commercial');
    expect(selects('Combien de conditions')[0].disabled).toBe(false);
    await choisir(selects('Combien de conditions')[0], 'toutes');
    expect(dernier()).toEqual({ inclure: { mode: 'toutes', regles: [{ type: 'etiquette', valeur: 'VIP' }, { type: 'etiquette', valeur: 'Commercial' }] } });
  });

  it('« Toujours exclure » : une exclusion seule donne « tous sauf » (aucune inclusion)', async () => {
    await monter(<Banc />);
    await cliquer(choix('Seulement certains clients'));
    await cliquer(bouton('Ajouter une exclusion'));
    await saisir(champEtiquette(), 'Ne pas relancer');
    expect(dernier()).toEqual({ exclure: [{ type: 'etiquette', valeur: 'Ne pas relancer' }] });
    await cliquer(bouton('Retirer la condition'));
    expect(dernier()).toEqual({});
  });

  it('« Type de client » : Entreprise ou Particulier, choisis dans une liste', async () => {
    await monter(<Banc initial={{ inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: 'VIP' }] } }} />);
    await choisir(selects('Sur quoi porte la condition')[0], 'fiche:genre');
    expect(dernier()).toEqual({ inclure: { mode: 'une', regles: [{ type: 'fiche', cle: 'genre', op: 'is', value: 'entreprise' }] } });
    expect(Array.from(selects('Valeur')[0].options).map((o) => o.textContent)).toEqual(['Entreprise', 'Particulier']);
    expect(Array.from(selects('Comparaison')[0].options).map((o) => o.textContent)).toEqual(['est', 'n’est pas']);
    await choisir(selects('Valeur')[0], 'particulier');
    expect(dernier().inclure?.regles[0]).toEqual({ type: 'fiche', cle: 'genre', op: 'is', value: 'particulier' });
  });

  it('un champ de la fiche à texte libre (ville) : comparaison au choix, « est vide » sans valeur', async () => {
    await monter(<Banc initial={{ exclure: [{ type: 'fiche', cle: 'city', op: 'is', value: '' }] }} />);
    expect(Array.from(selects('Comparaison')[0].options)).toHaveLength(6);
    await saisir(document.querySelector<HTMLInputElement>('input[aria-label="Valeur"]'), 'Laval');
    expect(dernier()).toEqual({ exclure: [{ type: 'fiche', cle: 'city', op: 'is', value: 'Laval' }] });
    await choisir(selects('Comparaison')[0], 'is_empty');
    expect(document.querySelector('input[aria-label="Valeur"]')).toBeNull();
  });

  it('un champ personnalisé : seuls ceux de la fiche CLIENT sont offerts, avec l’éditeur de valeur de leur type', async () => {
    await monter(<Banc initial={{ inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: 'VIP' }] } }} />);
    await choisir(selects('Sur quoi porte la condition')[0], 'champ');
    expect(dernier().inclure?.regles[0]).toMatchObject({ type: 'champ', field_id: 'id-client-refere_par' });
    const offerts = Array.from(selects('Champ')[0].options).map((o) => o.textContent);
    expect(offerts).toEqual(['Référé par', 'Aucune demande d’avis']);
    expect(offerts).not.toContain('Carburant');
    await choisir(selects('Champ')[0], 'id-client-noreview');
    expect(dernier().inclure?.regles[0]).toMatchObject({ type: 'champ', field_id: 'id-client-noreview', op: 'is', value: true });
  });

  it('au plus 10 conditions et 10 exclusions : les boutons d’ajout disparaissent', async () => {
    const dix = Array.from({ length: 10 }, (_, i) => ({ type: 'etiquette' as const, valeur: `E${i}` }));
    await monter(<Banc initial={{ inclure: { mode: 'une', regles: dix }, exclure: dix }} />);
    expect(boutonPresent('Ajouter une condition')).toBe(false);
    expect(boutonPresent('Ajouter une exclusion')).toBe(false);
  });

  it('revenir à « Tous les clients » vide le ciblage ; revenir à « certains » rend les lignes mises de côté', async () => {
    const initial: Ciblage = { inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: 'VIP' }] }, exclure: [{ type: 'etiquette', valeur: 'Ne pas relancer' }] };
    await monter(<Banc initial={initial} />);
    expect(choix('Seulement certains clients').checked).toBe(true);
    await cliquer(choix('Tous les clients'));
    expect(dernier()).toEqual({});
    expect(boutonPresent('Ajouter une condition')).toBe(false);
    await cliquer(choix('Seulement certains clients'));
    expect(dernier()).toEqual(initial);
  });

  it('une ligne incomplète est signalée à l’écran, pas envoyée au compteur', async () => {
    await monter(<Banc initial={{ inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: 'VIP' }, { type: 'fiche', cle: 'city', op: 'contains', value: '' }] } }} />);
    await jusqua(() => demandes.length >= 1);
    expect(demandes[demandes.length - 1].ciblage).toEqual({ inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: 'VIP' }] } });
    // Le ciblage nettoyé n'a aucune faute : rien n'est affiché en rouge pour une ligne simplement en cours de saisie.
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('P — « Qui est ciblé » : le compteur', () => {
  it(`il attend ${DELAI_COMPTEUR_MS} ms après la dernière modification : trois frappes rapides = UN appel`, async () => {
    expect(DELAI_COMPTEUR_MS).toBe(300);
    vi.useFakeTimers();
    await act(async () => { /* montage sous horloge simulée */ });
    const { createRoot } = await import('react-dom/client');
    const hote = document.createElement('div');
    document.body.appendChild(hote);
    const racine = createRoot(hote);
    await act(async () => { racine.render(<Banc initial={{ inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: 'V' }] } }} delaiMs={DELAI_COMPTEUR_MS} />); });
    await act(async () => { vi.advanceTimersByTime(299); });
    expect(demandes).toHaveLength(0);
    const frapper = async (texte: string) => {
      const el = hote.querySelector<HTMLInputElement>('input[aria-label="Étiquette"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, texte);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    await frapper('VI');
    await act(async () => { vi.advanceTimersByTime(200); });
    await frapper('VIP');
    await act(async () => { vi.advanceTimersByTime(299); });
    expect(demandes).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(demandes).toHaveLength(1);
    expect(demandes[0].ciblage).toEqual({ inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: 'VIP' }] } });
    await act(async () => { racine.unmount(); });
    hote.remove();
  });

  it('une réponse PÉRIMÉE (arrivée après une modification) ne remplace pas la bonne', async () => {
    const attendus: Array<(r: ApercuCiblageReponse) => void> = [];
    charger = () => new Promise((resoudre) => { attendus.push(resoudre); });
    await monter(<Banc initial={{ inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: 'VIP' }] } }} />);
    await jusqua(() => attendus.length === 1);
    await saisir(champEtiquette(), 'Commercial');
    await jusqua(() => attendus.length === 2);
    await act(async () => { attendus[1](reponse({ total: 800 })); });
    await act(async () => { attendus[0](reponse({ total: 1500 })); });
    await attendre(10);
    expect(statut()).toMatch(/^Touche 800 clients/);
  });

  it('les sous-comptes : STOP, sans téléphone, désabonnés, sans courriel, sans avis — seulement ceux qui ne sont pas nuls', async () => {
    charger = async () => reponse({ total: 2000, dont: { stop_texto: 60, desabonnes_courriel: 1, sans_telephone: 12, sans_courriel: 0, sans_avis: 5 } });
    await monter(<Banc canaux={['sms', 'email']} demandeAvis />);
    await jusqua(() => statut().startsWith('Touche'));
    expect(statut()).toBe('Touche 2 000 clients · 60 ne recevront pas de texto (STOP) · 12 sans numéro de téléphone · 1 désabonné des courriels · 5 marqués « Aucune demande d’avis »');
  });

  it('un seul client, aucun client, et un carnet au-delà du plafond', async () => {
    charger = async () => reponse({ total: 1, dont: { stop_texto: 1, desabonnes_courriel: 0, sans_telephone: 0, sans_courriel: 0, sans_avis: 0 } });
    await monter(<Banc />);
    await jusqua(() => statut().startsWith('Touche'));
    expect(statut()).toBe('Touche 1 client · 1 ne recevra pas de texto (STOP)');
    await demonter();
    charger = async () => reponse({ total: 0, apercu: [], dont: { stop_texto: 0, desabonnes_courriel: 0, sans_telephone: 0, sans_courriel: 0, sans_avis: 0 } });
    await monter(<Banc />);
    await jusqua(() => statut().startsWith('Touche'));
    expect(statut()).toBe('Touche 0 client');
    expect(boutonPresent('Voir la liste')).toBe(false);
    await demonter();
    charger = async () => reponse({ total: 18400, tronque: true, carnet: 20000 });
    await monter(<Banc />);
    await jusqua(() => statut().startsWith('Touche'));
    expect(statut()).toMatch(/^Touche au moins 18 400 clients/);
    expect(ecran()).toContain('Le carnet compte plus de 20 000 clients : le compteur s’arrête là.');
  });

  it('« Voir la liste » : les premiers clients touchés, et pourquoi certains ne recevront rien', async () => {
    await monter(<Banc />);
    await jusqua(() => boutonPresent('Voir la liste'));
    expect(bouton('Voir la liste').getAttribute('aria-expanded')).toBe('false');
    await cliquer(bouton('Voir la liste'));
    expect(ecran()).toContain('Alice Gagnon');
    expect(ecran()).toContain('Benoît Roy — a répondu STOP');
    expect(ecran()).toContain('Les 2 premiers, par ordre alphabétique.');
    expect(bouton('Masquer la liste').getAttribute('aria-expanded')).toBe('true');
    await cliquer(bouton('Masquer la liste'));
    expect(ecran()).not.toContain('Alice Gagnon');
  });

  it('compteur en panne : la section le dit, sans faux nombre, et la saisie continue de marcher', async () => {
    const trace = vi.spyOn(console, 'error').mockImplementation(() => {});
    charger = async () => { throw new Error('délai dépassé'); };
    await monter(<Banc />);
    await jusqua(() => statut() === 'Compteur indisponible pour l’instant.');
    expect(statut()).not.toMatch(/\d/);
    expect(trace).toHaveBeenCalled();
    await cliquer(choix('Seulement certains clients'));
    expect(boutonPresent('Ajouter une condition')).toBe(true);
    trace.mockRestore();
  });

  it('en anglais : libellés, compteur et liste', async () => {
    charger = async () => reponse({ total: 2000, dont: { stop_texto: 60, desabonnes_courriel: 0, sans_telephone: 0, sans_courriel: 0, sans_avis: 0 } });
    await monter(<Banc fr={false} initial={{ exclure: [{ type: 'fiche', cle: 'genre', op: 'is', value: 'entreprise' }] }} />);
    await jusqua(() => statut().startsWith('Reaches'));
    expect(statut()).toBe('Reaches 2,000 clients · 60 will not get a text (STOP)');
    expect(ecran()).toContain('Who is targeted');
    expect(ecran()).toContain('Always excluded: clients who unsubscribed or replied STOP.');
    expect(Array.from(document.querySelectorAll('select')).flatMap((s) => Array.from(s.options).map((o) => o.textContent))).toEqual(expect.arrayContaining(['Client type', 'Business', 'Individual', 'is not']));
    expect(ecran()).not.toMatch(/Tous les clients|Ajouter|exclure/);
  });
});
