// @vitest-environment jsdom
/**
 * LA BIBLIOTHÈQUE DE MODÈLES — triage « modèles » du 2026-10-01, fichiers
 * `01-bibliotheque` et `02-chaque-modele`. Le VRAI composant
 * `BibliothequeModeles` et le VRAI catalogue ; le serveur (lecture du
 * catalogue, création de la copie) est joué par un faux `automationBuilderApi`
 * qu'un test peut retenir ou faire échouer.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const api = vi.hoisted(() => ({
  lire: vi.fn(),
  utiliser: vi.fn(),
  langue: 'fr' as 'fr' | 'en' | 'panne',
}));
vi.mock('../../../src/i18n', () => ({ useTranslation: () => ({ t: { common: { close: 'Fermer' } }, language: 'fr' }) }));
vi.mock('../../../src/lib/automationBuilderApi', () => ({
  fetchModelesAutomatisation: api.lire,
  utiliserModele: api.utiliser,
}));
vi.mock('../../../src/lib/automationRulesApi', () => ({
  getAutomationLanguage: async () => { if (api.langue === 'panne') throw new Error('panne simulée'); return api.langue; },
}));

import { monter, demonter, bouton, boutonPresent, champ, cliquer, saisir, attendre, jusqua, texteEcran } from './banc-composants';
import BibliothequeModeles from '../../../src/components/automations/BibliothequeModeles';
import { MODELES_AUTOMATISATION } from '../../../server/lib/automationTemplates';
import { nomDisponible } from '../../../src/lib/automationTemplates';

const fermetures: number[] = [];
const erreurs: string[] = [];
const creees: unknown[] = [];

async function ouvrir(fr = true, open = true) {
  await monter(
    <BibliothequeModeles
      open={open} fr={fr}
      onClose={() => { fermetures.push(1); }}
      onCree={(r) => { creees.push(r); }}
      onErreur={(m) => { erreurs.push(m); }}
    />,
  );
}
const carte = (nom: string) => Array.from(document.body.querySelectorAll<HTMLButtonElement>('button[data-modele]'))
  .find((b) => (b.textContent ?? '').includes(nom));
const echap = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

beforeEach(() => {
  fermetures.length = 0; erreurs.length = 0; creees.length = 0;
  api.langue = 'fr';
  api.lire.mockReset().mockResolvedValue(MODELES_AUTOMATISATION);
  api.utiliser.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => { await demonter(); vi.restoreAllMocks(); });

describe('01-bibliotheque:489 — Échap pendant la création ne ferme pas la fenêtre', () => {
  it('tant que « Utiliser ce modèle » est en route, Échap, la croix et le fond ne ferment rien ; ensuite, si', async () => {
    let lacher: (r: unknown) => void = () => {};
    api.utiliser.mockImplementation(() => new Promise((ok) => { lacher = ok; }));
    await ouvrir();
    await jusqua(() => !!carte('Contrat signé'));
    await cliquer(carte('Contrat signé'));
    await cliquer(bouton('Utiliser ce modèle'));
    expect(bouton('Retour').disabled).toBe(true);
    echap();
    await cliquer(bouton('Fermer'));
    await attendre();
    expect(fermetures).toEqual([]);
    lacher({ id: 'copie-1', name: 'Contrat signé' });
    await jusqua(() => creees.length === 1);
    // La création finie, la fenêtre se ferme de nouveau normalement.
    echap();
    await attendre();
    expect(fermetures).toEqual([1]);
  });
});

describe('01-bibliotheque:525, :568 et :626 — la raison d’une panne est une phrase, dans la langue de l’interface', () => {
  it('coupure réseau au chargement : « Connexion perdue… », jamais « Failed to fetch »', async () => {
    api.lire.mockRejectedValue(new TypeError('Failed to fetch'));
    await ouvrir();
    await jusqua(() => texteEcran().includes('Impossible de charger les modèles.'));
    expect(texteEcran()).not.toContain('Failed to fetch');
    expect(texteEcran()).toContain('Connexion perdue — vérifiez votre réseau et réessayez.');
    expect(boutonPresent('Réessayer')).toBe(true);
  });

  it('interface anglaise, panne sans message du serveur : la raison est en anglais, pas « Impossible de charger les modèles. »', async () => {
    // Ce que `automationBuilderApi` lève quand le serveur répond une page d'erreur (502, corps non JSON).
    api.lire.mockRejectedValue(new Error('Impossible de charger les modèles.'));
    await ouvrir(false);
    await jusqua(() => texteEcran().includes('Could not load the templates.'));
    expect(texteEcran()).not.toContain('Impossible de charger les modèles.');
    expect(texteEcran()).toContain('The server did not respond as expected. Try again in a moment.');
  });

  it('une vraie raison du serveur est montrée telle quelle', async () => {
    api.lire.mockRejectedValue(new Error('Votre rôle ne permet pas de voir les modèles.'));
    await ouvrir();
    await jusqua(() => texteEcran().includes('Votre rôle ne permet pas de voir les modèles.'));
  });

  it('coupure réseau pendant « Utiliser ce modèle » : une phrase, la fenêtre reste ouverte, on peut réessayer', async () => {
    api.utiliser.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await ouvrir();
    await jusqua(() => !!carte('Contrat signé'));
    await cliquer(carte('Contrat signé'));
    await cliquer(bouton('Utiliser ce modèle'));
    await jusqua(() => erreurs.length === 1);
    expect(erreurs).toEqual(['Connexion perdue — vérifiez votre réseau et réessayez. Rien n’a été créé.']);
    expect(fermetures).toEqual([]);
    expect(bouton('Utiliser ce modèle').disabled).toBe(false);
  });

  it('interface anglaise, création refusée sans message : en anglais', async () => {
    api.utiliser.mockRejectedValueOnce(new Error('Impossible de créer l’automatisation.'));
    await ouvrir(false);
    await jusqua(() => !!carte('Contract signed'));
    await cliquer(carte('Contract signed'));
    await cliquer(bouton('Use this template'));
    await jusqua(() => erreurs.length === 1);
    expect(erreurs).toEqual(['Could not create the automation. Try again in a moment.']);
  });
});

describe('01-bibliotheque:328 — rouverte, la fenêtre repart de zéro : TOUT, pas la moitié', () => {
  it('recherche, catégories, tri et affichage sont remis à zéro ensemble', async () => {
    await ouvrir();
    await jusqua(() => !!carte('Contrat signé'));
    await saisir(champ<HTMLInputElement>('Rechercher un modèle'), 'devis');
    const tri = document.body.querySelector<HTMLSelectElement>('select[aria-label="Trier"]');
    if (!tri) throw new Error('tri introuvable');
    tri.value = 'nom';
    tri.dispatchEvent(new Event('change', { bubbles: true }));
    await cliquer(bouton('Liste'));
    expect(bouton('Liste').getAttribute('aria-pressed')).toBe('true');
    // Fermer, rouvrir.
    await ouvrir(true, false);
    await ouvrir(true, true);
    await jusqua(() => !!carte('Contrat signé'));
    expect(champ<HTMLInputElement>('Rechercher un modèle').value).toBe('');
    expect(document.body.querySelector<HTMLSelectElement>('select[aria-label="Trier"]')?.value).toBe('recent');
    expect(bouton('Grille').getAttribute('aria-pressed')).toBe('true');
    expect(bouton('Liste').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('02-chaque-modele:263 — l’aperçu dit dans quelle langue les textes partiront', () => {
  const NOTE_EN = 'The texts below are shown in English. Your clients will receive the French version: the office message language is French.';
  const NOTE_FR = 'Les textes ci-dessous sont montrés en français. Vos clients recevront la version anglaise : la langue des messages du bureau est l’anglais.';

  it('interface anglaise, bureau qui écrit en français : l’aperçu (en anglais) dit que les clients recevront le français', async () => {
    api.langue = 'fr';
    await ouvrir(false);
    await jusqua(() => !!carte('Thank you after the job'));
    await cliquer(carte('Thank you after the job'));
    await jusqua(() => texteEcran().includes(NOTE_EN));
  });

  it('interface française, bureau qui écrit en anglais : la note inverse', async () => {
    api.langue = 'en';
    await ouvrir();
    await jusqua(() => !!carte('Contrat signé'));
    await cliquer(carte('Contrat signé'));
    await jusqua(() => texteEcran().includes(NOTE_FR));
  });

  it('même langue des deux côtés, ou langue du bureau illisible : aucune note (on n’affirme rien)', async () => {
    await ouvrir();
    await jusqua(() => !!carte('Contrat signé'));
    await cliquer(carte('Contrat signé'));
    await attendre(20);
    expect(texteEcran()).not.toContain('Vos clients recevront');
    await demonter();
    api.langue = 'panne';
    await ouvrir(false);
    await jusqua(() => !!carte('Contract signed'));
    await cliquer(carte('Contract signed'));
    await attendre(20);
    expect(texteEcran()).not.toContain('Your clients will receive');
  });
});

describe('02-chaque-modele:351 — la copie ne porte pas, à l’écran, le nom d’une automatisation déjà là', () => {
  it('un préréglage stocké « Contract Signed » s’AFFICHE « Contrat signé » : la copie s’appelle « Contrat signé (2) »', () => {
    expect(nomDisponible('Contrat signé', ['Contract Signed', 'Welcome New Lead'])).toBe('Contrat signé (2)');
    // … et « (3) » si une copie existe déjà.
    expect(nomDisponible('Contrat signé', ['Contract Signed', 'Contrat signé (2)'])).toBe('Contrat signé (3)');
  });

  it('comme avant : un nom libre est gardé, un nom pris à l’identique (casse ignorée) est numéroté', () => {
    expect(nomDisponible('Relance', ['Bienvenue'])).toBe('Relance');
    expect(nomDisponible('Relance', ['relance'])).toBe('Relance (2)');
    expect(nomDisponible('Contract signed', ['Contract Signed'])).toBe('Contract signed (2)');
  });
});
