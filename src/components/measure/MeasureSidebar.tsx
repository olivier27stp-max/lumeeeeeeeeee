/**
 * MeasureSidebar — Right panel listing all measurements for the current quote.
 * Rename inline, toggle visibility, delete, select to focus.
 */

import React from 'react';
import {
  Eye, EyeOff, X, Ruler, Pentagon, PenLine, ChevronRight,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Shape, UnitSystem } from '../../lib/measurementTypes';
import {
  formatLength, formatArea, haversineDistanceFt,
} from '../../lib/measurementEngine';

interface Props {
  shapes: Shape[];
  selectedId: string | null;
  unitSystem: UnitSystem;
  onSelect: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onToggleVisibility: (id: string) => void;
  onDelete: (id: string) => void;
  onNotesChange: (id: string, notes: string) => void;
  fr: boolean;
}

const TYPE_ICON: Record<string, React.ElementType> = {
  line: Ruler, path: PenLine, polygon: Pentagon,
};

export default function MeasureSidebar({
  shapes, selectedId, unitSystem, onSelect, onRename,
  onToggleVisibility, onDelete, onNotesChange, fr,
}: Props) {
  const fmtLen = (ft: number) => formatLength(ft, unitSystem);
  const fmtArea = (sqft: number) => formatArea(sqft, unitSystem);

  // Totals
  const totalLinear = shapes.filter(s => s.result.type !== 'polygon').reduce((a, s) => a + s.result.value, 0);
  const totalArea = shapes.filter(s => s.result.type === 'polygon').reduce((a, s) => a + s.result.value, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-outline/20 flex items-center justify-between shrink-0">
        <h3 className="text-[13px] font-bold text-text-primary">{fr ? 'Mesures' : 'Measurements'}</h3>
        <span className="text-[11px] text-text-muted font-medium bg-surface-secondary px-2 py-0.5 rounded-md">{shapes.length}</span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {shapes.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Ruler size={28} className="mx-auto mb-3 text-text-muted/30" />
            <p className="text-[12px] text-text-muted font-medium">{fr ? 'Aucune mesure' : 'No measurements'}</p>
            <p className="text-[10px] text-text-muted/60 mt-1">{fr ? 'Utilisez les outils à gauche' : 'Use tools on the left'}</p>
          </div>
        ) : (
          <div className="divide-y divide-outline/10">
            {shapes.map((s) => {
              const sel = s.id === selectedId;
              const Icon = TYPE_ICON[s.result.type] || Ruler;

              return (
                <div
                  key={s.id}
                  onClick={() => onSelect(s.id)}
                  className={cn(
                    'px-4 py-3 cursor-pointer transition-colors',
                    sel ? 'bg-surface-secondary' : 'hover:bg-surface-secondary/40',
                  )}
                >
                  {/* Top row: color dot + label + actions */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <input
                      value={s.label}
                      onChange={(e) => onRename(s.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="text-[12px] font-semibold bg-transparent border-none outline-none flex-1 min-w-0 text-text-primary"
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleVisibility(s.id); }}
                      className="p-0.5 text-text-muted hover:text-text-primary shrink-0"
                    >
                      {s.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                      className="p-0.5 text-text-muted hover:text-danger shrink-0"
                    >
                      <X size={13} />
                    </button>
                  </div>

                  {/* Value */}
                  <div className="flex items-center gap-2">
                    <Icon size={12} className="text-text-muted shrink-0" />
                    <span className="text-[13px] font-mono font-bold" style={{ color: s.color }}>
                      {s.result.type === 'polygon' ? fmtArea(s.result.value) : fmtLen(s.result.value)}
                    </span>
                  </div>

                  {/* Polygon perimeter */}
                  {s.result.type === 'polygon' && s.result.perimeterValue != null && (
                    <p className="text-[10px] text-text-muted mt-0.5 ml-[20px]">
                      {fr ? 'Périmètre' : 'Perimeter'}: {fmtLen(s.result.perimeterValue)}
                    </p>
                  )}

                  {/* Segment breakdown (expanded) */}
                  {sel && s.result.points.length >= 2 && (
                    <div className="mt-2 ml-[20px] space-y-0.5">
                      {s.result.points.map((_, i) => {
                        const j = s.result.type === 'polygon' ? (i + 1) % s.result.points.length : i + 1;
                        if (j >= s.result.points.length && s.result.type !== 'polygon') return null;
                        const d = haversineDistanceFt(s.result.points[i], s.result.points[j]);
                        return (
                          <div key={i} className="text-[9px] text-text-muted font-mono flex items-center gap-1">
                            <ChevronRight size={8} className="shrink-0" />
                            Seg {i + 1}: {fmtLen(d)}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Notes (expanded) */}
                  {sel && (
                    <textarea
                      value={s.notes}
                      onChange={(e) => onNotesChange(s.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      placeholder={fr ? 'Notes...' : 'Notes...'}
                      rows={2}
                      className="mt-2 w-full text-[11px] rounded-lg border border-outline/30 bg-surface-card px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-text-primary/30 text-text-secondary placeholder:text-text-muted/40"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Totals footer */}
      {shapes.length > 0 && (
        <div className="px-4 py-2.5 border-t border-outline/20 bg-surface-secondary/50 shrink-0 space-y-1">
          {totalLinear > 0 && (
            <div className="flex justify-between text-[10px]">
              <span className="text-text-muted">{fr ? 'Total linéaire' : 'Total linear'}</span>
              <span className="font-mono font-semibold text-text-primary">{fmtLen(totalLinear)}</span>
            </div>
          )}
          {totalArea > 0 && (
            <div className="flex justify-between text-[10px]">
              <span className="text-text-muted">{fr ? 'Total superficie' : 'Total area'}</span>
              <span className="font-mono font-semibold text-text-primary">{fmtArea(totalArea)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
