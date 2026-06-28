import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, BriefcaseBusiness, Calendar, ChevronDown, Clock3, MapPin, Package, Plus, Trash2, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn, formatCurrency } from '../lib/utils';
import { listClients, createClient } from '../lib/clientsApi';
import { listSalespeople, applyJobExtras } from '../lib/jobsApi';
import { resolveClientIdForLead } from '../lib/leadsApi';
import { listTeams } from '../lib/teamsApi';
import TeamSuggestions from './TeamSuggestions';
import type { TeamSuggestion } from '../lib/teamSuggestionsApi';
import { Job } from '../types';
import ServicePicker from './ServicePicker';
import FormPageHost from './ui/FormPageHost';
import type { PredefinedService } from '../lib/servicesApi';
import { supabase } from '../lib/supabase';
import AddressAutocomplete, { type StructuredAddress } from './AddressAutocomplete';
import { listPropertiesByClient, createProperty, type PropertyRecord } from '../lib/propertiesApi';
import { resolveTaxes, type TaxConfig } from '../lib/taxApi';
import { useTranslation } from '../i18n';
import SpecificNotes from './SpecificNotes';
import SpecificNotesInline, { type SpecificNotesInlineHandle } from './SpecificNotesInline';
import { toast } from 'sonner';

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
  property_id?: string | null;
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
    property_id?: string | null;
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

