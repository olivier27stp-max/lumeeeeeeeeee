/**
 * Ménage du bucket des champs « Fichier ».
 *
 * La règle de décision est isolée dans une fonction pure : c'est elle qui peut
 * effacer le document d'un client par erreur, donc c'est elle qu'on teste, sans
 * bucket ni base.
 */
import { describe, it, expect } from 'vitest';
import { cheminsAsupprimer, type FichierBucket } from '../server/lib/champs/menageFichiers';

const MAINTENANT = new Date('2026-09-26T12:00:00Z');
const ilYA = (jours: number) => new Date(MAINTENANT.getTime() - jours * 86_400_000).toISOString();

describe('cheminsAsupprimer', () => {
  const vieux: FichierBucket = { chemin: 'org/a/vieux.pdf', cree: ilYA(30) };
  const recent: FichierBucket = { chemin: 'org/b/recent.pdf', cree: ilYA(1) };
  const sansDate: FichierBucket = { chemin: 'org/c/mystere.pdf', cree: null };

  it('supprime l’orphelin assez vieux', () => {
    expect(cheminsAsupprimer([vieux], new Set(), MAINTENANT)).toEqual(['org/a/vieux.pdf']);
  });

  it('garde celui qu’une valeur cite encore', () => {
    expect(cheminsAsupprimer([vieux], new Set(['org/a/vieux.pdf']), MAINTENANT)).toEqual([]);
  });

  it('garde un fichier récent : une saisie peut être en cours', () => {
    expect(cheminsAsupprimer([recent], new Set(), MAINTENANT)).toEqual([]);
  });

  it('garde un fichier sans date : on ne devine pas', () => {
    expect(cheminsAsupprimer([sansDate], new Set(), MAINTENANT)).toEqual([]);
  });

  it('garde un fichier à la date illisible', () => {
    expect(cheminsAsupprimer([{ chemin: 'org/d/x.pdf', cree: 'pas une date' }], new Set(), MAINTENANT)).toEqual([]);
  });

  it('plafonne le nombre de suppressions par passage', () => {
    const beaucoup = Array.from({ length: 500 }, (_, i) => ({ chemin: `org/z/${i}.pdf`, cree: ilYA(30) }));
    expect(cheminsAsupprimer(beaucoup, new Set(), MAINTENANT, 200)).toHaveLength(200);
  });

  it('un bucket vide ne fait rien', () => {
    expect(cheminsAsupprimer([], new Set(), MAINTENANT)).toEqual([]);
  });
});
