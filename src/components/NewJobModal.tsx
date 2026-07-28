import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Calendar, ChevronDown, ChevronLeft, ChevronRight, Clock3, Eye, MapPin, Package, Plus, Trash2, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn, formatCurrency } from '../lib/utils';
import { listClients, createClient } from '../lib/clientsApi';
import { listSalespeople, applyJobExtras } from '../lib/jobsApi';
import { addVisit, listJobVisits, rescheduleEvent, unscheduleJob } from '../lib/scheduleApi';
import { createServiceContract } from '../lib/serviceContractsApi';
import { createJobAgreement, DEFAULT_AGREEMENT_TERMS } from '../lib/jobAgreementsApi';
import AgreementDraftPreviewModal, { type AgreementDraftPreviewData } from './agreements/AgreementDraftPreviewModal';
import FileUpload from './FileUpload';
import TeamDayRoster from './TeamDayRoster';
import { STORAGE_BUCKETS } from '../lib/storage';
import { resolveClientIdForLead } from '../lib/leadsApi';
import { listTeams } from '../lib/teamsApi';
import TeamSuggestions from './TeamSuggestions';
import type { TeamSuggestion } from '../lib/teamSuggestionsApi';
import { Job } from '../types';
import ServicePicker from './ServicePicker';
import FormPageHost from './ui/FormPageHost';
import LeaveFormConfirm from './ui/LeaveFormConfirm';
import AgreementServicesSummary from './agreements/AgreementServicesSummary';
import type { PredefinedService } from '../lib/servicesApi';
import { supabase } from '../lib/supabase';
import AddressAutocomplete, { type StructuredAddress } from './AddressAutocomplete';
import { listPropertiesByClient, createProperty, type PropertyRecord } from '../lib/propertiesApi';
import { peekNextNumbers } from '../lib/numbersApi';
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

// One visit row in the form. Jobs have no date of their own — the calendar
// shows visits (schedule_events), and a job can hold several of them (a job
// without visits is a draft). `eventId` is set when the row mirrors an
// existing schedule_event (edit mode).
interface VisitDraft {
  key: string;
  eventId: string | null;
  date: string;      // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
}

