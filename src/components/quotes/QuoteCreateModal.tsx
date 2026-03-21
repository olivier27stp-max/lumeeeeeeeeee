import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FileText, Plus, Trash2, X, Package, GripVertical, ChevronDown, Image } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '../../lib/utils';
import { listTeams } from '../../lib/teamsApi';
import { listSalespeople } from '../../lib/jobsApi';
import { listClients } from '../../lib/clientsApi';
import { createQuote, formatQuoteMoney, type QuoteLineItemInput, type QuoteSectionInput, type QuoteDetail } from '../../lib/quotesApi';
import ServicePicker from '../ServicePicker';
import type { PredefinedService } from '../../lib/servicesApi';
import type { Lead } from '../../types';

interface QuoteCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (detail: QuoteDetail) => void;
  lead?: Lead | null;
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
    id: crypto.randomUUID(),
    source_service_id: null,
    name: '',
    description: '',
    qtyInput: '1',
    unitPriceInput: '0',
    is_optional: false,
    item_type: 'service',
  };
}

function sanitizeDecimal(value: string) {
  return value.replace(',', '.').replace(/[^\d.]/g, '');
}

export default function QuoteCreateModal({ isOpen, onClose, lead, onCreated }: QuoteCreateModalProps) {
  // Form state
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const [quoteNumber, setQuoteNumber] = useState('');
  const [salespersonId, setSalespersonId] = useState('');
  const [validDays, setValidDays] = useState(30);
  const [notes, setNotes] = useState('');
  const [contractDisclaimer, setContractDisclaimer] = useState(
    'Ce devis est valable pour les 30 prochains jours, apres quoi les valeurs peuvent etre sujettes a modification.'
  );
  const [depositRequired, setDepositRequired] = useState(false);
  const [requirePaymentMethod, setRequirePaymentMethod] = useState(false);
  const [lineItems, setLineItems] = useState<LineItemForm[]>([emptyLine()]);
  const [taxEnabled, setTaxEnabled] = useState(true);
  const [taxRate, setTaxRate] = useState(14.975);
  const [taxLabel, setTaxLabel] = useState('TPS+TVQ (14.975%)');
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed' | ''>('');
  const [discountValue, setDiscountValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [servicePickerOpen, setServicePickerOpen] = useState(false);
  const [addedServiceIds, setAddedServiceIds] = useState<Set<string>>(new Set());

  // Sections
  const [introEnabled, setIntroEnabled] = useState(false);
  const [introContent, setIntroContent] = useState('');
  const [disclaimerEnabled, setDisclaimerEnabled] = useState(true);
  const [clientMessageEnabled, setClientMessageEnabled] = useState(false);
  const [clientMessage, setClientMessage] = useState('');

  // Data queries
  const [clients, setClients] = useState<Array<{ id: string; label: string }>>([]);
  const [salespeople, setSalespeople] = useState<Array<{ id: string; label: string }>>([]);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setSaving(false);

    // Prefill from lead
    if (lead) {
      const leadName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
      setTitle(`Quote for ${leadName}`);
      setClientId(lead.client_id || '');
    } else {
      setTitle('');
      setClientId('');
    }

    setLineItems([emptyLine()]);
    setNotes('');
    setDiscountType('');
    setDiscountValue('');

    listClients({ page: 1, pageSize: 200, sort: 'name_asc' })
      .then(result => setClients(result.items.map(c => ({
        id: c.id,
        label: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.company || c.id.slice(0, 6),
      }))))
      .catch(() => setClients([]));

    listSalespeople().then(setSalespeople).catch(() => setSalespeople([]));
  }, [isOpen, lead]);

  // Calculations
  const subtotalCents = useMemo(() =>
    lineItems.reduce((sum, item) => {
      if (item.is_optional) return sum;
      const qty = parseFloat(item.qtyInput) || 0;
      const price = Math.round((parseFloat(item.unitPriceInput) || 0) * 100);
      return sum + Math.round(qty * price);
    }, 0),
  [lineItems]);

  const discountCents = useMemo(() => {
    if (!discountType) return 0;
    const val = parseFloat(discountValue) || 0;
    if (discountType === 'percentage') return Math.round(subtotalCents * val / 100);
    return Math.round(val * 100);
  }, [subtotalCents, discountType, discountValue]);

  const taxCents = useMemo(() =>
    taxEnabled ? Math.round((subtotalCents - discountCents) * taxRate / 100) : 0,
  [subtotalCents, discountCents, taxEnabled, taxRate]);

  const totalCents = subtotalCents - discountCents + taxCents;

  const handleServiceSelected = (service: PredefinedService) => {
    const emptyIdx = lineItems.findIndex(item => !item.name.trim());
    const newItem: LineItemForm = {
      id: crypto.randomUUID(),
      source_service_id: service.id,
      name: service.name,
      description: service.description || '',
      qtyInput: '1',
      unitPriceInput: String(service.default_price_cents / 100),
      is_optional: false,
      item_type: 'service',
    };
    if (emptyIdx !== -1) {
      setLineItems(prev => { const u = [...prev]; u[emptyIdx] = newItem; return u; });
    } else {
      setLineItems(prev => [...prev, newItem]);
    }
    setAddedServiceIds(prev => new Set([...prev, service.id]));
  };

  const updateLine = (id: string, patch: Partial<LineItemForm>) =>
    setLineItems(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));

  const removeLine = (id: string) =>
    setLineItems(prev => prev.length > 1 ? prev.filter(item => item.id !== id) : prev);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) { setError('Title is required.'); return; }

    const filteredItems: QuoteLineItemInput[] = lineItems
      .filter(item => item.name.trim() || item.item_type !== 'service')
      .map((item, i) => ({
        source_service_id: item.source_service_id,
        name: item.name.trim(),
        description: item.description || null,
        quantity: Math.max(0.01, parseFloat(item.qtyInput) || 1),
        unit_price_cents: Math.max(0, Math.round((parseFloat(item.unitPriceInput) || 0) * 100)),
        sort_order: i,
        is_optional: item.is_optional,
        item_type: item.item_type,
      }));

    const sections: QuoteSectionInput[] = [];
    if (introEnabled) sections.push({ section_type: 'introduction', title: 'Introduction', content: introContent, sort_order: 0, enabled: true });
    if (disclaimerEnabled) sections.push({ section_type: 'contract_disclaimer', title: 'Contract / Disclaimer', content: contractDisclaimer, sort_order: 10, enabled: true });
    if (clientMessageEnabled) sections.push({ section_type: 'client_message', title: 'Client Message', content: clientMessage, sort_order: 20, enabled: true });

    setSaving(true);
    try {
      const detail = await createQuote({
        lead_id: lead?.id || null,
        client_id: clientId || null,
        title: title.trim(),
        salesperson_id: salespersonId || null,
        context_type: lead ? 'lead' : 'client',
        notes: notes || null,
        contract_disclaimer: contractDisclaimer || null,
        deposit_required: depositRequired,
        require_payment_method: requirePaymentMethod,
        tax_rate: taxEnabled ? taxRate : 0,
        tax_rate_label: taxEnabled ? taxLabel : 'No tax',
        discount_type: discountType || null,
        discount_value: parseFloat(discountValue) || 0,
        line_items: filteredItems,
        sections,
      });
      onCreated(detail);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save quote.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 backdrop-blur-md p-4">
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          className="w-full max-w-5xl max-h-[94vh] bg-white rounded-2xl border border-gray-200 shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-red-800 to-red-900">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-white/20 flex items-center justify-center">
                <FileText size={18} className="text-white" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-white">New Quote</h2>
                {lead && (
                  <p className="text-xs text-white/70">
                    for {lead.first_name} {lead.last_name}
                  </p>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 text-white/80 hover:text-white">
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <form id="quote-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
            {/* Title + Meta */}
            <div className="space-y-4">
              <input
                autoFocus
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full text-lg font-medium px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-600/20 focus:border-green-600 outline-none"
                placeholder="Title"
              />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs text-gray-500 font-medium mb-1 block">Client</label>
                  <select value={clientId} onChange={e => setClientId(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-green-600 outline-none">
                    <option value="">Select a client</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium mb-1 block">Quote #</label>
                  <input value={quoteNumber} onChange={e => setQuoteNumber(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-green-600 outline-none"
                    placeholder="Auto" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium mb-1 block">Salesperson</label>
                  <select value={salespersonId} onChange={e => setSalespersonId(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-green-600 outline-none">
                    <option value="">Assign</option>
                    {salespeople.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium mb-1 block">Valid for (days)</label>
                  <input type="number" min={1} value={validDays} onChange={e => setValidDays(Number(e.target.value) || 30)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-green-600 outline-none" />
                </div>
              </div>
            </div>

            {/* Section Controls */}
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-gray-400 self-center mr-1">+ Add section</span>
              {[
                { key: 'intro', label: 'Introduction', enabled: introEnabled, toggle: setIntroEnabled },
                { key: 'disclaimer', label: 'Contract / Disclaimer', enabled: disclaimerEnabled, toggle: setDisclaimerEnabled },
                { key: 'clientMsg', label: 'Client message', enabled: clientMessageEnabled, toggle: setClientMessageEnabled },
              ].map(s => (
                <button key={s.key} type="button" onClick={() => s.toggle(!s.enabled)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                    s.enabled ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                  )}>
                  {s.label}
                </button>
              ))}
            </div>

            {/* Introduction section */}
            {introEnabled && (
              <div className="border border-gray-200 rounded-xl p-4 space-y-2">
                <h4 className="text-sm font-semibold text-gray-700">Introduction</h4>
                <textarea value={introContent} onChange={e => setIntroContent(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm min-h-[80px] focus:border-green-600 outline-none"
                  placeholder="Write an introduction for this quote..." />
              </div>
            )}

            {/* Product / Service */}
            <div className="border border-gray-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-gray-800">Product / Service</h3>
                <button type="button" onClick={() => setServicePickerOpen(true)}
                  className="text-xs font-medium text-green-700 hover:text-green-800 flex items-center gap-1">
                  <Package size={12} /> Add from catalog
                </button>
              </div>

              {lineItems.map((item, idx) => (
                <div key={item.id} className={cn(
                  'grid grid-cols-12 gap-3 items-start p-3 rounded-lg border transition-all',
                  item.is_optional ? 'border-dashed border-gray-300 bg-gray-50/50' : 'border-gray-200 bg-white'
                )}>
                  <div className="col-span-5 space-y-1">
                    <input value={item.name} onChange={e => updateLine(item.id, { name: e.target.value })}
                      className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm focus:border-green-600 outline-none"
                      placeholder="Name" />
                    <textarea value={item.description} onChange={e => updateLine(item.id, { description: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs min-h-[40px] resize-none focus:border-green-600 outline-none"
                      placeholder="Description" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-gray-400 font-medium">Quantity</label>
                    <input value={item.qtyInput} onChange={e => updateLine(item.id, { qtyInput: sanitizeDecimal(e.target.value) })}
                      className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm text-center focus:border-green-600 outline-none" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-gray-400 font-medium">Unit price</label>
                    <input value={item.unitPriceInput} onChange={e => updateLine(item.id, { unitPriceInput: sanitizeDecimal(e.target.value) })}
                      className="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm text-right focus:border-green-600 outline-none" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-gray-400 font-medium">Total</label>
                    <p className="px-2.5 py-2 text-sm font-medium text-right">
                      {formatQuoteMoney(Math.round((parseFloat(item.qtyInput) || 0) * (parseFloat(item.unitPriceInput) || 0) * 100))}
                    </p>
                  </div>
                  <div className="col-span-1 flex flex-col items-center gap-1 pt-5">
                    <button type="button" onClick={() => removeLine(item.id)} disabled={lineItems.length === 1}
                      className="p-1 text-gray-400 hover:text-red-500 disabled:opacity-30"><Trash2 size={14} /></button>
                  </div>
                  <div className="col-span-12">
                    <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                      <input type="checkbox" checked={item.is_optional} onChange={e => updateLine(item.id, { is_optional: e.target.checked })}
                        className="h-3.5 w-3.5 rounded" />
                      Mark as optional
                    </label>
                  </div>
                </div>
              ))}

              <div className="flex gap-2">
                <button type="button" onClick={() => setLineItems(prev => [...prev, emptyLine()])}
                  className="px-3 py-2 text-xs font-semibold text-white bg-green-700 hover:bg-green-800 rounded-lg flex items-center gap-1.5">
                  <Plus size={12} /> Add Line Item
                </button>
                <button type="button" onClick={() => setLineItems(prev => [...prev, { ...emptyLine(), item_type: 'text', name: '' }])}
                  className="px-3 py-2 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50">
                  Add Text
                </button>
              </div>
            </div>

            {/* Totals */}
            <div className="border border-gray-200 rounded-xl p-5 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-medium">{formatQuoteMoney(subtotalCents)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Discount</span>
                {discountType ? (
                  <div className="flex items-center gap-2">
                    <select value={discountType} onChange={e => setDiscountType(e.target.value as any)}
                      className="text-xs border border-gray-200 rounded px-2 py-1">
                      <option value="percentage">%</option>
                      <option value="fixed">$</option>
                    </select>
                    <input value={discountValue} onChange={e => setDiscountValue(sanitizeDecimal(e.target.value))}
                      className="w-20 text-right text-xs border border-gray-200 rounded px-2 py-1" />
                    <button type="button" onClick={() => { setDiscountType(''); setDiscountValue(''); }}
                      className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setDiscountType('percentage')}
                    className="text-xs text-green-700 hover:underline">Add Discount</button>
                )}
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Tax</span>
                <div className="flex items-center gap-2">
                  <select value={taxEnabled ? taxLabel : ''} onChange={e => { setTaxEnabled(!!e.target.value); if (e.target.value) setTaxLabel(e.target.value); }}
                    className="text-xs border border-gray-200 rounded px-2 py-1">
                    <option value="">No tax</option>
                    <option value="TPS+TVQ (14.975%)">TPS+TVQ (14.975%)</option>
                    <option value="TPS (5%)">TPS (5%)</option>
                    <option value="TVQ (9.975%)">TVQ (9.975%)</option>
                  </select>
                  <span className="text-xs font-medium">{formatQuoteMoney(taxCents)}</span>
                  {taxEnabled && (
                    <button type="button" onClick={() => setTaxEnabled(false)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>
                  )}
                </div>
              </div>
              <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-3">
                <span>Total</span>
                <span>{formatQuoteMoney(totalCents)}</span>
              </div>
            </div>

            {/* Contract / Disclaimer */}
            {disclaimerEnabled && (
              <div className="border border-gray-200 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-gray-700">Contract / Disclaimer</h4>
                  <button type="button" onClick={() => setDisclaimerEnabled(false)} className="text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
                <textarea value={contractDisclaimer} onChange={e => setContractDisclaimer(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm min-h-[80px] focus:border-green-600 outline-none"
                  placeholder="Description" />
              </div>
            )}

            {/* Notes */}
            <div className="border border-dashed border-gray-300 rounded-xl p-5">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Notes</h4>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                className="w-full px-3 py-2 border-0 text-sm min-h-[60px] resize-none outline-none bg-transparent"
                placeholder="Leave an internal note for yourself or a team member" />
            </div>

            {/* Client message */}
            {clientMessageEnabled && (
              <div className="border border-gray-200 rounded-xl p-4 space-y-2">
                <h4 className="text-sm font-semibold text-gray-700">Client Message</h4>
                <textarea value={clientMessage} onChange={e => setClientMessage(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm min-h-[60px] focus:border-green-600 outline-none"
                  placeholder="Message visible to the client..." />
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>
            )}
          </form>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/80 flex items-center justify-end gap-3">
            <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg hover:bg-gray-100">
              Cancel
            </button>
            <button form="quote-form" type="submit" disabled={saving}
              className="px-6 py-2.5 text-sm font-semibold text-white bg-green-700 hover:bg-green-800 rounded-lg disabled:opacity-50 flex items-center gap-2">
              {saving ? 'Saving...' : 'Save Quote'}
              <ChevronDown size={14} className="opacity-70" />
            </button>
          </div>
        </motion.div>
      </div>

      <AnimatePresence>
        {servicePickerOpen && (
          <ServicePicker isOpen onClose={() => setServicePickerOpen(false)} onSelect={handleServiceSelected} addedIds={addedServiceIds} />
        )}
      </AnimatePresence>
    </>
  );
}
