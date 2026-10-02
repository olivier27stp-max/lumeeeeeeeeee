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
 * La MÊME base sert au navigateur (`moduleSupabase`, à la place de
 * `src/lib/supabase`) et au serveur (`moduleSupabaseServeur`, à la place de
 * `server/lib/supabase`) : un test fait le geste à l'écran, la vraie route
 * écrit, et on relit ce qui est en base.
 *
 * Usage :
 *   vi.mock('…/src/lib/supabase', async () => (await import('./faux-supabase')).moduleSupabase());
 *   vi.mock('…/server/lib/supabase', async () => (await import('./faux-supabase')).moduleSupabaseServeur());
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
  /** L'utilisateur connecté (côté serveur) : son adhésion est lue dans `memberships`. */
  utilisateur: string;
}

/** Le bureau de la fausse session. */
export const ORG = 'org-1';
const adhesion = (utilisateur: string, role: string): Ligne => ({
  id: `m-${utilisateur}`, user_id: utilisateur, org_id: ORG, status: 'active', role, scope: 'company',
  team_id: null, department_id: null, manager_id: null, permissions: {},
});

export const base: FausseBase = {
  tables: {}, ecritures: [], lectures: {}, erreurLecture: null, erreursLectureParTable: {}, erreurEcriture: null, ecritureFiltree: false,
  utilisateur: 'proprio',
};

/** Remet la fausse base à neuf, avec ces lignes. */
export function remettre(tables: Record<string, Ligne[]> = {}): void {
  // Deux comptes par défaut : un propriétaire (tous les droits) et un technicien (aucun sur les automatisations).
  base.tables = structuredClone({ memberships: [adhesion('proprio', 'owner'), adhesion('technicien', 'technician')], ...tables });
  base.utilisateur = 'proprio';
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
    gte: (colonne: string, valeur: unknown) => { filtres.push((l) => String(l[colonne] ?? '') >= String(valeur)); return chaine; },
    eq: (colonne: string, valeur: unknown) => { filtres.push((l) => l[colonne] === valeur); return chaine; },
    neq: (colonne: string, valeur: unknown) => { filtres.push((l) => l[colonne] !== valeur); return chaine; },
    in: (colonne: string, valeurs: unknown[]) => { filtres.push((l) => valeurs.includes(l[colonne])); return chaine; },
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
        getSession: async () => ({ data: { session: { access_token: 'jeton-de-test' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
}

/** Le module `server/lib/supabase` de remplacement : la session est celle de `base.utilisateur`, dans le bureau `ORG`. */
export function moduleSupabaseServeur() {
  const client = { from: (table: string) => requete(table) };
  return {
    requireAuthedClient: async () => ({ client, orgId: ORG, user: { id: base.utilisateur, email: `${base.utilisateur}@lume-qa.test` } }),
    getServiceClient: () => client,
  };
}
