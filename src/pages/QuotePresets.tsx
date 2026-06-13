/* ═══════════════════════════════════════════════════════════════
   Page — Quote Content Templates (Section Builder)
   "New Template" opens a near-blank, full-page builder.
   Content is composed from modular sections you add one by one:
   Introduction · Product/Service · Attachments · Images ·
   Reviews · Client message · Contract / Disclaimer.
   Canonical fields (intro_text, services, notes, images, terms,
   deposit_*) are kept in sync so quote creation still works; the
   full section layout is persisted in custom_fields.sections.
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import {
  Plus, Trash2, Copy, Edit2, Package, X, Image as ImageIcon,
  Save, Eye, EyeOff, ChevronLeft, ChevronUp, ChevronDown,
  FileText, Paperclip, Star, MessageSquare, ScrollText, Type as TypeIcon,
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
import type { QuotePreset } from '../types';
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
  item_type: 'service' | 'text';
}

/* ── Section model ──
   Each section type can be added once. Per-type data lives on the
   same object (optional fields) to keep updates simple. */
type SectionType =
  | 'introduction'
  | 'products'
  | 'attachments'
  | 'images'
  | 'reviews'
  | 'client_message'
  | 'contract';

interface Section {
  id: string;
  type: SectionType;
  // introduction · client_message · contract
  text?: string;
  // products
  items?: LineItemForm[];
  depositEnabled?: boolean;
  depositType?: 'percent' | 'fixed';
  depositValue?: string;
  // images
  images?: string[];
  // attachments
  attachments?: { name: string; url: string }[];
  // reviews
  reviews?: { author: string; text: string }[];
}

function emptyLine(): LineItemForm {
  return {
    id: crypto.randomUUID(), source_service_id: null, name: '', description: '',
    qtyInput: '1', is_optional: false, item_type: 'service',
  };
}

function emptyText(): LineItemForm {
  return {
    id: crypto.randomUUID(), source_service_id: null, name: '', description: '',
    qtyInput: '1', is_optional: false, item_type: 'text',
  };
}

function newSection(type: SectionType): Section {
  switch (type) {
    case 'products':
      return { id: crypto.randomUUID(), type, items: [emptyLine()], depositEnabled: false, depositType: 'percent', depositValue: '' };
    case 'images':
      return { id: crypto.randomUUID(), type, images: [''] };
    case 'attachments':
      return { id: crypto.randomUUID(), type, attachments: [{ name: '', url: '' }] };
    case 'reviews':
      return { id: crypto.randomUUID(), type, reviews: [{ author: '', text: '' }] };
    default:
      return { id: crypto.randomUUID(), type, text: '' };
  }
}

const inputCls = 'glass-input w-full mt-1.5';

