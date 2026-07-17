import { useEffect, useState } from 'react';
import { Check, ChevronDown, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { supabase } from '../../lib/supabase';
import { PERMISSION_GROUPS, type TeamRole } from '../../lib/permissions';

async function authedFetch(path: string, init: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error || `Request failed (${res.status})`);
  return json;
}

/**
 * Per-user permission overrides. Edits memberships.permissions — the map the
 * RBAC resolver actually reads — and flags the member custom so role-preset
 * saves stop overwriting them. (The old team_members matrix was removed
 * because it had zero access effect.)
 */
export default function MemberPermissionsEditor({ userId, isFr }: { userId: string; isFr: boolean }) {
  const [perms, setPerms] = useState<Record<string, boolean> | null>(null);
  const [role, setRole] = useState<TeamRole | null>(null);
  const [custom, setCustom] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    authedFetch(`/api/roles/member-permissions?user_id=${encodeURIComponent(userId)}`)
      .then((r) => {
        setPerms(r.permissions || {});
        setRole(r.role);
        setCustom(Boolean(r.custom));
        setDirty(false);
      })
      .catch(() => setPerms(null))
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) {
    return <Loader2 size={15} className="animate-spin text-text-tertiary" />;
  }
  if (!perms || role === 'owner') return null;

  const toggle = (key: string) => {
    setPerms((prev) => ({ ...(prev || {}), [key]: !(prev || {})[key] }));
    setDirty(true);
  };

  async function handleSave() {
    setSaving(true);
    try {
      const r = await authedFetch('/api/roles/member-permissions', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, permissions: perms }),
      });
      setPerms(r.permissions);
      setCustom(true);
      setDirty(false);
      toast.success(isFr ? 'Permissions personnalisées enregistrées' : 'Custom permissions saved');
    } catch (err: any) {
      toast.error(err?.message || (isFr ? 'Échec de la sauvegarde' : 'Save failed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setResetting(true);
    try {
      const r = await authedFetch('/api/roles/member-permissions/reset', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId }),
      });
      setPerms(r.permissions || {});
      setCustom(false);
      setDirty(false);
      toast.success(r.template_found
        ? (isFr ? 'Permissions réalignées sur le rôle' : 'Permissions reset to role preset')
        : (isFr ? 'Personnalisation retirée — resynchronisé à la prochaine sauvegarde du rôle' : 'Customization removed — resyncs on next role save'));
    } catch (err: any) {
      toast.error(err?.message || (isFr ? 'Échec' : 'Failed'));
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
            {isFr ? 'Permissions individuelles' : 'Individual permissions'}
          </label>
          {custom && (
            <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold">
              {isFr ? 'Personnalisées' : 'Custom'}
            </span>
          )}
        </div>
        {custom && (
          <button
            type="button"
            onClick={handleReset}
            disabled={resetting}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-text-tertiary hover:text-text-primary transition"
          >
            {resetting ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
            {isFr ? 'Réinitialiser au rôle' : 'Reset to role'}
          </button>
        )}
      </div>
      <p className="text-[11px] text-text-tertiary">
        {isFr
          ? 'Ajustez les accès de CE membre sans toucher aux autres. Une fois personnalisé, il n\'est plus écrasé quand le rôle est modifié dans Rôles & Permissions.'
          : 'Adjust THIS member\'s access without touching others. Once customized, role-preset saves no longer overwrite them.'}
      </p>

      <div className="rounded-xl border border-outline/50 divide-y divide-outline/30 overflow-hidden">
        {PERMISSION_GROUPS.map((group) => {
          const isOpen = openGroups.has(group.key);
          const onCount = group.permissions.filter((p) => perms[p.key]).length;
          return (
            <div key={group.key}>
              <button
                type="button"
                onClick={() => setOpenGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(group.key)) next.delete(group.key); else next.add(group.key);
                  return next;
                })}
                className="flex w-full items-center justify-between px-3.5 py-2.5 text-left hover:bg-surface-secondary/40 transition"
              >
                <span className="text-[12.5px] font-semibold text-text-primary">
                  {isFr ? group.label_fr : group.label_en}
                  <span className="ml-2 text-[10.5px] font-normal text-text-tertiary">{onCount}/{group.permissions.length}</span>
                </span>
                <ChevronDown size={13} className={cn('text-text-tertiary transition-transform', isOpen && 'rotate-180')} />
              </button>
              {isOpen && (
                <div className="px-3.5 pb-2.5 space-y-1">
                  {group.permissions.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => toggle(p.key)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-secondary/50 transition text-left"
                    >
                      <span className="text-[12px] text-text-secondary">{isFr ? p.label_fr : p.label_en}</span>
                      <span
                        role="switch"
                        aria-checked={!!perms[p.key]}
                        className={cn('relative inline-flex h-[16px] w-7 shrink-0 items-center rounded-full transition-colors', perms[p.key] ? 'bg-primary' : 'bg-surface-tertiary')}
                      >
                        <span className={cn('inline-block h-[12px] w-[12px] transform rounded-full bg-surface-card shadow-sm transition-transform', perms[p.key] ? 'translate-x-[13px]' : 'translate-x-[2px]')} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {dirty && (
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="glass-button-primary inline-flex items-center gap-1.5 !text-[12px]"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          {isFr ? 'Enregistrer les permissions' : 'Save permissions'}
        </button>
      )}
    </div>
  );
}
