import React from 'react';
import { Popup } from 'react-leaflet';
import { ArrowUpRight, Briefcase, Calendar, MapPin } from 'lucide-react';
import type { MapJobPin } from '../../lib/mapApi';
import StatusBadge from '../ui/StatusBadge';
import IconTile from '../ui/IconTile';
import { formatCurrency } from '../../lib/utils';

interface JobPopupProps {
  pin: MapJobPin;
  onClose: () => void;
  onOpenJob?: (jobId: string) => void;
}

function formatTime(iso: string | null) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

function formatDate(iso: string | null) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return null;
  }
}

export default function JobPopup({ pin, onClose, onOpenJob }: JobPopupProps) {
  const startTime = formatTime(pin.scheduledAt);
  const endTime = formatTime(pin.endAt);
  const dateLabel = formatDate(pin.scheduledAt);
  const timeLabel = startTime && endTime ? `${startTime} - ${endTime}` : startTime;

  return (
    <Popup
      position={[pin.latitude, pin.longitude]}
      offset={[0, -12]}
      closeButton={false}
      autoPan
      className="crm-map-popup"
      eventHandlers={{ remove: onClose }}
    >
      <div
        className="w-72 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-3.5 pt-3.5 pb-2.5">
          <div className="flex items-start gap-2.5">
            <IconTile icon={Briefcase} color="amber" size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-text-primary truncate">{pin.title}</p>
              {pin.clientName && (
                <p className="text-xs text-text-secondary font-medium truncate">{pin.clientName}</p>
              )}
              {pin.jobNumber && (
                <p className="text-[11px] text-text-tertiary font-medium mt-0.5">#{pin.jobNumber}</p>
              )}
            </div>
            <StatusBadge status={pin.status} />
          </div>
        </div>

        {/* Details */}
        <div className="px-3.5 pb-3 space-y-1.5">
          {pin.address && (
            <div className="flex items-start gap-2 text-xs text-text-secondary">
              <MapPin size={12} className="shrink-0 mt-0.5 text-text-tertiary" />
              <span className="font-medium">{pin.address}</span>
            </div>
          )}
          {(dateLabel || timeLabel) && (
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              <Calendar size={12} className="shrink-0 text-text-tertiary" />
              <span className="font-medium">
                {dateLabel}{timeLabel ? ` · ${timeLabel}` : ''}
              </span>
            </div>
          )}
          {pin.teamName && (
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              <div
                className="w-3 h-3 rounded shrink-0 border border-outline-subtle"
                style={{ backgroundColor: pin.teamColor || '#d4d4d4' }}
              />
              <span className="font-medium">{pin.teamName}</span>
            </div>
          )}
          {pin.totalCents > 0 && (
            <p className="text-xs font-bold text-text-primary tabular-nums">
              {formatCurrency(pin.totalCents / 100)}
            </p>
          )}
        </div>

        {/* Action */}
        {onOpenJob && (
          <div className="px-3.5 pb-3">
            <button
              type="button"
              onClick={() => onOpenJob(pin.jobId)}
              className="glass-button w-full inline-flex items-center justify-center gap-1.5 text-xs"
            >
              Open Job <ArrowUpRight size={12} />
            </button>
          </div>
        )}
      </div>
    </Popup>
  );
}
