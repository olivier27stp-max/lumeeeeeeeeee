/**
 * Compteur et avis de crédits à l'écran, en français et en anglais.
 *
 * Deux détails de l'outillage, pour qui reprendra ces tests :
 *  - `@testing-library/react-native` v14 rend `render()` ASYNCHRONE : sans
 *    `await`, on manipule une promesse et tout échoue sur « toJSON is not a
 *    function » ;
 *  - `useThemeLumi` a une valeur par défaut (palette claire), donc ces
 *    composants se rendent sans fournisseur.
 */
import { render } from '@testing-library/react-native';
import React from 'react';

import { type EtatCredits } from '../../lib/lumi/credits';
import { AvisCreditsLumi, CompteurCreditsLumi } from './CreditsLumi';

/** Les espaces insécables varient selon la version d'ICU : on compare à plat. */
const plat = (s: string) => s.replace(/[   ]/g, ' ');

/** Tout l'arbre rendu, mis à plat — pour chercher un « $ » où qu'il soit. */
const rendu = (r: { toJSON: () => unknown }) => plat(JSON.stringify(r.toJSON() ?? null));

/** Le texte d'un nœud, enfants concaténés (un <Text> imbriqué en a plusieurs). */
const texte = (n: { children: unknown[] }) => plat(n.children.map(String).join(''));

const etat = (p: Partial<EtatCredits> = {}): EtatCredits => ({
  inclus: true,
  total: 1000,
  utilises: 258,
  restants: 742,
  pourcentage: 26,
  renouvellement_le: '2026-11-12',
  palier: 'normal',
  avertissement: null,
  ...p,
});

const NORMAL = etat();
const AVERT80 = etat({ avertissement: '80', restants: 150, utilises: 850, pourcentage: 85 });
const EPUISE = etat({ avertissement: '100', restants: 0, utilises: 1000, pourcentage: 100, palier: 'epuise' });

describe('CompteurCreditsLumi', () => {
  it('affiche « 742 / 1 000 crédits Lumi » et la date, en français', async () => {
    const r = await render(<CompteurCreditsLumi credits={NORMAL} langue="fr" />);
    expect(texte(r.getByText(/crédits Lumi/))).toContain('742 / 1 000 crédits Lumi');
    expect(rendu(r)).toContain('renouvellement le 12 nov.');
  });

  it('affiche « 742 / 1,000 Lumi credits » et la date, en anglais', async () => {
    const r = await render(<CompteurCreditsLumi credits={NORMAL} langue="en" />);
    expect(texte(r.getByText(/Lumi credits/))).toContain('742 / 1,000 Lumi credits');
    expect(rendu(r)).toContain('renews Nov 12');
  });

  it('expose une barre de progression des crédits RESTANTS', async () => {
    const r = await render(<CompteurCreditsLumi credits={NORMAL} langue="fr" />);
    const barre = r.getByRole('progressbar');
    expect(barre.props.accessibilityValue.min).toBe(0);
    expect(barre.props.accessibilityValue.max).toBe(1000);
    expect(barre.props.accessibilityValue.now).toBe(742);
    expect(plat(barre.props.accessibilityValue.text)).toBe('742 crédits Lumi restants sur 1 000');
    expect(plat(barre.props.accessibilityLabel)).toBe('Crédits Lumi restants pour la période');
  });

  it('la barre est lisible en anglais aussi', async () => {
    const r = await render(<CompteurCreditsLumi credits={NORMAL} langue="en" />);
    const barre = r.getByRole('progressbar');
    expect(barre.props.accessibilityValue.text).toBe('742 of 1,000 Lumi credits left');
    expect(barre.props.accessibilityLabel).toBe('Lumi credits left this period');
  });

  it('à zéro crédit, la barre est vide et le compteur le dit', async () => {
    const r = await render(<CompteurCreditsLumi credits={EPUISE} langue="fr" />);
    expect(texte(r.getByText(/crédits Lumi/))).toContain('0 / 1 000 crédits Lumi');
    expect(r.getByRole('progressbar').props.accessibilityValue.now).toBe(0);
  });

  it('n affiche aucun montant en dollars, dans aucun état ni aucune langue', async () => {
    for (const langue of ['fr', 'en'] as const) {
      for (const credits of [NORMAL, AVERT80, EPUISE]) {
        const r = await render(<CompteurCreditsLumi credits={credits} langue={langue} />);
        expect(rendu(r)).not.toContain('$');
        await r.unmount();
      }
    }
  });
});

describe('AvisCreditsLumi', () => {
  it('ne rend rien sous 80 %', async () => {
    const r = await render(<AvisCreditsLumi credits={NORMAL} langue="fr" />);
    expect(r.toJSON()).toBeNull();
  });

  it('ne rend rien sans crédits, ni quand le forfait n inclut pas Lumi', async () => {
    expect((await render(<AvisCreditsLumi credits={null} langue="fr" />)).toJSON()).toBeNull();
    expect((await render(<AvisCreditsLumi credits={undefined} langue="en" />)).toJSON()).toBeNull();
    expect((await render(<AvisCreditsLumi credits={etat({ inclus: false, restants: 0 })} langue="fr" />)).toJSON()).toBeNull();
  });

  it('à 80 %, dit combien il reste et jusqu à quand (fr)', async () => {
    const r = await render(<AvisCreditsLumi credits={AVERT80} langue="fr" />);
    expect(rendu(r)).toContain('Il te reste 150 crédits Lumi jusqu’au 12 nov.');
    expect(r.getByRole('alert')).toBeTruthy();
  });

  it('à 80 %, idem en anglais', async () => {
    const r = await render(<AvisCreditsLumi credits={AVERT80} langue="en" />);
    expect(rendu(r)).toContain('You have 150 Lumi credits left until Nov 12.');
  });

  it('épuisé, rassure sur le reste de Lume (fr)', async () => {
    const t = rendu(await render(<AvisCreditsLumi credits={EPUISE} langue="fr" />));
    expect(t).toContain('Tes crédits Lumi sont épuisés jusqu’au 12 nov.');
    expect(t).toContain('Les actions rapides et tout le reste de Lume fonctionnent toujours.');
  });

  it('épuisé, idem en anglais', async () => {
    const t = rendu(await render(<AvisCreditsLumi credits={EPUISE} langue="en" />));
    expect(t).toContain('Your Lumi credits are used up until Nov 12.');
    expect(t).toContain('Quick actions and everything else in Lume still work.');
  });

  it('n affiche aucun montant en dollars', async () => {
    for (const langue of ['fr', 'en'] as const) {
      for (const credits of [AVERT80, EPUISE]) {
        const r = await render(<AvisCreditsLumi credits={credits} langue={langue} />);
        expect(rendu(r)).not.toContain('$');
        await r.unmount();
      }
    }
  });
});
