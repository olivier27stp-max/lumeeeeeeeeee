import React from 'react';
import { Link } from 'react-router-dom';
import { Mail, MapPin, Phone } from 'lucide-react';
import StatusBadge from './ui/StatusBadge';
import { displayEmail, displayPhone } from '../lib/piiSanitizer';

interface EntityHubHeaderProps {
  /** Entity icon rendered in the tile at the top of the box. */
  icon: React.ReactNode;
  /** icon-tile color class, e.g. 'icon-tile-blue'. */
  iconTileClass?: string;
  /** Entity status, rendered as a StatusBadge next to the icon. */
  status?: string | null;
  /** Extra badges shown next to the status (e.g. "Today", "Archived"). */
  statusExtra?: React.ReactNode;
  /** Entity title — very large and bold. A ReactNode is allowed for inline editing. */
  title: React.ReactNode;
  /** Entity number (#) rendered next to the title — pass an EntityNumberEditor for inline editing. */
  number?: React.ReactNode;
  /** Client (or company when displayed as primary) — clicking opens the client hub. */
  client?: { id?: string | null; name: string } | null;
  /** Address — clicking opens Google Maps. */
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Small extra line under the contact info (dates, company, etc.). */
  meta?: React.ReactNode;
  /** Action buttons rendered at the top right of the box. */
  actions?: React.ReactNode;
}

/**
 * Shared hub header for the Job / Request / Quote / Invoice detail pages.
 * Same template everywhere: icon + status on top, huge bold title, then the
 * clickable client name, the address (Google Maps) and the contact info.
 */
export default function EntityHubHeader({
  icon,
  iconTileClass = 'icon-tile-blue',
  status,
  statusExtra,
  title,
  number,
  client,
  address,
  phone,
  email,
  meta,
  actions,
}: EntityHubHeaderProps) {
  const mapsUrl = address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : null;

  return (
    // overflow visible (section-card clips by default): the actions render
    // dropdown menus that must extend below the card edge.
    <div className="section-card p-6" style={{ overflow: 'visible' }}>
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0">
          {/* Logo + status */}
          <div className="flex items-center gap-3">
            <div className={`icon-tile icon-tile-lg ${iconTileClass}`}>{icon}</div>
            {status && <StatusBadge status={status} />}
            {statusExtra}
          </div>

          {/* Title + number */}
          <h1 className="mt-4 text-[30px] font-extrabold text-text-primary leading-tight break-words">
            {title}
            {number != null && <span className="ml-2.5">{number}</span>}
          </h1>

          {/* Client / company — opens the client hub */}
          {client?.name && (
            client.id ? (
              <Link
                to={`/clients/${client.id}`}
                className="mt-2 inline-block text-[18px] font-bold text-text-primary hover:text-primary hover:underline transition-colors"
              >
                {client.name}
              </Link>
            ) : (
              <p className="mt-2 text-[18px] font-bold text-text-primary">{client.name}</p>
            )
          )}

          {/* Address — opens Google Maps */}
          {address && mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-primary hover:underline w-fit"
            >
              <MapPin size={13} className="shrink-0 text-text-tertiary" />
              {address}
            </a>
          )}

          {/* Contact info */}
          {(phone || email) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              {phone && (
                <a
                  href={`tel:${phone}`}
                  className="flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-primary hover:underline"
                >
                  <Phone size={13} className="shrink-0 text-text-tertiary" />
                  {displayPhone(phone)}
                </a>
              )}
              {email && (
                <a
                  href={`mailto:${email}`}
                  className="flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-primary hover:underline break-all"
                >
                  <Mail size={13} className="shrink-0 text-text-tertiary" />
                  {displayEmail(email)}
                </a>
              )}
            </div>
          )}

          {meta && <div className="mt-2 text-[12px] text-text-tertiary">{meta}</div>}
        </div>

        {actions && (
          <div className="flex items-center gap-2 shrink-0 print:hidden">{actions}</div>
        )}
      </div>
    </div>
  );
}
