import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FileText, Plus, Trash2, X, Package, ChevronDown, User, Mail, Phone, MapPin, Download } from 'lucide-react';
import { cn } from '../../lib/utils';
import { listSalespeople } from '../../lib/jobsApi';
import { listClients } from '../../lib/clientsApi';
import {
  createQuote, formatQuoteMoney, fetchLeadJobLineItems,
  type QuoteLineItemInput, type QuoteSectionInput, type QuoteDetail,
} from '../../lib/quotesApi';
import { createLeadScoped, fetchLeadsScoped } from '../../lib/leadsApi';
import AddressAutocomplete, { type StructuredAddress } from '../AddressAutocomplete';
import ServicePicker from '../ServicePicker';
import type { PredefinedService } from '../../lib/servicesApi';
import type { Lead, QuotePreset } from '../../types';
import { resolveTaxes, calculateTaxes, type TaxConfig } from '../../lib/taxApi';
import { useTranslation } from '../../i18n';
import SpecificNotesInline, { type SpecificNotesInlineHandle } from '../SpecificNotesInline';

interface QuoteCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (detail: QuoteDetail) => void;
  lead?: Lead | null;
  createLeadInline?: boolean;
  preset?: QuotePreset | null;
}

interface LineItemForm {
  id: string;
  source_service_id: string | null;
  name: string;
  description: string;
  qtyInput: string;
  unitPriceInput: string;
  is_optional: boolean;
  item_type: 'service' | 'text' | 'heading';
}

function emptyLine(): LineItemForm {
  return {
    id: crypto.randomUUID(), source_service_id: null, name: '', description: '',
    qtyInput: '1', unitPriceInput: '0', is_optional: false, item_type: 'service',
  };
}

function sanitize(v: string) { return v.replace(',', '.').replace(/[^\d.]/g, ''); }

const inputCls = 'glass-input w-full mt-1.5';
const labelCls = 'text-xs font-medium text-text-tertiary block';