export default function QuotePresets() {
  const navigate = useNavigate();
  const { language, t } = useTranslation();
  const fr = language === 'fr';

  /* ── Section catalog (label + icon per type) ── */
  const SECTION_DEFS: { type: SectionType; label: string; desc: string; Icon: typeof FileText }[] = [
    { type: 'introduction', label: fr ? 'Introduction' : 'Introduction', desc: fr ? 'Texte d\'accueil en haut du devis' : 'Welcome text at the top of the quote', Icon: FileText },
    { type: 'products', label: fr ? 'Produit / Service' : 'Product / Service', desc: fr ? 'Lignes de prix, dépôt requis' : 'Line items, required deposit', Icon: Package },
    { type: 'attachments', label: fr ? 'Pièces jointes' : 'Attachments', desc: fr ? 'Documents liés au devis' : 'Documents attached to the quote', Icon: Paperclip },
    { type: 'images', label: fr ? 'Images' : 'Images', desc: fr ? 'Galerie de photos' : 'Photo gallery', Icon: ImageIcon },
    { type: 'reviews', label: fr ? 'Avis' : 'Reviews', desc: fr ? 'Témoignages clients' : 'Client testimonials', Icon: Star },
    { type: 'client_message', label: fr ? 'Message au client' : 'Client message', desc: fr ? 'Note personnelle pour le client' : 'Personal note for the client', Icon: MessageSquare },
    { type: 'contract', label: fr ? 'Contrat / Avis légal' : 'Contract / Disclaimer', desc: fr ? 'Termes et conditions' : 'Terms and conditions', Icon: ScrollText },
  ];
  const sectionDef = (type: SectionType) => SECTION_DEFS.find(d => d.type === type)!;

  const [presets, setPresets] = useState<QuotePreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ViewMode>('list');
  const [editingPreset, setEditingPreset] = useState<QuotePreset | null>(null);

  // Edit form state
  const [name, setName] = useState('');
  const [sections, setSections] = useState<Section[]>([]);
  const [addedServiceIds, setAddedServiceIds] = useState<Set<string>>(new Set());
  const [servicePickerOpen, setServicePickerOpen] = useState(false);
  // Per-line catalog picker: id of the line whose product/service is being chosen
  const [lineEditId, setLineEditId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [companySettings, setCompanySettings] = useState<any>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadPresets(); }, []);
  useEffect(() => { getCompanySettings().then(setCompanySettings).catch(() => {}); }, []);

  // Close "Add section" menu on outside click
  useEffect(() => {
    if (!addMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setAddMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [addMenuOpen]);

  async function loadPresets() {
    setLoading(true);
    try { setPresets(await listQuotePresets()); }
    catch { setPresets([]); }
    finally { setLoading(false); }
  }

  // Next default name: "Quote Template #N"
  function nextTemplateName(): string {
    const base = fr ? 'Modèle de devis' : 'Quote Template';
    let max = 0;
    for (const p of presets) {
      const m = /#(\d+)\s*$/.exec(p.name || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${base} #${Math.max(max, presets.length) + 1}`;
  }

  function startCreate() {
    setEditingPreset(null);
    setName(nextTemplateName());
    // Near-blank: only the core Product/Service section to start with.
    setSections([newSection('products')]);
    setAddedServiceIds(new Set());
    setAddMenuOpen(false);
    setShowPreview(false);
    setMode('edit');
  }

  function startEdit(preset: QuotePreset) {
    setEditingPreset(preset);
    setName(preset.name);
    setSections(reconstructSections(preset));
    setAddedServiceIds(new Set());
    setAddMenuOpen(false);
    setShowPreview(false);
    setMode('edit');
  }

  /* Rebuild section list from a saved preset.
     Prefer the persisted section layout; fall back to legacy fields. */
  function reconstructSections(preset: QuotePreset): Section[] {
    const saved = preset.custom_fields?.sections;
    if (Array.isArray(saved) && saved.length > 0) {
      return saved.map((s: any) => ({
        id: s.id || crypto.randomUUID(),
        type: s.type,
        text: s.text ?? '',
        items: Array.isArray(s.items)
          ? s.items.map((i: any) => ({
              id: i.id || crypto.randomUUID(),
              source_service_id: null,
              name: i.name || '',
              description: i.description || '',
              qtyInput: String(i.quantity || 1),
              is_optional: !!i.is_optional,
              item_type: i.item_type === 'text' ? 'text' : 'service',
            }))
          : undefined,
        depositEnabled: !!s.depositEnabled,
        depositType: s.depositType === 'fixed' ? 'fixed' : 'percent',
        depositValue: s.depositValue != null ? String(s.depositValue) : '',
        images: Array.isArray(s.images) ? s.images : undefined,
        attachments: Array.isArray(s.attachments) ? s.attachments : undefined,
        reviews: Array.isArray(s.reviews) ? s.reviews : undefined,
      }));
    }

    // Legacy fallback: synthesize sections from canonical fields.
    const out: Section[] = [];
    if (preset.intro_text) out.push({ id: crypto.randomUUID(), type: 'introduction', text: preset.intro_text });
    out.push({
      id: crypto.randomUUID(),
      type: 'products',
      items: preset.services.length > 0
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
      depositEnabled: !!preset.deposit_required,
      depositType: preset.deposit_type === 'fixed' ? 'fixed' : 'percent',
      depositValue: preset.deposit_value ? String(preset.deposit_value) : '',
    });
    const imgs = [preset.cover_image, ...(preset.images || [])].filter(Boolean) as string[];
    if (imgs.length > 0) out.push({ id: crypto.randomUUID(), type: 'images', images: imgs });
    if (preset.notes) out.push({ id: crypto.randomUUID(), type: 'client_message', text: preset.notes });
    if (preset.terms) out.push({ id: crypto.randomUUID(), type: 'contract', text: preset.terms });
    return out;
  }

  async function handleSave() {
    if (!name.trim()) { toast.error(fr ? 'Nom requis' : 'Name is required'); return; }
    setSaving(true);

    const intro = sections.find(s => s.type === 'introduction');
    const products = sections.find(s => s.type === 'products');
    const imagesSec = sections.find(s => s.type === 'images');
    const message = sections.find(s => s.type === 'client_message');
    const contract = sections.find(s => s.type === 'contract');

    const allImages = (imagesSec?.images || []).filter(Boolean);
    const services = (products?.items || [])
      .filter(i => i.name.trim())
      .map(i => ({
        id: i.id,
        name: i.name.trim(),
        description: i.description || '',
        quantity: Math.max(1, parseInt(i.qtyInput) || 1),
        is_optional: i.is_optional,
      }));

    // Persist the full section layout for faithful round-tripping.
    const serializedSections = sections.map(s => ({
      id: s.id,
      type: s.type,
      text: s.text || '',
      items: (s.items || []).map(i => ({
        id: i.id, name: i.name, description: i.description,
        quantity: Math.max(1, parseInt(i.qtyInput) || 1),
        is_optional: i.is_optional, item_type: i.item_type,
      })),
      depositEnabled: !!s.depositEnabled,
      depositType: s.depositType || 'percent',
      depositValue: s.depositValue || '',
      images: (s.images || []).filter(Boolean),
      attachments: (s.attachments || []).filter(a => a.name?.trim() || a.url?.trim()),
      reviews: (s.reviews || []).filter(r => r.author?.trim() || r.text?.trim()),
    }));

    const payload: QuotePresetPayload = {
      name: name.trim(),
      description: null,
      cover_image: allImages[0] || null,
      images: allImages,
      services,
      notes: message?.text?.trim() || null,
      intro_text: intro?.text?.trim() || null,
      terms: contract?.text?.trim() || null,
      deposit_required: !!products?.depositEnabled,
      deposit_type: products?.depositEnabled ? (products.depositType || 'percent') : null,
      deposit_value: products?.depositEnabled ? (parseFloat(products.depositValue || '0') || 0) : 0,
      custom_fields: { sections: serializedSections },
      is_active: true,
    };

    try {
      if (editingPreset) {
        await updateQuotePreset(editingPreset.id, payload);
        toast.success(fr ? 'Modèle mis à jour' : 'Template updated');
      } else {
        await createQuotePreset(payload);
        toast.success(fr ? 'Modèle créé' : 'Template created');
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

  // ── Section handlers ──
  const updateSection = (id: string, patch: Partial<Section>) =>
    setSections(p => p.map(s => s.id === id ? { ...s, ...patch } : s));

  const addSection = (type: SectionType) => {
    setSections(p => [...p, newSection(type)]);
    setAddMenuOpen(false);
  };

  const removeSection = (id: string) =>
    setSections(p => p.filter(s => s.id !== id));

  const moveSection = (id: string, dir: -1 | 1) =>
    setSections(p => {
      const idx = p.findIndex(s => s.id === id);
      const next = idx + dir;
      if (idx === -1 || next < 0 || next >= p.length) return p;
      const copy = [...p];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });

  const productsSection = sections.find(s => s.type === 'products');

  // ── Line item handlers (scoped to the products section) ──
  const updateLine = (sectionId: string, lineId: string, patch: Partial<LineItemForm>) =>
    setSections(p => p.map(s => s.id === sectionId
      ? { ...s, items: (s.items || []).map(i => i.id === lineId ? { ...i, ...patch } : i) }
      : s));

  const removeLine = (sectionId: string, lineId: string) =>
    setSections(p => p.map(s => {
      if (s.id !== sectionId) return s;
      const items = s.items || [];
      const item = items.find(i => i.id === lineId);
      if (item?.source_service_id) {
        setAddedServiceIds(prev => { const n = new Set(prev); n.delete(item.source_service_id!); return n; });
      }
      return { ...s, items: items.length > 1 ? items.filter(i => i.id !== lineId) : items };
    }));

  const handleServiceSelected = (service: PredefinedService) => {
    if (!productsSection) return;
    const sid = productsSection.id;
    setSections(p => p.map(s => {
      if (s.id !== sid) return s;
      const items = s.items || [];
      const empty = items.findIndex(i => !i.name.trim() && i.item_type === 'service');
      const line: LineItemForm = {
        id: crypto.randomUUID(), source_service_id: service.id,
        name: service.name, description: service.description || '',
        qtyInput: '1', is_optional: false, item_type: 'service',
      };
      const nextItems = empty !== -1
        ? items.map((it, i) => i === empty ? line : it)
        : [...items, line];
      return { ...s, items: nextItems };
    }));
    setAddedServiceIds(p => new Set([...p, service.id]));
  };

  const handleServiceRemoved = (serviceId: string) => {
    if (!productsSection) return;
    const sid = productsSection.id;
    setSections(p => p.map(s => {
      if (s.id !== sid) return s;
      const filtered = (s.items || []).filter(i => i.source_service_id !== serviceId);
      return { ...s, items: filtered.length > 0 ? filtered : [emptyLine()] };
    }));
    setAddedServiceIds(p => { const n = new Set(p); n.delete(serviceId); return n; });
  };

  // Fill a single line with the chosen catalog product/service
  const handleServiceForLine = (service: PredefinedService) => {
    if (!lineEditId) return;
    setSections(p => p.map(s => ({
      ...s,
      items: (s.items || []).map(i => i.id === lineEditId ? {
        ...i, source_service_id: service.id, name: service.name,
        description: service.description || '', item_type: 'service',
      } : i),
    })));
    setAddedServiceIds(p => new Set([...p, service.id]));
    setLineEditId(null);
  };

  // ── Build preview data from sections ──
  const previewData: QuoteRenderData = useMemo(() => {
    const intro = sections.find(s => s.type === 'introduction')?.text || null;
    const notes = sections.find(s => s.type === 'client_message')?.text || null;
    const contract = sections.find(s => s.type === 'contract')?.text || null;
    const items = productsSection?.items || [];
    const validItems = items.filter(i => i.name.trim() && !i.is_optional);
    const optItems = items.filter(i => i.name.trim() && i.is_optional);
    return {
      quote_number: 'QTE-PREVIEW',
      title: name || (fr ? 'Aperçu du modèle' : 'Template Preview'),
      status: 'draft',
      valid_until: null,
      created_at: new Date().toISOString(),
      notes,
      currency: 'CAD',
      subtotal_cents: 0,
      discount_cents: 0,
      tax_cents: 0,
      tax_rate: 0,
      tax_rate_label: '',
      total_cents: 0,
      deposit_required: !!productsSection?.depositEnabled,
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
      introduction: intro,
      contract_disclaimer: contract,
      items: validItems.map(i => ({
        id: i.id, name: i.name, description: i.description || null,
        qty: parseInt(i.qtyInput) || 1, unit_price_cents: 0, total_cents: 0, item_type: i.item_type,
      })),
      optional_items: optItems.map(i => ({
        id: i.id, name: i.name, description: i.description || null,
        qty: parseInt(i.qtyInput) || 1, unit_price_cents: 0, total_cents: 0, item_type: i.item_type,
      })),
    };
  }, [name, sections, productsSection, companySettings, fr]);

  const availableToAdd = SECTION_DEFS.filter(d => !sections.some(s => s.type === d.type));

  /* ═══ SECTION RENDERERS ═══ */

  function renderProducts(section: Section) {
    const items = section.items || [];
    return (
      <div className="space-y-4">
        {items.map(item => item.item_type === 'text' ? (
          /* ── Text block ── */
          <div key={item.id} className="flex items-start gap-3 p-3 rounded-lg border border-dashed border-outline bg-surface-secondary/40">
            <TypeIcon size={15} className="text-text-tertiary mt-2.5 shrink-0" />
            <textarea value={item.name} onChange={e => updateLine(section.id, item.id, { name: e.target.value })}
              rows={2} placeholder={fr ? 'Texte libre (titre, note de section…)' : 'Free text (heading, section note…)'}
              className="glass-input flex-1 py-2 text-sm resize-none" />
            <button type="button" onClick={() => removeLine(section.id, item.id)} disabled={items.length === 1}
              className="p-1 mt-2 text-text-tertiary hover:text-danger disabled:opacity-30"><Trash2 size={14} /></button>
          </div>
        ) : (
          /* ── Service line ── */
          <div key={item.id} className={cn(
            'grid grid-cols-12 gap-3 items-start p-3 rounded-lg border transition-all',
            item.is_optional ? 'border-dashed border-outline bg-surface-secondary/50' : 'border-outline bg-surface',
          )}>
            <div className="col-span-8 space-y-1">
              <button type="button" onClick={() => setLineEditId(item.id)}
                className={cn(inputCls, 'py-2 text-left flex items-center justify-between gap-2', !item.name.trim() && 'text-text-tertiary')}>
                <span className="truncate">{item.name.trim() || t.servicePicker.choosePlaceholder}</span>
                <Package size={13} className="text-text-tertiary shrink-0" />
              </button>
              <textarea value={item.description} onChange={e => updateLine(section.id, item.id, { description: e.target.value })}
                className={cn(inputCls, 'py-1.5 text-xs min-h-[40px] resize-none')} placeholder="Description" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-text-tertiary">{fr ? 'Quantité' : 'Quantity'}</label>
              <input value={item.qtyInput} onChange={e => updateLine(section.id, item.id, { qtyInput: e.target.value.replace(/[^\d]/g, '') || '1' })}
                className={cn(inputCls, 'py-2 text-center')} />
            </div>
            <div className="col-span-2 flex flex-col items-center gap-1 pt-5">
              <button type="button" onClick={() => removeLine(section.id, item.id)} disabled={items.length === 1}
                className="p-1 text-text-tertiary hover:text-danger disabled:opacity-30"><Trash2 size={14} /></button>
            </div>
            <div className="col-span-12">
              <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                <input type="checkbox" checked={item.is_optional} onChange={e => updateLine(section.id, item.id, { is_optional: e.target.checked })}
                  className="h-3.5 w-3.5 rounded" />
                {fr ? 'Marquer comme optionnel' : 'Mark as optional'}
              </label>
            </div>
          </div>
        ))}

        {/* Add line / Add text */}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => updateSection(section.id, { items: [...items, emptyLine()] })}
            className="glass-button-primary px-3 py-2 text-xs font-semibold flex items-center gap-1.5">
            <Plus size={12} /> {fr ? 'Ajouter une ligne' : 'Add Line Item'}
          </button>
          <button type="button" onClick={() => updateSection(section.id, { items: [...items, emptyText()] })}
            className="glass-button px-3 py-2 text-xs font-semibold flex items-center gap-1.5">
            <TypeIcon size={12} /> {fr ? 'Ajouter du texte' : 'Add Text'}
          </button>
          <button type="button" onClick={() => setServicePickerOpen(true)}
            className="glass-button px-3 py-2 text-xs font-semibold flex items-center gap-1.5">
            <Package size={12} /> {fr ? 'Du catalogue' : 'From catalog'}
          </button>
        </div>

        {/* Totals */}
        <div className="rounded-lg border border-outline bg-surface-secondary/50 p-4 space-y-1.5">
          <div className="flex items-center justify-between text-sm text-text-secondary">
            <span>{fr ? 'Sous-total' : 'Subtotal'}</span>
            <span className="tabular-nums">{formatQuoteMoney(0)}</span>
          </div>
          <div className="flex items-center justify-between text-[15px] font-bold text-text-primary pt-1.5 border-t border-outline">
            <span>{fr ? 'Total' : 'Total'}</span>
            <span className="tabular-nums">{formatQuoteMoney(0)}</span>
          </div>
          <p className="text-[11px] text-text-tertiary pt-1">
            {fr ? 'Les prix seront ajoutés lors de la création du devis.' : 'Pricing is added when the quote is created.'}
          </p>
        </div>

        {/* Required deposit */}
        <div className="rounded-lg border border-outline p-4">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
            {fr ? 'Dépôt requis' : 'Required Deposit'}
          </p>
          {section.depositEnabled ? (
            <div className="flex items-center gap-2">
              <select value={section.depositType} onChange={e => updateSection(section.id, { depositType: e.target.value as 'percent' | 'fixed' })}
                className="glass-input py-2 text-sm w-28">
                <option value="percent">%</option>
                <option value="fixed">{fr ? 'Montant' : 'Amount'}</option>
              </select>
              <input value={section.depositValue} onChange={e => updateSection(section.id, { depositValue: e.target.value.replace(/[^\d.]/g, '') })}
                placeholder={section.depositType === 'percent' ? '25' : '100.00'}
                className="glass-input py-2 text-sm flex-1" />
              <button type="button" onClick={() => updateSection(section.id, { depositEnabled: false, depositValue: '' })}
                className="p-2 text-text-tertiary hover:text-danger"><X size={15} /></button>
            </div>
          ) : (
            <button type="button" onClick={() => updateSection(section.id, { depositEnabled: true })}
              className="glass-button px-3 py-2 text-xs font-semibold flex items-center gap-1.5">
              <Plus size={12} /> {fr ? 'Ajouter un dépôt requis' : 'Add Required Deposit'}
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderImages(section: Section) {
    const images = section.images || [];
    return (
      <div className="space-y-1.5">
        {images.map((url, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <input value={url} onChange={e => { const next = [...images]; next[idx] = e.target.value; updateSection(section.id, { images: next }); }}
              placeholder="https://..." className="glass-input flex-1 text-[13px]" />
            {url && (
              <div className="h-9 w-9 rounded-md overflow-hidden bg-surface-tertiary shrink-0">
                <img src={url} alt="" className="w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
              </div>
            )}
            <button type="button" onClick={() => updateSection(section.id, { images: images.filter((_, i) => i !== idx) })}
              className="p-1 text-text-tertiary hover:text-danger"><X size={13} /></button>
          </div>
        ))}
        <button type="button" onClick={() => updateSection(section.id, { images: [...images, ''] })}
          className="glass-button px-3 py-2 text-xs font-semibold flex items-center gap-1.5">
          <Plus size={12} /> {fr ? 'Ajouter une image' : 'Add Image'}
        </button>
      </div>
    );
  }

  function renderAttachments(section: Section) {
    const atts = section.attachments || [];
    return (
      <div className="space-y-2">
        {atts.map((att, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <input value={att.name} onChange={e => { const next = [...atts]; next[idx] = { ...att, name: e.target.value }; updateSection(section.id, { attachments: next }); }}
              placeholder={fr ? 'Nom du fichier' : 'File name'} className="glass-input text-[13px] w-1/3" />
            <input value={att.url} onChange={e => { const next = [...atts]; next[idx] = { ...att, url: e.target.value }; updateSection(section.id, { attachments: next }); }}
              placeholder="https://..." className="glass-input flex-1 text-[13px]" />
            <button type="button" onClick={() => updateSection(section.id, { attachments: atts.filter((_, i) => i !== idx) })}
              className="p-1 text-text-tertiary hover:text-danger"><X size={13} /></button>
          </div>
        ))}
        <button type="button" onClick={() => updateSection(section.id, { attachments: [...atts, { name: '', url: '' }] })}
          className="glass-button px-3 py-2 text-xs font-semibold flex items-center gap-1.5">
          <Plus size={12} /> {fr ? 'Ajouter une pièce jointe' : 'Add Attachment'}
        </button>
      </div>
    );
  }

  function renderReviews(section: Section) {
    const reviews = section.reviews || [];
    return (
      <div className="space-y-3">
        {reviews.map((rev, idx) => (
          <div key={idx} className="rounded-lg border border-outline p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input value={rev.author} onChange={e => { const next = [...reviews]; next[idx] = { ...rev, author: e.target.value }; updateSection(section.id, { reviews: next }); }}
                placeholder={fr ? 'Nom du client' : 'Client name'} className="glass-input flex-1 text-[13px]" />
              <button type="button" onClick={() => updateSection(section.id, { reviews: reviews.filter((_, i) => i !== idx) })}
                className="p-1 text-text-tertiary hover:text-danger"><X size={13} /></button>
            </div>
            <textarea value={rev.text} onChange={e => { const next = [...reviews]; next[idx] = { ...rev, text: e.target.value }; updateSection(section.id, { reviews: next }); }}
              rows={2} placeholder={fr ? 'Témoignage…' : 'Testimonial…'} className="glass-input w-full text-[13px] resize-none" />
          </div>
        ))}
        <button type="button" onClick={() => updateSection(section.id, { reviews: [...reviews, { author: '', text: '' }] })}
          className="glass-button px-3 py-2 text-xs font-semibold flex items-center gap-1.5">
          <Plus size={12} /> {fr ? 'Ajouter un avis' : 'Add Review'}
        </button>
      </div>
    );
  }

  function renderTextarea(section: Section, placeholder: string) {
    return (
      <textarea value={section.text || ''} onChange={e => updateSection(section.id, { text: e.target.value })}
        rows={4} placeholder={placeholder} className="glass-input w-full resize-none" />
    );
  }

  function renderSectionBody(section: Section) {
    switch (section.type) {
      case 'products': return renderProducts(section);
      case 'images': return renderImages(section);
      case 'attachments': return renderAttachments(section);
      case 'reviews': return renderReviews(section);
      case 'introduction': return renderTextarea(section, fr ? 'Texte affiché en haut du devis…' : 'Text shown at the top of the quote…');
      case 'client_message': return renderTextarea(section, fr ? 'Message personnel pour le client…' : 'Personal message for the client…');
      case 'contract': return renderTextarea(section, fr ? 'Termes, conditions et avis légal…' : 'Terms, conditions and disclaimer…');
      default: return null;
    }
  }

  /* ═══ EDIT VIEW (full page section builder) ═══ */
  if (mode === 'edit') {
    return (
      <div className="space-y-5 pb-24">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setMode('list')}
              className="p-2 rounded-xl border border-outline hover:bg-surface-tertiary text-text-tertiary hover:text-text-primary transition-colors shrink-0">
              <ChevronLeft size={18} />
            </button>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder={fr ? 'Nom du modèle' : 'Template name'}
              className="text-[24px] font-bold text-text-primary bg-transparent border-0 border-b-2 border-transparent focus:border-primary focus:outline-none px-1 py-0.5 min-w-0 flex-1" />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setShowPreview(!showPreview)}
              className={cn(
                'inline-flex items-center gap-2 h-9 px-3 rounded-xl text-[12px] font-medium border transition-all',
                showPreview ? 'bg-primary/10 text-primary border-primary/30' : 'border-outline text-text-secondary hover:bg-surface-tertiary',
              )}>
              {showPreview ? <EyeOff size={13} /> : <Eye size={13} />}
              {fr ? 'Aperçu' : 'Preview'}
            </button>
            <button onClick={() => setMode('list')} className="glass-button px-4 py-2 text-sm font-medium">
              {fr ? 'Annuler' : 'Cancel'}
            </button>
            <button onClick={handleSave} disabled={saving}
              className="glass-button-primary px-5 py-2 text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
              <Save size={15} />
              {saving ? (fr ? 'Sauvegarde…' : 'Saving…') : (fr ? 'Sauvegarder' : 'Save')}
            </button>
          </div>
        </div>

        <div className={cn('grid gap-6', showPreview ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1')}>
          {/* ── Builder column ── */}
          <div className="space-y-4 max-w-3xl">
            {sections.length === 0 && (
              <div className="section-card p-10 text-center border-dashed">
                <p className="text-[13px] text-text-tertiary">
                  {fr ? 'Modèle vide — ajoutez une section pour commencer.' : 'Blank template — add a section to get started.'}
                </p>
              </div>
            )}

            {sections.map((section, idx) => {
              const def = sectionDef(section.type);
              return (
                <motion.div key={section.id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="section-card overflow-hidden">
                  <div className="px-4 py-3 bg-surface-secondary border-b border-outline flex items-center justify-between">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <def.Icon size={14} className="text-primary" />
                      </div>
                      <h3 className="text-[14px] font-bold tracking-tight text-text-primary truncate">{def.label}</h3>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button type="button" onClick={() => moveSection(section.id, -1)} disabled={idx === 0}
                        className="p-1.5 rounded-lg text-text-tertiary hover:bg-surface-tertiary hover:text-text-primary disabled:opacity-25 transition-colors"><ChevronUp size={15} /></button>
                      <button type="button" onClick={() => moveSection(section.id, 1)} disabled={idx === sections.length - 1}
                        className="p-1.5 rounded-lg text-text-tertiary hover:bg-surface-tertiary hover:text-text-primary disabled:opacity-25 transition-colors"><ChevronDown size={15} /></button>
                      <button type="button" onClick={() => removeSection(section.id)}
                        className="p-1.5 rounded-lg text-text-tertiary hover:bg-surface-tertiary hover:text-danger transition-colors"><Trash2 size={15} /></button>
                    </div>
                  </div>
                  <div className="p-5">{renderSectionBody(section)}</div>
                </motion.div>
              );
            })}

            {/* ── Add section ── */}
            <div className="relative" ref={addMenuRef}>
              <button type="button" onClick={() => setAddMenuOpen(o => !o)}
                disabled={availableToAdd.length === 0}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-outline text-text-secondary hover:border-primary/50 hover:text-primary disabled:opacity-40 disabled:hover:border-outline disabled:hover:text-text-secondary transition-all text-sm font-semibold">
                <Plus size={16} /> {fr ? 'Ajouter une section' : 'Add section'}
              </button>
              {addMenuOpen && availableToAdd.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                  className="absolute z-20 left-0 right-0 mt-2 bg-surface rounded-xl border border-outline shadow-xl overflow-hidden">
                  {availableToAdd.map(def => (
                    <button key={def.type} type="button" onClick={() => addSection(def.type)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-secondary transition-colors border-b border-outline/40 last:border-0">
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <def.Icon size={15} className="text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-text-primary">{def.label}</p>
                        <p className="text-[11px] text-text-tertiary truncate">{def.desc}</p>
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}
            </div>
          </div>

          {/* ── Preview column ── */}
          {showPreview && (
            <div className="lg:sticky lg:top-4 self-start">
              <div className="section-card overflow-hidden">
                <div className="px-4 py-3 bg-surface-secondary border-b border-outline flex items-center justify-between">
                  <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                    {fr ? 'Aperçu vue client' : 'Client View Preview'}
                  </p>
                  <span className="text-[9px] text-text-tertiary bg-surface px-2 py-0.5 rounded-full border border-outline">
                    {fr ? 'Données simulées' : 'Sample data'}
                  </span>
                </div>
                <div className="bg-gray-100 p-4 max-h-[80vh] overflow-y-auto">
                  <div className="mx-auto max-w-[540px] rounded-lg bg-white shadow-md overflow-hidden">
                    <QuoteRenderer data={previewData} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Catalog pickers */}
        <ServicePicker
          isOpen={servicePickerOpen}
          onClose={() => setServicePickerOpen(false)}
          onSelect={handleServiceSelected}
          onRemove={handleServiceRemoved}
          addedIds={addedServiceIds}
        />
        {lineEditId && (
          <ServicePicker isOpen singleSelect onClose={() => setLineEditId(null)} onSelect={handleServiceForLine} />
        )}
      </div>
    );
  }

  /* ═══ LIST VIEW ═══ */
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] font-bold text-text-primary">
            {fr ? 'Modèles de devis' : 'Quote Templates'}
          </h1>
          <p className="text-[13px] text-text-tertiary mt-1">
            {fr ? 'Modèles de contenu réutilisables pour accélérer la création de devis' : 'Reusable content templates to speed up quote creation'}
          </p>
        </div>
        <button onClick={startCreate}
          className="inline-flex items-center gap-2 h-10 px-5 bg-primary text-white rounded-md text-[14px] font-medium hover:bg-primary-hover active:scale-[0.98] transition-all">
          {fr ? 'Nouveau modèle' : 'New Template'}
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
            {fr ? 'Aucun modèle encore' : 'No templates yet'}
          </p>
          <p className="text-[12px] text-text-tertiary mt-1 max-w-sm mx-auto">
            {fr ? 'Créez des modèles pour préremplir vos devis par type de service.' : 'Create templates to pre-fill quotes by service type.'}
          </p>
          <button onClick={startCreate}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-[13px] font-medium hover:bg-primary-hover transition-all">
            <Plus size={14} /> {fr ? 'Créer un modèle' : 'Create Template'}
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
    </div>
  );
}
