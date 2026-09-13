/**
 * OfficeNew — formulaire pleine page de création d'un bureau (/offices/new).
 *
 * Même chrome que Nouveau client (en-tête + pied de page, une boîte blanche).
 * Seul le nom est obligatoire ; coordonnées, héritage des réglages du bureau
 * actif et accès immédiat pour d'autres owners/admins sont facultatifs.
 * Réservé au propriétaire ; bloqué à la limite de bureaux du forfait.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, CreditCard, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import AddressAutocomplete, { type StructuredAddress } from '../components/AddressAutocomplete';
import LeaveFormConfirm from '../components/ui/LeaveFormConfirm';
import { useNavigationGuard } from '../contexts/NavigationGuard';
import { useCompany } from '../contexts/CompanyContext';
import { useTranslation } from '../i18n';
import {
  createOffice,
  listGrantableMembers,
  listOffices,
  type GrantableMember,
  type OfficeInherit,
  type OfficesListing,
} from '../lib/officesApi';

const fieldLabel = 'text-xs font-medium text-text-tertiary';

const DEFAULT_INHERIT: OfficeInherit = {
  branding: true,
  taxes: true,
  email_templates: true,
  tags_sources: true,
};

export default function OfficeNew() {
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const { current, currentRole } = useCompany();
  const sourceName = current?.companyName || (fr ? 'bureau actuel' : 'current office');

  // ── Form state ──
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [addressSearch, setAddressSearch] = useState('');
  const [street1, setStreet1] = useState('');
  const [street2, setStreet2] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('');
  const [inherit, setInherit] = useState<OfficeInherit>(DEFAULT_INHERIT);
  const [members, setMembers] = useState<GrantableMember[]>([]);
  const [grant, setGrant] = useState<Set<string>>(new Set());
  const [listing, setListing] = useState<OfficesListing | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [saving, setSaving] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  // ── Unsaved-changes guard (pattern maison) ──
  const [dirty, setDirty] = useState(false);
  const guard = useNavigationGuard(dirty && !saving);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // ── Quota + membres candidats ──
  useEffect(() => {
    let active = true;
    Promise.all([
      listOffices().catch(() => null),
      listGrantableMembers().catch(() => [] as GrantableMember[]),
    ]).then(([l, m]) => {
      if (!active) return;
      setListing(l);
      setMembers(m);
    }).finally(() => { if (active) setLoadingMeta(false); });
    return () => { active = false; };
  }, []);

  const isOwner = currentRole === 'owner';
  const atLimit = !!listing && !listing.can_create;
  const canSubmit = isOwner && !atLimit && !loadingMeta && !saving;

  const onAddressSelect = (a: StructuredAddress) => {
    setAddressSearch(a.formatted_address);
    setStreet1([a.street_number, a.street_name].filter(Boolean).join(' '));
    setCity(a.city);
    setProvince(a.province);
    setPostalCode(a.postal_code);
    setCountry(a.country);
    setDirty(true);
  };

  const toggleGrant = (id: string) => {
    setGrant((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const inheritOptions = useMemo(() => ([
    {
      key: 'branding' as const,
      label: fr ? 'Logo, site web, devise et fuseau horaire' : 'Logo, website, currency and timezone',
      hint: fr ? 'Identité et préférences de base.' : 'Identity and base preferences.',
    },
    {
      key: 'taxes' as const,
      label: fr ? 'Taxes' : 'Taxes',
      hint: fr ? 'Taux et groupes de taxes, groupe par défaut.' : 'Tax rates and groups, default group.',
    },
    {
      key: 'email_templates' as const,
      label: fr ? 'Modèles de courriel' : 'Email templates',
      hint: fr ? 'Envoi de devis, factures, rappels, demandes d\'avis.' : 'Quote, invoice, reminder and review-request emails.',
    },
    {
      key: 'tags_sources' as const,
      label: fr ? 'Étiquettes de jobs et sources de leads' : 'Job tags and lead sources',
      hint: fr ? 'Listes utilisées dans les formulaires.' : 'Lists used across the forms.',
    },
  ]), [fr]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInlineError(null);
    if (!name.trim()) {
      setInlineError(fr ? 'Le nom du bureau est requis.' : 'Office name is required.');
      return;
    }
    if (!canSubmit) return;
    setSaving(true);
    try {
      const hasAddress = [street1, street2, city, province, postalCode, country].some((v) => v.trim());
      const { office } = await createOffice({
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        website: website.trim() || undefined,
        address: hasAddress
          ? {
            street1: street1.trim(),
            street2: street2.trim(),
            city: city.trim(),
            province: province.trim(),
            postal_code: postalCode.trim(),
            country: country.trim(),
          }
          : null,
        inherit,
        grant_user_ids: Array.from(grant),
      });
      // Le créateur est owner du nouveau bureau : on l'active et on recharge
      // sur la liste des bureaux (changement de tenant = rechargement complet).
      guard.release();
      setDirty(false);
      try { localStorage.setItem('lume-active-org', office.id); } catch {}
      window.location.assign('/settings/offices');
    } catch (err: any) {
      if (err?.code === 'office_limit_reached') {
        setInlineError(fr
          ? `Limite de bureaux atteinte — votre forfait en inclut ${err.capacity}. Ajoutez un bureau depuis Forfait & facturation.`
          : err.message);
      } else {
        setInlineError(err?.message || (fr ? 'Échec de la création.' : 'Failed to create office.'));
      }
      toast.error(fr ? 'Le bureau n\'a pas été créé.' : 'Office was not created.');
      setSaving(false);
    }
  };

  const cancel = () => navigate('/settings/offices');

  return (
    <div
      className="item-form relative min-h-full bg-surface flex flex-col text-text-primary"
      onInput={(e) => { if (e.nativeEvent.isTrusted) setDirty(true); }}
      onChange={(e) => { if (e.nativeEvent.isTrusted) setDirty(true); }}
    >
      {/* ── Header ── */}
      <div className="relative px-6 pt-6 pb-2">
        <h2 className="text-[30px] font-extrabold tracking-tight text-text-primary leading-tight text-center">
          {fr ? 'Nouveau bureau' : 'New office'}
        </h2>
        <p className="text-center text-[13px] text-text-tertiary mt-1">
          {fr ? `Créé dans la même compagnie que « ${sourceName} »` : `Created in the same company as “${sourceName}”`}
        </p>
        <button
          type="button"
          onClick={cancel}
          aria-label={t.common.cancel}
          className="absolute right-6 top-6 p-2 rounded-xl border border-outline hover:bg-surface-secondary transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      <form id="new-office-form" onSubmit={handleSubmit} className="flex-1 px-6 py-8">
        <div className="max-w-2xl mx-auto rounded-xl border border-border bg-surface-card p-6 space-y-8">

          {/* Garde-fous : rôle + quota */}
          {!isOwner && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-[13px] text-amber-700">
              {fr
                ? 'Seul le propriétaire de la compagnie peut créer un bureau.'
                : 'Only the company owner can create an office.'}
            </div>
          )}
          {isOwner && atLimit && listing && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-center justify-between gap-3">
              <p className="text-[13px] text-amber-700">
                {fr
                  ? `Votre forfait inclut ${listing.capacity} bureau${listing.capacity > 1 ? 'x' : ''} (${listing.used} utilisé${listing.used > 1 ? 's' : ''}).`
                  : `Your plan includes ${listing.capacity} office${listing.capacity > 1 ? 's' : ''} (${listing.used} used).`}
              </p>
              <button type="button" onClick={() => navigate('/settings/billing')} className="glass-button inline-flex items-center gap-2 shrink-0">
                <CreditCard size={14} />
                {fr ? 'Ajouter un bureau' : 'Add an office'}
              </button>
            </div>
          )}

          {/* Identité */}
          <section className="space-y-4">
            <SectionTitle icon={Building2} title={fr ? 'Identité' : 'Identity'} />
            <div className="space-y-2">
              <label className={fieldLabel}>{fr ? 'Nom du bureau' : 'Office name'} <span className="text-danger">*</span></label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="glass-input w-full"
                placeholder={fr ? 'Bureau de Laval' : 'Laval office'}
                maxLength={120}
              />
            </div>
          </section>

          {/* Coordonnées (facultatif) */}
          <section className="space-y-4">
            <SectionTitle
              title={fr ? 'Coordonnées' : 'Contact details'}
              optional={fr ? 'facultatif' : 'optional'}
            />
            <div className="space-y-2">
              <label className={fieldLabel}>{fr ? 'Adresse' : 'Address'}</label>
              <AddressAutocomplete
                value={addressSearch}
                onChange={setAddressSearch}
                onSelect={onAddressSelect}
                className="glass-input w-full"
                placeholder={fr ? 'Rechercher une adresse…' : 'Search an address…'}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className={fieldLabel}>{fr ? 'Rue' : 'Street'}</label>
                <input value={street1} onChange={(e) => setStreet1(e.target.value)} className="glass-input w-full" />
              </div>
              <div className="space-y-2">
                <label className={fieldLabel}>{fr ? 'Bureau / suite' : 'Unit / suite'}</label>
                <input value={street2} onChange={(e) => setStreet2(e.target.value)} className="glass-input w-full" />
              </div>
              <div className="space-y-2">
                <label className={fieldLabel}>{fr ? 'Ville' : 'City'}</label>
                <input value={city} onChange={(e) => setCity(e.target.value)} className="glass-input w-full" />
              </div>
              <div className="space-y-2">
                <label className={fieldLabel}>{fr ? 'Province / État' : 'Province / State'}</label>
                <input value={province} onChange={(e) => setProvince(e.target.value)} className="glass-input w-full" />
              </div>
              <div className="space-y-2">
                <label className={fieldLabel}>{fr ? 'Code postal' : 'Postal code'}</label>
                <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} className="glass-input w-full" />
              </div>
              <div className="space-y-2">
                <label className={fieldLabel}>{fr ? 'Pays' : 'Country'}</label>
                <input value={country} onChange={(e) => setCountry(e.target.value)} className="glass-input w-full" placeholder="CA" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className={fieldLabel}>{fr ? 'Téléphone' : 'Phone'}</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className="glass-input w-full" type="tel" />
              </div>
              <div className="space-y-2">
                <label className={fieldLabel}>{fr ? 'Courriel' : 'Email'}</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} className="glass-input w-full" type="email" />
              </div>
            </div>
            <div className="space-y-2">
              <label className={fieldLabel}>{fr ? 'Site web' : 'Website'}</label>
              <input value={website} onChange={(e) => setWebsite(e.target.value)} className="glass-input w-full" placeholder="https://" />
            </div>
          </section>

          {/* Héritage */}
          <section className="space-y-4">
            <SectionTitle
              title={fr ? `Hériter de « ${sourceName} »` : `Inherit from “${sourceName}”`}
              optional={fr ? 'facultatif' : 'optional'}
            />
            <div className="space-y-3">
              {inheritOptions.map((opt) => (
                <label key={opt.key} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inherit[opt.key]}
                    onChange={(e) => setInherit((prev) => ({ ...prev, [opt.key]: e.target.checked }))}
                    className="h-4 w-4 mt-0.5 rounded"
                  />
                  <span>
                    <span className="block text-[13px] font-medium text-text-primary">{opt.label}</span>
                    <span className="text-[12px] text-text-tertiary">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="text-[12px] text-text-tertiary">
              {fr
                ? 'Le catalogue produits/services est déjà partagé entre tous les bureaux. Les automatisations sont installées automatiquement.'
                : 'The products/services catalogue is already shared across offices. Automations are installed automatically.'}
            </p>
          </section>

          {/* Accès */}
          <section className="space-y-4">
            <SectionTitle
              title={fr ? 'Accès' : 'Access'}
              optional={fr ? 'facultatif' : 'optional'}
            />
            <p className="text-[12px] text-text-secondary">
              {fr
                ? 'Vous serez propriétaire de ce bureau. Donnez aussi un accès immédiat à d\'autres propriétaires ou administrateurs du bureau actuel (même rôle).'
                : 'You will own this office. Optionally give immediate access to other owners or admins of the current office (same role).'}
            </p>
            {members.length === 0 ? (
              <p className="text-[12px] text-text-tertiary">
                {fr
                  ? 'Aucun autre propriétaire ou administrateur dans le bureau actuel. Vous pourrez inviter des membres après la création.'
                  : 'No other owner or admin in the current office. You can invite members after creation.'}
              </p>
            ) : (
              <div className="space-y-2">
                {members.map((m) => (
                  <label key={m.user_id} className="flex items-center gap-3 cursor-pointer rounded-xl border border-outline-subtle px-3 py-2.5 hover:bg-surface-secondary transition-colors">
                    <input
                      type="checkbox"
                      checked={grant.has(m.user_id)}
                      onChange={() => toggleGrant(m.user_id)}
                      className="h-4 w-4 rounded"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-medium text-text-primary truncate">
                        {m.full_name || m.email || m.user_id}
                      </span>
                      {m.email && m.full_name && (
                        <span className="block text-[12px] text-text-tertiary truncate">{m.email}</span>
                      )}
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary shrink-0">
                      {m.role === 'owner' ? (fr ? 'Propriétaire' : 'Owner') : 'Admin'}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </section>
        </div>
      </form>

      {/* ── Footer ── */}
      <div className="sticky bottom-0 z-10 px-6 py-4 border-t border-border bg-surface flex items-center justify-between gap-4">
        <p className="text-[13px] text-danger min-h-[1rem]">{inlineError || ''}</p>
        <div className="flex items-center gap-3 shrink-0">
          <button type="button" onClick={cancel} className="glass-button">
            {t.common.cancel}
          </button>
          <button
            form="new-office-form"
            type="submit"
            disabled={!canSubmit}
            className="glass-button-primary inline-flex items-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {saving ? (fr ? 'Création…' : 'Creating…') : (fr ? 'Créer le bureau' : 'Create office')}
          </button>
        </div>
      </div>

      <LeaveFormConfirm open={guard.active} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} />
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  optional,
}: {
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  optional?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {Icon && <Icon size={15} className="text-text-tertiary" />}
      <h3 className="text-[14px] font-semibold text-text-primary">{title}</h3>
      {optional && (
        <span className="text-[11px] font-medium text-text-tertiary">· {optional}</span>
      )}
    </div>
  );
}
