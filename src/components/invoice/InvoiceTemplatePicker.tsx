import React from 'react';
import { Check, Layout } from 'lucide-react';
import type { InvoiceLayoutType } from './types';
import { useTranslation } from '../../i18n';

interface TemplateOption {
  id: string;
  name: string;
  layout_type: string;
  description: string;
  accent: string;
}

const SYSTEM_TEMPLATE_BASE = [
  { id: 'classic', layout_type: 'classic', accent: '#4f46e5' },
  { id: 'modern',  layout_type: 'modern',  accent: '#6366f1' },
  { id: 'minimal', layout_type: 'minimal', accent: '#059669' },
];

interface InvoiceTemplatePickerProps {
  selectedLayout: InvoiceLayoutType;
  onSelect: (layout: InvoiceLayoutType, templateId?: string) => void;
  templates?: Array<{ id: string; name: string; layout_type: string; description: string; branding: Record<string, any> }>;
}

export default function InvoiceTemplatePicker({ selectedLayout, onSelect, templates }: InvoiceTemplatePickerProps) {
  const { t } = useTranslation();
  const it = t.invoiceTemplates;

  const SYSTEM_TEMPLATES: TemplateOption[] = [
    { id: 'classic', name: 'Classic', layout_type: 'classic', description: it.templateClassicDesc, accent: '#4f46e5' },
    { id: 'modern',  name: 'Modern',  layout_type: 'modern',  description: it.templateModernDesc,  accent: '#6366f1' },
    { id: 'minimal', name: 'Minimal', layout_type: 'minimal', description: it.templateMinimalDesc, accent: '#059669' },
  ];

  const allTemplates = [
    ...SYSTEM_TEMPLATES,
    ...(templates || []).filter(t => !SYSTEM_TEMPLATE_BASE.some(s => s.layout_type === t.layout_type))
      .map(t => ({
        id: t.id,
        name: t.name,
        layout_type: t.layout_type,
        description: t.description,
        accent: t.branding?.accent_color || '#4f46e5',
      })),
  ];

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-widest text-text-secondary">{it.templateLabel}</p>
      <div className="grid grid-cols-3 gap-2">
        {allTemplates.map((tpl) => {
          const isSelected = selectedLayout === tpl.layout_type;
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => onSelect(tpl.layout_type as InvoiceLayoutType, tpl.id)}
              className={`relative flex flex-col items-center rounded-xl border-2 p-3 transition-all ${
                isSelected
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-transparent bg-surface-secondary hover:border-outline-subtle hover:bg-surface-secondary/80'
              }`}
            >
              {isSelected && (
                <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-white">
                  <Check size={10} />
                </span>
              )}
              {/* Mini preview */}
              <div
                className="mb-2 flex h-16 w-full items-center justify-center rounded-lg"
                style={{ backgroundColor: tpl.accent + '12' }}
              >
                {tpl.layout_type === 'classic' && (
                  <div className="flex flex-col items-center gap-0.5">
                    <div className="h-1 w-8 rounded" style={{ backgroundColor: tpl.accent }} />
                    <div className="h-0.5 w-6 rounded bg-gray-300" />
                    <div className="mt-1 h-4 w-10 rounded-sm border" style={{ borderColor: tpl.accent + '40' }} />
                  </div>
                )}
                {tpl.layout_type === 'modern' && (
                  <div className="flex flex-col items-center gap-0.5">
                    <div className="h-3 w-12 rounded-t" style={{ backgroundColor: tpl.accent }} />
                    <div className="flex gap-1">
                      <div className="h-2 w-5 rounded-sm bg-gray-200" />
                      <div className="h-2 w-5 rounded-sm bg-gray-200" />
                    </div>
                    <div className="h-2 w-8 rounded" style={{ backgroundColor: tpl.accent }} />
                  </div>
                )}
                {tpl.layout_type === 'minimal' && (
                  <div className="flex flex-col items-center gap-1">
                    <div className="h-0.5 w-6 rounded bg-gray-300" />
                    <div className="h-px w-10" style={{ backgroundColor: tpl.accent }} />
                    <div className="h-0.5 w-8 rounded bg-gray-200" />
                    <div className="h-0.5 w-4 rounded bg-gray-200" />
                  </div>
                )}
              </div>
              <p className="text-xs font-semibold text-text-primary">{tpl.name}</p>
              <p className="text-[10px] text-text-tertiary">{tpl.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
