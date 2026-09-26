/**
 * Page liste « Pipelines » — calquée sur GoHighLevel (capture 3 de la
 * mission du 2026-09-25).
 *
 * Table : poignée | # | Nom | Total d'étapes | Mis à jour le | ⋮. L'ordre se
 * change au glisser-déposer (ou « Déplacer à la position ») et il est
 * PERSISTÉ : c'est lui que suivent tous les sélecteurs de pipeline, et le
 * premier reçoit les leads sans destination.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Calendar, GripVertical, Hash, MoreVertical, Plus, Search, Type } from 'lucide-react';
import { toast } from 'sonner';
import { dupliquerPipeline, reordonnerPipelines, type PipelineResume } from '../../../lib/pipelineVentesApi';
import {
  CopierBureauxModal, PermissionsModal, PositionModal, SupprimerPipelineModal,
} from './ActionsPipeline';
import ListeRaisonsPerte from './ListeRaisonsPerte';
import { usePlacementMenu } from './ReglagesCommuns';

/** Lien direct vers la page détail — ce que copie « Copier le lien ». */
export function lienPipeline(id: string): string {
  return `${window.location.origin}/ventes?tab=reglages&pipeline=${encodeURIComponent(id)}`;
}

function dateHeure(iso: string | undefined, fr: boolean): { date: string; heure: string } {
  if (!iso) return { date: '—', heure: '' };
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString(fr ? 'fr-CA' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' }),
    heure: d.toLocaleTimeString(fr ? 'fr-CA' : 'en-US', { hour: 'numeric', minute: '2-digit' }),
  };
}

type Action = 'modifier' | 'dupliquer' | 'copier' | 'permissions' | 'lien' | 'position' | 'supprimer';

function MenuActions({ fr, nom, admin, onAction }: { fr: boolean; nom: string; admin: boolean; onAction: (a: Action) => void }) {
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef<HTMLDivElement>(null);
  const declencheur = useRef<HTMLButtonElement>(null);
  const placement = usePlacementMenu(ouvert, declencheur, () => setOuvert(false));
  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: MouseEvent) => { if (!racine.current?.contains(e.target as Node)) setOuvert(false); };
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') setOuvert(false); };
    document.addEventListener('mousedown', fermer);
    document.addEventListener('keydown', echap);
    return () => { document.removeEventListener('mousedown', fermer); document.removeEventListener('keydown', echap); };
  }, [ouvert]);

  const tous: { cle: Action; fr: string; en: string }[] = [
    { cle: 'modifier', fr: 'Modifier', en: 'Edit' },
    { cle: 'dupliquer', fr: 'Dupliquer', en: 'Duplicate' },
    { cle: 'copier', fr: 'Copier vers d’autres bureaux', en: 'Copy to other locations' },
    { cle: 'permissions', fr: 'Gérer les permissions', en: 'Manage permissions' },
    { cle: 'lien', fr: 'Copier le lien', en: 'Copy link' },
    { cle: 'position', fr: 'Déplacer à la position', en: 'Move to position' },
  // Un membre qui a seulement le droit de MODIFIER ce pipeline n'a ni la
  // duplication, ni la copie, ni les permissions, ni l'ordre, ni la
  // suppression : la base les refuserait (réservés aux administrateurs).
  ];
  const items = tous.filter((it) => admin || it.cle === 'modifier' || it.cle === 'lien');
  const choisir = (a: Action) => { setOuvert(false); onAction(a); };

  return (
    <div ref={racine} className="relative inline-block">
      <button
        ref={declencheur}
        type="button"
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-label={fr ? `Actions pour ${nom}` : `Actions for ${nom}`}
        onClick={() => setOuvert((v) => !v)}
        className="rounded-md p-1.5 text-text-tertiary hover:bg-surface-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
      >
        <MoreVertical size={15} aria-hidden="true" />
      </button>
      {ouvert && (
        <div role="menu" style={placement} className="z-50 w-56 rounded-lg border border-outline bg-surface-card py-1 text-left shadow-lg">
          {items.map((it) => (
            <button
              key={it.cle}
              type="button"
              role="menuitem"
              onClick={() => choisir(it.cle)}
              className="block w-full px-3 py-1.5 text-left text-[13px] text-text-primary hover:bg-surface-secondary focus-visible:outline-none focus-visible:bg-surface-secondary"
            >
              {fr ? it.fr : it.en}
            </button>
          ))}
          {admin && <div role="separator" className="my-1 border-t border-border-subtle" />}
          {admin && <button
            type="button"
            role="menuitem"
            onClick={() => choisir('supprimer')}
            className="block w-full px-3 py-1.5 text-left text-[13px] text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:bg-red-50 dark:hover:bg-red-500/10"
          >
            {fr ? 'Supprimer' : 'Delete'}
          </button>}
        </div>
      )}
    </div>
  );
}