function newVisitDraft(seed?: Partial<VisitDraft>): VisitDraft {
  return {
    key: crypto.randomUUID(),
    eventId: null,
    date: new Date().toISOString().slice(0, 10),
    startTime: '09:00',
    endTime: '10:00',
    ...seed,
  };
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
  sale_date?: string | null;
  show_on_leaderboard?: boolean;
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
  /** Pre-check the "Create agreement" box (e.g. Lead pin → "Create an agreement") */
  create_agreement?: boolean;
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
    sale_date?: string | null;
    show_on_leaderboard?: boolean;
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
  // Dirty tracking — flipped only by genuine user input (see the form's
  // onInput/onChange). Programmatic/async field population never marks the form
  // dirty, so simply opening (or prefilling) a form is never treated as edited.
  const [dirty, setDirty] = useState(false);
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
  // # pré-rempli avec le prochain numéro de l'org. `touched` distingue une
  // modification manuelle (envoyée + validée) du défaut auto (laissé au
  // serveur pour une attribution atomique sans course).
  const [jobNumberTouched, setJobNumberTouched] = useState(false);
  const [nextJobNumber, setNextJobNumber] = useState<string | null>(null);
  const [salespersonId, setSalespersonId] = useState('');
  const [salespeople, setSalespeople] = useState<Array<{ id: string; label: string }>>([]);
  // Journée du close pour le leaderboard — défaut : aujourd'hui, modifiable
  // pour entrer un close oublié sans fausser le classement du jour courant.
  const [saleDate, setSaleDate] = useState(new Date().toISOString().slice(0, 10));
  const [showOnLeaderboard, setShowOnLeaderboard] = useState(true);
  const [jobType, setJobType] = useState<'one_off' | 'recurring'>('one_off');
  // "Ask for a review" setup
  const [askForReview, setAskForReview] = useState(false);
  // startDate/startTime/endTime are DERIVED from the first visit (see the sync
  // effect below) and only feed TeamSuggestions/conflict checks + the service
  // plan's own time inputs. The source of truth for scheduling is `visitDrafts`.
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  // Visits (schedule_events) of the job — a job can hold several, or none (draft).
  const [visitDrafts, setVisitDrafts] = useState<VisitDraft[]>([newVisitDraft()]);
  const [removedVisitIds, setRemovedVisitIds] = useState<string[]>([]);
  // Edit mode: false until the job's real visits are loaded; while false the
  // submit falls back to the legacy single-date path and adding rows is blocked,
  // so we can never duplicate or drop a visit we haven't seen.
  const [visitsLoaded, setVisitsLoaded] = useState(true);
  const originalVisitsRef = useRef<Map<string, { date: string; startTime: string; endTime: string }>>(new Map());
  // Service plan (job_type = recurring, creation only): the year being planned,
  // the planned months mapped to their exact visit date (month 1-12 -> YYYY-MM-DD),
  // and whether a contract should be created alongside the job.
  const [serviceYear, setServiceYear] = useState(new Date().getFullYear());
  const [serviceMonthDates, setServiceMonthDates] = useState<Record<number, string>>({});
  const [createContract, setCreateContract] = useState(false);
  // Per-visit customization of the service plan. Both boxes are checked by
  // default ("apply to all visits"); unchecking one lets each planned month
  // carry its own time window / its own products & services.
  const [applyTimesToAllVisits, setApplyTimesToAllVisits] = useState(true);
  const [applyItemsToAllVisits, setApplyItemsToAllVisits] = useState(true);
  const [serviceVisitTimes, setServiceVisitTimes] = useState<Record<number, { startTime: string; endTime: string }>>({});
  const [serviceVisitItems, setServiceVisitItems] = useState<Record<number, LineItemForm[]>>({});
  // Month whose list the catalog picker is currently feeding (null = the
  // job-level list used when items apply to all visits).
  const [pickerMonth, setPickerMonth] = useState<number | null>(null);
  // Written agreement (job contract) — optional, created after the job insert
  const [createAgreement, setCreateAgreement] = useState(false);
  const [agreementRequireSignature, setAgreementRequireSignature] = useState(true);
  const [agreementTerms, setAgreementTerms] = useState('');
  const [agreementLogoUrl, setAgreementLogoUrl] = useState<string | null>(null);
  const [agreementPreviewOpen, setAgreementPreviewOpen] = useState(false);
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
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

  // ── Service plan (months + per-month visit date) ──
  // Only drives creation; existing service-plan jobs manage their visits from
  // the job page.
  const isServicePlan = jobType === 'recurring' && !isEditMode;
  const monthNames = useMemo(() => {
    const locale = language === 'fr' ? 'fr-CA' : 'en-CA';
    return Array.from({ length: 12 }, (_, i) =>
      new Date(2000, i, 1).toLocaleDateString(locale, { month: 'long' }));
  }, [language]);
  const selectedServiceMonths = useMemo(
    () => Object.keys(serviceMonthDates).map(Number).sort((a, b) => a - b),
    [serviceMonthDates]
  );
  const serviceVisitDates = useMemo(
    () => Object.values(serviceMonthDates).filter(Boolean).sort(),
    [serviceMonthDates]
  );
  const lastDayOfMonth = (year: number, month: number) => new Date(year, month, 0).getDate();
  // Fresh ids so a month's list never shares row identities with the job-level
  // list (or another month's) — updates would otherwise cross lists.
  const cloneLineItems = (items: LineItemForm[]): LineItemForm[] =>
    items.map((item) => ({ ...item, id: crypto.randomUUID() }));
  const seedVisitTimes = (months: number[]) => {
    setServiceVisitTimes((prev) => {
      const next = { ...prev };
      for (const m of months) {
        if (!next[m]) next[m] = { startTime: startTime || '09:00', endTime: endTime || '10:00' };
      }
      return next;
    });
  };
  const seedVisitItems = (months: number[]) => {
    setServiceVisitItems((prev) => {
      const next = { ...prev };
      for (const m of months) {
        if (!next[m] || next[m].length === 0) next[m] = cloneLineItems(lineItems);
      }
      return next;
    });
  };
  const toggleServiceMonth = (month: number) => {
    setDirty(true);
    const removing = Boolean(serviceMonthDates[month]);
    setServiceMonthDates((prev) => {
      const next = { ...prev };
      if (next[month]) delete next[month];
      else next[month] = `${serviceYear}-${String(month).padStart(2, '0')}-01`;
      return next;
    });
    if (removing) {
      // Drop the month's personalization so its services stop counting in totals.
      setServiceVisitTimes((prev) => { const next = { ...prev }; delete next[month]; return next; });
      setServiceVisitItems((prev) => { const next = { ...prev }; delete next[month]; return next; });
    } else {
      if (!applyTimesToAllVisits) seedVisitTimes([month]);
      if (!applyItemsToAllVisits) seedVisitItems([month]);
    }
  };
  const toggleApplyTimesToAllVisits = (checked: boolean) => {
    setApplyTimesToAllVisits(checked);
    if (!checked) seedVisitTimes(selectedServiceMonths);
  };
  const toggleApplyItemsToAllVisits = (checked: boolean) => {
    setApplyItemsToAllVisits(checked);
    if (!checked) seedVisitItems(selectedServiceMonths);
  };
  const setVisitTime = (month: number, patch: Partial<{ startTime: string; endTime: string }>) => {
    setServiceVisitTimes((prev) => ({
      ...prev,
      [month]: {
        startTime: prev[month]?.startTime || startTime || '09:00',
        endTime: prev[month]?.endTime || endTime || '10:00',
        ...patch,
      },
    }));
  };
  const updateVisitItem = (month: number, id: string, patch: Partial<LineItemForm>) => {
    setServiceVisitItems((prev) => ({
      ...prev,
      [month]: (prev[month] || []).map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
  };
  const removeVisitItem = (month: number, id: string) => {
    setServiceVisitItems((prev) => {
      const list = prev[month] || [];
      if (list.length <= 1) return prev;
      return { ...prev, [month]: list.filter((item) => item.id !== id) };
    });
  };
  const addVisitItemRow = (month: number) => {
    setDirty(true);
    setServiceVisitItems((prev) => ({
      ...prev,
      [month]: [...(prev[month] || []), { id: crypto.randomUUID(), name: '', qtyInput: '1', unitPriceInput: '0', included: true }],
    }));
  };
  // Effective time window of one planned visit (personalized or global).
  const visitTimeFor = (month: number) => {
    const custom = !applyTimesToAllVisits ? serviceVisitTimes[month] : null;
    return {
      start: custom?.startTime || startTime || '09:00',
      end: custom?.endTime || endTime || '10:00',
    };
  };
  const setServiceMonthDate = (month: number, date: string) => {
    if (!date) return;
    setServiceMonthDates((prev) => ({ ...prev, [month]: date }));
  };
  const changeServiceYear = (delta: number) => {
    setServiceYear((prevYear) => {
      const year = prevYear + delta;
      // Re-anchor already-picked dates in the new year (clamping the day).
      setServiceMonthDates((prev) => {
        const next: Record<number, string> = {};
        for (const [key, date] of Object.entries(prev)) {
          const month = Number(key);
          const day = Math.min(Number(date.slice(8, 10)) || 1, lastDayOfMonth(year, month));
          next[month] = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
        return next;
      });
      return year;
    });
  };
  // Keep startDate aligned with the first planned visit so team suggestions
  // and conflict checks target the right day.
  useEffect(() => {
    if (!isServicePlan) return;
    if (serviceVisitDates[0]) setStartDate(serviceVisitDates[0]);
  }, [isServicePlan, serviceVisitDates]);

  // ── Visits (one_off / edit) ──
  const sortedVisitDrafts = useMemo(
    () => [...visitDrafts].sort((a, b) =>
      `${a.date}T${a.startTime || '09:00'}`.localeCompare(`${b.date}T${b.startTime || '09:00'}`)),
    [visitDrafts]
  );
  // Feed TeamSuggestions / conflict checks with the first (earliest) visit.
  useEffect(() => {
    if (isServicePlan) return;
    const first = sortedVisitDrafts[0];
    setStartDate(first?.date || '');
    setStartTime(first?.startTime || '');
    setEndTime(first?.endTime || '');
  }, [isServicePlan, sortedVisitDrafts]);
  const updateVisitDraft = (key: string, patch: Partial<VisitDraft>) => {
    setVisitDrafts((prev) => prev.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  };
  const addVisitDraft = () => {
    setDirty(true);
    setVisitDrafts((prev) => {
      const last = prev[prev.length - 1];
      return [...prev, newVisitDraft(last ? { date: last.date, startTime: last.startTime, endTime: last.endTime } : undefined)];
    });
  };
  const removeVisitDraft = (key: string) => {
    setDirty(true);
    setVisitDrafts((prev) => {
      const row = prev.find((v) => v.key === key);
      if (row?.eventId) setRemovedVisitIds((ids) => (ids.includes(row.eventId!) ? ids : [...ids, row.eventId!]));
      return prev.filter((v) => v.key !== key);
    });
  };

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
    setCreateAgreement(!isEditMode && !!initialValues?.create_agreement);
    if (isEditMode) {
      setTeamSelection(initialValues?.team_id || UNASSIGNED_TEAM_VALUE);
    } else {
      setTeamSelection(initialValues?.team_id || '');
    }
    setJobNumber(initialValues?.job_number || '');
    setJobNumberTouched(false);
    peekNextNumbers().then((next) => {
      if (!next?.job) return;
      setNextJobNumber(next.job);
      // Nouveau job sans numéro imposé : pré-remplir avec le prochain numéro.
      if (!isEditMode && !initialValues?.job_number) {
        setJobNumber((prev) => prev || next.job!);
      }
    });
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
    // Review (best-effort field — may be absent on the draft)
    const iv = initialValues as any;
    setAskForReview(Boolean(iv?.ask_for_review));
    setSaleDate(initialValues?.sale_date || new Date().toISOString().slice(0, 10));
    setShowOnLeaderboard(initialValues?.show_on_leaderboard !== false);
    setServiceYear(new Date().getFullYear());
    setServiceMonthDates({});
    setCreateContract(false);
    setApplyTimesToAllVisits(true);
    setApplyItemsToAllVisits(true);
    setServiceVisitTimes({});
    setServiceVisitItems({});
    setPickerMonth(null);
    setRemovedVisitIds([]);
    originalVisitsRef.current = new Map();
    if (isEditMode) {
      const editStartDate = formatLocalDateInput(initialValues?.scheduled_at || null);
      const editStartTime = formatLocalTimeInput(initialValues?.scheduled_at || null);
      const editEndTime = formatLocalTimeInput(initialValues?.end_at || null);
      // Seed one row from the job's mirrored date until the real visits load.
      setVisitDrafts(editStartDate
        ? [newVisitDraft({ date: editStartDate, startTime: editStartTime || '09:00', endTime: editEndTime || '10:00' })]
        : []);
      setStatus(initialValues?.status || (editStartDate ? 'Scheduled' : 'Draft'));
      setVisitsLoaded(false);
      if (initialValues?.id) {
        listJobVisits(initialValues.id)
          .then((events) => {
            if (events.length > 0) {
              const rows = events.map((ev) => ({
                key: ev.id,
                eventId: ev.id,
                date: formatLocalDateInput(ev.start_at),
                startTime: formatLocalTimeInput(ev.start_at) || '09:00',
                endTime: formatLocalTimeInput(ev.end_at) || '10:00',
              }));
              setVisitDrafts(rows);
              originalVisitsRef.current = new Map(rows.map((r) => [r.eventId as string, {
                date: r.date, startTime: r.startTime, endTime: r.endTime,
              }]));
            }
            setVisitsLoaded(true);
          })
          .catch((err) => console.error('[jobs] failed to load job visits', err));
      }
    } else if (source?.type === 'pipeline') {
      setVisitDrafts([]);
      setStatus('Draft');
      setVisitsLoaded(true);
    } else {
      const presetStartDate = formatLocalDateInput(initialValues?.scheduled_at || null);
      const presetStartTime = formatLocalTimeInput(initialValues?.scheduled_at || null);
      const presetEndTime = formatLocalTimeInput(initialValues?.end_at || null);
      setVisitDrafts([newVisitDraft({
        date: presetStartDate || new Date().toISOString().slice(0, 10),
        startTime: presetStartTime || '09:00',
        endTime: presetEndTime || '10:00',
      })]);
      setStatus(initialValues?.status || (presetStartDate ? 'Scheduled' : 'Draft'));
      setVisitsLoaded(true);
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
    // Fresh form: nothing entered yet.
    setDirty(false);
  }, [isOpen, initialValues, isEditMode, source?.type]);

  const isDirty = isOpen && dirty;

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

  // Items that actually bill: the job-level list, or — when the service plan's
  // products/services are personalized — every planned visit's own list.
  const personalizedItems = isServicePlan && !applyItemsToAllVisits;
  const billableLineItems = useMemo<Array<LineItemForm & { visitMonth?: number }>>(() => {
    if (!personalizedItems) return lineItems;
    return selectedServiceMonths.flatMap((month) =>
      (serviceVisitItems[month] || []).map((item) => ({ ...item, visitMonth: month })));
  }, [personalizedItems, lineItems, selectedServiceMonths, serviceVisitItems]);
  // "Lavage — juillet" on billing lines/contract so each visit's services stay
  // identifiable once flattened at the job level.
  const billableItemName = (item: LineItemForm & { visitMonth?: number }) =>
    (item.name.trim() || 'Service') + (item.visitMonth ? ` — ${monthNames[item.visitMonth - 1]}` : '');

  const totalCents = useMemo(() => {
    return billableLineItems.reduce((sum, item) => {
      if (!item.included) return sum;
      const qtyParsed = Number.parseFloat(item.qtyInput || '0');
      const unitParsed = Number.parseFloat(item.unitPriceInput || '0');
      const qty = Number.isFinite(qtyParsed) ? qtyParsed : 0;
      const unit = Math.round((Number.isFinite(unitParsed) ? unitParsed : 0) * 100);
      return sum + Math.max(0, Math.round(qty * unit));
    }, 0);
  }, [billableLineItems]);

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

  // Draft contract preview — same document the client will see on /contract/:token
  const agreementPreviewData: AgreementDraftPreviewData = useMemo(() => ({
    numberLabel: `CTR-${jobNumber.trim() || nextJobNumber || '—'}`,
    clientName: isCreatingNewClient
      ? ([newClientFirst, newClientLast].filter(Boolean).join(' ').trim() || newClientCompany || null)
      : (selectedClient?.label || null),
    clientEmail: isCreatingNewClient ? (newClientEmail || null) : null,
    clientPhone: isCreatingNewClient ? (newClientPhone || null) : (selectedClient?.phone || null),
    propertyAddress:
      [addressLine1, addressLine2, addressCity, addressProvince, addressPostalCode].filter(Boolean).join(', ')
        || prefilledAddress
        || selectedClient?.address
        || null,
    // Unnamed lines with a price still count in the page totals — keep them on
    // the contract too (generic "Service" label) instead of silently dropping them.
    items: billableLineItems
      .filter((it) => it.included && (it.name.trim() || (Number.parseFloat(it.unitPriceInput || '0') || 0) > 0))
      .map((it) => {
        const qty = Number.parseFloat(it.qtyInput || '0') || 0;
        const unit = Math.round((Number.parseFloat(it.unitPriceInput || '0') || 0) * 100);
        return { name: billableItemName(it), qty, unit_price_cents: unit, total_cents: Math.max(0, Math.round(qty * unit)) };
      }),
    taxLines: taxLines.filter((tx) => tx.enabled && tx.rate > 0).map((tx) => ({ label: tx.label, rate: tx.rate })),
    subtotalCents: effectiveSubtotalCents,
    servicePlan: isServicePlan && selectedServiceMonths.length > 0
      ? { year: serviceYear, visits: selectedServiceMonths.map((month) => ({ month, date: serviceMonthDates[month] })) }
      : null,
  }), [
    jobNumber, nextJobNumber, isCreatingNewClient, newClientFirst, newClientLast, newClientCompany,
    newClientEmail, newClientPhone, selectedClient, addressLine1, addressLine2, addressCity,
    addressProvince, addressPostalCode, prefilledAddress, billableLineItems, taxLines, effectiveSubtotalCents,
    isServicePlan, selectedServiceMonths, serviceMonthDates, serviceYear, monthNames,
  ]);

  const resetForm = () => {
    setDirty(false);
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
    setSaleDate(new Date().toISOString().slice(0, 10));
    setShowOnLeaderboard(true);
    setJobType('one_off');
    setApplyTimesToAllVisits(true);
    setApplyItemsToAllVisits(true);
    setServiceVisitTimes({});
    setServiceVisitItems({});
    setPickerMonth(null);
    setVisitDrafts([newVisitDraft()]);
    setRemovedVisitIds([]);
    setVisitsLoaded(true);
    originalVisitsRef.current = new Map();
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

  // Replace the first empty line item or add a new one
  const addServiceToList = (prev: LineItemForm[], service: PredefinedService): LineItemForm[] => {
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
  };

  const handleServiceSelected = (service: PredefinedService) => {
    if (pickerMonth != null) {
      // Picker opened from one visit of a personalized service plan: only that
      // month's list is touched (its "added" checkmarks are derived, not global).
      setServiceVisitItems((prev) => ({
        ...prev,
        [pickerMonth]: addServiceToList(prev[pickerMonth] || [], service),
      }));
      return;
    }
    setLineItems((prev) => addServiceToList(prev, service));
    setAddedServiceIds((prev) => new Set([...prev, service.id]));
  };

  // Fill a single line with the chosen catalog product/service (name, default price)
  const handleServiceForLine = (service: PredefinedService) => {
    if (!lineEditId) return;
    const fill = (item: LineItemForm): LineItemForm => item.id === lineEditId ? {
      ...item,
      source_service_id: service.id,
      name: service.name,
      unitPriceInput: String(service.default_price_cents / 100),
    } : item;
    // Row ids are unique across the job-level list and every month's list, so
    // mapping them all only ever fills the targeted line.
    setLineItems((prev) => prev.map(fill));
    setServiceVisitItems((prev) => {
      const next: Record<number, LineItemForm[]> = {};
      for (const [month, list] of Object.entries(prev)) next[Number(month)] = list.map(fill);
      return next;
    });
    // The global "added" checkmarks only mirror the job-level list.
    if (lineItems.some((item) => item.id === lineEditId)) {
      setAddedServiceIds((prev) => new Set([...prev, service.id]));
    }
    setLineEditId(null);
  };

  const handleServiceRemoved = (serviceId: string) => {
    if (pickerMonth != null) {
      setServiceVisitItems((prev) => {
        const filtered = (prev[pickerMonth] || []).filter((item) => item.source_service_id !== serviceId);
        return {
          ...prev,
          [pickerMonth]: filtered.length > 0
            ? filtered
            : [{ id: crypto.randomUUID(), name: '', qtyInput: '1', unitPriceInput: '0', included: true }],
        };
      });
      return;
    }
    setLineItems((prev) => {
      const filtered = prev.filter((item) => item.source_service_id !== serviceId);
      return filtered.length > 0 ? filtered : [{ id: crypto.randomUUID(), name: '', qtyInput: '1', unitPriceInput: '0', included: true }];
    });
    setAddedServiceIds((prev) => { const n = new Set(prev); n.delete(serviceId); return n; });
  };

  // Checkmarks shown in the catalog picker for the list it is currently feeding.
  const pickerAddedIds = useMemo(() => {
    if (pickerMonth == null) return addedServiceIds;
    return new Set(
      (serviceVisitItems[pickerMonth] || [])
        .map((item) => item.source_service_id)
        .filter((id): id is string => Boolean(id))
    );
  }, [pickerMonth, addedServiceIds, serviceVisitItems]);

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

  // Agreement section: prefill default T&C on first enable + resolve the
  // company logo (Settings → Company details) used as the contract default.
  useEffect(() => {
    if (!createAgreement) return;
    setAgreementTerms((prev) => prev || DEFAULT_AGREEMENT_TERMS[language === 'fr' ? 'fr' : 'en']);
    if (companyLogoUrl === null) {
      import('../lib/orgApi').then(({ getCurrentOrgIdOrThrow }) =>
        getCurrentOrgIdOrThrow()
          .then((orgId) => supabase
            .from('company_settings')
            .select('logo_url')
            .eq('org_id', orgId)
            .limit(1)
            .maybeSingle())
          .then(({ data }) => setCompanyLogoUrl(data?.logo_url || '')))
        .then(undefined, () => setCompanyLogoUrl(''));
    }
  }, [createAgreement, language, companyLogoUrl]);

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
        // Without a typed name, the client's first property gets a real title
        // ("Adresse principale") instead of duplicating the street address;
        // extra properties keep the street as name to stay distinguishable.
        const createdProp = await createProperty({
          client_id: resolvedClientId,
          name: newPropertyName.trim()
            || (properties.length === 0 ? t.modals.defaultPropertyName : addressLine1.trim())
            || title.trim() || 'Adresse',
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

    // Les visites sont assignées à une équipe seulement (jamais à un individu).
    const teamIdPayload = teamSelection === UNASSIGNED_TEAM_VALUE ? null : teamSelection;

    // Service plan: the schedule comes from the planned months (first visit =
    // the job's own schedule); at least one month with its date is required.
    if (isServicePlan && selectedServiceMonths.length === 0) {
      setInlineError(t.modals.servicePlanNoMonths);
      try { toast.error(t.modals.servicePlanNoMonths); } catch {}
      return;
    }
    // Every planned visit needs a coherent time window (global hours, or the
    // month's own hours when they're personalized per visit).
    if (isServicePlan) {
      for (const month of selectedServiceMonths) {
        const { start, end } = visitTimeFor(month);
        const vStart = buildDateTime(serviceMonthDates[month], start);
        const vEnd = buildDateTime(serviceMonthDates[month], end);
        if (!vStart || !vEnd || new Date(vEnd) <= new Date(vStart)) {
          setInlineError(t.modals.endTimeAfterStart);
          try { toast.error(t.modals.endTimeAfterStart); } catch {}
          return;
        }
      }
    }
    // Visits: each row needs a date and a coherent time window. A job without
    // visits is allowed — it stays a draft (no calendar entry).
    if (!isServicePlan) {
      for (const v of sortedVisitDrafts) {
        if (!v.date) {
          const msg = language === 'fr' ? 'Chaque visite doit avoir une date.' : 'Every visit needs a date.';
          setInlineError(msg);
          try { toast.error(msg); } catch {}
          return;
        }
        const vStart = buildDateTime(v.date, v.startTime || '09:00');
        const vEnd = buildDateTime(v.date, v.endTime || '10:00');
        if (!vStart || !vEnd || new Date(vEnd) <= new Date(vStart)) {
          setInlineError(t.modals.endTimeAfterStart);
          return;
        }
      }
    }
    // The job's own scheduled_at/end_at mirror its FIRST visit (the server
    // recomputes them from the visit set afterwards anyway).
    const firstServiceMonth = isServicePlan ? (selectedServiceMonths[0] ?? null) : null;
    const firstVisit = !isServicePlan ? (sortedVisitDrafts[0] || null) : null;
    const scheduledAt = isServicePlan
      ? (firstServiceMonth != null
        ? buildDateTime(serviceMonthDates[firstServiceMonth], visitTimeFor(firstServiceMonth).start)
        : null)
      : (firstVisit ? buildDateTime(firstVisit.date, firstVisit.startTime || '09:00') : null);
    const endAt = isServicePlan
      ? (firstServiceMonth != null
        ? buildDateTime(serviceMonthDates[firstServiceMonth], visitTimeFor(firstServiceMonth).end)
        : null)
      : (firstVisit ? buildDateTime(firstVisit.date, firstVisit.endTime || '10:00') : null);

    // If user picked a non-draft status but didn't pick a date, confirm the
    // silent demotion to Draft (otherwise job wouldn't appear on calendar).
    if (!scheduledAt && String(status).toLowerCase() !== 'draft') {
      const msg = t.modals.statusWillDemoteToDraft
        || 'No start date set — this job will be saved as Draft and will not appear on the calendar. Continue?';
      if (typeof window !== 'undefined' && !window.confirm(msg)) return;
    }

    // Numéro de job : le défaut auto non modifié est envoyé vide, le trigger
    // serveur l'attribue atomiquement (aucune course entre deux formulaires
    // ouverts en même temps). Un numéro saisi manuellement est envoyé tel quel.
    const trimmedJobNumber = jobNumber.trim();
    const isUntouchedAutoDefault = !isEditMode && !jobNumberTouched
      && !initialValues?.job_number && !!nextJobNumber && trimmedJobNumber === nextJobNumber;
    const jobNumberToSend = isUntouchedAutoDefault ? '' : trimmedJobNumber;
    if (jobNumberToSend && jobNumberToSend !== (initialValues?.job_number || '')) {
      // On ne peut pas utiliser le # d'un job qui n'existe pas : numérique
      // obligatoire et jamais au-delà du prochain numéro disponible.
      if (!/^\d+$/.test(jobNumberToSend)) {
        const msg = language === 'fr'
          ? 'Le numéro de job doit être un nombre.'
          : 'Job number must be a number.';
        setInlineError(msg);
        try { toast.error(msg); } catch {}
        return;
      }
      if (nextJobNumber && parseInt(jobNumberToSend, 10) > parseInt(nextJobNumber, 10)) {
        const msg = language === 'fr'
          ? `Le numéro de job ${jobNumberToSend} n'existe pas — le prochain numéro disponible est ${nextJobNumber}.`
          : `Job number ${jobNumberToSend} doesn't exist yet — the next available number is ${nextJobNumber}.`;
        setInlineError(msg);
        try { toast.error(msg); } catch {}
        return;
      }
      // Vérifier qu'il n'est pas déjà pris dans l'org (la RLS limite la
      // requête aux jobs de l'org courante).
      try {
        let dupQuery = supabase
          .from('jobs')
          .select('id')
          .eq('job_number', jobNumberToSend)
          .is('deleted_at', null)
          .limit(1);
        if (initialValues?.id) dupQuery = dupQuery.neq('id', initialValues.id);
        const { data: dup } = await dupQuery.maybeSingle();
        if (dup?.id) {
          const msg = language === 'fr'
            ? `Le numéro de job « ${jobNumberToSend} » est déjà utilisé.`
            : `Job number "${jobNumberToSend}" is already in use.`;
          setInlineError(msg);
          try { toast.error(msg); } catch {}
          return;
        }
      } catch (err) {
        // Échec de la vérification : on laisse la contrainte DB trancher au save.
        console.error('[jobs] job number uniqueness check failed', err);
      }
    }

    // Keep priced-but-unnamed lines (service not in the catalog): they count in
    // the page totals, so they must reach job_line_items — and the contract —
    // too, under a generic "Service" label. When the service plan's items are
    // personalized, every visit's list flattens here with the month as suffix.
    const filteredItems = billableLineItems
      .filter((item) => item.name.trim() || (Number.parseFloat(item.unitPriceInput || '0') || 0) > 0)
      .map((item) => ({
        name: billableItemName(item),
        qty: Math.max(1, Number.parseFloat(item.qtyInput || '0') || 1),
        unit_price_cents: Math.max(0, Math.round((Number.parseFloat(item.unitPriceInput || '0') || 0) * 100)),
        included: item.included,
      }));

    // Human-readable services list stamped on each visit's calendar notes when
    // the plan's products/services are personalized per visit.
    const visitNotesFor = (month: number): string | null => {
      if (!personalizedItems) return null;
      const parts = (serviceVisitItems[month] || [])
        .filter((item) => item.included && item.name.trim())
        .map((item) => {
          const qty = Number.parseFloat(item.qtyInput || '1') || 1;
          return qty > 1 ? `${item.name.trim()} ×${qty}` : item.name.trim();
        });
      if (parts.length === 0) return null;
      return `${language === 'fr' ? 'Services : ' : 'Services: '}${parts.join(' · ')}`;
    };

    setInternalSaving(true);
    try {
      // Edit mode: sync the visit set (remove / move / add) BEFORE saving the
      // job. With >= 2 active visits, rpc_schedule_job is a no-op on the events,
      // so the job-level save can never clobber what we just synced.
      if (isEditMode && initialValues?.id && !isServicePlan && visitsLoaded) {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Montreal';
        for (const eventId of removedVisitIds) {
          await unscheduleJob({ jobId: initialValues.id, eventId });
        }
        for (const v of sortedVisitDrafts) {
          const vStart = buildDateTime(v.date, v.startTime || '09:00');
          const vEnd = buildDateTime(v.date, v.endTime || '10:00');
          if (!vStart || !vEnd) continue;
          if (v.eventId) {
            const orig = originalVisitsRef.current.get(v.eventId);
            const changed = !orig
              || orig.date !== v.date
              || orig.startTime !== (v.startTime || '09:00')
              || orig.endTime !== (v.endTime || '10:00');
            if (changed) {
              await rescheduleEvent({ eventId: v.eventId, startAt: vStart, endAt: vEnd, timezone });
            }
          } else {
            await addVisit({ jobId: initialValues.id, startAt: vStart, endAt: vEnd, teamId: teamIdPayload, timezone });
          }
        }
      }

      const createdJob = await onSave({
        id: initialValues?.id,
        title: title.trim(),
        lead_id: leadId || null,
        client_id: resolvedClientId || null,
        property_id: resolvedPropertyId,
        team_id: teamIdPayload,
        job_number: jobNumberToSend || null,
        salesperson_id: salespersonId || null,
        sale_date: saleDate || null,
        show_on_leaderboard: showOnLeaderboard,
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
      // Persist ask-for-review; assigned_user_id est toujours vidé — les jobs
      // hérités d'une assignation individuelle convergent vers équipe-seulement.
      if (createdJob?.id) {
        await applyJobExtras(createdJob.id, {
          askForReview,
          assignedUserId: null,
        });
      }

      // Multiple visits (one_off creation): the first visit is created with the
      // job itself (scheduled_at above); every additional row becomes its own
      // schedule_event on the job.
      if (createdJob?.id && !isEditMode && !isServicePlan && sortedVisitDrafts.length > 1) {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Montreal';
        for (const v of sortedVisitDrafts.slice(1)) {
          const vStart = buildDateTime(v.date, v.startTime || '09:00');
          const vEnd = buildDateTime(v.date, v.endTime || '10:00');
          if (!vStart || !vEnd) continue;
          try {
            await addVisit({ jobId: createdJob.id, startAt: vStart, endAt: vEnd, teamId: teamIdPayload, timezone });
          } catch (err) {
            console.error('[jobs] failed to add extra visit', v.date, err);
          }
        }
      }

      // Service plan: create one visit per additional planned month (the first
      // month is the job's own schedule, created above), then the optional
      // contract snapshotting the 12-month plan.
      if (createdJob?.id && isServicePlan) {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Montreal';
        // The first visit was inserted by the job save itself, so it's the only
        // event the job has right now — stamp its personalized services on it
        // before the extra visits make it ambiguous. Best-effort.
        const firstNotes = firstServiceMonth != null ? visitNotesFor(firstServiceMonth) : null;
        if (firstNotes) {
          try {
            const visits = await listJobVisits(createdJob.id);
            if (visits[0]) {
              await supabase.from('schedule_events').update({ notes: firstNotes }).eq('id', visits[0].id);
            }
          } catch (err) {
            console.error('[jobs] failed to stamp first visit services', err);
          }
        }
        for (const month of selectedServiceMonths.slice(1)) {
          const date = serviceMonthDates[month];
          const { start, end } = visitTimeFor(month);
          const visitStart = buildDateTime(date, start);
          const visitEnd = buildDateTime(date, end);
          if (!visitStart || !visitEnd) continue;
          try {
            await addVisit({
              jobId: createdJob.id,
              startAt: visitStart,
              endAt: visitEnd,
              teamId: teamIdPayload,
              timezone,
              notes: visitNotesFor(month),
            });
          } catch (err) {
            console.error('[jobs] failed to add service plan visit', date, err);
          }
        }
        if (createContract) {
          try {
            await createServiceContract({
              job_id: createdJob.id,
              client_id: resolvedClientId || null,
              title: title.trim(),
              year: serviceYear,
              visits: selectedServiceMonths.map((month) => ({
                month,
                date: serviceMonthDates[month],
                ...(applyTimesToAllVisits ? {} : { start_time: visitTimeFor(month).start, end_time: visitTimeFor(month).end }),
                ...(personalizedItems
                  ? {
                      items: (serviceVisitItems[month] || [])
                        .filter((item) => item.included && (item.name.trim() || (Number.parseFloat(item.unitPriceInput || '0') || 0) > 0))
                        .map((item) => ({
                          name: item.name.trim() || 'Service',
                          qty: Math.max(1, Number.parseFloat(item.qtyInput || '0') || 1),
                          unit_price_cents: Math.max(0, Math.round((Number.parseFloat(item.unitPriceInput || '0') || 0) * 100)),
                        })),
                    }
                  : {}),
              })),
            });
          } catch (err) {
            console.error('[jobs] failed to create service contract', err);
            try { toast.error(language === 'fr' ? 'Le contrat n’a pas pu être créé.' : 'The contract could not be created.'); } catch {}
          }
        }
      }

      // Written agreement (contract) — best-effort, like the service contract
      if (createdJob?.id && createAgreement && !isEditMode) {
        try {
          await createJobAgreement({
            job_id: createdJob.id,
            client_id: resolvedClientId || null,
            require_signature: agreementRequireSignature,
            terms: agreementTerms.trim(),
            logo_url: agreementLogoUrl || null,
          }, language === 'fr' ? 'fr' : 'en');
        } catch (err: any) {
          console.error('[jobs] failed to create job agreement', err);
          try { toast.error(err?.message || (language === 'fr' ? 'Le contrat n’a pas pu être créé.' : 'The agreement could not be created.')); } catch {}
        }
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

  // One product/service row — shared between the job-level list and each
  // visit's own list when the service plan is personalized per visit.
  const renderLineItemRow = (
    item: LineItemForm,
    handlers: { update: (patch: Partial<LineItemForm>) => void; remove: () => void; removeDisabled: boolean },
  ) => (
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
            onChange={() => handlers.update({ included: !item.included })}
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
          onChange={(event) => handlers.update({ qtyInput: sanitizeIntegerInput(event.target.value) })}
          onBlur={(event) => {
            const normalized = sanitizeIntegerInput(event.target.value);
            handlers.update({ qtyInput: normalized || '1' });
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
            handlers.update({ unitPriceInput: sanitizeDecimalInput(event.target.value) })
          }
          onBlur={(event) =>
            handlers.update({ unitPriceInput: normalizeDecimalInput(event.target.value) || '0' })
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
          onClick={handlers.remove}
          className="p-1.5 rounded-md text-text-tertiary hover:text-danger hover:bg-danger/10 transition-colors"
          disabled={handlers.removeDisabled}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );

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
            onInput={(e) => { if (e.nativeEvent.isTrusted) setDirty(true); }}
            onChange={(e) => { if (e.nativeEvent.isTrusted) setDirty(true); }}
          >
            <div className="px-6 pt-6 pb-2 flex items-start justify-between">
              <h2 className="text-[30px] font-extrabold tracking-tight text-text-primary leading-tight">
                {isEditMode ? t.modals.editJobHeading : t.modals.newJobHeading}
              </h2>
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
                      onChange={(event) => { setJobNumber(event.target.value); setJobNumberTouched(true); }}
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-text-tertiary">{language === 'fr' ? 'Date de création' : 'Date of creation'}</label>
                    <input
                      type="date"
                      value={saleDate}
                      onChange={(event) => setSaleDate(event.target.value)}
                      className="glass-input w-full"
                    />
                    <p className="text-[12px] text-text-tertiary">
                      {language === 'fr'
                        ? 'Le close compte pour le leaderboard de cette journée — pratique pour entrer une vente oubliée.'
                        : "The close counts toward that day's leaderboard — handy for logging a sale you forgot to enter."}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-text-tertiary">Leaderboard</label>
                    <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-outline px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={showOnLeaderboard}
                        onChange={(event) => setShowOnLeaderboard(event.target.checked)}
                        className="h-4 w-4 mt-0.5 rounded"
                      />
                      <span>
                        <span className="block text-[13px] font-medium text-text-primary">{language === 'fr' ? 'Afficher sur le leaderboard' : 'Show on leaderboard'}</span>
                        <span className="text-[12px] text-text-tertiary">
                          {language === 'fr'
                            ? 'Décocher pour que ce job ne compte pas dans les stats du vendeur.'
                            : "Uncheck so this job doesn't count in the salesperson's stats."}
                        </span>
                      </span>
                    </label>
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
                {/* Les visites sont assignées à une ÉQUIPE seulement — les
                    personnes viennent de l'horaire du jour (onglet Horaire). */}
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
                  {/* Membres de l'équipe choisie pour la journée de la 1re visite */}
                  {teamSelection && teamSelection !== UNASSIGNED_TEAM_VALUE && (
                    <TeamDayRoster teamId={teamSelection} date={startDate} fr={language === 'fr'} />
                  )}
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

              {isServicePlan ? (
              <Box
                title={t.modals.servicePlanSchedule}
                subtitle={t.modals.servicePlanScheduleHint}
                right={(
                  <div className="inline-flex items-center gap-1 rounded-xl bg-surface-secondary border border-border p-1">
                    <button
                      type="button"
                      onClick={() => changeServiceYear(-1)}
                      className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface transition-colors"
                      aria-label="Previous year"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span className="text-sm font-semibold tabular-nums px-1">{serviceYear}</span>
                    <button
                      type="button"
                      onClick={() => changeServiceYear(1)}
                      className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface transition-colors"
                      aria-label="Next year"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              >
                  {/* Which months of the year the service happens */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-text-tertiary">{t.modals.servicePlanMonths}</label>
                    <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                      {monthNames.map((name, idx) => {
                        const month = idx + 1;
                        const selected = Boolean(serviceMonthDates[month]);
                        return (
                          <button
                            key={month}
                            type="button"
                            onClick={() => toggleServiceMonth(month)}
                            className={cn(
                              'px-3 py-2 rounded-lg border text-sm font-medium capitalize transition-colors',
                              selected
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-outline-subtle bg-surface-secondary/30 text-text-tertiary hover:text-text-secondary'
                            )}
                          >
                            {name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Exact visit date inside each planned month (+ its own hours
                      when the time window is personalized per visit) */}
                  {selectedServiceMonths.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-text-tertiary">{t.modals.servicePlanDates}</label>
                      <div className="space-y-2">
                        {selectedServiceMonths.map((month) => {
                          const mm = String(month).padStart(2, '0');
                          const lastDay = String(lastDayOfMonth(serviceYear, month)).padStart(2, '0');
                          return (
                            <div key={month} className="rounded-lg border border-outline-subtle/40 bg-surface-secondary/20 p-3 space-y-3">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
                                <span className="text-sm font-medium capitalize text-text-primary">{monthNames[month - 1]} {serviceYear}</span>
                                <div className="relative">
                                  <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                                  <input
                                    type="date"
                                    value={serviceMonthDates[month] || ''}
                                    min={`${serviceYear}-${mm}-01`}
                                    max={`${serviceYear}-${mm}-${lastDay}`}
                                    onChange={(event) => setServiceMonthDate(month, event.target.value)}
                                    className="glass-input w-full pl-10"
                                  />
                                </div>
                              </div>
                              {!applyTimesToAllVisits && (
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <label className="text-xs font-medium text-text-tertiary">{t.modals.startTime}</label>
                                    <div className="relative">
                                      <Clock3 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                                      <input
                                        type="time"
                                        value={serviceVisitTimes[month]?.startTime || startTime || '09:00'}
                                        onChange={(event) => setVisitTime(month, { startTime: event.target.value })}
                                        className="glass-input w-full pl-10"
                                      />
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-xs font-medium text-text-tertiary">{t.modals.endTime}</label>
                                    <div className="relative">
                                      <Clock3 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                                      <input
                                        type="time"
                                        value={serviceVisitTimes[month]?.endTime || endTime || '10:00'}
                                        onChange={(event) => setVisitTime(month, { endTime: event.target.value })}
                                        className="glass-input w-full pl-10"
                                      />
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Visit time window — same for every visit, or per visit */}
                  <div className="space-y-3">
                    <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-outline-subtle/40 bg-surface-secondary/20 p-3">
                      <input
                        type="checkbox"
                        checked={applyTimesToAllVisits}
                        onChange={(event) => toggleApplyTimesToAllVisits(event.target.checked)}
                        className="h-4 w-4 mt-0.5"
                      />
                      <span>
                        <span className="block text-sm text-text-primary">{t.modals.servicePlanApplyAllLabel}</span>
                        <span className="block text-xs text-text-tertiary mt-0.5">
                          {applyTimesToAllVisits ? t.modals.servicePlanTimesApplyAllHint : t.modals.servicePlanTimesCustomHint}
                        </span>
                      </span>
                    </label>
                    {applyTimesToAllVisits && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-text-tertiary">{t.modals.startTime} — {t.modals.servicePlanVisitTimeHint}</label>
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
                    )}
                  </div>

                  {/* Optional contract */}
                  <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-outline-subtle/40 bg-surface-secondary/20 p-3">
                    <input
                      type="checkbox"
                      checked={createContract}
                      onChange={(event) => setCreateContract(event.target.checked)}
                      className="h-4 w-4 mt-0.5"
                    />
                    <span>
                      <span className="block text-sm text-text-primary">{t.modals.servicePlanCreateContract}</span>
                      <span className="block text-xs text-text-tertiary mt-0.5">{t.modals.servicePlanCreateContractHint}</span>
                    </span>
                  </label>
              </Box>
              ) : (
              <Box
                title={language === 'fr' ? 'Visites' : 'Visits'}
                subtitle={language === 'fr'
                  ? 'Le job n’a pas de date : ce sont ses visites qui apparaissent au calendrier. Sans visite, le job reste en brouillon.'
                  : 'A job has no date of its own: its visits are what show on the calendar. Without a visit, the job stays a draft.'}
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
                  {sortedVisitDrafts.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-outline-subtle bg-surface-secondary/30 p-6 text-center">
                      <Calendar size={24} className="text-text-tertiary mx-auto mb-2 opacity-40" />
                      <p className="text-sm text-text-secondary">
                        {language === 'fr' ? 'Aucune visite planifiée' : 'No visits scheduled'}
                      </p>
                      <p className="text-xs text-text-tertiary mt-1">
                        {language === 'fr'
                          ? 'Ajoutez une visite pour placer ce job au calendrier.'
                          : 'Add a visit to place this job on the calendar.'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {sortedVisitDrafts.map((visit, idx) => (
                        <div
                          key={visit.key}
                          className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end rounded-lg border border-outline-subtle/40 bg-surface-secondary/20 p-3"
                        >
                          <div className="md:col-span-5 space-y-1">
                            <label className="text-xs font-medium text-text-tertiary">
                              {(language === 'fr' ? 'Visite' : 'Visit')} {idx + 1} — {t.modals.startDate}
                            </label>
                            <div className="relative">
                              <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                              <input
                                type="date"
                                value={visit.date}
                                onChange={(event) => updateVisitDraft(visit.key, { date: event.target.value })}
                                className="glass-input w-full pl-10"
                              />
                            </div>
                          </div>
                          <div className="md:col-span-3 space-y-1">
                            <label className="text-xs font-medium text-text-tertiary">{t.modals.startTime}</label>
                            <div className="relative">
                              <Clock3 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                              <input
                                type="time"
                                value={visit.startTime}
                                onChange={(event) => updateVisitDraft(visit.key, { startTime: event.target.value })}
                                className="glass-input w-full pl-10"
                              />
                            </div>
                          </div>
                          <div className="md:col-span-3 space-y-1">
                            <label className="text-xs font-medium text-text-tertiary">{t.modals.endTime}</label>
                            <div className="relative">
                              <Clock3 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                              <input
                                type="time"
                                value={visit.endTime}
                                onChange={(event) => updateVisitDraft(visit.key, { endTime: event.target.value })}
                                className="glass-input w-full pl-10"
                              />
                            </div>
                          </div>
                          <div className="md:col-span-1 flex justify-end">
                            <button
                              type="button"
                              onClick={() => removeVisitDraft(visit.key)}
                              className="p-1.5 rounded-md text-text-tertiary hover:text-danger hover:bg-danger/10 transition-colors"
                              title={language === 'fr' ? 'Retirer cette visite' : 'Remove this visit'}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={addVisitDraft}
                    disabled={isEditMode && !visitsLoaded}
                    className="glass-button !py-2 !px-4 inline-flex items-center gap-2 text-sm disabled:opacity-50"
                  >
                    <Plus size={14} />
                    {language === 'fr' ? 'Ajouter une visite' : 'Add a visit'}
                  </button>
              </Box>
              )}

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
                right={!personalizedItems ? (
                  <button
                    type="button"
                    onClick={() => { setPickerMonth(null); setServicePickerOpen(true); }}
                    className="glass-button !py-2 !px-4 inline-flex items-center gap-2"
                  >
                    <Package size={14} />
                    {t.modals.addFromCatalog}
                  </button>
                ) : undefined}
              >
                {/* Service plan: same services on every visit, or per visit */}
                {isServicePlan && (
                  <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-outline-subtle/40 bg-surface-secondary/20 p-3">
                    <input
                      type="checkbox"
                      checked={applyItemsToAllVisits}
                      onChange={(event) => toggleApplyItemsToAllVisits(event.target.checked)}
                      className="h-4 w-4 mt-0.5"
                    />
                    <span>
                      <span className="block text-sm text-text-primary">{t.modals.servicePlanApplyAllLabel}</span>
                      <span className="block text-xs text-text-tertiary mt-0.5">
                        {applyItemsToAllVisits ? t.modals.servicePlanItemsApplyAllHint : t.modals.servicePlanItemsCustomHint}
                      </span>
                    </span>
                  </label>
                )}

                {personalizedItems ? (
                  selectedServiceMonths.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-outline-subtle bg-surface-secondary/30 p-6 text-center">
                      <Package size={24} className="text-text-tertiary mx-auto mb-2 opacity-40" />
                      <p className="text-sm text-text-secondary">{t.modals.servicePlanItemsNoMonths}</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {selectedServiceMonths.map((month) => {
                        const monthItems = serviceVisitItems[month] || [];
                        return (
                          <div key={month} className="rounded-xl border border-outline-subtle/40 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold capitalize text-text-primary">
                                {monthNames[month - 1]} {serviceYear}
                                {serviceMonthDates[month] && (
                                  <span className="ml-2 text-xs font-normal tabular-nums text-text-tertiary">{serviceMonthDates[month]}</span>
                                )}
                              </p>
                              <button
                                type="button"
                                onClick={() => { setPickerMonth(month); setServicePickerOpen(true); }}
                                className="glass-button !py-1.5 !px-3 inline-flex items-center gap-2 text-xs"
                              >
                                <Package size={13} />
                                {t.modals.addFromCatalog}
                              </button>
                            </div>
                            <div className="space-y-2">
                              {monthItems.map((item) => renderLineItemRow(item, {
                                update: (patch) => updateVisitItem(month, item.id, patch),
                                remove: () => removeVisitItem(month, item.id),
                                removeDisabled: monthItems.length <= 1,
                              }))}
                            </div>
                            <button
                              type="button"
                              onClick={() => addVisitItemRow(month)}
                              className="glass-button !py-1.5 !px-3 inline-flex items-center gap-2 text-xs"
                            >
                              <Plus size={13} />
                              {t.modals.addLineItem}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : (
                <>
                {/* Line items list */}
                {lineItems.length === 1 && !lineItems[0].name.trim() ? (
                  <div className="rounded-xl border border-dashed border-outline-subtle bg-surface-secondary/30 p-6 text-center">
                    <Package size={24} className="text-text-tertiary mx-auto mb-2 opacity-40" />
                    <p className="text-sm text-text-secondary">{t.modals.noLineItemsYet}</p>
                    <p className="text-xs text-text-tertiary mt-1">{t.modals.addFromCatalogHint}</p>
                    <button
                      type="button"
                      onClick={() => { setPickerMonth(null); setServicePickerOpen(true); }}
                      className="mt-3 text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <Plus size={11} /> {t.modals.browseServices}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {lineItems.map((item) => renderLineItemRow(item, {
                      update: (patch) => updateLineItem(item.id, patch),
                      remove: () => removeLineItem(item.id),
                      removeDisabled: lineItems.length === 1,
                    }))}
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
                </>
                )}
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

              {/* ── Agreement (written contract) — new jobs only ── */}
              {!isEditMode && (
                <Box
                  title={language === 'fr' ? 'Contrat' : 'Agreement'}
                  subtitle={language === 'fr' ? 'Optionnel — contrat écrit lié à ce job' : 'Optional — written contract attached to this job'}
                  right={(
                    <label className="flex items-center gap-2 cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={createAgreement}
                        onChange={(e) => setCreateAgreement(e.target.checked)}
                        className="h-4 w-4 rounded accent-primary"
                      />
                      <span className="text-[13px] font-medium text-text-primary">
                        {language === 'fr' ? 'Créer un contrat' : 'Create agreement'}
                      </span>
                    </label>
                  )}
                >
                  {createAgreement && (
                    <>
                      <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-outline-subtle bg-surface-secondary/40 p-3">
                        <input
                          type="checkbox"
                          checked={agreementRequireSignature}
                          onChange={(e) => setAgreementRequireSignature(e.target.checked)}
                          className="h-4 w-4 rounded mt-0.5 accent-primary"
                        />
                        <span>
                          <span className="block text-[13px] font-semibold text-text-primary">
                            {language === 'fr' ? 'Signature du client obligatoire' : 'Client signature required'}
                          </span>
                          <span className="block text-[12px] text-text-tertiary mt-0.5">
                            {language === 'fr'
                              ? 'Le client devra signer le contrat via un lien public (même pad de signature que les soumissions).'
                              : 'The client will sign the contract via a public link (same signature pad as quotes).'}
                          </span>
                        </span>
                      </label>

                      <div>
                        <span className="text-xs font-medium text-text-tertiary block mb-1.5">
                          {language === 'fr' ? 'Logo sur le contrat' : 'Logo on the contract'}
                        </span>
                        <div className="flex items-center gap-3 rounded-lg border border-outline-subtle p-3">
                          {(agreementLogoUrl || companyLogoUrl) ? (
                            <img
                              src={agreementLogoUrl || companyLogoUrl || ''}
                              alt="Logo"
                              className="h-11 w-11 rounded-lg object-contain border border-outline-subtle bg-surface-secondary shrink-0"
                            />
                          ) : (
                            <div className="h-11 w-11 rounded-lg bg-surface-secondary border border-outline-subtle shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-semibold text-text-primary">
                              {agreementLogoUrl
                                ? (language === 'fr' ? 'Logo personnalisé' : 'Custom logo')
                                : (language === 'fr' ? 'Logo de l’entreprise' : 'Company logo')}
                            </p>
                            <p className="text-[12px] text-text-tertiary">
                              {language === 'fr' ? 'Par défaut : Réglages → Détails de l’entreprise' : 'Default: Settings → Company details'}
                            </p>
                          </div>
                          {agreementLogoUrl && (
                            <button
                              type="button"
                              onClick={() => setAgreementLogoUrl(null)}
                              className="text-[12px] font-medium text-text-tertiary hover:text-danger shrink-0"
                            >
                              {language === 'fr' ? 'Retirer' : 'Remove'}
                            </button>
                          )}
                        </div>
                        <div className="mt-2">
                          <FileUpload
                            bucket={STORAGE_BUCKETS.COMPANY_LOGOS}
                            path="agreements"
                            accept="image/*"
                            maxSizeMb={5}
                            normalizeImageMaxDim={1024}
                            onUpload={(url) => setAgreementLogoUrl(url)}
                          />
                        </div>
                      </div>

                      <div>
                        <span className="text-xs font-medium text-text-tertiary block mb-1.5">
                          {language === 'fr' ? 'Termes et conditions' : 'Terms and conditions'}
                        </span>
                        <textarea
                          value={agreementTerms}
                          onChange={(e) => setAgreementTerms(e.target.value)}
                          rows={7}
                          className="glass-input w-full !h-auto text-[12.5px] leading-relaxed resize-y"
                        />
                        <p className="text-[11px] text-text-tertiary mt-1">
                          {language === 'fr'
                            ? 'Pré-rempli avec les termes par défaut — modifiable pour ce contrat.'
                            : 'Prefilled with the default terms — editable for this agreement.'}
                        </p>
                      </div>

                      {/* Live recap — always mirrors the items/prices entered on this page */}
                      <AgreementServicesSummary
                        title={language === 'fr' ? 'Services et prix du job — inclus au contrat' : 'Job services and prices — included on the contract'}
                        data={{
                          items: agreementPreviewData.items,
                          subtotalCents: effectiveSubtotalCents,
                          taxLines: taxLines
                            .filter((tx) => tx.enabled && tx.rate > 0)
                            .map((tx) => ({ label: tx.label, rate: tx.rate, amount_cents: Math.round(effectiveSubtotalCents * (tx.rate / 100)) })),
                          totalCents: grandTotalCents,
                        }}
                      />
                      <p className="text-[11px] text-text-tertiary">
                        {language === 'fr'
                          ? 'Mis à jour en direct avec les items de cette page. La date de création et les infos de l’entreprise sont aussi ajoutées automatiquement.'
                          : 'Updates live with the items on this page. Creation date and company info are added automatically too.'}
                      </p>

                      <button
                        type="button"
                        onClick={() => setAgreementPreviewOpen(true)}
                        className="glass-button !text-[12.5px] !px-3.5 !py-2 inline-flex items-center gap-1.5"
                      >
                        <Eye size={13} />
                        {language === 'fr' ? 'Prévisualiser le contrat (vue client)' : 'Preview contract (client view)'}
                      </button>

                      <AgreementDraftPreviewModal
                        open={agreementPreviewOpen}
                        onClose={() => setAgreementPreviewOpen(false)}
                        requireSignature={agreementRequireSignature}
                        terms={agreementTerms}
                        logoUrl={agreementLogoUrl || companyLogoUrl}
                        data={agreementPreviewData}
                      />
                    </>
                  )}
                </Box>
              )}

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
            <LeaveFormConfirm
              open={showLeaveConfirm}
              onConfirm={() => handleClose()}
              onCancel={() => {
                setShowLeaveConfirm(false);
                if (openedPathRef.current) navigate(openedPathRef.current);
              }}
            />
          </motion.div>
        </FormPageHost>
      )}
    </AnimatePresence>

    {/* Service catalog picker */}
    <AnimatePresence>
      {servicePickerOpen && (
        <ServicePicker
          isOpen={servicePickerOpen}
          onClose={() => { setServicePickerOpen(false); setPickerMonth(null); }}
          onSelect={handleServiceSelected}
          onRemove={handleServiceRemoved}
          addedIds={pickerAddedIds}
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
