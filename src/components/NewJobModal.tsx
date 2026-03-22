import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BriefcaseBusiness, Calendar, ChevronDown, Clock3, MapPin, Package, Plus, Trash2, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn, formatCurrency } from '../lib/utils';
import { listClients } from '../lib/clientsApi';
import { getSuggestedJobNumber, listSalespeople } from '../lib/jobsApi';
import { resolveClientIdForLead } from '../lib/leadsApi';
import { listTeams } from '../lib/teamsApi';
import TeamSuggestions from './TeamSuggestions';
import { Job } from '../types';
import ServicePicker from './ServicePicker';
import type { PredefinedService } from '../lib/servicesApi';
import { supabase } from '../lib/supabase';
import AddressAutocomplete, { type StructuredAddress } from './AddressAutocomplete';

interface LineItemForm {
  id: string;
  name: string;
  qtyInput: string;
  unitPriceInput: string;
  included: boolean;
  source_service_id?: string | null;
}

export interface JobDraftLineItem {
  name: string;
  qty?: number;
  unit_price_cents?: number;
  included?: boolean;
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
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  country?: string | null;
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
    address_line1?: string | null;
    address_line2?: string | null;
    city?: string | null;
    province?: string | null;
    postal_code?: string | null;
    country?: string | null;
    place_id?: string | null;
    scheduled_at?: string | null;
    end_at?: string | null;
    status: string;
    total_cents: number;
    currency: string;
    requires_invoicing: boolean;
    billing_split: boolean;
    line_items: Array<{ name: string; qty: number; unit_price_cents: number; included?: boolean }>;
    deposit_required?: boolean;
    deposit_type?: 'percentage' | 'fixed' | null;
    deposit_value?: number;
    require_payment_method?: boolean;
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
  onDelete?: (jobId: string) => Promise<void>;
  isDeleting?: boolean;
}

