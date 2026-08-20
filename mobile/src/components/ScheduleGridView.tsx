// Vue « Grille » de l'Horaire — la vue par défaut du mobile.
//
// Une journée = une pile verticale de tournées : Tournée 1 (son en-tête, puis
// tous ses contrats), Tournée 2, etc. Aucune grille horaire : on descend, on
// lit. Les données sont EXACTEMENT celles de la vue Trajet (les RouteJob du
// AgendaRoutePanel web) — même regroupement par équipe, mêmes couleurs
// d'équipe, mêmes statuts. Seule la mise en page change : ici pas de carte ni
// d'optimisation Mapbox, donc rien à attendre au chargement.

import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import type { RouteJob } from '@/components/ScheduleRouteView';
import UnifiedAvatar from '@/components/ui/UnifiedAvatar';
import { toRgba } from '@/lib/api/schedule';
import { useTranslation } from '@/lib/i18n';
import { statusLabel, statusStyle } from '@/lib/statusColors';

/** Un RouteJob + sa fin : la vue Grille affiche la plage horaire complète. */
export interface GridJob extends RouteJob {
  endAt: string;
}

/** Un membre affiché dans l'en-tête d'une tournée (team_assignments). */
export interface RouteTeamMember {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

const UNASSIGNED = '__none__';
const MAX_AVATARS = 3;

interface DayRoute {
  key: string;
  teamName: string;
  color: string;
  jobs: GridJob[];
  firstStart: number;
  lastEnd: number;
  /** Numéro affiché (« Tournée 3 ») — null pour la pile « sans équipe ». */
  number: number | null;
}

/** '8:00 AM' → { time: '8:00', suffix: 'AM' } ; 'fr-CA' → { time: '8 h 00' }. */
function splitTime(iso: string, fr: boolean): { time: string; suffix: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { time: '—', suffix: '' };
  const s = d.toLocaleTimeString(fr ? 'fr-CA' : 'en-US', { hour: 'numeric', minute: '2-digit' });
  const m = s.match(/^(.*?)\s*([AP])\.?\s*M\.?$/i);
  return m ? { time: m[1].trim(), suffix: `${m[2].toUpperCase()}M` } : { time: s, suffix: '' };
}

function fmtTime(iso: string, fr: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(fr ? 'fr-CA' : 'en-US', { hour: 'numeric', minute: '2-digit' });
}

export function ScheduleGridView({
  jobs,
  membersByTeam,
  onJobOpen,
  onJobLongPress,
}: {
  jobs: GridJob[];
  /** team_id → membres assignés. Clé absente = équipe sans membre connu. */
  membersByTeam: Map<string, RouteTeamMember[]>;
  onJobOpen: (jobId: string) => void;
  /** Appui long sur un contrat — replanification (remplace l'ancien glisser
   *  sur la grille 24 h, disparue avec elle). Omis = fonction désactivée. */
  onJobLongPress?: (job: GridJob) => void;
}) {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const routes = useMemo<DayRoute[]>(() => {
    const byTeam = new Map<string, GridJob[]>();
    for (const j of jobs) {
      const key = j.teamId || UNASSIGNED;
      const list = byTeam.get(key);
      if (list) list.push(j);
      else byTeam.set(key, [j]);
    }

    const built = [...byTeam.entries()].map(([key, list]) => {
      const sorted = [...list].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
      const starts = sorted.map((j) => new Date(j.startAt).getTime()).filter((n) => !Number.isNaN(n));
      const ends = sorted.map((j) => new Date(j.endAt).getTime()).filter((n) => !Number.isNaN(n));
      return {
        key,
        teamName: sorted[0].teamName,
        color: sorted[0].teamColor,
        jobs: sorted,
        firstStart: starts.length ? Math.min(...starts) : Number.MAX_SAFE_INTEGER,
        lastEnd: ends.length ? Math.max(...ends) : 0,
        number: null as number | null,
      };
    });

    // Tournée 1 = celle qui part le plus tôt. Les rendez-vous sans équipe
    // ferment la marche et ne sont jamais numérotés (ce n'est pas une tournée).
    built.sort((a, b) => {
      const au = a.key === UNASSIGNED;
      const bu = b.key === UNASSIGNED;
      if (au !== bu) return au ? 1 : -1;
      return a.firstStart - b.firstStart;
    });
    let n = 0;
    for (const r of built) if (r.key !== UNASSIGNED) r.number = ++n;
    return built;
  }, [jobs]);

  if (routes.length === 0) {
    return (
      <View className="flex-1 items-center pt-24">
        <SymbolView name="calendar" tintColor="#D4D4D4" size={40} resizeMode="scaleAspectFit" />
        <Text className="mt-3 px-8 text-center text-sm font-medium text-ink-muted">
          {fr ? 'Aucun contrat planifié cette journée' : 'No jobs scheduled this day'}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1"
      keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 120 }}
    >
      {routes.map((r) => {
        const isOpen = !collapsed.has(r.key);
        const members = membersByTeam.get(r.key) ?? [];
        const shown = members.slice(0, MAX_AVATARS);
        const extra = members.length - shown.length;
        const label =
          r.number == null
            ? fr
              ? 'Sans équipe'
              : 'Unassigned'
            : `${fr ? 'Tournée' : 'Route'} ${r.number}`;

        return (
          <View
            key={r.key}
            className="mb-3 overflow-hidden rounded-2xl border border-surface-border bg-white"
            style={{ borderLeftWidth: 4, borderLeftColor: r.color }}
          >
            {/* En-tête de tournée — appui = replier / déplier */}
            <Pressable
              onPress={() =>
                setCollapsed((cur) => {
                  const next = new Set(cur);
                  if (next.has(r.key)) next.delete(r.key);
                  else next.add(r.key);
                  return next;
                })
              }
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              accessibilityLabel={`${label} · ${r.teamName}`}
              className="px-4 py-3 active:bg-surface-sunken"
              style={{ backgroundColor: toRgba(r.color, 0.05) }}
            >
              <View className="flex-row items-center gap-2">
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: r.color }} />
                <Text className="text-[15px] font-bold text-ink">{label}</Text>
                {r.number != null ? (
                  <Text numberOfLines={1} className="min-w-0 flex-1 text-xs font-medium text-ink-muted">
                    {r.teamName}
                  </Text>
                ) : (
                  <View className="flex-1" />
                )}
                <SymbolView
                  name={isOpen ? 'chevron.up' : 'chevron.down'}
                  tintColor="#A3A3A3"
                  size={12}
                  resizeMode="scaleAspectFit"
                />
              </View>

              {/* Heures prévues + nombre d'arrêts */}
              <View className="mt-1.5 flex-row items-center gap-1.5">
                <SymbolView name="clock" tintColor="#737373" size={11} resizeMode="scaleAspectFit" />
                <Text className="text-[11.5px] font-medium text-ink-muted">
                  {r.lastEnd > 0
                    ? `${fmtTime(new Date(r.firstStart).toISOString(), fr)} – ${fmtTime(new Date(r.lastEnd).toISOString(), fr)}`
                    : '—'}
                </Text>
                <Text className="text-[11.5px] text-ink-subtle">·</Text>
                <Text className="text-[11.5px] font-medium text-ink-muted">
                  {r.jobs.length} {r.jobs.length > 1 ? (fr ? 'arrêts' : 'stops') : fr ? 'arrêt' : 'stop'}
                </Text>
              </View>

              {/* Membres assignés à l'équipe */}
              {shown.length > 0 ? (
                <View className="mt-2 flex-row items-center">
                  <View className="flex-row">
                    {shown.map((m, i) => (
                      <View
                        key={m.userId}
                        style={{ marginLeft: i === 0 ? 0 : -8, borderRadius: 12, borderWidth: 1.5, borderColor: '#FFFFFF' }}
                      >
                        <UnifiedAvatar id={m.userId} name={m.name} size={22} url={m.avatarUrl} />
                      </View>
                    ))}
                  </View>
                  <Text numberOfLines={1} className="ml-2 min-w-0 flex-1 text-[11px] text-ink-subtle">
                    {shown.map((m) => m.name).join(', ')}
                    {extra > 0 ? ` +${extra}` : ''}
                  </Text>
                </View>
              ) : null}
            </Pressable>

            {/* Les contrats de cette tournée */}
            {isOpen ? (
              <View className="border-t border-surface-border">
                {r.jobs.map((j, i) => {
                  const st = statusStyle(j.status);
                  const start = splitTime(j.startAt, fr);
                  return (
                    <Pressable
                      key={j.id}
                      onPress={() => j.jobId && onJobOpen(j.jobId)}
                      onLongPress={onJobLongPress ? () => onJobLongPress(j) : undefined}
                      delayLongPress={400}
                      accessibilityRole="button"
                      accessibilityLabel={`${j.clientName || j.title} · ${fmtTime(j.startAt, fr)}`}
                      className={`flex-row items-start gap-3 px-3 py-2.5 active:bg-surface-sunken ${
                        i > 0 ? 'border-t border-surface-border' : ''
                      }`}
                    >
                      {/* Heure prévue — 58 px : « 13 h 30 » (format 24 h du
                          français) doit tenir sans être tronqué. */}
                      <View style={{ width: 58 }} className="items-center pt-0.5">
                        <Text numberOfLines={1} className="text-[13px] font-bold text-ink">
                          {start.time}
                        </Text>
                        {start.suffix ? (
                          <Text className="text-[9.5px] font-semibold uppercase text-ink-subtle">{start.suffix}</Text>
                        ) : null}
                      </View>

                      {/* Client · titre · adresse · statut + plage */}
                      <View className="min-w-0 flex-1">
                        <Text numberOfLines={1} className="text-[13.5px] font-bold text-ink">
                          {j.clientName || (fr ? 'Sans client' : 'No client')}
                        </Text>
                        <Text numberOfLines={1} className="mt-0.5 text-[12px] text-ink-muted">
                          {j.title}
                        </Text>
                        {j.address ? (
                          <Text numberOfLines={1} className="mt-0.5 text-[11px] text-ink-subtle">
                            {j.address}
                          </Text>
                        ) : null}
                        <View className="mt-1.5 flex-row flex-wrap items-center gap-2">
                          {j.status ? (
                            <View
                              style={{ backgroundColor: st.bg }}
                              className="flex-row items-center gap-1 rounded-full px-2 py-0.5"
                            >
                              <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: st.solid }} />
                              <Text style={{ color: st.text }} className="text-[10px] font-semibold">
                                {statusLabel(j.status, t.mobileComp)}
                              </Text>
                            </View>
                          ) : null}
                          <Text className="text-[10.5px] font-medium text-ink-subtle">
                            {fmtTime(j.startAt, fr)} – {fmtTime(j.endAt, fr)}
                          </Text>
                        </View>
                      </View>

                      <SymbolView
                        name="chevron.right"
                        tintColor="#A3A3A3"
                        size={12}
                        resizeMode="scaleAspectFit"
                        style={{ marginTop: 4 }}
                      />
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}