function Ligne({ p, rang, fr, admin, glissable, onOuvrir, onAction }: {
  p: PipelineResume;
  rang: number;
  fr: boolean;
  admin: boolean;
  glissable: boolean;
  onOuvrir: () => void;
  onAction: (a: Action) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id, disabled: !glissable });
  const { date, heure } = dateHeure(p.updated_at, fr);
  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`border-b border-border-subtle last:border-0 ${isDragging ? 'relative z-10 bg-surface-card opacity-80 shadow' : 'hover:bg-surface-secondary/50'}`}
    >
      <td className="w-8 px-2 py-2.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={!glissable}
          aria-label={fr ? `Déplacer « ${p.name} »` : `Move “${p.name}”`}
          title={glissable ? undefined : (fr ? 'Effacez la recherche pour réordonner' : 'Clear the search to reorder')}
          className="cursor-grab touch-none rounded text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <GripVertical size={15} aria-hidden="true" />
        </button>
      </td>
      <td className="w-10 px-2 py-2.5 text-center tabular-nums text-text-secondary">{rang}</td>
      <td className="px-3 py-2.5">
        <button
          type="button"
          onClick={onOuvrir}
          className="text-left text-[13px] font-medium text-text-primary hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary rounded"
        >
          {p.name}
        </button>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{p.nb_etapes ?? 0}</td>
      <td className="px-3 py-2.5 text-text-secondary">
        {date}{heure && <span className="text-text-muted"><span className="hidden lg:inline"> / </span><br className="lg:hidden" />{heure}</span>}
      </td>
      <td className="w-16 px-3 py-2.5 text-right">
        <MenuActions fr={fr} nom={p.name} admin={admin} onAction={onAction} />
      </td>
    </tr>
  );
}

