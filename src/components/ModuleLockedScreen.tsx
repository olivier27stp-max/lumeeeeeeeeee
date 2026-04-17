import { Lock, Loader2 } from 'lucide-react';
import { useTranslation } from '../i18n';

interface ModuleLockedScreenProps {
  /** Module display name — e.g. "Vente", "Dispatch" */
  moduleName: string;
  /** Called when user clicks activate — should call the activate function from useModuleAccess */
  onActivate: () => void;
  /** Whether activation is in progress */
  activating?: boolean;
  /** Whether the current user can activate (admin/owner) */
  canActivate?: boolean;
}

export default function ModuleLockedScreen({
  moduleName,
  onActivate,
  activating = false,
  canActivate = true,
}: ModuleLockedScreenProps) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="flex flex-col items-center text-center max-w-md">
        {/* Lock icon */}
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-surface-secondary mb-6">
          <Lock size={36} className="text-text-tertiary" />
        </div>

        {/* Title */}
        <h1 className="text-xl font-bold text-text-primary mb-2">
          {moduleName} — {t.moduleLock.locked}
        </h1>

        {/* Description */}
        <p className="text-sm text-text-secondary mb-8 leading-relaxed">
          {t.moduleLock.description}
        </p>

        {/* Action */}
        {canActivate ? (
          <button
            type="button"
            onClick={onActivate}
            disabled={activating}
            className="glass-button-primary inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium"
          >
            {activating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {t.moduleLock.activating}
              </>
            ) : (
              <>
                <Lock size={16} />
                {t.moduleLock.activate}
              </>
            )}
          </button>
        ) : (
          <p className="text-xs text-text-tertiary italic">
            {t.moduleLock.adminOnly}
          </p>
        )}
      </div>
    </div>
  );
}
