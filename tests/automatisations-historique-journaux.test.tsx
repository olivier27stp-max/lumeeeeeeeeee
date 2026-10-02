// @vitest-environment jsdom
//
// L'HISTORIQUE ET LES JOURNAUX des automatisations (mission du 2026-10-01, point 5).
//
// Deux rôles distincts : l'Historique dit au propriétaire ce qu'un client a reçu (résultat en
// clair, lien vers sa fiche, ce qui est à venir) ; les Journaux donnent le détail technique.
// Ce test rend les VRAIS composants avec ce que le serveur rendrait, et vérifie ce qui est à
// l'écran : liens, raisons dans la langue de l'interface, total rendu par le serveur, pagination,
// filtres passés au serveur, heures dans le fuseau de l'entreprise, panne dite comme une panne.
// (Les mêmes écrans sont prouvés au vrai navigateur contre un jeu d'exécutions connu :
// tests/automations-finale/d/ui/*.preuve.ts.)

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const api = {
  journaux: vi.fn(async (_f: any): Promise<any> => ({})),
  historique: vi.fn(async (_f: any): Promise<any> => ({})),
  modifications: vi.fn(async (_id: string, _page: number): Promise<any> => ({})),
};

vi.mock('../src/lib/automationJournauxApi', async (orig) => ({
  ...(await orig<typeof import('../src/lib/automationJournauxApi')>()),
  lireJournaux: (f: unknown) => api.journaux(f),
  lireHistorique: (f: unknown) => api.historique(f),
  lireModifications: (id: string, page: number) => api.modifications(id, page),
}));
vi.mock('../src/lib/automationStatsApi', () => ({
  lirePeriodeChoisie: () => 30,
  retenirPeriode: vi.fn(),
  lireRoute: vi.fn(),
}));

import { OngletJournaux, OngletHistorique } from '../src/components/automations/OngletJournaux';

const REGLE = 'aaaaaaaa-0000-4000-8000-000000000001';
const PERIODE = { jours: 30, fuseau: 'Asia/Tokyo', depuis: '2026-09-01T15:00:00.000Z', premier_jour: '2026-09-02', dernier_jour: '2026-10-01' };

const ligne = (p: Record<string, unknown> = {}) => ({
  source: 'journal', id: 'l1', issue: 'fait', categorie: 'envoyee', quand: '2026-10-01T03:30:00Z',
  rule_id: REGLE, rule_nom: 'Relance de facture', entity_type: 'invoice', entity_id: 'i1',
  client_id: 'c1', client_nom: 'Marie Tremblay', task_id: null, step_id: null, etape_position: null, etape_nom: null,
  action_type: 'send_sms', trigger_event: 'invoice.overdue', result_error: null,
  result_data: { to: '+15145550101', body: 'Bonjour Marie, votre facture est en retard.' }, action_config: { body: 'Bonjour [client_first_name]…' },
  duration_ms: 84, execution_key: `${REGLE}:i1:0@123`, tache: null,
  fiche: { type: 'invoice', id: 'i1', numero: '1042', titre: null, lien: '/invoices/i1' },
  ...p,
});

