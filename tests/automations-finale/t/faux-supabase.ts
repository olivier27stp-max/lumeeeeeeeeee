/**
 * Un faux client Supabase, en mémoire, pour faire tourner la VRAIE API des
 * messages (`src/lib/automationRulesApi.ts`) et les vrais composants sans base.
 *
 * Il ne sait faire que ce dont ces écrans se servent : lire une ligne par
 * égalité (`select … eq … single / maybeSingle`), lister, et modifier
 * (`update … eq … select`). Une panne se simule par `base.erreurLecture`,
 * `base.erreurEcriture` (l'objet d'erreur que PostgREST rendrait) ou
 * `base.ecritureFiltree` (la RLS filtre la ligne : 0 ligne touchée, aucune erreur).
 *
 * Usage : `vi.mock('…/src/lib/supabase', async () => (await import('./faux-supabase')).moduleSupabase())`.
 */

type Ligne = Record<string, unknown>;

export interface FausseBase {
  tables: Record<string, Ligne[]>;
  /** Chaque `update` appliqué : la table et les valeurs écrites. */
  ecritures: Array<{ table: string; valeurs: Ligne }>;
  /** Nombre de lectures faites, par table. */
  lectures: Record<string, number>;
  erreurLecture: { message: string; code?: string } | null;
  /** Panne de lecture d'UNE table (les autres répondent). */
  erreursLectureParTable: Record<string, { message: string; code?: string }>;
  erreurEcriture: { message: string; code?: string } | null;
  ecritureFiltree: boolean;
}

export const base: FausseBase = {
  tables: {}, ecritures: [], lectures: {}, erreurLecture: null, erreursLectureParTable: {}, erreurEcriture: null, ecritureFiltree: false,
};

/** Remet la fausse base à neuf, avec ces lignes. */
export function remettre(tables: Record<string, Ligne[]> = {}): void {
  base.tables = structuredClone(tables);
  base.ecritures = [];
  base.lectures = {};
  base.erreurLecture = null;
  base.erreursLectureParTable = {};
  base.erreurEcriture = null;
  base.ecritureFiltree = false;
}

/** La ligne d'une table, par son `id` (copie : la modifier ne change pas la base). */
export function ligne<T = Ligne>(table: string, id: string): T {
  const l = (base.tables[table] ?? []).find((x) => x.id === id);
  if (!l) throw new Error(`ligne ${table}/${id} absente de la fausse base`);
  return structuredClone(l) as T;
}

function requete(table: string) {
  const filtres: Array<(l: Ligne) => boolean> = [];
  let valeurs: Ligne | null = null;
  const executer = (unique: boolean) => {
    const lignes = (base.tables[table] ?? []).filter((l) => filtres.every((f) => f(l)));
    if (valeurs) {
      if (base.erreurEcriture) return { data: null, error: base.erreurEcriture };
      if (base.ecritureFiltree) return { data: [], error: null };
      for (const l of lignes) Object.assign(l, structuredClone(valeurs));
      base.ecritures.push({ table, valeurs: structuredClone(valeurs) });
      return { data: lignes.map((l) => ({ id: l.id })), error: null };
    }
    base.lectures[table] = (base.lectures[table] ?? 0) + 1;
    if (base.erreurLecture) return { data: null, error: base.erreurLecture };
    if (base.erreursLectureParTable[table]) return { data: null, error: base.erreursLectureParTable[table] };
    if (unique) return { data: lignes[0] ? structuredClone(lignes[0]) : null, error: null };
    return { data: structuredClone(lignes), error: null };
  };
  const chaine = {
    select: () => chaine,
    order: () => chaine,
    limit: () => chaine,
    gte: () => chaine,
    eq: (colonne: string, valeur: unknown) => { filtres.push((l) => l[colonne] === valeur); return chaine; },
    is: (colonne: string, valeur: unknown) => { filtres.push((l) => (l[colonne] ?? null) === valeur); return chaine; },
    update: (v: Ligne) => { valeurs = v; return chaine; },
    single: async () => executer(true),
    maybeSingle: async () => executer(true),
    then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(executer(false)).then(ok, ko),
  };
  return chaine;
}

/** Le module `src/lib/supabase` de remplacement. */
export function moduleSupabase() {
  return {
    supabase: {
      from: (table: string) => requete(table),
      rpc: async () => ({ data: null, error: null }),
      auth: {
        getUser: async () => ({ data: { user: null } }),
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
}
