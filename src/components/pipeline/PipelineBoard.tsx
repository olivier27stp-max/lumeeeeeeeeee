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
import { useCallback, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowUpDown, Download, Filter, GripVertical, LayoutGrid, List, Plus, Search, Upload, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { confirmer } from '../ui/ConfirmDialog';
import { usePermissions } from '../../hooks/usePermissions';
import ActionsRapides from './ActionsRapides';
import ImportCsvModal from './ImportCsvModal';
import {
  useChampsPipeline, useFiltreChamps, comparerParChamp, ChampsSurCarte, PanneauChamps, valeurCsv, type TriChamp,
} from '../champs/pipeline';
import type { Condition } from '../../lib/champs/filtres';
import Modal from '../ui/Modal';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import {
  creerDealManuel, creerVue, estJobACreer, fetchVues, journaliserLot, nomClient, pastilles, priorite, supprimerVue,
  type Deal, type ModeCouleur, type PipelineStage, type VueSauvegardee,
} from '../../lib/pipelineVentesApi';
import {
  initiales, rangsOuverts, visuelEtape, libelleSource,
} from '../../lib/pipeline/presentation';
import type { DealSource, MockStage } from '../../lib/pipeline/mockData';
import { useChampsCreation } from '../champs/creation';

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
  selectionne, onBasculerSelection, extra,
}: {
  /** Champs personnalisés choisis pour les cartes de ce pipeline. */
  extra?: ReactNode;
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
  const lesPastilles = pastilles(deal, etapes, montantCents ?? undefined);
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
        ) : null}

        <ActionsRapides
          deal={deal}
          membres={membres}
          onAssigner={onAssigner}
          onChangement={onChangement}
        />
      </div>

      {/*
        Les pastilles calculées. Elles remplacent l'ancien badge « Urgent /
        À relancer / Récent », qui ne disait qu'une chose : l'âge. « Jamais
        contacté » et « Non assigné » nomment un PROBLÈME et ce qu'il faut
        faire — c'est la différence entre décrire et servir.
        Deux au plus : une carte couverte de pastilles ne hiérarchise plus.
      */}
      {lesPastilles.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {lesPastilles.map((p) => (
            <span
              key={p.cle}
              className="whitespace-nowrap rounded-[5px] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
              style={{
                color: `var(--color-${p.ton})`,
                background: `color-mix(in srgb, var(--color-${p.ton}) 13%, transparent)`,
              }}
            >
              {fr ? p.fr : p.en}
            </span>
          ))}
        </div>
      )}

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
        ) : (
          <span className="text-[11px] font-semibold" style={{ color: 'var(--color-warning)' }}>
            {fr ? 'Non assigné' : 'Unassigned'}
          </span>
        )}
        <span className="ml-auto shrink-0 whitespace-nowrap rounded-[5px] bg-surface-tertiary px-1.5 py-0.5 text-[10px] text-text-tertiary">
          {libelleSource(deal.source, fr)}
        </span>
      </div>

      {extra}

      {deal.lost_reason && (
        <p className="mt-1 truncate text-[10px] text-text-muted">↳ {deal.lost_reason}</p>
      )}
    </div>
  );
}

// ── Colonne ──

