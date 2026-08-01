/**
 * HeightTool3D — measure a building's height by placing TWO points and taking the
 * difference of their surface elevations.
 *
 * Reliable 2D satellite map (single-click). For each clicked point we read its
 * surface elevation: a point on a roof returns the real roof height (Solar DSM),
 * a point on the ground returns terrain elevation. Height = |elev(B) − elev(A)|.
 *
 * Fully isolated from the drawing workspace. Stored as an ordinary 2-point 'line'
 * with metadata.kind === 'height' (no DB schema change). Manual fallback when the
 * two points end up too close (e.g. no Solar roof data → both read terrain).
 */

import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Search, Loader2, RotateCcw, Check, MoveVertical, X } from 'lucide-react';
import { toast } from 'sonner';
import type { LatLng, UnitSystem, Shape } from '../../lib/measurementTypes';
import { nextColor, elevationStats, formatElevation } from '../../lib/measurementEngine';
import { groundElevation, roofElevation, wallDistance } from '../../lib/buildingHeightApi';
import { useGMaps3D } from './useGMaps3D';
import Cam3DControls from './Cam3DControls';

const FT_TO_M = 0.3048;
const M_TO_FT = 1 / FT_TO_M;
const MIN_HEIGHT_M = 1;
// Hauteur typique de la caméra des voitures Street View (m). Sert de référence
// d'échelle au mode Photo : cliquer le pied du mur (angle sous l'horizon) donne
// la distance, puis l'angle du sommet donne la hauteur. C'est une ESTIMATION.
const SV_CAMERA_HEIGHT_M = 2.6; // flotte Street View récente (~2,6 m)

interface Props {
  quoteAddress: string;
  fr: boolean;
  unitSystem: UnitSystem;
  index: number;
  onComplete: (shape: Shape) => void;
  onClose: () => void;
}

type Pt = { lat: number; lng: number; elev: number | null; onBuilding: boolean; loading: boolean; from3d?: boolean };

// Mode Photo : un point cliqué (écran + angles absolus du rayon)
type SvPoint = { x: number; y: number; pitch: number; heading: number };
type SvCote = { a: SvPoint; b: SvPoint; len: number; kind: 'V' | 'H' | 'D' };

