/**
 * « Placer dans le formulaire » — demande de Rafba (2026-09-28) : quand on ajoute
 * une custom key, le formulaire (ex. Nouveau client) s'ouvre, lui propose une place
 * (surlignée), on la glisse entre les champs de base, puis « Sauvegarder ».
 *
 * Les champs de base (rangées grises, cadenas) ne bougent pas ; seules les custom
 * keys se glissent. La place s'enregistre pour tout le compte : dossier (section),
 * `config.apres` (la rangée suivie) et `position` — règle de src/lib/champs/placement.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GripVertical, Lock, X, Loader2 } from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { modifierChamp, type ChampPerso, type DossierChamp, type ObjetChamp } from '../../lib/champsPersoApi';
import { lirePlan, planFormulaire, type ElementPlan } from '../../lib/champs/placement';
import { cn } from '../../lib/utils';

const TITRE_FORMULAIRE: Record<ObjetChamp, { fr: string; en: string }> = {
  client: { fr: 'Nouveau client', en: 'New client' },
  deal: { fr: 'Nouveau deal', en: 'New deal' },
  job: { fr: 'Nouvelle job', en: 'New job' },
  quote: { fr: 'Nouveau devis', en: 'New quote' },
  invoice: { fr: 'Nouvelle facture', en: 'New invoice' },
  property: { fr: 'Nouvelle propriété', en: 'New property' },
};

function Element({ e, cible, fr }: { e: ElementPlan; cible: string; fr: boolean }) {
  const mobile = e.type === 'champ';
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: e.id, disabled: !mobile });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  if (e.type === 'entete') {
    return (
      <li ref={setNodeRef} style={style} className="px-1 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary first:pt-1">
        {e.titre}
      </li>
    );
  }
  if (e.type === 'rangee') {
    return (
      <li ref={setNodeRef} style={style} className="flex items-center gap-2 rounded-md border border-outline bg-surface-secondary/60 px-3 py-2 text-[13px] text-text-secondary">
        <span className="min-w-0 flex-1 truncate">{e.libelle}</span>
        <Lock size={12} className="shrink-0 text-text-tertiary" aria-label={fr ? 'Champ de base' : 'Base field'} />
      </li>
    );
  }
  const estCible = e.champ.id === cible;
  return (
    <li ref={setNodeRef} style={style} data-cible={estCible || undefined}
      className={cn('flex items-center gap-2 rounded-md border bg-surface px-2 py-2 text-[13px] text-text-primary shadow-sm',
        estCible ? 'border-primary ring-2 ring-primary/30' : 'border-outline')}>
      <button type="button" {...attributes} {...listeners} aria-label={fr ? `Déplacer ${e.champ.label}` : `Move ${e.champ.label}`}
        className="cursor-grab rounded p-0.5 text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        <GripVertical size={14} aria-hidden />
      </button>
      <span className="min-w-0 flex-1 truncate font-medium">{e.champ.label}</span>
      {estCible && <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{fr ? 'À placer' : 'To place'}</span>}
    </li>
  );
}

export default function PlacerChampFenetre({ objet, champ, champs, dossiers, fr, onClose, onSauvegarde }: {
  objet: ObjetChamp;
  /** La custom key à placer (surlignée). */
  champ: ChampPerso;
  /** Custom keys actives de l'objet (la cible incluse ou non). */
  champs: ChampPerso[];
  dossiers: DossierChamp[];
  fr: boolean;
  onClose: () => void;
  onSauvegarde?: () => void;
}) {
  const qc = useQueryClient();
  const idTitre = useId();
  const tous = useMemo(() => {
    const actifs = champs.filter((c) => c.object_type === objet && !c.archived_at && !c.config?.masque_creation);
    return actifs.some((c) => c.id === champ.id) ? actifs : [...actifs, champ];
  }, [champs, champ, objet]);
  const initial = useMemo(() => planFormulaire(objet, tous, dossiers, fr), [objet, tous, dossiers, fr]);
  const [plan, setPlan] = useState<ElementPlan[]>(initial);
  const [envoi, setEnvoi] = useState(false);
  const liste = useRef<HTMLUListElement>(null);

  // La place proposée : visible dès l'ouverture.
  useEffect(() => {
    liste.current?.querySelector('[data-cible]')?.scrollIntoView({ block: 'center' });
  }, []);
  useEffect(() => {
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', echap);
    return () => document.removeEventListener('keydown', echap);
  }, [onClose]);

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const surDrag = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setPlan((p) => {
      const a = p.findIndex((x) => x.id === e.active.id);
      const b = p.findIndex((x) => x.id === e.over!.id);
      // Jamais au-dessus du 1er en-tête : le formulaire commence par une section.
      return a < 0 || b < 0 ? p : arrayMove(p, a, Math.max(1, b));
    });
  };

  const sauvegarder = async () => {
    setEnvoi(true);
    try {
      const places = lirePlan(objet, plan);
      await Promise.all(tous.map((c) => {
        const p = places.get(c.id);
        if (!p) return null;
        const patch: Parameters<typeof modifierChamp>[1] = {};
        if ((c.folder_id ?? null) !== p.folder_id) patch.folder_id = p.folder_id;
        if ((c.position ?? 0) !== p.position) patch.position = p.position;
        if ((c.config?.apres ?? null) !== p.apres) patch.config = { apres: p.apres };
        return Object.keys(patch).length ? modifierChamp(c.id, patch) : null;
      }));
      await qc.invalidateQueries({ queryKey: ['champs-perso'] });
      toast.success(fr ? `« ${champ.label} » est placé dans le formulaire.` : `“${champ.label}” is placed in the form.`);
      onSauvegarde?.();
      onClose();
    } catch (err) {
      console.error('[PlacerChampFenetre] enregistrement', err);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  };

  const titre = fr ? TITRE_FORMULAIRE[objet].fr : TITRE_FORMULAIRE[objet].en;
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-4" role="presentation" tabIndex={-1} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={idTitre} tabIndex={-1} onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-surface shadow-2xl">
        <div className="flex items-start justify-between border-b border-outline px-5 py-4">
          <div className="min-w-0">
            <h2 id={idTitre} className="text-[16px] font-semibold text-text-primary">
              {fr ? `Placer « ${champ.label} »` : `Place “${champ.label}”`}
            </h2>
            <p className="mt-0.5 text-[12px] text-text-tertiary">
              {fr
                ? `Formulaire « ${titre} » — glisse le champ à la place voulue, puis Sauvegarder. Les champs de base (cadenas) ne bougent pas.`
                : `“${titre}” form — drag the field where you want it, then Save. Base fields (lock) stay put.`}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={fr ? 'Fermer' : 'Close'}
            className="rounded p-1 text-text-tertiary hover:bg-surface-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={surDrag}
            accessibility={{ screenReaderInstructions: { draggable: fr
              ? 'Pour déplacer un champ, appuie sur Espace, puis sur les flèches ; Espace pour le déposer, Échap pour annuler.'
              : 'To move a field, press Space, then the arrow keys; Space to drop it, Escape to cancel.' } }}>
            <SortableContext items={plan.map((e) => e.id)} strategy={verticalListSortingStrategy}>
              <ul ref={liste} className="space-y-1.5">
                {plan.map((e) => <Element key={e.id} e={e} cible={champ.id} fr={fr} />)}
              </ul>
            </SortableContext>
          </DndContext>
        </div>
        <div className="flex justify-end gap-2 border-t border-outline px-5 py-3">
          <button type="button" onClick={onClose} className="glass-button px-4 py-2 text-[13px]">{fr ? 'Annuler' : 'Cancel'}</button>
          <button type="button" onClick={() => { void sauvegarder(); }} disabled={envoi}
            className="glass-button-primary inline-flex items-center gap-1.5 px-4 py-2 text-[13px] disabled:opacity-50">
            {envoi && <Loader2 size={13} className="animate-spin" aria-hidden />}{fr ? 'Sauvegarder' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
