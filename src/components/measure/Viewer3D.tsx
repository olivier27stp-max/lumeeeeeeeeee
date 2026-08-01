/**
 * Viewer3D — visionneuse de l'espace de mesure, deux modes :
 *   • 3D photoréaliste (style Google Earth) — contexte/volumes. Hors des
 *     centres urbains le maillage Google est flou : d'où le 2e mode.
 *   • Street View — vraies photos haute résolution de la façade, le bon outil
 *     pour préparer une soumission (étages, fenêtres, revêtements).
 * Visualisation seulement : les chemins/zones se dessinent sur la carte 2D,
 * et la hauteur en 3D passe par l'outil Hauteur. Si le 3D ne s'initialise
 * pas, on bascule sur Street View; si rien n'est disponible → onUnavailable.
 */
import React, { useEffect, useRef, useState } from 'react';
import { X, Loader2, MoveVertical } from 'lucide-react';
import Cam3DControls from './Cam3DControls';

interface Props {
  lat: number;
  lng: number;
  fr: boolean;
  onClose: () => void;
  /** Ni 3D ni Street View disponibles — le parent ferme et retombe sur la vue inclinée. */
  onUnavailable: () => void;
}

export default function Viewer3D({ lat, lng, fr, onClose, onUnavailable }: Props) {
  const div = useRef<HTMLDivElement>(null);
  const streetDiv = useRef<HTMLDivElement>(null);
  const elRef = useRef<any>(null);
  const panoRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const threeDFailed = useRef(false);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<'3d' | 'street'>('3d');
  const [street, setStreet] = useState<'idle' | 'loading' | 'ok' | 'none'>('idle');

  // ── Mode 3D photoréaliste ──
  useEffect(() => {
    if (!div.current) return;
    let disposed = false;
    let map3d: any = null;
    try {
      map3d = document.createElement('gmp-map-3d') as any;
      map3d.setAttribute('center', `${lat},${lng},0`);
      map3d.setAttribute('tilt', '65');
      map3d.setAttribute('heading', '0');
      map3d.setAttribute('range', '350');
      map3d.setAttribute('mode', 'hybrid');
      map3d.style.width = '100%';
      map3d.style.height = '100%';
      div.current.appendChild(map3d);
    } catch {
      threeDFailed.current = true;
      setMode('street');
      return;
    }
    const okNow = () =>
      Boolean((window as any).customElements?.get('gmp-map-3d')) && map3d.center !== undefined;
    let elapsed = 0;
    const check = setInterval(() => {
      if (disposed) { clearInterval(check); return; }
      elapsed += 200;
      if (okNow()) { clearInterval(check); elRef.current = map3d; setReady(true); }
      else if (elapsed >= 5000) {
        clearInterval(check);
        // 3D indisponible → on tente Street View avant d'abandonner.
        threeDFailed.current = true;
        setMode('street');
      }
    }, 200);
    return () => { disposed = true; clearInterval(check); try { map3d?.remove(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mode Street View (photos réelles) — initialisé au premier passage ──
  useEffect(() => {
    if (mode !== 'street' || street !== 'idle' || !streetDiv.current) return;
    setStreet('loading');

    const svc = new google.maps.StreetViewService();
    const giveUp = () => {
      setStreet('none');
      if (threeDFailed.current) onUnavailable();
    };
    const show = (data: google.maps.StreetViewPanoramaData) => {
      if (!data?.location?.latLng || !streetDiv.current) { giveUp(); return; }
      const panoPos = data.location.latLng;
      // Oriente la caméra vers la propriété, pas vers la rue.
      let heading = 0;
      try {
        heading = google.maps.geometry.spherical.computeHeading(panoPos, new google.maps.LatLng(lat, lng));
      } catch { /* geometry indisponible — heading par défaut */ }
      panoRef.current = new google.maps.StreetViewPanorama(streetDiv.current, {
        pano: data.location.pano,
        pov: { heading, pitch: 5 },
        zoom: 0.8,
        addressControl: false,
        fullscreenControl: false,
        motionTracking: false,
        motionTrackingControl: false,
      });
      setStreet('ok');
    };

    // Une tentative = un appel getPanorama avec garde-fou : si Google rejette la
    // requête en async (combinaison de paramètres refusée, promesse rejetée) ou
    // ne répond pas en 10 s, on passe à la suite au lieu de rester en chargement.
    const attempt = (extra: Record<string, unknown>, onFail: () => void) => {
      let settled = false;
      const settle = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
      const timer = setTimeout(() => settle(onFail), 10000);
      try {
        const req = { location: { lat, lng }, radius: 120, preference: 'nearest', ...extra } as unknown as google.maps.StreetViewLocationRequest;
        const maybePromise: any = svc.getPanorama(req, (data, status) => {
          if (String(status).toUpperCase() === 'OK') settle(() => show(data as google.maps.StreetViewPanoramaData));
          else settle(onFail);
        });
        maybePromise?.catch?.(() => settle(onFail));
      } catch {
        settle(onFail);
      }
    };

    // 1) Imagerie officielle Google extérieure (évite les photos sphères
    //    d'utilisateurs — observé au banc: un salon au lieu de la rue).
    // 2) Repli: extérieur simple. 3) Sinon: indisponible.
    attempt({ sources: ['google', 'outdoor'] }, () =>
      attempt({ source: 'outdoor' }, giveUp));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, street]);

  const tabBtn = (active: boolean) =>
    `px-2.5 py-1 text-[11px] font-bold transition-colors ${active ? 'bg-text-primary text-surface' : 'text-text-muted hover:text-text-primary'}`;

  return (
    <div className="fixed inset-0 z-[70] bg-background flex flex-col">
      <div className="h-12 border-b border-outline/20 flex items-center px-4 gap-3 bg-surface-card shrink-0">
        <span className="text-[13px] font-bold text-text-primary">{fr ? 'Visionneuse' : 'Viewer'}</span>
        <div className="flex items-center rounded-lg border border-outline/30 overflow-hidden shrink-0">
          <button onClick={() => setMode('3d')} className={tabBtn(mode === '3d')}>3D</button>
          <button onClick={() => setMode('street')} className={tabBtn(mode === 'street')}>Street View</button>
        </div>
        <span className="hidden md:flex items-center gap-1.5 text-[11px] text-text-tertiary min-w-0 truncate">
          <MoveVertical size={12} className="shrink-0" />
          {mode === 'street'
            ? (fr ? 'Photos réelles de la façade — idéal pour préparer la soumission.' : 'Real photos of the property — ideal when preparing the quote.')
            : (fr ? 'Visualisation — pour mesurer une hauteur en 3D, utilisez l’outil Hauteur.' : 'View only — to measure a height in 3D, use the Height tool.')}
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
        <div ref={div} className={`absolute inset-0 ${mode === '3d' ? '' : 'hidden'}`} />
        <div ref={streetDiv} className={`absolute inset-0 ${mode === 'street' ? '' : 'hidden'}`} />

        {mode === '3d' && !ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/80 z-10">
            <Loader2 size={28} className="animate-spin text-text-muted" />
          </div>
        )}
        {mode === 'street' && street === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/80 z-10">
            <Loader2 size={28} className="animate-spin text-text-muted" />
          </div>
        )}
        {mode === 'street' && street === 'none' && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <p className="text-[13px] text-text-secondary bg-surface-card border border-outline/30 rounded-xl px-4 py-3">
              {fr ? 'Street View n’est pas disponible à cette adresse.' : 'Street View is not available at this address.'}
            </p>
          </div>
        )}

        {mode === '3d' && ready && (
          <>
            <Cam3DControls getEl={() => elRef.current} fr={fr} className="absolute right-3 top-3 z-20" />
            <div className="absolute bottom-3 right-3 z-20 bg-gray-900/70 text-white/90 text-[10px] px-3 py-1.5 rounded-lg pointer-events-none backdrop-blur-sm hidden sm:block">
              {fr ? 'Glisser : déplacer · Ctrl+glisser : pivoter · Molette : zoom' : 'Drag: pan · Ctrl+drag: rotate · Scroll: zoom'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
