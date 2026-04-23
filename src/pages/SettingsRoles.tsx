import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from '../i18n';
import { cn } from '../lib/utils';
import { Shield, ChevronDown, ChevronRight, Lock, Loader2, Check, RotateCcw } from 'lucide-react';
import BackToSettings from '../components/ui/BackToSettings';
import {
  ALL_ROLES, ROLE_LABELS, ROLE_PRESETS, PERMISSION_GROUPS,
  FINANCIAL_PERMISSION_KEYS,
  type TeamRole, type PermissionKey, type PermissionsMap,
  DEFAULT_SCOPE, SCOPE_LABELS,
} from '../lib/permissions';
import PermissionGate from '../components/PermissionGate';
import { useCompany } from '../contexts/CompanyContext';
import { supabase } from '../lib/supabase';
import { applyCascade } from '../lib/permissionsCascade';

// ── Persistence (via server so memberships get propagated) ───────
async function loadRoleOverrides(): Promise<Partial<Record<TeamRole, PermissionsMap>>> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/roles/presets', {
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
  });
  if (!res.ok) return {};
  const json = await res.json();
  const out: Partial<Record<TeamRole, PermissionsMap>> = {};
  for (const row of json.presets ?? []) {
    if (ALL_ROLES.includes(row.slug as TeamRole) && row.permissions) {
      out[row.slug as TeamRole] = row.permissions as PermissionsMap;
    }
  }
  return out;
}

async function saveRolePermissions(role: TeamRole, permissions: PermissionsMap): Promise<number> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/roles/update-preset', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({ role, permissions }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Save failed');
  }
  const json = await res.json();
  return json.affected_members ?? 0;
}

