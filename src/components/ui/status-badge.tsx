import React, { useState } from 'react';
import { User, CheckCircle, PauseCircle, type LucideIcon } from 'lucide-react';

export type ClientStatus = 'lead' | 'active' | 'inactive';

interface StatusMeta {
  label: string;
  icon: LucideIcon;
  bg: string;
  iconColor: string;
}

const STATUS_CONFIG: Record<ClientStatus, StatusMeta> = {
  lead: {
    label: 'LEAD',
    icon: User,
    bg: 'linear-gradient(135deg, #1A1D24 0%, #0F1117 100%)',
    iconColor: '#4F8CFF',
  },
  active: {
    label: 'ACTIVE',
    icon: CheckCircle,
    bg: 'linear-gradient(135deg, #0F5132 0%, #0A3822 100%)',
    iconColor: '#43D17B',
  },
  inactive: {
    label: 'INACTIVE',
    icon: PauseCircle,
    bg: 'linear-gradient(135deg, #3A3A3A 0%, #232323 100%)',
    iconColor: '#B5B5B5',
  },
};

const BASE_SHADOW = '0 4px 12px rgba(0,0,0,0.20)';
const HOVER_SHADOW = '0 8px 20px rgba(0,0,0,0.28)';

interface StatusBadgeProps {
  status: ClientStatus | string;
  className?: string;
}

/**
 * Premium enterprise-grade client status badge.
 * Structure: [ colored icon ] | STATUS  — dark gradient pill, white uppercase text.
 * Falls back to the `inactive` treatment for any unknown status.
 */
export default function StatusBadge({ status, className }: StatusBadgeProps) {
  const [hovered, setHovered] = useState(false);
  const config = STATUS_CONFIG[status as ClientStatus] ?? STATUS_CONFIG.inactive;
  const Icon = config.icon;

  return (
    <span
      className={className}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
        minWidth: 92,
        padding: '0 8px',
        borderRadius: 999,
        background: config.bg,
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: hovered ? HOVER_SHADOW : BASE_SHADOW,
        transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
        transition: 'all 0.18s ease',
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}
    >
      <Icon size={12} color={config.iconColor} strokeWidth={2.25} aria-hidden />
      <span
        aria-hidden
        style={{
          width: 1,
          height: 11,
          background: 'rgba(255,255,255,0.12)',
          margin: '0 6px',
        }}
      />
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: '#FFFFFF',
          lineHeight: 1,
        }}
      >
        {config.label}
      </span>
    </span>
  );
}
