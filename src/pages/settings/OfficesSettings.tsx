/**
 * Réglages → Bureaux — liste des bureaux de la compagnie.
 *
 * Un bureau = un org du même company_group. La liste est résolue côté
 * serveur (un admin n'est membre que de son bureau). Modifier un bureau =
 * y basculer puis Réglages → Entreprise (company_settings est déjà par bureau).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Check, CreditCard, Loader2, MapPin, Plus, Users } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useCompany } from '../../contexts/CompanyContext';
import { useTranslation } from '../../i18n';
import { listOffices, type OfficesListing, type OfficeSummary } from '../../lib/officesApi';
import EmptyState from '../../components/ui/EmptyState';

export default function OfficesSettings() {
  const navigate = useNavigate();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const { current, switchCompany } = useCompany();

  const [data, setData] = useState<OfficesListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    listOffices()
      .then((d) => { if (active) setData(d); })
      .catch((e: any) => { if (active) setError(e?.message || 'error'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  // Bascule = changement de tenant complet → rechargement (même règle que
  // le switcher du header : aucune donnée de l'ancien bureau ne survit).
  const openOffice = (office: OfficeSummary) => {
    if (!office.is_member) return;
    if (current && office.id === current.orgId) return;
    switchCompany(office.id);
    window.location.assign('/');
  };

  const addressLine = (o: OfficeSummary) =>
    [o.street1, o.city, o.province].filter(Boolean).join(', ');

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-tertiary py-10">
        <Loader2 size={16} className="animate-spin" />
        {fr ? 'Chargement des bureaux…' : 'Loading offices…'}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-2xl">
        <EmptyState
          icon={Building2}
          title={fr ? 'Bureaux indisponibles' : 'Offices unavailable'}
          description={fr
            ? 'Seuls les propriétaires et administrateurs peuvent voir les bureaux de la compagnie.'
            : 'Only owners and admins can see the company offices.'}
        />
      </div>
    );
  }

  const atLimit = data.used >= data.capacity;
  const isOwner = data.caller_role === 'owner';

  return (
    <div className="max-w-2xl space-y-5">
      {/* En-tête : compteur + action */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-text-primary">
            {fr ? 'Bureaux' : 'Offices'}
          </h2>
          <p className="text-[12px] text-text-tertiary mt-0.5">
            {data.used} / {data.capacity} {fr
              ? `bureau${data.capacity > 1 ? 'x' : ''} utilisé${data.used > 1 ? 's' : ''}`
              : `office${data.capacity > 1 ? 's' : ''} used`}
            {' · '}
            {fr
              ? 'Chaque bureau garde ses clients, jobs et réglages séparés.'
              : 'Each office keeps its own clients, jobs and settings.'}
          </p>
        </div>
        {isOwner && (
          data.can_create ? (
            <button
              type="button"
              onClick={() => navigate('/offices/new')}
              className="glass-button-primary inline-flex items-center gap-2 shrink-0"
            >
              <Plus size={14} />
              {fr ? 'Nouveau bureau' : 'New office'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/settings/billing')}
              className="glass-button inline-flex items-center gap-2 shrink-0"
              title={fr ? 'Limite du forfait atteinte' : 'Plan limit reached'}
            >
              <CreditCard size={14} />
              {fr ? 'Ajouter un bureau au forfait' : 'Add an office to the plan'}
            </button>
          )
        )}
      </div>

      {atLimit && isOwner && (
        <p className="text-[12px] text-amber-600 font-medium">
          {fr
            ? `Votre forfait inclut ${data.capacity} bureau${data.capacity > 1 ? 'x' : ''}. Ajoutez-en un depuis Forfait & facturation pour en créer un nouveau.`
            : `Your plan includes ${data.capacity} office${data.capacity > 1 ? 's' : ''}. Add one from Plan & billing to create another.`}
        </p>
      )}

      {/* Liste */}
      <div className="space-y-2">
        {data.offices.map((o) => {
          const isCurrent = current?.orgId === o.id;
          const clickable = o.is_member && !isCurrent;
          return (
            <div
              key={o.id}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : -1}
              onClick={() => clickable && openOffice(o)}
              onKeyDown={(e) => { if (clickable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openOffice(o); } }}
              className={cn(
                'rounded-2xl p-4 bg-surface-card border border-outline-subtle flex items-center gap-3 transition-colors',
                clickable && 'cursor-pointer hover:bg-surface-secondary',
                isCurrent && 'border-primary/40 bg-primary/5',
              )}
            >
              <div className="shrink-0 w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Building2 size={17} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[14px] font-semibold text-text-primary truncate">
                    {o.name || (fr ? 'Bureau sans nom' : 'Unnamed office')}
                  </p>
                  {o.is_primary && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-sky-500/10 text-sky-700">
                      {fr ? 'Principal' : 'Primary'}
                    </span>
                  )}
                  {isCurrent && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">
                      {fr ? 'Actuel' : 'Current'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[12px] text-text-secondary">
                  <span className="inline-flex items-center gap-1 min-w-0">
                    <MapPin size={12} className="shrink-0 text-text-tertiary" />
                    <span className="truncate">
                      {addressLine(o) || (fr ? 'Aucune adresse' : 'No address')}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1 shrink-0">
                    <Users size={12} className="text-text-tertiary" />
                    {o.member_count} {fr ? (o.member_count === 1 ? 'membre' : 'membres') : (o.member_count === 1 ? 'member' : 'members')}
                  </span>
                </div>
              </div>
              <div className="shrink-0 text-[12px] font-medium">
                {isCurrent ? (
                  <Check size={16} className="text-primary" />
                ) : o.is_member ? (
                  <span className="text-primary">{fr ? 'Ouvrir' : 'Open'}</span>
                ) : (
                  <span className="text-text-tertiary">{fr ? 'Pas membre' : 'Not a member'}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[12px] text-text-tertiary">
        {fr
          ? 'Pour modifier le nom, l\'adresse ou le logo d\'un bureau : ouvrez-le puis allez dans Réglages → Entreprise.'
          : 'To edit an office\'s name, address or logo: open it, then go to Settings → Business.'}
      </p>

      {/* Nouveau workspace = compagnie séparée (données, bureaux, abonnement). */}
      {isOwner && (
        <div className="rounded-2xl p-4 border border-dashed border-outline flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-text-primary">
              {fr ? 'Une autre compagnie ?' : 'Another company?'}
            </p>
            <p className="text-[12px] text-text-secondary mt-0.5">
              {fr
                ? 'Un nouveau workspace est une compagnie séparée : ses propres bureaux, données et abonnement.'
                : 'A new workspace is a separate company: its own offices, data and subscription.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/workspaces/new')}
            className="glass-button inline-flex items-center gap-2 shrink-0"
          >
            <Plus size={14} />
            {fr ? 'Nouveau workspace' : 'New workspace'}
          </button>
        </div>
      )}
    </div>
  );
}