export default function SettingsRoles() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const { currentOrgId } = useCompany();

  const [selectedRole, setSelectedRole] = useState<TeamRole>('sales_rep');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [permsByRole, setPermsByRole] = useState<Record<TeamRole, PermissionsMap>>(() => ({
    owner: { ...ROLE_PRESETS.owner },
    admin: { ...ROLE_PRESETS.admin },
    sales_rep: { ...ROLE_PRESETS.sales_rep },
    technician: { ...ROLE_PRESETS.technician },
  }));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  // Load overrides from role_templates on mount / org change
  useEffect(() => {
    if (!currentOrgId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const overrides = await loadRoleOverrides();
        if (cancelled) return;
        setPermsByRole((prev) => {
          const next = { ...prev };
          for (const role of ALL_ROLES) {
            if (overrides[role]) {
              next[role] = { ...ROLE_PRESETS[role], ...overrides[role] };
            }
          }
          return next;
        });
      } catch (e) {
        console.warn('[SettingsRoles] load failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentOrgId]);

  const current = permsByRole[selectedRole];
  const isOwner = selectedRole === 'owner';

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const persist = useCallback(async (role: TeamRole, next: PermissionsMap) => {
    if (!currentOrgId) return;
    setSaving(true);
    setSaveStatus('idle');
    try {
      await saveRolePermissions(role, next);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1500);
    } catch (e) {
      console.error('[SettingsRoles] save failed', e);
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  }, [currentOrgId]);

  const togglePermission = useCallback((key: PermissionKey) => {
    if (isOwner) return; // owner is locked
    // Block technician financial toggles
    if (selectedRole === 'technician' && FINANCIAL_PERMISSION_KEYS.includes(key)) return;

    setPermsByRole((prev) => {
      const currentVal = prev[selectedRole][key] === true;
      const nextMap = applyCascade(prev[selectedRole], key, !currentVal, selectedRole);
      const next = { ...prev, [selectedRole]: nextMap };
      // Fire-and-forget persistence
      persist(selectedRole, nextMap);
      return next;
    });
  }, [selectedRole, isOwner, persist]);

  const resetToDefaults = useCallback(() => {
    if (isOwner) return;
    const preset = { ...ROLE_PRESETS[selectedRole] };
    setPermsByRole((prev) => ({ ...prev, [selectedRole]: preset }));
    persist(selectedRole, preset);
  }, [selectedRole, isOwner, persist]);

  const { enabledCount, totalCount } = useMemo(() => {
    const vals = Object.values(current);
    return { enabledCount: vals.filter(Boolean).length, totalCount: vals.length };
  }, [current]);

  return (
    <PermissionGate permission="users.update_role">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header with back button */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <BackToSettings />
            <div>
              <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                <Shield size={20} className="text-accent" />
                {fr ? 'Rôles & Permissions' : 'Roles & Permissions'}
              </h2>
              <p className="text-xs text-text-tertiary mt-1">
                {fr
                  ? 'Cochez ou décochez pour ajuster les permissions. Les dépendances sont gérées automatiquement.'
                  : 'Check or uncheck to adjust permissions. Dependencies are handled automatically.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] h-6">
            {loading && <Loader2 size={14} className="animate-spin text-text-tertiary" />}
            {saving && !loading && <Loader2 size={14} className="animate-spin text-text-tertiary" />}
            {saveStatus === 'saved' && (
              <span className="inline-flex items-center gap-1 text-emerald-600">
                <Check size={12} /> {fr ? 'Enregistré' : 'Saved'}
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="text-red-600">{fr ? 'Erreur de sauvegarde' : 'Save error'}</span>
            )}
          </div>
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
                    <p className="text-[10px] text-text-tertiary mt-0.5">{fr ? 'Portée' : 'Scope'}: {scopeLabel}</p>
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
            {/* Summary + reset */}
            <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-bg-secondary border border-border">
              <div>
                <p className="text-[13px] font-semibold text-text-primary">
                  {fr ? ROLE_LABELS[selectedRole].fr : ROLE_LABELS[selectedRole].en}
                </p>
                <p className="text-[11px] text-text-tertiary">
                  {enabledCount}/{totalCount} {fr ? 'permissions activées' : 'permissions enabled'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium bg-bg-tertiary text-text-secondary px-2 py-0.5 rounded">
                  {fr ? SCOPE_LABELS[DEFAULT_SCOPE[selectedRole]].fr : SCOPE_LABELS[DEFAULT_SCOPE[selectedRole]].en}
                </span>
                {!isOwner && (
                  <button
                    onClick={resetToDefaults}
                    className="inline-flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary px-2 py-1 rounded hover:bg-bg-tertiary"
                    title={fr ? 'Réinitialiser aux valeurs par défaut' : 'Reset to defaults'}
                  >
                    <RotateCcw size={12} />
                    {fr ? 'Réinitialiser' : 'Reset'}
                  </button>
                )}
              </div>
            </div>

            {isOwner && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20 text-[11px] text-amber-700">
                <Lock size={12} />
                {fr
                  ? 'Le rôle Propriétaire a un accès complet et ne peut pas être modifié.'
                  : 'The Owner role has full access and cannot be modified.'}
              </div>
            )}

            {/* Permission groups */}
            {PERMISSION_GROUPS.map((group) => {
              const expanded = expandedGroups.has(group.key);
              const groupEnabled = group.permissions.filter((p) => current[p.key]).length;
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
                        const enabled = current[perm.key] === true;
                        const financialLocked = selectedRole === 'technician' && FINANCIAL_PERMISSION_KEYS.includes(perm.key);
                        const disabled = isOwner || financialLocked;
                        return (
                          <label
                            key={perm.key}
                            className={cn(
                              'flex items-center justify-between py-1.5 px-1 rounded',
                              disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-bg-secondary/40'
                            )}
                            title={financialLocked ? (fr ? 'Verrouillé : les techniciens ne peuvent pas accéder aux données financières' : 'Locked: technicians cannot access financial data') : undefined}
                          >
                            <span className="text-[12px] text-text-secondary flex items-center gap-1.5">
                              {perm.label_fr && (fr ? perm.label_fr : perm.label_en)}
                              {financialLocked && <Lock size={10} className="text-text-tertiary" />}
                            </span>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={enabled}
                              disabled={disabled}
                              onClick={(e) => {
                                e.preventDefault();
                                if (!disabled) togglePermission(perm.key);
                              }}
                              className={cn(
                                'w-8 h-4 rounded-full flex items-center transition-colors',
                                enabled ? 'bg-emerald-500 justify-end' : 'bg-bg-tertiary justify-start',
                                disabled && 'opacity-60'
                              )}
                            >
                              <div className={cn(
                                'w-3 h-3 rounded-full mx-0.5 transition-colors',
                                enabled ? 'bg-white' : 'bg-text-tertiary'
                              )} />
                            </button>
                          </label>
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
