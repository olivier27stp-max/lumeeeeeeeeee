/* ═══════════════════════════════════════════════════════════════
   Filtre « Étiquettes » — logique pure, partagée par la pipeline et la
   liste Clients (étape 3 du plan étiquettes + champs, 2026-09-28).

   Les étiquettes vivent sur le CLIENT (décision D1) : un deal « a »
   l'étiquette si son client l'a. Comparaison insensible à la casse,
   comme le catalogue (unicité sur lower(name)).

   · `avec` + `mode` : a TOUTES les étiquettes cochées, ou AU MOINS UNE ;
   · `sans`         : n'a AUCUNE de ces étiquettes (exclusion).

   Les vues enregistrées de la pipeline sont un objet de CHAÎNES
   (`pipeline_vues.filtres`) : les listes y voyagent en JSON, comme
   `champs_perso`.
   ═══════════════════════════════════════════════════════════════ */

export type ModeEtiquettes = 'toutes' | 'une';

export interface FiltreEtiquettes {
  avec: string[];
  mode: ModeEtiquettes;
  sans: string[];
}

export const FILTRE_ETIQUETTES_VIDE: FiltreEtiquettes = { avec: [], mode: 'une', sans: [] };

/** Nombre de filtres posés (pour le badge « Filtres » et « Enregistrer la vue »). */
export function nbFiltresEtiquettes(f: FiltreEtiquettes): number {
  return (f.avec.length > 0 ? 1 : 0) + (f.sans.length > 0 ? 1 : 0);
}

/** Le client (ses étiquettes) passe-t-il le filtre ? Sans filtre : toujours. */
export function correspondEtiquettes(tags: readonly string[] | undefined, f: FiltreEtiquettes): boolean {
  if (f.avec.length === 0 && f.sans.length === 0) return true;
  const siennes = new Set((tags ?? []).map((t) => t.toLowerCase()));
  if (f.sans.some((t) => siennes.has(t.toLowerCase()))) return false;
  if (f.avec.length === 0) return true;
  return f.mode === 'toutes'
    ? f.avec.every((t) => siennes.has(t.toLowerCase()))
    : f.avec.some((t) => siennes.has(t.toLowerCase()));
}

/** Vers le jsonb d'une vue enregistrée (clés absentes quand rien n'est posé). */
export function etiquettesVersVue(f: FiltreEtiquettes): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.avec.length > 0) {
    out.etiquettes = JSON.stringify(f.avec);
    out.etiquettes_mode = f.mode;
  }
  if (f.sans.length > 0) out.etiquettes_sans = JSON.stringify(f.sans);
  return out;
}

function listeDeChaines(brut: string | undefined): string[] {
  if (!brut) return [];
  try {
    const v: unknown = JSON.parse(brut);
    return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.trim() !== ''))] : [];
  } catch (err) {
    // Une vieille vue ou une saisie manuelle illisible : on l'ignore plutôt
    // que de casser l'écran — mais on le dit dans la console.
    console.error('[etiquettes] filtre de vue illisible', err);
    return [];
  }
}

/** Depuis une vue enregistrée : ce qui est illisible est ignoré, jamais bloquant. */
export function etiquettesDepuisVue(filtres: Record<string, string> | null | undefined): FiltreEtiquettes {
  if (!filtres) return FILTRE_ETIQUETTES_VIDE;
  const avec = listeDeChaines(filtres.etiquettes);
  const sans = listeDeChaines(filtres.etiquettes_sans);
  if (avec.length === 0 && sans.length === 0) return FILTRE_ETIQUETTES_VIDE;
  return { avec, sans, mode: filtres.etiquettes_mode === 'toutes' ? 'toutes' : 'une' };
}

/**
 * Les étiquettes demandées par l'URL (`/clients?etiquette=VIP`, lien de
 * Réglages → Étiquettes). Le paramètre peut se répéter. `URLSearchParams`
 * décode déjà (« %C3%89t%C3%A9 » → « Été », « + » → espace).
 */
export function etiquettesDepuisUrl(search: string): string[] {
  const p = new URLSearchParams(search);
  return [...new Set(p.getAll('etiquette').map((t) => t.trim()).filter(Boolean))];
}

/** Les CLIENTS distincts d'une sélection de deals (un deal sans client est ignoré). */
export function clientsDistincts(deals: ReadonlyArray<{ id: string; client_id: string | null }>, ids: Iterable<string>): string[] {
  const voulus = new Set(ids);
  const out = new Set<string>();
  for (const d of deals) if (voulus.has(d.id) && d.client_id) out.add(d.client_id);
  return [...out];
}
