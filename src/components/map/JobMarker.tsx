// JobMarker is no longer a separate component — pin icons are now
// created inline via Leaflet DivIcon in CRMMap.tsx.
// This file is kept as a re-export of the icon factory for external use.

import L from 'leaflet';

const FALLBACK_COLOR = '#2563eb';

function isHexColor(value: string | null | undefined) {
  if (!value) return false;
  return /^#[0-9a-f]{3,8}$/i.test(value);
}

export function createPinIcon(color: string | null | undefined, selected: boolean): L.DivIcon {
  const fill = isHexColor(color) ? (color as string) : FALLBACK_COLOR;
  // Teardrop pin: head centered at (15,14), tip at (15,39) marks the location.
  const scale = selected ? 1.2 : 1;
  const ring = selected
    ? `<circle cx="15" cy="14" r="13" fill="none" stroke="${fill}" stroke-width="2" opacity="0.35"/>`
    : '';
  const drop = `<path d="M15 1.5 C8.1 1.5 2.5 7.1 2.5 14 C2.5 22.6 15 38.5 15 38.5 C15 38.5 27.5 22.6 27.5 14 C27.5 7.1 21.9 1.5 15 1.5 Z" fill="${fill}" stroke="#2d2d2d" stroke-width="1.5"/>`;
  const svg = `<svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg" style="transform:scale(${scale});transform-origin:15px 39px">${ring}${drop}<circle cx="15" cy="14" r="4" fill="white" opacity="0.95"/></svg>`;
  return L.divIcon({
    html: svg,
    className: 'crm-marker',
    iconSize: [30, 40],
    iconAnchor: [15, 39],
    popupAnchor: [0, -36],
  });
}

export default createPinIcon;
