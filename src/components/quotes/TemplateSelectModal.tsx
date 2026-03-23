import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { LayoutTemplate, Plus, Loader2, Package, FileText } from 'lucide-react';
import { cn } from '../../lib/utils';
import { listQuoteTemplates } from '../../lib/quoteTemplatesApi';
import type { QuoteTemplate } from '../../types';
import { useTranslation } from '../i18n';

interface TemplateSelectModalProps {
  isOpen: boolean;
  isFr: boolean;
  onSelectTemplate: (template: QuoteTemplate) => void;
  onStartFromScratch: () => void;
  onClose: () => void;
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
}

export default function TemplateSelectModal({
  isOpen,
  isFr,
  onSelectTemplate,
  onStartFromScratch,
  onClose,
}: TemplateSelectModalProps) {
  const [templates, setTemplates] = useState<QuoteTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    listQuoteTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]))
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
        className="modal-content max-w-lg max-h-[80vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-[16px] font-bold text-text-primary">
            {t.quoteTemplates.chooseATemplate}
          </h2>
          <p className="text-[12px] text-text-tertiary mt-0.5">
            {isFr
              ? 'Sélectionnez un modèle ou commencez de zéro.'
              : 'Select a template or start from scratch.'}
          </p>
        </div>

        <div className="px-5 pb-5 space-y-3">
          {/* Start from scratch */}
          <button
            onClick={onStartFromScratch}
            className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-dashed border-outline hover:border-primary/40 hover:bg-primary/5 transition-all text-left group"
          >
            <div className="w-10 h-10 rounded-xl bg-surface-secondary group-hover:bg-primary/10 flex items-center justify-center transition-colors">
              <FileText size={18} className="text-text-tertiary group-hover:text-primary transition-colors" />
            </div>
            <div>
              <p className="text-[14px] font-semibold text-text-primary">
                {t.quoteTemplates.startFromScratch}
              </p>
              <p className="text-[11px] text-text-tertiary">
                {t.quoteTemplates.createABlankQuote}
              </p>
            </div>
          </button>

          {/* Templates */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-text-tertiary" />
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-6 text-[12px] text-text-tertiary">
              {t.quoteTemplates.noTemplatesAvailable}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary px-1">
                {t.quoteTemplates.availableTemplates}
              </p>
              {templates.map((t) => {
                const serviceCount = (t.services || []).length;
                const totalCents = (t.services || []).reduce((sum, s) => sum + s.unit_price_cents * s.quantity, 0);

                return (
                  <button
                    key={t.id}
                    onClick={() => onSelectTemplate(t)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-outline hover:border-primary/30 hover:bg-primary/5 transition-all text-left group"
                  >
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <LayoutTemplate size={18} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-text-primary truncate">{t.name}</p>
                      <div className="flex items-center gap-3 mt-0.5 text-[11px] text-text-tertiary">
                        <span className="flex items-center gap-1">
                          <Package size={10} />
                          {serviceCount} {serviceCount === 1 ? 'service' : 'services'}
                        </span>
                        {totalCents > 0 && (
                          <span className="font-medium text-text-secondary">{formatMoney(totalCents)}</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
