/**
 * Cam3DControls — contrôles caméra à l'écran pour <gmp-map-3d> (bêta Google).
 * Les gestes natifs existent (glisser = déplacer, Ctrl+glisser = pivoter,
 * molette = zoom) mais sont peu découvrables; ces boutons pilotent la caméra
 * orbitale (center/range/heading/tilt) directement. Le zoom rapproché force
 * aussi le raffinement des tuiles photoréalistes (sinon c'est flou au loin).
 */
import React from 'react';
import { Plus, Minus, RotateCw, RotateCcw, Mountain } from 'lucide-react';

interface Props {
  /** Retourne l'élément gmp-map-3d actif (ou null). */
  getEl: () => any;
  fr: boolean;
  className?: string;
}

export default function Cam3DControls({ getEl, fr, className = '' }: Props) {
  const mutate = (fn: (el: any) => void) => {
    const el = getEl();
    if (!el) return;
    try { fn(el); } catch { /* bêta — propriété indisponible */ }
  };

  const btn = 'w-9 h-9 flex items-center justify-center rounded-lg bg-surface/95 backdrop-blur-sm border border-outline/30 text-text-primary hover:bg-surface-secondary transition-colors shadow-md';

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <button className={btn} title={fr ? 'Zoomer' : 'Zoom in'}
        onClick={() => mutate(el => { el.range = Math.max(40, (Number(el.range) || 300) * 0.55); })}>
        <Plus size={16} />
      </button>
      <button className={btn} title={fr ? 'Dézoomer' : 'Zoom out'}
        onClick={() => mutate(el => { el.range = Math.min(20000, (Number(el.range) || 300) / 0.55); })}>
        <Minus size={16} />
      </button>
      <button className={btn} title={fr ? 'Pivoter à gauche' : 'Rotate left'}
        onClick={() => mutate(el => { el.heading = ((Number(el.heading) || 0) - 30 + 360) % 360; })}>
        <RotateCcw size={16} />
      </button>
      <button className={btn} title={fr ? 'Pivoter à droite' : 'Rotate right'}
        onClick={() => mutate(el => { el.heading = ((Number(el.heading) || 0) + 30) % 360; })}>
        <RotateCw size={16} />
      </button>
      <button className={btn} title={fr ? 'Incliner (vue oblique ↔ plongée)' : 'Tilt (oblique ↔ top-down)'}
        onClick={() => mutate(el => { el.tilt = (Number(el.tilt) || 0) > 40 ? 15 : 67; })}>
        <Mountain size={16} />
      </button>
    </div>
  );
}
