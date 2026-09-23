/**
 * Attribution marketing du formulaire public.
 *
 * Les publicités pointent vers la page publique avec leurs paramètres
 * habituels ; aucun champ du formulaire ne change. Ce test fige ce contrat :
 * ce qui est lu, ce qui est ignoré, et ce qui est borné.
 *
 * Le cas qui compte vraiment : `?utm_source=` sans valeur ne doit PAS compter
 * comme une source, sinon les statistiques par source comptent des campagnes
 * fantômes.
 */
import { describe, it, expect } from 'vitest';
import { lireAttribution } from '../src/lib/publicFormApi';

describe('lireAttribution', () => {
  it('relève les cinq paramètres d’une URL de campagne', () => {
    const a = lireAttribution(
      '?utm_source=facebook&utm_medium=paid_social&utm_campaign=nettoyage_printemps' +
      '&utm_content=video_avant_apres&fbclid=IwAR123abc',
    );
    expect(a).toEqual({
      utm_source: 'facebook',
      utm_medium: 'paid_social',
      utm_campaign: 'nettoyage_printemps',
      utm_content: 'video_avant_apres',
      fbclid: 'IwAR123abc',
    });
  });

  it('rend null quand il n’y a aucun paramètre', () => {
    expect(lireAttribution('')).toEqual({
      utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, fbclid: null,
    });
  });

  it('traite un paramètre vide comme absent, pas comme une source', () => {
    // `?utm_source=` arrive vraiment : un lien tronqué, un gabarit de pub mal
    // rempli. Le compter comme une source créerait une campagne fantôme dans
    // la répartition par source.
    const a = lireAttribution('?utm_source=&utm_campaign=%20%20&fbclid=x');
    expect(a.utm_source).toBeNull();
    expect(a.utm_campaign).toBeNull();
    expect(a.fbclid).toBe('x');
  });

  it('ignore les paramètres qui ne sont pas de l’attribution', () => {
    const a = lireAttribution('?ref=infolettre&gclid=abc&utm_source=google');
    expect(a.utm_source).toBe('google');
    expect(Object.keys(a).sort()).toEqual(
      ['fbclid', 'utm_campaign', 'utm_content', 'utm_medium', 'utm_source'],
    );
  });

  it('borne à 256 caractères, comme le serveur', () => {
    // Une URL est publique et forgeable : sans borne, elle servirait de champ
    // de texte libre vers la base.
    const a = lireAttribution('?utm_campaign=' + 'x'.repeat(500));
    expect(a.utm_campaign).toHaveLength(256);
  });

  it('survit à une chaîne de requête invalide', () => {
    expect(() => lireAttribution('%%%')).not.toThrow();
  });

  it('décode les valeurs encodées', () => {
    const a = lireAttribution('?utm_campaign=' + encodeURIComponent('été 2026 — lavage'));
    expect(a.utm_campaign).toBe('été 2026 — lavage');
  });
});
