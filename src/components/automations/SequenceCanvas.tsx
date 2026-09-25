/* ═══════════════════════════════════════════════════════════════
   Le canevas d'une séquence

   Des cartes reliées, de haut en bas, avec des branches quand il y a un
   « si ». C'est la vue que GoHighLevel donne de ses workflows, ramenée à ce
   qui sert vraiment : voir le parcours d'un coup d'œil et cliquer une étape
   pour la modifier.

   ── Pourquoi pas React Flow ────────────────────────────────────
   Un canevas infini avec zoom, minimap et nœuds déplaçables à la souris,
   c'est 60 à 100 ko de dépendance pour un graphe qui compte cinq étapes et
   se lit de haut en bas. On dessine donc les connecteurs en SVG et on
   empile les cartes en CSS : le rendu est le même, le poids est nul, et
   rien à maintenir quand la bibliothèque change d'API.

   ── Ce que la disposition raconte ──────────────────────────────
   Une séquence se lit verticalement. Un « si » ouvre DEUX colonnes — la
   branche « alors » à gauche, « sinon » à droite — parce que c'est là, et
   nulle part ailleurs, que le parcours se divise. Une étape sans suite
   porte un point d'arrêt : on voit tout de suite où la séquence s'achève.
   ═══════════════════════════════════════════════════════════════ */

import React from 'react';
import {
  Zap, Pencil, Clock, GitBranch, Send, Bell, CheckSquare, Star, Square, Plus, MoreHorizontal,
  Mail, Hash, Tag, TagsIcon, UserCog, UserPlus, StickyNote, CalendarCheck, TrendingUp,
  Target, FileText, Receipt, Webhook, CircleSlash,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Etape } from '../../lib/sequenceTypes';
import { trouverAction } from '../../lib/automationCatalogue';

interface Props {
  /** Le déclencheur, affiché en tête — il n'est pas une étape. */
  declencheurLabel: string;
  steps: Etape[];
  fr: boolean;
  /** Étape sélectionnée, mise en évidence. */
  selectionId?: string | null;
  onSelection: (id: string) => void;
  /** Ajouter une étape après celle-ci (ou sur une branche donnée). */
  onAjouter: (apresId: string | null, branche?: 'alors' | 'sinon') => void;
  /** Le menu « … » d'une carte — dupliquer, supprimer, supprimer la suite. */
  onMenu?: (id: string) => void;
  /**
   * Cliquer la carte du DÉCLENCHEUR pour en changer.
   *
   * Sans ça, le tiroir des déclencheurs n'était atteignable que sur un
   * canevas VIDE : dès la première étape ajoutée, plus aucun moyen de
   * changer ce qui met le parcours en route.
   */
  onDeclencheur?: () => void;
  /**
   * Les réglages du déclencheur, en clair sous son nom.
   *
   * GHL affiche « Event type is "Normal" » sous la carte : on voit ce que
   * la règle écoute vraiment sans ouvrir quoi que ce soit. Vide = rien à
   * régler pour ce déclencheur.
   */
  declencheurDetail?: string | null;
  /** Lecture seule : aucun bouton d'édition (aperçu d'un préréglage). */
  lectureSeule?: boolean;
}

const ICONES: Record<string, React.ComponentType<{ className?: string }>> = {
  send_sms: Send,
  send_email: Mail,
  create_notification: Bell,
  create_task: CheckSquare,
  request_review: Star,
  envoyer_slack: Hash,
  ajouter_etiquette: Tag,
  retirer_etiquette: TagsIcon,
  modifier_client: UserCog,
  assigner_responsable: UserPlus,
  ajouter_note: StickyNote,
  modifier_statut_rendezvous: CalendarCheck,
  move_deal_stage: TrendingUp,
  modifier_deal: Target,
  assigner_deal: UserPlus,
  envoyer_facture: Receipt,
  envoyer_soumission: FileText,
  webhook: Webhook,
  arreter_automatisation: CircleSlash,
};

/** Le titre d'une étape, en mots du métier. */
function titreEtape(etape: Etape, fr: boolean): string {
  switch (etape.type) {
    case 'action': {
      // Le nom DONNÉ par l'utilisateur prime sur le nom générique de
      // l'action : c'est ce qui distingue « Courriel de confirmation » de
      // « Courriel de rappel » quand un parcours en contient trois.
      const surnom = etape.nom?.trim();
      if (surnom) return surnom;
      const modele = trouverAction(etape.action?.type ?? '');
      if (modele) return fr ? modele.fr : modele.en;
      return 'Action';
    }
    case 'attendre':
      return fr ? 'Attendre' : 'Wait';
    case 'si':
      return fr ? 'Si…' : 'If…';
    case 'arreter':
      return fr ? 'Arrêter ici' : 'Stop here';
  }
}

