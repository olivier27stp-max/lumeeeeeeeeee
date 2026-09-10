/**
 * Région d'affichage du site marketing, choisie dans l'en-tête (globe).
 *
 * Mémorisée dans localStorage sous `lume-region` ; l'en-tête émet
 * `lume:region` à chaque changement pour que les pages déjà montées
 * (Tarifs, accueil) se mettent à jour sans rechargement.
 *
 * La région ne change que l'affichage : langue et devise des prix.
 * La devise réellement facturée reste décidée au checkout.
 */
import { useEffect, useState } from 'react';

export type Region = 'ca-fr' | 'ca-en' | 'us-en';
export type Currency = 'CAD' | 'USD';

const REGIONS: Region[] = ['ca-fr', 'ca-en', 'us-en'];

export function readRegion(): Region {
  try {
    const v = localStorage.getItem('lume-region');
    if (v && (REGIONS as string[]).includes(v)) return v as Region;
  } catch {
    /* stockage indisponible : on retombe sur le Canada */
  }
  return 'ca-fr';
}

export function currencyFor(region: Region): Currency {
  return region === 'us-en' ? 'USD' : 'CAD';
}

export function useRegion(): { region: Region; currency: Currency; isUS: boolean } {
  const [region, setRegion] = useState<Region>(() => (typeof window === 'undefined' ? 'ca-fr' : readRegion()));
  useEffect(() => {
    const onRegion = () => setRegion(readRegion());
    window.addEventListener('lume:region', onRegion);
    window.addEventListener('storage', onRegion);
    return () => {
      window.removeEventListener('lume:region', onRegion);
      window.removeEventListener('storage', onRegion);
    };
  }, []);
  return { region, currency: currencyFor(region), isUS: region === 'us-en' };
}
