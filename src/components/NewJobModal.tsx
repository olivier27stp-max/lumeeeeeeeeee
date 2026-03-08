import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BriefcaseBusiness, Calendar, ChevronDown, Clock3, Plus, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn, formatCurrency } from '../lib/utils';
import { listClients } from '../lib/clientsApi';
import { getSuggestedJobNumber, listSalespeople } from '../lib/jobsApi';
import { listTeams } from '../lib/teamsApi';
import { Job } from '../types';

interface LineItemForm {
  id: string;
  name: string;
  qtyInput: string;
  unitPriceInput: string;
}

export interface JobDraftLineItem {
  name: string;
  qty?: number;
  unit_price_cents?: number;
}

export interface JobDraftInitialValues {
  id?: string;
  lead_id?: string | null;
  title?: string;
  client_id?: string | null;
  team_id?: string | null;
  job_number?: string | null;
  salesperson_id?: string | null;
  job_type?: 'one_off' | 'recurring';
  property_address?: string | null;
  description?: string | null;
  status?: string;
  scheduled_at?: string | null;
  end_at?: string | null;
  requires_invoicing?: boolean;
  billing_split?: boolean;
  line_items?: JobDraftLineItem[];
  subtotal?: number | null;
  tax_total?: number | null;
  total?: number | null;
  tax_lines?: Array<{ code: string; label: string; rate: number; enabled: boolean }> | null;
}

export interface JobModalSourceContext {
  type: 'jobs' | 'pipeline' | string;
  leadId?: string;
}

interface NewJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: {
    id?: string;
    title: string;
    lead_id?: string | null;
    client_id?: string | null;
    team_id?: string | null;
    job_number?: string | null;
    salesperson_id?: string | null;
    description?: string | null;
    job_type?: string | null;
    property_address?: string | null;
    scheduled_at?: string | null;
    end_at?: string | null;
    status: string;
    total_cents: number;
    currency: string;
    requires_invoicing: boolean;
    billing_split: boolean;
    line_items: Array<{ name: string; qty: number; unit_price_cents: number }>;
    subtotal?: number;
    tax_total?: number;
    total?: number;
    tax_lines?: Array<{ code: string; label: string; rate: number; enabled: boolean }>;
  }) => Promise<Job>;
  isSaving?: boolean;
  errorMessage?: string | null;
  initialValues?: JobDraftInitialValues | null;
  onCreated?: (job: Job) => void;
  onCancel?: () => void;
  source?: JobModalSourceContext | null;
  onFinishJob?: (payload: {
    jobId: string;
    subtotal: number;
    tax_total: number;
    total: number;
    tax_lines: Array<{ code: string; label: string; rate: number; enabled: boolean }>;
  }) => Promise<void>;
  isFinishingJob?: boolean;
}

function buildDateTime(date: string, time: string): string | null {
  if (!date || !time) return null;
  return new Date(`${date}T${time}:00`).toISOString();
}

function formatLocalDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLocalTimeInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function sanitizeMoneyInput(value: string) {
  const normalized = value.replace(',', '.').replace(/[^\d.]/g, '');
  const parts = normalized.split('.');
  if (parts.length <= 1) return normalized;
  return `${parts[0]}.${parts.slice(1).join('')}`;
}

function sanitizeIntegerInput(value: string) {
  const digitsOnly = value.replace(/[^\d]/g, '');
  if (!digitsOnly) return '';
  const normalized = digitsOnly.replace(/^0+(?=\d)/, '');
  return normalized || '0';
}

function sanitizeDecimalInput(value: string) {
  const normalized = value.replace(',', '.').replace(/[^\d.]/g, '');
  const [rawHead = '', ...rest] = normalized.split('.');
  const head = rawHead.replace(/^0+(?=\d)/, '') || (rawHead.startsWith('0') ? '0' : '');
  if (rest.length === 0) return head;
  return `${head || '0'}.${rest.join('')}`;
}

