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
  const scale = selected ? 1.25 : 1;
  const ring = selected
    ? `<circle cx="15" cy="15" r="14" fill="none" stroke="${fill}" stroke-width="2" opacity="0.35"/>`
    : '';
  const svg = `<svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg" style="transform:scale(${scale});transform-origin:center">${ring}<circle cx="15" cy="15" r="10" fill="${fill}" stroke="#2d2d2d" stroke-width="1.5"/><circle cx="15" cy="15" r="3.5" fill="white" opacity="0.9"/></svg>`;
  return L.divIcon({
    html: svg,
    className: 'crm-marker',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
  });
}

export default createPinIcon;
