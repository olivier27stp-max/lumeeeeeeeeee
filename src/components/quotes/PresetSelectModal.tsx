import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileText, Loader2, Package, X, ChevronRight, Plus, Image as ImageIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { listQuotePresets } from '../../lib/quotePresetsApi';
import type { QuotePreset } from '../../types';

interface PresetSelectModalProps {
  isOpen: boolean;
  isFr: boolean;
  onSelectPreset: (preset: QuotePreset) => void;
  onStartFromScratch: () => void;
  onCreatePreset: () => void;
  onClose: () => void;
}

function PresetPreviewPanel({ preset }: { preset: QuotePreset }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      className="border-t border-outline bg-surface-secondary/30 p-4 space-y-3"
    >
      {/* Cover image */}
      {preset.cover_image && (
        <div className="rounded-lg overflow-hidden h-24 bg-surface-tertiary">
          <img src={preset.cover_image} alt="" className="w-full h-full object-cover" />
        </div>
      )}

      {/* Description / Intro */}
      {preset.intro_text && (
        <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-3">{preset.intro_text}</p>
      )}

      {/* Service lines preview */}
      {preset.services.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">Services</p>
          {preset.services.slice(0, 4).map((s) => (
            <div key={s.id} className="flex items-center justify-between text-[11px]">
              <span className={cn('text-text-secondary truncate flex-1', s.is_optional && 'italic opacity-60')}>
                {s.name}{s.is_optional ? ' (opt.)' : ''}
              </span>
              <span className="text-text-tertiary ml-2 shrink-0">x{s.quantity}</span>
            </div>
          ))}
          {preset.services.length > 4 && (
            <p className="text-[10px] text-text-tertiary">+{preset.services.length - 4} more</p>
          )}
        </div>
      )}

      {/* Notes */}
      {preset.notes && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">Notes</p>
          <p className="text-[11px] text-text-secondary line-clamp-2 mt-0.5">{preset.notes}</p>
        </div>
      )}
    </motion.div>
  );
}

export default function PresetSelectModal({
  isOpen, isFr, onSelectPreset, onStartFromScratch, onCreatePreset, onClose,
}: PresetSelectModalProps) {
  const [presets, setPresets] = useState<QuotePreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    listQuotePresets(true)
      .then(setPresets)
      .catch(() => setPresets([]))
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        onClick={(e) => e.stopPropagation()}
        className="modal-content max-w-lg max-h-[85vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
          <div>
            <h2 className="text-[16px] font-bold text-text-primary">
              {isFr ? 'Nouveau devis' : 'New Quote'}
            </h2>
            <p className="text-[12px] text-text-tertiary mt-0.5">
              {isFr ? 'Choisissez un preset ou créez de zéro.' : 'Choose a preset or start from scratch.'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-secondary text-text-tertiary">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-3">
          {/* Create from scratch */}
          <button onClick={onStartFromScratch}
            className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-dashed border-outline hover:border-primary/40 hover:bg-primary/5 transition-all text-left group">
            <div className="w-10 h-10 rounded-xl bg-surface-secondary group-hover:bg-primary/10 flex items-center justify-center transition-colors shrink-0">
              <FileText size={18} className="text-text-tertiary group-hover:text-primary transition-colors" />
            </div>
            <div className="flex-1">
              <p className="text-[14px] font-semibold text-text-primary">
                {isFr ? 'Devis vierge' : 'Blank Quote'}
              </p>
              <p className="text-[11px] text-text-tertiary">
                {isFr ? 'Commencer de zéro' : 'Start with a clean slate'}
              </p>
            </div>
            <ChevronRight size={14} className="text-text-tertiary group-hover:text-primary transition-colors" />
          </button>

          {/* Presets */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-text-tertiary" />
            </div>
          ) : presets.length === 0 ? (
            <div className="text-center py-6 text-[12px] text-text-tertiary">
              {isFr ? 'Aucun preset disponible.' : 'No presets available.'}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary px-1 mb-1.5">
                {isFr ? 'Presets disponibles' : 'Available Presets'}
              </p>
              {presets.map((preset) => {
                const serviceCount = preset.services.length;

                return (
                  <div key={preset.id} className="rounded-xl border border-outline overflow-hidden">
                    <button
                      onClick={() => onSelectPreset(preset)}
                      onMouseEnter={() => setHoveredId(preset.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      className="w-full flex items-center gap-3 p-3 hover:bg-primary/5 transition-all text-left group"
                    >
                      {/* Cover image or icon */}
                      {preset.cover_image ? (
                        <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0">
                          <img src={preset.cover_image} alt="" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                          <Package size={16} className="text-primary" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-text-primary truncate">{preset.name}</p>
                        <div className="flex items-center gap-3 mt-0.5 text-[11px] text-text-tertiary">
                          <span className="flex items-center gap-1">
                            <Package size={10} />
                            {serviceCount} {serviceCount !== 1 ? 'services' : 'service'}
                          </span>
                          {preset.images.length > 0 && (
                            <span className="flex items-center gap-1">
                              <ImageIcon size={10} />
                              {preset.images.length}
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight size={14} className="text-text-tertiary group-hover:text-primary transition-colors shrink-0" />
                    </button>
                    <AnimatePresence>
                      {hoveredId === preset.id && <PresetPreviewPanel preset={preset} />}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          )}

          {/* Create new preset */}
          <div className="pt-2 border-t border-outline/50">
            <button onClick={onCreatePreset}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-[12px] font-medium text-primary hover:text-primary-hover transition-colors">
              <Plus size={14} />
              {isFr ? 'Créer un nouveau preset' : 'Create New Preset'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
