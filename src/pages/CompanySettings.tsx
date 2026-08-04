import React, { useState, useEffect } from 'react';
import {
  Building,
  Check,
  Loader2,
  Phone,
  Globe,
  Mail,
  MapPin,
  Trash2,
  Image as ImageIcon,
  Star,
  ExternalLink,
  Target,
} from 'lucide-react';
import { motion } from 'motion/react';
import { supabase } from '../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import { cn } from '../lib/utils';
import { PageHeader } from '../components/ui';
import { useTranslation } from '../i18n';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import PermissionGate from '../components/PermissionGate';
import FileUpload from '../components/FileUpload';
import AddressAutocomplete, { type StructuredAddress } from '../components/AddressAutocomplete';
import { STORAGE_BUCKETS, deleteFile } from '../lib/storage';

interface CompanyDetails {
  id?: string;
  org_id?: string;
  company_name: string;
  phone: string;
  website: string;
  email: string;
  street1: string;
  street2: string;
  city: string;
  province: string;
  postal_code: string;
  country: string;
  logo_url: string;
  revenue_goal_cents: number;
  currency: string;
  google_review_url: string;
  review_enabled: boolean;
  review_widget_settings: {
    theme: 'light' | 'dark';
    filter: string;
    layout: 'cards' | 'carousel';
    max_display: number;
  };
}

const EMPTY_COMPANY: CompanyDetails = {
  company_name: '',
  phone: '',
  website: '',
  email: '',
  street1: '',
  street2: '',
  city: '',
  province: '',
  postal_code: '',
  country: '',
  logo_url: '',
  revenue_goal_cents: 0,
  currency: 'CAD',
  google_review_url: '',
  review_enabled: false,
  review_widget_settings: { theme: 'light', filter: 'all', layout: 'cards', max_display: 6 },
};

