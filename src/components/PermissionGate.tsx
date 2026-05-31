import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions';
import { type PermissionKey, hasPermission } from '../lib/permissions';
import { useTranslation } from '../i18n';

interface PermissionGateProps {
  permission: PermissionKey;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

const DefaultFallback: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-danger/10 flex items-center justify-center mb-4">
        <ShieldAlert size={24} className="text-danger" />
      </div>
      <h2 className="text-[16px] font-bold text-text-primary mb-1">
        {t.permissions.accessRestricted}
      </h2>
      <p className="text-[13px] text-text-tertiary max-w-sm">
        {t.permissions.noPermissionMessage}
      </p>
    </div>
  );
};

export default function PermissionGate({ permission, children, fallback }: PermissionGateProps) {
  const { permissions, loading } = usePermissions();

  if (loading) return null;

  if (hasPermission(permissions, permission)) {
    return <>{children}</>;
  }

  return <>{fallback ?? <DefaultFallback />}</>;
}
