// @vitest-environment jsdom
/**
 * LES ADRESSES D'APPEL (Réglages globaux) — triage « modèles » du 2026-10-01,
 * fichier `06-reglages-globaux`. Le VRAI composant `AdressesDAppel` ; le
 * serveur est joué par un faux `automationWebhooksApi` qui tient l'état « en
 * base » et laisse un test RETENIR un appel pour le faire arriver en retard.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface Adresse { id: string; name: string; cle_masquee: string; enabled: boolean; created_at: string; api_key?: string | null }

const serveur = vi.hoisted(() => ({
  /** Ce que la base contient. */
  adresses: [] as Array<{ id: string; name: string; cle_masquee: string; enabled: boolean; created_at: string; api_key?: string | null }>,
  /** Les bascules reçues, dans l'ordre où le navigateur les a ENVOYÉES. */
  envoyees: [] as boolean[],
  /** Rang (0 = la première) d'une bascule à RETENIR ; `lacher()` la fait arriver. */
  retenir: -1,
  lacher: () => {},
  /** Refus du serveur pour la prochaine bascule / création / lecture. */
  refus: null as string | null,
  lectureEnPanne: false,
  lectures: 0,
}));
const toasts = vi.hoisted(() => ({ succes: [] as string[], erreurs: [] as string[] }));

vi.mock('../../../src/lib/automationWebhooksApi', () => ({
  listerAdressesDAppel: async () => {
    serveur.lectures += 1;
    if (serveur.lectureEnPanne) throw new Error('Impossible de lire vos adresses d’appel.');
    return serveur.adresses.map((a) => ({ ...a, api_key: null }));
  },
  basculerAdresseDAppel: async (id: string, enabled: boolean) => {
    const rang = serveur.envoyees.length;
    serveur.envoyees.push(enabled);
    if (rang === serveur.retenir) await new Promise<void>((ok) => { serveur.lacher = ok; });
    if (serveur.refus) { const raison = serveur.refus; serveur.refus = null; throw new Error(raison); }
    // L'écriture en base se fait à l'ARRIVÉE de l'appel : un appel retenu écrase celui qui l'a doublé.
    const a = serveur.adresses.find((x) => x.id === id);
    if (a) a.enabled = enabled;
    return { ...a };
  },
  creerAdresseDAppel: async (name: string) => {
    if (serveur.refus) { const raison = serveur.refus; serveur.refus = null; throw new Error(raison); }
    const a = { id: `a${serveur.adresses.length + 1}`, name, cle_masquee: '••••abcd', enabled: true, created_at: '2026-10-01', api_key: 'c'.repeat(64) };
    serveur.adresses.push(a);
    return { ...a };
  },
  supprimerAdresseDAppel: async () => {},
  regenererAdresseDAppel: async (id: string) => ({ ...serveur.adresses.find((x) => x.id === id), api_key: 'd'.repeat(64) }),
}));
vi.mock('../../../src/components/ui/ConfirmDialog', () => ({ confirmer: async () => true, default: () => null }));
vi.mock('sonner', () => ({
  toast: Object.assign(() => {}, {
    success: (m: string) => { toasts.succes.push(m); },
    error: (m: string) => { toasts.erreurs.push(m); },
  }),
}));

import { monter, demonter, bouton, boutonPresent, cliquer, attendre, jusqua, texteEcran } from './banc-composants';
import AdressesDAppel from '../../../src/components/automations/AdressesDAppel';

const adresse = (sup: Partial<Adresse> = {}): Adresse => ({ id: 'a1', name: 'Formulaire de mon site', cle_masquee: '••••1234', enabled: true, created_at: '2026-10-01', ...sup });

beforeEach(() => {
  serveur.adresses = [adresse()];
  serveur.envoyees = []; serveur.retenir = -1; serveur.lacher = () => {}; serveur.refus = null; serveur.lectureEnPanne = false; serveur.lectures = 0;
  toasts.succes.length = 0; toasts.erreurs.length = 0;
});
afterEach(async () => { await demonter(); });

