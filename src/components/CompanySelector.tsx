import React from 'react';
import { Building2, ChevronRight, Shield } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import type { CompanyMembership } from '../contexts/CompanyContext';
import { useCompany } from '../contexts/CompanyContext';
import { useTranslation } from '../i18n';

// ── Full-page selector (shown after login when user has multiple companies) ──

export function CompanySelectorPage() {
  const { companies, switchCompany, loading } = useCompany();
  const { t, language } = useTranslation();
  const fr = language === 'fr';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-3">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-6 h-6 border-2 border-outline border-t-text-primary rounded-full"
          />
          <span className="text-xs text-text-tertiary font-medium">
            {fr ? 'Chargement des compagnies…' : 'Loading companies…'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-4">
            <Building2 className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary">
            {fr ? 'Choisir une compagnie' : 'Choose a company'}
          </h1>
          <p className="text-sm text-text-secondary mt-2">
            {fr
              ? 'Vous avez accès à plusieurs compagnies. Sélectionnez celle dans laquelle vous souhaitez travailler.'
              : 'You have access to multiple companies. Select the one you want to work in.'}
          </p>
        </div>

        {/* Company list */}
        <div className="space-y-3">
          {companies.map((company) => (
            <CompanyCard
              key={company.orgId}
              company={company}
              onClick={() => switchCompany(company.orgId)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Company card ──────────────────────────────────────────────────────

function CompanyCard({ company, onClick, isActive }: {
  company: CompanyMembership;
  onClick: () => void;
  isActive?: boolean;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';

  const roleLabel = getRoleLabel(company.role, fr);

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      className={cn(
        'w-full flex items-center gap-4 p-4 rounded-xl border transition-colors text-left',
        isActive
          ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
          : 'border-outline bg-surface-raised hover:border-primary/40 hover:bg-primary/5'
      )}
    >
      {/* Icon */}
      <div className="flex-shrink-0 w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
        <Building2 className="w-5 h-5 text-primary" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary truncate">
          {company.companyName || (fr ? 'Compagnie sans nom' : 'Unnamed company')}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
            <Shield className="w-3 h-3" />
            {roleLabel}
          </span>
        </div>
      </div>

      {/* Arrow */}
      <ChevronRight className="w-4 h-4 text-text-tertiary flex-shrink-0" />
    </motion.button>
  );
}

// ── Sidebar switcher (dropdown for switching when already in app) ────

export function CompanySwitcher() {
  const { companies, current, switchCompany, isMultiCompany } = useCompany();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [open, setOpen] = React.useState(false);

  if (!isMultiCompany || !current) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-primary/5 transition-colors"
      >
        <Building2 className="w-4 h-4 text-primary flex-shrink-0" />
        <span className="text-xs font-medium text-text-primary truncate flex-1">
          {current.companyName || (fr ? 'Compagnie' : 'Company')}
        </span>
        <ChevronRight className={cn('w-3 h-3 text-text-tertiary transition-transform', open && 'rotate-90')} />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          {/* Dropdown */}
          <div className="absolute left-0 bottom-full mb-1 w-64 bg-surface-raised border border-outline rounded-xl shadow-lg z-50 py-1 max-h-64 overflow-y-auto">
            <div className="px-3 py-2 text-xs font-medium text-text-tertiary uppercase tracking-wider">
              {fr ? 'Changer de compagnie' : 'Switch company'}
            </div>
            {companies.map((company) => (
              <button
                key={company.orgId}
                onClick={() => {
                  switchCompany(company.orgId);
                  setOpen(false);
                }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-primary/5 transition-colors',
                  company.orgId === current.orgId && 'bg-primary/5'
                )}
              >
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-text-primary truncate">
                    {company.companyName || (fr ? 'Compagnie sans nom' : 'Unnamed company')}
                  </p>
                  <p className="text-[10px] text-text-tertiary">
                    {getRoleLabel(company.role, fr)}
                  </p>
                </div>
                {company.orgId === current.orgId && (
                  <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── No company state ─────────────────────────────────────────────────

export function NoCompanyState() {
  const { language } = useTranslation();
  const fr = language === 'fr';

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="text-center max-w-sm">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-500/10 mb-4">
          <Building2 className="w-7 h-7 text-amber-500" />
        </div>
        <h1 className="text-xl font-bold text-text-primary">
          {fr ? 'Aucune compagnie' : 'No company found'}
        </h1>
        <p className="text-sm text-text-secondary mt-2">
          {fr
            ? 'Votre compte n\'est associé à aucune compagnie. Contactez votre administrateur ou attendez une invitation.'
            : 'Your account is not associated with any company. Contact your administrator or wait for an invitation.'}
        </p>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function getRoleLabel(role: string, fr: boolean): string {
  const labels: Record<string, { en: string; fr: string }> = {
    owner: { en: 'Owner', fr: 'Propriétaire' },
    admin: { en: 'Admin', fr: 'Administrateur' },
    manager: { en: 'Manager', fr: 'Gestionnaire' },
    sales_rep: { en: 'Sales Rep', fr: 'Représentant' },
    technician: { en: 'Technician', fr: 'Technicien' },
    support: { en: 'Support', fr: 'Support' },
    viewer: { en: 'Viewer', fr: 'Lecteur' },
  };
  const entry = labels[role];
  return entry ? (fr ? entry.fr : entry.en) : role;
}
