import React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export type TileColor = 'pink' | 'amber' | 'green' | 'blue' | 'purple' | 'rose' | 'cyan';
export type TileSize = 'sm' | 'md' | 'lg';

const sizeMap: Record<TileSize, { tile: string; icon: number }> = {
  sm: { tile: 'icon-tile-sm', icon: 13 },
  md: { tile: 'icon-tile-md', icon: 15 },
  lg: { tile: 'icon-tile-lg', icon: 18 },
};

interface IconTileProps {
  icon: LucideIcon;
  color?: TileColor;
  size?: TileSize;
  className?: string;
}

export default function IconTile({ icon: Icon, color = 'blue', size = 'md', className }: IconTileProps) {
  return (
    <div className={cn('icon-tile', sizeMap[size].tile, `icon-tile-${color}`, className)}>
      <Icon size={sizeMap[size].icon} strokeWidth={2} />
    </div>
  );
}
