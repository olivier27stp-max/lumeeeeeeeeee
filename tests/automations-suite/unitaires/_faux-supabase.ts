/**
 * Un faux Supabase EN MÉMOIRE pour les tests unitaires du moteur : il filtre
 * vraiment (eq / neq / is / in / lt / lte / gt / gte, colonnes `json->>cle`),
 * met à jour, insère, et COMPTE ses requêtes par table — de quoi mesurer le
 * nombre de lectures d'une tâche différée (garde-fou de la mission : la
 * revalidation ne doit pas multiplier les requêtes).
 *
 * Contrairement à `clientEnregistreur` (tests/quarantaine/automation), qui
 * rend ce qu'on lui a préparé quoi qu'on demande, celui-ci juge sur les
 * lignes : « la facture est à la corbeille » se lit dans la table.
 */
export type Ligne = Record<string, any>;

export interface RequeteFaite { table: string; op: 'select' | 'insert' | 'update' | 'delete'; valeur?: unknown }

export function fauxSupabase(
  tables: Record<string, Ligne[]>,
  options: { erreurs?: Record<string, string>; rpc?: Record<string, (args: Ligne) => Ligne[]> } = {},
) {
  const requetes: RequeteFaite[] = [];
  const appelsRpc: Array<{ nom: string; args: Ligne }> = [];
  const lire = (l: Ligne, c: string) => {
    const m = /^(\w+)->>?(\w+)$/.exec(c);
    return m ? l[m[1]]?.[m[2]] : l[c];
  };
  const from = (table: string) => {
    tables[table] ??= [];
    const req: RequeteFaite = { table, op: 'select' };
    requetes.push(req);
    const filtres: Array<(l: Ligne) => boolean> = [];
    let maj: Ligne | null = null;
    let limite = Infinity;
    const resoudre = () => {
      const erreur = options.erreurs?.[table];
      if (erreur) return { data: null, error: { message: erreur }, count: null };
      if (req.op === 'insert') return { data: (Array.isArray(req.valeur) ? req.valeur : [req.valeur]) as Ligne[], error: null, count: null };
      const trouvees = tables[table].filter((l) => filtres.every((f) => f(l))).slice(0, limite);
      if (maj) for (const l of trouvees) Object.assign(l, maj);
      if (req.op === 'delete') tables[table] = tables[table].filter((l) => !trouvees.includes(l));
      return { data: trouvees.map((l) => ({ ...l })), error: null, count: trouvees.length };
    };
    const b: Ligne = {
      select: () => b,
      order: () => b,
      or: () => b,
      like: () => b,
      ilike: () => b,
      not: () => b,
      range: () => b,
      limit: (n: number) => { limite = n; return b; },
      eq: (c: string, v: unknown) => { filtres.push((l) => lire(l, c) === v); return b; },
      neq: (c: string, v: unknown) => { filtres.push((l) => lire(l, c) !== v); return b; },
      is: (c: string, v: unknown) => { filtres.push((l) => (lire(l, c) ?? null) === v); return b; },
      in: (c: string, v: unknown[]) => { filtres.push((l) => v.includes(lire(l, c))); return b; },
      lt: (c: string, v: any) => { filtres.push((l) => lire(l, c) < v); return b; },
      lte: (c: string, v: any) => { filtres.push((l) => lire(l, c) <= v); return b; },
      gt: (c: string, v: any) => { filtres.push((l) => lire(l, c) > v); return b; },
      gte: (c: string, v: any) => { filtres.push((l) => lire(l, c) >= v); return b; },
      update: (v: Ligne) => { req.op = 'update'; req.valeur = v; maj = v; return b; },
      insert: (v: Ligne | Ligne[]) => {
        req.op = 'insert'; req.valeur = v;
        for (const l of Array.isArray(v) ? v : [v]) tables[table].push({ id: `${table}-${tables[table].length + 1}`, ...l });
        return b;
      },
      upsert: (v: Ligne) => b.insert(v),
      delete: () => { req.op = 'delete'; return b; },
      maybeSingle: async () => { const r = resoudre(); return { data: r.data?.[0] ?? null, error: r.error }; },
      single: async () => { const r = resoudre(); return { data: r.data?.[0] ?? null, error: r.error }; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(resoudre()).then(res, rej),
    };
    return b;
  };
  /**
   * Une fonction SQL qui rend des lignes : `options.rpc[nom](args)`. Comme avec
   * PostgREST, son résultat se filtre, se trie et se borne (gte / order / limit).
   */
  const rpc = (nom: string, args: Ligne = {}) => {
    appelsRpc.push({ nom, args });
    let lignes = [...(options.rpc?.[nom]?.(args) ?? [])];
    const b: Ligne = {
      gte: (c: string, v: any) => { lignes = lignes.filter((l) => l[c] >= v); return b; },
      order: (c: string, o: { ascending?: boolean } = {}) => {
        lignes.sort((x, y) => (x[c] < y[c] ? -1 : x[c] > y[c] ? 1 : 0) * (o.ascending === false ? -1 : 1));
        return b;
      },
      limit: (n: number) => { lignes = lignes.slice(0, n); return b; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: options.rpc?.[nom] ? lignes : null, error: null }).then(res, rej),
    };
    return b;
  };
  return {
    client: { from, rpc } as never,
    appelsRpc,
    tables,
    requetes,
    /** Nombre de lectures (select) par table depuis le début, ou depuis `depuis`. */
    lectures: (depuis = 0) => requetes.slice(depuis).filter((r) => r.op === 'select').map((r) => r.table),
  };
}
