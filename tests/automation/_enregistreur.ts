/**
 * Client Supabase ENREGISTREUR pour les tests unitaires du moteur
 * d'automatisations.
 *
 * Chaque `from(table)` ouvre une requête ; les filtres `.eq/.in/.is` et
 * l'opération (select/insert/update/delete) sont notés dans `journal` ; `await`
 * résout avec la réponse préparée pour cette table — une valeur fixe, ou une
 * fonction `(requête, n)` qui reçoit le numéro d'appel pour cette table (utile
 * pour « la 2e insertion échoue en 23505 »).
 *
 * Le client ne SAIT PAS filtrer : il rend ce qu'on lui a préparé quoi qu'on lui
 * demande. Les tests d'isolation vérifient donc les filtres DEMANDÉS, pas les
 * lignes rendues.
 */
export interface Requete {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete' | 'rpc';
  filtres: Array<[string, string, unknown]>;
  valeur?: unknown;
}

export interface Reponse { data?: any; error?: { code?: string; message: string } | null; count?: number | null }
type Preparee = Reponse | ((req: Requete, n: number) => Reponse);

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
    for (const m of ['select', 'order', 'limit', 'or', 'ilike', 'neq', 'lt', 'gt', 'gte', 'lte', 'not', 'range']) o[m] = self;
    for (const m of ['eq', 'in', 'is']) o[m] = (col: string, val: unknown) => { req.filtres.push([m, col, val]); return o; };
    o.insert = (v: unknown) => { req.op = 'insert'; req.valeur = v; return o; };
    o.upsert = (v: unknown) => { req.op = 'insert'; req.valeur = v; return o; };
    o.update = (v: unknown) => { req.op = 'update'; req.valeur = v; return o; };
    o.delete = () => { req.op = 'delete'; return o; };
    o.maybeSingle = async () => { const r = resoudre(req); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data ?? null, error: r.error ?? null }; };
    o.single = o.maybeSingle;
    o.then = (res: any, rej: any) => { const r = resoudre(req); return Promise.resolve({ data: r.data ?? null, error: r.error ?? null, count: r.count ?? null }).then(res, rej); };
    return o;
  };
  const rpc = async (nom: string, params?: unknown) => {
    const req: Requete = { table: `rpc:${nom}`, op: 'rpc', filtres: [], valeur: params };
    journal.push(req);
    const r = resoudre(req);
    return { data: r.data ?? null, error: r.error ?? null };
  };
  return { client: { from, rpc } as any, journal };
}

/** Les requêtes d'une table, optionnellement d'une opération. */
export const requetes = (journal: Requete[], table: string, op?: Requete['op']) =>
  journal.filter((r) => r.table === table && (!op || r.op === op));

/** La requête porte-t-elle `eq('org_id', orgId)` ? */
export const porteOrg = (r: Requete, orgId: string) =>
  r.filtres.some(([op, col, val]) => op === 'eq' && col === 'org_id' && val === orgId);
