import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Check, Plus, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { useCompany } from '../contexts/CompanyContext';
import { useTranslation } from '../i18n';

/**
 * Office switcher pour le header.
 * - owner/admin avec plusieurs offices → dropdown pour basculer.
 * - sales_rep/technician → seulement s'ils ont accès à plusieurs offices.
 * Le propriétaire peut créer un nouvel office depuis le pied du dropdown :
 * la création se fait sur la page pleine /offices/new (coordonnées, héritage
 * des réglages, accès) — l'ancienne modale « nom seulement » a été retirée.
 */
export function OfficeSwitcher() {
  const navigate = useNavigate();
  const { companies, current, currentRole, switchCompany } = useCompany();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [open, setOpen] = React.useState(false);

  if (!current) return null;

  const officeName = current.companyName || (fr ? 'Bureau sans nom' : 'Unnamed office');
  // Owner/admin voient toujours le sélecteur. Un représentant ou technicien
  // le voit dès qu'on lui a donné plus d'un bureau (Réglages → Bureaux →
  // Accès) ; avec un seul bureau, rien dans le header.
  const canSwitch = currentRole === 'owner' || currentRole === 'admin' || companies.length > 1;
  const canCreate = currentRole === 'owner';

  if (!canSwitch) return null;

  // Bascule d'office = changement de tenant complet. On persiste l'office
  // choisi puis on recharge entièrement la page : aucune donnée de l'ancien
  // office ne peut subsister à l'écran (isolation 100% garantie).
  const goToOffice = (orgId: string) => {
    setOpen(false);
    if (orgId === current.orgId) return;
    switchCompany(orgId); // valide la membership + persiste lume-active-org
    window.location.assign('/');
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 pl-2 pr-1.5 py-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-tertiary transition-all max-w-[220px]"
        title={fr ? `${officeName} — changer de bureau` : `${officeName} — switch office`}
      >
        <Building2 size={16} strokeWidth={1.75} className="flex-shrink-0 text-text-tertiary" />
        <span className="min-w-0 truncate text-sm font-medium">{officeName}</span>
        <ChevronDown
          size={15}
          strokeWidth={2}
          className={cn('flex-shrink-0 text-text-tertiary transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" role="presentation" tabIndex={-1} onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 w-64 bg-surface-elevated border border-outline rounded-xl shadow-lg z-50 py-1 max-h-72 overflow-y-auto">
            <div className="px-3 py-2 text-xs font-medium text-text-tertiary uppercase tracking-wider">
              {fr ? 'Changer de bureau' : 'Switch office'}
            </div>
            {companies.map((office) => (
              <button
                key={office.orgId}
                onClick={() => goToOffice(office.orgId)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-primary/5 transition-colors',
                  office.orgId === current.orgId && 'bg-primary/5'
                )}
              >
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-4 h-4 text-primary" />
                </div>
                <span className="flex-1 min-w-0 text-xs font-medium text-text-primary truncate">
                  {office.companyName || (fr ? 'Bureau sans nom' : 'Unnamed office')}
                </span>
                {office.orgId === current.orgId && (
                  <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                )}
              </button>
            ))}

            {canCreate && (
              <>
                <div className="my-1 border-t border-border" />
                <button
                  onClick={() => {
                    setOpen(false);
                    navigate('/offices/new');
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-primary/5 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Plus className="w-4 h-4 text-primary" />
                  </div>
                  <span className="text-xs font-medium text-primary">
                    {fr ? 'Créer un bureau' : 'Create office'}
                  </span>
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
