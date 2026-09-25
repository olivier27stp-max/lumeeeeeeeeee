/**
 * Aucun champ personnalisé pour cet objet : au lieu de ne RIEN afficher
 * (Rafba, 2026-09-25 : « je vois pas les custom fields » — ses champs étaient
 * archivés, et les fenêtres restaient muettes), on dit qu'il n'y en a pas et
 * où en créer. Propriétaire et admin seulement : les autres ne peuvent pas en
 * créer. Nouvel onglet, pour ne pas perdre une saisie en cours.
 */
import { Layers, ExternalLink } from 'lucide-react';
import { usePermissions } from '../../hooks/usePermissions';
import { cn } from '../../lib/utils';

export default function LienAjouterChamps({ fr, className }: { fr: boolean; className?: string }) {
  const { role } = usePermissions();
  if (role !== 'owner' && role !== 'admin') return null;
  return (
    <p className={cn('flex flex-wrap items-center gap-1.5 text-[12px] text-text-tertiary', className)}>
      <Layers size={13} aria-hidden />
      {fr ? 'Aucun champ personnalisé.' : 'No custom fields.'}
      <a
        href="/settings/custom-fields"
        target="_blank"
        rel="noopener"
        className="inline-flex items-center gap-1 font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
      >
        {fr ? 'Ajouter des champs' : 'Add fields'}
        <ExternalLink size={11} aria-hidden />
      </a>
    </p>
  );
}