function buildDateTime(date: string, time: string): string | null {
  if (!date || !time) return null;
  // Build ISO string preserving user-intended local time by using Date component constructor
  // which interprets values in the local timezone (consistent with the date/time inputs)
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  const d = new Date(year, month - 1, day, hours, minutes, 0);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
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
  onDelete,
  isDeleting = false,
}: NewJobModalProps) {
  const isEditMode = Boolean(initialValues?.id);
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const [leadId, setLeadId] = useState<string | null>(null);
  const [teamSelection, setTeamSelection] = useState('');
  const [clients, setClients] = useState<Array<{ id: string; label: string; address: string | null; street_number: string | null; street_name: string | null; city: string | null; province: string | null; postal_code: string | null; country: string | null; latitude: number | null; longitude: number | null }>>([]);
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
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [addressCity, setAddressCity] = useState('');
  const [addressProvince, setAddressProvince] = useState('');
  const [addressPostalCode, setAddressPostalCode] = useState('');
  const [addressCountry, setAddressCountry] = useState('Canada');
  const [addressPlaceId, setAddressPlaceId] = useState<string | null>(null);
  const [addressSearch, setAddressSearch] = useState('');
  const [status, setStatus] = useState('Draft');
  const [lineItems, setLineItems] = useState<LineItemForm[]>([
    { id: crypto.randomUUID(), name: '', qtyInput: '1', unitPriceInput: '0', included: true },
  ]);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [calendarHint, setCalendarHint] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [servicePickerOpen, setServicePickerOpen] = useState(false);
  const [addedServiceIds, setAddedServiceIds] = useState<Set<string>>(new Set());
  const [orgCurrency, setOrgCurrency] = useState('CAD');
  const [tpsEnabled, setTpsEnabled] = useState(true);
  const [tpsRate, setTpsRate] = useState(5);
  const [tvqEnabled, setTvqEnabled] = useState(true);
  const [tvqRate, setTvqRate] = useState(9.975);
  const [customTaxEnabled, setCustomTaxEnabled] = useState(false);
  const [customTaxLabel, setCustomTaxLabel] = useState('Custom tax');
  const [customTaxRate, setCustomTaxRate] = useState(0);
  const [totalInput, setTotalInput] = useState('');
  const [jobDepositRequired, setJobDepositRequired] = useState(false);
  const [jobDepositType, setJobDepositType] = useState<'percentage' | 'fixed'>('percentage');
  const [jobDepositValue, setJobDepositValue] = useState('');
  const [jobRequirePaymentMethod, setJobRequirePaymentMethod] = useState(false);
  const teamsQuery = useQuery({
    queryKey: ['teams'],
    queryFn: listTeams,
  });
  const teams = teamsQuery.data || [];

  useEffect(() => {
    if (!isOpen) return;
    setInlineError(null);
    setCalendarHint(null);
    setConfirmDelete(false);
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
    setAddressLine1(initialValues?.address_line1 || '');
    setAddressLine2(initialValues?.address_line2 || '');
    setAddressCity(initialValues?.city || '');
    setAddressProvince(initialValues?.province || '');
    setAddressPostalCode(initialValues?.postal_code || '');
    setAddressCountry(initialValues?.country || 'Canada');
    setAddressSearch(initialValues?.property_address || initialValues?.address_line1 || '');
    setAddressPlaceId(null);
    if (initialValues?.line_items?.length) {
      setLineItems(
        initialValues.line_items.map((item) => ({
          id: crypto.randomUUID(),
          name: item.name || '',
          qtyInput: String(Math.max(1, Number(item.qty || 1))),
          unitPriceInput: String(Math.max(0, Number(item.unit_price_cents || 0) / 100)),
          included: item.included !== false,
        }))
      );
    } else {
      setLineItems([{ id: crypto.randomUUID(), name: '', qtyInput: '1', unitPriceInput: '0', included: true }]);
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
          street_number: client.street_number ?? null,
          street_name: client.street_name ?? null,
          city: client.city ?? null,
          province: client.province ?? null,
          postal_code: client.postal_code ?? null,
          country: client.country ?? null,
          latitude: client.latitude != null ? Number(client.latitude) : null,
          longitude: client.longitude != null ? Number(client.longitude) : null,
        }));
        setClients(options);

        // Auto-resolve client_id from lead_id if not already set
        const currentLeadId = initialValues?.lead_id;
        const currentClientId = initialValues?.client_id;
        if (currentLeadId && !currentClientId) {
          resolveClientIdForLead(currentLeadId)
            .then((resolvedClientId) => {
              if (resolvedClientId) {
                setClientId(resolvedClientId);
              }
            })
            .catch((err) => console.error('[jobs] failed to resolve client for lead', err));
        }
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

    // Fetch org currency
    supabase
      .from('org_billing_settings')
      .select('currency')
      .limit(1)
      .maybeSingle()
      .then(({ data: billing }) => {
        if (billing?.currency) setOrgCurrency(billing.currency);
      });
  }, [isOpen, initialValues, isEditMode, source?.type]);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === clientId) || null,
    [clients, clientId]
  );

  // Auto-fill address from client when client changes (only if address is currently empty)
  useEffect(() => {
    if (!selectedClient) return;
    // Don't overwrite if user already has address filled (edit mode)
    if (addressLine1.trim()) return;

    const clientAddr = [selectedClient.street_number, selectedClient.street_name].filter(Boolean).join(' ').trim();
    if (clientAddr || selectedClient.address) {
      setAddressLine1(clientAddr || selectedClient.address || '');
      setAddressCity(selectedClient.city || '');
      setAddressProvince(selectedClient.province || '');
      setAddressPostalCode(selectedClient.postal_code || '');
      setAddressCountry(selectedClient.country || 'Canada');
      setAddressSearch(selectedClient.address || clientAddr || '');
    }
  }, [selectedClient?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalCents = useMemo(() => {
    return lineItems.reduce((sum, item) => {
      if (!item.included) return sum;
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
    setLineItems([{ id: crypto.randomUUID(), name: '', qtyInput: '1', unitPriceInput: '0', included: true }]);
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
    setLineItems((prev) => {
      const item = prev.find((i) => i.id === id);
      if (item?.source_service_id) {
        setAddedServiceIds((s) => { const n = new Set(s); n.delete(item.source_service_id!); return n; });
      }
      return prev.length > 1 ? prev.filter((i) => i.id !== id) : prev;
    });
  };

  const handleServiceSelected = (service: PredefinedService) => {
    // Replace the first empty line item or add a new one
    setLineItems((prev) => {
      const emptyIdx = prev.findIndex((item) => !item.name.trim());
      const newItem: LineItemForm = {
        id: crypto.randomUUID(),
        name: service.name,
        qtyInput: '1',
        unitPriceInput: String(service.default_price_cents / 100),
        included: true,
        source_service_id: service.id,
      };
      if (emptyIdx !== -1) {
        const updated = [...prev];
        updated[emptyIdx] = newItem;
        return updated;
      }
      return [...prev, newItem];
    });
    setAddedServiceIds((prev) => new Set([...prev, service.id]));
  };

  const handleServiceRemoved = (serviceId: string) => {
    setLineItems((prev) => {
      const filtered = prev.filter((item) => item.source_service_id !== serviceId);
      return filtered.length > 0 ? filtered : [{ id: crypto.randomUUID(), name: '', qtyInput: '1', unitPriceInput: '0', included: true }];
    });
    setAddedServiceIds((prev) => { const n = new Set(prev); n.delete(serviceId); return n; });
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

    if (!addressLine1.trim()) {
      setInlineError('Address is required. Please enter a job site address.');
      return;
    }
    if (!addressCity.trim()) {
      setInlineError('City is required for the job site address.');
      return;
    }
    if (!addressProvince.trim()) {
      setInlineError('Province is required for the job site address.');
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
        included: item.included,
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
        property_address: [addressLine1, addressCity, addressProvince, addressPostalCode].filter(Boolean).join(', ') || null,
        address_line1: addressLine1.trim() || null,
        address_line2: addressLine2.trim() || null,
        city: addressCity.trim() || null,
        province: addressProvince.trim() || null,
        postal_code: addressPostalCode.trim() || null,
        country: addressCountry.trim() || 'Canada',
        place_id: addressPlaceId,
        scheduled_at: scheduledAt,
        end_at: endAt,
        status: scheduledAt ? status : 'Draft',
        total_cents: grandTotalCents,
        currency: orgCurrency,
        requires_invoicing: requiresInvoicing,
        billing_split: billingSplit,
        line_items: filteredItems,
        deposit_required: jobDepositRequired,
        deposit_type: jobDepositRequired ? jobDepositType : null,
        deposit_value: jobDepositRequired ? (parseFloat(jobDepositValue) || 0) : 0,
        require_payment_method: jobRequirePaymentMethod,
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
    <>
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
                  {/* Team suggestions */}
                  <TeamSuggestions
                    date={startDate}
                    startTime={startTime}
                    endTime={endTime}
                    address={addressLine1 || selectedClient?.address || prefilledAddress || undefined}
                    onSelectTeam={(id) => setTeamSelection(id)}
                    selectedTeamId={teamSelection === UNASSIGNED_TEAM_VALUE ? null : teamSelection || null}
                    compact
                  />
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

              {/* Job site address */}
              <section className="space-y-4 pt-6 border-t border-white/15">
                <div className="flex items-center gap-2">
                  <MapPin size={18} className="text-text-secondary" />
                  <h3 className="text-3xl font-semibold tracking-tight">Job site address</h3>
                </div>

                <div className="space-y-3">
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-widest text-black font-semibold">Search address</label>
                    <AddressAutocomplete
                      value={addressSearch}
                      onChange={setAddressSearch}
                      onSelect={(addr: StructuredAddress) => {
                        const line1 = [addr.street_number, addr.street_name].filter(Boolean).join(' ').trim();
                        setAddressLine1(line1 || addr.formatted_address);
                        setAddressCity(addr.city);
                        setAddressProvince(addr.province);
                        setAddressPostalCode(addr.postal_code);
                        setAddressCountry(addr.country || 'Canada');
                        setAddressPlaceId(addr.place_id || null);
                        setAddressSearch(addr.formatted_address);
                      }}
                      placeholder="Start typing an address..."
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest text-black font-semibold">
                        Address line 1 <span className="text-danger">*</span>
                      </label>
                      <input
                        value={addressLine1}
                        onChange={(e) => setAddressLine1(e.target.value)}
                        className="glass-input w-full"
                        placeholder="123 Main St"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest text-black font-semibold">Address line 2</label>
                      <input
                        value={addressLine2}
                        onChange={(e) => setAddressLine2(e.target.value)}
                        className="glass-input w-full"
                        placeholder="Apt, suite, unit..."
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest text-black font-semibold">
                        City <span className="text-danger">*</span>
                      </label>
                      <input
                        value={addressCity}
                        onChange={(e) => setAddressCity(e.target.value)}
                        className="glass-input w-full"
                        placeholder="Montreal"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest text-black font-semibold">
                        Province <span className="text-danger">*</span>
                      </label>
                      <input
                        value={addressProvince}
                        onChange={(e) => setAddressProvince(e.target.value)}
                        className="glass-input w-full"
                        placeholder="QC"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest text-black font-semibold">Postal code</label>
                      <input
                        value={addressPostalCode}
                        onChange={(e) => setAddressPostalCode(e.target.value)}
                        className="glass-input w-full"
                        placeholder="H1A 1A1"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-widest text-black font-semibold">Country</label>
                      <input
                        value={addressCountry}
                        onChange={(e) => setAddressCountry(e.target.value)}
                        className="glass-input w-full"
                        placeholder="Canada"
                      />
                    </div>
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
                    <a
                      href="/calendar"
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-text-secondary uppercase tracking-widest hover:text-text-primary inline-flex items-center gap-1"
                    >
                      <Calendar size={12} />
                      View calendar
                    </a>
                  </div>
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
                <div className="flex items-center justify-between">
                  <h3 className="text-3xl font-semibold tracking-tight">Line Items</h3>
                  <button
                    type="button"
                    onClick={() => setServicePickerOpen(true)}
                    className="glass-button !py-2 !px-4 inline-flex items-center gap-2"
                  >
                    <Package size={14} />
                    Add from catalog
                  </button>
                </div>

                {/* Line items list */}
                {lineItems.length === 1 && !lineItems[0].name.trim() ? (
                  <div className="rounded-xl border border-dashed border-outline-subtle bg-surface-secondary/30 p-6 text-center">
                    <Package size={24} className="text-text-tertiary mx-auto mb-2 opacity-40" />
                    <p className="text-sm text-text-secondary">No line items added yet</p>
                    <p className="text-xs text-text-tertiary mt-1">Click "Add from catalog" to add predefined services</p>
                    <button
                      type="button"
                      onClick={() => setServicePickerOpen(true)}
                      className="mt-3 text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <Plus size={11} /> Browse services
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {lineItems.map((item) => (
                      <div
                        key={item.id}
                        className={cn(
                          'grid grid-cols-1 md:grid-cols-12 gap-3 items-end rounded-lg border p-3 transition-all',
                          item.included
                            ? 'border-outline-subtle/40 bg-surface-secondary/20'
                            : 'border-outline-subtle/20 bg-surface-secondary/5 opacity-50'
                        )}
                      >
                        <div className="md:col-span-5 space-y-1">
                          <label className="text-[10px] uppercase tracking-widest text-text-tertiary font-semibold">Name</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={item.included}
                              onChange={() => updateLineItem(item.id, { included: !item.included })}
                              className="h-4 w-4 shrink-0 rounded cursor-pointer accent-primary"
                              title={item.included ? 'Click to exclude from total' : 'Click to include in total'}
                            />
                            <input
                              value={item.name}
                              onChange={(event) => updateLineItem(item.id, { name: event.target.value })}
                              className={cn('glass-input w-full', !item.included && 'line-through')}
                              placeholder="Service name"
                            />
                          </div>
                        </div>
                        <div className="md:col-span-2 space-y-1">
                          <label className="text-[10px] uppercase tracking-widest text-text-tertiary font-semibold">Qty</label>
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
                        <div className="md:col-span-3 space-y-1">
                          <label className="text-[10px] uppercase tracking-widest text-text-tertiary font-semibold">Unit price</label>
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
                        <div className="md:col-span-2 flex justify-end items-center gap-1">
                          <span className={cn('text-[13px] font-semibold tabular-nums mr-1 hidden md:block', item.included ? 'text-text-primary' : 'text-text-tertiary line-through')}>
                            {formatCurrency(Math.round((parseFloat(item.qtyInput || '0') || 0) * (parseFloat(item.unitPriceInput || '0') || 0)))}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeLineItem(item.id)}
                            className="p-1.5 rounded-md text-text-tertiary hover:text-danger hover:bg-danger/10 transition-colors"
                            disabled={lineItems.length === 1}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setLineItems((prev) => [...prev, { id: crypto.randomUUID(), name: '', qtyInput: '1', unitPriceInput: '0', included: true }])
                    }
                    className="glass-button !py-2 !px-4 inline-flex items-center gap-2 text-sm"
                  >
                    <Plus size={14} />
                    Custom line item
                  </button>
                </div>
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

              {/* ── Deposit & Payment Settings ── */}
              <section className="rounded-xl border border-outline bg-surface p-5 space-y-3">
                <h3 className="text-sm font-semibold text-text-primary">Deposit & Payment Settings</h3>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={jobDepositRequired} onChange={e => setJobDepositRequired(e.target.checked)} className="h-4 w-4 rounded" />
                  <span className="text-[13px] text-text-primary">Require deposit for this job</span>
                </label>
                {jobDepositRequired && (
                  <div className="ml-7 space-y-3 border-l-2 border-outline pl-4">
                    <div className="flex items-center gap-3">
                      <select value={jobDepositType} onChange={e => setJobDepositType(e.target.value as any)}
                        className="text-xs border border-outline rounded-lg px-3 py-2 bg-surface text-text-primary">
                        <option value="percentage">Percentage (%)</option>
                        <option value="fixed">Fixed Amount ($)</option>
                      </select>
                      <input value={jobDepositValue} onChange={e => setJobDepositValue(e.target.value.replace(/[^\d.]/g, ''))}
                        className="w-24 text-right text-sm border border-outline rounded-lg px-3 py-2 bg-surface text-text-primary"
                        placeholder={jobDepositType === 'percentage' ? '25' : '100'} />
                      {jobDepositType === 'percentage' && (
                        <span className="text-xs text-text-tertiary">
                          = {formatCurrency(grandTotalCents / 100 * (parseFloat(jobDepositValue) || 0) / 100)}
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-text-tertiary">
                      {jobDepositType === 'percentage'
                        ? `Client must pay ${jobDepositValue || 0}% deposit`
                        : `Client must pay $${jobDepositValue || 0} deposit`}
                    </p>
                  </div>
                )}
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={jobRequirePaymentMethod} onChange={e => setJobRequirePaymentMethod(e.target.checked)} className="h-4 w-4 rounded" />
                  <span className="text-[13px] text-text-primary">Require payment method on file</span>
                </label>
              </section>

              {(inlineError || errorMessage) && (
                <div className="rounded-xl border border-danger bg-danger-light text-danger px-4 py-3 text-sm">
                  {inlineError || errorMessage}
                </div>
              )}
            </form>

            <div className="px-6 py-4 border-t border-white/15 bg-surface/70 backdrop-blur sticky bottom-0 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-xs uppercase tracking-widest text-black font-semibold">Total value</p>
                  <p className="text-4xl font-semibold tracking-tight">{formatCurrency(grandTotalCents / 100)}</p>
                </div>
                {isEditMode && initialValues?.id && onDelete && (
                  confirmDelete ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-danger font-medium">Delete this job?</span>
                      <button
                        type="button"
                        onClick={() => void onDelete(initialValues.id as string)}
                        disabled={isDeleting}
                        className="rounded-lg bg-danger px-3 py-1.5 text-xs font-semibold text-white hover:bg-danger/80 transition-colors disabled:opacity-50"
                      >
                        {isDeleting ? 'Deleting...' : 'Confirm'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        disabled={isDeleting}
                        className="glass-button text-xs"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="rounded-lg border border-danger/30 p-2 text-danger hover:bg-danger/10 transition-colors"
                      title="Delete job"
                    >
                      <Trash2 size={15} />
                    </button>
                  )
                )}
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

    {/* Service catalog picker */}
    <AnimatePresence>
      {servicePickerOpen && (
        <ServicePicker
          isOpen={servicePickerOpen}
          onClose={() => setServicePickerOpen(false)}
          onSelect={handleServiceSelected}
          onRemove={handleServiceRemoved}
          addedIds={addedServiceIds}
        />
      )}
    </AnimatePresence>
    </>
  );
}
