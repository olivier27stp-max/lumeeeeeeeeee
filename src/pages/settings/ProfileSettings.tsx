import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Camera,
  Check,
  Loader2,
  Mail,
  Phone,
  DollarSign,
  Target,
  FileSignature,
  CircleDollarSign,
  ClipboardList,
  Clock,
  CalendarCheck,
  CheckCircle2,
  TrendingUp,
  ChevronRight,
  MapPin,
  Cake,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import { usePermissions } from '../../hooks/usePermissions';
import { ROLE_LABELS, normalizeRole, hasPermission, type TeamRole } from '../../lib/permissions';
import { getCurrentOrgIdOrThrow } from '../../lib/orgApi';
import { uploadViaServer } from '../../lib/storage';
import { getRepRealStats, getTechRealStats, type RepRealStats, type TechRealStats } from '../../lib/repStatsApi';
import { getCommissionEntries } from '../../lib/commissionsApi';
import { Avatar } from '../../components/d2d/avatar';

// ─── Mon profil ────────────────────────────────────────────────────
// Every user sees and edits THEIR OWN profile here (photo, name, phone,
// email), in the same spirit as the rep profile page. The stats block
// adapts to the role: sales reps see their sales numbers, technicians see
// their job/hours numbers, owners/admins can opt into the sales view.

