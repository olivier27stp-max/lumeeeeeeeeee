/* ─── Shared color utilities for team-based styling ─────────── */

export const FALLBACK_TEAM_COLOR = '#6B7280';

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const n = hex.replace('#', '');
  if (n.length !== 6) return null;
  return {
    r: parseInt(n.slice(0, 2), 16),
    g: parseInt(n.slice(2, 4), 16),
    b: parseInt(n.slice(4, 6), 16),
  };
}

/**
 * Creates SaaS-style color tokens from a team hex color.
 * - bg: 18% opacity tinted background
 * - border: full saturation left-border
 * - text: darkened (50%) for readability
 */
export function getEventColors(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return { bg: 'rgba(107,114,128,0.12)', border: FALLBACK_TEAM_COLOR, text: '#374151' };
  }
  const { r, g, b } = rgb;
  const dr = Math.round(r * 0.5);
  const dg = Math.round(g * 0.5);
  const db = Math.round(b * 0.5);
  return {
    bg: `rgba(${r}, ${g}, ${b}, 0.18)`,
    border: `rgb(${r}, ${g}, ${b})`,
    text: `rgb(${dr}, ${dg}, ${db})`,
  };
}

export function resolveTeamColor(colorHex: string): string {
  return isHexColor(colorHex) ? colorHex : FALLBACK_TEAM_COLOR;
}

export function toRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(17,24,39,${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}
