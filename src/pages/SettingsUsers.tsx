import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '../i18n';
import { cn } from '../lib/utils';
import { Users, Plus, Shield, MapPin, Mail, MoreHorizontal } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ROLE_LABELS, SCOPE_LABELS, type TeamRole, type Scope } from '../lib/permissions';
import PermissionGate from '../components/PermissionGate';

interface MemberRow {
  user_id: string;
  org_id: string;
  role: TeamRole;
  scope: Scope;
  status: string;
  full_name: string | null;
  avatar_url: string | null;
  team_id: string | null;
  team_name: string | null;
  department_id: string | null;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-600',
  pending: 'bg-amber-500/10 text-amber-600',
  suspended: 'bg-red-500/10 text-red-600',
};

async function fetchMembers(): Promise<MemberRow[]> {
  // Scope to active org for multi-tenant isolation
  const { getCurrentOrgIdOrThrow } = await import('../lib/orgApi');
  const orgId = await getCurrentOrgIdOrThrow();

  const { data, error } = await supabase
    .from('memberships')
    .select('user_id, org_id, role, scope, status, full_name, avatar_url, team_id, team_name, department_id, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as MemberRow[];
}

export default function SettingsUsers() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [filterRole, setFilterRole] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['settings-users'],
    queryFn: fetchMembers,
  });

  const filtered = members.filter((m) => {
    if (filterRole !== 'all' && m.role !== filterRole) return false;
    if (filterStatus !== 'all' && m.status !== filterStatus) return false;
    return true;
  });

  return (
    <PermissionGate permission="team.read">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <Users size={20} className="text-accent" />
              {fr ? 'Utilisateurs' : 'Users'}
            </h2>
            <p className="text-xs text-text-tertiary mt-1">
              {fr ? 'Gérez les rôles, scopes et permissions de vos membres.' : 'Manage roles, scopes and permissions for your members.'}
            </p>
          </div>
          <PermissionGate permission="users.invite" fallback={null}>
            <button className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-[13px] font-semibold hover:bg-accent/90 transition-colors">
              <Plus size={15} />
              {fr ? 'Inviter' : 'Invite'}
            </button>
          </PermissionGate>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="rounded-lg border border-border bg-bg-primary px-3 py-1.5 text-[12px] text-text-primary outline-none"
          >
            <option value="all">{fr ? 'Tous les rôles' : 'All roles'}</option>
            {Object.entries(ROLE_LABELS).map(([key, labels]) => (
              <option key={key} value={key}>{fr ? labels.fr : labels.en}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border border-border bg-bg-primary px-3 py-1.5 text-[12px] text-text-primary outline-none"
          >
            <option value="all">{fr ? 'Tous les statuts' : 'All statuses'}</option>
            <option value="active">{fr ? 'Actif' : 'Active'}</option>
            <option value="pending">{fr ? 'En attente' : 'Pending'}</option>
            <option value="suspended">{fr ? 'Suspendu' : 'Suspended'}</option>
          </select>
          <span className="text-[11px] text-text-tertiary ml-auto">
            {filtered.length} {fr ? 'membre(s)' : 'member(s)'}
          </span>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border bg-bg-primary overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-text-tertiary text-sm">
              {fr ? 'Aucun membre trouvé.' : 'No members found.'}
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-bg-secondary/50">
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-text-tertiary uppercase">{fr ? 'Nom' : 'Name'}</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-text-tertiary uppercase">{fr ? 'Rôle' : 'Role'}</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-text-tertiary uppercase">Scope</th>
                  <th className="text-left px-4 py-3 text-[11px] font-medium text-text-tertiary uppercase">{fr ? 'Équipe' : 'Team'}</th>
                  <th className="text-center px-4 py-3 text-[11px] font-medium text-text-tertiary uppercase">{fr ? 'Statut' : 'Status'}</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((member) => {
                  const roleLabel = fr ? ROLE_LABELS[member.role]?.fr : ROLE_LABELS[member.role]?.en;
                  const scopeLabel = fr ? SCOPE_LABELS[member.scope]?.fr : SCOPE_LABELS[member.scope]?.en;
                  return (
                    <tr key={member.user_id} className="border-b border-border last:border-0 hover:bg-bg-secondary/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-bg-tertiary flex items-center justify-center text-xs font-bold text-text-primary shrink-0">
                            {member.avatar_url ? (
                              <img src={member.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                            ) : (
                              member.full_name?.charAt(0)?.toUpperCase() || '?'
                            )}
                          </div>
                          <div>
                            <p className="text-[13px] font-medium text-text-primary">{member.full_name || 'Unknown'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Shield size={12} className="text-text-tertiary" />
                          <span className="text-[12px] font-medium text-text-secondary">{roleLabel || member.role}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[12px] text-text-tertiary">{scopeLabel || member.scope}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[12px] text-text-tertiary">{member.team_name || '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn('inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium', STATUS_COLORS[member.status] || 'bg-bg-tertiary text-text-tertiary')}>
                          {member.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button className="p-1 rounded-md text-text-tertiary hover:bg-bg-secondary hover:text-text-primary transition-colors">
                          <MoreHorizontal size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </PermissionGate>
  );
}
