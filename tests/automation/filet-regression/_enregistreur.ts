/**
 * Client Supabase ENREGISTREUR du filet de régression des automatisations.
 *
 * Même principe que `tests/quarantaine/automation/_enregistreur.ts`, avec deux
 * différences qui comptent pour un instantané :
 *   - les arguments des RPC sont notés (une RPC d'écriture fait partie de la
 *     sortie observable, au même titre qu'un insert) ;
 *   - `.ilike/.neq/.lt/...` sont notés aussi : une requête qui change de filtre
 *     change de comportement, le filet doit le voir.
 *
 * Le client ne SAIT PAS filtrer : il rend ce qu'on lui a préparé pour la
 * table, quoi qu'on lui demande. Les réponses préparées sont des TABLEAUX :
 * `maybeSingle()` prend la première ligne, un `await` direct rend le tableau.
 */
export interface Requete {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete' | 'rpc';
  filtres: Array<[string, string, unknown]>;
  valeur?: unknown;
}

export interface Reponse { data?: any; error?: { code?: string; message: string } | null; count?: number | null }
export type Preparee = Reponse | ((req: Requete, n: number) => Reponse);

export function clientEnregistreur(reponses: Record<string, Preparee>) {
  const journal: Requete[] = [];
  const compteurs: Record<string, number> = {};

  const resoudre = (req: Requete): Reponse => {
    const prep = reponses[req.table];
    if (!prep) return { data: null, error: null };
    const n = (compteurs[req.table] = (compteurs[req.table] || 0) + 1);
    return typeof prep === 'function' ? prep(req, n) : prep;
  };

  const from = (table: string) => {
    const req: Requete = { table, op: 'select', filtres: [] };
    journal.push(req);
    const o: any = {};
    const self = () => o;
    for (const m of ['select', 'order', 'limit', 'range', 'returns', 'abortSignal']) o[m] = self;
    for (const m of ['eq', 'in', 'is', 'neq', 'lt', 'gt', 'gte', 'lte', 'ilike', 'like', 'not', 'contains', 'or', 'filter', 'match']) {
      o[m] = (col: unknown, val?: unknown, val2?: unknown) => {
        req.filtres.push([m, String(col), val2 === undefined ? val : [val, val2]]);
        return o;
      };
    }
    o.insert = (v: unknown) => { req.op = 'insert'; req.valeur = v; return o; };
    o.upsert = (v: unknown) => { req.op = 'insert'; req.valeur = v; return o; };
    o.update = (v: unknown) => { req.op = 'update'; req.valeur = v; return o; };
    o.delete = () => { req.op = 'delete'; return o; };
    o.maybeSingle = async () => {
      const r = resoudre(req);
      return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data ?? null, error: r.error ?? null };
    };
    o.single = o.maybeSingle;
    o.then = (res: any, rej: any) => {
      const r = resoudre(req);
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null, count: r.count ?? null }).then(res, rej);
    };
    return o;
  };
  const rpc = async (nom: string, args?: unknown) => {
    const req: Requete = { table: `rpc:${nom}`, op: 'rpc', filtres: [], valeur: args };
    journal.push(req);
    const r = resoudre(req);
    return { data: r.data ?? null, error: r.error ?? null };
  };
  return { client: { from, rpc } as any, journal };
}

/** Les requêtes d'une table, optionnellement d'une opération. */
export const requetes = (journal: Requete[], table: string, op?: Requete['op']) =>
  journal.filter((r) => r.table === table && (!op || r.op === op));