function Colonne({
  etape, etapes, rangOuvert, deals, membres, montants, onOuvrir, onAssigner, onChangement,
  selection, onBasculerSelection, modeCouleur, extraCarte,
}: {
  /** Contenu ajouté au bas de chaque carte (champs personnalisés). */
  extraCarte?: (deal: Deal) => ReactNode;
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

// ── Export CSV ──

/**
 * Une valeur qui contient le séparateur, un guillemet ou un saut de ligne casse
 * le fichier si on la pose telle quelle : on l'entoure de guillemets et on
 * double les guillemets internes (RFC 4180).
 */
function champCsv(valeur: string): string {
  if (!/[";\r\n]/.test(valeur)) return valeur;
  return `"${valeur.replace(/"/g, '""')}"`;
}

/** « 2026-09-23 » — nom de fichier et colonnes de dates, sans ambiguïté de locale. */
function jourIso(d: Date): string {
  const mois = String(d.getMonth() + 1).padStart(2, '0');
  const jour = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mois}-${jour}`;
}

function telechargerCsv(lignes: string[][], nomFichier: string): void {
  const corps = lignes.map((l) => l.map(champCsv).join(';')).join('\r\n');
  // BOM UTF-8 : sans lui, Excel francophone lit les accents en Latin-1.
  const blob = new Blob([`﻿${corps}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nomFichier;
  document.body.appendChild(lien);
  lien.click();
  document.body.removeChild(lien);
  URL.revokeObjectURL(url);
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

/**
 * Petit formulaire de création. En cas d'erreur de la base, il reste ouvert
 * avec les valeurs saisies : retaper une adresse parce qu'un courriel était
 * déjà pris est la meilleure façon de perdre quelqu'un.
 */
function ModalNouveauDeal({ ouvert, fr, membres, onFermer, onCree }: {
  ouvert: boolean;
  fr: boolean;
  onFermer: () => void;
  /** Reçoit le pipeline où le deal a VRAIMENT atterri. */
  onCree: (pipelineId: string | null) => void;
  /** Pour proposer un responsable dès la création. */
  membres: Membre[];
}) {
  const [champs, setChamps] = useState<ChampsDeal>(champsDealVides);
  const [envoi, setEnvoi] = useState(false);
  const champsPerso = useChampsCreation('deal', fr);
  const idPrenom = useId();
  const idNom = useId();
  const idCourriel = useId();
  const idTelephone = useId();
  const idAdresse = useId();
  const idMontant = useId();
  const idAssigne = useId();
  const idDateVisee = useId();
  const idSource = useId();

  function fermer() {
    setChamps(champsDealVides());
    onFermer();
  }

  function vide(v: string): string | null {
    const t = v.trim();
    return t === '' ? null : t;
  }

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    const prenom = champs.prenom.trim();
    if (prenom === '') {
      toast.error(fr ? 'Le prénom est requis.' : 'First name is required.');
      return;
    }
    const erreurChamps = champsPerso.valider();
    if (erreurChamps) { toast.error(erreurChamps); return; }
    setEnvoi(true);
    try {
      // Saisi en dollars, envoyé en CENTS : les cents sont la source de
      // vérité dans tout Lume. Envoyer 1250 au lieu de 125000 afficherait
      // 12,50 $ sur la carte.
      const brut = Number(champs.montant.replace(',', '.').replace(/\s/g, ''));
      const cents = champs.montant.trim() !== '' && Number.isFinite(brut) && brut > 0
        ? Math.round(brut * 100)
        : null;

      const r = await creerDealManuel({
        prenom,
        nom: vide(champs.nom),
        courriel: vide(champs.courriel),
        telephone: vide(champs.telephone),
        adresse: vide(champs.adresse),
        montantCents: cents,
        assigneA: vide(champs.assigneA),
        dateFermetureVisee: vide(champs.dateVisee),
        source: vide(champs.source),
      });
      // Un deal DÉJÀ ouvert pour ce contact garde ses valeurs : on n'écrase pas.
      if (!r.dealExistant) await champsPerso.enregistrer(r.dealId);
      if (r.dealExistant) {
        toast.success(fr
          ? 'Ce contact avait déjà un deal ouvert : la demande y a été ajoutée.'
          : 'This contact already had an open deal: the request was added to it.');
      } else if (r.fusionne) {
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

  const champsTexte: { id: string; cle: keyof ChampsDeal; label: string; type: string; requis: boolean }[] = [
    { id: idPrenom, cle: 'prenom', label: fr ? 'Prénom' : 'First name', type: 'text', requis: true },
    { id: idNom, cle: 'nom', label: fr ? 'Nom' : 'Last name', type: 'text', requis: false },
    { id: idCourriel, cle: 'courriel', label: fr ? 'Courriel' : 'Email', type: 'email', requis: false },
    { id: idTelephone, cle: 'telephone', label: fr ? 'Téléphone' : 'Phone', type: 'tel', requis: false },
    { id: idAdresse, cle: 'adresse', label: fr ? 'Adresse' : 'Address', type: 'text', requis: false },
  ];

  return (
    <Modal
      open={ouvert}
      onClose={fermer}
      size="md"
      title={fr ? 'Nouveau deal' : 'New deal'}
      description={fr
        ? 'Le deal apparaîtra dans la première étape ouverte du pipeline.'
        : 'The deal will appear in the first open stage of the pipeline.'}
    >
      <form onSubmit={soumettre} className="flex flex-col gap-3">
        {champsTexte.map((c) => (
          <div key={c.id}>
            <label htmlFor={c.id} className="mb-1.5 block text-[11px] text-text-tertiary">
              {c.label}
              {c.requis && <span aria-hidden="true"> *</span>}
            </label>
            <input
              id={c.id}
              type={c.type}
              required={c.requis}
              value={champs[c.cle]}
              onChange={(e) => setChamps((v) => ({ ...v, [c.cle]: e.target.value }))}
              className={CLASSE_CHAMP}
            />
          </div>
        ))}

        {/*
          Ce qui fait vivre les prévisions. Rien n'est obligatoire : rendre le
          montant requis ferait saisir des chiffres inventés, et une prévision
          fausse se croit alors qu'une prévision vide se voit. Un champ laissé
          vide met simplement le deal dans « Corriger vos données ».
        */}
        <div className="mt-1 grid grid-cols-1 gap-3 border-t border-border-subtle pt-3 sm:grid-cols-2">
          <div>
            <label htmlFor={idMontant} className="mb-1.5 block text-[11px] text-text-tertiary">
              {fr ? 'Montant estimé ($)' : 'Estimated amount ($)'}
            </label>
            <input
              id={idMontant}
              type="text"
              inputMode="decimal"
              value={champs.montant}
              onChange={(e) => setChamps((v) => ({ ...v, montant: e.target.value }))}
              placeholder={fr ? 'Ex. : 1250' : 'e.g. 1250'}
              className={CLASSE_CHAMP}
            />
            <p className="mt-1 text-[10.5px] text-text-muted">
              {fr
                ? 'Devient une estimation modifiable, remplacée par la vraie soumission.'
                : 'Becomes an editable estimate, replaced by the real quote.'}
            </p>
          </div>

          <div>
            <label htmlFor={idDateVisee} className="mb-1.5 block text-[11px] text-text-tertiary">
              {fr ? 'Fermeture visée' : 'Expected close'}
            </label>
            <input
              id={idDateVisee}
              type="date"
              value={champs.dateVisee}
              onChange={(e) => setChamps((v) => ({ ...v, dateVisee: e.target.value }))}
              className={CLASSE_CHAMP}
            />
          </div>

          <div>
            <label htmlFor={idAssigne} className="mb-1.5 block text-[11px] text-text-tertiary">
              {fr ? 'Responsable' : 'Assignee'}
            </label>
            <select
              id={idAssigne}
              value={champs.assigneA}
              onChange={(e) => setChamps((v) => ({ ...v, assigneA: e.target.value }))}
              className={CLASSE_CHAMP}
            >
              <option value="">{fr ? 'Non assigné' : 'Unassigned'}</option>
              {membres.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={idSource} className="mb-1.5 block text-[11px] text-text-tertiary">
              {fr ? 'Source' : 'Source'}
            </label>
            <select
              id={idSource}
              value={champs.source}
              onChange={(e) => setChamps((v) => ({ ...v, source: e.target.value }))}
              className={CLASSE_CHAMP}
            >
              <option value="manual">{fr ? 'Saisie manuelle' : 'Manual entry'}</option>
              <option value="form_web">{fr ? 'Formulaire web' : 'Web form'}</option>
              <option value="meta">Meta</option>
              <option value="d2d">{fr ? 'Porte-à-porte' : 'Door to door'}</option>
            </select>
          </div>
        </div>

        {champsPerso.bloc}

        <div className="mt-1 flex items-center justify-end gap-2.5">
          <button type="button" onClick={fermer} className={CLASSE_BOUTON}>
            {fr ? 'Annuler' : 'Cancel'}
          </button>
          <button
            type="submit"
            disabled={envoi}
            className={cn(CLASSE_BOUTON, 'font-semibold text-white disabled:opacity-60')}
            style={{ background: 'var(--color-accent)', borderColor: 'var(--color-accent)' }}
          >
            {envoi ? (fr ? 'Création…' : 'Creating…') : (fr ? 'Créer le deal' : 'Create deal')}
          </button>
        </div>
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
  onFiltres, onBasculerPanneau, onTri, onAffichage, onExporter, onImporter, onNouveauDeal,
  extraPanneau,
}: {
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
  onExporter: () => void;
  onImporter: () => void;
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

  const nbFiltres = Object.values(filtres).filter((v) => v !== '').length;

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

          <button type="button" onClick={onExporter} className={CLASSE_BOUTON}>
            <Upload size={13} aria-hidden="true" />
            {fr ? 'Exporter' : 'Export'}
          </button>

          {/* Le symétrique de l'export : un CSV part, un CSV revient. */}
          <button type="button" onClick={onImporter} className={CLASSE_BOUTON}>
            <Download size={13} aria-hidden="true" />
            {fr ? 'Importer' : 'Import'}
          </button>

          <button
            type="button"
            onClick={onNouveauDeal}
            className={cn(CLASSE_BOUTON, 'font-semibold text-white')}
            style={{ background: 'var(--color-accent)', borderColor: 'var(--color-accent)' }}
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

export default function PipelineBoard({
  deals, etapes, montants, membres, chargement, onOuvrir, onDeplacer, onAssigner, onChangement,
  pipelines, pipelineActif, onChangerPipeline, modeCouleur = 'dot', onCreerPipeline,
}: {
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
  const [affichage, setAffichage] = useState<Affichage>('kanban');
  const [vue, setVue] = useState<VueEnregistree | string>('tous');
  const [nouveauDeal, setNouveauDeal] = useState(false);
  const [enregistrementVue, setEnregistrementVue] = useState(false);
  const [importOuvert, setImportOuvert] = useState(false);

  /**
   * Les deals cochés, pour agir sur plusieurs d'un coup.
   *
   * Un `Set` d'identifiants plutôt que des deals complets : la liste des
   * deals se rafraîchit sans cesse (déplacement, assignation), et garder des
   * objets figés afficherait des cartes périmées dans la barre d'actions.
   */
  const [selection, setSelection] = useState<Set<string>>(new Set());
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
  const nbFiltresActifs = useMemo(
    () => Object.values(filtres).filter((v) => v !== '').length,
    [filtres],
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
      if (q) {
        const c = d.client;
        // Le téléphone est cherché sans sa ponctuation : personne ne tape
        // « (514) 555-0199 » dans une barre de recherche.
        const tel = (c?.phone ?? '').replace(/\D/g, '');
        const foin = `${nomClient(d)} ${c?.email ?? ''} ${c?.address ?? ''} ${c?.company ?? ''} ${tel}`.toLowerCase();
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
    return triChamp ? tries.sort(comparerParChamp(triChamp, champsPipeline.valeurs)) : tries;
  }, [deals, etapes, filtres, montants, tri, filtreChamps.ids, triChamp, champsPipeline.valeurs]);

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
    if (v.tri && (TRIS as readonly string[]).includes(v.tri)) setTri(v.tri as Tri);
    if (v.affichage === 'kanban' || v.affichage === 'liste') setAffichage(v.affichage);
  }

  /** Exporte ce qui est à l'écran — les deals filtrés, pas la base entière. */
  function exporter() {
    // Courriel, téléphone et adresse SONT dans l'export : sans eux le fichier
    // ne peut pas être réimporté. L'import exige un moyen de joindre la
    // personne (c'est ce qui rapproche un contact déjà connu au lieu d'en
    // créer un double) — un export qui ne contient que le nom faisait donc
    // rejeter chaque ligne avec « ni courriel ni téléphone ».
    const entetes = fr
      ? ['Client', 'Courriel', 'Téléphone', 'Adresse', 'Étape', 'Montant', 'Source', 'Campagne', 'Assigné', 'Créé le', 'Dernière activité']
      : ['Client', 'Email', 'Phone', 'Address', 'Stage', 'Amount', 'Source', 'Campaign', 'Assignee', 'Created on', 'Last activity'];
    const lignes = filtres_.map((d) => {
      const etape = etapes.find((e) => e.id === d.stage_id);
      const cents = montants[d.id];
      const assigne = d.assigned_user_id
        ? membres.find((m) => m.id === d.assigned_user_id)?.name ?? ''
        : '';
      return [
        nomClient(d),
        d.client?.email ?? '',
        d.client?.phone ?? '',
        d.client?.address ?? '',
        etape ? (fr ? etape.name_fr : etape.name_en) : '',
        // Nombre brut : un « 4 990 $ » avec espace insécable ne s'additionne pas
        // dans un tableur. La virgule décimale suit la locale francophone.
        cents === undefined ? '' : (fr ? (cents / 100).toFixed(2).replace('.', ',') : (cents / 100).toFixed(2)),
        libelleSource(d.source, fr),
        d.utm_campaign ?? '',
        assigne,
        jourIso(new Date(d.created_at)),
        jourIso(new Date(d.last_activity_at)),
      ];
    });
    // Champs personnalisés (v2) : une colonne par champ d'opportunité, en fin
    // de ligne — l'import lit les colonnes par leur nom, rien ne se décale.
    const champsExport = champsPipeline.actif ? champsPipeline.champsDeal.filter((c) => !c.archived_at) : [];
    if (champsExport.length) {
      entetes.push(...champsExport.map((c) => c.label));
      filtres_.forEach((d, i) => {
        lignes[i].push(...champsExport.map((c) => valeurCsv(c, champsPipeline.valeurs[d.id]?.[c.id]?.value, fr)));
      });
    }
    telechargerCsv([entetes, ...lignes], `pipeline-${jourIso(new Date())}.csv`);
    toast.success(fr
      ? `${lignes.length} deal(s) exporté(s).`
      : `${lignes.length} deal(s) exported.`);
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
        pipelines={pipelines}
        pipelineActif={pipelineActif}
        onChangerPipeline={onChangerPipeline}
        onCreerPipeline={onCreerPipeline}
        etapesFiltrables={visibles}
        onFiltres={(f) => {
          setFiltres(f);
          // « Effacer les filtres » efface aussi les conditions de champs.
          if (f === FILTRES_VIDES) { setConditionsChamps([]); setTriChamp(null); }
        }}
        onBasculerPanneau={() => setPanneauOuvert((o) => !o)}
        onTri={() => setTri(TRIS[(TRIS.indexOf(tri) + 1) % TRIS.length])}
        onAffichage={setAffichage}
        onExporter={exporter}
        onImporter={() => setImportOuvert(true)}
        onNouveauDeal={() => setNouveauDeal(true)}
        extraPanneau={champsPipeline.actif ? (
          <PanneauChamps champs={champsPipeline.champsDeal} conditions={conditionsChamps} onConditions={setConditionsChamps}
            tri={triChamp} onTri={setTriChamp} fr={fr} enCours={filtreChamps.enCours} />
        ) : null}
      />

      <ImportCsvModal
        ouvert={importOuvert}
        onFermer={() => setImportOuvert(false)}
        onImporte={() => onChangement?.()}
      />

      <ModalNouveauDeal
        ouvert={nouveauDeal}
        fr={fr}
        membres={membres}
        onFermer={() => setNouveauDeal(false)}
        onCree={(pipelineOuCree) => {
          // Le deal atterrit dans le pipeline PAR DÉFAUT. Si on en regardait
          // un autre, le board resterait vide sans explication : on bascule
          // dessus plutôt que de laisser croire que rien ne s'est passé.
          if (pipelineOuCree && pipelineActif && pipelineOuCree !== pipelineActif) {
            toast.info(fr
              ? 'Le deal part dans le pipeline par défaut — on t\'y amène.'
              : 'New deals land in the default pipeline — taking you there.');
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

          <button
            type="button"
            onClick={() => setSelection(new Set())}
            className="ml-auto text-[12px] text-text-tertiary underline-offset-2 hover:text-text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary rounded"
          >
            {fr ? 'Tout décocher' : 'Clear selection'}
          </button>
        </div>
      )}

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
                setConditionsChamps([]);
                setTriChamp(null);
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
