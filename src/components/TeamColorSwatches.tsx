import React from 'react';
import { cn } from '../lib/utils';
import { PRESET_GRADIENTS, presetGradient } from '../lib/presetPalette';

/**
 * Sélecteur de couleur d'équipe basé sur la palette partagée de 15 dégradés
 * (presetPalette) — même nuancier que les presets de devis. La valeur stockée
 * dans `color_hex` est le côté foncé du dégradé.
 */
interface TeamColorSwatchesProps {
  value: string;
  onChange: (hex: string) => void;
  size?: 'sm' | 'md';
}

export default function TeamColorSwatches({ value, onChange, size = 'md' }: TeamColorSwatchesProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {PRESET_GRADIENTS.map(([primary], i) => (
        <button
          key={primary}
          type="button"
          onClick={() => onChange(primary)}
          className={cn(
            size === 'sm' ? 'h-5 w-5' : 'h-7 w-7',
            'rounded-full transition-all',
            value.toLowerCase() === primary
              ? 'ring-2 ring-offset-2 ring-primary scale-110'
              : 'hover:scale-105',
          )}
          style={{ background: presetGradient(i) }}
        />
      ))}
    </div>
  );
}
