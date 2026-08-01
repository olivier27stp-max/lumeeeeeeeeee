import React from 'react';
import { cn } from '../lib/utils';
import { TAG_COLORS } from '../lib/tagPalette';

/**
 * Sélecteur de couleur des tags de jobs — palette vive (tagPalette), pastilles
 * pleines (aucun dégradé). La valeur stockée dans `color_hex` est le hex exact.
 */
interface TagColorSwatchesProps {
  value: string;
  onChange: (hex: string) => void;
  size?: 'sm' | 'md';
}

export default function TagColorSwatches({ value, onChange, size = 'md' }: TagColorSwatchesProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {TAG_COLORS.map((hex) => (
        <button
          key={hex}
          type="button"
          onClick={() => onChange(hex)}
          className={cn(
            size === 'sm' ? 'h-5 w-5' : 'h-7 w-7',
            'rounded-full transition-all',
            value.toLowerCase() === hex
              ? 'ring-2 ring-offset-2 ring-primary scale-110'
              : 'hover:scale-105',
          )}
          style={{ backgroundColor: hex }}
        />
      ))}
    </div>
  );
}
