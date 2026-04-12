import React from 'react';
import { Check, Eye, Star } from 'lucide-react';
import type { QuoteLayoutType } from './types';

const TEMPLATES = [
  { id: 'minimal_pro', name: 'Minimal Pro', desc: 'Clean & premium, black/white', accent: '#111' },
  { id: 'modern_card', name: 'Modern Card', desc: 'Card sections, SaaS feel', accent: '#2563eb' },
  { id: 'premium_detailed', name: 'Premium Detailed', desc: 'Executive, full breakdown', accent: '#171717' },
] as const;

interface Props {
  selectedLayout: QuoteLayoutType;
  onSelect: (layout: QuoteLayoutType) => void;
  defaultLayout?: QuoteLayoutType | null;
  onSetDefault?: (layout: QuoteLayoutType) => void;
  onPreview?: (layout: QuoteLayoutType) => void;
}

export default function QuoteLayoutPicker({ selectedLayout, onSelect, defaultLayout, onSetDefault, onPreview }: Props) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-widest text-text-secondary">Quote Template</p>
      <div className="grid grid-cols-3 gap-2.5">
        {TEMPLATES.map(tpl => {
          const isSelected = selectedLayout === tpl.id;
          const isDefault = defaultLayout === tpl.id;
          return (
            <div key={tpl.id} className="relative">
              <button
                type="button"
                onClick={() => onSelect(tpl.id as QuoteLayoutType)}
                className={`w-full relative flex flex-col items-center rounded-xl border-2 p-3 transition-all ${
                  isSelected ? 'border-primary bg-primary/5 shadow-sm' : 'border-transparent bg-surface-secondary hover:border-outline hover:bg-surface-secondary/80'
                }`}
              >
                {isSelected && (
                  <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-white"><Check size={10} /></span>
                )}
                {isDefault && (
                  <span className="absolute left-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-white"><Star size={8} /></span>
                )}
                {/* Mini preview */}
                <div className="mb-2 flex h-20 w-full items-center justify-center rounded-lg overflow-hidden" style={{ backgroundColor: tpl.accent + '06' }}>
                  {tpl.id === 'minimal_pro' && (
                    <div className="flex flex-col items-stretch w-full h-full px-2 pt-2">
                      <div className="flex justify-between items-start"><div className="h-1 w-8 rounded bg-gray-300" /><div className="h-1.5 w-6 rounded bg-gray-200" /></div>
                      <div className="mt-2 h-4 w-full rounded-sm border border-gray-200 bg-gray-50 flex items-center justify-between px-1.5"><div className="h-0.5 w-6 rounded bg-gray-300" /><div className="h-1 w-8 rounded bg-gray-400" /></div>
                      <div className="mt-1.5 space-y-0.5 flex-1"><div className="h-0.5 w-full rounded bg-gray-200" /><div className="h-0.5 w-full rounded bg-gray-100" /><div className="h-0.5 w-full rounded bg-gray-200" /></div>
                      <div className="flex justify-end mt-auto mb-1"><div className="h-1.5 w-8 rounded bg-gray-800" /></div>
                    </div>
                  )}
                  {tpl.id === 'modern_card' && (
                    <div className="flex flex-col items-stretch w-full h-full">
                      <div className="h-1" style={{ background: `linear-gradient(90deg, ${tpl.accent}, ${tpl.accent}80)` }} />
                      <div className="px-2 pt-1.5 space-y-1 flex-1">
                        <div className="h-3 w-full rounded-sm bg-white border border-gray-200" />
                        <div className="grid grid-cols-2 gap-1"><div className="h-4 rounded-sm bg-white border border-gray-200" /><div className="h-4 rounded-sm bg-white border border-gray-200" /></div>
                        <div className="h-5 w-full rounded-sm bg-white border border-gray-200"><div className="h-0.5 w-full rounded-t" style={{ backgroundColor: tpl.accent }} /></div>
                      </div>
                    </div>
                  )}
                  {tpl.id === 'premium_detailed' && (
                    <div className="flex flex-col items-stretch w-full h-full">
                      <div className="h-5 px-2 flex items-center justify-between" style={{ backgroundColor: tpl.accent }}><div className="h-1 w-8 rounded bg-white/40" /><div className="h-1 w-6 rounded bg-white/30" /></div>
                      <div className="px-2 pt-1.5 space-y-1 flex-1">
                        <div className="h-0.5 w-10 rounded bg-gray-300" /><div className="h-0.5 w-6 rounded bg-gray-200" />
                        <div className="h-3 w-full rounded-sm"><div className="h-0.5 w-full rounded-t" style={{ backgroundColor: tpl.accent }} /><div className="h-0.5 w-full rounded bg-gray-100 mt-0.5" /></div>
                        <div className="flex justify-end"><div className="h-1.5 w-10 rounded" style={{ backgroundColor: tpl.accent }} /></div>
                      </div>
                    </div>
                  )}
                </div>
                <p className="text-[11px] font-semibold text-text-primary">{tpl.name}</p>
                <p className="text-[9px] text-text-tertiary">{tpl.desc}</p>
              </button>
              {/* Actions */}
              <div className="flex items-center justify-center gap-1.5 mt-1.5">
                {onPreview && (
                  <button type="button" onClick={() => onPreview(tpl.id as QuoteLayoutType)}
                    className="flex items-center gap-1 text-[10px] text-text-tertiary hover:text-text-primary transition-colors">
                    <Eye size={10} /> Preview
                  </button>
                )}
                {onSetDefault && !isDefault && (
                  <button type="button" onClick={() => onSetDefault(tpl.id as QuoteLayoutType)}
                    className="flex items-center gap-1 text-[10px] text-text-tertiary hover:text-amber-500 transition-colors">
                    <Star size={10} /> Set default
                  </button>
                )}
                {isDefault && <span className="text-[10px] text-amber-500 font-medium">Default</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
