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
