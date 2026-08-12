/* ═══════════════════════════════════════════════════════════════
   Couleur de marque d'une entreprise, sur les documents client.

   Les documents (contrat, soumission, page de paiement) sont
   monochromes par défaut. Une org qui choisit une couleur la voit
   remplacer l'encre noire des actions et des accents — nulle part
   ailleurs : le CRM lui-même reste neutre, c'est l'identité de Lume,
   pas celle du client.
   ═══════════════════════════════════════════════════════════════ */

/** L'encre noire des documents — le comportement quand rien n'est choisi. */
export const DEFAULT_BRAND = '#111111';

const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * La couleur retenue pour un document.
 *
 * La valeur part directement dans du CSS : tout ce qui n'est pas un hex
 * à 6 chiffres est rejeté, sans quoi une chaîne libre venue de la base
 * s'injecterait dans la page publique.
 */
export function resolveBrand(color?: string | null): string {
  const v = (color || '').trim();
  return HEX.test(v) ? v : DEFAULT_BRAND;
}

/** Composantes 0–255 d'un hex déjà validé. */
function rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Luminance relative (WCAG 2.1, §relative luminance). */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Le texte lisible SUR cette couleur.
 *
 * Sans ça, une marque jaune ou lime donne un bouton blanc sur clair,
 * illisible — et c'est précisément le bouton « Payer ».
 */
export function readableOn(color?: string | null): string {
  const brand = resolveBrand(color);
  // Seuil 0,5 : au-dessus la couleur est claire, il lui faut du texte
  // sombre. Comparer les contrastes des deux candidats serait plus fin,
  // mais donne le même verdict sur toute la plage utile.
  return luminance(brand) > 0.5 ? '#111111' : '#ffffff';
}

/** La même couleur en fond très léger, pour un liseré ou une pastille. */
export function brandTint(color?: string | null, alpha = 0.08): string {
  const [r, g, b] = rgb(resolveBrand(color));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
