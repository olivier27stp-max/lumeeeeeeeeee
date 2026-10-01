/**
 * Crédits Lumi — formatage, dates, choix de l'état. Aucun écran rendu ici.
 *
 * Deux règles que ces tests verrouillent, parce que les casser ne se voit pas
 * à l'œil :
 *  - `renouvellement_le` est une date LOCALE : la lire avec `new Date(iso)`
 *    donnerait minuit UTC, donc la veille au soir à Montréal, et l'app
 *    afficherait un renouvellement un jour trop tôt ;
 *  - aucun montant en dollars d'IA ne sort de ce module.
 */
import {
  CREDITS_LUMI_AUTOPILOT,
  creditsBloquent,
  creditsEpuises,
  creditsParMois,
  etatCredits,
  fmtCredits,
  fmtDateCredits,
  libelleAvis,
  libelleSaisieBloquee,
  libellesCompteur,
  majuscule,
  remplir,
  textesCredits,
  uniteCredits,
  type EtatCredits,
} from './credits';

/** Les espaces insécables varient selon la version d'ICU : on compare à plat. */
const plat = (s: string | null) => (s ?? '').replace(/[   ]/g, ' ');

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

describe('remplir', () => {
  it('remplace les jetons connus et laisse les inconnus', () => {
    expect(remplir('{a} et {b}', { a: '1', b: 2 })).toBe('1 et 2');
    expect(remplir('{a} et {z}', { a: '1' })).toBe('1 et {z}');
  });

  it('évite le double point quand la date finit par un point', () => {
    // « jusqu'au {date}. » + date « 12 nov. » ne doit pas donner « 12 nov.. »
    expect(remplir('jusqu’au {date}.', { date: '12 nov.' })).toBe('jusqu’au 12 nov.');
    expect(remplir('jusqu’au {date} ok', { date: '12 nov.' })).toBe('jusqu’au 12 nov. ok');
  });
});

describe('majuscule', () => {
  it('met la première lettre en majuscule, et gère la chaîne vide', () => {
    expect(majuscule('crédits Lumi')).toBe('Crédits Lumi');
    expect(majuscule('Lumi credits')).toBe('Lumi credits');
    expect(majuscule('')).toBe('');
  });
});

describe('fmtCredits', () => {
  it('groupe les milliers selon la langue', () => {
    expect(plat(fmtCredits(1000, 'fr'))).toBe('1 000');
    expect(fmtCredits(1000, 'en')).toBe('1,000');
    expect(fmtCredits(742, 'fr')).toBe('742');
  });

  it('arrondit à l entier par défaut, une décimale sur demande', () => {
    expect(fmtCredits(12.4, 'fr')).toBe('12');
    expect(plat(fmtCredits(12.4, 'fr', 1))).toBe('12,4');
    expect(fmtCredits(12.4, 'en', 1)).toBe('12.4');
  });
});

describe('fmtDateCredits', () => {
  it('formate court en fr et en en', () => {
    expect(plat(fmtDateCredits('2026-11-12', 'fr'))).toBe('12 nov.');
    expect(plat(fmtDateCredits('2026-11-12', 'en'))).toBe('Nov 12');
  });

  it('formate long avec le mois en entier', () => {
    expect(plat(fmtDateCredits('2026-11-12', 'fr', true))).toContain('12 novembre');
    expect(plat(fmtDateCredits('2026-11-12', 'en', true))).toContain('November 12');
  });

  it('ne décale JAMAIS la date d un fuseau', () => {
    // Le piège : new Date('2026-01-01') = minuit UTC = 31 décembre à Montréal.
    expect(plat(fmtDateCredits('2026-01-01', 'fr'))).toBe('1 janv.');
    expect(plat(fmtDateCredits('2026-01-01', 'en'))).toBe('Jan 1');
    expect(plat(fmtDateCredits('2026-03-01', 'en'))).toBe('Mar 1');
  });

  it('rend null sur une date absente ou illisible', () => {
    expect(fmtDateCredits(null, 'fr')).toBeNull();
    expect(fmtDateCredits(undefined, 'fr')).toBeNull();
    expect(fmtDateCredits('', 'fr')).toBeNull();
    expect(fmtDateCredits('bientôt', 'fr')).toBeNull();
  });
});

