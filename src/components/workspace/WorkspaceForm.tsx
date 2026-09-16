/**
 * Formulaire de workspace — état + pages, partagés entre :
 *   - l'inscription (/checkout, OnboardingFlow) : le propriétaire crée son
 *     compte puis décrit son workspace AVANT de payer ;
 *   - le filet de sécurité post-paiement (WorkspaceNew) pour un compte qui
 *     arriverait dans l'app sans onboarding_done.
 *
 * Pages : company (obligatoire) → contact → preferences → reviews → team,
 * plus une page « review » (récapitulatif) optionnelle pour l'hôte.
 * Brouillon en sessionStorage : un rafraîchissement ne perd rien, et le
 * filet post-paiement retrouve ce qui a été saisi à l'inscription.
 */
import React, { useEffect, useId, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { STORAGE_BUCKETS } from '../../lib/storage';
import { useTranslation } from '../../i18n';
import AddressAutocomplete, { type StructuredAddress } from '../AddressAutocomplete';
import FileUpload from '../FileUpload';
import type { EmployeeCount, InviteRole, WorkspaceCreateInput } from '../../lib/workspacesApi';

// ── Constantes ──────────────────────────────────────────────────────

export const INDUSTRY_KEYS = [
  'landscaping', 'snow_removal', 'residential_cleaning', 'commercial_cleaning',
  'plumbing', 'electrical', 'roofing', 'hvac', 'window_cleaning', 'other',
] as const;
const EMPLOYEE_OPTIONS: EmployeeCount[] = ['1', '2-5', '6-15', '16-50', '50+'];
const INVITE_ROLES: InviteRole[] = ['admin', 'technician', 'sales_rep'];

export type WorkspacePageId = 'company' | 'contact' | 'preferences' | 'reviews' | 'team' | 'review';
/** Pages de saisie, dans l'ordre (sans le récapitulatif). */
export const WORKSPACE_INPUT_PAGES: WorkspacePageId[] = ['company', 'contact', 'preferences', 'reviews', 'team'];
export const WORKSPACE_STORAGE_KEY = 'lume-workspace-form';

export interface Invite { email: string; role: InviteRole }

export interface WorkspaceFormState {
  full_name: string;
  company_name: string;
  industry: string;
  employee_count: '' | EmployeeCount;
  language: 'fr' | 'en';
  logo_url: string;
  address_search: string;
  street1: string;
  street2: string;
  city: string;
  province: string;
  postal_code: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  currency: 'CAD' | 'USD';
  timezone: string;
  revenue_goal: string;
  review_enabled: boolean;
  google_review_url: string;
  facebook_review_url: string;
  invites: Invite[];
}

function detectTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto'; } catch { return 'America/Toronto'; }
}