export default function PipelinesListe({ fr, admin, pipelines, chargement, onCreer, onModifier, onOuvrir, onChangement }: {
  fr: boolean;
  /** Administrateur : tout. Sinon : seulement les pipelines qu'on lui a confiés, Modifier et Copier le lien. */
  admin: boolean;
  pipelines: PipelineResume[];
  chargement: boolean;
  onCreer: () => void;
  onModifier: (p: PipelineResume) => void;
  onOuvrir: (id: string) => void;
  onChangement: () => void;
}) {
  const idRecherche = useId();
  const idParPage = useId();
  const [recherche, setRecherche] = useState('');
  const [parPage, setParPage] = useState(20);
  const [page, setPage] = useState(1);
  // L'ordre affiché suit le glisser-déposer tout de suite ; la base suit.
  const [ordre, setOrdre] = useState<PipelineResume[]>(pipelines);
  useEffect(() => { setOrdre(pipelines); }, [pipelines]);

  const [aSupprimer, setASupprimer] = useState<PipelineResume | null>(null);
  const [aCopier, setACopier] = useState<PipelineResume | null>(null);
  const [aPermissions, setAPermissions] = useState<PipelineResume | null>(null);
  const [aPositionner, setAPositionner] = useState<PipelineResume | null>(null);

  const filtres = useMemo(() => {
    const t = recherche.trim().toLowerCase();
    return t ? ordre.filter((p) => p.name.toLowerCase().includes(t)) : ordre;
  }, [ordre, recherche]);
  const pages = Math.max(1, Math.ceil(filtres.length / parPage));
  const pageSure = Math.min(page, pages);
  const debut = (pageSure - 1) * parPage;
  const visibles = filtres.slice(debut, debut + parPage);
  // Réordonner une liste filtrée ou paginée n'aurait pas de sens clair.
  const glissable = admin && recherche.trim() === '' && pages === 1;

  const capteurs = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function persister(nouvel: PipelineResume[]) {
    const avant = ordre;
    setOrdre(nouvel);
    try {
      await reordonnerPipelines(nouvel.map((p) => p.id));
      toast.success(fr ? 'Ordre enregistré.' : 'Order saved.');
      onChangement();
    } catch (e) {
      setOrdre(avant);
      console.error('[pipelines] réordonnancement', e);
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  function glisser(ev: DragEndEvent) {
    if (!ev.over || ev.active.id === ev.over.id) return;
    const de = ordre.findIndex((p) => p.id === ev.active.id);
    const vers = ordre.findIndex((p) => p.id === ev.over?.id);
    void persister(arrayMove(ordre, de, vers));
  }

  async function agir(p: PipelineResume, a: Action) {
    if (a === 'modifier') onModifier(p);
    else if (a === 'dupliquer') {
      try {
        await dupliquerPipeline(p.id);
        toast.success(fr ? `« ${p.name} (copie) » créé.` : `“${p.name} (copie)” created.`);
        onChangement();
      } catch (e) {
        console.error('[pipelines] duplication', e);
        toast.error(e instanceof Error ? e.message : String(e));
      }
    } else if (a === 'copier') setACopier(p);
    else if (a === 'permissions') setAPermissions(p);
    else if (a === 'lien') {
      try {
        await navigator.clipboard.writeText(lienPipeline(p.id));
        toast.success(fr ? 'Lien copié.' : 'Link copied.');
      } catch (e) {
        console.error('[pipelines] presse-papier', e);
        toast.error(fr ? 'Impossible de copier le lien.' : 'Could not copy the link.');
      }
    } else if (a === 'position') setAPositionner(p);
    else setASupprimer(p);
  }

  const entete = (icone: ReactNode, libelle: string, align = '') => (
    <span className={`inline-flex items-center gap-1.5 ${align}`}>{icone}{libelle}</span>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-text-primary">Pipelines</h2>
          <p className="mt-0.5 text-[12.5px] text-text-tertiary">
            {fr
              ? 'Utilisez les pipelines pour suivre vos opportunités et la progression des ventes à travers les étapes.'
              : 'Use pipelines to track opportunities and sales progress across stages.'}
          </p>
        </div>
        {admin && (
          <button type="button" onClick={onCreer} className="btn-primary inline-flex items-center gap-1.5 text-[13px] px-3.5 py-2">
            <Plus size={14} aria-hidden="true" />
            {fr ? 'Créer un pipeline' : 'Create pipeline'}
          </button>
        )}
      </div>

      <div className="rounded-xl border border-outline bg-surface-card">
        <div className="flex justify-end border-b border-border-subtle p-3">
          <div className="relative w-full max-w-[220px]">
            <label htmlFor={idRecherche} className="sr-only">{fr ? 'Rechercher un pipeline' : 'Search pipelines'}</label>
            <Search size={13} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              id={idRecherche}
              type="search"
              value={recherche}
              onChange={(e) => { setRecherche(e.target.value); setPage(1); }}
              placeholder={fr ? 'Rechercher' : 'Search'}
              className="input-field w-full pl-7 text-[12.5px]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <DndContext sensors={capteurs} collisionDetection={closestCenter} onDragEnd={glisser}>
            <table className="w-full text-[13px]">
              <thead className="bg-surface-secondary/60 text-left text-[12.5px] text-text-secondary">
                <tr>
                  <th scope="col" className="w-8 px-2 py-2"><span className="sr-only">{fr ? 'Ordre' : 'Order'}</span></th>
                  <th scope="col" className="w-10 px-2 py-2 text-center font-semibold">#</th>
                  <th scope="col" className="px-3 py-2 font-semibold">{entete(<Type size={13} aria-hidden="true" />, fr ? 'Nom du pipeline' : 'Pipeline name')}</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">{entete(<Hash size={13} aria-hidden="true" />, fr ? 'Total d’étapes' : 'Total stages', 'justify-end')}</th>
                  <th scope="col" className="px-3 py-2 font-semibold">{entete(<Calendar size={13} aria-hidden="true" />, fr ? 'Mis à jour le' : 'Updated on')}</th>
                  <th scope="col" className="w-16 px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <SortableContext items={visibles.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                <tbody>
                  {chargement && (
                    <tr><td colSpan={6} className="px-3 py-10 text-center text-text-muted">{fr ? 'Chargement des pipelines…' : 'Loading pipelines…'}</td></tr>
                  )}
                  {!chargement && visibles.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-10 text-center text-text-muted">
                        {recherche.trim()
                          ? (fr ? 'Aucun pipeline ne correspond à la recherche.' : 'No pipeline matches your search.')
                          : (fr ? 'Aucun pipeline. Créez-en un pour commencer.' : 'No pipeline yet. Create one to get started.')}
                      </td>
                    </tr>
                  )}
                  {!chargement && visibles.map((p) => (
                    <Ligne
                      key={p.id}
                      p={p}
                      rang={ordre.findIndex((x) => x.id === p.id) + 1}
                      fr={fr}
                      admin={admin}
                      glissable={glissable}
                      onOuvrir={() => onOuvrir(p.id)}
                      onAction={(a) => void agir(p, a)}
                    />
                  ))}
                </tbody>
              </SortableContext>
            </table>
          </DndContext>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border-subtle px-3 py-2.5 text-[12px] text-text-secondary">
          <span className="inline-flex items-center gap-1.5">
            <label htmlFor={idParPage}>{fr ? 'Lignes par page' : 'Rows per page'}</label>
            <select
              id={idParPage}
              value={parPage}
              onChange={(e) => { setParPage(Number(e.target.value)); setPage(1); }}
              className="input-field py-0.5 text-[12px]"
            >
              {[10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </span>
          <span className="tabular-nums">
            {filtres.length === 0 ? '0' : `${debut + 1} - ${Math.min(debut + parPage, filtres.length)}`} {fr ? 'de' : 'of'} {filtres.length}
          </span>
          <nav aria-label={fr ? 'Pagination' : 'Pagination'} className="inline-flex items-center gap-1">
            <button type="button" disabled={pageSure <= 1} onClick={() => setPage(pageSure - 1)} className="rounded px-2 py-1 hover:bg-surface-secondary disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary">
              {fr ? 'Précédent' : 'Previous'}
            </button>
            {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                aria-current={n === pageSure ? 'page' : undefined}
                onClick={() => setPage(n)}
                className={`min-w-[26px] rounded border px-1.5 py-0.5 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary ${n === pageSure ? 'border-primary text-primary' : 'border-transparent hover:bg-surface-secondary'}`}
              >
                {n}
              </button>
            ))}
            <button type="button" disabled={pageSure >= pages} onClick={() => setPage(pageSure + 1)} className="rounded px-2 py-1 hover:bg-surface-secondary disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary">
              {fr ? 'Suivant' : 'Next'}
            </button>
          </nav>
          <span className="tabular-nums">{fr ? `Page ${pageSure} de ${pages}` : `Page ${pageSure} of ${pages}`}</span>
        </div>
      </div>

      {admin && <section className="rounded-xl border border-outline bg-surface-card p-4">
        <h3 className="text-[14px] font-semibold text-text-primary">{fr ? 'Raisons de perte' : 'Loss reasons'}</h3>
        <p className="mb-3 mt-0.5 text-[12px] text-text-tertiary">
          {fr
            ? 'Les motifs proposés quand on marque un deal perdu, pour tous les pipelines.'
            : 'The reasons offered when marking a deal lost, across all pipelines.'}
        </p>
        <ListeRaisonsPerte fr={fr} />
      </section>}

      <SupprimerPipelineModal
        fr={fr}
        pipeline={aSupprimer}
        pipelines={ordre}
        onFermer={() => setASupprimer(null)}
        onSupprime={() => { setASupprimer(null); onChangement(); }}
      />
      <CopierBureauxModal fr={fr} pipeline={aCopier} onFermer={() => setACopier(null)} />
      <PermissionsModal fr={fr} pipeline={aPermissions} onFermer={() => setAPermissions(null)} />
      <PositionModal
        fr={fr}
        pipeline={aPositionner ? { ...aPositionner, position: ordre.findIndex((x) => x.id === aPositionner.id) + 1 } : null}
        total={ordre.length}
        onFermer={() => setAPositionner(null)}
        onValider={(pos) => {
          const cible = aPositionner;
          setAPositionner(null);
          if (!cible) return;
          const sans = ordre.filter((x) => x.id !== cible.id);
          void persister([...sans.slice(0, pos - 1), cible, ...sans.slice(pos - 1)]);
        }}
      />
    </div>
  );
}
