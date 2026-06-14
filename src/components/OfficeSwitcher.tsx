import React from 'react';
import { Building2, Check, Plus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { useCompany } from '../contexts/CompanyContext';
import { useTranslation } from '../i18n';
import { createOffice } from '../lib/officesApi';

/**
 * Office switcher pour le header de Messages.
 * - owner/admin avec plusieurs offices → dropdown pour basculer.
 * - rôles mono-office (sales_rep/technician) → pill statique (nom de l'office).
 * Le propriétaire peut créer un nouvel office depuis le pied du dropdown.
 */
export function OfficeSwitcher() {
  const { companies, current, currentRole, switchCompany } = useCompany();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [open, setOpen] = React.useState(false);
  const [showCreate, setShowCreate] = React.useState(false);

  if (!current) return null;

  const officeName = current.companyName || (fr ? 'Bureau sans nom' : 'Unnamed office');
  // Seuls owner et admin peuvent changer d'office. Les autres rôles
  // (sales_rep, technician) sont épinglés à l'office qui leur est assigné →
  // on n'affiche rien dans le header pour eux.
  const canSwitch = currentRole === 'owner' || currentRole === 'admin';
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
        className="p-2 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-all"
        title={fr ? `${officeName} — changer de bureau` : `${officeName} — switch office`}
      >
        <Building2 size={17} strokeWidth={1.75} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-64 bg-surface-raised border border-outline rounded-xl shadow-lg z-50 py-1 max-h-72 overflow-y-auto">
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
                    setShowCreate(true);
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

      {showCreate && (
        <CreateOfficeModal
          fr={fr}
          onClose={() => setShowCreate(false)}
          onCreated={(orgId) => {
            setShowCreate(false);
            // Le créateur devient owner du nouvel office. On l'active puis on
            // recharge pour atterrir dessus avec des données fraîches.
            try { localStorage.setItem('lume-active-org', orgId); } catch {}
            window.location.assign('/');
          }}
        />
      )}
    </div>
  );
}

// ── Modal de création d'office ──────────────────────────────────────

function CreateOfficeModal({
  fr,
  onClose,
  onCreated,
}: {
  fr: boolean;
  onClose: () => void;
  onCreated: (orgId: string) => void;
}) {
  const [name, setName] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error(fr ? 'Le nom du bureau est requis.' : 'Office name is required.');
      return;
    }
    setSaving(true);
    try {
      const { office } = await createOffice(name.trim());
      toast.success(fr ? 'Bureau créé' : 'Office created');
      onCreated(office.id);
    } catch (err: any) {
      toast.error(err.message || (fr ? 'Échec de la création.' : 'Failed to create office.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-surface-raised border border-outline rounded-2xl shadow-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-text-primary">
            {fr ? 'Créer un bureau' : 'Create office'}
          </h3>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <label className="text-xs font-medium text-text-tertiary">
          {fr ? 'Nom du bureau' : 'Office name'}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          className="glass-input w-full mt-1.5"
          placeholder={fr ? 'Bureau de Montréal' : 'Montreal Office'}
          autoFocus
        />

        <div className="flex items-center justify-end gap-2.5 pt-4 mt-4 border-t border-border">
          <button className="glass-button-ghost" onClick={onClose}>
            {fr ? 'Annuler' : 'Cancel'}
          </button>
          <button
            className="glass-button-primary inline-flex items-center gap-2"
            onClick={handleCreate}
            disabled={saving}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            {saving ? (fr ? 'Création…' : 'Creating…') : (fr ? 'Créer' : 'Create')}
          </button>
        </div>
      </div>
    </div>
  );
}
