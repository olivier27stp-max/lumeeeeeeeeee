/**
 * ClientPinMiniMap — small read-only preview of the D2D sales map showing ONLY
 * the pin of one client (every other pin stays hidden here, the data itself is
 * untouched). Clicking the box opens /field-sales centered on that pin.
 */
import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MapPin, ExternalLink } from 'lucide-react';
import { createLeadPinElement, type PinStatus } from './lead-pin';
import { useTranslation } from '../../i18n';

// Same FieldSales API status → pin status mapping as D2DMap.
const STATUS_MAP: Record<string, PinStatus> = {
  sale: 'closed_won', sold: 'closed_won', closed_won: 'closed_won',
  lead: 'follow_up', follow_up: 'follow_up', callback: 'follow_up',
  no_answer: 'no_answer',
  not_interested: 'rejected', do_not_knock: 'rejected', rejected: 'rejected',
  quote_sent: 'appointment', appointment: 'appointment',
  unknown: 'other', new: 'other', knocked: 'other', note: 'other', revisit: 'other', other: 'other',
};

export interface ClientMapPin {
  lat: number;
  lng: number;
  status: string;
}

interface ClientPinMiniMapProps {
  /** The selected client's sales-map pin, or null when they have none */
  pin: ClientMapPin | null;
  /** Whether a client is currently selected (drives the placeholder text) */
  hasClient: boolean;
  /** Called when the box is clicked (only when a pin exists) */
  onOpen: () => void;
}

export default function ClientPinMiniMap({ pin, hasClient, onOpen }: ClientPinMiniMapProps) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const resizeObsRef = useRef<ResizeObserver | null>(null);

  const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
  const lat = pin?.lat;
  const lng = pin?.lng;
  const status = pin?.status;

  useEffect(() => {
    if (lat == null || lng == null || !token) {
      markerRef.current?.remove();
      markerRef.current = null;
      resizeObsRef.current?.disconnect();
      resizeObsRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      return;
    }
    if (!containerRef.current) return;

    if (!mapRef.current) {
      mapboxgl.accessToken = token;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center: [lng, lat],
        zoom: 16.5,
        interactive: false,
        attributionControl: false,
      });
      // The form host animates in and the grid can resize after init — keep
      // the canvas matched to the box or the map renders blank.
      map.on('load', () => map.resize());
      resizeObsRef.current?.disconnect();
      resizeObsRef.current = new ResizeObserver(() => mapRef.current?.resize());
      resizeObsRef.current.observe(containerRef.current);
      mapRef.current = map;
    } else {
      mapRef.current.jumpTo({ center: [lng, lat] });
    }

    markerRef.current?.remove();
    const el = createLeadPinElement(STATUS_MAP[status || 'other'] || 'other');
    markerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat([lng, lat])
      .addTo(mapRef.current);
  }, [lat, lng, status, token]);

  useEffect(() => () => {
    markerRef.current?.remove();
    resizeObsRef.current?.disconnect();
    resizeObsRef.current = null;
    mapRef.current?.remove();
    mapRef.current = null;
  }, []);

  const hasMap = pin != null && Boolean(token);

  return (
    <section
      onClick={hasMap ? onOpen : undefined}
      role={hasMap ? 'button' : undefined}
      title={hasMap ? (fr ? 'Voir sur la map de vente' : 'View on the sales map') : undefined}
      className={[
        'relative overflow-hidden rounded-xl border border-border bg-surface-card min-h-[240px]',
        hasMap ? 'cursor-pointer group' : '',
      ].join(' ')}
    >
      {hasMap ? (
        <>
          <div ref={containerRef} className="absolute inset-0" />
          {/* Label chip */}
          <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-lg bg-black/55 backdrop-blur px-2.5 py-1.5 text-[11px] font-semibold text-white pointer-events-none">
            <MapPin size={12} />
            {fr ? 'Map de vente' : 'Sales map'}
          </div>
          {/* Hover hint */}
          <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-3 pt-8 pb-3 text-[12px] font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <ExternalLink size={12} />
            {fr ? 'Ouvrir la map sur ce pin' : 'Open the map on this pin'}
          </div>
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
          <MapPin size={20} className="text-text-tertiary" />
          <p className="text-[12px] text-text-tertiary max-w-[220px]">
            {!hasClient
              ? (fr ? 'Sélectionnez un client pour voir son pin sur la map de vente.' : 'Select a client to see their pin on the sales map.')
              : (fr ? 'Aucune localisation trouvée pour ce client (pin de vente ou adresse géocodée).' : 'No location found for this client (sales pin or geocoded address).')}
          </p>
        </div>
      )}
    </section>
  );
}
