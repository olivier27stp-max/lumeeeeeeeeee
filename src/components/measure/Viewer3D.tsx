/**
 * Viewer3D — visionneuse photoréaliste 3D (style Google Earth) de l'espace de
 * mesure. Visualisation seulement : les chemins/zones se dessinent sur la carte
 * 2D (clic fiable), et la hauteur en 3D passe par l'outil Hauteur. Si l'élément
 * <gmp-map-3d> ne s'initialise pas en 5 s, on prévient le parent (repli).
 */
import React, { useEffect, useRef, useState } from 'react';
import { X, Loader2, MoveVertical } from 'lucide-react';
import Cam3DControls from './Cam3DControls';

interface Props {
  lat: number;
  lng: number;
  fr: boolean;
  onClose: () => void;
  /** Le 3D n'a pas chargé — le parent ferme et retombe sur la vue inclinée. */
  onUnavailable: () => void;
}

export default function Viewer3D({ lat, lng, fr, onClose, onUnavailable }: Props) {
  const div = useRef<HTMLDivElement>(null);
  const elRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

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
      onUnavailable();
      return;
    }
    const okNow = () =>
      Boolean((window as any).customElements?.get('gmp-map-3d')) && map3d.center !== undefined;
    let elapsed = 0;
    const check = setInterval(() => {
      if (disposed) { clearInterval(check); return; }
      elapsed += 200;
      if (okNow()) { clearInterval(check); elRef.current = map3d; setReady(true); }
      else if (elapsed >= 5000) { clearInterval(check); onUnavailable(); }
    }, 200);
    return () => { disposed = true; clearInterval(check); try { map3d?.remove(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[70] bg-background flex flex-col">
      <div className="h-12 border-b border-outline/20 flex items-center px-4 gap-3 bg-surface-card shrink-0">
        <span className="text-[13px] font-bold text-text-primary">{fr ? 'Vue 3D' : '3D view'}</span>
        <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-text-tertiary min-w-0 truncate">
          <MoveVertical size={12} className="shrink-0" />
          {fr
            ? 'Visualisation — pour mesurer une hauteur en 3D, utilisez l’outil Hauteur.'
            : 'View only — to measure a height in 3D, use the Height tool.'}
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
        {ready && (
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
