/* Couleur de marque d'une entreprise — miroir de src/lib/brandColor.ts du web.
 *
 * Le mobile ne rend pas les documents client (ils vivent sur les pages
 * publiques du web), mais il laisse choisir la couleur et doit donc en
 * montrer un aperçu fidèle. Les deux implémentations doivent rendre le
 * même verdict, sinon l'aperçu ment. */

/** L'encre noire des documents — le comportement quand rien n'est choisi. */
export const DEFAULT_BRAND = '#111111';

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** La couleur retenue. Tout ce qui n'est pas un hex à 6 chiffres est rejeté. */
export function resolveBrand(color?: string | null): string {
  const v = (color || '').trim();
  return HEX.test(v) ? v : DEFAULT_BRAND;
}

function rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Luminance relative (WCAG 2.1). */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Le texte lisible SUR cette couleur. Sans ça une marque jaune donne un
 * bouton blanc sur clair — et c'est le bouton « Payer ».
 */
export function readableOn(color?: string | null): string {
  return luminance(resolveBrand(color)) > 0.5 ? '#111111' : '#ffffff';
}
