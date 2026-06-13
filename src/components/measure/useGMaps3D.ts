/**
 * useGMaps3D — shared Google Maps JS API loader (beta channel, 3D tiles).
 * Idempotent via the 'gmap-measure' script id, so multiple consumers
 * (the 2D measure workspace AND the 3D height modal) never inject the
 * Maps script twice (which throws "included … multiple times").
 */

import { useEffect, useState } from 'react';

export function useGMaps3D() {
  const [ok, setOk] = useState(false);
  const key = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '') as string;
  const mapId = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || '') as string;

  useEffect(() => {
    if (!key) return;
    try { if (window.google?.maps) { setOk(true); return; } } catch {}
    const id = 'gmap-measure';
    if (document.getElementById(id)) {
      const p = setInterval(() => { try { if (window.google?.maps) { setOk(true); clearInterval(p); } } catch {} }, 200);
      return () => clearInterval(p);
    }
    const s = document.createElement('script');
    s.id = id; s.async = true; s.defer = true;
    // Load beta channel for 3D tiles support (alpha is restricted to dev environments)
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places,geometry,maps3d&v=beta`;
    s.onload = async () => {
      try {
        const g = (window as any).google;
        if (g?.maps?.importLibrary) {
          await Promise.all([
            g.maps.importLibrary('maps'),
            g.maps.importLibrary('places'),
            g.maps.importLibrary('geometry'),
            // Elevation + maps3d are optional enrichments — never let their absence
            // block the core map init, or the whole workspace fails to load.
            g.maps.importLibrary('elevation').catch((e: any) => console.warn('[gmaps] elevation unavailable:', e)),
            g.maps.importLibrary('maps3d').catch((e: any) => console.warn('[gmaps] maps3d unavailable:', e)),
          ]);
        }
        setOk(true);
      } catch (e) {
        console.error('[gmaps] failed to init libraries:', e);
      }
    };
    s.onerror = (e) => console.error('[gmaps] script load failed:', e);
    document.head.appendChild(s);
  }, [key]);

  return { ok, key, mapId, has3d: Boolean(mapId) };
}