describe('creditsEpuises', () => {
  it('vrai sur le palier, sur l avertissement 100, ou à zéro restant', () => {
    expect(creditsEpuises(etat({ palier: 'epuise' }))).toBe(true);
    expect(creditsEpuises(etat({ avertissement: '100' }))).toBe(true);
    expect(creditsEpuises(etat({ restants: 0 }))).toBe(true);
    expect(creditsEpuises(etat({ restants: -5 }))).toBe(true);
  });

  it('faux quand il reste des crédits, ou quand le forfait n inclut pas Lumi', () => {
    expect(creditsEpuises(etat())).toBe(false);
    expect(creditsEpuises(etat({ inclus: false, restants: 0 }))).toBe(false);
    expect(creditsEpuises(null)).toBe(false);
    expect(creditsEpuises(undefined)).toBe(false);
  });

  it('les paliers intermédiaires ne sont pas un épuisement', () => {
    expect(creditsEpuises(etat({ palier: 'econome' }))).toBe(false);
    expect(creditsEpuises(etat({ palier: 'restreint' }))).toBe(false);
  });
});

describe('etatCredits', () => {
  it('absent sans crédits ou sans Lumi au forfait', () => {
    expect(etatCredits(null)).toBe('absent');
    expect(etatCredits(undefined)).toBe('absent');
    expect(etatCredits(etat({ inclus: false }))).toBe('absent');
  });

  it('normal, puis 80 %, puis épuisé', () => {
    expect(etatCredits(etat())).toBe('normal');
    expect(etatCredits(etat({ avertissement: '80', restants: 150, utilises: 850, pourcentage: 85 }))).toBe('avert80');
    expect(etatCredits(etat({ avertissement: '100', restants: 0, utilises: 1000, pourcentage: 100, palier: 'epuise' }))).toBe('epuise');
  });

  it('l épuisement gagne sur l avertissement à 80 %', () => {
    expect(etatCredits(etat({ avertissement: '80', restants: 0 }))).toBe('epuise');
  });

  it('seul l état épuisé bloque l envoi', () => {
    expect(creditsBloquent(etat())).toBe(false);
    expect(creditsBloquent(etat({ avertissement: '80', restants: 150 }))).toBe(false);
    expect(creditsBloquent(etat({ palier: 'epuise', restants: 0 }))).toBe(true);
    expect(creditsBloquent(etat({ inclus: false }))).toBe(false);
  });
});

describe('libellesCompteur', () => {
  it('rend le compteur attendu en français', () => {
    const l = libellesCompteur(etat(), 'fr');
    expect(plat(l.compteur)).toBe('742 / 1 000 crédits Lumi');
    expect(plat(l.renouvellement)).toBe('renouvellement le 12 nov.');
    expect(plat(l.complet)).toBe('742 / 1 000 crédits Lumi · renouvellement le 12 nov.');
  });

  it('rend le compteur attendu en anglais', () => {
    const l = libellesCompteur(etat(), 'en');
    expect(l.compteur).toBe('742 / 1,000 Lumi credits');
    expect(plat(l.renouvellement)).toBe('renews Nov 12');
    expect(plat(l.complet)).toBe('742 / 1,000 Lumi credits · renews Nov 12');
  });

  it('la barre montre ce qui RESTE, pas ce qui est consommé', () => {
    expect(libellesCompteur(etat({ restants: 742, total: 1000 }), 'fr').pctRestant).toBe(74);
    expect(libellesCompteur(etat({ restants: 1000, total: 1000 }), 'fr').pctRestant).toBe(100);
    expect(libellesCompteur(etat({ restants: 0, total: 1000 }), 'fr').pctRestant).toBe(0);
  });

  it('ne divise pas par zéro et ne descend pas sous zéro', () => {
    expect(libellesCompteur(etat({ total: 0, restants: 0 }), 'fr').pctRestant).toBe(0);
    expect(libellesCompteur(etat({ restants: -10 }), 'fr').pctRestant).toBe(0);
    expect(plat(libellesCompteur(etat({ restants: -10 }), 'fr').compteur)).toBe('0 / 1 000 crédits Lumi');
  });

  it('arrondit vers le bas les crédits fractionnaires', () => {
    expect(plat(libellesCompteur(etat({ restants: 742.9 }), 'fr').compteur)).toBe('742 / 1 000 crédits Lumi');
  });

  it('retombe sur « renouvellement » quand la date est illisible', () => {
    expect(libellesCompteur(etat({ renouvellement_le: '' }), 'fr').renouvellement).toBe('renouvellement le renouvellement');
    expect(libellesCompteur(etat({ renouvellement_le: '' }), 'en').renouvellement).toBe('renews renewal');
  });

  it('donne une valeur de barre lisible à voix haute', () => {
    expect(plat(libellesCompteur(etat(), 'fr').barValue)).toBe('742 crédits Lumi restants sur 1 000');
    expect(libellesCompteur(etat(), 'en').barValue).toBe('742 of 1,000 Lumi credits left');
    expect(libellesCompteur(etat(), 'fr').barLabel).toBe('Crédits Lumi restants pour la période');
  });
});

