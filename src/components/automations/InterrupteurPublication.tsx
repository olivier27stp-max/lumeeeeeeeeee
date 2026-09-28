/**
 * L'interrupteur « Brouillon / Publiée » d'une automatisation.
 *
 * Demandé par Rafba le 2026-09-28 : ROUGE en brouillon (rien ne part), VERT
 * une fois publiée, et plus gros — on doit voir d'un coup d'œil ce qui tourne.
 * Un seul composant pour la liste et l'éditeur : deux interrupteurs qui
 * divergent finissent par dire deux choses différentes.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

interface Props {
  actif: boolean;
  onBascule: () => void;
  /** Texte lu par un lecteur d'écran (le nom de l'automatisation, par ex.). */
  libelle: string;
  enCours?: boolean;
  desactive?: boolean;
  /** Affiche « Brouillon » / « Publiée » à côté de l'interrupteur. */
  avecEtiquette?: boolean;
  fr: boolean;
}

export default function InterrupteurPublication({ actif, onBascule, libelle, enCours, desactive, avecEtiquette, fr }: Props) {
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={actif}
        aria-label={libelle}
        onClick={onBascule}
        disabled={enCours || desactive}
        className={cn(
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
          actif ? 'bg-success' : 'bg-danger',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow transition-all',
            actif ? 'left-[1.375rem]' : 'left-0.5',
          )}
        >
          {enCours && <Loader2 className="h-3.5 w-3.5 animate-spin text-text-tertiary" aria-hidden="true" />}
        </span>
      </button>
      {avecEtiquette && (
        <span className={cn('text-xs font-semibold', actif ? 'text-success' : 'text-danger')}>
          {actif ? (fr ? 'Publiée' : 'Published') : (fr ? 'Brouillon' : 'Draft')}
        </span>
      )}
    </span>
  );
}
