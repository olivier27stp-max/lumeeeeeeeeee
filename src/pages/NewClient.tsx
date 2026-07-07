/**
 * NewClient — full-page client creation form (/clients/new).
 *
 * Same chrome as the New Job form (header + footer bars, glass inputs) but the
 * fields sit directly on the page — no section cards. Unsaved input is
 * protected by the navigation guard (in-app) and beforeunload (browser).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { createClient, findClientsByEmail, type ClientPhone } from '../lib/clientsApi';
import { DEFAULT_LEAD_SOURCES, createLeadSource, listLeadSources } from '../lib/leadSourcesApi';
import { resolveTaxes, type TaxConfig } from '../lib/taxApi';
import AddressAutocomplete, { type StructuredAddress } from '../components/AddressAutocomplete';
import LeaveFormConfirm from '../components/ui/LeaveFormConfirm';
import { useNavigationGuard } from '../contexts/NavigationGuard';
import { useTranslation } from '../i18n';
import { useEscapeKey } from '../hooks/useEscapeKey';

const PHONE_LABELS: ClientPhone['label'][] = ['work', 'mobile', 'home', 'fax', 'other'];
const EMAIL_LABELS = ['main', 'work', 'personal', 'other'] as const;
const CREATE_SOURCE_VALUE = '__create_lead_source__';

interface PhoneRow {
  id: string;
  number: string;
  label: ClientPhone['label'];
}

function newPhoneRow(): PhoneRow {
  return { id: crypto.randomUUID(), number: '', label: 'work' };
}

export default function NewClient() {
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const fr = language === 'fr';

  // ── Form state ──
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [company, setCompany] = useState('');
  const [useCompanyName, setUseCompanyName] = useState(false);
  const [phones, setPhones] = useState<PhoneRow[]>([newPhoneRow()]);
  const [email, setEmail] = useState('');
  const [emailLabel, setEmailLabel] = useState<(typeof EMAIL_LABELS)[number]>('main');
  const [emailDupCount, setEmailDupCount] = useState(0);
  const [leadSource, setLeadSource] = useState('');
  const [customSources, setCustomSources] = useState<string[]>([]);
  const [creatingSource, setCreatingSource] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [addressSearch, setAddressSearch] = useState('');
  const [structured, setStructured] = useState<StructuredAddress | null>(null);
  const [taxes, setTaxes] = useState<TaxConfig[]>([]);
  const [taxesLoading, setTaxesLoading] = useState(true);
  const [selectedTaxIds, setSelectedTaxIds] = useState<Set<string>>(new Set());
  // Untouched selection saves tax_ids = null → the client follows the org
  // defaults even when those change later. Any toggle pins the explicit list.
  const [taxTouched, setTaxTouched] = useState(false);
  const [billingSame, setBillingSame] = useState(true);
  const [billingSearch, setBillingSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Dirty tracking — flipped only by genuine user input (see the root's
  // onInput/onChange); programmatic prefills never mark the form dirty.
  const [dirty, setDirty] = useState(false);
  const guard = useNavigationGuard(dirty);

  // Browser-level warning (refresh / close tab) while the form holds data.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  useEscapeKey(() => {
    if (creatingSource) { setCreatingSource(false); setNewSourceName(''); return; }
    navigate('/clients');
  }, true);

  // Org taxes — all applied by default, like on quotes/invoices.
  useEffect(() => {
    let active = true;
    resolveTaxes()
      .then(({ taxes: resolved }) => {
        if (!active) return;
        const activeTaxes = resolved.filter((tax) => tax.is_active);
        setTaxes(activeTaxes);
        setSelectedTaxIds(new Set(activeTaxes.map((tax) => tax.id)));
      })
      .catch(() => { if (active) setTaxes([]); })
      .finally(() => { if (active) setTaxesLoading(false); });
    return () => { active = false; };
  }, []);

  // Custom lead sources (merged with the built-in defaults below).
  useEffect(() => {
    let active = true;
    listLeadSources()
      .then((rows) => { if (active) setCustomSources(rows.map((row) => row.name)); })
      .catch(() => {}); // table not deployed yet → defaults only
    return () => { active = false; };
  }, []);

  const allSources = useMemo(() => {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const name of [...DEFAULT_LEAD_SOURCES, ...customSources, ...(leadSource ? [leadSource] : [])]) {
      const key = name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(name.trim());
    }
    return merged;
  }, [customSources, leadSource]);

  const patchPhone = (id: string, patch: Partial<PhoneRow>) => {
    setPhones((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const addPhone = () => setPhones((prev) => [...prev, newPhoneRow()]);

  const removePhone = (id: string) => {
    setPhones((prev) => (prev.length > 1 ? prev.filter((row) => row.id !== id) : prev));
  };

  const handleAddSource = async () => {
    const name = newSourceName.trim();
    if (!name) return;
    try {
      await createLeadSource(name);
      setCustomSources((prev) => (prev.some((s) => s.toLowerCase() === name.toLowerCase()) ? prev : [...prev, name]));
    } catch {
      // table not deployed yet — the source still saves as text on the client
    }
    setLeadSource(name);
    setNewSourceName('');
    setCreatingSource(false);
  };

  const checkEmailDuplicates = async () => {
    const value = email.trim().toLowerCase();
    if (!value) { setEmailDupCount(0); return; }
    try {
      const dups = await findClientsByEmail(value);
      setEmailDupCount(dups.length);
    } catch {
      setEmailDupCount(0);
    }
  };

  const phoneLabelText = (label: ClientPhone['label']) => {
    const map: Record<ClientPhone['label'], string> = fr
      ? { work: 'Travail', mobile: 'Mobile', home: 'Maison', fax: 'Fax', other: 'Autre' }
      : { work: 'Work', mobile: 'Mobile', home: 'Home', fax: 'Fax', other: 'Other' };
    return map[label];
  };

  const emailLabelText = (label: (typeof EMAIL_LABELS)[number]) => {
    const map: Record<(typeof EMAIL_LABELS)[number], string> = fr
      ? { main: 'Principal', work: 'Travail', personal: 'Personnel', other: 'Autre' }
      : { main: 'Main', work: 'Work', personal: 'Personal', other: 'Other' };
    return map[label];
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setInlineError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setInlineError(t.clients.firstLastRequired);
      return;
    }
    setSaving(true);
    try {
      const cleanPhones: ClientPhone[] = phones
        .map((row) => ({ number: row.number.trim(), label: row.label }))
        .filter((row) => row.number);
      const created = await createClient({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        company: company.trim() || undefined,
        display_as_company: useCompanyName && Boolean(company.trim()),
        email: email.trim() || undefined,
        email_label: emailLabel,
        phone: cleanPhones[0]?.number,
        phones: cleanPhones,
        lead_source: leadSource || null,
        address: addressSearch.trim() || undefined,
        street_number: structured?.street_number || undefined,
        street_name: structured?.street_name || undefined,
        city: structured?.city || undefined,
        province: structured?.province || undefined,
        postal_code: structured?.postal_code || undefined,
        country: structured?.country || undefined,
        latitude: structured?.latitude ?? null,
        longitude: structured?.longitude ?? null,
        place_id: structured?.place_id || undefined,
        status: 'lead',
        billing_same_as_service: billingSame,
        billing_address: billingSame ? null : (billingSearch.trim() || null),
        tax_ids: taxTouched ? Array.from(selectedTaxIds) : null,
      });
      guard.release();
      toast.success(t.clients.clientCreated);
      navigate(`/clients/${created.id}`);
    } catch (err: any) {
      setInlineError(err?.message || t.clients.failedCreate);
      toast.error(err?.message || t.clients.failedCreate);
    } finally {
      setSaving(false);
    }
  };

  const fieldLabel = 'text-xs font-medium text-text-tertiary';
  const sectionTitle = 'text-[15px] font-bold tracking-tight text-text-primary';
  const squareButton = 'h-9 w-9 shrink-0 rounded-lg border border-border bg-surface-card flex items-center justify-center text-text-secondary hover:bg-surface-secondary hover:text-text-primary transition-colors';
  // Input bar hosting an inline label dropdown (phone / email rows).
  const inlineBar = 'glass-input w-full flex items-center gap-2';
  const inlineBarStyle: React.CSSProperties = { paddingTop: 0, paddingBottom: 0, paddingRight: '0.5rem' };

  return (
    <div
      className="item-form relative min-h-full bg-surface flex flex-col text-text-primary"
      onInput={(e) => { if (e.nativeEvent.isTrusted) setDirty(true); }}
      onChange={(e) => { if (e.nativeEvent.isTrusted) setDirty(true); }}
    >
      {/* ── Header ── */}
      <div className="px-6 pt-6 pb-2 flex items-start justify-between">
        <h2 className="text-[30px] font-extrabold tracking-tight text-text-primary leading-tight">
          {fr ? 'Nouveau client' : 'New Client'}
        </h2>
        <button
          type="button"
          onClick={() => navigate('/clients')}
          className="p-2 rounded-xl border border-outline hover:bg-surface-secondary transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      {/* ── Form — flat on the page, no section cards ── */}
      <form id="new-client-form" onSubmit={handleSubmit} className="flex-1 px-6 py-8">
        <div className="max-w-2xl mx-auto space-y-8 pb-4">
          {/* Name */}
          <section className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className={fieldLabel}>{fr ? 'Prénom' : 'First name'} <span className="text-danger">*</span></label>
                <input autoFocus value={firstName} onChange={(e) => setFirstName(e.target.value)} className="glass-input w-full" />
              </div>
              <div className="space-y-2">
                <label className={fieldLabel}>{fr ? 'Nom de famille' : 'Last name'} <span className="text-danger">*</span></label>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} className="glass-input w-full" />
              </div>
            </div>
            <div className="space-y-2">
              <label className={fieldLabel}>{fr ? 'Nom de la compagnie' : 'Company name'}</label>
              <input value={company} onChange={(e) => setCompany(e.target.value)} className="glass-input w-full" />
              <AnimatePresence initial={false}>
                {company.trim() && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <label className="flex items-start gap-3 cursor-pointer pt-2">
                      <input
                        type="checkbox"
                        checked={useCompanyName}
                        onChange={(e) => setUseCompanyName(e.target.checked)}
                        className="h-4 w-4 mt-0.5 rounded"
                      />
                      <span>
                        <span className="block text-[13px] font-medium text-text-primary">
                          {fr ? 'Utiliser le nom de la compagnie comme nom du client' : 'Use company name as client name'}
                        </span>
                        <span className="text-[12px] text-text-tertiary">
                          {fr
                            ? 'Client commercial — la compagnie devient le nom principal partout dans le CRM.'
                            : 'Commercial client — the company becomes the primary name across the CRM.'}
                        </span>
                      </span>
                    </label>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>

          {/* Communication */}
          <section className="space-y-4 border-t border-border pt-6">
            <h3 className={sectionTitle}>Communication</h3>
            <div className="space-y-2">
              <label className={fieldLabel}>{fr ? 'Numéro de téléphone' : 'Phone number'}</label>
              <div className="space-y-2">
                {phones.map((row) => (
                  <div key={row.id} className="flex items-center gap-2">
                    <div className={inlineBar} style={inlineBarStyle}>
                      <input
                        type="tel"
                        value={row.number}
                        onChange={(e) => patchPhone(row.id, { number: e.target.value })}
                        className="flex-1 min-w-0 bg-transparent border-none outline-none py-[0.5625rem] text-[13px]"
                        placeholder={fr ? 'Numéro de téléphone' : 'Phone number'}
                      />
                      {row.number.trim() && (
                        <div className="relative flex items-center shrink-0 border-l border-border pl-2 my-1.5">
                          <select
                            value={row.label}
                            onChange={(e) => patchPhone(row.id, { label: e.target.value as ClientPhone['label'] })}
                            className="appearance-none bg-transparent border-none outline-none pr-4 text-[12px] font-medium text-text-tertiary cursor-pointer"
                          >
                            {PHONE_LABELS.map((label) => (
                              <option key={label} value={label}>{phoneLabelText(label)}</option>
                            ))}
                          </select>
                          <ChevronDown size={12} className="absolute right-0 pointer-events-none text-text-tertiary" />
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={addPhone} className={squareButton} title={fr ? 'Ajouter un numéro' : 'Add another number'}>
                      <Plus size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removePhone(row.id)}
                      disabled={phones.length === 1}
                      className={`${squareButton} disabled:opacity-35 disabled:cursor-default disabled:hover:bg-surface-card`}
                      title={fr ? 'Supprimer ce numéro' : 'Remove this number'}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className={fieldLabel}>{fr ? 'Courriel' : 'Email'}</label>
              <div className={inlineBar} style={inlineBarStyle}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => void checkEmailDuplicates()}
                  className="flex-1 min-w-0 bg-transparent border-none outline-none py-[0.5625rem] text-[13px]"
                  placeholder={fr ? 'courriel@exemple.com' : 'email@example.com'}
                />
                {email.trim() && (
                  <div className="relative flex items-center shrink-0 border-l border-border pl-2 my-1.5">
                    <select
                      value={emailLabel}
                      onChange={(e) => setEmailLabel(e.target.value as (typeof EMAIL_LABELS)[number])}
                      className="appearance-none bg-transparent border-none outline-none pr-4 text-[12px] font-medium text-text-tertiary cursor-pointer"
                    >
                      {EMAIL_LABELS.map((label) => (
                        <option key={label} value={label}>{emailLabelText(label)}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-0 pointer-events-none text-text-tertiary" />
                  </div>
                )}
              </div>
              {emailDupCount > 0 && (
                <p className="text-[12px] text-amber-600 dark:text-amber-500">
                  {fr
                    ? `${emailDupCount} client${emailDupCount > 1 ? 's ont' : ' a'} déjà ce courriel — le nouveau client sera créé quand même.`
                    : `${emailDupCount} client${emailDupCount > 1 ? 's' : ''} already ${emailDupCount > 1 ? 'have' : 'has'} this email — the new client will still be created.`}
                </p>
              )}
            </div>
          </section>

          {/* Lead information */}
          <section className="space-y-4 border-t border-border pt-6">
            <h3 className={sectionTitle}>{fr ? 'Informations du lead' : 'Lead information'}</h3>
            <div className="space-y-2">
              <label className={fieldLabel}>{fr ? 'Source du lead' : 'Lead source'}</label>
              <select
                value={leadSource}
                onChange={(e) => {
                  if (e.target.value === CREATE_SOURCE_VALUE) { setCreatingSource(true); return; }
                  setLeadSource(e.target.value);
                }}
                className="glass-input w-full"
              >
                <option value="">{fr ? '— Choisir une source —' : '— Select a source —'}</option>
                {allSources.map((source) => (
                  <option key={source} value={source}>{source}</option>
                ))}
                <option value={CREATE_SOURCE_VALUE}>{fr ? '+ Créer une nouvelle source' : '+ Create new lead source'}</option>
              </select>
              <AnimatePresence initial={false}>
                {creatingSource && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-2 pt-2">
                      <input
                        autoFocus
                        value={newSourceName}
                        onChange={(e) => setNewSourceName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAddSource(); } }}
                        className="glass-input flex-1"
                        placeholder={fr ? 'Nom de la nouvelle source' : 'New source name'}
                      />
                      <button type="button" onClick={() => void handleAddSource()} className="glass-button-primary">
                        {fr ? 'Ajouter' : 'Add'}
                      </button>
                      <button type="button" onClick={() => { setCreatingSource(false); setNewSourceName(''); }} className="glass-button">
                        {t.common.cancel}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>

          {/* Property address */}
          <section className="space-y-4 border-t border-border pt-6">
            <h3 className={sectionTitle}>{fr ? 'Adresse de la propriété' : 'Property address'}</h3>
            <div className="space-y-2">
              <label className={fieldLabel}>{fr ? 'Adresse' : 'Address'}</label>
              <AddressAutocomplete
                value={addressSearch}
                onChange={(value) => { setAddressSearch(value); setStructured(null); }}
                onSelect={(addr) => { setStructured(addr); setAddressSearch(addr.formatted_address); }}
                placeholder={fr ? 'Commencez à taper une adresse…' : 'Start typing an address...'}
              />
            </div>

            {/* Taxes — org defaults pre-checked */}
            <div className="space-y-2">
              <label className={fieldLabel}>Taxes</label>
              {taxesLoading ? (
                <div className="h-5 w-40 bg-surface-tertiary rounded animate-pulse" />
              ) : taxes.length === 0 ? (
                <p className="text-[12px] text-text-tertiary">
                  {fr
                    ? 'Aucune taxe configurée pour votre entreprise (Réglages → Taxes).'
                    : 'No taxes configured for your company (Settings → Taxes).'}
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  {taxes.map((tax) => (
                    <label key={tax.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedTaxIds.has(tax.id)}
                        onChange={(e) => {
                          setTaxTouched(true);
                          setSelectedTaxIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(tax.id); else next.delete(tax.id);
                            return next;
                          });
                        }}
                        className="h-4 w-4 rounded"
                      />
                      <span className="text-[13px] text-text-primary">
                        {tax.name} <span className="text-text-tertiary">({tax.rate}%)</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-[12px] text-text-tertiary">
                {fr
                  ? 'Appliquées par défaut aux soumissions et factures de ce client. Présélection : les taxes de votre entreprise.'
                  : "Applied by default to this client's quotes and invoices. Preselected: your company's taxes."}
              </p>
            </div>

            {/* Billing address */}
            <label className="flex items-start gap-3 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={billingSame}
                onChange={(e) => setBillingSame(e.target.checked)}
                className="h-4 w-4 mt-0.5 rounded"
              />
              <span className="text-[13px] font-medium text-text-primary">
                {fr
                  ? "L'adresse de facturation est identique à l'adresse de la propriété"
                  : 'Billing address is the same as property address'}
              </span>
            </label>
            <AnimatePresence initial={false}>
              {!billingSame && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-2 pt-1">
                    <label className={fieldLabel}>{fr ? 'Adresse de facturation' : 'Billing address'}</label>
                    <AddressAutocomplete
                      value={billingSearch}
                      onChange={setBillingSearch}
                      onSelect={(addr) => setBillingSearch(addr.formatted_address)}
                      placeholder={fr ? 'Commencez à taper une adresse…' : 'Start typing an address...'}
                    />
                    <p className="text-[12px] text-text-tertiary">
                      {fr ? 'Cette adresse apparaîtra sur les factures.' : 'This address will appear on invoices.'}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        </div>
      </form>

      {/* ── Footer ── */}
      <div className="sticky bottom-0 z-10 px-6 py-4 border-t border-border bg-surface flex items-center justify-between gap-4">
        <p className="text-[13px] text-danger min-h-[1rem]">{inlineError || ''}</p>
        <div className="flex items-center gap-3 shrink-0">
          <button type="button" onClick={() => navigate('/clients')} className="glass-button">
            {t.common.cancel}
          </button>
          <button form="new-client-form" type="submit" disabled={saving} className="glass-button-primary">
            {saving ? t.common.saving : (fr ? 'Enregistrer le client' : 'Save Client')}
          </button>
        </div>
      </div>

      {/* Leave-without-saving confirmation (in-app navigation with unsaved data) */}
      <LeaveFormConfirm open={guard.active} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} />
    </div>
  );
}