export default function HeightTool3D({ quoteAddress, fr, unitSystem, index, onComplete, onClose }: Props) {
  const { ok: mapsOk, key } = useGMaps3D();

  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const map3dRef = useRef<any>(null); // gmp-map-3d element (mode 3D photoréaliste)
  const overlays3d = useRef<HTMLElement[]>([]);
  const lastClick3d = useRef<{ t: number; lat: number; lng: number } | null>(null);
  const gcRef = useRef<google.maps.Geocoder | null>(null);
  const markers = useRef<google.maps.Marker[]>([]);
  const aRef = useRef<Pt | null>(null);
  const bRef = useRef<Pt | null>(null);

  const [ready, setReady] = useState(false);
  // Mode 3D photoréaliste : tenté par défaut, repli automatique sur la carte
  // satellite 2D si l'élément <gmp-map-3d> ne s'initialise pas.
  const [wants3d, setWants3d] = useState(true);
  const [is3d, setIs3d] = useState(false);
  const [search, setSearch] = useState(quoteAddress || '');
  const [searching, setSearching] = useState(false);
  const [ptA, setPtA] = useState<Pt | null>(null);
  const [ptB, setPtB] = useState<Pt | null>(null);
  const [manualH, setManualH] = useState('');

  // ── Mode « Photo » (Street View) — mesure par estimation trigonométrique ──
  const streetPanoDiv = useRef<HTMLDivElement>(null);
  const panoRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const svTargetRef = useRef<{ lat: number; lng: number } | null>(null);
  const [streetMode, setStreetMode] = useState(false);
  const [streetState, setStreetState] = useState<'idle' | 'loading' | 'ok' | 'none'>('idle');
  const [svMeasuring, setSvMeasuring] = useState(false);
  // Flux « référence d'abord » : l'échelle vient d'un objet de dimension connue
  // (porte) cliqué en premier — triangulation exacte, immune au géocodage, au
  // terrain et à la hauteur de caméra. 'ref' = cliquer la référence, 'refValue'
  // = dire sa vraie dimension, 'measure' = mesurer les cotes.
  const [svPhase, setSvPhase] = useState<'ref' | 'refValue' | 'measure'>('ref');
  const [svRefPts, setSvRefPts] = useState<SvPoint[]>([]);
  const [svRefVal, setSvRefVal] = useState('');
  const svRefLocked = useRef(false);
  const svRefHeading = useRef<number | null>(null);
  // Point de référence au sol (calibration d'échelle) + distance au mur déduite.
  const [svCal, setSvCal] = useState<{ pitch: number; heading: number; x: number; y: number } | null>(null);
  const [svD, setSvD] = useState<number | null>(null);
  // Cotes mesurées sur le plan du mur : écran (x,y) + plan (X latéral, Y hauteur) en mètres.
  const [svCotes, setSvCotes] = useState<SvCote[]>([]);
  const [svPending, setSvPending] = useState<SvPoint | null>(null);
  // Étalonnage : facteur appliqué à toutes les cotes du mur. La distance
  // géocodée pointe le CENTRE du bâtiment (pas le mur) → biais systématique
  // (~+10 %). Étalonner sur une dimension connue (ex. porte 6 pi 8) le corrige.
  const [svScale, setSvScale] = useState(1);
  // Distance au mur dérivée du dernier clic « au sol » (auto-portée, par cote) —
  // plus fiable que le géocodage/contour quand la cote part du pied du mur.
  const svWallD = useRef<number | null>(null);
  // Dénivelé terrain (élévation caméra − élévation au bâtiment, m). Corrige les
  // entrées de garage en pente / maisons surélevées: la hauteur effective de la
  // caméra au-dessus du pied du mur n'est pas 2,6 m quand le terrain monte.
  const svElevDelta = useRef<number>(0);
  const [svCalibIdx, setSvCalibIdx] = useState<number | null>(null);
  const [svCalibVal, setSvCalibVal] = useState('');

  function setA(p: Pt | null) { aRef.current = p; setPtA(p); }
  function setB(p: Pt | null) { bRef.current = p; setPtB(p); }

  async function resolve(which: 'A' | 'B', lat: number, lng: number) {
    // Point 1 = base → ground/terrain; point 2 = top → roof (Solar DSM).
    const elev = which === 'A'
      ? await groundElevation(lat, lng).catch(() => null)
      : await roofElevation(lat, lng, key).catch(() => null);
    const cur = which === 'A' ? aRef.current : bRef.current;
    if (!cur || cur.lat !== lat || cur.lng !== lng) return; // superseded by a redo
    const done: Pt = { lat, lng, elev, onBuilding: which === 'B' && elev != null, loading: false };
    if (which === 'A') setA(done); else setB(done);
  }

  function onMapClick(lat: number, lng: number) {
    if (!aRef.current) {
      const p: Pt = { lat, lng, elev: null, onBuilding: false, loading: true };
      setA(p); resolve('A', lat, lng);
    } else if (!bRef.current) {
      const p: Pt = { lat, lng, elev: null, onBuilding: false, loading: true };
      setB(p); resolve('B', lat, lng);
    }
  }

  /** Clic sur la carte 3D photoréaliste : l'altitude du point cliqué (tuiles 3D)
   *  donne l'élévation directement — base au sol, sommet sur le bâtiment.
   *  Sans altitude (cas bêta), on retombe sur la résolution Solar/terrain. */
  function onMapClick3d(lat: number, lng: number, altitude: number | null) {
    const which: 'A' | 'B' | null = !aRef.current ? 'A' : !bRef.current ? 'B' : null;
    if (!which) return;
    if (altitude != null && Number.isFinite(altitude)) {
      const p: Pt = { lat, lng, elev: altitude, onBuilding: which === 'B', loading: false, from3d: true };
      if (which === 'A') setA(p); else setB(p);
    } else {
      const p: Pt = { lat, lng, elev: null, onBuilding: false, loading: true };
      if (which === 'A') setA(p); else setB(p);
      resolve(which, lat, lng);
    }
  }

  function flyTo(lat: number, lng: number) {
    if (map3dRef.current) {
      try {
        map3dRef.current.center = { lat, lng, altitude: 0 };
        map3dRef.current.range = 250;
        map3dRef.current.tilt = 65;
        return;
      } catch { /* retombe sur la carte 2D */ }
    }
    const m = mapRef.current; if (!m) return;
    m.setCenter({ lat, lng }); m.setZoom(20);
  }
  function centerOnUser() {
    try {
      const raw = localStorage.getItem('d2d-last-gps');
      if (raw) { const p = JSON.parse(raw); if (typeof p?.lat === 'number') flyTo(p.lat, p.lng); }
    } catch {}
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => flyTo(pos.coords.latitude, pos.coords.longitude),
      () => {}, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  }

  // ── Init : carte 3D photoréaliste (avec repli 2D après 4 s) ──
  useEffect(() => {
    if (!mapsOk || !wants3d || !mapDiv.current || map3dRef.current || mapRef.current) return;
    let disposed = false;
    let map3d: any = null;
    try {
      map3d = document.createElement('gmp-map-3d') as any;
      map3d.setAttribute('center', '45.5017,-73.5673,0');
      map3d.setAttribute('tilt', '65');
      map3d.setAttribute('heading', '0');
      map3d.setAttribute('range', '400');
      map3d.setAttribute('mode', 'hybrid');
      map3d.style.width = '100%';
      map3d.style.height = '100%';
      mapDiv.current.appendChild(map3d);
    } catch {
      setWants3d(false);
      return;
    }

    const elementReady = () =>
      Boolean((window as any).customElements?.get('gmp-map-3d')) && map3d.center !== undefined;
    let elapsed = 0;
    const check = setInterval(() => {
      if (disposed) { clearInterval(check); return; }
      elapsed += 200;
      if (elementReady()) {
        clearInterval(check);
        map3dRef.current = map3d;
        setIs3d(true);
        gcRef.current = new google.maps.Geocoder();
        map3d.addEventListener('gmp-click', (e: any) => {
          try {
            const pos = e?.position;
            if (!pos) return;
            const lat = typeof pos.lat === 'function' ? pos.lat() : pos.lat;
            const lng = typeof pos.lng === 'function' ? pos.lng() : pos.lng;
            if (typeof lat !== 'number' || typeof lng !== 'number') return;
            // La bêta émet parfois 2 clics pour un tap — on déduplique.
            const now = Date.now();
            const last = lastClick3d.current;
            if (last && now - last.t < 400 && Math.abs(last.lat - lat) < 1e-7 && Math.abs(last.lng - lng) < 1e-7) return;
            lastClick3d.current = { t: now, lat, lng };
            const alt = typeof pos.altitude === 'number' && Number.isFinite(pos.altitude) ? pos.altitude : null;
            onMapClick3d(lat, lng, alt);
          } catch { /* clic 3D invalide — ignoré */ }
        });
        setReady(true);
        if (quoteAddress) {
          gcRef.current.geocode({ address: quoteAddress }, (r, s) => {
            if (s === 'OK' && r?.[0]) { const loc = r[0].geometry.location; flyTo(loc.lat(), loc.lng()); }
            else centerOnUser();
          });
        } else centerOnUser();
      } else if (elapsed >= 4000) {
        clearInterval(check);
        try { map3d.remove(); } catch {}
        setWants3d(false); // déclenche l'init 2D ci-dessous
      }
    }, 200);
    return () => { disposed = true; clearInterval(check); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsOk, wants3d]);

  // ── Init the 2D satellite map (repli, ou choix manuel « 2D ») ──
  useEffect(() => {
    if (!mapsOk || wants3d || !mapDiv.current || mapRef.current) return;
    const map = new google.maps.Map(mapDiv.current, {
      center: { lat: 45.5017, lng: -73.5673 }, zoom: 19,
      mapTypeId: 'hybrid', tilt: 45, heading: 0,
      zoomControl: true, mapTypeControl: true,
      mapTypeControlOptions: { position: google.maps.ControlPosition.TOP_RIGHT },
      scaleControl: true, streetViewControl: false, fullscreenControl: false,
      gestureHandling: 'greedy', rotateControl: true, clickableIcons: false,
    });
    mapRef.current = map;
    gcRef.current = new google.maps.Geocoder();
    map.setOptions({ draggableCursor: 'crosshair' });
    map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (e.latLng) onMapClick(e.latLng.lat(), e.latLng.lng());
    });
    setReady(true);
    if (quoteAddress) {
      gcRef.current.geocode({ address: quoteAddress }, (r, s) => {
        if (s === 'OK' && r?.[0]) { const loc = r[0].geometry.location; flyTo(loc.lat(), loc.lng()); }
        else centerOnUser();
      });
    } else centerOnUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsOk, wants3d]);

  // ── Bascule manuelle 2D ↔ 3D (réinitialise les points et la carte) ──
  function switchMode(to3d: boolean) {
    if (to3d === (wants3d || is3d)) return;
    reset();
    overlays3d.current.forEach(o => { try { o.remove(); } catch {} });
    overlays3d.current = [];
    if (map3dRef.current) { try { map3dRef.current.remove(); } catch {} map3dRef.current = null; }
    markers.current.forEach(m => m.setMap(null));
    markers.current = [];
    mapRef.current = null;
    // Vide le conteneur dans tous les cas — un <gmp-map-3d> en cours d'init
    // (pas encore dans map3dRef) resterait sinon par-dessus la nouvelle carte.
    if (mapDiv.current) mapDiv.current.innerHTML = '';
    setIs3d(false);
    setReady(false);
    setWants3d(to3d);
  }

  // ── Mode Photo : cible courante (dernière recherche, sinon centre de la carte) ──
  function currentTarget(): { lat: number; lng: number } {
    if (svTargetRef.current) return svTargetRef.current;
    try {
      if (map3dRef.current?.center) {
        const c = map3dRef.current.center;
        if (typeof c.lat === 'number') return { lat: c.lat, lng: c.lng };
      }
      const c2 = mapRef.current?.getCenter();
      if (c2) return { lat: c2.lat(), lng: c2.lng() };
    } catch { /* centre indisponible */ }
    return { lat: 45.5017, lng: -73.5673 };
  }

  // ── Mode Photo : chargement du panorama (imagerie officielle extérieure) ──
  useEffect(() => {
    if (!streetMode || streetState !== 'idle' || !streetPanoDiv.current) return;
    setStreetState('loading');
    const target = currentTarget();
    const svc = new google.maps.StreetViewService();
    const show = (data: google.maps.StreetViewPanoramaData) => {
      if (!data?.location?.latLng || !streetPanoDiv.current) { setStreetState('none'); return; }
      let heading = 0;
      try {
        heading = google.maps.geometry.spherical.computeHeading(
          data.location.latLng, new google.maps.LatLng(target.lat, target.lng));
      } catch { /* heading par défaut */ }
      // Échelle automatique : distance caméra → propriété (géocodée / centre carte).
      // Plus besoin de cliquer le sol ni d'être proche — le clic-sol reste un
      // secours (svCal) si cette distance n'est pas calculable.
      try {
        const panoPos = data.location.latLng;
        // 1) Distance au MUR via le contour Solar (précis) ; 2) repli : distance
        // au centre géocodé (~+10 %) ; 3) sinon le clic-sol prendra le relais.
        const dCentre = google.maps.geometry.spherical.computeDistanceBetween(
          panoPos, new google.maps.LatLng(target.lat, target.lng));
        if (Number.isFinite(dCentre) && dCentre >= 2 && dCentre <= 250) setSvD(dCentre);
        wallDistance(panoPos.lat(), panoPos.lng(), target.lat, target.lng)
          .then((dWall) => {
            if (dWall != null && dWall >= 2 && dWall <= 250) setSvD(dWall);
          })
          .catch(() => { /* on garde la distance centre */ });
      } catch { /* pas de distance auto — repli sur le clic-sol */ }
      streetPanoDiv.current.innerHTML = '';
      // Dénivelé rue→bâtiment (best-effort; 0 si l'élévation ne répond pas)
      svElevDelta.current = 0;
      (async () => {
        try {
          const p = data.location!.latLng!;
          const [ePano, eTarget] = await Promise.all([
            groundElevation(p.lat(), p.lng()),
            groundElevation(target.lat, target.lng),
          ]);
          // Zone morte : sous 0,5 m, le « dénivelé » est du bruit du modèle de
          // terrain (±30 cm) et injecte de l'erreur (mesuré: -12 % sur une rue
          // plate). On ne corrige que les vraies pentes (entrée montante, etc.).
          const delta = ePano != null && eTarget != null ? ePano - eTarget : 0;
          if (Math.abs(delta) >= 0.5 && Math.abs(delta) < 15) {
            svElevDelta.current = delta;
          }
        } catch { /* terrain plat supposé */ }
      })();
      panoRef.current = new google.maps.StreetViewPanorama(streetPanoDiv.current, {
        pano: data.location.pano,
        pov: { heading, pitch: 0 },
        zoom: 0.8,
        addressControl: false,
        fullscreenControl: false,
        motionTracking: false,
        motionTrackingControl: false,
      });
      setStreetState('ok');
    };
    // Tentative stricte (officiel+extérieur), repli extérieur, garde-fou 10 s —
    // même mécanique que la visionneuse (Viewer3D).
    const attempt = (extra: Record<string, unknown>, onFail: () => void) => {
      let settled = false;
      const settle = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
      const timer = setTimeout(() => settle(onFail), 10000);
      try {
        const req = { location: target, radius: 120, preference: 'nearest', ...extra } as unknown as google.maps.StreetViewLocationRequest;
        const p: any = svc.getPanorama(req, (data, status) => {
          if (String(status).toUpperCase() === 'OK') settle(() => show(data as google.maps.StreetViewPanoramaData));
          else settle(onFail);
        });
        p?.catch?.(() => settle(onFail));
      } catch { settle(onFail); }
    };
    attempt({ sources: ['google', 'outdoor'] }, () =>
      attempt({ source: 'outdoor' }, () => setStreetState('none')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streetMode, streetState]);

  // ── Mode Photo : clics sur la photo → cotes estimées (trigonométrie) ──
  function svResetMeasure() {
    setSvCotes([]);
    setSvPending(null);
    setSvPhase('ref');
    setSvRefPts([]);
    setSvRefVal('');
    svRefLocked.current = false;
    svRefHeading.current = null;
    setSvScale(1);
    setSvCalibIdx(null);
    setSvCalibVal('');
    svWallD.current = null;
    // La distance AUTO (géocodage) survit au « Refaire » — on ne repart en
    // calibrage clic-sol que si l'échelle venait justement d'un clic-sol.
    if (svCal) { setSvCal(null); setSvD(null); }
  }

  /** Écran → angles (pitch/heading absolus du rayon), projection rectilinéaire approx. */
  function svAngles(e: React.MouseEvent<HTMLDivElement>) {
    const pano = panoRef.current;
    if (!pano) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pov = pano.getPov();
    const zoom = pano.getZoom() ?? 1;
    const hfov = (180 / Math.pow(2, zoom)) * (Math.PI / 180); // FOV horizontal ≈ 180°/2^zoom
    const f = (rect.width / 2) / Math.tan(hfov / 2);
    const pitchDeg = (pov.pitch ?? 0) + (Math.atan((rect.height / 2 - y) / f) * 180) / Math.PI;
    const headingDeg = (pov.heading ?? 0) + (Math.atan((x - rect.width / 2) / f) * 180) / Math.PI;
    return { x, y, pitchDeg, headingDeg };
  }

  function svMakeCote(a: SvPoint, b: SvPoint, d: number): SvCote {
    let dh = b.heading - a.heading;
    while (dh > 180) dh -= 360;
    while (dh < -180) dh += 360;
    const dX = d * Math.tan((dh * Math.PI) / 180);
    const dY = d * (Math.tan((b.pitch * Math.PI) / 180) - Math.tan((a.pitch * Math.PI) / 180));
    const len = Math.hypot(dX, dY);
    const kind: SvCote['kind'] = Math.abs(dX) < Math.abs(dY) * 0.35 ? 'V' : Math.abs(dY) < Math.abs(dX) * 0.35 ? 'H' : 'D';
    return { a, b, len, kind };
  }

  function svClick(e: React.MouseEvent<HTMLDivElement>) {
    const ang = svAngles(e);
    if (!ang) return;
    const { x, y, pitchDeg, headingDeg } = ang;

    // Secours seulement : pas de distance auto → on calibre avec un clic au sol.
    if (svD == null) {
      if (pitchDeg >= -0.5) {
        toast.error(fr
          ? 'Distance inconnue — cliquez le point où le mur touche le sol pour calibrer.'
          : 'Unknown distance — click where the wall meets the ground to calibrate.');
        return;
      }
      const d = SV_CAMERA_HEIGHT_M / Math.tan((-pitchDeg * Math.PI) / 180);
      if (!Number.isFinite(d) || d > 250) {
        toast.error(fr ? 'Point de sol trop près de l’horizon — recliquez plus bas.' : 'Ground point too close to the horizon — click lower.');
        return;
      }
      setSvCal({ pitch: pitchDeg, heading: headingDeg, x, y });
      setSvD(d);
      return;
    }

    const pt: SvPoint = { x, y, pitch: pitchDeg, heading: headingDeg };

    // Phase référence : 2 clics sur un objet de hauteur connue (bas puis haut).
    if (svPhase === 'ref') {
      if (svRefPts.length === 0) {
        setSvRefPts([pt]);
        return;
      }
      const base = svRefPts[0];
      if (pt.pitch - base.pitch < 0.8) {
        toast.error(fr ? 'Cliquez le HAUT de la référence (au-dessus du 1er point).' : 'Click the TOP of the reference (above the 1st point).');
        return;
      }
      setSvRefPts([base, pt]);
      setSvPhase('refValue');
      return;
    }

    // Mesure directe : chaque paire de clics = une cote, peu importe la distance.
    if (!svPending) {
      setSvPending(pt);
      return;
    }
    const first = svPending;
    setSvPending(null);
    let dh = pt.heading - first.heading;
    while (dh > 180) dh -= 360;
    while (dh < -180) dh += 360;
    if (Math.abs(dh) > 60) {
      toast.error(fr ? 'Les 2 points doivent être sur le même mur.' : 'Both points must be on the same wall.');
      return;
    }
    // Distance pour CETTE cote : si son point bas touche le sol (angle net sous
    // l'horizon), on la dérive du clic lui-même — indépendante du géocodage,
    // c'est la plus fiable pour un mur. Sinon: dernier mur connu, puis la
    // distance auto (géocodage/contour) en dernier recours.
    let dCote = svWallD.current ?? svD;
    const lowPitch = Math.min(first.pitch, pt.pitch);
    if (!svRefLocked.current && lowPitch <= -3) {
      // Hauteur effective de la caméra au-dessus du PIED du mur (terrain corrigé)
      const effH = SV_CAMERA_HEIGHT_M + svElevDelta.current;
      if (effH > 0.8) {
        const dg = effH / Math.tan((-lowPitch * Math.PI) / 180);
        if (Number.isFinite(dg) && dg >= 2 && dg <= 80) {
          dCote = dg;
          svWallD.current = dg;
        }
      }
    }
    // Garde-fou : une référence vaut pour SON mur. Si la cote s'éloigne
    // nettement du cap de la référence (aile en L, façade différente), la
    // distance peut différer — on avertit sans bloquer.
    if (svRefLocked.current && svRefHeading.current != null) {
      let drift = ((first.heading + pt.heading) / 2) - svRefHeading.current;
      while (drift > 180) drift -= 360;
      while (drift < -180) drift += 360;
      if (Math.abs(drift) > 14) {
        toast.warning(fr
          ? 'Autre mur que la référence ? L’échelle peut différer — refaites une référence sur ce mur pour une mesure fiable.'
          : 'Different wall than the reference? Scale may differ — set a new reference on this wall for a reliable measure.');
      }
    }
    const c = svMakeCote(first, pt, dCote);
    if (!Number.isFinite(c.len) || c.len < 0.2 || c.len > 300) {
      toast.error(fr ? 'Cote invalide — recommencez.' : 'Invalid dimension — try again.');
      return;
    }
    setSvCotes(prev => [...prev, c]);
  }

  /** Fixe l'échelle depuis la référence cliquée : d = H_réelle / Δtan(pitch). */
  function svLockReference(realMeters: number) {
    if (svRefPts.length !== 2 || !Number.isFinite(realMeters) || realMeters <= 0) return;
    const [a, b] = svRefPts;
    const dTan = Math.tan((b.pitch * Math.PI) / 180) - Math.tan((a.pitch * Math.PI) / 180);
    if (dTan <= 0.003) {
      toast.error(fr ? 'Référence trop petite à l’écran — zoomez et recommencez.' : 'Reference too small on screen — zoom in and retry.');
      setSvPhase('ref'); setSvRefPts([]);
      return;
    }
    const d = realMeters / dTan;
    if (!Number.isFinite(d) || d < 2 || d > 300) {
      toast.error(fr ? 'Référence incohérente — recommencez.' : 'Inconsistent reference — retry.');
      setSvPhase('ref'); setSvRefPts([]);
      return;
    }
    setSvD(d);
    svWallD.current = d;
    svRefLocked.current = true;
    svRefHeading.current = (a.heading + b.heading) / 2;
    setSvRefVal('');
    setSvPhase('measure');
    toast.success(fr ? 'Échelle verrouillée — mesurez vos cotes (2 clics chacune).' : 'Scale locked — measure your dimensions (2 clicks each).');
  }

  function svCoteLabel(c: SvCote, i: number): string {
    const prefix = c.kind === 'V' ? 'H' : c.kind === 'H' ? (fr ? 'L' : 'W') : '↔';
    return `${prefix}${i + 1} ≈ ${fmt(c.len * svScale)}`;
  }

  /** Saisie de longueur : accepte « 6'5 », « 6 5 », « 6′5″ », « 6.42 » (pi) ou
   *  « 1.96 » (m selon l'unité courante). Retourne des MÈTRES, ou null. */
  function parseLengthInput(raw: string): number | null {
    const t = raw.trim().replace(',', '.');
    if (!t) return null;
    if (unitSystem === 'metric') {
      const v = parseFloat(t);
      return Number.isFinite(v) && v > 0 ? v : null;
    }
    const m = t.match(/^(\d+(?:\.\d+)?)\s*(?:['′]|pi|ft)?\s*(\d+(?:\.\d+)?)?\s*(?:["″]|po|in)?$/i);
    if (!m) return null;
    const ft = parseFloat(m[1]);
    const inches = m[2] ? parseFloat(m[2]) : 0;
    if (!Number.isFinite(ft) || inches >= 12) return null;
    const total = ft + inches / 12;
    return total > 0 ? total * FT_TO_M : null;
  }

  /** Étalonne toutes les cotes du mur : la cote i vaut « vraiment » realMeters. */
  function svCalibrate(i: number, realMeters: number) {
    const raw = svCotes[i]?.len;
    if (!raw || !Number.isFinite(realMeters) || realMeters <= 0) return;
    setSvScale(realMeters / raw);
    setSvCalibIdx(null);
    setSvCalibVal('');
    toast.success(fr ? 'Étalonné — toutes les cotes sont recalées.' : 'Calibrated — all dimensions rescaled.');
  }

  function addStreetCotes() {
    if (svCotes.length === 0) return;
    const pos = panoRef.current?.getPosition?.();
    const base = pos ? { lat: pos.lat(), lng: pos.lng() } : currentTarget();
    svCotes.forEach((c, i) => {
      const len = c.len * svScale;
      const points: LatLng[] = [
        { lat: base.lat, lng: base.lng, elevation: 0 },
        { lat: base.lat, lng: base.lng, elevation: c.kind === 'V' ? len : 0 },
      ];
      const geojson: any = { type: 'LineString', coordinates: points.map(p => [p.lng, p.lat, p.elevation]) };
      const noun = c.kind === 'V' ? (fr ? 'Hauteur' : 'Height') : c.kind === 'H' ? (fr ? 'Largeur' : 'Width') : (fr ? 'Cote' : 'Dim');
      const shape: Shape = {
        id: `sh-${index + i}`,
        label: `${noun} ${index + i + 1} (photo)`,
        color: nextColor(index + i),
        result: { type: 'line', value: len * M_TO_FT, areaValue: null, perimeterValue: null, geojson, points, elevation: elevationStats(points) },
        notes: '',
        visible: true,
        metadata: {
          kind: 'height',
          source: svScale !== 1 ? 'street-calibrated' : 'street-estimate',
          cote: c.kind,
          ...(c.kind === 'V' ? { heightMeters: len } : { lengthMeters: len }),
        },
      };
      onComplete(shape);
    });
    onClose();
  }

  // ── Markers for the two points ──
  useEffect(() => {
    // Mode 3D : marqueurs et ligne verticale via les primitives 3D (best-effort —
    // la carte fonctionne sans eux, la carte latérale montre l'état des points).
    if (is3d && map3dRef.current) {
      overlays3d.current.forEach(o => { try { o.remove(); } catch {} });
      overlays3d.current = [];
      const map3d = map3dRef.current;
      const mk3d = (p: Pt, label: string) => {
        try {
          const m = document.createElement('gmp-marker-3d') as any;
          m.position = { lat: p.lat, lng: p.lng, altitude: p.elev ?? 0 };
          m.altitudeMode = p.elev != null ? 'absolute' : 'clamp-to-ground';
          m.label = label;
          map3d.appendChild(m);
          overlays3d.current.push(m);
        } catch { /* primitive 3D indisponible */ }
      };
      if (ptA) mk3d(ptA, '1');
      if (ptB) mk3d(ptB, '2');
      if (ptA && ptB) {
        try {
          const line = document.createElement('gmp-polyline-3d') as any;
          line.coordinates = [
            { lat: ptA.lat, lng: ptA.lng, altitude: ptA.elev ?? 0 },
            { lat: ptB.lat, lng: ptB.lng, altitude: ptB.elev ?? 0 },
          ];
          line.altitudeMode = 'absolute';
          line.strokeColor = '#FFCC00';
          line.strokeWidth = 8;
          map3d.appendChild(line);
          overlays3d.current.push(line);
        } catch { /* primitive 3D indisponible */ }
      }
      return;
    }
    markers.current.forEach(m => m.setMap(null));
    markers.current = [];
    const map = mapRef.current; if (!map) return;
    const mk = (p: Pt, color: string, label: string) => new google.maps.Marker({
      position: { lat: p.lat, lng: p.lng }, map, clickable: false,
      label: { text: label, color: '#FFF', fontSize: '11px', fontWeight: '700' },
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: color, fillOpacity: 1, strokeColor: '#FFF', strokeWeight: 2 },
      zIndex: 200,
    });
    if (ptA) markers.current.push(mk(ptA, '#FF4444', '1'));
    if (ptB) markers.current.push(mk(ptB, '#44BB44', '2'));
    if (ptA && ptB) {
      const line = new google.maps.Polyline({
        path: [{ lat: ptA.lat, lng: ptA.lng }, { lat: ptB.lat, lng: ptB.lng }],
        strokeColor: '#FFCC00', strokeWeight: 3, clickable: false, map,
      });
      markers.current.push(line as any);
    }
  }, [ptA, ptB, is3d]);

  // ── Height = roof(point 2) − ground(point 1), or manual ──
  const bothDone = !!(ptA && ptB && !ptA.loading && !ptB.loading);
  const haveElevs = bothDone && ptA!.elev != null && ptB!.elev != null;
  const diffMeters = haveElevs ? Math.abs((ptB!.elev as number) - (ptA!.elev as number)) : 0;
  const manualMeters = (() => {
    const h = parseFloat(manualH);
    if (Number.isFinite(h) && h > 0) return unitSystem === 'metric' ? h : h * FT_TO_M;
    return 0;
  })();
  const roofMissing = bothDone && ptB!.elev == null;       // no Solar roof data at point 2
  const tooClose = haveElevs && diffMeters < MIN_HEIGHT_M;  // both points ~same level
  const needManual = bothDone && (roofMissing || tooClose);
  const heightMeters = manualMeters > 0 ? manualMeters : diffMeters;
  const canAdd = !!ptA && !!ptB && heightMeters > 0;

  function reset() { setA(null); setB(null); setManualH(''); }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!search.trim()) return;
    if (!gcRef.current) { try { gcRef.current = new google.maps.Geocoder(); } catch { return; } }
    setSearching(true);
    gcRef.current.geocode({ address: search }, (r, s) => {
      setSearching(false);
      if (s === 'OK' && r?.[0]) {
        const loc = r[0].geometry.location;
        svTargetRef.current = { lat: loc.lat(), lng: loc.lng() };
        if (streetMode) {
          // Recharge le panorama le plus proche de la nouvelle adresse.
          svResetMeasure(); setSvMeasuring(false); setStreetState('idle');
        } else {
          flyTo(loc.lat(), loc.lng());
        }
      } else toast.error(fr ? 'Adresse introuvable' : 'Address not found');
    });
  }

  function add() {
    if (!ptA || !ptB || heightMeters <= 0) return;
    const points: LatLng[] = [
      { lat: ptA.lat, lng: ptA.lng, ...(ptA.elev != null ? { elevation: ptA.elev } : {}) },
      { lat: ptB.lat, lng: ptB.lng, ...(ptB.elev != null ? { elevation: ptB.elev } : {}) },
    ];
    const heightFt = heightMeters * M_TO_FT;
    const geojson: any = { type: 'LineString', coordinates: points.map(p => p.elevation != null ? [p.lng, p.lat, p.elevation] : [p.lng, p.lat]) };
    const shape: Shape = {
      id: `sh-${index}`,
      label: fr ? `Hauteur ${index + 1}` : `Height ${index + 1}`,
      color: nextColor(index),
      result: { type: 'line', value: heightFt, areaValue: null, perimeterValue: null, geojson, points, elevation: elevationStats(points) },
      notes: '',
      visible: true,
      metadata: {
        kind: 'height',
        heightMeters,
        source: manualMeters > 0 ? 'manual' : (ptA.from3d && ptB.from3d ? '3d' : 'solar'),
        elevA: ptA.elev, elevB: ptB.elev,
      },
    };
    onComplete(shape);
    onClose();
  }

  const fmt = (m: number) => formatElevation(m, unitSystem);
  const step = !ptA ? 1 : !ptB ? 2 : 3;

  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col">
      <div className="h-12 border-b border-outline/20 flex items-center px-4 gap-3 bg-surface-card shrink-0">
        <button onClick={onClose} className="p-1.5 hover:bg-surface-secondary rounded-lg transition-colors">
          <ArrowLeft size={16} className="text-text-secondary" />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <MoveVertical size={15} className="text-text-primary shrink-0" />
          <span className="text-[13px] font-bold text-text-primary truncate">{fr ? 'Hauteur du bâtiment' : 'Building height'}</span>
        </div>
        <div className="flex items-center rounded-lg border border-outline/30 overflow-hidden shrink-0">
          <button onClick={() => { setStreetMode(false); switchMode(true); }}
            className={`px-2.5 py-1 text-[11px] font-bold transition-colors ${!streetMode && (wants3d || is3d) ? 'bg-text-primary text-surface' : 'text-text-muted hover:text-text-primary'}`}>
            3D
          </button>
          <button onClick={() => { setStreetMode(false); switchMode(false); }}
            className={`px-2.5 py-1 text-[11px] font-bold transition-colors ${!streetMode && !(wants3d || is3d) ? 'bg-text-primary text-surface' : 'text-text-muted hover:text-text-primary'}`}>
            2D
          </button>
          <button onClick={() => { if (!streetMode) { svResetMeasure(); setSvMeasuring(false); setStreetMode(true); if (streetState === 'none') setStreetState('idle'); } }}
            className={`px-2.5 py-1 text-[11px] font-bold transition-colors ${streetMode ? 'bg-text-primary text-surface' : 'text-text-muted hover:text-text-primary'}`}>
            Photo
          </button>
        </div>
        <form onSubmit={handleSearch} className="flex-1 max-w-md mx-4">
          <div className="relative">
            {searching
              ? <Loader2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted animate-spin" />
              : <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />}
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={fr ? 'Rechercher une adresse...' : 'Search address...'}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-outline/30 bg-surface-secondary text-[12px] focus:outline-none focus:ring-2 focus:ring-text-primary/20 text-text-primary placeholder:text-text-muted" />
          </div>
        </form>
      </div>

      <div className="flex-1 relative">
        <div ref={mapDiv} className="absolute inset-0" />

        {/* ── Mode Photo : panorama Street View + couche de mesure ── */}
        <div ref={streetPanoDiv} className={`absolute inset-0 z-[15] ${streetMode ? '' : 'hidden'}`} />
        {streetMode && streetState === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/80 z-[16]">
            <Loader2 size={28} className="animate-spin text-text-muted" />
          </div>
        )}
        {streetMode && streetState === 'none' && (
          <div className="absolute inset-0 flex items-center justify-center z-[16]">
            <p className="text-[13px] text-text-secondary bg-surface-card border border-outline/30 rounded-xl px-4 py-3">
              {fr ? 'Street View n’est pas disponible ici — cherchez une adresse ou utilisez 2D/3D.' : 'Street View is not available here — search an address or use 2D/3D.'}
            </p>
          </div>
        )}
        {streetMode && streetState === 'ok' && svMeasuring && (
          <div className="absolute inset-0 z-[17] cursor-crosshair" onClick={svClick} />
        )}
        {streetMode && streetState === 'ok' && svMeasuring && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-gray-900/80 text-white text-[12px] px-4 py-1.5 rounded-full z-[18] pointer-events-none backdrop-blur-sm font-medium max-w-[92vw] truncate">
            {svPhase === 'ref'
              ? (svRefPts.length === 0
                ? (fr ? 'Étape 1 — Référence : cliquez le BAS d’une porte (zoomez d’abord !)' : 'Step 1 — Reference: click the BOTTOM of a door (zoom in first!)')
                : (fr ? 'Référence : cliquez maintenant le HAUT de la porte' : 'Reference: now click the TOP of the door'))
              : svPhase === 'refValue'
                ? (fr ? 'Indiquez la dimension de la référence ↓' : 'Enter the reference dimension ↓')
                : svPending
                  ? (fr ? '2e point de la cote…' : '2nd point of the dimension…')
                  : (fr ? 'Mesurez : 2 clics par cote (bas→haut, gauche→droite…)' : 'Measure: 2 clicks per dimension (bottom→top, left→right…)')}
          </div>
        )}
        {streetMode && streetState === 'ok' && (svCal || svCotes.length > 0 || svPending || svRefPts.length > 0) && (
          <svg className="absolute inset-0 z-[18] pointer-events-none w-full h-full">
            {svCal && (
              <g>
                <circle cx={svCal.x} cy={svCal.y} r={9} fill="#FFCC00" stroke="#FFF" strokeWidth={2.5} />
                <text x={svCal.x} y={svCal.y + 4} textAnchor="middle" fill="#1a1a1a" fontSize="10" fontWeight="800">S</text>
              </g>
            )}
            {svCotes.map((c, i) => {
              const mx = (c.a.x + c.b.x) / 2;
              const my = (c.a.y + c.b.y) / 2;
              return (
                <g key={i}>
                  <line x1={c.a.x} y1={c.a.y} x2={c.b.x} y2={c.b.y} stroke="#FFCC00" strokeWidth={3} strokeDasharray="6 4" />
                  <circle cx={c.a.x} cy={c.a.y} r={7} fill="#FF4444" stroke="#FFF" strokeWidth={2} />
                  <circle cx={c.b.x} cy={c.b.y} r={7} fill="#44BB44" stroke="#FFF" strokeWidth={2} />
                  <text x={mx + 12} y={my - 8} fill="#FFF" stroke="#1a1a1a" strokeWidth={3.5} paintOrder="stroke" fontSize="14" fontWeight="800">
                    {svCoteLabel(c, i)}
                  </text>
                </g>
              );
            })}
            {svPending && (
              <circle cx={svPending.x} cy={svPending.y} r={7} fill="#FF4444" stroke="#FFF" strokeWidth={2} />
            )}
            {svRefPts.length > 0 && (
              <g>
                {svRefPts.length === 2 && (
                  <line x1={svRefPts[0].x} y1={svRefPts[0].y} x2={svRefPts[1].x} y2={svRefPts[1].y}
                    stroke="#3B82F6" strokeWidth={3} strokeDasharray="4 3" />
                )}
                {svRefPts.map((m, i) => (
                  <circle key={i} cx={m.x} cy={m.y} r={7} fill="#3B82F6" stroke="#FFF" strokeWidth={2} />
                ))}
                {svRefPts.length === 2 && svRefLocked.current && (
                  <text x={(svRefPts[0].x + svRefPts[1].x) / 2 + 12} y={(svRefPts[0].y + svRefPts[1].y) / 2}
                    fill="#FFF" stroke="#1a1a1a" strokeWidth={3.5} paintOrder="stroke" fontSize="12" fontWeight="800">
                    {fr ? 'réf.' : 'ref.'}
                  </text>
                )}
              </g>
            )}
          </svg>
        )}
        {streetMode && streetState === 'ok' && !svMeasuring && svCotes.length === 0 && (
          <button
            onClick={() => { svResetMeasure(); setSvMeasuring(true); }}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[18] glass-button-primary flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-semibold shadow-xl"
          >
            <MoveVertical size={14} /> {fr ? 'Mesurer (estimation)' : 'Measure (estimate)'}
          </button>
        )}
        {streetMode && streetState === 'ok' && svMeasuring && svPhase === 'refValue' && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-surface/95 backdrop-blur-sm border border-outline/30 rounded-2xl px-5 py-4 z-[19] shadow-xl text-center min-w-[300px] space-y-2">
            <p className="text-[11px] font-semibold text-text-primary">
              {fr ? 'Cette référence, c’est quoi ?' : 'What is this reference?'}
            </p>
            <div className="flex items-center gap-1.5 justify-center flex-wrap">
              <button onClick={() => svLockReference(2.032)} className="glass-button-primary px-2.5 py-1.5 rounded-lg text-[11px] font-semibold">
                {fr ? 'Porte d’entrée 6′8″' : 'Entry door 6′8″'}
              </button>
              <button onClick={() => svLockReference(2.134)} className="glass-button-primary px-2.5 py-1.5 rounded-lg text-[11px] font-semibold">
                {fr ? 'Porte de garage 7′' : 'Garage door 7′'}
              </button>
            </div>
            <div className="flex items-center gap-1.5 justify-center">
              <input
                type="text" inputMode="decimal" value={svRefVal}
                onChange={e => setSvRefVal(e.target.value)}
                placeholder={unitSystem === 'metric' ? (fr ? 'autre (m)' : 'other (m)') : (fr ? 'autre : 7 5' : 'other: 7 5')}
                className="w-24 text-[12px] rounded-md border border-outline/30 bg-surface-card px-2 py-1 text-center"
              />
              <button
                onClick={() => {
                  const meters = parseLengthInput(svRefVal);
                  if (meters != null) svLockReference(meters);
                  else toast.error(fr ? 'Valeur invalide — ex.: 7′5, 7 5, ou 7.42' : 'Invalid value — e.g. 7′5, 7 5, or 7.42');
                }}
                className="glass-button px-2.5 py-1 rounded-lg text-[11px] font-semibold">
                OK
              </button>
            </div>
            <button onClick={() => { setSvPhase('ref'); setSvRefPts([]); }}
              className="text-[10px] text-text-tertiary hover:text-text-primary transition-colors">
              {fr ? 'Recliquer la référence' : 'Re-click the reference'}
            </button>
          </div>
        )}
        {streetMode && streetState === 'ok' && svMeasuring && svPhase === 'ref' && svRefPts.length === 0 && (
          <button
            onClick={() => { svRefLocked.current = false; setSvPhase('measure'); }}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[18] text-[10px] text-white/80 hover:text-white bg-gray-900/60 px-3 py-1 rounded-lg backdrop-blur-sm transition-colors">
            {fr ? 'Mesurer sans référence (approximatif ±10-15 %)' : 'Measure without reference (approximate ±10-15%)'}
          </button>
        )}
        {streetMode && svCotes.length > 0 && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-surface/95 backdrop-blur-sm border border-outline/30 rounded-2xl px-5 py-4 z-[19] shadow-xl text-center min-w-[300px] space-y-1.5">
            <p className="text-[10px] text-text-muted font-semibold uppercase tracking-wide">
              {svScale !== 1
                ? (fr ? 'Cotes étalonnées ✓' : 'Calibrated dimensions ✓')
                : (fr ? 'Cotes estimées (photo, ±10-15 %)' : 'Estimated dimensions (photo, ±10-15%)')}
            </p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {svCotes.map((c, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="font-mono font-bold text-text-primary">{svCoteLabel(c, i)}</span>
                  <span className="text-[10px] text-text-muted">
                    {c.kind === 'V' ? (fr ? 'hauteur' : 'height') : c.kind === 'H' ? (fr ? 'largeur' : 'width') : (fr ? 'diagonale' : 'diagonal')}
                  </span>
                  <button
                    onClick={() => { setSvCalibIdx(svCalibIdx === i ? null : i); setSvCalibVal(''); }}
                    title={fr ? 'Je connais la vraie valeur de cette cote (étalonner)' : 'I know this dimension’s real value (calibrate)'}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${svCalibIdx === i ? 'bg-text-primary text-surface' : 'bg-surface-secondary text-text-muted hover:text-text-primary'}`}>
                    {fr ? 'étal.' : 'cal.'}
                  </button>
                  <button onClick={() => setSvCotes(prev => prev.filter((_, j) => j !== i))}
                    className="p-0.5 rounded hover:bg-danger-light text-text-muted hover:text-danger transition-colors">
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
            {svCalibIdx != null && svCotes[svCalibIdx] && (
              <div className="space-y-1.5 pt-1 border-t border-outline/20">
                <p className="text-[10px] text-text-secondary">
                  {fr ? 'Vraie valeur de cette cote :' : 'Real value of this dimension:'}
                </p>
                <div className="flex items-center gap-1.5 justify-center flex-wrap">
                  <input
                    type="text" inputMode="decimal" value={svCalibVal}
                    onChange={e => setSvCalibVal(e.target.value)}
                    placeholder={unitSystem === 'metric' ? 'm' : (fr ? 'ex: 6′5' : 'e.g. 6′5')}
                    className="w-20 text-[12px] rounded-md border border-outline/30 bg-surface-card px-2 py-1 text-center"
                  />
                  <button
                    onClick={() => {
                      const meters = parseLengthInput(svCalibVal);
                      if (meters != null) svCalibrate(svCalibIdx, meters);
                      else toast.error(fr ? 'Valeur invalide — ex.: 6′5, 6 5, ou 6.42' : 'Invalid value — e.g. 6′5, 6 5, or 6.42');
                    }}
                    className="glass-button-primary px-2.5 py-1 rounded-lg text-[11px] font-semibold">
                    OK
                  </button>
                  <button onClick={() => svCalibrate(svCalibIdx, 2.032)}
                    className="glass-button px-2 py-1 rounded-lg text-[10px] font-medium">
                    {fr ? 'Porte 6′8″' : 'Door 6′8″'}
                  </button>
                  <button onClick={() => svCalibrate(svCalibIdx, 2.134)}
                    className="glass-button px-2 py-1 rounded-lg text-[10px] font-medium">
                    {fr ? 'Garage 7′' : 'Garage 7′'}
                  </button>
                </div>
              </div>
            )}
            {svMeasuring && (
              <p className="text-[10px] text-text-tertiary">{fr ? 'Continuez à cliquer pour d’autres cotes' : 'Keep clicking for more dimensions'}</p>
            )}
            <div className="flex items-center gap-2 justify-center pt-1">
              <button onClick={() => { svResetMeasure(); setSvMeasuring(true); }} className="glass-button flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium">
                <RotateCcw size={13} /> {fr ? 'Refaire' : 'Redo'}
              </button>
              <button onClick={addStreetCotes} className="glass-button-primary flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold">
                <Check size={13} /> {fr ? `Ajouter (${svCotes.length})` : `Add (${svCotes.length})`}
              </button>
            </div>
          </div>
        )}

        {!streetMode && !ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/80 z-10">
            <Loader2 size={28} className="animate-spin text-text-muted" />
          </div>
        )}

        {!streetMode && is3d && ready && (
          <>
            <Cam3DControls getEl={() => map3dRef.current} fr={fr} className="absolute right-3 top-14 z-20" />
            <div className="absolute bottom-3 right-3 z-20 bg-gray-900/70 text-white/90 text-[10px] px-3 py-1.5 rounded-lg pointer-events-none backdrop-blur-sm hidden sm:block">
              {fr ? 'Glisser : déplacer · Ctrl+glisser : pivoter · Molette : zoom' : 'Drag: pan · Ctrl+drag: rotate · Scroll: zoom'}
            </div>
          </>
        )}

        {!streetMode && step < 3 && ready && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-gray-900/80 text-white text-[12px] px-4 py-1.5 rounded-full z-20 pointer-events-none backdrop-blur-sm font-medium">
            {step === 1
              ? (is3d
                ? (fr ? '1. Cliquez la base du bâtiment (au sol)' : '1. Click the base of the building (on the ground)')
                : (fr ? '1. Cliquez le 1er point (ex: la base au sol)' : '1. Click point 1 (e.g. the base on the ground)'))
              : (is3d
                ? (fr ? '2. Cliquez le sommet du bâtiment en 3D' : '2. Click the top of the building in 3D')
                : (fr ? '2. Cliquez le 2e point (ex: le sommet du toit)' : '2. Click point 2 (e.g. the top of the roof)'))}
          </div>
        )}

        {!streetMode && (ptA || ptB) && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-surface/95 backdrop-blur-sm border border-outline/30 rounded-2xl px-5 py-4 z-20 shadow-xl text-center min-w-[280px] space-y-1.5">
            <div className="flex items-center justify-between gap-6 text-[11px] font-mono">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#FF4444' }} />{fr ? 'Base (sol)' : 'Base (ground)'}</span>
              <span>{ptA ? (ptA.loading ? '…' : ptA.elev != null ? fmt(ptA.elev) : '—') : '—'}</span>
            </div>
            <div className="flex items-center justify-between gap-6 text-[11px] font-mono">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#44BB44' }} />{fr ? 'Sommet (toit)' : 'Top (roof)'}</span>
              <span>{ptB ? (ptB.loading ? '…' : ptB.elev != null ? fmt(ptB.elev) + ' 🏢' : (fr ? 'pas de toit' : 'no roof')) : '—'}</span>
            </div>

            {bothDone && (
              <>
                <div className="border-t border-outline/20 my-1.5" />
                {!needManual && (
                  <>
                    <p className="text-[11px] text-text-muted font-medium uppercase tracking-wide">{fr ? 'Hauteur' : 'Height'}</p>
                    <p className="text-2xl font-bold text-text-primary">{fmt(heightMeters)}</p>
                  </>
                )}
                {needManual && (
                  <div className="space-y-1.5 pt-0.5">
                    <p className="text-[10px] text-danger">
                      {roofMissing
                        ? (fr ? 'Pas de données de toit ici — saisis la hauteur :' : 'No roof data here — enter the height:')
                        : (fr ? 'Points au même niveau — mets le 2e sur le toit, ou saisis :' : 'Points at the same level — put point 2 on the roof, or enter:')}
                    </p>
                    <div className="flex items-center gap-2 justify-center">
                      <label className="text-[10px] text-text-muted">{fr ? `Hauteur (${unitSystem === 'metric' ? 'm' : 'pi'})` : `Height (${unitSystem === 'metric' ? 'm' : 'ft'})`}</label>
                      <input type="number" min="0" step="0.1" value={manualH} onChange={e => setManualH(e.target.value)}
                        className="w-20 text-[12px] rounded-md border border-outline/30 bg-surface-card px-2 py-1 text-center" />
                    </div>
                    {manualMeters > 0 && <p className="text-[13px] font-bold text-text-primary">{fmt(manualMeters)}</p>}
                  </div>
                )}
              </>
            )}

            <div className="flex items-center gap-2 justify-center pt-1">
              <button onClick={reset} className="glass-button flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium">
                <RotateCcw size={13} /> {fr ? 'Refaire' : 'Redo'}
              </button>
              <button onClick={add} disabled={!canAdd}
                className="glass-button-primary flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-40">
                <Check size={13} /> {fr ? 'Ajouter' : 'Add'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