/** A titled card "box". Each form section lives in one of these. */
function Box({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold tracking-tight text-text-primary">{title}</h3>
          {subtitle && <p className="text-[12px] text-text-tertiary mt-0.5">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

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
  const { t, language } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const isEditMode = Boolean(initialValues?.id);
  const specificNotesRef = useRef<SpecificNotesInlineHandle>(null);
  // Navigation guard: route where the form was opened + leave-confirmation state.
  const openedPathRef = useRef<string | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  // Dirty tracking — baseline signature captured right after the form resets.
  const baselineSignatureRef = useRef<string>('');
  const captureBaselineRef = useRef(false);
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  // Properties (a job must be assigned to one of the client's properties).
  // An empty propertyId means "new property" — it is created on submit from
  // the address fields below.
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [newPropertyName, setNewPropertyName] = useState('');
  const [isCreatingNewClient, setIsCreatingNewClient] = useState(false);
  const [newClientFirst, setNewClientFirst] = useState('');
  const [newClientLast, setNewClientLast] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientCompany, setNewClientCompany] = useState('');
  const [leadId, setLeadId] = useState<string | null>(null);
  const [teamSelection, setTeamSelection] = useState('');
  const [teamSuggestions, setTeamSuggestions] = useState<TeamSuggestion[]>([]);
  const [clients, setClients] = useState<Array<{ id: string; label: string; address: string | null; phone: string | null; street_number: string | null; street_name: string | null; city: string | null; province: string | null; postal_code: string | null; country: string | null; latitude: number | null; longitude: number | null }>>([]);
  const [jobNumber, setJobNumber] = useState('');
  const [salespersonId, setSalespersonId] = useState('');
  const [salespeople, setSalespeople] = useState<Array<{ id: string; label: string }>>([]);
  const [jobType, setJobType] = useState<'one_off' | 'recurring'>('one_off');
  // Assignment: choose between assigning an individual user or a team (tabs)
  const [assignMode, setAssignMode] = useState<'user' | 'team'>('team');
  const [assignedUserId, setAssignedUserId] = useState('');
  // Job tags + "ask for a review" setup
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [askForReview, setAskForReview] = useState(false);
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
  // Per-line catalog picker: id of the line whose product/service is being chosen
  const [lineEditId, setLineEditId] = useState<string | null>(null);
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
    setShowLeaveConfirm(false);
    setTitle(initialValues?.title || '');
    setLeadId(initialValues?.lead_id || null);
    setClientId(initialValues?.client_id || '');
    setPropertyId(initialValues?.property_id || '');
    if (isEditMode) {
      setTeamSelection(initialValues?.team_id || UNASSIGNED_TEAM_VALUE);
    } else {
      setTeamSelection(initialValues?.team_id || '');
    }
    setJobNumber(initialValues?.job_number || '');
    if (initialValues?.salesperson_id) {
      setSalespersonId(initialValues.salesperson_id);
    } else if (isEditMode) {
      // Édition : garder le vendeur tel quel (possiblement vide).
      setSalespersonId('');
    } else {
      // Nouveau job : assigner par défaut le vendeur à l'utilisateur courant.
      // Reste modifiable via le menu déroulant ci-dessous.
      setSalespersonId('');
      supabase.auth
        .getUser()
        .then(({ data }) => {
          if (data.user?.id) setSalespersonId(data.user.id);
        })
        .catch(() => {});
    }
    setJobType(initialValues?.job_type || 'one_off');
    // Assignment / tags / review (best-effort fields — may be absent on the draft)
    const iv = initialValues as any;
    const initialAssignedUser = iv?.assigned_user_id || '';
    setAssignedUserId(initialAssignedUser);
    setAssignMode(initialAssignedUser && !(initialValues?.team_id) ? 'user' : 'team');
    setTags(Array.isArray(iv?.tags) ? iv.tags : []);
    setTagInput('');
    setAskForReview(Boolean(iv?.ask_for_review));
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
          phone: client.phone ?? null,
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

    // Le numéro de job est désormais attribué par la DB (trigger par org,
    // atomique) à la création. Plus de suggestion côté client : on évite ainsi
    // la race condition qui pouvait générer des numéros en double.

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
    // Snapshot the freshly-reset values on the next render so we can detect
    // whether the user has since entered anything (see the effect below).
    captureBaselineRef.current = true;
  }, [isOpen, initialValues, isEditMode, source?.type]);

  // Signature of every user-editable field. System-autofilled fields
  // (salesperson, resolved taxes, auto job number) are intentionally excluded so
  // that simply opening a blank form is never treated as "dirty".
  const formSignature = useMemo(
    () =>
      JSON.stringify({
        title,
        description,
        status,
        clientId,
        propertyId,
        newPropertyName,
        isCreatingNewClient,
        newClientFirst,
        newClientLast,
        newClientEmail,
        newClientPhone,
        newClientCompany,
        leadId,
        teamSelection,
        assignMode,
        assignedUserId,
        jobType,
        tags,
        tagInput,
        askForReview,
        startDate,
        startTime,
        endTime,
        requiresInvoicing,
        billingSplit,
        prefilledAddress,
        addressLine1,
        addressLine2,
        addressCity,
        addressProvince,
        addressPostalCode,
        addressCountry,
        addressSearch,
        totalInput,
        jobDepositRequired,
        jobDepositType,
        jobDepositValue,
        jobRequirePaymentMethod,
        lineItems: lineItems.map((item) => ({
          name: item.name,
          qtyInput: item.qtyInput,
          unitPriceInput: item.unitPriceInput,
          included: item.included,
        })),
      }),
    [
      title, description, status, clientId, propertyId, newPropertyName, isCreatingNewClient,
      newClientFirst, newClientLast, newClientEmail, newClientPhone, newClientCompany, leadId,
      teamSelection, assignMode, assignedUserId, jobType, tags, tagInput, askForReview,
      startDate, startTime, endTime, requiresInvoicing, billingSplit, prefilledAddress,
      addressLine1, addressLine2, addressCity, addressProvince, addressPostalCode, addressCountry,
      addressSearch, totalInput, jobDepositRequired, jobDepositType, jobDepositValue,
      jobRequirePaymentMethod, lineItems,
    ]
  );

  // Capture the baseline once per open, on the render right after the reset effect runs.
  useEffect(() => {
    if (captureBaselineRef.current) {
      baselineSignatureRef.current = formSignature;
      captureBaselineRef.current = false;
    }
  }, [formSignature]);

  const isDirty = isOpen && formSignature !== baselineSignatureRef.current;

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === clientId) || null,
    [clients, clientId]
  );

  // Load the selected client's properties. A job must be assigned to one of
  // them; the address is then derived from the chosen property (see effect below).
  useEffect(() => {
    let active = true;
    if (!clientId) {
      setProperties([]);
      setPropertyId('');
      return;
    }
    setPropertiesLoading(true);
    listPropertiesByClient(clientId)
      .then((list) => {
        if (!active) return;
        setProperties(list);
        setPropertyId((prev) => {
          if (prev && list.some((p) => p.id === prev)) return prev;
          const fallback = list.find((p) => p.is_primary) || (list.length === 1 ? list[0] : null);
          return fallback?.id || '';
        });
      })
      .catch(() => { if (active) setProperties([]); })
      .finally(() => { if (active) setPropertiesLoading(false); });
    return () => { active = false; };
  }, [clientId]);

  // Derive the job-site address fields from the selected property so the
  // composed `property_address`, geocoding and team suggestions keep working.
  useEffect(() => {
    const p = properties.find((x) => x.id === propertyId);
    if (!p) return;
    setAddressLine1(p.address || [p.street_number, p.street_name].filter(Boolean).join(' ') || '');
    setAddressCity(p.city || '');
    setAddressProvince(p.province || '');
    setAddressPostalCode(p.postal_code || '');
    setAddressCountry(p.country || 'Canada');
    setAddressPlaceId(p.place_id || null);
    setAddressSearch(p.address || '');
  }, [propertyId, properties]);

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
    setProperties([]);
    setPropertyId('');
    setNewPropertyName('');
    setClientSearch('');
    setClientDropdownOpen(false);
    setIsCreatingNewClient(false);
    setNewClientFirst('');
    setNewClientLast('');
    setNewClientEmail('');
    setNewClientPhone('');
    setNewClientCompany('');
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
    setShowLeaveConfirm(false);
    resetForm();
    onClose();
    if (reason === 'cancel') onCancel?.();
  };

  // Remember the route the form was opened on (capture only on open, not on
  // every navigation — hence the intentionally narrow dependency list).
  useEffect(() => {
    if (isOpen) openedPathRef.current = location.pathname;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Auto-close on navigation. If the form is untouched, dismiss it silently.
  // If the user entered something, keep the new page behind a leave-confirmation.
  useEffect(() => {
    if (!isOpen) return;
    if (!openedPathRef.current) return;
    if (location.pathname === openedPathRef.current) return;
    if (isDirty) {
      setShowLeaveConfirm(true);
    } else {
      handleClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, isOpen]);

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

  // Fill a single line with the chosen catalog product/service (name, default price)
  const handleServiceForLine = (service: PredefinedService) => {
    if (!lineEditId) return;
    setLineItems((prev) => prev.map((item) => item.id === lineEditId ? {
      ...item,
      source_service_id: service.id,
      name: service.name,
      unitPriceInput: String(service.default_price_cents / 100),
    } : item));
    setAddedServiceIds((prev) => new Set([...prev, service.id]));
    setLineEditId(null);
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

  const addTag = (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    setTags((prev) => (prev.some((tag) => tag.toLowerCase() === value.toLowerCase()) ? prev : [...prev, value]));
    setTagInput('');
  };
  const removeTag = (value: string) => setTags((prev) => prev.filter((tag) => tag !== value));

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
      if (!addressLine1.trim()) {
        const msg = language === 'fr' ? 'L’adresse du client est requise.' : 'Client address is required.';
        setInlineError(msg);
        try { toast.error(msg); } catch {}
        return;
      }
      try {
        const created = await createClient({
          first_name: newClientFirst.trim(),
          last_name: newClientLast.trim(),
          email: newClientEmail.trim() || undefined,
          phone: newClientPhone.trim() || undefined,
          company: newClientCompany.trim() || undefined,
          address: [addressLine1, addressCity, addressProvince, addressPostalCode].filter(Boolean).join(', ') || undefined,
        });
        resolvedClientId = created.id;
      } catch (err: any) {
        setInlineError(err?.message || t.clients.failedCreate);
        return;
      }
    }
    // If user typed an exact client name but didn't click the dropdown entry,
    // try to resolve clientId from typed search text before failing.
    if (!resolvedClientId && clientSearch.trim()) {
      const typed = clientSearch.trim().toLowerCase();
      const match = clients.find(c => c.label.toLowerCase() === typed)
        || clients.find(c => c.label.toLowerCase().includes(typed));
      if (match) {
        resolvedClientId = match.id;
        setClientId(match.id);
      }
    }
    if (!resolvedClientId) {
      const msg = clientSearch.trim()
        ? ((t.modals as any).clientNotFoundPickOne || `No matching client. Pick one from the list or create a new client.`)
        : t.modals.clientRequired;
      setInlineError(msg);
      // Toast so it's visible without scrolling
      try { toast.error(msg); } catch {}
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

    // A job must be assigned to a property. Either an existing property is
    // selected, or we create one on the fly from the address fields below.
    if (!propertyId && !addressLine1.trim()) {
      setInlineError(t.modals.propertyRequired);
      try { toast.error(t.modals.propertyRequired); } catch {}
      return;
    }
    // City/province are optional: jobs persist the address as a single
    // `property_address` string (composed below), so we don't force the
    // structured fields. This keeps legacy jobs (address only) editable.

    // Resolve (or create) the property this job belongs to.
    let resolvedPropertyId: string | null = propertyId || null;
    if (!resolvedPropertyId && resolvedClientId) {
      try {
        const createdProp = await createProperty({
          client_id: resolvedClientId,
          name: newPropertyName.trim() || addressLine1.trim() || title.trim() || 'Adresse',
          address: [addressLine1, addressCity, addressProvince, addressPostalCode].filter(Boolean).join(', ') || null,
          street_number: null,
          street_name: addressLine1.trim() || null,
          city: addressCity || null,
          province: addressProvince || null,
          postal_code: addressPostalCode || null,
          country: addressCountry || null,
          place_id: addressPlaceId || null,
        });
        resolvedPropertyId = createdProp.id;
      } catch (err: any) {
        setInlineError(err?.message || (t.clientDetails as any).savePropertyFailed);
        return;
      }
    }

    // Assignment is exclusive: a job is assigned to a team OR an individual user.
    const teamIdPayload = assignMode === 'user'
      ? null
      : (teamSelection === UNASSIGNED_TEAM_VALUE ? null : teamSelection);
    const assignedUserPayload = assignMode === 'user' ? (assignedUserId || null) : null;

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

    // If user picked a non-draft status but didn't pick a date, confirm the
    // silent demotion to Draft (otherwise job wouldn't appear on calendar).
    if (!scheduledAt && String(status).toLowerCase() !== 'draft') {
      const msg = t.modals.statusWillDemoteToDraft
        || 'No start date set — this job will be saved as Draft and will not appear on the calendar. Continue?';
      if (typeof window !== 'undefined' && !window.confirm(msg)) return;
    }

    // Si un numéro de job est saisi manuellement, vérifier qu'il n'est pas déjà
    // pris dans l'org (la RLS limite la requête aux jobs de l'org courante).
    const trimmedJobNumber = jobNumber.trim();
    if (trimmedJobNumber) {
      try {
        let dupQuery = supabase
          .from('jobs')
          .select('id')
          .eq('job_number', trimmedJobNumber)
          .is('deleted_at', null)
          .limit(1);
        if (initialValues?.id) dupQuery = dupQuery.neq('id', initialValues.id);
        const { data: dup } = await dupQuery.maybeSingle();
        if (dup?.id) {
          const msg = language === 'fr'
            ? `Le numéro de job « ${trimmedJobNumber} » est déjà utilisé.`
            : `Job number "${trimmedJobNumber}" is already in use.`;
          setInlineError(msg);
          try { toast.error(msg); } catch {}
          return;
        }
      } catch (err) {
        // Échec de la vérification : on laisse la contrainte DB trancher au save.
        console.error('[jobs] job number uniqueness check failed', err);
      }
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
        property_id: resolvedPropertyId,
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
      // Persist tags / ask-for-review / individual assignee (best-effort —
      // no-ops gracefully if the migration hasn't been applied yet).
      if (createdJob?.id) {
        await applyJobExtras(createdJob.id, {
          tags,
          askForReview,
          assignedUserId: assignedUserPayload,
        });
      }

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
        <FormPageHost>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[120] bg-surface flex flex-col overflow-hidden text-text-primary"
          >
            <div className="px-6 py-5 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary text-white flex items-center justify-center">
                  <BriefcaseBusiness size={18} />
                </div>
                <div>
                  <h2 className="text-[16px] font-bold tracking-tight">{isEditMode ? t.modals.editJobHeading : t.modals.newJobHeading}</h2>
                </div>
              </div>
              <button onClick={() => handleClose()} className="p-2 rounded-xl border border-outline hover:bg-surface-secondary transition-colors">
                <X size={18} />
              </button>
            </div>

            <form id="new-job-form" onSubmit={handleSubmit} className="item-form flex-1 overflow-y-auto px-6 py-6 space-y-5">
              <Box title={language === 'fr' ? 'Détails' : 'Details'}>
                <div className="relative">
                  <input
                    autoFocus
                    id="job-title-input"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="glass-input job-title-input w-full text-lg text-center"
                    placeholder=" "
                    required
                  />
                  <label htmlFor="job-title-input" className="job-title-float">
                    {t.modals.jobTitle}
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-text-tertiary">{t.jobs.jobNumber}</label>
                    <input
                      value={jobNumber}
                      onChange={(event) => setJobNumber(event.target.value)}
                      className="glass-input w-full"
                      placeholder={language === 'fr' ? 'Numéro de job' : 'Job number'}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-text-tertiary">{t.modals.salesperson}</label>
                    <select
                      value={salespersonId}
                      onChange={(event) => setSalespersonId(event.target.value)}
                      className="glass-input w-full"
                    >
                      <option value="">{t.modals.assign}</option>
                      {salespeople.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-text-tertiary">{language === 'fr' ? 'Étiquettes' : 'Tags'}</label>
                  <div className="flex flex-wrap items-center gap-2">
                    {tags.map((tag) => (
                      <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-[12px] font-medium px-2.5 py-1">
                        {tag}
                        <button type="button" onClick={() => removeTag(tag)} className="hover:text-danger"><X size={12} /></button>
                      </span>
                    ))}
                    <input
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput); } }}
                      onBlur={() => addTag(tagInput)}
                      className="glass-input flex-1 min-w-[160px]"
                      placeholder={language === 'fr' ? 'Ajouter une étiquette…' : 'Add a tag…'}
                    />
                  </div>
                </div>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={askForReview} onChange={(e) => setAskForReview(e.target.checked)} className="h-4 w-4 mt-0.5 rounded" />
                  <span>
                    <span className="block text-[13px] font-medium text-text-primary">{language === 'fr' ? 'Demander un avis' : 'Ask for a review'}</span>
                    <span className="text-[12px] text-text-tertiary">{language === 'fr' ? "Envoyer une demande d'avis au client une fois le job terminé." : 'Send the client a review request once the job is complete.'}</span>
                  </span>
                </label>
              </Box>

              <Box title="Client">
                {isCreatingNewClient ? (
                  <div className="lg:col-span-4 space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-text-tertiary">{t.modals.createNewClient}</label>
                      <button
                        type="button"
                        onClick={() => { setIsCreatingNewClient(false); setNewClientFirst(''); setNewClientLast(''); setNewClientEmail(''); setNewClientPhone(''); setNewClientCompany(''); setAddressLine1(''); setAddressLine2(''); setAddressCity(''); setAddressProvince(''); setAddressPostalCode(''); setAddressPlaceId(null); setAddressSearch(''); }}
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
                        <label className="text-xs font-medium text-text-tertiary">{t.modals.newClientPhone}</label>
                        <input type="tel" value={newClientPhone} onChange={(e) => setNewClientPhone(e.target.value)} className="glass-input w-full" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-text-tertiary">{t.modals.newClientEmail}</label>
                        <input type="email" value={newClientEmail} onChange={(e) => setNewClientEmail(e.target.value)} className="glass-input w-full" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-text-tertiary">{language === 'fr' ? 'Entreprise' : 'Company'}</label>
                        <input value={newClientCompany} onChange={(e) => setNewClientCompany(e.target.value)} className="glass-input w-full" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-text-tertiary">{language === 'fr' ? 'Adresse' : 'Address'} <span className="text-danger">*</span></label>
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
                        placeholder={language === 'fr' ? 'Commencez à taper une adresse…' : 'Start typing an address...'}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                    <input
                      type="text"
                      value={clientSearch || (clientId ? clients.find(c => c.id === clientId)?.label || '' : '')}
                      onChange={(e) => { setClientSearch(e.target.value); setClientDropdownOpen(true); if (!e.target.value) setClientId(''); }}
                      onFocus={() => setClientDropdownOpen(true)}
                      className="glass-input w-full"
                      placeholder={t.modals.selectClient}
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
                                'w-full text-left px-3 py-2 hover:bg-surface-secondary transition-colors',
                                client.id === clientId && 'bg-surface-tertiary'
                              )}
                            >
                              <div className="text-sm font-bold text-text-primary">{client.label}</div>
                              {client.address && (
                                <div className="text-xs text-text-tertiary">{client.address}</div>
                              )}
                              {client.phone && (
                                <div className="text-xs text-text-tertiary">{client.phone}</div>
                              )}
                            </button>
                          ))
                        }
                        {clients.filter(c => !clientSearch || c.label.toLowerCase().includes(clientSearch.toLowerCase())).length === 0 && (
                          <p className="px-3 py-2 text-sm text-text-tertiary">{t.clients.noClientsFound}</p>
                        )}
                      </div>
                    )}
                    </div>
                    {clientDropdownOpen && (
                      <div className="fixed inset-0 z-40" onClick={() => setClientDropdownOpen(false)} />
                    )}
                  </div>
                )}
              </Box>

              <Box title={language === 'fr' ? 'Assignation' : 'Assignment'}>
                <div className="inline-flex rounded-xl bg-surface-secondary border border-border p-1">
                  <button type="button" onClick={() => setAssignMode('team')} className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-colors', assignMode === 'team' ? 'bg-surface shadow-sm text-text-primary' : 'text-text-tertiary')}>{language === 'fr' ? 'Assigner une équipe' : 'Assign team'}</button>
                  <button type="button" onClick={() => setAssignMode('user')} className={cn('px-4 py-2 rounded-lg text-sm font-medium transition-colors', assignMode === 'user' ? 'bg-surface shadow-sm text-text-primary' : 'text-text-tertiary')}>{language === 'fr' ? 'Assigner un utilisateur' : 'Assign user'}</button>
                </div>
                {assignMode === 'team' ? (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-text-tertiary">{t.modals.assignTeam}</label>
                  <select
                    value={teamSelection}
                    onChange={(event) => setTeamSelection(event.target.value)}
                    className="glass-input w-full"
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
                ) : (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-text-tertiary">{language === 'fr' ? 'Utilisateur' : 'User'}</label>
                  <select
                    value={assignedUserId}
                    onChange={(event) => setAssignedUserId(event.target.value)}
                    className="glass-input w-full"
                  >
                    <option value="">{language === 'fr' ? 'Choisir un utilisateur' : 'Select a user'}</option>
                    {salespeople.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.label}
                      </option>
                    ))}
                  </select>
                </div>
                )}
              </Box>

              {/* Property — a job must be assigned to one of the client's properties */}
              {(clientId || isCreatingNewClient) && (
                <Box title={t.modals.property} subtitle={language === 'fr' ? 'Requis' : 'Required'}>
                  {!isCreatingNewClient && properties.length > 0 ? (
                    <select
                      value={propertyId}
                      onChange={(e) => {
                        const v = e.target.value;
                        setPropertyId(v);
                        if (!v) {
                          setNewPropertyName('');
                          setAddressLine1(''); setAddressCity(''); setAddressProvince('');
                          setAddressPostalCode(''); setAddressSearch(''); setAddressPlaceId(null);
                        }
                      }}
                      className="glass-input w-full"
                      disabled={propertiesLoading}
                    >
                      {properties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}{p.address ? ` — ${p.address}` : ''}
                        </option>
                      ))}
                      <option value="">＋ {t.modals.addPropertyInline}</option>
                    </select>
                  ) : (
                    <p className="text-[11px] text-text-tertiary">{t.modals.noPropertiesForClient}</p>
                  )}
                  {!propertyId && (
                    <input
                      value={newPropertyName}
                      onChange={(e) => setNewPropertyName(e.target.value)}
                      className="glass-input w-full"
                      placeholder={t.modals.propertyNamePlaceholder}
                    />
                  )}
                </Box>
              )}

              <Box title={t.modals.jobType}>
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
              </Box>

              <Box
                title={t.modals.schedule}
                right={(
                  <a
                    href="/calendar"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] font-bold text-text-muted uppercase tracking-widest hover:text-text-primary inline-flex items-center gap-1"
                  >
                    <Calendar size={12} />
                    {t.modals.viewCalendar}
                  </a>
                )}
              >
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
              </Box>

              <Box title={t.modals.billing}>
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
              </Box>

              <Box
                title={language === 'fr' ? 'Produits / Services' : 'Products / Services'}
                right={(
                  <button
                    type="button"
                    onClick={() => setServicePickerOpen(true)}
                    className="glass-button !py-2 !px-4 inline-flex items-center gap-2"
                  >
                    <Package size={14} />
                    {t.modals.addFromCatalog}
                  </button>
                )}
              >
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
                            <button
                              type="button"
                              onClick={() => setLineEditId(item.id)}
                              className={cn('glass-input w-full text-left flex items-center justify-between gap-2',
                                !item.included && 'line-through',
                                !item.name.trim() && 'text-text-tertiary')}
                            >
                              <span className="truncate">{item.name.trim() || t.servicePicker.choosePlaceholder}</span>
                              <Package size={13} className="text-text-tertiary shrink-0" />
                            </button>
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
                    {t.modals.addLineItem}
                  </button>
                </div>
              </Box>

              <Box title={t.modals.taxes}>
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
              </Box>

              {/* ── Deposit & Payment Settings ── */}
              <Box title={t.modals.depositSettings}>
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
              </Box>

              {/* ── Notes ── */}
              <Box
                title="Notes"
                subtitle={language === 'fr' ? 'Laissez des notes internes pour vous ou un membre de l’équipe.' : 'Leave internal notes for yourself or a team member.'}
              >
                {isEditMode && initialValues?.id ? (
                  <SpecificNotes entityType="job" entityId={initialValues.id} mode="full" />
                ) : (
                  <SpecificNotesInline ref={specificNotesRef} tempEntityType="job" />
                )}
              </Box>

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

            {/* Leave-without-saving confirmation (shown when navigating away with unsaved data) */}
            {showLeaveConfirm && (
              <div className="absolute inset-0 z-[140] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-2xl">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 shrink-0 rounded-xl bg-danger/10 text-danger flex items-center justify-center">
                      <AlertTriangle size={18} />
                    </div>
                    <div>
                      <h3 className="text-[15px] font-bold tracking-tight text-text-primary">{t.modals.leaveFormTitle}</h3>
                      <p className="text-[13px] text-text-tertiary mt-1">{t.modals.leaveFormBody}</p>
                    </div>
                  </div>
                  <div className="mt-5 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowLeaveConfirm(false);
                        if (openedPathRef.current) navigate(openedPathRef.current);
                      }}
                      className="glass-button"
                    >
                      {t.modals.keepEditingBtn}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleClose()}
                      className="glass-button-danger px-4 py-2 font-semibold"
                    >
                      {t.modals.leaveAnywayBtn}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </FormPageHost>
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
      {lineEditId && (
        <ServicePicker
          isOpen
          singleSelect
          onClose={() => setLineEditId(null)}
          onSelect={handleServiceForLine}
        />
      )}
    </AnimatePresence>
    </>
  );
}