function timezoneOptions(current: string): string[] {
  let all: string[] = [];
  try { all = ((Intl as any).supportedValuesOf?.('timeZone') as string[]) || []; } catch { all = []; }
  const americas = all.filter((z) => z.startsWith('America/'));
  const base = americas.length > 0 ? americas : ['America/Toronto', 'America/Montreal', 'America/Vancouver', 'America/Edmonton', 'America/Winnipeg', 'America/Halifax', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'];
  return current && !base.includes(current) ? [current, ...base] : base;
}

export function defaultWorkspaceState(language: string): WorkspaceFormState {
  return {
    full_name: '',
    company_name: '',
    industry: '',
    employee_count: '',
    language: language === 'en' ? 'en' : 'fr',
    logo_url: '',
    address_search: '',
    street1: '', street2: '', city: '', province: '', postal_code: '', country: '',
    phone: '', email: '', website: '',
    currency: 'CAD',
    timezone: detectTimezone(),
    revenue_goal: '',
    review_enabled: false,
    google_review_url: '',
    facebook_review_url: '',
    invites: [],
  };
}

export function roleLabel(role: InviteRole, fr: boolean): string {
  if (role === 'admin') return 'Admin';
  if (role === 'technician') return fr ? 'Technicien' : 'Technician';
  return fr ? 'Ventes' : 'Sales';
}

export function pageTitle(page: WorkspacePageId, fr: boolean): string {
  switch (page) {
    case 'company': return fr ? 'Votre entreprise' : 'Your business';
    case 'contact': return fr ? 'Coordonnées' : 'Contact details';
    case 'preferences': return fr ? 'Préférences' : 'Preferences';
    case 'reviews': return fr ? 'Avis clients' : 'Customer reviews';
    case 'team': return fr ? 'Votre équipe' : 'Your team';
    case 'review': return fr ? 'Récapitulatif' : 'Summary';
  }
}

export function pageSubtitle(page: WorkspacePageId, fr: boolean): string {
  switch (page) {
    case 'company': return fr ? 'Ces informations personnalisent votre CRM.' : 'These details personalize your CRM.';
    case 'contact': return fr ? 'Affichées sur vos devis et factures. La province sert à installer les bonnes taxes.' : 'Shown on your quotes and invoices. The province sets up the right taxes.';
    case 'preferences': return fr ? 'Devise, fuseau horaire et objectif annuel.' : 'Currency, timezone and annual goal.';
    case 'reviews': return fr ? 'À la fin d’une job, Lume envoie un sondage d’étoiles. Les notes 4-5 sont dirigées vers votre page Google ou Facebook ; les notes basses restent internes.' : 'When a job ends, Lume sends a star survey. 4-5 star ratings go to your Google or Facebook page; low ratings stay internal.';
    case 'team': return fr ? 'Invitez jusqu’à 5 personnes maintenant. Vous pourrez en ajouter d’autres dans Réglages → Membres.' : 'Invite up to 5 people now. You can add more later in Settings → Members.';
    case 'review': return fr ? 'Vérifiez avant de terminer.' : 'Check before finishing.';
  }
}

// ── Hook d'état ─────────────────────────────────────────────────────

export interface UseWorkspaceFormOptions {
  language: string;
  /** Nom complet déjà connu (inscription) : injecté dans l'état s'il est vide. */
  fullName?: string;
}

export function useWorkspaceForm({ language, fullName }: UseWorkspaceFormOptions) {
  const [state, setState] = useState<WorkspaceFormState>(() => {
    try {
      const raw = sessionStorage.getItem(WORKSPACE_STORAGE_KEY);
      if (raw) return { ...defaultWorkspaceState(language), ...JSON.parse(raw) };
    } catch { /* brouillon illisible : on repart à vide */ }
    return defaultWorkspaceState(language);
  });
  const [inviteDraft, setInviteDraft] = useState<Invite>({ email: '', role: 'technician' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try { sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state)); } catch { /* quota : le brouillon est un confort */ }
  }, [state]);

  useEffect(() => {
    if (fullName && fullName.trim()) setState((s) => (s.full_name ? s : { ...s, full_name: fullName.trim() }));
  }, [fullName]);

  const update = <K extends keyof WorkspaceFormState>(k: K, v: WorkspaceFormState[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  const onAddressSelect = (a: StructuredAddress) => {
    setState((s) => ({
      ...s,
      address_search: a.formatted_address,
      street1: [a.street_number, a.street_name].filter(Boolean).join(' '),
      city: a.city, province: a.province, postal_code: a.postal_code, country: a.country,
    }));
  };

  const fr = language === 'fr';
  const addInvite = (): boolean => {
    const email = inviteDraft.email.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(fr ? 'Courriel invalide.' : 'Invalid email.');
      return false;
    }
    if (state.invites.length >= 5) { setError(fr ? 'Maximum 5 invitations ici.' : 'Up to 5 invites here.'); return false; }
    setError(null);
    if (!state.invites.some((i) => i.email === email)) {
      update('invites', [...state.invites, { email, role: inviteDraft.role }]);
    }
    setInviteDraft({ email: '', role: inviteDraft.role });
    return true;
  };
  const removeInvite = (email: string) => update('invites', state.invites.filter((i) => i.email !== email));

  /** Page Entreprise complète ? (`askFullName` = le nom est demandé ici.) */
  const companyValid = (askFullName: boolean) =>
    state.company_name.trim().length > 0 && !!state.industry && !!state.employee_count
    && (!askFullName || state.full_name.trim().length > 0);

  const buildPayload = (): WorkspaceCreateInput => {
    const hasAddress = [state.street1, state.street2, state.city, state.province, state.postal_code, state.country].some((v) => v.trim());
    const goal = Math.round(parseFloat(state.revenue_goal.replace(/[^\d.]/g, '')) * 100);
    return {
      company: {
        name: state.company_name.trim(),
        industry: state.industry,
        employee_count: state.employee_count as EmployeeCount,
        logo_url: state.logo_url || null,
        language: state.language,
      },
      profile: { full_name: state.full_name.trim() || null },
      contact: {
        phone: state.phone.trim() || null,
        email: state.email.trim() || null,
        website: state.website.trim() || null,
        address: hasAddress
          ? {
            street1: state.street1.trim(), street2: state.street2.trim(), city: state.city.trim(),
            province: state.province.trim(), postal_code: state.postal_code.trim(), country: state.country.trim(),
          }
          : null,
      },
      preferences: {
        currency: state.currency,
        timezone: state.timezone || null,
        revenue_goal_cents: Number.isFinite(goal) && goal > 0 ? goal : null,
      },
      reviews: {
        enabled: state.review_enabled,
        google_review_url: state.google_review_url.trim() || null,
        facebook_review_url: state.facebook_review_url.trim() || null,
      },
      invites: state.invites,
    };
  };

  const clearDraft = () => { try { sessionStorage.removeItem(WORKSPACE_STORAGE_KEY); } catch { /* déjà consommé */ } };

  return { state, setState, update, onAddressSelect, inviteDraft, setInviteDraft, addInvite, removeInvite, companyValid, buildPayload, clearDraft, error, setError };
}

