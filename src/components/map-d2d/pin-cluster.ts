/**
 * PinClusterManager — regroupement géographique progressif des pins D2D.
 *
 * Basé sur Supercluster (le moteur que Mapbox GL utilise en interne), branché
 * sur l'architecture à marqueurs DOM existante : le gestionnaire ne touche
 * JAMAIS aux marqueurs de pins individuels. Il calcule seulement quels pins
 * sont couverts par un cluster au zoom courant (rapportés via onChange — la
 * visibilité reste appliquée par map-container, au même endroit que les
 * filtres) et gère ses propres marqueurs circulaires numériques.
 *
 * Perf : l'index n'est reconstruit que sur mutation des données/filtres ;
 * les clusters ne sont recalculés qu'au franchissement d'un niveau de zoom
 * entier, au moveend et au resize — jamais à chaque frame. Pendant le
 * drag/zoom continu, Mapbox repositionne les marqueurs tout seul, donc les
 * cercles restent ancrés à leur zone sans trembler.
 */
import mapboxgl from 'mapbox-gl';
import Supercluster from 'supercluster';

export interface ClusterSourcePoint {
  id: string;
  lng: number;
  lat: number;
}

export interface DisplayedCluster {
  key: string;
  lngLat: [number, number];
  count: number;
  size: number;
  /** id Supercluster ; null = groupe de pins aux coordonnées identiques */
  clusterId: number | null;
  marker: mapboxgl.Marker;
  inner: HTMLDivElement;
}

interface PinClusterOptions {
  /** Libellé accessible (lecteurs d'écran) pour un cluster de n pins */
  label: (count: number) => string;
  /**
   * Appelé quand l'ensemble des pins couverts par un cluster change.
   * `reveals` = pins qui viennent d'être révélés par un split, avec la
   * position de leur cluster parent (pour l'animation de divergence).
   */
  onChange: (clusteredIds: Set<string>, reveals: Map<string, [number, number]>) => void;
}

// Rayon de regroupement en px écran. Au-delà de MAX_CLUSTER_ZOOM, tout est
// individuel (sauf coordonnées strictement identiques, regroupées à part).
// Valeurs volontairement basses : les clusters ne doivent apparaître que tard
// dans le dézoom — on garde un aperçu des pins individuels d'assez loin, et
// deux pins ne fusionnent que quand ils se chevauchent presque à l'écran.
const CLUSTER_RADIUS = 38;
const MAX_CLUSTER_ZOOM = 14;
const CONVERGE_MS = 180;
const FADE_MS = 150;
// Distance écran max pour rattacher un nouveau marqueur à son parent disparu
const PARENT_RADIUS_PX = 140;

// Tailles volontairement contenues — un gros cluster ne doit jamais recouvrir
// une grande partie de la carte. Le plus petit (28px) = taille des pins.
const SIZE_TIERS = [
  { min: 500, size: 52, font: 13 },
  { min: 100, size: 46, font: 12.5 },
  { min: 50, size: 40, font: 12 },
  { min: 10, size: 34, font: 11.5 },
  { min: 0, size: 28, font: 11 },
] as const;

function tierFor(count: number) {
  return SIZE_TIERS.find((t) => count >= t.min) ?? SIZE_TIERS[SIZE_TIERS.length - 1];
}

// Nombre exact en priorité ; abrégé seulement quand il ne tient plus (≥ 6 chiffres).
function formatCount(n: number): string {
  return n <= 99999 ? String(n) : `${Math.round(n / 1000)}k`;
}

/**
 * Cercle numérique — même langage visuel que les pins (lead-pin.ts) : dégradé
 * 135°, bordure blanche 2px, même ombre. Fond navy Lume (#1a1d29, la teinte
 * des boutons primaires des popups) — neutre sur rues comme sur satellite.
 * L'élément externe reste nu : Mapbox pilote son transform ; toutes les
 * animations (opacité/échelle) vivent sur l'élément interne.
 */
