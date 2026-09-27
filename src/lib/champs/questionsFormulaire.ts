/**
 * Un champ personnalisé ↔ une question du formulaire de demande.
 *
 * Partagé par l'interface (panneau « Ajouter des champs personnalisés ») et par
 * le serveur (le formulaire suit les champs tout seul) : une seule définition,
 * sinon les deux finissent par diverger et la question cesse de remplir le champ.
 */
import type { ChampPerso } from './types';

/** Les sections du formulaire qui acceptent des questions. */
export type SectionFormulaire = 'service_details' | 'final_notes';

export interface QuestionChamp {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
  section: SectionFormulaire;
  cf_field_id: string;
}

/** Type de question du formulaire pour un type de champ personnalisé. */
export function typeQuestion(c: Pick<ChampPerso, 'field_type'>): string {
  switch (c.field_type) {
    case 'multi_line': return 'paragraph';
    case 'number':
    case 'monetary': return 'number';
    case 'dropdown_single': return 'dropdown';
    case 'dropdown_multi': return 'checkbox';
    // Case à cocher : une question Oui / Non (liste), relue en booléen à la réception.
    case 'checkbox': return 'dropdown';
    default: return 'text';
  }
}

/** Les options que la question propose, d'après le champ. */
export function optionsQuestion(c: ChampPerso): string[] {
  if (c.field_type === 'dropdown_single' || c.field_type === 'dropdown_multi') {
    return (c.options ?? []).filter((o) => !o.archived_at).map((o) => o.label);
  }
  return c.field_type === 'checkbox' ? ['Oui', 'Non'] : [];
}

/** La question créée pour un champ : même libellé, options, obligatoire, et reliée au champ. */
export function questionPour(c: ChampPerso, section: SectionFormulaire, id: string): QuestionChamp {
  return {
    id,
    label: c.label,
    type: typeQuestion(c),
    required: !!c.is_required,
    options: optionsQuestion(c),
    section,
    cf_field_id: c.id,
  };
}

/**
 * Un champ qui a sa place sur un formulaire public.
 *
 * Le formulaire crée une demande, un client et une carte de pipeline : les
 * champs d'une job, d'un devis, d'une facture ou d'une propriété n'ont rien à
 * remplir à ce moment-là. Et « Fichier » ne se téléverse pas depuis le
 * formulaire public.
 */
export function peutAllerAuFormulaire(c: Pick<ChampPerso, 'object_type' | 'field_type'>): boolean {
  return (c.object_type === 'client' || c.object_type === 'deal') && c.field_type !== 'file';
}
