/**
 * Normalisation d'un énoncé : minuscules, sans accents, sans ponctuation.
 * Partagée par les raccourcis, les traces, les réponses fixes et l'aide.
 * Module sans dépendance pour rester importable de partout.
 */
export function normaliser(s: string): string[] {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}
