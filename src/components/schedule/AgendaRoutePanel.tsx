import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Route, MapPin, Car, Clock, Navigation, ExternalLink, CheckCircle2, AlertTriangle, CircleAlert } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { formatCurrency } from '../../lib/utils';
import { formatDistance, formatDuration } from '../../lib/routeApi';
import type { ArretTrajet, JourTrajets, TrajetEquipe } from '../../lib/agendaTrajetsApi';

/*
 * Trajets du jour dans l'Agenda (audit 2026-09-30).
 *
 * Ce panneau montre le parcours TEL QU'IL EST PLANIFIÉ : les arrêts de chaque
 * équipe dans l'ordre chronologique de ses visites, reliés dans cet ordre sur
 * la carte. Avant, il affichait un ordre « optimisé » par Mapbox que personne
 * ne suivait, et appelait Mapbox à chaque rendu (100 appels pour une semaine).
 * Les temps de route viennent du serveur (matrice OSRM en cache).
 *
 * Signalé à l'écran, jamais en silence : trajet impossible (la route est plus
 * longue que le battement entre deux visites), chevauchement, adresses à
 * corriger, temps estimés quand le service de routes est indisponible.
 */

const FAITS = new Set(['completed', 'done']);

function lienGoogleMaps(arrets: ArretTrajet[]): string | null {
  if (arrets.length < 1) return null;
  const pt = (a: ArretTrajet) => `${a.lat},${a.lng}`;
  const base = `https://www.google.com/maps/dir/?api=1&origin=${pt(arrets[0])}&destination=${pt(arrets[arrets.length - 1])}&travelmode=driving`;
  const etapes = arrets.slice(1, -1).map(pt).join('|');
  return etapes ? `${base}&waypoints=${encodeURIComponent(etapes)}` : base;
}

export interface EquipeAffichee { id: string; nom: string; couleur: string }

interface Props {
  jour: JourTrajets | undefined;
  chargement: boolean;
  erreur: boolean;
  onReessayer: () => void;
  fuseau: string;
  equipes: Map<string, EquipeAffichee>;
  /** Revenu de chaque visite (cents), pour « qui a fait l'argent ». */
  revenus: Map<string, number>;
  couleurSansEquipe: string;
  onJobClick?: (jobId: string) => void;
}

