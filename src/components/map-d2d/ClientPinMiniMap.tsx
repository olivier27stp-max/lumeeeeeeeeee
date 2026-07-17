/**
 * ClientPinMiniMap — small read-only preview of the D2D sales map showing ONLY
 * the pin of one client (every other pin stays hidden here, the data itself is
 * untouched). Clicking the box opens /field-sales centered on that pin.
 *
 * Rendered with the Mapbox Static Images API rather than a live GL map: a
 * non-interactive preview doesn't need WebGL, and a static image can't hit the
 * blank-canvas sizing issues GL maps have inside animated/grid containers.
 */
import { useEffect, useState } from 'react';
import { MapPin, ExternalLink } from 'lucide-react';
import { PIN_STATUS_CONFIG, type PinStatus } from './lead-pin';
import { useTranslation } from '../../i18n';

// Same FieldSales API status → pin status mapping as D2DMap.
const STATUS_MAP: Record<string, PinStatus> = {
  sale: 'closed_won', sold: 'closed_won', closed_won: 'closed_won',
  lead: 'lead',
  follow_up: 'follow_up', callback: 'follow_up',
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
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
  const [imgFailed, setImgFailed] = useState(false);

  const lat = pin?.lat;
  const lng = pin?.lng;
  useEffect(() => { setImgFailed(false); }, [lat, lng]);

  const hasMap = pin != null && Boolean(token) && !imgFailed;
  const imgUrl = hasMap
    ? `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/${lng},${lat},16.5,0/640x320@2x?access_token=${token}&attribution=false&logo=false`
    : null;
  const cfg = PIN_STATUS_CONFIG[STATUS_MAP[pin?.status || 'other'] || 'other'];

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
      {hasMap && imgUrl ? (
        <>
          <img
            src={imgUrl}
            alt={fr ? 'Localisation du client sur la map de vente' : 'Client location on the sales map'}
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* The pin sits at the image's center — overlay the same 28px marker
              the live D2D map uses. */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: `linear-gradient(135deg, ${cfg.gradientFrom}, ${cfg.gradientTo})`,
                border: '2px solid rgba(255,255,255,0.92)',
                boxShadow: `0 0 8px ${cfg.color}66, 0 2px 6px rgba(0,0,0,0.4)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 0,
              }}
              dangerouslySetInnerHTML={{
                __html: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${cfg.iconPaths}</svg>`,
              }}
            />
          </div>
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
