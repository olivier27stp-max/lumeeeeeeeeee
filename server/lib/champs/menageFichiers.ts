/**
 * Ménage du bucket `custom-field-files`.
 *
 * Un fichier de champ est retiré du bucket dès qu'on le remplace ou qu'on
 * l'efface depuis une fiche (côté client). Restent les cas où personne n'a
 * l'occasion de le faire : une création de fiche abandonnée, une fiche
 * supprimée, un champ archivé puis purgé, un onglet fermé au mauvais moment.
 * Sans ménage, ces fichiers restent payants et indéfiniment stockés.
 *
 * Prudence volontaire — un faux positif ici efface le document d'un client :
 *   · on ne regarde que les fichiers de plus de 7 jours (une valeur écrite
 *     juste après le téléversement ne peut pas être prise pour une orpheline) ;
 *   · on ne supprime que ce qu'AUCUNE valeur ne cite, vérifié en base ;
 *   · au plus 200 suppressions par passage, et le passage a lieu une fois
 *     par jour : une erreur de raisonnement ne peut pas vider le bucket d'un
 *     coup, elle laisse le temps de la voir dans les journaux.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const BUCKET_FICHIERS_CHAMPS = 'custom-field-files';
const AGE_MINIMUM_MS = 7 * 86_400_000;
const MAX_SUPPRESSIONS = 200;
const MAX_DOSSIERS = 200;
const TAILLE_LOT = 100;

export interface FichierBucket { chemin: string; cree: string | null }

/**
 * Ce qu'il faut supprimer : assez vieux, et cité par aucune valeur.
 * Pure, pour être testable sans bucket ni base.
 */
export function cheminsAsupprimer(
  fichiers: readonly FichierBucket[],
  references: ReadonlySet<string>,
  maintenant: Date = new Date(),
  maxi: number = MAX_SUPPRESSIONS,
): string[] {
  const limite = maintenant.getTime() - AGE_MINIMUM_MS;
  const sortie: string[] = [];
  for (const f of fichiers) {
    if (sortie.length >= maxi) break;
    // Sans date de création, on s'abstient : on ne sait pas si le fichier
    // vient d'être posé par une saisie en cours.
    if (!f.cree) continue;
    const t = Date.parse(f.cree);
    if (!Number.isFinite(t) || t > limite) continue;
    if (references.has(f.chemin)) continue;
    sortie.push(f.chemin);
  }
  return sortie;
}

/** Les fichiers du bucket, en descendant <org>/<uuid>/<nom>. */
async function listerFichiers(supabase: SupabaseClient): Promise<FichierBucket[]> {
  const bucket = supabase.storage.from(BUCKET_FICHIERS_CHAMPS);
  const dossiers = async (prefixe: string) => {
    const { data, error } = await bucket.list(prefixe, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(error.message);
    return data ?? [];
  };
  const fichiers: FichierBucket[] = [];
  let vus = 0;
  for (const org of await dossiers('')) {
    if (org.id !== null) continue; // un fichier à la racine n'est pas un dossier d'org
    for (const sous of await dossiers(org.name)) {
      if (sous.id !== null || ++vus > MAX_DOSSIERS) continue;
      for (const f of await dossiers(`${org.name}/${sous.name}`)) {
        if (f.id === null) continue;
        fichiers.push({ chemin: `${org.name}/${sous.name}/${f.name}`, cree: f.created_at ?? null });
      }
    }
  }
  return fichiers;
}

/** Les chemins de `candidats` qu'une valeur cite encore (service_role : toutes les entreprises). */
async function referencesExistantes(supabase: SupabaseClient, candidats: string[]): Promise<Set<string>> {
  const vues = new Set<string>();
  for (let i = 0; i < candidats.length; i += TAILLE_LOT) {
    const lot = candidats.slice(i, i + TAILLE_LOT);
    const { data, error } = await supabase
      .from('custom_field_values')
      .select('value_text')
      .in('value_text', lot);
    // Une requête ratée ne doit RIEN faire supprimer : on considère tout le lot
    // comme référencé plutôt que de risquer un effacement sur une base muette.
    if (error) { lot.forEach((c) => vues.add(c)); continue; }
    for (const r of data ?? []) if (r.value_text) vues.add(r.value_text as string);
  }
  return vues;
}

/** Un passage de ménage. Rend le nombre de fichiers supprimés. */
export async function menageFichiersChamps(supabase: SupabaseClient): Promise<number> {
  const fichiers = await listerFichiers(supabase);
  if (fichiers.length === 0) return 0;
  const references = await referencesExistantes(supabase, fichiers.map((f) => f.chemin));
  const aSupprimer = cheminsAsupprimer(fichiers, references);
  if (aSupprimer.length === 0) return 0;
  const { error } = await supabase.storage.from(BUCKET_FICHIERS_CHAMPS).remove(aSupprimer);
  if (error) throw new Error(error.message);
  console.log(`[champs] ménage du bucket : ${aSupprimer.length} fichier(s) orphelin(s) supprimé(s) sur ${fichiers.length}`);
  return aSupprimer.length;
}
