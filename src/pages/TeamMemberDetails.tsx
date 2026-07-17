import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  User,
  DollarSign,
  Clock,
  Shield,
  Bell,
  AlertTriangle,
  Check,
  Loader2,
  Mail,
  Phone,
  MapPin,
  Camera,
  Crown,
  ShieldCheck,
  Wrench,
  ChevronDown,
  UserX,
  UserCheck,
  KeyRound,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import { cn } from '../lib/utils';
import { PageHeader, Modal } from '../components/ui';
import { useTranslation } from '../i18n';
import { toast } from 'sonner';
import { updateMemberRole, removeMember } from '../lib/invitationsApi';
import MemberPermissionsEditor from '../components/team/MemberPermissionsEditor';
import MemberCommissionPlan from '../components/team/MemberCommissionPlan';
import {
  type TeamRole,
  type PermissionsMap,
  type CommunicationPreferences,
  type WeeklySchedule,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  getDefaultPermissions,
  getDefaultSchedule,
  DEFAULT_COMMUNICATION_PREFS,
  DAYS_OF_WEEK,
  DAY_LABELS,
  formatTime12h,
} from '../lib/permissions';

// ── Types ────────────────────────────────────────────────────────────
interface MemberData {
  id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  role: TeamRole;
  status: 'active' | 'inactive';
  avatar_url: string | null;
  street1: string;
  street2: string;
  city: string;
  province: string;
  postal_code: string;
  country: string;
  labour_cost_hourly: number | null;
  compensation_mode: 'hourly' | 'commission' | 'both';
  working_hours: WeeklySchedule;
  permissions: PermissionsMap;
  communication_preferences: CommunicationPreferences;
  created_at: string;
}

const ROLE_CONFIG: Record<string, { label_en: string; label_fr: string; icon: typeof Crown; color: string; badge: string }> = {
  owner:      { label_en: 'Account Owner', label_fr: 'Propriétaire',     icon: Crown,       color: 'text-text-secondary',  badge: 'bg-surface-tertiary text-text-secondary border-outline-subtle' },
  admin:      { label_en: 'Admin',         label_fr: 'Administrateur',   icon: ShieldCheck, color: 'text-primary',    badge: 'bg-primary/10 text-primary border-primary/20' },
  sales_rep:  { label_en: 'Sales Rep',     label_fr: 'Représentant',     icon: ShieldCheck, color: 'text-text-secondary',  badge: 'bg-surface-secondary text-text-secondary border-outline' },
  technician: { label_en: 'Technician',    label_fr: 'Technicien',       icon: Wrench,      color: 'text-text-secondary',  badge: 'bg-surface-tertiary text-text-secondary border-outline-subtle' },
  manager:    { label_en: 'Manager',       label_fr: 'Gestionnaire',     icon: ShieldCheck, color: 'text-primary',    badge: 'bg-primary/10 text-primary border-primary/20' },
  support:    { label_en: 'Support',       label_fr: 'Support',          icon: ShieldCheck, color: 'text-text-secondary',  badge: 'bg-green-50 text-green-600 border-green-200' },
  viewer:     { label_en: 'Viewer',        label_fr: 'Observateur',      icon: User,        color: 'text-text-secondary',  badge: 'bg-surface-tertiary text-text-secondary border-outline-subtle' },
};

// No demo fallback — all data must come from DB

// ── Time options helper ──────────────────────────────────────────────
function generateTimeOptions(): string[] {
  const options: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of ['00', '30']) {
      options.push(`${h.toString().padStart(2, '0')}:${m}`);
    }
  }
  return options;
}
const TIME_OPTIONS = generateTimeOptions();

