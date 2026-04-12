/**
 * MeasureToolbar — Left-side tool selector for the measurement workspace.
 * Compact, icon-driven, keyboard-shortcut labeled.
 */

import React from 'react';
import {
  Move, Ruler, PenLine, Pentagon, RotateCcw, Trash2, Copy,
} from 'lucide-react';
import type { Tool } from '../../lib/measurementTypes';

interface Props {
  tool: Tool;
  onToolChange: (t: Tool) => void;
  onUndo: () => void;
  onClearAll: () => void;
  onDuplicateSelected: () => void;
  hasPoints: boolean;
  hasShapes: boolean;
  hasSelection: boolean;
  fr: boolean;
}

const TOOLS: { t: Tool; icon: React.ElementType; label: string; labelFr: string; key: string }[] = [
  { t: 'select', icon: Move, label: 'Select', labelFr: 'Sélection', key: '1' },
  { t: 'line', icon: Ruler, label: 'Line', labelFr: 'Ligne', key: '2' },
  { t: 'path', icon: PenLine, label: 'Path', labelFr: 'Chemin', key: '3' },
  { t: 'polygon', icon: Pentagon, label: 'Area', labelFr: 'Zone', key: '4' },
];

export default function MeasureToolbar({
  tool, onToolChange, onUndo, onClearAll, onDuplicateSelected,
  hasPoints, hasShapes, hasSelection, fr,
}: Props) {
  return (
    <div className="w-[56px] border-r border-outline/20 bg-surface-card flex flex-col items-center py-3 gap-0.5 shrink-0 z-10">
      <p className="text-[8px] font-bold text-text-muted uppercase tracking-widest mb-1.5">
        {fr ? 'Outils' : 'Tools'}
      </p>

      {TOOLS.map(({ t, icon: I, label, labelFr, key }) => (
        <button
          key={t}
          onClick={() => onToolChange(t)}
          className={`w-[46px] flex flex-col items-center gap-[2px] py-2 rounded-lg transition-all ${
            tool === t
              ? 'bg-text-primary text-surface shadow-sm'
              : 'text-text-muted hover:bg-surface-secondary hover:text-text-primary'
          }`}
          title={`${fr ? labelFr : label} (${key})`}
        >
          <I size={18} strokeWidth={tool === t ? 2.5 : 1.8} />
          <span className="text-[8px] font-semibold leading-none">{fr ? labelFr : label}</span>
          <span className={`text-[7px] leading-none ${tool === t ? 'text-surface/60' : 'text-text-muted/50'}`}>{key}</span>
        </button>
      ))}

      <div className="w-8 border-t border-outline/20 my-2" />

      <button
        onClick={onUndo}
        disabled={!hasPoints}
        className="w-[46px] flex flex-col items-center gap-[2px] py-1.5 rounded-lg text-text-muted hover:bg-surface-secondary disabled:opacity-20 transition-all"
        title={`${fr ? 'Annuler' : 'Undo'} (⌫)`}
      >
        <RotateCcw size={15} />
        <span className="text-[8px] font-medium">{fr ? 'Annuler' : 'Undo'}</span>
      </button>

      {hasSelection && (
        <button
          onClick={onDuplicateSelected}
          className="w-[46px] flex flex-col items-center gap-[2px] py-1.5 rounded-lg text-text-muted hover:bg-surface-secondary transition-all"
          title={fr ? 'Dupliquer' : 'Duplicate'}
        >
          <Copy size={15} />
          <span className="text-[8px] font-medium">{fr ? 'Copier' : 'Copy'}</span>
        </button>
      )}

      <button
        onClick={onClearAll}
        disabled={!hasShapes && !hasPoints}
        className="w-[46px] flex flex-col items-center gap-[2px] py-1.5 rounded-lg text-text-muted hover:bg-danger-light hover:text-danger disabled:opacity-20 transition-all"
        title={fr ? 'Tout effacer' : 'Clear all'}
      >
        <Trash2 size={15} />
        <span className="text-[8px] font-medium">{fr ? 'Effacer' : 'Clear'}</span>
      </button>
    </div>
  );
}
