import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getRepRealStats, type RepRealStats } from '../lib/repStatsApi';
import UnifiedAvatar from './ui/UnifiedAvatar';
import { Loader2, Timer, Briefcase, DollarSign, FileSignature, CalendarCheck, ChevronRight, Search } from 'lucide-react';
import { cn } from '../lib/utils';

interface Member {
  id: string;           // user_id (auth.users.id)
  name: string;
  email: string | null;
  role: string | null;
  avatar_url: string | null;
}

interface RowState {
  loading: boolean;
  stats: RepRealStats | null;
  punchedToday: boolean;
}

function fmtCurrency(n: number, fr = false): string {
  return new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n || 0);
}

export default function TeamProfilesGrid({ orgId, fr = false }: { orgId: string; fr?: boolean }) {
  const nav = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Source of truth: memberships (who is in the org), enriched with
      // team_members (display info) and profiles (avatar fallback)
      const [membershipsRes, teamMembersRes] = await Promise.all([
        supabase.from('memberships').select('user_id, role').eq('org_id', orgId),
        supabase.from('team_members')
          .select('user_id, first_name, last_name, email, avatar_url, role, status')
          .eq('org_id', orgId)
          .is('deletion_scheduled_at', null),
      ]);

      const memberships = membershipsRes.data || [];
      const teamMembers = teamMembersRes.data || [];

      const userIds = memberships.map((m: any) => m.user_id).filter(Boolean);
      if (userIds.length === 0) {
        if (!cancelled) { setMembers([]); setLoading(false); }
        return;
      }

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', userIds);

      const profMap = new Map<string, any>((profiles || []).map((p: any) => [p.id, p]));
      const tmMap = new Map<string, any>(teamMembers.map((t: any) => [t.user_id, t]));

      const built: Member[] = memberships.map((m: any) => {
        const tm = tmMap.get(m.user_id);
        const p = profMap.get(m.user_id);
        const tmName = tm ? `${tm.first_name || ''} ${tm.last_name || ''}`.trim() : '';
        const name = tmName || p?.full_name || tm?.email || 'Sans nom';
        return {
          id: m.user_id,
          name,
          email: tm?.email || null,
          role: tm?.role || m.role || null,
          avatar_url: tm?.avatar_url || p?.avatar_url || null,
        };
      }).sort((a, b) => a.name.localeCompare(b.name));

      if (cancelled) return;
      setMembers(built);
      setLoading(false);

      // Load stats per member in parallel, capping concurrency to 4
      const today = new Date().toISOString().slice(0, 10);
      const { data: activeEntries } = await supabase
        .from('time_entries')
        .select('employee_id')
        .eq('org_id', orgId)
        .eq('date', today)
        .is('punch_out', null);
      const punchedSet = new Set((activeEntries || []).map((e: any) => e.employee_id));

      const next: Record<string, RowState> = {};
      built.forEach((m) => { next[m.id] = { loading: true, stats: null, punchedToday: punchedSet.has(m.id) }; });
      setRows(next);

      const queue = [...built];
      const workers = Array.from({ length: 4 }, async () => {
        while (queue.length) {
          const m = queue.shift()!;
          try {
            const s = await getRepRealStats(m.id, orgId);
            if (!cancelled) {
              setRows((r) => ({ ...r, [m.id]: { loading: false, stats: s, punchedToday: punchedSet.has(m.id) } }));
            }
          } catch {
            if (!cancelled) {
              setRows((r) => ({ ...r, [m.id]: { loading: false, stats: null, punchedToday: punchedSet.has(m.id) } }));
            }
          }
        }
      });
      await Promise.all(workers);
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  const filtered = members.filter((m) =>
    !search.trim() || m.name.toLowerCase().includes(search.toLowerCase()) || (m.email || '').toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={28} className="animate-spin text-text-muted" />
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface-card p-10 text-center">
        <p className="text-text-tertiary">{fr ? 'Aucun membre dans cette organisation.' : 'No members in this organization.'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={fr ? 'Rechercher un employé…' : 'Search a member…'}
            className="w-full h-9 pl-9 pr-3 rounded-md border border-outline bg-surface text-[13px] placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-text-primary/20"
          />
        </div>
        <span className="text-[12px] text-text-tertiary">{filtered.length} {fr ? 'membre(s)' : 'member(s)'}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((m) => {
          const r = rows[m.id] || { loading: true, stats: null, punchedToday: false };
          return (
            <button
              key={m.id}
              onClick={() => nav(`/reps/${m.id}`)}
              className="text-left rounded-2xl border border-border bg-surface-card p-4 hover:shadow-md hover:border-text-primary/30 transition-all"
            >
              <div className="flex items-center gap-3 mb-3">
                <UnifiedAvatar id={m.id} name={m.name} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[14px] font-semibold text-text-primary truncate">{m.name}</p>
                    {r.punchedToday && <span className="w-2 h-2 rounded-full bg-emerald-500" title={fr ? 'Punché' : 'Punched in'} />}
                  </div>
                  <p className="text-[11px] text-text-tertiary capitalize">{m.role || (fr ? 'Membre' : 'Member')}</p>
                </div>
                <ChevronRight size={14} className="text-text-tertiary shrink-0" />
              </div>

              {r.loading ? (
                <div className="flex items-center justify-center py-3">
                  <Loader2 size={14} className="animate-spin text-text-tertiary" />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <Stat icon={DollarSign} label={fr ? 'Revenu' : 'Revenue'} value={fmtCurrency(r.stats?.totalRevenue || 0, fr)} />
                  <Stat icon={Briefcase} label={fr ? 'Jobs faits' : 'Jobs done'} value={String(r.stats?.jobsCompleted ?? 0)} />
                  <Stat icon={FileSignature} label={fr ? 'Contrats' : 'Contracts'} value={String(r.stats?.contractsSigned ?? 0)} />
                  <Stat icon={Timer} label={fr ? 'Heures' : 'Hours'} value={`${r.stats?.hoursWorked ?? 0}h`} />
                  <Stat icon={CalendarCheck} label={fr ? 'Jours' : 'Days'} value={String(r.stats?.daysWorked ?? 0)} className="col-span-2" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, className }: { icon: any; label: string; value: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-1.5 rounded-md bg-surface px-2 py-1.5 border border-border/50', className)}>
      <Icon size={12} className="text-text-tertiary shrink-0" />
      <div className="min-w-0">
        <p className="text-[9px] uppercase tracking-wider text-text-tertiary leading-none">{label}</p>
        <p className="text-[12px] font-bold text-text-primary leading-tight truncate">{value}</p>
      </div>
    </div>
  );
}
