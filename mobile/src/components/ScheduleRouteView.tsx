// « Trajet du jour » — mobile adaptation of the web AgendaRoutePanel
// (src/components/schedule/AgendaRoutePanel.tsx on main): one optimized,
// colour-coded trip per team on a shared Mapbox map (numbered DiceBear drop
// pins), with per-team progress, drive legs, cascading ETAs, lateness, and
// "open in Google Maps". The map runs in a WebView (same approach as
// D2DWebMap) since react-native-maps has no Mapbox styles.

import * as Location from 'expo-location';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import UnifiedAvatar from '@/components/ui/UnifiedAvatar';
import {
  formatDistance,
  formatDuration,
  getOptimizedRoute,
  getRoute,
  RouteResult,
  RouteStop,
} from '@/lib/api/route';
import { formatCurrencyCents } from '@/lib/format';
import { useTranslation } from '@/lib/i18n';

const DONE_STATUSES = new Set(['completed', 'done', 'paid', 'closed', 'invoiced']);

type StartMode = 'first' | 'me';

// One job the route view can plot — same shape as the web's RouteJob.
export interface RouteJob {
  id: string; // event id
  jobId: string | null;
  title: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  startAt: string;
  teamId: string; // '' when unassigned
  teamName: string;
  teamColor: string;
  clientId: string | null;
  clientName: string;
  revenueCents: number;
  status: string;
}

interface TeamRoute {
  teamId: string;
  teamName: string;
  color: string;
  jobs: RouteJob[]; // in travel order
  route: RouteResult | null;
  etas: (Date | null)[];
  ungeocoded: RouteJob[];
  revenueCents: number;
  done: number;
  savedSeconds: number;
  savedMeters: number;
}

function dicebearUrl(seed: string) {
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(seed || 'x')}&size=80&backgroundColor=f5f5f5&radius=50`;
}

function googleMapsTripUrl(stops: { lat: number; lng: number }[], start?: { lat: number; lng: number } | null): string | null {
  const all = start ? [start, ...stops] : stops;
  if (all.length < 1) return null;
  const pt = (s: { lat: number; lng: number }) => `${s.lat},${s.lng}`;
  const base = `https://www.google.com/maps/dir/?api=1&origin=${pt(all[0])}&destination=${pt(all[all.length - 1])}&travelmode=driving`;
  const waypoints = all.slice(1, -1).map(pt).join('|');
  return waypoints ? `${base}&waypoints=${encodeURIComponent(waypoints)}` : base;
}

