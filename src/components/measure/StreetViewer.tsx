/**
 * StreetViewer — visionneuse Street View de l'espace de mesure.
 * Photos réelles haute résolution de la propriété (imagerie officielle Google
 * extérieure uniquement — jamais les photos sphères d'utilisateurs).
 * Visualisation seulement : les mesures se prennent sur la carte 2D et
 * l'outil Hauteur. Si aucun panorama n'existe → onUnavailable.
 */
import React, { useEffect, useRef, useState } from 'react';
import { X, Loader2 } from 'lucide-react';

interface Props {
  lat: number;
  lng: number;
  fr: boolean;
  onClose: () => void;
  /** Aucun panorama disponible ici — le parent ferme avec un message. */
  onUnavailable: () => void;
}

export default function StreetViewer({ lat, lng, fr, onClose, onUnavailable }: Props) {
  const div = useRef<HTMLDivElement>(null);
  const panoRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!div.current) return;
    const svc = new google.maps.StreetViewService();
    const giveUp = () => onUnavailable();
    const show = (data: google.maps.StreetViewPanoramaData) => {
      if (!data?.location?.latLng || !div.current) { giveUp(); return; }
      let heading = 0;
      try {
        heading = google.maps.geometry.spherical.computeHeading(
          data.location.latLng, new google.maps.LatLng(lat, lng));
      } catch { /* cap par défaut */ }
      panoRef.current = new google.maps.StreetViewPanorama(div.current, {
        pano: data.location.pano,
        pov: { heading, pitch: 5 },
        zoom: 0.8,
        addressControl: false,
        fullscreenControl: false,
        motionTracking: false,
        motionTrackingControl: false,
      });
      setReady(true);
    };
    // Tentative stricte (imagerie officielle extérieure), repli extérieur,
    // garde-fou 10 s — jamais bloqué en chargement.
    const attempt = (extra: Record<string, unknown>, onFail: () => void) => {
      let settled = false;
      const settle = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
      const timer = setTimeout(() => settle(onFail), 10000);
      try {
        const req = { location: { lat, lng }, radius: 120, preference: 'nearest', ...extra } as unknown as google.maps.StreetViewLocationRequest;
        const p: any = svc.getPanorama(req, (data, status) => {
          if (String(status).toUpperCase() === 'OK') settle(() => show(data as google.maps.StreetViewPanoramaData));
          else settle(onFail);
        });
        p?.catch?.(() => settle(onFail));
      } catch { settle(onFail); }
    };
    attempt({ sources: ['google', 'outdoor'] }, () => attempt({ source: 'outdoor' }, giveUp));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[70] bg-background flex flex-col">
      <div className="h-12 border-b border-outline/20 flex items-center px-4 gap-3 bg-surface-card shrink-0">
        <span className="text-[13px] font-bold text-text-primary">Street View</span>
        <span className="hidden sm:block text-[11px] text-text-tertiary min-w-0 truncate">
          {fr ? 'Photos réelles de la propriété — les mesures se prennent sur la carte.' : 'Real photos of the property — measurements are taken on the map.'}
        </span>
        <button
          onClick={onClose}
          className="ml-auto p-1.5 hover:bg-surface-secondary rounded-lg transition-colors"
          aria-label={fr ? 'Fermer' : 'Close'}
        >
          <X size={16} className="text-text-secondary" />
        </button>
      </div>
      <div className="flex-1 relative">
        <div ref={div} className="absolute inset-0" />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/80 z-10">
            <Loader2 size={28} className="animate-spin text-text-muted" />
          </div>
        )}
      </div>
    </div>
  );
}
