/* ═══════════════════════════════════════════════════════════════
   Page — Quote Content Presets
   Manage reusable content presets for quotes.
   Services use the same UX as QuoteCreateModal.
   Live client-view preview via MinimalProTemplate.
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import {
  Plus, Trash2, Copy, Edit2, Package, X, Image as ImageIcon,
  Save, Eye, EyeOff,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  listQuotePresets,
  createQuotePreset,
  updateQuotePreset,
  deleteQuotePreset,
  duplicateQuotePreset,
  type QuotePresetPayload,
} from '../lib/quotePresetsApi';
import { getCompanySettings } from '../lib/invoicesApi';
import { formatQuoteMoney } from '../lib/quotesApi';
import type { QuotePreset, QuotePresetService } from '../types';
import type { QuoteRenderData } from '../components/quote/types';
import QuoteRenderer from '../components/quote/QuoteRenderer';
import ServicePicker from '../components/ServicePicker';
import type { PredefinedService } from '../lib/servicesApi';
import { useTranslation } from '../i18n';

type ViewMode = 'list' | 'edit';

/* ── Line item form (matches QuoteCreateModal pattern) ── */
interface LineItemForm {
  id: string;
  source_service_id: string | null;
  name: string;
  description: string;
  qtyInput: string;
  is_optional: boolean;
  item_type: 'service' | 'text' | 'heading';
}

function emptyLine(): LineItemForm {
  return {
    id: crypto.randomUUID(), source_service_id: null, name: '', description: '',
    qtyInput: '1', is_optional: false, item_type: 'service',
  };
}

function emptyPresetService(): QuotePresetService {
  return { id: crypto.randomUUID(), name: '', description: '', quantity: 1, is_optional: false };
}

const inputCls = 'glass-input w-full mt-1.5';

