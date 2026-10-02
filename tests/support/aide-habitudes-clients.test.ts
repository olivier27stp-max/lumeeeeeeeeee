/**
 * Une habitude de MES clients est une question sur les données, pas un mode d'emploi.
 *
 * Passe en prod du 2026-10-02 : « Mes clients me paient surtout comment : par carte,
 * par virement ou comptant ? » recevait, sans modèle et sans aucun chiffre, le
 * paragraphe d'aide de la facturation — les mots « carte, virement, comptant » y
 * figurent, et « comment » ouvrait la porte de l'aide. La réponse attendue est la
 * répartition réelle des modes de paiement du compte.
 */
import { describe, it, expect } from 'vitest';
import { porteSurLesDonnees, reponseFaqPour } from '../../server/lib/support/faq';
import { reponseAideDirecte } from '../../server/lib/support/articles-dabord';

const aide = (q: string, langue: 'fr' | 'en' = 'fr') => reponseAideDirecte(q, langue, { premierMessage: true, voix: 'tu' });

describe('une habitude de mes clients descend au modèle, qui lit le compte', () => {
  it.each([
    'Mes clients me paient surtout comment : par carte, par virement ou comptant ?',
    'Comment mes clients me paient d’habitude ?',
    'La plupart de mes clients paient comment ?',
    'Mes employés travaillent surtout où ?',
    'Nos clients paient le plus souvent par carte ou par chèque ?',
    'La majorité de mes clients paient comment ?',
  ])('« %s »', (q) => {
    expect(porteSurLesDonnees(q)).toBe(true);
    expect(reponseFaqPour(q, 'fr', 'tu')).toBeNull();
    expect(aide(q)).toBeNull();
  });

  it.each([
    'How do my clients mostly pay: card, e-transfer or cash?',
    'Most of my clients pay how?',
    'How do our customers usually pay?',
  ])('en anglais : « %s »', (q) => {
    expect(porteSurLesDonnees(q)).toBe(true);
    expect(aide(q, 'en')).toBeNull();
  });
});

describe('le mode d’emploi reste servi par l’aide', () => {
  it('« comment » sans habitude ni possessif d’habitude : toujours une question produit', () => {
    expect(porteSurLesDonnees('Comment mes clients peuvent me payer en ligne ?')).toBe(false);
    expect(porteSurLesDonnees('Comment enregistrer un paiement comptant ?')).toBe(false);
    expect(porteSurLesDonnees('How can my clients pay online?')).toBe(false);
  });

  it('une question d’aide franche reçoit encore son article, sans modèle', () => {
    expect(aide('comment activer la double authentification')?.texte ?? '').toMatch(/Si ça ne règle pas ton cas/);
  });
});
