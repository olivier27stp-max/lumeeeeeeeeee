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
import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowRightLeft, ArrowUpDown, Filter, GripVertical, LayoutGrid, List, Plus, Search, Tag, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { confirmer } from '../ui/ConfirmDialog';
import { usePermissions } from '../../hooks/usePermissions';
import ActionsRapides from './ActionsRapides';
import {
  useChampsPipeline, useFiltreChamps, comparerParChamp, ChampsSurCarte, PanneauChamps, nbFiltresChamps, estTriable, sensParDefaut,
  type TriChamp,
} from '../champs/pipeline';
import { useColonnesTableau, type ColonneStandard } from '../champs/colonnes';
import type { Condition } from '../../lib/champs/filtres';
import type { ValeurEnregistree } from '../../lib/champs/types';
import Modal from '../ui/Modal';
import { CLASSE_SAISIE, CadreGhl, ChampGhl, ChampRaison, OPTIONS_SOURCE, OPTIONS_STATUT, SectionGhl, type StatutDeal } from './FormulaireDealGhl';
import ModalChangerPipeline from './ModalChangerPipeline';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import {
  creerDealManuel, creerVue, estJobACreer, fetchVues, journaliserLot, nomClient, priorite, supprimerVue,
  rechercherClientsPourDeal,
  abandonnerDeal, deplacerDeal, fetchStages, majContactDuDeal, majTitreDeal, marquerPerdu,
  type ClientPourDeal, type DevisPourDeal,
  type Deal, type ModeCouleur, type PipelineStage, type VueSauvegardee,
} from '../../lib/pipelineVentesApi';
import {
  initiales, rangsOuverts, visuelEtape, libelleSource,
} from '../../lib/pipeline/presentation';
import type { DealSource, MockStage } from '../../lib/pipeline/mockData';
import { useChampsCreation } from '../champs/creation';
import { CompanyContext } from '../../contexts/CompanyContext';
import SelecteurEtiquettes, {
  CLE_ETIQUETTES_CLIENTS, EtiquettesCompactes, useEtiquettesDesClients,
} from '../etiquettes/SelecteurEtiquettes';
import { PanneauFiltreEtiquettes } from '../etiquettes/FiltreEtiquettes';
import { poserEtiquette, retirerEtiquette } from '../../lib/etiquettesApi';
import {
  FILTRE_ETIQUETTES_VIDE, clientsDistincts, correspondEtiquettes, etiquettesDepuisVue, etiquettesVersVue,
  nbFiltresEtiquettes, type FiltreEtiquettes,
} from '../../lib/etiquettesFiltre';
import { captureClientException } from '../../lib/sentry';

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
type VueEnregistree = 'tous' | 'non-assignes' | 'relancer';
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

function CarteDeal({
  deal, etapes, membres, montantCents, onOuvrir, onAssigner, onChangement,
  selectionne, onBasculerSelection, extra, etiquettes,
}: {
  /** Champs personnalisés choisis pour les cartes de ce pipeline. */
  extra?: ReactNode;
  /** Étiquettes du CLIENT du deal (D1) — sous les champs de la carte. */
  etiquettes?: readonly string[];
  /** `undefined` = mode sélection inactif : aucune case n'est dessinée. */
  selectionne?: boolean;
  onBasculerSelection?: (dealId: string) => void;
  deal: Deal;
  etapes: PipelineStage[];
  membres: Membre[];
  /** Montant du devis puis de la job. `null` = rien de lié pour l'instant. */
  montantCents: number | null;
  onOuvrir: (deal: Deal) => void;
  onAssigner: (dealId: string, membreId: string | null) => void;
  onChangement?: () => void;
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
  // `Date.now()` à chaque rendu plutôt qu'une valeur figée : une carte
  // ré-affichée après un déplacement doit montrer « aujourd'hui », pas
  // l'ancienneté d'avant le mouvement.
  const joursEtape = joursDepuis(deal.stage_entered_at, Date.now());
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
        {onBasculerSelection && (
          <input
            type="checkbox"
            checked={!!selectionne}
            aria-label={fr ? `Sélectionner ${nom}` : `Select ${nom}`}
            // Sans stopPropagation, cocher ouvrirait aussi la fiche : le clic
            // remonterait jusqu'au onClick de la carte.
            onClick={(e) => e.stopPropagation()}
            onChange={() => onBasculerSelection(deal.id)}
            className="mt-0.5 shrink-0"
          />
        )}
        <button
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          aria-label={fr ? `Déplacer la carte de ${nom}` : `Move ${nom}'s card`}
          className="mt-0.5 shrink-0 cursor-grab text-text-muted hover:text-text-secondary active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
        >
          <GripVertical size={14} aria-hidden="true" />
        </button>

        {/* Titre du deal s'il y en a un (GHL « Opportunity name »), le client dessous. */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold text-text-primary">{deal.title?.trim() || nom}</p>
          {deal.title?.trim() && <p className="truncate text-[11px] text-text-tertiary">{nom}</p>}
        </div>

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
        ) : null}

        <ActionsRapides
          deal={deal}
          membres={membres}
          onAssigner={onAssigner}
          onChangement={onChangement}
        />
      </div>

      {/*
        Plus de pastilles calculées (« Jamais contacté », « Dort », « À relancer »,
        « Gros job ») : Rafba, 2026-09-29 — « de base y'est censé avoir rien ».
        Elles ressemblaient à des étiquettes posées d'office. La carte ne montre
        que ce que l'utilisateur a mis ; les vues « Non assignés » / « À relancer »
        et le liseré de couleur gardent le signal.
      */}

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
        {/*
          Le temps passé DANS L'ÉTAPE, pas l'âge du deal.
          C'est la question du matin : « ça fait combien de temps que celui-là
          est bloqué en Soumission envoyée ? ». L'âge total ne le dit pas —
          un deal créé il y a trois mois mais entré hier dans l'étape n'a rien
          d'urgent, et l'inverse non plus.
          Au-delà d'une semaine, la mention se teinte : c'est un rappel, pas
          une alerte (le liseré de priorité porte déjà l'urgence).
        */}
        <span
          className="ml-auto whitespace-nowrap text-[11px] tabular-nums"
          style={{ color: joursEtape >= 7 ? 'var(--color-warning)' : 'var(--color-text-tertiary)' }}
          title={
            fr
              ? `Dans cette étape depuis le ${dateCourte(deal.stage_entered_at, fr)}`
              : `In this stage since ${dateCourte(deal.stage_entered_at, fr)}`
          }
        >
          {joursEtape === 0
            ? (fr ? "aujourd'hui" : 'today')
            : `${joursEtape} ${fr ? 'j' : 'd'}${fr ? ' ici' : ' here'}`}
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
        ) : null}
        <span className="ml-auto shrink-0 whitespace-nowrap rounded-[5px] bg-surface-tertiary px-1.5 py-0.5 text-[10px] text-text-tertiary">
          {libelleSource(deal.source, fr)}
        </span>
      </div>

      {extra}

      {/* Deux pastilles au plus, puis « +N » : la carte doit rester lisible. */}
      {etiquettes && etiquettes.length > 0 && (
        <div className="mt-1.5">
          <EtiquettesCompactes noms={etiquettes} fr={fr} />
        </div>
      )}

      {deal.lost_reason && (
        <p className="mt-1 truncate text-[10px] text-text-muted">↳ {deal.lost_reason}</p>
      )}
    </div>
  );
}

// ── Colonne ──

