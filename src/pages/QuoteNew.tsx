import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Calendar, Check, ChevronLeft, ChevronRight, Download, Eye,
  Image as ImageIcon, Mail, MapPin, Package, Phone, Plus, Trash2, X,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { listSalespeople } from '../lib/jobsApi';
import { listClients } from '../lib/clientsApi';
import {
  createQuote, formatQuoteMoney, fetchLeadJobLineItems,
  type QuoteLineItemInput, type QuoteSectionInput, type QuoteServicePlan,
} from '../lib/quotesApi';
import { getCompanySettings } from '../lib/invoicesApi';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import { peekNextNumbers } from '../lib/numbersApi';
import { supabase } from '../lib/supabase';
import { createLeadScoped } from '../lib/leadsApi';
import AddressAutocomplete, { type StructuredAddress } from '../components/AddressAutocomplete';
import { listPropertiesByClient, type PropertyRecord } from '../lib/propertiesApi';
import ServicePicker from '../components/ServicePicker';
import QuoteRenderer from '../components/quote/QuoteRenderer';
import AgreementDraftPreviewModal, { type AgreementDraftPreviewData } from '../components/agreements/AgreementDraftPreviewModal';
import AgreementServicesSummary from '../components/agreements/AgreementServicesSummary';
import type { QuoteRenderData } from '../components/quote/types';
import type { PredefinedService } from '../lib/servicesApi';
import type { QuotePreset } from '../types';
import { resolveTaxes, calculateTaxes, type TaxConfig } from '../lib/taxApi';
import { useTranslation } from '../i18n';
import SpecificNotesInline, { type SpecificNotesInlineHandle } from '../components/SpecificNotesInline';
import LeaveFormConfirm from '../components/ui/LeaveFormConfirm';
import { useNavigationGuard } from '../contexts/NavigationGuard';
import FileUpload from '../components/FileUpload';
import { STORAGE_BUCKETS, uploadFile } from '../lib/storage';
import { createJobAgreement, DEFAULT_AGREEMENT_TERMS } from '../lib/jobAgreementsApi';

/* ── Design (maquette approuvée) : texte noir pur / blanc pur uniquement ── */
const OUTLINE = 'border-[#e8e8e8] dark:border-white/10';
const CARD = `rounded-2xl border ${OUTLINE} bg-white dark:bg-[#0e0e11] p-5`;
const CARD_LABEL = 'text-[10px] font-extrabold uppercase tracking-[1.4px] text-black dark:text-white';
const FIELD = 'block text-[11px] font-bold text-black dark:text-white mb-1.5';
const INPUT = `w-full h-[38px] px-3 rounded-[10px] border ${OUTLINE} bg-[#fafafa] dark:bg-[#1c1c1f] text-[13px] text-black dark:text-white outline-none focus:border-black dark:focus:border-white transition-colors`;
const TEXTAREA = `w-full min-h-[74px] px-3 py-2.5 rounded-[10px] border ${OUTLINE} bg-[#fafafa] dark:bg-[#1c1c1f] text-[13px] leading-relaxed text-black dark:text-white outline-none focus:border-black dark:focus:border-white resize-y transition-colors`;
const GHOST = `h-[38px] px-3.5 rounded-[10px] border ${OUTLINE} bg-white dark:bg-[#0e0e11] text-[12.5px] font-semibold text-black dark:text-white hover:bg-[#f5f5f5] dark:hover:bg-[#1c1c1f] inline-flex items-center justify-center gap-1.5 transition-colors`;
const PRIMARY = 'h-[38px] px-5 rounded-[10px] bg-black text-white dark:bg-white dark:text-black text-[13px] font-bold active:scale-[0.98] transition-transform disabled:opacity-50 inline-flex items-center justify-center gap-2';
const ACTION_LINK = 'text-[11px] font-bold text-black dark:text-white underline underline-offset-[3px] inline-flex items-center gap-1.5 cursor-pointer';
const HINT = 'text-[10.5px] text-black dark:text-white mt-1.5';

const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={cn(
        'relative w-[34px] h-5 rounded-full transition-colors shrink-0',
        on ? 'bg-black dark:bg-white' : 'bg-[#e0e0e0] dark:bg-white/20',
      )}
    >
      <span className={cn(
        'absolute top-[2px] h-4 w-4 rounded-full shadow transition-all',
        on ? 'left-4 bg-white dark:bg-black' : 'left-[2px] bg-white',
      )} />
    </button>
  );
}

function Seg({ options, value, onChange }: {
  options: Array<{ value: string; label: React.ReactNode }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <span className={cn('inline-flex p-[3px] rounded-[10px] border bg-[#f5f5f5] dark:bg-[#1c1c1f]', OUTLINE)}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 px-3.5 rounded-[7px] text-[12px] font-bold text-black dark:text-white inline-flex items-center gap-1.5 transition-all',
            value === o.value && 'bg-white dark:bg-[#2a2a2e] shadow-sm',
          )}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
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

interface ClientDetail {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  company: string | null;
}

