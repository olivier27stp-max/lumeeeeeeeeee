import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, Plus, Search, Trash2, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  createInvoiceDraft,
  formatMoneyFromCents,
  InvoiceItemInput,
  saveInvoiceDraft,
  searchActiveClients,
} from '../lib/invoicesApi';

interface CreateInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (invoiceId: string) => void;
}

type Step = 'select-client' | 'draft';

interface InvoiceLineForm {
  id: string;
  description: string;
  qty: number;
  unitPrice: number;
}

function buildEmptyLine(): InvoiceLineForm {
  return {
    id: crypto.randomUUID(),
    description: '',
    qty: 1,
    unitPrice: 0,
  };
}

export default function CreateInvoiceModal({ isOpen, onClose, onCreated }: CreateInvoiceModalProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('select-client');
  const [selectedClient, setSelectedClient] = useState<{ id: string; name: string; email: string | null } | null>(null);
  const [searchValue, setSearchValue] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [subject, setSubject] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [tax, setTax] = useState(0);
  const [lines, setLines] = useState<InvoiceLineForm[]>([buildEmptyLine()]);
  const [inlineError, setInlineError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStep('select-client');
    setSelectedClient(null);
    setSearchValue('');
    setDebouncedSearch('');
    setSubject('');
    setDueDate('');
    setTax(0);
    setLines([buildEmptyLine()]);
    setInlineError(null);
  }, [isOpen]);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(searchValue.trim()), 240);
    return () => clearTimeout(timeout);
  }, [searchValue]);

  const clientsQuery = useQuery({
    queryKey: ['invoiceClients', debouncedSearch],
    queryFn: () => searchActiveClients({ q: debouncedSearch, page: 1, pageSize: 30 }),
    enabled: isOpen && step === 'select-client',
  });

  const createDraftMutation = useMutation({
    mutationFn: createInvoiceDraft,
  });

  const saveDraftMutation = useMutation({
    mutationFn: saveInvoiceDraft,
  });

  const isSaving = createDraftMutation.isPending || saveDraftMutation.isPending;

  const normalizedLines = useMemo<InvoiceItemInput[]>(() => {
    return lines
      .map((line) => ({
        description: line.description.trim(),
        qty: Number.isFinite(line.qty) ? line.qty : 0,
        unit_price_cents: Math.round((Number.isFinite(line.unitPrice) ? line.unitPrice : 0) * 100),
      }))
      .filter((line) => line.description && line.qty > 0 && line.unit_price_cents >= 0);
  }, [lines]);

  const subtotalCents = useMemo(
    () =>
      normalizedLines.reduce((sum, line) => {
        return sum + Math.round(line.qty * line.unit_price_cents);
      }, 0),
    [normalizedLines]
  );
  const taxCents = useMemo(() => Math.max(0, Math.round((Number.isFinite(tax) ? tax : 0) * 100)), [tax]);
  const totalCents = subtotalCents + taxCents;

  function updateLine(id: string, patch: Partial<InvoiceLineForm>) {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function removeLine(id: string) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((line) => line.id !== id)));
  }

  async function handleSaveDraft() {
    setInlineError(null);
    if (!selectedClient) {
      setInlineError('Select a client first.');
      return;
    }

    try {
      const created = await createDraftMutation.mutateAsync({
        clientId: selectedClient.id,
        subject: subject.trim() || null,
        dueDate: dueDate || null,
      });

      await saveDraftMutation.mutateAsync({
        invoiceId: created.id,
        subject: subject.trim() || null,
        dueDate: dueDate || null,
        taxCents,
        items: normalizedLines,
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invoicesTable'] }),
        queryClient.invalidateQueries({ queryKey: ['invoicesKpis30d'] }),
      ]);

      toast.success(`Draft created (${created.invoice_number})`);
      onCreated?.(created.id);
      onClose();
    } catch (error: any) {
      setInlineError(error?.message || 'Could not save invoice draft.');
    }
  }

  return (
    <AnimatePresence>
      {isOpen ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            className="glass flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-text-primary">Create Invoice</h2>
                <p className="text-xs text-text-secondary">
                  {step === 'select-client' ? 'Step 1: Select client' : 'Step 2: Draft invoice'}
                </p>
              </div>
              <button type="button" onClick={onClose} className="glass-button !p-2">
                <X size={15} />
              </button>
            </header>

            {step === 'select-client' ? (
              <section className="space-y-4 px-5 py-4">
                <div className="relative">
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input
                    value={searchValue}
                    onChange={(event) => setSearchValue(event.target.value)}
                    placeholder="Search active clients..."
                    className="glass-input w-full pl-9"
                  />
                </div>

                <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
                  {clientsQuery.isLoading ? <p className="text-sm text-text-secondary">Loading clients...</p> : null}
                  {clientsQuery.isError ? <p className="text-sm text-danger">Could not load clients.</p> : null}

                  {(clientsQuery.data?.items || []).map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      onClick={() => {
                        setSelectedClient({ id: client.id, name: client.name, email: client.email });
                        setStep('draft');
                      }}
                      className="w-full rounded-xl border border-white/30 bg-surface px-3 py-3 text-left transition-colors hover:bg-surface-secondary"
                    >
                      <p className="text-sm font-semibold text-text-primary">{client.name}</p>
                      <p className="text-xs text-text-secondary">{client.email || 'No email'}</p>
                    </button>
                  ))}

                  {!clientsQuery.isLoading && (clientsQuery.data?.items || []).length === 0 ? (
                    <p className="text-sm text-text-secondary">No active clients found.</p>
                  ) : null}
                </div>
              </section>
            ) : (
              <section className="flex-1 overflow-y-auto px-5 py-4">
                <div className="mb-4 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setStep('select-client')}
                    className="glass-button inline-flex items-center gap-2 !px-3 !py-1.5"
                  >
                    <ChevronLeft size={14} />
                    Back to clients
                  </button>
                  <p className="text-sm font-medium text-text-secondary">{selectedClient?.name}</p>
                </div>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                  <div className="space-y-2 lg:col-span-2">
                    <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary">Subject</label>
                    <input
                      value={subject}
                      onChange={(event) => setSubject(event.target.value)}
                      placeholder="Invoice subject"
                      className="glass-input w-full"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary">Due date</label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(event) => setDueDate(event.target.value)}
                      className="glass-input w-full"
                    />
                  </div>
                </div>

                <div className="mt-5 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold tracking-tight text-text-primary">Items</h3>
                    <button
                      type="button"
                      onClick={() => setLines((prev) => [...prev, buildEmptyLine()])}
                      className="glass-button inline-flex items-center gap-2 !px-3 !py-1.5"
                    >
                      <Plus size={13} />
                      Add line
                    </button>
                  </div>

                  {lines.map((line) => (
                    <div key={line.id} className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-surface/70 p-2 lg:grid-cols-12">
                      <input
                        value={line.description}
                        onChange={(event) => updateLine(line.id, { description: event.target.value })}
                        placeholder="Description"
                        className="glass-input lg:col-span-6"
                      />
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={line.qty}
                        onChange={(event) => updateLine(line.id, { qty: Number(event.target.value) || 0 })}
                        placeholder="Qty"
                        className="glass-input lg:col-span-2"
                      />
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={line.unitPrice}
                        onChange={(event) => updateLine(line.id, { unitPrice: Number(event.target.value) || 0 })}
                        placeholder="Unit price"
                        className="glass-input lg:col-span-3"
                      />
                      <button
                        type="button"
                        onClick={() => removeLine(line.id)}
                        className="glass-button lg:col-span-1"
                        disabled={lines.length === 1}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-5 grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface/70 p-3 lg:grid-cols-3">
                  <div className="space-y-2 lg:col-span-1">
                    <label className="text-xs font-semibold uppercase tracking-widest text-text-secondary">Tax</label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={tax}
                      onChange={(event) => setTax(Number(event.target.value) || 0)}
                      className="glass-input w-full"
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <div className="rounded-xl border border-border bg-surface p-3 text-sm">
                      <p className="flex items-center justify-between">
                        <span className="text-text-secondary">Subtotal</span>
                        <span className="font-semibold">{formatMoneyFromCents(subtotalCents)}</span>
                      </p>
                      <p className="mt-1 flex items-center justify-between">
                        <span className="text-text-secondary">Tax</span>
                        <span className="font-semibold">{formatMoneyFromCents(taxCents)}</span>
                      </p>
                      <p className="mt-2 flex items-center justify-between border-t border-black/10 pt-2 text-base">
                        <span className="font-semibold text-text-primary">Total</span>
                        <span className="font-semibold text-text-primary">{formatMoneyFromCents(totalCents)}</span>
                      </p>
                    </div>
                  </div>
                </div>

                {inlineError ? (
                  <div className="mt-4 rounded-xl border border-danger bg-danger-light px-3 py-2 text-sm text-danger">
                    {inlineError}
                  </div>
                ) : null}
              </section>
            )}

            {step === 'draft' ? (
              <footer className="flex items-center justify-between border-t border-border bg-surface/70 px-5 py-4">
                <button type="button" onClick={onClose} className="glass-button">
                  Cancel
                </button>
                <div className="flex items-center gap-2">
                  <button type="button" disabled className="glass-button !opacity-60">
                    Send invoice
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveDraft()}
                    disabled={isSaving}
                    className="glass-button-primary"
                  >
                    {isSaving ? 'Saving...' : 'Save draft'}
                  </button>
                </div>
              </footer>
            ) : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