/** Le détail d'une étape, en une ligne — ce qu'on veut lire sans ouvrir. */
function detailEtape(etape: Etape, fr: boolean): string {
  if (etape.type === 'attendre') {
    const s = etape.delai_secondes || 0;
    if (s === 0) return fr ? 'tout de suite' : 'right away';
    if (s % 86400 === 0) return `${s / 86400} ${fr ? 'jour(s)' : 'day(s)'}`;
    if (s % 3600 === 0) return `${s / 3600} ${fr ? 'heure(s)' : 'hour(s)'}`;
    return `${Math.round(s / 60)} ${fr ? 'minute(s)' : 'minute(s)'}`;
  }
  if (etape.type === 'action') {
    const texte = String(etape.action?.config?.body ?? etape.action?.config?.title ?? '');
    return texte.length > 60 ? `${texte.slice(0, 60)}…` : texte;
  }
  if (etape.type === 'si') {
    const n = Object.keys(etape.conditions ?? {}).length;
    return fr ? `${n} condition(s)` : `${n} condition(s)`;
  }
  return '';
}

/** Le connecteur vertical entre deux cartes, avec son « + ». */
function Connecteur({
  onAjouter, fr, libelle, lectureSeule,
}: { onAjouter: () => void; fr: boolean; libelle?: string; lectureSeule?: boolean }) {
  return (
    <div className="flex flex-col items-center py-1" aria-hidden={!libelle}>
      {libelle && (
        <span className="mb-1 rounded-full bg-surface-tertiary px-2 py-0.5 text-[10px] font-medium text-text-secondary">
          {libelle}
        </span>
      )}
      <svg width="2" height="14" className="text-border" aria-hidden="true">
        <line x1="1" y1="0" x2="1" y2="14" stroke="currentColor" strokeWidth="2" />
      </svg>
      {!lectureSeule && (
        <button
          type="button"
          onClick={onAjouter}
          aria-label={fr ? 'Ajouter une étape ici' : 'Add a step here'}
          className="my-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface-primary text-text-tertiary transition-colors hover:border-accent hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
      <svg width="2" height="14" className="text-border" aria-hidden="true">
        <line x1="1" y1="0" x2="1" y2="14" stroke="currentColor" strokeWidth="2" />
      </svg>
    </div>
  );
}

/** Une carte d'étape. */
function Carte({
  etape, fr, selectionnee, onClick, onMenu, lectureSeule,
}: {
  etape: Etape; fr: boolean; selectionnee: boolean;
  onClick: () => void;
  /** Le menu « … » de la carte — dupliquer, supprimer. */
  onMenu?: (id: string) => void;
  lectureSeule?: boolean;
}) {
  const Icone =
    etape.type === 'attendre' ? Clock
    : etape.type === 'si' ? GitBranch
    : etape.type === 'arreter' ? Square
    : ICONES[etape.action?.type] ?? Send;

  const detail = detailEtape(etape, fr);

  // Un `div` plutot qu'un `button` : la carte porte un second bouton (le
  // menu « … »), et un bouton dans un bouton est du HTML invalide que les
  // navigateurs reparent en supprimant l'imbrication — le menu disparaitrait.
  return (
    <div
      className={cn(
        'relative w-[260px] rounded-xl border bg-surface-primary transition-all',
        selectionnee ? 'border-accent shadow-md' : 'border-border hover:border-text-tertiary',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-current={selectionnee ? 'step' : undefined}
        className="w-full rounded-xl p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
            etape.type === 'si' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
            : etape.type === 'attendre' ? 'bg-surface-tertiary text-text-secondary'
            : etape.type === 'arreter' ? 'bg-surface-tertiary text-text-tertiary'
            : 'bg-accent/10 text-accent',
          )}
        >
          <Icone className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-text-primary">{titreEtape(etape, fr)}</span>
          {detail && <span className="mt-0.5 block truncate text-xs text-text-secondary">{detail}</span>}
        </span>
        {/* La place du menu « … », pour que le texte ne passe pas dessous. */}
        {!lectureSeule && onMenu && <span className="w-4 shrink-0" aria-hidden="true" />}
      </div>
      </button>

      {/* Le menu de la carte, comme le « … » de GoHighLevel. */}
      {!lectureSeule && onMenu && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onMenu(etape.id); }}
          aria-label={fr ? `Options de l’étape ${titreEtape(etape, fr)}` : `Options for ${titreEtape(etape, fr)}`}
          className="absolute right-2 top-2.5 rounded-md p-1 text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default function SequenceCanvas({
  declencheurLabel, steps, fr, selectionId, onSelection, onAjouter, onMenu, onDeclencheur,
  declencheurDetail, lectureSeule,
}: Props) {
  const parId = new Map(steps.map((e) => [e.id, e]));

  /**
   * Rend une chaîne d'étapes à partir d'un identifiant.
   *
   * `vues` protège l'affichage d'une boucle. La validation serveur refuse
   * déjà les cycles, mais le canevas doit aussi tenir sur un brouillon en
   * cours d'édition — celui qu'on est en train de câbler, avant
   * enregistrement, peut passer par un état momentanément circulaire. Un
   * rendu récursif sans garde ferait planter l'onglet.
   */
  const rendre = (id: string | null | undefined, vues: Set<string>): React.ReactNode => {
    if (!id) return null;
    const etape = parId.get(id);
    if (!etape) return null;
    if (vues.has(id)) {
      return (
        <p className="w-[260px] rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {fr ? 'Le parcours revient ici : à corriger avant d’enregistrer.' : 'The path loops back here: fix before saving.'}
        </p>
      );
    }
    const suite = new Set(vues).add(id);

    if (etape.type === 'si') {
      return (
        <div className="flex flex-col items-center">
          <Carte etape={etape} fr={fr} selectionnee={selectionId === etape.id} onClick={() => onSelection(etape.id)} onMenu={onMenu} lectureSeule={lectureSeule} />
          {/* Deux branches, côte à côte : c'est le seul endroit où le
              parcours se divise, et ça doit se voir. */}
          <div className="flex items-start gap-6 pt-1">
            <div className="flex flex-col items-center">
              <Connecteur fr={fr} libelle={fr ? 'si oui' : 'if yes'} lectureSeule={lectureSeule} onAjouter={() => onAjouter(etape.id, 'alors')} />
              {rendre(etape.alors, suite) ?? <FinDeBranche fr={fr} />}
            </div>
            <div className="flex flex-col items-center">
              <Connecteur fr={fr} libelle={fr ? 'si non' : 'if no'} lectureSeule={lectureSeule} onAjouter={() => onAjouter(etape.id, 'sinon')} />
              {rendre(etape.sinon, suite) ?? <FinDeBranche fr={fr} />}
            </div>
          </div>
        </div>
      );
    }

    const suivant = etape.type === 'arreter' ? null : etape.suivant;
    return (
      <div className="flex flex-col items-center">
        <Carte etape={etape} fr={fr} selectionnee={selectionId === etape.id} onClick={() => onSelection(etape.id)} onMenu={onMenu} lectureSeule={lectureSeule} />
        {etape.type !== 'arreter' && (
          <>
            <Connecteur fr={fr} lectureSeule={lectureSeule} onAjouter={() => onAjouter(etape.id)} />
            {rendre(suivant, suite) ?? <FinDeBranche fr={fr} />}
          </>
        )}
      </div>
    );
  };

  const depart = steps[0];

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-fit flex-col items-center px-4 py-2">
        {/* Le déclencheur : point de départ, jamais une étape.
            Cliquable — c'est le chemin pour en changer une fois le parcours
            commencé. */}
        {/*
            La carte « Quand » reste cliquable MÊME en lecture seule : le
            déclencheur et ses réglages (quelle étape de pipeline, quelle
            date) ne font pas partie du parcours figé — ils se changent sur
            une règle au format d'origine comme sur une autre. Seules les
            ÉTAPES sont gelées.
        */}
        {onDeclencheur ? (
          <button
            type="button"
            onClick={onDeclencheur}
            className="w-[260px] rounded-xl border-2 border-accent/40 bg-accent/5 p-3 text-left transition-colors hover:border-accent hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                <Zap className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-accent">
                  {fr ? 'Quand' : 'When'}
                </span>
                <span className="block truncate text-sm font-medium text-text-primary">{declencheurLabel}</span>
                {declencheurDetail && (
                  <span className="mt-0.5 block truncate text-[11px] text-text-secondary">{declencheurDetail}</span>
                )}
              </span>
              <Pencil className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
            </div>
          </button>
        ) : (
          <div className="w-[260px] rounded-xl border-2 border-accent/40 bg-accent/5 p-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-accent">
                <Zap className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-accent">
                  {fr ? 'Quand' : 'When'}
                </span>
                <span className="block truncate text-sm font-medium text-text-primary">{declencheurLabel}</span>
                {declencheurDetail && (
                  <span className="mt-0.5 block truncate text-[11px] text-text-secondary">{declencheurDetail}</span>
                )}
              </span>
            </div>
          </div>
        )}

        {depart ? (
          <>
            <Connecteur fr={fr} lectureSeule={lectureSeule} onAjouter={() => onAjouter(null)} />
            {rendre(depart.id, new Set())}
          </>
        ) : (
          <>
            <Connecteur fr={fr} lectureSeule={lectureSeule} onAjouter={() => onAjouter(null)} />
            <p className="w-[260px] rounded-xl border border-dashed border-border p-4 text-center text-xs text-text-secondary">
              {fr ? 'Aucune étape. Cliquez sur « + » pour commencer.' : 'No steps yet. Click “+” to start.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** Le point final d'une branche — on voit où ça s'arrête. */
function FinDeBranche({ fr }: { fr: boolean }) {
  return (
    <span className="rounded-full bg-surface-tertiary px-2.5 py-1 text-[10px] text-text-tertiary">
      {fr ? 'fin' : 'end'}
    </span>
  );
}