export default function CompanySettings() {
  const { t, language } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CompanyDetails>(EMPTY_COMPANY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  // When the initial load fails, saving is blocked: the form would be empty
  // and the org_id upsert would overwrite the existing row with blanks.
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  async function fetchCompany() {
      setLoading(true);
      setLoadFailed(false);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Try to fetch from company_settings table (scoped to current org)
        const currentOrgId = await getCurrentOrgIdOrThrow();
        setOrgId(currentOrgId);
        const { data, error } = await supabase
          .from('company_settings')
          .select('*')
          .eq('org_id', currentOrgId)
          .limit(1)
          .maybeSingle();
        if (error) throw error;

        if (data) {
          setForm({
            id: data.id,
            org_id: data.org_id,
            company_name: data.company_name || '',
            phone: data.phone || '',
            website: data.website || '',
            email: data.email || '',
            street1: data.street1 || '',
            street2: data.street2 || '',
            city: data.city || '',
            province: data.province || '',
            postal_code: data.postal_code || '',
            country: data.country || '',
            logo_url: data.logo_url || '',
            revenue_goal_cents: Number(data.revenue_goal_cents) || 0,
            currency: data.currency || 'CAD',
            google_review_url: data.google_review_url || '',
            review_enabled: data.review_enabled ?? false,
            review_widget_settings: data.review_widget_settings || EMPTY_COMPANY.review_widget_settings,
          });
        }
      } catch (e: any) {
        // Warn instead of failing silently: saving on top of a failed load
        // used to create a duplicate settings row.
        setLoadFailed(true);
        toast.error(e?.message || (language === 'fr' ? "Échec du chargement des paramètres de l'entreprise." : 'Failed to load company settings.'));
      }
      setLoading(false);
  }

  useEffect(() => {
    fetchCompany();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = <K extends keyof CompanyDetails>(key: K, value: CompanyDetails[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setDirty(true);
  };

  const handleSave = async () => {
    if (loadFailed) return;

    // Validate before writing — these values feed invoices, quotes and
    // outgoing emails, where a bad address fails silently downstream.
    const email = form.email.trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast.error(language === 'fr' ? 'Adresse courriel invalide.' : 'Invalid email address.');
      return;
    }
    // Tolerate "www.example.com" — normalize to https:// instead of rejecting.
    let website = form.website.trim();
    if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
    if (website && !/^https?:\/\/[^\s.]+\.\S{2,}/i.test(website)) {
      toast.error(language === 'fr' ? 'Adresse du site web invalide.' : 'Invalid website URL.');
      return;
    }
    const reviewUrl = form.google_review_url.trim();
    if (reviewUrl && !/^https?:\/\/[^\s.]+\.\S{2,}/i.test(reviewUrl)) {
      toast.error(language === 'fr' ? 'Lien Google Review invalide (doit commencer par https://).' : 'Invalid Google Review URL (must start with https://).');
      return;
    }

    setSaving(true);
    setSaved(false);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const payload = {
        company_name: form.company_name.trim(),
        phone: form.phone.trim(),
        website,
        email,
        street1: form.street1.trim(),
        street2: form.street2.trim(),
        city: form.city.trim(),
        province: form.province.trim(),
        postal_code: form.postal_code.trim(),
        country: form.country.trim(),
        logo_url: form.logo_url.trim(),
        revenue_goal_cents: Math.max(0, Math.round(form.revenue_goal_cents || 0)),
        currency: form.currency || 'CAD',
        google_review_url: form.google_review_url.trim(),
        review_enabled: form.review_enabled,
        review_widget_settings: form.review_widget_settings,
        updated_at: new Date().toISOString(),
      };

      if (form.id) {
        // Update existing record
        const { error } = await supabase
          .from('company_settings')
          .update(payload)
          .eq('id', form.id);
        if (error) throw error;
      } else {
        // Use the ACTIVE org — resolving via `memberships … limit(1)` picked an
        // arbitrary org for multi-org users, so settings could be created in
        // the wrong company.
        const orgId = await getCurrentOrgIdOrThrow();

        // Upsert on org_id so a transient load failure can't create a second
        // company_settings row for the same org (readers use `.limit(1)`).
        const { data, error } = await supabase
          .from('company_settings')
          .upsert({ ...payload, org_id: orgId, created_by: user.id }, { onConflict: 'org_id' })
          .select()
          .single();
        if (error) throw error;
        if (data) setForm((prev) => ({ ...prev, id: data.id, org_id: data.org_id }));
      }

      // Keep the org's name in sync — the old "Workspace" tab (removed) was a
      // second place to name the company; this page is now the single source.
      {
        const orgId = form.org_id || await getCurrentOrgIdOrThrow();
        if (payload.company_name) {
          const { error: orgErr } = await supabase
            .from('orgs')
            .update({ name: payload.company_name })
            .eq('id', orgId);
          if (orgErr) console.warn('[CompanySettings] org name sync failed:', orgErr.message);
        }
      }

      setSaved(true);
      setDirty(false);
      // Reflect normalized values (e.g. auto-prefixed https://) in the form.
      setForm((prev) => ({ ...prev, website, email }));
      queryClient.invalidateQueries({ queryKey: ['crm-revenue-goal'] });
      queryClient.invalidateQueries({ queryKey: ['org-revenue-goal'] });
      // La météo de l'accueil dépend de la ville — sinon elle reste en cache
      // (staleTime 30 min) et le changement de ville semble sans effet.
      queryClient.invalidateQueries({ queryKey: ['home-weather'] });
      toast.success(language === 'fr' ? 'Paramètres de l\'entreprise enregistrés.' : 'Company settings saved.');
      setTimeout(() => setSaved(false), 2000);
    } catch (error: any) {
      toast.error(error?.message || (language === 'fr' ? 'Erreur lors de l\'enregistrement.' : 'Failed to save.'));
    } finally {
      setSaving(false);
    }
  };

  // Persist the logo immediately on upload/remove — leaving it to the page's
  // global "Save" button meant an uploaded logo was silently lost when the
  // user navigated away without saving (recurring trap: logo_url stayed empty
  // while every quote/agreement/invoice preview showed no logo).
  // Extract the storage path from a public logo URL so the old file can be
  // deleted when the logo is removed or replaced (files were piling up).
  const logoStoragePath = (url: string): string | null => {
    const rest = url.split(`/object/public/${STORAGE_BUCKETS.COMPANY_LOGOS}/`)[1];
    return rest ? decodeURIComponent(rest.split('?')[0]) : null;
  };

  const persistLogo = async (url: string) => {
    const previousUrl = form.logo_url;
    try {
      if (form.id) {
        const { error } = await supabase
          .from('company_settings')
          .update({ logo_url: url, updated_at: new Date().toISOString() })
          .eq('id', form.id);
        if (error) throw error;
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');
        const orgId = await getCurrentOrgIdOrThrow();
        const { data, error } = await supabase
          .from('company_settings')
          .upsert({ org_id: orgId, logo_url: url, created_by: user.id, updated_at: new Date().toISOString() }, { onConflict: 'org_id' })
          .select()
          .single();
        if (error) throw error;
        if (data) setForm((prev) => ({ ...prev, id: data.id, org_id: data.org_id }));
      }
      setForm((prev) => ({ ...prev, logo_url: url }));
      // Clean up the replaced/removed file — best-effort, the DB is already right.
      if (previousUrl && previousUrl !== url) {
        const oldPath = logoStoragePath(previousUrl);
        if (oldPath) deleteFile(STORAGE_BUCKETS.COMPANY_LOGOS, oldPath).catch(() => {});
      }
      toast.success(url
        ? (language === 'fr' ? 'Logo enregistré.' : 'Logo saved.')
        : (language === 'fr' ? 'Logo retiré.' : 'Logo removed.'));
    } catch (err: any) {
      // Fall back to the manual flow: keep the value in the form so the
      // global "Save" button can persist it.
      update('logo_url', url);
      toast.error(err?.message || (language === 'fr'
        ? 'Le logo n’a pas pu être enregistré automatiquement — clique « Enregistrer ».'
        : 'Could not auto-save the logo — click "Save".'));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <PermissionGate permission="settings.update">
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <PageHeader
          title={language === 'fr' ? 'Paramètres de l\'entreprise' : 'Company Settings'}
          subtitle={t.companySettings.informationUsedForInvoicesQuotesAndEmail}
          icon={Building}
          iconColor="cyan"
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-3xl space-y-6"
      >
        {/* Company Logo */}
        <div className="section-card p-6 space-y-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
            <ImageIcon size={12} /> {language === 'fr' ? 'Logo de l\'entreprise' : 'Company Logo'}
          </h3>

          {form.logo_url ? (
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-xl border border-outline overflow-hidden bg-surface-secondary flex items-center justify-center">
                <img
                  src={form.logo_url}
                  alt={language === 'fr' ? "Logo de l'entreprise" : 'Company logo'}
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="space-y-2">
                <p className="text-[12px] text-text-secondary truncate max-w-[240px]">
                  {t.companySettings.currentLogo}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { void persistLogo(''); }}
                    className="glass-button inline-flex items-center gap-1.5 text-[11px] !text-danger !border-danger/30 hover:!bg-danger/10"
                  >
                    <Trash2 size={11} />
                    {t.companySettings.remove}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <FileUpload
              bucket={STORAGE_BUCKETS.COMPANY_LOGOS}
              path={orgId || form.org_id || 'default'}
              accept="image/*"
              maxSizeMb={5}
              normalizeImageMaxDim={1024}
              onUpload={(url) => { void persistLogo(url); }}
            />
          )}
        </div>

        {/* Company Info */}
        <div className="section-card p-6 space-y-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-tertiary">
            {language === 'fr' ? 'Détails de l\'entreprise' : 'Company Details'}
          </h3>

          <div>
            <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
              {language === 'fr' ? 'Nom de l\'entreprise' : 'Company Name'}
            </label>
            <input
              type="text"
              value={form.company_name}
              onChange={(e) => update('company_name', e.target.value)}
              className="glass-input w-full mt-1"
              placeholder="Acme Corp"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1">
                <Phone size={10} /> {t.companySettings.phoneNumber}
              </label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
                className="glass-input w-full mt-1"
                placeholder="+1 (555) 123-4567"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1">
                <Globe size={10} /> {t.companySettings.websiteUrl}
              </label>
              <input
                type="url"
                value={form.website}
                onChange={(e) => update('website', e.target.value)}
                className="glass-input w-full mt-1"
                placeholder="https://www.example.com"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1">
              <Mail size={10} /> {t.companySettings.emailAddress}
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              className="glass-input w-full mt-1"
              placeholder="info@company.com"
            />
          </div>
        </div>

        {/* Address */}
        <div className="section-card p-6 space-y-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
            <MapPin size={12} /> {t.billing.address}
          </h3>

          <div>
            <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
              {t.companySettings.street1}
            </label>
            <AddressAutocomplete
              value={form.street1}
              onChange={(v) => update('street1', v)}
              onSelect={(addr: StructuredAddress) => {
                setForm((prev) => ({
                  ...prev,
                  street1: [addr.street_number, addr.street_name].filter(Boolean).join(' ') || addr.formatted_address,
                  city: addr.city || prev.city,
                  province: addr.province || prev.province,
                  postal_code: addr.postal_code || prev.postal_code,
                  country: addr.country || prev.country,
                }));
                setDirty(true);
              }}
              className="mt-1"
              placeholder="123 Main Street"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
              {t.companySettings.street2}
            </label>
            <input
              type="text"
              value={form.street2}
              onChange={(e) => update('street2', e.target.value)}
              className="glass-input w-full mt-1"
              placeholder={t.companySettings.aptSuiteUnitEtc}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                {t.billing.city}
              </label>
              <AddressAutocomplete
                value={form.city}
                onChange={(v) => update('city', v)}
                onSelect={(addr: StructuredAddress) => {
                  setForm((prev) => ({
                    ...prev,
                    city: addr.city || prev.city,
                    province: addr.province || prev.province,
                    country: addr.country || prev.country,
                  }));
                  setDirty(true);
                }}
                primaryTypes={['locality']}
                className="mt-1"
                placeholder="Drummondville"
              />
              <p className="text-[11px] text-text-tertiary mt-1">
                {language === 'fr'
                  ? 'Ville par défaut de toute l\'équipe — la météo de l\'accueil l\'utilise quand un profil n\'a pas de ville.'
                  : 'Default city for the whole team — home weather uses it when a profile has no city.'}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                {t.companySettings.provinceState}
              </label>
              <input
                type="text"
                value={form.province}
                onChange={(e) => update('province', e.target.value)}
                className="glass-input w-full mt-1"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                {t.billing.postalCode}
              </label>
              <input
                type="text"
                value={form.postal_code}
                onChange={(e) => update('postal_code', e.target.value)}
                className="glass-input w-full mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                {t.billing.country}
              </label>
              <input
                type="text"
                value={form.country}
                onChange={(e) => update('country', e.target.value)}
                className="glass-input w-full mt-1"
                placeholder="Canada"
              />
            </div>
          </div>
        </div>

        {/* Financial Goal */}
        <div className="section-card p-6 space-y-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
            <Target size={12} /> {language === 'fr' ? 'Objectif financier' : 'Financial Goal'}
          </h3>

          <div>
            <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
              {language === 'fr' ? 'Objectif de revenus ($)' : 'Revenue Goal ($)'}
            </label>
            <input
              type="number"
              min={0}
              step={100}
              value={form.revenue_goal_cents ? form.revenue_goal_cents / 100 : ''}
              onChange={(e) => {
                const dollars = parseFloat(e.target.value);
                update('revenue_goal_cents', Number.isFinite(dollars) ? Math.round(dollars * 100) : 0);
              }}
              className="glass-input w-full mt-1"
              placeholder="100000"
            />
            <p className="text-[12px] text-text-tertiary mt-1">
              {language === 'fr'
                ? 'Le diagramme d\'objectif dans Insights affichera la progression par rapport à ce montant.'
                : 'The goal chart in Insights will display progress against this amount.'}
            </p>
          </div>
        </div>

        {/* Google Reviews */}
        <div className="section-card p-6 space-y-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
            <Star size={12} /> {t.companySettings.googleReviews}
          </h3>

          <div>
            <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1">
              <ExternalLink size={10} /> {t.companySettings.googleReviewUrl}
            </label>
            <input
              type="url"
              value={form.google_review_url}
              onChange={(e) => update('google_review_url', e.target.value)}
              className="glass-input w-full mt-1"
              placeholder="https://g.page/r/your-business/review"
            />
            <p className="text-[12px] text-text-tertiary mt-1">
              {language === 'fr'
                ? 'Les clients satisfaits seront redirigés vers ce lien pour laisser un avis.'
                : 'Satisfied customers will be redirected to this link to leave a review.'}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text-primary">
                {language === 'fr' ? 'Activer les demandes d\'avis' : 'Enable review requests'}
              </p>
              <p className="text-[12px] text-text-tertiary">
                {language === 'fr'
                  ? 'Envoyer automatiquement des demandes d\'avis après complétion d\'un travail'
                  : 'Automatically send review requests after job completion'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!form.google_review_url.trim() && !form.review_enabled) {
                  toast.error(language === 'fr'
                    ? 'Ajoutez d\'abord votre lien Google Review'
                    : 'Add your Google Review URL first');
                  return;
                }
                update('review_enabled', !form.review_enabled);
              }}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                form.review_enabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600',
              )}
            >
              <span className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-surface-card transition-transform',
                form.review_enabled ? 'translate-x-6' : 'translate-x-1',
              )} />
            </button>
          </div>

          {!form.google_review_url.trim() && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2">
              <p className="text-[12px] text-amber-700 dark:text-amber-300">
                {language === 'fr'
                  ? '⚠️ Aucun lien Google Review configuré. Les emails de demande d\'avis ne seront pas envoyés.'
                  : '⚠️ No Google Review URL configured. Review request emails will not be sent.'}
              </p>
            </div>
          )}
        </div>

        {/* ── Regional ── */}
        <div className="section-card p-6 space-y-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-text-tertiary">
            {language === 'fr' ? 'Régional' : 'Regional'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                {language === 'fr' ? 'Devise' : 'Currency'}
              </label>
              <select
                value={form.currency}
                onChange={(e) => update('currency', e.target.value)}
                className="glass-input w-full mt-1"
              >
                <option value="CAD">CAD — {language === 'fr' ? 'Dollar canadien' : 'Canadian dollar'}</option>
                <option value="USD">USD — {language === 'fr' ? 'Dollar américain' : 'US dollar'}</option>
              </select>
            </div>
          </div>
          <p className="text-[12px] text-text-tertiary">
            {language === 'fr'
              ? 'Devise utilisée pour l\'affichage des montants (aperçu des taxes, etc.).'
              : 'Currency used to display amounts (tax preview, etc.).'}
          </p>
        </div>

        {/* The "Reviews Widget" settings card was removed: review_widget_settings
            has no consumer anywhere (no widget page, no embed) — the card sold a
            feature that doesn't exist. The column is kept so stored values
            survive if a widget ships later. */}

        {/* La carte du switch maître de localisation a été rapatriée sur la
            page Localisation GPS (/settings/location), avec le roster des
            consentements — tout le volet GPS au même endroit. */}

        {/* Save bar — sticky, z-30 pour rester au-dessus de la carte
            SetupChecklist (z-40 mais repliée en pastille sur mobile, cf.
            SetupChecklist). */}
        <div className={cn(
          'sticky bottom-4 z-30 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 backdrop-blur',
          dirty
            ? 'border-amber-300 bg-amber-50/95 dark:border-amber-700 dark:bg-amber-900/40'
            : 'border-outline bg-surface-card/90'
        )}>
          <span className="text-[13px] text-text-secondary">
            {loadFailed
              ? (language === 'fr' ? 'Chargement échoué — sauvegarde bloquée pour protéger vos données' : 'Load failed — saving is blocked to protect your data')
              : dirty
                ? (language === 'fr' ? 'Modifications non sauvegardées' : 'Unsaved changes')
                : (language === 'fr' ? 'Tout est à jour' : 'All changes saved')}
          </span>
          {loadFailed && (
            <button onClick={() => { void fetchCompany(); }} className="glass-button text-[12px]">
              {language === 'fr' ? 'Réessayer' : 'Retry'}
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !dirty || loadFailed}
            className={cn(
              'glass-button inline-flex items-center gap-1.5',
              saved && '!bg-success !text-white !border-success',
              dirty && !saving && !saved && '!bg-primary !text-white !border-primary'
            )}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : null}
            {saving ? (t.billing.saving) : saved ? (t.companySettings.saved) : (t.companySettings.saveChanges)}
          </button>
        </div>
      </motion.div>
    </div>
    </PermissionGate>
  );
}