const etatAffiche = () => (boutonPresent('Active') ? true : boutonPresent('En pause') ? false : null);

describe('06-reglages-globaux:299 — « Active / En pause » : ce que l’écran affiche à la fin est ce que la base contient', () => {
  it('deux clics rapprochés, le premier appel arrive APRÈS le second : l’écran finit sur « En pause », comme la base — et le dit', async () => {
    await monter(<AdressesDAppel fr />);
    serveur.retenir = 0; // la mise en pause traîne
    await cliquer(bouton('Active'));
    expect(etatAffiche()).toBe(false);
    await cliquer(bouton('En pause')); // la reprise passe devant
    await jusqua(() => serveur.envoyees.length === 2);
    expect(serveur.adresses[0].enabled).toBe(true);
    // Pendant que la première traîne, l'écran montre le dernier clic.
    expect(etatAffiche()).toBe(true);
    serveur.lacher(); // la mise en pause, en retard, arrive et écrase la reprise
    await jusqua(() => serveur.adresses[0].enabled === false);
    await jusqua(() => etatAffiche() === serveur.adresses[0].enabled);
    expect(etatAffiche()).toBe(false);
    expect(toasts.erreurs).toEqual(['Vos clics se sont croisés : l’adresse est en pause. Cliquez de nouveau pour la remettre en service.']);
  });

  it('deux clics rapprochés qui arrivent dans l’ordre : rien à dire, l’écran et la base disent « Active »', async () => {
    await monter(<AdressesDAppel fr />);
    await cliquer(bouton('Active'));
    await cliquer(bouton('En pause'));
    await jusqua(() => serveur.envoyees.length === 2 && etatAffiche() === true);
    await attendre(20);
    expect(serveur.adresses[0].enabled).toBe(true);
    expect(etatAffiche()).toBe(true);
    expect(toasts.erreurs).toEqual([]);
  });

  it('un seul clic : la base suit, sans relecture inutile', async () => {
    await monter(<AdressesDAppel fr />);
    const lecturesAuDepart = serveur.lectures;
    await cliquer(bouton('Active'));
    await jusqua(() => serveur.adresses[0].enabled === false);
    expect(etatAffiche()).toBe(false);
    expect(serveur.lectures).toBe(lecturesAuDepart);
  });

  it('panne à la bascule : l’état affiché revient en arrière et l’échec est dit', async () => {
    await monter(<AdressesDAppel fr />);
    serveur.refus = 'Impossible de modifier l’adresse d’appel.';
    await cliquer(bouton('Active'));
    await jusqua(() => toasts.erreurs.length === 1);
    expect(toasts.erreurs).toEqual(['Changement non enregistré.']);
    expect(etatAffiche()).toBe(true);
    expect(serveur.adresses[0].enabled).toBe(true);
  });

  it('06:329 — le bouton d’état dit son rôle : `aria-pressed` et ce qu’un clic fera', async () => {
    await monter(<AdressesDAppel fr />);
    const active = bouton('Active');
    expect(active.getAttribute('aria-pressed')).toBe('true');
    expect(active.getAttribute('title')).toBe('Cliquer pour mettre en pause');
    await cliquer(active);
    await jusqua(() => boutonPresent('En pause'));
    expect(bouton('En pause').getAttribute('aria-pressed')).toBe('false');
    expect(bouton('En pause').getAttribute('title')).toBe('Cliquer pour remettre en service');
  });

  it('interface anglaise : le croisement est dit en anglais', async () => {
    await monter(<AdressesDAppel fr={false} />);
    serveur.retenir = 0;
    await cliquer(bouton('Active'));
    await cliquer(bouton('Paused'));
    await jusqua(() => serveur.envoyees.length === 2);
    serveur.lacher();
    await jusqua(() => toasts.erreurs.length === 1);
    expect(toasts.erreurs).toEqual(['Your clicks crossed: the address is paused. Click again to turn it back on.']);
    expect(texteEcran()).toContain('Paused');
  });
});

