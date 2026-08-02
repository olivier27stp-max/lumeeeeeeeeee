/**
 * MeasureSidebar — Right panel listing all measurements for the current quote.
 * Rename inline, toggle visibility, delete, select to focus.
 */

import React from 'react';
import {
  Eye, EyeOff, X, Ruler, Pentagon, PenLine, ChevronRight, Mountain, MoveVertical,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Shape, UnitSystem } from '../../lib/measurementTypes';
import type { PredefinedService } from '../../lib/servicesApi';
import {
  formatLength, formatArea, haversineDistanceFt, formatElevation,
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
  /** Catalogue de services tarifés à la mesure ($/pi lin, $/pi²). */
  services?: PredefinedService[];
  onServicesChange?: (id: string, serviceIds: string[]) => void;
  fr: boolean;
}

const TYPE_ICON: Record<string, React.ElementType> = {
  line: Ruler, path: PenLine, polygon: Pentagon,
};

export default function MeasureSidebar({
  shapes, selectedId, unitSystem, onSelect, onRename,
  onToggleVisibility, onDelete, onNotesChange, services, onServicesChange, fr,
}: Props) {
  const fmtLen = (ft: number) => formatLength(ft, unitSystem);
  const fmtArea = (sqft: number) => formatArea(sqft, unitSystem);
  const fmtElev = (m: number) => formatElevation(m, unitSystem);

  const isHeight = (s: Shape) => s.metadata?.kind === 'height';

  // ── Services tarifés à la mesure ──
  const measurable = (services || []).filter(svc => svc.pricing_unit !== 'flat');
  const shapeServiceIds = (s: Shape): string[] => (s.metadata?.service_ids as string[] | undefined) || [];
  /** Quantité facturable d'un service sur une forme : pi² (zone), pi lin
   *  (chemin), ou PÉRIMÈTRE d'une zone pour un service linéaire. */
  const svcQty = (s: Shape, svc: PredefinedService): number =>
    svc.pricing_unit === 'sq_ft'
      ? (s.result.type === 'polygon' ? s.result.value : 0)
      : (s.result.type === 'polygon' ? (s.result.perimeterValue || 0) : s.result.value);
  const fmtMoney = (v: number) =>
    v.toLocaleString(fr ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
  const svcAmount = (s: Shape, svc: PredefinedService) => (svcQty(s, svc) * svc.default_price_cents) / 100;
  const estimatedTotal = shapes.reduce((acc, s) => {
    if (isHeight(s)) return acc;
    return acc + shapeServiceIds(s)
      .map(id => measurable.find(svc => svc.id === id))
      .filter((svc): svc is PredefinedService => !!svc)
      .reduce((a, svc) => a + svcAmount(s, svc), 0);
  }, 0);

  // Totals — exclude height shapes from the horizontal-length total (height is vertical).
  const totalLinear = shapes.filter(s => s.result.type !== 'polygon' && !isHeight(s)).reduce((a, s) => a + s.result.value, 0);
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
              const heightShape = isHeight(s);
              const Icon = heightShape ? MoveVertical : (TYPE_ICON[s.result.type] || Ruler);

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

                  {/* Height caption (the value above IS the building height) */}
                  {heightShape && (
                    <p className="text-[10px] text-text-muted mt-0.5 ml-[20px]">
                      {fr ? 'Hauteur du bâtiment (3D)' : 'Building height (3D)'}
                    </p>
                  )}

                  {/* Elevation / height delta — not for height shapes (redundant) */}
                  {s.result.elevation && !heightShape && (
                    <p className="text-[10px] text-text-muted mt-0.5 ml-[20px] flex items-center gap-1">
                      <Mountain size={10} className="shrink-0" />
                      {fr ? 'Dénivelé' : 'Elevation Δ'}: <span className="font-semibold text-text-secondary">{fmtElev(s.result.elevation.gain)}</span>
                      <span className="text-text-muted/60">({fmtElev(s.result.elevation.min)} – {fmtElev(s.result.elevation.max)})</span>
                    </p>
                  )}

                  {/* Segment breakdown (expanded) — not for height shapes */}
                  {sel && !heightShape && s.result.points.length >= 2 && (
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

                  {/* Per-point elevation (expanded) — not for height shapes */}
                  {sel && s.result.elevation && !heightShape && (
                    <div className="mt-2 ml-[20px] space-y-0.5">
                      <p className="text-[9px] text-text-muted/70 font-semibold uppercase tracking-wide">
                        {fr ? 'Élévation par point' : 'Per-point elevation'}
                      </p>
                      {s.result.points.map((p, i) =>
                        typeof p.elevation === 'number' ? (
                          <div key={i} className="text-[9px] text-text-muted font-mono flex items-center gap-1">
                            <Mountain size={8} className="shrink-0" />
                            {fr ? 'Pt' : 'Pt'} {i + 1}: {fmtElev(p.elevation)}
                          </div>
                        ) : null,
                      )}
                    </div>
                  )}

                  {/* Services tarifés à la mesure attachés à la forme */}
                  {!heightShape && onServicesChange && (() => {
                    const ids = shapeServiceIds(s);
                    const attached = ids
                      .map(id => measurable.find(svc => svc.id === id))
                      .filter((svc): svc is PredefinedService => !!svc);
                    const eligible = measurable.filter(svc =>
                      !ids.includes(svc.id) &&
                      (svc.pricing_unit === 'sq_ft' ? s.result.type === 'polygon' : true));
                    if (!attached.length && (!sel || !eligible.length)) return null;
                    return (
                      <div className="mt-2 ml-[20px] space-y-1" onClick={(e) => e.stopPropagation()}>
                        {attached.map(svc => (
                          <div key={svc.id} className="flex items-center gap-1.5 text-[10px]">
                            <span className="px-1.5 py-0.5 rounded-md bg-primary-lighter text-primary font-semibold truncate max-w-[130px]">{svc.name}</span>
                            <span className="text-text-muted font-mono">
                              {Math.round(svcQty(s, svc))} {svc.pricing_unit === 'sq_ft' ? 'pi²' : (fr ? 'pi lin' : 'lin ft')}
                              {svc.pricing_unit === 'linear_ft' && s.result.type === 'polygon' ? (fr ? ' (périm.)' : ' (perim.)') : ''}
                            </span>
                            <span className="font-mono font-bold text-text-primary ml-auto">{fmtMoney(svcAmount(s, svc))}</span>
                            <button
                              onClick={() => onServicesChange(s.id, ids.filter(id => id !== svc.id))}
                              className="p-0.5 text-text-muted hover:text-danger shrink-0">
                              <X size={11} />
                            </button>
                          </div>
                        ))}
                        {sel && eligible.length > 0 && (
                          <select
                            value=""
                            onChange={(e) => { if (e.target.value) onServicesChange(s.id, [...ids, e.target.value]); }}
                            className="w-full text-[10px] rounded-md border border-outline/30 bg-surface-card px-1.5 py-1 text-text-secondary"
                          >
                            <option value="">{fr ? '+ Ajouter un service…' : '+ Add a service…'}</option>
                            {eligible.map(svc => (
                              <option key={svc.id} value={svc.id}>
                                {svc.name} — {(svc.default_price_cents / 100).toFixed(2)} $ {svc.pricing_unit === 'sq_ft' ? '/pi²' : (fr ? '/pi lin' : '/lin ft')}
                                {svc.pricing_unit === 'linear_ft' && s.result.type === 'polygon' ? (fr ? ' (périmètre)' : ' (perimeter)') : ''}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })()}

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
          {estimatedTotal > 0 && (
            <div className="flex justify-between text-[10px] pt-1 border-t border-outline/20">
              <span className="text-text-muted font-semibold">{fr ? 'Services estimés' : 'Estimated services'}</span>
              <span className="font-mono font-bold text-text-primary">{fmtMoney(estimatedTotal)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