function createClusterElement(count: number, label: string): { outer: HTMLDivElement; inner: HTMLDivElement } {
  const { size, font } = tierFor(count);
  const outer = document.createElement('div');
  outer.style.cursor = 'pointer';

  const inner = document.createElement('div');
  inner.setAttribute('style', [
    'box-sizing:border-box',
    `width:${size}px`,
    `height:${size}px`,
    'border-radius:50%',
    'background:linear-gradient(135deg,#272c3e,#14171f)',
    'border:2px solid rgba(255,255,255,0.92)',
    'box-shadow:0 2px 6px rgba(0,0,0,0.4)',
    'cursor:pointer',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'font-family:Inter,system-ui,sans-serif',
    `font-size:${font}px`,
    'font-weight:600',
    'color:#fff',
    'line-height:1',
    'letter-spacing:-0.01em',
    'user-select:none',
    `transition:opacity ${FADE_MS}ms ease-out,transform ${FADE_MS}ms ease-out,box-shadow 120ms ease,border-color 120ms ease`,
    'opacity:0',
    'transform:scale(0.8)',
  ].join(';'));
  inner.textContent = formatCount(count);
  inner.setAttribute('role', 'img');
  inner.setAttribute('aria-label', label);

  // Survol desktop — même mécanique que les pins : bordure pleine + ombre un
  // peu plus marquée. Pas de grossissement, pas de halo.
  inner.addEventListener('mouseenter', () => {
    inner.style.borderColor = '#fff';
    inner.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
  });
  inner.addEventListener('mouseleave', () => {
    inner.style.borderColor = 'rgba(255,255,255,0.92)';
    inner.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4)';
  });

  outer.appendChild(inner);
  return { outer, inner };
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export class PinClusterManager {
  private map: mapboxgl.Map;
  private opts: PinClusterOptions;
  private index: Supercluster<{ id: string }> | null = null;
  private pointIds: string[] = [];
  private pointPos = new Map<string, [number, number]>();
  private displayed = new Map<string, DisplayedCluster>();
  private fading = new Set<mapboxgl.Marker>();
  private clusteredIds = new Set<string>();
  private lastZoomInt = -1;
  private timeouts = new Set<number>();
  private destroyed = false;

  private handleZoom = () => {
    const z = Math.max(0, Math.min(24, Math.floor(this.map.getZoom())));
    if (z !== this.lastZoomInt) this.refresh();
  };
  private handleMoveEnd = () => this.refresh();
  private handleResize = () => this.refresh();

  constructor(map: mapboxgl.Map, opts: PinClusterOptions) {
    this.map = map;
    this.opts = opts;
    map.on('zoom', this.handleZoom);
    map.on('moveend', this.handleMoveEnd);
    map.on('resize', this.handleResize);
  }

  /** Reconstruit l'index à partir des pins visibles selon les filtres. */
  setData(points: ClusterSourcePoint[]) {
    if (this.destroyed) return;
    this.pointIds = points.map((p) => p.id);
    this.pointPos = new Map(points.map((p) => [p.id, [p.lng, p.lat] as [number, number]]));
    this.index = new Supercluster<{ id: string }>({
      radius: CLUSTER_RADIUS,
      maxZoom: MAX_CLUSTER_ZOOM,
      minPoints: 2,
    });
    this.index.load(points.map((p) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      properties: { id: p.id },
    })));
    // -1 = pas d'animation de divergence (mutation de données, pas de zoom)
    this.lastZoomInt = -1;
    this.refresh();
  }

  private refresh() {
    if (this.destroyed || !this.index) return;
    const z = Math.max(0, Math.min(24, Math.floor(this.map.getZoom())));
    const zoomedIn = this.lastZoomInt >= 0 && z > this.lastZoomInt;
    this.lastZoomInt = z;

    // Clusters calculés sur le monde entier, pas seulement le viewport : un
    // pin membre d'un cluster doit rester masqué même hors écran, sinon il
    // surgirait individuellement pendant un drag puis fusionnerait au
    // moveend — exactement le clignotement à éviter.
    const feats = this.index.getClusters([-180, -85, 180, 85], z);

    const wanted = new Map<string, { lngLat: [number, number]; count: number; clusterId: number | null }>();
    const visibleIndividual = new Set<string>();
    const soloAtCoord = new Map<string, string[]>();

    for (const f of feats) {
      const coords = f.geometry.coordinates as [number, number];
      const props = f.properties as { cluster?: boolean; cluster_id?: number; point_count?: number; id?: string };
      if (props.cluster) {
        wanted.set(`c${props.cluster_id}`, { lngLat: coords, count: props.point_count || 0, clusterId: props.cluster_id! });
      } else {
        const k = `${coords[0]},${coords[1]}`;
        const arr = soloAtCoord.get(k);
        if (arr) arr.push(props.id!);
        else soloAtCoord.set(k, [props.id!]);
      }
    }
    // Au-delà du maxZoom de l'index, Supercluster ne regroupe plus les pins
    // aux coordonnées strictement identiques — on les garde en cluster pour
    // ne jamais empiler des pins illisibles au même point.
    soloAtCoord.forEach((ids, k) => {
      if (ids.length >= 2) {
        const [lng, lat] = k.split(',').map(Number);
        wanted.set(`xy${k}`, { lngLat: [lng, lat], count: ids.length, clusterId: null });
      } else {
        visibleIndividual.add(ids[0]);
      }
    });

    const newClustered = new Set<string>();
    for (const id of this.pointIds) if (!visibleIndividual.has(id)) newClustered.add(id);

    // Marqueurs rendus seulement dans le viewport (avec marge) — le DOM reste
    // borné même avec des milliers de pins.
    const b = this.map.getBounds();
    let west = -180, south = -85, east = 180, north = 85;
    if (b) {
      const padX = (b.getEast() - b.getWest()) * 0.25;
      const padY = (b.getNorth() - b.getSouth()) * 0.25;
      west = b.getWest() - padX; east = b.getEast() + padX;
      south = b.getSouth() - padY; north = b.getNorth() + padY;
    }
    const inView = (c: [number, number]) => c[0] >= west && c[0] <= east && c[1] >= south && c[1] <= north;

    // Marqueurs qui disparaissent — positions mémorisées pour ancrer les
    // animations de divergence, puis fondu rapide avant retrait.
    const removed: Array<{ x: number; y: number; lngLat: [number, number] }> = [];
    this.displayed.forEach((dc, key) => {
      const w = wanted.get(key);
      if (w && inView(w.lngLat)) return;
      this.displayed.delete(key);
      const p = this.map.project(dc.lngLat);
      removed.push({ x: p.x, y: p.y, lngLat: dc.lngLat });
      this.fadeOutAndRemove(dc);
    });

    // Nouveaux marqueurs. Un cluster déjà affiché garde sa position et son
    // total (déterministes par niveau de zoom) — rien à recréer, donc aucun
    // clignotement pendant un simple déplacement de carte.
    wanted.forEach((w, key) => {
      if (!inView(w.lngLat)) return;
      const existing = this.displayed.get(key);
      if (existing) {
        // Même clé mais contenu différent : possible seulement après une
        // reconstruction de l'index (filtres/données). Mise à jour en place —
        // le total affiché ne doit jamais rester périmé.
        if (existing.count !== w.count || existing.lngLat[0] !== w.lngLat[0] || existing.lngLat[1] !== w.lngLat[1]) {
          existing.lngLat = w.lngLat;
          existing.marker.setLngLat(w.lngLat);
          existing.count = w.count;
          const t = tierFor(w.count);
          existing.size = t.size;
          existing.inner.style.width = `${t.size}px`;
          existing.inner.style.height = `${t.size}px`;
          existing.inner.style.fontSize = `${t.font}px`;
          existing.inner.textContent = formatCount(w.count);
          existing.inner.setAttribute('aria-label', this.opts.label(w.count));
        }
        return;
      }
      const { outer, inner } = createClusterElement(w.count, this.opts.label(w.count));
      const marker = new mapboxgl.Marker({ element: outer }).setLngLat(w.lngLat).addTo(this.map);
      const dc: DisplayedCluster = { key, lngLat: w.lngLat, count: w.count, size: tierFor(w.count).size, clusterId: w.clusterId, marker, inner };
      this.displayed.set(key, dc);
      if (zoomedIn) {
        // Divergence : le nouveau marqueur part du centre de son parent disparu
        const parent = this.nearestRemoved(removed, w.lngLat);
        if (parent) this.animateMarkerFrom(marker, parent.lngLat);
      }
      requestAnimationFrame(() => {
        inner.style.opacity = '1';
        inner.style.transform = 'scale(1)';
      });
    });

    // Pins révélés par un split → position du parent pour l'animation.
    const reveals = new Map<string, [number, number]>();
    if (zoomedIn && removed.length) {
      this.clusteredIds.forEach((id) => {
        if (newClustered.has(id)) return;
        const pos = this.pointPos.get(id);
        if (!pos) return;
        const parent = this.nearestRemoved(removed, pos);
        if (parent) reveals.set(id, parent.lngLat);
      });
    }

    const changed = !setsEqual(this.clusteredIds, newClustered);
    this.clusteredIds = newClustered;
    if (changed || reveals.size) this.opts.onChange(newClustered, reveals);
  }

  private nearestRemoved(
    removed: Array<{ x: number; y: number; lngLat: [number, number] }>,
    lngLat: [number, number],
  ): { lngLat: [number, number] } | null {
    if (!removed.length) return null;
    const p = this.map.project(lngLat);
    let best: { lngLat: [number, number] } | null = null;
    let bestDist = PARENT_RADIUS_PX;
    for (const r of removed) {
      const d = Math.hypot(r.x - p.x, r.y - p.y);
      if (d < bestDist) { bestDist = d; best = r; }
    }
    return best;
  }

  private fadeOutAndRemove(dc: DisplayedCluster) {
    dc.inner.style.opacity = '0';
    dc.inner.style.transform = 'scale(0.85)';
    this.fading.add(dc.marker);
    const t = window.setTimeout(() => {
      this.timeouts.delete(t);
      this.fading.delete(dc.marker);
      dc.marker.remove();
    }, FADE_MS + 30);
    this.timeouts.add(t);
  }

  /**
   * Convergence/divergence discrète : anime l'offset px du marqueur depuis la
   * position de son parent vers zéro (ease-out, sans rebond). L'offset est
   * composé par Mapbox dans son propre transform — on ne touche jamais au
   * transform que Mapbox contrôle.
   */
  animateMarkerFrom(marker: mapboxgl.Marker, from: [number, number]) {
    const to = marker.getLngLat();
    const p0 = this.map.project(from);
    const p1 = this.map.project([to.lng, to.lat]);
    const dx = p0.x - p1.x;
    const dy = p0.y - p1.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 3 || dist > 400) return;
    const start = performance.now();
    const step = (now: number) => {
      if (this.destroyed) return;
      const t = Math.min(1, (now - start) / CONVERGE_MS);
      const e = 1 - Math.pow(1 - t, 3);
      marker.setOffset([dx * (1 - e), dy * (1 - e)]);
      if (t < 1) requestAnimationFrame(step);
      else marker.setOffset([0, 0]);
    };
    marker.setOffset([dx, dy]);
    requestAnimationFrame(step);
  }

  /**
   * Révélation d'un pin après un split : divergence depuis le parent + léger
   * fondu. Les styles inline transitoires sont restaurés à l'identique — le
   * design du pin n'est jamais modifié.
   */
  animatePinReveal(marker: mapboxgl.Marker, from: [number, number]) {
    this.animateMarkerFrom(marker, from);
    const el = marker.getElement();
    const prevTransition = el.style.transition;
    el.style.opacity = '0.25';
    el.style.transition = `opacity ${FADE_MS}ms ease-out`;
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    const t = window.setTimeout(() => {
      this.timeouts.delete(t);
      el.style.opacity = '';
      el.style.transition = prevTransition;
    }, FADE_MS + 70);
    this.timeouts.add(t);
  }

  /** Cluster sous un point écran (clic/tap), le plus proche si chevauchement. */
  findClusterAt(point: { x: number; y: number }): DisplayedCluster | null {
    let best: DisplayedCluster | null = null;
    let bestDist = Infinity;
    this.displayed.forEach((dc) => {
      const p = this.map.project(dc.lngLat);
      const d = Math.hypot(p.x - point.x, p.y - point.y);
      if (d <= dc.size / 2 + 4 && d < bestDist) { bestDist = d; best = dc; }
    });
    return best;
  }

  /**
   * Clic sur un cluster : zoom fluide vers le niveau exact où il se scinde.
   * Jamais de sélection, jamais de popup, jamais de fiche client.
   */
  zoomToCluster(dc: DisplayedCluster) {
    let target: number;
    if (dc.clusterId != null && this.index) {
      try {
        target = this.index.getClusterExpansionZoom(dc.clusterId);
      } catch {
        target = this.map.getZoom() + 2;
      }
    } else {
      // Groupe à coordonnées identiques : ne se scinde jamais, on rapproche.
      target = this.map.getZoom() + 2;
    }
    target = Math.min(Math.max(target, this.map.getZoom() + 0.5), this.map.getMaxZoom());
    this.map.easeTo({ center: dc.lngLat, zoom: target, duration: 600 });
  }

  /** Éléments DOM possédés par le gestionnaire — pour le sweep anti-orphelins. */
  trackedElements(): HTMLElement[] {
    const els: HTMLElement[] = [];
    this.displayed.forEach((dc) => els.push(dc.marker.getElement()));
    this.fading.forEach((m) => els.push(m.getElement()));
    return els;
  }

  destroy() {
    this.destroyed = true;
    this.map.off('zoom', this.handleZoom);
    this.map.off('moveend', this.handleMoveEnd);
    this.map.off('resize', this.handleResize);
    this.timeouts.forEach((t) => window.clearTimeout(t));
    this.timeouts.clear();
    this.displayed.forEach((dc) => dc.marker.remove());
    this.displayed.clear();
    this.fading.forEach((m) => m.remove());
    this.fading.clear();
    this.clusteredIds.clear();
    this.index = null;
  }
}