describe('libelleAvis', () => {
  it('rien sous 80 %', () => {
    expect(libelleAvis(etat(), 'fr')).toBeNull();
    expect(libelleAvis(null, 'fr')).toBeNull();
    expect(libelleAvis(etat({ inclus: false }), 'fr')).toBeNull();
  });

  it('à 80 %, dit combien il reste et jusqu à quand', () => {
    const c = etat({ avertissement: '80', restants: 150, utilises: 850, pourcentage: 85 });
    expect(plat(libelleAvis(c, 'fr'))).toBe('Il te reste 150 crédits Lumi jusqu’au 12 nov.');
    expect(plat(libelleAvis(c, 'en'))).toBe('You have 150 Lumi credits left until Nov 12.');
  });

  it('à 100 %, rassure sur le reste de Lume', () => {
    const c = etat({ avertissement: '100', restants: 0, utilises: 1000, pourcentage: 100, palier: 'epuise' });
    expect(plat(libelleAvis(c, 'fr'))).toBe(
      'Tes crédits Lumi sont épuisés jusqu’au 12 nov. Les actions rapides et tout le reste de Lume fonctionnent toujours.',
    );
    expect(plat(libelleAvis(c, 'en'))).toBe(
      'Your Lumi credits are used up until Nov 12. Quick actions and everything else in Lume still work.',
    );
  });
});

describe('libelleSaisieBloquee', () => {
  it('null tant que les crédits ne bloquent pas', () => {
    expect(libelleSaisieBloquee(etat(), 'fr')).toBeNull();
    expect(libelleSaisieBloquee(etat({ avertissement: '80', restants: 150 }), 'fr')).toBeNull();
  });

  it('épuisé : le texte de la saisie désactivée, avec la majuscule', () => {
    const c = etat({ palier: 'epuise', restants: 0 });
    expect(plat(libelleSaisieBloquee(c, 'fr'))).toBe('Crédits Lumi épuisés jusqu’au 12 nov.');
    expect(plat(libelleSaisieBloquee(c, 'en'))).toBe('Lumi credits used up until Nov 12.');
  });
});

describe('textes de vente', () => {
  it('« 1 000 crédits Lumi / mois » dans les deux langues', () => {
    expect(plat(creditsParMois('fr'))).toBe('1 000 crédits Lumi / mois');
    expect(creditsParMois('en')).toBe('1,000 Lumi credits / month');
    expect(CREDITS_LUMI_AUTOPILOT).toBe(1000);
  });

  it('l unité est UNE seule clé, réutilisée partout', () => {
    expect(uniteCredits('fr')).toBe('crédits Lumi');
    expect(uniteCredits('en')).toBe('Lumi credits');
    expect(textesCredits('fr').unit).toBe(uniteCredits('fr'));
    expect(textesCredits('en').unit).toBe(uniteCredits('en'));
  });

  it('dit que les crédits ne sont pas reportés', () => {
    expect(textesCredits('fr').noRollover).toContain('ne sont pas reportés');
    expect(textesCredits('en').noRollover).toContain('do not roll over');
  });
});

describe('aucun dollar d IA, dans aucun texte', () => {
  it('pas de « $ », de « dollar » ni de « cent » dans les gabarits', () => {
    for (const langue of ['fr', 'en'] as const) {
      for (const [cle, gabarit] of Object.entries(textesCredits(langue))) {
        expect(`${langue}.${cle} → ${gabarit}`).not.toMatch(/\$|dollar|\bcents?\b/i);
      }
    }
  });

  it('pas de « $ » dans un libellé rendu, dans aucun état', () => {
    const cas = [
      etat(),
      etat({ avertissement: '80', restants: 150 }),
      etat({ avertissement: '100', restants: 0, palier: 'epuise' }),
    ];
    for (const langue of ['fr', 'en'] as const) {
      for (const c of cas) {
        const l = libellesCompteur(c, langue);
        for (const texte of [l.complet, l.barLabel, l.barValue, libelleAvis(c, langue) ?? '', libelleSaisieBloquee(c, langue) ?? '']) {
          expect(texte).not.toContain('$');
        }
      }
    }
  });
});