export default function AgendaRoutePanel({ jour, chargement, erreur, onReessayer, fuseau, equipes, revenus, couleurSansEquipe, onJobClick }: Props) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [selection, setSelection] = useState<string | null>(null);

  const heure = useMemo(() => {
    const f = new Intl.DateTimeFormat(fr ? 'fr-CA' : 'en-CA', { timeZone: fuseau, hour: 'numeric', minute: '2-digit' });
    return (iso: string) => f.format(new Date(iso));
  }, [fr, fuseau]);

  const equipe = (id: string | null): EquipeAffichee =>
    (id && equipes.get(id)) || { id: id || '', nom: fr ? 'Sans équipe' : 'No team', couleur: couleurSansEquipe };
  // Stable : la carte ne se redessine pas à chaque rendu du parent.
  const couleurEquipe = useMemo(
    () => (id: string | null) => (id && equipes.get(id)?.couleur) || couleurSansEquipe,
    [equipes, couleurSansEquipe],
  );

  // Même ordre que les équipes dans les réglages (pas l'ordre des identifiants) ; « Sans équipe » en dernier.
  const equipesTriees = useMemo(() => {
    const rang = new Map([...equipes.keys()].map((id, i) => [id, i]));
    return [...(jour?.equipes ?? [])].sort((a, b) => (a.teamId ? rang.get(a.teamId) ?? 999 : 1000) - (b.teamId ? rang.get(b.teamId) ?? 999 : 1000));
  }, [jour, equipes]);

  const totaux = useMemo(() => {
    let metres = 0, secondes = 0, tournees = 0, alertes = 0, revenu = 0, estime = false;
    for (const e of jour?.equipes ?? []) {
      metres += e.totalMetres; secondes += e.totalSecondes; alertes += e.alertes; estime = estime || e.estime;
      if (e.arrets.length >= 2) tournees++;
      for (const a of e.arrets) revenu += revenus.get(a.visitId) ?? 0;
    }
    return { metres, secondes, tournees, alertes, revenu, estime };
  }, [jour, revenus]);

  if (erreur) {
    return (
      <div role="alert" className="mb-4 flex items-center gap-3 rounded-2xl border border-danger/30 bg-danger/5 px-4 py-3 text-[13px] text-danger">
        <AlertTriangle size={15} />
        <span className="flex-1">{fr ? 'Impossible de calculer les trajets de ce jour.' : "Couldn't compute this day's routes."}</span>
        <button type="button" onClick={onReessayer} className="rounded-md border border-danger/40 px-2.5 py-1 text-[12px] font-semibold hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger">
          {fr ? 'Réessayer' : 'Retry'}
        </button>
      </div>
    );
  }
  if (chargement && !jour) {
    return (
      <div className="mb-4 rounded-2xl border border-border bg-surface-card px-4 py-3 text-[12px] text-text-tertiary" aria-busy="true">
        {fr ? 'Calcul des trajets…' : 'Computing routes…'}
      </div>
    );
  }
  if (!jour || (jour.equipes.length === 0 && jour.aCorriger.length === 0)) return null;

  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-border bg-surface-card shadow-card" data-testid={`trajets-${jour.jour}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Route size={16} className="text-text-secondary" />
          <span className="text-[13.5px] font-bold tracking-tight text-text-primary">{fr ? 'Trajet du jour' : "Day's route"}</span>
          {totaux.alertes > 0 && (
            <span className="inline-flex items-center gap-1 rounded-pill bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger">
              <AlertTriangle size={10} />{totaux.alertes} {fr ? (totaux.alertes > 1 ? 'alertes' : 'alerte') : (totaux.alertes > 1 ? 'alerts' : 'alert')}
            </span>
          )}
          {totaux.estime && (
            <span className="text-[10.5px] text-text-tertiary">
              {fr ? 'Temps estimés : service de routes indisponible' : 'Estimated times: routing service unavailable'}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3.5">
          <Total valeur={String(totaux.tournees)} libelle={fr ? 'Tournées' : 'Trips'} />
          <Total valeur={formatDistance(totaux.metres, fr)} libelle="Distance" />
          <Total valeur={formatDuration(totaux.secondes, fr)} libelle={fr ? 'Conduite' : 'Drive'} />
          {totaux.revenu > 0 && <Total valeur={formatCurrency(totaux.revenu / 100)} libelle={fr ? 'Revenu' : 'Revenue'} accent />}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr]">
        <div className="relative min-h-[300px] border-b border-border lg:border-b-0 lg:border-r">
          <CarteDuJour equipes={jour.equipes} couleur={couleurEquipe} selection={selection} onSelect={setSelection} onJobClick={onJobClick} fr={fr} />
        </div>
        <div className="overflow-y-auto lg:max-h-[520px]">
          {equipesTriees.map((e, i) => (
            <SectionEquipe
              key={e.teamId ?? 'sans'}
              trajet={e}
              equipe={equipe(e.teamId)}
              premiere={i === 0}
              heure={heure}
              revenus={revenus}
              selection={selection}
              onSelect={setSelection}
              onJobClick={onJobClick}
              fr={fr}
            />
          ))}
          {jour.aCorriger.length > 0 && (
            <div className="border-t-[6px] border-surface-secondary px-4 py-3" data-testid="adresses-a-corriger">
              <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold text-warning">
                <CircleAlert size={13} />{fr ? 'Adresses à corriger' : 'Addresses to fix'} ({jour.aCorriger.length})
              </p>
              <p className="mb-2 text-[11px] text-text-tertiary">
                {fr ? 'Introuvables sur la carte : ces visites ne sont pas dans le trajet.' : "Couldn't be located: these visits aren't on the route."}
              </p>
              <ul className="space-y-1">
                {jour.aCorriger.map((v) => (
                  <li key={v.visitId} className="flex items-center gap-2 text-[12px]">
                    <span className="tabular-nums text-text-tertiary">{heure(v.debut)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-semibold text-text-primary">{v.titre}</span>
                      <span className="text-text-tertiary"> · {v.adresse || (fr ? 'aucune adresse' : 'no address')}</span>
                    </span>
                    {v.jobId && (
                      <button type="button" onClick={() => onJobClick?.(v.jobId!)} aria-label={fr ? `Corriger l’adresse — ${v.titre}` : `Fix the address — ${v.titre}`}
                        className="rounded-md p-1 text-text-tertiary hover:bg-surface-tertiary hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                        <ExternalLink size={13} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionEquipe({ trajet, equipe, premiere, heure, revenus, selection, onSelect, onJobClick, fr }: {
  trajet: TrajetEquipe; equipe: EquipeAffichee; premiere: boolean; heure: (iso: string) => string;
  revenus: Map<string, number>; selection: string | null; onSelect: (id: string) => void;
  onJobClick?: (jobId: string) => void; fr: boolean;
}) {
  const faits = trajet.arrets.filter((a) => FAITS.has(a.statut.toLowerCase())).length;
  const revenu = trajet.arrets.reduce((s, a) => s + (revenus.get(a.visitId) ?? 0), 0);
  const maps = lienGoogleMaps(trajet.arrets);
  return (
    <div className={premiere ? '' : 'border-t-[6px] border-surface-secondary'} data-testid={`equipe-${equipe.id || 'sans'}`}>
      <div className="px-4 pb-2 pt-3" style={{ boxShadow: `inset 0 3px 0 ${equipe.couleur}` }}>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: equipe.couleur }} />
          <span className="text-[12.5px] font-bold text-text-primary">{equipe.nom}</span>
          {trajet.alertes > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold text-danger">
              <AlertTriangle size={10} />{trajet.alertes}
            </span>
          )}
          {revenu > 0 && <span className="ml-auto text-[12px] font-extrabold tabular-nums text-success">{formatCurrency(revenu / 100)}</span>}
        </div>
        <div className="mt-1.5 flex items-center gap-2.5 text-[10.5px] tabular-nums text-text-tertiary">
          <span className="flex items-center gap-1"><CheckCircle2 size={10} className={faits > 0 ? 'text-success' : 'opacity-50'} />{faits}/{trajet.arrets.length} {fr ? 'faits' : 'done'}</span>
          {trajet.arrets.length >= 2 && (
            <>
              <span className="flex items-center gap-1"><Navigation size={10} />{formatDistance(trajet.totalMetres, fr)}</span>
              <span className="flex items-center gap-1"><Clock size={10} />{formatDuration(trajet.totalSecondes, fr)}</span>
            </>
          )}
          {maps && (
            <a href={maps} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10.5px] font-semibold text-text-secondary hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <ExternalLink size={11} />{fr ? 'Ouvrir dans Maps' : 'Open in Maps'}
            </a>
          )}
        </div>
      </div>
      <ol className="px-1.5 pb-2">
        {trajet.arrets.map((a) => (
          <Arret key={a.visitId} arret={a} couleur={equipe.couleur} heure={heure} revenu={revenus.get(a.visitId) ?? 0}
            choisi={selection === a.visitId} onSelect={() => onSelect(a.visitId)} onOuvrir={() => a.jobId && onJobClick?.(a.jobId)} fr={fr} />
        ))}
      </ol>
    </div>
  );
}

function Arret({ arret, couleur, heure, revenu, choisi, onSelect, onOuvrir, fr }: {
  arret: ArretTrajet; couleur: string; heure: (iso: string) => string; revenu: number;
  choisi: boolean; onSelect: () => void; onOuvrir: () => void; fr: boolean;
}) {
  const fait = FAITS.has(arret.statut.toLowerCase());
  const leg = arret.depuisPrecedent;
  const impossible = arret.alertes.includes('trajet_impossible');
  return (
    <li data-testid={`arret-${arret.visitId}`} data-ordre={arret.ordre}>
      {leg && (
        <div className={'ml-[30px] flex items-center gap-1.5 py-1 text-[10.5px] tabular-nums ' + (impossible ? 'font-semibold text-danger' : 'text-text-tertiary')}>
          <span className="h-4 w-px bg-border" />
          <Car size={11} className="opacity-60" />
          <span>{formatDistance(leg.metres, fr)} · {formatDuration(leg.secondes, fr)}{leg.estime ? (fr ? ' (estimé)' : ' (estimated)') : ''}</span>
        </div>
      )}
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
        className={'flex w-full cursor-pointer items-center gap-2 rounded-xl px-2 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' + (choisi ? 'bg-surface-secondary' : 'hover:bg-surface-secondary')}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white tabular-nums" style={{ backgroundColor: couleur }}>{arret.ordre}</span>
        <span className="min-w-0 flex-1">
          <span className={'block truncate text-[12.5px] font-semibold ' + (fait ? 'text-text-tertiary line-through' : 'text-text-primary')}>
            {arret.client ? `${arret.client} · ${arret.titre}` : arret.titre}
          </span>
          {arret.adresse && <span className="flex items-center gap-1 truncate text-[11px] text-text-tertiary"><MapPin size={10} className="shrink-0" />{arret.adresse}</span>}
          {arret.alertes.length > 0 && (
            <span className="mt-0.5 flex flex-wrap gap-1">
              {arret.alertes.includes('trajet_impossible') && (
                <span className="rounded-md bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold text-danger">{fr ? 'Trajet impossible' : 'Impossible trip'}</span>
              )}
              {arret.alertes.includes('chevauchement') && (
                <span className="rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">{fr ? 'Chevauchement' : 'Overlap'}</span>
              )}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {revenu > 0 && <span className="text-[11.5px] font-bold tabular-nums text-success">{formatCurrency(revenu / 100)}</span>}
          <span className="text-right text-[12px] font-bold tabular-nums text-text-primary" data-testid="heure-arret">{heure(arret.debut)}</span>
          <button type="button" onClick={(e) => { e.stopPropagation(); onOuvrir(); }} aria-label={fr ? `Ouvrir la job — ${arret.titre}` : `Open job — ${arret.titre}`}
            className="shrink-0 rounded-md p-1 text-text-tertiary hover:bg-surface-tertiary hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <ExternalLink size={13} />
          </button>
        </span>
      </div>
    </li>
  );
}

function Total({ valeur, libelle, accent }: { valeur: string; libelle: string; accent?: boolean }) {
  return (
    <div className="text-right leading-tight">
      <div className={'text-[14px] font-extrabold tracking-tight tabular-nums ' + (accent ? 'text-success' : 'text-text-primary')}>{valeur}</div>
      <div className="text-[8.5px] font-semibold uppercase tracking-[0.07em] text-text-tertiary">{libelle}</div>
    </div>
  );
}

/**
 * Une carte PAR JOUR, toutes les équipes dessus (une couleur chacune).
 * Montée seulement quand elle est à l'écran : une semaine en affichait 25 à la
 * fois et le navigateur effaçait les plus anciennes (« Too many active WebGL
 * contexts »). Plusieurs jobs à la même adresse : épingles décalées de
 * quelques mètres, toutes visibles.
 */
function CarteDuJour({ equipes, couleur, selection, onSelect, onJobClick, fr }: {
  equipes: TrajetEquipe[]; couleur: (teamId: string | null) => string; fr: boolean;
  selection: string | null; onSelect: (id: string) => void; onJobClick?: (jobId: string) => void;
}) {
  const boite = useRef<HTMLDivElement>(null);
  const carteRef = useRef<mapboxgl.Map | null>(null);
  const epingles = useRef<Map<string, { marqueur: mapboxgl.Marker; el: HTMLDivElement }>>(new Map());
  const [visible, setVisible] = useState(false);
  const [prete, setPrete] = useState(false);
  const [panne, setPanne] = useState(false);
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const onJobClickRef = useRef(onJobClick); onJobClickRef.current = onJobClick;

  useEffect(() => {
    const el = boite.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    // Montée à la première apparition, puis gardée : la démonter en sortant de
    // l'écran la détruisait dès qu'on choisissait un arrêt dans la liste (iPad).
    // Une semaine = au plus 7 cartes, sous la limite du navigateur.
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = boite.current;
    if (!visible || !el || carteRef.current) return;
    const jeton = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!jeton) { setPanne(true); return; }
    mapboxgl.accessToken = jeton;
    const carte = new mapboxgl.Map({ container: el, style: 'mapbox://styles/mapbox/light-v11', center: [-72.5, 46], zoom: 8, attributionControl: false });
    carteRef.current = carte;
    carte.on('load', () => { carte.resize(); setPrete(true); });
    carte.on('error', (e) => { if (!carte.loaded()) { setPanne(true); console.error('[agenda] carte indisponible', e?.error?.message); } });
    const ro = new ResizeObserver(() => carte.resize());
    ro.observe(el);
    return () => { ro.disconnect(); carte.remove(); carteRef.current = null; setPrete(false); };
  }, [visible]);

  useEffect(() => {
    const carte = carteRef.current;
    if (!carte || !prete) return;
    epingles.current.forEach(({ marqueur }) => marqueur.remove());
    epingles.current = new Map();
    const limites = new mapboxgl.LngLatBounds();
    const vus = new Map<string, number>();
    equipes.forEach((e, i) => {
      const c = couleur(e.teamId);
      const source = `trajet-${i}`;
      const coords = e.arrets.map((a) => [a.lng, a.lat] as [number, number]);
      const donnees: GeoJSON.Feature = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } };
      const existante = carte.getSource(source) as mapboxgl.GeoJSONSource | undefined;
      if (existante) existante.setData(donnees);
      else if (coords.length >= 2) {
        carte.addSource(source, { type: 'geojson', data: donnees });
        carte.addLayer({ id: source, type: 'line', source, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': c, 'line-width': 3.5, 'line-opacity': 0.85 } });
      }
      for (const a of e.arrets) {
        const k = `${a.lat.toFixed(5)},${a.lng.toFixed(5)}`;
        const rang = vus.get(k) ?? 0; vus.set(k, rang + 1);
        // Même adresse : décalage de ~15 m par épingle supplémentaire.
        const lng = a.lng + rang * 0.0002, lat = a.lat + rang * 0.0001;
        const el = document.createElement('div');
        el.className = 'lume-epingle-agenda';
        el.dataset.visite = a.visitId;
        el.dataset.ordre = String(a.ordre);
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', `${a.ordre}. ${a.titre}`);
        el.style.cssText = `width:24px;height:24px;border-radius:50%;background:${c};color:#fff;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.35);` +
          'display:flex;align-items:center;justify-content:center;font:800 11px Inter,system-ui,sans-serif;cursor:pointer;';
        el.textContent = String(a.ordre);
        el.addEventListener('click', (ev) => { ev.stopPropagation(); onSelectRef.current(a.visitId); if (a.jobId) onJobClickRef.current?.(a.jobId); });
        const marqueur = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(carte);
        epingles.current.set(a.visitId, { marqueur, el });
        limites.extend([lng, lat]);
      }
    });
    for (let i = equipes.length; i < equipes.length + 12; i++) {
      if (carte.getLayer(`trajet-${i}`)) carte.removeLayer(`trajet-${i}`);
      if (carte.getSource(`trajet-${i}`)) carte.removeSource(`trajet-${i}`);
    }
    if (!limites.isEmpty()) carte.fitBounds(limites, { padding: 40, maxZoom: 14, duration: 0 });
  }, [equipes, couleur, prete]);

  useEffect(() => {
    epingles.current.forEach(({ el }, id) => {
      el.style.outline = id === selection ? '3px solid rgba(0,0,0,.35)' : '';
      el.style.zIndex = id === selection ? '5' : '';
    });
    const el = selection ? epingles.current.get(selection) : null;
    const carte = carteRef.current;
    if (el && carte) {
      const a = equipes.flatMap((e) => e.arrets).find((x) => x.visitId === selection);
      if (a) carte.easeTo({ center: [a.lng, a.lat], duration: 300 });
    }
  }, [selection, equipes, prete]);

  return (
    <div className="h-full min-h-[300px] w-full">
      <div ref={boite} className="h-full min-h-[300px] w-full" data-testid="carte-jour" />
      {panne && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-secondary/80 text-[12px] text-text-tertiary" role="status">
          {fr ? 'Carte indisponible — la liste des arrêts reste exacte.' : 'Map unavailable — the stop list is still accurate.'}
        </div>
      )}
    </div>
  );
}
