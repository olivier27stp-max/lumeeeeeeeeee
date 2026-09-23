/**
 * Board du pipeline — barre d'outils, vues enregistrées, kanban ou liste.
 *
 * Reprend la mécanique éprouvée du board D2D (poignée de glissement dédiée pour
 * que le clic ouvre le drawer, corps de colonne droppable pour viser une colonne
 * vide, verrou par deal). `onDeplacer` remonte l'intention au parent, qui décide
 * (popup de job, modal de raison…).
 *
 * Les colonnes sont NEUTRES : plus de fond ni de bordure teintés par étape, il
 * ne reste qu'une pastille ronde devant le nom. La couleur porte l'information
 * qui presse (priorité sur le liseré gauche des cartes), pas la décoration.
 */
import { useId, useMemo, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowUpDown, Download, Filter, GripVertical, LayoutGrid, List, MoreVertical, Plus, Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import {
  estJobACreer, nomClient, priorite, type Deal, type PipelineStage,
} from '../../lib/pipelineVentesApi';
import {
  LIBELLE_SOURCE, initiales, rangsOuverts, visuelEtape,
} from '../../lib/pipeline/presentation';
import type { DealSource, MockStage } from '../../lib/pipeline/mockData';

interface Membre { id: string; name: string }

/**
 * `presentation.ts` est typé sur la maquette : `visuelEtape` et `rangsOuverts`
 * ne lisent que `id`, `kind` et `position`, tous identiques entre les deux
 * formes. Cet adaptateur comble les champs camelCase restants pour satisfaire
 * le typage, sans dupliquer la palette ni toucher au module partagé.
 */
function pourVisuel(e: PipelineStage): MockStage {
  return {
    id: e.id,
    nameFr: e.name_fr,
    nameEn: e.name_en,
    guidanceFr: e.guidance_fr,
    guidanceEn: e.guidance_en,
    position: e.position,
    kind: e.kind,
    archivedAt: e.archived_at,
  };
}

/** `deals.source` est du texte libre en base : un canal inconnu s'affiche tel quel. */
function libelleSource(source: string, fr: boolean): string {
  const connu = LIBELLE_SOURCE[source as DealSource];
  if (!connu) return source;
  return fr ? connu.fr : connu.en;
}

// Couleurs sémantiques de Lume (src/index.css) : rouge pour ce qui presse,
// ambre pour ce qui attend, vert pour ce qui va bien. Une pastille « urgent »
// dans un vert-gris inventé ne se lisait pas comme une alerte.
const TEINTE_PRIORITE = {
  urgent: 'var(--color-danger)',
  moyen: 'var(--color-warning)',
  frais: 'var(--color-success)',
} as const;
const LIBELLE_PRIORITE = {
  urgent: { fr: 'Urgent', en: 'Urgent' },
  moyen: { fr: 'À relancer', en: 'Needs follow-up' },
  frais: { fr: 'Récent', en: 'Recent' },
} as const;

/** Montant en cents → « 4 990 $ ». Les cents sont la source de vérité. */
function argent(cents: number, fr: boolean): string {
  return new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** « 14 sept. » — la date de création, discrète, au bout de la ligne du montant. */
function dateCourte(iso: string, fr: boolean): string {
  return new Date(iso).toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short' });
}

function joursDepuis(iso: string, maintenant: number): number {
  return Math.max(0, Math.floor((maintenant - new Date(iso).getTime()) / 86_400_000));
}

type Tri = 'ancien' | 'recent' | 'montant' | 'inactif';
type VueEnregistree = 'ouverts' | 'non-assignes' | 'relancer' | 'tous';
type Affichage = 'kanban' | 'liste';
type NiveauPriorite = 'urgent' | 'moyen' | 'frais';

const TRIS: readonly Tri[] = ['ancien', 'recent', 'montant', 'inactif'];
const LIBELLE_TRI: Record<Tri, { fr: string; en: string }> = {
  ancien: { fr: 'plus ancien', en: 'oldest' },
  recent: { fr: 'plus récent', en: 'newest' },
  montant: { fr: 'montant', en: 'amount' },
  inactif: { fr: 'inactivité', en: 'inactivity' },
};

const CLASSE_BOUTON =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-outline-strong '
  + 'bg-surface-card px-3 py-2 text-[12.5px] font-medium text-text-primary hover:bg-surface-secondary '
  + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary';
const CLASSE_CHAMP =
  'w-full rounded-lg border border-outline-strong bg-surface-card px-2.5 py-1.5 text-[12.5px] '
  + 'text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary';

// ── Carte ──

function CarteDeal({ deal, etapes, membres, montantCents, onOuvrir }: {
  deal: Deal;
  etapes: PipelineStage[];
  membres: Membre[];
  /** Montant du devis puis de la job. `null` = rien de lié pour l'instant. */
  montantCents: number | null;
  onOuvrir: (deal: Deal) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    data: { deal },
  });
  const { language } = useTranslation();
  const fr = language === 'fr';
  const jobACreer = estJobACreer(deal, etapes);
  const prio = priorite(deal, etapes);
  const nomAssigne = deal.assigned_user_id
    ? membres.find((m) => m.id === deal.assigned_user_id)?.name ?? null
    : null;
  const nom = nomClient(deal);
  const liseré = jobACreer
    ? 'var(--color-warning)'
    : prio ? TEINTE_PRIORITE[prio.niveau] : 'var(--color-outline)';

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        borderLeftWidth: 3,
        borderLeftColor: liseré,
      }}
      {...attributes}
      role="button"
      tabIndex={0}
      onClick={() => onOuvrir(deal)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOuvrir(deal);
        }
      }}
      className={
        // Post-it : coins carrés, ombre portée, et un coin corné dessiné en
        // dégradé (::after) plutôt qu'en image — il suit le thème tout seul.
        'group relative cursor-pointer rounded border border-outline bg-surface-card px-3 py-3 '
        + 'shadow-[0_1px_1px_rgba(0,0,0,.05),0_3px_6px_rgba(0,0,0,.06)] '
        + 'transition-[transform,box-shadow,border-color] duration-150 '
        + 'hover:-translate-y-0.5 hover:border-outline-strong '
        + 'hover:shadow-[0_2px_3px_rgba(0,0,0,.06),0_8px_16px_rgba(0,0,0,.10)] '
        + 'after:absolute after:bottom-0 after:right-0 after:h-3.5 after:w-3.5 after:rounded-bl '
        + 'after:border-l after:border-t after:border-outline '
        + 'after:bg-[linear-gradient(135deg,transparent_50%,var(--color-surface-secondary)_50%)] '
        + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary'
      }
    >
      {/* Haut : nom, pastille de priorité, menu */}
      <div className="flex items-start gap-1.5">
        <button
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          aria-label={fr ? `Déplacer la carte de ${nom}` : `Move ${nom}'s card`}
          className="mt-0.5 shrink-0 cursor-grab text-text-muted hover:text-text-secondary active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
        >
          <GripVertical size={14} aria-hidden="true" />
        </button>

        <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-text-primary">{nom}</p>

        {jobACreer ? (
          <span
            className="shrink-0 whitespace-nowrap rounded-[5px] border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
            style={{
              color: 'var(--color-warning)',
              background: 'var(--color-warning-light)',
              borderColor: 'var(--color-warning-medium)',
            }}
            title={fr ? 'Deal gagné sans job rattachée' : 'Won deal with no linked job'}
          >
            {fr ? 'Job à créer' : 'Job to create'}
          </span>
        ) : prio ? (
          <span
            className="shrink-0 whitespace-nowrap rounded-[5px] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
            style={{
              color: TEINTE_PRIORITE[prio.niveau],
              background: `color-mix(in srgb, ${TEINTE_PRIORITE[prio.niveau]} 15%, transparent)`,
            }}
            title={fr ? `Sans activité depuis ${prio.jours} jours` : `No activity for ${prio.jours} days`}
          >
            {fr ? LIBELLE_PRIORITE[prio.niveau].fr : LIBELLE_PRIORITE[prio.niveau].en}
          </span>
        ) : null}

        <button
          onClick={(e) => {
            e.stopPropagation();
            toast.info(fr
              ? 'Menu — assigner, déplacer, créer un devis, supprimer.'
              : 'Menu — assign, move, create a quote, delete.');
          }}
          aria-label={fr ? `Actions pour ${nom}` : `Actions for ${nom}`}
          className="shrink-0 rounded text-text-muted hover:bg-surface-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
        >
          <MoreVertical size={13} aria-hidden="true" />
        </button>
      </div>

      {/* Milieu : le montant, ou l'aveu qu'il n'y en a pas encore */}
      <div className="mt-1.5 flex items-baseline gap-2.5">
        {montantCents === null ? (
          <span className="text-[11.5px] font-medium text-text-muted">
            {fr ? 'Montant à venir' : 'Amount pending'}
          </span>
        ) : (
          <span className="text-[13px] font-bold tabular-nums text-text-primary">
            {argent(montantCents, fr)}
          </span>
        )}
        <span className="ml-auto whitespace-nowrap text-[11px] tabular-nums text-text-tertiary">
          {dateCourte(deal.created_at, fr)}
        </span>
      </div>

      {/* Bas : qui s'en occupe, et d'où le lead vient */}
      <div className="mt-2 flex items-center gap-1.5 border-t border-border-subtle pt-2">
        {nomAssigne ? (
          <>
            <span
              aria-hidden="true"
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-tertiary text-[9px] font-semibold text-text-secondary"
            >
              {initiales(nomAssigne)}
            </span>
            <span className="truncate text-[11px] text-text-tertiary">{nomAssigne}</span>
          </>
        ) : (
          <span className="text-[11px] font-semibold" style={{ color: 'var(--color-warning)' }}>
            {fr ? 'Non assigné' : 'Unassigned'}
          </span>
        )}
        <span className="ml-auto shrink-0 whitespace-nowrap rounded-[5px] bg-surface-tertiary px-1.5 py-0.5 text-[10px] text-text-tertiary">
          {libelleSource(deal.source, fr)}
        </span>
      </div>

      {deal.lost_reason && (
        <p className="mt-1 truncate text-[10px] text-text-muted">↳ {deal.lost_reason}</p>
      )}
    </div>
  );
}