function normalizeDecimalInput(value: string) {
  const sanitized = sanitizeDecimalInput(value).trim();
  if (!sanitized) return '';
  if (sanitized === '0.') return '0.';
  const parsed = Number.parseFloat(sanitized);
  if (!Number.isFinite(parsed) || parsed < 0) return '';
  return String(parsed);
}

function normalizeMoneyInput(value: string) {
  const sanitized = sanitizeMoneyInput(value).trim();
  if (!sanitized) return '';
  const parsed = Number.parseFloat(sanitized);
  if (!Number.isFinite(parsed) || parsed < 0) return '';
  return String(parsed);
}

const UNASSIGNED_TEAM_VALUE = '__UNASSIGNED__';

export default function NewJobModal({
  isOpen,
  onClose,
  onSave,
  isSaving = false,
  errorMessage = null,
  initialValues = null,
  onCreated,
  onCancel,
  source = null,
  onFinishJob,
  isFinishingJob = false,
}: NewJobModalProps) {
  const isEditMode = Boolean(initialValues?.id);
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const [leadId, setLeadId] = useState<string | null>(null);
  const [teamSelection, setTeamSelection] = useState('');
  const [clients, setClients] = useState<Array<{ id: string; label: string; address: string | null }>>([]);
  const [jobNumber, setJobNumber] = useState('');
  const [salespersonId, setSalespersonId] = useState('');
  const [salespeople, setSalespeople] = useState<Array<{ id: string; label: string }>>([]);
  const [jobType, setJobType] = useState<'one_off' | 'recurring'>('one_off');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [requiresInvoicing, setRequiresInvoicing] = useState(true);
  const [billingSplit, setBillingSplit] = useState(false);
  const [description, setDescription] = useState<string | null>(null);
  const [prefilledAddress, setPrefilledAddress] = useState<string | null>(null);
  const [status, setStatus] = useState('Draft');
  const [lineItems, setLineItems] = useState<LineItemForm[]>([
    { id: crypto.randomUUID(), name: '', qtyInput: '1', unitPriceInput: '0' },
  ]);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [calendarHint, setCalendarHint] = useState<string | null>(null);
  const [tpsEnabled, setTpsEnabled] = useState(true);
  const [tpsRate, setTpsRate] = useState(5);
  const [tvqEnabled, setTvqEnabled] = useState(true);
  const [tvqRate, setTvqRate] = useState(9.975);
  const [customTaxEnabled, setCustomTaxEnabled] = useState(false);
  const [customTaxLabel, setCustomTaxLabel] = useState('Custom tax');
  const [customTaxRate, setCustomTaxRate] = useState(0);
  const [totalInput, setTotalInput] = useState('');
  const teamsQuery = useQuery({
    queryKey: ['teams'],
    queryFn: listTeams,
  });
  const teams = teamsQuery.data || [];

  useEffect(() => {
    if (!isOpen) return;
    setInlineError(null);
    setCalendarHint(null);
    setTitle(initialValues?.title || '');
    setLeadId(initialValues?.lead_id || null);
    setClientId(initialValues?.client_id || '');
    if (isEditMode) {
      setTeamSelection(initialValues?.team_id || UNASSIGNED_TEAM_VALUE);
    } else {
      setTeamSelection(initialValues?.team_id || '');
    }
    setJobNumber(initialValues?.job_number || '');
    setSalespersonId(initialValues?.salesperson_id || '');
    setJobType(initialValues?.job_type || 'one_off');
    if (isEditMode) {
      const editStartDate = formatLocalDateInput(initialValues?.scheduled_at || null);
      const editStartTime = formatLocalTimeInput(initialValues?.scheduled_at || null);
      const editEndTime = formatLocalTimeInput(initialValues?.end_at || null);
      setStartDate(editStartDate);
      setStartTime(editStartTime);
      setEndTime(editEndTime);
      setStatus(initialValues?.status || (editStartDate ? 'Scheduled' : 'Draft'));
    } else if (source?.type === 'pipeline') {
      setStartDate('');
      setStartTime('');
      setEndTime('');
      setStatus('Draft');
    } else {
      const presetStartDate = formatLocalDateInput(initialValues?.scheduled_at || null);
      const presetStartTime = formatLocalTimeInput(initialValues?.scheduled_at || null);
      const presetEndTime = formatLocalTimeInput(initialValues?.end_at || null);
      setStartDate(presetStartDate || new Date().toISOString().slice(0, 10));
      setStartTime(presetStartTime || '09:00');
      setEndTime(presetEndTime || '10:00');
      setStatus(initialValues?.status || (presetStartDate ? 'Scheduled' : 'Draft'));
    }
    setRequiresInvoicing(initialValues?.requires_invoicing ?? true);
    setBillingSplit(initialValues?.billing_split ?? false);
    setDescription(initialValues?.description || null);
    setPrefilledAddress(initialValues?.property_address || null);
    if (initialValues?.line_items?.length) {
      setLineItems(
        initialValues.line_items.map((item) => ({
          id: crypto.randomUUID(),
          name: item.name || '',
          qtyInput: String(Math.max(1, Number(item.qty || 1))),
          unitPriceInput: String(Math.max(0, Number(item.unit_price_cents || 0) / 100)),
        }))
      );
    } else {
      setLineItems([{ id: crypto.randomUUID(), name: '', qtyInput: '1', unitPriceInput: '0' }]);
    }
    const initialTotal = initialValues?.subtotal ?? initialValues?.total ?? null;
    setTotalInput(initialTotal == null ? '' : String(initialTotal));
    const initialTaxes = initialValues?.tax_lines || [];
    const initialTps = initialTaxes.find((tax) => String(tax.code || '').toLowerCase() === 'tps');
    const initialTvq = initialTaxes.find((tax) => String(tax.code || '').toLowerCase() === 'tvq');
    const initialCustom = initialTaxes.find((tax) => String(tax.code || '').toLowerCase() === 'custom');
    setTpsEnabled(initialTps ? Boolean(initialTps.enabled) : true);
    setTpsRate(initialTps?.rate ?? 5);
    setTvqEnabled(initialTvq ? Boolean(initialTvq.enabled) : true);
    setTvqRate(initialTvq?.rate ?? 9.975);
    setCustomTaxEnabled(initialCustom ? Boolean(initialCustom.enabled) : false);
    setCustomTaxLabel(initialCustom?.label || 'Custom tax');
    setCustomTaxRate(initialCustom?.rate ?? 0);

    listClients({ page: 1, pageSize: 200, sort: 'name_asc' })
      .then((result) => {
        const options = result.items.map((client) => ({
          id: client.id,
          label:
            `${client.first_name || ''} ${client.last_name || ''}`.trim() ||
            client.company ||
            `Client ${client.id.slice(0, 6)}`,
          address: client.address,
        }));
        setClients(options);
      })
      .catch((error) => {
        console.error('[jobs] failed to load clients', error);
        setClients([]);
      });

    if (!initialValues?.job_number) {
      getSuggestedJobNumber()
        .then(setJobNumber)
        .catch(() => setJobNumber(''));
    }

    listSalespeople()
      .then(setSalespeople)
      .catch(() => setSalespeople([]));
  }, [isOpen, initialValues, isEditMode, source?.type]);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === clientId) || null,
    [clients, clientId]
  );

  const totalCents = useMemo(() => {
    return lineItems.reduce((sum, item) => {
      const qtyParsed = Number.parseFloat(item.qtyInput || '0');
      const unitParsed = Number.parseFloat(item.unitPriceInput || '0');
      const qty = Number.isFinite(qtyParsed) ? qtyParsed : 0;
      const unit = Math.round((Number.isFinite(unitParsed) ? unitParsed : 0) * 100);
      return sum + Math.max(0, Math.round(qty * unit));
    }, 0);
  }, [lineItems]);

  const lineItemsSubtotalValue = useMemo(() => totalCents / 100, [totalCents]);
  const effectiveSubtotalValue = useMemo(() => {
    const parsed = Number.parseFloat(totalInput);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    return lineItemsSubtotalValue;
  }, [lineItemsSubtotalValue, totalInput]);
  const effectiveSubtotalCents = useMemo(() => Math.round(effectiveSubtotalValue * 100), [effectiveSubtotalValue]);
  const taxLines = useMemo(
    () => [
      { code: 'tps', label: 'TPS', rate: Number.isFinite(tpsRate) ? tpsRate : 0, enabled: tpsEnabled },
      { code: 'tvq', label: 'TVQ', rate: Number.isFinite(tvqRate) ? tvqRate : 0, enabled: tvqEnabled },
      {
        code: 'custom',
        label: customTaxLabel.trim() || 'Custom tax',
        rate: Number.isFinite(customTaxRate) ? customTaxRate : 0,
        enabled: customTaxEnabled,
      },
    ],
    [customTaxEnabled, customTaxLabel, customTaxRate, tpsEnabled, tpsRate, tvqEnabled, tvqRate]
  );

  const taxTotalCents = useMemo(
    () =>
      taxLines.reduce((sum, line) => {
        if (!line.enabled || line.rate <= 0) return sum;
        return sum + Math.round(effectiveSubtotalCents * (line.rate / 100));
      }, 0),
    [effectiveSubtotalCents, taxLines]
  );

  const grandTotalCents = effectiveSubtotalCents + taxTotalCents;

  const resetForm = () => {
    setTitle('');
    setLeadId(null);
    setClientId('');
    setTeamSelection('');
    setJobNumber('');
    setSalespersonId('');
    setJobType('one_off');
    setStartDate(new Date().toISOString().slice(0, 10));
    setStartTime('09:00');
    setEndTime('10:00');
    setRequiresInvoicing(true);
    setBillingSplit(false);
    setDescription(null);
    setPrefilledAddress(null);
    setStatus('Scheduled');
    setLineItems([{ id: crypto.randomUUID(), name: '', qtyInput: '1', unitPriceInput: '0' }]);
    setTotalInput('');
    setInlineError(null);
    setCalendarHint(null);
    setTpsEnabled(true);
    setTpsRate(5);
    setTvqEnabled(true);
    setTvqRate(9.975);
    setCustomTaxEnabled(false);
    setCustomTaxLabel('Custom tax');
    setCustomTaxRate(0);
  };

  const handleClose = (reason: 'cancel' | 'created' = 'cancel') => {
    resetForm();
    onClose();
    if (reason === 'cancel') onCancel?.();
  };

  const updateLineItem = (id: string, patch: Partial<LineItemForm>) => {
    setLineItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const removeLineItem = (id: string) => {
    setLineItems((prev) => (prev.length > 1 ? prev.filter((item) => item.id !== id) : prev));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setInlineError(null);

    if (!title.trim()) {
      setInlineError('Job title is required.');
      return;
    }

    if (!clientId) {
      setInlineError('Please select a client.');
      return;
    }

    if (!teamSelection) {
      setInlineError('Please assign a team or choose Unassigned.');
      return;
    }

    const teamIdPayload = teamSelection === UNASSIGNED_TEAM_VALUE ? null : teamSelection;

    const scheduledAt = startDate && startTime ? buildDateTime(startDate, startTime) : null;
    const endAt = startDate && endTime ? buildDateTime(startDate, endTime) : null;
    if (!scheduledAt || !endAt) {
      setInlineError('Start and end date/time are required.');
      return;
    }
    if (endAt && !scheduledAt) {
      setInlineError('Start time is required when end time is provided.');
      return;
    }
    if (scheduledAt && endAt && new Date(endAt) <= new Date(scheduledAt)) {
      setInlineError('End time must be after start time.');
      return;
    }

    const filteredItems = lineItems
      .filter((item) => item.name.trim())
      .map((item) => ({
        name: item.name.trim(),
        qty: Math.max(1, Number.parseFloat(item.qtyInput || '0') || 1),
        unit_price_cents: Math.max(0, Math.round((Number.parseFloat(item.unitPriceInput || '0') || 0) * 100)),
      }));

    try {
      const createdJob = await onSave({
        id: initialValues?.id,
        title: title.trim(),
        lead_id: leadId || null,
        client_id: clientId || null,
        team_id: teamIdPayload,
        job_number: jobNumber.trim() || null,
        salesperson_id: salespersonId || null,
        description,
        job_type: jobType,
        property_address: selectedClient?.address || prefilledAddress || null,
        scheduled_at: scheduledAt,
        end_at: endAt,
        status: scheduledAt ? status : 'Draft',
        total_cents: grandTotalCents,
        currency: 'CAD',
        requires_invoicing: requiresInvoicing,
        billing_split: billingSplit,
        line_items: filteredItems,
        subtotal: effectiveSubtotalValue,
        tax_total: taxTotalCents / 100,
        total: grandTotalCents / 100,
        tax_lines: taxLines,
      });
      onCreated?.(createdJob);
      handleClose('created');
    } catch (error: any) {
      console.error('[jobs] failed to create job', error);
      setInlineError(error?.message || 'Failed to save job.');
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 backdrop-blur-md p-4">
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            className="w-full max-w-6xl max-h-[92vh] glass rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden text-black"
          >
            <div className="px-6 py-5 border-b border-white/15 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-black text-white flex items-center justify-center">
                  <BriefcaseBusiness size={18} />
                </div>
                <div>
                  <h2 className="text-3xl font-semibold tracking-tight">{isEditMode ? 'Edit Job' : 'New Job'}</h2>
                  <p className="text-sm text-black uppercase tracking-wide font-bold">
                    {isEditMode ? 'Update scheduled job details' : 'Create a new lead or service request'}
                  </p>
                </div>
              </div>
              <button onClick={() => handleClose()} className="p-2 rounded-full hover:bg-surface-secondary transition-colors">
                <X size={18} />
              </button>
            </div>

            <form id="new-job-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
              <section className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-black font-semibold">Job title</label>
                <input
                  autoFocus
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="glass-input w-full text-3xl"
                  placeholder="e.g. Residential Cleaning - Smith Residence"
                  required
                />
              </section>

              <section className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-widest text-black font-semibold">Client</label>
                  <select
                    value={clientId}
                    onChange={(event) => setClientId(event.target.value)}
                    className="glass-input w-full"
                    required
                  >
                    <option value="">Select a client</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-widest text-black font-semibold">Assign team</label>
                  <select
                    value={teamSelection}
                    onChange={(event) => setTeamSelection(event.target.value)}
                    className="glass-input w-full"
                    required
                  >
                    <option value="">Select a team</option>
                    <option value={UNASSIGNED_TEAM_VALUE}>Unassigned</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                  {teamsQuery.isFetching ? (
                    <p className="text-[11px] text-text-tertiary">Loading teams...</p>
                  ) : null}
                  {teamsQuery.isError ? (
                    <p className="text-[11px] text-danger">Could not load teams.</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-widest text-black font-semibold">Job #</label>
                  <input
                    value={jobNumber}
                    onChange={(event) => setJobNumber(event.target.value)}
                    className="glass-input w-full"
                    placeholder="322"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-widest text-black font-semibold">Salesperson</label>
                  <div className="relative">
                    <select
                      value={salespersonId}
                      onChange={(event) => setSalespersonId(event.target.value)}
                      className="glass-input w-full pr-10"
                    >
                      <option value="">Assign</option>
                      {salespeople.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.label}
                        </option>
                      ))}
                    </select>
                    <Plus size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
                  </div>
                </div>
              </section>

              <section className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-6 border-t border-white/15">
                <div className="space-y-4">
                  <h3 className="text-3xl font-semibold tracking-tight">Job type</h3>
                  <div className="inline-flex rounded-xl bg-surface-secondary border border-border p-1">
                    <button
                      type="button"
                      onClick={() => setJobType('one_off')}
                      className={cn(
                        'px-4 py-2 rounded-lg text-lg font-medium transition-colors',
                        jobType === 'one_off' ? 'bg-surface shadow-sm text-black' : 'text-text-tertiary'
                      )}
                    >
                      One-off
                    </button>
                    <button
                      type="button"
                      onClick={() => setJobType('recurring')}
                      className={cn(
                        'px-4 py-2 rounded-lg text-lg font-medium transition-colors',
                        jobType === 'recurring' ? 'bg-surface shadow-sm text-black' : 'text-text-tertiary'
                      )}
                    >
                      Recurring
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-3xl font-semibold tracking-tight">Schedule</h3>
                    <button
                      type="button"
                      onClick={() => setCalendarHint('Calendar picker coming soon')}
                      title="Coming soon"
                      className="text-sm text-black uppercase tracking-widest hover:text-black inline-flex items-center gap-1"
                    >
                      <Calendar size={12} />
                      Show calendar
                    </button>
                  </div>
                  {calendarHint && <p className="text-xs text-black">{calendarHint}</p>}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest text-black font-semibold">Start date</label>
                      <div className="relative">
                        <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                        <input
                          type="date"
                          value={startDate}
                          onChange={(event) => setStartDate(event.target.value)}
                          className="glass-input w-full pl-10"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest text-black font-semibold">Start time</label>
                      <div className="relative">
                        <Clock3 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                        <input
                          type="time"
                          value={startTime}
                          onChange={(event) => setStartTime(event.target.value)}
                          className="glass-input w-full pl-10"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest text-black font-semibold">End time</label>
                      <div className="relative">
                        <Clock3 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                        <input
                          type="time"
                          value={endTime}
                          onChange={(event) => setEndTime(event.target.value)}
                          className="glass-input w-full pl-10"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="pt-6 border-t border-white/15 space-y-4">
                <h3 className="text-3xl font-semibold tracking-tight">Billing</h3>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={requiresInvoicing}
                    onChange={(event) => setRequiresInvoicing(event.target.checked)}
                    className="h-4 w-4"
                  />
                  <span className="text-xl">Remind me to invoice when I close the job</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={billingSplit}
                    onChange={(event) => setBillingSplit(event.target.checked)}
                    className="h-4 w-4"
                  />
                  <span className="text-xl">Split into multiple invoices with a payment schedule</span>
                </label>
              </section>

              <section className="pt-6 border-t border-white/15 space-y-4">
                <h3 className="text-3xl font-semibold tracking-tight">Product / Service</h3>
                {lineItems.map((item) => (
                  <div key={item.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                    <div className="md:col-span-6 space-y-2">
                      <label className="text-xs uppercase tracking-widest text-black font-semibold">Name</label>
                      <input
                        value={item.name}
                        onChange={(event) => updateLineItem(item.id, { name: event.target.value })}
                        className="glass-input w-full"
                        placeholder="Service name"
                      />
                    </div>
                    <div className="md:col-span-2 space-y-2">
                      <label className="text-xs uppercase tracking-widest text-black font-semibold">Quantity</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={item.qtyInput}
                        onChange={(event) => updateLineItem(item.id, { qtyInput: sanitizeIntegerInput(event.target.value) })}
                        onBlur={(event) => {
                          const normalized = sanitizeIntegerInput(event.target.value);
                          updateLineItem(item.id, { qtyInput: normalized || '1' });
                        }}
                        className="glass-input w-full"
                      />
                    </div>
                    <div className="md:col-span-3 space-y-2">
                      <label className="text-xs uppercase tracking-widest text-black font-semibold">Unit price</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={item.unitPriceInput}
                        onChange={(event) =>
                          updateLineItem(item.id, { unitPriceInput: sanitizeDecimalInput(event.target.value) })
                        }
                        onBlur={(event) =>
                          updateLineItem(item.id, { unitPriceInput: normalizeDecimalInput(event.target.value) || '0' })
                        }
                        className="glass-input w-full"
                      />
                    </div>
                    <div className="md:col-span-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => removeLineItem(item.id)}
                        className="glass-button !px-3"
                        disabled={lineItems.length === 1}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setLineItems((prev) => [...prev, { id: crypto.randomUUID(), name: '', qtyInput: '1', unitPriceInput: '0' }])
                  }
                  className="glass-button-primary !py-2 !px-4 inline-flex items-center gap-2"
                >
                  <Plus size={14} />
                  Add Line Item
                </button>
              </section>

              <section className="pt-6 border-t border-white/15 space-y-4">
                <h3 className="text-3xl font-semibold tracking-tight">Taxes</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-widest text-black font-semibold">TPS</span>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={tpsEnabled} onChange={(event) => setTpsEnabled(event.target.checked)} className="h-4 w-4" />
                      <input type="number" min={0} step={0.001} value={tpsRate} onChange={(event) => setTpsRate(Number(event.target.value) || 0)} className="glass-input w-full" />
                    </div>
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs uppercase tracking-widest text-black font-semibold">TVQ</span>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={tvqEnabled} onChange={(event) => setTvqEnabled(event.target.checked)} className="h-4 w-4" />
                      <input type="number" min={0} step={0.001} value={tvqRate} onChange={(event) => setTvqRate(Number(event.target.value) || 0)} className="glass-input w-full" />
                    </div>
                  </label>
                  <div className="space-y-2">
                    <span className="text-xs uppercase tracking-widest text-black font-semibold">Custom tax</span>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={customTaxEnabled} onChange={(event) => setCustomTaxEnabled(event.target.checked)} className="h-4 w-4" />
                        Enabled
                      </label>
                      <input value={customTaxLabel} onChange={(event) => setCustomTaxLabel(event.target.value)} className="glass-input w-full" placeholder="Tax label" />
                      <input type="number" min={0} step={0.001} value={customTaxRate} onChange={(event) => setCustomTaxRate(Number(event.target.value) || 0)} className="glass-input w-full" />
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-surface/70 p-4 text-sm">
                  <label className="mb-2 block space-y-1">
                    <span className="text-[11px] uppercase tracking-widest text-text-secondary">Total before taxes</span>
                    <input
                      value={totalInput}
                      onChange={(event) => setTotalInput(sanitizeMoneyInput(event.target.value))}
                      onBlur={(event) => setTotalInput(normalizeMoneyInput(event.target.value))}
                      inputMode="decimal"
                      className="glass-input w-full"
                      placeholder={lineItemsSubtotalValue.toFixed(2)}
                    />
                  </label>
                  <p className="flex items-center justify-between"><span>Subtotal</span><span>{formatCurrency(effectiveSubtotalValue)}</span></p>
                  <p className="mt-1 flex items-center justify-between"><span>Taxes</span><span>{formatCurrency(taxTotalCents / 100)}</span></p>
                  <p className="mt-2 border-t border-black/10 pt-2 flex items-center justify-between font-semibold text-base">
                    <span>Total</span><span>{formatCurrency(grandTotalCents / 100)}</span>
                  </p>
                </div>
              </section>

              {(inlineError || errorMessage) && (
                <div className="rounded-xl border border-danger bg-danger-light text-danger px-4 py-3 text-sm">
                  {inlineError || errorMessage}
                </div>
              )}
            </form>

            <div className="px-6 py-4 border-t border-white/15 bg-surface/70 backdrop-blur sticky bottom-0 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-widest text-black font-semibold">Total value</p>
                <p className="text-4xl font-semibold tracking-tight">{formatCurrency(grandTotalCents / 100)}</p>
              </div>
              <div className="flex items-center gap-3">
                {isEditMode && initialValues?.id && onFinishJob ? (
                  <button
                    type="button"
                    onClick={() =>
                      void onFinishJob({
                        jobId: initialValues.id as string,
                        subtotal: effectiveSubtotalValue,
                        tax_total: taxTotalCents / 100,
                        total: grandTotalCents / 100,
                        tax_lines: taxLines,
                      })
                    }
                    className="glass-button"
                    disabled={isFinishingJob || isSaving}
                  >
                    {isFinishingJob ? 'Finishing...' : 'Finish job'}
                  </button>
                ) : null}
                <button onClick={() => handleClose()} className="glass-button">
                  Cancel
                </button>
                <button form="new-job-form" type="submit" disabled={isSaving} className="glass-button-primary inline-flex items-center gap-2">
                  {isSaving ? 'Saving...' : isEditMode ? 'Save Changes' : 'Save Job'}
                  <ChevronDown size={14} className="opacity-80" />
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
