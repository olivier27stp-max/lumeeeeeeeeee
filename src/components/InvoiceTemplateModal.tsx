import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  InvoiceTemplate,
  InvoiceTemplateInput,
  createInvoiceTemplate,
  updateInvoiceTemplate,
} from '../lib/invoiceTemplatesApi';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  template?: InvoiceTemplate | null;
}

interface LineItemForm {
  id: string;
  description: string;
  qty: number;
  unit_price: number;
}

interface TaxForm {
  id: string;
  name: string;
  rate: number;
}

function emptyLineItem(): LineItemForm {
  return { id: crypto.randomUUID(), description: '', qty: 1, unit_price: 0 };
}

function emptyTax(): TaxForm {
  return { id: crypto.randomUUID(), name: '', rate: 0 };
}

export default function InvoiceTemplateModal({ isOpen, onClose, onSaved, template }: Props) {
  const isEditMode = !!template;

  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [lineItems, setLineItems] = useState<LineItemForm[]>([emptyLineItem()]);
  const [taxes, setTaxes] = useState<TaxForm[]>([]);
  const [paymentTerms, setPaymentTerms] = useState('');
  const [clientNote, setClientNote] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    if (template) {
      setName(template.name);
      setTitle(template.title);
      setDescription(template.description);
      setLineItems(
        template.line_items.length > 0
          ? template.line_items.map((li) => ({
              id: crypto.randomUUID(),
              description: li.description,
              qty: li.qty,
              unit_price: li.unit_price_cents / 100,
            }))
          : [emptyLineItem()]
      );
      setTaxes(
        template.taxes.map((tx) => ({
          id: crypto.randomUUID(),
          name: tx.name,
          rate: tx.rate,
        }))
      );
      setPaymentTerms(template.payment_terms);
      setClientNote(template.client_note);
      setEmailSubject(template.email_subject);
      setEmailBody(template.email_body);
    } else {
      setName('');
      setTitle('');
      setDescription('');
      setLineItems([emptyLineItem()]);
      setTaxes([]);
      setPaymentTerms('');
      setClientNote('');
      setEmailSubject('');
      setEmailBody('');
    }
    setSaving(false);
  }, [isOpen, template]);

  function updateLineItem(id: string, patch: Partial<LineItemForm>) {
    setLineItems((prev) => prev.map((li) => (li.id === id ? { ...li, ...patch } : li)));
  }

  function removeLineItem(id: string) {
    setLineItems((prev) => (prev.length <= 1 ? prev : prev.filter((li) => li.id !== id)));
  }

  function updateTax(id: string, patch: Partial<TaxForm>) {
    setTaxes((prev) => prev.map((tx) => (tx.id === id ? { ...tx, ...patch } : tx)));
  }

  function removeTax(id: string) {
    setTaxes((prev) => prev.filter((tx) => tx.id !== id));
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error('Template name is required.');
      return;
    }

    setSaving(true);
    try {
      const input: InvoiceTemplateInput = {
        name: name.trim(),
        title: title.trim(),
        description: description.trim(),
        line_items: lineItems
          .filter((li) => li.description.trim())
          .map((li) => ({
            description: li.description.trim(),
            qty: Number(li.qty) || 1,
            unit_price_cents: Math.round((Number(li.unit_price) || 0) * 100),
          })),
        taxes: taxes
          .filter((tx) => tx.name.trim())
          .map((tx) => ({
            name: tx.name.trim(),
            rate: Number(tx.rate) || 0,
          })),
        payment_terms: paymentTerms.trim(),
        client_note: clientNote.trim(),
        branding: template?.branding || {},
        payment_methods: template?.payment_methods || {},
        email_subject: emailSubject.trim(),
        email_body: emailBody.trim(),
        is_default: template?.is_default || false,
      };

      if (isEditMode && template) {
        await updateInvoiceTemplate(template.id, input);
        toast.success('Template updated.');
      } else {
        await createInvoiceTemplate(input);
        toast.success('Template created.');
      }

      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save template.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {isOpen ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            className="bg-surface border border-outline rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-outline px-5 py-4 sticky top-0 bg-surface z-10 rounded-t-2xl">
              <h2 className="text-lg font-bold text-text-primary">
                {isEditMode ? 'Edit Template' : 'New Invoice Template'}
              </h2>
              <button type="button" onClick={onClose} className="glass-button !p-2">
                <X size={15} />
              </button>
            </div>

            {/* Form */}
            <div className="px-5 py-4 space-y-5">
              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
                  Template Name *
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Standard Cleaning Invoice"
                  className="glass-input w-full"
                />
              </div>

              {/* Title */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
                  Invoice Title
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Invoice"
                  className="glass-input w-full"
                />
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Template description for internal reference"
                  rows={2}
                  className="glass-input w-full resize-none"
                />
              </div>

              {/* Line Items */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
                    Default Line Items
                  </label>
                  <button
                    type="button"
                    onClick={() => setLineItems((prev) => [...prev, emptyLineItem()])}
                    className="glass-button inline-flex items-center gap-1.5 !px-3 !py-1.5 !text-xs"
                  >
                    <Plus size={12} />
                    Add Item
                  </button>
                </div>
                {lineItems.map((li) => (
                  <div
                    key={li.id}
                    className="grid grid-cols-12 gap-2 rounded-xl border border-outline bg-surface/70 p-2"
                  >
                    <input
                      value={li.description}
                      onChange={(e) => updateLineItem(li.id, { description: e.target.value })}
                      placeholder="Description"
                      className="glass-input col-span-6"
                    />
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={li.qty}
                      onChange={(e) => updateLineItem(li.id, { qty: Number(e.target.value) || 0 })}
                      placeholder="Qty"
                      className="glass-input col-span-2"
                    />
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={li.unit_price}
                      onChange={(e) => updateLineItem(li.id, { unit_price: Number(e.target.value) || 0 })}
                      placeholder="Price"
                      className="glass-input col-span-3"
                    />
                    <button
                      type="button"
                      onClick={() => removeLineItem(li.id)}
                      disabled={lineItems.length === 1}
                      className="glass-button col-span-1 !p-2"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Taxes */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
                    Taxes
                  </label>
                  <button
                    type="button"
                    onClick={() => setTaxes((prev) => [...prev, emptyTax()])}
                    className="glass-button inline-flex items-center gap-1.5 !px-3 !py-1.5 !text-xs"
                  >
                    <Plus size={12} />
                    Add Tax
                  </button>
                </div>
                {taxes.map((tax) => (
                  <div
                    key={tax.id}
                    className="grid grid-cols-12 gap-2 rounded-xl border border-outline bg-surface/70 p-2"
                  >
                    <input
                      value={tax.name}
                      onChange={(e) => updateTax(tax.id, { name: e.target.value })}
                      placeholder="Tax name (e.g. HST)"
                      className="glass-input col-span-6"
                    />
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={tax.rate}
                      onChange={(e) => updateTax(tax.id, { rate: Number(e.target.value) || 0 })}
                      placeholder="Rate %"
                      className="glass-input col-span-5"
                    />
                    <button
                      type="button"
                      onClick={() => removeTax(tax.id)}
                      className="glass-button col-span-1 !p-2"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                {taxes.length === 0 && (
                  <p className="text-xs text-text-tertiary">No taxes configured.</p>
                )}
              </div>

              {/* Payment Terms */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
                  Payment Terms
                </label>
                <textarea
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  placeholder="e.g. Net 30 - Payment due within 30 days"
                  rows={2}
                  className="glass-input w-full resize-none"
                />
              </div>

              {/* Client Note */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
                  Client Note
                </label>
                <textarea
                  value={clientNote}
                  onChange={(e) => setClientNote(e.target.value)}
                  placeholder="Note that appears on the invoice for the client"
                  rows={2}
                  className="glass-input w-full resize-none"
                />
              </div>

              {/* Email Subject */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
                  Email Subject
                </label>
                <input
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="e.g. Invoice #{invoice_number} from {company_name}"
                  className="glass-input w-full"
                />
              </div>

              {/* Email Body */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
                  Email Body
                </label>
                <textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  placeholder="Email body that accompanies the invoice"
                  rows={4}
                  className="glass-input w-full resize-none"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-outline bg-surface/70 px-5 py-4 sticky bottom-0 rounded-b-2xl">
              <button type="button" onClick={onClose} className="glass-button">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={saving}
                className="glass-button-primary inline-flex items-center gap-2"
              >
                {saving ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                {saving ? 'Saving...' : isEditMode ? 'Update Template' : 'Create Template'}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
