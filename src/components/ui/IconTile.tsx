import React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

/** @deprecated TileColor kept for backward compat — no longer applies color */
export type TileColor = 'pink' | 'amber' | 'green' | 'blue' | 'purple' | 'rose' | 'cyan';
export type TileSize = 'sm' | 'md' | 'lg';

const sizeMap: Record<TileSize, number> = {
  sm: 13,
  md: 15,
  lg: 18,
};

interface IconTileProps {
  icon: LucideIcon;
  /** @deprecated color is ignored — icons render plain without background */
  color?: TileColor;
  size?: TileSize;
  className?: string;
}

export default function IconTile({ icon: Icon, size = 'md', className }: IconTileProps) {
  return (
    <Icon size={sizeMap[size]} strokeWidth={1.8} className={cn('text-text-secondary', className)} />
  );
}