export default function QuoteCreateModal({ isOpen, onClose, lead, onCreated, createLeadInline, preset }: QuoteCreateModalProps) {
  const { language } = useTranslation();
  // ── Contact mode ──
  const [contactMode, setContactMode] = useState<'new' | 'existing'>('new');
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [existingLeads, setExistingLeads] = useState<Array<{ id: string; label: string }>>([]);
  const [leadFirstName, setLeadFirstName] = useState('');
  const [leadLastName, setLeadLastName] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadAddress, setLeadAddress] = useState('');
  const [leadAddressSearch, setLeadAddressSearch] = useState('');
  const [leadCompany, setLeadCompany] = useState('');

  // ── Quote fields ──
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const [salespersonId, setSalespersonId] = useState('');
  const [validDays, setValidDays] = useState(30);
  const [notes, setNotes] = useState('');
  const [contractDisclaimer, setContractDisclaimer] = useState(
    'Ce devis est valable pour les 30 prochains jours, apres quoi les valeurs peuvent etre sujettes a modification.'
  );
  const [depositRequired, setDepositRequired] = useState(false);
  const [depositType, setDepositType] = useState<'percentage' | 'fixed'>('percentage');
  const [depositValue, setDepositValue] = useState('');
  const [requirePaymentMethod, setRequirePaymentMethod] = useState(false);
  const [lineItems, setLineItems] = useState<LineItemForm[]>([emptyLine()]);
  const [taxEnabled, setTaxEnabled] = useState(true);
  const [taxRate, setTaxRate] = useState(0);
  const [taxLabel, setTaxLabel] = useState('');
  const [taxConfigured, setTaxConfigured] = useState<boolean | null>(null); // null = loading
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed' | ''>('');
  const [discountValue, setDiscountValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [servicePickerOpen, setServicePickerOpen] = useState(false);
  const [addedServiceIds, setAddedServiceIds] = useState<Set<string>>(new Set());
  const specificNotesRef = useRef<SpecificNotesInlineHandle>(null);

  // ── Auto-tax ──
  const [resolvedTaxes, setResolvedTaxes] = useState<TaxConfig[]>([]);

  // ── Sections ──
  const [introEnabled, setIntroEnabled] = useState(false);
  const [introContent, setIntroContent] = useState('');
  const [disclaimerEnabled, setDisclaimerEnabled] = useState(true);
  const [clientMessageEnabled, setClientMessageEnabled] = useState(false);
  const [clientMessage, setClientMessage] = useState('');

  // ── Data ──
  const [clients, setClients] = useState<Array<{ id: string; label: string }>>([]);
  const [salespeople, setSalespeople] = useState<Array<{ id: string; label: string }>>([]);
  const [jobLineItems, setJobLineItems] = useState<Array<{ name: string; quantity: number; unit_price_cents: number; job_title: string }>>([]);

  // ── Init ──
  useEffect(() => {
    if (!isOpen) return;
    setError(null); setSaving(false);
    setContactMode('new'); setSelectedLeadId('');
    setLeadFirstName(''); setLeadLastName(''); setLeadEmail('');
    setLeadPhone(''); setLeadAddress(''); setLeadAddressSearch(''); setLeadCompany('');
    setLineItems([emptyLine()]); setNotes('');
    setDiscountType(''); setDiscountValue('');
    setAddedServiceIds(new Set()); setJobLineItems([]);

    if (lead) {
      setTitle(`Quote for ${lead.first_name || ''} ${lead.last_name || ''}`.trim());
      setClientId(lead.client_id || '');
      // Fetch job line items for this lead
      fetchLeadJobLineItems(lead.id).then(setJobLineItems).catch(() => {});
    } else {
      setTitle(''); setClientId('');
    }

    // ── Pre-fill from preset (content only, no pricing) ──
    if (preset) {
      if (!lead) setTitle(preset.name || '');
      if (preset.notes) setNotes(preset.notes);
      if (preset.intro_text) { setIntroEnabled(true); setIntroContent(preset.intro_text); }
      if (preset.services && preset.services.length > 0) {
        setLineItems(preset.services.map(s => ({
          id: crypto.randomUUID(),
          source_service_id: null,
          name: s.name || '',
          description: s.description || '',
          qtyInput: String(s.quantity || 1),
          unitPriceInput: '0',
          is_optional: s.is_optional || false,
          item_type: 'service' as const,
        })));
      }
    }

    listClients({ page: 1, pageSize: 200, sort: 'name_asc' })
      .then(r => setClients(r.items.map(c => ({
        id: c.id,
        label: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.company || c.id.slice(0, 6),
      })))).catch(() => setClients([]));

    listSalespeople().then(setSalespeople).catch(() => setSalespeople([]));

    if (createLeadInline) {
      fetchLeadsScoped({}).then(leads => setExistingLeads(leads.map(l => ({
        id: l.id,
        label: `${l.first_name || ''} ${l.last_name || ''}`.trim() || l.company || l.email || l.id.slice(0, 6),
      })))).catch(() => setExistingLeads([]));
    }
  }, [isOpen, lead]);

  // ── Auto-resolve taxes from Settings ──
  useEffect(() => {
    if (!isOpen) return;
    setTaxConfigured(null);
    resolveTaxes(clientId || null, lead?.id || null).then((result) => {
      const taxes = result?.taxes || [];
      if (taxes.length > 0) {
        setResolvedTaxes(taxes);
        const active = taxes.filter((t: any) => t.is_active);
        const totalRate = active.reduce((s: number, t: any) => s + t.rate, 0);
        const label = active.map((t: any) => t.name).join(' + ') + ` (${totalRate}%)`;
        setTaxRate(totalRate);
        setTaxLabel(label);
        setTaxEnabled(true);
        setTaxConfigured(true);
      } else {
        setTaxConfigured(false);
        setTaxEnabled(false);
        setTaxRate(0);
        setTaxLabel('');
      }
    }).catch((err) => {
      console.error('[QuoteCreateModal] tax resolve failed:', err);
      setTaxConfigured(false);
    });
  }, [isOpen, clientId, lead?.id]);

  // ── Calculations ──
  const subtotalCents = useMemo(() =>
    lineItems.reduce((s, i) => {
      if (i.is_optional) return s;
      return s + Math.round((parseFloat(i.qtyInput) || 0) * Math.round((parseFloat(i.unitPriceInput) || 0) * 100));
    }, 0), [lineItems]);

  const discountCents = useMemo(() => {
    if (!discountType) return 0;
    const v = parseFloat(discountValue) || 0;
    return discountType === 'percentage' ? Math.round(subtotalCents * v / 100) : Math.round(v * 100);
  }, [subtotalCents, discountType, discountValue]);

  const taxBreakdown = useMemo(() =>
    taxEnabled && resolvedTaxes.length > 0
      ? calculateTaxes(subtotalCents, discountCents, resolvedTaxes)
      : [],
  [subtotalCents, discountCents, taxEnabled, resolvedTaxes]);

  const taxCents = useMemo(() =>
    taxEnabled
      ? (taxBreakdown.length > 0
          ? taxBreakdown.reduce((s, t) => s + t.amount_cents, 0)
          : Math.round((subtotalCents - discountCents) * taxRate / 100))
      : 0,
  [subtotalCents, discountCents, taxEnabled, taxRate, taxBreakdown]);

  const totalCents = subtotalCents - discountCents + taxCents;

  // ── Handlers ──
  const handleServiceSelected = (service: PredefinedService) => {
    const empty = lineItems.findIndex(i => !i.name.trim());
    const item: LineItemForm = {
      id: crypto.randomUUID(), source_service_id: service.id, name: service.name,
      description: service.description || '', qtyInput: '1',
      unitPriceInput: String(service.default_price_cents / 100),
      is_optional: false, item_type: 'service',
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

  const importJobLineItems = () => {
    const newItems: LineItemForm[] = jobLineItems.map(j => ({
      id: crypto.randomUUID(), source_service_id: null, name: j.name,
      description: '', qtyInput: String(j.quantity),
      unitPriceInput: String(j.unit_price_cents / 100),
      is_optional: false, item_type: 'service' as const,
    }));
    setLineItems(p => {
      const nonEmpty = p.filter(i => i.name.trim());
      return [...nonEmpty, ...newItems].length > 0 ? [...nonEmpty, ...newItems] : [emptyLine()];
    });
  };

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

  // ── Submit ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate contact
    if (createLeadInline && !lead) {
      if (contactMode === 'new' && (!leadFirstName.trim() || !leadLastName.trim())) {
        setError('First name and last name are required.'); return;
      }
      if (contactMode === 'existing' && !selectedLeadId && !clientId) {
        setError('Please select an existing lead or client.'); return;
      }
    }

    const finalTitle = title.trim()
      || (contactMode === 'new' ? `Quote for ${leadFirstName.trim()} ${leadLastName.trim()}` : 'New Quote');

    const filteredItems: QuoteLineItemInput[] = lineItems
      .filter(i => i.name.trim() || i.item_type !== 'service')
      .map((i, idx) => ({
        source_service_id: i.source_service_id,
        name: i.name.trim(),
        description: i.description || null,
        quantity: Math.max(0.01, parseFloat(i.qtyInput) || 1),
        unit_price_cents: Math.max(0, Math.round((parseFloat(i.unitPriceInput) || 0) * 100)),
        sort_order: idx,
        is_optional: i.is_optional,
        item_type: i.item_type,
      }));

    const sections: QuoteSectionInput[] = [];
    if (introEnabled) sections.push({ section_type: 'introduction', title: 'Introduction', content: introContent, sort_order: 0, enabled: true });
    if (disclaimerEnabled) sections.push({ section_type: 'contract_disclaimer', title: 'Contract / Disclaimer', content: contractDisclaimer, sort_order: 10, enabled: true });
    if (clientMessageEnabled) sections.push({ section_type: 'client_message', title: 'Client Message', content: clientMessage, sort_order: 20, enabled: true });

    setSaving(true);
    try {
      // Resolve lead
      let leadId = lead?.id || null;
      if (createLeadInline && !lead) {
        if (contactMode === 'existing') {
          leadId = selectedLeadId || null;
        } else {
          const newLead = await createLeadScoped({
            first_name: leadFirstName.trim(), last_name: leadLastName.trim(),
            email: leadEmail.trim() || undefined, phone: leadPhone.trim(),
            address: leadAddress.trim(), company: leadCompany.trim(),
            value: 0, status: 'Lead', tags: [],
          });
          if (!newLead?.id) throw new Error('Failed to create lead.');
          leadId = newLead.id;
          window.dispatchEvent(new CustomEvent('crm:lead-created', { detail: { leadId: newLead.id } }));
        }
      }

      const detail = await createQuote({
        lead_id: leadId,
        client_id: clientId || null,
        title: finalTitle,
        salesperson_id: salespersonId || null,
        context_type: leadId ? 'lead' : 'client',
        notes: notes || null,
        contract_disclaimer: contractDisclaimer || null,
        deposit_required: depositRequired,
        deposit_type: depositRequired ? depositType : null,
        deposit_value: depositRequired ? (parseFloat(depositValue) || 0) : 0,
        require_payment_method: requirePaymentMethod,
        tax_rate: taxEnabled ? taxRate : 0,
        tax_rate_label: taxEnabled ? taxLabel : 'No tax',
        discount_type: discountType || null,
        discount_value: parseFloat(discountValue) || 0,
        source_template_id: preset?.id || null,
        source_template_name: preset?.name || null,
        line_items: filteredItems,
        sections,
      });

      // Save specific notes (photos, files, etc.) attached to this quote
      if (specificNotesRef.current?.hasContent()) {
        await specificNotesRef.current.saveNote('quote', detail.quote.id);
      }

      onCreated(detail);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save quote.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  // ── Resolved contact name for Client field ──
  const resolvedContactName = contactMode === 'new'
    ? (leadFirstName || leadLastName ? `${leadFirstName} ${leadLastName}`.trim() : null)
    : selectedLeadId
      ? existingLeads.find(l => l.id === selectedLeadId)?.label
      : clientId ? clients.find(c => c.id === clientId)?.label : null;

  return (
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
                <FileText size={18} className="text-primary" />
              </div>
              <div>
                <h2 className="text-[16px] font-bold tracking-tight text-text-primary">New Quote</h2>
                {lead && <p className="text-[13px] text-text-tertiary">for {lead.first_name} {lead.last_name}</p>}
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl border border-outline hover:bg-surface-tertiary text-text-tertiary hover:text-text-primary transition-colors">
              <X size={18} />
            </button>
          </div>

          {/* ── Body ── */}
          <form id="quote-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-6 space-y-5">

            {/* ── Contact section (inline lead creation) ── */}
            {createLeadInline && !lead && (
              <div className="section-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[16px] font-bold tracking-tight text-text-primary flex items-center gap-2">
                    <User size={15} className="text-text-tertiary" /> Contact
                  </h3>
                  <div className="flex p-0.5 bg-surface-tertiary rounded-lg border border-outline">
                    <button type="button" onClick={() => setContactMode('new')}
                      className={cn("px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                        contactMode === 'new' ? "bg-surface shadow-sm text-text-primary" : "text-text-tertiary")}>
                      New
                    </button>
                    <button type="button" onClick={() => setContactMode('existing')}
                      className={cn("px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                        contactMode === 'existing' ? "bg-surface shadow-sm text-text-primary" : "text-text-tertiary")}>
                      Existing
                    </button>
                  </div>
                </div>

                {contactMode === 'new' ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div><label className={labelCls}>First Name *</label>
                        <input autoFocus value={leadFirstName} onChange={e => setLeadFirstName(e.target.value)} className={inputCls} placeholder="John" /></div>
                      <div><label className={labelCls}>Last Name *</label>
                        <input value={leadLastName} onChange={e => setLeadLastName(e.target.value)} className={inputCls} placeholder="Doe" /></div>
                    </div>
                    <div><label className={labelCls}>Company</label>
                      <input value={leadCompany} onChange={e => setLeadCompany(e.target.value)} className={inputCls} placeholder="Company name" /></div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div><label className={cn(labelCls, 'flex items-center gap-1')}><Mail size={11} className="text-text-tertiary" /> Email</label>
                        <input type="email" value={leadEmail} onChange={e => setLeadEmail(e.target.value)} className={inputCls} placeholder="john@company.com" /></div>
                      <div><label className={cn(labelCls, 'flex items-center gap-1')}><Phone size={11} className="text-text-tertiary" /> Phone</label>
                        <input type="tel" value={leadPhone} onChange={e => setLeadPhone(e.target.value)} className={inputCls} placeholder="(514) 555-1234" /></div>
                    </div>
                    <div><label className={cn(labelCls, 'flex items-center gap-1')}><MapPin size={11} className="text-text-tertiary" /> Address</label>
                      <AddressAutocomplete
                        value={leadAddressSearch}
                        onChange={setLeadAddressSearch}
                        onSelect={(addr: StructuredAddress) => {
                          const line1 = [addr.street_number, addr.street_name].filter(Boolean).join(' ').trim();
                          setLeadAddress(line1 || addr.formatted_address);
                          setLeadAddressSearch(addr.formatted_address);
                        }}
                        className="mt-1.5"
                        placeholder="Start typing an address..."
                      />
                      {leadAddress && leadAddress !== leadAddressSearch && (
                        <p className="mt-1 text-xs text-text-secondary">Address: {leadAddress}</p>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="space-y-4">
                    <div><label className={labelCls}>Select a Lead</label>
                      <select value={selectedLeadId} onChange={e => { setSelectedLeadId(e.target.value); setClientId(''); }} className={inputCls}>
                        <option value="">-- Select lead --</option>
                        {existingLeads.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                      </select></div>
                    <div className="flex items-center gap-2 text-text-tertiary text-xs">
                      <div className="flex-1 border-t border-outline" /><span>or</span><div className="flex-1 border-t border-outline" />
                    </div>
                    <div><label className={labelCls}>Select a Client</label>
                      <select value={clientId} onChange={e => { setClientId(e.target.value); setSelectedLeadId(''); }} className={inputCls}>
                        <option value="">-- Select client --</option>
                        {clients.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select></div>
                  </div>
                )}
              </div>
            )}

            {/* ── Title + Meta ── */}
            <div className="space-y-4">
              <input autoFocus={!createLeadInline} value={title} onChange={e => setTitle(e.target.value)}
                className={cn(inputCls, 'text-lg font-medium py-3 rounded-xl')} placeholder="Title" />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className={labelCls}>Client</label>
                  {createLeadInline && !lead ? (
                    <div className={cn(inputCls, 'bg-surface-secondary')}>
                      {resolvedContactName || <span className="text-text-tertiary">From contact above</span>}
                    </div>
                  ) : (
                    <select value={clientId} onChange={e => setClientId(e.target.value)} className={inputCls}>
                      <option value="">Select a client</option>
                      {clients.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  )}
                </div>
                <div><label className={labelCls}>Quote #</label>
                  <input className={inputCls} placeholder="Auto" disabled /></div>
                <div><label className={labelCls}>Salesperson</label>
                  <select value={salespersonId} onChange={e => setSalespersonId(e.target.value)} className={inputCls}>
                    <option value="">Assign</option>
                    {salespeople.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select></div>
                <div><label className={labelCls}>Valid for (days)</label>
                  <input type="number" min={1} value={validDays} onChange={e => setValidDays(Number(e.target.value) || 30)} className={inputCls} /></div>
              </div>
            </div>

            {/* ── Optional sections ── */}
            <div className="flex flex-wrap items-center gap-2">
              {[
                { key: 'intro', label: language === 'fr' ? 'Introduction' : 'Introduction', enabled: introEnabled, toggle: setIntroEnabled },
                { key: 'disclaimer', label: language === 'fr' ? 'Contrat / Clause' : 'Contract / Disclaimer', enabled: disclaimerEnabled, toggle: setDisclaimerEnabled },
                { key: 'clientMsg', label: language === 'fr' ? 'Message au client' : 'Client message', enabled: clientMessageEnabled, toggle: setClientMessageEnabled },
              ].map(s => (
                <button key={s.key} type="button" onClick={() => s.toggle(!s.enabled)}
                  className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                    s.enabled ? 'bg-primary/10 text-primary border-primary/30' : 'bg-surface-secondary text-text-secondary border-outline hover:bg-surface-tertiary')}>
                  {s.enabled ? '✓ ' : '+ '}{s.label}
                </button>
              ))}
            </div>

            {/* ── Introduction ── */}
            {introEnabled && (
              <div className="section-card p-4 space-y-2">
                <h4 className="text-[14px] font-bold tracking-tight text-text-primary">Introduction</h4>
                <textarea value={introContent} onChange={e => setIntroContent(e.target.value)}
                  className={cn(inputCls, 'min-h-[80px]')} placeholder="Write an introduction for this quote..." />
              </div>
            )}

            {/* ── Product / Service ── */}
            <div className="section-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[16px] font-bold tracking-tight text-text-primary">Product / Service</h3>
                <div className="flex items-center gap-2">
                  {jobLineItems.length > 0 && (
                    <button type="button" onClick={importJobLineItems}
                      className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1">
                      <Download size={12} /> Import from Job ({jobLineItems.length})
                    </button>
                  )}
                  <button type="button" onClick={() => setServicePickerOpen(true)}
                    className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1">
                    <Package size={12} /> Add from catalog
                  </button>
                </div>
              </div>

              {lineItems.map(item => (
                <div key={item.id} className={cn(
                  'grid grid-cols-12 gap-3 items-start p-3 rounded-lg border transition-all',
                  item.is_optional ? 'border-dashed border-outline bg-surface-secondary/50' : 'border-outline bg-surface'
                )}>
                  <div className="col-span-5 space-y-1">
                    <input value={item.name} onChange={e => updateLine(item.id, { name: e.target.value })}
                      className={cn(inputCls, 'py-2')} placeholder="Name" />
                    <textarea value={item.description} onChange={e => updateLine(item.id, { description: e.target.value })}
                      className={cn(inputCls, 'py-1.5 text-xs min-h-[40px] resize-none')} placeholder="Description" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs font-medium text-text-tertiary">Quantity</label>
                    <input value={item.qtyInput} onChange={e => updateLine(item.id, { qtyInput: sanitize(e.target.value) })}
                      className={cn(inputCls, 'py-2 text-center')} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs font-medium text-text-tertiary">Unit price</label>
                    <input value={item.unitPriceInput} onChange={e => updateLine(item.id, { unitPriceInput: sanitize(e.target.value) })}
                      className={cn(inputCls, 'py-2 text-right')} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs font-medium text-text-tertiary">Total</label>
                    <p className="px-2.5 py-2 text-sm font-medium text-right text-text-primary">
                      {formatQuoteMoney(Math.round((parseFloat(item.qtyInput) || 0) * (parseFloat(item.unitPriceInput) || 0) * 100))}
                    </p>
                  </div>
                  <div className="col-span-1 flex flex-col items-center gap-1 pt-5">
                    <button type="button" onClick={() => removeLine(item.id)} disabled={lineItems.length === 1}
                      className="p-1 text-text-tertiary hover:text-danger disabled:opacity-30"><Trash2 size={14} /></button>
                  </div>
                  <div className="col-span-12">
                    <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                      <input type="checkbox" checked={item.is_optional} onChange={e => updateLine(item.id, { is_optional: e.target.checked })}
                        className="h-3.5 w-3.5 rounded" />
                      Mark as optional
                    </label>
                  </div>
                </div>
              ))}

              <div className="flex gap-2">
                <button type="button" onClick={() => setLineItems(p => [...p, emptyLine()])}
                  className="glass-button-primary px-3 py-2 text-xs font-semibold flex items-center gap-1.5">
                  <Plus size={12} /> Add Line Item
                </button>
                <button type="button" onClick={() => setLineItems(p => [...p, { ...emptyLine(), item_type: 'text', name: '' }])}
                  className="glass-button px-3 py-2 text-xs font-medium">
                  Add Text
                </button>
              </div>
            </div>

            {/* ── Totals ── */}
            <div className="section-card p-5 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Subtotal</span>
                <span className="font-medium text-text-primary">{formatQuoteMoney(subtotalCents)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-text-secondary">Discount</span>
                {discountType ? (
                  <div className="flex items-center gap-2">
                    <select value={discountType} onChange={e => setDiscountType(e.target.value as any)}
                      className="text-xs border border-outline rounded px-2 py-1 bg-surface text-text-primary">
                      <option value="percentage">%</option><option value="fixed">$</option>
                    </select>
                    <input value={discountValue} onChange={e => setDiscountValue(sanitize(e.target.value))}
                      className="w-20 text-right text-xs border border-outline rounded px-2 py-1 bg-surface text-text-primary" />
                    <button type="button" onClick={() => { setDiscountType(''); setDiscountValue(''); }}
                      className="text-text-tertiary hover:text-danger"><Trash2 size={12} /></button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setDiscountType('percentage')}
                    className="text-xs text-primary hover:underline">Add Discount</button>
                )}
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-text-secondary">Tax</span>
                <div className="flex items-center gap-2">
                  {taxConfigured === null ? (
                    <span className="text-[11px] text-text-tertiary">Loading...</span>
                  ) : taxConfigured === false ? (
                    <a href="/settings/taxes" className="text-[11px] text-danger hover:underline font-medium">Configure taxes in Settings</a>
                  ) : (
                    <>
                      <span className="text-[11px] font-medium text-text-primary px-2 py-0.5 bg-surface-secondary rounded">{taxLabel}</span>
                      <span className="text-xs font-medium text-text-primary">{formatQuoteMoney(taxCents)}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex justify-between text-base font-bold border-t border-outline pt-3">
                <span className="text-text-primary">Total</span>
                <span className="text-text-primary">{formatQuoteMoney(totalCents)}</span>
              </div>
            </div>

            {/* ── Deposit Settings ── */}
            <div className="section-card p-5 space-y-3">
              <h3 className="text-[14px] font-bold tracking-tight text-text-primary">Deposit & Payment Settings</h3>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={depositRequired} onChange={e => setDepositRequired(e.target.checked)} className="h-4 w-4 rounded" />
                <span className="text-[13px] text-text-primary">Require deposit when quote is accepted</span>
              </label>
              {depositRequired && (
                <div className="ml-7 space-y-3 border-l-2 border-outline pl-4">
                  <div className="flex items-center gap-3">
                    <select value={depositType} onChange={e => setDepositType(e.target.value as any)}
                      className="text-xs border border-outline rounded-lg px-3 py-2 bg-surface text-text-primary">
                      <option value="percentage">Percentage (%)</option>
                      <option value="fixed">Fixed Amount ($)</option>
                    </select>
                    <input value={depositValue} onChange={e => setDepositValue(sanitize(e.target.value))}
                      className="w-24 text-right text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-text-primary"
                      placeholder={depositType === 'percentage' ? '25' : '100'} />
                    <span className="text-xs text-text-tertiary">
                      {depositType === 'percentage'
                        ? `= ${formatQuoteMoney(Math.round(totalCents * (parseFloat(depositValue) || 0) / 100))}`
                        : ''}
                    </span>
                  </div>
                  {depositType === 'percentage' && (parseFloat(depositValue) || 0) > 100 && (
                    <p className="text-xs text-danger">Percentage cannot exceed 100%</p>
                  )}
                  <p className="text-[12px] text-text-tertiary">
                    {depositType === 'percentage'
                      ? `Client must pay ${depositValue || 0}% deposit upon approval`
                      : `Client must pay $${depositValue || 0} deposit upon approval`}
                  </p>
                </div>
              )}
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={requirePaymentMethod} onChange={e => setRequirePaymentMethod(e.target.checked)} className="h-4 w-4 rounded" />
                <span className="text-[13px] text-text-primary">Require payment method on file</span>
              </label>
            </div>

            {/* ── Contract / Disclaimer ── */}
            {disclaimerEnabled && (
              <div className="section-card p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-[14px] font-bold tracking-tight text-text-primary">Contract / Disclaimer</h4>
                  <button type="button" onClick={() => setDisclaimerEnabled(false)} className="text-text-tertiary hover:text-danger"><Trash2 size={14} /></button>
                </div>
                <textarea value={contractDisclaimer} onChange={e => setContractDisclaimer(e.target.value)}
                  className={cn(inputCls, 'min-h-[80px]')} placeholder="Description" />
              </div>
            )}

            {/* ── Notes ── */}
            <div className="section-card border-dashed p-5">
              <h4 className="text-[14px] font-bold tracking-tight text-text-primary mb-2">Notes</h4>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                className="w-full px-3 py-2 border-0 text-sm min-h-[80px] resize-none outline-none bg-transparent text-text-primary placeholder:text-text-tertiary"
                placeholder={language === 'fr' ? 'Notes visibles sur le devis (conditions, détails supplémentaires...)' : 'Notes visible on the quote (conditions, additional details...)'} />
              <p className="text-[10px] text-text-muted mt-1">{language === 'fr' ? 'Visible par le client sur le devis' : 'Visible to the client on the quote'}</p>
            </div>

            {/* ── Specific Notes (photos, files, etc.) ── */}
            <SpecificNotesInline ref={specificNotesRef} tempEntityType="quote" />

            {/* ── Client message ── */}
            {clientMessageEnabled && (
              <div className="section-card p-4 space-y-2">
                <h4 className="text-[14px] font-bold tracking-tight text-text-primary">Client Message</h4>
                <textarea value={clientMessage} onChange={e => setClientMessage(e.target.value)}
                  className={cn(inputCls, 'min-h-[60px]')} placeholder="Message visible to the client..." />
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-danger bg-danger-light text-danger px-4 py-3 text-sm">{error}</div>
            )}
          </form>

          {/* ── Footer ── */}
          <div className="px-6 pt-4 pb-6 border-t border-border-light bg-surface-secondary flex items-center justify-end gap-3">
            <button type="button" onClick={onClose} className="glass-button px-5 py-2.5 text-sm font-medium">Cancel</button>
            <button form="quote-form" type="submit" disabled={saving}
              className="glass-button-primary px-6 py-2.5 text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
              {saving ? 'Saving...' : 'Save Quote'}
              <ChevronDown size={14} className="opacity-70" />
            </button>
          </div>
        </motion.div>
      </div>

      <AnimatePresence>
        {servicePickerOpen && (
          <ServicePicker isOpen onClose={() => setServicePickerOpen(false)} onSelect={handleServiceSelected} onRemove={handleServiceRemoved} addedIds={addedServiceIds} />
        )}
      </AnimatePresence>
    </>
  );
}
