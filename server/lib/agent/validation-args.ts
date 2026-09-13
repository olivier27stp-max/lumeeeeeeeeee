/**
 * Validation des arguments d'un outil AVANT son handler (item 4, R2/R7).
 * ─────────────────────────────────────────────────────────────────
 * Le JSON Schema d'une déclaration d'outil servait au modèle seulement ; le
 * serveur faisait confiance à ce que le modèle envoyait et chaque handler
 * revalidait à sa façon (champRequis, clamp…). Ici, une seule passe, la
 * même pour Lumi, le MCP et les raccourcis : types, champs requis, énumérations,
 * tableaux et objets imbriqués. Les champs inconnus sont RETIRÉS (le modèle
 * en invente parfois) et signalés, jamais transmis au handler.
 *
 * Sous-ensemble volontairement petit (ce que les 69 déclarations utilisent) :
 * type string | integer | number | boolean | array | object, required, enum,
 * items, properties. Tout autre mot-clé est ignoré.
 *
 * Tolérance mesurée : un nombre reçu en chaîne numérique (« 50000 ») est
 * converti — les modèles le font souvent et le refuser coûterait un tour.
 * Une chaîne non numérique pour un nombre est refusée.
 */
export interface SchemaSimple {
  type?: string;
  properties?: Record<string, SchemaSimple>;
  required?: string[];
  items?: SchemaSimple;
  enum?: unknown[];
  description?: string;
}

export type ResultatValidation =
  | { ok: true; args: Record<string, any>; ignores: string[] }
  | { ok: false; erreur: string };

function libelle(chemin: string[]): string {
  return chemin.length ? chemin.join('.') : 'racine';
}

function valider(schema: SchemaSimple | undefined, valeur: unknown, chemin: string[], ignores: string[]): { ok: true; valeur: unknown } | { ok: false; erreur: string } {
  if (!schema || !schema.type) return { ok: true, valeur };
  if (schema.enum && !schema.enum.includes(valeur)) {
    return { ok: false, erreur: `${libelle(chemin)} : valeur « ${String(valeur)} » hors des choix permis (${schema.enum.map(String).join(', ')})` };
  }
  switch (schema.type) {
    case 'string':
      if (typeof valeur === 'string') return { ok: true, valeur };
      if (typeof valeur === 'number' || typeof valeur === 'boolean') return { ok: true, valeur: String(valeur) };
      return { ok: false, erreur: `${libelle(chemin)} : texte attendu` };
    case 'integer':
    case 'number': {
      const n = typeof valeur === 'number' ? valeur : (typeof valeur === 'string' && valeur.trim() !== '' ? Number(valeur) : NaN);
      if (!Number.isFinite(n)) return { ok: false, erreur: `${libelle(chemin)} : nombre attendu` };
      if (schema.type === 'integer' && !Number.isInteger(n)) return { ok: false, erreur: `${libelle(chemin)} : nombre entier attendu` };
      return { ok: true, valeur: n };
    }
    case 'boolean':
      if (typeof valeur === 'boolean') return { ok: true, valeur };
      if (valeur === 'true' || valeur === 'false') return { ok: true, valeur: valeur === 'true' };
      return { ok: false, erreur: `${libelle(chemin)} : vrai/faux attendu` };
    case 'array': {
      if (!Array.isArray(valeur)) return { ok: false, erreur: `${libelle(chemin)} : liste attendue` };
      const out: unknown[] = [];
      for (const [i, v] of valeur.entries()) {
        const r = valider(schema.items, v, [...chemin, String(i)], ignores);
        if (!r.ok) return r;
        out.push(r.valeur);
      }
      return { ok: true, valeur: out };
    }
    case 'object': {
      if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return { ok: false, erreur: `${libelle(chemin)} : objet attendu` };
      const props = schema.properties ?? {};
      const out: Record<string, unknown> = {};
      for (const k of schema.required ?? []) {
        const v = (valeur as any)[k];
        if (v === undefined || v === null || v === '') return { ok: false, erreur: `${libelle([...chemin, k])} : champ obligatoire manquant` };
      }
      for (const [k, v] of Object.entries(valeur as Record<string, unknown>)) {
        if (!(k in props)) { if (Object.keys(props).length) ignores.push(libelle([...chemin, k])); else out[k] = v; continue; }
        if (v === undefined || v === null) continue; // optionnel absent
        const r = valider(props[k], v, [...chemin, k], ignores);
        if (!r.ok) return r;
        out[k] = r.valeur;
      }
      return { ok: true, valeur: out };
    }
    default:
      return { ok: true, valeur };
  }
}

/** Valide et normalise `args` contre la déclaration `parameters` d'un outil. */
export function validerArgs(parameters: SchemaSimple | undefined, args: Record<string, any> | undefined): ResultatValidation {
  const ignores: string[] = [];
  const r = valider(parameters ?? { type: 'object', properties: {} }, args ?? {}, [], ignores);
  if (!r.ok) return r;
  return { ok: true, args: r.valeur as Record<string, any>, ignores };
}