export default function QuoteNew() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const tq = t.quotes as any;
  const tm = t.modals as any;
  const navigate = useNavigate();
  const location = useLocation();
  const preset = (location.state as any)?.preset as QuotePreset | undefined;
  const MONTHS = fr ? MONTHS_FR : MONTHS_EN;

  // ── Contact ──
  const [contactMode, setContactMode] = useState<'new' | 'existing'>('existing');
  const [clients, setClients] = useState<Array<{ id: string; label: string }>>([]);
  const [clientId, setClientId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [clientListOpen, setClientListOpen] = useState(false);
  const [clientDetail, setClientDetail] = useState<ClientDetail | null>(null);
  const [leadFirstName, setLeadFirstName] = useState('');
  const [leadLastName, setLeadLastName] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadAddress, setLeadAddress] = useState('');
  const [leadAddressSearch, setLeadAddressSearch] = useState('');
  const [leadCompany, setLeadCompany] = useState('');

  // ── Détails ──
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [quoteNumber, setQuoteNumber] = useState('');
  const [quoteNumberTouched, setQuoteNumberTouched] = useState(false);
  const [nextQuoteNumber, setNextQuoteNumber] = useState<string | null>(null);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [salespeople, setSalespeople] = useState<Array<{ id: string; label: string }>>([]);
  const [salespersonId, setSalespersonId] = useState('');
  const [validDays, setValidDays] = useState(30);

  // ── Type + plan de service (même modèle que le formulaire de job) ──
  const [quoteType, setQuoteType] = useState<'one_off' | 'service_plan'>('one_off');
  const [serviceYear, setServiceYear] = useState(new Date().getFullYear());
  const [serviceMonthDates, setServiceMonthDates] = useState<Record<number, string>>({});

  // ── Photos en haut du devis ──
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // ── Sections optionnelles ──
  const [introEnabled, setIntroEnabled] = useState(false);
  const [introContent, setIntroContent] = useState('');
  const [disclaimerEnabled, setDisclaimerEnabled] = useState(true);
  const [contractDisclaimer, setContractDisclaimer] = useState(
    'Ce devis est valable pour les 30 prochains jours, apres quoi les valeurs peuvent etre sujettes a modification.'
  );
  const [clientMessageEnabled, setClientMessageEnabled] = useState(false);
  const [clientMessage, setClientMessage] = useState('');

  // ── Lignes ──
  const [lineItems, setLineItems] = useState<LineItemForm[]>([emptyLine()]);
  const [servicePickerOpen, setServicePickerOpen] = useState(false);
  const [lineEditId, setLineEditId] = useState<string | null>(null);
  const [addedServiceIds, setAddedServiceIds] = useState<Set<string>>(new Set());
  const [jobLineItems, setJobLineItems] = useState<Array<{ name: string; quantity: number; unit_price_cents: number; job_title: string }>>([]);

  // ── Taxes / rabais / dépôt ──
  const [taxEnabled, setTaxEnabled] = useState(true);
  const [taxRate, setTaxRate] = useState(0);
  const [taxLabel, setTaxLabel] = useState('');
  const [taxConfigured, setTaxConfigured] = useState<boolean | null>(null);
  const [resolvedTaxes, setResolvedTaxes] = useState<TaxConfig[]>([]);
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed' | ''>('');
  const [discountValue, setDiscountValue] = useState('');
  const [depositRequired, setDepositRequired] = useState(false);
  const [depositType, setDepositType] = useState<'percentage' | 'fixed'>('percentage');
  const [depositValue, setDepositValue] = useState('');
  const [requirePaymentMethod, setRequirePaymentMethod] = useState(false);

  // ── Contrat (agreement) — identique aux jobs ──
  const [createAgreement, setCreateAgreement] = useState(false);
  const [agreementRequireSignature, setAgreementRequireSignature] = useState(true);
  const [agreementTerms, setAgreementTerms] = useState('');
  const [agreementLogoUrl, setAgreementLogoUrl] = useState<string | null>(null);
  const [agreementPreviewOpen, setAgreementPreviewOpen] = useState(false);
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);

  // ── Divers ──
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const guard = useNavigationGuard(dirty);
  const [showPreview, setShowPreview] = useState(false);
  const [companySettings, setCompanySettings] = useState<any>(null);
  const specificNotesRef = useRef<SpecificNotesInlineHandle>(null);

  // ── Init ──
  useEffect(() => {
    peekNextNumbers().then(next => {
      if (!next?.quote) return;
      setNextQuoteNumber(next.quote);
      setQuoteNumber(prev => prev || next.quote!);
    });
    supabase.auth.getUser()
      .then(({ data }) => {
        const uid = data.user?.id;
        if (uid) setSalespersonId(prev => prev || uid);
      })
      .catch(() => {});
    listClients({ page: 1, pageSize: 500, sort: 'name_asc' })
      .then(r => setClients(r.items.map(c => ({
        id: c.id,
        label: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.company || c.id.slice(0, 6),
      })))).catch(() => setClients([]));
    listSalespeople().then(setSalespeople).catch(() => setSalespeople([]));
    getCompanySettings().then(setCompanySettings).catch(() => {});

    // Pré-remplissage depuis le preset choisi dans le popup (contenu, pas de prix).
    // Le titre reste vide — l'utilisateur le choisit lui-même.
    if (preset) {
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
      if (preset.images && preset.images.length > 0) setPhotos(preset.images);
      else if (preset.cover_image) setPhotos([preset.cover_image]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Client existant sélectionné : fiche, propriétés, items de job ──
  useEffect(() => {
    let active = true;
    if (!clientId) {
      setClientDetail(null); setProperties([]); setPropertyId(''); setJobLineItems([]);
      return;
    }
    supabase
      .from('clients')
      .select('id, first_name, last_name, email, phone, address, company')
      .eq('id', clientId)
      .maybeSingle()
      .then(({ data }) => { if (active) setClientDetail((data as ClientDetail) || null); })
      .then(undefined, () => { if (active) setClientDetail(null); });
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
      .catch(() => { if (active) setProperties([]); });
    fetchLeadJobLineItems(clientId).then((items) => { if (active) setJobLineItems(items); }).catch(() => {});
    return () => { active = false; };
  }, [clientId]);

  // ── Taxes auto (Réglages) ──
  useEffect(() => {
    setTaxConfigured(null);
    resolveTaxes(contactMode === 'existing' ? (clientId || null) : null, null).then((result) => {
      const taxes = result?.taxes || [];
      if (taxes.length > 0) {
        setResolvedTaxes(taxes);
        const active = taxes.filter((tx: any) => tx.is_active);
        const totalRate = active.reduce((s: number, tx: any) => s + tx.rate, 0);
        setTaxRate(totalRate);
        setTaxLabel(active.map((tx: any) => tx.name).join(' + ') + ` (${totalRate}%)`);
        setTaxEnabled(true);
        setTaxConfigured(true);
      } else {
        setTaxConfigured(false); setTaxEnabled(false); setTaxRate(0); setTaxLabel('');
      }
    }).catch(() => setTaxConfigured(false));
  }, [clientId, contactMode]);

  // ── Contrat : termes par défaut + logo d'entreprise (scopé à l'org active) ──
  useEffect(() => {
    if (!createAgreement) return;
    setAgreementTerms((prev) => prev || DEFAULT_AGREEMENT_TERMS[fr ? 'fr' : 'en']);
    if (companyLogoUrl === null) {
      getCurrentOrgIdOrThrow()
        .then((orgId) => supabase
          .from('company_settings')
          .select('logo_url')
          .eq('org_id', orgId)
          .limit(1)
          .maybeSingle())
        .then(({ data }) => setCompanyLogoUrl(data?.logo_url || ''))
        .then(undefined, () => setCompanyLogoUrl(''));
    }
  }, [createAgreement, fr, companyLogoUrl]);

  // ── Calculs ──
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
          ? taxBreakdown.reduce((s, tx) => s + tx.amount_cents, 0)
          : Math.round((subtotalCents - discountCents) * taxRate / 100))
      : 0,
  [subtotalCents, discountCents, taxEnabled, taxRate, taxBreakdown]);

  const totalCents = subtotalCents - discountCents + taxCents;

  // Draft contract preview — same document the client will see on /contract/:token
  const agreementPreviewData: AgreementDraftPreviewData = useMemo(() => {
    let name: string | null = null, email: string | null = null, phone: string | null = null, address: string | null = null;
    if (contactMode === 'new') {
      name = `${leadFirstName} ${leadLastName}`.trim() || leadCompany || null;
      email = leadEmail || null;
      phone = leadPhone || null;
      address = leadAddress || leadAddressSearch || null;
    } else if (clientDetail) {
      name = `${clientDetail.first_name || ''} ${clientDetail.last_name || ''}`.trim() || clientDetail.company || null;
      email = clientDetail.email;
      phone = clientDetail.phone;
      address = clientDetail.address;
    }
    return {
      numberLabel: `CTR-${quoteNumber.trim() || nextQuoteNumber || '—'}`,
      clientName: name,
      clientEmail: email,
      clientPhone: phone,
      propertyAddress: address,
      // Unnamed service lines with a price still count in the quote totals —
      // keep them on the contract too (generic "Service" label).
      items: lineItems
        .filter((it) => it.item_type === 'service' && !it.is_optional && (it.name.trim() || (parseFloat(it.unitPriceInput) || 0) > 0))
        .map((it) => {
          const qty = parseFloat(it.qtyInput) || 0;
          const unit = Math.round((parseFloat(it.unitPriceInput) || 0) * 100);
          return { name: it.name.trim() || 'Service', qty, unit_price_cents: unit, total_cents: Math.max(0, Math.round(qty * unit)) };
        }),
      taxLines: taxBreakdown.length > 0
        ? taxBreakdown.map((tx) => ({ label: tx.name, rate: tx.rate, amount_cents: tx.amount_cents }))
        : (taxEnabled && taxRate > 0 ? [{ label: taxLabel || 'Tax', rate: taxRate, amount_cents: taxCents }] : []),
      // Full subtotal + explicit discount — the contract shows the same lines as the quote page.
      subtotalCents,
      discountCents,
      discountPercent: discountType === 'percentage' ? (parseFloat(discountValue) || 0) : null,
    };
  }, [
    contactMode, leadFirstName, leadLastName, leadCompany, leadEmail, leadPhone, leadAddress,
    leadAddressSearch, clientDetail, quoteNumber, nextQuoteNumber, lineItems, taxBreakdown,
    taxEnabled, taxRate, taxLabel, taxCents, subtotalCents, discountCents, discountType, discountValue,
  ]);

  const depositCents = useMemo(() => {
    if (!depositRequired) return 0;
    const v = parseFloat(depositValue) || 0;
    return depositType === 'percentage' ? Math.round(totalCents * v / 100) : Math.round(v * 100);
  }, [depositRequired, depositType, depositValue, totalCents]);

  const selectedServiceMonths = useMemo(
    () => Object.keys(serviceMonthDates).map(Number).sort((a, b) => a - b),
    [serviceMonthDates],
  );

  const servicePlanPayload: QuoteServicePlan | null = useMemo(() => {
    if (quoteType !== 'service_plan' || selectedServiceMonths.length === 0) return null;
    return {
      year: serviceYear,
      visits: selectedServiceMonths.map((month) => ({ month, date: serviceMonthDates[month] })),
    };
  }, [quoteType, selectedServiceMonths, serviceMonthDates, serviceYear]);

  // ── Aperçu vue client ──
  const previewData: QuoteRenderData = useMemo(() => {
    let name = '';
    let email: string | null = null, phone: string | null = null,
      company: string | null = null, address: string | null = null;
    if (contactMode === 'new') {
      name = `${leadFirstName} ${leadLastName}`.trim();
      email = leadEmail || null; phone = leadPhone || null;
      company = leadCompany || null; address = leadAddress || leadAddressSearch || null;
    } else if (clientDetail) {
      name = `${clientDetail.first_name || ''} ${clientDetail.last_name || ''}`.trim() || clientDetail.company || '';
      email = clientDetail.email; phone = clientDetail.phone;
      company = clientDetail.company; address = clientDetail.address;
    }
    if (!name) name = 'Client';

    const mapItem = (i: LineItemForm): QuoteRenderData['items'][number] => {
      const qty = parseFloat(i.qtyInput) || 0;
      const unit = Math.round((parseFloat(i.unitPriceInput) || 0) * 100);
      return {
        id: i.id, name: i.name, description: i.description || null,
        qty, unit_price_cents: unit, total_cents: Math.round(qty * unit),
        item_type: i.item_type,
      };
    };
    const named = lineItems.filter(i => i.name.trim() || i.item_type !== 'service');

    return {
      quote_number: quoteNumber || (fr ? 'APERÇU' : 'PREVIEW'),
      title: title || (fr ? 'Aperçu du devis' : 'Quote Preview'),
      status: 'draft',
      valid_until: new Date(Date.now() + validDays * 86400000).toISOString(),
      created_at: new Date().toISOString(),
      notes: notes || null,
      currency: 'CAD',
      subtotal_cents: subtotalCents,
      discount_cents: discountCents,
      tax_cents: taxCents,
      tax_rate: taxEnabled ? taxRate : 0,
      tax_rate_label: taxEnabled ? taxLabel : tq.noTax,
      total_cents: totalCents,
      deposit_required: depositRequired,
      deposit_cents: depositCents,
      deposit_status: 'none',
      contact_name: name,
      contact_email: email,
      contact_phone: phone,
      contact_company: company,
      contact_address: address,
      company_name: companySettings?.company_name || (fr ? 'Votre entreprise' : 'Your Company'),
      company_email: companySettings?.company_email || null,
      company_phone: companySettings?.company_phone || null,
      company_address: companySettings?.company_address || null,
      company_logo_url: companySettings?.company_logo_url || null,
      introduction: introEnabled ? (introContent || null) : null,
      contract_disclaimer: disclaimerEnabled ? (contractDisclaimer || null) : null,
      images: photos,
      service_plan: servicePlanPayload,
      items: named.filter(i => !i.is_optional).map(mapItem),
      optional_items: named.filter(i => i.is_optional).map(mapItem),
    };
  }, [
    contactMode, leadFirstName, leadLastName, leadEmail, leadPhone, leadCompany,
    leadAddress, leadAddressSearch, clientDetail, quoteNumber, title, validDays, notes,
    subtotalCents, discountCents, taxCents, taxEnabled, taxRate, taxLabel, totalCents,
    depositRequired, depositCents, introEnabled, introContent, disclaimerEnabled,
    contractDisclaimer, photos, servicePlanPayload, lineItems, companySettings, fr, tq,
  ]);

  // ── Handlers lignes ──
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
    setDirty(true);
  };

  const handleServiceForLine = (service: PredefinedService) => {
    if (!lineEditId) return;
    setLineItems(p => p.map(i => i.id === lineEditId ? {
      ...i,
      source_service_id: service.id,
      name: service.name,
      description: service.description || '',
      unitPriceInput: String(service.default_price_cents / 100),
      item_type: 'service',
    } : i));
    setAddedServiceIds(prev => new Set([...prev, service.id]));
    setLineEditId(null);
    setDirty(true);
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
    setDirty(true);
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

  // ── Handlers plan de service (mêmes règles que le formulaire de job) ──
  const toggleServiceMonth = (month: number) => {
    setServiceMonthDates(prev => {
      const next = { ...prev };
      if (next[month]) delete next[month];
      else next[month] = `${serviceYear}-${String(month).padStart(2, '0')}-01`;
      return next;
    });
    setDirty(true);
  };
  const setServiceMonthDate = (month: number, date: string) => {
    setServiceMonthDates(prev => ({ ...prev, [month]: date }));
    setDirty(true);
  };
  const changeServiceYear = (delta: number) => {
    const nextYear = serviceYear + delta;
    setServiceYear(nextYear);
    setServiceMonthDates(prev => {
      const next: Record<number, string> = {};
      for (const [m, d] of Object.entries(prev)) {
        next[Number(m)] = d.replace(/^\d{4}/, String(nextYear));
      }
      return next;
    });
  };

  // ── Handlers photos ──
  const handlePhotoFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setPhotoUploading(true);
    setDirty(true);
    try {
      for (const file of Array.from(files)) {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `quotes/photos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { url } = await uploadFile(STORAGE_BUCKETS.ATTACHMENTS, path, file);
        setPhotos(p => [...p, url]);
      }
    } catch (err: any) {
      setError(err?.message || (fr ? 'Échec du téléversement de la photo.' : 'Photo upload failed.'));
    } finally {
      setPhotoUploading(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  // ── Submit ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (contactMode === 'new' && (!leadFirstName.trim() || !leadLastName.trim())) {
      setError(tq.firstAndLastRequired); return;
    }
    if (contactMode === 'existing' && !clientId) {
      setError(fr ? 'Sélectionnez un client.' : 'Select a client.'); return;
    }
    if (quoteType === 'service_plan' && selectedServiceMonths.length === 0) {
      setError(tm.servicePlanNoMonths); return;
    }

    const contactLabel = contactMode === 'new'
      ? `${leadFirstName.trim()} ${leadLastName.trim()}`
      : (clients.find(c => c.id === clientId)?.label || '');
    const finalTitle = title.trim() || `${tq.quoteForPrefix} ${contactLabel}`.trim() || tq.newQuote;

    // Priced-but-unnamed service lines count in the quote totals — persist them
    // too (generic "Service" label) so the document and contract match the page.
    const filteredItems: QuoteLineItemInput[] = lineItems
      .filter(i => i.name.trim() || i.item_type !== 'service' || (parseFloat(i.unitPriceInput) || 0) > 0)
      .map((i, idx) => ({
        source_service_id: i.source_service_id,
        name: i.name.trim() || (i.item_type === 'service' ? 'Service' : ''),
        description: i.description || null,
        quantity: Math.max(0.01, parseFloat(i.qtyInput) || 1),
        unit_price_cents: Math.max(0, Math.round((parseFloat(i.unitPriceInput) || 0) * 100)),
        sort_order: idx,
        is_optional: i.is_optional,
        item_type: i.item_type,
      }));

    const sections: QuoteSectionInput[] = [];
    if (photos.length > 0) sections.push({ section_type: 'images', title: 'Photos', content: JSON.stringify(photos), sort_order: 0, enabled: true });
    if (introEnabled) sections.push({ section_type: 'introduction', title: 'Introduction', content: introContent, sort_order: 1, enabled: true });
    if (disclaimerEnabled) sections.push({ section_type: 'contract_disclaimer', title: 'Contract / Disclaimer', content: contractDisclaimer, sort_order: 10, enabled: true });
    if (clientMessageEnabled) sections.push({ section_type: 'client_message', title: 'Client Message', content: clientMessage, sort_order: 20, enabled: true });

    // Numéro : défaut auto laissé au serveur; numéro modifié validé (pas au-delà
    // du prochain, pas déjà pris) — mêmes règles que le hub de création.
    let quoteNumberParam: string | null = null;
    if (nextQuoteNumber && quoteNumberTouched && quoteNumber.trim()) {
      const wanted = parseInt(quoteNumber.trim(), 10);
      const next = parseInt(nextQuoteNumber, 10);
      if (!Number.isFinite(wanted) || wanted <= 0) {
        setError(fr ? 'Le numéro de soumission doit être un nombre.' : 'Quote number must be a number.');
        return;
      }
      if (Number.isFinite(next) && wanted > next) {
        setError(fr
          ? `Le numéro ${wanted} n'existe pas — le prochain numéro disponible est ${next}.`
          : `Number ${wanted} doesn't exist yet — the next available number is ${next}.`);
        return;
      }
      try {
        const { data: dup } = await supabase
          .from('quotes')
          .select('id')
          .eq('quote_number', String(wanted))
          .is('deleted_at', null)
          .limit(1)
          .maybeSingle();
        if (dup?.id) {
          setError(fr
            ? `Le numéro de soumission ${wanted} est déjà utilisé.`
            : `Quote number ${wanted} is already in use.`);
          return;
        }
      } catch { /* la RPC tranchera côté serveur */ }
      quoteNumberParam = String(wanted);
    }

    setSaving(true);
    try {
      let leadId: string | null = null;
      let quoteClientId: string | null = null;
      if (contactMode === 'existing') {
        quoteClientId = clientId;
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

      const detail = await createQuote({
        lead_id: leadId,
        client_id: quoteClientId,
        property_id: propertyId || null,
        title: finalTitle,
        quote_number: quoteNumberParam,
        salesperson_id: salespersonId || null,
        context_type: leadId ? 'lead' : 'client',
        notes: notes || null,
        contract_disclaimer: contractDisclaimer || null,
        deposit_required: depositRequired,
        deposit_type: depositRequired ? depositType : null,
        deposit_value: depositRequired ? (parseFloat(depositValue) || 0) : 0,
        require_payment_method: requirePaymentMethod,
        tax_rate: taxEnabled ? taxRate : 0,
        tax_rate_label: taxEnabled ? taxLabel : tq.noTax,
        discount_type: discountType || null,
        discount_value: parseFloat(discountValue) || 0,
        source_template_id: preset?.id || null,
        source_template_name: preset?.name || null,
        quote_type: quoteType,
        service_plan: servicePlanPayload,
        line_items: filteredItems,
        sections,
      });

      // Contrat écrit lié au devis — même feature que les jobs, best-effort.
      if (createAgreement) {
        try {
          await createJobAgreement({
            quote_id: detail.quote.id,
            client_id: quoteClientId || leadId,
            require_signature: agreementRequireSignature,
            terms: agreementTerms,
            logo_url: agreementLogoUrl,
          });
        } catch (agErr: any) {
          console.error('[QuoteNew] agreement creation failed:', agErr?.message);
        }
      }

      if (specificNotesRef.current?.hasContent()) {
        await specificNotesRef.current.saveNote('quote', detail.quote.id);
      }

      guard.release();
      navigate(`/quotes/${detail.quote.id}`);
    } catch (err: any) {
      setError(err?.message || tq.failedToSaveQuote);
    } finally {
      setSaving(false);
    }
  };

  const mapsUrl = clientDetail?.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clientDetail.address)}`
    : null;
  const clientBoxName = clientDetail
    ? (`${clientDetail.first_name || ''} ${clientDetail.last_name || ''}`.trim() || clientDetail.company || '')
    : '';

  // Recherche client : ne pas filtrer quand le champ affiche le libellé du client
  // déjà sélectionné, pour que rouvrir la liste montre tous les clients.
  const selectedClientLabel = clientId ? (clients.find(c => c.id === clientId)?.label || '') : '';
  const clientQuery = clientSearch.trim().toLowerCase();
  const filteredClients = (!clientQuery || clientSearch === selectedClientLabel)
    ? clients
    : clients.filter(c => c.label.toLowerCase().includes(clientQuery));

  const sectionToggles = [
    { key: 'intro', label: tq.introduction, enabled: introEnabled, toggle: setIntroEnabled },
    { key: 'disclaimer', label: tq.contractDisclaimer, enabled: disclaimerEnabled, toggle: setDisclaimerEnabled },
    { key: 'clientMsg', label: tq.clientMessageLabel, enabled: clientMessageEnabled, toggle: setClientMessageEnabled },
  ];

  return (
    <div
      className="min-h-full"
      onInput={(e) => { if (e.nativeEvent.isTrusted) setDirty(true); }}
      onChange={(e) => { if (e.nativeEvent.isTrusted) setDirty(true); }}
    >
      <LeaveFormConfirm open={guard.active} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} />

      {/* ── En-tête sticky ── */}
      <div className={cn('sticky top-0 z-20 bg-surface border-b px-8 py-4 flex items-center justify-between gap-4', OUTLINE)}>
        <div className="flex items-center gap-3.5 min-w-0">
          <button type="button" onClick={() => navigate('/quotes')} className={cn(GHOST, 'w-[34px] px-0')}>
            <ArrowLeft size={15} />
          </button>
          <div className="min-w-0">
            <p className="text-[11.5px] font-medium text-black dark:text-white">
              {fr ? 'Devis / Nouveau' : 'Quotes / New'}
            </p>
            <h1 className="text-[22px] font-extrabold tracking-[-0.4px] leading-tight text-black dark:text-white">
              {tq.newQuote}
            </h1>
          </div>
          {quoteNumber && (
            <span className={cn('text-[12px] font-bold px-2.5 py-1 rounded-lg border bg-white dark:bg-[#0e0e11] text-black dark:text-white tabular-nums', OUTLINE)}>
              #{quoteNumber}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => setShowPreview(v => !v)} className={GHOST}>
            <Eye size={14} />
            {fr ? 'Aperçu vue client' : 'Client view preview'}
          </button>
          <button type="button" onClick={() => navigate('/quotes')} className={GHOST}>{tq.cancel}</button>
          <button form="quote-new-form" type="submit" disabled={saving} className={PRIMARY}>
            {saving ? tq.saving : tq.saveQuote}
          </button>
        </div>
      </div>

      {/* ── Corps : formulaire + rail ── */}
      <div className="flex gap-6 px-8 py-7 max-w-[1240px]">
        <form id="quote-new-form" onSubmit={handleSubmit} className="flex-1 min-w-0 flex flex-col gap-4">

          {/* Contact */}
          <div className={CARD}>
            <div className={cn(CARD_LABEL, 'flex items-center justify-between mb-3.5')}>
              {tq.contact}
              <Seg
                value={contactMode}
                onChange={(v) => setContactMode(v as 'new' | 'existing')}
                options={[
                  { value: 'new', label: tq.newTab },
                  { value: 'existing', label: fr ? 'Client existant' : 'Existing client' },
                ]}
              />
            </div>

            {contactMode === 'new' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div><label className={FIELD}>{tq.firstName} *</label>
                    <input autoFocus value={leadFirstName} onChange={e => setLeadFirstName(e.target.value)} className={INPUT} placeholder="John" /></div>
                  <div><label className={FIELD}>{tq.lastName} *</label>
                    <input value={leadLastName} onChange={e => setLeadLastName(e.target.value)} className={INPUT} placeholder="Doe" /></div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div><label className={FIELD}>{tq.emailLabel}</label>
                    <input type="email" value={leadEmail} onChange={e => setLeadEmail(e.target.value)} className={INPUT} placeholder={tq.emailPlaceholder} /></div>
                  <div><label className={FIELD}>{tq.phoneLabel}</label>
                    <input type="tel" value={leadPhone} onChange={e => setLeadPhone(e.target.value)} className={INPUT} placeholder={tq.phonePlaceholder} /></div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div><label className={FIELD}>{tq.company}</label>
                    <input value={leadCompany} onChange={e => setLeadCompany(e.target.value)} className={INPUT} placeholder={tq.companyName} /></div>
                  <div><label className={FIELD}>{tq.addressLabel}</label>
                    <AddressAutocomplete
                      value={leadAddressSearch}
                      onChange={setLeadAddressSearch}
                      onSelect={(addr: StructuredAddress) => {
                        const line1 = [addr.street_number, addr.street_name].filter(Boolean).join(' ').trim();
                        setLeadAddress(line1 || addr.formatted_address);
                        setLeadAddressSearch(addr.formatted_address);
                      }}
                      placeholder={tq.addressPlaceholder}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <label className={FIELD}>{tq.clientLabel}</label>
                <div className="relative">
                  <input
                    value={clientSearch || (clientId ? (clients.find(c => c.id === clientId)?.label || '') : '')}
                    onChange={e => { setClientSearch(e.target.value); setClientListOpen(true); if (!e.target.value) setClientId(''); }}
                    onFocus={() => setClientListOpen(true)}
                    className={INPUT}
                    placeholder={tq.selectClientOpt}
                    autoComplete="off"
                  />
                  {clientListOpen && (
                    <div className={cn('absolute z-50 top-full left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-[10px] border bg-white dark:bg-[#0e0e11] shadow-lg', OUTLINE)}>
                      {filteredClients.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => { setClientId(c.id); setClientSearch(c.label); setClientListOpen(false); }}
                          className={cn(
                            'w-full text-left px-3 py-2 text-[13px] text-black dark:text-white hover:bg-[#f5f5f5] dark:hover:bg-[#1c1c1f] transition-colors flex items-center justify-between gap-2',
                            c.id === clientId && 'font-bold bg-[#f5f5f5] dark:bg-[#1c1c1f]',
                          )}
                        >
                          <span className="truncate">{c.label}</span>
                          {c.id === clientId && <Check size={13} className="shrink-0" />}
                        </button>
                      ))}
                      {filteredClients.length === 0 && (
                        <p className="px-3 py-2 text-[13px] text-black dark:text-white opacity-60">
                          {fr ? 'Aucun client trouvé.' : 'No clients found.'}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                {clientListOpen && (
                  <div className="fixed inset-0 z-40" onClick={() => { setClientListOpen(false); setClientSearch(''); }} />
                )}
                <p className={HINT}>
                  {fr ? 'Inclut les leads — un lead est un client avec le statut « lead ».' : 'Includes leads — a lead is a client with the "lead" status.'}
                </p>

                {/* Boîte client — réplique du hub des jobs (EntityHubHeader) */}
                {clientDetail && (
                  <div className={cn('mt-3.5 rounded-xl border bg-[#fafafa] dark:bg-[#1c1c1f] px-4 py-4', OUTLINE)}>
                    <Link
                      to={`/clients/${clientDetail.id}`}
                      className="inline-block text-[18px] font-extrabold text-black dark:text-white hover:underline"
                    >
                      {clientBoxName}
                    </Link>
                    {clientDetail.address && mapsUrl && (
                      <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 flex items-center gap-1.5 text-[13px] text-black dark:text-white hover:underline w-fit"
                      >
                        <MapPin size={13} className="shrink-0" />
                        {clientDetail.address}
                      </a>
                    )}
                    {(clientDetail.phone || clientDetail.email) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                        {clientDetail.phone && (
                          <a href={`tel:${clientDetail.phone}`} className="flex items-center gap-1.5 text-[13px] text-black dark:text-white hover:underline">
                            <Phone size={13} className="shrink-0" />
                            {clientDetail.phone}
                          </a>
                        )}
                        {clientDetail.email && (
                          <a href={`mailto:${clientDetail.email}`} className="flex items-center gap-1.5 text-[13px] text-black dark:text-white hover:underline break-all">
                            <Mail size={13} className="shrink-0" />
                            {clientDetail.email}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Détails + type */}
          <div className={CARD}>
            <div className={cn(CARD_LABEL, 'flex items-center justify-between mb-3.5')}>
              {fr ? 'Détails du devis' : 'Quote details'}
              <Seg
                value={quoteType}
                onChange={(v) => setQuoteType(v as 'one_off' | 'service_plan')}
                options={[
                  { value: 'one_off', label: fr ? 'Devis ponctuel' : 'One-off quote' },
                  { value: 'service_plan', label: <><Calendar size={12} /> {fr ? 'Plan de service' : 'Service plan'}</> },
                ]}
              />
            </div>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className={cn(INPUT, 'h-[46px] rounded-xl text-[16px] font-bold')}
              placeholder={tq.titlePlaceholder}
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <div>
                <label className={FIELD}>{tq.clientLabel}</label>
                <div className={cn(INPUT, 'flex items-center truncate')}>
                  {contactMode === 'existing'
                    ? (clientBoxName || <span>{tq.selectClientShort}</span>)
                    : ((`${leadFirstName} ${leadLastName}`.trim()) || <span>{tq.fromContactAbove}</span>)}
                </div>
              </div>
              {contactMode === 'existing' && clientId && properties.length > 0 && (
                <div><label className={FIELD}>{tm.property}</label>
                  <select value={propertyId} onChange={e => setPropertyId(e.target.value)} className={INPUT}>
                    <option value="">{tm.selectProperty}</option>
                    {properties.map(p => (
                      <option key={p.id} value={p.id}>{p.name}{p.address ? ` — ${p.address}` : ''}</option>
                    ))}
                  </select></div>
              )}
              <div><label className={FIELD}>{tq.quoteNumber}</label>
                <input value={quoteNumber}
                  onChange={e => { setQuoteNumber(e.target.value.replace(/\D/g, '')); setQuoteNumberTouched(true); }}
                  className={INPUT} placeholder={tq.auto} disabled={!nextQuoteNumber} /></div>
              <div><label className={FIELD}>{tq.salesperson}</label>
                <select value={salespersonId} onChange={e => setSalespersonId(e.target.value)} className={INPUT}>
                  <option value="">{tq.assign}</option>
                  {salespeople.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select></div>
              <div><label className={FIELD}>{tq.validForDays}</label>
                <input type="number" min={1} value={validDays} onChange={e => setValidDays(Number(e.target.value) || 30)} className={INPUT} /></div>
            </div>

          </div>

          {/* Plan de service — calendrier (même modèle que le formulaire de job) */}
          {quoteType === 'service_plan' && (
            <div className={CARD}>
              <div className={cn(CARD_LABEL, 'mb-1.5')}>{tm.servicePlanSchedule}</div>
              <p className={cn(HINT, 'mb-3.5 mt-0')}>
                {tm.servicePlanScheduleHint}{' '}
                {fr ? 'Le calendrier est visible par le client sur la soumission.' : 'The schedule is visible to the client on the quote.'}
              </p>
              <div className="flex items-center gap-2.5 mb-3">
                <button type="button" onClick={() => changeServiceYear(-1)} className={cn(GHOST, 'w-[30px] h-[30px] px-0')}>
                  <ChevronLeft size={13} />
                </button>
                <span className="text-[15px] font-extrabold text-black dark:text-white tabular-nums min-w-[52px] text-center">
                  {serviceYear}
                </span>
                <button type="button" onClick={() => changeServiceYear(1)} className={cn(GHOST, 'w-[30px] h-[30px] px-0')}>
                  <ChevronRight size={13} />
                </button>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {MONTHS.map((m, i) => {
                  const month = i + 1;
                  const on = Boolean(serviceMonthDates[month]);
                  return (
                    <button
                      key={month}
                      type="button"
                      onClick={() => toggleServiceMonth(month)}
                      className={cn(
                        'h-10 rounded-[10px] border-[1.5px] text-[12px] font-semibold text-black dark:text-white transition-colors',
                        on
                          ? 'border-black dark:border-white bg-[#f5f5f5] dark:bg-[#1c1c1f] font-extrabold'
                          : cn(OUTLINE, 'hover:bg-[#f5f5f5] dark:hover:bg-[#1c1c1f]'),
                      )}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
              {selectedServiceMonths.length > 0 && (
                <div className="mt-3.5">
                  <p className={FIELD}>{tm.servicePlanDates}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {selectedServiceMonths.map((month) => {
                      const mm = String(month).padStart(2, '0');
                      const lastDay = new Date(serviceYear, month, 0).getDate();
                      return (
                        <div key={month} className="flex items-center gap-2.5">
                          <span className="text-[12px] font-bold text-black dark:text-white w-[52px] shrink-0">{MONTHS[month - 1]}</span>
                          <input
                            type="date"
                            value={serviceMonthDates[month] || ''}
                            min={`${serviceYear}-${mm}-01`}
                            max={`${serviceYear}-${mm}-${lastDay}`}
                            onChange={e => setServiceMonthDate(month, e.target.value)}
                            className={INPUT}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Photos — haut du devis */}
          <div className={CARD}>
            <div className={cn(CARD_LABEL, 'flex items-center justify-between mb-3.5')}>
              {fr ? 'Photos — haut du devis' : 'Photos — top of the quote'}
            </div>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => handlePhotoFiles(e.target.files)}
            />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {photos.map((url) => (
                <div key={url} className={cn('relative aspect-[4/3] rounded-[10px] overflow-hidden border', OUTLINE)}>
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => { setPhotos(p => p.filter(u => u !== url)); setDirty(true); }}
                    className="absolute top-1.5 right-1.5 w-[22px] h-[22px] rounded-md bg-black text-white dark:bg-white dark:text-black flex items-center justify-center"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={photoUploading}
                onClick={() => photoInputRef.current?.click()}
                className={cn(
                  'aspect-[4/3] rounded-[10px] border-[1.5px] border-dashed flex flex-col items-center justify-center gap-1.5 text-[11px] font-semibold text-black dark:text-white hover:bg-[#f5f5f5] dark:hover:bg-[#1c1c1f] transition-colors disabled:opacity-50',
                  OUTLINE,
                )}
              >
                <ImageIcon size={18} />
                {photoUploading
                  ? (fr ? 'Téléversement…' : 'Uploading…')
                  : (fr ? 'Ajouter des photos' : 'Add photos')}
              </button>
            </div>
            <p className={HINT}>
              {fr
                ? "Affichées en haut du devis dans la vue client, sous l'en-tête de l'entreprise."
                : 'Shown at the top of the quote in the client view, under the company header.'}
            </p>
          </div>

          {/* Sections optionnelles */}
          <div className="flex flex-wrap gap-2">
            {sectionToggles.map(s => (
              <button
                key={s.key}
                type="button"
                onClick={() => s.toggle(!s.enabled)}
                className={cn(
                  'h-9 px-3.5 rounded-lg border text-[12.5px] text-black dark:text-white inline-flex items-center gap-2 transition-colors',
                  s.enabled
                    ? 'border-black dark:border-white bg-[#f5f5f5] dark:bg-[#1c1c1f] font-bold'
                    : cn(OUTLINE, 'bg-white dark:bg-[#0e0e11] font-semibold hover:bg-[#f5f5f5] dark:hover:bg-[#1c1c1f]'),
                )}
              >
                {s.enabled ? <Check size={13} strokeWidth={2.5} /> : <Plus size={13} strokeWidth={2.5} />}
                {s.label}
              </button>
            ))}
          </div>

          {/* Introduction */}
          {introEnabled && (
            <div className={CARD}>
              <div className={cn(CARD_LABEL, 'mb-3')}>{tq.introduction}</div>
              <textarea value={introContent} onChange={e => setIntroContent(e.target.value)}
                className={TEXTAREA} placeholder={tq.introPlaceholder} />
            </div>
          )}

          {/* Produits & services */}
          <div className={CARD}>
            <div className={cn(CARD_LABEL, 'flex items-center justify-between mb-3.5')}>
              {tq.productService}
              <span className="flex items-center gap-3.5">
                {jobLineItems.length > 0 && (
                  <button type="button" onClick={importJobLineItems} className={ACTION_LINK}>
                    <Download size={12} /> {tq.importFromJob} ({jobLineItems.length})
                  </button>
                )}
                <button type="button" onClick={() => setServicePickerOpen(true)} className={ACTION_LINK}>
                  <Package size={12} /> {tq.addFromCatalog}
                </button>
              </span>
            </div>

            <div className="grid grid-cols-[1fr_72px_96px_96px_34px] gap-2.5 pb-2 text-[10px] font-extrabold uppercase tracking-[1px] text-black dark:text-white">
              <span>{fr ? 'Produit / service' : 'Product / service'}</span>
              <span>{tq.quantity}</span>
              <span>{tq.unitPrice}</span>
              <span className="text-right">{tq.total}</span>
              <span />
            </div>

            {lineItems.map(item => (
              <div key={item.id} className={cn('grid grid-cols-[1fr_72px_96px_96px_34px] gap-2.5 items-start py-3 border-t', OUTLINE)}>
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setLineEditId(item.id)}
                    className={cn(INPUT, 'text-left flex items-center justify-between gap-2 font-semibold', item.is_optional && 'border-dashed')}
                  >
                    <span className={cn('truncate', item.is_optional && 'italic')}>
                      {item.name.trim() || t.servicePicker.choosePlaceholder}
                    </span>
                    <Package size={13} className="shrink-0" />
                  </button>
                  <textarea
                    value={item.description}
                    onChange={e => updateLine(item.id, { description: e.target.value })}
                    className={cn(TEXTAREA, 'mt-1.5 min-h-[40px] py-1.5 text-[12px] resize-none')}
                    placeholder={tq.description}
                  />
                </div>
                <input value={item.qtyInput} onChange={e => updateLine(item.id, { qtyInput: sanitize(e.target.value) })}
                  className={cn(INPUT, 'text-center')} />
                <input value={item.unitPriceInput} onChange={e => updateLine(item.id, { unitPriceInput: sanitize(e.target.value) })}
                  className={cn(INPUT, 'text-right')} />
                <p className="text-[13px] font-bold text-right text-black dark:text-white pt-2.5 tabular-nums">
                  {formatQuoteMoney(Math.round((parseFloat(item.qtyInput) || 0) * (parseFloat(item.unitPriceInput) || 0) * 100))}
                </p>
                <button type="button" onClick={() => removeLine(item.id)} disabled={lineItems.length === 1}
                  className="w-[30px] h-[30px] mt-1 rounded-lg flex items-center justify-center text-black dark:text-white hover:bg-[#f5f5f5] dark:hover:bg-[#1c1c1f] disabled:opacity-30">
                  <Trash2 size={14} />
                </button>
                <label className="col-span-full flex items-center gap-2 text-[11.5px] font-medium text-black dark:text-white cursor-pointer">
                  <input type="checkbox" checked={item.is_optional}
                    onChange={e => updateLine(item.id, { is_optional: e.target.checked })}
                    className="h-3.5 w-3.5 rounded accent-black dark:accent-white" />
                  {tq.markAsOptional}
                </label>
              </div>
            ))}

            <div className={cn('pt-3.5 border-t mt-0.5', OUTLINE)}>
              <button type="button" onClick={() => setLineItems(p => [...p, emptyLine()])} className={GHOST}>
                <Plus size={13} strokeWidth={2.5} /> {tq.addLineItem}
              </button>
            </div>
          </div>

          {/* Contrat (agreement) — identique aux jobs */}
          <div className={CARD}>
            <div className={cn(CARD_LABEL, 'mb-1')}>{fr ? 'Contrat (agreement)' : 'Agreement'}</div>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-[12.5px] font-semibold text-black dark:text-white">
                  {fr ? 'Créer un contrat' : 'Create agreement'}
                </p>
                <p className={cn(HINT, 'mt-0.5')}>
                  {fr
                    ? 'Optionnel — contrat écrit lié à ce devis, identique aux contrats de jobs.'
                    : 'Optional — written contract attached to this quote, same as job agreements.'}
                </p>
              </div>
              <Switch on={createAgreement} onChange={(v) => { setCreateAgreement(v); setDirty(true); }} />
            </div>

            {createAgreement && (
              <div className={cn('border-t pt-3.5 mt-1.5 space-y-3.5', OUTLINE)}>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={agreementRequireSignature}
                    onChange={e => setAgreementRequireSignature(e.target.checked)}
                    className="h-[15px] w-[15px] mt-0.5 rounded accent-black dark:accent-white"
                  />
                  <span>
                    <span className="text-[12.5px] font-semibold text-black dark:text-white block">
                      {fr ? 'Signature du client obligatoire' : 'Client signature required'}
                    </span>
                    <span className={cn(HINT, 'mt-0.5 block')}>
                      {fr
                        ? 'Le client signe via un lien public (/contract/…) — même pad de signature que les jobs.'
                        : 'The client signs via a public link (/contract/…) — same signature pad as jobs.'}
                    </span>
                  </span>
                </label>

                <div>
                  <span className={FIELD}>{fr ? 'Logo sur le contrat' : 'Logo on the contract'}</span>
                  <div className={cn('flex items-center gap-3 rounded-xl border p-3', OUTLINE)}>
                    {(agreementLogoUrl || companyLogoUrl) ? (
                      <img
                        src={agreementLogoUrl || companyLogoUrl || ''}
                        alt="Logo"
                        className={cn('h-11 w-11 rounded-lg object-contain border bg-[#fafafa] dark:bg-[#1c1c1f] shrink-0', OUTLINE)}
                      />
                    ) : (
                      <div className={cn('h-11 w-11 rounded-lg bg-[#f5f5f5] dark:bg-[#1c1c1f] border shrink-0', OUTLINE)} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-black dark:text-white">
                        {agreementLogoUrl
                          ? (fr ? 'Logo personnalisé' : 'Custom logo')
                          : (fr ? "Logo de l'entreprise" : 'Company logo')}
                      </p>
                      <p className={cn(HINT, 'mt-0')}>
                        {fr ? 'Par défaut : Réglages → Détails de l’entreprise' : 'Default: Settings → Company details'}
                      </p>
                    </div>
                    {agreementLogoUrl && (
                      <button
                        type="button"
                        onClick={() => setAgreementLogoUrl(null)}
                        className="text-[12px] font-semibold text-black dark:text-white underline underline-offset-[3px] shrink-0"
                      >
                        {fr ? 'Retirer' : 'Remove'}
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
                  <label className={FIELD}>{fr ? 'Termes et conditions' : 'Terms and conditions'}</label>
                  <textarea
                    value={agreementTerms}
                    onChange={e => setAgreementTerms(e.target.value)}
                    rows={7}
                    className={cn(TEXTAREA, 'text-[12.5px]')}
                  />
                  <p className={HINT}>
                    {fr
                      ? 'Pré-rempli avec les termes par défaut — modifiable pour ce contrat.'
                      : 'Prefilled with the default terms — editable for this agreement.'}
                  </p>
                </div>

                {/* Live recap — always mirrors the items/prices entered on this page */}
                <AgreementServicesSummary
                  title={fr ? 'Services et prix du devis — inclus au contrat' : 'Quote services and prices — included on the contract'}
                  data={{
                    items: agreementPreviewData.items,
                    subtotalCents,
                    discount: discountCents > 0
                      ? { amountCents: discountCents, percent: discountType === 'percentage' ? (parseFloat(discountValue) || 0) : null }
                      : null,
                    taxLines: agreementPreviewData.taxLines.map((tx) => ({ label: tx.label, rate: tx.rate, amount_cents: tx.amount_cents ?? 0 })),
                    totalCents,
                  }}
                />
                <p className={HINT}>
                  {fr
                    ? "Mis à jour en direct avec les items de cette page. La date de création et les informations de l'entreprise sont aussi ajoutées automatiquement."
                    : 'Updates live with the items on this page. Creation date and company info are added automatically too.'}
                </p>

                <button type="button" onClick={() => setAgreementPreviewOpen(true)} className={GHOST}>
                  <Eye size={13} />
                  {fr ? 'Prévisualiser le contrat (vue client)' : 'Preview contract (client view)'}
                </button>

                <AgreementDraftPreviewModal
                  open={agreementPreviewOpen}
                  onClose={() => setAgreementPreviewOpen(false)}
                  requireSignature={agreementRequireSignature}
                  terms={agreementTerms}
                  logoUrl={agreementLogoUrl || companyLogoUrl}
                  data={agreementPreviewData}
                />
              </div>
            )}
          </div>

          {/* Contrat / avis */}
          {disclaimerEnabled && (
            <div className={CARD}>
              <div className={cn(CARD_LABEL, 'flex items-center justify-between mb-3')}>
                {tq.contractDisclaimer}
                <button type="button" onClick={() => setDisclaimerEnabled(false)} className={ACTION_LINK}>
                  {fr ? 'Retirer' : 'Remove'}
                </button>
              </div>
              <textarea value={contractDisclaimer} onChange={e => setContractDisclaimer(e.target.value)}
                className={TEXTAREA} placeholder={tq.descriptionPlaceholder} />
            </div>
          )}

          {/* Message au client */}
          {clientMessageEnabled && (
            <div className={CARD}>
              <div className={cn(CARD_LABEL, 'mb-3')}>{tq.clientMessageHeading}</div>
              <textarea value={clientMessage} onChange={e => setClientMessage(e.target.value)}
                className={TEXTAREA} placeholder={tq.clientMessagePlaceholder} />
            </div>
          )}

          {/* Notes + fichiers internes */}
          <div className={CARD}>
            <div className={cn(CARD_LABEL, 'mb-3')}>{tq.notes}</div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              className={TEXTAREA} placeholder={tq.notesPlaceholder} />
            <p className={HINT}>{tq.notesVisibleToClient}</p>
            <div className="mt-3">
              <SpecificNotesInline ref={specificNotesRef} tempEntityType="quote" />
            </div>
          </div>

          {error && (
            <div className={cn('rounded-xl border-[1.5px] border-black dark:border-white bg-[#f5f5f5] dark:bg-[#1c1c1f] px-4 py-3 text-[13px] font-semibold text-black dark:text-white')}>
              {error}
            </div>
          )}
        </form>

        {/* ── Rail droite : résumé sticky ── */}
        <div className="hidden lg:block w-[330px] shrink-0">
          <div className="sticky top-[92px] flex flex-col gap-3.5">

            <div className={CARD}>
              <div className={cn(CARD_LABEL, 'mb-3')}>{fr ? 'Résumé' : 'Summary'}</div>
              {quoteType === 'service_plan' && (
                <div className={cn('flex items-center gap-2 rounded-[10px] border bg-[#f5f5f5] dark:bg-[#1c1c1f] px-2.5 py-2 mb-2.5 text-[11.5px] font-bold text-black dark:text-white', OUTLINE)}>
                  <Calendar size={13} />
                  {fr
                    ? `Plan de service — ${selectedServiceMonths.length} visite${selectedServiceMonths.length > 1 ? 's' : ''} · ${serviceYear}`
                    : `Service plan — ${selectedServiceMonths.length} visit${selectedServiceMonths.length > 1 ? 's' : ''} · ${serviceYear}`}
                </div>
              )}
              <div className="flex justify-between items-center py-1.5 text-[13px] text-black dark:text-white">
                <span>{tq.subtotal}</span>
                <span className="font-semibold tabular-nums">{formatQuoteMoney(subtotalCents)}</span>
              </div>
              <div className="flex justify-between items-center py-1.5 text-[13px] text-black dark:text-white">
                <span>{tq.discount}</span>
                {discountType ? (
                  <span className="flex items-center gap-1.5">
                    <select value={discountType} onChange={e => setDiscountType(e.target.value as any)}
                      className={cn(INPUT, 'h-[30px] w-[52px] px-1.5 text-[11.5px]')}>
                      <option value="percentage">%</option><option value="fixed">$</option>
                    </select>
                    <input value={discountValue} onChange={e => setDiscountValue(sanitize(e.target.value))}
                      className={cn(INPUT, 'h-[30px] w-[64px] text-right text-[11.5px]')} />
                    <button type="button" onClick={() => { setDiscountType(''); setDiscountValue(''); }}
                      className="text-black dark:text-white"><Trash2 size={12} /></button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setDiscountType('percentage')} className={ACTION_LINK}>
                    ＋ {tq.addDiscount}
                  </button>
                )}
              </div>
              <div className="flex justify-between items-center py-1.5 text-[13px] text-black dark:text-white">
                <span className="flex items-center">
                  {tq.tax}
                  {taxConfigured && taxLabel && (
                    <span className={cn('ml-1.5 text-[10.5px] font-bold border rounded-md px-1.5 py-0.5', OUTLINE)}>{taxLabel}</span>
                  )}
                </span>
                {taxConfigured === null ? (
                  <span className="text-[11px]">{tq.loading}</span>
                ) : taxConfigured === false ? (
                  <a href="/settings/taxes" className={ACTION_LINK}>{tq.configureTaxes}</a>
                ) : (
                  <span className="font-semibold tabular-nums">{formatQuoteMoney(taxCents)}</span>
                )}
              </div>
              <div className={cn('flex justify-between items-baseline border-t mt-2 pt-3', OUTLINE)}>
                <span className="text-[13px] font-extrabold text-black dark:text-white">{tq.total}</span>
                <span className="text-[22px] font-extrabold tracking-[-0.4px] text-black dark:text-white tabular-nums">
                  {formatQuoteMoney(totalCents)}
                </span>
              </div>
            </div>

            <div className={CARD}>
              <div className={cn(CARD_LABEL, 'mb-2')}>{tq.depositPaymentSettings}</div>
              <div className="flex items-center justify-between py-2 text-[12.5px] font-semibold text-black dark:text-white">
                {tq.requireDeposit}
                <Switch on={depositRequired} onChange={(v) => { setDepositRequired(v); setDirty(true); }} />
              </div>
              {depositRequired && (
                <div>
                  <div className="flex gap-2">
                    <select value={depositType} onChange={e => setDepositType(e.target.value as any)}
                      className={cn(INPUT, 'h-[34px] w-[110px] text-[12.5px]')}>
                      <option value="percentage">{tq.percentagePct}</option>
                      <option value="fixed">{tq.fixedAmount}</option>
                    </select>
                    <input value={depositValue} onChange={e => setDepositValue(sanitize(e.target.value))}
                      className={cn(INPUT, 'h-[34px] text-right text-[12.5px]')}
                      placeholder={depositType === 'percentage' ? '25' : '100'} />
                  </div>
                  {depositType === 'percentage' && (parseFloat(depositValue) || 0) > 100 && (
                    <p className={cn(HINT, 'font-bold')}>{tq.percentageExceeds}</p>
                  )}
                  <p className={HINT}>
                    {depositType === 'percentage'
                      ? `= ${formatQuoteMoney(depositCents)} ${fr ? "payable à l'approbation." : 'due on approval.'}`
                      : (fr ? "Payable à l'approbation." : 'Due on approval.')}
                  </p>
                </div>
              )}
              <div className={cn('flex items-center justify-between py-2 mt-1.5 border-t text-[12.5px] font-semibold text-black dark:text-white', OUTLINE)}>
                {tq.requirePaymentMethod}
                <Switch on={requirePaymentMethod} onChange={(v) => { setRequirePaymentMethod(v); setDirty(true); }} />
              </div>
            </div>

            <button form="quote-new-form" type="submit" disabled={saving} className={cn(PRIMARY, 'h-11 rounded-xl text-[13.5px]')}>
              {saving ? tq.saving : tq.saveQuote}
            </button>
            <button type="button" onClick={() => setShowPreview(v => !v)} className={cn(GHOST, 'h-10 rounded-xl')}>
              <Eye size={14} />
              {fr ? 'Aperçu vue client' : 'Client view preview'}
            </button>

          </div>
        </div>
      </div>

      {/* ── Aperçu vue client (panneau) ── */}
      {showPreview && (
        <div className={cn('fixed inset-y-0 right-0 z-[90] w-full max-w-[520px] border-l bg-[#f5f5f5] dark:bg-[#131316] flex flex-col shadow-[-16px_0_48px_rgba(0,0,0,0.15)]', OUTLINE)}>
          <div className={cn('px-4 py-3 border-b flex items-center justify-between shrink-0 bg-white dark:bg-[#0e0e11]', OUTLINE)}>
            <p className={CARD_LABEL}>
              {fr ? 'Aperçu vue client' : 'Client view preview'}
            </p>
            <button type="button" onClick={() => setShowPreview(false)}
              className="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-black dark:text-white hover:bg-[#f5f5f5] dark:hover:bg-[#1c1c1f]">
              <X size={15} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mx-auto max-w-[520px] rounded-lg bg-white shadow-md overflow-hidden">
              <QuoteRenderer data={previewData} />
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {servicePickerOpen && (
          <ServicePicker isOpen onClose={() => setServicePickerOpen(false)} onSelect={handleServiceSelected} onRemove={handleServiceRemoved} addedIds={addedServiceIds} />
        )}
        {lineEditId && (
          <ServicePicker isOpen singleSelect onClose={() => setLineEditId(null)} onSelect={handleServiceForLine} />
        )}
      </AnimatePresence>
    </div>
  );
}