// ── Colonne ──

function Colonne({ etape, etapes, rangOuvert, deals, membres, montants, onOuvrir }: {
  etape: PipelineStage;
  /** Toutes les étapes : le badge « Job à créer » se dérive du `kind` de l'étape du deal. */
  etapes: PipelineStage[];
  rangOuvert: number;
  deals: Deal[];
  membres: Membre[];
  montants: Record<string, number>;
  onOuvrir: (deal: Deal) => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const v = visuelEtape(pourVisuel(etape), rangOuvert);
  // Le corps est droppable pour qu'une carte puisse atterrir dans une colonne
  // vide. L'id est l'id d'étape, jamais un id de deal.
  // `isOver` est indispensable depuis qu'il n'y a plus de cadre de colonne :
  // sans lui, rien n'indique où la carte va atterrir.
  const { setNodeRef, isOver } = useDroppable({ id: etape.id });
  // Le compteur ET la somme, comme GoHighLevel — affichés même à zéro, pour que
  // l'œil compare les colonnes sans avoir à additionner les cartes.
  const somme = deals.reduce((s, d) => s + (montants[d.id] ?? 0), 0);

  return (
    <div className="flex w-[292px] shrink-0 flex-col">
      <div className="px-0.5 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: v.teinte }} aria-hidden="true" />
          <span className="truncate text-[12.5px] font-semibold tracking-tight text-text-primary">
            {fr ? etape.name_fr : etape.name_en}
          </span>
        </div>
        <p className="mt-1 flex gap-2 pl-4 text-[11.5px] text-text-secondary">
          <span className="tabular-nums">
            {deals.length} {fr ? (deals.length > 1 ? 'deals' : 'deal') : (deals.length > 1 ? 'deals' : 'deal')}
          </span>
          <b className="font-semibold tabular-nums text-text-primary">{argent(somme, fr)}</b>
        </p>
      </div>

      <SortableContext items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            'pipeline-scroll flex min-h-[120px] max-h-[calc(100vh-16rem)] flex-1 flex-col gap-2.5 overflow-y-auto rounded-xl p-0.5',
            isOver && 'outline-2 outline-dashed outline-offset-2 outline-text-tertiary',
          )}
        >
          {deals.map((deal) => (
            <CarteDeal
              key={deal.id}
              deal={deal}
              etapes={etapes}
              membres={membres}
              montantCents={montants[deal.id] ?? null}
              onOuvrir={onOuvrir}
            />
          ))}
          {deals.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 px-3 py-8 text-center">
              <p className="text-[12px] font-semibold text-text-secondary">
                {fr ? 'Aucun deal' : 'No deals'}
              </p>
              <p className="text-[11px] leading-relaxed text-text-muted">{fr ? v.videFr : v.videEn}</p>
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

// ── Barre d'outils ──

interface EtatFiltres {
  texte: string;
  source: string;
  /** `'__non'` = les deals que personne n'a pris en charge. */
  assigne: string;
  priorite: '' | NiveauPriorite;
}

const FILTRES_VIDES: EtatFiltres = { texte: '', source: '', assigne: '', priorite: '' };

const VUES: Record<VueEnregistree, { fr: string; en: string; filtres: EtatFiltres }> = {
  ouverts: { fr: 'Deals ouverts', en: 'Open deals', filtres: FILTRES_VIDES },
  'non-assignes': { fr: 'Non assignés', en: 'Unassigned', filtres: { ...FILTRES_VIDES, assigne: '__non' } },
  relancer: { fr: 'À relancer', en: 'Needs follow-up', filtres: { ...FILTRES_VIDES, priorite: 'urgent' } },
  tous: { fr: 'Tous', en: 'All', filtres: FILTRES_VIDES },
};

function BarreOutils({
  fr, total, filtres, sources, membres, panneauOuvert, tri, affichage,
  onFiltres, onBasculerPanneau, onTri, onAffichage,
}: {
  fr: boolean;
  total: number;
  filtres: EtatFiltres;
  sources: string[];
  membres: Membre[];
  panneauOuvert: boolean;
  tri: Tri;
  affichage: Affichage;
  onFiltres: (f: EtatFiltres) => void;
  onBasculerPanneau: () => void;
  onTri: () => void;
  onAffichage: (a: Affichage) => void;
}) {
  // `useId()` : ce composant peut réapparaître, un id littéral se dupliquerait.
  const idPipeline = useId();
  const idRecherche = useId();
  const idSource = useId();
  const idAssigne = useId();
  const idPriorite = useId();

  const nbFiltres = [filtres.source, filtres.assigne, filtres.priorite, filtres.texte].filter(Boolean).length;

  return (
    <>
      <div className="flex flex-col items-stretch gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={idPipeline} className="sr-only">
            {fr ? 'Pipeline affiché' : 'Displayed pipeline'}
          </label>
          <select
            id={idPipeline}
            className="min-w-[190px] rounded-lg border border-outline-strong bg-surface-card px-3 py-2 text-[13px] font-semibold text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
            defaultValue="ventes"
          >
            <option value="ventes">{fr ? 'Pipeline de ventes' : 'Sales pipeline'}</option>
          </select>
          <span
            className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
            style={{ color: 'var(--color-info)', background: 'color-mix(in srgb, var(--color-info) 12%, transparent)' }}
          >
            {total} {total > 1 ? 'deals' : 'deal'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1 sm:flex-none">
            <Search
              size={13}
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <label htmlFor={idRecherche} className="sr-only">
              {fr ? 'Rechercher un deal' : 'Search a deal'}
            </label>
            <input
              id={idRecherche}
              type="search"
              value={filtres.texte}
              onChange={(e) => onFiltres({ ...filtres, texte: e.target.value })}
              placeholder={fr ? 'Rechercher un deal…' : 'Search a deal…'}
              className="w-full rounded-lg border border-outline-strong bg-surface-card py-2 pl-7 pr-2.5 text-[12.5px] text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
            />
          </div>

          <button
            type="button"
            onClick={onBasculerPanneau}
            aria-expanded={panneauOuvert}
            className={cn(CLASSE_BOUTON, nbFiltres > 0 && 'bg-surface-tertiary')}
          >
            <Filter size={13} aria-hidden="true" />
            {fr ? 'Filtres' : 'Filters'}
            {nbFiltres > 0 && (
              <span
                className="min-w-[17px] rounded-full px-1.5 text-center text-[10px] font-bold text-white"
                style={{ background: 'var(--color-info)' }}
              >
                {nbFiltres}
              </span>
            )}
          </button>

          <button type="button" onClick={onTri} className={CLASSE_BOUTON}>
            <ArrowUpDown size={13} aria-hidden="true" />
            {fr ? 'Trier : ' : 'Sort: '}
            {fr ? LIBELLE_TRI[tri].fr : LIBELLE_TRI[tri].en}
          </button>

          <span
            role="group"
            aria-label={fr ? 'Affichage' : 'Display'}
            className="inline-flex overflow-hidden rounded-lg border border-outline-strong"
          >
            <button
              type="button"
              onClick={() => onAffichage('kanban')}
              aria-pressed={affichage === 'kanban'}
              aria-label={fr ? 'Vue tableau' : 'Board view'}
              className={cn(
                'px-2.5 py-2 text-text-tertiary hover:bg-surface-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-primary',
                affichage === 'kanban' ? 'bg-surface-tertiary text-text-primary' : 'bg-surface-card',
              )}
            >
              <LayoutGrid size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onAffichage('liste')}
              aria-pressed={affichage === 'liste'}
              aria-label={fr ? 'Vue liste' : 'List view'}
              className={cn(
                'border-l border-outline-strong px-2.5 py-2 text-text-tertiary hover:bg-surface-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-primary',
                affichage === 'liste' ? 'bg-surface-tertiary text-text-primary' : 'bg-surface-card',
              )}
            >
              <List size={14} aria-hidden="true" />
            </button>
          </span>

          <button
            type="button"
            onClick={() => toast.info(fr
              ? 'Import CSV : mêmes colonnes que la page Clients.'
              : 'CSV import: same columns as the Clients page.')}
            className={CLASSE_BOUTON}
          >
            <Download size={13} aria-hidden="true" />
            {fr ? 'Importer' : 'Import'}
          </button>

          <button
            type="button"
            onClick={() => toast.info(fr
              ? 'Le nouveau deal se créera ici, dans la première étape ouverte.'
              : 'A new deal will be created here, in the first open stage.')}
            className={cn(CLASSE_BOUTON, 'font-semibold text-white')}
            style={{ background: 'var(--color-accent)', borderColor: 'var(--color-accent)' }}
          >
            <Plus size={13} aria-hidden="true" />
            {fr ? 'Nouveau deal' : 'New deal'}
          </button>

          <button
            type="button"
            onClick={() => toast.info(fr
              ? 'Exporter · Actions en lot · Gérer les champs affichés.'
              : 'Export · Bulk actions · Manage displayed fields.')}
            aria-label={fr ? 'Plus d’actions' : 'More actions'}
            className={cn(CLASSE_BOUTON, 'px-2.5')}
          >
            <MoreVertical size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      {panneauOuvert && (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-outline bg-surface-secondary p-3.5">
          <div className="min-w-[150px]">
            <label htmlFor={idSource} className="mb-1.5 block text-[11px] text-text-tertiary">
              {fr ? 'Source' : 'Source'}
            </label>
            <select
              id={idSource}
              value={filtres.source}
              onChange={(e) => onFiltres({ ...filtres, source: e.target.value })}
              className={CLASSE_CHAMP}
            >
              <option value="">{fr ? 'Toutes' : 'All'}</option>
              {sources.map((s) => (
                <option key={s} value={s}>{libelleSource(s, fr)}</option>
              ))}
            </select>
          </div>

          <div className="min-w-[150px]">
            <label htmlFor={idAssigne} className="mb-1.5 block text-[11px] text-text-tertiary">
              {fr ? 'Assigné' : 'Assignee'}
            </label>
            <select
              id={idAssigne}
              value={filtres.assigne}
              onChange={(e) => onFiltres({ ...filtres, assigne: e.target.value })}
              className={CLASSE_CHAMP}
            >
              <option value="">{fr ? 'Tous' : 'All'}</option>
              <option value="__non">{fr ? 'Non assigné' : 'Unassigned'}</option>
              {membres.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          <div className="min-w-[150px]">
            <label htmlFor={idPriorite} className="mb-1.5 block text-[11px] text-text-tertiary">
              {fr ? 'Priorité' : 'Priority'}
            </label>
            <select
              id={idPriorite}
              value={filtres.priorite}
              onChange={(e) => onFiltres({ ...filtres, priorite: e.target.value as '' | NiveauPriorite })}
              className={CLASSE_CHAMP}
            >
              <option value="">{fr ? 'Toutes' : 'All'}</option>
              <option value="urgent">{fr ? LIBELLE_PRIORITE.urgent.fr : LIBELLE_PRIORITE.urgent.en}</option>
              <option value="moyen">{fr ? LIBELLE_PRIORITE.moyen.fr : LIBELLE_PRIORITE.moyen.en}</option>
              <option value="frais">{fr ? LIBELLE_PRIORITE.frais.fr : LIBELLE_PRIORITE.frais.en}</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => {
              onFiltres(FILTRES_VIDES);
              toast.success(fr ? 'Filtres effacés.' : 'Filters cleared.');
            }}
            className={CLASSE_BOUTON}
          >
            {fr ? 'Effacer les filtres' : 'Clear filters'}
          </button>
        </div>
      )}
    </>
  );
}

// ── Board ──

export default function PipelineBoard({
  deals, etapes, montants, membres, chargement, onOuvrir, onDeplacer,
}: {
  deals: Deal[];
  etapes: PipelineStage[];
  /** Montant en cents par deal (devis puis job). Absent = « Montant à venir ». */
  montants: Record<string, number>;
  membres: { id: string; name: string }[];
  chargement?: boolean;
  onOuvrir: (deal: Deal) => void;
  /** Le parent décide : popup de job vers « Gagné », modal de raison vers « Perdu ». */
  onDeplacer: (dealId: string, versEtapeId: string) => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [actif, setActif] = useState<Deal | null>(null);
  const [filtres, setFiltres] = useState<EtatFiltres>(FILTRES_VIDES);
  const [panneauOuvert, setPanneauOuvert] = useState(false);
  const [tri, setTri] = useState<Tri>('ancien');
  const [affichage, setAffichage] = useState<Affichage>('kanban');
  const [vue, setVue] = useState<VueEnregistree>('ouverts');
  const verrous = useRef<Set<string>>(new Set());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const visibles = useMemo(
    () => [...etapes].filter((e) => e.archived_at === null).sort((a, b) => a.position - b.position),
    [etapes],
  );
  const rangs = useMemo(() => rangsOuverts(etapes.map(pourVisuel)), [etapes]);
  const sources = useMemo(
    () => [...new Set(deals.map((d) => d.source))].filter(Boolean).sort(),
    [deals],
  );

  const maintenant = useMemo(() => Date.now(), []);

  /** Les mêmes deals nourrissent le kanban et la liste — jamais deux écrans séparés. */
  const filtres_ = useMemo(() => {
    const q = filtres.texte.trim().toLowerCase();
    const retenus = deals.filter((d) => {
      if (filtres.source && d.source !== filtres.source) return false;
      if (filtres.assigne === '__non' && d.assigned_user_id) return false;
      if (filtres.assigne && filtres.assigne !== '__non' && d.assigned_user_id !== filtres.assigne) return false;
      if (filtres.priorite) {
        const p = priorite(d, etapes);
        if (!p || p.niveau !== filtres.priorite) return false;
      }
      if (q) {
        const c = d.client;
        const foin = `${nomClient(d)} ${c?.email ?? ''} ${c?.address ?? ''}`.toLowerCase();
        if (!foin.includes(q)) return false;
      }
      return true;
    });
    const parTri: Record<Tri, (a: Deal, b: Deal) => number> = {
      ancien: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      recent: (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      montant: (a, b) => (montants[b.id] ?? 0) - (montants[a.id] ?? 0),
      inactif: (a, b) => new Date(a.last_activity_at).getTime() - new Date(b.last_activity_at).getTime(),
    };
    return [...retenus].sort(parTri[tri]);
  }, [deals, etapes, filtres, montants, tri]);

  const parEtape = useMemo(() => {
    const g: Record<string, Deal[]> = {};
    for (const e of visibles) g[e.id] = [];
    for (const d of filtres_) {
      const colonne = g[d.stage_id];
      if (colonne) colonne.push(d);
    }
    return g;
  }, [filtres_, visibles]);

  function appliquerVue(v: VueEnregistree) {
    setVue(v);
    setFiltres(VUES[v].filtres);
  }

  function onDragEnd(event: DragEndEvent) {
    setActif(null);
    const { active, over } = event;
    if (!over) return;
    const dealId = String(active.id);
    if (verrous.current.has(dealId)) return;
    const deal = deals.find((d) => d.id === dealId);
    if (!deal) return;

    const overId = String(over.id);
    const surDeal = deals.find((d) => d.id === overId);
    const cible = surDeal?.stage_id ?? (visibles.some((e) => e.id === overId) ? overId : deal.stage_id);
    if (cible === deal.stage_id) return;

    verrous.current.add(dealId);
    try {
      onDeplacer(dealId, cible);
    } finally {
      verrous.current.delete(dealId);
    }
  }

  // Six colonnes vides laisseraient croire qu'il n'y a plus de deals du tout,
  // alors que ce sont les filtres qui ne laissent rien passer.
  const filtreTropSerre = filtres_.length === 0 && deals.length > 0;

  return (
    <div>
      <BarreOutils
        fr={fr}
        total={filtres_.length}
        filtres={filtres}
        sources={sources}
        membres={membres}
        panneauOuvert={panneauOuvert}
        tri={tri}
        affichage={affichage}
        onFiltres={setFiltres}
        onBasculerPanneau={() => setPanneauOuvert((o) => !o)}
        onTri={() => setTri(TRIS[(TRIS.indexOf(tri) + 1) % TRIS.length])}
        onAffichage={setAffichage}
      />

      {/* Vues enregistrées : un filtre nommé une fois, retrouvé d'un clic. */}
      <div
        role="tablist"
        aria-label={fr ? 'Vues enregistrées' : 'Saved views'}
        className="mt-3 flex flex-wrap items-center gap-1.5 border-b border-outline pb-2.5"
      >
        {(Object.keys(VUES) as VueEnregistree[]).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={vue === v}
            onClick={() => appliquerVue(v)}
            className={cn(
              'whitespace-nowrap rounded-full border px-3 py-1.5 text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary',
              vue === v
                ? 'border-outline-strong bg-surface-tertiary font-semibold text-text-primary'
                : 'border-outline font-medium text-text-tertiary hover:bg-surface-secondary hover:text-text-primary',
            )}
          >
            {fr ? VUES[v].fr : VUES[v].en}
          </button>
        ))}
        <button
          type="button"
          onClick={() => toast.info(fr
            ? 'La vue courante serait enregistrée ici, avec son nom.'
            : 'The current view would be saved here, with its name.')}
          className="whitespace-nowrap rounded-full border border-dashed border-outline px-3 py-1.5 text-[12.5px] font-medium text-text-muted hover:bg-surface-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
        >
          {fr ? '+ Vue' : '+ View'}
        </button>
      </div>

      {chargement && (
        <p className="mt-2 text-[11px] text-text-muted" role="status">
          {fr ? 'Chargement…' : 'Loading…'}
        </p>
      )}

      {filtreTropSerre ? (
        <div className="flex flex-col items-center gap-2 px-5 py-14 text-center">
          <p className="mt-1.5 text-[15px] font-semibold text-text-primary">
            {fr ? 'Aucun deal ne correspond aux filtres' : 'No deal matches the filters'}
          </p>
          <p className="max-w-[40ch] text-[12.5px] leading-relaxed text-text-tertiary">
            {fr
              ? 'Modifie les filtres, ou efface-les pour revoir tous tes deals.'
              : 'Adjust the filters, or clear them to see all your deals again.'}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => setPanneauOuvert(true)} className={CLASSE_BOUTON}>
              {fr ? 'Modifier les filtres' : 'Adjust the filters'}
            </button>
            <button
              type="button"
              onClick={() => {
                setFiltres(FILTRES_VIDES);
                setVue('tous');
              }}
              className={cn(CLASSE_BOUTON, 'font-semibold text-white')}
              style={{ background: 'var(--color-accent)', borderColor: 'var(--color-accent)' }}
            >
              {fr ? 'Effacer les filtres' : 'Clear filters'}
            </button>
          </div>
        </div>
      ) : affichage === 'liste' ? (
        <div className="mt-4 overflow-x-auto rounded-xl border border-outline bg-surface-card">
          <table className="w-full min-w-[620px] border-collapse text-[12.5px]">
            <thead>
              <tr>
                {[
                  fr ? 'Client' : 'Client',
                  fr ? 'Étape' : 'Stage',
                  fr ? 'Montant' : 'Amount',
                  fr ? 'Source' : 'Source',
                  fr ? 'Assigné' : 'Assignee',
                  fr ? 'Inactif' : 'Inactive',
                ].map((t) => (
                  <th
                    key={t}
                    className="border-b border-outline px-3.5 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-wider text-text-tertiary"
                  >
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtres_.map((d) => {
                const etape = etapes.find((e) => e.id === d.stage_id);
                const m = montants[d.id];
                const assigne = d.assigned_user_id
                  ? membres.find((x) => x.id === d.assigned_user_id)?.name ?? null
                  : null;
                const p = priorite(d, etapes);
                return (
                  <tr
                    key={d.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOuvrir(d)}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        onOuvrir(d);
                      }
                    }}
                    className="cursor-pointer hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-primary"
                  >
                    <td className="border-t border-border-subtle px-3.5 py-2.5 font-semibold text-text-primary">
                      {nomClient(d)}
                    </td>
                    <td className="border-t border-border-subtle px-3.5 py-2.5 text-text-secondary">
                      {etape ? (fr ? etape.name_fr : etape.name_en) : '—'}
                    </td>
                    <td className="border-t border-border-subtle px-3.5 py-2.5 tabular-nums text-text-secondary">
                      {m === undefined ? '—' : argent(m, fr)}
                    </td>
                    <td className="border-t border-border-subtle px-3.5 py-2.5 text-text-secondary">
                      {libelleSource(d.source, fr)}
                    </td>
                    <td className="border-t border-border-subtle px-3.5 py-2.5">
                      {assigne ?? (
                        <span className="font-semibold" style={{ color: 'var(--color-warning)' }}>
                          {fr ? 'Non assigné' : 'Unassigned'}
                        </span>
                      )}
                    </td>
                    <td className="border-t border-border-subtle px-3.5 py-2.5 tabular-nums text-text-secondary">
                      {p ? `${joursDepuis(d.last_activity_at, maintenant)} ${fr ? 'j' : 'd'}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={(e: DragStartEvent) => setActif(deals.find((d) => d.id === e.active.id) ?? null)}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActif(null)}
        >
          <div className="mt-4 flex gap-3 overflow-x-auto pb-4">
            {visibles.map((etape) => (
              <Colonne
                key={etape.id}
                etape={etape}
                etapes={etapes}
                rangOuvert={rangs[etape.id] ?? 0}
                deals={parEtape[etape.id] ?? []}
                membres={membres}
                montants={montants}
                onOuvrir={onOuvrir}
              />
            ))}
          </div>

          <DragOverlay>
            {actif && (
              <div className="w-[264px] rounded-xl border border-outline-strong bg-surface-elevated p-3.5 shadow-lg">
                <p className="truncate text-[13px] font-semibold text-text-primary">{nomClient(actif)}</p>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
