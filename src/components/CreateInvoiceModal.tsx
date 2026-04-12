/* ═══════════════════════════════════════════════════════════════
   Modal — Create Invoice (Dual Mode: From Job or From Client)
   Step 1: Choose mode (Job or Client)
   Step 2a (Job): Select job → auto-fill line items from job
   Step 2b (Client): Select client → manual line items
   Step 3: Review draft with totals → save
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../i18n';
import { AnimatePresence, motion } from 'motion/react';
import { Briefcase, ChevronDown, ChevronLeft, Plus, Search, Trash2, User, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import {
  createInvoiceDraft,
  formatMoneyFromCents,
  InvoiceItemInput,
  saveInvoiceDraft,
  getJobLineItems,
} from '../lib/invoicesApi';
import { listPredefinedServices, type PredefinedService } from '../lib/servicesApi';
import { cn } from '../lib/utils';

interface CreateInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (invoiceId: string) => void;
}

type Step = 'choose-mode' | 'select-job' | 'select-client' | 'draft';
type Mode = 'job' | 'client';

interface InvoiceLineForm {
  id: string;
  description: string;
  qty: string;
  unitPrice: string;
}

function buildEmptyLine(): InvoiceLineForm {
  return { id: crypto.randomUUID(), description: '', qty: '1', unitPrice: '' };
}

function lineFromService(svc: PredefinedService): InvoiceLineForm {
  return {
    id: crypto.randomUUID(),
    description: svc.name,
    qty: '1',
    unitPrice: (svc.default_price_cents / 100).toString(),
  };
}

function parseNum(val: string): number {
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : 0;
}

async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

export default function CreateInvoiceModal({ isOpen, onClose, onCreated }: CreateInvoiceModalProps) {
  const queryClient = useQueryClient();
  const { language } = useTranslation();
  const fr = language === 'fr';

  const [step, setStep] = useState<Step>('choose-mode');
  const [mode, setMode] = useState<Mode>('job');
  const [selectedClient, setSelectedClient] = useState<{ id: string; name: string; email: string | null } | null>(null);
  const [selectedJob, setSelectedJob] = useState<any | null>(null);
  const [searchValue, setSearchValue] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showServicePicker, setShowServicePicker] = useState(false);

  const [subject, setSubject] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [taxRate, setTaxRate] = useState('');  // percentage, e.g. "14.975"
  const [lines, setLines] = useState<InvoiceLineForm[]>([buildEmptyLine()]);
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Reset on open
  useEffect(() => {
    if (!isOpen) return;
    setStep('choose-mode');
    setMode('job');
    setSelectedClient(null);
    setSelectedJob(null);
    setSearchValue('');
    setDebouncedSearch('');
    setSubject('');
    setDueDate('');
    setTaxRate('');
    setLines([buildEmptyLine()]);
    setInlineError(null);
    setShowServicePicker(false);
  }, [isOpen]);

  // Debounce search
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(searchValue.trim()), 240);
    return () => clearTimeout(timeout);
  }, [searchValue]);

  // ─── Queries ──────────────────────────────────────────────

  // Search clients via backend (avoids RLS "id ambiguous")
  const clientsQuery = useQuery({
    queryKey: ['invoiceModalClients', debouncedSearch],
    queryFn: async () => {
      const token = await getAuthToken();
      if (!token) return { items: [], total: 0 };

      const params = new URLSearchParams({ q: debouncedSearch || '', page: '1', pageSize: '30' });
      const res = await fetch(`/api/clients/search?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        // Fallback to direct Supabase (may fail with ambiguous id on some configs)
        const { data } = await supabase
          .from('clients')
          .select('id, first_name, last_name, company, email, status')
          .is('deleted_at', null)
          .order('last_name', { ascending: true })
          .limit(30);
        return {
          items: (data || []).map((c: any) => ({
            id: c.id,
            name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.company || '',
            email: c.email || null,
          })),
          total: data?.length || 0,
        };
      }
      return res.json();
    },
    enabled: isOpen && step === 'select-client',
  });

  // Search jobs via backend (avoids RLS "id ambiguous")
  const jobsQuery = useQuery({
    queryKey: ['invoiceModalJobs', debouncedSearch],
    queryFn: async () => {
      const token = await getAuthToken();
      if (!token) return [];

      const params = new URLSearchParams();
      if (debouncedSearch) params.set('q', debouncedSearch);

      const res = await fetch(`/api/jobs/search-for-invoice?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      const json = await res.json();
      return json.jobs || [];
    },
    enabled: isOpen && step === 'select-job',
  });

  // Predefined services
  const servicesQuery = useQuery({
    queryKey: ['predefinedServices'],
    queryFn: listPredefinedServices,
    enabled: isOpen && step === 'draft' && mode === 'client',
    staleTime: 60_000,
  });
  const services = servicesQuery.data || [];

  // ─── Handle job selection ─────────────────────────────────

  async function handleSelectJob(job: any) {
    setSelectedJob(job);
    setSelectedClient({ id: job.client_id, name: job.client_name || '', email: null });
    setSubject(job.title || '');

    try {
      const items = await getJobLineItems(job.id);
      if (items && items.length > 0) {
        setLines(items.map((item: any) => ({
          id: item.id || crypto.randomUUID(),
          description: item.description || '',
          qty: String(item.qty || 1),
          unitPrice: String((item.unit_price_cents || 0) / 100),
        })));
      } else {
        setLines([{
          id: crypto.randomUUID(),
          description: job.title || (fr ? 'Service' : 'Service'),
          qty: '1',
          unitPrice: String((job.total_cents || 0) / 100),
        }]);
      }
    } catch {
      setLines([{
        id: crypto.randomUUID(),
        description: job.title || (fr ? 'Service' : 'Service'),
        qty: '1',
        unitPrice: String((job.total_cents || 0) / 100),
      }]);
    }
    setStep('draft');
  }

  function handleSelectClient(client: { id: string; name: string; email: string | null }) {
    setSelectedClient(client);
    setSelectedJob(null);
    setLines([buildEmptyLine()]);
    setSubject('');
    setStep('draft');
  }

  function addServiceAsLine(svc: PredefinedService) {
    setLines((prev) => [...prev.filter(l => l.description || parseNum(l.unitPrice) > 0), lineFromService(svc)]);
    setShowServicePicker(false);
  }

  // ─── Calculations ─────────────────────────────────────────

  const createDraftMutation = useMutation({ mutationFn: createInvoiceDraft });
  const saveDraftMutation = useMutation({ mutationFn: saveInvoiceDraft });
  const isSaving = createDraftMutation.isPending || saveDraftMutation.isPending;

  const normalizedLines = useMemo<InvoiceItemInput[]>(() => {
    return lines
      .map((line) => ({
        description: line.description.trim(),
        qty: parseNum(line.qty),
        unit_price_cents: Math.round(parseNum(line.unitPrice) * 100),
      }))
      .filter((line) => line.description && line.qty > 0 && line.unit_price_cents >= 0);
  }, [lines]);

  const subtotalCents = useMemo(
    () => normalizedLines.reduce((sum, line) => sum + Math.round(line.qty * line.unit_price_cents), 0),
    [normalizedLines],
  );

  const taxPercent = parseNum(taxRate);
  const taxCents = Math.round(subtotalCents * taxPercent / 100);
  const totalCents = subtotalCents + taxCents;

  function updateLine(id: string, patch: Partial<InvoiceLineForm>) {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }
  function removeLine(id: string) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((line) => line.id !== id)));
  }

  // ─── Save draft ───────────────────────────────────────────

  async function handleSaveDraft() {
    setInlineError(null);
    if (!selectedClient) {
      setInlineError(fr ? 'Sélectionnez un client' : 'Select a client first');
      return;
    }
    if (normalizedLines.length === 0) {
      setInlineError(fr ? 'Ajoutez au moins un item' : 'Add at least one item');
      return;
    }

    try {
      const created = await createDraftMutation.mutateAsync({
        clientId: selectedClient.id,
        subject: subject.trim() || null,
        dueDate: dueDate || null,
        jobId: selectedJob?.id || undefined,
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

      toast.success(fr ? `Brouillon créé (${created.invoice_number})` : `Draft created (${created.invoice_number})`);
      onCreated?.(created.id);
      onClose();
    } catch (error: any) {
      setInlineError(error?.message || (fr ? 'Erreur lors de la sauvegarde' : 'Could not save draft'));
    }
  }

  // ─── Render ───────────────────────────────────────────────

  const stepTitle: Record<Step, string> = {
    'choose-mode': fr ? 'Nouvelle facture' : 'New Invoice',
    'select-job': fr ? 'Sélectionner un job' : 'Select a Job',
    'select-client': fr ? 'Sélectionner un client' : 'Select a Client',
    'draft': fr ? 'Brouillon de facture' : 'Invoice Draft',
  };

  const stepSubtitle: Record<Step, string> = {
    'choose-mode': fr ? 'Choisissez comment créer votre facture' : 'Choose how to create your invoice',
    'select-job': fr ? 'Les items et le prix seront importés automatiquement' : 'Items and price will be auto-imported',
    'select-client': fr ? 'Vous ajouterez les items manuellement' : 'You\'ll add items manually',
    'draft': selectedClient?.name || '',
  };

  return (
    <AnimatePresence>
      {isOpen ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            className="glass flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border shadow-2xl"
          >
            {/* ── Header ── */}
            <header className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-3">
                {step !== 'choose-mode' && (
                  <button type="button"
                    onClick={() => setStep(step === 'draft' ? (mode === 'job' ? 'select-job' : 'select-client') : 'choose-mode')}
                    className="p-1.5 rounded-lg hover:bg-surface-secondary transition-colors text-text-muted hover:text-text-primary">
                    <ChevronLeft size={16} />
                  </button>
                )}
                <div>
                  <h2 className="text-lg font-semibold text-text-primary">{stepTitle[step]}</h2>
                  <p className="text-xs text-text-muted">{stepSubtitle[step]}</p>
                </div>
              </div>
              <button type="button" onClick={onClose}
                className="p-2 rounded-lg hover:bg-surface-secondary transition-colors text-text-muted hover:text-text-primary">
                <X size={16} />
              </button>
            </header>

            {/* ── Step 1: Choose Mode ── */}
            {step === 'choose-mode' && (
              <div className="p-5 space-y-3">
                <button onClick={() => { setMode('job'); setStep('select-job'); setSearchValue(''); }}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-outline/50 hover:border-primary/40 hover:bg-primary/5 transition-all group text-left">
                  <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
                    <Briefcase size={20} className="text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-text-primary">{fr ? 'À partir d\'un job' : 'From a Job'}</p>
                    <p className="text-xs text-text-muted mt-0.5">{fr ? 'Les items et le prix du job seront importés automatiquement' : 'Job items and price will be auto-imported'}</p>
                  </div>
                </button>
                <button onClick={() => { setMode('client'); setStep('select-client'); setSearchValue(''); }}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-outline/50 hover:border-primary/40 hover:bg-primary/5 transition-all group text-left">
                  <div className="w-11 h-11 rounded-xl bg-surface-secondary flex items-center justify-center shrink-0 group-hover:bg-surface-tertiary transition-colors">
                    <User size={20} className="text-text-secondary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-text-primary">{fr ? 'À partir d\'un client' : 'From a Client'}</p>
                    <p className="text-xs text-text-muted mt-0.5">{fr ? 'Sélectionnez un client et ajoutez les items manuellement' : 'Select a client and add items manually'}</p>
                  </div>
                </button>
              </div>
            )}

            {/* ── Step 2a: Select Job ── */}
            {step === 'select-job' && (
              <div className="p-5 space-y-3">
                <div className="relative">
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input value={searchValue} onChange={(e) => setSearchValue(e.target.value)}
                    placeholder={fr ? 'Rechercher un job...' : 'Search jobs...'}
                    className="glass-input w-full pl-9" autoFocus />
                </div>
                <div className="max-h-[50vh] overflow-y-auto space-y-1.5 pr-1">
                  {jobsQuery.isLoading && <p className="text-sm text-text-muted py-4 text-center">{fr ? 'Chargement...' : 'Loading...'}</p>}
                  {jobsQuery.isError && <p className="text-sm text-danger py-4 text-center">{fr ? 'Erreur de chargement' : 'Failed to load'}</p>}
                  {!jobsQuery.isLoading && (jobsQuery.data || []).length === 0 && (
                    <p className="text-sm text-text-muted py-8 text-center">{fr ? 'Aucun job trouvé' : 'No jobs found'}</p>
                  )}
                  {(jobsQuery.data || []).map((job: any) => (
                    <button key={job.id} type="button"
                      onClick={() => handleSelectJob(job)}
                      className="w-full flex items-center justify-between gap-3 rounded-xl border border-outline/30 bg-surface px-4 py-3 text-left transition-all hover:bg-surface-secondary hover:border-outline/60">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{job.title || (fr ? 'Sans titre' : 'Untitled')}</p>
                        <p className="text-xs text-text-muted truncate mt-0.5">
                          {job.client_name || '—'}
                          {job.property_address ? ` · ${job.property_address}` : ''}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold text-text-primary tabular-nums">{formatMoneyFromCents(job.total_cents || 0)}</p>
                        <p className={cn('text-[10px] font-semibold uppercase tracking-wide mt-0.5',
                          job.status === 'completed' ? 'text-emerald-600' : 'text-text-secondary')}>
                          {job.status === 'completed' ? (fr ? 'Terminé' : 'Completed') :
                           job.status === 'in_progress' ? (fr ? 'En cours' : 'In Progress') :
                           job.status === 'scheduled' ? (fr ? 'Planifié' : 'Scheduled') : job.status}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Step 2b: Select Client ── */}
            {step === 'select-client' && (
              <div className="p-5 space-y-3">
                <div className="relative">
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input value={searchValue} onChange={(e) => setSearchValue(e.target.value)}
                    placeholder={fr ? 'Rechercher un client...' : 'Search clients...'}
                    className="glass-input w-full pl-9" autoFocus />
                </div>
                <div className="max-h-[50vh] overflow-y-auto space-y-1.5 pr-1">
                  {clientsQuery.isLoading && <p className="text-sm text-text-muted py-4 text-center">{fr ? 'Chargement...' : 'Loading...'}</p>}
                  {clientsQuery.isError && <p className="text-sm text-danger py-4 text-center">{fr ? 'Erreur de chargement' : 'Failed to load'}</p>}
                  {!clientsQuery.isLoading && (clientsQuery.data?.items || []).length === 0 && (
                    <p className="text-sm text-text-muted py-8 text-center">{fr ? 'Aucun client trouvé' : 'No clients found'}</p>
                  )}
                  {(clientsQuery.data?.items || []).map((client: any) => (
                    <button key={client.id} type="button"
                      onClick={() => handleSelectClient({ id: client.id, name: client.name, email: client.email })}
                      className="w-full flex items-center gap-3 rounded-xl border border-outline/30 bg-surface px-4 py-3 text-left transition-all hover:bg-surface-secondary hover:border-outline/60">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center text-[11px] font-bold text-white shrink-0">
                        {client.name?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{client.name}</p>
                        <p className="text-xs text-text-muted truncate">{client.email || (fr ? 'Pas d\'email' : 'No email')}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Step 3: Draft ── */}
            {step === 'draft' && (
              <>
                <section className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                  {selectedJob && (
                    <div className="flex items-center gap-2 text-xs text-text-muted bg-surface-secondary/50 rounded-lg px-3 py-2">
                      <Briefcase size={13} className="text-primary shrink-0" />
                      <span>{fr ? 'Depuis le job :' : 'From job:'} <strong className="text-text-primary">{selectedJob.title}</strong></span>
                    </div>
                  )}

                  {/* Subject + Due Date */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-2 space-y-1.5">
                      <label className="text-xs font-medium text-text-secondary">{fr ? 'Sujet' : 'Subject'}</label>
                      <input value={subject} onChange={(e) => setSubject(e.target.value)}
                        placeholder={fr ? 'Ex: Réparation plomberie' : 'Ex: Plumbing repair'}
                        className="glass-input w-full" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-text-secondary">{fr ? 'Échéance' : 'Due Date'}</label>
                      <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                        className="glass-input w-full" />
                    </div>
                  </div>

                  {/* Line items */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-text-primary">{fr ? 'Items' : 'Items'}</h3>
                      <div className="flex items-center gap-1.5">
                        {mode === 'client' && services.length > 0 && (
                          <div className="relative">
                            <button type="button"
                              onClick={() => setShowServicePicker(!showServicePicker)}
                              className="glass-button inline-flex items-center gap-1.5 !px-2.5 !py-1 text-[12px]">
                              <ChevronDown size={13} /> {fr ? 'Services' : 'Services'}
                            </button>
                            <AnimatePresence>
                              {showServicePicker && (
                                <motion.div
                                  initial={{ opacity: 0, y: -4, scale: 0.95 }}
                                  animate={{ opacity: 1, y: 0, scale: 1 }}
                                  exit={{ opacity: 0, y: -4, scale: 0.95 }}
                                  transition={{ duration: 0.12 }}
                                  className="absolute right-0 top-full mt-1 z-50 w-64 max-h-52 overflow-y-auto rounded-xl border border-outline/60 bg-surface shadow-xl py-1">
                                  {services.map((svc) => (
                                    <button key={svc.id} type="button"
                                      onClick={() => addServiceAsLine(svc)}
                                      className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-secondary transition-colors">
                                      <span className="text-[12.5px] font-medium text-text-primary truncate">{svc.name}</span>
                                      <span className="text-[11px] font-semibold text-text-muted tabular-nums shrink-0">
                                        {formatMoneyFromCents(svc.default_price_cents)}
                                      </span>
                                    </button>
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )}
                        <button type="button" onClick={() => setLines((prev) => [...prev, buildEmptyLine()])}
                          className="glass-button inline-flex items-center gap-1.5 !px-2.5 !py-1 text-[12px]">
                          <Plus size={13} /> {fr ? 'Ligne vide' : 'Add line'}
                        </button>
                      </div>
                    </div>

                    {/* Column headers */}
                    <div className="grid grid-cols-[1fr_70px_100px_32px] gap-2 px-1">
                      <span className="text-[10px] font-medium text-text-muted uppercase tracking-wide">Description</span>
                      <span className="text-[10px] font-medium text-text-muted uppercase tracking-wide text-center">{fr ? 'Qté' : 'Qty'}</span>
                      <span className="text-[10px] font-medium text-text-muted uppercase tracking-wide text-right">{fr ? 'Prix ($)' : 'Price ($)'}</span>
                      <span />
                    </div>

                    {lines.map((line) => (
                      <div key={line.id} className="grid grid-cols-[1fr_70px_100px_32px] gap-2 items-center">
                        <input value={line.description}
                          onChange={(e) => updateLine(line.id, { description: e.target.value })}
                          placeholder={fr ? 'Service ou produit...' : 'Service or product...'}
                          className="glass-input text-[13px]" />
                        <input
                          type="text" inputMode="numeric"
                          value={line.qty}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === '' || /^\d*\.?\d*$/.test(v)) updateLine(line.id, { qty: v });
                          }}
                          onBlur={() => { if (!line.qty) updateLine(line.id, { qty: '1' }); }}
                          placeholder="1"
                          className="glass-input text-[13px] text-center" />
                        <input
                          type="text" inputMode="decimal"
                          value={line.unitPrice}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === '' || /^\d*\.?\d*$/.test(v)) updateLine(line.id, { unitPrice: v });
                          }}
                          placeholder="0.00"
                          className="glass-input text-[13px] text-right" />
                        <button type="button" onClick={() => removeLine(line.id)}
                          disabled={lines.length === 1}
                          className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/8 disabled:opacity-20 transition-all">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Totals */}
                  <div className="rounded-xl border border-outline/40 bg-surface-secondary/30 p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-xs text-text-muted">{fr ? 'Sous-total' : 'Subtotal'}</span>
                      <span className="text-sm font-medium text-text-primary tabular-nums">{formatMoneyFromCents(subtotalCents)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-muted">{fr ? 'Taxes' : 'Tax'}</span>
                        <div className="relative">
                          <input
                            type="text" inputMode="decimal"
                            value={taxRate}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === '' || /^\d*\.?\d*$/.test(v)) setTaxRate(v);
                            }}
                            className="glass-input w-20 !h-7 text-[12px] text-right !py-0 !pr-6" placeholder="0" />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-text-muted font-medium">%</span>
                        </div>
                      </div>
                      <span className="text-sm font-medium text-text-primary tabular-nums">{formatMoneyFromCents(taxCents)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4 pt-2 border-t border-outline/30">
                      <span className="text-sm font-semibold text-text-primary">{fr ? 'Total' : 'Total'}</span>
                      <span className="text-base font-bold text-text-primary tabular-nums">{formatMoneyFromCents(totalCents)}</span>
                    </div>
                  </div>

                  {inlineError && (
                    <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger font-medium">
                      {inlineError}
                    </div>
                  )}
                </section>

                <footer className="flex items-center justify-between border-t border-border px-5 py-3.5">
                  <button type="button" onClick={onClose} className="glass-button text-[13px]">
                    {fr ? 'Annuler' : 'Cancel'}
                  </button>
                  <button type="button" onClick={() => void handleSaveDraft()} disabled={isSaving}
                    className="glass-button-primary text-[13px]">
                    {isSaving ? (fr ? 'Sauvegarde...' : 'Saving...') : (fr ? 'Créer le brouillon' : 'Create Draft')}
                  </button>
                </footer>
              </>
            )}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
