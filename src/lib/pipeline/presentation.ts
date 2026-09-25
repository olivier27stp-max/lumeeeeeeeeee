/**
 * Pipeline de ventes — vocabulaire visuel et libellés partagés.
 *
 * Le board, le drawer et l'onglet Statistiques lisent tous d'ici : une étape
 * renommée dans les réglages ne doit changer QUE son nom, jamais une couleur,
 * une icône ou un comportement. C'est pour ça que rien n'est indexé par le nom
 * de l'étape — tout passe par `kind` (open/won/lost) et par la position.
 */
import { Award, Ban, Clock, FileText, Target, Users, type LucideIcon } from 'lucide-react';
import type { DealSource, MockStage, MockStageAction, StageKind } from './mockData';

/** Palette douce du kanban — dérivée de la position pour les étapes ouvertes. */
// Teintes de Lume (src/lib/d2d-pipeline-stages.ts) — les mêmes que le board
// existant, pour qu'un pipeline ne ressemble pas à une autre application.
const TEINTES_OUVERTES = ['#58A6FF', '#D29922', '#9CA3AF', '#06B6D4'] as const;
const TEINTE_GAGNE = '#3FB950';
const TEINTE_PERDU = '#F85149';

const ICONES_OUVERTES: readonly LucideIcon[] = [Target, Users, FileText, Clock];

export interface VisuelEtape {
  teinte: string;
  icone: LucideIcon;
  videFr: string;
  videEn: string;
}

/**
 * Visuel d'une étape, dérivé de son `kind` et de son rang parmi les étapes
 * ouvertes — jamais de son nom. Ajouter une 5e étape ouverte réutilise la
 * première teinte : le board reste lisible sans table à maintenir.
 */
export function visuelEtape(etape: MockStage, rangOuvert: number): VisuelEtape {
  if (etape.kind === 'won') {
    return {
      teinte: TEINTE_GAGNE,
      icone: Award,
      videFr: 'Les deals gagnés apparaîtront ici.',
      videEn: 'Won deals will appear here.',
    };
  }
  if (etape.kind === 'lost') {
    return {
      teinte: TEINTE_PERDU,
      icone: Ban,
      videFr: 'Les deals perdus apparaîtront ici.',
      videEn: 'Lost deals will appear here.',
    };
  }
  const i = rangOuvert % TEINTES_OUVERTES.length;
  return {
    teinte: TEINTES_OUVERTES[i],
    icone: ICONES_OUVERTES[i % ICONES_OUVERTES.length],
    videFr: 'Aucun deal à cette étape.',
    videEn: 'No deals at this stage.',
  };
}

/** Rang de chaque étape ouverte (pour la teinte), par ordre de position. */
export function rangsOuverts(etapes: MockStage[]): Record<string, number> {
  const out: Record<string, number> = {};
  let n = 0;
  for (const e of [...etapes].sort((a, b) => a.position - b.position)) {
    if (e.kind === 'open') out[e.id] = n++;
  }
  return out;
}

export const LIBELLE_KIND: Record<StageKind, { fr: string; en: string }> = {
  open: { fr: 'Ouverte', en: 'Open' },
  won: { fr: 'Gagné', en: 'Won' },
  lost: { fr: 'Perdu', en: 'Lost' },
};

export const LIBELLE_SOURCE: Record<DealSource, { fr: string; en: string }> = {
  form_web: { fr: 'Formulaire web', en: 'Web form' },
  meta: { fr: 'Meta', en: 'Meta' },
  manual: { fr: 'Manuel', en: 'Manual' },
  d2d: { fr: 'Porte-à-porte', en: 'Door-to-door' },
};

/**
 * Le nom lisible d'un canal d'acquisition.
 *
 * Cette fonction était recopiée dans trois composants, et l'onglet Prévisions
 * n'en avait aucune : il affichait `form_web` et `manual` bruts pendant
 * qu'Historique montrait « Formulaire web » et « Manuel », sur la même donnée
 * (QA 2026-09-24, P0-5).
 *
 * `deals.source` est du texte libre : une valeur inconnue est rendue telle
 * quelle plutôt que traduite au hasard — un canal imprévu doit rester
 * reconnaissable, pas devenir « Autre ».
 */
export function libelleSource(source: string, fr: boolean): string {
  const l = LIBELLE_SOURCE[source as DealSource];
  if (!l) return source;
  return fr ? l.fr : l.en;
}

export const LIBELLE_DECLENCHEUR: Record<MockStageAction['trigger'], { fr: string; en: string }> = {
  stage_entered: { fr: "À l'entrée dans l'étape", en: 'When the deal enters the stage' },
  stage_exited: { fr: "À la sortie de l'étape", en: 'When the deal leaves the stage' },
  stage_idle: { fr: 'Sans activité depuis', en: 'Inactive for' },
};

export const LIBELLE_ACTION: Record<MockStageAction['actionType'], { fr: string; en: string }> = {
  send_email: { fr: 'Envoyer un courriel', en: 'Send an email' },
  send_sms: { fr: 'Envoyer un SMS', en: 'Send a text' },
  create_task: { fr: 'Créer une tâche', en: 'Create a task' },
  create_notification: { fr: "Notifier l'équipe", en: 'Notify the team' },
};

/** « il y a 3 j » — court, pour les cartes. */
export function depuis(iso: string, maintenant: string, fr: boolean): string {
  const ms = new Date(maintenant).getTime() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return `${heures} h`;
  const jours = Math.floor(heures / 24);
  return fr ? `${jours} j` : `${jours}d`;
}

/** Montant en cents → « 1 250 $ ». Les cents sont la source de vérité. */
export function montant(cents: number | null, fr: boolean): string {
  if (cents === null) return '—';
  return new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** Initiales pour l'avatar d'un assigné. */
export function initiales(nom: string): string {
  return nom
    .split(/\s+/)
    .slice(0, 2)
    .map((m) => m[0] ?? '')
    .join('')
    .toUpperCase();
}