export default function QuotePresets() {
  const navigate = useNavigate();
  const { language } = useTranslation();
  const fr = language === 'fr';

  const [presets, setPresets] = useState<QuotePreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ViewMode>('list');
  const [editingPreset, setEditingPreset] = useState<QuotePreset | null>(null);

  // Edit form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [lineItems, setLineItems] = useState<LineItemForm[]>([emptyLine()]);
  const [addedServiceIds, setAddedServiceIds] = useState<Set<string>>(new Set());
  const [servicePickerOpen, setServicePickerOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [introText, setIntroText] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [companySettings, setCompanySettings] = useState<any>(null);

  useEffect(() => { loadPresets(); }, []);
  useEffect(() => { getCompanySettings().then(setCompanySettings).catch(() => {}); }, []);

  async function loadPresets() {
    setLoading(true);
    try { setPresets(await listQuotePresets()); }
    catch { setPresets([]); }
    finally { setLoading(false); }
  }

  function startCreate() {
    setEditingPreset(null);
    setName(''); setDescription(''); setCoverImage(''); setImages([]);
    setLineItems([emptyLine()]); setAddedServiceIds(new Set());
    setNotes(''); setIntroText(''); setShowPreview(false);
    setMode('edit');
  }

  function startEdit(preset: QuotePreset) {
    setEditingPreset(preset);
    setName(preset.name);
    setDescription(preset.description || '');
    setCoverImage(preset.cover_image || '');
    setImages(preset.images || []);
    setLineItems(
      preset.services.length > 0
        ? preset.services.map(s => ({
            id: s.id || crypto.randomUUID(),
            source_service_id: null,
            name: s.name,
            description: s.description || '',
            qtyInput: String(s.quantity || 1),
            is_optional: s.is_optional || false,
            item_type: 'service' as const,
          }))
        : [emptyLine()],
    );
    setAddedServiceIds(new Set());
    setNotes(preset.notes || '');
    setIntroText(preset.intro_text || '');
    setShowPreview(false);
    setMode('edit');
  }

  async function handleSave() {
    if (!name.trim()) { toast.error(fr ? 'Nom requis' : 'Name is required'); return; }
    setSaving(true);
    const payload: QuotePresetPayload = {
      name: name.trim(),
      description: description.trim() || null,
      cover_image: coverImage.trim() || null,
      images: images.filter(Boolean),
      services: lineItems
        .filter(i => i.name.trim())
        .map(i => ({
          id: i.id,
          name: i.name.trim(),
          description: i.description || '',
          quantity: Math.max(1, parseInt(i.qtyInput) || 1),
          is_optional: i.is_optional,
        })),
      notes: notes.trim() || null,
      intro_text: introText.trim() || null,
      is_active: true,
    };
    try {
      if (editingPreset) {
        await updateQuotePreset(editingPreset.id, payload);
        toast.success(fr ? 'Preset mis à jour' : 'Preset updated');
      } else {
        await createQuotePreset(payload);
        toast.success(fr ? 'Preset créé' : 'Preset created');
      }
      await loadPresets();
      setMode('list');
    } catch (e: any) {
      toast.error(e?.message || 'Failed');
    } finally { setSaving(false); }
  }

  async function handleDelete(preset: QuotePreset) {
    if (!confirm(fr ? `Supprimer "${preset.name}" ?` : `Delete "${preset.name}"?`)) return;
    try { await deleteQuotePreset(preset.id); toast.success(fr ? 'Supprimé' : 'Deleted'); await loadPresets(); }
    catch { toast.error('Failed'); }
  }

  async function handleDuplicate(preset: QuotePreset) {
    try { await duplicateQuotePreset(preset.id); toast.success(fr ? 'Dupliqué' : 'Duplicated'); await loadPresets(); }
    catch { toast.error('Failed'); }
  }

  // ── Line item handlers (same as QuoteCreateModal) ──
  const updateLine = (id: string, patch: Partial<LineItemForm>) =>
    setLineItems(p => p.map(i => i.id === id ? { ...i, ...patch } : i));

  const removeLine = (id: string) => {
    setLineItems(p => {
      const item = p.find(i => i.id === id);
      if (item?.source_service_id) {
        setAddedServiceIds(s => { const n = new Set(s); n.delete(item.source_service_id!); return n; });
      }
      return p.length > 1 ? p.filter(i => i.id !== id) : p;
    });
  };

  const handleServiceSelected = (service: PredefinedService) => {
    const empty = lineItems.findIndex(i => !i.name.trim());
    const item: LineItemForm = {
      id: crypto.randomUUID(),
      source_service_id: service.id,
      name: service.name,
      description: service.description || '',
      qtyInput: '1',
      is_optional: false,
      item_type: 'service',
    };
    if (empty !== -1) setLineItems(p => { const u = [...p]; u[empty] = item; return u; });
    else setLineItems(p => [...p, item]);
    setAddedServiceIds(p => new Set([...p, service.id]));
  };

  const handleServiceRemoved = (serviceId: string) => {
    setLineItems(p => {
      const filtered = p.filter(i => i.source_service_id !== serviceId);
      return filtered.length > 0 ? filtered : [emptyLine()];
    });
    setAddedServiceIds(p => { const n = new Set(p); n.delete(serviceId); return n; });
  };

  // ── Build preview data ──
  const previewData: QuoteRenderData = useMemo(() => {
    const validItems = lineItems.filter(i => i.name.trim() && !i.is_optional);
    const optItems = lineItems.filter(i => i.name.trim() && i.is_optional);
    return {
      quote_number: 'QTE-PREVIEW',
      title: name || (fr ? 'Aperçu du preset' : 'Preset Preview'),
      status: 'draft',
      valid_until: null,
      created_at: new Date().toISOString(),
      notes: notes || null,
      currency: 'CAD',
      subtotal_cents: 0,
      discount_cents: 0,
      tax_cents: 0,
      tax_rate: 0,
      tax_rate_label: '',
      total_cents: 0,
      deposit_required: false,
      deposit_cents: 0,
      deposit_status: 'none',
      contact_name: 'John Doe',
      contact_email: 'john@example.com',
      contact_phone: '(514) 555-1234',
      contact_company: null,
      contact_address: '123 Main St, Montréal, QC',
      company_name: companySettings?.company_name || 'Your Company',
      company_email: companySettings?.company_email || null,
      company_phone: companySettings?.company_phone || null,
      company_address: companySettings?.company_address || null,
      company_logo_url: companySettings?.company_logo_url || null,
      introduction: introText || null,
      contract_disclaimer: null,
      items: validItems.map((i, idx) => ({
        id: i.id,
        name: i.name,
        description: i.description || null,
        qty: parseInt(i.qtyInput) || 1,
        unit_price_cents: 0,
        total_cents: 0,
        item_type: i.item_type,
      })),
      optional_items: optItems.map((i) => ({
        id: i.id,
        name: i.name,
        description: i.description || null,
        qty: parseInt(i.qtyInput) || 1,
        unit_price_cents: 0,
        total_cents: 0,
        item_type: i.item_type,
      })),
    };
  }, [name, notes, introText, lineItems, companySettings, fr]);

  // ── EDIT VIEW (modal popup — same style as QuoteCreateModal) ──
  const editModal = mode === 'edit' && (
    <>
      <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 backdrop-blur-md p-4">
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          className="w-full max-w-5xl max-h-[94vh] bg-surface rounded-2xl border border-outline shadow-2xl flex flex-col overflow-hidden"
        >
          {/* ── Header ── */}
          <div className="px-6 py-5 border-b border-outline flex items-center justify-between bg-surface-secondary">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Package size={18} className="text-primary" />
              </div>
              <div>
                <h2 className="text-[16px] font-bold tracking-tight text-text-primary">
                  {editingPreset ? (fr ? 'Modifier le preset' : 'Edit Preset') : (fr ? 'Nouveau preset' : 'New Preset')}
                </h2>
                <p className="text-[13px] text-text-tertiary">
                  {fr ? 'Les prix seront ajoutés lors de la création du devis' : 'Pricing will be added when creating the quote'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowPreview(!showPreview)}
                className={cn(
                  'inline-flex items-center gap-2 h-9 px-3 rounded-xl text-[12px] font-medium border transition-all',
                  showPreview
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'border-outline text-text-secondary hover:bg-surface-tertiary',
                )}>
                {showPreview ? <EyeOff size={13} /> : <Eye size={13} />}
                {fr ? 'Aperçu' : 'Preview'}
              </button>
              <button onClick={() => setMode('list')} className="p-2 rounded-xl border border-outline hover:bg-surface-tertiary text-text-tertiary hover:text-text-primary transition-colors">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* ── Body ── */}
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
            <div className={cn('grid gap-6', showPreview ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1')}>
              {/* ── Main editor ── */}
              <div className="space-y-4">
                {/* Name + Description + Intro */}
                <div className="section-card p-5 space-y-4">
                  <div>
                    <label className="text-xs font-medium text-text-tertiary block mb-1.5">
                      {fr ? 'Nom du preset' : 'Preset Name'} *
                    </label>
                    <input value={name} onChange={e => setName(e.target.value)}
                      placeholder={fr ? 'ex: Garde-gouttières' : 'e.g. Gutter Guards'}
                      className="glass-input w-full" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-text-tertiary block mb-1.5">
                      Description
                    </label>
                    <textarea value={description} onChange={e => setDescription(e.target.value)}
                      rows={2} placeholder={fr ? 'Description optionnelle...' : 'Optional description...'}
                      className="glass-input w-full resize-none" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-text-tertiary block mb-1.5">
                      {fr ? 'Texte d\'introduction' : 'Introduction Text'}
                    </label>
                    <textarea value={introText} onChange={e => setIntroText(e.target.value)}
                      rows={3} placeholder={fr ? 'Texte affiché en haut de la soumission...' : 'Text shown at the top of the quote...'}
                      className="glass-input w-full resize-none" />
                  </div>
                </div>

                {/* ── Product / Service ── */}
                <div className="section-card p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[16px] font-bold tracking-tight text-text-primary">
                      {fr ? 'Produits / Services' : 'Product / Service'}
                    </h3>
                    <button type="button" onClick={() => setServicePickerOpen(true)}
                      className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1">
                      <Package size={12} /> {fr ? 'Ajouter du catalogue' : 'Add from catalog'}
                    </button>
                  </div>

                  {lineItems.map(item => (
                    <div key={item.id} className={cn(
                      'grid grid-cols-12 gap-3 items-start p-3 rounded-lg border transition-all',
                      item.is_optional ? 'border-dashed border-outline bg-surface-secondary/50' : 'border-outline bg-surface',
                    )}>
                      {/* Name + Description */}
                      <div className="col-span-8 space-y-1">
                        <input value={item.name} onChange={e => updateLine(item.id, { name: e.target.value })}
                          className={cn(inputCls, 'py-2')} placeholder={fr ? 'Nom' : 'Name'} />
                        <textarea value={item.description} onChange={e => updateLine(item.id, { description: e.target.value })}
                          className={cn(inputCls, 'py-1.5 text-xs min-h-[40px] resize-none')} placeholder="Description" />
                      </div>
                      {/* Quantity */}
                      <div className="col-span-2">
                        <label className="text-xs font-medium text-text-tertiary">{fr ? 'Quantité' : 'Quantity'}</label>
                        <input value={item.qtyInput} onChange={e => updateLine(item.id, { qtyInput: e.target.value.replace(/[^\d]/g, '') || '1' })}
                          className={cn(inputCls, 'py-2 text-center')} />
                      </div>
                      {/* Delete */}
                      <div className="col-span-2 flex flex-col items-center gap-1 pt-5">
                        <button type="button" onClick={() => removeLine(item.id)} disabled={lineItems.length === 1}
                          className="p-1 text-text-tertiary hover:text-danger disabled:opacity-30"><Trash2 size={14} /></button>
                      </div>
                      {/* Optional toggle */}
                      <div className="col-span-12">
                        <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                          <input type="checkbox" checked={item.is_optional} onChange={e => updateLine(item.id, { is_optional: e.target.checked })}
                            className="h-3.5 w-3.5 rounded" />
                          {fr ? 'Marquer comme optionnel' : 'Mark as optional'}
                        </label>
                      </div>
                    </div>
                  ))}

                  <div className="flex gap-2">
                    <button type="button" onClick={() => setLineItems(p => [...p, emptyLine()])}
                      className="glass-button-primary px-3 py-2 text-xs font-semibold flex items-center gap-1.5">
                      <Plus size={12} /> {fr ? 'Ajouter un service' : 'Add Line Item'}
                    </button>
                    <button type="button" onClick={() => setLineItems(p => [...p, { ...emptyLine(), item_type: 'text', name: '' }])}
                      className="glass-button px-3 py-2 text-xs font-medium">
                      {fr ? 'Ajouter texte' : 'Add Text'}
                    </button>
                  </div>
                </div>

                {/* Notes */}
                <div className="section-card p-5">
                  <label className="text-xs font-medium text-text-tertiary block mb-1.5">
                    {fr ? 'Notes préremplies' : 'Pre-filled Notes'}
                  </label>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)}
                    rows={3} placeholder={fr ? 'Notes visibles sur le devis...' : 'Notes visible on the quote...'}
                    className="glass-input w-full resize-none" />
                </div>

                {/* Images */}
                <div className="section-card p-5 space-y-4">
                  <div>
                    <label className="text-xs font-medium text-text-tertiary block mb-1.5">
                      {fr ? 'Image de couverture (URL)' : 'Cover Image (URL)'}
                    </label>
                    <input value={coverImage} onChange={e => setCoverImage(e.target.value)}
                      placeholder="https://..." className="glass-input w-full text-[13px]" />
                    {coverImage && (
                      <div className="mt-2 rounded-lg overflow-hidden h-32 bg-surface-tertiary">
                        <img src={coverImage} alt="" className="w-full h-full object-cover"
                          onError={(e) => (e.currentTarget.style.display = 'none')} />
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium text-text-tertiary">
                        {fr ? 'Galerie d\'images' : 'Image Gallery'}
                      </label>
                      <button onClick={() => setImages([...images, ''])}
                        className="text-[11px] text-primary hover:text-primary-hover font-medium flex items-center gap-1">
                        <Plus size={11} /> Add
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      {images.map((url, idx) => (
                        <div key={idx} className="flex items-center gap-1.5">
                          <input value={url} onChange={e => { const next = [...images]; next[idx] = e.target.value; setImages(next); }}
                            placeholder="https://..." className="glass-input flex-1 text-[12px]" />
                          <button onClick={() => setImages(images.filter((_, i) => i !== idx))}
                            className="p-1 text-text-tertiary hover:text-danger"><X size={12} /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Preview panel (when toggled) ── */}
              {showPreview && (
                <div className="space-y-4">
                  <div className="section-card overflow-hidden">
                    <div className="px-4 py-3 bg-surface-secondary border-b border-outline flex items-center justify-between">
                      <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                        {fr ? 'Aperçu vue client' : 'Client View Preview'}
                      </p>
                      <span className="text-[9px] text-text-tertiary bg-surface px-2 py-0.5 rounded-full border border-outline">
                        {fr ? 'Données simulées' : 'Sample data'}
                      </span>
                    </div>
                    <div className="bg-gray-100 p-4">
                      <div className="mx-auto max-w-[540px] rounded-lg bg-white shadow-md overflow-hidden">
                        <QuoteRenderer data={previewData} />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Footer ── */}
          <div className="px-6 pt-4 pb-6 border-t border-border-light bg-surface-secondary flex items-center justify-end gap-3">
            <button type="button" onClick={() => setMode('list')} className="glass-button px-5 py-2.5 text-sm font-medium">
              {fr ? 'Annuler' : 'Cancel'}
            </button>
            <button type="button" onClick={handleSave} disabled={saving}
              className="glass-button-primary px-6 py-2.5 text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
              <Save size={15} />
              {saving ? (fr ? 'Sauvegarde...' : 'Saving...') : (fr ? 'Sauvegarder' : 'Save Preset')}
            </button>
          </div>
        </motion.div>
      </div>

      <ServicePicker
        isOpen={servicePickerOpen}
        onClose={() => setServicePickerOpen(false)}
        onSelect={handleServiceSelected}
        onRemove={handleServiceRemoved}
        addedIds={addedServiceIds}
      />
    </>
  );

  // ═══ LIST VIEW ═══
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] font-bold text-text-primary">
            {fr ? 'Presets de devis' : 'Quote Presets'}
          </h1>
          <p className="text-[13px] text-text-tertiary mt-1">
            {fr ? 'Presets de contenu pour accélérer la création de devis' : 'Content presets to speed up quote creation'}
          </p>
        </div>
        <button onClick={startCreate}
          className="inline-flex items-center gap-2 h-10 px-5 bg-primary text-white rounded-md text-[14px] font-medium hover:bg-primary-hover active:scale-[0.98] transition-all">
          <Plus size={15} /> {fr ? 'Nouveau preset' : 'New Preset'}
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="section-card p-5 animate-pulse">
              <div className="h-4 w-32 bg-surface-tertiary rounded mb-3" />
              <div className="h-3 w-full bg-surface-tertiary rounded mb-2" />
              <div className="h-3 w-2/3 bg-surface-tertiary rounded" />
            </div>
          ))}
        </div>
      ) : presets.length === 0 ? (
        <div className="section-card p-12 text-center">
          <Package size={32} className="mx-auto text-text-tertiary opacity-40 mb-3" />
          <p className="text-[14px] font-medium text-text-secondary">
            {fr ? 'Aucun preset encore' : 'No presets yet'}
          </p>
          <p className="text-[12px] text-text-tertiary mt-1 max-w-sm mx-auto">
            {fr ? 'Créez des presets pour préremplir vos devis par type de service.' : 'Create presets to pre-fill quotes by service type.'}
          </p>
          <button onClick={startCreate}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-[13px] font-medium hover:bg-primary-hover transition-all">
            <Plus size={14} /> {fr ? 'Créer un preset' : 'Create Preset'}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {presets.map(preset => (
            <motion.div key={preset.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="section-card overflow-hidden group hover:shadow-md transition-shadow"
            >
              {preset.cover_image && (
                <div className="h-28 bg-surface-tertiary overflow-hidden">
                  <img src={preset.cover_image} alt="" className="w-full h-full object-cover" />
                </div>
              )}
              <div className="p-4 space-y-2">
                <p className="text-[14px] font-semibold text-text-primary truncate">{preset.name}</p>
                {preset.description && (
                  <p className="text-[11px] text-text-tertiary line-clamp-2">{preset.description}</p>
                )}
                <div className="flex items-center gap-3 text-[11px] text-text-tertiary">
                  <span className="flex items-center gap-1">
                    <Package size={10} />
                    {preset.services.length} {preset.services.length === 1 ? 'service' : 'services'}
                  </span>
                  {preset.images.length > 0 && (
                    <span className="flex items-center gap-1">
                      <ImageIcon size={10} /> {preset.images.length}
                    </span>
                  )}
                </div>
                {preset.services.length > 0 && (
                  <div className="space-y-0.5">
                    {preset.services.slice(0, 3).map(s => (
                      <p key={s.id} className="text-[11px] text-text-secondary truncate">• {s.name}</p>
                    ))}
                    {preset.services.length > 3 && (
                      <p className="text-[10px] text-text-tertiary">+{preset.services.length - 3} more</p>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-1.5 pt-2 border-t border-outline/30">
                  <button onClick={() => startEdit(preset)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-medium text-text-secondary hover:bg-surface-secondary hover:text-text-primary transition-all">
                    <Edit2 size={11} /> {fr ? 'Modifier' : 'Edit'}
                  </button>
                  <button onClick={() => handleDuplicate(preset)}
                    className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[11px] text-text-tertiary hover:bg-surface-secondary hover:text-text-primary transition-all">
                    <Copy size={11} />
                  </button>
                  <button onClick={() => handleDelete(preset)}
                    className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[11px] text-text-tertiary hover:bg-surface-secondary hover:text-danger transition-all">
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Edit modal (renders on top of list) */}
      {editModal}
    </div>
  );
}
