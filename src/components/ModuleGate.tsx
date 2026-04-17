import React from 'react';
import { useModuleAccess } from '../hooks/useModuleAccess';
import { useCompany } from '../contexts/CompanyContext';
import ModuleLockedScreen from './ModuleLockedScreen';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';

interface ModuleGateProps {
  /** Feature key in org_features table — e.g. 'module_vente' */
  moduleKey: string;
  /** Display name shown on locked screen */
  moduleName: string;
  /** Content to render when module is active */
  children: React.ReactNode;
}

/**
 * Wraps children behind a module activation gate.
 * If the module is not enabled for the current org, shows a locked screen.
 * If enabled, renders children normally.
 */
export default function ModuleGate({ moduleKey, moduleName, children }: ModuleGateProps) {
  const { t } = useTranslation();
  const { isEnabled, loading, activate, activating } = useModuleAccess(moduleKey);
  const { currentRole } = useCompany();
  const canActivate = currentRole === 'owner' || currentRole === 'admin';

  if (loading) {
    return null; // Parent layout already shows loading state
  }

  if (!isEnabled) {
    return (
      <ModuleLockedScreen
        moduleName={moduleName}
        activating={activating}
        canActivate={canActivate}
        onActivate={async () => {
          const ok = await activate();
          if (ok) {
            toast.success(t.moduleLock.activated);
          } else {
            toast.error(t.moduleLock.failedActivate);
          }
        }}
      />
    );
  }

  return <>{children}</>;
}
