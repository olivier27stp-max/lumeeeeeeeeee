import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  FileText, Loader2, X, Plus, Check, Image as ImageIcon, Package,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { listQuotePresets } from '../../lib/quotePresetsApi';
import { presetGradient } from '../../lib/presetPalette';
import type { QuotePreset } from '../../types';

interface PresetSelectModalProps {
  isOpen: boolean;
  isFr: boolean;
  onSelectPreset: (preset: QuotePreset) => void;
  onStartFromScratch: () => void;
  onCreatePreset: () => void;
  onClose: () => void;
}

// La palette des 15 dégradés vit dans lib/presetPalette.ts (partagée avec la
// vue Jour du calendrier Dispatch — même source de vérité).

const BLANK_ID = '__blank__';

export default function PresetSelectModal({
  isOpen, isFr, onSelectPreset, onStartFromScratch, onCreatePreset, onClose,
}: PresetSelectModalProps) {
  const [presets, setPresets] = useState<QuotePreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>(BLANK_ID);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    listQuotePresets(true)
      .then((list) => {
        setPresets(list);
        // « Devis vierge » sélectionné par défaut — aucun preset pré-choisi.
        setSelectedId(BLANK_ID);
      })
      .catch(() => setPresets([]))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const selectedIndex = useMemo(
    () => presets.findIndex((p) => p.id === selectedId),
    [presets, selectedId],
  );
  const selected = selectedIndex >= 0 ? presets[selectedIndex] : null;

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (selected) onSelectPreset(selected);
    else onStartFromScratch();
  };

  const outline = 'border-[#e8e8e8] dark:border-white/10';
  const hoverFill = 'hover:bg-[#f5f5f5] dark:hover:bg-[#1c1c1f]';

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-full max-w-[780px] max-h-[86vh] flex flex-col overflow-hidden rounded-[20px] border bg-white dark:bg-[#0e0e11] shadow-[0_24px_64px_rgba(0,0,0,0.25)]',
          outline,
        )}
      >
        {/* Header */}
        <div className={cn('px-6 pt-[22px] pb-[18px] flex items-start justify-between border-b', outline)}>
          <div>
            <h2 className="text-[17px] font-extrabold tracking-[-0.2px] text-black dark:text-white">
              {isFr ? 'Nouveau devis' : 'New Quote'}
            </h2>
            <p className="text-[12.5px] mt-[3px] text-black dark:text-white">
              {isFr ? "Choisissez un modèle ou partez d'une page blanche." : 'Choose a preset or start from a blank page.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className={cn('w-[30px] h-[30px] rounded-lg flex items-center justify-center text-black dark:text-white', hoverFill)}
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Colonne gauche — choix */}
          <div className={cn('w-[316px] shrink-0 border-r overflow-y-auto p-3.5 pt-4 flex flex-col gap-1.5', outline)}>
            <button
              onClick={() => setSelectedId(BLANK_ID)}
              className={cn(
                'w-full flex items-center gap-3 p-2.5 rounded-xl border-[1.5px] text-left transition-colors',
                selectedId === BLANK_ID
                  ? 'border-black dark:border-white bg-[#f5f5f5] dark:bg-[#1c1c1f]'
                  : cn('border-transparent', hoverFill),
              )}
            >
              <div className={cn('w-10 h-10 rounded-[10px] border flex items-center justify-center shrink-0', outline)}>
                <FileText size={16} className="text-black dark:text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-bold leading-tight text-black dark:text-white">
                  {isFr ? 'Devis vierge' : 'Blank Quote'}
                </p>
                <p className="text-[11.5px] mt-0.5 text-black dark:text-white">
                  {isFr ? 'Partir de zéro' : 'Start from scratch'}
                </p>
              </div>
              <Check size={14} className={cn('shrink-0 text-black dark:text-white', selectedId === BLANK_ID ? 'opacity-100' : 'opacity-0')} />
            </button>

            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 size={20} className="animate-spin text-black dark:text-white" />
              </div>
            ) : presets.length === 0 ? (
              <p className="text-center py-8 text-[12px] text-black dark:text-white">
                {isFr ? 'Aucun modèle disponible.' : 'No presets available.'}
              </p>
            ) : (
              <>
                <p className="text-[10px] font-extrabold uppercase tracking-[1.4px] px-2 pt-3 pb-1 text-black dark:text-white">
                  {isFr ? 'Modèles' : 'Presets'}
                </p>
                {presets.map((preset, i) => {
                  const isSelected = selectedId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      onClick={() => setSelectedId(preset.id)}
                      className={cn(
                        'w-full flex items-center gap-3 p-2.5 rounded-xl border-[1.5px] text-left transition-colors',
                        isSelected
                          ? 'border-black dark:border-white bg-[#f5f5f5] dark:bg-[#1c1c1f]'
                          : cn('border-transparent', hoverFill),
                      )}
                    >
                      {preset.cover_image ? (
                        <img src={preset.cover_image} alt="" className="w-10 h-10 rounded-[10px] object-cover shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-[10px] shrink-0" style={{ background: presetGradient(i) }} />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[13.5px] font-bold leading-tight truncate text-black dark:text-white">{preset.name}</p>
                        <p className="text-[11.5px] mt-0.5 flex items-center gap-2 text-black dark:text-white">
                          <span className="flex items-center gap-1">
                            <Package size={10} />
                            {preset.services.length} service{preset.services.length !== 1 ? 's' : ''}
                          </span>
                          {preset.images.length > 0 && (
                            <span className="flex items-center gap-1">
                              <ImageIcon size={10} />
                              {preset.images.length}
                            </span>
                          )}
                        </p>
                      </div>
                      <Check size={14} className={cn('shrink-0 text-black dark:text-white', isSelected ? 'opacity-100' : 'opacity-0')} />
                    </button>
                  );
                })}
              </>
            )}
          </div>

          {/* Colonne droite — aperçu */}
          <div className="flex-1 overflow-y-auto bg-[#fafafa] dark:bg-[#131316] px-[22px] py-5">
            {selected ? (
              <>
                {selected.cover_image ? (
                  <div className="h-[110px] rounded-xl mb-4 overflow-hidden">
                    <img src={selected.cover_image} alt="" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="h-[110px] rounded-xl mb-4" style={{ background: presetGradient(selectedIndex) }} />
                )}
                <p className="text-[16px] font-extrabold tracking-[-0.2px] text-black dark:text-white">{selected.name}</p>
                {selected.intro_text && (
                  <p className="text-[12.5px] leading-[1.55] mt-1.5 text-black dark:text-white">{selected.intro_text}</p>
                )}
                {selected.services.length > 0 && (
                  <>
                    <p className="text-[10px] font-extrabold uppercase tracking-[1.4px] mt-[18px] mb-2 text-black dark:text-white">Services</p>
                    {selected.services.map((s, i) => (
                      <div
                        key={s.id}
                        className={cn(
                          'flex items-center justify-between py-2 text-[12.5px] text-black dark:text-white border-b',
                          outline,
                          i === selected.services.length - 1 && 'border-b-0',
                        )}
                      >
                        <span className={cn('truncate flex-1', s.is_optional ? 'italic font-normal' : 'font-semibold')}>
                          {s.name}{s.is_optional ? ' (opt.)' : ''}
                        </span>
                        <span className="ml-3 shrink-0 tabular-nums">x{s.quantity}</span>
                      </div>
                    ))}
                  </>
                )}
                {selected.notes && (
                  <>
                    <p className="text-[10px] font-extrabold uppercase tracking-[1.4px] mt-[18px] mb-2 text-black dark:text-white">Notes</p>
                    <p className="text-[12px] leading-[1.5] text-black dark:text-white">{selected.notes}</p>
                  </>
                )}
              </>
            ) : (
              <>
                <div className={cn('h-[110px] rounded-xl mb-4 border-[1.5px] border-dashed flex items-center justify-center', outline)}>
                  <span className="text-[12px] font-medium text-black dark:text-white">
                    {isFr ? 'Aucun contenu pré-rempli' : 'No pre-filled content'}
                  </span>
                </div>
                <p className="text-[16px] font-extrabold tracking-[-0.2px] text-black dark:text-white">
                  {isFr ? 'Devis vierge' : 'Blank Quote'}
                </p>
                <p className="text-[12.5px] leading-[1.55] mt-1.5 text-black dark:text-white">
                  {isFr
                    ? 'Commencez avec un devis vide — ajoutez vos services, images et conditions manuellement.'
                    : 'Start with an empty quote — add your services, images and terms manually.'}
                </p>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className={cn('px-5 py-3.5 flex items-center justify-between border-t', outline)}>
          <button
            onClick={onCreatePreset}
            className={cn('h-[38px] px-3.5 rounded-[10px] border inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-black dark:text-white', outline, hoverFill)}
          >
            <Plus size={14} />
            {isFr ? 'Créer un nouveau modèle' : 'Create New Preset'}
          </button>
          <button
            onClick={handleConfirm}
            className="h-[38px] px-[22px] rounded-[10px] text-[13px] font-bold bg-black text-white dark:bg-white dark:text-black active:scale-[0.98] transition-transform"
          >
            {selected
              ? (isFr ? 'Utiliser ce modèle' : 'Use this preset')
              : (isFr ? 'Créer le devis' : 'Create quote')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
