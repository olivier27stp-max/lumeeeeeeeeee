import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Copy,
  Edit2,
  LayoutTemplate,
  Loader2,
  Package,
  MoreHorizontal,
  X,
  Save,
  Check,
  GripVertical,
  Image,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import {
  listQuoteTemplates,
  createQuoteTemplate,
  updateQuoteTemplate,
  deleteQuoteTemplate,
  duplicateQuoteTemplate,
} from '../lib/quoteTemplatesApi';
import ServicePicker from '../components/ServicePicker';
import type { PredefinedService } from '../lib/servicesApi';
import type { QuoteTemplate, QuoteTemplateService } from '../types';

// ── Helpers ────────────────────────────────────────────────

function generateId() {
  return crypto.randomUUID();
}

function emptyService(): QuoteTemplateService {
  return { id: generateId(), name: '', description: '', unit_price_cents: 0, quantity: 1, is_optional: false };
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
}

// ── Service Item Component ─────────────────────────────────

function ServiceItem({
  service,
  isFr,
  onUpdate,
  onRemove,
}: {
  key?: React.Key;
  service: QuoteTemplateService;
  isFr: boolean;
  onUpdate: (s: QuoteTemplateService) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-start gap-2 p-3 bg-surface-secondary rounded-lg">
      <div className="mt-1.5 text-text-tertiary cursor-grab">
        <GripVertical size={14} />
      </div>
      <div className="flex-1 space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input
            type="text"
            value={service.name}
            onChange={(e) => onUpdate({ ...service, name: e.target.value })}
            className="glass-input w-full text-[13px]"
            placeholder={t.quoteTemplates.serviceName}
          />
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="0.01"
              value={service.unit_price_cents / 100 || ''}
              onChange={(e) => onUpdate({ ...service, unit_price_cents: Math.round(parseFloat(e.target.value || '0') * 100) })}
              className="glass-input w-full text-[13px]"
              placeholder={t.quoteTemplates.price}
            />
            <input
              type="number"
              min="1"
              value={service.quantity}
              onChange={(e) => onUpdate({ ...service, quantity: parseInt(e.target.value || '1', 10) })}
              className="glass-input w-20 text-[13px]"
              placeholder="Qty"
            />
          </div>
        </div>
        <input
          type="text"
          value={service.description}
          onChange={(e) => onUpdate({ ...service, description: e.target.value })}
          className="glass-input w-full text-[12px]"
          placeholder={t.quoteTemplates.descriptionOptional}
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-[11px] text-text-tertiary cursor-pointer">
            <input
              type="checkbox"
              checked={service.is_optional}
              onChange={(e) => onUpdate({ ...service, is_optional: e.target.checked })}
              className="accent-primary"
            />
            {t.automations.optional}
          </label>
          <button onClick={onRemove} className="text-text-tertiary hover:text-red-500 transition-colors p-1">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Template Card ──────────────────────────────────────────

function TemplateCard({
  template,
  isFr,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  key?: React.Key;
  template: QuoteTemplate;
  isFr: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const serviceCount = (template.services || []).length;
  const totalCents = (template.services || []).reduce((sum, s) => sum + s.unit_price_cents * s.quantity, 0);

  return (
    <div className="section-card p-4 hover:shadow-md transition-shadow group">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <LayoutTemplate size={18} className="text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold text-text-primary truncate">{template.name}</h3>
            {template.description && (
              <p className="text-[11px] text-text-tertiary truncate mt-0.5">{template.description}</p>
            )}
          </div>
        </div>
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-1.5 rounded-lg text-text-tertiary hover:bg-surface-secondary transition-colors opacity-0 group-hover:opacity-100"
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-8 z-50 bg-surface border border-outline rounded-xl shadow-lg py-1 min-w-[140px]">
                <button
                  onClick={() => { setMenuOpen(false); onEdit(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-text-secondary hover:bg-surface-secondary transition-colors"
                >
                  <Edit2 size={12} /> {t.advancedNotes.edit}
                </button>
                <button
                  onClick={() => { setMenuOpen(false); onDuplicate(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-text-secondary hover:bg-surface-secondary transition-colors"
                >
                  <Copy size={12} /> {t.invoiceDetails.duplicate}
                </button>
                <button
                  onClick={() => { setMenuOpen(false); onDelete(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 size={12} /> {t.advancedNotes.delete}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4 mt-3 text-[11px] text-text-tertiary">
        <span className="flex items-center gap-1">
          <Package size={11} />
          {serviceCount} {serviceCount === 1 ? 'service' : 'services'}
        </span>
        {totalCents > 0 && (
          <span className="font-medium text-text-secondary">{formatMoney(totalCents)}</span>
        )}
        <span className="ml-auto">
          {new Date(template.updated_at).toLocaleDateString(t.dashboard.enus, { month: 'short', day: 'numeric' })}
        </span>
      </div>
    </div>
  );
}

// ── Template Editor Modal ──────────────────────────────────

function TemplateEditor({
  template,
  isFr,
  onSave,
  onClose,
}: {
  template: QuoteTemplate | null;
  isFr: boolean;
  onSave: (data: Partial<QuoteTemplate>) => Promise<void>;
  onClose: () => void;
}) {
  const isNew = !template;
  const [name, setName] = useState(template?.name || '');
  const [description, setDescription] = useState(template?.description || '');
  const [services, setServices] = useState<QuoteTemplateService[]>(template?.services || []);
  const [notes, setNotes] = useState(template?.notes || '');
  const [terms, setTerms] = useState(template?.terms || '');
  const [saving, setSaving] = useState(false);
  const [servicePickerOpen, setServicePickerOpen] = useState(false);

  const addedServiceIds = useMemo(() => {
    const ids = new Set<string>();
    services.forEach((s) => { if ((s as any).source_service_id) ids.add((s as any).source_service_id); });
    return ids;
  }, [services]);

  const handleCatalogSelect = (ps: PredefinedService) => {
    setServices((prev) => [...prev, {
      id: generateId(),
      name: ps.name,
      description: ps.description || '',
      unit_price_cents: ps.default_price_cents || 0,
      quantity: 1,
      is_optional: false,
      source_service_id: ps.id,
    } as QuoteTemplateService & { source_service_id: string }]);
  };

  const handleCatalogRemove = (serviceId: string) => {
    setServices((prev) => prev.filter((s) => (s as any).source_service_id !== serviceId));
  };

  const addService = () => setServices((prev) => [...prev, emptyService()]);
  const updateService = (id: string, updated: QuoteTemplateService) =>
    setServices((prev) => prev.map((s) => (s.id === id ? updated : s)));
  const removeService = (id: string) => setServices((prev) => prev.filter((s) => s.id !== id));

  const handleSave = async () => {
    if (!name.trim()) { toast.error(t.quoteTemplates.nameIsRequired); return; }
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || null,
        services,
        notes: notes.trim() || null,
        terms: terms.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        onClick={(e) => e.stopPropagation()}
        className="modal-content max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-surface border-b border-border px-5 py-4 flex items-center justify-between">
          <h2 className="text-[16px] font-bold text-text-primary">
            {isNew ? (t.quoteTemplates.newTemplate) : (t.quoteTemplates.editTemplate)}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-secondary text-text-tertiary">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Basic Info */}
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                {t.quoteTemplates.templateName} *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="glass-input w-full mt-1"
                placeholder={t.quoteTemplates.egSpringMaintenance}
                autoFocus
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                {t.automations.description}
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="glass-input w-full mt-1"
                placeholder={t.noteBoards.optionalDescription}
              />
            </div>
          </div>

          {/* Services */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
                {t.quoteTemplates.prefilledServices}
              </label>
              <div className="flex items-center gap-2">
                <button onClick={() => setServicePickerOpen(true)} className="glass-button text-[11px] inline-flex items-center gap-1">
                  <Package size={12} />
                  {t.quoteTemplates.addFromCatalog}
                </button>
                <button onClick={addService} className="glass-button text-[11px] inline-flex items-center gap-1">
                  <Plus size={12} />
                  {t.quoteTemplates.addManually}
                </button>
              </div>
            </div>
            {services.length === 0 ? (
              <div className="text-center py-6 text-[12px] text-text-tertiary bg-surface-secondary rounded-lg">
                <p>{t.quoteTemplates.noServicesAddedYet}</p>
                <button
                  type="button"
                  onClick={() => setServicePickerOpen(true)}
                  className="mt-2 text-primary hover:text-primary/80 text-[11px] inline-flex items-center gap-1 mx-auto"
                >
                  <Package size={11} /> {t.quoteTemplates.browseServices}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {services.map((s) => (
                  <ServiceItem
                    key={s.id}
                    service={s}
                    isFr={isFr}
                    onUpdate={(u) => updateService(s.id, u)}
                    onRemove={() => removeService(s.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Notes & Terms */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                {t.quoteTemplates.defaultNotes}
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="glass-input w-full mt-1 min-h-[80px]"
                placeholder={t.quoteTemplates.notesIncludedInTheQuote}
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                {t.quoteTemplates.termsConditions}
              </label>
              <textarea
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                className="glass-input w-full mt-1 min-h-[80px]"
                placeholder={t.quoteTemplates.termsAndConditions}
              />
            </div>
          </div>
        </div>

        {/* Service Picker */}
        {servicePickerOpen && (
          <ServicePicker
            isOpen={servicePickerOpen}
            onClose={() => setServicePickerOpen(false)}
            onSelect={handleCatalogSelect}
            onRemove={handleCatalogRemove}
            addedIds={addedServiceIds}
          />
        )}

        {/* Footer */}
        <div className="sticky bottom-0 bg-surface border-t border-border px-5 py-3 flex items-center justify-end gap-2">
          <button onClick={onClose} className="glass-button">
            {t.advancedNotes.cancel}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className={cn('glass-button-primary inline-flex items-center gap-1.5', saving && 'opacity-60')}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? (t.invoiceEdit.saving) : (t.quoteTemplates.saveTemplate)}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────

export default function QuoteTemplates() {
  const navigate = useNavigate();
  const { language } = useTranslation();
  const isFr = language === 'fr';

  const [templates, setTemplates] = useState<QuoteTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState<QuoteTemplate | null | 'new'>(null);

  const loadTemplates = useCallback(async () => {
    try {
      const data = await listQuoteTemplates();
      setTemplates(data);
    } catch (err) {
      console.error('Failed to load templates:', err);
      toast.error(t.quoteTemplates.failedToLoadTemplates);
    } finally {
      setLoading(false);
    }
  }, [isFr]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const handleSave = async (data: Partial<QuoteTemplate>) => {
    try {
      if (editingTemplate === 'new') {
        await createQuoteTemplate(data as any);
        toast.success(t.quoteTemplates.templateCreated);
      } else if (editingTemplate && typeof editingTemplate === 'object') {
        await updateQuoteTemplate(editingTemplate.id, data as any);
        toast.success(t.quoteTemplates.templateUpdated);
      }
      setEditingTemplate(null);
      await loadTemplates();
    } catch (err: any) {
      toast.error(err.message || (t.advancedNotes.error));
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await duplicateQuoteTemplate(id);
      toast.success(t.quoteTemplates.templateDuplicated);
      await loadTemplates();
    } catch (err: any) {
      toast.error(err.message || (t.advancedNotes.error));
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(isFr ? `Supprimer le modèle "${name}" ?` : `Delete template "${name}"?`)) return;
    try {
      await deleteQuoteTemplate(id);
      toast.success(t.quoteTemplates.templateDeleted);
      await loadTemplates();
    } catch (err: any) {
      toast.error(err.message || (t.advancedNotes.error));
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/leads')}
          className="w-9 h-9 rounded-xl bg-surface-secondary flex items-center justify-center hover:bg-surface-secondary/80 transition-colors"
        >
          <ArrowLeft size={16} className="text-text-secondary" />
        </button>
        <div className="flex-1">
          <h1 className="text-[20px] font-bold text-text-primary tracking-tight">
            {t.quoteTemplates.quoteTemplates}
          </h1>
          <p className="text-[12px] text-text-tertiary">
            {t.quoteTemplates.createReusableTemplatesForYourQuotes}
          </p>
        </div>
        <button
          onClick={() => setEditingTemplate('new')}
          className="glass-button-primary inline-flex items-center gap-1.5"
        >
          <Plus size={14} />
          {t.quoteTemplates.newTemplate}
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-text-tertiary" />
        </div>
      ) : templates.length === 0 ? (
        <div className="section-card p-12 text-center">
          <LayoutTemplate size={36} className="text-text-tertiary mx-auto mb-3 opacity-30" />
          <h3 className="text-[15px] font-semibold text-text-primary">
            {t.quoteTemplates.noTemplatesYet}
          </h3>
          <p className="text-[13px] text-text-tertiary mt-1 max-w-sm mx-auto">
            {isFr
              ? 'Créez votre premier modèle pour accélérer la création de devis.'
              : 'Create your first template to speed up quote creation.'}
          </p>
          <button
            onClick={() => setEditingTemplate('new')}
            className="glass-button-primary mt-4 inline-flex items-center gap-1.5"
          >
            <Plus size={14} />
            {t.quoteTemplates.createTemplate}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              isFr={isFr}
              onEdit={() => setEditingTemplate(t)}
              onDuplicate={() => handleDuplicate(t.id)}
              onDelete={() => handleDelete(t.id, t.name)}
            />
          ))}
        </div>
      )}

      {/* Editor Modal */}
      <AnimatePresence>
        {editingTemplate && (
          <TemplateEditor
            template={editingTemplate === 'new' ? null : editingTemplate}
            isFr={isFr}
            onSave={handleSave}
            onClose={() => setEditingTemplate(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
