import React, { useState } from 'react';
import { Bug } from 'lucide-react';
import { ALL_ROLES, ROLE_LABELS, type TeamRole } from '../lib/permissions';
import { getDevRoleOverride, setDevRoleOverride } from '../hooks/usePermissions';

const IS_DEV = import.meta.env.DEV || location.hostname === 'localhost';

/**
 * Dev-only role switcher — lets you preview the app as any role.
 * Only renders in development mode. Overrides frontend permissions only
 * (server-side still uses your real role).
 */
export default function DevRoleSwitcher({ expanded }: { expanded: boolean }) {
  const [open, setOpen] = useState(false);

  // Only show in development
  if (!IS_DEV) return null;

  const current = getDevRoleOverride();

  const handleSelect = (role: TeamRole | null) => {
    setDevRoleOverride(role);
    setOpen(false);
    window.location.reload();
  };

  return (
    <div className="relative" style={{ border: '2px solid red' }}>
      <button
        onClick={() => setOpen(!open)}
        title={!expanded ? 'Dev Role Switcher' : undefined}
        className={`w-full flex items-center gap-2.5 px-2.5 py-[8px] rounded-lg text-[14px] font-medium transition-colors ${
          current
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
            : 'text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-active'
        } ${!expanded ? 'justify-center' : ''}`}
      >
        <Bug size={17} strokeWidth={1.8} />
        {expanded && (
          <span className="truncate text-left flex-1">
            {current ? `DEV: ${ROLE_LABELS[current].en}` : 'Switch Role'}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-1 w-52 bg-surface border border-outline rounded-xl shadow-xl z-50 py-1 overflow-hidden">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
              Dev Role Switcher
            </div>

            {/* Clear override */}
            <button
              onClick={() => handleSelect(null)}
              className={`w-full text-left px-3 py-2 text-[13px] hover:bg-surface-secondary transition-colors flex items-center gap-2 ${
                !current ? 'text-accent font-semibold' : 'text-text-primary'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${!current ? 'bg-accent' : 'bg-transparent'}`} />
              Real Role (no override)
            </button>

            <div className="border-t border-outline my-1" />

            {ALL_ROLES.map((role) => (
              <button
                key={role}
                onClick={() => handleSelect(role)}
                className={`w-full text-left px-3 py-2 text-[13px] hover:bg-surface-secondary transition-colors flex items-center gap-2 ${
                  current === role ? 'text-accent font-semibold' : 'text-text-primary'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${current === role ? 'bg-accent' : 'bg-transparent'}`} />
                {ROLE_LABELS[role].en}
                <span className="text-text-tertiary ml-auto text-[11px]">{ROLE_LABELS[role].fr}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
