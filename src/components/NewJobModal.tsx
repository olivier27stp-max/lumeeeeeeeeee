import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, BriefcaseBusiness, Calendar, ChevronDown, Clock3, MapPin, Package, Plus, Trash2, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn, formatCurrency } from '../lib/utils';
import { listClients, createClient } from '../lib/clientsApi';
import { getSuggestedJobNumber, listSalespeople } from '../lib/jobsApi';
import { resolveClientIdForLead } from '../lib/leadsApi';
import { listTeams } from '../lib/teamsApi';
import TeamSuggestions from './TeamSuggestions';
import type { TeamSuggestion } from '../lib/teamSuggestionsApi';
import { Job } from '../types';
import ServicePicker from './ServicePicker';
import type { PredefinedService } from '../lib/servicesApi';
import { supabase } from '../lib/supabase';
import AddressAutocomplete, { type StructuredAddress } from './AddressAutocomplete';
import { resolveTaxes, type TaxConfig } from '../lib/taxApi';
import { useTranslation } from '../i18n';
import SpecificNotes from './SpecificNotes';
import SpecificNotesInline, { type SpecificNotesInlineHandle } from './SpecificNotesInline';

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
  const { t } = useTranslation();
  const isEditMode = Boolean(initialValues?.id);
  const specificNotesRef = useRef<SpecificNotesInlineHandle>(null);
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const [isCreatingNewClient, setIsCreatingNewClient] = useState(false);
  const [newClientFirst, setNewClientFirst] = useState('');
  const [newClientLast, setNewClientLast] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [leadId, setLeadId] = useState<string | null>(null);
  const [teamSelection, setTeamSelection] = useState('');
  const [teamSuggestions, setTeamSuggestions] = useState<TeamSuggestion[]>([]);
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
  const [internalSaving, setInternalSaving] = useState(false);
  const [calendarHint, setCalendarHint] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [servicePickerOpen, setServicePickerOpen] = useState(false);
  const [addedServiceIds, setAddedServiceIds] = useState<Set<string>>(new Set());
  const [orgCurrency, setOrgCurrency] = useState('CAD');
  const [resolvedTaxConfigs, setResolvedTaxConfigs] = useState<TaxConfig[]>([]);
  const [taxConfigured, setTaxConfigured] = useState<boolean | null>(null);
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
    // Load taxes from Settings (dynamic)
    const initialTaxes = initialValues?.tax_lines || [];
    if (isEditMode && initialTaxes.length > 0) {
      // Edit mode: use existing job's tax lines
      const initialTps = initialTaxes.find((tax) => String(tax.code || '').toLowerCase() === 'tps') || initialTaxes[0];
      const initialTvq = initialTaxes.find((tax) => String(tax.code || '').toLowerCase() === 'tvq') || initialTaxes[1];
      const initialCustom = initialTaxes.find((tax) => String(tax.code || '').toLowerCase() === 'custom');
      setTpsEnabled(initialTps ? Boolean(initialTps.enabled) : false);
      setTpsRate(initialTps?.rate ?? 0);
      setTvqEnabled(initialTvq ? Boolean(initialTvq.enabled) : false);
      setTvqRate(initialTvq?.rate ?? 0);
      setCustomTaxEnabled(initialCustom ? Boolean(initialCustom.enabled) : false);
      setCustomTaxLabel(initialCustom?.label || 'Custom tax');
      setCustomTaxRate(initialCustom?.rate ?? 0);
      setResolvedTaxConfigs(initialTaxes.map((t: any) => ({ id: t.code, org_id: '', name: t.label, rate: t.rate, type: 'percentage' as const, region: '', country: '', is_compound: false, is_active: t.enabled, sort_order: 0 })));
      setTaxConfigured(true);
    } else {
      // New job: resolve from Settings
      setTaxConfigured(null);
      resolveTaxes(initialValues?.client_id || null, initialValues?.lead_id || null).then(({ taxes }) => {
        if (taxes.length > 0) {
          setResolvedTaxConfigs(taxes);
          setTaxConfigured(true);
          const t1 = taxes[0]; const t2 = taxes[1];
          setTpsEnabled(t1 ? t1.is_active : false);
          setTpsRate(t1 ? t1.rate : 0);
          setTvqEnabled(t2 ? t2.is_active : false);
          setTvqRate(t2 ? t2.rate : 0);
          setCustomTaxEnabled(false); setCustomTaxRate(0);
        } else {
          setTaxConfigured(false);
          setTpsEnabled(false); setTpsRate(0);
          setTvqEnabled(false); setTvqRate(0);
        }
      }).catch(() => { setTaxConfigured(false); });
    }

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

    // Fetch org currency (scoped to current org)
    import('../lib/orgApi').then(({ getCurrentOrgIdOrThrow }) =>
      getCurrentOrgIdOrThrow().then(oid =>
        supabase
          .from('org_billing_settings')
          .select('currency')
          .eq('org_id', oid)
          .limit(1)
          .maybeSingle()
          .then(({ data: billing }) => {
            if (billing?.currency) setOrgCurrency(billing.currency);
          })
      )
    ).catch(() => {});
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
  const taxLines = useMemo(() => {
    if (resolvedTaxConfigs.length > 0) {
      return resolvedTaxConfigs.map((tax, idx) => ({
        code: tax.name.toLowerCase().replace(/\s+/g, '_'),
        label: tax.name,
        rate: tax.rate,
        enabled: idx === 0 ? tpsEnabled : idx === 1 ? tvqEnabled : customTaxEnabled,
      }));
    }
    // Fallback to manual inputs if no resolved configs
    return [
      { code: 'tax1', label: 'Tax 1', rate: Number.isFinite(tpsRate) ? tpsRate : 0, enabled: tpsEnabled },
      { code: 'tax2', label: 'Tax 2', rate: Number.isFinite(tvqRate) ? tvqRate : 0, enabled: tvqEnabled },
    ].filter(t => t.rate > 0);
  }, [resolvedTaxConfigs, customTaxEnabled, tpsEnabled, tpsRate, tvqEnabled, tvqRate]);

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
    setClientSearch('');
    setClientDropdownOpen(false);
    setIsCreatingNewClient(false);
    setNewClientFirst('');
    setNewClientLast('');
    setNewClientEmail('');
    setNewClientPhone('');
    setTeamSelection('');
    setTeamSuggestions([]);
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
    setStatus('Draft');
    setLineItems([{ id: crypto.randomUUID(), name: '', qtyInput: '1', unitPriceInput: '0', included: true }]);
    setTotalInput('');
    setInlineError(null);
    setCalendarHint(null);
    setCustomTaxEnabled(false);
    setCustomTaxLabel('Custom tax');
    setCustomTaxRate(0);
    // Load taxes from settings
    setTaxConfigured(null);
    resolveTaxes(null, null).then(({ taxes }) => {
      if (taxes.length > 0) {
        setResolvedTaxConfigs(taxes);
        setTaxConfigured(true);
        // Map resolved taxes to existing TPS/TVQ state for backward compat
        const t1 = taxes[0];
        const t2 = taxes[1];
        setTpsEnabled(t1 ? t1.is_active : false);
        setTpsRate(t1 ? t1.rate : 0);
        setTvqEnabled(t2 ? t2.is_active : false);
        setTvqRate(t2 ? t2.rate : 0);
      } else {
        setTaxConfigured(false);
        setTpsEnabled(false); setTpsRate(0);
        setTvqEnabled(false); setTvqRate(0);
      }
    }).catch(() => { setTaxConfigured(false); });
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

  // ── Team availability conflict detection ──
  const selectedTeamSuggestion = useMemo(() => {
    if (!teamSelection || teamSelection === UNASSIGNED_TEAM_VALUE) return null;
    return teamSuggestions.find(s => s.team_id === teamSelection) || null;
  }, [teamSelection, teamSuggestions]);

  const teamConflictWarning = useMemo((): string | null => {
    if (!selectedTeamSuggestion) return null;
    const { status, availability_windows, reasons } = selectedTeamSuggestion;

    if (status === 'unavailable') {
      return t.teamSuggestions.teamUnavailableDay;
    }
    if (status === 'busy') {
      return t.teamSuggestions.teamFullyBooked;
    }
    if (status === 'partially_available' && startTime && endTime) {
      // Check if the selected time fits in any available window
      const reqStart = parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1]);
      const reqEnd = parseInt(endTime.split(':')[0]) * 60 + parseInt(endTime.split(':')[1]);
      const fits = availability_windows.some(w => {
        const wStart = parseInt(w.start.split(':')[0]) * 60 + parseInt(w.start.split(':')[1]);
        const wEnd = parseInt(w.end.split(':')[0]) * 60 + parseInt(w.end.split(':')[1]);
        return reqStart >= wStart && reqEnd <= wEnd;
      });
      if (!fits) {
        const windows = availability_windows.map(w => `${w.start}-${w.end}`).join(', ');
        return `${t.teamSuggestions.teamConflictSlot} ${t.teamSuggestions.availableWindows}: ${windows}`;
      }
    }
    return null;
  }, [selectedTeamSuggestion, startTime, endTime, t]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setInlineError(null);

    if (!title.trim()) {
      setInlineError(t.modals.titleRequired);
      return;
    }

    let resolvedClientId = clientId;
    if (isCreatingNewClient) {
      if (!newClientFirst.trim()) { setInlineError(t.modals.newClientFirstNameRequired); return; }
      if (!newClientLast.trim()) { setInlineError(t.modals.newClientLastNameRequired); return; }
      try {
        const created = await createClient({
          first_name: newClientFirst.trim(),
          last_name: newClientLast.trim(),
          email: newClientEmail.trim() || undefined,
          phone: newClientPhone.trim() || undefined,
        });
        resolvedClientId = created.id;
      } catch (err: any) {
        setInlineError(err?.message || t.clients.failedCreate);
        return;
      }
    }
    if (!resolvedClientId) {
      setInlineError(t.modals.clientRequired);
      return;
    }

    if (!teamSelection) {
      setInlineError(t.modals.teamRequired);
      return;
    }

    // Block scheduling on unavailable/busy team
    if (selectedTeamSuggestion && teamSelection !== UNASSIGNED_TEAM_VALUE) {
      const { status } = selectedTeamSuggestion;
      if (status === 'unavailable') {
        setInlineError(t.teamSuggestions.teamUnavailableDay);
        return;
      }
      if (status === 'busy') {
        setInlineError(t.teamSuggestions.teamFullyBooked);
        return;
      }
      if (teamConflictWarning && status === 'partially_available') {
        setInlineError(teamConflictWarning);
        return;
      }
    }

    if (!addressLine1.trim()) {
      setInlineError(t.modals.addressRequired);
      return;
    }
    if (!addressCity.trim()) {
      setInlineError(t.modals.cityRequired);
      return;
    }
    if (!addressProvince.trim()) {
      setInlineError(t.modals.provinceRequired);
      return;
    }

    const teamIdPayload = teamSelection === UNASSIGNED_TEAM_VALUE ? null : teamSelection;

    const scheduledAt = startDate && startTime ? buildDateTime(startDate, startTime) : null;
    const endAt = startDate && endTime ? buildDateTime(startDate, endTime) : null;
    // Allow draft jobs without dates — only validate if partially filled
    if (endAt && !scheduledAt) {
      setInlineError(t.modals.startTimeRequired);
      return;
    }
    if (scheduledAt && endAt && new Date(endAt) <= new Date(scheduledAt)) {
      setInlineError(t.modals.endTimeAfterStart);
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

    setInternalSaving(true);
    try {
      const createdJob = await onSave({
        id: initialValues?.id,
        title: title.trim(),
        lead_id: leadId || null,
        client_id: resolvedClientId || null,
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
      // Save specific notes (photos, files, etc.) if any were added
      if (createdJob?.id && specificNotesRef.current?.hasContent()) {
        await specificNotesRef.current.saveNote('job', createdJob.id);
      }

      onCreated?.(createdJob);
      handleClose('created');
    } catch (error: any) {
      console.error('[jobs] failed to create job', error);
      setInlineError(error?.message || 'Failed to save job.');
    } finally {
      setInternalSaving(false);
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
            className="w-full max-w-6xl max-h-[92vh] glass rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden text-text-primary"
          >
            <div className="px-6 py-5 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary text-white flex items-center justify-center">
                  <BriefcaseBusiness size={18} />
                </div>
                <div>
                  <h2 className="text-[16px] font-bold tracking-tight">{isEditMode ? t.modals.editJobHeading : t.modals.newJobHeading}</h2>
                  <p className="text-[13px] text-text-tertiary">
                    {isEditMode ? t.modals.editJobSubtitle : t.modals.newJobSubtitle}
                  </p>
                </div>
              </div>
              <button onClick={() => handleClose()} className="p-2 rounded-xl border border-outline hover:bg-surface-secondary transition-colors">
                <X size={18} />
              </button>
            </div>

            <form id="new-job-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
              <section className="space-y-2">
                <label className="text-xs font-medium text-text-tertiary">{t.modals.jobTitle}</label>
                <input
                  autoFocus
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="glass-input w-full text-lg"
                  placeholder="e.g. Residential Cleaning - Smith Residence"
                  required
                />
              </section>

              <section className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                {isCreatingNewClient ? (
                  <div className="lg:col-span-4 space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-text-tertiary">{t.modals.createNewClient}</label>
                      <button
                        type="button"
                        onClick={() => { setIsCreatingNewClient(false); setNewClientFirst(''); setNewClientLast(''); setNewClientEmail(''); setNewClientPhone(''); }}
                        className="text-xs text-text-secondary hover:text-text-primary transition-colors"
                      >
                        {t.modals.cancelNewClient}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-text-tertiary">{t.modals.newClientFirstName} <span className="text-danger">*</span></label>
                        <input value={newClientFirst} onChange={(e) => setNewClientFirst(e.target.value)} className="glass-input w-full" autoFocus />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-text-tertiary">{t.modals.newClientLastName} <span className="text-danger">*</span></label>
                        <input value={newClientLast} onChange={(e) => setNewClientLast(e.target.value)} className="glass-input w-full" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-text-tertiary">{t.modals.newClientEmail}</label>
                        <input type="email" value={newClientEmail} onChange={(e) => setNewClientEmail(e.target.value)} className="glass-input w-full" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-text-tertiary">{t.modals.newClientPhone}</label>
                        <input type="tel" value={newClientPhone} onChange={(e) => setNewClientPhone(e.target.value)} className="glass-input w-full" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 relative">
                    <label className="text-xs font-medium text-text-tertiary">{t.modals.clientName}</label>
                    <input
                      type="text"
                      value={clientSearch || (clientId ? clients.find(c => c.id === clientId)?.label || '' : '')}
                      onChange={(e) => { setClientSearch(e.target.value); setClientDropdownOpen(true); if (!e.target.value) setClientId(''); }}
                      onFocus={() => setClientDropdownOpen(true)}
                      className="glass-input w-full"
                      placeholder={t.modals.searchClientPlaceholder}
                      autoComplete="off"
                    />
                    {clientDropdownOpen && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-xl border border-outline bg-surface shadow-lg">
                        <button
                          type="button"
                          onClick={() => { setClientDropdownOpen(false); setIsCreatingNewClient(true); setClientId(''); setClientSearch(''); }}
                          className="w-full text-left px-3 py-2.5 text-sm font-semibold text-primary hover:bg-primary/10 transition-colors border-b border-outline"
                        >
                          {t.modals.createNewClient}
                        </button>
                        {clients
                          .filter(c => !clientSearch || c.label.toLowerCase().includes(clientSearch.toLowerCase()))
                          .map((client) => (
                            <button
                              key={client.id}
                              type="button"
                              onClick={() => { setClientId(client.id); setClientSearch(client.label); setClientDropdownOpen(false); }}
                              className={cn(
                                'w-full text-left px-3 py-2 text-sm hover:bg-surface-secondary transition-colors',
                                client.id === clientId && 'bg-surface-tertiary font-medium'
                              )}
                            >
                              {client.label}
                            </button>
                          ))
                        }
                        {clients.filter(c => !clientSearch || c.label.toLowerCase().includes(clientSearch.toLowerCase())).length === 0 && (
                          <p className="px-3 py-2 text-sm text-text-tertiary">{t.clients.noClientsFound}</p>
                        )}
                      </div>
                    )}
                    {clientDropdownOpen && (
                      <div className="fixed inset-0 z-40" onClick={() => setClientDropdownOpen(false)} />
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-medium text-text-tertiary">{t.modals.assignTeam}</label>
                  <select
                    value={teamSelection}
                    onChange={(event) => setTeamSelection(event.target.value)}
                    className="glass-input w-full"
                    required
                  >
                    <option value="">{t.modals.selectTeam}</option>
                    <option value={UNASSIGNED_TEAM_VALUE}>{t.modals.unassignedOption}</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                  {teamsQuery.isFetching ? (
                    <p className="text-[11px] text-text-tertiary">{t.modals.loadingTeamsMsg}</p>
                  ) : null}
                  {teamsQuery.isError ? (
                    <p className="text-[11px] text-danger">{t.modals.couldNotLoadTeamsMsg}</p>
                  ) : null}
                  {/* Team availability — always visible when a date is set */}
                  <TeamSuggestions
                    date={startDate}
                    startTime={startTime}
                    endTime={endTime}
                    address={addressLine1 || selectedClient?.address || prefilledAddress || undefined}
                    onSelectTeam={(id) => setTeamSelection(id)}
                    onSuggestionsLoaded={setTeamSuggestions}
                    selectedTeamId={teamSelection === UNASSIGNED_TEAM_VALUE ? null : teamSelection || null}
                    compact
                  />
                  {/* Conflict warning */}
                  {teamConflictWarning && (
                    <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-[12px] text-amber-800">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-600" />
                      <span>{teamConflictWarning}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-text-tertiary">{t.jobs.jobNumber}</label>
                  <input
                    value={jobNumber}
                    onChange={(event) => setJobNumber(event.target.value)}
                    className="glass-input w-full"
                    placeholder="322"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-text-tertiary">{t.modals.salesperson}</label>
                  <div className="relative">
                    <select
                      value={salespersonId}
                      onChange={(event) => setSalespersonId(event.target.value)}
                      className="glass-input w-full pr-10"
                    >
                      <option value="">{t.modals.assign}</option>
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
              <section className="space-y-4 pt-6 border-t border-border">
                <div className="flex items-center gap-2">
                  <MapPin size={18} className="text-text-secondary" />
                  <h3 className="text-[16px] font-bold tracking-tight">{t.modals.jobSiteAddress}</h3>
                </div>

                <div className="space-y-3">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-text-tertiary">{t.modals.searchAddress}</label>
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
                      <label className="text-xs font-medium text-text-tertiary">
                        {t.modals.addressLine1} <span className="text-danger">*</span>
                      </label>
                      <input
                        value={addressLine1}
                        onChange={(e) => setAddressLine1(e.target.value)}
                        className="glass-input w-full"
                        placeholder={t.modals.addressLine1Placeholder}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-text-tertiary">{t.modals.addressLine2}</label>
                      <input
                        value={addressLine2}
                        onChange={(e) => setAddressLine2(e.target.value)}
                        className="glass-input w-full"
                        placeholder={t.modals.addressLine2Placeholder}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-text-tertiary">
                        {t.modals.cityLabel} <span className="text-danger">*</span>
                      </label>
                      <input
                        value={addressCity}
                        onChange={(e) => setAddressCity(e.target.value)}
                        className="glass-input w-full"
                        placeholder={t.modals.cityPlaceholder}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-text-tertiary">
                        {t.modals.provinceLabel} <span className="text-danger">*</span>
                      </label>
                      <input
                        value={addressProvince}
                        onChange={(e) => setAddressProvince(e.target.value)}
                        className="glass-input w-full"
                        placeholder={t.modals.provincePlaceholder}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-text-tertiary">{t.modals.postalCodeLabel}</label>
                      <input
                        value={addressPostalCode}
                        onChange={(e) => setAddressPostalCode(e.target.value)}
                        className="glass-input w-full"
                        placeholder={t.modals.postalCodePlaceholder}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-text-tertiary">{t.modals.countryLabel}</label>
                      <input
                        value={addressCountry}
                        onChange={(e) => setAddressCountry(e.target.value)}
                        className="glass-input w-full"
                        placeholder={t.modals.countryPlaceholder}
                      />
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-6 border-t border-border">
                <div className="space-y-4">
                  <h3 className="text-[16px] font-bold tracking-tight">{t.modals.jobType}</h3>
                  <div className="inline-flex rounded-xl bg-surface-secondary border border-border p-1">
                    <button
                      type="button"
                      onClick={() => setJobType('one_off')}
                      className={cn(
                        'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                        jobType === 'one_off' ? 'bg-surface shadow-sm text-text-primary' : 'text-text-tertiary'
                      )}
                    >
                      {t.modals.oneOff}
                    </button>
                    <button
                      type="button"
                      onClick={() => setJobType('recurring')}
                      className={cn(
                        'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                        jobType === 'recurring' ? 'bg-surface shadow-sm text-text-primary' : 'text-text-tertiary'
                      )}
                    >
                      {t.modals.recurring}
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[16px] font-bold tracking-tight">{t.modals.schedule}</h3>
                    <a
                      href="/calendar"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] font-bold text-text-muted uppercase tracking-widest hover:text-text-primary inline-flex items-center gap-1"
                    >
                      <Calendar size={12} />
                      {t.modals.viewCalendar}
                    </a>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-text-tertiary">{t.modals.startDate}</label>
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
                      <label className="text-xs font-medium text-text-tertiary">{t.modals.startTime}</label>
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
                      <label className="text-xs font-medium text-text-tertiary">{t.modals.endTime}</label>
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

              <section className="pt-6 border-t border-border space-y-4">
                <h3 className="text-[16px] font-bold tracking-tight">{t.modals.billing}</h3>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={requiresInvoicing}
                    onChange={(event) => setRequiresInvoicing(event.target.checked)}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">{t.modals.remindInvoice}</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={billingSplit}
                    onChange={(event) => setBillingSplit(event.target.checked)}
                    className="h-4 w-4"
                  />
                  <span className="text-sm">{t.modals.splitInvoices}</span>
                </label>
              </section>

              <section className="pt-6 border-t border-border space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[16px] font-bold tracking-tight">{t.modals.lineItems}</h3>
                  <button
                    type="button"
                    onClick={() => setServicePickerOpen(true)}
                    className="glass-button !py-2 !px-4 inline-flex items-center gap-2"
                  >
                    <Package size={14} />
                    {t.modals.addFromCatalog}
                  </button>
                </div>

                {/* Line items list */}
                {lineItems.length === 1 && !lineItems[0].name.trim() ? (
                  <div className="rounded-xl border border-dashed border-outline-subtle bg-surface-secondary/30 p-6 text-center">
                    <Package size={24} className="text-text-tertiary mx-auto mb-2 opacity-40" />
                    <p className="text-sm text-text-secondary">{t.modals.noLineItemsYet}</p>
                    <p className="text-xs text-text-tertiary mt-1">{t.modals.addFromCatalogHint}</p>
                    <button
                      type="button"
                      onClick={() => setServicePickerOpen(true)}
                      className="mt-3 text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <Plus size={11} /> {t.modals.browseServices}
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
                          <label className="text-xs font-medium text-text-tertiary">{t.modals.nameCol}</label>
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
                              placeholder={t.modals.serviceNamePlaceholder}
                            />
                          </div>
                        </div>
                        <div className="md:col-span-2 space-y-1">
                          <label className="text-xs font-medium text-text-tertiary">{t.modals.qtyCol}</label>
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
                          <label className="text-xs font-medium text-text-tertiary">{t.modals.unitPriceCol}</label>
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
                    {t.modals.customLineItem}
                  </button>
                </div>
              </section>

              <section className="pt-6 border-t border-border space-y-4">
                <h3 className="text-[16px] font-bold tracking-tight">{t.modals.taxes}</h3>
                {taxConfigured === null ? (
                  <p className="text-[12px] text-text-tertiary">Loading taxes...</p>
                ) : taxConfigured === false ? (
                  <div className="rounded-lg border border-danger/30 bg-danger-light p-4">
                    <p className="text-[13px] font-semibold text-danger">No taxes configured</p>
                    <p className="text-[12px] text-text-secondary mt-1">You need to configure your tax region in Settings before creating jobs.</p>
                    <a href="/settings/taxes" className="inline-block mt-2 text-[12px] font-medium text-primary hover:underline">Go to Tax Settings</a>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {resolvedTaxConfigs.map((tax, idx) => (
                      <div key={tax.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface-secondary">
                        <div className="flex items-center gap-2">
                          <input type="checkbox"
                            checked={idx === 0 ? tpsEnabled : idx === 1 ? tvqEnabled : customTaxEnabled}
                            onChange={(e) => {
                              if (idx === 0) setTpsEnabled(e.target.checked);
                              else if (idx === 1) setTvqEnabled(e.target.checked);
                              else setCustomTaxEnabled(e.target.checked);
                            }}
                            className="h-4 w-4" />
                          <span className="text-[13px] font-medium text-text-primary">{tax.name}</span>
                        </div>
                        <span className="text-[13px] text-text-secondary tabular-nums">{tax.rate}%</span>
                      </div>
                    ))}
                    <p className="text-[10px] text-text-tertiary">Taxes from your <a href="/settings/taxes" className="text-primary hover:underline">Tax Settings</a></p>
                  </div>
                )}
                <div className="rounded-xl border border-border bg-surface/70 p-4 text-sm">
                  <label className="mb-2 block space-y-1">
                    <span className="text-xs font-medium text-text-tertiary">{t.modals.totalBeforeTaxes}</span>
                    <input
                      value={totalInput}
                      onChange={(event) => setTotalInput(sanitizeMoneyInput(event.target.value))}
                      onBlur={(event) => setTotalInput(normalizeMoneyInput(event.target.value))}
                      inputMode="decimal"
                      className="glass-input w-full"
                      placeholder={lineItemsSubtotalValue.toFixed(2)}
                    />
                  </label>
                  <p className="flex items-center justify-between"><span>{t.modals.subtotalLabel}</span><span>{formatCurrency(effectiveSubtotalValue)}</span></p>
                  <p className="mt-1 flex items-center justify-between"><span>{t.modals.taxesLabel}</span><span>{formatCurrency(taxTotalCents / 100)}</span></p>
                  <p className="mt-2 border-t border-border pt-2 flex items-center justify-between font-semibold text-base">
                    <span>{t.modals.totalLabel}</span><span>{formatCurrency(grandTotalCents / 100)}</span>
                  </p>
                </div>
              </section>

              {/* ── Deposit & Payment Settings ── */}
              <section className="rounded-xl border border-outline bg-surface p-5 space-y-3">
                <h3 className="text-sm font-semibold text-text-primary">{t.modals.depositSettings}</h3>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={jobDepositRequired} onChange={e => setJobDepositRequired(e.target.checked)} className="h-4 w-4 rounded" />
                  <span className="text-[13px] text-text-primary">{t.modals.requireDeposit}</span>
                </label>
                {jobDepositRequired && (
                  <div className="ml-7 space-y-3 border-l-2 border-outline pl-4">
                    <div className="flex items-center gap-3">
                      <select value={jobDepositType} onChange={e => setJobDepositType(e.target.value as any)}
                        className="text-xs border border-outline rounded-lg px-3 py-2 bg-surface text-text-primary">
                        <option value="percentage">{t.modals.percentageOption}</option>
                        <option value="fixed">{t.modals.fixedAmountOption}</option>
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

              {/* ── Specific Notes ── */}
              {isEditMode && initialValues?.id ? (
                <SpecificNotes entityType="job" entityId={initialValues.id} mode="full" />
              ) : (
                <SpecificNotesInline ref={specificNotesRef} tempEntityType="job" />
              )}

              {(inlineError || errorMessage) && (
                <div className="rounded-xl border border-danger bg-danger-light text-danger px-4 py-3 text-sm">
                  {inlineError || errorMessage}
                </div>
              )}
            </form>

            <div className="px-6 pt-4 pb-6 border-t border-border-light bg-surface/70 backdrop-blur sticky bottom-0 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-xs font-medium text-text-tertiary">{t.modals.totalValue}</p>
                  <p className="text-lg font-bold tracking-tight">{formatCurrency(grandTotalCents / 100)}</p>
                </div>
                {isEditMode && initialValues?.id && onDelete && (
                  confirmDelete ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-danger font-medium">{t.modals.deleteJobQuestion}</span>
                      <button
                        type="button"
                        onClick={() => void onDelete(initialValues.id as string)}
                        disabled={isDeleting}
                        className="glass-button-danger px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                      >
                        {isDeleting ? t.modals.deletingBtn : t.modals.confirmBtn}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        disabled={isDeleting}
                        className="glass-button text-xs"
                      >
                        {t.modals.noBtn}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="glass-button-danger p-2"
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
                    {isFinishingJob ? t.modals.finishingBtn : t.modals.finishJobBtn}
                  </button>
                ) : null}
                <button onClick={() => handleClose()} className="glass-button">
                  {t.modals.cancelBtn}
                </button>
                <button form="new-job-form" type="submit" disabled={isSaving || internalSaving} className="glass-button-primary inline-flex items-center gap-2">
                  {(isSaving || internalSaving) ? t.modals.savingBtn : isEditMode ? t.modals.saveChangesBtn : t.modals.saveJobBtn}
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