/* ── Map HTML (Mapbox GL in a WebView, one coloured line per team) ── */
function mapHtml(routes: TeamRoute[], startPoint: { lat: number; lng: number } | null, token: string): string {
  const payload = {
    start: startPoint,
    routes: routes.map((r) => ({
      color: r.color,
      geometry: r.route && r.route.geometry.length >= 2 ? r.route.geometry : r.jobs.filter((j) => j.lat != null).map((j) => [j.lng, j.lat]),
      stops: r.jobs
        .filter((j) => j.lat != null && j.lng != null)
        .map((j, i) => ({ id: j.id, jobId: j.jobId, lat: j.lat, lng: j.lng, n: i + 1, img: dicebearUrl(j.clientId || j.id) })),
    })),
  };
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link href="https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.css" rel="stylesheet">
<script src="https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.js"></script>
<style>html,body,#map{margin:0;height:100%;width:100%}</style></head><body><div id="map"></div><script>
const D=${JSON.stringify(payload)};
mapboxgl.accessToken=${JSON.stringify(token)};
const map=new mapboxgl.Map({container:'map',style:'mapbox://styles/mapbox/light-v11',center:[-72.5485,46.343],zoom:10,attributionControl:false});
const post=(m)=>window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m));
map.on('load',()=>{
  const b=new mapboxgl.LngLatBounds();let has=false;
  if(D.start){const el=document.createElement('div');el.style.cssText='width:16px;height:16px;border-radius:50%;background:#171717;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)';
    new mapboxgl.Marker({element:el,anchor:'center'}).setLngLat([D.start.lng,D.start.lat]).addTo(map);b.extend([D.start.lng,D.start.lat]);has=true;}
  D.routes.forEach((r,ri)=>{
    if(r.geometry.length>=2){map.addSource('s'+ri,{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:r.geometry}}});
      map.addLayer({id:'l'+ri,type:'line',source:'s'+ri,layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':r.color,'line-width':4,'line-opacity':0.9}});}
    r.stops.forEach((s)=>{
      const el=document.createElement('div');el.style.cssText='display:flex;flex-direction:column;align-items:center;cursor:pointer;';
      const idx=document.createElement('div');idx.textContent=String(s.n);
      idx.style.cssText='font:800 10px Inter,system-ui,sans-serif;color:#171717;background:#fff;border:1px solid #e5e5e5;border-radius:999px;padding:0 5px;line-height:15px;margin-bottom:-4px;z-index:2;box-shadow:0 1px 3px rgba(0,0,0,.15)';
      const drop=document.createElement('div');
      drop.style.cssText='width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:'+r.color+';border:2.5px solid #fff;box-shadow:0 2px 7px rgba(0,0,0,.32);overflow:hidden;display:flex;align-items:center;justify-content:center';
      const img=document.createElement('img');img.src=s.img;img.style.cssText='width:100%;height:100%;transform:rotate(45deg) scale(1.42)';
      drop.appendChild(img);el.appendChild(idx);el.appendChild(drop);
      el.addEventListener('click',(e)=>{e.stopPropagation();post({type:'stop',id:s.id,jobId:s.jobId});});
      new mapboxgl.Marker({element:el,anchor:'bottom'}).setLngLat([s.lng,s.lat]).addTo(map);
      b.extend([s.lng,s.lat]);has=true;});
  });
  if(has)map.fitBounds(b,{padding:44,maxZoom:15,duration:0});
});
window.__fly=(lng,lat)=>map.flyTo({center:[lng,lat],zoom:Math.max(map.getZoom(),14),duration:500});
</script></body></html>`;
}

export function ScheduleRouteView({ jobs, onJobOpen }: { jobs: RouteJob[]; onJobOpen: (jobId: string) => void }) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';

  const [startMode, setStartMode] = useState<StartMode>('first');
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const webRef = useRef<WebView>(null);

  async function chooseStart(mode: StartMode) {
    if (mode === 'me' && !myPos) {
      setLocating(true);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setMyPos({ lat: p.coords.latitude, lng: p.coords.longitude });
          setStartMode('me');
        }
      } finally {
        setLocating(false);
      }
      return;
    }
    setStartMode(mode);
  }

  const startPoint = startMode === 'me' ? myPos : null;

  // Group jobs by team (stable order: first appearance), sorted by planned time.
  const teams = useMemo(() => {
    const order: string[] = [];
    const byTeam = new Map<string, RouteJob[]>();
    for (const j of jobs) {
      const key = j.teamId || '__none__';
      if (!byTeam.has(key)) {
        byTeam.set(key, []);
        order.push(key);
      }
      byTeam.get(key)!.push(j);
    }
    return order.map((key) => {
      const list = byTeam.get(key)!;
      list.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
      return { key, name: list[0].teamName, color: list[0].teamColor, jobs: list };
    });
  }, [jobs]);

  // Result keyed on its inputs — `loading` is derived (no setState-in-effect).
  const [computed, setComputed] = useState<{ key: string; routes: TeamRoute[] } | null>(null);

  const jobsKey = useMemo(() => teams.map((t) => `${t.key}:${t.jobs.map((j) => j.id).join('-')}`).join('|'), [teams]);
  const startKey = startPoint ? `${startPoint.lat},${startPoint.lng}` : 'first';
  const computeKey = `${jobsKey}::${startKey}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        teams.map(async (t): Promise<TeamRoute> => {
          const geocoded = t.jobs.filter((j) => j.lat != null && j.lng != null);
          const ungeocoded = t.jobs.filter((j) => j.lat == null || j.lng == null);
          const byId = new Map(geocoded.map((j) => [j.id, j]));

          let route: RouteResult | null = null;
          let orderedJobs: RouteJob[] = geocoded;
          let savedSeconds = 0,
            savedMeters = 0;

          if (geocoded.length >= 2) {
            const START = '__start__';
            const mk = (list: RouteJob[]): RouteStop[] => {
              const s: RouteStop[] = [];
              if (startPoint) s.push({ id: START, lat: startPoint.lat, lng: startPoint.lng });
              list.forEach((j) => s.push({ id: j.id, lat: j.lat!, lng: j.lng! }));
              return s;
            };
            const [r, chrono] = await Promise.all([
              getOptimizedRoute(mk(geocoded), !!startPoint),
              getRoute(mk(geocoded)).catch(() => null),
            ]);
            const order = r.order.filter((id) => id !== START);
            orderedJobs = order.map((id) => byId.get(id)).filter(Boolean) as RouteJob[];
            route = r;
            if (chrono) {
              savedSeconds = Math.max(0, chrono.totalDurationS - r.totalDurationS);
              savedMeters = Math.max(0, chrono.totalDistanceM - r.totalDistanceM);
            }
          }

          // Stops dropped by the optimizer's cap (Mapbox ≤ 12) must not vanish silently.
          const routedIds = new Set(orderedJobs.map((j) => j.id));
          const overCap = geocoded.filter((j) => !routedIds.has(j.id));

          // Cascading ETA from the first stop's planned time + drive + 30 min on site.
          const legOffset = startPoint ? 1 : 0;
          const etas: (Date | null)[] = [];
          if (orderedJobs.length) {
            let cur = new Date(orderedJobs[0].startAt);
            etas.push(cur);
            for (let i = 1; i < orderedJobs.length; i++) {
              const driveS = route?.legs[i + legOffset]?.durationS ?? 0;
              cur = new Date(cur.getTime() + (driveS + 30 * 60) * 1000);
              etas.push(cur);
            }
          }

          const revenueCents = t.jobs.reduce((sum, j) => sum + (j.revenueCents || 0), 0);
          const done = t.jobs.filter((j) => DONE_STATUSES.has(j.status)).length;
          return {
            teamId: t.key,
            teamName: t.name,
            color: t.color,
            jobs: orderedJobs,
            route,
            etas,
            ungeocoded: [...ungeocoded, ...overCap],
            revenueCents,
            done,
            savedSeconds,
            savedMeters,
          };
        }),
      );
      if (!cancelled) setComputed({ key: `${jobsKey}::${startKey}`, routes: results });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsKey, startKey]);

  const routes = useMemo(() => computed?.routes ?? [], [computed]);
  const loading = computed?.key !== computeKey;

  const totals = useMemo(() => {
    let dist = 0,
      dur = 0,
      trips = 0,
      revenueCents = 0;
    for (const r of routes) {
      if (r.route && r.jobs.length >= 2) {
        dist += r.route.totalDistanceM;
        dur += r.route.totalDurationS;
        trips++;
      }
      revenueCents += r.revenueCents;
    }
    return { dist, dur, trips, revenueCents };
  }, [routes]);

  const onMapMessage = (e: WebViewMessageEvent) => {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.type === 'stop' && m.jobId) onJobOpen(m.jobId);
    } catch {
      /* ignore */
    }
  };

  const focusStop = (j: RouteJob) => {
    if (j.lat != null && j.lng != null) webRef.current?.injectJavaScript(`window.__fly&&window.__fly(${j.lng},${j.lat});true;`);
  };

  const fmtTime = (d: Date) => d.toLocaleTimeString(fr ? 'fr-CA' : 'en-US', { hour: 'numeric', minute: '2-digit' });

  // Une « tournée » n'existe qu'à partir de 2 arrêts géolocalisés pour une même
  // équipe. En dessous, la journée n'est que des rendez-vous isolés : on montre
  // quand même la carte (pins) + la liste, sans le chrome d'optimisation.
  const anyRoutable = routes.some((r) => r.jobs.length >= 2);
  const html = useMemo(() => mapHtml(routes, startPoint, token), [routes, startPoint, token]);
  const mapKey = useMemo(() => `${jobsKey}::${startKey}::${routes.length}::${loading}`, [jobsKey, startKey, routes.length, loading]);
  const anyGeocoded = routes.some((r) => r.jobs.length > 0);

  if (jobs.length === 0) {
    return (
      <View className="items-center py-20">
        <SymbolView name="calendar" tintColor="#D4D4D4" size={40} resizeMode="scaleAspectFit" />
        <Text className="mt-3 text-sm font-medium text-ink-muted">
          {fr ? 'Aucun rendez-vous aujourd’hui' : 'No appointments today'}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
      {/* Bar: title + start-from + totals */}
      <View className="mx-4 rounded-t-2xl border border-b-0 border-surface-border bg-white px-4 pb-3 pt-3">
        <View className="flex-row items-center gap-2">
          <SymbolView name="point.topleft.down.curvedto.point.bottomright.up" tintColor="#525252" size={14} resizeMode="scaleAspectFit" />
          <Text className="text-sm font-bold text-ink">
            {anyRoutable ? (fr ? 'Trajet du jour' : "Day's route") : fr ? 'Rendez-vous du jour' : "Day's appointments"}
          </Text>
          {anyRoutable ? (
            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: '#ECFDF5' }}>
              <Text className="text-[10px] font-bold" style={{ color: '#059669' }}>
                {fr ? 'Optimisé' : 'Optimized'}
              </Text>
            </View>
          ) : null}
          {loading ? <ActivityIndicator size="small" color="#A3A3A3" style={{ marginLeft: 'auto' }} /> : null}
        </View>

        <View className="mt-2.5 flex-row items-center justify-between">
          {anyRoutable ? (
            <View className="flex-row items-center gap-1.5">
              <Text className="text-[11px] font-medium text-ink-subtle">{fr ? 'Départ' : 'Start'}</Text>
              <View className="flex-row overflow-hidden rounded-lg border border-surface-border">
                {(['first', 'me'] as StartMode[]).map((m) => (
                  <Pressable key={m} onPress={() => chooseStart(m)} disabled={locating} className={`px-2.5 py-1 ${startMode === m ? 'bg-ink' : 'bg-white'}`}>
                    <Text className={`text-[11px] font-semibold ${startMode === m ? 'text-white' : 'text-ink-muted'}`}>
                      {m === 'first' ? (fr ? '1er arrêt' : 'First stop') : locating ? (fr ? 'Localisation…' : 'Locating…') : fr ? 'Ma position' : 'My location'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            <Text className="text-[11px] text-ink-subtle">
              {jobs.length} {jobs.length > 1 ? (fr ? 'rendez-vous' : 'appointments') : fr ? 'rendez-vous' : 'appointment'}
            </Text>
          )}
          <View className="flex-row items-center gap-3">
            {totals.trips > 0 ? (
              <>
                <Totals value={String(totals.trips)} label={fr ? 'Tournées' : 'Trips'} />
                <Totals value={formatDistance(totals.dist, fr)} label="Distance" />
                <Totals value={formatDuration(totals.dur, fr)} label={fr ? 'Conduite' : 'Drive'} />
              </>
            ) : null}
            {totals.revenueCents > 0 ? <Totals value={formatCurrencyCents(totals.revenueCents)} label={fr ? 'Revenu' : 'Revenue'} accent /> : null}
          </View>
        </View>
      </View>

      {/* Map — only when at least one stop (or the start point) can be plotted */}
      {anyGeocoded || startPoint ? (
        <View className="mx-4 overflow-hidden border border-surface-border" style={{ height: 300 }}>
          <WebView
            key={mapKey}
            ref={webRef}
            source={{ html }}
            onMessage={onMapMessage}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            style={{ flex: 1 }}
          />
        </View>
      ) : null}

      {/* Per-team trips */}
      <View className="mx-4 rounded-b-2xl border border-t-0 border-surface-border bg-white pb-2">
        {routes.map((r, ti) => {
          const late = r.jobs.reduce((n, j, i) => {
            const eta = r.etas[i];
            return n + (eta && eta.getTime() - new Date(j.startAt).getTime() > 5 * 60_000 ? 1 : 0);
          }, 0);
          const mapsUrl = googleMapsTripUrl(
            r.jobs.filter((j) => j.lat != null && j.lng != null).map((j) => ({ lat: j.lat!, lng: j.lng! })),
            startPoint,
          );
          return (
            <View key={r.teamId} className={ti > 0 ? 'border-t-4 border-surface-sunken' : ''}>
              {/* team header */}
              <View className="px-4 pb-2 pt-3">
                <View className="flex-row items-center gap-2">
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: r.color }} />
                  <Text className="text-sm font-bold text-ink">{r.teamName}</Text>
                  {r.revenueCents > 0 ? (
                    <Text className="ml-auto text-xs font-extrabold" style={{ color: '#059669' }}>
                      {formatCurrencyCents(r.revenueCents)}
                    </Text>
                  ) : null}
                </View>
                {r.jobs.length > 0 ? (
                  <View className="mt-2">
                    <View className="mb-1 flex-row items-center justify-between">
                      <Text className="text-[10px] text-ink-subtle">
                        {r.done}/{r.jobs.length} {fr ? 'faits' : 'done'}
                      </Text>
                      {late > 0 ? (
                        <Text className="text-[10px] font-semibold" style={{ color: '#D97706' }}>
                          {late} {fr ? 'en retard' : 'late'}
                        </Text>
                      ) : null}
                    </View>
                    <View className="h-1 overflow-hidden rounded-full bg-surface-sunken">
                      <View style={{ width: `${(r.done / r.jobs.length) * 100}%`, backgroundColor: r.color }} className="h-full rounded-full" />
                    </View>
                  </View>
                ) : null}
                <View className="mt-2 flex-row items-center gap-2.5">
                  {r.route && r.jobs.length >= 2 ? (
                    <Text className="text-[10.5px] text-ink-subtle">
                      {r.jobs.length} {fr ? 'arrêts' : 'stops'} · {formatDistance(r.route.totalDistanceM, fr)} · {formatDuration(r.route.totalDurationS, fr)}
                    </Text>
                  ) : null}
                  {mapsUrl ? (
                    <Pressable onPress={() => Linking.openURL(mapsUrl)} className="ml-auto flex-row items-center gap-1 rounded-md border border-surface-border px-2 py-1">
                      <SymbolView name="arrow.up.forward.square" tintColor="#525252" size={11} resizeMode="scaleAspectFit" />
                      <Text className="text-[10.5px] font-semibold text-ink-muted">{fr ? 'Ouvrir dans Maps' : 'Open in Maps'}</Text>
                    </Pressable>
                  ) : null}
                </View>
                {r.savedSeconds >= 60 ? (
                  <View className="mt-1.5 self-start rounded-md px-2 py-0.5" style={{ backgroundColor: '#ECFDF5' }}>
                    <Text className="text-[10.5px] font-semibold" style={{ color: '#059669' }}>
                      {fr
                        ? `Économie ${formatDuration(r.savedSeconds, fr)}${r.savedMeters >= 300 ? ` · ${formatDistance(r.savedMeters, fr)}` : ''} vs par heure`
                        : `Saves ${formatDuration(r.savedSeconds, fr)}${r.savedMeters >= 300 ? ` · ${formatDistance(r.savedMeters, fr)}` : ''} vs by-time`}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* stops */}
              <View className="px-2 pb-1">
                {r.jobs.map((j, i) => {
                  const planned = new Date(j.startAt);
                  const eta = r.etas[i];
                  const moved = eta && Math.abs(eta.getTime() - planned.getTime()) > 5 * 60_000;
                  const isLate = eta && eta.getTime() - planned.getTime() > 5 * 60_000;
                  const leg = i > 0 ? r.route?.legs[i + (startPoint ? 1 : 0)] : undefined;
                  const done = DONE_STATUSES.has(j.status);
                  return (
                    <View key={j.id}>
                      {leg && (leg.distanceM > 0 || leg.durationS > 0) ? (
                        <View className="ml-8 flex-row items-center gap-1.5 py-1">
                          <View className="h-3 w-px bg-surface-border" />
                          <SymbolView name="car.fill" tintColor="#A3A3A3" size={10} resizeMode="scaleAspectFit" />
                          <Text className="text-[10.5px] text-ink-subtle">
                            {formatDistance(leg.distanceM, fr)}
                            {leg.durationS > 0 ? ` · ${formatDuration(leg.durationS, fr)}` : ''}
                          </Text>
                        </View>
                      ) : null}
                      <Pressable onPress={() => focusStop(j)} className="flex-row items-center gap-2 rounded-xl px-2 py-2 active:bg-surface-sunken">
                        <Text className="w-4 text-center text-xs font-bold text-ink-muted">{i + 1}</Text>
                        <View className="relative">
                          <UnifiedAvatar id={j.clientId || j.id} name={j.clientName || j.title} size={32} />
                          {done ? (
                            <View className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white">
                              <SymbolView name="checkmark.circle.fill" tintColor="#059669" size={13} resizeMode="scaleAspectFit" />
                            </View>
                          ) : null}
                        </View>
                        <View className="min-w-0 flex-1">
                          <Text numberOfLines={1} className={`text-[12.5px] font-semibold ${done ? 'text-ink-subtle line-through' : 'text-ink'}`}>
                            {j.clientName ? `${j.clientName} · ${j.title}` : j.title}
                          </Text>
                          {j.address ? (
                            <Text numberOfLines={1} className="text-[11px] text-ink-subtle">
                              {j.address}
                            </Text>
                          ) : null}
                        </View>
                        {j.revenueCents > 0 ? (
                          <Text className="text-[11.5px] font-bold" style={{ color: '#059669' }}>
                            {formatCurrencyCents(j.revenueCents)}
                          </Text>
                        ) : null}
                        <View className="items-end">
                          <Text className="text-xs font-bold" style={{ color: isLate ? '#D97706' : '#171717' }}>
                            {fmtTime(eta ?? planned)}
                          </Text>
                          {moved ? (
                            <Text className="text-[9.5px] text-ink-subtle">
                              {fr ? 'prévu' : 'planned'} {fmtTime(planned)}
                            </Text>
                          ) : null}
                        </View>
                        <Pressable onPress={() => j.jobId && onJobOpen(j.jobId)} hitSlop={6} className="p-1">
                          <SymbolView name="chevron.right" tintColor="#A3A3A3" size={11} resizeMode="scaleAspectFit" />
                        </Pressable>
                      </Pressable>
                    </View>
                  );
                })}
              </View>

              {/* Rendez-vous sans géolocalisation (ou au-delà du cap de 12 arrêts) :
                  affichés comme des lignes normales, jamais réduits à un compteur. */}
              {r.ungeocoded.length > 0 ? (
                <View className="border-t border-surface-border px-2 pb-2 pt-1">
                  {r.ungeocoded.map((j) => {
                    const done = DONE_STATUSES.has(j.status);
                    return (
                      <Pressable
                        key={j.id}
                        onPress={() => j.jobId && onJobOpen(j.jobId)}
                        className="flex-row items-center gap-2 rounded-xl px-2 py-2 active:bg-surface-sunken"
                      >
                        <SymbolView name="mappin.slash" tintColor="#A3A3A3" size={13} resizeMode="scaleAspectFit" style={{ width: 16 }} />
                        <UnifiedAvatar id={j.clientId || j.id} name={j.clientName || j.title} size={32} />
                        <View className="min-w-0 flex-1">
                          <Text numberOfLines={1} className={`text-[12.5px] font-semibold ${done ? 'text-ink-subtle line-through' : 'text-ink'}`}>
                            {j.clientName ? `${j.clientName} · ${j.title}` : j.title}
                          </Text>
                          <Text className="text-[11px] text-ink-subtle">{fr ? 'Adresse non géolocalisée' : 'Address not geolocated'}</Text>
                        </View>
                        {j.revenueCents > 0 ? (
                          <Text className="text-[11.5px] font-bold" style={{ color: '#059669' }}>
                            {formatCurrencyCents(j.revenueCents)}
                          </Text>
                        ) : null}
                        <Text className="text-xs font-bold text-ink">{fmtTime(new Date(j.startAt))}</Text>
                        <SymbolView name="chevron.right" tintColor="#A3A3A3" size={11} resizeMode="scaleAspectFit" />
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function Totals({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <View className="items-end">
      <Text className="text-[13px] font-extrabold" style={{ color: accent ? '#059669' : '#171717' }}>
        {value}
      </Text>
      <Text className="text-[8.5px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</Text>
    </View>
  );
}