// ── Main Component ───────────────────────────────────────────────────
export default function TeamMemberDetails() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const { memberId } = useParams<{ memberId: string }>();
  const isFr = language === 'fr';
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<MemberData | null>(null);
  const [initialRole, setInitialRole] = useState<TeamRole | null>(null);
  // team_members.compensation_mode ships behind a migration — hide the mode
  // selector until the column exists.
  const [hasCompMode, setHasCompMode] = useState(false);
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  // Fetch member data
  useEffect(() => {
    async function fetchMember() {
      if (!memberId) return;

      const { data, error } = await supabase
        .from('team_members')
        .select('*')
        .eq('id', memberId)
        .maybeSingle();

      if (error) {
        console.error('Fetch member error:', error);
      }

      if (data) {
        const perms = (data.permissions && typeof data.permissions === 'object' && Object.keys(data.permissions).length > 0)
          ? data.permissions as PermissionsMap
          : getDefaultPermissions(data.role as TeamRole);

        // Supabase returns numeric columns as strings — parse to number
        const rawCost = data.labour_cost_hourly;
        const parsedCost = rawCost != null ? Number(rawCost) : null;

        setForm({
          id: data.id,
          user_id: data.user_id || null,
          first_name: data.first_name || '',
          last_name: data.last_name || '',
          email: data.email || '',
          phone: data.phone || '',
          role: (data.role as TeamRole) || 'technician',
          status: data.status || 'active',
          avatar_url: data.avatar_url || null,
          street1: data.street1 || '',
          street2: data.street2 || '',
          city: data.city || '',
          province: data.province || '',
          postal_code: data.postal_code || '',
          country: data.country || '',
          labour_cost_hourly: (parsedCost !== null && !isNaN(parsedCost)) ? parsedCost : null,
          compensation_mode: (data.compensation_mode as 'hourly' | 'commission' | 'both') || 'hourly',
          working_hours: (data.working_hours as WeeklySchedule) || getDefaultSchedule(),
          permissions: perms,
          communication_preferences: (data.communication_preferences as CommunicationPreferences) || DEFAULT_COMMUNICATION_PREFS,
          created_at: data.created_at,
        });
        setInitialRole(((data.role as TeamRole) || 'technician'));
        setHasCompMode('compensation_mode' in data);
        if (data.avatar_url) setAvatarPreview(data.avatar_url);
      } else {
        toast.error(t.teamMember.memberNotFound);
        navigate('/settings/team');
        return;
      }
      setLoading(false);
    }
    fetchMember();
  }, [memberId]);

  if (loading || !form) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  const fullName = `${form.first_name} ${form.last_name}`.trim();
  const initials = `${form.first_name[0] || ''}${form.last_name[0] || ''}`.toUpperCase();
  const isInactive = form.status === 'inactive';
  const roleCfg = ROLE_CONFIG[form.role];
  const RoleIcon = roleCfg.icon;

  // ── Updaters ────────────────────────────────────────────
  const update = <K extends keyof MemberData>(key: K, value: MemberData[K]) => {
    setForm((prev) => prev ? { ...prev, [key]: value } : prev);
    setSaved(false);
  };

  const updateScheduleDay = (day: string, field: keyof typeof form.working_hours[string], value: any) => {
    setForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        working_hours: {
          ...prev.working_hours,
          [day]: { ...prev.working_hours[day], [field]: value },
        },
      };
    });
    setSaved(false);
  };

  const updateCommPref = (key: keyof CommunicationPreferences) => {
    setForm((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        communication_preferences: { ...prev.communication_preferences, [key]: !prev.communication_preferences[key] },
      };
    });
    setSaved(false);
  };

  const handleRoleChange = (newRole: TeamRole) => {
    // Local selection only — applied on save via the server RBAC route.
    update('role', newRole);
    setSaved(false);
  };

  // ── Avatar upload ───────────────────────────────────────
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setAvatarPreview(url);
    // Session-local preview only — a blob: URL must never be persisted (it is
    // dead after this session). The save payload skips blob: values.
    update('avatar_url', url);
  };

  // ── Password reset ─────────────────────────────────────
  const handlePasswordReset = async () => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(form.email, {
        redirectTo: `${window.location.origin}/settings`,
      });
      if (error) throw error;
      toast.success(t.teamMember.passwordResetEmailSentToFormemail);
    } catch {
      toast.error(isFr ? 'Erreur lors de l\'envoi du courriel de réinitialisation.' : 'Failed to send password reset email.');
    }
  };

  // ── Toggle status ──────────────────────────────────────
  const handleToggleStatus = async () => {
    const newStatus = form.status === 'active' ? 'inactive' : 'active';
    try {
      const orgId = await getCurrentOrgIdOrThrow();

      // Actually block/restore login. team_members.status alone is cosmetic —
      // auth reads memberships. Deactivate goes through the server route
      // (suspends the membership + signs the user out everywhere).
      if (form.user_id) {
        if (newStatus === 'inactive') {
          await removeMember(form.user_id);
        } else {
          const { error } = await supabase
            .from('memberships')
            .update({ status: 'active' })
            .eq('user_id', form.user_id)
            .eq('org_id', orgId);
          if (error) throw error;
        }
      }

      const { error: tmError } = await supabase
        .from('team_members')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', form.id)
        .eq('org_id', orgId);
      if (tmError) throw tmError;
    } catch (err: any) {
      toast.error(err?.message || (isFr ? 'Échec du changement de statut.' : 'Failed to change status.'));
      setShowDeactivateConfirm(false);
      return;
    }
    update('status', newStatus);
    setShowDeactivateConfirm(false);
    toast.success(
      newStatus === 'inactive'
        ? (t.teamMember.formfirstnameHasBeenDeactivated)
        : (t.teamMember.formfirstnameHasBeenReactivated)
    );
  };

  // ── Save all ───────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const costValue = form.labour_cost_hourly;
      const sanitizedCost = (costValue !== null && !isNaN(costValue)) ? Number(costValue) : null;

      // Role changes go through the RBAC server route (it updates memberships —
      // the table auth/permissions actually read; team_members.role alone had
      // no access-control effect). Server enforces admin/owner + demotion rules.
      if (initialRole !== null && form.role !== initialRole) {
        if (!form.user_id) {
          toast.error(isFr
            ? 'Ce membre n\'a pas encore de compte — le rôle ne peut pas être changé ici.'
            : 'This member has no account yet — the role cannot be changed here.');
          return;
        }
        await updateMemberRole(form.user_id, form.role as any);
        setInitialRole(form.role);
      }

      const payload = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        role: form.role,
        status: form.status,
        // Never persist a session-local blob: preview URL.
        avatar_url: form.avatar_url?.startsWith('blob:') ? null : form.avatar_url,
        street1: form.street1.trim(),
        street2: form.street2.trim(),
        city: form.city.trim(),
        province: form.province.trim(),
        postal_code: form.postal_code.trim(),
        country: form.country.trim(),
        labour_cost_hourly: sanitizedCost,
        ...(hasCompMode ? { compensation_mode: form.compensation_mode } : {}),
        // Keep the P&L column in sync: profitability reads hourly_rate_cents,
        // not labour_cost_hourly — editing here used to have no effect on job
        // costing despite the copy claiming it did.
        hourly_rate_cents: sanitizedCost !== null ? Math.round(sanitizedCost * 100) : null,
        working_hours: form.working_hours,
        communication_preferences: form.communication_preferences,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('team_members')
        .update(payload)
        .eq('id', form.id);

      if (error) {
        console.error('Save failed:', error);
        toast.error(t.teamMember.errorErrormessage);
        return;
      }
      setSaved(true);
      toast.success(t.teamMember.changesSaved);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      console.error('Save exception:', err);
      toast.error(isFr ? 'Erreur lors de l\'enregistrement.' : 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title={fullName}
        subtitle={isFr ? roleCfg.label_fr : roleCfg.label_en}
        icon={User}
        iconColor="blue"
      >
        <button className="glass-button inline-flex items-center gap-1.5" onClick={() => navigate('/settings/team')}>
          <ArrowLeft size={14} />
          {isFr ? 'Retour à l\'équipe' : 'Back to Team'}
        </button>
      </PageHeader>

      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-3xl space-y-5"
      >
        {/* ─── Section 1: Personal Info ─────────────────────── */}
        <div className="section-card p-5 space-y-5">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
            <User size={12} />
            {t.teamMember.personalInfo}
          </h3>

          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div
              className="relative w-16 h-16 rounded-2xl flex items-center justify-center text-lg font-bold shrink-0 cursor-pointer group overflow-hidden border border-outline-subtle"
              onClick={() => fileInputRef.current?.click()}
            >
              {avatarPreview ? (
                <img src={avatarPreview} alt={fullName} className="w-full h-full object-cover" />
              ) : (
                <span className="bg-primary/10 text-primary w-full h-full flex items-center justify-center">{initials}</span>
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Camera size={18} className="text-white" />
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            </div>
            <div>
              <p className="text-[13px] font-bold text-text-primary">{fullName}</p>
              <p className="text-[12px] text-text-tertiary">{form.email}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border', roleCfg.badge)}>
                  <RoleIcon size={9} className="inline mr-0.5 -mt-px" />
                  {isFr ? roleCfg.label_fr : roleCfg.label_en}
                </span>
                {isInactive && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-danger/10 text-danger border border-danger/20">
                    {t.teamMember.inactive}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Name fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.teamMember.firstName}</label>
              <input type="text" value={form.first_name} onChange={(e) => update('first_name', e.target.value)} className="glass-input w-full mt-1" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.teamMember.lastName}</label>
              <input type="text" value={form.last_name} onChange={(e) => update('last_name', e.target.value)} className="glass-input w-full mt-1" />
            </div>
          </div>

          {/* Contact */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1">
                <Mail size={10} /> {t.companySettings.emailAddress}
              </label>
              <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} className="glass-input w-full mt-1" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1">
                <Phone size={10} /> {t.teamMember.mobilePhone}
              </label>
              <input type="tel" value={form.phone} onChange={(e) => update('phone', e.target.value)} className="glass-input w-full mt-1" />
            </div>
          </div>

          {/* Address */}
          <div className="space-y-3 pt-2 border-t border-border">
            <h4 className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1">
              <MapPin size={10} /> {t.billing.address}
            </h4>
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.companySettings.street1}</label>
              <input type="text" value={form.street1} onChange={(e) => update('street1', e.target.value)} className="glass-input w-full mt-1" placeholder="123 Main St" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.companySettings.street2}</label>
              <input type="text" value={form.street2} onChange={(e) => update('street2', e.target.value)} className="glass-input w-full mt-1" placeholder={t.teamMember.aptSuite} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.billing.city}</label>
                <input type="text" value={form.city} onChange={(e) => update('city', e.target.value)} className="glass-input w-full mt-1" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.companySettings.provinceState}</label>
                <input type="text" value={form.province} onChange={(e) => update('province', e.target.value)} className="glass-input w-full mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.billing.postalCode}</label>
                <input type="text" value={form.postal_code} onChange={(e) => update('postal_code', e.target.value)} className="glass-input w-full mt-1" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{t.billing.country}</label>
                <input type="text" value={form.country} onChange={(e) => update('country', e.target.value)} className="glass-input w-full mt-1" placeholder="Canada" />
              </div>
            </div>
          </div>

          {/* Password reset */}
          <div className="pt-3 border-t border-border">
            <button onClick={handlePasswordReset} className="glass-button inline-flex items-center gap-1.5 text-[12px]">
              <KeyRound size={13} />
              {t.teamMember.sendPasswordResetEmail}
            </button>
          </div>
        </div>

        {/* ─── Section 2: Compensation ─────────────────────── */}
        <div className="section-card p-5 space-y-4">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
            <DollarSign size={12} />
            {isFr ? 'Rémunération' : 'Compensation'}
          </h3>

          {/* Pay mode — hidden until the compensation_mode migration is applied */}
          {hasCompMode && (
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider mb-2 block">
                {isFr ? 'Mode de rémunération' : 'Pay mode'}
              </label>
              <div className="flex gap-2 flex-wrap">
                {([
                  { value: 'hourly' as const, label: isFr ? 'Taux horaire' : 'Hourly' },
                  { value: 'commission' as const, label: 'Commission' },
                  { value: 'both' as const, label: isFr ? 'Horaire + commission' : 'Hourly + commission' },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => update('compensation_mode', opt.value)}
                    className={cn(
                      'px-4 py-2 rounded-xl border transition-all text-[13px] font-semibold',
                      form.compensation_mode === opt.value
                        ? 'border-primary bg-primary/5 text-text-primary'
                        : 'border-outline-subtle text-text-secondary hover:border-outline'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-text-tertiary mt-1.5">
                {isFr
                  ? 'La page Paie combine automatiquement heures × taux + commissions selon ce qui s\'applique.'
                  : 'The Payroll page automatically combines hours × rate + commissions as applicable.'}
              </p>
            </div>
          )}

          {(!hasCompMode || form.compensation_mode !== 'commission') && (
            <div className="max-w-xs">
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
                {isFr ? 'Taux horaire' : 'Hourly rate'}
              </label>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[13px] font-semibold text-text-tertiary">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.labour_cost_hourly ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    update('labour_cost_hourly', val === '' ? null : parseFloat(val));
                  }}
                  className="glass-input w-full"
                  placeholder="0.00"
                />
                <span className="text-[12px] text-text-tertiary whitespace-nowrap">/ {t.teamMember.hour}</span>
              </div>
              <p className="text-[11px] text-text-tertiary mt-1.5">
                {isFr ? 'Utilisé pour la paie, l\'estimation des coûts et les rapports de rentabilité.' : 'Used for payroll, job costing and profitability reports.'}
              </p>
            </div>
          )}

          {hasCompMode && form.compensation_mode !== 'hourly' && form.user_id && (
            <MemberCommissionPlan userId={form.user_id} isFr={isFr} />
          )}
        </div>


        {/* ─── Section 4: Role ─────────────────────────────── */}
        {/* The old per-user permission matrix and "transfer ownership" button
            were removed: they wrote to team_members, which the RBAC resolver
            never reads — controls that appeared to work but had zero access
            effect. Role changes now flow through the server RBAC route on
            save; fine-grained permissions are managed per-role in
            Settings > Roles & Permissions. */}
        <div className="section-card p-5 space-y-5">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary flex items-center gap-1.5">
            <Shield size={12} />
            {t.teamMember.permissions}
          </h3>

          {form.role === 'owner' ? (
            <p className="text-[12px] text-text-tertiary">
              {t.teamMember.accountOwnerHasFullAccessToEverythingPer}
            </p>
          ) : (
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider mb-2 block">{t.manageTeam.role}</label>
              <div className="flex gap-2 flex-wrap">
                {(['admin', 'sales_rep', 'technician'] as TeamRole[]).map((r) => {
                  const cfg = ROLE_CONFIG[r];
                  const Icon = cfg.icon;
                  const isSelected = form.role === r;
                  return (
                    <button
                      key={r}
                      onClick={() => handleRoleChange(r)}
                      className={cn(
                        'flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all text-[13px] font-semibold',
                        isSelected ? 'border-primary bg-primary/5 text-text-primary' : 'border-outline-subtle text-text-secondary hover:border-outline'
                      )}
                    >
                      <Icon size={14} className={cfg.color} />
                      {isFr ? cfg.label_fr : cfg.label_en}
                      {isSelected && <Check size={12} className="text-primary ml-1" />}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-text-tertiary mt-2">
                {isFr
                  ? 'Le rôle donne les permissions de base (Réglages → Rôles & Permissions). Vous pouvez les ajuster individuellement ci-dessous.'
                  : 'The role provides the base permissions (Settings → Roles & Permissions). You can adjust them individually below.'}
              </p>
              {form.user_id && <MemberPermissionsEditor userId={form.user_id} isFr={isFr} />}
            </div>
          )}
        </div>


        {/* ─── Section 6: Danger Zone ──────────────────────── */}
        <div className="section-card p-5 space-y-3 border-danger/30">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-danger flex items-center gap-1.5">
            <AlertTriangle size={12} />
            {t.teamMember.dangerZone}
          </h3>
          <div className="flex items-center justify-between p-3 bg-danger/5 border border-danger/20 rounded-xl">
            <div>
              <p className="text-[13px] font-semibold text-text-primary">
                {isInactive
                  ? (t.teamMember.reactivateThisUser)
                  : (t.teamMember.deactivateThisUser)}
              </p>
              <p className="text-[12px] text-text-tertiary">
                {isInactive
                  ? (isFr ? 'L\'utilisateur pourra se reconnecter.' : 'User will be able to log in again.')
                  : (isFr ? 'L\'utilisateur ne pourra plus se connecter.' : 'User will no longer be able to log in.')}
              </p>
            </div>
            <button
              onClick={() => isInactive ? handleToggleStatus() : setShowDeactivateConfirm(true)}
              className={cn(
                'px-4 py-2 rounded-xl text-[13px] font-semibold border transition-all',
                isInactive
                  ? 'border-success/30 bg-success/5 text-success hover:bg-success/10'
                  : 'border-danger/30 bg-danger/5 text-danger hover:bg-danger/10'
              )}
            >
              {isInactive ? (
                <span className="inline-flex items-center gap-1.5"><UserCheck size={14} />{t.teamMember.reactivate}</span>
              ) : (
                <span className="inline-flex items-center gap-1.5"><UserX size={14} />{t.teamMember.deactivate}</span>
              )}
            </button>
          </div>
        </div>

        {/* ─── Section 7: Save Changes ─────────────────────── */}
        <div className="flex items-center justify-end gap-3 pb-8">
          <button onClick={() => navigate('/settings/team')} className="glass-button">
            {t.advancedNotes.cancel}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className={cn(
              'glass-button-primary inline-flex items-center gap-1.5 px-6',
              saved && '!bg-success !text-white !border-success'
            )}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : null}
            {saving ? (t.billing.saving) : saved ? (t.teamMember.saved) : (t.teamMember.saveChanges)}
          </button>
        </div>
      </motion.div>

      {/* ─── Deactivate Confirmation Modal ──────────────────── */}
      <Modal
        open={showDeactivateConfirm}
        onClose={() => setShowDeactivateConfirm(false)}
        title={t.teamMember.confirmDeactivation}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-[13px] text-text-secondary">
            {isFr
              ? `Êtes-vous sûr de vouloir désactiver ${fullName}? L'utilisateur ne pourra plus se connecter à Lume.`
              : `Are you sure you want to deactivate ${fullName}? The user will no longer be able to log into Lume.`}
          </p>
          <div className="flex items-center justify-end gap-2">
            <button className="glass-button" onClick={() => setShowDeactivateConfirm(false)}>
              {t.advancedNotes.cancel}
            </button>
            <button
              onClick={handleToggleStatus}
              className="px-4 py-2 rounded-xl text-[13px] font-semibold bg-danger text-white border border-danger hover:bg-danger/90 transition-colors"
            >
              {t.teamMember.deactivate}
            </button>
          </div>
        </div>
      </Modal>

      {/* (The "transfer ownership" modal was removed — it only wrote
          team_members.role, so it CLAIMED to transfer ownership while the real
          owner, in memberships, stayed unchanged. A real transfer needs a
          dedicated server route.) */}
    </div>
  );
}
