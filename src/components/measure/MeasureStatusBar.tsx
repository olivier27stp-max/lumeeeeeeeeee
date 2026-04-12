/**
 * MeasureStatusBar — Bottom info bar showing unit system toggle and current state.
 */

import React from 'react';
import { Globe } from 'lucide-react';
import type { Tool, UnitSystem } from '../../lib/measurementTypes';

interface Props {
  tool: Tool;
  pointCount: number;
  unitSystem: UnitSystem;
  onUnitToggle: () => void;
  tilt3d: boolean;
  onTiltToggle: () => void;
  fr: boolean;
}

export default function MeasureStatusBar({
  tool, pointCount, unitSystem, onUnitToggle, tilt3d, onTiltToggle, fr,
}: Props) {
  const toolLabel = {
    select: fr ? 'Sélection' : 'Select',
    line: fr ? 'Ligne (2 pts)' : 'Line (2 pts)',
    path: fr ? 'Chemin' : 'Path',
    polygon: fr ? 'Zone / Surface' : 'Area / Polygon',
  }[tool];

  const hint = tool === 'select'
    ? (fr ? 'Cliquez une mesure pour la sélectionner' : 'Click a measurement to select')
    : tool === 'line'
      ? (fr ? 'Cliquez 2 points' : 'Click 2 points')
      : (fr ? `${pointCount} pt${pointCount !== 1 ? 's' : ''} — Enter ou double-clic pour terminer` : `${pointCount} pt${pointCount !== 1 ? 's' : ''} — Enter or double-click to finish`);

  return (
    <div className="h-8 border-t border-outline/20 bg-surface-card flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-3 text-[10px] text-text-muted">
        <span className="font-semibold text-text-secondary">{toolLabel}</span>
        <span className="text-text-muted/50">|</span>
        <span>{hint}</span>
      </div>

      <div className="flex items-center gap-2">
        {/* 3D toggle */}
        <button
          onClick={onTiltToggle}
          className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
            tilt3d ? 'bg-text-primary text-surface' : 'bg-surface-secondary text-text-muted hover:text-text-primary'
          }`}
          title={tilt3d ? '2D' : '3D'}
        >
          3D
        </button>

        {/* Unit toggle */}
        <button
          onClick={onUnitToggle}
          className="px-2 py-0.5 rounded bg-surface-secondary text-[10px] font-bold text-text-muted hover:text-text-primary transition-colors"
          title={fr ? 'Changer les unités' : 'Toggle units'}
        >
          {unitSystem === 'imperial' ? 'ft / sq ft' : 'm / m²'}
        </button>
      </div>
    </div>
  );
}
