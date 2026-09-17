/**
 * Allègement des définitions d'outils envoyées au modèle (2026-09-17).
 * ─────────────────────────────────────────────────────────────────────
 * Mesuré : le bloc d'outils d'un sujet pèse 7 à 11 k tokens, dont 62 % de
 * schémas JSON. 376 descriptions de paramètres sur 646 ne font que répéter le
 * nom du paramètre (« Job id. » pour job_id, « New title. » pour title…) :
 * 6 700 caractères que le modèle relit à chaque étape sans rien apprendre.
 *
 * Règle : une description de paramètre est retirée seulement si, une fois
 * normalisée, elle ne contient QUE des mots du nom du paramètre et des mots
 * creux (the, new, id, optional…). Tout ce qui porte une information
 * (format, unité, valeur par défaut, source de l'identifiant, exemple, borne)
 * reste. Déterministe : le préfixe en cache reste stable.
 */
type Schema = Record<string, any>;

const MOTS_CREUX = new Set(['the', 'a', 'an', 'new', 'id', 'ids', 'of', 'to', 'optional', 'existing', 'this', 'that', 'for', 'or', 'and', 'in', 'its', 'their']);
const normaliser = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
const SINGULIER = (m: string) => (m.length > 3 && m.endsWith('s') ? m.slice(0, -1) : m);

/** Vrai si la description ne dit rien de plus que le nom du paramètre. */
export function descriptionRedondante(cle: string, description: string): boolean {
  const d = description.trim();
  if (!d || d.length > 30) return false;
  // Tout signe d'information : chiffres, parenthèses, unités, formats, exemples, sources.
  if (/[0-9()/:%€$]|cents|yyyy|iso|default|max|min|from |e\.g|ex\.|list_|get_|search|only|never|always|per |seconds|minutes|days|hours|utc|e164|url|json/i.test(d)) return false;
  const motsCle = new Set(normaliser(cle.replace(/_/g, ' ')).map(SINGULIER));
  const mots = normaliser(d).map(SINGULIER);
  return mots.length > 0 && mots.every((m) => motsCle.has(m) || MOTS_CREUX.has(m));
}

/** Copie du schéma sans les descriptions de paramètres redondantes (récursif sur les items de tableau). */
export function allegerSchema(schema: Schema | undefined): Schema | undefined {
  if (!schema || typeof schema !== 'object') return schema;
  const out: Schema = { ...schema };
  if (out.properties && typeof out.properties === 'object') {
    const props: Schema = {};
    for (const [k, v] of Object.entries(out.properties as Schema)) {
      if (!v || typeof v !== 'object') { props[k] = v; continue; }
      const copie: Schema = { ...v };
      if (typeof copie.description === 'string' && descriptionRedondante(k, copie.description)) delete copie.description;
      if (copie.items && typeof copie.items === 'object') copie.items = allegerSchema(copie.items);
      props[k] = copie;
    }
    out.properties = props;
  }
  return out;
}

/** Nombre de caractères économisés sur un schéma (pour les mesures). */
export function economie(schema: Schema | undefined): number {
  return JSON.stringify(schema ?? {}).length - JSON.stringify(allegerSchema(schema) ?? {}).length;
}
