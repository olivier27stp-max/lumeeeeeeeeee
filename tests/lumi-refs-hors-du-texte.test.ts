/**
 * Une référence interne (« ref12 ») n'arrive jamais à l'écran.
 *
 * Passe d'évaluation du 2026-10-01, cas clients-21 : « la fiche de Longueuil
 * (ref2) a plus d'historique ». Le prompt l'interdit ; le modèle le fait quand
 * même de temps en temps. Le serveur filtre donc le flux et l'historique.
 */
import { describe, it, expect } from 'vitest';
import { sansRefsInternes, filtrerRefsDuFlux } from '../server/lib/lumi/orchestrateur';

/** Rejoue un texte découpé en morceaux, comme le flux du modèle, et rend ce qui part à l'écran. */
function ecran(morceaux: string[]): string {
  let tampon = '';
  let sorti = '';
  for (const m of morceaux) {
    const f = filtrerRefsDuFlux(tampon, m);
    tampon = f.tampon; sorti += f.pret;
  }
  return sorti + filtrerRefsDuFlux(tampon, '', true).pret;
}
/** Toutes les façons de couper un texte en deux, puis lettre par lettre. */
const decoupes = (t: string): string[][] => [[t], [...t], ...Array.from({ length: t.length - 1 }, (_, i) => [t.slice(0, i + 1), t.slice(i + 1)])];

describe('sansRefsInternes', () => {
  it('retire la référence, entre parenthèses ou nue, et rien d’autre', () => {
    expect(sansRefsInternes('La fiche de Longueuil (ref2) a plus d’historique.')).toBe('La fiche de Longueuil a plus d’historique.');
    expect(sansRefsInternes('Je fusionne ref2 dans ref14.')).toBe('Je fusionne dans.');
    expect(sansRefsInternes('Deux fiches (ref2, ref14) : laquelle ?')).toBe('Deux fiches : laquelle ?');
    expect(sansRefsInternes('Marie Roy (ref2 et ref14).')).toBe('Marie Roy.');
  });
  it('ne touche ni aux mots qui contiennent « ref », ni aux numéros, ni aux parenthèses ordinaires', () => {
    for (const t of ['La préférence du client (voir la référence 46).', 'Facture n° 12 (payée), job 33.', 'Le chèque REF2024 est encaissé.', 'Il préfère le matin (avant 9 h).', 'refaire le devis, c’est 3 minutes'])
      expect(sansRefsInternes(t), t).toBe(t);
  });
});

describe('filtrerRefsDuFlux — quel que soit le découpage du flux', () => {
  const CAS: Array<[string, string]> = [
    ['La fiche de Longueuil (ref2) a plus d’historique.', 'La fiche de Longueuil a plus d’historique.'],
    ['Deux fiches (ref2, ref14) : laquelle ?', 'Deux fiches : laquelle ?'],
    ['Je garde ref12.', 'Je garde.'],
    ['Il préfère le matin (avant 9 h), refaire le devis prend 3 minutes.', 'Il préfère le matin (avant 9 h), refaire le devis prend 3 minutes.'],
    ['Rien à retirer ici (vraiment rien).', 'Rien à retirer ici (vraiment rien).'],
  ];
  for (const [entree, attendu] of CAS) {
    it(`« ${entree.slice(0, 40)}… »`, () => {
      for (const d of decoupes(entree)) expect(ecran(d), JSON.stringify(d)).toBe(attendu);
    });
  }
  it('ne retient pas le texte indéfiniment : seule une queue qui peut devenir une référence attend', () => {
    expect(filtrerRefsDuFlux('', 'Bonjour Marc, voici')).toEqual({ pret: 'Bonjour Marc, voici', tampon: '' });
    expect(filtrerRefsDuFlux('', 'la fiche (re').tampon).toBe(' (re');
    expect(filtrerRefsDuFlux('', 'la fiche (re').pret).toBe('la fiche');
    expect(filtrerRefsDuFlux(' (re', 'gardée)')).toEqual({ pret: ' (regardée)', tampon: '' });
    expect(filtrerRefsDuFlux('', 'il veut r').tampon).toBe(' r');
    expect(filtrerRefsDuFlux(' r', 'éserver')).toEqual({ pret: ' réserver', tampon: '' });
  });
});
