import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  Plus,
  MoreHorizontal,
  Edit3,
  Shield,
  UserX,
  UserCheck,
  Loader2,
  Check,
  X,
  ArrowLeft,
  Search,
  Crown,
  ShieldCheck,
  Wrench,
  ChevronRight,
  Mail,
  MailPlus,
  Clock,
  RefreshCw,
  Trash2,
  Briefcase,
  Copy,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { PageHeader, Modal, EmptyState } from '../components/ui';
import { useTranslation } from '../i18n';
import { toast } from 'sonner';
import PermissionGate from '../components/PermissionGate';
import {
  fetchTeamList,
  sendInvitation,
  resendInvitation,
  revokeInvitation,
  updateMemberRole,
  removeMember,
  type OrgMember,
  type Invitation,
  type MemberRole,
} from '../lib/invitationsApi';

// ── Constants ────────────────────────────────────────────────────
const ROLE_CONFIG: Record<MemberRole, { label_en: string; label_fr: string; icon: typeof Crown; color: string; badge: string }> = {
  owner:      { label_en: 'Account Owner',  label_fr: 'Propriétaire',     icon: Crown,       color: 'text-text-secondary',  badge: 'bg-surface-tertiary text-text-secondary' },
  admin:      { label_en: 'Admin',          label_fr: 'Administrateur',   icon: ShieldCheck, color: 'text-primary',          badge: 'bg-primary/10 text-primary' },
  sales_rep:  { label_en: 'Sales Rep',      label_fr: 'Représentant',     icon: Briefcase,   color: 'text-text-secondary',   badge: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' },
  technician: { label_en: 'Technician',     label_fr: 'Technicien',       icon: Wrench,      color: 'text-text-secondary',   badge: 'bg-surface-tertiary text-text-secondary' },
};

const ROLE_DESCRIPTIONS_EN: Record<MemberRole, string[]> = {
  owner:      ['Full access to everything'],
  admin:      ['Manage clients', 'Manage jobs', 'Manage team', 'Manage invoices'],
  sales_rep:  ['Leads & pipeline', 'Quotes & proposals', 'Clients & follow-ups'],
  technician: ['View assigned jobs', 'Track timesheets', 'Limited CRM access'],
};
const ROLE_DESCRIPTIONS_FR: Record<MemberRole, string[]> = {
  owner:      ['Accès complet à tout'],
  admin:      ['Gérer les clients', 'Gérer les jobs', 'Gérer l\'équipe', 'Gérer les factures'],
  sales_rep:  ['Prospects & pipeline', 'Devis & propositions', 'Clients & suivis'],
  technician: ['Voir les jobs assignés', 'Suivi des feuilles de temps', 'Accès CRM limité'],
};

function formatRelativeDate(dateStr: string | null, lang: string): string {
  if (!dateStr) return lang === 'fr' ? 'Jamais' : 'Never';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return lang === 'fr' ? 'À l\'instant' : 'Just now';
  if (diffMins < 60) return lang === 'fr' ? `il y a ${diffMins} min` : `${diffMins}m ago`;
  if (diffHours < 24) return lang === 'fr' ? `il y a ${diffHours}h` : `${diffHours}h ago`;
  if (diffDays < 7) return lang === 'fr' ? `il y a ${diffDays}j` : `${diffDays}d ago`;
  return d.toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Main Component ───────────────────────────────────────────────
export default function ManageTeam() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [roleChangeMember, setRoleChangeMember] = useState<OrgMember | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const isFr = language === 'fr';
  const roleDescriptions = isFr ? ROLE_DESCRIPTIONS_FR : ROLE_DESCRIPTIONS_EN;

  const loadTeam = async () => {
    try {
      const data = await fetchTeamList();
      setMembers(data.members);
      setInvitations(data.invitations);
    } catch (err: any) {
      console.error('Failed to load team:', err.message);
      toast.error(isFr ? 'Erreur lors du chargement de l\'équipe.' : 'Failed to load team.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTeam(); }, []);

  const activeMembers = useMemo(() =>
    members
      .filter((m) => m.status === 'active')
      .filter((m) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return m.full_name.toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q);
      }),
    [members, search]
  );

  const suspendedMembers = useMemo(() =>
    members.filter((m) => m.status === 'suspended'),
    [members]
  );

  // Close menus when clicking outside
  useEffect(() => {
    const handler = () => setOpenMenuId(null);
    if (openMenuId) document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openMenuId]);

  const handleInvite = async (email: string, role: MemberRole) => {
    try {
      const result = await sendInvitation(email, role);
      toast.success(t.manageTeam.invitationSent);
      setShowInviteModal(false);

      // Copy invite link
      if (result.invite_link) {
        try {
          await navigator.clipboard.writeText(result.invite_link);
          toast.info(isFr ? 'Lien d\'invitation copié.' : 'Invite link copied to clipboard.');
        } catch {}
      }

      await loadTeam();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleResend = async (invitationId: string) => {
    try {
      await resendInvitation(invitationId);
      toast.success(t.manageTeam.invitationResent);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleRevoke = async (invitationId: string) => {
    try {
      await revokeInvitation(invitationId);
      toast.success(t.manageTeam.invitationRevoked);
      await loadTeam();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleChangeRole = async (userId: string, newRole: MemberRole) => {
    try {
      await updateMemberRole(userId, newRole);
      toast.success(t.manageTeam.roleUpdated);
      setRoleChangeMember(null);
      await loadTeam();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    try {
      await removeMember(userId);
      toast.success(t.manageTeam.memberRemoved);
      await loadTeam();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <PermissionGate permission="team.view">
    <div className="space-y-5">
      <PageHeader
        title={isFr ? 'Gérer l\'équipe' : 'Manage Team'}
        subtitle={isFr
          ? 'Invitez et gérez les membres de votre équipe. Assignez des rôles et des permissions.'
          : 'Invite and manage your team members. Assign roles and permissions.'}
        icon={Users}
        iconColor="blue"
      >
        <button className="glass-button inline-flex items-center gap-1.5" onClick={() => navigate('/settings')}>
          <ArrowLeft size={14} />
          {t.manageTeam.settings}
        </button>
        <button className="glass-button-primary inline-flex items-center gap-1.5" onClick={() => setShowInviteModal(true)}>
          <MailPlus size={14} />
          {t.manageTeam.inviteMember}
        </button>
      </PageHeader>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.manageTeam.searchMembers}
          className="glass-input w-full !pl-9"
        />
      </div>

      {/* Active Members */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-bold text-text-primary">
            {t.manageTeam.activeMembers}
          </h2>
          <span className="text-[11px] font-semibold text-text-tertiary bg-surface-secondary px-2 py-0.5 rounded-full">
            {activeMembers.length}
          </span>
        </div>

        {activeMembers.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t.manageTeam.noMembersFound}
            description={t.manageTeam.inviteAMemberOrAdjustYourSearch}
          />
        ) : (
          <div className="space-y-1.5">
            {activeMembers.map((member) => (
              <MemberRow
                key={member.user_id}
                member={member}
                language={language}
                openMenuId={openMenuId}
                setOpenMenuId={setOpenMenuId}
                onChangeRole={() => setRoleChangeMember(member)}
                onRemove={() => handleRemoveMember(member.user_id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-bold text-text-primary">
              <Mail size={13} className="inline mr-1.5 -mt-0.5" />
              {t.manageTeam.pendingInvitations}
            </h2>
            <span className="text-[11px] font-semibold text-warning bg-warning/10 px-2 py-0.5 rounded-full">
              {invitations.length}
            </span>
          </div>
          <div className="space-y-1.5">
            {invitations.map((inv) => (
              <div
                key={inv.id}
                className="section-card p-4 flex items-center gap-4"
              >
                <div className="w-10 h-10 rounded-xl bg-warning/10 border border-warning/20 flex items-center justify-center shrink-0">
                  <Clock size={16} className="text-warning" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[13px] font-bold text-text-primary truncate">{inv.email}</span>
                    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', ROLE_CONFIG[inv.role as MemberRole]?.badge || 'bg-surface-tertiary text-text-secondary')}>
                      {isFr ? ROLE_CONFIG[inv.role as MemberRole]?.label_fr : ROLE_CONFIG[inv.role as MemberRole]?.label_en}
                    </span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-warning/10 text-warning">
                      {t.manageTeam.pending}
                    </span>
                  </div>
                  <p className="text-[12px] text-text-tertiary">
                    {t.agent.expires}: {new Date(inv.expires_at).toLocaleDateString(t.dashboard.enus, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => handleResend(inv.id)}
                    title={t.invoiceDetails.resend}
                    className="p-2 rounded-lg border border-transparent text-text-tertiary hover:text-text-primary hover:bg-surface-secondary hover:border-outline-subtle transition-all"
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button
                    onClick={() => handleRevoke(inv.id)}
                    title={t.manageTeam.revoke}
                    className="p-2 rounded-lg border border-transparent text-text-tertiary hover:text-danger hover:bg-danger-light transition-all"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suspended Members */}
      {suspendedMembers.length > 0 && (
        <div className="space-y-2 pt-3 border-t border-border">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-bold text-text-tertiary">
              {t.manageTeam.suspendedMembers}
            </h2>
            <span className="text-[11px] font-semibold text-text-tertiary bg-surface-secondary px-2 py-0.5 rounded-full">
              {suspendedMembers.length}
            </span>
          </div>
          <div className="space-y-1.5">
            {suspendedMembers.map((member) => (
              <MemberRow
                key={member.user_id}
                member={member}
                language={language}
                openMenuId={openMenuId}
                setOpenMenuId={setOpenMenuId}
                onChangeRole={() => setRoleChangeMember(member)}
                onRemove={() => {}}
                isSuspended
              />
            ))}
          </div>
        </div>
      )}

      {/* Role Permissions Reference */}
      <div className="section-card p-5 space-y-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
          {t.manageTeam.rolePermissions}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {(['owner', 'admin', 'sales_rep', 'technician'] as MemberRole[]).map((role) => {
            const cfg = ROLE_CONFIG[role];
            const RoleIcon = cfg.icon;
            return (
              <div key={role} className="bg-surface-secondary rounded-xl p-3.5 space-y-2">
                <div className="flex items-center gap-2">
                  <RoleIcon size={14} className={cfg.color} />
                  <span className="text-[13px] font-bold text-text-primary">
                    {isFr ? cfg.label_fr : cfg.label_en}
                  </span>
                </div>
                <ul className="space-y-1">
                  {roleDescriptions[role].map((perm, i) => (
                    <li key={i} className="text-[12px] text-text-secondary flex items-start gap-1.5">
                      <Check size={10} className="text-success mt-0.5 shrink-0" />
                      {perm}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* Invite Modal */}
      <Modal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        title={t.manageTeam.inviteTeamMember}
        description={t.manageTeam.sendAnEmailInvitation}
        size="lg"
      >
        <InviteForm
          language={language}
          onSend={handleInvite}
          onCancel={() => setShowInviteModal(false)}
        />
      </Modal>

      {/* Change Role Modal */}
      <Modal
        open={!!roleChangeMember}
        onClose={() => setRoleChangeMember(null)}
        title={t.manageTeam.changeRole}
        description={roleChangeMember?.full_name || ''}
        size="sm"
      >
        {roleChangeMember && (
          <div className="space-y-2">
            {(['admin', 'sales_rep', 'technician'] as MemberRole[]).map((role) => {
              const cfg = ROLE_CONFIG[role];
              const RoleIcon = cfg.icon;
              const isSelected = roleChangeMember.role === role;
              return (
                <button
                  key={role}
                  onClick={() => handleChangeRole(roleChangeMember.user_id, role)}
                  className={cn(
                    'w-full flex items-center justify-between p-3 rounded-xl border transition-all text-left',
                    isSelected ? 'border-primary bg-primary/5' : 'border-outline-subtle hover:border-outline'
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <RoleIcon size={15} className={cfg.color} />
                    <div>
                      <span className="text-[13px] font-semibold text-text-primary">
                        {isFr ? cfg.label_fr : cfg.label_en}
                      </span>
                      <p className="text-[11px] text-text-tertiary">
                        {roleDescriptions[role][0]}
                      </p>
                    </div>
                  </div>
                  {isSelected && (
                    <span className="badge-info text-[10px]">
                      <Check size={10} className="inline mr-0.5" />
                      {t.manageTeam.current}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Modal>
    </div>
    </PermissionGate>
  );
}

// ── Member Row Component ─────────────────────────────────────────
interface MemberRowProps {
  member: OrgMember;
  language: string;
  openMenuId: string | null;
  setOpenMenuId: (id: string | null) => void;
  onChangeRole: () => void;
  onRemove: () => void;
  isSuspended?: boolean;
}

const MemberRow: React.FC<MemberRowProps> = ({
  member,
  language,
  openMenuId,
  setOpenMenuId,
  onChangeRole,
  onRemove,
  isSuspended,
}) => {
  const isFr = language === 'fr';
  const cfg = ROLE_CONFIG[member.role] || ROLE_CONFIG.technician;
  const RoleIcon = cfg.icon;
  const initials = member.full_name
    ? member.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '??';
  const isMenuOpen = openMenuId === member.user_id;
  const isOwner = member.role === 'owner';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'section-card p-4 flex items-center gap-4 transition-all group',
        isSuspended && 'opacity-50'
      )}
    >
      <div className={cn(
        'w-10 h-10 rounded-xl flex items-center justify-center text-[13px] font-bold shrink-0',
        isSuspended
          ? 'bg-surface-secondary text-text-tertiary border border-outline-subtle'
          : 'bg-primary/10 text-primary border border-primary/20'
      )}>
        {initials}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[13px] font-bold text-text-primary truncate">
            {member.full_name || (t.manageTeam.unnamed)}
          </span>
          <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', cfg.badge)}>
            <RoleIcon size={9} className="inline mr-0.5 -mt-px" />
            {isFr ? cfg.label_fr : cfg.label_en}
          </span>
          {isSuspended && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-danger/10 text-danger">
              {t.manageTeam.suspended}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 text-[12px] text-text-secondary">
          <span className="truncate">{member.email || ''}</span>
          <span className="text-text-tertiary">
            {t.manageTeam.joined}: {formatRelativeDate(member.created_at, language)}
          </span>
        </div>
      </div>

      {/* Action menu (not for owner) */}
      {!isOwner && (
        <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={(e) => { e.stopPropagation(); setOpenMenuId(isMenuOpen ? null : member.user_id); }}
            className="p-2 rounded-lg border border-transparent text-text-tertiary hover:text-text-primary hover:bg-surface-secondary hover:border-outline-subtle transition-all"
          >
            <MoreHorizontal size={16} />
          </button>

          <AnimatePresence>
            {isMenuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                transition={{ duration: 0.1 }}
                className="absolute right-0 top-full mt-1 w-48 bg-surface border border-outline rounded-xl shadow-dropdown z-30 py-1 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => { setOpenMenuId(null); onChangeRole(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-text-secondary hover:bg-surface-secondary hover:text-text-primary transition-colors"
                >
                  <Shield size={13} />
                  {t.manageTeam.changeRole2}
                </button>
                {!isSuspended && (
                  <>
                    <div className="border-t border-border my-1" />
                    <button
                      onClick={() => { setOpenMenuId(null); onRemove(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-danger hover:bg-danger-light transition-colors"
                    >
                      <UserX size={13} />
                      {isFr ? 'Retirer de l\'équipe' : 'Remove from team'}
                    </button>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
};

// ── Invite Form Component ────────────────────────────────────────
function InviteForm({
  language,
  onSend,
  onCancel,
}: {
  language: string;
  onSend: (email: string, role: MemberRole) => void;
  onCancel: () => void;
}) {
  const isFr = language === 'fr';
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('technician');
  const [sending, setSending] = useState(false);
  const roleDescriptions = isFr ? ROLE_DESCRIPTIONS_FR : ROLE_DESCRIPTIONS_EN;

  const handleSubmit = () => {
    if (!email.trim() || !email.includes('@')) {
      toast.error(t.manageTeam.validEmailIsRequired);
      return;
    }
    setSending(true);
    onSend(email.trim(), role);
    // Parent will close modal on success; setSending will be cleaned up on unmount
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
          {t.companySettings.emailAddress}
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="glass-input w-full mt-1"
          placeholder="john@company.com"
          autoFocus
        />
      </div>

      <div>
        <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
          {t.manageTeam.role}
        </label>
        <div className="space-y-1.5 mt-1.5">
          {(['admin', 'sales_rep', 'technician'] as MemberRole[]).map((r) => {
            const cfg = ROLE_CONFIG[r];
            const RoleIcon = cfg.icon;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={cn(
                  'w-full flex items-center gap-2.5 p-2.5 rounded-xl border transition-all text-left',
                  role === r ? 'border-primary bg-primary/5' : 'border-outline-subtle hover:border-outline'
                )}
              >
                <RoleIcon size={14} className={cfg.color} />
                <div>
                  <span className="text-[13px] font-semibold text-text-primary">
                    {isFr ? cfg.label_fr : cfg.label_en}
                  </span>
                  <p className="text-[11px] text-text-tertiary">{roleDescriptions[r][0]}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        <button className="glass-button" onClick={onCancel}>
          {t.advancedNotes.cancel}
        </button>
        <button
          className="glass-button-primary inline-flex items-center gap-1.5"
          onClick={handleSubmit}
          disabled={sending}
        >
          {sending ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
          {sending
            ? (t.invoiceDetails.sending)
            : (isFr ? 'Envoyer l\'invitation' : 'Send Invitation')}
        </button>
      </div>
    </div>
  );
}