describe('06-reglages-globaux:467 — adresses illisibles : la carte ne dit pas « Aucune adresse pour l’instant »', () => {
  it('lecture en panne : c’est dit dans la carte, avec « Réessayer » — qui relit et montre les adresses', async () => {
    serveur.lectureEnPanne = true;
    await monter(<AdressesDAppel fr />);
    await jusqua(() => toasts.erreurs.length === 1);
    expect(toasts.erreurs).toEqual(['Impossible de lire vos adresses d’appel.']);
    expect(texteEcran()).not.toContain('Aucune adresse pour l’instant');
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Vos adresses d’appel n’ont pas pu être lues pour le moment');
    // « Créer une adresse » reste offert.
    expect(boutonPresent('Créer une adresse')).toBe(true);
    serveur.lectureEnPanne = false;
    await cliquer(bouton('Réessayer'));
    await jusqua(() => texteEcran().includes('Formulaire de mon site'));
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
  });

  it('aucune adresse, lecture réussie : « Aucune adresse pour l’instant », comme avant', async () => {
    serveur.adresses = [];
    await monter(<AdressesDAppel fr />);
    await jusqua(() => texteEcran().includes('Aucune adresse pour l’instant'));
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('06-reglages-globaux:183 — « Créer une adresse » refusée : la raison du serveur est affichée', () => {
  it('« Votre rôle ne permet pas… », pas seulement « Impossible de créer l’adresse. »', async () => {
    serveur.adresses = [];
    await monter(<AdressesDAppel fr />);
    serveur.refus = 'Votre rôle ne permet pas de créer une adresse d’appel.';
    await cliquer(bouton('Créer une adresse'));
    await jusqua(() => toasts.erreurs.length === 1);
    expect(toasts.erreurs).toEqual(['Votre rôle ne permet pas de créer une adresse d’appel.']);
    expect(serveur.adresses).toHaveLength(0);
  });
});

describe('06-reglages-globaux:198 — trois adresses créées se distinguent par leur nom', () => {
  it('« Formulaire de mon site », puis « (2) », puis « (3) »', async () => {
    serveur.adresses = [];
    await monter(<AdressesDAppel fr />);
    for (let i = 1; i <= 3; i += 1) {
      await cliquer(bouton('Créer une adresse'));
      await jusqua(() => serveur.adresses.length === i);
      await jusqua(() => !bouton('Créer une adresse').disabled);
    }
    expect(serveur.adresses.map((a) => a.name)).toEqual(['Formulaire de mon site', 'Formulaire de mon site (2)', 'Formulaire de mon site (3)']);
  });

  it('une adresse supprimée libère son numéro seulement s’il n’est plus à l’écran', async () => {
    serveur.adresses = [adresse({ id: 'a1', name: 'Formulaire de mon site' }), adresse({ id: 'a3', name: 'Formulaire de mon site (3)' })];
    await monter(<AdressesDAppel fr />);
    await jusqua(() => texteEcran().includes('Formulaire de mon site (3)'));
    await cliquer(bouton('Créer une adresse'));
    await jusqua(() => serveur.adresses.length === 3);
    expect(serveur.adresses[2].name).toBe('Formulaire de mon site (2)');
  });
});

describe('06-reglages-globaux:544 — en anglais, un seul mot : « address »', () => {
  it('ni le message de création, ni la confirmation de suppression, ni les pannes ne disent « endpoint »', async () => {
    serveur.adresses = [];
    await monter(<AdressesDAppel fr={false} />);
    await cliquer(bouton('Create an address'));
    await jusqua(() => toasts.succes.length === 1);
    expect(toasts.succes).toEqual(['Address created.']);
    const source = (await import('node:fs')).readFileSync('src/components/automations/AdressesDAppel.tsx', 'utf8');
    // Aucun texte montré à l'utilisateur ne porte « endpoint » (les commentaires du code, eux, peuvent).
    const textes = [...source.matchAll(/'([^'\n]*)'/g)].map((m) => m[1]).filter((t) => /endpoint/i.test(t));
    expect(textes).toEqual([]);
  });
});