export type WorkspaceForm = ReturnType<typeof useWorkspaceForm>;

// ── Pages ───────────────────────────────────────────────────────────

export interface WorkspacePageProps {
  page: WorkspacePageId;
  form: WorkspaceForm;
  /** Demander le nom complet sur la page Entreprise (filet post-paiement). */
  askFullName?: boolean;
  /** Classe des champs texte : 'glass-input w-full' dans l'app, 'onb-input' à l'inscription. */
  inputClass?: string;
  /** Dossier de stockage du logo (id d'org si connu). */
  logoPath: string;
  /** Récapitulatif : aller à une page. */
  onEditPage?: (page: WorkspacePageId) => void;
}

const LBL = 'text-xs font-medium text-text-tertiary';
const DANGER = 'text-danger';

export function WorkspacePage({ page, form, askFullName = false, inputClass = 'glass-input w-full', logoPath, onEditPage }: WorkspacePageProps) {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const ids = useId();
  const { state, update } = form;
  const industryLabel = (key: string) => ((t as any).onboarding?.industries?.[key] as string) || key;

  const field = (
    id: string, label: string, key: keyof WorkspaceFormState, opts: { required?: boolean; placeholder?: string; type?: string; hint?: string; autoFocus?: boolean; maxLength?: number; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']; sanitize?: (v: string) => string } = {},
  ) => (
    <div className="space-y-2">
      <label htmlFor={`${ids}-${id}`} className={LBL}>{label}{opts.required && <> <span className={DANGER}>*</span></>}</label>
      <input
        id={`${ids}-${id}`}
        value={state[key] as string}
        onChange={(e) => update(key, (opts.sanitize ? opts.sanitize(e.target.value) : e.target.value) as never)}
        className={inputClass}
        placeholder={opts.placeholder}
        type={opts.type || 'text'}
        inputMode={opts.inputMode}
        autoFocus={opts.autoFocus}
        maxLength={opts.maxLength}
      />
      {opts.hint && <p className="text-[11px] text-text-tertiary">{opts.hint}</p>}
    </div>
  );

  if (page === 'company') {
    return (
      <div className="space-y-5">
        {askFullName && field('full-name', fr ? 'Votre nom complet' : 'Your full name', 'full_name', { required: true, autoFocus: true, maxLength: 120 })}
        {field('company', fr ? 'Nom de l’entreprise' : 'Company name', 'company_name', { required: true, autoFocus: !askFullName, maxLength: 200, placeholder: fr ? 'Ex. Vision Lavage' : 'e.g. ABC Landscaping' })}
        <div className="space-y-2">
          <p className={LBL}>{fr ? 'Industrie' : 'Industry'} <span className={DANGER}>*</span></p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="radiogroup" aria-label={fr ? 'Industrie' : 'Industry'}>
            {INDUSTRY_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={state.industry === key}
                onClick={() => update('industry', key)}
                className={cn(
                  'px-3 py-2 rounded-xl border text-[13px] text-left transition-colors',
                  state.industry === key ? 'border-primary bg-primary/10 text-primary font-semibold' : 'border-outline-subtle hover:bg-surface-secondary',
                )}
              >
                {industryLabel(key)}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className={LBL}>{fr ? 'Taille de l’équipe' : 'Team size'} <span className={DANGER}>*</span></p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={fr ? 'Taille de l’équipe' : 'Team size'}>
            {EMPLOYEE_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                role="radio"
                aria-checked={state.employee_count === opt}
                onClick={() => update('employee_count', opt)}
                className={cn(
                  'px-3.5 py-2 rounded-full border text-[13px] transition-colors',
                  state.employee_count === opt ? 'border-primary bg-primary/10 text-primary font-semibold' : 'border-outline-subtle hover:bg-surface-secondary',
                )}
              >
                {opt === '1' ? (fr ? 'Juste moi' : 'Just me') : opt}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label htmlFor={`${ids}-language`} className={LBL}>{fr ? 'Langue' : 'Language'}</label>
            <select id={`${ids}-language`} value={state.language} onChange={(e) => update('language', e.target.value as 'fr' | 'en')} className={inputClass}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="space-y-2">
            <p className={LBL}>Logo</p>
            {state.logo_url ? (
              <div className="flex items-center gap-3">
                <img src={state.logo_url} alt={fr ? 'Logo de l’entreprise' : 'Company logo'} className="h-10 w-10 rounded-lg object-contain bg-surface-secondary border border-outline-subtle" />
                <button type="button" onClick={() => update('logo_url', '')} className="glass-button inline-flex items-center gap-1.5 text-[11px] !text-danger !border-danger/30">
                  <Trash2 size={11} /> {fr ? 'Retirer' : 'Remove'}
                </button>
              </div>
            ) : (
              <FileUpload
                bucket={STORAGE_BUCKETS.COMPANY_LOGOS}
                path={logoPath}
                accept="image/*"
                maxSizeMb={5}
                normalizeImageMaxDim={1024}
                onUpload={(url) => update('logo_url', url)}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  if (page === 'contact') {
    return (
      <div className="space-y-5">
        <div className="space-y-2">
          <p className={LBL}>{fr ? 'Adresse' : 'Address'}</p>
          <AddressAutocomplete value={state.address_search} onChange={(v) => update('address_search', v)} onSelect={form.onAddressSelect} className={inputClass} placeholder={fr ? 'Rechercher une adresse…' : 'Search an address…'} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field('street1', fr ? 'Rue' : 'Street', 'street1')}
          {field('street2', fr ? 'Bureau / suite' : 'Unit / suite', 'street2')}
          {field('city', fr ? 'Ville' : 'City', 'city')}
          {field('province', fr ? 'Province / État' : 'Province / State', 'province', { hint: fr ? 'Sert à installer les bonnes taxes (défaut : Québec).' : 'Used to install the right taxes (default: Quebec).' })}
          {field('postal', fr ? 'Code postal' : 'Postal code', 'postal_code')}
          {field('country', fr ? 'Pays' : 'Country', 'country', { placeholder: 'CA' })}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field('phone', fr ? 'Téléphone' : 'Phone', 'phone', { type: 'tel' })}
          {field('email', fr ? 'Courriel de l’entreprise' : 'Business email', 'email', { type: 'email' })}
        </div>
        {field('website', fr ? 'Site web' : 'Website', 'website', { placeholder: 'https://' })}
      </div>
    );
  }

  if (page === 'preferences') {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label htmlFor={`${ids}-currency`} className={LBL}>{fr ? 'Devise' : 'Currency'}</label>
            <select id={`${ids}-currency`} value={state.currency} onChange={(e) => update('currency', e.target.value as 'CAD' | 'USD')} className={inputClass}>
              <option value="CAD">CAD</option>
              <option value="USD">USD</option>
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor={`${ids}-timezone`} className={LBL}>{fr ? 'Fuseau horaire' : 'Timezone'}</label>
            <select id={`${ids}-timezone`} value={state.timezone} onChange={(e) => update('timezone', e.target.value)} className={inputClass}>
              {timezoneOptions(state.timezone).map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
        </div>
        {field('goal', fr ? 'Objectif de revenu annuel' : 'Annual revenue goal', 'revenue_goal', { placeholder: '$250000', inputMode: 'decimal', sanitize: (v) => v.replace(/[^\d.]/g, ''), hint: fr ? 'Affiché sur l’accueil pour suivre votre progression.' : 'Shown on the home page to track progress.' })}
      </div>
    );
  }

  if (page === 'reviews') {
    return (
      <div className="space-y-5">
        <label htmlFor={`${ids}-review-enabled`} className="flex items-start gap-3 cursor-pointer">
          <input id={`${ids}-review-enabled`} type="checkbox" checked={state.review_enabled} onChange={(e) => update('review_enabled', e.target.checked)} className="h-4 w-4 mt-0.5 rounded" />
          <span>
            <span className="block text-[13px] font-medium">{fr ? 'Activer les demandes d’avis' : 'Enable review requests'}</span>
            <span className="text-[12px] text-text-tertiary">{fr ? 'Nécessite au moins un lien ci-dessous. Réglable plus tard dans Réglages → Avis clients.' : 'Requires at least one link below. Adjustable later in Settings → Customer reviews.'}</span>
          </span>
        </label>
        {field('google', fr ? 'Lien d’avis Google' : 'Google review link', 'google_review_url', { placeholder: 'https://g.page/r/…/review', hint: fr ? 'Fiche Google Business → « Obtenir plus d’avis » → copier le lien.' : 'Google Business profile → “Get more reviews” → copy the link.' })}
        {field('facebook', fr ? 'Lien d’avis Facebook' : 'Facebook review link', 'facebook_review_url', { placeholder: 'https://www.facebook.com/…/reviews' })}
      </div>
    );
  }

  if (page === 'team') {
    return (
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id={`${ids}-invite-email`}
            aria-label={fr ? 'Courriel à inviter' : 'Email to invite'}
            value={form.inviteDraft.email}
            onChange={(e) => form.setInviteDraft((d) => ({ ...d, email: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); form.addInvite(); } }}
            className={cn(inputClass, 'flex-1')}
            type="email"
            placeholder={fr ? 'courriel@exemple.com' : 'email@example.com'}
          />
          <select id={`${ids}-invite-role`} aria-label={fr ? 'Rôle' : 'Role'} value={form.inviteDraft.role} onChange={(e) => form.setInviteDraft((d) => ({ ...d, role: e.target.value as InviteRole }))} className={cn(inputClass, 'sm:w-44')}>
            {INVITE_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r, fr)}</option>)}
          </select>
          <button type="button" onClick={() => form.addInvite()} className="glass-button inline-flex items-center justify-center gap-1.5">
            <Plus size={14} /> {fr ? 'Ajouter' : 'Add'}
          </button>
        </div>
        {state.invites.length > 0 && (
          <ul className="space-y-1.5">
            {state.invites.map((inv) => (
              <li key={inv.email} className="flex items-center justify-between gap-3 rounded-xl border border-outline-subtle px-3 py-2">
                <span className="text-[13px] truncate">{inv.email}</span>
                <span className="flex items-center gap-3 shrink-0">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{roleLabel(inv.role, fr)}</span>
                  <button type="button" onClick={() => form.removeInvite(inv.email)} className="text-text-tertiary hover:text-danger" aria-label={fr ? `Retirer ${inv.email}` : `Remove ${inv.email}`}>
                    <Trash2 size={13} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {form.error && <p className="text-[13px] text-danger">{form.error}</p>}
      </div>
    );
  }

  // Récapitulatif
  const rows = (r: string[][]) => r.map(([k, v]) => [k ?? '', v ?? ''] as const).filter(([, v]) => v);
  const Summary = ({ title, target, data }: { title: string; target: WorkspacePageId; data: string[][] }) => {
    const filled = rows(data);
    return (
      <div className="rounded-xl border border-outline-subtle p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[13px] font-semibold">{title}</h4>
          {onEditPage && (
            <button type="button" onClick={() => onEditPage(target)} className="text-[12px] font-medium text-primary hover:underline">
              {fr ? 'Modifier' : 'Edit'}
            </button>
          )}
        </div>
        {filled.length === 0 ? (
          <p className="text-[12px] text-text-tertiary">{fr ? 'Rien pour l’instant — vous pourrez compléter plus tard.' : 'Nothing yet — you can complete this later.'}</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
            {filled.map(([k, v]) => (
              <React.Fragment key={k + v}>
                <dt className="text-text-tertiary">{k}</dt>
                <dd className="text-text-primary truncate">{v}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}
      </div>
    );
  };
  return (
    <div className="space-y-4">
      <Summary title={pageTitle('company', fr)} target="company" data={[
        [fr ? 'Vous' : 'You', state.full_name],
        [fr ? 'Entreprise' : 'Company', state.company_name],
        [fr ? 'Industrie' : 'Industry', state.industry ? industryLabel(state.industry) : ''],
        [fr ? 'Équipe' : 'Team', state.employee_count === '1' ? (fr ? 'Juste moi' : 'Just me') : state.employee_count],
        ['Logo', state.logo_url ? (fr ? 'Ajouté' : 'Added') : ''],
      ]} />
      <Summary title={pageTitle('contact', fr)} target="contact" data={[
        [fr ? 'Adresse' : 'Address', [state.street1, state.city, state.province, state.postal_code].filter(Boolean).join(', ')],
        [fr ? 'Téléphone' : 'Phone', state.phone],
        [fr ? 'Courriel' : 'Email', state.email],
        [fr ? 'Site web' : 'Website', state.website],
      ]} />
      <Summary title={pageTitle('preferences', fr)} target="preferences" data={[
        [fr ? 'Devise' : 'Currency', state.currency],
        [fr ? 'Fuseau horaire' : 'Timezone', state.timezone],
        [fr ? 'Objectif annuel' : 'Annual goal', state.revenue_goal ? `$${state.revenue_goal}` : ''],
      ]} />
      <Summary title={pageTitle('reviews', fr)} target="reviews" data={[
        [fr ? 'Demandes d’avis' : 'Review requests', state.review_enabled && (state.google_review_url || state.facebook_review_url) ? (fr ? 'Activées' : 'Enabled') : (fr ? 'Désactivées' : 'Disabled')],
        ['Google', state.google_review_url],
        ['Facebook', state.facebook_review_url],
      ]} />
      <Summary title={pageTitle('team', fr)} target="team" data={
        state.invites.length > 0
          ? state.invites.map((i) => [i.email, roleLabel(i.role, fr)])
          : [[fr ? 'Invitations' : 'Invites', '']]
      } />
    </div>
  );
}
