import { supabase } from './supabase';

/** Ce qu'on peut transférer vers un autre bureau de la même entreprise. */
export type EntiteTransferable = 'client' | 'quote' | 'job';

export interface ResultatTransfert {
  entite: EntiteTransferable;
  /** L'élément COPIÉ dans le bureau cible (l'original est archivé). */
  id_cible: string;
  /** Son nouveau numéro, préfixe du bureau cible compris. */
  numero: string | null;
  /** Client : soumissions ouvertes et jobs non facturés emportés. */
  devis?: number;
  jobs?: number;
  origine_archivee?: boolean;
  /** Soumission : taxes du bureau cible, ou conservées s'il n'en a pas. */
  taxes?: 'bureau_cible' | 'conservees';
  visites?: number;
}

/**
 * Transfère un client, une soumission ou un job vers un autre bureau :
 * copie dans le bureau cible (nouveau numéro), original archivé, lien journalisé.
 * Règles et droits vérifiés en base (transferer_vers_bureau).
 */
export async function transfererVersBureau(entite: EntiteTransferable, id: string, orgCible: string): Promise<ResultatTransfert> {
  const { data, error } = await supabase.rpc('transferer_vers_bureau', {
    p_entite: entite,
    p_id: id,
    p_org_cible: orgCible,
  });
  if (error) throw new Error(error.message);
  return data as ResultatTransfert;
}
