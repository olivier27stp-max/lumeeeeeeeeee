import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import {
  Copy,
  FileText,
  Loader2,
  MoreHorizontal,
  Plus,
  Star,
  Trash2,
  Pencil,
  Play,
} from 'lucide-react';
import {
  InvoiceTemplate,
  listInvoiceTemplates,
  duplicateInvoiceTemplate,
  setDefaultInvoiceTemplate,
  deleteInvoiceTemplate,
} from '../lib/invoiceTemplatesApi';
import InvoiceTemplateModal from './InvoiceTemplateModal';
import { useTranslation } from '../i18n';

interface Props {
  onUseTemplate: (template: InvoiceTemplate) => void;
}

export default function InvoiceTemplatesTab({ onUseTemplate }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<InvoiceTemplate | null>(null);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  const {
    data: templates = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['invoiceTemplates'],
    queryFn: listInvoiceTemplates,
  });

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ['invoiceTemplates'] });
  }

  function handleEdit(template: InvoiceTemplate) {
    setEditingTemplate(template);
    setModalOpen(true);
    setActionMenuId(null);
  }

  function handleCreate() {
    setEditingTemplate(null);
    setModalOpen(true);
  }

  async function handleDuplicate(id: string) {
    setActionMenuId(null);
    try {
      await duplicateInvoiceTemplate(id);
      toast.success(t.invoiceTemplates.toastDuplicated);
      handleRefresh();
    } catch (err: any) {
      toast.error(err?.message || t.invoiceTemplates.toastDuplicateFailed);
    }
  }

  async function handleSetDefault(id: string) {
    setActionMenuId(null);
    try {
      await setDefaultInvoiceTemplate(id);
      toast.success(t.invoiceTemplates.toastDefaultUpdated);
      handleRefresh();
    } catch (err: any) {
      toast.error(err?.message || t.invoiceTemplates.toastSetDefaultFailed);
    }
  }

  async function handleDelete(id: string) {
    setActionMenuId(null);
    if (!window.confirm(t.invoiceTemplates.confirmArchive)) return;
    try {
      await deleteInvoiceTemplate(id);
      toast.success(t.invoiceTemplates.toastArchived);
      handleRefresh();
    } catch (err: any) {
      toast.error(err?.message || t.invoiceTemplates.toastArchiveFailed);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-text-primary">{t.invoiceTemplates.title}</h3>
          <p className="text-xs text-text-secondary">
            {t.invoiceTemplates.subtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          className="glass-button-primary inline-flex items-center gap-2 !text-sm"
        >
          <Plus size={14} />
          {t.invoiceTemplates.newTemplate}
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="section-card animate-pulse rounded-xl border border-outline p-4"
            >
              <div className="h-4 w-1/3 rounded bg-surface-secondary" />
              <div className="mt-2 h-3 w-2/3 rounded bg-surface-secondary" />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="rounded-xl border border-danger bg-danger-light px-4 py-3 text-sm text-danger">
          {t.invoiceTemplates.loadError}
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && templates.length === 0 && (
        <div className="section-card flex flex-col items-center justify-center rounded-xl border border-outline p-10 text-center">
          <FileText size={36} className="text-text-tertiary mb-3 opacity-40" />
          <p className="text-sm font-semibold text-text-primary">{t.invoiceTemplates.emptyTitle}</p>
          <p className="text-xs text-text-secondary mt-1 max-w-xs">
            {t.invoiceTemplates.emptyDescription}
          </p>
          <button
            type="button"
            onClick={handleCreate}
            className="glass-button-primary mt-4 inline-flex items-center gap-2 !text-sm"
          >
            <Plus size={14} />
            {t.invoiceTemplates.createFirst}
          </button>
        </div>
      )}

      {/* List */}
      {!isLoading && !isError && templates.length > 0 && (
        <div className="space-y-2">
          {templates.map((tpl) => (
            <motion.div
              key={tpl.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="section-card group relative flex items-center justify-between rounded-xl border border-outline p-4 transition-colors hover:bg-surface-secondary/30"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-text-primary truncate">{tpl.name}</p>
                  {tpl.is_default && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary uppercase tracking-wider">
                      <Star size={10} />
                      {t.invoiceTemplates.default}
                    </span>
                  )}
                </div>
                {tpl.description && (
                  <p className="text-xs text-text-secondary mt-0.5 line-clamp-1">
                    {tpl.description}
                  </p>
                )}
                <p className="text-[11px] text-text-tertiary mt-1">
                  {tpl.line_items.length} line item{tpl.line_items.length !== 1 ? 's' : ''}
                  {tpl.taxes.length > 0 &&
                    ` \u00b7 ${tpl.taxes.length} tax${tpl.taxes.length !== 1 ? 'es' : ''}`}
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => onUseTemplate(tpl)}
                  className="glass-button inline-flex items-center gap-1.5 !px-3 !py-1.5 !text-xs"
                >
                  <Play size={11} />
                  {t.invoiceTemplates.use}
                </button>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setActionMenuId(actionMenuId === tpl.id ? null : tpl.id)}
                    className="glass-button !p-2"
                  >
                    <MoreHorizontal size={14} />
                  </button>

                  <AnimatePresence>
                    {actionMenuId === tpl.id && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="absolute right-0 top-full mt-1 z-20 min-w-[160px] rounded-xl border border-outline bg-surface shadow-xl py-1"
                      >
                        <button
                          type="button"
                          onClick={() => handleEdit(tpl)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-surface-secondary transition-colors"
                        >
                          <Pencil size={12} />
                          {t.invoiceTemplates.edit}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDuplicate(tpl.id)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-surface-secondary transition-colors"
                        >
                          <Copy size={12} />
                          {t.invoiceTemplates.duplicate}
                        </button>
                        {!tpl.is_default && (
                          <button
                            type="button"
                            onClick={() => void handleSetDefault(tpl.id)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-primary hover:bg-surface-secondary transition-colors"
                          >
                            <Star size={12} />
                            {t.invoiceTemplates.setAsDefault}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleDelete(tpl.id)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-xs text-danger hover:bg-surface-secondary transition-colors"
                        >
                          <Trash2 size={12} />
                          {t.invoiceTemplates.archive}
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Click-outside handler for action menu */}
      {actionMenuId && (
        <div className="fixed inset-0 z-10" onClick={() => setActionMenuId(null)} />
      )}

      {/* Modal */}
      <InvoiceTemplateModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingTemplate(null);
        }}
        onSaved={handleRefresh}
        template={editingTemplate}
      />
    </div>
  );
}
