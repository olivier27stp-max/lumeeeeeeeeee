/**
 * Palette de 15 dégradés doux (sauge / beige / tons terreux) — SOURCE DE
 * VÉRITÉ UNIQUE pour les couleurs des presets de devis (PresetSelectModal)
 * et les sidebars des cartes de visite de la vue Jour du calendrier.
 * Au-delà de 15 éléments, on recycle les mêmes couleurs (index % 15).
 */
export const PRESET_GRADIENTS: Array<[string, string]> = [
  ['#b8c4b0', '#d8d0c2'], // sauge → sable
  ['#aeb9c4', '#d0d6dc'], // bleu-gris → brume
  ['#cfc2a5', '#e4dcc9'], // blé → crème
  ['#c4a99b', '#ddcdc2'], // argile → lin
  ['#a8b8a2', '#ccd6c8'], // mousse → céladon
  ['#b3b0c4', '#d5d3dd'], // lavande ardoise → lilas pâle
  ['#a9bfbc', '#cfdcda'], // eucalyptus → écume
  ['#c4b0b4', '#ddd0d3'], // vieux rose → poudre
  ['#b5b89f', '#d6d7c5'], // olive → tilleul
  ['#a4b1c2', '#c9d2dd'], // denim délavé → ciel gris
  ['#c0b3a4', '#ded5ca'], // taupe chaud → grège
  ['#adc0b3', '#d1ddd5'], // menthe grise → jade pâle
  ['#bcaab8', '#d9ced7'], // mauve → rose cendré
  ['#b8b8b4', '#d8d8d4'], // pierre → galet
  ['#c9b8a0', '#e2d6c4'], // caramel doux → avoine
];

export function presetGradient(index: number): string {
  const [from, to] = PRESET_GRADIENTS[index % PRESET_GRADIENTS.length];
  return `linear-gradient(120deg, ${from}, ${to})`;
}

/** Couleur principale (côté foncé du dégradé) pour un index donné. */
export function presetColorAt(index: number): string {
  const n = PRESET_GRADIENTS.length;
  return PRESET_GRADIENTS[((index % n) + n) % n][0];
}

/**
 * Index stable [0, 15) dérivé d'un identifiant (uuid, etc.) via FNV-1a.
 * Même id → même couleur après actualisation, changement de date ou de vue,
 * reconnexion — aucune valeur aléatoire au chargement.
 */
export function presetIndexForKey(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % PRESET_GRADIENTS.length;
}

export function presetColorForKey(key: string): string {
  return presetColorAt(presetIndexForKey(key));
}