function fmtCurrency(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k`;
  return `$${Math.round(n)}`;
}

function KpiCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="section-card p-4">
      <div className="flex items-center gap-2 text-text-tertiary">
        <Icon size={14} />
        <p className="text-[10px] font-bold uppercase tracking-wider">{label}</p>
      </div>
      <p className="mt-2 text-xl font-extrabold tabular-nums text-text-primary">{value}</p>
    </div>
  );
}

export default function ProfileSettings() {
  const { language, setLanguage } = useTranslation();
  const isFr = language === 'fr';
  const navigate = useNavigate();
  const permsCtx = usePermissions();
  const role: TeamRole = normalizeRole(permsCtx.role || 'sales_rep');

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [memberRowId, setMemberRowId] = useState<string | null>(null);
  const [hireDate, setHireDate] = useState('');

  // Editable fields + their last-saved snapshot (drives `dirty`)
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [savedInfo, setSavedInfo] = useState({ firstName: '', lastName: '', phone: '', city: '', birthDate: '' });
  // team_members.birth_date ships behind a migration — feature-detect on the
  // loaded row so the page works before AND after the column exists.
  const [hasBirthCol, setHasBirthCol] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Banner — stored by convention at avatars/{orgId}/banners/{userId} (no DB
  // column); the <img> falls back to the gradient when no banner was ever
  // uploaded. Uploads go through the server relay: the avatars bucket has no
  // client INSERT policy, so direct uploads die on RLS.
  const [bannerBroken, setBannerBroken] = useState(false);
  const [bannerVersion, setBannerVersion] = useState(0);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const bannerUrl = userId && orgId
    ? `${supabase.storage.from('avatars').getPublicUrl(`${orgId}/banners/${userId}`).data.publicUrl}?v=${bannerVersion}`
    : null;

  // Email change flow
  const [changingEmail, setChangingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);

  // Stats
  const [stats, setStats] = useState<RepRealStats | null>(null);
  const [techStats, setTechStats] = useState<TechRealStats | null>(null);
  const [commissions, setCommissions] = useState<{ nextPayout: number; allTime: number } | null>(null);
  const [closesCount, setClosesCount] = useState<number | null>(null);
  // Owners/admins opt into the sales view; reps/techs always see their block.
  const [showSalesStats, setShowSalesStats] = useState(role === 'sales_rep');
  // Techs have zero financial permissions by default — hide revenue unless granted.
  const canSeeRevenue = role === 'owner' || role === 'admin'
    || hasPermission(permsCtx.permissions, 'financial.view_pricing', role);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        setUserId(user.id);
        setEmail(user.email || '');

        const currentOrgId = await getCurrentOrgIdOrThrow().catch(() => null);
        setOrgId(currentOrgId);
        const [profileRes, memberRes, birthColRes] = await Promise.all([
          supabase.from('profiles').select('full_name, avatar_url').eq('id', user.id).maybeSingle(),
          currentOrgId
            ? supabase.from('team_members').select('*').eq('user_id', user.id).eq('org_id', currentOrgId).maybeSingle()
            : Promise.resolve({ data: null } as any),
          // Feature-detect the birth_date column (ships behind a migration)
          // independently of whether this user has a team_members row yet.
          supabase.from('team_members').select('birth_date').limit(1),
        ]);
        setHasBirthCol(!birthColRes.error);

        const p = profileRes.data;
        const m = memberRes.data;
        setAvatarUrl(m?.avatar_url || p?.avatar_url || null);

        // First/last come from team_members when available; otherwise split
        // profiles.full_name so the two fields are still editable.
        const nameParts = (p?.full_name || '').trim().split(/\s+/).filter(Boolean);
        const first = m?.first_name || nameParts[0] || '';
        const last = m?.last_name || nameParts.slice(1).join(' ') || '';
        const info = {
          firstName: first,
          lastName: last,
          phone: m?.phone || '',
          city: m?.city || '',
          birthDate: m?.birth_date || '',
        };
        setFirstName(info.firstName);
        setLastName(info.lastName);
        setPhone(info.phone);
        setCity(info.city);
        setBirthDate(info.birthDate);
        setSavedInfo(info);
        if (m) {
          setMemberRowId(m.id);
          if (m.created_at) {
            setHireDate(new Date(m.created_at).toLocaleDateString(isFr ? 'fr-CA' : 'en-CA', { month: 'long', year: 'numeric' }));
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Technician stats — jobs come from the tech's punches, not sales data.
  useEffect(() => {
    if (!userId || role !== 'technician' || techStats) return;
    (async () => {
      try {
        const orgId = await getCurrentOrgIdOrThrow();
        setTechStats(await getTechRealStats(userId, orgId));
      } catch {
        // Non-critical.
      }
    })();
  }, [userId, role, techStats]);

  // Sales stats — loaded lazily once the sales view is wanted.
  useEffect(() => {
    if (!userId) return;
    if (role === 'technician' || !showSalesStats) return;
    if (stats) return;
    (async () => {
      try {
        const orgId = await getCurrentOrgIdOrThrow();
        const [real, entries, dealsRes] = await Promise.all([
          getRepRealStats(userId, orgId),
          getCommissionEntries({ userId }).catch(() => []),
          supabase
            .from('pipeline_deals')
            .select('id, stage')
            .eq('org_id', orgId)
            .eq('rep_id', userId)
            .is('deleted_at', null)
            .then((r) => r.data || []),
        ]);
        setStats(real);
        setCommissions({
          nextPayout: entries.filter((c: any) => c.status === 'pending' || c.status === 'approved').reduce((s: number, c: any) => s + (c.amount || 0), 0),
          allTime: entries.filter((c: any) => c.status === 'paid').reduce((s: number, c: any) => s + (c.amount || 0), 0),
        });
        setClosesCount(dealsRes.filter((d: any) => d.stage === 'won').length);
      } catch {
        // Stats are non-critical — the profile stays usable without them.
      }
    })();
  }, [userId, role, showSalesStats, stats]);

  const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
  const dirty =
    firstName.trim() !== savedInfo.firstName ||
    lastName.trim() !== savedInfo.lastName ||
    phone.trim() !== savedInfo.phone ||
    city.trim() !== savedInfo.city ||
    birthDate !== savedInfo.birthDate;

  async function handleSave() {
    if (!userId) return;
    setSaving(true);
    setSaved(false);
    try {
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ full_name: fullName })
        .eq('id', userId);
      if (profileErr) throw profileErr;

      const memberPayload: Record<string, any> = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        // team_members.phone est NOT NULL — chaîne vide, jamais null
        phone: phone.trim(),
        city: city.trim() || null,
        updated_at: new Date().toISOString(),
      };
      if (hasBirthCol) memberPayload.birth_date = birthDate || null;
      if (memberRowId) {
        const { error: memberErr } = await supabase
          .from('team_members')
          .update(memberPayload)
          .eq('id', memberRowId);
        if (memberErr) throw memberErr;
      } else if (orgId) {
        // Owners created before the team module have no team_members row —
        // create it here so phone/city/birth date have somewhere to live.
        const { data: created, error: memberErr } = await supabase
          .from('team_members')
          .insert({ ...memberPayload, org_id: orgId, user_id: userId, email, role, status: 'active' })
          .select('id')
          .single();
        if (memberErr) throw memberErr;
        if (created) setMemberRowId(created.id);
      }
      setSavedInfo({ firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim(), city: city.trim(), birthDate });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      toast.error(e.message || (isFr ? 'Échec de la sauvegarde' : 'Save failed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleBannerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    if (!orgId) {
      toast.error(isFr ? 'Organisation introuvable' : 'Organization not found');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error(isFr ? 'Image trop lourde (max 8 Mo)' : 'Image too large (max 8MB)');
      return;
    }
    setUploadingBanner(true);
    try {
      await uploadViaServer('avatars', `${orgId}/banners/${userId}`, file, { upsert: true });
      setBannerBroken(false);
      setBannerVersion((v) => v + 1);
      toast.success(isFr ? 'Bannière mise à jour' : 'Banner updated');
    } catch (err: any) {
      toast.error(err.message || (isFr ? "Échec de l'envoi de la bannière" : 'Banner upload failed'));
    } finally {
      setUploadingBanner(false);
      if (bannerInputRef.current) bannerInputRef.current.value = '';
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error(isFr ? 'Image trop lourde (max 5 Mo)' : 'Image too large (max 5MB)');
      return;
    }
    if (!orgId) {
      toast.error(isFr ? 'Organisation introuvable' : 'Organization not found');
      return;
    }
    setUploadingAvatar(true);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${orgId}/avatars/${userId}.${ext}`;
      const { url: publicUrl } = await uploadViaServer('avatars', path, file, { upsert: true });
      // Cache-bust so the new photo shows immediately everywhere.
      const url = `${publicUrl}?v=${Date.now()}`;
      const { error: profErr } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', userId);
      if (profErr) throw profErr;
      if (memberRowId) {
        await supabase.from('team_members').update({ avatar_url: url }).eq('id', memberRowId);
      }
      setAvatarUrl(url);
      toast.success(isFr ? 'Photo mise à jour' : 'Photo updated');
    } catch (err: any) {
      toast.error(err.message || (isFr ? "Échec de l'envoi de la photo" : 'Photo upload failed'));
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleEmailChange() {
    const target = newEmail.trim().toLowerCase();
    if (!target || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target)) {
      toast.error(isFr ? 'Courriel invalide' : 'Invalid email');
      return;
    }
    setSendingEmail(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: target });
      if (error) throw error;
      toast.success(
        isFr
          ? `Lien de confirmation envoyé à ${target}. Le changement prend effet après confirmation.`
          : `Confirmation link sent to ${target}. The change applies once confirmed.`,
        { duration: 8000 },
      );
      setChangingEmail(false);
      setNewEmail('');
    } catch (err: any) {
      toast.error(err.message || (isFr ? 'Échec du changement de courriel' : 'Email change failed'));
    } finally {
      setSendingEmail(false);
    }
  }

  const roleLabel = ROLE_LABELS[role]?.[isFr ? 'fr' : 'en'] || role;

  if (loading) {
    return (
      <div className="space-y-5 animate-pulse">
        <div className="h-40 bg-surface-tertiary rounded-2xl" />
        <div className="h-64 bg-surface-tertiary rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-5">
      {/* ── Profile header — banner + avatar + name/role ── */}
      <div className="section-card overflow-hidden !p-0">
        <div className="relative h-24 bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-800">
          {bannerUrl && !bannerBroken && (
            <img
              src={bannerUrl}
              alt=""
              onError={() => setBannerBroken(true)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <button
            type="button"
            onClick={() => bannerInputRef.current?.click()}
            disabled={uploadingBanner}
            className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-black/35 backdrop-blur text-white flex items-center justify-center hover:bg-black/50 transition-colors disabled:opacity-60"
            title={isFr ? 'Changer la bannière' : 'Change banner'}
          >
            {uploadingBanner ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
          </button>
          <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerChange} />
        </div>
        <div className="px-6 pb-5">
          <div className="flex items-end justify-between -mt-10">
            <div className="relative">
              <div className="rounded-full border-4 border-surface-card bg-surface-card">
                <Avatar
                  name={fullName || email}
                  src={avatarUrl || `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(userId || email)}&backgroundColor=f5f5f5&radius=50`}
                  size="lg"
                  className="!h-20 !w-20"
                />
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center shadow-md hover:bg-primary/90 transition-colors disabled:opacity-60"
                title={isFr ? 'Changer la photo' : 'Change photo'}
              >
                {uploadingAvatar ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            </div>
          </div>
          <div className="mt-3">
            <h2 className="text-lg font-extrabold text-text-primary tracking-tight">{fullName || (isFr ? 'Sans nom' : 'Unnamed')}</h2>
            <p className="text-[12px] font-semibold text-text-secondary">{roleLabel}{hireDate ? ` · ${isFr ? 'depuis' : 'since'} ${hireDate}` : ''}</p>
          </div>
        </div>
      </div>

      {/* ── Editable info ── */}
      <div className="section-card p-5 space-y-5">
        <p className="text-xs font-medium text-text-tertiary">{isFr ? 'Mes informations' : 'My information'}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="text-xs font-medium text-text-tertiary">{isFr ? 'Prénom' : 'First name'}</label>
            <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="glass-input w-full mt-1.5" placeholder={isFr ? 'Olivier' : 'John'} />
          </div>
          <div>
            <label className="text-xs font-medium text-text-tertiary">{isFr ? 'Nom' : 'Last name'}</label>
            <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className="glass-input w-full mt-1.5" placeholder={isFr ? 'Tremblay' : 'Smith'} />
          </div>
          <div>
            <label className="text-xs font-medium text-text-tertiary">{isFr ? 'Téléphone' : 'Phone'}</label>
            <div className="relative mt-1.5">
              <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="glass-input w-full !pl-9" placeholder="514 555 0123" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-text-tertiary">{isFr ? 'Ville' : 'City'}</label>
            <div className="relative mt-1.5">
              <MapPin size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input type="text" value={city} onChange={(e) => setCity(e.target.value)} className="glass-input w-full !pl-9" placeholder={isFr ? 'Drummondville' : 'Montreal'} />
            </div>
          </div>
          {hasBirthCol && (
            <div>
              <label className="text-xs font-medium text-text-tertiary">{isFr ? 'Date de naissance' : 'Date of birth'}</label>
              <div className="relative mt-1.5">
                <Cake size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                <input
                  type="date"
                  value={birthDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className="glass-input w-full !pl-9"
                />
              </div>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-text-tertiary">{isFr ? 'Rôle' : 'Role'}</label>
            <div className="relative mt-1.5">
              <Shield size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input type="text" disabled value={roleLabel} className="glass-input w-full !pl-9 opacity-60" />
            </div>
            {(role === 'owner' || role === 'admin') && (
              <button
                type="button"
                onClick={() => navigate('/settings/team')}
                className="mt-1 text-[11px] font-medium text-text-tertiary hover:text-text-primary underline"
              >
                {isFr ? 'Gérer les rôles de l\'équipe →' : 'Manage team roles →'}
              </button>
            )}
          </div>
        </div>

        {/* Email + change flow */}
        <div>
          <label className="text-xs font-medium text-text-tertiary">{isFr ? 'Courriel' : 'Email'}</label>
          {!changingEmail ? (
            <div className="flex items-center gap-3 mt-1.5">
              <div className="relative flex-1">
                <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                <input type="email" disabled value={email} className="glass-input w-full !pl-9 opacity-60" />
              </div>
              <button type="button" onClick={() => setChangingEmail(true)} className="glass-button-ghost text-[11px] font-medium whitespace-nowrap">
                {isFr ? 'Changer' : 'Change'}
              </button>
            </div>
          ) : (
            <div className="mt-1.5 space-y-2">
              <input
                type="email"
                autoFocus
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder={isFr ? 'nouveau@courriel.com' : 'new@email.com'}
                className="glass-input w-full"
              />
              <div className="flex items-center gap-2">
                <button type="button" onClick={handleEmailChange} disabled={sendingEmail} className="glass-button-primary text-[11px] inline-flex items-center gap-1.5">
                  {sendingEmail && <Loader2 size={11} className="animate-spin" />}
                  {isFr ? 'Envoyer le lien de confirmation' : 'Send confirmation link'}
                </button>
                <button type="button" onClick={() => { setChangingEmail(false); setNewEmail(''); }} className="glass-button-ghost text-[11px]">
                  {isFr ? 'Annuler' : 'Cancel'}
                </button>
              </div>
              <p className="text-[11px] text-text-tertiary">
                {isFr
                  ? 'Un lien de confirmation sera envoyé au nouveau courriel avant que le changement soit appliqué.'
                  : 'A confirmation link is sent to the new email before the change applies.'}
              </p>
            </div>
          )}
        </div>

        {/* Interface language — inline selector (replaces the old standalone Langue page) */}
        <div>
          <label className="text-xs font-medium text-text-tertiary">{isFr ? "Langue de l'interface" : 'Interface language'}</label>
          <div className="flex items-center gap-2 mt-1.5">
            {([{ code: 'en', label: 'English', flag: '🇬🇧' }, { code: 'fr', label: 'Français', flag: '🇫🇷' }] as const).map((lang) => (
              <button
                key={lang.code}
                type="button"
                onClick={() => setLanguage(lang.code)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border text-[13px] font-semibold transition-all',
                  language === lang.code
                    ? 'border-primary bg-primary/5 text-text-primary'
                    : 'border-outline-subtle text-text-secondary hover:border-outline hover:bg-surface-secondary/40'
                )}
              >
                <span>{lang.flag}</span>{lang.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className={cn('glass-button-primary inline-flex items-center gap-2', saved && '!bg-success !text-white !border-success')}
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : null}
          {saving ? (isFr ? 'Sauvegarde…' : 'Saving…') : saved ? (isFr ? 'Sauvegardé' : 'Saved') : (isFr ? 'Enregistrer' : 'Save')}
        </button>
      </div>

      {/* ── Role-adapted stats ── */}
      {role === 'technician' ? (
        <div className="space-y-3">
          <p className="text-xs font-medium text-text-tertiary px-1">{isFr ? 'Mes statistiques' : 'My stats'}</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <KpiCard icon={CheckCircle2} label={isFr ? 'Jobs complétés' : 'Jobs completed'} value={String(techStats?.jobsCompleted ?? '—')} />
            <KpiCard icon={ClipboardList} label={isFr ? 'Jobs en cours' : 'Jobs in progress'} value={String(techStats?.jobsInProgress ?? '—')} />
            {canSeeRevenue && (
              <KpiCard icon={DollarSign} label={isFr ? 'Revenus générés' : 'Revenue generated'} value={techStats ? fmtCurrency(techStats.revenueGenerated) : '—'} />
            )}
            <KpiCard icon={Clock} label={isFr ? 'Heures travaillées' : 'Hours worked'} value={techStats ? `${techStats.hoursWorked}h` : '—'} />
            <KpiCard icon={CalendarCheck} label={isFr ? 'Jours travaillés' : 'Days worked'} value={String(techStats?.daysWorked ?? '—')} />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-medium text-text-tertiary">{isFr ? 'Mes statistiques de vente' : 'My sales stats'}</p>
            {(role === 'owner' || role === 'admin') && (
              <button
                type="button"
                onClick={() => setShowSalesStats((v) => !v)}
                className="text-[11px] font-medium text-text-tertiary hover:text-text-primary underline"
              >
                {showSalesStats ? (isFr ? 'Masquer' : 'Hide') : (isFr ? 'Voir mes stats' : 'Show my stats')}
              </button>
            )}
          </div>
          {showSalesStats && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard icon={DollarSign} label={isFr ? 'Revenus totaux' : 'Total revenue'} value={stats ? fmtCurrency(stats.totalRevenue) : '—'} />
                <KpiCard icon={Target} label={isFr ? 'Ventes conclues' : 'Closes'} value={String(closesCount ?? '—')} />
                <KpiCard icon={FileSignature} label={isFr ? 'Contrats signés' : 'Contracts signed'} value={String(stats?.contractsSigned ?? '—')} />
                <KpiCard icon={CircleDollarSign} label={isFr ? 'Commissions à venir' : 'Next payout'} value={commissions ? fmtCurrency(commissions.nextPayout) : '—'} />
              </div>
              {userId && (
                <button
                  type="button"
                  onClick={() => navigate(`/reps/${userId}`)}
                  className="w-full section-card p-4 flex items-center justify-between hover:bg-surface-secondary/40 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <TrendingUp size={16} className="text-primary" />
                    <span className="text-[13px] font-semibold text-text-primary">
                      {isFr ? 'Voir mon profil complet (closes, commissions, historique)' : 'View my full profile (closes, commissions, history)'}
                    </span>
                  </div>
                  <ChevronRight size={16} className="text-text-tertiary" />
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
