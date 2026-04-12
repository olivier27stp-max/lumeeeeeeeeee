import React, { useState } from 'react';
import { useTranslation } from '../i18n';
import { cn } from '../lib/utils';
import { Shield, ChevronDown, ChevronRight } from 'lucide-react';
import {
  ALL_ROLES, ROLE_LABELS, ROLE_PRESETS, PERMISSION_GROUPS,
  type TeamRole, type PermissionKey,
  DEFAULT_SCOPE, SCOPE_LABELS,
} from '../lib/permissions';
import PermissionGate from '../components/PermissionGate';

export default function SettingsRoles() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [selectedRole, setSelectedRole] = useState<TeamRole>('sales_rep');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const preset = ROLE_PRESETS[selectedRole];

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const enabledCount = Object.values(preset).filter(Boolean).length;
  const totalCount = Object.keys(preset).length;

  return (
    <PermissionGate permission="users.update_role">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Shield size={20} className="text-accent" />
            {fr ? 'Rôles & Permissions' : 'Roles & Permissions'}
          </h2>
          <p className="text-xs text-text-tertiary mt-1">
            {fr ? 'Configurez les permissions par défaut de chaque rôle.' : 'Configure the default permissions for each role.'}
          </p>
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* Left: Role list */}
          <div className="col-span-4 space-y-1">
            {ALL_ROLES.map((role) => {
              const label = fr ? ROLE_LABELS[role].fr : ROLE_LABELS[role].en;
              const scope = DEFAULT_SCOPE[role];
              const scopeLabel = fr ? SCOPE_LABELS[scope].fr : SCOPE_LABELS[scope].en;
              const active = selectedRole === role;
              return (
                <button
                  key={role}
                  onClick={() => setSelectedRole(role)}
                  className={cn(
                    'w-full flex items-center justify-between px-4 py-3 rounded-lg text-left transition-colors',
                    active ? 'bg-accent/10 border border-accent/20' : 'hover:bg-bg-secondary border border-transparent'
                  )}
                >
                  <div>
                    <p className={cn('text-[13px] font-semibold', active ? 'text-accent' : 'text-text-primary')}>{label}</p>
                    <p className="text-[10px] text-text-tertiary mt-0.5">{fr ? 'Scope' : 'Scope'}: {scopeLabel}</p>
                  </div>
                  {role === 'owner' && (
                    <span className="text-[9px] font-medium bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded">FULL</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Right: Permission groups */}
          <div className="col-span-8 space-y-2">
            {/* Summary */}
            <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-bg-secondary border border-border">
              <div>
                <p className="text-[13px] font-semibold text-text-primary">
                  {fr ? ROLE_LABELS[selectedRole].fr : ROLE_LABELS[selectedRole].en}
                </p>
                <p className="text-[11px] text-text-tertiary">
                  {enabledCount}/{totalCount} {fr ? 'permissions activées' : 'permissions enabled'}
                </p>
              </div>
              <span className="text-[11px] font-medium bg-bg-tertiary text-text-secondary px-2 py-0.5 rounded">
                {fr ? SCOPE_LABELS[DEFAULT_SCOPE[selectedRole]].fr : SCOPE_LABELS[DEFAULT_SCOPE[selectedRole]].en}
              </span>
            </div>

            {/* Permission groups */}
            {PERMISSION_GROUPS.map((group) => {
              const expanded = expandedGroups.has(group.key);
              const groupEnabled = group.permissions.filter((p) => preset[p.key]).length;
              const groupTotal = group.permissions.length;
              return (
                <div key={group.key} className="rounded-lg border border-border bg-bg-primary overflow-hidden">
                  <button
                    onClick={() => toggleGroup(group.key)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {expanded ? <ChevronDown size={14} className="text-text-tertiary" /> : <ChevronRight size={14} className="text-text-tertiary" />}
                      <span className="text-[13px] font-medium text-text-primary">
                        {fr ? group.label_fr : group.label_en}
                      </span>
                    </div>
                    <span className={cn(
                      'text-[10px] font-medium px-1.5 py-0.5 rounded',
                      groupEnabled === groupTotal ? 'bg-emerald-500/10 text-emerald-600' :
                      groupEnabled > 0 ? 'bg-amber-500/10 text-amber-600' :
                      'bg-bg-tertiary text-text-tertiary'
                    )}>
                      {groupEnabled}/{groupTotal}
                    </span>
                  </button>

                  {expanded && (
                    <div className="border-t border-border px-4 py-2 space-y-1">
                      {group.permissions.map((perm) => {
                        const enabled = preset[perm.key];
                        return (
                          <div key={perm.key} className="flex items-center justify-between py-1.5">
                            <span className="text-[12px] text-text-secondary">
                              {fr ? perm.label_fr : perm.label_en}
                            </span>
                            <div className={cn(
                              'w-8 h-4 rounded-full flex items-center transition-colors',
                              enabled ? 'bg-emerald-500 justify-end' : 'bg-bg-tertiary justify-start'
                            )}>
                              <div className={cn(
                                'w-3 h-3 rounded-full mx-0.5 transition-colors',
                                enabled ? 'bg-white' : 'bg-text-tertiary'
                              )} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </PermissionGate>
  );
}