const passage = (p: Record<string, unknown> = {}) => ({
  cle: 'p:1', rule_id: REGLE, rule_nom: 'Relance de facture', entity_type: 'client', entity_id: 'c1', client_id: 'c1', client_nom: 'Marie Tremblay',
  debut: '2026-10-01T03:30:00Z', fin: '2026-10-01T03:30:05Z', en_file: false, declenche: true, resultat: 'envoyee', fiche: null,
  evenements: [{ source: 'journal', id: 'l1', issue: 'fait', categorie: 'envoyee', quand: '2026-10-01T03:30:05Z', action_type: 'send_sms', step_id: null, etape_position: null, etape_nom: null, en_file: false, trigger_event: 'lead.created', detail: null, execute_at: null, attempts: null }],
  ...p,
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.journaux.mockImplementation(async () => ({ periode: PERIODE, total: 1, page: 1, par_page: 50, actions: ['send_sms'], lignes: [ligne()] }));
  api.historique.mockImplementation(async () => ({ periode: PERIODE, total: 1, page: 1, par_page: 50, passages: [passage()] }));
  api.modifications.mockImplementation(async () => ({ total: 0, page: 1, par_page: 25, lignes: [] }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function rendre(noeud: React.ReactNode) {
  await act(async () => { root.render(<MemoryRouter>{noeud}</MemoryRouter>); });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}
const texte = () => (container.textContent ?? '').replace(/\s+/g, ' ');
const lignesTableau = () => Array.from(container.querySelectorAll('tbody tr[role="button"]'));
const bouton = (nom: string) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === nom);
async function cliquer(el: Element | null | undefined) {
  await act(async () => { el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}
async function choisir(id: string, valeur: string) {
  const select = Array.from(container.querySelectorAll('select')).find((s) => container.querySelector(`label[for="${s.id}"]`)?.textContent === id) as HTMLSelectElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  await act(async () => { setter?.call(select, valeur); select.dispatchEvent(new Event('change', { bubbles: true })); });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

describe('Journaux — le détail technique', () => {
  it('le client mène à sa fiche, la facture à la sienne ; l’heure est celle de l’ENTREPRISE', async () => {
    await rendre(<OngletJournaux ruleId={REGLE} fr />);
    const liens = Array.from(container.querySelectorAll('tbody a')).map((a) => [a.textContent, a.getAttribute('href')]);
    expect(liens).toEqual([['Marie Tremblay', '/clients/c1'], ['Facture 1042', '/invoices/i1']]);
    // 03:30 UTC = 12 h 30 à Tokyo (le fuseau rendu par le serveur), 23 h 30 la veille à Montréal.
    expect(texte()).toMatch(/1 oct\. 2026,? 12 h 30/);
    expect(texte()).not.toMatch(/30 sept\./);
  });

  it('la ligne dépliée montre ce qui est parti ET le détail technique : événement, décision, durée, clé', async () => {
    await rendre(<OngletJournaux ruleId={REGLE} fr />);
    await cliquer(lignesTableau()[0]);
    const t = texte();
    expect(t).toContain('Bonjour Marie, votre facture est en retard.');
    expect(t).toMatch(/Événement déclencheur.*\(invoice\.overdue\)/);
    expect(t).toContain('Envoyé (fait)');
    expect(t).toContain('84 ms');
    expect(t).toContain(`${REGLE}:i1:0@123`);
  });

  it('un échec : la cause en clair sur la ligne, le message PRÉVU et le texte exact du moteur dans le détail (D-11)', async () => {
    api.journaux.mockImplementation(async () => ({
      periode: PERIODE, total: 1, page: 1, par_page: 50, actions: ['send_sms'],
      lignes: [ligne({ issue: 'echec', categorie: 'echouee', result_data: null, result_error: 'No recipient phone', action_config: { body: 'Bonjour, votre facture est en retard.' } })],
    }));
    await rendre(<OngletJournaux ruleId={REGLE} fr />);
    expect(texte()).toContain('Échec : ce client n’a pas de numéro de téléphone');
    await cliquer(lignesTableau()[0]);
    expect(texte()).toContain('Rien n’est parti — le message prévu');
    expect(texte()).toContain('Bonjour, votre facture est en retard.');
    expect(texte()).toContain('Texte exact du moteur');
    expect(texte()).toContain('No recipient phone');
    expect(texte()).not.toContain('antérieure au journal détaillé');
  });

  it('en anglais, la raison d’un envoi ignoré est en anglais — jamais la phrase française du moteur (D-12)', async () => {
    api.journaux.mockImplementation(async () => ({
      periode: PERIODE, total: 2, page: 1, par_page: 50, actions: ['send_sms'],
      lignes: [
        ligne({ id: 'l1', issue: 'sans_telephone', categorie: 'ignoree', result_data: { saute: 'Aucun numéro de téléphone pour ce client', saute_code: 'sans_telephone' } }),
        ligne({ id: 'l2', issue: 'annulee', categorie: 'annulee', source: 'tache', result_data: null, tache: { status: 'cancelled', execute_at: '2026-10-02T00:00:00Z', attempts: 0, last_error: 'Annulée : le client a répondu.', completed_at: '2026-10-01T03:30:00Z' } }),
      ],
    }));
    await rendre(<OngletJournaux ruleId={REGLE} fr={false} />);
    const t = lignesTableau().map((l) => l.textContent ?? '').join(' | ');
    expect(t).toContain('Skipped: no phone number for this client');
    expect(t).toContain('Cancelled: the client replied');
    expect(t).not.toMatch(/Aucun|Annulée|répondu/);
  });

  it('les statuts séparent « Réussis » et « Ignorés » (D-10), et le filtre part au SERVEUR', async () => {
    await rendre(<OngletJournaux ruleId={REGLE} fr />);
    const statut = Array.from(container.querySelectorAll('select')).find((s) => container.querySelector(`label[for="${s.id}"]`)?.textContent === 'Statut') as HTMLSelectElement;
    expect(Array.from(statut.options).map((o) => o.textContent)).toEqual(['Tous les statuts', 'Réussis', 'Ignorés', 'Reportés', 'Échoués', 'En cours', 'Tentatives reprises']);
    await choisir('Statut', 'ignores');
    expect(api.journaux.mock.calls.at(-1)?.[0]).toMatchObject({ ruleId: REGLE, statut: 'ignores', jours: 30, page: 1, parPage: 50 });
    await choisir('Période', '90');
    expect(api.journaux.mock.calls.at(-1)?.[0]).toMatchObject({ jours: 90, statut: 'ignores' });
  });

  it('au-delà d’une page : « 1 à 50 sur 230 », et « Suivant » demande la page 2 au serveur (D-15)', async () => {
    api.journaux.mockImplementation(async (f: any) => ({
      periode: PERIODE, total: 230, page: f.page, par_page: 50, actions: ['send_sms'],
      lignes: Array.from({ length: 50 }, (_, i) => ligne({ id: `l${f.page}-${i}` })),
    }));
    await rendre(<OngletJournaux ruleId={REGLE} fr />);
    expect(texte()).toContain('1 à 50 sur 230 ligne(s)');
    expect(texte()).toContain('Page 1 sur 5');
    await cliquer(bouton('Suivant'));
    expect(api.journaux.mock.calls.at(-1)?.[0]).toMatchObject({ page: 2 });
    expect(texte()).toContain('51 à 100 sur 230 ligne(s)');
    expect(bouton('Précédent')?.hasAttribute('disabled')).toBe(false);
  });

  it('une lecture en panne s’affiche comme une panne, avec « Réessayer » — jamais « Aucun journal » (D-17)', async () => {
    api.journaux.mockImplementationOnce(async () => { throw new Error('500'); });
    await rendre(<OngletJournaux ruleId={REGLE} fr />);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Les journaux n’ont pas pu être lus.');
    expect(texte()).not.toContain('Aucun journal');
    await cliquer(bouton('Réessayer'));
    expect(lignesTableau()).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('aucune ligne : « Aucun journal pour ces filtres », et la durée de conservation est dite (90 jours)', async () => {
    api.journaux.mockImplementation(async () => ({ periode: PERIODE, total: 0, page: 1, par_page: 50, actions: [], lignes: [] }));
    await rendre(<OngletJournaux ruleId={REGLE} fr />);
    expect(texte()).toContain('Aucun journal pour ces filtres.');
    expect(texte()).toContain('Les journaux sont gardés 90 jours.');
  });

  it('à l’échelle du bureau : une colonne et un filtre « Automatisation » (D-13)', async () => {
    await rendre(<OngletJournaux fr regles={[{ id: REGLE, nom: 'Relance de facture' }, { id: 'autre', nom: 'Demande d’avis' }]} regleInitiale={REGLE} />);
    expect(Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual(['Client', 'Automatisation', 'Action', 'Statut', 'Exécuté le']);
    expect(container.querySelector(`tbody a[href="/automations/${REGLE}"]`)?.textContent).toBe('Relance de facture');
    // Ouverte depuis la liste (`?regle=`), la vue est déjà filtrée sur l'automatisation.
    expect(api.journaux.mock.calls[0][0]).toMatchObject({ ruleId: REGLE });
    await choisir('Automatisation', '');
    expect(api.journaux.mock.calls.at(-1)?.[0].ruleId).toBeNull();
  });
});

describe('Historique — une ligne par passage d’un client', () => {
  it('le résultat est dit en clair : envoyé, ignoré et pourquoi, à venir avec sa date', async () => {
    api.historique.mockImplementation(async () => ({
      periode: PERIODE, total: 3, page: 1, par_page: 50,
      passages: [
        passage(),
        passage({ cle: 'p:2', client_id: 'c2', client_nom: 'Luc Roy', resultat: 'ignoree', evenements: [{ ...passage().evenements[0], id: 'l2', issue: 'desabonne', categorie: 'ignoree', detail: 'Client désabonné (texto)' }] }),
        passage({
          cle: 'p:3', client_id: 'c3', client_nom: 'Anne Côté', resultat: 'en_cours', en_file: true,
          evenements: [
            { ...passage().evenements[0], id: 'l3', action_type: 'send_email', step_id: 'e1', etape_position: 1, etape_nom: 'Premier courriel' },
            { ...passage().evenements[0], id: 't3', source: 'tache', issue: 'en_attente', categorie: 'en_cours', step_id: 'e3', etape_position: 3, etape_nom: null, en_file: true, execute_at: '2026-10-04T03:30:00Z' },
          ],
        }),
      ],
    }));
    await rendre(<OngletHistorique ruleId={REGLE} fr />);
    const l = lignesTableau().map((x) => (x.textContent ?? '').replace(/\s+/g, ' '));
    expect(l[0]).toContain('Texto envoyé');
    expect(l[1]).toContain('Ignoré : client désabonné (texto)');
    // Le nom de l'étape en clair — jamais « (e3) » — et la date prévue, dans le fuseau de l'entreprise.
    expect(l[2]).toMatch(/À venir : Étape 3 · Texto, prévu le 4 oct\. 2026,? 12 h 30/);
    expect(l.join(' ')).not.toContain('(e3)');
    expect(container.querySelector('tbody a[href="/clients/c2"]')?.textContent).toBe('Luc Roy');

    await cliquer(lignesTableau()[2]);
    expect(texte()).toContain('Étape 1 · Premier courriel');
    expect(texte()).toContain('Courriel envoyé');
  });

  it('un report dit pourquoi le message attend (D-05) ; un échec passager dit qu’une nouvelle tentative est prévue', async () => {
    const attente = { ...passage().evenements[0], id: 't1', source: 'tache', en_file: true, execute_at: '2026-10-02T00:00:00Z' };
    api.historique.mockImplementation(async () => ({
      periode: PERIODE, total: 2, page: 1, par_page: 50,
      passages: [
        passage({ resultat: 'en_cours', en_file: true, evenements: [{ ...attente, issue: 'hors_heures', categorie: 'reportee' }] }),
        passage({ cle: 'p:2', resultat: 'en_cours', en_file: true, evenements: [
          { ...passage().evenements[0], issue: 'en_reprise', categorie: 'en_cours', detail: 'Twilio 20429' },
          { ...attente, id: 't2', issue: 'en_attente', categorie: 'en_cours' },
        ] }),
      ],
    }));
    await rendre(<OngletHistorique ruleId={REGLE} fr />);
    const l = lignesTableau().map((x) => (x.textContent ?? '').replace(/\s+/g, ' '));
    expect(l[0]).toMatch(/Reporté au prochain créneau d’envoi — prévu le/);
    expect(l[1]).toMatch(/Échec passager : nouvelle tentative prévue — prévu le/);
  });

  it('dans l’éditeur, « Modifications » dit qui a changé quoi et quand — un membre, ou Lumi à sa demande (D-20)', async () => {
    api.modifications.mockImplementation(async () => ({
      total: 2, page: 1, par_page: 25,
      lignes: [
        { id: 'm2', rule_id: REGLE, auteur_id: 'u1', auteur_nom: 'Marie Tremblay', origine: 'lumi', action: 'modification', champs: ['actions'],
          resume_fr: 'a changé le texte du texto de l’action', resume_en: 'changed the text message of the action',
          avant: { actions: [{ type: 'send_sms', config: { body: 'Ancien texte' } }] }, apres: { actions: [{ type: 'send_sms', config: { body: 'Nouveau texte' } }] }, created_at: '2026-10-01T15:00:00Z' },
        { id: 'm1', rule_id: REGLE, auteur_id: 'u1', auteur_nom: 'Marie Tremblay', origine: 'utilisateur', action: 'publication', champs: ['is_active'],
          resume_fr: 'a publié', resume_en: 'published', avant: { is_active: false }, apres: { is_active: true }, created_at: '2026-09-30T15:00:00Z' },
      ],
    }));
    await rendre(<OngletHistorique ruleId={REGLE} fr />);
    await cliquer(Array.from(container.querySelectorAll('[role="tab"]')).find((t) => t.textContent === 'Modifications'));
    expect(api.modifications).toHaveBeenCalledWith(REGLE, 1);
    const items = Array.from(container.querySelectorAll('li')).map((li) => (li.textContent ?? '').replace(/\s+/g, ' '));
    expect(items[0]).toContain('A changé le texte du texto de l’action');
    expect(items[0]).toContain('Modifié par Lumi, à la demande de Marie Tremblay');
    expect(items[1]).toContain('A publié');
    expect(items[1]).toContain('Modifié par Marie Tremblay');
    await cliquer(bouton('Voir l’avant et l’après'));
    expect(texte()).toContain('1. Texto : « Ancien texte »');
    expect(texte()).toContain('1. Texto : « Nouveau texte »');
  });

  it('à l’échelle du bureau, pas de vue « Modifications » (elle est propre à une automatisation)', async () => {
    await rendre(<OngletHistorique fr regles={[{ id: REGLE, nom: 'Relance de facture' }]} />);
    expect(Array.from(container.querySelectorAll('[role="tab"]'))).toHaveLength(0);
    expect(Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual(['Client', 'Automatisation', 'Quand', 'Étape', 'Résultat']);
  });

  it('une lecture en panne s’affiche comme une panne', async () => {
    api.historique.mockImplementation(async () => { throw new Error('500'); });
    await rendre(<OngletHistorique ruleId={REGLE} fr />);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('L’historique n’a pas pu être lu.');
  });
});

describe('accessibilité des filtres', () => {
  it('chaque champ a son étiquette, chaque bouton un nom', async () => {
    await rendre(<OngletJournaux fr regles={[{ id: REGLE, nom: 'Relance de facture' }]} />);
    const champs = Array.from(container.querySelectorAll('input, select'));
    expect(champs.length).toBeGreaterThanOrEqual(7);
    const sans = champs.filter((c) => !c.getAttribute('aria-label') && !(c.id && container.querySelector(`label[for="${c.id}"]`)));
    expect(sans.map((c) => c.outerHTML.slice(0, 80))).toEqual([]);
    expect(Array.from(container.querySelectorAll('button')).filter((b) => !(b.textContent ?? '').trim() && !b.getAttribute('aria-label'))).toEqual([]);
  });
});