function Colonne({
  etape, etapes, rangOuvert, deals, membres, montants, onOuvrir, onAssigner, onChangement,
  selection, onBasculerSelection, modeCouleur, extraCarte, etiquettesClients,
}: {
  /** Contenu ajouté au bas de chaque carte (champs personnalisés). */
  extraCarte?: (deal: Deal) => ReactNode;
  /** Étiquettes par client (une requête groupée pour tout le board). */
  etiquettesClients?: Record<string, string[]>;
  /** Où poser la teinte de l'étape — réglage du pipeline. */
  modeCouleur: ModeCouleur;
  /** Les deals cochés. `undefined` = mode sélection inactif. */
  selection?: Set<string>;
  onBasculerSelection?: (dealId: string) => void;
  etape: PipelineStage;
  /** Toutes les étapes : le badge « Job à créer » se dérive du `kind` de l'étape du deal. */
  etapes: PipelineStage[];
  rangOuvert: number;
  deals: Deal[];
  membres: Membre[];
  montants: Record<string, number>;
  onOuvrir: (deal: Deal) => void;
  onAssigner: (dealId: string, membreId: string | null) => void;
  onChangement?: () => void;
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
  // Combien de deals portent réellement un chiffre : sans ça, une colonne de
  // 19 deals affichant 7 243 $ pendant que les cartes visibles disent
  // « Montant à venir » ressemble à une erreur.
  const chiffres = deals.filter((d) => (montants[d.id] ?? 0) > 0).length;

  return (
    <div className="flex w-[292px] shrink-0 flex-col">
      <div
        className={`px-0.5 pb-2.5 ${modeCouleur === 'tint' ? 'rounded-t-xl px-2 pt-2' : ''}`}
        style={
          // Une teinte de fond très diluée : elle doit distinguer les
          // colonnes, pas concurrencer le texte qu'elle porte.
          modeCouleur === 'tint' ? { background: `${v.teinte}1A` } : undefined
        }
      >
        <div className="flex items-center gap-2">
          {modeCouleur !== 'none' && (
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: v.teinte }} aria-hidden="true" />
          )}
          {/*
            Un vrai titre, pas un `span` : à la lecture d'écran, le board
            était une suite de textes sans structure — rien ne disait où
            commençait une colonne.
          */}
          <h3 className="truncate text-[12.5px] font-semibold tracking-tight text-text-primary">
            {fr ? etape.name_fr : etape.name_en}
          </h3>
        </div>
        <p className={`mt-1 flex gap-2 text-[11.5px] text-text-secondary ${modeCouleur === 'none' ? '' : 'pl-4'}`}>
          <span className="tabular-nums">
            {/*
              `{n} {mot}` : l'espace entre les accolades est du JSX
              significatif, qu'un formateur peut manger. On assemble donc la
              chaîne — « 3deals » restait lisible pour un développeur, pas
              pour un client (QA 2026-09-24, P1-7).
            */}
            {`${deals.length} ${deals.length > 1 ? 'deals' : 'deal'}`}
          </span>
          <b
            className="font-semibold tabular-nums text-text-primary"
            title={
              chiffres === deals.length
                ? undefined
                : fr
                  ? `${chiffres} deal(s) sur ${deals.length} ont un devis ou une job. Les autres n'ont pas encore de montant.`
                  : `${chiffres} of ${deals.length} deals have a quote or job. The others have no amount yet.`
            }
          >
            {argent(somme, fr)}
          </b>
          {chiffres > 0 && chiffres < deals.length && (
            <span className="tabular-nums text-text-muted">
              {fr ? `sur ${chiffres}` : `from ${chiffres}`}
            </span>
          )}
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
              onAssigner={onAssigner}
              onChangement={onChangement}
              selectionne={selection?.has(deal.id)}
              onBasculerSelection={onBasculerSelection}
              extra={extraCarte?.(deal)}
              etiquettes={etiquettesClients?.[deal.client_id]}
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

// ── Nouveau deal ──

interface ChampsDeal {
  prenom: string;
  nom: string;
  courriel: string;
  telephone: string;
  adresse: string;
  /** Saisi en dollars ; converti en cents à l'envoi (les cents font foi). */
  montant: string;
  assigneA: string;
  /** AAAA-MM-JJ. Une date seule : une heure la ferait reculer d'un jour. */
  dateVisee: string;
  source: string;
}

/**
 * La date visée par défaut : dans deux semaines.
 *
 * Un cycle de vente en service résidentiel se compte en jours, pas en mois.
 * Une date par défaut fait entrer le deal dans la Chronologie tout de suite —
 * elle est approximative, mais elle se corrige, alors qu'une date absente ne
 * se remarque jamais.
 */
function dansDeuxSemaines(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const jj = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${jj}`;
}

function champsDealVides(): ChampsDeal {
  return {
    prenom: '', nom: '', courriel: '', telephone: '', adresse: '',
    montant: '', assigneA: '', dateVisee: dansDeuxSemaines(), source: 'manual',
  };
}

/** Une valeur qui ne suit la saisie qu'après une pause : une requête par mot, pas par touche. */
function useDiffere<T>(valeur: T, ms: number): T {
  const [v, setV] = useState(valeur);
  useEffect(() => {
    const t = setTimeout(() => setV(valeur), ms);
    return () => clearTimeout(t);
  }, [valeur, ms]);
  return v;
}

/**
 * D'où part le deal.
 *
 * `client` et `devis` d'abord : dans un CRM qui a déjà des clients, retaper un
 * contact est l'exception. Et c'est le seul chemin où un doublon est
 * IMPOSSIBLE — le rapprochement automatique ne reconnaît quelqu'un que par
 * son téléphone ou son courriel, jamais par son nom.
 */
type ModeDeal = 'client' | 'devis' | 'nouveau';

/**
 * Petit formulaire de création. En cas d'erreur de la base, il reste ouvert
 * avec les valeurs saisies : retaper une adresse parce qu'un courriel était
 * déjà pris est la meilleure façon de perdre quelqu'un.
 */
function ModalNouveauDeal({ ouvert, fr, membres, pipelines, pipelineActif, onFermer, onCree }: {
  ouvert: boolean;
  fr: boolean;
  onFermer: () => void;
  /** Reçoit le pipeline où le deal a VRAIMENT atterri. */
  onCree: (pipelineId: string | null) => void;
  /** Pour proposer un responsable dès la création. */
  membres: Membre[];
  /** Le deal part dans celui qu'on regarde, sauf choix contraire. */
  pipelines: { id: string; name: string; is_default: boolean }[];
  pipelineActif: string | null;
}) {
  const [mode, setMode] = useState<ModeDeal>('client');
  const [champs, setChamps] = useState<ChampsDeal>(champsDealVides);
  const [client, setClient] = useState<ClientPourDeal | null>(null);
  const [devis, setDevis] = useState<DevisPourDeal | null>(null);
  const [recherche, setRecherche] = useState('');
  // '' = pas encore touché : on suit le pipeline affiché.
  const [pipelineId, setPipelineId] = useState('');
  const [envoi, setEnvoi] = useState(false);
  // Étiquettes à poser sur le CLIENT une fois le deal créé (D1).
  const [etiquettesClient, setEtiquettesClient] = useState<string[]>([]);
  // Formulaire GHL (« Add new opportunity ») : contact en un seul champ, étape, statut, entreprise.
  const [listeContacts, setListeContacts] = useState(false);
  const [entreprise, setEntreprise] = useState('');
  const [titre, setTitre] = useState('');
  const idTitre = useId();
  const [etapeId, setEtapeId] = useState('');
  const [statut, setStatut] = useState<StatutDeal>('ouvert');
  const [raison, setRaison] = useState('');
  const idRaison = useId();
  const idStatut = useId();
  const idEtapeDeal = useId();
  const idEntreprise = useId();
  const qc = useQueryClient();
  const idEtiquettes = useId();
  // Un champ rangé dans une section (dossier système) s'affiche à la fin de celle-ci.
  const champsPerso = useChampsCreation('deal', fr, { sections: ['depart', 'contact', 'previsions'], gererExterne: true });
  const idFormulaire = useId();
  const idPipeline = useId();
  const idRecherche = useId();
  const idCourriel = useId();
  const idTelephone = useId();
  const idMontant = useId();
  const idAssigne = useId();
  const idDateVisee = useId();
  const idSource = useId();

  const pipelineCible = pipelineId
    || pipelineActif
    || pipelines.find((p) => p.is_default)?.id
    || '';
  const nomPipeline = pipelines.find((p) => p.id === pipelineCible)?.name ?? '';

  const { data: etapesCible = [] } = useQuery({
    queryKey: ['pipeline-etapes', pipelineCible],
    queryFn: () => fetchStages(pipelineCible),
    enabled: ouvert && !!pipelineCible,
    staleTime: 60_000,
  });
  const etapesOuvertes = etapesCible.filter((e) => e.kind === 'open' && !e.archived_at).sort((a, b) => a.position - b.position);

  const termeDiffere = useDiffere(recherche.trim(), 250);
  const clientsQ = useQuery({
    queryKey: ['nouveau-deal', 'clients', termeDiffere],
    queryFn: () => rechercherClientsPourDeal(termeDiffere),
    enabled: ouvert && !client && termeDiffere.length >= 2,
    staleTime: 30_000,
  });
  // L'avertissement de doublon : le nom tapé est comparé aux fiches existantes.
  const nomSaisi = useDiffere(`${champs.prenom} ${champs.nom}`.trim(), 400);
  const doublonsQ = useQuery({
    queryKey: ['nouveau-deal', 'doublons', nomSaisi],
    queryFn: () => rechercherClientsPourDeal(nomSaisi, 3),
    enabled: ouvert && mode === 'nouveau' && nomSaisi.length >= 3,
    staleTime: 30_000,
  });
  const doublons = mode === 'nouveau' ? (doublonsQ.data ?? []) : [];

  function fermer() {
    setChamps(champsDealVides());
    setMode('client');
    setClient(null);
    setDevis(null);
    setRecherche('');
    setPipelineId('');
    setEtiquettesClient([]);
    setListeContacts(false);
    setEntreprise('');
    setTitre('');
    setEtapeId('');
    setStatut('ouvert');
    setRaison('');
    onFermer();
  }

  function vide(v: string): string | null {
    const t = v.trim();
    return t === '' ? null : t;
  }

  async function soumettre(e: FormEvent) {
    e.preventDefault();

    let prenom: string;
    if (mode === 'client') {
      if (!client) {
        toast.error(fr ? 'Choisis un client.' : 'Pick a client.');
        return;
      }
      prenom = client.nom;
    } else if (mode === 'devis') {
      if (!devis) {
        toast.error(fr ? 'Choisis un devis.' : 'Pick a quote.');
        return;
      }
      prenom = devis.clientNom;
    } else {
      prenom = champs.prenom.trim();
      if (prenom === '') {
        toast.error(fr ? 'Choisis un contact ou écris le nom d’un nouveau contact.' : 'Pick a contact or type a new contact’s name.');
        return;
      }
    }
    if (statut === 'perdu' && !raison.trim()) {
      toast.error(fr ? 'Indique la raison de la perte.' : 'Enter the lost reason.');
      return;
    }

    const erreurChamps = champsPerso.valider();
    if (erreurChamps) { toast.error(erreurChamps); return; }
    setEnvoi(true);
    try {
      // Saisi en dollars, envoyé en CENTS : les cents sont la source de
      // vérité dans tout Lume. Un devis choisi apporte SON montant : on
      // n'en envoie pas un second qui divergerait du document.
      const brut = Number(champs.montant.replace(',', '.').replace(/\s/g, ''));
      const cents = mode !== 'devis' && champs.montant.trim() !== '' && Number.isFinite(brut) && brut > 0
        ? Math.round(brut * 100)
        : null;

      const nouveau = mode === 'nouveau';
      const r = await creerDealManuel({
        prenom,
        nom: nouveau ? vide(champs.nom) : null,
        courriel: nouveau ? vide(champs.courriel) : null,
        telephone: nouveau ? vide(champs.telephone) : null,
        adresse: nouveau ? vide(champs.adresse) : null,
        montantCents: cents,
        assigneA: vide(champs.assigneA),
        dateFermetureVisee: vide(champs.dateVisee),
        source: vide(champs.source),
        clientId: mode === 'client' ? client?.id ?? null : mode === 'devis' ? devis?.clientId ?? null : null,
        quoteId: mode === 'devis' ? devis?.id ?? null : null,
        pipelineId: pipelineCible || null,
      });
      // Un deal DÉJÀ ouvert pour ce contact garde ses valeurs : les champs
      // tapés ne complètent que ses champs VIDES, jamais n'écrasent. Avant,
      // ils étaient perdus sans un mot.
      let completes = 0;
      if (r.dealExistant) completes = await champsPerso.completerVides(r.dealId);
      else await champsPerso.enregistrer(r.dealId);
      // Les étiquettes vont sur le client du deal — celui choisi, ou celui que
      // la base a créé (ou retrouvé) pour un nouveau contact.
      const clientDuDeal = r.clientId
        ?? (mode === 'client' ? client?.id ?? null : mode === 'devis' ? devis?.clientId ?? null : null);
      // Le reste du formulaire GHL : coordonnées modifiées d'un client existant,
      // entreprise, étape choisie, statut. Seulement pour un deal NEUF — un deal
      // déjà ouvert pour ce contact garde son étape et son statut.
      if (!r.dealExistant) {
        try {
          const contact: Record<string, string | null> = {};
          if (entreprise.trim()) contact.company = entreprise.trim();
          if (mode === 'client' && client) {
            if (champs.courriel.trim() !== (client.courriel ?? '')) contact.email = champs.courriel.trim() || null;
            if (champs.telephone.trim() !== (client.telephone ?? '')) contact.phone = champs.telephone.trim() || null;
          }
          if (clientDuDeal && Object.keys(contact).length) await majContactDuDeal(clientDuDeal, contact);
          if (titre.trim()) await majTitreDeal(r.dealId, titre);
          const gagnee = etapesCible.find((x) => x.kind === 'won' && !x.archived_at);
          const perdue = etapesCible.find((x) => x.kind === 'lost' && !x.archived_at);
          if (statut === 'gagne' && gagnee) await deplacerDeal(r.dealId, gagnee.id);
          else if (statut === 'perdu' && perdue) await marquerPerdu(r.dealId, perdue.id, raison.trim());
          else if (statut === 'abandonne') await abandonnerDeal(r.dealId, raison);
          else if (statut === 'ouvert' && etapeId && etapeId !== etapesOuvertes[0]?.id) await deplacerDeal(r.dealId, etapeId);
        } catch (err) {
          console.error('[pipeline] détails du deal non appliqués', err);
          captureClientException(err, { contexte: 'ModalNouveauDeal.details' });
          toast.error(fr ? 'Deal créé, mais une partie des détails (étape, statut ou coordonnées) n’a pas pu être enregistrée.'
            : 'Deal created, but some details (stage, status or contact) could not be saved.');
        }
      }
      if (etiquettesClient.length > 0 && clientDuDeal) {
        let echecs = 0;
        for (const tag of etiquettesClient) {
          try {
            await poserEtiquette(clientDuDeal, tag);
          } catch (err) {
            echecs += 1;
            console.error('[pipeline] étiquette non posée à la création du deal', err);
            captureClientException(err, { contexte: 'ModalNouveauDeal.etiquettes', tag });
          }
        }
        if (echecs > 0) {
          toast.error(fr
            ? `Deal créé, mais ${echecs} étiquette(s) n’ont pas pu être posées sur le client.`
            : `Deal created, but ${echecs} tag(s) could not be added to the client.`);
        }
        void qc.invalidateQueries({ queryKey: [CLE_ETIQUETTES_CLIENTS] });
        void qc.invalidateQueries({ queryKey: ['etiquettes'] });
      }
      if (r.dealExistant) {
        toast.success(completes > 0
          ? (fr
            ? 'Ce contact avait déjà un deal ouvert dans ce pipeline : les champs vides y ont été complétés.'
            : 'This contact already had an open deal in this pipeline: its empty fields were filled in.')
          : (fr
            ? 'Ce client avait déjà un deal ouvert dans ce pipeline : on l\'a gardé plutôt que d\'en créer un second.'
            : 'This client already had an open deal in this pipeline: it was kept instead of creating a second one.'));
      } else if (r.fusionne && mode === 'nouveau') {
        toast.success(fr
          ? 'Un client existant a été retrouvé : le deal lui est rattaché.'
          : 'An existing client was found: the deal is linked to them.');
      } else {
        toast.success(fr ? 'Deal créé.' : 'Deal created.');
      }
      onCree(r.pipelineId);
      fermer();
    } catch (err) {
      console.error('[pipeline] création de deal refusée', err);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  }

  const resultats = !client ? (clientsQ.data ?? []) : [];
  const saisieContact = recherche;
  const choisirClient = (c: ClientPourDeal) => {
    setMode('client');
    setClient(c);
    setRecherche('');
    setListeContacts(false);
    setChamps((v) => ({ ...v, courriel: c.courriel ?? '', telephone: c.telephone ?? '' }));
  };
  const saisirContact = (texte: string) => {
    // Un nom tapé sans choisir de fiche = un NOUVEAU contact (prénom + nom).
    setRecherche(texte);
    setListeContacts(true);
    setMode('nouveau');
    const [p, ...n] = texte.trim().split(/\s+/);
    setChamps((v) => ({ ...v, prenom: p ?? '', nom: n.join(' ') }));
  };
  const monnaie = fr ? 'C$' : 'C$';

  return (
    <Modal
      open={ouvert}
      onClose={fermer}
      size="4xl"
      title={fr ? 'Nouveau deal' : 'Add new opportunity'}
      description={fr ? 'Crée un deal en remplissant les détails et en choisissant un contact.' : 'Create a new opportunity by filling in details and selecting a contact.'}
      footer={(
        <>
          <button type="button" onClick={fermer} className={cn(CLASSE_BOUTON, 'px-5')}>
            {fr ? 'Annuler' : 'Cancel'}
          </button>
          <button type="submit" form={idFormulaire} disabled={envoi}
            className={cn(CLASSE_BOUTON, 'px-5 font-semibold disabled:opacity-60')}
            style={{ background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: 'var(--color-primary-foreground)' }}>
            {envoi ? (fr ? 'Création…' : 'Creating…') : (fr ? 'Créer' : 'Create')}
          </button>
        </>
      )}
    >
      <form id={idFormulaire} onSubmit={soumettre}>
        <CadreGhl fr={fr} onGererChamps={champsPerso.ouvrirGerer}>
          <SectionGhl titre={fr ? 'Coordonnées du contact' : 'Contact details'}>
            <ChampGhl id={idRecherche} libelle={fr ? 'Contact principal' : 'Primary contact name'} requis>
              {client ? (
                <div className={cn(CLASSE_SAISIE, 'flex items-center justify-between gap-2')}>
                  <span className="truncate font-medium">{client.nom}</span>
                  <button type="button" onClick={() => { setClient(null); setMode('client'); setChamps((v) => ({ ...v, courriel: '', telephone: '' })); }}
                    className="shrink-0 text-[12px] text-primary hover:underline">{fr ? 'Changer' : 'Change'}</button>
                </div>
              ) : (
                <div className="relative">
                  <input id={idRecherche} role="combobox" aria-expanded={listeContacts && (resultats.length > 0 || !!saisieContact.trim())}
                    aria-controls={`${idRecherche}-liste`} aria-autocomplete="list" autoComplete="off" autoFocus
                    value={saisieContact} onChange={(e) => saisirContact(e.target.value)}
                    onFocus={() => setListeContacts(true)} onBlur={() => setTimeout(() => setListeContacts(false), 150)}
                    placeholder={fr ? 'Choisir un contact' : 'Select contact'} className={CLASSE_SAISIE} />
                  {listeContacts && (resultats.length > 0 || saisieContact.trim().length > 0) && (
                    <ul id={`${idRecherche}-liste`} role="listbox"
                      className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-lg border border-outline bg-surface py-1 shadow-lg">
                      {resultats.map((c) => (
                        <li key={c.id} role="option" aria-selected={false}>
                          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choisirClient(c)}
                            className="w-full px-3 py-2 text-left hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                            <span className="block truncate text-[13px] font-medium text-text-primary">{c.nom}</span>
                            <span className="block truncate text-[11.5px] text-text-tertiary">{[c.telephone, c.courriel].filter(Boolean).join(' · ') || c.adresse || '—'}</span>
                          </button>
                        </li>
                      ))}
                      {saisieContact.trim().length > 0 && (
                        <li role="option" aria-selected={false}>
                          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setListeContacts(false)}
                            className="w-full border-t border-outline px-3 py-2 text-left text-[13px] font-medium text-primary hover:bg-surface-secondary">
                            {fr ? `+ Nouveau contact « ${saisieContact.trim()} »` : `+ New contact “${saisieContact.trim()}”`}
                          </button>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )}
            </ChampGhl>
            <ChampGhl id={idCourriel} libelle={fr ? 'Courriel principal' : 'Primary email'}>
              <input id={idCourriel} type="email" value={champs.courriel}
                onChange={(e) => setChamps((v) => ({ ...v, courriel: e.target.value }))}
                placeholder={fr ? 'Entrer un courriel' : 'Enter email'} className={CLASSE_SAISIE} />
            </ChampGhl>
            <ChampGhl id={idTelephone} libelle={fr ? 'Téléphone principal' : 'Primary phone'}>
              <input id={idTelephone} type="tel" value={champs.telephone}
                onChange={(e) => setChamps((v) => ({ ...v, telephone: e.target.value }))}
                placeholder={fr ? 'Entrer un téléphone' : 'Enter phone'} className={CLASSE_SAISIE} />
            </ChampGhl>
            {/*
              Avertir, pas bloquer : deux personnes peuvent porter le même nom. Mais
              le rapprochement automatique ne reconnaît quelqu'un QUE par son
              téléphone ou son courriel — un nom seul crée une seconde fiche.
            */}
            {doublons.length > 0 && (
              <div role="status" className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-900 sm:col-span-2 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                <p className="font-medium">
                  {fr
                    ? (doublons.length === 1 ? 'Un client porte déjà ce nom :' : 'Des clients portent déjà ce nom :')
                    : (doublons.length === 1 ? 'A client already has this name:' : 'Clients already have this name:')}
                </p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {doublons.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{d.nom}{(d.telephone || d.courriel) && <span className="opacity-75"> · {d.telephone || d.courriel}</span>}</span>
                      <button type="button" onClick={() => choisirClient(d)} className="shrink-0 font-semibold underline underline-offset-2">
                        {fr ? 'Utiliser cette fiche' : 'Use this record'}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 opacity-80">
                  {fr ? 'Si c\'est une autre personne, continue : une nouvelle fiche sera créée.' : 'If it\'s someone else, carry on: a new record will be created.'}
                </p>
              </div>
            )}
          </SectionGhl>
          {champsPerso.section('contact')}

          <SectionGhl titre={fr ? 'Détails du deal' : 'Opportunity details'}>
            <ChampGhl id={idTitre} libelle={fr ? 'Titre du deal' : 'Opportunity name'} pleine>
              <input id={idTitre} value={titre} maxLength={200} onChange={(e) => setTitre(e.target.value)}
                placeholder={fr ? 'Ex. : Lavage de vitres — condo 12e étage (facultatif)' : 'e.g. Window cleaning — 12th floor condo (optional)'}
                className={CLASSE_SAISIE} />
            </ChampGhl>
            <ChampGhl id={idPipeline} libelle="Pipeline">
              <select id={idPipeline} value={pipelineCible} onChange={(e) => { setPipelineId(e.target.value); setEtapeId(''); }} className={CLASSE_SAISIE}>
                {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </ChampGhl>
            <ChampGhl id={idEtapeDeal} libelle={fr ? 'Étape' : 'Stage'}>
              <select id={idEtapeDeal} value={statut === 'ouvert' ? (etapeId || etapesOuvertes[0]?.id || '') : ''} disabled={statut !== 'ouvert'}
                onChange={(e) => setEtapeId(e.target.value)} className={CLASSE_SAISIE}>
                {statut !== 'ouvert' && <option value="">{fr ? '— Deal fermé —' : '— Closed —'}</option>}
                {etapesOuvertes.map((e) => <option key={e.id} value={e.id}>{fr ? e.name_fr : e.name_en}</option>)}
              </select>
            </ChampGhl>
            <ChampGhl id={idStatut} libelle={fr ? 'Statut' : 'Status'}>
              <select id={idStatut} value={statut} onChange={(e) => setStatut(e.target.value as StatutDeal)} className={CLASSE_SAISIE}>
                {OPTIONS_STATUT.map((o) => <option key={o.cle} value={o.cle}>{fr ? o.fr : o.en}</option>)}
              </select>
            </ChampGhl>
            <ChampGhl id={idMontant} libelle={fr ? 'Valeur' : 'Value'}>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-text-tertiary">{monnaie}</span>
                <input id={idMontant} type="text" inputMode="decimal" value={champs.montant}
                  onChange={(e) => setChamps((v) => ({ ...v, montant: e.target.value }))}
                  placeholder={fr ? 'Montant estimé' : 'Please input'} className={cn(CLASSE_SAISIE, 'pl-10')} />
              </div>
            </ChampGhl>
            {(statut === 'perdu' || statut === 'abandonne') && (
              <ChampRaison id={idRaison} valeur={raison} onChange={setRaison} fr={fr} requise={statut === 'perdu'} />
            )}
            <ChampGhl id={idAssigne} libelle={fr ? 'Responsable' : 'Owner'}>
              <select id={idAssigne} value={champs.assigneA} onChange={(e) => setChamps((v) => ({ ...v, assigneA: e.target.value }))} className={CLASSE_SAISIE}>
                <option value="">{fr ? 'Non assigné' : 'Unassigned'}</option>
                {membres.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </ChampGhl>
            <ChampGhl id={idEntreprise} libelle={fr ? 'Entreprise' : 'Business name'}>
              <input id={idEntreprise} value={entreprise} onChange={(e) => setEntreprise(e.target.value)}
                placeholder={fr ? 'Nom de l’entreprise' : 'Enter business name'} className={CLASSE_SAISIE} />
            </ChampGhl>
            <ChampGhl id={idSource} libelle="Source">
              <select id={idSource} value={champs.source} onChange={(e) => setChamps((v) => ({ ...v, source: e.target.value }))} className={CLASSE_SAISIE}>
                {OPTIONS_SOURCE.map((o) => <option key={o.cle} value={o.cle}>{fr ? o.fr : o.en}</option>)}
              </select>
            </ChampGhl>
            <ChampGhl id={idDateVisee} libelle={fr ? 'Date de fermeture prévue' : 'Expected close date'}>
              <input id={idDateVisee} type="date" value={champs.dateVisee}
                onChange={(e) => setChamps((v) => ({ ...v, dateVisee: e.target.value }))} className={CLASSE_SAISIE} />
            </ChampGhl>
            <ChampGhl libelle={fr ? 'Étiquettes' : 'Tags'}>
              {/* Encadré comme un champ (« Add tags » de GHL). */}
              <div className="flex min-h-10 items-center rounded-lg border border-outline bg-surface px-2 py-1.5">
                <SelecteurEtiquettes
                  valeurs={etiquettesClient}
                  fr={fr}
                  onAjouter={(tag) => setEtiquettesClient((v) => (v.some((x) => x.toLowerCase() === tag.toLowerCase()) ? v : [...v, tag]))}
                  onRetirer={(tag) => setEtiquettesClient((v) => v.filter((x) => x !== tag))}
                />
              </div>
            </ChampGhl>
          </SectionGhl>
          {champsPerso.section('depart')}
          {champsPerso.section('previsions')}
          {champsPerso.bloc}
        </CadreGhl>
      </form>
    </Modal>
  );
}

// ── Barre d'outils ──

interface EtatFiltres {
  texte: string;
  source: string;
  /** `'__non'` = les deals que personne n'a pris en charge. */
  assigne: string;
  priorite: '' | NiveauPriorite;
  /** Une étape précise. En kanban, les autres colonnes disparaissent. */
  etape: string;
  /** Montant minimum en DOLLARS (saisi par l'utilisateur, comparé en cents). */
  montantMin: string;
  /** Entrés dans le pipeline depuis N jours au plus. '' = sans limite. */
  creesDepuis: string;
}

const FILTRES_VIDES: EtatFiltres = {
  texte: '', source: '', assigne: '', priorite: '',
  etape: '', montantMin: '', creesDepuis: '',
};

/**
 * Vues INTÉGRÉES, toujours là et non supprimables.
 *
 * Il y en avait quatre, dont deux — « Deals ouverts » et « Tous » — portaient
 * exactement les mêmes filtres : deux onglets qui affichaient la même chose,
 * donc un onglet qui ment. On garde « Tous » comme point de départ, plus les
 * deux raccourcis qui répondent à une vraie question du matin.
 *
 * Tout le reste est enregistré en base (`pipeline_vues`) : une vue nommée par
 * un vendeur le suit d'un appareil à l'autre.
 */
const VUES: Record<VueEnregistree, { fr: string; en: string; filtres: EtatFiltres }> = {
  tous: { fr: 'Tous', en: 'All', filtres: FILTRES_VIDES },
  'non-assignes': { fr: 'Non assignés', en: 'Unassigned', filtres: { ...FILTRES_VIDES, assigne: '__non' } },
  relancer: { fr: 'À relancer', en: 'Needs follow-up', filtres: { ...FILTRES_VIDES, priorite: 'urgent' } },
};

function BarreOutils({
  fr, total, filtres, sources, membres, panneauOuvert, tri, affichage,
  pipelines, pipelineActif, onChangerPipeline, etapesFiltrables, onCreerPipeline,
  onFiltres, onBasculerPanneau, onTri, onAffichage, onNouveauDeal,
  extraPanneau, nbFiltresExtra = 0,
}: {
  /** Filtres tenus hors d'EtatFiltres (étiquettes, champs) : comptés dans le badge. */
  nbFiltresExtra?: number;
  /** Ouvre les réglages pour créer un pipeline. Absent = pas le droit. */
  onCreerPipeline?: () => void;
  /** Section ajoutée au panneau de filtres (champs personnalisés). */
  extraPanneau?: ReactNode;
  /** Étapes proposées au filtre — les actives, dans l'ordre du board. */
  etapesFiltrables: PipelineStage[];
  pipelines: { id: string; name: string; is_default: boolean }[];
  pipelineActif: string | null;
  onChangerPipeline: (pipelineId: string) => void;
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
  /** Télécharge les deals ACTUELLEMENT filtrés en CSV. */
  onNouveauDeal: () => void;
}) {
  // `useId()` : ce composant peut réapparaître, un id littéral se dupliquerait.
  const idPipeline = useId();
  const idRecherche = useId();
  const idSource = useId();
  const idAssigne = useId();
  const idPriorite = useId();
  const idEtape = useId();
  const idMontant = useId();
  const idDepuis = useId();

  const nbFiltres = Object.values(filtres).filter((v) => v !== '').length + nbFiltresExtra;

  return (
    <>
      <div className="flex flex-col items-stretch gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={idPipeline} className="sr-only">
            {fr ? 'Pipeline affiché' : 'Displayed pipeline'}
          </label>
          {/*
            Le sélecteur affichait UNE option codée en dur, sans onChange : on
            pouvait créer un 2e pipeline dans les réglages sans jamais pouvoir
            le consulter. Il liste maintenant les vrais pipelines. Changer de
            pipeline REGARDE un autre tableau — ça ne touche pas au défaut de
            l'organisation, qui reste un réglage d'administrateur.
          */}
          {/*
            JAMAIS `disabled` : avec un seul pipeline le sélecteur était grisé,
            donc on ne pouvait ni cliquer dessus ni découvrir qu'on avait le
            droit d'en créer un deuxième. Un contrôle mort n'explique rien —
            celui-ci porte maintenant la porte de création.
          */}
          <select
            id={idPipeline}
            className="min-w-[190px] rounded-lg border border-outline-strong bg-surface-card px-3 py-2 text-[13px] font-semibold text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
            value={pipelineActif ?? ''}
            onChange={(e) => {
              if (e.target.value === '__creer') { onCreerPipeline?.(); return; }
              onChangerPipeline(e.target.value);
            }}
          >
            {pipelines.length === 0 && (
              <option value="">{fr ? 'Pipeline de ventes' : 'Sales pipeline'}</option>
            )}
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
            {onCreerPipeline && (
              <option value="__creer">
                {fr ? '＋ Créer un pipeline…' : '＋ Create a pipeline…'}
              </option>
            )}
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
            onClick={onNouveauDeal}
            className={cn(CLASSE_BOUTON, 'font-semibold')}
            // La couleur principale du CRM, comme « Créer » ailleurs — pas
            // l'accent rose (Rafba, 2026-09-30 : « pas rapport »).
            style={{ background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: 'var(--color-primary-foreground)' }}
          >
            <Plus size={13} aria-hidden="true" />
            {fr ? 'Nouveau deal' : 'New deal'}
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

          <div className="min-w-[150px]">
            <label htmlFor={idEtape} className="mb-1.5 block text-[11px] text-text-tertiary">
              {fr ? 'Étape' : 'Stage'}
            </label>
            <select
              id={idEtape}
              value={filtres.etape}
              onChange={(e) => onFiltres({ ...filtres, etape: e.target.value })}
              className={CLASSE_CHAMP}
            >
              <option value="">{fr ? 'Toutes' : 'All'}</option>
              {etapesFiltrables.map((e) => (
                <option key={e.id} value={e.id}>{fr ? e.name_fr : e.name_en}</option>
              ))}
            </select>
          </div>

          <div className="min-w-[130px]">
            <label htmlFor={idMontant} className="mb-1.5 block text-[11px] text-text-tertiary">
              {fr ? 'Montant minimum' : 'Minimum amount'}
            </label>
            <input
              id={idMontant}
              type="number"
              min={0}
              step={100}
              inputMode="decimal"
              value={filtres.montantMin}
              onChange={(e) => onFiltres({ ...filtres, montantMin: e.target.value })}
              placeholder={fr ? '2000' : '2000'}
              className={CLASSE_CHAMP}
            />
            <p className="mt-1 text-[10px] text-text-muted">
              {fr ? 'Cache les deals sans montant connu.' : 'Hides deals with no known amount.'}
            </p>
          </div>

          <div className="min-w-[150px]">
            <label htmlFor={idDepuis} className="mb-1.5 block text-[11px] text-text-tertiary">
              {fr ? 'Entrés depuis' : 'Created within'}
            </label>
            <select
              id={idDepuis}
              value={filtres.creesDepuis}
              onChange={(e) => onFiltres({ ...filtres, creesDepuis: e.target.value })}
              className={CLASSE_CHAMP}
            >
              <option value="">{fr ? "N'importe quand" : 'Any time'}</option>
              <option value="7">{fr ? '7 derniers jours' : 'Last 7 days'}</option>
              <option value="30">{fr ? '30 derniers jours' : 'Last 30 days'}</option>
              <option value="90">{fr ? '90 derniers jours' : 'Last 90 days'}</option>
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
          {extraPanneau}
        </div>
      )}
    </>
  );
}

// ── Étiquettes en lot ──

/**
 * « Ajouter / Retirer une étiquette » sur les deals cochés.
 *
 * L'étiquette va sur les CLIENTS de ces deals (D1), une fois par client
 * même s'il a plusieurs deals cochés ; un deal sans client est ignoré.
 * Chaque pose annonce « Étiquette ajoutée » au moteur : on le dit AVANT de
 * confirmer, parce que 40 clients = 40 départs d'automatisation.
 * Écritures l'une après l'autre (pas de rafale sur la base ni sur le
 * moteur), et le bilan réel à la fin : jamais « 40 faits » si 3 ont échoué.
 */
function ModalEtiquettesLot({ action, fr, nbDeals, nbSansClient, clientIds, onFermer, onTermine }: {
  action: 'ajouter' | 'retirer' | null;
  fr: boolean;
  nbDeals: number;
  /** Deals cochés sans client : ignorés, et on le dit. */
  nbSansClient: number;
  clientIds: string[];
  onFermer: () => void;
  onTermine: () => void;
}) {
  const [tags, setTags] = useState<string[]>([]);
  const [enCours, setEnCours] = useState(false);
  useEffect(() => { if (!action) setTags([]); }, [action]);
  if (!action) return null;
  const ajouter = action === 'ajouter';
  const nbClients = clientIds.length;

  async function appliquer() {
    if (tags.length === 0 || nbClients === 0 || enCours) return;
    const liste = tags.map((t) => `« ${t} »`).join(', ');
    const ok = await confirmer({
      title: ajouter
        ? (fr ? `Ajouter ${liste} ?` : `Add ${liste}?`)
        : (fr ? `Retirer ${liste} ?` : `Remove ${liste}?`),
      message: ajouter
        ? (fr
          ? `${nbClients} client(s) des ${nbDeals} deal(s) sélectionné(s) recevront l’étiquette. Les automatisations « Étiquette ajoutée » partiront pour chaque client.`
          : `${nbClients} client(s) of the ${nbDeals} selected deal(s) will get the tag. “Tag added” automations will run for each client.`)
        : (fr
          ? `L’étiquette sera retirée de ${nbClients} client(s) des ${nbDeals} deal(s) sélectionné(s). Les automatisations « Étiquette retirée » partiront pour chaque client.`
          : `The tag will be removed from ${nbClients} client(s) of the ${nbDeals} selected deal(s). “Tag removed” automations will run for each client.`),
      confirmLabel: ajouter ? (fr ? 'Ajouter' : 'Add') : (fr ? 'Retirer' : 'Remove'),
      danger: !ajouter,
    });
    if (!ok) return;
    setEnCours(true);
    let reussis = 0;
    const erreurs: string[] = [];
    for (const clientId of clientIds) {
      try {
        for (const tag of tags) {
          if (ajouter) await poserEtiquette(clientId, tag);
          else await retirerEtiquette(clientId, tag);
        }
        reussis += 1;
      } catch (err) {
        console.error('[pipeline] étiquette en lot refusée', err);
        captureClientException(err, { contexte: 'ModalEtiquettesLot', action, clientId });
        erreurs.push(err instanceof Error ? err.message : String(err));
      }
    }
    const echecs = erreurs.length;
    void journaliserLot({
      libelle: ajouter
        ? (fr ? `Étiquette ajoutée (${tags.join(', ')})` : `Tag added (${tags.join(', ')})`)
        : (fr ? `Étiquette retirée (${tags.join(', ')})` : `Tag removed (${tags.join(', ')})`),
      operation: 'modification',
      statut: echecs === 0 ? 'termine' : echecs === nbClients ? 'echoue' : 'partiel',
      total: nbClients,
      reussis,
      echoues: echecs,
      cibles: clientIds,
      erreurs: erreurs.slice(0, 20),
    });
    setEnCours(false);
    if (echecs === 0) {
      toast.success(ajouter
        ? (fr ? `Étiquette ajoutée à ${reussis} client(s).` : `Tag added to ${reussis} client(s).`)
        : (fr ? `Étiquette retirée de ${reussis} client(s).` : `Tag removed from ${reussis} client(s).`));
    } else {
      toast.error(fr ? `${reussis} client(s) mis à jour, ${echecs} en échec.` : `${reussis} client(s) updated, ${echecs} failed.`);
    }
    onTermine();
  }

  return (
    <Modal
      open
      onClose={onFermer}
      size="md"
      title={ajouter ? (fr ? 'Ajouter une étiquette' : 'Add a tag') : (fr ? 'Retirer une étiquette' : 'Remove a tag')}
      description={fr
        ? `Sur les clients des deals sélectionnés : ${nbClients} client(s) pour ${nbDeals} deal(s).`
        : `On the clients of the selected deals: ${nbClients} client(s) for ${nbDeals} deal(s).`}
    >
      <div className="flex flex-col gap-3">
        <SelecteurEtiquettes
          valeurs={tags}
          fr={fr}
          sansCreation={!ajouter}
          onAjouter={(t) => setTags((v) => (v.some((x) => x.toLowerCase() === t.toLowerCase()) ? v : [...v, t]))}
          onRetirer={(t) => setTags((v) => v.filter((x) => x !== t))}
        />
        {nbSansClient > 0 && (
          <p className="text-[11.5px] text-text-tertiary">
            {fr ? `${nbSansClient} deal(s) sans client ignoré(s).` : `${nbSansClient} deal(s) without a client skipped.`}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onFermer} className={CLASSE_BOUTON}>{fr ? 'Annuler' : 'Cancel'}</button>
          <button
            type="button"
            onClick={() => { void appliquer(); }}
            disabled={tags.length === 0 || nbClients === 0 || enCours}
            className={cn(CLASSE_BOUTON, 'font-semibold disabled:opacity-60')}
            style={{ background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: 'var(--color-primary-foreground)' }}
          >
            {enCours ? (fr ? 'Application…' : 'Applying…') : (fr ? 'Appliquer' : 'Apply')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Board ──

/**
 * Nommer la vue qu'on vient de bâtir.
 *
 * Un patron peut la rendre visible à toute l'équipe ; les autres n'ont que
 * des vues privées. Ce n'est pas qu'une question d'affichage : une vue
 * d'équipe apparaît chez tout le monde, elle ne se crée pas par accident.
 */
function ModalEnregistrerVue({
  ouvert, fr, estPatron, onFermer, onEnregistrer,
}: {
  ouvert: boolean;
  fr: boolean;
  estPatron: boolean;
  onFermer: () => void;
  onEnregistrer: (nom: string, pourEquipe: boolean) => void | Promise<void>;
}) {
  const idNom = useId();
  const idEquipe = useId();
  const [nom, setNom] = useState('');
  const [pourEquipe, setPourEquipe] = useState(false);
  const [enCours, setEnCours] = useState(false);

  if (!ouvert) return null;

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    if (!nom.trim() || enCours) return;
    setEnCours(true);
    try {
      await onEnregistrer(nom.trim(), pourEquipe);
      setNom('');
      setPourEquipe(false);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Modal open onClose={onFermer} size="md" title={fr ? 'Enregistrer la vue' : 'Save view'}>
      <form onSubmit={(e) => { void soumettre(e); }} className="space-y-4">
        <div>
          <label htmlFor={idNom} className="mb-1 block text-[11px] text-text-tertiary">
            {fr ? 'Nom de la vue' : 'View name'}
          </label>
          <input
            id={idNom}
            value={nom}
            maxLength={60}
            autoFocus
            onChange={(e) => setNom(e.target.value)}
            placeholder={fr ? 'Ex. : Soumissions à relancer' : 'e.g. Quotes to follow up'}
            className="input-field w-full text-[13px]"
          />
          <p className="mt-1.5 text-[11px] text-text-muted">
            {fr
              ? 'Les filtres, le tri et l’affichage courants sont enregistrés.'
              : 'Current filters, sort and layout are saved.'}
          </p>
        </div>

        {estPatron && (
          <div className="flex items-start gap-2">
            <input
              id={idEquipe}
              type="checkbox"
              checked={pourEquipe}
              onChange={(e) => setPourEquipe(e.target.checked)}
              className="mt-0.5"
            />
            <label htmlFor={idEquipe} className="text-[12.5px] text-text-secondary">
              {fr ? "Partager avec toute l'équipe" : 'Share with the whole team'}
              <span className="block text-[11px] text-text-muted">
                {fr
                  ? 'Sinon, la vue reste privée et te suit d’un appareil à l’autre.'
                  : 'Otherwise the view stays private and follows you across devices.'}
              </span>
            </label>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary text-[12.5px]" onClick={onFermer}>
            {fr ? 'Annuler' : 'Cancel'}
          </button>
          <button
            type="submit"
            disabled={!nom.trim() || enCours}
            className="btn-primary text-[12.5px] disabled:opacity-50"
          >
            {enCours ? (fr ? 'Enregistrement…' : 'Saving…') : fr ? 'Enregistrer' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Classes des cellules standard de la vue Liste (la 1re colonne en gras). */
const CLASSE_TD = 'border-t border-border-subtle px-3.5 py-2.5';
const CLASSES_COLONNE: Record<string, string> = {
  client: 'font-semibold text-text-primary',
  etape: 'text-text-secondary',
  montant: 'tabular-nums text-text-secondary',
  source: 'text-text-secondary',
  assigne: '',
  inactif: 'tabular-nums text-text-secondary',
};

/**
 * Vue Liste du board. Les colonnes passent par le MÊME « Gérer les champs »
 * que les listes Clients, Jobs, Devis et Factures : colonnes standard à
 * cocher, champs d'opportunité à ajouter, réglage gardé PAR UTILISATEUR en
 * base (table_view_preferences, objet « deal »). Le client reste verrouillé
 * en première colonne.
 *
 * Cliquer l'en-tête d'un champ trie par ce champ : c'est le même tri que
 * « Trier par champ » du panneau de filtres (une seule source, `triChamp`).
 */
function ListeDeals({ fr, deals, etapes, montants, membres, maintenant, valeurs, triChamp, onTriChamp, onOuvrir, etiquettesClients }: {
  fr: boolean;
  /** Étiquettes par client : la colonne « Étiquettes » (les mêmes que sur les cartes). */
  etiquettesClients: Record<string, string[]>;
  deals: Deal[];
  etapes: PipelineStage[];
  montants: Record<string, number>;
  membres: Membre[];
  maintenant: number;
  valeurs: Record<string, Record<string, ValeurEnregistree>>;
  triChamp: TriChamp | null;
  onTriChamp: (t: TriChamp | null) => void;
  onOuvrir: (deal: Deal) => void;
}) {
  const standard = useMemo<ColonneStandard<Deal>[]>(() => [
    { id: 'client', libelle: 'Client', largeur: 'auto', verrouillee: true, cellule: (d) => nomClient(d) },
    { id: 'titre', libelle: fr ? 'Titre' : 'Title', largeur: 'auto', parDefaut: true, cellule: (d) => d.title?.trim() || '—' },
    {
      id: 'etape', libelle: fr ? 'Étape' : 'Stage', largeur: 'auto', parDefaut: true,
      cellule: (d) => {
        const etape = etapes.find((e) => e.id === d.stage_id);
        return etape ? (fr ? etape.name_fr : etape.name_en) : '—';
      },
    },
    {
      id: 'montant', libelle: fr ? 'Montant' : 'Amount', largeur: 'auto', parDefaut: true,
      cellule: (d) => (montants[d.id] === undefined ? '—' : argent(montants[d.id], fr)),
    },
    { id: 'source', libelle: 'Source', largeur: 'auto', parDefaut: true, cellule: (d) => libelleSource(d.source, fr) },
    {
      id: 'assigne', libelle: fr ? 'Assigné' : 'Assignee', largeur: 'auto', parDefaut: true,
      cellule: (d) => {
        const assigne = d.assigned_user_id ? membres.find((x) => x.id === d.assigned_user_id)?.name ?? null : null;
        // Neutre : pas d'« Non assigné » en orange qui se lit comme une étiquette d'office.
        return assigne ?? <span className="text-text-tertiary">—</span>;
      },
    },
    {
      id: 'inactif', libelle: fr ? 'Inactif' : 'Inactive', largeur: 'auto', parDefaut: true,
      cellule: (d) => (priorite(d, etapes) ? `${joursDepuis(d.last_activity_at, maintenant)} ${fr ? 'j' : 'd'}` : '—'),
    },
    {
      id: 'etiquettes', libelle: fr ? 'Étiquettes' : 'Tags', largeur: 'auto', parDefaut: true,
      cellule: (d) => {
        const noms = etiquettesClients[d.client_id] ?? [];
        return noms.length > 0 ? <EtiquettesCompactes noms={noms} fr={fr} /> : '—';
      },
    },
  ], [fr, etapes, montants, membres, maintenant, etiquettesClients]);
  const colonnes = useColonnesTableau<Deal>('deal', standard, fr);
  const classeTh = 'border-b border-outline px-3.5 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-wider text-text-tertiary';

  return (
    <>
      <div className="mt-4 flex justify-end">{colonnes.bouton}</div>
      {colonnes.panneau}
      <div className="mt-2 overflow-x-auto rounded-xl border border-outline bg-surface-card">
        <table className="w-full min-w-[620px] border-collapse text-[12.5px]">
          <thead>
            <tr>
              {colonnes.visibles.map((c) => {
                const champ = c.champ;
                if (!champ) return <th key={c.id} className={classeTh}>{c.libelle}</th>;
                const etat = triChamp?.field_id === champ.id ? triChamp.sens : null;
                return (
                  <th key={c.id} className={classeTh}
                    aria-sort={etat === 'asc' ? 'ascending' : etat === 'desc' ? 'descending' : undefined}>
                    {estTriable(champ) ? (
                      <button
                        type="button"
                        onClick={() => onTriChamp(etat
                          ? { field_id: champ.id, sens: etat === 'asc' ? 'desc' : 'asc' }
                          : { field_id: champ.id, sens: sensParDefaut(champ) })}
                        aria-label={fr ? `Trier par ${champ.label}` : `Sort by ${champ.label}`}
                        className="-mx-1 inline-flex items-center gap-1 rounded px-1 uppercase hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
                      >
                        {champ.label}
                        <ArrowUpDown size={11} aria-hidden="true" className={etat ? 'text-text-primary' : undefined} />
                      </button>
                    ) : champ.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {deals.map((d) => (
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
                {colonnes.visibles.map((c) => (
                  <td key={c.id} className={cn(CLASSE_TD, c.champ ? 'max-w-[240px]' : CLASSES_COLONNE[c.id])}>
                    {c.rendu(d, valeurs[d.id])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function PipelineBoard({
  deals, etapes, montants, membres, chargement, onOuvrir, onDeplacer, onAssigner, onChangement,
  pipelines, pipelineActif, onChangerPipeline, modeCouleur = 'dot', onCreerPipeline, pipelinesCibles = [],
}: {
  /** Pipelines où l'utilisateur peut déplacer des deals (« Autre pipeline… »). */
  pipelinesCibles?: { id: string; name: string }[];
  /** Ouvre les réglages pour créer un pipeline. Absent = pas le droit. */
  onCreerPipeline?: () => void;
  /** Réglage du pipeline affiché. Par défaut la pastille, comme avant. */
  modeCouleur?: ModeCouleur;
  deals: Deal[];
  etapes: PipelineStage[];
  /** Tous les pipelines de l'organisation — le sélecteur les propose vraiment. */
  pipelines: { id: string; name: string; is_default: boolean }[];
  pipelineActif: string | null;
  /** Changer de pipeline REGARDE un autre tableau ; ça ne change pas le défaut. */
  onChangerPipeline: (pipelineId: string) => void;
  /** Montant en cents par deal (devis puis job). Absent = « Montant à venir ». */
  montants: Record<string, number>;
  membres: { id: string; name: string }[];
  chargement?: boolean;
  onOuvrir: (deal: Deal) => void;
  /** Le parent décide : popup de job vers « Gagné », modal de raison vers « Perdu ». */
  onDeplacer: (dealId: string, versEtapeId: string) => void;
  /** Assignation depuis le menu « ⋮ » d'une carte, sans ouvrir la fiche. */
  onAssigner: (dealId: string, membreId: string | null) => void;
  /** Appelé après une action rapide (texto, rappel) pour rafraîchir. */
  onChangement?: () => void;
}) {
  const { language } = useTranslation();
  // Les bureaux de l'utilisateur : un board vide peut simplement vouloir dire
  // que ses deals sont dans l'autre bureau.
  //
  // `useContext` et non `useCompany` : ce dernier LÈVE hors provider, et le
  // board serait alors impossible à monter seul — c'est un renseignement de
  // confort, pas une dépendance. Sans contexte, on n'affiche simplement pas
  // le message : mieux vaut un board silencieux qu'un board qui plante.
  const ctxBureaux = useContext(CompanyContext);
  const companies = ctxBureaux?.companies ?? [];
  const currentOrgId = ctxBureaux?.currentOrgId ?? null;
  const switchCompany = ctxBureaux?.switchCompany ?? (() => {});
  const fr = language === 'fr';
  const [actif, setActif] = useState<Deal | null>(null);
  const [filtres, setFiltres] = useState<EtatFiltres>(FILTRES_VIDES);
  const [panneauOuvert, setPanneauOuvert] = useState(false);
  // Montant décroissant par défaut : un total de colonne qu'on ne retrouve
  // sur aucune carte visible n'explique rien. Les deals qui pèsent doivent
  // être en haut — c'est aussi ce qu'on veut voir en premier le matin.
  const [tri, setTri] = useState<Tri>('montant');
  // Champs personnalisés : conditions (filtrées en SQL) et tri par champ.
  // Hors d'EtatFiltres : les vues enregistrées ne les portent pas (encore).
  const [conditionsChamps, setConditionsChamps] = useState<Condition[]>([]);
  const [triChamp, setTriChamp] = useState<TriChamp | null>(null);
  const idsDeals = useMemo(() => deals.map((d) => d.id), [deals]);
  const champsPipeline = useChampsPipeline(pipelineActif, idsDeals);
  const filtreChamps = useFiltreChamps(champsPipeline.actif ? conditionsChamps : [], idsDeals);
  // Étiquettes des CLIENTS des deals (D1) : une seule requête pour tout le
  // board — cartes, colonne de la liste, filtre et actions en lot.
  const [filtreEtiquettes, setFiltreEtiquettes] = useState<FiltreEtiquettes>(FILTRE_ETIQUETTES_VIDE);
  const idsClients = useMemo(() => deals.map((d) => d.client_id), [deals]);
  const { parClient: etiquettesClients } = useEtiquettesDesClients(idsClients);
  const qc = useQueryClient();
  const [lotEtiquette, setLotEtiquette] = useState<'ajouter' | 'retirer' | null>(null);
  const [affichage, setAffichage] = useState<Affichage>('kanban');
  const [vue, setVue] = useState<VueEnregistree | string>('tous');
  const [nouveauDeal, setNouveauDeal] = useState(false);
  const [enregistrementVue, setEnregistrementVue] = useState(false);

  /**
   * Les deals cochés, pour agir sur plusieurs d'un coup.
   *
   * Un `Set` d'identifiants plutôt que des deals complets : la liste des
   * deals se rafraîchit sans cesse (déplacement, assignation), et garder des
   * objets figés afficherait des cartes périmées dans la barre d'actions.
   */
  const [selection, setSelection] = useState<Set<string>>(new Set());
  /** La fenêtre « Déplacer vers une autre pipeline » pour la sélection. */
  const [changerPipeline, setChangerPipeline] = useState(false);
  const autresPipelines = pipelinesCibles.filter((p) => p.id !== pipelineActif);
  const idLotAssigne = useId();
  const idLotEtape = useId();

  /**
   * Assigner plusieurs deals d'un coup.
   *
   * Passe par `onAssigner` du parent plutôt que par l'API : c'est lui qui
   * rafraîchit et qui connaît les règles. Court-circuiter ouvrirait un second
   * chemin d'écriture, avec d'autres comportements.
   *
   * Les écritures partent en parallèle mais on attend TOUTES les réponses
   * (`allSettled`) : annoncer « 12 deals assignés » alors que trois ont
   * échoué serait un mensonge, et l'utilisateur ne le découvrirait qu'en
   * voyant les cartes inchangées.
   */
  async function assignerEnLot(valeur: string) {
    const ids = [...selection];
    const membreId = valeur === '__non' ? null : valeur;
    const resultats = await Promise.allSettled(ids.map((id) => onAssigner(id, membreId)));
    const echecs = resultats.filter((r) => r.status === 'rejected').length;

    // Le journal garde la trace : sans elle, personne ne peut répondre à
    // « qui a réassigné ces 40 deals mardi ? ».
    void journaliserLot({
      libelle: fr
        ? `Assignation — ${new Date().toLocaleDateString('fr-CA')}`
        : `Assignment — ${new Date().toLocaleDateString('en-CA')}`,
      operation: 'modification',
      statut: echecs === 0 ? 'termine' : echecs === ids.length ? 'echoue' : 'partiel',
      total: ids.length,
      reussis: ids.length - echecs,
      echoues: echecs,
      erreurs: resultats
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .slice(0, 20)
        .map((r) => String(r.reason?.message ?? r.reason)),
    });

    setSelection(new Set());
    onChangement?.();
    if (echecs === 0) {
      toast.success(fr ? `${ids.length} deal(s) assigné(s).` : `${ids.length} deal(s) assigned.`);
    } else {
      toast.error(
        fr
          ? `${ids.length - echecs} assigné(s), ${echecs} en échec.`
          : `${ids.length - echecs} assigned, ${echecs} failed.`,
      );
    }
  }

  /**
   * Déplacer plusieurs deals vers une étape OUVERTE.
   *
   * Les étapes gagnée et perdue sont volontairement absentes du menu :
   * gagner ouvre la fenêtre de création de job, perdre exige une raison.
   * Un déplacement en masse sauterait les deux et laisserait des deals
   * fermés sans job ni motif — précisément ce que les statistiques lisent.
   */
  async function deplacerEnLot(etapeId: string) {
    const ids = [...selection];
    const resultats = await Promise.allSettled(ids.map((id) => onDeplacer(id, etapeId)));
    const echecs = resultats.filter((r) => r.status === 'rejected').length;

    void journaliserLot({
      libelle: fr
        ? `Déplacement — ${new Date().toLocaleDateString('fr-CA')}`
        : `Move — ${new Date().toLocaleDateString('en-CA')}`,
      operation: 'modification',
      statut: echecs === 0 ? 'termine' : echecs === ids.length ? 'echoue' : 'partiel',
      total: ids.length,
      reussis: ids.length - echecs,
      echoues: echecs,
      erreurs: resultats
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .slice(0, 20)
        .map((r) => String(r.reason?.message ?? r.reason)),
    });

    setSelection(new Set());
    onChangement?.();
    if (echecs === 0) {
      toast.success(fr ? `${ids.length} deal(s) déplacé(s).` : `${ids.length} deal(s) moved.`);
    } else {
      toast.error(
        fr
          ? `${ids.length - echecs} déplacé(s), ${echecs} en échec.`
          : `${ids.length - echecs} moved, ${echecs} failed.`,
      );
    }
  }

  const basculerSelection = useCallback((dealId: string) => {
    setSelection((s) => {
      const n = new Set(s);
      if (n.has(dealId)) n.delete(dealId); else n.add(dealId);
      return n;
    });
  }, []);
  const perms = usePermissions();
  // Seul un patron peut créer une vue d'ÉQUIPE : elle s'impose à tout le
  // monde. La RLS le refuse aussi — l'écran ne fait que ne pas le proposer.
  const estPatron = perms.role === 'owner' || perms.role === 'admin';
  // Les conditions de champs (et le tri par champ) comptent aussi : une vue
  // « Type de service = Commercial » est une vraie vue à enregistrer.
  const nbFiltresActifs = useMemo(
    () => Object.values(filtres).filter((v) => v !== '').length + nbFiltresChamps(conditionsChamps, triChamp)
      + nbFiltresEtiquettes(filtreEtiquettes),
    [filtres, conditionsChamps, triChamp, filtreEtiquettes],
  );

  // Les vues enregistrées vivent en base : elles doivent suivre le vendeur
  // d'un appareil à l'autre. La RLS décide de ce qui remonte (les siennes et
  // celles de l'équipe) — le client ne filtre rien.
  const vuesQ = useQuery({
    queryKey: ['pipeline-vues', pipelineActif],
    queryFn: () => fetchVues(pipelineActif as string),
    enabled: !!pipelineActif,
    staleTime: 300_000,
  });
  const vuesEnregistrees = useMemo(() => vuesQ.data ?? [], [vuesQ.data]);

  async function enregistrerVue(nom: string, pourEquipe: boolean) {
    if (!pipelineActif) return;
    try {
      // Les conditions et le tri sur les champs personnalisés voyagent dans le
      // même jsonb, sérialisés (la colonne est un objet de chaînes).
      const id = await creerVue(pipelineActif, nom, {
        ...filtres,
        ...(conditionsChamps.length ? { champs_perso: JSON.stringify(conditionsChamps) } : {}),
        ...(triChamp ? { tri_champ: JSON.stringify(triChamp) } : {}),
        ...etiquettesVersVue(filtreEtiquettes),
      }, { tri, affichage, pourEquipe });
      await vuesQ.refetch();
      setVue(id);
      setEnregistrementVue(false);
      toast.success(fr ? `Vue « ${nom} » enregistrée.` : `View “${nom}” saved.`);
    } catch (e) {
      console.error('[PipelineBoard] enregistrement de vue', e);
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function supprimer(v: VueSauvegardee) {
    const ok = await confirmer({
      title: fr ? `Supprimer « ${v.nom} » ?` : `Delete “${v.nom}”?`,
      message: v.user_id === null
        ? (fr ? "Cette vue d'équipe disparaîtra pour tout le monde." : 'This team view will disappear for everyone.')
        : (fr ? 'Les deals ne sont pas touchés, seule la vue disparaît.' : 'Deals are untouched; only the view disappears.'),
      confirmLabel: fr ? 'Supprimer' : 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await supprimerVue(v.id);
      await vuesQ.refetch();
      if (vue === v.id) appliquerVue('tous');
      toast.success(fr ? 'Vue supprimée.' : 'View deleted.');
    } catch (e) {
      console.error('[PipelineBoard] suppression de vue', e);
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }
  const verrous = useRef<Set<string>>(new Set());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const visibles = useMemo(
    () => [...etapes].filter((e) => e.archived_at === null).sort((a, b) => a.position - b.position),
    [etapes],
  );
  /**
   * Les colonnes réellement dessinées.
   *
   * Filtrer par étape sans réduire les colonnes laisserait cinq colonnes
   * vides à côté de la bonne : l'écran dirait « aucun deal » cinq fois pour
   * une information qu'on vient de demander à masquer.
   */
  const colonnes = useMemo(
    () => (filtres.etape ? visibles.filter((e) => e.id === filtres.etape) : visibles),
    [visibles, filtres.etape],
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
    // Saisi en dollars, comparé en cents : les cents sont la source de vérité
    // dans tout Lume, on ne convertit jamais dans l'autre sens.
    const brut = Number(filtres.montantMin.replace(',', '.'));
    const montantPlancher = filtres.montantMin.trim() !== '' && Number.isFinite(brut)
      ? Math.round(brut * 100)
      : null;
    const jours = Number(filtres.creesDepuis);
    const depuisBorne = filtres.creesDepuis !== '' && Number.isFinite(jours)
      ? Date.now() - jours * 86_400_000
      : null;
    const retenus = deals.filter((d) => {
      if (filtres.source && d.source !== filtres.source) return false;
      if (filtres.assigne === '__non' && d.assigned_user_id) return false;
      if (filtres.assigne && filtres.assigne !== '__non' && d.assigned_user_id !== filtres.assigne) return false;
      if (filtres.priorite) {
        const p = priorite(d, etapes);
        if (!p || p.niveau !== filtres.priorite) return false;
      }
      if (filtres.etape && d.stage_id !== filtres.etape) return false;
      if (montantPlancher !== null) {
        // Un deal sans montant connu n'est PAS « 0 $ » : c'est un montant
        // qu'on ignore. Le sortir d'un filtre « au moins 2 000 $ » serait
        // affirmer qu'il vaut moins, ce qu'on ne sait pas.
        const cents = montants[d.id];
        if (cents === undefined || cents < montantPlancher) return false;
      }
      if (depuisBorne !== null && new Date(d.created_at).getTime() < depuisBorne) return false;
      if (filtreChamps.ids && !filtreChamps.ids.has(d.id)) return false;
      if (!correspondEtiquettes(etiquettesClients[d.client_id], filtreEtiquettes)) return false;
      if (q) {
        const c = d.client;
        // Le téléphone est cherché sans sa ponctuation : personne ne tape
        // « (514) 555-0199 » dans une barre de recherche.
        const tel = (c?.phone ?? '').replace(/\D/g, '');
        const foin = `${d.title ?? ''} ${nomClient(d)} ${c?.email ?? ''} ${c?.address ?? ''} ${c?.company ?? ''} ${tel}`.toLowerCase();
        const qNum = q.replace(/\D/g, '');
        if (!foin.includes(q) && !(qNum.length >= 3 && tel.includes(qNum))) return false;
      }
      return true;
    });
    const parTri: Record<Tri, (a: Deal, b: Deal) => number> = {
      ancien: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      recent: (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      montant: (a, b) => (montants[b.id] ?? 0) - (montants[a.id] ?? 0),
      inactif: (a, b) => new Date(a.last_activity_at).getTime() - new Date(b.last_activity_at).getTime(),
    };
    const tries = [...retenus].sort(parTri[tri]);
    // Tri par champ personnalisé : stable, il départage selon le tri habituel.
    const champTrie = triChamp ? champsPipeline.champsDeal.find((c) => c.id === triChamp.field_id) : undefined;
    return triChamp ? tries.sort(comparerParChamp(triChamp, champsPipeline.valeurs, champTrie)) : tries;
  }, [deals, etapes, filtres, montants, tri, filtreChamps.ids, triChamp, champsPipeline.valeurs, champsPipeline.champsDeal,
    etiquettesClients, filtreEtiquettes]);

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
    setConditionsChamps([]);
    setTriChamp(null);
    setFiltreEtiquettes(FILTRE_ETIQUETTES_VIDE);
  }

  /**
   * Applique une vue enregistrée en base.
   *
   * Les filtres viennent d'un jsonb : une vue enregistrée par une version
   * précédente peut porter des clés qu'on ne connaît plus, ou en oublier.
   * On repart donc de `FILTRES_VIDES` et on ne reprend que les clés connues —
   * une vieille vue s'ouvre ainsi sans jamais casser l'écran.
   */
  function appliquerVueEnregistree(v: VueSauvegardee) {
    setVue(v.id);
    const f = { ...FILTRES_VIDES };
    if (typeof v.filtres?.texte === 'string') f.texte = v.filtres.texte;
    if (typeof v.filtres?.source === 'string') f.source = v.filtres.source;
    if (typeof v.filtres?.assigne === 'string') f.assigne = v.filtres.assigne;
    // `priorite` est une union fermée : une valeur inconnue venue du jsonb
    // (vieille vue, saisie manuelle) est ignorée plutôt que de fausser le filtre.
    const prio = v.filtres?.priorite;
    if (prio === 'urgent' || prio === 'moyen' || prio === 'frais') f.priorite = prio;
    // Enregistrées depuis toujours, jamais relues : une vue « étape X, plus de
    // 2 000 $ » se rouvrait sans ses filtres.
    if (typeof v.filtres?.etape === 'string') f.etape = v.filtres.etape;
    if (typeof v.filtres?.montantMin === 'string') f.montantMin = v.filtres.montantMin;
    if (typeof v.filtres?.creesDepuis === 'string') f.creesDepuis = v.filtres.creesDepuis;
    setFiltres(f);
    // Champs personnalisés : JSON illisible ou forme inattendue → ignoré.
    let conds: Condition[] = [];
    let triC: TriChamp | null = null;
    try {
      const brut = v.filtres?.champs_perso ? JSON.parse(v.filtres.champs_perso) : [];
      if (Array.isArray(brut)) conds = brut.filter((c) => c && typeof c.field_id === 'string' && typeof c.op === 'string');
      const t = v.filtres?.tri_champ ? JSON.parse(v.filtres.tri_champ) : null;
      if (t && typeof t.field_id === 'string' && (t.sens === 'asc' || t.sens === 'desc')) triC = t;
    } catch (err) {
      console.error('[PipelineBoard] vue enregistrée : champs personnalisés illisibles', err);
    }
    setConditionsChamps(conds);
    setTriChamp(triC);
    setFiltreEtiquettes(etiquettesDepuisVue(v.filtres));
    if (v.tri && (TRIS as readonly string[]).includes(v.tri)) setTri(v.tri as Tri);
    if (v.affichage === 'kanban' || v.affichage === 'liste') setAffichage(v.affichage);
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

  /**
   * Ce pipeline n'a AUCUN deal, alors qu'un autre pipeline existe.
   *
   * Le board affichait alors des colonnes vides, sans un mot. On croyait
   * ses deals perdus — alors qu'ils vivaient simplement dans un autre
   * pipeline, celui qu'on ne regardait pas. Le navigateur mémorise le
   * dernier pipeline consulté : ouvrir un pipeline de test une seule fois
   * suffisait à vider le board pour de bon.
   */
  const pipelineVide = deals.length === 0 && !chargement && pipelines.length > 1;

  /**
   * Le board est vide ET l'utilisateur appartient à PLUSIEURS bureaux.
   *
   * Chaque bureau ne voit que ses propres deals — c'est l'isolation qui
   * empêche les clients d'un bureau d'apparaître dans l'autre, et elle doit
   * rester ainsi. Mais rien ne le DISAIT : on tombait sur « 0 deal », un
   * board vide, et on concluait que l'app était cassée, alors que les deals
   * étaient simplement dans l'autre bureau.
   *
   * On ne peut pas annoncer combien de deals s'y trouvent : la RLS ne les
   * laisse pas lire depuis ici, et c'est très bien ainsi. On nomme donc le
   * bureau affiché et on offre de basculer — le compte s'affichera une fois
   * de l'autre côté.
   */
  const autresBureaux = companies.filter((c) => c.orgId !== currentOrgId);
  const bureauVide = deals.length === 0 && !chargement && autresBureaux.length > 0;
  const nomBureau = companies.find((c) => c.orgId === currentOrgId)?.companyName ?? null;

  return (
    <div>
      {/* Aucun deal ici, et l'utilisateur appartient à d'autres bureaux.
          Une BANNIÈRE, pas un écran de remplacement : le board reste entier
          — colonnes, « Nouveau deal », filtres, import. Un bureau neuf est
          vide par définition, et on doit pouvoir y travailler tout de suite ;
          masquer le pipeline pour annoncer qu'il est vide empêchait justement
          de le remplir. */}
      {bureauVide && (
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-outline bg-surface-secondary px-3.5 py-2.5">
          <span className="text-[12px] text-text-secondary">
            {nomBureau
              ? (fr ? `Aucun deal dans « ${nomBureau} ».` : `No deal in “${nomBureau}”.`)
              : (fr ? 'Aucun deal dans ce bureau.' : 'No deal in this office.')}
          </span>
          <span className="text-[12px] text-text-tertiary">
            {fr ? 'Chaque bureau a les siens —' : 'Each office keeps its own —'}
          </span>
          {autresBureaux.slice(0, 3).map((c) => (
            <button
              key={c.orgId}
              type="button"
              onClick={() => switchCompany(c.orgId)}
              className="text-[12px] font-semibold text-text-primary underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary rounded"
            >
              {c.companyName ?? (fr ? 'autre bureau' : 'other office')}
            </button>
          ))}
        </div>
      )}

      <BarreOutils
        fr={fr}
        total={filtres_.length}
        filtres={filtres}
        sources={sources}
        membres={membres}
        panneauOuvert={panneauOuvert}
        tri={tri}
        affichage={affichage}
        pipelines={pipelines}
        pipelineActif={pipelineActif}
        onChangerPipeline={onChangerPipeline}
        onCreerPipeline={onCreerPipeline}
        etapesFiltrables={visibles}
        onFiltres={(f) => {
          setFiltres(f);
          // « Effacer les filtres » efface aussi les conditions de champs.
          if (f === FILTRES_VIDES) { setConditionsChamps([]); setTriChamp(null); setFiltreEtiquettes(FILTRE_ETIQUETTES_VIDE); }
        }}
        nbFiltresExtra={nbFiltresActifs - Object.values(filtres).filter((v) => v !== '').length}
        onBasculerPanneau={() => setPanneauOuvert((o) => !o)}
        onTri={() => setTri(TRIS[(TRIS.indexOf(tri) + 1) % TRIS.length])}
        onAffichage={setAffichage}
        onNouveauDeal={() => setNouveauDeal(true)}
        extraPanneau={(
          <>
            <PanneauFiltreEtiquettes valeur={filtreEtiquettes} onChange={setFiltreEtiquettes} fr={fr} />
            {champsPipeline.actif ? (
              <PanneauChamps champs={champsPipeline.champsDeal} conditions={conditionsChamps} onConditions={setConditionsChamps}
                tri={triChamp} onTri={setTriChamp} fr={fr} enCours={filtreChamps.enCours} />
            ) : null}
          </>
        )}
      />

      <ModalNouveauDeal
        ouvert={nouveauDeal}
        fr={fr}
        membres={membres}
        pipelines={pipelines}
        pipelineActif={pipelineActif}
        onFermer={() => setNouveauDeal(false)}
        onCree={(pipelineOuCree) => {
          // Le pipeline se CHOISIT dans le formulaire. Si le deal a atterri
          // ailleurs que sur le board affiché (autre choix, ou pipeline sans
          // étape ouverte), on bascule dessus plutôt que de laisser croire
          // que rien ne s'est passé.
          if (pipelineOuCree && pipelineActif && pipelineOuCree !== pipelineActif) {
            const nom = pipelines.find((p) => p.id === pipelineOuCree)?.name;
            toast.info(fr
              ? `Deal créé dans « ${nom ?? 'un autre pipeline'} » — on t'y amène.`
              : `Deal created in “${nom ?? 'another pipeline'}” — taking you there.`);
            onChangerPipeline(pipelineOuCree);
          }
          onChangement?.();
        }}
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

        {/* Les vues enregistrées en base, à la suite des intégrées. */}
        {vuesEnregistrees.map((v) => (
          <span key={v.id} className="group inline-flex items-center">
            <button
              type="button"
              role="tab"
              aria-selected={vue === v.id}
              onClick={() => appliquerVueEnregistree(v)}
              className={cn(
                'whitespace-nowrap rounded-full border py-1.5 pl-3 pr-2 text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary',
                vue === v.id
                  ? 'border-outline-strong bg-surface-tertiary font-semibold text-text-primary'
                  : 'border-outline font-medium text-text-tertiary hover:bg-surface-secondary hover:text-text-primary',
              )}
            >
              {v.nom}
              {/* Une vue d'équipe se distingue d'une vue perso : sinon on ne
                  sait pas pourquoi on n'arrive pas à la supprimer. */}
              {v.user_id === null && (
                <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  {fr ? 'équipe' : 'team'}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => { void supprimer(v); }}
              aria-label={fr ? `Supprimer la vue ${v.nom}` : `Delete view ${v.nom}`}
              className="-ml-1 rounded-full p-1 text-text-muted opacity-0 transition-opacity hover:text-text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary group-hover:opacity-100"
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}

        {/* Enregistrer les filtres courants. Désactivé quand il n'y a rien à
            enregistrer : une vue « aucun filtre » ne sert à rien. */}
        <button
          type="button"
          onClick={() => setEnregistrementVue(true)}
          disabled={nbFiltresActifs === 0}
          title={nbFiltresActifs === 0 ? (fr ? 'Applique des filtres à enregistrer' : 'Apply filters to save') : undefined}
          className="whitespace-nowrap rounded-full border border-dashed border-outline px-3 py-1.5 text-[12.5px] font-medium text-text-tertiary hover:bg-surface-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary disabled:cursor-not-allowed disabled:opacity-45"
        >
          {fr ? '+ Enregistrer la vue' : '+ Save view'}
        </button>
      </div>

      <ModalEnregistrerVue
        ouvert={enregistrementVue}
        fr={fr}
        estPatron={estPatron}
        onFermer={() => setEnregistrementVue(false)}
        onEnregistrer={enregistrerVue}
      />

      {/*
        Les actions groupées n'apparaissent QUE quand quelque chose est coché :
        une barre toujours présente prendrait de la place pour un geste rare.
      */}
      {selection.size > 0 && (
        <div
          role="status"
          className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-outline-strong bg-surface-elevated px-3.5 py-2.5"
        >
          <span className="text-[12.5px] font-semibold text-text-primary">
            {fr
              ? `${selection.size} deal${selection.size > 1 ? 's' : ''} sélectionné${selection.size > 1 ? 's' : ''}`
              : `${selection.size} deal${selection.size > 1 ? 's' : ''} selected`}
          </span>

          <label htmlFor={idLotAssigne} className="sr-only">
            {fr ? 'Assigner la sélection à' : 'Assign selection to'}
          </label>
          <select
            id={idLotAssigne}
            value=""
            onChange={(e) => { if (e.target.value) void assignerEnLot(e.target.value); }}
            className={CLASSE_CHAMP + ' max-w-[190px]'}
          >
            <option value="">{fr ? 'Assigner à…' : 'Assign to…'}</option>
            <option value="__non">{fr ? 'Personne' : 'Nobody'}</option>
            {membres.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>

          <label htmlFor={idLotEtape} className="sr-only">
            {fr ? 'Déplacer la sélection vers' : 'Move selection to'}
          </label>
          <select
            id={idLotEtape}
            value=""
            onChange={(e) => { if (e.target.value) void deplacerEnLot(e.target.value); }}
            className={CLASSE_CHAMP + ' max-w-[190px]'}
          >
            <option value="">{fr ? 'Déplacer vers…' : 'Move to…'}</option>
            {visibles.filter((e) => e.kind === 'open').map((e) => (
              <option key={e.id} value={e.id}>{fr ? e.name_fr : e.name_en}</option>
            ))}
            {/*
              « Gagné » et « Perdu » apparaissent, mais DÉSACTIVÉS et avec la
              raison écrite : gagner demande de créer une job, perdre demande
              un motif. Les omettre silencieusement laissait chercher une
              option absente sans jamais comprendre pourquoi — on préfère
              montrer la règle plutôt que cacher la porte.
            */}
            {visibles.filter((e) => e.kind !== 'open').map((e) => (
              <option key={e.id} value={e.id} disabled>
                {(fr ? e.name_fr : e.name_en)}
                {e.kind === 'won'
                  ? (fr ? ' — un par un (job à créer)' : ' — one by one (job needed)')
                  : (fr ? ' — un par un (raison requise)' : ' — one by one (reason needed)')}
              </option>
            ))}
          </select>

          {autresPipelines.length > 0 && (
            <button type="button" onClick={() => setChangerPipeline(true)} className={CLASSE_BOUTON}>
              <ArrowRightLeft size={13} aria-hidden="true" />
              {fr ? 'Autre pipeline…' : 'Other pipeline…'}
            </button>
          )}
          <ModalChangerPipeline
            ouvert={changerPipeline}
            fr={fr}
            dealIds={[...selection]}
            pipelines={autresPipelines}
            onFermer={() => setChangerPipeline(false)}
            onDeplace={() => { setChangerPipeline(false); setSelection(new Set()); onChangement?.(); }}
          />

          <button type="button" onClick={() => setLotEtiquette('ajouter')} className={CLASSE_BOUTON}>
            <Tag size={13} aria-hidden="true" />
            {fr ? 'Ajouter une étiquette' : 'Add a tag'}
          </button>
          <button type="button" onClick={() => setLotEtiquette('retirer')} className={CLASSE_BOUTON}>
            <Tag size={13} aria-hidden="true" />
            {fr ? 'Retirer une étiquette' : 'Remove a tag'}
          </button>

          <button
            type="button"
            onClick={() => setSelection(new Set())}
            className="ml-auto text-[12px] text-text-tertiary underline-offset-2 hover:text-text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary rounded"
          >
            {fr ? 'Tout décocher' : 'Clear selection'}
          </button>
        </div>
      )}

      <ModalEtiquettesLot
        action={lotEtiquette}
        fr={fr}
        nbDeals={selection.size}
        nbSansClient={lotEtiquette ? deals.filter((d) => selection.has(d.id) && !d.client_id).length : 0}
        clientIds={lotEtiquette ? clientsDistincts(deals, selection) : []}
        onFermer={() => setLotEtiquette(null)}
        onTermine={() => {
          setLotEtiquette(null);
          setSelection(new Set());
          void qc.invalidateQueries({ queryKey: [CLE_ETIQUETTES_CLIENTS] });
          void qc.invalidateQueries({ queryKey: ['etiquettes'] });
        }}
      />

      {chargement && (
        <p className="mt-2 text-[11px] text-text-muted" role="status">
          {fr ? 'Chargement…' : 'Loading…'}
        </p>
      )}

      {pipelineVide ? (
        <div className="flex flex-col items-center gap-2 px-5 py-14 text-center">
          <p className="mt-1.5 text-[15px] font-semibold text-text-primary">
            {fr ? 'Ce pipeline est vide' : 'This pipeline is empty'}
          </p>
          <p className="max-w-[44ch] text-[12.5px] leading-relaxed text-text-tertiary">
            {fr
              ? 'Tes deals sont peut-être dans un autre pipeline — le board rouvre toujours le dernier que tu as consulté.'
              : 'Your deals may sit in another pipeline — the board always reopens the last one you viewed.'}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {/*
              Le pipeline par défaut d'abord : c'est là que tous les nouveaux
              deals atterrissent, donc le premier endroit où regarder.
            */}
            {pipelines
              .filter((p) => p.id !== pipelineActif)
              .slice(0, 3)
              .map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onChangerPipeline(p.id)}
                  className={CLASSE_BOUTON}
                >
                  {fr ? `Voir « ${p.name} »` : `View “${p.name}”`}
                  {p.is_default && (
                    <span className="ml-1 text-[10.5px] text-text-muted">
                      {fr ? '(par défaut)' : '(default)'}
                    </span>
                  )}
                </button>
              ))}
          </div>
        </div>
      ) : filtreTropSerre ? (
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
                setConditionsChamps([]);
                setTriChamp(null);
                setFiltreEtiquettes(FILTRE_ETIQUETTES_VIDE);
                setVue('tous');
              }}
              className={cn(CLASSE_BOUTON, 'font-semibold')}
              style={{ background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: 'var(--color-primary-foreground)' }}
            >
              {fr ? 'Effacer les filtres' : 'Clear filters'}
            </button>
          </div>
        </div>
      ) : affichage === 'liste' ? (
        <ListeDeals
          fr={fr}
          deals={filtres_}
          etapes={etapes}
          montants={montants}
          membres={membres}
          maintenant={maintenant}
          valeurs={champsPipeline.valeurs}
          triChamp={triChamp}
          onTriChamp={setTriChamp}
          onOuvrir={onOuvrir}
          etiquettesClients={etiquettesClients}
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={(e: DragStartEvent) => setActif(deals.find((d) => d.id === e.active.id) ?? null)}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActif(null)}
        >
          <div className="mt-4 flex gap-3 overflow-x-auto pb-4">
            {colonnes.map((etape) => (
              <Colonne
                key={etape.id}
                etape={etape}
                etapes={etapes}
                rangOuvert={rangs[etape.id] ?? 0}
                deals={parEtape[etape.id] ?? []}
                membres={membres}
                montants={montants}
                onOuvrir={onOuvrir}
                onAssigner={onAssigner}
                onChangement={onChangement}
                selection={selection}
                onBasculerSelection={basculerSelection}
                modeCouleur={modeCouleur}
                etiquettesClients={etiquettesClients}
                extraCarte={champsPipeline.champsCarte.length ? (d) => (
                  <ChampsSurCarte champs={champsPipeline.champsCarte} valeurs={champsPipeline.valeurs[d.id]} fr={fr} />
                ) : undefined}
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
